"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { announceLiveRoomMedia } from "@/lib/lesson-media-signal";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { roomMediaLessonId } from "@/lib/webinar-room-client";
import { formatCountdown } from "@/lib/webinar-time";
import type { LiveRoomInfo } from "@/server/webinars/live-model";
import { roomHref, type StudentRoomPayload } from "@/server/webinars/student-model";
import { LiveControls } from "./live-controls";
import { LiveCameraDialog, LiveChatOverlay, LiveMicDialog, LiveParticipantsTab, LivePillInfo, LiveRecordingBadge } from "./live-notices";
import {
  cameraClick,
  isRecording,
  LIVE_ROOM_RULES,
  liveAcceptsWrites,
  liveComposerNotice,
  liveNoticePhrase,
  liveOnAirLabel,
  livePhaseOf,
  liveRoomScreen,
  liveShortcutOf,
  localBanStillValid,
  mergeBan,
  overlayMessages,
  prefersCinemaMode,
  screenBlocksRoom,
  stageNames,
  usesOurBar,
  writeRefusalOf,
  type LiveJoinFailure
} from "./live-room-model";
import { LiveStage } from "./live-stage";
import { RoomChatPanel } from "./room-chat";
import { RoomHeader } from "./room-header";
import { RoomPollsTab } from "./room-polls";
import { RoomQuestionsTab } from "./room-questions";
import { RoomReactionBubbles } from "./room-reactions";
import { useRoomChat, useRoomClock, useRoomHeartbeat, useRoomReactions } from "./use-room-data";
import { entryInRoom, useLiveRoom } from "./use-live-room";
import { trapRoomFocus, useRoomDialogLock, useRoomReducedMotion } from "./webinar-room";

// A sala da Live ao vivo do aluno (docs/30 §1.3, §1.4, §1.5, §1.7, §5.1, §6.3, §8.5 e §9; fase 3), no mesmo endereco
// da gravada (/webinarios/[slug]/sala?sessao=) e no mesmo dialogo de tela cheia (aria-modal, foco preso, Esc pede
// confirmacao com a live no ar). O cabecalho ("Ao vivo · 00:42:10" pelo inicio de verdade, "{n} assistindo", o selo
// Gravando, Minimizar e Sair), o palco com o iframe (live-stage.tsx: Entrar na sala, Reconectando…, a sala trancada,
// em breve, encerrada), a nossa barra (live-controls.tsx), as abas Chat / Perguntas / Participantes / Enquetes (a de
// Enquetes so com enquete aberta; no celular, gaveta pela aba de baixo e as 3 ultimas mensagens por cima do palco com
// ela fechada) e os avisos de gravacao da camera e do microfone (live-notices.tsx). O chat, as perguntas, as enquetes,
// as reacoes e o sinal de presenca sao os da fase 2; o offset do chat e do servidor. Silenciado no chat: o campo da
// lugar a frase com a hora de Sao Paulo; removido ou banido (pela sessao ou por um 409 de qualquer rota): a sala da
// lugar a frase e o iframe desmonta; encerrada (a sessao relida, o sinal de presenca ou o join-token): o iframe
// desmonta e o palco mostra o fim, com Assistir o replay quando ha. Minimizar encolhe a sala para a pilula de 56 px
// sem tirar o palco do lugar (a live continua tocando); com a sala ou a pilula no ar, nenhum pop-up abre
// (announceLiveRoomMedia). Host e co-apresentador que entram por aqui usam a barra do iframe. No "ver como" da equipe
// nada e gravado: nem token, nem sinal, nem chat.

type Tab = "chat" | "enquetes" | "participantes" | "perguntas";

