import "server-only";

// O passo da venda que vira Licenca (docs/32 §11.10), chamado por src/server/payments/process-sale.ts DEPOIS da regra de
// acesso de sempre, que nao muda: o acesso do aluno continua nascendo, renovando e saindo exatamente como antes. Este
// passo so enfileira pedidos ao Emissor (license_requests), que a tarefa do tick `licencas-vendas` envia:
// - compra aprovada (a venda nova e a confirmacao do fim da garantia): para cada codigo do pedido (o principal e os
//   vendidos junto) cujo produto, ou pacote, inclui um produto marcado como Bunker Members, uma venda na fila, com a conta
//   do comprador (a que a regra de acesso achou ou criou). A mesma venda nunca entra duas vezes (request_key). Sem conta
//   (a regra ignorou a venda: pacote pausado, produto que nao existe mais, compra ja desfeita) nada entra: o Reprocessar,
//   depois de corrigido, entra. A parte guardada de uma venda guardada (docs/32 §2.2) espera a liberacao, que passa por
//   aqui de novo. A reativacao de assinatura nao e venda nova e nao entra;
// - reembolso, chargeback e cancelamento: um desfazer para cada venda desta compra (ou assinatura) que esta na fila, com
//   o motivo. A venda que nunca pode ter chegado ao Emissor e dispensada junto, sem pedido nenhum (undoPlanFor).
// Sem a API interna configurada (seller.ts) nada disso le ou grava nada. O banco sem a migracao 202611130001 nao tem
// produto marcado: o passo registra o motivo uma vez e segue sem erro. Outro erro do banco sobe: a venda fica com erro
// em Vendas recebidas, com o acesso ja liberado, e o Reprocessar refaz os dois (a regra de acesso e idempotente).

import { fetchSalesLinkByExternalId, type SalesDb } from "@/server/payments/store";
import type { NormalizedSaleEvent } from "@/server/payments/types";
import {
  DISMISSED_UNDO_RESOLUTION,
  UNDO_REASON_OF_SALE_TYPE,
  saleRequestKey,
  undoPlanFor,
  undoRequestKey
} from "./requests-model";
import {
  dismissUnsentSale,
  fetchLicenseProductIds,
  fetchSaleRequestsOf,
  insertLicenseRequest,
  isLicenseSalesSchemaMissing
} from "./requests-store";
import { sellerFeaturesEnabled } from "./seller";

export type LicenseSaleStepInput = {
  event: NormalizedSaleEvent;
  /** O que a regra de acesso decidiu: a conta e os produtos que ficaram guardados (venda guardada). */
  access: { userId: string | null; heldProductIds: readonly string[] };
  webhookEventId: string | null;
};

/** O que o passo fez, numa frase curta que vai para o detalhe da venda em Vendas recebidas (ou null quando nada). */
export type LicenseSaleStepResult = { note: string | null };

const NOTHING: LicenseSaleStepResult = Object.freeze({ note: null });

let missingSchemaLogged = false;

/** O id da compra, como o vinculo da venda (saleSourceEventId de process-sale.ts): a transacao, ou o id do evento. */
function transactionOf(event: NormalizedSaleEvent): string {
  return event.transactionId ?? event.eventId;
}

/** Os produtos do catalogo que um codigo vendido libera (o produto, ou os produtos do pacote, em qualquer situacao). */
async function productIdsOfCode(db: SalesDb, provider: NormalizedSaleEvent["provider"], code: string): Promise<string[]> {
  const link = await fetchSalesLinkByExternalId(db, provider, code);

  if (!link) {
    return [];
  }

  if (link.product_id) {
    return [link.product_id];
  }

  const { data, error } = await db.from("product_combo_items").select("product_id").eq("combo_id", link.combo_id as string);

  if (error) {
    throw new Error(`Produtos do pacote da venda (Licença): ${error.message}`);
  }

  return ((data ?? []) as { product_id: string }[]).map((item) => item.product_id);
}

/** O passo da venda que vira Licenca. Sem a API interna, devolve na hora sem ler nada. */
export async function requestLicensesAfterSale(db: SalesDb, input: LicenseSaleStepInput): Promise<LicenseSaleStepResult> {
  const { event } = input;

  if (event.type === "other" || !(await sellerFeaturesEnabled())) {
    return NOTHING;
  }

  try {
    return event.type === "purchase_approved" ? await requestSales(db, input) : await requestUndos(db, input);
  } catch (error) {
    if (isLicenseSalesSchemaMissing(error)) {
      if (!missingSchemaLogged) {
        missingSchemaLogged = true;
        console.warn("[licencas-vendas] migracao 202611130001 pendente: nenhuma venda vira Licenca ate ela rodar.");
      }

      return NOTHING;
    }

    throw error;
  }
}

