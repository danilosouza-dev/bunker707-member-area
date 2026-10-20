"use client";

import {
  BellOff,
  CalendarX,
  CircleCheck,
  CircleStop,
  Copy,
  Pause,
  Pencil,
  Play,
  Send,
  Trash2,
  Undo2,
  type LucideIcon
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import {
  approveNotice,
  cancelScheduledNotice,
  deleteNotice,
  duplicateNotice,
  endNotice,
  pauseNotice,
  rejectNotice,
  resumeNotice,
  sendNoticeTestToMe,
  withdrawNotice
} from "@/server/communications/actions";
import type { CampaignKind, CampaignStatus, NoticeAction } from "@/server/communications/campaign-model";
import { ErrorBanner } from "../error-banner";
import { ConfirmDialog, RowMenu } from "../settings/kit";
import { adminToast } from "../toast";
import {
  NOTICE_ACTION_TOASTS,
  isLivePopupStatus,
  noticeActionConfirm,
  noticeActionNeedsConfirm,
  noticeHref,
  noticeMenuEntries,
  publishedNoticeToast
} from "./notices-view-model";

// Acoes de um aviso (docs/22 §2; docs/17 §1.8 "Pausar, Duplicar, Encerrar"), as mesmas na lista, no
// editor e no relatorio: o menu "…" mostra so o que a situacao permite (availableNoticeActions, o
// servidor confere de novo), Retirar do sino, Encerrar, Excluir, Aprovar e Recusar pedem confirmacao
// (ConfirmDialog, nunca window.confirm), sucesso vira toast e erro fica num banner na tela. Cada acao
// leva a versao lida (updatedAt): se o aviso mudou em outra tela, volta 409 e o banner oferece
// "Recarregar". Pausar tem "Desfazer" no toast.

export type NoticeActionTarget = {
  actions: readonly NoticeAction[];
  audienceCount: number | null;
  id: string;
  kind: CampaignKind;
  /** Notificacao enviada: quantos receberam (texto do "Retirar do sino"). */
  recipients?: number | null;
  status: CampaignStatus;
  title: string;
  updatedAt: string;
};

type Failure = { message: string; status: number };

const ACTION_ICONS: Partial<Record<NoticeAction, LucideIcon>> = {
  approve: CircleCheck,
  cancel_schedule: CalendarX,
  delete: Trash2,
  duplicate: Copy,
  edit: Pencil,
  end: CircleStop,
  pause: Pause,
  reject: Undo2,
  resume: Play,
  send_test: Send,
  withdraw: BellOff
};

export function NoticeActionIcon({ action, className = "size-4" }: { action: NoticeAction; className?: string }) {
  const Icon = ACTION_ICONS[action];

  return Icon ? <Icon aria-hidden="true" className={className} /> : null;
}

type UseNoticeActionsOptions = {
  /** Depois de excluir (o relatorio volta para a lista; a lista so atualiza). */
  onDeleted?: () => void;
};

/**
 * Executa as acoes de aviso. Devolve `request` (abre a confirmacao quando precisa), o dialogo e o
 * banner de erro para a tela posicionar, e `busyKey` ("{id}:{acao}") enquanto uma acao roda.
 */
export function useNoticeActions({ onDeleted }: UseNoticeActionsOptions = {}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<{ action: NoticeAction; notice: NoticeActionTarget } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  function fail(result: Extract<ActionResult<unknown>, { ok: false }>) {
    setFailure({ message: result.error, status: result.status });
  }

  async function execute(action: NoticeAction, notice: NoticeActionTarget) {
    const input = { expectedUpdatedAt: notice.updatedAt, id: notice.id };
    const key = `${notice.id}:${action}`;

    setBusyKey(key);
    setFailure(null);

    try {
      switch (action) {
        case "approve": {
          const result = await approveNotice(input);

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(publishedNoticeToast(result.data, notice.kind));
          return;
        }
        case "pause": {
          const result = await pauseNotice(input);

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(NOTICE_ACTION_TOASTS.pause ?? "", {
            onUndo: () => void execute("resume", { ...notice, status: "paused", updatedAt: result.data.updatedAt })
          });
          return;
        }
        case "duplicate": {
          const result = await duplicateNotice(input);

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(NOTICE_ACTION_TOASTS.duplicate ?? "");
          router.push(noticeHref(result.data.id));
          return;
        }
        case "delete": {
          const result = await deleteNotice(input);

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(NOTICE_ACTION_TOASTS.delete ?? "");
          onDeleted?.();
          return;
        }
        default: {
          const run = SIMPLE_ACTIONS[action];

          if (!run) {
            return;
          }

          const result = await run(input);

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(NOTICE_ACTION_TOASTS[action] ?? "");
        }
      }
    } finally {
      setBusyKey((current) => (current === key ? null : current));
      setConfirming((current) => (current?.action === action && current.notice.id === notice.id ? null : current));
    }
  }

  function request(action: NoticeAction, notice: NoticeActionTarget) {
    if (action === "edit") {
      router.push(noticeHref(notice.id, { edit: isLivePopupStatus(notice.kind, notice.status) }));
      return;
    }

    if (noticeActionNeedsConfirm(action)) {
      setFailure(null);
      setConfirming({ action, notice });
      return;
    }

    void execute(action, notice);
  }

  const copy = confirming ? noticeActionConfirm(confirming.action, confirming.notice) : null;
  const conflict = failure?.status === 409;

  const confirmDialog = (
    <ConfirmDialog
      busy={confirming !== null && busyKey === `${confirming.notice.id}:${confirming.action}`}
      confirmLabel={copy?.confirmLabel ?? "Confirmar"}
      description={copy?.description}
      destructive={copy?.destructive}
      onConfirm={() => {
        if (confirming) {
          void execute(confirming.action, confirming.notice);
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
      title={conflict ? "Este aviso mudou em outra tela" : "Não foi possível concluir"}
    >
      {failure.message}
    </ErrorBanner>
  ) : null;

  return { busyKey, confirmDialog, errorBanner, request };
}

type SimpleAction = (input: { expectedUpdatedAt?: string; id: string }) => Promise<ActionResult<unknown>>;

/** Acoes sem passo extra depois do sucesso (so o toast). */
const SIMPLE_ACTIONS: Partial<Record<NoticeAction, SimpleAction>> = {
  cancel_schedule: cancelScheduledNotice,
  reject: rejectNotice,
  resume: resumeNotice,
  send_test: sendNoticeTestToMe,
  end: endNotice,
  withdraw: withdrawNotice
};

type NoticeRowMenuProps = {
  /** Acoes que a tela ja mostra como botao (ficam fora do menu). */
  exclude?: readonly NoticeAction[];
  notice: NoticeActionTarget;
  onRequest: (action: NoticeAction, notice: NoticeActionTarget) => void;
};

/** Menu "…" de um aviso. Sem nenhuma acao disponivel, nao aparece. */
export function NoticeRowMenu({ exclude, notice, onRequest }: NoticeRowMenuProps) {
  const entries = noticeMenuEntries(notice.actions, exclude);

  return (
    <RowMenu
      actions={entries.map((entry) => ({
        destructive: entry.destructive,
        icon: <NoticeActionIcon action={entry.action} />,
        label: entry.label,
        onSelect: () => onRequest(entry.action, notice),
        separated: entry.separated
      }))}
      label={`Ações de ${notice.title}`}
    />
  );
}
