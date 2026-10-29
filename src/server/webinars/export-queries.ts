import "server-only";

// As leituras dos CSVs com os nomes do Zoom (docs/30 §3.4.1, §3.5, §3.7, M6, M8, M9, A20 e A25), pela service role e
// SEM cache (M9: nome e e-mail nunca vao para o Data Cache): loadSessionExport monta os sete arquivos de uma sessao
// (Registration, Attendee, Performance, Q&A, Poll, Survey e o extra Simulacao) e loadPanelExport os dois do periodo
// de um painel (Performance e Simulacao, com o mesmo recorte da aba: resolvePanelSelection). Tambem aqui as leituras que a aba Relatorio divide
// com o CSV: os nomes (profiles), a lista por aluno com a hora da vaga e o aparelho (webinar_attendees + webinar_joined)
// e a gravacao da sessao. As partes da fase 4 sao lidas guardadas: banco sem a 202610290005 (cliques, Simulacao) ou a
// 202610290006 (quem respondeu) devolve o CSV sem elas, nunca quebra; o resto sobe como PendingMigrationError (a rota
// responde 503 com a migracao). Os numeros reais vem das RPCs (webinar_panel, webinar_report); as linhas simuladas so
// pelo CSV Simulacao (as funcoes *Simulation* abaixo), nunca noutro (D6, M6). A equipe (admin_roles) fica fora.

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { chunksOf } from "../communications/db";
import { isPendingMigrationError } from "../db/pending-migration";
import { fetchAttendanceMarks } from "./assistant-store";
import { POLL_ANSWER_COLUMNS, QUESTION_COLUMNS, pollFromRow, scriptItemFromRow, type Attendee, type PollAnswerRow, type QuestionRow } from "./chat-rows";
import { fetchAttendees, listPollRows, listScriptItemRows } from "./chat-store";
import { assertNoDbError, isMissingWebinarSchema, type WebinarsDb } from "./db";
import {
  attendeeExportRows,
  exportCsvText,
  offerClickedByUser,
  panelExportFileName,
  performanceFactsFromPanel,
  performanceFactsFromReport,
  performanceRow,
  periodSimulationRows,
  PERIOD_SIMULATION_COLUMNS,
  pollExportRows,
  qaExportRows,
  registrationExportRows,
  sessionExportFileName,
  simulationElapsedMs,
  simulationExportRows,
  surveyExportRows,
  type ExportCsv,
  type PanelExportRequest,
  type PerformanceSession,
  type PollAnswerInput,
  type QaQuestionInput,
  type SimulationExportInput,
  type SimulationScriptItemInput
} from "./export-model";
import { WEBINAR_EXPORT_LIMITS, toTime, type AttendanceMarks, type PanelRow, type SessionKind, type SessionSimulation, type WebinarExportReport, type WebinarSession } from "./model";
import { listSessionOfferClicks } from "./offer-store";
import { fetchWebinarPanel } from "./panel-store";
import { attendeeScores, attendeeWasPresent, toDevice, type AttendeeDevice, type ReportAttendee, type ReportPerson } from "./report-page-model";
import { buildWebinarReport, readWebinarReportRows } from "./report-model";
import { sessionDurationMs } from "./room-model";
import { sessionFromRow, type RecordingRow, type SessionRow, type WebinarRow } from "./rows";
import { simulationDecisionRecorded } from "./simulation-ack";
import { listSessionSimulations } from "./simulation-store";
import { fetchAll, fetchSessionRow, fetchWebinarReport, fetchWebinarRow, listRecordingRows, listSessionRegistrationRows, listSessionRows } from "./store";

const PROFILE_CHUNK = 150;
const ID_CHUNK = 150;
const JOINED_EVENTS_MAX = 5000;

/* ------------------------------------------------------------------------------------------------
 * Leituras guardadas e a equipe
 * ---------------------------------------------------------------------------------------------- */

/** Uma parte da fase 4 lida guardada: banco sem a migracao dela devolve `fallback` (o resto do CSV sai). */
export async function unlessMissing<T>(load: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      return fallback;
    }
    throw error;
  }
}

/** Quem tem linha em admin_roles (a equipe nunca conta como aluno, como nas RPCs). */
export async function listStaffIds(db: WebinarsDb): Promise<Set<string>> {
  const { data, error } = await db.from("admin_roles").select("user_id");
  assertNoDbError(error, "Webinarios: equipe");
  return new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id));
}

