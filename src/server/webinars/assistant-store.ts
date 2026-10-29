// O Assistente de IA, os atendentes e o modo hibrido no banco (docs/30 §1.6, §2.4, §6.6 e D24; migracao
// 202610300004), pela service role: o Assistente ligado no webinario, as perguntas e respostas cadastradas, o
// "Responder tudo" da sessao, quem esta atendendo, quem assumiu cada pergunta, o "Falar com a equipe" e os pedidos ao
// Assistente (um por mensagem ou pergunta, sem texto). Quem decide se o Assistente responde, monta o contexto e chama o
// gateway de IA e a frente do Assistente (assistant-model.ts / assistant.ts); aqui so o acesso as linhas. Banco sem a
// 202610300004: o erro sobe como PendingMigrationError (WEBINARS_ASSISTANT_MIGRATION).

import "server-only";

import { assertNoDbError, isMissingWebinarSchema, type WebinarsDb } from "./db";
import type { AssistantKnowledgeDraft, AssistantKnowledgeItem, AssistantRequest, AssistantSettings, AssistantSkipReason, AssistantTarget, Attendant, AttendantStatus, AttendanceMarks } from "./model";
import {
  AI_REQUEST_COLUMNS,
  ATTENDANT_COLUMNS,
  KNOWLEDGE_COLUMNS,
  MESSAGE_ATTENDANCE_COLUMNS,
  QUESTION_ATTENDANCE_COLUMNS,
  aiRequestFromRow,
  assistantSettingsOfRow,
  assistantSettingsToRow,
  attendanceMarksFromRow,
  attendantFromRow,
  knowledgeFromRow,
  type AiRequestRow,
  type AttendanceMarksRow,
  type AttendantRow,
  type KnowledgeRow
} from "./rows";

const UNIQUE_VIOLATION = "23505";

/* ------------------------------------------------------------------------------------------------
 * O Assistente no webinario e as perguntas e respostas cadastradas
 * ---------------------------------------------------------------------------------------------- */

export async function fetchAssistantSettings(db: WebinarsDb, webinarId: string): Promise<AssistantSettings | null> {
  const { data, error } = await db.from("webinars").select("id, assistant_settings").eq("id", webinarId).is("deleted_at", null).maybeSingle();
  assertNoDbError(error, "Webinarios: ler assistente");
  const row = (data as { assistant_settings: unknown; id: string } | null) ?? null;
  return row ? assistantSettingsOfRow(row.assistant_settings) : null;
}

export async function saveAssistantSettings(db: WebinarsDb, input: { settings: AssistantSettings; webinarId: string }): Promise<AssistantSettings> {
  const { error } = await db.from("webinars").update({ assistant_settings: assistantSettingsToRow(input.settings) }).eq("id", input.webinarId);
  assertNoDbError(error, "Webinarios: gravar assistente");
  return input.settings;
}

export async function listKnowledge(db: WebinarsDb, webinarId: string): Promise<AssistantKnowledgeItem[]> {
  const { data, error } = await db.from("webinar_assistant_knowledge").select(KNOWLEDGE_COLUMNS).eq("webinar_id", webinarId).order("position", { ascending: true });
  assertNoDbError(error, "Webinarios: ler perguntas e respostas do assistente");
  return ((data ?? []) as KnowledgeRow[]).map(knowledgeFromRow);
}

/**
 * Troca as perguntas e respostas do webinario pela lista do editor (na ordem): atualiza as que tem id, cria as novas
 * e apaga as que sairam. O zod de assistant-schemas.ts ja conferiu tamanhos e o limite.
 */
