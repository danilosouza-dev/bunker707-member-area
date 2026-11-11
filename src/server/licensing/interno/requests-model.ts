// As regras puras da fila dos pedidos ao Emissor (docs/32 §11.10; migracao 202611130001, tabela license_requests): a
// chave de cada pedido, o que a venda e o desfazer enfileiram, a ordem, a espera entre tentativas, quando o desfazer pode
// dispensar a venda que nunca chegou ao Emissor e as frases da lista em Configuracoes > Vendas.
//
// Modulo puro (sem "server-only", sem banco): os testes carregam direto; requests-store.ts e requests-tick.ts aplicam.

import { REFUSED_WITHOUT_RECORDING, type UndoReason } from "./contract";

/** A migracao que traz license_products e license_requests. */
export const LICENSE_SALES_MIGRATION = "202611130001";

export const LICENSE_REQUEST_KINDS = ["venda", "desfazer"] as const;
export type LicenseRequestKind = (typeof LICENSE_REQUEST_KINDS)[number];

export const LICENSE_REQUEST_STATUSES = ["pendente", "enviando", "enviado", "dispensado"] as const;
export type LicenseRequestStatus = (typeof LICENSE_REQUEST_STATUSES)[number];

/** As colunas da 202611130001 (a lista que o adaptador le; a guarda confere contra o arquivo da migracao). */
export const LICENSE_REQUEST_COLUMNS =
  "id,request_key,kind,provider,transaction_id,external_product_id,subscription_code,reason,user_id,webhook_event_id,purchased_at,warranty_ends_at,occurred_at,status,attempts,next_attempt_at,claimed_at,maybe_delivered,last_error_code,last_error,sent_at,resolution";

export type LicenseRequestRow = {
  attempts: number;
  claimed_at: string | null;
  external_product_id: string;
  id: string;
  kind: LicenseRequestKind;
  last_error: string | null;
  last_error_code: string | null;
  maybe_delivered: boolean;
  next_attempt_at: string;
  occurred_at: string | null;
  provider: "hotmart" | "ticto" | "kiwify";
  purchased_at: string | null;
  reason: UndoReason | null;
  request_key: string;
  resolution: string | null;
  sent_at: string | null;
  status: LicenseRequestStatus;
  subscription_code: string | null;
  transaction_id: string;
  user_id: string | null;
  warranty_ends_at: string | null;
  webhook_event_id: string | null;
};

type SaleKeyParts = { provider: string; transactionId: string; productCode: string };

/** A chave da venda: a mesma venda (plataforma, transacao e codigo do produto) nunca entra duas vezes. */
export function saleRequestKey(parts: SaleKeyParts): string {
  return `venda:${parts.provider}:${parts.transactionId}:${parts.productCode}`;
}

/** A chave do desfazer: um por motivo (o reembolso e, depois, o chargeback da mesma venda sao dois pedidos). */
export function undoRequestKey(parts: SaleKeyParts & { reason: UndoReason }): string {
  return `desfazer:${parts.reason}:${parts.provider}:${parts.transactionId}:${parts.productCode}`;
}

/** O motivo do contrato para o tipo do evento normalizado. */
export const UNDO_REASON_OF_SALE_TYPE = Object.freeze({
  chargeback: "chargeback",
  refund: "reembolso",
  subscription_canceled: "cancelamento"
} satisfies Record<string, UndoReason>);

/** Espera antes de cada nova tentativa, pela tentativa que acabou de falhar; da quinta em diante, de 6 em 6 horas. */
export const LICENSE_RETRY_DELAYS_MS: readonly number[] = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

/** Linha em "enviando" ha mais tempo que isso ficou orfa (a rodada morreu no meio): outra rodada a retoma. */
export const STALE_LICENSE_CLAIM_MS = 5 * 60_000;

/** Pedidos por rodada do tick: cada um pode levar ate o tempo limite do cliente. */
export const MAX_LICENSE_REQUESTS_PER_RUN = 10;

export function licenseRetryDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), LICENSE_RETRY_DELAYS_MS.length) - 1;
  return LICENSE_RETRY_DELAYS_MS[index];
}

/** A recusa provou que o Emissor nao gravou nada? Sem resposta, resposta fora do formato e erro dele deixam a duvida. */
export function refusedWithoutRecording(errorCode: string): boolean {
  return REFUSED_WITHOUT_RECORDING.has(errorCode);
}

export type AttemptResult = { ok: true; resolution: string } | { ok: false; error: string; message: string | null; retryAfterSeconds?: number };

export type AttemptPatch =
  | { status: "enviado"; attempts: number; sent_at: string; claimed_at: null; resolution: string; last_error_code: null; last_error: null; maybe_delivered: boolean }
  | {
      status: "pendente";
      attempts: number;
      claimed_at: null;
      next_attempt_at: string;
      last_error_code: string;
      last_error: string;
      maybe_delivered: boolean;
    };

