import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as esperar } from "node:timers/promises";
import { after, before, beforeEach, test } from "node:test";
import { actAs } from "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { apagarContaDeTeste, ESCOLA_DE_TESTE, limparComunicacao, SENHA_DE_TESTE, seedEscolaDeTeste, usuarioDeTeste } from "../fixtures/escola-de-teste.mjs";

// Comunicacao v3a, ajustes depois do primeiro teste do produtor (lado da equipe, docs/24) contra o banco
// LOCAL (migracao 202610220002): "Permitir que o aluno exclua do sino" gravado no aviso e nas seguintes,
// lido pelo editor, copiado ao duplicar e mudado depois do envio; "Por um tempo" a partir de 5 minutos; a
// enquete de uma seguinte que ja chegou a alguem nao muda (e muda enquanto ninguem recebeu); a contagem da
// enquete soma as versoes do passo; quem envia uma seguinte e saiu da equipe nao trava corrigir a notificacao
// enviada; e as paginas acompanhadas do fluxo nao perdem a regra de uma seguinte salva ao mesmo tempo que a
// notificacao enviada. O produtor age pelas Server Actions; o motor dos fluxos roda como o job chama
// (processFlows, com o tempo simulado pelo `now`); os alunos votam pela rota chamada como funcao.

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const actions = await import("../../src/server/communications/actions.ts");
const { emptyNoticeDraft } = await import("../../src/server/communications/schemas.ts");
const { FLOW_POLL_LOCKED_MESSAGE } = await import("../../src/server/communications/flow-schemas.ts");
const { getNoticeDetail } = await import("../../src/server/communications/queries.ts");
const { processFlows } = await import("../../src/server/communications/flow-engine.ts");
const { createFactsLoader } = await import("../../src/server/communications/facts-loader.ts");
const pollRoute = await import("../../src/app/api/notifications/[id]/poll/route.ts");

const MIN = 60_000;
const HORA = 60 * MIN;
const PRODUTO = ESCOLA_DE_TESTE.cursoBloqueado.id;
const ACESSO = "teste-ajustes-v3a:";
const aluna = usuarioDeTeste(contas.aluna);
const aluno = usuarioDeTeste(contas.alunoSemAcesso);
const produtor = usuarioDeTeste(contas.produtor);
const TODAS = { canPublish: true, canPublishLarge: true, canWrite: true };
// Pessoa da equipe que envia uma seguinte e depois sai da equipe (conta propria: a escola de teste nao muda).
const REMETENTE = { email: "remetente.ajustes-v3a@bunker707.test", nome: "Remetente das Seguintes" };

const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };
const conteudo = (title, extra = {}) => ({ audio: null, body: "", cta: null, icon: null, image: null, reactions: true, response: null, sender: null, title, validity: { mode: "default" }, ...extra });
const ENQUETE = { closesAt: null, multiple: false, options: [{ id: "aaaa1111", label: "Sábado" }, { id: "bbbb2222", label: "Domingo" }], question: "Qual dia?", showResults: true };

let remetente = null;

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

async function criarRemetente() {
  const { data } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = data?.users.find((item) => item.email === REMETENTE.email);

  if (!user) {
    user = unwrap(
      await db.auth.admin.createUser({ email: REMETENTE.email, email_confirm: true, password: SENHA_DE_TESTE, user_metadata: { full_name: REMETENTE.nome } }),
      "Criando quem envia"
    ).user;
  }

  unwrap(await db.from("profiles").update({ full_name: REMETENTE.nome }).eq("id", user.id), "Nome de quem envia");

  return { email: REMETENTE.email, id: user.id, nome: REMETENTE.nome };
}

async function naEquipe(userId) {
  unwrap(await db.from("admin_roles").upsert({ permissions: {}, role: "editor", user_id: userId }, { onConflict: "user_id" }), "Dando a funcao");
}

