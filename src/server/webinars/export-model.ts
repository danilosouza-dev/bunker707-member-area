// Os CSVs com os nomes do Zoom e o extra da Simulacao, a parte pura (docs/30 §2.9, §3.4, §3.5, §3.7, M6, M8, M9, A20 e
// A25): as colunas de WEBINAR_COPY.exportar.colunas na ordem de §3.7, uma linha por vaga (Registration), por aluno
// (Attendee, com a variante da Oferta clicada e o aparelho do webinar_joined; sem pais nem rede, A25), por sessao
// (Performance: a da sessao ou todas do periodo do painel, com a frase de que a simulacao nao entra), por pergunta
// (Q&A: "Aluno {n}" e o e-mail vazio na anonima; a resposta do Assistente aparece como "Assistente"), por resposta
// (Poll e Survey: anonima sem nome nem e-mail; sem pesquisa do fim, so o cabecalho) e por item simulado (Simulacao,
// so a sessao gravada, com a frase da simulacao). Datas em Sao Paulo (formatSaoPauloDateTime), arquivo por toCsv
// (BOM, ponto e virgula, CRLF, sem formula) e o nome por webinarExportFileName. Tambem: o pedido das rotas (os
// parametros em portugues, validados por webinarExportSchema), os filtros dos paineis nos enderecos e o menu Exportar.
//
// Sem "server-only", imports relativos: tests/webinarios-exportar-*.test.mjs carregam direto pelo Node. M6: nenhuma
// linha simulada sai num CSV real; os leitores da Performance nunca tocam nas linhas `sim_*` do painel nem no roteiro
// (a guarda de tests/webinarios-exportar-modelo.test.mjs varre este arquivo: `sim_`, `scripted` e as colunas
// `simulat*` so aparecem nas funcoes da Simulacao). M9: nada aqui guarda cache; nome e e-mail so nas linhas dos CSVs.

import { ADMIN_PRODUCT_PARAM } from "../../components/admin/v2/filters";
import { toCsv, type CsvCell } from "../../lib/csv";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { saoPauloDayKey } from "../../lib/webinar-time";
import { formatSaoPauloDateTime } from "../communications/campaign-model";
import { EXPORT_PARAMS, PANEL_KIND_PARAMS, webinarPanelExportHref, webinarSessionExportHref } from "./export-links";
import { panelFiltersSchema, panelPeriodSchema, webinarExportSchema, type PanelFilters } from "./export-schemas";
import {
  OFFER_VARIANT_LABELS,
  WEBINAR_EXPORT_LIMITS,
  WEBINAR_EXPORT_REPORTS,
  toTime,
  webinarExportFileName,
  type AnswerSource,
  type OfferVariantLabel,
  type PanelRow,
  type Poll,
  type QuestionStatus,
  type RegistrationStatus,
  type ScriptTrigger,
  type SessionKind,
  type SessionSimulation,
  type SessionStatus,
  type WebinarExportReport
} from "./model";
import { bucketLabel, percentOf, watchTimeLabel, type WebinarReportView } from "./report-model";
import { attendeeCsvRow, webinarSessionExportKey, type ReportAttendee, type ReportPerson } from "./report-page-model";
import { anonymousNumber } from "./room-model";

const EXPORTAR = WEBINAR_COPY.exportar;
const VALORES = EXPORTAR.valores;
const NO_NAME = WEBINAR_COPY.relatorio.alunoSemNome;

/** As colunas de cada CSV, na ordem de §3.7 (o Attendee e o mesmo da lista por aluno). */
export const EXPORT_COLUMNS: Record<WebinarExportReport, readonly string[]> = EXPORTAR.colunas;

/** As colunas do CSV Simulacao do periodo: qual webinario, qual sessao e quando, depois as de §3.7. */
export const PERIOD_SIMULATION_COLUMNS: readonly string[] = [...EXPORTAR.colunasDoPeriodo.simulacao, ...EXPORTAR.colunas.simulacao];

/** A frase que abre o arquivo (§3.7): o Performance diz que a simulacao nao entra; o Simulacao, que e so dela. */
const OPENING_SENTENCE: Partial<Record<WebinarExportReport, string>> = {
  performance: EXPORTAR.cabecalhoPerformance,
  simulacao: EXPORTAR.cabecalhoSimulacao
};

export type ExportCsv = { count: number; csv: string; fileName: string };

