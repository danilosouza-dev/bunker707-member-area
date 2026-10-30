// Adaptador da Ticto (webhook 2.0; referencia: https://webhook.ticto.dev/docs/v2). Modulo puro, sem
// "server-only": tests/vendas-ticto.test.mjs carrega direto pelo Node com payloads ficticios.
//
// O que a Ticto manda: um JSON por mudanca de situacao da venda, com `version` ("2.0"), `status` (o nome
// do evento: authorized, refunded, chargeback, subscription_canceled...), `status_date` e `order_date`
// em "AAAA-MM-DD HH:MM:SS" no horario de Brasilia, `order` (id, hash, transaction_hash), `transaction`
// (hash), `item` (product_id, product_name, offer_id, offer_code, refund_deadline em dias), `customer`
// (name, email, phone { ddi, ddd, number }, cpf...) e `bumps` (order bumps: produtos vendidos junto no
// mesmo pedido, cada um com product_id e product_name; viram `extraProducts`). Nao ha id de evento: a
// chave de idempotencia e transacao + produto + situacao + data da situacao. A autenticacao e o
// `token` no corpo, gerado pela Ticto ao cadastrar o webhook; sem cabecalho. A conferencia e em tempo
// constante contra o SHA-256 do token guardado em integration_settings (secret.ts, o mesmo da Hotmart),
// nunca contra variavel de ambiente.
//
// O valor pago (docs/30 M8, fase 4b) vem de `order.paid_amount` (o pedido inteiro, com os bumps), ou de `item.amount`
// sem ele, em centavos (inteiro: 19700 = R$ 197,00); a moeda, de `order.currency` ou `currency`, e reais (BRL) quando a
// Ticto nao manda. Lido do payload bruto na chegada (o guardado mantem `order.paid_amount`). So vai para
// webhook_events.amount_cents/currency; nunca decide acesso.

import { createHash } from "node:crypto";
import { asObject, normalizeBuyerEmail, pick, shortString } from "./adapter-helpers";
import { saleAmountCents, saleAmountOf } from "./sale-amount";
import { isSalesSecretHash, isValidSalesToken } from "./secret";
import {
  type NormalizedSaleEvent,
  type NormalizedSaleType,
  type PaymentProviderAdapter,
  type SaleAmount,
  type SaleBuyer,
  type SaleExtraProduct,
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
/** Bumps lidos por pedido: o checkout da Ticto oferece poucos; o limite so protege contra payload estranho. */
const MAX_BUMPS = 20;

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

/** Order bumps (`bumps`): cada produto vendido junto, sem repetir o principal nem um ao outro. */
export function readTictoBumps(root: Record<string, unknown>, mainProductId: string | null): SaleExtraProduct[] {
  const list = Array.isArray(root.bumps) ? root.bumps : [];
  const seen = new Set(mainProductId ? [mainProductId] : []);
  const extras: SaleExtraProduct[] = [];

  for (const raw of list.slice(0, MAX_BUMPS)) {
    const bump = asObject(raw);
    const id = shortString(bump?.product_id, 120);

    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    extras.push({ externalProductId: id, externalProductName: shortString(bump?.product_name, MAX_NAME_LENGTH) });
  }

  return extras;
}

/**
 * Codigo da assinatura: o `id` da primeira assinatura em `subscriptions` (o mesmo em todas as cobrancas
 * dela e no cancelamento). Venda avulsa nao tem assinatura: null.
 */
export function readTictoSubscriptionCode(root: Record<string, unknown>): string | null {
  const first = Array.isArray(root.subscriptions) ? asObject(root.subscriptions[0]) : null;

  return shortString(first?.id, 120);
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Chave de idempotencia (webhook_events.external_event_id): `<transacao>:<produto>:<situacao>:<data>`.
 * O produto separa um postback proprio de bump do postback do produto principal. Sem `status_date`, um
 * digest do payload guardado (sem o token) entra no lugar da data: o reenvio do mesmo postback continua
 * igual, e uma situacao que se repete depois (cancelada -> reativada -> cancelada) nao vira repetida.
 * Chave acima de 200 caracteres vira `sha256:<hex>` inteira, nunca cortada (cortar podia juntar duas
 * situacoes da mesma transacao numa chave so).
 */
export function tictoEventKey(input: { anchor: string; payload: unknown; productId: string | null; status: string; statusDate: string | null }) {
  const when = input.statusDate ?? `sem-data-${sha256Hex(JSON.stringify(redactTictoPayload(input.payload))).slice(0, 16)}`;
  const key = `${input.anchor}:${input.productId ?? "-"}:${input.status}:${when}`;

  return key.length <= MAX_ID_LENGTH ? key : `sha256:${sha256Hex(key)}`;
}

function warrantyEnd(purchasedAt: string | null, refundDeadlineDays: unknown): string | null {
  if (!purchasedAt || typeof refundDeadlineDays !== "number" || !Number.isFinite(refundDeadlineDays) || refundDeadlineDays <= 0) {
    return null;
  }

  return new Date(new Date(purchasedAt).getTime() + Math.floor(refundDeadlineDays) * DAY_MS).toISOString();
}

/** A moeda da Ticto quando o payload nao traz: o checkout vende em reais. */
export const TICTO_DEFAULT_CURRENCY = "BRL";

/**
 * Centavos de um valor da Ticto: inteiro (numero ou texto so com digitos) ja e centavos; texto com casa decimal
 * ("197.00", "197,00") ou numero quebrado e lido na unidade da moeda. O resto: null.
 */
export function tictoAmountCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value >= 0 ? value : null;
  }

  if (typeof value === "string" && /^\s*\d+\s*$/.test(value)) {
    const cents = Number(value.trim());

    return Number.isSafeInteger(cents) ? cents : null;
  }

  return saleAmountCents(value);
}

