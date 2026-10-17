// Adaptador da Ticto (webhook 2.0; referencia: https://webhook.ticto.dev/docs/v2). Modulo puro, sem
// "server-only": tests/vendas-ticto.test.mjs carrega direto pelo Node com payloads ficticios.
//
// O que a Ticto manda: um JSON por mudanca de situacao da venda, com `version` ("2.0"), `status` (o nome
// do evento: authorized, refunded, chargeback, subscription_canceled...), `status_date` e `order_date`
// em "AAAA-MM-DD HH:MM:SS" no horario de Brasilia, `order` (id, hash, transaction_hash), `transaction`
// (hash), `item` (product_id, product_name, offer_id, offer_code, refund_deadline em dias), `customer`
// (name, email, phone { ddi, ddd, number }, cpf...) e `bumps` (produtos vendidos junto). Nao ha id de
// evento: a chave de idempotencia e hash da transacao + situacao + data da situacao. A autenticacao e
// o `token` no corpo, gerado pela Ticto ao cadastrar o webhook; sem cabecalho. A conferencia e em tempo
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

export const TICTO_MAX_PAYLOAD_BYTES = 256 * 1024;

/** Eventos (status) da Ticto que mudam acesso; os demais sao guardados e ignorados. */
export const TICTO_HANDLED_EVENTS = ["authorized", "uncanceled", "refunded", "chargeback", "subscription_canceled"] as const;

const EVENT_TYPES: Record<string, NormalizedSaleType> = {
  authorized: "purchase_approved",
  chargeback: "chargeback",
  refunded: "refund",
  subscription_canceled: "subscription_canceled",
  // Assinatura reativada depois de cancelada: o acesso suspenso volta pelo mesmo caminho da compra.
  uncanceled: "purchase_approved"
};

/** Datas da Ticto nao trazem fuso: valem no horario de Brasilia (sem horario de verao desde 2019). */
const TICTO_UTC_OFFSET = "-03:00";
const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const DAY_MS = 86_400_000;

