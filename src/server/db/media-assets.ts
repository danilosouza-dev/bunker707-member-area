import "server-only";

import { createHash } from "node:crypto";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

const contentAssetsBucket = "content-assets";
const maxImageBytes = 8 * 1024 * 1024;
const supportedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

function parseImageDataUrl(value: string) {
  const match = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i.exec(value);

  if (!match) {
    return null;
  }

  const mimeType = match[1].toLowerCase();
  const extension = supportedImageTypes.get(mimeType);

  if (!extension) {
    throw new Error("Formato de imagem nao suportado. Use JPG, PNG ou WebP.");
  }

  const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");

  if (bytes.length === 0 || bytes.length > maxImageBytes) {
    throw new Error("A imagem deve ter no maximo 8 MB.");
  }

  return { bytes, extension, mimeType };
}

function sanitizePathSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

export function isInlineImage(value: string | null | undefined) {
  return Boolean(value?.startsWith("data:image/"));
}

/** O objeto que o envio vai gravar (bucket e caminho; o nome vem do conteudo). */
export type ImageAssetObject = { bucket: string; path: string };

/**
 * Grava a imagem inline (data URL) no content-assets com nome pelo conteudo e devolve a URL publica (valor que nao e
 * imagem inline volta como veio). `beforeUpload` roda com o caminho final antes do envio: a Comunicacao usa para
 * conferir a marca da limpeza dos arquivos (docs/22 §4.6); se falhar, nada e enviado.
 */
export async function persistImageAsset(
  value: string | null | undefined,
  ownerPath: string,
  options: { beforeUpload?: (object: ImageAssetObject) => Promise<void> } = {}
) {
  const normalizedValue = value?.trim();

  if (!normalizedValue || !isInlineImage(normalizedValue)) {
    return normalizedValue ?? "";
  }

  const parsed = parseImageDataUrl(normalizedValue);

  if (!parsed) {
    return normalizedValue;
  }

  const hash = createHash("sha256").update(parsed.bytes).digest("hex").slice(0, 24);
  const safeOwnerPath = ownerPath
    .split("/")
    .map(sanitizePathSegment)
    .filter(Boolean)
    .join("/");
  const objectPath = `${safeOwnerPath}/${hash}.${parsed.extension}`;
  const supabase = getSupabaseAdminClient();

  await options.beforeUpload?.({ bucket: contentAssetsBucket, path: objectPath });

  const uploadResult = await supabase.storage
    .from(contentAssetsBucket)
    .upload(objectPath, parsed.bytes, {
      cacheControl: "31536000",
      contentType: parsed.mimeType,
      upsert: false
    });

  if (uploadResult.error && !/already exists|duplicate/i.test(uploadResult.error.message)) {
    throw new Error(`Nao foi possivel enviar a imagem para o Storage: ${uploadResult.error.message}`);
  }

  return supabase.storage.from(contentAssetsBucket).getPublicUrl(objectPath).data.publicUrl;
}

