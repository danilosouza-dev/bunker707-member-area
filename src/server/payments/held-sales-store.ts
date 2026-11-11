import "server-only";

// Acesso ao banco das vendas guardadas (migracao 202611110002, tabela held_sales; docs/32 §2.2 e §11.3). Sempre com a
// chave de servico, so a partir do webhook de venda (depois de conferir o token), do Reprocessar (so o dono), da tarefa
// do tick `vendas-guardadas` e das telas do dono e dos administradores. Colunas explicitas e uma linha por escrita
// (docs/13). Nenhum dado pessoal mora aqui: o comprador fica no evento (webhook_events).
//
// No modo "off" ninguem chama este arquivo (process-sale.ts, a tarefa do tick e as telas conferem o modo antes).

import { isMissingSchemaObjectError, isPendingMigrationError, toDbError } from "@/server/db/pending-migration";
import type { SalesProvider } from "./types";
import type { SalesDb } from "./store";

/** A migracao que traz held_sales e o resultado 'held' em webhook_events. */
export const HELD_SALES_MIGRATION = "202611110002";

export type HeldSaleStatus = "held" | "granted" | "discarded";

export const HELD_SALE_COLUMNS =
  "id,webhook_event_id,provider,transaction_id,subscription_code,product_ids,reason,status,held_at,claimed_at,attempts,last_error,resolved_at,resolution";

export type HeldSaleRow = {
  attempts: number;
  claimed_at: string | null;
  held_at: string;
  id: string;
  last_error: string | null;
  product_ids: string[];
  provider: SalesProvider;
  reason: string;
  resolution: string | null;
  resolved_at: string | null;
  status: HeldSaleStatus;
  subscription_code: string | null;
  transaction_id: string;
  webhook_event_id: string;
};

type DbError = { code?: string | null; hint?: string | null; message: string } | null;

function failOnError(error: DbError, context: string) {
  if (error) {
    throw toDbError(error, context);
  }
}

/** Banco sem a migracao 202611110002 (a tabela ou a coluna nao existem): o erro do banco ou o que failOnError lancou. */
export function isHeldSalesSchemaMissing(error: unknown): boolean {
  if (isPendingMigrationError(error)) {
    return true;
  }

  return typeof error === "object" && error !== null && isMissingSchemaObjectError(error as { code?: string | null; message?: string | null });
}

const MAX_RESOLUTION_LENGTH = 500;
const MAX_ERROR_LENGTH = 2000;

export type HeldSaleInsert = {
  productIds: readonly string[];
  provider: SalesProvider;
  reason: string;
  subscriptionCode: string | null;
  transactionId: string;
  webhookEventId: string;
};

/**
 * Guarda a venda: uma linha por evento de compra (indice unico em webhook_event_id). O mesmo evento de novo (reenvio da
 * plataforma, Reprocessar) devolve a linha que ja esta guardada, sem mexer nela. Uma linha ja resolvida (descartada ou
 * liberada) volta a ser guardada, com a data de agora: o evento foi processado de novo e a licenca continua barrando.
 * Devolve `created` so quando a venda passou a ficar guardada agora (o e-mail da equipe e a contagem dependem disso).
 */
export async function recordHeldSale(db: SalesDb, input: HeldSaleInsert): Promise<{ created: boolean; id: string }> {
  const row = {
    product_ids: [...input.productIds],
    provider: input.provider,
    reason: input.reason,
    subscription_code: input.subscriptionCode,
    transaction_id: input.transactionId,
    webhook_event_id: input.webhookEventId
  };
  const inserted = await db.from("held_sales").insert(row).select("id").single();

  if (!inserted.error) {
    return { created: true, id: (inserted.data as { id: string }).id };
  }

  if (inserted.error.code !== "23505") {
    failOnError(inserted.error, "Guardar a venda");
  }

  const existing = await db.from("held_sales").select("id,status").eq("webhook_event_id", input.webhookEventId).maybeSingle();
  failOnError(existing.error, "Venda guardada");

  const current = (existing.data ?? null) as { id: string; status: HeldSaleStatus } | null;

  if (!current) {
    throw new Error("Guardar a venda: a linha da venda guardada sumiu no meio.");
  }

  if (current.status === "held") {
    return { created: false, id: current.id };
  }

  const nowIso = new Date().toISOString();
  const reheld = await db
    .from("held_sales")
    .update({ ...row, attempts: 0, claimed_at: null, held_at: nowIso, last_error: null, resolution: null, resolved_at: null, status: "held" })
    .eq("id", current.id)
    .neq("status", "held")
    .select("id");
  failOnError(reheld.error, "Guardar a venda de novo");

  return { created: ((reheld.data ?? []) as { id: string }[]).length > 0, id: current.id };
}

