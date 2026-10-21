import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { apagarContaDeTeste, ESCOLA_DE_TESTE, limparComunicacao, SENHA_DE_TESTE, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Comunicacao > Fluxos pelas Server Actions do admin (docs/23 §2.5 a §2.9 e §6.2) contra o banco LOCAL de
// verdade: salvar (versao, 409, quem envia), ativar (conteudo "sent" antes do fluxo no ar, e-mail "enviada em
// seu nome"), a regra dos 500 alunos (a analista nao ve Comunicacao, a editora pede aprovacao, o dono aprova),
// alteracoes no ar, pausar, retomar, encerrar, duplicar, excluir, retirar um passo e o teste para mim; e as
// leituras da tela (lista, topo, detalhe com os numeros por passo). O motor e o processFlows de verdade.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/flow-actions.ts");
const queries = await import("../../src/server/communications/flow-queries.ts");
const { processFlows } = await import("../../src/server/communications/flow-engine.ts");
const { createFactsLoader } = await import("../../src/server/communications/facts-loader.ts");
const { settleSenderNotices } = await import("../../src/server/communications/sender-notices.ts");
const { FLOW_CHANGED_MESSAGE } = await import("../../src/server/communications/flow-store.ts");

const PRODUTO = ESCOLA_DE_TESTE.cursoBloqueado.id;
const ACESSO = "teste-fluxos-admin:";
const produtor = usuarioDeTeste(contas.produtor);
const analista = usuarioDeTeste(contas.analista);
const professor = contas.professor;
const aluna = contas.aluna;
const aluno = contas.alunoSemAcesso;
const ALL = { canPublish: true, canPublishLarge: true, canWrite: true };

// Editora de conteudo (messaging.write + messaging.publish, sem publish_large) e uma redatora que so cria.
const EDITORA = { email: "editora.fluxos@bunker707.test", nome: "Editora de Fluxos", permissions: {}, role: "editor" };
const REDATORA = { email: "redatora.fluxos@bunker707.test", nome: "Redatora de Fluxos", permissions: { actions: ["messaging.write"] }, role: "custom" };
// Alunos em massa para passar de 500: fora do dominio das contas de teste (limparComunicacao filtra por ele).
const MUITOS = { dominio: "muitos.bunker707.test", prefixo: "fluxos-admin-", quantos: 501 };

const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };
const regras = (...items) => ({ kind: "rules", root: { items, match: "all" } });
const fez = (action, nodeId) => ({ action, negate: false, ref: { kind: "node", nodeId }, type: "message" });
const conteudo = (title, extra = {}) => ({ audio: null, body: "", cta: null, icon: null, image: null, response: null, sender: null, title, validity: { mode: "default" }, ...extra });

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

/** psql no banco local (SUPABASE_DB_URL do .env.test.local): o Auth nao cria 501 contas num instante. */
function sql(statement) {
  const url = process.env.SUPABASE_DB_URL;
  assert.ok(url, "SUPABASE_DB_URL vem do .env.test.local (npm run db:start)");
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-c", statement], { stdio: ["ignore", "ignore", "inherit"] });
}

