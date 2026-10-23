import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Design do pop-up (docs/26; docs/18 §1.1): o modelo puro (tipos, modelos para comecar, forma canonica,
// contraste, escala), o schema zod (salvar e ler) e o caminho do rascunho ao banco e de volta (schemas, store,
// view model). O que o aluno ve e o editor ficam nos testes dos pacotes S e A.

const model = await import("../src/server/communications/popup-design-model.ts");
const schema = await import("../src/server/communications/popup-design-schema.ts");
const schemas = await import("../src/server/communications/schemas.ts");
const store = await import("../src/server/communications/store.ts");
const fonts = await import("../src/server/communications/popup-fonts.ts");
const viewModel = await import("../src/components/admin/v2/communication/notices-view-model.ts");

const ORIGIN = "http://127.0.0.1:55321";
const VIDEO_PATH = "videos/0b7c7f3e-2d1a-4c55-9a4e-5f1f7b2c9d10.mp4";
const VIDEO_URL = `${ORIGIN}/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}`;
const FONT_A = "6f1c2c9e-8d55-4f3a-9a1b-0c2d3e4f5a6b";
const FONT_B = "7a2d3e4f-9e66-4a4b-8b2c-1d3e4f5a6b7c";

/** Cliente de servico falso: so o endereco publico do Storage (getPublicUrl so monta o texto). */
const fakeDb = {
  storage: {
    from: (bucket) => ({ getPublicUrl: (path) => ({ data: { publicUrl: `${ORIGIN}/storage/v1/object/public/${bucket}/${path}` } }) })
  }
};

function starter(id = "media_top_fade", input = {}) {
  return structuredClone(model.popupStarterDesign(id, input));
}

function popupDraft(overrides = {}) {
  return {
    ...schemas.emptyNoticeDraft("popup"),
    cta: { href: "/minhas-compras", label: "Quero ver", target: "same_tab" },
    image: { alt: "", url: `${ORIGIN}/storage/v1/object/public/content-assets/communications/images/capa.webp` },
    title: "Aula nova",
    ...overrides
  };
}

function issuesOf(result) {
  return result.success ? [] : result.error.issues.map((issue) => ({ message: issue.message, path: issue.path.join(".") }));
}

/** Linha do banco a partir das colunas (o resto com valores neutros). */
function linhaDe(columns, extra = {}) {
  return {
    ...columns,
    approved_at: null,
    approved_by: null,
    audience_count: null,
    audience_counted_at: null,
    audience_refreshed_at: null,
    created_at: "2026-10-22T15:00:00.000Z",
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
    updated_at: "2026-10-22T15:00:00.000Z",
    updated_by: null,
    ...extra
  };
}

/* ------------------------------------------------------------------------------------------------
 * Modelos para comecar e forma canonica
 * ---------------------------------------------------------------------------------------------- */

test("os modelos para comecar valem no schema, ja estao na forma canonica e passam no contraste", () => {
  assert.ok(model.POPUP_DESIGN_STARTERS.length >= 2);
  assert.deepEqual(
    model.POPUP_DESIGN_STARTERS.map((item) => item.label),
    ["Mídia no topo com degradê", "Só texto", "Texto sobre a mídia"]
  );

  for (const { id } of model.POPUP_DESIGN_STARTERS) {
    for (const hasAudio of [false, true]) {
      const design = starter(id, { hasAudio });
      const parsed = schema.popupDesignSchema.safeParse(design);

      assert.equal(parsed.success, true, `${id}: ${JSON.stringify(issuesOf(parsed))}`);
      assert.deepEqual(parsed.data, design, `${id} ja canonico`);
      assert.deepEqual(model.popupDesignContrastHints(design), [], `${id} sem dica de contraste`);
      assert.equal(design.blocks.some((block) => block.type === "audio"), hasAudio, `${id}: bloco Áudio so com audio`);
      assert.equal(design.blocks.filter((block) => block.type === "button").length, 1, `${id}: o botao principal vem junto`);
    }
  }

  const reference = starter("media_top_fade");
  assert.equal(reference.media.kind, "image", "sem video escolhido, a midia e a imagem do aviso");
  assert.equal(reference.media.fade.enabled, true);
  assert.deepEqual(reference.media.fade, { color: "auto", enabled: true, end: 92, height: 42 }, "escurece no meio: de 50 % a 92 % da midia");
  assert.equal(reference.text.overlap, 34, "o selo fica sobre a passagem; titulo, texto e botao no escuro");
  assert.equal(reference.text.placement, "below");
  assert.ok(reference.text.overlap > 0, "o selo sobe por cima do degrade");
  assert.deepEqual(
    reference.blocks.map((block) => block.type),
    ["badge", "heading", "text", "button"]
  );
  const heading = reference.blocks[1];
  assert.equal(heading.lines.length, 2);
  assert.notDeepEqual(heading.lines[0].paint, null, "a primeira linha tem cor propria");
  assert.equal(heading.style.uppercase, true);

  const video = { mimeType: "video/mp4", path: VIDEO_PATH, url: VIDEO_URL };
  assert.deepEqual(starter("media_top_fade", { video }).media, { ...reference.media, kind: "video", video }, "o video escolhido fica");
  assert.equal(starter("text_only").media.kind, "none");
});

test("forma canonica: cores minusculas, textos aparados, numeros arredondados e as fontes recalculadas dos blocos", () => {
  const design = starter("text_only");
  design.card.background = { color: "#ABCDEF", kind: "solid" };
  design.blocks[1].lines[0].text = "  Título  ";
  design.blocks[1].style.lineHeight = 1.23456;
  design.blocks[1].style.font = { id: FONT_B.toUpperCase(), kind: "uploaded" };
  design.blocks[2].style.font = { id: FONT_A, kind: "uploaded" };
  design.blocks[3].style.font = { id: FONT_B, kind: "uploaded" };
  design.fonts = ["lixo"];

  const canonical = model.canonicalPopupDesign(design);

  assert.deepEqual(canonical.card.background, { color: "#abcdef", kind: "solid" });
  assert.equal(canonical.blocks[1].lines[0].text, "Título");
  assert.equal(canonical.blocks[1].style.lineHeight, 1.23);
  assert.deepEqual(canonical.fonts, [FONT_A, FONT_B].sort(), "sem repeticao, minusculas e ordenadas");
  assert.deepEqual(model.canonicalPopupDesign(canonical), canonical, "idempotente");
});

/* ------------------------------------------------------------------------------------------------
 * Schema: o que entra e o que e recusado
 * ---------------------------------------------------------------------------------------------- */

test("schema recusa chave a mais, cor fora do formato, numero fora do limite, tipo de bloco desconhecido e outra versao", () => {
  const cases = [
    ["chave a mais no cartao", (design) => (design.card.css = "color:red"), "card"],
    ["chave a mais no bloco", (design) => (design.blocks[0].html = "<b>oi</b>"), "blocks.0"],
    ["cor com nome", (design) => (design.card.background = { color: "red", kind: "solid" }), "card.background.color"],
    ["cor curta", (design) => (design.links.color = "#fff"), "links.color"],
    ["fonte grande demais", (design) => (design.blocks[1].style.size = 97), "blocks.1.style.size"],
    ["fonte quebrada", (design) => (design.blocks[1].style.size = 20.5), "blocks.1.style.size"],
    ["peso fora da lista", (design) => (design.blocks[1].style.weight = 450), "blocks.1.style.weight"],
    ["altura de linha fora", (design) => (design.blocks[2].style.lineHeight = 3), "blocks.2.style.lineHeight"],
    ["respiro fora", (design) => (design.card.padding = 4), "card.padding"],
    ["degrade de angulo fora", (design) => (design.card.background = { angle: 400, from: "#000000", kind: "gradient", to: "#ffffff" }), "card.background.angle"],
    ["bloco desconhecido", (design) => design.blocks.push({ id: "zz", type: "poll" }), "blocks.4"],
    ["fonte pronta desconhecida", (design) => (design.blocks[1].style.font = { key: "comic", kind: "builtin" }), "blocks.1.style.font.key"],
    ["versao 2", (design) => (design.version = 2), "version"],
    ["cinco linhas no titulo", (design) => (design.blocks[1].lines = Array.from({ length: 5 }, () => ({ paint: null, size: null, text: "A" }))), "blocks.1.lines"],
    ["linha vazia", (design) => (design.blocks[1].lines[0].text = "   "), "blocks.1.lines.0.text"],
    ["texto longo", (design) => (design.blocks[2].text = "a".repeat(301)), "blocks.2.text"],
    ["sem blocos", (design) => (design.blocks = []), "blocks"],
    ["treze blocos", (design) => (design.blocks = Array.from({ length: 13 }, (_, index) => ({ height: 8, id: `s${index}`, type: "spacer" }))), "blocks"],
    ["id repetido", (design) => (design.blocks[2].id = design.blocks[1].id), "blocks.2.id"],
    ["id fora do formato", (design) => (design.blocks[2].id = "Bloco 1"), "blocks.2.id"],
    ["dois botoes principais", (design) => design.blocks.push({ ...design.blocks[3], id: "b8" }), "blocks.4"],
    ["link perigoso no segundo botao", (design) => design.blocks.push({ ...model.newPopupBlock("button2", "b8"), action: { href: "javascript:alert(1)", kind: "link", target: "same_tab" } }), "blocks.4.action.href"],
    ["video sem o arquivo", (design) => (design.media.kind = "video"), "media.video"]
  ];

  for (const [label, change, path] of cases) {
    const design = starter("text_only");
    change(design);
    const result = schema.popupDesignSchema.safeParse(design);

    assert.equal(result.success, false, label);
    assert.ok(
      issuesOf(result).some((issue) => issue.path === path || issue.path.startsWith(`${path}.`)),
      `${label}: esperava erro em ${path}, veio ${JSON.stringify(issuesOf(result))}`
    );
    assert.equal(schema.parsePopupDesign(design), null, `${label}: na leitura vira Padrão`);
  }
});

test("schema: ate 4 fontes enviadas diferentes; mais que isso recusa em fonts", () => {
  const design = starter("text_only");
  const ids = Array.from({ length: 5 }, (_, index) => `0000000${index}-0000-4000-8000-000000000000`);
  design.blocks = ids.map((id, index) => ({ id: `t${index}`, style: { ...design.blocks[2].style, font: { id, kind: "uploaded" } }, text: "Oi", type: "text" }));
  assert.deepEqual(issuesOf(schema.popupDesignSchema.safeParse(design)).map((issue) => issue.path), ["fonts"]);

  design.blocks = design.blocks.slice(0, 4);
  const parsed = schema.popupDesignSchema.parse(design);
  assert.equal(parsed.fonts.length, 4);
});

test("video: so o objeto do nosso bucket publico, caminho videos/<uuid>, extensao igual ao tipo", () => {
  const good = { mimeType: "video/mp4", path: VIDEO_PATH, url: VIDEO_URL };
  const accept = (video) => schema.popupDesignSchema.safeParse({ ...starter(), media: { ...starter().media, kind: "video", video } }).success;

  assert.equal(accept(good), true);
  assert.equal(accept({ ...good, url: `https://exemplo.supabase.co/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}` }), true, "a origem e conferida no servidor");
  assert.equal(accept({ ...good, url: `${ORIGIN}/storage/v1/object/public/content-assets/${VIDEO_PATH}` }), false, "outro bucket");
  assert.equal(accept({ ...good, url: `https://cdn.exemplo.com/${VIDEO_PATH}` }), false, "fora do Storage");
  assert.equal(accept({ ...good, url: `http://exemplo.com/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}` }), false, "http fora da maquina");
  assert.equal(accept({ ...good, url: `${VIDEO_URL}?download=1` }), false, "com query");
  assert.equal(accept({ ...good, mimeType: "video/webm" }), false, "extensao diferente do tipo");
  assert.equal(accept({ ...good, path: "videos/../segredo.mp4" }), false, "caminho fora do formato");
  assert.equal(accept({ ...good, mimeType: "video/quicktime" }), false);

  assert.equal(model.isOwnStorageUrl(VIDEO_URL, { bucket: model.POPUP_VIDEO_BUCKET, objectPath: VIDEO_PATH, origin: ORIGIN }), true);
  assert.equal(model.isOwnStorageUrl(VIDEO_URL, { bucket: model.POPUP_VIDEO_BUCKET, objectPath: VIDEO_PATH, origin: "https://outro.supabase.co" }), false);
});

test("parsePopupDesign: nulo, invalido ou de outra versao = Padrão (null); valido volta canonico", () => {
  assert.equal(schema.parsePopupDesign(null), null);
  assert.equal(schema.parsePopupDesign(undefined), null);
  assert.equal(schema.parsePopupDesign("design"), null);
  assert.equal(schema.parsePopupDesign({ version: 1 }), null);

  const design = starter();
  design.links.color = "#A1A1AA";
  assert.equal(schema.parsePopupDesign(design).links.color, "#a1a1aa");
});

test("links.showDismiss: sem a chave le true (design salvo antes); false vai e volta; a forma canonica sempre tem a chave; so booleano", () => {
  assert.equal(model.POPUP_SHOW_DISMISS_DEFAULT, true);

  const semChave = starter();
  delete semChave.links.showDismiss;
  assert.equal("showDismiss" in semChave.links, false);
  assert.deepEqual(schema.parsePopupDesign(semChave).links, { color: "#a1a1aa", showDismiss: true }, "sem a chave = o link aparece, como antes");
  assert.deepEqual(model.canonicalPopupDesign(semChave).links, { color: "#a1a1aa", showDismiss: true }, "a forma canonica inclui a chave");
  assert.deepEqual({ ...schema.parsePopupDesign(semChave), links: semChave.links }, semChave, "so a chave entra; o resto fica igual");

  const semLink = starter();
  semLink.links.showDismiss = false;
  assert.deepEqual(schema.parsePopupDesign(semLink).links, { color: "#a1a1aa", showDismiss: false });
  assert.equal(model.canonicalPopupDesign(semLink).links.showDismiss, false);
  assert.equal(schemas.noticeDraftSchema.parse(popupDraft({ design: semLink })).design.links.showDismiss, false, "o rascunho do pop-up leva a chave");

  for (const [label, links, path, message] of [
    ["texto no lugar do booleano", { color: "#a1a1aa", showDismiss: "não" }, "links.showDismiss", schema.POPUP_DESIGN_MESSAGES.showDismiss],
    ["chave a mais nos links", { color: "#a1a1aa", hide: true, showDismiss: true }, "links", null]
  ]) {
    const design = starter();
    design.links = links;
    const result = schema.popupDesignSchema.safeParse(design);

    assert.equal(result.success, false, label);
    assert.ok(
      issuesOf(result).some((issue) => (issue.path === path || issue.path.startsWith(`${path}.`)) && (message === null || issue.message === message)),
      `${label}: esperava erro em ${path}, veio ${JSON.stringify(issuesOf(result))}`
    );
    assert.equal(schema.parsePopupDesign(design), null, `${label}: na leitura vira Padrão`);
  }

  // Os modelos para comecar mostram o link (o de sempre); so a equipe tira.
  for (const { id } of model.POPUP_DESIGN_STARTERS) {
    assert.equal(starter(id).links.showDismiss, true, id);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Rascunho do aviso: o design e o conteudo andam juntos
 * ---------------------------------------------------------------------------------------------- */

test("rascunho do pop-up: Padrão (null), sem a chave e Personalizado valem; o design volta canonico", () => {
  assert.equal(schemas.emptyNoticeDraft("popup").design, null, "o pop-up novo comeca no Padrão");
  assert.equal("design" in schemas.emptyNoticeDraft("inbox"), false, "a notificacao nunca leva a chave");

  assert.equal(schemas.noticeDraftSchema.safeParse(popupDraft()).success, true);
  const semChave = popupDraft();
  delete semChave.design;
  assert.equal(schemas.noticeDraftSchema.safeParse(semChave).success, true);

  const design = starter();
  design.card.border.color = "#FFFFFF1A";
  const parsed = schemas.noticeDraftSchema.parse(popupDraft({ design }));
  assert.equal(parsed.design.card.border.color, "#ffffff1a");
});

test("a notificacao do sino nunca tem design: a chave sai antes de validar", () => {
  const draft = { ...schemas.emptyNoticeDraft("inbox"), design: starter(), title: "Oi" };
  const parsed = schemas.noticeDraftSchema.parse(draft);

  assert.equal("design" in parsed, false);
  assert.equal(store.draftToColumns({ ...draft, design: starter() }).popup_design, null);
});

test("design e conteudo: botao, audio, imagem e o segundo botao Lembrar depois", () => {
  const audio = { durationSeconds: 30, mimeType: "audio/mpeg", peaks: [], url: `${ORIGIN}/storage/v1/object/public/communication-audio/campaigns/a.mp3` };
  const cases = [
    ["botao sem o bloco", popupDraft({ design: { ...starter(), blocks: starter().blocks.filter((block) => block.type !== "button") } }), "design.blocks", schema.POPUP_DESIGN_MESSAGES.ctaWithoutButton],
    ["bloco do botao sem botao", popupDraft({ cta: null, design: starter() }), "cta.label", schema.POPUP_DESIGN_MESSAGES.buttonWithoutCta],
    ["audio sem o bloco", popupDraft({ audio, design: starter() }), "design.blocks", schema.POPUP_DESIGN_MESSAGES.audioWithoutBlock],
    ["bloco do audio sem audio", popupDraft({ design: starter("media_top_fade", { hasAudio: true }) }), "audio", schema.POPUP_DESIGN_MESSAGES.audioBlockWithoutAudio],
    ["imagem no topo sem imagem", popupDraft({ design: starter(), image: null }), "image", schema.POPUP_DESIGN_MESSAGES.imageForMedia],
    [
      "video sem capa",
      popupDraft({ design: starter("media_top_fade", { video: { mimeType: "video/mp4", path: VIDEO_PATH, url: VIDEO_URL } }), image: null }),
      "image",
      schema.POPUP_DESIGN_MESSAGES.imageForVideo
    ],
    [
      "Lembrar depois desligado",
      popupDraft({ allowSnooze: false, design: { ...starter(), blocks: [...starter().blocks, { ...model.newPopupBlock("button2", "b8"), action: { kind: "snooze" } }] } }),
      "design.blocks.4.action",
      schema.POPUP_DESIGN_MESSAGES.snoozeButtonOff
    ]
  ];

  for (const [label, draft, path, message] of cases) {
    const issues = issuesOf(schemas.noticeDraftSchema.safeParse(draft));

    assert.deepEqual(issues, [{ message, path }], label);
  }

  assert.equal(schemas.noticeDraftSchema.safeParse(popupDraft({ audio, design: starter("media_top_fade", { hasAudio: true }) })).success, true);
  assert.equal(schemas.noticeDraftSchema.safeParse(popupDraft({ design: starter("text_only"), image: null })).success, true, "Só texto nao pede imagem");
});

test("\"Quando o aluno clica no botão\": o segundo botao com link tambem conta como o clique", () => {
  const frequency = { everyMinutes: null, maxPerDay: 2, maxTotal: null, mode: "repeat", stopOn: "click" };
  const popup = { ...schemas.emptyNoticeDraft("popup").popup, frequency };
  const semBotao = { ...starter(), blocks: starter().blocks.filter((block) => block.type !== "button") };
  const comLink = { ...semBotao, blocks: [...semBotao.blocks, { ...model.newPopupBlock("button2", "b8"), action: { href: "/minhas-compras", kind: "link", target: "same_tab" } }] };

  const recusado = issuesOf(schemas.noticeDraftSchema.safeParse(popupDraft({ cta: null, design: semBotao, popup, repeat: "until_action" })));
  assert.deepEqual(recusado.map((issue) => issue.path), ["popup.frequency.stopOn"]);
  assert.equal(schemas.noticeDraftSchema.safeParse(popupDraft({ cta: null, design: comLink, popup, repeat: "until_action" })).success, true);
  assert.equal(model.popupDesignLinkButton(comLink)?.action.href, "/minhas-compras");
  assert.equal(model.popupDesignLinkButton(semBotao), null);
});

/* ------------------------------------------------------------------------------------------------
 * Rascunho -> colunas -> rascunho, view model
 * ---------------------------------------------------------------------------------------------- */

test("store: o design vai para popup_design e volta pelo schema; invalido na linha = Padrão", () => {
  const design = starter();
  const columns = store.draftToColumns(popupDraft({ design }));

  assert.deepEqual(columns.popup_design, design);
  assert.equal(store.draftToColumns(popupDraft()).popup_design, null, "Padrão grava nulo");
  assert.equal(store.draftToColumns(popupDraft({ design: undefined })).popup_design, null, "sem a chave (aviso novo) = Padrão");
  assert.ok(store.CAMPAIGN_COLUMNS.split(",").includes("popup_design"));

  assert.deepEqual(store.rowToDraft(linhaDe(columns)).design, design);
  assert.equal(store.rowToDraft(linhaDe(columns, { popup_design: { version: 2 } })).design, null, "outra versao = Padrão");
  assert.equal(store.rowToDraft(linhaDe(columns, { popup_design: undefined })).design, null, "linha sem a coluna = Padrão");

  const inbox = store.draftToColumns({ ...schemas.emptyNoticeDraft("inbox"), title: "Oi" });
  assert.equal("design" in store.rowToDraft(linhaDe(inbox)), false, "a notificacao continua sem a chave");
});

test("popup-fonts: endereco do video sempre recalculado do caminho; a linha da fonte vira FontFace so no formato", () => {
  const design = starter("media_top_fade", { video: { mimeType: "video/mp4", path: VIDEO_PATH, url: "https://outro.exemplo/x.mp4" } });
  assert.equal(fonts.withOwnStorageUrls(fakeDb, design).media.video.url, VIDEO_URL);
  assert.equal(fonts.withOwnStorageUrls(fakeDb, null), null);

  const row = {
    created_at: "2026-10-22T15:00:00.000Z",
    created_by: null,
    deleted_at: null,
    family_key: "bf_0123456789ab",
    file_path: "fonts/0123456789abcdef01234567.woff2",
    format: "woff2",
    id: FONT_A,
    name: "Minha Fonte",
    size_bytes: 1234,
    style: "normal",
    weight: 700
  };
  assert.deepEqual(fonts.fontRowToFace(fakeDb, row), {
    family: "bf_0123456789ab",
    format: "woff2",
    id: FONT_A,
    style: "normal",
    url: `${ORIGIN}/storage/v1/object/public/communication-fonts/fonts/0123456789abcdef01234567.woff2`,
    weight: 700
  });
  assert.equal(fonts.fontRowToFace(fakeDb, { ...row, family_key: "Minha Fonte; color: red" }), null);
  assert.equal(fonts.fontRowToFace(fakeDb, { ...row, file_path: "../segredo.woff2" }), null);
  assert.equal(fonts.fontRowToFace(fakeDb, { ...row, format: "svg" }), null);
});

test("view model: o pop-up leva o design (null = Padrão), a notificacao nao; a previa monta o PopupItem com as fontes do design", () => {
  const design = starter();
  design.blocks[1].style.font = { id: FONT_A, kind: "uploaded" };
  const canonical = model.canonicalPopupDesign(design);
  const draft = popupDraft({ design: canonical });

  assert.equal(viewModel.noticeDraftForKind({ ...draft, design: undefined }).design, null);
  assert.equal("design" in viewModel.noticeDraftForKind({ ...draft, kind: "inbox" }), false);
  assert.equal(viewModel.isSameNoticeDraft(popupDraft({ design: null }), { ...popupDraft(), design: undefined }), true, "sem a chave = Padrão");
  assert.equal(viewModel.isSameNoticeDraft(popupDraft({ design: canonical }), popupDraft({ design: null })), false);

  const face = { family: "bf_0123456789ab", format: "woff2", id: FONT_A, style: "normal", url: `${ORIGIN}/f.woff2`, weight: 400 };
  const other = { ...face, family: "bf_ba9876543210", id: FONT_B };
  const item = viewModel.draftToPopupItem({ ...draft, allowSnooze: true }, { fonts: [{ ...face, createdAt: "x", name: "A", sizeBytes: 1 }, other] });

  assert.deepEqual(item.design, canonical);
  assert.deepEqual(item.fonts, [face], "so as fontes do design, no formato do show");
  assert.equal("design" in viewModel.draftToPopupItem({ ...popupDraft(), allowSnooze: true }), false, "Padrão: o objeto de antes");
});

/* ------------------------------------------------------------------------------------------------
 * Blocos, sincronia, nome acessivel, fontes
 * ---------------------------------------------------------------------------------------------- */

test("syncPopupDesignBlocks: botao e audio seguem o conteudo do aviso", () => {
  const design = starter("text_only");
  const semBotao = model.syncPopupDesignBlocks(design, { hasAudio: false, hasCta: false });
  assert.equal(semBotao.blocks.some((block) => block.type === "button"), false);

  const comBotao = model.syncPopupDesignBlocks(semBotao, { hasAudio: false, hasCta: true });
  assert.equal(comBotao.blocks.at(-1).type, "button");

  const comAudio = model.syncPopupDesignBlocks(comBotao, { hasAudio: true, hasCta: true });
  assert.deepEqual(
    comAudio.blocks.map((block) => block.type),
    ["badge", "heading", "text", "audio", "button"],
    "o audio entra antes do primeiro botao"
  );
  assert.equal(new Set(comAudio.blocks.map((block) => block.id)).size, comAudio.blocks.length, "ids unicos");
  assert.equal(model.syncPopupDesignBlocks(comAudio, { hasAudio: true, hasCta: true }), comAudio, "nada a mudar = o mesmo objeto");
});

test("nome acessivel: o texto do primeiro titulo; sem titulo, o titulo do aviso", () => {
  const design = starter();
  assert.deepEqual(model.popupDesignAccessibleName(design, "Aula nova"), { label: "Conteúdo novo Já disponível", labelledBy: true });

  const semTitulo = { ...design, blocks: design.blocks.filter((block) => block.type !== "heading") };
  assert.deepEqual(model.popupDesignAccessibleName(semTitulo, "  Aula nova "), { label: "Aula nova", labelledBy: false });
  assert.equal(model.popupDesignDescription(design)?.type, "text");
});

test("fontes: pilha da fonte pronta, da enviada (pela familia resolvida) e o sistema quando falta", () => {
  assert.match(model.fontStackOf({ key: "inter", kind: "builtin" }), /^var\(--font-inter\), /);
  assert.match(model.fontStackOf({ key: "exo2", kind: "builtin" }), /^var\(--font-exo-2\), /);
  assert.equal(model.fontStretchOf({ key: "condensed", kind: "builtin" }), "condensed");
  assert.match(model.fontStackOf({ id: FONT_A, kind: "uploaded" }, [{ family: "bf_0123456789ab", id: FONT_A }]), /^"bf_0123456789ab", system-ui/);
  assert.match(model.fontStackOf({ id: FONT_A, kind: "uploaded" }, []), /^system-ui/, "fonte que falta cai no sistema");
  assert.match(model.fontStackOf({ id: FONT_A, kind: "uploaded" }, [{ family: "x; color:red", id: FONT_A }]), /^system-ui/, "familia fora do formato nunca entra no CSS");
  assert.deepEqual([...model.POPUP_BUILTIN_FONTS.exo2.weights], [500, 600, 700], "so os pesos que o layout carrega");
});

/* ------------------------------------------------------------------------------------------------
 * Contraste e escala
 * ---------------------------------------------------------------------------------------------- */

test("contraste WCAG: razao, texto grande e as dicas que nao impedem salvar", () => {
  assert.equal(Math.round(model.contrastRatio("#ffffff", "#000000")), 21);
  assert.equal(Math.round(model.contrastRatio("#000000", "#000000")), 1);
  assert.ok(Math.abs(model.contrastRatio("#767676", "#ffffff") - 4.54) < 0.02);
  assert.ok(model.contrastRatio("#ffffff80", "#000000") < 21, "transparencia conta");
  assert.equal(model.isLargeText(24, 400), true);
  assert.equal(model.isLargeText(19, 700), true);
  assert.equal(model.isLargeText(19, 600), false);

  const design = starter("text_only");
  design.card.background = { color: "#ffffff", kind: "solid" };
  design.blocks[2].style.paint = { color: "#cccccc", kind: "solid" };
  const hints = model.popupDesignContrastHints(design);
  const text = hints.find((hint) => hint.key === "blocks.2");

  assert.ok(text, JSON.stringify(hints));
  assert.equal(text.blockId, design.blocks[2].id);
  assert.equal(text.required, 4.5);
  assert.match(text.message, /^Contraste baixo \(\d,\d:1\)\. Para ler bem, use pelo menos 4,5:1\.$/);
  assert.ok(hints.some((hint) => hint.key === "blocks.1.lines.0" && hint.required === 3), "titulo grande pede 3:1");
  assert.ok(hints.some((hint) => hint.key === "links"));

  const sobreMidia = starter("media_overlay");
  sobreMidia.media.fade.enabled = false;
  sobreMidia.blocks[1].style.paint = { color: "#101014", kind: "solid" };
  assert.equal(model.popupDesignContrastHints(sobreMidia).some((hint) => hint.key === "blocks.1"), false, "texto sobre a midia sem degrade nao e medido");
});

test("escala: px do cartao em cqw do proprio cartao, com piso de leitura e de toque", () => {
  assert.equal(model.scaledLength(24, 440), "5.4545cqw");
  assert.equal(model.scaledLength(0, 440), "0px");
  assert.equal(model.scaledFontSize(40, 440), "max(12px, 9.0909cqw)");
  assert.equal(model.scaledFontSize(10, 440), "max(10px, 2.2727cqw)", "fonte menor que o piso nunca cresce");
  assert.equal(model.scaledButtonHeight("L", 520), "max(44px, 10cqw)");
  assert.equal(model.scaledButtonHeight("S", 360), "max(36px, 10cqw)");
  assert.equal(model.popupCardOuterWidth({ card: { width: "L" } }), "min(520px, calc(100cqw - 2rem))");
  assert.equal(model.popupCardWidthPx({ card: { width: "S" } }), 360);
  assert.equal(model.paintToCss({ angle: 160, from: "#2a1a5e", kind: "gradient", to: "#0b0b12" }), "linear-gradient(160deg, #2a1a5e, #0b0b12)");
  assert.equal(model.fadeColorOf(starter()), "#16181c", "auto = o fundo do cartao");
  const old = { ...starter(), media: { ...starter().media, fade: { color: "auto", enabled: true, height: 65 } } };
  assert.equal(model.fadeGradientCss(old), "linear-gradient(180deg, #16181c00 0%, #16181c59 45%, #16181cbf 75%, #16181c 100%)", "sem end: o de antes");
  // O modelo escurece de 50 % a 92 %: a camada (de 50 % ate embaixo) chega a cor em 84 % dela.
  assert.equal(model.fadeGradientCss(starter()), "linear-gradient(180deg, #16181c00 0%, #16181c59 37.8%, #16181cbf 63%, #16181c 84%)");
});

/* ------------------------------------------------------------------------------------------------
 * Degrade com comeco e fim ("Começa a escurecer em" / "Fica totalmente escuro em") e imagem no fundo
 * ---------------------------------------------------------------------------------------------- */

/** Um design como o PR do "Design do pop-up" gravou (sem `end`): o do produtor no ambiente de teste. */
function designSemEnd() {
  const design = starter("media_overlay", { video: { mimeType: "video/mp4", path: VIDEO_PATH, url: VIDEO_URL } });
  design.media = { ...design.media, aspect: "4:3", fade: { color: "auto", enabled: true, height: 75 } };
  design.text = { align: "center", gap: 12, overlap: 0, placement: "over-bottom" };
  design.card.background = { color: "#181b1e", kind: "solid" };
  return design;
}

test("degrade: design salvo sem `end` le com end 100 (o mesmo de antes); end de 20 a 100, inteiro; comeco = fim - comprimento", () => {
  const old = designSemEnd();
  assert.equal("end" in old.media.fade, false);

  const parsed = schema.parsePopupDesign(old);
  assert.ok(parsed, "o design antigo continua Personalizado");
  assert.deepEqual(parsed.media.fade, { color: "auto", enabled: true, end: 100, height: 75 });
  assert.deepEqual(parsed, model.canonicalPopupDesign(old), "so o end entra (a forma canonica completa com 100)");
  assert.deepEqual(model.popupFadeSpan(parsed.media.fade), { end: 100, start: 25 });
  assert.deepEqual(model.canonicalPopupDesign(old).media.fade.end, 100, "forma canonica sem end = 100");
  assert.equal(schemas.noticeDraftSchema.parse(popupDraft({ design: old })).design.media.fade.end, 100, "o rascunho antigo tambem");

  for (const [end, ok] of [[20, true], [100, true], [70, true], [19, false], [101, false], [50.5, false], ["70", false], [null, false]]) {
    const design = designSemEnd();
    design.media.fade.end = end;
    const result = schema.popupDesignSchema.safeParse(design);

    assert.equal(result.success, ok, `end ${end}`);
    if (!ok) {
      assert.ok(issuesOf(result).some((issue) => issue.path === "media.fade.end"), JSON.stringify(issuesOf(result)));
    }
  }

  assert.deepEqual(model.popupFadeSpan({ end: 70, height: 35 }), { end: 70, start: 35 });
  assert.deepEqual(model.popupFadeSpan({ end: 45, height: 80 }), { end: 45, start: 0 }, "nunca acima do topo");
  assert.deepEqual(model.popupFadeSpan(starter().media.fade), { end: 92, start: 50 }, "o modelo da referencia escurece no meio");
});

const CARD_IMAGE_PATH = "communications/images/0123456789abcdef01234567.webp";
const CARD_IMAGE_URL = `${ORIGIN}/storage/v1/object/public/content-assets/${CARD_IMAGE_PATH}`;
const cardImage = (overrides = {}) => ({ color: "#16181C", dim: 40, kind: "image", position: "bottom", url: CARD_IMAGE_URL, ...overrides });

test("imagem no fundo do cartao: so a imagem do aviso no nosso bucket (communications/images/<24 hex>.webp)", () => {
  const accept = (background) => schema.popupDesignSchema.safeParse({ ...starter(), card: { ...starter().card, background } });
  const parsed = accept(cardImage({ url: `  ${CARD_IMAGE_URL} ` }));

  assert.equal(parsed.success, true, JSON.stringify(issuesOf(parsed)));
  assert.deepEqual(parsed.data.card.background, { color: "#16181c", dim: 40, kind: "image", position: "bottom", url: CARD_IMAGE_URL }, "canonico");
  assert.equal(accept(cardImage({ url: CARD_IMAGE_URL.replace(ORIGIN, "https://outro.supabase.co") })).success, true, "a origem e trocada pela nossa no servidor");
  assert.equal(accept(cardImage({ url: `http://localhost:54321/storage/v1/object/public/content-assets/${CARD_IMAGE_PATH}` })).success, true, "Supabase local");

  for (const [label, url] of [
    ["outro bucket", `${ORIGIN}/storage/v1/object/public/communication-fonts/${CARD_IMAGE_PATH}`],
    ["outra pasta do bucket", `${ORIGIN}/storage/v1/object/public/content-assets/catalog/covers/0123456789abcdef01234567.webp`],
    ["outro formato", CARD_IMAGE_URL.replace(".webp", ".png")],
    ["nome fora do formato", CARD_IMAGE_URL.replace("0123456789abcdef01234567", "capa")],
    ["subindo pasta", `${ORIGIN}/storage/v1/object/public/content-assets/communications/images/../0123456789abcdef01234567.webp`],
    ["com query", `${CARD_IMAGE_URL}?width=10`],
    ["com fragmento", `${CARD_IMAGE_URL}#x`],
    ["com usuario", CARD_IMAGE_URL.replace("http://", "http://a:b@")],
    ["http fora da maquina", `http://exemplo.supabase.co/storage/v1/object/public/content-assets/${CARD_IMAGE_PATH}`],
    ["fora do Storage", `https://cdn.exemplo.com/${CARD_IMAGE_PATH}`],
    ["javascript", "javascript:alert(1)"],
    ["aspas e ponto e virgula na maquina", `https://a";color:red;x.supabase.co/storage/v1/object/public/content-assets/${CARD_IMAGE_PATH}`],
    ["parenteses na maquina", `https://a)b.supabase.co/storage/v1/object/public/content-assets/${CARD_IMAGE_PATH}`],
    ["data", "data:image/webp;base64,AAAA"],
    ["relativo", `/storage/v1/object/public/content-assets/${CARD_IMAGE_PATH}`]
  ]) {
    const result = accept(cardImage({ url }));
    assert.equal(result.success, false, label);
    assert.deepEqual(issuesOf(result), [{ message: schema.POPUP_DESIGN_MESSAGES.cardImage, path: "card.background.url" }], label);
  }

  assert.deepEqual(issuesOf(accept(cardImage({ url: "  " }))), [{ message: schema.POPUP_DESIGN_MESSAGES.cardImageMissing, path: "card.background.url" }], "sem imagem ainda");

  for (const [label, change, path] of [
    ["escuro acima de 80", { dim: 81 }, "card.background.dim"],
    ["escuro quebrado", { dim: 10.5 }, "card.background.dim"],
    ["recorte fora da lista", { position: "left" }, "card.background.position"],
    ["cor de apoio fora do formato", { color: "preto" }, "card.background.color"],
    ["chave a mais", { css: "color:red" }, "card.background"]
  ]) {
    const result = accept(cardImage(change));
    assert.equal(result.success, false, label);
    assert.ok(issuesOf(result).some((issue) => issue.path === path || issue.path.startsWith(`${path}.`)), `${label}: ${JSON.stringify(issuesOf(result))}`);
  }

  assert.equal(model.popupCardImagePathOf(CARD_IMAGE_URL), CARD_IMAGE_PATH);
  assert.equal(model.popupCardImagePathOf(CARD_IMAGE_URL, ORIGIN), CARD_IMAGE_PATH);
  assert.equal(model.popupCardImagePathOf(CARD_IMAGE_URL, "https://outro.supabase.co"), null, "com a origem, so a nossa");
  assert.equal(model.paintBaseColor(cardImage()), "#16181C", "a cor de apoio e a base (auto do degrade e contraste)");
});

test("imagem no fundo: o servidor troca o endereco pelo do nosso Storage a partir do caminho (salvar e ler)", () => {
  const design = { ...starter(), card: { ...starter().card, background: cardImage({ url: CARD_IMAGE_URL.replace(ORIGIN, "https://outro.exemplo") }) } };
  const own = fonts.withOwnStorageUrls(fakeDb, design);

  assert.equal(own.card.background.url, CARD_IMAGE_URL);
  assert.equal(own.media, design.media, "sem video, a midia fica");
  const broken = { ...design, card: { ...design.card, background: cardImage({ url: "https://cdn.exemplo.com/x.webp" }) } };
  assert.deepEqual(fonts.withOwnStorageUrls(fakeDb, broken).card.background, { color: "#16181C", kind: "solid" }, "nunca deveria chegar; vira so a cor de apoio");
  const plain = starter();
  assert.equal(fonts.withOwnStorageUrls(fakeDb, plain), plain, "sem video nem imagem, o mesmo objeto");
});

test("contraste com imagem no fundo: uma dica que nao mede (conferir na previa); selo, botoes e X continuam medidos", () => {
  const design = { ...starter(), card: { ...starter().card, background: cardImage() } };
  const hints = model.popupDesignContrastHints(design);

  assert.deepEqual(hints, [{ blockId: null, key: "card.background", message: model.POPUP_IMAGE_CONTRAST_MESSAGE, ratio: null, required: 4.5 }]);
  assert.doesNotMatch(model.POPUP_IMAGE_CONTRAST_MESSAGE, /campanha|público|audiência|evento|oferta|gatilho|trigger|sessão|impressão|home/i);

  const badBadge = structuredClone(design);
  badBadge.blocks[0].style.paint = { color: badBadge.blocks[0].background.color, kind: "solid" };
  assert.ok(model.popupDesignContrastHints(badBadge).some((hint) => hint.key === "blocks.0"), "o selo tem o proprio fundo: medido");
  const badText = structuredClone(design);
  badText.blocks[2].style.paint = { color: "#16181c", kind: "solid" };
  assert.equal(model.popupDesignContrastHints(badText).some((hint) => hint.key === "blocks.2"), false, "texto sobre a imagem nao e medido");

  // Texto "Sobre a midia, embaixo" com degrade de outra cor fica na cor solida: medido contra ela.
  const overColor = { ...designSemEnd(), media: { ...designSemEnd().media, fade: { color: "#ffffff", enabled: true, end: 70, height: 35 } } };
  assert.ok(model.popupDesignContrastHints(overColor).some((hint) => hint.key.startsWith("blocks.0.lines")), "titulo branco sobre o degrade branco");
});
