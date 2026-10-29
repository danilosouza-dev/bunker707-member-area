// Limites da sala por aluno e sessao (docs/30 §5.1, §8.3 e D16), na memoria do processo como
// src/server/communications/student-write-limit.ts: a rajada do chat (5 por 60 s), o modo lento ("1 mensagem
// a cada N s", N escolhido pela equipe por sessao), as perguntas (2 por minuto) e as reacoes (1 por segundo e 20
// por minuto). Tudo e conferido e reservado sem nenhum await no meio, entao dois pedidos ao mesmo tempo nao passam
// juntos; as reacoes tambem contam no banco (countStudentReactionsSince), o limite entre instancias. Por cima de
// tudo vale o teto global takeStudentWrite. Modulo puro (sem "server-only"), com o relogio por parametro:
// tests/webinarios-sala-navegador e tests/webinarios-sala-rotas.

import { ROOM_RULES } from "./model";

/** Chaves guardadas ao mesmo tempo; acima disto as mais antigas saem. */
const MAX_TRACKED = 20_000;

function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key);
  while (map.size >= MAX_TRACKED) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    map.delete(oldest);
  }
  map.set(key, value);
}

export type WindowedTake = { ok: boolean; retryAfterSeconds: number };

/**
 * Uma janela deslizante por chave, num mapa so dela (uma janela de 1 s nunca poda as de 60 s). As chaves ficam na
 * ordem da ultima escrita (remember reinsere), entao a poda para na primeira chave que ainda tem escrita na janela.
 */
function windowedLimit(max: number, windowMs: number) {
  const entries = new Map<string, number[]>();

  function prune(now: number) {
    for (const [key, times] of entries) {
      if (now - (times[times.length - 1] ?? Number.NEGATIVE_INFINITY) < windowMs) {
        return;
      }
      entries.delete(key);
    }
  }

  function live(key: string, now: number) {
    return (entries.get(key) ?? []).filter((time) => now - time < windowMs);
  }

  /** Em quantos segundos a chave pode escrever de novo (0 = pode agora). */
  function wait(key: string, now: number): number {
    prune(now);
    const times = live(key, now);
    if (times.length < max) {
      return 0;
    }
    const oldest = times[0] ?? now;
    return Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
  }

  function add(key: string, now: number) {
    const times = live(key, now);
    times.push(now);
    remember(entries, key, times);
  }

  return {
    add,
    clear: () => entries.clear(),
    take(key: string, now: number): WindowedTake {
      const retryAfterSeconds = wait(key, now);
      if (retryAfterSeconds > 0) {
        return { ok: false, retryAfterSeconds };
      }
      add(key, now);
      return { ok: true, retryAfterSeconds: 0 };
    },
    wait
  };
}

const chatBurst = windowedLimit(ROOM_RULES.chatBurst.max, ROOM_RULES.chatBurst.windowMs);
const questionBurst = windowedLimit(ROOM_RULES.questionsPerMinute, 60_000);
const reactionSecond = windowedLimit(ROOM_RULES.reactions.perSecond, 1000);
const reactionMinute = windowedLimit(ROOM_RULES.reactions.perMinute, 60_000);
const lastSentAt = new Map<string, number>();

export function chatBurstKey(userId: string, sessionId: string) {
  return `chat:${userId}:${sessionId}`;
}

function roomKey(userId: string, sessionId: string) {
  return `${userId}:${sessionId}`;
}

/** A rajada do chat: 5 mensagens por 60 s por aluno e sessao (ROOM_RULES.chatBurst). */
export function takeChatBurst(userId: string, sessionId: string, now = Date.now()): WindowedTake {
  return chatBurst.take(roomKey(userId, sessionId), now);
}

/** Perguntas: 2 por minuto por aluno e sessao (ROOM_RULES.questionsPerMinute). */
export function takeQuestionBurst(userId: string, sessionId: string, now = Date.now()): WindowedTake {
  return questionBurst.take(roomKey(userId, sessionId), now);
}

/** Reacoes: 1 por segundo e 20 por minuto por aluno e sessao; as duas janelas conferidas antes de contar. */
export function takeReaction(userId: string, sessionId: string, now = Date.now()): WindowedTake {
  const key = roomKey(userId, sessionId);
  const retryAfterSeconds = Math.max(reactionSecond.wait(key, now), reactionMinute.wait(key, now));
  if (retryAfterSeconds > 0) {
    return { ok: false, retryAfterSeconds };
  }
  reactionSecond.add(key, now);
  reactionMinute.add(key, now);
  return { ok: true, retryAfterSeconds: 0 };
}

/**
 * Modo lento: segundos que faltam ate o aluno poder enviar de novo nesta sessao (0 = pode). Conta a partir da
 * ultima mensagem reservada (reserveChatSlot) ou marcada; a equipe nao passa por aqui (escreve pelas Server Actions).
 */
export function slowModeWaitSeconds(userId: string, sessionId: string, slowModeSeconds: number | null, now = Date.now()): number {
  if (!slowModeSeconds || slowModeSeconds <= 0) {
    return 0;
  }
  const last = lastSentAt.get(chatBurstKey(userId, sessionId));
  if (last === undefined) {
    return 0;
  }
  const remainingMs = slowModeSeconds * 1000 - (now - last);
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

/** Marca a hora da mensagem aceita (a base do modo lento). */
export function markChatSent(userId: string, sessionId: string, now = Date.now()) {
  remember(lastSentAt, chatBurstKey(userId, sessionId), now);
}

export type ChatSlot = { ok: true; release: () => void } | { ok: false; waitSeconds: number };

/**
 * Confere o modo lento e ja reserva a vez (marca a hora) no mesmo passo, antes de qualquer await: a segunda
 * mensagem enviada junto espera. `release` devolve a vez quando a mensagem nao foi gravada (palavra bloqueada,
 * falha no banco), para o aluno nao esperar por uma mensagem que nao existe.
 */
export function reserveChatSlot(userId: string, sessionId: string, slowModeSeconds: number | null, now = Date.now()): ChatSlot {
  const waitSeconds = slowModeWaitSeconds(userId, sessionId, slowModeSeconds, now);
  if (waitSeconds > 0) {
    return { ok: false, waitSeconds };
  }
  const key = chatBurstKey(userId, sessionId);
  const previous = lastSentAt.get(key);
  remember(lastSentAt, key, now);
  return {
    ok: true,
    release: () => {
      if (lastSentAt.get(key) !== now) {
        return;
      }
      if (previous === undefined) {
        lastSentAt.delete(key);
      } else {
        remember(lastSentAt, key, previous);
      }
    }
  };
}

/** Zera tudo (testes). */
export function resetRoomLimits() {
  chatBurst.clear();
  questionBurst.clear();
  reactionSecond.clear();
  reactionMinute.clear();
  lastSentAt.clear();
}
