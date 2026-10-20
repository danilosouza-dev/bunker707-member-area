import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// Job "comunicacao" do tick de minuto (docs/22 §5): sem trabalho, termina rapido sem ler os alunos; banco
// sem a migracao 202610200001 nao derruba o tick (o job registra e termina). O envio e o recalculo de
// verdade estao em tests/integration/avisos-e-notificacoes.test.mjs e tests/integration/pop-ups.test.mjs.

const { processCommunications } = await import("../src/server/communications/dispatch.ts");
const { COMMUNICATIONS_JOB_NAME, communicationsJob } = await import("../src/server/jobs/communications-job.ts");

/** Banco falso: toda consulta, com qualquer filtro, devolve `result`; registra tabelas e RPCs pedidas. */
function fakeDb(result) {
  const calls = { from: [], rpc: [] };
  const chain = () =>
    new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") {
            return (resolve, reject) => Promise.resolve(result).then(resolve, reject);
          }

          return () => chain();
        }
      }
    );

  return {
    calls,
    from(table) {
      calls.from.push(table);
      return chain();
    },
    rpc(name) {
      calls.rpc.push(name);
      return chain();
    }
  };
}

const contexto = (supabase) => ({ runId: "run", signal: new AbortController().signal, supabase, tickRunId: "tick", tickStartedAt: new Date() });

test("banco sem aviso para enviar nem pop-up no ar: o job termina sem ler os alunos", async () => {
  const db = fakeDb({ data: [], error: null });
  const result = await processCommunications({ db, now: new Date("2026-10-20T15:00:00.000Z") });

  assert.deepEqual(result, { dispatched: 0, failed: 0, pendingMigration: false, refreshed: 0, sending: 0 });
  assert.deepEqual([...new Set(db.calls.from)], ["campaigns"], "so procura avisos vencidos e pop-ups no ar");
  assert.deepEqual(db.calls.rpc, [], "nenhuma leitura de comentarios ou alunos");
  await communicationsJob.run(contexto(db));
});

test("banco sem a migracao da Comunicacao: o job registra e termina sem erro (o tick continua verde)", async () => {
  const db = fakeDb({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.campaigns' in the schema cache" } });
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));

  try {
    const result = await processCommunications({ db });
    assert.equal(result.pendingMigration, true);
    await assert.doesNotReject(() => communicationsJob.run(contexto(db)));
  } finally {
    console.error = original;
  }

  assert.ok(errors.some((line) => line.includes("migracao 202610200001 pendente")), errors.join("\n"));
});

test("erro de banco que nao e migracao pendente continua sendo falha do job (aparece em job_runs)", async () => {
  const db = fakeDb({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });

  await assert.rejects(() => communicationsJob.run(contexto(db)), /statement timeout/);
});

test("o nome do job segue a regra do registro do tick", () => {
  assert.equal(COMMUNICATIONS_JOB_NAME, "comunicacao");
  assert.equal(communicationsJob.name, COMMUNICATIONS_JOB_NAME);
  assert.match(communicationsJob.name, /^[a-z0-9][a-z0-9-]{0,119}$/);
});
