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
// resposta da equipe a uma mensagem do chat; banco sem a 202610300004: a resposta segue e so a marca fica de fora.
// A Na tela (docs/30 §2.4; especificacao de 10/11/2026, §5.3): o "Fixar ao enviar" (sendTeamMessage com `pin`) usa a
// mesma rotina de fixar do moderateMessage (pinMessage: a fixada de antes perde o pinned_at e a linha da sessao ganha o
// pinned_message_id por ultimo, o carimbo que a consulta de 5 s da sala compara); fixar so na sessao que ainda aceita a
// equipe, desafixar sempre. A enquete fixada (R2) e a exibicao `poll` de webinar_screen_displays: pinPoll (uma copia
// desta sessao, aberta ou encerrada com o resultado compartilhado; a fixada de antes sai como `replaced`), unpinPoll
// (`team`), o "Abrir e fixar" (launchPoll com `pin`) e o Encerrar sem compartilhar, que desafixa (`poll_closed`; com o
// resultado compartilhado ela continua fixada, agora com as barras). Toda troca muda o carimbo da sessao por ultimo.
// No Replay e na sessao encerrada ou cancelada, 409; banco sem a 202611100002, 409 com o aviso da migracao.
// A "Nova enquete" do console (11/11/2026, D83): createConsolePoll cria UMA enquete pronta no fim das prontas (nunca
// pelo savePolls, que troca a lista inteira), dentro do teto, e abre ou abre e fixa pelo mesmo caminho do Abrir
// (openTemplatePoll); o savePolls do editor so apaga dos modelos que o card carregou, entao ela fica.

import { revalidatePath } from "next/cache";
import { GENERIC_ACTION_ERROR, toActionError, type ActionErrorStatus, type ActionResult } from "@/lib/action-result";
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
import { chatMessageFromRow, pollFromRow, questionFromRow, questionReplyFromRow, type ChatMessageRow, type PollOptionRow, type PollRow } from "./chat-rows";
import {
  answerQuestionSchema,
  CHAT_MESSAGES,
  closePollSchema,
  createConsolePollSchema,
  createReplaySessionSchema,
  deleteQuestionReplySchema,
  launchPollSchema,
  moderateMessageSchema,
  questionStatusSchema,
  removeStudentMessagesSchema,
  replyQuestionSchema,
  savePollsSchema,
  saveSimulationSchema,
  sessionChatModeSchema,
  sessionIdInputSchema,
  teamChatSchema,
  type ConsolePollLaunch,
  type ModerationAction
} from "./chat-schemas";
import {
  countQuestionReplyRows,
  deletePollRow,
  fetchChatMessageRow,
  fetchConsentRow,
  fetchPollRow,
  fetchQuestionReplyRow,
  fetchQuestionRow,
  fetchQuestionRowByMessage,
  insertChatMessage,
  insertPollRow,
  insertQuestionReplyRow,
  insertQuestionRow,
  listPollRows,
  replacePollOptionRows,
  revokeConsentRow,
  softDeleteQuestionReplyRow,
  softDeleteQuestionsOfMessage,
  softDeleteStudentContent,
  updateChatMessageRow,
  updatePollRow,
  updateQuestionRow,
  type ChatMessagePatch
} from "./chat-store";
import { ackSentenceMatches, canEndSession, canOpenSession, canTeamActOn, consoleAckSentence } from "./console-model";
import { isMissingWebinarSchema, WEBINARS_MIGRATION, WEBINARS_SCREEN_MIGRATION, WebinarError, WebinarFieldError, webinarsDb, type WebinarsDb } from "./db";
import { roomRoleFor } from "./jitsi-token";
import {
  CHAT_LIMITS,
  chatConsentAllowsReplay,
  type ChatMessage,
  type ChatMode,
  type Poll,
  type PollDraft,
  type PollKind,
  type PresenceSummary,
  type QuestionReply,
  type SlowModeSeconds,
  questionBodyOf,
  type WebinarQuestion,
  type WebinarSession
} from "./model";
import { queueWebinarAnswerNotice } from "./notify";
import { baseRecordingOf } from "./queries";
import { anonymousDisplayName, sessionOffsetMs, teamAuthorName } from "./room-model";
import { questionReplyRefusal, questionSentMetadata } from "./room-rules";
import { presenterFromRow, sessionFromRow, type SessionRow, type WebinarRow } from "./rows";
import { pollPinnable } from "./screen-model";
import type { ScreenDisplayHide } from "./screen-rows";
import { pinPollSchema, pollPinSnapshotSchema, unpinPollSchema } from "./screen-schemas";
import { hideActiveScreenDisplayRows, readActiveScreenDisplayRows, showScreenDisplayRow } from "./screen-store";
import { fetchSessionSimulation } from "./simulation-store";
import { finishSession, openSession } from "./session-lifecycle";
import { assertWebinarNotArchived, fetchSessionRow, insertSessionRows, listPresenterRows, listRecordingRows, listSessionRows, requireWebinarRow, touchSessionRow, updateSessionRow } from "./store";

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
const ONLY_AUDIENCE_QUESTION_MESSAGE = "Só uma mensagem de aluno da turma vira pergunta.";
const POLL_MISSING_MESSAGE = "Essa enquete não existe mais.";
const POLL_NOT_TEMPLATE_MESSAGE = "Essa enquete já é de uma sessão; abra pelo modelo.";
const POLL_NOT_OPEN_MESSAGE = "Essa enquete não está aberta.";
const QUESTION_MISSING_MESSAGE = "Essa pergunta não existe mais.";
const ANSWER_MISSING_MESSAGE = "Escreva a resposta ou marque Respondida ao vivo.";
const REPLY_NEEDS_ANSWER_MESSAGE = "Responda a pergunta antes de continuar a conversa.";
const REPLY_FULL_MESSAGE = "Esta conversa chegou ao limite de respostas.";
const REPLY_MISSING_MESSAGE = "Essa resposta não existe mais.";
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
export type RepliedQuestion = { notified: boolean; reply: QuestionReply };
export type SavedSimulation = { deciderName: string; session: WebinarSession };
export type ReplayCreated = { created: boolean; session: WebinarSession };
export type RemovedStudentContent = { answers: number; consentRevoked: boolean; messages: number; questions: number };
/** A enquete fixada (`changed` falso: ela ja era a fixada, nada mudou). */
export type PinnedPoll = { changed: boolean; displayId: string; pollId: string; sessionId: string };
/** A enquete desafixada (`unpinned` falso: nao havia enquete fixada). */
export type UnpinnedPoll = { pollId: string | null; sessionId: string; unpinned: boolean };
/**
 * A "Nova enquete" do console (D83): `poll` e a pronta criada; `launched` a copia aberta nesta sessao (nula no "Guardar
 * nas prontas" ou quando abrir falhou depois de guardar, com a frase e o status em `launchError`); `pinned` se ficou
 * fixada.
 */
