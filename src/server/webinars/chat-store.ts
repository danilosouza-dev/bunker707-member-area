// As tabelas da fase 2 no banco (202610290001), pela service role, no desenho de store.ts: chat, roteiro,
// transcricao, aceite, reacoes, enquetes, perguntas, presenca e as RPCs (janela do chat, abrir e encerrar a sessao,
// lista por aluno). Quem monta telas, regras e limites e room-queries.ts/room-writes.ts (aluno), script-actions.ts/
// room-actions.ts (equipe), presence.ts e o job das sessoes (tick); aqui so o acesso as linhas.

import "server-only";

import { WebinarError, assertNoDbError, type WebinarsDb } from "./db";
import {
  ATTENDANCE_COLUMNS,
  CHAT_MESSAGE_COLUMNS,
  CONSENT_COLUMNS,
  POLL_ANSWER_COLUMNS,
  POLL_COLUMNS,
  POLL_OPTION_COLUMNS,
  PRESENCE_COLUMNS,
  QUESTION_COLUMNS,
  REACTION_COLUMNS,
  SCRIPT_ITEM_COLUMNS,
  TRANSCRIPT_COLUMNS,
  attendeeFromRow,
  type Attendee,
  type AttendanceRow,
  type ChatMessageRow,
  type ChatWindowRow,
  type ConsentRow,
  type PollAnswerRow,
  type PollOptionRow,
  type PollRow,
  type PresenceRow,
  type QuestionRow,
  type ReactionRow,
  type ScriptItemRow,
  type TranscriptRow
} from "./chat-rows";
import { CHAT_LIMITS, ROOM_RULES, type DeleteReason } from "./model";

const PAGE = 1000;

async function fetchAll<T>(run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string | null; hint?: string | null } | null }>, context: string): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    assertNoDbError(error, context);
    const part = data ?? [];
    rows.push(...part);
    if (part.length < PAGE) {
      return rows;
    }
  }
}

function isUniqueViolation(error: { code?: string | null } | null) {
  return error?.code === "23505";
}

/* ------------------------------------------------------------------------------------------------
 * Aceite do chat (D10)
 * ---------------------------------------------------------------------------------------------- */

export async function fetchConsentRow(db: WebinarsDb, userId: string): Promise<ConsentRow | null> {
  const { data, error } = await db.from("webinar_chat_consents").select(CONSENT_COLUMNS).eq("user_id", userId).maybeSingle();
  assertNoDbError(error, "Webinarios: ler aceite do chat");
  return (data as ConsentRow | null) ?? null;
}

export type ConsentUpsert = { consent_version: number; display_mode: string; nickname: string | null; user_id: string };

/** Grava (ou renova) o aceite; uma retirada anterior e desfeita (revoked_at volta a nulo). */
export async function upsertConsentRow(db: WebinarsDb, input: ConsentUpsert, nowIso: string): Promise<ConsentRow> {
  const { data, error } = await db
    .from("webinar_chat_consents")
    .upsert({ ...input, consented_at: nowIso, revoked_at: null }, { onConflict: "user_id" })
    .select(CONSENT_COLUMNS)
    .single();
  assertNoDbError(error, "Webinarios: gravar aceite do chat");
  return data as ConsentRow;
}

export async function revokeConsentRow(db: WebinarsDb, userId: string, nowIso: string): Promise<boolean> {
  const { data, error } = await db.from("webinar_chat_consents").update({ revoked_at: nowIso }).eq("user_id", userId).is("revoked_at", null).select("user_id");
  assertNoDbError(error, "Webinarios: retirar aceite do chat");
  return (data ?? []).length > 0;
}

/* ------------------------------------------------------------------------------------------------
 * Chat
 * ---------------------------------------------------------------------------------------------- */

export type ChatMessageInsert = {
  approved?: boolean;
  author_user_id: string | null;
  body: string;
  display_name: string;
  kind?: string;
  master?: boolean;
  offset_ms: number;
  reply_to_id?: string | null;
  role: string;
  script_item_id?: string | null;
  session_id: string;
  source: string;
  webinar_id: string;
};

export async function insertChatMessage(db: WebinarsDb, row: ChatMessageInsert): Promise<ChatMessageRow> {
  const { data, error } = await db.from("webinar_chat_messages").insert(row).select(CHAT_MESSAGE_COLUMNS).single();
  assertNoDbError(error, "Webinarios: gravar mensagem");
  return data as ChatMessageRow;
}