/** Nome e e-mail dos alunos citados, fora do cache (so ids no cache; a tela decide quem ve o e-mail). */
export async function loadReportPeople(db: WebinarsDb, userIds: readonly string[]): Promise<Record<string, ReportPerson>> {
  const people: Record<string, ReportPerson> = {};

  for (const part of chunksOf([...new Set(userIds.filter(Boolean))], PROFILE_CHUNK)) {
    const { data, error } = await db.from("profiles").select("id,full_name,email").in("id", part);
    assertNoDbError(error, "Webinarios: nomes do relatorio");

    for (const row of (data ?? []) as { email: string | null; full_name: string | null; id: string }[]) {
      people[row.id] = { email: row.email?.trim() || null, name: row.full_name?.trim() || WEBINAR_COPY.relatorio.alunoSemNome };
    }
  }

  return people;
}

/** A gravacao que vale para a sessao: a dela; sem ela, a do webinario (a da Bunny primeiro). */
export function sessionRecordingOf(recordings: readonly RecordingRow[], session: Pick<WebinarSession, "recordingId">): RecordingRow | null {
  return (
    (session.recordingId ? recordings.find((recording) => recording.id === session.recordingId) : null) ??
    recordings.find((recording) => recording.session_id === null && recording.source === "bunny") ??
    recordings.find((recording) => recording.session_id === null) ??
    null
  );
}

/** A duracao do video da sessao: a curva congelada; sem ela, a gravacao ou a duracao prevista do webinario. */
export function sessionVideoDurationMs(session: WebinarSession, recording: RecordingRow | null, durationMinutes: number): number {
  return session.presenceCurve?.durationMs || sessionDurationMs(recording?.duration_seconds ?? null, durationMinutes);
}

/* ------------------------------------------------------------------------------------------------
 * A lista por aluno com nome, e-mail, hora da vaga, aparelho e pontuacao (a aba Relatorio e o Attendee)
 * ---------------------------------------------------------------------------------------------- */

export type AttendeeFacts = { attendees: Attendee[]; devices: Map<string, AttendeeDevice>; registeredAt: Map<string, string> };

/** O aparelho de quem abriu a Sala (webinar_joined, docs/30 §4.7): o primeiro registro de cada aluno. Sem pais nem rede (A25). */
async function loadJoinedDevices(db: WebinarsDb, sessionId: string): Promise<Map<string, AttendeeDevice>> {
  const { data, error } = await db
    .from("student_events")
    .select("user_id, metadata")
    .eq("entity_type", "webinar")
    .eq("entity_id", sessionId)
    .eq("event_type", "webinar_joined")
    .order("created_at", { ascending: true })
    .limit(JOINED_EVENTS_MAX);
  assertNoDbError(error, "Webinarios: aparelho de quem entrou");
  const devices = new Map<string, AttendeeDevice>();

  for (const row of (data ?? []) as { metadata: unknown; user_id: string }[]) {
    const metadata = row.metadata && typeof row.metadata === "object" ? (row.metadata as Record<string, unknown>) : {};
    const device = toDevice(metadata.device);

    if (device && !devices.has(row.user_id)) {
      devices.set(row.user_id, device);
    }
  }

  return devices;
}

export async function loadAttendeeFacts(db: WebinarsDb, session: Pick<SessionRow, "id" | "webinar_id">): Promise<AttendeeFacts> {
  const [attendees, registrations, devices] = await Promise.all([
    fetchAttendees(db, session.id),
    listSessionRegistrationRows(db, session, ["registered", "cancelled"]),
    loadJoinedDevices(db, session.id)
  ]);
  const registeredAt = new Map<string, string>();

  // A vaga que vale: a garantida; sem ela, a cancelada (a hora em que o aluno chegou a garantir).
  for (const row of registrations) {
    const current = registeredAt.get(row.user_id);

    if (!current || row.status === "registered") {
      registeredAt.set(row.user_id, row.registered_at);
    }
  }

  return { attendees, devices, registeredAt };
}

export function toReportAttendees(facts: AttendeeFacts, people: Record<string, ReportPerson>): ReportAttendee[] {
  const scores = attendeeScores(facts.attendees);

  return facts.attendees.map((attendee) => ({
    ...attendee,
    device: facts.devices.get(attendee.userId) ?? null,
    email: people[attendee.userId]?.email ?? null,
    name: people[attendee.userId]?.name ?? WEBINAR_COPY.relatorio.alunoSemNome,
    registeredAt: facts.registeredAt.get(attendee.userId) ?? null,
    score: scores.get(attendee.userId) ?? 0
  }));
}