export type CreatedConsolePoll = { launchError: { message: string; status: ActionErrorStatus } | null; launched: Poll | null; pinned: boolean; poll: Poll };

/** O maior `position` que o check da 202610290001 aceita numa enquete. */
const POLL_POSITION_MAX = 10_000;

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

/** Uma escrita no fio que esbarra no banco sem a 202611100001 vira 409 com a frase da migracao (nunca um 500 generico). */
async function withReplyTable<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isPendingMigrationError(error)) {
      throw new WebinarError(WEBINAR_COPY.exportar.migracaoPendente(WEBINARS_MIGRATION), 409);
    }
    throw error;
  }
}

/** O aviso da Na tela no banco sem a 202611100002 (as escritas da enquete fixada). */
const SCREEN_MIGRATION_MESSAGE = WEBINAR_COPY.exportar.migracaoPendente(WEBINARS_SCREEN_MIGRATION);

/** Uma leitura ou escrita da Na tela que esbarra no banco sem a 202611100002 vira 409 com a frase da migracao. */
async function withScreenTables<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isPendingMigrationError(error)) {
      throw new WebinarError(SCREEN_MIGRATION_MESSAGE, 409);
    }
    throw error;
  }
}

/**
 * A sessao aceita uma mudanca na Na tela (fixar e desafixar a enquete): nunca no Replay (la nada aparece na frente da
 * turma) nem na sessao encerrada ou cancelada (a turma ja nao ve nada). 409 com a frase de cada caso.
 */
function assertScreenSession(session: WebinarSession) {
  if (session.kind === "replay") {
    throw new WebinarError(WEBINAR_COPY.naTela.erros.replay, 409);
  }

  if (!canTeamActOn(session)) {
    throw new WebinarError(WEBINAR_COPY.naTela.erros.sessaoFechada, 409);
  }
}

/** Quem tira da tela, quando e em que minuto da sessao (o offset do relogio do servidor), com o motivo. */
function screenHide(session: WebinarSession, userId: string, now: Date, reason: ScreenDisplayHide["hidden_reason"]): ScreenDisplayHide {
  return { hidden_at: now.toISOString(), hidden_by: userId, hidden_offset_ms: serverOffsetMs(session, now.getTime()), hidden_reason: reason };
}

/**
 * Fixa a enquete na sessao (a exibicao `poll` da Na tela, com a copia { v: 1, name: pergunta } conferida pelo zod): a
 * fixada de antes sai como `replaced`, e o conflito do indice unico tenta uma vez mais (showScreenDisplayRow). Quem
 * chama confere a sessao e a enquete e muda o carimbo da sessao depois.
 */
