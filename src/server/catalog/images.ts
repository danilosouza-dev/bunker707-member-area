import "server-only";

import { persistImageAsset } from "@/server/db/media-assets";
import { CatalogFieldError } from "./errors";
import { checkProductImage, decodeWebpDataUrl, type ProductImageSlot } from "./webp";

export { readWebpDimensions } from "./webp";

/**
 * Capa (720×1040) ou hero (1920×720) do produto. Recebe o WebP recortado no cliente (data URL) ou um
 * link https colado; confere a medida no cabecalho do WebP, envia ao Storage (bucket de conteudo, mesmo
 * caminho do admin legado) e devolve so a URL publica. Data URL nunca chega ao banco.
 * `null`/vazio = remover a imagem.
 */
export async function persistProductImage(
  slot: ProductImageSlot,
  productId: string,
  input: string | null | undefined,
  field = "image"
): Promise<string | null> {
  const value = input?.trim();

  if (!value) {
    return null;
  }

  if (!value.startsWith("data:")) {
    // Link https ja validado pelo schema (httpsUrlSchema): a imagem fica onde esta.
    return value;
  }

  const check = checkProductImage(slot, decodeWebpDataUrl(value));

  if (!check.ok) {
    throw new CatalogFieldError(field, check.message);
  }

  const url = await persistImageAsset(value, `content/${productId}/${slot}`);

  if (!url || url.startsWith("data:")) {
    throw new Error("Imagem do produto nao foi enviada ao armazenamento.");
  }

  return url;
}
