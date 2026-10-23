import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Desenho do pop-up "Personalizado" do aluno (docs/26; docs/18 §1.1): o modulo puro de estilos
// (popup-design-styles.ts), o carregador de fontes e o cartao de verdade desenhado com react-dom/server.
// - texto solido x degrade (background-clip: text), botao "Do tamanho do texto" x "Ocupa a linha" com piso de
//   44 px, "Subir sobre a midia" (margem negativa em cqw), alinhamento do grupo x do texto, rodape sem
//   "Lembrar depois" quando o segundo botao ja e "Lembrar depois";
// - "video ou so a capa": menos movimento e economia de dados nunca montam o <video>; video fora do nosso
//   bucket vira capa; no servidor a caixa fica vazia (nada baixado antes de o navegador decidir);
// - o que cada botao faz (Fechar, Lembrar depois, link conferido) e o nome/descricao do dialogo;
// - fontes: so do nosso bucket e familia bf_<12 hex>, FontFace com swap e peso "100 900", uma vez por endereco;
// - o cartao: linhas do titulo como texto (com espaco entre elas), cores, degrade, <video> mudo/loop/inline com
//   capa, botoes com os handlers certos, texto do produtor escapado, e o cartao Padrão IGUAL ao da v3b-1.
//
// Os .tsx do app sao transpilados aqui pelo TypeScript (so JSX -> JS, sem checar tipos); next/image e
// next/link viram stubs simples (o resto e o codigo real).

const root = new URL("../", import.meta.url);
const srcUrl = new URL("src/", root).href;
const require = createRequire(new URL("package.json", root));
const ts = require("typescript");

const STUBS = {
  "next/image": `import { createElement } from "react";
export default function Image({ fill, priority, sizes, unoptimized, style, ...props }) {
  return createElement("img", { ...props, "data-next-image": "", "data-sizes": sizes, style: fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style });
}`,
  "next/link": `import { createElement } from "react";
export default function Link({ prefetch, ...props }) { return createElement("a", props); }`
};

function withExtension(base) {
  for (const candidate of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]) {
    if (existsSync(fileURLToPath(candidate))) {
      return candidate;
    }
  }

  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (STUBS[specifier]) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}` };
    }

    const parent = context.parentURL ?? "";

    if (specifier.startsWith("@/")) {
      const found = withExtension(new URL(specifier.slice(2), srcUrl).href);

      if (found) {
        return { shortCircuit: true, url: found };
      }
    }

    if (parent.startsWith(srcUrl) && /^\.{1,2}\//.test(specifier) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      const found = withExtension(new URL(specifier, parent).href);

      if (found) {
        return { shortCircuit: true, url: found };
      }
    }

    // Os stubs (data:) resolvem "react" a partir do projeto.
    if (parent.startsWith("data:")) {
      return nextResolve(specifier, { ...context, parentURL: new URL("package.json", root).href });
    }

    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(srcUrl) && url.endsWith(".tsx")) {
      const fileName = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(fileName, "utf8"), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName
      });

      return { format: "module", shortCircuit: true, source: outputText };
    }

    return nextLoad(url, context);
  }
});

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const model = await import("../src/server/communications/popup-design-model.ts");
const styles = await import("../src/components/member/notifications/popup-design/popup-design-styles.ts");
const fontLoader = await import("../src/components/member/notifications/popup-design/popup-font-loader.ts");
const { MemberPopupCard } = await import("../src/components/member/notifications/member-popup.tsx");
const { PopupDesignCard } = await import("../src/components/member/notifications/popup-design/popup-design-card.tsx");
const { PopupDesignMedia } = await import("../src/components/member/notifications/popup-design/popup-design-media.tsx");
const blocksModule = await import("../src/components/member/notifications/popup-design/popup-design-blocks.tsx");

const ORIGIN = "https://projeto.supabase.co";
const VIDEO_PATH = "videos/0b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b.webm";
const VIDEO = { mimeType: "video/webm", path: VIDEO_PATH, url: `${ORIGIN}/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}` };
const IMAGE = { alt: "Capa da aula nova", url: `${ORIGIN}/storage/v1/object/public/content-assets/communications/images/capa.webp` };
const FONT_FACE = {
  family: "bf_0123456789ab",
  format: "woff2",
  id: "3b0f6c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b",
  style: "normal",
  url: `${ORIGIN}/storage/v1/object/public/communication-fonts/fonts/0123456789abcdef01234567.woff2`,
  weight: 400
};
const W = 440;
const solid = (color) => ({ color, kind: "solid" });
const gradient = (from, to, angle = 90) => ({ angle, from, kind: "gradient", to });

const starter = (id = "media_top_fade", input = {}) => model.popupStarterDesign(id, input);

function popupOf(design, overrides = {}) {
  return {
    audio: null,
    body: "",
    canSnooze: true,
    cta: { href: "/minhas-compras", label: "Saiba mais", target: "same_tab" },
    design,
    fonts: [],
    id: "p1",
    image: IMAGE,
    title: "Nome do pop-up nas listas",
    ...overrides
  };
}

const render = (element) => renderToStaticMarkup(element);
const textOf = (html) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
const withoutSvg = (html) => html.replace(/<svg[\s\S]*?<\/svg>/g, "<svg/>");

/* ------------------------------------------------------------------------------------------------
 * Modulo puro de estilos
 * ---------------------------------------------------------------------------------------------- */

test("texto solido usa color; degrade recorta o fundo pelas letras e deixa a cor transparente", () => {
  assert.deepEqual(styles.textPaintCss(solid("#e0ff3a")), { color: "#e0ff3a" });

  const css = styles.textPaintCss(gradient("#ff4fa3", "#e0ff3a", 120));
  assert.equal(css.backgroundImage, "linear-gradient(120deg, #ff4fa3, #e0ff3a)");
  assert.equal(css.backgroundClip, "text");
  assert.equal(css.WebkitBackgroundClip, "text");
  assert.equal(css.color, "transparent");
  assert.equal(css.WebkitTextFillColor, "transparent");

  // Solido ocupa a linha (text-align); degrade fica do tamanho do texto, alinhado pelo grupo.
  assert.deepEqual(styles.textBoxCss(solid("#ffffff"), "center"), { alignSelf: "stretch", textAlign: "center" });
  assert.deepEqual(styles.textBoxCss(gradient("#000000", "#ffffff"), "right"), { alignSelf: "flex-end", maxWidth: "100%", textAlign: "right", width: "fit-content" });
});

test("linha do titulo: a cor e o tamanho dela ou os do titulo; degrade do tamanho do texto, alinhado pela margem", () => {
  const block = starter().blocks.find((item) => item.type === "heading");
  const [first, second] = block.lines;

  assert.equal(styles.headingLineCss(first, block, "center", W).color, "#e0ff3a");
  assert.equal(styles.headingLineCss(second, block, "center", W).color, "#ffffff", "linha sem cor = a do titulo");
  assert.equal(styles.headingLineCss(second, block, "center", W).fontSize, model.scaledFontSize(40, W));
  assert.equal(styles.headingLineCss({ ...second, size: 24 }, block, "center", W).fontSize, model.scaledFontSize(24, W));

  const line = { paint: gradient("#ff4fa3", "#e0ff3a"), size: null, text: "Degrade" };
  const css = styles.headingLineCss(line, block, "center", W);
  assert.equal(css.width, "fit-content");
  assert.equal(css.marginInline, "auto");
  assert.equal(css.WebkitTextFillColor, "transparent");
  assert.equal(styles.headingLineCss(line, { ...block, style: { ...block.style, align: "left" } }, "center", W).marginInline, "0 auto");
  assert.equal(styles.headingLineCss(line, block, "right", W).marginInline, "auto 0", "titulo 'Como o grupo' segue o grupo");
});

test("alinhamento: 'Como o grupo' herda o do grupo; o do texto sobrescreve", () => {
  assert.equal(styles.resolvedAlign("inherit", "center"), "center");
  assert.equal(styles.resolvedAlign("left", "center"), "left");

  const badge = starter().blocks.find((item) => item.type === "badge");
  assert.equal(styles.badgeCss(badge, "center", W).alignSelf, "center");
  assert.equal(styles.badgeCss({ ...badge, style: { ...badge.style, align: "right" } }, "center", W).alignSelf, "flex-end");

  const text = starter().blocks.find((item) => item.type === "text");
  assert.equal(styles.textBlockCss(text, "left", W).textAlign, "left");
  assert.equal(styles.textBlockCss({ ...text, style: { ...text.style, align: "right" } }, "left", W).textAlign, "right");
  assert.equal(styles.textBlockCss(text, "left", W).whiteSpace, "pre-line");
});

test("tipografia: fonte enviada pela familia resolvida (senao o sistema), Condensada com font-stretch, piso de 12 px", () => {
  const style = { font: { id: FONT_FACE.id, kind: "uploaded" }, letterSpacing: 0.02, lineHeight: 1.2, size: 10, uppercase: true, weight: 700 };
  const css = styles.typographyCss(style, W, [FONT_FACE]);

  assert.match(css.fontFamily, /^"bf_0123456789ab", system-ui/);
  assert.equal(css.fontSize, "max(10px, 2.2727cqw)", "abaixo de 12 px fica o proprio valor (nunca maior)");
  assert.equal(styles.typographyCss({ ...style, size: 40 }, W).fontSize, "max(12px, 9.0909cqw)");
  assert.equal(css.letterSpacing, "0.02em");
  assert.equal(css.textTransform, "uppercase");
  assert.equal(css.lineHeight, 1.2);
  assert.doesNotMatch(styles.typographyCss(style, W, []).fontFamily, /bf_/, "fonte que nao veio resolvida cai no sistema");
  assert.equal(styles.typographyCss({ ...style, font: { key: "condensed", kind: "builtin" } }, W).fontStretch, "condensed");
});

test("botao: 'Do tamanho do texto' alinhado pelo grupo x 'Ocupa a linha'; altura com piso de 44 px (M/G) e 36 (P)", () => {
  const style = model.defaultPopupButtonStyle({ background: gradient("#e0ff3a", "#a3e635"), glow: "#e0ff3a40", size: "M", width: "fit" });
  const fit = styles.buttonCss(style, "center", W);

  assert.equal(fit.alignSelf, "center");
  assert.equal(fit.height, "max(44px, 10cqw)");
  assert.equal(fit.background, "linear-gradient(90deg, #e0ff3a, #a3e635)");
  assert.equal(fit.boxShadow, `0 0 ${model.scaledLength(24, W)} #e0ff3a40`);
  assert.equal(fit.paddingInline, model.scaledLength(20, W));
  assert.equal(fit.border, "none", "borda 0 = sem borda");

  const full = styles.buttonCss({ ...style, border: { color: "#ffffff40", width: 2 }, glow: null, size: "L", width: "full" }, "left", W);
  assert.equal(full.alignSelf, "stretch");
  assert.equal(full.height, "max(44px, 11.8182cqw)");
  assert.equal(full.boxShadow, "none");
  assert.equal(full.border, "2px solid #ffffff40", "borda em px fixos (nao escala)");
  assert.equal(styles.buttonCss({ ...style, size: "S" }, "left", W).height, "max(36px, 8.1818cqw)");
  assert.deepEqual(styles.POPUP_BUTTON_LABEL_CSS, { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
});

