import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import "../support/integration-hooks.mjs";
import { createLocalAdminClient, unwrap } from "../support/local-db.mjs";
import { ESCOLA_DE_TESTE, limparComunicacao, seedEscolaDeTeste } from "../fixtures/escola-de-teste.mjs";

// Motor dos fluxos e das notificacoes seguintes (Comunicacao v2, docs/23 §4) contra o banco LOCAL de
// verdade, com o tempo simulado pelo `now` (sempre no futuro: a linha do sino grava created_at =
// greatest(now, relogio)). O fluxo e gravado pelo caminho de verdade (saveFlowTree + RPC 7.13) e o tick e
// processFlows, como o job "comunicacao" chama. Quem entra: quem tem acesso a um curso de teste que este
// arquivo libera so para a aluna e o aluno sem acesso (e para o professor, que e da equipe e nunca recebe).

const db = createLocalAdminClient();
const contas = await seedEscolaDeTeste(db);
const { processFlows } = await import("../../src/server/communications/flow-engine.ts");
const { createFactsLoader } = await import("../../src/server/communications/facts-loader.ts");
const store = await import("../../src/server/communications/flow-store.ts");
const { dueFromAnchor } = await import("../../src/server/communications/flow-model.ts");
const { markAllSeen } = await import("../../src/server/communications/inbox.ts");

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const PRODUTO = ESCOLA_DE_TESTE.cursoBloqueado.id;
const OUTRO_PRODUTO = "teste-fluxos-objetivo";
const ACESSO = "teste-fluxos:";
const aluna = contas.aluna;
const aluno = contas.alunoSemAcesso;
const professor = contas.professor;
const produtor = contas.produtor;
const quemTemOProduto = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO], type: "product" }], match: "all" } };

/** Meio-dia em Sao Paulo (15:00 UTC) daqui a `dias` dias: o "agora" simulado de cada teste. */
function meioDia(dias) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + dias);
  date.setUTCHours(15, 0, 0, 0);
  return date.getTime();
}

/** Hora de Sao Paulo (UTC-3) de um dia simulado: horaSP(meioDia(3), 23, 40). */
function horaSP(diaMeioDia, horas, minutos = 0) {
  return diaMeioDia - 12 * HORA + horas * HORA + minutos * MIN;
}

async function liberar(userId, productId = PRODUTO, startsAt = "2026-01-01T12:00:00.000Z") {
  unwrap(
    await db.from("entitlements").insert({
      ends_at: null,
      source_event_id: `${ACESSO}${productId}:${userId}:${randomUUID()}`,
      source_provider: "manual",
      starts_at: startsAt,
      status: "active",
      target_id: productId,
      target_type: "standalone_course",
      user_id: userId
    }),
    "Liberando acesso de teste"
  );
}

async function limpar() {
  await limparComunicacao(db);
  unwrap(await db.from("entitlements").delete().like("source_event_id", `${ACESSO}%`), "Apagando acessos de teste");
  unwrap(await db.from("admin_roles").delete().eq("user_id", aluno.id), "Tirando o aluno da equipe");
}

before(limpar);
after(limpar);
beforeEach(async () => {
  await limpar();
  await liberar(aluna.id);
  await liberar(aluno.id);
  await liberar(professor.id);
});

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

const conteudo = (title, extra = {}) => ({ audio: null, body: "", cta: null, icon: null, image: null, response: null, sender: null, title, validity: { mode: "default" }, ...extra });
const regras = (...items) => ({ kind: "rules", root: { items, match: "all" } });
const fez = (action, nodeId, negate = false) => ({ action, negate, ref: { kind: "node", nodeId }, type: "message" });

function passo(extra) {
  return {
    anchor: "previous",
    anchorNodeId: null,
    branch: null,
    campaignId: null,
    condition: null,
    expireWithAnchor: false,
    filter: null,
    kind: "message",
    maxWaitMinutes: null,
    offsetMinutes: 0,
    position: 0,
    waitUntilTrue: false,
    ...extra
  };
}

const entrada = (id) => passo({ id, kind: "entry", parentId: null });

/** Grava um fluxo do construtor pelo caminho de verdade (versoes + RPC 7.5) e devolve o que foi gravado. */
async function gravar({ contents, entry = quemTemOProduto, flowId, goal = null, mode = "current", name = "Fluxo de teste", nodes, now, expectedUpdatedAt }) {
  return store.saveFlowTree(db, {
    actorId: produtor.id,
    contents,
    expectedUpdatedAt,
    flow: { entryAudience: entry, entryMode: mode, goal, name, origin: "builder" },
    flowId,
    now: new Date(now),
    tree: { nodes, origin: "builder" }
  });
}

async function ativar(flow, now) {
  return store.changeFlowState(db, { actorId: produtor.id, expectedUpdatedAt: flow.updated_at, flowId: flow.id, now: new Date(now), to: "active" });
}

/** Fluxo simples: entrada -> "Primeira" (logo depois) -> "Segunda" (1 dia depois). */
async function fluxoDeDuas({ goal = null, mode = "current", now, segundaMinutos = 1_440 } = {}) {
  const ids = { entrada: randomUUID(), primeira: randomUUID(), segunda: randomUUID() };
  const saved = await gravar({
    contents: { [ids.primeira]: conteudo("Primeira"), [ids.segunda]: conteudo("Segunda") },
    goal,
    mode,
    nodes: [entrada(ids.entrada), passo({ id: ids.primeira, parentId: ids.entrada }), passo({ id: ids.segunda, offsetMinutes: segundaMinutos, parentId: ids.primeira })],
    now
  });
  const flow = await ativar(saved.flow, now);

  return { flow, ids, saved };
}

function tick(now, extra = {}) {
  const date = new Date(now);
  return processFlows({ budgetMs: 25_000, db, facts: createFactsLoader(db, date), now: date, signal: new AbortController().signal, ...extra });
}

async function tarefas(flowId) {
  return unwrap(await db.from("communication_flow_tasks").select("*").eq("flow_id", flowId).order("user_id").order("node_id"), "Lendo tarefas");
}

async function tarefa(nodeId, userId) {
  return unwrap(await db.from("communication_flow_tasks").select("*").eq("node_id", nodeId).eq("user_id", userId).maybeSingle(), "Lendo tarefa");
}

async function linhas(filtro) {
  let query = db.from("notifications").select("id,user_id,campaign_id,dedupe_key,flow_id,flow_node_id,created_at,expires_at,seen_at,read_at,opened_at");

  for (const [column, value] of Object.entries(filtro)) {
    query = query.eq(column, value);
  }

  return unwrap(await query.order("created_at"), "Lendo o sino");
}

async function passagens(flowId) {
  return unwrap(await db.from("communication_flow_runs").select("user_id,status,entered_at,finished_at").eq("flow_id", flowId).order("user_id"), "Lendo passagens");
}