async function limpar() {
  await limparComunicacao(db);
  unwrap(await db.from("entitlements").delete().like("source_event_id", `${ACESSO}%`), "Apagando acessos de teste");
  const pessoas = [produtor.id, ...(remetente ? [remetente.id] : [])];
  unwrap(await db.from("email_outbox").delete().eq("kind", "sent_as").in("user_id", pessoas), "Apagando os e-mails");
}

before(async () => {
  await limpar();
  remetente = await criarRemetente();
});

after(async () => {
  await limpar();
  await apagarContaDeTeste(db, REMETENTE.email);
});

beforeEach(async () => {
  await limpar();
  await naEquipe(remetente.id);
  await liberar(aluna.id);
  await liberar(aluno.id);
});

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

function rascunho(extra = {}) {
  return { ...emptyNoticeDraft("inbox"), audience: quemTemOProduto, body: "Traga suas dúvidas para a live.", title: "Live de quinta", ...extra };
}

function seguinte(title, { content = {}, id = randomUUID(), minutes = 60, who = { kind: "everyone" } } = {}) {
  return { children: [], content: conteudo(title, content), id, when: { anchor: "sent", minutes }, who };
}

/** Grava o aviso e as seguintes como o editor faz; publica se pedir. */
async function avisoComSeguintes({ draft = {}, followUps, publish = true }) {
  actAs(produtor);
  const salvo = ok(await actions.saveNoticeDraft({ draft: rascunho(draft) }));
  const seguintes = ok(await actions.saveNoticeFollowUps({ expectedNoticeUpdatedAt: salvo.updatedAt, followUps, goal: null, noticeId: salvo.id }));

  if (!publish) {
    return { flowId: seguintes.flowId, id: salvo.id, updatedAt: salvo.updatedAt };
  }

  const publicado = ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
  assert.equal(publicado.situation, "sent");

  return { flowId: seguintes.flowId, id: salvo.id, updatedAt: publicado.updatedAt };
}

/** Salva as seguintes de novo como o relatorio faz (a versao do fluxo e a do aviso lidas agora). */
async function regravarSeguintes(noticeId, followUps) {
  actAs(produtor);
  const detalhe = await getNoticeDetail(noticeId, { permissions: TODAS });

  return actions.saveNoticeFollowUps({ expectedFlowUpdatedAt: detalhe.followUps.updatedAt, expectedNoticeUpdatedAt: detalhe.updatedAt, followUps, goal: null, noticeId });
}

/** Salva a notificacao enviada como o editor faz: o rascunho lido do servidor com as mudancas por cima. */
async function editar(id, patch) {
  actAs(produtor);
  const detalhe = await getNoticeDetail(id, { permissions: TODAS });

  return actions.saveNoticeDraft({ draft: { ...detalhe.draft, ...patch }, expectedUpdatedAt: detalhe.updatedAt, id });
}

function tick(now) {
  const date = new Date(now);
  return processFlows({ budgetMs: 25_000, db, facts: createFactsLoader(db, date), now: date, signal: new AbortController().signal });
}

async function campanha(id) {
  return unwrap(await db.from("campaigns").select("*").eq("id", id).single(), "Lendo o aviso");
}

async function fluxo(id) {
  return unwrap(await db.from("communication_flows").select("*").eq("id", id).single(), "Lendo o fluxo");
}

/** A versao atual do conteudo de um passo. */
async function versaoAtual(nodeId) {
  const no = unwrap(await db.from("communication_flow_nodes").select("campaign_id").eq("id", nodeId).single(), "Lendo o passo");

  return campanha(no.campaign_id);
}

async function linhasDoPasso(nodeId) {
  return unwrap(await db.from("notifications").select("id,user_id,campaign_id").eq("flow_node_id", nodeId).eq("is_test", false), "Lendo o sino do passo");
}

