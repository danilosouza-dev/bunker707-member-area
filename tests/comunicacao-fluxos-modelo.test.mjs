import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Motor dos fluxos e das notificacoes seguintes (Comunicacao v2, docs/23 §4.2): o modulo puro
// flow-model.ts carregado direto pelo Node. A decisao de cada tarefa e recalculavel (o horario de verdade
// sai do anchor_at e do passo atual), a arvore e conferida pela mesma regra no construtor e no servidor,
// e o cartao "Depois desta notificacao" e o construtor desenham as mesmas linhas. O que o banco faz com a
// decisao (limite do dia, uma vez por aluno, trava do fluxo) esta em tests/integration/fluxos.test.mjs.

const model = await import("../src/server/communications/flow-model.ts");
const { flowDraftSchema } = await import("../src/server/communications/flow-schemas.ts");
const { FLOW_LIMITS, childTasksOf, decideFlowTask, dueFromAnchor, followUpsFromTree, nextPollAt, saoPauloDayBounds, treeFromFollowUps } = model;
const { validateFlowGoal, validateFlowTree, watchedPageKeysOf } = model;

const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;
const NOW = Date.parse("2026-10-21T15:00:00.000Z"); // 12:00 em Sao Paulo
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ENTRADA = id(1);
const ALUNA = id(900);
const PRODUTO = "teste-curso-agentes";

function entrada(extra = {}) {
  return passo({ anchor: "previous", id: ENTRADA, kind: "entry", parentId: null, ...extra });
}

function passo(extra = {}) {
  return {
    anchor: "previous",
    anchorNodeId: null,
    branch: null,
    campaignId: null,
    condition: null,
    expireWithAnchor: false,
    filter: null,
    id: id(2),
    kind: "message",
    maxWaitMinutes: null,
    offsetMinutes: 0,
    parentId: ENTRADA,
    position: 0,
    waitUntilTrue: false,
    ...extra
  };
}

function condicao(extra = {}) {
  return passo({ condition: regras(abriu(id(2))), kind: "condition", ...extra });
}

const regras = (...items) => ({ kind: "rules", root: { items, match: "all" } });
const abriu = (nodeId, negate = false) => ({ action: "opened", negate, ref: { kind: "node", nodeId }, type: "message" });
const temProduto = (productId = PRODUTO) => ({ op: "has", productIds: [productId], type: "product" });

function conteudo(extra = {}) {
  return { campaignId: id(500), ctaHref: null, hasAudio: false, hasCta: false, hasResponse: false, title: "Oferta especial!", validUntil: null, validityMinutes: null, ...extra };
}

function aluna(extra = {}) {
  return {
    accesses: [],
    cohortIds: [],
    comments: { d7: 0, d30: 0, d90: 0, total: 0 },
    completedByContent: {},
    completedLessons: 0,
    lastSignInAt: null,
    lastStudiedAt: null,
    pace: "never_started",
    totalLessons: 0,
    userId: ALUNA,
    ...extra
  };
}

/** O que a aluna fez com a notificacao de um passo (linha do sino). */
function linha(extra = {}) {
  return { audioCompletedAt: null, audioStartedAt: null, clickedAt: null, expiresAt: NOW + 3 * DIA, openedAt: null, response: null, seenAt: null, visibleAt: NOW - DIA, ...extra };
}

function contexto(extra = {}) {
  return { commentRanks: { 7: new Map(), 30: new Map(), 90: new Map(), all: new Map() }, lessonTotals: {}, messageKeys: new Set([`node:${id(2)}`, `node:${ENTRADA}`]), now: NOW, ...extra };
}

function tarefa(extra = {}) {
  return { anchorAt: NOW - DIA, attempts: 1, claimedAt: "2026-10-21T15:00:00.123456+00:00", deadlineAt: null, nodeId: id(3), notBefore: null, userId: ALUNA, ...extra };
}

/** Entrada da decisao: por padrao, a notificacao id(3) "1 dia depois" de id(2), num fluxo do construtor. */
function decidir(extra = {}) {
  const node = extra.node ?? passo({ id: id(3), offsetMinutes: 1_440, parentId: id(2) });
  const tree = extra.tree ?? { nodes: [entrada(), passo(), node], origin: "builder" };

  return decideFlowTask({
    context: contexto(),
    facts: aluna({ messages: { [`node:${id(2)}`]: linha() } }),
    goal: null,
    message: node.kind === "message" ? conteudo({ campaignId: id(503) }) : null,
    node,
    now: NOW,
    staff: false,
    task: tarefa({ nodeId: node.id }),
    tree,
    ...extra
  });
}

const problemas = (tree, messages = {}) => validateFlowTree(tree, messages).map((issue) => [issue.level, issue.nodeId, issue.field, issue.message]);
const soGravar = (tree, messages) => problemas(tree, messages).filter(([level]) => level === "save");

/* ------------------------------------------------------------------------------------------------
 * Tempo
 * ---------------------------------------------------------------------------------------------- */

test("dueFromAnchor: depois do anterior ou do envio soma a espera; antes de vencer subtrai e o prazo e o fim", () => {
  const anchor = NOW;

  assert.deepEqual(dueFromAnchor(passo({ offsetMinutes: 1_440 }), anchor), { deadlineAt: null, dueAt: anchor + DIA });
  assert.deepEqual(dueFromAnchor(passo({ anchor: "sent", anchorNodeId: id(2), offsetMinutes: 120 }), anchor), { deadlineAt: null, dueAt: anchor + 2 * HORA });
  assert.deepEqual(dueFromAnchor(passo({ anchor: "expires", anchorNodeId: id(2), offsetMinutes: 180 }), anchor), { deadlineAt: anchor, dueAt: anchor - 3 * HORA });
  assert.deepEqual(dueFromAnchor(passo({ offsetMinutes: 0 }), anchor), { deadlineAt: null, dueAt: anchor }, "Logo depois");
});

