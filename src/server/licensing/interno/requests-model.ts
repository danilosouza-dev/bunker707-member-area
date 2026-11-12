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

/**
 * pendente: na fila (com a hora da proxima tentativa); enviando: reivindicada por uma rodada; enviado: o Emissor aceitou;
 * dispensado: nao precisa mais ir (a venda desfeita antes de chegar ao Emissor, ou a equipe dispensou); parado: o Emissor
 * recusou de um jeito que tentar de novo nao resolve (precisa da equipe; "Tentar agora" devolve a fila).
 */
export const LICENSE_REQUEST_STATUSES = ["pendente", "enviando", "enviado", "dispensado", "parado"] as const;
export type LicenseRequestStatus = (typeof LICENSE_REQUEST_STATUSES)[number];

/** As colunas da 202611130001 (a lista que o adaptador le; a guarda confere contra o arquivo da migracao). */
export const LICENSE_REQUEST_COLUMNS =
  "id,request_key,kind,provider,transaction_id,external_product_id,subscription_code,reason,user_id,webhook_event_id,purchased_at,warranty_ends_at,occurred_at,status,attempts,next_attempt_at,claimed_at,maybe_delivered,last_error_code,last_error,sent_at,resolution";

export type LicenseRequestRow = {
  attempts: number;
  /** So na lista da equipe (lida a mais): quando o pedido entrou na fila. */
  created_at?: string;
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

/** Pedidos por rodada do tick: cada um pode levar ate o tempo limite do cliente, dentro do orcamento do tick. */
export const MAX_LICENSE_REQUESTS_PER_RUN = 10;

/**
 * As recusas que tentar de novo nao resolve (docs/api-interna.md, "Erros": "guardar e avisar a equipe", "parar e avisar a
 * equipe", "pedir a escolha"): o pedido fica parado, com a frase na lista, ate a equipe resolver no Painel de licencas e
 * usar "Tentar agora" ou "Dispensar". sem_conta e nosso: a conta do comprador sumiu.
 */
export const NEEDS_TEAM_ERRORS = new Set<string>([
  "pedido_invalido",
  "pedido_grande_demais",
  "tipo_de_conteudo",
  "quantidade_invalida",
  "venda_de_outro_cliente",
  "validade_acima_do_limite",
  "licenca_ambigua",
  "sem_conta"
]);

/**
 * As falhas do Emissor inteiro (fora do ar, lento, limite de pedidos, credencial ou endereco errados): a rodada para ali,
 * para nao gastar o tempo do tick com tempos esgotados nem somar credencial errada (o Emissor bloqueia o IP depois de 20).
 */
export const STOPS_ROUND_ERRORS = new Set<string>([
  "sem_resposta",
  "indisponivel",
  "erro_interno",
  "limite_de_pedidos",
  "credencial_invalida",
  "nao_encontrado",
  "metodo_nao_permitido",
  "resposta_invalida",
  "nao_configurado",
  "erro_inesperado"
]);

/** Com a credencial recusada, a proxima tentativa espera pelo menos isso (a janela do bloqueio do Emissor e de 10 min). */
const CREDENTIAL_RETRY_MS = 30 * 60_000;

export function licenseRetryDelayMs(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), LICENSE_RETRY_DELAYS_MS.length) - 1;
  return LICENSE_RETRY_DELAYS_MS[index];
}

/**
 * A recusa provou que o Emissor nao gravou nada? Sem resposta, resposta fora do formato e erro dele deixam a duvida. A
 * conta que sumiu (sem_conta) nem chegou a sair daqui.
 */
export function refusedWithoutRecording(errorCode: string): boolean {
  return errorCode === "sem_conta" || REFUSED_WITHOUT_RECORDING.has(errorCode);
}

export type AttemptResult = { ok: true; resolution: string } | { ok: false; error: string; message: string | null; retryAfterSeconds?: number };

type AttemptFailurePatch = {
  attempts: number;
  claimed_at: null;
  last_error_code: string;
  last_error: string;
  maybe_delivered: boolean;
};

export type AttemptPatch =
  | { status: "enviado"; attempts: number; sent_at: string; claimed_at: null; resolution: string; last_error_code: null; last_error: null; maybe_delivered: boolean }
  | (AttemptFailurePatch & { status: "pendente"; next_attempt_at: string })
  | (AttemptFailurePatch & { status: "parado" });