/* ------------------------------------------------------------------------------------------------
 * Os sete CSVs de uma sessao
 * ---------------------------------------------------------------------------------------------- */

type SessionContext = { db: WebinarsDb; now: number; row: SessionRow; session: WebinarSession; webinar: WebinarRow };

type Rows = ReturnType<typeof registrationExportRows>;

/** Quem esteve no replay do webinario (a sessao `replay`, aberta ou encerrada), para "Viu o replay". */
async function loadReplayViewers(db: WebinarsDb, webinarId: string): Promise<Set<string>> {
  const replays = (await listSessionRows(db, [webinarId])).filter((row) => row.kind === "replay" && row.status !== "cancelled");
  const viewers = new Set<string>();
  for (const replay of replays) {
    for (const attendee of await fetchAttendees(db, replay.id)) {
      if (attendeeWasPresent(attendee)) {
        viewers.add(attendee.userId);
      }
    }
  }
  return viewers;
}

async function registrationRows({ db, row, webinar }: SessionContext): Promise<Rows> {
  const [registrations, staff, attendees, replayViewers] = await Promise.all([
    listSessionRegistrationRows(db, row, ["registered", "cancelled"]),
    listStaffIds(db),
    fetchAttendees(db, row.id),
    loadReplayViewers(db, webinar.id)
  ]);
  const students = registrations.filter((registration) => !staff.has(registration.user_id));
  const people = await loadReportPeople(
    db,
    students.map((registration) => registration.user_id)
  );

  return registrationExportRows({
    people,
    present: new Set(attendees.filter(attendeeWasPresent).map((attendee) => attendee.userId)),
    registrations: students.map((registration) => ({
      registeredAt: registration.registered_at,
      reminder1hSentAt: registration.reminder_1h_sent_at,
      reminder24hSentAt: registration.reminder_24h_sent_at,
      source: registration.source,
      sourceCampaignId: registration.source_campaign_id,
      status: registration.status === "cancelled" ? "cancelled" : "registered",
      userId: registration.user_id
    })),
    replayViewers
  });
}

async function attendeeRows({ db, row }: SessionContext): Promise<Rows> {
  const [facts, clicks] = await Promise.all([loadAttendeeFacts(db, row), unlessMissing(() => listSessionOfferClicks(db, row.id), [])]);
  const people = await loadReportPeople(
    db,
    facts.attendees.map((attendee) => attendee.userId)
  );

  return attendeeExportRows(
    toReportAttendees(facts, people),
    offerClickedByUser(clicks.map((click) => ({ userId: click.user_id, variantLabel: click.variant_label })))
  );
}

/** A Performance da sessao: a mesma conta do painel (webinar_panel) na ao vivo e na gravada; no replay, o relatorio. */
async function performanceRows({ db, session, webinar }: SessionContext): Promise<Rows> {
  const base: PerformanceSession = { id: session.id, kind: session.kind, scheduledAt: session.scheduledAt, webinarTitle: webinar.title };

  if (session.kind === "replay") {
    const [rows, recordings] = await Promise.all([fetchWebinarReport(db, session.id), listRecordingRows(db, [webinar.id])]);
    const view = buildWebinarReport(readWebinarReportRows(rows));
    return [performanceRow(performanceFactsFromReport(view, base, sessionVideoDurationMs(session, sessionRecordingOf(recordings, session), webinar.duration_minutes)))];
  }

  const at = toTime(session.scheduledAt);
  const rows = await fetchWebinarPanel(db, {
    end: new Date(at + 1000).toISOString(),
    kind: session.kind,
    sessionIds: [session.id],
    start: new Date(at - 1000).toISOString()
  });

  return [performanceRow(performanceFactsFromPanel(rows, base))];
}

/** As perguntas da sessao (nao apagadas), na ordem em que chegaram; sem teto de 500 como a tela. */
async function listSessionQuestionRows(db: WebinarsDb, sessionId: string): Promise<QuestionRow[]> {
  return fetchAll<QuestionRow>(
    (from, to) =>
      db.from("webinar_questions").select(QUESTION_COLUMNS).eq("session_id", sessionId).is("deleted_at", null).order("created_at", { ascending: true }).range(from, to),
    "Webinarios: perguntas do CSV"
  );
}