test("dueFromAnchor: 'esperar ate ser Sim' tem prazo = hora da conferencia + espera maxima (e nunca depois do fim de referencia)", () => {
  const espera = condicao({ maxWaitMinutes: 2_880, offsetMinutes: 1_440, waitUntilTrue: true });

  assert.deepEqual(dueFromAnchor(espera, NOW), { deadlineAt: NOW + 3 * DIA, dueAt: NOW + DIA });
  assert.deepEqual(dueFromAnchor(condicao({ offsetMinutes: 60 }), NOW), { deadlineAt: null, dueAt: NOW + HORA }, "sem esperar, sem prazo");
  assert.deepEqual(
    dueFromAnchor(condicao({ anchor: "expires", anchorNodeId: id(2), maxWaitMinutes: 2_880, offsetMinutes: 180, waitUntilTrue: true }), NOW),
    { deadlineAt: NOW, dueAt: NOW - 3 * HORA },
    "antes de vencer: o prazo e o fim da notificacao"
  );
});

test("nextPollAt: proxima faixa de 15 minutos, sempre depois de agora", () => {
  assert.equal(nextPollAt(Date.parse("2026-10-21T15:07:42.000Z")), Date.parse("2026-10-21T15:15:00.000Z"));
  assert.equal(nextPollAt(Date.parse("2026-10-21T15:15:00.000Z")), Date.parse("2026-10-21T15:30:00.000Z"));
  assert.equal(nextPollAt(Date.parse("2026-10-21T23:59:59.000Z")), Date.parse("2026-10-22T00:00:00.000Z"));
});

test("saoPauloDayBounds: o dia de Sao Paulo comeca as 03:00 UTC (UTC-3 fixo), tambem logo depois da meia-noite local", () => {
  assert.deepEqual(saoPauloDayBounds(Date.parse("2026-10-21T15:00:00.000Z")), {
    nextStart: Date.parse("2026-10-22T03:00:00.000Z"),
    start: Date.parse("2026-10-21T03:00:00.000Z")
  });
  // 23:40 em Sao Paulo de 21/10 = 02:40 UTC de 22/10: ainda e o dia 21.
  assert.deepEqual(saoPauloDayBounds(Date.parse("2026-10-22T02:40:00.000Z")), {
    nextStart: Date.parse("2026-10-22T03:00:00.000Z"),
    start: Date.parse("2026-10-21T03:00:00.000Z")
  });
  assert.equal(saoPauloDayBounds(Date.parse("2026-10-22T03:00:00.000Z")).start, Date.parse("2026-10-22T03:00:00.000Z"));
});

/* ------------------------------------------------------------------------------------------------
 * Tarefas dos filhos
 * ---------------------------------------------------------------------------------------------- */

test("childTasksOf: varias seguintes em paralelo, cada uma com a propria base; uma base neste passo usa agora e o fim recem-calculado", () => {
  const principal = passo({ id: id(2) });
  const depois = passo({ anchor: "sent", anchorNodeId: id(2), id: id(3), offsetMinutes: 60, parentId: id(2), position: 1 });
  const antes = passo({ anchor: "expires", anchorNodeId: id(2), id: id(4), offsetMinutes: 180, parentId: id(2), position: 0 });
  const logo = passo({ id: id(5), parentId: id(2), position: 2 });
  const tree = { nodes: [entrada(), principal, depois, antes, logo], origin: "builder" };
  const fim = NOW + 3 * DIA;
  const tasks = childTasksOf(principal, null, tree, {
    completedAt: NOW,
    expiresAt: (nodeId) => (nodeId === id(2) ? fim : null),
    sentAt: (nodeId) => (nodeId === id(2) ? NOW : null)
  });

  assert.deepEqual(tasks, [
    { anchorAt: fim, deadlineAt: fim, dueAt: fim - 3 * HORA, nodeId: id(4) },
    { anchorAt: NOW, deadlineAt: null, dueAt: NOW + HORA, nodeId: id(3) },
    { anchorAt: NOW, deadlineAt: null, dueAt: NOW, nodeId: id(5) }
  ]);
});

test("childTasksOf: so o lado escolhido da condicao; filho cuja notificacao de referencia a aluna nao tem nao ganha tarefa", () => {
  const cond = condicao({ id: id(3), parentId: id(2) });
  const sim = passo({ branch: "yes", id: id(4), parentId: id(3) });
  const nao = passo({ branch: "no", id: id(5), parentId: id(3) });
  const naoAntes = passo({ anchor: "expires", anchorNodeId: id(2), branch: "no", id: id(6), offsetMinutes: 60, parentId: id(3) });
  const tree = { nodes: [entrada(), passo(), cond, sim, nao, naoAntes], origin: "builder" };
  const semBase = { completedAt: NOW, expiresAt: () => null, sentAt: () => null };

  assert.deepEqual(childTasksOf(cond, "yes", tree, semBase).map((task) => task.nodeId), [id(4)]);
  assert.deepEqual(childTasksOf(cond, "no", tree, semBase).map((task) => task.nodeId), [id(5)], "sem o fim da notificacao, o 'antes de vencer' para ali");
  assert.deepEqual(childTasksOf(cond, null, tree, semBase), [], "condicao sem lado nao cria nada");
});

