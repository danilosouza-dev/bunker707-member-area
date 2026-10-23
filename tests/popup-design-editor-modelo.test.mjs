import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Editor do "Design do pop-up" (docs/26; spec §7.3; docs/18 §1.1): as pecas puras do card "Design" do editor
// (popup-design-editor-model.ts). Escolher um modelo (cria o botao "Saiba mais" quando falta e mantem o video),
// Padrão <-> Personalizado com memoria, acrescentar/tirar/subir/descer bloco (limite de 12, ids unicos, tirar o
// botao principal tira o botao do aviso), a sincronia com o botao e o audio, o foco de cada erro do design
// (todas as chaves do §7.2, com os ids que existem nas telas), os pesos de cada fonte, a conferencia do video e
// da fonte antes de enviar e o vocabulario da equipe. Tudo carregado direto pelo Node.

const editor = await import("../src/components/admin/v2/communication/popup-design/popup-design-editor-model.ts");
const model = await import("../src/server/communications/popup-design-model.ts");
const designSchema = await import("../src/server/communications/popup-design-schema.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const viewModel = await import("../src/components/admin/v2/communication/notices-view-model.ts");

const ORIGIN = "http://127.0.0.1:55321";
const VIDEO_PATH = "videos/0b7c7f3e-2d1a-4c55-9a4e-5f1f7b2c9d10.mp4";
const VIDEO = { mimeType: "video/mp4", path: VIDEO_PATH, url: `${ORIGIN}/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}` };
const IMAGE = { alt: "", url: `${ORIGIN}/storage/v1/object/public/content-assets/communications/images/capa.webp` };
const CTA = { href: "/minhas-compras", label: "Quero ver", target: "same_tab" };
const AUDIO = { durationSeconds: 12, mimeType: "audio/webm", peaks: [], url: `${ORIGIN}/storage/v1/object/public/communication-audio/audio/a.webm` };
const FONT_ID = "6f1c2c9e-8d55-4f3a-9a1b-0c2d3e4f5a6b";

const PROIBIDAS = ["campanha", "público", "audiência", "evento", "oferta", "gatilho", "trigger", "sessão", "impressão", "home", "layout", "template", "automação", "lembrete"];

function popupDraft(overrides = {}) {
  return { ...schemas.emptyNoticeDraft("popup"), cta: CTA, image: IMAGE, title: "Aula nova", ...overrides };
}

function errorsOf(draft) {
  const parsed = schemas.noticeDraftSchema.safeParse(viewModel.noticeDraftForKind(draft));
  return parsed.success ? {} : viewModel.noticeErrorsFrom(parsed.error.issues);
}

function collectStrings(value, into = []) {
  if (typeof value === "string") {
    into.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, into));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, into));
  }

  return into;
}

/* ------------------------------------------------------------------------------------------------
 * Modelos para comecar
 * ---------------------------------------------------------------------------------------------- */

test("modelo: cada um preenche um design valido, canonico e sem dica de contraste; sem botao, cria o “Saiba mais”", () => {
  assert.deepEqual(
    editor.DESIGN_STARTER_OPTIONS.map((starter) => starter.label),
    ["Mídia no topo com degradê", "Só texto", "Texto sobre a mídia"]
  );

  for (const { id } of editor.DESIGN_STARTER_OPTIONS) {
    const semBotao = editor.applyStarter({ audio: null, cta: null }, id, null);
    assert.deepEqual(semBotao.cta, { href: "", label: "Saiba mais", target: "same_tab" }, `${id}: botao criado com o destino a escolher`);
    assert.equal(designSchema.popupDesignSchema.safeParse(semBotao.design).success, true, id);
    assert.deepEqual(model.canonicalPopupDesign(semBotao.design), semBotao.design, `${id}: canonico`);
    assert.deepEqual(model.popupDesignContrastHints(semBotao.design), [], `${id}: sem dica de contraste`);
    assert.equal(semBotao.design.blocks.filter((block) => block.type === "button").length, 1);

    const comBotao = editor.applyStarter({ audio: null, cta: CTA }, id, null);
    assert.equal("cta" in comBotao, false, `${id}: o botao que ja existe fica como esta`);

    // O rascunho inteiro passa (o destino vazio do "Saiba mais" e o unico erro).
    assert.deepEqual(errorsOf(popupDraft({ ...semBotao, cta: { ...semBotao.cta, href: "/minhas-compras" } })), {}, id);
    assert.deepEqual(Object.keys(errorsOf(popupDraft(semBotao))), ["cta.href"], `${id}: so falta escolher para onde leva`);
  }
});

test("modelo: com audio entra o bloco Áudio; o video que ja estava no design continua (e a midia vira Vídeo)", () => {
  const comAudio = editor.applyStarter({ audio: AUDIO, cta: CTA }, "media_top_fade", null);
  assert.equal(comAudio.design.blocks.filter((block) => block.type === "audio").length, 1);
  assert.deepEqual(errorsOf(popupDraft({ audio: AUDIO, design: comAudio.design })), {});

  const anterior = editor.applyStarter({ audio: null, cta: CTA }, "text_only", { ...model.popupStarterDesign("media_top_fade"), media: { ...model.popupStarterDesign("media_top_fade").media, kind: "video", video: VIDEO } });
  assert.deepEqual(anterior.design.media.video, VIDEO, "o video fica guardado mesmo no modelo sem midia");
  assert.equal(anterior.design.media.kind, "none");

  const comVideo = editor.applyStarter({ audio: null, cta: CTA }, "media_overlay", anterior.design);
  assert.equal(comVideo.design.media.kind, "video");
  assert.deepEqual(comVideo.design.media.video, VIDEO);
});

/* ------------------------------------------------------------------------------------------------
 * Padrão <-> Personalizado <-> Livre
 * ---------------------------------------------------------------------------------------------- */

const NADA = editor.NO_REMEMBERED_DESIGNS;

test("Padrão <-> Personalizado: voltar ao Padrão guarda o design; voltar ao Personalizado devolve, coerente com o botao e o audio", () => {
  const design = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;

  const paraPadrao = editor.switchDesignMode({ audio: null, cta: CTA, design }, "default", NADA);
  assert.deepEqual(paraPadrao.patch, { design: null, freeDesign: null });
  assert.equal(paraPadrao.remembered.custom, design);

  // No Padrão o produtor tirou o botao e gravou um audio: o design volta com o bloco Áudio e sem o botao.
  const devolta = editor.switchDesignMode({ audio: AUDIO, cta: null, design: null }, "custom", paraPadrao.remembered);
  assert.deepEqual(
    devolta.patch.design.blocks.map((block) => block.type),
    ["badge", "heading", "text", "audio"]
  );
  assert.equal(devolta.patch.freeDesign, null);
  assert.deepEqual(errorsOf(popupDraft({ audio: AUDIO, cta: null, design: devolta.patch.design })), {});

  // Primeira vez no Personalizado (sem memoria): nada muda ainda, a tela mostra os modelos.
  assert.deepEqual(editor.switchDesignMode({ audio: null, cta: CTA, design: null }, "custom", NADA), { patch: null, remembered: NADA });
  // Ja no modo pedido: nada muda.
  assert.equal(editor.switchDesignMode({ audio: null, cta: CTA, design }, "custom", NADA).patch, null);
  assert.equal(editor.switchDesignMode({ audio: null, cta: CTA, design: null }, "default", { custom: design, free: null }).patch, null);
});