/** "AAAA-MM-DD HH:MM:SS" (Brasilia) ou texto ISO -> ISO em UTC. */
export function tictoDateToIso(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const text = value.trim();
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/.exec(text);
  const date = new Date(match ? `${match[1]}T${match[2]}:${match[3] ?? "00"}${TICTO_UTC_OFFSET}` : text);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function digitsOf(value: unknown, maximumLength: number) {
  return shortString(value, maximumLength)?.replace(/\D/g, "") ?? "";
}

/**
 * Telefone: `customer.phone` como objeto { ddi, ddd, number } (ou texto), ou os campos soltos
 * `phone_local_code_customer` + `phone_number_customer` do nivel de cima. Formato "+55 11999990000".
 */
function buyerPhone(customer: Record<string, unknown> | null, root: Record<string, unknown>): string | null {
  const phone = customer?.phone;
  const parts = asObject(phone);

  if (parts) {
    const ddi = digitsOf(parts.ddi, 6);
    const local = `${digitsOf(parts.ddd, 4)}${digitsOf(parts.number, 20)}`;

    if (!local) {
      return null;
    }

    return ddi ? `+${ddi} ${local}` : local;
  }

  if (typeof phone === "string") {
    const text = phone.replace(/[^\d+()\-\s]/g, "").trim();

    return text ? text.slice(0, 40) : null;
  }

  const local = `${digitsOf(root.phone_local_code_customer, 4)}${digitsOf(root.phone_number_customer, 20)}`;

  return local || null;
}

function readBuyer(root: Record<string, unknown>): SaleBuyer {
  const customer = asObject(root.customer);

  return {
    email: normalizeBuyerEmail(customer?.email),
    name: shortString(customer?.name, MAX_NAME_LENGTH),
    phone: buyerPhone(customer, root)
  };
}

export type TictoPayload = {
  item: Record<string, unknown> | null;
  order: Record<string, unknown> | null;
  root: Record<string, unknown>;
  status: string;
  statusDate: string | null;
  transaction: Record<string, unknown> | null;
  version: string | null;
};

/** Le o envelope; null sem `status` (o nome do evento). */
export function parseTictoPayload(payload: unknown): TictoPayload | null {
  const root = asObject(payload);
  const status = shortString(root?.status, 80);

  if (!root || !status) {
    return null;
  }

  return {
    item: asObject(root.item),
    order: asObject(root.order),
    root,
    status: status.toLowerCase(),
    statusDate: shortString(root.status_date, 40),
    transaction: asObject(root.transaction),
    version: shortString(root.version, 20)
  };
}

function warrantyEnd(purchasedAt: string | null, refundDeadlineDays: unknown): string | null {
  if (!purchasedAt || typeof refundDeadlineDays !== "number" || !Number.isFinite(refundDeadlineDays) || refundDeadlineDays <= 0) {
    return null;
  }

  return new Date(new Date(purchasedAt).getTime() + Math.floor(refundDeadlineDays) * DAY_MS).toISOString();
}

export function normalizeTictoEvent(payload: unknown): NormalizedSaleEvent | null {
  const parsed = parseTictoPayload(payload);

  if (!parsed) {
    return null;
  }

  const transactionId = shortString(parsed.transaction?.hash, MAX_ID_LENGTH) ?? shortString(parsed.order?.transaction_hash, MAX_ID_LENGTH);
  // Sem id de evento na Ticto: a transacao (ou o pedido), a situacao e a data da situacao identificam a
  // entrega. O mesmo postback de novo (reenvio) tem a mesma chave; uma situacao nova, outra.
  const anchor = transactionId ?? shortString(parsed.order?.hash, MAX_ID_LENGTH);

  if (!anchor) {
    return null;
  }

  const eventId = `${anchor}:${parsed.status}${parsed.statusDate ? `:${parsed.statusDate}` : ""}`.slice(0, MAX_ID_LENGTH);
  const occurredAt = tictoDateToIso(parsed.statusDate);
  const purchasedAt = tictoDateToIso(parsed.order?.order_date) ?? occurredAt;

  return {
    buyer: readBuyer(parsed.root),
    eventId,
    externalProductId: shortString(parsed.item?.product_id, 120),
    externalProductName: shortString(parsed.item?.product_name, MAX_NAME_LENGTH),
    occurredAt,
    provider: "ticto",
    purchasedAt,
    rawType: parsed.status,
    transactionId,
    type: EVENT_TYPES[parsed.status] ?? "other",
    warrantyEndsAt: warrantyEnd(purchasedAt, parsed.item?.refund_deadline)
  };
}

/** A Ticto manda o token so no corpo (`token`). */
export function readTictoToken(payload: unknown): string | null {
  const token = asObject(payload)?.token;

  return typeof token === "string" && token.trim() ? token.trim() : null;
}

export function verifyTictoRequest(input: { headers: Headers; payload: unknown; secret: string | null | undefined }): SaleVerification {
  if (typeof input.secret !== "string" || input.secret.trim().length < MIN_SALES_SECRET_LENGTH) {
    return { ok: false, reason: "missing_secret" };
  }

  const token = readTictoToken(input.payload);

  if (!token) {
    return { ok: false, reason: "missing_token" };
  }

  return isValidSalesToken(token, input.secret) ? { ok: true } : { ok: false, reason: "mismatch" };
}

const HIDDEN = "[oculto]";

/**
 * O payload guardado perde o token da conta, o link de login direto na area da Ticto e o CPF/CNPJ do
 * comprador (dado pessoal que a escola nao precisa para liberar acesso). O resto fica para auditoria e
 * reprocesso.
 */
export function redactTictoPayload(payload: unknown): unknown {
  const root = asObject(payload);

  if (!root) {
    return payload;
  }

  const copy: Record<string, unknown> = { ...root };

  for (const key of ["token", "direct_login_url"]) {
    if (key in copy) {
      copy[key] = HIDDEN;
    }
  }

  const customer = asObject(copy.customer);

  if (customer) {
    const safe = { ...customer };

    for (const key of ["cpf", "cnpj"]) {
      if (typeof safe[key] === "string" && safe[key]) {
        safe[key] = HIDDEN;
      }
    }

    copy.customer = safe;
  }

  return copy;
}

export const tictoAdapter: PaymentProviderAdapter = {
  handledEvents: TICTO_HANDLED_EVENTS,
  maxPayloadBytes: TICTO_MAX_PAYLOAD_BYTES,
  normalize: normalizeTictoEvent,
  provider: "ticto",
  redact: redactTictoPayload,
  verify: verifyTictoRequest
};