async function fluxo(flowId) {
  return unwrap(await db.from("communication_flows").select(store.FLOW_COLUMNS).eq("id", flowId).single(), "Lendo fluxo");
}

const quem = (rows) => rows.map((row) => row.user_id).sort();
const alunos = [aluna.id, aluno.id].sort();

/* ------------------------------------------------------------------------------------------------
 * Entrada e primeiro passo
 * ---------------------------------------------------------------------------------------------- */

test("ativar (so quem esta agora): o tick faz entrar quem esta no segmento e envia o primeiro passo; a equipe nunca entra", async () => {
  const now = meioDia(3);
  const { flow, ids } = await fluxoDeDuas({ now });

  const versao = unwrap(await db.from("campaigns").select("id,status,sent_at").eq("flow_node_id", ids.primeira).single(), "Lendo versao");
  assert.equal(versao.status, "sent", "ativar deixa o conteudo 'sent' antes do fluxo ficar no ar");
  assert.equal(Date.parse(versao.sent_at), now);

  const resultado = await tick(now);
  assert.equal(resultado.entered, 2);
  assert.equal(resultado.sent, 2);

  assert.deepEqual(quem(await passagens(flow.id)), alunos, "o professor (equipe) nao entra");

  const primeira = await linhas({ flow_node_id: ids.primeira });
  assert.deepEqual(quem(primeira), alunos);
  assert.ok(primeira.every((row) => row.dedupe_key === `flow:${ids.primeira}` && row.flow_id === flow.id && row.campaign_id === versao.id));
  assert.ok(primeira.every((row) => Date.parse(row.created_at) === now && Date.parse(row.expires_at) === now + 90 * DIA));

  const segunda = (await tarefas(flow.id)).filter((row) => row.node_id === ids.segunda);
  assert.deepEqual(quem(segunda), alunos);
  assert.ok(segunda.every((row) => row.status === "pending" && Date.parse(row.due_at) === now + DIA && Date.parse(row.anchor_at) === now));

  const atualizado = await fluxo(flow.id);
  assert.equal(atualizado.entry_count, 2);
  assert.ok(atualizado.entry_refreshed_at);
  assert.equal(atualizado.updated_at, flow.updated_at, "o que o job grava nao muda a versao do editor (nenhum 409 para quem esta com a tela aberta)");

  // Um dia depois a segunda sai; de novo, nada sai duas vezes.
  assert.equal((await tick(now + DIA)).sent, 2);
  assert.equal((await tick(now + DIA + MIN)).claimed, 0);
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.segunda })), alunos);
  assert.deepEqual((await passagens(flow.id)).map((run) => run.status), ["done", "done"]);
});

test("'so quem entrar a partir de agora': quem ja combinava vira baseline e nunca entra; um acesso novo entra na faixa seguinte", async () => {
  const now = meioDia(4);
  const { flow, ids } = await fluxoDeDuas({ mode: "new_only", now });

  await tick(now);
  assert.deepEqual(
    (await passagens(flow.id)).map((run) => run.status),
    ["baseline", "baseline"]
  );
  assert.equal((await linhas({ flow_id: flow.id })).length, 0);

  // A aluna expirada ganha acesso depois da ativacao: entra na proxima faixa de 15 minutos.
  const expirada = contas.alunaAcessoExpirado;
  await liberar(expirada.id);
  await tick(now + 5 * MIN);
  assert.equal((await passagens(flow.id)).length, 2, "fora da faixa, ninguem novo entra");

  const resultado = await tick(now + 15 * MIN);
  assert.equal(resultado.entered, 1);
  const runs = await passagens(flow.id);
  assert.deepEqual(runs.find((run) => run.user_id === expirada.id)?.status, "active");
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.primeira })), [expirada.id]);
});

test("'quem esta agora e quem entrar depois': entra quem esta e, na faixa seguinte, quem passou a combinar", async () => {
  const now = meioDia(5);
  const { ids } = await fluxoDeDuas({ mode: "current_and_new", now });

  await tick(now);
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.primeira })), alunos);

  const expirada = contas.alunaAcessoExpirado;
  await liberar(expirada.id);
  await tick(now + 15 * MIN);
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.primeira })), [...alunos, expirada.id].sort());
});

test("enrollFlow num fluxo encerrado depois da avaliacao: ninguem entra (0 passagens e 0 tarefas)", async () => {
  const now = meioDia(6);
  const { flow, ids } = await fluxoDeDuas({ now });
  await store.changeFlowState(db, { actorId: produtor.id, expectedUpdatedAt: flow.updated_at, flowId: flow.id, now: new Date(now), to: "ended" });

  const entered = await store.enrollFlow(db, flow.id, [
    { baseline: false, enteredAt: now, tasks: [{ anchorAt: now, deadlineAt: null, dueAt: now, nodeId: ids.primeira }], userId: aluna.id }
  ]);

  assert.equal(entered, 0);
  assert.equal((await passagens(flow.id)).length, 0);
  assert.equal((await tarefas(flow.id)).length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Condicao, espera e objetivo
 * ---------------------------------------------------------------------------------------------- */

test("condicao com os fatos da notificacao: quem abriu vai pelo Sim, quem nao abriu pelo Nao", async () => {
  const now = meioDia(7);
  const ids = { cond: randomUUID(), entrada: randomUUID(), nao: randomUUID(), primeira: randomUUID(), sim: randomUUID() };
  const saved = await gravar({
    contents: { [ids.primeira]: conteudo("Novidade na área"), [ids.sim]: conteudo("Você viu a novidade?"), [ids.nao]: conteudo("Ainda dá tempo") },
    nodes: [
      entrada(ids.entrada),
      passo({ id: ids.primeira, parentId: ids.entrada }),
      passo({ condition: regras(fez("opened", ids.primeira)), id: ids.cond, kind: "condition", offsetMinutes: 1_440, parentId: ids.primeira }),
      passo({ branch: "yes", id: ids.sim, parentId: ids.cond }),
      passo({ branch: "no", id: ids.nao, parentId: ids.cond })
    ],
    now
  });
  const flow = await ativar(saved.flow, now);
  await tick(now);

  const [daAluna] = await linhas({ flow_node_id: ids.primeira, user_id: aluna.id });
  const abriu = new Date(now + HORA).toISOString();
  unwrap(await db.from("notifications").update({ opened_at: abriu, read_at: abriu, seen_at: abriu }).eq("id", daAluna.id), "A aluna abre");

  const resultado = await tick(now + DIA);
  assert.equal(resultado.decided, 2);
  await tick(now + DIA + MIN);

  assert.deepEqual(quem(await linhas({ flow_node_id: ids.sim })), [aluna.id]);
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.nao })), [aluno.id]);
  assert.equal((await tarefa(ids.cond, aluna.id)).result, "yes");
  assert.equal((await tarefa(ids.cond, aluno.id)).result, "no");

  const stats = await store.fetchFlowNodeStats(db, flow.id, {});
  assert.equal(stats.get(ids.cond).yes_count, 1);
  assert.equal(stats.get(ids.cond).no_count, 1);
  assert.equal(stats.get(ids.primeira).received, 2);
  assert.equal(stats.get(ids.primeira).opened, 1);
  assert.equal(stats.get(ids.sim).sent, 1);
});

