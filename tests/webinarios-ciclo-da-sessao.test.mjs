import assert from "node:assert/strict";
import test from "node:test";
import "./support/admin-action-stubs.mjs";
import { ALUNA, ALUNO, EQUIPE, GRAVACAO_ID, SESSAO_ID, WEBINAR_ID, bancoDosWebinarios, gravacaoRow, rpcs, sessaoRow, sinos, tabelas, vagaRow, webinarRow } from "./support/webinarios-banco-falso.mjs";

// O ciclo de vida da sessao (docs/30 §2.3, §4.5 e §6.6; entrega 2c), sem banco: abrir pela RPC webinar_open_session
// e avisar "Comecou agora" so quando a sessao mudou (uma vez por vaga, a equipe fora, nunca num webinario cancelado
// ou rascunho), o replay que nao abre, a sessao que nao existe; encerrar pela RPC webinar_close_session (o resumo
// congelado volta como PresenceSummary) e a sessao `replay` do webinario: uma por webinario, so com a gravacao
// pronta (a da sessao ou a base do webinario), apontando para a sessao de origem, com os controles de chat
// copiados, e a corrida resolvida pelo indice unico (23505 = ja existia). O ciclo contra o banco local fica em
// tests/integration/webinarios-relatorio.test.mjs.

process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";

const { finishSession, openSession, replayRecordingOf } = await import("../src/server/webinars/session-lifecycle.ts");

const AGORA = new Date("2026-11-05T23:00:30.000Z");
const FIM = new Date("2026-11-05T23:31:00.000Z");

test("abrir: a RPC poe a sessao em live e o Comecou agora sai uma vez por vaga (a equipe fora); abrir de novo nao avisa", async () => {
  const db = bancoDosWebinarios({ equipe: [EQUIPE], roteiro: [{ status: "ready", trigger_kind: "at_offset" }, { status: "draft", trigger_kind: "at_offset" }], vagas: [vagaRow(ALUNA), vagaRow(ALUNO, { session_id: null }), vagaRow(EQUIPE)] });

  const result = await openSession(db, SESSAO_ID, AGORA);

  assert.deepEqual(result, { changed: true, fired: 1, notified: 2 });
  const [rpc] = rpcs(db, "webinar_open_session");
  assert.deepEqual(rpc.args, { p_now: AGORA.toISOString(), p_session_id: SESSAO_ID });
  assert.equal(db.estado.sessoes[0].status, "live");
  assert.equal(db.estado.sessoes[0].started_at, "2026-11-05T23:00:00.000Z", "na gravada, started_at e a hora marcada");

  const linhas = sinos(db);
  assert.deepEqual(linhas.map((linha) => [linha.user_id, linha.title, linha.body]), [
    [ALUNA, "Começou agora", "Começou agora: Live de agentes. Entrar."],
    [ALUNO, "Começou agora", "Começou agora: Live de agentes. Entrar."]
  ]);
  assert.equal(linhas[0].dedupe_key, `webinar:${SESSAO_ID}:started:202611052300`);
  assert.deepEqual(db.estado.vagas.map((vaga) => [vaga.user_id, vaga.started_notice_sent_at]), [
    [ALUNA, AGORA.toISOString()],
    [ALUNO, AGORA.toISOString()],
    [EQUIPE, null]
  ]);

  // Ja esta no ar: a RPC diz changed=false e nada sai de novo.
  const antes = db.queries.length;
  assert.deepEqual(await openSession(db, SESSAO_ID, new Date(AGORA.getTime() + 60_000)), { changed: false, fired: 0, notified: 0 });
  assert.deepEqual(tabelas(db, antes), ["webinar_sessions:select", "webinar_open_session:rpc"]);
});

test("abrir: webinario cancelado ou rascunho abre a sessao mas nao avisa ninguem; o replay nao abre; sessao inexistente e 404", async () => {
  for (const webinar of [webinarRow({ cancelled_at: "2026-11-01T12:00:00.000Z" }), webinarRow({ status: "draft" })]) {
    const db = bancoDosWebinarios({ vagas: [vagaRow(ALUNA)], webinars: [webinar] });
    assert.deepEqual(await openSession(db, SESSAO_ID, AGORA), { changed: true, fired: 0, notified: 0 });
    assert.equal(sinos(db).length, 0);
    assert.ok(!db.queries.some((query) => query.table === "webinar_registrations"), "nenhuma vaga lida");
  }

  const replay = bancoDosWebinarios({ sessoes: [sessaoRow({ kind: "replay", status: "live" })], vagas: [vagaRow(ALUNA)] });
  assert.deepEqual(await openSession(replay, SESSAO_ID, AGORA), { changed: false, fired: 0, notified: 0 });
  assert.equal(rpcs(replay, "webinar_open_session").length, 0, "o replay ja nasce disponivel: nenhuma RPC");

  const vazio = bancoDosWebinarios({ sessoes: [] });
  await assert.rejects(() => openSession(vazio, SESSAO_ID, AGORA), (error) => error.status === 404 && /não existe mais/.test(error.message));
});

