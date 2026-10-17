import "server-only";

// Acesso ao banco de Vendas (migracao 202610170003): integration_settings, webhook_events e
// sales_product_links. Colunas explicitas e uma linha por escrita (docs/13). Sempre com a chave de
// servico, a partir do webhook (depois de conferir o token) ou de Server Actions/paginas que ja
// passaram por requireRole("settings.sales") ou "catalog.access".
//
// O segredo de cada plataforma so sai daqui por fetchIntegrationSecret, usada pelo webhook; a tela le
// fetchIntegrationRows, que nao traz a coluna.

import { toDbError } from "@/server/db/pending-migration";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import type { IntegrationStatus, SaleOutcome, WebhookProcessingStatus } from "./model";
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

/** So o webhook: o segredo para conferir o token do pedido. null = plataforma nao conectada. */
export async function fetchIntegrationSecret(db: SalesDb, provider: SalesProvider): Promise<string | null> {
  const { data, error } = await db.from("integration_settings").select("secret,secret_status").eq("provider", provider).maybeSingle();
  failOnError(error, "Segredo da plataforma de venda");

  const row = (data ?? null) as { secret: string | null; secret_status: string } | null;

  return row?.secret_status === "set" && row.secret ? row.secret : null;
}

export async function saveIntegrationSecret(
  db: SalesDb,
  input: { events: readonly string[]; provider: SalesProvider; secret: string; webhookUrl: string }
) {
  const now = new Date().toISOString();
  const { error } = await db.from("integration_settings").upsert(
    {
      events: [...input.events],
      last_error: null,
      provider: input.provider,
      secret: input.secret,
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

/** Depois de cada evento processado: hora do ultimo e situacao (erro no ultimo = precisa de atencao). */
export async function markIntegrationSync(db: SalesDb, provider: SalesProvider, result: { error: string | null }) {
  const { error } = await db
    .from("integration_settings")
    .update({
      last_error: result.error ? result.error.slice(0, 2000) : null,
      last_sync_at: new Date().toISOString(),
      status: result.error ? "needs_attention" : "configured"
    })
    .eq("provider", provider)
    .eq("secret_status", "set");

  if (error) {
    console.error(`[vendas] situacao da ${provider} nao atualizada: ${error.message}`);
  }
}

/* ------------------------------------------------------------------------------------------------
 * webhook_events
 * ---------------------------------------------------------------------------------------------- */

export const WEBHOOK_EVENT_COLUMNS =
  "id,provider,external_event_id,event_type,normalized_type,signature_valid,processing_status,outcome,outcome_detail,buyer_email,external_product_id,external_product_name,product_id,combo_id,user_id,received_at,processed_at,error_message";

export type WebhookEventRow = {
  buyer_email: string | null;
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
      processing_status: "received",
      provider: input.provider,
      signature_valid: input.signatureValid
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    return { duplicate: true, id: null };
  }

  failOnError(error, "Registrar a venda recebida");

  return { duplicate: false, id: (data as { id: string }).id };
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

/**
 * Grava o codigo da plataforma de um produto ou pacote (vazio = tira a ligacao). Codigo ja usado por
 * outro alvo vira 409 com a frase para a tela.
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
    throw new SalesLinkConflictError("Esse código já está ligado a outro produto ou pacote. Cada código da plataforma libera um alvo só.");
  }

  failOnError(error, "Guardar o código da plataforma");
}
