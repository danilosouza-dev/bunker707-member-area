"use client";

// Conversa da pagina do Webinario com POST /api/webinars/[id]/jit (fase 4e; docs/30 §1.2 e §1.6), no desenho de
// webinars-client.ts: fetch sem cache e na mesma origem, corpo vazio ({}), { data } | { error, reason?, scheduledAt? }
// desembrulhado em JitRequestError (4xx traz a frase do servidor; 5xx e falha de rede ficam com a frase da tela).
// So o clique em Entrar chama; nada roda em intervalo.

export type JitEnterAnswer = { roomHref: string; scheduledAt: string; sessionId: string };

export class JitRequestError extends Error {
  /** 409: 'banned' | 'closed' | 'off'. */
  reason?: string;
  status: number;

  constructor(message: string, status: number, reason?: string) {
    super(message);
    this.name = "JitRequestError";
    this.status = status;

    if (reason !== undefined) {
      this.reason = reason;
    }
  }
}

/** So um endereco interno da sala deste webinario (nunca um link de fora vindo da resposta). */
const ROOM_HREF = /^\/webinarios\/[a-z0-9][a-z0-9-]{2,63}\/sala\?sessao=[0-9a-f-]{36}$/;

export function isJitRoomHref(value: unknown): value is string {
  return typeof value === "string" && ROOM_HREF.test(value);
}

/** Entrar: a sessao do horario de agora (criada ou a que outro aluno ja criou) e o endereco da sala. */
export async function enterJitRoom(webinarId: string, fallback: string): Promise<JitEnterAnswer> {
  let response: Response;

  try {
    response = await fetch(`/api/webinars/${encodeURIComponent(webinarId)}/jit`, {
      body: "{}",
      cache: "no-store",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
  } catch {
    throw new JitRequestError(fallback, 0);
  }

  const payload = (await response.json().catch(() => ({}))) as { data?: Partial<JitEnterAnswer>; error?: string; reason?: string };

  if (!response.ok || !payload.data || !isJitRoomHref(payload.data.roomHref)) {
    const message = response.status >= 400 && response.status < 500 && payload.error ? payload.error : fallback;
    throw new JitRequestError(message, response.status, payload.reason);
  }

  return { roomHref: payload.data.roomHref, scheduledAt: String(payload.data.scheduledAt ?? ""), sessionId: String(payload.data.sessionId ?? "") };
}
