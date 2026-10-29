import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { sessaoRow, webinarRow } from "./support/webinarios-banco-falso.mjs";

// Os paineis "Lives ao vivo" e "Lives gravadas", a parte pura (docs/30 §3.1 a §3.3, §3.5 e §3.6; D6, D10, M2, M6, M8):
// cada cartao e o delta contra o periodo anterior com numeros feitos a mao, o Comparecimento so com Garantir vaga, o
// pico (media dos picos com mais de uma live), a retencao media (cada sessao normalizada), a conversao, a receita por
// moeda, o horario de Sao Paulo, os filtros do endereco que viram o recorte de sessoes, a curva da sessao com a janela
// da oferta, a tabela e o bloco Simulacao. E a guarda: nenhuma funcao de cartao, grafico, filtro ou tabela le uma
// metrica `sim_*` (so panelSimulationOf), e linhas `sim_*` enormes nao mudam nenhum numero real.

const model = await import("../src/server/webinars/panel-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const exportModel = await import("../src/server/webinars/export-model.ts");

const W_IA = "aaaaaaaa-0000-4000-8000-000000000001";
const W_PAPO = "aaaaaaaa-0000-4000-8000-000000000002";
const W_CANCELADA = "aaaaaaaa-0000-4000-8000-000000000003";
const W_GRAVADA = "aaaaaaaa-0000-4000-8000-000000000004";
const HOST_ANA = "bbbbbbbb-0000-4000-8000-000000000001";
const HOST_BETO = "bbbbbbbb-0000-4000-8000-000000000002";
const S1 = "cccccccc-0000-4000-8000-000000000001";
const S2 = "cccccccc-0000-4000-8000-000000000002";
const S3 = "cccccccc-0000-4000-8000-000000000003";
const P1 = "cccccccc-0000-4000-8000-000000000009";
const R1 = "dddddddd-0000-4000-8000-000000000001";
const R2 = "dddddddd-0000-4000-8000-000000000002";
const R3 = "dddddddd-0000-4000-8000-000000000003";

const row = (sessionId, metric, total, extra = {}) => ({ item: "", metric, sessionId, students: total, total, ...extra });
const unique = (metric, total) => row(null, metric, total);

/* As lives ao vivo do periodo: S1 (Aula de IA, Garantir vaga, encerrada), S2 (Bate-papo, sem Garantir vaga,
   encerrada) e S3 (cancelada). P1 e a live do periodo anterior. */
const webinars = [
  webinarRow({ host_user_id: HOST_ANA, id: W_IA, kind: "live", product_id: "prod-ia", registration_required: true, slug: "aula-de-ia", title: "Aula de IA" }),
  webinarRow({ host_user_id: HOST_BETO, id: W_PAPO, kind: "live", product_id: null, registration_required: false, slug: "bate-papo", title: "Bate-papo" }),
  webinarRow({ host_user_id: HOST_ANA, id: W_CANCELADA, kind: "live", product_id: "prod-ia", slug: "cancelada", title: "Cancelada" }),
  webinarRow({ host_user_id: HOST_ANA, id: W_GRAVADA, kind: "simulated", product_id: "prod-ia", slug: "live-de-agentes", title: "Live de agentes" })
];
const liveRows = [
  sessaoRow({ ended_at: "2026-10-11T00:05:00.000Z", id: S1, kind: "live", scheduled_at: "2026-10-10T23:00:00.000Z", started_at: "2026-10-10T23:01:00.000Z", status: "ended", webinar_id: W_IA }),
  sessaoRow({ ended_at: "2026-10-20T13:40:00.000Z", id: S2, kind: "live", scheduled_at: "2026-10-20T13:00:00.000Z", started_at: "2026-10-20T13:02:00.000Z", status: "ended", webinar_id: W_PAPO }),
  sessaoRow({ id: S3, kind: "live", scheduled_at: "2026-10-25T23:00:00.000Z", status: "cancelled", webinar_id: W_CANCELADA })
];
const previousRows = [sessaoRow({ ended_at: "2026-09-20T00:00:00.000Z", id: P1, kind: "live", scheduled_at: "2026-09-19T23:00:00.000Z", status: "ended", webinar_id: W_IA })];

const POINTS = Array.from({ length: 21 }, (_, index) => index * 5);
const retention = (sessionId, base, nAt) => POINTS.map((pct) => ({ item: String(pct), metric: "retention", sessionId, students: base, total: nAt(pct) }));

/** As linhas da RPC do periodo atual (Lives ao vivo), mais um bloco sim_* enorme que nao pode mexer em nada. */
const LIVE_RPC = [
  row(S1, "duration", 3_600_000, { students: 0 }),
  row(S1, "registered", 10),
  row(S1, "present", 8),
  row(S1, "attended_registered", 6),
  row(S1, "watch_sum", 14_400, { students: 8 }),
  row(S1, "watch_max", 3_600, { students: 8 }),
  row(S1, "reached_end", 4),
  row(S1, "peak", 7, { item: "20" }),
  row(S1, "messages", 12, { students: 5 }),
  row(S1, "question", 3, { item: "answered" }),
  row(S1, "question", 1, { item: "open" }),
  row(S1, "question", 1, { item: "dismissed" }),
  row(S1, "reactions", 9),
  row(S1, "poll_answers", 4),
  row(S1, "replay_viewers", 3),
  ...retention(S1, 8, (pct) => (pct === 0 ? 8 : pct <= 50 ? 6 : 4)),
  row(S2, "duration", 1_800_000, { students: 0 }),
  row(S2, "registered", 4),
  row(S2, "present", 2),
  row(S2, "attended_registered", 1),
  row(S2, "watch_sum", 1_200, { students: 2 }),
  row(S2, "reached_end", 1),
  row(S2, "peak", 3, { item: "3" }),
  row(S2, "messages", 3, { students: 2 }),
  row(S2, "question", 1, { item: "answered" }),
  ...retention(S2, 2, (pct) => (pct === 0 ? 2 : pct <= 50 ? 1 : 0)),
  unique("unique_present", 9),
  unique("unique_registered", 13),
  unique("unique_attended_registered", 7),
  unique("unique_reached_end", 5),
  unique("unique_replay_viewers", 3),
  unique("unique_visitors", 11),
  unique("unique_commenters", 6)
];
const SIM_NOISE = [
  { item: "max", metric: "sim_counter", sessionId: S1, students: 0, total: 99_999 },
  { item: "shown", metric: "sim_joins", sessionId: S1, students: 0, total: 99_999 },
  { item: "shown", metric: "sim_sales", sessionId: S1, students: 0, total: 99_999 },
  { item: "fired", metric: "sim_script", sessionId: S1, students: 0, total: 99_999 }
];
const PREVIOUS_RPC = [
  row(P1, "duration", 3_600_000, { students: 0 }),
  row(P1, "registered", 5),
  row(P1, "present", 4),
  row(P1, "attended_registered", 2),
  row(P1, "watch_sum", 4_800, { students: 4 }),
  row(P1, "peak", 4, { item: "10" }),
  row(P1, "messages", 5, { students: 3 }),
  row(P1, "question", 1, { item: "answered" }),
  row(P1, "question", 1, { item: "open" }),
  unique("unique_present", 4),
  unique("unique_reached_end", 1),
  unique("unique_replay_viewers", 0)
];

const emptyFilters = () => model.emptyPanelFilters();
const allLive = () => model.panelSessionsOf(liveRows, webinars);
const kpi = (kpis, id) => kpis.find((entry) => entry.id === id);

function liveView(extra = {}) {
  const sessions = allLive();
  const selected = model.filterPanelSessions(sessions, emptyFilters(), null);
  const previousSessions = model.panelSessionsOf(previousRows, webinars);

  return model.buildPanelView({
    everHadSessions: true,
    filters: emptyFilters(),
    hostNames: { [HOST_ANA]: "Ana Equipe", [HOST_BETO]: "Beto Equipe" },
    kind: "live",
    offers: null,
    previousRows: PREVIOUS_RPC,
    previousSelected: previousSessions,
    productNames: { "prod-ia": "Formação em IA" },
    rows: [...LIVE_RPC, ...SIM_NOISE],
    selected,
    sessionParam: null,
    sessions,
    simulations: null,
    window: { end: "2026-10-29T15:01:00.000Z", start: "2026-09-30T03:00:00.000Z" },
    ...extra
  });
}

test("Lives ao vivo: os dez cartoes com numeros feitos a mao e o delta contra o periodo anterior", () => {
  const view = liveView();
  const values = Object.fromEntries(view.kpis.map((entry) => [entry.id, entry.value]));

  assert.deepEqual(view.kpis.map((entry) => entry.label), [
    "Lives realizadas",
    "Vagas garantidas",
    "Presentes",
    "Comparecimento",
    "Pico de presentes",
    "Tempo médio assistido",
    "Viram até o fim",
    "Mensagens",
    "Perguntas respondidas",
    "Viram o replay"
  ]);
  assert.deepEqual(values, {
    attendance: 60, // so a Aula de IA tem Garantir vaga: 6 de 10 (com o Bate-papo seria 7 de 14 = 50 %)
    messages: 15,
    peak: 5, // media dos picos 7 e 3
    present: 9, // unique_present (um aluno nas duas lives conta uma vez)
    questionsAnswered: 66.7, // 4 respondidas de 6 feitas
    reachedEnd: 55.6, // 5 de 9
    realized: 2, // a cancelada fica de fora
    registered: 14,
    replayViewers: 3,
    watchAvg: 26 // (14400 + 1200) s ÷ 10 presentes = 1560 s
  });

  const deltas = Object.fromEntries(view.kpis.map((entry) => [entry.id, [entry.delta, entry.deltaUnit]]));
  assert.deepEqual(deltas, {
    attendance: [20, "points"], // 60 % contra 40 %
    messages: [200, "percent"], // 15 contra 5
    peak: [25, "percent"], // 5 contra 4
    present: [125, "percent"], // 9 contra 4
    questionsAnswered: [16.7, "points"], // 66,7 % contra 50 %
    reachedEnd: [30.6, "points"], // 55,6 % contra 25 %
    realized: [100, "percent"],
    registered: [180, "percent"], // 14 contra 5
    replayViewers: [null, "percent"], // o anterior e zero: sem delta
    watchAvg: [30, "percent"] // 26 min contra 20 min
  });
  assert.equal(kpi(view.kpis, "peak").definition, WEBINAR_COPY.paineis.rodapes.picoMedia, "com mais de uma live, o rodape diz que e a media");
  assert.equal(kpi(view.kpis, "attendance").definition, "Comparecimento: só webinários com Garantir vaga");
  assert.equal(kpi(view.kpis, "questionsAnswered").definition, null, "Perguntas respondidas sem rodape");
  assert.ok(view.kpis.every((entry) => entry.text === null), "nenhum cartao de texto na live");
});

test("sem periodo anterior com sessoes, nenhum delta; uma live so: o pico e o dela", () => {
  const sessions = allLive();
  const only = sessions.filter((session) => session.id === S1);
  const view = liveView({ previousRows: [], previousSelected: [], selected: only });

  assert.ok(view.kpis.every((entry) => entry.delta === null));
  assert.equal(kpi(view.kpis, "peak").value, 7);
  assert.equal(kpi(view.kpis, "peak").definition, "no melhor momento");
  assert.equal(model.panelPeakOf([]), null);
  assert.equal(model.panelPercentDelta(10, 0), null, "de 0 para 10 nao e +∞ %");
  assert.equal(model.panelPointsDelta(41, 39), 2);
});

test("Vagas garantidas e Comparecimento so das lives realizadas: a de hoje que ainda espera (e a que esta no ar) fica fora", () => {
  const S4 = "cccccccc-0000-4000-8000-000000000004";
  const S5 = "cccccccc-0000-4000-8000-000000000005";
  const rows = [
    sessaoRow({ ended_at: "2026-10-11T00:05:00.000Z", id: S1, kind: "live", scheduled_at: "2026-10-10T23:00:00.000Z", started_at: "2026-10-10T23:01:00.000Z", status: "ended", webinar_id: W_IA }),
    // A live de hoje as 20:00 que ainda nao comecou as 20:05 (scheduled no passado) e uma no ar.
    sessaoRow({ id: S4, kind: "live", scheduled_at: "2026-10-28T23:00:00.000Z", status: "scheduled", webinar_id: W_IA }),
    sessaoRow({ id: S5, kind: "live", scheduled_at: "2026-10-28T22:00:00.000Z", started_at: "2026-10-28T22:01:00.000Z", status: "live", webinar_id: W_IA })
  ];
  const sessions = model.panelSessionsOf(rows, webinars);
  const selected = model.filterPanelSessions(sessions, emptyFilters(), null);
  assert.equal(selected.length, 3, "a tabela e o filtro continuam com todas");
  const view = liveView({
    previousRows: [],
    previousSelected: [],
    rows: [row(S1, "registered", 100), row(S1, "attended_registered", 50), row(S1, "present", 50), row(S4, "registered", 200), row(S5, "registered", 40), row(S5, "attended_registered", 10)],
    selected,
    sessions
  });
  const values = Object.fromEntries(view.kpis.map((entry) => [entry.id, entry.value]));
  assert.equal(values.realized, 1);
  assert.equal(values.registered, 100, "as 200 vagas da live que nem comecou nao entram");
  assert.equal(values.attendance, 50, "50 de 100, nao 16,7 %");
});

test("retencao media: cada sessao normalizada pelos proprios unicos, media ponto a ponto, uma linha fina por sessao ate 5", () => {
  const view = liveView();
  const chart = view.retention;
  const at = (pct) => chart.average.find((point) => point.pct === pct).value;

  assert.equal(chart.average.length, 21);
  assert.equal(chart.sessions, 2);
  assert.equal(at(0), 100); // 8/8 e 2/2
  assert.equal(at(50), 62.5); // 6/8 = 75 e 1/2 = 50
  assert.equal(at(100), 25); // 4/8 = 50 e 0/2 = 0
  assert.equal(chart.lines.length, 2);
  assert.match(chart.lines[0].label, /Aula de IA · 10\/10\/2026 às 20:00/);
  assert.deepEqual(chart.lines[1].points.slice(0, 2), [{ pct: 0, value: 100 }, { pct: 5, value: 50 }]);

  // Seis sessoes: so a media (sem linhas finas).
  const many = Array.from({ length: 6 }, (_, index) => `eeeeeeee-0000-4000-8000-00000000000${index}`);
  const snapshot = {
    offersAvailable: false,
    period: model.panelPeriodStatsOf([]),
    sessions: many.map((id) => ({ ...allLive()[0], id })),
    stats: model.panelSessionStatsOf(many.flatMap((id) => retention(id, 4, () => 2)))
  };
  const six = model.retentionChartOf(snapshot);
  assert.equal(six.lines.length, 0);
  assert.equal(six.average[3].value, 50);
  assert.equal(model.retentionChartOf({ ...snapshot, stats: new Map() }), null, "sem ninguem presente, sem grafico");
});

test("graficos da live: Vagas × Presentes × Replay e Lives ao longo do tempo, na ordem das datas", () => {
  const view = liveView();

  assert.deepEqual(
    view.tripleBars.map((bar) => [bar.label, bar.registered, bar.present, bar.replay]),
    [
      ["10/10", 10, 8, 3],
      ["20/10", 4, 2, 0]
    ]
  );
  assert.deepEqual(
    view.overTime.map((point) => [point.label, point.present, point.reachedEndPct]),
    [
      ["10/10", 8, 50],
      ["20/10", 2, 50]
    ]
  );
  assert.deepEqual(view.byHour, [], "Por horario do dia e da gravada");
  assert.equal(view.variants, null);
  assert.equal(view.simulation, null, "o bloco Simulacao so na gravada");
});

test("tabela 'Lives do período': as colunas da especificacao, a mais recente primeiro, o produto e o link do Relatorio", () => {
  const view = liveView();

  assert.deepEqual(model.panelTableColumns("live"), [
    "live",
    "produto",
    "data",
    "vagasGarantidas",
    "presentes",
    "comparecimento",
    "pico",
    "tempoMedio",
    "ateOFim",
    "mensagens",
    "perguntas",
    "replay"
  ]);
  assert.equal(view.table.total, 2);
  const [latest, first] = view.table.rows;
  assert.equal(latest.id, S2);
  assert.deepEqual(latest.values, {
    ateOFim: "50%",
    comparecimento: "—", // Bate-papo nao pede vaga
    data: "20/10/2026 às 10:00",
    live: "Bate-papo",
    mensagens: "3",
    perguntas: "1 de 1",
    pico: "3",
    presentes: "2",
    produto: "—",
    replay: "0",
    tempoMedio: "10 min",
    vagasGarantidas: "4"
  });
  assert.equal(first.values.produto, "Formação em IA");
  assert.equal(first.values.comparecimento, "60%");
  assert.equal(first.values.tempoMedio, "30 min");
  assert.equal(first.values.perguntas, "3 de 5");
  assert.equal(first.reportHref, `/admin/comunicacao/webinarios/${W_IA}/relatorio?sessao=${S1}`);
});

/* ------------------------------------------------------------------------------------------------
 * Lives gravadas
 * ---------------------------------------------------------------------------------------------- */

const recordedRows = [
  sessaoRow({ ended_at: "2026-10-11T00:00:00.000Z", id: R1, scheduled_at: "2026-10-10T23:00:00.000Z", show_live_badge: true, status: "ended", webinar_id: W_GRAVADA }),
  sessaoRow({ ended_at: "2026-10-12T00:00:00.000Z", id: R2, scheduled_at: "2026-10-11T23:00:00.000Z", status: "ended", webinar_id: W_GRAVADA }),
  sessaoRow({ ended_at: "2026-10-12T14:00:00.000Z", id: R3, jit: true, scheduled_at: "2026-10-12T13:00:00.000Z", show_live_badge: true, status: "ended", webinar_id: W_GRAVADA })
];
const RECORDED_RPC = [
  row(R1, "duration", 1_800_000, { students: 0 }),
  row(R1, "present", 10),
  row(R1, "visitors", 12),
  row(R1, "watch_sum", 15_000, { students: 10 }),
  row(R1, "reached_end", 5),
  row(R1, "offer_seen", 8),
  row(R1, "offer_clicks", 5, { students: 4 }),
  row(R1, "offer_purchases", 2, { students: 2 }),
  row(R1, "offer_variant", 5, { item: "A:seen" }),
  row(R1, "offer_variant", 3, { item: "B:seen" }),
  row(R1, "offer_variant", 3, { item: "A:clicks" }),
  row(R1, "offer_variant", 1, { item: "B:clicks" }),
  row(R1, "offer_variant", 2, { item: "A:purchases" }),
  row(R1, "offer_revenue", 39_400, { item: "BRL", students: 2 }),
  row(R2, "duration", 1_800_000, { students: 0 }),
  row(R2, "present", 6),
  row(R2, "visitors", 8),
  row(R2, "watch_sum", 6_000, { students: 6 }),
  row(R2, "reached_end", 2),
  row(R2, "offer_seen", 5),
  row(R2, "offer_clicks", 3),
  row(R2, "offer_purchases", 1),
  row(R2, "offer_variant", 3, { item: "A:seen" }),
  row(R2, "offer_variant", 2, { item: "B:seen" }),
  row(R2, "offer_variant", 2, { item: "A:clicks" }),
  row(R2, "offer_variant", 1, { item: "B:clicks" }),
  row(R2, "offer_variant", 1, { item: "B:purchases" }),
  row(R2, "offer_revenue", 19_700, { item: "BRL", students: 1 }),
  row(R2, "offer_revenue", 2_000, { item: "USD", students: 1 }),
  row(R3, "duration", 1_800_000, { students: 0 }),
  row(R3, "present", 4),
  row(R3, "visitors", 4),
  row(R3, "watch_sum", 2_400, { students: 4 }),
  row(R3, "reached_end", 1),
  unique("unique_present", 18),
  unique("unique_visitors", 22),
  unique("unique_reached_end", 8),
  unique("unique_offer_seen", 12),
  unique("unique_clickers", 7),
  unique("unique_buyers", 3),
  { item: "max", metric: "sim_counter", sessionId: R1, students: 0, total: 900 },
  { item: "shown", metric: "sim_joins", sessionId: R1, students: 0, total: 30 },
  { item: "shown", metric: "sim_sales", sessionId: R1, students: 0, total: 4 },
  { item: "fired", metric: "sim_script", sessionId: R1, students: 0, total: 12 },
  { item: "max", metric: "sim_counter", sessionId: R2, students: 0, total: 500 },
  { item: "shown", metric: "sim_joins", sessionId: R2, students: 0, total: 10 },
  { item: "shown", metric: "sim_sales", sessionId: R2, students: 0, total: 2 }
];
const SIMULATIONS = [
  { countRule: { base: 50, jitter: 0, mode: "fixed", peak: 0 }, joins: { enabled: true, everySeconds: 60, max: 30, names: "generic" }, saleNotices: { enabled: true, items: [] }, seed: 1, sessionId: R1, summary: null },
  { countRule: { base: 20, jitter: 5, mode: "curve", peak: 300 }, joins: { enabled: false, everySeconds: 60, max: 30, names: "generic" }, saleNotices: { enabled: false, items: [] }, seed: 2, sessionId: R2, summary: null },
  { countRule: { base: 0, jitter: 0, mode: "off", peak: 0 }, joins: { enabled: false, everySeconds: 60, max: 30, names: "generic" }, saleNotices: { enabled: false, items: [] }, seed: 3, sessionId: R3, summary: null }
];
const offerFacts = () =>
  model.panelOfferFactsOf(
    [{ id: "offer-1", status: "active", variants: [{ enabled: true, label: "A" }, { enabled: true, label: "B" }, { enabled: false, label: "C" }], webinarId: W_GRAVADA }],
    [
      { hide_offset_ms: null, session_id: R1, show_offset_ms: 900_000, snapshot: { capturedAt: "2026-10-10T23:15:00.000Z", deadlineAt: null, variants: [{ badge: null, coupon: null, headline: "Oferta", label: "A", priceFromLabel: null, priceLabel: null }] } },
      { hide_offset_ms: 1_500_000, session_id: R2, show_offset_ms: 900_000, snapshot: null }
    ]
  );

function recordedView(extra = {}) {
  const sessions = model.panelSessionsOf(recordedRows, webinars);

  return model.buildPanelView({
    everHadSessions: true,
    filters: emptyFilters(),
    hostNames: {},
    kind: "simulated",
    offers: offerFacts(),
    previousRows: [],
    previousSelected: [],
    productNames: { "prod-ia": "Formação em IA" },
    rows: RECORDED_RPC,
    selected: sessions,
    sessionParam: null,
    sessions,
    simulations: SIMULATIONS,
    window: { end: "2026-10-29T15:01:00.000Z", start: "2026-09-30T03:00:00.000Z" },
    ...extra
  });
}

test("Lives gravadas: os dez cartoes, a conversao (compras ÷ participantes) e a receita por moeda", () => {
  const view = recordedView();
  const values = Object.fromEntries(view.kpis.map((entry) => [entry.id, entry.value]));

  assert.deepEqual(view.kpis.map((entry) => entry.label), [
    "Sessões realizadas",
    "Visitantes",
    "Participantes",
    "Tempo médio assistido",
    "Viram até o fim",
    "Viram a oferta",
    "Cliques na oferta",
    "Compras",
    "Conversão",
    "Receita"
  ]);
  assert.deepEqual(values, {
    buyers: 3,
    clickers: 7,
    conversion: 16.7, // 3 de 18
    offerSeen: 12,
    participants: 18,
    reachedEnd: 44.4, // 8 de 18
    realized: 3,
    revenue: null,
    visitors: 22,
    watchAvg: 20 // 23400 s ÷ 20 presentes = 1170 s = 19,5 min
  });
  const revenue = kpi(view.kpis, "revenue");
  assert.match(revenue.text, /^R\$\s591,00 · US\$\s20,00$/, "uma soma por moeda, o real primeiro");
  assert.equal(revenue.delta, null);
  assert.equal(model.formatPanelRevenue({}), "—", "sem venda com valor: '—' (M8)");
  assert.equal(model.formatPanelRevenue({ BRL: 0 }), "—");
});

test("Lives gravadas sem a 202610300003: Oferta, Conversao e Receita em '—'; o resto segue", () => {
  const view = recordedView({ offers: null, simulations: null });

  for (const id of ["offerSeen", "clickers", "buyers", "conversion"]) {
    assert.equal(kpi(view.kpis, id).value, null, id);
  }
  assert.equal(kpi(view.kpis, "revenue").text, "—");
  assert.equal(kpi(view.kpis, "revenue").definition, WEBINAR_COPY.paineis.formulas.receitaAMedir);
  assert.equal(kpi(view.kpis, "participants").value, 18);
  assert.equal(view.variants, null);
  assert.ok(view.byHour.every((hour) => hour.conversion === null));
  assert.equal(view.offersAvailable, false);
  assert.deepEqual(
    [view.simulation.available, view.simulation.counterMax, view.simulation.joinsShown, view.simulation.saleNoticesShown, view.simulation.scriptFired],
    [false, null, null, null, null],
    "o bloco Simulacao em '—'"
  );
  assert.ok(view.table.rows.every((entry) => entry.values.viramAOferta === "—" && entry.values.conversao === "—"));
});

test("Por horario do dia (Sao Paulo) e Oferta por variante (A/B/C/D)", () => {
  const view = recordedView();

  assert.equal(model.saoPauloHourOf("2026-10-10T23:00:00.000Z"), 20);
  assert.equal(model.saoPauloHourOf("2026-10-12T13:00:00.000Z"), 10);
  assert.deepEqual(
    view.byHour.map((hour) => [hour.label, hour.sessions, hour.participants, hour.conversion]),
    [
      ["10h", 1, 4, 0],
      ["20h", 2, 16, 18.8] // 3 compras de 16 participantes
    ]
  );
  assert.deepEqual(
    view.variants.map((variant) => [variant.label, variant.seen, variant.clicks, variant.purchases, variant.conversion]),
    [
      ["A", 8, 5, 2, 25],
      ["B", 5, 2, 1, 20]
    ]
  );
  assert.deepEqual(view.tripleBars, []);
  assert.deepEqual(view.overTime, []);
});

test("tabela 'Sessões do período': colunas da gravada, conversao por sessao e o selo do Começa quando você entra", () => {
  const view = recordedView();

  assert.deepEqual(model.panelTableColumns("simulated"), ["webinario", "produto", "horario", "visitantes", "participantes", "tempoMedio", "ateOFim", "viramAOferta", "cliques", "compras", "conversao"]);
  const [jit, r2, r1] = view.table.rows;
  assert.equal(jit.id, R3);
  assert.equal(jit.jit, true);
  assert.equal(r2.jit, false);
  assert.deepEqual(r1.values, {
    ateOFim: "50%",
    cliques: "4",
    compras: "2",
    conversao: "20%",
    horario: "10/10/2026 às 20:00",
    participantes: "10",
    produto: "Formação em IA",
    tempoMedio: "25 min",
    viramAOferta: "8",
    visitantes: "12",
    webinario: "Live de agentes"
  });
});

test("bloco Simulacao: so as linhas sim_* e as regras; o numero real ao lado; o selo pelas sessoes", () => {
  const view = recordedView();

  assert.deepEqual(view.simulation, {
    available: true,
    badge: { on: 2, total: 3 },
    counterMax: 900,
    joinsShown: 40,
    realParticipants: 18,
    rules: ["Real + 50", "Real + de 20 a 300"],
    saleNoticesShown: 6,
    scriptFired: 12
  });

  const filtered = model.panelSimulationOf({ realParticipants: 4, rows: RECORDED_RPC, sessions: model.panelSessionsOf(recordedRows, webinars).filter((session) => session.id === R3), simulations: SIMULATIONS });
  assert.deepEqual([filtered.counterMax, filtered.joinsShown, filtered.scriptFired, filtered.rules], [null, 0, 0, []], "so as sessoes do recorte");
});

/* ------------------------------------------------------------------------------------------------
 * A guarda (D6, D10, M6): nenhum numero real le sim_*
 * ---------------------------------------------------------------------------------------------- */

test("guarda: linhas sim_* enormes nao mudam nenhum cartao, grafico ou linha da tabela", () => {
  const clean = liveView({ rows: LIVE_RPC });
  const noisy = liveView({ rows: [...LIVE_RPC, ...SIM_NOISE] });

  assert.deepEqual(noisy.kpis, clean.kpis);
  assert.deepEqual(noisy.retention, clean.retention);
  assert.deepEqual(noisy.tripleBars, clean.tripleBars);
  assert.deepEqual(noisy.overTime, clean.overTime);
  assert.deepEqual(noisy.table, clean.table);

  const realRecorded = recordedView({ rows: RECORDED_RPC.filter((entry) => !entry.metric.startsWith("sim_")) });
  const withSim = recordedView();
  assert.deepEqual(withSim.kpis, realRecorded.kpis);
  assert.deepEqual(withSim.byHour, realRecorded.byHour);
  assert.deepEqual(withSim.variants, realRecorded.variants);
  assert.deepEqual(withSim.table, realRecorded.table);
  assert.notDeepEqual(withSim.simulation, realRecorded.simulation, "so o bloco Simulacao muda");
});

test("guarda: varre panel-model.ts e so panelSimulationOf le metricas sim_* (nem cartao, nem grafico, nem filtro, nem tabela)", () => {
  const source = readFileSync(new URL("../src/server/webinars/panel-model.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const declarations = [...code.matchAll(/^(?:export )?function (\w+)\s*(?:<[^>]*>)?\(/gm)];
  assert.ok(declarations.length > 30, `achou as funcoes (${declarations.length})`);

  const bodies = declarations.map((match, index) => ({ body: code.slice(match.index, declarations[index + 1]?.index ?? code.length), name: match[1] }));
  const readers = bodies.filter((entry) => /["'`]sim_|SIMULATION_METRICS/.test(entry.body)).map((entry) => entry.name);
  assert.deepEqual(readers, ["panelSimulationOf"]);

  for (const name of [
    "panelSessionStatsOf",
    "panelPeriodStatsOf",
    "panelKpisOf",
    "retentionChartOf",
    "tripleBarsOf",
    "overTimeOf",
    "byHourOfDayOf",
    "offerByVariantOf",
    "panelTableOf",
    "filterPanelSessions",
    "panelFilterOptionsOf",
    "panelListNumbersOf"
  ]) {
    const entry = bodies.find((candidate) => candidate.name === name);
    assert.ok(entry, name);
    assert.doesNotMatch(entry.body, /sim_|SIMULATION_METRICS|panelSimulationOf/, `${name} nao le a Simulacao`);
  }

  // As colunas de simulacao da sessao (simulated_*, simulation_summary) nunca sao lidas aqui.
  assert.doesNotMatch(code, /simulated_|simulation_summary/);
  assert.deepEqual([...model.panelSessionStatsOf(SIM_NOISE).values()].map((stats) => stats.present), [0]);
  assert.equal(model.panelPeriodStatsOf(SIM_NOISE).present, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Filtros, recorte e janela
 * ---------------------------------------------------------------------------------------------- */

test("filtros do endereco: cada aba so le os seus; valor ruim vira 'sem filtro'; o caminho de volta e o href", () => {
  const params = {
    apresentador: HOST_ANA,
    hora: "20",
    "com-oferta": "sim",
    periodo: "7d",
    produto: "prod-ia",
    situacao: "realizadas",
    variante: "b",
    webinario: W_GRAVADA
  };
  const live = model.readPanelFilters("live", params);
  assert.deepEqual(live, { hostUserId: HOST_ANA, hour: null, productId: "prod-ia", situation: "realized", variant: null, webinarId: null, withOffer: false });
  const recorded = model.readPanelFilters("simulated", params);
  assert.deepEqual(recorded, { hostUserId: null, hour: 20, productId: "prod-ia", situation: null, variant: "B", webinarId: W_GRAVADA, withOffer: true });

  const bad = model.readPanelFilters("simulated", { apresentador: "x", hora: "25", produto: "não vale!", situacao: "cancelado", variante: "E", webinario: "abc" });
  assert.deepEqual(bad, model.emptyPanelFilters());
  assert.equal(model.readPanelFilters("live", { situacao: "cancelado" }).situation, null, "o valor da lista (singular) nao vale no painel");
  assert.equal(model.hasPanelFilters("live", model.emptyPanelFilters()), false);
  assert.equal(model.hasPanelFilters("simulated", recorded), true);

  assert.deepEqual(model.panelFilterParams("simulated", recorded), { "com-oferta": "1", hora: "20", produto: "prod-ia", variante: "B", webinario: W_GRAVADA }, "os mesmos nomes que o CSV do painel le");
  assert.deepEqual(model.panelFilterParams("live", recorded), { produto: "prod-ia" }, "so os filtros da aba");
  assert.equal(
    model.panelHref({ filters: live, kind: "live", periodo: "7d", sessionId: S1 }),
    `/admin/comunicacao/webinarios?aba=ao-vivo&situacao=realizadas&apresentador=${HOST_ANA}&produto=prod-ia&sessao=${S1}&periodo=7d`
  );
  assert.equal(model.panelHref({ filters: {}, kind: "simulated", periodo: null }), "/admin/comunicacao/webinarios?aba=gravadas");
  // O CSV do painel (export-model.ts, da frente das exportacoes) le os mesmos parametros e chega aos mesmos filtros.
  for (const [kind, filters] of [["live", live], ["simulated", recorded]]) {
    assert.deepEqual(exportModel.panelFiltersFromParams(new URLSearchParams(model.panelFilterParams(kind, filters))), filters, kind);
  }
  assert.equal(model.readPanelSessionParam({ sessao: S1.toUpperCase() }), S1);
  assert.equal(model.readPanelSessionParam({ sessao: "1; drop" }), null);
});

test("recorte: sem Situacao as canceladas saem; Situacao, Apresentador, Produto, Horario, Com oferta e Variante viram ids", () => {
  const sessions = allLive();
  const ids = (filters, offers = null) => model.filterPanelSessions(sessions, { ...model.emptyPanelFilters(), ...filters }, offers).map((session) => session.id);

  assert.deepEqual(ids({}), [S1, S2]);
  assert.deepEqual(ids({ situation: "cancelled" }), [S3]);
  assert.deepEqual(ids({ situation: "scheduled" }), []);
  assert.deepEqual(ids({ hostUserId: HOST_BETO }), [S2]);
  assert.deepEqual(ids({ productId: "prod-ia" }), [S1]);
  assert.deepEqual(ids({ hour: 10 }), [S2], "10:00 em Sao Paulo (13:00 UTC)");
  assert.deepEqual(ids({ withOffer: true }), [], "sem a 202610300003, Com oferta nao casa com nada");

  const recorded = model.panelSessionsOf(recordedRows, webinars);
  const facts = offerFacts();
  const recordedIds = (filters) => model.filterPanelSessions(recorded, { ...model.emptyPanelFilters(), ...filters }, facts).map((session) => session.id);
  assert.deepEqual(recordedIds({ withOffer: true }), [R1, R2, R3], "o webinario tem Oferta");
  assert.deepEqual(recordedIds({ variant: "A" }), [R1, R2, R3]);
  assert.deepEqual(recordedIds({ variant: "B" }), [R2, R3], "R1 mostrou so a A (a foto vale mais que a Oferta)");
  assert.deepEqual(recordedIds({ variant: "C" }), [], "C esta desligada");

  // Oferta em rascunho ou com "Quando aparece: nunca" nao aparece para o aluno: so conta a sessao que mostrou.
  for (const offer of [{ status: "draft", triggerKind: "at_offset" }, { status: "active", triggerKind: "never" }]) {
    const facts = model.panelOfferFactsOf([{ id: "o", variants: [{ enabled: true, label: "A" }], webinarId: W_GRAVADA, ...offer }], [{ hide_offset_ms: null, session_id: R2, show_offset_ms: 0, snapshot: null }]);
    assert.equal(facts.byWebinar.size, 0, offer.status);
    assert.deepEqual(model.filterPanelSessions(recorded, { ...model.emptyPanelFilters(), withOffer: true }, facts).map((session) => session.id), [R2]);
  }

  assert.equal(model.panelSessionIdsFor(sessions, sessions), null, "o periodo inteiro: sem lista na RPC");
  assert.deepEqual(model.panelSessionIdsFor([sessions[1], sessions[0]], sessions), [S1, S2].sort());
});

test("opcoes dos filtros: das sessoes do periodo, com nome da equipe e do produto; vazios", () => {
  const view = liveView();

  assert.deepEqual(view.filterOptions.hosts, [
    { id: HOST_ANA, label: "Ana Equipe" },
    { id: HOST_BETO, label: "Beto Equipe" }
  ]);
  assert.deepEqual(view.filterOptions.products, [{ id: "prod-ia", label: "Formação em IA" }]);
  assert.equal(view.filterOptions.withOffer, false);
  const recorded = recordedView();
  assert.deepEqual(recorded.filterOptions.variants, ["A", "B"]);
  assert.deepEqual(recorded.filterOptions.hours, [10, 20]);
  assert.equal(recorded.filterOptions.withOffer, true);

  assert.equal(liveView({ selected: [], sessions: [], everHadSessions: false }).empty, "never");
  assert.equal(liveView({ selected: [], sessions: [], everHadSessions: true }).empty, "period");
  assert.equal(liveView({ filters: { ...model.emptyPanelFilters(), hostUserId: HOST_BETO }, selected: [] }).empty, "filtered");
  assert.equal(liveView().empty, null);
});

test("janela do periodo em minutos inteiros (a chave do cache se repete dentro do minuto)", () => {
  assert.deepEqual(model.panelWindowOf({ end: new Date("2026-10-29T15:00:12.345Z"), start: new Date("2026-09-30T03:00:00.000Z") }), {
    end: "2026-10-29T15:01:00.000Z",
    start: "2026-09-30T03:00:00.000Z"
  });
  assert.deepEqual(model.panelWindowOf({ end: new Date("2026-10-29T15:00:59.999Z"), start: new Date("2026-10-28T15:00:59.999Z") }), {
    end: "2026-10-29T15:01:00.000Z",
    start: "2026-10-28T15:00:00.000Z"
  });
});

test("curva da sessao: minutos, os 5 pontos de queda, 'antes de começar' na tabela e a janela da oferta", () => {
  const presence = {
    avgPresent: 4,
    curve: [
      { b: -2, n: 3 },
      { b: 0, n: 5 },
      { b: 1, n: 6 },
      { b: 2, n: 4 },
      { b: 3, n: 2 }
    ],
    drops: [{ b: 2, n: 2 }],
    peak: { b: 1, n: 6 },
    reachedEnd: 1,
    unique: 6,
    watchAvgSeconds: 60,
    watchMaxSeconds: 120
  };
  const chart = model.panelPresenceOf(presence, { durationMs: 1_800_000, offerWindow: { hideOffsetMs: null, showOffsetMs: 600_000, variants: [] } });

  assert.deepEqual(chart.points.map((point) => [point.minute, point.n]), [
    [0, 5],
    [0.5, 6],
    [1, 4],
    [1.5, 2]
  ]);
  assert.deepEqual(chart.drops, [{ label: "01:00", minute: 1, n: 2 }]);
  assert.deepEqual(chart.peak, { label: "00:30", n: 6 });
  assert.equal(chart.durationMinutes, 30);
  assert.deepEqual(chart.offerWindow, { from: 10, to: 30 }, "sem hora de sair, ate o fim");
  assert.deepEqual(chart.table, [
    { label: "antes de começar", present: 3 },
    { label: "00:00", present: 6 },
    { label: "01:00", present: 4 }
  ]);
  assert.equal(model.panelPresenceOf(presence, { durationMs: 1_800_000, offerWindow: null }).offerWindow, null);

  const view = recordedView({ sessionParam: R2 });
  assert.equal(view.presence.selectedId, R2);
  assert.deepEqual(view.presence.offerWindow, { hideOffsetMs: 1_500_000, showOffsetMs: 900_000, variants: [] });
  assert.equal(view.presence.durationMs, 1_800_000);
  assert.equal(recordedView({ sessionParam: S1 }).presence.selectedId, R3, "fora do recorte: a mais recente");
  assert.deepEqual(liveView().presence.options.map((option) => option.id), [S2, S1]);
});

test("numeros da lista: Compareceram e Assistiram o replay pelos unicos do periodo", () => {
  assert.deepEqual(model.panelListNumbersOf(LIVE_RPC), { attended: 9, replayViewers: 3 });
  assert.deepEqual(model.panelListNumbersOf([]), { attended: 0, replayViewers: 0 });
});
