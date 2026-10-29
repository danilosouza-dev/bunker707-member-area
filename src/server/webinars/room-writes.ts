// Escritas do aluno na Sala (docs/30 §1.6, §4.7, §5.1, §8.3 e §8.5): a mensagem do chat (com o aceite na primeira,
// o nome exibido, a rajada, o modo lento, as palavras bloqueadas e a moderacao), "Remover minhas mensagens", o sinal
// de presenca, a reacao, a pergunta e o voto, a resposta da enquete. Toda escrita passa pelo servidor com a service
// role; o offset gravado e o do relogio do servidor na gravada (nunca o do navegador) e a posicao do player no
// replay. Cada funcao devolve o que a rota responde e os registros do historico (so ids e numeros, nunca o texto)
// que a rota grava depois da resposta. Fora da hora ou do modo: RoomRefusedError (409 { reason }); limites: 429.

import "server-only";

import { containsBlockedTerm, sanitizeLessonCommentBody } from "../comments/comment-validation";
import type { StudentEventInsert } from "../students/store";
import {
  countStudentPresenceRows,
  countStudentReactionsSince,
  fetchLastPresenceRow,
  fetchPollRow,
  fetchQuestionRow,
  insertChatMessage,
  insertPollAnswerRow,
  insertQuestionRow,
  insertReactionRow,
  listPresentUserIds,
  recordPresenceSample,
  revokeConsentRow,
  softDeleteStudentContent,
  toggleQuestionVote,
  upsertConsentRow
} from "./chat-store";
import { chatMessageFromRow, pollAnswerFromRow, pollFromRow, questionFromRow, type ChatMessageRow } from "./chat-rows";
import { CHAT_MESSAGES, type ChatPostInput, type HeartbeatInput, type QuestionPostInput } from "./chat-schemas";
import { assertNoDbError, WebinarError, type WebinarsDb } from "./db";
import { CHAT_CONSENT_VERSION, ROOM_RULES, toTime, type DisplayNameMode, type Reaction, type StudentChatMessage, type Webinar } from "./model";
import { presenceBucket, sessionOffsetMs, simulatedPhase, toStudentMessage } from "./room-model";
import { reserveChatSlot, takeChatBurst, takeQuestionBurst, takeReaction } from "./room-limits";
import {
  chatSentMetadata,
  consentMetadata,
  consentRevokedMetadata,
  deviceOf,
  pollAnswerProblem,
  pollAnsweredMetadata,
  postingRefusal,
  questionSentMetadata,
  reactionSentMetadata,
  toStudentPoll,
  toStudentQuestion,
  writeOffsetMs,
  type PostingRefusal,
  type StudentPoll,
  type StudentQuestion
} from "./room-rules";
import { consentIsCurrent, loadStudentIdentity, studentDisplayName, type RoomContext, type StudentIdentity } from "./room-queries";
import { WEBINAR_COPY } from "../../lib/webinar-copy";

export type RoomRefusal = PostingRefusal | "consent_required" | "late" | "poll_closed";

const REFUSAL_MESSAGES: Record<RoomRefusal, string> = {
  chat_off: WEBINAR_COPY.sala.chatDesligado,
  consent_required: CHAT_MESSAGES.consent,
  ended: WEBINAR_COPY.sala.encerrada,
  late: WEBINAR_COPY.sala.entradaAtrasada,
  not_started: WEBINAR_COPY.sala.naoComecou,
  poll_closed: WEBINAR_COPY.sala.enquete.encerrada,
  team_only: WEBINAR_COPY.sala.chatSoEquipe
};

/** A escrita nao cabe agora (409 { reason }). */
export class RoomRefusedError extends WebinarError {
  reason: RoomRefusal;

  constructor(reason: RoomRefusal, message = REFUSAL_MESSAGES[reason]) {
    super(message, 409);
    this.name = "RoomRefusedError";
    this.reason = reason;
  }
}

/** Passou de um limite da sala (429 com Retry-After). */
export class RoomLimitError extends WebinarError {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message, 429);
    this.name = "RoomLimitError";
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export const ROOM_LIMIT_MESSAGE = "Muitas tentativas. Espere um pouco.";

function webinarEvent(userId: string, sessionId: string | null, eventType: string, metadata: Record<string, unknown>): StudentEventInsert {
  return { entity_id: sessionId, entity_type: "webinar", event_type: eventType, metadata, user_id: userId };
}

function refuse(context: RoomContext, now: number, kind: "chat" | "interaction") {
  const refusal = postingRefusal(context.session, context.durationMs, now, kind);
  if (refusal) {
    throw new RoomRefusedError(refusal);
  }
}

