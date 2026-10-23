// Editor Livre do pop-up (docs/27; spec §4.8): desfazer e refazer. Pilhas de passado e futuro de `{ cta, design }`
// juntos (excluir o Botão principal e desfazer devolve os dois), com estrutura compartilhada (nada de copia funda:
// cada passo guarda as referencias que o editor ja tinha), ate 100 passos. Edicoes do mesmo campo do mesmo
// elemento em menos de 700 ms viram um passo so (chave "idDoElemento:campo"; o texto e o destino do Botão principal
// usam "botao:cta.label" e "botao:cta.href"). Um arrastar = um passo (gravado no fim); aplicar modelo, reescalar
// pela largura e Recuperar = um passo cada (sem chave).
//
// Modulo puro, imports relativos (tests/popup-livre-editor-modelo.test.mjs carrega direto pelo Node).

import type { NoticeDraft } from "../../../../../server/communications/schemas";
import type { PopupFreeDesign } from "../../../../../server/communications/popup-free-model";

export type FreeHistoryEntry = { cta: NoticeDraft["cta"]; design: PopupFreeDesign };

export type FreeHistory = {
  future: readonly FreeHistoryEntry[];
  /** Momento (ms) do ultimo passo com chave, para juntar edicoes seguidas do mesmo campo. */
  lastAt: number;
  /** Chave do ultimo passo (null = o proximo nunca junta). */
  lastKey: string | null;
  past: readonly FreeHistoryEntry[];
  present: FreeHistoryEntry;
};

export const FREE_HISTORY_LIMIT = 100;
export const FREE_HISTORY_COALESCE_MS = 700;

export function createFreeHistory(present: FreeHistoryEntry): FreeHistory {
  return { future: [], lastAt: 0, lastKey: null, past: [], present };
}

/**
 * Um passo novo. Igual ao presente (mesmas referencias) = nada muda. Com `coalesceKey` igual a do ultimo passo e
 * menos de 700 ms depois, troca o presente sem criar passo (o passado fica como estava, o futuro some).
 */
export function pushFreeHistory(history: FreeHistory, next: FreeHistoryEntry, options: { coalesceKey?: string | null; now?: number } = {}): FreeHistory {
  if (next.design === history.present.design && next.cta === history.present.cta) {
    return history;
  }

  const now = options.now ?? Date.now();
  const key = options.coalesceKey ?? null;

  if (key !== null && history.lastKey === key && now - history.lastAt < FREE_HISTORY_COALESCE_MS && history.past.length > 0) {
    return { future: [], lastAt: now, lastKey: key, past: history.past, present: next };
  }

  const past = [...history.past, history.present];

  return {
    future: [],
    lastAt: now,
    lastKey: key,
    past: past.length > FREE_HISTORY_LIMIT ? past.slice(past.length - FREE_HISTORY_LIMIT) : past,
    present: next
  };
}

export function canUndoFreeHistory(history: FreeHistory) {
  return history.past.length > 0;
}

export function canRedoFreeHistory(history: FreeHistory) {
  return history.future.length > 0;
}

export function undoFreeHistory(history: FreeHistory): FreeHistory {
  if (history.past.length === 0) {
    return history;
  }

  const present = history.past[history.past.length - 1];

  return { future: [history.present, ...history.future], lastAt: 0, lastKey: null, past: history.past.slice(0, -1), present };
}

export function redoFreeHistory(history: FreeHistory): FreeHistory {
  if (history.future.length === 0) {
    return history;
  }

  const [present, ...future] = history.future;

  return { future, lastAt: 0, lastKey: null, past: [...history.past, history.present], present };
}
