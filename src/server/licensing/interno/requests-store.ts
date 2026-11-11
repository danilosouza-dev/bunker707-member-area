import "server-only";

// O banco da venda que vira Licenca (migracao 202611130001: license_products e license_requests; docs/32 §11.10).
// Sempre com a chave de servico, so a partir do webhook de venda e do Reprocessar (process-sale.ts), da tarefa do tick
// `licencas-vendas`, das telas e acoes do dono (a marca Bunker Members no produto e a lista em Configuracoes > Vendas) e
// do menu e da pagina Minhas licencas (a lista dos produtos marcados). Colunas explicitas e uma linha por escrita
// (docs/13). Nenhum dado pessoal mora aqui: o comprador e o user_id; o e-mail e o nome sao lidos na hora de enviar.
//
// Sem a API interna configurada (seller.ts), ninguem chama este arquivo.

import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingSchemaObjectError, isPendingMigrationError, toDbError } from "@/server/db/pending-migration";
import {
  DISMISSED_SALE_RESOLUTION,
  LICENSE_REQUEST_COLUMNS,
  STALE_LICENSE_CLAIM_MS,
  TEAM_DISMISSED_RESOLUTION,
  UNDONE_SALE_RESOLUTION,
  type AttemptPatch,
  type LicenseRequestRow
} from "./requests-model";

export type LicenseSalesDb = SupabaseClient;

type DbError = { code?: string | null; hint?: string | null; message: string } | null;

function failOnError(error: DbError, context: string) {
  if (error) {
    throw toDbError(error, context);
  }
}

/** Banco sem a migracao 202611130001 (a tabela nao existe): o erro do banco ou o que failOnError lancou. */
export function isLicenseSalesSchemaMissing(error: unknown): boolean {
  if (isPendingMigrationError(error)) {
    return true;
  }

  return typeof error === "object" && error !== null && isMissingSchemaObjectError(error as { code?: string | null; message?: string | null });
}

// ---- Os produtos marcados como Bunker Members --------------------------------------------------------------

export async function fetchLicenseProductIds(db: LicenseSalesDb): Promise<string[]> {
  const { data, error } = await db.from("license_products").select("product_id").order("product_id", { ascending: true }).limit(500);
  failOnError(error, "Produtos do Bunker Members");

  return ((data ?? []) as { product_id: string }[]).map((row) => row.product_id);
}

export async function isLicenseProduct(db: LicenseSalesDb, productId: string): Promise<boolean> {
  const { data, error } = await db.from("license_products").select("product_id").eq("product_id", productId).maybeSingle();
  failOnError(error, "Produto do Bunker Members");

  return Boolean(data);
}

/** Marca ou desmarca o produto. Marcar de novo nao muda nada (a linha ja existe). */
export async function setLicenseProduct(db: LicenseSalesDb, input: { enabled: boolean; productId: string; userId: string }): Promise<void> {
  if (input.enabled) {
    const { error } = await db
      .from("license_products")
      .upsert({ created_by: input.userId, product_id: input.productId }, { ignoreDuplicates: true, onConflict: "product_id" });
    failOnError(error, "Marcar o produto como Bunker Members");
    return;
  }

  const { error } = await db.from("license_products").delete().eq("product_id", input.productId);
  failOnError(error, "Desmarcar o produto do Bunker Members");
}

// ---- A fila ------------------------------------------------------------------------------------------------

export type LicenseRequestInsert = {
  externalProductId: string;
  kind: "venda" | "desfazer";
  occurredAt?: string | null;
  provider: "hotmart" | "ticto" | "kiwify";
  purchasedAt?: string | null;
  reason?: "reembolso" | "chargeback" | "cancelamento" | null;
  requestKey: string;
  resolution?: string | null;
  status?: "pendente" | "dispensado";
  subscriptionCode?: string | null;
  transactionId: string;
  userId?: string | null;
  warrantyEndsAt?: string | null;
  webhookEventId?: string | null;
};

