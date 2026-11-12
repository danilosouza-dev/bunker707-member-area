import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// "O que abre o link" do banner da Na tela (rodada v9, P3; docs/30 D87; docs/18 §2.2), no Node e sem navegador. O
// produtor (12/11/2026): "quando tem botao a imagem nao fica clicavel, so o botao; quando nao tem botao a imagem fica
// clicavel. Nao tem como os dois ficar ou eu pode escolher para ambos ou so um ou so outro?". A escolha: Imagem e
// botão (o padrao), Só o botão, Só a imagem. Aqui: a regra pura e o zod do salvar, a linha do banco (com e sem a coluna
// da 202611150001), a copia congelada (a de antes continua "so o botao"), o item que a sala recebe e o cartao e a
// linha desenhados em cada opcao. O formulario do console fica em webinarios-na-tela-console-tela; a coluna, em
// webinarios-v9.guard; o banco de verdade, em tests/integration/webinarios-v9.

const model = await import("../src/server/webinars/screen-model.ts");
const schemas = await import("../src/server/webinars/screen-schemas.ts");
const rows = await import("../src/server/webinars/screen-rows.ts");
const roomModel = await import("../src/components/member/webinars/room/screen/room-screen-model.ts");
const cardModule = await import("../src/components/member/webinars/room/screen/room-screen-card.tsx");
const stripModule = await import("../src/components/member/webinars/room/screen/room-screen-strip.tsx");
const { NA_TELA_COPY } = await import("../src/lib/webinar-copy-v4/na-tela.ts");

const render = (component, props) => renderToStaticMarkup(createElement(component, props)).replace(/<link rel="preload" as="image"[^>]*\/>/g, "");
const linksDe = (html) => [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attrs, texto]) => ({ href: /href="([^"]*)"/.exec(attrs)?.[1] ?? null, texto: texto.replace(/<[^>]+>/g, "").trim() }));

const WEBINAR = "aaaaaaaa-0000-4000-8000-000000000001";
const ORIGEM = "https://abcdefgh.supabase.co";
const CAMINHO = "webinars/screen/0123456789abcdef01234567.webp";
const TURMA = "https://bunker707.com.br/turma";
const BANNER = { body: "Vagas até sexta.", buttonLabel: "BTN", closable: true, imageAlt: "Batatas", imagePath: CAMINHO, kind: "banner", linkUrl: TURMA, title: "so um titulo", webinarId: WEBINAR };
const salvar = (extra = {}) => {
  const parsed = schemas.screenItemInputSchema.safeParse({ ...BANNER, ...extra });
  return parsed.success ? { ok: true, value: parsed.data } : { errors: Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])), ok: false };
};

test("as tres opcoes e o padrao: Imagem e botão, Só o botão, Só a imagem; as frases no arquivo de frases", () => {
  assert.deepEqual([...model.SCREEN_LINK_TARGETS], ["both", "button", "image"]);
  assert.equal(model.SCREEN_DEFAULT_LINK_TARGET, "both", "o padrao do pedido: os dois abrem o link");
  assert.equal(model.SCREEN_LEGACY_LINK_TARGET, "button", "o que ja foi mostrado e o banco sem a coluna: so o botao, como era");
  assert.equal(NA_TELA_COPY.formulario.oQueAbreOLink, "O que abre o link");
  assert.deepEqual(NA_TELA_COPY.formulario.alvosDoLink, { both: "Imagem e botão", button: "Só o botão", image: "Só a imagem" });
  assert.equal(model.SCREEN_V9_MIGRATION, "202611150001");
});

test("o salvar: sem escolha vale Imagem e botão; Só a imagem grava sem o texto do botao; Só o botão pede o texto; fora do banner com link, o padrao", () => {
  const padrao = salvar();
  assert.deepEqual([padrao.ok, padrao.value.linkTarget, padrao.value.buttonLabel], [true, "both", "BTN"], "a pagina aberta antes da troca (sem o campo) grava o padrao");
  assert.deepEqual([salvar({ linkTarget: "button" }).value.linkTarget, salvar({ linkTarget: "button" }).value.buttonLabel], ["button", "BTN"]);
  const soImagem = salvar({ linkTarget: "image" });
  assert.deepEqual([soImagem.ok, soImagem.value.linkTarget, soImagem.value.buttonLabel], [true, "image", null], "um botao que nao abre nada confunde: sai");
  assert.deepEqual(salvar({ buttonLabel: "", linkTarget: "button" }).errors, { buttonLabel: NA_TELA_COPY.erros.soBotaoSemTexto });
  assert.equal(salvar({ buttonLabel: "", linkTarget: "both" }).ok, true, "sem texto do botao, o banner inteiro abre o link");
  assert.equal(salvar({ buttonLabel: "", linkTarget: "image" }).ok, true);
  // Sem link nao ha o que abrir: a escolha volta ao padrao (o botao sem link continua sendo erro, como antes).
  assert.equal(salvar({ buttonLabel: "", linkTarget: "button", linkUrl: "" }).value.linkTarget, "both");
  assert.deepEqual(salvar({ linkTarget: "image", linkUrl: "" }).errors, { linkUrl: NA_TELA_COPY.erros.botaoSemLink });
  assert.equal(salvar({ linkTarget: "nenhum" }).ok, false, "um valor fora da lista e recusado");
  // O QR Code nao tem a escolha.
  const qr = schemas.screenItemInputSchema.safeParse({ kind: "qr", linkTarget: "image", linkUrl: TURMA, webinarId: WEBINAR });
  assert.deepEqual([qr.success, qr.data.linkTarget], [true, "both"]);
  assert.deepEqual(model.screenLinkTargetOf({ buttonLabel: "Ir", kind: "banner", linkTarget: "image", linkUrl: TURMA }), { buttonLabel: null, linkTarget: "image" });
  assert.deepEqual(model.screenLinkTargetOf({ buttonLabel: "Ir", kind: "banner", linkUrl: TURMA }), { buttonLabel: "Ir", linkTarget: "both" });
});

