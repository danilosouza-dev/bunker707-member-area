// Adaptador da Hotmart (webhook 2.0.0). Modulo puro, sem "server-only": tests/vendas-hotmart.test.mjs
// carrega direto pelo Node com payloads ficticios.
//
// O que a Hotmart manda: um JSON com `id` (unico por evento), `event` (PURCHASE_APPROVED...), `version`,
// `creation_date` (epoch em ms) e `data` com `product`, `buyer`, `purchase` e, em assinaturas,
// `subscription`/`subscriber`. A autenticacao e o hottok, um token fixo da conta enviado no cabecalho
// `X-HOTMART-HOTTOK` (nas versoes antigas tambem no corpo, em `hottok`). A conferencia e em tempo
// constante contra o segredo salvo em integration_settings, nunca contra variavel de ambiente.

import { isSalesSecretHash, isValidSalesToken } from "./secret";
import {
  type NormalizedSaleEvent,
  type NormalizedSaleType,
  type PaymentProviderAdapter,
  type SaleBuyer,
  type SaleVerification
} from "./types";

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
  // Fim da garantia: confirma uma compra aprovada antes. Vale como compra so para quem nunca teve acesso
  // registrado ao produto (venda anterior ao webhook); nunca reabre acesso suspenso ou revogado
  // (reopenClosedAccess = false).
  PURCHASE_COMPLETE: "purchase_approved",
  PURCHASE_REFUNDED: "refund",
  PURCHASE_CHARGEBACK: "chargeback",
  SUBSCRIPTION_CANCELLATION: "subscription_canceled"
};

const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function shortString(value: unknown, maximumLength: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maximumLength) : null;
}

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

export function normalizeBuyerEmail(value: unknown): string | null {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";

  return email.length > 0 && email.length <= 320 && EMAIL_PATTERN.test(email) ? email : null;
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
  const subscription = asObject(parsed.data?.subscription);
  const transactionId = shortString(purchase?.transaction, MAX_ID_LENGTH);
  // Compras de assinatura trazem data.subscription.subscriber.code; o cancelamento, data.subscriber.code.
  const subscriptionCode = shortString(asObject(subscription?.subscriber)?.code, 120) ?? shortString(asObject(parsed.data?.subscriber)?.code, 120);
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
    reopenClosedAccess: parsed.event !== "PURCHASE_COMPLETE",
    subscriptionCode,
    transactionId,
    type: EVENT_TYPES[parsed.event] ?? "other",
    warrantyEndsAt: hotmartDateToIso(purchase?.warranty_expire_date)
  };
}

export { hashSalesSecret, isValidSalesToken } from "./secret";

export function readHotmartToken(headers: Headers, payload: unknown): string | null {
  const fromHeader = headers.get(HOTMART_HOTTOK_HEADER)?.trim();

  if (fromHeader) {
    return fromHeader;
  }

  const fromBody = asObject(payload)?.hottok;

  return typeof fromBody === "string" && fromBody.trim() ? fromBody.trim() : null;
}

export function verifyHotmartRequest(input: { headers: Headers; payload: unknown; secretHash: string | null | undefined }): SaleVerification {
  if (!isSalesSecretHash(input.secretHash)) {
    return { ok: false, reason: "missing_secret" };
  }

  const token = readHotmartToken(input.headers, input.payload);

  if (!token) {
    return { ok: false, reason: "missing_token" };
  }

  return isValidSalesToken(token, input.secretHash) ? { ok: true } : { ok: false, reason: "mismatch" };
}

/** Copia so das chaves listadas de um objeto (valores escalares ou objetos tratados por `nested`). */
function pick(source: Record<string, unknown> | null, keys: readonly string[], nested: Record<string, (value: unknown) => unknown> = {}) {
  if (!source) {
    return undefined;
  }

  const result: Record<string, unknown> = {};

  for (const key of keys) {
    if (!(key in source)) {
      continue;
    }

    const value = nested[key] ? nested[key](source[key]) : source[key];

    if (value !== undefined && (value === null || typeof value !== "object" || Object.keys(value as object).length > 0)) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

const BUYER_KEYS = ["email", "name", "checkout_phone", "checkout_phone_code", "code"] as const;

/**
 * O que fica guardado do payload da Hotmart: envelope, produto (id e nome), compra (transacao, situacao
 * e datas), assinatura (situacao e codigo do assinante) e, do comprador, so e-mail, nome e telefone.
 * Token (hottok), documento, endereco, produtor, afiliados e comissoes nunca sao gravados.
 */
export function redactHotmartPayload(payload: unknown): unknown {
  const root = asObject(payload);

  if (!root) {
    return payload;
  }

  const data = asObject(root.data);
  const kept = pick(root, ["id", "event", "version", "creation_date"]) ?? {};
  const keptData = pick(data, ["product", "buyer", "subscriber", "purchase", "subscription"], {
    buyer: (value) => pick(asObject(value), BUYER_KEYS),
    product: (value) => pick(asObject(value), ["id", "name"]),
    purchase: (value) => pick(asObject(value), ["transaction", "status", "approved_date", "order_date", "warranty_expire_date"]),
    subscriber: (value) => pick(asObject(value), BUYER_KEYS),
    subscription: (value) => pick(asObject(value), ["status", "subscriber"], { subscriber: (inner) => pick(asObject(inner), ["code"]) })
  });

  return keptData ? { ...kept, data: keptData } : kept;
}

export const hotmartAdapter: PaymentProviderAdapter = {
  handledEvents: HOTMART_HANDLED_EVENTS,
  maxPayloadBytes: HOTMART_MAX_PAYLOAD_BYTES,
  normalize: normalizeHotmartEvent,
  provider: "hotmart",
  redact: redactHotmartPayload,
  verify: verifyHotmartRequest
};
