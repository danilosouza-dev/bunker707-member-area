import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Design do pop-up (docs/26), envio de video e de fontes contra o banco e o Storage LOCAIS (pacote U):
// - fonte pela rota POST /api/admin/communications/popup-fonts: o formato vem dos bytes (o nome e o tipo que o
//   navegador manda nao valem), o objeto fica no bucket communication-fonts com o tipo do formato, o mesmo
//   arquivo nao duplica, HTML/executavel renomeados sao 422, acima de 2 MB e 413, a 41a fonte e 409 e quem nao
//   cria avisos recebe 403;
// - renomear e excluir pela biblioteca: fonte em uso por pop-up nao excluido nao sai (409); livre sai da
//   biblioteca e o arquivo fica (pop-up gravado nunca perde a fonte);
// - video: endereco assinado -> o navegador envia com a chave publica -> o servidor confere tamanho e os
//   primeiros bytes e devolve o PopupVideo do nosso bucket; bytes de outro tipo sao 422 e o objeto do envio novo some
//   (so ele: um caminho que um modelo cita fica; o salvar nunca apaga, docs/28 D16);
// - pop-up salvo com endereco de video de fora do nosso bucket e recusado (400 no campo do video).
// Arquivos de verdade em tests/fixtures/popup-design/ (ffmpeg e um subconjunto da Inter, OFL).

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const designActions = await import("../../src/server/communications/popup-design-actions.ts");
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const model = await import("../../src/server/communications/popup-design-model.ts");
const fontsRoute = await import("../../src/app/api/admin/communications/popup-fonts/route.ts");

const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
/** O navegador do admin: so a chave publica (o envio vale pelo token do endereco assinado). */
const navegador = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });

const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const PRODUTO = ESCOLA_DE_TESTE.cursoBloqueado.id;
const ORIGEM = new URL(supabaseUrl).origin;

const fixture = (name) => readFileSync(new URL(`../fixtures/popup-design/${name}`, import.meta.url));
const WOFF2 = fixture("fonte-de-teste.woff2");
const TTF = fixture("fonte-de-teste.ttf");
const MP4 = fixture("video-de-teste.mp4");
const WEBM = fixture("video-de-teste.webm");
const HTML = Buffer.from("<!doctype html><html><body><script>alert('oi')</script></body></html>");
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(254, 0x90)]);

const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };
const BOTAO = { href: `/conteudo/${PRODUTO}`, label: "Ver o curso", target: "same_tab" };
const IMAGEM = { alt: "", url: `${ORIGEM}/storage/v1/object/public/content-assets/communications/images/capa-de-teste.webp` };

/** Objetos criados no Storage pelo teste (apagados no fim). */
const criados = { [model.POPUP_FONTS_BUCKET]: new Set(), [model.POPUP_VIDEO_BUCKET]: new Set() };
/** Linhas da biblioteca criadas direto no banco (biblioteca cheia). */
const linhasDiretas = new Set();

async function limpar() {
  await limparComunicacao(db);

  if (linhasDiretas.size > 0) {
    unwrap(await db.from("communication_fonts").delete().in("id", [...linhasDiretas]), "Apagando a biblioteca cheia");
    linhasDiretas.clear();
  }
}

before(limpar);
beforeEach(limpar);

after(async () => {
  await limpar();

  for (const [bucket, paths] of Object.entries(criados)) {
    if (paths.size > 0) {
      unwrap(await db.storage.from(bucket).remove([...paths]), `Apagando os arquivos de teste de ${bucket}`);
    }
  }
});

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

/** Envia a fonte pela rota, como o dialogo "Enviar fonte" do editor. */
async function enviarFonte(user, { bytes = WOFF2, fileName = "Bunker-Teste_Bold.woff2", headers = {}, type = "font/woff2", ...fields } = {}) {
  actAs(user);
  const form = new FormData();

  if (bytes !== null) {
    form.append("file", new File([bytes], fileName, { type }));
  }

  for (const [key, value] of Object.entries(fields)) {
    form.append(key, value);
  }

  const response = await fontsRoute.POST(new Request("http://localhost/api/admin/communications/popup-fonts", { body: form, headers, method: "POST" }));
  const body = await response.json();

  if (response.status === 200) {
    criados[model.POPUP_FONTS_BUCKET].add(caminhoNoBucket(body.data.url, model.POPUP_FONTS_BUCKET));
  }

  return { body, status: response.status };
}