/** Um item do roteiro solto numa sessao; repetir (mesmo item, mesma sessao) devolve nulo (chave unica). */
export async function insertScriptedMessage(db: WebinarsDb, row: ChatMessageInsert & { script_item_id: string }): Promise<ChatMessageRow | null> {
  const { data, error } = await db.from("webinar_chat_messages").insert({ ...row, source: "scripted" }).select(CHAT_MESSAGE_COLUMNS).maybeSingle();
  if (isUniqueViolation(error)) {
    return null;
  }
  assertNoDbError(error, "Webinarios: soltar item do roteiro");
  return (data as ChatMessageRow | null) ?? null;
}

export async function fetchChatMessageRow(db: WebinarsDb, id: string): Promise<ChatMessageRow | null> {
  const { data, error } = await db.from("webinar_chat_messages").select(CHAT_MESSAGE_COLUMNS).eq("id", id).maybeSingle();
  assertNoDbError(error, "Webinarios: ler mensagem");
  return (data as ChatMessageRow | null) ?? null;
}

export type ChatMessagePatch = Partial<Pick<ChatMessageRow, "approved" | "approved_at" | "approved_by" | "body" | "deleted_at" | "deleted_by" | "deleted_reason" | "master" | "pinned_at" | "source">>;

export async function updateChatMessageRow(db: WebinarsDb, id: string, patch: ChatMessagePatch): Promise<ChatMessageRow | null> {
  const { data, error } = await db.from("webinar_chat_messages").update(patch).eq("id", id).select(CHAT_MESSAGE_COLUMNS).maybeSingle();
  assertNoDbError(error, "Webinarios: atualizar mensagem");
  return (data as ChatMessageRow | null) ?? null;
}

/** A janela [from, to] em ms da sessao (as linhas dela + a linha mestre), pela RPC webinar_chat_window. */
export async function fetchChatWindow(db: WebinarsDb, input: { fromMs: number; sessionId: string; toMs: number; userId: string | null }): Promise<ChatWindowRow[]> {
  const { data, error } = await db.rpc("webinar_chat_window", {
    p_from_ms: input.fromMs,
    p_session_id: input.sessionId,
    p_to_ms: input.toMs,
    p_user_id: input.userId
  });
  assertNoDbError(error, "Webinarios: janela do chat");
  return (Array.isArray(data) ? data : []) as ChatWindowRow[];
}

/**
 * As mensagens novas da propria sessao depois de um ponto (a consulta de 5 s): as aprovadas e as do proprio aluno
 * na moderacao, em ordem de chegada; `afterCreatedAt` exclusivo, `afterId` desempata o mesmo instante; so ate
 * `untilIso` (agora): as linhas do roteiro nascem com created_at no minuto delas, no futuro, e chegam pela janela.
 */
export async function listRecentChatRows(
  db: WebinarsDb,
  input: { afterCreatedAt: string | null; afterId?: string | null; limit?: number; sessionId: string; untilIso: string; userId: string | null }
): Promise<ChatMessageRow[]> {
  const limit = Math.min(CHAT_LIMITS.chatPageMax, Math.max(1, input.limit ?? CHAT_LIMITS.chatPageMax));
  let query = db.from("webinar_chat_messages").select(CHAT_MESSAGE_COLUMNS).eq("session_id", input.sessionId).is("deleted_at", null).lte("created_at", input.untilIso);
  if (input.afterCreatedAt) {
    query = query.gte("created_at", input.afterCreatedAt);
  }
  if (input.userId) {
    query = query.or(`approved.eq.true,author_user_id.eq.${input.userId}`);
  } else {
    query = query.eq("approved", true);
  }
  const { data, error } = await query.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit + 1);
  assertNoDbError(error, "Webinarios: mensagens novas");
  const rows = (data ?? []) as ChatMessageRow[];
  // O gte inclui a propria linha de corte: tira o que ja chegou (mesmo instante e id ate o cursor).
  return rows.filter((row) => !(input.afterCreatedAt && row.created_at === input.afterCreatedAt && input.afterId && row.id <= input.afterId)).slice(0, limit);
}

