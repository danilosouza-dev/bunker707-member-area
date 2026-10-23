import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Design Livre do pop-up (docs/27; docs/18 §1.1), pacote M: o modelo puro (tipos, padroes, forma canonica,
// arvore, estimativa do jsonb, reescala), o schema zod (salvar e ler), o roteador da coluna popup_design, as
// regras com o conteudo do aviso, as chaves de erro, os modelos para comecar, as dicas do Revisar e o caminho
// do rascunho ao banco e de volta. O desenho do aluno e o editor ficam nos testes dos pacotes S, E e I.

const model = await import("../src/server/communications/popup-free-model.ts");
const render = await import("../src/server/communications/popup-free-render.ts");
const schema = await import("../src/server/communications/popup-free-schema.ts");
const jsonSchemaModule = await import("../src/server/communications/popup-free-json-schema.ts");
const starters = await import("../src/server/communications/popup-free-starters.ts");
const checks = await import("../src/server/communications/popup-free-checks.ts");
const router = await import("../src/server/communications/popup-design-router.ts");
const custom = await import("../src/server/communications/popup-design-model.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const store = await import("../src/server/communications/store.ts");

const M = schema.POPUP_FREE_MESSAGES;
const ORIGIN = "http://127.0.0.1:55321";
const HEX = "0123456789abcdef01234567";
const IMAGE_PATH = `communications/free/${HEX}.webp`;
const NOTICE_IMAGE_PATH = `communications/images/${HEX}.webp`;
const VIDEO_PATH = "videos/0b7c7f3e-2d1a-4c55-9a4e-5f1f7b2c9d10.mp4";
const FONT_A = "6f1c2c9e-8d55-4f3a-9a1b-0c2d3e4f5a6b";
const LINKS = { id: "links", type: "links" };

function design(children, extra = {}) {
  return { children: [...children, LINKS], mode: "free", version: 1, ...extra };
}

function parse(value) {
  return schema.popupFreeDesignSchema.safeParse(value);
}

function issues(value) {
  const result = parse(value);

  return result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

function hasIssue(value, path, message) {
  const list = issues(value);

  assert.ok(
    list.some(([at, text]) => at === path && (message === undefined || text === message)),
    `esperava ${path}${message ? ` = ${message}` : ""}; veio ${JSON.stringify(list)}`
  );
}

function valid(value) {
  const result = parse(value);

  assert.equal(result.success, true, JSON.stringify(result.success ? null : result.error.issues));

  return result.data;
}

const heading = (id, text = "Título") => ({ id, lines: [[{ text }]], type: "heading" });
const text = (id, value = "Texto") => ({ id, lines: [[{ text: value }]], type: "text" });
const imageAsset = (id, path = IMAGE_PATH, size = { height: 48, width: 64 }) => ({ ...size, id, kind: "image", path });
const videoAsset = (id, extra = {}) => ({ id, kind: "video", mimeType: "video/mp4", path: VIDEO_PATH, ...extra });

/** Linha do banco a partir das colunas (o resto com valores neutros). */
function linhaDe(columns, extra = {}) {
  return {
    ...columns,
    approved_at: null,
    approved_by: null,
    audience_count: null,
    audience_counted_at: null,
    audience_refreshed_at: null,
    created_at: "2026-10-23T15:00:00.000Z",
    created_by: null,
    deleted_at: null,
    deleted_by: null,
    dispatch_attempts: 0,
    dispatch_started_at: null,
    edited_at: null,
    edited_by: null,
    flow_id: null,
    flow_node_id: null,
    id: "11111111-1111-4111-8111-111111111111",
    last_error: null,
    recipients_count: null,
    requested_at: null,
    requested_by: null,
    sent_at: null,
    status: "draft",
    updated_at: "2026-10-23T15:00:00.000Z",
    updated_by: null,
    ...extra
  };
}

/* ------------------------------------------------------------------------------------------------
 * Schema: forma, limites, contagens e arquivos
 * ---------------------------------------------------------------------------------------------- */

test("o schema do Livre recusa chave a mais em qualquer nível, inclusive url num arquivo", () => {
  const base = design([heading("titulo")]);

  hasIssue({ ...base, extra: 1 }, "", M.design);
  hasIssue({ ...base, devices: { mobile: {} } }, "", M.design);
  hasIssue({ ...base, artboard: { width: 440, cor: "#000000" } }, "artboard", M.design);
  hasIssue({ ...base, close: { color: "#ffffff", url: "https://x.com" } }, "close", M.design);
  hasIssue(design([{ ...heading("titulo"), html: "<b>oi</b>" }]), "children.0", M.design);
  hasIssue(design([{ ...heading("titulo"), box: { fill: [{ color: "#000000", kind: "solid", css: "x" }] } }]), "children.0.box.fill.0", M.design);
  hasIssue(design([{ ...heading("titulo"), lines: [[{ style: { color: "#ffffff" }, text: "Oi" }]] }]), "children.0.lines.0.0.style", M.design);
  hasIssue(design([{ ...heading("titulo"), place: { mode: "flow", top: 3 } }]), "children.0.place", M.design);
  hasIssue(
    design([{ asset: "img", id: "foto", type: "image" }], { assets: [{ ...imageAsset("img"), url: `${ORIGIN}/storage/v1/object/public/content-assets/${IMAGE_PATH}` }] }),
    "assets.0",
    M.design
  );
  hasIssue({ children: [LINKS], mode: "free", version: 2 }, "version", M.design);
  hasIssue({ children: [LINKS], mode: "livre", version: 1 }, "mode", M.design);
});

test("um documento mínimo só com mode, version e links vale e ganha os padrões", () => {
  const minimal = valid({ children: [LINKS], mode: "free", version: 1 });

  assert.deepEqual(minimal, { assets: [], children: [LINKS], fonts: [], mode: "free", version: 1 });
  assert.deepEqual(render.resolveFreeArtboard(minimal), {
    align: "stretch",
    fill: [{ color: "#16181c", kind: "solid" }],
    gap: 12,
    justify: "start",
    minHeight: 0,
    padding: 24,
    radius: 24,
    width: 440
  });
  assert.deepEqual(render.resolveFreeClose(minimal), { background: "#ffffff1f", color: "#ffffff", inset: 12, side: "right", size: 36 });
  assert.deepEqual(render.freeTextStyleOf(LINKS), {
    align: "left",
    font: { key: "inter", kind: "builtin" },
    letterSpacing: 0,
    lineHeight: 1.2,
    paint: { color: "#ffffff", kind: "solid" },
    size: 13,
    weight: 600
  });
  assert.equal(render.freeTextStyleOf(heading("t")).size, 28);
  assert.equal(render.freeTextStyleOf(heading("t")).weight, 800);
  assert.equal(render.freeTextStyleOf(text("t")).lineHeight, 1.5);
  assert.equal(render.freeTextStyleOf({ ...text("t"), textStyle: { size: 20 } }).size, 20);
  assert.equal(render.freeArtboardMinHeight(minimal), 0);
});

test("cores, números e listas fora do limite dão a frase do limite", () => {
  hasIssue(design([], { artboard: { fill: [{ color: "red", kind: "solid" }] } }), "artboard.fill.0.color", M.color);
  hasIssue(design([], { artboard: { width: 800 } }), "artboard.width", "Use de 280 a 720.");
  hasIssue(design([], { artboard: { minHeight: 1601 } }), "artboard.minHeight", "Use de 0 a 1600.");
  hasIssue(design([], { artboard: { fill: Array.from({ length: 4 }, () => ({ color: "#000000", kind: "solid" })) } }), "artboard.fill", "Use até 3 camadas de fundo.");
  hasIssue(design([{ ...heading("t"), textStyle: { size: 9 } }]), "children.0.textStyle.size", "Use de 10 a 160.");
  hasIssue(design([{ ...heading("t"), textStyle: { letterSpacing: -0.3 } }]), "children.0.textStyle.letterSpacing", "Use de -0,2 a 1.");
  hasIssue(design([{ ...heading("t"), textStyle: { lineHeight: 3 } }]), "children.0.textStyle.lineHeight", "Use de 0,7 a 2,5.");
  hasIssue(design([{ ...heading("t"), textStyle: { paint: { kind: "linear", stops: [{ at: 0, color: "#ffffff" }] } } }]), "children.0.textStyle.paint.stops", M.stops);
  hasIssue(design([{ icon: "cachorro", id: "i", type: "icon" }]), "children.0.icon", M.icon);
  hasIssue(design([{ ...heading("t"), box: { fade: { end: 42, side: "bottom", start: 40 } } }]), "children.0.box.fade.end", M.fadeOrder);
  hasIssue(design([{ ...heading("t"), place: { mode: "absolute", x: 1, y: 1 } }]), "children.0.place.mode", M.place);
  hasIssue(design([{ id: "x", type: "carrossel" }]), "children.0.type", M.nodeType);
  hasIssue(design([], { close: { size: 30 } }), "close.size", "Escolha o tamanho do X.");
  hasIssue(design([{ ...heading("t"), place: { h: 3, mode: "free", w: 100, x: 0, y: 0 } }]), "children.0.place.h", "Use de 4 a 2400.");
  hasIssue(design([{ ...heading("t"), box: { radius: 1000 } }]), "children.0.box.radius", "Use de 0 a 999.");
  hasIssue(design([{ ...heading("t"), box: { shadows: [1, 2, 3].map(() => ({ blur: 0, color: "#000000", spread: 0, x: 0, y: 0 })) } }]), "children.0.box.shadows", "Use até 2 sombras.");
  hasIssue(design([{ ...heading("t"), name: "x".repeat(41) }]), "children.0.name", "Use até 40 letras.");
  hasIssue({ children: [], mode: "free", version: 1 }, "children", M.empty);
});

test("ids repetidos de elemento ou de arquivo são recusados", () => {
  hasIssue(design([heading("titulo"), text("titulo")]), "children.1.id", M.design);
  hasIssue(design([{ children: [heading("titulo")], id: "caixa", type: "box" }, heading("titulo")]), "children.1.id", M.design);
  hasIssue(design([{ asset: "img", id: "foto", type: "image" }], { assets: [imageAsset("img"), imageAsset("img")] }), "assets.1.id", M.design);
  hasIssue(design([heading("Titulo")]), "children.0.id", M.design);
  hasIssue(design([heading("1titulo")]), "children.0.id", M.design);
  // Elemento e arquivo podem ter o mesmo id (namespaces separados).
  valid(design([{ asset: "foto", id: "foto", type: "image" }], { assets: [imageAsset("foto")] }));
});

test("solto só na prancheta e caixa dentro de caixa só um nível", () => {
  const free = { h: 40, mode: "free", w: 100, x: 0, y: 0 };

  valid(design([{ ...heading("t"), place: free }]));
  hasIssue(design([{ children: [{ ...heading("t"), place: free }], id: "caixa", type: "box" }]), "children.0.children.0.place", M.freeOnlyRoot);
  valid(design([{ children: [{ children: [heading("t")], id: "dentro", type: "box" }], id: "fora", type: "box" }]));
  hasIssue(
    design([{ children: [{ children: [{ children: [heading("t")], id: "terceira", type: "box" }], id: "dentro", type: "box" }], id: "fora", type: "box" }]),
    "children.0.children.0.children.0",
    M.depth
  );
});

test("contagens: 32 elementos, 20 por caixa, 4 títulos, 6 imagens, 1 vídeo, 12 ícones, 4 desfoques", () => {
  const spacers = (count, prefix = "e") => Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, type: "spacer" }));

  valid(design(spacers(31)));
  hasIssue(design([{ children: spacers(20), id: "caixa", type: "box" }, ...spacers(11, "f")]), "children", M.nodes);
  hasIssue(design([{ children: spacers(21), id: "caixa", type: "box" }]), "children.0.children", M.childrenPerBox);
  valid(design([1, 2, 3, 4].map((index) => heading(`t${index}`))));
  hasIssue(design([1, 2, 3, 4, 5].map((index) => heading(`t${index}`))), "children.4", M.headings);

  const images = (count) => ({
    assets: Array.from({ length: count }, (_, index) => imageAsset(`a${index}`, `communications/free/${String(index).padStart(24, "a")}.webp`)),
    nodes: Array.from({ length: count }, (_, index) => ({ asset: `a${index}`, id: `i${index}`, type: "image" }))
  });
  const six = images(6);
  const seven = images(7);

  valid(design(six.nodes, { assets: six.assets }));
  hasIssue(design(seven.nodes, { assets: seven.assets }), "assets.6", M.images);
  hasIssue(
    design([...six.nodes, { asset: "a0", id: "i9", type: "image" }, { asset: "a0", id: "i10", type: "image" }, { asset: "a0", id: "i11", type: "image" }], { assets: six.assets }),
    "children.8",
    M.imageNodes
  );
  hasIssue(design([{ asset: null, id: "v1", type: "video" }, { asset: null, id: "v2", type: "video" }]), "children.1", M.videoDuplicate);
  const secondVideo = videoAsset("v2", { path: "videos/1b7c7f3e-2d1a-4c55-9a4e-5f1f7b2c9d10.mp4" });

  hasIssue(
    { assets: [videoAsset("v1"), secondVideo], children: [{ asset: "v1", id: "video1", type: "video" }, { asset: "v2", id: "video2", type: "video" }, LINKS], mode: "free", version: 1 },
    "assets.1",
    M.videoDuplicate
  );

  const icons = (count) => Array.from({ length: count }, (_, index) => ({ icon: "star", id: `ic${index}`, type: "icon" }));

  valid(design(icons(12)));
  hasIssue(design(icons(13)), "children.12", M.icons);

  const blurred = (count) => Array.from({ length: count }, (_, index) => ({ box: { blur: 10 }, id: `b${index}`, type: "shape" }));

  valid(design(blurred(4)));
  hasIssue(design(blurred(5)), "children.4.box.blur", M.effects);
  hasIssue(design([...blurred(4), { box: { backdropBlur: 8 }, id: "vidro", type: "shape" }]), "children.4.box.backdropBlur", M.effects);
});

