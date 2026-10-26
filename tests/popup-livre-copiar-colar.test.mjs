import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Acabamento do Livre (docs/27 L1.1; docs/18 §1.1): copiar e colar o design (a forma canonica em JSON, o mesmo zod,
// arquivos de fora viram vazios, fontes fora da biblioteca viram Inter, frases claras e um passo so no historico),
// as instrucoes para a IA (geradas do docs/27 §9, nunca buscadas na hora), o ponto de partida "Usar o design
// Personalizado" (freeFromCustomDesign), o modelo "Imagem recortada com selo" e a regra nova da dica "texto no
// celular" (so quando o piso de 12 px muda o encaixe). Tudo carregado direto pelo Node.

const model = await import("../src/server/communications/popup-free-model.ts");
const schema = await import("../src/server/communications/popup-free-schema.ts");
const starters = await import("../src/server/communications/popup-free-starters.ts");
const checks = await import("../src/server/communications/popup-free-checks.ts");
const paste = await import("../src/server/communications/popup-free-paste.ts");
const custom = await import("../src/server/communications/popup-design-model.ts");
const render = await import("../src/server/communications/popup-free-render.ts");
const editor = await import("../src/components/admin/v2/communication/popup-free/free-editor-model.ts");
const history = await import("../src/components/admin/v2/communication/popup-free/free-editor-history.ts");
const designEditor = await import("../src/components/admin/v2/communication/popup-design/popup-design-editor-model.ts");
const instructions = await import("../scripts/livre-instrucoes-ia.mjs");

const P = paste.POPUP_FREE_PASTE_MESSAGES;
const HEX = "0123456789abcdef01234567";
const OTHER_HEX = "fedcba9876543210fedcba98";
const IMAGE_PATH = `communications/free/${HEX}.webp`;
const NOTICE_IMAGE_PATH = `communications/images/${HEX}.webp`;
const CARD_IMAGE_PATH = `communications/images/${OTHER_HEX}.webp`;
const VIDEO_PATH = "videos/0b7c7f3e-2d1a-4c55-9a4e-5f1f7b2c9d10.mp4";
const OTHER_VIDEO_PATH = "videos/11111111-2222-4333-8444-555555555555.mp4";
const ORIGIN = "http://127.0.0.1:54321";
const FONT = "6f1c2c9e-8d55-4f3a-9a1b-0c2d3e4f5a6b";
const CTA = { href: "/minhas-compras", label: "Quero ver", target: "same_tab" };
const PROIBIDAS = /\b(campanha|público|audiência|evento|oferta|gatilho|trigger|sessão|impressão|home|automação|lembrete|layout|template|fluxo)/i;

function valid(value) {
  const parsed = schema.popupFreeDesignSchema.safeParse(value);

  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));

  return parsed.data;
}

function design(children, extra = {}) {
  return valid({ children: [...children, { id: "links", type: "links" }], mode: "free", version: 1, ...extra });
}

function context(extra = {}) {
  return { content: { audio: null, cta: CTA }, fontIds: [FONT], knownAssets: [], ...extra };
}

function phoneHints(value, content) {
  return checks.popupFreeHints(value, { content }).filter((hint) => hint.kind === "phone-text");
}

/* ------------------------------------------------------------------------------------------------
 * Copiar e colar
 * ---------------------------------------------------------------------------------------------- */

test("copiar o design dá a forma canônica em JSON e colar de volta devolve o mesmo design", () => {
  for (const { id } of starters.FREE_DESIGN_STARTERS) {
    const { cta, design: value } = starters.applyFreeStarter(id, {
      audio: null,
      cta: CTA,
      poster: { height: 720, path: NOTICE_IMAGE_PATH, width: 1280 },
      video: { mimeType: "video/mp4", path: VIDEO_PATH }
    });
    const text = paste.freeDesignClipboardText(value);

    assert.equal(text, `${JSON.stringify(model.canonicalPopupFreeDesign(value), null, 2)}\n`, id);
    assert.ok(!text.includes("http"), `${id}: so caminhos, nunca endereco`);

    const result = paste.parseFreeDesignPaste(text, context({ knownAssets: value.assets }));

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.design, value, `${id}: o mesmo design`);
    assert.deepEqual(result.cta, cta);
    assert.deepEqual(result.notes, []);
    assert.equal(paste.freeDesignClipboardText(result.design), text, `${id}: copiar de novo da o mesmo texto`);
  }
});

test("colar aceita a resposta da IA com ```json em volta, sem assets/fonts e fora da ordem; o resultado é canônico", () => {
  const text = [
    "Claro! Aqui está o design:",
    "```json",
    JSON.stringify({ version: 1, mode: "free", children: [{ type: "heading", id: "titulo", lines: [[{ text: "Aula nova" }]], textStyle: { size: 28, paint: { kind: "solid", color: "#FFFFFF" } } }, { id: "botao", type: "button", action: { kind: "cta" } }, { id: "links", type: "links" }] }),
    "```",
    "Qualquer coisa, é só pedir."
  ].join("\n");
  const result = paste.parseFreeDesignPaste(text, context());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.design.children[0], { id: "titulo", lines: [[{ text: "Aula nova" }]], type: "heading" }, "padroes omitidos, cor minuscula");
  assert.deepEqual(result.design.assets, []);
  assert.deepEqual(result.design.fonts, []);
});

test("colar: arquivos que o pop-up não conhece viram vazios (asset null), a pintura de imagem e a capa de fora saem", () => {
  const known = [
    { height: 48, id: "minha", kind: "image", path: IMAGE_PATH, width: 64 },
    { id: "meuvideo", kind: "video", mimeType: "video/mp4", path: VIDEO_PATH }
  ];
  const pasted = {
    artboard: { fill: [{ asset: "fundo", kind: "image" }, { color: "#101014", kind: "solid" }] },
    assets: [
      // A mesma imagem com medidas inventadas: fica, com as medidas daqui (as do servidor).
      { height: 999, id: "img1", kind: "image", path: IMAGE_PATH, width: 999 },
      // De outro aviso (ou inventada): sai.
      { height: 720, id: "fundo", kind: "image", path: `communications/free/${OTHER_HEX}.webp`, width: 1280 },
      { height: 720, id: "capa", kind: "image", path: NOTICE_IMAGE_PATH, width: 1280 },
      { id: "vid", kind: "video", mimeType: "video/mp4", path: VIDEO_PATH, poster: "capa" },
      { id: "vid2", kind: "video", mimeType: "video/mp4", path: OTHER_VIDEO_PATH }
    ],
    children: [
      { asset: "img1", id: "foto", type: "image" },
      { asset: "fundo", id: "foto2", type: "image" },
      { asset: "naoexiste", id: "foto3", type: "image" },
      { asset: "vid", id: "midia", type: "video" },
      { box: { fill: [{ asset: "fundo", kind: "image" }] }, id: "forma", place: { h: 40, mode: "free", w: 40, x: 0, y: 0 }, type: "shape" },
      { id: "links", type: "links" }
    ],
    mode: "free",
    version: 1
  };
  const result = paste.parseFreeDesignPaste(JSON.stringify(pasted), context({ content: { audio: null, cta: null }, knownAssets: known }));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.design.assets, [
    { height: 48, id: "img1", kind: "image", path: IMAGE_PATH, width: 64 },
    { id: "vid", kind: "video", mimeType: "video/mp4", path: VIDEO_PATH }
  ]);

  const node = (id) => model.findFreeNode(result.design, id).node;

  assert.equal(node("foto").asset, "img1");
  assert.equal(node("foto2").asset, null, "caminho de outro aviso: vazio");
  assert.equal(node("foto3").asset, null, "id que nao existe: vazio");
  assert.equal(node("midia").asset, "vid");
  assert.equal(node("forma").box, undefined, "a pintura de imagem de fora saiu (e o fundo vazio junto)");
  assert.deepEqual(result.design.artboard.fill, [{ color: "#101014", kind: "solid" }], "so a camada que vale");
  assert.ok(!JSON.stringify(result.design).includes(OTHER_HEX), "nenhum caminho de fora sobra");
  assert.deepEqual(result.notes, [P.files(3)]);
  assert.equal(result.cta, null, "sem botao no aviso e sem botao principal colado: continua sem");

  // O editor: a Imagem vazia aparece como problema para revisar (envie a imagem), nunca como caminho de fora.
  const problems = editor.freeEditorErrors(result.design, { allowSnooze: true, audio: null, cta: null });

  assert.ok(Object.keys(problems).includes("nodes.foto2.asset"), JSON.stringify(problems));
});