/** A mesa da equipe: as linhas da sessao (pendentes primeiro, se pedido), as mais novas no fim. */
export async function listSessionChatRows(db: WebinarsDb, input: { limit?: number; onlyPending?: boolean; sessionId: string }): Promise<ChatMessageRow[]> {
  const limit = Math.min(500, Math.max(1, input.limit ?? 200));
  let query = db.from("webinar_chat_messages").select(CHAT_MESSAGE_COLUMNS).eq("session_id", input.sessionId).is("deleted_at", null);
  if (input.onlyPending) {
    query = query.eq("approved", false);
  }
  const { data, error } = await query.order("created_at", { ascending: false }).limit(limit);
  assertNoDbError(error, "Webinarios: chat da sessao");
  return ((data ?? []) as ChatMessageRow[]).reverse();
}

/** Toda a linha mestre de um webinario (exportacao do chat da live real e o CSV do roteiro). */
export async function listMasterChatRows(db: WebinarsDb, webinarId: string): Promise<ChatMessageRow[]> {
  return fetchAll<ChatMessageRow>(
    (from, to) =>
      db.from("webinar_chat_messages").select(CHAT_MESSAGE_COLUMNS).eq("webinar_id", webinarId).eq("master", true).is("deleted_at", null).order("offset_ms", { ascending: true }).order("id", { ascending: true }).range(from, to),
    "Webinarios: linha mestre"
  );
}

export async function fetchPinnedMessageRow(db: WebinarsDb, messageId: string | null): Promise<ChatMessageRow | null> {
  if (!messageId) {
    return null;
  }
  const row = await fetchChatMessageRow(db, messageId);
  return row && !row.deleted_at ? row : null;
}

/**
 * "Remover minhas mensagens" (D10): marca como excluidas (consent_revoked) todas as mensagens, perguntas e respostas
 * de enquete do aluno, em todas as sessoes. Devolve as contagens.
 */
export async function softDeleteStudentContent(db: WebinarsDb, input: { nowIso: string; reason: DeleteReason; userId: string }): Promise<{ answers: number; messages: number; questions: number }> {
  const messages = await db
    .from("webinar_chat_messages")
    .update({ deleted_at: input.nowIso, deleted_by: null, deleted_reason: input.reason })
    .eq("author_user_id", input.userId)
    .is("deleted_at", null)
    .select("id");
  assertNoDbError(messages.error, "Webinarios: remover mensagens do aluno");
  const questions = await db
    .from("webinar_questions")
    .update({ deleted_at: input.nowIso, deleted_reason: input.reason })
    .eq("user_id", input.userId)
    .is("deleted_at", null)
    .select("id");
  assertNoDbError(questions.error, "Webinarios: remover perguntas do aluno");
  const answers = await db.from("webinar_poll_answers").update({ deleted_at: input.nowIso }).eq("user_id", input.userId).is("deleted_at", null).select("id");
  assertNoDbError(answers.error, "Webinarios: remover respostas do aluno");
  return { answers: (answers.data ?? []).length, messages: (messages.data ?? []).length, questions: (questions.data ?? []).length };
}

/* ------------------------------------------------------------------------------------------------
 * Roteiro e transcricao
 * ---------------------------------------------------------------------------------------------- */

export async function listScriptItemRows(db: WebinarsDb, webinarId: string): Promise<ScriptItemRow[]> {
  return fetchAll<ScriptItemRow>(
    (from, to) => db.from("webinar_chat_script_items").select(SCRIPT_ITEM_COLUMNS).eq("webinar_id", webinarId).order("position", { ascending: true }).order("created_at", { ascending: true }).range(from, to),
    "Webinarios: roteiro"
  );
}

export async function fetchScriptItemRow(db: WebinarsDb, id: string): Promise<ScriptItemRow | null> {
  const { data, error } = await db.from("webinar_chat_script_items").select(SCRIPT_ITEM_COLUMNS).eq("id", id).maybeSingle();
  assertNoDbError(error, "Webinarios: ler item do roteiro");
  return (data as ScriptItemRow | null) ?? null;
}

export type ScriptItemUpsert = {
  body: string;
  created_by?: string | null;
  generated_by_ai?: boolean;
  id?: string;
  kind: string;
  offset_ms: number | null;
  persona_name: string;
  persona_role: string;
  phrase: string | null;
  phrase_delay_ms: number;
  position: number;
  resolved_offset_ms?: number | null;
  resolved_transcript_id?: string | null;
  status: string;
  trigger_kind: string;
  webinar_id: string;
};