/* ------------------------------------------------------------------------------------------------
 * Decisao
 * ---------------------------------------------------------------------------------------------- */

test("decisao: quem e da equipe agora sai como 'filtered' antes de qualquer regra (nem o objetivo e avaliado)", () => {
  const regraQueQuebra = { kind: "rules", root: { items: [{ type: "regra-que-nao-existe" }], match: "all" } };

  assert.deepEqual(decidir({ goal: regraQueQuebra, staff: true }), { action: "finish", children: [], result: "filtered" });
});

test("decisao: o objetivo vem primeiro, mesmo para quem ainda esta esperando (varredura do objetivo)", () => {
  const facts = aluna({ accesses: [{ endsAt: null, productId: PRODUTO, startsAt: NOW - DIA }], messages: { [`node:${id(2)}`]: linha() } });

  assert.deepEqual(decidir({ facts, goal: regras(temProduto()), task: tarefa({ anchorAt: NOW }) }), { action: "exit_goal" });
  assert.equal(decidir({ goal: regras(temProduto()) }).action, "send", "sem acesso ao produto, segue o caminho");
});

test("decisao: acordada antes da hora de verdade (espera editada, varredura) so e reagendada para a hora certa, nada mais", () => {
  const cedo = decidir({ task: tarefa({ anchorAt: NOW - HORA }) });

  assert.deepEqual(cedo, { action: "defer", deadlineAt: null, dueAt: NOW - HORA + DIA });
});

test("decisao: tarefa empurrada pelo limite do dia (notBefore depois da hora do passo) volta a esperar o notBefore, nunca envia antes", () => {
  const notBefore = NOW + 17 * HORA;
  const adiada = decidir({ task: tarefa({ anchorAt: NOW - 2 * DIA, notBefore }) });

  assert.deepEqual(adiada, { action: "defer", deadlineAt: null, dueAt: notBefore });
  assert.equal(decidir({ now: notBefore, task: tarefa({ anchorAt: NOW - 2 * DIA, notBefore }) }).action, "send", "na hora do notBefore, sai");
});

test("decisao: 'antes de vencer' depois do prazo termina como 'expired'; antes do prazo envia com o deadlineAt do passo", () => {
  const node = passo({ anchor: "expires", anchorNodeId: id(2), id: id(3), offsetMinutes: 180, parentId: id(2) });
  const fim = NOW + HORA;

  assert.deepEqual(decidir({ node, task: tarefa({ anchorAt: NOW - HORA, nodeId: id(3) }) }), { action: "finish", children: [], result: "expired" });

  const envio = decidir({ node, task: tarefa({ anchorAt: fim, nodeId: id(3) }) });
  assert.equal(envio.action, "send");
  assert.equal(envio.deadlineAt, fim, "o RPC pula o envio adiado pelo limite se o prazo vier antes");
  assert.equal(envio.campaignId, id(503));
});

test("decisao: 'So para quem...' que nao combina termina como 'filtered', sem filhos (o caminho para ali)", () => {
  const node = passo({ filter: regras(abriu(id(2), true)), id: id(3), offsetMinutes: 1_440, parentId: id(2) });
  const abriuAPrimeira = aluna({ messages: { [`node:${id(2)}`]: linha({ openedAt: NOW - HORA, readAt: NOW - HORA, seenAt: NOW - HORA }) } });

  assert.deepEqual(decidir({ facts: abriuAPrimeira, node }), { action: "finish", children: [], result: "filtered" });
  assert.equal(decidir({ node }).action, "send", "nao abriu: recebe");
});

test("decisao: conteudo que venceria em menos de 15 minutos nem sai ('expired')", () => {
  const node = passo({ id: id(3), offsetMinutes: 1_440, parentId: id(2) });
  const quaseVencida = conteudo({ validUntil: new Date(NOW + 10 * MIN).toISOString() });

  assert.deepEqual(decidir({ message: quaseVencida, node }), { action: "finish", children: [], result: "expired" });
  assert.equal(decidir({ message: conteudo({ validUntil: new Date(NOW + 20 * MIN).toISOString() }), node }).action, "send");
});

test("decisao: envio com o fim da notificacao e as tarefas dos filhos (base 'neste passo' = agora e o fim calculado)", () => {
  const principal = passo({ id: id(3), offsetMinutes: 1_440, parentId: id(2) });
  const umaHora = passo({ anchor: "sent", anchorNodeId: id(3), id: id(4), offsetMinutes: 60, parentId: id(3) });
  const antesDeVencer = passo({ anchor: "expires", anchorNodeId: id(3), id: id(5), offsetMinutes: 180, parentId: id(3), position: 1 });
  const tree = { nodes: [entrada(), passo(), principal, umaHora, antesDeVencer], origin: "builder" };
  const envio = decidir({ message: conteudo({ campaignId: id(503), validityMinutes: 1_440 }), node: principal, tree });

  assert.deepEqual(envio, {
    action: "send",
    campaignId: id(503),
    children: [
      { anchorAt: NOW, deadlineAt: null, dueAt: NOW + HORA, nodeId: id(4) },
      { anchorAt: NOW + DIA, deadlineAt: NOW + DIA, dueAt: NOW + DIA - 3 * HORA, nodeId: id(5) }
    ],
    deadlineAt: null,
    expiresAt: NOW + DIA
  });
});

