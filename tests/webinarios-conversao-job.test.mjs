import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";
import { contexto, rpcs, scriptedDb, silenciando, tabelas } from "./support/webinarios-banco-falso.mjs";

// O job do tick da conversao da Oferta (docs/30 §4.2, M7; fase 4b), sem banco: uma chamada da RPC
// webinar_offer_conversions com o lote de OFFER_LIMITS.conversionsPerRun e a hora do tick (nunca a do relogio), e
// nada mais; sem conversao, nenhuma escrita em job_runs; com conversao, a contagem e o tempo na linha do proprio job
// (o tick_run_id fica); banco sem a 202610290005 registra e termina sem erro; o tick sem tempo (signal abortado) nao
// chama; outro erro do banco aparece em job_runs (o job falha). O job nunca grava venda, acesso nem clique: a RPC liga
// a venda (sale_grants) ao ultimo clique em ate attribution_days, conferida no Postgres pela guarda da migracao.

const { OFFER_LIMITS } = await import("../src/server/webinars/model.ts");
const { WEBINAR_OFFER_CONVERSIONS_JOB_NAME, runOfferConversionsTick, webinarOfferConversionsJob } = await import("../src/server/jobs/webinar-offer-conversions-job.ts");

const TICK = new Date("2026-11-06T15:07:00.000Z");

/** Banco que responde a RPC da conversao com `resposta` e o resto (job_runs) com sucesso. */
function bancoDaConversao(resposta) {
  return scriptedDb((query) => {
    if (query.op === "rpc" && query.table === "webinar_offer_conversions") {
      return typeof resposta === "function" ? resposta(query) : resposta;
    }

    return { data: null, error: null };
  });
}

test("o nome do job segue a regra do registro do tick", () => {
  assert.equal(WEBINAR_OFFER_CONVERSIONS_JOB_NAME, "webinar-offer-conversions");
  assert.equal(webinarOfferConversionsJob.name, WEBINAR_OFFER_CONVERSIONS_JOB_NAME);
  assert.match(webinarOfferConversionsJob.name, /^[a-z0-9][a-z0-9-]{0,119}$/);
});

test("sem venda para ligar: uma chamada da RPC com o lote e a hora do tick, e nenhuma escrita", async () => {
  const db = bancoDaConversao({ data: 0, error: null });

  const [result, linhas] = await silenciando("info", () => runOfferConversionsTick(contexto(db, TICK)));

  assert.deepEqual(result, { converted: 0, pendingMigration: false, skipped: false });
  assert.deepEqual(tabelas(db), ["webinar_offer_conversions:rpc"], "uma chamada e nada mais");
  assert.deepEqual(rpcs(db, "webinar_offer_conversions")[0].args, { p_limit: OFFER_LIMITS.conversionsPerRun, p_now: "2026-11-06T15:07:00.000Z" });
  assert.equal(OFFER_LIMITS.conversionsPerRun, 500);
  assert.deepEqual(linhas, [], "sem trabalho, sem log");
});

test("com vendas ligadas: a contagem e o tempo vao para job_runs.metadata da linha do job, com o tick_run_id", async () => {
  const db = bancoDaConversao({ data: 3, error: null });

  const [, linhas] = await silenciando("info", () => webinarOfferConversionsJob.run(contexto(db, TICK)));

  assert.deepEqual(tabelas(db), ["webinar_offer_conversions:rpc", "job_runs:update"]);
  const [metricas] = db.queries.filter((query) => query.table === "job_runs");
  assert.equal(metricas.payload.metadata.tick_run_id, "tick", "o tick_run_id do run-tick.ts fica");
  assert.deepEqual(Object.keys(metricas.payload.metadata.webinar_offer_conversions).sort(), ["converted", "job_ms"]);
  assert.equal(metricas.payload.metadata.webinar_offer_conversions.converted, 3);
  assert.equal(typeof metricas.payload.metadata.webinar_offer_conversions.job_ms, "number");
  assert.ok(metricas.filters.some(([method, column, value]) => method === "eq" && column === "id" && value === "run"), "a linha do proprio job");
  assert.deepEqual(linhas, ["[webinarios] tick tick: 3 venda(s) ligada(s) ao clique da oferta."]);
});

test("a RPC que devolve o numero como texto (bigint do PostgREST) conta igual; falha ao gravar a contagem so vira log", async () => {
  const db = scriptedDb((query) =>
    query.op === "rpc" ? { data: "2", error: null } : { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
  );

  const [[result], erros] = await silenciando("error", () => silenciando("info", () => runOfferConversionsTick(contexto(db, TICK))));

  assert.equal(result.converted, 2);
  assert.ok(erros.some((linha) => linha.includes("contagem das conversoes da oferta nao gravada")), erros.join("\n"));
});

test("dois ticks no mesmo minuto: cada um so chama a RPC (a idempotencia e dela: clique ja convertido e venda ja ligada nao entram)", async () => {
  let ligadas = 2;
  const db = bancoDaConversao(() => {
    const agora = ligadas;
    ligadas = 0;
    return { data: agora, error: null };
  });

  await silenciando("info", async () => {
    assert.equal((await runOfferConversionsTick(contexto(db, TICK))).converted, 2);
    assert.equal((await runOfferConversionsTick(contexto(db, TICK))).converted, 0);
  });

  assert.equal(rpcs(db, "webinar_offer_conversions").length, 2);
  assert.equal(db.queries.filter((query) => query.table === "job_runs").length, 1, "so o tick que ligou grava a contagem");
  assert.ok(!db.queries.some((query) => ["insert", "upsert", "delete"].includes(query.op)), "o job nunca grava venda, acesso nem clique");
});

test("banco sem a migracao 202610290005: registra e termina sem erro (o tick continua verde)", async () => {
  for (const erro of [
    { code: "PGRST202", message: "Could not find the function public.webinar_offer_conversions(p_limit, p_now) in the schema cache" },
    { code: "42883", message: "function public.webinar_offer_conversions(timestamp with time zone, integer) does not exist" },
    { code: "42P01", message: 'relation "public.webinar_offer_clicks" does not exist' }
  ]) {
    const db = bancoDaConversao({ data: null, error: erro });

    const [result, linhas] = await silenciando("info", () => runOfferConversionsTick(contexto(db, TICK)));

    assert.deepEqual(result, { converted: 0, pendingMigration: true, skipped: false }, erro.code);
    assert.ok(linhas.some((linha) => linha.includes("migracao 202610290005 pendente")), linhas.join("\n"));
    assert.ok(!db.queries.some((query) => query.table === "job_runs"), "nada em job_runs");
    await silenciando("info", () => assert.doesNotReject(() => webinarOfferConversionsJob.run(contexto(db, TICK))));
  }
});

test("tick sem tempo (signal abortado): nao chama a RPC", async () => {
  const controller = new AbortController();
  controller.abort();
  const db = bancoDaConversao({ data: 9, error: null });

  assert.deepEqual(await runOfferConversionsTick(contexto(db, TICK, { signal: controller.signal })), { converted: 0, pendingMigration: false, skipped: true });
  await webinarOfferConversionsJob.run(contexto(db, TICK, { signal: controller.signal }));
  assert.deepEqual(db.queries, []);
});

test("erro de banco que nao e migracao pendente faz o job falhar (aparece em job_runs)", async () => {
  const db = bancoDaConversao({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });

  await assert.rejects(() => webinarOfferConversionsJob.run(contexto(db, TICK)), /statement timeout/);
});