/**
 * O roteiro inteiro de uma vez: grava (upsert pelo id) as linhas enviadas e apaga as do webinario que ficaram de fora.
 * Os ids que nao vieram sao criados pelo banco. Devolve o roteiro como ficou.
 */
export async function replaceScriptItemRows(db: WebinarsDb, webinarId: string, items: readonly ScriptItemUpsert[]): Promise<ScriptItemRow[]> {
  const withId = items.filter((item): item is ScriptItemUpsert & { id: string } => Boolean(item.id));
  const withoutId = items.filter((item) => !item.id);
  const kept: string[] = withId.map((item) => item.id);

  if (withId.length > 0) {
    const { error } = await db.from("webinar_chat_script_items").upsert(withId.map((item) => ({ ...item, webinar_id: webinarId })), { onConflict: "id" });
    assertNoDbError(error, "Webinarios: gravar roteiro");
  }
  if (withoutId.length > 0) {
    const { data, error } = await db.from("webinar_chat_script_items").insert(withoutId.map((item) => ({ ...item, webinar_id: webinarId }))).select("id");
    assertNoDbError(error, "Webinarios: gravar itens novos do roteiro");
    kept.push(...((data ?? []) as { id: string }[]).map((row) => row.id));
  }
  let removal = db.from("webinar_chat_script_items").delete().eq("webinar_id", webinarId);
  if (kept.length > 0) {
    removal = removal.not("id", "in", `(${kept.join(",")})`);
  }
  const { error } = await removal;
  assertNoDbError(error, "Webinarios: apagar itens tirados do roteiro");
  return listScriptItemRows(db, webinarId);
}

export type ScriptItemPatch = Partial<Pick<ScriptItemRow, "resolved_offset_ms" | "resolved_transcript_id" | "status">>;

export async function updateScriptItemRow(db: WebinarsDb, id: string, patch: ScriptItemPatch): Promise<void> {
  const { error } = await db.from("webinar_chat_script_items").update(patch).eq("id", id);
  assertNoDbError(error, "Webinarios: atualizar item do roteiro");
}

export async function fetchTranscriptRow(db: WebinarsDb, recordingId: string): Promise<TranscriptRow | null> {
  const { data, error } = await db.from("webinar_recording_transcripts").select(TRANSCRIPT_COLUMNS).eq("recording_id", recordingId).maybeSingle();
  assertNoDbError(error, "Webinarios: ler transcricao");
  return (data as TranscriptRow | null) ?? null;
}

export type TranscriptUpsert = {
  checksum: string;
  created_by: string | null;
  cues: unknown;
  full_text: string;
  language: string;
  recording_id: string;
  source_format: string;
};

export async function upsertTranscriptRow(db: WebinarsDb, input: TranscriptUpsert): Promise<TranscriptRow> {
  const { data, error } = await db.from("webinar_recording_transcripts").upsert(input, { onConflict: "recording_id" }).select(TRANSCRIPT_COLUMNS).single();
  assertNoDbError(error, "Webinarios: gravar transcricao");
  return data as TranscriptRow;
}

/* ------------------------------------------------------------------------------------------------
 * Reacoes
 * ---------------------------------------------------------------------------------------------- */

export async function insertReactionRow(db: WebinarsDb, row: { offset_ms: number; reaction: string; session_id: string; user_id: string }): Promise<void> {
  const { error } = await db.from("webinar_reactions").insert(row);
  assertNoDbError(error, "Webinarios: gravar reacao");
}

/** As reacoes desde um instante (a animacao dos ultimos 10 s); quem conta por tipo e o chamador. */
export async function listReactionRowsSince(db: WebinarsDb, input: { limit?: number; sessionId: string; sinceIso: string }): Promise<ReactionRow[]> {
  const { data, error } = await db
    .from("webinar_reactions")
    .select(REACTION_COLUMNS)
    .eq("session_id", input.sessionId)
    .gt("created_at", input.sinceIso)
    .order("created_at", { ascending: false })
    .limit(Math.min(2000, input.limit ?? 2000));
  assertNoDbError(error, "Webinarios: reacoes recentes");
  return (data ?? []) as ReactionRow[];
}