test("zona do texto: 'Subir' em cqw (% da altura da midia), sem midia nao sobe, 'Sobre a midia' na mesma celula", () => {
  const design = starter();
  const below = styles.popupTextGroupCss(design, true);

  assert.equal(below.marginTop, "-19.125cqw", "subir 34% de uma midia 16:9 = 34 x 0,5625 cqw");
  assert.equal(below.padding, `${model.scaledLength(24, W)} ${model.scaledLength(24, W)} 0`);
  assert.equal(below.alignItems, "center");
  assert.equal(below.gap, model.scaledLength(12, W));
  assert.equal(styles.popupTextGroupCss(design, false).marginTop, undefined, "sem midia nao sobe");
  assert.equal(styles.popupTextGroupCss({ ...design, media: { ...design.media, aspect: "1:1" } }, true).marginTop, "-34cqw");

  const over = { ...design, text: { ...design.text, placement: "over-bottom" } };
  assert.equal(styles.isTextOverMedia(over, true), true);
  assert.equal(styles.isTextOverMedia(over, false), false, "sem midia, vale como Abaixo");
  assert.equal(styles.popupTextGroupCss(over, true).gridArea, "1 / 1");
  assert.equal(styles.popupTextGroupCss(over, true).alignSelf, "end");
  assert.equal(styles.popupTextGroupCss({ ...over, text: { ...over.text, placement: "over-top" } }, true).alignSelf, "start");
  assert.equal(styles.popupTextGroupCss({ ...over, text: { ...over.text, placement: "over-middle" } }, true).alignSelf, "center");
  assert.equal(styles.popupMediaBoxCss(over, true).gridArea, "1 / 1");
  assert.equal(styles.popupMediaBoxCss(design, false).aspectRatio, "16 / 9");
  assert.equal(styles.popupMediaFillCss({ ...design, media: { ...design.media, position: "top" } }).objectPosition, "center top");
});

/** O design com o degrade trocado (as outras partes do modelo ficam). */
const withFade = (design, fade) => ({ ...design, media: { ...design.media, fade: { ...design.media.fade, ...fade } } });

