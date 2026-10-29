"use client";

// A conversa da Sala com /api/webinars/[id]/* (docs/30 §5.1), no desenho de webinars-client.ts: fetch sem cache e
// na mesma origem; { data } | { error, reason? } desembrulhado em WebinarsRequestError (4xx traz a frase do
// servidor; 5xx e falha de rede ficam com a frase da tela); o sinal de saida vai por sendBeacon (text/plain, como
// o servidor aceita). Nenhum segredo aqui: o endereco do player ja vem montado pelo servidor. Fase 3 (a sala ao vivo):
// o token da sala (POST .../join-token, o nome da sala so na resposta, nunca na URL) e os lotes de sinais do iframe
// (POST .../room-events; no pagehide pelo sendBeacon com o mesmo corpo JSON em text/plain).

import type { RoomEventItem } from "@/lib/jitsi-room-config";
import { roomApiPath, questionVotePath, type ChatCursor } from "@/lib/webinar-room-client";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { JoinTokenReply } from "@/server/webinars/live-model";
import type { ChatMode, Reaction, StudentChatMessage } from "@/server/webinars/model";
import type { ChatWindow } from "@/server/webinars/room-model";
import type { StudentPoll, StudentQuestion } from "@/server/webinars/room-rules";
import type { StudentSessionPayload } from "@/server/webinars/student-model";
import { WebinarsRequestError } from "../webinars-client";
import { liveApiPath } from "./live-room-model";

export { WebinarsRequestError };

const GENERIC = WEBINAR_COPY.sala.erroEnviar;

async function readData<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string; reason?: string };
  if (!response.ok || payload.data === undefined) {
    const message = response.status >= 400 && response.status < 500 && payload.error ? payload.error : fallback;
    const error = new WebinarsRequestError(message, response.status, payload.reason);
    const retry = Number(response.headers.get("Retry-After"));
    if (Number.isFinite(retry) && retry > 0) {
      (error as WebinarsRequestError & { retryAfterSeconds?: number }).retryAfterSeconds = retry;
    }
    throw error;
  }
  return payload.data;
}

export type TimedResponse<T> = { data: T; receivedAtMs: number; sentAtMs: number };

async function getJson<T>(url: string, fallback: string, signal?: AbortSignal): Promise<TimedResponse<T>> {
  const sentAtMs = Date.now();
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
  const data = await readData<T>(response, fallback);
  return { data, receivedAtMs: Date.now(), sentAtMs };
}

async function sendJson<T>(url: string, method: "DELETE" | "POST", body: unknown, fallback: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method,
    signal
  });
  return readData<T>(response, fallback);
}

export function retryAfterOf(error: unknown): number | null {
  const value = (error as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds;
  return typeof value === "number" && value > 0 ? value : null;
}

/* ------------------------------------------------------------------------------------------------
 * Sessao (o relogio) e presenca
 * ---------------------------------------------------------------------------------------------- */

export function getSession(webinarId: string, sessionId: string, signal?: AbortSignal) {
  return getJson<StudentSessionPayload>(roomApiPath(webinarId, "session", { sessao: sessionId }), WEBINAR_COPY.aluno.erroCarregar, signal);
}

export type HeartbeatAnswer = { ended: boolean; offsetMs: number | null; presentNow: number; serverTime: string };

export function postHeartbeat(webinarId: string, body: { leave?: boolean; offsetSeconds: number; sessionId: string; state: string; visible: boolean }) {
  return sendJson<HeartbeatAnswer>(roomApiPath(webinarId, "heartbeat"), "POST", body, GENERIC);
}

/** O ultimo sinal ao sair (pagehide, fechar): o navegador entrega mesmo descarregando a pagina. */
export function beaconLeave(webinarId: string, body: { offsetSeconds: number; sessionId: string; state: string; visible: boolean }) {
  const url = roomApiPath(webinarId, "heartbeat");
  const text = JSON.stringify({ ...body, leave: true });
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, new Blob([text], { type: "text/plain;charset=UTF-8" }))) {
      return;
    }
  } catch {
    // Sem beacon: vai pelo fetch keepalive.
  }
  void fetch(url, { body: text, credentials: "same-origin", headers: { "Content-Type": "text/plain;charset=UTF-8" }, keepalive: true, method: "POST" }).catch(() => undefined);
}

/* ------------------------------------------------------------------------------------------------
 * Chat
 * ---------------------------------------------------------------------------------------------- */

export type ChatWindowAnswer = { messages: StudentChatMessage[]; mode: "window"; serverTime: string; window: ChatWindow };
export type ChatRecentAnswer = { messages: StudentChatMessage[]; mode: "recent"; next: ChatCursor; serverTime: string };

export function getChatWindow(webinarId: string, sessionId: string, window: ChatWindow, signal?: AbortSignal) {
  return getJson<ChatWindowAnswer>(roomApiPath(webinarId, "chat", { from: window.fromMs, sessao: sessionId, to: window.toMs }), WEBINAR_COPY.sala.erroCarregarChat, signal);
}