export async function replaceKnowledge(db: WebinarsDb, input: { items: readonly AssistantKnowledgeDraft[]; userId: string; webinarId: string }): Promise<AssistantKnowledgeItem[]> {
  const current = await listKnowledge(db, input.webinarId);
  const keep = new Set(input.items.map((item) => item.id).filter((id): id is string => Boolean(id)));
  const removed = current.filter((item) => !keep.has(item.id)).map((item) => item.id);
  if (removed.length > 0) {
    const { error } = await db.from("webinar_assistant_knowledge").delete().eq("webinar_id", input.webinarId).in("id", removed);
    assertNoDbError(error, "Webinarios: apagar perguntas do assistente");
  }
  const known = new Set(current.map((item) => item.id));
  for (const [position, item] of input.items.entries()) {
    if (item.id && known.has(item.id)) {
      const { error } = await db
        .from("webinar_assistant_knowledge")
        .update({ answer: item.answer.trim(), position, question: item.question.trim() })
        .eq("id", item.id)
        .eq("webinar_id", input.webinarId);
      assertNoDbError(error, "Webinarios: gravar pergunta do assistente");
    } else {
      const { error } = await db
        .from("webinar_assistant_knowledge")
        .insert({ answer: item.answer.trim(), created_by: input.userId, position, question: item.question.trim(), webinar_id: input.webinarId });
      assertNoDbError(error, "Webinarios: criar pergunta do assistente");
    }
  }
  return listKnowledge(db, input.webinarId);
}

/** Duplicar webinario: o Assistente (desligado no novo, como todo rascunho) e as perguntas e respostas cadastradas. */
export async function copyAssistantToWebinar(db: WebinarsDb, input: { fromWebinarId: string; toWebinarId: string; userId: string }): Promise<number> {
  const settings = await fetchAssistantSettings(db, input.fromWebinarId);
  if (settings) {
    await saveAssistantSettings(db, { settings: { ...settings, enabled: false }, webinarId: input.toWebinarId });
  }
  const items = await listKnowledge(db, input.fromWebinarId);
  await replaceKnowledge(db, { items: items.map((item) => ({ answer: item.answer, question: item.question })), userId: input.userId, webinarId: input.toWebinarId });
  return items.length;
}

/* ------------------------------------------------------------------------------------------------
 * "Responder tudo" na sessao e os atendentes
 * ---------------------------------------------------------------------------------------------- */

export async function fetchSessionReplyAll(db: WebinarsDb, sessionId: string): Promise<boolean> {
  const { data, error } = await db.from("webinar_sessions").select("id, assistant_reply_all").eq("id", sessionId).maybeSingle();
  assertNoDbError(error, "Webinarios: ler responder tudo");
  return (data as { assistant_reply_all: boolean | null } | null)?.assistant_reply_all === true;
}

export async function setSessionReplyAll(db: WebinarsDb, input: { on: boolean; sessionId: string }): Promise<boolean> {
  const { error } = await db.from("webinar_sessions").update({ assistant_reply_all: input.on }).eq("id", input.sessionId);
  assertNoDbError(error, "Webinarios: gravar responder tudo");
  return input.on;
}

/**
 * O "Começar cada sessão com Responder tudo" do webinario, para as sessoes que nascem depois de salvar o card (o
 * editor e o "Começa quando você entra"). Banco sem a 202610300004: false (a coluna nem existe).
 */
export async function replyAllDefaultFor(db: WebinarsDb, webinarId: string): Promise<boolean> {
  try {
    return (await fetchAssistantSettings(db, webinarId))?.replyAllDefault === true;
  } catch (error) {
    if (isMissingWebinarSchema(error)) {
      return false;
    }
    throw error;
  }
}

/** A batida do atendente no console (online / ausente) a cada consulta do retrato. */
export async function upsertAttendant(db: WebinarsDb, input: { nowIso: string; sessionId: string; status: AttendantStatus; userId: string }): Promise<Attendant> {
  const { data, error } = await db
    .from("webinar_attendants")
    .upsert({ last_seen_at: input.nowIso, session_id: input.sessionId, status: input.status, user_id: input.userId }, { onConflict: "session_id,user_id" })
    .select(ATTENDANT_COLUMNS)
    .single();
  assertNoDbError(error, "Webinarios: gravar atendente");
  return attendantFromRow(data as AttendantRow);
}