test("colar: frases claras para vazio, JSON quebrado, grande demais, Personalizado e erros do zod com o nome do elemento", () => {
  assert.deepEqual(paste.parseFreeDesignPaste("   ", context()), { errors: [P.empty], ok: false });
  assert.deepEqual(paste.parseFreeDesignPaste('{ "mode": "free", ', context()), { errors: [P.notJson], ok: false });
  assert.deepEqual(paste.parseFreeDesignPaste("x".repeat(paste.FREE_PASTE_MAX_CHARS + 1), context()), { errors: [P.tooLong], ok: false });
  assert.deepEqual(paste.parseFreeDesignPaste(JSON.stringify(custom.popupStarterDesign("text_only")), context()), { errors: [P.notFree], ok: false });
  assert.deepEqual(paste.parseFreeDesignPaste("[1, 2]", context()), { errors: [P.notFree], ok: false });

  const broken = paste.parseFreeDesignPaste(
    JSON.stringify({
      children: [
        { id: "titulo", lines: [[{ text: "   " }]], name: "Título grande", type: "heading" },
        { action: { kind: "close" }, id: "fechar", type: "button" },
        { id: "links", type: "links" }
      ],
      mode: "free",
      version: 1
    }),
    context()
  );

  assert.equal(broken.ok, false);
  assert.equal(broken.errors[0], P.invalid);
  assert.ok(broken.errors.includes(`“Título grande”: ${schema.POPUP_FREE_MESSAGES.lineEmpty}`), JSON.stringify(broken.errors));
  assert.ok(broken.errors.includes(`“fechar”: ${schema.POPUP_FREE_MESSAGES.label}`), JSON.stringify(broken.errors));

  const extra = paste.parseFreeDesignPaste(JSON.stringify({ children: [{ id: "links", type: "links" }], html: "<b>x</b>", mode: "free", version: 1 }), context());

  assert.deepEqual(extra, { errors: [P.invalid, schema.POPUP_FREE_MESSAGES.design], ok: false }, "chave a mais: a frase do design");

  // No maximo 5 linhas listadas e "E mais N.".
  const many = paste.parseFreeDesignPaste(
    JSON.stringify({
      children: [...Array.from({ length: 8 }, (_, index) => ({ id: `b${index}`, type: "badge" })), { id: "links", type: "links" }],
      mode: "free",
      version: 1
    }),
    context()
  );

  assert.equal(many.ok, false);
  assert.equal(many.errors.length, 7);
  assert.equal(many.errors.at(-1), P.more(3));

  for (const value of [...Object.values(P).map((item) => (typeof item === "function" ? item(2) : item)), P.files(1), P.fonts(1)]) {
    assert.equal(PROIBIDAS.test(value), false, value);
  }
});

test("colar: fonte fora da biblioteca vira Inter; o botão principal e o Áudio acompanham o aviso", () => {
  const pasted = {
    children: [
      { id: "titulo", lines: [[{ style: { font: { id: "aaaaaaaa-8d55-4f3a-9a1b-0c2d3e4f5a6b", kind: "uploaded" } }, text: "Oi" }]], textStyle: { font: { id: FONT, kind: "uploaded" } }, type: "heading" },
      { id: "texto", lines: [[{ text: "Texto" }]], textStyle: { font: { id: "bbbbbbbb-8d55-4f3a-9a1b-0c2d3e4f5a6b", kind: "uploaded" } }, type: "text" },
      { action: { kind: "cta" }, id: "botao", type: "button" },
      { id: "audio", type: "audio" },
      { id: "links", type: "links" }
    ],
    mode: "free",
    version: 1
  };
  const noCta = paste.parseFreeDesignPaste(JSON.stringify(pasted), context({ content: { audio: null, cta: null } }));

  assert.equal(noCta.ok, true, JSON.stringify(noCta));
  assert.deepEqual(noCta.cta, { href: "", label: "Saiba mais", target: "same_tab" }, "como nos modelos: o Saiba mais com o destino vazio");
  assert.deepEqual(noCta.design.fonts, [FONT], "so a fonte da biblioteca ficou");
  assert.equal(model.findFreeNode(noCta.design, "texto").node.textStyle, undefined, "Inter e o padrao: sai da forma canonica");
  assert.equal(model.findFreeNode(noCta.design, "audio"), null, "sem audio no aviso, o Áudio sai");
  assert.deepEqual(noCta.notes, [P.cta, P.fonts(2)]);

  const withoutButton = { ...pasted, children: pasted.children.filter((node) => node.type !== "button" && node.type !== "audio") };
  const withAudio = paste.parseFreeDesignPaste(JSON.stringify(withoutButton), context({ content: { audio: { durationSeconds: 3 }, cta: CTA } }));

  assert.equal(withAudio.ok, true);
  assert.deepEqual(withAudio.cta, CTA);
  assert.deepEqual(
    withAudio.design.children.map((node) => node.type),
    ["heading", "text", "audio", "button", "links"],
    "o aviso tem botao e audio: os dois entram"
  );
  assert.deepEqual(editor.freeEditorErrors(withAudio.design, { allowSnooze: true, audio: { durationSeconds: 3 }, cta: CTA }), {});
});

test("colar: os valores do celular (devices) passam, na forma canônica; o erro de um deles diz o elemento", () => {
  const pasted = {
    children: [
      { id: "titulo", lines: [[{ text: "Aula nova" }]], name: "Título grande", textStyle: { size: 40 }, type: "heading" },
      { id: "selo", label: "Novidade", place: { mode: "free", w: 120, x: 300, y: 16 }, type: "badge" },
      { id: "links", type: "links" }
    ],
    devices: {
      mobile: {
        artboard: { padding: 16 },
        nodes: {
          nada: { hidden: true },
          selo: { place: { mode: "free", x: 24, y: 16 } },
          titulo: { textStyle: { size: 32 } }
        }
      }
    },
    mode: "free",
    version: 1
  };
  const result = paste.parseFreeDesignPaste(JSON.stringify(pasted), context({ content: { audio: null, cta: null } }));

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.design.devices, {
    mobile: { artboard: { padding: 16 }, nodes: { selo: { place: { mode: "free", x: 24 } }, titulo: { textStyle: { size: 32 } } } }
  }, "o id que nao existe e o Y igual ao do computador saem");
  assert.deepEqual(result.notes, []);

  // Copiar de novo leva os valores do celular, e colar devolve o mesmo design.
  const text = paste.freeDesignClipboardText(result.design);

  assert.ok(text.includes('"devices"'));
  assert.deepEqual(paste.parseFreeDesignPaste(text, context({ content: { audio: null, cta: null } })).design, result.design);

  // O Botão principal que o aviso nao tem sai ao colar, e a entrada dele sai junto (id que nao existe mais).
  const withCta = { ...pasted, children: [...pasted.children.slice(0, 2), { action: { kind: "cta" }, id: "botao", type: "button" }, pasted.children[2]], devices: { mobile: { nodes: { botao: { box: { padding: 8 } } } } } };
  const synced = paste.parseFreeDesignPaste(JSON.stringify(withCta), context({ content: { audio: null, cta: null } }));

  assert.equal(synced.ok, true, JSON.stringify(synced));
  assert.equal(model.findFreeNode(synced.design, "botao")?.node.type, "button", "colar mantem o botao principal colado (cria o Saiba mais)");
  assert.deepEqual(synced.design.devices.mobile.nodes.botao, { box: { padding: 8 } });

  // Erro num valor do celular: a frase diz o elemento.
  const broken = paste.parseFreeDesignPaste(
    JSON.stringify({ ...pasted, devices: { mobile: { nodes: { selo: { place: { mode: "flow" } }, titulo: { textStyle: { size: 9 } } } } } }),
    context()
  );

  assert.equal(broken.ok, false);
  assert.deepEqual(broken.errors, [
    P.invalid,
    "“Título grande”, no celular: Use de 10 a 160.",
    `“selo”, no celular: ${schema.POPUP_FREE_MESSAGES.mobilePlace}`
  ]);
  assert.equal(P.mobile("Título", "Use de 10 a 160."), "“Título”, no celular: Use de 10 a 160.");
  assert.equal(PROIBIDAS.test(P.mobile("Título", schema.POPUP_FREE_MESSAGES.mobilePlace)), false);
});

test("colar é um passo só no histórico (design e botão principal juntos) e conhece os arquivos de todo o histórico", () => {
  const before = { cta: CTA, design: starters.freeStarterDesign("blank") };
  const result = paste.parseFreeDesignPaste(paste.freeDesignClipboardText(starters.freeStarterDesign("glow_text")), context({ content: { audio: null, cta: null } }));
  const pushed = history.pushFreeHistory(history.createFreeHistory(before), { cta: result.cta, design: result.design }, { coalesceKey: null });

  assert.equal(pushed.past.length, 1);
  assert.deepEqual(history.undoFreeHistory(pushed).present, before, "Ctrl + Z volta ao de antes, com o botao de antes");

  const image = { height: 48, id: "img", kind: "image", path: IMAGE_PATH, width: 64 };
  const video = { id: "video", kind: "video", mimeType: "video/mp4", path: VIDEO_PATH };

  assert.deepEqual(
    editor.freeKnownAssets([{ design: { assets: [image] } }, { design: { assets: [{ ...image, id: "outro" }, video] } }, { design: { assets: [] } }]),
    [image, video],
    "um por caminho e tipo"
  );
});