/** Quantas reacoes o aluno mandou nesta sessao desde um instante (o limite de 20 por minuto). */
export async function countStudentReactionsSince(db: WebinarsDb, input: { sessionId: string; sinceIso: string; userId: string }): Promise<number> {
  const { count, error } = await db
    .from("webinar_reactions")
    .select("id", { count: "exact", head: true })
    .eq("session_id", input.sessionId)
    .eq("user_id", input.userId)
    .gt("created_at", input.sinceIso);
  assertNoDbError(error, "Webinarios: contar reacoes do aluno");
  return count ?? 0;
}

/* ------------------------------------------------------------------------------------------------
 * Enquetes
 * ---------------------------------------------------------------------------------------------- */

export async function listPollRows(db: WebinarsDb, input: { sessionId?: string | null; webinarId: string }): Promise<{ options: PollOptionRow[]; polls: PollRow[] }> {
  let query = db.from("webinar_polls").select(POLL_COLUMNS).eq("webinar_id", input.webinarId);
  query = input.sessionId === undefined ? query : input.sessionId === null ? query.is("session_id", null) : query.eq("session_id", input.sessionId);
  const { data, error } = await query.order("position", { ascending: true }).order("created_at", { ascending: true });
  assertNoDbError(error, "Webinarios: enquetes");
  const polls = (data ?? []) as PollRow[];
  if (polls.length === 0) {
    return { options: [], polls };
  }
  const optionsResult = await db
    .from("webinar_poll_options")
    .select(POLL_OPTION_COLUMNS)
    .in("poll_id", polls.map((poll) => poll.id))
    .order("position", { ascending: true });
  assertNoDbError(optionsResult.error, "Webinarios: opcoes das enquetes");
  return { options: (optionsResult.data ?? []) as PollOptionRow[], polls };
}

export async function fetchPollRow(db: WebinarsDb, id: string): Promise<{ options: PollOptionRow[]; poll: PollRow } | null> {
  const { data, error } = await db.from("webinar_polls").select(POLL_COLUMNS).eq("id", id).maybeSingle();
  assertNoDbError(error, "Webinarios: ler enquete");
  if (!data) {
    return null;
  }
  const options = await db.from("webinar_poll_options").select(POLL_OPTION_COLUMNS).eq("poll_id", id).order("position", { ascending: true });
  assertNoDbError(options.error, "Webinarios: opcoes da enquete");
  return { options: (options.data ?? []) as PollOptionRow[], poll: data as PollRow };
}

export type PollInsert = {
  anonymous: boolean;
  created_by: string | null;
  kind: string;
  open_offset_ms?: number | null;
  opened_at?: string | null;
  position: number;
  question: string;
  session_id: string | null;
  status: string;
  template_poll_id?: string | null;
  webinar_id: string;
};

/** Cria a enquete e as opcoes; devolve a linha e as opcoes criadas (na ordem dada). */
export async function insertPollRow(db: WebinarsDb, poll: PollInsert, options: readonly string[]): Promise<{ options: PollOptionRow[]; poll: PollRow }> {
  const { data, error } = await db.from("webinar_polls").insert(poll).select(POLL_COLUMNS).single();
  assertNoDbError(error, "Webinarios: criar enquete");
  const row = data as PollRow;
  const created = await db
    .from("webinar_poll_options")
    .insert(options.map((label, position) => ({ label, poll_id: row.id, position })))
    .select(POLL_OPTION_COLUMNS);
  assertNoDbError(created.error, "Webinarios: criar opcoes da enquete");
  return { options: ((created.data ?? []) as PollOptionRow[]).sort((a, b) => a.position - b.position), poll: row };
}

export type PollPatch = Partial<Pick<PollRow, "anonymous" | "closed_at" | "kind" | "open_offset_ms" | "opened_at" | "position" | "question" | "results_shared_at" | "status">>;

export async function updatePollRow(db: WebinarsDb, id: string, patch: PollPatch, guard: { expectedStatuses?: readonly string[] } = {}): Promise<PollRow | null> {
  let query = db.from("webinar_polls").update(patch).eq("id", id);
  if (guard.expectedStatuses?.length) {
    query = query.in("status", [...guard.expectedStatuses]);
  }
  const { data, error } = await query.select(POLL_COLUMNS);
  assertNoDbError(error, "Webinarios: atualizar enquete");
  return ((data ?? []) as PollRow[])[0] ?? null;
}

