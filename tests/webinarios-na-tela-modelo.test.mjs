import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QRCodeSVG } from "qrcode.react";
import "./support/resolve-extensionless-ts.mjs";

// O modelo puro da "Na tela" (especificacao de 10/11/2026, §4, §8 e §9; docs/30 §2.4 e §4.2): screen-model.ts,
// screen-schemas.ts e screen-rows.ts, sem banco.
// - as regras do item no salvar (zod): o QR Code com link https de ate 240 caracteres; o banner com imagem ou titulo;
//   o botao pede link; a imagem sem titulo pede a descricao; "No meio" sem fechar nunca Grande; os padroes (o banner
//   embaixo a direita, o QR Code em cima a direita, Medio, pode fechar);
// - a copia congelada (snapshot v1): a do item volta igual; a invalida e descartada na leitura (nada e desenhado);
// - o item do aluno: so banner e QR Code ativos, o link so https seguro e a imagem so com o endereco da nossa origem;
// - o QR Code: a versao e os modulos batem com o que a qrcode.react desenha (nivel M, margem 4), o lado nunca abaixo de
//   3 px por modulo nem acima da altura livre menos 56 px, e o aviso de codigo denso;
// - o resumo, os nomes das exibicoes, o nome padrao do item e os numeros da funcao do relatorio;
// - na sala: o resumo das enquetes (pollsKey), quando a Na tela aparece, o estado que a sala adota (o da sessao sempre,
//   o do chat so com outro carimbo) e o que o aluno fechou (por exibicao, guardado na aba);
// - as frases novas (WEBINAR_COPY.naTela) passam pela PROIBIDAS_WEBINARIO e estao como a especificacao escreve.

const model = await import("../src/server/webinars/screen-model.ts");
const schemas = await import("../src/server/webinars/screen-schemas.ts");
const rows = await import("../src/server/webinars/screen-rows.ts");
const { NA_TELA_COPY } = await import("../src/lib/webinar-copy-v4/na-tela.ts");
const sala = await import("../src/components/member/webinars/room/screen/room-screen-model.ts");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const WEBINAR = "3b0c6a8e-1f2d-4c5b-9a7e-0d1c2b3a4f5e";
const SESSAO = "6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const EXIBICAO = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
const IMAGEM = "webinars/screen/0123456789abcdef01234567.webp";
const ORIGEM = "https://abcdefgh.supabase.co";

/** O que o zod devolve (sucesso) ou os erros por campo (falha). */
function salvar(input) {
  const parsed = schemas.screenItemInputSchema.safeParse({ webinarId: WEBINAR, ...input });
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  return { errors: Object.fromEntries(parsed.error.issues.map((issue) => [issue.path.join("."), issue.message])), ok: false };
}

const BANNER = { kind: "banner", linkUrl: "https://bunker707.com.br/turma", title: "Turma nova" };
const QR = { kind: "qr", linkUrl: "https://bunker707.com.br/turma" };

test("as listas e os limites (os mesmos da 202611100002)", () => {
  assert.deepEqual([...model.SCREEN_KINDS], ["banner", "qr"]);
  assert.deepEqual([...model.SCREEN_DISPLAY_KINDS], ["banner", "qr", "poll"]);
  assert.deepEqual([...model.SCREEN_PLACES], ["top_left", "top_center", "top_right", "middle_left", "center", "middle_right", "bottom_left", "bottom_center", "bottom_right"]);
  assert.deepEqual([...model.SCREEN_SIZES], ["s", "m", "l"]);
  assert.deepEqual([...model.SCREEN_HIDDEN_REASONS], ["team", "replaced", "poll_closed"]);
  assert.deepEqual({ ...model.SCREEN_LIMITS }, {
    body: 200,
    buttonLabel: 30,
    eventBatchesPerMinute: 12,
    eventsPerBatch: 6,
    imageAlt: 120,
    imageBytes: 200_000,
    imageSideMax: 1280,
    imageSideMin: 16,
    itemsPerWebinar: 20,
    link: 500,
    name: 60,
    qrLink: 240,
    snapshotBytes: 4096,
    title: 80
  });
  assert.deepEqual({ ...model.SCREEN_EVENT_TYPES }, { clicked: "webinar_screen_clicked", closed: "webinar_screen_closed", shown: "webinar_screen_shown" });
});

test("salvar: os padroes (o banner embaixo a direita, o QR Code em cima a direita, Medio, pode fechar) e o vazio vira null", () => {
  const banner = salvar({ ...BANNER, body: "  ", buttonLabel: "", name: " " });
  assert.equal(banner.ok, true, JSON.stringify(banner.errors));
  assert.deepEqual(
    [banner.value.place, banner.value.size, banner.value.closable, banner.value.body, banner.value.buttonLabel, banner.value.name, banner.value.id],
    ["bottom_right", "m", true, null, null, null, null]
  );
  const qr = salvar(QR);
  assert.equal(qr.ok, true, JSON.stringify(qr.errors));
  assert.equal(qr.value.place, "top_right");
  // A descricao sem imagem e descartada (o check do banco a quer nula).
  assert.equal(salvar({ ...BANNER, imageAlt: "Um foguete" }).value.imageAlt, null);
  assert.equal(salvar({ ...BANNER, imageAlt: "Um foguete", imagePath: IMAGEM }).value.imageAlt, "Um foguete");
});

test("salvar o QR Code: link https de ate 240 caracteres, sem texto, botao nem imagem", () => {
  const base = "https://bunker707.com.br/";
  assert.equal(salvar({ ...QR, linkUrl: base + "a".repeat(240 - base.length) }).ok, true);
  assert.deepEqual(salvar({ ...QR, linkUrl: base + "a".repeat(241 - base.length) }).errors, { linkUrl: "Para o QR Code, use um link de até 240 caracteres." });
  assert.deepEqual(salvar({ ...QR, linkUrl: null }).errors, { linkUrl: "Use um link que comece com https://." });
  assert.deepEqual(salvar({ ...QR, linkUrl: "http://bunker707.com.br" }).errors, { linkUrl: "Use um link que comece com https://." });
  assert.deepEqual(salvar({ ...QR, linkUrl: "javascript:alert(1)" }).errors, { linkUrl: "Use um link que comece com https://." });
  const comExtras = salvar({ ...QR, body: "texto", buttonLabel: "Ir", imagePath: IMAGEM });
  assert.deepEqual(Object.keys(comExtras.errors).sort(), ["body", "buttonLabel", "imagePath"]);
  // A legenda e o titulo do QR Code.
  assert.equal(salvar({ ...QR, title: "Aponte a câmera" }).value.title, "Aponte a câmera");
});

