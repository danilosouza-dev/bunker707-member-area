import "server-only";

// Leituras da aba Relatorio de um webinario (docs/30 §2.5, §3.4, §3.5, §3.7 e §4.6): getWebinarReport e a RPC
// webinar_report em unstable_cache de 60 s, chave ["webinars-report", "v1", sessao, minuto] e tag "webinars"
// (o minuto do relogio na chave torna a janela de 60 s dura, como no relatorio do pop-up, docs/29 §4.6); os nomes
// dos alunos citados (top 10 do chat e mais quentes) vem numa segunda leitura de profiles, fora do cache.
// getWebinarAttendees e a lista por aluno (RPC webinar_attendees, sem cache: e a base do CSV). getWebinarReportPage
// monta a pagina inteira: o webinario, as sessoes com relatorio (as "Comeca quando voce entra" so dos ultimos 7 dias),
// a sessao escolhida (?sessao=) com o relatorio, a lista por aluno (nome, e-mail, hora da vaga e aparelho), as
// enquetes e as perguntas citadas, o trecho da transcricao de cada ponto de queda, o bloco Respostas do Assistente
// (ligado no webinario ou com resposta) e a Simulacao completa (a decisao do selo, as regras da 202610300003, o
// resumo congelado e o roteiro por Solta em). Os CSVs (os sete nomes do Zoom) sao de export-queries.ts, sem cache
// (M9); webinarReportCsv continua servindo o Attendee de sempre. Tudo pela service role; PendingMigrationError sobe
// para a pagina mostrar o aviso da migracao (WEBINARS_MIGRATION); as partes da fase 4 lidas guardadas mostram o aviso
// so no bloco delas. Nomes e e-mails so chegam a quem tem messaging.write (a pagina e a rota conferem); nunca nos graficos.

import { unstable_cache } from "next/cache";
import { describeError } from "../communications/db";
import { isPendingMigrationError } from "../db/pending-migration";
import { fetchAssistantSettings } from "./assistant-store";
import { WEBINARS_TAG } from "./cache";
import { pollFromRow, questionFromRow, scriptItemFromRow, transcriptCuesOf, type Attendee } from "./chat-rows";
import { fetchAttendees, fetchTranscriptRow, listPollRows, listQuestionRows, listScriptItemRows } from "./chat-store";
import { isMissingWebinarSchema, webinarsDb, type WebinarsDb } from "./db";
import {
  listSimulationScriptFires,
  loadAttendeeFacts,
  loadReportPeople,
  loadSessionExport,
  sessionRecordingOf,
  sessionVideoDurationMs,
  toReportAttendees,
  unlessMissing,
  type SessionExport
} from "./export-queries";
import { offerClickedByUser } from "./export-model";
import { SCRIPT_TRIGGERS, WEBINAR_EXPORT_REPORTS, type Poll, type QuestionStatus, type ScriptTrigger, type WebinarExportReport, type WebinarKind, type WebinarSession, type WebinarStatus } from "./model";
import {
  defaultReportSessionId,
  dropExcerpts,
  emptyScriptByTrigger,
  pollResults,
  reportSessionOptions,
  reportableSessions,
  webinarReportCsvHref,
  type PollResult,
  type ReportAttendee,
  type ReportPerson,
  type ReportSessionOption,
  type SimulationRulesSummary,
  type SimulationSummary
} from "./report-page-model";
import { buildWebinarReport, readWebinarReportRows, reportUserIds, type WebinarReportView } from "./report-model";
import { sessionFromRow, webinarFromRow } from "./rows";
import { listSessionOfferClicks } from "./offer-store";
import { fetchSessionSimulation } from "./simulation-store";
import { fetchWebinarReport, fetchWebinarRow, listRecordingRows, listSessionRows } from "./store";

export { loadReportPeople } from "./export-queries";

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
 * As partes da fase 4 lidas guardadas (o aviso da migracao fica so no bloco)
 * ---------------------------------------------------------------------------------------------- */

