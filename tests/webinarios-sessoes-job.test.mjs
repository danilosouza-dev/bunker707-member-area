import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";
import {
  ALUNA,
  ALUNO,
  EQUIPE,
  SESSAO_ID,
  WEBINAR_ID,
  bancoDosWebinarios,
  contexto,
  filterOf,
  gravacaoRow,
  rpcs,
  scriptedDb,
  sessaoRow,
  silenciando,
  sinos,
  tabelas,
  vagaRow,
  webinarRow
} from "./support/webinarios-banco-falso.mjs";

// O tick das sessoes gravadas (docs/30 §1.6, §2.3 e §6.6; entrega 2c), sem banco: a sessao `simulated` abre na hora
// marcada (RPC webinar_open_session + "Comecou agora" uma vez por vaga) e o tick seguinte nao repete; encerra depois
// da duracao do video (RPC webinar_close_session) e cria um replay so, mesmo nos ticks seguintes; sem duracao na
// gravacao vale a duracao prevista; a sessao cuja janela inteira passou sem abrir e encerrada direto, sem "Comecou
// agora" atrasado; rascunho e cancelado pulam; `live` (fase 3) e `replay` ficam de fora; uma consulta de sessoes por
// tick e um webinario lido uma vez; o tick abortado para entre as sessoes; a migracao pendente; o nome e as contagens
// do job em job_runs. O job contra o banco local fica em tests/integration/webinarios-relatorio.test.mjs.

process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";

const { runSessionsTick, simulatedSessionEndsAt, SESSIONS_LOOKBACK_MS } = await import("../src/server/webinars/sessions-tick.ts");
const { WEBINAR_SESSIONS_JOB_NAME, webinarSessionsJob } = await import("../src/server/jobs/webinar-sessions-job.ts");

const HORA_MARCADA = "2026-11-05T23:00:00.000Z"; // 20:00 em Sao Paulo
const ZEROS = { finished: 0, opened: 0, pendingMigration: false, replays: 0, skipped: 0 };
const em = (iso) => new Date(iso);

test("na hora marcada: uma consulta de sessoes, a RPC abre a sessao gravada, o Comecou agora sai uma vez por vaga (equipe fora) e o tick seguinte nao repete", async () => {
  const db = bancoDosWebinarios({ equipe: [EQUIPE], vagas: [vagaRow(ALUNA), vagaRow(ALUNO), vagaRow(EQUIPE)] });

  const result = await runSessionsTick({ db, now: em("2026-11-05T23:00:20.000Z") });

  assert.deepEqual(result, { ...ZEROS, opened: 1 });
  const [consulta] = db.queries;
  assert.equal(consulta.table, "webinar_sessions");
  assert.deepEqual(filterOf(consulta, "in"), ["in", "status", ["scheduled", "waiting", "live"]]);
  assert.deepEqual(filterOf(consulta, "gte"), ["gte", "scheduled_at", new Date(Date.parse("2026-11-05T23:00:20.000Z") - SESSIONS_LOOKBACK_MS).toISOString()]);
  assert.deepEqual(filterOf(consulta, "lte"), ["lte", "scheduled_at", "2026-11-05T23:00:20.000Z"]);
  assert.deepEqual(rpcs(db, "webinar_open_session")[0].args, { p_now: "2026-11-05T23:00:20.000Z", p_session_id: SESSAO_ID });
  assert.equal(db.estado.sessoes[0].status, "live");
  assert.equal(db.estado.sessoes[0].started_at, HORA_MARCADA);
  assert.deepEqual(sinos(db).map((linha) => [linha.user_id, linha.body]), [
    [ALUNA, "Começou agora: Live de agentes. Entrar."],
    [ALUNO, "Começou agora: Live de agentes. Entrar."]
  ]);
  // O tick le o webinario e as gravacoes uma vez; o "Comecou agora" (notify.ts) rele o webinario por sessao aberta.
  assert.equal(db.queries.filter((query) => query.table === "webinar_recordings").length, 1, "as gravacoes sao lidas uma vez");
  assert.equal(db.queries.filter((query) => query.table === "webinars").length, 2, "o tick le o webinario uma vez e o aviso de Comecou agora uma vez");

  // Tick seguinte, com a sessao no ar e dentro da duracao do video (30 min): nada a fazer.
  const antes = db.queries.length;
  assert.deepEqual(await runSessionsTick({ db, now: em("2026-11-05T23:01:20.000Z") }), ZEROS);
  assert.deepEqual(tabelas(db, antes), ["webinar_sessions:select", "webinars:select", "webinar_recordings:select"]);
  assert.equal(rpcs(db, "webinar_open_session").length, 1, "a RPC de abrir nao roda de novo");
  assert.equal(sinos(db).length, 2);
});

