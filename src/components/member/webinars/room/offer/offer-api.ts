"use client";

// A conversa do card da Oferta com /api/webinars/[id]/offer e .../offer-click (docs/30 §5.1), no desenho de room-api.ts:
// fetch sem cache e na mesma origem; { data } | { error, reason? } desembrulhado em WebinarsRequestError (4xx traz a
// frase do servidor e o motivo, como `offer_hidden`; 5xx e falha de rede ficam com a frase da tela). O link do
// checkout so chega na resposta do clique, ja com ?b7=<token>; nada aqui guarda o link.

import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { OFFER_OFFSET_MAX_MS, OFFER_OFFSET_MIN_MS } from "@/server/webinars/offer-room-model";
import type { StudentOfferView } from "@/server/webinars/model";
import { WebinarsRequestError } from "../../webinars-client";

export { WebinarsRequestError };

export type StudentOfferAnswer = { offer: StudentOfferView | null; pollMs: number; serverTime: string };

function offerPath(webinarId: string, part: "offer" | "offer-click", sessionId?: string) {
  const base = `/api/webinars/${encodeURIComponent(webinarId)}/${part}`;
  return sessionId ? `${base}?sessao=${encodeURIComponent(sessionId)}` : base;
}

async function readData<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string; reason?: string };
  if (!response.ok || payload.data === undefined) {
    const message = response.status >= 400 && response.status < 500 && payload.error ? payload.error : fallback;
    throw new WebinarsRequestError(message, response.status, payload.reason);
  }
  return payload.data;
}

/** O card do aluno nesta sessao, com o instante do envio e da resposta (para o relogio do prazo). */
export async function getStudentOffer(webinarId: string, sessionId: string, signal?: AbortSignal) {
  const sentAtMs = Date.now();
  const response = await fetch(offerPath(webinarId, "offer", sessionId), { cache: "no-store", credentials: "same-origin", signal });
  const data = await readData<StudentOfferAnswer>(response, WEBINAR_COPY.oferta.aluno.naoEncontrada);
  return { data, receivedAtMs: Date.now(), sentAtMs };
}

/** "Quero participar": o link do checkout com o token do clique. */
export async function postOfferClick(webinarId: string, body: { offerId: string; offsetMs?: number; sessionId: string }) {
  const offsetMs = typeof body.offsetMs === "number" && Number.isFinite(body.offsetMs) ? Math.min(OFFER_OFFSET_MAX_MS, Math.max(OFFER_OFFSET_MIN_MS, Math.round(body.offsetMs))) : undefined;
  const response = await fetch(offerPath(webinarId, "offer-click"), {
    body: JSON.stringify({ offerId: body.offerId, offsetMs, sessionId: body.sessionId }),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  return readData<{ url: string }>(response, WEBINAR_COPY.oferta.aluno.erro);
}