/** Uma linha por chave: a mesma chave de novo devolve a que ja existe (`created: false`), sem mexer nela. */
export async function insertLicenseRequest(db: LicenseSalesDb, input: LicenseRequestInsert): Promise<{ created: boolean; row: LicenseRequestRow }> {
  const row = {
    external_product_id: input.externalProductId,
    kind: input.kind,
    occurred_at: input.occurredAt ?? null,
    provider: input.provider,
    purchased_at: input.purchasedAt ?? null,
    reason: input.reason ?? null,
    request_key: input.requestKey,
    resolution: input.resolution ?? null,
    status: input.status ?? "pendente",
    subscription_code: input.subscriptionCode ?? null,
    transaction_id: input.transactionId,
    user_id: input.userId ?? null,
    warranty_ends_at: input.warrantyEndsAt ?? null,
    webhook_event_id: input.webhookEventId ?? null
  };
  const inserted = await db.from("license_requests").insert(row).select(LICENSE_REQUEST_COLUMNS).single();

  if (!inserted.error) {
    return { created: true, row: inserted.data as unknown as LicenseRequestRow };
  }

  if (inserted.error.code !== "23505") {
    failOnError(inserted.error, "Pedido de Licença na fila");
  }

  const existing = await fetchLicenseRequestByKey(db, input.requestKey);

  if (!existing) {
    throw new Error("Pedido de Licença na fila: a linha sumiu no meio.");
  }

  return { created: false, row: existing };
}

export async function fetchLicenseRequestByKey(db: LicenseSalesDb, requestKey: string): Promise<LicenseRequestRow | null> {
  const { data, error } = await db.from("license_requests").select(LICENSE_REQUEST_COLUMNS).eq("request_key", requestKey).maybeSingle();
  failOnError(error, "Pedido de Licença");

  return (data ?? null) as unknown as LicenseRequestRow | null;
}

/** As vendas pedidas desta compra (ou desta assinatura): o desfazer desfaz cada uma. */
export async function fetchSaleRequestsOf(
  db: LicenseSalesDb,
  input: { provider: string; subscriptionCode: string | null; transactionId: string | null }
): Promise<LicenseRequestRow[]> {
  const rows: LicenseRequestRow[] = [];

  if (input.transactionId) {
    const { data, error } = await db
      .from("license_requests")
      .select(LICENSE_REQUEST_COLUMNS)
      .eq("kind", "venda")
      .eq("provider", input.provider)
      .eq("transaction_id", input.transactionId)
      .order("created_at", { ascending: true })
      .limit(100);
    failOnError(error, "Vendas da compra na fila de Licenças");
    rows.push(...((data ?? []) as unknown as LicenseRequestRow[]));
  }

  if (input.subscriptionCode) {
    const { data, error } = await db
      .from("license_requests")
      .select(LICENSE_REQUEST_COLUMNS)
      .eq("kind", "venda")
      .eq("provider", input.provider)
      .eq("subscription_code", input.subscriptionCode)
      .order("created_at", { ascending: true })
      .limit(100);
    failOnError(error, "Vendas da assinatura na fila de Licenças");

    for (const row of (data ?? []) as unknown as LicenseRequestRow[]) {
      if (!rows.some((known) => known.id === row.id)) {
        rows.push(row);
      }
    }
  }

  return rows;
}

/**
 * Dispensa a venda que nunca pode ter chegado ao Emissor (na fila ou parada, sem resposta em duvida). Update condicional:
 * se a rodada do tick a reivindicou no meio tempo, nada muda e o desfazer entra na fila (devolve false).
 */
export async function dismissUnsentSale(db: LicenseSalesDb, id: string): Promise<boolean> {
  const { data, error } = await db
    .from("license_requests")
    .update({ claimed_at: null, resolution: DISMISSED_SALE_RESOLUTION, status: "dispensado" })
    .eq("id", id)
    .in("status", ["pendente", "parado"])
    .eq("maybe_delivered", false)
    .select("id");
  failOnError(error, "Dispensar a venda na fila de Licenças");

  return ((data ?? []) as { id: string }[]).length > 0;
}