test("um botão principal, até 3 outros, um só Abrir um link, links sempre e áudio no máximo um", () => {
  const cta = (id) => ({ action: { kind: "cta" }, id, type: "button" });
  const close = (id) => ({ action: { kind: "close" }, id, label: "Agora não", type: "button" });
  const link = (id) => ({ action: { href: "/minhas-compras", kind: "link", target: "same_tab" }, id, label: "Ver", type: "button" });

  valid(design([cta("principal"), close("b1"), close("b2"), link("b3")]));
  hasIssue(design([cta("p1"), cta("p2")]), "children.1.action", M.ctaDuplicate);
  hasIssue(design([close("b1"), close("b2"), close("b3"), close("b4")]), "children.3.action", M.buttons);
  hasIssue(design([link("b1"), link("b2")]), "children.1.action", M.linkButtons);
  hasIssue(design([{ action: { kind: "close" }, id: "b1", type: "button" }]), "children.0.label", M.label);
  hasIssue(design([{ action: { kind: "cta" }, id: "p", label: "Comprar", type: "button" }]), "children.0.label", M.design);
  hasIssue({ children: [heading("t")], mode: "free", version: 1 }, "children", M.links);
  hasIssue(design([{ id: "links2", type: "links" }]), "children.1", M.linksDuplicate);
  hasIssue(design([{ id: "a1", type: "audio" }, { id: "a2", type: "audio" }]), "children.1", M.audioDuplicate);
});

test("texto somado acima de 1.200 letras é recusado e uma parte aceita 600 letras", () => {
  const long = "a".repeat(600);

  valid(design([text("t1", long), text("t2", long)]));
  hasIssue(design([text("t1", long), text("t2", long), { id: "selo", label: "b", type: "badge" }]), "children.2.label", M.textTotal);
  hasIssue(design([text("t1", "a".repeat(601))]), "children.0.lines.0.0.text", "Use até 600 letras.");
  hasIssue(design([{ id: "t", lines: [[{ text: "   " }]], type: "text" }]), "children.0.lines.0", M.lineEmpty);
  hasIssue(design([{ id: "t", lines: [[{ text: "" }]], type: "text" }]), "children.0.lines.0.0.text", M.spanEmpty);
  hasIssue(design([{ id: "t", lines: [Array.from({ length: 7 }, () => ({ text: "a" }))], type: "text" }]), "children.0.lines.0", "Use até 6 partes por linha.");
  hasIssue(design([{ id: "t", lines: Array.from({ length: 5 }, () => [{ text: "a" }]), type: "heading" }]), "children.0.lines", "Use até 4 linhas.");
  hasIssue(design([{ id: "t", lines: Array.from({ length: 13 }, () => [{ text: "a" }]), type: "text" }]), "children.0.lines", "Use até 12 linhas.");
});

