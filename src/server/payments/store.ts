import "server-only";

// Acesso ao banco de Vendas (migracao 202610170003): integration_settings, webhook_events e
// sales_product_links. Colunas explicitas e uma linha por escrita (docs/13). Sempre com a chave de
// servico, a partir do webhook (depois de conferir o token) ou de Server Actions/paginas que ja
// passaram por requireRole("settings.sales") ou "catalog.access".
//
// O segredo de cada plataforma so sai daqui por fetchIntegrationSecret, usada pelo webhook; a tela le
// fetchIntegrationRows, que nao traz a coluna.

import { PENDING_MIGRATION_MESSAGE, isMissingSchemaObjectError, toDbError } from "@/server/db/pending-migration";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { STUCK_RECEIVED_MINUTES, type IntegrationStatus, type SaleOutcome, type WebhookProcessingStatus, pendingAttentionMessage } from "./model";
import type { NormalizedSaleType, SalesProvider } from "./types";

export type SalesDb = ReturnType<typeof getSupabaseAdminClient>;

export function salesDb(): SalesDb {
  return getSupabaseAdminClient();
}

type DbError = { code?: string | null; hint?: string | null; message: string } | null;

function failOnError(error: DbError, context: string) {
  if (error) {
    throw toDbError(error, context);
  }
}

/* ------------------------------------------------------------------------------------------------
 * integration_settings
 * ---------------------------------------------------------------------------------------------- */

/** Colunas da tela: NUNCA `secret`. */
const INTEGRATION_COLUMNS = "provider,status,webhook_url,secret_status,secret_updated_at,events,last_sync_at,last_error,updated_at";

export type IntegrationRow = {
  events: unknown;
  last_error: string | null;
  last_sync_at: string | null;
  provider: SalesProvider;
  secret_status: "missing" | "set";
  secret_updated_at: string | null;
  status: IntegrationStatus;
  updated_at: string;
  webhook_url: string | null;
};

export async function fetchIntegrationRows(db: SalesDb): Promise<IntegrationRow[]> {
  const { data, error } = await db.from("integration_settings").select(INTEGRATION_COLUMNS).order("provider", { ascending: true });
  failOnError(error, "Plataformas de venda");

  return (data ?? []) as IntegrationRow[];
}

export async function fetchIntegrationRow(db: SalesDb, provider: SalesProvider): Promise<IntegrationRow | null> {
  const { data, error } = await db.from("integration_settings").select(INTEGRATION_COLUMNS).eq("provider", provider).maybeSingle();
  failOnError(error, "Plataforma de venda");

  return (data ?? null) as IntegrationRow | null;
}

/** So o webhook: o SHA-256 do token (secret.ts) para conferir o pedido. null = plataforma nao conectada. */
export async function fetchIntegrationSecret(db: SalesDb, provider: SalesProvider): Promise<string | null> {
  const { data, error } = await db.from("integration_settings").select("secret,secret_status").eq("provider", provider).maybeSingle();
  failOnError(error, "Segredo da plataforma de venda");

  const row = (data ?? null) as { secret: string | null; secret_status: string } | null;

  return row?.secret_status === "set" && row.secret ? row.secret : null;
}

/** Grava o HASH do token (hashSalesSecret em secret.ts), nunca o token. */
export async function saveIntegrationSecret(
  db: SalesDb,
  input: { events: readonly string[]; provider: SalesProvider; secretHash: string; webhookUrl: string }
) {
  const now = new Date().toISOString();
  const { error } = await db.from("integration_settings").upsert(
    {
      events: [...input.events],
      last_error: null,
      provider: input.provider,
      secret: input.secretHash,
      secret_status: "set",
      secret_updated_at: now,
      status: "configured",
      webhook_url: input.webhookUrl
    },
    { onConflict: "provider" }
  );
  failOnError(error, "Guardar o token da plataforma");
}

export async function clearIntegration(db: SalesDb, provider: SalesProvider) {
  const { error } = await db
    .from("integration_settings")
    .upsert(
      {
        events: [],
        last_error: null,
        provider,
        secret: null,
        secret_status: "missing",
        secret_updated_at: null,
        status: "not_configured",
        webhook_url: null
      },
      { onConflict: "provider" }
    );
  failOnError(error, "Desconectar a plataforma");
}