async function pinPollDisplay(db: WebinarsDb, input: { now: Date; poll: { id: string; question: string }; session: WebinarSession; userId: string }): Promise<{ displayId: string; replaced: number }> {
  const snapshot = pollPinSnapshotSchema.parse({ name: input.poll.question, v: 1 });
  const shown = await withScreenTables(() =>
    showScreenDisplayRow(
      db,
      {
        item_id: null,
        kind: "poll",
        poll_id: input.poll.id,
        session_id: input.session.id,
        shown_at: input.now.toISOString(),
        shown_by: input.userId,
        shown_offset_ms: serverOffsetMs(input.session, input.now.getTime()),
        snapshot
      },
      screenHide(input.session, input.userId, input.now, "replaced")
    )
  );

  if (!shown) {
    throw new WebinarError(GENERIC_ACTION_ERROR, 409);
  }

  return { displayId: shown.row.id, replaced: shown.replaced.length };
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

/**
 * O papel da mensagem da equipe no chat (docs/31 V2-A12): `host` para o Apresentador (webinars.host_user_id),
 * `co_host` para quem e co-apresentador do webinario com o prazo valendo (webinar_presenters, pela mesma regra da sala,
 * roomRoleFor) e `team` para o resto. O Apresentador nem le a tabela. O `co_host` pede a migracao 202611010001.
 */
async function teamRoleFor(db: WebinarsDb, input: { nowMs: number; userId: string; webinar: Pick<WebinarRow, "host_user_id" | "id"> }): Promise<"co_host" | "host" | "team"> {
  if (input.webinar.host_user_id === input.userId) {
    return "host";
  }
  const own = (await listPresenterRows(db, [input.webinar.id])).filter((row) => row.user_id === input.userId);
  const grant = roomRoleFor({
    hostUserId: null,
    nowMs: input.nowMs,
    presenters: own.map(presenterFromRow),
    staff: true,
    userId: input.userId,
    validUntilByUser: new Map(own.map((row) => [row.user_id, row.valid_until]))
  });
  return grant.role === "co_host" ? "co_host" : "team";
}

function teamDisplayName(user: { email?: string; user_metadata: Record<string, unknown> }) {
  return teamAuthorName(getUserDisplayName(user).fullName);
}

/** Fase 4c: as marcas de atendimento de um alvo; sem a 202610300004 (ou na falha da leitura), nenhuma: a resposta da equipe segue igual. */
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

/** Fase 4c: a pergunta foi respondida pela equipe (answer_source 'team'); sem a 202610300004, nada. */
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
 * Fixa uma mensagem ja liberada na sessao (uma fixada por sessao; quem chama confere a sessao e a mensagem): a mensagem
 * ganha o pinned_at, a fixada de antes perde o dela e a linha da sessao ganha o pinned_message_id POR ULTIMO. Essa
 * escrita muda o carimbo da sessao (o gatilho poe o updated_at), e a sala so troca o estado da Na tela depois de tudo
 * gravado (docs/30 §5.1). Devolve a linha fixada (nula quando a mensagem sumiu no meio).
 */
async function pinMessage(db: WebinarsDb, sessionRow: Pick<SessionRow, "id" | "pinned_message_id">, message: Pick<ChatMessageRow, "id">, nowIso: string): Promise<ChatMessageRow | null> {
  const pinned = await updateChatMessageRow(db, message.id, { pinned_at: nowIso });

  if (!pinned) {
    return null;
  }

  if (sessionRow.pinned_message_id && sessionRow.pinned_message_id !== message.id) {
    await updateChatMessageRow(db, sessionRow.pinned_message_id, { pinned_at: null });
  }

  await updateSessionRow(db, sessionRow.id, { pinned_message_id: message.id });
  return pinned;
}

/**
 * [messaging.write] A mensagem da equipe no chat da sessao: role `host` para o Apresentador, `co_host` para o
 * co-apresentador, `team` para o resto (teamRoleFor), source `team`, aprovada, no offset do relogio do servidor (nunca o
 * do navegador). Com `pin` (o "Fixar ao enviar" do console), depois de gravada ela vira a fixada da sessao pela mesma
 * rotina do Fixar (pinMessage), e a auditoria leva `pinned: true`.
 */
export async function sendTeamMessage(input: {
  body: string;
  kind?: "answer" | "message" | "system";
  pin?: boolean;
  replyToId?: string | null;
  sessionId: string;
}): Promise<ActionResult<{ message: ChatMessage }>> {
  return runAdminAction("messaging.write", teamChatSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { row: sessionRow, session, webinar } = await loadSession(db, data.sessionId);

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

    const role = await teamRoleFor(db, { nowMs: now.getTime(), userId: user.id, webinar });
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
    // O "Fixar ao enviar": a mensagem acabou de nascer aprovada, nesta sessao que aceita a equipe (conferido acima).
    const sent = data.pin ? ((await pinMessage(db, sessionRow, inserted, now.toISOString())) ?? inserted) : inserted;

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
      metadata: { kind: data.kind, message_id: inserted.id, notified, pinned: data.pin, reply: Boolean(data.replyToId), role, session_id: session.id }
    });

    if (data.pin) {
      revalidateConsole(webinar.id);
    }

    return { message: chatMessageFromRow(sent) };
  });
}

/**
 * A pergunta da aba Perguntas feita de uma mensagem do aluno (a pergunta pelo chat moderado ou o Virar pergunta da
 * equipe): o texto cortado em 500 caracteres (o limite da pergunta, sem partir um emoji: questionBodyOf), o
 * `message_id` e anonima quando o nome gravado e o "Aluno {n}" do proprio aluno (legado: linhas de antes de 10/11/2026,
 * D64; a mensagem antiga escrita como anonimo continua com a promessa da epoca, e nenhuma mensagem nova tem esse nome).
 * Sem autor, nada (a pergunta pede o aluno). Quem chama confere antes se a mensagem ja tem pergunta.
 */
async function insertQuestionOfMessage(db: WebinarsDb, message: ChatMessageRow): Promise<{ anonymous: boolean; questionId: string; userId: string } | null> {
  const userId = message.author_user_id;
  if (!userId) {
    return null;
  }
  const anonymous = message.display_name === anonymousDisplayName(userId, message.webinar_id);
  const question = await insertQuestionRow(db, {
    anonymous,
    body: questionBodyOf(message.body),
    display_name: message.display_name,
    message_id: message.id,
    offset_ms: message.offset_ms,
    session_id: message.session_id,
    user_id: userId
  });
  return { anonymous, questionId: question.id, userId };
}

/**
 * A pergunta que o aluno mandou pelo chat moderado so entra na aba Perguntas quando a equipe libera a mensagem
 * (antes disso ninguem alem do autor a ve), com o `webinar_question_sent` no historico do aluno (foi ele que perguntou).
 */
async function openQuestionOfMessage(db: WebinarsDb, message: ChatMessageRow): Promise<void> {
  if (message.kind !== "question" || message.source !== "audience" || !message.author_user_id || (await fetchQuestionRowByMessage(db, message.id))) {
    return;
  }
  const created = await insertQuestionOfMessage(db, message);
  if (!created) {
    return;
  }
  await recordEvents(db, [
    {
      entity_id: message.session_id,
      entity_type: "webinar",
      event_type: "webinar_question_sent",
      metadata: questionSentMetadata({ offsetMs: message.offset_ms, questionId: created.questionId }),
      user_id: created.userId
    }
  ]);
}

