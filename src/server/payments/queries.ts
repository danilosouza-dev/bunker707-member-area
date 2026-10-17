import "server-only";

// Leituras de Configuracoes > Vendas e da linha "Vendas" do hub. Quem chama ja passou por
// requirePageRole("settings.sales"). Nada aqui devolve o token: so a situacao e a data em que foi salvo.

import { getConfiguredSiteOrigin, getHeadersOrigin } from "@/server/auth/site-origin";
import { isSalesProviderSupported, getPaymentAdapter } from "./adapters";
import {
  buildSalesWebhookUrl,
  canReprocessSaleEvent,
  maskEmail,
  normalizeIntegrationStatus,
  normalizeSaleOutcome,
  SALES_PROVIDER_LABELS,
  webhookOriginWarning,
  type IntegrationStatus,
  type SaleOutcome,
  type WebhookProcessingStatus
} from "./model";
import { countSalesLinks, fetchIntegrationRows, listWebhookEvents, salesDb, type IntegrationRow, type WebhookEventRow } from "./store";
import { SALES_PROVIDERS, type NormalizedSaleType, type SalesProvider } from "./types";

export type SalesProviderCard = {
  /** Eventos da plataforma que mudam acesso (para o produtor marcar la). */
  events: string[];
  label: string;
  lastError: string | null;
  lastSyncAt: string | null;
  /** Produtos e pacotes com codigo desta plataforma. */
  linkedTargets: number;
  /** Aviso sobre o endereco mostrado (sem NEXT_PUBLIC_SITE_URL, ou admin aberto por outro endereco). */
  originWarning: string | null;
  provider: SalesProvider;
  secretUpdatedAt: string | null;
  status: IntegrationStatus;
  /** Ja recebe vendas de verdade (tem adaptador). */
  supported: boolean;
  webhookUrl: string;
};

export type SalesEventListItem = {
  /** E-mail do comprador ja mascarado no servidor (`c***@dominio`): o inteiro nunca vai para o navegador. */
  buyerEmailMasked: string;
  canReprocess: boolean;
  detail: string | null;
  errorMessage: string | null;
  eventType: string;
  externalProductId: string | null;
  id: string;
  normalizedType: NormalizedSaleType | null;
  outcome: SaleOutcome | null;
  processingStatus: WebhookProcessingStatus;
  /** Nome do produto ou pacote da escola; sem ligacao, o nome que veio da plataforma. */
  productTitle: string | null;
  provider: SalesProvider;
  receivedAt: string;
  /** Aluno resolvido (link para o perfil). */
  userId: string | null;
};

export type SalesSettingsData = {
  events: SalesEventListItem[];
  providers: SalesProviderCard[];
};

const RECENT_EVENTS_LIMIT = 50;

function eventsOf(row: IntegrationRow | undefined, provider: SalesProvider) {
  const adapter = getPaymentAdapter(provider);
  const stored = Array.isArray(row?.events) ? (row.events as unknown[]).filter((item): item is string => typeof item === "string") : [];

  return stored.length > 0 ? stored : [...(adapter?.handledEvents ?? [])];
}

async function loadProviderCards(origin: { configured: string | null; request: string }, rows: IntegrationRow[]): Promise<SalesProviderCard[]> {
  const db = salesDb();
  const webhookOrigin = origin.configured ?? origin.request;
  const originWarning = webhookOriginWarning({ configuredOrigin: origin.configured, requestOrigin: origin.request });
  const linkCounts = await Promise.all(
    SALES_PROVIDERS.map((provider) => (isSalesProviderSupported(provider) ? countSalesLinks(db, provider) : Promise.resolve(0)))
  );

  return SALES_PROVIDERS.map((provider, index): SalesProviderCard => {
    const row = rows.find((candidate) => candidate.provider === provider);
    const supported = isSalesProviderSupported(provider);

    return {
      events: eventsOf(row, provider),
      label: SALES_PROVIDER_LABELS[provider],
      lastError: row?.last_error ?? null,
      lastSyncAt: row?.last_sync_at ?? null,
      linkedTargets: linkCounts[index],
      originWarning: supported ? originWarning : null,
      provider,
      secretUpdatedAt: row?.secret_updated_at ?? null,
      status: supported ? normalizeIntegrationStatus(row?.status) : "not_configured",
      supported,
      webhookUrl: buildSalesWebhookUrl(webhookOrigin, provider)
    };
  });
}

async function loadTitles(rows: WebhookEventRow[]) {
  const db = salesDb();
  const productIds = Array.from(new Set(rows.map((row) => row.product_id).filter((id): id is string => Boolean(id))));
  const comboIds = Array.from(new Set(rows.map((row) => row.combo_id).filter((id): id is string => Boolean(id))));
  const [products, combos] = await Promise.all([
    productIds.length > 0 ? db.from("content_items").select("id,title").in("id", productIds) : Promise.resolve({ data: [], error: null }),
    comboIds.length > 0 ? db.from("product_combos").select("id,name").in("id", comboIds) : Promise.resolve({ data: [], error: null })
  ]);

  if (products.error) {
    console.error(`[vendas] titulos dos produtos: ${products.error.message}`);
  }

  if (combos.error) {
    console.error(`[vendas] nomes dos pacotes: ${combos.error.message}`);
  }

  return {
    combos: new Map(((combos.data ?? []) as { id: string; name: string }[]).map((row) => [row.id, row.name])),
    products: new Map(((products.data ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]))
  };
}

export function toSalesEventListItem(
  row: WebhookEventRow,
  titles: { combos: Map<string, string>; products: Map<string, string> },
  now: number = Date.now()
): SalesEventListItem {
  const productTitle =
    (row.combo_id ? titles.combos.get(row.combo_id) : null) ??
    (row.product_id ? titles.products.get(row.product_id) : null) ??
    row.external_product_name ??
    null;

  return {
    buyerEmailMasked: maskEmail(row.buyer_email),
    canReprocess: canReprocessSaleEvent(row.processing_status, row.received_at, now),
    detail: row.outcome_detail,
    errorMessage: row.error_message,
    eventType: row.event_type,
    externalProductId: row.external_product_id,
    id: row.id,
    normalizedType: row.normalized_type,
    outcome: normalizeSaleOutcome(row.outcome),
    processingStatus: row.processing_status,
    productTitle,
    provider: row.provider,
    receivedAt: row.received_at,
    userId: row.user_id
  };
}

export async function getSalesSettingsData(): Promise<SalesSettingsData> {
  const db = salesDb();
  const [requestOrigin, rows, eventRows] = await Promise.all([getHeadersOrigin(), fetchIntegrationRows(db), listWebhookEvents(db, { limit: RECENT_EVENTS_LIMIT })]);
  const [providers, titles] = await Promise.all([loadProviderCards({ configured: getConfiguredSiteOrigin(), request: requestOrigin }, rows), loadTitles(eventRows)]);
  const now = Date.now();

  return { events: eventRows.map((row) => toSalesEventListItem(row, titles, now)), providers };
}

/** Situacao das plataformas para a linha "Vendas" do hub (sem o token, sem a lista). */
export async function getSalesProviderStatuses(): Promise<{ status: IntegrationStatus; supported: boolean }[]> {
  const rows = await fetchIntegrationRows(salesDb());

  return SALES_PROVIDERS.map((provider) => {
    const supported = isSalesProviderSupported(provider);
    const row = rows.find((candidate) => candidate.provider === provider);

    return { status: supported ? normalizeIntegrationStatus(row?.status) : "not_configured", supported };
  });
}
