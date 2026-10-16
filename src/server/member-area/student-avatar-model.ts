// Regras puras da foto do perfil (sem "server-only", sem Supabase): o que o servidor aceita e qual
// arquivo antigo pode ser apagado. Testado em tests/student-avatar.test.mjs.

import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_DATA_URL_LENGTH,
  AVATAR_MIN_SOURCE_SIZE,
  AVATAR_OUTPUT_SIZE,
  AVATAR_STORAGE_FOLDER,
  avatarDataUrlType,
  type AvatarMimeType
} from "../../lib/avatar-image";
import { readImageDimensions } from "./image-header";

const PUBLIC_OBJECT_PATH = "/storage/v1/object/public/content-assets/";

export type DecodedAvatar = { bytes: Uint8Array; mimeType: AvatarMimeType };

/**
 * Bytes e tipo de um data URL base64 em WebP, JPEG ou PNG (o que cada navegador consegue gerar;
 * ver AVATAR_FORMATS); null para outro formato ou acima do teto de texto.
 */
export function decodeAvatarDataUrl(value: unknown): DecodedAvatar | null {
  if (typeof value !== "string" || value.length > AVATAR_MAX_DATA_URL_LENGTH) {
    return null;
  }

  const mimeType = avatarDataUrlType(value);

  if (!mimeType) {
    return null;
  }

  const payload = value.slice(value.indexOf(",") + 1);

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
    return null;
  }

  try {
    return { bytes: Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)), mimeType };
  } catch {
    return null;
  }
}

/** Motivo para recusar a foto (frase para o aluno); null quando serve. */
export function describeAvatarImageProblem(image: DecodedAvatar | null): string | null {
  if (!image || image.bytes.length === 0) {
    return "Envie a foto recortada (WebP, JPG ou PNG). Escolha a imagem de novo.";
  }

  if (image.bytes.length > AVATAR_MAX_BYTES) {
    return "A foto ficou grande demais. Escolha outra imagem ou aumente o zoom.";
  }

  // Le o cabecalho do formato declarado: bytes de outro formato nao passam.
  const size = readImageDimensions(image.bytes, image.mimeType);

  if (!size) {
    return "Não conseguimos ler esta foto. Escolha a imagem de novo.";
  }

  if (Math.abs(size.width - size.height) > 1) {
    return "A foto precisa ser quadrada. Escolha a imagem de novo.";
  }

  if (size.width < AVATAR_MIN_SOURCE_SIZE || size.width > AVATAR_OUTPUT_SIZE) {
    return `A foto precisa ter entre ${AVATAR_MIN_SOURCE_SIZE} e ${AVATAR_OUTPUT_SIZE} px.`;
  }

  return null;
}

/**
 * Caminho no bucket (avatars/{userId}/arquivo.webp, .jpg ou .png) de uma foto enviada por este aluno,
 * para apagar a antiga quando ele troca ou remove. Qualquer outro endereco (outra pasta, outro aluno,
 * link externo) devolve null e nada e apagado.
 */
export function avatarObjectPathFromUrl(url: string | null | undefined, userId: string): string | null {
  if (!url || !userId) {
    return null;
  }

  let pathname: string;

  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const start = pathname.indexOf(PUBLIC_OBJECT_PATH);

  if (start < 0) {
    return null;
  }

  const objectPath = decodeURIComponent(pathname.slice(start + PUBLIC_OBJECT_PATH.length));
  const ownFolder = `${AVATAR_STORAGE_FOLDER}/${userId}/`;

  return objectPath.startsWith(ownFolder) && !objectPath.slice(ownFolder.length).includes("/") && !objectPath.includes("..")
    ? objectPath
    : null;
}
