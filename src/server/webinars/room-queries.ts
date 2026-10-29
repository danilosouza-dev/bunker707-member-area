// Leituras da Sala do aluno (docs/30 §1.6, §5.1 e §6.6): o contexto de uma sessao (webinario publicado e dentro do
// acesso, a sessao do proprio webinario, a gravacao e a duracao do video), o que GET .../session devolve a mais na
// fase 2 (relogio, fase, video da Bunny com o token do servidor, mensagem fixada, enquetes, presentes agora e o
// aceite do aluno), a janela do chat e as mensagens novas, as perguntas, as enquetes e as reacoes recentes. Tudo
// pela service role e so o que o aluno pode ver; as regras puras ficam em room-model.ts e room-rules.ts.

import "server-only";

import { createHash } from "node:crypto";
import { fetchProfile } from "../students/store";
import {
  fetchChatWindow,
  fetchConsentRow,
  fetchPinnedMessageRow,
  listPollAnswerRows,
  listPollRows,
  listQuestionRows,
  listReactionRowsSince,
  listRecentChatRows,
  listPresentUserIds,
  listStudentVotedQuestionIds
} from "./chat-store";
import { chatMessageFromRow, chatMessageFromWindowRow, pollAnswerFromRow, pollFromRow, questionFromRow, type ConsentRow } from "./chat-rows";
import { WebinarError, webinarsDb, type WebinarsDb } from "./db";
import { CHAT_CONSENT_VERSION, REACTIONS, toTime, type DisplayNameMode, type Reaction, type StudentChatMessage, type Webinar, type WebinarSession } from "./model";
import { loadStudentWebinarById, type StudentWebinarRecord } from "./registrations";
import {
  anonymousNumber,
  bunnyEmbedTokenInput,
  bunnyEmbedUrl,
  canJoinSimulated,
  displayNameFor,
  isValidChatWindow,
  parseBunnyEmbed,
  presenceBucket,
  sessionDurationMs,
  sessionOffsetMs,
  simulatedPhase,
  toStudentMessage,
  type ChatWindow
} from "./room-model";
import { countReactions, nextChatCursor, toStudentPoll, toStudentQuestion, type ChatCursor, type StudentPoll, type StudentQuestion } from "./room-rules";
import type { RecordingRow } from "./rows";
import { listRecordingRows } from "./store";
import { openReplaySessionId, type StudentRoomExtras, type StudentRoomVideo } from "./student-model";

export const INVALID_SESSION_MESSAGE = "Sessão inválida.";

/** Quanto o token de visualizacao da Bunny vale (docs/30 §5.1: `expires`), em segundos. */
export const BUNNY_TOKEN_TTL_SECONDS = 6 * 60 * 60;

export type RoomContext = {
  durationMs: number;
  recording: RecordingRow | null;
  session: WebinarSession;
  sessions: WebinarSession[];
  webinar: Webinar;
};

/** A gravacao que a sessao usa: a ligada a ela; senao a mais nova pronta com o video da Bunny. */
export function pickRecording(recordings: readonly RecordingRow[], session: Pick<WebinarSession, "recordingId">): RecordingRow | null {
  const linked = session.recordingId ? recordings.find((row) => row.id === session.recordingId) : null;
  if (linked) {
    return linked;
  }
  return recordings.find((row) => row.status === "ready" && bunnyRefOf(row) !== null) ?? recordings[0] ?? null;
}

function bunnyRefOf(recording: RecordingRow | null) {
  if (!recording) {
    return null;
  }
  const fromUrl = parseBunnyEmbed(recording.embed_url);
  if (fromUrl) {
    return fromUrl;
  }
  if (recording.bunny_library_id && recording.bunny_video_id && /^\d{1,12}$/.test(recording.bunny_library_id) && /^[0-9a-f-]{8,80}$/i.test(recording.bunny_video_id)) {
    return { libraryId: recording.bunny_library_id, videoId: recording.bunny_video_id.toLowerCase() };
  }
  return null;
}

/** O token de visualizacao da Bunny (SHA-256 de chave + video + expires), so quando a biblioteca pede (BUNNY_EMBED_TOKEN_KEY). */
export function bunnyViewToken(videoId: string, nowMs: number, tokenKey: string | undefined = process.env.BUNNY_EMBED_TOKEN_KEY): { expires: number; token: string } | null {
  const key = tokenKey?.trim();
  if (!key) {
    return null;
  }
  const expires = Math.floor(nowMs / 1000) + BUNNY_TOKEN_TTL_SECONDS;
  return { expires, token: createHash("sha256").update(bunnyEmbedTokenInput(key, videoId, expires)).digest("hex") };
}

/**
 * O video da sessao para o aluno: a gravada entra sem som, sem controles e ja no segundo atual (quem chega
 * atrasado cai no minuto certo); o replay entra com a barra e sem autoplay. Sem video da Bunny: nulo.
 */