export type LiveWebinarRoomProps = {
  coverUrl: string | null;
  /** O nonce da pagina (o external_api.js entra com ele; a CSP nao ganha origem nova). */
  nonce: string | null;
  payload: StudentRoomPayload;
  /** O apresentador (a pagina sabe; vai em "No palco"). */
  presenterName: string | null;
  /** "Ver como" da equipe: a sala abre e nada e gravado. */
  readOnly: boolean;
  /** Host, co-apresentador ou Equipe: entram tambem na Sessao de pratica e com a sala trancada. */
  staff: boolean;
  /** A pagina da live (Sair e Esc voltam para ca). */
  webinarHref: string;
};

/**
 * O que uma recusa contou antes de a sessao ser relida. `ended` e `unconfigured` ficam (nao se desfazem); banido,
 * removido e silenciado valem so ate a proxima leitura da sessao (`refusedAtMs`, localBanStillValid): o silencio que
 * venceu e o Desfazer da equipe liberam a sala sem recarregar.
 */
type LocalState = { banned: boolean; ended: boolean; kicked: boolean; muted: boolean; refusedAtMs: number | null; unconfigured: boolean };

const NO_LOCAL: LocalState = { banned: false, ended: false, kicked: false, muted: false, refusedAtMs: null, unconfigured: false };
const NO_LOCAL_BAN = { banned: false, kicked: false, muted: false };

function subscribeNothing() {
  return () => undefined;
}

/** O computador (lg): o painel fica sempre aberto a direita; no celular, a gaveta abre e fecha pela aba de baixo. */
const DESKTOP = "(min-width: 1024px)";

function subscribeDesktop(callback: () => void) {
  try {
    const media = window.matchMedia(DESKTOP);
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  } catch {
    return () => undefined;
  }
}

function readDesktop() {
  try {
    return window.matchMedia(DESKTOP).matches;
  } catch {
    return false;
  }
}

function readCinemaPreferred() {
  try {
    const doc = document as Document & { webkitFullscreenEnabled?: boolean };
    return prefersCinemaMode({ fullscreenEnabled: Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled), userAgent: navigator.userAgent });
  } catch {
    return false;
  }
}

/** A resposta sem o bloco `live` (um servidor antigo): o ambiente sem a sala ao vivo, nada quebra. */
function liveInfoOf(payload: StudentRoomPayload): LiveRoomInfo {
  return payload.live ?? { lobby: false, locked: false, meetConfigured: false, practice: false, recording: false, startedAt: payload.session.startedAt, status: payload.session.status };
}