/* ------------------------------------------------------------------------------------------------
 * O aceite (D10): a primeira mensagem ou a primeira pergunta traz o aceite; sem ele, nada com o nome do aluno
 * ---------------------------------------------------------------------------------------------- */

type ConsentFields = Pick<ChatPostInput, "anonymous" | "consent" | "consentVersion" | "displayMode" | "nickname">;
type ConsentChoice = { mode: DisplayNameMode; nickname: string | null; save: boolean };

/**
 * Como o aluno aparece: com o aceite valido, a escolha gravada; sem ele, o corpo precisa trazer o aceite (consent +
 * versao: 409 consent_required) e a escolha de agora, que `saveConsent` grava. Puro (sem banco): a rota confere
 * antes de reservar os limites.
 */
function consentChoice(identity: StudentIdentity, body: ConsentFields, webinar: Pick<Webinar, "roomSettings">): ConsentChoice {
  if (consentIsCurrent(identity.consent)) {
    return { mode: identity.displayMode ?? webinar.roomSettings.displayName, nickname: identity.nickname, save: false };
  }
  if (body.consent !== true || body.consentVersion !== CHAT_CONSENT_VERSION) {
    throw new RoomRefusedError("consent_required");
  }
  const mode: DisplayNameMode = body.anonymous ? "anonymous" : (body.displayMode ?? webinar.roomSettings.displayName);
  const nickname = mode === "nickname" ? (body.nickname ?? null) : null;
  if (mode === "nickname" && !nickname) {
    throw new WebinarError(CHAT_MESSAGES.nickname, 400);
  }
  return { mode, nickname, save: true };
}

async function saveConsent(input: { choice: ConsentChoice; db: WebinarsDb; events: StudentEventInsert[]; now: number; sessionId: string; userId: string }) {
  const { choice, userId } = input;
  if (!choice.save) {
    return;
  }
  await upsertConsentRow(input.db, { consent_version: CHAT_CONSENT_VERSION, display_mode: choice.mode, nickname: choice.nickname, user_id: userId }, new Date(input.now).toISOString());
  input.events.push(webinarEvent(userId, input.sessionId, "webinar_chat_consented", consentMetadata({ consentVersion: CHAT_CONSENT_VERSION, display: choice.mode })));
}

/* ------------------------------------------------------------------------------------------------
 * Chat
 * ---------------------------------------------------------------------------------------------- */

export type PostChatInput = { body: ChatPostInput & { offsetMs?: number | null }; context: RoomContext; db: WebinarsDb; now?: number; userId: string };
export type PostChatResult = { events: StudentEventInsert[]; message: StudentChatMessage; pending: boolean };

async function blockedTermIn(db: WebinarsDb, body: string): Promise<string | null> {
  const { data, error } = await db.from("lesson_comment_blocked_words").select("message,word").eq("active", true);
  assertNoDbError(error, "Webinarios: palavras bloqueadas");
  const rule = ((data ?? []) as { message: string | null; word: string }[]).find((item) => containsBlockedTerm(body, item.word));
  return rule ? rule.message || "Revise a mensagem antes de enviar." : null;
}

/**
 * A mensagem do aluno (docs/30 §5.1): fora da hora ou do modo 409; na primeira vez exige o aceite (consent +
 * versao) e grava webinar_chat_consented; o nome exibido sai da escolha do aluno; modo lento e rajada 5/60 s 429,
 * conferidos e reservados juntos antes de qualquer await (o modo lento volta se a mensagem nao for gravada);
 * palavra bloqueada 422; chat moderado grava approved = false e devolve pending; `kind: "question"` tambem abre a
 * pergunta na aba Perguntas, ligada por message_id (no chat moderado, so quando a equipe libera: moderateMessage).
 */