test("três modos: o Livre e o Personalizado guardam um ao outro na memoria e nunca ficam juntos no rascunho", () => {
  const free = livreEmBranco();
  const custom = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;

  assert.deepEqual(editor.DESIGN_MODE_OPTIONS.map((option) => option.label), ["Padrão", "Personalizado", "Livre"]);
  assert.equal(editor.popupDesignModeOf({ design: null, freeDesign: free }), "free");
  assert.equal(editor.popupDesignModeOf({ design: custom, freeDesign: null }), "custom");
  assert.equal(editor.popupDesignModeOf({}), "default");

  // Personalizado -> Livre pela primeira vez: o Personalizado vai para a memoria e o rascunho fica sem design
  // (a tela mostra os modelos do Livre).
  const paraLivre = editor.switchDesignMode({ audio: null, cta: CTA, design: custom, freeDesign: null }, "free", NADA);
  assert.deepEqual(paraLivre.patch, { design: null, freeDesign: null });
  assert.equal(paraLivre.remembered.custom, custom);

  // Livre -> Personalizado: o Livre fica na memoria e o Personalizado volta sem perguntar.
  const paraPersonalizado = editor.switchDesignMode({ audio: null, cta: CTA, design: null, freeDesign: free }, "custom", paraLivre.remembered);
  assert.equal(paraPersonalizado.patch.freeDesign, null);
  assert.equal(paraPersonalizado.patch.design.blocks.length, custom.blocks.length);
  assert.equal(paraPersonalizado.remembered.free, free);

  // E volta ao Livre, coerente com o audio de agora (o elemento Áudio entra antes do botao).
  const deVolta = editor.switchDesignMode({ audio: AUDIO, cta: CTA, design: paraPersonalizado.patch.design, freeDesign: null }, "free", paraPersonalizado.remembered);
  assert.equal(deVolta.patch.design, null);
  assert.ok(deVolta.patch.freeDesign.children.some((node) => node.type === "audio"));
  assert.ok(deVolta.remembered.custom);
  assert.deepEqual(errorsOf(popupDraft({ audio: AUDIO, design: null, freeDesign: deVolta.patch.freeDesign })), {});

  // Livre -> Padrão: os dois nulos.
  assert.deepEqual(editor.switchDesignMode({ audio: null, cta: CTA, design: null, freeDesign: free }, "default", NADA).patch, { design: null, freeDesign: null });
});

function livreEmBranco() {
  return editor.applyFreeStarterPatch({ audio: null, cta: CTA }, "blank").freeDesign;
}

test("modelos do Livre: os quatro, o botao “Saiba mais” quando falta, o video do Personalizado e a imagem do aviso como capa", () => {
  assert.deepEqual(
    editor.FREE_STARTER_OPTIONS.map((starter) => [starter.label, starter.description]),
    [
      ["Vídeo no topo com degradê", "Vídeo em cima sumindo no fundo escuro, selo, título em duas cores e botão verde."],
      ["Só texto com brilho", "Sem mídia: manchas de luz no fundo, título em degradê e botão largo."],
      ["Em branco", "Só o fundo, um título, o botão e os links. Você coloca o resto."],
      ["Imagem recortada com selo", "Uma imagem sem fundo ao lado do texto, um selo inclinado por cima e dois botões."]
    ]
  );

  // Sem botao no aviso: o modelo cria o "Saiba mais" com o destino vazio (o produtor escolhe no editor).
  const semBotao = editor.applyFreeStarterPatch({ audio: null, cta: null, design: null }, "blank");
  assert.deepEqual(semBotao.cta, { href: "", label: "Saiba mais", target: "same_tab" });
  assert.equal(semBotao.design, null);
  assert.ok(semBotao.freeDesign.children.some((node) => node.type === "button" && node.action.kind === "cta"));

  // Com botao: o cta do aviso fica como esta (o patch nem leva a chave).
  const comBotao = editor.applyFreeStarterPatch({ audio: null, cta: CTA }, "glow_text");
  assert.equal("cta" in comBotao, false);
  assert.deepEqual(errorsOf(popupDraft({ design: null, freeDesign: comBotao.freeDesign })), {});

  // "Vídeo no topo": o video do Personalizado (no rascunho ou guardado) e a capa com as medidas lidas.
  const custom = { ...editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design };
  custom.media = { ...custom.media, kind: "video", video: VIDEO };
  assert.equal(editor.freeStarterVideoOf({ design: custom }, NADA), VIDEO);
  assert.equal(editor.freeStarterVideoOf({ design: null }, { custom, free: null }), VIDEO);
  assert.equal(editor.freeStarterVideoOf({ design: null }, NADA), null);

  const capa = { height: 720, path: "communications/images/0123456789abcdef01234567.webp", width: 1280 };
  const comVideo = editor.applyFreeStarterPatch({ audio: null, cta: CTA }, "video_top_fade", { poster: capa, video: VIDEO });
  const arquivos = comVideo.freeDesign.assets;
  assert.deepEqual(arquivos.find((asset) => asset.kind === "video"), { id: "video", kind: "video", mimeType: "video/mp4", path: VIDEO_PATH, poster: "capa" });
  assert.deepEqual(arquivos.find((asset) => asset.kind === "image"), { height: 720, id: "capa", kind: "image", path: capa.path, width: 1280 });
  assert.equal(JSON.stringify(comVideo.freeDesign).includes("http"), false, "o design guarda so o caminho");

  // Resumo e problemas do card.
  assert.equal(editor.freeDesignSummary(comBotao.freeDesign), `${comBotao.freeDesign.children.length} elementos · 440 px`);
  assert.equal(editor.freeProblemsLabel(1), "1 problema para revisar");
  assert.equal(editor.freeProblemsLabel(3), "3 problemas para revisar");
  assert.equal(editor.isFreeProblemKey("freeDesign.nodes.botao.label"), true);
  assert.equal(editor.isFreeProblemKey("cta.href"), true);
  assert.equal(editor.isFreeProblemKey("title"), false);
});