test("salvar o banner: imagem ou titulo; o botao pede link; a imagem sem titulo pede a descricao; link so https; os limites de cada campo", () => {
  assert.deepEqual(salvar({ kind: "banner" }).errors, { title: "Coloque uma imagem ou um título." });
  assert.equal(salvar({ imageAlt: "Foguete subindo", imagePath: IMAGEM, kind: "banner" }).ok, true, "so a imagem, com a descricao");
  assert.deepEqual(salvar({ imagePath: IMAGEM, kind: "banner" }).errors, { imageAlt: "Descreva a imagem para quem usa leitor de tela." });
  assert.deepEqual(salvar({ buttonLabel: "Quero", kind: "banner", title: "Turma" }).errors, { linkUrl: "O botão precisa de um link." });
  assert.equal(salvar({ kind: "banner", title: "Só um aviso" }).ok, true, "sem link, e so um aviso");
  assert.equal(salvar({ ...BANNER, buttonLabel: null }).ok, true, "sem texto do botao, o banner inteiro abre o link");
  assert.deepEqual(salvar({ ...BANNER, linkUrl: "data:text/html,oi" }).errors, { linkUrl: "Use um link que comece com https://." });
  assert.deepEqual(salvar({ ...BANNER, imageAlt: "x", imagePath: "communications/images/0123456789abcdef01234567.webp" }).errors, { imagePath: "A imagem não foi encontrada. Envie de novo." });
  assert.deepEqual(salvar({ ...BANNER, title: "t".repeat(81) }).errors, { title: "Use até 80 caracteres." });
  assert.deepEqual(salvar({ ...BANNER, body: "b".repeat(201) }).errors, { body: "Use até 200 caracteres." });
  assert.deepEqual(salvar({ ...BANNER, buttonLabel: "b".repeat(31) }).errors, { buttonLabel: "Use até 30 caracteres." });
  assert.deepEqual(salvar({ ...BANNER, name: "n".repeat(61) }).errors, { name: "Use até 60 caracteres." });
  assert.equal(salvar({ ...BANNER, place: "fora" }).ok, false);
  assert.equal(salvar({ ...BANNER, webinarId: "nao-e-uuid" }).ok, false);
});

test("a regra do meio: \"No meio\" sem poder fechar nunca e Grande (Pequeno e Medio passam; com fechar, todos)", () => {
  assert.deepEqual(salvar({ ...BANNER, closable: false, place: "center", size: "l" }).errors, { size: "No meio e sem fechar, só nos tamanhos Pequeno e Médio." });
  assert.equal(salvar({ ...BANNER, closable: false, place: "center", size: "m" }).ok, true);
  assert.equal(salvar({ ...BANNER, closable: true, place: "center", size: "l" }).ok, true);
  assert.equal(salvar({ ...BANNER, closable: false, place: "bottom_right", size: "l" }).ok, true);
  assert.deepEqual([...model.screenSizesFor("center", false)], ["s", "m"]);
  assert.deepEqual([...model.screenSizesFor("center", true)], ["s", "m", "l"]);
  assert.deepEqual([...model.screenSizesFor("top_left", false)], ["s", "m", "l"]);
});

const itemPronto = (extra = {}) => ({
  archivedAt: null,
  body: "Vagas até sexta.",
  buttonLabel: "Quero entrar",
  closable: false,
  createdAt: "2026-11-10T20:00:00.000Z",
  id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  image: { alt: "Foguete subindo", height: 360, path: IMAGEM, width: 640 },
  kind: "banner",
  linkUrl: "https://bunker707.com.br/turma",
  name: "Turma de novembro",
  place: "bottom_left",
  size: "l",
  title: "Turma nova",
  updatedAt: "2026-11-10T20:00:00.000Z",
  webinarId: WEBINAR,
  ...extra
});

const exibicao = (extra = {}) => ({
  created_at: "2026-11-10T20:05:00.000Z",
  hidden_at: null,
  hidden_by: null,
  hidden_offset_ms: null,
  hidden_reason: null,
  id: EXIBICAO,
  item_id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  kind: "banner",
  poll_id: null,
  session_id: SESSAO,
  shown_at: "2026-11-10T20:05:00.000Z",
  shown_by: null,
  shown_offset_ms: 300_000,
  snapshot: model.snapshotOfItem(itemPronto()),
  ...extra
});

test("a copia congelada: a do item volta igual na leitura; a enquete fixada guarda so a pergunta", () => {
  const item = itemPronto();
  const snapshot = model.snapshotOfItem(item);
  assert.deepEqual(snapshot, {
    body: item.body,
    buttonLabel: item.buttonLabel,
    closable: false,
    image: item.image,
    linkUrl: item.linkUrl,
    name: item.name,
    place: "bottom_left",
    size: "l",
    title: item.title,
    v: 1
  });
  assert.notEqual(snapshot.image, item.image, "a copia nao divide o objeto da imagem com o item");
  assert.deepEqual(schemas.parseScreenSnapshot("banner", JSON.parse(JSON.stringify(snapshot))), snapshot);
  assert.deepEqual(schemas.parseScreenSnapshot("poll", { name: "Qual curso você quer?", v: 1 }), { name: "Qual curso você quer?", v: 1 });
  assert.equal(rows.screenDisplayFromRow(exibicao()).snapshot.title, "Turma nova");
});

test("a copia invalida e descartada na leitura: versao, link, imagem fora da pasta, posicao, regras do tipo", () => {
  const boa = model.snapshotOfItem(itemPronto());
  for (const [rotulo, ruim] of [
    ["sem versao", { ...boa, v: undefined }],
    ["versao 2", { ...boa, v: 2 }],
    ["link javascript", { ...boa, linkUrl: "javascript:alert(1)" }],
    ["link http", { ...boa, linkUrl: "http://bunker707.com.br" }],
    ["imagem de outra pasta", { ...boa, image: { ...boa.image, path: "avatars/u/foto.webp" } }],
    ["imagem gigante", { ...boa, image: { ...boa.image, width: 4000 } }],
    ["posicao desconhecida", { ...boa, place: "rodape" }],
    ["banner sem imagem nem titulo", { ...boa, image: null, title: null }],
    ["botao sem link", { ...boa, linkUrl: null }],
    ["meio sem fechar e grande", { ...boa, place: "center" }],
    ["nao e objeto", "banner"],
    ["nulo", null]
  ]) {
    assert.equal(schemas.parseScreenSnapshot("banner", ruim), null, rotulo);
  }
  assert.equal(schemas.parseScreenSnapshot("qr", { ...boa, image: null }), null, "o QR Code nao tem texto nem botao");
  assert.equal(schemas.parseScreenSnapshot("poll", { name: "", v: 1 }), null);
  const lida = rows.screenDisplayFromRow(exibicao({ snapshot: { ...boa, linkUrl: "javascript:alert(1)" } }));
  assert.equal(lida.snapshot, null);
  assert.equal(model.studentScreenItem(lida, ORIGEM), null, "nada e desenhado");
  assert.equal(rows.screenDisplayFromRow(exibicao({ kind: "video" })), null, "um tipo que este app nao conhece fica de fora");
});

