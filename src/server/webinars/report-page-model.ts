// A aba Relatorio de um webinario, a parte pura (docs/30 §2.5, §3.4, §3.5, §3.6 e §3.7): o seletor de sessao (as
// sessoes "Comeca quando voce entra" so dos ultimos 7 dias, da mais nova para a mais velha), os onze numeros, a
// geometria da curva "Presentes minuto a minuto" (e a tabela por minuto que a substitui) com o trecho da transcricao
// de cada ponto de queda, as barras (mensagens por minuto, reacoes, origem da vaga), as enquetes por opcao, a
// pontuacao dos alunos (a mesma conta M3 de webinar_report, com os pesos de ROOM_RULES), os blocos da fase 4 (Oferta,
// Respostas do Assistente e a Simulacao completa) e o CSV "Attendee" nos nomes do Zoom. Sem "server-only", imports
// relativos: tests/webinarios-relatorio-*.test.mjs carregam direto pelo Node. Os numeros simulados nunca entram aqui
// alem do bloco Simulacao (D6, D10): a RPC ja separa as linhas `sim_*` e report-model.ts so as poe em `script` e
// `simulation`, que so simulationLines le.

import type { CsvCell } from "../../lib/csv";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { saoPauloDayKey, saoPauloTime } from "../../lib/webinar-time";
import { formatSaoPauloDateTime } from "../communications/campaign-model";
import type { Attendee } from "./chat-rows";
import {
  nextSession,
  REACTIONS,
  ROOM_RULES,
  SCRIPT_TRIGGERS,
  toTime,
  webinarExportFileName,
  type Poll,
  type QuestionStatus,
  type Reaction,
  type ScriptTrigger,
  type SessionKind,
  type SessionStatus,
  type SimulatedCountMode,
  type WebinarSession
} from "./model";
import { bucketLabel, percentOf, revenueLabel, watchTimeLabel, type ReportBucket, type WebinarReportView } from "./report-model";
import { bucketCount } from "./room-model";

const COPY = WEBINAR_COPY.relatorio;
const EXPORTAR = WEBINAR_COPY.exportar;
const integer = new Intl.NumberFormat("pt-BR");

/** As sessoes "Comeca quando voce entra" no seletor: so as dos ultimos 7 dias (uma por horario e por dia). */
export const REPORT_JIT_DAYS = 7;

export const WEBINAR_REPORT_SESSION_PARAM = "sessao";

/* ------------------------------------------------------------------------------------------------
 * Enderecos e o seletor de sessao
 * ---------------------------------------------------------------------------------------------- */

export function webinarReportHref(webinarId: string, sessionId?: string | null) {
  const base = `/admin/comunicacao/webinarios/${webinarId}/relatorio`;

  return sessionId ? `${base}?${WEBINAR_REPORT_SESSION_PARAM}=${encodeURIComponent(sessionId)}` : base;
}

export function webinarReportCsvHref(webinarId: string, sessionId: string) {
  return `/api/admin/webinars/${webinarId}/relatorio/csv?${WEBINAR_REPORT_SESSION_PARAM}=${encodeURIComponent(sessionId)}`;
}

export type ReportSessionOption = {
  href: string;
  id: string;
  kind: SessionKind;
  label: string;
  scheduledAt: string;
  selected: boolean;
  status: SessionStatus;
};

/**
 * As sessoes com relatorio: as que comecaram ou encerraram, as horas marcadas em ordem; depois as "Comeca quando voce
 * entra" (`jit`, fase 4e) dos ultimos 7 dias, da mais nova para a mais velha (sao muitas: uma por horario e por
 * dia); o replay por ultimo. Datas comparadas pelo instante (o banco escreve "+00:00", o navegador "Z").
 */
export function reportableSessions(sessions: readonly WebinarSession[], now: number = Date.now()): WebinarSession[] {
  const started = sessions.filter((session) => session.status === "live" || session.status === "ended");
  const regular = started.filter((session) => session.kind !== "replay" && !session.jit).sort((a, b) => toTime(a.scheduledAt) - toTime(b.scheduledAt));
  const since = now - REPORT_JIT_DAYS * 86_400_000;
  const jit = started
    .filter((session) => session.kind !== "replay" && session.jit && toTime(session.scheduledAt) >= since)
    .sort((a, b) => toTime(b.scheduledAt) - toTime(a.scheduledAt));
  const replay = started.filter((session) => session.kind === "replay");

  return [...regular, ...jit, ...replay];
}