test("colar um design com o principal e 3 Abrir um link vale num passo só (L4b: até 3 links)", () => {
  const link = (id, href, target = "same_tab") => ({ action: { href, kind: "link", target }, id, label: `Abrir ${id}`, type: "button" });
  const text = JSON.stringify({
    children: [
      { id: "titulo", lines: [[{ text: "Escolha por onde começar" }]], type: "heading" },
      { action: { kind: "cta" }, id: "botao", type: "button" },
      link("linka", "/minhas-compras"),
      link("linkb", "https://exemplo.com/b", "new_tab"),
      link("linkc", "/conteudo/produto-1"),
      { id: "links", type: "links" }
    ],
    mode: "free",
    version: 1
  });
  const result = paste.parseFreeDesignPaste(text, context());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(
    result.design.children.filter((node) => node.type === "button" && node.action.kind === "link").map((node) => node.id),
    ["linka", "linkb", "linkc"]
  );
  assert.deepEqual(result.cta, CTA, "o Botão principal acompanha o aviso");

  const before = { cta: CTA, design: starters.freeStarterDesign("blank") };
  const pushed = history.pushFreeHistory(history.createFreeHistory(before), { cta: result.cta, design: result.design }, { coalesceKey: null });

  assert.equal(pushed.past.length, 1, "um passo so");
  assert.deepEqual(history.undoFreeHistory(pushed).present, before);
});