test("o item do aluno: o id da exibicao, a imagem com o endereco da nossa origem, o alt da equipe (sem ela, o titulo)", () => {
  const aluno = model.studentScreenItem(rows.screenDisplayFromRow(exibicao()), ORIGEM);
  assert.deepEqual(aluno, {
    body: "Vagas até sexta.",
    buttonLabel: "Quero entrar",
    closable: false,
    displayId: EXIBICAO,
    image: { alt: "Foguete subindo", height: 360, url: `${ORIGEM}/storage/v1/object/public/content-assets/${IMAGEM}`, width: 640 },
    kind: "banner",
    linkUrl: "https://bunker707.com.br/turma",
    place: "bottom_left",
    shownAt: "2026-11-10T20:05:00.000Z",
    size: "l",
    title: "Turma nova"
  });
  const semAlt = model.snapshotOfItem(itemPronto({ image: { alt: null, height: 360, path: IMAGEM, width: 640 } }));
  assert.equal(model.studentScreenItem(rows.screenDisplayFromRow(exibicao({ snapshot: semAlt })), ORIGEM).image.alt, "Turma nova");
  // A exibicao que ja saiu e a enquete fixada nao viram cartao.
  assert.equal(model.studentScreenItem(rows.screenDisplayFromRow(exibicao({ hidden_at: "2026-11-10T20:06:00.000Z", hidden_reason: "team" })), ORIGEM), null);
  assert.equal(model.studentScreenItem(rows.screenDisplayFromRow(exibicao({ kind: "poll", poll_id: SESSAO, snapshot: { name: "Pergunta", v: 1 } })), ORIGEM), null);
});

test("a origem conferida e a mesma regra do Livre da Comunicacao (sem a sala importar o pop-up)", async () => {
  const { freeStorageOrigin } = await import("../src/server/communications/popup-free-render.ts");
  for (const origem of [ORIGEM, `${ORIGEM}/`, "http://127.0.0.1:55321", "http://localhost:54321", "http://[::1]:5432", "http://abcdefgh.supabase.co", "https://abc.supabase.co/x", "https://u:s@abc.supabase.co", "https://abc.supabase.co?x=1", "https://abc.supabase.co#a", "https://ab\"c.co", "ftp://abc.co", "javascript:alert(1)", " ", "", null, undefined, 42]) {
    assert.equal(model.screenStorageOriginOf(origem), freeStorageOrigin(origem), String(origem));
  }
});

test("o endereco da imagem so sai da nossa origem conferida: origem com caminho, http de fora ou caminho de outra pasta viram null", () => {
  assert.equal(model.screenImageUrl(IMAGEM, ORIGEM), `${ORIGEM}/storage/v1/object/public/content-assets/${IMAGEM}`);
  assert.equal(model.screenImageUrl(IMAGEM, "http://127.0.0.1:55321"), `http://127.0.0.1:55321/storage/v1/object/public/content-assets/${IMAGEM}`, "http so na propria maquina");
  for (const origem of ["http://abcdefgh.supabase.co", "https://abcdefgh.supabase.co/caminho", "https://u:s@abcdefgh.supabase.co", "javascript:alert(1)", "", null, undefined]) {
    assert.equal(model.screenImageUrl(IMAGEM, origem), null, String(origem));
  }
  for (const caminho of ["webinars/covers/0123456789abcdef01234567.webp", "webinars/screen/../avatars/x.webp", "https://golpe.com/x.webp", "webinars/screen/0123456789ABCDEF01234567.webp", null]) {
    assert.equal(model.screenImageUrl(caminho, ORIGEM), null, String(caminho));
  }
  // Sem o endereco da imagem, o banner que so tinha imagem nao tem o que mostrar; o que tem titulo segue sem a imagem.
  const soImagem = model.snapshotOfItem(itemPronto({ title: null }));
  assert.equal(model.studentScreenItem(rows.screenDisplayFromRow(exibicao({ snapshot: soImagem })), null), null);
  assert.equal(model.studentScreenItem(rows.screenDisplayFromRow(exibicao()), "https://golpe.com/x").image, null);
});

test("o QR Code: a versao e os modulos batem com o que a qrcode.react desenha (nivel M, margem 4); acima de 251 bytes nao cabe", () => {
  const desenho = (link) => Number(renderToStaticMarkup(createElement(QRCodeSVG, { level: "M", marginSize: model.QR_MARGIN_MODULES, size: 176, value: link })).match(/viewBox="0 0 (\d+) \d+"/)[1]);
  const link = (total) => "https://a.co/" + "x".repeat(total - "https://a.co/".length);
  for (const [total, versao] of [[14, 1], [15, 2], [26, 2], [27, 3], [62, 4], [63, 5], [122, 7], [213, 10], [214, 11], [240, 11], [251, 11]]) {
    assert.equal(model.qrVersion(link(total)), versao, `${total} bytes`);
    assert.equal(model.qrModules(link(total)), 17 + 4 * versao + 8);
    assert.equal(model.qrModules(link(total)), desenho(link(total)), `${total} bytes: o mesmo que a biblioteca desenha`);
  }
  assert.equal(model.qrVersion(link(252)), null);
  assert.equal(model.qrModules(""), null);
  // O link de ate 240 caracteres do QR Code (so ASCII, como o URL guarda) sempre cabe.
  assert.ok(model.qrVersion(link(model.SCREEN_LIMITS.qrLink)) !== null);
});

test("o lado do QR Code: 128 / 176 / 232 px, nunca menos de 3 px por modulo nem mais que a altura livre menos 56; o aviso de denso", () => {
  assert.deepEqual({ ...model.QR_SIDE_PX }, { l: 232, m: 176, s: 128 });
  assert.equal(model.qrSidePx("m", 29), 176);
  assert.equal(model.qrSidePx("m", 69), 207, "69 modulos x 3 px");
  assert.equal(model.qrSidePx("s", 45), 135);
  assert.equal(model.qrSidePx("l", 69), 232);
  assert.equal(model.qrSidePx("l", 29, 200), 144, "a altura livre menos 56");
  assert.equal(model.qrSidePx("m", null), 176);
  assert.equal(model.qrIsDense("m", 69), true);
  assert.equal(model.qrIsDense("l", 69), false);
  assert.equal(model.qrIsDense("s", 41), false);
  assert.equal(model.qrIsDense("s", 45), true);
  assert.equal(model.qrIsDense("s", null), false);
});

test("o resumo, os nomes das exibicoes e o nome padrao do item", () => {
  assert.equal(model.screenItemSummary({ closable: true, place: "bottom_right", size: "m" }), "Embaixo, à direita · Médio · o aluno pode fechar");
  assert.equal(model.screenItemSummary({ closable: false, place: "center", size: "s" }), "No meio · Pequeno · o aluno não pode fechar");
  assert.equal(model.screenDisplayLabel("banner", "Turma"), "Banner · Turma");
  assert.equal(model.screenDisplayLabel("qr", "Inscrição"), "QR Code · Inscrição");
  assert.equal(model.screenDisplayLabel("poll", "Qual curso?"), "Enquete fixada · Qual curso?");
  assert.equal(model.screenItemDefaultName({ kind: "banner", linkUrl: "https://bunker707.com.br", title: "Turma nova" }), "Turma nova");
  assert.equal(model.screenItemDefaultName({ kind: "qr", linkUrl: "https://www.bunker707.com.br/turma", title: null }), "bunker707.com.br");
  assert.equal(model.screenItemDefaultName({ kind: "banner", linkUrl: null, title: null }), "Banner");
  assert.equal(model.screenItemDefaultName({ kind: "banner", linkUrl: null, title: "t".repeat(80) }).length, 60);
});