test("rascunho do Livre: o pedido leva as duas chaves, a forma canonica compara o Livre e a previa usa o item do Livre", async () => {
  const popupEditor = await import("../src/components/admin/v2/communication/popup-editor-model.ts");
  const free = editor.applyFreeStarterPatch({ audio: null, cta: CTA }, "blank").freeDesign;
  const draft = popupDraft({ design: null, freeDesign: free });

  // As duas chaves sempre no pedido (spec §2.1: uma aba antiga que so manda `design` troca o Livre gravado).
  const payload = viewModel.noticeDraftForKind(draft);
  assert.equal(payload.design, null);
  assert.equal(payload.freeDesign, free);
  assert.equal("freeDesign" in viewModel.noticeDraftForKind({ ...draft, kind: "inbox" }), false, "a notificacao nunca leva o Livre");
  assert.equal(viewModel.noticeDraftForKind(popupDraft({ design: null })).freeDesign, null);

  // "Tem mudanca": o Livre pela forma canonica (padrao escrito = omitido); mudar um texto conta.
  const escrito = { ...free, artboard: { ...free.artboard, width: 440 } };
  assert.equal(viewModel.isSameNoticeDraft(draft, { ...draft, freeDesign: escrito }), true);
  const titulo = free.children.find((node) => node.type === "heading");
  const outroTexto = { ...free, children: free.children.map((node) => (node === titulo ? { ...node, lines: [[{ text: "Outro título" }]] } : node)) };
  assert.equal(viewModel.isSameNoticeDraft(draft, { ...draft, freeDesign: outroTexto }), false);
  assert.equal(viewModel.isSameNoticeDraft(draft, { ...draft, freeDesign: null }), false);

  // Previa e relatorio: o mesmo item do palco do editor (titulo do design, sem imagem nem icone).
  const item = viewModel.draftToPopupItem({ ...draft, popup: { ...draft.popup, close: "x_only" } });
  assert.equal(item.freeDesign, free);
  assert.equal(item.image, null);
  assert.equal(item.close, "x_only");
  assert.equal(item.title, "Seu título aqui");

  // D9: no Livre sem botao principal, o botao "Abrir um link" visivel libera "Quando o aluno clica no botão".
  const semBotao = editor.withSyncedDesign(draft, { cta: null }).freeDesign;
  const link = { action: { href: "/minhas-compras", kind: "link", target: "same_tab" }, id: "link1", label: "Ver aulas", type: "button" };
  const comLink = { ...semBotao, children: [...semBotao.children.slice(0, -1), link, semBotao.children.at(-1)] };
  assert.equal(popupEditor.clickStopDisabled({ cta: null, freeDesign: semBotao }), true);
  assert.equal(popupEditor.clickStopDisabled({ cta: null, freeDesign: comLink }), false);
  assert.equal(popupEditor.clickStopDisabled({ cta: null, freeDesign: { ...comLink, children: comLink.children.map((node) => (node.id === "link1" ? { ...node, hidden: true } : node)) } }), true, "escondido nao conta");
  assert.equal(popupEditor.repeatStartOf({ cta: null, freeDesign: comLink }).stopOn, "click");
});

test("sincronia no Livre: tirar o botao tira o Botão principal; gravar o audio poe o elemento Áudio", () => {
  const free = editor.applyFreeStarterPatch({ audio: null, cta: CTA }, "blank").freeDesign;
  const draft = popupDraft({ design: null, freeDesign: free });

  const semBotao = editor.withSyncedDesign(draft, { cta: null });
  assert.equal(semBotao.freeDesign.children.some((node) => node.type === "button" && node.action.kind === "cta"), false);
  assert.equal(semBotao.design, null);

  const comAudio = editor.withSyncedDesign(draft, { audio: AUDIO });
  assert.ok(comAudio.freeDesign.children.some((node) => node.type === "audio"));
  assert.deepEqual(errorsOf(comAudio), {});
  assert.equal(editor.withSyncedDesign(draft, { title: "Outro" }).freeDesign, free);
});

test("sincronia: no Personalizado, tirar o botao tira o bloco do botao; gravar o audio poe o bloco Áudio antes do botao", () => {
  const design = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;
  const draft = popupDraft({ design });

  const semBotao = editor.withSyncedDesign(draft, { cta: null });
  assert.equal(semBotao.design.blocks.some((block) => block.type === "button"), false);

  const comAudio = editor.withSyncedDesign(draft, { audio: AUDIO });
  assert.deepEqual(
    comAudio.design.blocks.map((block) => block.type),
    ["badge", "heading", "text", "audio", "button"]
  );
  assert.deepEqual(errorsOf(comAudio), {});

  // Outras mudancas, o Padrão e a notificacao ficam como estao.
  assert.equal(editor.withSyncedDesign(draft, { title: "Outro" }).design, design);
  assert.equal(editor.withSyncedDesign(popupDraft({ design: null }), { cta: null }).design, null);
  const inbox = { ...schemas.emptyNoticeDraft("inbox"), design };
  assert.equal(editor.withSyncedDesign(inbox, { cta: null }).design, design);
});

test("quantas vezes: sem botao principal, um segundo botao com link libera “Quando o aluno clica no botão” (D9)", async () => {
  const popupEditor = await import("../src/components/admin/v2/communication/popup-editor-model.ts");
  const semBotao = editor.withSyncedDesign(popupDraft({ design: editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design }), { cta: null });
  const fechar = { ...model.newPopupBlock("button2", "b8"), action: { kind: "close" } };
  const link = { ...model.newPopupBlock("button2", "b8"), action: { href: "/minhas-compras", kind: "link", target: "same_tab" } };

  assert.equal(popupEditor.clickStopDisabled({ cta: null, design: semBotao.design }), true, "sem botao e sem link, o clique nunca pararia");
  assert.equal(popupEditor.clickStopDisabled({ cta: null, design: { ...semBotao.design, blocks: [...semBotao.design.blocks, fechar] } }), true, "Fechar nao conta como o clique");
  const comLink = { ...semBotao.design, blocks: [...semBotao.design.blocks, link] };
  assert.equal(popupEditor.clickStopDisabled({ cta: null, design: comLink }), false, "o link do segundo botao conta como o clique");
  assert.equal(popupEditor.repeatStartOf({ cta: null, design: comLink }).stopOn, "click");
  assert.equal(popupEditor.repeatStartOf({ cta: null, design: semBotao.design }).stopOn, "never");
  assert.equal(popupEditor.clickStopDisabled({ cta: null, design: null }), true, "Padrão sem botao: como antes");

  // O aviso sem botao no Personalizado aponta para o card Design (nao para a chave que o Personalizado esconde).
  assert.equal(popupEditor.POPUP_EDITOR_COPY.frequency.stopNoButtonDesign, "Este pop-up não tem botão. Acrescente o Botão principal no Design ou escolha outra opção.");

  // O schema aceita o mesmo (sem erro em popup.frequency.stopOn).
  const repetir = { ...semBotao, design: comLink, popup: { ...semBotao.popup, frequency: { everyMinutes: null, maxPerDay: 1, maxTotal: null, mode: "repeat", stopOn: "click" } } };
  assert.equal(errorsOf(repetir)["popup.frequency.stopOn"], undefined);
  assert.ok(errorsOf({ ...repetir, design: semBotao.design })["popup.frequency.stopOn"]);
});

/* ------------------------------------------------------------------------------------------------
 * Blocos
 * ---------------------------------------------------------------------------------------------- */

