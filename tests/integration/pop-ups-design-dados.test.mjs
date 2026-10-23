import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Design do pop-up (docs/26), o caminho dos dados contra o banco LOCAL (pacote P0): salvar o Personalizado grava
// popup_design na forma canonica com o endereco do video recalculado (so o nosso bucket); fonte fora da biblioteca
// e 400 no campo; o rascunho sem a chave mantem o design gravado e null volta ao Padrão; a notificacao nunca
// guarda design; duplicar copia; o resumo do aluno entrega o design e as fontes resolvidas (o Padrão continua
// sem a chave); design invalido no banco = Padrão; o relatorio e o editor recebem as fontes. O envio de video e
// fonte (pacote U), o desenho do aluno (S) e o editor (A) tem os proprios testes.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { getNoticeDetail, loadNoticeEditorOptions } = await import("../../src/server/communications/queries.ts");
const model = await import("../../src/server/communications/popup-design-model.ts");
const summaryRoute = await import("../../src/app/api/notifications/summary/route.ts");

const { cursoBloqueado } = ESCOLA_DE_TESTE;
const PRODUTO = cursoBloqueado.id;
const ACESSO = "teste-pop-ups-design-dados:";
const aluna = usuarioDeTeste(contas.aluna);
const produtor = usuarioDeTeste(contas.produtor);
const TODAS = { canPublish: true, canPublishLarge: true, canWrite: true };
const VIDEO_PATH = `videos/${randomUUID()}.mp4`;
const FONTE = { family_key: "bf_0a1b2c3d4e5f", file_path: "fonts/0a1b2c3d4e5f0a1b2c3d4e5f.woff2", format: "woff2", name: "Fonte de teste do design", size_bytes: 1234, style: "normal", weight: 700 };
const FONTE_EXCLUIDA = { ...FONTE, deleted_at: "2026-10-22T12:00:00.000Z", family_key: "bf_ffffffffffff", file_path: "fonts/ffffffffffffffffffffffff.woff2", name: "Fonte excluida do design" };

const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };
const BOTAO = { href: `/conteudo/${PRODUTO}`, label: "Ver o curso", target: "same_tab" };
const IMAGEM = { alt: "", url: "http://127.0.0.1:55321/storage/v1/object/public/content-assets/communications/images/capa-de-teste.webp" };

let fonte;
let fonteExcluida;

async function apagarFontes() {
  unwrap(await db.from("communication_fonts").delete().in("family_key", [FONTE.family_key, FONTE_EXCLUIDA.family_key]), "Apagando fontes de teste");
}

async function limpar() {
  await limparComunicacao(db);
  unwrap(await db.from("entitlements").delete().like("source_event_id", `${ACESSO}%`), "Apagando acessos de teste");
}

before(async () => {
  await limpar();
  await apagarFontes();
  // Sem created_by: limparComunicacao (a cada teste) apaga as fontes das contas de teste; estas vivem o arquivo todo.
  [fonte] = unwrap(await db.from("communication_fonts").insert({ ...FONTE, created_by: null }).select("*"), "Criando a fonte");
  [fonteExcluida] = unwrap(await db.from("communication_fonts").insert({ ...FONTE_EXCLUIDA, created_by: null }).select("*"), "Criando a fonte excluida");
  // Um video de verdade no caminho: salvar confere o objeto (existe, tamanho e primeiros bytes).
  const mp4 = readFileSync(new URL("../fixtures/popup-design/video-de-teste.mp4", import.meta.url));
  unwrap(await db.storage.from(model.POPUP_VIDEO_BUCKET).upload(VIDEO_PATH, mp4, { contentType: "video/mp4", upsert: true }), "Enviando o video de teste");
});

after(async () => {
  await limpar();
  await apagarFontes();
  unwrap(await db.storage.from(model.POPUP_VIDEO_BUCKET).remove([VIDEO_PATH]), "Apagando o video de teste");
});

beforeEach(async () => {
  await limpar();
  unwrap(
    await db.from("entitlements").insert({
      ends_at: null,
      source_event_id: `${ACESSO}${aluna.id}:${randomUUID()}`,
      source_provider: "manual",
      starts_at: "2026-01-01T12:00:00.000Z",
      status: "active",
      target_id: PRODUTO,
      target_type: "standalone_course",
      user_id: aluna.id
    }),
    "Liberando acesso de teste"
  );
});

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function design({ fontId = null, video = false } = {}) {
  const base = structuredClone(model.popupStarterDesign("media_top_fade"));

  if (fontId) {
    base.blocks[1].style.font = { id: fontId, kind: "uploaded" };
  }

  if (video) {
    // O endereco que o navegador manda e ignorado: o servidor recalcula a partir do caminho.
    base.media = { ...base.media, kind: "video", video: { mimeType: "video/mp4", path: VIDEO_PATH, url: `https://outro.supabase.co/storage/v1/object/public/communication-popup-video/${VIDEO_PATH}` } };
  }

  return base;
}