/** Quem respondeu cada pergunta (202610290006: answer_source); sem a migracao, nenhum (a resposta sai como da equipe). */
async function loadQuestionMarks(db: WebinarsDb, ids: readonly string[]): Promise<Map<string, AttendanceMarks>> {
  const marks = new Map<string, AttendanceMarks>();
  for (const part of chunksOf([...ids], ID_CHUNK)) {
    const found = await unlessMissing(() => fetchAttendanceMarks(db, { ids: part, target: "question" }), new Map<string, AttendanceMarks>());
    found.forEach((value, key) => marks.set(key, value));
  }
  return marks;
}

async function qaRows({ db, row, webinar }: SessionContext): Promise<Rows> {
  const [questionRows, staff] = await Promise.all([listSessionQuestionRows(db, row.id), listStaffIds(db)]);
  const students = questionRows.filter((question) => !staff.has(question.user_id));
  const [marks, people] = await Promise.all([
    loadQuestionMarks(
      db,
      students.map((question) => question.id)
    ),
    loadReportPeople(db, [...students.map((question) => question.user_id), ...students.flatMap((question) => (question.answered_by ? [question.answered_by] : []))])
  ]);
  const questions: QaQuestionInput[] = students.map((question) => ({
    anonymous: question.anonymous,
    answerSource: marks.get(question.id)?.answerSource ?? null,
    answerText: question.answer_text,
    answeredAt: question.answered_at,
    answeredBy: question.answered_by,
    answeredLive: question.answered_live,
    body: question.body,
    createdAt: question.created_at,
    offsetMs: question.offset_ms,
    status: question.status === "answered" || question.status === "dismissed" ? question.status : "open",
    upvotes: question.upvotes ?? 0,
    userId: question.user_id
  }));

  return qaExportRows({ people, questions, webinarId: webinar.id });
}

/** As respostas das enquetes da sessao (nao apagadas) e as enquetes com as opcoes; a equipe fora. */
async function loadPollAnswers(db: WebinarsDb, row: SessionRow) {
  const [pollRows, answerRows, staff] = await Promise.all([
    listPollRows(db, { sessionId: row.id, webinarId: row.webinar_id }),
    fetchAll<PollAnswerRow>(
      (from, to) =>
        db.from("webinar_poll_answers").select(POLL_ANSWER_COLUMNS).eq("session_id", row.id).is("deleted_at", null).order("created_at", { ascending: true }).range(from, to),
      "Webinarios: respostas das enquetes do CSV"
    ),
    listStaffIds(db)
  ]);
  const polls = pollRows.polls.map((poll) => pollFromRow(poll, pollRows.options));
  const answers: PollAnswerInput[] = answerRows
    .filter((answer) => !staff.has(answer.user_id))
    .map((answer) => ({ createdAt: answer.created_at, offsetMs: answer.offset_ms, optionIds: answer.option_ids ?? [], pollId: answer.poll_id, userId: answer.user_id }));
  const people = await loadReportPeople(
    db,
    answers.map((answer) => answer.userId)
  );

  return { answers, people, polls };
}

async function pollRows({ db, row }: SessionContext): Promise<Rows> {
  return pollExportRows(await loadPollAnswers(db, row));
}

async function surveyRows({ db, row }: SessionContext): Promise<Rows> {
  return surveyExportRows(await loadPollAnswers(db, row));
}

/* ------------------------------------------------------------------------------------------------
 * A Simulacao (so a sessao gravada): o roteiro que entrou, o contador, as entradas e os avisos de venda
 * ---------------------------------------------------------------------------------------------- */

/**
 * Os comentarios do roteiro que entraram em cada sessao (as mensagens `scripted` com o item do roteiro): o id do item
 * e o minuto em que entrou. So o CSV Simulacao e o bloco Simulacao leem (D6, M6).
 */
export async function listSimulationScriptFires(db: WebinarsDb, sessionIds: readonly string[]): Promise<Map<string, Map<string, number>>> {
  const bySession = new Map<string, Map<string, number>>();
  for (const part of chunksOf([...new Set(sessionIds)], ID_CHUNK)) {
    const rows = await fetchAll<{ offset_ms: number; script_item_id: string | null; session_id: string }>(
      (from, to) =>
        db
          .from("webinar_chat_messages")
          .select("session_id, script_item_id, offset_ms")
          .in("session_id", part)
          .eq("source", "scripted")
          .not("script_item_id", "is", null)
          .order("offset_ms", { ascending: true })
          .range(from, to),
      "Webinarios: roteiro que entrou"
    );
    for (const row of rows) {
      if (!row.script_item_id) {
        continue;
      }
      const fires = bySession.get(row.session_id) ?? new Map<string, number>();
      fires.set(row.script_item_id, row.offset_ms);
      bySession.set(row.session_id, fires);
    }
  }
  return bySession;
}