/**
 * O Virar pergunta da equipe (docs/31 V2-15) depois da troca da mensagem: a pergunta que o aluno fez pelo chat moderado
 * segue o Liberar (a pergunta e o historico do aluno); a mensagem comum vira pergunta sem o `webinar_question_sent`,
 * porque quem perguntou foi a equipe. A mensagem que ja tem pergunta (apagada ou nao) fica como esta.
 */
async function questionOfMessageByTeam(db: WebinarsDb, message: ChatMessageRow): Promise<void> {
  if (message.kind === "question") {
    await openQuestionOfMessage(db, message);
    return;
  }
  if (!(await fetchQuestionRowByMessage(db, message.id))) {
    await insertQuestionOfMessage(db, message);
  }
}

/**
 * [messaging.write] Moderacao de uma mensagem: liberar (approved + quem e quando; a pergunta pelo chat entra na
 * aba Perguntas so agora), apagar (deleted_at, motivo `team`; some para todos na hora, com a pergunta ligada a ela),
 * fixar e desafixar (pinned_at + webinar_sessions.pinned_message_id, uma por sessao), promover a linha mestre
 * (master + source `original`, so mensagem da turma cujo autor mantem o aceite com o modo de agora:
 * model.chatConsentAllowsReplay) e Virar pergunta (docs/31 V2-15: so mensagem ou pergunta de aluno da turma; a
 * pendente e liberada no mesmo passo). Recusar a pendente e o apagar.
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

    const approvePatch: ChatMessagePatch = { approved: true, approved_at: nowIso, approved_by: user.id };
    // Nulo: nada muda na linha (o Virar pergunta de uma mensagem ja liberada).
    let patch: ChatMessagePatch | null;
    let pinnedMessageId = sessionRow.pinned_message_id;

    switch (data.action) {
      case "approve":
        patch = approvePatch;
        break;
      case "delete":
        patch = { deleted_at: nowIso, deleted_by: user.id, deleted_reason: "team" };
        break;
      case "pin":
        // Fixar e por na frente da turma (a Na tela, docs/30 §2.4): so na sessao que ainda aceita a equipe (o console
        // esconde o botao; um console parado ou o pedido direto numa sessao encerrada, cancelada ou no Replay nao muda
        // nada). Desafixar continua sempre permitido.
        if (!canTeamActOn(sessionFromRow(sessionRow))) {
          throw new WebinarError(SESSION_CLOSED_MESSAGE, 409);
        }
        if (!message.approved) {
          throw new WebinarError(PIN_NEEDS_APPROVAL_MESSAGE, 409);
        }
        // A troca da linha e da sessao e a rotina do Fixar (pinMessage, abaixo), a mesma do "Fixar ao enviar".
        patch = null;
        break;
      case "unpin":
        patch = { pinned_at: null };
        break;
      case "promote": {
        if (message.source !== "audience" || message.master) {
          throw new WebinarError(ONLY_AUDIENCE_PROMOTES_MESSAGE, 409);
        }

        const consent = message.author_user_id ? await fetchConsentRow(db, message.author_user_id) : null;

        // Sem retirada e com o modo de agora: o aceite antigo de apelido ou anonimo (legado: linhas de antes de
        // 10/11/2026, D64) conta como "sem aceite", e a mensagem dele nao vira linha mestre ate o aluno aceitar de novo.
        if (!chatConsentAllowsReplay(consent)) {
          throw new WebinarError(NO_CONSENT_MESSAGE, 409);
        }

        patch = { approved: true, approved_at: message.approved_at ?? nowIso, approved_by: message.approved_by ?? user.id, master: true, source: "original" };
        break;
      }
      case "question":
        // A pergunta pede o aluno (webinar_questions.user_id): nada da equipe, do roteiro, do Assistente, nem resposta.
        if (message.source !== "audience" || !message.author_user_id || (message.kind !== "message" && message.kind !== "question")) {
          throw new WebinarError(ONLY_AUDIENCE_QUESTION_MESSAGE, 409);
        }
        // Uma pergunta nova so na sessao que ainda aceita a equipe (o console esconde o botao; um console parado ou o
        // pedido direto numa sessao encerrada, cancelada ou no Replay nao cria linha nem muda o relatorio).
        if (!canTeamActOn(sessionFromRow(sessionRow))) {
          throw new WebinarError(SESSION_CLOSED_MESSAGE, 409);
        }
        patch = message.approved ? null : approvePatch;
        break;
      default:
        throw new WebinarError("Ação inválida.", 400);
    }

    // O estado de antes da troca (a linha lida pode ser a mesma referencia que a escrita devolve).
    const wasApproved = message.approved;
    const updated = data.action === "pin" ? await pinMessage(db, sessionRow, message, nowIso) : patch ? await updateChatMessageRow(db, message.id, patch) : message;

    if (!updated) {
      throw new WebinarError(MESSAGE_MISSING_MESSAGE, 404);
    }

    if (data.action === "question") {
      await questionOfMessageByTeam(db, updated);
    } else if (data.action === "approve" && !wasApproved) {
      await openQuestionOfMessage(db, updated);
      // A resposta do Assistente que esperava a equipe (chat moderado): a pergunta da aba fica respondida so agora.
      if (message.role === "ai") {
        await answerQuestionOfApprovedAiReply(db, { body: message.body, messageId: message.id, nowIso });
      }
    } else if (data.action === "delete") {
      await softDeleteQuestionsOfMessage(db, { messageId: message.id, nowIso, reason: "team" });
    }

    if (data.action === "pin") {
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

    // Apagar, promover, liberar e virar pergunta mudam as contagens do relatorio (o chat audience/original nao apagado e as perguntas).
    if (data.action === "delete" || data.action === "promote" || data.action === "approve" || data.action === "question") {
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
 * os que tem id, apaga os que sairam. As copias ja lancadas nas sessoes nao mudam. Desde 11/11/2026 (D83) so apaga dos
 * modelos que o card carregou (`loadedIds`): a enquete que o console criou depois (createConsolePoll) fica, e o pedido
 * sem os ids (a pagina de antes) nao apaga nada. O teto (CHAT_LIMITS.pollTemplatesMax) conta o que o card manda mais o
 * que fica sem ele ter carregado: passou, 409 antes de gravar.
 */
