"use client";

import { BellRing, CircleCheck, CircleStop, Copy, Pause, Pencil, Play, Trash2, Undo2, Zap, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { activateFlow, approveFlow, deleteFlow, duplicateFlow, endFlow, pauseFlow, rejectFlow, resumeFlow } from "@/server/communications/flow-actions";
import type { FlowEntryMode, FlowOrigin, FlowStatus } from "@/server/communications/flow-model";
import { ErrorBanner } from "../../error-banner";
import { ConfirmDialog, RowMenu } from "../../settings/kit";
import { adminToast } from "../../toast";
import {
  FLOW_CHANGED_TITLE,
  FLOW_TOASTS,
  flowActionConfirm,
  flowActionNeedsConfirm,
  flowHref,
  flowMenuEntries,
  sourceNoticeHref,
  type FlowAction
} from "./flows-view-model";

// Acoes de um fluxo (docs/23 §2.4 e §2.6), as mesmas na lista, no construtor e no relatorio: o menu "…"
// mostra so o que a situacao permite (availableFlowActions; o servidor confere de novo). Pausar, encerrar,
// excluir, ativar, aprovar e recusar perguntam antes (ConfirmDialog, nunca window.confirm); sucesso vira
// toast e erro fica num banner na tela. Cada acao leva a versao lida (updatedAt): se o fluxo mudou em
// outra tela, volta 409 e o banner oferece "Recarregar". Pausar tem "Desfazer" no toast.

export type FlowActionTarget = {
  actions: readonly FlowAction[];
  entryCount: number | null;
  entryMode: FlowEntryMode;
  id: string;
  name: string;
  origin: FlowOrigin;
  sourceId: string | null;
  status: FlowStatus;
  updatedAt: string;
};

type Failure = { message: string; status: number };

const ACTION_ICONS: Record<FlowAction, LucideIcon> = {
  activate: Zap,
  approve: CircleCheck,
  delete: Trash2,
  duplicate: Copy,
  edit: Pencil,
  end: CircleStop,
  open_notice: BellRing,
  pause: Pause,
  reject: Undo2,
  resume: Play
};

export function FlowActionIcon({ action, className = "size-4" }: { action: FlowAction; className?: string }) {
  const Icon = ACTION_ICONS[action];

  return <Icon aria-hidden="true" className={className} />;
}

type StateAction = (input: { expectedUpdatedAt: string; id: string }) => Promise<ActionResult<{ situation: FlowStatus; updatedAt: string }>>;

const STATE_ACTIONS: Partial<Record<FlowAction, StateAction>> = {
  activate: activateFlow,
  approve: approveFlow,
  end: endFlow,
  pause: pauseFlow,
  reject: rejectFlow,
  resume: resumeFlow
};

const STATE_TOASTS: Partial<Record<FlowAction, string>> = {
  approve: FLOW_TOASTS.activated,
  end: FLOW_TOASTS.ended,
  reject: FLOW_TOASTS.rejected,
  resume: FLOW_TOASTS.resumed
};

type UseFlowActionsOptions = {
  /** Depois de excluir (o relatorio volta para a lista; a lista so atualiza). */
  onDeleted?: () => void;
};

/**
 * Executa as acoes de fluxo. Devolve `request` (abre a confirmacao quando precisa), o dialogo e o banner de
 * erro para a tela posicionar, e `busyKey` ("{id}:{acao}") enquanto uma acao roda.
 */
export function useFlowActions({ onDeleted }: UseFlowActionsOptions = {}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<{ action: FlowAction; flow: FlowActionTarget } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  function fail(result: Extract<ActionResult<unknown>, { ok: false }>) {
    setFailure({ message: result.error, status: result.status });
  }

  async function execute(action: FlowAction, flow: FlowActionTarget) {
    const input = { expectedUpdatedAt: flow.updatedAt, id: flow.id };
    const key = `${flow.id}:${action}`;

    setBusyKey(key);
    setFailure(null);

    try {
      if (action === "duplicate") {
        const result = await duplicateFlow(input);

        if (!result.ok) {
          return fail(result);
        }

        adminToast.success(FLOW_TOASTS.duplicated);
        router.push(flowHref(result.data.id));
        return;
      }

      if (action === "delete") {
        const result = await deleteFlow(input);

        if (!result.ok) {
          return fail(result);
        }

        adminToast.success(FLOW_TOASTS.deleted);

        if (onDeleted) {
          onDeleted();
        } else {
          router.refresh();
        }

        return;
      }

      const run = STATE_ACTIONS[action];

      if (!run) {
        return;
      }

      const result = await run(input);

      if (!result.ok) {
        return fail(result);
      }

      if (action === "pause") {
        adminToast.success(FLOW_TOASTS.paused, {
          onUndo: () => void execute("resume", { ...flow, status: "paused", updatedAt: result.data.updatedAt })
        });
      } else if (action === "activate") {
        adminToast.success(result.data.situation === "pending_approval" ? FLOW_TOASTS.approvalRequested : FLOW_TOASTS.activated);
      } else {
        adminToast.success(STATE_TOASTS[action] ?? "");
      }

      router.refresh();
    } finally {
      setBusyKey((current) => (current === key ? null : current));
      setConfirming((current) => (current?.action === action && current.flow.id === flow.id ? null : current));
    }
  }

  function request(action: FlowAction, flow: FlowActionTarget) {
    if (action === "edit") {
      router.push(flowHref(flow.id, { edit: flow.status === "active" || flow.status === "paused" }));
      return;
    }

    if (action === "open_notice") {
      if (flow.sourceId) {
        router.push(sourceNoticeHref(flow.sourceId));
      }

      return;
    }

    if (flowActionNeedsConfirm(action)) {
      setFailure(null);
      setConfirming({ action, flow });
      return;
    }

    void execute(action, flow);
  }

  const copy = confirming ? flowActionConfirm(confirming.action, confirming.flow) : null;
  const conflict = failure?.status === 409;

  const confirmDialog = (
    <ConfirmDialog
      busy={confirming !== null && busyKey === `${confirming.flow.id}:${confirming.action}`}
      confirmLabel={copy?.confirmLabel ?? "Confirmar"}
      description={copy?.description}
      destructive={copy?.destructive}
      onConfirm={() => {
        if (confirming) {
          void execute(confirming.action, confirming.flow);
        }
      }}
      onOpenChange={(open) => {
        if (!open) {
          setConfirming(null);
        }
      }}
      open={confirming !== null}
      title={copy?.title ?? ""}
    />
  );

  const errorBanner: ReactNode = failure ? (
    <ErrorBanner
      action={
        conflict ? (
          <Button
            className="px-3"
            onClick={() => {
              setFailure(null);
              router.refresh();
            }}
            type="button"
            variant="secondary"
          >
            Recarregar
          </Button>
        ) : (
          <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
            Fechar
          </Button>
        )
      }
      title={conflict ? FLOW_CHANGED_TITLE : "Não foi possível concluir"}
    >
      {failure.message}
    </ErrorBanner>
  ) : null;

  return { busyKey, confirmDialog, errorBanner, request };
}

type FlowRowMenuProps = {
  /** Acoes que a tela ja mostra como botao (ficam fora do menu). */
  exclude?: readonly FlowAction[];
  flow: FlowActionTarget;
  onRequest: (action: FlowAction, flow: FlowActionTarget) => void;
};

/** Menu "…" de um fluxo. Sem nenhuma acao disponivel, nao aparece. */
export function FlowRowMenu({ exclude, flow, onRequest }: FlowRowMenuProps) {
  const entries = flowMenuEntries(flow.actions, exclude);

  return (
    <RowMenu
      actions={entries.map((entry) => ({
        destructive: entry.destructive,
        icon: <FlowActionIcon action={entry.action} />,
        label: entry.label,
        onSelect: () => onRequest(entry.action, flow),
        separated: entry.separated
      }))}
      label={`Ações de ${flow.name}`}
    />
  );
}