/** Quantas vendas da plataforma precisam de alguem: com erro, ou presas em `received` ha mais de STUCK_RECEIVED_MINUTES. */
export async function countEventsNeedingAttention(db: SalesDb, provider: SalesProvider, now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - STUCK_RECEIVED_MINUTES * 60_000).toISOString();
  const { count, error } = await db
    .from("webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("provider", provider)
    .or(`processing_status.eq.failed,and(processing_status.eq.received,received_at.lt.${cutoff})`);
  failOnError(error, "Vendas com erro");

  return count ?? 0;
}

/**
 * Depois de cada evento processado: hora do ultimo e situacao. "Precisa de atencao" enquanto houver
 * QUALQUER venda com erro ou presa aguardando reprocesso, nao so quando a ultima falhou: um evento que
 * da certo logo depois nao esconde a venda que falhou.
 */
export async function markIntegrationSync(db: SalesDb, provider: SalesProvider, result: { error: string | null }) {
  let failedCount = 0;

  try {
    failedCount = await countEventsNeedingAttention(db, provider);
  } catch (countError) {
    console.error(`[vendas] vendas com erro da ${provider} nao contadas: ${countError instanceof Error ? countError.message : String(countError)}`);
  }

  const pendingMessage = pendingAttentionMessage(failedCount);
  const { error } = await db
    .from("integration_settings")
    .update({
      last_error: result.error ? result.error.slice(0, 2000) : pendingMessage,
      last_sync_at: new Date().toISOString(),
      status: result.error || failedCount > 0 ? "needs_attention" : "configured"
    })
    .eq("provider", provider)
    .eq("secret_status", "set");

  if (error) {
    console.error(`[vendas] situacao da ${provider} nao atualizada: ${error.message}`);
  }
}

/**
 * Confere AGORA se a plataforma precisa de atencao (venda com erro, ou presa em `received` sem ninguem
 * para marcar). So muda a linha de "Conectada" para "Precisa de atencao", nunca o contrario: um aviso
 * gravado pelo webhook (token em formato antigo, ultimo erro) continua ate o proximo evento ou troca.
 * Devolve a linha como ficou (ou a mesma, quando nada mudou).
 */
export async function markIntegrationAttention(db: SalesDb, provider: SalesProvider, row: IntegrationRow, now: number = Date.now()): Promise<IntegrationRow> {
  const count = await countEventsNeedingAttention(db, provider, now);
  const message = pendingAttentionMessage(count);

  if (!message || (row.status === "needs_attention" && row.last_error)) {
    return row;
  }

  const { error } = await db.from("integration_settings").update({ last_error: message, status: "needs_attention" }).eq("provider", provider).eq("secret_status", "set");
  failOnError(error, "Situação da plataforma");

  return { ...row, last_error: message, status: "needs_attention" };
}

/* ------------------------------------------------------------------------------------------------
 * webhook_events
 * ---------------------------------------------------------------------------------------------- */

export const WEBHOOK_EVENT_COLUMNS =
  "id,provider,external_event_id,event_type,normalized_type,signature_valid,processing_status,outcome,outcome_detail,buyer_email,external_product_id,external_product_name,transaction_id,product_id,combo_id,user_id,received_at,processed_at,error_message";

export type WebhookEventRow = {
  buyer_email: string | null;
  transaction_id: string | null;
  combo_id: string | null;
  error_message: string | null;
  event_type: string;
  external_event_id: string;
  external_product_id: string | null;
  external_product_name: string | null;
  id: string;
  normalized_type: NormalizedSaleType | null;
  outcome: SaleOutcome | null;
  outcome_detail: string | null;
  processed_at: string | null;
  processing_status: WebhookProcessingStatus;
  product_id: string | null;
  provider: SalesProvider;
  received_at: string;
  signature_valid: boolean;
  user_id: string | null;
};

export type WebhookEventInsert = {
  buyerEmail: string | null;
  eventType: string;
  externalEventId: string;
  externalProductId: string | null;
  externalProductName: string | null;
  normalizedType: NormalizedSaleType;
  payload: unknown;
  provider: SalesProvider;
  signatureValid: boolean;
  transactionId: string | null;
};