/**
 * O "Avisar quem não veio" do bloco Vagas (docs/30 §3.4) monta "garantiu vaga E não participou" da live inteira (a
 * vaga de qualquer sessao, a presenca em qualquer uma), nao so da sessao escolhida. Liga so quando nenhuma hora
 * marcada esta por acontecer ou no ar (nextSession sem o replay e sem as `jit`, que nunca tem vaga): antes disso, quem
 * garantiu vaga numa sessao futura receberia "você não veio" antes da live dele. "No ar" e o status, seja qual for a
 * hora: nextSession tira a sessao da conta depois de duracao + 2 h, mas a Live ao vivo segue `live` ate o Encerrar e a
 * gravada ate o fim do video (que pode passar da duracao do webinario).
 */
export function absenteesNoticeReady(sessions: readonly Pick<WebinarSession, "endedAt" | "jit" | "kind" | "scheduledAt" | "status">[], durationMinutes: number, now: number): boolean {
  const scheduled = sessions.filter((session) => !session.jit && session.kind !== "replay");
  const onAir = scheduled.some((session) => session.status === "live" || session.status === "waiting");

  return !onAir && nextSession(scheduled, durationMinutes, now) === null;
}

/** A sessao aberta por padrao: a hora marcada mais recente que ja comecou (marcada ou jit); sem nenhuma, o replay. */
export function defaultReportSessionId(sessions: readonly WebinarSession[]): string | null {
  const regular = sessions.filter((session) => session.kind !== "replay");
  const chosen = regular.length > 0 ? regular.reduce((latest, session) => (toTime(session.scheduledAt) > toTime(latest.scheduledAt) ? session : latest)) : sessions[0];

  return chosen?.id ?? null;
}

export function reportSessionLabel(session: Pick<WebinarSession, "kind" | "scheduledAt">) {
  return `${COPY.sessaoKinds[session.kind]} · ${formatSaoPauloDateTime(session.scheduledAt)}`;
}

export function reportSessionOptions(webinarId: string, sessions: readonly WebinarSession[], selectedId: string | null): ReportSessionOption[] {
  return sessions.map((session) => ({
    href: webinarReportHref(webinarId, session.id),
    id: session.id,
    kind: session.kind,
    label: reportSessionLabel(session),
    scheduledAt: session.scheduledAt,
    selected: session.id === selectedId,
    status: session.status
  }));
}

/* ------------------------------------------------------------------------------------------------
 * Os onze numeros do topo
 * ---------------------------------------------------------------------------------------------- */

export const REPORT_KPI_IDS = ["registered", "attended", "rate", "peak", "watchAvg", "reachedEnd", "replay", "messages", "questions", "reactions", "polls"] as const;
export type ReportKpiId = (typeof REPORT_KPI_IDS)[number];

export type ReportKpi = { definition: string; format: "number" | "percent"; id: ReportKpiId; label: string; value: number | null };

