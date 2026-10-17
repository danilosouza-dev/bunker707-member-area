// Token das plataformas de venda (Hotmart: hottok): o banco guarda so o SHA-256 em hexadecimal
// (64 caracteres), nunca o token. Um dump ou backup que vaze nao permite forjar uma venda. A conferencia
// e em tempo constante. Modulo puro (node:crypto), sem "server-only": o adaptador e os testes carregam.

import { createHash, timingSafeEqual } from "node:crypto";
import { MIN_SALES_SECRET_LENGTH } from "./types";

const HEX_DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export function digestSalesToken(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

/** O que vai para integration_settings.secret: SHA-256 do token em hexadecimal. */
export function hashSalesSecret(token: string) {
  return digestSalesToken(token.trim()).toString("hex");
}

export function isSalesSecretHash(value: unknown): value is string {
  return typeof value === "string" && HEX_DIGEST_PATTERN.test(value);
}

/**
 * Compara o token recebido com o hash salvo em tempo constante: o token vira digest de 32 bytes e e
 * comparado com o hash guardado (nem o tamanho do token vaza pelo tempo de resposta).
 */
export function isValidSalesToken(providedToken: string | null | undefined, secretHash: string | null | undefined) {
  if (!isSalesSecretHash(secretHash)) {
    return false;
  }

  const provided = typeof providedToken === "string" ? providedToken.trim() : "";
  // Compara sempre (token curto ou vazio inclusive), para o tempo nao distinguir "curto" de "errado".
  const matches = timingSafeEqual(digestSalesToken(provided), Buffer.from(secretHash, "hex"));

  return matches && provided.length >= MIN_SALES_SECRET_LENGTH;
}
