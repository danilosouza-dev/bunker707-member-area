import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O relatorio da sessao, a parte pura (docs/30 §3.4 e §4.6): as linhas da RPC lidas sem confiar no formato (bigint
// como texto), a visao montada (as mesmas linhas que a webinar_report devolveu no Postgres local com dados
// sinteticos), os ids para a segunda leitura dos nomes e os rotulos.

const report = await import("../src/server/webinars/report-model.ts");

// O que a RPC devolveu na conferencia da migracao (um aluno ate o fim, um que saiu e voltou, um que so passou).
const RPC_ROWS = [
  { metric: "avg_present", item: "", total: "1", students: "1" },
  { metric: "chat_minute", item: "0", total: 2, students: 2 },
  { metric: "chat_total", item: "", total: 2, students: 2 },
  { metric: "drop", item: "2", total: 1, students: 1 },
  { metric: "drop", item: "41", total: 1, students: 1 },
  { metric: "drop", item: "71", total: 1, students: 1 },
  { metric: "hot", item: "b001", total: 100, students: 1 },
  { metric: "hot", item: "b002", total: 65, students: 1 },
  { metric: "hot", item: "b003", total: 12, students: 1 },
  { metric: "peak", item: "0", total: 3, students: 3 },
  { metric: "poll", item: "c1:b1", total: 1, students: 1 },
  { metric: "poll", item: "c1:b2", total: 1, students: 1 },
  { metric: "presence", item: "1", total: 3, students: 3 },
  { metric: "presence", item: "0", total: 3, students: 3 },
  { metric: "presence", item: "2", total: 2, students: 2 },
  { metric: "question", item: "open", total: 1, students: 1 },
  { metric: "reached_end", item: "", total: 1, students: 1 },
  { metric: "reaction", item: "fire", total: 2, students: 2 },
  { metric: "reaction_minute", item: "fire:1", total: 2, students: 2 },
  { metric: "registration", item: "absent", total: 0, students: 0 },
  { metric: "registration", item: "attended", total: 2, students: 2 },
  { metric: "registration", item: "registered", total: 2, students: 2 },
  { metric: "registration_source", item: "", total: 1, students: 1 },
  { metric: "registration_source", item: "email", total: 1, students: 1 },
  { metric: "replay", item: "viewers", total: 0, students: 0 },
  { metric: "replay", item: "watched_pct", total: 0, students: 0 },
  { metric: "sim_script", item: "ready", total: 2, students: 0 },
  { metric: "sim_script", item: "fired", total: 2, students: 0 },
  { metric: "sim_script", item: "missed", total: 0, students: 0 },
  { metric: "top_chat", item: "b001", total: 1, students: 1 },
  { metric: "top_chat", item: "b003", total: 1, students: 1 },
  { metric: "top_question", item: "d1", total: 2, students: 1 },
  { metric: "unique", item: "", total: 3, students: 3 },
  { metric: "watch_avg", item: "", total: 1730, students: 3 },
  { metric: "watch_max", item: "", total: 3600, students: 3 },
  { metric: "metrica_futura", item: "x", total: 9, students: 9 },
  null,
  { item: "sem metric" }
];

test("le as linhas sem confiar no formato: texto vira numero, lixo e ignorado", () => {
  const rows = report.readWebinarReportRows(RPC_ROWS);
  assert.equal(rows.length, 36, "36 linhas validas (a futura entra; nulo e sem metric saem)");
  assert.deepEqual(rows[0], { item: "", metric: "avg_present", students: 1, total: 1 });
  assert.deepEqual(report.readWebinarReportRows([{ metric: "unique", item: 7, total: "x", students: undefined }]), [{ item: "7", metric: "unique", students: 0, total: 0 }]);
});

test("monta a visao da aba Relatorio: numeros, curva ordenada, quedas, chat, reacoes, perguntas, enquetes, roteiro", () => {
  const view = report.buildWebinarReport(report.readWebinarReportRows(RPC_ROWS));
  assert.deepEqual(view.registration, { absent: 0, attended: 2, cancelled: 0, registered: 2, sources: [{ source: "", total: 1 }, { source: "email", total: 1 }] });
  assert.deepEqual(view.presence.curve, [
    { b: 0, n: 3 },
    { b: 1, n: 3 },
    { b: 2, n: 2 }
  ]);
  assert.deepEqual(view.presence.peak, { b: 0, n: 3 });
  assert.equal(view.presence.unique, 3);
  assert.equal(view.presence.avgPresent, 1);
  assert.deepEqual(view.presence.drops, [
    { b: 2, n: 1 },
    { b: 41, n: 1 },
    { b: 71, n: 1 }
  ]);
  assert.equal(view.presence.watchAvgSeconds, 1730);
  assert.equal(view.presence.watchMaxSeconds, 3600);
  assert.equal(view.presence.reachedEnd, 1);
  assert.deepEqual(view.chat, {
    hot: [
      { score: 100, userId: "b001" },
      { score: 65, userId: "b002" },
      { score: 12, userId: "b003" }
    ],
    perMinute: [{ minute: 0, students: 2, total: 2 }],
    students: 2,
    top: [
      { total: 1, userId: "b001" },
      { total: 1, userId: "b003" }
    ],
    total: 2
  });
  assert.deepEqual(view.reactions, { byType: [{ reaction: "fire", students: 2, total: 2 }], perMinute: [{ minute: 1, reaction: "fire", total: 2 }] });
  assert.deepEqual(view.questions, { answered: 0, dismissed: 0, open: 1, top: [{ questionId: "d1", votes: 2 }] });
  assert.deepEqual(view.polls, [
    { optionId: "b1", pollId: "c1", students: 1, total: 1 },
    { optionId: "b2", pollId: "c1", students: 1, total: 1 }
  ]);
  assert.deepEqual(view.replay, { viewers: 0, watchedPct: 0 });
  assert.deepEqual(view.script, { fired: 2, missed: 0, ready: 2 });
  assert.deepEqual(report.reportUserIds(view), ["b001", "b003", "b002"]);
  const empty = report.buildWebinarReport([]);
  assert.equal(empty.presence.peak, null);
  assert.equal(empty.registration.registered, 0);
});

test("rotulos: balde em mm:ss, tempo assistido, porcentagem e alunos", () => {
  assert.equal(report.bucketLabel(0), "00:00");
  assert.equal(report.bucketLabel(25), "12:30");
  assert.equal(report.bucketLabel(121), "1:00:30");
  assert.equal(report.watchTimeLabel(30), "30 s");
  assert.equal(report.watchTimeLabel(1730), "29 min");
  assert.equal(report.watchTimeLabel(3600), "1 h");
  assert.equal(report.watchTimeLabel(4380), "1 h 13 min");
  assert.equal(report.percentOf(2, 3), 67);
  assert.equal(report.percentOf(1, 0), null);
  assert.equal(report.studentsLabel(0), "ninguém");
  assert.equal(report.studentsLabel(1), "1 aluno");
  assert.equal(report.studentsLabel(12), "12 alunos");
});