const yesNo = (value: boolean) => (value ? VALORES.sim : VALORES.nao);
const when = (iso: string | null | undefined) => (iso ? formatSaoPauloDateTime(iso) : "");
const percentCell = (value: number | null) => (value === null ? "" : `${value} %`);
const byInstant = (left: string, right: string) => toTime(left) - toTime(right);

/**
 * O texto do arquivo: a frase de abertura (Performance e Simulacao) numa linha so, o cabecalho e as linhas, no
 * maximo WEBINAR_EXPORT_LIMITS.rowsMax (o CSV inteiro numa resposta, sem cache, M9).
 */
export function exportCsvText(report: WebinarExportReport, rows: readonly (readonly CsvCell[])[], headers: readonly string[] = EXPORT_COLUMNS[report]): string {
  const body = rows.slice(0, WEBINAR_EXPORT_LIMITS.rowsMax);
  const sentence = OPENING_SENTENCE[report];

  return sentence ? toCsv([sentence], [headers, ...body]) : toCsv(headers, body);
}

/** O nome do arquivo de uma sessao: `webinario-{slug}-{AAAA-MM-DD-HHMM}-{relatorio}.csv` (a hora marcada em Sao Paulo). */
export function sessionExportFileName(input: { report: WebinarExportReport; scheduledAt: string; slug: string }) {
  return webinarExportFileName({ report: input.report, sessionKey: webinarSessionExportKey(input.scheduledAt), slug: input.slug });
}

/** O periodo no nome: `periodo-AAAA-MM-DD-a-AAAA-MM-DD` (dias de Sao Paulo; o fim e exclusivo, por isso o ultimo instante antes dele). */
export function periodExportKey(start: string, end: string) {
  return `periodo-${saoPauloDayKey(start)}-a-${saoPauloDayKey(Math.max(toTime(start), toTime(end) - 1))}`;
}

/** O nome do arquivo do painel: `webinario-{ao-vivo|gravadas}-periodo-...-{relatorio}.csv`. */
export function panelExportFileName(input: { end: string; kind: "live" | "simulated"; report: "performance" | "simulacao"; start: string }) {
  return webinarExportFileName({ report: input.report, sessionKey: periodExportKey(input.start, input.end), slug: PANEL_KIND_PARAMS[input.kind] });
}