/** Grava o evento bruto; o mesmo (provider, external_event_id) de novo devolve `duplicate`. */
export async function insertWebhookEvent(db: SalesDb, input: WebhookEventInsert): Promise<{ duplicate: boolean; id: string | null }> {
  const { data, error } = await db
    .from("webhook_events")
    .insert({
      buyer_email: input.buyerEmail,
      event_type: input.eventType,
      external_event_id: input.externalEventId,
      external_product_id: input.externalProductId,
      external_product_name: input.externalProductName,
      normalized_type: input.normalizedType,
      payload: input.payload,
      processing_started_at: new Date().toISOString(),
      processing_status: "received",
      provider: input.provider,
      signature_valid: input.signatureValid,
      transaction_id: input.transactionId
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    return { duplicate: true, id: null };
  }

  failOnError(error, "Registrar a venda recebida");

  return { duplicate: false, id: (data as { id: string }).id };
}

/**
 * Reenvio de um evento que ficou preso em `received` (o processamento morreu depois de gravar): reivindica
 * a linha com um update condicional, para so um processamento rodar por vez. Devolve o id reivindicado
 * ou null (evento ja processado, ou ainda rodando).
 */
export async function claimStaleReceivedEvent(
  db: SalesDb,
  input: { externalEventId: string; provider: SalesProvider; staleAfterMs: number }
): Promise<string | null> {
  const cutoff = new Date(Date.now() - input.staleAfterMs).toISOString();
  const { data, error } = await db
    .from("webhook_events")
    .update({ processing_started_at: new Date().toISOString() })
    .eq("provider", input.provider)
    .eq("external_event_id", input.externalEventId)
    .eq("processing_status", "received")
    .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`)
    .lt("received_at", cutoff)
    .select("id");
  failOnError(error, "Reivindicar a venda presa");

  return ((data ?? []) as { id: string }[])[0]?.id ?? null;
}

/**
 * Reivindica a linha para um reprocesso (botao ou reenvio): update condicional na situacao lida e em
 * processing_started_at (nulo ou mais velho que a janela). Devolve false quando outro processamento
 * acabou de comecar (segundo clique, duas abas, reenvio da plataforma ao mesmo tempo).
 */
export async function claimEventForProcessing(
  db: SalesDb,
  input: { expectedStatus: WebhookProcessingStatus; id: string; staleAfterMs: number }
): Promise<boolean> {
  const cutoff = new Date(Date.now() - input.staleAfterMs).toISOString();
  const { data, error } = await db
    .from("webhook_events")
    .update({ processing_started_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("processing_status", input.expectedStatus)
    .or(`processing_started_at.is.null,processing_started_at.lt.${cutoff}`)
    .select("id");
  failOnError(error, "Reprocessar a venda");

  return ((data ?? []) as { id: string }[]).length > 0;
}

/** A linha de um evento pelo id da plataforma (reenvio): situacao e quando chegou. */
export async function fetchWebhookEventByExternalId(
  db: SalesDb,
  provider: SalesProvider,
  externalEventId: string
): Promise<Pick<WebhookEventRow, "id" | "processing_status" | "received_at"> | null> {
  const { data, error } = await db
    .from("webhook_events")
    .select("id,processing_status,received_at")
    .eq("provider", provider)
    .eq("external_event_id", externalEventId)
    .maybeSingle();
  failOnError(error, "Venda recebida");

  return (data ?? null) as Pick<WebhookEventRow, "id" | "processing_status" | "received_at"> | null;
}

/** A compra ja tem reembolso ou chargeback registrado (em qualquer situacao de processamento)? */
export async function hasClosingEventForTransaction(db: SalesDb, provider: SalesProvider, transactionId: string): Promise<boolean> {
  const { count, error } = await db
    .from("webhook_events")
    .select("id", { count: "exact", head: true })
    .eq("provider", provider)
    .eq("transaction_id", transactionId)
    .in("normalized_type", ["refund", "chargeback"]);
  failOnError(error, "Reembolsos da compra");

  return (count ?? 0) > 0;
}

/**
 * Exclusao do aluno (LGPD): os eventos de venda dele perdem o e-mail e o payload fica so com o envelope
 * (id, evento, data). Tabela ausente (banco sem a migracao) nao impede a exclusao.
 */
export async function anonymizeWebhookEventsFor(db: SalesDb, input: { email: string | null; userId: string }) {
  const filters = [`user_id.eq.${input.userId}`];

  if (input.email) {
    filters.push(`buyer_email.eq.${input.email.replace(/[,()]/g, "")}`);
  }

  const { data, error } = await db
    .from("webhook_events")
    .select("id,payload")
    .or(filters.join(","));

  if (error) {
    if (isMissingSchemaObjectError(error)) {
      return 0;
    }

    failOnError(error, "Vendas do aluno");
  }

  const rows = (data ?? []) as { id: string; payload: unknown }[];

  for (const row of rows) {
    const payload = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : {};
    const envelope = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "data"));
    const { error: updateError } = await db
      .from("webhook_events")
      .update({ buyer_email: null, payload: { ...envelope, anonymized: true } })
      .eq("id", row.id);
    failOnError(updateError, "Anonimizar vendas do aluno");
  }

  return rows.length;
}

export type WebhookEventResultPatch = {
  comboId?: string | null;
  errorMessage?: string | null;
  outcome: SaleOutcome;
  outcomeDetail: string | null;
  processingStatus: Exclude<WebhookProcessingStatus, "received">;
  productId?: string | null;
  userId?: string | null;
};

export async function updateWebhookEventResult(db: SalesDb, id: string, patch: WebhookEventResultPatch) {
  const { error } = await db
    .from("webhook_events")
    .update({
      combo_id: patch.comboId ?? null,
      error_message: patch.errorMessage ? patch.errorMessage.slice(0, 2000) : null,
      outcome: patch.outcome,
      outcome_detail: patch.outcomeDetail ? patch.outcomeDetail.slice(0, 500) : null,
      processed_at: new Date().toISOString(),
      // Processamento terminou: a trava (processing_started_at) e solta; o proximo reprocesso a reivindica.
      processing_started_at: null,
      processing_status: patch.processingStatus,
      product_id: patch.productId ?? null,
      user_id: patch.userId ?? null
    })
    .eq("id", id);
  failOnError(error, "Registrar o resultado da venda");
}

export async function fetchWebhookEvent(db: SalesDb, id: string): Promise<(WebhookEventRow & { payload: unknown }) | null> {
  const { data, error } = await db.from("webhook_events").select(`${WEBHOOK_EVENT_COLUMNS},payload`).eq("id", id).maybeSingle();
  failOnError(error, "Venda recebida");

  return (data ?? null) as (WebhookEventRow & { payload: unknown }) | null;
}

export async function listWebhookEvents(db: SalesDb, input: { limit: number; provider?: SalesProvider }): Promise<WebhookEventRow[]> {
  let query = db.from("webhook_events").select(WEBHOOK_EVENT_COLUMNS).order("received_at", { ascending: false }).limit(input.limit);

  if (input.provider) {
    query = query.eq("provider", input.provider);
  }

  const { data, error } = await query;
  failOnError(error, "Vendas recebidas");

  return (data ?? []) as WebhookEventRow[];
}

/* ------------------------------------------------------------------------------------------------
 * sale_grants: vinculo venda -> acesso (migracao 202610170008)
 * ---------------------------------------------------------------------------------------------- */

const SALE_GRANT_COLUMNS = "id,provider,transaction_id,subscription_code,user_id,entitlement_id,product_id,opened,previous_ends_at,closed_at,closed_by,created_at";

export type SaleGrantRow = {
  closed_at: string | null;
  closed_by: "refund" | "chargeback" | "subscription_canceled" | "admin" | null;
  created_at: string;
  entitlement_id: string;
  id: string;
  opened: boolean;
  previous_ends_at: string | null;
  product_id: string;
  provider: SalesProvider;
  subscription_code: string | null;
  transaction_id: string;
  user_id: string;
};

export type SaleGrantInsert = {
  entitlementId: string;
  opened: boolean;
  previousEndsAt: string | null;
  productId: string;
  provider: SalesProvider;
  subscriptionCode: string | null;
  transactionId: string;
  userId: string;
  webhookEventId: string | null;
};

/** Banco com a tabela de vinculos (migracao 202610170008)? Sem ela, nenhuma venda pode liberar acesso. */
export async function assertSaleGrantsAvailable(db: SalesDb) {
  const { error } = await db.from("sale_grants").select("id", { count: "exact", head: true }).limit(1);

  if (error) {
    throw toDbError(error, "Vínculos de venda");
  }
}

/** Grava o vinculo de uma venda com um acesso; a mesma venda reprocessada nao duplica. */
export async function insertSaleGrants(db: SalesDb, grants: readonly SaleGrantInsert[]) {
  if (grants.length === 0) {
    return;
  }

  const { error } = await db.from("sale_grants").upsert(
    grants.map((grant) => ({
      entitlement_id: grant.entitlementId,
      opened: grant.opened,
      previous_ends_at: grant.previousEndsAt,
      product_id: grant.productId,
      provider: grant.provider,
      subscription_code: grant.subscriptionCode,
      transaction_id: grant.transactionId,
      user_id: grant.userId,
      webhook_event_id: grant.webhookEventId
    })),
    { ignoreDuplicates: true, onConflict: "provider,transaction_id,entitlement_id" }
  );
  failOnError(error, "Registrar o vínculo da venda com o acesso");
}

export async function fetchSaleGrantsByTransaction(db: SalesDb, provider: SalesProvider, transactionId: string): Promise<SaleGrantRow[]> {
  const { data, error } = await db.from("sale_grants").select(SALE_GRANT_COLUMNS).eq("provider", provider).eq("transaction_id", transactionId).order("created_at");
  failOnError(error, "Vínculos da venda");

  return (data ?? []) as SaleGrantRow[];
}

export async function fetchSaleGrantsBySubscription(db: SalesDb, provider: SalesProvider, subscriptionCode: string): Promise<SaleGrantRow[]> {
  const { data, error } = await db.from("sale_grants").select(SALE_GRANT_COLUMNS).eq("provider", provider).eq("subscription_code", subscriptionCode).order("created_at");
  failOnError(error, "Vínculos da assinatura");

  return (data ?? []) as SaleGrantRow[];
}

/** Todos os vinculos (de qualquer venda) dos acessos informados, para saber se outra compra os sustenta. */
export async function fetchSaleGrantsForEntitlements(db: SalesDb, entitlementIds: readonly string[]): Promise<SaleGrantRow[]> {
  if (entitlementIds.length === 0) {
    return [];
  }

  const { data, error } = await db.from("sale_grants").select(SALE_GRANT_COLUMNS).in("entitlement_id", [...entitlementIds]).order("created_at");
  failOnError(error, "Vínculos dos acessos");

  return (data ?? []) as SaleGrantRow[];
}

export async function closeSaleGrants(db: SalesDb, ids: readonly string[], closedBy: Exclude<NonNullable<SaleGrantRow["closed_by"]>, "admin">) {
  if (ids.length === 0) {
    return;
  }

  const { error } = await db.from("sale_grants").update({ closed_at: new Date().toISOString(), closed_by: closedBy }).in("id", [...ids]).is("closed_at", null);
  failOnError(error, "Fechar o vínculo da venda");
}

/* ------------------------------------------------------------------------------------------------
 * sales_product_links
 * ---------------------------------------------------------------------------------------------- */

const LINK_COLUMNS = "id,provider,external_product_id,product_id,combo_id,updated_at";

export type SalesLinkRow = {
  combo_id: string | null;
  external_product_id: string;
  id: string;
  product_id: string | null;
  provider: SalesProvider;
  updated_at: string;
};

export async function fetchSalesLinkByExternalId(db: SalesDb, provider: SalesProvider, externalProductId: string): Promise<SalesLinkRow | null> {
  const { data, error } = await db
    .from("sales_product_links")
    .select(LINK_COLUMNS)
    .eq("provider", provider)
    .eq("external_product_id", externalProductId)
    .maybeSingle();
  failOnError(error, "Produto ligado à plataforma");

  return (data ?? null) as SalesLinkRow | null;
}

export async function fetchSalesLinksFor(db: SalesDb, filter: { comboIds?: readonly string[]; productIds?: readonly string[]; provider?: SalesProvider }): Promise<SalesLinkRow[]> {
  const productIds = filter.productIds ?? [];
  const comboIds = filter.comboIds ?? [];

  if (productIds.length === 0 && comboIds.length === 0) {
    return [];
  }

  let query = db.from("sales_product_links").select(LINK_COLUMNS);

  if (filter.provider) {
    query = query.eq("provider", filter.provider);
  }

  if (productIds.length > 0 && comboIds.length > 0) {
    query = query.or(`product_id.in.(${productIds.map(quoteFilterValue).join(",")}),combo_id.in.(${comboIds.map(quoteFilterValue).join(",")})`);
  } else if (productIds.length > 0) {
    query = query.in("product_id", [...productIds]);
  } else {
    query = query.in("combo_id", [...comboIds]);
  }

  const { data, error } = await query;

  // Banco sem a migracao 202610170003: as telas do catalogo seguem sem o codigo (nada a ligar ainda).
  if (error && isMissingSchemaObjectError(error)) {
    return [];
  }

  failOnError(error, "Produtos ligados à plataforma");

  return (data ?? []) as SalesLinkRow[];
}

/** Ids do catalogo sao [A-Za-z0-9_-]; as aspas protegem o filtro `or` do PostgREST mesmo assim. */
function quoteFilterValue(value: string) {
  return `"${value.replace(/"/g, "")}"`;
}