export async function postStudentChat(input: PostChatInput): Promise<PostChatResult> {
  const { body, context, db, userId } = input;
  const now = input.now ?? Date.now();
  const { session, webinar } = context;
  const events: StudentEventInsert[] = [];

  refuse(context, now, "chat");

  const identity = await loadStudentIdentity(db, userId);
  const choice = consentChoice(identity, body, webinar);
  await saveConsent({ choice, db, events, now, sessionId: session.id, userId });
  const mode: DisplayNameMode = body.anonymous ? "anonymous" : choice.mode;

  const slot = reserveChatSlot(userId, session.id, session.chatSlowModeSeconds, now);
  if (!slot.ok) {
    throw new RoomLimitError(WEBINAR_COPY.sala.modoLento(slot.waitSeconds), slot.waitSeconds);
  }
  const burst = takeChatBurst(userId, session.id, now);
  if (!burst.ok) {
    slot.release();
    throw new RoomLimitError(ROOM_LIMIT_MESSAGE, burst.retryAfterSeconds);
  }

  const text = sanitizeLessonCommentBody(body.body);
  const displayName = studentDisplayName({ fullName: identity.fullName, nickname: choice.nickname }, mode, userId, webinar.id);
  const offsetMs = writeOffsetMs(session, now, body.offsetMs);
  const approved = session.chatMode !== "moderated";
  let row: ChatMessageRow;
  try {
    if (!text) {
      throw new WebinarError(CHAT_MESSAGES.body, 400);
    }
    const blocked = await blockedTermIn(db, text);
    if (blocked) {
      throw new WebinarError(blocked, 422);
    }
    row = await insertChatMessage(db, {
      approved,
      author_user_id: userId,
      body: text,
      display_name: displayName,
      kind: body.kind,
      master: false,
      offset_ms: offsetMs,
      reply_to_id: body.replyToId ?? null,
      role: "student",
      session_id: session.id,
      source: "audience",
      webinar_id: webinar.id
    });
  } catch (error) {
    slot.release();
    throw error;
  }
  events.push(webinarEvent(userId, session.id, "webinar_chat_sent", chatSentMetadata({ kind: body.kind, length: text.length, messageId: row.id, offsetMs })));

  // A pergunta pendente nao vai para a aba Perguntas (la todo mundo ve): entra quando a equipe libera.
  if (body.kind === "question" && approved) {
    const question = await insertQuestionRow(db, {
      anonymous: mode === "anonymous",
      body: text.slice(0, 500),
      display_name: displayName,
      message_id: row.id,
      offset_ms: offsetMs,
      session_id: session.id,
      user_id: userId
    });
    events.push(webinarEvent(userId, session.id, "webinar_question_sent", questionSentMetadata({ anonymous: mode === "anonymous", offsetMs, questionId: question.id })));
  }

  return { events, message: toStudentMessage(chatMessageFromRow(row), userId), pending: !approved };
}

export type RemoveChatResult = { events: StudentEventInsert[]; removed: number };

/** "Remover minhas mensagens" (D10): apaga (soft) o que o aluno escreveu em todas as sessoes e retira o aceite. */
export async function removeStudentChat(input: { db: WebinarsDb; now?: number; userId: string }): Promise<RemoveChatResult> {
  const now = input.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const counts = await softDeleteStudentContent(input.db, { nowIso, reason: "consent_revoked", userId: input.userId });
  await revokeConsentRow(input.db, input.userId, nowIso);
  return {
    events: [webinarEvent(input.userId, null, "webinar_chat_consented", consentRevokedMetadata(CHAT_CONSENT_VERSION))],
    removed: counts.answers + counts.messages + counts.questions
  };
}

/* ------------------------------------------------------------------------------------------------
 * Presenca
 * ---------------------------------------------------------------------------------------------- */

export type HeartbeatContext = Pick<RoomContext, "durationMs" | "session"> & { recordingId: string | null };
export type HeartbeatResult = { ended: boolean; events: StudentEventInsert[]; offsetMs: number | null; presentNow: number; serverTime: string };

/**
 * O sinal de 15 s (docs/30 §5.1, §9 e D19): o balde de 30 s pelo offset do servidor (gravada) ou do player (replay);
 * o primeiro sinal depois de 90 s sem sinal grava webinar_joined (e webinar_replay_started no primeiro do replay);
 * `leave` grava webinar_left com os segundos presentes. Fora dos limites de escrita.
 */
