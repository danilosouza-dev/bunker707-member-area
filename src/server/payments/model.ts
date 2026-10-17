// Regras puras de Configuracoes > Vendas (docs/17 §1.10): rotulos em portugues do produtor, situacao
// de cada plataforma, mascara do e-mail do comprador, endereco do webhook e o resumo para o hub.
// Sem "server-only" e sem React: a tela e tests/vendas-hotmart.test.mjs carregam direto.

import type { NormalizedSaleType, SalesProvider } from "./types";

export const SALES_PROVIDER_LABELS: Record<SalesProvider, string> = {
  hotmart: "Hotmart",
  kiwify: "Kiwify",
  ticto: "Ticto"
};

export const INTEGRATION_STATUSES = ["not_configured", "configured", "needs_attention"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export function normalizeIntegrationStatus(value: unknown): IntegrationStatus {
  return value === "configured" || value === "needs_attention" ? value : "not_configured";
}

export type SalesStatusChip = { label: string; tone: "success" | "warning" | "neutral" | "muted" };

/**
 * Situacao escrita de cada plataforma. Plataforma sem adaptador aparece como "Em configuração" (nunca
 * "Conectada"), seja o que for que esteja gravado.
 */
export function salesProviderChip(input: { status: IntegrationStatus; supported: boolean }): SalesStatusChip {
  if (!input.supported) {
    return { label: "Em configuração", tone: "muted" };
  }

  switch (input.status) {
    case "configured":
      return { label: "Conectada", tone: "success" };
    case "needs_attention":
      return { label: "Precisa de atenção", tone: "warning" };
    default:
      return { label: "Não conectada", tone: "neutral" };
  }
}

/** Linha "Vendas" do hub de Configuracoes, a partir das situacoes das plataformas com adaptador. */
export function summarizeSalesSetup(rows: readonly { status: IntegrationStatus; supported: boolean }[]): SalesStatusChip {
  const supported = rows.filter((row) => row.supported);

  if (supported.some((row) => row.status === "needs_attention")) {
    return { label: "Precisa de atenção", tone: "warning" };
  }

  const connected = supported.filter((row) => row.status === "configured").length;

  if (connected === 0) {
    return { label: "Em configuração", tone: "muted" };
  }

  return { label: connected === 1 ? "1 plataforma conectada" : `${connected} plataformas conectadas`, tone: "success" };
}

/** Endereco que o produtor cola na plataforma: origem do site + a rota do webhook. */
export function buildSalesWebhookUrl(siteOrigin: string, provider: SalesProvider) {
  return `${siteOrigin.replace(/\/+$/, "")}/api/webhooks/${provider}`;
}

/** `c***@dominio.com`: a lista de vendas nao mostra o e-mail inteiro. */
export function maskEmail(email: string | null | undefined) {
  const value = email?.trim().toLowerCase() ?? "";
  const at = value.indexOf("@");

  if (!value) {
    return "—";
  }

  if (at <= 0) {
    return `${value.slice(0, 1)}***`;
  }

  return `${value.slice(0, 1)}***${value.slice(at)}`;
}

export const ANONYMIZED_BUYER_LABEL = "Dados apagados (12 meses)";

/** Coluna Comprador: o e-mail mascarado ou, depois da retencao de 12 meses, o aviso de que os dados sairam. */
export function buyerLabel(input: { anonymizedAt: string | null; buyerEmail: string | null }) {
  return input.anonymizedAt ? ANONYMIZED_BUYER_LABEL : maskEmail(input.buyerEmail);
}

export const SALE_TYPE_LABELS: Record<NormalizedSaleType, string> = {
  chargeback: "Chargeback",
  other: "Outro evento",
  purchase_approved: "Compra aprovada",
  refund: "Reembolso",
  subscription_canceled: "Assinatura cancelada"
};

/** Nomes dos eventos como a plataforma manda, em portugues (os que nao mudam acesso tambem). */
const RAW_EVENT_LABELS: Record<string, string> = {
  CLUB_FIRST_ACCESS: "Primeiro acesso no Club",
  CLUB_MODULE_COMPLETED: "Módulo concluído no Club",
  PURCHASE_APPROVED: "Compra aprovada",
  PURCHASE_BILLET_PRINTED: "Boleto impresso",
  PURCHASE_CANCELED: "Compra cancelada",
  PURCHASE_CHARGEBACK: "Chargeback",
  PURCHASE_COMPLETE: "Compra concluída (fim da garantia)",
  PURCHASE_DELAYED: "Pagamento atrasado",
  PURCHASE_EXPIRED: "Compra expirada",
  PURCHASE_OUT_OF_SHOPPING_CART: "Carrinho abandonado",
  PURCHASE_PROTEST: "Disputa aberta",
  PURCHASE_REFUNDED: "Reembolso",
  SUBSCRIPTION_CANCELLATION: "Assinatura cancelada",
  SWITCH_PLAN: "Troca de plano",
  UPDATE_SUBSCRIPTION_CHARGE_DATE: "Data de cobrança alterada"
};

export function saleEventLabel(rawType: string | null | undefined, normalizedType?: NormalizedSaleType | null) {
  const raw = rawType?.trim().toUpperCase() ?? "";

  if (raw && RAW_EVENT_LABELS[raw]) {
    return RAW_EVENT_LABELS[raw];
  }

  if (normalizedType && normalizedType !== "other") {
    return SALE_TYPE_LABELS[normalizedType];
  }

  return raw ? raw.toLowerCase().replace(/_/g, " ") : "Evento";
}

export const WEBHOOK_PROCESSING_STATUSES = ["received", "processed", "failed", "ignored"] as const;
export type WebhookProcessingStatus = (typeof WEBHOOK_PROCESSING_STATUSES)[number];

export const SALE_OUTCOMES = ["access_granted", "access_revoked", "access_suspended", "access_restored", "ignored", "failed"] as const;
export type SaleOutcome = (typeof SALE_OUTCOMES)[number];

export function normalizeSaleOutcome(value: unknown): SaleOutcome | null {
  return typeof value === "string" && (SALE_OUTCOMES as readonly string[]).includes(value) ? (value as SaleOutcome) : null;
}

/** Resultado em uma palavra, com o tom do chip. "Recebido" so enquanto o processamento nao terminou. */
export function saleOutcomeChip(input: { outcome: SaleOutcome | null; status: WebhookProcessingStatus }): SalesStatusChip {
  switch (input.outcome) {
    case "access_granted":
      return { label: "Acesso liberado", tone: "success" };
    case "access_revoked":
      return { label: "Acesso revogado", tone: "warning" };
    case "access_suspended":
      return { label: "Acesso suspenso", tone: "warning" };
    case "access_restored":
      return { label: "Prazo devolvido", tone: "neutral" };
    case "ignored":
      return { label: "Ignorado", tone: "muted" };
    case "failed":
      return { label: "Erro", tone: "warning" };
    default:
      return input.status === "failed" ? { label: "Erro", tone: "warning" } : { label: "Recebido", tone: "neutral" };
  }
}

/* ------------------------------------------------------------------------------------------------
 * Vinculo venda -> acesso (sale_grants): o que fazer com um acesso quando a venda e desfeita
 * ---------------------------------------------------------------------------------------------- */

export type SaleGrantLike = {
  closed_at: string | null;
  closed_by: "refund" | "chargeback" | "subscription_canceled" | "admin" | null;
  created_at: string;
  opened: boolean;
  previous_ends_at: string | null;
  subscription_code: string | null;
  transaction_id: string;
};

export type EntitlementAfterSaleDecision =
  /** Outra compra paga (outra transacao, de outra assinatura ou avulsa) ainda sustenta o acesso. */
  | { kind: "keep_sustained" }
  /** A equipe ja mexeu nesse acesso depois das vendas (revogou, suspendeu ou reabriu): fica com ela. */
  | { kind: "keep_team" }
  /** As vendas so estenderam um acesso de outra origem sem prazo: nada a desfazer. */
  | { kind: "keep_other_origin" }
  /** As vendas so estenderam um acesso de outra origem que tinha prazo: o prazo volta. */
  | { kind: "restore_deadline"; endsAt: string }
  /** Uma venda abriu o acesso e nada mais o sustenta: fecha (revoga ou suspende). */
  | { kind: "close" };

/**
 * O que fazer com UM acesso quando uma venda e desfeita (reembolso, chargeback ou cancelamento), olhando
 * o historico inteiro dos vinculos dele, e nao so o vinculo que acabou de fechar (assim a ordem dos
 * reembolsos nao muda o resultado):
 * 1. vinculos que a equipe fechou (closed_by admin) nao contam: a equipe decidiu por cima das vendas;
 * 2. se sobra vinculo aberto de OUTRA compra (outra transacao, que nao seja cobranca das assinaturas
 *    sendo desfeitas), o acesso fica;
 * 3. senao, manda o vinculo mais antigo: se ele abriu o acesso e a origem ainda e a plataforma, fecha;
 *    se so estendeu um acesso de outra origem com prazo, devolve esse prazo; se estendeu um acesso de
 *    outra origem sem prazo, fica. Cobrancas de uma assinatura nao se sustentam entre si: a renovacao
 *    reembolsada fecha o acesso que a primeira cobranca abriu, mas nunca o que a equipe deu.
 */
export function decideEntitlementAfterSale(input: {
  /** Assinaturas que o evento desfaz (codigo do evento e das transacoes desfeitas). */
  closingSubscriptionCodes: ReadonlySet<string>;
  /** Transacoes que o evento desfaz. */
  closingTransactionIds: ReadonlySet<string>;
  /** Plataforma do evento. */
  eventProvider: string;
  /** Todos os vinculos deste acesso, em qualquer situacao. */
  grants: readonly SaleGrantLike[];
  /** Origem atual do acesso (entitlements.source_provider). */
  rowSourceProvider: string;
}): EntitlementAfterSaleDecision {
  const live = input.grants.filter((grant) => grant.closed_by !== "admin");

  if (live.length === 0) {
    return input.grants.length > 0 ? { kind: "keep_team" } : { kind: "keep_other_origin" };
  }

  const isClosing = (grant: SaleGrantLike) =>
    input.closingTransactionIds.has(grant.transaction_id) ||
    (grant.subscription_code !== null && input.closingSubscriptionCodes.has(grant.subscription_code));
  const closingSubscriptions = new Set(input.closingSubscriptionCodes);

  for (const grant of live) {
    if (isClosing(grant) && grant.subscription_code !== null) {
      closingSubscriptions.add(grant.subscription_code);
    }
  }

  const sustaining = live.some(
    (grant) => !isClosing(grant) && grant.closed_at === null && (grant.subscription_code === null || !closingSubscriptions.has(grant.subscription_code))
  );

  if (sustaining) {
    return { kind: "keep_sustained" };
  }

  const oldest = [...live].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at))[0];

  if (oldest.opened) {
    return input.rowSourceProvider === input.eventProvider ? { kind: "close" } : { kind: "keep_team" };
  }

  return oldest.previous_ends_at !== null ? { endsAt: oldest.previous_ends_at, kind: "restore_deadline" } : { kind: "keep_other_origin" };
}