/**
 * A venda guardada da mesma compra que ainda espera, de outro aviso (a confirmacao do fim da garantia, ou a plataforma
 * que repete a compra com outro id): a compra e liberada uma vez so, e a lista nao mostra duas vendas para ela.
 */
export async function findPendingHeldSaleOfTransaction(
  db: SalesDb,
  input: { provider: SalesProvider; transactionId: string; webhookEventId: string }
): Promise<HeldSaleRow | null> {
  const { data, error } = await db
    .from("held_sales")
    .select(HELD_SALE_COLUMNS)
    .eq("provider", input.provider)
    .eq("transaction_id", input.transactionId)
    .eq("status", "held")
    .neq("webhook_event_id", input.webhookEventId)
    .order("held_at", { ascending: true })
    .limit(1);
  failOnError(error, "Venda guardada da mesma compra");

  return ((data ?? []) as HeldSaleRow[])[0] ?? null;
}

/** Quando a venda guardada mais nova chegou (o e-mail do episodio so sai pela tarefa se ela e deste episodio). */
export async function newestPendingHeldAt(db: SalesDb): Promise<string | null> {
  const { data, error } = await db.from("held_sales").select("held_at").eq("status", "held").order("held_at", { ascending: false }).limit(1);
  failOnError(error, "Vendas guardadas");

  return ((data ?? []) as { held_at: string }[])[0]?.held_at ?? null;
}