function caminhoNoBucket(url, bucket) {
  return new URL(url).pathname.split(`/storage/v1/object/public/${bucket}/`)[1];
}

async function fontesDoBanco() {
  return unwrap(await db.from("communication_fonts").select("*").is("deleted_at", null), "Lendo a biblioteca");
}

async function ultimaAuditoria(action, entityId) {
  let query = db.from("admin_audit_log").select("actor_id,entity_id,entity_type,metadata").eq("action", action).order("occurred_at", { ascending: false }).limit(1);

  if (entityId) {
    query = query.eq("entity_id", entityId);
  }

  return unwrap(await query, "Lendo a auditoria")[0];
}

/** Pop-up Personalizado ("Mídia no topo com degradê") com a fonte no titulo e/ou um video. */
function popupComDesign({ fontId = null, video = null } = {}) {
  const design = structuredClone(model.popupStarterDesign("media_top_fade"));

  if (fontId) {
    design.blocks[1].style.font = { id: fontId, kind: "uploaded" };
  }

  if (video) {
    design.media = { ...design.media, kind: "video", video };
  }

  return { ...emptyNoticeDraft("popup"), audience: quemTemOProduto, cta: BOTAO, design, image: IMAGEM, title: "Pop-up com design" };
}

async function salvar(draft) {
  actAs(produtor);
  return actions.saveNoticeDraft({ draft });
}

/** O caminho do envio direto: endereco assinado -> PUT com a chave publica -> conferencia. */
async function enviarVideo({ bytes, contentType, mimeType }) {
  actAs(produtor);
  const ticket = ok(await designActions.startPopupVideoUpload({ mimeType, sizeBytes: bytes.length }));
  criados[model.POPUP_VIDEO_BUCKET].add(ticket.path);
  unwrap(await navegador.storage.from(model.POPUP_VIDEO_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, bytes, { contentType }), "Enviando o video pelo endereco assinado");
  actAs(produtor);
  return { result: await designActions.finishPopupVideoUpload({ path: ticket.path }), ticket };
}

async function existeNoBucket(bucket, path) {
  const { error } = await db.storage.from(bucket).info(path);
  return !error;
}

/* ------------------------------------------------------------------------------------------------
 * Fontes
 * ---------------------------------------------------------------------------------------------- */

test("fonte: woff2 e ttf de verdade entram na biblioteca com o tipo dos bytes; o mesmo arquivo de novo devolve a mesma fonte", async () => {
  // O navegador diz "text/html": o servidor ignora e grava o tipo que os bytes mostram.
  const woff2 = await enviarFonte(produtor, { type: "text/html", weight: "700" });
  assert.equal(woff2.status, 200, JSON.stringify(woff2.body));

  const fonte = woff2.body.data;
  assert.equal(fonte.name, "Bunker-Teste Bold", "nome padrao = o arquivo sem extensao");
  assert.equal(fonte.format, "woff2");
  assert.equal(fonte.weight, 700);
  assert.equal(fonte.style, "normal");
  assert.equal(fonte.sizeBytes, WOFF2.length);
  assert.match(fonte.family, model.POPUP_FONT_FAMILY_PATTERN);
  assert.equal(fonte.family.includes("Bunker"), false, "a familia CSS nunca e o nome do produtor");
  assert.match(new URL(fonte.url).pathname, /^\/storage\/v1\/object\/public\/communication-fonts\/fonts\/[a-f0-9]{24}\.woff2$/);
  assert.equal(new URL(fonte.url).origin, ORIGEM, "o nosso Storage");

  const servido = await fetch(fonte.url);
  assert.equal(servido.status, 200, "o aluno baixa a fonte pelo endereco publico");
  assert.equal(servido.headers.get("content-type"), "font/woff2");
  assert.deepEqual(Buffer.from(await servido.arrayBuffer()), WOFF2);

  const [linha] = (await fontesDoBanco()).filter((row) => row.id === fonte.id);
  assert.equal(linha.created_by, produtor.id);
  assert.equal(linha.family_key, fonte.family);

  const auditoria = await ultimaAuditoria("communication.font_uploaded", fonte.id);
  assert.deepEqual(auditoria, { actor_id: produtor.id, entity_id: fonte.id, entity_type: "communication_font", metadata: { format: "woff2", size_bytes: WOFF2.length } });

  const repetida = await enviarFonte(produtor, { fileName: "outro-nome.woff2", name: "Outro nome" });
  assert.equal(repetida.status, 200);
  assert.equal(repetida.body.data.id, fonte.id, "o mesmo arquivo nao duplica");
  assert.equal((await fontesDoBanco()).filter((row) => row.file_path === linha.file_path).length, 1);

  const ttf = await enviarFonte(produtor, { bytes: TTF, fileName: "fonte.ttf", name: "  Minha  serifada ", style: "italic", type: "" });
  assert.equal(ttf.status, 200, JSON.stringify(ttf.body));
  assert.equal(ttf.body.data.name, "Minha serifada");
  assert.equal(ttf.body.data.format, "truetype");
  assert.equal(ttf.body.data.style, "italic");
  assert.equal(ttf.body.data.weight, 400, "peso padrao");
  assert.equal((await fetch(ttf.body.data.url)).headers.get("content-type"), "font/ttf");
  assert.notEqual(ttf.body.data.family, fonte.family);

  actAs(produtor);
  const biblioteca = ok(await designActions.listPopupFonts()).filter((item) => [fonte.id, ttf.body.data.id].includes(item.id));
  assert.deepEqual(biblioteca.map((item) => item.name), ["Bunker-Teste Bold", "Minha serifada"], "por nome");
  assert.deepEqual(Object.keys(biblioteca[0]).sort(), ["createdAt", "family", "format", "id", "name", "sizeBytes", "style", "url", "weight"]);
});

