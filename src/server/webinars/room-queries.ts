// Leituras da Sala do aluno (docs/30 §1.3, §1.6, §5.1 e §6.6): o contexto de uma sessao (webinario publicado e dentro
// do acesso, a sessao do proprio webinario, a gravacao e a duracao do video), o que GET .../session devolve a mais na
// fase 2 (relogio, fase, video da Bunny com o token do servidor, mensagem fixada, enquetes, presentes agora e o
// aceite do aluno) e na fase 3 (o bloco `live` e os banimentos do aluno; a entrada recusa o removido e o banido; desde
// a Na tela, R5, os banimentos da sessao valem tambem na Live gravada), a
// janela do chat e as mensagens novas, as perguntas, as enquetes e as reacoes recentes. Tudo pela service role e so
// o que o aluno pode ver (nunca o nome da sala, o token nem a situacao do gravador alem de LiveRoomInfo); as regras
// puras ficam em room-model.ts, room-rules.ts e live-model.ts. A "Na tela" (docs/30 §5.1): o estado (screen-queries.ts)
// vai em GET .../session sempre e na consulta de 5 s do chat so quando o carimbo do navegador ficou velho.

import "server-only";

import { createHash } from "node:crypto";
import { fetchProfile } from "../students/store";
import { loadAuthorPhotos, roomPhotoUrl } from "./author-photos";
import { personaAvatarUrl } from "./persona-model";
import { loadScriptedMessageAvatars, loadScriptedQuestionAvatars } from "./persona-store";
import {
  fetchChatWindow,
  fetchConsentRow,
  fetchPinnedMessageRow,
  listPollAnswerRows,
  listPollRows,
  listStudentPollAnswerRows,
  listQuestionLikeRows,
  listQuestionReplyRows,
  listQuestionRows,
  listReactionRowsSince,
  listRecentChatRows,
  listPresentUserIds,
  listStudentVotedQuestionIds
} from "./chat-store";
import { chatMessageFromRow, chatMessageFromWindowRow, pollAnswerFromRow, pollFromRow, questionFromRow, questionReplyFromRow, type ConsentRow } from "./chat-rows";
import { WebinarError, webinarsDb, type WebinarsDb } from "./db";
import { tallyQuestionLikes } from "./question-likes-model";
import {
  CHAT_LIMITS,
  REACTIONS,
  ROOM_RULES,
  chatConsentIsCurrent,
  toTime,
  type ChatMessage,
  type QuestionReply,
  type Poll,
  type Reaction,
  type StudentChatMessage,
  type Webinar,
  type WebinarQuestion,
  type WebinarSession
} from "./model";
import { loadStudentWebinarById, type StudentWebinarRecord } from "./registrations";
import {
  authorPhotoUrl,
  bunnyEmbedTokenInput,
  bunnyEmbedUrl,
  canJoinSimulated,
  displayNameFor,
  isScriptedQuestionMessage,
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
import {
  countReactions,
  nextChatCursor,
  pollResultCounts,
  questionVisibleAt,
  studentPollOf,
  toStudentQuestion,
  withQuestionLikes,
  toStudentReply,
  type ChatCursor,
  type StudentPoll,
  type StudentPollResults,
  type StudentQuestion,
  type StudentQuestionReply
} from "./room-rules";
import { NO_BAN, liveBanState, liveJoinRefusal, liveRoomConfigured, liveRoomInfoOf, presenceOffsetMs, type LiveBanState } from "./live-model";
import { fetchStudentBans, fetchUserBan } from "./live-store";
import { registrationFromRow, type RecordingRow } from "./rows";
import type { StudentScreenState } from "./screen-model";
import { loadScreenState, screenStateForChat, screenStorageOrigin } from "./screen-queries";
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
  /** A foto do proprio perfil (so o arquivo enviado pelo Perfil, como os outros a veem), para o campo de escrever da sala; nula sem foto. */
  avatarUrl: string | null;
  consent: ConsentRow | null;
  /** O aceite em dia: sem retirada, na versao de agora e com o modo de agora (consentIsCurrent). */
  consented: boolean;
  fullName: string | null;
};

