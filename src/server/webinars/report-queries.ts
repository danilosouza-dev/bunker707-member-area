import "server-only";

// Leituras da aba Relatorio de um webinario (docs/30 §2.5, §3.4, §3.7 e §4.6): getWebinarReport e a RPC
// webinar_report em unstable_cache de 60 s, chave ["webinars-report", "v1", sessao, minuto] e tag "webinars"
// (o minuto do relogio na chave torna a janela de 60 s dura, como no relatorio do pop-up, docs/29 §4.6); os nomes
// dos alunos citados (top 10 do chat e mais quentes) vem numa segunda leitura de profiles, fora do cache.
// getWebinarAttendees e a lista por aluno (RPC webinar_attendees, sem cache: e a base do CSV). getWebinarReportPage
// monta a pagina inteira: o webinario, as sessoes com relatorio, a sessao escolhida (?sessao=) com o relatorio, a
// lista por aluno (nome, e-mail, hora da vaga e aparelho), as enquetes e as perguntas citadas, a Simulacao (a
// decisao do selo e o roteiro) e o endereco do CSV. webinarReportCsv escreve o CSV "Attendee" (docs/30 §3.7).
// Tudo pela service role; PendingMigrationError sobe para a pagina mostrar o aviso da migracao 202610290001.
// Nomes e e-mails so chegam a quem tem messaging.write (a pagina e a rota conferem); nunca nos graficos.

import { unstable_cache } from "next/cache";
import { toCsv } from "../../lib/csv";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { chunksOf, describeError } from "../communications/db";
import { isPendingMigrationError } from "../db/pending-migration";
import { WEBINARS_TAG } from "./cache";
import { pollFromRow, questionFromRow, type Attendee } from "./chat-rows";
import { fetchAttendees, listPollRows, listQuestionRows, listScriptItemRows } from "./chat-store";
import { assertNoDbError, isMissingWebinarSchema, webinarsDb, type WebinarsDb } from "./db";
import { toTime, type Poll, type QuestionStatus, type WebinarKind, type WebinarSession, type WebinarStatus } from "./model";
import {
  ATTENDEE_CSV_HEADERS,
  attendeeCsvFileName,
  attendeeCsvRow,
  attendeeScores,
  defaultReportSessionId,
  pollResults,
  reportSessionOptions,
  reportableSessions,
  toDevice,
  webinarReportCsvHref,
  type AttendeeDevice,
  type PollResult,
  type ReportAttendee,
  type ReportPerson,
  type ReportSessionOption,
  type SimulationSummary
} from "./report-page-model";
import { buildWebinarReport, readWebinarReportRows, reportUserIds, type WebinarReportView } from "./report-model";
import { sessionDurationMs } from "./room-model";
import { sessionFromRow, webinarFromRow, type RecordingRow, type SessionRow } from "./rows";
import { fetchSessionRow, fetchWebinarReport, fetchWebinarRow, listRecordingRows, listSessionRegistrationRows, listSessionRows } from "./store";

const PROFILE_CHUNK = 150;
const JOINED_EVENTS_MAX = 5000;

/* ------------------------------------------------------------------------------------------------
 * O relatorio da sessao em cache (60 s, por minuto)
 * ---------------------------------------------------------------------------------------------- */

/** O minuto do relogio que entra na chave do cache (docs/29 §4.6): cada minuto tem a sua entrada. */
export function webinarReportCacheMinute(now = Date.now()) {
  return Math.floor(now / 60_000);
}

async function loadReportView(sessionId: string, _minute: number): Promise<WebinarReportView> {
  void _minute;

  return buildWebinarReport(readWebinarReportRows(await fetchWebinarReport(webinarsDb(), sessionId)));
}

// So o resultado certo entra no cache (o erro sobe e nao fica guardado); o id e o minuto vao pelos argumentos.
const cachedReportView = unstable_cache(loadReportView, ["webinars-report", "v1"], { revalidate: 60, tags: [WEBINARS_TAG] });