/** Texto de "Precisa de atencao" enquanto houver venda com erro ou presa aguardando reprocesso. */
export function pendingAttentionMessage(count: number): string | null {
  if (count <= 0) {
    return null;
  }

  return `${count === 1 ? "1 venda" : `${count} vendas`} com erro ou presa aguardando reprocesso.`;
}

/** Depois de quanto tempo um evento ainda em `received` conta como preso (a funcao estourou o tempo). */
export const STUCK_RECEIVED_MINUTES = 5;

/**
 * Reprocessar vale para o que falhou, para o que foi ignorado (ex.: produto ligado depois da venda) e
 * para o que ficou preso em `received` ha mais de STUCK_RECEIVED_MINUTES (o processamento morreu no meio).
 */
export function canReprocessSaleEvent(status: WebhookProcessingStatus, receivedAt?: string | null, now: number = Date.now()) {
  if (status === "failed" || status === "ignored") {
    return true;
  }

  if (status !== "received" || !receivedAt) {
    return false;
  }

  const received = Date.parse(receivedAt);

  return Number.isFinite(received) && now - received > STUCK_RECEIVED_MINUTES * 60_000;
}

/**
 * Aviso sobre o endereco mostrado para colar na plataforma: sem NEXT_PUBLIC_SITE_URL o endereco e o da
 * pagina aberta (pode ser uma previa); com ela, avisa quando o admin esta aberto por outro endereco.
 */
export function webhookOriginWarning(input: { configuredOrigin: string | null; requestOrigin: string | null }) {
  if (!input.configuredOrigin) {
    return "O endereço acima é o desta página, porque NEXT_PUBLIC_SITE_URL não está definida. Conecte a plataforma só pelo endereço de produção.";
  }

  if (input.requestOrigin && input.requestOrigin !== input.configuredOrigin) {
    return `Você está com o admin aberto por ${input.requestOrigin}; o endereço acima é o do site configurado e é ele que vale na plataforma.`;
  }

  return null;
}

/** Texto do rodape do cartao de cada plataforma. */
export function describeSecretState(input: { secretUpdatedAt: string | null; status: IntegrationStatus }, format: (iso: string) => string) {
  if (input.status === "not_configured" || !input.secretUpdatedAt) {
    return "Nenhum token guardado.";
  }

  return `Token guardado em ${format(input.secretUpdatedAt)}.`;
}