/**
 * O aceite gravado vale agora (model.chatConsentIsCurrent): sem retirada, na versao de agora e com `display_mode`
 * "first_name_initial". Uma linha antiga com "anonymous" ou "nickname" (legado: linhas de antes de 10/11/2026, D64)
 * conta como "sem aceite".
 */
export function consentIsCurrent(row: ConsentRow | null): boolean {
  return chatConsentIsCurrent(row);
}

export async function loadStudentIdentity(db: WebinarsDb, userId: string): Promise<StudentIdentity> {
  const [consent, profile] = await Promise.all([fetchConsentRow(db, userId), fetchProfile(db, userId)]);
  return {
    avatarUrl: roomPhotoUrl(userId, profile?.avatar_url),
    consent,
    consented: consentIsCurrent(consent),
    fullName: profile?.full_name ?? null
  };
}

/**
 * O nome do aluno nos webinarios (docs/30 §8.5 e D64): sempre o primeiro nome com a inicial do sobrenome, o mesmo em
 * todo webinario. Nao depende do aceite gravado nem do card Sala.
 */
export function studentDisplayName(identity: Pick<StudentIdentity, "fullName">): string {
  return displayNameFor({ fullName: identity.fullName });
}

/* ------------------------------------------------------------------------------------------------
 * A foto de quem escreveu (docs/30 §8.5, aceite versao 2)
 * ---------------------------------------------------------------------------------------------- */

/**
 * A mensagem do aluno com a foto de quem escreveu, quando ela pode aparecer (room-model.authorPhotoUrl). `personas`: a
 * foto de quem comenta das mensagens `scripted` (R9), pelo id da mensagem, ja como endereco.
 */
export function studentMessageWithPhoto(
  message: ChatMessage,
  viewerUserId: string,
  sessionKind: WebinarSession["kind"],
  photos: ReadonlyMap<string, AuthorPhoto>,
  personas: ReadonlyMap<string, string> = new Map()
): StudentChatMessage {
  const avatarUrl = authorPhotoUrl({
    authorUserId: message.authorUserId,
    displayName: message.displayName,
    personaAvatarUrl: message.source === "scripted" ? (personas.get(message.id) ?? null) : null,
    photo: message.authorUserId ? photos.get(message.authorUserId) : null,
    source: message.source,
    viewer: "student",
    webinarId: message.webinarId
  });
  return toStudentMessage(message, viewerUserId, sessionKind, message.offsetMs, avatarUrl);
}

/**
 * A foto de quem comenta das mensagens `scripted` da pagina (R9), como endereco pela origem do nosso Supabase: uma
 * leitura pelo id so quando a pagina tem mensagem do roteiro (a foto de cada mensagem fica na memoria do processo,
 * persona-store.loadScriptedMessageAvatars). A janela do chat (webinar_chat_window) nao devolve a coluna.
 */
export async function scriptedAvatarUrls(db: WebinarsDb, messages: readonly Pick<ChatMessage, "id" | "source">[], nowMs: number): Promise<Map<string, string>> {
  const ids = messages.filter((message) => message.source === "scripted").map((message) => message.id);
  const urls = new Map<string, string>();
  if (ids.length === 0) {
    return urls;
  }
  const origin = screenStorageOrigin();
  for (const [id, path] of await loadScriptedMessageAvatars(db, ids, nowMs)) {
    const url = personaAvatarUrl(path, origin);
    if (url) {
      urls.set(id, url);
    }
  }
  return urls;
}

/**
 * As mensagens do aluno com as fotos: uma leitura (com a memoria de 60 s) para todos os autores da pagina. A mensagem do
 * item Pergunta do roteiro (D77, isScriptedQuestionMessage) nunca chega a sala: a pergunta aparece so na aba Perguntas.
 */