test("fonte: HTML e executavel renomeados sao 422, acima de 2 MB e 413, campos fora da lista sao 400; nada entra na biblioteca", async () => {
  const antes = (await fontesDoBanco()).length;
  const recusa = async (input, status, message) => {
    const result = await enviarFonte(produtor, input);
    assert.equal(result.status, status, JSON.stringify({ input: { ...input, bytes: undefined }, result }));
    assert.equal(result.body.error, message);
  };

  await recusa({ bytes: HTML, fileName: "fonte-bonita.woff2" }, 422, "Use uma fonte WOFF2, WOFF, TTF ou OTF.");
  await recusa({ bytes: EXE, fileName: "fonte.ttf", type: "font/ttf" }, 422, "Use uma fonte WOFF2, WOFF, TTF ou OTF.");
  await recusa({ bytes: MP4, fileName: "fonte.otf", type: "font/otf" }, 422, "Use uma fonte WOFF2, WOFF, TTF ou OTF.");
  await recusa({ bytes: Buffer.alloc(model.POPUP_FONT_LIMITS.maxBytes + 1, 1), fileName: "grande.woff2" }, 413, "A fonte deve ter no máximo 2 MB.");
  await recusa({ headers: { "content-length": String(3 * 1024 * 1024) } }, 413, "A fonte deve ter no máximo 2 MB.");
  await recusa({ bytes: null }, 400, "Escolha um arquivo de fonte.");
  await recusa({ weight: "450" }, 400, "Escolha um peso da lista.");
  await recusa({ style: "oblique" }, 400, "Escolha o estilo da fonte.");
  await recusa({ name: "N".repeat(61) }, 400, "Use de 1 a 60 caracteres.");

  actAs(produtor);
  const semMultipart = await fontsRoute.POST(new Request("http://localhost/api/admin/communications/popup-fonts", { body: "{}", headers: { "content-type": "application/json" }, method: "POST" }));
  assert.equal(semMultipart.status, 400);
  assert.equal((await semMultipart.json()).error, "Envie a fonte como arquivo.");

  assert.equal((await fontesDoBanco()).length, antes);
});

test("fonte: so quem cria avisos envia (analista 403, sem sessao 401)", async () => {
  assert.equal((await enviarFonte(analista)).status, 403);
  assert.equal((await enviarFonte(null)).status, 401);

  actAs(analista);
  assert.equal((await designActions.listPopupFonts()).status, 403);
  assert.equal((await designActions.startPopupVideoUpload({ mimeType: "video/mp4", sizeBytes: 1_000 })).status, 403);
});