export async function listAttendants(db: WebinarsDb, sessionId: string): Promise<Attendant[]> {
  const { data, error } = await db.from("webinar_attendants").select(ATTENDANT_COLUMNS).eq("session_id", sessionId).order("created_at", { ascending: true });
  assertNoDbError(error, "Webinarios: ler atendentes");
  return ((data ?? []) as AttendantRow[]).map(attendantFromRow);
}

/* ------------------------------------------------------------------------------------------------
 * Quem assumiu a pergunta e o "Falar com a equipe"
 * ---------------------------------------------------------------------------------------------- */

function tableOf(target: AssistantTarget) {
  return target === "question" ? "webinar_questions" : "webinar_chat_messages";
}

function columnsOf(target: AssistantTarget) {
  return target === "question" ? QUESTION_ATTENDANCE_COLUMNS : MESSAGE_ATTENDANCE_COLUMNS;
}

export async function fetchAttendanceMarks(db: WebinarsDb, input: { ids: readonly string[]; target: AssistantTarget }): Promise<Map<string, AttendanceMarks>> {
  const marks = new Map<string, AttendanceMarks>();
  if (input.ids.length === 0) {
    return marks;
  }
  const columns: string = columnsOf(input.target);
  const { data, error } = await db.from(tableOf(input.target)).select(columns).in("id", [...new Set(input.ids)]);
  assertNoDbError(error, "Webinarios: ler quem assumiu");
  for (const row of (data ?? []) as unknown as AttendanceMarksRow[]) {
    marks.set(row.id, attendanceMarksFromRow(row));
  }
  return marks;
}

/**
 * Assume (ou passa para outro atendente) uma pergunta ou pergunta do chat; `userId` nulo devolve para a fila. Com
 * `onlyIfUnassigned`, so assume quem ainda esta sem dono (a distribuicao automatica nunca tira de quem assumiu).
 * Devolve se mudou.
 */
export async function assignAttendance(db: WebinarsDb, input: { id: string; nowIso: string; onlyIfUnassigned?: boolean; target: AssistantTarget; userId: string | null }): Promise<boolean> {
  let query = db
    .from(tableOf(input.target))
    .update({ assigned_at: input.userId ? input.nowIso : null, assigned_to: input.userId })
    .eq("id", input.id);
  if (input.onlyIfUnassigned) {
    query = query.is("assigned_to", null);
  }
  const { data, error } = await query.select("id");
  assertNoDbError(error, "Webinarios: assumir pergunta");
  return ((data ?? []) as { id: string }[]).length > 0;
}

/** "Falar com a equipe" (o aluno pediu um humano): uma vez; o Assistente cala nessa pergunta. */
export async function requestHandoff(db: WebinarsDb, input: { id: string; nowIso: string; target: AssistantTarget }): Promise<boolean> {
  const { data, error } = await db.from(tableOf(input.target)).update({ handoff_requested_at: input.nowIso }).eq("id", input.id).is("handoff_requested_at", null).select("id");
  assertNoDbError(error, "Webinarios: falar com a equipe");
  return ((data ?? []) as { id: string }[]).length > 0;
}

/** A resposta de uma pergunta da aba Perguntas veio do Assistente ou da equipe (webinar_questions.answer_source). */
export async function setQuestionAnswerSource(db: WebinarsDb, input: { questionId: string; source: "ai" | "team" }): Promise<void> {
  const { error } = await db.from("webinar_questions").update({ answer_source: input.source }).eq("id", input.questionId);
  assertNoDbError(error, "Webinarios: gravar origem da resposta");
}

/**
 * Chat moderado (docs/30 §6.6): a equipe liberou a resposta do Assistente; a pergunta da aba que ela responde (o
 * pedido com reply_message_id = a mensagem) fica respondida agora, com o texto liberado e answer_source 'ai', so se
 * ainda estiver aberta. Devolve se marcou.
 */