export async function recordStudentHeartbeat(input: { body: HeartbeatInput; context: HeartbeatContext; db: WebinarsDb; now?: number; userAgent?: string | null; userId: string }): Promise<HeartbeatResult> {
  const { body, context, db, userId } = input;
  const now = input.now ?? Date.now();
  const nowIso = new Date(now).toISOString();
  const { session } = context;
  const serverOffset = sessionOffsetMs(session, now);
  const offsetSeconds = Number.isFinite(serverOffset) ? Math.floor(serverOffset / 1000) : body.offsetSeconds;
  const bucket = Math.max(-2880, Math.min(5760, presenceBucket(offsetSeconds)));
  const events: StudentEventInsert[] = [];

  const last = await fetchLastPresenceRow(db, { sessionId: session.id, userId });
  const gapMs = last ? now - toTime(last.last_at) : Number.POSITIVE_INFINITY;
  const joined = !Number.isFinite(gapMs) || gapMs > ROOM_RULES.leaveAfterBuckets * ROOM_RULES.bucketSeconds * 1000;

  await recordPresenceSample(db, {
    bucket,
    nowIso,
    offsetSeconds: Math.max(-86_400, Math.min(172_800, offsetSeconds)),
    sessionId: session.id,
    state: body.visible ? body.state : "hidden",
    userId
  });

  if (joined && !body.leave) {
    events.push(webinarEvent(userId, session.id, "webinar_joined", { device: deviceOf(input.userAgent), kind: session.kind }));
    if (session.kind === "replay" && !last) {
      events.push(webinarEvent(userId, session.id, "webinar_replay_started", { recording_id: context.recordingId }));
    }
  }

  const ended = session.kind === "replay" ? false : session.status === "ended" || session.status === "cancelled" || simulatedPhase(session, context.durationMs, now) === "ended";

  if (body.leave) {
    const buckets = await countStudentPresenceRows(db, { sessionId: session.id, userId });
    events.push(webinarEvent(userId, session.id, "webinar_left", { kind: session.kind, reason: ended ? "ended" : "closed", seconds_present: buckets * ROOM_RULES.bucketSeconds }));
  }

  const presentNow = session.kind === "replay" ? 0 : (await listPresentUserIds(db, { currentBucket: bucket, sessionId: session.id })).length;

  return { ended, events, offsetMs: Number.isFinite(serverOffset) ? Math.round(serverOffset) : null, presentNow, serverTime: nowIso };
}

/* ------------------------------------------------------------------------------------------------
 * Reacoes, perguntas e enquetes
 * ---------------------------------------------------------------------------------------------- */

export type ReactionResult = { events: StudentEventInsert[]; offsetMs: number; reaction: Reaction };

/**
 * A reacao (docs/30 §5.1): no maximo 1 por segundo e 20 por minuto por aluno e sessao, conferidas na memoria antes
 * de qualquer await (dois pedidos juntos nao passam os dois) e de novo no banco (o limite entre instancias).
 */
export async function sendStudentReaction(input: { context: RoomContext; db: WebinarsDb; now?: number; offsetMs?: number | null; reaction: Reaction; userId: string }): Promise<ReactionResult> {
  const { context, db, reaction, userId } = input;
  const now = input.now ?? Date.now();
  refuse(context, now, "interaction");

  const taken = takeReaction(userId, context.session.id, now);
  if (!taken.ok) {
    throw new RoomLimitError(ROOM_LIMIT_MESSAGE, taken.retryAfterSeconds);
  }
  const [lastSecond, lastMinute] = await Promise.all([
    countStudentReactionsSince(db, { sessionId: context.session.id, sinceIso: new Date(now - 1000 / ROOM_RULES.reactions.perSecond).toISOString(), userId }),
    countStudentReactionsSince(db, { sessionId: context.session.id, sinceIso: new Date(now - 60_000).toISOString(), userId })
  ]);
  if (lastSecond >= ROOM_RULES.reactions.perSecond) {
    throw new RoomLimitError(ROOM_LIMIT_MESSAGE, 1);
  }
  if (lastMinute >= ROOM_RULES.reactions.perMinute) {
    throw new RoomLimitError(ROOM_LIMIT_MESSAGE, 60);
  }

  const offsetMs = writeOffsetMs(context.session, now, input.offsetMs);
  await insertReactionRow(db, { offset_ms: offsetMs, reaction, session_id: context.session.id, user_id: userId });
  return { events: [webinarEvent(userId, context.session.id, "webinar_reaction_sent", reactionSentMetadata({ offsetMs, reaction }))], offsetMs, reaction };
}

export type QuestionResult = { events: StudentEventInsert[]; question: StudentQuestion };

export type AskQuestionInput = {
  body: Pick<QuestionPostInput, "anonymous" | "body" | "consent" | "consentVersion" | "displayMode" | "nickname">;
  context: RoomContext;
  db: WebinarsDb;
  now?: number;
  offsetMs?: number | null;
  userId: string;
};

/**
 * A pergunta da aba Perguntas (2 por minuto por aluno e sessao). O nome aparece como no chat e so com o aceite
 * (D10): sem ele, a pergunta precisa trazer o aceite (409 consent_required) e grava como a primeira mensagem.
 * Anonima ("Aluno {n}") so quando a equipe deixou ligada no card Sala; pedida com ela desligada, 400.
 */
