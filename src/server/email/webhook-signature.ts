// Verificacao da assinatura dos webhooks do Resend, que usa o padrao Svix
// (docs.svix.com/receiving/verifying-payloads/how-manual): HMAC-SHA256 em base64 de
// "<svix-id>.<svix-timestamp>.<corpo bruto>" com o segredo `whsec_<base64>`. Modulo puro
// (tests/email-webhook-signature.test.mjs); a rota em src/app/api/webhooks/resend chama `verifySvixSignature`.

import { createHmac, timingSafeEqual } from "node:crypto";

/** Janela aceita entre o relogio do Svix e o nosso (replay). */
export const SVIX_TOLERANCE_SECONDS = 5 * 60;
const SECRET_PREFIX = "whsec_";
const MIN_SECRET_BYTES = 16;

export type SvixVerification = { ok: true } | { ok: false; reason: "missing_headers" | "bad_timestamp" | "stale_timestamp" | "bad_signature" | "bad_secret" };

export function isWebhookSecretConfigured(secret: string | null | undefined): secret is string {
  return decodeSecret(secret) !== null;
}

function decodeSecret(secret: string | null | undefined) {
  if (typeof secret !== "string") {
    return null;
  }

  const trimmed = secret.trim();
  const encoded = trimmed.startsWith(SECRET_PREFIX) ? trimmed.slice(SECRET_PREFIX.length) : trimmed;

  if (!/^[A-Za-z0-9+/=_-]+$/.test(encoded)) {
    return null;
  }

  const bytes = Buffer.from(encoded, "base64");

  return bytes.length >= MIN_SECRET_BYTES ? bytes : null;
}

export function signSvixPayload(secret: string, id: string, timestamp: string | number, body: string) {
  const key = decodeSecret(secret);

  if (!key) {
    throw new Error("Segredo do webhook inválido.");
  }

  return createHmac("sha256", key).update(`${id}.${timestamp}.${body}`, "utf8").digest("base64");
}

/** Cabecalho `svix-signature`: entradas separadas por espaco, cada uma `v1,<base64>`. So a v1 conta. */
export function parseSvixSignatures(header: string) {
  return header
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("v1,"))
    .map((entry) => entry.slice(3))
    .filter(Boolean);
}

export function verifySvixSignature(input: {
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  body: string;
  secret: string | null | undefined;
  /** Agora, em ms (Date.now()). */
  now: number;
  toleranceSeconds?: number;
}): SvixVerification {
  const key = decodeSecret(input.secret);

  if (!key) {
    return { ok: false, reason: "bad_secret" };
  }

  if (!input.id || !input.timestamp || !input.signature) {
    return { ok: false, reason: "missing_headers" };
  }

  if (!/^\d{1,12}$/.test(input.timestamp.trim())) {
    return { ok: false, reason: "bad_timestamp" };
  }

  const tolerance = input.toleranceSeconds ?? SVIX_TOLERANCE_SECONDS;
  const timestampSeconds = Number(input.timestamp.trim());
  const nowSeconds = Math.floor(input.now / 1000);

  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expected = createHmac("sha256", key).update(`${input.id}.${input.timestamp.trim()}.${input.body}`, "utf8").digest();

  for (const candidate of parseSvixSignatures(input.signature)) {
    const provided = Buffer.from(candidate, "base64");

    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "bad_signature" };
}
