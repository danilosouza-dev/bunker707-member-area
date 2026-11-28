import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guarda de arquitetura (docs/18): a proporcao da caixa do destaque por largura de janela mora no CSS global, e as
// larguras e proporcoes de cada capa moram em HERO_IMAGE_SIZES. As duas listas precisam bater, senao a home escolhe
// uma capa (pelo <picture>) e desenha a caixa na proporcao de outra.

const model = await import("../src/server/member-area/home-hero-model.ts");
const css = (await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
const compact = css.replace(/\s+/g, " ");

test("globals.css: cada capa por tamanho de tela tem a regra de proporção na mesma largura do <picture>", () => {
  assert.ok(
    compact.includes(
      `[data-hero-fit="full"] { --member-hero-capa-ratio: calc(${model.HERO_MAIN_IMAGE_RATIO}); min-height: min(var(--member-hero-min-h), calc((100vw - 2 * var(--member-hero-inset)) / var(--member-hero-capa-ratio))); }`
    ),
    "regra base: altura pela proporção da imagem principal, até a altura máxima do estilo"
  );
  assert.match(compact, new RegExp(`--member-hero-min-h: ${model.HERO_MAX_HEIGHT}px;`), "a altura máxima da prévia é a do estilo discreto");

  for (const size of model.HERO_IMAGE_SIZES) {
    const rule = `@media (max-width: ${size.maxWidth}px) { [data-hero-fit="full"][data-capa-${size.key}] { --member-hero-capa-ratio: calc(${size.ratio}); } }`;
    assert.ok(compact.includes(rule), `${size.key}: ${rule}`);
  }

  // Da tela maior para a menor: a regra da tela menor vem depois e vence quando as duas valem.
  const order = [...model.HERO_IMAGE_SIZES].reverse().map((size) => compact.indexOf(`[data-hero-fit="full"][data-capa-${size.key}]`));
  assert.deepEqual(order, [...order].sort((left, right) => left - right));
});
