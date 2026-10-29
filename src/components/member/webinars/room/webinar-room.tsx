"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MemberButton } from "@/components/member/ui/member-button";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { presenceStateOf, revealedMessages, roomPhaseAt, targetOffsetMs } from "@/lib/webinar-room-client";
import { formatCountdown, saoPauloTime } from "@/lib/webinar-time";
import type { StudentRoomPayload } from "@/server/webinars/student-model";
import { roomHref } from "@/server/webinars/student-model";
import { RoomChatPanel } from "./room-chat";
import { RoomHeader } from "./room-header";
import { RoomPill } from "./room-pill";
import { RoomPollsTab } from "./room-polls";
import { RoomQuestionsTab } from "./room-questions";
import { RoomReactionBar, RoomReactionBubbles } from "./room-reactions";
import { RoomStage } from "./room-stage";
import { useRoomChat, useRoomClock, useRoomHeartbeat, useRoomReactions } from "./use-room-data";
import { useRoomPlayer } from "./use-room-player";

// A Sala da Live gravada e do Replay (docs/30 §1.3 adaptado a §1.6, §1.7 e §9): um dialogo de tela cheia por cima
// da area (aria-modal, foco preso, Esc fecha com confirmacao quando no ar), com o cabecalho, o palco (o player da
// Bunny travado no relogio do servidor na gravada; livre no replay), a barra de reacoes e o painel com as abas
// Chat, Perguntas e Enquetes (a de Enquetes so com enquete aberta). A 375 px: palco na largura, abas embaixo, o
// campo de mensagem fixo no rodape, botoes de 44 px. Minimizar vira a pilula de 56 px no canto; o player continua
// (e o sinal de midia com ele: nenhum pop-up abre). Sair volta para a pagina da live; o sinal de saida vai por
// beacon. No "ver como" da equipe nada e gravado: nem sinal, nem chat, nem reacao.

type Tab = "chat" | "enquetes" | "perguntas";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(callback: () => void) {
  try {
    const media = window.matchMedia(REDUCED_MOTION);
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  } catch {
    return () => undefined;
  }
}

function readReducedMotion() {
  try {
    return window.matchMedia(REDUCED_MOTION).matches;
  } catch {
    return false;
  }
}

export type WebinarRoomProps = {
  coverUrl: string | null;
  payload: StudentRoomPayload;
  /** "Ver como" da equipe: a sala abre e nada e gravado. */
  readOnly: boolean;
  /** A pagina da live (Sair e Esc voltam para ca). */
  webinarHref: string;
};