async function requestSales(db: SalesDb, input: LicenseSaleStepInput): Promise<LicenseSaleStepResult> {
  const { event } = input;
  const userId = input.access.userId;

  if (!userId || event.reactivatesSubscription) {
    return NOTHING;
  }

  const flagged = new Set(await fetchLicenseProductIds(db));

  if (flagged.size === 0) {
    return NOTHING;
  }

  const held = new Set(input.access.heldProductIds);
  const lines = [
    ...(event.externalProductId ? [{ code: event.externalProductId, main: true }] : []),
    ...(event.extraProducts ?? []).filter((extra) => extra.externalProductId !== event.externalProductId).map((extra) => ({ code: extra.externalProductId, main: false }))
  ];
  const transactionId = transactionOf(event);
  let created = 0;
  let known = 0;

  for (const line of lines) {
    const productIds = await productIdsOfCode(db, event.provider, line.code);
    const licensed = productIds.filter((productId) => flagged.has(productId));

    // So o que a pessoa recebeu agora vira Licenca: a parte guardada espera a liberacao.
    if (licensed.length === 0 || licensed.every((productId) => held.has(productId))) {
      continue;
    }

    const outcome = await insertLicenseRequest(db, {
      externalProductId: line.code,
      kind: "venda",
      provider: event.provider,
      purchasedAt: event.purchasedAt ?? event.occurredAt ?? null,
      requestKey: saleRequestKey({ productCode: line.code, provider: event.provider, transactionId }),
      // So o item principal herda o codigo da assinatura (o vendido junto e cobranca unica), como no acesso.
      subscriptionCode: line.main ? event.subscriptionCode : null,
      transactionId,
      userId,
      warrantyEndsAt: event.warrantyEndsAt ?? null,
      webhookEventId: input.webhookEventId
    });

    if (outcome.created) {
      created += 1;
    } else {
      known += 1;
    }
  }

  if (created > 0) {
    return { note: created === 1 ? "Licença do Bunker Members pedida ao Emissor (fila)." : `${created} Licenças do Bunker Members pedidas ao Emissor (fila).` };
  }

  return known > 0 ? { note: "Licença do Bunker Members já estava pedida." } : NOTHING;
}

async function requestUndos(db: SalesDb, input: LicenseSaleStepInput): Promise<LicenseSaleStepResult> {
  const { event } = input;
  const reason = UNDO_REASON_OF_SALE_TYPE[event.type as keyof typeof UNDO_REASON_OF_SALE_TYPE];

  if (!reason) {
    return NOTHING;
  }

  // Como no acesso: o cancelamento vale pela assinatura inteira; o reembolso e o chargeback, pela compra.
  const bySubscription = event.subscriptionCode && (event.type === "subscription_canceled" || !event.transactionId) ? event.subscriptionCode : null;
  const sales = await fetchSaleRequestsOf(db, { provider: event.provider, subscriptionCode: bySubscription, transactionId: event.transactionId });
  const occurredAt = event.occurredAt ?? new Date().toISOString();
  let queued = 0;
  let dismissed = 0;

  for (const sale of sales) {
    const plan = undoPlanFor(sale);

    if (plan === "sem_venda") {
      continue;
    }

    const dismissedNow = plan === "dispensar" && (await dismissUnsentSale(db, sale.id));
    const outcome = await insertLicenseRequest(db, {
      externalProductId: sale.external_product_id,
      kind: "desfazer",
      occurredAt,
      provider: sale.provider,
      reason,
      requestKey: undoRequestKey({ productCode: sale.external_product_id, provider: sale.provider, reason, transactionId: sale.transaction_id }),
      resolution: dismissedNow ? DISMISSED_UNDO_RESOLUTION : null,
      status: dismissedNow ? "dispensado" : "pendente",
      subscriptionCode: sale.subscription_code,
      transactionId: sale.transaction_id,
      userId: sale.user_id,
      webhookEventId: input.webhookEventId
    });

    if (outcome.created) {
      if (dismissedNow) {
        dismissed += 1;
      } else {
        queued += 1;
      }
    }
  }

  if (queued > 0) {
    return { note: `Licença do Bunker Members: ${reason} pedido ao Emissor (fila).` };
  }

  return dismissed > 0 ? { note: "Licença do Bunker Members: a venda ainda não tinha chegado ao Emissor; nada a desfazer." } : NOTHING;
}