test("caminho fora do padrão do bucket é recusado e o asset de elemento tem de existir", () => {
  const node = { asset: "img", id: "foto", type: "image" };

  valid(design([node], { assets: [imageAsset("img")] }));
  valid(design([node], { assets: [imageAsset("img", NOTICE_IMAGE_PATH)] }));
  hasIssue(design([node], { assets: [imageAsset("img", `communications/outra/${HEX}.webp`)] }), "assets.0.path", M.image);
  hasIssue(design([node], { assets: [imageAsset("img", `communications/free/../${HEX}.webp`)] }), "assets.0.path", M.image);
  hasIssue(design([node], { assets: [imageAsset("img", "https://outro.site/imagem.webp")] }), "assets.0.path", M.image);
  hasIssue(design([node], { assets: [imageAsset("img", IMAGE_PATH, { height: 10, width: 64 })] }), "assets.0.height", "Use de 16 a 1600.");
  hasIssue(design([{ asset: "v", id: "midia", type: "video" }], { assets: [videoAsset("v", { path: "videos/nao-e-uuid.mp4" })] }), "assets.0.path", M.video);
  hasIssue(design([{ asset: "v", id: "midia", type: "video" }], { assets: [videoAsset("v", { mimeType: "video/webm" })] }), "assets.0.path", M.video);
  hasIssue(design([node]), "children.0.asset", M.image);
  hasIssue(design([{ asset: "v", id: "foto", type: "image" }], { assets: [videoAsset("v")] }), "children.0.asset", M.image);
  hasIssue(design([{ asset: "img", id: "midia", type: "video" }], { assets: [imageAsset("img")] }), "children.0.asset", M.video);
  hasIssue(design([{ box: { fill: [{ asset: "nada", kind: "image" }] }, id: "forma", type: "shape" }]), "children.0.box.fill.0.asset", M.image);
  hasIssue(design([], { artboard: { fill: [{ asset: "nada", kind: "image" }, { color: "#000000", kind: "solid" }] } }), "artboard.fill.0.asset", M.image);
  // Imagem sem arquivo vale no schema (rascunho de modelo); salvar pede o arquivo (regras com o conteudo).
  valid(design([{ asset: null, id: "foto", type: "image" }]));
});

test("vídeo sem capa vale; capa que não é imagem do design é recusada", () => {
  const node = { asset: "v", id: "midia", type: "video" };

  valid(design([node], { assets: [videoAsset("v")] }));
  valid(design([node], { assets: [videoAsset("v", { poster: "capa" }), imageAsset("capa")] }));
  hasIssue(design([node], { assets: [videoAsset("v", { poster: "capa" })] }), "assets.0.poster", M.poster);
  hasIssue(design([node], { assets: [videoAsset("v", { poster: "v" })] }), "assets.0.poster", M.poster);
});

test("X invisível é recusado: alfa do ícone abaixo de cc ou contraste abaixo de 3:1 sobre a base da prancheta", () => {
  valid(design([], { close: { color: "#ffffffcc" } }));
  hasIssue(design([], { close: { color: "#ffffffcb" } }), "close.color", M.closeVisible);
  hasIssue(design([], { close: { background: "#16181c", color: "#1a1c20" } }), "close.color", M.closeVisible);
  // Fundo do X transparente: vale a base da prancheta (a camada de baixo; degrade = a primeira parada).
  hasIssue(
    design([], { artboard: { fill: [{ kind: "linear", stops: [{ at: 100, color: "#000000" }, { at: 0, color: "#f4f4f5" }] }] }, close: { background: "#ffffff00", color: "#ffffff" } }),
    "close.color",
    M.closeVisible
  );
  assert.equal(model.freeCloseVisibilityProblem({ close: { color: "#ffffff80" } }), "alpha");
  assert.equal(model.freeCloseVisibilityProblem({ close: { background: "#ffffff00", color: "#18181b" } }), "contrast");
  assert.equal(model.freeCloseVisibilityProblem({}), null);
  // Imagem embaixo: so a regra do alfa.
  assert.equal(model.freeCloseVisibilityProblem({ artboard: { fill: [{ asset: "img", kind: "image" }] }, close: { background: "#ffffff00", color: "#18181b" } }), null);
  assert.equal(model.freeArtboardBaseColor({ artboard: { fill: [{ color: "#ff000080", kind: "solid" }, { color: "#00ff00", kind: "solid" }] } }), "#00ff00");
});

test("link do botão segue a regra do botão principal", () => {
  const button = (href) => design([{ action: { href, kind: "link", target: "new_tab" }, id: "b", label: "Abrir", type: "button" }]);

  valid(button("/minhas-compras"));
  valid(button("https://exemplo.com/pagina"));
  valid(button("/conteudo/produto-1"));

  for (const href of ["javascript:alert(1)", "http://exemplo.com", "//outro.site", "/api/admin", "mailto:a@b.com", "", "/com espaço"]) {
    assert.ok(issues(button(href)).some(([path]) => path === "children.0.action.href"), href);
  }

  assert.equal(render.freeLinkButton(button("/minhas-compras")).id, "b");
  assert.equal(render.freeLinkButton(design([{ action: { href: "/x", kind: "link", target: "new_tab" }, hidden: true, id: "b", label: "Abrir", type: "button" }])), null);
  assert.equal(render.freeLinkButton(null), null);
});

/* ------------------------------------------------------------------------------------------------
 * Tamanho
 * ---------------------------------------------------------------------------------------------- */

test("a estimativa do jsonb fica acima do real nas amostras medidas", () => {
  // Medidas no Postgres local (pg_column_size do jsonb, 23/10/2026), as mesmas listas da spec do Livre §2.8.
  const samples = [
    [Array.from({ length: 1000 }, (_, index) => (index + 1) % 100), 12_006],
    [Array.from({ length: 1000 }, (_, index) => ((index + 1) % 100) / 10), 15_246],
    [Array.from({ length: 500 }, () => [12, 24, 12, 24]), 28_008],
    [Array.from({ length: 300 }, () => ({ blur: 0, color: "#9db300", spread: 0, x: 0, y: 3 })), 32_406],
    [Array.from({ length: 500 }, () => ({ hidden: true, locked: true })), 18_008],
    [Array.from({ length: 300 }, () => "x".repeat(60)), 19_208]
  ];

  for (const [value, measured] of samples) {
    const estimate = model.jsonbBytesUpperBound(value);

    assert.ok(estimate >= measured, `estimativa ${estimate} abaixo do medido ${measured}`);
    assert.ok(estimate <= measured * 1.4, `estimativa ${estimate} longe demais do medido ${measured}`);
  }

  assert.equal(model.jsonbBytesUpperBound(null), 4);
  assert.equal(model.jsonbBytesUpperBound({ a: "é" }), 4 + 7 + 8 + 1 + 2);
});

/** Um design com 24 formas soltas cheias de numeros (degrades circulares de 5 paradas e sombras). */
function heavyDesign(count) {
  const stops = [0, 25, 50, 75, 100].map((at) => ({ at, color: "#7c3aed99" }));
  const radial = (index) => ({ extent: "closest-side", kind: "radial", shape: "circle", stops, x: index, y: 50 });

  return design(
    Array.from({ length: count }, (_, index) => ({
      box: {
        fill: [radial(1), radial(2), radial(3)],
        shadows: [
          { blur: 10, color: "#000000aa", inset: true, spread: 2, x: 1, y: 2 },
          { blur: 20, color: "#000000bb", spread: 3, x: 3, y: 4 }
        ]
      },
      id: `forma${index}`,
      name: `Forma ${index}`,
      place: { h: 100, mode: "free", rotate: 5, w: 100, x: index, y: index, z: 1 },
      type: "shape"
    }))
  );
}

test("design acima de 30.000 na estimativa é recusado com a frase do tamanho", () => {
  const small = heavyDesign(4);
  const big = heavyDesign(24);

  valid(small);
  assert.ok(model.jsonbBytesUpperBound(model.canonicalPopupFreeDesign(big)) > 30_000);
  hasIssue(big, "size", M.size);
  assert.ok(checks.freeDesignSizePercent(model.canonicalPopupFreeDesign(big)) > 100);
  assert.equal(checks.freeDesignSizeLabel(17), "Tamanho do design: 17 % do máximo.");
  assert.equal(schema.freeErrorKey(big, "freeDesign.size"), "freeDesign.size");
});

/* ------------------------------------------------------------------------------------------------
 * Forma canonica, roteador e caminhos gravados
 * ---------------------------------------------------------------------------------------------- */

