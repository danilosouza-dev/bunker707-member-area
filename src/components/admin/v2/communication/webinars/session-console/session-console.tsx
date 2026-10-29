"use client";

import { CircleStop, DoorOpen, Play, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
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
  type ConsoleMessage,
  type ConsoleSnapshot
} from "@/server/webinars/console-model";
import type { SessionConsoleData } from "@/server/webinars/console-queries";
import { WEBINARS_HREF, WEBINAR_ADMIN_COPY, webinarAdminHref, webinarConsoleHref, webinarReportHref, type WebinarPermissions } from "@/server/webinars/editor-model";
import {
  alignChat,
  attachRecording,
  banStudent,
  endLiveSession,
  kickFromSession,
  markRecordingAnchor,
  muteInChat,
  openLiveRoom,
  prepareRecorder,
  releaseRecorder,
  requestRecording,
  setBrowserRecording,
  setRoomLock,
  startLiveSession,
  undoSessionBan,
  unbanStudent
} from "@/server/webinars/live-actions";
import { LIVE_CONSOLE_COPY, desiredLobby, liveSessionButtons, type LiveConsolePerson } from "@/server/webinars/live-console-model";
import type { ChatMode, QuestionStatus, SlowModeSeconds } from "@/server/webinars/model";
import { answerQuestion, closePoll, endSessionNow, launchPoll, moderateMessage, openSessionNow, sendTeamMessage, setQuestionStatus, setSessionChatMode } from "@/server/webinars/room-actions";
import { sessionDurationMs } from "@/server/webinars/room-model";
import { fireScriptItem } from "@/server/webinars/script-actions";
import { EmptyState } from "../../../empty-state";
import { ErrorBanner } from "../../../error-banner";
import { adminInputClass, adminTextareaClass } from "../../../form";
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
import { LiveAlignChat } from "./live-align-chat";
import { LiveAttachRecording, type AttachInput } from "./live-attach-recording";
import { LiveControls } from "./live-controls";
import { LiveHands } from "./live-hands";
import { LivePersonMenu, LiveParticipants, type PersonAction } from "./live-participants";
import { LiveRecorder } from "./live-recorder";
import { LiveRoomPanel, useLiveRoom } from "./live-room-panel";

// O console da sessao (docs/30 §2.4; fase 2b): o seletor de sessoes, a fase pelo relogio do servidor (skew medido
// na carga, como a sala do aluno), os presentes agora, Abrir e Encerrar com confirmacao (messaging.publish), e os
// quatro paineis: Chat (moderacao, quem pode escrever, modo lento, a mensagem da equipe), Roteiro (Soltar agora),
// Enquetes (abrir, encerrar, compartilhar) e Perguntas (responder, ao vivo, dispensar, reabrir). O retrato vem do
// servidor a cada 5 s pela rota /api/admin/webinars/[id]/console; cada acao busca o retrato de novo ao terminar.
// Erros ficam num banner (nunca toast); sucesso vira toast. Na Live ao vivo (fase 3, docs/30 §1.4, §2.4, §6.4 e §6.7)
// o topo troca Abrir/Encerrar por Abrir a sala (Sessao de pratica), Comecar para todos e Encerrar live (com
// confirmacao: para a gravacao, encerra no servidor e fecha a sala para todos), e a mesa ganha a sala no meio
// (live-room-panel.tsx: o iframe pelo useJitsiMeet com os botoes nossos ao redor), Mao levantada, Participantes (com o
// ⋯ de remover, silenciar e banir, tambem no chat), o cartao Gravacao, "Alinhar chat" e "Enviar gravacao". Sem a sala
// neste ambiente, "A sala ao vivo ainda nao esta configurada" e o resto do console funciona.

const copy = WEBINAR_ADMIN_COPY.console;
const liveCopy = WEBINAR_COPY.consoleAoVivo;

type Failure = { message: string; status: number };
type Polling = "idle" | "offline" | "updating";

type SessionConsoleProps = {
  currentUserId: string;
  data: SessionConsoleData;
  /** O nonce da pagina (cabecalho x-nonce do src/proxy.ts) para o <script> da sala ao vivo. */
  nonce?: string | null;
  permissions: WebinarPermissions;
  /** Hora do servidor na carga, para o skew do relogio da sessao. */
  serverNow: number;
};

type BanTarget = { name: string; participantId: string | null; userId: string };

