import assert from "node:assert/strict";
import test from "node:test";

// Regras puras dos comentarios da aula (sem banco): normalizacao para moderacao, termos bloqueados
// sem falso positivo por pedaco de palavra, limpeza e limite do texto. O fluxo com banco esta em
// tests/integration/comentarios-aula.test.mjs e no navegador em tests/e2e/aluno-comenta-na-aula.spec.ts.

const {
  containsBlockedTerm,
  normalizeCommentForModeration,
  sanitizeLessonCommentBody,
  validateLessonCommentBody
} = await import("../src/server/comments/comment-validation.ts");

test("normaliza acentos, caixa e pontuacao para a moderacao comparar", () => {
  assert.equal(normalizeCommentForModeration("  DÚVIDA: sobre IA!!!  "), "duvida sobre ia");
});

test("termo bloqueado vale por palavra ou frase inteira, nunca por pedaco de outra palavra", () => {
  assert.equal(containsBlockedTerm("Esse termo proibido apareceu aqui", "termo proibido"), true);
  assert.equal(containsBlockedTerm("A classificacao ficou clara", "ass"), false, "'ass' dentro de 'classificacao' nao bloqueia");
  assert.equal(containsBlockedTerm("Uma DÚVIDA importante", "duvida"), true, "acento e caixa nao importam");
});

test("limpa caracteres de controle e valida vazio e o limite de 2000 letras", () => {
  assert.equal(sanitizeLessonCommentBody("  linha 1\r\nlinha\u0000 2  "), "linha 1\nlinha 2");
  assert.equal(validateLessonCommentBody("   ").error, "Escreva um comentario antes de enviar.");
  assert.match(validateLessonCommentBody("x".repeat(2001)).error ?? "", /2000/);
  assert.equal(validateLessonCommentBody("Comentario valido").error, null);
});