test("depois da duracao do video: a RPC encerra, o replay nasce apontando para a gravacao e os ticks seguintes nao repetem nem criam outro", async () => {
  const db = bancoDosWebinarios({ sessoes: [sessaoRow({ started_at: HORA_MARCADA, status: "live" })] });

  // 29 min: ainda no ar (a gravacao tem 30 min).
  assert.deepEqual(await runSessionsTick({ db, now: em("2026-11-05T23:29:00.000Z") }), ZEROS);
  assert.equal(rpcs(db, "webinar_close_session").length, 0);

  const result = await runSessionsTick({ db, now: em("2026-11-05T23:30:00.000Z") });

  assert.deepEqual(result, { ...ZEROS, finished: 1, replays: 1 });
  assert.deepEqual(rpcs(db, "webinar_close_session")[0].args, { p_now: "2026-11-05T23:30:00.000Z", p_session_id: SESSAO_ID });
  assert.equal(db.estado.sessoes[0].status, "ended");
  assert.equal(db.estado.sessoes[0].presence_curve.unique, 2, "a curva congelada ficou na sessao");
  const replay = db.estado.sessoes.find((sessao) => sessao.kind === "replay");
  assert.ok(replay, "o replay existe");
  assert.deepEqual([replay.status, replay.recording_id, replay.source_session_id, replay.scheduled_at, replay.late_join_minutes], ["live", gravacaoRow().id, SESSAO_ID, "2026-11-05T23:30:00.000Z", null]);

  // Tick seguinte: a sessao encerrada nao entra na consulta e o replay (kind replay, live) fica de fora.
  const antes = db.queries.length;
  assert.deepEqual(await runSessionsTick({ db, now: em("2026-11-05T23:31:00.000Z") }), ZEROS);
  assert.deepEqual(tabelas(db, antes), ["webinar_sessions:select"]);
  assert.equal(db.estado.sessoes.filter((sessao) => sessao.kind === "replay").length, 1);
});

test("sem duracao na gravacao vale a duracao prevista do webinario (60 min); a sessao da 1h pela gravacao da sessao", async () => {
  const semDuracao = bancoDosWebinarios({ gravacoes: [gravacaoRow({ duration_seconds: null })], sessoes: [sessaoRow({ started_at: HORA_MARCADA, status: "live" })] });
  assert.deepEqual(await runSessionsTick({ db: semDuracao, now: em("2026-11-05T23:45:00.000Z") }), ZEROS);
  // O endereco colado pela equipe nasce `ready` sem duracao (o app nao consulta a Bunny): o replay toca do mesmo jeito.
  assert.deepEqual(await runSessionsTick({ db: semDuracao, now: em("2026-11-06T00:00:00.000Z") }), { ...ZEROS, finished: 1, replays: 1 });

  const propria = gravacaoRow({ duration_seconds: 3600, id: "88888888-2222-4222-8222-222222222288", session_id: SESSAO_ID });
  const comADaSessao = bancoDosWebinarios({ gravacoes: [gravacaoRow(), propria], sessoes: [sessaoRow({ recording_id: propria.id, started_at: HORA_MARCADA, status: "live" })] });
  assert.deepEqual(await runSessionsTick({ db: comADaSessao, now: em("2026-11-05T23:45:00.000Z") }), ZEROS, "a gravacao da sessao (60 min) vale antes da base (30 min)");
  assert.equal(simulatedSessionEndsAt(sessaoRow({ started_at: HORA_MARCADA }), propria, 60), Date.parse("2026-11-06T00:00:00.000Z"));
  assert.equal(simulatedSessionEndsAt(sessaoRow(), null, 45), Date.parse("2026-11-05T23:45:00.000Z"));
});

