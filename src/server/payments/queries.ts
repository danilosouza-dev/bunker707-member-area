import "server-only";

// Leituras de Configuracoes > Vendas e da linha "Vendas" do hub. Quem chama ja passou por
// requirePageRole("settings.sales"). Nada aqui devolve o token: so a situacao e a data em que foi salvo.

import { getConfiguredSiteOrigin, getHeadersOrigin } from "@/server/auth/site-origin";
import { isSalesProviderSupported, getPaymentAdapter } from "./adapters";
import {
  buildSalesWebhookUrl,
  buyerLabel,
  canReprocessSaleEvent,
  normalizeIntegrationStatus,
  normalizeSaleOutcome,
  SALES_PROVIDER_LABELS,
  webhookOriginWarning,
  type IntegrationStatus,
  type SaleOutcome,
  type WebhookProcessingStatus
} from "./model";
import { countSalesLinks, fetchIntegrationRows, listWebhookEvents, markIntegrationAttention, salesDb, type IntegrationRow, type WebhookEventRow } from "./store";
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
  /** Depois da retencao de 12 meses: sem e-mail, sem payload e sem Reprocessar. */
  anonymizedAt: string | null;
  /** E-mail do comprador ja mascarado no servidor (`c***@dominio`): o inteiro nunca vai para o navegador. Depois da retencao, "Dados apagados (12 meses)". */
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

/**
 * Situacao de cada plataforma como esta AGORA: uma venda que ficou presa em `received` (a funcao morreu
 * depois de gravar) nao gera evento nenhum, entao a linha de integration_settings so saberia dela no
 * proximo webhook. A tela conta ao vivo e grava "Precisa de atencao" na linha quando for o caso.
 */
async function refreshAttention(rows: IntegrationRow[]): Promise<IntegrationRow[]> {
  const db = salesDb();

  return Promise.all(
    rows.map(async (row) => {
      if (!isSalesProviderSupported(row.provider) || row.secret_status !== "set") {
        return row;
      }

      const refreshed = await markIntegrationAttention(db, row.provider, row).catch((error: unknown) => {
        console.error(`[vendas] situacao da ${row.provider} nao conferida: ${error instanceof Error ? error.message : String(error)}`);

        return null;
      });

      return refreshed ?? row;
    })
  );
}

async function loadProviderCards(origin: { configured: string | null; request: string }, storedRows: IntegrationRow[]): Promise<SalesProviderCard[]> {
  const db = salesDb();
  const webhookOrigin = origin.configured ?? origin.request;
  const originWarning = webhookOriginWarning({ configuredOrigin: origin.configured, requestOrigin: origin.request });
  const [rows, linkCounts] = await Promise.all([
    refreshAttention(storedRows),
    Promise.all(SALES_PROVIDERS.map((provider) => (isSalesProviderSupported(provider) ? countSalesLinks(db, provider) : Promise.resolve(0))))
  ]);

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
    anonymizedAt: row.anonymized_at,
    buyerEmailMasked: buyerLabel({ anonymizedAt: row.anonymized_at, buyerEmail: row.buyer_email }),
    // Venda anonimizada pela retencao nao tem payload para reler.
    canReprocess: row.anonymized_at === null && canReprocessSaleEvent(row.processing_status, row.received_at, now),
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
  const rows = await refreshAttention(await fetchIntegrationRows(salesDb()));

  return SALES_PROVIDERS.map((provider) => {
    const supported = isSalesProviderSupported(provider);
    const row = rows.find((candidate) => candidate.provider === provider);

    return { status: supported ? normalizeIntegrationStatus(row?.status) : "not_configured", supported };
  });
}
