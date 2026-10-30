"use client";

// A conversa da sala com o Assistente (docs/30 §1.6 e §6.6; fase 4c): GET /api/webinars/[id]/assistant?sessao= (ligado,
// "Responder tudo" e quantos da equipe estao atendendo) e POST /api/webinars/[id]/handoff ("Falar com a equipe" na
// propria mensagem ou pergunta). Mesma forma de room-api.ts: fetch sem cache na mesma origem, { data } | { error }
// desembrulhado em WebinarsRequestError (4xx com a frase do servidor; 5xx e rede com a frase da tela). Nada de segredo.

import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { ASSISTANT_OFF, type StudentAssistantState } from "@/server/webinars/assistant-model";
import type { AssistantTarget } from "@/server/webinars/model";
import { WebinarsRequestError } from "../../webinars-client";

export function assistantApiPath(webinarId: string, part: "assistant" | "handoff", sessionId?: string | null): string {
  const url = `/api/webinars/${encodeURIComponent(webinarId)}/${part}`;
  return sessionId ? `${url}?sessao=${encodeURIComponent(sessionId)}` : url;
}

async function readData<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string; reason?: string };
  if (!response.ok || payload.data === undefined) {
    const message = response.status >= 400 && response.status < 500 && payload.error ? payload.error : fallback;
    throw new WebinarsRequestError(message, response.status, payload.reason);
  }
  return payload.data;
}

/** O estado do Assistente nesta sessao; qualquer resposta torta vira "desligado". */
export async function getAssistantState(webinarId: string, sessionId: string, signal?: AbortSignal): Promise<StudentAssistantState> {
  const response = await fetch(assistantApiPath(webinarId, "assistant", sessionId), { cache: "no-store", credentials: "same-origin", signal });
  const data = await readData<Partial<StudentAssistantState>>(response, WEBINAR_COPY.sala.erroCarregarChat);
  return {
    attendantsOnline: typeof data.attendantsOnline === "number" && data.attendantsOnline > 0 ? Math.floor(data.attendantsOnline) : ASSISTANT_OFF.attendantsOnline,
    enabled: data.enabled === true,
    replyAll: data.replyAll === true
  };
}

/** "Falar com a equipe": a marca na mensagem (target "chat") ou na pergunta (target "question") do proprio aluno. */
export async function postHandoff(webinarId: string, body: { id: string; sessionId: string; target: AssistantTarget }): Promise<{ requested: boolean }> {
  const response = await fetch(assistantApiPath(webinarId, "handoff"), {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  return readData<{ requested: boolean }>(response, WEBINAR_COPY.assistente.aluno.indisponivel);
}