function sum(values: readonly number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function questionsTotal(questions: WebinarReportView["questions"]) {
  return questions.open + questions.answered + questions.dismissed;
}

/** Vagas garantidas, Compareceram, Taxa de comparecimento, Pico, Tempo medio, Ate o fim, Replay, Mensagens, Perguntas, Reacoes, Enquetes. */
export function reportKpis(view: WebinarReportView, options: { hasReplay: boolean }): ReportKpi[] {
  const { presence, registration } = view;
  const peak = presence.peak;

  return [
    { definition: COPY.definicoes.vagasGarantidas, format: "number", id: "registered", label: COPY.vagasGarantidas, value: registration.registered },
    { definition: COPY.definicoes.compareceram, format: "number", id: "attended", label: COPY.compareceram, value: presence.unique },
    { definition: COPY.definicoes.taxa, format: "percent", id: "rate", label: COPY.taxaDeComparecimento, value: percentOf(registration.attended, registration.registered) },
    { definition: COPY.definicoes.pico(peak ? bucketLabel(peak.b) : "—"), format: "number", id: "peak", label: COPY.picoDePresentes, value: peak ? peak.n : null },
    { definition: COPY.definicoes.tempoMedio, format: "number", id: "watchAvg", label: COPY.tempoMedio, value: presence.unique > 0 ? Math.round(presence.watchAvgSeconds / 60) : null },
    { definition: COPY.definicoes.ateOFim, format: "percent", id: "reachedEnd", label: COPY.ateOFim, value: percentOf(presence.reachedEnd, presence.unique) },
    { definition: COPY.definicoes.replay, format: "number", id: "replay", label: COPY.assistiramReplay, value: options.hasReplay ? view.replay.viewers : null },
    { definition: COPY.definicoes.mensagens, format: "number", id: "messages", label: COPY.mensagens, value: view.chat.total },
    { definition: COPY.definicoes.perguntas, format: "number", id: "questions", label: COPY.perguntas, value: questionsTotal(view.questions) },
    { definition: COPY.definicoes.reacoes, format: "number", id: "reactions", label: COPY.reacoes, value: sum(view.reactions.byType.map((entry) => entry.total)) },
    { definition: COPY.definicoes.enquetes, format: "number", id: "polls", label: COPY.enquetes, value: sum(view.polls.map((entry) => entry.total)) }
  ];
}

/* ------------------------------------------------------------------------------------------------
 * A curva "Presentes minuto a minuto"
 * ---------------------------------------------------------------------------------------------- */

export type CurveMinuteRow = { label: string; minute: number; present: number };

/** A tabela que substitui o grafico: uma linha por minuto com o maior numero de presentes dos baldes dele. */
export function curveByMinute(curve: readonly ReportBucket[], bucketSeconds: number = ROOM_RULES.bucketSeconds): CurveMinuteRow[] {
  const perMinute = Math.max(1, Math.round(60 / bucketSeconds));
  const rows = new Map<number, number>();

  for (const point of curve) {
    if (point.b < 0) {
      continue;
    }

    const minute = Math.floor(point.b / perMinute);
    rows.set(minute, Math.max(rows.get(minute) ?? 0, point.n));
  }

  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([minute, present]) => ({ label: bucketLabel(minute * perMinute, bucketSeconds), minute, present }));
}

export type CurvePoint = { b: number; n: number; x: number; y: number };
export type CurveDrop = CurvePoint & { label: string; left: number };
export type CurveGeometry = {
  area: string;
  drops: CurveDrop[];
  line: string;
  peak: CurvePoint | null;
  peakN: number;
  points: CurvePoint[];
  ticks: { label: string; x: number }[];
  totalBuckets: number;
};

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Os pontos do SVG: um por balde de 0 ate o fim (baldes sem amostra valem 0); a sessao em andamento vai so ate o
 * ultimo balde com sinal. `width`/`height` sao as medidas da area do grafico (o viewBox).
 */
export function curveGeometry(input: {
  bucketSeconds?: number;
  curve: readonly ReportBucket[];
  drops: readonly ReportBucket[];
  durationMs: number;
  height: number;
  live: boolean;
  width: number;
}): CurveGeometry {
  const bucketSeconds = input.bucketSeconds ?? ROOM_RULES.bucketSeconds;
  const present = new Map<number, number>();
  let maxBucket = -1;

  for (const point of input.curve) {
    if (point.b >= 0) {
      present.set(point.b, point.n);
      maxBucket = Math.max(maxBucket, point.b);
    }
  }

  const totalBuckets = input.live ? Math.max(1, maxBucket + 1) : Math.max(bucketCount(input.durationMs), maxBucket + 1);
  const denominator = Math.max(1, totalBuckets - 1);
  const peakN = Math.max(1, ...present.values());
  const points: CurvePoint[] = [];
  let peak: CurvePoint | null = null;

  for (let b = 0; b < totalBuckets; b += 1) {
    const n = present.get(b) ?? 0;
    const point = { b, n, x: round((b / denominator) * input.width), y: round(input.height - (n / peakN) * input.height) };
    points.push(point);

    if (n > 0 && (!peak || n > peak.n)) {
      peak = point;
    }
  }

  const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const area = `${line} L${last.x},${input.height} L${first.x},${input.height} Z`;
  const ticks: { label: string; x: number }[] = [];

  for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
    const b = Math.round(fraction * denominator);
    const label = bucketLabel(b, bucketSeconds);

    if (!ticks.some((tick) => tick.label === label)) {
      ticks.push({ label, x: round(fraction * input.width) });
    }
  }

  const drops: CurveDrop[] = input.drops
    .filter((drop) => drop.b >= 0 && drop.b < totalBuckets)
    .map((drop) => {
      const point = points[drop.b];

      return { ...point, label: `${bucketLabel(drop.b, bucketSeconds)} · ${COPY.sairam(drop.n)}`, left: drop.n };
    });

  return { area, drops, line, peak, peakN, points, ticks, totalBuckets };
}