test("forma canônica tira padrões, ordena paradas, encurta lados, junta partes iguais, tira arquivos sem uso e mantém assets e fonts", () => {
  const input = {
    artboard: { align: "stretch", fill: [{ color: "#16181C", kind: "solid" }], gap: 12, justify: "start", minHeight: 0, padding: [8, 8, 8, 8], radius: 24, width: 440 },
    assets: [imageAsset("usada"), imageAsset("sobra", NOTICE_IMAGE_PATH), videoAsset("video", { poster: "capa" }), imageAsset("capa", `communications/free/${"b".repeat(24)}.webp`)],
    children: [
      {
        box: { opacity: 100, padding: [4, 10, 4, 10], radius: [6, 6, 6, 6] },
        hidden: false,
        id: "titulo",
        lines: [
          [
            { text: "Experimente " },
            { style: { weight: 800 }, text: "grátis " },
            { style: { font: { id: FONT_A.toUpperCase(), kind: "uploaded" }, paint: { color: "#E5FF1F", kind: "solid" } }, text: "agora" }
          ]
        ],
        locked: false,
        name: "   ",
        place: { margin: 0, mode: "flow", width: "fill" },
        textStyle: {
          align: "left",
          italic: false,
          lineHeight: 1.234,
          paint: { angle: 180, kind: "linear", stops: [{ at: 100, color: "#FFFFFF" }, { at: 0, color: "#AAAAAA" }] },
          size: 28,
          weight: 800
        },
        type: "heading"
      },
      { asset: "usada", fit: "cover", focus: [50, 50], id: "foto", type: "image" },
      { asset: "video", id: "midia", type: "video" },
      { action: { kind: "close" }, icon: { name: "check", side: "end" }, id: "fechar", label: "  Agora não  ", place: { mode: "flow", width: "hug" }, type: "button" },
      { dismiss: true, gap: 8, id: "links", type: "links" }
    ],
    close: { background: "#FFFFFF1F", color: "#ffffff", inset: 12, side: "right", size: 36 },
    mode: "free",
    version: 1
  };
  const canonical = valid(input);

  assert.deepEqual(canonical, {
    artboard: { padding: 8 },
    assets: [imageAsset("usada"), videoAsset("video", { poster: "capa" }), imageAsset("capa", `communications/free/${"b".repeat(24)}.webp`)],
    children: [
      {
        box: { padding: [4, 10], radius: 6 },
        id: "titulo",
        lines: [[{ text: "Experimente grátis " }, { style: { font: { id: FONT_A, kind: "uploaded" }, paint: { color: "#e5ff1f", kind: "solid" } }, text: "agora" }]],
        textStyle: { lineHeight: 1.23, paint: { kind: "linear", stops: [{ at: 0, color: "#aaaaaa" }, { at: 100, color: "#ffffff" }] } },
        type: "heading"
      },
      { asset: "usada", id: "foto", type: "image" },
      { asset: "video", id: "midia", type: "video" },
      { action: { kind: "close" }, icon: { name: "check" }, id: "fechar", label: "Agora não", type: "button" },
      { id: "links", type: "links" }
    ],
    fonts: [FONT_A],
    mode: "free",
    version: 1
  });
  assert.deepEqual(model.canonicalPopupFreeDesign(canonical), canonical, "idempotente");
  assert.deepEqual(Object.keys(canonical), ["artboard", "assets", "children", "fonts", "mode", "version"], "chaves em ordem alfabetica");
  assert.deepEqual(model.uploadedFontIdsOfFree(canonical), [FONT_A]);

  // Partes iguais nao passam de 600 letras ao juntar.
  const joined = model.canonicalPopupFreeDesign(design([{ id: "t", lines: [[{ text: "a".repeat(400) }, { text: "b".repeat(400) }]], type: "text" }]));
  assert.equal(joined.children[0].lines[0].length, 2);
});

test("parseStoredPopupDesign: Personalizado, Livre, inválido e outra versão", () => {
  const personalizado = custom.popupStarterDesign("text_only");
  const livre = starters.freeStarterDesign("blank");

  assert.deepEqual(router.parseStoredPopupDesign(personalizado), { design: personalizado, freeDesign: null });
  assert.deepEqual(router.parseStoredPopupDesign(livre), { design: null, freeDesign: livre });
  assert.deepEqual(router.parseStoredPopupDesign({ ...livre, artboard: { width: 9999 } }), { design: null, freeDesign: null });
  assert.deepEqual(router.parseStoredPopupDesign({ ...livre, version: 2 }), { design: null, freeDesign: null });
  assert.deepEqual(router.parseStoredPopupDesign({ ...personalizado, version: 2 }), { design: null, freeDesign: null });
  assert.deepEqual(router.parseStoredPopupDesign({ ...personalizado, mode: "free" }), { design: null, freeDesign: null }, "Personalizado com mode free nao vira nada");
  assert.deepEqual(router.parseStoredPopupDesign({ ...livre, mode: undefined }), { design: null, freeDesign: null }, "Livre sem mode nao vira Personalizado");
  assert.deepEqual(router.parseStoredPopupDesign(null), { design: null, freeDesign: null });
  assert.equal(router.popupDesignKindOf(personalizado), "custom");
  assert.equal(router.popupDesignKindOf(livre), "free");
  assert.equal(router.popupDesignKindOf({ ...livre, version: 9 }), "free", "o tipo sem validar a fundo");
  assert.equal(router.popupDesignKindOf(null), "default");
  assert.equal(schema.parsePopupFreeDesign(personalizado), null);
  assert.equal(schema.parsePopupFreeDesign(undefined), null);
});

test("storedPopupDesignAssetPaths lê os caminhos do Livre e do Personalizado", () => {
  const livre = valid(
    design([{ asset: "v", id: "midia", type: "video" }, { box: { fill: [{ asset: "img", kind: "image" }] }, id: "forma", type: "shape" }], {
      assets: [videoAsset("v", { poster: "capa" }), imageAsset("capa", NOTICE_IMAGE_PATH), imageAsset("img")]
    })
  );

  assert.deepEqual(router.storedPopupDesignAssetPaths(livre).sort(), [IMAGE_PATH, NOTICE_IMAGE_PATH, VIDEO_PATH].sort());

  const personalizado = custom.popupStarterDesign("media_top_fade", {
    video: { mimeType: "video/mp4", path: VIDEO_PATH, url: `${ORIGIN}/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}` }
  });
  personalizado.card.background = {
    color: "#16181c",
    dim: 40,
    kind: "image",
    position: "bottom",
    url: `${ORIGIN}/storage/v1/object/public/content-assets/${NOTICE_IMAGE_PATH}`
  };

  assert.deepEqual(router.storedPopupDesignAssetPaths(personalizado).sort(), [NOTICE_IMAGE_PATH, VIDEO_PATH].sort());
  assert.deepEqual(router.storedPopupDesignAssetPaths(custom.popupStarterDesign("text_only")), []);
  assert.deepEqual(router.storedPopupDesignAssetPaths(null), []);
  assert.deepEqual(router.storedPopupDesignAssetPaths({ mode: "free", assets: "lixo" }), []);
  assert.deepEqual(router.storedPopupDesignFontIds({ fonts: [FONT_A.toUpperCase(), FONT_A, 3] }), [FONT_A]);
  assert.deepEqual(router.storedPopupDesignFontIds(null), []);
});

/* ------------------------------------------------------------------------------------------------
 * Conteudo do aviso, rascunho e banco
 * ---------------------------------------------------------------------------------------------- */