test("os numeros da funcao do relatorio por exibicao (bigint como numero ou texto; a linha sem id fica de fora)", () => {
  const stats = rows.screenStatsFromRows([
    { clickers: 41, clicks: 55, closed: 9, display_id: EXIBICAO, shown: 312 },
    { clickers: "2", clicks: "3", closed: null, display_id: SESSAO, shown: "10" },
    { clickers: 1, clicks: 1, closed: 1, display_id: null, shown: 1 }
  ]);
  assert.deepEqual([...stats.entries()], [
    [EXIBICAO, { clickers: 41, clicks: 55, closed: 9, shown: 312 }],
    [SESSAO, { clickers: 2, clicks: 3, closed: 0, shown: 10 }]
  ]);
  assert.equal(NA_TELA_COPY.numeros(312, 41, 9), "312 viram · 41 clicaram · 9 fecharam");
  assert.equal(NA_TELA_COPY.numeros(1, 1, 1), "1 viu · 1 clicou · 1 fechou");
});

test("o corpo da rota das metricas: ate 6 eventos, os nomes, as formas e os alvos conhecidos", () => {
  const evento = { displayId: EXIBICAO, form: "stage", name: "clicked", target: "button" };
  assert.equal(schemas.screenEventsBodySchema.safeParse({ events: [evento], sessionId: SESSAO }).success, true);
  assert.equal(schemas.screenEventsBodySchema.safeParse({ events: Array(6).fill(evento), sessionId: SESSAO }).success, true);
  assert.equal(schemas.screenEventsBodySchema.safeParse({ events: Array(7).fill(evento), sessionId: SESSAO }).success, false);
  assert.equal(schemas.screenEventsBodySchema.safeParse({ events: [], sessionId: SESSAO }).success, false);
  assert.equal(schemas.screenEventsBodySchema.safeParse({ events: [{ ...evento, name: "printed" }], sessionId: SESSAO }).success, false);
  assert.equal(schemas.screenEventsBodySchema.safeParse({ events: [{ ...evento, form: "popup" }], sessionId: SESSAO }).success, false);
  assert.equal(schemas.screenEventsBodySchema.safeParse({ events: [{ ...evento, target: "qr_scan" }], sessionId: SESSAO }).success, false);
  assert.equal(schemas.screenEventsBodySchema.safeParse({ events: [{ displayId: EXIBICAO, form: "strip", name: "shown" }], sessionId: SESSAO }).success, true);
  // A imagem enviada: a data URL de ate 200 KB em base64.
  assert.equal(schemas.uploadScreenImageSchema.safeParse({ image: "x".repeat(schemas.SCREEN_IMAGE_DATA_URL_MAX + 1) }).error.issues[0].message, "A imagem passou de 200 KB. Envie uma menor.");
});

test("as frases da Na tela entram em WEBINAR_COPY.naTela, passam pela PROIBIDAS_WEBINARIO e estao como a especificacao escreve", () => {
  assert.equal(WEBINAR_COPY.naTela, NA_TELA_COPY);
  const textos = [];
  const coletar = (value) => {
    if (typeof value === "string") {
      textos.push(value);
    } else if (typeof value === "function") {
      for (const args of [["Turma nova", "Médio", "o aluno pode fechar"], [["Banner", "QR Code"]], [0], [1], [3], [125], [312, 41, 9], [null]]) {
        try {
          coletar(value(...args));
        } catch {
          // Outra assinatura.
        }
      }
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(coletar);
    }
  };
  coletar(NA_TELA_COPY);
  assert.ok(textos.length > 120, `achou as frases (${textos.length})`);
  for (const texto of textos) {
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!texto.toLocaleLowerCase("pt-BR").includes(palavra), `"${texto}" usa "${palavra}"`);
    }
  }
  assert.equal(NA_TELA_COPY.chat.fixarAoEnviar, "Fixar ao enviar");
  assert.equal(NA_TELA_COPY.chat.fixadaAgora, "Fixada agora");
  assert.equal(NA_TELA_COPY.enquetes.abrirEFixar, "Abrir e fixar");
  assert.equal(NA_TELA_COPY.console.agoraVazio, "Nada na tela dos alunos.");
  assert.equal(NA_TELA_COPY.console.prontosVazio, "Nenhum banner ou QR Code pronto.");
  assert.equal(NA_TELA_COPY.console.pilulaPalco(["Banner", "QR Code"]), "Na tela: Banner · QR Code");
  assert.deepEqual({ ...NA_TELA_COPY.console.avisos }, {
    enqueteDesafixada: "Enquete desafixada.",
    enqueteFixada: "Enquete fixada.",
    excluido: "Excluído dos prontos.",
    mensagemFixada: "Mensagem fixada.",
    naTela: "Na tela dos alunos em até 5 s.",
    saiu: "Saiu da tela.",
    salvo: "Salvo nos prontos."
  });
  assert.equal(NA_TELA_COPY.haTempo(2), "há 2 min");
  assert.equal(NA_TELA_COPY.haTempo(0), "agora");
  assert.equal(NA_TELA_COPY.haTempo(125), "há 2 h 5 min");
  assert.equal(NA_TELA_COPY.aluno.anuncioQr("Inscrição"), "A equipe mostrou um QR Code: Inscrição. O link está no botão Abrir o link.");
  assert.equal(NA_TELA_COPY.aluno.anuncioBanner("Turma nova"), "A equipe colocou um banner na tela: Turma nova.");
  assert.equal(NA_TELA_COPY.aluno.semFechar, "Este banner sai quando a equipe tirar.");
  assert.equal(NA_TELA_COPY.aluno.qrNome("bunker707.com.br"), "QR Code do link bunker707.com.br");
  assert.equal(NA_TELA_COPY.formulario.avisoMeio, "No meio e sem fechar, o banner cobre parte do vídeo até você tirar. Só nos tamanhos Pequeno e Médio.");
  assert.equal(NA_TELA_COPY.relatorio.colunas.taxa, "Clicaram ÷ viram");
  assert.equal(Object.keys(NA_TELA_COPY.lugares).join(), model.SCREEN_PLACES.join(), "um nome para cada posicao, na ordem da grade");
  assert.equal(Object.keys(NA_TELA_COPY.tamanhos).join(), model.SCREEN_SIZES.join());
});