/* ------------------------------------------------------------------------------------------------
 * Barras: mensagens por minuto, reacoes, origem da vaga e perguntas por situacao
 * ---------------------------------------------------------------------------------------------- */

export type ReportBar = { id: string; label: string; percent: number | null; students: number | null; total: number };

export const REACTION_EMOJI: Record<Reaction, string> = { clap: "👏", fire: "🔥", laugh: "😂", like: "👍", love: "❤️", wow: "😮" };

/** Uma barra por reacao que aconteceu, da mais usada para a menos (empate na ordem da barra do aluno). */
export function reactionBars(byType: WebinarReportView["reactions"]["byType"]): ReportBar[] {
  const total = sum(byType.map((entry) => entry.total));

  return REACTIONS.map((reaction) => {
    const entry = byType.find((candidate) => candidate.reaction === reaction);

    return {
      id: reaction,
      label: `${REACTION_EMOJI[reaction]} ${COPY.reacoesNomes[reaction]}`,
      percent: entry ? percentOf(entry.total, total) : null,
      students: entry?.students ?? 0,
      total: entry?.total ?? 0
    };
  })
    .filter((bar) => bar.total > 0)
    .sort((a, b) => b.total - a.total || REACTIONS.indexOf(a.id as Reaction) - REACTIONS.indexOf(b.id as Reaction));
}

/** Uma barra por minuto do video com mensagem de aluno; a maior barra e 100 %. */
export function messagesPerMinuteBars(perMinute: WebinarReportView["chat"]["perMinute"], bucketSeconds: number = ROOM_RULES.bucketSeconds): ReportBar[] {
  const perBucketMinute = Math.max(1, Math.round(60 / bucketSeconds));
  const max = Math.max(0, ...perMinute.map((entry) => entry.total));

  return perMinute.map((entry) => ({
    id: String(entry.minute),
    label: bucketLabel(entry.minute * perBucketMinute, bucketSeconds),
    percent: percentOf(entry.total, max),
    students: entry.students,
    total: entry.total
  }));
}

export function registrationSourceBars(registration: WebinarReportView["registration"]): ReportBar[] {
  return registration.sources.map((entry) => ({
    id: entry.source || "none",
    label: entry.source || COPY.semOrigem,
    percent: percentOf(entry.total, registration.registered),
    students: null,
    total: entry.total
  }));
}

export function questionStatusBars(questions: WebinarReportView["questions"]): ReportBar[] {
  const total = questionsTotal(questions);
  const statuses: QuestionStatus[] = ["open", "answered", "dismissed"];

  return statuses.map((status) => ({ id: status, label: COPY.perguntasStatus[status], percent: percentOf(questions[status], total), students: null, total: questions[status] }));
}

/* ------------------------------------------------------------------------------------------------
 * Enquetes por opcao
 * ---------------------------------------------------------------------------------------------- */

export type PollResultOption = { id: string; label: string; percent: number | null; students: number; total: number };
export type PollResult = { anonymous: boolean; id: string; options: PollResultOption[]; question: string; total: number };

/** As respostas por opcao de cada enquete lancada na sessao (os rotulos vem das linhas de webinar_polls). */
export function pollResults(rows: WebinarReportView["polls"], polls: readonly Poll[]): PollResult[] {
  const byPoll = new Map<string, Map<string, { students: number; total: number }>>();

  for (const row of rows) {
    const options = byPoll.get(row.pollId) ?? new Map<string, { students: number; total: number }>();
    options.set(row.optionId, { students: row.students, total: row.total });
    byPoll.set(row.pollId, options);
  }

  const known = new Set(polls.map((poll) => poll.id));
  const unknown = [...byPoll.keys()].filter((pollId) => !known.has(pollId));
  const results: PollResult[] = [];

  for (const poll of polls) {
    const counts = byPoll.get(poll.id) ?? new Map();
    const total = sum([...counts.values()].map((entry) => entry.total));
    const options = poll.options.map((option) => {
      const entry = counts.get(option.id);

      return { id: option.id, label: option.label, percent: percentOf(entry?.total ?? 0, total), students: entry?.students ?? 0, total: entry?.total ?? 0 };
    });

    results.push({ anonymous: poll.anonymous, id: poll.id, options, question: poll.question, total });
  }

  for (const pollId of unknown) {
    const counts = byPoll.get(pollId) ?? new Map();
    const total = sum([...counts.values()].map((entry) => entry.total));

    results.push({
      anonymous: false,
      id: pollId,
      options: [...counts.entries()].map(([optionId, entry]) => ({ id: optionId, label: optionId, percent: percentOf(entry.total, total), students: entry.students, total: entry.total })),
      question: COPY.enquetes,
      total
    });
  }

  return results;
}