test("regras com o conteúdo do aviso: botão, áudio, Lembrar depois, imagem e vídeo sem arquivo", () => {
  const audio = { durationSeconds: 10, mimeType: "audio/mpeg", peaks: [], url: "https://x/a.mp3" };
  const cta = { href: "/minhas-compras", label: "Ver", target: "same_tab" };
  const problems = (value, content) => schema.popupFreeContentProblems(valid(value), { allowSnooze: true, audio: null, cta: null, ...content }).map((item) => [item.path.join("."), item.message]);
  const ctaButton = { action: { kind: "cta" }, id: "botao", type: "button" };

  assert.deepEqual(problems(design([heading("t")]), {}), []);
  assert.deepEqual(problems(design([heading("t")]), { cta }), [["freeDesign", M.ctaMissing]]);
  assert.deepEqual(problems(design([ctaButton]), {}), [["cta.label", M.cta]]);
  assert.deepEqual(problems(design([ctaButton]), { cta }), []);
  assert.deepEqual(problems(design([heading("t")]), { audio }), [["freeDesign", M.audioMissing]]);
  assert.deepEqual(problems(design([{ id: "audio", type: "audio" }]), {}), [["audio", M.audio]]);
  assert.deepEqual(problems(design([{ children: [{ id: "audio", type: "audio" }], id: "caixa", type: "box" }]), { audio }), [], "o Áudio dentro de uma caixa conta");
  assert.deepEqual(problems(design([{ action: { kind: "snooze" }, id: "depois", label: "Depois", type: "button" }]), { allowSnooze: false }), [["freeDesign.nodes.depois.action", M.snooze]]);
  assert.deepEqual(problems(design([{ asset: null, id: "foto", type: "image" }]), {}), [["freeDesign.nodes.foto.asset", M.imageMissing]]);
  assert.deepEqual(problems(design([{ asset: null, id: "midia", type: "video" }]), {}), [["freeDesign.nodes.midia.asset", M.videoMissing]]);

  // O rascunho do aviso: um design so, e "Quando o aluno clica no botão" vale com o botao "Abrir um link".
  const draft = (extra) => ({ ...schemas.emptyNoticeDraft("popup"), body: "", title: "Pop-up Livre", ...extra });
  const draftIssues = (value) => {
    const result = schemas.noticeDraftSchema.safeParse(value);

    return result.success ? [] : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
  };
  const livre = design([heading("t")]);

  assert.deepEqual(draftIssues(draft({ freeDesign: livre })), []);
  assert.deepEqual(draftIssues(draft({ design: custom.popupStarterDesign("text_only"), freeDesign: livre })).filter(([path]) => path === "freeDesign"), [["freeDesign", M.bothDesigns]]);
  assert.deepEqual(draftIssues(draft({ design: null, freeDesign: livre })), []);

  const clickStop = { ...schemas.emptyNoticeDraft("popup").popup, frequency: { everyMinutes: 60, maxPerDay: 1, maxTotal: null, mode: "repeat", stopOn: "click" } };
  const withLink = design([{ action: { href: "/minhas-compras", kind: "link", target: "same_tab" }, id: "abrir", label: "Abrir", type: "button" }]);

  assert.ok(draftIssues(draft({ freeDesign: livre, popup: clickStop })).some(([path]) => path === "popup.frequency.stopOn"));
  assert.deepEqual(draftIssues(draft({ freeDesign: withLink, popup: clickStop })).filter(([path]) => path === "popup.frequency.stopOn"), []);

  // A notificacao do sino nunca leva o Livre: a chave sai antes de validar.
  const inbox = schemas.noticeDraftSchema.safeParse({ ...schemas.emptyNoticeDraft("inbox"), body: "Oi", freeDesign: livre, title: "Oi" });
  assert.equal(inbox.success, true);
  assert.equal("freeDesign" in inbox.data, false);
});

test("store: o Livre vai para popup_design e volta pelo roteador; inválido = Padrão; a notificação continua sem a chave", () => {
  const livre = starters.freeStarterDesign("glow_text");
  const draft = { ...schemas.emptyNoticeDraft("popup"), cta: { href: "/", label: "Ver", target: "same_tab" }, design: null, freeDesign: livre, title: "Pop-up" };
  const columns = store.draftToColumns(draft);

  assert.deepEqual(columns.popup_design, livre);

  const back = store.rowToDraft(linhaDe(columns));

  assert.deepEqual(back.freeDesign, livre);
  assert.equal(back.design, null);

  const invalid = store.rowToDraft(linhaDe(columns, { popup_design: { ...livre, children: [] } }));

  assert.equal(invalid.freeDesign, null, "Livre invalido abre como Padrão no editor");
  assert.equal(invalid.design, null);

  const personalizado = custom.popupStarterDesign("text_only");
  const fromCustom = store.rowToDraft(linhaDe(store.draftToColumns({ ...draft, design: personalizado, freeDesign: null })));

  assert.deepEqual(fromCustom.design, personalizado);
  assert.equal(fromCustom.freeDesign, null);

  const inbox = store.rowToDraft(linhaDe(store.draftToColumns({ ...schemas.emptyNoticeDraft("inbox"), body: "Oi", title: "Oi" })));

  assert.equal("freeDesign" in inbox, false);
  assert.equal(store.draftToColumns({ ...schemas.emptyNoticeDraft("inbox"), body: "Oi", freeDesign: livre, title: "Oi" }).popup_design, null);
});

/* ------------------------------------------------------------------------------------------------
 * Chaves de erro, reescala, o que vai ao aluno
 * ---------------------------------------------------------------------------------------------- */

test("freeErrorKey troca índices por ids e freeNodeIdOfKey devolve o elemento", () => {
  const value = valid(
    design([heading("titulo"), { children: [{ action: { href: "/x", kind: "link", target: "same_tab" }, id: "botao", label: "Ver", type: "button" }], id: "caixa", type: "box" }], {
      assets: [imageAsset("capa")],
      children: [
        heading("titulo"),
        { children: [{ action: { href: "/x", kind: "link", target: "same_tab" }, id: "botao", label: "Ver", type: "button" }], id: "caixa", type: "box" },
        { asset: "capa", id: "foto", type: "image" },
        LINKS
      ]
    })
  );

  assert.equal(schema.freeErrorKey(value, "freeDesign.children.1.children.0.action.href"), "freeDesign.nodes.botao.action.href");
  assert.equal(schema.freeErrorKey(value, "freeDesign.children.0.lines.0.1.text"), "freeDesign.nodes.titulo.lines.0.1.text");
  assert.equal(schema.freeErrorKey(value, "freeDesign.children.1.children"), "freeDesign.nodes.caixa.children");
  assert.equal(schema.freeErrorKey(value, "freeDesign.children.1"), "freeDesign.nodes.caixa");
  assert.equal(schema.freeErrorKey(value, "freeDesign.children"), "freeDesign");
  assert.equal(schema.freeErrorKey(value, "freeDesign.children.9.place"), "freeDesign");
  assert.equal(schema.freeErrorKey(value, "freeDesign.assets.0.path"), "freeDesign.assets.capa");
  assert.equal(schema.freeErrorKey(value, "freeDesign.close.color"), "freeDesign.close.color");
  assert.equal(schema.freeErrorKey(value, "freeDesign.artboard.fill.0.stops"), "freeDesign.artboard.fill.0.stops");
  assert.equal(schema.freeErrorKey(value, "freeDesign.nodes.botao.label"), "freeDesign.nodes.botao.label");
  assert.equal(schema.freeErrorKey(value, "title"), "title");
  assert.equal(schema.freeErrorKey(null, "freeDesign.children.0.id"), "freeDesign");
  assert.deepEqual(schema.freeErrorKeys(value, { "freeDesign.children.0.textStyle.size": "Use de 10 a 160.", title: "Escreva um título." }), {
    "freeDesign.nodes.titulo.textStyle.size": "Use de 10 a 160.",
    title: "Escreva um título."
  });
  assert.equal(model.freeNodeIdOfKey("nodes.botao.action.href"), "botao");
  assert.equal(model.freeNodeIdOfKey("freeDesign.nodes.botao"), "botao");
  assert.equal(model.freeNodeIdOfKey("artboard.fill.0"), null);
  assert.equal(model.freeNodeIdOfKey("nodes.Botao.x"), null);
  assert.deepEqual(model.findFreeNode(value, "botao").depth, 2);
  assert.equal(model.findFreeNode(value, "botao").parent.id, "caixa");
  assert.equal(model.findFreeNode(value, "nada"), null);
  assert.equal(model.freeNodeCount(value), 5);
  assert.equal(model.updateFreeNode(value, "nada", (node) => ({ ...node, hidden: true })), value, "nada mudou: o mesmo objeto");

  const updated = model.updateFreeNode(value, "botao", (node) => ({ ...node, hidden: true }));

  assert.equal(updated.children[1].children[0].hidden, true);
  assert.equal(updated.children[0], value.children[0], "o resto fica com a mesma referencia");
  assert.equal(model.nextFreeId(value, "titulo"), "titulo2");
  assert.equal(model.nextFreeId(value, "capa"), "capa2", "unico tambem entre os arquivos");
  assert.equal(model.nextFreeId(value, "Selo!"), "selo");
  assert.equal(model.nextFreeId(value, "2x"), "e2x");
});