test("'esperar ate ser Sim' confere a cada 15 minutos e, no fim da espera, segue pelo Nao", async () => {
  const now = meioDia(8);
  const ids = { cond: randomUUID(), entrada: randomUUID(), nao: randomUUID(), primeira: randomUUID() };
  const saved = await gravar({
    contents: { [ids.primeira]: conteudo("Primeira"), [ids.nao]: conteudo("Não clicou") },
    nodes: [
      entrada(ids.entrada),
      passo({ id: ids.primeira, parentId: ids.entrada }),
      passo({ condition: regras(fez("clicked", ids.primeira)), id: ids.cond, kind: "condition", maxWaitMinutes: 60, parentId: ids.primeira, waitUntilTrue: true }),
      passo({ branch: "no", id: ids.nao, parentId: ids.cond })
    ],
    now
  });
  await ativar(saved.flow, now);
  await tick(now);
  await tick(now + MIN);

  const esperando = await tarefa(ids.cond, aluna.id);
  assert.equal(esperando.status, "pending");
  assert.equal(Date.parse(esperando.due_at), now + 15 * MIN, "proxima faixa de 15 minutos");
  assert.equal(Date.parse(esperando.deadline_at), now + HORA);

  await tick(now + 15 * MIN);
  assert.equal(Date.parse((await tarefa(ids.cond, aluna.id)).due_at), now + 30 * MIN);

  await tick(now + HORA);
  assert.equal((await tarefa(ids.cond, aluna.id)).result, "no");
  await tick(now + HORA + MIN);
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.nao })), alunos);
});

test("objetivo: quem ganha o acesso sai do fluxo na varredura da faixa e nao recebe mais nada", async () => {
  // 12:05 em Sao Paulo: fora do minuto da faixa (a varredura fica para as 12:15).
  const now = meioDia(9) + 5 * MIN;
  const objetivo = { kind: "rules", root: { items: [{ op: "has", productIds: [OUTRO_PRODUTO], type: "product" }], match: "all" } };
  const { flow, ids } = await fluxoDeDuas({ goal: objetivo, now, segundaMinutos: 2_880 });

  await tick(now);
  await liberar(aluna.id, OUTRO_PRODUTO, new Date(now + 5 * MIN).toISOString());

  // Faixa das 12:15: a varredura acorda quem espera; o tick seguinte confere o objetivo.
  const faixa = meioDia(9) + 15 * MIN;
  const varredura = await tick(faixa);
  assert.equal(varredura.woken, 2);
  assert.ok((await fluxo(flow.id)).goal_swept_at);
  await tick(faixa + MIN);

  assert.equal((await tarefa(ids.segunda, aluna.id)).result, "goal");
  assert.equal((await tarefa(ids.segunda, aluno.id)).status, "pending", "sem o acesso, so reagendada para a hora certa");
  assert.equal(Date.parse((await tarefa(ids.segunda, aluno.id)).due_at), now + 2 * DIA);
  assert.deepEqual((await passagens(flow.id)).map((run) => [run.user_id, run.status]).sort(), [
    [aluna.id, "goal"],
    [aluno.id, "active"]
  ].sort());

  await tick(now + 2 * DIA);
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.segunda })), [aluno.id]);
});

test("'visitou ... desde que entrou no fluxo' e 'ganhou acesso desde que entrou' usam o entered_at da passagem", async () => {
  const now = meioDia(10);
  const ids = { cond: randomUUID(), entrada: randomUUID(), primeira: randomUUID(), sim: randomUUID(), cond2: randomUUID(), sim2: randomUUID() };
  const visitou = { negate: false, page: { kind: "content", productId: PRODUTO }, since: { kind: "entered" }, type: "page_visit" };
  const ganhou = { negate: false, productIds: [OUTRO_PRODUTO], since: { kind: "entered" }, type: "access_gained" };
  const saved = await gravar({
    contents: { [ids.primeira]: conteudo("Primeira"), [ids.sim]: conteudo("Visitou"), [ids.sim2]: conteudo("Ganhou") },
    nodes: [
      entrada(ids.entrada),
      passo({ id: ids.primeira, parentId: ids.entrada }),
      passo({ condition: regras(visitou), id: ids.cond, kind: "condition", offsetMinutes: 60, parentId: ids.primeira }),
      passo({ branch: "yes", id: ids.sim, parentId: ids.cond }),
      passo({ condition: regras(ganhou), id: ids.cond2, kind: "condition", offsetMinutes: 60, parentId: ids.primeira, position: 1 }),
      passo({ branch: "yes", id: ids.sim2, parentId: ids.cond2 })
    ],
    now
  });
  const flow = await ativar(saved.flow, now);
  assert.deepEqual((await fluxo(flow.id)).watched_page_keys, [`content:${PRODUTO}`]);
  await tick(now);

  // A aluna visitou antes de entrar (nao conta) e o aluno depois; o aluno ganha o acesso depois de entrar.
  unwrap(
    await db.from("member_page_visits").insert([
      { first_visited_at: new Date(now - DIA).toISOString(), last_visited_at: new Date(now - DIA).toISOString(), page_key: `content:${PRODUTO}`, user_id: aluna.id },
      { first_visited_at: new Date(now + 10 * MIN).toISOString(), last_visited_at: new Date(now + 10 * MIN).toISOString(), page_key: `content:${PRODUTO}`, user_id: aluno.id }
    ]),
    "Gravando visitas"
  );
  await liberar(aluno.id, OUTRO_PRODUTO, new Date(now + 20 * MIN).toISOString());
  await liberar(aluna.id, OUTRO_PRODUTO, new Date(now - DIA).toISOString());

  await tick(now + HORA);
  await tick(now + HORA + MIN);
  await tick(now + 2 * HORA + 5 * MIN); // a segunda do aluno no mesmo minuto espera o intervalo de 1 h

  assert.deepEqual(quem(await linhas({ flow_node_id: ids.sim })), [aluno.id]);
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.sim2 })), [aluno.id], "acesso de antes da entrada nao e 'ganhou desde que entrou'");
});