/** Troca as opcoes de um modelo de enquete (apaga as que sairam, grava as novas, mantem as que ficaram). */
export async function replacePollOptionRows(db: WebinarsDb, pollId: string, options: readonly { id?: string | null; label: string }[]): Promise<PollOptionRow[]> {
  const kept = options.filter((option) => option.id).map((option) => option.id as string);
  let removal = db.from("webinar_poll_options").delete().eq("poll_id", pollId);
  if (kept.length > 0) {
    removal = removal.not("id", "in", `(${kept.join(",")})`);
  }
  assertNoDbError((await removal).error, "Webinarios: apagar opcoes da enquete");
  const rows = options.map((option, position) => ({ ...(option.id ? { id: option.id } : {}), label: option.label, poll_id: pollId, position }));
  const { data, error } = await db.from("webinar_poll_options").upsert(rows, { onConflict: "id" }).select(POLL_OPTION_COLUMNS);
  assertNoDbError(error, "Webinarios: gravar opcoes da enquete");
  return ((data ?? []) as PollOptionRow[]).sort((a, b) => a.position - b.position);
}

export async function deletePollRow(db: WebinarsDb, id: string): Promise<void> {
  const { error } = await db.from("webinar_polls").delete().eq("id", id).is("session_id", null);
  assertNoDbError(error, "Webinarios: apagar modelo de enquete");
}

/** A resposta do aluno; a segunda resposta a mesma enquete lanca 409 (chave unica poll_id + user_id). */
export async function insertPollAnswerRow(db: WebinarsDb, row: { offset_ms: number; option_ids: string[]; poll_id: string; session_id: string; user_id: string }): Promise<PollAnswerRow> {
  const { data, error } = await db.from("webinar_poll_answers").insert(row).select(POLL_ANSWER_COLUMNS).maybeSingle();
  if (isUniqueViolation(error)) {
    throw new WebinarError("Você já respondeu esta enquete.", 409);
  }
  assertNoDbError(error, "Webinarios: gravar resposta da enquete");
  return data as PollAnswerRow;
}

export async function listPollAnswerRows(db: WebinarsDb, pollId: string): Promise<PollAnswerRow[]> {
  return fetchAll<PollAnswerRow>(
    (from, to) => db.from("webinar_poll_answers").select(POLL_ANSWER_COLUMNS).eq("poll_id", pollId).is("deleted_at", null).range(from, to),
    "Webinarios: respostas da enquete"
  );
}

export async function listStudentPollAnswerRows(db: WebinarsDb, input: { sessionId: string; userId: string }): Promise<PollAnswerRow[]> {
  const { data, error } = await db.from("webinar_poll_answers").select(POLL_ANSWER_COLUMNS).eq("session_id", input.sessionId).eq("user_id", input.userId).is("deleted_at", null);
  assertNoDbError(error, "Webinarios: respostas do aluno");
  return (data ?? []) as PollAnswerRow[];
}

/* ------------------------------------------------------------------------------------------------
 * Perguntas
 * ---------------------------------------------------------------------------------------------- */

export type QuestionInsert = { anonymous: boolean; body: string; display_name: string; message_id?: string | null; offset_ms: number; session_id: string; user_id: string };

export async function insertQuestionRow(db: WebinarsDb, row: QuestionInsert): Promise<QuestionRow> {
  const { data, error } = await db.from("webinar_questions").insert(row).select(QUESTION_COLUMNS).single();
  assertNoDbError(error, "Webinarios: gravar pergunta");
  return data as QuestionRow;
}

export async function fetchQuestionRow(db: WebinarsDb, id: string): Promise<QuestionRow | null> {
  const { data, error } = await db.from("webinar_questions").select(QUESTION_COLUMNS).eq("id", id).maybeSingle();
  assertNoDbError(error, "Webinarios: ler pergunta");
  return (data as QuestionRow | null) ?? null;
}

export async function listQuestionRows(db: WebinarsDb, input: { limit?: number; order: "recent" | "votes"; sessionId: string; statuses?: readonly string[] }): Promise<QuestionRow[]> {
  let query = db.from("webinar_questions").select(QUESTION_COLUMNS).eq("session_id", input.sessionId).is("deleted_at", null);
  if (input.statuses?.length) {
    query = query.in("status", [...input.statuses]);
  }
  query = input.order === "votes" ? query.order("upvotes", { ascending: false }).order("created_at", { ascending: true }) : query.order("created_at", { ascending: false });
  const { data, error } = await query.limit(Math.min(500, input.limit ?? 200));
  assertNoDbError(error, "Webinarios: perguntas da sessao");
  return (data ?? []) as QuestionRow[];
}