function popup(extra = {}) {
  return { ...emptyNoticeDraft("popup"), audience: quemTemOProduto, body: "Texto do Padrão.", cta: BOTAO, image: IMAGEM, title: "Pop-up com design", ...extra };
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function salvar(draft, id) {
  actAs(produtor);
  return actions.saveNoticeDraft(id ? { draft, id } : { draft });
}

async function linha(id) {
  return unwrap(await db.from("campaigns").select("popup_design,kind").eq("id", id).single(), "Lendo o aviso");
}

async function popupDaAluna() {
  actAs(aluna);
  const response = await summaryRoute.GET(new Request("http://localhost/api/notifications/summary?popup=1"));
  assert.equal(response.status, 200);

  return (await response.json()).data.popup;
}

/* ------------------------------------------------------------------------------------------------
 * Testes
 * ---------------------------------------------------------------------------------------------- */

test("salvar o Personalizado grava o design canonico, com o endereco do video do nosso bucket; a auditoria diz custom", async () => {
  const enviado = design({ fontId: fonte.id.toUpperCase(), video: true });
  enviado.links.color = "#A1A1AA";
  const salvo = ok(await salvar(popup({ design: enviado })));
  const gravado = (await linha(salvo.id)).popup_design;
  const urlDoVideo = db.storage.from(model.POPUP_VIDEO_BUCKET).getPublicUrl(VIDEO_PATH).data.publicUrl;

  assert.equal(gravado.links.color, "#a1a1aa", "forma canonica");
  assert.deepEqual(gravado.fonts, [fonte.id], "fontes recalculadas dos blocos");
  assert.equal(gravado.media.video.url, urlDoVideo, "o endereco do navegador nunca e gravado");
  assert.ok(model.isOwnStorageUrl(gravado.media.video.url, { bucket: model.POPUP_VIDEO_BUCKET, objectPath: VIDEO_PATH, origin: new URL(urlDoVideo).origin }));

  const [auditoria] = unwrap(
    await db.from("admin_audit_log").select("metadata").eq("entity_id", salvo.id).eq("action", "communication.saved").order("occurred_at", { ascending: false }).limit(1),
    "Lendo a auditoria"
  );
  assert.equal(auditoria.metadata.popup_design, "custom");
  assert.equal(JSON.stringify(auditoria.metadata).includes("Conteúdo novo"), false, "a auditoria nunca leva o conteudo do design");
});

test("fonte fora da biblioteca (inexistente ou excluida) e 400 em design.fonts; nada e gravado", async () => {
  for (const fontId of [randomUUID(), fonteExcluida.id]) {
    const result = await salvar(popup({ design: design({ fontId }) }));

    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.deepEqual(result.fieldErrors, { "design.fonts": ["Esta fonte não está mais na biblioteca. Escolha outra."] });
  }

  const { count } = await db.from("campaigns").select("id", { count: "exact", head: true }).eq("created_by", produtor.id);
  assert.equal(count, 0);
});

test("design e conteudo juntos no servidor: botao sem o bloco e 400 em design.blocks", async () => {
  const semBotao = design();
  semBotao.blocks = semBotao.blocks.filter((block) => block.type !== "button");
  const result = await salvar(popup({ design: semBotao }));

  assert.equal(result.ok, false);
  // Erro do zod vem com o prefixo da entrada ("draft."); o editor tira (noticeErrorsFromAction).
  assert.deepEqual(result.fieldErrors, { "draft.design.blocks": ["Falta o bloco do botão principal no design."] });
});

test("rascunho sem a chave mantem o design gravado; null volta ao Padrão; a notificacao nunca guarda design", async () => {
  const salvo = ok(await salvar(popup({ design: design() })));
  const semChave = popup({ title: "Outro titulo" });
  delete semChave.design;

  const mantido = ok(await salvar(semChave, salvo.id));
  assert.notEqual((await linha(mantido.id)).popup_design, null, "sem a chave = o design gravado");

  ok(await salvar(popup({ design: null }), salvo.id));
  assert.equal((await linha(salvo.id)).popup_design, null, "null = Padrão");

  const notificacao = ok(await salvar({ ...emptyNoticeDraft("inbox"), audience: quemTemOProduto, design: design(), title: "Notificação" }));
  assert.deepEqual(await linha(notificacao.id), { kind: "inbox", popup_design: null });
});

test("duplicar copia o design; o relatorio leva o design e as fontes resolvidas; o editor recebe a biblioteca sem as excluidas", async () => {
  const salvo = ok(await salvar(popup({ design: design({ fontId: fonte.id }) })));
  actAs(produtor);
  const copia = ok(await actions.duplicateNotice({ id: salvo.id }));

  assert.deepEqual((await linha(copia.id)).popup_design, (await linha(salvo.id)).popup_design);

  actAs(produtor);
  const detalhe = await getNoticeDetail(copia.id, { permissions: TODAS });
  assert.equal(detalhe.draft.design.fonts[0], fonte.id);
  assert.deepEqual(detalhe.designFonts, [
    {
      family: FONTE.family_key,
      format: "woff2",
      id: fonte.id,
      style: "normal",
      url: db.storage.from(model.POPUP_FONTS_BUCKET).getPublicUrl(FONTE.file_path).data.publicUrl,
      weight: 700
    }
  ]);

  actAs(produtor);
  const opcoes = await loadNoticeEditorOptions();
  assert.ok(opcoes.popupFonts.some((item) => item.id === fonte.id && item.name === FONTE.name && item.sizeBytes === 1234));
  assert.equal(opcoes.popupFonts.some((item) => item.id === fonteExcluida.id), false);
});

test("o aluno recebe o design e as fontes resolvidas; o Padrão e o design invalido no banco continuam sem a chave", async () => {
  actAs(produtor);
  const salvo = ok(await salvar(popup({ design: design({ fontId: fonte.id }) })));
  actAs(produtor);
  ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));

  const comDesign = await popupDaAluna();
  assert.equal(comDesign.id, salvo.id);
  assert.deepEqual(comDesign.design, (await linha(salvo.id)).popup_design);
  assert.deepEqual(comDesign.fonts.map((face) => [face.id, face.family]), [[fonte.id, FONTE.family_key]]);
  assert.equal(new URL(comDesign.fonts[0].url).pathname, `/storage/v1/object/public/${model.POPUP_FONTS_BUCKET}/${FONTE.file_path}`);

  // Design de outra versao gravado direto no banco: o aluno ve o Padrão (o check so exige objeto com versao).
  unwrap(await db.from("campaigns").update({ popup_design: { blocks: "x", version: 2 } }).eq("id", salvo.id), "Gravando um design de outra versao");
  const { invalidateLivePopups } = await import("../../src/server/communications/cache.ts");
  invalidateLivePopups({ from: "route" });
  const padrao = await popupDaAluna();
  assert.equal(padrao.id, salvo.id);
  assert.equal("design" in padrao, false);
  assert.equal("fonts" in padrao, false);
});

