// A assinatura do webhook do gravador (docs/30 §5.3): HMAC-SHA256 em hexadecimal de "<timestamp>.<corpo bruto>" com
// o segredo WEBINAR_RECORDER_WEBHOOK_SECRET, nos cabecalhos X-Bunker-Timestamp (segundos Unix) e X-Bunker-Signature,
// conferida em tempo constante com tolerancia de 5 minutos; o mesmo desenho de src/server/email/webhook-signature.ts
// (Svix) e do hottok da Hotmart. Quem assina: o finalize.sh da maquina do Jibri e as etapas jibri-up/jibri-down do
// workflow (infra/jitsi); quem confere: src/app/api/webhooks/recorder. Modulo puro (tests/webinarios-gravador.test.mjs).

import { createHmac, timingSafeEqual } from "node:crypto";

export const RECORDER_TOLERANCE_SECONDS = 5 * 60;
export const RECORDER_TIMESTAMP_HEADER = "x-bunker-timestamp";
export const RECORDER_SIGNATURE_HEADER = "x-bunker-signature";
const MIN_SECRET_CHARS = 32;

export type RecorderVerification =
  | { ok: true }
  | { ok: false; reason: "bad_secret" | "missing_headers" | "bad_timestamp" | "stale_timestamp" | "bad_signature" };

/** O segredo vale quando tem pelo menos 32 caracteres sem espacos (gerado pelo infra/jitsi/generate-secrets). */
export function isRecorderSecretConfigured(secret: string | null | undefined): secret is string {
  return typeof secret === "string" && secret.trim().length >= MIN_SECRET_CHARS && !/\s/.test(secret.trim());
}

export function signRecorderPayload(secret: string, timestamp: string | number, body: string): string {
  if (!isRecorderSecretConfigured(secret)) {
    throw new Error("Segredo do gravador inválido.");
  }
  return createHmac("sha256", secret.trim()).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function verifyRecorderSignature(input: {
  body: string;
  /** Agora, em ms (Date.now()). */
  now: number;
  secret: string | null | undefined;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  toleranceSeconds?: number;
}): RecorderVerification {
  if (!isRecorderSecretConfigured(input.secret)) {
    return { ok: false, reason: "bad_secret" };
  }
  if (!input.timestamp || !input.signature) {
    return { ok: false, reason: "missing_headers" };
  }
  const timestamp = input.timestamp.trim();
  if (!/^\d{1,12}$/.test(timestamp)) {
    return { ok: false, reason: "bad_timestamp" };
  }
  const tolerance = input.toleranceSeconds ?? RECORDER_TOLERANCE_SECONDS;
  const skew = Math.abs(Math.floor(input.now / 1000) - Number(timestamp));
  if (skew > tolerance) {
    return { ok: false, reason: "stale_timestamp" };
  }
  const expected = Buffer.from(signRecorderPayload(input.secret, timestamp, input.body), "hex");
  const given = /^[0-9a-f]{64}$/i.test(input.signature.trim()) ? Buffer.from(input.signature.trim(), "hex") : null;
  if (!given || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}

/** Os dois cabecalhos prontos para quem chama o webhook (o workflow e os testes). */
export function recorderHeaders(secret: string, body: string, nowMs: number): Record<string, string> {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    "content-type": "application/json",
    [RECORDER_SIGNATURE_HEADER]: signRecorderPayload(secret, timestamp, body),
    [RECORDER_TIMESTAMP_HEADER]: timestamp
  };
}