/* ------------------------------------------------------------------------------------------------
 * Pessoas: nomes, pontuacao e a lista por aluno
 * ---------------------------------------------------------------------------------------------- */

export type ReportPerson = { email: string | null; name: string };

export function personName(people: Record<string, ReportPerson>, userId: string) {
  return people[userId]?.name || COPY.alunoSemNome;
}

/** Os pontos de um aluno (M3): mensagem 1 (teto 50), pergunta 2, reacao 0,5, enquete 1, cada 10 min presente 1. */
export function attendeeScorePoints(attendee: Pick<Attendee, "messages" | "polls" | "questions" | "reactions" | "seconds">) {
  const weights = ROOM_RULES.hotWeights;

  return (
    Math.min(attendee.messages, weights.messageCap) * weights.message +
    attendee.questions * weights.question +
    attendee.reactions * weights.reaction +
    attendee.polls * weights.poll +
    Math.floor(attendee.seconds / 600) * weights.tenMinutes
  );
}

/** A pontuacao 0-100 de cada aluno pelo maior da sessao (quem nao fez nada fica em 0). */
export function attendeeScores(attendees: readonly Attendee[]): Map<string, number> {
  const points = attendees.map((attendee) => [attendee.userId, attendeeScorePoints(attendee)] as const);
  const max = Math.max(0.0001, ...points.map(([, value]) => value));

  return new Map(points.map(([userId, value]) => [userId, value > 0 ? Math.round((value / max) * 100) : 0]));
}

export type AttendeeDevice = "desktop" | "mobile";

export type ReportAttendee = Attendee & {
  device: AttendeeDevice | null;
  email: string | null;
  name: string;
  registeredAt: string | null;
  score: number;
};

export function attendeeWasPresent(attendee: Pick<Attendee, "firstAt" | "seconds">) {
  return attendee.firstAt !== null || attendee.seconds > 0;
}

/** "Saiu": a ultima amostra mais um sinal (15 s), como o Zoom fecha o trecho. */
export function attendeeLeftAtIso(lastAt: string | null): string | null {
  if (!lastAt) {
    return null;
  }

  const time = toTime(lastAt);

  return Number.isFinite(time) ? new Date(time + ROOM_RULES.heartbeatSeconds * 1000).toISOString() : null;
}

export function attendeeTimeLabel(seconds: number) {
  return seconds > 0 ? watchTimeLabel(seconds) : "—";
}

export function deviceLabel(device: AttendeeDevice | null) {
  return device ? COPY.dispositivo[device] : "";
}

export function toDevice(value: unknown): AttendeeDevice | null {
  return value === "mobile" || value === "desktop" ? value : null;
}

/* ------------------------------------------------------------------------------------------------
 * O CSV "Attendee" (docs/30 §3.7, nomes do Zoom)
 * ---------------------------------------------------------------------------------------------- */

/** As colunas do Attendee, na ordem de §3.7 (WEBINAR_COPY.exportar.colunas.attendee). */
export const ATTENDEE_CSV_HEADERS = EXPORTAR.colunas.attendee;

const yesNo = (value: boolean) => (value ? COPY.sim : COPY.nao);
const when = (iso: string | null) => (iso ? formatSaoPauloDateTime(iso) : "");

/**
 * Uma linha por aluno presente ou com vaga; quem so garantiu vaga fica com as colunas de presenca vazias.
 * `offerClicked`: a variante da Oferta que o aluno clicou nesta sessao ("B"; vazio sem clique).
 */
export function attendeeCsvRow(attendee: ReportAttendee, offerClicked = ""): CsvCell[] {
  const present = attendeeWasPresent(attendee);

  return [
    yesNo(present),
    attendee.name,
    attendee.email ?? "",
    when(attendee.registeredAt),
    present ? when(attendee.firstAt) : "",
    present ? when(attendeeLeftAtIso(attendee.lastAt)) : "",
    present ? attendee.entries : "",
    present ? Math.round(attendee.seconds / 60) : "",
    present ? yesNo(attendee.reachedEnd) : "",
    attendee.messages,
    attendee.reactions,
    attendee.questions,
    attendee.polls,
    offerClicked,
    attendee.score,
    deviceLabel(attendee.device)
  ];
}

