import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { ALUNA, ALUNO, EQUIPE, SESSAO_ID, WEBINAR_ID } from "./support/webinarios-banco-falso.mjs";
import { lerCsv } from "./support/webinarios-v4-exportar-banco.mjs";

// Os CSVs com os nomes do Zoom, a parte pura (docs/30 §2.9, §3.4, §3.5, §3.7, M6, M8, M9, A20 e A25; docs/18 §1.1):
// a ordem das colunas de cada arquivo (as de §3.7), a frase que abre o Performance e o Simulacao, uma linha por vaga
// (Registration), por aluno (Attendee com a variante clicada), por sessao (Performance, do painel e do relatorio do
// replay, sem nenhum numero simulado), por pergunta (Q&A: "Aluno {n}" e o e-mail vazio na anonima, "Assistente"),
// por resposta (Poll e Survey; Survey vazio so com o cabecalho) e por item simulado; as datas em Sao Paulo; os nomes
// dos arquivos; os filtros dos paineis no endereco; os pedidos das rotas; o menu Exportar; e a guarda de §3.5/§10.2:
// nenhum numero real nem CSV real le `sim_*`, `scripted` ou as colunas da Simulacao fora das funcoes da Simulacao.

const model = await import("../src/server/webinars/export-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { buildWebinarReport, readWebinarReportRows } = await import("../src/server/webinars/report-model.ts");
const { anonymousNumber } = await import("../src/server/webinars/room-model.ts");
const { WEBINAR_EXPORT_REPORTS } = await import("../src/server/webinars/model.ts");

const COLUNAS = WEBINAR_COPY.exportar.colunas;
const people = {
  [ALUNA]: { email: "ana@exemplo.test", name: "Ana Souza" },
  [ALUNO]: { email: "bruno@exemplo.test", name: "Bruno Lima" },
  [EQUIPE]: { email: "carla@exemplo.test", name: "Carla Produtora" }
};
const OUTRA = "ffffffff-6666-4666-8666-666666666666";

/* ------------------------------------------------------------------------------------------------
 * Colunas, frases de abertura e nomes de arquivo
 * ---------------------------------------------------------------------------------------------- */

test("as colunas de cada CSV sao as de §3.7, na ordem, e o Attendee e o mesmo da lista por aluno", () => {
  assert.deepEqual([...COLUNAS.registration], ["Nome", "E-mail", "Data da vaga", "Situação", "Link de origem", "Aviso de origem", "Compareceu", "Viu o replay", "Lembrete 24 h", "Lembrete 1 h"]);
  assert.deepEqual([...COLUNAS.qa], ["Nº", "Hora", "Minuto do vídeo", "Nome", "E-mail", "Pergunta", "Votos", "Situação", "Respondida por", "Resposta", "Ao vivo", "Hora da resposta"]);
  assert.deepEqual([...COLUNAS.poll], ["Enquete", "Pergunta", "Nome", "E-mail", "Hora", "Minuto do vídeo", "Resposta(s)"]);
  assert.deepEqual([...COLUNAS.survey], ["Nome", "E-mail", "Hora", "Pergunta", "Resposta"]);
  assert.deepEqual([...COLUNAS.simulacao], ["Tipo", "Minuto do vídeo", "Solta em", "Persona", "Texto", "Disparou"]);
  assert.equal(COLUNAS.performance.length, 25);
  assert.deepEqual(COLUNAS.performance.slice(0, 5), ["Webinário", "Sessão", "Tipo", "Data", "Duração"]);
  assert.deepEqual(COLUNAS.performance.slice(-5), ["Viram a oferta", "Cliques", "Compras", "Conversão", "Replay vistos"]);
  assert.equal(COLUNAS.attendee.length, 16);
  assert.ok(COLUNAS.attendee.includes("Oferta clicada (variante)") && COLUNAS.attendee.at(-1) === "Dispositivo");
  assert.deepEqual(Object.keys(model.EXPORT_COLUMNS).sort(), [...WEBINAR_EXPORT_REPORTS].sort());
  assert.deepEqual(model.PERIOD_SIMULATION_COLUMNS, ["Webinário", "Sessão", "Data", ...COLUNAS.simulacao]);
  for (const columns of Object.values(model.EXPORT_COLUMNS)) {
    assert.ok(!columns.some((column) => /inscrit/i.test(column)), "nenhum rotulo diz Inscritos");
  }
});

test("o arquivo: BOM, ponto e virgula e CRLF; o Performance e o Simulacao abrem com a frase da simulacao; o resto, com o cabecalho", () => {
  const performance = model.exportCsvText("performance", [["Live", "x"]]);
  assert.ok(performance.startsWith("﻿"));
  assert.ok(performance.endsWith("\r\n"));
  const [frase, cabecalho, linha] = lerCsv(performance);
  assert.deepEqual(frase, ["Estes números são reais; a simulação não entra em nenhum deles."]);
  assert.deepEqual(cabecalho, [...COLUNAS.performance]);
  assert.deepEqual(linha, ["Live", "x"]);

  const [fraseSim, cabecalhoSim] = lerCsv(model.exportCsvText("simulacao", []));
  assert.deepEqual(fraseSim, ["Estes números são da simulação e não entram em nenhum outro número."]);
  assert.deepEqual(cabecalhoSim, [...COLUNAS.simulacao]);

  const qa = lerCsv(model.exportCsvText("qa", []));
  assert.deepEqual(qa, [[...COLUNAS.qa]], "sem linha: so o cabecalho");
  assert.equal(lerCsv(model.exportCsvText("qa", [["=1+1"]]))[1][0], "'=1+1", "formula vira texto (injecao de CSV)");
});

test("nomes dos arquivos: a sessao pela hora de Sao Paulo, o periodo do painel pelos dias de Sao Paulo (fim exclusivo)", () => {
  assert.equal(model.sessionExportFileName({ report: "qa", scheduledAt: "2026-11-05T23:00:00.000Z", slug: "live-de-agentes" }), "webinario-live-de-agentes-2026-11-05-2000-qa.csv");
  assert.equal(model.sessionExportFileName({ report: "registration", scheduledAt: "2026-11-06T02:30:00+00:00", slug: "live-de-agentes" }), "webinario-live-de-agentes-2026-11-05-2330-registration.csv");
  assert.equal(model.periodExportKey("2026-11-01T03:00:00.000Z", "2026-12-01T03:00:00.000Z"), "periodo-2026-11-01-a-2026-11-30");
  assert.equal(
    model.panelExportFileName({ end: "2026-12-01T03:00:00.000Z", kind: "simulated", report: "performance", start: "2026-11-01T03:00:00.000Z" }),
    "webinario-gravadas-periodo-2026-11-01-a-2026-11-30-performance.csv"
  );
  assert.equal(
    model.panelExportFileName({ end: "2026-11-02T03:00:00.000Z", kind: "live", report: "simulacao", start: "2026-11-01T03:00:00.000Z" }),
    "webinario-ao-vivo-periodo-2026-11-01-a-2026-11-01-simulacao.csv"
  );
  assert.equal(model.videoMinuteLabel(0), "00:00");
  assert.equal(model.videoMinuteLabel(605_400), "10:05");
  assert.equal(model.videoMinuteLabel(4_530_000), "75:30", "os minutos passam de 59 num video longo");
  assert.equal(model.videoMinuteLabel(-30_000), "-00:30", "antes de comecar");
  assert.equal(model.videoMinuteLabel(null), "");
});

/* ------------------------------------------------------------------------------------------------
 * Registration e Attendee
 * ---------------------------------------------------------------------------------------------- */

test("Registration: uma linha por vaga na ordem da vaga, Vaga garantida/Cancelada, origem, aviso, Compareceu e Viu o replay, lembretes em Sao Paulo", () => {
  const rows = model.registrationExportRows({
    people,
    present: new Set([ALUNA]),
    registrations: [
      { registeredAt: "2026-11-02T12:00:00+00:00", reminder1hSentAt: null, reminder24hSentAt: null, source: null, sourceCampaignId: null, status: "cancelled", userId: ALUNO },
      { registeredAt: "2026-11-01T12:00:00.000Z", reminder1hSentAt: "2026-11-05T22:00:00.000Z", reminder24hSentAt: "2026-11-04T23:00:00.000Z", source: "instagram", sourceCampaignId: OUTRA, status: "registered", userId: ALUNA },
      { registeredAt: "2026-11-03T12:00:00.000Z", reminder1hSentAt: null, reminder24hSentAt: null, source: "email", sourceCampaignId: null, status: "registered", userId: "sem-perfil" }
    ],
    replayViewers: new Set([ALUNO])
  });

  assert.deepEqual(rows, [
    ["Ana Souza", "ana@exemplo.test", "01/11/2026 às 09:00", "Vaga garantida", "instagram", OUTRA, "Sim", "Não", "04/11/2026 às 20:00", "05/11/2026 às 19:00"],
    ["Bruno Lima", "bruno@exemplo.test", "02/11/2026 às 09:00", "Cancelada", "", "", "Não", "Sim", "", ""],
    ["Aluno", "", "03/11/2026 às 09:00", "Vaga garantida", "email", "", "Não", "Não", "", ""]
  ]);
  assert.equal(rows[0].length, COLUNAS.registration.length);
});

test("Attendee: a variante da Oferta clicada (A a D, uma vez por letra) e o aparelho; quem ficou mais tempo primeiro", () => {
  const clicked = model.offerClickedByUser([
    { userId: ALUNA, variantLabel: "B" },
    { userId: ALUNA, variantLabel: "B" },
    { userId: ALUNO, variantLabel: "C" },
    { userId: ALUNO, variantLabel: "A" },
    { userId: EQUIPE, variantLabel: "Z" }
  ]);
  assert.deepEqual([...clicked.entries()], [
    [ALUNA, "B"],
    [ALUNO, "A, C"]
  ]);

  const base = { entries: 1, firstAt: "2026-11-05T23:00:10.000Z", lastAt: "2026-11-05T23:29:40.000Z", messages: 2, polls: 1, questions: 0, reachedEnd: true, reactions: 1, registered: true, source: null };
  const rows = model.attendeeExportRows(
    [
      { ...base, device: "desktop", email: "bruno@exemplo.test", name: "Bruno Lima", registeredAt: "2026-11-02T12:00:00.000Z", score: 40, seconds: 600, userId: ALUNO },
      { ...base, device: "mobile", email: "ana@exemplo.test", name: "Ana Souza", registeredAt: "2026-11-01T12:00:00.000Z", score: 100, seconds: 1800, userId: ALUNA }
    ],
    clicked
  );
  assert.deepEqual(rows[0], ["Sim", "Ana Souza", "ana@exemplo.test", "01/11/2026 às 09:00", "05/11/2026 às 20:00", "05/11/2026 às 20:29", 1, 30, "Sim", 2, 1, 0, 1, "B", 100, "celular"]);
  assert.deepEqual(rows[1].slice(13), ["A, C", 40, "computador"]);
  assert.equal(rows[0].length, COLUNAS.attendee.length, "sem pais nem rede (A25)");
});

/* ------------------------------------------------------------------------------------------------
 * Performance: so numeros reais
 * ---------------------------------------------------------------------------------------------- */

const sessao = { id: SESSAO_ID, kind: "simulated", scheduledAt: "2026-11-05T23:00:00.000Z", webinarTitle: "Live de agentes" };
const linhaDoPainel = (metric, total, students = total, item = "", sessionId = SESSAO_ID) => ({ item, metric, sessionId, students, total });

const PAINEL = [
  linhaDoPainel("duration", 1_800_000, 0),
  linhaDoPainel("registered", 4),
  linhaDoPainel("present", 3),
  linhaDoPainel("attended_registered", 2),
  linhaDoPainel("watch_sum", 3000, 3),
  linhaDoPainel("watch_max", 1800, 3),
  linhaDoPainel("reached_end", 1),
  linhaDoPainel("peak", 3, 3, "2"),
  linhaDoPainel("messages", 7, 2),
  linhaDoPainel("question", 2, 2, "open"),
  linhaDoPainel("question", 1, 1, "answered"),
  linhaDoPainel("question", 1, 1, "dismissed"),
  linhaDoPainel("reactions", 5, 2),
  linhaDoPainel("poll_answers", 3, 3),
  linhaDoPainel("replay_viewers", 2),
  linhaDoPainel("visitors", 5),
  linhaDoPainel("offer_seen", 3, 3),
  linhaDoPainel("offer_clicks", 4, 2),
  linhaDoPainel("offer_purchases", 1, 1),
  linhaDoPainel("offer_variant", 2, 2, "A:seen"),
  // O bloco Simulacao da RPC (D6, M6): numeros enormes que nunca podem aparecer no Performance.
  linhaDoPainel("sim_counter", 98765, 0, "max"),
  linhaDoPainel("sim_joins", 87654, 0, "shown"),
  linhaDoPainel("sim_sales", 76543, 0, "shown"),
  linhaDoPainel("sim_script", 65432, 0, "fired"),
  // Outra sessao e os unicos do periodo: fora desta linha.
  linhaDoPainel("present", 99, 99, "", OUTRA),
  linhaDoPainel("unique_present", 50, 50, "", null)
];

test("Performance pelo painel: a linha da sessao com os 25 numeros reais e a conversao; o bloco Simulacao nunca entra", () => {
  const facts = model.performanceFactsFromPanel(PAINEL, sessao);
  const row = model.performanceRow(facts);

  assert.deepEqual(row, [
    "Live de agentes",
    SESSAO_ID,
    "Gravada",
    "05/11/2026 às 20:00",
    "30 min",
    4,
    3,
    "50 %",
    3,
    "01:00",
    "17 min",
    "30 min",
    "33 %",
    7,
    2,
    5,
    4,
    1,
    1,
    3,
    3,
    2,
    1,
    "33 %",
    2
  ]);
  assert.equal(row.length, COLUNAS.performance.length);
  const texto = row.join(";");
  for (const simulado of ["98765", "87654", "76543", "65432", "99"]) {
    assert.ok(!texto.includes(simulado), `o Performance nao soma ${simulado}`);
  }

  // Sem oferta: as colunas da Oferta vazias; sem presente: os tempos vazios (nada estimado).
  const vazia = model.performanceRow(model.performanceFactsFromPanel([linhaDoPainel("duration", 600_000, 0), linhaDoPainel("registered", 2)], { ...sessao, kind: "live" }));
  assert.deepEqual(vazia.slice(2, 13), ["Ao vivo", "05/11/2026 às 20:00", "10 min", 2, 0, "0 %", "", "", "", "", ""]);
  assert.deepEqual(vazia.slice(20), ["", "", "", "", 0]);
});

test("Performance do replay pelo relatorio da sessao: os mesmos nomes, as linhas sim_* do relatorio ficam fora", () => {
  const view = buildWebinarReport(
    readWebinarReportRows([
      { item: "registered", metric: "registration", students: 2, total: 2 },
      { item: "attended", metric: "registration", students: 1, total: 1 },
      { item: "", metric: "unique", students: 4, total: 4 },
      { item: "4", metric: "peak", students: 3, total: 3 },
      { item: "", metric: "watch_avg", students: 4, total: 900 },
      { item: "", metric: "watch_max", students: 4, total: 1700 },
      { item: "", metric: "reached_end", students: 2, total: 2 },
      { item: "", metric: "chat_total", students: 2, total: 6 },
      { item: "fire", metric: "reaction", students: 1, total: 2 },
      { item: "answered", metric: "question", students: 1, total: 1 },
      { item: "p:o1", metric: "poll", students: 2, total: 2 },
      { item: "viewers", metric: "replay", students: 4, total: 4 },
      { item: "max", metric: "sim_counter", students: 0, total: 98765 },
      { item: "fired", metric: "sim_script", students: 0, total: 65432 }
    ])
  );
  const row = model.performanceRow(model.performanceFactsFromReport(view, { ...sessao, kind: "replay" }, 1_800_000));
  assert.deepEqual(row.slice(2, 25), ["Replay", "05/11/2026 às 20:00", "30 min", 2, 4, "50 %", 3, "02:00", "15 min", "28 min", "50 %", 6, 2, 2, 1, 1, 0, 2, "", "", "", "", 4]);
  assert.ok(!row.join(";").includes("98765") && !row.join(";").includes("65432"));
});

/* ------------------------------------------------------------------------------------------------
 * Q&A, Poll e Survey
 * ---------------------------------------------------------------------------------------------- */

const pergunta = (extra) => ({
  anonymous: false,
  answerSource: null,
  answerText: null,
  answeredAt: null,
  answeredBy: null,
  answeredLive: false,
  body: "Pergunta?",
  createdAt: "2026-11-05T23:10:00.000Z",
  offsetMs: 600_000,
  status: "open",
  upvotes: 0,
  userId: ALUNA,
  ...extra
});

test("Q&A: Nº na ordem de chegada, minuto do video, 'Aluno {n}' e e-mail vazio na anonima, situacao, quem respondeu (Assistente, nome da equipe ou Equipe), ao vivo", () => {
  const rows = model.qaExportRows({
    people,
    questions: [
      pergunta({ answerSource: "ai", answerText: "Sim, pelo app.", answeredAt: "2026-11-05T23:12:00+00:00", body: "Funciona no celular?", createdAt: "2026-11-05T23:11:00+00:00", offsetMs: 660_500, status: "answered", upvotes: 3 }),
      pergunta({ anonymous: true, body: "Tem certificado?", createdAt: "2026-11-05T23:05:00.000Z", offsetMs: 300_000, userId: ALUNO }),
      pergunta({ answerText: "Fica 7 dias.", answeredAt: "2026-11-05T23:20:00.000Z", answeredBy: EQUIPE, answeredLive: true, body: "Vai ter replay?", createdAt: "2026-11-05T23:15:00.000Z", status: "answered" }),
      pergunta({ answeredBy: "sem-perfil", body: "Spam", createdAt: "2026-11-05T23:16:00.000Z", status: "dismissed" }),
      pergunta({ body: "Antes de comecar", createdAt: "2026-11-05T22:59:00.000Z", offsetMs: -45_000, status: "answered" })
    ],
    webinarId: WEBINAR_ID
  });

  assert.deepEqual(rows[0], [1, "05/11/2026 às 19:59", "-00:45", "Ana Souza", "ana@exemplo.test", "Antes de comecar", 0, "Respondida", "Equipe", "", "Não", ""]);
  assert.deepEqual(rows[1], [2, "05/11/2026 às 20:05", "05:00", `Aluno ${anonymousNumber(ALUNO, WEBINAR_ID)}`, "", "Tem certificado?", 0, "Aberta", "", "", "", ""]);
  assert.deepEqual(rows[2], [3, "05/11/2026 às 20:11", "11:00", "Ana Souza", "ana@exemplo.test", "Funciona no celular?", 3, "Respondida", "Assistente", "Sim, pelo app.", "Não", "05/11/2026 às 20:12"]);
  assert.deepEqual(rows[3].slice(7, 12), ["Respondida", "Carla Produtora", "Fica 7 dias.", "Sim", "05/11/2026 às 20:20"]);
  assert.deepEqual(rows[4].slice(7, 9), ["Dispensada", "Equipe"]);
  assert.equal(rows[1][3], "Aluno 451", "o mesmo numero que o chat mostra para esse aluno nesse webinario");
  assert.ok(!rows.flat().includes("bruno@exemplo.test"), "o e-mail da anonima nunca sai");
});

const enquete = (extra) => ({
  anonymous: false,
  closedAt: null,
  id: "p1",
  kind: "single",
  openOffsetMs: 0,
  openedAt: "2026-11-05T23:05:00.000Z",
  options: [
    { id: "o1", label: "Planilha", position: 0 },
    { id: "o2", label: "Agente", position: 1 },
    { id: "o3", label: "Nada", position: 2 }
  ],
  position: 0,
  question: "Qual ferramenta?",
  resultsSharedAt: null,
  sessionId: SESSAO_ID,
  status: "closed",
  templatePollId: null,
  webinarId: WEBINAR_ID,
  ...extra
});

test("Poll: uma linha por resposta, a enquete numerada, multipla com ';' na ordem das opcoes, anonima sem nome e e-mail; Survey a parte e vazio so com o cabecalho (A20)", () => {
  const polls = [enquete({ id: "p2", kind: "multiple", position: 1, question: "O que voce usa?" }), enquete({ anonymous: true, id: "p1" }), enquete({ id: "s1", kind: "survey", position: 2, question: "Nota da live?" })];
  const answers = [
    { createdAt: "2026-11-05T23:21:00.000Z", offsetMs: 1_260_000, optionIds: ["o3", "o1"], pollId: "p2", userId: ALUNA },
    { createdAt: "2026-11-05T23:06:00.000Z", offsetMs: 360_000, optionIds: ["o2"], pollId: "p1", userId: ALUNO },
    { createdAt: "2026-11-05T23:40:00.000Z", offsetMs: 2_400_000, optionIds: ["o1"], pollId: "s1", userId: ALUNA }
  ];

  assert.deepEqual(model.pollExportRows({ answers, people, polls }), [
    [1, "Qual ferramenta?", "", "", "05/11/2026 às 20:06", "06:00", "Agente"],
    [2, "O que voce usa?", "Ana Souza", "ana@exemplo.test", "05/11/2026 às 20:21", "21:00", "Planilha; Nada"]
  ]);
  assert.deepEqual(model.surveyExportRows({ answers, people, polls }), [["Ana Souza", "ana@exemplo.test", "05/11/2026 às 20:40", "Nota da live?", "Planilha"]]);

  const semPesquisa = model.surveyExportRows({ answers, people, polls: polls.filter((poll) => poll.kind !== "survey") });
  assert.deepEqual(semPesquisa, []);
  assert.deepEqual(lerCsv(model.exportCsvText("survey", semPesquisa)), [[...COLUNAS.survey]], "o Survey sai so com as colunas");
});

/* ------------------------------------------------------------------------------------------------
 * Simulacao (so a sessao gravada)
 * ---------------------------------------------------------------------------------------------- */

const item = (extra) => ({ body: "Que aula boa!", id: "i1", offsetMs: 60_000, personaName: "Marina", position: 0, resolvedOffsetMs: null, status: "ready", triggerKind: "at_offset", ...extra });
const simulacao = (extra = {}) => ({
  countRule: { base: 40, jitter: 5, mode: "curve", peak: 120 },
  joins: { enabled: true, everySeconds: 60, max: 30, names: "generic" },
  saleNotices: {
    enabled: true,
    items: [
      { offsetMs: 1_500_000, text: "Ana garantiu a vaga" },
      { offsetMs: 2_100_000, text: "Joao garantiu a vaga" }
    ]
  },
  seed: 7,
  sessionId: SESSAO_ID,
  summary: { counterMax: 134, joinsShown: 12, saleNoticesShown: 1 },
  ...extra
});

test("Simulacao: o roteiro (Solta em, persona, texto, Disparou pelas mensagens do roteiro), o contador com o real ao lado, as entradas e cada aviso de venda", () => {
  const rows = model.simulationExportRows({
    elapsedMs: 1_800_000,
    fired: new Map([
      ["i1", 60_000],
      ["i3", 905_000]
    ]),
    items: [
      item({}),
      item({ body: "Concordo", id: "i2", offsetMs: null, personaName: "Rafa", phrase: "agente", position: 1, resolvedOffsetMs: null, status: "unresolved", triggerKind: "on_phrase" }),
      item({ body: "Pergunta da equipe", id: "i3", offsetMs: null, personaName: "Equipe", position: 2, triggerKind: "manual" }),
      item({ body: "Rascunho", id: "i4", position: 3, status: "draft" })
    ],
    realParticipants: 18,
    simulation: simulacao()
  });

  assert.deepEqual(rows, [
    ["Comentário do roteiro", "01:00", "Num minuto do vídeo", "Marina", "Que aula boa!", "Sim"],
    ["Comentário do roteiro", "15:05", "Pelo botão da equipe", "Equipe", "Pergunta da equipe", "Sim"],
    ["Comentário do roteiro", "", "Quando o apresentador diz", "Rafa", "Concordo", "Não"],
    ["Contador", "", "", "", "real + faixa que varia · maior número mostrado: 134 · participantes de verdade: 18", "Sim"],
    ["Entrada", "", "", "", "uma a cada 60 s, até 30 · 12 mostradas", "Sim"],
    ["Aviso de venda", "25:00", "", "", "Ana garantiu a vaga", "Sim"],
    ["Aviso de venda", "35:00", "", "", "Joao garantiu a vaga", "Não"]
  ]);

  const desligada = model.simulationExportRows({
    elapsedMs: 0,
    fired: new Map(),
    items: [],
    realParticipants: 3,
    simulation: simulacao({ countRule: { base: 0, jitter: 0, mode: "off", peak: 0 }, joins: { enabled: false, everySeconds: 60, max: 30, names: "generic" }, saleNotices: { enabled: false, items: [] }, summary: null })
  });
  assert.deepEqual(desligada, [["Contador", "", "", "", "real · maior número mostrado: 0 · participantes de verdade: 3", "Não"]]);

  const semMigracao = model.simulationExportRows({ elapsedMs: 0, fired: new Map(), items: [item({})], realParticipants: 0, simulation: null });
  assert.deepEqual(semMigracao, [["Comentário do roteiro", "01:00", "Num minuto do vídeo", "Marina", "Que aula boa!", "Não"]], "sem a 202610290005 so o roteiro sai");

  assert.equal(model.simulationElapsedMs({ durationMs: 1_800_000, now: Date.parse("2026-11-05T23:10:00Z"), startedAt: "2026-11-05T23:00:00+00:00", status: "live" }), 600_000);
  assert.equal(model.simulationElapsedMs({ durationMs: 1_800_000, now: 0, startedAt: null, status: "ended" }), 1_800_000);
  assert.equal(model.simulationElapsedMs({ durationMs: 1_800_000, now: 0, startedAt: null, status: "scheduled" }), 0);
});

test("Simulacao 'Disparou': so o que a sala mostrou (Encerrar aos 10 min, a decisao registrada, o zero da hora marcada)", () => {
  const scheduledAt = "2026-11-05T23:00:00.000Z";
  const avisos = { enabled: true, items: [5, 20, 40].map((minute) => ({ offsetMs: minute * 60_000, text: `Aviso dos ${minute}` })) };
  // A equipe encerrou aos 10 min de um video de 60: o tempo passado e 10 min, nao o video inteiro.
  const elapsedMs = model.simulationElapsedMs({ durationMs: 3_600_000, endedAt: "2026-11-05T23:10:00+00:00", now: Date.parse("2026-11-06T02:00:00Z"), scheduledAt, startedAt: "2026-11-05T23:00:40Z", status: "ended" });
  assert.equal(elapsedMs, 600_000);
  const encerrada = model.simulationExportRows({ decided: true, elapsedMs, fired: new Map(), items: [], realParticipants: 5, simulation: simulacao({ saleNotices: avisos, summary: { counterMax: 0, joinsShown: 0, saleNoticesShown: 1 } }) });
  assert.deepEqual(encerrada.filter((row) => row[0] === "Aviso de venda").map((row) => row[5]), ["Sim", "Não", "Não"]);
  assert.equal(encerrada.find((row) => row[0] === "Contador")[5], "Não", "resumo congelado com o contador em 0: nao disparou");
  assert.equal(encerrada.find((row) => row[0] === "Entrada")[5], "Não");

  // A regra gravada sem a decisao: a sala nao mostrou nada, nenhuma linha diz Sim.
  const semDecisao = model.simulationExportRows({ decided: false, elapsedMs: 3_600_000, fired: new Map(), items: [], realParticipants: 5, simulation: simulacao({ saleNotices: avisos, summary: { counterMax: 0, joinsShown: 0, saleNoticesShown: 0 } }) });
  assert.ok(semDecisao.filter((row) => row[0] !== "Comentário do roteiro").every((row) => row[5] === "Não"), JSON.stringify(semDecisao));

  // Em andamento: o relogio da gravada conta da hora marcada (o tick grava started_at depois); agendada com a hora
  // passada tambem ja anda. Sem resumo ainda, o contador ligado conta como mostrado.
  const now = Date.parse("2026-11-05T23:21:00Z");
  assert.equal(model.simulationElapsedMs({ durationMs: 3_600_000, now, scheduledAt, startedAt: "2026-11-05T23:00:50Z", status: "live" }), 21 * 60_000);
  assert.equal(model.simulationElapsedMs({ durationMs: 3_600_000, now, scheduledAt, startedAt: null, status: "scheduled" }), 21 * 60_000);
  assert.equal(model.simulationElapsedMs({ durationMs: 3_600_000, now, scheduledAt, startedAt: null, status: "cancelled" }), 0);
  const noAr = model.simulationExportRows({ decided: true, elapsedMs: 21 * 60_000, fired: new Map(), items: [], realParticipants: 5, simulation: simulacao({ saleNotices: avisos, summary: null }) });
  assert.deepEqual(noAr.filter((row) => row[0] === "Aviso de venda").map((row) => row[5]), ["Sim", "Sim", "Não"]);
  assert.equal(noAr.find((row) => row[0] === "Contador")[5], "Sim");
});

test("Simulacao do periodo: cada linha com o webinario, a sessao e a hora na frente, na ordem das horas", () => {
  const rows = model.periodSimulationRows([
    { input: { elapsedMs: 0, fired: new Map(), items: [], realParticipants: 2, simulation: simulacao({ joins: { enabled: false, everySeconds: 60, max: 30, names: "generic" }, saleNotices: { enabled: false, items: [] }, summary: { counterMax: 50, joinsShown: 0, saleNoticesShown: 0 } }) }, scheduledAt: "2026-11-06T23:00:00.000Z", sessionId: OUTRA, webinarTitle: "B" },
    { input: { elapsedMs: 0, fired: new Map(), items: [item({})], realParticipants: 1, simulation: null }, scheduledAt: "2026-11-05T23:00:00.000Z", sessionId: SESSAO_ID, webinarTitle: "A" }
  ]);
  assert.deepEqual(rows.map((row) => row.slice(0, 4)), [
    ["A", SESSAO_ID, "05/11/2026 às 20:00", "Comentário do roteiro"],
    ["B", OUTRA, "06/11/2026 às 20:00", "Contador"]
  ]);
  assert.equal(rows[0].length, model.PERIOD_SIMULATION_COLUMNS.length);
});

/* ------------------------------------------------------------------------------------------------
 * Os pedidos das rotas, os filtros do painel e o menu Exportar
 * ---------------------------------------------------------------------------------------------- */

test("o pedido da rota da sessao: sem ?relatorio=, o Attendee; relatorio desconhecido ou sessao que nao e uuid: nulo (400)", () => {
  const query = (text) => model.parseSessionExportRequest(new URLSearchParams(text));
  assert.deepEqual(query(`sessao=${SESSAO_ID}`), { report: "attendee", sessionId: SESSAO_ID });
  for (const report of WEBINAR_EXPORT_REPORTS) {
    assert.deepEqual(query(`sessao=${SESSAO_ID}&relatorio=${report}`), { report, sessionId: SESSAO_ID });
  }
  assert.equal(query(`sessao=${SESSAO_ID}&relatorio=absentee`), null);
  assert.equal(query("sessao=abc"), null);
  assert.equal(query(""), null);
});

test("o pedido da rota do painel: tipo, periodo de ate 1 ano, so Performance e Simulacao; os filtros da aba pelo endereco (valor estranho = sem filtro)", () => {
  const base = "tipo=gravadas&inicio=2026-11-01T03:00:00.000Z&fim=2026-12-01T03:00:00.000Z";
  const query = (text) => model.parsePanelExportRequest(new URLSearchParams(text));

  const ok = query(`${base}&relatorio=simulacao&webinario=${WEBINAR_ID}&hora=20&com-oferta=1&variante=B&situacao=realizadas&produto=curso-ia&apresentador=lixo`);
  assert.deepEqual(ok, {
    filters: { hostUserId: null, hour: 20, productId: "curso-ia", situation: "realized", variant: "B", webinarId: WEBINAR_ID, withOffer: true },
    kind: "simulated",
    period: { end: "2026-12-01T03:00:00.000Z", start: "2026-11-01T03:00:00.000Z" },
    report: "simulacao"
  });
  assert.equal(query(base)?.report, "performance", "sem ?relatorio=, o Performance");
  assert.equal(query(`${base}&relatorio=qa`), null, "Q&A so de uma sessao");
  assert.equal(query(base.replace("gravadas", "replay")), null);
  assert.equal(query("tipo=ao-vivo&inicio=2026-01-01T00:00:00Z&fim=2027-06-01T00:00:00Z"), null, "mais de 1 ano");
  assert.equal(query("tipo=ao-vivo&inicio=2026-12-01T00:00:00Z&fim=2026-11-01T00:00:00Z"), null, "o fim antes do inicio");
  assert.equal(query("tipo=ao-vivo&inicio=ontem&fim=hoje"), null);
  assert.equal(query(`${base}&hora=25&variante=E&situacao=todas`)?.filters.hour, null);
  const minusculas = query(`${base}&variante=b&situacao=Canceladas&com-oferta=SIM`)?.filters;
  assert.deepEqual([minusculas?.variant, minusculas?.situation, minusculas?.withOffer], ["B", "cancelled", true], "como o painel le: maiusculas e minusculas tanto faz");

  const params = model.panelFiltersToParams({ hostUserId: EQUIPE, hour: 9, productId: "curso", situation: "cancelled", variant: "D", webinarId: WEBINAR_ID, withOffer: true });
  assert.deepEqual(params, { apresentador: EQUIPE, "com-oferta": "1", hora: "9", produto: "curso", situacao: "canceladas", variante: "D", webinario: WEBINAR_ID });
  assert.deepEqual(model.panelFiltersFromParams(new URLSearchParams(params)), { hostUserId: EQUIPE, hour: 9, productId: "curso", situation: "cancelled", variant: "D", webinarId: WEBINAR_ID, withOffer: true });
  assert.deepEqual(model.panelFiltersToParams(undefined), {});
});

test("o menu Exportar: os sete da sessao na ordem do Zoom (sem a Simulacao fora da gravada); no painel, Performance e (so em gravadas) Simulacao com os filtros", () => {
  const sessao7 = model.sessionExportMenuEntries({ sessionId: SESSAO_ID, webinarId: WEBINAR_ID });
  assert.deepEqual(sessao7.map((entry) => entry.report), ["registration", "attendee", "performance", "qa", "poll", "survey", "simulacao"]);
  assert.deepEqual(sessao7.map((entry) => entry.label), [
    "Registration (vagas)",
    "Attendee (lista por aluno)",
    "Performance (números da sessão)",
    "Q&A (perguntas)",
    "Poll (respostas das enquetes)",
    "Survey (pesquisa do fim)",
    "Simulação (só a parte simulada)"
  ]);
  assert.equal(sessao7[3].href, `/api/admin/webinars/${WEBINAR_ID}/relatorio/csv?sessao=${SESSAO_ID}&relatorio=qa`);
  const semSimulacao = model.sessionExportMenuEntries({ reports: ["registration", "attendee", "performance", "qa", "poll", "survey"], sessionId: SESSAO_ID, webinarId: WEBINAR_ID });
  assert.ok(!semSimulacao.some((entry) => entry.report === "simulacao"));

  const start = "2026-11-01T03:00:00.000Z";
  const end = "2026-12-01T03:00:00.000Z";
  const aoVivo = model.panelExportMenuEntries({ end, kind: "live", start });
  assert.deepEqual(aoVivo.map((entry) => [entry.report, entry.label]), [["performance", "Performance (todas as sessões do período)"]]);
  const gravadas = model.panelExportMenuEntries({ end, filters: { variant: "B", withOffer: true }, kind: "simulated", searchParams: { periodo: "30d", tipo: "x" }, start });
  assert.deepEqual(gravadas.map((entry) => entry.report), ["performance", "simulacao"]);
  const url = new URL(gravadas[1].href, "http://localhost");
  assert.equal(url.pathname, "/api/admin/webinars/painel/csv");
  assert.equal(url.searchParams.get("tipo"), "gravadas", "o tipo do painel vence o da pagina");
  assert.equal(url.searchParams.get("relatorio"), "simulacao");
  assert.equal(url.searchParams.get("variante"), "B");
  assert.equal(url.searchParams.get("com-oferta"), "1");
  assert.deepEqual(model.parsePanelExportRequest(url.searchParams)?.filters.variant, "B", "a rota le o que o menu escreveu");
  assert.deepEqual(model.panelExportMenuEntries({ end: start, kind: "live", start: end }), [], "periodo invalido: sem menu");
});

/* ------------------------------------------------------------------------------------------------
 * A guarda de §3.5 e §10.2: nenhum numero real nem CSV real le a Simulacao
 * ---------------------------------------------------------------------------------------------- */

const SIMULADO = [/\bsim_(script|counter|joins|sales)\b/, /["'`]scripted["'`]/, /\bsimulated_(count_rule|joins|sale_notices)\b/, /\bsimulation_summary\b/];

/** O fonte sem comentarios, cortado em pedacos de nivel de topo (funcao, const ou type), cada um com o nome. */
function pedacos(arquivo) {
  const fonte = readFileSync(new URL(`../${arquivo}`, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const inicio = /^(?:export )?(?:async )?(?:function\*? (\w+)|const (\w+)|type (\w+))/gm;
  const achados = [...fonte.matchAll(inicio)];
  return achados.map((achado, index) => ({
    corpo: fonte.slice(achado.index, index + 1 < achados.length ? achados[index + 1].index : fonte.length),
    nome: achado[1] ?? achado[2] ?? achado[3]
  }));
}

test("guarda (§3.5, §10.2): sim_*, 'scripted' e as colunas da Simulacao so aparecem nas funcoes da Simulacao do relatorio e dos CSVs", () => {
  const arquivos = [
    "src/server/webinars/report-model.ts",
    "src/server/webinars/report-page-model.ts",
    "src/server/webinars/report-queries.ts",
    "src/server/webinars/export-model.ts",
    "src/server/webinars/export-queries.ts"
  ];
  const permitidas = [];

  for (const arquivo of arquivos) {
    for (const pedaco of pedacos(arquivo)) {
      if (SIMULADO.some((padrao) => padrao.test(pedaco.corpo))) {
        assert.match(pedaco.nome, /simulation/i, `${arquivo}: ${pedaco.nome} le a Simulacao fora das funcoes dela`);
        permitidas.push(`${arquivo.split("/").pop()}:${pedaco.nome}`);
      }
    }
  }

  // A guarda nao e vazia: o leitor das linhas sim_* e a leitura do roteiro que entrou estao entre as achadas.
  assert.ok(permitidas.includes("report-model.ts:applySimulationRow"), permitidas.join(", "));
  assert.ok(permitidas.includes("export-queries.ts:listSimulationScriptFires"), permitidas.join(", "));

  // E os numeros reais nunca chamam as funcoes da Simulacao.
  const reais = pedacos("src/server/webinars/export-model.ts").filter((pedaco) => /^performance/.test(pedaco.nome));
  assert.equal(reais.length, 3);
  for (const pedaco of reais) {
    assert.doesNotMatch(pedaco.corpo, /simulat|sim_|scripted/i, pedaco.nome);
  }
  const relatorio = pedacos("src/server/webinars/report-model.ts").find((pedaco) => pedaco.nome === "buildWebinarReport");
  assert.ok(relatorio);
  assert.doesNotMatch(relatorio.corpo, /sim_/, "buildWebinarReport so desvia o resto para o leitor da Simulacao");
});

test("guarda: o leitor da Simulacao so poe numeros em script e simulation; os numeros reais ficam iguais com ou sem as linhas sim_*", () => {
  const reais = [
    { item: "", metric: "unique", students: 3, total: 3 },
    { item: "", metric: "chat_total", students: 2, total: 5 },
    { item: "seen", metric: "offer", students: 2, total: 2 }
  ];
  const simuladas = [
    { item: "max", metric: "sim_counter", students: 0, total: 900 },
    { item: "shown", metric: "sim_joins", students: 0, total: 40 },
    { item: "shown", metric: "sim_sales", students: 0, total: 3 },
    { item: "fired", metric: "sim_script", students: 0, total: 12 }
  ];
  const sem = buildWebinarReport(readWebinarReportRows(reais));
  const com = buildWebinarReport(readWebinarReportRows([...simuladas, ...reais]));
  assert.deepEqual({ ...com, script: sem.script, simulation: sem.simulation }, sem, "so script e simulation mudam");
  assert.deepEqual(com.simulation, { counterMax: 900, joinsShown: 40, saleNoticesShown: 3 });
  assert.equal(com.script.fired, 12);
});
