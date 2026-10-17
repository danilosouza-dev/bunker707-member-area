// Contrato dos adaptadores das plataformas de venda (docs/04, secao Webhooks externos). Modulo puro:
// sem "server-only", sem banco e sem React; os adaptadores (hotmart.ts) e os testes carregam direto.
//
// A plataforma e ENTRADA: o adaptador confere o pedido e traduz o payload para um evento normalizado.
// Quem decide acesso e src/server/payments/process-sale.ts, em cima de entitlements, nunca o payload.

export const SALES_PROVIDERS = ["hotmart", "ticto", "kiwify"] as const;

/** Tamanho do token que a plataforma manda (Hotmart: hottok). Menos que isso e configuracao ausente. */
export const MIN_SALES_SECRET_LENGTH = 16;
export const MAX_SALES_SECRET_LENGTH = 200;

export type SalesProvider = (typeof SALES_PROVIDERS)[number];

export function isSalesProvider(value: unknown): value is SalesProvider {
  return typeof value === "string" && (SALES_PROVIDERS as readonly string[]).includes(value);
}

/** O que um evento de venda significa para o acesso. Tudo o que nao muda acesso e `other`. */
export const NORMALIZED_SALE_TYPES = ["purchase_approved", "refund", "chargeback", "subscription_canceled", "other"] as const;

export type NormalizedSaleType = (typeof NORMALIZED_SALE_TYPES)[number];

export type SaleBuyer = {
  /** E-mail normalizado (minusculas, sem espacos) ou null quando o payload nao traz um e-mail valido. */
  email: string | null;
  name: string | null;
  phone: string | null;
};

export type NormalizedSaleEvent = {
  provider: SalesProvider;
  /** Id do evento na plataforma (idempotencia). */
  eventId: string;
  type: NormalizedSaleType;
  /** Nome do evento como a plataforma manda (ex.: PURCHASE_APPROVED), para auditoria e rotulo. */
  rawType: string;
  buyer: SaleBuyer;
  /** Codigo do produto na plataforma (texto), ligado ao produto ou pacote interno por sales_product_links. */
  externalProductId: string | null;
  externalProductName: string | null;
  /** Id da compra na plataforma (Hotmart: transaction). Estavel entre os eventos da mesma compra. */
  transactionId: string | null;
  /**
   * Codigo da assinatura na plataforma (Hotmart: subscriber.code), igual em todas as cobrancas dela e
   * no cancelamento. Cobrancas da mesma assinatura nao sustentam o acesso umas das outras.
   */
  subscriptionCode: string | null;
  /**
   * So em `purchase_approved`: true quando e um pagamento novo (reabre acesso revogado ou suspenso);
   * false quando so confirma uma compra anterior (Hotmart: fim da garantia), que entao libera apenas
   * quem nunca teve acesso registrado ao produto.
   */
  reopenClosedAccess: boolean;
  purchasedAt: string | null;
  warrantyEndsAt: string | null;
  /** Quando o evento aconteceu na plataforma. */
  occurredAt: string | null;
};

export type SaleVerification = { ok: true } | { ok: false; reason: "missing_secret" | "missing_token" | "mismatch" };

export type PaymentProviderAdapter = {
  provider: SalesProvider;
  /** Limite do corpo aceito pela rota. */
  maxPayloadBytes: number;
  /** Nomes dos eventos da plataforma que mudam acesso (para a tela dizer o que marcar la). */
  handledEvents: readonly string[];
  /**
   * Confere que o pedido veio da plataforma (token no cabecalho ou no corpo), em tempo constante, contra
   * o SHA-256 do token guardado em integration_settings (secret.ts).
   */
  verify(input: { headers: Headers; payload: unknown; secretHash: string | null | undefined }): SaleVerification;
  /** Traduz o payload; null quando nem o nome do evento da para ler. */
  normalize(payload: unknown): NormalizedSaleEvent | null;
  /**
   * O que fica guardado do payload: so a lista de campos que a regra de acesso e a tela usam (envelope,
   * produto, compra, assinatura e e-mail, nome e telefone do comprador). Token, documento, endereco,
   * comissoes e afiliados nunca sao gravados.
   */
  redact(payload: unknown): unknown;
};