/** As vendas guardadas, na ordem em que chegaram (a da liberacao). */
export async function listPendingHeldSales(db: SalesDb, limit: number): Promise<HeldSaleRow[]> {
  const { data, error } = await db
    .from("held_sales")
    .select(HELD_SALE_COLUMNS)
    .eq("status", "held")
    .order("held_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  failOnError(error, "Vendas guardadas");

  return (data ?? []) as HeldSaleRow[];
}

/** Quantas vendas estao guardadas agora (a faixa e o titulo da lista). */
export async function countPendingHeldSales(db: SalesDb): Promise<number> {
  const { count, error } = await db.from("held_sales").select("id", { count: "exact", head: true }).eq("status", "held");
  failOnError(error, "Vendas guardadas");

  return count ?? 0;
}

/**
 * Reivindica uma venda guardada para liberar (update condicional): so a guardada, e so sem reivindicacao ou com uma
 * abandonada (mais velha que `staleAfterMs`). Devolve a marca da reivindicacao, que a gravacao do resultado confere, ou
 * null quando outra rodada chegou antes (ou a venda ja saiu da lista).
 */
export async function claimHeldSale(db: SalesDb, input: { id: string; now: Date; staleAfterMs: number }): Promise<string | null> {
  const claim = input.now.toISOString();
  const cutoff = new Date(input.now.getTime() - input.staleAfterMs).toISOString();
  const { data, error } = await db
    .from("held_sales")
    .update({ claimed_at: claim })
    .eq("id", input.id)
    .eq("status", "held")
    .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`)
    .select("id");
  failOnError(error, "Reivindicar a venda guardada");

  return ((data ?? []) as { id: string }[]).length > 0 ? claim : null;
}

/**
 * Grava o fim da liberacao (liberada ou descartada), so com a reivindicacao desta rodada: se outra rodada retomou a
 * venda, ou um reembolso a descartou no meio, nada muda e a funcao devolve false.
 */
export async function finishHeldSale(
  db: SalesDb,
  input: { claim: string; id: string; resolution: string; status: Exclude<HeldSaleStatus, "held"> }
): Promise<boolean> {
  const { data, error } = await db
    .from("held_sales")
    .update({
      claimed_at: null,
      last_error: null,
      resolution: input.resolution.slice(0, MAX_RESOLUTION_LENGTH),
      resolved_at: new Date().toISOString(),
      status: input.status
    })
    .eq("id", input.id)
    .eq("status", "held")
    .eq("claimed_at", input.claim)
    .select("id");
  failOnError(error, "Registrar a venda guardada");

  return ((data ?? []) as { id: string }[]).length > 0;
}

/** A liberacao falhou (erro do banco ou do Auth): solta a reivindicacao, conta a tentativa e guarda o motivo. */
export async function failHeldSaleAttempt(db: SalesDb, input: { attempts: number; claim: string; error: string; id: string }) {
  const { error } = await db
    .from("held_sales")
    .update({ attempts: input.attempts + 1, claimed_at: null, last_error: input.error.slice(0, MAX_ERROR_LENGTH) })
    .eq("id", input.id)
    .eq("status", "held")
    .eq("claimed_at", input.claim);

  if (error) {
    console.error(`[vendas] tentativa da venda guardada ${input.id} nao registrada: ${error.message}`);
  }
}

/**
 * A venda foi liberada pela regra de acesso de sempre fora da tarefa do tick (o reenvio ou o Reprocessar do mesmo evento
 * com a licenca ja em dia): a linha guardada dele sai da lista como liberada.
 */
export async function resolveHeldSaleOfEvent(db: SalesDb, input: { resolution: string; webhookEventId: string }) {
  const { error } = await db
    .from("held_sales")
    .update({ claimed_at: null, resolution: input.resolution.slice(0, MAX_RESOLUTION_LENGTH), resolved_at: new Date().toISOString(), status: "granted" })
    .eq("webhook_event_id", input.webhookEventId)
    .eq("status", "held");

  if (error && !isHeldSalesSchemaMissing(error)) {
    failOnError(error, "Registrar a venda guardada");
  }
}

/**
 * Reembolso, chargeback ou assinatura cancelada antes da liberacao: as vendas guardadas da mesma compra (ou da mesma
 * assinatura) saem da lista como descartadas e nunca sao liberadas. Duas consultas com filtros simples (nunca texto da
 * plataforma dentro de um `or`). Devolve as linhas descartadas agora. Banco sem a tabela: nenhuma venda pode estar
 * guardada, e o reembolso segue.
 */
export async function discardHeldSalesOf(
  db: SalesDb,
  input: { provider: SalesProvider; resolution: string; subscriptionCode: string | null; transactionId: string | null }
): Promise<HeldSaleRow[]> {
  const lookups: { column: "subscription_code" | "transaction_id"; value: string }[] = [];

  if (input.transactionId) {
    lookups.push({ column: "transaction_id", value: input.transactionId });
  }

  if (input.subscriptionCode) {
    lookups.push({ column: "subscription_code", value: input.subscriptionCode });
  }

  const found = new Map<string, HeldSaleRow>();

  for (const lookup of lookups) {
    const { data, error } = await db.from("held_sales").select(HELD_SALE_COLUMNS).eq("provider", input.provider).eq(lookup.column, lookup.value).eq("status", "held");

    if (error && isHeldSalesSchemaMissing(error)) {
      console.info(`[vendas] migracao ${HELD_SALES_MIGRATION} pendente: nenhuma venda guardada para descartar.`);
      return [];
    }

    failOnError(error, "Vendas guardadas da compra");

    for (const row of (data ?? []) as HeldSaleRow[]) {
      found.set(row.id, row);
    }
  }

  const discarded: HeldSaleRow[] = [];

  for (const row of found.values()) {
    const { data, error } = await db
      .from("held_sales")
      .update({ claimed_at: null, resolution: input.resolution.slice(0, MAX_RESOLUTION_LENGTH), resolved_at: new Date().toISOString(), status: "discarded" })
      .eq("id", row.id)
      .eq("status", "held")
      .select("id");
    failOnError(error, "Descartar a venda guardada");

    if (((data ?? []) as { id: string }[]).length > 0) {
      discarded.push(row);
    }
  }

  return discarded;
}

/** Busca as linhas das vendas guardadas pelos ids dos eventos (a lista Vendas recebidas). */
export async function fetchHeldSalesByEvents(db: SalesDb, webhookEventIds: readonly string[]): Promise<HeldSaleRow[]> {
  if (webhookEventIds.length === 0) {
    return [];
  }

  const { data, error } = await db.from("held_sales").select(HELD_SALE_COLUMNS).in("webhook_event_id", [...webhookEventIds]);
  failOnError(error, "Vendas guardadas");

  return (data ?? []) as HeldSaleRow[];
}
