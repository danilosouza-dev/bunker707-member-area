// Leituras da Sala do aluno (docs/30 §1.3, §1.6, §5.1 e §6.6): o contexto de uma sessao (webinario publicado e dentro
// do acesso, a sessao do proprio webinario, a gravacao e a duracao do video), o que GET .../session devolve a mais na
// fase 2 (relogio, fase, video da Bunny com o token do servidor, mensagem fixada, enquetes, presentes agora e o
// aceite do aluno) e na fase 3 (o bloco `live` e os banimentos do aluno; a entrada recusa o removido e o banido), a
// janela do chat e as mensagens novas, as perguntas, as enquetes e as reacoes recentes. Tudo pela service role e so
// o que o aluno pode ver (nunca o nome da sala, o token nem a situacao do gravador alem de LiveRoomInfo); as regras
// puras ficam em room-model.ts, room-rules.ts e live-model.ts.

import "server-only";

import { createHash } from "node:crypto";
import { sanitizeProfileAvatarUrl } from "../member-area/student-pages-model";
import { fetchProfile } from "../students/store";
import { loadAuthorPhotos } from "./author-photos";
import {
  fetchChatWindow,
  fetchConsentRow,
  fetchPinnedMessageRow,
  listPollAnswerRows,
  listPollRows,
  listQuestionReplyRows,
  listQuestionRows,
  listReactionRowsSince,
  listRecentChatRows,
  listPresentUserIds,
  listStudentVotedQuestionIds
} from "./chat-store";
import { chatMessageFromRow, chatMessageFromWindowRow, pollAnswerFromRow, pollFromRow, questionFromRow, questionReplyFromRow, type ConsentRow } from "./chat-rows";
import { WebinarError, webinarsDb, type WebinarsDb } from "./db";
import {
  CHAT_CONSENT_VERSION,
  CHAT_LIMITS,
  REACTIONS,
  ROOM_RULES,
  toTime,
  type ChatMessage,
  type DisplayNameMode,
  type QuestionReply,
  type Reaction,
  type StudentChatMessage,
  type Webinar,
  type WebinarQuestion,
  type WebinarSession
} from "./model";
import { loadStudentWebinarById, type StudentWebinarRecord } from "./registrations";
import {
  anonymousNumber,
  authorPhotoUrl,
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
  type AuthorPhoto,
  type ChatWindow
} from "./room-model";
import { countReactions, nextChatCursor, toStudentPoll, toStudentQuestion, toStudentReply, type ChatCursor, type StudentPoll, type StudentQuestion, type StudentQuestionReply } from "./room-rules";
import { NO_BAN, liveBanState, liveJoinRefusal, liveRoomConfigured, liveRoomInfoOf, presenceOffsetMs, type LiveBanState } from "./live-model";
import { fetchStudentBans, fetchUserBan } from "./live-store";
import { registrationFromRow, type RecordingRow } from "./rows";
import { fetchRegistrationRows, listRecordingRows } from "./store";
import { openReplaySessionId, registrationFor, seatRequired, type RoomJoin, type StudentRoomExtras, type StudentRoomVideo } from "./student-model";
import { WEBINAR_COPY } from "../../lib/webinar-copy";

export const INVALID_SESSION_MESSAGE = "Sessão inválida.";

/** Quanto o token de visualizacao da Bunny vale no maximo (docs/30 §5.1: `expires`), em segundos. */
export const BUNNY_TOKEN_TTL_SECONDS = 6 * 60 * 60;

/** Na gravada, o token vale ate o fim do video e mais esta folga (quem entrou tarde ainda termina de ver). */
export const BUNNY_TOKEN_GRACE_SECONDS = 15 * 60;