test("a janela inteira passou sem ninguem abrir (o tick ficou fora do ar): encerra direto, sem Comecou agora atrasado, e o replay nasce", async () => {
  const db = bancoDosWebinarios({ sessoes: [sessaoRow({ scheduled_at: "2026-11-05T20:00:00.000Z" })], vagas: [vagaRow(ALUNA)] });

  const result = await runSessionsTick({ db, now: em("2026-11-05T23:00:00.000Z") });

  assert.deepEqual(result, { ...ZEROS, finished: 1, replays: 1 });
  assert.equal(rpcs(db, "webinar_open_session").length, 0, "nao abre");
  assert.equal(sinos(db).length, 0, "ninguem recebe Comecou agora de uma sessao que ja acabou");
  assert.equal(db.estado.sessoes[0].status, "ended");
});

test("webinario rascunho, cancelado ou apagado: a sessao e pulada; sessao live (fase 3) e replay ficam de fora; a RPC que nao muda conta como pulada", async () => {
  for (const webinars of [[webinarRow({ status: "draft" })], [webinarRow({ cancelled_at: "2026-11-01T12:00:00.000Z" })], []]) {
    const db = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)], webinars });
    assert.deepEqual(await runSessionsTick({ db, now: em("2026-11-05T23:00:20.000Z") }), { ...ZEROS, skipped: 1 });
    assert.equal(rpcs(db, "webinar_open_session").length, 0);
  }

  const foraDoTick = bancoDosWebinarios({
    sessoes: [sessaoRow({ kind: "live", scheduled_at: "2026-11-05T22:00:00.000Z", status: "live" }), sessaoRow({ id: "22222222-aaaa-4aaa-8aaa-222222222222", kind: "replay", scheduled_at: "2026-11-05T21:00:00.000Z", status: "live" })]
  });
  assert.deepEqual(await runSessionsTick({ db: foraDoTick, now: em("2026-11-05T23:00:20.000Z") }), ZEROS);
  assert.deepEqual(tabelas(foraDoTick), ["webinar_sessions:select"], "nem o webinario e lido");

  const outroTick = bancoDosWebinarios({ abrir: () => ({ data: { changed: false, fired: 0, status: "live" }, error: null }) });
  assert.deepEqual(await runSessionsTick({ db: outroTick, now: em("2026-11-05T23:00:20.000Z") }), { ...ZEROS, skipped: 1 });
  assert.equal(sinos(outroTick).length, 0);
});

test("varias sessoes do mesmo webinario no mesmo tick: o webinario e as gravacoes sao lidos uma vez pelo tick; o tick abortado para entre as sessoes e nao le nada quando ja nasce abortado", async () => {
  const segunda = sessaoRow({ id: "22222222-aaaa-4aaa-8aaa-222222222222", scheduled_at: "2026-11-05T22:59:00.000Z" });
  const db = bancoDosWebinarios({ sessoes: [sessaoRow(), segunda] });
  assert.deepEqual(await runSessionsTick({ db, now: em("2026-11-05T23:00:20.000Z") }), { ...ZEROS, opened: 2 });
  assert.equal(db.queries.filter((query) => query.table === "webinar_recordings").length, 1, "as gravacoes do webinario sao lidas uma vez para as duas sessoes");
  assert.equal(db.queries.filter((query) => query.table === "webinars").length, 1 + 2, "o tick le o webinario uma vez; o Comecou agora rele por sessao aberta");

  const controller = new AbortController();
  const abortaNaPrimeira = bancoDosWebinarios({
    abrir: (args, estado) => {
      controller.abort();
      Object.assign(
        estado.sessoes.find((sessao) => sessao.id === args.p_session_id),
        { started_at: HORA_MARCADA, status: "live" }
      );
      return { data: { changed: true, fired: 0, status: "live" }, error: null };
    },
    sessoes: [sessaoRow(), segunda]
  });
  assert.deepEqual(await runSessionsTick({ db: abortaNaPrimeira, now: em("2026-11-05T23:00:20.000Z"), signal: controller.signal }), { ...ZEROS, opened: 1 });
  assert.equal(rpcs(abortaNaPrimeira, "webinar_open_session").length, 1, "a segunda fica para o proximo tick");

  const jaAbortado = new AbortController();
  jaAbortado.abort();
  const parado = bancoDosWebinarios();
  assert.deepEqual(await runSessionsTick({ db: parado, now: em("2026-11-05T23:00:20.000Z"), signal: jaAbortado.signal }), ZEROS);
  assert.equal(parado.queries.length, 0);
});