export async function savePolls(input: { loadedIds?: string[]; polls: PollDraft[]; webinarId: string }): Promise<ActionResult<SavedPolls>> {
  return runAdminAction("messaging.write", savePollsSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const webinar = await requireWebinarRow(db, data.webinarId);
    assertWebinarNotArchived(webinar);
    const existing = await listPollRows(db, { sessionId: null, webinarId: webinar.id });
    const existingIds = new Set(existing.polls.map((poll) => poll.id));
    const loaded = new Set(data.loadedIds);
    const sentIds = new Set(data.polls.map((draft) => draft.id).filter((id): id is string => Boolean(id && existingIds.has(id))));
    // O que fica sem o card ter carregado (a enquete criada no console depois que a pagina abriu) conta no teto.
    const untouched = existing.polls.filter((poll) => !sentIds.has(poll.id) && !loaded.has(poll.id));

    if (data.polls.length + untouched.length > CHAT_LIMITS.pollTemplatesMax) {
      throw new WebinarError(CHAT_MESSAGES.tooManyPolls, 409);
    }

    const kept = new Set<string>();
    let created = 0;
    let updated = 0;

    for (const [position, draft] of data.polls.entries()) {
      const labels = draft.options.map((option) => option.label);

      if (draft.id && existingIds.has(draft.id)) {
        const ownOptionIds = new Set(existing.options.filter((option) => option.poll_id === draft.id).map((option) => option.id));
        // D64: a enquete salva de agora em diante nunca e anonima (um modelo antigo marcado volta a falso aqui).
        await updatePollRow(db, draft.id, { anonymous: false, kind: draft.kind, position, question: draft.question });
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
          { anonymous: false, created_by: user.id, kind: draft.kind, position, question: draft.question, session_id: null, status: "draft", webinar_id: webinar.id },
          labels
        );
        kept.add(inserted.poll.id);
        created += 1;
      }
    }

    let deleted = 0;

    for (const poll of existing.polls) {
      if (!kept.has(poll.id) && loaded.has(poll.id)) {
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
 * Abre a enquete pronta na sessao, o caminho unico do Abrir, do "Abrir e fixar" e da "Nova enquete" do console (D83):
 * a copia do modelo (session_id, template_poll_id) nasce aberta, com a hora e o minuto do video. Uma copia aberta do
 * mesmo modelo na mesma sessao nao duplica: volta a que existe. Com `pin` (o "Abrir e fixar" do console, R2), a copia
 * vira a enquete fixada da sessao (a de antes sai como `replaced`); banco sem a 202611100002: 409 com o aviso da
 * migracao antes de qualquer escrita. O carimbo da sessao muda por ultimo, mesmo quando o fixar falha depois de a
 * enquete nascer (a turma ve a enquete aberta de qualquer jeito). Quem chama confere a sessao (canTeamActOn) e o modelo
 * (do webinario da sessao, sem sessao).
 */
async function openTemplatePoll(
  db: WebinarsDb,
  input: { now: Date; pin: boolean; session: WebinarSession; template: { options: PollOptionRow[]; poll: PollRow }; userId: string; webinarId: string }
): Promise<{ pinned: boolean; poll: Poll }> {
  const { now, session, template, userId, webinarId } = input;
  // O "Abrir e fixar" le o que esta na tela antes de gravar: sem a migracao, nada nasce (409 com o aviso).
  const pinnedNow = input.pin ? (await withScreenTables(() => readActiveScreenDisplayRows(db, session.id))).find((row) => row.kind === "poll")?.poll_id ?? null : null;
  const launched = await listPollRows(db, { sessionId: session.id, webinarId });
  const open = launched.polls.find((poll) => poll.template_poll_id === template.poll.id && poll.status === "open");

  if (open) {
    if (!input.pin || pinnedNow === open.id) {
      return { pinned: pinnedNow === open.id, poll: pollFromRow(open, launched.options) };
    }

    // A copia aberta ja existe: o "Abrir e fixar" so fixa (o Fixar da enquete em "Nesta sessão").
    const shown = await pinPollDisplay(db, { now, poll: { id: open.id, question: open.question }, session, userId });
    await touchSessionRow(db, session.id);
    await recordAudit(db, {
      action: "webinar.poll_pinned",
      actorId: userId,
      entityId: webinarId,
      entityType: "webinar",
      metadata: { display_id: shown.displayId, poll_id: open.id, replaced: shown.replaced, session_id: session.id }
    });
    revalidateConsole(webinarId);
    invalidateReport();
    return { pinned: true, poll: pollFromRow(open, launched.options) };
  }

  const created = await insertPollRow(
    db,
    {
      // D64: a copia lancada nunca e anonima, mesmo de um modelo antigo marcado (legado: so as copias de antes continuam).
      anonymous: false,
      created_by: userId,
      kind: template.poll.kind,
      open_offset_ms: serverOffsetMs(session, now.getTime()),
      opened_at: now.toISOString(),
      position: template.poll.position,
      question: template.poll.question,
      session_id: session.id,
      status: "open",
      template_poll_id: template.poll.id,
      webinar_id: webinarId
    },
    template.options.map((option) => option.label)
  );

  // O "Abrir e fixar": a copia nova vira a fixada. A falha (o conflito do indice unico duas vezes) nao desfaz a enquete
  // aberta: o carimbo e a auditoria seguem e so depois o 409 sobe.
  let shown: { displayId: string; replaced: number } | null = null;
  let pinFailure: unknown = null;

  if (input.pin) {
    try {
      shown = await pinPollDisplay(db, { now, poll: { id: created.poll.id, question: created.poll.question }, session, userId });
    } catch (failure) {
      pinFailure = failure;
    }
  }

  // O carimbo por ultimo (a enquete ja gravada): a sala rele as enquetes em 5 a 10 s (o pollsKey da Na tela mudou).
  await touchSessionRow(db, session.id);
  await recordAudit(db, {
    action: "webinar.poll_launched",
    actorId: userId,
    entityId: webinarId,
    entityType: "webinar",
    metadata: {
      poll_id: created.poll.id,
      session_id: session.id,
      template_poll_id: template.poll.id,
      ...(input.pin ? { display_id: shown?.displayId ?? null, pinned: shown !== null, replaced: shown?.replaced ?? 0 } : {})
    }
  });
  revalidateConsole(webinarId);
  invalidateReport();

  if (pinFailure) {
    throw pinFailure;
  }

  return { pinned: shown !== null, poll: pollFromRow(created.poll, created.options) };
}

/**
 * [messaging.write] Abre uma enquete pronta na sessao pelo caminho unico (openTemplatePoll): so na sessao que aceita a
 * equipe e so um modelo do webinario da sessao (nunca uma copia). Com `pin`, o "Abrir e fixar" das prontas (R2).
 */
export async function launchPoll(input: { pin?: boolean; pollId: string; sessionId: string }): Promise<ActionResult<{ pinned: boolean; poll: Poll }>> {
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

    return openTemplatePoll(db, { now, pin: data.pin, session, template, userId: user.id, webinarId: webinar.id });
  });
}

/**
 * [messaging.write, a permissao do savePolls] A "Nova enquete" do console (D83; pedido do produtor de 11/11/2026, na
 * Live ao vivo e na gravada): cria UMA enquete pronta no fim das prontas do webinario da sessao (nunca troca a lista
 * inteira, entao o que outra pessoa da equipe criou ao mesmo tempo fica), dentro do teto CHAT_LIMITS.pollTemplatesMax
 * (409 antes de gravar; depois de gravar, conta de novo: na corrida que passou do teto, quem passou desfaz a propria e
 * recebe o mesmo 409). Com `launch` "open" ou "pin", abre (e fixa) na sessao pelo caminho do Abrir (openTemplatePoll),
 * so com a sessao aceitando a equipe e, no fixar, com a 202611100002 (os dois conferidos antes de gravar: nada nasce).
 * Webinario arquivado, 409. Se abrir falha depois de a enquete entrar nas prontas, ela fica la e o resultado volta com
 * `launchError` (a frase para o aviso do console) em vez de falhar: o formulario fecha sem criar outra numa segunda
 * tentativa. Auditoria `webinar.poll_created` so com ids e contagens (nunca a pergunta).
 */
export async function createConsolePoll(input: {
  kind: PollKind;
  launch?: ConsolePollLaunch;
  options: { label: string }[];
  question: string;
  sessionId: string;
}): Promise<ActionResult<CreatedConsolePoll>> {
  return runAdminAction("messaging.write", createConsolePollSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { session, webinar } = await loadSession(db, data.sessionId);
    assertWebinarNotArchived(webinar);

    if (data.launch !== "save" && !canTeamActOn(session)) {
      throw new WebinarError(SESSION_CLOSED_MESSAGE, 409);
    }

    if (data.launch === "pin") {
      // Sem a 202611100002, o "Abrir e fixar" recusa antes de a enquete nascer (como o das prontas).
      await withScreenTables(() => readActiveScreenDisplayRows(db, session.id));
    }

    const before = await listPollRows(db, { sessionId: null, webinarId: webinar.id });

    if (before.polls.length >= CHAT_LIMITS.pollTemplatesMax) {
      throw new WebinarError(CHAT_MESSAGES.tooManyPolls, 409);
    }

    const position = Math.min(POLL_POSITION_MAX, before.polls.reduce((max, poll) => Math.max(max, poll.position + 1), 0));
    const template = await insertPollRow(
      db,
      // D64: nunca anonima.
      { anonymous: false, created_by: user.id, kind: data.kind, position, question: data.question, session_id: null, status: "draft", webinar_id: webinar.id },
      data.options.map((option) => option.label)
    );

    // Duas pessoas da equipe criando ao mesmo tempo perto do teto: quem passou dele desfaz a propria.
    const after = await listPollRows(db, { sessionId: null, webinarId: webinar.id });

    if (after.polls.length > CHAT_LIMITS.pollTemplatesMax) {
      await deletePollRow(db, template.poll.id);
      throw new WebinarError(CHAT_MESSAGES.tooManyPolls, 409);
    }

    await recordAudit(db, {
      action: "webinar.poll_created",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { kind: data.kind, launch: data.launch, options: template.options.length, poll_id: template.poll.id, session_id: session.id }
    });
    revalidateWebinar(webinar.id);

    let opened: { pinned: boolean; poll: Poll } | null = null;
    let launchError: CreatedConsolePoll["launchError"] = null;

    if (data.launch !== "save") {
      try {
        opened = await openTemplatePoll(db, { now, pin: data.launch === "pin", session, template, userId: user.id, webinarId: webinar.id });
      } catch (failure) {
        const refused = toActionError(failure);
        if (refused.status === 500) {
          console.error(`[webinarios] enquete do console guardada, mas nao aberta: ${failure instanceof Error ? failure.message : String(failure)}`);
        }
        launchError = { message: refused.error, status: refused.status };
      }
    }

    return { launchError, launched: opened?.poll ?? null, pinned: opened?.pinned ?? false, poll: pollFromRow(template.poll, template.options) };
  });
}

