"use client";

import { CircleCheck, CircleX, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { deleteProduct } from "@/server/catalog/product-actions";
import type { PublishChecklist, PublishChecklistItem } from "@/server/catalog/model";
import { ErrorBanner } from "../error-banner";
import { AdminField, adminInputClass, fieldDescribedBy } from "../form";
import { ProductDialog } from "./dialog-frame";

/* ------------------------------------------------------------------------------------------------
 * Publicar com checklist (docs/17 §1.6.6)
 * ---------------------------------------------------------------------------------------------- */

export type PublishDialogState =
  | { phase: "closed" }
  | { phase: "loading" }
  | { error: string; phase: "load_error" }
  | { checklist: PublishChecklist; error?: string; phase: "ready" | "publishing"; status?: number };

const stateIcons = {
  blocker: { className: "text-[var(--error)]", Icon: CircleX, label: "Precisa resolver" },
  ok: { className: "text-[var(--success)]", Icon: CircleCheck, label: "Pronto" },
  warning: { className: "text-[var(--warning)]", Icon: TriangleAlert, label: "Aviso" }
} as const;

function fixHrefFor(productId: string, item: PublishChecklistItem) {
  const base = `/admin/produtos/${productId}`;

  switch (item.id) {
    case "cover":
      return `${base}/detalhes`;
    case "lessons":
    case "videos":
      return base;
    default:
      return `${base}/acesso`;
  }
}

type PublishDialogProps = {
  onOpenChange: (open: boolean) => void;
  onPublish: () => void;
  onReload: () => void;
  productId: string;
  productTitle: string;
  state: PublishDialogState;
};

export function PublishDialog({ onOpenChange, onPublish, onReload, productId, productTitle, state }: PublishDialogProps) {
  const open = state.phase !== "closed";
  const publishing = state.phase === "publishing";
  const checklist = state.phase === "ready" || state.phase === "publishing" ? state.checklist : null;
  const hasBlocker = checklist?.items.some((item) => item.state === "blocker") ?? false;

  return (
    <ProductDialog
      description={
        hasBlocker
          ? "Resolva os itens em vermelho. Os avisos não impedem a publicação."
          : "Depois de publicar, quem pode ver encontra o produto na área do aluno."
      }
      footer={
        <>
          <Button className="px-4" disabled={publishing} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button className="px-4" disabled={publishing || state.phase === "loading"} onClick={onPublish} type="button">
            {publishing ? "Publicando…" : "Publicar agora"}
          </Button>
        </>
      }
      onOpenChange={(next) => {
        if (!publishing) {
          onOpenChange(next);
        }
      }}
      open={open}
      title={`Publicar “${productTitle}”`}
    >
      {state.phase === "loading" ? (
        <p className="flex items-center gap-2 py-4 text-sm text-[var(--text-secondary)]" role="status">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          Conferindo o produto…
        </p>
      ) : null}

      {state.phase === "load_error" ? <ErrorBanner>{state.error}</ErrorBanner> : null}

      {checklist ? (
        <div className="flex flex-col gap-3">
          {state.phase === "ready" && state.error ? (
            <ErrorBanner
              action={
                state.status === 409 ? (
                  <Button className="px-3" onClick={onReload} type="button" variant="secondary">
                    Recarregar
                  </Button>
                ) : null
              }
            >
              {state.error}
            </ErrorBanner>
          ) : null}
          <ul aria-label="O que conferimos antes de publicar" className="flex flex-col divide-y divide-[var(--border-subtle)]">
            {checklist.items.map((item) => {
              const { className, Icon, label } = stateIcons[item.state];

              return (
                <li className="flex items-start gap-3 py-3" key={item.id}>
                  <Icon aria-label={label} className={cn("mt-0.5 size-4 shrink-0", className)} role="img" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm leading-5 font-medium text-[var(--text-primary)]">{item.label}</p>
                    {item.detail ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{item.detail}</p> : null}
                  </div>
                  {item.state !== "ok" ? (
                    <Link
                      className="shrink-0 rounded-md text-[13px] leading-5 font-medium text-[var(--text-primary)] underline-offset-4 hover:underline"
                      href={fixHrefFor(productId, item)}
                      onClick={() => onOpenChange(false)}
                    >
                      Resolver
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </ProductDialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Voltar para rascunho / Arquivar: a confirmacao diz o que acontece com o aluno
 * ---------------------------------------------------------------------------------------------- */

export type SituationTarget = "draft" | "archived";

const situationCopy: Record<SituationTarget, { confirm: string; description: string; title: (name: string) => string }> = {
  archived: {
    confirm: "Arquivar produto",
    description:
      "Ele sai da área do aluno e da vitrine, inclusive para quem já tem acesso. Aulas, alunos e comentários continuam guardados; você pode publicar de novo quando quiser.",
    title: (name) => `Arquivar “${name}”?`
  },
  draft: {
    confirm: "Voltar para rascunho",
    description:
      "Ele some da área do aluno, inclusive para quem já tem acesso, até você publicar de novo. Nada é apagado.",
    title: (name) => `Voltar “${name}” para rascunho?`
  }
};

type SituationDialogProps = {
  error?: string | null;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  productTitle: string;
  target: SituationTarget | null;
};

export function SituationDialog({ error, onConfirm, onOpenChange, pending, productTitle, target }: SituationDialogProps) {
  const copy = situationCopy[target ?? "archived"];

  return (
    <ProductDialog
      description={copy.description}
      footer={
        <>
          <Button className="px-4" disabled={pending} onClick={() => onOpenChange(false)} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button className="px-4" disabled={pending} onClick={onConfirm} type="button">
            {pending ? "Salvando…" : copy.confirm}
          </Button>
        </>
      }
      onOpenChange={(next) => {
        if (!pending) {
          onOpenChange(next);
        }
      }}
      open={target !== null}
      title={copy.title(productTitle)}
    >
      {error ? <ErrorBanner>{error}</ErrorBanner> : null}
    </ProductDialog>
  );
}

/* ------------------------------------------------------------------------------------------------
 * Excluir: digitar o nome, botao destrutivo
 * ---------------------------------------------------------------------------------------------- */

type DeleteProductDialogProps = {
  onDeleted: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  productId: string;
  productTitle: string;
};

function sameName(left: string, right: string) {
  return left.trim().toLocaleLowerCase("pt-BR") === right.trim().toLocaleLowerCase("pt-BR");
}

export function DeleteProductDialog({ onDeleted, onOpenChange, open, productId, productTitle }: DeleteProductDialogProps) {
  const [confirmTitle, setConfirmTitle] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fieldId = "excluir-produto-nome";

  function handleOpenChange(next: boolean) {
    if (pending) {
      return;
    }

    if (!next) {
      setConfirmTitle("");
      setFieldError(null);
      setError(null);
    }

    onOpenChange(next);
  }

  async function handleDelete() {
    if (!sameName(confirmTitle, productTitle)) {
      setFieldError(`Digite “${productTitle}” para confirmar.`);
      return;
    }

    setPending(true);
    setError(null);
    const result = await deleteProduct({ confirmTitle: confirmTitle.trim(), id: productId });
    setPending(false);

    if (!result.ok) {
      if (result.fieldErrors?.confirmTitle?.[0] || result.status === 422) {
        setFieldError(result.fieldErrors?.confirmTitle?.[0] ?? result.error);
      } else {
        setError(result.error);
      }

      return;
    }

    setConfirmTitle("");
    onDeleted();
  }

  return (
    <ProductDialog
      description="Módulos, aulas e os acessos ligados a ele são apagados. Isso não pode ser desfeito. Para só tirar da área do aluno, use Arquivar."
      footer={
        <>
          <Button className="px-4" disabled={pending} onClick={() => handleOpenChange(false)} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button className="px-4" disabled={pending} onClick={() => void handleDelete()} type="button" variant="destructive">
            {pending ? "Excluindo…" : "Excluir produto"}
          </Button>
        </>
      }
      onOpenChange={handleOpenChange}
      open={open}
      title={`Excluir “${productTitle}” para sempre?`}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleDelete();
        }}
      >
        {error ? <ErrorBanner>{error}</ErrorBanner> : null}
        <AdminField error={fieldError} id={fieldId} label={<>Digite <strong className="font-semibold">{productTitle}</strong> para confirmar</>}>
          <Input
            aria-describedby={fieldDescribedBy(fieldId, { error: fieldError })}
            aria-invalid={fieldError ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            disabled={pending}
            id={fieldId}
            onChange={(event) => {
              setConfirmTitle(event.target.value);
              if (fieldError) {
                setFieldError(null);
              }
            }}
            value={confirmTitle}
          />
        </AdminField>
      </form>
    </ProductDialog>
  );
}
