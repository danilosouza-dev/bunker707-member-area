// Regras puras da foto do perfil (sem "server-only", sem Supabase): o que o servidor aceita e qual
// arquivo antigo pode ser apagado. Testado em tests/student-avatar.test.mjs.

import { AVATAR_MAX_BYTES, AVATAR_MAX_DATA_URL_LENGTH, AVATAR_MIN_SOURCE_SIZE, AVATAR_OUTPUT_SIZE, AVATAR_STORAGE_FOLDER } from "../../lib/avatar-image";
import { readWebpDimensions } from "../catalog/webp";

const WEBP_DATA_URL_PREFIX = "data:image/webp;base64,";
const PUBLIC_OBJECT_PATH = "/storage/v1/object/public/content-assets/";

/** Bytes de um data URL WebP; null quando nao e WebP em base64 ou passa do teto de texto. */
export function decodeAvatarDataUrl(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || !value.startsWith(WEBP_DATA_URL_PREFIX) || value.length > AVATAR_MAX_DATA_URL_LENGTH) {
    return null;
  }

  const payload = value.slice(WEBP_DATA_URL_PREFIX.length);

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
    return null;
  }

  try {
    return Uint8Array.from(atob(payload), (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

/** Motivo para recusar a foto (frase para o aluno); null quando serve. */
export function describeAvatarImageProblem(bytes: Uint8Array | null): string | null {
  if (!bytes || bytes.length === 0) {
    return "Envie a foto recortada em WebP. Escolha a imagem de novo.";
  }

  if (bytes.length > AVATAR_MAX_BYTES) {
    return "A foto ficou grande demais. Escolha outra imagem ou aumente o zoom.";
  }

  const size = readWebpDimensions(bytes);

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
 * Caminho no bucket (avatars/{userId}/arquivo.webp) de uma foto enviada por este aluno, para apagar a
 * antiga quando ele troca ou remove. Qualquer outro endereco (outra pasta, outro aluno, link externo)
 * devolve null e nada e apagado.
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
