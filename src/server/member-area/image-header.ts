// Largura e altura lidas no cabecalho de PNG e JPEG (o WebP fica em src/server/catalog/webp.ts), para o
// servidor conferir a foto do perfil sem decodificar a imagem nem confiar no tipo declarado pelo
// navegador. Modulo puro (sem Buffer, sem "server-only"), testado em tests/student-avatar.test.mjs.

import type { AvatarMimeType } from "../../lib/avatar-image";
import { readWebpDimensions } from "../catalog/webp";

export type ImageDimensions = { height: number; width: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function readUint16BE(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32BE(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

/** Assinatura de 8 bytes e chunk IHDR (comprimento, "IHDR", largura e altura big-endian). */
export function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 24 || PNG_SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    return null;
  }

  if (String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== "IHDR") {
    return null;
  }

  const width = readUint32BE(bytes, 16);
  const height = readUint32BE(bytes, 20);

  return width > 0 && height > 0 ? { height, width } : null;
}

/**
 * Segmentos do JPEG a partir de SOI (ff d8): "ff marcador comprimento ..." ate um SOFn (c0 a cf, menos
 * c4, c8 e cc), que traz precisao (1 byte), altura e largura (2 bytes cada, big-endian). Chegar aos
 * dados (SOS) ou ao fim (EOI) sem SOF, ou um byte fora do lugar, devolve null.
 */
export function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let offset = 2;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      return null;
    }

    const marker = bytes[offset + 1];

    if (marker === 0xff) {
      // Enchimento entre segmentos.
      offset += 1;
      continue;
    }

    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      // Marcadores sem comprimento (TEM, SOI, RSTn).
      offset += 2;
      continue;
    }

    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }

    const length = readUint16BE(bytes, offset + 2);

    if (length < 2) {
      return null;
    }

    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      if (offset + 8 >= bytes.length) {
        return null;
      }

      const height = readUint16BE(bytes, offset + 5);
      const width = readUint16BE(bytes, offset + 7);

      return width > 0 && height > 0 ? { height, width } : null;
    }

    offset += 2 + length;
  }

  return null;
}

/** Medidas pelo cabecalho do formato declarado; bytes de outro formato (ou lixo) devolvem null. */
export function readImageDimensions(bytes: Uint8Array, mimeType: AvatarMimeType): ImageDimensions | null {
  switch (mimeType) {
    case "image/webp":
      return readWebpDimensions(bytes);
    case "image/png":
      return readPngDimensions(bytes);
    case "image/jpeg":
      return readJpegDimensions(bytes);
    default:
      return null;
  }
}
