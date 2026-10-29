// O contrato puro da Oferta (docs/30 §1.6, §4.2, §5.1 e M7) que o banco repete: a variante deterministica de cada
// aluno (a mesma conta de webinar_offer_variant na 202610290005, para "viram", "clicaram" e "compraram" cairem sempre
// na mesma variante), o click_token e o link do checkout com ?b7=<token>. Sem "server-only", imports relativos:
// tests/webinarios-v4-contratos.test.mjs carrega direto pelo Node. As contas da tela e das rotas (a janela da oferta
// no relogio do video, o prazo, o card) ficam no modulo da frente da Oferta, nao aqui.

import { createHash, randomBytes } from "node:crypto";
import { OFFER_LIMITS, OFFER_VARIANT_LABELS, type OfferVariant, type OfferVariantLabel } from "./model";

/**
 * O numero do aluno na oferta (M7): md5(user_id || offer_id) (os dois uuids em minusculas, com hifens, como o
 * Postgres escreve uuid::text), os 8 primeiros digitos hexadecimais como inteiro sem sinal (0 a 4294967295).
 */
export function offerHashNumber(userId: string, offerId: string): number {
  const digest = createHash("md5").update(`${userId.toLowerCase()}${offerId.toLowerCase()}`).digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16);
}

/**
 * A variante do aluno (M7, docs/30 §4.2): entre as variantes ligadas na ordem A, B, C, D, a primeira cujo peso
 * acumulado passa de `hash % soma dos pesos`. Sem variante ligada: nulo (o card nao aparece). A mesma conta de
 * public.webinar_offer_variant(user, oferta).
 */
export function offerVariantFor<T extends Pick<OfferVariant, "enabled" | "label" | "weight">>(input: { offerId: string; userId: string; variants: readonly T[] }): T | null {
  const enabled = input.variants
    .filter((variant) => variant.enabled && variant.weight > 0 && (OFFER_VARIANT_LABELS as readonly string[]).includes(variant.label))
    .sort((a, b) => a.label.localeCompare(b.label));
  const total = enabled.reduce((sum, variant) => sum + variant.weight, 0);
  if (total <= 0) {
    return null;
  }
  const point = offerHashNumber(input.userId, input.offerId) % total;
  let upto = 0;
  for (const variant of enabled) {
    upto += variant.weight;
    if (point < upto) {
      return variant;
    }
  }
  return enabled[enabled.length - 1] ?? null;
}

export function isOfferVariantLabel(value: unknown): value is OfferVariantLabel {
  return typeof value === "string" && (OFFER_VARIANT_LABELS as readonly string[]).includes(value);
}

/** O click_token de um clique (base64url de 18 bytes = 24 caracteres; o check da 202610290005 aceita 16 a 64). */
export function newClickToken(random: (size: number) => Buffer = randomBytes): string {
  return random(OFFER_LIMITS.clickTokenBytes).toString("base64url");
}

export function isClickToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

/**
 * O link que o aluno abre (docs/30 §5.1): o checkout da variante + `b7=<token>` (troca um `b7` que ja estivesse la).
 * So https; outro esquema devolve nulo (a rota responde 409 e nada abre).
 */
export function checkoutUrlWithToken(checkoutUrl: string, token: string): string | null {
  let url: URL;
  try {
    url = new URL(checkoutUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") {
    return null;
  }
  url.searchParams.set(OFFER_LIMITS.clickTokenParam, token);
  return url.toString();
}