const linha = (extra = {}) => ({
  archived_at: null,
  body: "Vagas até sexta.",
  button_label: "BTN",
  closable: true,
  created_at: "2026-11-12T20:00:00.000Z",
  created_by: null,
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  image_alt: "Batatas",
  image_height: 360,
  image_path: CAMINHO,
  image_width: 640,
  kind: "banner",
  link_url: TURMA,
  name: "Banner",
  place: "bottom_right",
  size: "m",
  title: "so um titulo",
  updated_at: "2026-11-12T20:00:00.000Z",
  webinar_id: WEBINAR,
  ...extra
});

test("a linha do banco: com a coluna, o valor dela; sem a coluna (o banco de antes da 202611150001) ou com um valor desconhecido, so o botao; a lista de sempre nao muda", () => {
  assert.equal(rows.screenItemFromRow(linha({ link_target: "both" })).linkTarget, "both");
  assert.equal(rows.screenItemFromRow(linha({ link_target: "image" })).linkTarget, "image");
  assert.equal(rows.screenItemFromRow(linha()).linkTarget, "button", "sem a coluna");
  assert.equal(rows.screenItemFromRow(linha({ link_target: "outro" })).linkTarget, "button", "um valor que este app nao conhece");
  assert.equal(rows.screenItemFromRow(linha({ kind: "qr", link_target: "image" })).linkTarget, "both", "no QR Code nao vale nada");
  assert.doesNotMatch(rows.SCREEN_ITEM_COLUMNS, /link_target/, "a lista que o app sempre le nao ganha coluna nova");
  assert.equal(rows.SCREEN_ITEM_COLUMNS_V9, `${rows.SCREEN_ITEM_COLUMNS}, link_target`, "a coluna nova e lida a parte");
  const base = { body: null, buttonLabel: "BTN", closable: true, image: null, kind: "banner", linkTarget: "image", linkUrl: TURMA, name: "Banner", place: "bottom_right", size: "m", title: "t" };
  assert.equal(rows.screenItemWriteOf(base).link_target, "image");
  assert.equal(rows.screenItemWriteOf({ ...base, kind: "qr" }).link_target, "both");
});

const exibicao = (snapshot, extra = {}) => ({
  createdAt: "2026-11-12T20:05:00.000Z",
  hiddenAt: null,
  hiddenBy: null,
  hiddenOffsetMs: null,
  hiddenReason: null,
  id: "dddddddd-0000-4000-8000-000000000001",
  itemId: "bbbbbbbb-0000-4000-8000-000000000001",
  kind: "banner",
  pollId: null,
  sessionId: "cccccccc-0000-4000-8000-000000000001",
  shownAt: "2026-11-12T20:05:00.000Z",
  shownBy: null,
  shownOffsetMs: 0,
  snapshot,
  ...extra
});

test("a copia congelada e o item do aluno: a escolha vai na copia; a copia de antes (sem a chave) continua so o botao; Só a imagem chega sem o botao", () => {
  const item = rows.screenItemFromRow(linha({ link_target: "both" }));
  const copia = model.snapshotOfItem(item);
  assert.equal(copia.linkTarget, "both");
  assert.deepEqual(schemas.parseScreenSnapshot("banner", JSON.parse(JSON.stringify(copia))), copia, "a copia volta igual na leitura");
  assert.equal(schemas.parseScreenSnapshot("banner", { ...copia, linkTarget: "tudo" }), null, "a copia com um valor fora da lista nao e desenhada");
  assert.equal(model.studentScreenItem(exibicao(copia), ORIGEM).linkTarget, "both");

  // A exibicao gravada antes da migracao nao tem a chave: a turma viu so o botao clicavel, e continua assim.
  const antiga = Object.fromEntries(Object.entries(copia).filter(([chave]) => chave !== "linkTarget"));
  const lida = schemas.parseScreenSnapshot("banner", antiga);
  assert.ok(lida && !("linkTarget" in lida), "a copia antiga passa no zod sem a chave");
  assert.equal(model.studentScreenItem(exibicao(lida), ORIGEM).linkTarget, "button");
  // O item mudou de "so o botao" para "Imagem e botão" depois de mostrado: o console oferece Mostrar de novo.
  assert.equal(model.screenSnapshotMatches(lida, item), false);
  assert.equal(model.screenSnapshotMatches(lida, { ...item, linkTarget: "button" }), true);
  assert.equal(model.screenItemShowState(item, [exibicao(lida)]), "again");
  assert.equal(model.screenItemShowState(item, [exibicao(copia)]), "on");

  const soImagem = model.studentScreenItem(exibicao({ ...copia, linkTarget: "image" }), ORIGEM);
  assert.deepEqual([soImagem.linkTarget, soImagem.buttonLabel, soImagem.linkUrl], ["image", null, TURMA], "o botao nao e desenhado");
  assert.equal(model.studentScreenItem(exibicao({ ...copia, kind: undefined, image: null, body: null, buttonLabel: null, linkTarget: "image" }, { kind: "qr" }), ORIGEM).linkTarget, "both");
});