async function votar(user, rowId, optionIds) {
  actAs(user);
  const response = await pollRoute.POST(
    new Request(`http://localhost/api/notifications/${rowId}/poll`, { body: JSON.stringify({ optionIds }), headers: { "content-type": "application/json" }, method: "POST" }),
    { params: Promise.resolve({ id: rowId }) }
  );

  return { body: await response.json(), status: response.status };
}

async function contagem(campaignId) {
  return unwrap(await db.rpc("communication_poll_tally", { p_campaign_id: campaignId }), "Contando a enquete");
}

/** psql no banco local (SUPABASE_DB_URL do .env.test.local). */
function dbUrl() {
  const url = process.env.SUPABASE_DB_URL;
  assert.ok(url, "SUPABASE_DB_URL vem do .env.test.local (npm run db:start)");
  return url;
}

/* ------------------------------------------------------------------------------------------------
 * Lixeira do aluno por notificacao
 * ---------------------------------------------------------------------------------------------- */

test("allow_hide: gravado no aviso e na seguinte, lido pelo editor, copiado ao duplicar e mudado depois do envio", async () => {
  const s1 = randomUUID();
  const aviso = await avisoComSeguintes({ draft: { allowHide: false }, followUps: [seguinte("Lembrete", { content: { allowHide: false }, id: s1 })], publish: false });

  assert.equal((await campanha(aviso.id)).allow_hide, false);
  assert.equal((await versaoAtual(s1)).allow_hide, false, "a seguinte tambem");

  actAs(produtor);
  const detalhe = await getNoticeDetail(aviso.id, { permissions: TODAS });
  assert.equal(detalhe.draft.allowHide, false, "o editor abre como foi gravado");
  assert.equal(detalhe.followUps.items[0].content.allowHide, false, "o cartao da seguinte tambem");

  // Duplicar copia o aviso e as seguintes como estao.
  const copia = ok(await actions.duplicateNotice({ id: aviso.id }));
  assert.equal((await campanha(copia.id)).allow_hide, false);
  const [fluxoDaCopia] = unwrap(await db.from("communication_flows").select("id").eq("source_campaign_id", copia.id).is("deleted_at", null), "Fluxo da copia");
  const passosDaCopia = unwrap(await db.from("communication_flow_nodes").select("id").eq("flow_id", fluxoDaCopia.id).eq("kind", "message"), "Passos da copia");
  assert.equal(passosDaCopia.length, 1);
  assert.equal((await versaoAtual(passosDaCopia[0].id)).allow_hide, false, "a seguinte da copia tambem");

  // Rascunho sem o campo (editor antigo) = com lixeira.
  const semCampo = rascunho({ title: "Sem o campo" });
  delete semCampo.allowHide;
  const antigo = ok(await actions.saveNoticeDraft({ draft: semCampo }));
  assert.equal((await campanha(antigo.id)).allow_hide, true);

  // Pop-up grava o padrao (nao vai para o sino).
  const pop = ok(
    await actions.saveNoticeDraft({ draft: { ...emptyNoticeDraft("popup"), allowHide: false, audience: quemTemOProduto, body: "Turma nova.", title: "Turma nova" } })
  );
  assert.equal((await campanha(pop.id)).allow_hide, true);

  // Depois do envio, muda (para todos na hora, como o resto do conteudo).
  const publicado = ok(await actions.publishNotice({ expectedUpdatedAt: aviso.updatedAt, id: aviso.id }));
  assert.equal(publicado.situation, "sent");
  const editado = ok(await editar(aviso.id, { allowHide: true }));
  assert.equal(editado.status, "sent");
  const depois = await campanha(aviso.id);
  assert.equal(depois.allow_hide, true);
  assert.ok(depois.edited_at, "fica marcado como editado");
});

/* ------------------------------------------------------------------------------------------------
 * "Por um tempo" a partir de 5 minutos
 * ---------------------------------------------------------------------------------------------- */

