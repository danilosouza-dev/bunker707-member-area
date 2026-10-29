import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import "./support/admin-action-stubs.mjs";
import {
  AVISOS,
  CONTADOR,
  DECISAO,
  ENDED_SESSION,
  ENTRADAS,
  HOUR,
  MIN,
  SESSION,
  bancoDaSimulacao,
  escolaDaSimulacao,
  iso,
  semAsColunasDaSimulacao,
  sessionRow
} from "./support/webinarios-v4-simulacao-banco.mjs";

// O job do tick que congela a Simulacao (docs/30 §3.5, §4.3 e §6.6; D6, M6; docs/18 §2.4), sem banco: o banco da
// Simulacao em memoria e o contexto do tick pelo teste. A sessao gravada encerrada com regra ganha simulation_summary
// igual a simulationTotals (o maior numero somado, as entradas e os avisos de 0 ao fim, cortado pelo Encerrar da
// equipe), uma vez so; a sem regra, a que ainda esta no ar e a encerrada ha mais de 6 h ficam como estao; lote de 50;
// o tick sem tempo nao faz nada; banco sem a 202610290005 registra e sai sem erro; as contagens vao para job_runs.

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/db/supabase/client")) {
      const source = `
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }
    return nextResolve(specifier, context);
  }
});

const job = await import("../src/server/jobs/webinar-simulation-summaries-job.ts");
const tick = await import("../src/server/webinars/simulation-tick.ts");
const model = await import("../src/server/webinars/simulation-model.ts");
const { sessionSimulationFromRow } = await import("../src/server/webinars/rows.ts");

const regras = { ...DECISAO, simulated_count_rule: CONTADOR, simulated_joins: ENTRADAS, simulated_sale_notices: AVISOS };
const semDecisao = { simulated_count_rule: CONTADOR, simulated_joins: ENTRADAS, simulated_sale_notices: AVISOS };

function montar(tables = escolaDaSimulacao(), { semColunas = false } = {}) {
  tables.job_runs = [{ id: "run-1", metadata: {} }];
  return semColunas ? semAsColunasDaSimulacao({ tables }) : bancoDaSimulacao({ tables });
}

const contexto = (db, extra = {}) => ({ runId: "run-1", signal: new AbortController().signal, supabase: db, tickRunId: "tick-1", tickStartedAt: new Date(), ...extra });
const linha = (db, id) => db.tables.webinar_sessions.find((row) => row.id === id);

async function silenciando(fn) {
  const originais = { error: console.error, info: console.info };
  const linhas = [];
  console.info = (...args) => linhas.push(args.join(" "));
  console.error = (...args) => linhas.push(args.join(" "));
  try {
    return [await fn(), linhas];
  } finally {
    Object.assign(console, originais);
  }
}

test("congela uma vez: a sessao gravada encerrada com regra ganha os totais do modelo; a segunda volta nao mexe; as contagens vao para job_runs", async () => {
  const tables = escolaDaSimulacao();
  Object.assign(tables.webinar_sessions.find((row) => row.id === ENDED_SESSION), regras);
  const db = montar(tables);
  const esperado = model.simulationTotals(sessionSimulationFromRow(linha(db, ENDED_SESSION)), HOUR);

  const [primeira] = await silenciando(() => job.runSimulationSummariesJob(contexto(db)));
  assert.deepEqual(primeira, { failed: 0, frozen: 1, pendingMigration: false, scanned: 1, skipped: 0 });
  assert.deepEqual(linha(db, ENDED_SESSION).simulation_summary, { counter_max: esperado.counterMax, joins_shown: esperado.joinsShown, sale_notices_shown: esperado.saleNoticesShown });
  assert.deepEqual(linha(db, ENDED_SESSION).simulation_summary, { counter_max: 40, joins_shown: 50, sale_notices_shown: 1 }, "60 min de video: +40, as 50 entradas e o aviso dos 11 min");
  const metadata = db.tables.job_runs[0].metadata;
  assert.equal(metadata.tick_run_id, "tick-1");
  assert.deepEqual({ ...metadata.webinar_simulation_summaries, job_ms: 0 }, { failed: 0, frozen: 1, job_ms: 0, scanned: 1, skipped: 0 });

  const escritas = db.calls.writes.length;
  const [segunda] = await silenciando(() => job.runSimulationSummariesJob(contexto(db)));
  assert.deepEqual(segunda, { failed: 0, frozen: 0, pendingMigration: false, scanned: 0, skipped: 0 });
  assert.equal(db.calls.writes.length, escritas, "nada gravado de novo");

  const freeze = db.calls.queries.find((query) => query.op === "update" && query.table === "webinar_sessions");
  assert.ok(freeze.filters.some(([op, column, value]) => op === "is" && column === "simulation_summary" && value === null), "so onde ainda e nulo");
  assert.ok(freeze.filters.some(([op, column, value]) => op === "eq" && column === "kind" && value === "simulated"));
});

test("o Encerrar da equipe corta o resumo: encerrada aos 20 min, so o que apareceu ate la", async () => {
  const tables = escolaDaSimulacao();
  const ended = tables.webinar_sessions.find((row) => row.id === ENDED_SESSION);
  Object.assign(ended, regras, { ended_at: iso(Date.parse(ended.scheduled_at) + 20 * MIN) });
  const db = montar(tables);
  await silenciando(() => tick.runSimulationSummariesTick({ db }));
  assert.deepEqual(linha(db, ENDED_SESSION).simulation_summary, { counter_max: 40, joins_shown: 40, sale_notices_shown: 1 }, "40 entradas de 30 s em 20 min");
});

test("o Encerrar antecipado com o contador em faixa: o congelado e o numero que a sala mostrou, nunca a faixa espremida no trecho", async () => {
  const tables = escolaDaSimulacao();
  const ended = tables.webinar_sessions.find((row) => row.id === ENDED_SESSION);
  Object.assign(ended, regras, { ended_at: iso(Date.parse(ended.scheduled_at) + 3 * MIN), simulated_count_rule: { base: 10, jitter: 0, mode: "curve", peak: 300 } });
  const db = montar(tables);
  await silenciando(() => tick.runSimulationSummariesTick({ db }));
  const sim = sessionSimulationFromRow(linha(db, ENDED_SESSION));
  const esperado = model.simulationTotals(sim, { endMs: 3 * MIN, videoMs: HOUR }).counterMax;
  assert.equal(linha(db, ENDED_SESSION).simulation_summary.counter_max, esperado);
  assert.ok(esperado < 150, `a faixa sobre 60 min ainda subia aos 3 min (${esperado}), e nunca o pico 300`);
});

test("pula: sem regra, ainda no ar, encerrada ha mais de 6 h, ja congelada; lote de 50 (as mais antigas primeiro)", async () => {
  const now = Date.now();
  const tables = escolaDaSimulacao({ sessao: regras });
  const antiga = sessionRow("eeeeeeee-0000-4000-8000-0000000000b1", { ...regras, ended_at: iso(now - 7 * HOUR), scheduled_at: iso(now - 8 * HOUR), status: "ended" });
  const congelada = sessionRow("eeeeeeee-0000-4000-8000-0000000000b2", { ...regras, ended_at: iso(now - 2 * HOUR), scheduled_at: iso(now - 3 * HOUR), simulation_summary: { counter_max: 1, joins_shown: 1, sale_notices_shown: 0 }, status: "ended" });
  tables.webinar_sessions.push(antiga, congelada);
  const db = montar(tables);
  const [resultado] = await silenciando(() => tick.runSimulationSummariesTick({ db }));
  assert.deepEqual(resultado, { failed: 0, frozen: 0, pendingMigration: false, scanned: 0, skipped: 0 });
  assert.equal(linha(db, ENDED_SESSION).simulation_summary, null, "encerrada sem regra: nada a congelar");
  assert.equal(linha(db, SESSION).simulation_summary, null, "ainda no ar");
  assert.equal(linha(db, antiga.id).simulation_summary, null, "fora das 6 h");
  assert.deepEqual(linha(db, congelada.id).simulation_summary, { counter_max: 1, joins_shown: 1, sale_notices_shown: 0 });

  const muitas = escolaDaSimulacao();
  for (let index = 0; index < 60; index += 1) {
    muitas.webinar_sessions.push(sessionRow(`eeeeeeee-0000-4000-8000-${String(1000 + index).padStart(12, "0")}`, { ...regras, ended_at: iso(now - 3 * HOUR + index * MIN), scheduled_at: iso(now - 5 * HOUR), status: "ended" }));
  }
  const lote = montar(muitas);
  const [primeiro] = await silenciando(() => tick.runSimulationSummariesTick({ db: lote }));
  assert.equal(primeiro.frozen, tick.SIMULATION_SUMMARIES_BATCH);
  const congeladas = lote.tables.webinar_sessions.filter((row) => row.simulation_summary);
  assert.ok(congeladas.every((row) => Number(row.id.slice(-4)) < 1050), "as mais antigas primeiro");
  const [segundo] = await silenciando(() => tick.runSimulationSummariesTick({ db: lote }));
  assert.equal(segundo.frozen, 10);
});

test("o tick sem tempo nao faz nada; banco sem a 202610290005 registra e sai sem erro (o tick continua verde) e sem contagem em job_runs", async () => {
  const tables = escolaDaSimulacao();
  Object.assign(tables.webinar_sessions.find((row) => row.id === ENDED_SESSION), regras);
  const db = montar(tables);
  const parado = new AbortController();
  parado.abort();
  const [semTempo] = await silenciando(() => job.runSimulationSummariesJob(contexto(db, { signal: parado.signal })));
  assert.deepEqual(semTempo, { failed: 0, frozen: 0, pendingMigration: false, scanned: 0, skipped: 0 });
  assert.equal(db.calls.queries.length, 0, "nem a consulta");

  const pendente = montar(escolaDaSimulacao(), { semColunas: true });
  const [resultado, linhas] = await silenciando(() => job.runSimulationSummariesJob(contexto(pendente)));
  assert.equal(resultado.pendingMigration, true);
  assert.equal(resultado.frozen, 0);
  assert.ok(linhas.some((line) => line.includes("202610290005")), "o log cita a migracao");
  assert.deepEqual(pendente.tables.job_runs[0].metadata, {}, "sem trabalho, sem contagem");
  assert.equal(job.webinarSimulationSummariesJob.name, "webinar-simulation-summaries");
  await silenciando(() => job.webinarSimulationSummariesJob.run(contexto(pendente)));
});

test("uma falha numa sessao vira log e o lote segue", async () => {
  const tables = escolaDaSimulacao();
  Object.assign(tables.webinar_sessions.find((row) => row.id === ENDED_SESSION), regras);
  const outra = sessionRow("eeeeeeee-0000-4000-8000-0000000000c1", { ...regras, ended_at: iso(Date.now() - 30 * MIN), scheduled_at: iso(Date.now() - 90 * MIN), status: "ended", webinar_id: "eeeeeeee-0000-4000-8000-0000000000c9" });
  tables.webinar_sessions.push(outra);
  const db = montar(tables);
  const from = db.from.bind(db);
  db.from = (name) => {
    const chain = from(name);
    if (name === "webinars") {
      const original = chain.eq;
      chain.eq = (column, value) => (value === "eeeeeeee-0000-4000-8000-0000000000c9" ? { is: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }) }) } : original(column, value));
    }
    return chain;
  };
  const [resultado, linhas] = await silenciando(() => tick.runSimulationSummariesTick({ db }));
  assert.deepEqual([resultado.frozen, resultado.failed], [1, 1]);
  assert.ok(linhas.some((line) => line.includes(outra.id)));
  assert.ok(linha(db, ENDED_SESSION).simulation_summary, "a outra sessao congelou");
});

test("CDC (§8.6, D10): a sessao com regra e sem a decisao registrada nao mostrou nada; o resumo congela zeros", async () => {
  const tables = escolaDaSimulacao();
  Object.assign(tables.webinar_sessions.find((row) => row.id === ENDED_SESSION), semDecisao);
  const db = montar(tables);
  const [resultado] = await silenciando(() => tick.runSimulationSummariesTick({ db }));
  assert.equal(resultado.frozen, 1);
  assert.deepEqual(linha(db, ENDED_SESSION).simulation_summary, { counter_max: 0, joins_shown: 0, sale_notices_shown: 0 });
  assert.equal(model.simulationDecisionRecorded({ simulationAckText: DECISAO.simulation_ack_text, simulationDecidedAt: DECISAO.simulation_decided_at }), true);
  assert.equal(model.simulationDecisionRecorded({ simulationAckText: "", simulationDecidedAt: DECISAO.simulation_decided_at }), false);
  assert.equal(model.simulationDecisionRecorded({ simulationAckText: DECISAO.simulation_ack_text, simulationDecidedAt: null }), false);
});
