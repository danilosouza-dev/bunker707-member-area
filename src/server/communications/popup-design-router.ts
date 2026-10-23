// Leitura de campaigns.popup_design (docs/27 §2.1): a coluna guarda o Personalizado (sem `mode`) ou o Livre
// ({ mode: "free", version: 1, ... }). O roteador manda cada um ao schema dele (os dois sao estritos: um Livre
// nunca vira Personalizado por engano e vice-versa). Modulo puro (servidor e editor), imports relativos.

import { designFontIds, popupDesignMediaRefs } from "./media-refs";
import type { PopupDesign } from "./popup-design-model";
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
  return designFontIds(value);
}

/**
 * Caminhos de Storage do que esta gravado, sem validar a fundo: no Livre, `assets[].path`; no Personalizado, o
 * video da midia e a imagem do fundo do cartao (o caminho tirado do endereco). Para nunca apagar nem conferir de
 * novo um arquivo que a linha gravada ja usa. A mesma leitura (popupDesignMediaRefs, media-refs.ts) diz ao job
 * da limpeza o que esta em uso: um campo de arquivo novo entra la e vale para os dois.
 */
export function storedPopupDesignAssetPaths(value: unknown): string[] {
  return [...new Set(popupDesignMediaRefs(value).map((ref) => ref.path))];
}
