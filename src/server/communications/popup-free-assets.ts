import "server-only";

// Arquivos do design Livre (docs/27 §5.2): o design guarda so o caminho; ao salvar, todo caminho que a linha
// gravada ainda nao usa (storedPopupDesignAssetPaths: Livre e Personalizado) e conferido no Storage. Imagem:
// existe no content-assets, ate 420.000 bytes, gravada como WebP, e os primeiros 64 bytes (Range, cancelado sem
// esperar) sao WebP com as medidas do cabecalho; as medidas do servidor substituem as do navegador. Video: a
// mesma conferencia do Personalizado (inspectPopupVideo; o recusado e apagado). Arquivo que a linha gravada
// ainda usa nunca e conferido de novo nem apagado.

import { readWebpDimensions } from "@/server/catalog/webp";
import { CommunicationError, NoticeFieldError, type CommunicationsDb } from "./db";
import { storedPopupDesignAssetPaths } from "./popup-design-router";
import { FREE_DESIGN_LIMITS, type FreeAsset, type PopupFreeDesign } from "./popup-free-model";
import { FREE_IMAGE_BUCKET, FREE_IMAGE_PATH_PATTERN } from "./popup-free-render";
import { POPUP_FREE_MESSAGES } from "./popup-free-schema";
import { baseMimeType, inspectPopupVideo, isStorageNotFound, readFirstBytes } from "./popup-media";

/** Quantos bytes do comeco da imagem o servidor le (o cabecalho VP8/VP8L/VP8X cabe em 30). */
const FREE_IMAGE_SNIFF_BYTES = 64;

/**
 * Confere uma imagem do Livre no nosso bucket: caminho do padrao, objeto existente (404), ate 420.000 bytes
 * (413), gravado como WebP e com o cabecalho WebP de 16 a 1.600 px de cada lado (422). Devolve as medidas lidas
 * dos bytes. Nada e apagado (a imagem pode ser a de outro aviso).
 */
export async function inspectFreeImage(db: CommunicationsDb, objectPath: string): Promise<{ height: number; sizeBytes: number; width: number }> {
  const again = POPUP_FREE_MESSAGES.image;

  if (!FREE_IMAGE_PATH_PATTERN.test(objectPath)) {
    throw new CommunicationError(again, 400);
  }

  const storage = db.storage.from(FREE_IMAGE_BUCKET);
  const info = await storage.info(objectPath);

  if (info.error) {
    if (isStorageNotFound(info.error as { message?: string; status?: unknown; statusCode?: unknown })) {
      throw new CommunicationError(again, 404);
    }

    throw new Error(`Comunicacao: nao foi possivel ler a imagem do Livre no Storage: ${info.error.message}`);
  }

  const details = info.data as { contentType?: unknown; metadata?: { mimetype?: unknown; size?: unknown } | null; size?: unknown };
  const sizeBytes = Number(details.size ?? details.metadata?.size ?? 0);

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || baseMimeType(details.contentType ?? details.metadata?.mimetype) !== "image/webp") {
    throw new CommunicationError(again, 422);
  }

  if (sizeBytes > FREE_DESIGN_LIMITS.imageBytes) {
    throw new CommunicationError(again, 413);
  }

  let head: Uint8Array;

  try {
    head = await readFirstBytes(storage.getPublicUrl(objectPath).data.publicUrl, FREE_IMAGE_SNIFF_BYTES);
  } catch (error) {
    if (error instanceof CommunicationError) {
      throw new CommunicationError(again, error.status);
    }

    throw error;
  }

  const dimensions = readWebpDimensions(head);
  const side = FREE_DESIGN_LIMITS.imageSide;

  if (!dimensions || dimensions.width < side.min || dimensions.width > side.max || dimensions.height < side.min || dimensions.height > side.max) {
    throw new CommunicationError(again, 422);
  }

  return { height: dimensions.height, sizeBytes, width: dimensions.width };
}

function storedFreeImageSizes(value: unknown): Map<string, { height: number; width: number }> {
  const sizes = new Map<string, { height: number; width: number }>();

  if (!value || typeof value !== "object" || (value as { mode?: unknown }).mode !== "free") {
    return sizes;
  }

  for (const item of Array.isArray((value as { assets?: unknown }).assets) ? ((value as { assets: unknown[] }).assets) : []) {
    const asset = item as Partial<FreeAsset> | null;

    if (asset && asset.kind === "image" && typeof asset.path === "string" && Number.isInteger(asset.width) && Number.isInteger(asset.height)) {
      sizes.set(asset.path, { height: asset.height as number, width: asset.width as number });
    }
  }

  return sizes;
}

/**
 * Antes de gravar o Livre: cada arquivo novo conferido (400 em freeDesign.assets.<id> quando falta ou nao vale) e
 * as medidas das imagens trocadas pelas do servidor. `stored` = o popup_design da linha gravada (null num aviso
 * novo). Devolve o design com as medidas do servidor (o mesmo objeto quando nada muda).
 */
export async function assertPopupFreeAssets(db: CommunicationsDb, design: PopupFreeDesign, stored: unknown): Promise<PopupFreeDesign> {
  const storedPaths = new Set(storedPopupDesignAssetPaths(stored));
  const storedSizes = storedFreeImageSizes(stored);
  let changed = false;
  const assets: FreeAsset[] = [];

  for (const asset of design.assets) {
    if (asset.kind === "video") {
      if (!storedPaths.has(asset.path)) {
        try {
          const { video } = await inspectPopupVideo(db, asset.path);

          if (video.mimeType !== asset.mimeType) {
            throw new CommunicationError(POPUP_FREE_MESSAGES.video, 422);
          }
        } catch (error) {
          if (error instanceof CommunicationError) {
            throw new NoticeFieldError(`freeDesign.assets.${asset.id}`, POPUP_FREE_MESSAGES.video);
          }

          throw error;
        }
      }

      assets.push(asset);
      continue;
    }

    let size = storedSizes.get(asset.path);

    if (!size) {
      try {
        size = await inspectFreeImage(db, asset.path);
      } catch (error) {
        if (error instanceof CommunicationError) {
          throw new NoticeFieldError(`freeDesign.assets.${asset.id}`, POPUP_FREE_MESSAGES.image);
        }

        throw error;
      }
    }

    if (size.width !== asset.width || size.height !== asset.height) {
      changed = true;
      assets.push({ ...asset, height: size.height, width: size.width });
    } else {
      assets.push(asset);
    }
  }

  return changed ? { ...design, assets } : design;
}
