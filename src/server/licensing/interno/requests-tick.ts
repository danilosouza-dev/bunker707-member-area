import "server-only";

// A rodada da tarefa do tick `licencas-vendas` (docs/32 §11.10): envia ao Emissor os pedidos da fila license_requests, na
// ordem, com reivindicacao por linha (duas rodadas nunca enviam o mesmo pedido juntas) e novas tentativas com espera
// crescente (requests-model.ts). Nunca desiste: o produto que o Emissor nao conhece fica na fila, com o erro na lista de
// Configuracoes > Vendas, ate o produtor cadastrar o codigo no Emissor.
// - a venda vai com a conta do comprador, lida agora (o e-mail e o nome nunca ficam na fila);
// - o desfazer espera a venda dele sair; se a venda nunca pode ter chegado ao Emissor, os dois saem dispensados;
// - o X-Pedido de cada pedido e o id da linha: o mesmo entre as tentativas.
// Os logs da tarefa levam so contagens e codigos.

import { saleRequestSchema, undoRequestSchema, type InternalEmissorClient, type InternalResult, type SaleReceipt } from "./contract";
import {
  DISMISSED_UNDO_RESOLUTION,
  MAX_LICENSE_REQUESTS_PER_RUN,
  planAfterLicenseAttempt,
  undoMustWait,
  undoPlanFor,
  type AttemptResult,
  type LicenseRequestRow
} from "./requests-model";
import {
  claimLicenseRequest,
  dismissClaimedUndo,
  dismissUnsentSale,
  fetchBuyerOf,
  fetchSaleRequestFor,
  finishLicenseRequest,
  listDueLicenseRequests,
  releaseLicenseRequest,
  type LicenseSalesDb
} from "./requests-store";

export type LicenseRequestsRoundResult = {
  sent: number;
  failed: number;
  waiting: number;
  dismissed: number;
  contended: number;
  /** Os codigos das falhas desta rodada (para o log; nunca dados do comprador). */
  errors: string[];
};

/** Espera do desfazer cuja venda ainda nao saiu: volta a olhar no minuto seguinte. */
const UNDO_WAIT_MS = 60_000;

function receiptText(kind: LicenseRequestRow["kind"], receipt: SaleReceipt, reason: string | null): string {
  const ids = receipt.licencas ?? (receipt.licenca ? [receipt.licenca] : []);
  const which = ids.length > 0 ? ` (${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", ..." : ""})` : "";

  return kind === "venda" ? `Recebida pelo Emissor${which}.` : `Desfeita no Emissor${reason ? ` (${reason})` : ""}${which}.`;
}

function asAttempt<T extends SaleReceipt>(row: LicenseRequestRow, result: InternalResult<T>): AttemptResult {
  return result.ok
    ? { ok: true, resolution: receiptText(row.kind, result.data, row.reason) }
    : { error: result.error, message: result.message, ok: false, ...(result.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: result.retryAfterSeconds }) };
}

/** Envia um pedido ja reivindicado. Devolve o resultado da tentativa (o que vai para a linha). */
async function sendRequest(db: LicenseSalesDb, client: InternalEmissorClient, row: LicenseRequestRow, signal: AbortSignal | undefined): Promise<AttemptResult> {
  const call = { requestId: row.id, ...(signal ? { signal } : {}) };

  if (row.kind === "venda") {
    const buyer = row.user_id ? await fetchBuyerOf(db, row.user_id) : null;

    if (!row.user_id || !buyer) {
      return { error: "sem_conta", message: null, ok: false };
    }

    const body = saleRequestSchema.safeParse({
      comprador: { areaUserId: row.user_id, email: buyer.email, nome: buyer.name },
      compradoEm: row.purchased_at ? new Date(row.purchased_at).toISOString() : null,
      garantiaAte: row.warranty_ends_at ? new Date(row.warranty_ends_at).toISOString() : null,
      plataforma: row.provider,
      produto: row.external_product_id,
      transacao: row.transaction_id
    });

    if (!body.success) {
      return { error: "pedido_invalido", message: "os dados da venda não seguem o contrato", ok: false };
    }

    return asAttempt(row, await client.registerSale(body.data, call));
  }

  const body = undoRequestSchema.safeParse({
    em: new Date(row.occurred_at ?? Date.now()).toISOString(),
    motivo: row.reason,
    plataforma: row.provider,
    produto: row.external_product_id,
    transacao: row.transaction_id
  });

  if (!body.success) {
    return { error: "pedido_invalido", message: "os dados do desfazer não seguem o contrato", ok: false };
  }

  return asAttempt(row, await client.undoSale(body.data, call));
}

export async function runLicenseRequestsRound(input: {
  client: InternalEmissorClient;
  db: LicenseSalesDb;
  now?: () => Date;
  signal?: AbortSignal;
  limit?: number;
}): Promise<LicenseRequestsRoundResult> {
  const now = input.now ?? (() => new Date());
  const result: LicenseRequestsRoundResult = { contended: 0, dismissed: 0, errors: [], failed: 0, sent: 0, waiting: 0 };
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

    if (row.kind === "desfazer") {
      const sale = await fetchSaleRequestFor(input.db, row);
      const plan = undoPlanFor(sale);

      // A venda nunca chegou ao Emissor (ou foi dispensada): os dois saem sem pedido nenhum.
      if (plan === "sem_venda" || (plan === "dispensar" && sale && (await dismissUnsentSale(input.db, sale.id)))) {
        await dismissClaimedUndo(input.db, { claimedAt, id: row.id, resolution: DISMISSED_UNDO_RESOLUTION });
        result.dismissed += 1;
        continue;
      }

      // A ordem: o desfazer so sai depois da venda.
      if (undoMustWait(sale)) {
        await releaseLicenseRequest(input.db, { claimedAt, id: row.id, nextAttemptAt: new Date(now().getTime() + UNDO_WAIT_MS).toISOString() });
        result.waiting += 1;
        continue;
      }
    }

    const attempt = await sendRequest(input.db, input.client, row, input.signal);
    const patch = planAfterLicenseAttempt(row, attempt, now());
    await finishLicenseRequest(input.db, { claimedAt, id: row.id, patch });

    if (attempt.ok) {
      result.sent += 1;
    } else {
      result.failed += 1;
      result.errors.push(attempt.error);
    }
  }

  return result;
}
