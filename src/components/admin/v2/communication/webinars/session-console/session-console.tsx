"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConsolePanelOpen, useConsoleTheme } from "@/components/member/webinars/room/use-room-prefs";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import type { LiveEmbedLook } from "@/lib/jitsi-room-config";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { ModerationAction } from "@/server/webinars/chat-schemas";
import {
  CONSOLE_POLL_MS,
  canTeamActOn,
  consoleClockLabel,
  consoleClockMs,
  consoleOffsetMs,
  consolePhaseOf,
  scriptQueue,
  type ConsoleMessage,
  type ConsoleSnapshot
} from "@/server/webinars/console-model";
import type { SessionConsoleData } from "@/server/webinars/console-queries";
import {
  consoleMoreEntriesFor,
  consolePanelViewOf,
  consolePresenceBadge,
  consoleStageTopLeft,
  consoleTabCounts,
  consoleTabsFor,
  consoleTopActionsFor,
  type ConsolePanelView
} from "@/server/webinars/console-v2-model";
import { editAssistantAnswer } from "@/server/webinars/assistant-actions";
import type { AttendanceSnapshot } from "@/server/webinars/assistant-queries";
import { WEBINAR_ADMIN_COPY, webinarAdminHref, webinarConsoleHref, webinarReportHref, type WebinarPermissions } from "@/server/webinars/editor-model";
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
import { LIVE_CONSOLE_COPY, desiredLobby, handRows, type LiveConsolePerson } from "@/server/webinars/live-console-model";
import type { ChatMode, QuestionStatus, SlowModeSeconds } from "@/server/webinars/model";
import { answerQuestion, closePoll, endSessionNow, launchPoll, moderateMessage, openSessionNow, sendTeamMessage, setQuestionStatus, setSessionChatMode } from "@/server/webinars/room-actions";
import { sessionDurationMs } from "@/server/webinars/room-model";
import { fireScriptItem } from "@/server/webinars/script-actions";
import { EmptyState } from "../../../empty-state";
import { ErrorBanner } from "../../../error-banner";
import { adminTextareaClass } from "../../../form";
import { ConfirmDialog } from "../../../settings/kit";
import { adminToast } from "../../../toast";
import { ConsoleAttendance } from "./console-attendance";
import { ConsoleBar } from "./console-bar";
import { ConsoleChat } from "./console-chat";
import { CONSOLE_TAB_ID_PREFIX, consoleSkeleton } from "./console-layout-model";
import { ConsoleOffer } from "./console-offer";
import { ConsolePanel } from "./console-panel";
import { ConsolePeopleTab } from "./console-people-tab";
import { ConsolePolls } from "./console-polls";
import { ConsolePresencePanel } from "./console-presence";
import { ConsoleQuestions } from "./console-questions";
import { ConsoleScript } from "./console-script";
import { ConsoleShell } from "./console-shell";
import { ConsoleStage } from "./console-stage";
import { ConsoleTopBar, type ConsolePolling } from "./console-top-bar";
import { LiveAlignChat } from "./live-align-chat";
import { LiveAttachRecording, type AttachInput } from "./live-attach-recording";
import { LiveHands } from "./live-hands";
import { LivePersonMenuItems, livePersonMenuGroups, type PersonAction } from "./live-participants";
import { LiveRecorder } from "./live-recorder";
import { useLiveRoom } from "./live-room-panel";
import { clearMessageTranslations } from "@/server/webinars/translation-actions";

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
// neste ambiente, "A sala ao vivo ainda nao esta configurada" e o resto do console funciona. Fase 4c (docs/30 §2.4 e
// D24): o painel Atendimento (console-attendance.tsx, com a propria leitura) devolve as marcas das perguntas para o
// painel Perguntas, e o Chat ganha "Corrigir resposta" nas respostas do Assistente (editAssistantAnswer). O painel
// Presenca (console-presence.tsx) abre a coluna da direita com o pico, as mensagens por minuto e os ultimos 30 minutos.
// Console V2 (docs/31 V2-12 e V2-13, fase 2 do redesign): a tela cheia, sem a barra lateral do admin (a moldura sabe
// pelo caminho, isAdminFullScreenPath), na raiz com o tema (ConsoleShell, escuro por padrao, guardado em chave
// propria), o topo enxuto (ConsoleTopBar: a seta, o titulo, o seletor, o Atualizar, o momento e os presentes, o Tema e
// os botoes de situacao de consoleTopActionsFor) e o esqueleto de consoleSkeleton, que nunca move o iframe. O tema vai
// ao iframe so na montagem (o look); trocar com a sala no ar nao remonta. As confirmacoes abrem no portal da raiz
// (container={portalRef}). Na live, o palco (console-stage.tsx, docs/31 V2-4) leva o momento ("Ao vivo · 00:42:10"),
// o Gravando, os presentes com o pico e quem esta no video grande, e o topo fica sem esses selos (os presentes voltam
// ao topo so abaixo de sm, onde o palco nao os mostra); na gravada e no Replay (sem palco) o momento e os presentes
// continuam no topo. Embaixo do palco, a barra de quem apresenta (console-bar.tsx, docs/31 V2-14): a Sala de espera,
// Microfone, Câmera, Compartilhar tela, Gravar, Mãos, Lançar enquete, a visao, Configurações e o balao do painel
// (aberto ou fechado, guardado em chave propria); o ⋮ da miniatura do video manda o Remover do aluno ligado a linha para
// o nosso Remover (onKickPerson). O painel com abas (console-panel.tsx, docs/31 V2-15): Chat, Perguntas, Mãos e
// Pessoas na live (Chat e Perguntas na gravada e no Replay), com o numero das perguntas abertas e das maos, e o ⋯ com
// Enquetes, Roteiro, Oferta, Atendimento, Presença e Gravação conforme a sessao; tudo montado, o que nao esta na tela
// com `hidden`. A aba e a entrada escolhidas ficam so na memoria da pagina; Mãos, Lançar enquete e o Gravar por
// preparar abrem o painel nelas (openPanel) e o foco vai a aba (ou ao ⋯) escolhida.