async function studentMessagesWithPhotos(db: WebinarsDb, all: readonly ChatMessage[], viewerUserId: string, sessionKind: WebinarSession["kind"], nowMs: number): Promise<StudentChatMessage[]> {
  const messages = all.filter((message) => !isScriptedQuestionMessage(message));
  const [photos, personas] = await Promise.all([
    loadAuthorPhotos(
      db,
      messages.map((message) => message.authorUserId),
      nowMs
    ),
    scriptedAvatarUrls(db, messages, nowMs)
  ]);
  return messages.map((message) => studentMessageWithPhoto(message, viewerUserId, sessionKind, photos, personas));
}

/* ------------------------------------------------------------------------------------------------
 * GET .../session: o que a fase 2 acrescenta
 * ---------------------------------------------------------------------------------------------- */

/**
 * Se o aluno entra na sala agora: o banido de todos os webinarios nunca (`banned`, em qualquer forma: D33); o replay
 * sempre; a live pela situacao (espera ou no ar) e nunca removido desta sessao (`kicked`, os mesmos motivos do
 * join-token); a gravada pelo relogio e nunca removido desta sessao (`kicked`, a moderacao por pessoa da Na tela, R5:
 * sem motor de video, o removido perde o video na proxima conferencia da sala); com limite de vagas, so com a vaga.
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
  if (options.ban?.kicked) {
    return { ok: false, reason: "kicked" };
  }
  if (options.seatMissing) {
    return { ok: false, reason: "no_seat" };
  }
  return canJoinSimulated(session, durationMs, now);
}

/**
 * O que a Sala recebe a mais em GET .../session. O video (com o token da Bunny) so vai dentro da entrada: antes da
 * abertura, depois do fim, depois da Entrada atrasada, sem a vaga obrigatoria ou removido desta sessao, nulo. A live
 * (fase 3) nao usa a Bunny: leva o bloco `live` (sem o nome da sala nem o token, que so saem do join-token). Os
 * banimentos do aluno vao em `me.ban` (na live e na gravada, os desta sessao tambem) e os presentes agora pelo relogio
 * da presenca (desde o inicio, presenceOffsetMs).
 */
export async function loadRoomExtras(db: WebinarsDb, context: RoomContext, userId: string, now = Date.now(), options: { seatMissing?: boolean } = {}): Promise<StudentRoomExtras> {
  const { durationMs, session, webinar } = context;
  const offset = sessionOffsetMs(session, now);
  const simulated = session.kind === "simulated";
  const live = session.kind === "live";
  const presence = presenceOffsetMs(session, now);
  const showPresentCount = webinar.roomSettings.showPresentCount;
  const [identity, pinnedRow, polls, presentIds, bans, screen] = await Promise.all([
    loadStudentIdentity(db, userId),
    fetchPinnedMessageRow(db, session.pinnedMessageId),
    listStudentPolls(db, session, userId, now),
    // Com o numero de pessoas escondido dos alunos (docs/30 D102), a contagem nem e lida.
    (simulated || live) && showPresentCount ? listPresentUserIds(db, { currentBucket: presenceBucket(Math.floor((Number.isFinite(presence) ? presence : 0) / 1000)), sessionId: session.id }) : Promise.resolve([]),
    // Remover e silenciar valem na live (fase 3) e na gravada (a Na tela, R5); o banido de todos os webinarios vale em
    // qualquer forma (D33), o Replay inclusive.
    live || simulated ? fetchStudentBans(db, { sessionId: session.id, userId }) : fetchUserBan(db, userId).then((userBan) => ({ sessionBans: [], userBan })),
    // A Na tela: o estado inteiro (o navegador sempre adota o da sessao); vazio no Replay e na sessao encerrada.
    loadScreenState(db, session, userId, now)
  ]);
  const ban = liveBanState({ nowMs: now, sessionBans: bans.sessionBans, userBan: bans.userBan });
  const join = roomJoinFor(context, now, { ...options, ban, practiceSession: webinar.roomSettings.practiceSession });
  const pinned = pinnedRow && pinnedRow.approved ? ((await studentMessagesWithPhotos(db, [chatMessageFromRow(pinnedRow)], userId, session.kind, now))[0] ?? null) : null;

  return {
    live: live ? liveRoomInfoOf(session, liveRoomConfigured(process.env), webinar.roomSettings) : null,
    // So do proprio aluno (D82): a foto do Perfil e o nome dele vao sempre, tambem antes do aceite, para o avatar ao lado
    // do campo de escrever, que so ele ve; quem a turma ve continua decidido em authorPhotoUrl (D62).
    me: {
      avatarUrl: identity.avatarUrl,
      ban,
      consented: identity.consented,
      displayName: studentDisplayName(identity)
    },
    pinned,
    polls,
    // A equipe escolheu nao mostrar aos alunos quantas pessoas estao na sala (docs/30 D102): o numero nao sai do servidor.
    presentHidden: !showPresentCount,
    presentNow: showPresentCount ? presentIds.length : 0,
    screen,
    replaySessionId: openReplaySessionId(context.sessions),
    session: {
      chatMode: session.chatMode,
      chatSlowModeSeconds: session.chatSlowModeSeconds,
      durationMs,
      join,
      offsetMs: Number.isFinite(offset) ? Math.round(offset) : null,
      roomPhase: simulated ? simulatedPhase(session, durationMs, now) : null,
      showLiveBadge: session.showLiveBadge
    },
    video: join.ok && session.kind !== "live" ? roomVideoFor(context, now) : null
  };
}