/** Quanto a janela do chat da gravada passa do segundo do servidor (o aparelho pode estar um pouco adiantado). */
export const CHAT_WINDOW_SLACK_MS = 10_000;

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
export function bunnyViewToken(
  videoId: string,
  nowMs: number,
  tokenKey: string | undefined = process.env.BUNNY_EMBED_TOKEN_KEY,
  ttlSeconds: number = BUNNY_TOKEN_TTL_SECONDS
): { expires: number; token: string } | null {
  const key = tokenKey?.trim();
  if (!key) {
    return null;
  }
  const expires = Math.floor(nowMs / 1000) + Math.max(60, Math.min(BUNNY_TOKEN_TTL_SECONDS, Math.ceil(ttlSeconds)));
  return { expires, token: createHash("sha256").update(bunnyEmbedTokenInput(key, videoId, expires)).digest("hex") };
}

/**
 * O video da sessao para o aluno: a gravada entra sem som, sem controles e ja no segundo atual (quem chega
 * atrasado cai no minuto certo), com o token valendo ate o fim do video e a folga; o replay entra com a barra e sem
 * autoplay. Sem video da Bunny: nulo. Quem decide se o aluno recebe o video e loadRoomExtras (so dentro da entrada).
 */
export function roomVideoFor(context: Pick<RoomContext, "durationMs" | "recording" | "session">, nowMs: number): StudentRoomVideo | null {
  const ref = bunnyRefOf(context.recording);
  if (!ref) {
    return null;
  }
  const simulated = context.session.kind !== "replay";
  const offset = simulated ? sessionOffsetMs(context.session, nowMs) : Number.NaN;
  const ttlSeconds = simulated && Number.isFinite(offset) ? (context.durationMs - offset) / 1000 + BUNNY_TOKEN_GRACE_SECONDS : BUNNY_TOKEN_TTL_SECONDS;
  const token = bunnyViewToken(ref.videoId, nowMs, undefined, ttlSeconds);
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

/** A vaga do aluno nesta sessao (a da sessao ou a geral do webinario), quando a sala so abre para quem garantiu. */
export async function hasRoomSeat(db: WebinarsDb, userId: string, context: Pick<RoomContext, "session" | "webinar">): Promise<boolean> {
  const rows = await fetchRegistrationRows(db, { userId, webinarIds: [context.webinar.id] });
  return registrationFor(rows.map(registrationFromRow), context.session.id) !== null;
}

/**
 * O contexto de uma sessao da Sala para as rotas: o webinario publicado que o aluno pode ver (404 fora disso), a
 * sessao pedida (precisa ser deste webinario: 404; o replay cancelado tambem), a gravacao e a duracao do video. Com
 * limite de vagas, so quem garantiu a vaga entra (A12): sem ela, 403.
 */
export async function loadRoomContext(db: WebinarsDb, userId: string, webinarId: string, sessionId: string, now = Date.now()): Promise<RoomContext> {
  const record = await loadStudentWebinarById(db, userId, webinarId, now);
  const context = await roomContextOf(db, record, sessionId);
  if (seatRequired(context.webinar, context.session) && !(await hasRoomSeat(db, userId, context))) {
    throw new WebinarError(WEBINAR_COPY.sala.vagaObrigatoria, 403);
  }
  return context;
}

export async function roomContextOf(db: WebinarsDb, record: StudentWebinarRecord, sessionId: string): Promise<RoomContext> {
  const session = record.sessions.find((item) => item.id === sessionId);
  // O replay que a equipe tirou do ar some para o aluno (Cancelar replay no console).
  if (!session || (session.kind === "replay" && session.status === "cancelled")) {
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
  /** A foto do proprio perfil (so https), para o campo de escrever da sala; nula sem foto. */
  avatarUrl: string | null;
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
    avatarUrl: sanitizeProfileAvatarUrl(profile?.avatar_url),
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
 * A foto de quem escreveu (docs/30 §8.5, aceite versao 2)
 * ---------------------------------------------------------------------------------------------- */

/** A mensagem do aluno com a foto de quem escreveu, quando ela pode aparecer (room-model.authorPhotoUrl). */
export function studentMessageWithPhoto(message: ChatMessage, viewerUserId: string, sessionKind: WebinarSession["kind"], photos: ReadonlyMap<string, AuthorPhoto>): StudentChatMessage {
  const avatarUrl = authorPhotoUrl({
    authorUserId: message.authorUserId,
    displayName: message.displayName,
    photo: message.authorUserId ? photos.get(message.authorUserId) : null,
    source: message.source,
    viewer: "student",
    webinarId: message.webinarId
  });
  return toStudentMessage(message, viewerUserId, sessionKind, message.offsetMs, avatarUrl);
}

/** As mensagens do aluno com as fotos: uma leitura (com a memoria de 60 s) para todos os autores da pagina. */
async function studentMessagesWithPhotos(db: WebinarsDb, messages: readonly ChatMessage[], viewerUserId: string, sessionKind: WebinarSession["kind"], nowMs: number): Promise<StudentChatMessage[]> {
  const photos = await loadAuthorPhotos(
    db,
    messages.map((message) => message.authorUserId),
    nowMs
  );
  return messages.map((message) => studentMessageWithPhoto(message, viewerUserId, sessionKind, photos));
}

/* ------------------------------------------------------------------------------------------------
 * GET .../session: o que a fase 2 acrescenta
 * ---------------------------------------------------------------------------------------------- */

/**
 * Se o aluno entra na sala agora: o banido de todos os webinarios nunca (`banned`, em qualquer forma: D33); o replay
 * sempre; a live pela situacao (espera ou no ar) e nunca removido desta sessao (`kicked`, os mesmos motivos do
 * join-token); a gravada pelo relogio; com limite de vagas, so com a vaga.
 */
export function roomJoinFor(context: Pick<RoomContext, "durationMs" | "session">, now: number, options: { ban?: LiveBanState; practiceSession?: boolean; seatMissing?: boolean } = {}): RoomJoin {
  const { durationMs, session } = context;
  if (options.ban?.banned) {
    return { ok: false, reason: "banned" };
  }
  if (session.kind === "replay") {
    return { ok: true };
  }
  if (session.kind === "live") {
    const refusal = liveJoinRefusal({ ban: options.ban ?? NO_BAN, practiceSession: options.practiceSession, role: "student", session });
    if (refusal === "ended" || refusal === "banned" || refusal === "kicked") {
      return { ok: false, reason: refusal };
    }
    if (options.seatMissing) {
      return { ok: false, reason: "no_seat" };
    }
    return refusal ? { ok: false, reason: "not_started" } : { ok: true };
  }
  if (options.seatMissing) {
    return { ok: false, reason: "no_seat" };
  }
  return canJoinSimulated(session, durationMs, now);
}

/**
 * O que a Sala recebe a mais em GET .../session. O video (com o token da Bunny) so vai dentro da entrada: antes da
 * abertura, depois do fim, depois da Entrada atrasada ou sem a vaga obrigatoria, nulo. A live (fase 3) nao usa a Bunny:
 * leva o bloco `live` (sem o nome da sala nem o token, que so saem do join-token), os banimentos do aluno em `me.ban`
 * e os presentes agora pelo relogio da presenca (desde o inicio, presenceOffsetMs).
 */
export async function loadRoomExtras(db: WebinarsDb, context: RoomContext, userId: string, now = Date.now(), options: { seatMissing?: boolean } = {}): Promise<StudentRoomExtras> {
  const { durationMs, session, webinar } = context;
  const offset = sessionOffsetMs(session, now);
  const simulated = session.kind === "simulated";
  const live = session.kind === "live";
  const presence = presenceOffsetMs(session, now);
  const [identity, pinnedRow, polls, presentIds, bans] = await Promise.all([
    loadStudentIdentity(db, userId),
    fetchPinnedMessageRow(db, session.pinnedMessageId),
    listStudentPolls(db, session, userId),
    simulated || live ? listPresentUserIds(db, { currentBucket: presenceBucket(Math.floor((Number.isFinite(presence) ? presence : 0) / 1000)), sessionId: session.id }) : Promise.resolve([]),
    // Fase 3: remover e silenciar so existem na live; o banido de todos os webinarios vale em qualquer forma (D33).
    live ? fetchStudentBans(db, { sessionId: session.id, userId }) : fetchUserBan(db, userId).then((userBan) => ({ sessionBans: [], userBan }))
  ]);
  const ban = liveBanState({ nowMs: now, sessionBans: bans.sessionBans, userBan: bans.userBan });
  const join = roomJoinFor(context, now, { ...options, ban, practiceSession: webinar.roomSettings.practiceSession });
  const pinned = pinnedRow && pinnedRow.approved ? (await studentMessagesWithPhotos(db, [chatMessageFromRow(pinnedRow)], userId, session.kind, now))[0] : null;

  return {
    live: live ? liveRoomInfoOf(session, liveRoomConfigured(process.env), webinar.roomSettings) : null,
    me: {
      avatarUrl: identity.avatarUrl,
      ban,
      consented: identity.consented,
      displayMode: identity.displayMode,
      displayName: identity.consented && identity.displayMode ? studentDisplayName(identity, identity.displayMode, userId, webinar.id) : null,
      nickname: identity.nickname
    },
    pinned,
    polls,
    presentNow: presentIds.length,
    replaySessionId: openReplaySessionId(context.sessions),
    session: {
      chatMode: session.chatMode,
      chatSlowModeSeconds: session.chatSlowModeSeconds,
      durationMs,
      join,
      offsetMs: Number.isFinite(offset) ? Math.round(offset) : null,
      roomPhase: simulated ? simulatedPhase(session, durationMs, now) : null,
      anonymousQuestions: webinar.roomSettings.anonymousQuestions,
      showLiveBadge: session.showLiveBadge
    },
    video: join.ok && session.kind !== "live" ? roomVideoFor(context, now) : null
  };
}

/* ------------------------------------------------------------------------------------------------
 * Chat: a janela por offset e as mensagens novas
 * ---------------------------------------------------------------------------------------------- */

export type ChatWindowReply = { messages: StudentChatMessage[]; mode: "window"; serverTime: string; window: ChatWindow };
export type ChatRecentReply = { messages: StudentChatMessage[]; mode: "recent"; next: ChatCursor; serverTime: string };

/**
 * Ate onde a janela pode ir: no replay, ate onde o aluno pedir (ele mesmo pula pelo video); na gravada e na live,
 * no maximo a janela a frente do segundo do servidor (o chat original de depois de agora nunca sai antes da hora).
 */
export function chatWindowLimitMs(session: Pick<WebinarSession, "kind" | "recordingAnchorAt" | "scheduledAt" | "startedAt">, now: number): number {
  if (session.kind === "replay") {
    return CHAT_LIMITS.offsetMaxMs;
  }
  const offset = sessionOffsetMs(session, now);
  return Number.isFinite(offset) ? Math.floor(offset) + ROOM_RULES.chatWindowSeconds * 1000 + CHAT_WINDOW_SLACK_MS : CHAT_LIMITS.offsetMinMs - 1;
}

/**
 * A janela [from, to] em ms: a linha mestre (ja deslocada pela ancora na RPC) + as linhas da sessao. Na gravada o
 * fim e cortado em chatWindowLimitMs e a resposta traz a janela de verdade (a seguinte comeca dali, sem pular linha);
 * pedida toda depois do limite, volta vazia com `toMs = fromMs - 1`.
 */
export async function readChatWindow(db: WebinarsDb, context: RoomContext, userId: string, window: ChatWindow, now = Date.now()): Promise<ChatWindowReply> {
  if (!isValidChatWindow(window)) {
    throw new WebinarError("Janela inválida.", 400);
  }
  const serverTime = new Date(now).toISOString();
  const limit = chatWindowLimitMs(context.session, now);
  if (window.fromMs > limit) {
    return { messages: [], mode: "window", serverTime, window: { fromMs: window.fromMs, toMs: window.fromMs - 1 } };
  }
  const served: ChatWindow = { fromMs: window.fromMs, toMs: Math.min(window.toMs, limit) };
  const rows = await fetchChatWindow(db, { fromMs: served.fromMs, sessionId: context.session.id, toMs: served.toMs, userId });
  return {
    messages: await studentMessagesWithPhotos(
      db,
      rows.map((row) => chatMessageFromWindowRow(row, context.session.id, context.webinar.id)),
      userId,
      context.session.kind,
      now
    ),
    mode: "window",
    serverTime,
    window: served
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
    messages: await studentMessagesWithPhotos(db, rows.map(chatMessageFromRow), userId, context.session.kind, now),
    mode: "recent",
    next: nextChatCursor(rows, cursor, nowIso),
    serverTime: nowIso
  };
}

/* ------------------------------------------------------------------------------------------------
 * Perguntas, enquetes e reacoes
 * ---------------------------------------------------------------------------------------------- */

/** A foto de quem perguntou, pela regra do aluno (nunca na Anonima nem no nome "Aluno {n}"). */
export function questionPhotoUrl(question: Pick<WebinarQuestion, "anonymous" | "displayName" | "userId">, webinarId: string, photos: ReadonlyMap<string, AuthorPhoto>, viewer: "student" | "team" = "student"): string | null {
  return authorPhotoUrl({ anonymous: question.anonymous, authorUserId: question.userId, displayName: question.displayName, photo: photos.get(question.userId), source: "audience", viewer, webinarId });
}

/** A foto de quem respondeu no fio: a da equipe sempre; a do aluno pela regra dele (nunca na pergunta Anonima). */
export function replyPhotoUrl(reply: Pick<QuestionReply, "anonymous" | "displayName" | "role" | "userId">, webinarId: string, photos: ReadonlyMap<string, AuthorPhoto>, viewer: "student" | "team" = "student"): string | null {
  return authorPhotoUrl({
    anonymous: reply.anonymous,
    authorUserId: reply.userId,
    displayName: reply.displayName,
    photo: photos.get(reply.userId),
    source: reply.role === "student" ? "audience" : "team",
    viewer,
    webinarId
  });
}

/** O fio de cada pergunta da sessao (id da pergunta -> as respostas em ordem), como o aluno recebe. */
export function studentRepliesByQuestion(replies: readonly QuestionReply[], userId: string, webinarId: string, photos: ReadonlyMap<string, AuthorPhoto>): Map<string, StudentQuestionReply[]> {
  const byQuestion = new Map<string, StudentQuestionReply[]>();
  for (const reply of replies) {
    const list = byQuestion.get(reply.questionId) ?? [];
    list.push(toStudentReply(reply, userId, replyPhotoUrl(reply, webinarId, photos)));
    byQuestion.set(reply.questionId, list);
  }
  return byQuestion;
}

export async function listStudentQuestions(db: WebinarsDb, session: Pick<WebinarSession, "id" | "webinarId">, userId: string, order: "recent" | "votes", now = Date.now()): Promise<StudentQuestion[]> {
  const [rows, replyRows] = await Promise.all([
    listQuestionRows(db, { order, sessionId: session.id, statuses: ["open", "answered", "dismissed"] }),
    listQuestionReplyRows(db, { sessionId: session.id })
  ]);
  const questions = rows.map(questionFromRow);
  const replies = replyRows.map(questionReplyFromRow);
  const [voted, photos] = await Promise.all([
    listStudentVotedQuestionIds(db, { questionIds: rows.map((row) => row.id), userId }),
    loadAuthorPhotos(db, [...questions.filter((question) => !question.anonymous).map((question) => question.userId), ...replies.filter((reply) => !reply.anonymous).map((reply) => reply.userId)], now)
  ]);
  const thread = studentRepliesByQuestion(replies, userId, session.webinarId, photos);
  return questions
    .map((question) => toStudentQuestion(question, userId, voted.has(question.id), questionPhotoUrl(question, session.webinarId, photos), thread.get(question.id) ?? []))
    .filter((question): question is StudentQuestion => question !== null);
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
