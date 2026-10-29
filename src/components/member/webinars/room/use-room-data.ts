"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import {
  chatWindowToFetch,
  clockSkewMs,
  initialChatCursor,
  mergeMessages,
  nextReactionBubbles,
  roomAccessLost,
  type ChatCursor,
  type ReactionBubble,
  type RoomMessage
} from "@/lib/webinar-room-client";
import { ROOM_RULES, type PresenceState, type Reaction } from "@/server/webinars/model";
import type { ChatWindow } from "@/server/webinars/room-model";
import type { StudentRoomPayload } from "@/server/webinars/student-model";
import {
  beaconLeave,
  deleteMyChat,
  getChatWindow,
  getReactionCounts,
  getRecentChat,
  getSession,
  postChat,
  postHeartbeat,
  postReaction,
  retryAfterOf,
  WebinarsRequestError,
  type ChatPostBody
} from "./room-api";

// Os dados vivos da Sala (docs/30 §5.1 e §6.6), fora do desenho: o relogio do servidor (skew a cada 60 s e ao
// voltar para a aba, pela rota da sessao, que tambem renova fixada, enquetes, modo do chat e presentes), o sinal
// de presenca de 15 s (e o de saida por sendBeacon), o chat (a janela por offset pedida quando o player se
// aproxima do fim da atual e a consulta de 5 s das mensagens novas, fundidas sem repetir) e as reacoes (as
// contagens dos ultimos segundos viram bolhas). Tudo para quando a sala fecha; nada roda no "ver como". O 404 da
// releitura da sessao e do sinal de presenca (a pessoa saiu do "Quem pode" no meio da live, D41) avisa a sala, que
// desmonta o video e mostra "Esta live não está disponível para você." (roomAccessLost).

const CLOCK_MS = ROOM_RULES.clockResyncSeconds * 1000;
const HEARTBEAT_MS = ROOM_RULES.heartbeatSeconds * 1000;
const POLL_MS = ROOM_RULES.chatPollSeconds * 1000;
const WINDOW_CHECK_MS = 5_000;

function timer(callback: () => void, everyMs: number) {
  const id = window.setInterval(callback, everyMs);
  return () => window.clearInterval(id);
}

/* ------------------------------------------------------------------------------------------------
 * Relogio e a sessao renovada
 * ---------------------------------------------------------------------------------------------- */