export async function askStudentQuestion(input: AskQuestionInput): Promise<QuestionResult> {
  const { body, context, db, userId } = input;
  const now = input.now ?? Date.now();
  const { session, webinar } = context;
  const events: StudentEventInsert[] = [];
  refuse(context, now, "interaction");

  if (body.anonymous && !webinar.roomSettings.anonymousQuestions) {
    throw new WebinarError(CHAT_MESSAGES.anonymousOff, 400);
  }
  const identity = await loadStudentIdentity(db, userId);
  // O aceite passa pelo mesmo caminho do chat, mas "Anonima" aqui e da pergunta, nao do nome no chat.
  const choice = consentChoice(identity, { ...body, anonymous: false }, webinar);

  const burst = takeQuestionBurst(userId, session.id, now);
  if (!burst.ok) {
    throw new RoomLimitError(ROOM_LIMIT_MESSAGE, burst.retryAfterSeconds);
  }
  const text = sanitizeLessonCommentBody(body.body);
  if (!text) {
    throw new WebinarError(CHAT_MESSAGES.question, 400);
  }
  const blocked = await blockedTermIn(db, text);
  if (blocked) {
    throw new WebinarError(blocked, 422);
  }

  await saveConsent({ choice, db, events, now, sessionId: session.id, userId });
  const mode: DisplayNameMode = body.anonymous ? "anonymous" : choice.mode;
  const anonymous = mode === "anonymous";
  const displayName = studentDisplayName({ fullName: identity.fullName, nickname: choice.nickname }, mode, userId, webinar.id);
  const offsetMs = writeOffsetMs(session, now, input.offsetMs);
  const row = await insertQuestionRow(db, { anonymous, body: text, display_name: displayName, offset_ms: offsetMs, session_id: session.id, user_id: userId });
  const question = toStudentQuestion(questionFromRow(row), userId, false);
  if (!question) {
    throw new WebinarError(CHAT_MESSAGES.invalid, 500);
  }
  events.push(webinarEvent(userId, session.id, "webinar_question_sent", questionSentMetadata({ anonymous, offsetMs, questionId: row.id })));
  return { events, question };
}

/** Curtir / Tirar a curtida de uma pergunta que o aluno ve na sessao (fora da hora 409; a dispensada de outro aluno 404). */
export async function voteStudentQuestion(input: { context: RoomContext; db: WebinarsDb; now?: number; questionId: string; userId: string }): Promise<{ upvotes: number; voted: boolean }> {
  const now = input.now ?? Date.now();
  refuse(input.context, now, "interaction");
  const row = await fetchQuestionRow(input.db, input.questionId);
  if (!row || row.session_id !== input.context.session.id || row.deleted_at || !toStudentQuestion(questionFromRow(row), input.userId, false)) {
    throw new WebinarError("Pergunta não encontrada.", 404);
  }
  return toggleQuestionVote(input.db, { questionId: input.questionId, userId: input.userId });
}

export type PollAnswerResult = { events: StudentEventInsert[]; poll: StudentPoll };

/** A resposta da enquete aberta (uma por aluno: a segunda e 409 pela chave unica). */
export async function answerStudentPoll(input: { context: RoomContext; db: WebinarsDb; now?: number; offsetMs?: number | null; optionIds: string[]; pollId: string; userId: string }): Promise<PollAnswerResult> {
  const { context, db, userId } = input;
  const now = input.now ?? Date.now();
  refuse(context, now, "interaction");

  const found = await fetchPollRow(db, input.pollId);
  if (!found || found.poll.session_id !== context.session.id) {
    throw new WebinarError("Enquete não encontrada.", 404);
  }
  const poll = pollFromRow(found.poll, found.options);
  const problem = pollAnswerProblem(poll, input.optionIds);
  if (problem === "closed") {
    throw new RoomRefusedError("poll_closed");
  }
  if (problem) {
    throw new WebinarError(CHAT_MESSAGES.pollAnswer, 400);
  }

  const offsetMs = writeOffsetMs(context.session, now, input.offsetMs);
  const answer = await insertPollAnswerRow(db, { offset_ms: offsetMs, option_ids: input.optionIds, poll_id: poll.id, session_id: context.session.id, user_id: userId });
  const view = toStudentPoll(poll, [pollAnswerFromRow(answer)], userId);
  if (!view) {
    throw new WebinarError(CHAT_MESSAGES.invalid, 500);
  }
  return { events: [webinarEvent(userId, context.session.id, "webinar_poll_answered", pollAnsweredMetadata({ offsetMs, options: input.optionIds.length, pollId: poll.id }))], poll: view };
}