test("blocos: selo, titulo, texto e espaco entram antes do botao; o segundo botao no fim; o Botão principal cria o botao do aviso", () => {
  const design = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;

  const texto = editor.addBlock({ audio: null, cta: CTA, design }, "text");
  assert.equal(texto.index, 3);
  assert.deepEqual(
    texto.design.blocks.map((block) => block.type),
    ["badge", "heading", "text", "text", "button"]
  );

  const segundo = editor.addBlock({ audio: null, cta: CTA, design: texto.design }, "button2");
  assert.equal(segundo.design.blocks.at(-1).type, "button2");
  assert.deepEqual(editor.addableBlockTypes(segundo.design), ["badge", "heading", "text", "spacer"], "botao e segundo botao so uma vez");
  assert.equal(editor.addBlock({ audio: null, cta: CTA, design: segundo.design }, "button2"), null);

  // Sem botao: "Botão principal" volta a aparecer e cria o "Saiba mais".
  const tirado = editor.removeBlock(design, design.blocks.findIndex((block) => block.type === "button"));
  assert.equal(tirado.cta, null, "tirar o botao principal tira o botao do aviso");
  assert.ok(editor.addableBlockTypes(tirado.design).includes("button"));
  const principal = editor.addBlock({ audio: null, cta: null, design: tirado.design }, "button");
  assert.deepEqual(principal.cta, { href: "", label: "Saiba mais", target: "same_tab" });
  assert.equal(principal.design.blocks.at(-1).type, "button");

  for (const patch of [texto, segundo]) {
    assert.deepEqual(errorsOf(popupDraft({ design: patch.design })), {}, "o design continua valido");
  }
});

test("blocos: no maximo 12, ids unicos; o Áudio e o ultimo bloco nao saem; subir e descer param nas pontas", () => {
  let design = editor.applyStarter({ audio: AUDIO, cta: CTA }, "text_only", null).design;

  while (editor.canAddBlock(design)) {
    design = editor.addBlock({ audio: AUDIO, cta: CTA, design }, "spacer").design;
  }

  assert.equal(design.blocks.length, 12);
  assert.equal(new Set(design.blocks.map((block) => block.id)).size, 12, "ids unicos");
  assert.ok(design.blocks.every((block) => model.POPUP_BLOCK_ID_PATTERN.test(block.id)));
  assert.equal(editor.addBlock({ audio: AUDIO, cta: CTA, design }, "text"), null, "o 13º nao entra");
  assert.equal(editor.POPUP_DESIGN_COPY.blocks.limit, "Use até 12 blocos.");
  assert.deepEqual(errorsOf(popupDraft({ audio: AUDIO, design })), {});

  const audio = design.blocks.findIndex((block) => block.type === "audio");
  assert.equal(editor.canRemoveBlock(design, audio), false);
  assert.equal(editor.removeBlock(design, audio), null);

  const unico = { ...design, blocks: [design.blocks[0]] };
  assert.equal(editor.canRemoveBlock(unico, 0), false, "o design nunca fica sem bloco");

  const inicio = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;
  assert.equal(editor.moveBlock(inicio, 0, -1), inicio);
  assert.equal(editor.moveBlock(inicio, inicio.blocks.length - 1, 1), inicio);
  const descido = editor.moveBlock(inicio, 0, 1);
  assert.deepEqual(
    descido.blocks.map((block) => block.type),
    ["heading", "badge", "text", "button"]
  );
  assert.deepEqual(editor.moveBlock(descido, 1, -1).blocks, inicio.blocks);
});

test("blocos: trocar a fonte por uma enviada recalcula as fontes do design; nome e resumo de cada bloco", () => {
  const design = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;
  const heading = design.blocks[1];
  const trocado = editor.replaceBlock(design, 1, { ...heading, style: { ...heading.style, font: { id: FONT_ID, kind: "uploaded" } } });
  assert.deepEqual(trocado.fonts, [FONT_ID]);

  assert.equal(editor.blockSummary(design.blocks[1], CTA), "Conteúdo novo / Já disponível");
  assert.equal(editor.blockSummary(design.blocks[3], CTA), "Quero ver");
  assert.equal(editor.blockSummary(design.blocks[3], null), "Sem texto");
  assert.equal(editor.blockSummary(model.newPopupBlock("button2", "b9"), CTA), "Agora não · Fechar");
  assert.equal(editor.blockSummary(model.newPopupBlock("spacer", "b9"), CTA), "16 px");

  const doisTextos = editor.addBlock({ audio: null, cta: CTA, design }, "text").design;
  assert.equal(editor.blockName(doisTextos, 2), "Texto 1");
  assert.equal(editor.blockName(doisTextos, 3), "Texto 2");
  assert.equal(editor.blockName(doisTextos, 0), "Selo");
});

/* ------------------------------------------------------------------------------------------------
 * Foco de cada erro
 * ---------------------------------------------------------------------------------------------- */

test("foco: cada chave do design leva ao campo da tabela do §7.2", () => {
  const casos = [
    ["design.blocks.1.lines.0.text", "#popup-design-bloco-1-linha-0"],
    ["design.blocks.1.lines.2", "#popup-design-bloco-1-linha-2"],
    ["design.blocks.2.text", "#popup-design-bloco-2-texto"],
    ["design.blocks.4.label", "#popup-design-bloco-4-rotulo"],
    ["design.blocks.4.action", "#popup-design-bloco-4-link, #popup-design-bloco-4 [name$='-acao']"],
    ["design.blocks.4.action.href", "#popup-design-bloco-4-link, #popup-design-bloco-4 [name$='-acao']"],
    ["design.blocks.0.style.size", "#popup-design-bloco-0"],
    ["design.blocks.3", "#popup-design-bloco-3"],
    ["design.blocks", "#popup-design-blocos"],
    ["design.media.video", "#popup-design-video"],
    ["design.media.position", "[name='popup-design-midia-recorte']"],
    ["design.media.fade.end", "#popup-design-degrade-fim"],
    ["design.media.fade.height", "#popup-design-degrade-inicio"],
    ["design.media.fade.color", "#popup-design-degrade-cor"],
    ["design.media.fade", "#popup-design-degrade"],
    ["design.media.kind", "[name='popup-design-midia']"],
    ["design.media", "[name='popup-design-midia']"],
    ["design.text.gap", "[name='popup-design-posicao']"],
    ["design.card.background.url", "[aria-labelledby='popup-design-cartao-imagem-label']"],
    ["design.card.background.position", "[name='popup-design-cartao-imagem-parte']"],
    ["design.card.background.dim", "#popup-design-cartao-imagem-escurecer"],
    ["design.card.background.color", "#popup-design-cartao-fundo-cor"],
    ["design.card.background.from", "#popup-design-cartao-fundo-de"],
    ["design.card.background.to", "#popup-design-cartao-fundo-para"],
    ["design.card.background.angle", "#popup-design-cartao-fundo-angulo"],
    ["design.card.background", "[name='popup-design-cartao-fundo-tipo']"],
    ["design.card.radius", "#popup-design-cartao"],
    ["design.close.color", "#popup-design-fechar"],
    ["design.links.color", "#popup-design-fechar"],
    ["design.links.showDismiss", "#popup-design-links-nao-mostrar"],
    ["design.links", "#popup-design-fechar"],
    ["design.fonts", "#popup-design-fontes"],
    ["design.version", "[name='popup-design']"],
    ["design", "[name='popup-design']"]
  ];

  for (const [key, selector] of casos) {
    assert.equal(editor.popupDesignFocusSelector(key), selector, key);
  }

  assert.equal(editor.popupDesignFocusSelector("cta.label"), null, "o botao e a imagem seguem com os ids de hoje");
  assert.equal(editor.popupDesignFocusSelector("designer"), null);
});