export function roomVideoFor(context: Pick<RoomContext, "recording" | "session">, nowMs: number): StudentRoomVideo | null {
  const ref = bunnyRefOf(context.recording);
  if (!ref) {
    return null;
  }
  const token = bunnyViewToken(ref.videoId, nowMs);
  const simulated = context.session.kind !== "replay";
  const offset = simulated ? sessionOffsetMs(context.session, nowMs) : Number.NaN;
  return {
    embedUrl: bunnyEmbedUrl(ref, {
      autoplay: simulated,
      expires: token?.expires ?? null,
      muted: simulated,
      showControls: !simulated,
      startSeconds: Number.isFinite(offset) && offset > 0 ? offset / 1000 : null,
      token: token?.token ?? null
    }),
    expires: token?.expires ?? null,
    libraryId: ref.libraryId,
    provider: "bunny",
    videoId: ref.videoId
  };
}

/**
 * O contexto de uma sessao da Sala: o webinario publicado que o aluno pode ver (404 fora disso), a sessao pedida
 * (precisa ser deste webinario: 404), a gravacao e a duracao do video.
 */
export async function loadRoomContext(db: WebinarsDb, userId: string, webinarId: string, sessionId: string, now = Date.now()): Promise<RoomContext> {
  const record = await loadStudentWebinarById(db, userId, webinarId, now);
  return roomContextOf(db, record, sessionId);
}

export async function roomContextOf(db: WebinarsDb, record: StudentWebinarRecord, sessionId: string): Promise<RoomContext> {
  const session = record.sessions.find((item) => item.id === sessionId);
  if (!session) {
    throw new WebinarError(INVALID_SESSION_MESSAGE, 404);
  }
  const recordings = await listRecordingRows(db, [record.webinar.id]);
  const recording = pickRecording(recordings, session);
  return {
    durationMs: sessionDurationMs(recording?.duration_seconds, record.webinar.durationMinutes),
    recording,
    session,
    sessions: record.sessions,
    webinar: record.webinar
  };
}

/* ------------------------------------------------------------------------------------------------
 * O aceite e o nome exibido (D10)
 * ---------------------------------------------------------------------------------------------- */

export type StudentIdentity = {
  consent: ConsentRow | null;
  consented: boolean;
  displayMode: DisplayNameMode | null;
  fullName: string | null;
  nickname: string | null;
};

export function consentIsCurrent(row: ConsentRow | null): boolean {
  return Boolean(row && !row.revoked_at && row.consent_version === CHAT_CONSENT_VERSION);
}

export async function loadStudentIdentity(db: WebinarsDb, userId: string): Promise<StudentIdentity> {
  const [consent, profile] = await Promise.all([fetchConsentRow(db, userId), fetchProfile(db, userId)]);
  const consented = consentIsCurrent(consent);
  const mode = consent?.display_mode;
  return {
    consent,
    consented,
    displayMode: consented && (mode === "anonymous" || mode === "nickname" || mode === "first_name_initial") ? mode : null,
    fullName: profile?.full_name ?? null,
    nickname: consent?.nickname ?? null
  };
}

/** O nome que aparece no chat para este aluno neste webinario (docs/30 §8.5). */
export function studentDisplayName(identity: Pick<StudentIdentity, "fullName" | "nickname">, mode: DisplayNameMode, userId: string, webinarId: string): string {
  return displayNameFor({ anonymousNumber: anonymousNumber(userId, webinarId), fullName: identity.fullName, mode, nickname: identity.nickname });
}

/* ------------------------------------------------------------------------------------------------
 * GET .../session: o que a fase 2 acrescenta
 * ---------------------------------------------------------------------------------------------- */

export async function loadRoomExtras(db: WebinarsDb, context: RoomContext, userId: string, now = Date.now()): Promise<StudentRoomExtras> {
  const { durationMs, session, webinar } = context;
  const offset = sessionOffsetMs(session, now);
  const simulated = session.kind === "simulated";
  const [identity, pinnedRow, polls, presentIds] = await Promise.all([
    loadStudentIdentity(db, userId),
    fetchPinnedMessageRow(db, session.pinnedMessageId),
    listStudentPolls(db, session, userId),
    simulated ? listPresentUserIds(db, { currentBucket: presenceBucket(Math.floor((Number.isFinite(offset) ? offset : 0) / 1000)), sessionId: session.id }) : Promise.resolve([])
  ]);
  const join = session.kind === "replay" ? ({ ok: true } as const) : canJoinSimulated(session, durationMs, now);

  return {
    me: {
      consented: identity.consented,
      displayMode: identity.displayMode,
      displayName: identity.consented && identity.displayMode ? studentDisplayName(identity, identity.displayMode, userId, webinar.id) : null,
      nickname: identity.nickname
    },
    pinned: pinnedRow && pinnedRow.approved ? toStudentMessage(chatMessageFromRow(pinnedRow), userId) : null,
    polls,
    presentNow: presentIds.length,
    replaySessionId: openReplaySessionId(context.sessions),
    session: {
      chatMode: session.chatMode,
      chatSlowModeSeconds: session.chatSlowModeSeconds,
      durationMs,
      join: session.kind === "live" ? (session.status === "waiting" || session.status === "live" ? { ok: true } : { ok: false, reason: session.status === "ended" || session.status === "cancelled" ? "ended" : "not_started" }) : join,
      offsetMs: Number.isFinite(offset) ? Math.round(offset) : null,
      roomPhase: simulated ? simulatedPhase(session, durationMs, now) : null,
      showLiveBadge: session.showLiveBadge
    },
    video: roomVideoFor(context, now)
  };
}