/**
 * A enquete encerrada sem o resultado compartilhado some para a turma (room-rules.studentPollOf): se ela estava fixada,
 * sai da tela tambem (`poll_closed`). Devolve quantas exibicoes sairam; banco sem a 202611100002, nenhuma (nada podia
 * estar fixado).
 */
async function unpinClosedPoll(db: WebinarsDb, input: { now: Date; pollId: string; sessionId: string; userId: string }): Promise<number> {
  try {
    const sessionRow = await fetchSessionRow(db, input.sessionId);
    const hide: ScreenDisplayHide = sessionRow
      ? screenHide(sessionFromRow(sessionRow), input.userId, input.now, "poll_closed")
      : { hidden_at: input.now.toISOString(), hidden_by: input.userId, hidden_offset_ms: null, hidden_reason: "poll_closed" };
    return (await hideActiveScreenDisplayRows(db, { kind: "poll", pollId: input.pollId, sessionId: input.sessionId }, hide)).length;
  } catch (error) {
    if (isPendingMigrationError(error)) {
      return 0;
    }
    throw error;
  }
}

/**
 * [messaging.write] Encerra a enquete aberta (e, se pedido, compartilha o resultado com a turma). Encerrada sem
 * compartilhar, a enquete fixada sai da tela (`poll_closed`); com o resultado compartilhado ela continua fixada, agora
 * com as barras. O carimbo da sessao muda por ultimo.
 */