type Guarded<T> = { pending: false; value: T } | { pending: true };

async function guarded<T>(load: () => Promise<T>): Promise<Guarded<T>> {
  try {
    return { pending: false, value: await load() };
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      return { pending: true };
    }
    throw error;
  }
}

/* ------------------------------------------------------------------------------------------------
 * A pagina inteira
 * ---------------------------------------------------------------------------------------------- */

export type ReportQuestionInfo = { answeredBy: string | null; body: string; displayName: string; status: QuestionStatus };

export type WebinarReportSelection = {
  /** O bloco Respostas do Assistente: ligado no webinario (ou com resposta na sessao); `pending` sem a 202610300004. */
  assistant: { enabled: boolean; pending: boolean };
  attendees: ReportAttendee[];
  csvHref: string;
  /** O trecho da transcricao de cada ponto de queda (pelo balde); nulo quando a gravacao nao tem transcricao. */
  dropExcerpts: Record<number, string | null> | null;
  /** A duracao do video (a curva congelada; na sessao em andamento, a gravacao ou a duracao prevista). */
  durationMs: number;
  /** Os CSVs do menu Exportar desta sessao (a Simulacao so na sessao gravada). */
  exportReports: WebinarExportReport[];
  /**
   * A coluna "Oferta clicada" da lista por aluno (§3.4.1): a variante que cada aluno clicou nesta sessao ("B"; vazio
   * sem clique). Nulo na Live ao vivo (a Oferta so aparece na gravada e no Replay); banco sem a 202610300003: vazio.
   */
  offerClicked: Record<string, string> | null;
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

/** Os comentarios do roteiro que entraram, por Solta em (so o bloco Simulacao le). */
function simulationScriptByTrigger(fires: ReadonlyMap<string, number>, triggers: ReadonlyMap<string, ScriptTrigger>): Record<ScriptTrigger, number> {
  const counts = emptyScriptByTrigger();
  for (const itemId of fires.keys()) {
    const trigger = triggers.get(itemId);
    if (trigger && SCRIPT_TRIGGERS.includes(trigger)) {
      counts[trigger] += 1;
    }
  }
  return counts;
}

/** As regras da Simulacao da sessao (202610300003) no formato do bloco; nulo sem regra lida. */
async function loadSimulationRules(db: WebinarsDb, session: WebinarSession): Promise<Guarded<SimulationRulesSummary | null>> {
  if (session.kind !== "simulated") {
    return { pending: false, value: null };
  }
  return guarded(async () => {
    const simulation = await fetchSessionSimulation(db, session.id);
    return simulation
      ? {
          countMode: simulation.countRule.mode,
          joins: { enabled: simulation.joins.enabled, everySeconds: simulation.joins.everySeconds, max: simulation.joins.max },
          saleNotices: { enabled: simulation.saleNotices.enabled, items: simulation.saleNotices.items.length }
        }
      : null;
  });
}

export async function loadWebinarReportPage(db: WebinarsDb, webinarId: string, options: ReportPageOptions = {}): Promise<WebinarReportPage | null> {
  const row = await fetchWebinarRow(db, webinarId);

  if (!row) {
    return null;
  }

  const now = options.now ?? Date.now();
  const webinar = webinarFromRow(row);
  const sessionRows = await listSessionRows(db, [webinarId]);
  const sessions = sessionRows.map(sessionFromRow);
  const reportable = reportableSessions(sessions, now);
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

  const report = await (options.view ?? reportViewOf)(session.id, now);
  const simulated = session.kind === "simulated";
  const withOffer = session.kind !== "live";
  const [facts, pollRows, questionRows, scriptItems, recordings, assistant, rules, fires, clicks] = await Promise.all([
    loadAttendeeFacts(db, sessionRow),
    listPollRows(db, { sessionId: session.id, webinarId }),
    report.questions.top.length > 0 ? listQuestionRows(db, { limit: 100, order: "votes", sessionId: session.id }) : Promise.resolve([]),
    listScriptItemRows(db, webinarId),
    listRecordingRows(db, [webinarId]),
    guarded(() => fetchAssistantSettings(db, webinarId)),
    loadSimulationRules(db, session),
    simulated ? listSimulationScriptFires(db, [session.id]) : Promise.resolve(new Map<string, Map<string, number>>()),
    withOffer ? unlessMissing(() => listSessionOfferClicks(db, session.id), []) : Promise.resolve([])
  ]);
  const recording = sessionRecordingOf(recordings, session);
  const transcript = recording && report.presence.drops.length > 0 ? await fetchTranscriptRow(db, recording.id) : null;
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
  const items = scriptItemRowsOf(scriptItems);

  page.selected = {
    assistant: {
      enabled: assistant.pending ? false : (assistant.value?.enabled ?? false) || report.assistant.present,
      pending: assistant.pending
    },
    attendees: toReportAttendees(facts, people),
    csvHref: webinarReportCsvHref(webinarId, session.id),
    dropExcerpts: dropExcerpts(report.presence.drops, transcript ? transcriptCuesOf(transcript.cues) : null),
    durationMs: sessionVideoDurationMs(session, recording, webinar.durationMinutes),
    exportReports: WEBINAR_EXPORT_REPORTS.filter((entry) => entry !== "simulacao" || simulated),
    offerClicked: withOffer ? Object.fromEntries(offerClickedByUser(clicks.map((click) => ({ userId: click.user_id, variantLabel: click.variant_label })))) : null,
    people,
    polls: pollResults(report.polls, polls),
    questions,
    report,
    session,
    simulation: {
      ackText: session.simulationAckText,
      decidedAt: session.simulationDecidedAt,
      decidedByName: session.simulationDecidedBy ? (people[session.simulationDecidedBy]?.name ?? null) : null,
      pending: rules.pending,
      realParticipants: report.presence.unique,
      rules: rules.pending ? null : rules.value,
      script: {
        byTrigger: simulationScriptByTrigger(fires.get(session.id) ?? new Map(), new Map(items.map((item) => [item.id, item.triggerKind]))),
        fired: report.script.fired,
        missed: report.script.missed,
        ready: items.filter((item) => item.status === "ready" && item.triggerKind !== "manual").length
      },
      showLiveBadge: session.showLiveBadge,
      totals: report.simulation
    }
  };

  return page;
}

/** Os itens do roteiro com o que o relatorio usa: o id, a situacao e o Solta em. */
function scriptItemRowsOf(rows: Awaited<ReturnType<typeof listScriptItemRows>>) {
  return rows.map(scriptItemFromRow).map((item) => ({ id: item.id, status: item.status, triggerKind: item.triggerKind }));
}

/** A pagina da aba Relatorio (service role); null quando o webinario nao existe. */
export function getWebinarReportPage(webinarId: string, options: ReportPageOptions = {}): Promise<WebinarReportPage | null> {
  return loadWebinarReportPage(webinarsDb(), webinarId, options);
}

/* ------------------------------------------------------------------------------------------------
 * O CSV "Attendee" de sempre (a rota sem ?relatorio=); os outros seis em export-queries.ts
 * ---------------------------------------------------------------------------------------------- */

export type WebinarReportCsv = SessionExport;

/** O CSV da lista por aluno da sessao; null quando a sessao nao e deste webinario (ou nao existe). */
export function loadWebinarReportCsv(db: WebinarsDb, input: { sessionId: string; webinarId: string }): Promise<WebinarReportCsv | null> {
  return loadSessionExport(db, { report: "attendee", sessionId: input.sessionId, webinarId: input.webinarId });
}

export function webinarReportCsv(input: { sessionId: string; webinarId: string }): Promise<WebinarReportCsv | null> {
  return loadWebinarReportCsv(webinarsDb(), input);
}
