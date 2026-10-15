"use client";

import { ChevronDown, Ellipsis } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { loadPublishChecklist, publishProduct, renameProduct, setProductSituation } from "@/server/catalog/product-actions";
import { studentPreviewBlockedReason } from "@/server/catalog/model";
import { productTitleSchema } from "@/server/catalog/schemas";
import { AdminBreadcrumb } from "../breadcrumb";
import { ErrorBanner } from "../error-banner";
import { ProductThumb } from "../product-thumb";
import { SectionTabs } from "../section-tabs";
import { situationTone, StatusChip } from "../status-chip";
import { adminTransition } from "../styles";
import { StudentPreviewButton } from "../student-preview-button";
import { adminToast } from "../toast";
import { useAdminTopbarTitle } from "../topbar-title";
import { DeleteProductDialog, PublishDialog, SituationDialog, type PublishDialogState, type SituationTarget } from "./product-dialogs";
import { useProductWorkspace } from "./product-workspace";

// Cabecalho fixo da pagina do produto (docs/17 §1.6.3) na forma do prototipo aprovado: um bloco que
// gruda logo abaixo da barra superior ao rolar (a partir de 768 px), com a migalha "Produtos / Nome",
// a linha capa 28 px + nome editavel no lugar (24/600) e, a direita, Situação (chip-botao de 32 px),
// Ver como aluno (36 px), Publicar (so em rascunho) e o menu "…" (32 px); embaixo, as abas com
// endereco proprio, que levam o ?periodo= de uma aba para outra. No celular o bloco rola junto.

export const menuContentClass =
  "w-56 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-3)] p-1 text-[var(--text-primary)] ring-0";
export const menuItemClass = "h-9 gap-2 rounded-md px-2 text-sm text-[var(--text-primary)] focus:bg-[var(--surface-2)]";

/** O periodo escolhido (?periodo=) segue de uma aba para outra, como no prototipo. */
const PRESERVED_TAB_PARAMS = ["periodo"] as const;

const situationDot = {
  archived: "bg-[var(--text-tertiary)]",
  draft: "bg-[var(--text-secondary)]",
  published: "bg-[var(--success)]"
} as const;

type HeaderError = { message: string; status: number };

