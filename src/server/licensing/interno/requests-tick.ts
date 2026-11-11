import "server-only";

// A rodada da tarefa do tick `licencas-vendas` (docs/32 §11.10): envia ao Emissor os pedidos da fila license_requests, com
// reivindicacao por linha (duas rodadas nunca enviam o mesmo pedido juntas) e novas tentativas com espera crescente
// (requests-model.ts). O que tentar de novo nao resolve fica parado, com a frase na lista de Configuracoes > Vendas; o
// produto que o Emissor ainda nao conhece fica tentando ate o produtor cadastrar o codigo la.
// - a venda vai com a conta do comprador, lida agora (o e-mail e o nome nunca ficam na fila);
// - o desfazer nao espera a venda: o Emissor guarda a marca e nunca aplica a venda que chegar depois. Aceito o desfazer, a
//   venda que ainda estava na fila sai dispensada;
// - o X-Pedido de cada pedido e o id da linha: o mesmo entre as tentativas (a auditoria do Emissor junta as tentativas);
// - a falha do Emissor inteiro (fora do ar, lento, limite, credencial) para a rodada ali: o resto espera a proxima.
// Os logs da tarefa levam so contagens e codigos.

import {
  saleRequestSchema,
  undoRequestSchema,
  type InternalEmissorClient,
  type InternalResult,
  type SaleReceipt,
  type UndoReceipt
} from "./contract";
import {
  MAX_LICENSE_REQUESTS_PER_RUN,
  STOPS_ROUND_ERRORS,
  UNDO_REASON_LABELS,
  planAfterLicenseAttempt,
  type AttemptResult,
  type LicenseRequestRow
} from "./requests-model";
import {
  claimLicenseRequest,
  dismissSaleUndoneByEmissor,
  fetchBuyerOf,
  finishLicenseRequest,
  listDueLicenseRequests,
  type LicenseSalesDb
} from "./requests-store";

export type LicenseRequestsRoundResult = {
  sent: number;
  failed: number;
  /** Pedidos parados nesta rodada (precisam da equipe). */
  stopped: number;
  contended: number;
  /** A rodada parou numa falha do Emissor inteiro. */
  interrupted: boolean;
  /** Os codigos das falhas desta rodada (para o log; nunca dados do comprador). */
  errors: string[];
};

function idsOf(receipt: { licencas: { id: string }[] }): string {
  const ids = receipt.licencas.map((license) => license.id);
  return ids.length > 0 ? ` (${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", ..." : ""})` : "";
}

function saleResolution(receipt: SaleReceipt): string {
  if (!receipt.aplicada) {
    return "O desfazer desta venda chegou antes ao Emissor: ela não foi aplicada.";
  }

  return `${receipt.repetida ? "Já estava aplicada no Emissor" : "Aplicada no Emissor"}${idsOf(receipt)}.`;
}

function undoResolution(receipt: UndoReceipt, reason: LicenseRequestRow["reason"]): string {
  const label = reason ? UNDO_REASON_LABELS[reason] : "desfazer";

  if (!receipt.vendaConhecida) {
    return `O Emissor ainda não tinha esta venda: guardou o ${label} e nunca vai aplicá-la.`;
  }

  return `Desfeita no Emissor (${label})${idsOf(receipt)}.`;
}

function asAttempt<T>(result: InternalResult<T>, resolution: (data: T) => string): AttemptResult {
  return result.ok
    ? { ok: true, resolution: resolution(result.data) }
    : { error: result.error, message: result.message, ok: false, ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds }) };
}

/** O nome do comprador para o Emissor (obrigatorio, ate 160): o do perfil, ou o comeco do e-mail, como a conta nasce. */
function buyerNameOf(buyer: { email: string; name: string | null }): string {
  const name = buyer.name?.replace(/\s+/g, " ").trim().slice(0, 160).trim();
  return name || buyer.email.split("@")[0] || "Comprador";
}

/** A data no formato do contrato (o banco devolve "...+00:00"; o Emissor aceita ISO com fuso). */
function isoOf(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Envia um pedido ja reivindicado. Devolve o resultado da tentativa (o que vai para a linha). */
async function sendRequest(
  db: LicenseSalesDb,
  client: InternalEmissorClient,
  row: LicenseRequestRow,
  signal: AbortSignal | undefined,
  now: Date
): Promise<AttemptResult> {
  const call = { requestId: row.id, ...(signal ? { signal } : {}) };

  if (row.kind === "venda") {
    const buyer = row.user_id ? await fetchBuyerOf(db, row.user_id) : null;

    if (!row.user_id || !buyer) {
      return { error: "sem_conta", message: null, ok: false };
    }

    const boughtAt = isoOf(row.purchased_at) ?? now.toISOString();
    const warranty = isoOf(row.warranty_ends_at);
    const body = saleRequestSchema.safeParse({
      comprador: { areaUserId: row.user_id, email: buyer.email, nome: buyerNameOf(buyer) },
      compradoEm: boughtAt,
      // O fim da garantia nunca antes da compra (o contrato recusa); sem ele, o Emissor conta 7 dias.
      garantiaAte: warranty && Date.parse(warranty) >= Date.parse(boughtAt) ? warranty : null,
      plataforma: row.provider,
      produto: row.external_product_id,
      transacao: row.transaction_id
    });

    if (!body.success) {
      return { error: "pedido_invalido", message: "os dados desta venda não seguem o contrato da API interna", ok: false };
    }

    return asAttempt(await client.registerSale(body.data, call), saleResolution);
  }

  const body = undoRequestSchema.safeParse({
    em: isoOf(row.occurred_at) ?? now.toISOString(),
    motivo: row.reason,
    plataforma: row.provider,
    produto: row.external_product_id,
    transacao: row.transaction_id
  });

  if (!body.success) {
    return { error: "pedido_invalido", message: "os dados deste desfazer não seguem o contrato da API interna", ok: false };
  }

  return asAttempt(await client.undoSale(body.data, call), (receipt) => undoResolution(receipt, row.reason));
}

export async function runLicenseRequestsRound(input: {
  client: InternalEmissorClient;
  db: LicenseSalesDb;
  now?: () => Date;
  signal?: AbortSignal;
  limit?: number;
}): Promise<LicenseRequestsRoundResult> {
  const now = input.now ?? (() => new Date());
  const result: LicenseRequestsRoundResult = { contended: 0, errors: [], failed: 0, interrupted: false, sent: 0, stopped: 0 };
  const due = await listDueLicenseRequests(input.db, { limit: input.limit ?? MAX_LICENSE_REQUESTS_PER_RUN, now: now() });

  for (const row of due) {
    if (input.signal?.aborted) {
      break;
    }

    const claimedAt = await claimLicenseRequest(input.db, row, now());

    if (!claimedAt) {
      result.contended += 1;
      continue;
    }

    const attempt = await sendRequest(input.db, input.client, row, input.signal, now());
    const patch = planAfterLicenseAttempt(row, attempt, now());
    await finishLicenseRequest(input.db, { claimedAt, id: row.id, patch });

    if (attempt.ok) {
      result.sent += 1;

      if (row.kind === "desfazer") {
        await dismissSaleUndoneByEmissor(input.db, row);
      }

      continue;
    }

    result.errors.push(attempt.error);

    if (patch.status === "parado") {
      result.stopped += 1;
    } else {
      result.failed += 1;
    }

    if (STOPS_ROUND_ERRORS.has(attempt.error)) {
      result.interrupted = true;
      break;
    }
  }

  return result;
}