export function useRoomClock(input: { enabled: boolean; initial: StudentRoomPayload; webinarId: string }) {
  const { enabled, initial, webinarId } = input;
  const [session, setSession] = useState(initial);
  const [skewMs, setSkewMs] = useState(0);
  /** A releitura respondeu 404: a pessoa perdeu a sala (definitivo; as releituras param). */
  const [accessLost, setAccessLost] = useState(false);
  const skewRef = useRef(0);
  const sessionId = initial.session.id;

  /** Rele a sessao; devolve a resposta (ou nulo sem resposta) para quem precisa decidir na hora. */
  const refresh = useCallback(async (): Promise<StudentRoomPayload | null> => {
    try {
      const answer = await getSession(webinarId, sessionId);
      const skew = clockSkewMs({ requestSentAtMs: answer.sentAtMs, responseReceivedAtMs: answer.receivedAtMs, serverTimeMs: Date.parse(answer.data.serverTime) });
      skewRef.current = skew;
      setSkewMs(skew);
      setSession((previous) => ({ ...previous, ...(answer.data as StudentRoomPayload), me: { ...previous.me, ...answer.data.me } }));
      return answer.data as StudentRoomPayload;
    } catch (error) {
      // 404: fora do "Quem pode" agora (ou a sessao sumiu): a sala para. Sem resposta, o relogio anterior continua
      // valendo e a proxima tentativa vem no proximo passo.
      if (roomAccessLost(error)) {
        setAccessLost(true);
      }
      return null;
    }
  }, [sessionId, webinarId]);

  const reading = enabled && !accessLost;

  useEffect(() => {
    if (!reading) {
      return;
    }
    // A primeira leitura sai do proprio efeito (sem setState sincrono nele): acerta o relogio logo ao abrir.
    const first = window.setTimeout(() => void refresh(), 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(first);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reading, refresh]);

  useEffect(() => {
    if (!reading) {
      return;
    }
    return timer(() => void refresh(), CLOCK_MS);
  }, [reading, refresh]);

  return { accessLost, refresh, session, setSession, skewMs, skewRef };
}

/* ------------------------------------------------------------------------------------------------
 * Presenca (docs/30 §1.8, §9 e D19)
 * ---------------------------------------------------------------------------------------------- */

export function useRoomHeartbeat(input: {
  enabled: boolean;
  getOffsetSeconds: () => number;
  getState: () => PresenceState;
  /** O sinal respondeu 404: a pessoa saiu do "Quem pode" (o acesso guardado no servidor vale ate 10 min). */
  onAccessLost?: () => void;
  onAnswer?: (answer: { ended: boolean; presentNow: number }) => void;
  sessionId: string;
  webinarId: string;
}) {
  const { enabled, sessionId, webinarId } = input;
  const readRef = useRef({ getOffsetSeconds: input.getOffsetSeconds, getState: input.getState, onAccessLost: input.onAccessLost, onAnswer: input.onAnswer });

  useEffect(() => {
    readRef.current = { getOffsetSeconds: input.getOffsetSeconds, getState: input.getState, onAccessLost: input.onAccessLost, onAnswer: input.onAnswer };
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let stopped = false;
    const body = () => ({
      offsetSeconds: Math.round(readRef.current.getOffsetSeconds()),
      sessionId,
      state: document.visibilityState === "visible" ? readRef.current.getState() : "hidden",
      visible: document.visibilityState === "visible"
    });
    const beat = () => {
      postHeartbeat(webinarId, body())
        .then((answer) => {
          if (!stopped) {
            readRef.current.onAnswer?.({ ended: answer.ended, presentNow: answer.presentNow });
          }
        })
        .catch((error: unknown) => {
          // So o 404 importa (fora do acesso agora); rede e 5xx: o proximo sinal vem em 15 s.
          if (!stopped && roomAccessLost(error)) {
            readRef.current.onAccessLost?.();
          }
        });
    };
    const leave = () => {
      stopped = true;
      beaconLeave(webinarId, body());
    };
    const onVisibility = () => {
      if (!stopped) {
        beat();
      }
    };
    beat();
    const stop = timer(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", leave);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", leave);
      if (!stopped) {
        leave();
      }
    };
  }, [enabled, sessionId, webinarId]);
}

/* ------------------------------------------------------------------------------------------------
 * Chat: a janela por offset e as mensagens novas
 * ---------------------------------------------------------------------------------------------- */

export type ChatFeed = {
  error: string | null;
  messages: RoomMessage[];
  /** O replay pulou: a janela recomeca no novo ponto. */
  seeked: () => void;
  send: (body: Omit<ChatPostBody, "sessionId">) => Promise<{ pending: boolean }>;
  removeMine: () => Promise<number>;
  /** Modo lento: ate quando o aluno espera (ms do aparelho). */
  slowUntilMs: number | null;
};