/* ------------------------------------------------------------------------------------------------
 * Chat: a janela por offset e as mensagens novas
 * ---------------------------------------------------------------------------------------------- */

export type ChatWindowReply = { messages: StudentChatMessage[]; mode: "window"; serverTime: string; window: ChatWindow };
/** `screen`: o estado da Na tela quando o carimbo que o navegador mandou (`tela`) ficou velho; nulo no resto. */
export type ChatRecentReply = { messages: StudentChatMessage[]; mode: "recent"; next: ChatCursor; screen: StudentScreenState | null; serverTime: string };

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

/**
 * As mensagens novas da sessao depois do cursor (a consulta de 5 s), so ate agora. Com `screen.stamp` (o `tela` da
 * consulta: o carimbo que o navegador tem), leva tambem o estado da Na tela quando o carimbo da sessao mudou
 * (screen-queries.screenStateForChat: igual, ausente ou no Replay, nulo e nenhuma consulta a mais).
 */
export async function readRecentChat(
  db: WebinarsDb,
  context: RoomContext,
  userId: string,
  cursor: ChatCursor | null,
  now = Date.now(),
  screen: { stamp?: string | null } = {}
): Promise<ChatRecentReply> {
  const nowIso = new Date(now).toISOString();
  const [rows, screenState] = await Promise.all([
    listRecentChatRows(db, {
      afterCreatedAt: cursor?.since ?? null,
      afterId: cursor?.after ?? null,
      sessionId: context.session.id,
      untilIso: nowIso,
      userId
    }),
    screenStateForChat(db, context.session, userId, screen.stamp, now)
  ]);
  return {
    messages: await studentMessagesWithPhotos(db, rows.map(chatMessageFromRow), userId, context.session.kind, now),
    mode: "recent",
    next: nextChatCursor(rows, cursor, nowIso),
    screen: screenState,
    serverTime: nowIso
  };
}

/* ------------------------------------------------------------------------------------------------
 * Perguntas, enquetes e reacoes
 * ---------------------------------------------------------------------------------------------- */

/**
 * A foto de quem perguntou, pela regra do aluno (nunca na Anonima nem no nome "Aluno {n}"; legado: linhas de antes de
 * 10/11/2026). A pergunta simulada (11/11/2026, D77) mostra a foto da pessoa que comenta (a copia gravada nela, ja como
 * endereco em `personas`, pelo id da pergunta), para a turma e para a equipe, como a mensagem do roteiro; sem ela, as
 * iniciais.
 */
export function questionPhotoUrl(
  question: Pick<WebinarQuestion, "anonymous" | "displayName" | "id" | "simulated" | "userId">,
  webinarId: string,
  photos: ReadonlyMap<string, AuthorPhoto>,
  viewer: "student" | "team" = "student",
  personas: ReadonlyMap<string, string> = new Map()
): string | null {
  if (question.simulated) {
    return authorPhotoUrl({ authorUserId: null, displayName: question.displayName, personaAvatarUrl: personas.get(question.id) ?? null, photo: null, source: "scripted", viewer, webinarId });
  }
  return authorPhotoUrl({
    anonymous: question.anonymous,
    authorUserId: question.userId,
    displayName: question.displayName,
    photo: question.userId ? photos.get(question.userId) : null,
    source: "audience",
    viewer,
    webinarId
  });
}