export function LiveWebinarRoom({ coverUrl, nonce, payload, presenterName, readOnly, staff, webinarHref }: LiveWebinarRoomProps) {
  const copy = WEBINAR_COPY.sala;
  const router = useRouter();
  const webinarId = payload.webinar.id;
  const sessionId = payload.session.id;
  const lessonId = roomMediaLessonId(sessionId);
  const { refresh: refreshSession, session, skewMs, skewRef } = useRoomClock({ enabled: !readOnly, initial: payload, webinarId });
  // A hora (do servidor) da leitura da sessao que a sala tem: a recusa local so vale enquanto ela e de antes da recusa.
  const sessionTimeRef = useRef(session.serverTime);
  useEffect(() => {
    sessionTimeRef.current = session.serverTime;
  }, [session.serverTime]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.parse(payload.serverTime));
  const [minimized, setMinimized] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [cameraAsk, setCameraAsk] = useState(false);
  const [cameraConsented, setCameraConsented] = useState(false);
  const [fullscreenOn, setFullscreenOn] = useState(false);
  const [cinemaOn, setCinemaOn] = useState(false);
  const [local, setLocal] = useState<LocalState>(NO_LOCAL);
  const [heartbeatPresent, setHeartbeatPresent] = useState<number | null>(null);
  const reducedMotion = useRoomReducedMotion();
  const cinemaPreferred = useSyncExternalStore(subscribeNothing, readCinemaPreferred, () => false);
  const desktop = useSyncExternalStore(subscribeDesktop, readDesktop, () => false);
  const drawerVisible = desktop || drawerOpen;

  const info = liveInfoOf(session);
  const status = local.ended ? "ended" : info.status;
  const live: LiveRoomInfo = { ...info, status };
  const localBan = localBanStillValid({ refusedAtMs: local.refusedAtMs, serverTimeIso: session.serverTime, skewMs }) ? local : NO_LOCAL_BAN;
  const ban = mergeBan(session.me.ban, localBan);
  const screenInput = { ban, live, staff, unconfigured: local.unconfigured };
  // O iframe pode montar quando a sala esta aberta para a pessoa (a tranca so barra quem ainda nao entrou).
  const allowed = !readOnly && liveRoomScreen({ ...screenInput, inRoom: true }) === "open";
  const phase = livePhaseOf(status);
  const writable = liveAcceptsWrites(status);

  /** O join-token (ou um lote de sinais) recusou: a tela muda na hora e a sessao e relida. */
  const onRefused = useCallback(
    (failure: Exclude<LiveJoinFailure, "error">) => {
      setLocal((previous) => {
        const barred = failure === "banned" || failure === "kicked";
        // Uma recusa nova recomeca a ponte (a de antes ja foi coberta pela leitura, ou ainda vale e soma).
        const base = barred && !localBanStillValid({ refusedAtMs: previous.refusedAtMs, serverTimeIso: sessionTimeRef.current, skewMs: skewRef.current ?? 0 }) ? { ...previous, ...NO_LOCAL_BAN } : previous;
        return {
          ...base,
          banned: base.banned || failure === "banned",
          ended: base.ended || failure === "ended",
          kicked: base.kicked || failure === "kicked",
          refusedAtMs: barred ? Date.now() : base.refusedAtMs,
          unconfigured: base.unconfigured || failure === "meet_unconfigured"
        };
      });
      void refreshSession();
    },
    [refreshSession, skewRef]
  );

  const room = useLiveRoom({ allowed, container: frameRef, frameTitle: WEBINAR_COPY.aoVivo.palco, lobby: live.lobby === true, nonce, onRefused, sessionId, webinarId });
  const screen = liveRoomScreen({ ...screenInput, inRoom: entryInRoom(room.entry) });
  const blocked = screenBlocksRoom(screen);
  // Dentro da sala de verdade: com a tela fechada (encerrada, removido) o iframe ja desmontou.
  const joined = allowed && room.entry === "joined";
  const ourBar = usesOurBar(room.reply?.role ?? null);

  /** Uma escrita da sala foi recusada (409 banned / muted / ended de qualquer rota). */
  const onWriteRefused = useCallback(
    (error: unknown) => {
      const refusal = writeRefusalOf(error);
      if (!refusal) {
        return;
      }
      setLocal((previous) => {
        const barred = refusal !== "ended";
        const base = barred && !localBanStillValid({ refusedAtMs: previous.refusedAtMs, serverTimeIso: sessionTimeRef.current, skewMs: skewRef.current ?? 0 }) ? { ...previous, ...NO_LOCAL_BAN } : previous;
        return {
          ...base,
          banned: base.banned || refusal === "banned",
          ended: base.ended || refusal === "ended",
          kicked: base.kicked || refusal === "kicked",
          muted: base.muted || refusal === "muted",
          refusedAtMs: barred ? Date.now() : base.refusedAtMs
        };
      });
      void refreshSession();
    },
    [refreshSession, skewRef]
  );

  // O relogio da sala, a cada segundo (o tempo no ar, a contagem, o fim do silencio).
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Antes de abrir (ou com a sala trancada para quem ainda nao entrou), a sessao e relida a cada 15 s: o botao aparece
  // sozinho quando a equipe abre a sala; no ar, os 60 s do relogio bastam.
  const waitingForRoom = !readOnly && (screen === "waiting" || screen === "locked");
  useEffect(() => {
    if (!waitingForRoom) {
      return;
    }
    const id = window.setInterval(() => void refreshSession(), LIVE_ROOM_RULES.waitingRefreshMs);
    return () => window.clearInterval(id);
  }, [refreshSession, waitingForRoom]);

  // Com a sala ou a pilula no ar, nenhum pop-up abre (docs/30 §1.5; docs/25 §1): a mesma trava do player da aula.
  useEffect(() => {
    announceLiveRoomMedia({ lessonId, on: true });
    return () => announceLiveRoomMedia({ lessonId, on: false });
  }, [lessonId]);

  useEffect(() => {
    const onChange = () => setFullscreenOn(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // O offset do chat da live e do servidor: o zero da sessao (a ancora, ou o inicio) pela ultima leitura.
  const zeroMs = useMemo(() => {
    const offset = session.session.offsetMs;
    const serverNow = Date.parse(session.serverTime);
    if (typeof offset === "number" && Number.isFinite(serverNow)) {
      return serverNow - offset;
    }
    return Date.parse(session.session.startedAt ?? session.session.scheduledAt);
  }, [session.serverTime, session.session.offsetMs, session.session.scheduledAt, session.session.startedAt]);

  const getOffsetMs = useCallback(() => Date.now() + (skewRef.current ?? 0) - zeroMs, [skewRef, zeroMs]);

  const chat = useRoomChat({ enabled: !readOnly && !blocked, getPlayerOffsetMs: getOffsetMs, initialServerTime: payload.serverTime, sessionId, webinarId });
  const reactions = useRoomReactions({ enabled: !readOnly && writable && !blocked, getOffsetMs, onRefused: onWriteRefused, reducedMotion, sessionId, webinarId });

  useRoomHeartbeat({
    enabled: !readOnly && writable && !blocked,
    getOffsetSeconds: () => Math.floor(getOffsetMs() / 1000),
    getState: () => (joined ? "playing" : "paused"),
    onAnswer: (answer) => {
      setHeartbeatPresent(answer.presentNow);
      if (answer.ended) {
        setLocal((previous) => (previous.ended ? previous : { ...previous, ended: true }));
      }
    },
    sessionId,
    webinarId
  });

  const presentNow = heartbeatPresent ?? session.presentNow;
  const openPolls = session.polls.filter((poll) => poll.status === "open");
  const showPollsTab = openPolls.length > 0 || tab === "enquetes";
  const replayHref = session.webinar.replaySessionId ? roomHref(session.webinar.slug, session.webinar.replaySessionId) : null;
  const scheduledMs = Date.parse(session.session.scheduledAt);
  const countdown = screen === "waiting" ? formatCountdown(scheduledMs, nowMs + skewMs) : "";
  const composerNotice = liveComposerNotice({ ban, nowMs, status });
  const recording = isRecording(room.signals, live);
  const notice = liveNoticePhrase(room.signals.notice === "mic_released" ? null : room.signals.notice);
  const stage = stageNames(room.signals.participants, presenterName);

  function leave() {
    room.hangUp();
    router.push(webinarHref);
  }

  /** Sair e Esc: com a live no ar (ou dentro do iframe), pergunta antes (docs/30 §1.7). */
  function askToLeave() {
    if ((phase === "live" || joined) && !minimized && !blocked) {
      setConfirmLeave(true);
      return;
    }
    leave();
  }

  useRoomDialogLock(rootRef, !minimized);

  function openPollsTab() {
    if (openPolls.length > 0) {
      setTab("enquetes");
      setDrawerOpen(true);
    }
  }

  function selectTab(value: Tab) {
    if (value === tab) {
      // No celular, a aba de baixo abre e fecha a gaveta (no computador o painel fica aberto).
      if (!desktop) {
        setDrawerOpen((open) => !open);
      }
      return;
    }
    setTab(value);
    setDrawerOpen(true);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (confirmLeave) {
        setConfirmLeave(false);
      } else if (reactionsOpen || helpOpen) {
        setReactionsOpen(false);
        setHelpOpen(false);
      } else {
        askToLeave();
      }
      return;
    }
    if (minimized) {
      return;
    }
    if (event.key === "Tab") {
      trapRoomFocus(event, rootRef.current);
      return;
    }
    const target = event.target as HTMLElement | null;
    const shortcut = liveShortcutOf({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      editable: Boolean(target?.isContentEditable),
      key: event.key,
      metaKey: event.metaKey,
      tagName: target?.tagName ?? null
    });
    if (!shortcut || blocked) {
      return;
    }
    event.preventDefault();
    if (shortcut === "react") {
      setReactionsOpen((open) => !open);
    } else if (shortcut === "hand" && ourBar && joined) {
      room.toggleHand();
    } else if (shortcut === "poll") {
      openPollsTab();
    }
  }

  function onCamera() {
    const action = cameraClick({ allowStudentCamera: room.reply?.settings.allowStudentCamera ?? false, consented: cameraConsented, videoOn: room.signals.videoOn });
    if (action === "blocked") {
      room.showNotice("camera_blocked");
    } else if (action === "ask") {
      // O PRIMEIRO ligar passa pelo aviso de gravacao e de consumo (docs/30 §8.5); so Ligar câmera chega ao iframe.
      setCameraAsk(true);
    } else {
      room.toggleCamera(false);
    }
  }

  function confirmCamera() {
    setCameraAsk(false);
    setCameraConsented(true);
    room.toggleCamera(true);
  }

  function toggleFullscreen() {
    if (cinemaPreferred) {
      setCinemaOn((on) => !on);
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const element = stageRef.current;
    if (element?.requestFullscreen) {
      void element.requestFullscreen().catch(() => setCinemaOn(true));
    } else {
      setCinemaOn(true);
    }
  }

  const tabs: Tab[] = ["chat", "perguntas", "participantes", ...(showPollsTab ? (["enquetes"] as const) : [])];
  const tabLabel = (value: Tab) => (value === "chat" ? copy.abas.chat : value === "perguntas" ? copy.abas.perguntas : value === "participantes" ? copy.abas.participantes : copy.abas.enquetes);
  // O palco cresce com a gaveta fechada, no Modo cinema (o chat fica embaixo, menor) e na frase de removido / banido.
  const stageGrows = blocked || !drawerVisible || cinemaOn;

  return (
    <div
      aria-label={session.webinar.title}
      aria-modal={!minimized || undefined}
      className={cn(
        "z-[60] text-white",
        minimized
          ? "fixed bottom-4 right-4 flex h-14 w-[min(22rem,calc(100vw-2rem))] items-center gap-2 overflow-hidden rounded-[16px] border border-white/15 bg-[#121212] pr-2 shadow-[0_18px_48px_rgba(0,0,0,0.6)]"
          : "fixed inset-0 flex flex-col bg-[#0b0b0b]"
      )}
      data-room-kind="live"
      data-room-minimized={minimized ? "" : undefined}
      data-room-phase={phase}
      data-room-screen={screen}
      data-testid={minimized ? "room-pill" : undefined}
      onKeyDown={handleKeyDown}
      ref={rootRef}
      role="dialog"
    >
      {minimized ? null : (
        <RoomHeader
          badge={recording && !blocked ? <LiveRecordingBadge /> : null}
          kind="live"
          liveLabel={liveOnAirLabel(live.startedAt ?? session.session.startedAt, nowMs, skewMs)}
          onLeave={askToLeave}
          onMinimize={() => setMinimized(true)}
          phase={phase}
          presentNow={presentNow}
          showLiveBadge
          timeLabel=""
          title={session.webinar.title}
        />
      )}

      {confirmLeave && !minimized ? (
        <div aria-label={copy.sairConfirmar} className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/30 bg-amber-500/10 px-3 py-2" role="alertdialog">
          <p className="text-sm font-semibold text-amber-100">{copy.sairConfirmar}</p>
          <div className="flex gap-2">
            <MemberButton data-room-first-focus onClick={leave} size="sm" variant="danger">
              {copy.sair}
            </MemberButton>
            <MemberButton onClick={() => setConfirmLeave(false)} size="sm" variant="secondary">
              {copy.voltar}
            </MemberButton>
          </div>
        </div>
      ) : null}

      <div className={minimized ? "contents" : "flex min-h-0 flex-1 flex-col lg:flex-row"}>
        <div
          className={cn(
            minimized ? "relative h-14 w-24 shrink-0 overflow-hidden rounded-l-[14px] bg-black" : "relative flex shrink-0 flex-col bg-black lg:min-h-0 lg:min-w-0 lg:flex-1",
            !minimized && stageGrows ? "min-h-0 flex-1" : undefined
          )}
        >
          <LiveStage
            className={cn("w-full lg:aspect-auto lg:min-h-0 lg:flex-1", stageGrows ? "min-h-0 flex-1" : "aspect-video")}
            countdownLabel={countdown ? copy.comecaEm(countdown) : ""}
            coverUrl={coverUrl}
            entry={room.entry}
            frameRef={frameRef}
            lobby={live.lobby === true}
            minimized={minimized}
            onEnter={room.enter}
            onRetry={room.retryNow}
            readOnly={readOnly}
            replayHref={replayHref}
            screen={screen}
            sessionId={sessionId}
            stageRef={stageRef}
            title={session.webinar.title}
          >
            <RoomReactionBubbles bubbles={reactions.bubbles} overflow={reactions.overflow} />
            {!drawerVisible && !blocked ? <LiveChatOverlay messages={overlayMessages(chat.messages)} /> : null}
          </LiveStage>
          {minimized || blocked || screen === "ended" ? null : (
            <LiveControls
              allowStudentCamera={room.reply ? room.reply.settings.allowStudentCamera : null}
              audioOn={room.signals.audioOn}
              cinemaMode={cinemaPreferred}
              cinemaOn={cinemaOn}
              fullscreenOn={fullscreenOn}
              handRaised={room.signals.handRaised}
              helpOpen={helpOpen}
              joined={joined}
              micAllowed={room.signals.micAllowed}
              notice={notice}
              onCamera={onCamera}
              onFullscreen={toggleFullscreen}
              onHand={room.toggleHand}
              onMic={room.toggleMic}
              onReact={reactions.react}
              onSound={room.toggleSound}
              onToggleHelp={() => setHelpOpen((open) => !open)}
              onToggleReactions={() => setReactionsOpen((open) => !open)}
              reactionsDisabled={readOnly || !writable}
              reactionsOpen={reactionsOpen}
              showMedia={ourBar}
              soundOn={room.soundOn}
              videoOn={room.signals.videoOn}
            />
          )}
        </div>

        {minimized || blocked ? null : (
          <aside
            className={cn(
              "flex min-h-0 flex-col border-t border-white/10 bg-[#0f0f0f] lg:w-[360px] lg:flex-none lg:border-l lg:border-t-0",
              drawerVisible && !cinemaOn ? "flex-1" : "flex-none"
            )}
            data-drawer-open={drawerVisible ? "" : undefined}
            data-testid="room-panel"
          >
            <div
              aria-label={copy.abas.chat}
              className="order-last flex shrink-0 border-t border-white/10 pb-[env(safe-area-inset-bottom)] lg:order-first lg:border-b lg:border-t-0 lg:pb-0"
              role="tablist"
            >
              {tabs.map((value) => (
                <button
                  aria-controls={`room-tab-${value}`}
                  aria-expanded={value === tab && !desktop ? drawerOpen : undefined}
                  aria-selected={tab === value}
                  className={cn(
                    "relative h-11 min-w-0 flex-1 truncate px-1 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white motion-reduce:transition-none sm:text-sm",
                    tab === value ? "text-white" : "text-zinc-400 hover:text-white"
                  )}
                  data-room-first-focus={value === "chat" ? "" : undefined}
                  id={`room-tabbtn-${value}`}
                  key={value}
                  onClick={() => selectTab(value)}
                  role="tab"
                  type="button"
                >
                  {tabLabel(value)}
                  {value === "enquetes" && openPolls.length > 0 ? <span aria-hidden="true" className="ml-1 inline-block size-1.5 rounded-full bg-[var(--accent)] align-middle" /> : null}
                  {tab === value ? <span aria-hidden="true" className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" /> : null}
                </button>
              ))}
            </div>

            <div
              aria-labelledby={`room-tabbtn-${tab}`}
              className={cn("min-h-0 flex-1 flex-col lg:flex lg:max-h-none", drawerVisible ? "flex" : "hidden", cinemaOn ? "max-h-[38vh] min-h-[10rem]" : undefined)}
              id={`room-tab-${tab}`}
              role="tabpanel"
            >
              {tab === "chat" ? (
                <>
                  {openPolls.length > 0 ? (
                    <button className="mx-3 mt-2 rounded-[12px] border border-white/15 bg-[#161616] px-3 py-2 text-left text-sm hover:border-white/40" onClick={openPollsTab} type="button">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{copy.abas.enquetes}</span>
                      <span className="block truncate font-bold text-white">{openPolls[0].question}</span>
                    </button>
                  ) : null}
                  <RoomChatPanel
                    chatMode={session.session.chatMode}
                    consented={session.me.consented}
                    defaultDisplayMode={session.me.displayMode ?? "first_name_initial"}
                    displayName={session.me.displayName}
                    error={chat.error}
                    messages={chat.messages}
                    notice={readOnly ? null : composerNotice}
                    nowMs={nowMs}
                    onRemoveMine={chat.removeMine}
                    onSend={async (body) => {
                      try {
                        const answer = await chat.send(body);
                        if (!session.me.consented) {
                          void refreshSession();
                        }
                        return answer;
                      } catch (error) {
                        onWriteRefused(error);
                        throw error;
                      }
                    }}
                    phase={phase}
                    pinned={session.pinned}
                    readOnly={readOnly}
                    slowUntilMs={chat.slowUntilMs}
                  />
                </>
              ) : null}
              {tab === "perguntas" ? (
                <RoomQuestionsTab
                  allowAnonymous={session.session.anonymousQuestions}
                  consented={session.me.consented}
                  defaultDisplayMode={session.me.displayMode ?? "first_name_initial"}
                  enabled={!readOnly}
                  getOffsetMs={getOffsetMs}
                  notice={readOnly ? null : composerNotice}
                  onConsented={() => void refreshSession()}
                  onRefused={onWriteRefused}
                  readOnly={readOnly || phase === "ended"}
                  sessionId={sessionId}
                  webinarId={webinarId}
                />
              ) : null}
              {tab === "participantes" ? <LiveParticipantsTab stage={stage} students={presentNow} /> : null}
              {tab === "enquetes" ? (
                <RoomPollsTab enabled={!readOnly} getOffsetMs={getOffsetMs} initial={session.polls} onRefused={onWriteRefused} readOnly={readOnly || !writable} sessionId={sessionId} webinarId={webinarId} />
              ) : null}
            </div>
          </aside>
        )}

        {minimized ? <LivePillInfo live={phase === "live"} onLeave={leave} onRestore={() => setMinimized(false)} title={session.webinar.title} /> : null}
      </div>

      {cameraAsk && !minimized ? <LiveCameraDialog onCancel={() => setCameraAsk(false)} onConfirm={confirmCamera} /> : null}
      {room.signals.micPrompt && !minimized && !blocked ? <LiveMicDialog onCancel={room.declineMic} onConfirm={room.acceptMic} /> : null}
    </div>
  );
}
