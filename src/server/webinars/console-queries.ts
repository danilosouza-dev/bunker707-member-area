// Leituras do console da sessao (docs/30 §2.4): a sessao que a equipe abre, o retrato que a pagina desenha de
// primeira e que a rota /api/admin/webinars/[id]/console devolve a cada 5 s (chat com os pendentes, o roteiro com o
// que ja entrou, as enquetes com as contagens, as perguntas por voto e os presentes agora). Tudo pela service role
// (webinarsDb) com assertNoDbError: banco sem a migracao 202610290001 vira PendingMigrationNotice na pagina.

import "server-only";

import { chatMessageFromRow, pollAnswerFromRow, pollFromRow, questionFromRow, scriptItemFromRow, CHAT_MESSAGE_COLUMNS, type ChatMessageRow } from "./chat-rows";
import { listPollAnswerRows, listPollRows, listPresentUserIds, listQuestionRows, listScriptItemRows, listSessionChatRows } from "./chat-store";
import { countPollAnswers, pickConsoleSession, type ConsoleMessage, type ConsolePollView, type ConsoleSnapshot } from "./console-model";
import { assertNoDbError, webinarsDb, type WebinarsDb } from "./db";
import type { WebinarKind, WebinarSession } from "./model";
import { baseRecordingOf } from "./queries";
import { presenceBucket, sessionOffsetMs } from "./room-model";
import { sessionFromRow, type SessionRow } from "./rows";
import { fetchSessionRow, fetchWebinarRow, listRecordingRows, listSessionRows } from "./store";

const PAGE = 1000;
const CONSENT_CHUNK = 200;

export type ConsoleWebinar = {
  durationMinutes: number;
  hostUserId: string | null;
  id: string;
  kind: WebinarKind;
  /** A duracao do video da gravacao base, quando a Bunny informou; senao a duracao prevista vale. */
  recordingDurationSeconds: number | null;
  slug: string;
  title: string;
};

export type SessionConsoleData = {
  sessions: WebinarSession[];
  /** Nulo quando o webinario ainda nao tem sessao nenhuma. */
  snapshot: ConsoleSnapshot | null;
  webinar: ConsoleWebinar;
};

/** Todas as linhas do chat de uma sessao, na ordem do video (a exportacao em CSV). */
export async function listAllSessionChatRows(db: WebinarsDb, sessionId: string): Promise<ChatMessageRow[]> {
  const rows: ChatMessageRow[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("webinar_chat_messages")
      .select(CHAT_MESSAGE_COLUMNS)
      .eq("session_id", sessionId)
      .is("deleted_at", null)
      .order("offset_ms", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    assertNoDbError(error, "Webinarios: chat inteiro da sessao");
    const part = (data ?? []) as ChatMessageRow[];
    rows.push(...part);

    if (part.length < PAGE) {
      return rows;
    }
  }
}

/** Quem ainda tem o aceite do chat valendo (uma linha sem revoked_at), para o "Aprovar para as proximas turmas". */
async function loadConsentFlags(db: WebinarsDb, userIds: readonly string[]): Promise<Set<string>> {
  const consented = new Set<string>();
  const wanted = Array.from(new Set(userIds));

  for (let index = 0; index < wanted.length; index += CONSENT_CHUNK) {
    const { data, error } = await db
      .from("webinar_chat_consents")
      .select("user_id, revoked_at")
      .in("user_id", wanted.slice(index, index + CONSENT_CHUNK));
    assertNoDbError(error, "Webinarios: aceites do chat");

    for (const row of (data ?? []) as { revoked_at: string | null; user_id: string }[]) {
      if (!row.revoked_at) {
        consented.add(row.user_id);
      }
    }
  }

  return consented;
}

/** Os itens do roteiro que ja entraram nesta sessao (pela abertura ou pelo botao), com a hora em que entraram. */
async function loadFiredScript(db: WebinarsDb, sessionId: string): Promise<Record<string, string | null>> {
  const fired: Record<string, string | null> = {};

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("webinar_chat_messages")
      .select("script_item_id, created_at")
      .eq("session_id", sessionId)
      .not("script_item_id", "is", null)
      .range(from, from + PAGE - 1);
    assertNoDbError(error, "Webinarios: roteiro que ja entrou");
    const part = (data ?? []) as { created_at: string; script_item_id: string }[];

    for (const row of part) {
      fired[row.script_item_id] = row.created_at;
    }

    if (part.length < PAGE) {
      return fired;
    }
  }
}

