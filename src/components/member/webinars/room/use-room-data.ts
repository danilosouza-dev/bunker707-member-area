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
import type { StudentScreenState } from "@/server/webinars/screen-model";
import type { StudentRoomPayload } from "@/server/webinars/student-model";
import {
  beaconLeave,
  deleteMyChat,
  getChatBacklog,
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
// aproxima do fim da atual e a consulta de 5 s das mensagens novas, fundidas sem repetir; a Na tela pega carona nela
// com o carimbo, screen/use-room-screen.ts) e as reacoes (as
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
  /** `presentHidden` (docs/30 D107): a equipe escondeu o numero de pessoas; ausente na resposta do servidor de antes. */
  onAnswer?: (answer: { ended: boolean; presentHidden?: boolean; presentNow: number }) => void;
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
            readRef.current.onAnswer?.({ ended: answer.ended, presentHidden: answer.presentHidden, presentNow: answer.presentNow });
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
  /** A primeira leitura do chat chegou (o contador do balao conta o que veio depois dela, panelUnreadSeen). */
  loaded: boolean;
  messages: RoomMessage[];
  /** O replay pulou: a janela recomeca no novo ponto. */
  seeked: () => void;
  send: (body: Omit<ChatPostBody, "sessionId">) => Promise<{ pending: boolean }>;
  removeMine: () => Promise<number>;
  /** Modo lento: ate quando o aluno espera (ms do aparelho). */
  slowUntilMs: number | null;
};

export function useRoomChat(input: {
  /**
   * A Live ao vivo: quem entra (ou volta) recebe tambem o que ja foi dito antes da primeira janela, as ultimas
   * mensagens da sessao, de uma vez (teste do produtor de 13/11/2026: sem isso, o aluno que saia e voltava perdia o
   * chat de antes dos 5 min). Na gravada e no replay o chat aparece no segundo dele: sem historico.
   */
  backlog?: boolean;
  enabled: boolean;
  getPlayerOffsetMs: () => number;
  /** A Na tela: o carimbo que a sala tem (vai em `tela` na consulta de 5 s); nulo, a consulta vai sem ele. */
  getScreenStamp?: () => string | null;
  initialServerTime: string;
  /** A Na tela: o estado que a consulta de 5 s trouxe (so quando o carimbo mudou). */
  onScreen?: (screen: StudentScreenState) => void;
  sessionId: string;
  webinarId: string;
}): ChatFeed {
  const { enabled, initialServerTime, sessionId, webinarId } = input;
  const backlog = input.backlog === true;
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slowUntilMs, setSlowUntilMs] = useState<number | null>(null);
  const windowRef = useRef<ChatWindow | null>(null);
  const seekedRef = useRef(false);
  const cursorRef = useRef<ChatCursor>(initialChatCursor(initialServerTime));
  const offsetRef = useRef(input.getPlayerOffsetMs);
  const screenRef = useRef({ getStamp: input.getScreenStamp, onScreen: input.onScreen });
  const busyRef = useRef(false);

  useEffect(() => {
    offsetRef.current = input.getPlayerOffsetMs;
    screenRef.current = { getStamp: input.getScreenStamp, onScreen: input.onScreen };
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let stopped = false;
    windowRef.current = null;
    // O historico da live: pedido uma vez, logo depois da primeira janela, do comeco dela para tras. Uma falha tenta de
    // novo na conferencia seguinte das janelas, ate tres vezes; o chat de agora nunca espera por ele.
    let backlogLeft = backlog ? 3 : 0;
    let backlogBusy = false;
    const fetchBacklog = async (beforeMs: number) => {
      if (backlogLeft <= 0 || backlogBusy) {
        return;
      }
      backlogBusy = true;
      backlogLeft -= 1;
      try {
        const answer = await getChatBacklog(webinarId, sessionId, beforeMs);
        if (stopped) {
          return;
        }
        backlogLeft = 0;
        if (answer.data.messages.length > 0) {
          setMessages((previous) => mergeMessages(previous, answer.data.messages));
        }
      } catch {
        // O chat de agora continua; o historico tenta de novo na proxima conferencia.
      } finally {
        backlogBusy = false;
      }
    };
    let firstWindowFromMs: number | null = null;
    const fetchWindow = async () => {
      if (firstWindowFromMs !== null && backlogLeft > 0) {
        void fetchBacklog(firstWindowFromMs);
      }
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
        setLoaded(true);
        setError(null);
        if (firstWindowFromMs === null) {
          firstWindowFromMs = next.fromMs;
          void fetchBacklog(next.fromMs);
        }
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
        const answer = await getRecentChat(webinarId, sessionId, cursorRef.current, screenRef.current.getStamp?.() ?? null);
        if (stopped) {
          return;
        }
        cursorRef.current = answer.data.next;
        if (answer.data.messages.length > 0) {
          setMessages((previous) => mergeMessages(previous, answer.data.messages));
        }
        // A Na tela pega carona: o estado so vem quando o carimbo da sessao mudou.
        if (answer.data.screen) {
          screenRef.current.onScreen?.(answer.data.screen);
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
  }, [backlog, enabled, sessionId, webinarId]);

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

  return { error, loaded, messages, removeMine, seeked, send, slowUntilMs };
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