test("o resumo das enquetes (pollsKey): muda com a enquete lancada, encerrada ou compartilhada; nao depende da ordem; vazio sem enquete", () => {
  const a = { id: "a", resultsShared: false, status: "open" };
  const b = { id: "b", resultsShared: false, status: "closed" };
  const base = model.pollsKeyOf([a, b]);
  assert.match(base, /^2-[0-9a-f]{8}$/);
  assert.equal(model.pollsKeyOf([b, a]), base, "a ordem da leitura nao muda o resumo");
  assert.notEqual(model.pollsKeyOf([a]), base, "lancada");
  assert.notEqual(model.pollsKeyOf([{ ...a, status: "closed" }, b]), base, "encerrada");
  assert.notEqual(model.pollsKeyOf([a, { ...b, resultsShared: true }]), base, "resultado compartilhado");
  assert.equal(model.pollsKeyOf([]), "");
});

test("quando a Na tela aparece: a Live ao vivo e a gravada, na espera e no ar; nunca no Replay nem na sessao encerrada ou cancelada", () => {
  for (const kind of ["live", "simulated"]) {
    for (const status of ["scheduled", "waiting", "live"]) {
      assert.equal(model.screenShowsIn({ kind, status }), true, `${kind} ${status}`);
    }
    assert.equal(model.screenShowsIn({ kind, status: "ended" }), false);
    assert.equal(model.screenShowsIn({ kind, status: "cancelled" }), false);
  }
  assert.equal(model.screenShowsIn({ kind: "replay", status: "live" }), false);
  assert.deepEqual(model.emptyScreenState("s1"), { items: [], pinned: null, pinnedPollId: null, pollsKey: "", stamp: "s1" });
});

test("a sala adota o estado da sessao sempre e o do chat so com outro carimbo; o que o aluno fechou some (so o que pode fechar)", () => {
  const item = (displayId, closable = true) => ({ body: null, buttonLabel: null, closable, displayId, image: null, kind: "banner", linkUrl: null, place: "center", shownAt: "x", size: "m", title: "T" });
  const atual = { ...model.emptyScreenState("s1"), items: [item("d1")] };
  const igual = { ...model.emptyScreenState("s1"), items: [] };
  const novo = { ...model.emptyScreenState("s2"), items: [item("d2")] };
  assert.equal(sala.adoptScreen(atual, igual, "chat"), atual, "o chat com o mesmo carimbo nao troca");
  assert.equal(sala.adoptScreen(atual, novo, "chat"), novo);
  assert.equal(sala.adoptScreen(atual, igual, "session"), igual, "a sessao sempre vale");
  assert.equal(sala.adoptScreen(atual, null, "chat"), atual);
  assert.equal(sala.adoptScreen(atual, undefined, "session"), atual, "a pagina de antes, sem o estado");
  assert.equal(sala.adoptScreen(null, novo, "chat"), novo);

  assert.equal(sala.screenClosedKey("s1"), "bunker707:webinar-sala-tela-fechados:s1");
  assert.deepEqual(sala.storedClosedIds(null), []);
  assert.deepEqual(sala.storedClosedIds("estragado"), []);
  assert.deepEqual(sala.storedClosedIds(JSON.stringify(["d1", 3, "", "d2"])), ["d1", "d2"]);
  const guardado = sala.closedIdsValue(["d1"], "d2");
  assert.deepEqual(JSON.parse(guardado), ["d1", "d2"]);
  assert.deepEqual(JSON.parse(sala.closedIdsValue(["d1"], "d1")), ["d1"], "sem repetir");
  const itens = [item("d1"), item("d2", false), item("d3")];
  assert.deepEqual(sala.visibleScreenItems(itens, ["d1", "d2"]).map((entry) => entry.displayId), ["d2", "d3"], "o que nao pode fechar continua, mesmo com o id guardado");
});

/* ------------------------------------------------------------------------------------------------
 * O banner e o QR Code do aluno (fatia S9; §3.2 a §3.7 e §7)
 * ---------------------------------------------------------------------------------------------- */

const itemDoAluno = (displayId, kind, place, extra = {}) => ({
  body: null,
  buttonLabel: null,
  closable: true,
  displayId,
  image: null,
  kind,
  linkUrl: "https://bunker707.com.br/turma",
  place,
  shownAt: "2026-11-10T23:00:00.000Z",
  size: "m",
  title: kind === "qr" ? "Aponte a câmera" : "Turma nova",
  ...extra
});
const celulas = (placement) => placement.cells.map((cell) => [cell.place, cell.entries.map((entry) => (entry.kind === "pinned" ? "fixadas" : `${entry.item.kind}:${entry.item.displayId}`))]);

test("screenPlacement: cada item na posicao escolhida; banner em cima do QR Code na mesma posicao; as pilulas das fixadas primeiro em cima a esquerda; a ordem da grade", () => {
  const juntos = sala.screenPlacement({ items: [itemDoAluno("q", "qr", "top_left"), itemDoAluno("b", "banner", "top_left")], offerShown: false, pinnedPills: true });
  assert.deepEqual(celulas(juntos), [["top_left", ["fixadas", "banner:b", "qr:q"]]], "as fixadas, o banner, o QR Code");
  // Em cantos opostos (um a esquerda e o outro a direita), cada um na sua celula, com metade da largura.
  const separados = sala.screenPlacement({ items: [itemDoAluno("b", "banner", "bottom_right"), itemDoAluno("q", "qr", "top_left")], offerShown: false, pinnedPills: false });
  assert.deepEqual(celulas(separados), [["top_left", ["qr:q"]], ["bottom_right", ["banner:b"]]], "na ordem da grade, linha a linha");
  assert.deepEqual(separados.cells.map((cell) => cell.split), ["width", "width"]);
  assert.deepEqual(celulas(sala.screenPlacement({ items: [], offerShown: false, pinnedPills: true })), [["top_left", ["fixadas"]]]);
  assert.deepEqual(sala.screenPlacement({ items: [], offerShown: false, pinnedPills: true }).cells[0].split, null, "so as fixadas: a area inteira");
  assert.deepEqual(sala.screenPlacement({ items: [], offerShown: true, pinnedPills: false }), { assistant: true, cells: [], chatPills: true }, "nada na tela, nada muda");
  assert.deepEqual(sala.screenPlacement({ items: [itemDoAluno("b", "banner", "center")], offerShown: false, pinnedPills: false }).cells.map((cell) => cell.split), [null], "um item so: a area inteira");
});