export function useRoomChat(input: { enabled: boolean; getPlayerOffsetMs: () => number; initialServerTime: string; sessionId: string; webinarId: string }): ChatFeed {
  const { enabled, initialServerTime, sessionId, webinarId } = input;
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [slowUntilMs, setSlowUntilMs] = useState<number | null>(null);
  const windowRef = useRef<ChatWindow | null>(null);
  const seekedRef = useRef(false);
  const cursorRef = useRef<ChatCursor>(initialChatCursor(initialServerTime));
  const offsetRef = useRef(input.getPlayerOffsetMs);
  const busyRef = useRef(false);

  useEffect(() => {
    offsetRef.current = input.getPlayerOffsetMs;
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let stopped = false;
    windowRef.current = null;
    const fetchWindow = async () => {
      if (busyRef.current) {
        return;
      }
      const next = chatWindowToFetch({ current: windowRef.current, playerOffsetMs: offsetRef.current(), seeked: seekedRef.current });
      if (!next) {
        return;
      }
      busyRef.current = true;
      const seeked = seekedRef.current;
      seekedRef.current = false;
      try {
        const answer = await getChatWindow(webinarId, sessionId, next);
        if (stopped) {
          return;
        }
        windowRef.current = answer.data.window;
        setMessages((previous) => (seeked ? mergeMessages(previous.filter((message) => message.mine), answer.data.messages) : mergeMessages(previous, answer.data.messages)));
        setError(null);
      } catch (failure) {
        if (!stopped) {
          setError(failure instanceof WebinarsRequestError ? failure.message : WEBINAR_COPY.sala.erroCarregarChat);
        }
      } finally {
        busyRef.current = false;
      }
    };
    const poll = async () => {
      try {
        const answer = await getRecentChat(webinarId, sessionId, cursorRef.current);
        if (stopped) {
          return;
        }
        cursorRef.current = answer.data.next;
        if (answer.data.messages.length > 0) {
          setMessages((previous) => mergeMessages(previous, answer.data.messages));
        }
      } catch {
        // A proxima consulta vem em 5 s.
      }
    };
    void fetchWindow();
    const stopWindows = timer(() => void fetchWindow(), WINDOW_CHECK_MS);
    const stopPolling = timer(() => void poll(), POLL_MS);
    return () => {
      stopped = true;
      stopWindows();
      stopPolling();
    };
  }, [enabled, sessionId, webinarId]);

  const seeked = useCallback(() => {
    seekedRef.current = true;
  }, []);

  const send = useCallback(
    async (body: Omit<ChatPostBody, "sessionId">) => {
      try {
        const answer = await postChat(webinarId, { ...body, sessionId });
        setMessages((previous) => mergeMessages(previous, [answer.message]));
        return { pending: answer.pending };
      } catch (failure) {
        const retry = retryAfterOf(failure);
        if (retry) {
          setSlowUntilMs(Date.now() + retry * 1000);
        }
        throw failure;
      }
    },
    [sessionId, webinarId]
  );

  const removeMine = useCallback(async () => {
    const answer = await deleteMyChat(webinarId);
    setMessages((previous) => previous.filter((message) => !message.mine));
    return answer.removed;
  }, [webinarId]);

  return { error, messages, removeMine, seeked, send, slowUntilMs };
}

/* ------------------------------------------------------------------------------------------------
 * Reacoes
 * ---------------------------------------------------------------------------------------------- */

export function useRoomReactions(input: {
  enabled: boolean;
  getOffsetMs: () => number;
  /** A sala ao vivo quer saber da reacao recusada (409 banned: removido ou banido no meio da live). */
  onRefused?: (error: unknown) => void;
  reducedMotion: boolean;
  sessionId: string;
  webinarId: string;
}) {
  const { enabled, reducedMotion, sessionId, webinarId } = input;
  const [bubbles, setBubbles] = useState<ReactionBubble[]>([]);
  const [overflow, setOverflow] = useState(0);
  const nextIdRef = useRef(1);
  const sinceRef = useRef<string | null>(null);
  const lastSentRef = useRef(0);
  const offsetRef = useRef(input.getOffsetMs);
  const refusedRef = useRef(input.onRefused);

  useEffect(() => {
    offsetRef.current = input.getOffsetMs;
    refusedRef.current = input.onRefused;
  });

  const push = useCallback(
    (counts: Partial<Record<Reaction, number>>) => {
      const now = Date.now();
      setBubbles((previous) => {
        const next = nextReactionBubbles(previous, counts, now, { nextId: nextIdRef.current, reducedMotion });
        nextIdRef.current = next.nextId;
        setOverflow(next.overflow);
        return next.bubbles;
      });
    },
    [reducedMotion]
  );

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let stopped = false;
    const poll = async () => {
      try {
        const answer = await getReactionCounts(webinarId, sessionId, sinceRef.current);
        if (stopped) {
          return;
        }
        sinceRef.current = answer.data.serverTime;
        push(answer.data.counts);
      } catch {
        // A proxima leitura vem em 5 s.
      }
    };
    const stopPolling = timer(() => void poll(), POLL_MS);
    const stopSweep = timer(() => setBubbles((previous) => previous.filter((bubble) => bubble.until > Date.now())), 1_000);
    return () => {
      stopped = true;
      stopPolling();
      stopSweep();
    };
  }, [enabled, push, sessionId, webinarId]);

  const react = useCallback(
    (reaction: Reaction) => {
      const now = Date.now();
      if (now - lastSentRef.current < 1000 / ROOM_RULES.reactions.perSecond) {
        return;
      }
      lastSentRef.current = now;
      push({ [reaction]: 1 });
      void postReaction(webinarId, { offsetMs: Math.round(offsetRef.current()), reaction, sessionId }).catch((error: unknown) => refusedRef.current?.(error));
    },
    [push, sessionId, webinarId]
  );

  return { bubbles, overflow, react };
}
