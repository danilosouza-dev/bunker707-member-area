import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// Os participantes simulados mudados a qualquer momento, a parte pura (docs/30 D79 e D80; docs/18 §2.1; teste do
// produtor de 11/11/2026): o contador com mudancas no tempo (a regra certa em cada offset, a rampa de 90 s em linha
// reta saindo do numero que a turma via, sempre o mesmo numero para a mesma entrada, sem Math.random), a janela da sala
// com as mudancas, o resumo do fim que junta os trechos (o maior numero que as janelas mostraram, por propriedade), a
// mudanca antes do comeco (troca a regra da sessao; a linha sem offset nao entra na conta) e depois; a frase de cada
// mudanca (a da decisao com o numero novo, a de antes sem ele); a vista do controle e as contas do formulario; o resumo
// da decisao que a consulta de 5 s leva a sala; a sala que pede a janela de novo quando ele muda; a Presença do console
// tambem antes do comeco; e as linhas do bloco Simulacao do relatorio com as mudancas.

const model = await import("../src/server/webinars/simulation-model.ts");
const audience = await import("../src/server/webinars/simulation-audience-model.ts");
const changeRows = await import("../src/server/webinars/simulation-change-rows.ts");
const ack = await import("../src/server/webinars/simulation-ack.ts");
const { SIMULATION_LIMITS } = await import("../src/server/webinars/model.ts");
const { simulationKeyOf } = await import("../src/server/webinars/screen-model.ts");
const { createSimulationChecker } = await import("../src/components/member/webinars/room/use-room-simulation.ts");
const v2 = await import("../src/server/webinars/console-v2-model.ts");
const reportPage = await import("../src/server/webinars/report-page-model.ts");

const MIN = 60_000;
const HOUR = 60 * MIN;
const STEP = SIMULATION_LIMITS.counterStepSeconds * 1000;
const WINDOW = SIMULATION_LIMITS.feedWindowSeconds * 1000;
const RAMP = SIMULATION_LIMITS.countRampSeconds * 1000;
const NOW = Date.parse("2026-11-11T23:05:00.000Z"); // 20:05 de 11/11 em Sao Paulo

const off = { base: 0, jitter: 0, mode: "off", peak: 0 };
const fixed = (base) => ({ base, jitter: 0, mode: "fixed", peak: base });
const semEntradas = { enabled: false, everySeconds: 60, max: 30, names: "generic" };
const semAvisos = { enabled: false, items: [] };
const simulacao = (extra = {}) => ({ countRule: off, joins: semEntradas, saleNotices: semAvisos, seed: 777, sessionId: "s", summary: null, ...extra });