test("decisao: 'Ate a notificacao principal sumir' usa o fim da notificacao de referencia desta aluna (nunca mais que a validade)", () => {
  const node = passo({ anchor: "expires", anchorNodeId: id(2), expireWithAnchor: true, id: id(3), offsetMinutes: 180, parentId: id(2) });
  const fimDaPrincipal = NOW + 2 * HORA;
  const facts = aluna({ messages: { [`node:${id(2)}`]: linha({ expiresAt: fimDaPrincipal }) } });
  const envio = decidir({ facts, node, task: tarefa({ anchorAt: fimDaPrincipal, nodeId: id(3) }) });

  assert.equal(envio.action, "send");
  assert.equal(envio.expiresAt, fimDaPrincipal);

  const curta = decidir({ facts, message: conteudo({ validityMinutes: 60 }), node, task: tarefa({ anchorAt: fimDaPrincipal, nodeId: id(3) }) });
  assert.equal(curta.expiresAt, NOW + HORA, "a validade do proprio conteudo continua sendo teto");
});

test("decisao: condicao Sim leva so os filhos do Sim; Nao, so os do Nao", () => {
  const cond = condicao({ condition: regras(abriu(id(2))), id: id(3), offsetMinutes: 1_440, parentId: id(2) });
  const sim = passo({ branch: "yes", id: id(4), parentId: id(3) });
  const nao = passo({ branch: "no", id: id(5), parentId: id(3) });
  const tree = { nodes: [entrada(), passo(), cond, sim, nao], origin: "builder" };
  const abriuAPrimeira = aluna({ messages: { [`node:${id(2)}`]: linha({ openedAt: NOW - HORA, seenAt: NOW - HORA }) } });

  assert.deepEqual(decidir({ facts: abriuAPrimeira, node: cond, tree }), {
    action: "finish",
    children: [{ anchorAt: NOW, deadlineAt: null, dueAt: NOW, nodeId: id(4) }],
    result: "yes"
  });
  assert.deepEqual(decidir({ node: cond, tree }), { action: "finish", children: [{ anchorAt: NOW, deadlineAt: null, dueAt: NOW, nodeId: id(5) }], result: "no" });
});

test("decisao: 'esperar ate ser Sim' confere a cada 15 minutos ate o prazo; depois do prazo segue pelo Nao", () => {
  const cond = condicao({ id: id(3), maxWaitMinutes: 120, offsetMinutes: 0, parentId: id(2), waitUntilTrue: true });
  const tree = { nodes: [entrada(), passo(), cond], origin: "builder" };
  const agora = Date.parse("2026-10-21T15:07:00.000Z");

  assert.deepEqual(decidir({ node: cond, now: agora, task: tarefa({ anchorAt: agora - HORA, nodeId: id(3) }), tree }), {
    action: "defer",
    deadlineAt: agora + HORA,
    dueAt: Date.parse("2026-10-21T15:15:00.000Z")
  });
  assert.deepEqual(
    decidir({ node: cond, now: agora, task: tarefa({ anchorAt: agora - 2 * HORA + 5 * MIN, nodeId: id(3) }), tree }),
    { action: "defer", deadlineAt: agora + 5 * MIN, dueAt: agora + 5 * MIN },
    "a ultima conferencia e no prazo"
  );
  assert.deepEqual(decidir({ node: cond, now: agora, task: tarefa({ anchorAt: agora - 2 * HORA, nodeId: id(3) }), tree }), {
    action: "finish",
    children: [],
    result: "no"
  });
});

test("decisao: regra ilegivel tenta de novo em 1 e em 5 minutos; na terceira tentativa termina como 'failed' com o erro", () => {
  const quebrada = { kind: "rules", root: { items: [{ action: "opened", negate: false, ref: null, type: "message" }], match: "all" } };
  const node = passo({ filter: quebrada, id: id(3), offsetMinutes: 1_440, parentId: id(2) });
  const primeira = decidir({ node, task: tarefa({ attempts: 1 }) });
  const segunda = decidir({ node, task: tarefa({ attempts: 2 }) });
  const terceira = decidir({ node, task: tarefa({ attempts: 3 }) });

  assert.equal(primeira.action, "retry");
  assert.equal(primeira.dueAt, NOW + MIN);
  assert.ok(primeira.error.length > 0);
  assert.equal(segunda.dueAt, NOW + 5 * MIN);
  assert.equal(terceira.action, "finish");
  assert.equal(terceira.result, "failed");
  assert.equal(terceira.error, primeira.error);
  assert.deepEqual(FLOW_LIMITS.retryMinutes, [1, 5]);
});

test("decisao: notificacao sem conteudo carregado tambem e erro (tenta de novo), nunca envio sem versao", () => {
  assert.equal(decidir({ message: null }).action, "retry");
});

/* ------------------------------------------------------------------------------------------------
 * Conferencia da arvore
 * ---------------------------------------------------------------------------------------------- */

test("arvore valida do construtor: nenhum problema de gravar ou ativar", () => {
  const tree = {
    nodes: [
      entrada(),
      passo(),
      condicao({ id: id(3), offsetMinutes: 1_440, parentId: id(2) }),
      passo({ branch: "yes", id: id(4), parentId: id(3) }),
      passo({ branch: "no", id: id(5), parentId: id(3) })
    ],
    origin: "builder"
  };

  assert.deepEqual(problemas(tree), []);
});

