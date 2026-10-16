import assert from "node:assert/strict";
import test from "node:test";

// Contrato da sessao de TV (puro, sem React nem banco): quais velocidades o controle remoto aceita e
// como a lista vinda do player da TV e normalizada. Usado pela rota de comandos, pelo receptor e pelo
// controle da aula; os fluxos completos estao em tests/integration/modo-tv.test.mjs.

const { TV_PLAYBACK_RATES, isTvPlaybackRate, normalizeTvPlaybackRates } = await import("../src/lib/tv-session-contract.ts");

test("as velocidades da TV vao de 0,25x a 2x, de quarto em quarto", () => {
  assert.deepEqual([...TV_PLAYBACK_RATES], [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
});

test("so velocidade da lista e aceita: 1x e 1,5x sim; 3x, zero, texto, NaN e infinito nao", () => {
  assert.equal(isTvPlaybackRate(1), true);
  assert.equal(isTvPlaybackRate(1.5), true);

  for (const value of [3, 0, "1.5", Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) {
    assert.equal(isTvPlaybackRate(value), false, `${String(value)} nao e velocidade da TV`);
  }
});

test("a lista do player da TV e limpa: texto vira numero, repetidas e invalidas saem, ordem crescente", () => {
  assert.deepEqual(normalizeTvPlaybackRates([2, "1.5", 1, 1, 3, "x", 0.5]), [0.5, 1, 1.5, 2]);
});

test("sem lista valida, a TV fica so com a velocidade normal (1x)", () => {
  assert.deepEqual(normalizeTvPlaybackRates([]), [1]);
  assert.deepEqual(normalizeTvPlaybackRates([3, "rapido"]), [1]);
  assert.deepEqual(normalizeTvPlaybackRates("nao e lista"), [1]);
  assert.deepEqual(normalizeTvPlaybackRates(undefined), [1]);
});
