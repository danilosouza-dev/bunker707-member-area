import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Capas do destaque por tamanho de tela e imagem sem escurecimento (docs/02, Hero; docs/18 §2.2): o HeroSection da home
// e o editor do Destaque desenhados no Node, sem navegador. Confere o que o aluno recebe: a capa de cada largura como
// <source> do <picture>, na ordem em que o navegador escolhe; a previa do admin com a capa da "tela" pedida; a imagem
// sem o degrade lateral e sem escurecer o alto quando nao ha texto por cima; e, no editor, o bloco das tres capas so
// com imagem e a previa com os quatro tamanhos de tela.

const { HeroSection } = await import("../src/components/hero-section.tsx");
const { HeroEditor } = await import("../src/components/admin/v2/member-area/home-hero/hero-editor.tsx");
const model = await import("../src/server/member-area/home-hero-model.ts");

const STORAGE = "https://projeto.supabase.co/storage/v1/object/public/content-assets/platform/home-hero";
const IMAGE = `${STORAGE}/grande.webp`;
const NOTEBOOK = `${STORAGE}/notebook.webp`;
const TABLET = `${STORAGE}/tablet.webp`;
const MOBILE = `${STORAGE}/celular.webp`;

const heroWith = (extra = {}) => model.resolveHomeHero({ image: IMAGE, mediaType: "image", ...extra });
const draw = (hero, props = {}) => renderToStaticMarkup(createElement(HeroSection, { hero, ...props }));
const sourcesOf = (html) => [...html.matchAll(/<source media="([^"]+)" srcSet="([^"]+)"\/>/g)].map((match) => [match[1], match[2]]);
const imageOf = (html) => html.match(/<img[^>]* src="([^"]+)"/)?.[1];

test("home: cada capa vira um <source> na ordem celular, tablet, notebook, e a imagem principal fica para as telas grandes", () => {
  const html = draw(heroWith({ images: { mobile: MOBILE, notebook: NOTEBOOK, tablet: TABLET } }));

  assert.deepEqual(sourcesOf(html), [
    ["(max-width: 639px)", MOBILE],
    ["(max-width: 1199px)", TABLET],
    ["(max-width: 1535px)", NOTEBOOK]
  ]);
  assert.equal(imageOf(html), IMAGE);
  assert.match(html, /<picture>.*<img[^>]*>.*<\/picture>/s, "as capas e a imagem ficam no mesmo <picture>");
  assert.match(html, /<img[^>]* loading="eager"/, "sem preload, a capa do topo continua carregando na hora");
});

test("home: só a capa de tablet cobre também o celular; sem capas, o destaque sai como sempre foi", () => {
  assert.deepEqual(sourcesOf(draw(heroWith({ images: { tablet: TABLET } }))), [["(max-width: 1199px)", TABLET]]);

  const plain = draw(heroWith());
  assert.deepEqual(sourcesOf(plain), []);
  assert.equal(imageOf(plain), IMAGE);
  assert.doesNotMatch(plain, / loading="eager"/, "com preload, o next/image já carrega na hora");
});

test("prévia do admin: a capa vem da largura da moldura, sem <source> (a janela é a do admin)", () => {
  const hero = heroWith({ images: { mobile: MOBILE, notebook: NOTEBOOK, tablet: TABLET } });
  const at = (previewWidth) => draw(hero, { preview: true, previewWidth });

  assert.deepEqual([390, 768, 1280, 1920].map((width) => imageOf(at(width))), [MOBILE, TABLET, NOTEBOOK, IMAGE]);
  assert.deepEqual(sourcesOf(at(390)), []);
  assert.equal(imageOf(draw(heroWith({ images: { tablet: TABLET } }), { preview: true, previewWidth: 1280 })), IMAGE, "notebook sem capa própria usa a principal");
});

test("imagem sem texto por cima aparece sem o degradê lateral e sem escurecer o alto; com texto, os dois voltam", () => {
  const clean = draw(heroWith());
  assert.doesNotMatch(clean, /bg-gradient-to-r/, "nada de sombra lateral sobre a imagem pura");
  assert.match(clean, /via-transparent to-transparent/);
  assert.match(clean, /opacity-\[var\(--member-hero-fade\)\]/, "o esfumaçado de baixo continua seguindo o estilo");

  const withTitle = draw(heroWith({ title: "Bem-vindo", visibility: { title: true } }));
  assert.match(withTitle, /bg-gradient-to-r/, "com título por cima, a sombra lateral dá leitura");
  assert.doesNotMatch(withTitle, /via-transparent/);
  assert.match(withTitle, /Bem-vindo/);

  const withButton = draw(heroWith({ cta: { href: "/minhas-compras", label: "Ver cursos", target: "same_tab" } }));
  assert.match(withButton, /bg-gradient-to-r/, "só o botão também conta como conteúdo por cima");
});

