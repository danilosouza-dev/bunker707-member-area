// Adaptador da Hotmart (webhook 2.0.0). Modulo puro, sem "server-only": tests/vendas-hotmart.test.mjs
// carrega direto pelo Node com payloads ficticios.
//
// O que a Hotmart manda: um JSON com `id` (unico por evento), `event` (PURCHASE_APPROVED...), `version`,
// `creation_date` (epoch em ms) e `data` com `product`, `buyer`, `purchase` e, em assinaturas,
// `subscription`/`subscriber`. A autenticacao e o hottok, um token fixo da conta enviado no cabecalho
// `X-HOTMART-HOTTOK` (nas versoes antigas tambem no corpo, em `hottok`). A conferencia e em tempo
// constante contra o segredo salvo em integration_settings, nunca contra variavel de ambiente.

import { asObject, isValidSalesToken, normalizeBuyerEmail, shortString } from "./adapter-helpers";
import {
  MIN_SALES_SECRET_LENGTH,
  type NormalizedSaleEvent,
  type NormalizedSaleType,
  type PaymentProviderAdapter,
  type SaleBuyer,
  type SaleVerification
} from "./types";

// Ajudantes comuns aos adaptadores (adapter-helpers.ts), reexportados para quem ja os importava daqui.
export { isValidSalesToken, normalizeBuyerEmail };

export const HOTMART_HOTTOK_HEADER = "x-hotmart-hottok";
export const HOTMART_MAX_PAYLOAD_BYTES = 256 * 1024;

/** Eventos da Hotmart que mudam acesso; os demais sao guardados e ignorados. */
export const HOTMART_HANDLED_EVENTS = [
  "PURCHASE_APPROVED",
  "PURCHASE_COMPLETE",
  "PURCHASE_REFUNDED",
  "PURCHASE_CHARGEBACK",
  "SUBSCRIPTION_CANCELLATION"
] as const;

const EVENT_TYPES: Record<string, NormalizedSaleType> = {
  PURCHASE_APPROVED: "purchase_approved",
  // Fim da garantia: a compra ja foi aprovada antes; tratar como aprovada e inofensivo (quem ja tem
  // acesso continua igual) e cobre a venda que aconteceu antes do webhook ser ligado.
  PURCHASE_COMPLETE: "purchase_approved",
  PURCHASE_REFUNDED: "refund",
  PURCHASE_CHARGEBACK: "chargeback",
  SUBSCRIPTION_CANCELLATION: "subscription_canceled"
};

const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 200;

/** Datas da Hotmart vem em epoch de milissegundos; aceitamos tambem texto ISO. */
export function hotmartDateToIso(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const date = new Date(value < 1e11 ? value * 1000 : value);

    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const date = new Date(value.trim());

    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function buyerPhone(source: Record<string, unknown> | null): string | null {
  const phone = shortString(source?.checkout_phone ?? source?.phone, 40)?.replace(/[^\d+()\-\s]/g, "").trim() ?? null;

  if (!phone) {
    return null;
  }

  const code = shortString(source?.checkout_phone_code, 6)?.replace(/\D/g, "") ?? "";

  return code && !phone.startsWith("+") && !phone.startsWith(code) ? `+${code} ${phone}` : phone;
}

/** Comprador: `data.buyer` nas compras; `data.subscriber` nos eventos de assinatura. */
function readBuyer(data: Record<string, unknown> | null): SaleBuyer {
  const buyer = asObject(data?.buyer) ?? asObject(data?.subscriber);

  return {
    email: normalizeBuyerEmail(buyer?.email),
    name: shortString(buyer?.name, MAX_NAME_LENGTH),
    phone: buyerPhone(buyer)
  };
}

export type HotmartPayload = {
  creationDate: string | null;
  data: Record<string, unknown> | null;
  event: string;
  id: string | null;
  version: string | null;
};

/** Le o envelope; null sem `event`. */
export function parseHotmartPayload(payload: unknown): HotmartPayload | null {
  const root = asObject(payload);
  const event = shortString(root?.event, 80);

  if (!root || !event) {
    return null;
  }

  return {
    creationDate: hotmartDateToIso(root.creation_date),
    data: asObject(root.data),
    event: event.toUpperCase(),
    id: shortString(root.id, MAX_ID_LENGTH),
    version: shortString(root.version, 20)
  };
}

export function normalizeHotmartEvent(payload: unknown): NormalizedSaleEvent | null {
  const parsed = parseHotmartPayload(payload);

  if (!parsed) {
    return null;
  }

  const product = asObject(parsed.data?.product);
  const purchase = asObject(parsed.data?.purchase);
  const transactionId = shortString(purchase?.transaction, MAX_ID_LENGTH);
  // Sem `id` (payload antigo ou de teste), a compra + o evento identificam a entrega.
  const eventId = parsed.id ?? (transactionId ? `${transactionId}:${parsed.event}` : null);

  if (!eventId) {
    return null;
  }

  return {
    buyer: readBuyer(parsed.data),
    eventId,
    externalProductId: shortString(product?.id, 120),
    externalProductName: shortString(product?.name, MAX_NAME_LENGTH),
    occurredAt: parsed.creationDate,
    provider: "hotmart",
    purchasedAt: hotmartDateToIso(purchase?.approved_date) ?? hotmartDateToIso(purchase?.order_date) ?? parsed.creationDate,
    rawType: parsed.event,
    transactionId,
    type: EVENT_TYPES[parsed.event] ?? "other",
    warrantyEndsAt: hotmartDateToIso(purchase?.warranty_expire_date)
  };
}

export function readHotmartToken(headers: Headers, payload: unknown): string | null {
  const fromHeader = headers.get(HOTMART_HOTTOK_HEADER)?.trim();

  if (fromHeader) {
    return fromHeader;
  }

  const fromBody = asObject(payload)?.hottok;

  return typeof fromBody === "string" && fromBody.trim() ? fromBody.trim() : null;
}

export function verifyHotmartRequest(input: { headers: Headers; payload: unknown; secret: string | null | undefined }): SaleVerification {
  if (typeof input.secret !== "string" || input.secret.trim().length < MIN_SALES_SECRET_LENGTH) {
    return { ok: false, reason: "missing_secret" };
  }

  const token = readHotmartToken(input.headers, input.payload);

  if (!token) {
    return { ok: false, reason: "missing_token" };
  }

  return isValidSalesToken(token, input.secret) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** O payload guardado nao pode carregar o token da conta (a Hotmart o repete no corpo nas versoes antigas). */
export function redactHotmartPayload(payload: unknown): unknown {
  const root = asObject(payload);

  if (!root || !("hottok" in root)) {
    return payload;
  }

  return { ...root, hottok: "[oculto]" };
}

export const hotmartAdapter: PaymentProviderAdapter = {
  handledEvents: HOTMART_HANDLED_EVENTS,
  maxPayloadBytes: HOTMART_MAX_PAYLOAD_BYTES,
  normalize: normalizeHotmartEvent,
  provider: "hotmart",
  redact: redactHotmartPayload,
  verify: verifyHotmartRequest
};
