// Ajudantes comuns dos adaptadores das plataformas de venda (hotmart.ts, ticto.ts): leitura tolerante
// do payload e a conferencia do token em tempo constante. Modulo puro, sem "server-only": os testes
// carregam direto pelo Node.

import { createHash, timingSafeEqual } from "node:crypto";
import { MIN_SALES_SECRET_LENGTH } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Texto curto do payload (numero vira texto); vazio ou de outro tipo e null. */
export function shortString(value: unknown, maximumLength: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maximumLength) : null;
}

export function normalizeBuyerEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";

  return email.length > 0 && email.length <= 320 && EMAIL_PATTERN.test(email) ? email : null;
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Compara o token recebido com o segredo salvo em tempo constante: os dois viram digests SHA-256 de
 * 32 bytes antes do timingSafeEqual (nem o tamanho do segredo vaza pelo tempo de resposta).
 */
export function isValidSalesToken(providedToken: string | null | undefined, secret: string | null | undefined) {
  if (typeof secret !== "string" || secret.trim().length < MIN_SALES_SECRET_LENGTH) {
    return false;
  }

  const provided = typeof providedToken === "string" ? providedToken.trim() : "";

  return timingSafeEqual(digest(provided), digest(secret.trim())) && provided.length > 0;
}