test("validade de 5 minutos: o servidor e o banco aceitam; 4 minutos o banco recusa", async () => {
  actAs(produtor);
  const salvo = ok(await actions.saveNoticeDraft({ draft: rascunho({ validity: { minutes: 5, mode: "duration" } }) }));
  assert.equal((await campanha(salvo.id)).validity_minutes, 5);

  const recusado = await actions.saveNoticeDraft({ draft: rascunho({ validity: { minutes: 4, mode: "duration" } }) });
  assert.equal(recusado.ok, false);
  assert.equal(recusado.status, 400);
  assert.equal(recusado.error, "No mínimo 5 minutos.");

  const direto = await db.from("campaigns").update({ validity_minutes: 4 }).eq("id", salvo.id);
  assert.ok(direto.error, "o check campaigns_validity_v3 recusa menos de 5 minutos");

  // Enviada: a linha do aluno some do sino 5 minutos depois de chegar.
  const publicado = ok(await actions.publishNotice({ expectedUpdatedAt: salvo.updatedAt, id: salvo.id }));
  assert.equal(publicado.situation, "sent");
  const [linha] = unwrap(await db.from("notifications").select("created_at,expires_at").eq("campaign_id", salvo.id).eq("user_id", aluna.id).eq("is_test", false), "Linha da aluna");
  // O fim sai da hora do envio e created_at da hora da gravacao (milissegundos de diferenca).
  assert.ok(Math.abs(Date.parse(linha.expires_at) - Date.parse(linha.created_at) - 5 * MIN) < 30_000, JSON.stringify(linha));
});

/* ------------------------------------------------------------------------------------------------
 * Enquete de uma seguinte no ar
 * ---------------------------------------------------------------------------------------------- */

test("enquete de uma seguinte no ar: muda enquanto ninguem recebeu; depois que chegou a alguem, 422 e nada muda", async () => {
  const s1 = randomUUID();
  const comEnquete = (title, poll) => seguinte(title, { content: { poll }, id: s1 });
  const aviso = await avisoComSeguintes({ followUps: [comEnquete("Qual dia é melhor?", ENQUETE)] });
  const now = Date.now();

  assert.equal((await fluxo(aviso.flowId)).status, "active");

  // Ninguem recebeu ainda: renomear a opcao vale (versao nova, como todo conteudo de fluxo no ar).
  const renomeada = { ...ENQUETE, options: [{ id: "aaaa1111", label: "Sábado de manhã" }, ENQUETE.options[1]] };
  ok(await regravarSeguintes(aviso.id, [comEnquete("Qual dia é melhor?", renomeada)]));
  assert.equal((await versaoAtual(s1)).poll.options[0].label, "Sábado de manhã");

  await tick(now + MIN);
  await tick(now + 2 * HORA);
  assert.equal((await linhasDoPasso(s1)).length, 2, "chegou aos dois alunos");

  // Chegou a alguem: renomear, trocar ou tirar a enquete e recusado, e a versao atual fica.
  const antes = await versaoAtual(s1);
  const outraVez = { ...renomeada, options: [{ id: "aaaa1111", label: "Domingo" }, { id: "bbbb2222", label: "Sábado" }] };

  for (const poll of [outraVez, { ...renomeada, question: "Que dia?" }, null]) {
    const recusado = await regravarSeguintes(aviso.id, [comEnquete("Qual dia é melhor?", poll)]);
    assert.equal(recusado.ok, false);
    assert.equal(recusado.status, 422);
    assert.equal(recusado.error, FLOW_POLL_LOCKED_MESSAGE);
  }

  const depois = await versaoAtual(s1);
  assert.equal(depois.id, antes.id, "nenhuma versao nova");
  assert.equal(depois.poll.options[0].label, "Sábado de manhã");

  // O resto do conteudo continua mudando (a enquete igual).
  ok(await regravarSeguintes(aviso.id, [comEnquete("Qual dia fica melhor?", renomeada)]));
  assert.equal((await versaoAtual(s1)).title, "Qual dia fica melhor?");
});