/* ------------------------------------------------------------------------------------------------
 * Chat: a janela por offset e as mensagens novas
 * ---------------------------------------------------------------------------------------------- */

export type ChatWindowReply = { messages: StudentChatMessage[]; mode: "window"; serverTime: string; window: ChatWindow };
export type ChatRecentReply = { messages: StudentChatMessage[]; mode: "recent"; next: ChatCursor; serverTime: string };

/** A janela [from, to] em ms: a linha mestre (ja deslocada pela ancora na RPC) + as linhas da sessao. */
export async function readChatWindow(db: WebinarsDb, context: RoomContext, userId: string, window: ChatWindow, now = Date.now()): Promise<ChatWindowReply> {
  if (!isValidChatWindow(window)) {
    throw new WebinarError("Janela inválida.", 400);
  }
  const rows = await fetchChatWindow(db, { fromMs: window.fromMs, sessionId: context.session.id, toMs: window.toMs, userId });
  return {
    messages: rows.map((row) => toStudentMessage(chatMessageFromWindowRow(row, context.session.id, context.webinar.id), userId)),
    mode: "window",
    serverTime: new Date(now).toISOString(),
    window
  };
}

/** As mensagens novas da sessao depois do cursor (a consulta de 5 s), so ate agora. */
export async function readRecentChat(db: WebinarsDb, context: RoomContext, userId: string, cursor: ChatCursor | null, now = Date.now()): Promise<ChatRecentReply> {
  const nowIso = new Date(now).toISOString();
  const rows = await listRecentChatRows(db, {
    afterCreatedAt: cursor?.since ?? null,
    afterId: cursor?.after ?? null,
    sessionId: context.session.id,
    untilIso: nowIso,
    userId
  });
  return {
    messages: rows.map((row) => toStudentMessage(chatMessageFromRow(row), userId)),
    mode: "recent",
    next: nextChatCursor(rows, cursor, nowIso),
    serverTime: nowIso
  };
}

/* ------------------------------------------------------------------------------------------------
 * Perguntas, enquetes e reacoes
 * ---------------------------------------------------------------------------------------------- */

export async function listStudentQuestions(db: WebinarsDb, session: Pick<WebinarSession, "id">, userId: string, order: "recent" | "votes"): Promise<StudentQuestion[]> {
  const rows = await listQuestionRows(db, { order, sessionId: session.id, statuses: ["open", "answered", "dismissed"] });
  const voted = await listStudentVotedQuestionIds(db, { questionIds: rows.map((row) => row.id), userId });
  return rows.map((row) => toStudentQuestion(questionFromRow(row), userId, voted.has(row.id))).filter((question): question is StudentQuestion => question !== null);
}

/** As enquetes da sessao para o aluno: abertas, e encerradas com resultado compartilhado; a resposta dele junto. */
export async function listStudentPolls(db: WebinarsDb, session: Pick<WebinarSession, "id" | "webinarId">, userId: string): Promise<StudentPoll[]> {
  const { options, polls } = await listPollRows(db, { sessionId: session.id, webinarId: session.webinarId });
  const visible = polls.filter((row) => row.status === "open" || (row.status === "closed" && row.results_shared_at));
  const answers = await Promise.all(visible.map((row) => listPollAnswerRows(db, row.id)));
  return visible
    .map((row, index) => toStudentPoll(pollFromRow(row, options), answers[index].map(pollAnswerFromRow), userId))
    .filter((poll): poll is StudentPoll => poll !== null);
}

/** As contagens por reacao dos ultimos segundos (no maximo 10 s para tras). */
export async function recentReactionCounts(db: WebinarsDb, session: Pick<WebinarSession, "id">, sinceIso: string | null, now = Date.now()): Promise<{ counts: Record<Reaction, number>; serverTime: string }> {
  const floor = now - 10_000;
  const since = Math.max(floor, Number.isFinite(toTime(sinceIso)) ? toTime(sinceIso) : floor);
  const rows = await listReactionRowsSince(db, { sessionId: session.id, sinceIso: new Date(since).toISOString() });
  return { counts: countReactions(rows, REACTIONS), serverTime: new Date(now).toISOString() };
}

export { webinarsDb };