function simulationScriptItemsOf(rows: Awaited<ReturnType<typeof listScriptItemRows>>): SimulationScriptItemInput[] {
  return rows.map(scriptItemFromRow).map((item) => ({
    body: item.body,
    id: item.id,
    offsetMs: item.offsetMs,
    personaName: item.personaName,
    position: item.position,
    resolvedOffsetMs: item.resolvedOffsetMs,
    status: item.status,
    triggerKind: item.triggerKind
  }));
}

async function simulationRows({ db, now, session, webinar }: SessionContext): Promise<Rows> {
  if (session.kind !== "simulated") {
    return [];
  }
  const [simulations, items, fires, reportRows, recordings] = await Promise.all([
    unlessMissing(() => listSessionSimulations(db, [session.id]), [] as SessionSimulation[]),
    listScriptItemRows(db, webinar.id),
    listSimulationScriptFires(db, [session.id]),
    fetchWebinarReport(db, session.id),
    listRecordingRows(db, [webinar.id])
  ]);
  const durationMs = sessionVideoDurationMs(session, sessionRecordingOf(recordings, session), webinar.duration_minutes);
  const input: SimulationExportInput = {
    decided: simulationDecisionRecorded(session),
    elapsedMs: simulationElapsedMs({ durationMs, endedAt: session.endedAt, now, scheduledAt: session.scheduledAt, startedAt: session.startedAt, status: session.status }),
    fired: fires.get(session.id) ?? new Map(),
    items: simulationScriptItemsOf(items),
    realParticipants: buildWebinarReport(readWebinarReportRows(reportRows)).presence.unique,
    simulation: simulations.find((simulation) => simulation.sessionId === session.id) ?? null
  };

  return simulationExportRows(input);
}

const SESSION_ROWS: Record<WebinarExportReport, (context: SessionContext) => Promise<Rows>> = {
  attendee: attendeeRows,
  performance: performanceRows,
  poll: pollRows,
  qa: qaRows,
  registration: registrationRows,
  simulacao: simulationRows,
  survey: surveyRows
};

export type SessionExport = ExportCsv & { kind: SessionKind };

/**
 * Um CSV de uma sessao; null quando a sessao nao e deste webinario (ou nao existe). Sem cache (M9): cada pedido le o
 * banco. A Simulacao fora da sessao gravada sai so com a frase e as colunas.
 */
export async function loadSessionExport(db: WebinarsDb, input: { now?: number; report: WebinarExportReport; sessionId: string; webinarId: string }): Promise<SessionExport | null> {
  const row = await fetchSessionRow(db, input.sessionId);

  if (!row || row.webinar_id !== input.webinarId) {
    return null;
  }

  const webinar = await fetchWebinarRow(db, input.webinarId);

  if (!webinar) {
    return null;
  }

  const session = sessionFromRow(row);
  const rows = await SESSION_ROWS[input.report]({ db, now: input.now ?? Date.now(), row, session, webinar });

  return {
    count: Math.min(rows.length, WEBINAR_EXPORT_LIMITS.rowsMax),
    csv: exportCsvText(input.report, rows),
    fileName: sessionExportFileName({ report: input.report, scheduledAt: session.scheduledAt, slug: webinar.slug }),
    kind: session.kind
  };
}

/* ------------------------------------------------------------------------------------------------
 * Os dois CSVs do periodo de um painel (Performance e Simulacao)
 * ---------------------------------------------------------------------------------------------- */

/** O que o CSV do periodo usa de cada sessao do recorte do painel (PanelSession de panel-model.ts). */
type PeriodSession = Pick<WebinarSession, "endedAt" | "id" | "scheduledAt" | "startedAt" | "status"> & { kind: SessionKind; simulationDecided: boolean; webinarId: string; webinarTitle: string };

/**
 * O recorte do painel: as mesmas sessoes que a aba mostra (resolvePanelSelection, de panel-queries.ts: o periodo, os
 * filtros da aba, as canceladas fora sem o filtro Situacao, "Com oferta" e "Variante" pela Oferta montada e pelo que a
 * sessao mostrou), as mais recentes ate o teto, na ordem das horas marcadas. Import dinamico: panel-queries le o
 * relatorio (report-queries.ts), que le este arquivo; assim o grafo dos modulos nao fecha um ciclo.
 */