test("o banco recusa design em notificacao, design que nao e objeto e objeto sem versao", async () => {
  const salvo = ok(await salvar(popup({ design: null })));
  const notificacao = ok(await salvar({ ...emptyNoticeDraft("inbox"), audience: quemTemOProduto, title: "Notificação" }));

  for (const [id, value] of [
    [notificacao.id, { version: 1 }],
    [salvo.id, ["lista"]],
    [salvo.id, { blocks: [] }]
  ]) {
    const { error } = await db.from("campaigns").update({ popup_design: value }).eq("id", id);
    assert.match(error?.message ?? "", /campaigns_popup_design_v1/, JSON.stringify(value));
  }
});

/* ------------------------------------------------------------------------------------------------
 * Degrade com comeco e fim e imagem no fundo do cartao (docs/26, "Suba o escuro")
 * ---------------------------------------------------------------------------------------------- */

/** WebP minimo (cabecalho VP8X) do tamanho dado: o que o recorte do navegador manda ao uploadNoticeImage. */
function webpDataUrl(width, height) {
  const bytes = new Uint8Array(32);
  bytes.set([0x52, 0x49, 0x46, 0x46, 0x38, 0x0a, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00], 0);
  bytes.set([(width - 1) & 0xff, ((width - 1) >> 8) & 0xff, ((width - 1) >> 16) & 0xff], 24);
  bytes.set([(height - 1) & 0xff, ((height - 1) >> 8) & 0xff, ((height - 1) >> 16) & 0xff], 27);
  // Bytes diferentes a cada chamada: outro sha256, outro caminho (o teste nunca reaproveita um objeto antigo).
  bytes.set(randomUUID().replaceAll("-", "").slice(0, 2).split("").map((char) => char.charCodeAt(0)), 30);

  return `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;
}

function comImagemNoFundo(url) {
  const base = design();
  base.card.background = { color: "#16181C", dim: 40, kind: "image", position: "bottom", url };
  return base;
}

test("imagem no fundo do cartao: a do uploadNoticeImage salva com o nosso endereco; de fora ou sem arquivo e recusada", async () => {
  actAs(produtor);
  const enviada = ok(await actions.uploadNoticeImage({ image: webpDataUrl(1280, 720) }));
  const caminho = enviada.url.split(`/${model.POPUP_CARD_IMAGE_BUCKET}/`)[1];
  assert.match(caminho, model.POPUP_CARD_IMAGE_PATH_PATTERN);
  const nossa = db.storage.from(model.POPUP_CARD_IMAGE_BUCKET).getPublicUrl(caminho).data.publicUrl;

  try {
    // O navegador manda o caminho certo com outra origem: o servidor grava o nosso endereco.
    const salvo = ok(await salvar(popup({ design: comImagemNoFundo(enviada.url.replace(new URL(enviada.url).origin, "https://outro.supabase.co")) })));
    const gravado = (await linha(salvo.id)).popup_design;
    assert.deepEqual(gravado.card.background, { color: "#16181c", dim: 40, kind: "image", position: "bottom", url: nossa });

    // Salvar de novo com a mesma imagem (o caminho ja gravado) nao confere o Storage outra vez e continua valendo.
    ok(await salvar(popup({ design: comImagemNoFundo(nossa), title: "Mesmo fundo" }), salvo.id));

    // Endereco de fora: o schema recusa no campo da imagem do fundo, nada muda na linha.
    const deFora = await salvar(popup({ design: comImagemNoFundo("https://cdn.exemplo.com/fundo.webp") }), salvo.id);
    assert.equal(deFora.ok, false);
    assert.equal(deFora.status, 400);
    assert.deepEqual(deFora.fieldErrors, { "draft.design.card.background.url": ["Envie a imagem do fundo de novo."] });

    // O nosso formato de caminho, mas sem arquivo no Storage: recusado pela conferencia do servidor.
    const semArquivo = await salvar(popup({ design: comImagemNoFundo(nossa.replace(/[a-f0-9]{24}\.webp$/, "0".repeat(24) + ".webp")) }), salvo.id);
    assert.equal(semArquivo.ok, false);
    assert.equal(semArquivo.status, 400);
    assert.deepEqual(semArquivo.fieldErrors, { "design.card.background.url": ["Envie a imagem do fundo de novo."] });
    assert.deepEqual((await linha(salvo.id)).popup_design.card.background.url, nossa, "a linha continua com a imagem boa");

    // A aluna recebe o mesmo fundo (endereco recalculado na leitura tambem).
    const atual = unwrap(await db.from("campaigns").select("updated_at").eq("id", salvo.id).single(), "Lendo o aviso");
    actAs(produtor);
    ok(await actions.publishNotice({ expectedUpdatedAt: atual.updated_at, id: salvo.id }));
    const daAluna = await popupDaAluna();
    assert.equal(daAluna.id, salvo.id);
    assert.deepEqual(daAluna.design.card.background, { color: "#16181c", dim: 40, kind: "image", position: "bottom", url: nossa });
  } finally {
    unwrap(await db.storage.from(model.POPUP_CARD_IMAGE_BUCKET).remove([caminho]), "Apagando a imagem de teste");
  }
});

test("design gravado antes do 'Fica totalmente escuro em' (sem end): editor e aluna leem com end 100, o resto igual", async () => {
  const salvo = ok(await salvar(popup({ design: design() })));
  const antigo = structuredClone((await linha(salvo.id)).popup_design);
  delete antigo.media.fade.end;
  antigo.media.fade.height = 65;
  unwrap(await db.from("campaigns").update({ popup_design: antigo }).eq("id", salvo.id), "Gravando o design como a versao anterior gravava");
  assert.equal("end" in (await linha(salvo.id)).popup_design.media.fade, false);

  actAs(produtor);
  const detalhe = await getNoticeDetail(salvo.id, { permissions: TODAS });
  assert.deepEqual(detalhe.draft.design.media.fade, { ...antigo.media.fade, end: 100 });
  assert.deepEqual({ ...detalhe.draft.design, media: { ...detalhe.draft.design.media, fade: antigo.media.fade } }, antigo, "so o end entra");

  const atual = unwrap(await db.from("campaigns").select("updated_at").eq("id", salvo.id).single(), "Lendo o aviso");
  actAs(produtor);
  ok(await actions.publishNotice({ expectedUpdatedAt: atual.updated_at, id: salvo.id }));
  const daAluna = await popupDaAluna();
  assert.deepEqual(daAluna.design.media.fade, { ...antigo.media.fade, end: 100 });
});
