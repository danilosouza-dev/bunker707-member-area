import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, readLocalSupabaseConfig, unwrap } from "../support/local-db.mjs";
import { apagarContaDeTeste, ESCOLA_DE_TESTE, limparComunicacao, SENHA_DE_TESTE, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Modelos da Comunicacao (docs/28 §7.2) contra o banco e o Storage LOCAIS de verdade: permissoes (analista 403, sem
// sessao 401, a redatora so com messaging.write cria, renomeia, duplica e exclui), RLS sem politica com o revoke
// (42501 para anon e para a aluna), salvar do rascunho, do design e do aviso gravado (menu), a versao (409 e o
// gatilho do updated_at), o limite de 200, o check do banco, a leitura parte por parte, os arquivos no "Usar" (D16:
// modelos de onde o aviso veio contam como ja conferidos, inclusive excluidos ha menos de 29 dias; o recusado nunca e
// apagado), quem envia fora da equipe (D19), a fonte que um modelo segura (D18), duplicar (inclusive o nome com um
// emoji na fronteira do corte), excluir, a lista e a preparacao do editor. Toda linha semeada aqui leva created_by de
// uma conta @bunker707.test (limparComunicacao apaga antes e depois, sempre antes de apagar uma conta temporaria).

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/template-actions.ts");
const queries = await import("../../src/server/communications/template-queries.ts");
const noticeActions = await import("../../src/server/communications/actions.ts");
const designActions = await import("../../src/server/communications/popup-design-actions.ts");
const model = await import("../../src/server/communications/template-model.ts");
const store = await import("../../src/server/communications/flow-store.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const custom = await import("../../src/server/communications/popup-design-model.ts");
const freeStarters = await import("../../src/server/communications/popup-free-starters.ts");
const { jsonbBytesUpperBound } = await import("../../src/server/communications/popup-free-model.ts");

const M = model.TEMPLATE_MESSAGES;
const T = "communication_templates";
const PRODUTO = ESCOLA_DE_TESTE.cursoBloqueado.id;
const DIA = 86_400_000;
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const { anonKey, url: supabaseUrl } = readLocalSupabaseConfig();
const ORIGEM = new URL(supabaseUrl).origin;
const VIDEOS = custom.POPUP_VIDEO_BUCKET;
const IMAGENS = "content-assets";

const EDITORA = { email: "editora.modelos@bunker707.test", nome: "Editora de Modelos", permissions: {}, role: "editor" };
const REDATORA = { email: "redatora.modelos@bunker707.test", nome: "Redatora de Modelos", permissions: { actions: ["messaging.write"] }, role: "custom" };
const QUEM_SAI = { email: "quem.sai.modelos@bunker707.test", nome: "Pessoa Que Sai", permissions: {}, role: "editor" };

const fixture = (name, folder) => readFileSync(new URL(`../fixtures/${folder}/${name}`, import.meta.url));
const MP4 = fixture("video-de-teste.mp4", "popup-design");
const TRANSPARENTE = fixture("imagem-transparente.webp", "popup-livre");

const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };
const BOTAO = { href: `/conteudo/${PRODUTO}`, label: "Ver o curso", target: "same_tab" };
const IMAGEM = { alt: "", url: `${ORIGEM}/storage/v1/object/public/content-assets/communications/images/capa-de-teste.webp` };
const TUDO = { audience: true, content: true, followUps: true };
const SEM_CONTEUDO = { audience: true, content: false, followUps: false };

/** Objetos criados no Storage (apagados no fim, se ainda existirem). */
const criados = { [IMAGENS]: new Set(), [VIDEOS]: new Set() };

async function criarEquipe(pessoa) {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = data?.users.find((item) => item.email === pessoa.email);

  if (!user) {
    user = unwrap(
      await db.auth.admin.createUser({ email: pessoa.email, email_confirm: true, password: SENHA_DE_TESTE, user_metadata: { full_name: pessoa.nome } }),
      `Criando ${pessoa.nome}`
    ).user;
  }

  unwrap(await db.from("admin_roles").upsert({ permissions: pessoa.permissions, role: pessoa.role, user_id: user.id }, { onConflict: "user_id" }), "Dando a funcao");

  return usuarioDeTeste({ email: pessoa.email, id: user.id, nome: pessoa.nome });
}

let editora;
let redatora;

before(async () => {
  await limparComunicacao(db);
  editora = await criarEquipe(EDITORA);
  redatora = await criarEquipe(REDATORA);
});

beforeEach(() => limparComunicacao(db));

after(async () => {
  // Os modelos das contas temporarias saem antes das contas (o on delete set null deixaria a linha sem dono).
  await limparComunicacao(db);
  await apagarContaDeTeste(db, EDITORA.email);
  await apagarContaDeTeste(db, REDATORA.email);
  await apagarContaDeTeste(db, QUEM_SAI.email);

  for (const [bucket, paths] of Object.entries(criados)) {
    if (paths.size > 0) {
      await db.storage.from(bucket).remove([...paths]);
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

const rascunho = (kind = "inbox", extra = {}) => ({ ...emptyNoticeDraft(kind), audience: quemTemOProduto, body: "Texto da oferta", title: "Oferta especial", ...extra });

function doRascunho(draft = rascunho(), extra = {}) {
  return { body: { draft, followUps: null, include: TUDO, source: "notice" }, name: "Lançamento de novembro", origin: "notice_editor", ...extra };
}

function doDesign({ design = null, freeDesign = null, support = { ctaLabel: "Quero", image: null } } = {}, extra = {}) {
  return { body: { design, freeDesign, source: "design", support }, name: "Design de teste", origin: "design_card", ...extra };
}

async function salvarModelo(input, user = produtor) {
  actAs(user);
  return actions.saveTemplate(input);
}

async function linhaDoModelo(id) {
  return unwrap(await db.from(T).select("*").eq("id", id).single(), "Lendo o modelo");
}

/** Linha semeada direto pelo cliente admin (sempre com created_by da conta do produtor de teste). */
async function semear(payload, extra = {}) {
  const [linha] = unwrap(
    await db
      .from(T)
      .insert({
        created_by: produtor.id,
        design_mode: payload && typeof payload === "object" && payload.kind !== "inbox" && payload.design ? (payload.design.mode === "free" ? "free" : "custom") : null,
        kind: payload.kind,
        name: "Modelo semeado",
        payload,
        updated_by: produtor.id,
        ...extra
      })
      .select("*"),
    "Semeando o modelo"
  );
  return linha;
}

async function auditorias(action, entityId) {
  let query = db.from("admin_audit_log").select("actor_id,entity_id,entity_type,metadata").eq("action", action).order("occurred_at", { ascending: false });

  if (entityId) {
    query = query.eq("entity_id", entityId);
  }

  return unwrap(await query.limit(20), "Lendo a auditoria");
}

const payloadDeNotificacao = () => model.templatePayloadOfDraft({ draft: rascunho(), followUps: null, include: TUDO }).payload;
const payloadDeDesign = (design = custom.popupStarterDesign("text_only")) => model.templatePayloadOfDesign({ design, freeDesign: null, support: { ctaLabel: null, image: null } });

async function existeNoBucket(bucket, path) {
  const { error } = await db.storage.from(bucket).info(path);
  return !error;
}

/** Video montado direto no Storage (sem a conferencia do envio), com o tipo gravado pedido. */
async function montarVideo(contentType = "video/mp4") {
  const path = `videos/${randomUUID()}.mp4`;
  unwrap(await db.storage.from(VIDEOS).upload(path, MP4, { contentType, upsert: false }), "Montando o video");
  criados[VIDEOS].add(path);
  return { mimeType: "video/mp4", path, url: db.storage.from(VIDEOS).getPublicUrl(path).data.publicUrl };
}

async function montarImagemLivre() {
  const path = `communications/free/${randomBytes(12).toString("hex")}.webp`;
  unwrap(await db.storage.from(IMAGENS).upload(path, Buffer.concat([TRANSPARENTE, randomBytes(8)]), { contentType: "image/webp", upsert: false }), "Montando a imagem");
  criados[IMAGENS].add(path);
  return path;
}

function personalizadoComVideo(video) {
  const base = custom.popupStarterDesign("media_top_fade", { video });
  return { ...base, media: { ...base.media, kind: "video", video } };
}

const popupComDesign = (design, extra = {}) => ({ ...rascunho("popup"), body: "", cta: BOTAO, design, image: IMAGEM, title: "Pop-up com design", ...extra });

async function salvarAviso(input, user = produtor) {
  actAs(user);
  return noticeActions.saveNoticeDraft(input);
}

/* ------------------------------------------------------------------------------------------------
 * 1 e 2: permissoes e RLS
 * ---------------------------------------------------------------------------------------------- */

test("1. permissões: a analista recebe 403 nas seis ações, sem sessão é 401, e a redatora cria, renomeia, duplica e exclui", async () => {
  const chamadas = [
    () => actions.saveTemplate(doRascunho()),
    () => actions.saveTemplateFromNotice({ include: TUDO, name: "X", noticeId: randomUUID() }),
    () => actions.renameTemplate({ expectedUpdatedAt: new Date().toISOString(), id: randomUUID(), name: "X" }),
    () => actions.duplicateTemplate({ id: randomUUID() }),
    () => actions.deleteTemplate({ id: randomUUID() }),
    () => actions.loadDesignTemplates({ mode: "custom" })
  ];

  for (const chamada of chamadas) {
    actAs(analista);
    assert.equal((await chamada()).status, 403);
    actAs(null);
    assert.equal((await chamada()).status, 401);
  }

  // A editora (messaging.write e messaging.publish) e a redatora (so messaging.write) criam modelos.
  assert.equal(ok(await salvarModelo(doRascunho(), editora)).kind, "inbox");
  const salvo = ok(await salvarModelo(doRascunho(), redatora));
  actAs(redatora);
  const renomeado = ok(await actions.renameTemplate({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id, name: "Outro nome" }));
  actAs(redatora);
  const copia = ok(await actions.duplicateTemplate({ id: salvo.id }));
  actAs(redatora);
  ok(await actions.deleteTemplate({ expectedUpdatedAt: renomeado.updatedAt, id: salvo.id }));
  assert.equal(copia.name, "Outro nome (cópia)");
});

test("2. RLS: anon e a aluna logada recebem 42501 (o revoke, não só a RLS sem política); o service_role lê", async () => {
  await semear(payloadDeNotificacao());
  const anon = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const aluna = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  unwrap(await aluna.auth.signInWithPassword({ email: contas.aluna.email, password: SENHA_DE_TESTE }), "Entrando como a aluna");

  for (const [quem, cliente] of [
    ["anon", anon],
    ["aluna", aluna]
  ]) {
    const { data, error } = await cliente.from(T).select("id");
    assert.equal(error?.code, "42501", `${quem}: ${JSON.stringify(error)}`);
    assert.equal(data, null);
  }

  const lido = unwrap(await db.from(T).select("id").eq("created_by", produtor.id), "service_role lendo");
  assert.equal(lido.length, 1);
});

/* ------------------------------------------------------------------------------------------------
 * 3 a 5: salvar
 * ---------------------------------------------------------------------------------------------- */

test("3. salvar do rascunho: tipo, modo, nome aparado e o payload do construtor; a auditoria tem a origem e as contagens, sem o nome", async () => {
  const draft = rascunho("inbox", { icon: { color: "amber", id: "gift" }, sender: { userId: produtor.id }, validity: { minutes: 1_440, mode: "duration" } });
  const salvo = ok(await salvarModelo(doRascunho(draft, { name: "  Lançamento de novembro  " })));
  const linha = await linhaDoModelo(salvo.id);

  assert.deepEqual([linha.kind, linha.design_mode, linha.name, linha.created_by, linha.updated_by, linha.deleted_at], ["inbox", null, "Lançamento de novembro", produtor.id, produtor.id, null]);
  assert.deepEqual(linha.payload, model.templatePayloadSchema.parse(model.templatePayloadOfDraft({ draft: model.templateDraftInputSchema.parse(draft), followUps: null, include: TUDO }).payload));
  assert.equal(salvo.updatedAt, linha.updated_at);

  const [auditoria] = await auditorias("communication.template_saved", salvo.id);
  assert.deepEqual(auditoria, {
    actor_id: produtor.id,
    entity_id: salvo.id,
    entity_type: "communication_template",
    metadata: { created: true, design_mode: null, follow_ups: 0, kind: "inbox", origin: "notice_editor", source_campaign_id: null, source_template_ids: [], with_audience: true, with_content: true }
  });
  assert.doesNotMatch(JSON.stringify(auditoria), /Lançamento/);
});

test("4. salvar o design: Personalizado com mídia imagem guarda o apoio com a imagem; Livre guarda image null; os dois juntos e nenhum dão 400; free_editor vai para a auditoria", async () => {
  const comImagem = custom.popupStarterDesign("media_top_fade");
  const personalizado = ok(await salvarModelo(doDesign({ design: comImagem, support: { ctaLabel: "Quero", image: IMAGEM } })));
  const linhaP = await linhaDoModelo(personalizado.id);
  assert.deepEqual([linhaP.kind, linhaP.design_mode, personalizado.designMode], ["design", "custom", "custom"]);
  assert.deepEqual(linhaP.payload.designSupport, { ctaLabel: "Quero", image: IMAGEM });

  const livre = ok(await salvarModelo(doDesign({ freeDesign: freeStarters.freeStarterDesign("blank"), support: { ctaLabel: "Entrar", image: IMAGEM } }, { origin: "free_editor" })));
  const linhaL = await linhaDoModelo(livre.id);
  assert.equal(linhaL.design_mode, "free");
  assert.deepEqual(linhaL.payload.designSupport, { ctaLabel: "Entrar", image: null });
  assert.equal((await auditorias("communication.template_saved", livre.id))[0].metadata.origin, "free_editor");

  const juntos = await salvarModelo(doDesign({ design: comImagem, freeDesign: freeStarters.freeStarterDesign("blank") }));
  assert.deepEqual([juntos.status, juntos.fieldErrors], [400, { "body.freeDesign": ["Escolha um design só."] }]);
  const nenhum = await salvarModelo(doDesign());
  assert.deepEqual([nenhum.status, nenhum.fieldErrors], [400, { "body.design": [M.pickDesign] }]);
});

/** Grava o aviso e as seguintes como o editor faz (saveNoticeDraft e logo saveNoticeFollowUps). */
async function notificacaoComSeguintes() {
  const salvo = ok(await salvarAviso({ draft: rascunho() }));
  const filho = { children: [], content: conteudoSeguinte("Segundo nível"), id: randomUUID(), when: { anchor: "sent", minutes: 1_440 }, who: { kind: "everyone" } };
  const pai = { children: [filho], content: conteudoSeguinte("Primeiro nível"), id: randomUUID(), when: { anchor: "sent", minutes: 60 }, who: { kind: "everyone" } };
  actAs(produtor);
  const seguintes = ok(await noticeActions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: salvo.updatedAt, followUps: [pai], goal: { productId: PRODUTO }, noticeId: salvo.id }));

  return { id: salvo.id, seguintes };
}

function conteudoSeguinte(title, extra = {}) {
  return { audio: null, body: "", cta: null, icon: null, image: null, response: null, sender: null, title, validity: { mode: "default" }, ...extra };
}

test("5. salvar a partir do aviso: pop-up Livre sem conteúdo leva o texto do botão; seguintes com a entrada; fluxo do construtor fica fora com nota; passo de fluxo e design ilegível dão 409", async () => {
  // Pop-up Livre com o botao principal, conteudo desligado.
  const livre = ok(await salvarAviso({ draft: { ...rascunho("popup"), body: "", cta: BOTAO, design: null, freeDesign: freeStarters.freeStarterDesign("blank"), title: "Livre" } }));
  actAs(produtor);
  const doLivre = ok(await actions.saveTemplateFromNotice({ include: SEM_CONTEUDO, name: "Do Livre", noticeId: livre.id }));
  const linhaLivre = await linhaDoModelo(doLivre.id);
  assert.equal(linhaLivre.design_mode, "free");
  assert.equal(linhaLivre.payload.content, null);
  assert.deepEqual(linhaLivre.payload.designSupport, { ctaLabel: "Ver o curso", image: null });
  const [auditoria] = await auditorias("communication.template_saved", doLivre.id);
  assert.equal(auditoria.metadata.origin, "notice_menu");
  assert.equal(auditoria.metadata.source_campaign_id, livre.id);

  // Notificacao com 2 seguintes (uma de 2o nivel).
  const aviso = await notificacaoComSeguintes();
  actAs(produtor);
  const comSeguintes = ok(await actions.saveTemplateFromNotice({ include: TUDO, name: "Com seguintes", noticeId: aviso.id }));
  const linha = await linhaDoModelo(comSeguintes.id);
  assert.equal(linha.payload.followUps.entryId, aviso.seguintes.entryNodeId);
  assert.deepEqual(linha.payload.followUps.goal, { productId: PRODUTO });
  assert.equal(linha.payload.followUps.items.length, 1);
  assert.equal(linha.payload.followUps.items[0].content.title, "Primeiro nível");
  assert.equal(linha.payload.followUps.items[0].children[0].content.title, "Segundo nível");
  assert.equal((await auditorias("communication.template_saved", comSeguintes.id))[0].metadata.follow_ups, 2);
  assert.deepEqual(comSeguintes.notes, []);

  // O construtor muda o fluxo para algo que o cartao nao desenha: as seguintes ficam fora, com a nota.
  const flow = unwrap(await db.from("communication_flows").select("id,updated_at").eq("id", aviso.seguintes.flowId).single(), "Fluxo");
  const entrada = aviso.seguintes.entryNodeId;
  const condicao = randomUUID();
  const sim = randomUUID();
  await store.saveFlowTree(db, {
    actorId: produtor.id,
    contents: { [sim]: conteudoSeguinte("Para quem abriu") },
    expectedUpdatedAt: flow.updated_at,
    flow: { goal: null, name: "Seguintes de “Oferta especial”", origin: "notice", sourceCampaignId: aviso.id },
    flowId: flow.id,
    now: new Date(),
    tree: {
      nodes: [
        { anchor: "previous", anchorNodeId: null, branch: null, campaignId: null, condition: null, expireWithAnchor: false, filter: null, id: entrada, kind: "entry", maxWaitMinutes: null, offsetMinutes: 0, parentId: null, position: 0, waitUntilTrue: false },
        {
          anchor: "sent",
          anchorNodeId: entrada,
          branch: null,
          campaignId: null,
          condition: { kind: "rules", root: { items: [{ action: "opened", negate: false, ref: { kind: "node", nodeId: entrada }, type: "message" }], match: "all" } },
          expireWithAnchor: false,
          filter: null,
          id: condicao,
          kind: "condition",
          maxWaitMinutes: null,
          offsetMinutes: 1_440,
          parentId: entrada,
          position: 0,
          waitUntilTrue: false
        },
        { anchor: "previous", anchorNodeId: null, branch: "yes", campaignId: null, condition: null, expireWithAnchor: false, filter: null, id: sim, kind: "message", maxWaitMinutes: null, offsetMinutes: 0, parentId: condicao, position: 0, waitUntilTrue: false }
      ],
      origin: "notice"
    }
  });
  actAs(produtor);
  const doConstrutor = ok(await actions.saveTemplateFromNotice({ include: TUDO, name: "Do construtor", noticeId: aviso.id }));
  assert.deepEqual(doConstrutor.notes, [M.noteBuilderOnly]);
  assert.equal((await linhaDoModelo(doConstrutor.id)).payload.followUps, null);

  // Passo de fluxo: o conteudo de uma seguinte e um aviso com flow_id.
  const [passo] = unwrap(await db.from("campaigns").select("id").eq("flow_id", flow.id).limit(1), "Passo do fluxo");
  actAs(produtor);
  const dePasso = await actions.saveTemplateFromNotice({ include: TUDO, name: "Passo", noticeId: passo.id });
  assert.deepEqual([dePasso.status, dePasso.error], [409, M.flowStep]);

  // Pop-up com o design gravado que nao passa no schema (escrito pelo cliente admin): 409 e nenhuma linha nova.
  const quebrado = ok(await salvarAviso({ draft: { ...rascunho("popup"), body: "", title: "Quebrado" } }));
  unwrap(await db.from("campaigns").update({ popup_design: { blocks: "não é um design", version: 1 } }).eq("id", quebrado.id), "Quebrando o design");
  const { count: antes } = await db.from(T).select("id", { count: "exact", head: true }).eq("created_by", produtor.id);
  actAs(produtor);
  const ilegivel = await actions.saveTemplateFromNotice({ include: SEM_CONTEUDO, name: "Ilegível", noticeId: quebrado.id });
  assert.deepEqual([ilegivel.status, ilegivel.error], [409, M.designUnreadable]);
  const { count: depois } = await db.from(T).select("id", { count: "exact", head: true }).eq("created_by", produtor.id);
  assert.deepEqual([antes, depois], [3, 3], "nenhuma linha nova");
});

/* ------------------------------------------------------------------------------------------------
 * 6 a 9: versao, limite, check do banco e leitura
 * ---------------------------------------------------------------------------------------------- */

test("6. versão: a antiga dá 409 changed; a certa grava e o updated_at novo vem do gatilho; renomear, duplicar e excluir com a antiga dão 409; excluído dá 404; o modo do Design não muda", async () => {
  const salvo = ok(await salvarModelo(doRascunho()));
  const novo = ok(await salvarModelo(doRascunho(rascunho("inbox", { title: "Novo título" }), { expectedUpdatedAt: salvo.updatedAt, id: salvo.id })));
  const linha = await linhaDoModelo(salvo.id);
  assert.notEqual(novo.updatedAt, salvo.updatedAt);
  assert.equal(linha.updated_at, novo.updatedAt, "o gatilho grava o updated_at novo");
  assert.ok(Date.parse(linha.updated_at) > Date.parse(salvo.updatedAt));
  assert.equal(linha.payload.content.title, "Novo título");

  const velho = await salvarModelo(doRascunho(rascunho(), { expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
  assert.deepEqual([velho.status, velho.error], [409, M.changed]);

  for (const chamada of [
    () => actions.renameTemplate({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id, name: "X" }),
    () => actions.duplicateTemplate({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }),
    () => actions.deleteTemplate({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id })
  ]) {
    actAs(produtor);
    const result = await chamada();
    assert.deepEqual([result.status, result.error], [409, M.changed]);
  }

  actAs(produtor);
  ok(await actions.deleteTemplate({ expectedUpdatedAt: novo.updatedAt, id: salvo.id }));
  actAs(produtor);
  const excluido = await actions.renameTemplate({ expectedUpdatedAt: novo.updatedAt, id: salvo.id, name: "X" });
  assert.deepEqual([excluido.status, excluido.error], [404, M.missing]);

  const personalizado = ok(await salvarModelo(doDesign({ design: custom.popupStarterDesign("text_only") })));
  const livre = await salvarModelo(doDesign({ freeDesign: freeStarters.freeStarterDesign("blank") }, { expectedUpdatedAt: personalizado.updatedAt, id: personalizado.id }));
  assert.deepEqual([livre.status, livre.fieldErrors], [400, { kind: [M.kindFixed] }]);
  assert.equal((await linhaDoModelo(personalizado.id)).design_mode, "custom");
});

test("7. limite: o 201º dá 422 por salvar, salvar a partir do aviso e duplicar; excluir um libera a vaga", async () => {
  const { count: antes } = await db.from(T).select("id", { count: "exact", head: true }).is("deleted_at", null);
  const faltam = model.TEMPLATE_LIMITS.maxTemplates - (antes ?? 0);
  const payload = payloadDeNotificacao();
  const linhas = Array.from({ length: faltam }, (_, index) => ({ created_by: produtor.id, design_mode: null, kind: "inbox", name: `Semeado ${index}`, payload, updated_by: produtor.id }));
  const semeadas = unwrap(await db.from(T).insert(linhas).select("id"), "Semeando até 200");
  const aviso = ok(await salvarAviso({ draft: rascunho() }));

  for (const chamada of [
    () => actions.saveTemplate(doRascunho()),
    () => actions.saveTemplateFromNotice({ include: TUDO, name: "X", noticeId: aviso.id }),
    () => actions.duplicateTemplate({ id: semeadas[0].id })
  ]) {
    actAs(produtor);
    const result = await chamada();
    assert.deepEqual([result.status, result.error], [422, M.limit]);
  }

  actAs(produtor);
  ok(await actions.deleteTemplate({ id: semeadas[0].id }));
  ok(await salvarModelo(doRascunho()));
});

/** "Para quem" com a estimativa por cima perto de `alvo` bytes (o mesmo do teste 6 da unidade). */
function segmentoDe(alvo, prefixo) {
  const ids = [];
  const definicao = () => {
    const items = [];

    for (let index = 0; index < ids.length; index += 50) {
      items.push({ op: "has", productIds: ids.slice(index, index + 50), type: "product" });
    }

    return { kind: "rules", root: { items, match: "all" } };
  };

  while (jsonbBytesUpperBound(definicao()) < alvo) {
    ids.push(`${prefixo}${ids.length}_`.padEnd(240, "x"));
  }

  return definicao();
}

function piorAvisoValido() {
  const link = (bucket) => {
    const base = `${ORIGEM}/storage/v1/object/public/${bucket}/`;
    return `${base}${"a".repeat(2_048 - base.length)}`;
  };
  const conteudo = {
    audio: { durationSeconds: 300, mimeType: "audio/mpeg", peaks: Array.from({ length: 96 }, () => 100), url: link("communication-audio") },
    body: "€".repeat(600),
    cta: { display: "button", href: `https://exemplo.com/${"a".repeat(2_048 - 20)}`, label: "€".repeat(30), target: "new_tab" },
    image: { alt: "€".repeat(160), url: link("content-assets") },
    poll: { closesAt: null, multiple: true, options: Array.from({ length: 6 }, (_, index) => ({ id: `o${index}`, label: `${"€".repeat(59)}${index}` })), question: "€".repeat(120), showResults: true },
    reactions: true,
    response: null,
    title: "€".repeat(80)
  };
  const seguinte = (children = []) => ({
    children,
    content: { ...conteudo, allowHide: true, icon: { color: "amber", id: "gift" }, sender: { userId: produtor.id }, validity: { mode: "default" } },
    id: randomUUID(),
    when: { anchor: "sent", minutes: 60 },
    who: segmentoDe(16_896, `s${randomBytes(3).toString("hex")}`)
  });

  return {
    draft: { ...emptyNoticeDraft("inbox"), ...conteudo, allowHide: true, audience: segmentoDe(16_896, "m"), icon: { color: "amber", id: "gift" }, sender: { userId: produtor.id }, validity: { minutes: 1_440, mode: "duration" } },
    followUps: { entryId: randomUUID(), goal: { productId: PRODUTO }, items: Array.from({ length: 5 }, () => seguinte([seguinte(), seguinte(), seguinte()])) }
  };
}

test("8. check do banco: 1,1 MB, sem version, kind diferente e notificação com modo dão 23514; o pior aviso válido salvo pelo app passa", async () => {
  const base = { created_by: produtor.id, name: "Check", updated_by: produtor.id };
  const grande = await db.from(T).insert({ ...base, design_mode: "custom", kind: "design", payload: { kind: "design", recheio: randomBytes(825_000).toString("base64"), version: 1 } });
  assert.ok(grande.error, "1,1 MB recusado");
  assert.ok(grande.error.code === "23514" || grande.status === 413, JSON.stringify({ code: grande.error.code, status: grande.status }));

  for (const [nome, linha] of [
    ["sem version", { ...base, design_mode: null, kind: "inbox", payload: { kind: "inbox" } }],
    ["version texto", { ...base, design_mode: null, kind: "inbox", payload: { kind: "inbox", version: "1" } }],
    ["kind diferente", { ...base, design_mode: null, kind: "inbox", payload: { kind: "popup", version: 1 } }],
    ["notificação com modo", { ...base, design_mode: "custom", kind: "inbox", payload: { kind: "inbox", version: 1 } }],
    ["design sem modo", { ...base, design_mode: null, kind: "design", payload: { kind: "design", version: 1 } }],
    ["nome vazio", { ...base, design_mode: null, kind: "inbox", name: "   ", payload: { kind: "inbox", version: 1 } }]
  ]) {
    const { error } = await db.from(T).insert(linha);
    assert.equal(error?.code, "23514", `${nome}: ${JSON.stringify(error)}`);
  }

  const pior = piorAvisoValido();
  const salvo = ok(await salvarModelo({ body: { draft: pior.draft, followUps: pior.followUps, include: TUDO, source: "notice" }, name: "Pior aviso válido", origin: "template_editor" }));
  const linha = await linhaDoModelo(salvo.id);
  assert.equal(linha.payload.followUps.items.length, 5);
  assert.ok(jsonbBytesUpperBound(linha.payload) > 500_000, "é mesmo grande");
});

test("9. leitura parte por parte: design inválido aparece na lista e abre no Padrão com readDesign; version 2 aparece como 'não abre'", async () => {
  const popup = model.templatePayloadOfDraft({ draft: popupComDesign(custom.popupStarterDesign("text_only"), { image: null }), followUps: null, include: SEM_CONTEUDO }).payload;
  const quebrado = await semear({ ...popup, design: { blocks: "quebrado" } }, { design_mode: "custom", name: "Design quebrado" });
  const futuro = await semear({ ...payloadDeNotificacao(), version: 2 }, { name: "Do futuro" });

  const pagina = await queries.listTemplates({ filter: "all", page: 1, search: "" });
  const itemQuebrado = pagina.items.find((item) => item.id === quebrado.id);
  const itemFuturo = pagina.items.find((item) => item.id === futuro.id);
  assert.equal(itemQuebrado.readable, true);
  assert.equal(itemFuturo.readable, false);
  assert.equal(itemFuturo.summary, "Este modelo não pode ser aberto.");

  const detalhe = await queries.getTemplateDetail(quebrado.id);
  assert.equal(detalhe.payload.design, null);
  assert.deepEqual(detalhe.notes, [M.readDesign]);
  assert.equal((await queries.getTemplateDetail(futuro.id)).payload, null);
});

/* ------------------------------------------------------------------------------------------------
 * 10 e 11: arquivos no "Usar" (D16)
 * ---------------------------------------------------------------------------------------------- */

test("10. usar, arquivos: o vídeo de um modelo não é conferido de novo (nem o de um excluído há 10 dias); sem o modelo é 400 e o objeto fica; excluído há 31 dias e sem o objeto é 400; a auditoria só leva os encontrados", async () => {
  // O tipo gravado no Storage nao bate com os bytes: a conferencia recusaria.
  const video = await montarVideo("video/webm");
  const design = personalizadoComVideo(video);
  const modelo = await semear(payloadDeDesign(design), { name: "Com vídeo" });
  const draft = popupComDesign(design);

  const comModelo = ok(await salvarAviso({ draft, fromTemplates: [modelo.id] }));
  const [usado] = await auditorias("communication.template_used", comModelo.id);
  assert.deepEqual(usado, { actor_id: produtor.id, entity_id: comModelo.id, entity_type: "campaign", metadata: { created: true, template_ids: [modelo.id] } });

  const semModelo = await salvarAviso({ draft });
  assert.deepEqual([semModelo.status, semModelo.fieldErrors?.["design.media.video"]], [400, ["Use um vídeo MP4 (H.264) ou WEBM."]]);
  assert.equal(await existeNoBucket(VIDEOS, video.path), true, "o salvar nunca apaga");

  unwrap(await db.from(T).update({ deleted_at: new Date(Date.now() - 10 * DIA).toISOString(), deleted_by: produtor.id }).eq("id", modelo.id), "Excluindo há 10 dias");
  ok(await salvarAviso({ draft, fromTemplates: [modelo.id] }));

  unwrap(await db.from(T).update({ deleted_at: new Date(Date.now() - 31 * DIA).toISOString() }).eq("id", modelo.id), "Excluindo há 31 dias");
  unwrap(await db.storage.from(VIDEOS).remove([video.path]), "Tirando o objeto");
  const velho = await salvarAviso({ draft, fromTemplates: [modelo.id] });
  assert.deepEqual([velho.status, velho.fieldErrors?.["design.media.video"]], [400, ["Envie o vídeo de novo."]]);

  // 20 ids com repetidos e um que nao existe: aceito; a auditoria so tem o encontrado.
  const outroVideo = await montarVideo("video/webm");
  const outro = await semear(payloadDeDesign(personalizadoComVideo(outroVideo)), { name: "Outro" });
  const ids = [outro.id, outro.id.toUpperCase(), ...Array.from({ length: 18 }, () => randomUUID())];
  const vinte = ok(await salvarAviso({ draft: popupComDesign(personalizadoComVideo(outroVideo)), fromTemplates: ids }));
  assert.deepEqual((await auditorias("communication.template_used", vinte.id))[0].metadata.template_ids, [outro.id]);

  const vinteEUm = await salvarAviso({ draft, fromTemplates: [...ids, randomUUID()] });
  assert.deepEqual([vinteEUm.status, vinteEUm.fieldErrors], [400, { fromTemplates: ["Modelo inválido."] }]);
});

test("11. usar, arquivos válidos: imagem e vídeo do Livre de um modelo entram num aviso gravado com as medidas do servidor; o design de Meus modelos com fromTemplates grava sem conferir (created: false)", async () => {
  const imagem = await montarImagemLivre();
  const video = await montarVideo("video/mp4");
  const livre = {
    ...freeStarters.freeStarterDesign("blank"),
    assets: [
      { height: 99, id: "foto", kind: "image", path: imagem, width: 99 },
      { id: "midia", kind: "video", mimeType: "video/mp4", path: video.path }
    ]
  };
  livre.children = [{ asset: "midia", id: "video", type: "video" }, { asset: "foto", id: "imagem", type: "image" }, ...livre.children];
  const modelo = ok(await salvarModelo(doDesign({ freeDesign: livre, support: { ctaLabel: "Ver", image: null } }, { origin: "free_editor" })));
  const guardado = (await linhaDoModelo(modelo.id)).payload.design;
  assert.deepEqual(
    [guardado.assets.find((item) => item.id === "foto").width, guardado.assets.find((item) => item.id === "foto").height],
    [64, 48],
    "o modelo guarda as medidas do servidor"
  );

  const aviso = ok(await salvarAviso({ draft: { ...rascunho("popup"), body: "", title: "Pop-up" } }));
  const aplicado = ok(await salvarAviso({ draft: { ...rascunho("popup"), body: "", cta: BOTAO, design: null, freeDesign: { ...livre }, title: "Pop-up" }, id: aviso.id }));
  const linha = unwrap(await db.from("campaigns").select("popup_design").eq("id", aplicado.id).single(), "Lendo o aviso");
  const foto = linha.popup_design.assets.find((item) => item.id === "foto");
  assert.deepEqual([foto.width, foto.height], [64, 48], "as medidas do servidor");

  // Design de Meus modelos aplicado num aviso ja gravado: o video (tipo gravado errado) nao e conferido de novo.
  const ruim = await montarVideo("video/webm");
  const design = personalizadoComVideo(ruim);
  const meu = await semear(payloadDeDesign(design), { name: "Meu design" });
  const gravado = ok(await salvarAviso({ draft: { ...rascunho("popup"), body: "", title: "Outro pop-up" } }));
  const comMeu = ok(await salvarAviso({ draft: popupComDesign(design), fromTemplates: [meu.id], id: gravado.id }));
  assert.deepEqual((await auditorias("communication.template_used", comMeu.id))[0].metadata, { created: false, template_ids: [meu.id] });
});

/* ------------------------------------------------------------------------------------------------
 * 12 e 13: quem envia e a fonte
 * ---------------------------------------------------------------------------------------------- */

test("12. quem envia: quem saiu da equipe vira a escola no Usar e no modo modelo, com as notas; o primeiro salvar depois disso grava; salvar com a pessoa fora dá 400", async () => {
  const pessoa = await criarEquipe(QUEM_SAI);
  const followUps = {
    entryId: randomUUID(),
    goal: null,
    items: [{ children: [], content: { ...conteudoSeguinte("Seguinte"), allowHide: true, poll: null, reactions: true, sender: { userId: pessoa.id } }, id: randomUUID(), when: { anchor: "sent", minutes: 60 }, who: { kind: "everyone" } }]
  };
  const salvo = ok(await salvarModelo({ body: { draft: rascunho("inbox", { sender: { userId: pessoa.id } }), followUps, include: TUDO, source: "notice" }, name: "Com quem envia", origin: "notice_editor" }));

  unwrap(await db.from("admin_roles").delete().eq("user_id", pessoa.id), "Tirando da equipe");

  const usar = await queries.prepareNoticeStart(salvo.id);
  assert.equal(usar.ok, true);
  assert.equal(usar.start.draft.sender, null);
  assert.equal(usar.start.followUps.items[0].content.sender, null);
  assert.ok(usar.start.notes.includes(M.senderGone(QUEM_SAI.nome)), JSON.stringify(usar.start.notes));
  assert.ok(usar.start.notes.includes(M.followUpSenderGone));

  const editor = await queries.prepareTemplateEditor({ id: salvo.id });
  assert.equal(editor.ok, true);
  assert.equal(editor.template.start.draft.sender, null);
  assert.equal(editor.template.start.followUps.items[0].content.sender, null);
  assert.deepEqual(editor.template.notes, [M.senderGone(QUEM_SAI.nome), M.followUpSenderGone]);
  assert.deepEqual(editor.template.include, TUDO);

  const regravado = ok(
    await salvarModelo({
      body: { draft: editor.template.start.draft, followUps: editor.template.start.followUps, include: editor.template.include, source: "notice" },
      expectedUpdatedAt: editor.template.updatedAt,
      id: salvo.id,
      name: editor.template.name,
      origin: "template_editor"
    })
  );
  assert.equal((await linhaDoModelo(regravado.id)).payload.settings.sender, null);

  const fora = await salvarModelo(doRascunho(rascunho("inbox", { sender: { userId: pessoa.id } })));
  assert.deepEqual([fora.status, fora.fieldErrors], [400, { sender: ["Escolha alguém da equipe."] }]);
  const seguinteFora = await salvarModelo({ body: { draft: rascunho(), followUps, include: TUDO, source: "notice" }, name: "X", origin: "notice_editor" });
  assert.deepEqual([seguinteFora.status, seguinteFora.fieldErrors], [400, { "followUps.0.content.sender": ["Escolha alguém da equipe."] }]);

  await limparComunicacao(db);
  await apagarContaDeTeste(db, QUEM_SAI.email);
});

async function fonteDaBiblioteca() {
  const [linha] = unwrap(
    await db
      .from("communication_fonts")
      .insert({ created_by: produtor.id, family_key: `bf_${randomBytes(6).toString("hex")}`, file_path: `fonts/${randomBytes(12).toString("hex")}.woff2`, format: "woff2", name: "Fonte do modelo", size_bytes: 1_000 })
      .select("id"),
    "Criando a fonte"
  );
  return linha.id;
}

function designComFonte(fontId) {
  const design = structuredClone(custom.popupStarterDesign("text_only"));
  design.blocks[1].style.font = { id: fontId, kind: "uploaded" };
  design.fonts = [fontId];
  return design;
}

test("13. fonte: excluir a fonte que um modelo não excluído cita dá 409 fontInTemplates(1); depois de excluir o modelo, a fonte sai", async () => {
  const fontId = await fonteDaBiblioteca();
  const salvo = ok(await salvarModelo(doDesign({ design: designComFonte(fontId) })));

  actAs(produtor);
  const presa = await designActions.deletePopupFont({ id: fontId });
  assert.deepEqual([presa.status, presa.error], [409, M.fontInTemplates(1)]);

  actAs(produtor);
  ok(await actions.deleteTemplate({ id: salvo.id }));
  actAs(produtor);
  ok(await designActions.deletePopupFont({ id: fontId }));
});

/* ------------------------------------------------------------------------------------------------
 * 14 a 16: duplicar, excluir, lista e a preparacao do editor
 * ---------------------------------------------------------------------------------------------- */

test("14. duplicar e excluir: cópia com o mesmo payload e id novo; excluir marca deleted_at e deleted_by, some da lista, de Meus modelos e dos recentes, e o Storage fica", async () => {
  const video = await montarVideo("video/mp4");
  const salvo = ok(await salvarModelo(doDesign({ design: personalizadoComVideo(video) })));
  const original = await linhaDoModelo(salvo.id);

  actAs(produtor);
  const copia = ok(await actions.duplicateTemplate({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
  const linhaCopia = await linhaDoModelo(copia.id);
  assert.notEqual(copia.id, salvo.id);
  assert.equal(copia.name, "Design de teste (cópia)");
  assert.deepEqual(linhaCopia.payload, original.payload);
  assert.deepEqual([linhaCopia.kind, linhaCopia.design_mode, linhaCopia.created_by], ["design", "custom", produtor.id]);
  assert.deepEqual((await auditorias("communication.template_duplicated", copia.id))[0].metadata, { kind: "design", source_id: salvo.id });

  actAs(produtor);
  ok(await actions.deleteTemplate({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
  const excluido = await linhaDoModelo(salvo.id);
  assert.ok(excluido.deleted_at);
  assert.equal(excluido.deleted_by, produtor.id);
  assert.deepEqual((await auditorias("communication.template_deleted", salvo.id))[0].metadata, { design_mode: "custom", kind: "design" });

  assert.ok(!(await queries.listTemplates({ filter: "all", page: 1, search: "" })).items.some((item) => item.id === salvo.id));
  actAs(produtor);
  assert.ok(!ok(await actions.loadDesignTemplates({ mode: "custom" })).items.some((item) => item.id === salvo.id));
  assert.ok(!(await queries.listRecentTemplates(5)).items.some((item) => item.id === salvo.id));
  assert.equal(await queries.getTemplateDetail(salvo.id), null);
  assert.equal(await existeNoBucket(VIDEOS, video.path), true, "excluir o modelo não mexe no Storage");
});

test("15. lista: busca sem acento nem maiúscula, filtro por tipo e modo, páginas de 20, totalAll e as fontes das miniaturas", async () => {
  const fontId = await fonteDaBiblioteca();
  await semear(payloadDeNotificacao(), { name: "Lançamento de Novembro" });
  await semear(payloadDeDesign(designComFonte(fontId)), { name: "Design com fonte" });
  await semear(model.templatePayloadOfDesign({ design: null, freeDesign: freeStarters.freeStarterDesign("blank"), support: { ctaLabel: null, image: null } }), { name: "Livre" });
  const payload = payloadDeNotificacao();
  unwrap(
    await db.from(T).insert(Array.from({ length: 21 }, (_, index) => ({ created_by: produtor.id, design_mode: null, kind: "inbox", name: `Página ${index}`, payload, updated_by: produtor.id }))),
    "Semeando a lista"
  );
  const { count } = await db.from(T).select("id", { count: "exact", head: true }).is("deleted_at", null);

  const busca = await queries.listTemplates({ filter: "all", page: 1, search: "lancamento" });
  assert.deepEqual(busca.items.map((item) => item.name), ["Lançamento de Novembro"]);
  assert.equal(busca.total, 1);
  assert.equal(busca.totalAll, count);
  assert.deepEqual(busca.items[0].createdBy, { id: produtor.id, name: contas.produtor.nome });
  assert.equal(busca.items[0].typeLabel, "Notificação");
  assert.equal(busca.items[0].summary, "Leva conteúdo e segmento");
  assert.deepEqual(busca.items[0].thumb, { icon: null, kind: "inbox" });

  const livres = await queries.listTemplates({ filter: "design_free", page: 1, search: "" });
  assert.deepEqual(livres.items.map((item) => item.name), ["Livre"]);
  assert.equal(livres.items[0].thumb.kind, "free");

  const personalizados = await queries.listTemplates({ filter: "design_custom", page: 1, search: "" });
  assert.deepEqual(personalizados.items.map((item) => item.name), ["Design com fonte"]);
  assert.deepEqual(personalizados.fonts.map((font) => font.id), [fontId], "as fontes das miniaturas da página");

  const primeira = await queries.listTemplates({ filter: "inbox", page: 1, search: "" });
  const segunda = await queries.listTemplates({ filter: "inbox", page: 2, search: "" });
  assert.equal(primeira.items.length, 20);
  assert.equal(primeira.pageSize, 20);
  assert.equal(segunda.items.length, primeira.total - 20);
  assert.equal(new Set([...primeira.items, ...segunda.items].map((item) => item.id)).size, primeira.total);
  assert.equal((await queries.listTemplates({ filter: "inbox", page: 99, search: "" })).page, 2, "página além do fim volta à última");

  const recentes = await queries.listRecentTemplates(5);
  assert.equal(recentes.items.length, 5);
  assert.equal(recentes.total, count);
  assert.deepEqual(Object.keys(recentes.items[0]).sort(), ["id", "kind", "name", "typeLabel"]);
});

test("16. preparar o editor e o Usar: modelos novos dos quatro tipos; Design sem modo e id inexistente dão null; version 2 não abre; os ids do modo modelo ficam, os do Usar mudam", async () => {
  for (const kind of ["inbox", "popup"]) {
    const novo = await queries.prepareTemplateEditor({ kind });
    assert.equal(novo.ok, true);
    assert.deepEqual([novo.template.id, novo.template.kind, novo.template.updatedAt, novo.template.name], [null, kind, null, ""]);
    assert.deepEqual(novo.template.include, TUDO);
    assert.deepEqual(novo.template.start.draft, emptyNoticeDraft(kind));
  }

  for (const mode of ["custom", "free"]) {
    const novo = await queries.prepareTemplateEditor({ kind: "design", mode });
    assert.equal(novo.template.designMode, mode);
    assert.equal(novo.template.start.draft.design, null);
    assert.equal(novo.template.start.draft.freeDesign, null);
  }

  assert.equal(await queries.prepareTemplateEditor({ kind: "design" }), null);
  assert.equal(await queries.prepareTemplateEditor({ id: randomUUID() }), null);
  assert.equal(await queries.prepareTemplateEditor({ id: "nao-e-uuid" }), null);

  const futuro = await semear({ ...payloadDeNotificacao(), version: 2 }, { name: "Do futuro" });
  assert.deepEqual(await queries.prepareTemplateEditor({ id: futuro.id }), { id: futuro.id, name: "Do futuro", ok: false, reason: "unreadable" });
  assert.deepEqual(await queries.prepareNoticeStart(futuro.id), { ok: false, reason: "unreadable" });

  const aviso = await notificacaoComSeguintes();
  actAs(produtor);
  const comSeguintes = ok(await actions.saveTemplateFromNotice({ include: TUDO, name: "Com seguintes", noticeId: aviso.id }));
  const ids = (start) => [start.followUps.entryId, ...start.followUps.items.flatMap((item) => [item.id, ...item.children.map((child) => child.id)])];

  const leitura1 = await queries.prepareTemplateEditor({ id: comSeguintes.id });
  const leitura2 = await queries.prepareTemplateEditor({ id: comSeguintes.id });
  assert.deepEqual(ids(leitura1.template.start), ids(leitura2.template.start), "modo modelo: os ids gravados (D28)");
  assert.equal(leitura1.template.start.followUps.entryId, aviso.seguintes.entryNodeId);

  const uso1 = await queries.prepareNoticeStart(comSeguintes.id);
  const uso2 = await queries.prepareNoticeStart(comSeguintes.id);
  assert.equal(ids(uso1.start).filter((id) => ids(uso2.start).includes(id) || ids(leitura1.template.start).includes(id)).length, 0, "Usar: ids novos a cada leitura");
  assert.equal(uso1.start.templateId, comSeguintes.id);
  assert.ok(uso1.audiences.length >= 3, "o segmento do aviso e o de cada seguinte");

  actAs(produtor);
  ok(await actions.deleteTemplate({ id: comSeguintes.id }));
  assert.deepEqual(await queries.prepareNoticeStart(comSeguintes.id), { ok: false, reason: "missing" });
  assert.deepEqual(await queries.prepareNoticeStart("nao-e-uuid"), { ok: false, reason: "missing" });
});

test("17. modo modelo: só as notas de leitura e de quem envia; as de aplicar o design (o texto que o botão ganhou) ficam para o Usar", async () => {
  // Pop-up Personalizado com o botao principal e "Levar o conteúdo" desligado: so o texto do botao vai, no apoio.
  const semConteudo = model.templatePayloadOfDraft({ draft: popupComDesign(custom.popupStarterDesign("text_only"), { image: null }), followUps: null, include: SEM_CONTEUDO }).payload;
  assert.equal(semConteudo.content, null);
  assert.equal(semConteudo.designSupport.ctaLabel, BOTAO.label);
  const linha = await semear(semConteudo, { name: "Sem conteúdo" });

  const editor = await queries.prepareTemplateEditor({ id: linha.id });
  assert.equal(editor.ok, true);
  assert.deepEqual(editor.template.notes, [], "nenhuma nota do Usar no modo modelo (o destino nao iria para o modelo)");
  assert.deepEqual(editor.template.start.notes, []);
  assert.deepEqual(editor.template.include, SEM_CONTEUDO);
  assert.deepEqual(editor.template.start.draft.cta, { display: "button", href: "", label: BOTAO.label, target: "same_tab" }, "o botao abre com o texto do modelo");

  // O Usar continua pedindo o destino (o aviso novo grava o destino).
  const uso = await queries.prepareNoticeStart(linha.id);
  assert.equal(uso.ok, true);
  assert.ok(uso.start.notes.includes(M.applyCta(BOTAO.label)), JSON.stringify(uso.start.notes));

  // A nota de leitura continua no modo modelo (D29 pergunta antes do primeiro salvar).
  const quebrado = await semear({ ...semConteudo, design: { blocks: "quebrado" } }, { design_mode: "custom", name: "Design quebrado" });
  const aberto = await queries.prepareTemplateEditor({ id: quebrado.id });
  assert.deepEqual(aberto.template.notes, [M.readDesign]);
  assert.equal(model.hasReadNotes(aberto.template.notes), true);
});

test("18. duplicar um modelo com emoji na fronteira do corte grava a cópia (o emoji inteiro sai, nunca a metade)", async () => {
  // 71 letras + emoji: 73 unidades UTF-16, 72 caracteres (o banco aceita, o campo do nome tambem).
  const nome = `${"a".repeat(71)}😀`;
  const linha = await semear(payloadDeNotificacao(), { name: nome });

  actAs(produtor);
  const copia = ok(await actions.duplicateTemplate({ id: linha.id }));
  assert.equal(copia.name, `${"a".repeat(71)} (cópia)`);
  assert.equal((await linhaDoModelo(copia.id)).name, copia.name);
});