test("foco: os erros que o schema da de verdade caem no seletor certo, e os ids existem nas telas", async () => {
  const design = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;
  const heading = design.blocks[1];
  const quebrado = {
    ...design,
    blocks: [
      design.blocks[0],
      { ...heading, lines: [{ ...heading.lines[0], text: "  " }] },
      { ...design.blocks[2], text: "" },
      design.blocks[3],
      { ...model.newPopupBlock("button2", "b7"), label: "" }
    ]
  };
  const erros = errorsOf(popupDraft({ design: quebrado }));
  assert.equal(erros["design.blocks.1.lines.0.text"], "Escreva o texto da linha.");
  assert.equal(erros["design.blocks.2.text"], "Escreva o texto.");
  assert.equal(erros["design.blocks.4.label"], "Escreva o texto do botão.");

  const lembrar = errorsOf(popupDraft({ allowSnooze: false, design: { ...design, blocks: [...design.blocks, { ...model.newPopupBlock("button2", "b7"), action: { kind: "snooze" } }] } }));
  assert.equal(lembrar["design.blocks.4.action"], "Este botão usa o “Lembrar depois”, que está desligado neste pop-up.");
  assert.equal(editor.popupDesignFocusSelector("design.blocks.4.action"), "#popup-design-bloco-4-link, #popup-design-bloco-4 [name$='-acao']");

  const semVideo = errorsOf(popupDraft({ design: { ...design, media: { ...design.media, kind: "video", video: null } } }));
  assert.equal(semVideo["design.media.video"], "Envie o vídeo ou escolha outra mídia.");

  const semBloco = errorsOf(popupDraft({ design: { ...design, blocks: design.blocks.filter((block) => block.type !== "button") } }));
  assert.equal(semBloco["design.blocks"], "Falta o bloco do botão principal no design.");

  // Fundo do cartao com Imagem: sem imagem ainda (url vazia) ou link de fora caem no campo da imagem do fundo.
  const fundoImagem = (url) => ({ ...design, card: { ...design.card, background: { color: "#16181c", dim: 40, kind: "image", position: "center", url } } });
  for (const url of ["", "https://exemplo.com/imagem.webp"]) {
    const erros = errorsOf(popupDraft({ design: fundoImagem(url) }));
    const chave = Object.keys(erros).find((key) => key.startsWith("design.card.background"));
    assert.ok(chave, `fundo com imagem "${url}" da erro no fundo`);
    assert.equal(editor.popupDesignFocusSelector(chave), "[aria-labelledby='popup-design-cartao-imagem-label']", chave);
  }

  const fadeFora = errorsOf(popupDraft({ design: { ...design, media: { ...design.media, fade: { ...design.media.fade, end: 10 } } } }));
  assert.equal(editor.popupDesignFocusSelector(Object.keys(fadeFora).find((key) => key.startsWith("design.media.fade"))), "#popup-design-degrade-fim");

  // A chave "Mostrar o link “Não mostrar de novo”" so aceita booleano; o erro cai na propria chave.
  const linkFora = errorsOf(popupDraft({ design: { ...design, links: { ...design.links, showDismiss: "não" } } }));
  assert.equal(linkFora["design.links.showDismiss"], "Escolha se o link “Não mostrar de novo” aparece.");
  assert.equal(editor.popupDesignFocusSelector("design.links.showDismiss"), "#popup-design-links-nao-mostrar");
  assert.deepEqual(errorsOf(popupDraft({ design: { ...design, links: { ...design.links, showDismiss: false } } })), {}, "desligada, salva");

  // Os ids e nomes dos seletores existem nas telas do editor.
  const pasta = new URL("../src/components/admin/v2/communication/popup-design/", import.meta.url);
  const telas = (await Promise.all((await readdir(pasta)).filter((file) => file.endsWith(".tsx")).map((file) => readFile(new URL(file, pasta), "utf8")))).join("\n");

  for (const pedaco of [
    'name="popup-design"',
    'name="popup-design-midia"',
    'name="popup-design-posicao"',
    'id="popup-design-video"',
    'id="popup-design-blocos"',
    'id="popup-design-cartao"',
    'id="popup-design-fechar"',
    'id="popup-design-fontes"',
    "`popup-design-bloco-${index}`",
    "-linha-${",
    "-texto`",
    "-rotulo`",
    "-link`",
    "-acao`",
    'idPrefix="aviso"',
    'id="aviso-imagem"',
    // Mídia: a parte que aparece e o degradê (comeco, fim, cor).
    'name="popup-design-midia-recorte"',
    'id="popup-design-degrade"',
    'id="popup-design-degrade-inicio"',
    'id="popup-design-degrade-fim"',
    'id="popup-design-degrade-cor"',
    // Cartão > Fundo: Cor | Degradê | Imagem (a imagem pelo campo de imagem de sempre: rotulo `${id}-label`).
    'id="popup-design-cartao-fundo"',
    'name="popup-design-cartao-fundo-tipo"',
    "`${id}-cor`",
    "`${id}-de`",
    "`${id}-para`",
    "`${id}-angulo`",
    'id="popup-design-cartao-imagem"',
    'name="popup-design-cartao-imagem-parte"',
    'id="popup-design-cartao-imagem-escurecer"',
    'id="popup-design-cartao-fundo-cor"',
    // Fechar e links: a chave do "Não mostrar de novo".
    'id="popup-design-links-nao-mostrar"'
  ]) {
    assert.ok(telas.includes(pedaco), `as telas tem ${pedaco}`);
  }

  // A imagem do fundo usa o campo de imagem de sempre: o botao da moldura e rotulado por `${id}-label`.
  const campoImagem = await readFile(new URL("../src/components/admin/v2/products/image-field.tsx", import.meta.url), "utf8");
  assert.ok(campoImagem.includes("aria-labelledby={`${id}-label`}"));

  // O editor soma "design" ao FIELD_FOCUS (depois do botao, antes de "Para quem") e resolve o seletor pelo modelo.
  const editorTela = await readFile(new URL("../src/components/admin/v2/communication/notice-editor.tsx", import.meta.url), "utf8");
  const bloco = editorTela.slice(editorTela.indexOf("const FIELD_FOCUS"), editorTela.indexOf("];", editorTela.indexOf("const FIELD_FOCUS")));
  const prefixos = [...bloco.matchAll(/\["([^"]+)",\s*"[^"]+"\]/g)].map((match) => match[1]);
  assert.ok(prefixos.includes("design"));
  assert.ok(prefixos.indexOf("design") > prefixos.indexOf("cta") && prefixos.indexOf("design") < prefixos.indexOf("audience"));
  assert.match(editorTela, /popupDesignFocusSelector\(/);
});

test("foco: o bloco com erro abre a edicao (chaves do bloco e, no botao principal, as do cta)", () => {
  const design = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;
  assert.ok(editor.blockErrorKeys(design.blocks[1], 1).includes("design.blocks.1.lines.1.text"));
  assert.ok(editor.blockErrorKeys(design.blocks[2], 2).includes("design.blocks.2.text"));
  assert.ok(editor.blockErrorKeys(design.blocks[3], 3).includes("cta.href"));
  assert.ok(editor.blockErrorKeys(model.newPopupBlock("button2", "b5"), 4).includes("design.blocks.4.action.href"));
});

