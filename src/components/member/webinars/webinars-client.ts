"use client";

// Conversa da pagina do Webinario com /api/webinars/[id]/register (docs/30 §5.1), no desenho de
// notifications-client.ts: fetch sem cache e na mesma origem; { data } | { error, reason? } desembrulhado em
// WebinarsRequestError (4xx traz a frase do servidor; 5xx e falha de rede ficam com a frase da tela). Nada
// roda em intervalo: so o clique em Garantir vaga e em Cancelar minha vaga.

export class WebinarsRequestError extends Error {
  /** 409: 'ended' | 'sold_out' | 'cancelled' (a vaga nao cabe mais). */
  reason?: string;
  status: number;

  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.name = "WebinarsRequestError";
    this.status = status;

    if (reason !== undefined) {
      this.reason = reason;
    }
  }
}

export type RegistrationAnswer = {
  calendarUrl: string;
  googleUrl: string;
  outlookUrl: string;
  registration: { id: string; registeredAt: string; sessionId: string | null; status: string; webinarId: string };
};

export type CancellationAnswer = {
  cancelled: boolean;
  registration: RegistrationAnswer["registration"] | null;
};

async function readData<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string; reason?: string };

  if (!response.ok || payload.data === undefined) {
    const message = response.status >= 400 && response.status < 500 && payload.error ? payload.error : fallback;
    throw new WebinarsRequestError(message, response.status, payload.reason);
  }

  return payload.data;
}

async function sendJson<T>(url: string, method: "DELETE" | "POST", body: unknown, fallback: string): Promise<T> {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method
  });

  return readData<T>(response, fallback);
}

function registerPath(webinarId: string) {
  return `/api/webinars/${encodeURIComponent(webinarId)}/register`;
}

/** Garantir vaga: 201 (ou 200 quando ja tinha) com a vaga e os links do calendario. A origem so vai quando existe. */
export function registerForWebinar(webinarId: string, body: { sessionId?: string | null; source?: string | null }, fallback: string) {
  const payload: { sessionId: string | null; source?: string } = { sessionId: body.sessionId ?? null };

  if (body.source) {
    payload.source = body.source;
  }

  return sendJson<RegistrationAnswer>(registerPath(webinarId), "POST", payload, fallback);
}

/** Cancelar minha vaga. */
export function cancelWebinarRegistration(webinarId: string, body: { sessionId?: string | null }, fallback: string) {
  return sendJson<CancellationAnswer>(registerPath(webinarId), "DELETE", { sessionId: body.sessionId ?? null }, fallback);
}