export function SessionConsole({ currentUserId, data, nonce = null, permissions, serverNow }: SessionConsoleProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(data.snapshot);
  const [skew] = useState(() => serverNow - Date.now());
  const [tick, setTick] = useState(() => Date.now());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [polling, setPolling] = useState<Polling>("idle");
  const [confirming, setConfirming] = useState<"end" | "open" | null>(null);
  const [confirmingLiveEnd, setConfirmingLiveEnd] = useState(false);
  const [banTarget, setBanTarget] = useState<BanTarget | null>(null);
  const [banReason, setBanReason] = useState("");
  const [recordUnavailable, setRecordUnavailable] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const session = snapshot?.session ?? null;
  const sessionId = session?.id ?? null;
  const webinar = data.webinar;
  const durationMs = sessionDurationMs(webinar.recordingDurationSeconds, webinar.durationMinutes);
  const nowMs = tick + skew;
  const offsetMs = session ? consoleOffsetMs(session, tick, skew) : Number.NaN;
  const phase = session ? consolePhaseOf(session, durationMs, nowMs) : null;
  const canAct = session ? canTeamActOn(session) : false;
  const queue = useMemo(() => (snapshot ? scriptQueue(snapshot.scriptItems, snapshot.scriptFired, offsetMs) : []), [snapshot, offsetMs]);
  const live = session?.kind === "live" ? (snapshot?.live ?? null) : null;
  const livePeople = useMemo(() => new Map((live?.people ?? []).map((person) => [person.userId, person])), [live]);

  const markAnchor = useCallback(async () => {
    if (!sessionId) {
      return false;
    }

    const result = await markRecordingAnchor({ sessionId });

    if (!result.ok) {
      setFailure({ message: result.error, status: result.status });
      return false;
    }

    return true;
  }, [sessionId]);

  // A reserva "Gravar no navegador" ligou ou desligou: a sessao guarda para o selo Gravando do aluno (sem toast: o
  // proximo retrato mostra; uma falha so deixa o selo esperar a leitura seguinte).
  const onBrowserRecording = useCallback(
    (on: boolean) => {
      if (sessionId) {
        void setBrowserRecording({ on, sessionId });
      }
    },
    [sessionId]
  );

  const room = useLiveRoom({
    canPublish: permissions.canPublish,
    container: stageRef,
    currentUserId,
    enabled: live !== null,
    live,
    nonce,
    onAnchor: markAnchor,
    onBrowserRecording,
    session,
    webinar
  });

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

  /* Live ao vivo: situacao da sessao */

  async function openRoom() {
    if (sessionId && (await run("live:open", () => openLiveRoom({ sessionId })))) {
      router.refresh();
    }
  }

  async function startForAll() {
    if (!sessionId || !live) {
      return;
    }

    const ok = await run("live:start", () => startLiveSession({ sessionId }), () =>
      room.syncLobby(desiredLobby({ practiceSession: webinar.practiceSession !== false, roomLocked: live.roomLocked, status: "live", waitingRoom: webinar.waitingRoom === true }))
    );

    if (ok) {
      router.refresh();
    }
  }

  /** Encerrar live: para a gravacao, encerra no servidor e so entao fecha a sala para todos (endConference) e sai. */
  async function endLive() {
    if (!sessionId || !live) {
      return;
    }

    if (room.room.recording.on || live.recorder.status === "recording") {
      room.command("stopRecording", room.room.recording.mode === "local" ? "local" : "file");
    }

    const ok = await run("live:end", () => endLiveSession({ sessionId }), () => {
      room.command("endConference");
      room.command("hangup");
    });
    setConfirmingLiveEnd(false);

    if (ok) {
      adminToast.success(WEBINAR_ADMIN_COPY.toasts.ended);
      router.refresh();
    }
  }

  function lockRoom(locked: boolean) {
    if (!sessionId || !live || !session) {
      return;
    }

    void run("live:lock", () => setRoomLock({ locked, sessionId }), () =>
      room.syncLobby(desiredLobby({ practiceSession: webinar.practiceSession !== false, roomLocked: locked, status: session.status, waitingRoom: webinar.waitingRoom === true }))
    );
  }

  /* Live ao vivo: gravacao */

  function recordNow() {
    if (!sessionId) {
      return;
    }

    void run("live:rec-start", () => requestRecording({ sessionId }), (reply) => {
      setRecordUnavailable(reply.action === "unavailable");

      if (reply.action === "start") {
        room.command("startRecording", { mode: "file" });
      }
    });
  }

  function stopRecording() {
    room.command("stopRecording", room.room.recording.mode === "local" ? "local" : "file");
  }

  async function attach(input: AttachInput): Promise<boolean> {
    if (!sessionId) {
      return false;
    }

    return run("live:attach", () => attachRecording({ ...input, sessionId }), () => adminToast.success(liveCopy.gravacaoLigada));
  }

  /* Live ao vivo: pessoas (na sala e no chat) */

  function onPersonAction(person: LiveConsolePerson | null, participantId: string | null, action: PersonAction) {
    if (!sessionId) {
      return;
    }

    switch (action.type) {
      case "spotlight":
        if (!participantId) {
          return;
        }
        if (action.on) {
          room.command("setLargeVideoParticipant", participantId);
          room.command("pinParticipant", participantId);
        } else {
          room.command("pinParticipant");
          room.command("setLargeVideoParticipant");
        }
        room.dispatch({ id: action.on ? participantId : null, type: "spotlight" });
        return;
      case "stage":
        if (!participantId) {
          return;
        }
        if (action.on) {
          room.command("askToUnmute", participantId);
          room.command("approveVideo", participantId);
        } else {
          room.command("muteRemoteParticipant", participantId, "audio");
          room.command("muteRemoteParticipant", participantId, "video");
          room.command("rejectParticipant", participantId, "audio");
          room.command("rejectParticipant", participantId, "video");
          if (room.room.spotlight === participantId) {
            room.command("pinParticipant");
            room.command("setLargeVideoParticipant");
          }
        }
        room.dispatch({ id: participantId, on: action.on, type: "stage" });
        return;
      case "closeCamera":
        if (participantId) {
          room.command("muteRemoteParticipant", participantId, "video");
        }
        return;
      default:
        break;
    }

    if (!person) {
      return;
    }

    const userId = person.userId;
    const key = `person:${userId}`;

    switch (action.type) {
      case "mute":
        void run(key, () => muteInChat({ minutes: action.minutes, sessionId, userId }));
        return;
      case "kick":
        void run(key, () => kickFromSession({ sessionId, userId }), () => {
          if (participantId) {
            room.command("kickParticipant", participantId);
            room.dispatch({ id: participantId, type: "kicked" });
          }
        });
        return;
      case "ban":
        setBanReason("");
        setBanTarget({ name: person.displayName, participantId, userId });
        return;
      case "undo":
        void run(key, () => undoSessionBan({ kind: action.kind, sessionId, userId }));
        return;
      case "unban":
        void run(key, () => unbanStudent({ userId }));
        return;
      default:
        return;
    }
  }

  async function confirmBan() {
    if (!sessionId || !banTarget) {
      return;
    }

    const target = banTarget;
    const ok = await run(`person:${target.userId}`, () => banStudent({ reason: banReason.trim() || undefined, sessionId, userId: target.userId }), () => {
      if (target.participantId) {
        room.command("kickParticipant", target.participantId);
        room.dispatch({ id: target.participantId, type: "kicked" });
      }
    });

    if (ok) {
      setBanTarget(null);
    }
  }

  function chatPersonMenu(message: ConsoleMessage) {
    const person = message.authorUserId ? (livePeople.get(message.authorUserId) ?? null) : null;

    if (!person || person.staff) {
      return null;
    }

    return (
      <LivePersonMenu
        busy={busyKey === `person:${person.userId}`}
        canPublish={permissions.canPublish}
        controls={room.controls}
        joined={room.joined}
        name={person.displayName}
        onAction={(action) => onPersonAction(person, person.participantId, action)}
        participantId={null}
        person={person}
      />
    );
  }

  const liveButtons = session && live ? liveSessionButtons(session.status) : null;
  const sessionDisabledTitle = room.controls.sessionEnabled ? undefined : LIVE_CONSOLE_COPY.soQuemPublica;

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
            {session && !live && permissions.canPublish && session.kind !== "replay" && canOpenSession(session.status) ? (
              <Button className="px-4" disabled={busyKey !== null} onClick={() => setConfirming("open")} type="button">
                <Play aria-hidden="true" className="size-4" />
                {copy.open}
              </Button>
            ) : null}
            {session && !live && permissions.canPublish && session.kind !== "replay" && canEndSession(session.status) ? (
              <Button className="border-[var(--error-border)] bg-[var(--error-bg)] px-4 text-[var(--error)] hover:bg-[var(--error-bg)] hover:brightness-125" disabled={busyKey !== null} onClick={() => setConfirming("end")} type="button" variant="secondary">
                <CircleStop aria-hidden="true" className="size-4" />
                {copy.end}
              </Button>
            ) : null}
            {liveButtons && room.controls.session && liveButtons.open ? (
              <Button className="px-4" disabled={busyKey !== null || !room.controls.sessionEnabled} onClick={() => void openRoom()} title={sessionDisabledTitle} type="button" variant="secondary">
                <DoorOpen aria-hidden="true" className="size-4" />
                {liveCopy.abrirSala}
              </Button>
            ) : null}
            {liveButtons && room.controls.session && liveButtons.start ? (
              <Button className="px-4" disabled={busyKey !== null || !room.controls.sessionEnabled} onClick={() => void startForAll()} title={sessionDisabledTitle} type="button">
                <Play aria-hidden="true" className="size-4" />
                {liveCopy.comecarParaTodos}
              </Button>
            ) : null}
            {liveButtons && room.controls.session && liveButtons.end ? (
              <Button
                className="border-[var(--error-border)] bg-[var(--error-bg)] px-4 text-[var(--error)] hover:bg-[var(--error-bg)] hover:brightness-125"
                disabled={busyKey !== null || !room.controls.sessionEnabled}
                onClick={() => setConfirmingLiveEnd(true)}
                title={sessionDisabledTitle}
                type="button"
                variant="secondary"
              >
                <CircleStop aria-hidden="true" className="size-4" />
                {liveCopy.encerrarLive}
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
          {live && room.controls.session && !room.controls.sessionEnabled ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{LIVE_CONSOLE_COPY.soQuemPublica}</p> : null}
          {live ? (
            <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]" data-live-console="">
              <div className="flex min-w-0 flex-col gap-6">
                <LiveRoomPanel busy={busyKey !== null} handle={room} live={live} session={session} stageRef={stageRef}>
                  <LiveControls busyKey={busyKey} canWrite={permissions.canWrite} handle={room} onLock={lockRoom} roomLocked={live.roomLocked} />
                </LiveRoomPanel>
                <LiveRecorder
                  busyKey={busyKey}
                  canPublish={permissions.canPublish}
                  controls={room.controls}
                  joined={room.joined}
                  nowMs={nowMs}
                  onBrowserRecord={() => room.command("startRecording", { mode: "local", onlySelf: false })}
                  onPrepare={() => void run("live:rec-prepare", () => prepareRecorder({ sessionId: session.id }))}
                  onRecord={recordNow}
                  onRelease={() => void run("live:rec-release", () => releaseRecorder({ sessionId: session.id }))}
                  onStop={stopRecording}
                  recorder={live.recorder}
                  recording={room.room.recording}
                  status={session.status}
                  unavailable={recordUnavailable}
                />
                {live.recording ? (
                  <LiveAlignChat
                    busyKey={busyKey}
                    canWrite={permissions.canWrite}
                    key={`${live.recording.id}:${live.recording.anchorOffsetMs}`}
                    messages={snapshot.messages}
                    onSave={(anchorOffsetMs) => {
                      const recordingId = live.recording?.id;
                      if (recordingId) {
                        void run("live:align", () => alignChat({ anchorOffsetMs, recordingId }), () => adminToast.success(liveCopy.alinharSalvo));
                      }
                    }}
                    recording={live.recording}
                  />
                ) : null}
                <LiveAttachRecording busyKey={busyKey} canWrite={permissions.canWrite} onAttach={attach} recording={live.recording} />
              </div>
              <div className="flex min-w-0 flex-col gap-6">
                <LiveHands handle={room} people={live.people} />
                <LiveParticipants busyKey={busyKey} canPublish={permissions.canPublish} handle={room} onAction={onPersonAction} people={live.people} />
              </div>
            </div>
          ) : null}
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
              personMenu={live ? chatPersonMenu : null}
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

      <ConfirmDialog
        busy={busyKey === "live:end"}
        cancelLabel={liveCopy.cancelar}
        confirmLabel={liveCopy.encerrarLive}
        description={liveCopy.encerrarConfirmarTexto}
        destructive
        onConfirm={() => void endLive()}
        onOpenChange={(open) => setConfirmingLiveEnd(open)}
        open={confirmingLiveEnd}
        title={liveCopy.encerrarConfirmar}
      />

      <ConfirmDialog
        busy={banTarget !== null && busyKey === `person:${banTarget.userId}`}
        cancelLabel={liveCopy.cancelar}
        confirmLabel={liveCopy.banir}
        description={liveCopy.banirConfirmarTexto}
        destructive
        onConfirm={() => void confirmBan()}
        onOpenChange={(open) => {
          if (!open) {
            setBanTarget(null);
          }
        }}
        open={banTarget !== null}
        title={liveCopy.banirConfirmar}
      >
        {banTarget ? (
          <p className="mb-3 text-sm leading-5 font-medium text-[var(--text-primary)]" data-live-ban-target={banTarget.userId}>
            {banTarget.name}
          </p>
        ) : null}
        <label className="flex min-w-0 flex-col gap-1.5 text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor="console-ban-reason">
          {liveCopy.motivo}
          <textarea className={cn(adminTextareaClass, "min-h-16")} id="console-ban-reason" maxLength={200} onChange={(event) => setBanReason(event.target.value)} rows={2} value={banReason} />
        </label>
      </ConfirmDialog>
    </AdminPage>
  );
}