test("condicao com regra de um aviso fora do fluxo (referencia por aviso) le as linhas dele no lote", async () => {
  const now = meioDia(11);
  const aviso = unwrap(
    await db
      .from("campaigns")
      .insert({ audience: { kind: "everyone" }, body: "", created_by: produtor.id, kind: "inbox", sent_at: new Date(now - DIA).toISOString(), status: "sent", title: "Aviso de fora", updated_by: produtor.id })
      .select("id")
      .single(),
    "Criando aviso"
  );
  unwrap(
    await db.from("notifications").insert({
      campaign_id: aviso.id,
      created_at: new Date(now - DIA).toISOString(),
      dedupe_key: `campaign:${aviso.id}`,
      kind: "notice",
      opened_at: new Date(now - HORA).toISOString(),
      read_at: new Date(now - HORA).toISOString(),
      seen_at: new Date(now - HORA).toISOString(),
      user_id: aluna.id
    }),
    "Linha do aviso"
  );
  const ids = { cond: randomUUID(), entrada: randomUUID(), sim: randomUUID() };
  const abriuOAviso = { action: "opened", negate: false, ref: { campaignId: aviso.id, kind: "campaign" }, type: "message" };
  const saved = await gravar({
    contents: { [ids.sim]: conteudo("Abriu o aviso") },
    nodes: [entrada(ids.entrada), passo({ condition: regras(abriuOAviso), id: ids.cond, kind: "condition", parentId: ids.entrada }), passo({ branch: "yes", id: ids.sim, parentId: ids.cond })],
    now
  });
  await ativar(saved.flow, now);
  await tick(now);
  await tick(now + MIN);

  assert.deepEqual(quem(await linhas({ flow_node_id: ids.sim })), [aluna.id]);
  assert.equal((await tarefa(ids.cond, aluno.id)).result, "no");
});

/* ------------------------------------------------------------------------------------------------
 * Pausar, retomar, encerrar e concorrencia
 * ---------------------------------------------------------------------------------------------- */

test("pausado: a sondagem nao ve as tarefas vencidas e nada sai; retomado, o que venceu sai na hora", async () => {
  const now = meioDia(12);
  const { flow, ids } = await fluxoDeDuas({ now, segundaMinutos: 60 });
  await tick(now);

  const pausado = await store.changeFlowState(db, { actorId: produtor.id, expectedUpdatedAt: (await fluxo(flow.id)).updated_at, flowId: flow.id, now: new Date(now), to: "paused" });
  assert.equal(await store.probeDueFlowTasks(db, new Date(now + 2 * HORA)), false, "tarefa de fluxo pausado nao aparece na sondagem");
  assert.equal((await tick(now + 2 * HORA)).claimed, 0);
  assert.equal((await linhas({ flow_node_id: ids.segunda })).length, 0);

  await store.changeFlowState(db, { actorId: produtor.id, expectedUpdatedAt: pausado.updated_at, flowId: flow.id, now: new Date(now + 3 * HORA), to: "active" });
  assert.equal((await tick(now + 3 * HORA)).sent, 2);
});

test("pausar entre a reserva e a aplicacao: o lote volta 'released', nada sai e a tentativa e devolvida", async () => {
  const now = meioDia(13);
  const { flow, ids } = await fluxoDeDuas({ now, segundaMinutos: 60 });
  await tick(now);

  const reservadas = await store.claimFlowTasks(db, { limit: 150, now: new Date(now + HORA) });
  assert.equal(reservadas.length, 2);
  await store.changeFlowState(db, { actorId: produtor.id, expectedUpdatedAt: (await fluxo(flow.id)).updated_at, flowId: flow.id, now: new Date(now + HORA), to: "paused" });

  const versao = unwrap(await db.from("campaigns").select("id").eq("flow_node_id", ids.segunda).single(), "Versao").id;
  const resultados = await store.applyFlowResults(db, {
    now: new Date(now + HORA),
    results: reservadas.map((task) => ({ decision: { action: "send", campaignId: versao, children: [], deadlineAt: null, expiresAt: now + 2 * DIA }, task }))
  });
  assert.deepEqual(resultados.map((row) => row.outcome), ["released", "released"]);
  assert.equal((await linhas({ flow_node_id: ids.segunda })).length, 0);
  assert.equal((await tarefa(ids.segunda, aluna.id)).attempts, 0);
});

test("encerrar cancela as pendentes e as reservadas (tick que caiu) e termina as passagens", async () => {
  const now = meioDia(14);
  const { flow, ids } = await fluxoDeDuas({ now, segundaMinutos: 60 });
  await tick(now);
  await store.claimFlowTasks(db, { limit: 1, now: new Date(now + HORA) });

  await store.changeFlowState(db, { actorId: produtor.id, expectedUpdatedAt: (await fluxo(flow.id)).updated_at, flowId: flow.id, now: new Date(now + HORA), to: "ended" });

  const segunda = (await tarefas(flow.id)).filter((row) => row.node_id === ids.segunda);
  assert.deepEqual(segunda.map((row) => [row.status, row.result]), [
    ["canceled", "flow_ended"],
    ["canceled", "flow_ended"]
  ]);
  assert.deepEqual((await passagens(flow.id)).map((run) => run.status), ["ended", "ended"]);
  assert.equal((await tick(now + 2 * HORA)).claimed, 0);
});

test("dois ticks ao mesmo tempo nunca enviam a mesma notificacao duas vezes", async () => {
  const now = meioDia(15);
  const { ids } = await fluxoDeDuas({ now, segundaMinutos: 60 });
  await tick(now);

  await Promise.all([tick(now + HORA), tick(now + HORA)]);
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.segunda })), alunos);
});

test("tick que caiu: reservada sem aplicar volta depois de 2 minutos e sai uma vez so; cinco reservas sem terminar viram falha", async () => {
  const now = meioDia(16);
  const { flow, ids } = await fluxoDeDuas({ now, segundaMinutos: 60 });
  await tick(now);

  await store.claimFlowTasks(db, { limit: 150, now: new Date(now + HORA) });
  assert.equal((await tick(now + HORA + MIN)).claimed, 0, "reserva recente: ninguem pega");
  assert.equal((await tick(now + HORA + 3 * MIN)).sent, 2, "reserva velha: o tick seguinte pega e envia");
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.segunda })), alunos);

  // Uma tarefa que caiu cinco vezes seguidas (reserva velha com 5 tentativas) sai como falha.
  unwrap(
    await db
      .from("communication_flow_tasks")
      .update({ attempts: 5, claimed_at: new Date(now).toISOString(), finished_at: null, notification_id: null, result: null, status: "running" })
      .eq("node_id", ids.segunda)
      .eq("user_id", aluna.id),
    "Simulando cinco quedas"
  );
  void flow;
  await store.claimFlowTasks(db, { limit: 150, now: new Date(now + 2 * HORA) });
  const presa = await tarefa(ids.segunda, aluna.id);
  assert.deepEqual([presa.status, presa.result], ["skipped", "failed"]);
});