test("encerrar: a RPC congela o resumo (volta como PresenceSummary) e o replay nasce uma vez, com a gravacao base pronta e os controles do chat", async () => {
  const db = bancoDosWebinarios({ sessoes: [sessaoRow({ chat_mode: "moderated", chat_slow_mode_seconds: 20, recording_id: null, started_at: "2026-11-05T23:00:00.000Z", status: "live" })] });

  const result = await finishSession(db, SESSAO_ID, FIM);

  assert.equal(result.replayCreated, true);
  assert.deepEqual(result.summary, {
    avgPresent: 1.5,
    bucketSeconds: 30,
    buckets: [
      { b: 0, n: 2 },
      { b: 1, n: 2 },
      { b: 2, n: 1 }
    ],
    durationMs: 1_800_000,
    frozenAt: FIM.toISOString(),
    peak: { b: 0, n: 2 },
    reachedEnd: 1,
    unique: 2,
    watchAvg: 900,
    watchMax: 1800
  });
  const [rpc] = rpcs(db, "webinar_close_session");
  assert.deepEqual(rpc.args, { p_now: FIM.toISOString(), p_session_id: SESSAO_ID });
  assert.equal(db.estado.sessoes[0].status, "ended");
  assert.equal(db.estado.sessoes[0].ended_at, FIM.toISOString());

  const [insert] = db.queries.filter((query) => query.table === "webinar_sessions" && query.op === "insert");
  assert.deepEqual(insert.payload, {
    chat_mode: "moderated",
    chat_slow_mode_seconds: 20,
    kind: "replay",
    late_join_minutes: null,
    recording_id: GRAVACAO_ID,
    scheduled_at: FIM.toISOString(),
    source_session_id: SESSAO_ID,
    status: "live",
    webinar_id: WEBINAR_ID
  });
  assert.equal(db.estado.sessoes.length, 2);

  // Encerrar de novo: o resumo e refeito (idempotente) e nenhum segundo replay (a lista ja tem um).
  const outra = await finishSession(db, SESSAO_ID, new Date(FIM.getTime() + 60_000));
  assert.equal(outra.replayCreated, false);
  assert.equal(db.queries.filter((query) => query.table === "webinar_sessions" && query.op === "insert").length, 1);
  assert.equal(db.estado.sessoes.length, 2);
});

test("encerrar: sem gravacao pronta nenhum replay (Live ao vivo espera o MP4); a gravacao da propria sessao vale antes da base; replay encerrado nao gera outro", async () => {
  const semGravacao = bancoDosWebinarios({ gravacoes: [], sessoes: [sessaoRow({ kind: "live", recording_id: null, started_at: "2026-11-05T23:00:00.000Z", status: "live" })] });
  assert.equal((await finishSession(semGravacao, SESSAO_ID, FIM)).replayCreated, false);
  assert.ok(!semGravacao.queries.some((query) => query.table === "webinar_sessions" && query.op === "insert"));

  const processando = bancoDosWebinarios({ gravacoes: [gravacaoRow({ status: "processing" })], sessoes: [sessaoRow({ status: "live" })] });
  assert.equal((await finishSession(processando, SESSAO_ID, FIM)).replayCreated, false);

  const propria = gravacaoRow({ id: "88888888-2222-4222-8222-222222222288", session_id: SESSAO_ID, source: "jibri" });
  const comAsDuas = bancoDosWebinarios({ gravacoes: [gravacaoRow(), propria], sessoes: [sessaoRow({ kind: "live", recording_id: propria.id, status: "live" })] });
  assert.equal((await finishSession(comAsDuas, SESSAO_ID, FIM)).replayCreated, true);
  const [insert] = comAsDuas.queries.filter((query) => query.table === "webinar_sessions" && query.op === "insert");
  assert.equal(insert.payload.recording_id, propria.id, "a gravacao da sessao vale antes da base");

  const replay = bancoDosWebinarios({ sessoes: [sessaoRow({ kind: "replay", source_session_id: "11111111-aaaa-4aaa-8aaa-111111111111", status: "live" })] });
  const encerrado = await finishSession(replay, SESSAO_ID, FIM);
  assert.equal(encerrado.replayCreated, false);
  assert.equal(encerrado.summary?.unique, 2, "o resumo do proprio replay e congelado do mesmo jeito");
  assert.ok(!replay.queries.some((query) => query.table === "webinar_recordings"), "o replay nem olha as gravacoes");
});

test("encerrar: duas sessoes encerrando juntas, o indice unico decide (23505 vira replayCreated: false, sem erro)", async () => {
  const db = bancoDosWebinarios({ replayDuplicado: true, sessoes: [sessaoRow({ status: "live" })] });

  const result = await finishSession(db, SESSAO_ID, FIM);

  assert.equal(result.replayCreated, false);
  assert.equal(result.summary?.unique, 2);
  assert.equal(db.queries.filter((query) => query.table === "webinar_sessions" && query.op === "insert").length, 1, "tentou e aceitou o nao");
});

test("replayRecordingOf: a gravacao da sessao, senao a base do webinario (bunny antes), so quando pronta", () => {
  const base = gravacaoRow();
  const propria = gravacaoRow({ id: "88888888-2222-4222-8222-222222222288", session_id: SESSAO_ID, source: "jibri" });
  const outraBase = gravacaoRow({ id: "66666666-2222-4222-8222-222222222266", source: "upload" });

  assert.equal(replayRecordingOf([base, propria], { recording_id: propria.id })?.id, propria.id);
  assert.equal(replayRecordingOf([base, propria], { recording_id: null })?.id, base.id);
  assert.equal(replayRecordingOf([outraBase, base], { recording_id: null })?.id, base.id, "a base da Bunny antes das outras");
  assert.equal(replayRecordingOf([outraBase], { recording_id: null })?.id, outraBase.id);
  assert.equal(replayRecordingOf([gravacaoRow({ status: "processing" })], { recording_id: GRAVACAO_ID }), null);
  assert.equal(replayRecordingOf([], { recording_id: GRAVACAO_ID }), null);
});