/**
 * O que gravar depois de uma tentativa. Sucesso: enviado. Recusa que precisa da equipe: parado. Outra falha: volta para a
 * fila com a espera da tentativa (ou a que o Emissor pediu, no limite de pedidos; meia hora, com a credencial recusada), o
 * codigo e a frase do erro: o produto que o Emissor nao conhece fica tentando ate o produtor cadastrar o codigo la.
 * `maybe_delivered` so liga: depois de uma resposta em duvida, o desfazer nunca dispensa esta venda sem avisar o Emissor.
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

  const failure: AttemptFailurePatch = {
    attempts,
    claimed_at: null,
    last_error: licenseRequestErrorText(result.error, result.message).slice(0, 500),
    last_error_code: result.error,
    maybe_delivered: row.maybe_delivered || !refusedWithoutRecording(result.error)
  };

  if (NEEDS_TEAM_ERRORS.has(result.error)) {
    return { ...failure, status: "parado" };
  }

  const askedWait = result.retryAfterSeconds ? result.retryAfterSeconds * 1000 : 0;
  const waitMs =
    result.error === "credencial_invalida"
      ? CREDENTIAL_RETRY_MS
      : result.error === "limite_de_pedidos"
        ? Math.max(askedWait, 60_000)
        : Math.max(licenseRetryDelayMs(attempts), askedWait);

  return { ...failure, next_attempt_at: new Date(now.getTime() + Math.min(waitMs, 6 * 60 * 60_000)).toISOString(), status: "pendente" };
}

/**
 * O desfazer que chega para uma venda da fila:
 * - sem venda (nunca pedida aqui), ou a venda ja dispensada: nada a desfazer;
 * - a venda que nunca pode ter chegado ao Emissor (na fila ou parada, sem nenhuma resposta em duvida): as duas saem como
 *   dispensadas, e nada vai ao Emissor;
 * - senao (a venda enviada, sendo enviada, ou com uma resposta em duvida): o desfazer entra na fila. Ele nao espera a
 *   venda: o Emissor guarda a marca do desfazer que chega antes e nunca aplica a venda depois (docs/api-interna.md §2), e
 *   a venda que ficou na fila sai dispensada quando o desfazer e aceito.
 */
export function undoPlanFor(sale: Pick<LicenseRequestRow, "status" | "maybe_delivered"> | null): "sem_venda" | "dispensar" | "enfileirar" {
  if (!sale || sale.status === "dispensado") {
    return "sem_venda";
  }

  if ((sale.status === "pendente" || sale.status === "parado") && !sale.maybe_delivered) {
    return "dispensar";
  }

  return "enfileirar";
}

export const LICENSE_REQUEST_STATUS_LABELS: Record<LicenseRequestStatus, string> = {
  dispensado: "Dispensado",
  enviado: "Enviado",
  enviando: "Enviando",
  parado: "Parado",
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
      return "O Emissor não conhece este código de produto. Cadastre o código no Painel de licenças (Planos); o pedido é reenviado sozinho.";
    case "sem_licenca_para_aplicar":
      return "O comprador não tem uma Licença em que esta compra sirva (Ano adicional, troca ou módulo). O pedido é reenviado sozinho; o Painel de licenças avisou o produtor.";
    case "licenca_ambigua":
      return "O comprador tem mais de uma Licença em que esta compra serve. Aplique pelo Painel de licenças (Aplicar compra) e use Dispensar aqui.";
    case "quantidade_invalida":
      return "A venda trouxe mais de uma unidade de um produto que não é Licença. Resolva pelo Painel de licenças e use Dispensar aqui.";
    case "validade_acima_do_limite":
      return "O Ano adicional passaria a validade de 36 meses à frente. Devolva o valor ao comprador e use Dispensar aqui.";
    case "venda_de_outro_cliente":
      return "Esta venda já foi aplicada numa Licença de outro cliente no Emissor. Confira no Painel de licenças.";
    case "licenca_nao_encontrada":
    case "cliente_desconhecido":
      return "O Emissor não achou a Licença ou o cliente deste pedido.";
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
    case "nao_encontrado":
    case "metodo_nao_permitido":
      return "O endereço da API interna do Emissor não respondeu como esperado. Confira EMISSOR_INTERNO_URL no servidor.";
    default:
      return emissorMessage ? `O Emissor recusou (${code}): ${emissorMessage}` : `O Emissor recusou (${code}).`;
  }
}

export const DISMISSED_SALE_RESOLUTION = "Desfeita antes de chegar ao Emissor: nada foi enviado.";
export const DISMISSED_UNDO_RESOLUTION = "A venda não chegou ao Emissor: nada a desfazer.";
export const UNDONE_SALE_RESOLUTION = "Desfeita: o Emissor recebeu o desfazer desta venda.";
export const TEAM_DISMISSED_RESOLUTION = "Dispensado pela equipe.";
