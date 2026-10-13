// Validacao das imagens enviadas pelo admin no servidor (docs/17 §2.3, "Imagens"). O cliente recorta e
// redimensiona (WebP ate 720×1080 para capa, 1920×720 para hero, alvo ≤ 150 KB; no login, 1200×1500 para a
// imagem lateral e 1920×1080 para a de fundo, alvo ≤ 250 KB); o servidor nao confia no navegador: le as
// dimensoes no cabecalho do WebP antes de enviar ao Storage. Modulo puro (sem Buffer, sem "server-only")
// para tests/catalog-server.test.mjs carregar direto pelo Node. As medidas sao as mesmas de IMAGE_SPECS
// (src/components/admin/v2/products/cover-crop.ts); tests/member-area-foundation.test.mjs confere.

export type ProductImageSlot = "cover" | "hero";
/** Slots aceitos pelo servidor: os do produto e os da Area de membros (login). */
export type ImageUploadSlot = ProductImageSlot | "loginSide" | "loginBackground";

/** width × height = saida do recorte; minWidth = menor origem aceita (o cliente nunca amplia, entao a imagem pode chegar menor). */
export type ImageUploadSpec = { height: number; label: string; maxBytes: number; minWidth: number; width: number };

/** Teto do arquivo decodificado (o schema limita o texto base64 a 300 mil caracteres, ~220 KB). */
export const MAX_PRODUCT_IMAGE_BYTES = 230 * 1024;
/** Teto das imagens grandes do login (o schema limita o texto base64 a 560 mil caracteres, ~410 KB). */
export const MAX_LARGE_IMAGE_BYTES = 420_000;

export const IMAGE_UPLOAD_SPECS: Record<ImageUploadSlot, ImageUploadSpec> = {
  cover: { height: 1080, label: "thumbnail do card", maxBytes: MAX_PRODUCT_IMAGE_BYTES, minWidth: 284, width: 720 },
  hero: { height: 720, label: "imagem de topo", maxBytes: MAX_PRODUCT_IMAGE_BYTES, minWidth: 1440, width: 1920 },
  loginBackground: { height: 1080, label: "imagem de fundo", maxBytes: MAX_LARGE_IMAGE_BYTES, minWidth: 1280, width: 1920 },
  loginSide: { height: 1500, label: "imagem lateral", maxBytes: MAX_LARGE_IMAGE_BYTES, minWidth: 800, width: 1200 }
};

export const PRODUCT_IMAGE_SPECS: Record<ProductImageSlot, ImageUploadSpec> = {
  cover: IMAGE_UPLOAD_SPECS.cover,
  hero: IMAGE_UPLOAD_SPECS.hero
};

function fourCC(bytes: Uint8Array, offset: number) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/**
 * Largura e altura de um WebP a partir do cabecalho RIFF. Entende os tres formatos do container:
 * VP8 (com perda), VP8L (sem perda) e VP8X (estendido, com canvas explicito). Qualquer outra coisa
 * (PNG, JPEG, arquivo cortado, lixo) devolve null.
 */
export function readWebpDimensions(bytes: Uint8Array): { height: number; width: number } | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 30) {
    return null;
  }

  if (fourCC(bytes, 0) !== "RIFF" || fourCC(bytes, 8) !== "WEBP") {
    return null;
  }

  const chunk = fourCC(bytes, 12);

  if (chunk === "VP8 ") {
    // Frame tag (3 bytes) + start code 9d 01 2a; depois largura e altura de 14 bits (2 bits de escala).
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }

    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff;
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff;

    return width > 0 && height > 0 ? { height, width } : null;
  }

  if (chunk === "VP8L") {
    // Assinatura 0x2f; depois 14 bits de (largura - 1) e 14 bits de (altura - 1), little-endian.
    if (bytes[20] !== 0x2f) {
      return null;
    }

    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));

    return { height, width };
  }

  if (chunk === "VP8X") {
    // Flags (1 byte) + 3 reservados; canvas de 24 bits (largura - 1) e 24 bits (altura - 1).
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));

    return { height, width };
  }

  return null;
}

const webpDataUrlPattern = /^data:image\/webp;base64,([A-Za-z0-9+/=]+)$/;

/** data:image/webp;base64,... -> bytes; qualquer outro formato devolve null. */
export function decodeWebpDataUrl(value: string): Uint8Array | null {
  const match = webpDataUrlPattern.exec(value.trim());

  if (!match) {
    return null;
  }

  try {
    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch {
    return null;
  }
}

export type ProductImageCheck = { ok: true; height: number; width: number } | { message: string; ok: false };

/**
 * Confere tamanho e medida do recorte: ate a saida do slot (720×1080 na capa, 1920×720 no hero, e os do
 * login), na mesma proporcao (1 px de arredondamento) e nunca abaixo da menor origem aceita.
 */
export function checkProductImage(slot: ImageUploadSlot, bytes: Uint8Array | null): ProductImageCheck {
  const spec = IMAGE_UPLOAD_SPECS[slot];

  if (!bytes || bytes.length === 0) {
    return { message: "Envie a imagem recortada (WebP).", ok: false };
  }

  if (bytes.length > spec.maxBytes) {
    return { message: "A imagem ficou grande demais. Recorte de novo.", ok: false };
  }

  const dimensions = readWebpDimensions(bytes);

  if (!dimensions) {
    return { message: "Envie a imagem recortada (WebP).", ok: false };
  }

  const sameRatio = Math.abs(dimensions.width * spec.height - dimensions.height * spec.width) <= spec.width;

  if (dimensions.width > spec.width || dimensions.height > spec.height || dimensions.width < spec.minWidth || !sameRatio) {
    return {
      message: `A ${spec.label} precisa ter até ${spec.width}×${spec.height} px, na proporção do recorte. Recorte de novo.`,
      ok: false
    };
  }

  return { height: dimensions.height, ok: true, width: dimensions.width };
}