export async function closePoll(input: { pollId: string; sessionId: string; shareResults?: boolean }): Promise<ActionResult<{ poll: Poll; unpinned: boolean }>> {
  return runAdminAction("messaging.write", closePollSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const nowIso = now.toISOString();
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

    // Encerrada sem o resultado compartilhado, a turma ja nao ve a enquete: a fixada sai da tela antes do carimbo.
    const unpinned = row.session_id && row.status === "closed" && !row.results_shared_at ? await unpinClosedPoll(db, { now, pollId: row.id, sessionId: row.session_id, userId: user.id }) : 0;

    // O carimbo por ultimo (encerrar ou compartilhar ja gravado): a sala rele as enquetes em 5 a 10 s.
    if (row.session_id) {
      await touchSessionRow(db, row.session_id);
    }
    await recordAudit(db, {
      action: "webinar.poll_closed",
      actorId: user.id,
      entityId: row.webinar_id,
      entityType: "webinar",
      metadata: { poll_id: row.id, session_id: row.session_id, shared: Boolean(row.results_shared_at), unpinned: unpinned > 0 }
    });
    revalidateConsole(row.webinar_id);
    invalidateReport();

    return { poll: pollFromRow(row, found.options), unpinned: unpinned > 0 };
  });
}

/**
 * [messaging.write] Fixa uma enquete da sessao (R2): uma copia desta sessao, aberta ou encerrada com o resultado
 * compartilhado (screen-model.pollPinnable). A fixada de antes sai como `replaced`; a mesma enquete ja fixada nao muda
 * nada. Replay, sessao encerrada ou cancelada: 409. Banco sem a 202611100002: 409 com o aviso da migracao. O carimbo da
 * sessao muda por ultimo; auditoria `webinar.poll_pinned`.
 */
export async function pinPoll(input: { pollId: string; sessionId: string }): Promise<ActionResult<PinnedPoll>> {
  return runAdminAction("messaging.write", pinPollSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { session, webinar } = await loadSession(db, data.sessionId);

    assertScreenSession(session);

    const found = await fetchPollRow(db, data.pollId);

    if (!found || found.poll.session_id !== session.id) {
      throw new WebinarError(POLL_MISSING_MESSAGE, 404);
    }

    const poll = pollFromRow(found.poll, found.options);

    if (!pollPinnable(poll)) {
      throw new WebinarError(WEBINAR_COPY.naTela.erros.enqueteNaoFixa, 409);
    }

    const current = (await withScreenTables(() => readActiveScreenDisplayRows(db, session.id))).find((row) => row.kind === "poll");

    if (current?.poll_id === poll.id) {
      return { changed: false, displayId: current.id, pollId: poll.id, sessionId: session.id };
    }

    const shown = await pinPollDisplay(db, { now, poll, session, userId: user.id });

    await touchSessionRow(db, session.id);
    await recordAudit(db, {
      action: "webinar.poll_pinned",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { display_id: shown.displayId, poll_id: poll.id, replaced: shown.replaced, session_id: session.id }
    });
    revalidateConsole(webinar.id);
    invalidateReport();

    return { changed: true, displayId: shown.displayId, pollId: poll.id, sessionId: session.id };
  });
}