test("lote devolvido depois de erro passageiro guarda as tentativas; a varredura de presas nunca falha a reserva recente de outro tick", async () => {
  const now = meioDia(17);
  const { ids } = await fluxoDeDuas({ now, segundaMinutos: 60 });
  await tick(now);

  const reservadas = await store.claimFlowTasks(db, { limit: 150, now: new Date(now + HORA) });
  assert.deepEqual(reservadas.map((task) => task.attempts), [1, 1]);
  assert.equal(await store.releaseClaims(db, reservadas), 2);
  assert.deepEqual((await Promise.all(alunos.map((id) => tarefa(ids.segunda, id)))).map((row) => [row.status, row.attempts]), [
    ["pending", 0],
    ["pending", 0]
  ]);

  // Reserva recente com tentativas no limite: a varredura de presas nao toca (so pendente ou reserva velha).
  unwrap(
    await db
      .from("communication_flow_tasks")
      .update({ attempts: 5, claimed_at: new Date(now + HORA).toISOString(), status: "running" })
      .eq("node_id", ids.segunda)
      .eq("user_id", aluna.id),
    "Reserva recente de outro tick"
  );
  await store.claimFlowTasks(db, { limit: 150, now: new Date(now + HORA + MIN) });
  assert.equal((await tarefa(ids.segunda, aluna.id)).status, "running");
});

test("lote com uma tarefa ruim: a bisseccao aplica as outras e so ela termina como 'failed'", async () => {
  const now = meioDia(18);
  const { ids } = await fluxoDeDuas({ now, segundaMinutos: 60 });
  await tick(now);

  const reservadas = await store.claimFlowTasks(db, { limit: 150, now: new Date(now + HORA) });
  const versao = unwrap(await db.from("campaigns").select("id").eq("flow_node_id", ids.segunda).single(), "Versao").id;
  const resultados = await store.applyFlowResults(db, {
    now: new Date(now + HORA),
    results: reservadas.map((task) => ({
      decision:
        task.user_id === aluna.id
          ? // Erro com mais de 2.000 caracteres: o check de last_error recusa (23514) e derruba o lote inteiro.
            { action: "retry", dueAt: now + 2 * HORA, error: "x".repeat(2_500) }
          : { action: "send", campaignId: versao, children: [], deadlineAt: null, expiresAt: now + DIA },
      task
    }))
  });

  assert.deepEqual(resultados.map((row) => [row.userId, row.outcome]).sort(), [
    [aluna.id, "failed"],
    [aluno.id, "send"]
  ].sort());
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.segunda })), [aluno.id]);
  assert.equal((await tarefa(ids.segunda, aluna.id)).result, "failed");
});

test("pessoa promovida a equipe no meio do fluxo nao recebe mais nada", async () => {
  const now = meioDia(19);
  const { ids } = await fluxoDeDuas({ now, segundaMinutos: 60 });
  await tick(now);
  unwrap(await db.from("admin_roles").upsert({ permissions: {}, role: "analyst", user_id: aluno.id }, { onConflict: "user_id" }), "Promovendo o aluno");

  await tick(now + HORA);
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.segunda })), [aluna.id]);
  assert.equal((await tarefa(ids.segunda, aluno.id)).result, "filtered");
});

/* ------------------------------------------------------------------------------------------------
 * Limite do dia e intervalo de 1 hora
 * ---------------------------------------------------------------------------------------------- */

/** Fluxo com `quantas` notificacoes em paralelo, todas "logo depois" da entrada, so para a aluna. */
async function fluxoEmParalelo({ now, quantas, extra = () => ({}) }) {
  const entradaId = randomUUID();
  const passos = Array.from({ length: quantas }, (_, index) => passo({ id: randomUUID(), parentId: entradaId, position: index, ...extra(index) }));
  const saved = await gravar({
    contents: Object.fromEntries(passos.map((node, index) => [node.id, conteudo(`Paralela ${index + 1}`)])),
    entry: regras({ op: "has", productIds: [PRODUTO], type: "product" }, { op: "has", productIds: [ESCOLA_DE_TESTE.curso.id], type: "product" }),
    nodes: [entrada(entradaId), ...passos],
    now
  });
  const flow = await ativar(saved.flow, now);

  return { flow, passos };
}

test("limite do dia: duas no mesmo minuto ficam a 1 h uma da outra; a 4a do dia vai para as 8h do dia seguinte", async () => {
  const dia = meioDia(20);
  const { passos } = await fluxoEmParalelo({ now: dia, quantas: 4 });

  await tick(dia);
  assert.equal((await linhas({ user_id: aluna.id })).filter((row) => row.flow_node_id).length, 1, "so a primeira sai: as outras esperam o intervalo");

  await tick(dia + HORA);
  await tick(dia + 2 * HORA);
  const doDia = (await linhas({ user_id: aluna.id })).filter((row) => row.flow_node_id);
  assert.equal(doDia.length, 3);
  assert.deepEqual(doDia.map((row) => Date.parse(row.created_at)), [dia, dia + HORA, dia + 2 * HORA]);

  const quarta = (await Promise.all(passos.map((node) => tarefa(node.id, aluna.id)))).find((row) => row.status === "pending");
  assert.equal(Date.parse(quarta.not_before), horaSP(dia + DIA, 8), "8h de Sao Paulo do dia seguinte");
  assert.equal(quarta.deferrals, 3, "adiada pelo intervalo duas vezes e pelo limite do dia uma");

  await tick(horaSP(dia + DIA, 7, 59));
  assert.equal((await linhas({ user_id: aluna.id })).filter((row) => row.flow_node_id).length, 3);
  await tick(horaSP(dia + DIA, 8));
  assert.equal((await linhas({ user_id: aluna.id })).filter((row) => row.flow_node_id).length, 4);
});

test("o intervalo de 1 h vale na virada do dia: 23:40 segura a seguinte ate 00:40, que vira 8h", async () => {
  const dia = meioDia(21);
  const { passos } = await fluxoEmParalelo({ now: horaSP(dia, 23, 40), quantas: 2 });

  await tick(horaSP(dia, 23, 40));
  const segurada = (await Promise.all(passos.map((node) => tarefa(node.id, aluna.id)))).find((row) => row.status === "pending");
  assert.equal(Date.parse(segurada.not_before), horaSP(dia + DIA, 8), "00:40 cai na madrugada: vai para as 8h");
});

