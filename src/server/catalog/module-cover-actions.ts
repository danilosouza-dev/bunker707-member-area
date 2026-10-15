"use server";

// Capa do modulo (aba Conteúdo, menu do modulo › "Trocar capa do módulo…"; docs/17 §1.6.3). Grava so
// course_modules.image daquele modulo. A capa aparece no card do modulo na pagina do curso e na
// fileira de modulos da home. O modulo nasce com uma copia da capa do produto (createModule); "Usar a
// capa do produto" grava de novo a capa atual do produto.

import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { invalidateCatalog } from "@/server/catalog/cache";
import { persistImageAsset } from "@/server/db/media-assets";
import { moduleUsesProductCover, productCoverForModule } from "../member-area/modules-model";
import { CatalogFieldError, CatalogNotFoundError } from "./errors";
import { MODULE_COLUMNS, coverUrlOf, type ModuleRow } from "./mappers";
import { setModuleCoverSchema } from "./schemas";
import { catalogDb, fetchModuleRow, requireProductRow, updateRowGuarded } from "./store";
import type { ModuleCoverSaved, SetModuleCoverInput } from "./types";
import { checkProductImage, decodeWebpDataUrl } from "./webp";

const MODULE_NOT_FOUND = "Não encontramos este módulo. Ele pode ter sido excluído.";

/**
 * [catalog.write] WebP 720×1040 (slot cover, recortado no cliente) ou link https; null = volta para a
 * capa do produto. Confere a medida no cabecalho do WebP, envia ao Storage e grava so a URL.
 */
export async function setModuleCover(input: SetModuleCoverInput): Promise<ActionResult<ModuleCoverSaved>> {
  return runAdminAction("catalog.content", setModuleCoverSchema, input, async ({ input: data }) => {
    const db = catalogDb();
    const current = await fetchModuleRow(data.moduleId, db);

    if (!current || !current.owner_id) {
      throw new CatalogNotFoundError(MODULE_NOT_FOUND);
    }

    const product = await requireProductRow(current.owner_id, db);
    let image: string;

    if (data.image === null) {
      image = productCoverForModule(product.image);
    } else if (data.image.startsWith("data:")) {
      const check = checkProductImage("cover", decodeWebpDataUrl(data.image));

      if (!check.ok) {
        throw new CatalogFieldError("image", check.message);
      }

      image = (await persistImageAsset(data.image, `content/${product.id}/modules/${current.id}`)).trim();

      if (!/^https:\/\//i.test(image)) {
        throw new Error("Capa do modulo nao foi enviada ao armazenamento.");
      }
    } else {
      // Link https ja validado pelo schema: a imagem fica onde esta.
      image = data.image;
    }

    const updated = await updateRowGuarded<ModuleRow>({
      columns: MODULE_COLUMNS,
      db,
      excludeDeleted: true,
      expectedUpdatedAt: data.expectedUpdatedAt,
      id: current.id,
      notFoundMessage: MODULE_NOT_FOUND,
      patch: { image },
      table: "course_modules"
    });

    invalidateCatalog({ from: "action" });

    return {
      coverUrl: coverUrlOf(updated.image),
      id: updated.id,
      updatedAt: updated.updated_at,
      usesProductCover: moduleUsesProductCover(updated.image, product.image)
    };
  }, { target: (data) => ({ moduleIds: [data.moduleId] }) });
}
