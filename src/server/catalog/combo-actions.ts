"use server";

// Escritas de Pacotes (frente E; mesmas assinaturas de SaveComboAction e DeleteComboAction em types.ts).
// Granular, sem ler o banco inteiro:
// uma linha em product_combos e a troca dos itens daquele pacote, numa transacao. Papel: catalog.access.
// Mudar os produtos de um pacote nao mexe no acesso de quem ja comprou (D7: nada retroativo). O mesmo vale
// para o prazo de cada produto e para o item "todas as formacoes" (docs/05, "Prazo de acesso por curso e
// todas as formacoes"; migracao 202611280001): valem para as proximas vendas.

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

type ComboFields = {
  all_formations: boolean;
  all_formations_amount: number | null;
  all_formations_unit: string | null;
  cohort_name: string;
  description: string;
  name: string;
  status: string;
};

/** Um produto do pacote com o prazo dele (`unit` e `amount` nulos = para sempre). */
type ComboItem = { amount: number | null; productId: string; unit: string | null };

/** Caminho em passos (sem transacao), so enquanto a funcao admin_save_combo_v2 nao esta no banco. */
async function saveComboInSteps(
  db: ReturnType<typeof getSupabaseAdminClient>,
  input: { comboId: string; create: boolean; fields: ComboFields; items: ComboItem[] }
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

  if (input.items.length === 0) {
    return null;
  }

  const { error: insertError } = await db
    .from("product_combo_items")
    .insert(input.items.map((item, index) => ({ access_amount: item.amount, access_unit: item.unit, combo_id: input.comboId, product_id: item.productId, sort_order: index })));

  return insertError;
}

export async function saveCombo(raw: ComboInput): Promise<ActionResult<ComboListItem>> {
  return runAdminAction("catalog.access", "conteudo", comboSchema, raw, async ({ input, user }) => {
    const db = getSupabaseAdminClient();
    const productIds = Array.from(new Set(input.productIds));

    // So produtos vendidos sozinhos entram num pacote.
    const { data: productData, error: productError } =
      productIds.length > 0
        ? await db.from("content_items").select("id").in("id", productIds).eq("commerce_scope", "sellable_product").in("bucket", [...COMBO_PRODUCT_BUCKETS])
        : { data: [], error: null };
    failOnError(productError, "Produtos do pacote");

    const found = new Set(((productData ?? []) as { id: string }[]).map((row) => row.id));

    if (productIds.some((id) => !found.has(id))) {
      throw new CatalogRuleError(PRODUCT_UNAVAILABLE);
    }

    // Dados do pacote e troca dos produtos na mesma transacao (admin_save_combo, 202610110012):
    // uma falha no meio nao deixa o pacote sem produtos.
    const comboId = input.id ?? makeCatalogId("combo", input.name);

    // Codigo da Hotmart ou da Ticto ja usado por outro alvo: recusa ANTES de criar ou gravar o pacote
    // (senao o pacote novo nasceria sem codigo e o proximo Salvar criaria outro).
    await assertSalesLinksAvailable(db, { codes: { hotmart: input.hotmartProductId, ticto: input.tictoProductId }, comboId });
    // O prazo do item "todas as formacoes" so existe com o item ligado.
    const allFormationsTerm = input.allFormations ? input.allFormationsTerm : null;
    const fields: ComboFields = {
      all_formations: input.allFormations,
      all_formations_amount: allFormationsTerm?.amount ?? null,
      all_formations_unit: allFormationsTerm?.unit ?? null,
      cohort_name: input.cohortName || DEFAULT_COHORT_NAME,
      description: input.description,
      name: input.name,
      status: input.status
    };
    // Cada produto com o prazo dele; produto sem prazo escolhido = para sempre.
    const items: ComboItem[] = productIds.map((productId) => {
      const term = input.productTerms[productId] ?? null;

      return { amount: term?.amount ?? null, productId, unit: term?.unit ?? null };
    });
    const transaction = await db.rpc("admin_save_combo_v2", {
      p_all_formations: fields.all_formations,
      p_all_formations_amount: fields.all_formations_amount,
      p_all_formations_unit: fields.all_formations_unit,
      p_cohort_name: fields.cohort_name,
      p_combo_id: comboId,
      p_create: !input.id,
      p_description: fields.description,
      p_items: items,
      p_name: fields.name,
      p_status: fields.status
    });
    let error: { code?: string; message: string } | null = transaction.error;

    // Sem a funcao admin_save_combo_v2 no banco (cache do PostgREST ainda sem ela): grava em passos. As
    // colunas do prazo vem da mesma migracao (202611280001): sem ela, o passo falha com o erro do banco.
    if (error && isMissingSchemaObjectError(error)) {
      error = await saveComboInSteps(db, { comboId, create: !input.id, fields, items });
    }

    if (error?.message.includes("combo_not_found")) {
      throw new CatalogNotFoundError("Este pacote não existe mais. Ele pode ter sido excluído.");
    }

    if (error?.message.includes("combo_product_unavailable")) {
      throw new CatalogRuleError(PRODUCT_UNAVAILABLE);
    }

    if (error?.message.includes("combo_items_invalid")) {
      throw new CatalogRuleError("Escolha pelo menos um produto ou ligue “Todas as formações”.");
    }

    failOnError(error, "Pacote");

    // Codigo na Hotmart e na Ticto (sales_product_links): fora da transacao do pacote, depois dela.
    // Codigo repetido vira erro do campo da plataforma; "" tira a ligacao. Se falhar num pacote
    // recem-criado (corrida entre dois salvamentos), o pacote e desfeito para nao sobrar um duplicado.
    const codes = [
      { externalProductId: input.hotmartProductId, provider: "hotmart" as const },
      { externalProductId: input.tictoProductId, provider: "ticto" as const }
    ];

    for (const code of codes) {
      if (code.externalProductId === undefined) {
        continue;
      }

      try {
        await setSalesLink(db, { comboId, createdBy: user.id, externalProductId: code.externalProductId, provider: code.provider });
      } catch (linkError) {
        if (!input.id) {
          await db.from("product_combos").delete().eq("id", comboId);
        }

        throw linkError;
      }
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
  return runAdminAction("catalog.access", "dever_legal", deleteComboSchema, raw, async ({ input }) => {
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