/**
 * O que gravar depois de uma tentativa. Sucesso: enviado. Falha: volta para a fila com a espera da tentativa (ou a que o
 * Emissor pediu, no limite de pedidos), o codigo e a frase do erro. Nunca desiste: o produto desconhecido fica tentando
 * ate o produtor cadastrar o codigo no Emissor (a lista mostra o erro). `maybe_delivered` so liga: depois de uma resposta
 * em duvida, o desfazer nunca dispensa esta venda.
 */
export function planAfterLicenseAttempt(row: Pick<LicenseRequestRow, "attempts" | "maybe_delivered">, result: AttemptResult, now: Date): AttemptPatch {
  const attempts = row.attempts + 1;

  if (result.ok) {
    return {
      attempts,
      claimed_at: null,
      last_error: null,
      last_error_code: null,
      maybe_delivered: true,
      resolution: result.resolution.slice(0, 500),
      sent_at: now.toISOString(),
      status: "enviado"
    };
  }

  const waitMs = result.error === "limite_de_pedidos" && result.retryAfterSeconds ? Math.max(result.retryAfterSeconds * 1000, 60_000) : licenseRetryDelayMs(attempts);

  return {
    attempts,
    claimed_at: null,
    last_error: licenseRequestErrorText(result.error, result.message).slice(0, 500),
    last_error_code: result.error,
    maybe_delivered: row.maybe_delivered || !refusedWithoutRecording(result.error),
    next_attempt_at: new Date(now.getTime() + Math.min(waitMs, 6 * 60 * 60_000)).toISOString(),
    status: "pendente"
  };
}

/**
 * O desfazer que chega para uma venda da fila:
 * - sem venda (nunca pedida aqui), ou a venda ja dispensada: nada a desfazer;
 * - a venda ainda na fila e que nunca pode ter chegado ao Emissor (nenhuma tentativa, ou so recusas que provam que ele
 *   nao gravou): as duas saem como dispensadas, e nada vai ao Emissor;
 * - senao (a venda enviada, sendo enviada, ou com uma resposta em duvida): o desfazer entra na fila e sai depois dela.
 */
export function undoPlanFor(sale: Pick<LicenseRequestRow, "status" | "maybe_delivered"> | null): "sem_venda" | "dispensar" | "enfileirar" {
  if (!sale || sale.status === "dispensado") {
    return "sem_venda";
  }

  if (sale.status === "pendente" && !sale.maybe_delivered) {
    return "dispensar";
  }

  return "enfileirar";
}

/** O desfazer espera enquanto a venda dele nao saiu (a ordem: o Emissor nunca recebe o desfazer antes da venda). */
export function undoMustWait(sale: Pick<LicenseRequestRow, "status"> | null): boolean {
  return sale !== null && (sale.status === "pendente" || sale.status === "enviando");
}

export const LICENSE_REQUEST_STATUS_LABELS: Record<LicenseRequestStatus, string> = {
  dispensado: "Dispensado",
  enviado: "Enviado",
  enviando: "Enviando",
  pendente: "Na fila"
};

export const UNDO_REASON_LABELS: Record<UndoReason, string> = {
  cancelamento: "cancelamento",
  chargeback: "chargeback",
  reembolso: "reembolso"
};

/** A frase da equipe para o erro de uma tentativa (a lista de Configuracoes > Vendas). */
export function licenseRequestErrorText(code: string, emissorMessage: string | null = null): string {
  switch (code) {
    case "produto_desconhecido":
      return "O Emissor não conhece este código de produto. Cadastre o código no Painel de licenças; o pedido é reenviado sozinho.";
    case "sem_resposta":
      return "O Emissor não respondeu. O pedido é reenviado sozinho.";
    case "indisponivel":
    case "erro_interno":
      return "O Emissor está com problema agora. O pedido é reenviado sozinho.";
    case "credencial_invalida":
      return "O Emissor recusou a credencial desta escola. Confira EMISSOR_INTERNO_CREDENCIAL no servidor.";
    case "limite_de_pedidos":
      return "Pedidos demais ao Emissor ao mesmo tempo. O pedido é reenviado em instantes.";
    case "resposta_invalida":
      return "O Emissor respondeu fora do formato combinado. O pedido é reenviado sozinho.";
    case "pedido_invalido":
      return `O Emissor recusou o pedido como inválido${emissorMessage ? `: ${emissorMessage}` : "."}`;
    case "sem_conta":
      return "A conta do comprador não existe mais nesta escola. O pedido fica parado até a equipe resolver.";
    case "nao_configurado":
      return "A API interna do Emissor não está configurada neste servidor.";
    default:
      return emissorMessage ? `O Emissor recusou (${code}): ${emissorMessage}` : `O Emissor recusou (${code}).`;
  }
}

export const DISMISSED_SALE_RESOLUTION = "Desfeita antes de chegar ao Emissor: nada foi enviado.";
export const DISMISSED_UNDO_RESOLUTION = "A venda não chegou ao Emissor: nada a desfazer.";