function semMathRandom(fn) {
  const original = Math.random;
  Math.random = () => {
    throw new Error("Math.random na Simulacao");
  };
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/* ------------------------------------------------------------------------------------------------
 * O contador com mudancas no tempo
 * ---------------------------------------------------------------------------------------------- */

test("a regra certa em cada offset e a rampa de 90 s em linha reta, saindo do numero que a turma via", () => {
  assert.equal(RAMP, 90_000, "a rampa escolhida: 90 s (entre 60 e 120)");
  // +100 desde o comeco; aos 10 min, +400; aos 20 min, Tirar (+0).
  const sim = simulacao({ countChanges: [{ atMs: 10 * MIN, rule: fixed(400) }, { atMs: 20 * MIN, rule: off }], countRule: fixed(100) });
  const timeline = model.countTimelineOf(sim, HOUR);
  const at = (offset) => model.timelineExtraAt(timeline, offset);
  assert.equal(at(-30_000), 100, "antes do zero, o numero do zero");
  assert.equal(at(0), 100);
  assert.equal(at(10 * MIN - 1), 100, "a regra de antes vale ate a mudanca");
  assert.equal(at(10 * MIN), 100, "no instante da mudanca, ainda o numero de antes");
  assert.equal(at(10 * MIN + 45_000), 250, "na metade da rampa, a metade do caminho");
  assert.equal(at(10 * MIN + 30_000), 200, "um terco");
  assert.equal(at(10 * MIN + RAMP), 400, "chega no numero novo em 90 s");
  assert.equal(at(15 * MIN), 400);
  assert.equal(at(20 * MIN + 45_000), 200, "descendo tambem em linha reta");
  assert.equal(at(20 * MIN + RAMP), 0, "o Tirar volta ao real");
  assert.equal(at(HOUR), 0, "do fim do video em diante, 0 (a gravada)");
  // A rampa e monotona: nunca passa do numero novo nem volta.
  const subida = Array.from({ length: 7 }, (_, index) => at(10 * MIN + index * STEP));
  assert.deepEqual(subida, [...subida].sort((a, b) => a - b));
  assert.ok(subida.every((value) => value >= 100 && value <= 400));
});

test("sempre o mesmo numero para a mesma entrada (sem relogio nem Math.random); a ordem gravada desempata", () => {
  const sim = simulacao({ countChanges: [{ atMs: 5 * MIN, rule: fixed(300) }, { atMs: 5 * MIN + 20_000, rule: fixed(50) }], countRule: { base: 20, jitter: 15, mode: "curve", peak: 200 } });
  const uma = semMathRandom(() => Array.from({ length: 80 }, (_, index) => model.timelineExtraAt(model.countTimelineOf(sim, HOUR), index * STEP)));
  const outra = semMathRandom(() => Array.from({ length: 80 }, (_, index) => model.timelineExtraAt(model.countTimelineOf(sim, HOUR), index * STEP)));
  assert.deepEqual(uma, outra);
  // Fora de ordem na lista, a conta ordena pelo relogio.
  const invertida = simulacao({ ...sim, countChanges: [...sim.countChanges].reverse() });
  assert.deepEqual(Array.from({ length: 80 }, (_, index) => model.timelineExtraAt(model.countTimelineOf(invertida, HOUR), index * STEP)), uma);
  // A segunda mudanca no meio da rampa da primeira sai do numero da turma no ponto de 15 s em que caiu.
  const timeline = model.countTimelineOf(sim, HOUR);
  const ponto = Math.floor((5 * MIN + 20_000) / STEP) * STEP;
  assert.equal(timeline.changes[1].fromExtra, model.timelineExtraAt({ ...timeline, changes: timeline.changes.slice(0, 1) }, ponto));
  assert.equal(model.timelineExtraAt(timeline, 5 * MIN + 20_000 + RAMP), 50);
  // Saindo da faixa que varia: a rampa sai do numero da faixa naquele ponto.
  const daFaixa = model.countTimelineOf(simulacao({ countChanges: [{ atMs: 30 * MIN, rule: fixed(10) }], countRule: { base: 100, jitter: 0, mode: "curve", peak: 500 } }), HOUR);
  assert.equal(daFaixa.changes[0].fromExtra, model.counterExtraAt({ base: 100, jitter: 0, mode: "curve", peak: 500 }, 777, 30 * MIN, HOUR));
  assert.equal(model.timelineExtraAt(daFaixa, 30 * MIN + RAMP), 10);
});

test("sem mudancas, o contador de sempre; offsets invalidos e as mudancas de antes do comeco ficam fora da conta", () => {
  const curve = { base: 30, jitter: 8, mode: "curve", peak: 200 };
  const timeline = model.countTimelineOf(simulacao({ countRule: curve }), HOUR);
  for (let step = 0; step < 240; step += 7) {
    assert.equal(model.timelineExtraAt(timeline, step * STEP), model.counterExtraAt(curve, 777, step * STEP, HOUR));
  }
  assert.deepEqual(model.sortedCountChanges([{ atMs: -5, rule: fixed(1) }, { atMs: Number.NaN, rule: fixed(2) }, { atMs: 1_000, rule: fixed(3) }]), [{ atMs: 1_000, rule: fixed(3) }]);
  // As linhas de antes do comeco (sem offset) ficam so no registro: a regra da sessao ja e a nova.
  const records = [
    { ackText: "a", atMs: null, changedAt: "2026-11-11T22:50:00.000Z", changedBy: "u", id: "1", rule: fixed(200), sessionId: "s", source: "console" },
    { ackText: "b", atMs: 60_000, changedAt: "2026-11-11T23:01:00.000Z", changedBy: "u", id: "2", rule: fixed(300), sessionId: "s", source: "editor" },
    { ackText: "c", atMs: 30_000, changedAt: "2026-11-11T23:00:30.000Z", changedBy: null, id: "3", rule: off, sessionId: "s", source: "console" }
  ];
  assert.deepEqual(changeRows.countChangesOf(records), [
    { atMs: 30_000, rule: off },
    { atMs: 60_000, rule: fixed(300) }
  ]);
});

test("a janela da sala com as mudancas: ligada com a regra da sessao desligada, os pontos de 15 s com a rampa, 0 depois do fim", () => {
  const sim = simulacao({ countChanges: [{ atMs: 2 * MIN, rule: fixed(300) }], countRule: fixed(0) });
  assert.equal(model.simulationRulesOn(sim), true);
  assert.equal(model.simulationRulesOn(simulacao({ countChanges: [{ atMs: 2 * MIN, rule: fixed(300) }] })), true, "uma mudanca que soma liga a janela mesmo com 'Só o real' antes");
  assert.equal(model.simulationRulesOn(simulacao({ countChanges: [{ atMs: 2 * MIN, rule: off }] })), false, "so mudancas para +0 nao ligam nada");
  const feed = model.simulationFeed({ durationMs: HOUR, endMs: Number.POSITIVE_INFINITY, fromMs: 2 * MIN, kind: "live", simulation: sim, status: "live", toMs: 2 * MIN + WINDOW });
  assert.equal(feed.enabled, true);
  assert.deepEqual(
    feed.counter.slice(0, 8).map((point) => point.extra),
    [0, 50, 100, 150, 200, 250, 300, 300],
    "de 0 a +300 em 6 passos de 15 s"
  );
  assert.equal(model.simulationCounterNow({ durationMs: HOUR, endMs: Number.POSITIVE_INFINITY, kind: "live", offsetMs: 2 * MIN + 45_000, simulation: sim, status: "live" }), 150);
  const encerrada = model.simulationFeed({ durationMs: HOUR, endMs: 2 * MIN + 30_000, fromMs: 2 * MIN, kind: "live", simulation: sim, status: "ended", toMs: 2 * MIN + WINDOW });
  assert.ok(encerrada.counter.filter((point) => point.atMs >= 2 * MIN + 30_000).every((point) => point.extra === 0), "0 do Encerrar em diante");
});

test("o resumo do fim junta os trechos de cada regra: o maior numero que as janelas da sala mostraram (propriedade)", () => {
  const casos = [
    { changes: [{ atMs: 10 * MIN, rule: fixed(900) }, { atMs: 11 * MIN, rule: fixed(100) }], endMs: 40 * MIN, live: true, rule: fixed(50) },
    { changes: [{ atMs: 3 * MIN, rule: off }], endMs: 30 * MIN, live: false, rule: { base: 20, jitter: 10, mode: "curve", peak: 400 } },
    { changes: [{ atMs: 0, rule: fixed(250) }, { atMs: 25 * MIN, rule: fixed(600) }], endMs: 26 * MIN, live: true, rule: off }
  ];
  for (const caso of casos) {
    const sim = simulacao({ countChanges: caso.changes, countRule: caso.rule });
    const totals = model.simulationTotals(sim, { endMs: caso.endMs, videoMs: HOUR }, caso.live);
    // A sala pede janelas seguidas de 0 ao fim, como useRoomSimulation.
    let maior = 0;
    for (let from = 0; from < caso.endMs; from += WINDOW + 1) {
      const feed = model.simulationFeed({ durationMs: HOUR, endMs: caso.endMs, fromMs: from, kind: caso.live ? "live" : "simulated", simulation: sim, status: "live", toMs: from + WINDOW });
      for (const point of feed.counter) {
        if (point.atMs < caso.endMs) {
          maior = Math.max(maior, point.extra);
        }
      }
    }
    assert.equal(totals.counterMax, maior, JSON.stringify(caso));
  }
  // O trecho curto de +900 (60 s de rampa antes de descer) entra pelo numero que a turma de fato viu, nao pelo +900.
  const curto = model.simulationTotals(simulacao({ countChanges: casos[0].changes, countRule: fixed(50) }), { endMs: 40 * MIN, videoMs: HOUR }, true);
  assert.ok(curto.counterMax < 900 && curto.counterMax > 50, `subiu so ate ${curto.counterMax}`);
  assert.equal(model.simulationTotals(simulacao({ countChanges: [{ atMs: 0, rule: fixed(250) }] }), { endMs: 10 * MIN, videoMs: HOUR }, true).counterMax, 250);
});

/* ------------------------------------------------------------------------------------------------
 * A frase de cada mudanca
 * ---------------------------------------------------------------------------------------------- */

test("a frase da mudanca e a da decisao com o numero novo; sem `audience`, a frase de antes; o servidor confere hoje e ontem", () => {
  const flags = { badgeOn: false, joinsSimulated: false, saleNoticesSimulated: false };
  const live = model.simulationAudienceAckFor({ extra: 1300, flags, live: true, nowMs: NOW, responsible: "Produtora de Teste" });
  assert.equal(
    live,
    "Decisão do produtor em 11/11/2026: nesta live ao vivo, dentro da área de membros, os números de plateia são simulados e os avisos de venda não aparecem. A partir de agora, os participantes simulados somam +1.300 ao número de quem assiste. Responsável: Produtora de Teste."
  );
  const tirar = model.simulationAudienceAckFor({ extra: 0, flags: { ...flags, joinsSimulated: true }, live: true, nowMs: NOW, responsible: "Produtora de Teste" });
  assert.match(tirar, /os números de plateia são simulados .* A partir de agora, sem participantes simulados: o aluno vê só o número real de quem assiste\. Responsável/, "as entradas continuam simuladas");
  const gravada = model.simulationAudienceAckFor({ extra: 300, flags: { ...flags, badgeOn: true }, nowMs: NOW, responsible: "Produtora de Teste" });
  assert.match(gravada, /nesta sessão gravada, .*o selo "Ao vivo" fica ligado, .* A partir de agora, os participantes simulados somam \+300 ao número de quem assiste\. Fora da área de membros, esta sessão nunca é anunciada como ao vivo\. Responsável: Produtora de Teste\.$/);
  // A frase do card (sem `audience`) nao muda.
  assert.equal(
    ack.simulationAckSentenceLive({ countSimulated: true, date: "11/11/2026", joinsSimulated: false, responsible: "X", saleNoticesSimulated: false }),
    "Decisão do produtor em 11/11/2026: nesta live ao vivo, dentro da área de membros, os números de plateia são simulados e os avisos de venda não aparecem. Responsável: X."
  );
  assert.equal(ack.simulationAudienceClause(undefined), "");

  // Desde 12/11/2026 (D86) a tela nao mostra a frase nem pede a caixa: o servidor a monta e grava no registro.
  assert.equal("simulationAudienceNeedsAck" in model, false, "a caixa saiu (D86)");
  assert.equal("simulationAudienceAckMatches" in model, false, "a conferencia da frase digitada saiu (D86)");
  assert.ok(live.length <= 600, "cabe em simulation_ack_text");
});

/* ------------------------------------------------------------------------------------------------
 * A vista do controle e o formulario
 * ---------------------------------------------------------------------------------------------- */

test("a vista do controle: a regra de agora, a rampa em curso, as mudancas mais novas primeiro com o nome", () => {
  const records = [
    { ackText: "a", atMs: null, changedAt: "2026-11-11T22:50:00.000Z", changedBy: "u1", id: "1", rule: fixed(200), sessionId: "s", source: "console" },
    { ackText: "b", atMs: 60_000, changedAt: "2026-11-11T23:01:00.000Z", changedBy: "u2", id: "2", rule: fixed(300), sessionId: "s", source: "editor" }
  ];
  const sim = { countChanges: changeRows.countChangesOf(records), countRule: fixed(200) };
  const flags = { badgeOn: false, joinsSimulated: false, saleNoticesSimulated: false };
  const view = audience.simulationAudienceViewOf({ flags, names: { u1: "Ana Souza" }, offsetMs: 90_000, pendingMigration: false, records, simulation: sim });
  assert.deepEqual(view.current, fixed(300));
  assert.equal(view.rampEndsAtMs, 60_000 + RAMP, "a sala ainda esta chegando");
  assert.deepEqual(view.changes.map((change) => [change.id, change.changedByName, change.extra, change.source]), [
    ["2", "Equipe", 300, "editor"],
    ["1", "Ana Souza", 200, "console"]
  ]);
  const depois = audience.simulationAudienceViewOf({ flags, names: {}, offsetMs: 10 * MIN, pendingMigration: false, records, simulation: sim });
  assert.equal(depois.rampEndsAtMs, null);
  const antes = audience.simulationAudienceViewOf({ flags, names: {}, offsetMs: -1000, pendingMigration: false, records: [], simulation: { countRule: fixed(200) } });
  assert.deepEqual(antes.current, fixed(200), "antes do comeco, a regra da sessao");
  assert.equal(audience.audienceCurrentLabel(fixed(1500)), "+1.500");
  assert.equal(audience.audienceCurrentLabel(off), "+0");
  assert.equal(audience.audienceCurrentLabel({ base: 50, jitter: 0, mode: "curve", peak: 300 }), "de +50 a +300");
  assert.equal(audience.audienceChangeWhen(null), "antes do começo");
  assert.equal(audience.audienceChangeWhen(12 * MIN + 30_000), "12:30");
  assert.equal(audience.audienceChangeWhen(HOUR + 2 * MIN + 3_000), "1:02:03");
  assert.deepEqual([...audience.AUDIENCE_SHORTCUTS], [50, 100, 300, 500]);
});

test("o formulario (D86, sem frase nem caixa): Aplicar direto com o numero valido e diferente do de agora; Tirar; sem permissao, encerrada ou sem a migracao, nada", () => {
  const base = {
    busy: false,
    canPublish: true,
    current: fixed(100),
    pendingMigration: false,
    phase: "on_air",
    text: "300"
  };
  const direto = audience.audienceFormState(base);
  assert.equal(direto.canApply, true, "Aplicar ligado direto, sem confirmacao (decisao do produtor em 12/11/2026)");
  assert.equal("needsAck" in direto, false, "sem caixa");
  assert.equal("sentence" in direto, false, "sem frase na tela");
  assert.equal(audience.audienceFormState({ ...base, text: "100" }).canApply, false, "o mesmo numero");
  assert.equal(audience.audienceFormState({ ...base, text: "100" }).same, true);
  assert.equal(audience.audienceFormState({ ...base, text: "abc" }).error, "Use um número inteiro de 0 a 100.000.");
  assert.equal(audience.audienceFormState({ ...base, text: "100001" }).canApply, false);
  assert.equal(audience.audienceFormState({ ...base, text: "" }).error, null, "vazio nao e erro, so nao aplica");
  assert.equal(audience.audienceFormState({ ...base, text: "0" }).canApply, true, "+0 pelo campo e o Tirar");
  assert.equal(direto.canRemove, true, "o Tirar com algo somado");
  assert.equal(audience.audienceFormState({ ...base, current: off }).canRemove, false, "nada para tirar");
  for (const travado of [{ canPublish: false }, { phase: "ended" }, { pendingMigration: true }, { busy: true }]) {
    const state = audience.audienceFormState({ ...base, ...travado });
    assert.deepEqual([state.canApply, state.canRemove], [false, false], JSON.stringify(travado));
  }
});

/* ------------------------------------------------------------------------------------------------
 * A sala em segundos, o console e o relatorio
 * ---------------------------------------------------------------------------------------------- */

test("o resumo da decisao que vai na consulta de 5 s: curto, opaco, muda com a hora da decisao; vazio sem decisao", () => {
  assert.equal(simulationKeyOf(null), "");
  const uma = simulationKeyOf("2026-11-11T23:01:00.000Z");
  assert.match(uma, /^[0-9a-f]{8}$/);
  assert.equal(simulationKeyOf("2026-11-11T23:01:00.000Z"), uma);
  assert.notEqual(simulationKeyOf("2026-11-11T23:01:00.001Z"), uma);
});

test("a sala: o refresh esquece a janela e a espera de 5 min, pede do offset de agora, substitui as janelas e descarta o pedido velho", async () => {
  let clock = 0;
  let offset = 60_000;
  const pedidos = [];
  const entregues = [];
  const pendentes = [];
  const checker = createSimulationChecker({
    fetchFeed: (range) => {
      pedidos.push(range);
      return new Promise((resolve) => pendentes.push(resolve));
    },
    getOffsetMs: () => offset,
    now: () => clock,
    onFeed: (feed, offsetMs, replace) => entregues.push({ enabled: feed.enabled, offsetMs, replace })
  });
  const vazia = { counter: [], enabled: false, from: 0, joins: [], saleNotices: [], to: 0 };
  const ligada = { counter: [{ atMs: 60_000, extra: 300 }], enabled: true, from: 0, joins: [], saleNotices: [], to: 0 };

  let check = checker.check();
  pendentes.shift()(vazia);
  await check;
  assert.deepEqual(entregues.at(-1), { enabled: false, offsetMs: 60_000, replace: false });
  clock = 10_000;
  offset = 70_000;
  await checker.check();
  assert.equal(pedidos.length, 1, "sem nada ligado, a sala espera 5 min");

  // A equipe aplicou +300 no console: a chave mudou e a sala pede de novo na hora.
  checker.refresh();
  check = checker.check();
  assert.equal(pedidos.length, 2);
  assert.equal(pedidos[1].fromMs, 70_000 - 15_000, "do offset de agora");
  pendentes.shift()(ligada);
  await check;
  assert.deepEqual(entregues.at(-1), { enabled: true, offsetMs: 70_000, replace: true }, "a janela nova substitui as de antes");

  // Um pedido a caminho quando a chave muda de novo e descartado (veio da regra velha).
  offset = 200_000;
  check = checker.check();
  const antes = entregues.length;
  checker.refresh();
  pendentes.shift()(ligada);
  await check;
  assert.equal(entregues.length, antes, "o pedido velho nao entrega nada");
  check = checker.check();
  pendentes.shift()(ligada);
  await check;
  assert.equal(entregues.at(-1).replace, true);
  checker.stop();
});

test("o console: a Presença existe com o controle dos participantes simulados tambem antes do comeco; nunca no Replay; sem eles, ela fica pela chave do numero de pessoas (D107)", () => {
  assert.deepEqual(v2.consoleMoreEntriesFor({ audience: true, hasPresence: false, kind: "live", webinarKind: "live" }), ["tela", "enquetes", "roteiro", "atendimento", "presenca", "gravacao"]);
  assert.deepEqual(v2.consoleMoreEntriesFor({ audience: true, hasPresence: false, kind: "simulated", webinarKind: "simulated" }), ["tela", "enquetes", "roteiro", "oferta", "atendimento", "presenca"]);
  assert.deepEqual(v2.consoleMoreEntriesFor({ audience: true, hasPresence: false, kind: "replay", webinarKind: "simulated" }), ["enquetes", "roteiro", "oferta", "atendimento"]);
  assert.deepEqual(v2.consoleMoreEntriesFor({ audience: false, hasPresence: false, kind: "live", webinarKind: "live" }), ["tela", "enquetes", "roteiro", "atendimento", "presenca", "gravacao"]);
  assert.equal(v2.consolePresenceBadge({ peak: 1, presentNow: 1, simulated: 300 }), "1 presente · pico 1 · +300 simulados");
});

test("o relatorio: o bloco lista as mudancas (quando, +N, quem e de onde) debaixo do contador; a live com mudanca mostra o bloco", () => {
  const summary = {
    ackText: null,
    changes: [
      { atMs: null, changedAt: "2026-11-11T22:50:00.000Z", changedByName: "Ana Souza", extra: 200, source: "editor" },
      { atMs: 12 * MIN + 30_000, changedAt: "2026-11-11T23:12:30.000Z", changedByName: "Carla Produtora", extra: 300, source: "console" },
      { atMs: 40 * MIN, changedAt: "2026-11-11T23:40:00.000Z", changedByName: "Carla Produtora", extra: 0, source: "console" }
    ],
    decidedAt: "2026-11-11T23:40:00.000Z",
    decidedByName: "Carla Produtora",
    live: true,
    pending: false,
    realParticipants: 12,
    rules: { countMode: "fixed", joins: { enabled: false, everySeconds: 60, max: 30 }, saleNotices: { enabled: false, items: 0 } },
    script: { byTrigger: reportPage.emptyScriptByTrigger(), fired: 0, missed: 0, ready: 0 },
    showLiveBadge: false,
    totals: { counterMax: 300, joinsShown: 0, saleNoticesShown: 0 }
  };
  const lines = reportPage.simulationLines(summary);
  assert.deepEqual(lines.slice(1, 6), [
    "Contador simulado: real + número fixo · maior número mostrado: 300 · participantes de verdade: 12",
    "Participantes simulados: 3 mudanças",
    "antes do começo · +200 · Ana Souza, pelo editor",
    "12:30 · +300 · Carla Produtora, pelo console",
    "40:00 · +0 · Carla Produtora, pelo console"
  ]);
  assert.doesNotMatch(lines.join("\n"), / - /, "sem hifen como separador");
  const vazia = { ...summary, changes: [], decidedAt: null, rules: { ...summary.rules, countMode: "off" }, totals: { counterMax: null, joinsShown: null, saleNoticesShown: null } };
  assert.equal(reportPage.simulationBlockVisible("live", vazia), false);
  assert.equal(reportPage.simulationBlockVisible("live", { ...vazia, changes: summary.changes.slice(1, 2) }), true, "uma mudanca no ar ja mostra o bloco");
  assert.equal(reportPage.simulationLines({ ...summary, changes: undefined }).some((line) => line.startsWith("Participantes simulados")), false, "sem mudanca, as linhas de antes");
});