export async function answerQuestionOfApprovedAiReply(db: WebinarsDb, input: { body: string; messageId: string; nowIso: string }): Promise<boolean> {
  const request = await db.from("webinar_ai_requests").select("target_id").eq("reply_message_id", input.messageId).eq("target_kind", "question").limit(1);
  assertNoDbError(request.error, "Webinarios: ler pedido da resposta liberada");
  const questionId = ((request.data ?? []) as { target_id: string }[])[0]?.target_id;
  if (!questionId) {
    return false;
  }
  const { data, error } = await db
    .from("webinar_questions")
    .update({ answer_source: "ai", answer_text: input.body, answered_at: input.nowIso, answered_by: null, answered_live: false, status: "answered" })
    .eq("id", questionId)
    .eq("status", "open")
    .is("deleted_at", null)
    .select("id");
  assertNoDbError(error, "Webinarios: pergunta respondida pela resposta liberada");
  return ((data ?? []) as { id: string }[]).length > 0;
}

/** A equipe corrigiu a resposta do Assistente: o texto novo e a marca (o relatorio conta as corrigidas, docs/30 §3.4). */
export async function editAssistantMessage(db: WebinarsDb, input: { body: string; messageId: string; nowIso: string; userId: string }): Promise<boolean> {
  const { data, error } = await db
    .from("webinar_chat_messages")
    .update({ body: input.body, edited_at: input.nowIso, edited_by: input.userId })
    .eq("id", input.messageId)
    .eq("source", "ai")
    .select("id");
  assertNoDbError(error, "Webinarios: corrigir resposta do assistente");
  return ((data ?? []) as { id: string }[]).length > 0;
}

/* ------------------------------------------------------------------------------------------------
 * Os pedidos ao Assistente (um por alvo, sem texto)
 * ---------------------------------------------------------------------------------------------- */

export type AiRequestInsert = { session_id: string; target_id: string; target_kind: AssistantTarget; user_id: string; webinar_id: string };

/** Abre o pedido; o mesmo alvo duas vezes devolve `created: false` (o Assistente nunca responde duas vezes). */
export async function insertAiRequest(db: WebinarsDb, row: AiRequestInsert & { requested_at: string }): Promise<{ created: boolean; request: AssistantRequest | null }> {
  const { data, error } = await db.from("webinar_ai_requests").insert(row).select(AI_REQUEST_COLUMNS).single();
  if (error?.code === UNIQUE_VIOLATION) {
    return { created: false, request: null };
  }
  assertNoDbError(error, "Webinarios: abrir pedido ao assistente");
  return { created: true, request: aiRequestFromRow(data as AiRequestRow) };
}

export type AiRequestFinish = {
  answered_at?: string | null;
  error_code?: string | null;
  model?: string | null;
  provider?: string | null;
  reply_message_id?: string | null;
  skip_reason?: AssistantSkipReason | null;
  status: "answered" | "failed" | "skipped";
};

/** Fecha o pedido (respondido, pulado com o motivo ou falhou com o codigo). */
export async function finishAiRequest(db: WebinarsDb, input: { id: string; patch: AiRequestFinish }): Promise<void> {
  const { error } = await db.from("webinar_ai_requests").update(input.patch).eq("id", input.id).eq("status", "pending");
  assertNoDbError(error, "Webinarios: fechar pedido ao assistente");
}

/** Os pedidos desde `sinceIso` (o limite por aluno e por minuto e o teto da sessao). */
export async function countAiRequestsSince(db: WebinarsDb, input: { sessionId: string; sinceIso: string; userId?: string | null }): Promise<number> {
  let query = db.from("webinar_ai_requests").select("id", { count: "exact", head: true }).eq("session_id", input.sessionId).gte("requested_at", input.sinceIso);
  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }
  const { count, error } = await query;
  assertNoDbError(error, "Webinarios: contar pedidos ao assistente");
  return count ?? 0;
}

export async function listSessionAiRequests(db: WebinarsDb, sessionId: string, limit = 200): Promise<AssistantRequest[]> {
  const { data, error } = await db.from("webinar_ai_requests").select(AI_REQUEST_COLUMNS).eq("session_id", sessionId).order("requested_at", { ascending: false }).limit(limit);
  assertNoDbError(error, "Webinarios: ler pedidos ao assistente");
  return ((data ?? []) as AiRequestRow[]).map(aiRequestFromRow);
}
