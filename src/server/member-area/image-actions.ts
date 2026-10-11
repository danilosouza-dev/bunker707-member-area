"use server";

// Upload de imagem da Area de membros (destaque da home, imagem lateral e de fundo do login). O
// editor recorta no navegador (WebP na medida do slot), chama esta acao logo depois do recorte e guarda
// no rascunho so a URL publica devolvida; quem grava a configuracao (saveLoginPage, saveHomeHero)
// recebe apenas URLs. Nada vai para o banco aqui: imagem enviada e descartada fica no Storage sem
// referencia (arquivo pequeno, nome pelo hash do conteudo, reenviar a mesma imagem nao duplica).

import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { checkProductImage, decodeWebpDataUrl } from "@/server/catalog/webp";
import { persistImageAsset } from "@/server/db/media-assets";
import { MemberAreaFieldError } from "./errors";
import {
  MEMBER_AREA_UPLOAD_FOLDERS,
  uploadMemberAreaImageSchema,
  type MemberAreaImageUploaded,
  type UploadMemberAreaImageInput
} from "./schemas";

/** [storefront.write] Confere medida e tamanho no cabecalho do WebP, envia ao Storage e devolve a URL. */
export async function uploadMemberAreaImage(input: UploadMemberAreaImageInput): Promise<ActionResult<MemberAreaImageUploaded>> {
  return runAdminAction("storefront.write", uploadMemberAreaImageSchema, input, async ({ input: data }) => {
    const check = checkProductImage(data.slot, decodeWebpDataUrl(data.image));

    if (!check.ok) {
      throw new MemberAreaFieldError("image", check.message);
    }

    const url = (await persistImageAsset(data.image, MEMBER_AREA_UPLOAD_FOLDERS[data.slot])).trim();

    if (!/^https:\/\//i.test(url)) {
      throw new Error("Imagem da área de membros não foi enviada ao armazenamento.");
    }

    return { slot: data.slot, url };
  });
}