test("contagem da enquete de uma seguinte soma as versoes do passo (voto na 1, titulo mudou, voto na 2)", async () => {
  const s1 = randomUUID();
  const aviso = await avisoComSeguintes({ followUps: [seguinte("Qual dia?", { content: { poll: ENQUETE }, id: s1 })] });
  const now = Date.now();

  await tick(now + MIN);
  await tick(now + 2 * HORA);

  const linhas = await linhasDoPasso(s1);
  const v1 = (await versaoAtual(s1)).id;
  const daAluna = linhas.find((linha) => linha.user_id === aluna.id);
  const doAluno = linhas.find((linha) => linha.user_id === aluno.id);
  assert.ok(daAluna && doAluno);
  assert.equal(daAluna.campaign_id, v1);

  assert.equal((await votar(aluna, daAluna.id, ["aaaa1111"])).status, 200);
  assert.deepEqual(await contagem(v1), { counts: { aaaa1111: 1 }, voters: 1 });

  // O titulo muda no fluxo no ar: versao nova do passo (a enquete e a mesma).
  ok(await regravarSeguintes(aviso.id, [seguinte("Qual dia fica melhor?", { content: { poll: ENQUETE }, id: s1 })]));
  const v2 = (await versaoAtual(s1)).id;
  assert.notEqual(v2, v1);

  // O aluno recebeu a versao 2 (o motor grava a linha apontando para a versao atual do passo).
  unwrap(await db.from("notifications").update({ campaign_id: v2 }).eq("id", doAluno.id), "O aluno recebeu a versao 2");
  const voto = await votar(aluno, doAluno.id, ["bbbb2222"]);
  assert.equal(voto.status, 200, JSON.stringify(voto.body));

  // Quem votou numa versao e na outra conta junto, vista de qualquer versao (o sino de cada um mostra o total).
  const esperado = { counts: { aaaa1111: 1, bbbb2222: 1 }, voters: 2 };
  assert.deepEqual(await contagem(v1), esperado);
  assert.deepEqual(await contagem(v2), esperado);
});

/* ------------------------------------------------------------------------------------------------
 * Quem envia uma seguinte saiu da equipe
 * ---------------------------------------------------------------------------------------------- */

test("quem envia uma seguinte saiu da equipe: corrigir a notificacao enviada vale; salvar a seguinte assim, nao", async () => {
  const s1 = randomUUID();
  const followUps = [seguinte("Lembrete", { content: { sender: { userId: remetente.id } }, id: s1 })];
  const aviso = await avisoComSeguintes({ followUps });

  unwrap(await db.from("admin_roles").delete().eq("user_id", remetente.id), "Saiu da equipe");

  const corrigido = ok(await editar(aviso.id, { title: "Live de quinta (corrigido)" }));
  assert.equal(corrigido.status, "sent");
  assert.equal((await campanha(aviso.id)).title, "Live de quinta (corrigido)");

  // Onde as seguintes sao salvas, a conferencia continua.
  const seguintes = await regravarSeguintes(aviso.id, followUps);
  assert.equal(seguintes.ok, false);
  assert.equal(seguintes.error, "Escolha alguém da equipe.");
});

/* ------------------------------------------------------------------------------------------------
 * Paginas acompanhadas: a notificacao enviada e uma seguinte salvas ao mesmo tempo
 * ---------------------------------------------------------------------------------------------- */