export type QuestionPatch = Partial<Pick<QuestionRow, "answer_text" | "answered_at" | "answered_by" | "answered_live" | "deleted_at" | "deleted_reason" | "status" | "upvotes">>;

export async function updateQuestionRow(db: WebinarsDb, id: string, patch: QuestionPatch): Promise<QuestionRow | null> {
  const { data, error } = await db.from("webinar_questions").update(patch).eq("id", id).select(QUESTION_COLUMNS).maybeSingle();
  assertNoDbError(error, "Webinarios: atualizar pergunta");
  return (data as QuestionRow | null) ?? null;
}

/** Alterna o voto do aluno; devolve se ficou votado e o total recontado (gravado em upvotes). */
export async function toggleQuestionVote(db: WebinarsDb, input: { questionId: string; userId: string }): Promise<{ upvotes: number; voted: boolean }> {
  const inserted = await db.from("webinar_question_votes").insert({ question_id: input.questionId, user_id: input.userId });
  let voted = true;
  if (isUniqueViolation(inserted.error)) {
    const removed = await db.from("webinar_question_votes").delete().eq("question_id", input.questionId).eq("user_id", input.userId);
    assertNoDbError(removed.error, "Webinarios: tirar voto");
    voted = false;
  } else {
    assertNoDbError(inserted.error, "Webinarios: votar");
  }
  const { count, error } = await db.from("webinar_question_votes").select("user_id", { count: "exact", head: true }).eq("question_id", input.questionId);
  assertNoDbError(error, "Webinarios: contar votos");
  const upvotes = count ?? 0;
  const updated = await db.from("webinar_questions").update({ upvotes }).eq("id", input.questionId);
  assertNoDbError(updated.error, "Webinarios: gravar votos");
  return { upvotes, voted };
}

export async function listStudentVotedQuestionIds(db: WebinarsDb, input: { questionIds: readonly string[]; userId: string }): Promise<Set<string>> {
  if (input.questionIds.length === 0) {
    return new Set();
  }
  const { data, error } = await db.from("webinar_question_votes").select("question_id").eq("user_id", input.userId).in("question_id", [...input.questionIds]);
  assertNoDbError(error, "Webinarios: votos do aluno");
  return new Set(((data ?? []) as { question_id: string }[]).map((row) => row.question_id));
}

/* ------------------------------------------------------------------------------------------------
 * Presenca
 * ---------------------------------------------------------------------------------------------- */

export type PresenceSignal = { bucket: number; nowIso: string; offsetSeconds: number; sessionId: string; state: string; userId: string };

/** O sinal de 15 s: cria o balde ou soma mais uma amostra nele (leitura e escrita; a corrida so repete um sinal). */
export async function recordPresenceSample(db: WebinarsDb, signal: PresenceSignal): Promise<{ created: boolean }> {
  const inserted = await db.from("webinar_presence_samples").insert({
    bucket: signal.bucket,
    first_at: signal.nowIso,
    last_at: signal.nowIso,
    offset_seconds: signal.offsetSeconds,
    samples: 1,
    session_id: signal.sessionId,
    state: signal.state,
    user_id: signal.userId
  });
  if (!isUniqueViolation(inserted.error)) {
    assertNoDbError(inserted.error, "Webinarios: gravar presenca");
    return { created: true };
  }
  const { data, error } = await db
    .from("webinar_presence_samples")
    .select("samples")
    .eq("session_id", signal.sessionId)
    .eq("user_id", signal.userId)
    .eq("bucket", signal.bucket)
    .maybeSingle();
  assertNoDbError(error, "Webinarios: ler balde de presenca");
  const samples = Math.min(32_767, ((data as { samples: number } | null)?.samples ?? 0) + 1);
  const updated = await db
    .from("webinar_presence_samples")
    .update({ last_at: signal.nowIso, offset_seconds: signal.offsetSeconds, samples, state: signal.state })
    .eq("session_id", signal.sessionId)
    .eq("user_id", signal.userId)
    .eq("bucket", signal.bucket);
  assertNoDbError(updated.error, "Webinarios: atualizar presenca");
  return { created: false };
}

