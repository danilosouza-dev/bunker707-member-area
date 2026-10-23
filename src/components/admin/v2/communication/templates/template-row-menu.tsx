"use client";

import { Copy, Pencil, Play, TextCursorInput, Trash2, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { deleteTemplate, duplicateTemplate, renameTemplate } from "@/server/communications/template-actions";
import { templateErrorsFromAction } from "@/server/communications/template-model";
import { ErrorBanner } from "../../error-banner";
import { ConfirmDialog, RowMenu } from "../../settings/kit";
import { adminToast } from "../../toast";
import { TemplateNameDialog } from "./template-name-dialog";
import {
  TEMPLATE_COPY,
  TEMPLATE_MENU_ENTRIES,
  deleteTemplateDescription,
  noticeFromTemplateHref,
  templateEditHref,
  templateFailureCopy,
  templateMenuLabel,
  type TemplateMenuAction
} from "./templates-view-model";

// Acoes de um modelo na aba Modelos (docs/28; spec §5.2): Usar (abre o aviso novo preenchido, nada e salvo), Editar,
// Renomear (dialogo do nome), Duplicar e Excluir (com confirmacao). O modelo que nao abre so tem Renomear e
// Excluir. Cada acao leva a versao lida (updatedAt): se o modelo mudou em outra tela, volta 409 e o banner acima da
// tabela diz "Este modelo mudou em outra tela" com "Recarregar". Sucesso vira toast e a lista atualiza com
// router.refresh numa transicao (as acoes de modelo nunca chamam revalidatePath, D28).
// Foco: depois de renomear volta ao "…" da linha; depois de excluir, a tabela leva ao nome da linha seguinte.

export type TemplateActionTarget = { id: string; name: string; readable: boolean; updatedAt: string };

type Failure = { message: string; status: number };

const ACTION_ICONS: Record<TemplateMenuAction, LucideIcon> = {
  delete: Trash2,
  duplicate: Copy,
  edit: Pencil,
  rename: TextCursorInput,
  use: Play
};

/** O "…" de uma linha (o dialogo de nome devolve o foco a ele). */
export function templateMenuTrigger(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-template-menu="${CSS.escape(id)}"] button`);
}

type UseTemplateActionsOptions = {
  /** Depois de excluir (a tabela guarda para onde o foco vai quando a lista nova chegar). */
  onDeleted?: (id: string) => void;
};

/**
 * Executa as acoes de modelo. Devolve `request`, os dialogos (confirmar a exclusao e o nome) e o banner de erro para a
 * tela posicionar, e `busyKey` ("{id}:{acao}") enquanto uma acao roda.
 */
export function useTemplateActions({ onDeleted }: UseTemplateActionsOptions = {}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<TemplateActionTarget | null>(null);
  const [renaming, setRenaming] = useState<TemplateActionTarget | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  // O ultimo modelo renomeado: o foco volta ao "…" dele mesmo depois que o dialogo ja limpou o alvo.
  const renamedId = useRef<string | null>(null);

  function fail(result: Extract<ActionResult<unknown>, { ok: false }>) {
    setFailure({ message: result.error, status: result.status });
  }

  // A lista e buscada de novo numa transicao, que nao segura o toast nem o fechar do dialogo.
  function refreshInBackground() {
    startTransition(() => router.refresh());
  }

  async function duplicate(target: TemplateActionTarget) {
    const key = `${target.id}:duplicate`;

    setBusyKey(key);
    setFailure(null);

    try {
      const result = await duplicateTemplate({ expectedUpdatedAt: target.updatedAt, id: target.id });

      if (!result.ok) {
        return fail(result);
      }

      adminToast.success(TEMPLATE_COPY.toasts.duplicated);
      refreshInBackground();
    } finally {
      setBusyKey((current) => (current === key ? null : current));
    }
  }

  async function remove(target: TemplateActionTarget) {
    const key = `${target.id}:delete`;

    setBusyKey(key);
    setFailure(null);

    try {
      const result = await deleteTemplate({ expectedUpdatedAt: target.updatedAt, id: target.id });

      if (!result.ok) {
        return fail(result);
      }

      adminToast.success(TEMPLATE_COPY.toasts.deleted);
      onDeleted?.(target.id);
      refreshInBackground();
    } finally {
      setBusyKey((current) => (current === key ? null : current));
      setConfirming((current) => (current?.id === target.id ? null : current));
    }
  }

  async function rename(target: TemplateActionTarget, name: string): Promise<{ ok: true } | { fieldError?: string; message: string; ok: false; status: number }> {
    setFailure(null);

    const result = await renameTemplate({ expectedUpdatedAt: target.updatedAt, id: target.id, name });

    if (result.ok) {
      adminToast.success(TEMPLATE_COPY.toasts.renamed);
      refreshInBackground();
      return { ok: true };
    }

    // Mudou ou sumiu em outra tela: o dialogo fecha e o banner da lista oferece "Recarregar".
    if (result.status === 409 || result.status === 404) {
      setRenaming(null);
      fail(result);
    }

    return { fieldError: templateErrorsFromAction(result.fieldErrors).name, message: result.error, ok: false, status: result.status };
  }

  function request(action: TemplateMenuAction, target: TemplateActionTarget) {
    switch (action) {
      case "use":
        router.push(noticeFromTemplateHref(target.id));
        return;
      case "edit":
        router.push(templateEditHref(target.id));
        return;
      case "rename":
        setFailure(null);
        renamedId.current = target.id;
        setRenaming(target);
        return;
      case "duplicate":
        void duplicate(target);
        return;
      case "delete":
        setFailure(null);
        setConfirming(target);
        return;
    }
  }

  const confirmDialog = (
    <ConfirmDialog
      busy={confirming !== null && busyKey === `${confirming.id}:delete`}
      confirmLabel={TEMPLATE_COPY.remove.confirm}
      description={confirming ? deleteTemplateDescription(confirming.name) : undefined}
      destructive
      onConfirm={() => {
        if (confirming) {
          void remove(confirming);
        }
      }}
      onOpenChange={(open) => {
        if (!open) {
          setConfirming(null);
        }
      }}
      open={confirming !== null}
      title={TEMPLATE_COPY.remove.title}
    />
  );

  const nameDialog = (
    <TemplateNameDialog
      confirmLabel={TEMPLATE_COPY.rename.confirm}
      defaultName={renaming?.name ?? ""}
      finalFocus={() => (renamedId.current ? templateMenuTrigger(renamedId.current) : null)}
      onOpenChange={(open) => {
        if (!open) {
          setRenaming(null);
        }
      }}
      onSubmit={(name) => (renaming ? rename(renaming, name) : Promise.resolve({ ok: true as const }))}
      open={renaming !== null}
      title={TEMPLATE_COPY.rename.title}
    />
  );

  const copy = failure ? templateFailureCopy(failure) : null;
  const errorBanner: ReactNode =
    failure && copy ? (
      <ErrorBanner
        action={
          copy.reload ? (
            <Button
              className="px-3"
              onClick={() => {
                setFailure(null);
                router.refresh();
              }}
              type="button"
              variant="secondary"
            >
              {TEMPLATE_COPY.errors.reload}
            </Button>
          ) : (
            <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
              {TEMPLATE_COPY.errors.close}
            </Button>
          )
        }
        title={copy.title}
      >
        {copy.message}
      </ErrorBanner>
    ) : null;

  return { busyKey, confirmDialog, errorBanner, nameDialog, request };
}

type TemplateRowMenuProps = {
  onRequest: (action: TemplateMenuAction, target: TemplateActionTarget) => void;
  template: TemplateActionTarget;
};

/** Menu "…" de um modelo ("Ações de {nome}"). */
export function TemplateRowMenu({ onRequest, template }: TemplateRowMenuProps) {
  return (
    <span className="flex" data-template-menu={template.id}>
      <RowMenu
        actions={TEMPLATE_MENU_ENTRIES(template.readable).map((entry) => {
          const Icon = ACTION_ICONS[entry.action];

          return {
            destructive: entry.destructive,
            icon: <Icon aria-hidden="true" className="size-4" />,
            label: entry.label,
            onSelect: () => onRequest(entry.action, template),
            separated: entry.separated
          };
        })}
        label={templateMenuLabel(template.name)}
      />
    </span>
  );
}