/** "mm:ss" do relogio do video (os minutos passam de 59 num video longo); antes de comecar, "-00:30". */
export function videoMinuteLabel(offsetMs: number | null | undefined): string {
  if (offsetMs === null || offsetMs === undefined || !Number.isFinite(offsetMs)) {
    return "";
  }
  const total = Math.floor(Math.abs(offsetMs) / 1000);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${offsetMs < 0 ? "-" : ""}${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

const nameOf = (people: Record<string, ReportPerson>, userId: string) => people[userId]?.name || NO_NAME;
const emailOf = (people: Record<string, ReportPerson>, userId: string) => people[userId]?.email ?? "";

/* ------------------------------------------------------------------------------------------------
 * Registration: uma linha por vaga
 * ---------------------------------------------------------------------------------------------- */

export type RegistrationExportInput = {
  registeredAt: string;
  reminder1hSentAt: string | null;
  reminder24hSentAt: string | null;
  source: string | null;
  sourceCampaignId: string | null;
  status: RegistrationStatus;
  userId: string;
};

/**
 * Nome, e-mail, a hora da vaga, Vaga garantida/Cancelada, o link de origem (?origem=), o aviso que trouxe
 * (source_campaign_id), Compareceu e Viu o replay (Sim/Nao) e a hora em que cada lembrete saiu. Na ordem da vaga.
 */
export function registrationExportRows(input: {
  people: Record<string, ReportPerson>;
  present: ReadonlySet<string>;
  registrations: readonly RegistrationExportInput[];
  replayViewers: ReadonlySet<string>;
}): CsvCell[][] {
  return [...input.registrations]
    .sort((left, right) => byInstant(left.registeredAt, right.registeredAt))
    .map((registration) => [
      nameOf(input.people, registration.userId),
      emailOf(input.people, registration.userId),
      when(registration.registeredAt),
      registration.status === "cancelled" ? VALORES.cancelada : VALORES.vagaGarantida,
      registration.source ?? "",
      registration.sourceCampaignId ?? "",
      yesNo(input.present.has(registration.userId)),
      yesNo(input.replayViewers.has(registration.userId)),
      when(registration.reminder24hSentAt),
      when(registration.reminder1hSentAt)
    ]);
}

/* ------------------------------------------------------------------------------------------------
 * Attendee: a lista por aluno com a variante da Oferta clicada
 * ---------------------------------------------------------------------------------------------- */

/** A variante clicada por aluno na sessao ("B"; mais de uma oferta na mesma sessao: "A, B"), na ordem A a D. */
export function offerClickedByUser(clicks: readonly { userId: string; variantLabel: OfferVariantLabel | string }[]): Map<string, string> {
  const byUser = new Map<string, Set<string>>();
  for (const click of clicks) {
    if (!(OFFER_VARIANT_LABELS as readonly string[]).includes(click.variantLabel)) {
      continue;
    }
    const labels = byUser.get(click.userId) ?? new Set<string>();
    labels.add(click.variantLabel);
    byUser.set(click.userId, labels);
  }
  return new Map([...byUser.entries()].map(([userId, labels]) => [userId, [...labels].sort().join(", ")]));
}

/** As linhas do Attendee: quem ficou mais tempo primeiro (empate: quem garantiu a vaga antes). */
export function attendeeExportRows(attendees: readonly ReportAttendee[], clicked: ReadonlyMap<string, string> = new Map()): CsvCell[][] {
  return [...attendees]
    .sort((left, right) => right.seconds - left.seconds || toTime(left.registeredAt) - toTime(right.registeredAt))
    .map((attendee) => attendeeCsvRow(attendee, clicked.get(attendee.userId) ?? ""));
}

/* ------------------------------------------------------------------------------------------------
 * Performance: uma linha por sessao, so numeros reais (nunca o contador, as entradas, os avisos nem o roteiro)
 * ---------------------------------------------------------------------------------------------- */

export type PerformanceSession = { id: string; kind: SessionKind; scheduledAt: string; webinarTitle: string };

export type PerformanceFacts = PerformanceSession & {
  attendedRegistered: number;
  commenters: number;
  durationMs: number;
  messages: number;
  /** Nulo quando a sessao nao teve oferta (as colunas da Oferta ficam vazias). */
  offer: { clicks: number; purchases: number; seen: number } | null;
  peak: { b: number; n: number } | null;
  pollAnswers: number;
  present: number;
  questions: { answered: number; dismissed: number; open: number };
  reachedEnd: number;
  reactions: number;
  registered: number;
  replayViewers: number | null;
  watchAvgSeconds: number;
  watchMaxSeconds: number;
};

const OFFER_PANEL_METRICS = new Set(["offer_seen", "offer_clicks", "offer_purchases", "offer_variant", "offer_revenue"]);

/**
 * Os numeros de uma sessao a partir das linhas de webinar_panel (a mesma conta do painel: presenca, vagas, chat de
 * aluno, perguntas, reacoes, enquetes, replay e a Oferta). So as metricas reais sao lidas pelo nome; o resto (o bloco
 * da Simulacao, que a RPC manda a parte) nunca e somado.
 */
export function performanceFactsFromPanel(rows: readonly PanelRow[], session: PerformanceSession): PerformanceFacts {
  const mine = rows.filter((row) => row.sessionId === session.id);
  const pick = (metric: string, item = "") => mine.find((row) => row.metric === metric && row.item === item);
  const total = (metric: string, item = "") => pick(metric, item)?.total ?? 0;
  const students = (metric: string, item = "") => pick(metric, item)?.students ?? 0;
  const watch = pick("watch_sum");
  const peak = mine.find((row) => row.metric === "peak");
  const hasOffer = mine.some((row) => OFFER_PANEL_METRICS.has(row.metric));
  const replay = pick("replay_viewers");

  return {
    ...session,
    attendedRegistered: total("attended_registered"),
    commenters: students("messages"),
    durationMs: total("duration"),
    messages: total("messages"),
    offer: hasOffer ? { clicks: students("offer_clicks"), purchases: students("offer_purchases"), seen: students("offer_seen") } : null,
    peak: peak ? { b: Number(peak.item), n: peak.total } : null,
    pollAnswers: total("poll_answers"),
    present: total("present"),
    questions: { answered: total("question", "answered"), dismissed: total("question", "dismissed"), open: total("question", "open") },
    reachedEnd: total("reached_end"),
    reactions: total("reactions"),
    registered: total("registered"),
    replayViewers: replay ? replay.total : 0,
    watchAvgSeconds: watch && watch.students > 0 ? Math.round(watch.total / watch.students) : 0,
    watchMaxSeconds: total("watch_max")
  };
}

/**
 * Os numeros do replay (webinar_panel so conta as sessoes ao vivo e gravadas): os mesmos do relatorio da sessao.
 * "Enquetes respondidas" e a soma das opcoes marcadas (a mesma do numero "Enquetes" da aba Relatorio).
 */
export function performanceFactsFromReport(view: WebinarReportView, session: PerformanceSession, durationMs: number): PerformanceFacts {
  return {
    ...session,
    attendedRegistered: view.registration.attended,
    commenters: view.chat.students,
    durationMs,
    messages: view.chat.total,
    offer: view.offer.present ? { clicks: view.offer.clicks.students, purchases: view.offer.purchases.students, seen: view.offer.seen.students } : null,
    peak: view.presence.peak,
    pollAnswers: view.polls.reduce((sum, entry) => sum + entry.total, 0),
    present: view.presence.unique,
    questions: { answered: view.questions.answered, dismissed: view.questions.dismissed, open: view.questions.open },
    reachedEnd: view.presence.reachedEnd,
    reactions: view.reactions.byType.reduce((sum, entry) => sum + entry.total, 0),
    registered: view.registration.registered,
    replayViewers: view.replay.viewers,
    watchAvgSeconds: view.presence.watchAvgSeconds,
    watchMaxSeconds: view.presence.watchMaxSeconds
  };
}

/** A linha do Performance (as 25 colunas de §3.7); sem presente, os tempos ficam vazios (nada estimado). */
export function performanceRow(facts: PerformanceFacts): CsvCell[] {
  const present = facts.present > 0;

  return [
    facts.webinarTitle,
    facts.id,
    VALORES.tipos[facts.kind],
    when(facts.scheduledAt),
    facts.durationMs > 0 ? watchTimeLabel(facts.durationMs / 1000) : "",
    facts.registered,
    facts.present,
    percentCell(percentOf(facts.attendedRegistered, facts.registered)),
    facts.peak ? facts.peak.n : "",
    facts.peak ? bucketLabel(facts.peak.b) : "",
    present ? watchTimeLabel(facts.watchAvgSeconds) : "",
    present ? watchTimeLabel(facts.watchMaxSeconds) : "",
    percentCell(percentOf(facts.reachedEnd, facts.present)),
    facts.messages,
    facts.commenters,
    facts.reactions,
    facts.questions.open + facts.questions.answered + facts.questions.dismissed,
    facts.questions.answered,
    facts.questions.dismissed,
    facts.pollAnswers,
    facts.offer ? facts.offer.seen : "",
    facts.offer ? facts.offer.clicks : "",
    facts.offer ? facts.offer.purchases : "",
    facts.offer ? percentCell(percentOf(facts.offer.purchases, facts.present)) : "",
    facts.replayViewers ?? ""
  ];
}

/* ------------------------------------------------------------------------------------------------
 * Q&A: uma linha por pergunta
 * ---------------------------------------------------------------------------------------------- */

export type QaQuestionInput = {
  anonymous: boolean;
  /** De quem e a resposta (202610300004): "ai" sai como "Assistente"; nulo sem a migracao ou sem resposta. */
  answerSource: AnswerSource | null;
  answerText: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
  answeredLive: boolean;
  body: string;
  createdAt: string;
  offsetMs: number;
  status: QuestionStatus;
  upvotes: number;
  userId: string;
};

const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = { answered: VALORES.respondida, dismissed: VALORES.dispensada, open: VALORES.aberta };

/** Quem respondeu: o Assistente, o nome de quem da equipe respondeu, ou "Equipe" quando o nome nao veio. */
function answeredByLabel(question: QaQuestionInput, people: Record<string, ReportPerson>) {
  if (question.answerSource === "ai") {
    return VALORES.assistente;
  }
  if (question.answeredBy) {
    return people[question.answeredBy]?.name || VALORES.equipe;
  }
  return question.status === "answered" ? VALORES.equipe : "";
}

/**
 * Nº (na ordem em que chegaram), hora, minuto do video, nome ("Aluno {n}" na anonima, o mesmo numero do chat) e
 * e-mail (vazio na anonima), pergunta, votos, situacao, quem respondeu, a resposta, se foi ao vivo e quando.
 */
export function qaExportRows(input: { people: Record<string, ReportPerson>; questions: readonly QaQuestionInput[]; webinarId: string }): CsvCell[][] {
  return [...input.questions]
    .sort((left, right) => byInstant(left.createdAt, right.createdAt))
    .map((question, index) => {
      const answered = question.status === "answered";

      return [
        index + 1,
        when(question.createdAt),
        videoMinuteLabel(question.offsetMs),
        question.anonymous ? VALORES.alunoAnonimo(anonymousNumber(question.userId, input.webinarId)) : nameOf(input.people, question.userId),
        question.anonymous ? "" : emailOf(input.people, question.userId),
        question.body,
        question.upvotes,
        QUESTION_STATUS_LABELS[question.status],
        answeredByLabel(question, input.people),
        question.answerText ?? "",
        answered ? yesNo(question.answeredLive) : "",
        when(question.answeredAt)
      ];
    });
}

/* ------------------------------------------------------------------------------------------------
 * Poll e Survey: uma linha por resposta
 * ---------------------------------------------------------------------------------------------- */

export type PollAnswerInput = { createdAt: string; offsetMs: number; optionIds: readonly string[]; pollId: string; userId: string };

/** As opcoes marcadas, na ordem da enquete, separadas por ";" na multipla. */
function answerLabels(poll: Poll, optionIds: readonly string[]) {
  const chosen = new Set(optionIds);
  return poll.options
    .filter((option) => chosen.has(option.id))
    .map((option) => option.label)
    .join("; ");
}

function orderedPolls(polls: readonly Poll[], survey: boolean) {
  return polls
    .filter((poll) => (poll.kind === "survey") === survey)
    .sort((left, right) => left.position - right.position || toTime(left.openedAt) - toTime(right.openedAt) || left.id.localeCompare(right.id));
}

function answersOf(poll: Poll, answers: readonly PollAnswerInput[]) {
  return answers.filter((answer) => answer.pollId === poll.id).sort((left, right) => byInstant(left.createdAt, right.createdAt));
}

/** Poll: Enquete (o numero dela na sessao), Pergunta, Nome e E-mail (vazios na anonima), Hora, Minuto do video, Resposta(s). */
export function pollExportRows(input: { answers: readonly PollAnswerInput[]; people: Record<string, ReportPerson>; polls: readonly Poll[] }): CsvCell[][] {
  return orderedPolls(input.polls, false).flatMap((poll, index) =>
    answersOf(poll, input.answers).map((answer) => [
      index + 1,
      poll.question,
      poll.anonymous ? "" : nameOf(input.people, answer.userId),
      poll.anonymous ? "" : emailOf(input.people, answer.userId),
      when(answer.createdAt),
      videoMinuteLabel(answer.offsetMs),
      answerLabels(poll, answer.optionIds)
    ])
  );
}

/** Survey (a pesquisa do fim, enquetes `survey`): Nome, E-mail, Hora, Pergunta, Resposta; sem nenhuma, nenhuma linha (A20). */
export function surveyExportRows(input: { answers: readonly PollAnswerInput[]; people: Record<string, ReportPerson>; polls: readonly Poll[] }): CsvCell[][] {
  return orderedPolls(input.polls, true).flatMap((poll) =>
    answersOf(poll, input.answers).map((answer) => [
      poll.anonymous ? "" : nameOf(input.people, answer.userId),
      poll.anonymous ? "" : emailOf(input.people, answer.userId),
      when(answer.createdAt),
      poll.question,
      answerLabels(poll, answer.optionIds)
    ])
  );
}

/* ------------------------------------------------------------------------------------------------
 * Simulacao (so a sessao gravada): o unico CSV com linhas simuladas (D6, M6)
 * ---------------------------------------------------------------------------------------------- */

export type SimulationScriptItemInput = {
  body: string;
  id: string;
  offsetMs: number | null;
  personaName: string;
  position: number;
  resolvedOffsetMs: number | null;
  status: string;
  triggerKind: ScriptTrigger;
};

export type SimulationExportInput = {
  /**
   * A decisao da Simulacao ficou registrada (simulationDecisionRecorded): sem ela a sala nao mostrou nada simulado e
   * nenhuma linha sai "Disparou: Sim". Ausente = registrada (as chamadas antigas).
   */
  decided?: boolean;
  /** Quanto do video ja passou: ate o fim real na encerrada (o Encerrar antecipado corta), o relogio na que esta no ar, 0 antes. */
  elapsedMs: number;
  /** Os itens do roteiro que entraram nesta sessao (as mensagens `scripted`): o id do item e o minuto em que entrou. */
  fired: ReadonlyMap<string, number>;
  items: readonly SimulationScriptItemInput[];
  /** Os participantes de verdade, ao lado do contador (§3.5). */
  realParticipants: number;
  /** As regras e o resumo congelado (202610300003); nulo sem a migracao: so o roteiro sai. */
  simulation: SessionSimulation | null;
};

/** Os itens que deviam entrar (prontos ou com a frase nao achada) e os que entraram de qualquer jeito. */
function simulationScriptRows(input: SimulationExportInput): CsvCell[][] {
  const scripted = input.items.filter((item) => item.status === "ready" || item.status === "unresolved" || input.fired.has(item.id));
  const minuteOf = (item: SimulationScriptItemInput) => input.fired.get(item.id) ?? item.resolvedOffsetMs ?? (item.triggerKind === "at_offset" ? item.offsetMs : null);

  return scripted
    .map((item) => ({ item, minute: minuteOf(item) }))
    .sort((left, right) => (left.minute ?? Number.MAX_SAFE_INTEGER) - (right.minute ?? Number.MAX_SAFE_INTEGER) || left.item.position - right.item.position)
    .map(({ item, minute }) => [
      VALORES.simulacaoTipos.comentario,
      videoMinuteLabel(minute),
      VALORES.soltaEm[item.triggerKind] ?? "",
      item.personaName,
      item.body,
      yesNo(input.fired.has(item.id))
    ]);
}

/**
 * As linhas do CSV Simulacao: os comentarios do roteiro (Solta em, persona, texto, se entrou), o contador (a regra, o
 * maior numero mostrado e os participantes de verdade), as entradas (o total mostrado) e cada aviso de venda
 * cadastrado (entrou quando o minuto dele cabe no que o video ja passou).
 */
export function simulationExportRows(input: SimulationExportInput): CsvCell[][] {
  const rows = simulationScriptRows(input);
  const simulation = input.simulation;
  if (!simulation) {
    return rows;
  }
  const summary = simulation.summary;
  const counterOn = simulation.countRule.mode !== "off";
  // "Disparou" so o que a sala mostrou: com a decisao registrada e, depois do fim, pelo resumo congelado; na sessao
  // que ainda roda (sem resumo), a regra ligada com o video ja andando.
  const decided = input.decided !== false;
  const elapsed = Math.max(0, input.elapsedMs);
  const counterShown = decided && counterOn && (summary ? summary.counterMax > 0 : elapsed > 0);
  const joinsShown = decided && (summary ? summary.joinsShown > 0 : simulation.joins.enabled && simulation.joins.max > 0 && elapsed > 0);

  rows.push([
    VALORES.simulacaoTipos.contador,
    "",
    "",
    "",
    VALORES.contador(EXPORTAR.simulacao.regra[simulation.countRule.mode], summary?.counterMax ?? 0, input.realParticipants),
    yesNo(counterShown)
  ]);

  if (simulation.joins.enabled || (summary?.joinsShown ?? 0) > 0) {
    rows.push([
      VALORES.simulacaoTipos.entrada,
      "",
      "",
      "",
      VALORES.entrada(simulation.joins.everySeconds, simulation.joins.max, summary?.joinsShown ?? 0),
      yesNo(joinsShown)
    ]);
  }

  if (simulation.saleNotices.enabled) {
    for (const notice of simulation.saleNotices.items) {
      // O fim e exclusivo (o aviso do minuto do Encerrar nao apareceu), como saleNoticesBetween ate endMs - 1.
      rows.push([VALORES.simulacaoTipos.aviso, videoMinuteLabel(notice.offsetMs), "", "", notice.text, yesNo(decided && notice.offsetMs >= 0 && notice.offsetMs < elapsed)]);
    }
  }

  return rows;
}

/** O CSV Simulacao do periodo: cada linha da sessao com o webinario, a sessao e a hora na frente. */
export function periodSimulationRows(sessions: readonly { input: SimulationExportInput; scheduledAt: string; sessionId: string; webinarTitle: string }[]): CsvCell[][] {
  return [...sessions]
    .sort((left, right) => byInstant(left.scheduledAt, right.scheduledAt))
    .flatMap((session) => simulationExportRows(session.input).map((row) => [session.webinarTitle, session.sessionId, when(session.scheduledAt), ...row]));
}

/**
 * Quanto do video passou na sala (os avisos de venda antes disso entraram), no relogio da sessao gravada, cujo zero e
 * a hora marcada (sessionOffsetMs): na encerrada, ate o fim real (ended_at - hora marcada, o Encerrar antecipado
 * corta, simulationEndOffsetMs); na que esta no ar ou com a hora marcada passada (o tick abre ate 1 min depois),
 * agora - hora marcada; na cancelada e antes da hora, 0. Sempre em [0, durationMs].
 */
export function simulationElapsedMs(input: { durationMs: number; endedAt?: string | null; now: number; scheduledAt?: string | null; startedAt: string | null; status: SessionStatus }): number {
  const duration = Math.max(0, input.durationMs);
  const zero = toTime(input.scheduledAt ?? input.startedAt ?? "");
  if (input.status === "cancelled") {
    return 0;
  }
  if (input.status === "ended") {
    const ended = toTime(input.endedAt ?? "");
    return Number.isFinite(zero) && Number.isFinite(ended) ? Math.min(duration, Math.max(0, ended - zero)) : duration;
  }
  if (!Number.isFinite(zero)) {
    return 0;
  }
  return Math.min(duration, Math.max(0, input.now - zero));
}

/* ------------------------------------------------------------------------------------------------
 * Os filtros dos paineis no endereco (docs/30 §3.2 e §3.3)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Os nomes dos filtros da aba no endereco (o mesmo formato de panelFiltersSchema; os mesmos de PANEL_PARAMS em
 * panel-model.ts). O Produto e o filtro global da barra (ADMIN_PRODUCT_PARAM). Quem escolhe as sessoes com os filtros
 * e o painel (resolvePanelSelection): a rota do CSV so le o endereco e usa o mesmo recorte.
 */
export const PANEL_FILTER_PARAMS = {
  hostUserId: "apresentador",
  hour: "hora",
  productId: ADMIN_PRODUCT_PARAM,
  situation: "situacao",
  variant: "variante",
  webinarId: "webinario",
  withOffer: "com-oferta"
} as const;

const SITUATION_PARAMS = { cancelled: "canceladas", realized: "realizadas", scheduled: "agendadas" } as const;
type PanelSituation = keyof typeof SITUATION_PARAMS;

/**
 * Os filtros a partir do endereco, lidos como o painel le (readPanelFilters: maiusculas e minusculas tanto faz). Valor que
 * nao se entende vira "sem filtro" (os parametros vem da propria tela; o periodo, o tipo e o relatorio decidem o 400).
 */
export function panelFiltersFromParams(params: URLSearchParams): PanelFilters {
  const text = (name: string) => params.get(name)?.trim() || null;
  const hourText = text(PANEL_FILTER_PARAMS.hour);
  const hour = hourText !== null && /^\d{1,2}$/.test(hourText) ? Number(hourText) : null;
  const situationText = text(PANEL_FILTER_PARAMS.situation)?.toLowerCase() ?? null;
  const situation = (Object.entries(SITUATION_PARAMS) as [PanelSituation, string][]).find(([, value]) => value === situationText)?.[0] ?? null;
  const candidate = {
    hostUserId: text(PANEL_FILTER_PARAMS.hostUserId),
    hour,
    productId: text(PANEL_FILTER_PARAMS.productId),
    situation,
    variant: text(PANEL_FILTER_PARAMS.variant)?.toUpperCase() ?? null,
    webinarId: text(PANEL_FILTER_PARAMS.webinarId),
    withOffer: ["1", "sim"].includes(text(PANEL_FILTER_PARAMS.withOffer)?.toLowerCase() ?? "")
  };
  const filters = panelFiltersSchema.parse({});

  for (const [key, value] of Object.entries(candidate) as [keyof PanelFilters, unknown][]) {
    const one = panelFiltersSchema.shape[key].safeParse(value);
    if (one.success) {
      (filters as Record<string, unknown>)[key] = one.data;
    }
  }

  return filters;
}

/** Os filtros como parametros do endereco (so os ligados). */
export function panelFiltersToParams(filters: Partial<PanelFilters> | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  if (!filters) {
    return params;
  }
  if (filters.hostUserId) {
    params[PANEL_FILTER_PARAMS.hostUserId] = filters.hostUserId;
  }
  if (typeof filters.hour === "number") {
    params[PANEL_FILTER_PARAMS.hour] = String(filters.hour);
  }
  if (filters.productId) {
    params[PANEL_FILTER_PARAMS.productId] = filters.productId;
  }
  if (filters.situation) {
    params[PANEL_FILTER_PARAMS.situation] = SITUATION_PARAMS[filters.situation];
  }
  if (filters.variant) {
    params[PANEL_FILTER_PARAMS.variant] = filters.variant;
  }
  if (filters.webinarId) {
    params[PANEL_FILTER_PARAMS.webinarId] = filters.webinarId;
  }
  if (filters.withOffer) {
    params[PANEL_FILTER_PARAMS.withOffer] = "1";
  }
  return params;
}

/* ------------------------------------------------------------------------------------------------
 * Os pedidos das rotas (parametros em portugues, validados por webinarExportSchema)
 * ---------------------------------------------------------------------------------------------- */

const isExportReport = (value: string): value is WebinarExportReport => (WEBINAR_EXPORT_REPORTS as readonly string[]).includes(value);

export type SessionExportRequest = { report: WebinarExportReport; sessionId: string };

/** ?sessao=&relatorio= da rota da sessao; sem ?relatorio=, o Attendee de sempre. Nulo = 400. */
export function parseSessionExportRequest(params: URLSearchParams): SessionExportRequest | null {
  const report = params.get(EXPORT_PARAMS.report) ?? "attendee";
  const parsed = webinarExportSchema.safeParse({ report, scope: "session", sessionId: params.get(EXPORT_PARAMS.session) ?? "" });

  return parsed.success && parsed.data.scope === "session" ? { report: parsed.data.report, sessionId: parsed.data.sessionId } : null;
}

export type PanelExportRequest = {
  filters: PanelFilters;
  kind: "live" | "simulated";
  period: { end: string; start: string };
  report: "performance" | "simulacao";
};

/** ?tipo=ao-vivo|gravadas&inicio=&fim=&relatorio=performance|simulacao + os filtros da aba. Nulo = 400. */
export function parsePanelExportRequest(params: URLSearchParams): PanelExportRequest | null {
  const kindParam = params.get(EXPORT_PARAMS.kind);
  const kind = kindParam === PANEL_KIND_PARAMS.live ? "live" : kindParam === PANEL_KIND_PARAMS.simulated ? "simulated" : null;
  const reportParam = params.get(EXPORT_PARAMS.report) ?? "performance";
  if (!kind || !isExportReport(reportParam)) {
    return null;
  }
  const parsed = webinarExportSchema.safeParse({
    filters: panelFiltersFromParams(params),
    kind,
    period: { end: params.get(EXPORT_PARAMS.end) ?? "", start: params.get(EXPORT_PARAMS.start) ?? "" },
    report: reportParam,
    scope: "panel"
  });

  return parsed.success && parsed.data.scope === "panel"
    ? { filters: parsed.data.filters, kind: parsed.data.kind, period: parsed.data.period, report: parsed.data.report }
    : null;
}

/** O periodo de um painel e valido (ate 1 ano, o fim depois do inicio)? O menu so aparece com periodo valido. */
export function isValidPanelPeriod(start: string, end: string) {
  return panelPeriodSchema.safeParse({ end, start }).success;
}

/* ------------------------------------------------------------------------------------------------
 * O menu Exportar (export-menu.tsx)
 * ---------------------------------------------------------------------------------------------- */

export type ExportMenuEntry = { href: string; label: string; report: WebinarExportReport };

/** No relatorio de uma sessao: os sete, na ordem de WEBINAR_EXPORT_REPORTS (ou so os pedidos: sem Simulacao fora da gravada). */
export function sessionExportMenuEntries(input: { reports?: readonly WebinarExportReport[]; sessionId: string; webinarId: string }): ExportMenuEntry[] {
  const allowed = new Set(input.reports ?? WEBINAR_EXPORT_REPORTS);

  return WEBINAR_EXPORT_REPORTS.filter((report) => allowed.has(report)).map((report) => ({
    href: webinarSessionExportHref({ report, sessionId: input.sessionId, webinarId: input.webinarId }),
    label: EXPORTAR.relatorios[report],
    report
  }));
}

/** No painel: o Performance e o Simulacao do periodo, com os filtros da aba (a Simulacao so em Lives gravadas). */
export function panelExportMenuEntries(input: {
  end: string;
  filters?: Partial<PanelFilters>;
  kind: "live" | "simulated";
  searchParams?: Record<string, string>;
  start: string;
}): ExportMenuEntry[] {
  if (!isValidPanelPeriod(input.start, input.end)) {
    return [];
  }
  const extra = { ...(input.searchParams ?? {}), ...panelFiltersToParams(input.filters) };
  const reports: ("performance" | "simulacao")[] = input.kind === "simulated" ? ["performance", "simulacao"] : ["performance"];

  return reports.map((report) => ({
    href: webinarPanelExportHref({ end: input.end, extra, kind: input.kind, report, start: input.start }),
    label: EXPORTAR.relatoriosDoPeriodo[report],
    report
  }));
}