export function getRecentChat(webinarId: string, sessionId: string, cursor: ChatCursor, signal?: AbortSignal) {
  return getJson<ChatRecentAnswer>(roomApiPath(webinarId, "chat", { after: cursor.after, sessao: sessionId, since: cursor.since }), WEBINAR_COPY.sala.erroCarregarChat, signal);
}

export type ChatPostBody = {
  anonymous?: boolean;
  body: string;
  consent?: boolean;
  consentVersion?: number;
  displayMode?: "anonymous" | "first_name_initial" | "nickname";
  kind?: "message" | "question";
  nickname?: string;
  offsetMs?: number;
  replyToId?: string | null;
  sessionId: string;
};

export function postChat(webinarId: string, body: ChatPostBody) {
  return sendJson<{ message: StudentChatMessage; pending: boolean }>(roomApiPath(webinarId, "chat"), "POST", body, GENERIC);
}

/** "Remover minhas mensagens": com o webinario (dentro da sala) ou sem (Perfil › Privacidade). */
export function deleteMyChat(webinarId?: string | null) {
  const url = webinarId ? roomApiPath(webinarId, "chat") : "/api/webinars/chat";
  return sendJson<{ removed: number }>(url, "DELETE", { all: true }, GENERIC);
}

/* ------------------------------------------------------------------------------------------------
 * Reacoes, perguntas e enquetes
 * ---------------------------------------------------------------------------------------------- */

export function postReaction(webinarId: string, body: { offsetMs?: number; reaction: Reaction; sessionId: string }) {
  return sendJson<{ offsetMs: number; reaction: Reaction }>(roomApiPath(webinarId, "reactions"), "POST", body, GENERIC);
}

export function getReactionCounts(webinarId: string, sessionId: string, sinceIso: string | null, signal?: AbortSignal) {
  return getJson<{ counts: Partial<Record<Reaction, number>>; serverTime: string }>(roomApiPath(webinarId, "reactions", { sessao: sessionId, since: sinceIso }), GENERIC, signal);
}

export function getQuestions(webinarId: string, sessionId: string, order: "recentes" | "votadas", signal?: AbortSignal) {
  return getJson<{ questions: StudentQuestion[]; serverTime: string }>(roomApiPath(webinarId, "questions", { ordem: order, sessao: sessionId }), GENERIC, signal);
}

export type QuestionPostBody = Pick<ChatPostBody, "consent" | "consentVersion" | "displayMode" | "nickname"> & { anonymous: boolean; body: string; offsetMs?: number; sessionId: string };

export function postQuestion(webinarId: string, body: QuestionPostBody) {
  return sendJson<{ question: StudentQuestion }>(roomApiPath(webinarId, "questions"), "POST", body, GENERIC);
}

export function postQuestionVote(webinarId: string, questionId: string, sessionId: string) {
  return sendJson<{ upvotes: number; voted: boolean }>(questionVotePath(webinarId, questionId), "POST", { sessionId }, GENERIC);
}

export function getPolls(webinarId: string, sessionId: string, signal?: AbortSignal) {
  return getJson<{ polls: StudentPoll[]; serverTime: string }>(roomApiPath(webinarId, "polls", { sessao: sessionId }), GENERIC, signal);
}

export function postPollAnswer(webinarId: string, body: { offsetMs?: number; optionIds: string[]; pollId: string; sessionId: string }) {
  return sendJson<{ poll: StudentPoll }>(roomApiPath(webinarId, "polls"), "POST", body, GENERIC);
}

/* ------------------------------------------------------------------------------------------------
 * A sala ao vivo (fase 3): o token e os sinais do iframe
 * ---------------------------------------------------------------------------------------------- */

/**
 * O token da sala ao vivo: 200 { domain, jwt, room, role, expiresAt, refreshAt, settings }; 409 { reason } (not_started,
 * ended, kicked, banned) e 503 { reason: "meet_unconfigured" } chegam no erro com `status` e `reason`.
 */
export function postJoinToken(webinarId: string, sessionId: string) {
  return sendJson<JoinTokenReply>(liveApiPath(webinarId, "join-token"), "POST", { sessionId }, WEBINAR_COPY.aoVivo.erroAbrir);
}

/** Um lote de sinais do iframe ({ sessionId, events } ja em JSON): 202 { accepted }; 429 traz o Retry-After no erro. */
export async function postRoomEvents(webinarId: string, body: string) {
  const response = await fetch(liveApiPath(webinarId, "room-events"), {
    body,
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    keepalive: true,
    method: "POST"
  });
  return readData<{ accepted: number }>(response, GENERIC);
}

/** O que sobrou da fila ao sair (pagehide): o navegador entrega mesmo descarregando a pagina. */
export function beaconRoomEvents(webinarId: string, body: string): boolean {
  const url = liveApiPath(webinarId, "room-events");
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, new Blob([body], { type: "text/plain;charset=UTF-8" }))) {
      return true;
    }
  } catch {
    // Sem beacon: vai pelo fetch keepalive.
  }
  void fetch(url, { body, credentials: "same-origin", headers: { "Content-Type": "text/plain;charset=UTF-8" }, keepalive: true, method: "POST" }).catch(() => undefined);
  return false;
}

export type { ChatMode, JoinTokenReply, Reaction, RoomEventItem, StudentChatMessage, StudentPoll, StudentQuestion };