test("sem sessao na janela: uma consulta so e o job nao grava em job_runs; banco sem a migracao: zeros, registro e o job termina sem erro; erro de banco e falha do job", async () => {
  const vazio = bancoDosWebinarios({ sessoes: [] });
  const [result, infos] = await silenciando("info", () => runSessionsTick({ db: vazio, now: em("2026-11-05T23:00:20.000Z") }));
  assert.deepEqual(result, ZEROS);
  assert.deepEqual(tabelas(vazio), ["webinar_sessions:select"]);
  assert.deepEqual(infos, []);
  await webinarSessionsJob.run(contexto(vazio, em("2026-11-05T23:00:20.000Z")));
  assert.ok(!vazio.queries.some((query) => query.table === "job_runs"));

  const semTabela = scriptedDb(() => ({ data: null, error: { code: "PGRST205", message: "Could not find the table 'public.webinar_sessions' in the schema cache" } }));
  const [pendente, avisos] = await silenciando("info", () => runSessionsTick({ db: semTabela, now: em("2026-11-05T23:00:20.000Z") }));
  assert.deepEqual(pendente, { ...ZEROS, pendingMigration: true });
  assert.ok(avisos.some((linha) => linha.includes("migracao 202610300001 pendente")), avisos.join("\n"));
  await silenciando("info", () => assert.doesNotReject(() => webinarSessionsJob.run(contexto(semTabela, em("2026-11-05T23:00:20.000Z")))));

  const quebrado = scriptedDb(() => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }));
  await assert.rejects(() => webinarSessionsJob.run(contexto(quebrado, em("2026-11-05T23:00:20.000Z"))), /statement timeout/);
});

test("o nome do job segue a regra do registro; com trabalho, as contagens vao para job_runs com o tick_run_id", async () => {
  assert.equal(WEBINAR_SESSIONS_JOB_NAME, "webinar-sessions");
  assert.equal(webinarSessionsJob.name, WEBINAR_SESSIONS_JOB_NAME);
  assert.match(webinarSessionsJob.name, /^[a-z0-9][a-z0-9-]{0,119}$/);

  const db = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)] });
  const [, infos] = await silenciando("info", () => webinarSessionsJob.run(contexto(db, em("2026-11-05T23:00:20.000Z"))));

  const [metricas] = db.queries.filter((query) => query.table === "job_runs");
  assert.ok(metricas, "houve trabalho: as contagens vao para job_runs");
  assert.equal(metricas.op, "update");
  assert.equal(metricas.payload.metadata.tick_run_id, "tick");
  assert.deepEqual(Object.keys(metricas.payload.metadata.webinars_sessions).sort(), ["finished", "job_ms", "opened", "replays", "skipped"]);
  assert.deepEqual([metricas.payload.metadata.webinars_sessions.opened, metricas.payload.metadata.webinars_sessions.finished], [1, 0]);
  assert.ok(metricas.filters.some(([method, column, value]) => method === "eq" && column === "id" && value === "run"), "a linha do proprio job");
  assert.ok(infos.some((linha) => /^\[webinarios\] tick tick: 1 sessao\(oes\) gravada\(s\) aberta\(s\), 0 encerrada\(s\), 0 replay\(s\) criado\(s\), 0 pulada\(s\)\.$/.test(linha)), infos.join("\n"));
  assert.equal(WEBINAR_ID.length, 36);
});