/** A visao do relatorio pela chave do minuto; lanca PendingMigrationError sem a migracao. */
export function reportViewOf(sessionId: string, now = Date.now()): Promise<WebinarReportView> {
  return cachedReportView(sessionId, webinarReportCacheMinute(now));
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

export type WebinarReportResult = { people: Record<string, ReportPerson>; status: "ok"; view: WebinarReportView } | { status: "error" } | { status: "pending_migration" };

/** Relatorio de uma sessao (cache de 60 s, tag webinars) e os nomes do top 10 (segunda leitura, fora do cache). */
export async function getWebinarReport(sessionId: string, options: { now?: number } = {}): Promise<WebinarReportResult> {
  try {
    const view = await reportViewOf(sessionId, options.now);
    const people = await loadReportPeople(webinarsDb(), reportUserIds(view));

    return { people, status: "ok", view };
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      return { status: "pending_migration" };
    }

    console.error("[admin/webinarios] relatorio da sessao", describeError(error));

    return { status: "error" };
  }
}

/** A lista por aluno (RPC webinar_attendees), sem cache: e a base do CSV. */
export function getWebinarAttendees(sessionId: string): Promise<Attendee[]> {
  return fetchAttendees(webinarsDb(), sessionId);
}

/* ------------------------------------------------------------------------------------------------
 * A lista por aluno com nome, e-mail, hora da vaga, aparelho e pontuacao
 * ---------------------------------------------------------------------------------------------- */

type AttendeeFacts = { attendees: Attendee[]; devices: Map<string, AttendeeDevice>; registeredAt: Map<string, string> };

/** O aparelho de quem abriu a Sala (webinar_joined, docs/30 §4.7): o primeiro registro de cada aluno. */
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