/** As paradas de um linear-gradient de hex: [{ alpha 0..255, at % }]. */
function stopsOf(css) {
  return [...css.matchAll(/#([0-9a-f]{6})([0-9a-f]{2})? (-?[\d.]+)%/g)].map((match) => ({ alpha: match[2] ? parseInt(match[2], 16) : 255, at: Number(match[3]) }));
}

test("degrade 'Igual ao fundo do cartão': mascara na caixa da midia (opaca ate o comeco, some ate o fim, transparente embaixo)", () => {
  const design = starter();
  const box = styles.popupMediaBoxCss(design, false);
  const mask = "linear-gradient(180deg, #000000 0%, #000000 50%, #000000a6 68.9%, #00000040 81.5%, #00000000 92%)";

  assert.deepEqual(design.media.fade, { color: "auto", enabled: true, end: 92, height: 42 }, "o modelo escurece de 50 % a 92 % da midia");
  assert.equal(box.maskImage, mask);
  assert.equal(box.WebkitMaskImage, mask, "Safari: -webkit-mask-image");
  assert.equal(styles.popupFadeCss(design), null, "sem camada por cima: o fundo de verdade do cartao aparece por baixo");
  assert.equal(model.popupFadeSpan(design.media.fade).start, 50);

  const off = withFade(design, { enabled: false });
  assert.equal(styles.popupMediaBoxCss(off, false).maskImage, undefined, "desligado: nem mascara");
  assert.equal(styles.popupFadeCss(off), null, "desligado: nem camada");

  // Passagem maior que o fim: comeca no topo (nunca acima).
  assert.equal(model.fadeMaskCss(withFade(design, { end: 45, height: 80 })), "linear-gradient(180deg, #000000 0%, #000000 0%, #000000a6 20.25%, #00000040 33.75%, #00000000 45%)");
});

test("degrade de outra cor: camada do comeco da passagem ate embaixo, cor solida depois do fim; nunca mascara", () => {
  const design = withFade(starter(), { color: "#101010", end: 70, height: 35 });
  const fade = styles.popupFadeCss(design);

  // A camada tem 65 % da midia (de 35 % ate embaixo): as paradas 35 % -> 50,75 % -> 61,25 % -> 70 % da midia.
  assert.equal(fade.background, "linear-gradient(180deg, #10101000 0%, #10101059 24.23%, #101010bf 40.38%, #101010 53.85%)");
  assert.equal(fade.height, "calc(65% + 1px)");
  assert.equal(fade.bottom, "-1px");
  assert.equal(fade.pointerEvents, "none");
  assert.equal(styles.popupMediaBoxCss(design, false).maskImage, undefined);
  assert.equal(styles.popupFadeCss(withFade(design, { enabled: false })), null);
});

test("design salvo antes do 'Fica totalmente escuro em' (sem end): o mesmo degrade de antes, nos dois modos", () => {
  const old = { ...starter(), media: { ...starter().media, fade: { color: "#16181c", enabled: true, height: 65 } } };

  // Outra cor: exatamente o CSS da versao anterior (camada de 65 % embaixo, paradas 0/45/75/100).
  const fade = styles.popupFadeCss(old);
  assert.equal(fade.background, "linear-gradient(180deg, #16181c00 0%, #16181c59 45%, #16181cbf 75%, #16181c 100%)");
  assert.equal(fade.height, "calc(65% + 1px)");
  assert.deepEqual(model.popupFadeSpan(old.media.fade), { end: 100, start: 35 });

  // "Igual ao fundo do cartão": a mascara e o complemento da camada de antes nas mesmas alturas da midia
  // (cor por cima com alfa a = mascara com 1 - a sobre o mesmo fundo de cor): o aluno ve o mesmo cartao.
  const auto = { ...old, media: { ...old.media, fade: { color: "auto", enabled: true, height: 65 } } };
  const mask = stopsOf(styles.popupMediaBoxCss(auto, false).maskImage).slice(1);
  const layer = stopsOf(fade.background).map(({ alpha, at }) => ({ alpha, at: Math.round((35 + (at * 65) / 100) * 100) / 100 }));
  assert.deepEqual(
    mask.map(({ alpha, at }) => ({ alpha: 255 - alpha, at })),
    layer,
    "mascara (opaca ate 35 %, depois 64,25 %, 83,75 %, 100 %) = 1 - a camada de antes"
  );
  assert.equal(styles.popupFadeCss(auto), null);
});

test("cartao: largura (a escolhida ou a tela - 2 rem), container das unidades cqw, cantos em cqw, base Inter", () => {
  const design = starter();

  assert.deepEqual(styles.popupOuterCss(design), { containerType: "inline-size", position: "relative", width: "min(440px, calc(100cqw - 2rem))" });
  const card = styles.popupCardCss(design);
  assert.equal(card.borderRadius, model.scaledLength(24, W));
  assert.equal(card.background, "#16181c");
  assert.equal(card.border, "1px solid #ffffff1a");
  assert.equal(card.overflow, "hidden");
  assert.equal(card.fontFamily, model.POPUP_BUILTIN_FONTS.inter.stack);
  assert.deepEqual(styles.popupCloseCss(design), { background: "#00000099", color: "#ffffff" });
});

const CARD_IMAGE_URL = `${ORIGIN}/storage/v1/object/public/content-assets/communications/images/0123456789abcdef01234567.webp`;
const withCardImage = (design, image = {}) => ({
  ...design,
  card: { ...design.card, background: { color: "#16181c", dim: 40, kind: "image", position: "bottom", url: CARD_IMAGE_URL, ...image } }
});

test("imagem no fundo do cartao: na largura do cartao, presa onde foi escolhida, escuro por cima, borda sumindo na cor de apoio; so do nosso bucket", () => {
  const design = withCardImage(starter());
  const box = (position) => `${position} / 100% 56.25cqw no-repeat border-box`;

  // Embaixo (o video em cima passando para a imagem embaixo): a borda de cima some na cor; 40 % de escuro = 66.
  assert.equal(
    styles.popupCardCss(design).background,
    [
      `linear-gradient(180deg, #16181c 0%, #16181c00 40%) ${box("center bottom")}`,
      `linear-gradient(#00000066, #00000066) ${box("center bottom")}`,
      `url("${CARD_IMAGE_URL}") ${box("center bottom")}`,
      "#16181c"
    ].join(", ")
  );
  assert.equal(
    styles.popupCardCss(withCardImage(starter(), { dim: 0, position: "top" })).background,
    [
      `linear-gradient(0deg, #16181c 0%, #16181c00 40%) ${box("center top")}`,
      `linear-gradient(#00000000, #00000000) ${box("center top")}`,
      `url("${CARD_IMAGE_URL}") ${box("center top")}`,
      "#16181c"
    ].join(", "),
    "em cima: a borda de baixo some; sem escuro"
  );
  assert.match(
    styles.popupCardCss(withCardImage(starter(), { color: "#101010cc", dim: 80, position: "center" })).background,
    /^linear-gradient\(180deg, #101010cc 0%, #10101000 30%, #10101000 70%, #101010cc 100%\) center center \/ 100% 56\.25cqw no-repeat border-box, linear-gradient\(#000000cc, #000000cc\) center center /,
    "no meio: as duas bordas somem; 80 % de escuro = cc; cor de apoio com transparencia"
  );

  // Endereco que nao e do nosso bucket de imagens (outra pasta, outro bucket, outro formato, com query): so a cor.
  for (const url of [
    `${ORIGIN}/storage/v1/object/public/content-assets/catalog/0123456789abcdef01234567.webp`,
    `${ORIGIN}/storage/v1/object/public/communication-fonts/communications/images/0123456789abcdef01234567.webp`,
    `${ORIGIN}/storage/v1/object/public/content-assets/communications/images/0123456789abcdef01234567.png`,
    `${CARD_IMAGE_URL}?x=")`,
    "javascript:alert(1)",
    // O URL do navegador aceita aspas e ";" no nome da maquina: nunca entra no url("...") do CSS.
    `https://a";color:red;x.supabase.co/storage/v1/object/public/content-assets/communications/images/0123456789abcdef01234567.webp`,
    `https://a)b.supabase.co/storage/v1/object/public/content-assets/communications/images/0123456789abcdef01234567.webp`,
    `http://evil.example/storage/v1/object/public/content-assets/communications/images/0123456789abcdef01234567.webp`
  ]) {
    assert.equal(styles.popupCardCss(withCardImage(starter(), { url })).background, "#16181c", url);
  }

  // A mascara da midia deixa a imagem aparecer onde a midia some; "auto" do degrade usa a cor de apoio.
  assert.ok(styles.popupMediaBoxCss(design, false).maskImage);
  assert.equal(model.fadeColorOf(design), "#16181c");
  assert.equal(model.fadeColorOf(withFade(design, { color: "#202020" })), "#202020");
});

test("o primeiro bloco guarda o canto do X so quando o texto comeca no topo do cartao", () => {
  const design = starter();

  assert.equal(styles.popupFirstBlockClearance(design, true), null, "X sobre a midia");
  assert.deepEqual(styles.popupFirstBlockClearance(design, false), { marginInline: `max(0px, calc(56px - ${model.scaledLength(24, W)}))` }, "centro: dos dois lados");

  const textOnly = starter("text_only");
  assert.deepEqual(Object.keys(styles.popupFirstBlockClearance(textOnly, false)), ["marginInlineEnd"]);
  assert.ok(styles.popupFirstBlockClearance({ ...design, text: { ...design.text, placement: "over-top" } }, true));
});

test("rodape: 'Lembrar depois' some sem adiar e quando o segundo botao ja e 'Lembrar depois'", () => {
  const design = starter();
  const withSnoozeButton = { ...design, blocks: [...design.blocks, { ...model.newPopupBlock("button2", "b8"), action: { kind: "snooze" } }] };

  assert.deepEqual(styles.popupFooterLinks(design, true), { dismiss: true, snooze: true });
  assert.deepEqual(styles.popupFooterLinks(design, false), { dismiss: true, snooze: false });
  assert.deepEqual(styles.popupFooterLinks(withSnoozeButton, true), { dismiss: true, snooze: false });
  assert.equal(styles.popupFooterLinkCss(design).color, "#a1a1aa");
  assert.equal(styles.popupFooterLinkCss(design).minHeight, "44px");

  // "Não mostrar de novo" desligado pela equipe: o link sai; sem a chave (design de antes) continua.
  const semLink = { ...design, links: { ...design.links, showDismiss: false } };
  assert.deepEqual(styles.popupFooterLinks(semLink, true), { dismiss: false, snooze: true });
  assert.deepEqual(styles.popupFooterLinks(semLink, false), { dismiss: false, snooze: false });
  assert.deepEqual(styles.popupFooterLinks({ ...design, links: { color: "#a1a1aa" } }, false), { dismiss: true, snooze: false }, "sem a chave = o link aparece");
  assert.equal(styles.popupHasFooter({ dismiss: true, snooze: false }), true);
  assert.equal(styles.popupHasFooter({ dismiss: false, snooze: true }), true);
  assert.equal(styles.popupHasFooter({ dismiss: false, snooze: false }), false, "nenhum link = nenhum rodape");

  // Sem rodape, o grupo de texto fecha com o respiro do cartao embaixo (com rodape, o respiro de baixo e dele).
  assert.equal(styles.popupTextGroupCss(design, true).padding, `${model.scaledLength(24, W)} ${model.scaledLength(24, W)} 0`);
  assert.equal(styles.popupTextGroupCss(design, true, true).padding, `${model.scaledLength(24, W)} ${model.scaledLength(24, W)} 0`);
  assert.equal(styles.popupTextGroupCss(design, true, false).padding, model.scaledLength(24, W));
  const over = { ...design, text: { ...design.text, placement: "over-bottom" } };
  assert.equal(styles.popupTextGroupCss(over, true, false).padding, model.scaledLength(24, W), "sobre a midia o grupo ja tem o respiro todo");
});

test("video ou so a capa: menos movimento e economia de dados ficam na capa; no servidor nada e baixado", () => {
  const video = starter("media_top_fade", { video: VIDEO });
  const mode = (design, motion, hasImage = true) => styles.popupMediaMode(design, { hasImage, motion });

  assert.equal(video.media.kind, "video");
  assert.equal(mode(video, "motion"), "video");
  assert.equal(mode(video, "still"), "image");
  assert.equal(mode(video, "pending"), "pending", "servidor: caixa vazia ate o navegador decidir");
  assert.equal(mode(video, "still", false), "none");
  assert.equal(mode(starter(), "motion"), "image");
  assert.equal(mode(starter(), "motion", false), "none", "imagem faltando = sem midia");
  assert.equal(mode(starter("text_only"), "motion"), "none");

  const foreign = { ...video, media: { ...video.media, video: { ...VIDEO, url: `${ORIGIN}/storage/v1/object/public/content-assets/${VIDEO_PATH}` } } };
  assert.equal(mode(foreign, "motion"), "image", "video fora do nosso bucket: so a capa");
  assert.equal(styles.isOwnPopupVideo(VIDEO), true);
  assert.equal(styles.isOwnPopupVideo({ ...VIDEO, url: `javascript:alert(1)//${VIDEO.url}` }), false);
  assert.equal(styles.isOwnPopupVideo({ ...VIDEO, url: `${VIDEO.url}?x=1` }), false);

  const prefs = (reduce, saveData) => styles.readMotionPreferences({ matchMedia: (query) => ({ matches: reduce && query === styles.POPUP_REDUCED_MOTION_QUERY }), navigator: { connection: { saveData } } });
  assert.deepEqual(prefs(true, false), { reducedMotion: true, saveData: false });
  assert.equal(styles.prefersStillMedia(prefs(true, false)), true);
  assert.equal(styles.prefersStillMedia(prefs(false, true)), true, "Save-Data");
  assert.equal(styles.prefersStillMedia(prefs(false, false)), false);
  assert.deepEqual(styles.readMotionPreferences({}), { reducedMotion: false, saveData: false }, "navegador sem as APIs: pode tocar");
  assert.deepEqual(styles.readMotionPreferences({ matchMedia: () => { throw new Error("x"); } }), { reducedMotion: false, saveData: false });
});

test("botoes: principal so com cta valido; segundo botao Fechar / Lembrar depois (so podendo adiar) / link conferido", () => {
  assert.equal(styles.primaryButtonTarget(null), null);
  assert.equal(styles.primaryButtonTarget({ href: "/minhas-compras", label: "  ", target: "same_tab" }), null);
  assert.equal(styles.primaryButtonTarget({ href: "javascript:alert(1)", label: "Ir", target: "same_tab" }), null);
  assert.deepEqual(styles.primaryButtonTarget({ href: "/minhas-compras", label: " Ver ", target: "new_tab" }), {
    label: "Ver",
    link: { href: "/minhas-compras", internal: true, newTab: true }
  });

  assert.deepEqual(styles.button2Behavior({ action: { kind: "close" } }, { canSnooze: false }), { kind: "close" });
  assert.deepEqual(styles.button2Behavior({ action: { kind: "snooze" } }, { canSnooze: true }), { kind: "snooze" });
  assert.equal(styles.button2Behavior({ action: { kind: "snooze" } }, { canSnooze: false }), null, "adiar esgotado: o botao some");
  assert.equal(styles.button2Behavior({ action: { href: "//fora.com", kind: "link", target: "same_tab" } }, { canSnooze: true }), null);
  assert.deepEqual(styles.button2Behavior({ action: { href: "https://exemplo.com/a", kind: "link", target: "new_tab" } }, { canSnooze: true }), {
    kind: "link",
    link: { href: "https://exemplo.com/a", internal: false, newTab: true }
  });
  assert.match(styles.button2Behavior({ action: { href: "/favoritos", kind: "link", target: "same_tab" } }, { accessPreviewMode: "student", canSnooze: true }).link.href, /^\/favoritos/);
});

test("nome e descricao do dialogo: Padrão = titulo e texto; Personalizado = titulo do design (ou o do aviso) e 1o Texto", () => {
  const ids = { bodyId: "b", titleId: "t" };

  assert.deepEqual(styles.popupDialogAria({ body: "Texto", title: "T" }, ids), { "aria-describedby": "b", "aria-labelledby": "t" });
  assert.deepEqual(styles.popupDialogAria({ body: "", title: "T" }, ids), { "aria-describedby": undefined, "aria-labelledby": "t" });

  const design = starter();
  assert.deepEqual(styles.popupDialogAria({ body: "", design, title: "Nome" }, ids), { "aria-describedby": "b", "aria-labelledby": "t" });

  const noHeading = { ...design, blocks: design.blocks.filter((block) => block.type !== "heading" && block.type !== "text") };
  assert.deepEqual(styles.popupDialogAria({ body: "Corpo guardado", design: noHeading, title: " Nome do pop-up " }, ids), {
    "aria-describedby": undefined,
    "aria-label": "Nome do pop-up"
  });
});

test("fonte enviada: so do nosso bucket de fontes, familia bf_<12 hex> e formato da lista", () => {
  assert.equal(styles.popupFontSource(FONT_FACE), `url("${FONT_FACE.url}") format("woff2")`);
  assert.equal(styles.popupFontSource({ ...FONT_FACE, family: "Inter; color: red" }), null);
  assert.equal(styles.popupFontSource({ ...FONT_FACE, format: "svg" }), null);
  assert.equal(styles.popupFontSource({ ...FONT_FACE, url: FONT_FACE.url.replace("communication-fonts", "content-assets") }), null);
  assert.equal(styles.popupFontSource({ ...FONT_FACE, url: `${FONT_FACE.url}?v=1` }), null);
  assert.equal(styles.popupFontSource({ ...FONT_FACE, url: 'https://x.co/storage/v1/object/public/communication-fonts/fonts/a") format("x' }), null);
  assert.equal(styles.popupFontSource({ ...FONT_FACE, url: "http://evil.example/storage/v1/object/public/communication-fonts/fonts/0123456789abcdef01234567.woff2" }), null, "http so na propria maquina");
});

test("carregador de fontes: FontFace com swap e peso '100 900', uma vez por familia e endereco, falha nao derruba", async () => {
  const created = [];
  const added = [];

  globalThis.FontFace = class {
    constructor(family, source, descriptors) {
      this.family = family;
      created.push({ descriptors, family, source });
    }

    load() {
      return this.family === "bf_00000000dead" ? Promise.reject(new Error("rede")) : Promise.resolve(this);
    }
  };
  globalThis.document = { fonts: { add: (face) => added.push(face.family) } };

  try {
    const italic = { ...FONT_FACE, style: "italic" };
    const broken = { ...FONT_FACE, family: "bf_00000000dead", url: FONT_FACE.url.replace("0123456789abcdef01234567", "fedcba9876543210fedcba98") };

    await fontLoader.loadPopupFontFaces([italic, broken, { ...FONT_FACE, family: "nao-vale" }]);
    await fontLoader.loadPopupFontFaces([italic]);

    assert.deepEqual(added, ["bf_0123456789ab", "bf_00000000dead"], "familia invalida nunca e registrada; a mesma nao repete");
    assert.deepEqual(created[0], {
      descriptors: { display: "swap", style: "italic", weight: "100 900" },
      family: "bf_0123456789ab",
      source: `url("${FONT_FACE.url}") format("woff2")`
    });
  } finally {
    delete globalThis.FontFace;
    delete globalThis.document;
  }
});

/* ------------------------------------------------------------------------------------------------
 * O cartao desenhado (react-dom/server)
 * ---------------------------------------------------------------------------------------------- */

test("Personalizado: linhas do titulo e texto de verdade, cores, <h2>/<p> com os ids do dialogo, botao com o cta", () => {
  const design = starter();
  const html = render(createElement(MemberPopupCard, { bodyId: "corpo", popup: popupOf(design), titleId: "titulo" }));

  assert.match(html, /data-popup-design=""/);
  assert.match(html, /<h2 id="titulo"[^>]*><span style="[^"]*color:#e0ff3a[^"]*">Conteúdo novo<\/span> <span style="[^"]*color:#ffffff[^"]*">Já disponível<\/span><\/h2>/);
  assert.match(html, /text-transform:uppercase/);
  assert.equal(textOf(html.match(/<h2[\s\S]*?<\/h2>/)[0]), model.popupDesignAccessibleName(design, "x").label, "nome do dialogo = texto do <h2>");
  assert.match(html, /<p id="corpo"[^>]*>Uma aula nova acabou de entrar/);
  assert.match(html, /<span style="[^"]*background:#ff4fa3[^"]*"><span [^>]*>Novidade<\/span><\/span>/);
  assert.match(html, /<a class="[^"]*" data-popup-button="primary" href="\/minhas-compras" style="[^"]*background:#e0ff3a[^"]*"><span [^>]*>Saiba mais<\/span><\/a>/);
  assert.match(html, /<img alt="Capa da aula nova"[^>]*src="https:\/\/projeto\.supabase\.co\/storage\/v1\/object\/public\/content-assets\/communications\/images\/capa\.webp"/);
  assert.match(html, /<div data-popup-media="image" style="[^"]*mask-image:linear-gradient\(180deg, #000000 0%, #000000 50%[^"]*-webkit-mask-image:linear-gradient\(180deg, #000000 0%/);
  assert.doesNotMatch(html, /data-popup-fade=""/, "'Igual ao fundo do cartão' e a mascara, sem camada por cima");
  assert.doesNotMatch(html, /<video/);
  assert.match(html, /<button [^>]*type="button">Lembrar depois<\/button>/);
  assert.match(html, /<button [^>]*type="button">Não mostrar de novo<\/button>/);
  assert.match(html, /<button aria-label="Fechar" class="[^"]*size-9[^"]*before:-inset-1[^"]*" style="background:#00000099;color:#ffffff" type="button">/);
  assert.doesNotMatch(html, /user-select/, "texto selecionavel (o navegador decide; nada de user-select: none)");
  assert.equal((html.match(/pointer-events:none/g) ?? []).length, 0, "nada por cima do cartao segura ou deixa passar o toque");
  const colored = render(createElement(MemberPopupCard, { popup: popupOf(withFade(design, { color: "#101010" })) }));
  assert.match(colored, /data-popup-fade=""/, "outra cor: a camada por cima da midia");
  assert.equal((colored.match(/pointer-events:none/g) ?? []).length, 1, "so a camada do degrade deixa o toque passar");
  assert.doesNotMatch(html, /Nome do pop-up nas listas/, "o titulo do aviso nao aparece no Personalizado");
});

test("'Não mostrar de novo' desligado: o link some; sem 'Lembrar depois' tambem, nenhum rodape e o cartao termina no ultimo bloco", () => {
  const design = starter();
  const semLink = { ...design, links: { ...design.links, showDismiss: false } };
  const groupPadding = model.scaledLength(24, W);

  // Ligado (o de sempre): o rodape com os dois links; o design sem a chave (gravado antes) desenha igual.
  const ligado = render(createElement(MemberPopupCard, { popup: popupOf(design) }));
  assert.match(ligado, /<div data-popup-footer="" style="[^"]*"><button [^>]*type="button">Lembrar depois<\/button><button [^>]*type="button">Não mostrar de novo<\/button><\/div>/);
  assert.match(ligado, new RegExp(`<div data-popup-text="" style="[^"]*padding:${groupPadding} ${groupPadding} 0"`), "com rodape, o respiro de baixo e dele");
  assert.equal(render(createElement(MemberPopupCard, { popup: popupOf({ ...design, links: { color: design.links.color } }) })), ligado, "sem a chave = o mesmo HTML");

  // Desligado, podendo adiar: so o "Lembrar depois" no rodape.
  const soLembrar = render(createElement(MemberPopupCard, { popup: popupOf(semLink) }));
  assert.doesNotMatch(soLembrar, /Não mostrar de novo/);
  assert.match(soLembrar, /<div data-popup-footer="" style="[^"]*"><button [^>]*type="button">Lembrar depois<\/button><\/div>/);

  // Desligado e sem adiar: nenhum rodape (nem o respiro dele); o grupo fecha com o respiro do cartao e vem o X.
  const semRodape = render(createElement(MemberPopupCard, { popup: popupOf(semLink, { canSnooze: false }) }));
  assert.doesNotMatch(semRodape, /Não mostrar de novo|Lembrar depois|data-popup-footer|min-height:44px|column-gap/);
  assert.match(semRodape, new RegExp(`<div data-popup-text="" style="[^"]*padding:${groupPadding}"`));
  assert.match(semRodape, /<\/a><\/div><\/div><button aria-label="Fechar"/, "depois do botao principal: o fim do grupo, o fim do cartao e o X");
  assert.match(semRodape, /<button aria-label="Fechar"/, "o X nunca depende do link");

  // O mesmo com o segundo botao "Lembrar depois" no lugar do link pequeno: o rodape some de vez.
  const comBotao2 = { ...semLink, blocks: [...semLink.blocks, { ...model.newPopupBlock("button2", "b8"), action: { kind: "snooze" } }] };
  const html = render(createElement(MemberPopupCard, { popup: popupOf(comBotao2) }));
  assert.match(html, /data-popup-button="snooze"/);
  assert.doesNotMatch(html, /data-popup-footer|Não mostrar de novo/);

  // A previa do admin e o mesmo cartao.
  const previa = render(createElement(MemberPopupCard, { popup: popupOf(semLink, { canSnooze: false }), preview: true }));
  assert.doesNotMatch(previa, /Não mostrar de novo|data-popup-footer/);
  assert.match(render(createElement(MemberPopupCard, { popup: popupOf(semLink), preview: true })), /<div data-popup-footer="" style="[^"]*"><span [^>]*>Lembrar depois<\/span><\/div>/);
});

test("imagem no fundo do cartao no HTML: no proprio cartao (atras da midia e do texto), igual com ou sem movimento", () => {
  const design = withCardImage(starter("media_top_fade", { video: VIDEO }));
  const html = render(createElement(MemberPopupCard, { popup: popupOf(design) }));
  const cardStyle = html.match(/<div data-fonts-ready="" data-popup-design="" style="[^"]*"><div style="([^"]*)"/)[1];

  assert.ok(
    cardStyle.startsWith(
      "background:linear-gradient(180deg, #16181c 0%, #16181c00 40%) center bottom / 100% 56.25cqw no-repeat border-box, " +
        "linear-gradient(#00000066, #00000066) center bottom / 100% 56.25cqw no-repeat border-box, " +
        `url(&quot;${CARD_IMAGE_URL}&quot;) center bottom / 100% 56.25cqw no-repeat border-box, #16181c;`
    ),
    cardStyle
  );
  // No servidor (sem saber do movimento) a caixa do video fica vazia, mas o fundo ja e a imagem; com a mascara.
  assert.match(html, /data-popup-media="pending" style="[^"]*mask-image:/);
  assert.equal((html.match(/url\(&quot;/g) ?? []).length, 1, "a imagem do fundo uma vez so, no cartao");
  assert.match(html, /<h2[^>]*>/, "o texto continua de verdade por cima");
});

test("degrade no titulo e no texto vira background-clip: text no HTML", () => {
  const design = starter();
  const heading = design.blocks.find((block) => block.type === "heading");
  const text = design.blocks.find((block) => block.type === "text");
  const custom = {
    ...design,
    blocks: design.blocks.map((block) =>
      block === heading
        ? { ...heading, lines: [{ ...heading.lines[0], paint: gradient("#ff4fa3", "#e0ff3a", 90) }, heading.lines[1]] }
        : block === text
          ? { ...text, style: { ...text.style, paint: gradient("#a1a1aa", "#ffffff", 180) } }
          : block
    )
  };
  const html = render(createElement(PopupDesignCard, { design: custom, popup: popupOf(custom) }));

  assert.match(html, /<span style="[^"]*background-clip:text;background-image:linear-gradient\(90deg, #ff4fa3, #e0ff3a\);color:transparent;-webkit-background-clip:text;-webkit-text-fill-color:transparent[^"]*">Conteúdo novo<\/span>/);
  assert.match(html, /<p style="[^"]*width:fit-content[^"]*linear-gradient\(180deg, #a1a1aa, #ffffff\)[^"]*">Uma aula nova/);
});

test("video: mudo, em loop, inline, autoplay, sem picture-in-picture, com a capa; capa sozinha sem <video>", () => {
  const design = starter("media_top_fade", { video: VIDEO });
  const props = { design, image: IMAGE, over: false, playing: true };
  const video = render(createElement(PopupDesignMedia, { ...props, mode: "video" }));

  assert.match(video, /<video /);
  for (const attribute of ['aria-hidden="true"', 'autoPlay=""', 'disablePictureInPicture=""', 'disableRemotePlayback=""', 'loop=""', 'muted=""', 'playsInline=""', 'preload="auto"', 'tabindex="-1"', `poster="${IMAGE.url}"`]) {
    assert.ok(video.includes(attribute), `<video> com ${attribute}`);
  }
  assert.match(video, new RegExp(`<source src="${VIDEO.url.replace(/[.?]/g, "\\$&")}" type="video/webm"/>`));
  assert.match(video, /object-fit:cover/);
  assert.doesNotMatch(video, /<img/, "o video ja tem a capa (poster): nada de baixar a imagem duas vezes");

  const still = render(createElement(PopupDesignMedia, { ...props, mode: "image" }));
  assert.doesNotMatch(still, /<video|<source/, "menos movimento / Save-Data: nada do video");
  assert.match(still, /<img alt="Capa da aula nova"/);

  const pending = render(createElement(PopupDesignMedia, { ...props, mode: "pending" }));
  assert.doesNotMatch(pending, /<video|<img/);
  assert.match(pending, /data-popup-media="pending"/);

  // O cartao no servidor (previa do admin antes de hidratar): a preferencia ainda nao foi lida.
  const card = render(createElement(PopupDesignCard, { design, popup: popupOf(design) }));
  assert.match(card, /data-popup-media="pending"/);
  assert.doesNotMatch(card, /<video|<img/);
});

test("segundo botao: Fechar e Lembrar depois sao <button>; link e <a> conferido; Lembrar depois some sem adiar", () => {
  const base = starter();
  const withButton2 = (action) => ({ ...base, blocks: [...base.blocks, { ...model.newPopupBlock("button2", "b8"), action, label: "Agora não" }] });

  assert.match(render(createElement(PopupDesignCard, { design: withButton2({ kind: "close" }), popup: popupOf(base) })), /<button class="[^"]*" data-popup-button="close" style="[^"]*" type="button"><span [^>]*>Agora não<\/span><\/button>/);

  const snooze = withButton2({ kind: "snooze" });
  const snoozeHtml = render(createElement(PopupDesignCard, { design: snooze, popup: popupOf(snooze) }));
  assert.match(snoozeHtml, /data-popup-button="snooze"/);
  assert.doesNotMatch(snoozeHtml, />Lembrar depois<\/button>/, "sem repetir o link pequeno");
  assert.doesNotMatch(render(createElement(PopupDesignCard, { design: snooze, popup: popupOf(snooze, { canSnooze: false }) })), /data-popup-button="snooze"/);

  const link = withButton2({ href: "https://exemplo.com/turma", kind: "link", target: "new_tab" });
  assert.match(
    render(createElement(PopupDesignCard, { design: link, popup: popupOf(link) })),
    /<a class="[^"]*" data-popup-button="link" href="https:\/\/exemplo\.com\/turma" style="[^"]*" rel="noopener noreferrer" target="_blank"><span [^>]*>Agora não<\/span><span class="sr-only"> \(abre em nova aba\)<\/span><\/a>/
  );

  // Sem cta (botao principal sem destino), o bloco nao desenha nada.
  assert.doesNotMatch(render(createElement(PopupDesignCard, { design: base, popup: popupOf(base, { cta: null }) })), /data-popup-button="primary"/);
});

test("botoes chamam o handler certo: Fechar = onClose, Lembrar depois = onSnooze, link e principal = onCta", () => {
  const base = starter();
  const calls = [];
  const handlers = {
    onClose: () => calls.push("close"),
    onCta: (_event, link) => calls.push(`cta:${link.href}`),
    onDismiss: () => calls.push("dismiss"),
    onSnooze: () => calls.push("snooze")
  };

  // Percorre a arvore de elementos do React (sem DOM) e aciona o onClick de cada botao do design.
  function clickAll(element, found = []) {
    if (!element || typeof element !== "object") {
      return found;
    }

    if (Array.isArray(element)) {
      element.forEach((child) => clickAll(child, found));
      return found;
    }

    if (typeof element.type === "function") {
      return clickAll(element.type(element.props), found);
    }

    if (element.props?.onClick && element.props["data-popup-button"]) {
      found.push(element.props["data-popup-button"]);
      element.props.onClick({ preventDefault() {} });
    }

    return clickAll(element.props?.children, found);
  }

  const { PopupDesignBlocks } = blocksModule;
  const designs = [
    { ...base, blocks: [...base.blocks, { ...model.newPopupBlock("button2", "b8"), action: { kind: "close" } }] },
    { ...base, blocks: [...base.blocks, { ...model.newPopupBlock("button2", "b8"), action: { kind: "snooze" } }] },
    { ...base, blocks: [...base.blocks, { ...model.newPopupBlock("button2", "b8"), action: { href: "/favoritos", kind: "link", target: "same_tab" } }] }
  ];
  const kinds = designs.map((design) =>
    clickAll(PopupDesignBlocks({ ...handlers, cardWidth: W, design, faces: [], popup: popupOf(design), preview: false }))
  );

  assert.deepEqual(kinds, [["primary", "close"], ["primary", "snooze"], ["primary", "link"]]);
  assert.deepEqual(calls, ["cta:/minhas-compras", "close", "cta:/minhas-compras", "snooze", "cta:/minhas-compras", "cta:/favoritos"]);
});

test("previa do admin: mesmo desenho sem link nem botao com acao (so o X decorativo)", () => {
  const design = { ...starter(), blocks: [...starter().blocks, { ...model.newPopupBlock("button2", "b8"), action: { kind: "close" } }] };
  const html = render(createElement(MemberPopupCard, { popup: popupOf(design), preview: true }));

  assert.doesNotMatch(html, /<a |<button /);
  assert.match(html, /<span data-popup-button="primary"/);
  assert.match(html, /<span data-popup-button="close"/);
  assert.match(html, /<span aria-hidden="true" class="[^"]*size-9/);
  assert.match(html, />Não mostrar de novo</);
});

test("texto do produtor e escapado (nunca HTML) e o design nunca usa dangerouslySetInnerHTML", () => {
  const design = starter();
  const evil = {
    ...design,
    blocks: design.blocks.map((block) =>
      block.type === "heading" ? { ...block, lines: [{ paint: null, size: null, text: '<img src=x onerror="alert(1)">' }] } : block.type === "text" ? { ...block, text: "<script>alert(1)</script>" } : block
    )
  };
  const html = render(createElement(PopupDesignCard, { design: evil, popup: popupOf(evil) }));

  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|onerror="/);
});

test("fontes enviadas: o texto usa a familia bf_ resolvida; o cartao marca quando as fontes terminaram", () => {
  const design = starter();
  const heading = design.blocks.find((block) => block.type === "heading");
  const custom = { ...design, blocks: design.blocks.map((block) => (block === heading ? { ...heading, style: { ...heading.style, font: { id: FONT_FACE.id, kind: "uploaded" } } } : block)) };
  const html = render(createElement(PopupDesignCard, { design: custom, fonts: [FONT_FACE], popup: popupOf(custom) }));

  assert.match(html, /<h2[^>]*style="font-family:&quot;bf_0123456789ab&quot;, system-ui/);
  assert.doesNotMatch(html, /data-fonts-ready/, "com fontes, so depois de carregar");
  assert.match(render(createElement(PopupDesignCard, { design, popup: popupOf(design) })), /data-fonts-ready=""/, "sem fonte enviada: pronto");
});

test("Padrão continua IGUAL ao da v3b-1 (sem design, mesmo HTML) e o Personalizado nunca vaza para ele", () => {
  const popup = {
    audio: null,
    body: "A turma nova começa segunda.",
    canSnooze: true,
    cta: { href: "/minhas-compras", label: "Ver turma", target: "same_tab" },
    id: "p1",
    image: { alt: "Capa", url: "https://exemplo.supabase.co/storage/v1/object/public/content-assets/a.webp" },
    title: "Turma nova"
  };

  assert.equal(withoutSvg(render(createElement(MemberPopupCard, { bodyId: "b", popup, titleId: "t" }))), DEFAULT_CARD_V3B1);
  assert.equal(withoutSvg(render(createElement(MemberPopupCard, { popup: { ...popup, canSnooze: false, cta: null, image: null }, preview: true }))), DEFAULT_PREVIEW_V3B1);
  assert.doesNotMatch(render(createElement(MemberPopupCard, { popup, playing: false })), /data-popup-design/);
});

// HTML do cartao Padrão desenhado pela origin/dev (v3b-1, 914c829) com o mesmo stub do next/image, sem o
// miolo dos <svg> (icones do lucide).
const DEFAULT_CARD_V3B1 =
  '<link rel="preload" as="image" href="https://exemplo.supabase.co/storage/v1/object/public/content-assets/a.webp"/><div class="relative w-[min(28rem,calc(100cqw-2rem))] overflow-hidden rounded-[16px] border border-white/10 bg-[#181818] text-white shadow-[0_24px_80px_rgba(0,0,0,0.7)]"><div class="@container"><div class="relative aspect-video w-full bg-white/[0.04]"><img alt="Capa" class="object-cover" src="https://exemplo.supabase.co/storage/v1/object/public/content-assets/a.webp" data-next-image="" data-sizes="(max-width: 480px) 100vw, 448px" style="position:absolute;inset:0;width:100%;height:100%"/></div><div class="p-5 @min-[26rem]:p-6"><h2 class="text-xl font-bold leading-7 [overflow-wrap:anywhere]" id="t">Turma nova</h2><p class="mt-2 whitespace-pre-line text-sm leading-6 text-zinc-300 [overflow-wrap:anywhere]" id="b">A turma nova começa segunda.</p><div class="mt-5 flex flex-col gap-2"><a class="inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--member-button-radius)] transition-[background-color,border-color,color,box-shadow,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 [&amp;_svg]:shrink-0 bg-white font-extrabold text-black hover:bg-zinc-200 h-12 px-5 text-[15px] [&amp;_svg]:size-5 w-full" href="/minhas-compras"><span class="min-w-0 truncate">Ver turma</span><svg/></a><div class="flex items-center gap-2"><button class="inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--member-button-radius)] font-semibold transition-[background-color,border-color,color,box-shadow,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 [&amp;_svg]:shrink-0 text-zinc-300 hover:bg-white/[0.07] hover:text-white h-9 px-3 text-[13px] [&amp;_svg]:size-4 -ml-3" type="button">Lembrar depois</button><button class="inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--member-button-radius)] font-semibold transition-[background-color,border-color,color,box-shadow,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 [&amp;_svg]:shrink-0 hover:bg-white/[0.07] hover:text-white h-9 px-3 text-[13px] [&amp;_svg]:size-4 -mr-3 ml-auto text-zinc-400" type="button">Não mostrar de novo</button></div></div></div></div><button aria-label="Fechar" class="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-[background-color,scale] duration-150 hover:bg-black/75 motion-reduce:transition-none before:absolute before:-inset-1 before:rounded-full before:content-[&#x27;&#x27;] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" type="button"><svg/></button></div>';

const DEFAULT_PREVIEW_V3B1 =
  '<div class="relative w-[min(28rem,calc(100cqw-2rem))] overflow-hidden rounded-[16px] border border-white/10 bg-[#181818] text-white shadow-[0_24px_80px_rgba(0,0,0,0.7)]"><div class="@container"><div class="p-5 @min-[26rem]:p-6"><h2 class="text-xl font-bold leading-7 [overflow-wrap:anywhere] pr-10">Turma nova</h2><p class="mt-2 whitespace-pre-line text-sm leading-6 text-zinc-300 [overflow-wrap:anywhere]">A turma nova começa segunda.</p><div class="mt-5 flex flex-col gap-2"><div class="flex items-center gap-2"><span class="inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--member-button-radius)] font-semibold transition-[background-color,border-color,color,box-shadow,opacity] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 [&amp;_svg]:shrink-0 hover:bg-white/[0.07] hover:text-white h-9 px-3 text-[13px] [&amp;_svg]:size-4 -mr-3 ml-auto text-zinc-400">Não mostrar de novo</span></div></div></div></div><span aria-hidden="true" class="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur transition-[background-color,scale] duration-150 hover:bg-black/75 motion-reduce:transition-none before:absolute before:-inset-1 before:rounded-full before:content-[&#x27;&#x27;] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"><svg/></span></div>';
