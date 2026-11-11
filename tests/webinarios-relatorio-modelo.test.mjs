import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O relatorio da sessao, a parte pura (docs/30 §3.4 e §4.6): as linhas da RPC lidas sem confiar no formato (bigint
// como texto), a visao montada (as mesmas linhas que a webinar_report devolveu no Postgres local com dados
// sinteticos), os ids para a segunda leitura dos nomes e os rotulos; da fase 4, as linhas da Oferta (offer, offer_revenue),
// das Respostas do Assistente (ai) e do bloco Simulacao (sim_*), que so entram em `simulation` e `script`.

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

// Fase 4 (202610300003 e 202610300004): a Oferta, as Respostas do Assistente e o bloco Simulacao como a RPC devolveu
// na conferencia das migracoes (bigint como texto; uma variante sem compra; duas moedas).
const RPC_V4 = [
  { metric: "offer", item: "seen", total: "4", students: "3" },
  { metric: "offer", item: "clicks", total: 3, students: 2 },
  { metric: "offer", item: "purchases", total: 1, students: 1 },
  { metric: "offer", item: "B:seen", total: 2, students: 2 },
  { metric: "offer", item: "A:seen", total: 1, students: 1 },
  { metric: "offer", item: "B:clicks", total: 2, students: 1 },
  { metric: "offer", item: "B:purchases", total: 1, students: 1 },
  { metric: "offer", item: "Z:seen", total: 9, students: 9 },
  { metric: "offer", item: "B:abriu", total: 9, students: 9 },
  { metric: "offer_revenue", item: "USD", total: 5000, students: 1 },
  { metric: "offer_revenue", item: "BRL", total: "197000", students: "2" },
  { metric: "offer_revenue", item: "reais", total: 1, students: 1 },
  { metric: "ai", item: "replies", total: 5, students: 0 },
  { metric: "ai", item: "avg_seconds", total: 7, students: 4 },
  { metric: "ai", item: "edited", total: 1, students: 0 },
  { metric: "ai", item: "deleted", total: 2, students: 0 },
  { metric: "ai", item: "handoffs", total: 3, students: 0 },
  { metric: "sim_counter", item: "max", total: 240, students: 0 },
  { metric: "sim_joins", item: "shown", total: 18, students: 0 },
  { metric: "sim_sales", item: "shown", total: 2, students: 0 }
];

test("fase 4: a Oferta (sessao, variantes A a D na ordem, receita por moeda), as Respostas do Assistente e o resumo da Simulacao", () => {
  const view = report.buildWebinarReport(report.readWebinarReportRows(RPC_V4));

  assert.equal(view.offer.present, true);
  assert.deepEqual(view.offer.seen, { students: 3, total: 4 });
  assert.deepEqual(view.offer.clicks, { students: 2, total: 3 });
  assert.deepEqual(view.offer.purchases, { students: 1, total: 1 });
  assert.deepEqual(view.offer.variants, [
    { clicks: { students: 0, total: 0 }, label: "A", purchases: { students: 0, total: 0 }, seen: { students: 1, total: 1 } },
    { clicks: { students: 1, total: 2 }, label: "B", purchases: { students: 1, total: 1 }, seen: { students: 2, total: 2 } }
  ], "letra fora de A a D e parte desconhecida ficam de fora");
  assert.deepEqual(view.offer.revenue, [
    { cents: 197000, currency: "BRL", sales: 2 },
    { cents: 5000, currency: "USD", sales: 1 }
  ]);
  assert.deepEqual(view.assistant, { avgSeconds: 7, deleted: 2, edited: 1, handoffs: 3, present: true, replies: 5 });
  assert.deepEqual(view.simulation, { counterMax: 240, joinsShown: 18, saleNoticesShown: 2 });
  assert.equal(view.presence.unique, 0, "nada simulado entra num numero real");

  const sem = report.buildWebinarReport(report.readWebinarReportRows(RPC_ROWS));
  assert.equal(sem.offer.present, false, "sessao sem oferta: o bloco nao aparece");
  assert.equal(sem.assistant.present, false);
  assert.deepEqual(sem.simulation, { counterMax: null, joinsShown: null, saleNoticesShown: null });
  assert.equal(report.buildWebinarReport([{ item: "avg_seconds", metric: "ai", students: 0, total: 0 }]).assistant.avgSeconds, null, "sem resposta respondida, sem media");
});

test("a receita escrita (M8): uma por moeda; sem venda com valor, nulo (a tela e o CSV mostram '—')", () => {
  assert.equal(report.revenueLabel([{ cents: 197000, currency: "BRL", sales: 2 }]).replace(/\s/g, " "), "R$ 1.970,00");
  assert.match(report.revenueLabel([{ cents: 197000, currency: "BRL", sales: 2 }, { cents: 5000, currency: "USD", sales: 1 }]), /R\$\s1\.970,00 · US\$\s50,00/);
  assert.equal(report.revenueLabel([]), null);
  assert.equal(report.revenueLabel([{ cents: 0, currency: "BRL", sales: 0 }]), null);
});

/* ------------------------------------------------------------------------------------------------
 * O bloco "Na tela" (especificacao de 10/11/2026, §7): uma linha por exibicao
 * ---------------------------------------------------------------------------------------------- */

test("o bloco Na tela: o item, quando entrou (antes do início na espera), quanto ficou (sem sair, ate o fim), os numeros e Clicaram ÷ viram; a enquete fixada sem numeros", async () => {
  const pageModel = await import("../src/server/webinars/report-page-model.ts");
  const ZERO = Date.parse("2026-11-10T23:00:00.000Z");
  const FIM = ZERO + 60 * 60_000;
  const quando = (ms) => new Date(ms).toISOString();
  const exibicao = (id, kind, extra = {}) => ({
    createdAt: quando(ZERO),
    hiddenAt: null,
    hiddenBy: null,
    hiddenOffsetMs: null,
    hiddenReason: null,
    id,
    itemId: kind === "poll" ? null : "item",
    kind,
    pollId: kind === "poll" ? "enquete" : null,
    sessionId: "sessao",
    shownAt: quando(ZERO),
    shownBy: null,
    shownOffsetMs: null,
    snapshot: { name: kind === "poll" ? "Qual curso?" : "Turma de novembro", v: 1 },
    ...extra
  });
  const linhas = pageModel.screenReportRows({
    displays: [
      // Fora de ordem: o bloco segue a ordem em que entraram.
      exibicao("qr", "qr", { hiddenAt: quando(ZERO + 15 * 60_000 + 30_000), shownAt: quando(ZERO + 12 * 60_000 + 30_000), shownOffsetMs: 750_000, snapshot: { name: "Inscrição", v: 1 } }),
      exibicao("espera", "banner", { hiddenAt: quando(ZERO + 30_000), shownAt: quando(ZERO - 2 * 60_000), shownOffsetMs: -120_000 }),
      exibicao("ficou", "banner", { shownAt: quando(ZERO + 15 * 60_000) }),
      exibicao("enquete", "poll", { hiddenAt: quando(ZERO + 75 * 60_000), shownAt: quando(ZERO + 5 * 60_000), shownOffsetMs: 300_000 }),
      exibicao("invalida", "banner", { shownAt: quando(ZERO + 70 * 60_000), shownOffsetMs: 4_210_000, snapshot: null })
    ],
    endMs: FIM,
    stats: { espera: { clickers: 41, clicks: 57, closed: 9, shown: 312 }, ficou: { clickers: 0, clicks: 0, closed: 0, shown: 0 }, qr: { clickers: 3, clicks: 3, closed: 1, shown: 8 } },
    zeroMs: ZERO
  });
  assert.deepEqual(
    linhas.map((linha) => [linha.label, linha.enteredAt, linha.stayed, linha.shown, linha.clickers, linha.clicks, linha.closed, linha.rate]),
    [
      ["Banner · Turma de novembro", "antes do início", "3 min", 312, 41, 57, 9, 13],
      ["Enquete fixada · Qual curso?", "05:00", "1 h 10 min", null, null, null, null, null],
      ["QR Code · Inscrição", "12:30", "3 min", 8, 3, 3, 1, 38],
      ["Banner · Turma de novembro", "15:00", "45 min", 0, 0, 0, 0, null],
      ["Banner · —", "1:10:10", "0 s", 0, 0, 0, 0, null]
    ],
    "sem o offset gravado, pelo zero da sessao; sem sair, ate o fim; sem quem viu, a taxa fica nula ('—'); a copia invalida vira '—'"
  );
  assert.deepEqual(linhas.map((linha) => linha.kind), ["banner", "poll", "qr", "banner", "banner"]);
  assert.equal(pageModel.screenEnteredLabel(null), "—");
  assert.equal(pageModel.screenEnteredLabel(-1), "antes do início");
  assert.equal(pageModel.screenEnteredLabel(0), "00:00");
  assert.equal(pageModel.screenEnteredLabel(3_725_000), "1:02:05");
  assert.deepEqual(pageModel.screenReportRows({ displays: [], endMs: FIM, stats: {}, zeroMs: ZERO }), []);
});
