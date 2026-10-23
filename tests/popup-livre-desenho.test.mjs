import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import "./support/resolve-extensionless-ts.mjs";

// Desenho do pop-up Livre do aluno (docs/27; spec §3 e §7.1; docs/18 §1.1): o modulo puro de estilos
// (popup-free-styles.ts) e o cartao de verdade (PopupFreeCard) desenhado com react-dom/server.
// - posicao na sequencia (ocupa a linha, do conteudo, fixa; na coluna e na linha) e solta (cqw, girar, camada);
//   a prancheta crescendo ate o fim dos soltos com altura; altura minima nos elementos com texto;
// - fonte com piso de 12 px, borda em px, pinturas em camadas, esmaecer como mascara, texto em degrade por parte,
//   sublinhado e riscado, links alinhados;
// - o url() so com a origem conferida e um caminho do padrao (maquinas maliciosas e caminhos de fora nao entram);
// - nome e descricao do dialogo, ordem do DOM = Camadas, escondido nao desenhado, decorativos sem clique, o X por
//   cima, o player do Audio clicavel dentro de uma caixa, foco visivel, `sizes`, links, quadriculado da previa,
//   video so com movimento, previa do arrastar sem mudar o design;
// - o HTML do Padrão e do Personalizado igual ao de antes do Livre (tests/fixtures/popup-livre/antes-*.html,
//   gerados no commit-base e555188, antes de qualquer mudanca do Livre);
// - o plano marcando o Livre faz o host pedir o pedaco do cartao antes do POST /show.
//
// Os .tsx do app sao transpilados aqui pelo TypeScript (so JSX -> JS, sem checar tipos); next/image e next/link
// viram stubs simples (o resto e o codigo real).

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
const designModel = await import("../src/server/communications/popup-design-model.ts");
const render = await import("../src/server/communications/popup-free-render.ts");
const schema = await import("../src/server/communications/popup-free-schema.ts");
const styles = await import("../src/components/member/notifications/popup-free/popup-free-styles.ts");
const personalizado = await import("../src/components/member/notifications/popup-design/popup-design-styles.ts");
const hostModel = await import("../src/components/member/notifications/popup-host-model.ts");
const { PopupFreeCard } = await import("../src/components/member/notifications/popup-free/popup-free-card.tsx");
const { FreeNodeView, freeRenderContextOf } = await import("../src/components/member/notifications/popup-free/popup-free-nodes.tsx");
const { loadPopupFreeCard } = await import("../src/components/member/notifications/popup-free/popup-free-load.ts");
const { MemberPopupCard } = await import("../src/components/member/notifications/member-popup.tsx");

const ORIGIN = "https://projeto.supabase.co";
const W = 440;
const len = (px, width = W) => render.freeLength(px, width);
const IMAGE_PATH = "communications/free/0123456789abcdef01234567.webp";
const IMAGE_PATH_2 = "communications/images/89abcdef0123456789abcdef.webp";
const VIDEO_PATH = "videos/0b7f3c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b.webm";
const IMAGE_URL = `${ORIGIN}/storage/v1/object/public/content-assets/${IMAGE_PATH}`;
const VIDEO_URL = `${ORIGIN}/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}`;
const CTA = { href: "/minhas-compras", label: "Assistir agora", target: "same_tab" };
const AUDIO = { durationSeconds: 42, mimeType: "audio/mpeg", peaks: Array.from({ length: 48 }, (_, i) => (i * 7) % 100), url: `${ORIGIN}/storage/v1/object/public/content-assets/communications/audio/a.mp3` };

/** Valida pelo schema do Livre (forma canonica): o que o aluno recebe ja passou por ele. */
function parsed(input) {
  const design = schema.parsePopupFreeDesign({ mode: "free", version: 1, ...input });

  assert.ok(design, `design valido: ${JSON.stringify(input).slice(0, 200)}`);

  return design;
}

/** O modelo "Video no topo com degrade" (spec §2.9), com o video, a capa e uma imagem enviados. */
function starter(overrides = {}) {
  return parsed({
    artboard: {
      align: "center",
      border: { color: "#ffffff1a", width: 1 },
      fill: [{ kind: "linear", stops: [{ at: 0, color: "#111216" }, { at: 55, color: "#16181d" }, { at: 100, color: "#262b34" }] }],
      gap: 0,
      padding: [168, 24, 20, 24],
      shadows: [{ blur: 80, color: "#000000b3", spread: 0, x: 0, y: 24 }]
    },
    assets: [
      { height: 248, id: "capa", kind: "image", path: IMAGE_PATH, width: 440 },
      { id: "vid", kind: "video", mimeType: "video/webm", path: VIDEO_PATH, poster: "capa" }
    ],
    children: [
      { asset: "vid", box: { fade: { end: 100, side: "bottom", start: 40 } }, id: "midia", name: "Vídeo do topo", place: { h: 248, mode: "free", w: 440, x: 0, y: 0 }, type: "video" },
      {
        box: {
          border: { color: "#ff9ccf", width: 1 },
          fill: [{ kind: "linear", stops: [{ at: 0, color: "#e0007a" }, { at: 100, color: "#d1006f" }] }],
          padding: [4, 10],
          radius: 999,
          shadows: [{ blur: 0, color: "#ffffff59", inset: true, spread: 0, x: 0, y: 1 }]
        },
        icon: "gift",
        id: "selo",
        label: "Novidade",
        type: "badge"
      },
      {
        id: "titulo",
        lines: [[{ style: { paint: { color: "#e5ff1f", kind: "solid" } }, text: "Experimente grátis" }], [{ text: "Nova aula ao vivo" }]],
        place: { margin: [12, 0, 0, 0], mode: "flow" },
        textStyle: { align: "center", font: { key: "condensed", kind: "builtin" }, lineHeight: 0.95, size: 40, uppercase: true },
        type: "heading"
      },
      {
        id: "texto",
        lines: [[{ text: "Uma aula nova acabou de entrar na sua área. Assista agora e coloque em prática ainda hoje." }]],
        place: { margin: [12, 0, 0, 0], mode: "flow" },
        textStyle: { align: "center", paint: { color: "#a1a1aa", kind: "solid" } },
        type: "text"
      },
      {
        action: { kind: "cta" },
        box: {
          fill: [{ kind: "linear", stops: [{ at: 0, color: "#f0ff5c" }, { at: 100, color: "#d9f500" }] }],
          padding: [12, 22],
          radius: 10,
          shadows: [
            { blur: 0, color: "#9db300", spread: 0, x: 0, y: 3 },
            { blur: 0, color: "#ffffff80", inset: true, spread: 0, x: 0, y: 1 }
          ]
        },
        id: "botao",
        place: { margin: [24, 0, 0, 0], mode: "flow" },
        textStyle: { paint: { color: "#111216", kind: "solid" } },
        type: "button"
      },
      { id: "links", place: { margin: [12, 0, 0, 0], mode: "flow" }, textStyle: { align: "center", paint: { color: "#a1a1aa", kind: "solid" } }, type: "links" }
    ],
    close: { background: "#ffffff40", size: 28 },
    ...overrides
  });
}

function popupOf(design, overrides = {}) {
  return {
    audio: null,
    body: "",
    canSnooze: true,
    cta: CTA,
    fonts: [],
    freeDesign: design,
    id: "p1",
    image: null,
    title: "Nome do pop-up nas listas",
    ...overrides
  };
}

