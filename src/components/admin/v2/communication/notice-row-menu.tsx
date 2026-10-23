"use client";

import {
  BellOff,
  CalendarX,
  ChartColumn,
  CircleCheck,
  CircleStop,
  Copy,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Send,
  Trash2,
  Undo2,
  type LucideIcon
} from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ActionResult } from "@/lib/action-result";
import {
  approveNotice,
  cancelScheduledNotice,
  deleteNotice,
  duplicateNotice,
  endNotice,
  pauseNotice,
  rejectNotice,
  reshowPopup,
  resumeNotice,
  sendNoticeTestToMe,
  withdrawNotice
} from "@/server/communications/actions";
import type { CampaignKind, CampaignSituation, CampaignStatus, NoticeAction } from "@/server/communications/campaign-model";
import { ErrorBanner } from "../error-banner";
import { ConfirmDialog, RowMenu, type RowMenuAction } from "../settings/kit";
import { adminToast } from "../toast";
import { withdrawFollowUpsLabel } from "./follow-ups-view-model";
import {
  NOTICE_ACTION_TOASTS,
  deleteFollowUpsLabel,
  deletedNoticeToast,
  noticeActionConfirm,
  noticeActionNeedsConfirm,
  noticeEditHref,
  noticeHref,
  noticeMenuEntries,
  publishedNoticeToast,
  reshownPopupToast,
  type NoticeCitationCounts
} from "./notices-view-model";
import { noticeMenuWithExtra } from "./templates/templates-view-model";

// Acoes de um aviso (docs/22 §2; docs/17 §1.8 "Pausar, Duplicar, Encerrar"), as mesmas na lista, no
// editor e no relatorio: o menu "…" mostra so o que a situacao permite (availableNoticeActions, o
// servidor confere de novo), Retirar do sino, Encerrar, Excluir, Aprovar e Recusar pedem confirmacao
// (ConfirmDialog, nunca window.confirm), sucesso vira toast e erro fica num banner na tela. Cada acao
// leva a versao lida (updatedAt): se o aviso mudou em outra tela, volta 409 e o banner oferece
// "Recarregar". Pausar tem "Desfazer" no toast. v2: "Retirar do sino" de uma notificacao com seguintes
// avisa que elas deixam de sair e traz a caixa "Retirar também as notificações seguintes que já saíram (n)",
// marcada (docs/23 §2.2). v3a (docs/24 §2.1): "Ver relatório", Editar a notificacao enviada (?editar=1),
// Excluir pela situacao (a enviada com a caixa "Excluir também as notificações seguintes que já saíram (n)"),
// a frase das regras que citam a notificacao e "Mostrar de novo para quem já viu" no pop-up "Uma vez" (v3b-1:
// em qualquer "Quantas vezes", com o toast pelo `popupMode` do alvo).
// Ajustes da v3a: Excluir e Retirar do sino nao revalidam a pagina na acao (o servidor desenhava a pagina
// inteira de novo na mesma resposta): o dialogo fecha e o toast aparece assim que a acao volta, e a lista
// atualiza logo depois (router.refresh numa transicao; na pagina do aviso, Excluir volta para a lista).
// Modelos (docs/28): `extra` poe "Salvar como modelo" logo depois de "Duplicar" (a lista e o relatorio passam).

export type NoticeActionTarget = {
  actions: readonly NoticeAction[];
  audienceCount: number | null;
  /** v3a: avisos e fluxos que citam a notificacao enviada nas regras (Excluir e Retirar do sino avisam). */
  citations?: NoticeCitationCounts | null;
  /** Notificacoes seguintes (v2): quantas e quantas ja sairam (o "Retirar do sino" oferece retirar essas). */
  followUps?: { count: number; sent: number } | null;
  id: string;
  kind: CampaignKind;
  /**
   * v3b-1: "Quantas vezes" do pop-up (NoticeListItem.popupMode): o toast de "Mostrar de novo" muda em "Mais de
   * uma vez". Sem ele, o texto de "Uma vez".
   */
  popupMode?: "once" | "repeat" | null;
  /** Notificacao enviada: quantos receberam (texto do "Retirar do sino"). */
  recipients?: number | null;
  /** v3a: a situacao de agora (o texto de Excluir muda: pop-up no ar, pausado, notificacao enviada...). */
  situation: CampaignSituation;
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
  reshow: RotateCcw,
  resume: Play,
  send_test: Send,
  view_report: ChartColumn,
  withdraw: BellOff
};

export function NoticeActionIcon({ action, className = "size-4" }: { action: NoticeAction; className?: string }) {
  const Icon = ACTION_ICONS[action];

  return Icon ? <Icon aria-hidden="true" className={className} /> : null;
}