/**
 * A foto da pessoa das perguntas simuladas da lista (D77), como endereco pela origem do nosso Supabase: uma leitura pelo
 * id so quando a lista tem pergunta simulada (a foto de cada uma fica na memoria do processo, como a das mensagens).
 */
export async function scriptedQuestionAvatarUrls(db: WebinarsDb, questions: readonly Pick<WebinarQuestion, "id" | "simulated">[], nowMs: number): Promise<Map<string, string>> {
  const ids = questions.filter((question) => question.simulated).map((question) => question.id);
  const urls = new Map<string, string>();
  if (ids.length === 0) {
    return urls;
  }
  const origin = screenStorageOrigin();
  for (const [id, path] of await loadScriptedQuestionAvatars(db, ids, nowMs)) {
    const url = personaAvatarUrl(path, origin);
    if (url) {
      urls.set(id, url);
    }
  }
  return urls;
}

/** A foto de quem respondeu no fio: a da equipe sempre; a do aluno pela regra dele (nunca na pergunta Anonima; legado: linhas de antes de 10/11/2026). */
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

/** A foto de quem assinou a resposta com "Meu nome" (docs/30 D88): a da equipe aparece sempre; nas outras escolhas, nenhuma. */
export function answerAuthorPhotoUrl(question: Pick<WebinarQuestion, "answerAuthor" | "answeredBy">, webinarId: string, photos: ReadonlyMap<string, AuthorPhoto>): string | null {
  if (question.answerAuthor?.as !== "self" || !question.answeredBy) {
    return null;
  }
  return authorPhotoUrl({ authorUserId: question.answeredBy, displayName: question.answerAuthor.name ?? "", photo: photos.get(question.answeredBy), source: "team", viewer: "team", webinarId });
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
  const [rows, replyRows, likeRows] = await Promise.all([
    // O filtro no banco tambem: a simulada do futuro nunca ocupa um dos 200 lugares das perguntas de agora.
    listQuestionRows(db, { order, sessionId: session.id, statuses: ["open", "answered", "dismissed"], visibleAt: new Date(now).toISOString() }),
    listQuestionReplyRows(db, { sessionId: session.id }),
    // As curtidas da resposta e do fio (docs/30 D101); sem a 202611170001, nenhuma.
    listQuestionLikeRows(db, { sessionId: session.id })
  ]);
  const likes = tallyQuestionLikes(likeRows, userId);
  // A pergunta simulada so aparece quando a hora dela chega (D77: a da Live gravada nasce com o minuto do item).
  const questions = rows.map(questionFromRow).filter((question) => questionVisibleAt(question, now));
  const replies = replyRows.map(questionReplyFromRow);
  const [voted, photos, personas] = await Promise.all([
    listStudentVotedQuestionIds(db, { questionIds: questions.map((question) => question.id), userId }),
    loadAuthorPhotos(
      db,
      [
        ...questions.filter((question) => !question.anonymous).map((question) => question.userId),
        ...replies.filter((reply) => !reply.anonymous).map((reply) => reply.userId),
        // Quem assinou a resposta com "Meu nome" (D88): a foto da equipe.
        ...questions.filter((question) => question.answerAuthor?.as === "self").map((question) => question.answeredBy)
      ],
      now
    ),
    scriptedQuestionAvatarUrls(db, questions, now)
  ]);
  const thread = studentRepliesByQuestion(replies, userId, session.webinarId, photos);
  return questions
    .map((question) =>
      toStudentQuestion(
        question,
        userId,
        voted.has(question.id),
        questionPhotoUrl(question, session.webinarId, photos, "student", personas),
        thread.get(question.id) ?? [],
        answerAuthorPhotoUrl(question, session.webinarId, photos)
      )
    )
    .filter((question): question is StudentQuestion => question !== null)
    .map((question) => withQuestionLikes(question, likes));
}

