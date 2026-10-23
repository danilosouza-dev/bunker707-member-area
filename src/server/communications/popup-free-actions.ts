"use server";

// Server Action do design Livre (docs/27 §5.2): o envio de imagem (qualquer proporcao, com transparencia). O
// editor converte JPG/PNG/WebP em WebP no navegador (lado maior ate 1.600 px, ate 420.000 bytes); o servidor nao
// confia nisso: le o cabecalho do WebP, confere lados e tamanho e grava em
// content-assets/communications/free/<24 hex do sha256>.webp. Devolve so o caminho e as medidas do servidor
// (o design nunca guarda endereco; o editor monta a previa com freeAssetUrl). messaging.write.

import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { decodeWebpDataUrl, readWebpDimensions } from "@/server/catalog/webp";
import { persistImageAsset } from "@/server/db/media-assets";
import { communicationsDb, NoticeFieldError } from "./db";
import { forgetOrphanMark } from "./media-cleanup";
import { storagePublicPath } from "./popup-design-model";
import { FREE_DESIGN_LIMITS } from "./popup-free-model";
import { FREE_IMAGE_BUCKET, FREE_IMAGE_PATH_PATTERN } from "./popup-free-render";
import { POPUP_FREE_MESSAGES } from "./popup-free-schema";

/** 420.000 bytes em base64 (4/3) mais o prefixo do data URL. */
const MAX_IMAGE_DATA_URL = Math.ceil((FREE_DESIGN_LIMITS.imageBytes * 4) / 3) + 64;

const uploadImageSchema = z.object({
  image: z
    .string({ error: POPUP_FREE_MESSAGES.imageUploadFormat })
    .max(MAX_IMAGE_DATA_URL, POPUP_FREE_MESSAGES.imageUploadBytes)
    .regex(/^data:image\/webp;base64,[A-Za-z0-9+/=]+$/, POPUP_FREE_MESSAGES.imageUploadFormat)
});

export type PopupFreeImageUpload = { asset: { height: number; kind: "image"; path: string; width: number } };

/** [messaging.write] Grava a imagem WebP do Livre e devolve caminho e medidas lidas pelo servidor (sem endereco). */
export async function uploadPopupFreeImage(input: { image: string }): Promise<ActionResult<PopupFreeImageUpload>> {
  return runAdminAction("messaging.write", uploadImageSchema, input, async ({ input: data, user }) => {
    const bytes = decodeWebpDataUrl(data.image);

    if (!bytes || bytes.length === 0) {
      throw new NoticeFieldError("image", POPUP_FREE_MESSAGES.imageUploadFormat);
    }

    if (bytes.length > FREE_DESIGN_LIMITS.imageBytes) {
      throw new NoticeFieldError("image", POPUP_FREE_MESSAGES.imageUploadBytes);
    }

    const dimensions = readWebpDimensions(bytes);

    if (!dimensions) {
      throw new NoticeFieldError("image", POPUP_FREE_MESSAGES.imageUploadFormat);
    }

    const side = FREE_DESIGN_LIMITS.imageSide;

    if (dimensions.width < side.min || dimensions.width > side.max || dimensions.height < side.min || dimensions.height > side.max) {
      throw new NoticeFieldError("image", POPUP_FREE_MESSAGES.imageUploadSides);
    }

    const url = (await persistImageAsset(data.image, "communications/free")).trim();
    const marker = storagePublicPath(FREE_IMAGE_BUCKET, "");
    const index = url.indexOf(marker);
    const path = index === -1 ? "" : url.slice(index + marker.length).split(/[?#]/)[0];

    if (!FREE_IMAGE_PATH_PATTERN.test(path)) {
      throw new Error("Comunicacao: a imagem do Livre nao foi enviada ao armazenamento.");
    }

    // A mesma imagem enviada de novo cai no mesmo caminho: o prazo da limpeza recomeca (docs/22 §4.6).
    await forgetOrphanMark(communicationsDb(), { bucket: FREE_IMAGE_BUCKET, path });

    await recordAudit(communicationsDb(), {
      action: "communication.free_image_uploaded",
      actorId: user.id,
      entityId: null,
      entityType: "campaign_media",
      metadata: { height: dimensions.height, size_bytes: bytes.length, width: dimensions.width }
    });

    return { asset: { height: dimensions.height, kind: "image", path, width: dimensions.width } };
  });
}
