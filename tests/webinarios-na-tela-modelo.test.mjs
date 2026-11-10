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
// - as frases novas (WEBINAR_COPY.naTela) passam pela PROIBIDAS_WEBINARIO e estao como a especificacao escreve.

const model = await import("../src/server/webinars/screen-model.ts");
const schemas = await import("../src/server/webinars/screen-schemas.ts");
const rows = await import("../src/server/webinars/screen-rows.ts");
const { NA_TELA_COPY } = await import("../src/lib/webinar-copy-v4/na-tela.ts");
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