test("envio adiado pelo limite num fluxo com objetivo sobrevive a 8 varreduras e sai as 8h (um adiamento so)", async () => {
  const dia = meioDia(22);
  const objetivo = { kind: "rules", root: { items: [{ op: "has", productIds: [OUTRO_PRODUTO], type: "product" }], match: "all" } };
  const entradaId = randomUUID();
  const passos = Array.from({ length: 4 }, (_, index) => passo({ id: randomUUID(), offsetMinutes: index * 60, parentId: entradaId, position: index }));
  const saved = await gravar({
    contents: Object.fromEntries(passos.map((node, index) => [node.id, conteudo(`Uma por hora ${index + 1}`)])),
    entry: regras({ op: "has", productIds: [PRODUTO], type: "product" }, { op: "has", productIds: [ESCOLA_DE_TESTE.curso.id], type: "product" }),
    goal: objetivo,
    nodes: [entrada(entradaId), ...passos],
    now: dia
  });
  await ativar(saved.flow, dia);

  for (let hora = 0; hora <= 3; hora += 1) {
    await tick(dia + hora * HORA);
  }

  const adiada = await tarefa(passos[3].id, aluna.id);
  assert.equal(adiada.deferrals, 1);
  const oitoHoras = horaSP(dia + DIA, 8);
  assert.equal(Date.parse(adiada.not_before), oitoHoras);

  // Oito faixas de varredura (12:30 ... 14:15 do mesmo dia e de madrugada): acorda, re-decide e volta para as 8h.
  for (let faixa = 1; faixa <= 8; faixa += 1) {
    const quando = horaSP(dia, 16) + faixa * 15 * MIN;
    await tick(quando);
    await tick(quando + MIN);
  }

  // Espera editada: o passo e acordado (due_at = agora) e volta para o not_before, sem gastar adiamento.
  const { tree } = await store.fetchFlowTree(db, saved.flow.id);
  const editadoEm = horaSP(dia, 18, 7);
  await gravar({
    contents: Object.fromEntries(passos.map((node, index) => [node.id, conteudo(`Uma por hora ${index + 1}`)])),
    entry: regras({ op: "has", productIds: [PRODUTO], type: "product" }, { op: "has", productIds: [ESCOLA_DE_TESTE.curso.id], type: "product" }),
    expectedUpdatedAt: (await fluxo(saved.flow.id)).updated_at,
    flowId: saved.flow.id,
    goal: objetivo,
    nodes: tree.nodes.map((node) => (node.id === passos[3].id ? { ...node, offsetMinutes: 185 } : node)),
    now: editadoEm
  });
  assert.equal(Date.parse((await tarefa(passos[3].id, aluna.id)).due_at), editadoEm);
  await tick(editadoEm + MIN);

  const depois = await tarefa(passos[3].id, aluna.id);
  assert.equal(depois.status, "pending");
  assert.equal(depois.deferrals, 1, "nem a varredura nem a espera editada gastam adiamento");
  assert.equal(Date.parse(depois.not_before), oitoHoras);
  assert.equal(Date.parse(depois.due_at), oitoHoras);

  await tick(oitoHoras);
  assert.equal((await tarefa(passos[3].id, aluna.id)).result, "sent");
});

test("'antes de vencer' adiado pelo limite cujo prazo vem antes termina como 'limite do dia' e guarda o prazo", async () => {
  const dia = meioDia(23);
  const entradaId = randomUUID();
  const ids = { a: randomUUID(), antes: randomUUID(), b: randomUUID(), principal: randomUUID() };
  // A (18h), B (19h) e a principal (20h, fica 3 h no sino) fecham o dia; "Faltam 1 hora" sairia as 22h.
  const saved = await gravar({
    contents: {
      [ids.a]: conteudo("A"),
      [ids.b]: conteudo("B"),
      [ids.principal]: conteudo("Principal curta", { validity: { minutes: 180, mode: "duration" } }),
      [ids.antes]: conteudo("Falta 1 hora", { validity: { mode: "with_anchor" } })
    },
    entry: regras({ op: "has", productIds: [PRODUTO], type: "product" }, { op: "has", productIds: [ESCOLA_DE_TESTE.curso.id], type: "product" }),
    nodes: [
      entrada(entradaId),
      passo({ id: ids.a, parentId: entradaId }),
      passo({ id: ids.b, offsetMinutes: 60, parentId: entradaId, position: 1 }),
      passo({ id: ids.principal, offsetMinutes: 120, parentId: entradaId, position: 2 }),
      passo({ anchor: "expires", anchorNodeId: ids.principal, expireWithAnchor: true, id: ids.antes, offsetMinutes: 60, parentId: ids.principal })
    ],
    now: horaSP(dia, 18)
  });
  await ativar(saved.flow, horaSP(dia, 18));

  for (const hora of [18, 19, 20, 21, 22]) {
    await tick(horaSP(dia, hora));
  }

  const [principal] = await linhas({ flow_node_id: ids.principal });
  assert.equal(Date.parse(principal.expires_at), horaSP(dia, 23));
  const antes = await tarefa(ids.antes, aluna.id);
  assert.deepEqual([antes.status, antes.result], ["skipped", "cap"]);
  assert.equal(Date.parse(antes.deadline_at), horaSP(dia, 23), "o prazo gravado fica");
});

/* ------------------------------------------------------------------------------------------------
 * Mudancas num fluxo no ar
 * ---------------------------------------------------------------------------------------------- */

test("no ar: mudar a espera re-agenda quem espera; conteudo novo vira versao (quem recebeu fica com a antiga); passo novo so para quem chegar", async () => {
  const now = meioDia(24);
  const { flow, ids, saved } = await fluxoDeDuas({ now });
  await tick(now);
  const antes = await fluxo(flow.id);
  const nodes = (await store.fetchFlowTree(db, flow.id)).tree.nodes;
  const versaoAntiga = saved.versions[ids.primeira];

  const editado = await gravar({
    contents: { [ids.primeira]: conteudo("Primeira (nova)"), [ids.segunda]: conteudo("Segunda (nova)") },
    expectedUpdatedAt: antes.updated_at,
    flowId: flow.id,
    nodes: nodes.map((node) => (node.id === ids.segunda ? { ...node, offsetMinutes: 120 } : node)),
    now: now + 30 * MIN
  });
  assert.deepEqual(editado.newVersions.sort(), [ids.primeira, ids.segunda].sort());
  assert.notEqual(editado.versions[ids.primeira], versaoAntiga);
  const novaVersao = unwrap(await db.from("campaigns").select("status,sent_at,title").eq("id", editado.versions[ids.primeira]).single(), "Versao nova");
  assert.equal(novaVersao.status, "sent");
  assert.equal(Date.parse(novaVersao.sent_at), now + 30 * MIN);
  assert.ok((await linhas({ flow_node_id: ids.primeira })).every((row) => row.campaign_id === versaoAntiga), "quem recebeu fica com a versao que recebeu");

  // A espera mudou: quem espera foi acordado e o motor recalcula a partir do anchor (agora + 2 h).
  assert.equal(Date.parse((await tarefa(ids.segunda, aluna.id)).due_at), now + 30 * MIN);
  await tick(now + 31 * MIN);
  assert.equal(Date.parse((await tarefa(ids.segunda, aluna.id)).due_at), now + 2 * HORA);
  // Fora do minuto da faixa: o fluxo "so quem esta agora" sem mais nada pendente terminaria sozinho (Concluido).
  await tick(now + 2 * HORA + MIN);
  const segunda = await linhas({ flow_node_id: ids.segunda });
  assert.deepEqual(quem(segunda), alunos);
  assert.ok(segunda.every((row) => row.campaign_id === editado.versions[ids.segunda]), "quem chega depois da mudanca recebe a versao nova");

  // Remover um passo com gente esperando cancela as tarefas ('removed').
  const terceira = randomUUID();
  await gravar({
    contents: { [ids.primeira]: conteudo("Primeira (nova)"), [ids.segunda]: conteudo("Segunda (nova)"), [terceira]: conteudo("Terceira") },
    expectedUpdatedAt: (await fluxo(flow.id)).updated_at,
    flowId: flow.id,
    nodes: [...(await store.fetchFlowTree(db, flow.id)).tree.nodes, passo({ id: terceira, offsetMinutes: 1_440, parentId: ids.segunda })],
    now: now + 3 * HORA
  });
  assert.equal((await tarefas(flow.id)).filter((row) => row.node_id === terceira).length, 0, "passo novo vale so para quem chegar nele daqui em diante");
});