/* ------------------------------------------------------------------------------------------------
 * Fontes e pesos
 * ---------------------------------------------------------------------------------------------- */

test("pesos: cada fonte mostra os pesos que tem; trocar a fonte ajusta o peso; a enviada comeca no peso dela", () => {
  assert.deepEqual(
    editor.weightOptionsFor({ key: "exo2", kind: "builtin" }).map((option) => option.label),
    ["Média (500)", "Seminegrito (600)", "Negrito (700)"]
  );
  assert.deepEqual(
    editor.weightOptionsFor({ key: "inter", kind: "builtin" }).map((option) => option.label),
    ["Fina (100)", "Extra leve (200)", "Leve (300)", "Normal (400)", "Média (500)", "Seminegrito (600)", "Negrito (700)", "Extra negrito (800)", "Black (900)"]
  );
  assert.equal(editor.weightOptionsFor({ id: FONT_ID, kind: "uploaded" }).length, 9);
  assert.deepEqual(
    editor.weightOptionsFor({ key: "serif", kind: "builtin" }).map((option) => option.value),
    ["400", "700"]
  );

  const biblioteca = [{ createdAt: "", family: "bf_0123456789ab", format: "woff2", id: FONT_ID, name: "Minha fonte", sizeBytes: 53_248, style: "normal", url: "", weight: 600 }];
  assert.equal(editor.weightAfterFontChange({ key: "exo2", kind: "builtin" }, 800, biblioteca), 700);
  assert.equal(editor.weightAfterFontChange({ key: "exo2", kind: "builtin" }, 400, biblioteca), 500);
  assert.equal(editor.weightAfterFontChange({ key: "inter", kind: "builtin" }, 300, biblioteca), 300);
  assert.equal(editor.weightAfterFontChange({ id: FONT_ID, kind: "uploaded" }, 400, biblioteca), 600);

  assert.equal(editor.popupFontLabel({ key: "condensed", kind: "builtin" }, biblioteca), "Condensada");
  assert.equal(editor.popupFontLabel({ id: FONT_ID, kind: "uploaded" }, biblioteca), "Minha fonte");
  assert.equal(editor.popupFontLabel({ id: "7a2d3e4f-9e66-4a4b-8b2c-1d3e4f5a6b7c", kind: "uploaded" }, biblioteca), "Fonte que saiu da biblioteca");
  assert.deepEqual(editor.fontRefFromValue(editor.fontRefValue({ id: FONT_ID, kind: "uploaded" })), { id: FONT_ID, kind: "uploaded" });
  assert.deepEqual(editor.fontRefFromValue("builtin:exo2"), { key: "exo2", kind: "builtin" });
  assert.equal(editor.fontRefFromValue("builtin:comic"), null);
  assert.equal(editor.describeFontOption(biblioteca[0]), "Seminegrito (600) · Normal · 52 KB");
  assert.deepEqual(
    editor.sortedFontLibrary([{ ...biblioteca[0], id: "b", name: "Zeta" }, { ...biblioteca[0], id: "a", name: "Alfa" }, { ...biblioteca[0], id: "b", name: "Zeta" }]).map((font) => font.name),
    ["Alfa", "Zeta"]
  );
});

/* ------------------------------------------------------------------------------------------------
 * Conferencia antes de enviar e numeros
 * ---------------------------------------------------------------------------------------------- */

test("video e fonte: tipo e tamanho conferidos no navegador, com as frases do servidor", () => {
  assert.equal(editor.videoFileProblem({ size: 1_000, type: "video/mp4" }), null);
  assert.equal(editor.videoFileProblem({ size: 1_000, type: "video/webm" }), null);
  assert.equal(editor.videoFileProblem({ size: 1_000, type: "video/quicktime" }), "Use um vídeo MP4 (H.264) ou WEBM.");
  assert.equal(editor.videoFileProblem({ size: 15 * 1024 * 1024 + 1, type: "video/mp4" }), "O vídeo deve ter no máximo 15 MB.");
  assert.equal(editor.videoFileProblem({ size: 0, type: "video/mp4" }), "O vídeo deve ter no máximo 15 MB.");
  assert.equal(editor.videoDurationHint(8), null);
  assert.equal(editor.videoDurationHint(40), "Vídeos curtos (até 15 segundos) ficam mais leves e combinam com a repetição.");

  assert.equal(editor.fontFileProblem(null), "Escolha um arquivo de fonte.");
  assert.equal(editor.fontFileProblem({ name: "Minha-Fonte.WOFF2", size: 40_000 }), null);
  assert.equal(editor.fontFileProblem({ name: "fonte.ttc", size: 40_000 }), "Use uma fonte WOFF2, WOFF, TTF ou OTF.");
  assert.equal(editor.fontFileProblem({ name: "fonte.otf", size: 2 * 1024 * 1024 + 1 }), "A fonte deve ter no máximo 2 MB.");
  assert.equal(editor.fontNameFromFile("C:\\fontes\\Space_Grotesk-Bold.ttf"), "Space Grotesk Bold");
});

test("numeros: so o valor dentro do limite vale (o mesmo texto do zod no limite)", () => {
  assert.equal(editor.parseBoundedNumber("16", { integer: true, max: 96, min: 10 }), 16);
  assert.equal(editor.parseBoundedNumber("1", { integer: true, max: 96, min: 10 }), null, "digitando: ainda fora do limite");
  assert.equal(editor.parseBoundedNumber("12.5", { integer: true, max: 96, min: 10 }), null);
  assert.equal(editor.parseBoundedNumber("1,25", { max: 2, min: 0.8 }), 1.25);
  assert.equal(editor.parseBoundedNumber("-0,05", { max: 0.5, min: -0.1 }), -0.05);
  assert.equal(editor.parseBoundedNumber("", { max: 2, min: 0.8 }), null);
  assert.equal(editor.parseBoundedNumber("abc", { max: 2, min: 0.8 }), null);
  assert.equal(editor.rangeMessage(0.8, 2), "Use de 0,8 a 2.");
  assert.equal(editor.clampNumber(120, 10, 96), 96);

  const design = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;
  const zod = designSchema.popupDesignSchema.safeParse({ ...design, blocks: [{ ...design.blocks[0], style: { ...design.blocks[0].style, lineHeight: 3 } }, ...design.blocks.slice(1)] });
  assert.equal(zod.success, false);
  assert.equal(zod.error.issues[0].message, editor.rangeMessage(0.8, 2), "a frase da tela e a do zod");
});

/* ------------------------------------------------------------------------------------------------
 * Degradê da mídia: "Começa a escurecer em" e "Fica totalmente escuro em" <-> { end, height }
 * ---------------------------------------------------------------------------------------------- */

