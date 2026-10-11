"use server";

// Server Actions da tela Area de membros > Modulos (e do interruptor da aba Detalhes). As duas sao de
// "estado desejado": relêem o que esta gravado na hora, aplicam a mudanca e gravam. Um clique aqui
// nunca apaga uma mudanca feita na Vitrine (nem o contrario): a fileira e gravada com a versao que
// acabou de ser lida e, se alguem gravou no meio, relemos e tentamos uma vez mais.

import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { invalidateCatalog } from "@/server/catalog/cache";
import { CatalogRuleError } from "@/server/catalog/errors";
import { productFormatOf } from "@/server/catalog/mappers";
import { catalogDb, patchProductSettings, requireProductRow } from "@/server/catalog/store";
import { invalidateMemberArea } from "@/server/member-area/cache";
import { getStorefrontEditorData } from "@/server/storefront/queries";
import { MemberAreaConflictError } from "./errors";
import {
  HomeModuleRowRuleError,
  applyHomeModuleRow,
  computeHomeModuleRowState,
  homeModuleRowBlocker,
  setHomeModuleRowSchema,
  setProductOpensAsSchema,
  type CoursePresentationModeValue,
  type HomeModuleRowState,
  type SetHomeModuleRowInput,
  type SetProductOpensAsInput
} from "./modules-model";
import { writePlatformSettingGuarded } from "./settings-store";

const FORMATION_OPENS_AS = "Uma formação abre nos cursos dela.";

/** [catalog.write] "Como abre": cards de modulos ou direto na primeira aula. Formação → 422. */
export async function setProductOpensAs(
  input: SetProductOpensAsInput
): Promise<ActionResult<{ mode: CoursePresentationModeValue; productId: string }>> {
  return runAdminAction("catalog.write", setProductOpensAsSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const product = await requireProductRow(data.productId, db);

    if (productFormatOf(product) === "formacao") {
      throw new CatalogRuleError(FORMATION_OPENS_AS);
    }

    // So a chave coursePresentationMode muda (RPC atomica admin_patch_product_settings).
    await patchProductSettings(product.id, { set: { coursePresentationMode: data.mode } }, db);
    invalidateCatalog({ from: "action" });

    return { mode: data.mode, productId: product.id };
  });
}

/** Le a vitrine, aplica a fileira e grava com a versao lida. Devolve o estado novo. */
async function writeHomeModuleRow(desired: { enabled: boolean; productId: string; title?: string }) {
  const data = await getStorefrontEditorData();
  const product = data.products.find((item) => item.id === desired.productId);
  const blocker = homeModuleRowBlocker(product);

  if (!product || blocker) {
    throw new HomeModuleRowRuleError(blocker ?? "Este produto não pode ter fileira na home.");
  }

  const applied = applyHomeModuleRow(data.sections, product, desired);

  if (!applied.changed) {
    // Ja esta como o produtor quer (inclusive desligar algo que nunca foi ligado): nada a gravar.
    return computeHomeModuleRowState(product, applied.sections, data.sectionsConfigured);
  }

  // Vitrine nunca publicada: a primeira gravacao fixa a ordem padrao atual mais a fileira.
  await writePlatformSettingGuarded("homeSections", applied.sections, data.sectionsConfigured ? data.sectionsUpdatedAt : null);

  return computeHomeModuleRowState(product, applied.sections, true);
}

/**
 * [storefront.write] Liga/desliga a fileira de modulos do produto na home (a Vitrine e a fonte da
 * verdade) e, opcionalmente, troca o titulo. Espelha content_page_settings.homeModuleSection para o
 * admin antigo.
 */
export async function setHomeModuleRow(input: SetHomeModuleRowInput): Promise<ActionResult<HomeModuleRowState>> {
  return runAdminAction("storefront.write", setHomeModuleRowSchema, input, async ({ input: data }) => {
    let state: HomeModuleRowState;

    try {
      state = await writeHomeModuleRow(data);
    } catch (error) {
      if (!(error instanceof MemberAreaConflictError)) {
        throw error;
      }

      // Alguem gravou a vitrine entre a leitura e a gravacao: relemos e tentamos uma vez.
      state = await writeHomeModuleRow(data);
    }

    try {
      await patchProductSettings(
        data.productId,
        data.enabled ? { set: { homeModuleSection: { enabled: true } } } : { unset: ["homeModuleSection"] }
      );
    } catch (error) {
      // O espelho so serve ao admin antigo: a fileira ja esta gravada na vitrine, que e o que o aluno ve.
      console.error("[area-de-membros/modulos] espelho de homeModuleSection", error);
    }

    invalidateMemberArea("home", { from: "action" });

    return state;
  });
}