test("no ar: mudar a referencia de tempo com gente esperando, mover passo ou mudar o jeito de entrar e recusado (422)", async () => {
  const now = meioDia(25);
  const { flow, ids } = await fluxoDeDuas({ now });
  await tick(now);
  const { tree } = await store.fetchFlowTree(db, flow.id);
  const contents = { [ids.primeira]: conteudo("Primeira"), [ids.segunda]: conteudo("Segunda") };
  const tentar = (nodes, extra = {}) =>
    gravar({ contents, expectedUpdatedAt: flow.updated_at, flowId: flow.id, nodes, now: now + MIN, ...extra }).then(
      () => null,
      (error) => [error.status, error.message]
    );
  const latest = async () => (await fluxo(flow.id)).updated_at;

  assert.deepEqual(
    await tentar(tree.nodes.map((node) => (node.id === ids.segunda ? { ...node, anchor: "sent", anchorNodeId: ids.primeira } : node)), { expectedUpdatedAt: await latest() }),
    [422, "Para mudar a referência de tempo, remova este passo e crie outro."]
  );
  assert.deepEqual(
    await tentar(tree.nodes.map((node) => (node.id === ids.segunda ? { ...node, parentId: tree.nodes[0].id } : node)), { expectedUpdatedAt: await latest() }),
    [422, "Para mudar a ordem, remova e crie de novo."]
  );
  assert.deepEqual(await tentar(tree.nodes, { expectedUpdatedAt: await latest(), mode: "new_only" }), [422, "O jeito de entrar não muda depois de ativar. Duplique para mudar."]);
  assert.deepEqual(
    await tentar(tree.nodes, { entry: { kind: "everyone" }, expectedUpdatedAt: await latest() }),
    [422, "Neste fluxo, quem entra foi decidido ao ativar. Duplique para mudar."]
  );
  assert.deepEqual(await tentar(tree.nodes, { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }), [
    409,
    "Este fluxo mudou em outra tela há instantes. Recarregue a página para ver a versão atual."
  ]);
});

test("no ar: remover a condicao mantendo o Sim sobe o caminho; quem esperava a condicao para ali", async () => {
  const now = meioDia(26);
  const ids = { cond: randomUUID(), entrada: randomUUID(), nao: randomUUID(), primeira: randomUUID(), sim: randomUUID() };
  const contents = { [ids.primeira]: conteudo("Primeira"), [ids.sim]: conteudo("Sim"), [ids.nao]: conteudo("Não") };
  const saved = await gravar({
    contents,
    nodes: [
      entrada(ids.entrada),
      passo({ id: ids.primeira, parentId: ids.entrada }),
      passo({ condition: regras(fez("opened", ids.primeira)), id: ids.cond, kind: "condition", offsetMinutes: 1_440, parentId: ids.primeira }),
      passo({ branch: "yes", id: ids.sim, parentId: ids.cond }),
      passo({ branch: "no", id: ids.nao, parentId: ids.cond })
    ],
    now
  });
  const flow = await ativar(saved.flow, now);
  await tick(now);

  const { tree } = await store.fetchFlowTree(db, flow.id);
  await gravar({
    contents: { [ids.primeira]: contents[ids.primeira], [ids.sim]: contents[ids.sim] },
    expectedUpdatedAt: (await fluxo(flow.id)).updated_at,
    flowId: flow.id,
    nodes: tree.nodes.filter((node) => node.id !== ids.cond && node.id !== ids.nao).map((node) => (node.id === ids.sim ? { ...node, branch: null, parentId: ids.primeira } : node)),
    now: now + HORA
  });

  const depois = await store.fetchFlowTree(db, flow.id);
  assert.equal(depois.tree.nodes.find((node) => node.id === ids.sim).parentId, ids.primeira);
  assert.deepEqual((await tarefas(flow.id)).filter((row) => row.node_id === ids.cond).map((row) => row.result), ["removed", "removed"]);
});

test("no ar: mudar 'quem entra' no 'so quem entrar a partir de agora' refaz a linha de base (quem ja combina nunca entra)", async () => {
  const now = meioDia(27);
  const { flow } = await fluxoDeDuas({ mode: "new_only", now });
  await tick(now);
  const { tree } = await store.fetchFlowTree(db, flow.id);
  const contents = Object.fromEntries(tree.nodes.filter((node) => node.kind === "message").map((node, index) => [node.id, conteudo(index === 0 ? "Primeira" : "Segunda")]));
  const expirada = contas.alunaAcessoExpirado;
  // Novo segmento: quem tem o produto ou o curso da aluna expirada (ela ja combina agora: baseline).
  await liberar(expirada.id, OUTRO_PRODUTO);
  const novo = { kind: "rules", root: { items: [{ op: "has", productIds: [PRODUTO, OUTRO_PRODUTO], type: "product" }], match: "all" } };

  const salvo = await gravar({ contents, entry: novo, expectedUpdatedAt: (await fluxo(flow.id)).updated_at, flowId: flow.id, mode: "new_only", nodes: tree.nodes, now: now + MIN });
  assert.equal(salvo.flow.entry_refreshed_at, null);

  await tick(now + 2 * MIN);
  assert.deepEqual((await passagens(flow.id)).map((run) => run.status), ["baseline", "baseline", "baseline"]);
});

test("retirar um passo do sino: versoes canceladas, quem esperava para ali e o numero de linhas a apagar volta", async () => {
  const now = meioDia(28);
  const { flow, ids } = await fluxoDeDuas({ now });
  await tick(now);

  const removidas = await store.withdrawFlowStep(db, { actorId: produtor.id, expectedUpdatedAt: (await fluxo(flow.id)).updated_at, flowId: flow.id, nodeId: ids.primeira, now: new Date(now + HORA) });
  assert.equal(removidas, 2);
  assert.ok(unwrap(await db.from("campaigns").select("status").eq("flow_node_id", ids.primeira), "Versoes").every((row) => row.status === "canceled"));
  assert.deepEqual((await tarefas(flow.id)).filter((row) => row.node_id === ids.segunda).map((row) => row.result), ["withdrawn", "withdrawn"]);
});