test("degradê: comeco e fim na tela viram { end, height = fim - comeco } e voltam iguais", () => {
  assert.deepEqual(editor.FADE_START_LIMITS, { max: 90, min: 0 });
  assert.deepEqual(editor.FADE_END_LIMITS, { max: 100, min: 20 });

  // O design salvo antes (sem `end` = 100): 75 % de altura = escurece de 25 % ate o fim, como antes.
  assert.deepEqual(editor.fadeRangeOf({ end: 100, height: 75 }), { end: 100, start: 25 });
  assert.deepEqual(editor.fadeRangeOf({ end: 100, height: 100 }), { end: 100, start: 0 });
  assert.deepEqual(editor.fadeRangeOf({ end: 40, height: 75 }), { end: 40, start: 0 }, "nunca acima do topo");

  // A configuracao do produtor so subindo o escuro: de 35 % a 70 %.
  assert.deepEqual(editor.fadeFromRange({ end: 70, start: 35 }), { end: 70, height: 35 });
  assert.deepEqual(editor.fadeFromRange({ end: 100, start: 0 }), { end: 100, height: 100 });

  // Ida e volta para todo comeco e fim validos (comeco pelo menos 10 % antes do fim).
  for (let end = 20; end <= 100; end += 5) {
    for (let start = 0; start <= Math.min(90, end - 10); start += 5) {
      const span = editor.fadeFromRange({ end, start });
      assert.ok(span.height >= 10 && span.height <= 100 && span.end === end, `${start}-${end}`);
      assert.deepEqual(editor.fadeRangeOf(span), { end, start }, `${start}-${end}`);
    }
  }

  // Fora do limite: o mais perto que vale (inteiro, comeco < fim com 10 % de passagem).
  assert.deepEqual(editor.fadeFromRange({ end: 150, start: -20 }), { end: 100, height: 100 });
  assert.deepEqual(editor.fadeFromRange({ end: 5, start: 0 }), { end: 20, height: 20 });
  assert.deepEqual(editor.fadeFromRange({ end: 50, start: 48 }), { end: 50, height: 10 });
  assert.deepEqual(editor.fadeFromRange({ end: 70.4, start: 34.6 }), { end: 70, height: 35 });
});

test("degradê: mudar o comeco ou o fim mexe so nele; passar do outro empurra o outro junto (10 % de passagem)", () => {
  const fade = { color: "auto", enabled: true, end: 100, height: 75 };

  // Subir o escuro como o produtor quer: comeco 35, fim 70.
  const comFim = editor.withFadeEnd(fade, 70);
  assert.deepEqual(comFim, { color: "auto", enabled: true, end: 70, height: 45 }, "o comeco (25 %) fica");
  const subido = editor.withFadeStart(comFim, 35);
  assert.deepEqual(subido, { color: "auto", enabled: true, end: 70, height: 35 });
  assert.deepEqual(editor.fadeRangeOf(subido), { end: 70, start: 35 });

  // O comeco passando do fim empurra o fim para baixo; o fim subindo acima do comeco puxa o comeco para cima.
  assert.deepEqual(editor.fadeRangeOf(editor.withFadeStart(subido, 80)), { end: 90, start: 80 });
  assert.deepEqual(editor.fadeRangeOf(editor.withFadeStart(subido, 95)), { end: 100, start: 90 }, "comeco no maximo 90");
  assert.deepEqual(editor.fadeRangeOf(editor.withFadeEnd(subido, 40)), { end: 40, start: 30 });
  assert.deepEqual(editor.fadeRangeOf(editor.withFadeEnd(subido, 10)), { end: 20, start: 10 }, "fim no minimo 20");

  // O resultado sempre passa no zod do design.
  const design = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;
  for (const next of [comFim, subido, editor.withFadeStart(subido, 95), editor.withFadeEnd(subido, 10), editor.withFadeStart(fade, 0)]) {
    assert.equal(designSchema.popupDesignSchema.safeParse({ ...design, media: { ...design.media, fade: next } }).success, true, JSON.stringify(next));
  }
});

test("fundo do cartão: Cor | Degradê | Imagem levam a cor junto; a imagem vazia pede envio; a ultima imagem volta", () => {
  assert.deepEqual(
    editor.CARD_BACKGROUND_KIND_OPTIONS.map((option) => option.label),
    ["Cor", "Degradê", "Imagem"]
  );

  const cor = { color: "#16181c", kind: "solid" };
  const imagemVazia = editor.cardBackgroundOfKind("image", cor, null);
  assert.deepEqual(imagemVazia, { color: "#16181c", dim: 40, kind: "image", position: "bottom", url: "" }, "a cor vira a cor de apoio, embaixo");
  assert.deepEqual(editor.cardBackgroundOfKind("solid", imagemVazia, null), cor, "e volta");
  assert.deepEqual(editor.cardBackgroundOfKind("gradient", imagemVazia, null), { angle: 90, from: "#16181c", kind: "gradient", to: "#a78bfa" });
  assert.deepEqual(editor.cardBackgroundOfKind("solid", { angle: 90, from: "#2a1a5e", kind: "gradient", to: "#0b0b12" }, null), { color: "#2a1a5e", kind: "solid" });
  assert.equal(editor.cardBackgroundOfKind("solid", cor, null), cor, "o mesmo tipo nao muda nada");

  // A imagem que ja foi escolhida volta (com a cor de agora como apoio), sem enviar de novo.
  const url = `${ORIGIN}/storage/v1/object/public/content-assets/communications/images/0123456789abcdef01234567.webp`;
  const escolhida = { color: "#000000", dim: 55, kind: "image", position: "bottom", url };
  assert.deepEqual(editor.cardBackgroundOfKind("image", { color: "#202020", kind: "solid" }, escolhida), { ...escolhida, color: "#202020" });

  // O zod: a imagem nossa passa; vazia ou de fora, nao (o editor leva o erro ao campo da imagem do fundo).
  const design = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;
  const comFundo = (background) => designSchema.popupDesignSchema.safeParse({ ...design, card: { ...design.card, background } }).success;
  assert.equal(comFundo(escolhida), true);
  assert.equal(comFundo(imagemVazia), false);
  assert.equal(comFundo({ ...escolhida, url: "https://exemplo.com/communications/images/0123456789abcdef01234567.webp" }), false);
  assert.equal(comFundo({ ...escolhida, dim: 81 }), false, "escurecer ate 80 %");
});

test("comparacao: o mesmo design com cor maiuscula e texto com espaco conta como igual", () => {
  const design = editor.applyStarter({ audio: null, cta: CTA }, "media_top_fade", null).design;
  const mexido = { ...design, links: { color: design.links.color.toUpperCase() } };
  assert.equal(editor.sameDesign(design, mexido), true);
  assert.equal(editor.sameDesign(design, null), false);
  assert.equal(editor.sameDesign(null, undefined), true);
});

/* ------------------------------------------------------------------------------------------------
 * Vocabulario
 * ---------------------------------------------------------------------------------------------- */

/**
 * O codigo sem os nomes que dizem "template" (docs/28 §5.8): identificadores (`TemplateNameDialog`, `templateMode`,
 * `saveTemplate`, a prop `templates` declarada, desestruturada ou passada) e os caminhos de import. O texto do JSX, as
 * strings e os comentarios ficam: ali "template" continua proibido.
 */
