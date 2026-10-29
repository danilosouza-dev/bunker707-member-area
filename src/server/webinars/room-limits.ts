// Limites da sala por aluno e sessao (docs/30 §5.1, §8.3 e D16), na memoria do processo como
// src/server/communications/student-write-limit.ts: a rajada do chat (5 por 60 s), o modo lento ("1 mensagem
// a cada N s", N escolhido pela equipe por sessao) e as perguntas (2 por minuto). As reacoes contam no banco
// (countStudentReactionsSince) porque o relatorio ja precisa das linhas. Por cima de tudo vale o teto global
// takeStudentWrite. Modulo puro (sem "server-only"), com o relogio por parametro: tests/webinarios-sala-rotas.

import { ROOM_RULES } from "./model";

type Window = { startedAt: number; times: number[] };

/** Chaves guardadas ao mesmo tempo; acima disto as mais antigas saem. */
const MAX_TRACKED = 20_000;

const windows = new Map<string, Window>();
const lastSentAt = new Map<string, number>();

function prune(now: number, windowMs: number) {
  for (const [key, window] of windows) {
    if (now - window.startedAt < windowMs) {
      return;
    }
    windows.delete(key);
  }
}

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

/**
 * Conta uma escrita na janela deslizante da chave; false = passou de `max` nos ultimos `windowMs`.
 * Devolve tambem em quantos segundos a janela abre de novo (o Retry-After).
 */
export function takeWindowedWrite(key: string, max: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterSeconds: number } {
  prune(now, windowMs);
  const current = windows.get(key);
  const times = (current?.times ?? []).filter((time) => now - time < windowMs);

  if (times.length >= max) {
    const oldest = times[0] ?? now;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)) };
  }

  times.push(now);
  remember(windows, key, { startedAt: times[0] ?? now, times });
  return { ok: true, retryAfterSeconds: 0 };
}

export function chatBurstKey(userId: string, sessionId: string) {
  return `chat:${userId}:${sessionId}`;
}

export function questionBurstKey(userId: string, sessionId: string) {
  return `question:${userId}:${sessionId}`;
}

/** A rajada do chat: 5 mensagens por 60 s por aluno e sessao (ROOM_RULES.chatBurst). */
export function takeChatBurst(userId: string, sessionId: string, now = Date.now()) {
  return takeWindowedWrite(chatBurstKey(userId, sessionId), ROOM_RULES.chatBurst.max, ROOM_RULES.chatBurst.windowMs, now);
}

/** Perguntas: 2 por minuto por aluno e sessao (ROOM_RULES.questionsPerMinute). */
export function takeQuestionBurst(userId: string, sessionId: string, now = Date.now()) {
  return takeWindowedWrite(questionBurstKey(userId, sessionId), ROOM_RULES.questionsPerMinute, 60_000, now);
}

/**
 * Modo lento: segundos que faltam ate o aluno poder enviar de novo nesta sessao (0 = pode). So conta depois de
 * markChatSent; a equipe nao passa por aqui (escreve pelas Server Actions).
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

/** Zera tudo (testes). */
export function resetRoomLimits() {
  windows.clear();
  lastSentAt.clear();
}
