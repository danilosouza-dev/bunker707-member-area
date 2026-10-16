import assert from "node:assert/strict";
import test from "node:test";

// Legenda da plataforma (player da aula e TV): qual frase mostrar em cada instante do video.

const { findActiveCaptionCue } = await import("../src/lib/media-captions.ts");

const frases = [
  { durationSeconds: 4, startSeconds: 10, text: "frase antiga" },
  { durationSeconds: 3, startSeconds: 12, text: "frase atual" },
  { durationSeconds: 1, startSeconds: 20, text: "depois da lacuna" }
];

test("entre duas frases que se sobrepoem, vale a mais nova; antes da primeira e nas lacunas nao ha legenda", () => {
  assert.equal(findActiveCaptionCue(frases, 9.8), null, "antes da primeira frase");
  assert.equal(findActiveCaptionCue(frases, 10)?.text, "frase antiga");
  assert.equal(findActiveCaptionCue(frases, 12.5)?.text, "frase atual", "a frase que comecou por ultimo ganha");
  assert.equal(findActiveCaptionCue(frases, 16), null, "lacuna entre as frases");
  assert.equal(findActiveCaptionCue(frases, 20)?.text, "depois da lacuna");
  assert.equal(findActiveCaptionCue(frases, 21.5), null, "depois da ultima frase");
});

test("sem frases, nao ha legenda", () => {
  assert.equal(findActiveCaptionCue([], 5), null);
});
