"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ActionFailure } from "@/lib/action-result";
import { moduleUsesProductCover } from "@/server/member-area/modules-model";
import { ErrorBanner } from "../error-banner";
import { ImageField } from "../products/image-field";
import { AdminSheet, AdminSheetSection } from "../sheet";
import { StatusChip } from "../status-chip";
import type { TreeModule } from "./tree-model";

// Capa do modulo (menu do modulo › "Trocar capa do módulo…" ou a miniatura no cabecalho do modulo).
// Recorte 2:3 (ate 720×1080, o mesmo card vertical da area do aluno) e grava na hora; "Usar a capa do
// produto" volta para a capa do produto. Sem rascunho: o painel so mostra o que ja esta gravado.

type ModuleCoverSheetProps = {
  canWrite: boolean;
  module: TreeModule;
  onOpenChange: (open: boolean) => void;
  /** Grava (fila da arvore). `undo` = estado anterior para o "Desfazer" do toast (undefined = sem volta). */
  onSave: (moduleId: string, image: string | null, options: { undo?: string | null }) => Promise<ActionFailure | null>;
  open: boolean;
  productCoverUrl: string | null;
  /** Capa do produto (28 x 40) a esquerda do titulo do painel. */
  media?: ReactNode;
  productTitle: string;
};

function backgroundFor(url: string) {
  return { backgroundImage: `url("${url.replace(/["\\\n\r]/g, (character) => encodeURIComponent(character))}")` };
}

/** "1 aula", "3 aulas": a linha que o aluno ve embaixo do nome do modulo (course_modules.meta). */
function lessonCountLabel(count: number) {
  return `${count} ${count === 1 ? "aula" : "aulas"}`;
}

/**
 * Card do modulo como o aluno ve na pagina do curso e na fileira da home: capa 2:3 (o card de 9:13 da
 * fileira imersiva corta igual nas laterais), nome e a quantidade de aulas por cima do degrade. Sem
 * capa, o fundo fica escuro e liso, como na area do aluno.
 */
function StudentCardPreview({ coverUrl, module }: { coverUrl: string | null; module: TreeModule }) {
  return (
    <figure
      aria-label={`Como o aluno vê o card de ${module.title}`}
      className="relative aspect-[2/3] w-32 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-[#101010] bg-cover bg-center sm:w-36"
      style={coverUrl ? backgroundFor(coverUrl) : undefined}
    >
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-3/4 bg-gradient-to-t from-black via-black/80 to-transparent" />
      <figcaption className="absolute inset-x-2.5 bottom-2.5 flex flex-col gap-1.5">
        <span className="line-clamp-2 text-xs leading-4 font-bold text-white">{module.title}</span>
        <span className="text-[10px] leading-3 font-medium text-white/75">{lessonCountLabel(module.lessons.length)}</span>
      </figcaption>
    </figure>
  );
}

export function ModuleCoverSheet({
  media,
  canWrite,
  module,
  onOpenChange,
  onSave,
  open,
  productCoverUrl,
  productTitle
}: ModuleCoverSheetProps) {
  const [pending, setPending] = useState<"image" | "product" | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const imageSection = useRef<HTMLDivElement>(null);
  const usesProductCover = moduleUsesProductCover(module.coverUrl, productCoverUrl);
  const ownCover = usesProductCover ? null : module.coverUrl;
  const shownCover = module.coverUrl ?? productCoverUrl;
  // "Desfazer" so volta para algo que o servidor aceita de novo: a capa do produto ou um link https.
  const undo = usesProductCover ? null : ownCover && /^https:\/\//i.test(ownCover) ? ownCover : undefined;
  const busy = pending !== null || module.pending === true;

  async function save(image: string | null, source: "image" | "product") {
    if (!canWrite || busy) {
      return;
    }

    setPending(source);
    setFieldError(null);
    setFailure(null);
    const error = await onSave(module.id, image, { undo });
    setPending(null);

    if (!error) {
      if (source === "product") {
        // "Usar a capa do produto" some depois de gravar: o foco vai para o campo da capa propria,
        // a proxima acao natural (sem isso o foco do teclado cairia no body).
        window.requestAnimationFrame(() => imageSection.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus());
      }

      return;
    }

    const message = error.fieldErrors?.image?.[0];

    if (message) {
      setFieldError(message);
    } else {
      setFailure(error.error);
    }
  }

  return (
    <AdminSheet
      description={`Módulo ${module.position} · ${module.title}`}
      eyebrow={productTitle}
      media={media}
      footer={
        <>
          <p className="min-w-0 truncate text-[13px] leading-5 text-[var(--text-secondary)]" role="status">
            {pending ? "Salvando…" : canWrite ? "Salva assim que você escolhe." : "Só leitura."}
          </p>
          <Button className="px-4" onClick={() => onOpenChange(false)} type="button" variant="ghost">
            Fechar
          </Button>
        </>
      }
      onOpenChange={onOpenChange}
      open={open}
      title="Capa do módulo"
    >
      {failure ? <ErrorBanner className="mt-4">{failure}</ErrorBanner> : null}

      <AdminSheetSection title="Capa no card do módulo">
        <div className="flex min-w-0 items-start gap-4">
          <StudentCardPreview coverUrl={shownCover} module={module} />
          <div className="flex min-w-0 flex-col gap-2">
            <StatusChip className="w-fit" tone={usesProductCover ? "muted" : "success"}>
              {usesProductCover ? "Usando a capa do produto" : "Capa própria"}
            </StatusChip>
            <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
              Aparece no card do módulo na página do curso e na fileira de módulos da home.
            </p>
            {usesProductCover && !productCoverUrl ? (
              <p className="text-[13px] leading-5 text-[var(--text-secondary)]">
                O produto ainda não tem capa: sem capa própria, o card do módulo fica sem imagem.
              </p>
            ) : null}
            {!usesProductCover && canWrite ? (
              <Button
                aria-busy={pending === "product" || undefined}
                aria-disabled={busy || undefined}
                className="w-fit px-3"
                onClick={() => void save(null, "product")}
                type="button"
                variant="secondary"
              >
                {pending === "product" ? "Voltando…" : "Usar a capa do produto"}
              </Button>
            ) : null}
          </div>
        </div>
      </AdminSheetSection>

      <AdminSheetSection title={usesProductCover ? "Dar uma capa própria" : "Trocar a capa própria"}>
        <div ref={imageSection}>
          <ImageField
            error={fieldError}
            id={`module-cover-${module.clientKey ?? module.id}`}
            label="Capa própria do módulo"
            onChange={(value) => void save(value, value ? "image" : "product")}
            optional
            pending={pending === "image"}
            readOnly={!canWrite}
            slot="cover"
            value={ownCover}
          />
        </div>
      </AdminSheetSection>
    </AdminSheet>
  );
}