test("screenPlacement, banner e QR Code em posicoes diferentes (A1): na mesma coluna, na mesma fileira ou vizinhos pelo meio juntam na primeira das duas (o banner em cima); em lados opostos, metade da area cada", () => {
  const par = (bannerPlace, qrPlace, extra = {}) =>
    sala.screenPlacement({ items: [itemDoAluno("b", "banner", bannerPlace), itemDoAluno("q", "qr", qrPlace)], offerShown: false, pinnedPills: false, ...extra });
  // O padrao (o QR Code em cima a direita, o banner embaixo a direita): a 1280 x 720 o banner cobria o QR Code.
  const padrao = par("bottom_right", "top_right");
  assert.deepEqual(celulas(padrao), [["top_right", ["banner:b", "qr:q"]]], "a mesma coluna: juntam em cima a direita, o banner em cima");
  assert.deepEqual(padrao.cells.map((cell) => cell.split), [null], "a pilha usa a area inteira");
  assert.equal(padrao.chatPills, false, "a pilha pode crescer ate embaixo: a posicao escolhida (embaixo) ainda tira as pilulas do chat");
  assert.equal(padrao.assistant, false, "e o selo do Assistente");
  assert.deepEqual(celulas(par("top_left", "top_center")), [["top_left", ["banner:b", "qr:q"]]], "a mesma fileira (o Grande em cima a esquerda cobria o X)");
  assert.deepEqual(celulas(par("middle_left", "top_left", { pinnedPills: true })), [["top_left", ["fixadas", "banner:b", "qr:q"]]], "em cima e no meio a esquerda: com as fixadas, todos numa coluna so");
  assert.deepEqual(celulas(par("center", "top_left")), [["top_left", ["banner:b", "qr:q"]]], "vizinhos pelo meio: a metade nao separaria");
  assert.deepEqual(celulas(par("middle_right", "bottom_center")), [["middle_right", ["banner:b", "qr:q"]]]);
  // Em lados opostos: um a esquerda e o outro a direita (a largura) ou um em cima e o outro embaixo (a altura).
  assert.deepEqual(par("top_left", "middle_right").cells.map((cell) => [cell.place, cell.split]), [["top_left", "width"], ["middle_right", "width"]]);
  assert.deepEqual(par("bottom_center", "top_left").cells.map((cell) => [cell.place, cell.split]), [["top_left", "height"], ["bottom_center", "height"]]);
  // Todos os pares: so juntam ou dividem; nenhum par de celulas fica sem regra.
  const lados = { center: [1, 1], top_left: [0, 0], top_center: [0, 1], top_right: [0, 2], middle_left: [1, 0], middle_right: [1, 2], bottom_left: [2, 0], bottom_center: [2, 1], bottom_right: [2, 2] };
  for (const a of model.SCREEN_PLACES) {
    for (const b of model.SCREEN_PLACES) {
      if (a === b) {
        continue;
      }
      const [ra, ca] = lados[a];
      const [rb, cb] = lados[b];
      const esperado = ra === rb || ca === cb ? "join" : Math.abs(ca - cb) === 2 ? "width" : Math.abs(ra - rb) === 2 ? "height" : "join";
      assert.equal(sala.screenPairSplit(a, b), esperado, `${a} e ${b}`);
      assert.equal(sala.screenPairSplit(b, a), esperado, `${b} e ${a}`);
      const placement = par(a, b);
      assert.equal(placement.cells.length, esperado === "join" ? 1 : 2, `${a} e ${b}`);
    }
  }
});

test("screenCellLimits: a area inteira, a metade quando separada, e a fileira de baixo descontando o aviso da sala (--room-snackbar-offset)", () => {
  assert.equal(sala.screenCellLimits({ place: "top_right", split: null }), "max-h-full max-w-full");
  assert.equal(sala.screenCellLimits({ place: "top_left", split: "width" }), "max-h-full max-w-[calc(50%-4px)]");
  assert.equal(sala.screenCellLimits({ place: "top_center", split: "height" }), "max-h-[calc(50%-4px)] max-w-full");
  assert.equal(sala.screenCellLimits({ place: "bottom_left", split: "height" }), "max-h-[calc(50%-4px-var(--room-snackbar-offset,0px))] max-w-full");
  assert.equal(sala.screenCellLimits({ place: "bottom_right", split: null }), "max-h-[calc(100%-var(--room-snackbar-offset,0px))] max-w-full");
  for (const place of ["bottom_left", "bottom_center", "bottom_right"]) {
    assert.ok(sala.SCREEN_CELL_CLASSES[place].split(" ").includes("bottom-[var(--room-snackbar-offset,0px)]"), `${place}: sobe com o aviso da sala, como as pilulas do chat`);
  }
  assert.equal(sala.SCREEN_STACK_BANNER, "min-h-14 shrink-[999]", "na pilha, o banner encolhe primeiro e guarda 56 px");
});

test("screenPlacement, as colisoes: a Oferta leva a coluna da direita para a esquerda (e empilha com o que ja estava la); a fileira de baixo e a do meio tiram as pilulas do chat; embaixo a direita tira o selo do Assistente", () => {
  const comOferta = sala.screenPlacement({ items: [itemDoAluno("q", "qr", "bottom_left"), itemDoAluno("b", "banner", "bottom_right")], offerShown: true, pinnedPills: false });
  assert.deepEqual(celulas(comOferta), [["bottom_left", ["banner:b", "qr:q"]]], "a Oferta fica com o canto; o banner em cima");
  assert.equal(comOferta.assistant, true, "com a Oferta o item saiu do canto (o selo ja sai pela Oferta)");
  // O card da Oferta cobre a coluna da direita inteira: o QR Code padrao (em cima a direita) ficava 70 % coberto.
  assert.deepEqual(
    model.SCREEN_PLACES.map((place) => sala.screenPlaceOf(place, true)),
    ["top_left", "top_center", "top_left", "middle_left", "center", "middle_left", "bottom_left", "bottom_center", "bottom_left"]
  );
  for (const place of model.SCREEN_PLACES) {
    assert.equal(sala.screenPlaceOf(place, false), place, `${place}: sem a Oferta, a posicao escolhida`);
  }
  assert.deepEqual(celulas(sala.screenPlacement({ items: [itemDoAluno("q", "qr", "top_right")], offerShown: true, pinnedPills: true })), [["top_left", ["fixadas", "qr:q"]]], "abaixo das fixadas");
  assert.deepEqual(
    celulas(sala.screenPlacement({ items: [itemDoAluno("q", "qr", "top_right"), itemDoAluno("b", "banner", "bottom_right")], offerShown: true, pinnedPills: false })),
    [["top_left", ["banner:b", "qr:q"]]],
    "o padrao com a Oferta: a coluna da esquerda, juntos"
  );

  const pilulas = (place) => sala.screenPlacement({ items: [itemDoAluno("b", "banner", place)], offerShown: false, pinnedPills: false });
  for (const place of ["bottom_left", "bottom_center", "bottom_right", "center", "middle_left", "middle_right"]) {
    assert.equal(pilulas(place).chatPills, false, `${place}: as pilulas do chat saem do palco largo`);
  }
  for (const place of ["top_left", "top_center", "top_right"]) {
    assert.equal(pilulas(place).chatPills, true, `${place}: as pilulas ficam`);
  }
  assert.equal(pilulas("bottom_right").assistant, false, "o selo do Assistente sai");
  for (const place of ["bottom_left", "bottom_center", "center", "top_right"]) {
    assert.equal(pilulas(place).assistant, true, `${place}: o selo fica`);
  }
});

test("o palco largo e so CSS: os cartoes e as pilulas so com 640 px ou mais de palco e a tela com mais de 500 px de altura; a faixa e a linha compacta voltam na tela baixa (o celular deitado), sempre por cima da regra dos 640 px", () => {
  assert.deepEqual(sala.SCREEN_WIDE_ONLY.split(" "), ["hidden", "[@media(max-height:500px)]:hidden!", "@min-[640px]/tela:flex"]);
  assert.deepEqual(sala.SCREEN_NARROW_FLEX.split(" "), ["@min-[640px]/tela:hidden", "[@media(max-height:500px)]:flex!"]);
});