function semNomesDeCodigo(fonte) {
  return fonte
    .replace(/(?:from\s+|import\()\s*["'][^"']*["']/g, "")
    .replace(/[\w$]*(?:Template|TEMPLATE)[\w$]*|\btemplate[A-Z][\w$]*/g, "")
    .replace(/\btemplates(?=\??:|\s*=[^=>]|\?\.|\.[a-zA-Z])/g, "");
}

test("vocabulario: nomes de codigo com template saem da conferencia; o texto da tela nao", () => {
  assert.equal(semNomesDeCodigo('import { saveTemplate } from "@/server/communications/template-actions";').includes("emplate"), false);
  assert.equal(semNomesDeCodigo("  templates?: { onApplied } | null;\n  templates: mine = null\n  templates={mine}").includes("emplate"), false);
  assert.equal(semNomesDeCodigo("<TemplateNameDialog templateMode={x} />").includes("emplate"), false);
  assert.ok(semNomesDeCodigo("<p>Meus templates</p>").includes("templates"), "texto no JSX continua conferido");
  assert.ok(semNomesDeCodigo('label="Usar template"').includes("template"), "strings continuam conferidas");
  assert.ok(semNomesDeCodigo("// escolha um template").includes("template"), "comentarios continuam conferidos");
});

test("vocabulario: os textos do card Design nao usam palavra fora do vocabulario da equipe", async () => {
  const textos = collectStrings([
    editor.POPUP_DESIGN_COPY,
    editor.DESIGN_MODE_OPTIONS,
    editor.MEDIA_KIND_OPTIONS,
    editor.MEDIA_ASPECT_OPTIONS,
    editor.MEDIA_POSITION_OPTIONS,
    editor.TEXT_PLACEMENT_OPTIONS,
    editor.TEXT_ALIGN_OPTIONS,
    editor.CARD_WIDTH_OPTIONS,
    editor.CARD_SHADOW_OPTIONS,
    editor.BUTTON_SIZE_OPTIONS,
    editor.BUTTON_WIDTH_OPTIONS,
    editor.BUTTON2_ACTION_OPTIONS,
    editor.LINK_TARGET_OPTIONS,
    editor.FONT_STYLE_OPTIONS,
    editor.PAINT_KIND_OPTIONS,
    editor.CARD_BACKGROUND_KIND_OPTIONS,
    editor.LINE_PAINT_OPTIONS,
    editor.LINE_SIZE_OPTIONS,
    editor.BLOCK_TYPE_LABELS,
    editor.FONT_WEIGHT_LABELS,
    editor.DESIGN_STARTER_OPTIONS,
    editor.FREE_STARTER_OPTIONS
  ]);

  assert.ok(textos.length > 150);

  for (const texto of textos) {
    for (const palavra of PROIBIDAS) {
      assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
    }
  }

  // Os textos do §7.2, palavra por palavra.
  assert.equal(
    editor.POPUP_DESIGN_COPY.card.description,
    "Escolha o visual do pop-up. O Padrão é o de sempre; no Personalizado você monta por seções; no Livre você monta do zero, elemento por elemento."
  );
  // Livre (docs/27 §4.1), palavra por palavra.
  assert.equal(
    editor.POPUP_DESIGN_COPY.modes.free.description,
    "Monte do zero, como num editor de páginas: coloque cada elemento onde quiser, um por cima do outro, com o estilo que quiser."
  );
  assert.equal(editor.POPUP_DESIGN_COPY.free.starters.hint, "Escolha um ponto de partida. No editor, tudo pode ser mudado.");
  assert.equal(editor.POPUP_DESIGN_COPY.free.open, "Abrir editor Livre");
  assert.equal(editor.POPUP_DESIGN_COPY.free.confirm.description, "O design Livre atual será trocado pelo modelo. Dá para desfazer no editor.");
  assert.equal(editor.POPUP_DESIGN_COPY.free.smallScreen, "O editor Livre precisa de uma tela maior (a partir de 1.024 px de largura). Aqui você vê a prévia.");
  assert.equal(editor.POPUP_DESIGN_COPY.video.hint, "MP4 (H.264) ou WEBM, até 15 MB. Toca sem som, em repetição. Quem prefere menos movimento vê só a imagem.");
  assert.equal(editor.POPUP_DESIGN_COPY.fonts.hint, "Quer uma fonte do Google Fonts? Baixe o arquivo no site e envie aqui. Nada é carregado do Google na hora.");
  assert.equal(editor.POPUP_DESIGN_COPY.content.titleHint, "Aparece nas listas e nos relatórios. Para o aluno, vale o título do design.");

  // Degradê: comeco e fim (nunca mais "Altura do degradê"); o antigo "Recorte" diz que e so o enquadramento.
  assert.equal(editor.POPUP_DESIGN_COPY.media.fadeStart, "Começa a escurecer em");
  assert.equal(editor.POPUP_DESIGN_COPY.media.fadeEnd, "Fica totalmente escuro em");
  assert.match(editor.POPUP_DESIGN_COPY.media.fadeHint, /Suba o escuro para o texto ficar na parte escura\./);
  assert.equal(editor.POPUP_DESIGN_COPY.media.position, "Parte da mídia que aparece");
  assert.match(editor.POPUP_DESIGN_COPY.media.positionHint, /não o degradê/);
  assert.equal("fadeHeight" in editor.POPUP_DESIGN_COPY.media, false);
  assert.ok(!textos.some((texto) => /\bRecorte\b/.test(texto)), "nenhum rotulo chama a parte da mídia de Recorte");
  assert.equal(editor.POPUP_DESIGN_COPY.cardSection.backgroundImageDim, "Escurecer a imagem");
  assert.equal(editor.POPUP_DESIGN_COPY.cardSection.backgroundImagePosition, "Onde a imagem fica");

  // Fechar e links: a chave do "Não mostrar de novo" e a dica (so com a chave desligada) que diz o custo.
  assert.equal(editor.POPUP_DESIGN_COPY.close.showDismiss, "Mostrar o link “Não mostrar de novo”");
  assert.equal(editor.POPUP_DESIGN_COPY.close.showDismissOff, "Sem o link, o aluno só fecha no X. Num pop-up que repete sem parar, ele não tem como deixar de vê-lo.");

  // As telas do editor tambem (o texto escrito direto no JSX).
  const pasta = new URL("../src/components/admin/v2/communication/popup-design/", import.meta.url);

  for (const arquivo of (await readdir(pasta)).filter((file) => file.endsWith(".tsx"))) {
    const fonte = await readFile(new URL(arquivo, pasta), "utf8");

    // "trigger" e "home" aparecem em nomes de codigo (SelectTrigger, HOME_PAGE_LINKS); o resto nunca. Desde os Modelos
    // (docs/28 §5.8), "template" tambem e nome de codigo (a prop `templates`, template-actions, TemplateNameDialog):
    // tirados esses nomes e os caminhos de import, "template" nunca aparece (nem no JSX, nem nas strings, nem nos
    // comentarios).
    for (const palavra of PROIBIDAS.filter((item) => item !== "trigger" && item !== "home")) {
      const texto = palavra === "template" ? semNomesDeCodigo(fonte) : fonte;

      assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `${arquivo} usa "${palavra}"`);
    }
  }
});