test("arvore: uma entrada so, todo passo com pai na arvore e sem ciclo", () => {
  assert.deepEqual(soGravar({ nodes: [entrada(), entrada({ id: id(9) }), passo()], origin: "builder" }), [["save", ENTRADA, null, "Passo inválido."]]);
  assert.deepEqual(soGravar({ nodes: [entrada(), passo({ parentId: id(77) })], origin: "builder" }), [["save", id(2), "parentId", "Passo inválido."]]);
  assert.deepEqual(
    soGravar({ nodes: [entrada(), passo({ id: id(2), parentId: id(3) }), passo({ id: id(3), parentId: id(2) })], origin: "builder" }),
    [
      ["save", id(2), "parentId", "Passo inválido."],
      ["save", id(3), "parentId", "Passo inválido."]
    ]
  );
  assert.deepEqual(soGravar({ nodes: [entrada(), passo(), passo()], origin: "builder" }), [["save", id(2), null, "Passo inválido."]], "id repetido");
});

test("arvore: Sim/Nao so debaixo de condicao, e todo filho de condicao tem um lado", () => {
  assert.deepEqual(soGravar({ nodes: [entrada(), passo({ branch: "yes" })], origin: "builder" }), [["save", id(2), "branch", "Passo inválido."]]);
  assert.deepEqual(soGravar({ nodes: [entrada(), passo(), condicao({ id: id(3), parentId: id(2) }), passo({ id: id(4), parentId: id(3) })], origin: "builder" }), [
    ["save", id(4), "branch", "Escolha o caminho Sim ou Não."]
  ]);
});

test("arvore: 'quando' so conta de uma notificacao acima no caminho (no fluxo de aviso, a entrada e a principal)", () => {
  const irma = passo({ id: id(3), position: 1 });
  const contaDaIrma = passo({ anchor: "sent", anchorNodeId: id(3), id: id(4), offsetMinutes: 60, parentId: id(2) });

  assert.deepEqual(soGravar({ nodes: [entrada(), passo(), irma, contaDaIrma], origin: "builder" }), [
    ["save", id(4), "anchorNodeId", "Escolha uma notificação que vem antes deste passo no caminho."]
  ]);

  const daEntrada = passo({ anchor: "sent", anchorNodeId: ENTRADA, offsetMinutes: 60 });
  assert.deepEqual(soGravar({ nodes: [entrada(), daEntrada], origin: "notice" }), [], "seguinte do aviso conta do envio da principal");
  assert.deepEqual(soGravar({ nodes: [entrada(), daEntrada], origin: "builder" }), [
    ["save", id(2), "anchorNodeId", "Escolha uma notificação que vem antes deste passo no caminho."]
  ]);
  assert.deepEqual(soGravar({ nodes: [entrada(), passo({ anchor: "sent", offsetMinutes: 60 })], origin: "notice" }), [["save", id(2), "anchorNodeId", "Escolha a notificação."]]);
});

test("arvore: regras do filtro e da condicao so conferem notificacoes acima no caminho", () => {
  const filtroDaPropria = passo({ filter: regras(abriu(id(2))) });
  const condicaoDeOutroCaminho = condicao({ condition: regras(abriu(id(4))), id: id(3), parentId: id(2) });
  const tree = { nodes: [entrada(), filtroDaPropria, condicaoDeOutroCaminho, passo({ branch: "yes", id: id(4), parentId: id(3) })], origin: "builder" };

  assert.deepEqual(soGravar(tree), [
    ["save", id(2), "filter", "Esta regra confere uma notificação que não vem antes dela no caminho."],
    ["save", id(3), "condition", "Esta regra confere uma notificação que não vem antes dela no caminho."]
  ]);

  const desdeQueRecebeu = { negate: false, productIds: [PRODUTO], since: { kind: "message", nodeId: id(2) }, type: "access_gained" };
  assert.deepEqual(soGravar({ nodes: [entrada(), passo(), condicao({ condition: regras(desdeQueRecebeu), id: id(3), parentId: id(2) })], origin: "builder" }), []);
});

test("arvore: no maximo 20 passos e 8 em sequencia", () => {
  const vinteUm = [entrada(), ...Array.from({ length: 21 }, (_, index) => passo({ id: id(10 + index), position: index }))];
  assert.deepEqual(soGravar({ nodes: vinteUm, origin: "builder" }), [["save", null, "nodes", "Use no máximo 20 passos (notificações e condições)."]]);

  const fila = [entrada(), ...Array.from({ length: 9 }, (_, index) => passo({ id: id(10 + index), parentId: index === 0 ? ENTRADA : id(9 + index) }))];
  assert.deepEqual(soGravar({ nodes: fila.slice(0, 9), origin: "builder" }), [], "8 em sequencia");
  assert.deepEqual(soGravar({ nodes: fila, origin: "builder" }), [["save", id(18), null, "O fluxo vai até 8 passos em sequência."]]);
});

test("arvore: esperas de 5 em 5 minutos ate 60 dias; antes de vencer a partir de 15; 'esperar ate' de 15 minutos a 30 dias", () => {
  const com = (extra) => soGravar({ nodes: [entrada(), passo(), passo({ id: id(3), parentId: id(2), ...extra })], origin: "builder" });

  assert.deepEqual(com({ offsetMinutes: 7 }), [["save", id(3), "offsetMinutes", "Escolha de 5 minutos a 60 dias."]]);
  assert.deepEqual(com({ offsetMinutes: 86_405 }), [["save", id(3), "offsetMinutes", "Escolha de 5 minutos a 60 dias."]]);
  assert.deepEqual(com({ offsetMinutes: 86_400 }), []);
  assert.deepEqual(com({ anchor: "expires", anchorNodeId: id(2), offsetMinutes: 10 }), [["save", id(3), "offsetMinutes", "Escolha de 15 minutos a 60 dias."]]);
  assert.deepEqual(com({ condition: regras(abriu(id(2))), kind: "condition", maxWaitMinutes: 10, waitUntilTrue: true }), [
    ["save", id(3), "maxWaitMinutes", "Escolha de 15 minutos a 30 dias."]
  ]);
  assert.deepEqual(com({ condition: { kind: "everyone" }, kind: "condition" }), [["save", id(3), "condition", "A condição precisa de pelo menos uma regra."]]);
});