test("screenFocusKey (A4): muda quando a peca com o foco pode ter saido ou sido montada de novo; igual com o mesmo estado", () => {
  const banner = itemDoAluno("b", "banner", "bottom_right");
  const qr = itemDoAluno("q", "qr", "top_right");
  const base = { forced: false, fullscreen: false, items: [banner], pinnedMessageId: "m1", pinnedPollId: "p1", pinnedShortcuts: true };
  const chave = (extra = {}, placementInput = {}) =>
    sala.screenFocusKey({ ...base, placement: sala.screenPlacement({ items: base.items, offerShown: false, pinnedPills: true, ...placementInput }), ...extra });
  const antes = chave();
  assert.equal(chave(), antes, "o mesmo estado, a mesma chave (o desenho de cada segundo nao confere)");
  assert.notEqual(chave({ pinnedMessageId: null }), antes, "a equipe desafixou (a pilula, a linha e a area saem)");
  assert.notEqual(chave({ pinnedMessageId: "m2" }), antes, "outra fixada (o Mostrar tudo da area e montado de novo)");
  assert.notEqual(chave({ pinnedPollId: null }), antes, "a enquete fixada saiu (encerrada sem resultado)");
  assert.notEqual(chave({ pinnedShortcuts: false }), antes, "as pilulas e as linhas das fixadas sairam");
  assert.notEqual(chave({}, { offerShown: true }), antes, "a Oferta mudou o cartao de celula (ele e montado de novo)");
  // Os mesmos itens, outro arranjo: so a celula muda (o banner sozinho embaixo a direita e o banner junto do QR Code).
  const dois = { ...base, items: [banner, qr] };
  const semOferta = sala.screenFocusKey({ ...dois, placement: sala.screenPlacement({ items: dois.items, offerShown: false, pinnedPills: true }) });
  const comOferta = sala.screenFocusKey({ ...dois, placement: sala.screenPlacement({ items: dois.items, offerShown: true, pinnedPills: true }) });
  assert.notEqual(comOferta, semOferta, "a mesma lista, outra celula");
  assert.match(semOferta, /top_right:b\+q/, "a celula e quem esta nela, na ordem");
  assert.notEqual(chave({ forced: true }), antes);
  assert.notEqual(chave({ fullscreen: true }), antes);
  assert.notEqual(chave({ items: [] }), antes);
});

test("a faixa forcada pela capa: na live, tudo menos a sala aberta com a pessoa dentro; na gravada, a espera, a sessao sem video, o fim e a capa Ativar som", () => {
  assert.equal(sala.screenStripForcedLive({ entry: "joined", screen: "open" }), false);
  for (const entry of ["idle", "opening", "joining", "reconnecting", "lost", "open_failed"]) {
    assert.equal(sala.screenStripForcedLive({ entry, screen: "open" }), true, entry);
  }
  for (const screen of ["waiting", "locked", "ended", "soon", "kicked"]) {
    assert.equal(sala.screenStripForcedLive({ entry: "joined", screen }), true, screen);
  }
  assert.equal(sala.screenStripForcedRecorded({ hasVideo: true, soundCover: false, stageState: "live" }), false);
  assert.equal(sala.screenStripForcedRecorded({ hasVideo: true, soundCover: true, stageState: "live" }), true, "Ativar som");
  assert.equal(sala.screenStripForcedRecorded({ hasVideo: false, soundCover: false, stageState: "live" }), true, "sem video");
  assert.equal(sala.screenStripForcedRecorded({ hasVideo: true, soundCover: false, stageState: "waiting" }), true, "a espera");
});

test("os textos do cartao e da linha: o nome da secao, o titulo (sem ele, a descricao da imagem), a segunda linha (o texto numa linha; no QR Code, o dominio), o Mostrar e o que o banner faz com o link", () => {
  const imagem = { alt: "Foguete subindo", height: 360, url: `${ORIGEM}/storage/v1/object/public/content-assets/${IMAGEM}`, width: 640 };
  assert.equal(sala.screenSectionName(itemDoAluno("b", "banner", "center")), "Banner da equipe: Turma nova");
  assert.equal(sala.screenSectionName(itemDoAluno("b", "banner", "center", { image: imagem, title: null })), "Banner da equipe: Foguete subindo");
  assert.equal(sala.screenSectionName(itemDoAluno("q", "qr", "center")), "QR Code da equipe: Aponte a câmera");
  assert.equal(sala.screenSectionName(itemDoAluno("q", "qr", "center", { title: null })), "QR Code da equipe");
  assert.equal(sala.screenRowTitle(itemDoAluno("q", "qr", "center", { title: null })), "QR Code");
  assert.equal(sala.screenRowDetail(itemDoAluno("b", "banner", "center", { body: "Vagas\n  até   sexta." })), "Vagas até sexta.");
  assert.equal(sala.screenRowDetail(itemDoAluno("q", "qr", "center", { linkUrl: "https://www.bunker707.com.br/x" })), "bunker707.com.br");
  assert.equal(sala.screenRowExpandable(itemDoAluno("b", "banner", "center")), false, "so o titulo: nada a mais");
  assert.equal(sala.screenRowExpandable(itemDoAluno("b", "banner", "center", { body: "Mais." })), true);
  assert.equal(sala.screenRowExpandable(itemDoAluno("b", "banner", "center", { image: imagem })), true);
  assert.equal(sala.screenRowExpandable(itemDoAluno("q", "qr", "center")), true);
  assert.equal(sala.screenBannerAction(itemDoAluno("b", "banner", "center", { buttonLabel: "Quero" })), "button");
  assert.equal(sala.screenBannerAction(itemDoAluno("b", "banner", "center")), "card");
  assert.equal(sala.screenBannerAction(itemDoAluno("b", "banner", "center", { linkUrl: null })), "none");
  assert.equal(sala.screenBannerAction(itemDoAluno("b", "banner", "center", { buttonLabel: "Quero", linkUrl: "javascript:alert(1)" })), "none", "o link e conferido de novo no navegador");
  assert.equal(sala.screenLinkOf(itemDoAluno("q", "qr", "center", { linkUrl: `https://bunker707.com.br/${"x".repeat(240)}` })), null, "o QR Code com o limite dele");
  assert.equal(sala.screenImageSrc(imagem.url), imagem.url);
  for (const url of ["https://cdn.de-fora.com/x.webp", `${ORIGEM}/storage/v1/object/public/content-assets/communications/0123456789abcdef01234567.webp`, `${imagem.url}?x=1`, "javascript:alert(1)", null]) {
    assert.equal(sala.screenImageSrc(url), null, String(url));
  }
});