test("fonte: a biblioteca aceita ate 40; a 41a e 409, mas reenviar uma que ja esta continua valendo", async () => {
  const primeira = await enviarFonte(produtor);
  assert.equal(primeira.status, 200);

  const faltam = model.POPUP_FONT_LIMITS.maxLibrary - (await fontesDoBanco()).length;
  assert.ok(faltam >= 0, "biblioteca local ja passou de 40");

  const linhas = Array.from({ length: faltam }, (_, index) => ({
    created_by: produtor.id,
    family_key: `bf_${randomBytes(6).toString("hex")}`,
    file_path: `fonts/${randomBytes(12).toString("hex")}.woff2`,
    format: "woff2",
    name: `Fonte da biblioteca cheia ${index + 1}`,
    size_bytes: 1_000
  }));

  if (linhas.length > 0) {
    for (const row of unwrap(await db.from("communication_fonts").insert(linhas).select("id"), "Enchendo a biblioteca")) {
      linhasDiretas.add(row.id);
    }
  }

  const cheia = await enviarFonte(produtor, { bytes: TTF, fileName: "nova.ttf" });
  assert.equal(cheia.status, 409);
  assert.equal(cheia.body.error, "A biblioteca já tem 40 fontes. Exclua uma antes de enviar outra.");

  const repetida = await enviarFonte(produtor);
  assert.equal(repetida.status, 200, "o mesmo arquivo nao conta como fonte nova");
  assert.equal(repetida.body.data.id, primeira.body.data.id);
});

test("fonte: renomear (1 a 60 caracteres) e a biblioteca mostra o nome novo; fonte inexistente e 404", async () => {
  const { body } = await enviarFonte(produtor);
  const id = body.data.id;

  actAs(produtor);
  const renomeada = ok(await designActions.renamePopupFont({ id: id.toUpperCase(), name: "  Título  do pop-up " }));
  assert.equal(renomeada.name, "Título do pop-up");
  assert.equal(renomeada.family, body.data.family, "a familia CSS nao muda");
  assert.equal(renomeada.url, body.data.url);

  actAs(produtor);
  assert.equal(ok(await designActions.listPopupFonts()).find((item) => item.id === id).name, "Título do pop-up");
  assert.deepEqual(await ultimaAuditoria("communication.font_renamed", id), { actor_id: produtor.id, entity_id: id, entity_type: "communication_font", metadata: {} });

  for (const name of ["   ", "N".repeat(61)]) {
    actAs(produtor);
    const result = await designActions.renamePopupFont({ id, name });
    assert.equal(result.status, 400);
    assert.deepEqual(result.fieldErrors, { name: ["Use de 1 a 60 caracteres."] });
  }

  actAs(produtor);
  const inexistente = await designActions.renamePopupFont({ id: randomUUID(), name: "Qualquer" });
  assert.deepEqual([inexistente.status, inexistente.error], [404, "Esta fonte não existe mais."]);

  actAs(analista);
  assert.equal((await designActions.renamePopupFont({ id, name: "Analista" })).status, 403);
});

test("fonte: em uso por pop-up nao excluido nao sai (409, com a contagem); livre sai da biblioteca e o arquivo fica", async () => {
  const { body } = await enviarFonte(produtor);
  const fonte = body.data;

  const primeiro = ok(await salvar(popupComDesign({ fontId: fonte.id })));
  actAs(produtor);
  const umPopUp = await designActions.deletePopupFont({ id: fonte.id });
  assert.deepEqual([umPopUp.status, umPopUp.error], [409, "Esta fonte está em uso em 1 pop-up. Troque a fonte nele antes de excluir."]);

  const segundo = ok(await salvar(popupComDesign({ fontId: fonte.id })));
  actAs(produtor);
  const doisPopUps = await designActions.deletePopupFont({ id: fonte.id });
  assert.deepEqual([doisPopUps.status, doisPopUps.error], [409, "Esta fonte está em uso em 2 pop-ups. Troque a fonte neles antes de excluir."]);

  // Pop-up excluido nao segura a fonte; o Padrão (sem design) tambem nao.
  unwrap(await db.from("campaigns").update({ deleted_at: new Date().toISOString() }).eq("id", primeiro.id), "Excluindo o primeiro pop-up");
  actAs(produtor);
  ok(await actions.saveNoticeDraft({ draft: { ...popupComDesign(), design: null }, id: segundo.id }));

  actAs(produtor);
  assert.deepEqual(ok(await designActions.deletePopupFont({ id: fonte.id })), { id: fonte.id });

  const [linha] = unwrap(await db.from("communication_fonts").select("deleted_at").eq("id", fonte.id), "Lendo a fonte excluida");
  assert.ok(linha.deleted_at, "excluir = marcar deleted_at");
  actAs(produtor);
  assert.equal(ok(await designActions.listPopupFonts()).some((item) => item.id === fonte.id), false, "some da biblioteca");
  assert.equal((await fetch(fonte.url)).status, 200, "o arquivo fica (pop-up gravado nunca perde a fonte)");
  assert.deepEqual(await ultimaAuditoria("communication.font_deleted", fonte.id), { actor_id: produtor.id, entity_id: fonte.id, entity_type: "communication_font", metadata: {} });

  actAs(produtor);
  const denovo = await designActions.deletePopupFont({ id: fonte.id });
  assert.deepEqual([denovo.status, denovo.error], [404, "Esta fonte não existe mais."]);

  // Depois de excluida, salvar um design com ela e recusado (a regra do P0 continua valendo).
  const comExcluida = await salvar(popupComDesign({ fontId: fonte.id }));
  assert.deepEqual(comExcluida.fieldErrors, { "design.fonts": ["Esta fonte não está mais na biblioteca. Escolha outra."] });

  // Reenviar o mesmo arquivo depois de excluir cria uma fonte nova (outra familia), com o mesmo objeto.
  const reenviada = await enviarFonte(produtor);
  assert.equal(reenviada.status, 200);
  assert.notEqual(reenviada.body.data.id, fonte.id);
  assert.equal(reenviada.body.data.url, fonte.url);
});