test("arvore: 'antes de vencer' precisa ser menos que o tempo no sino da notificacao de referencia", () => {
  const tree = { nodes: [entrada(), passo(), passo({ anchor: "expires", anchorNodeId: id(2), id: id(3), offsetMinutes: 1_440, parentId: id(2) })], origin: "builder" };

  assert.deepEqual(soGravar(tree, { [id(2)]: conteudo({ validityMinutes: 1_440 }) }), [
    ["save", id(3), "offsetMinutes", "A notificação “Oferta especial!” fica só 1 dia no sino. Escolha menos de 1 dia antes de vencer."]
  ]);
  assert.deepEqual(soGravar(tree, { [id(2)]: conteudo({ validityMinutes: 4_320 }) }), []);
  assert.deepEqual(soGravar(tree, { [id(2)]: conteudo({ validUntil: "2026-10-25T12:00:00.000Z" }) }), [], "ate uma data: depende de quando chega");
});

test("arvore: 'pagina do botao' recusada em botao externo ou em pagina nao acompanhada", () => {
  const visitou = { negate: false, page: { kind: "message_cta", nodeId: id(2) }, since: { kind: "message", nodeId: id(2) }, type: "page_visit" };
  const tree = { nodes: [entrada(), passo(), condicao({ condition: regras(visitou), id: id(3), parentId: id(2) })], origin: "builder" };

  assert.deepEqual(soGravar(tree, { [id(2)]: conteudo({ ctaHref: "https://exemplo.test/oferta", hasCta: true }) }), [
    ["save", id(3), "condition", "O botão desta notificação leva para fora da área: use “clicou no botão”."]
  ]);
  assert.deepEqual(soGravar(tree, { [id(2)]: conteudo({ ctaHref: "/algo-novo", hasCta: true }) }), [
    ["save", id(3), "condition", "Esta página não é acompanhada: use “clicou no botão”."]
  ]);
  assert.deepEqual(soGravar(tree, { [id(2)]: conteudo({ ctaHref: `/conteudo/${PRODUTO}?de=aviso`, hasCta: true }) }), []);
});

test("arvore: regra de mensagem que a notificacao citada nunca satisfaz (sem audio, botao ou resposta) nao grava", () => {
  const regra = (action, negate = true) => ({ action, negate, ref: { kind: "node", nodeId: id(2) }, type: "message" });
  const filtroDa = (rule) => ({ nodes: [entrada(), passo(), passo({ filter: regras(rule), id: id(3), parentId: id(2) })], origin: "builder" });
  const semNada = { [id(2)]: conteudo() };

  assert.deepEqual(soGravar(filtroDa(regra("audio_started")), semNada), [["save", id(3), "filter", "A notificação escolhida não tem áudio. Escolha outra regra."]]);
  assert.deepEqual(soGravar(filtroDa(regra("audio_completed", false)), semNada), [["save", id(3), "filter", "A notificação escolhida não tem áudio. Escolha outra regra."]]);
  assert.deepEqual(soGravar(filtroDa(regra("clicked")), semNada), [["save", id(3), "filter", "A notificação escolhida não tem botão. Escolha outra regra."]]);
  assert.deepEqual(soGravar(filtroDa(regra("declined")), semNada), [["save", id(3), "filter", "A notificação escolhida não pede resposta. Escolha outra regra."]]);
  assert.deepEqual(soGravar(filtroDa(regra("audio_started")), { [id(2)]: conteudo({ hasAudio: true }) }), [], "com audio: vale");
  assert.deepEqual(soGravar(filtroDa(regra("clicked")), { [id(2)]: conteudo({ ctaHref: "/", hasCta: true }) }), []);
  assert.deepEqual(soGravar(filtroDa(regra("seen")), semNada), [], "recebeu e viu valem sempre");
  assert.deepEqual(soGravar(filtroDa(regra("audio_started")), {}), [], "sem o conteudo da notificacao, nao confere");

  // Fluxo de aviso: a entrada e a notificacao principal; o objetivo passa pela mesma conferencia.
  const doAviso = { nodes: [entrada(), passo({ filter: regras({ action: "clicked", negate: true, ref: { kind: "node", nodeId: ENTRADA }, type: "message" }) })], origin: "notice" };
  assert.deepEqual(soGravar(doAviso, { [ENTRADA]: conteudo() }), [["save", id(2), "filter", "A notificação escolhida não tem botão. Escolha outra regra."]]);
  assert.deepEqual(
    validateFlowGoal({ nodes: [entrada(), passo()], origin: "builder" }, regras(regra("responded", false)), semNada).map((issue) => [issue.level, issue.message]),
    [["save", "A notificação escolhida não pede resposta. Escolha outra regra."]]
  );
});

