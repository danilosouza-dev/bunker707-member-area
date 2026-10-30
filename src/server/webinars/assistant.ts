// O Assistente de IA respondendo no chat (docs/30 §1.6, §6.6, §3.4 e D24; fase 4c). Roda DEPOIS da resposta do POST
// /chat e do POST /questions (after() do Next 16, pela afterReply de room-route.ts; fora de um pedido do Next, na
// hora), com o teto ASSISTANT_LIMITS.timeoutMs, e nunca lanca: a falha fica no pedido (webinar_ai_requests, `failed`
// com o codigo) e no log, nada e gravado no chat. A ordem: ambiente e webinario ligados, chamado (assistant-model),
// autor fora da equipe, um pedido por alvo (o mesmo alvo duas vezes nao responde de novo), os limites do minuto por
// aluno e por sessao, o modo hibrido (sem "Responder tudo", a pergunta da aba vai para quem esta atendendo; o
// Assistente so cobre quando ninguem atende), quem assumiu e o "Falar com a equipe", a conexao de IA; depois o MATERIAL
// e o provedor (com os limites diario e mensal de Configuracoes › IA, os do Tutor); e, logo antes de gravar, quem
// assumiu, o "Falar com a equipe" e o modo do chat de novo. O texto do modelo nunca entra cru: link, e-mail ou valor
// que nao esta no MATERIAL vira a frase de nao sei (safeAssistantReply) e a palavra bloqueada tambem. O modo do chat
// manda (assistantPublishMode): fechado ou so da equipe, o Assistente cala; moderado, a resposta vai para a fila da
// equipe (approved falso; a pergunta da aba so fica respondida quando a equipe libera, moderateMessage); aberto, a
// resposta entra como role 'ai', source 'ai', kind 'answer', respondendo a mensagem do aluno, com o nome
// "Assistente", aprovada e master SEMPRE falso (excecao a D31: nem na Live ao vivo a resposta entra na linha mestre sem
// a equipe), e na pergunta da aba Perguntas tambem marca a pergunta respondida (answered_by nulo, answer_source 'ai').
// O pedido nunca guarda texto.
// Tambem aqui: o "Falar com a equipe" do aluno (so na propria mensagem ou pergunta; 404 no resto).

import "server-only";

import { isPendingMigrationError } from "../db/pending-migration";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import {
  ASSISTANT_DISPLAY_NAME,
  assistantCallOf,
  assistantDecision,
  assistantQuestionText,
  assistantReplyBody,
  assistantPublishMode,
  assistantReplyOffsetMs,
  attendanceBlock,
  attendantIsOnline,
  distributeQueue,
  mentionsAssistant,
  safeAssistantReply,
  type AssistantTrigger
} from "./assistant-model";
import { AssistantProviderError, gatewayAssistantProvider, hasActiveAiConnection, type AssistantProvider } from "./assistant-provider";
import { isWebinarStaff, listAssignedOpenQuestions, loadAssistantContext } from "./assistant-queries";
import {
  assignAttendance,
  countAiRequestsSince,
  fetchAssistantSettings,
  fetchAttendanceMarks,
  fetchSessionReplyAll,
  finishAiRequest,
  insertAiRequest,
  listAttendants,
  requestHandoff,
  setQuestionAnswerSource,
  type AiRequestFinish
} from "./assistant-store";
import { fetchChatMessageRow, fetchQuestionRow, fetchQuestionRowByMessage, insertChatMessage } from "./chat-store";
import { WebinarError, assertNoDbError, webinarsDb, type WebinarsDb } from "./db";
import { ASSISTANT_LIMITS, type AssistantSkipReason, type AssistantTarget, type AttendanceMarks } from "./model";
import { sessionOffsetMs } from "./room-model";
import { afterReply } from "./room-route";
import { blockedTermIn } from "./room-writes";
import type { RoomContext } from "./room-queries";
import { sessionFromRow, webinarFromRow } from "./rows";
import { fetchSessionRow, fetchWebinarRow } from "./store";
import { webinarAssistantEnabled } from "./v4-env";