async function loadAttendeeFacts(db: WebinarsDb, session: Pick<SessionRow, "id" | "webinar_id">): Promise<AttendeeFacts> {
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

function toReportAttendees(facts: AttendeeFacts, people: Record<string, ReportPerson>): ReportAttendee[] {
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
 * A pagina inteira
 * ---------------------------------------------------------------------------------------------- */

export type ReportQuestionInfo = { answeredBy: string | null; body: string; displayName: string; status: QuestionStatus };

export type WebinarReportSelection = {
  attendees: ReportAttendee[];
  csvHref: string;
  /** A duracao do video (a curva congelada; na sessao em andamento, a gravacao ou a duracao prevista). */
  durationMs: number;
  people: Record<string, ReportPerson>;
  polls: PollResult[];
  questions: Record<string, ReportQuestionInfo>;
  report: WebinarReportView;
  session: WebinarSession;
  simulation: SimulationSummary;
};

export type WebinarReportPage = {
  /** Existe uma sessao `replay` no webinario (o numero "Assistiram o replay" so faz sentido com ela). */
  hasReplay: boolean;
  selected: WebinarReportSelection | null;
  sessions: ReportSessionOption[];
  webinar: { durationMinutes: number; id: string; kind: WebinarKind; registrationRequired: boolean; slug: string; status: WebinarStatus; title: string };
};

export type ReportPageOptions = {
  now?: number;
  /** A sessao pedida (?sessao=); fora da lista, vale a padrao. */
  sessionId?: string | null;
  /** Nos testes, a visao do relatorio sem o cache do Next. */
  view?: (sessionId: string, now: number) => Promise<WebinarReportView>;
};

function recordingOf(recordings: readonly RecordingRow[], session: WebinarSession): RecordingRow | null {
  return (
    (session.recordingId ? recordings.find((recording) => recording.id === session.recordingId) : null) ??
    recordings.find((recording) => recording.session_id === null && recording.source === "bunny") ??
    recordings.find((recording) => recording.session_id === null) ??
    null
  );
}

export async function loadWebinarReportPage(db: WebinarsDb, webinarId: string, options: ReportPageOptions = {}): Promise<WebinarReportPage | null> {
  const row = await fetchWebinarRow(db, webinarId);

  if (!row) {
    return null;
  }

  const webinar = webinarFromRow(row);
  const sessionRows = await listSessionRows(db, [webinarId]);
  const sessions = sessionRows.map(sessionFromRow);
  const reportable = reportableSessions(sessions);
  const hasReplay = sessions.some((session) => session.kind === "replay" && session.status !== "cancelled");
  const selectedId = options.sessionId && reportable.some((session) => session.id === options.sessionId) ? options.sessionId : defaultReportSessionId(reportable);
  const page: WebinarReportPage = {
    hasReplay,
    selected: null,
    sessions: reportSessionOptions(webinarId, reportable, selectedId),
    webinar: {
      durationMinutes: webinar.durationMinutes,
      id: webinar.id,
      kind: webinar.kind,
      registrationRequired: webinar.registrationRequired,
      slug: webinar.slug,
      status: webinar.status,
      title: webinar.title
    }
  };
  const session = reportable.find((candidate) => candidate.id === selectedId);
  const sessionRow = sessionRows.find((candidate) => candidate.id === selectedId);

  if (!session || !sessionRow) {
    return page;
  }

  const now = options.now ?? Date.now();
  const report = await (options.view ?? reportViewOf)(session.id, now);
  const [facts, pollRows, questionRows, scriptItems, recordings] = await Promise.all([
    loadAttendeeFacts(db, sessionRow),
    listPollRows(db, { sessionId: session.id, webinarId }),
    report.questions.top.length > 0 ? listQuestionRows(db, { limit: 100, order: "votes", sessionId: session.id }) : Promise.resolve([]),
    listScriptItemRows(db, webinarId),
    listRecordingRows(db, [webinarId])
  ]);
  const questions: Record<string, ReportQuestionInfo> = {};

  for (const questionRow of questionRows) {
    const question = questionFromRow(questionRow);
    questions[question.id] = { answeredBy: question.answeredBy, body: question.body, displayName: question.displayName, status: question.status };
  }

  const people = await loadReportPeople(db, [
    ...reportUserIds(report),
    ...facts.attendees.map((attendee) => attendee.userId),
    ...(session.simulationDecidedBy ? [session.simulationDecidedBy] : []),
    ...Object.values(questions).flatMap((question) => (question.answeredBy ? [question.answeredBy] : []))
  ]);
  const polls: Poll[] = pollRows.polls.map((poll) => pollFromRow(poll, pollRows.options));
  const recording = recordingOf(recordings, session);

  page.selected = {
    attendees: toReportAttendees(facts, people),
    csvHref: webinarReportCsvHref(webinarId, session.id),
    durationMs: session.presenceCurve?.durationMs || sessionDurationMs(recording?.duration_seconds ?? null, webinar.durationMinutes),
    people,
    polls: pollResults(report.polls, polls),
    questions,
    report,
    session,
    simulation: {
      ackText: session.simulationAckText,
      decidedAt: session.simulationDecidedAt,
      decidedByName: session.simulationDecidedBy ? (people[session.simulationDecidedBy]?.name ?? null) : null,
      script: {
        fired: report.script.fired,
        missed: report.script.missed,
        ready: scriptItems.filter((item) => item.status === "ready" && item.trigger_kind !== "manual").length
      },
      showLiveBadge: session.showLiveBadge
    }
  };

  return page;
}

/** A pagina da aba Relatorio (service role); null quando o webinario nao existe. */
export function getWebinarReportPage(webinarId: string, options: ReportPageOptions = {}): Promise<WebinarReportPage | null> {
  return loadWebinarReportPage(webinarsDb(), webinarId, options);
}

/* ------------------------------------------------------------------------------------------------
 * O CSV "Attendee" (docs/30 §3.7)
 * ---------------------------------------------------------------------------------------------- */

export type WebinarReportCsv = { count: number; csv: string; fileName: string };

/** O CSV da lista por aluno da sessao; null quando a sessao nao e deste webinario (ou nao existe). */
export async function loadWebinarReportCsv(db: WebinarsDb, input: { sessionId: string; webinarId: string }): Promise<WebinarReportCsv | null> {
  const session = await fetchSessionRow(db, input.sessionId);

  if (!session || session.webinar_id !== input.webinarId) {
    return null;
  }

  const row = await fetchWebinarRow(db, input.webinarId);

  if (!row) {
    return null;
  }

  const facts = await loadAttendeeFacts(db, session);
  const people = await loadReportPeople(
    db,
    facts.attendees.map((attendee) => attendee.userId)
  );
  const attendees = toReportAttendees(facts, people).sort((left, right) => right.seconds - left.seconds || toTime(left.registeredAt) - toTime(right.registeredAt));

  return {
    count: attendees.length,
    csv: toCsv(ATTENDEE_CSV_HEADERS, attendees.map(attendeeCsvRow)),
    fileName: attendeeCsvFileName(row.slug, session.scheduled_at)
  };
}

export function webinarReportCsv(input: { sessionId: string; webinarId: string }): Promise<WebinarReportCsv | null> {
  return loadWebinarReportCsv(webinarsDb(), input);
}