test("arvore: sem notificacao nao ativa; caminho que termina sem notificacao so avisa", () => {
  assert.deepEqual(problemas({ nodes: [entrada()], origin: "builder" }), [["activation", null, "nodes", "Adicione pelo menos uma notificação."]]);

  const condicaoPrimeiro = { nodes: [entrada(), condicao({ condition: regras(temProduto()), id: id(3) }), passo({ branch: "yes", id: id(4), parentId: id(3) })], origin: "builder" };
  assert.deepEqual(problemas(condicaoPrimeiro), [["warning", id(3), null, "Este caminho termina sem nenhuma notificação."]]);
});

test("objetivo: pode conferir qualquer notificacao do fluxo, nunca um passo de fora", () => {
  const tree = { nodes: [entrada(), passo()], origin: "builder" };
  const issues = (goal) => validateFlowGoal(tree, goal, {}).map((issue) => [issue.level, issue.field, issue.message]);

  assert.deepEqual(issues(regras(abriu(id(2)))), []);
  assert.deepEqual(issues(regras(abriu(id(99)))), [["save", "goal", "Esta regra confere uma notificação que não vem antes dela no caminho."]]);
  assert.deepEqual(issues(regras({ op: "has", productIds: [], type: "product" })), [["activation", "goal", "Escolha o produto."]]);
});

/* ------------------------------------------------------------------------------------------------
 * Modelos do construtor (§2.5): arvores validas
 * ---------------------------------------------------------------------------------------------- */

test("os quatro modelos do construtor dao arvores validas (so o produto a escolher fica para a ativacao)", () => {
  const viuENaoAbriu = regras({ action: "seen", negate: false, ref: { kind: "node", nodeId: id(2) }, type: "message" }, abriu(id(2), true));
  const paraQuemNaoAbriu = {
    nodes: [
      entrada(),
      passo(),
      condicao({ condition: viuENaoAbriu, id: id(3), offsetMinutes: 1_440, parentId: id(2) }),
      passo({ branch: "yes", id: id(4), parentId: id(3) })
    ],
    origin: "builder"
  };
  const boasVindas = {
    nodes: [
      entrada(),
      passo(),
      condicao({ condition: regras({ days: 2, op: "within", type: "last_study" }), id: id(3), offsetMinutes: 2_880, parentId: id(2) }),
      passo({ branch: "no", id: id(4), parentId: id(3) })
    ],
    origin: "builder"
  };
  const clicou = { action: "clicked", negate: false, ref: { kind: "node", nodeId: id(2) }, type: "message" };
  const promocao = {
    nodes: [
      entrada(),
      passo(),
      condicao({ condition: regras(clicou), id: id(3), offsetMinutes: 1_440, parentId: id(2) }),
      passo({ anchor: "expires", anchorNodeId: id(2), branch: "yes", expireWithAnchor: true, id: id(4), offsetMinutes: 180, parentId: id(3) }),
      passo({ branch: "no", id: id(5), parentId: id(3) })
    ],
    origin: "builder"
  };
  const doZero = { nodes: [entrada()], origin: "builder" };
  const mensagens = {
    [id(2)]: conteudo({ ctaHref: `/conteudo/${PRODUTO}`, hasCta: true, validityMinutes: 4_320 })
  };

  assert.deepEqual(problemas(paraQuemNaoAbriu, mensagens), []);
  assert.deepEqual(problemas(boasVindas, mensagens), []);
  assert.deepEqual(problemas(promocao, mensagens), []);
  assert.deepEqual(problemas(doZero), [["activation", null, "nodes", "Adicione pelo menos uma notificação."]]);
  assert.deepEqual(validateFlowGoal(promocao, regras(temProduto()), mensagens), []);
  assert.deepEqual(
    validateFlowGoal(promocao, regras({ op: "has", productIds: [], type: "product" }), mensagens).map((issue) => issue.message),
    ["Escolha o produto."],
    "produto a escolher bloqueia so a ativacao"
  );
});

test("flowDraftSchema confere a arvore pela mesma regra (problema de gravar no caminho do passo)", () => {
  const conteudoDoRascunho = { audio: null, body: "", cta: null, icon: null, image: null, response: null, sender: null, title: "Oferta especial!", validity: { mode: "default" } };
  const rascunho = (nodes) => ({
    entry: { audience: { kind: "everyone" }, mode: "current" },
    goal: null,
    messages: Object.fromEntries(nodes.filter((node) => node.kind === "message").map((node) => [node.id, conteudoDoRascunho])),
    name: "Para quem não abriu",
    nodes,
    origin: "builder"
  });
  const valido = rascunho([
    { id: ENTRADA, kind: "entry", parentId: null, position: 0 },
    { anchor: "previous", anchorNodeId: null, filter: null, id: id(2), kind: "message", offsetMinutes: 0, parentId: ENTRADA }
  ]);

  assert.equal(flowDraftSchema.safeParse(valido).success, true);

  const contaDeFora = rascunho([
    { id: ENTRADA, kind: "entry", parentId: null, position: 0 },
    { anchor: "previous", anchorNodeId: null, filter: null, id: id(2), kind: "message", offsetMinutes: 0, parentId: ENTRADA },
    { anchor: "sent", anchorNodeId: id(3), filter: null, id: id(4), kind: "message", offsetMinutes: 60, parentId: id(2) },
    { anchor: "previous", anchorNodeId: null, filter: null, id: id(3), kind: "message", offsetMinutes: 0, parentId: ENTRADA, position: 1 }
  ]);
  const result = flowDraftSchema.safeParse(contaDeFora);

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
    [[`nodes.${id(4)}.anchorNodeId`, "Escolha uma notificação que vem antes deste passo no caminho."]]
  );
});