/**
 * [messaging.write] Desafixa a enquete fixada da sessao (motivo `team`): ela continua aberta na aba Enquetes da turma,
 * so sai da area das fixadas. Sem enquete fixada, nada muda. Replay, sessao encerrada ou cancelada: 409. O carimbo da
 * sessao muda por ultimo; auditoria `webinar.poll_unpinned`.
 */
export async function unpinPoll(input: { sessionId: string }): Promise<ActionResult<UnpinnedPoll>> {
  return runAdminAction("messaging.write", unpinPollSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { session, webinar } = await loadSession(db, data.sessionId);

    assertScreenSession(session);

    const hidden = await withScreenTables(() => hideActiveScreenDisplayRows(db, { kind: "poll", sessionId: session.id }, screenHide(session, user.id, now, "team")));

    if (hidden.length === 0) {
      return { pollId: null, sessionId: session.id, unpinned: false };
    }

    await touchSessionRow(db, session.id);
    await recordAudit(db, {
      action: "webinar.poll_unpinned",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { display_id: hidden[0].id, poll_id: hidden[0].poll_id, session_id: session.id }
    });
    revalidateConsole(webinar.id);
    invalidateReport();

    return { pollId: hidden[0].poll_id, sessionId: session.id, unpinned: true };
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
    // O papel antes de gravar: uma falha ao ler webinar_presenters nao deixa a pergunta respondida sem a linha do chat.
    const role = answerText ? await teamRoleFor(db, { nowMs: now.getTime(), userId: user.id, webinar }) : null;
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

    if (answerText && role && offset !== null && canTeamActOn(session)) {
      const inserted = await insertChatMessage(db, {
        approved: true,
        author_user_id: user.id,
        body: answerText,
        display_name: teamDisplayName(user),
        kind: "answer",
        master: session.kind === "live",
        offset_ms: offset,
        reply_to_id: question.message_id,
        role,
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

/**
 * [messaging.write] A equipe continua a conversa no fio de uma pergunta ja respondida (docs/30 §2.4; decisao do produtor
 * de 10/11/2026): a resposta entra no fio (webinar_question_replies) com o papel de quem escreve (Apresentador,
 * Co-apresentador ou Equipe) e so aparece na aba Perguntas, nao no chat. A primeira resposta continua sendo o
 * "Responder por escrito" (answerQuestion): aqui a pergunta precisa estar respondida. Fora da sala (a sessao acabou ou o
 * aluno saiu), a resposta vai tambem para o sino dele, uma vez por resposta.
 */
export async function replyToQuestion(input: { body: string; questionId: string }): Promise<ActionResult<RepliedQuestion>> {
  return runAdminAction("messaging.write", replyQuestionSchema, input, async ({ input: data, user }) => withReplyTable(async () => {
    const db = webinarsDb();
    const now = new Date();
    const row = await fetchQuestionRow(db, data.questionId);

    if (!row || row.deleted_at) {
      throw new WebinarError(QUESTION_MISSING_MESSAGE, 404);
    }

    const question = questionFromRow(row);
    const refusal = questionReplyRefusal({ question, replies: await countQuestionReplyRows(db, question.id), staff: true, userId: user.id });

    if (refusal) {
      throw new WebinarError(refusal === "full" ? REPLY_FULL_MESSAGE : REPLY_NEEDS_ANSWER_MESSAGE, 409);
    }

    const { session, webinar } = await loadSession(db, question.sessionId);
    const role = await teamRoleFor(db, { nowMs: now.getTime(), userId: user.id, webinar });
    const reply = questionReplyFromRow(
      await insertQuestionReplyRow(db, { anonymous: false, body: data.body, display_name: teamDisplayName(user), question_id: question.id, role, session_id: session.id, user_id: user.id })
    );
    const notified = await noticeTeamAnswer(db, { answerText: data.body, handoffRequested: false, now, session, targetId: reply.id, userId: question.userId });

    await recordAudit(db, {
      action: "webinar.question_replied",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { notified, question_id: question.id, reply_id: reply.id, session_id: session.id }
    });
    revalidateConsole(webinar.id);

    return { notified, reply };
  }));
}

/** [messaging.write] Apaga uma resposta do fio (a do aluno ou a da equipe); o resto do fio fica. */
export async function deleteQuestionReply(input: { replyId: string }): Promise<ActionResult<{ questionId: string; replyId: string }>> {
  return runAdminAction("messaging.write", deleteQuestionReplySchema, input, async ({ input: data, user }) => withReplyTable(async () => {
    const db = webinarsDb();
    const row = await fetchQuestionReplyRow(db, data.replyId);

    if (!row || row.deleted_at) {
      throw new WebinarError(REPLY_MISSING_MESSAGE, 404);
    }

    const sessionRow = await fetchSessionRow(db, row.session_id);
    await softDeleteQuestionReplyRow(db, { deletedBy: user.id, id: row.id, nowIso: new Date().toISOString(), reason: "team" });
    await recordAudit(db, {
      action: "webinar.question_reply_deleted",
      actorId: user.id,
      entityId: sessionRow?.webinar_id ?? null,
      entityType: "webinar",
      metadata: { by_student: row.role === "student", question_id: row.question_id, reply_id: row.id, session_id: row.session_id }
    });

    if (sessionRow) {
      revalidateConsole(sessionRow.webinar_id);
    }

    return { questionId: row.question_id, replyId: row.id };
  }));
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
    // pelo card novo (saveSessionSimulation). Banco sem a 202610300003: nao ha regra, segue a fase 2.
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

/** A sessao tem contador, entradas ou avisos de venda simulados (colunas da 202610300003; sem elas, false). */
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
    assertWebinarNotArchived(webinar);
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
    assertWebinarNotArchived(webinar);
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