test("paginas acompanhadas: trocar o destino da enviada enquanto outra tela grava 'visitou a página' numa seguinte nao perde a pagina", async () => {
  const s1 = randomUUID();
  const cta = { display: "button", href: `/conteudo/${PRODUTO}`, label: "Ver o curso", target: "same_tab" };
  const aviso = await avisoComSeguintes({ draft: { cta }, followUps: [seguinte("Lembrete", { id: s1 })] });
  const antes = await fluxo(aviso.flowId);
  assert.deepEqual(antes.watched_page_keys, [`content:${PRODUTO}`]);

  // Outra tela grava a arvore com "visitou Suporte" na seguinte (como communication_save_flow: passo e fluxo na
  // mesma transacao, a versao do fluxo muda) e segura a transacao aberta por uns segundos.
  const filtro = JSON.stringify({ kind: "rules", root: { items: [{ negate: false, page: { key: "support", kind: "fixed" }, since: { kind: "entered" }, type: "page_visit" }], match: "all" } });
  const transacao = [
    "begin;",
    `update public.communication_flow_nodes set filter = '${filtro}'::jsonb where id = '${s1}';`,
    `update public.communication_flows set revision = revision + 1, watched_page_keys = array['content:${PRODUTO}', 'support'] where id = '${aviso.flowId}';`,
    "select pg_sleep(2.5);",
    "commit;"
  ].join("\n");
  const outraTela = spawn("psql", [dbUrl(), "-v", "ON_ERROR_STOP=1", "-q", "-c", transacao], { env: { ...process.env, PGAPPNAME: "teste-ajustes-v3a" }, stdio: "ignore" });
  const terminou = new Promise((resolve, reject) => {
    outraTela.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`psql saiu com ${code}`))));
    outraTela.on("error", reject);
  });

  // Espera a outra tela estar com a transacao aberta (ja gravou, ainda nao confirmou).
  for (let tentativa = 0; ; tentativa += 1) {
    const ativa = execFileSync(
      "psql",
      [dbUrl(), "-At", "-c", "select count(*) from pg_stat_activity where application_name = 'teste-ajustes-v3a' and query ilike '%pg_sleep%' and state = 'active'"],
      { encoding: "utf8" }
    ).trim();

    if (ativa === "1") {
      break;
    }

    assert.ok(tentativa < 100, "a transacao da outra tela nao comecou");
    await esperar(50);
  }

  // A enviada muda o destino agora: le a arvore antiga (a outra tela ainda nao confirmou) e so grava as paginas
  // depois, na versao do fluxo que leu; como a versao mudou no meio, le de novo e junta as duas.
  const editado = await editar(aviso.id, { cta: { ...cta, href: "/minhas-compras" } });
  await terminou;
  assert.equal(editado.ok, true, JSON.stringify(editado));

  const depois = await fluxo(aviso.flowId);
  assert.deepEqual([...depois.watched_page_keys].sort(), ["purchases", "support"], "a pagina da regra nova e a do destino novo");
  assert.equal(editado.data.flowUpdatedAt === null || Date.parse(editado.data.flowUpdatedAt) === Date.parse(depois.updated_at), true, "a versao nova do fluxo volta para o editor");
});

/* ------------------------------------------------------------------------------------------------
 * Excluir e Retirar do sino mais rapidos: o mesmo resultado, sem desenhar a pagina na resposta
 * ---------------------------------------------------------------------------------------------- */

// So revalidatePath conta: a tag dos pop-ups no ar e das visitas de pagina (updateTag) continua quando o fluxo
// ou o pop-up muda.
const invalidacoes = () => (globalThis.__integrationInvalidations ?? []).filter((item) => item.kind === "path");