/** Quem esta presente agora: alunos com sinal nos ultimos 3 baldes (M1). Devolve os ids (o contador real da sala). */
export async function listPresentUserIds(db: WebinarsDb, input: { currentBucket: number; sessionId: string }): Promise<string[]> {
  const rows = await fetchAll<{ user_id: string }>(
    (from, to) =>
      db.from("webinar_presence_samples").select("user_id").eq("session_id", input.sessionId).gte("bucket", input.currentBucket - ROOM_RULES.leaveAfterBuckets + 1).lte("bucket", input.currentBucket).range(from, to),
    "Webinarios: presentes agora"
  );
  return [...new Set(rows.map((row) => row.user_id))];
}

export async function fetchLastPresenceRow(db: WebinarsDb, input: { sessionId: string; userId: string }): Promise<PresenceRow | null> {
  const { data, error } = await db
    .from("webinar_presence_samples")
    .select(PRESENCE_COLUMNS)
    .eq("session_id", input.sessionId)
    .eq("user_id", input.userId)
    .order("bucket", { ascending: false })
    .limit(1)
    .maybeSingle();
  assertNoDbError(error, "Webinarios: ultimo sinal de presenca");
  return (data as PresenceRow | null) ?? null;
}

export async function countStudentPresenceRows(db: WebinarsDb, input: { sessionId: string; userId: string }): Promise<number> {
  const { count, error } = await db.from("webinar_presence_samples").select("bucket", { count: "exact", head: true }).eq("session_id", input.sessionId).eq("user_id", input.userId);
  assertNoDbError(error, "Webinarios: contar baldes do aluno");
  return count ?? 0;
}

export async function listAttendanceRows(db: WebinarsDb, sessionId: string): Promise<AttendanceRow[]> {
  return fetchAll<AttendanceRow>(
    (from, to) => db.from("webinar_attendance").select(ATTENDANCE_COLUMNS).eq("session_id", sessionId).order("seconds", { ascending: false }).range(from, to),
    "Webinarios: presenca por aluno"
  );
}

export async function fetchAttendanceRow(db: WebinarsDb, input: { sessionId: string; userId: string }): Promise<AttendanceRow | null> {
  const { data, error } = await db.from("webinar_attendance").select(ATTENDANCE_COLUMNS).eq("session_id", input.sessionId).eq("user_id", input.userId).maybeSingle();
  assertNoDbError(error, "Webinarios: presenca do aluno");
  return (data as AttendanceRow | null) ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * RPCs da sessao
 * ---------------------------------------------------------------------------------------------- */

export type OpenSessionResult = { changed: boolean; fired: number; status: string };

/** Poe a sessao em `live` e solta o roteiro pronto (uma vez), pela RPC webinar_open_session. */
export async function openSessionRpc(db: WebinarsDb, sessionId: string, nowIso: string): Promise<OpenSessionResult> {
  const { data, error } = await db.rpc("webinar_open_session", { p_now: nowIso, p_session_id: sessionId });
  assertNoDbError(error, "Webinarios: abrir sessao");
  const result = (data ?? {}) as Record<string, unknown>;
  return { changed: result.changed === true, fired: Number(result.fired ?? 0) || 0, status: typeof result.status === "string" ? result.status : "live" };
}

/** Encerra a sessao, resume a presenca e congela a curva (RPC webinar_close_session); devolve o resumo. */
export async function closeSessionRpc(db: WebinarsDb, sessionId: string, nowIso: string): Promise<unknown> {
  const { data, error } = await db.rpc("webinar_close_session", { p_now: nowIso, p_session_id: sessionId });
  assertNoDbError(error, "Webinarios: encerrar sessao");
  return data ?? null;
}

/** A lista por aluno de uma sessao (RPC webinar_attendees), sem cache: e a base do CSV. */
export async function fetchAttendees(db: WebinarsDb, sessionId: string): Promise<Attendee[]> {
  const { data, error } = await db.rpc("webinar_attendees", { p_session_id: sessionId });
  assertNoDbError(error, "Webinarios: lista por aluno");
  return (Array.isArray(data) ? data : []).map((row) => attendeeFromRow(row as Parameters<typeof attendeeFromRow>[0]));
}