const html = (element) => renderToStaticMarkup(element);
const card = (design, { popup, ...props } = {}) => html(createElement(PopupFreeCard, { bodyId: "b", design, popup: popupOf(design, popup), storageOrigin: ORIGIN, titleId: "t", ...props }));
const ctxOf = (design, { popup, ...input } = {}) => freeRenderContextOf({ design, faces: [], motion: "motion", origin: ORIGIN, popup: popupOf(design, popup), ...input });
const nodeHtml = (design, id, input = {}) => {
  const node = design.children.find((child) => child.id === id);

  return html(createElement(FreeNodeView, { ctx: ctxOf(design, input), node, parentDir: "column" }));
};
const styleCtx = (design, input = {}) => styles.freeStyleContext(design, { origin: ORIGIN, ...input });
/** O atributo style do elemento com data-free-id = id. */
function styleOfId(markup, id) {
  const match = new RegExp(`<[a-z0-9]+[^>]*data-free-id="${id}"[^>]*>`).exec(markup);

  assert.ok(match, `elemento ${id} desenhado`);

  return /style="([^"]*)"/.exec(match[0])?.[1] ?? "";
}

/* ------------------------------------------------------------------------------------------------
 * Posicao
 * ---------------------------------------------------------------------------------------------- */

test("na sequência: largura ocupa a linha, do conteúdo e fixa, na coluna e na linha", () => {
  const design = parsed({
    children: [
      { id: "texto", lines: [[{ text: "Oi" }]], type: "text" },
      { id: "selo", label: "Novo", type: "badge" },
      { id: "fixo", lines: [[{ text: "Fixo" }]], place: { align: "end", mode: "flow", width: 200 }, type: "heading" },
      { id: "links", type: "links" }
    ]
  });
  const ctx = styleCtx(design);
  const [texto, selo, fixo] = design.children;

  // Coluna: ocupa a linha = esticado; do conteudo = fit-content; fixa = cqw, nunca maior que a caixa.
  assert.equal(styles.freePlaceCss(texto, ctx, "column").alignSelf, "stretch");
  assert.equal(styles.freePlaceCss(texto, ctx, "column").width, undefined);
  assert.deepEqual(
    { maxWidth: styles.freePlaceCss(selo, ctx, "column").maxWidth, width: styles.freePlaceCss(selo, ctx, "column").width },
    { maxWidth: "100%", width: "fit-content" },
    "selo, botao e icone ficam do tamanho do conteudo sem escolha"
  );
  assert.deepEqual(
    { alignSelf: styles.freePlaceCss(fixo, ctx, "column").alignSelf, maxWidth: styles.freePlaceCss(fixo, ctx, "column").maxWidth, width: styles.freePlaceCss(fixo, ctx, "column").width },
    { alignSelf: "flex-end", maxWidth: "100%", width: len(200) }
  );

  // Linha: ocupa a linha = divide o espaco; do conteudo = nao cresce; fixa = nao cresce com a largura em cqw.
  assert.equal(styles.freePlaceCss(texto, ctx, "row").flex, "1 1 0");
  assert.equal(styles.freePlaceCss(selo, ctx, "row").flex, "none");
  assert.equal(styles.freePlaceCss(selo, ctx, "row").width, undefined);
  assert.deepEqual({ flex: styles.freePlaceCss(fixo, ctx, "row").flex, width: styles.freePlaceCss(fixo, ctx, "row").width }, { flex: "none", width: len(200) });

  for (const node of [texto, selo, fixo]) {
    assert.equal(styles.freePlaceCss(node, ctx).position, "relative");
    assert.equal(styles.freePlaceCss(node, ctx).minWidth, 0, "texto longo quebra em vez de alargar a caixa");
  }

  // Margens (inclusive negativas, para sobrepor) e camada; sem margem, 0 explicito.
  const sobe = { ...texto, place: { margin: [-40, 0, 0, 0], mode: "flow", z: 2 } };
  assert.equal(styles.freePlaceCss(sobe, ctx).margin, `${len(-40)} 0px 0px 0px`);
  assert.equal(styles.freePlaceCss(sobe, ctx).zIndex, 2);
  assert.equal(styles.freePlaceCss(texto, ctx).margin, 0);

  // No cartao, a margem escolhida chega ao titulo, ao texto e ao botao (a tipografia nao a zera).
  const desenhado = card(starter());
  for (const [id, margin] of [["titulo", 12], ["texto", 12], ["botao", 24], ["links", 12]]) {
    const style = styleOfId(desenhado, id);
    assert.ok(style.includes(`margin:${len(margin)} 0px 0px 0px`), `${id}: ${style}`);
    assert.equal((style.match(/(?:^|;)margin:/g) ?? []).length, 1, `${id}: uma margem so`);
  }

  // Caixa em linha: os filhos recebem a direcao da caixa no desenho.
  const row = parsed({
    children: [
      { children: [{ id: "a", lines: [[{ text: "A" }]], type: "text" }, { id: "b", label: "B", type: "badge" }], id: "caixa", layout: { align: "center", dir: "row", gap: 8 }, type: "box" },
      { id: "links", type: "links" }
    ]
  });
  const markup = card(row);
  assert.match(styleOfId(markup, "caixa"), /display:flex;flex-direction:row;flex-wrap:nowrap;gap:1\.8182cqw;justify-content:flex-start/);
  assert.match(styleOfId(markup, "a"), /flex:1 1 0/);
  assert.match(styleOfId(markup, "b"), /flex:none/);
});

test("solto: left, top, width e height em cqw, girar e camada", () => {
  const design = parsed({
    children: [
      { box: { fill: [{ color: "#ff0000", kind: "solid" }] }, id: "forma", place: { h: 60, mode: "free", rotate: -12, w: 200, x: 24, y: 120, z: 3 }, type: "shape" },
      { id: "links", type: "links" }
    ]
  });
  const css = styles.freePlaceCss(design.children[0], styleCtx(design));

  assert.deepEqual(css, {
    height: len(60),
    left: len(24),
    margin: 0,
    position: "absolute",
    top: len(120),
    transform: "rotate(-12deg)",
    transformOrigin: "center",
    width: len(200),
    zIndex: 3
  });
  const drawn = styleOfId(card(design), "forma");
  for (const part of ["position:absolute", "left:5.4545cqw", "top:27.2727cqw", "width:45.4545cqw", "height:13.6364cqw", "transform:rotate(-12deg)", "transform-origin:center", "z-index:3"]) {
    assert.ok(drawn.includes(part), `${part} em ${drawn}`);
  }

  // Sem girar e sem camada: nada de transform nem z-index (a ordem do DOM decide).
  const plain = styles.freePlaceCss({ ...design.children[0], place: { mode: "free", w: 100, x: -20, y: 0 } }, styleCtx(design));
  assert.equal(plain.transform, undefined);
  assert.equal(plain.zIndex, undefined);
  assert.equal(plain.left, len(-20), "X negativo sai pela esquerda (a prancheta corta)");
  assert.equal(plain.height, undefined, "sem altura = automatica");
});

test("a prancheta cresce até o fim dos soltos com altura fixa", () => {
  const solto = (id, place, extra = {}) => ({ box: { fill: [{ color: "#ffffff", kind: "solid" }] }, id, place: { mode: "free", ...place }, type: "shape", ...extra });
  const design = parsed({
    children: [
      solto("alto", { h: 200, w: 100, x: 0, y: 300 }),
      solto("escondido", { h: 900, w: 100, x: 0, y: 900 }, { hidden: true }),
      { id: "semaltura", lines: [[{ text: "Sem altura" }]], place: { mode: "free", w: 200, x: 0, y: 1200 }, type: "text" },
      { id: "links", type: "links" }
    ]
  });

  assert.equal(render.freeArtboardMinHeight(design), 500, "300 + 200; o escondido e o sem altura nao contam");
  assert.match(styles.freeArtboardCss(design, styleCtx(design)).minHeight, /^113\.6364cqw$/);
  assert.equal(styles.freeArtboardCss({ ...design, artboard: { minHeight: 600 } }, styleCtx(design)).minHeight, len(600), "a altura minima escolhida vale quando e maior");

  const css = styles.freeArtboardCss(design, styleCtx(design));
  assert.equal(css.position, "relative");
  assert.equal(css.overflow, "hidden", "nada passa da prancheta");
  assert.equal(css.isolation, "isolate", "camadas negativas ficam acima do fundo dela");
  assert.equal(css.flexDirection, "column");
});

