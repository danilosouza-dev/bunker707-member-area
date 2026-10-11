// Regras puras da aba Regras (respostas rapidas e palavras bloqueadas). Sem React:
// tests/community-queue.test.mjs carrega este arquivo direto.

import { normalizeCommentForModeration } from "../../../../server/comments/comment-validation";

/** Insere um marcador ({nome}, {aula}) na posicao do cursor, trocando o trecho selecionado. */
export function insertAtCursor(text: string, token: string, selectionStart: number, selectionEnd: number) {
  const start = Math.max(0, Math.min(text.length, Math.trunc(selectionStart)));
  const end = Math.max(start, Math.min(text.length, Math.trunc(selectionEnd)));
  const value = `${text.slice(0, start)}${token}${text.slice(end)}`;

  return { cursor: start + token.length, value };
}

/** "3 ativas de 5", "1 ativa", "Nenhuma palavra". */
export function describeBlockedWordCount(words: readonly { active: boolean }[]) {
  if (words.length === 0) {
    return "Nenhuma palavra";
  }

  const active = words.filter((word) => word.active).length;
  const activeLabel = active === 1 ? "1 ativa" : `${active} ativas`;

  return active === words.length ? activeLabel : `${activeLabel} de ${words.length}`;
}

/**
 * O termo ja esta na lista? Mesma normalizacao do bloqueio na publicacao do aluno (sem acento,
 * minusculas, so letras e numeros), para avisar no proprio campo antes de enviar.
 */
export function isDuplicateBlockedTerm(value: string, words: readonly { word: string }[]) {
  const normalized = normalizeCommentForModeration(value);

  return Boolean(normalized) && words.some((word) => normalizeCommentForModeration(word.word) === normalized);
}