/* ------------------------------------------------------------------------------------------------
 * Video
 * ---------------------------------------------------------------------------------------------- */

test("video: endereco assinado -> envio com a chave publica -> o servidor confere e devolve o video do nosso bucket", async () => {
  for (const [bytes, mimeType] of [
    [MP4, "video/mp4"],
    [WEBM, "video/webm"]
  ]) {
    const { result, ticket } = await enviarVideo({ bytes, contentType: mimeType, mimeType });
    const video = ok(result);

    assert.match(ticket.path, model.POPUP_VIDEO_PATH_PATTERN);
    assert.equal(new URL(ticket.signedUrl).origin, ORIGEM, "o envio vai direto ao nosso Storage");
    assert.deepEqual(Object.keys(video).sort(), ["mimeType", "path", "url"]);
    assert.equal(video.mimeType, mimeType);
    assert.equal(video.path, ticket.path);
    assert.ok(model.isOwnStorageUrl(video.url, { bucket: model.POPUP_VIDEO_BUCKET, objectPath: ticket.path, origin: ORIGEM }), video.url);

    const servido = await fetch(video.url, { headers: { Range: "bytes=0-15" } });
    assert.equal(servido.status, 206, "o aluno toca pelo endereco publico");
    assert.equal(servido.headers.get("content-type"), mimeType);
    await servido.arrayBuffer();

    const auditoria = await ultimaAuditoria("communication.video_uploaded");
    assert.deepEqual(auditoria, { actor_id: produtor.id, entity_id: null, entity_type: "campaign_media", metadata: { mime_type: mimeType, size_bytes: bytes.length } });
  }
});

test("video: HTML com extensao de video, webm no lugar de mp4 e tipo gravado diferente dos bytes sao 422 e o objeto some", async () => {
  const casos = [
    { bytes: HTML, contentType: "video/mp4", mimeType: "video/mp4", nome: "HTML renomeado" },
    { bytes: EXE, contentType: "video/webm", mimeType: "video/webm", nome: "executavel renomeado" },
    { bytes: WEBM, contentType: "video/mp4", mimeType: "video/mp4", nome: "webm num caminho .mp4" },
    { bytes: MP4, contentType: "video/webm", mimeType: "video/mp4", nome: "tipo gravado pelo navegador diferente dos bytes" }
  ];

  for (const caso of casos) {
    const { result, ticket } = await enviarVideo(caso);
    assert.deepEqual([result.status, result.error], [422, "Use um vídeo MP4 (H.264) ou WEBM."], caso.nome);
    assert.equal(await existeNoBucket(model.POPUP_VIDEO_BUCKET, ticket.path), false, `${caso.nome}: o objeto foi apagado`);
  }

  // O proprio bucket recusa o que nao e video (segunda barreira).
  actAs(produtor);
  const ticket = ok(await designActions.startPopupVideoUpload({ mimeType: "video/mp4", sizeBytes: HTML.length }));
  const direto = await navegador.storage.from(model.POPUP_VIDEO_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, HTML, { contentType: "text/html" });
  assert.ok(direto.error, "o bucket so aceita mp4 e webm");
});