type Env = Record<string, string | undefined>;

const COPY = WEBINAR_COPY.assistente;

/** O que o teste (ou um script) troca: o banco, o relogio, o ambiente, o provedor, a conexao de IA e o teto de tempo. */
export type AssistantDeps = {
  aiAvailable?: (db: WebinarsDb) => Promise<boolean>;
  db?: WebinarsDb;
  env?: Env;
  now?: () => number;
  provider?: AssistantProvider;
  timeoutMs?: number;
};

export type AssistantOutcome =
  | { reason: "disabled" | "duplicate" | "not_called" | "pending_migration"; status: "ignored" }
  | { reason: AssistantSkipReason; requestId: string; status: "skipped" }
  | { errorCode: string; requestId: string | null; status: "failed" }
  | { messageId: string; requestId: string; status: "answered" };

const iso = (ms: number) => new Date(ms).toISOString();

/** O teto de tempo de cada resposta, por cima do deadline do gateway (a reserva da conexao tambem conta). */
async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new AssistantProviderError("timeout", "timeout")), Math.max(1, timeoutMs));
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

type TargetState = { messageId: string | null; open: boolean };

/** O alvo como esta agora: a pergunta aberta e nao apagada, ou a mensagem aprovada e nao apagada da mesma sessao. */
async function readTarget(db: WebinarsDb, trigger: AssistantTrigger): Promise<TargetState> {
  if (trigger.target === "question") {
    const row = await fetchQuestionRow(db, trigger.targetId);
    const open = Boolean(row && row.session_id === trigger.sessionId && !row.deleted_at && row.status === "open");
    return { messageId: row?.message_id ?? trigger.messageId, open };
  }
  const row = await fetchChatMessageRow(db, trigger.targetId);
  return { messageId: trigger.targetId, open: Boolean(row && row.session_id === trigger.sessionId && !row.deleted_at && row.approved) };
}

async function readMarks(db: WebinarsDb, trigger: AssistantTrigger): Promise<AttendanceMarks | null> {
  const marks = await fetchAttendanceMarks(db, { ids: [trigger.targetId], target: trigger.target });
  return marks.get(trigger.targetId) ?? null;
}

/**
 * O modo hibrido: com alguem atendendo, a pergunta da aba Perguntas vai para o atendente com menos perguntas abertas
 * (a mesma distribuicao do console, so se ainda estiver sem dono). Devolve se assumiu.
 */
async function handToAttendant(db: WebinarsDb, trigger: AssistantTrigger, nowMs: number): Promise<boolean> {
  const attendants = await listAttendants(db, trigger.sessionId);
  if (!attendants.some((attendant) => attendantIsOnline(attendant, nowMs))) {
    return false;
  }
  const open = (await listAssignedOpenQuestions(db, trigger.sessionId)).filter((item) => item.assignedTo && item.id !== trigger.targetId);
  const items = [...open.map((item) => ({ ...item, target: "question" as AssistantTarget })), { assignedTo: null, createdAt: iso(nowMs), id: trigger.targetId, target: trigger.target }];
  const assignment = distributeQueue({ attendants, items, nowMs }).find((item) => item.id === trigger.targetId && item.target === trigger.target);
  return assignment ? assignAttendance(db, { id: assignment.id, nowIso: iso(nowMs), onlyIfUnassigned: true, target: assignment.target, userId: assignment.userId }) : false;
}

/** Marca a pergunta da aba como respondida pelo Assistente, so se ela ainda estiver aberta. Devolve se marcou. */
async function markQuestionAnswered(db: WebinarsDb, input: { answerText: string; nowIso: string; questionId: string }): Promise<boolean> {
  const { data, error } = await db
    .from("webinar_questions")
    .update({ answer_text: input.answerText, answered_at: input.nowIso, answered_by: null, answered_live: false, status: "answered" })
    .eq("id", input.questionId)
    .eq("status", "open")
    .is("deleted_at", null)
    .select("id");
  assertNoDbError(error, "Webinarios: pergunta respondida pelo assistente");
  return ((data ?? []) as { id: string }[]).length > 0;
}