export async function countSalesLinks(db: SalesDb, provider: SalesProvider): Promise<number> {
  const { count, error } = await db.from("sales_product_links").select("id", { count: "exact", head: true }).eq("provider", provider);
  failOnError(error, "Produtos ligados à plataforma");

  return count ?? 0;
}

/**
 * Codigo ja usado por outro produto ou pacote. Mesmo formato do erro do zod (nome "ZodError" e
 * `issues`) para a mensagem cair embaixo do campo na tela (toActionError em src/lib/action-result.ts).
 */
export class SalesLinkConflictError extends Error {
  issues: { message: string; path: string[] }[];
  status = 400 as const;

  constructor(message: string, field = "hotmartProductId") {
    super(message);
    this.name = "ZodError";
    this.issues = [{ message, path: [field] }];
  }
}

export type SalesLinkTarget = { comboId: string; productId?: undefined } | { comboId?: undefined; productId: string };

const LINK_CONFLICT_MESSAGE = "Esse código já está ligado a outro produto ou pacote. Cada código da plataforma libera um alvo só.";

/** Banco sem a tabela de ligacoes: o campo nao pode ser gravado ainda (422 com a frase da migracao). */
class SalesLinksUnavailableError extends Error {
  readonly status = 422 as const;

  constructor() {
    super(PENDING_MIGRATION_MESSAGE);
    this.name = "SalesLinksUnavailableError";
  }
}

