import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { ALUNA, ALUNO, EQUIPE, GRAVACAO_ID, SESSAO_ID, WEBINAR_ID, resumoDePresenca, sessaoRow } from "./support/webinarios-banco-falso.mjs";

// A aba Relatorio desenhada (docs/30 §2.5, §3.4 e §3.7; docs/18 §1.1): a trilha com o webinario, o seletor de sessao
// (?sessao=) com a sessao marcada, os onze numeros ("—" sem dado), a curva com o resumo e as maiores quedas (grafico
// com SVG acessivel e a tabela por minuto no lugar dele), as barras do chat, Quem mais comentou e Mais quentes com os
// nomes de profiles, as perguntas mais votadas, as enquetes por opcao, as vagas, o replay, o bloco Simulacao a parte e
// a lista por aluno com o CSV; e o estado vazio antes da primeira sessao. Da fase 4: o botao Exportar (o menu dos CSVs
// nos nomes do Zoom), os blocos Oferta, Respostas do Assistente e a Simulacao completa (com o aviso da migracao so no
// bloco), o trecho da transcricao nas quedas e as sessoes "Comeca quando voce entra" no seletor. Os .tsx sao
// transpilados pelo TypeScript (so JSX -> JS) e desenhados com react-dom/server; a parte pura (report-page-model.ts) e
// conferida direto.

const { createElement } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { buildWebinarReport, readWebinarReportRows } = await import("../src/server/webinars/report-model.ts");
const model = await import("../src/server/webinars/report-page-model.ts");
const { sessionFromRow } = await import("../src/server/webinars/rows.ts");
const { WebinarReportView } = await import("../src/components/admin/v2/communication/webinars/report/report-view.tsx");
const { PresenceCurveCard } = await import("../src/components/admin/v2/communication/webinars/report/presence-curve.tsx");
const { WebinarReportSkeleton } = await import("../src/components/admin/v2/communication/webinars/report/report-skeleton.tsx");

const html = (element) => renderToStaticMarkup(element);
const textOf = (markup) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;| /g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ENQUETE = "c1c1c1c1-0000-4000-8000-000000000001";
const OPCAO_A = "b1b1b1b1-0000-4000-8000-000000000001";
const OPCAO_B = "b2b2b2b2-0000-4000-8000-000000000002";
const PERGUNTA = "d1d1d1d1-0000-4000-8000-000000000001";
const REPLAY_ID = "22222222-aaaa-4aaa-8aaa-222222222222";

const RPC_ROWS = [
  { metric: "avg_present", item: "", total: "1", students: "1" },
  { metric: "chat_minute", item: "0", total: 2, students: 2 },
  { metric: "chat_minute", item: "3", total: 1, students: 1 },
  { metric: "chat_total", item: "", total: 3, students: 2 },
  { metric: "drop", item: "2", total: 1, students: 1 },
  { metric: "drop", item: "41", total: 1, students: 1 },
  { metric: "drop", item: "71", total: 1, students: 1 },
  { metric: "hot", item: ALUNA, total: 100, students: 1 },
  { metric: "hot", item: ALUNO, total: 65, students: 1 },
  { metric: "peak", item: "0", total: 3, students: 3 },
  { metric: "poll", item: `${ENQUETE}:${OPCAO_A}`, total: 3, students: 3 },
  { metric: "poll", item: `${ENQUETE}:${OPCAO_B}`, total: 1, students: 1 },
  { metric: "presence", item: "0", total: 3, students: 3 },
  { metric: "presence", item: "1", total: 3, students: 3 },
  { metric: "presence", item: "2", total: 2, students: 2 },
  { metric: "question", item: "open", total: 1, students: 1 },
  { metric: "question", item: "answered", total: 2, students: 2 },
  { metric: "reached_end", item: "", total: 1, students: 1 },
  { metric: "reaction", item: "fire", total: 2, students: 2 },
  { metric: "reaction", item: "clap", total: 1, students: 1 },
  { metric: "registration", item: "absent", total: 0, students: 0 },
  { metric: "registration", item: "attended", total: 2, students: 2 },
  { metric: "registration", item: "registered", total: 2, students: 2 },
  { metric: "registration_source", item: "", total: 1, students: 1 },
  { metric: "registration_source", item: "email", total: 1, students: 1 },
  { metric: "replay", item: "viewers", total: 4, students: 4 },
  { metric: "replay", item: "watched_pct", total: 55, students: 4 },
  { metric: "sim_script", item: "fired", total: 2, students: 0 },
  { metric: "sim_script", item: "missed", total: 1, students: 0 },
  { metric: "top_chat", item: ALUNA, total: 2, students: 1 },
  { metric: "top_chat", item: ALUNO, total: 1, students: 1 },
  { metric: "top_question", item: PERGUNTA, total: 2, students: 1 },
  { metric: "unique", item: "", total: 3, students: 3 },
  { metric: "watch_avg", item: "", total: 1730, students: 3 },
  { metric: "watch_max", item: "", total: 3600, students: 3 }
];

const view = buildWebinarReport(readWebinarReportRows(RPC_ROWS));
const encerrada = sessionFromRow(
  sessaoRow({
    ended_at: "2026-11-05T23:31:00.000Z",
    presence_curve: resumoDePresenca(),
    show_live_badge: true,
    simulation_ack_text: "Decisão do produtor em 05/11/2026: o selo fica ligado.",
    simulation_decided_at: "2026-11-05T12:00:00.000Z",
    simulation_decided_by: EQUIPE,
    started_at: "2026-11-05T23:00:00.000Z",
    status: "ended"
  })
);
const replay = sessionFromRow(sessaoRow({ id: REPLAY_ID, kind: "replay", recording_id: GRAVACAO_ID, scheduled_at: "2026-11-05T23:31:00.000Z", source_session_id: SESSAO_ID, status: "live" }));
const people = { [ALUNA]: { email: "ana@exemplo.test", name: "Ana Souza" }, [ALUNO]: { email: "bruno@exemplo.test", name: "Bruno Lima" }, [EQUIPE]: { email: "carla@exemplo.test", name: "Carla Produtora" } };
const poll = { anonymous: false, closedAt: null, id: ENQUETE, kind: "single", openOffsetMs: 300000, openedAt: null, options: [{ id: OPCAO_A, label: "Planilha", position: 0 }, { id: OPCAO_B, label: "Agente", position: 1 }], position: 0, question: "Qual ferramenta você usa?", resultsSharedAt: null, sessionId: SESSAO_ID, status: "closed", templatePollId: null, webinarId: WEBINAR_ID };