async function loadPeriodSessions(db: WebinarsDb, request: PanelExportRequest): Promise<{ sessions: PeriodSession[]; window: { end: string; start: string } }> {
  const { resolvePanelSelection } = await import("./panel-queries");
  const selection = await resolvePanelSelection(db, {
    filters: request.filters,
    kind: request.kind,
    window: { end: new Date(request.period.end), start: new Date(request.period.start) }
  });
  const sessions = [...selection.selected]
    .sort((left, right) => toTime(right.scheduledAt) - toTime(left.scheduledAt))
    .slice(0, WEBINAR_EXPORT_LIMITS.sessionsPerPanelExport)
    .sort((left, right) => toTime(left.scheduledAt) - toTime(right.scheduledAt));

  return { sessions, window: selection.window };
}

/** A Simulacao de cada sessao gravada do recorte (o real ao lado do contador e a duracao vem das linhas do painel). */
async function periodSimulationExportRows(db: WebinarsDb, sessions: readonly PeriodSession[], panel: readonly PanelRow[], now: number): Promise<Rows> {
  const simulated = sessions.filter((session) => session.kind === "simulated");
  if (simulated.length === 0) {
    return [];
  }
  const sessionIds = simulated.map((session) => session.id);
  const webinarIds = [...new Set(simulated.map((session) => session.webinarId))];
  const [simulations, fires, itemsByWebinar] = await Promise.all([
    unlessMissing(async () => (await Promise.all(chunksOf(sessionIds, ID_CHUNK).map((part) => listSessionSimulations(db, part)))).flat(), [] as SessionSimulation[]),
    listSimulationScriptFires(db, sessionIds),
    Promise.all(webinarIds.map(async (webinarId) => [webinarId, simulationScriptItemsOf(await listScriptItemRows(db, webinarId))] as const)).then((pairs) => new Map(pairs))
  ]);
  const total = (sessionId: string, metric: string) => panel.find((row) => row.sessionId === sessionId && row.metric === metric && row.item === "")?.total ?? 0;

  return periodSimulationRows(
    simulated.map((session) => {
      const durationMs = total(session.id, "duration");
      return {
        input: {
          decided: session.simulationDecided,
          elapsedMs: simulationElapsedMs({ durationMs, endedAt: session.endedAt, now, scheduledAt: session.scheduledAt, startedAt: session.startedAt, status: session.status }),
          fired: fires.get(session.id) ?? new Map(),
          items: itemsByWebinar.get(session.webinarId) ?? [],
          realParticipants: total(session.id, "present"),
          simulation: simulations.find((simulation) => simulation.sessionId === session.id) ?? null
        },
        scheduledAt: session.scheduledAt,
        sessionId: session.id,
        webinarTitle: session.webinarTitle
      };
    })
  );
}

/**
 * Um CSV do periodo de um painel (so Performance e Simulacao, webinarExportSchema), com o mesmo recorte da aba (o
 * arquivo bate com a tela). Sem cache (M9): webinar_panel e lida direto, nunca pelo cache de 60 s do painel.
 */
export async function loadPanelExport(db: WebinarsDb, request: PanelExportRequest, options: { now?: number } = {}): Promise<ExportCsv & { sessions: number }> {
  const fileName = panelExportFileName({ end: request.period.end, kind: request.kind, report: request.report, start: request.period.start });
  const headers = request.report === "simulacao" ? PERIOD_SIMULATION_COLUMNS : undefined;
  const { sessions, window } = await loadPeriodSessions(db, request);

  if (sessions.length === 0) {
    return { count: 0, csv: exportCsvText(request.report, [], headers), fileName, sessions: 0 };
  }

  const panel = await fetchWebinarPanel(db, {
    end: window.end,
    kind: request.kind,
    sessionIds: sessions.map((session) => session.id),
    start: window.start
  });
  const rows =
    request.report === "simulacao"
      ? await periodSimulationExportRows(db, sessions, panel, options.now ?? Date.now())
      : sessions.map((session) =>
          performanceRow(performanceFactsFromPanel(panel, { id: session.id, kind: session.kind, scheduledAt: session.scheduledAt, webinarTitle: session.webinarTitle }))
        );

  return { count: Math.min(rows.length, WEBINAR_EXPORT_LIMITS.rowsMax), csv: exportCsvText(request.report, rows, headers), fileName, sessions: sessions.length };
}