function failureOf(error: unknown): { code: string; kind: "failed" | "rate_limited" | "timeout" | "unconfigured" } {
  if (error instanceof AssistantProviderError) {
    return { code: error.code, kind: error.kind };
  }
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "generation_failed";
  return { code: code.slice(0, 80), kind: code === "provider_deadline_exceeded" ? "timeout" : "failed" };
}

/**
 * O Assistente diante de uma mensagem ou pergunta da turma. Nunca lanca (roda dentro de after()); devolve o que fez
 * para o teste e o log: ignorado (sem pedido gravado), pulado com o motivo, falhou com o codigo ou respondido.
 */
export async function answerWithAssistant(trigger: AssistantTrigger, deps: AssistantDeps = {}): Promise<AssistantOutcome> {
  const now = deps.now ?? Date.now;
  let db: WebinarsDb | null = null;
  let requestId: string | null = null;
  const finish = async (patch: AiRequestFinish) => {
    if (db && requestId) {
      await finishAiRequest(db, { id: requestId, patch });
    }
  };

  try {
    if (!webinarAssistantEnabled(deps.env)) {
      return { reason: "disabled", status: "ignored" };
    }
    db = deps.db ?? webinarsDb();
    const settings = await fetchAssistantSettings(db, trigger.webinarId);
    if (!settings?.enabled) {
      return { reason: "disabled", status: "ignored" };
    }
    const replyAll = mentionsAssistant(trigger.body) ? false : await fetchSessionReplyAll(db, trigger.sessionId);
    const call = assistantCallOf(trigger, replyAll);
    if (!call) {
      return { reason: "not_called", status: "ignored" };
    }
    const [webinarRow, sessionRow] = await Promise.all([fetchWebinarRow(db, trigger.webinarId), fetchSessionRow(db, trigger.sessionId)]);
    if (!webinarRow || !sessionRow || sessionRow.webinar_id !== trigger.webinarId) {
      return { reason: "not_called", status: "ignored" };
    }
    const webinar = webinarFromRow(webinarRow);
    const session = sessionFromRow(sessionRow);
    if (await isWebinarStaff(db, { userId: trigger.userId, webinar })) {
      return { reason: "not_called", status: "ignored" };
    }

    const opened = await insertAiRequest(db, {
      requested_at: iso(now()),
      session_id: trigger.sessionId,
      target_id: trigger.targetId,
      target_kind: trigger.target,
      user_id: trigger.userId,
      webinar_id: trigger.webinarId
    });
    if (!opened.created || !opened.request) {
      return { reason: "duplicate", status: "ignored" };
    }
    const id = opened.request.id;
    requestId = id;

    const sinceIso = iso(now() - 60_000);
    const [recentByStudent, recentBySession] = await Promise.all([
      countAiRequestsSince(db, { sessionId: trigger.sessionId, sinceIso, userId: trigger.userId }),
      countAiRequestsSince(db, { sessionId: trigger.sessionId, sinceIso })
    ]);
    if (call === "question_tab" && !replyAll) {
      await handToAttendant(db, trigger, now());
    }
    const [marks, target, aiAvailable] = await Promise.all([
      readMarks(db, trigger),
      readTarget(db, trigger),
      (deps.aiAvailable ?? hasActiveAiConnection)(db).catch(() => false)
    ]);
    const decision = assistantDecision({
      aiAvailable,
      authorIsStaff: false,
      call,
      envEnabled: true,
      marks,
      recentBySession,
      recentByStudent,
      settingsEnabled: true,
      targetOpen: target.open
    });
    if (!decision.answer) {
      await finish({ skip_reason: decision.reason, status: "skipped" });
      return { reason: decision.reason, requestId: id, status: "skipped" };
    }
    // Chat fechado ou so da equipe: o Assistente nao fala onde a turma nao fala (nem chama a IA).
    if (assistantPublishMode(session.chatMode) === "silent") {
      await finish({ skip_reason: "disabled", status: "skipped" });
      return { reason: "disabled", requestId: id, status: "skipped" };
    }

    const context = await loadAssistantContext(db, { trigger, webinar });
    const timeoutMs = deps.timeoutMs ?? ASSISTANT_LIMITS.timeoutMs;
    const provider = deps.provider ?? gatewayAssistantProvider;
    const answer = await withTimeout(
      provider.answer({ context, deadlineAt: now() + timeoutMs, question: assistantQuestionText(trigger.body), quota: { db, nowMs: now(), userId: trigger.userId } }),
      timeoutMs
    );
    const written = assistantReplyBody(answer.body);
    if (!written) {
      await finish({ model: answer.model, provider: answer.provider, skip_reason: "empty", status: "skipped" });
      return { reason: "empty", requestId: id, status: "skipped" };
    }
    // O filtro deterministico (link, e-mail, valor fora do MATERIAL) e as palavras bloqueadas: o texto arriscado nunca
    // entra com o selo Assistente; no lugar, a frase de nao sei (que leva ao "Falar com a equipe").
    const safe = safeAssistantReply(written, context);
    const body = safe.risk || (await blockedTermIn(db, safe.body)) ? COPY.naoSei : safe.body;
    if (safe.risk) {
      console.warn(`[webinarios] resposta do Assistente trocada pela frase de nao sei (${safe.risk}) no ${trigger.target} ${trigger.targetId}`);
    }

    // De novo, logo antes de gravar: a equipe pode ter assumido, o aluno pode ter pedido a equipe ou apagado, e o modo
    // do chat pode ter mudado.
    const [marksNow, targetNow, sessionNow] = await Promise.all([readMarks(db, trigger), readTarget(db, trigger), fetchSessionRow(db, trigger.sessionId)]);
    const blocked = attendanceBlock(marksNow, targetNow.open);
    if (blocked) {
      await finish({ model: answer.model, provider: answer.provider, skip_reason: blocked, status: "skipped" });
      return { reason: blocked, requestId: id, status: "skipped" };
    }
    const mode = assistantPublishMode(sessionNow ? sessionFromRow(sessionNow).chatMode : session.chatMode);
    if (mode === "silent") {
      await finish({ model: answer.model, provider: answer.provider, skip_reason: "disabled", status: "skipped" });
      return { reason: "disabled", requestId: id, status: "skipped" };
    }
    const moderated = mode === "moderate";

    const nowMs = now();
    // No chat moderado a pergunta fica aberta ate a equipe liberar a resposta (moderateMessage marca entao).
    if (!moderated && trigger.target === "question" && !(await markQuestionAnswered(db, { answerText: body, nowIso: iso(nowMs), questionId: trigger.targetId }))) {
      await finish({ model: answer.model, provider: answer.provider, skip_reason: "claimed", status: "skipped" });
      return { reason: "claimed", requestId: id, status: "skipped" };
    }
    const reply = await insertChatMessage(db, {
      // Chat moderado: a resposta vai para a fila da equipe, como a mensagem de qualquer um.
      approved: !moderated,
      author_user_id: null,
      body,
      display_name: ASSISTANT_DISPLAY_NAME,
      kind: "answer",
      // Excecao a D31: a resposta do Assistente nunca entra na linha mestre sem a equipe, nem na Live ao vivo.
      master: false,
      offset_ms: assistantReplyOffsetMs({ kind: session.kind, serverOffsetMs: sessionOffsetMs(session, nowMs), targetOffsetMs: trigger.offsetMs }),
      reply_to_id: targetNow.messageId,
      role: "ai",
      session_id: trigger.sessionId,
      source: "ai",
      webinar_id: trigger.webinarId
    });
    if (!moderated && trigger.target === "question") {
      await setQuestionAnswerSource(db, { questionId: trigger.targetId, source: "ai" });
    }
    await finish({ answered_at: iso(now()), model: answer.model, provider: answer.provider, reply_message_id: reply.id, status: "answered" });
    return { messageId: reply.id, requestId: id, status: "answered" };
  } catch (error) {
    if (!requestId && isPendingMigrationError(error)) {
      return { reason: "pending_migration", status: "ignored" };
    }
    const failure = failureOf(error);
    console.error(`[webinarios] o Assistente nao respondeu (${trigger.target} ${trigger.targetId}): ${failure.code}`);
    try {
      await finish(
        failure.kind === "unconfigured" || failure.kind === "rate_limited"
          ? { error_code: failure.code, skip_reason: failure.kind, status: "skipped" }
          : { error_code: failure.code, skip_reason: failure.kind === "timeout" ? "timeout" : null, status: "failed" }
      );
    } catch (finishError) {
      console.error(`[webinarios] pedido ao Assistente nao fechado: ${finishError instanceof Error ? finishError.message : String(finishError)}`);
    }
    if (failure.kind === "rate_limited" && requestId) {
      return { reason: "rate_limited", requestId, status: "skipped" };
    }
    return { errorCode: failure.code, requestId, status: "failed" };
  }
}