test("editor do Destaque: as três capas opcionais aparecem com imagem, somem com vídeo, e a prévia tem os quatro tamanhos", () => {
  const editor = (draft) =>
    renderToStaticMarkup(
      createElement(HeroEditor, {
        canEdit: true,
        data: { draft: { ...model.DEFAULT_HOME_HERO_DRAFT, ...draft }, logoImage: null, products: [], productsLoaded: true, updatedAt: null }
      })
    );

  const withImage = editor({ image: IMAGE, imageMobile: MOBILE });
  assert.match(withImage, /Capas por tamanho de tela/);
  for (const label of ["Capa de notebook", "Capa de tablet", "Capa de celular"]) {
    assert.match(withImage, new RegExp(label), label);
  }
  assert.ok(withImage.indexOf("Capa de notebook") < withImage.indexOf("Capa de tablet") && withImage.indexOf("Capa de tablet") < withImage.indexOf("Capa de celular"), "da tela maior para a menor");
  assert.match(withImage, /telas de 640 a 1199 px de largura/);
  assert.match(withImage, /telas de 1200 a 1535 px de largura/);
  for (const screen of ["Tela grande", "Notebook", "Tablet", "Celular"]) {
    assert.match(withImage, new RegExp(`>${screen}<`), `prévia: ${screen}`);
  }

  const withVideo = editor({ mediaType: "video", poster: IMAGE, videoUrl: "https://vz-123.b-cdn.net/abc/play_720p.mp4" });
  assert.doesNotMatch(withVideo, /Capas por tamanho de tela/, "com vídeo não há capas por tamanho de tela");
});

test("capa inteira: com capas por tamanho de tela a caixa segue a proporção da capa; sem elas, a altura é a de sempre", () => {
  const sectionOf = (html) => html.match(/<section[^>]*>/)[0];

  const withCovers = sectionOf(draw(heroWith({ images: { mobile: MOBILE, tablet: TABLET } })));
  assert.match(withCovers, /data-hero-fit="full"/);
  assert.match(withCovers, /data-capa-mobile=""/);
  assert.match(withCovers, /data-capa-tablet=""/);
  assert.doesNotMatch(withCovers, /data-capa-notebook/, "sem capa de notebook, essa faixa fica com a proporção da imagem principal");
  assert.doesNotMatch(withCovers, /style=/, "na home a altura vem das regras por largura de janela");

  const plain = sectionOf(draw(heroWith()));
  assert.doesNotMatch(plain, /data-hero-fit|data-capa-/, "só a imagem principal: nada muda");

  const video = sectionOf(draw(model.resolveHomeHero({ image: "https://vz-123.b-cdn.net/abc/play_720p.mp4", images: { mobile: MOBILE }, mediaType: "video", poster: IMAGE })));
  assert.doesNotMatch(video, /data-hero-fit/, "vídeo não tem capas por tamanho de tela");
});

test("capa inteira na prévia do admin: a altura vem da largura da moldura e da proporção da capa, até 680 px", () => {
  const all = heroWith({ images: { mobile: MOBILE, notebook: NOTEBOOK, tablet: TABLET } });
  const heightAt = (hero, previewWidth) => draw(hero, { preview: true, previewWidth }).match(/<section[^>]*style="min-height:(\d+)px"/)?.[1];

  // 390 × 16/9 = 693 e 1199 × 4/5 = 959 passam da altura máxima; 768 × 4/5 = 614; 1280 / 2 = 640; 1920 × 3/8 = 720.
  assert.deepEqual([390, 768, 1199, 1280, 1920].map((width) => heightAt(all, width)), ["680", "614", "680", "640", "680"]);
  assert.deepEqual([390, 768, 1280].map((width) => model.heroAspectRatioForWidth(heroWith({ images: { tablet: TABLET } }), width)), ["5 / 4", "5 / 4", "8 / 3"], "tela sem capa própria: proporção da capa maior mais próxima");
  assert.equal(model.heroPreviewHeightForWidth(heroWith({ images: { tablet: TABLET } }), 1280), 480, "1280 × 3/8");
  assert.equal(heightAt(heroWith(), 390), undefined, "sem capas por tamanho de tela, a prévia também fica com a altura de sempre");
  assert.equal(model.heroAspectRatioForWidth(all, 1536), model.HERO_MAIN_IMAGE_RATIO);
  assert.equal(model.heroShowsWholeCover(heroWith()), false);
});