test("o anuncio educado: so as chegadas (a primeira leitura nao anuncia), com as frases da especificacao; duas de uma vez, uma depois da outra", () => {
  const b = itemDoAluno("b", "banner", "center");
  const q = itemDoAluno("q", "qr", "center");
  assert.deepEqual(sala.screenArrivals(["b"], [b, q]).map((item) => item.displayId), ["q"]);
  assert.deepEqual(sala.screenArrivals(["b", "q"], [b]), [], "a saida e silenciosa");
  assert.equal(sala.screenAnnouncement([b]), "A equipe colocou um banner na tela: Turma nova.");
  assert.equal(sala.screenAnnouncement([q]), "A equipe mostrou um QR Code: Aponte a câmera. O link está no botão Abrir o link.");
  assert.equal(sala.screenAnnouncement([b, q]), "A equipe colocou um banner na tela: Turma nova. A equipe mostrou um QR Code: Aponte a câmera. O link está no botão Abrir o link.");
});

/** Um relogio falso para os timers injetados. */
function relogioFalso() {
  let agora = 0;
  let proximo = 1;
  const timers = new Map();
  return {
    avancar(ms) {
      const alvo = agora + ms;
      for (;;) {
        const vencido = [...timers.entries()].filter(([, timer]) => timer.at <= alvo).sort((a, b) => a[1].at - b[1].at)[0];
        if (!vencido) {
          break;
        }
        timers.delete(vencido[0]);
        agora = vencido[1].at;
        vencido[1].callback();
      }
      agora = alvo;
    },
    clearTimer: (id) => timers.delete(id),
    pendentes: () => timers.size,
    setTimer(callback, ms) {
      const id = proximo++;
      timers.set(id, { at: agora + ms, callback });
      return id;
    }
  };
}

test("o envio das metricas: o viu uma vez por exibicao (os vistos), depois de 0 a 5 s ao acaso, pelo fetch; o clique e o fechar na hora, pelo sendBeacon, levando a fila; lotes de ate 6; o pagehide leva o viu que esperava", () => {
  const relogio = relogioFalso();
  const posts = [];
  const beacons = [];
  const vistos = new Set();
  let acaso = 0.5;
  const sender = sala.createScreenEventSender({
    beacon: (body) => beacons.push(JSON.parse(body)),
    clearTimer: relogio.clearTimer,
    post: async (body) => posts.push(JSON.parse(body)),
    random: () => acaso,
    seen: { add: (id) => vistos.add(id), has: (id) => vistos.has(id) },
    sessionId: SESSAO,
    setTimer: relogio.setTimer
  });
  sender.send({ displayId: "b", form: "stage", name: "shown" });
  sender.send({ displayId: "b", form: "strip", name: "shown" });
  assert.equal(sender.pending(), 1, "uma vez por exibicao");
  relogio.avancar(2499);
  assert.equal(posts.length, 0, "ainda no atraso (0,5 x 5 s)");
  relogio.avancar(1);
  assert.deepEqual(posts, [{ events: [{ displayId: "b", form: "stage", name: "shown" }], sessionId: SESSAO }]);
  sender.send({ displayId: "b", form: "stage", name: "shown" });
  assert.equal(sender.pending(), 0, "o mesmo viu nao volta (o sessionStorage guarda)");

  sender.send({ displayId: "b", form: "stage", name: "clicked", target: "button" });
  assert.deepEqual(beacons, [{ events: [{ displayId: "b", form: "stage", name: "clicked", target: "button" }], sessionId: SESSAO }], "o clique na hora, pelo beacon");
  sender.send({ displayId: "q", form: "strip", name: "closed" });
  assert.deepEqual(beacons[1].events, [{ displayId: "q", form: "strip", name: "closed" }], "o fechar sem alvo");

  acaso = 1;
  sender.send({ displayId: "q", form: "strip", name: "shown" });
  assert.equal(sender.pending(), 1);
  sender.flushAll();
  assert.equal(sender.pending(), 0);
  assert.deepEqual(beacons[2].events, [{ displayId: "q", form: "strip", name: "shown" }], "o pagehide leva o viu que esperava, pelo beacon");
  assert.equal(relogio.pendentes(), 0, "nenhum timer sobrando");
  assert.deepEqual(sala.screenEventBodies(SESSAO, []), []);
  const sete = Array.from({ length: 7 }, (_, index) => ({ displayId: `d${index}`, form: "stage", name: "clicked", target: "card" }));
  assert.deepEqual(sala.screenEventBodies(SESSAO, sete).map((body) => JSON.parse(body).events.length), [6, 1], "lotes de ate 6");
  assert.equal(sala.screenShownDelayMs(0), 0);
  assert.equal(sala.screenShownDelayMs(1), 5000);
  assert.equal(sala.screenShownDelayMs(Number.NaN), 0);
  // O corpo passa no schema da rota.
  for (const body of [...posts, ...beacons]) {
    assert.equal(schemas.screenEventsBodySchema.safeParse({ ...body, events: body.events.map((event) => ({ ...event, displayId: EXIBICAO })) }).success, true);
  }
});

test("o viu: 1 s seguido com 50 % ou mais na tela, a aba visivel e sem a enquete do palco por cima; qualquer interrupcao recomeca; uma vez por exibicao, mesmo no cartao e na linha", () => {
  const relogio = relogioFalso();
  const vistos = [];
  const watcher = sala.createShownWatcher({ clearTimer: relogio.clearTimer, onShown: (displayId, form) => vistos.push([displayId, form]), pollOver: false, setTimer: relogio.setTimer, visible: true });
  const cartao = {};
  const linha = {};
  watcher.update(cartao, { displayId: "b", form: "stage", intersecting: true });
  relogio.avancar(600);
  watcher.update(cartao, { displayId: "b", form: "stage", intersecting: false });
  relogio.avancar(600);
  watcher.update(cartao, { displayId: "b", form: "stage", intersecting: true });
  relogio.avancar(999);
  assert.deepEqual(vistos, [], "saiu da tela: a conta recomecou");
  watcher.setGlobal({ pollOver: true });
  relogio.avancar(2000);
  assert.deepEqual(vistos, [], "a enquete do palco por cima");
  watcher.setGlobal({ pollOver: false, visible: false });
  relogio.avancar(2000);
  assert.deepEqual(vistos, [], "a aba escondida");
  watcher.setGlobal({ visible: true });
  relogio.avancar(1000);
  assert.deepEqual(vistos, [["b", "stage"]]);
  watcher.update(linha, { displayId: "b", form: "strip", intersecting: true });
  relogio.avancar(5000);
  assert.deepEqual(vistos, [["b", "stage"]], "a mesma exibicao na linha nao conta de novo");
  watcher.update(linha, { displayId: "q", form: "strip", intersecting: true });
  watcher.remove(linha);
  relogio.avancar(5000);
  assert.deepEqual(vistos, [["b", "stage"]], "a linha que saiu da tela nao conta");
  watcher.update(linha, { displayId: "q", form: "strip", intersecting: true });
  watcher.dispose();
  assert.equal(relogio.pendentes(), 0, "o dispose limpa os timers");
});
