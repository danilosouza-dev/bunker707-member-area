// Provedor Resend por HTTP direto (sem SDK): POST https://api.resend.com/emails com Bearer da chave
// de envio e o cabecalho Idempotency-Key (docs: resend.com/docs/dashboard/emails/idempotency-keys).
// Modulo puro: tests/email-provider-resend.test.mjs injeta um `fetch` falso e nunca sai da maquina.

import type { EmailFailureOutcome, EmailMessage, EmailProvider, EmailSendResult } from "../types";

export const RESEND_API_URL = "https://api.resend.com/emails";
/** Limite da chave de idempotencia na API do Resend. */
export const RESEND_IDEMPOTENCY_KEY_MAX_LENGTH = 256;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_ERROR_LENGTH = 500;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type ResendProviderOptions = {
  apiKey: string;
  fetch?: FetchLike;
  apiUrl?: string;
  timeoutMs?: number;
};

export type ResendErrorBody = { message?: unknown; name?: unknown; statusCode?: unknown };

/**
 * Traduz a resposta de erro do Resend para o que a fila deve fazer. Nomes de erro em
 * resend.com/docs/api-reference/errors.
 */
export function classifyResendFailure(status: number, body: ResendErrorBody | null): { outcome: EmailFailureOutcome; retryAfterMs: number | null } {
  const name = typeof body?.name === "string" ? body.name : "";

  if (status === 429 || name === "rate_limit_exceeded" || name === "daily_quota_exceeded" || name === "monthly_quota_exceeded") {
    // Limite por segundo: vale tentar no proximo tick; cota do dia: so amanha, e o lote para agora.
    const daily = name === "daily_quota_exceeded" || name === "monthly_quota_exceeded";

    return { outcome: "throttle", retryAfterMs: daily ? 60 * 60_000 : 60_000 };
  }

  if (status === 409 && name === "concurrent_idempotent_requests") {
    return { outcome: "retry", retryAfterMs: 60_000 };
  }

  if (status >= 500 || status === 408) {
    return { outcome: "retry", retryAfterMs: null };
  }

  return { outcome: "fail", retryAfterMs: null };
}

function describeError(status: number, body: ResendErrorBody | null, raw: string) {
  const name = typeof body?.name === "string" ? body.name : null;
  const message = typeof body?.message === "string" ? body.message : raw.trim();
  const text = [`HTTP ${status}`, name, message].filter(Boolean).join(": ");

  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH - 1)}…` : text;
}

function parseJson(raw: string): ResendErrorBody | null {
  try {
    const parsed = JSON.parse(raw) as unknown;

    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ResendErrorBody) : null;
  } catch {
    return null;
  }
}

export function resendRequestBody(message: EmailMessage) {
  return {
    from: message.from,
    html: message.html,
    ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    subject: message.subject,
    ...(message.text ? { text: message.text } : {}),
    to: [message.to]
  };
}

export function createResendProvider(options: ResendProviderOptions): EmailProvider {
  const apiKey = options.apiKey.trim();
  const apiUrl = options.apiUrl ?? RESEND_API_URL;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  if (!apiKey) {
    throw new Error("Provedor Resend sem chave de API.");
  }

  return {
    name: "resend",
    async send(message, sendOptions = {}): Promise<EmailSendResult> {
      if (message.idempotencyKey.length < 1 || message.idempotencyKey.length > RESEND_IDEMPOTENCY_KEY_MAX_LENGTH) {
        return { ok: false, outcome: "fail", error: "Chave de idempotência fora do tamanho aceito pelo Resend (1 a 256 caracteres)." };
      }

      const signals = [AbortSignal.timeout(timeoutMs), ...(sendOptions.signal ? [sendOptions.signal] : [])];
      let response: Response;

      try {
        response = await doFetch(apiUrl, {
          body: JSON.stringify(resendRequestBody(message)),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey
          },
          method: "POST",
          signal: AbortSignal.any(signals)
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);

        return { ok: false, outcome: "retry", error: `Sem resposta do Resend: ${reason}`.slice(0, MAX_ERROR_LENGTH) };
      }

      const raw = await response.text().catch(() => "");
      const body = parseJson(raw);

      if (response.ok) {
        const id = body && typeof body === "object" && "id" in body && typeof body.id === "string" ? body.id : null;

        return { ok: true, providerMessageId: id };
      }

      const { outcome, retryAfterMs } = classifyResendFailure(response.status, body);

      return { ok: false, outcome, error: describeError(response.status, body, raw), retryAfterMs };
    }
  };
}