const attendee = (userId, extra = {}) => ({
  device: "mobile",
  email: people[userId].email,
  entries: 1,
  firstAt: "2026-11-05T23:00:10.000Z",
  lastAt: "2026-11-05T23:29:40.000Z",
  messages: 2,
  name: people[userId].name,
  polls: 1,
  questions: 0,
  reachedEnd: true,
  reactions: 1,
  registered: true,
  registeredAt: "2026-11-01T12:00:00.000Z",
  score: 100,
  seconds: 1800,
  source: "email",
  userId,
  ...extra
});

function simulacao(extra = {}) {
  return {
    ackText: encerrada.simulationAckText,
    decidedAt: encerrada.simulationDecidedAt,
    decidedByName: "Carla Produtora",
    pending: false,
    realParticipants: 3,
    rules: null,
    script: { byTrigger: { at_offset: 1, manual: 0, on_phrase: 1 }, fired: 2, missed: 1, ready: 3 },
    showLiveBadge: true,
    totals: { counterMax: null, joinsShown: null, saleNoticesShown: null },
    ...extra
  };
}

function pagina(extra = {}) {
  return {
    absenteesReady: true,
    hasReplay: true,
    selected: {
      assistant: { enabled: false, pending: false },
      dropExcerpts: null,
      exportReports: ["registration", "attendee", "performance", "qa", "poll", "survey", "simulacao"],
      attendees: [attendee(ALUNA), attendee(ALUNO, { device: null, entries: 2, firstAt: null, lastAt: null, messages: 1, polls: 0, reachedEnd: false, score: 38, seconds: 0 })],
      csvHref: model.webinarReportCsvHref(WEBINAR_ID, SESSAO_ID),
      durationMs: 1_800_000,
      people,
      polls: model.pollResults(view.polls, [poll]),
      questions: { [PERGUNTA]: { answeredBy: EQUIPE, body: "Funciona no celular?", displayName: "Ana S.", status: "answered" } },
      report: view,
      session: encerrada,
      simulation: simulacao()
    },
    sessions: model.reportSessionOptions(WEBINAR_ID, [encerrada, replay], SESSAO_ID),
    webinar: { durationMinutes: 60, id: WEBINAR_ID, kind: "simulated", registrationRequired: true, slug: "live-de-agentes", status: "published", title: "Live de agentes" },
    ...extra
  };
}

/* ------------------------------------------------------------------------------------------------
 * A tela
 * ---------------------------------------------------------------------------------------------- */

test("a pagina: trilha, titulo, Editar, o seletor de sessao com a sessao marcada e os onze numeros com as definicoes", () => {
  const markup = html(createElement(WebinarReportView, { page: pagina() }));
  const text = textOf(markup);

  assert.match(text, /Webinários/);
  assert.match(markup, /<h1[^>]*>Live de agentes<\/h1>/);
  assert.match(text, /Os números da sessão escolhida, só de alunos\. Atualiza a cada minuto\./);
  assert.match(markup, new RegExp(`href="/admin/comunicacao/webinarios/${WEBINAR_ID}"[^>]*>[^<]*<[^>]*>[^<]*Editar webinário|Editar webinário`));
  assert.match(markup, new RegExp(`aria-current="page"[^>]*href="/admin/comunicacao/webinarios/${WEBINAR_ID}/relatorio\\?sessao=${SESSAO_ID}"`), "a sessao escolhida esta marcada");
  assert.match(markup, new RegExp(`href="/admin/comunicacao/webinarios/${WEBINAR_ID}/relatorio\\?sessao=${REPLAY_ID}"`), "o replay e outra pilula");
  assert.match(text, /Sessão · 05\/11\/2026 às 20:00/);
  assert.match(text, /Replay · 05\/11\/2026 às 20:31/);

  // Os numeros (role="group" com aria-label "rotulo, valor, definicao").
  assert.match(markup, /aria-label="Vagas garantidas, 2, Garantir vaga"/);
  assert.match(markup, /aria-label="Compareceram, 3, pelo menos 30 s na sala"/);
  assert.match(markup, /aria-label="Taxa de comparecimento, 100[^,]*, presentes com vaga ÷ vagas garantidas"/);
  assert.match(markup, /aria-label="Pico de presentes, 3, no melhor momento \(00:00\)"/);
  assert.match(markup, /aria-label="Tempo médio assistido, 29, minutos por aluno presente"/);
  assert.match(markup, /aria-label="Até o fim, 33[^,]*, 95 % do vídeo, sobre quem esteve"/);
  assert.match(markup, /aria-label="Assistiram o replay, 4, desde que o replay abriu"/);
  assert.match(markup, /aria-label="Mensagens, 3, só alunos"/);
  assert.match(markup, /aria-label="Perguntas, 3, na aba Perguntas"/);
  assert.match(markup, /aria-label="Reações, 3, na barra do aluno"/);
  assert.match(markup, /aria-label="Enquetes, 4, opções marcadas"/);
  assert.match(text, /Encerrada/);
  assert.doesNotMatch(text, /Em andamento: a curva/);
});

