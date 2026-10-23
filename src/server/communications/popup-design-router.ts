// Leitura de campaigns.popup_design (docs/27 §2.1): a coluna guarda o Personalizado (sem `mode`) ou o Livre
// ({ mode: "free", version: 1, ... }). O roteador manda cada um ao schema dele (os dois sao estritos: um Livre
// nunca vira Personalizado por engano e vice-versa). Modulo puro (servidor e editor), imports relativos.

import type { PopupDesign } from "./popup-design-model";
import { POPUP_CARD_IMAGE_PATH_PATTERN, POPUP_VIDEO_PATH_PATTERN } from "./popup-design-model";
import { parsePopupDesign } from "./popup-design-schema";
import type { PopupFreeDesign } from "./popup-free-model";
import { parsePopupFreeDesign } from "./popup-free-schema";

export type StoredPopupDesign = { design: PopupDesign | null; freeDesign: PopupFreeDesign | null };
export type PopupDesignKind = "custom" | "default" | "free";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFree(value: unknown): value is Record<string, unknown> {
  return isObject(value) && value.mode === "free";
}

/** Leitura do banco: Livre (mode "free") pelo schema do Livre; o resto pelo do Personalizado. Invalido = os dois nulos. */
export function parseStoredPopupDesign(value: unknown): StoredPopupDesign {
  if (isFree(value)) {
    return { design: null, freeDesign: parsePopupFreeDesign(value) };
  }

  return { design: parsePopupDesign(value), freeDesign: null };
}

/** Para auditoria e listas: o que a linha tem (sem validar a fundo). */
export function popupDesignKindOf(value: unknown): PopupDesignKind {
  if (!isObject(value)) {
    return "default";
  }

  return value.mode === "free" ? "free" : "custom";
}

/** Ids das fontes enviadas do que esta gravado (Livre ou Personalizado; os dois guardam `fonts` na raiz). */
export function storedPopupDesignFontIds(value: unknown): string[] {
  if (!isObject(value) || !Array.isArray(value.fonts)) {
    return [];
  }

  return [...new Set(value.fonts.filter((id): id is string => typeof id === "string").map((id) => id.toLowerCase()))].sort();
}

/**
 * Caminhos de Storage do que esta gravado, sem validar a fundo: no Livre, `assets[].path`; no Personalizado, o
 * video da midia e a imagem do fundo do cartao (o caminho tirado do endereco). Para nunca apagar nem conferir de
 * novo um arquivo que a linha gravada ja usa.
 */
export function storedPopupDesignAssetPaths(value: unknown): string[] {
  if (!isObject(value)) {
    return [];
  }

  const paths = new Set<string>();

  if (value.mode === "free") {
    for (const item of Array.isArray(value.assets) ? value.assets : []) {
      if (isObject(item) && typeof item.path === "string") {
        paths.add(item.path);
      }
    }

    return [...paths];
  }

  const media = isObject(value.media) ? value.media : null;
  const video = media && isObject(media.video) ? media.video : null;

  if (video && typeof video.path === "string" && POPUP_VIDEO_PATH_PATTERN.test(video.path)) {
    paths.add(video.path);
  }

  const card = isObject(value.card) ? value.card : null;
  const background = card && isObject(card.background) ? card.background : null;

  if (background && background.kind === "image" && typeof background.url === "string") {
    const marker = "/storage/v1/object/public/content-assets/";
    const index = background.url.indexOf(marker);
    const path = index === -1 ? "" : background.url.slice(index + marker.length).split(/[?#]/)[0];

    if (POPUP_CARD_IMAGE_PATH_PATTERN.test(path)) {
      paths.add(path);
    }
  }

  return [...paths];
}