/**
 * Antes de gravar o produto ou criar o pacote: o codigo ja esta em OUTRO alvo? Lanca o erro do campo
 * sem ter escrito nada (a linha do produto nao fica gravada com o resto do formulario, e o pacote novo
 * nao nasce sem codigo). Codigo vazio nao precisa de nada.
 */
export async function assertSalesLinkAvailable(
  db: SalesDb,
  input: SalesLinkTarget & { externalProductId: string | null | undefined; provider: SalesProvider }
) {
  const external = input.externalProductId?.trim() ?? "";

  if (!external) {
    return;
  }

  const { data, error } = await db
    .from("sales_product_links")
    .select("product_id,combo_id")
    .eq("provider", input.provider)
    .eq("external_product_id", external)
    .maybeSingle();

  if (error && isMissingSchemaObjectError(error)) {
    throw new SalesLinksUnavailableError();
  }

  failOnError(error, "Código da plataforma");

  const row = (data ?? null) as { combo_id: string | null; product_id: string | null } | null;

  if (!row) {
    return;
  }

  const sameTarget = input.productId ? row.product_id === input.productId : row.combo_id === input.comboId;

  if (!sameTarget) {
    throw new SalesLinkConflictError(LINK_CONFLICT_MESSAGE);
  }
}

/**
 * Grava o codigo da plataforma de um produto ou pacote (vazio = tira a ligacao). Codigo ja usado por
 * outro alvo vira erro do campo. Sem a tabela (banco sem a migracao), tirar nao faz nada e gravar recusa.
 */
export async function setSalesLink(
  db: SalesDb,
  input: SalesLinkTarget & { createdBy: string | null; externalProductId: string | null; provider: SalesProvider }
) {
  const targetColumn = input.productId ? "product_id" : "combo_id";
  const targetId = input.productId ?? input.comboId;
  const external = input.externalProductId?.trim() ?? "";

  if (!external) {
    const { error } = await db.from("sales_product_links").delete().eq("provider", input.provider).eq(targetColumn, targetId);

    if (error && isMissingSchemaObjectError(error)) {
      return;
    }

    failOnError(error, "Tirar o código da plataforma");

    return;
  }

  const { error } = await db
    .from("sales_product_links")
    .upsert(
      {
        combo_id: input.comboId ?? null,
        created_by: input.createdBy,
        external_product_id: external,
        product_id: input.productId ?? null,
        provider: input.provider
      },
      { onConflict: `provider,${targetColumn}` }
    );

  if (error?.code === "23505") {
    throw new SalesLinkConflictError(LINK_CONFLICT_MESSAGE);
  }

  if (error && isMissingSchemaObjectError(error)) {
    throw new SalesLinksUnavailableError();
  }

  failOnError(error, "Guardar o código da plataforma");
}