test("rescaleFreeDesign multiplica medidas pela nova largura dentro dos limites", () => {
  const value = valid(
    design([
      {
        box: { border: { color: "#ffffff", width: 1 }, padding: [10, 20], radius: 999, shadows: [{ blur: 80, color: "#000000", spread: 2, x: 0, y: 24 }] },
        id: "titulo",
        lines: [[{ style: { size: 120 }, text: "Grande" }]],
        place: { h: 110, mode: "free", rotate: 10, w: 220, x: 44, y: 22 },
        textStyle: { size: 28 },
        type: "heading"
      },
      { icon: "star", id: "icone", type: "icon" },
      { id: "linha", type: "divider" },
      { id: "espaco", type: "spacer" },
      { children: [text("texto")], id: "caixa", layout: { gap: 10 }, place: { margin: [8, 0], mode: "flow", width: 200 }, type: "box" }
    ], { artboard: { gap: 12, padding: [20, 40], radius: 24 } })
  );
  const big = model.rescaleFreeDesign(value, 660);
  const [titulo, icone, linha, espaco, caixa] = big.children;

  assert.equal(big.artboard.width, 660);
  assert.deepEqual(big.artboard.padding, [30, 60]);
  assert.equal(big.artboard.gap, 18);
  assert.equal(big.artboard.radius, 36);
  assert.deepEqual(titulo.place, { h: 165, mode: "free", rotate: 10, w: 330, x: 66, y: 33 });
  assert.equal(titulo.textStyle.size, 42);
  assert.equal(titulo.lines[0][0].style.size, 160, "dentro do limite (180 vira 160)");
  assert.equal(titulo.box.radius, 999, "pilula continua pilula");
  assert.equal(titulo.box.border.width, 1, "borda fica em px");
  assert.deepEqual(titulo.box.padding, [15, 30]);
  assert.deepEqual(titulo.box.shadows[0], { blur: 120, color: "#000000", spread: 3, x: 0, y: 36 });
  assert.equal(icone.size, 36);
  assert.equal(linha.thickness, 2);
  assert.equal(espaco.size, 24);
  assert.equal(caixa.layout.gap, 15);
  assert.deepEqual(caixa.place, { margin: [12, 0], mode: "flow", width: 300 });
  valid(big);

  const small = model.rescaleFreeDesign(valid(design([{ ...text("t"), textStyle: { size: 10 } }])), 280);

  assert.equal(small.artboard.width, 280);
  assert.equal(render.freeTextStyleOf(small.children[0]).size, 10);
  assert.deepEqual(model.rescaleFreeDesign(value, 440), value, "a mesma largura nao muda nada");
});

test("freeDesignForStudent tira locked e name", () => {
  const value = valid(
    design([
      { ...heading("titulo"), locked: true, name: "Título grande" },
      { children: [{ ...text("texto"), hidden: true, locked: true, name: "Texto" }], id: "caixa", name: "Caixa", type: "box" }
    ])
  );
  const student = model.freeDesignForStudent(value);

  assert.equal(JSON.stringify(student).includes('"locked"'), false);
  assert.equal(JSON.stringify(student).includes('"name"'), false);
  assert.equal(student.children[1].children[0].hidden, true, "escondido continua escondido");
  valid(student);
  assert.equal(value.children[0].locked, true, "o original nao muda");
});

/* ------------------------------------------------------------------------------------------------
 * Origem e endereco dos arquivos
 * ---------------------------------------------------------------------------------------------- */

test("freeStorageOrigin recusa máquinas com aspas, parênteses, vírgula, ponto e vírgula, espaço e barra invertida, usuário, caminho e http fora da própria máquina", () => {
  assert.equal(render.freeStorageOrigin("https://abc.supabase.co"), "https://abc.supabase.co");
  assert.equal(render.freeStorageOrigin("https://abc.supabase.co/"), "https://abc.supabase.co");
  assert.equal(render.freeStorageOrigin("https://ABC.supabase.co:8443"), "https://abc.supabase.co:8443");
  assert.equal(render.freeStorageOrigin("http://127.0.0.1:54321"), "http://127.0.0.1:54321");
  assert.equal(render.freeStorageOrigin("http://localhost:54321"), "http://localhost:54321");
  assert.equal(render.freeStorageOrigin("http://[::1]:54321"), "http://[::1]:54321");

  for (const value of [
    'https://a"b.supabase.co',
    "https://a'b.supabase.co",
    "https://a(b).supabase.co",
    "https://a,b.supabase.co",
    "https://a;b.supabase.co",
    "https://a b.supabase.co",
    "https://a\\b.supabase.co",
    "https://user:senha@abc.supabase.co",
    "https://user@abc.supabase.co",
    "https://abc.supabase.co/storage",
    "https://abc.supabase.co?x=1",
    "https://abc.supabase.co#x",
    "http://abc.supabase.co",
    "http://192.168.0.10:54321",
    "ftp://abc.supabase.co",
    "javascript:alert(1)",
    "",
    "   ",
    null,
    undefined
  ]) {
    assert.equal(render.freeStorageOrigin(value), null, String(value));
  }
});

test("freeAssetUrl só monta endereço de caminho do padrão e da origem conferida", () => {
  assert.equal(render.freeAssetUrl(imageAsset("a"), ORIGIN), `${ORIGIN}/storage/v1/object/public/content-assets/${IMAGE_PATH}`);
  assert.equal(render.freeAssetUrl(imageAsset("a", NOTICE_IMAGE_PATH), ORIGIN), `${ORIGIN}/storage/v1/object/public/content-assets/${NOTICE_IMAGE_PATH}`);
  assert.equal(render.freeAssetUrl(videoAsset("v"), ORIGIN), `${ORIGIN}/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}`);
  assert.equal(render.freeAssetUrl(videoAsset("v", { mimeType: "video/webm" }), ORIGIN), null, "extensao diferente do tipo");
  assert.equal(render.freeAssetUrl(imageAsset("a", `communications/free/${HEX}.webp") a`), ORIGIN), null);
  assert.equal(render.freeAssetUrl(imageAsset("a", `communications/free/../${HEX}.webp`), ORIGIN), null);
  assert.equal(render.freeAssetUrl(imageAsset("a", VIDEO_PATH), ORIGIN), null, "caminho de outro tipo");
  assert.equal(render.freeAssetUrl(imageAsset("a"), null), null);
  assert.equal(render.freeAssetUrl(imageAsset("a"), 'https://a"b.co'), null, "origem que nao passou na conferencia");
  assert.equal(render.freeAssetUrl(imageAsset("a"), `${ORIGIN}/`), null, "origem fora da forma conferida");
  assert.equal(render.freeAssetUrl({ id: "x", kind: "audio", path: IMAGE_PATH }, ORIGIN), null);
});

/* ------------------------------------------------------------------------------------------------
 * Modelos, sincronia, JSON Schema e o documento
 * ---------------------------------------------------------------------------------------------- */

test("os quatro modelos são válidos, sem dica de contraste e abaixo de 20 % do tamanho", () => {
  assert.deepEqual(
    starters.FREE_DESIGN_STARTERS.map((item) => item.id),
    ["video_top_fade", "glow_text", "blank", "cutout_sticker"]
  );

  for (const { id } of starters.FREE_DESIGN_STARTERS) {
    const value = starters.freeStarterDesign(id);

    assert.deepEqual(valid(value), value, `${id}: ja na forma canonica`);
    assert.deepEqual(checks.popupFreeHints(value).filter((hint) => hint.kind === "contrast"), [], id);
    assert.ok(checks.freeDesignSizePercent(value) < 20, `${id}: ${checks.freeDesignSizePercent(value)} %`);
    assert.equal(model.freeCloseVisibilityProblem(value), null, id);
  }

  // A referencia: video solto no topo sumindo para baixo, selo, titulo condensado de duas cores e o botao principal.
  const reference = starters.freeStarterDesign("video_top_fade");

  assert.deepEqual(reference.children[0].place, { h: 248, mode: "free", w: 440, x: 0, y: 0 });
  assert.deepEqual(reference.children[0].box.fade, { end: 100, side: "bottom", start: 40 });
  assert.equal(render.freeArtboardMinHeight(reference), 248);
  assert.equal(render.freeHeadingText(render.freeFirstHeading(reference)), "Experimente grátis Nova aula ao vivo");

  // Aplicar: sem botao no aviso cria "Saiba mais" com destino vazio; com audio entra o Áudio; video e capa entram.
  const applied = starters.applyFreeStarter("video_top_fade", {
    audio: { durationSeconds: 3 },
    cta: null,
    poster: { height: 720, path: NOTICE_IMAGE_PATH, width: 1280 },
    video: { mimeType: "video/mp4", path: VIDEO_PATH }
  });

  assert.deepEqual(applied.cta, { href: "", label: "Saiba mais", target: "same_tab" });
  assert.deepEqual(applied.design.assets, [imageAsset("capa", NOTICE_IMAGE_PATH, { height: 720, width: 1280 }), videoAsset("video", { poster: "capa" })]);
  assert.equal(applied.design.children.find((node) => node.type === "video").asset, "video");
  assert.deepEqual(
    applied.design.children.map((node) => node.type),
    ["video", "badge", "heading", "text", "audio", "button", "links"]
  );
  valid(applied.design);

  const keepCta = starters.applyFreeStarter("blank", { audio: null, cta: { href: "/minhas-compras", label: "Quero", target: "new_tab" } });

  assert.deepEqual(keepCta.cta, { href: "/minhas-compras", label: "Quero", target: "new_tab" });
  assert.deepEqual(keepCta.design, starters.freeStarterDesign("blank"));

  const badVideo = starters.applyFreeStarter("video_top_fade", { audio: null, cta: null, poster: { height: 9000, path: NOTICE_IMAGE_PATH, width: 1280 }, video: { mimeType: "video/webm", path: VIDEO_PATH } });

  assert.deepEqual(badVideo.design.assets, [], "video com extensao de outro tipo nao entra");
});