type UseNoticeActionsOptions = {
  /** Depois de excluir (o relatorio volta para a lista); sem ele, a tela atual atualiza (a lista). */
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
  // "Retirar (ou Excluir) também as notificações seguintes que já saíram" (marcada a cada vez que o dialogo abre).
  const [alsoFollowUps, setAlsoFollowUps] = useState(true);
  const [failure, setFailure] = useState<Failure | null>(null);

  function fail(result: Extract<ActionResult<unknown>, { ok: false }>) {
    setFailure({ message: result.error, status: result.status });
  }

  // Fora do caminho do dialogo: a pagina e buscada de novo numa transicao, que nao segura o toast nem o fechar
  // do dialogo (o finally de execute fecha na mesma hora).
  function refreshInBackground() {
    startTransition(() => router.refresh());
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
            onUndo: () => void execute("resume", { ...notice, situation: "paused", status: "paused", updatedAt: result.data.updatedAt })
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
        case "withdraw": {
          const result = await withdrawNotice({ ...input, alsoFollowUps });

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(NOTICE_ACTION_TOASTS.withdraw ?? "");
          refreshInBackground();
          return;
        }
        case "delete": {
          const result = await deleteNotice({ ...input, alsoFollowUps });

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(deletedNoticeToast({ kind: notice.kind, removed: result.data.removed, situation: notice.situation }));

          // A pagina do aviso volta para a lista (que chega nova: a pagina e dinamica); a lista so atualiza.
          if (onDeleted) {
            onDeleted();
          } else {
            refreshInBackground();
          }

          return;
        }
        case "reshow": {
          const result = await reshowPopup(input);

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(reshownPopupToast(result.data.reshown, notice.popupMode ?? "once"));
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
    if (action === "view_report") {
      router.push(noticeHref(notice.id));
      return;
    }

    if (action === "edit") {
      router.push(noticeEditHref(notice));
      return;
    }

    if (noticeActionNeedsConfirm(action)) {
      setFailure(null);
      setAlsoFollowUps(true);
      setConfirming({ action, notice });
      return;
    }

    void execute(action, notice);
  }

  const copy = confirming ? noticeActionConfirm(confirming.action, confirming.notice) : null;
  const conflict = failure?.status === 409;
  // A caixa das seguintes que ja sairam: Retirar do sino e Excluir a notificacao enviada.
  const sentFollowUps =
    confirming?.action === "withdraw" || (confirming?.action === "delete" && confirming.notice.situation === "sent")
      ? (confirming.notice.followUps?.sent ?? 0)
      : 0;

  const confirmDialog = (
    <ConfirmDialog
      busy={confirming !== null && busyKey === `${confirming.notice.id}:${confirming.action}`}
      confirmLabel={copy?.confirmLabel ?? "Confirmar"}
      description={copy?.description}
      destructive={copy?.destructive}
      onConfirm={() => {
        if (confirming) {
          // Excluir e Retirar do sino: o dialogo fecha na hora (o toast confirma quando terminar; um erro
          // aparece no banner da tela, como nas outras acoes).
          if (confirming.action === "delete" || confirming.action === "withdraw") {
            setConfirming(null);
          }

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
    >
      {sentFollowUps > 0 ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm leading-5 text-[var(--text-primary)]">
          <Checkbox
            checked={alsoFollowUps}
            className="size-[18px] rounded border-[var(--border-stronger)] data-checked:border-[var(--text-primary)] data-checked:bg-[var(--text-primary)] data-checked:text-[var(--surface-1)]"
            onCheckedChange={(checked) => setAlsoFollowUps(checked === true)}
          />
          {confirming?.action === "delete" ? deleteFollowUpsLabel(sentFollowUps) : withdrawFollowUpsLabel(sentFollowUps)}
        </label>
      ) : null}
    </ConfirmDialog>
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
  end: endNotice
};

type NoticeRowMenuProps = {
  /** Acoes que a tela ja mostra como botao (ficam fora do menu). */
  exclude?: readonly NoticeAction[];
  /**
   * Entradas da tela que nao sao acoes do aviso (docs/28: "Salvar como modelo"), logo depois de "Duplicar" (ou antes
   * da primeira com a linha separadora, sem Duplicar). A lista do servidor (NoticeAction) nao muda.
   */
  extra?: readonly RowMenuAction[];
  notice: NoticeActionTarget;
  onRequest: (action: NoticeAction, notice: NoticeActionTarget) => void;
};

/** Menu "…" de um aviso. Sem nenhuma acao disponivel, nao aparece. */
export function NoticeRowMenu({ exclude, extra, notice, onRequest }: NoticeRowMenuProps) {
  const entries = noticeMenuEntries(notice.actions, exclude);

  return (
    <RowMenu
      actions={noticeMenuWithExtra(entries, extra).map((item) =>
        item.kind === "extra"
          ? item.extra
          : {
              destructive: item.entry.destructive,
              icon: <NoticeActionIcon action={item.entry.action} />,
              label: item.entry.label,
              onSelect: () => onRequest(item.entry.action, notice),
              separated: item.entry.separated
            }
      )}
      label={`Ações de ${notice.title}`}
    />
  );
}