test("Excluir e Retirar do sino: o mesmo resultado de antes, sem revalidatePath (a tela atualiza depois do toast)", async () => {
  const now = Date.now();

  // Enviada com uma seguinte que ja saiu: Excluir tira do sino (a principal e a seguinte), encerra e tira o fluxo.
  const s1 = randomUUID();
  const enviada = await avisoComSeguintes({ followUps: [seguinte("Lembrete", { id: s1 })] });
  await tick(now + MIN);
  await tick(now + 2 * HORA);
  assert.equal((await linhasDoPasso(s1)).length, 2);

  const antes = invalidacoes().length;
  actAs(produtor);
  const excluida = ok(await actions.deleteNotice({ expectedUpdatedAt: (await campanha(enviada.id)).updated_at, id: enviada.id }));
  assert.equal(excluida.removed, 2);
  assert.equal(invalidacoes().length, antes, "nada de revalidatePath na resposta da acao");

  const avisoExcluido = await campanha(enviada.id);
  assert.equal(avisoExcluido.status, "canceled");
  assert.ok(avisoExcluido.deleted_at);
  const fluxoExcluido = await fluxo(enviada.flowId);
  assert.equal(fluxoExcluido.status, "ended");
  assert.equal(fluxoExcluido.ended_reason, "source_deleted");
  assert.ok(fluxoExcluido.deleted_at);
  assert.equal((await linhasDoPasso(s1)).length, 0, "a seguinte que ja saiu some do sino");
  assert.equal(unwrap(await db.from("notifications").select("id").eq("campaign_id", enviada.id).eq("is_test", false), "Linhas").length, 0);
  const [auditoria] = unwrap(
    await db.from("admin_audit_log").select("metadata").eq("entity_id", enviada.id).eq("action", "communication.deleted"),
    "Auditoria"
  );
  assert.equal(auditoria.metadata.follow_ups_removed, 2);
  assert.equal(auditoria.metadata.removed, 2);

  // Retirar do sino: cancela, encerra as seguintes e tira as linhas; sem revalidatePath.
  const s2 = randomUUID();
  const retirada = await avisoComSeguintes({ draft: { title: "Para retirar" }, followUps: [seguinte("Depois", { id: s2 })] });
  const antesDeRetirar = invalidacoes().length;
  actAs(produtor);
  const retirado = ok(await actions.withdrawNotice({ alsoFollowUps: true, expectedUpdatedAt: (await campanha(retirada.id)).updated_at, id: retirada.id }));
  assert.equal(retirado.removed, 2);
  assert.equal(retirado.situation, "canceled");
  assert.equal(invalidacoes().length, antesDeRetirar);
  assert.equal((await fluxo(retirada.flowId)).ended_reason, "source_withdrawn");
  assert.equal((await campanha(retirada.id)).deleted_at, null, "retirar nao exclui");

  // Pop-up no ar: encerrado e tirado da lista numa gravacao so.
  actAs(produtor);
  const pop = ok(
    await actions.saveNoticeDraft({
      draft: { ...emptyNoticeDraft("popup"), audience: quemTemOProduto, body: "A turma nova começa segunda.", title: "Turma nova" }
    })
  );
  ok(await actions.publishNotice({ expectedUpdatedAt: pop.updatedAt, id: pop.id }));
  const noAr = await campanha(pop.id);
  assert.equal(noAr.status, "active");
  ok(await actions.deleteNotice({ expectedUpdatedAt: noAr.updated_at, id: pop.id }));
  const popExcluido = await campanha(pop.id);
  assert.equal(popExcluido.status, "ended");
  assert.ok(popExcluido.deleted_at);
  assert.ok(popExcluido.ends_at && Date.parse(popExcluido.ends_at) <= Date.now(), "o fim vira agora");

  // Rascunho com seguintes: sai da lista com o fluxo; a versao velha da 409 e nada muda.
  const rascunhoComSeguintes = await avisoComSeguintes({ draft: { title: "Rascunho" }, followUps: [seguinte("Depois")], publish: false });
  const conflito = await actions.deleteNotice({ expectedUpdatedAt: "2026-01-01T00:00:00.000Z", id: rascunhoComSeguintes.id });
  assert.equal(conflito.status, 409);
  assert.equal((await campanha(rascunhoComSeguintes.id)).deleted_at, null);
  ok(await actions.deleteNotice({ expectedUpdatedAt: rascunhoComSeguintes.updatedAt, id: rascunhoComSeguintes.id }));
  assert.ok((await campanha(rascunhoComSeguintes.id)).deleted_at);
  assert.ok((await fluxo(rascunhoComSeguintes.flowId)).deleted_at, "o fluxo das seguintes sai junto");
});