test("elementos com texto usam altura mínima", () => {
  const design = parsed({
    children: [
      { id: "titulo", lines: [[{ text: "Título" }]], place: { height: 80, mode: "flow" }, type: "heading" },
      { action: { kind: "close" }, id: "fechar", label: "Agora não", place: { h: 50, mode: "free", w: 120, x: 10, y: 10 }, type: "button" },
      { children: [], id: "caixa", place: { height: 60, mode: "flow" }, type: "box" },
      { box: { fill: [{ color: "#ffffff", kind: "solid" }] }, id: "forma", place: { height: 40, mode: "flow" }, type: "shape" },
      { id: "linha", place: { height: 4, mode: "flow" }, type: "divider" },
      { id: "links", type: "links" }
    ]
  });
  const ctx = styleCtx(design);
  const [titulo, fechar, caixa, forma] = design.children;

  assert.deepEqual([styles.freePlaceCss(titulo, ctx).minHeight, styles.freePlaceCss(titulo, ctx).height], [len(80), undefined], "o texto empurra a caixa em vez de vazar");
  assert.deepEqual([styles.freePlaceCss(fechar, ctx).minHeight, styles.freePlaceCss(fechar, ctx).height], [len(50), undefined]);
  assert.equal(styles.freePlaceCss(caixa, ctx).minHeight, len(60));
  assert.deepEqual([styles.freePlaceCss(forma, ctx).height, styles.freePlaceCss(forma, ctx).minHeight], [len(40), undefined], "forma tem altura fixa");

  for (const type of ["heading", "text", "badge", "button", "links", "box", "audio"]) {
    assert.equal(styles.freeUsesMinHeight(type), true, type);
  }

  for (const type of ["image", "video", "shape", "divider", "spacer", "icon"]) {
    assert.equal(styles.freeUsesMinHeight(type), false, type);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Fonte, borda, pinturas, mascara, texto
 * ---------------------------------------------------------------------------------------------- */

test("fonte com piso de 12 px e borda em px", () => {
  const design = starter();
  const ctx = styleCtx(design);
  const titulo = design.children.find((node) => node.id === "titulo");
  const css = styles.freeTextCss(render.freeTextStyleOf(titulo), ctx);

  assert.equal(css.fontSize, "max(12px, 9.0909cqw)", "40 px na prancheta de 440, nunca abaixo de 12 px");
  assert.equal(styles.freeTextCss({ ...render.freeTextStyleOf(titulo), size: 10 }, ctx).fontSize, "max(10px, 2.2727cqw)", "abaixo de 12 fica o proprio valor (nunca maior)");
  assert.equal(css.fontStretch, "condensed");
  assert.equal(css.textTransform, "uppercase");
  assert.equal(css.lineHeight, 0.95);
  assert.equal(css.letterSpacing, "0em");
  assert.equal(css.overflowWrap, "anywhere");
  assert.equal(css.margin, undefined, "a tipografia nunca zera a margem que a posicao escolheu");

  // Fonte enviada: a familia bf_ resolvida; sem a fonte, o sistema.
  const face = { family: "bf_0123456789ab", format: "woff2", id: "3b0f6c1e-2a4d-4e5f-8a9b-0c1d2e3f4a5b", style: "normal", url: `${ORIGIN}/x.woff2`, weight: 400 };
  const uploaded = { ...render.freeTextStyleOf(titulo), font: { id: face.id, kind: "uploaded" } };
  assert.match(styles.freeTextCss(uploaded, { faces: [face], width: W }).fontFamily, /^"bf_0123456789ab", system-ui/);
  assert.doesNotMatch(styles.freeTextCss(uploaded, { faces: [], width: W }).fontFamily, /bf_/);

  // Borda em px (nitidez), mesmo encolhendo; cantos e sombras em cqw.
  const selo = design.children.find((node) => node.id === "selo");
  const box = styles.freeBoxCss(selo.box, ctx);
  assert.equal(box.border, "1px solid #ff9ccf");
  assert.equal(box.borderRadius, len(999));
  assert.equal(box.padding, `${len(4)} ${len(10)}`);
  assert.equal(box.boxShadow, `inset 0px ${len(1)} 0px 0px #ffffff59`);
  assert.equal(styles.freeArtboardCss(design, ctx).border, "1px solid #ffffff1a");
  assert.equal(styles.freeBorderCss({ color: "#ffffff", style: "dashed", width: 2 }), "2px dashed #ffffff");
  assert.equal(styles.freeBorderCss({ color: "#ffffff", width: 0 }), "none");
  assert.equal(styles.freeDividerCss({ color: "#ffffff33", id: "l", thickness: 3, type: "divider" }).borderTop, "3px solid #ffffff33", "linha em px");
});

test("pinturas: sólida, linear, circular e imagem em camadas", () => {
  const design = parsed({
    assets: [{ height: 48, id: "img", kind: "image", path: IMAGE_PATH, width: 64 }],
    children: [{ id: "links", type: "links" }],
    artboard: {
      fill: [
        { asset: "img", fit: "tile", focus: [10, 90], kind: "image" },
        { angle: 90, kind: "linear", stops: [{ at: 100, color: "#ffffff00" }, { at: 0, color: "#ffffff" }] },
        { extent: "closest-side", kind: "radial", shape: "circle", stops: [{ at: 0, color: "#ff00ff99" }, { at: 100, color: "#ff00ff00" }], x: 20, y: 30 }
      ]
    }
  });
  const ctx = styleCtx(design);
  const css = styles.freeArtboardCss(design, ctx);

  assert.equal(
    css.backgroundImage,
    `url("${IMAGE_URL}"), linear-gradient(90deg, #ffffff 0%, #ffffff00 100%), radial-gradient(circle closest-side at 20% 30%, #ff00ff99 0%, #ff00ff00 100%)`,
    "a primeira camada fica por cima; paradas em ordem"
  );
  assert.equal(css.backgroundRepeat, "repeat, no-repeat, no-repeat");
  assert.equal(css.backgroundPosition, "10% 90%, 50% 50%, 50% 50%");
  assert.equal(css.backgroundSize, `${len(64)} ${len(48)}, 100% 100%, 100% 100%`, "repetindo no tamanho do arquivo, encolhendo junto");

  assert.deepEqual(styles.freeFillCss([{ color: "#16181c", kind: "solid" }], ctx), {
    backgroundImage: "linear-gradient(#16181c, #16181c)",
    backgroundPosition: "50% 50%",
    backgroundRepeat: "no-repeat",
    backgroundSize: "100% 100%"
  });
  assert.equal(styles.freeFillCss([{ asset: "img", kind: "image" }], ctx).backgroundSize, "cover");
  assert.equal(styles.freeFillCss([{ asset: "img", fit: "contain", kind: "image" }], ctx).backgroundSize, "contain");
  assert.equal(styles.freeGradientCss({ kind: "linear", stops: [{ at: 0, color: "#000000" }, { at: 100, color: "#ffffff" }] }), "linear-gradient(180deg, #000000 0%, #ffffff 100%)", "180 graus sem escolha");
  assert.equal(
    styles.freeGradientCss({ kind: "radial", stops: [{ at: 0, color: "#000000" }, { at: 100, color: "#ffffff" }], x: 50, y: 50 }),
    "radial-gradient(ellipse farthest-corner at 50% 50%, #000000 0%, #ffffff 100%)"
  );

  // Sem camada que desenhe (imagem sem origem): a cor padrao, o texto nunca cai direto no veu.
  const noOrigin = styles.freeArtboardCss({ ...design, artboard: { fill: [{ asset: "img", kind: "image" }] } }, { ...ctx, origin: null });
  assert.equal(noOrigin.backgroundImage, undefined);
  assert.equal(noOrigin.backgroundColor, "#16181c");
});

test("o backgroundImage só contém a origem conferida: máquina maliciosa, caminho fora do padrão ou sem origem não entram no url()", () => {
  const assets = (path) => [{ height: 48, id: "img", kind: "image", path, width: 64 }];
  const fill = [{ asset: "img", kind: "image" }];
  const ok = styles.freeFillCss(fill, { assets: assets(IMAGE_PATH), origin: ORIGIN, width: W });

  assert.equal(ok.backgroundImage, `url("${IMAGE_URL}")`);
  assert.equal(styles.freeFillCss(fill, { assets: assets(IMAGE_PATH_2), origin: ORIGIN, width: W }).backgroundImage, `url("${ORIGIN}/storage/v1/object/public/content-assets/${IMAGE_PATH_2}")`, "imagem do aviso reaproveitada");
  assert.equal(styles.freeFillCss(fill, { assets: assets(IMAGE_PATH), origin: "http://127.0.0.1:54321", width: W }).backgroundImage, `url("http://127.0.0.1:54321/storage/v1/object/public/content-assets/${IMAGE_PATH}")`, "Supabase local");

  const maliciousOrigins = [
    'https://x.supabase.co"),url("https://evil.example',
    "https://evil.example'),url('x",
    "https://evil(1).example",
    "https://a,b.example",
    "https://a;b.example",
    "https://a b.example",
    "https://a\\b.example",
    "https://user:senha@projeto.supabase.co",
    "https://projeto.supabase.co/caminho",
    "https://projeto.supabase.co?x=1",
    "http://projeto.supabase.co",
    "javascript:alert(1)",
    "",
    null
  ];

  for (const origin of maliciousOrigins) {
    const css = styles.freeFillCss(fill, { assets: assets(IMAGE_PATH), origin, width: W });
    assert.equal(css.backgroundImage, undefined, `origem ${origin}`);
    assert.equal(render.freeStorageOrigin(origin), null, `freeStorageOrigin recusa ${origin}`);
  }

  const badPaths = [
    "communications/free/../../segredo.webp",
    'communications/free/0123456789abcdef01234567.webp") , url("https://evil',
    "communications/free/0123456789ABCDEF01234567.webp",
    "communications/outro/0123456789abcdef01234567.webp",
    "https://evil.example/a.webp",
    "communications/free/0123456789abcdef01234567.png"
  ];

  for (const path of badPaths) {
    assert.equal(styles.freeFillCss(fill, { assets: assets(path), origin: ORIGIN, width: W }).backgroundImage, undefined, `caminho ${path}`);
  }

  // O cartao inteiro com uma origem maliciosa: nenhum url(, nenhuma imagem, nenhum video.
  const design = parsed({
    artboard: { fill: [{ asset: "capa", kind: "image" }, { color: "#000000", kind: "solid" }] },
    assets: [{ height: 248, id: "capa", kind: "image", path: IMAGE_PATH, width: 440 }],
    children: [
      { asset: "capa", id: "img", place: { h: 100, mode: "free", w: 100, x: 0, y: 0 }, type: "image" },
      { box: { fill: [{ asset: "capa", kind: "image" }] }, id: "forma", place: { h: 100, mode: "free", w: 100, x: 0, y: 0 }, type: "shape" },
      { id: "links", type: "links" }
    ]
  });
  const evil = card(design, { storageOrigin: 'https://evil.example"),url("x' });
  assert.doesNotMatch(evil, /url\(/);
  assert.doesNotMatch(evil, /evil/);
  assert.doesNotMatch(evil, /<img/);
  assert.match(card(design), /url\(&quot;https:\/\/projeto\.supabase\.co\/storage\/v1\/object\/public\/content-assets\/communications\/free\/0123456789abcdef01234567\.webp&quot;\)/);
});

test("esmaecer vira máscara com paradas suavizadas nos quatro lados", () => {
  assert.equal(styles.freeFadeMaskCss({ end: 100, side: "bottom", start: 40 }), "linear-gradient(to bottom, #000 40%, #000000a6 67%, #00000040 85%, #0000 100%)");
  assert.equal(styles.freeFadeMaskCss({ end: 60, side: "top", start: 0 }), "linear-gradient(to top, #000 0%, #000000a6 27%, #00000040 45%, #0000 60%)");
  assert.equal(styles.freeFadeMaskCss({ end: 95, side: "left", start: 90 }), "linear-gradient(to left, #000 90%, #000000a6 92.25%, #00000040 93.75%, #0000 95%)");
  assert.equal(styles.freeFadeMaskCss({ end: 50, side: "right", start: 10 }), "linear-gradient(to right, #000 10%, #000000a6 28%, #00000040 40%, #0000 50%)");

  const box = styles.freeBoxCss({ fade: { end: 100, side: "bottom", start: 40 } }, { assets: [], origin: ORIGIN, width: W });
  assert.equal(box.maskImage, box.WebkitMaskImage, "Safari/iOS pedem o prefixo");
  assert.match(box.maskImage, /^linear-gradient\(to bottom/);

  // No cartao: a mascara vai na caixa do video (o fundo de verdade da prancheta aparece por baixo).
  assert.match(styleOfId(card(starter()), "midia"), /mask-image:linear-gradient\(to bottom, #000 40%/);
});

test("texto em degradê por parte com background-clip e cor de seleção", () => {
  const paint = { angle: 90, kind: "linear", stops: [{ at: 0, color: "#c084fc" }, { at: 100, color: "#22d3ee" }] };
  const design = parsed({
    children: [
      { id: "titulo", lines: [[{ text: "Sua próxima aula " }, { style: { paint }, text: "começa às 20h" }]], textStyle: { align: "center" }, type: "heading" },
      { id: "texto", lines: [[{ text: "Tudo em degradê" }]], textStyle: { paint }, type: "text" },
      { id: "links", type: "links" }
    ]
  });
  const element = render.freeTextStyleOf(design.children[0]);
  const plain = styles.freeSpanCss(undefined, element, { faces: [], width: W });
  const gradient = styles.freeSpanCss({ paint }, element, { faces: [], width: W });

  assert.deepEqual(plain, { gradient: false, style: undefined }, "parte sem estilo herda do elemento");
  assert.equal(gradient.gradient, true);
  assert.equal(gradient.style.backgroundImage, "linear-gradient(90deg, #c084fc 0%, #22d3ee 100%)");
  assert.equal(gradient.style.backgroundClip, "text");
  assert.equal(gradient.style.WebkitBackgroundClip, "text");
  assert.equal(gradient.style.color, "transparent");
  assert.equal(gradient.style.WebkitTextFillColor, "transparent");
  assert.equal(gradient.style.WebkitBoxDecorationBreak, "clone", "o degrade acompanha cada linha quebrada");
  assert.equal(styles.freeSpanCss({ paint: { color: "#e5ff1f", kind: "solid" } }, element, { faces: [], width: W }).style.color, "#e5ff1f");

  const markup = card(design);
  // So a parte em degrade leva a classe da selecao; o elemento em degrade passa o degrade para cada parte.
  assert.match(markup, /<span class="selection:bg-white\/80 selection:text-black[^"]*" style="background-clip:text;background-image:linear-gradient\(90deg, #c084fc 0%, #22d3ee 100%\)[^"]*">começa às 20h<\/span>/);
  assert.match(markup, /<span>Sua próxima aula <\/span>/);
  assert.match(markup, /<p[^>]*data-free-id="texto"[^>]*style="[^"]*color:#c084fc[^"]*"><span class="selection:bg-white\/80[^"]*" style="background-clip:text[^"]*">Tudo em degradê<\/span>/, "o elemento fica com a primeira cor (icones)");
});

test("sublinhado e riscado", () => {
  const design = parsed({
    children: [
      { id: "preco", lines: [[{ style: { decoration: "line-through", paint: { color: "#a1a1aa", kind: "solid" } }, text: "R$ 997" }, { text: " por R$ 497" }]], type: "text" },
      { id: "nota", lines: [[{ text: "Leia o regulamento" }]], textStyle: { decoration: "underline" }, type: "text" },
      { id: "links", type: "links" }
    ]
  });
  const [preco, nota] = design.children;

  assert.equal(styles.freeTextCss(render.freeTextStyleOf(preco), { faces: [], width: W }).textDecorationLine, "none");
  assert.equal(styles.freeTextCss(render.freeTextStyleOf(nota), { faces: [], width: W }).textDecorationLine, "underline");

  const markup = card(design);
  assert.match(markup, /<span style="color:#a1a1aa;text-decoration-line:line-through">R\$ 997<\/span><span> por R\$ 497<\/span>/);
  assert.match(styleOfId(markup, "nota"), /text-decoration-line:underline/);
});

test("links alinham pela textStyle.align", () => {
  const links = (align) => ({ id: "links", type: "links", ...(align ? { textStyle: { align } } : {}) });
  const justify = (align) => {
    const design = parsed({ children: [links(align)] });
    const node = design.children[0];

    return styles.freeLinksRowCss(node, render.freeTextStyleOf(node), { width: W }).justifyContent;
  };

  assert.equal(justify(undefined), "flex-start", "esquerda sem escolha");
  assert.equal(justify("center"), "center");
  assert.equal(justify("right"), "flex-end");
  assert.match(styleOfId(card(starter()), "links"), /display:flex;flex-wrap:wrap;justify-content:center/);
  assert.equal(styles.freeLinksRowCss({ gap: 20, id: "l", type: "links" }, render.freeTextStyleOf({ id: "l", type: "links" }), { width: W }).columnGap, len(20));
});

/* ------------------------------------------------------------------------------------------------
 * Nome do dialogo, descricao, ordem e clique
 * ---------------------------------------------------------------------------------------------- */

test("o primeiro título é o h2 e dá nome ao diálogo; sem título vale o nome do pop-up", () => {
  const ids = { bodyId: "b", titleId: "t" };
  const design = parsed({
    children: [
      { hidden: true, id: "oculto", lines: [[{ text: "Escondido" }]], type: "heading" },
      { id: "titulo", lines: [[{ text: "Experimente " }, { style: { paint: { color: "#e5ff1f", kind: "solid" } }, text: "grátis" }], [{ text: "Nova aula" }]], type: "heading" },
      { id: "outro", lines: [[{ text: "Segundo título" }]], type: "heading" },
      { id: "links", type: "links" }
    ]
  });
  const markup = card(design);

  assert.match(markup, /<h2 data-free-id="titulo" id="t"[^>]*><span style="display:block"><span>Experimente <\/span><span style="color:#e5ff1f">grátis<\/span><\/span> <span style="display:block"><span>Nova aula<\/span><\/span><\/h2>/, "espaco entre as linhas: o nome nao cola palavras");
  assert.match(markup, /<h3 data-free-id="outro"/);
  assert.doesNotMatch(markup, /Escondido/);
  assert.deepEqual(render.popupFreeDialogAria(popupOf(design), ids), { "aria-describedby": undefined, "aria-labelledby": "t" });
  assert.equal(render.freeAccessibleName(design, "x").label, "Experimente grátis Nova aula");

  const sem = parsed({ children: [{ id: "texto", lines: [[{ text: "Só texto" }]], type: "text" }, { id: "links", type: "links" }] });
  assert.deepEqual(render.popupFreeDialogAria(popupOf(sem, { title: "Nome do pop-up" }), ids), { "aria-describedby": "b", "aria-label": "Nome do pop-up" });
  assert.doesNotMatch(card(sem), /<h2/);
});

test("o primeiro texto descreve o diálogo", async () => {
  const design = parsed({
    children: [
      { children: [{ id: "texto", lines: [[{ text: "Primeira linha" }], [{ text: "Segunda linha" }]], type: "text" }], id: "caixa", type: "box" },
      { id: "texto2", lines: [[{ text: "Outro texto" }]], type: "text" },
      { id: "links", type: "links" }
    ]
  });
  const markup = card(design);

  assert.match(markup, /<p data-free-id="texto" id="b"[^>]*><span>Primeira linha<\/span><br\/><span>Segunda linha<\/span><\/p>/, "linhas separadas por <br>");
  assert.match(markup, /<p data-free-id="texto2" style=/, "so o primeiro leva o id da descricao");
  assert.equal(render.popupFreeDialogAria(popupOf(design), { bodyId: "b", titleId: "t" })["aria-describedby"], "b");
  // O dialogo escolhe a aria do Livre so quando ha freeDesign (o Personalizado continua com a dele), lida do pedaco
  // do cartao Livre ja baixado (que reexporta a popupFreeDialogAria de popup-free-render.ts).
  const dialogSource = readFileSync(new URL("src/components/member/notifications/member-popup-dialog.tsx", root), "utf8");
  assert.match(dialogSource, /popup\.freeDesign \? freeDialogAria\(popup, \{ bodyId, titleId \}\) : popupDialogAria\(popup, \{ bodyId, titleId \}\)/);
  assert.match(dialogSource, /loadedPopupFreeCard\(\)\?\.popupFreeDialogAria\(popup, ids\) \?\? \{ "aria-label": popup\.title \}/);
  assert.equal((await loadPopupFreeCard()).popupFreeDialogAria, render.popupFreeDialogAria, "a mesma funcao de popup-free-render.ts");
});

test("vídeo só com movimento; menos movimento e Save-Data mostram o pôster, e sem pôster só o fundo", () => {
  const design = starter();
  const video = design.children.find((node) => node.id === "midia");
  const ctx = styleCtx(design);

  assert.deepEqual(styles.freeVideoMode(video, ctx, "motion"), { mode: "video", poster: IMAGE_URL, src: VIDEO_URL });
  assert.deepEqual(styles.freeVideoMode(video, ctx, "still"), { mode: "poster", poster: IMAGE_URL, src: null });
  assert.deepEqual(styles.freeVideoMode(video, ctx, "pending"), { mode: "pending", poster: null, src: null }, "no servidor nada e baixado");

  // A preferencia vem das mesmas leituras do Personalizado (usePopupMotion): menos movimento e Save-Data = parado.
  const still = (win) => (personalizado.prefersStillMedia(personalizado.readMotionPreferences(win)) ? "still" : "motion");
  assert.equal(still({ matchMedia: () => ({ matches: true }) }), "still");
  assert.equal(still({ matchMedia: () => ({ matches: false }), navigator: { connection: { saveData: true } } }), "still");
  assert.equal(still({ matchMedia: () => ({ matches: false }), navigator: {} }), "motion");

  const playing = nodeHtml(design, "midia", { motion: "motion" });
  assert.match(playing, /<video aria-hidden="true" autoPlay="" disablePictureInPicture="" disableRemotePlayback="" loop="" muted="" playsInline="" poster="[^"]+" preload="auto" style="[^"]*" tabindex="-1"><source src="https:\/\/projeto\.supabase\.co\/storage\/v1\/object\/public\/communication-popup-video\/videos\/[^"]+\.webm" type="video\/webm"\/><\/video>/);
  assert.doesNotMatch(playing, /<img/);

  const reduced = nodeHtml(design, "midia", { motion: "still" });
  assert.doesNotMatch(reduced, /<video/);
  assert.match(reduced, /<img alt="" draggable="false" src="https:\/\/projeto\.supabase\.co\/storage\/v1\/object\/public\/content-assets\/communications\/free\/0123456789abcdef01234567\.webp"/);

  const semCapa = parsed({ ...design, assets: [{ id: "vid", kind: "video", mimeType: "video/webm", path: VIDEO_PATH }] });
  const fundo = nodeHtml(semCapa, "midia", { motion: "still" });
  assert.doesNotMatch(fundo, /<video|<img/, "sem capa e sem movimento: so o fundo do elemento");
  assert.match(fundo, /data-free-id="midia" data-free-media="none"/);
  assert.match(nodeHtml(semCapa, "midia", { motion: "motion" }), /<video[^>]*preload="auto"/, "com movimento toca mesmo sem capa");

  // Video de fora do padrao (mp4 com extensao webm) nunca monta endereco: o poster.
  assert.equal(styles.freeVideoMode(video, styleCtx({ ...design, assets: [design.assets[0], { id: "vid", kind: "video", mimeType: "video/mp4", path: VIDEO_PATH, poster: "capa" }] }), "motion").mode, "poster");

  // O cartao no servidor (sem preferencia lida): nenhum <video> e nenhuma capa baixada.
  const server = card(design);
  assert.doesNotMatch(server, /<video/);
  assert.match(server, /data-free-media="pending"/);
});

test("decorativos não recebem clique e o X fica por cima", () => {
  for (const type of ["shape", "divider", "spacer", "icon", "image", "video", "box"]) {
    assert.equal(styles.freePointerEvents({ id: "x", type }, false), "none", type);
  }

  for (const type of ["heading", "text", "badge", "button", "links", "audio"]) {
    assert.equal(styles.freePointerEvents({ id: "x", type }, false), "auto", type);
  }

  assert.equal(styles.freePointerEvents({ id: "x", type: "shape" }, true), "auto", "na previa tudo e selecionavel");
  assert.equal(styles.freePointerEvents({ id: "x", locked: true, type: "heading" }, true), "none", "menos os travados");

  const design = parsed({
    children: [
      { action: { kind: "cta" }, id: "botao", type: "button" },
      { box: { fill: [{ color: "#ff000080", kind: "solid" }] }, id: "forma", place: { h: 400, mode: "free", w: 440, x: 0, y: 0, z: 10 }, type: "shape" },
      { id: "links", type: "links" }
    ]
  });
  const markup = card(design);

  assert.match(styleOfId(markup, "forma"), /z-index:10;/);
  assert.match(styleOfId(markup, "forma"), /pointer-events:none/, "a forma por cima do botao nao bloqueia o clique");
  assert.match(styleOfId(markup, "botao"), /pointer-events:auto/);

  // O X: depois da prancheta (ultimo no DOM, fora dela), por cima de tudo, com nome.
  const close = /<button aria-label="Fechar" class="([^"]*)" data-free-close="" style="([^"]*)" type="button">/.exec(markup);
  assert.ok(close, "o X e um botao com nome");
  assert.match(close[2], /position:absolute;top:12px;width:36px;z-index:60;right:12px/);
  assert.ok(markup.lastIndexOf("data-free-close") > markup.lastIndexOf("data-free-id"), "o X vem depois de todos os elementos");
  assert.match(markup, /<\/div><button aria-label="Fechar"/, "fora da prancheta");

  const left = styles.freeCloseCss({ close: { background: "#000000", color: "#ffffff", inset: 20, side: "left", size: 44 } });
  assert.equal(left.button.left, "20px");
  assert.equal(left.button.right, undefined);
  assert.equal(left.button.width, "44px");
  assert.equal(left.icon.width, "24px");
  assert.equal(styles.freeCloseCss({ close: { border: { color: "#ffffff", width: 2 } } }).button.border, "2px solid #ffffff");
});

test("o player do Áudio dentro de uma Caixa recebe clique", () => {
  const design = parsed({
    children: [{ children: [{ id: "audio", type: "audio" }], id: "caixa", type: "box" }, { id: "links", type: "links" }]
  });
  const markup = card(design, { popup: { audio: AUDIO } });

  assert.match(styleOfId(markup, "caixa"), /pointer-events:none/);
  assert.match(styleOfId(markup, "audio"), /pointer-events:auto/, "o invólucro devolve o clique (pointer-events e herdado)");
  assert.match(markup, /data-free-id="audio"[^>]*>[\s\S]*Áudio do aviso/);
  assert.doesNotMatch(card(design), /data-free-id="audio"/, "sem audio no aviso, o elemento nao aparece");
});

test("botões, links e o X levam as classes de foco visível", () => {
  const design = parsed({
    children: [
      { action: { kind: "cta" }, id: "botao", type: "button" },
      { action: { kind: "close" }, id: "fechar", label: "Agora não", type: "button" },
      { action: { href: "https://exemplo.com.br/oferta", kind: "link", target: "new_tab" }, id: "link", label: "Ver página", type: "button" },
      { id: "links", type: "links" }
    ]
  });
  const markup = card(design);
  const classes = [...markup.matchAll(/<(?:a|button)[^>]*class="([^"]*)"/g)].map((match) => match[1]);

  assert.equal(classes.length, 6, "principal, Fechar, link, Lembrar depois, Não mostrar de novo e o X");

  for (const className of classes) {
    assert.match(className, /focus-visible:outline-2/);
    assert.match(className, /focus-visible:outline-offset-\[-2px\]/, "por dentro: a prancheta corta o que passa dela");
    assert.match(className, /focus-visible:outline-white/);
    assert.match(className, /before:min-h-11 before:min-w-11/, "44 px de toque");
  }

  assert.match(markup, /<a class="[^"]*hover:brightness-110[^"]*" data-free-button="link" data-free-id="link" href="https:\/\/exemplo\.com\.br\/oferta"[^>]*rel="noopener noreferrer" target="_blank">[\s\S]*?<span class="sr-only"> \(abre em nova aba\)<\/span><\/a>/);
  assert.match(markup, /<a class="[^"]*" data-free-button="cta" data-free-id="botao" href="\/minhas-compras"/);
  assert.match(markup, /<button class="[^"]*" data-free-button="close" data-free-id="fechar"[^>]*type="button">/);
});

test("sizes da imagem pela largura do elemento", () => {
  const design = starter();

  assert.equal(styles.freeImageSizes({ id: "a", place: { mode: "free", w: 200, x: 0, y: 0 }, type: "image" }, design), "(max-width: 480px) calc((100vw - 2rem) * 200 / 440), 200px");
  assert.equal(styles.freeImageSizes({ id: "a", place: { mode: "flow", width: 300 }, type: "image" }, design), "(max-width: 480px) calc((100vw - 2rem) * 300 / 440), 300px");
  assert.equal(styles.freeImageSizes({ id: "a", type: "image" }, design), "(max-width: 480px) calc((100vw - 2rem) * 392 / 440), 392px", "na sequencia sem largura: a largura util (440 - 24 - 24)");
  assert.equal(styles.freeImageSizes({ id: "a", type: "image" }, { artboard: { padding: [10, 30], width: 640 } }), "(max-width: 480px) calc((100vw - 2rem) * 580 / 640), 580px");
  assert.equal(styles.freeImageSizes({ id: "a", type: "image" }, {}), "(max-width: 480px) calc((100vw - 2rem) * 392 / 440), 392px");

  const withImage = parsed({
    assets: [{ height: 48, id: "img", kind: "image", path: IMAGE_PATH, width: 64 }],
    children: [{ alt: "Aluna estudando", asset: "img", id: "foto", place: { mode: "free", w: 160, x: 10, y: 10 }, type: "image" }, { id: "links", type: "links" }]
  });
  const markup = card(withImage);
  assert.match(markup, /<img alt="Aluna estudando" draggable="false" src="[^"]+" data-next-image="" data-sizes="\(max-width: 480px\) calc\(\(100vw - 2rem\) \* 160 \/ 440\), 160px"/);
  assert.match(styleOfId(markup, "foto"), /aspect-ratio:64 \/ 48/, "solto sem altura: a proporcao do arquivo");
});

test("links: Lembrar depois só quando pode adiar e sem botão Lembrar depois; Não mostrar de novo some com dismiss false", () => {
  const base = parsed({ children: [{ id: "links", type: "links" }] });
  const text = (markup) => markup.replace(/<[^>]+>/g, "|");

  assert.match(text(card(base)), /Lembrar depois\|.*Não mostrar de novo/);
  assert.doesNotMatch(card(base, { popup: { canSnooze: false } }), /Lembrar depois/, "adiar esgotado");

  const withSnooze = parsed({ children: [{ action: { kind: "snooze" }, id: "adiar", label: "Mais tarde", type: "button" }, { id: "links", type: "links" }] });
  const markup = card(withSnooze);
  assert.match(markup, /Mais tarde/);
  assert.doesNotMatch(markup, /Lembrar depois/, "o botao Lembrar depois ja existe: o link nao repete");
  assert.doesNotMatch(card(withSnooze, { popup: { canSnooze: false } }), /Mais tarde/, "o botao some quando nao pode mais adiar");

  const noDismiss = parsed({ children: [{ dismiss: false, id: "links", type: "links" }] });
  assert.doesNotMatch(card(noDismiss), /Não mostrar de novo/);
  assert.match(card(noDismiss), /Lembrar depois/);
  assert.doesNotMatch(card(noDismiss, { popup: { canSnooze: false } }), /data-free-id="links"/, "sem nenhum dos dois, nada e desenhado");
  assert.match(card(noDismiss, { popup: { canSnooze: false } }), /aria-label="Fechar"/, "o aluno continua fechando pelo X");
});

test("Imagem sem arquivo vira o quadriculado só na prévia", () => {
  const design = parsed({
    children: [
      { asset: null, id: "img", type: "image" },
      { asset: null, id: "vid", place: { h: 100, mode: "free", w: 440, x: 0, y: 0 }, type: "video" },
      { id: "links", type: "links" }
    ]
  });
  const preview = card(design, { preview: true });

  assert.match(preview, /<div data-free-id="img" data-free-missing=""[^>]*>Escolha a imagem<\/div>/);
  assert.match(preview, /data-free-id="vid"[^>]*data-free-missing=""[^>]*>Envie o vídeo/);

  const student = card(design);
  assert.doesNotMatch(student, /data-free-id="img"/, "no aluno, Imagem sem arquivo nao aparece");
  assert.doesNotMatch(student, /Escolha a imagem|Envie o vídeo|data-free-missing/);
  assert.match(student, /data-free-id="vid"/, "o video sem arquivo fica so com o fundo do elemento");
});

test("escondido não é desenhado", () => {
  const design = parsed({
    children: [
      { hidden: true, id: "titulo", lines: [[{ text: "Some" }]], type: "heading" },
      { children: [{ id: "dentro", lines: [[{ text: "Dentro de caixa escondida" }]], type: "text" }], hidden: true, id: "caixa", type: "box" },
      { id: "visivel", lines: [[{ text: "Fica" }]], type: "text" },
      { id: "links", type: "links" }
    ]
  });

  for (const markup of [card(design), card(design, { preview: true })]) {
    assert.doesNotMatch(markup, /Some|Dentro de caixa escondida|data-free-id="titulo"|data-free-id="caixa"/);
    assert.match(markup, /Fica/);
  }
});

test("ordem do DOM igual à das Camadas", () => {
  const design = parsed({
    children: [
      { action: { kind: "cta" }, id: "botao", type: "button" },
      { id: "titulo", lines: [[{ text: "Embaixo na tela, primeiro na leitura" }]], place: { mode: "free", w: 300, x: 20, y: 400 }, type: "heading" },
      { children: [{ id: "c1", label: "Um", type: "badge" }, { id: "c2", lines: [[{ text: "Dois" }]], type: "text" }], id: "caixa", layout: { dir: "row" }, type: "box" },
      { id: "links", type: "links" }
    ]
  });
  const order = [...card(design).matchAll(/data-free-id="([a-z0-9]+)"/g)].map((match) => match[1]);

  assert.deepEqual(order, ["botao", "titulo", "caixa", "c1", "c2", "links"], "a posicao na tela nao muda a ordem de leitura e de Tab");
});

test("dragPreview move só o elemento arrastado sem mudar o design", () => {
  const design = parsed({
    children: [
      { box: { fill: [{ color: "#ffffff", kind: "solid" }] }, id: "a", place: { h: 100, mode: "free", w: 100, x: 10, y: 20 }, type: "shape" },
      { box: { fill: [{ color: "#000000", kind: "solid" }] }, id: "b", place: { h: 50, mode: "free", w: 50, x: 200, y: 20 }, type: "shape" },
      { id: "links", type: "links" }
    ]
  });
  const before = JSON.stringify(design);
  const dragPreview = { dh: 10, dw: 20, dx: 30, dy: -5, id: "a" };
  const markup = card(design, { dragPreview, preview: true });

  assert.match(styleOfId(markup, "a"), new RegExp(`width:${len(120).replace(".", "\\.")};height:${len(110).replace(".", "\\.")}`));
  assert.match(styleOfId(markup, "a"), new RegExp(`translate:${len(30).replace(".", "\\.")} ${len(-5).replace(".", "\\.")}`));
  assert.equal(styleOfId(markup, "b"), styleOfId(card(design, { preview: true }), "b"), "o outro elemento nao muda");
  assert.equal(JSON.stringify(design), before, "o design nao muda durante o arrastar");
  assert.doesNotMatch(card(design, { dragPreview }), /translate:/, "so no editor (previa)");
  assert.equal(styles.freePlaceCss(design.children[0], styleCtx(design), "column", { dw: -500, dx: 0, dy: 0, id: "a" }).width, len(4), "nunca menor que 4 px");
});

test("os três modelos para começar desenham no cartão do aluno", async () => {
  const starters = await import("../src/server/communications/popup-free-starters.ts");

  for (const { id } of starters.FREE_DESIGN_STARTERS) {
    const { cta, design } = starters.applyFreeStarter(id, { audio: null, cta: CTA });
    const markup = card(design, { popup: { cta }, preview: true });

    assert.match(markup, /data-popup-free=""/, id);
    assert.match(markup, /<h2 data-free-id="[a-z0-9]+" id="t"/, `${id}: o titulo e o h2`);
    assert.match(markup, /data-free-button="cta"/, `${id}: o botao principal`);
    assert.match(markup, /aria-hidden="true"[^>]*data-free-close=""/, `${id}: o X`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Editor: refs dos elementos e aparelho
 * ---------------------------------------------------------------------------------------------- */

test("o editor recebe o elemento de cada um pelo editorNodeRef e o aparelho marca o cartão", () => {
  const design = starter();
  const markup = card(design, { device: "mobile", editorNodeRef: () => undefined, preview: true });

  assert.match(markup, /data-free-device="mobile"/);
  assert.doesNotMatch(card(design), /data-free-device/, "o aluno nunca passa aparelho");
  // Na previa o botao principal aparece mesmo com o destino ainda vazio (modelo recem-escolhido).
  assert.match(card(design, { popup: { cta: { href: "", label: "Saiba mais", target: "same_tab" } }, preview: true }), /<span data-free-button="cta" data-free-id="botao"[^>]*>[\s\S]*Saiba mais/);
  assert.doesNotMatch(card(design, { popup: { cta: { href: "", label: "Saiba mais", target: "same_tab" } } }), /data-free-id="botao"/, "no aluno, destino invalido = sem botao");
});

/* ------------------------------------------------------------------------------------------------
 * Padrão e Personalizado iguais; pedaco proprio do Livre
 * ---------------------------------------------------------------------------------------------- */

// Os mesmos casos que geraram tests/fixtures/popup-livre/antes-*.html no commit-base (antes do Livre).
function beforeCases() {
  const ORIGIN_BEFORE = "https://projeto.supabase.co";
  const VIDEO = { mimeType: "video/webm", path: VIDEO_PATH, url: `${ORIGIN_BEFORE}/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}` };
  const IMAGE = { alt: "Capa da aula nova", url: `${ORIGIN_BEFORE}/storage/v1/object/public/content-assets/communications/images/0123456789abcdef01234567.webp` };
  const cta = { href: "/minhas-compras", label: "Saiba mais", target: "same_tab" };
  const basePopup = { audio: null, body: "A turma nova começa segunda.\nCorre lá.", canSnooze: true, cta, id: "p1", image: IMAGE, title: "Turma nova" };
  const padrao = [
    ["padrao completo", { bodyId: "b", popup: { ...basePopup, audio: AUDIO, icon: { color: "red", id: "megaphone" } }, titleId: "t" }],
    ["padrao sem adiar, sem imagem, link em nova aba", { bodyId: "b", popup: { ...basePopup, canSnooze: false, cta: { ...cta, href: "https://exemplo.com.br/x", target: "new_tab" }, image: null }, titleId: "t" }],
    ["padrao previa", { popup: { ...basePopup, audio: AUDIO }, preview: true }],
    ["padrao so no x pulsando", { nudgeClose: true, popup: { ...basePopup, close: "x_only", cta: null } }]
  ];
  const custom = [];

  for (const item of designModel.POPUP_DESIGN_STARTERS) {
    const design = designModel.popupStarterDesign(item.id, { hasAudio: true, video: VIDEO });
    custom.push([`personalizado ${item.id}`, { bodyId: "b", popup: { ...basePopup, audio: AUDIO, design, fonts: [] }, titleId: "t" }]);
    custom.push([`personalizado ${item.id} previa`, { popup: { ...basePopup, audio: AUDIO, design, fonts: [] }, preview: true }]);
    custom.push([`personalizado ${item.id} sem adiar nem dismiss`, { popup: { ...basePopup, canSnooze: false, design: { ...design, links: { ...design.links, showDismiss: false } }, fonts: [] }, playing: false }]);
  }

  const renderCases = (cases) => cases.map(([name, props]) => `<!-- caso: ${name} -->\n${html(createElement(MemberPopupCard, props))}\n`).join("");

  return { custom: renderCases(custom), padrao: renderCases(padrao) };
}

test("HTML do Padrão e do Personalizado igual ao de antes do Livre", () => {
  const before = (name) => readFileSync(new URL(`fixtures/popup-livre/${name}`, import.meta.url), "utf8");
  const now = beforeCases();

  assert.equal(now.padrao, before("antes-padrao.html"), "o cartao Padrão mudou");
  assert.equal(now.custom, before("antes-personalizado.html"), "o cartao Personalizado mudou");
  assert.equal((now.custom.match(/<!-- caso:/g) ?? []).length, 9, "os 3 modelos do Personalizado, normal, previa e sem links");
});

test("o Livre vai para o pedaço próprio: nada até o código chegar e o plano pede o pedaço antes do show", async () => {
  const design = starter();
  const popup = popupOf(design);

  // Antes do pedaco: nada (nem o cartao Padrão com o nome interno).
  const first = html(createElement(MemberPopupCard, { popup }));
  assert.equal(first, "");

  await loadPopupFreeCard();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.match(html(createElement(MemberPopupCard, { popup })), /data-popup-free=""/, "com o pedaco carregado, o cartao Livre");
  assert.doesNotMatch(html(createElement(MemberPopupCard, { popup: { ...popup, freeDesign: undefined } })), /data-popup-free/, "sem freeDesign, o cartao de sempre");

  // O plano: so o Livre leva a marca; a abertura armada pede o pedaco do cartao antes do POST /show.
  const item = (extra = {}) => ({ delaySeconds: 0, exclude: [], id: "p1", notBefore: null, pages: ["any"], stopOn: null, trigger: "page_load", ...extra });
  const answer = hostModel.readPopupsAnswer({ asOf: new Date(0).toISOString(), pages: ["any"], plan: [item({ design: "free" }), item({ id: "p2" }), item({ design: "outro", id: "p3" })] });
  assert.deepEqual(answer.plan.map((planItem) => planItem.design), ["free", undefined, undefined]);
  assert.equal("design" in answer.plan[1], false, "Padrão/Personalizado: o item do plano fica igual ao de antes");

  const armed = hostModel.openingsForPageView({ items: answer.plan, offsetMs: 0, pageKey: "home", pageViewStart: 0 });
  assert.deepEqual(armed.map((opening) => hostModel.needsFreeCard(opening)), [true, false, false]);
  assert.equal("design" in armed[1], false);

  const completion = hostModel.completionOpenings({ contentId: "c", items: [item({ design: "free", trigger: "lesson_completed" })], lessonId: "l", now: 0, offsetMs: 0, playing: false });
  assert.equal(hostModel.needsFreeCard(completion[0]), true);

  const hostSource = readFileSync(new URL("src/components/member/notifications/member-popup-host.tsx", root), "utf8");
  assert.match(hostSource, /const loadPopupFreeCard = \(\) => loadPopupDialog\(\)\.then\(\(module\) => module\.loadPopupFreeCard\(\)\);/, "o cartao vem pela janela");
  const { loadedPopupFreeCard } = await import("../src/components/member/notifications/popup-free/popup-free-load.ts");
  assert.ok(loadedPopupFreeCard(), "o pedaco baixado fica guardado para a janela ler a aria");
  const show = hostSource.slice(hostSource.indexOf("async function show(armed: ArmedPopup)"));
  assert.match(show, /const freeCard = needsFreeCard\(armed\) \? loadPopupFreeCard\(\) : null;/, "o plano marcou: baixa junto com a janela");
  assert.ok(show.indexOf("await freeCard;") > 0 && show.indexOf("await freeCard;") < show.indexOf("postPopupShow("), "sem o codigo, nada abre e nada conta: o pedaco vem antes do POST /show");
  assert.match(hostSource, /if \(answer\.popup\.freeDesign && !needsFreeCard\(armed\)\) \{\s+try \{\s+await loadPopupFreeCard\(\);/, "Livre que o plano nao marcou: espera o pedaco antes de abrir");
});