/* ------------------------------------------------------------------------------------------------
 * Notificacoes seguintes <-> arvore
 * ---------------------------------------------------------------------------------------------- */

const seguinte = (extra = {}) => ({
  campaignId: id(600),
  children: [],
  expireWithAnchor: false,
  id: id(20),
  when: { anchor: "sent", minutes: 1_440 },
  who: regras(abriu(ENTRADA, true)),
  ...extra
});

test("treeFromFollowUps <-> followUpsFromTree: ida e volta sem perda (entrada primeiro, pai antes do filho)", () => {
  const followUps = [
    seguinte({
      children: [seguinte({ campaignId: "", id: id(22), when: { anchor: "expires", minutes: 180 }, expireWithAnchor: true, who: { kind: "everyone" } })]
    }),
    seguinte({ campaignId: id(601), id: id(21), when: { anchor: "sent", minutes: 120 } })
  ];
  const nodes = treeFromFollowUps(ENTRADA, followUps);

  assert.deepEqual(
    nodes.map((node) => [node.id, node.kind, node.parentId, node.anchor, node.anchorNodeId, node.offsetMinutes, node.position, node.campaignId]),
    [
      [ENTRADA, "entry", null, "previous", null, 0, 0, null],
      [id(20), "message", ENTRADA, "sent", ENTRADA, 1_440, 0, id(600)],
      [id(22), "message", id(20), "expires", id(20), 180, 0, null],
      [id(21), "message", ENTRADA, "sent", ENTRADA, 120, 1, id(601)]
    ]
  );
  assert.equal(nodes[2].filter, null, "todos que receberam = sem filtro");
  assert.equal(nodes[2].expireWithAnchor, true);

  const tree = { nodes, origin: "notice" };
  assert.deepEqual(problemas(tree), []);
  assert.deepEqual(followUpsFromTree(tree), followUps);
});

test("followUpsFromTree: null quando so o construtor consegue desenhar (condicao, outra base, Logo depois, 4 niveis, 6 por nivel)", () => {
  const base = treeFromFollowUps(ENTRADA, [seguinte()]);
  const com = (nodes) => followUpsFromTree({ nodes, origin: "notice" });

  assert.notEqual(com(base), null);
  assert.equal(com([...base, condicao({ condition: regras(abriu(id(20))), id: id(30), parentId: id(20) })]), null, "condicao");
  assert.equal(com([...base, passo({ id: id(30), offsetMinutes: 60, parentId: id(20) })]), null, "conta do passo anterior");
  assert.equal(com([...base, passo({ anchor: "sent", anchorNodeId: ENTRADA, id: id(30), offsetMinutes: 60, parentId: id(20) })]), null, "conta de outra notificacao");
  assert.equal(com([...base, passo({ anchor: "sent", anchorNodeId: id(20), id: id(30), offsetMinutes: 0, parentId: id(20) })]), null, "Logo depois");

  const tresNiveis = treeFromFollowUps(ENTRADA, [seguinte({ children: [seguinte({ id: id(21) })] })]);
  assert.notEqual(com(tresNiveis), null, "principal + seguinte + seguinte da seguinte");
  assert.equal(com([...tresNiveis, passo({ anchor: "sent", anchorNodeId: id(21), id: id(30), offsetMinutes: 60, parentId: id(21) })]), null, "4 niveis");

  const seis = treeFromFollowUps(ENTRADA, Array.from({ length: 6 }, (_, index) => seguinte({ id: id(40 + index) })));
  assert.equal(com(seis), null, "mais de 5 por notificacao");
});

/* ------------------------------------------------------------------------------------------------
 * Paginas acompanhadas
 * ---------------------------------------------------------------------------------------------- */

test("watchedPageKeysOf: chaves das regras de visita e dos botoes acompanhados; nada de botao externo", () => {
  const visitouOBotao = { negate: true, page: { kind: "message_cta", nodeId: id(2) }, since: { kind: "message", nodeId: id(2) }, type: "page_visit" };
  const clicouComprar = { negate: false, page: { kind: "checkout", productId: PRODUTO }, since: { kind: "entered" }, type: "page_visit" };
  const visitouOPerfil = { negate: false, page: { key: "profile", kind: "fixed" }, since: { kind: "entered" }, type: "page_visit" };
  const tree = {
    nodes: [
      entrada(),
      passo(),
      condicao({ condition: regras(visitouOBotao), id: id(3), parentId: id(2) }),
      passo({ branch: "yes", filter: regras(clicouComprar), id: id(4), parentId: id(3) }),
      passo({ branch: "no", id: id(5), parentId: id(3) })
    ],
    origin: "builder"
  };
  const messages = {
    [id(2)]: conteudo({ ctaHref: `/conteudo/${PRODUTO}/aulas/teste-modulo-1?lessonId=teste-aula-1`, hasCta: true }),
    [id(4)]: conteudo({ ctaHref: "https://exemplo.test/fora", hasCta: true }),
    [id(5)]: conteudo({ ctaHref: "/minhas-compras", hasCta: true })
  };

  assert.deepEqual(watchedPageKeysOf(tree, regras(visitouOPerfil), messages, null), [`checkout:${PRODUTO}`, `content:${PRODUTO}`, "profile", "purchases"]);
  assert.deepEqual(watchedPageKeysOf({ nodes: [entrada()], origin: "notice" }, null, {}, "/favoritos"), ["saved"], "botao do aviso de origem");
  assert.deepEqual(watchedPageKeysOf({ nodes: [entrada()], origin: "notice" }, null, {}, "https://exemplo.test"), []);
});