/** Quanto as contagens de uma enquete com o resultado compartilhado valem na memoria do processo. */
export const SHARED_POLL_COUNTS_TTL_MS = 60_000;
const SHARED_POLL_COUNTS_MAX = 2_000;
const sharedPollCounts = new Map<string, { at: number; key: string; value: Promise<StudentPollResults> }>();

/** Esvazia a memoria das contagens (os testes). */
export function clearSharedPollCounts() {
  sharedPollCounts.clear();
}

/**
 * As contagens de uma enquete com o resultado compartilhado: lidas uma vez (todas as respostas) e guardadas 60 s por
 * enquete, com a chave da situacao e da hora do compartilhar (encerrar ou compartilhar de novo rele). 1.000 alunos
 * pedindo a lista custam uma leitura das respostas por processo, nao uma por aluno.
 */
async function sharedPollResults(db: WebinarsDb, poll: Poll, nowMs: number): Promise<StudentPollResults> {
  const key = `${poll.status}:${poll.resultsSharedAt ?? ""}`;
  const hit = sharedPollCounts.get(poll.id);
  if (hit && hit.key === key && nowMs - hit.at < SHARED_POLL_COUNTS_TTL_MS) {
    return hit.value;
  }
  const value = listPollAnswerRows(db, poll.id).then((rows) => pollResultCounts(poll, rows.map(pollAnswerFromRow)));
  sharedPollCounts.delete(poll.id);
  if (sharedPollCounts.size >= SHARED_POLL_COUNTS_MAX) {
    sharedPollCounts.clear();
  }
  sharedPollCounts.set(poll.id, { at: nowMs, key, value });
  value.catch(() => {
    if (sharedPollCounts.get(poll.id)?.value === value) {
      sharedPollCounts.delete(poll.id);
    }
  });
  return value;
}

/**
 * As enquetes da sessao para o aluno: abertas, e encerradas com resultado compartilhado; a resposta dele junto. Le so
 * as respostas do proprio aluno (uma consulta para todas as enquetes) e, nas de resultado compartilhado, as contagens
 * guardadas (sharedPollResults): nunca as respostas dos outros numa enquete aberta.
 */
export async function listStudentPolls(db: WebinarsDb, session: Pick<WebinarSession, "id" | "webinarId">, userId: string, now = Date.now()): Promise<StudentPoll[]> {
  const { options, polls } = await listPollRows(db, { sessionId: session.id, webinarId: session.webinarId });
  const visible = polls.filter((row) => row.status === "open" || (row.status === "closed" && row.results_shared_at)).map((row) => pollFromRow(row, options));
  if (visible.length === 0) {
    return [];
  }
  const [mine, results] = await Promise.all([
    listStudentPollAnswerRows(db, { sessionId: session.id, userId }),
    Promise.all(visible.map((poll) => (poll.resultsSharedAt ? sharedPollResults(db, poll, now) : Promise.resolve(null))))
  ]);
  const mineByPoll = new Map(mine.map((row) => [row.poll_id, pollAnswerFromRow(row)]));
  return visible.map((poll, index) => studentPollOf(poll, mineByPoll.get(poll.id) ?? null, results[index])).filter((poll): poll is StudentPoll => poll !== null);
}

/** As contagens por reacao dos ultimos segundos (no maximo 10 s para tras). */
export async function recentReactionCounts(db: WebinarsDb, session: Pick<WebinarSession, "id">, sinceIso: string | null, now = Date.now()): Promise<{ counts: Record<Reaction, number>; serverTime: string }> {
  const floor = now - 10_000;
  const since = Math.max(floor, Number.isFinite(toTime(sinceIso)) ? toTime(sinceIso) : floor);
  const rows = await listReactionRowsSince(db, { sessionId: session.id, sinceIso: new Date(since).toISOString() });
  return { counts: countReactions(rows, REACTIONS), serverTime: new Date(now).toISOString() };
}

export { webinarsDb };