export function ProductHeaderBar() {
  const router = useRouter();
  const { applyHeader, capabilities, header } = useProductWorkspace();
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [headerError, setHeaderError] = useState<HeaderError | null>(null);
  const [publish, setPublish] = useState<PublishDialogState>({ phase: "closed" });
  const [situationTarget, setSituationTarget] = useState<SituationTarget | null>(null);
  const [situationPending, setSituationPending] = useState(false);
  const [situationError, setSituationError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const skipCommit = useRef(false);
  const base = `/admin/produtos/${header.id}`;
  // Abas conforme as permissoes (o Professor fica so com Conteudo, e entao a barra de abas some).
  const tabs = [
    { href: base, label: header.format === "formacao" ? "Cursos" : "Conteúdo" },
    ...(capabilities.canSeeSettings
      ? [
          { href: `${base}/detalhes`, label: "Detalhes" },
          { href: `${base}/acesso`, label: "Acesso e venda" }
        ]
      : []),
    ...(capabilities.canSeeStudents ? [{ href: `${base}/alunos`, label: "Alunos" }] : []),
    ...(capabilities.canSeePerformance ? [{ href: `${base}/desempenho`, label: "Desempenho" }] : [])
  ];

  // No celular a barra superior mostra o nome do produto no lugar do nome da area.
  useAdminTopbarTitle(header.title);
  const titleValue = titleDraft ?? header.title;
  const showPublishButton = capabilities.canPublish && header.situation === "draft";
  const showMoreMenu = (capabilities.canPublish && header.situation !== "archived") || capabilities.canDelete;

  async function commitTitle() {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }

    if (titleDraft === null || renaming) {
      return;
    }

    if (titleDraft.trim() === header.title) {
      setTitleDraft(null);
      setTitleError(null);
      return;
    }

    const parsed = productTitleSchema.safeParse(titleDraft);

    if (!parsed.success) {
      setTitleError(parsed.error.issues[0]?.message ?? "Nome inválido.");
      return;
    }

    setRenaming(true);
    const result = await renameProduct({ expectedUpdatedAt: header.updatedAt, id: header.id, title: parsed.data });
    setRenaming(false);

    if (!result.ok) {
      const fieldMessage = result.fieldErrors?.title?.[0];

      if (fieldMessage) {
        setTitleError(fieldMessage);
      } else {
        setHeaderError({ message: result.error, status: result.status });
      }

      return;
    }

    applyHeader(result.data.header);
    setTitleDraft(null);
    setTitleError(null);
    setHeaderError(null);
    adminToast.success("Nome salvo");
  }

  async function openPublish() {
    setPublish({ phase: "loading" });
    const result = await loadPublishChecklist({ id: header.id });

    setPublish((current) => {
      if (current.phase === "closed") {
        return current;
      }

      return result.ok ? { checklist: result.data, phase: "ready" } : { error: result.error, phase: "load_error" };
    });
  }

  async function confirmPublish() {
    if (publish.phase !== "ready") {
      return;
    }

    const checklist = publish.checklist;
    setPublish({ checklist, phase: "publishing" });
    const result = await publishProduct({ expectedUpdatedAt: header.updatedAt, id: header.id });

    if (!result.ok) {
      setPublish({ checklist, error: result.error, phase: "ready", status: result.status });
      return;
    }

    applyHeader(result.data.header);

    if (!result.data.published) {
      setPublish({
        checklist: result.data.checklist,
        error: "Ainda falta resolver os itens marcados em vermelho.",
        phase: "ready"
      });
      return;
    }

    setPublish({ phase: "closed" });
    const previewHref = result.data.header.studentPreviewHref;
    adminToast.success("Produto publicado", {
      onUndo: () => window.open(previewHref, "_blank", "noopener,noreferrer"),
      undoLabel: "Ver como aluno"
    });
    router.refresh();
  }

  async function confirmSituation() {
    if (!situationTarget) {
      return;
    }

    setSituationPending(true);
    setSituationError(null);
    const result = await setProductSituation({ expectedUpdatedAt: header.updatedAt, id: header.id, situation: situationTarget });
    setSituationPending(false);

    if (!result.ok) {
      setSituationError(result.error);
      return;
    }

    applyHeader(result.data.header);
    adminToast.success(situationTarget === "archived" ? "Produto arquivado" : "Produto voltou para rascunho");
    setSituationTarget(null);
    router.refresh();
  }

  function openSituation(target: SituationTarget) {
    setSituationError(null);
    setSituationTarget(target);
  }

  const situationItems: { label: string; onSelect: () => void }[] = [];

  if (header.situation !== "published") {
    situationItems.push({ label: "Publicar…", onSelect: () => void openPublish() });
  }

  if (header.situation !== "draft") {
    situationItems.push({ label: "Voltar para rascunho", onSelect: () => openSituation("draft") });
  }

  if (header.situation !== "archived") {
    situationItems.push({ label: "Arquivar", onSelect: () => openSituation("archived") });
  }

  return (
    <>
      <div
        className={cn(
          "z-[12] -mx-[clamp(16px,3vw,32px)] -mt-2 bg-[var(--surface-0)] px-[clamp(16px,3vw,32px)] pt-4",
          "md:sticky md:top-14 md:-mt-6"
        )}
      >
        <AdminBreadcrumb
          items={[
            { href: "/admin/produtos", label: "Produtos" },
            ...(header.parentFormation ? [{ href: `/admin/produtos/${header.parentFormation.id}`, label: header.parentFormation.title }] : []),
            { label: header.title }
          ]}
        />

        <div className="mt-2 mb-3 flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-[1_1_280px] items-center gap-3">
            <ProductThumb accent={header.accent} coverUrl={header.coverUrl} size="xs" title={header.title} />
            <div className="min-w-0 flex-1">
              {capabilities.canWrite ? (
                <input
                  aria-busy={renaming || undefined}
                  aria-describedby={titleError ? "produto-nome-erro" : undefined}
                  aria-invalid={titleError ? true : undefined}
                  aria-label="Nome do produto"
                  autoComplete="off"
                  className={cn(
                    "-ml-2 block h-9 w-[calc(100%+0.5rem)] min-w-0 truncate rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-2xl leading-[30px] font-semibold tracking-[-0.015em] text-[var(--text-primary)]",
                    "hover:border-[var(--border-strong)] focus-visible:border-[var(--text-primary)] focus-visible:bg-[var(--surface-1)] focus-visible:outline-none aria-invalid:border-[var(--error)]",
                    adminTransition
                  )}
                  maxLength={80}
                  onBlur={() => void commitTitle()}
                  onChange={(event) => {
                    setTitleDraft(event.target.value);
                    if (titleError) {
                      setTitleError(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      skipCommit.current = true;
                      setTitleDraft(null);
                      setTitleError(null);
                      event.currentTarget.blur();
                    }
                  }}
                  title="Clique para renomear. Enter salva, Esc desfaz."
                  value={titleValue}
                />
              ) : (
                <h1 className="truncate text-2xl leading-[30px] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">{header.title}</h1>
              )}
              {titleError ? (
                <p className="mt-1 text-[13px] leading-5 text-[var(--error)]" id="produto-nome-erro" role="alert">
                  {titleError}
                </p>
              ) : (
                <p className="sr-only">{header.formatLabel}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {capabilities.canPublish ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Situação: ${header.situationLabel}. Mudar situação`}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-white/[0.06] px-2.5 text-[13px] font-medium whitespace-nowrap text-[var(--text-primary)]",
                    "hover:border-[var(--border-strong)] hover:bg-[var(--press-overlay)] data-popup-open:border-[var(--border-strong)] pointer-coarse:h-11",
                    adminTransition
                  )}
                >
                  <span aria-hidden="true" className={cn("size-1.5 rounded-full", situationDot[header.situation])} />
                  {header.situationLabel}
                  <ChevronDown aria-hidden="true" className="size-4 text-[var(--text-secondary)]" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={menuContentClass} sideOffset={6}>
                  {situationItems.map((item) => (
                    <DropdownMenuItem className={menuItemClass} key={item.label} onClick={item.onSelect}>
                      {item.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <StatusChip className="h-8 px-2.5 text-[13px]" tone={situationTone(header.situation)}>
                {header.situationLabel}
              </StatusChip>
            )}

            <StudentPreviewButton
              blockedReason={studentPreviewBlockedReason({ productPublished: header.situation === "published" })}
              href={header.studentPreviewHref}
            />

            {showPublishButton ? (
              <Button className="px-3.5" onClick={() => void openPublish()} type="button">
                Publicar
              </Button>
            ) : null}

            {showMoreMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="Mais ações do produto"
                  className={cn(
                    "grid size-8 place-items-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--press-overlay)] hover:text-[var(--text-primary)] data-popup-open:bg-[var(--surface-2)] pointer-coarse:size-11",
                    adminTransition
                  )}
                >
                  <Ellipsis aria-hidden="true" className="size-5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className={menuContentClass} sideOffset={6}>
                  {capabilities.canPublish && header.situation !== "archived" ? (
                    <DropdownMenuItem className={menuItemClass} onClick={() => openSituation("archived")}>
                      Arquivar
                    </DropdownMenuItem>
                  ) : null}
                  {capabilities.canPublish && header.situation !== "archived" && capabilities.canDelete ? (
                    <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
                  ) : null}
                  {capabilities.canDelete ? (
                    <DropdownMenuItem className={menuItemClass} onClick={() => setDeleteOpen(true)} variant="destructive">
                      Excluir produto…
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>

        {tabs.length > 1 ? <SectionTabs ariaLabel="Seções do produto" items={tabs} preserveParams={PRESERVED_TAB_PARAMS} /> : null}
      </div>

      {headerError ? (
        <ErrorBanner
          action={
            <>
              {headerError.status === 409 ? (
                <Button
                  className="px-3"
                  onClick={() => {
                    setHeaderError(null);
                    setTitleDraft(null);
                    router.refresh();
                  }}
                  type="button"
                  variant="secondary"
                >
                  Recarregar
                </Button>
              ) : null}
              <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setHeaderError(null)} type="button" variant="ghost">
                Fechar
              </Button>
            </>
          }
        >
          {headerError.message}
        </ErrorBanner>
      ) : null}

      <PublishDialog
        onOpenChange={(open) => {
          if (!open) {
            setPublish({ phase: "closed" });
          }
        }}
        onPublish={() => void confirmPublish()}
        onReload={() => {
          setPublish({ phase: "closed" });
          router.refresh();
        }}
        productId={header.id}
        productTitle={header.title}
        state={publish}
      />

      <SituationDialog
        error={situationError}
        onConfirm={() => void confirmSituation()}
        onOpenChange={(open) => {
          if (!open) {
            setSituationTarget(null);
          }
        }}
        pending={situationPending}
        productTitle={header.title}
        target={situationTarget}
      />

      {capabilities.canDelete ? (
        <DeleteProductDialog
          onDeleted={() => {
            const title = header.title;
            setDeleteOpen(false);
            adminToast.success(`“${title}” foi excluído`);
            router.push("/admin/produtos");
          }}
          onOpenChange={setDeleteOpen}
          open={deleteOpen}
          productId={header.id}
          productTitle={header.title}
        />
      ) : null}
    </>
  );
}