test("syncFreeDesignWithContent põe e tira o Áudio", () => {
  const base = starters.freeStarterDesign("blank");
  const withAudio = starters.syncFreeDesignWithContent(base, { hasAudio: true, hasCta: true });

  assert.deepEqual(
    withAudio.children.map((node) => node.type),
    ["heading", "audio", "button", "links"],
    "antes do primeiro botao da prancheta"
  );
  assert.equal(starters.syncFreeDesignWithContent(withAudio, { hasAudio: true, hasCta: true }), withAudio, "nada a mudar: o mesmo objeto");

  const without = starters.syncFreeDesignWithContent(withAudio, { hasAudio: false, hasCta: true });

  assert.deepEqual(without.children.map((node) => node.type), ["heading", "button", "links"]);

  const noButtons = valid(design([heading("t")]));

  assert.deepEqual(starters.syncFreeDesignWithContent(noButtons, { hasAudio: true, hasCta: false }).children.map((node) => node.type), ["heading", "audio", "links"], "sem botao: antes dos Links");

  const inBox = valid(design([{ children: [{ id: "audio", type: "audio" }], id: "caixa", type: "box" }]));

  assert.deepEqual(starters.syncFreeDesignWithContent(inBox, { hasAudio: false, hasCta: false }).children[0].children, [], "sai tambem de dentro de uma caixa");

  // O botao principal acompanha o botao do aviso.
  assert.deepEqual(starters.syncFreeDesignWithContent(base, { hasAudio: false, hasCta: false }).children.map((node) => node.type), ["heading", "links"]);
  assert.deepEqual(starters.syncFreeDesignWithContent(noButtons, { hasAudio: false, hasCta: true }).children.map((node) => node.type), ["heading", "button", "links"]);

  // Elementos novos valem no schema.
  for (const kind of starters.FREE_ELEMENT_KINDS) {
    const node = starters.newFreeNode(kind, model.nextFreeId(base, starters.FREE_ELEMENT_ID_PREFIX[kind]), { design: base });

    assert.ok(model.FREE_ID_PATTERN.test(node.id), kind);
    assert.ok(model.FREE_NODE_TYPES.includes(node.type), kind);
  }

  assert.deepEqual(starters.newFreeNode("shape", "forma", { center: { x: 200, y: 300 } }).place, { h: 120, mode: "free", w: 120, x: 140, y: 240 });
  assert.equal(starters.newFreeNode("gradient", "degrade", { design: base }).place.z, -1);
  assert.deepEqual(starters.newFreeNode("gradient", "degrade", { design: base }).box.fill[0].stops.map((stop) => stop.color), ["#16181c00", "#16181c"]);
});