test("as instruções para a IA vêm do docs/27 §9 (gerado), vão no pacote do editor e só são baixadas ao abrir Copiar e colar", async () => {
  const doc = readFileSync(new URL("../docs/27-comunicacao-design-livre.md", import.meta.url), "utf8");
  const generated = readFileSync(new URL("../src/components/admin/v2/communication/popup-free/free-ai-instructions.ts", import.meta.url), "utf8");

  assert.equal(generated, instructions.livreInstructionsSource(doc), "docs/27 §9 mudou: rode npm run livre:instrucoes");

  const { FREE_AI_INSTRUCTIONS } = await import("../src/components/admin/v2/communication/popup-free/free-ai-instructions.ts");

  assert.ok(FREE_AI_INSTRUCTIONS.startsWith("Você vai escrever o design de um pop-up"));

  for (const part of ["### 9.2 ", "### 9.3 ", "### 9.4 ", "### 9.5 ", "### 9.6 ", "### 9.8 ", "### 9.9 ", "### 9.10 "]) {
    assert.ok(FREE_AI_INSTRUCTIONS.includes(part), part);
  }

  assert.ok(!FREE_AI_INSTRUCTIONS.includes("### 9.1 ") && !FREE_AI_INSTRUCTIONS.includes("### 9.7 "), "sem o banco e as chaves de erro do editor");

  // O texto vai para a conversa de um terceiro: nada de arquivo do codigo, banco, bucket, jsonb, zod, caminho de
  // arquivo ou secao do docs que nao vai junto; os trechos marcados com <!-- ia:fora --> continuam no docs.
  for (const internal of [".ts", "banco", "bucket", "jsonb", "z.", "§7", "§9", "§", "<!--", "-->", "Storage", "content-assets", "communication-popup-video", "communications/", "videos/", "jsonbBytesUpperBound", "popupFreeJsonSchema", "freeDesign"]) {
    assert.ok(!FREE_AI_INSTRUCTIONS.includes(internal), `as instrucoes para a IA falam de "${internal}"`);
  }

  for (const internal of ["jsonbBytesUpperBound", "content-assets", "communication-popup-video", "popup-free-json-schema.ts", "Escolha um design só."]) {
    assert.match(doc, new RegExp(`<!-- ia:fora -->(?:(?!<!-- /ia:fora -->)[\\s\\S])*${internal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), `"${internal}" continua no docs, marcado`);
  }

  for (const pattern of instructions.LIVRE_INSTRUCTIONS_FORBIDDEN) {
    assert.doesNotMatch(FREE_AI_INSTRUCTIONS, pattern);
  }

  assert.throws(
    () => instructions.livreInstructionsText(doc.replace("### 9.2 O documento mínimo\n", "### 9.2 O documento mínimo\n\nO check do banco mede o jsonb.\n")),
    /detalhe de implementacao/,
    "um trecho de implementacao sem o marcador para o script"
  );
  assert.match(FREE_AI_INSTRUCTIONS, /Imagem ou Vídeo novo use sempre "asset": null/, "arquivos: sempre asset null");
  // Celular (PR L3): a parte 9.10 vai no fim e o guia pede devices.mobile so quando pedirem algo so para o celular.
  assert.ok(FREE_AI_INSTRUCTIONS.indexOf("### 9.10 Celular") > FREE_AI_INSTRUCTIONS.indexOf("### 9.9 "), "a 9.10 depois da 9.9");
  assert.ok(
    FREE_AI_INSTRUCTIONS.includes(
      "9. Só escreva `devices.mobile` quando pedirem algo só para o celular (veja 9.10 Celular), e só com o que muda; sem esse pedido, deixe `devices` de fora: o celular encolhe o desenho do computador sozinho."
    ),
    "o guia curto fala do celular"
  );
  assert.ok(!FREE_AI_INSTRUCTIONS.includes("resolveFreeForDevice") && !FREE_AI_INSTRUCTIONS.includes("matchMedia"), "o por dentro do celular fica no docs");
  assert.match(doc, /<!-- ia:fora -->(?:(?!<!-- \/ia:fora -->)[\s\S])*resolveFreeForDevice/, "o por dentro do celular continua no docs, marcado");
  assert.match(FREE_AI_INSTRUCTIONS, /\| Tamanho \| até 30\.000 bytes[^|]*\|\n/, "o tamanho como um limite simples");
  // L4b: ate 3 "Abrir um link" em qualquer mistura com Fechar e Lembrar depois; o guia manda usar o link para
  // destinos alem do principal, e o limite de um link so saiu.
  assert.ok(!FREE_AI_INSTRUCTIONS.includes('no máximo 1 "Abrir um link"'), "sem o limite de um link so");
  assert.ok(
    FREE_AI_INSTRUCTIONS.includes('| Botões | um botão principal (existe se e só se o aviso tem botão); outros até 3: Fechar, Lembrar depois ou Abrir um link, em qualquer mistura (até 3 "Abrir um link") |'),
    "o limite dos botoes"
  );
  assert.match(FREE_AI_INSTRUCTIONS, /3\. Um botão principal [^\n]*Para destinos além do principal, use "Abrir um link"/, "o guia curto fala do link");
  assert.match(FREE_AI_INSTRUCTIONS, /vale quando o computador e o celular têm, cada um, um botão visível que conta como o clique/, "o D9 por aparelho");

  // Os exemplos das instrucoes colam de volta no editor e cabem no que a linha Tamanho promete.
  const blocks = [...FREE_AI_INSTRUCTIONS.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);

  assert.ok(blocks.length >= 6, `${blocks.length} exemplos`);

  for (const block of blocks) {
    const result = paste.parseFreeDesignPaste(block, context({ content: { audio: null, cta: null } }));
    const compact = JSON.stringify(JSON.parse(block));

    assert.equal(result.ok, true);
    assert.ok(compact.length < 2500, `${compact.length} caracteres: "cada modelo da 9.9 tem menos de 2.500"`);
    assert.ok(model.jsonbBytesUpperBound(result.design) <= 2.5 * compact.length, "12.000 caracteres sem espacos ficam abaixo de 30.000 bytes");
  }

  // So o editor importa, e so por import() (o pedaco e baixado quando o menu abre); nada no app busca o docs na hora.
  const root = new URL("../src/", import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter((file) => /\.(ts|tsx)$/.test(file));
  const importers = files.filter((file) => /free-ai-instructions/.test(readFileSync(new URL(file, root), "utf8")) && !file.endsWith("free-ai-instructions.ts"));

  assert.deepEqual(importers.map((file) => file.split(/[\\/]/).pop()).sort(), ["free-editor.tsx"]);

  for (const file of importers) {
    const source = readFileSync(new URL(file, root), "utf8");

    assert.doesNotMatch(source, /from\s+["'][^"']*free-ai-instructions["']/, `${file}: so por import()`);
  }

  for (const file of files) {
    assert.doesNotMatch(readFileSync(new URL(file, root), "utf8"), /fetch\([^)]*docs\//, `${file} busca o docs`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * "Usar o design Personalizado" (freeFromCustomDesign)
 * ---------------------------------------------------------------------------------------------- */

const VIDEO = { mimeType: "video/mp4", path: VIDEO_PATH, url: `${ORIGIN}/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}` };
const NOTICE_IMAGE = { height: 720, path: NOTICE_IMAGE_PATH, width: 1280 };

test("todo modelo do Personalizado vira um Livre válido, na forma canônica, sem dica de texto no celular", () => {
  for (const { id } of custom.POPUP_DESIGN_STARTERS) {
    for (const audio of [null, { durationSeconds: 3 }]) {
      for (const cta of [null, CTA]) {
        const source = custom.popupStarterDesign(id, { hasAudio: Boolean(audio), video: VIDEO });
        const result = starters.freeFromCustomDesign(source, { audio, cta, hasImage: true, image: NOTICE_IMAGE });

        assert.deepEqual(valid(result.design), result.design, `${id}: ja na forma canonica`);
        // Sem botao no aviso, o "Saiba mais" novo ainda nao tem destino: o unico item do Revisar (o salvar recusa igual).
        assert.deepEqual(
          editor.freeEditorErrors(result.design, { allowSnooze: true, audio, cta: result.cta }),
          cta ? {} : { "cta.href": "Escolha para onde o botão leva." },
          `${id}: só o destino do botão para revisar`
        );
        assert.deepEqual(phoneHints(result.design, { ctaLabel: result.cta.label }), [], id);
        assert.equal(model.freeCloseVisibilityProblem(result.design), null, id);
        assert.deepEqual(result.cta, cta ?? { href: "", label: "Saiba mais", target: "same_tab" });
      }
    }
  }
});

test("freeFromCustomDesign: mídia no topo com o esmaecer, vídeo e capa reaproveitados, textos, botões, fontes e links", () => {
  const source = custom.canonicalPopupDesign({
    ...custom.popupStarterDesign("media_top_fade", { hasAudio: true, video: VIDEO }),
    blocks: [
      ...custom.popupStarterDesign("media_top_fade").blocks.map((block) =>
        block.type === "heading" ? { ...block, lines: [block.lines[0], { paint: null, size: 34, text: "Segunda linha" }], style: { ...block.style, font: { id: FONT, kind: "uploaded" } } } : block
      ),
      { id: "b8", style: { align: "inherit", font: { key: "inter", kind: "builtin" }, letterSpacing: 0, lineHeight: 1.5, paint: { color: "#d4d4d8", kind: "solid" }, size: 15, uppercase: false, weight: 400 }, text: "Linha um\n\nLinha dois", type: "text" },
      { action: { href: "/minhas-compras", kind: "link", target: "new_tab" }, id: "b10", label: "Ver depois", style: custom.defaultPopupButtonStyle({ border: { color: "#ffffff40", width: 1 }, size: "S", width: "fit" }), type: "button2" },
      { height: 24, id: "b11", type: "spacer" },
      { id: "b9", type: "audio" }
    ],
    links: { color: "#a1a1aa", showDismiss: false }
  });
  const { design: value } = starters.freeFromCustomDesign(source, { audio: { durationSeconds: 3 }, cta: CTA, hasImage: true, image: NOTICE_IMAGE });
  const node = (id) => model.findFreeNode(value, id).node;

  // Midia: o video solto no topo (0, 0, 440, 440 x 9/16), a capa e a imagem do aviso, o esmaecer de (92 - 42) a 92.
  assert.deepEqual(value.assets, [
    { height: 720, id: "capa", kind: "image", path: NOTICE_IMAGE_PATH, width: 1280 },
    { id: "video", kind: "video", mimeType: "video/mp4", path: VIDEO_PATH, poster: "capa" }
  ]);
  assert.deepEqual(node("midia").place, { h: 248, mode: "free", w: 440, x: 0, y: 0 });
  assert.deepEqual(node("midia").box.fade, { end: 92, side: "bottom", start: 50 });
  assert.equal(node("midia").asset, "video");

  // "Abaixo da mídia" subindo 34 %: o respiro de cima = 247,5 (440 x 9/16, a altura exata do Personalizado) x 0,66 + 24;
  // o grupo centralizado; o espaco entre blocos.
  assert.deepEqual(value.artboard.padding, [187, 24, 24, 24], "sem o Não mostrar de novo: o respiro de baixo e o do cartao");
  assert.equal(node("selo").place, undefined, "abaixo de 200, sem margem");

  // Cartão G (520): 292,5 x 0,66 + 24 = 217 passa do teto de 200 do respiro; os 17 que faltam vão na margem de cima do
  // primeiro elemento na sequencia (o texto continua no mesmo y, e o schema aceita).
  const wide = valid(starters.freeFromCustomDesign(custom.canonicalPopupDesign({ ...source, card: { ...source.card, width: "L" } }), { audio: { durationSeconds: 3 }, cta: CTA, hasImage: true, image: NOTICE_IMAGE }).design);

  assert.deepEqual(wide.artboard.padding, [200, 24, 24, 24]);
  assert.deepEqual(model.findFreeNode(wide, "selo").node.place, { margin: [17, 0, 0, 0], mode: "flow" });
  assert.equal(value.artboard.align, "center");
  assert.equal(value.artboard.gap, undefined, "12 e o padrao");
  assert.deepEqual(value.artboard.shadows, [{ blur: 80, color: "#000000b3", spread: 0, x: 0, y: 24 }]);

  // Blocos na mesma ordem.
  assert.deepEqual(
    value.children.map((item) => item.id),
    ["midia", "selo", "titulo", "texto", "botao", "texto2", "botao2", "espaco", "audio", "links"]
  );
  assert.deepEqual(node("titulo").lines, [
    [{ style: { paint: { color: "#e0ff3a", kind: "solid" } }, text: "Conteúdo novo" }],
    [{ style: { size: 34 }, text: "Segunda linha" }]
  ]);
  assert.deepEqual(node("titulo").textStyle.font, { id: FONT, kind: "uploaded" });
  assert.deepEqual(value.fonts, [FONT], "a fonte enviada vem junto");
  assert.deepEqual(node("texto2").lines, [[{ text: "Linha um" }], [{ text: "Linha dois" }]], "uma linha por quebra (as vazias saem)");
  assert.deepEqual(node("botao").box, { fill: [{ color: "#e0ff3a", kind: "solid" }], padding: [13, 20], radius: 999, shadows: [{ blur: 24, color: "#e0ff3a40", spread: 0, x: 0, y: 0 }] });
  assert.deepEqual(node("botao2").action, { href: "/minhas-compras", kind: "link", target: "new_tab" });
  assert.equal(node("botao2").label, "Ver depois");
  assert.deepEqual(node("botao2").box.border, { color: "#ffffff40", width: 1 });
  assert.deepEqual(node("botao2").box.padding, [9, 16], "P: (36 - 2 de borda - 14 x 1,2) / 2");
  assert.equal(node("espaco").size, 24);
  assert.equal(node("links").dismiss, false, "o Não mostrar de novo escondido continua escondido");
  assert.deepEqual(node("links").textStyle, { align: "center", paint: { color: "#a1a1aa", kind: "solid" } });
});

test("freeFromCustomDesign: imagem no fundo do cartão, degradê de outra cor, texto sobre a mídia e o X que precisa contrastar", () => {
  const base = custom.popupStarterDesign("media_overlay");
  const source = custom.canonicalPopupDesign({
    ...base,
    card: { ...base.card, background: { color: "#16181c", dim: 40, kind: "image", position: "bottom", url: `${ORIGIN}/storage/v1/object/public/content-assets/${CARD_IMAGE_PATH}` }, shadow: "soft", width: "L" },
    close: { background: "#ffffff1a", color: "#333333" },
    media: { ...base.media, fade: { color: "#0b0b12", enabled: true, end: 90, height: 50 }, kind: "image", position: "top" },
    text: { ...base.text, placement: "over-bottom" }
  });
  const { design: value } = starters.freeFromCustomDesign(source, {
    audio: null,
    cardImage: { height: 900, path: CARD_IMAGE_PATH, width: 1600 },
    cta: CTA,
    hasImage: true,
    image: NOTICE_IMAGE
  });
  const node = (id) => model.findFreeNode(value, id).node;

  assert.equal(value.artboard.width, 520);
  assert.deepEqual(value.artboard.fill, [
    { color: "#00000066", kind: "solid" },
    { asset: "fundo", fit: "contain", focus: [50, 100], kind: "image" },
    { color: "#25282f", kind: "solid" }
  ], "o escuro, a imagem cabendo na largura presa embaixo e a cor de apoio clareada (debaixo do escuro fica #16181c)");
  assert.deepEqual(value.artboard.shadows, [{ blur: 40, color: "#00000073", spread: 0, x: 0, y: 12 }]);
  assert.ok(value.assets.some((asset) => asset.id === "fundo" && asset.path === CARD_IMAGE_PATH));

  // Imagem do aviso no topo (4:3 de 520 = 390), presa em cima, por baixo do texto; degradê de outra cor por cima.
  assert.deepEqual(node("midia").place, { h: 390, mode: "free", w: 520, x: 0, y: 0, z: -1 });
  assert.deepEqual(node("midia").focus, [50, 0]);
  assert.equal(node("midia").box, undefined, "outra cor: sem mascara na midia");
  assert.deepEqual(node("degrade").place, node("midia").place);
  assert.deepEqual(node("degrade").box.fill[0].stops, [
    { at: 40, color: "#0b0b1200" },
    { at: 63, color: "#0b0b1259" },
    { at: 78, color: "#0b0b12bf" },
    { at: 90, color: "#0b0b12" }
  ]);
  assert.equal(value.artboard.minHeight, 390, "Sobre a mídia: a altura da midia");
  assert.equal(value.artboard.justify, "end", "embaixo");

  // O X do Personalizado nao contrasta o bastante para a regra do Livre: entra o X escuro de sempre.
  assert.deepEqual(value.close, { background: "#00000099" });
  assert.equal(model.freeCloseVisibilityProblem(value), null);
});

test("freeFromCustomDesign: sem imagem não há mídia de imagem; imagem sem medidas entra vazia; limites do Livre", () => {
  const imageCard = custom.canonicalPopupDesign({ ...custom.popupStarterDesign("media_overlay"), media: { ...custom.popupStarterDesign("media_overlay").media, kind: "image" } });

  assert.equal(
    starters.freeFromCustomDesign(imageCard, { audio: null, cta: CTA, hasImage: false }).design.children.some((node) => node.type === "image"),
    false,
    "o aviso sem imagem: o Personalizado nao mostra midia, o Livre tambem nao"
  );

  const unread = starters.freeFromCustomDesign(imageCard, { audio: null, cta: CTA, hasImage: true, image: { height: 9000, path: NOTICE_IMAGE_PATH, width: 1280 } }).design;

  assert.equal(unread.children.find((node) => node.type === "image").asset, null, "medidas fora do limite: a Imagem fica para enviar de novo");
  assert.deepEqual(unread.assets, []);

  // Muitos titulos e texto demais: o 5º titulo vira Texto e o total fica em 1.200 letras.
  const longText = "a".repeat(300);
  const heavy = custom.canonicalPopupDesign({
    ...custom.popupStarterDesign("text_only"),
    blocks: [
      ...Array.from({ length: 5 }, (_, index) => ({ ...custom.newPopupBlock("heading", `h${index}`), lines: [{ paint: null, size: null, text: `Título ${index}` }] })),
      ...Array.from({ length: 6 }, (_, index) => ({ ...custom.newPopupBlock("text", `t${index}`), text: longText })),
      custom.newPopupBlock("button", "b1")
    ]
  });
  const result = starters.freeFromCustomDesign(heavy, { audio: null, cta: CTA }).design;

  valid(result);
  assert.equal(result.children.filter((node) => node.type === "heading").length, 4);

  let letters = 0;

  model.walkFreeNodes(result.children, (node) => {
    for (const line of node.lines ?? []) {
      for (const span of line) {
        letters += span.text.length;
      }
    }
  });
  assert.ok(letters <= 1200, `${letters} letras`);
});

/** Lados (`padding`, `margin`) nos quatro valores [cima, direita, baixo, esquerda]. */
function fourSides(sides) {
  if (typeof sides === "number") return [sides, sides, sides, sides];
  if (sides.length === 2) return [sides[0], sides[1], sides[0], sides[1]];
  return sides;
}

/** Onde o primeiro elemento na sequencia comeca no Livre: o respiro de cima da prancheta + a margem de cima dele. */
function livreTextTop(value) {
  const first = value.children.find((node) => node.place?.mode !== "free");
  const margin = first.place?.margin === undefined ? 0 : fourSides(first.place.margin)[0];

  return fourSides(render.resolveFreeArtboard(value).padding)[0] + margin;
}

test("freeFromCustomDesign: toda combinação do Personalizado vira um Livre válido e o texto começa no mesmo lugar", () => {
  const fades = [
    { color: "auto", enabled: false, end: 100, height: 40 },
    { color: "auto", enabled: true, end: 92, height: 42 },
    { color: "#0b0b12", enabled: true, end: 90, height: 50 }
  ];
  const problems = [];
  let combos = 0;

  for (const { id } of custom.POPUP_DESIGN_STARTERS) {
    const base = custom.popupStarterDesign(id, { video: VIDEO });

    for (const width of Object.keys(custom.POPUP_CARD_WIDTHS)) {
      for (const aspect of custom.POPUP_MEDIA_ASPECTS) {
        for (const placement of custom.POPUP_TEXT_PLACEMENTS) {
          for (const overlap of [0, 34, 60]) {
            for (const padding of [12, 24, 48]) {
              for (const kind of custom.POPUP_MEDIA_KINDS) {
                for (const fade of kind === "none" ? fades.slice(0, 1) : fades) {
                  const source = custom.canonicalPopupDesign({
                    ...base,
                    card: { ...base.card, padding, width },
                    media: { ...base.media, aspect, fade, kind, video: kind === "video" ? VIDEO : base.media.video },
                    text: { ...base.text, overlap, placement }
                  });
                  const label = `${id} ${width} ${aspect} ${placement} subir ${overlap} respiro ${padding} ${kind} ${fade.enabled ? fade.color : "sem degradê"}`;
                  const { design: value } = starters.freeFromCustomDesign(source, { audio: null, cta: CTA, hasImage: true, image: NOTICE_IMAGE });
                  const parsed = schema.popupFreeDesignSchema.safeParse(value);

                  combos += 1;

                  if (!parsed.success) {
                    problems.push(`${label}: ${parsed.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`).join("; ")}`);
                    continue;
                  }

                  assert.deepEqual(parsed.data, value, `${label}: ja na forma canonica`);
                  assert.ok(checks.freeDesignSizePercent(value) <= 100, `${label}: cabe no tamanho`);

                  // Onde o texto comeca no Personalizado: abaixo da midia que ele sobe N %; sem midia ou "Sobre a midia",
                  // no respiro (no meio e embaixo, o resto da altura e do justify, conferido abaixo).
                  const cardWidth = custom.POPUP_CARD_WIDTHS[width];
                  const mediaHeight = cardWidth * custom.POPUP_MEDIA_RATIOS[aspect];
                  const below = kind !== "none" && placement === "below";
                  const expected = below ? mediaHeight * (1 - overlap / 100) + padding : padding;

                  if (Math.abs(livreTextTop(value) - expected) > 1) {
                    problems.push(`${label}: texto em ${livreTextTop(value)} px, no Personalizado em ${expected.toFixed(2)} px`);
                  }

                  if (kind !== "none") {
                    assert.ok(Math.abs(value.children[0].place.h - mediaHeight) <= 0.5, `${label}: a altura da midia`);
                  }

                  if (kind !== "none" && placement !== "below") {
                    assert.ok(Math.abs(render.resolveFreeArtboard(value).minHeight - mediaHeight) <= 0.5, `${label}: a altura minima`);
                    assert.equal(render.resolveFreeArtboard(value).justify, { "over-bottom": "end", "over-middle": "center", "over-top": "start" }[placement], label);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  assert.equal(combos, 3 * 3 * 3 * 4 * 3 * 3 * (1 + 3 + 3));
  assert.deepEqual(problems.slice(0, 5), [], `${problems.length} de ${combos} combinações com problema`);

  // "Abaixo da mídia" com cada subir de 0 a 60: o respiro de cima dentro do teto (200), a margem dentro da dela (400) e
  // o texto no mesmo y do Personalizado (o schema inteiro ja rodou acima; aqui so o que o subir muda).
  for (const { id } of custom.POPUP_DESIGN_STARTERS) {
    const base = custom.popupStarterDesign(id, { video: VIDEO });

    for (const width of Object.keys(custom.POPUP_CARD_WIDTHS)) {
      for (const aspect of custom.POPUP_MEDIA_ASPECTS) {
        for (const padding of [12, 24, 48]) {
          for (let overlap = 0; overlap <= 60; overlap += 1) {
            const source = custom.canonicalPopupDesign({
              ...base,
              card: { ...base.card, padding, width },
              media: { ...base.media, aspect, kind: "video", video: VIDEO },
              text: { ...base.text, overlap, placement: "below" }
            });
            const { design: value } = starters.freeFromCustomDesign(source, { audio: null, cta: CTA });
            const first = value.children.find((node) => node.place?.mode !== "free");
            const margin = first.place?.margin === undefined ? [0] : fourSides(first.place.margin);
            const expected = custom.POPUP_CARD_WIDTHS[width] * custom.POPUP_MEDIA_RATIOS[aspect] * (1 - overlap / 100) + padding;
            const label = `${id} ${width} ${aspect} subir ${overlap} respiro ${padding}`;

            assert.ok(fourSides(render.resolveFreeArtboard(value).padding)[0] <= model.FREE_DESIGN_LIMITS.padding.max, label);
            assert.ok(margin.every((side) => Math.abs(side) <= model.FREE_DESIGN_LIMITS.margin.max), label);
            assert.ok(Math.abs(livreTextTop(value) - expected) <= 0.5, `${label}: texto em ${livreTextTop(value)} px, no Personalizado em ${expected.toFixed(2)} px`);
          }
        }
      }
    }
  }
});

test("freeFromCustomDesign: o teto de 1.200 letras corta por letra (ponto de código), nunca no meio de um emoji", () => {
  const emoji = "😀";
  const headings = Array.from({ length: 5 }, (_, index) => ({ ...custom.newPopupBlock("heading", `h${index}`), lines: [{ paint: null, size: null, text: `Título ${index}` }] }));
  const texts = (count) => Array.from({ length: count }, (_, index) => ({ ...custom.newPopupBlock("text", `t${index}`), text: "a".repeat(300) }));
  const lettersOf = (value) => {
    const all = [];

    model.walkFreeNodes(value.children, (node) => {
      for (const line of node.lines ?? []) all.push(...line.map((span) => span.text));
      if (typeof node.label === "string") all.push(node.label);
    });

    return all;
  };

  // 5 titulos de 8 letras + 3 textos de 300 = 940: sobram 260 e o emoji e a letra 260 do 4º texto (unidades 260 e 261).
  const inText = custom.canonicalPopupDesign({
    ...custom.popupStarterDesign("text_only"),
    blocks: [...headings, ...texts(3), { ...custom.newPopupBlock("text", "t9"), text: `${"a".repeat(259)}${emoji}${"b".repeat(39)}` }, custom.newPopupBlock("button", "b1")]
  });
  // 4 textos somando 1.199 letras: sobra 1 para o texto do segundo botao, que comeca com o emoji.
  const inLabel = custom.canonicalPopupDesign({
    ...custom.popupStarterDesign("text_only"),
    blocks: [
      ...texts(3),
      { ...custom.newPopupBlock("text", "t9"), text: "a".repeat(299) },
      custom.newPopupBlock("button", "b1"),
      { ...custom.newPopupBlock("button2", "b2"), label: `${emoji} Ver depois` }
    ]
  });

  for (const [name, source, last] of [["texto", inText, `${"a".repeat(259)}${emoji}`], ["botão", inLabel, emoji]]) {
    const result = valid(starters.freeFromCustomDesign(source, { audio: null, cta: CTA }).design);
    const all = lettersOf(result);

    for (const text of all) {
      assert.ok(text.isWellFormed(), `${name}: ${JSON.stringify(text.slice(-4))} tem metade de um emoji (o jsonb do banco recusa)`);
    }

    assert.equal(all.reduce((sum, text) => sum + [...text].length, 0), 1200, `${name}: as 1.200 letras, com o emoji inteiro`);
    assert.ok(all.includes(last), `${name}: o corte fica logo depois do emoji`);
  }
});

test("card Design: Usar o design Personalizado pega o do rascunho ou o guardado e cria o Saiba mais quando falta", () => {
  const source = custom.popupStarterDesign("text_only");

  assert.equal(designEditor.freeCustomSourceOf({ design: source }, designEditor.NO_REMEMBERED_DESIGNS), source);
  assert.equal(designEditor.freeCustomSourceOf({ design: null }, { custom: source, free: null }), source);
  assert.equal(designEditor.freeCustomSourceOf({ design: null }, designEditor.NO_REMEMBERED_DESIGNS), null);

  const semBotao = designEditor.applyFreeFromCustomPatch({ audio: null, cta: null, design: source }, source);

  assert.deepEqual(semBotao.cta, { href: "", label: "Saiba mais", target: "same_tab" });
  assert.equal(semBotao.design, null, "um design so no rascunho");
  assert.equal(semBotao.freeDesign.children.find((node) => node.type === "heading").lines[0][0].text, "Conteúdo novo na sua área");

  const comBotao = designEditor.applyFreeFromCustomPatch({ audio: null, cta: CTA, design: null }, source);

  assert.equal("cta" in comBotao, false, "o botao do aviso continua");

  const copy = designEditor.POPUP_DESIGN_COPY.free.fromCustom;

  assert.equal(copy.use, "Usar o design Personalizado");

  for (const value of Object.values(copy)) {
    assert.equal(PROIBIDAS.test(value), false, value);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Modelo "Imagem recortada com selo"
 * ---------------------------------------------------------------------------------------------- */

test("o modelo Imagem recortada com selo: válido, canônico, cabe no tamanho e não acende dicas nos tamanhos de partida", () => {
  const value = starters.freeStarterDesign("cutout_sticker");

  assert.deepEqual(valid(value), value);
  assert.ok(checks.freeDesignSizePercent(value) < 20, `${checks.freeDesignSizePercent(value)} %`);
  assert.ok(model.jsonbBytesUpperBound(value) < model.FREE_DESIGN_LIMITS.jsonbBytes / 5);
  assert.deepEqual(checks.popupFreeHints(value, { content: { ctaLabel: "Saiba mais" } }), [], "nem contraste, nem texto no celular");
  assert.equal(model.freeCloseVisibilityProblem(value), null);
  assert.equal(value.artboard.width, 480);
  assert.deepEqual(model.findFreeNode(value, "foto").node, { asset: null, fit: "contain", id: "foto", name: "Imagem recortada", place: { h: 200, mode: "free", w: 170, x: 290, y: 50 }, type: "image" });
  assert.equal(model.findFreeNode(value, "selo").node.place.rotate, -8);
  assert.equal(model.findFreeNode(value, "acoes").node.layout.wrap, true, "os botoes passam para baixo quando o texto do botao e longo");

  const applied = starters.applyFreeStarter("cutout_sticker", { audio: { durationSeconds: 3 }, cta: null });

  assert.deepEqual(applied.cta, { href: "", label: "Saiba mais", target: "same_tab" });
  assert.ok(model.findFreeNode(applied.design, "audio"), "com audio, entra o Áudio");
  assert.equal(
    editor.freeEditorErrors(applied.design, { allowSnooze: true, audio: { durationSeconds: 3 }, cta: CTA })["nodes.foto.asset"],
    schema.POPUP_FREE_MESSAGES.imageMissing,
    "a imagem recortada e a equipe que envia"
  );

  for (const text of [...JSON.stringify(value).matchAll(/"(?:text|label|name)":"([^"]*)"/g)].map((match) => match[1])) {
    assert.equal(PROIBIDAS.test(text), false, text);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Dica "texto no celular"
 * ---------------------------------------------------------------------------------------------- */

test("dica texto no celular: a conta do tamanho no celular (proporção com o piso de 12 px)", () => {
  assert.equal(Math.round(checks.freePhoneEquivalentSize(12, 440) * 100) / 100, 15.39, "12 px numa prancheta de 440: fica 12 px no celular = 15,39 px do desenho");
  assert.equal(checks.freePhoneEquivalentSize(16, 440), 16, "16 x 343/440 = 12,47: o piso nao mexe");
  assert.equal(checks.freePhoneEquivalentSize(13, 300), 13, "prancheta menor que o celular: nada encolhe");
  assert.equal(Math.round(checks.freePhoneEquivalentSize(10, 640) * 100) / 100, 18.66, "10 px fica 10 px (o piso nunca passa do proprio tamanho)");
});

test("dica texto no celular: fica quieta nos modelos e só aparece quando o piso muda o encaixe", () => {
  for (const { id } of starters.FREE_DESIGN_STARTERS) {
    assert.deepEqual(phoneHints(starters.freeStarterDesign(id), { allowSnooze: true, ctaLabel: "Saiba mais" }), [], `${id}: selo e links so crescem um pouco`);
  }

  const paragraph =
    "Uma aula nova acabou de entrar na sua área. Assista agora, anote as dúvidas e coloque em prática ainda hoje; na próxima aula ao vivo a gente responde tudo com calma e com exemplos.";
  const wide = { artboard: { width: 640 } };

  // Texto longo de 13 px numa prancheta de 640: no celular vira 12 px (e nao 7), e ocupa mais linhas.
  assert.deepEqual(phoneHints(design([{ id: "texto", lines: [[{ text: paragraph }]], textStyle: { size: 13 }, type: "text" }], wide)), [
    { key: "nodes.texto.textStyle.size", kind: "phone-text", message: checks.POPUP_FREE_HINT_MESSAGES.phoneText, nodeId: "texto" }
  ]);
  // O mesmo texto grande (o piso nao mexe) ou curto (cabe numa linha do mesmo jeito): nada.
  assert.deepEqual(phoneHints(design([{ id: "texto", lines: [[{ text: paragraph }]], textStyle: { size: 24 }, type: "text" }], wide)), []);
  assert.deepEqual(phoneHints(design([{ id: "texto", lines: [[{ text: "Curto" }]], textStyle: { size: 13 }, type: "text" }], wide)), []);
  // Escondido nao conta.
  assert.deepEqual(phoneHints(design([{ hidden: true, id: "texto", lines: [[{ text: paragraph }]], textStyle: { size: 13 }, type: "text" }], wide)), []);

  // So uma parte pequena: a chave leva ao tamanho da parte.
  assert.deepEqual(
    phoneHints(design([{ id: "titulo", lines: [[{ text: "Grande " }, { style: { size: 12 }, text: paragraph }]], textStyle: { size: 40 }, type: "heading" }], wide)).map((hint) => hint.key),
    ["nodes.titulo.lines.0.1.style.size"]
  );

  // Selo solto numa largura justa (o rascunho do modelo da imagem recortada tinha 112): no celular quebra em duas linhas.
  const sticker = (w) => design([{ box: { padding: [6, 12] }, id: "selo", label: "Aula bônus", place: { mode: "free", w, x: 0, y: 0 }, textStyle: { size: 14, weight: 800 }, type: "badge" }], { artboard: { width: 480 } });

  assert.deepEqual(phoneHints(sticker(112)).map((hint) => hint.nodeId), ["selo"]);
  assert.deepEqual(phoneHints(sticker(128)), [], "a largura do modelo: cabe numa linha");

  // Botao de largura fixa: o texto (uma linha so) fica cortado no celular.
  assert.deepEqual(
    phoneHints(design([{ action: { kind: "close" }, box: { padding: [10, 12] }, id: "fechar", label: "Agora não, obrigado", place: { mode: "flow", width: 190 }, textStyle: { size: 14 }, type: "button" }], wide)),
    [{ key: "nodes.fechar.textStyle.size", kind: "phone-text", message: checks.POPUP_FREE_HINT_MESSAGES.phoneTextCut, nodeId: "fechar" }]
  );

  // Caixa em linha: os dois botoes cabem lado a lado no desenho e deixam de caber no celular.
  const row = (width) =>
    design(
      [
        {
          children: [
            { action: { kind: "cta" }, box: { padding: [12, 18] }, id: "botao", textStyle: { size: 15 }, type: "button" },
            { action: { kind: "close" }, box: { padding: [12, 18] }, id: "fechar", label: "Agora não", textStyle: { size: 15 }, type: "button" }
          ],
          id: "acoes",
          layout: { dir: "row", gap: 8 },
          place: { mode: "flow", width },
          type: "box"
        }
      ],
      wide
    );

  assert.deepEqual(phoneHints(row(300), { ctaLabel: "Quero assistir" }), [
    { key: "nodes.botao.textStyle.size", kind: "phone-text", message: checks.POPUP_FREE_HINT_MESSAGES.phoneTextRow, nodeId: "botao" }
  ]);
  assert.deepEqual(phoneHints(row(400), { ctaLabel: "Quero assistir" }), [], "com folga: nada");

  // Links numa caixa estreita passam a quebrar; sem o Lembrar depois (o aviso nao deixa adiar), cabem.
  const links = design([], {
    artboard: { width: 640 },
    children: [{ children: [{ id: "links", textStyle: { size: 13 }, type: "links" }], id: "caixa", place: { mode: "flow", width: 260 }, type: "box" }]
  });

  assert.deepEqual(phoneHints(links, { allowSnooze: true }).map((hint) => hint.nodeId), ["links"]);
  assert.deepEqual(phoneHints(links, { allowSnooze: false }), []);
});

test("dica texto no celular: mede o design do celular (com os valores próprios) e leva ao campo do celular", () => {
  const paragraph =
    "Uma aula nova acabou de entrar na sua área. Assista agora, anote as dúvidas e coloque em prática ainda hoje; na próxima aula ao vivo a gente responde tudo com calma e com exemplos.";
  const wide = (devices) => design([{ id: "texto", lines: [[{ text: paragraph }]], textStyle: { size: 24 }, type: "text" }], { artboard: { width: 640 }, ...(devices ? { devices } : {}) });

  // 24 px no computador: o piso nao mexe. 13 px so no celular: o piso mexe e a dica leva ao tamanho do celular.
  assert.deepEqual(phoneHints(wide()), []);
  assert.deepEqual(phoneHints(wide({ mobile: { nodes: { texto: { textStyle: { size: 13 } } } } })), [
    { key: "devices.mobile.nodes.texto.textStyle.size", kind: "phone-text", message: checks.POPUP_FREE_HINT_MESSAGES.phoneText, nodeId: "texto" }
  ]);
  // Escondido so no celular: nada.
  assert.deepEqual(phoneHints(wide({ mobile: { nodes: { texto: { hidden: true, textStyle: { size: 13 } } } } })), []);
  // A chave do celular leva ao elemento no editor.
  assert.equal(editor.freeNodeIdForKey(wide(), "devices.mobile.nodes.texto.textStyle.size"), "texto");
});

test("as partes do §9 que viram instruções: a lista do §13.1 e a abertura do §9 são as mesmas do script", () => {
  const doc = readFileSync(new URL("../docs/27-comunicacao-design-livre.md", import.meta.url), "utf8");
  const script = readFileSync(new URL("../scripts/livre-instrucoes-ia.mjs", import.meta.url), "utf8");
  const sections = JSON.parse(/const SECTIONS = (\[[^\]]*\]);/.exec(script)[1]);
  const numbers = (text) => [...text.matchAll(/9\.\d+/g)].map((match) => match[0]);

  // §13.1: "as partes 9.2, 9.3, ... e 9.10 (sem a 9.1 e a 9.7 ...)".
  const listed = /e as partes ((?:9\.\d+(?:, | e ))+9\.\d+) \(sem a 9\.1 e a 9\.7/.exec(doc);
  assert.ok(listed, "a lista do §13.1");
  assert.deepEqual(numbers(listed[1]), sections, "a lista do §13.1 e a do script");

  // §9: "As partes 9.2 a 9.6, 9.8, 9.9 e 9.10 viram as instruções para a IA".
  const intro = /As partes 9\.2 a 9\.6, ((?:9\.\d+(?:, | e ))*9\.\d+) viram as instruções para a IA/.exec(doc);
  assert.ok(intro, "a abertura do §9");
  assert.deepEqual(["9.2", "9.3", "9.4", "9.5", "9.6", ...numbers(intro[1])], sections, "a abertura do §9 e o script");
});

/* ------------------------------------------------------------------------------------------------
 * L6b: contorno e marca-texto no copiar e colar e nas instruções para a IA
 * ---------------------------------------------------------------------------------------------- */

test("L6b: copiar e colar devolve o mesmo design com contorno e marca-texto; colado fora da forma, sai canônico", () => {
  const value = design([
    {
      id: "titulo",
      lines: [
        [{ style: { paint: { color: "#ffffff00", kind: "solid" }, stroke: { color: "#ffffff", width: 2 } }, text: "Semana" }],
        [{ text: "de " }, { style: { mark: { color: "#e5ff1f", padding: [0, 4], radius: 2 }, paint: { color: "#111111", kind: "solid" } }, text: "revisão" }]
      ],
      name: "Título grande",
      textStyle: { size: 40, stroke: { color: "#000000", width: 1 } },
      type: "heading"
    },
    { action: { kind: "cta" }, id: "botao", textStyle: { stroke: { color: "#111111", width: 1 } }, type: "button" }
  ]);
  const text = paste.freeDesignClipboardText(value);

  assert.match(text, /"stroke": \{/);
  assert.match(text, /"mark": \{/);

  const result = paste.parseFreeDesignPaste(text, context());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.design, value, "o mesmo design");
  assert.deepEqual(result.notes, []);
  assert.equal(paste.freeDesignClipboardText(result.design), text, "copiar de novo da o mesmo texto");

  // A IA escreve com os padroes e as cores em maiusculas: o colado sai canonico.
  const loose = {
    children: [
      {
        id: "titulo",
        lines: [[{ text: "de " }, { style: { mark: { color: "#E5FF1F", padding: [2, 6], radius: 4 }, stroke: { color: "#FFFFFF", width: 2 } }, text: "revisão" }]],
        textStyle: { stroke: { color: "#FFFFFF", width: 2 } },
        type: "heading"
      },
      { id: "links", type: "links" }
    ],
    mode: "free",
    version: 1
  };
  const pasted = paste.parseFreeDesignPaste(`\`\`\`json\n${JSON.stringify(loose)}\n\`\`\``, context({ content: { audio: null, cta: null } }));

  assert.equal(pasted.ok, true, JSON.stringify(pasted));
  assert.deepEqual(pasted.design.children[0], {
    id: "titulo",
    lines: [[{ text: "de " }, { style: { mark: { color: "#e5ff1f" } }, text: "revisão" }]],
    textStyle: { stroke: { color: "#ffffff", width: 2 } },
    type: "heading"
  }, "sem o respiro e os cantos padrao e sem o contorno igual ao do elemento");

  // Erro no contorno ou no marca-texto: a frase diz o elemento; no celular, nao existe.
  const broken = paste.parseFreeDesignPaste(
    JSON.stringify({
      children: [
        { id: "titulo", lines: [[{ style: { mark: { color: "#e5ff1f", radius: 30 } }, text: "Oi" }]], name: "Título grande", textStyle: { stroke: { color: "#ffffff", width: 9 } }, type: "heading" },
        { id: "links", type: "links" }
      ],
      devices: { mobile: { nodes: { titulo: { textStyle: { stroke: { color: "#ffffff", width: 1 } } } } } },
      mode: "free",
      version: 1
    }),
    context({ content: { audio: null, cta: null } })
  );

  assert.equal(broken.ok, false);
  assert.equal(broken.errors[0], P.invalid);
  assert.ok(broken.errors.includes("“Título grande”: Use de 1 a 8."), JSON.stringify(broken.errors));
  assert.ok(broken.errors.includes("“Título grande”: Use de 0 a 24."), JSON.stringify(broken.errors));
  assert.ok(broken.errors.includes(`“Título grande”, no celular: ${schema.POPUP_FREE_MESSAGES.design}`), JSON.stringify(broken.errors));

  for (const message of [schema.POPUP_FREE_MESSAGES.stroke, schema.POPUP_FREE_MESSAGES.mark]) {
    assert.equal(PROIBIDAS.test(message), false, message);
    assert.doesNotMatch(message, /\b(?:stroke|mark)\b/i, "na frase, contorno e marca-texto");
  }
});

test("L6b: as instruções para a IA trazem o contorno e o marca-texto, o guia de moderação e o exemplo, sem código", async () => {
  // O arquivo gerado (o teste das instrucoes acima confere que ele e o do docs/27 §9).
  const { FREE_AI_INSTRUCTIONS } = await import("../src/components/admin/v2/communication/popup-free/free-ai-instructions.ts");

  // O contrato (9.3), os padroes (9.4), os limites (9.5), o celular (9.10) e o guia (9.8).
  assert.ok(FREE_AI_INSTRUCTIONS.includes('`stroke` (o contorno das letras: `{ "color", "width": 1 a 8 }`'), "o contorno no textStyle");
  assert.ok(FREE_AI_INSTRUCTIONS.includes("Texto vazado (só o contorno, a letra transparente): `paint` sólida com alfa `00`"), "o texto vazado sem chave propria");
  assert.ok(FREE_AI_INSTRUCTIONS.includes("`style` da parte aceita `font`, `size`, `weight`, `italic`, `uppercase`, `decoration`, `letterSpacing`, `paint`, `stroke` e `mark`"), "a parte");
  assert.ok(FREE_AI_INSTRUCTIONS.includes("só existe na parte do Título e do Texto, nunca no `textStyle`"), "o marca-texto so na parte");
  assert.ok(FREE_AI_INSTRUCTIONS.includes('`{ "color", "padding": 0 a 24 ou [vertical, horizontal], "radius": 0 a 24 }`'), "o formato do marca-texto");
  assert.ok(FREE_AI_INSTRUCTIONS.includes("| marca-texto `padding` / `radius` | `[2, 6]` / 4 |"), "os padroes do marca-texto");
  assert.ok(FREE_AI_INSTRUCTIONS.includes("| Contorno / marca-texto | espessura de 1 a 8 / respiro e cantos de 0 a 24 |"), "os limites");
  assert.ok(FREE_AI_INSTRUCTIONS.includes("fontes, contorno, marca-texto, camada (`z`) e girar (`rotate`) são os mesmos no computador e no celular"), "nada disso no celular");
  assert.match(FREE_AI_INSTRUCTIONS, /\n10\. Contorno e marca-texto com moderação\. [^\n]*só em palavras grandes do Título, nunca no texto que o aluno precisa ler para entender o aviso, no Selo ou nos botões\.\n/, "o guia");
  assert.ok(FREE_AI_INSTRUCTIONS.indexOf("**Contorno e marca-texto**") > FREE_AI_INSTRUCTIONS.indexOf("### 9.9 "), "o exemplo na 9.9");
  assert.ok(FREE_AI_INSTRUCTIONS.indexOf("**Contorno e marca-texto**") < FREE_AI_INSTRUCTIONS.indexOf("### 9.10 "), "antes da 9.10");

  // So o contrato: nada do codigo, do banco nem o nome das entregas (o L6b fica no docs, fora das instrucoes).
  assert.doesNotMatch(FREE_AI_INSTRUCTIONS, /\bL6[a-g]\b/);
  assert.doesNotMatch(FREE_AI_INSTRUCTIONS, /FREE_MARK_DEFAULTS|canonicalSpanStyle|rescaleFreeDesign|servidor/);

  // O exemplo cola de volta e o vazado tem contorno de 2 (o guia pede 2 ou mais).
  const example = [...FREE_AI_INSTRUCTIONS.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]).find((block) => block.includes('"mark"'));
  const result = paste.parseFreeDesignPaste(example, context());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.design, JSON.parse(example), "na forma canonica");

  const vazados = model.findFreeNode(result.design, "titulo").node.lines.flat().filter((span) => span.style?.paint?.color?.endsWith("00"));

  assert.equal(vazados.length, 1);
  assert.ok(vazados[0].style.stroke.width >= 2);
});

/* ------------------------------------------------------------------------------------------------
 * L6c: cores ao passar o mouse no copiar e colar e nas instruções para a IA
 * ---------------------------------------------------------------------------------------------- */

const ESCURECE = { angle: 90, kind: "linear", stops: [{ at: 0, color: "#e50914" }, { at: 100, color: "#b20710" }] };

test("L6c: copiar e colar devolve o mesmo design com as cores ao passar o mouse; colado fora da forma, sai canônico", () => {
  const value = valid({
    children: [
      { id: "titulo", lines: [[{ text: "Aula ao vivo hoje" }]], type: "heading" },
      { action: { kind: "cta" }, box: { fill: [{ color: "#e50914", kind: "solid" }], radius: 999 }, hover: { fill: ESCURECE }, id: "botao", type: "button" },
      {
        action: { kind: "close" },
        box: { border: { color: "#ffffff40", width: 1 } },
        hover: { borderColor: "#ffffff", color: "#111111", fill: { color: "#ffffff", kind: "solid" } },
        id: "agoranao",
        label: "Agora não",
        name: "Botão de sair",
        type: "button"
      },
      { hover: { color: "#ffffff" }, id: "links", textStyle: { paint: { color: "#a1a1aa", kind: "solid" } }, type: "links" }
    ],
    mode: "free",
    version: 1
  });
  const text = paste.freeDesignClipboardText(value);

  assert.equal(text.match(/"hover": \{/g)?.length, 3);

  const result = paste.parseFreeDesignPaste(text, context());

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.design, value, "o mesmo design");
  assert.deepEqual(result.notes, []);
  assert.equal(paste.freeDesignClipboardText(result.design), text, "copiar de novo dá o mesmo texto");

  // A IA escreve com as cores em maiúsculas, o ângulo padrão, as paradas fora de ordem e um hover vazio: sai canônico.
  const loose = {
    children: [
      { action: { kind: "cta" }, hover: { color: "#FFFFFF", fill: { angle: 180, kind: "linear", stops: [{ at: 100, color: "#B20710" }, { at: 0, color: "#E50914" }] } }, id: "botao", type: "button" },
      { hover: {}, id: "links", type: "links" }
    ],
    mode: "free",
    version: 1
  };
  const pasted = paste.parseFreeDesignPaste(`\`\`\`json\n${JSON.stringify(loose)}\n\`\`\``, context());

  assert.equal(pasted.ok, true, JSON.stringify(pasted));
  assert.deepEqual(pasted.design.children, [
    { action: { kind: "cta" }, hover: { color: "#ffffff", fill: { kind: "linear", stops: [{ at: 0, color: "#e50914" }, { at: 100, color: "#b20710" }] } }, id: "botao", type: "button" },
    { id: "links", type: "links" }
  ], "cores em minúsculas, sem o ângulo padrão e sem o objeto vazio");

  // Erros: a frase diz o elemento; o texto em degradê recusa a cor do texto; fora do Botão e dos Links e no celular, não existe.
  const gradient = paste.parseFreeDesignPaste(
    JSON.stringify({
      children: [
        { action: { kind: "cta" }, hover: { color: "#ffffff" }, id: "botao", name: "Botão grande", textStyle: { paint: ESCURECE }, type: "button" },
        { id: "links", type: "links" }
      ],
      mode: "free",
      version: 1
    }),
    context()
  );

  assert.equal(gradient.ok, false);
  assert.deepEqual(gradient.errors, [P.invalid, `“Botão grande”: ${schema.POPUP_FREE_MESSAGES.hoverGradient}`]);

  const broken = paste.parseFreeDesignPaste(
    JSON.stringify({
      children: [
        { hover: { color: "#ffffff" }, id: "titulo", lines: [[{ text: "Oi" }]], name: "Título grande", type: "heading" },
        { action: { kind: "cta" }, hover: { fill: { asset: "capa", kind: "image" } }, id: "botao", name: "Botão grande", type: "button" },
        { hover: { fill: { color: "#000000", kind: "solid" } }, id: "links", type: "links" }
      ],
      devices: { mobile: { nodes: { botao: { hover: { color: "#000000" } } } } },
      mode: "free",
      version: 1
    }),
    context()
  );

  assert.equal(broken.ok, false);
  assert.equal(broken.errors[0], P.invalid);

  for (const line of [
    `“Título grande”: ${schema.POPUP_FREE_MESSAGES.design}`,
    `“Botão grande”: ${schema.POPUP_FREE_MESSAGES.paint}`,
    `“links”: ${schema.POPUP_FREE_MESSAGES.design}`,
    `“Botão grande”, no celular: ${schema.POPUP_FREE_MESSAGES.design}`
  ]) {
    assert.ok(broken.errors.includes(line), `${line}: ${JSON.stringify(broken.errors)}`);
  }

  // As frases novas em português simples: nada de "hover" nem das palavras proibidas.
  for (const message of [schema.POPUP_FREE_MESSAGES.hover, schema.POPUP_FREE_MESSAGES.hoverGradient]) {
    assert.equal(PROIBIDAS.test(message), false, message);
    assert.doesNotMatch(message, /\bhover\b/i, "na frase, ao passar o mouse");
  }
});