/** A sessao no nome do arquivo: a hora marcada em Sao Paulo, "AAAA-MM-DD-HHMM". */
export function webinarSessionExportKey(scheduledAt: string) {
  return `${saoPauloDayKey(scheduledAt)}-${saoPauloTime(scheduledAt).replace(":", "")}`;
}

/** `webinario-{slug}-{sessao}-attendee.csv`, com a hora marcada em Sao Paulo (AAAA-MM-DD-HHMM). */
export function attendeeCsvFileName(slug: string, scheduledAt: string) {
  return webinarExportFileName({ report: "attendee", sessionKey: webinarSessionExportKey(scheduledAt), slug });
}

/* ------------------------------------------------------------------------------------------------
 * O bloco Oferta (docs/30 §3.4): so numeros reais (presenca na janela, cliques e compras ligadas pelo webhook)
 * ---------------------------------------------------------------------------------------------- */

export type ReportFactItem = { label: string; value: string };

const percentText = (value: number | null) => (value === null ? "—" : `${value} %`);

/** Viram, cliques e compras (alunos unicos), a receita ("—" sem valor gravado, M8) e a conversao da sessao. */
export function offerFacts(view: WebinarReportView): ReportFactItem[] {
  const { offer, presence } = view;
  const revenue = revenueLabel(offer.revenue);
  const overClicks = percentOf(offer.purchases.students, offer.clicks.students);

  return [
    { label: EXPORTAR.oferta.viram, value: integer.format(offer.seen.students) },
    { label: EXPORTAR.oferta.cliques, value: integer.format(offer.clicks.students) },
    { label: EXPORTAR.oferta.compras, value: integer.format(offer.purchases.students) },
    { label: EXPORTAR.oferta.receita, value: revenue ?? EXPORTAR.oferta.receitaAMedir },
    {
      label: EXPORTAR.oferta.conversao,
      value: `${percentText(percentOf(offer.purchases.students, presence.unique))}${overClicks === null ? "" : ` · ${EXPORTAR.oferta.sobreCliques(overClicks)}`}`
    }
  ];
}

export type OfferVariantRow = { clicks: number; conversion: number | null; label: string; letter: string; purchases: number; seen: number };

/** Por variante (A a D, so as que apareceram): viram, cliques, compras e compras ÷ quem viu aquela variante. */
export function offerVariantRows(view: WebinarReportView): OfferVariantRow[] {
  return view.offer.variants.map((variant) => ({
    clicks: variant.clicks.students,
    conversion: percentOf(variant.purchases.students, variant.seen.students),
    label: EXPORTAR.oferta.variante(variant.label),
    letter: variant.label,
    purchases: variant.purchases.students,
    seen: variant.seen.students
  }));
}

/* ------------------------------------------------------------------------------------------------
 * O bloco Respostas do Assistente (docs/30 §3.4, D24): fora da Simulacao e das mensagens de aluno e equipe
 * ---------------------------------------------------------------------------------------------- */

export function assistantFacts(view: WebinarReportView): ReportFactItem[] {
  const { assistant } = view;

  return [
    { label: EXPORTAR.assistente.respostas, value: integer.format(assistant.replies) },
    { label: EXPORTAR.assistente.tempoMedio, value: assistant.avgSeconds === null ? "—" : EXPORTAR.assistente.segundos(assistant.avgSeconds) },
    { label: EXPORTAR.assistente.corrigidas, value: integer.format(assistant.edited) },
    { label: EXPORTAR.assistente.apagadas, value: integer.format(assistant.deleted) },
    { label: EXPORTAR.assistente.pedidosDeEquipe, value: integer.format(assistant.handoffs) }
  ];
}

/* ------------------------------------------------------------------------------------------------
 * Os pontos de queda com o trecho da transcricao daquele minuto (docs/30 §3.4)
 * ---------------------------------------------------------------------------------------------- */

export type TranscriptCue = { endSeconds: number | null; startSeconds: number; text: string };

const EXCERPT_MAX = 180;

