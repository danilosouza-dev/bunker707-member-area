"use client";

import { CalendarX, ChartColumn, CircleStop, Copy, DoorOpen, ExternalLink, MonitorPlay, Pencil, Send, Trash2, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { startTransition, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { cancelWebinar, deleteWebinar, duplicateWebinar } from "@/server/webinars/actions";
import {
  WEBINAR_ACTION_TOASTS,
  WEBINAR_ADMIN_COPY,
  webinarActionBlockedReason,
  webinarActionConfirm,
  webinarActionHref,
  webinarActionNeedsConfirm,
  webinarAdminHref,
  webinarMenuEntries,
  type WebinarAction,
  type WebinarConfirmableAction,
  type WebinarPermissions
} from "@/server/webinars/editor-model";
import { WEBINAR_LIMITS, type WebinarKind, type WebinarSituation, type WebinarStatus } from "@/server/webinars/model";
import { endSessionNow } from "@/server/webinars/room-actions";
import { ErrorBanner } from "../../error-banner";
import { adminTextareaClass } from "../../form";
import { ConfirmDialog, RowMenu } from "../../settings/kit";
import { adminToast } from "../../toast";

// Acoes de um webinario (docs/30 §2.1 e §2.3), as mesmas na lista e no editor: o menu "…" mostra so o que a
// situacao e a permissao permitem (webinarMenuEntries; o servidor confere de novo), Cancelar, Excluir e Encerrar
// live pedem confirmacao (ConfirmDialog, nunca window.confirm; Cancelar com o motivo e o numero de alunos com
// vaga), sucesso vira toast e erro fica num banner na tela. Cada acao leva a versao lida (updatedAt): se o
// webinario mudou em outra tela, volta 409 e o banner oferece "Recarregar". Abrir o console e Ver relatório so
// navegam (fase 2b); na fase 3 Abrir a sala tambem leva ao console, e na Live ao vivo o Encerrar live idem (a acao
// mora la: o navegador do apresentador para a gravacao e desliga a sala). Sem messaging.publish, Abrir a sala e o
// Encerrar live da Live ao vivo aparecem desligados com "· só quem publica" (§2.6); o que chega em outra fase
// (Publicar replay) aparece desligado com "em breve" (docs/30 §2.8).

export type WebinarActionTarget = {
  id: string;
  /** O tipo decide o Encerrar live: link para o console na Live ao vivo, confirmacao na Live gravada. */
  kind: WebinarKind;
  registeredCount: number;
  /** A sessao no ar ou na espera (Encerrar live); nula fora disso. */
  runningSessionId: string | null;
  situation: WebinarSituation;
  status: WebinarStatus;
  title: string;
  updatedAt: string;
};

const NO_RUNNING_SESSION_MESSAGE = "Nenhuma sessão no ar para encerrar.";

type Failure = { message: string; status: number };

const ACTION_ICONS: Partial<Record<WebinarAction, LucideIcon>> = {
  cancel: CalendarX,
  delete: Trash2,
  duplicate: Copy,
  end: CircleStop,
  open: Pencil,
  open_console: MonitorPlay,
  open_room: DoorOpen,
  publish: Send,
  publish_replay: ExternalLink,
  view_report: ChartColumn
};

export function WebinarActionIcon({ action, className = "size-4" }: { action: WebinarAction; className?: string }) {
  const Icon = ACTION_ICONS[action];

  return Icon ? <Icon aria-hidden="true" className={className} /> : null;
}

type UseWebinarActionsOptions = {
  /** Depois de excluir (o editor volta para a lista); sem ele, a tela atual atualiza (a lista). */
  onDeleted?: () => void;
  permissions: WebinarPermissions;
};

/**
 * Executa as acoes do menu. Devolve `request` (abre a confirmacao quando precisa), o dialogo e o banner de erro
 * para a tela posicionar, e `busyKey` ("{id}:{acao}") enquanto uma acao roda.
 */
export function useWebinarActions({ onDeleted, permissions }: UseWebinarActionsOptions) {
  const router = useRouter();
  const reasonId = useId();
  const [confirming, setConfirming] = useState<{ action: WebinarConfirmableAction; target: WebinarActionTarget } | null>(null);
  const [reason, setReason] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  function fail(result: Extract<ActionResult<unknown>, { ok: false }>) {
    setFailure({ message: result.error, status: result.status });
  }

  // Fora do caminho do dialogo: a pagina e buscada de novo numa transicao, que nao segura o toast.
  function refreshInBackground() {
    startTransition(() => router.refresh());
  }

  async function execute(action: WebinarAction, target: WebinarActionTarget) {
    const input = { expectedUpdatedAt: target.updatedAt, id: target.id };
    const key = `${target.id}:${action}`;

    setBusyKey(key);
    setFailure(null);

    try {
      switch (action) {
        case "duplicate": {
          const result = await duplicateWebinar(input);

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(WEBINAR_ACTION_TOASTS.duplicate ?? "");
          router.push(webinarAdminHref(result.data.id));
          return;
        }
        case "cancel": {
          const result = await cancelWebinar({ ...input, reason });

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(WEBINAR_ACTION_TOASTS.cancel ?? "");
          refreshInBackground();
          return;
        }
        case "delete": {
          const result = await deleteWebinar(input);

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(WEBINAR_ACTION_TOASTS.delete ?? "");

          if (onDeleted) {
            onDeleted();
          } else {
            refreshInBackground();
          }

          return;
        }
        case "end": {
          if (!target.runningSessionId) {
            return fail({ error: NO_RUNNING_SESSION_MESSAGE, ok: false, status: 409 });
          }

          const result = await endSessionNow({ sessionId: target.runningSessionId });

          if (!result.ok) {
            return fail(result);
          }

          adminToast.success(WEBINAR_ACTION_TOASTS.end ?? "");
          refreshInBackground();
          return;
        }
        default:
          return;
      }
    } finally {
      setBusyKey((current) => (current === key ? null : current));
      setConfirming((current) => (current?.action === action && current.target.id === target.id ? null : current));
    }
  }

  function request(action: WebinarAction, target: WebinarActionTarget) {
    // Desligado por permissao: o item nao reage (o servidor recusaria de novo).
    if (webinarActionBlockedReason(action, permissions, target.kind)) {
      return;
    }

    const href = webinarActionHref(action, target.id, target.kind);

    if (href) {
      router.push(href);
      return;
    }

    if (webinarActionNeedsConfirm(action, target.kind)) {
      setFailure(null);
      setReason("");
      setConfirming({ action: action as WebinarConfirmableAction, target });
      return;
    }

    void execute(action, target);
  }

  const copy = confirming ? webinarActionConfirm(confirming.action, confirming.target) : null;
  const conflict = failure?.status === 409;

  const confirmDialog = (
    <ConfirmDialog
      busy={confirming !== null && busyKey === `${confirming.target.id}:${confirming.action}`}
      confirmLabel={copy?.confirmLabel ?? "Confirmar"}
      description={copy?.description}
      destructive={copy?.destructive}
      onConfirm={() => {
        if (confirming) {
          void execute(confirming.action, confirming.target);
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
      {confirming?.action === "cancel" ? (
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={reasonId}>
            {WEBINAR_ADMIN_COPY.confirm.cancel.reasonLabel}
          </label>
          <textarea
            className={cn(adminTextareaClass, "min-h-20")}
            id={reasonId}
            maxLength={WEBINAR_LIMITS.cancelReason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            value={reason}
          />
        </div>
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
            {WEBINAR_ADMIN_COPY.failures.reload}
          </Button>
        ) : (
          <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
            Fechar
          </Button>
        )
      }
      title={conflict ? WEBINAR_ADMIN_COPY.failures.conflictTitle : WEBINAR_ADMIN_COPY.failures.generic}
    >
      {failure.message}
    </ErrorBanner>
  ) : null;

  return { busyKey, confirmDialog, errorBanner, permissions, request };
}

type WebinarRowMenuProps = {
  /** Acoes que a tela ja mostra como botao (ficam fora do menu). */
  exclude?: readonly WebinarAction[];
  onRequest: (action: WebinarAction, target: WebinarActionTarget) => void;
  permissions: WebinarPermissions;
  webinar: WebinarActionTarget;
};

/** Menu "…" de um webinario. Sem nenhuma acao disponivel, nao aparece. */
export function WebinarRowMenu({ exclude, onRequest, permissions, webinar }: WebinarRowMenuProps) {
  const entries = webinarMenuEntries(webinar.situation, permissions, exclude, webinar.kind);

  return (
    <RowMenu
      actions={entries.map((entry) => ({
        destructive: entry.destructive,
        disabled: entry.soon || entry.blocked !== null,
        icon: <WebinarActionIcon action={entry.action} />,
        label: entry.display,
        onSelect: () => onRequest(entry.action, webinar),
        separated: entry.separated
      }))}
      label={`Ações de ${webinar.title}`}
    />
  );
}