const doAluno = (extra = {}) => ({
  body: "teste",
  buttonLabel: "BTN",
  closable: true,
  displayId: "dddddddd-0000-4000-8000-000000000001",
  image: { alt: "Batatas", height: 360, url: `${ORIGEM}/storage/v1/object/public/content-assets/${CAMINHO}`, width: 640 },
  kind: "banner",
  linkTarget: "both",
  linkUrl: TURMA,
  place: "bottom_right",
  shownAt: "2026-11-12T20:05:00.000Z",
  size: "m",
  title: "so um titulo",
  ...extra
});

test("o que o banner faz com o link em cada opcao (screenBannerAction)", () => {
  const acao = (extra) => roomModel.screenBannerAction(doAluno(extra));
  assert.equal(acao({ linkTarget: "both" }), "both");
  assert.equal(acao({ linkTarget: "button" }), "button");
  assert.equal(acao({ linkTarget: "image" }), "card");
  assert.equal(acao({ linkTarget: undefined }), "button", "o servidor de antes (sem a chave): so o botao, como era");
  assert.equal(acao({ buttonLabel: null, linkTarget: "both" }), "card", "sem texto do botao, o banner inteiro");
  assert.equal(acao({ buttonLabel: null, linkTarget: "button" }), "card");
  assert.equal(acao({ linkUrl: null }), "none");
  assert.equal(acao({ linkUrl: "http://bunker707.com.br" }), "none", "so https");
});

test("o cartao no palco: Imagem e botão, a imagem e o botao sao dois links irmaos para o mesmo endereco; Só o botão, um link; Só a imagem, o banner e o link e o botao nao aparece", () => {
  const ambos = render(cardModule.RoomScreenCard, { item: doAluno() });
  const links = linksDe(ambos);
  assert.deepEqual(links.map((link) => link.href), [TURMA, TURMA], "dois links para o mesmo endereco");
  assert.match(links[0].texto, /so um titulo\s*teste/, "o primeiro e o banner (a imagem, o titulo e o texto)");
  assert.equal(links[1].texto, "BTN", "o segundo e o botao");
  assert.match(ambos, /<a [^>]*data-room-screen-link=""[^>]*>(?:(?!<\/a>)[\s\S])*<img /, "a imagem dentro do link do banner");
  assert.doesNotMatch(ambos, /<a\b(?:(?!<\/a>)[\s\S])*<a\b/, "nenhum link dentro de outro");
  assert.ok(ambos.indexOf("Fechar o banner") > ambos.lastIndexOf("</a>"), "o X fora dos links");
  assert.ok([...ambos.matchAll(/rel="noopener noreferrer nofollow" target="_blank"/g)].length === 2, "os dois em outra aba, sem passar quem abriu");

  const soBotao = linksDe(render(cardModule.RoomScreenCard, { item: doAluno({ linkTarget: "button" }) }));
  assert.deepEqual(soBotao.map((link) => [link.href, link.texto]), [[TURMA, "BTN"]], "so o botao e link, como antes");

  const soImagem = render(cardModule.RoomScreenCard, { item: doAluno({ buttonLabel: null, linkTarget: "image" }) });
  assert.deepEqual(linksDe(soImagem).map((link) => link.href), [TURMA]);
  assert.doesNotMatch(soImagem, />BTN</, "sem o botao");
  assert.match(soImagem, /<a [^>]*>(?:(?!<\/a>)[\s\S])*<img /, "a imagem e o link");
});

test("a linha da faixa (o palco estreito e a capa): uma acao so por linha; com o botao clicavel, o texto dele; com Só a imagem, Abrir o link", () => {
  const acao = (extra) => linksDe(render(stripModule.RoomScreenRow, { expanded: false, item: doAluno(extra), onToggle: () => undefined }));
  assert.deepEqual(acao({ linkTarget: "both" }).map((link) => [link.href, link.texto]), [[TURMA, "BTN"]]);
  assert.deepEqual(acao({ linkTarget: "button" }).map((link) => [link.href, link.texto]), [[TURMA, "BTN"]]);
  assert.deepEqual(acao({ buttonLabel: null, linkTarget: "image" }).map((link) => [link.href, link.texto]), [[TURMA, NA_TELA_COPY.aluno.abrirOLink]]);
});