async function loadLaunchedPolls(db: WebinarsDb, webinarId: string, sessionId: string): Promise<ConsolePollView[]> {
  const launched = await listPollRows(db, { sessionId, webinarId });
  const views: ConsolePollView[] = [];

  for (const row of launched.polls) {
    const poll = pollFromRow(row, launched.options);
    const answers = (await listPollAnswerRows(db, poll.id)).map(pollAnswerFromRow);
    views.push({ ...poll, counts: countPollAnswers(poll, answers) });
  }

  return views;
}

/** O retrato do console de uma sessao agora. */
export async function loadConsoleSnapshot(db: WebinarsDb, input: { kind: WebinarKind; now: Date; session: SessionRow }): Promise<ConsoleSnapshot> {
  const session = sessionFromRow(input.session);
  const nowMs = input.now.getTime();
  const offsetMs = sessionOffsetMs(session, nowMs);
  const [chatRows, scriptRows, fired, launched, templates, questionRows, presentIds] = await Promise.all([
    listSessionChatRows(db, { sessionId: session.id }),
    input.kind === "simulated" ? listScriptItemRows(db, session.webinarId) : Promise.resolve([]),
    input.kind === "simulated" ? loadFiredScript(db, session.id) : Promise.resolve({}),
    loadLaunchedPolls(db, session.webinarId, session.id),
    listPollRows(db, { sessionId: null, webinarId: session.webinarId }),
    listQuestionRows(db, { order: "votes", sessionId: session.id }),
    Number.isFinite(offsetMs) ? listPresentUserIds(db, { currentBucket: presenceBucket(offsetMs / 1000), sessionId: session.id }) : Promise.resolve([])
  ]);
  const authors = chatRows.map((row) => row.author_user_id).filter((id): id is string => Boolean(id));
  const consented = authors.length > 0 ? await loadConsentFlags(db, authors) : new Set<string>();
  const messages: ConsoleMessage[] = chatRows.map((row) => ({
    ...chatMessageFromRow(row),
    promotable: row.author_user_id !== null && consented.has(row.author_user_id)
  }));

  return {
    messages,
    pinnedMessageId: session.pinnedMessageId,
    polls: { launched, templates: templates.polls.map((poll) => pollFromRow(poll, templates.options)) },
    presentNow: presentIds.length,
    questions: questionRows.map(questionFromRow),
    scriptFired: fired,
    scriptItems: scriptRows.map(scriptItemFromRow),
    serverTime: input.now.toISOString(),
    session
  };
}

/** A pagina do console: o webinario, as sessoes para o seletor e o retrato da sessao escolhida (ou a padrao). */
export async function getSessionConsoleData(webinarId: string, requestedSessionId: string | null, now: Date = new Date()): Promise<SessionConsoleData | null> {
  const db = webinarsDb();
  const row = await fetchWebinarRow(db, webinarId);

  if (!row) {
    return null;
  }

  const [sessionRows, recordings] = await Promise.all([listSessionRows(db, [row.id]), listRecordingRows(db, [row.id])]);
  const sessions = sessionRows.map(sessionFromRow);
  const picked = pickConsoleSession(sessions, requestedSessionId, now.getTime());
  const pickedRow = picked ? (sessionRows.find((session) => session.id === picked.id) ?? null) : null;
  const kind: WebinarKind = row.kind === "simulated" ? "simulated" : "live";

  return {
    sessions,
    snapshot: pickedRow ? await loadConsoleSnapshot(db, { kind, now, session: pickedRow }) : null,
    webinar: {
      durationMinutes: row.duration_minutes,
      hostUserId: row.host_user_id,
      id: row.id,
      kind,
      recordingDurationSeconds: baseRecordingOf(recordings)?.duration_seconds ?? null,
      slug: row.slug,
      title: row.title
    }
  };
}

/** O retrato para a rota de 5 s: nulo quando a sessao nao e deste webinario. */
export async function getConsoleSnapshot(webinarId: string, sessionId: string, now: Date = new Date()): Promise<ConsoleSnapshot | null> {
  const db = webinarsDb();
  const [row, session] = await Promise.all([fetchWebinarRow(db, webinarId), fetchSessionRow(db, sessionId)]);

  if (!row || !session || session.webinar_id !== row.id) {
    return null;
  }

  return loadConsoleSnapshot(db, { kind: row.kind === "simulated" ? "simulated" : "live", now, session });
}
