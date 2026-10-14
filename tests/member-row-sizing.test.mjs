import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Cards fluidos como as thumbs de Shorts do YouTube (13/10/2026): a largura do card e uma fracao da
// fileira (colunas por largura de tela), nos dois estilos de cantos, entao os cards crescem com a janela.
// E a luz de fundo do destaque na cor da imagem (HeroGlow).

const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");
const cardSource = await readFile(new URL("../src/components/content-card.tsx", import.meta.url), "utf8");
const rowSource = await readFile(new URL("../src/components/content-row.tsx", import.meta.url), "utf8");
const structureSource = await readFile(new URL("../src/components/content-structure-section.tsx", import.meta.url), "utf8");
const heroSource = await readFile(new URL("../src/components/hero-section.tsx", import.meta.url), "utf8");
const coursePageSource = await readFile(new URL("../src/app/conteudo/[id]/page.tsx", import.meta.url), "utf8");
const glowSource = await readFile(new URL("../src/components/member/hero-glow.tsx", import.meta.url), "utf8");

test("cards das fileiras tem largura fluida (colunas por largura de tela) nos dois estilos de cantos", () => {
  assert.match(css, /\n\.member-row-card \{\s*scroll-snap-align: start;\s*width: calc\(\(100% - \(var\(--member-row-cols\) - 1\) \* var\(--member-row-gap\)\) \/ var\(--member-row-cols\)\);/);
  assert.match(css, /\n\.member-row-card-wide \{\s*scroll-snap-align: start;\s*width: calc\(\(100% - \(var\(--member-row-cols-wide\) - 1\) \* var\(--member-row-gap\)\) \/ var\(--member-row-cols-wide\)\);/);
  assert.match(css, /\n\.member-row-scroller \{\s*scroll-snap-type: x mandatory;/);
  assert.doesNotMatch(css, /\[data-member-corners="rounded"\] \.member-row-card/, "a largura nao depende mais do estilo de cantos");
  assert.doesNotMatch(css, /data-thumb-size/, "sem largura fixa por produto");
  assert.match(css, /--member-row-gap: 0\.75rem;/, "gap com valor padrao (a conta da largura nunca fica invalida)");

  // Colunas por largura: 2,2 no celular (o proximo card aparece), depois 3, 4, 5, 6, 7 e 8.
  assert.match(css, /--member-row-cols: 2\.2;/);
  for (const [minWidth, cols] of [[640, 3], [768, 4], [1280, 5], [1700, 6], [2100, 7], [2560, 8]]) {
    assert.match(css, new RegExp(`@media \\(min-width: ${minWidth}px\\) \\{\\s*:root \\{[^}]*--member-row-cols: ${cols};`), `${cols} colunas a partir de ${minWidth}px`);
  }

  // Os componentes nao fixam largura nos cards das fileiras.
  for (const [name, source] of [["content-card", cardSource], ["content-row", rowSource], ["content-structure-section", structureSource]]) {
    for (const line of source.split("\n").filter((candidate) => candidate.includes("member-row-card"))) {
      assert.doesNotMatch(line, /\bw-\[/, `${name}: largura fixa no card da fileira`);
    }
  }
});

test("destaque da home e banner do curso tem a luz de fundo na cor da imagem", () => {
  assert.match(heroSource, /import \{ HeroGlow \} from "@\/components\/member\/hero-glow";/);
  assert.match(heroSource, /<div className="relative flow-root">\s*<HeroGlow color=\{hero\.glowColor\} src=\{hero\.mediaType === "video" \? poster : hero\.image\} \/>/);
  assert.match(glowSource, /const accent = color \?\? \(src && measured\?\.src === src \? measured\.color : null\);/, "cor escolhida vence a medida");
  assert.match(heroSource, /<section className="@container relative z-\[1\] min-h-\[var\(--member-hero-min-h\)\]/);
  assert.match(css, /--member-hero-min-h: clamp\(520px, calc\(100vh - 256px\), 680px\);/, "arredondado: destaque mais baixo em telas curtas");
  assert.match(coursePageSource, /<HeroGlow src=\{pageHero\.mediaType === "video" \? heroVideoPosterOf\(pageHero\) : pageHero\.mediaSrc \?\? null\} \/>/);
  // Forte do meio para cima, enfraquecendo para baixo e esfumacando 72 px alem da base do banner (so no
  // arredondado), sem chegar nos cards da primeira fileira.
  assert.match(css, /\.member-hero-glow \{[\s\S]*color-mix\(in srgb, var\(--member-hero-accent, #141414\) 26%, #141414\) 0%,[\s\S]*21%, #141414\) 30%,[\s\S]*11%, #141414\) 58%,[\s\S]*2%, #141414\) 91%,[\s\S]*#141414 100%/);
  assert.match(css, /--member-hero-glow-extend: 0px;/);
  assert.match(css, /\[data-member-corners="rounded"\] \{[^}]*--member-hero-glow-extend: 72px;/);
  assert.match(css, /\[data-member-banner="rounded"\] \{[^}]*--member-hero-glow-extend: 72px;/);
  assert.match(glowSource, /h-\[calc\(100%\+var\(--member-hero-glow-extend\)\)\]/);
  // Medicao no navegador: versao pequena da imagem pelo otimizador (mesma origem), canvas 24 px, cor media
  // com saturacao reforcada; sem cor util ou sem CORS, a luz fica apagada.
  assert.match(glowSource, /\/_next\/image\?url=\$\{encodeURIComponent\(src\)\}&w=64&q=75/);
  assert.match(glowSource, /image\.crossOrigin = "anonymous";/);
  assert.match(glowSource, /opacity: accent \? 1 : 0/);
});
