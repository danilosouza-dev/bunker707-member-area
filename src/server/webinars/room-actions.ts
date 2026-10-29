"use server";

// Server Actions do console da sessao (docs/30 §2.4, §2.6, §5.2, §8.3, §8.5 e §8.6; fase 2b): abrir e encerrar a
// sessao pela mao da equipe, a mensagem da equipe, a moderacao (liberar, apagar, fixar, promover a linha mestre so
// com o aceite do aluno), quem pode escrever e o modo lento, as enquetes (modelos, abrir, encerrar, compartilhar),
// as perguntas, a decisao do selo "Ao vivo" (a frase de §8.6 conferida no servidor), o Replay livre e "Remover
// minhas mensagens" a pedido do aluno. Permissoes de §2.6: abrir, encerrar, a Simulacao e a remocao a pedido pedem
// messaging.publish; o resto, messaging.write. Toda acao grava recordAudit com ids e contagens (a Simulacao leva os
// valores da decisao, D10). O relogio e sempre o do servidor. Fase 4c (docs/30 §1.6, §2.4 e D24): a resposta da equipe
// a uma pergunta grava answer_source 'team' (a do Assistente e 'ai'), e a resposta que chega depois (o aluno pediu a
// equipe, a sessao acabou ou ele saiu da sala) vira aviso no sino (notify.queueWebinarAnswerNotice), na pergunta e na
// resposta da equipe a uma mensagem do chat; banco sem a 202610290006: a resposta segue e so a marca fica de fora.

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { getUserDisplayName } from "@/server/auth/session";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { recordEvents } from "@/server/students/store";
import { teamAnswerNeedsNotice } from "./assistant-model";
import { studentPresentNow } from "./assistant-queries";
import { answerQuestionOfApprovedAiReply, fetchAttendanceMarks, setQuestionAnswerSource } from "./assistant-store";
import { invalidateWebinars } from "./cache";
import { chatMessageFromRow, pollFromRow, questionFromRow, type ChatMessageRow } from "./chat-rows";
import {
  answerQuestionSchema,
  closePollSchema,
  createReplaySessionSchema,
  launchPollSchema,
  moderateMessageSchema,
  questionStatusSchema,
  removeStudentMessagesSchema,
  savePollsSchema,
  saveSimulationSchema,
  sessionChatModeSchema,
  sessionIdInputSchema,
  teamChatSchema,
  type ModerationAction
} from "./chat-schemas";
import {
  deletePollRow,
  fetchChatMessageRow,
  fetchConsentRow,
  fetchPollRow,
  fetchQuestionRow,
  fetchQuestionRowByMessage,
  insertChatMessage,
  insertPollRow,
  insertQuestionRow,
  listPollRows,
  replacePollOptionRows,
  revokeConsentRow,
  softDeleteQuestionsOfMessage,
  softDeleteStudentContent,
  updateChatMessageRow,
  updatePollRow,
  updateQuestionRow,
  type ChatMessagePatch
} from "./chat-store";
import { ackSentenceMatches, canEndSession, canOpenSession, canTeamActOn, consoleAckSentence } from "./console-model";
import { isMissingWebinarSchema, WebinarError, WebinarFieldError, webinarsDb, type WebinarsDb } from "./db";
import {
  CHAT_LIMITS,
  type ChatMessage,
  type ChatMode,
  type Poll,
  type PollDraft,
  type PresenceSummary,
  type SlowModeSeconds,
  type WebinarQuestion,
  type WebinarSession
} from "./model";
import { queueWebinarAnswerNotice } from "./notify";
import { baseRecordingOf } from "./queries";
import { anonymousNumber, displayNameFor, firstNameInitial, sessionOffsetMs } from "./room-model";
import { questionSentMetadata } from "./room-rules";
import { sessionFromRow, type SessionRow, type WebinarRow } from "./rows";
import { fetchSessionSimulation } from "./simulation-store";
import { finishSession, openSession } from "./session-lifecycle";
import { fetchSessionRow, insertSessionRows, listRecordingRows, listSessionRows, requireWebinarRow, updateSessionRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";

const SESSION_MISSING_MESSAGE = "Essa sessão não existe mais.";
const SESSION_CLOSED_MESSAGE = "Essa sessão não aceita mais ações da equipe.";
const REPLAY_NO_CHAT_MESSAGE = "O replay não tem chat da equipe ao vivo.";
const NOT_OPENABLE_MESSAGE = "Só uma sessão agendada ou na espera abre.";
const NOT_PUBLISHED_MESSAGE = "Só um webinário publicado abre sessão.";
const NOT_ENDABLE_MESSAGE = "Só uma sessão na espera ou no ar encerra.";
const MESSAGE_MISSING_MESSAGE = "Essa mensagem não existe mais.";
const NO_CONSENT_MESSAGE = "Sem consentimento do aluno: a mensagem não entra nas próximas turmas.";
const ONLY_AUDIENCE_PROMOTES_MESSAGE = "Só uma mensagem da turma de hoje entra nas próximas turmas.";
const PIN_NEEDS_APPROVAL_MESSAGE = "Libere a mensagem antes de fixar.";
const POLL_MISSING_MESSAGE = "Essa enquete não existe mais.";
const POLL_NOT_TEMPLATE_MESSAGE = "Essa enquete já é de uma sessão; abra pelo modelo.";
const POLL_NOT_OPEN_MESSAGE = "Essa enquete não está aberta.";
const QUESTION_MISSING_MESSAGE = "Essa pergunta não existe mais.";
const ANSWER_MISSING_MESSAGE = "Escreva a resposta ou marque Respondida ao vivo.";
const ACK_MISMATCH_MESSAGE = "A confirmação não bate com a frase de hoje. Marque de novo.";
const ONLY_SIMULATED_SESSION_MESSAGE = "O selo é decidido só nas sessões da Live gravada.";
const REPLAY_NEEDS_ENDED_MESSAGE = "O replay abre depois da primeira sessão encerrar.";
const REPLAY_NEEDS_VIDEO_MESSAGE = "Sem vídeo pronto para o replay.";
const REPLAY_MISSING_MESSAGE = "Não há replay aberto neste webinário.";

export type SessionOpened = { changed: boolean; fired: number; notified: number; sessionId: string };
export type SessionEnded = { replayCreated: boolean; sessionId: string; summary: PresenceSummary | null };
export type ModeratedMessage = { message: ChatMessage; pinnedMessageId: string | null };
export type SessionChatMode = { chatMode: ChatMode; sessionId: string; slowModeSeconds: SlowModeSeconds | null };
export type SavedPolls = { created: number; deleted: number; polls: Poll[]; updated: number };
export type AnsweredQuestion = { message: ChatMessage | null; notified: boolean; question: WebinarQuestion };
export type SavedSimulation = { deciderName: string; session: WebinarSession };
export type ReplayCreated = { created: boolean; session: WebinarSession };
export type RemovedStudentContent = { answers: number; consentRevoked: boolean; messages: number; questions: number };

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function revalidateWebinar(id: string) {
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${id}`);
  revalidatePath(`${LIST_PATH}/${id}/sala`);
}

function revalidateConsole(id: string) {
  revalidatePath(`${LIST_PATH}/${id}/sala`);
}

/** O relatorio da sessao fica 60 s em cache pela tag "webinars" (report-queries.ts): o que muda os numeros invalida. */
function invalidateReport() {
  invalidateWebinars({ from: "action" });
}

type LoadedSession = { row: SessionRow; session: WebinarSession; webinar: WebinarRow };

async function loadSession(db: WebinarsDb, sessionId: string): Promise<LoadedSession> {
  const row = await fetchSessionRow(db, sessionId);

  if (!row) {
    throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
  }

  const webinar = await requireWebinarRow(db, row.webinar_id);

  return { row, session: sessionFromRow(row), webinar };
}

/** O offset do relogio do servidor dentro dos limites do banco; NaN (replay) vira nulo. */
function serverOffsetMs(session: WebinarSession, nowMs: number): number | null {
  const offset = sessionOffsetMs(session, nowMs);

  return Number.isFinite(offset) ? Math.max(CHAT_LIMITS.offsetMinMs, Math.min(CHAT_LIMITS.offsetMaxMs, Math.round(offset))) : null;
}

function teamRole(webinar: WebinarRow, userId: string): "host" | "team" {
  return webinar.host_user_id === userId ? "host" : "team";
}

function teamDisplayName(user: { email?: string; user_metadata: Record<string, unknown> }) {
  return firstNameInitial(getUserDisplayName(user).fullName).slice(0, CHAT_LIMITS.displayName) || "Equipe";
}

/** Fase 4c: as marcas de atendimento de um alvo; sem a 202610290006 (ou na falha da leitura), nenhuma: a resposta da equipe segue igual. */
async function attendanceMarksOf(db: WebinarsDb, target: "chat" | "question", id: string) {
  try {
    return (await fetchAttendanceMarks(db, { ids: [id], target })).get(id) ?? null;
  } catch (error) {
    if (!isPendingMigrationError(error)) {
      console.error(`[webinarios] marcas de atendimento nao lidas: ${error instanceof Error ? error.message : String(error)}`);
    }
    return null;
  }
}

/**
 * Fase 4c: a resposta da equipe vai tambem para o sino quando o aluno pediu a equipe, quando a sessao ja nao esta no ar
 * ou quando ele saiu da sala (assistant-model.teamAnswerNeedsNotice). Nunca lanca; devolve se avisou.
 */
async function noticeTeamAnswer(
  db: WebinarsDb,
  input: { answerText: string; handoffRequested: boolean; now: Date; session: WebinarSession; targetId: string; userId: string }
): Promise<boolean> {
  try {
    const sessionRunning = canTeamActOn(input.session);
    const studentPresent = sessionRunning && !input.handoffRequested ? await studentPresentNow(db, { nowMs: input.now.getTime(), session: input.session, userId: input.userId }) : false;

    if (!teamAnswerNeedsNotice({ handoffRequested: input.handoffRequested, sessionRunning, studentPresent })) {
      return false;
    }

    const sent = await queueWebinarAnswerNotice(db, {
      answerText: input.answerText,
      now: input.now,
      sessionId: input.session.id,
      targetId: input.targetId,
      userId: input.userId,
      webinarId: input.session.webinarId
    });
    return sent.notifications > 0;
  } catch (error) {
    console.error(`[webinarios] aviso da resposta da equipe nao decidido: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/** Fase 4c: a pergunta foi respondida pela equipe (answer_source 'team'); sem a 202610290006, nada. */
async function markTeamAnswer(db: WebinarsDb, questionId: string) {
  try {
    await setQuestionAnswerSource(db, { questionId, source: "team" });
  } catch (error) {
    if (!isPendingMigrationError(error)) {
      throw error;
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * Abrir e encerrar a sessao pela mao da equipe
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.publish] Abre a sessao agora: `live`, o roteiro pronto entra uma vez (webinar_open_session) e quem
 * garantiu vaga recebe o "Começou agora" (session-lifecycle.openSession). So agendada ou na espera, de webinario
 * publicado.
 */
export async function openSessionNow(input: { sessionId: string }): Promise<ActionResult<SessionOpened>> {
  return runAdminAction("messaging.publish", sessionIdInputSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { row, webinar } = await loadSession(db, data.sessionId);

    if (webinar.cancelled_at || webinar.status !== "published") {
      throw new WebinarError(NOT_PUBLISHED_MESSAGE, 409);
    }

    if (row.kind === "replay" || !canOpenSession(sessionFromRow(row).status)) {
      throw new WebinarError(NOT_OPENABLE_MESSAGE, 409);
    }

    const outcome = await openSession(db, row.id, now);

    await recordAudit(db, {
      action: "webinar.session_opened",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { changed: outcome.changed, fired: outcome.fired, kind: row.kind, notified: outcome.notified, session_id: row.id }
    });
    revalidateWebinar(webinar.id);
    invalidateReport();

    return { ...outcome, sessionId: row.id };
  });
}

/**
 * [messaging.publish] Encerra a sessao agora: a presenca e resumida, a curva congelada (webinar_close_session) e o
 * replay nasce quando a gravacao esta pronta (session-lifecycle.finishSession). So na espera ou no ar.
 */
export async function endSessionNow(input: { sessionId: string }): Promise<ActionResult<SessionEnded>> {
  return runAdminAction("messaging.publish", sessionIdInputSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { row, session, webinar } = await loadSession(db, data.sessionId);

    if (row.kind === "replay" || !canEndSession(session.status)) {
      throw new WebinarError(NOT_ENDABLE_MESSAGE, 409);
    }

    const outcome = await finishSession(db, row.id, now);

    await recordAudit(db, {
      action: "webinar.session_ended",
      actorId: user.id,
      count: outcome.summary?.unique ?? null,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { kind: row.kind, peak: outcome.summary?.peak?.n ?? null, replay_created: outcome.replayCreated, session_id: row.id, unique: outcome.summary?.unique ?? null }
    });
    revalidateWebinar(webinar.id);
    invalidateReport();

    return { replayCreated: outcome.replayCreated, sessionId: row.id, summary: outcome.summary };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Chat da equipe e moderacao (§8.3)
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] A mensagem da equipe no chat da sessao: role `host` para o Apresentador, `team` para o resto,
 * source `team`, aprovada, no offset do relogio do servidor (nunca o do navegador).
 */
export async function sendTeamMessage(input: { body: string; kind?: "answer" | "message" | "system"; replyToId?: string | null; sessionId: string }): Promise<ActionResult<{ message: ChatMessage }>> {
  return runAdminAction("messaging.write", teamChatSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { session, webinar } = await loadSession(db, data.sessionId);

    if (session.kind === "replay") {
      throw new WebinarError(REPLAY_NO_CHAT_MESSAGE, 409);
    }

    if (!canTeamActOn(session)) {
      throw new WebinarError(SESSION_CLOSED_MESSAGE, 409);
    }

    const offset = serverOffsetMs(session, now.getTime());

    if (offset === null) {
      throw new WebinarError(SESSION_CLOSED_MESSAGE, 409);
    }

    const role = teamRole(webinar, user.id);
    const inserted = await insertChatMessage(db, {
      approved: true,
      author_user_id: user.id,
      body: data.body,
      display_name: teamDisplayName(user),
      kind: data.kind,
      // D31: o que e escrito na Live ao vivo nasce na linha mestre (o replay toca o chat da live pela posicao do video).
      master: session.kind === "live",
      offset_ms: offset,
      reply_to_id: data.replyToId ?? null,
      role,
      session_id: session.id,
      source: "team",
      webinar_id: webinar.id
    });

    // Fase 4c: a resposta da equipe a uma mensagem do aluno (a fila do Atendimento) tambem vai para o sino quando ele
    // pediu a equipe ou ja saiu da sala.
    let notified = false;
    const repliedTo = data.replyToId ? await fetchChatMessageRow(db, data.replyToId).catch(() => null) : null;

    if (repliedTo && repliedTo.session_id === session.id && repliedTo.source === "audience" && repliedTo.author_user_id && !repliedTo.deleted_at) {
      const marks = await attendanceMarksOf(db, "chat", repliedTo.id);
      notified = await noticeTeamAnswer(db, {
        answerText: data.body,
        handoffRequested: Boolean(marks?.handoffRequestedAt),
        now,
        session,
        targetId: repliedTo.id,
        userId: repliedTo.author_user_id
      });
    }

    await recordAudit(db, {
      action: "webinar.team_message",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { kind: data.kind, message_id: inserted.id, notified, reply: Boolean(data.replyToId), role, session_id: session.id }
    });

    return { message: chatMessageFromRow(inserted) };
  });
}

/**
 * A pergunta que o aluno mandou pelo chat moderado so entra na aba Perguntas quando a equipe libera a mensagem
 * (antes disso ninguem alem do autor a ve). Anonima quando o nome gravado e o "Aluno {n}" do proprio aluno.
 */
async function openQuestionOfMessage(db: WebinarsDb, message: ChatMessageRow): Promise<void> {
  if (message.kind !== "question" || message.source !== "audience" || !message.author_user_id || (await fetchQuestionRowByMessage(db, message.id))) {
    return;
  }
  const anonymous = message.display_name === displayNameFor({ anonymousNumber: anonymousNumber(message.author_user_id, message.webinar_id), fullName: null, mode: "anonymous", nickname: null });
  const question = await insertQuestionRow(db, {
    anonymous,
    body: message.body.slice(0, 500),
    display_name: message.display_name,
    message_id: message.id,
    offset_ms: message.offset_ms,
    session_id: message.session_id,
    user_id: message.author_user_id
  });
  await recordEvents(db, [
    {
      entity_id: message.session_id,
      entity_type: "webinar",
      event_type: "webinar_question_sent",
      metadata: questionSentMetadata({ anonymous, offsetMs: message.offset_ms, questionId: question.id }),
      user_id: message.author_user_id
    }
  ]);
}

/**
 * [messaging.write] Moderacao de uma mensagem: liberar (approved + quem e quando; a pergunta pelo chat entra na
 * aba Perguntas so agora), apagar (deleted_at, motivo `team`; some para todos na hora, com a pergunta ligada a ela),
 * fixar e desafixar (pinned_at + webinar_sessions.pinned_message_id, uma por sessao) e promover a linha mestre
 * (master + source `original`, so mensagem da turma cujo autor mantem o aceite).
 */
export async function moderateMessage(input: { action: ModerationAction; messageId: string; reason?: string }): Promise<ActionResult<ModeratedMessage>> {
  return runAdminAction("messaging.write", moderateMessageSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const nowIso = new Date().toISOString();
    const message = await fetchChatMessageRow(db, data.messageId);

    if (!message || message.deleted_at) {
      throw new WebinarError(MESSAGE_MISSING_MESSAGE, 404);
    }

    const sessionRow = await fetchSessionRow(db, message.session_id);

    if (!sessionRow) {
      throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
    }

    let patch: ChatMessagePatch;
    let pinnedMessageId = sessionRow.pinned_message_id;

    switch (data.action) {
      case "approve":
        patch = { approved: true, approved_at: nowIso, approved_by: user.id };
        break;
      case "delete":
        patch = { deleted_at: nowIso, deleted_by: user.id, deleted_reason: "team" };
        break;
      case "pin":
        if (!message.approved) {
          throw new WebinarError(PIN_NEEDS_APPROVAL_MESSAGE, 409);
        }
        patch = { pinned_at: nowIso };
        break;
      case "unpin":
        patch = { pinned_at: null };
        break;
      case "promote": {
        if (message.source !== "audience" || message.master) {
          throw new WebinarError(ONLY_AUDIENCE_PROMOTES_MESSAGE, 409);
        }

        const consent = message.author_user_id ? await fetchConsentRow(db, message.author_user_id) : null;

        if (!consent || consent.revoked_at) {
          throw new WebinarError(NO_CONSENT_MESSAGE, 409);
        }

        patch = { approved: true, approved_at: message.approved_at ?? nowIso, approved_by: message.approved_by ?? user.id, master: true, source: "original" };
        break;
      }
      default:
        throw new WebinarError("Ação inválida.", 400);
    }

    // O estado de antes da troca (a linha lida pode ser a mesma referencia que a escrita devolve).
    const wasApproved = message.approved;
    const updated = await updateChatMessageRow(db, message.id, patch);

    if (!updated) {
      throw new WebinarError(MESSAGE_MISSING_MESSAGE, 404);
    }

    if (data.action === "approve" && !wasApproved) {
      await openQuestionOfMessage(db, updated);
      // A resposta do Assistente que esperava a equipe (chat moderado): a pergunta da aba fica respondida so agora.
      if (message.role === "ai") {
        await answerQuestionOfApprovedAiReply(db, { body: message.body, messageId: message.id, nowIso });
      }
    } else if (data.action === "delete") {
      await softDeleteQuestionsOfMessage(db, { messageId: message.id, nowIso, reason: "team" });
    }

    if (data.action === "pin") {
      if (pinnedMessageId && pinnedMessageId !== message.id) {
        await updateChatMessageRow(db, pinnedMessageId, { pinned_at: null });
      }

      await updateSessionRow(db, sessionRow.id, { pinned_message_id: message.id });
      pinnedMessageId = message.id;
    } else if ((data.action === "unpin" || data.action === "delete") && pinnedMessageId === message.id) {
      await updateSessionRow(db, sessionRow.id, { pinned_message_id: null });
      pinnedMessageId = null;
    }

    await recordAudit(db, {
      action: "webinar.moderated",
      actorId: user.id,
      entityId: sessionRow.webinar_id,
      entityType: "webinar",
      metadata: { action: data.action, message_id: message.id, session_id: sessionRow.id, source: message.source, with_reason: Boolean(data.reason) }
    });
    revalidateConsole(sessionRow.webinar_id);

    // Apagar e promover mudam as contagens do chat no relatorio (so mensagens audience/original nao apagadas).
    if (data.action === "delete" || data.action === "promote" || data.action === "approve") {
      invalidateReport();
    }

    return { message: chatMessageFromRow(updated), pinnedMessageId };
  });
}

/** [messaging.write] Quem pode escrever e o modo lento da sessao (o modo lento nao vale para a equipe, §8.3). */
export async function setSessionChatMode(input: { chatMode: ChatMode; sessionId: string; slowModeSeconds: SlowModeSeconds | null }): Promise<ActionResult<SessionChatMode>> {
  return runAdminAction("messaging.write", sessionChatModeSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const { row, webinar } = await loadSession(db, data.sessionId);

    if (row.status === "cancelled") {
      throw new WebinarError(SESSION_CLOSED_MESSAGE, 409);
    }

    const slow = data.chatMode === "off" ? null : data.slowModeSeconds;
    const updated = await updateSessionRow(db, row.id, { chat_mode: data.chatMode, chat_slow_mode_seconds: slow });

    if (!updated) {
      throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
    }

    await recordAudit(db, {
      action: "webinar.chat_mode",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { chat_mode: data.chatMode, session_id: row.id, slow_mode_seconds: slow }
    });
    revalidateConsole(webinar.id);

    return { chatMode: data.chatMode, sessionId: row.id, slowModeSeconds: slow };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Enquetes
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] Os modelos de enquete do webinario (session_id nulo), a lista inteira: cria os novos, atualiza
 * os que tem id, apaga os que sairam. As copias ja lancadas nas sessoes nao mudam.
 */
export async function savePolls(input: { polls: PollDraft[]; webinarId: string }): Promise<ActionResult<SavedPolls>> {
  return runAdminAction("messaging.write", savePollsSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const webinar = await requireWebinarRow(db, data.webinarId);
    const existing = await listPollRows(db, { sessionId: null, webinarId: webinar.id });
    const existingIds = new Set(existing.polls.map((poll) => poll.id));
    const kept = new Set<string>();
    let created = 0;
    let updated = 0;

    for (const [position, draft] of data.polls.entries()) {
      const labels = draft.options.map((option) => option.label);

      if (draft.id && existingIds.has(draft.id)) {
        const ownOptionIds = new Set(existing.options.filter((option) => option.poll_id === draft.id).map((option) => option.id));
        await updatePollRow(db, draft.id, { anonymous: draft.anonymous, kind: draft.kind, position, question: draft.question });
        await replacePollOptionRows(
          db,
          draft.id,
          draft.options.map((option) => ({ id: option.id && ownOptionIds.has(option.id) ? option.id : null, label: option.label }))
        );
        kept.add(draft.id);
        updated += 1;
      } else {
        const inserted = await insertPollRow(
          db,
          { anonymous: draft.anonymous, created_by: user.id, kind: draft.kind, position, question: draft.question, session_id: null, status: "draft", webinar_id: webinar.id },
          labels
        );
        kept.add(inserted.poll.id);
        created += 1;
      }
    }

    let deleted = 0;

    for (const poll of existing.polls) {
      if (!kept.has(poll.id)) {
        await deletePollRow(db, poll.id);
        deleted += 1;
      }
    }

    const saved = await listPollRows(db, { sessionId: null, webinarId: webinar.id });
    const polls = saved.polls.map((poll) => pollFromRow(poll, saved.options));

    await recordAudit(db, {
      action: "webinar.polls_saved",
      actorId: user.id,
      count: polls.length,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { created, deleted, polls: polls.length, updated }
    });
    revalidateWebinar(webinar.id);

    return { created, deleted, polls, updated };
  });
}

/**
 * [messaging.write] Abre uma enquete na sessao: a copia do modelo (session_id, template_poll_id) nasce aberta, com
 * a hora e o minuto do video. Uma copia aberta do mesmo modelo na mesma sessao nao duplica: volta a que existe.
 */
export async function launchPoll(input: { pollId: string; sessionId: string }): Promise<ActionResult<{ poll: Poll }>> {
  return runAdminAction("messaging.write", launchPollSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { session, webinar } = await loadSession(db, data.sessionId);

    if (!canTeamActOn(session)) {
      throw new WebinarError(SESSION_CLOSED_MESSAGE, 409);
    }

    const template = await fetchPollRow(db, data.pollId);

    if (!template || template.poll.webinar_id !== webinar.id) {
      throw new WebinarError(POLL_MISSING_MESSAGE, 404);
    }

    if (template.poll.session_id !== null) {
      throw new WebinarError(POLL_NOT_TEMPLATE_MESSAGE, 409);
    }

    const launched = await listPollRows(db, { sessionId: session.id, webinarId: webinar.id });
    const open = launched.polls.find((poll) => poll.template_poll_id === template.poll.id && poll.status === "open");

    if (open) {
      return { poll: pollFromRow(open, launched.options) };
    }

    const created = await insertPollRow(
      db,
      {
        anonymous: template.poll.anonymous,
        created_by: user.id,
        kind: template.poll.kind,
        open_offset_ms: serverOffsetMs(session, now.getTime()),
        opened_at: now.toISOString(),
        position: template.poll.position,
        question: template.poll.question,
        session_id: session.id,
        status: "open",
        template_poll_id: template.poll.id,
        webinar_id: webinar.id
      },
      template.options.map((option) => option.label)
    );

    await recordAudit(db, {
      action: "webinar.poll_launched",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { poll_id: created.poll.id, session_id: session.id, template_poll_id: template.poll.id }
    });
    revalidateConsole(webinar.id);
    invalidateReport();

    return { poll: pollFromRow(created.poll, created.options) };
  });
}

/** [messaging.write] Encerra a enquete aberta (e, se pedido, compartilha o resultado com a turma). */
export async function closePoll(input: { pollId: string; sessionId: string; shareResults?: boolean }): Promise<ActionResult<{ poll: Poll }>> {
  return runAdminAction("messaging.write", closePollSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const nowIso = new Date().toISOString();
    const found = await fetchPollRow(db, data.pollId);

    if (!found || found.poll.session_id !== data.sessionId) {
      throw new WebinarError(POLL_MISSING_MESSAGE, 404);
    }

    let row = found.poll;

    if (row.status === "open") {
      const closed = await updatePollRow(db, row.id, { closed_at: nowIso, status: "closed", ...(data.shareResults ? { results_shared_at: nowIso } : {}) }, { expectedStatuses: ["open"] });
      row = closed ?? row;
    } else if (row.status === "closed") {
      if (data.shareResults && !row.results_shared_at) {
        row = (await updatePollRow(db, row.id, { results_shared_at: nowIso })) ?? row;
      }
    } else {
      throw new WebinarError(POLL_NOT_OPEN_MESSAGE, 409);
    }

    await recordAudit(db, {
      action: "webinar.poll_closed",
      actorId: user.id,
      entityId: row.webinar_id,
      entityType: "webinar",
      metadata: { poll_id: row.id, session_id: row.session_id, shared: Boolean(row.results_shared_at) }
    });
    revalidateConsole(row.webinar_id);
    invalidateReport();

    return { poll: pollFromRow(row, found.options) };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Perguntas
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] Responde uma pergunta: por escrito (a resposta entra no chat como linha da equipe, kind
 * `answer`, respondendo a mensagem de origem quando houver) e/ou "Respondida ao vivo".
 */
export async function answerQuestion(input: { answerText?: string; answeredLive?: boolean; questionId: string }): Promise<ActionResult<AnsweredQuestion>> {
  return runAdminAction("messaging.write", answerQuestionSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const question = await fetchQuestionRow(db, data.questionId);

    if (!question || question.deleted_at) {
      throw new WebinarError(QUESTION_MISSING_MESSAGE, 404);
    }

    const answerText = data.answerText?.trim() || null;

    if (!answerText && !data.answeredLive) {
      throw new WebinarFieldError("answerText", ANSWER_MISSING_MESSAGE);
    }

    const { session, webinar } = await loadSession(db, question.session_id);
    const updated = await updateQuestionRow(db, question.id, {
      answer_text: answerText ?? question.answer_text,
      answered_at: now.toISOString(),
      answered_by: user.id,
      answered_live: data.answeredLive || question.answered_live,
      status: "answered"
    });

    if (!updated) {
      throw new WebinarError(QUESTION_MISSING_MESSAGE, 404);
    }

    await markTeamAnswer(db, question.id);

    let message: ChatMessage | null = null;
    const offset = serverOffsetMs(session, now.getTime());

    if (answerText && offset !== null && canTeamActOn(session)) {
      const inserted = await insertChatMessage(db, {
        approved: true,
        author_user_id: user.id,
        body: answerText,
        display_name: teamDisplayName(user),
        kind: "answer",
        master: session.kind === "live",
        offset_ms: offset,
        reply_to_id: question.message_id,
        role: teamRole(webinar, user.id),
        session_id: session.id,
        source: "team",
        webinar_id: webinar.id
      });
      message = chatMessageFromRow(inserted);
    }

    // Fase 4c: a resposta por escrito que chega depois (pediu a equipe, sessao fora do ar ou aluno fora da sala) vai ao sino.
    const marks = answerText ? await attendanceMarksOf(db, "question", question.id) : null;
    const notified = answerText
      ? await noticeTeamAnswer(db, { answerText, handoffRequested: Boolean(marks?.handoffRequestedAt), now, session, targetId: question.id, userId: question.user_id })
      : false;

    await recordAudit(db, {
      action: "webinar.question_answered",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { live: Boolean(data.answeredLive), message_id: message?.id ?? null, notified, question_id: question.id, session_id: session.id, written: Boolean(answerText) }
    });
    revalidateConsole(webinar.id);
    invalidateReport();

    return { message, notified, question: questionFromRow(updated) };
  });
}

/** [messaging.write] Dispensa, reabre ou marca como respondida uma pergunta. */
export async function setQuestionStatus(input: { questionId: string; status: WebinarQuestion["status"] }): Promise<ActionResult<{ question: WebinarQuestion }>> {
  return runAdminAction("messaging.write", questionStatusSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const nowIso = new Date().toISOString();
    const question = await fetchQuestionRow(db, data.questionId);

    if (!question || question.deleted_at) {
      throw new WebinarError(QUESTION_MISSING_MESSAGE, 404);
    }

    const sessionRow = await fetchSessionRow(db, question.session_id);
    const previousStatus = question.status;
    const patch = data.status === "answered" ? { answered_at: question.answered_at ?? nowIso, answered_by: question.answered_by ?? user.id, status: "answered" } : { status: data.status };
    const updated = await updateQuestionRow(db, question.id, patch);

    if (!updated) {
      throw new WebinarError(QUESTION_MISSING_MESSAGE, 404);
    }

    if (data.status === "answered" && previousStatus !== "answered") {
      await markTeamAnswer(db, question.id);
    }

    await recordAudit(db, {
      action: "webinar.question_status",
      actorId: user.id,
      entityId: sessionRow?.webinar_id ?? null,
      entityType: "webinar",
      metadata: { from: previousStatus, question_id: question.id, session_id: question.session_id, status: data.status }
    });

    if (sessionRow) {
      revalidateConsole(sessionRow.webinar_id);
    }

    invalidateReport();

    return { question: questionFromRow(updated) };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Simulacao (D10, §8.6)
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.publish] A decisao do selo "Ao vivo" de uma sessao gravada: ligar exige a frase de §8.6 marcada, e a
 * frase precisa ser a que o servidor monta hoje (data de Sao Paulo, nome de quem decide; a de ontem vale para a
 * tela aberta antes da meia-noite). Desligar grava a decisao tambem. A auditoria leva os valores (D10).
 */
export async function saveSimulation(input: { ackText?: string; acknowledged?: boolean; sessionId: string; showLiveBadge: boolean }): Promise<ActionResult<SavedSimulation>> {
  return runAdminAction("messaging.publish", saveSimulationSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { row, webinar } = await loadSession(db, data.sessionId);

    if (row.kind !== "simulated" || row.status === "cancelled") {
      throw new WebinarError(ONLY_SIMULATED_SESSION_MESSAGE, 409);
    }

    // Fase 4 (D10): com regra simulada na sessao, a frase da fase 2 ("numeros reais") seria falsa; a decisao passa
    // pelo card novo (saveSessionSimulation). Banco sem a 202610290005: nao ha regra, segue a fase 2.
    if (await hasSimulatedRules(db, row.id)) {
      throw new WebinarError(WEBINAR_COPY.simulacao.servidor.usarCardNovo, 409);
    }

    const responsible = getUserDisplayName(user).fullName;
    const given = data.ackText?.trim() ?? "";

    if (data.showLiveBadge && !ackSentenceMatches({ ackText: given, badgeOn: true, nowMs: now.getTime(), responsible })) {
      throw new WebinarFieldError("acknowledged", ACK_MISMATCH_MESSAGE);
    }

    const ackText = data.showLiveBadge
      ? given
      : given && ackSentenceMatches({ ackText: given, badgeOn: false, nowMs: now.getTime(), responsible })
        ? given
        : consoleAckSentence({ badgeOn: false, nowMs: now.getTime(), responsible });
    const updated = await updateSessionRow(db, row.id, {
      show_live_badge: data.showLiveBadge,
      simulation_ack_text: ackText.slice(0, CHAT_LIMITS.simulationAck),
      simulation_decided_at: now.toISOString(),
      simulation_decided_by: user.id
    });

    if (!updated) {
      throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
    }

    await recordAudit(db, {
      action: "webinar.simulation_saved",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { ack_text: ackText, decided_by: user.id, numbers_simulated: false, session_id: row.id, show_live_badge: data.showLiveBadge }
    });
    revalidateWebinar(webinar.id);

    return { deciderName: responsible, session: sessionFromRow(updated) };
  });
}

/** A sessao tem contador, entradas ou avisos de venda simulados (colunas da 202610290005; sem elas, false). */
async function hasSimulatedRules(db: WebinarsDb, sessionId: string) {
  try {
    const simulation = await fetchSessionSimulation(db, sessionId);
    return Boolean(simulation && (simulation.countRule.mode !== "off" || simulation.joins.enabled || simulation.saleNotices.enabled));
  } catch (error) {
    if (isMissingWebinarSchema(error) || isPendingMigrationError(error)) {
      return false;
    }
    throw error;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Replay livre
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] Libera o Replay livre do webinario: uma sessao `replay` disponivel na hora (`live`), apontando
 * para a ultima sessao encerrada e para a gravacao base. Uma por webinario (indice unico): a que existe volta; a
 * fechada antes reabre.
 */
export async function createReplaySession(input: { webinarId: string }): Promise<ActionResult<ReplayCreated>> {
  return runAdminAction("messaging.write", createReplaySessionSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const webinar = await requireWebinarRow(db, data.webinarId);
    const sessions = await listSessionRows(db, [webinar.id]);
    const existing = sessions.find((session) => session.kind === "replay") ?? null;

    if (existing && existing.status !== "cancelled") {
      return { created: false, session: sessionFromRow(existing) };
    }

    const ended = sessions
      .filter((session) => session.kind !== "replay" && session.status === "ended")
      .sort((a, b) => (Date.parse(b.ended_at ?? b.scheduled_at) || 0) - (Date.parse(a.ended_at ?? a.scheduled_at) || 0));

    if (ended.length === 0) {
      throw new WebinarError(REPLAY_NEEDS_ENDED_MESSAGE, 409);
    }

    const recording = baseRecordingOf(await listRecordingRows(db, [webinar.id]));

    if (!recording || recording.status !== "ready" || !recording.embed_url) {
      throw new WebinarError(REPLAY_NEEDS_VIDEO_MESSAGE, 409);
    }

    const source = ended[0];
    let created: SessionRow | null;

    if (existing) {
      created = await updateSessionRow(db, existing.id, { ended_at: null, recording_id: recording.id, scheduled_at: now.toISOString(), source_session_id: source.id, status: "live" });
    } else {
      [created = null] = await insertSessionRows(db, [
        {
          chat_mode: source.chat_mode,
          chat_slow_mode_seconds: source.chat_slow_mode_seconds,
          kind: "replay",
          late_join_minutes: null,
          recording_id: recording.id,
          scheduled_at: now.toISOString(),
          source_session_id: source.id,
          status: "live",
          webinar_id: webinar.id
        }
      ]);
    }

    if (!created) {
      throw new WebinarError(REPLAY_MISSING_MESSAGE, 409);
    }

    await recordAudit(db, {
      action: "webinar.replay_created",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { reopened: existing !== null, session_id: created.id, source_session_id: source.id }
    });
    revalidateWebinar(webinar.id);

    return { created: true, session: sessionFromRow(created) };
  });
}

/** [messaging.write] Fecha o Replay livre (a sessao `replay` vira cancelada; "Liberar o replay" reabre a mesma). */
export async function cancelReplaySession(input: { webinarId: string }): Promise<ActionResult<{ sessionId: string }>> {
  return runAdminAction("messaging.write", createReplaySessionSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const nowIso = new Date().toISOString();
    const webinar = await requireWebinarRow(db, data.webinarId);
    const replay = (await listSessionRows(db, [webinar.id])).find((session) => session.kind === "replay" && session.status !== "cancelled");

    if (!replay) {
      throw new WebinarError(REPLAY_MISSING_MESSAGE, 404);
    }

    await updateSessionRow(db, replay.id, { ended_at: nowIso, status: "cancelled" });
    await recordAudit(db, { action: "webinar.replay_cancelled", actorId: user.id, entityId: webinar.id, entityType: "webinar", metadata: { session_id: replay.id } });
    revalidateWebinar(webinar.id);

    return { sessionId: replay.id };
  });
}