test("popupFreeJsonSchema gera o JSON Schema da entrada com o nó recursivo em $ref", () => {
  const jsonSchema = jsonSchemaModule.popupFreeJsonSchema();
  const serialized = JSON.stringify(jsonSchema);

  assert.equal(jsonSchema.type, "object");
  assert.deepEqual([...jsonSchema.required].sort(), ["children", "mode", "version"]);
  assert.ok(jsonSchema.$defs && Object.keys(jsonSchema.$defs).length > 0, "tem $defs");
  assert.ok(serialized.includes('"$ref"'), "o no recursivo sai como $ref");
  assert.equal(jsonSchema.additionalProperties, false, "estrito");
  assert.ok(serialized.includes('"free"'));
  assert.ok(serialized.length < 60_000, `${serialized.length} caracteres`);

  // Fechamento (docs/27 §7): so o modulo proprio chama o toJSONSchema; nenhuma tela o importa (o zod e um pedaco
  // compartilhado com o Inicio do aluno e os conversores custariam ~0,8 KB gzip a todo aluno).
  const raiz = new URL("../src/", import.meta.url);
  const chamam = readdirSync(raiz, { recursive: true })
    .filter((arquivo) => /\.(ts|tsx)$/.test(arquivo))
    .filter((arquivo) => readFileSync(new URL(arquivo, raiz), "utf8").includes("toJSONSchema("));
  assert.deepEqual(chamam, [join("server", "communications", "popup-free-json-schema.ts")]);
  const importam = readdirSync(raiz, { recursive: true })
    .filter((arquivo) => /\.(ts|tsx)$/.test(arquivo))
    .filter((arquivo) => /(?:from|import\()\s*["'][^"']*popup-free-json-schema["']/.test(readFileSync(new URL(arquivo, raiz), "utf8")));
  assert.deepEqual(importam, [], "nenhum arquivo do app importa o JSON Schema");
});

test("os exemplos do docs/27 passam no schema", () => {
  const doc = readFileSync(new URL("../docs/27-comunicacao-design-livre.md", import.meta.url), "utf8");
  const section = doc.slice(doc.indexOf("## 9. Contrato do JSON"), doc.indexOf("## 10."));
  const blocks = [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);

  assert.ok(blocks.length >= 5, `${blocks.length} exemplos`);

  for (const block of blocks) {
    const value = JSON.parse(block);

    valid(value);
  }

  // Os tres modelos estao no documento exatamente como o codigo os gera.
  for (const { id } of starters.FREE_DESIGN_STARTERS) {
    assert.ok(
      blocks.some((block) => JSON.stringify(JSON.parse(block)) === JSON.stringify(starters.freeStarterDesign(id))),
      `o modelo ${id} esta no docs/27 §9`
    );
  }
});

/* ------------------------------------------------------------------------------------------------
 * Dicas do Revisar
 * ---------------------------------------------------------------------------------------------- */

test("dicas: contraste, texto pequeno, texto no celular, ordem de leitura, texto por cima de botão, cortado, celular alto, fonte que muda e vídeo sem capa", () => {
  const value = valid(
    design(
      [
        { id: "baixo", lines: [[{ text: "Contraste ruim" }]], textStyle: { paint: { color: "#333333", kind: "solid" }, size: 16 }, type: "text" },
        { id: "parte", lines: [[{ text: "Oi " }, { style: { paint: { color: "#202020", kind: "solid" } }, text: "escuro" }]], textStyle: { size: 30 }, type: "heading" },
        { id: "miudo", lines: [[{ text: "Letra miúda" }]], textStyle: { size: 11 }, type: "text" },
        { id: "condensado", lines: [[{ text: "Título" }]], textStyle: { font: { key: "condensed", kind: "builtin" } }, type: "heading" },
        { asset: "v", id: "midia", type: "video" },
        { action: { kind: "close" }, id: "fechar", label: "Agora não", type: "button" },
        { id: "selo", label: "Por cima", place: { mode: "free", w: 120, x: 20, y: 300 }, type: "badge" },
        { id: "solto", lines: [[{ text: "Cortado" }]], place: { mode: "free", w: 200, x: 0, y: 380 }, type: "text" }
      ],
      { assets: [videoAsset("v")] }
    )
  );
  const kinds = (hints) => hints.map((hint) => hint.kind);
  const plain = checks.popupFreeHints(value);

  assert.deepEqual(
    plain.filter((hint) => hint.kind === "contrast").map((hint) => hint.key),
    ["nodes.baixo.textStyle.paint", "nodes.parte.lines.0.1.style.paint"]
  );
  assert.ok(plain.find((hint) => hint.kind === "contrast").message.startsWith("Contraste baixo ("));
  assert.deepEqual(plain.find((hint) => hint.kind === "small-text"), { key: "nodes.miudo.textStyle.size", kind: "small-text", message: "Texto abaixo de 12 px fica difícil de ler.", nodeId: "miudo" });
  // Texto no celular (L1.1): os textos curtos daqui so crescem um pouco com o piso de 12 px, sem mudar de linha.
  assert.equal(plain.some((hint) => hint.kind === "phone-text"), false, "texto que so cresce um pouco nao gera dica");
  assert.deepEqual(plain.find((hint) => hint.kind === "font-device").key, "nodes.condensado.textStyle.font");
  assert.deepEqual(plain.find((hint) => hint.kind === "no-poster"), { key: "nodes.midia.asset", kind: "no-poster", message: "Sem capa: quem prefere menos movimento não vê o vídeo.", nodeId: "midia" });
  assert.deepEqual(
    kinds(plain).filter((kind) => ["reading-order", "cover", "cut", "phone-scroll"].includes(kind)),
    [],
    "sem retangulos, nenhuma dica de geometria"
  );

  const rects = {
    "@artboard": { h: 900, w: 440, x: 0, y: 0 },
    baixo: { h: 20, w: 392, x: 24, y: 24 },
    condensado: { h: 30, w: 392, x: 24, y: 120 },
    fechar: { h: 40, w: 120, x: 24, y: 300 },
    links: { h: 20, w: 392, x: 24, y: 860 },
    midia: { h: 200, w: 392, x: 24, y: 400 },
    miudo: { h: 20, w: 392, x: 24, y: 60 },
    parte: { h: 40, w: 392, x: 24, y: 80 },
    selo: { h: 30, w: 120, x: 20, y: 300 },
    solto: { h: 600, w: 200, x: 0, y: 380 }
  };
  const measured = checks.popupFreeHints(value, { rects });

  assert.ok(measured.some((hint) => hint.kind === "cover" && hint.nodeId === "selo" && hint.message === "“Por cima” está por cima do “Agora não” e pode atrapalhar o clique."));
  assert.ok(measured.some((hint) => hint.kind === "cut" && hint.nodeId === "solto" && hint.message === "“Cortado” está cortado no fim do pop-up." && hint.key === "nodes.solto.place.h"));
  assert.ok(measured.some((hint) => hint.kind === "phone-scroll" && hint.key === "artboard.minHeight" && hint.nodeId === null));
  assert.deepEqual(
    measured.filter((hint) => hint.kind === "reading-order"),
    [
      {
        key: "nodes.miudo",
        kind: "reading-order",
        message: "O leitor de tela lê “Letra miúda” depois de “Oi escuro”, mas na tela ele aparece antes. Mude a ordem nas Camadas.",
        nodeId: "miudo"
      }
    ],
    "so o que aparece mais de 8 px acima do anterior (selo e botao na mesma altura nao contam)"
  );
  // Texto sobre a midia (pelos retangulos): o contraste nao e medido.
  assert.equal(measured.some((hint) => hint.kind === "contrast" && hint.nodeId === "solto"), false);

  // Imagem no fundo da prancheta: nao da para medir o contraste.
  const onImage = valid(design([{ id: "t", lines: [[{ text: "Oi" }]], textStyle: { paint: { color: "#333333", kind: "solid" } }, type: "text" }], {
    artboard: { fill: [{ asset: "img", kind: "image" }] },
    assets: [imageAsset("img")]
  }));

  assert.deepEqual(checks.popupFreeHints(onImage).filter((hint) => hint.kind === "contrast"), []);
  // Escondido nao gera dica.
  assert.deepEqual(checks.popupFreeHints(valid(design([{ hidden: true, id: "t", lines: [[{ text: "Oi" }]], textStyle: { size: 10 }, type: "text" }]))).filter((hint) => hint.nodeId === "t"), []);
});

test("vocabulário das frases, dos modelos e das dicas", () => {
  const forbidden = /\b(campanha|público|audiência|evento|oferta|gatilho|trigger|sessão|impressão|home|automação|lembrete|layout|template|fluxo)/i;
  const texts = [
    ...Object.values(schema.POPUP_FREE_MESSAGES),
    ...starters.FREE_DESIGN_STARTERS.flatMap((item) => [item.label, item.description]),
    ...starters.FREE_DESIGN_STARTERS.flatMap(({ id }) => JSON.stringify(starters.freeStarterDesign(id)).match(/"(?:text|label|name)":"[^"]*"/g) ?? []),
    ...starters.FREE_ELEMENT_KINDS.flatMap((kind) => JSON.stringify(starters.newFreeNode(kind, "x")).match(/"(?:text|label|name)":"[^"]*"/g) ?? []),
    ...Object.values(checks.POPUP_FREE_HINT_MESSAGES).map((value) => (typeof value === "function" ? value("A", "B") : value)),
    ...Object.values(checks.FREE_NODE_TYPE_LABELS),
    checks.freeDesignSizeLabel(10)
  ];

  for (const value of texts) {
    assert.equal(forbidden.test(value), false, value);
  }

  assert.equal(
    checks.POPUP_FREE_HINT_MESSAGES.phoneText,
    "No celular, este texto ocupa mais linhas que no desenho (o texto não fica abaixo de 12 px). Use letra maior ou dê mais largura."
  );
});

/* ------------------------------------------------------------------------------------------------
 * Leituras do design e o item de previa
 * ---------------------------------------------------------------------------------------------- */

test("leituras do design: primeiro título e texto visíveis, nome do diálogo e o item de prévia", () => {
  const value = valid(
    design([
      { ...heading("escondido", "Não vale"), hidden: true },
      { children: [{ id: "titulo", lines: [[{ text: "Aula " }, { text: "nova" }], [{ text: "  hoje " }]], type: "heading" }], id: "caixa", type: "box" },
      text("texto", "Assista agora."),
      { action: { kind: "cta" }, id: "botao", type: "button" },
      { action: { kind: "snooze" }, id: "depois", label: "Depois", type: "button" }
    ])
  );

  assert.equal(render.freeFirstHeading(value).id, "titulo");
  assert.equal(render.freeHeadingText(render.freeFirstHeading(value)), "Aula nova hoje");
  assert.equal(render.freeFirstText(value).id, "texto");
  assert.deepEqual(render.freeAccessibleName(value, "Nome interno"), { label: "Aula nova hoje", labelledBy: true });
  assert.deepEqual(render.freeAccessibleName(valid(design([])), " Nome interno "), { label: "Nome interno", labelledBy: false });
  assert.equal(render.freeHasSnoozeButton(value), true);
  assert.deepEqual(render.popupFreeDialogAria({ body: "", freeDesign: value, title: "Nome interno" }, { bodyId: "b", titleId: "t" }), { "aria-describedby": "b", "aria-labelledby": "t" });
  assert.deepEqual(render.popupFreeDialogAria({ body: "", freeDesign: valid(design([])), title: "Nome interno" }, { bodyId: "b", titleId: "t" }), {
    "aria-describedby": undefined,
    "aria-label": "Nome interno"
  });

  const face = { family: "bf_0123456789ab", format: "woff2", id: FONT_A, style: "normal", url: "https://x/f.woff2", weight: 400 };
  const other = { ...face, id: "7a2d3e4f-9e66-4a4b-8b2c-1d3e4f5a6b7c" };
  const withFont = valid(design([{ ...heading("titulo"), locked: true, name: "Título", textStyle: { font: { id: FONT_A, kind: "uploaded" } } }]));
  const item = model.freePreviewPopupItem({
    allowSnooze: true,
    audio: null,
    cta: { href: "/minhas-compras", label: " Ver ", target: "same_tab" },
    design: withFont,
    fonts: [face, { ...other, createdAt: "x", name: "y", sizeBytes: 1 }],
    title: "Nome interno"
  });

  assert.deepEqual(item, {
    audio: null,
    body: "",
    canSnooze: true,
    cta: { href: "/minhas-compras", label: "Ver", target: "same_tab" },
    fonts: [face],
    freeDesign: withFont,
    id: "previa",
    image: null,
    title: "Título"
  });
  assert.equal(item.freeDesign.children[0].locked, true, "a previa guarda o travado (o palco nao seleciona)");
  assert.equal(model.freePreviewPopupItem({ allowSnooze: false, audio: null, close: "x_only", cta: null, design: valid(design([])), fonts: [], id: "p", title: " Nome " }).title, "Nome");
  assert.equal(model.freePreviewPopupItem({ allowSnooze: false, audio: null, close: "x_only", cta: null, design: valid(design([])), fonts: [], title: "N" }).close, "x_only");
});
