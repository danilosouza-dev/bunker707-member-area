"use server";

// Escritas de Pacotes (frente E; mesmas assinaturas de SaveComboAction e DeleteComboAction em types.ts).
// Granular, sem ler o banco inteiro:
// uma linha em product_combos e a troca dos itens daquele pacote, numa transacao. Papel: catalog.access.
// Mudar os produtos de um pacote nao mexe no acesso de quem ja comprou (D7: nada retroativo).

import { DEFAULT_COHORT_NAME, COMBO_PRODUCT_BUCKETS } from "./combo-model";
import { runAdminAction } from "@/server/actions/run-action";
import { invalidateCatalog } from "@/server/catalog/cache";
import { isMissingSchemaObjectError } from "@/server/db/pending-migration";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { assertSalesLinksAvailable, setSalesLink } from "@/server/payments/store";
import { getCombo } from "./combos";
import { CatalogNotFoundError, CatalogRuleError } from "./errors";
import { makeCatalogId } from "./model";
import { comboSchema, deleteComboSchema } from "./schemas";
import type { ActionResult } from "@/lib/action-result";
import type { ComboInput, ComboListItem, DeleteComboInput } from "./types";

const PRODUCT_UNAVAILABLE = "Um dos produtos escolhidos não está mais à venda. Recarregue a página e escolha de novo.";

function failOnError(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

type ComboFields = { cohort_name: string; description: string; name: string; status: string };

/** Caminho antigo (sem transacao), so enquanto a migracao 202610110012 nao foi aplicada. */
async function saveComboInSteps(
  db: ReturnType<typeof getSupabaseAdminClient>,
  input: { comboId: string; create: boolean; fields: ComboFields; productIds: string[] }
): Promise<{ message: string } | null> {
  if (input.create) {
    const { error } = await db.from("product_combos").insert({ ...input.fields, id: input.comboId });

    if (error) {
      return error;
    }
  } else {
    const { data, error } = await db.from("product_combos").update(input.fields).eq("id", input.comboId).select("id");

    if (error) {
      return error;
    }

    if (!data || data.length === 0) {
      return { message: "combo_not_found" };
    }
  }

  const { error: deleteError } = await db.from("product_combo_items").delete().eq("combo_id", input.comboId);

  if (deleteError) {
    return deleteError;
  }

  const { error: insertError } = await db
    .from("product_combo_items")
    .insert(input.productIds.map((productId, index) => ({ combo_id: input.comboId, product_id: productId, sort_order: index })));

  return insertError;
}

export async function saveCombo(raw: ComboInput): Promise<ActionResult<ComboListItem>> {
  return runAdminAction("catalog.access", comboSchema, raw, async ({ input, user }) => {
    const db = getSupabaseAdminClient();
    const productIds = Array.from(new Set(input.productIds));

    // So produtos vendidos sozinhos entram num pacote.
    const { data: productData, error: productError } = await db
      .from("content_items")
      .select("id")
      .in("id", productIds)
      .eq("commerce_scope", "sellable_product")
      .in("bucket", [...COMBO_PRODUCT_BUCKETS]);
    failOnError(productError, "Produtos do pacote");

    const found = new Set(((productData ?? []) as { id: string }[]).map((row) => row.id));

    if (productIds.some((id) => !found.has(id))) {
      throw new CatalogRuleError(PRODUCT_UNAVAILABLE);
    }

    // Dados do pacote e troca dos produtos na mesma transacao (admin_save_combo, 202610110012):
    // uma falha no meio nao deixa o pacote sem produtos.
    const comboId = input.id ?? makeCatalogId("combo", input.name);
    // Codigo de venda ja usado por outro alvo: recusa no campo antes de gravar o pacote.
    await assertSalesLinksAvailable(db, { codes: { hotmart: input.hotmartProductId, ticto: input.tictoProductId }, comboId });
    const fields = {
      cohort_name: input.cohortName || DEFAULT_COHORT_NAME,
      description: input.description,
      name: input.name,
      status: input.status
    };
    const transaction = await db.rpc("admin_save_combo", {
      p_cohort_name: fields.cohort_name,
      p_combo_id: comboId,
      p_create: !input.id,
      p_description: fields.description,
      p_name: fields.name,
      p_product_ids: productIds,
      p_status: fields.status
    });
    let error: { code?: string; message: string } | null = transaction.error;

    // Pacotes funcionam antes da migracao 202610110012 (as leituras nao dependem dela): sem a funcao,
    // grava em passos, como antes, ate o banco ser atualizado.
    if (error && isMissingSchemaObjectError(error)) {
      error = await saveComboInSteps(db, { comboId, create: !input.id, fields, productIds });
    }

    if (error?.message.includes("combo_not_found")) {
      throw new CatalogNotFoundError("Este pacote não existe mais. Ele pode ter sido excluído.");
    }

    if (error?.message.includes("combo_product_unavailable")) {
      throw new CatalogRuleError(PRODUCT_UNAVAILABLE);
    }

    failOnError(error, "Pacote");

    // Codigo na Hotmart e na Ticto (sales_product_links): fora da transacao do pacote, depois dela.
    // Codigo repetido vira erro do campo da plataforma; "" tira a ligacao.
    if (input.hotmartProductId !== undefined) {
      await setSalesLink(db, { comboId, createdBy: user.id, externalProductId: input.hotmartProductId, provider: "hotmart" });
    }

    if (input.tictoProductId !== undefined) {
      await setSalesLink(db, { comboId, createdBy: user.id, externalProductId: input.tictoProductId, provider: "ticto" });
    }

    invalidateCatalog({ from: "action" });

    const saved = await getCombo(comboId);

    if (!saved) {
      throw new CatalogNotFoundError("Este pacote não existe mais. Ele pode ter sido excluído.");
    }

    return saved;
  });
}

export async function deleteCombo(raw: DeleteComboInput): Promise<ActionResult<{ id: string }>> {
  return runAdminAction("catalog.access", deleteComboSchema, raw, async ({ input }) => {
    // Os itens saem junto (on delete cascade). Acessos ja liberados continuam (nada retroativo).
    const { data, error } = await getSupabaseAdminClient().from("product_combos").delete().eq("id", input.id).select("id");
    failOnError(error, "Pacote");

    if (!data || data.length === 0) {
      throw new CatalogNotFoundError("Este pacote não existe mais. Ele pode ter sido excluído.");
    }

    invalidateCatalog({ from: "action" });

    return { id: input.id };
  });
}