/** O que o video dizia no minuto da queda (as cues que tocam aquele minuto, juntas e cortadas); nulo sem nenhuma. */
export function dropExcerpt(bucket: number, cues: readonly TranscriptCue[], bucketSeconds: number = ROOM_RULES.bucketSeconds): string | null {
  const from = Math.floor((Math.max(0, bucket) * bucketSeconds) / 60) * 60;
  const to = from + 60;
  const text = cues
    .filter((cue) => cue.startSeconds < to && (cue.endSeconds ?? cue.startSeconds) >= from)
    .sort((a, b) => a.startSeconds - b.startSeconds)
    .map((cue) => cue.text.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return null;
  }

  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : text;
}

/** O trecho de cada ponto de queda, pelo balde; sem transcricao da gravacao, nulo (a tela nao fala do trecho). */
export function dropExcerpts(drops: readonly ReportBucket[], cues: readonly TranscriptCue[] | null, bucketSeconds: number = ROOM_RULES.bucketSeconds): Record<number, string | null> | null {
  if (!cues) {
    return null;
  }

  return Object.fromEntries(drops.map((drop) => [drop.b, dropExcerpt(drop.b, cues, bucketSeconds)]));
}

/* ------------------------------------------------------------------------------------------------
 * O bloco Simulacao completo (docs/30 §3.5): o selo e quem decidiu, o contador com o real ao lado, as entradas, os
 * avisos de venda e o roteiro por Solta em. So daqui (e do CSV Simulacao) saem numeros simulados (D6, M6).
 * ---------------------------------------------------------------------------------------------- */

/** As regras da fase 4 (202610300003) na sessao: o que a equipe ligou (o resumo congelado vem da RPC). */
export type SimulationRulesSummary = {
  countMode: SimulatedCountMode;
  joins: { enabled: boolean; everySeconds: number; max: number };
  saleNotices: { enabled: boolean; items: number };
};

export type SimulationSummary = {
  ackText: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  /** Banco sem a 202610300003: as regras ficam de fora e a tela mostra o aviso da migracao no bloco. */
  pending: boolean;
  /** Os participantes de verdade (presentes unicos), ao lado do contador para a equipe comparar. */
  realParticipants: number;
  rules: SimulationRulesSummary | null;
  script: { byTrigger: Record<ScriptTrigger, number>; fired: number; missed: number; ready: number };
  showLiveBadge: boolean;
  /** O que simulation_summary congelou no fim (as linhas sim_* da RPC); nulo antes do fim ou sem regra. */
  totals: WebinarReportView["simulation"];
};

export function emptyScriptByTrigger(): Record<ScriptTrigger, number> {
  return { at_offset: 0, manual: 0, on_phrase: 0 };
}

const SIM = EXPORTAR.simulacao;

export function simulationLines(summary: SimulationSummary): string[] {
  const decision = summary.decidedAt
    ? COPY.decididoPor(summary.decidedByName || COPY.alunoSemNome, formatSaoPauloDateTime(summary.decidedAt))
    : COPY.semDecisao;
  const lines = [`${COPY.seloAoVivo}: ${summary.showLiveBadge ? COPY.ligado : COPY.desligado} · ${decision}`];
  const { rules, totals } = summary;

  if (rules) {
    const counter: string[] = [SIM.regra[rules.countMode]];
    if (rules.countMode !== "off") {
      counter.push(SIM.maiorNumero(totals.counterMax ?? 0));
    }
    counter.push(SIM.real(summary.realParticipants));
    lines.push(`${SIM.contador}: ${counter.join(" · ")}`);
    lines.push(`${SIM.entradas}: ${rules.joins.enabled || totals.joinsShown ? SIM.apareceram(totals.joinsShown ?? 0) : COPY.desligado}`);
    lines.push(`${SIM.avisosDeVenda}: ${rules.saleNotices.enabled || totals.saleNoticesShown ? SIM.apareceram(totals.saleNoticesShown ?? 0) : COPY.desligado}`);
  }

  lines.push(COPY.roteiroProntos(summary.script.ready));
  lines.push(`${COPY.roteiroEntraram(summary.script.fired)} · ${COPY.roteiroFaltaram(summary.script.missed)}`);
  lines.push(`${SIM.porSoltaEm}: ${SCRIPT_TRIGGERS.map((trigger) => `${EXPORTAR.valores.soltaEm[trigger]} ${summary.script.byTrigger[trigger] ?? 0}`).join(" · ")}`);

  return lines;
}