/** Agenda o Assistente para depois da resposta (after() do Next; fora de um pedido do Next, na hora). */
export async function scheduleAssistant(trigger: AssistantTrigger | null, deps: AssistantDeps = {}): Promise<boolean> {
  if (!trigger) {
    return false;
  }
  await afterReply(async () => {
    await answerWithAssistant(trigger, deps);
  });
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * "Falar com a equipe"
 * ---------------------------------------------------------------------------------------------- */

export type HandoffResult = { requested: boolean };

/**
 * POST /api/webinars/[id]/handoff: o aluno pede um humano numa mensagem ou pergunta DELE desta sessao (o resto: 404,
 * sem dizer se existe). A pergunta aberta por uma mensagem do chat e a mensagem andam juntas (as duas ganham a marca).
 * Uma vez: pedir de novo devolve `requested: false`. O Assistente cala nesse alvo dali em diante.
 */
export async function requestStudentHandoff(input: { context: Pick<RoomContext, "session">; db: WebinarsDb; id: string; now?: number; target: AssistantTarget; userId: string }): Promise<HandoffResult> {
  const { db, userId } = input;
  const nowIso = iso(input.now ?? Date.now());
  const sessionId = input.context.session.id;
  try {
    if (input.target === "chat") {
      const row = await fetchChatMessageRow(db, input.id);
      if (!row || row.session_id !== sessionId || row.author_user_id !== userId || row.deleted_at) {
        throw new WebinarError(COPY.aluno.naoEncontrada, 404);
      }
      const requested = await requestHandoff(db, { id: row.id, nowIso, target: "chat" });
      const question = await fetchQuestionRowByMessage(db, row.id);
      if (question && !question.deleted_at && question.user_id === userId) {
        await requestHandoff(db, { id: question.id, nowIso, target: "question" });
      }
      return { requested };
    }
    const row = await fetchQuestionRow(db, input.id);
    if (!row || row.session_id !== sessionId || row.user_id !== userId || row.deleted_at) {
      throw new WebinarError(COPY.aluno.naoEncontrada, 404);
    }
    const requested = await requestHandoff(db, { id: row.id, nowIso, target: "question" });
    if (row.message_id) {
      await requestHandoff(db, { id: row.message_id, nowIso, target: "chat" });
    }
    return { requested };
  } catch (error) {
    if (isPendingMigrationError(error)) {
      throw new WebinarError(COPY.aluno.indisponivel, 503);
    }
    throw error;
  }
}