/**
 * O valor pago (M8): `order.paid_amount`, ou `item.amount` sem ele, com a moeda de `order.currency` / `currency` (BRL
 * quando falta). Sem valor, valor ilegivel ou moeda invalida: null.
 */
export function readTictoAmount(parsed: Pick<TictoPayload, "item" | "order" | "root">): SaleAmount | null {
  const raw = parsed.order?.paid_amount ?? parsed.item?.amount;

  if (raw === undefined || raw === null) {
    return null;
  }

  return saleAmountOf({ cents: tictoAmountCents(raw), currency: parsed.order?.currency ?? parsed.root.currency, defaultCurrency: TICTO_DEFAULT_CURRENCY });
}

export function normalizeTictoEvent(payload: unknown): NormalizedSaleEvent | null {
  const parsed = parseTictoPayload(payload);

  if (!parsed) {
    return null;
  }

  const transactionId = shortString(parsed.transaction?.hash, MAX_ID_LENGTH) ?? shortString(parsed.order?.transaction_hash, MAX_ID_LENGTH);
  // Sem id de evento na Ticto: a transacao (ou o pedido), o produto, a situacao e a data da situacao
  // identificam a entrega. O mesmo postback de novo (reenvio) tem a mesma chave; uma situacao nova, outra.
  const anchor = transactionId ?? shortString(parsed.order?.hash, MAX_ID_LENGTH);

  if (!anchor) {
    return null;
  }

  const externalProductId = shortString(parsed.item?.product_id, 120);
  const eventId = tictoEventKey({ anchor, payload, productId: externalProductId, status: parsed.status, statusDate: parsed.statusDate });
  const occurredAt = tictoDateToIso(parsed.statusDate);
  const purchasedAt = tictoDateToIso(parsed.order?.order_date) ?? occurredAt;

  return {
    amount: readTictoAmount(parsed),
    buyer: readBuyer(parsed.root),
    eventId,
    externalProductId,
    externalProductName: shortString(parsed.item?.product_name, MAX_NAME_LENGTH),
    extraProducts: readTictoBumps(parsed.root, externalProductId),
    occurredAt,
    provider: "ticto",
    purchasedAt,
    rawType: parsed.status,
    // Compra aprovada reabre o acesso fechado. A assinatura reativada (uncanceled) nao e pagamento novo: so
    // reabre o que o cancelamento desta transacao fechou (reactivatesSubscription, em process-sale.ts).
    reactivatesSubscription: parsed.status === "uncanceled",
    reopenClosedAccess: true,
    subscriptionCode: readTictoSubscriptionCode(parsed.root),
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

export function verifyTictoRequest(input: { headers: Headers; payload: unknown; secretHash: string | null | undefined }): SaleVerification {
  if (!isSalesSecretHash(input.secretHash)) {
    return { ok: false, reason: "missing_secret" };
  }

  const token = readTictoToken(input.payload);

  if (!token) {
    return { ok: false, reason: "missing_token" };
  }

  return isValidSalesToken(token, input.secretHash) ? { ok: true } : { ok: false, reason: "mismatch" };
}

const PHONE_KEYS = ["ddi", "ddd", "number"] as const;
const BUMP_KEYS = ["product_id", "product_name", "offer_id", "offer_code"] as const;
const SUBSCRIPTION_KEYS = ["id", "interval", "canceled_at", "next_charge"] as const;

function pickList(value: unknown, keys: readonly string[]) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value.slice(0, MAX_BUMPS).flatMap((item) => {
    const kept = pick(asObject(item), keys);

    return kept ? [kept] : [];
  });

  return items.length > 0 ? items : undefined;
}

/**
 * O que fica guardado do payload da Ticto (lista de campos permitidos, como na Hotmart): envelope
 * (versao, situacao e data), pedido (ids, data e valor), transacao (hash), produto e oferta, os bumps
 * (produto e oferta), as assinaturas (id, intervalo, cancelamento e proxima cobranca) e, do comprador,
 * so nome, e-mail, telefone e codigo. Token, link de login direto, CPF/CNPJ, endereco, cartao, rastreio,
 * produtor, afiliados, coprodutores e comissoes nunca sao gravados. E o que o reprocesso relê: tudo o
 * que normalizeTictoEvent usa esta aqui, menos a moeda e o `item.amount` do valor (M8), lidos do payload bruto na
 * chegada (a lista nao muda: o digest da chave sem `status_date` continua o mesmo para reenvios de antes).
 */
export function redactTictoPayload(payload: unknown): unknown {
  const root = asObject(payload);

  if (!root) {
    return payload;
  }

  return (
    pick(root, ["version", "status", "status_date", "payment_method", "order", "transaction", "item", "bumps", "subscriptions", "customer", "phone_local_code_customer", "phone_number_customer"], {
      bumps: (value) => pickList(value, BUMP_KEYS),
      customer: (value) => pick(asObject(value), ["name", "email", "phone", "code"], { phone: (inner) => (asObject(inner) ? pick(asObject(inner), PHONE_KEYS) : inner) }),
      item: (value) => pick(asObject(value), ["product_id", "product_name", "offer_id", "offer_code", "offer_name", "refund_deadline"]),
      order: (value) => pick(asObject(value), ["id", "hash", "transaction_hash", "order_date", "paid_amount"]),
      subscriptions: (value) => pickList(value, SUBSCRIPTION_KEYS),
      transaction: (value) => pick(asObject(value), ["hash"])
    }) ?? {}
  );
}

export const tictoAdapter: PaymentProviderAdapter = {
  handledEvents: TICTO_HANDLED_EVENTS,
  maxPayloadBytes: TICTO_MAX_PAYLOAD_BYTES,
  normalize: normalizeTictoEvent,
  provider: "ticto",
  redact: redactTictoPayload,
  verify: verifyTictoRequest
};