/** Depois do desfazer aceito pelo Emissor, a venda dele que ainda estava na fila (ou parada) nao precisa mais ir. */
export async function dismissSaleUndoneByEmissor(db: LicenseSalesDb, undo: Pick<LicenseRequestRow, "external_product_id" | "provider" | "transaction_id">): Promise<boolean> {
  const { data, error } = await db
    .from("license_requests")
    .update({ claimed_at: null, resolution: UNDONE_SALE_RESOLUTION, status: "dispensado" })
    .eq("kind", "venda")
    .eq("provider", undo.provider)
    .eq("transaction_id", undo.transaction_id)
    .eq("external_product_id", undo.external_product_id)
    .in("status", ["pendente", "parado"])
    .select("id");
  failOnError(error, "Dispensar a venda desfeita na fila de Licenças");

  return ((data ?? []) as { id: string }[]).length > 0;
}

/** O que esta na vez: na fila com a hora chegada, e o que ficou "enviando" de uma rodada que morreu. */
export async function listDueLicenseRequests(db: LicenseSalesDb, input: { limit: number; now: Date }): Promise<LicenseRequestRow[]> {
  const { data, error } = await db
    .from("license_requests")
    .select(LICENSE_REQUEST_COLUMNS)
    .in("status", ["pendente", "enviando"])
    .lte("next_attempt_at", input.now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(input.limit * 3);
  failOnError(error, "Fila de Licenças");

  const staleBefore = input.now.getTime() - STALE_LICENSE_CLAIM_MS;

  return ((data ?? []) as unknown as LicenseRequestRow[])
    .filter((row) => row.status === "pendente" || (row.claimed_at !== null && Date.parse(row.claimed_at) < staleBefore))
    .slice(0, input.limit);
}

/** Reivindica a linha para esta rodada (update condicional): duas rodadas nunca enviam o mesmo pedido ao mesmo tempo. */
export async function claimLicenseRequest(db: LicenseSalesDb, row: LicenseRequestRow, now: Date): Promise<string | null> {
  const claimedAt = now.toISOString();
  let query = db.from("license_requests").update({ claimed_at: claimedAt, status: "enviando" }).eq("id", row.id).eq("status", row.status);
  query = row.claimed_at === null ? query.is("claimed_at", null) : query.eq("claimed_at", row.claimed_at);
  const { data, error } = await query.select("id");
  failOnError(error, "Reivindicar o pedido de Licença");

  return ((data ?? []) as { id: string }[]).length > 0 ? claimedAt : null;
}

/** Grava o resultado so com a reivindicacao desta rodada (outra que a retomou depois manda). */
export async function finishLicenseRequest(db: LicenseSalesDb, input: { claimedAt: string; id: string; patch: AttemptPatch }): Promise<boolean> {
  const { data, error } = await db
    .from("license_requests")
    .update(input.patch)
    .eq("id", input.id)
    .eq("status", "enviando")
    .eq("claimed_at", input.claimedAt)
    .select("id");
  failOnError(error, "Resultado do pedido de Licença");

  return ((data ?? []) as { id: string }[]).length > 0;
}

/** Dispensa o desfazer reivindicado cuja venda nunca chegou ao Emissor. */
export async function dismissClaimedUndo(db: LicenseSalesDb, input: { claimedAt: string; id: string; resolution: string }): Promise<void> {
  const { error } = await db
    .from("license_requests")
    .update({ claimed_at: null, resolution: input.resolution, status: "dispensado" })
    .eq("id", input.id)
    .eq("status", "enviando")
    .eq("claimed_at", input.claimedAt);
  failOnError(error, "Dispensar o desfazer na fila de Licenças");
}

/** A venda de um desfazer (a mesma plataforma, compra e produto). */
export async function fetchSaleRequestFor(db: LicenseSalesDb, undo: LicenseRequestRow): Promise<LicenseRequestRow | null> {
  const { data, error } = await db
    .from("license_requests")
    .select(LICENSE_REQUEST_COLUMNS)
    .eq("kind", "venda")
    .eq("provider", undo.provider)
    .eq("transaction_id", undo.transaction_id)
    .eq("external_product_id", undo.external_product_id)
    .maybeSingle();
  failOnError(error, "Venda do desfazer na fila de Licenças");

  return (data ?? null) as unknown as LicenseRequestRow | null;
}

/** O e-mail e o nome do comprador, lidos na hora de enviar (nunca guardados na fila). */
export async function fetchBuyerOf(db: LicenseSalesDb, userId: string): Promise<{ email: string; name: string | null } | null> {
  const { data, error } = await db.from("profiles").select("id,email,full_name").eq("id", userId).maybeSingle();
  failOnError(error, "Comprador do pedido de Licença");
  const profile = (data ?? null) as { email: string | null; full_name: string | null } | null;

  if (profile?.email?.trim()) {
    return { email: profile.email.trim().toLowerCase(), name: profile.full_name?.trim() || null };
  }

  const { data: auth, error: authError } = await db.auth.admin.getUserById(userId);

  if (authError || !auth?.user?.email) {
    return null;
  }

  return { email: auth.user.email.trim().toLowerCase(), name: profile?.full_name?.trim() || null };
}

// ---- A lista da equipe -------------------------------------------------------------------------------------

/** O que ainda nao saiu (na fila, enviando ou parado) e as ultimas que sairam ou foram dispensadas. */
export async function listLicenseRequestsForTeam(db: LicenseSalesDb, input: { recent: number }): Promise<{ open: LicenseRequestRow[]; recent: LicenseRequestRow[] }> {
  const [open, recent] = await Promise.all([
    db
      .from("license_requests")
      .select(`${LICENSE_REQUEST_COLUMNS},created_at`)
      .in("status", ["pendente", "enviando", "parado"])
      .order("created_at", { ascending: true })
      .limit(200),
    db
      .from("license_requests")
      .select(`${LICENSE_REQUEST_COLUMNS},created_at`)
      .in("status", ["enviado", "dispensado"])
      .order("updated_at", { ascending: false })
      .limit(input.recent)
  ]);
  failOnError(open.error, "Pedidos de Licença na fila");
  failOnError(recent.error, "Pedidos de Licença enviados");

  return { open: (open.data ?? []) as unknown as LicenseRequestRow[], recent: (recent.data ?? []) as unknown as LicenseRequestRow[] };
}

/** "Tentar agora": o pedido na fila ou parado volta a ficar na vez da proxima rodada. */
export async function retryLicenseRequestNow(db: LicenseSalesDb, input: { id: string; now: Date }): Promise<boolean> {
  const { data, error } = await db
    .from("license_requests")
    .update({ next_attempt_at: input.now.toISOString(), status: "pendente" })
    .eq("id", input.id)
    .in("status", ["pendente", "parado"])
    .select("id");
  failOnError(error, "Tentar de novo o pedido de Licença");

  return ((data ?? []) as { id: string }[]).length > 0;
}

/** "Dispensar": a equipe resolveu de outro jeito (o Painel de licenças, a devolucao do valor); o pedido sai da fila. */
export async function dismissLicenseRequestByTeam(db: LicenseSalesDb, input: { id: string }): Promise<boolean> {
  const { data, error } = await db
    .from("license_requests")
    .update({ claimed_at: null, resolution: TEAM_DISMISSED_RESOLUTION, status: "dispensado" })
    .eq("id", input.id)
    .in("status", ["pendente", "parado"])
    .select("id");
  failOnError(error, "Dispensar o pedido de Licença");

  return ((data ?? []) as { id: string }[]).length > 0;
}

/** O produto existe no catalogo (a marca so vale para um produto de verdade). */
export async function productExists(db: LicenseSalesDb, productId: string): Promise<boolean> {
  const { data, error } = await db.from("content_items").select("id").eq("id", productId).maybeSingle();
  failOnError(error, "Produto");

  return Boolean(data);
}