test("video: tipo e tamanho conferidos antes do endereco; caminho fora do formato e 400; video que nao chegou e 404", async () => {
  actAs(produtor);
  const mov = await designActions.startPopupVideoUpload({ mimeType: "video/quicktime", sizeBytes: 1_000 });
  assert.deepEqual([mov.status, mov.fieldErrors], [400, { mimeType: ["Use um vídeo MP4 (H.264) ou WEBM."] }]);

  actAs(produtor);
  const grande = await designActions.startPopupVideoUpload({ mimeType: "video/mp4", sizeBytes: model.POPUP_VIDEO_LIMITS.maxBytes + 1 });
  assert.deepEqual([grande.status, grande.fieldErrors], [400, { sizeBytes: ["O vídeo deve ter no máximo 15 MB."] }]);

  for (const path of ["videos/meu-video.mp4", `fonts/${randomUUID()}.mp4`, `videos/${randomUUID()}.mov`, "../segredo"]) {
    actAs(produtor);
    const result = await designActions.finishPopupVideoUpload({ path });
    assert.deepEqual([result.status, result.fieldErrors], [400, { path: ["Envie o vídeo de novo."] }], path);
  }

  actAs(produtor);
  const naoChegou = await designActions.finishPopupVideoUpload({ path: `videos/${randomUUID()}.webm` });
  assert.deepEqual([naoChegou.status, naoChegou.error], [404, "Envie o vídeo de novo."]);

  actAs(analista);
  assert.equal((await designActions.finishPopupVideoUpload({ path: `videos/${randomUUID()}.webm` })).status, 403);
});

test("pop-up com video: endereco de fora do nosso bucket e recusado; o do nosso bucket e gravado recalculado do caminho", async () => {
  const { result } = await enviarVideo({ bytes: MP4, contentType: "video/mp4", mimeType: "video/mp4" });
  const video = ok(result);

  const estrangeiros = [
    { ...video, url: "https://videos.exemplo.com/promo.mp4" },
    { ...video, url: `${ORIGEM}/storage/v1/object/public/content-assets/${video.path}` },
    { ...video, url: `http://videos.exemplo.com/storage/v1/object/public/${model.POPUP_VIDEO_BUCKET}/${video.path}` },
    { ...video, url: `${video.url}?download=1` },
    { ...video, path: "videos/promo.mp4", url: `${ORIGEM}/storage/v1/object/public/${model.POPUP_VIDEO_BUCKET}/videos/promo.mp4` },
    { ...video, mimeType: "video/webm" }
  ];

  for (const estrangeiro of estrangeiros) {
    const recusado = await salvar(popupComDesign({ video: estrangeiro }));
    assert.equal(recusado.ok, false, JSON.stringify(estrangeiro));
    assert.equal(recusado.status, 400);
    assert.deepEqual(recusado.fieldErrors["draft.design.media.video"] ?? recusado.fieldErrors["draft.design.media.video.path"], ["Envie o vídeo de novo."], JSON.stringify(recusado.fieldErrors));
  }

  const { count } = await db.from("campaigns").select("id", { count: "exact", head: true }).eq("created_by", produtor.id);
  assert.equal(count, 0, "nada gravado");

  // Mesmo caminho do nosso bucket, mas a url que veio do navegador aponta para outro host: grava a nossa.
  const salvo = ok(await salvar(popupComDesign({ video: { ...video, url: `https://outro.supabase.co/storage/v1/object/public/${model.POPUP_VIDEO_BUCKET}/${video.path}` } })));
  const [linha] = unwrap(await db.from("campaigns").select("popup_design").eq("id", salvo.id), "Lendo o pop-up");
  assert.equal(linha.popup_design.media.video.url, video.url);
});