test("linha de fluxo e 'abriu o sino': marcada so com 15 s de folga desde o created_at, ou quando o painel diz que mostrou", async () => {
  const now = meioDia(29);
  const { ids } = await fluxoDeDuas({ now });
  await tick(now);
  const [daAluna] = await linhas({ flow_node_id: ids.primeira, user_id: aluna.id });
  const [doAluno] = await linhas({ flow_node_id: ids.primeira, user_id: aluno.id });

  await markAllSeen(aluna.id, { asOf: new Date(now + 5_000).toISOString(), now: new Date(now + 6_000) });
  assert.equal((await linhas({ id: daAluna.id }))[0].seen_at, null, "chegou ha menos de 15 s da lista: o painel pode nao ter mostrado");

  await markAllSeen(aluna.id, { asOf: new Date(now + 5_000).toISOString(), now: new Date(now + 6_000), shown: [daAluna.id] });
  assert.ok((await linhas({ id: daAluna.id }))[0].seen_at, "o painel mostrou: conta");

  await markAllSeen(aluno.id, { asOf: new Date(now + 20_000).toISOString(), now: new Date(now + 21_000) });
  assert.ok((await linhas({ id: doAluno.id }))[0].seen_at);
});

/* ------------------------------------------------------------------------------------------------
 * Notificacoes seguintes (fluxo de aviso): a dica de horario da entrada e a mesma conta do motor
 * ---------------------------------------------------------------------------------------------- */

test("entrada das seguintes: a dica gravada pelo RPC e a mesma de dueFromAnchor para as 3 bases", async () => {
  const now = meioDia(30);
  const enviadoEm = new Date(now - HORA).toISOString();
  const aviso = unwrap(
    await db
      .from("campaigns")
      .insert({ audience: { kind: "everyone" }, body: "", created_by: produtor.id, kind: "inbox", sent_at: enviadoEm, status: "sent", title: "Aviso com seguintes", updated_by: produtor.id, validity_minutes: 4_320 })
      .select("id")
      .single(),
    "Aviso de origem"
  );
  unwrap(
    await db.from("notifications").insert({
      campaign_id: aviso.id,
      created_at: new Date(now - 2 * HORA).toISOString(),
      dedupe_key: `campaign:${aviso.id}`,
      expires_at: new Date(now + 3 * DIA).toISOString(),
      kind: "notice",
      user_id: aluna.id
    }),
    "Linha do aviso"
  );
  const ids = { entrada: randomUUID(), depois: randomUUID(), antes: randomUUID(), anterior: randomUUID() };
  const nodes = [
    entrada(ids.entrada),
    passo({ anchor: "sent", anchorNodeId: ids.entrada, id: ids.depois, offsetMinutes: 1_440, parentId: ids.entrada }),
    passo({ anchor: "expires", anchorNodeId: ids.entrada, id: ids.antes, offsetMinutes: 180, parentId: ids.entrada, position: 1 }),
    passo({ id: ids.anterior, offsetMinutes: 60, parentId: ids.entrada, position: 2 })
  ];
  const saved = await store.saveFlowTree(db, {
    actorId: produtor.id,
    contents: { [ids.depois]: conteudo("Depois"), [ids.antes]: conteudo("Antes"), [ids.anterior]: conteudo("Anterior") },
    flow: { goal: null, name: "Seguintes de “Aviso com seguintes”", origin: "notice", sourceCampaignId: aviso.id },
    now: new Date(now),
    tree: { nodes, origin: "notice" }
  });
  await ativar(saved.flow, now);
  await tick(now);

  const visivel = Date.parse(enviadoEm);
  const fim = now + 3 * DIA;

  for (const node of nodes.slice(1)) {
    const row = await tarefa(node.id, aluna.id);
    const anchorAt = node.anchor === "expires" ? fim : visivel;
    const esperado = dueFromAnchor(node, anchorAt);

    assert.equal(Date.parse(row.anchor_at), anchorAt, node.anchor);
    assert.equal(Date.parse(row.due_at) === esperado.dueAt || row.status !== "pending", true, `${node.anchor}: due_at`);
    assert.equal(row.deadline_at ? Date.parse(row.deadline_at) : null, esperado.deadlineAt, `${node.anchor}: prazo`);
  }

  assert.equal((await fluxo(saved.flow.id)).entry_completed_at !== null, true);
});

/* ------------------------------------------------------------------------------------------------
 * Fim automatico (Concluido)
 * ---------------------------------------------------------------------------------------------- */

test("fim automatico: 'so quem esta agora' sem nada pendente termina na faixa ('finished'); com gente esperando, nao", async () => {
  const now = meioDia(31) + 5 * MIN;
  const { flow } = await fluxoDeDuas({ now, segundaMinutos: 60 });
  await tick(now);

  await tick(meioDia(31) + 15 * MIN);
  assert.equal((await fluxo(flow.id)).status, "active", "a segunda ainda espera");

  await tick(now + HORA);
  await tick(meioDia(31) + 75 * MIN);
  const concluido = await fluxo(flow.id);
  assert.deepEqual([concluido.status, concluido.ended_reason], ["ended", "finished"]);
});

test("fim automatico do fluxo de aviso: so depois que todas as linhas do aviso de origem sairam do sino", async () => {
  const now = meioDia(32) + 5 * MIN;
  const aviso = unwrap(
    await db
      .from("campaigns")
      .insert({ audience: { kind: "everyone" }, body: "", created_by: produtor.id, kind: "inbox", sent_at: new Date(now - HORA).toISOString(), status: "sent", title: "Aviso curto", updated_by: produtor.id })
      .select("id")
      .single(),
    "Aviso de origem"
  );
  unwrap(
    await db.from("notifications").insert({
      campaign_id: aviso.id,
      created_at: new Date(now - HORA).toISOString(),
      dedupe_key: `campaign:${aviso.id}`,
      expires_at: new Date(now + 2 * HORA).toISOString(),
      kind: "notice",
      user_id: aluna.id
    }),
    "Linha do aviso"
  );
  const ids = { entrada: randomUUID(), seguinte: randomUUID() };
  const saved = await store.saveFlowTree(db, {
    actorId: produtor.id,
    contents: { [ids.seguinte]: conteudo("Seguinte") },
    flow: { goal: null, name: "Seguintes de “Aviso curto”", origin: "notice", sourceCampaignId: aviso.id },
    now: new Date(now),
    tree: { nodes: [entrada(ids.entrada), passo({ anchor: "sent", anchorNodeId: ids.entrada, id: ids.seguinte, offsetMinutes: 5, parentId: ids.entrada })], origin: "notice" }
  });
  const flow = await ativar(saved.flow, now);
  await tick(now);
  assert.deepEqual(quem(await linhas({ flow_node_id: ids.seguinte })), [aluna.id], "a seguinte saiu");

  await tick(meioDia(32) + 15 * MIN);
  assert.equal((await fluxo(flow.id)).status, "active", "a principal ainda esta no sino: da para acrescentar uma seguinte");

  await tick(meioDia(32) + 180 * MIN);
  assert.deepEqual([(await fluxo(flow.id)).status, (await fluxo(flow.id)).ended_reason], ["ended", "finished"]);
});