const copy = WEBINAR_ADMIN_COPY.console;
const liveCopy = WEBINAR_COPY.consoleAoVivo;

type Failure = { message: string; status: number };

type SessionConsoleProps = {
  currentUserId: string;
  data: SessionConsoleData;
  /** O nonce da pagina (cabecalho x-nonce do src/proxy.ts) para o <script> da sala ao vivo. */
  nonce?: string | null;
  permissions: WebinarPermissions;
  /** Hora do servidor na carga, para o skew do relogio da sessao. */
  serverNow: number;
  /** WEBINAR_TRANSLATION_ENABLED=on (lido no servidor): o "Refazer tradução" das mensagens. */
  translationEnabled?: boolean;
};

type BanTarget = { name: string; participantId: string | null; userId: string };

export function SessionConsole({ currentUserId, data, nonce = null, permissions, serverNow, translationEnabled = false }: SessionConsoleProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(data.snapshot);
  const [skew] = useState(() => serverNow - Date.now());
  const [tick, setTick] = useState(() => Date.now());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [polling, setPolling] = useState<ConsolePolling>("idle");
  const [confirming, setConfirming] = useState<"end" | "open" | null>(null);
  const [confirmingLiveEnd, setConfirmingLiveEnd] = useState(false);
  const [banTarget, setBanTarget] = useState<BanTarget | null>(null);
  const [banReason, setBanReason] = useState("");
  const [recordUnavailable, setRecordUnavailable] = useState(false);
  const [attendance, setAttendance] = useState<AttendanceSnapshot | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /** Onde as confirmacoes e os menus do console abrem: dentro da raiz, no tema (o ConsoleShell liga o ref ao div). */
  const portalRef = useRef<HTMLDivElement | null>(null);
  const [theme, setTheme] = useConsoleTheme();
  const [panelOpen, setPanelOpen] = useConsolePanelOpen();
  /** A aba ou a entrada do ⋯ escolhida no painel, so na memoria da pagina (o Chat ao abrir). */
  const [panelView, setPanelView] = useState<ConsolePanelView>({ tab: "chat" });
  // O tema do console vai ao iframe na montagem (no hash, para o CSS da instancia); trocar depois nao remonta a sala.
  const look = useMemo<LiveEmbedLook>(() => ({ layout: "stage", theme }), [theme]);
  const session = snapshot?.session ?? null;
  const sessionId = session?.id ?? null;
  const webinar = data.webinar;
  const durationMs = sessionDurationMs(webinar.recordingDurationSeconds, webinar.durationMinutes);
  const nowMs = tick + skew;
  const offsetMs = session ? consoleOffsetMs(session, tick, skew) : Number.NaN;
  // O topo conta o tempo da sessao (desde o Iniciar live na ao vivo) e para no encerramento; o roteiro segue offsetMs.
  const clockMs = session ? consoleClockMs(session, durationMs, nowMs) : Number.NaN;
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
    look,
    nonce,
    onAnchor: markAnchor,
    onBrowserRecording,
    // O Remover do ⋮ da miniatura do video com o aluno ligado a linha: o mesmo Remover da lista (o registro, depois o motor).
    onKickPerson: (person, participantId) => onPersonAction(person, participantId, { type: "kick" }),
    session,
    webinar
  });

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

  // Os itens da pessoa no ⋯ de uma mensagem da turma (Silenciar, Remover, Banir); nada para a equipe e para quem o
  // retrato nao liga. Sem o participante (participantId nulo), os itens da sala ficam de fora.
  function chatPersonMenu(message: ConsoleMessage) {
    const person = message.authorUserId ? (livePeople.get(message.authorUserId) ?? null) : null;

    if (!person || person.staff || !livePersonMenuGroups({ controls: room.controls, participantId: null, person }).any) {
      return null;
    }

    return (
      <LivePersonMenuItems
        canPublish={permissions.canPublish}
        controls={room.controls}
        joined={room.joined}
        onAction={(action) => onPersonAction(person, person.participantId, action)}
        participantId={null}
        person={person}
      />
    );
  }

  const sessionDisabledTitle = room.controls.sessionEnabled ? undefined : LIVE_CONSOLE_COPY.soQuemPublica;
  const topActions =
    session && phase
      ? consoleTopActionsFor({ canPublish: permissions.canPublish, controls: room.controls, kind: session.kind, phase, status: session.status })
      : [];
  // Sem palco (a gravada e o Replay) o painel nunca fecha: ele e o corpo inteiro.
  const panelShown = live === null || panelOpen;
  const skeleton = consoleSkeleton({ hasStage: live !== null, panelOpen });
  const tabs = session ? consoleTabsFor({ kind: session.kind }) : [];
  const entries = session ? consoleMoreEntriesFor({ hasPresence: Boolean(snapshot?.presence), kind: session.kind, webinarKind: webinar.kind }) : [];
  const shownView = consolePanelViewOf({ entries, tabs, view: panelView });
  const counts = consoleTabCounts({ hands: live ? handRows(room.room, live.people).length : 0, questions: snapshot?.questions ?? [] });
  const presentLabel = session ? consolePresenceBadge({ peak: snapshot?.presence?.peak?.present ?? null, presentNow: snapshot?.presentNow ?? 0 }) : null;
  // O nome do apresentador da pagina (o perfil de quem apresenta, lido no servidor) para o selo de outro moderador no
  // video grande, como o aluno ve (docs/31 V2-A25), em todo console, inclusive no do proprio Apresentador.
  const presenterName = live ? (webinar.presenterName ?? null) : null;

  function onTopAction(id: "end_live" | "end_session" | "open_room" | "open_session" | "start") {
    switch (id) {
      case "open_room":
        void openRoom();
        return;
      case "start":
        void startForAll();
        return;
      case "end_live":
        setConfirmingLiveEnd(true);
        return;
      case "open_session":
        setConfirming("open");
        return;
      case "end_session":
        setConfirming("end");
        return;
      default:
        return;
    }
  }

  /**
   * Abre o painel na aba ou na entrada do ⋯ (Mãos, Lançar enquete e o Gravar por preparar, na barra) e leva o foco a ela,
   * depois de o painel aparecer.
   */
  function openPanel(view: ConsolePanelView) {
    setPanelOpen(true);
    setPanelView(view);
    window.requestAnimationFrame(() => {
      const target = "tab" in view ? document.getElementById(`${CONSOLE_TAB_ID_PREFIX}-tabbtn-${view.tab}`) : document.querySelector<HTMLElement>("[data-console-more-trigger]");
      target?.focus();
    });
  }

  /** O X do painel: o foco vai ao balao da barra antes de o painel sumir (senao ele cairia no body). */
  function closePanel() {
    document.querySelector<HTMLButtonElement>('[data-console-bar] [data-room-bar-item="panel"]')?.focus();
    setPanelOpen(false);
  }

  const readOnly = Boolean(session) && !canAct;
  const onlyPublishers = live !== null && room.controls.session && !room.controls.sessionEnabled;
  const banner =
    failure || readOnly || onlyPublishers ? (
      <>
        {failure ? (
          <ErrorBanner
            action={
              <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setFailure(null)} type="button" variant="ghost">
                {WEBINAR_COPY.consoleV2.fecharAviso}
              </Button>
            }
            title={failure.status === 409 ? WEBINAR_ADMIN_COPY.failures.conflictTitle : WEBINAR_ADMIN_COPY.failures.generic}
          >
            {failure.message}
          </ErrorBanner>
        ) : null}
        {readOnly ? <p className="text-[13px] leading-5 text-room-fg-muted">{copy.readOnly}</p> : null}
        {onlyPublishers ? <p className="text-[13px] leading-5 text-room-fg-muted">{LIVE_CONSOLE_COPY.soQuemPublica}</p> : null}
      </>
    ) : null;

  const top = (
    <ConsoleTopBar
      actions={topActions}
      busyKey={busyKey}
      canWrite={permissions.canWrite}
      className={skeleton.top}
      clockLabel={session && phase && !live ? consoleClockLabel(clockMs, phase) : ""}
      disabledTitle={sessionDisabledTitle}
      editorHref={webinarAdminHref(webinar.id)}
      onAction={onTopAction}
      onChangeSession={changeSession}
      onLock={lockRoom}
      onRefresh={() => void refresh()}
      onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
      polling={polling}
      presentLabel={presentLabel}
      presentNarrowOnly={live !== null}
      reportHref={webinarReportHref(webinar.id)}
      roomLocked={live?.roomLocked === true}
      sessionId={sessionId}
      sessions={data.sessions}
      theme={theme}
      title={webinar.title}
    />
  );

  return (
    <>
      <ConsoleShell banner={banner} classNames={skeleton} portalRef={portalRef} theme={theme} top={top}>
        {!snapshot || !session ? (
          <div className={skeleton.body}>
            <div className={skeleton.panel}>
              <EmptyState description={WEBINAR_ADMIN_COPY.simulation.noSessions} title={WEBINAR_ADMIN_COPY.fields.sessionsEmpty} />
            </div>
          </div>
        ) : (
          <div className={skeleton.body} data-console-slot="body">
            {live && skeleton.stageColumn ? (
              <div className={skeleton.stageColumn} data-console-slot="stage-column" data-live-console="">
                <ConsoleStage
                  busy={busyKey !== null}
                  className={skeleton.stage ?? ""}
                  handle={room}
                  live={live}
                  presentLabel={presentLabel}
                  presenterName={presenterName}
                  session={session}
                  stageRef={stageRef}
                  topLeft={consoleStageTopLeft({ durationMs, nowMs: tick, session, skewMs: skew })}
                />
                <div className={skeleton.bar ?? ""} data-console-slot="bar">
                  <ConsoleBar
                    busyKey={busyKey}
                    canPublish={permissions.canPublish}
                    handle={room}
                    handsCount={counts.maos}
                    live={live}
                    nowMs={nowMs}
                    onOpenPanel={openPanel}
                    onRecord={recordNow}
                    onStopRecording={stopRecording}
                    onTogglePanel={() => setPanelOpen(!panelOpen)}
                    panelOpen={panelOpen}
                    session={session}
                  />
                </div>
              </div>
            ) : null}
            <ConsolePanel
              className={skeleton.panel}
              closable={live !== null}
              counts={counts}
              entries={entries}
              more={{
                atendimento: (
                  // docs/30 §2.4 e D24 (fase 4c): o Atendimento le pelo proprio pedido e sobe as marcas para as Perguntas; fica
                  // montado (a batida de 30 s de quem atende) com qualquer aba na tela.
                  <ConsoleAttendance canAct={canAct} currentUserId={currentUserId} key={session.id} onSnapshot={setAttendance} sessionId={session.id} webinarId={webinar.id} />
                ),
                enquetes: (
                  <ConsolePolls
                    busyKey={busyKey}
                    canAct={canAct}
                    launched={snapshot.polls.launched}
                    onClose={(pollId: string, shareResults: boolean) => void run(`poll:${pollId}`, () => closePoll({ pollId, sessionId: session.id, shareResults }))}
                    onLaunch={(pollId: string) => void run(`poll:${pollId}`, () => launchPoll({ pollId, sessionId: session.id }))}
                    templates={snapshot.polls.templates}
                  />
                ),
                gravacao: live ? (
                  <>
                    <LiveRecorder
                      busyKey={busyKey}
                      canPublish={permissions.canPublish}
                      controls={room.controls}
                      joined={room.joined}
                      nowMs={nowMs}
                      onBrowserRecord={() => room.command("startRecording", { mode: "local", onlySelf: false })}
                      onPrepare={() => void run("live:rec-prepare", () => prepareRecorder({ sessionId: session.id }))}
                      onRelease={() => void run("live:rec-release", () => releaseRecorder({ sessionId: session.id }))}
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
                  </>
                ) : null,
                // Fase 4b (docs/30 §2.4): a Oferta na sessao gravada e no Replay, com a propria leitura.
                oferta: session.kind !== "live" ? <ConsoleOffer canAct={canAct} sessionId={session.id} webinarId={webinar.id} /> : null,
                // docs/30 §2.4: a Presenca (pico, mensagens por minuto, curva dos ultimos 30 min), pela visao do relatorio em cache.
                presenca: snapshot.presence ? <ConsolePresencePanel presence={snapshot.presence} presentNow={snapshot.presentNow} /> : null,
                roteiro:
                  webinar.kind === "simulated" ? (
                    <ConsoleScript busyKey={busyKey} canAct={canAct} onFire={(itemId: string) => void run(`fire:${itemId}`, () => fireScriptItem({ itemId, sessionId: session.id }))} queue={queue} />
                  ) : null
              }}
              onClose={closePanel}
              onView={setPanelView}
              open={panelShown}
              panes={{
                chat: (
                  <ConsoleChat
                    busyKey={busyKey}
                    canAct={canAct}
                    currentUserId={currentUserId}
                    hostUserId={webinar.hostUserId}
                    messages={snapshot.messages}
                    onChatMode={(chatMode: ChatMode, slowModeSeconds: SlowModeSeconds | null) => void run("chat-mode", () => setSessionChatMode({ chatMode, sessionId: session.id, slowModeSeconds }))}
                    onEditAssistant={(messageId: string, body: string) =>
                      run(`moderate:${messageId}`, () => editAssistantAnswer({ body, messageId }), () => adminToast.success(WEBINAR_COPY.assistente.console.corrigida))
                    }
                    onModerate={(action: ModerationAction, messageId: string) => void run(`moderate:${messageId}`, () => moderateMessage({ action, messageId }))}
                    onRetranslate={
                      translationEnabled
                        ? (messageId: string) =>
                            void run(
                              `moderate:${messageId}`,
                              () => clearMessageTranslations({ messageId }),
                              (cleared) => adminToast.success(cleared.removed > 0 ? WEBINAR_COPY.traducao.console.refeita(cleared.removed) : WEBINAR_COPY.traducao.console.semTraducao)
                            )
                        : null
                    }
                    onSend={(body: string) => run("send", () => sendTeamMessage({ body, sessionId: session.id }), () => adminToast.success(WEBINAR_ADMIN_COPY.toasts.messageSent))}
                    personMenu={live ? chatPersonMenu : null}
                    pinnedMessageId={snapshot.pinnedMessageId}
                    questions={snapshot.questions}
                    session={session}
                  />
                ),
                maos: live ? <LiveHands handle={room} people={live.people} /> : null,
                perguntas: (
                  <ConsoleQuestions
                    busyKey={busyKey}
                    canAct={canAct}
                    marks={attendance && attendance.sessionId === session.id ? attendance.questionMarks : null}
                    onAnswer={(questionId: string, answerText: string, answeredLive: boolean) => run(`question:${questionId}`, () => answerQuestion({ answerText: answerText || undefined, answeredLive, questionId }))}
                    onStatus={(questionId: string, status: QuestionStatus) => void run(`question:${questionId}`, () => setQuestionStatus({ questionId, status }))}
                    questions={snapshot.questions}
                  />
                ),
                pessoas: live ? <ConsolePeopleTab busyKey={busyKey} canPublish={permissions.canPublish} handle={room} onAction={onPersonAction} people={live.people} /> : null
              }}
              tabs={tabs}
              view={shownView}
            />
          </div>
        )}
      </ConsoleShell>

      <ConfirmDialog
        busy={busyKey === "open" || busyKey === "end"}
        container={portalRef}
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
        container={portalRef}
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
        container={portalRef}
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
    </>
  );
}