export function WebinarRoom({ coverUrl, payload, readOnly, webinarHref }: WebinarRoomProps) {
  const copy = WEBINAR_COPY.sala;
  const router = useRouter();
  const webinarId = payload.webinar.id;
  const sessionId = payload.session.id;
  const kind: "replay" | "simulated" = payload.session.kind === "replay" ? "replay" : "simulated";
  const clock = useRoomClock({ enabled: !readOnly, initial: payload, webinarId });
  const session = clock.session;
  const zeroMs = useMemo(() => Date.parse(session.session.scheduledAt), [session.session.scheduledAt]);
  const durationMs = session.session.durationMs;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.parse(payload.serverTime));
  const [minimized, setMinimized] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [muted, setMuted] = useState(kind === "simulated");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [playerEnded, setPlayerEnded] = useState(false);
  /** O contador do ultimo sinal de presenca; antes dele, o da leitura da sessao. */
  const [heartbeatPresent, setHeartbeatPresent] = useState<number | null>(null);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const [replaySeconds, setReplaySeconds] = useState(0);
  const replayOffsetRef = useRef(0);
  const lastReplaySecondRef = useRef<number | null>(null);
  const serverEnded = session.session.status === "ended" || session.session.status === "cancelled";

  // O relogio da sala, a cada segundo (a contagem, o tempo no ar e a revelacao das mensagens).
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const presentNow = heartbeatPresent ?? session.presentNow;

  const phase: "ended" | "live" | "replay" | "waiting" =
    kind === "replay" ? "replay" : roomPhaseAt({ deviceNowMs: nowMs, durationMs, ended: serverEnded || playerEnded, skewMs: clock.skewMs, zeroMs });
  const live = phase === "live";

  const getOffsetMs = useCallback(() => {
    if (kind === "replay") {
      return replayOffsetRef.current;
    }
    return targetOffsetMs({ deviceNowMs: Date.now(), skewMs: clock.skewRef.current ?? 0, zeroMs });
  }, [clock.skewRef, kind, zeroMs]);

  // O chat liga ja na espera (a sala de espera tem chat, docs/30 §1.6): so o "ver como" fica sem nada.
  const chat = useRoomChat({ enabled: !readOnly, getPlayerOffsetMs: getOffsetMs, initialServerTime: payload.serverTime, sessionId, webinarId });
  const chatSeeked = chat.seeked;

  const onTime = useCallback(
    (seconds: number) => {
      const last = lastReplaySecondRef.current;
      replayOffsetRef.current = Math.round(seconds * 1000);
      lastReplaySecondRef.current = seconds;
      if (last !== null && Math.abs(seconds - last) > 2) {
        chatSeeked();
      }
      setReplaySeconds(Math.floor(seconds));
    },
    [chatSeeked]
  );

  const player = useRoomPlayer({
    durationMs,
    enabled: !readOnly && (live || phase === "replay") && session.video !== null,
    iframe,
    locked: kind === "simulated",
    onEnded: () => setPlayerEnded(true),
    onTime,
    sessionId,
    skewRef: clock.skewRef,
    src: session.video?.embedUrl ?? null,
    zeroMs
  });

  useRoomHeartbeat({
    enabled: !readOnly && phase !== "ended",
    getOffsetSeconds: () => Math.floor(getOffsetMs() / 1000),
    getState: () => presenceStateOf({ bridge: player.bridge, playing: player.playing, visible: true }),
    onAnswer: (answer) => {
      setHeartbeatPresent(answer.presentNow);
      if (answer.ended) {
        setPlayerEnded(true);
      }
    },
    sessionId,
    webinarId
  });

  const reactions = useRoomReactions({ enabled: !readOnly && (live || phase === "replay"), getOffsetMs, reducedMotion, sessionId, webinarId });

  const currentOffsetMs = kind === "replay" ? replaySeconds * 1000 : targetOffsetMs({ deviceNowMs: nowMs, skewMs: clock.skewMs, zeroMs });
  const revealed = useMemo(() => revealedMessages(chat.messages, currentOffsetMs), [chat.messages, currentOffsetMs]);
  const openPolls = session.polls.filter((poll) => poll.status === "open");
  const showPollsTab = openPolls.length > 0 || tab === "enquetes" || session.polls.length > 0;
  const replayHref = session.webinar.replaySessionId && kind === "simulated" ? roomHref(session.webinar.slug, session.webinar.replaySessionId) : null;
  const countdown = kind === "simulated" ? formatCountdown(zeroMs, nowMs + clock.skewMs) : "";

  const leave = useCallback(() => {
    router.push(webinarHref);
  }, [router, webinarHref]);

  const askToLeave = useCallback(() => {
    if (live && !minimized) {
      setConfirmLeave(true);
      return;
    }
    leave();
  }, [leave, live, minimized]);

  // Foco preso e Esc (docs/30 §1.7): o dialogo e o unico lugar do teclado enquanto esta aberto.
  useEffect(() => {
    if (minimized) {
      return;
    }
    const root = rootRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root?.querySelector<HTMLElement>("[data-room-first-focus]")?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [minimized]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (confirmLeave) {
        setConfirmLeave(false);
      } else {
        askToLeave();
      }
      return;
    }
    if (event.key !== "Tab" || minimized || !rootRef.current) {
      return;
    }
    const focusable = Array.from(rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.offsetParent !== null || element === document.activeElement);
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !rootRef.current.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function unmute() {
    setMuted(false);
    player.unmute();
  }

  const stageState = phase === "replay" ? "replay" : phase;
  const timeLabel = saoPauloTime(session.session.scheduledAt);
  const composerPhase = phase === "replay" ? "replay" : phase;

  const stage = (
    <RoomStage
      countdownLabel={countdown}
      coverUrl={coverUrl}
      embedUrl={session.video?.embedUrl ?? null}
      iframeRef={setIframe}
      minimized={minimized}
      muted={muted && kind === "simulated"}
      onUnmute={unmute}
      replayHref={replayHref}
      sessionId={sessionId}
      state={stageState}
      title={session.webinar.title}
    />
  );

  return (
    <div
      aria-label={session.webinar.title}
      aria-modal={!minimized || undefined}
      className={cn(
        "z-[60] text-white",
        minimized
          ? "fixed bottom-4 right-4 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-[16px] border border-white/15 bg-[#121212] shadow-[0_18px_48px_rgba(0,0,0,0.6)]"
          : "fixed inset-0 flex flex-col bg-[#0b0b0b]"
      )}
      data-room-minimized={minimized ? "" : undefined}
      data-room-phase={phase}
      onKeyDown={handleKeyDown}
      ref={rootRef}
      role="dialog"
    >
      {minimized ? (
        <RoomPill live={live && session.session.showLiveBadge} onLeave={leave} onRestore={() => setMinimized(false)} title={session.webinar.title}>
          {stage}
        </RoomPill>
      ) : (
        <>
          <RoomHeader
            getOffsetMs={getOffsetMs}
            kind={kind}
            onLeave={askToLeave}
            onMinimize={() => setMinimized(true)}
            phase={phase === "replay" ? "live" : phase}
            presentNow={presentNow}
            showLiveBadge={session.session.showLiveBadge}
            timeLabel={timeLabel}
            title={session.webinar.title}
          />

          {confirmLeave ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-400/30 bg-amber-500/10 px-3 py-2" role="alertdialog" aria-label={copy.sairConfirmar}>
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

          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <div className="relative shrink-0 bg-black lg:flex lg:min-h-0 lg:min-w-0 lg:flex-1 lg:flex-col">
              <div className="relative lg:min-h-0 lg:flex-1">
                {stage}
                <RoomReactionBubbles bubbles={reactions.bubbles} overflow={reactions.overflow} />
              </div>
              <div className="border-t border-white/10 bg-[#111]">
                <RoomReactionBar disabled={readOnly || !(live || phase === "replay")} onReact={reactions.react} />
              </div>
            </div>

            <aside className="flex min-h-0 flex-1 flex-col border-t border-white/10 bg-[#0f0f0f] lg:w-[360px] lg:flex-none lg:border-l lg:border-t-0" data-testid="room-panel">
              <div aria-label={copy.abas.chat} className="flex shrink-0 border-b border-white/10" role="tablist">
                {(["chat", "perguntas", ...(showPollsTab ? (["enquetes"] as const) : [])] as Tab[]).map((value) => (
                  <button
                    aria-controls={`room-tab-${value}`}
                    aria-selected={tab === value}
                    className={cn(
                      "relative h-11 flex-1 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white motion-reduce:transition-none",
                      tab === value ? "text-white" : "text-zinc-400 hover:text-white"
                    )}
                    data-room-first-focus={value === "chat" ? "" : undefined}
                    id={`room-tabbtn-${value}`}
                    key={value}
                    onClick={() => setTab(value)}
                    role="tab"
                    type="button"
                  >
                    {value === "chat" ? (kind === "replay" ? copy.abas.chatDaLive : copy.abas.chat) : value === "perguntas" ? copy.abas.perguntas : copy.abas.enquetes}
                    {value === "enquetes" && openPolls.length > 0 ? <span aria-hidden="true" className="ml-1 inline-block size-1.5 rounded-full bg-[var(--accent)] align-middle" /> : null}
                    {tab === value ? <span aria-hidden="true" className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" /> : null}
                  </button>
                ))}
              </div>

              <div aria-labelledby={`room-tabbtn-${tab}`} className="flex min-h-0 flex-1 flex-col" id={`room-tab-${tab}`} role="tabpanel">
                {tab === "chat" ? (
                  <>
                    {openPolls.length > 0 ? (
                      <button className="mx-3 mt-2 rounded-[12px] border border-white/15 bg-[#161616] px-3 py-2 text-left text-sm hover:border-white/40" onClick={() => setTab("enquetes")} type="button">
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
                      messages={revealed}
                      nowMs={nowMs}
                      onRemoveMine={chat.removeMine}
                      onSend={async (body) => {
                        const answer = await chat.send({ ...body, offsetMs: kind === "replay" ? Math.round(getOffsetMs()) : undefined });
                        if (!session.me.consented) {
                          void clock.refresh();
                        }
                        return answer;
                      }}
                      phase={composerPhase}
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
                    onConsented={() => void clock.refresh()}
                    readOnly={readOnly || phase === "ended"}
                    sessionId={sessionId}
                    webinarId={webinarId}
                  />
                ) : null}
                {tab === "enquetes" ? <RoomPollsTab enabled={!readOnly} getOffsetMs={getOffsetMs} initial={session.polls} readOnly={readOnly || phase === "ended"} sessionId={sessionId} webinarId={webinarId} /> : null}
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
