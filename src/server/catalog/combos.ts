import "server-only";

// Leituras de Pacotes (frente E; contrato ListCombos em types.ts). Colunas explicitas, so as tabelas
// de pacote e os produtos citados; o mapeamento e puro (combo-model.ts) e testado em
// tests/admin-combos.test.mjs.

import {
  COMBO_PRODUCT_BUCKETS,
  mapComboProductOptions,
  mapComboRows,
  type ComboAccentRow,
  type ComboItemRow,
  type ComboProductRow,
  type ComboRow
} from "./combo-model";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { fetchSalesLinksFor } from "@/server/payments/store";
import type { ComboListItem, ListCombos, ProductOption } from "./types";

type DbError = { message: string } | null;
type Db = ReturnType<typeof getSupabaseAdminClient>;

const COMBO_COLUMNS = "id,name,description,cohort_name,status,updated_at";

function failOnError(error: DbError, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

async function readAccents(db: Db, productIds: readonly string[]): Promise<ComboAccentRow[]> {
  if (productIds.length === 0) {
    return [];
  }

  const { data, error } = await db
    .from("content_page_settings")
    .select("content_id,accent:settings->>accent")
    .in("content_id", [...productIds]);
  failOnError(error, "Cores dos produtos");

  return (data ?? []) as ComboAccentRow[];
}

async function readCombos(db: Db, comboId?: string): Promise<ComboListItem[]> {
  let combosQuery = db.from("product_combos").select(COMBO_COLUMNS).order("updated_at", { ascending: false });

  if (comboId) {
    combosQuery = combosQuery.eq("id", comboId);
  }

  const { data: comboData, error: comboError } = await combosQuery;
  failOnError(comboError, "Pacotes");

  const combos = (comboData ?? []) as ComboRow[];

  if (combos.length === 0) {
    return [];
  }

  const { data: itemData, error: itemError } = await db
    .from("product_combo_items")
    .select("combo_id,product_id,sort_order")
    .in(
      "combo_id",
      combos.map((combo) => combo.id)
    )
    .order("sort_order", { ascending: true });
  failOnError(itemError, "Produtos dos pacotes");

  const items = (itemData ?? []) as ComboItemRow[];
  const productIds = Array.from(new Set(items.map((item) => item.product_id)));
  let products: ComboProductRow[] = [];

  if (productIds.length > 0) {
    const { data: productData, error: productError } = await db.from("content_items").select("id,title,image").in("id", productIds);
    failOnError(productError, "Produtos dos pacotes");
    products = (productData ?? []) as ComboProductRow[];
  }

  const [accents, salesLinks] = await Promise.all([
    readAccents(db, productIds),
    fetchSalesLinksFor(db, { comboIds: combos.map((combo) => combo.id) })
  ]);

  return mapComboRows({ accents, combos, items, products, salesLinks });
}

/** Todos os pacotes, mais recentes primeiro, com os produtos na ordem gravada. */
export const listCombos: ListCombos = async () => readCombos(getSupabaseAdminClient());

/** Um pacote (depois de salvar); null se nao existe. */
export async function getCombo(comboId: string): Promise<ComboListItem | null> {
  const [combo] = await readCombos(getSupabaseAdminClient(), comboId);

  return combo ?? null;
}

/** Produtos que podem entrar num pacote (os vendidos sozinhos), para o seletor. */
export async function listComboProductOptions(): Promise<ProductOption[]> {
  const db = getSupabaseAdminClient();
  const { data, error } = await db
    .from("content_items")
    .select("id,title,kind,image,publication_status")
    .eq("commerce_scope", "sellable_product")
    .in("bucket", [...COMBO_PRODUCT_BUCKETS])
    .order("title", { ascending: true })
    .limit(500);
  failOnError(error, "Produtos para pacotes");

  const products = (data ?? []) as ComboProductRow[];

  return mapComboProductOptions(products, await readAccents(db, products.map((product) => product.id)));
}

/** Turmas ja usadas (sugestoes do campo Turma). */
export async function listCohortNames(): Promise<string[]> {
  const { data, error } = await getSupabaseAdminClient().from("cohorts").select("name").order("created_at", { ascending: true }).limit(200);
  failOnError(error, "Turmas");

  return Array.from(
    new Set(((data ?? []) as { name: string | null }[]).map((row) => row.name?.trim() ?? "").filter(Boolean))
  );
}
