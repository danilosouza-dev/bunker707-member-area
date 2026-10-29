"use client";

import { CircleStop, Play, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { formatSaoPauloDateTime } from "@/server/communications/campaign-model";
import type { ModerationAction } from "@/server/webinars/chat-schemas";
import {
  CONSOLE_POLL_MS,
  canEndSession,
  canOpenSession,
  canTeamActOn,
  consoleClockLabel,
  consoleOffsetMs,
  consolePhaseLabel,
  consolePhaseOf,
  consolePhaseTone,
  scriptQueue,
  type ConsoleSnapshot
} from "@/server/webinars/console-model";
import type { SessionConsoleData } from "@/server/webinars/console-queries";
import { WEBINARS_HREF, WEBINAR_ADMIN_COPY, webinarAdminHref, webinarConsoleHref, webinarReportHref, type WebinarPermissions } from "@/server/webinars/editor-model";
import type { ChatMode, QuestionStatus, SlowModeSeconds } from "@/server/webinars/model";
import { answerQuestion, closePoll, endSessionNow, launchPoll, moderateMessage, openSessionNow, sendTeamMessage, setQuestionStatus, setSessionChatMode } from "@/server/webinars/room-actions";
import { sessionDurationMs } from "@/server/webinars/room-model";
import { fireScriptItem } from "@/server/webinars/script-actions";
import { EmptyState } from "../../../empty-state";
import { ErrorBanner } from "../../../error-banner";
import { adminInputClass } from "../../../form";
import { AdminLinkButton } from "../../../link-button";
import { AdminPage } from "../../../page-container";
import { PageHeader } from "../../../page-header";
import { ConfirmDialog } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";
import { adminToast } from "../../../toast";
import { useAdminTopbarTitle } from "../../../topbar-title";
import { ConsoleChat } from "./console-chat";
import { ConsolePolls } from "./console-polls";
import { ConsoleQuestions } from "./console-questions";
import { ConsoleScript } from "./console-script";

// O console da sessao (docs/30 §2.4; fase 2b): o seletor de sessoes, a fase pelo relogio do servidor (skew medido
// na carga, como a sala do aluno), os presentes agora, Abrir e Encerrar com confirmacao (messaging.publish), e os
// quatro paineis: Chat (moderacao, quem pode escrever, modo lento, a mensagem da equipe), Roteiro (Soltar agora),
// Enquetes (abrir, encerrar, compartilhar) e Perguntas (responder, ao vivo, dispensar, reabrir). O retrato vem do
// servidor a cada 5 s pela rota /api/admin/webinars/[id]/console; cada acao busca o retrato de novo ao terminar.
// Erros ficam num banner (nunca toast); sucesso vira toast.

const copy = WEBINAR_ADMIN_COPY.console;

type Failure = { message: string; status: number };
type Polling = "idle" | "offline" | "updating";

type SessionConsoleProps = {
  currentUserId: string;
  data: SessionConsoleData;
  permissions: WebinarPermissions;
  /** Hora do servidor na carga, para o skew do relogio da sessao. */
  serverNow: number;
};

export function SessionConsole({ currentUserId, data, permissions, serverNow }: SessionConsoleProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(data.snapshot);
  const [skew] = useState(() => serverNow - Date.now());
  const [tick, setTick] = useState(() => Date.now());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [polling, setPolling] = useState<Polling>("idle");
  const [confirming, setConfirming] = useState<"end" | "open" | null>(null);
  const session = snapshot?.session ?? null;
  const sessionId = session?.id ?? null;
  const webinar = data.webinar;
  const durationMs = sessionDurationMs(webinar.recordingDurationSeconds, webinar.durationMinutes);
  const nowMs = tick + skew;
  const offsetMs = session ? consoleOffsetMs(session, tick, skew) : Number.NaN;
  const phase = session ? consolePhaseOf(session, durationMs, nowMs) : null;
  const canAct = session ? canTeamActOn(session) : false;
  const queue = useMemo(() => (snapshot ? scriptQueue(snapshot.scriptItems, snapshot.scriptFired, offsetMs) : []), [snapshot, offsetMs]);

  useAdminTopbarTitle(copy.title);

  // O relogio da tela anda a cada segundo; o skew foi medido na carga (hora do servidor menos a do aparelho).
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1_000);

    return () => window.clearInterval(id);
  }, []);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      return;
    }

    setPolling("updating");

    try {
      const response = await fetch(`/api/admin/webinars/${webinar.id}/console?sessao=${encodeURIComponent(sessionId)}`, { cache: "no-store", credentials: "same-origin" });

      if (!response.ok) {
        throw new Error(String(response.status));
      }

      const body = (await response.json()) as { data: ConsoleSnapshot };
      setSnapshot(body.data);
      setPolling("idle");
    } catch {
      setPolling("offline");
    }
  }, [sessionId, webinar.id]);

  // A cada 5 s (so com a aba visivel) e ao voltar para a aba.
  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let timer: number | null = null;
    let stopped = false;

    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (!stopped && document.visibilityState === "visible") {
          await refresh();
        }

        if (!stopped) {
          schedule();
        }
      }, CONSOLE_POLL_MS);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    schedule();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;

      if (timer !== null) {
        window.clearTimeout(timer);
      }

      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh, sessionId]);

  /** Roda uma acao da mesa: banner no erro, retrato novo no sucesso. Devolve se deu certo. */
  async function run<T>(key: string, action: () => Promise<ActionResult<T>>, onOk?: (data: T) => void): Promise<boolean> {
    if (busyKey) {
      return false;
    }

    setBusyKey(key);
    setFailure(null);
    const result = await action();
    setBusyKey(null);

    if (!result.ok) {
      setFailure({ message: Object.values(result.fieldErrors ?? {})[0]?.[0] ?? result.error, status: result.status });
      return false;
    }

    onOk?.(result.data);
    await refresh();
    return true;
  }

  async function openNow() {
    if (!sessionId) {
      return;
    }

    const ok = await run("open", () => openSessionNow({ sessionId }));
    setConfirming(null);

    if (ok) {
      adminToast.success(WEBINAR_ADMIN_COPY.toasts.opened);
      router.refresh();
    }
  }

  async function endNow() {
    if (!sessionId) {
      return;
    }

    const ok = await run("end", () => endSessionNow({ sessionId }));
    setConfirming(null);

    if (ok) {
      adminToast.success(WEBINAR_ADMIN_COPY.toasts.ended);
      router.refresh();
    }
  }

  function changeSession(nextId: string) {
    router.push(webinarConsoleHref(webinar.id, nextId));
  }

  const sessionLabel = (item: SessionConsoleData["sessions"][number]) =>
    item.kind === "replay" ? `${copy.phases.replay} · ${formatSaoPauloDateTime(item.scheduledAt)}` : `${WEBINAR_ADMIN_COPY.fields.sessionSaved(formatSaoPauloDateTime(item.scheduledAt))} · ${copy.phases[item.status === "live" ? "live" : item.status === "waiting" ? "waiting" : item.status === "ended" ? "ended" : item.status === "cancelled" ? "cancelled" : "scheduled"]}`;

  return (
    <AdminPage className="gap-6 pb-28">
      <PageHeader
        actions={
          <>
            <AdminLinkButton href={webinarAdminHref(webinar.id)} variant="secondary">
              {copy.backToEditor}
            </AdminLinkButton>
            {phase === "ended" ? (
              <AdminLinkButton href={webinarReportHref(webinar.id)} variant="secondary">
                {copy.report}
              </AdminLinkButton>
            ) : null}
            {session && permissions.canPublish && session.kind !== "replay" && canOpenSession(session.status) ? (
              <Button className="px-4" disabled={busyKey !== null} onClick={() => setConfirming("open")} type="button">
                <Play aria-hidden="true" className="size-4" />
                {copy.open}
              </Button>
            ) : null}
            {session && permissions.canPublish && session.kind !== "replay" && canEndSession(session.status) ? (
              <Button className="border-[var(--error-border)] bg-[var(--error-bg)] px-4 text-[var(--error)] hover:bg-[var(--error-bg)] hover:brightness-125" disabled={busyKey !== null} onClick={() => setConfirming("end")} type="button" variant="secondary">
                <CircleStop aria-hidden="true" className="size-4" />
                {copy.end}
              </Button>
            ) : null}
          </>
        }
        breadcrumb={[
          { href: WEBINARS_HREF, label: WEBINAR_ADMIN_COPY.header.breadcrumbList },
          { href: webinarAdminHref(webinar.id), label: webinar.title },
          { label: copy.breadcrumb }
        ]}
        description={
          session && phase ? (
            <span className="flex flex-wrap items-center gap-2" data-console-status="">
              <StatusChip tone={consolePhaseTone(phase)}>{consolePhaseLabel(phase)}</StatusChip>
              <span className="tabular-nums" data-console-clock="">
                {consoleClockLabel(offsetMs, phase)}
              </span>
              <span className="tabular-nums" data-console-present="">
                · {copy.presentNow(snapshot?.presentNow ?? 0)}
              </span>
            </span>
          ) : (
            copy.description
          )
        }
        title={copy.title}
      />

      {failure ? (
        <ErrorBanner
          action={
            <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
              Fechar
            </Button>
          }
          title={failure.status === 409 ? WEBINAR_ADMIN_COPY.failures.conflictTitle : WEBINAR_ADMIN_COPY.failures.generic}
        >
          {failure.message}
        </ErrorBanner>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor="console-session">
          {copy.sessionPicker}
          <select className={cn(adminInputClass, "w-full max-w-sm sm:w-80")} disabled={data.sessions.length === 0} id="console-session" onChange={(event) => changeSession(event.target.value)} value={sessionId ?? ""}>
            {data.sessions.length === 0 ? <option value="">—</option> : null}
            {data.sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {sessionLabel(item)}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2 pb-2 text-xs leading-5 text-[var(--text-tertiary)]">
          <Button aria-label={copy.refresh} className="px-2 text-[var(--text-secondary)]" disabled={!sessionId || polling === "updating"} onClick={() => void refresh()} type="button" variant="ghost">
            <RefreshCw aria-hidden="true" className={cn("size-4", polling === "updating" && "animate-spin motion-reduce:animate-none")} />
          </Button>
          <span aria-live="polite" data-console-polling={polling}>
            {polling === "updating" ? copy.updating : polling === "offline" ? copy.offline : ""}
          </span>
        </div>
      </div>

      {!snapshot || !session ? (
        <EmptyState description={WEBINAR_ADMIN_COPY.simulation.noSessions} title={WEBINAR_ADMIN_COPY.fields.sessionsEmpty} />
      ) : (
        <>
          {!canAct ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{copy.readOnly}</p> : null}
          <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
            <ConsoleChat
              busyKey={busyKey}
              canAct={canAct}
              currentUserId={currentUserId}
              hostUserId={webinar.hostUserId}
              messages={snapshot.messages}
              onChatMode={(chatMode: ChatMode, slowModeSeconds: SlowModeSeconds | null) => void run("chat-mode", () => setSessionChatMode({ chatMode, sessionId: session.id, slowModeSeconds }))}
              onModerate={(action: ModerationAction, messageId: string) => void run(`moderate:${messageId}`, () => moderateMessage({ action, messageId }))}
              onSend={(body: string) => run("send", () => sendTeamMessage({ body, sessionId: session.id }), () => adminToast.success(WEBINAR_ADMIN_COPY.toasts.messageSent))}
              pinnedMessageId={snapshot.pinnedMessageId}
              session={session}
            />
            <div className="flex min-w-0 flex-col gap-6">
              {webinar.kind === "simulated" ? (
                <ConsoleScript busyKey={busyKey} canAct={canAct} onFire={(itemId: string) => void run(`fire:${itemId}`, () => fireScriptItem({ itemId, sessionId: session.id }))} queue={queue} />
              ) : null}
              <ConsolePolls
                busyKey={busyKey}
                canAct={canAct}
                launched={snapshot.polls.launched}
                onClose={(pollId: string, shareResults: boolean) => void run(`poll:${pollId}`, () => closePoll({ pollId, sessionId: session.id, shareResults }))}
                onLaunch={(pollId: string) => void run(`poll:${pollId}`, () => launchPoll({ pollId, sessionId: session.id }))}
                templates={snapshot.polls.templates}
              />
              <ConsoleQuestions
                busyKey={busyKey}
                canAct={canAct}
                onAnswer={(questionId: string, answerText: string, answeredLive: boolean) => run(`question:${questionId}`, () => answerQuestion({ answerText: answerText || undefined, answeredLive, questionId }))}
                onStatus={(questionId: string, status: QuestionStatus) => void run(`question:${questionId}`, () => setQuestionStatus({ questionId, status }))}
                questions={snapshot.questions}
              />
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        busy={busyKey === "open" || busyKey === "end"}
        confirmLabel={confirming === "end" ? copy.endConfirm.confirmLabel : copy.openConfirm.confirmLabel}
        description={confirming === "end" ? copy.endConfirm.description : copy.openConfirm.description}
        destructive={confirming === "end"}
        onConfirm={() => void (confirming === "end" ? endNow() : openNow())}
        onOpenChange={(open) => {
          if (!open) {
            setConfirming(null);
          }
        }}
        open={confirming !== null}
        title={confirming === "end" ? copy.endConfirm.title : copy.openConfirm.title}
      />
    </AdminPage>
  );
}