test("a curva: o resumo (pico, minuto e media), o SVG com as quedas marcadas e a lista das maiores quedas; a tabela por minuto no lugar do grafico", () => {
  const props = { avgPresent: view.presence.avgPresent, curve: view.presence.curve, drops: view.presence.drops, durationMs: 1_800_000, live: false, peak: view.presence.peak };
  const grafico = html(createElement(PresenceCurveCard, props));
  const texto = textOf(grafico);

  assert.match(texto, /Presentes minuto a minuto/);
  assert.match(texto, /Pico de 3 às 00:00; média de 1 presentes\./);
  assert.match(grafico, /<svg[^>]*aria-label="Pico de 3 às 00:00; média de 1 presentes\."[^>]*role="img"/);
  assert.match(grafico, /<path d="M0,0 L[^"]*" fill="currentColor"/, "a area comeca no pico (y = 0)");
  // Duas quedas dentro da duracao (baldes 2 e 41 de 60); a de 71 fica fora do video.
  assert.equal((grafico.match(/<circle /g) ?? []).length, 2);
  assert.match(grafico, /<title>01:00 · 1 saiu<\/title>/);
  assert.match(grafico, /<title>20:30 · 1 saiu<\/title>/);
  assert.match(texto, /Maiores quedas 01:00 · 1 saiu 20:30 · 1 saiu/);
  assert.match(texto, /Ver como tabela/);
  assert.match(texto, /00:00 .*07:30 .*15:00 .*22:00 .*29:30/, "os marcos do eixo");
  assert.doesNotMatch(grafico, /<table/);

  const tabela = html(createElement(PresenceCurveCard, { ...props, initialMode: "table" }));
  assert.match(tabela, /<caption class="sr-only">Presentes minuto a minuto<\/caption>/);
  assert.match(tabela, /<th[^>]*scope="col">Minuto<\/th><th[^>]*scope="col">Presentes<\/th>/);
  assert.match(textOf(tabela), /00:00 3 01:00 2/, "uma linha por minuto com o maior numero de presentes");
  assert.match(textOf(tabela), /Ver como gráfico/);
  assert.doesNotMatch(tabela, /role="img"/, "sem o grafico (o icone do botao e outro svg)");

  const vazia = html(createElement(PresenceCurveCard, { ...props, curve: [], drops: [], peak: null }));
  assert.match(textOf(vazia), /Ninguém mandou sinal de presença ainda\./);
  assert.doesNotMatch(vazia, /role="img"|<table|Ver como/);
});

test("os blocos: chat por minuto e os nomes de profiles em Quem mais comentou e Mais quentes; perguntas, enquetes com rotulos, vagas, replay e a Simulacao a parte", () => {
  const markup = html(createElement(WebinarReportView, { page: pagina() }));
  const text = textOf(markup);

  assert.match(text, /Mensagens por minuto 00:00 2 mensagens · 2 alunos · 100 % 03:00 1 mensagem · 1 aluno · 50 %/);
  assert.match(text, /Quem mais comentou 1\. Ana Souza 2 mensagens 2\. Bruno Lima 1 mensagem/);
  assert.match(text, /Mais quentes 1\. Ana Souza 100 pts 2\. Bruno Lima 65 pts/);
  assert.match(markup, new RegExp(`href="/admin/alunos/${ALUNA}"`), "o nome leva a ficha do aluno");
  assert.match(text, /mensagem 1 \(até 50\), pergunta 2, reação 0,5, enquete 1 e cada 10 min presente 1/);
  assert.match(text, /Reações na barra do aluno 🔥 Fogo 2 · 2 alunos · 67 % 👏 Palmas 1 · 1 aluno · 33 %/, "da mais usada para a menos");
  assert.match(text, /Perguntas Feitas: 3 .*Abertas 1 · 33 % Respondidas 2 · 67 % Dispensadas 0 · 0 %/);
  assert.match(text, /Mais votadas 1\. Funciona no celular\? 2 votos · Respondidas · respondida por Carla Produtora/);
  assert.match(text, /Qual ferramenta você usa\? Planilha 3 · 75 % Agente 1 · 25 %/);
  assert.match(text, /Vagas garantidas 2 Compareceram 2 Não vieram 0 Tempo máximo assistido 1 h/);
  assert.match(text, /De onde veio a vaga Sem link de origem 1 · 50 % email 1 · 50 %/);
  assert.match(text, /Replay .*Vistos 4 Assistido, em média 55 %/);
  assert.match(text, /Simulação Estes números são da simulação e não entram em nenhum outro número\./);
  assert.match(text, /Selo "Ao vivo": ligado · decidido por Carla Produtora em 05\/11\/2026 às 09:00/);
  assert.match(text, /3 itens prontos no roteiro 2 comentários do roteiro entraram · 1 não disparou/);
  assert.match(text, /Decisão do produtor em 05\/11\/2026: o selo fica ligado\./);
  assert.doesNotMatch(markup, /ana@exemplo\.test/, "o e-mail nunca aparece na tela, so no CSV");
});

test("a lista por aluno: nome, vaga, entrou/saiu, tempo, ate o fim, contagens e pontuacao; quem so tem vaga fica com '—'; Baixar CSV aponta para a rota", () => {
  const markup = html(createElement(WebinarReportView, { page: pagina() }));
  const text = textOf(markup);

  assert.match(markup, new RegExp(`href="/api/admin/webinars/${WEBINAR_ID}/relatorio/csv\\?sessao=${SESSAO_ID}"[^>]*>[\\s\\S]*?Baixar CSV`));
  assert.match(text, /Lista por aluno A lista por aluno, com nome e e-mail, nas colunas do relatório Attendee do Zoom\./);
  assert.match(markup, /<caption class="sr-only">Lista por aluno<\/caption>/);
  assert.match(text, /Ana Souza Vaga garantida 01\/11\/2026 às 09:00 email 05\/11\/2026 às 20:00 05\/11\/2026 às 20:29 1 30 min Sim 2 1 0 1 100/);
  assert.match(text, /Bruno Lima Vaga garantida 01\/11\/2026 às 09:00 email — — — — — 1 1 0 0 38/);
  for (const header of ["Aluno", "Vaga", "Entrou", "Saiu", "Entradas", "Tempo na sessão", "Até o fim", "Mensagens", "Reações", "Perguntas", "Enquetes", "Pontuação"]) {
    assert.match(markup, new RegExp(`<th[^>]*scope="col">${header}</th>`), header);
  }
});

