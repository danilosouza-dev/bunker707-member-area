// Foto do perfil do aluno: medidas e formatos compartilhados pelo recorte no navegador
// (src/components/member/profile/profile-avatar-editor.tsx) e pela checagem no servidor
// (src/server/member-area/student-avatar-model.ts). Modulo puro, sem dependencias; a escolha do
// formato e testada em tests/student-avatar.test.mjs.

/** Saida do recorte: quadrado de 512 px (nitido ate em telas 3x no maior avatar, de 80 px). */
export const AVATAR_OUTPUT_SIZE = 512;
/** Menor imagem aceita (lado menor da origem). Abaixo disso a foto fica borrada. */
export const AVATAR_MIN_SOURCE_SIZE = 160;
/** Alvo de tamanho do arquivo: a qualidade desce ate caber. */
export const AVATAR_TARGET_BYTES = 90 * 1024;
/** Teto do arquivo aceito pelo servidor, em qualquer formato. */
export const AVATAR_MAX_BYTES = 160 * 1024;
/** Teto do texto do data URL (base64 de AVATAR_MAX_BYTES com folga para o prefixo). */
export const AVATAR_MAX_DATA_URL_LENGTH = 220_000;
/** Arquivo de origem: acima disso o navegador sofre para decodificar. */
export const AVATAR_MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024;
/** Pasta no bucket publico content-assets: avatars/{id do usuario}/{hash}.webp, .jpg ou .png. */
export const AVATAR_STORAGE_FOLDER = "avatars";

/**
 * Formatos que o servidor aceita, com a extensao no bucket. O navegador tenta WebP (Chrome, Edge e
 * Firefox); o WebKit (Safari e todo navegador no iPhone e iPad) nao gera WebP pelo canvas e devolve
 * PNG no lugar, entao la a foto sai em JPEG. PNG so quando nem JPEG sai, o que nenhum navegador
 * atual faz: toDataURL sempre gera PNG, por especificacao.
 */
export const AVATAR_FORMATS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export type AvatarMimeType = keyof typeof AVATAR_FORMATS;

/** Qualidade inicial 0,82, descendo ate caber no alvo (vale para WebP e JPEG). */
export const AVATAR_QUALITY_STEPS = [0.82, 0.76, 0.7, 0.64, 0.58, 0.52, 0.46] as const;
/**
 * Quando nem a menor qualidade cabe no teto (so acontece em PNG, que nao comprime foto), o recorte
 * e gerado de novo nestas medidas, da maior para a menor, ate caber.
 */
export const AVATAR_SMALLER_SIZES = [384, 256, AVATAR_MIN_SOURCE_SIZE] as const;
/**
 * Fundo pintado antes da foto no canvas: JPEG nao tem transparencia, e assim uma origem PNG
 * transparente fica igual em todo formato (a mesma cor que o avatar tem atras da foto, zinc-800).
 */
export const AVATAR_BACKGROUND_COLOR = "#27272a";

const AVATAR_DATA_URL_PATTERN = /^data:(image\/(?:jpeg|png|webp));base64,/;

/** Tipo de um data URL base64 nos formatos aceitos; null para qualquer outra coisa. */
export function avatarDataUrlType(value: string): AvatarMimeType | null {
  const match = AVATAR_DATA_URL_PATTERN.exec(value);

  return match ? (match[1] as AvatarMimeType) : null;
}

/** Bytes do arquivo representado por um data URL base64. */
export function avatarDataUrlByteLength(dataUrl: string) {
  const comma = dataUrl.indexOf(",");
  const payload = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;

  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

/** canvas.toDataURL: devolve o data URL no tipo pedido ou, se o navegador nao gera esse tipo, PNG. */
export type AvatarEncoder = (type: AvatarMimeType, quality: number) => string;

export type AvatarEncodingResult =
  | { dataUrl: string; mimeType: AvatarMimeType; ok: true }
  | { error: "too_large" | "unsupported"; ok: false };

function pickWithinLimits(attempts: readonly string[], mimeType: AvatarMimeType): AvatarEncodingResult {
  const fitting = attempts.find((attempt) => avatarDataUrlByteLength(attempt) <= AVATAR_TARGET_BYTES);
  const smallest = fitting ?? [...attempts].sort((left, right) => left.length - right.length)[0];

  return avatarDataUrlByteLength(smallest) <= AVATAR_MAX_BYTES ? { dataUrl: smallest, mimeType, ok: true } : { error: "too_large", ok: false };
}

/**
 * Escolhe o arquivo final com o que o canvas consegue gerar: WebP em qualidade decrescente ate
 * caber no alvo; se o navegador devolver outro formato no lugar (WebKit), a mesma escada em JPEG;
 * se nem JPEG sair, o PNG que veio. Dentro do alvo (AVATAR_TARGET_BYTES) vale a primeira tentativa
 * que coube; senao a menor, desde que passe no teto do servidor (AVATAR_MAX_BYTES).
 */
export function encodeAvatar(encode: AvatarEncoder): AvatarEncodingResult {
  let fallback: string | null = null;

  for (const type of ["image/webp", "image/jpeg"] as const) {
    const attempts: string[] = [];

    for (const quality of AVATAR_QUALITY_STEPS) {
      const encoded = encode(type, quality);

      if (avatarDataUrlType(encoded) !== type) {
        // Navegador sem este formato: guarda o que veio (PNG) para o fim e tenta o proximo formato.
        fallback ??= encoded;
        break;
      }

      attempts.push(encoded);

      if (avatarDataUrlByteLength(encoded) <= AVATAR_TARGET_BYTES) {
        break;
      }
    }

    if (attempts.length > 0) {
      return pickWithinLimits(attempts, type);
    }
  }

  return fallback && avatarDataUrlType(fallback) === "image/png" ? pickWithinLimits([fallback], "image/png") : { error: "unsupported", ok: false };
}