test("pop-up com video: objeto que nao passou pela conferencia do envio e conferido ao salvar (recusado e fica para a limpeza)", async () => {
  // Envio pelo endereco assinado com bytes que nao sao video (tipo declarado video/mp4, que o bucket aceita),
  // sem chamar finishPopupVideoUpload: salvar o design apontando para ele confere ali mesmo.
  actAs(produtor);
  const ticket = ok(await designActions.startPopupVideoUpload({ mimeType: "video/mp4", sizeBytes: HTML.length }));
  criados[model.POPUP_VIDEO_BUCKET].add(ticket.path);
  unwrap(await navegador.storage.from(model.POPUP_VIDEO_BUCKET).uploadToSignedUrl(ticket.path, ticket.token, HTML, { contentType: "video/mp4" }), "Enviando sem conferir");
  const naoConferido = { mimeType: "video/mp4", path: ticket.path, url: db.storage.from(model.POPUP_VIDEO_BUCKET).getPublicUrl(ticket.path).data.publicUrl };

  const recusado = await salvar(popupComDesign({ video: naoConferido }));
  assert.deepEqual([recusado.ok, recusado.status], [false, 400]);
  assert.deepEqual(recusado.fieldErrors["design.media.video"], ["Use um vídeo MP4 (H.264) ou WEBM."], JSON.stringify(recusado.fieldErrors));
  assert.equal(await existeNoBucket(model.POPUP_VIDEO_BUCKET, ticket.path), true, "o salvar nunca apaga: o recusado fica para a limpeza (docs/28 D16)");

  // Caminho que nunca recebeu arquivo: "Envie o vídeo de novo."
  const vazio = `videos/${randomUUID()}.mp4`;
  const semArquivo = await salvar(popupComDesign({ video: { ...naoConferido, path: vazio, url: db.storage.from(model.POPUP_VIDEO_BUCKET).getPublicUrl(vazio).data.publicUrl } }));
  assert.deepEqual(semArquivo.fieldErrors?.["design.media.video"], ["Envie o vídeo de novo."], JSON.stringify(semArquivo.fieldErrors));

  // O video conferido continua entrando, e salvar de novo o mesmo pop-up (mesmo caminho) nao recusa.
  const { result } = await enviarVideo({ bytes: MP4, contentType: "video/mp4", mimeType: "video/mp4" });
  const video = ok(result);
  const salvo = ok(await salvar(popupComDesign({ video })));
  actAs(produtor);
  ok(await actions.saveNoticeDraft({ draft: popupComDesign({ video }), id: salvo.id }));
});

/** Objeto montado direto no Storage (sem o endereco assinado nem a conferencia), com o tipo gravado que o teste quiser. */
async function montarVideo(bytes, contentType) {
  const path = `videos/${randomUUID()}.mp4`;
  unwrap(await db.storage.from(model.POPUP_VIDEO_BUCKET).upload(path, bytes, { contentType, upsert: false }), "Montando o video direto no Storage");
  criados[model.POPUP_VIDEO_BUCKET].add(path);
  return path;
}

test("fim do envio (docs/28 D16): caminho citado por um modelo nao excluido e recusado (422) e o objeto continua no bucket", async () => {
  // Bytes de mp4 de verdade gravados como webm: a conferencia recusa (o tipo gravado nao bate).
  const path = await montarVideo(MP4, "video/webm");
  const url = db.storage.from(model.POPUP_VIDEO_BUCKET).getPublicUrl(path).data.publicUrl;
  const design = { ...structuredClone(model.popupStarterDesign("media_top_fade")), media: { ...model.popupStarterDesign("media_top_fade").media, kind: "video", video: { mimeType: "video/mp4", path, url } } };
  unwrap(
    await db.from("communication_templates").insert({
      created_by: produtor.id,
      design_mode: "custom",
      kind: "design",
      name: "Modelo com video",
      payload: { design, designSupport: { ctaLabel: null, image: null }, kind: "design", version: 1 },
      updated_by: produtor.id
    }),
    "Criando o modelo que cita o video"
  );

  actAs(produtor);
  const result = await designActions.finishPopupVideoUpload({ path });
  assert.deepEqual([result.ok, result.status, result.error], [false, 422, "Use um vídeo MP4 (H.264) ou WEBM."]);
  assert.equal(await existeNoBucket(model.POPUP_VIDEO_BUCKET, path), true, "o modelo segura o arquivo: o fim do envio nao apaga");

  // Sem nenhum aviso ou modelo citando (o modelo saiu), o mesmo envio recente e apagado.
  unwrap(await db.from("communication_templates").delete().eq("created_by", produtor.id), "Tirando o modelo");
  actAs(produtor);
  const denovo = await designActions.finishPopupVideoUpload({ path });
  assert.equal(denovo.status, 422);
  assert.equal(await existeNoBucket(model.POPUP_VIDEO_BUCKET, path), false, "o envio novo que ninguem cita sai");
});