test("sessao em andamento: o selo e a nota de que a curva le as amostras; sem replay o numero do replay fica '—'; a Live ao vivo nao tem o bloco Simulacao", () => {
  const aoVivo = sessionFromRow(sessaoRow({ kind: "live", started_at: "2026-11-05T23:00:00.000Z", status: "live" }));
  const page = pagina({ hasReplay: false, selected: { ...pagina().selected, session: aoVivo }, sessions: model.reportSessionOptions(WEBINAR_ID, [aoVivo], SESSAO_ID), webinar: { ...pagina().webinar, kind: "live" } });
  const markup = html(createElement(WebinarReportView, { page }));
  const text = textOf(markup);

  assert.match(text, /Em andamento: a curva lê as amostras ao vivo e muda a cada minuto\./);
  assert.match(markup, /aria-label="Assistiram o replay, —"/);
  assert.doesNotMatch(text, /Estes números são da simulação/);
  assert.doesNotMatch(text, /Vistos 4/);
  assert.match(text, /Live ao vivo · 05\/11\/2026 às 20:00/);
});

test("estado vazio antes da primeira sessao, e o skeleton na forma final", () => {
  const markup = html(createElement(WebinarReportView, { page: pagina({ hasReplay: false, selected: null, sessions: [] }) }));
  const text = textOf(markup);

  assert.match(text, /Nenhuma sessão começou ainda/);
  assert.match(text, /Os números aparecem depois da primeira sessão\./);
  assert.doesNotMatch(markup, /aria-label="Vagas garantidas/);
  assert.doesNotMatch(markup, /Baixar CSV/);

  const skeleton = html(createElement(WebinarReportSkeleton));
  assert.match(skeleton, /role="status"[^>]*>Carregando o relatório</);
  assert.doesNotMatch(skeleton, /Vagas garantidas/);
});

/* ------------------------------------------------------------------------------------------------
 * A parte pura (report-page-model.ts)
 * ---------------------------------------------------------------------------------------------- */

test("modelo: os onze numeros ('—' sem base), as sessoes com relatorio e a padrao, os enderecos", () => {
  const kpis = model.reportKpis(view, { hasReplay: true });
  assert.deepEqual(
    kpis.map((kpi) => [kpi.id, kpi.value, kpi.format]),
    [
      ["registered", 2, "number"],
      ["attended", 3, "number"],
      ["rate", 100, "percent"],
      ["peak", 3, "number"],
      ["watchAvg", 29, "number"],
      ["reachedEnd", 33, "percent"],
      ["replay", 4, "number"],
      ["messages", 3, "number"],
      ["questions", 3, "number"],
      ["reactions", 3, "number"],
      ["polls", 4, "number"]
    ]
  );
  const vazio = model.reportKpis(buildWebinarReport([]), { hasReplay: false });
  assert.deepEqual(vazio.map((kpi) => kpi.value), [0, 0, null, null, null, null, null, 0, 0, 0, 0]);
  assert.equal(vazio.find((kpi) => kpi.id === "peak")?.definition, "no melhor momento (—)");

  const futura = sessionFromRow(sessaoRow({ id: "33333333-aaaa-4aaa-8aaa-333333333333", scheduled_at: "2026-11-07T23:00:00.000Z" }));
  const cancelada = sessionFromRow(sessaoRow({ id: "44444444-aaaa-4aaa-8aaa-444444444444", status: "cancelled" }));
  const anterior = sessionFromRow(sessaoRow({ id: "55555555-aaaa-4aaa-8aaa-555555555555", scheduled_at: "2026-11-04T23:00:00.000Z", status: "ended" }));
  const ordem = model.reportableSessions([replay, futura, encerrada, cancelada, anterior]);
  assert.deepEqual(ordem.map((session) => session.id), [anterior.id, encerrada.id, replay.id], "horas marcadas em ordem, o replay por ultimo");
  assert.equal(model.defaultReportSessionId(ordem), encerrada.id, "a ultima hora marcada que ja comecou");
  assert.equal(model.defaultReportSessionId([replay]), replay.id, "so o replay: o replay");
  assert.equal(model.defaultReportSessionId([]), null);
  assert.equal(model.webinarReportHref(WEBINAR_ID), `/admin/comunicacao/webinarios/${WEBINAR_ID}/relatorio`);
  assert.equal(model.webinarReportHref(WEBINAR_ID, SESSAO_ID), `/admin/comunicacao/webinarios/${WEBINAR_ID}/relatorio?sessao=${SESSAO_ID}`);
  assert.equal(model.reportSessionLabel(replay), "Replay · 05/11/2026 às 20:31");
});

test("modelo: a geometria da curva (um ponto por balde ate o fim, baldes vazios valem 0, quedas e marcos) e a tabela por minuto", () => {
  const geometry = model.curveGeometry({ curve: view.presence.curve, drops: view.presence.drops, durationMs: 1_800_000, height: 100, live: false, width: 590 });
  assert.equal(geometry.totalBuckets, 60);
  assert.equal(geometry.points.length, 60);
  assert.deepEqual(geometry.points[0], { b: 0, n: 3, x: 0, y: 0 });
  assert.deepEqual(geometry.points[2], { b: 2, n: 2, x: 20, y: 33.3 });
  assert.deepEqual(geometry.points[3], { b: 3, n: 0, x: 30, y: 100 }, "balde sem amostra vale 0");
  assert.deepEqual(geometry.peak, { b: 0, n: 3, x: 0, y: 0 });
  assert.equal(geometry.peakN, 3);
  assert.ok(geometry.line.startsWith("M0,0 L10,0 L20,33.3 L30,100"));
  assert.ok(geometry.area.endsWith(" L590,100 L0,100 Z"));
  assert.deepEqual(geometry.ticks.map((tick) => tick.label), ["00:00", "07:30", "15:00", "22:00", "29:30"]);
  assert.deepEqual(geometry.drops.map((drop) => [drop.b, drop.left, drop.label]), [
    [2, 1, "01:00 · 1 saiu"],
    [41, 1, "20:30 · 1 saiu"]
  ]);

  const aoVivo = model.curveGeometry({ curve: view.presence.curve, drops: [], durationMs: 1_800_000, height: 100, live: true, width: 100 });
  assert.equal(aoVivo.totalBuckets, 3, "em andamento, so ate o ultimo balde com sinal");
  assert.deepEqual(aoVivo.ticks.map((tick) => tick.label), ["00:00", "00:30", "01:00"]);

  const vazia = model.curveGeometry({ curve: [], drops: [], durationMs: 60_000, height: 100, live: true, width: 100 });
  assert.equal(vazia.points.length, 1);
  assert.equal(vazia.peak, null);

  assert.deepEqual(model.curveByMinute(view.presence.curve), [
    { label: "00:00", minute: 0, present: 3 },
    { label: "01:00", minute: 1, present: 2 }
  ]);
  assert.deepEqual(model.curveByMinute([{ b: -2, n: 5 }, { b: 4, n: 1 }, { b: 5, n: 7 }]), [{ label: "02:00", minute: 2, present: 7 }], "espera (balde negativo) fica fora; o minuto fica com o maior");
});

test("modelo: barras (mensagens por minuto, reacoes, origem, perguntas), enquetes por opcao e a Simulacao", () => {
  assert.deepEqual(model.messagesPerMinuteBars(view.chat.perMinute), [
    { id: "0", label: "00:00", percent: 100, students: 2, total: 2 },
    { id: "3", label: "03:00", percent: 50, students: 1, total: 1 }
  ]);
  assert.deepEqual(
    model.reactionBars(view.reactions.byType).map((bar) => [bar.id, bar.label, bar.total, bar.percent]),
    [
      ["fire", "🔥 Fogo", 2, 67],
      ["clap", "👏 Palmas", 1, 33]
    ],
    "da mais usada para a menos, so as que aconteceram"
  );
  assert.deepEqual(model.registrationSourceBars(view.registration), [
    { id: "none", label: "Sem link de origem", percent: 50, students: null, total: 1 },
    { id: "email", label: "email", percent: 50, students: null, total: 1 }
  ]);
  assert.deepEqual(model.questionStatusBars(view.questions).map((bar) => [bar.label, bar.total, bar.percent]), [
    ["Abertas", 1, 33],
    ["Respondidas", 2, 67],
    ["Dispensadas", 0, 0]
  ]);
  assert.equal(model.questionsTotal(view.questions), 3);

  const semRotulo = model.pollResults(view.polls, []);
  assert.equal(semRotulo[0].question, "Enquetes", "enquete sem linha em webinar_polls: a pergunta generica e os ids como rotulo");
  assert.equal(semRotulo[0].options[0].label, OPCAO_A);
  const comRotulo = model.pollResults(view.polls, [poll, { ...poll, id: "c2c2c2c2-0000-4000-8000-000000000002", options: [{ id: "x", label: "Só uma", position: 0 }], question: "Sem resposta" }]);
  assert.deepEqual(comRotulo.map((result) => [result.question, result.total, result.options.map((option) => option.percent)]), [
    ["Qual ferramenta você usa?", 4, [75, 25]],
    ["Sem resposta", 0, [null]]
  ]);

  assert.deepEqual(
    model.simulationLines(simulacao({ ackText: null, decidedAt: null, decidedByName: null, script: { byTrigger: model.emptyScriptByTrigger(), fired: 0, missed: 0, ready: 1 }, showLiveBadge: false })),
    [
      'Selo "Ao vivo": desligado · sem decisão registrada',
      "1 item pronto no roteiro",
      "0 comentários do roteiro entraram · 0 não dispararam",
      "Comentários do roteiro por Solta em: Num minuto do vídeo 0 · Quando o apresentador diz 0 · Pelo botão da equipe 0"
    ],
    "sem as regras da fase 4 (banco sem a 202610300003), so o selo e o roteiro"
  );
  assert.deepEqual(
    model.simulationLines(
      simulacao({
        realParticipants: 31,
        rules: { countMode: "curve", joins: { enabled: true, everySeconds: 60, max: 30 }, saleNotices: { enabled: false, items: 0 } },
        totals: { counterMax: 240, joinsShown: 18, saleNoticesShown: null }
      })
    ),
    [
      'Selo "Ao vivo": ligado · decidido por Carla Produtora em 05/11/2026 às 09:00',
      "Contador simulado: real + faixa que varia · maior número mostrado: 240 · participantes de verdade: 31",
      "Entradas simuladas: 18 apareceram",
      "Avisos de venda simulados: desligado",
      "3 itens prontos no roteiro",
      "2 comentários do roteiro entraram · 1 não disparou",
      "Comentários do roteiro por Solta em: Num minuto do vídeo 1 · Quando o apresentador diz 1 · Pelo botão da equipe 0"
    ]
  );
  assert.equal(
    model.simulationLines(simulacao({ realParticipants: 4, rules: { countMode: "off", joins: { enabled: false, everySeconds: 60, max: 30 }, saleNotices: { enabled: true, items: 2 } }, totals: { counterMax: 9, joinsShown: null, saleNoticesShown: 1 } }))[1],
    "Contador simulado: real · participantes de verdade: 4",
    "contador desligado: so o real"
  );
});

test("modelo: a pontuacao (M3), 'Saiu' = ultima amostra + 15 s, a linha e o nome do CSV", () => {
  const base = { entries: 1, firstAt: "2026-11-05T23:00:10.000Z", lastAt: "2026-11-05T23:29:40.000Z", messages: 0, polls: 0, questions: 0, reachedEnd: false, reactions: 0, registered: true, seconds: 0, source: null };
  assert.equal(model.attendeeScorePoints({ messages: 60, polls: 1, questions: 2, reactions: 3, seconds: 1250 }), 50 + 1 + 4 + 1.5 + 2);
  const scores = model.attendeeScores([
    { ...base, messages: 60, userId: "a" },
    { ...base, messages: 10, seconds: 601, userId: "b" },
    { ...base, userId: "c" }
  ]);
  assert.deepEqual([...scores.entries()], [
    ["a", 100],
    ["b", 22],
    ["c", 0]
  ]);
  assert.deepEqual([...model.attendeeScores([]).entries()], []);
  assert.equal(model.attendeeLeftAtIso("2026-11-05T23:29:40.000Z"), "2026-11-05T23:29:55.000Z");
  assert.equal(model.attendeeLeftAtIso(null), null);
  assert.equal(model.attendeeTimeLabel(0), "—");
  assert.equal(model.attendeeTimeLabel(1800), "30 min");

  assert.deepEqual(model.attendeeCsvRow(attendee(ALUNA)), ["Sim", "Ana Souza", "ana@exemplo.test", "01/11/2026 às 09:00", "05/11/2026 às 20:00", "05/11/2026 às 20:29", 1, 30, "Sim", 2, 1, 0, 1, "", 100, "celular"]);
  assert.deepEqual(model.attendeeCsvRow(attendee(ALUNO, { device: "desktop", email: null, firstAt: null, lastAt: null, registered: false, registeredAt: null, score: 0, seconds: 0 })), ["Não", "Bruno Lima", "", "", "", "", "", "", "", 2, 1, 0, 1, "", 0, "computador"]);
  assert.equal(model.ATTENDEE_CSV_HEADERS.length, 16);
  assert.equal(model.attendeeCsvFileName("live-de-agentes", "2026-11-05T23:00:00.000Z"), "webinario-live-de-agentes-2026-11-05-2000-attendee.csv");
  assert.equal(model.deviceLabel("mobile"), "celular");
  assert.equal(model.deviceLabel(null), "");
  assert.equal(model.toDevice("tablet"), null);
  assert.equal(model.personName(people, "ninguem"), "Aluno");
});

/* ------------------------------------------------------------------------------------------------
 * Fase 4: Exportar, Oferta, Respostas do Assistente, Simulacao completa, trechos das quedas e sessoes jit
 * ---------------------------------------------------------------------------------------------- */

const { WebinarExportMenu } = await import("../src/components/admin/v2/communication/webinars/export-menu.tsx");

const viewV4 = buildWebinarReport(
  readWebinarReportRows([
    ...RPC_ROWS,
    { metric: "offer", item: "seen", total: 3, students: 3 },
    { metric: "offer", item: "clicks", total: 3, students: 2 },
    { metric: "offer", item: "purchases", total: 1, students: 1 },
    { metric: "offer", item: "A:seen", total: 1, students: 1 },
    { metric: "offer", item: "B:seen", total: 2, students: 2 },
    { metric: "offer", item: "B:clicks", total: 2, students: 2 },
    { metric: "offer", item: "B:purchases", total: 1, students: 1 },
    { metric: "offer_revenue", item: "BRL", total: 197000, students: 1 },
    { metric: "ai", item: "replies", total: 5, students: 0 },
    { metric: "ai", item: "avg_seconds", total: 7, students: 5 },
    { metric: "ai", item: "edited", total: 1, students: 0 },
    { metric: "ai", item: "deleted", total: 2, students: 0 },
    { metric: "ai", item: "handoffs", total: 3, students: 0 },
    { metric: "sim_counter", item: "max", total: 240, students: 0 },
    { metric: "sim_joins", item: "shown", total: 18, students: 0 },
    { metric: "sim_sales", item: "shown", total: 2, students: 0 }
  ])
);

function paginaV4(selected = {}) {
  const base = pagina();
  return { ...base, selected: { ...base.selected, report: viewV4, ...selected } };
}

test("o botao Exportar no topo da sessao: um menu (aria-haspopup) com 44 px a 375 px; sem periodo valido no painel, nada", () => {
  const markup = html(createElement(WebinarReportView, { page: paginaV4() }));
  assert.match(markup, /<button[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*class="[^"]*max-md:h-11[^"]*"[^>]*>.*?Exportar/);

  const sozinho = html(createElement(WebinarExportMenu, { scope: "session", sessionId: SESSAO_ID, webinarId: WEBINAR_ID }));
  assert.match(sozinho, /aria-haspopup="menu"/);
  assert.match(textOf(sozinho), /^Exportar$/);
  assert.equal(html(createElement(WebinarExportMenu, { end: "x", kind: "live", scope: "panel", start: "y" })), "");
  assert.match(html(createElement(WebinarExportMenu, { end: "2026-12-01T03:00:00.000Z", kind: "simulated", scope: "panel", start: "2026-11-01T03:00:00.000Z" })), /Exportar/);
});

test("o bloco Oferta (so com oferta): viram, cliques, compras, receita, conversao e a tabela por variante", () => {
  const text = textOf(html(createElement(WebinarReportView, { page: paginaV4() })));
  assert.match(text, /Oferta Viram a oferta: presentes na janela da oferta/);
  assert.match(text, /Viram a oferta 3 Cliques 2 Compras 1 Receita R\$\s1\.970,00 Conversão 33 % · 50 % dos cliques/);
  assert.match(text, /Por variante Variante Viram a oferta Cliques Compras Conversão Variante A 1 0 0 0 % Variante B 2 2 1 50 %/);
  assert.match(text, /Compras: pelos webhooks de venda, em até 7 dias depois do clique/);

  const sem = textOf(html(createElement(WebinarReportView, { page: pagina() })));
  assert.doesNotMatch(sem, /Viram a oferta/, "sessao sem oferta: sem o bloco");

  const semValor = model.offerFacts({ ...viewV4, offer: { ...viewV4.offer, revenue: [] } });
  assert.deepEqual(semValor.find((fact) => fact.label === "Receita"), { label: "Receita", value: "—" }, "receita sem valor gravado: '—' (M8)");
});

test("o bloco Respostas do Assistente: os cinco numeros; ligado sem resposta, a frase; banco sem a 202610300004, o aviso; desligado e sem resposta, nada", () => {
  const ligado = textOf(html(createElement(WebinarReportView, { page: paginaV4({ assistant: { enabled: true, pending: false } }) })));
  assert.match(ligado, /Respostas do Assistente Respostas reais a alunos reais: ficam fora da Simulação e das mensagens de alunos e equipe\./);
  assert.match(ligado, /Respostas 5 Tempo médio de resposta 7 s Corrigidas pela equipe 1 Apagadas pela equipe 2 Pediram para falar com a equipe 3/);

  const semResposta = textOf(html(createElement(WebinarReportView, { page: pagina({ selected: { ...pagina().selected, assistant: { enabled: true, pending: false } } }) })));
  assert.match(semResposta, /Respostas do Assistente .*O Assistente não respondeu nesta sessão\./);

  const pendente = textOf(html(createElement(WebinarReportView, { page: pagina({ selected: { ...pagina().selected, assistant: { enabled: false, pending: true } } }) })));
  assert.match(pendente, /Esta parte precisa da atualização do banco \(migração 202610300004\)\./);

  assert.doesNotMatch(textOf(html(createElement(WebinarReportView, { page: pagina() }))), /Respostas do Assistente/);
  assert.deepEqual(model.assistantFacts({ ...viewV4, assistant: { ...viewV4.assistant, avgSeconds: null } })[1], { label: "Tempo médio de resposta", value: "—" });
});

test("a Simulacao completa: o contador com o real ao lado, entradas, avisos de venda e o roteiro por Solta em; sem a 202610300003, o aviso no bloco", () => {
  const regras = { countMode: "curve", joins: { enabled: true, everySeconds: 60, max: 30 }, saleNotices: { enabled: true, items: 2 } };
  const text = textOf(html(createElement(WebinarReportView, { page: paginaV4({ simulation: simulacao({ rules: regras, totals: viewV4.simulation }) }) })));
  assert.match(text, /Simulação Estes números são da simulação e não entram em nenhum outro número\./);
  assert.match(text, /Contador simulado: real \+ faixa que varia · maior número mostrado: 240 · participantes de verdade: 3/);
  assert.match(text, /Entradas simuladas: 18 apareceram Avisos de venda simulados: 2 apareceram/);
  assert.match(text, /Comentários do roteiro por Solta em: Num minuto do vídeo 1 · Quando o apresentador diz 1 · Pelo botão da equipe 0/);

  const pendente = textOf(html(createElement(WebinarReportView, { page: paginaV4({ simulation: simulacao({ pending: true }) }) })));
  assert.match(pendente, /Simulação .*Esta parte precisa da atualização do banco \(migração 202610300003\)\./);
});

test("os pontos de queda com o trecho da transcricao daquele minuto; sem cue no minuto, a frase; sem transcricao, a lista de sempre", () => {
  const props = { avgPresent: view.presence.avgPresent, curve: view.presence.curve, drops: view.presence.drops, durationMs: 1_800_000, live: false, peak: view.presence.peak };
  const comTrecho = textOf(html(createElement(PresenceCurveCard, { ...props, dropExcerpts: { 2: "Agora vamos ver o preço", 41: null } })));
  assert.match(comTrecho, /Maiores quedas 01:00 · 1 saiu No vídeo, nesse minuto: “Agora vamos ver o preço” 20:30 · 1 saiu Sem transcrição deste trecho\./);
  const semTranscricao = textOf(html(createElement(PresenceCurveCard, { ...props, dropExcerpts: null })));
  assert.doesNotMatch(semTranscricao, /No vídeo|Sem transcrição/);

  const cues = [
    { endSeconds: 58, startSeconds: 50, text: "antes do minuto" },
    { endSeconds: 66, startSeconds: 59, text: " Agora " },
    { endSeconds: 80, startSeconds: 70, text: "vamos ver o preço." },
    { endSeconds: 130, startSeconds: 125, text: "depois" }
  ];
  assert.equal(model.dropExcerpt(2, cues), "Agora vamos ver o preço.", "o balde 2 (01:00) pega as cues que tocam o minuto 1");
  assert.equal(model.dropExcerpt(10, cues), null);
  assert.equal(model.dropExcerpt(2, [{ endSeconds: null, startSeconds: 61, text: "x".repeat(400) }]).length, 180, "trecho cortado com reticencias");
  assert.deepEqual(model.dropExcerpts([{ b: 2, n: 1 }, { b: 10, n: 1 }], cues), { 2: "Agora vamos ver o preço.", 10: null });
  assert.equal(model.dropExcerpts([{ b: 2, n: 1 }], null), null);
});

test("o seletor: as sessoes 'Comeca quando voce entra' so dos ultimos 7 dias, da mais nova para a mais velha, depois das marcadas; a padrao e a mais recente", () => {
  const agora = Date.parse("2026-11-10T12:00:00.000Z");
  const marcada = sessionFromRow(sessaoRow({ id: "a0000000-0000-4000-8000-000000000001", scheduled_at: "2026-11-01T23:00:00.000Z", status: "ended" }));
  const jit = (id, iso) => sessionFromRow(sessaoRow({ id, jit: true, scheduled_at: iso, status: "ended" }));
  const ontem = jit("a0000000-0000-4000-8000-000000000002", "2026-11-09T14:15:00+00:00");
  const anteontem = jit("a0000000-0000-4000-8000-000000000003", "2026-11-08T14:15:00.000Z");
  const velha = jit("a0000000-0000-4000-8000-000000000004", "2026-11-02T14:15:00.000Z");
  const ordem = model.reportableSessions([velha, anteontem, replay, marcada, ontem], agora);

  assert.deepEqual(ordem.map((session) => session.id), [marcada.id, ontem.id, anteontem.id, replay.id], "a de 8 dias fica fora");
  assert.equal(model.defaultReportSessionId(ordem), ontem.id, "a padrao e a hora mais recente que ja comecou");
  assert.equal(model.REPORT_JIT_DAYS, 7);
});

test("a lista por aluno da sessao gravada (§3.4.1): a coluna Oferta clicada com a variante, '—' sem clique; na Live ao vivo, sem a coluna", () => {
  const markup = html(createElement(WebinarReportView, { page: paginaV4({ offerClicked: { [ALUNA]: "B" } }) }));
  const tabela = markup.slice(markup.indexOf('id="webinario-relatorio-alunos"'));
  const texto = textOf(tabela);
  assert.match(texto, /Enquetes Oferta clicada Pontuação/, "antes da Pontuacao, como no Attendee do Zoom");
  assert.match(tabela, /<td[^>]*>B<\/td>/, "a aluna clicou na variante B");
  assert.match(tabela, /<td[^>]*>—<\/td>/, "o aluno sem clique fica com '—'");

  const aoVivo = textOf(html(createElement(WebinarReportView, { page: paginaV4({ offerClicked: null }) })));
  assert.doesNotMatch(aoVivo, /Oferta clicada/);
});

test("o bloco Vagas (§3.4): com quem garantiu vaga e nao veio, 'Avisar quem não veio' abre o aviso novo com as regras da live; sem faltosos, nada", () => {
  const comFaltosos = { ...viewV4, registration: { ...viewV4.registration, absent: 2 } };
  const markup = html(createElement(WebinarReportView, { page: paginaV4({ report: comFaltosos }) }));
  const vagas = markup.slice(markup.indexOf('aria-labelledby="webinario-relatorio-vagas"'));
  // O mesmo endereco do card Avisar (?webinario=&tipo=) com as duas regras em ?seguimento= (webinarNoticeHref).
  const href = `/admin/comunicacao/avisos/novo?webinario=${WEBINAR_ID}&amp;tipo=notificacao&amp;seguimento=registered%2Cnao-attended`;
  assert.ok(vagas.includes(`href="${href}"`), "o link com as duas regras");
  assert.match(textOf(vagas), /> Vagas Garantir vaga Avisar quem não veio Vagas garantidas/);

  const semFaltosos = html(createElement(WebinarReportView, { page: paginaV4({ report: { ...viewV4, registration: { ...viewV4.registration, absent: 0 } } }) }));
  assert.doesNotMatch(textOf(semFaltosos), /Avisar quem não veio/);
});

test("'Avisar quem não veio' numa live de duas sessoes: as regras valem para a live inteira, entao so abre quando nenhuma sessao esta por acontecer", () => {
  // S1 na segunda (encerrada), S2 na quarta (marcada). O relatorio de S1 mostra "Não vieram: 2"; o aluno com vaga em S2
  // entraria no "garantiu vaga E não participou" antes da live dele.
  const S2 = "33333333-aaaa-4aaa-8aaa-333333333333";
  const s1 = sessionFromRow(sessaoRow({ ended_at: "2026-11-02T23:31:00.000Z", scheduled_at: "2026-11-02T23:00:00.000Z", started_at: "2026-11-02T23:00:00.000Z", status: "ended" }));
  const s2 = sessionFromRow(sessaoRow({ id: S2, scheduled_at: "2026-11-04T23:00:00.000Z", status: "scheduled" }));
  const terca = Date.parse("2026-11-03T15:00:00.000Z");
  const pronto = model.absenteesNoticeReady([s1, s2, replay], 60, terca);
  assert.equal(pronto, false, "S2 ainda vai acontecer");

  const comFaltosos = { ...viewV4, registration: { ...viewV4.registration, absent: 2 } };
  const markup = html(createElement(WebinarReportView, { page: { ...paginaV4({ report: comFaltosos, session: s1 }), absenteesReady: pronto, sessions: model.reportSessionOptions(WEBINAR_ID, [s1], s1.id) } }));
  const vagas = markup.slice(markup.indexOf('aria-labelledby="webinario-relatorio-vagas"'));
  assert.doesNotMatch(vagas, /seguimento=/, "sem link para o aviso");
  assert.match(vagas, /<span aria-describedby="webinario-relatorio-avisar-depois" aria-disabled="true"[^>]*>.*?Avisar quem não veio<\/span>/);
  assert.match(textOf(vagas), /Avisar quem não veio Disponível quando todas as sessões desta live terminarem\./);

  // Na quarta, S2 no ar: continua desligado; depois do fim de S2 (ou com S2 cancelada), abre.
  assert.equal(model.absenteesNoticeReady([s1, { ...s2, startedAt: s2.scheduledAt, status: "live" }, replay], 60, Date.parse("2026-11-04T23:20:00.000Z")), false, "S2 no ar");
  assert.equal(model.absenteesNoticeReady([s1, { ...s2, endedAt: "2026-11-04T23:40:00.000Z", status: "ended" }, replay], 60, Date.parse("2026-11-05T12:00:00.000Z")), true, "as duas encerradas");
  assert.equal(model.absenteesNoticeReady([s1, { ...s2, status: "cancelled" }], 60, terca), true, "S2 cancelada");
  assert.equal(model.absenteesNoticeReady([s1, s2], 60, Date.parse("2026-11-05T12:00:00.000Z")), true, "S2 nunca abriu e passou do fim + 2 h");
  // As sessoes do "Começa quando você entra" nunca tem vaga: uma marcada para daqui a pouco nao segura o botao.
  assert.equal(model.absenteesNoticeReady([s1, { ...s2, jit: true }], 60, terca), true, "jit nao conta");

  const aberto = html(createElement(WebinarReportView, { page: { ...paginaV4({ report: comFaltosos, session: s1 }), absenteesReady: true } }));
  assert.match(aberto, /seguimento=registered%2Cnao-attended/);
  assert.match(aberto, /title="Abre um aviso novo para quem garantiu vaga em qualquer sessão desta live e não entrou em nenhuma/);
  assert.doesNotMatch(textOf(aberto), /Disponível quando todas as sessões/);
});