/* ------------------------------------------------------------------------------------------------
 * LGPD: remover as mensagens de um aluno a pedido dele (§8.5)
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.publish] A pedido do aluno: as mensagens, perguntas e respostas de enquete dele somem de todas as
 * sessoes (consent_revoked) e o aceite e retirado; o historico recebe webinar_chat_consented { revoked: true }. O
 * motivo do pedido fica na auditoria (§5.2).
 */
export async function removeStudentMessages(input: { reason: string; userId: string }): Promise<ActionResult<RemovedStudentContent>> {
  return runAdminAction("messaging.publish", removeStudentMessagesSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const nowIso = new Date().toISOString();
    const consent = await fetchConsentRow(db, data.userId);
    const counts = await softDeleteStudentContent(db, { nowIso, reason: "consent_revoked", userId: data.userId });
    const consentRevoked = await revokeConsentRow(db, data.userId, nowIso);

    if (consent) {
      await recordEvents(db, [
        { entity_type: "webinar", event_type: "webinar_chat_consented", metadata: { by_team: true, consent_version: consent.consent_version, revoked: true }, user_id: data.userId }
      ]);
    }

    await recordAudit(db, {
      action: "webinar.student_messages_removed",
      actorId: user.id,
      count: counts.messages,
      entityId: data.userId,
      entityType: "student",
      metadata: { ...counts, consent_revoked: consentRevoked, reason: data.reason }
    });
    invalidateReport();

    return { ...counts, consentRevoked };
  });
}