function criarMuitosAlunos() {
  sql(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
      '${MUITOS.prefixo}' || g || '@${MUITOS.dominio}', '', now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', 'Aluno em massa ' || g), now(), now()
    from generate_series(1, ${MUITOS.quantos}) g
    on conflict do nothing`);
}

function apagarMuitosAlunos() {
  sql(`delete from auth.users where email like '${MUITOS.prefixo}%@${MUITOS.dominio}'`);
}

async function liberar(userId) {
  unwrap(
    await db.from("entitlements").insert({
      ends_at: null,
      source_event_id: `${ACESSO}${userId}:${randomUUID()}`,
      source_provider: "manual",
      starts_at: "2026-01-01T12:00:00.000Z",
      status: "active",
      target_id: PRODUTO,
      target_type: "standalone_course",
      user_id: userId
    }),
    "Liberando acesso de teste"
  );
}

async function limpar() {
  await limparComunicacao(db);
  unwrap(await db.from("entitlements").delete().like("source_event_id", `${ACESSO}%`), "Apagando acessos de teste");
  unwrap(await db.from("email_outbox").delete().eq("kind", "sent_as").in("user_id", [professor.id, produtor.id]), "Apagando e-mails 'enviada em seu nome'");
}

let editora;
let redatora;

before(async () => {
  apagarMuitosAlunos();
  await limpar();
  editora = await criarEquipe(EDITORA);
  redatora = await criarEquipe(REDATORA);
});

after(async () => {
  await limpar();
  apagarMuitosAlunos();
  await apagarContaDeTeste(db, EDITORA.email);
  await apagarContaDeTeste(db, REDATORA.email);
});

beforeEach(async () => {
  await limpar();
  await liberar(aluna.id);
  await liberar(aluno.id);
});

/** entrada -> "Primeira" (logo depois) -> condicao "abriu a Primeira" (1 dia) -> Nao: "Segunda". */
function rascunho({ entry = quemTemOProduto, mode = "current", name = "Fluxo da equipe", sender = null } = {}) {
  const ids = { condicao: randomUUID(), entrada: randomUUID(), primeira: randomUUID(), segunda: randomUUID() };
  const flow = {
    entry: { audience: entry, mode },
    goal: null,
    messages: { [ids.primeira]: conteudo("Primeira", { sender }), [ids.segunda]: conteudo("Segunda") },
    name,
    nodes: [
      { branch: null, id: ids.entrada, kind: "entry", parentId: null, position: 0 },
      { anchor: "previous", anchorNodeId: null, branch: null, filter: null, id: ids.primeira, kind: "message", offsetMinutes: 0, parentId: ids.entrada, position: 0 },
      {
        anchor: "previous",
        anchorNodeId: null,
        branch: null,
        condition: regras(fez("opened", ids.primeira)),
        id: ids.condicao,
        kind: "condition",
        maxWaitMinutes: null,
        offsetMinutes: 1_440,
        parentId: ids.primeira,
        position: 0,
        waitUntilTrue: false
      },
      { anchor: "previous", anchorNodeId: null, branch: "no", filter: null, id: ids.segunda, kind: "message", offsetMinutes: 0, parentId: ids.condicao, position: 0 }
    ],
    origin: "builder"
  };

  return { flow, ids };
}

async function salvar(user, flow, extra = {}) {
  actAs(user);
  return actions.saveFlow({ flow, ...extra });
}

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

async function fluxoNoBanco(id) {
  return unwrap(await db.from("communication_flows").select("*").eq("id", id).single(), "Lendo o fluxo");
}

async function versoes(flowId) {
  return unwrap(await db.from("campaigns").select("id,status,sent_at,flow_node_id,title").eq("flow_id", flowId).order("created_at"), "Lendo as versoes");
}

async function auditoria(entityId, action) {
  return unwrap(await db.from("admin_audit_log").select("action,actor_id,count,metadata").eq("entity_id", entityId).eq("action", action), "Lendo a auditoria");
}

function tick(offsetMs = 60_000) {
  const now = new Date(Date.now() + offsetMs);
  return processFlows({ budgetMs: 25_000, db, facts: createFactsLoader(db, now), now, signal: new AbortController().signal });
}

/* ------------------------------------------------------------------------------------------------
 * Salvar
 * ---------------------------------------------------------------------------------------------- */

test("salvar cria o rascunho; duas telas com a mesma versao: a segunda recebe 409 e nada muda", async () => {
  const { flow, ids } = rascunho();
  const criado = ok(await salvar(produtor, flow));

  assert.equal(criado.status, "draft");
  assert.equal(criado.nodeIds[ids.primeira], ids.primeira, "os ids do navegador sao os ids dos passos");

  const detalhe = await queries.getFlowDetail(criado.id, { permissions: ALL });
  assert.equal(detalhe.situation, "draft");
  assert.equal(detalhe.situationLabel, "Rascunho");
  assert.deepEqual(
    detalhe.draft.nodes.map((node) => node.id),
    [ids.entrada, ids.primeira, ids.condicao, ids.segunda]
  );
  assert.equal(detalhe.draft.messages[ids.primeira].title, "Primeira");
  assert.equal(detalhe.report, null, "nunca ativado: sem numeros");
  assert.ok(detalhe.actions.includes("activate"));
  assert.equal((await auditoria(criado.id, "communication.flow_saved")).length, 1);

  const primeira = ok(await salvar(produtor, { ...flow, name: "Nome da primeira tela" }, { expectedUpdatedAt: criado.updatedAt, id: criado.id }));
  const segunda = await salvar(produtor, { ...flow, name: "Nome da segunda tela" }, { expectedUpdatedAt: criado.updatedAt, id: criado.id });

  assert.equal(segunda.status, 409);
  assert.equal(segunda.error, FLOW_CHANGED_MESSAGE);
  assert.equal((await fluxoNoBanco(criado.id)).name, "Nome da primeira tela");
  assert.notEqual(primeira.updatedAt, criado.updatedAt);
});

test("salvar com quem envia fora da equipe: 400 no campo do passo; ativar sem notificacao ou com o segmento vazio: 422", async () => {
  const { flow, ids } = rascunho({ sender: { userId: aluna.id } });
  const recusado = await salvar(produtor, flow);

  assert.equal(recusado.status, 400);
  assert.deepEqual(recusado.fieldErrors[`flow.messages.${ids.primeira}.sender`], ["Escolha alguém da equipe."]);

  const entrada = randomUUID();
  const vazio = ok(
    await salvar(produtor, { entry: { audience: quemTemOProduto, mode: "current" }, goal: null, messages: {}, name: "Começar do zero", nodes: [{ branch: null, id: entrada, kind: "entry", parentId: null, position: 0 }], origin: "builder" })
  );
  actAs(produtor);
  const semNotificacao = await actions.activateFlow({ expectedUpdatedAt: vazio.updatedAt, id: vazio.id });
  assert.deepEqual([semNotificacao.status, semNotificacao.error], [422, "Adicione pelo menos uma notificação."]);

  const ninguem = ok(await salvar(produtor, rascunho({ entry: regras({ op: "has", productIds: ["teste-fluxos-admin-ninguem"], type: "product" }) }).flow));
  actAs(produtor);
  const segmentoVazio = await actions.activateFlow({ expectedUpdatedAt: ninguem.updatedAt, id: ninguem.id });
  assert.deepEqual([segmentoVazio.status, segmentoVazio.error], [422, "Nenhum aluno está neste segmento agora."]);
  assert.equal((await fluxoNoBanco(ninguem.id)).status, "draft");
});

/* ------------------------------------------------------------------------------------------------
 * Ativar e numeros
 * ---------------------------------------------------------------------------------------------- */

test("ativar ate 500: conteudo 'sent', fluxo no ar, e-mail para quem envia; o tick envia e o relatorio mostra os numeros por passo", async () => {
  const { flow, ids } = rascunho({ sender: { userId: professor.id } });
  const salvo = ok(await salvar(produtor, flow));
  actAs(produtor);
  const ativo = ok(await actions.activateFlow({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));

  assert.equal(ativo.situation, "active");
  assert.equal(ativo.entryCount, 2, "a aluna e o aluno; o professor e da equipe e nao conta");
  assert.ok((await versoes(salvo.id)).every((row) => row.status === "sent" && row.sent_at), "o conteudo sai de rascunho antes do fluxo ficar no ar");
  const noBanco = await fluxoNoBanco(salvo.id);
  assert.deepEqual([noBanco.status, noBanco.entry_count, Boolean(noBanco.activated_at)], ["active", 2, true]);
  assert.deepEqual((await auditoria(salvo.id, "communication.flow_activated")).map((row) => row.metadata.sender_user_ids), [[professor.id]]);

  await settleSenderNotices();
  const emails = unwrap(await db.from("email_outbox").select("metadata,subject").eq("kind", "sent_as").eq("user_id", professor.id), "Lendo e-mails");
  assert.equal(emails.length, 1, "o professor sabe que um fluxo usa o nome dele");
  assert.equal(emails[0].metadata.flow_id, salvo.id);
  assert.equal(emails[0].subject, "Um fluxo de notificações usa o seu nome");

  const resultado = await tick();
  assert.equal(resultado.sent, 2);

  const detalhe = await queries.getFlowDetail(salvo.id, { permissions: ALL });
  assert.equal(detalhe.situation, "active");
  assert.deepEqual([detalhe.report.totals.entered, detalhe.report.totals.active, detalhe.report.enteredToday], [2, 2, 2]);
  assert.deepEqual([detalhe.report.nodes[ids.primeira].reached, detalhe.report.nodes[ids.primeira].received], [2, 2]);
  assert.equal(detalhe.report.nodes[ids.condicao].waiting, 2, "a condicao espera 1 dia");
  assert.equal(detalhe.report.overdue, 0);

  const lista = await queries.listFlows({ filter: "active", permissions: ALL });
  const linha = lista.items.find((item) => item.id === salvo.id);
  assert.ok(linha, "aparece em Ativos");
  assert.deepEqual([linha.totals.entered, linha.totals.sent, linha.situationLabel], [2, 2, "Ativo"]);
  assert.ok(linha.actions.includes("pause"));
  assert.equal((await queries.listFlows({ filter: "drafts" })).items.some((item) => item.id === salvo.id), false);

  const topo = await queries.flowsOverview({ end: new Date(), start: new Date(Date.now() - 86_400_000) });
  assert.ok(topo.activeFlows >= 1 && topo.inFlowNow >= 2 && topo.sent >= 2);

  // Um periodo que terminou antes do envio nao conta o que saiu depois do fim (a RPC 7.7 so tem "desde").
  const ontem = await queries.flowsOverview({ end: new Date(Date.now() - 3_600_000), start: new Date(Date.now() - 86_400_000) });
  assert.ok(topo.sent - ontem.sent >= 2, `as 2 enviadas agora ficam fora do periodo que terminou ha 1 hora (${ontem.sent} de ${topo.sent})`);
});

test("acima de 500 alunos: a analista recebe 403, a editora pede aprovacao e o dono aprova e ativa", async () => {
  criarMuitosAlunos();

  try {
    const { flow } = rascunho({ entry: { kind: "everyone" }, name: "Para todo mundo" });
    const salvo = ok(await salvar(editora, flow));

    actAs(analista);
    const daAnalista = await actions.activateFlow({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id });
    assert.equal(daAnalista.status, 403, "a analista nao ve Comunicacao");

    actAs(editora);
    const pedido = ok(await actions.activateFlow({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
    assert.equal(pedido.situation, "pending_approval");
    assert.ok(pedido.entryCount > 500, `contou ${pedido.entryCount}`);
    const pendente = await fluxoNoBanco(salvo.id);
    assert.deepEqual([pendente.status, pendente.requested_by], ["pending_approval", editora.id]);
    assert.ok((await versoes(salvo.id)).every((row) => row.status === "draft"), "nada sai enquanto espera");
    assert.equal((await auditoria(salvo.id, "communication.flow_approval_requested")).length, 1);

    actAs(editora);
    assert.equal((await actions.approveFlow({ expectedUpdatedAt: pedido.updatedAt, id: salvo.id })).status, 403, "aprovar e de dono ou administrador");

    actAs(produtor);
    const aprovado = ok(await actions.approveFlow({ expectedUpdatedAt: pedido.updatedAt, id: salvo.id }));
    assert.equal(aprovado.situation, "active");
    const noAr = await fluxoNoBanco(salvo.id);
    assert.deepEqual([noAr.status, noAr.approved_by], ["active", produtor.id]);
    assert.ok(noAr.entry_count > 500);
    assert.ok((await versoes(salvo.id)).every((row) => row.status === "sent"));

    // No ar, mudar vale como publicar: acima de 500, so o dono; sem messaging.publish, nada (nunca vira pedido).
    const detalhe = await queries.getFlowDetail(salvo.id);
    const mudado = { ...detalhe.draft, name: "Para todo mundo (ajustado)" };
    const daEditora = await salvar(editora, mudado, { expectedUpdatedAt: detalhe.updatedAt, id: salvo.id });
    assert.deepEqual([daEditora.status, daEditora.error], [403, "Para mudar um fluxo ativo para este segmento, peça a um dono ou administrador."]);
    const daRedatora = await salvar(redatora, mudado, { expectedUpdatedAt: detalhe.updatedAt, id: salvo.id });
    assert.deepEqual([daRedatora.status, daRedatora.error], [403, "Só quem pode publicar muda um fluxo no ar. Duplique para criar outro."]);
    const doDono = ok(await salvar(produtor, mudado, { expectedUpdatedAt: detalhe.updatedAt, id: salvo.id }));
    assert.equal(doDono.status, "active");
    assert.equal((await auditoria(salvo.id, "communication.flow_changes_applied")).length, 1);

    // Pausar e de quem publica; retomar acima de 500, so o dono.
    actAs(editora);
    const pausado = ok(await actions.pauseFlow({ expectedUpdatedAt: doDono.updatedAt, id: salvo.id }));
    assert.equal(pausado.situation, "paused");
    const retomarEditora = await actions.resumeFlow({ expectedUpdatedAt: pausado.updatedAt, id: salvo.id });
    assert.deepEqual([retomarEditora.status, retomarEditora.error], [403, "Este fluxo passou de 500 alunos. Para retomar, peça a um dono ou administrador."]);
    actAs(produtor);
    const retomado = ok(await actions.resumeFlow({ expectedUpdatedAt: pausado.updatedAt, id: salvo.id }));
    assert.equal(retomado.situation, "active");
    ok(await actions.endFlow({ expectedUpdatedAt: retomado.updatedAt, id: salvo.id }));
  } finally {
    apagarMuitosAlunos();
  }
});

test("aguardando aprovacao: gravar uma mudanca volta o fluxo para rascunho e cancela o pedido", async () => {
  criarMuitosAlunos();

  try {
    const salvo = ok(await salvar(editora, rascunho({ entry: { kind: "everyone" } }).flow));
    actAs(editora);
    const pedido = ok(await actions.activateFlow({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
    const detalhe = await queries.getFlowDetail(salvo.id);

    assert.equal(pedido.situation, "pending_approval");
    const gravado = ok(await salvar(editora, { ...detalhe.draft, name: "Outro nome" }, { expectedUpdatedAt: detalhe.updatedAt, id: salvo.id }));
    assert.equal(gravado.status, "draft");
    const noBanco = await fluxoNoBanco(salvo.id);
    assert.deepEqual([noBanco.status, noBanco.requested_by], ["draft", null]);
  } finally {
    apagarMuitosAlunos();
  }
});

/* ------------------------------------------------------------------------------------------------
 * Duplicar, excluir, retirar e teste
 * ---------------------------------------------------------------------------------------------- */

test("duplicar copia os passos com ids novos e as regras apontando para a copia; excluir so depois de encerrar", async () => {
  const { flow, ids } = rascunho();
  const salvo = ok(await salvar(produtor, flow));
  actAs(produtor);
  const ativo = ok(await actions.activateFlow({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));

  actAs(produtor);
  const copia = ok(await actions.duplicateFlow({ id: salvo.id }));
  const detalhe = await queries.getFlowDetail(copia.id);
  assert.equal(detalhe.draft.name, "Fluxo da equipe (cópia)");
  assert.equal(detalhe.status, "draft");
  const [entrada, primeira, condicao, segunda] = detalhe.draft.nodes;
  assert.ok([entrada, primeira, condicao, segunda].every((node) => !Object.values(ids).includes(node.id)), "ids novos");
  assert.deepEqual(condicao.condition.root.items[0].ref, { kind: "node", nodeId: primeira.id }, "a regra confere a notificacao da copia");
  assert.equal(segunda.parentId, condicao.id);
  assert.ok((await versoes(copia.id)).every((row) => row.status === "draft"), "versoes novas em rascunho");
  assert.equal((await auditoria(copia.id, "communication.flow_duplicated"))[0].metadata.source_id, salvo.id);

  actAs(produtor);
  const noAr = await actions.deleteFlow({ expectedUpdatedAt: ativo.updatedAt, id: salvo.id });
  assert.deepEqual([noAr.status, noAr.error], [409, "Encerre o fluxo antes de excluir."]);
  const encerrado = ok(await actions.endFlow({ expectedUpdatedAt: ativo.updatedAt, id: salvo.id }));
  assert.equal(encerrado.situation, "ended");
  assert.equal((await queries.getFlowDetail(salvo.id)).situation, "ended");
  ok(await actions.deleteFlow({ expectedUpdatedAt: encerrado.updatedAt, id: salvo.id }));
  assert.equal(await queries.getFlowDetail(salvo.id), null);
  assert.equal((await queries.listFlows({})).items.some((item) => item.id === salvo.id), false, "some da lista");
  assert.ok((await queries.listFlows({ filter: "drafts" })).items.some((item) => item.id === copia.id));
});

test("retirar um passo do sino: as linhas saem e quem esperava para ali; o teste para mim chega so no sino de quem pediu", async () => {
  const { flow, ids } = rascunho();
  const salvo = ok(await salvar(produtor, flow));
  actAs(produtor);
  ok(await actions.activateFlow({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
  await tick();

  const linhas = () => db.from("notifications").select("id,user_id,is_test").eq("flow_node_id", ids.primeira).eq("is_test", false);
  assert.equal(unwrap(await linhas(), "Lendo o sino").length, 2);

  const atual = await fluxoNoBanco(salvo.id);
  actAs(produtor);
  const retirado = ok(await actions.withdrawFlowMessage({ expectedUpdatedAt: atual.updated_at, id: salvo.id, nodeId: ids.primeira }));
  assert.equal(retirado.removed, 2);
  assert.equal(unwrap(await linhas(), "Lendo o sino").length, 0);
  const tarefas = unwrap(await db.from("communication_flow_tasks").select("status,result").eq("node_id", ids.condicao), "Lendo tarefas");
  assert.ok(tarefas.length === 2 && tarefas.every((row) => row.status === "canceled" && row.result === "withdrawn"));
  assert.equal((await auditoria(salvo.id, "communication.flow_step_withdrawn"))[0].count, 2);

  actAs(produtor);
  ok(await actions.sendFlowMessageTest({ id: salvo.id, nodeId: ids.segunda }));
  const [versao] = (await versoes(salvo.id)).filter((row) => row.flow_node_id === ids.segunda);
  const teste = unwrap(await db.from("notifications").select("user_id,is_test,dedupe_key").eq("campaign_id", versao.id), "Lendo o teste");
  assert.deepEqual(teste, [{ dedupe_key: `campaign-test:${versao.id}`, is_test: true, user_id: produtor.id }]);
});
