import "server-only";

import {
  buildTutorEvidence,
  formatTutorEvidenceContext,
  resolveTutorEvidenceCitations,
  TUTOR_CITATION_SEEK_MARGIN_SECONDS,
  type VerifiedTutorCitation
} from "@/lib/tutor-citations";
import {
  AIProviderPoolError,
  generateAITextWithFallback,
  listAIProviderRuntimeCandidates,
  type AIProviderRuntimeCandidate
} from "@/server/ai/provider-pool";
import {
  getActiveLessonTranscript,
  getLessonTranscriptChunks,
  TranscriptError
} from "@/server/ai/transcripts";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

export type TutorCitation = VerifiedTutorCitation;

export type TutorMessage = {
  body: string;
  citations: TutorCitation[];
  createdAt: string;
  id: string;
  role: "assistant" | "user";
  status: "completed" | "failed" | "pending";
};

export type TutorConversation = {
  createdAt: string;
  id: string;
  lastMessageAt: string;
  messageCount: number;
  preview: string;
  title: string;
};

type ConversationRow = {
  content_id_snapshot: string;
  created_at: string;
  id: string;
  last_message_at: string;
  lesson_id: string | null;
  lesson_title_snapshot: string;
  student_deleted_at: string | null;
  summary: string;
  title: string;
  user_id: string;
};

type TutorConversationSummaryRow = {
  created_at: string;
  id: string;
  last_message_at: string;
  message_count: number | string;
  preview_body: string | null;
  title: string;
};

type Chunk = {
  endSeconds: number;
  id: string;
  orderIndex: number;
  startSeconds: number;
  text: string;
};

type ConversationMessageRow = {
  body: string;
  role: "assistant" | "user";
};

type StartTutorQuestionResult = {
  assistantMessageId?: string;
  state: "created" | "duplicate" | "pending";
};

const tutorGenerationBudgetMs = 45_000;
const tutorContextSafetyCharacters = 512;

export class TutorError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TutorError";
    this.status = status;
  }
}

function throwDatabaseError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function normalizeQuestion(value: unknown) {
  if (typeof value !== "string") throw new TutorError("Digite uma pergunta para o Tutor IA.");
  const question = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!question) throw new TutorError("Digite uma pergunta para o Tutor IA.");
  if (question.length > 4_000) throw new TutorError("A pergunta pode ter no maximo 4.000 caracteres.");
  return question;
}

function makeConversationTitle(question: string) {
  const compact = question.replace(/[?!.]+$/g, "").trim();
  return compact.length <= 72 ? compact : `${compact.slice(0, 69).trimEnd()}...`;
}

function truncateContextText(value: string, maximumCharacters: number) {
  const safeMaximum = Math.max(0, Math.floor(maximumCharacters));

  if (value.length <= safeMaximum) return value;
  if (safeMaximum <= 1) return value.slice(0, safeMaximum);
  return `${value.slice(0, safeMaximum - 1).trimEnd()}…`;
}

function buildBoundedHistory(rows: ConversationMessageRow[], maximumCharacters: number) {
  const selected: Array<{ content: string; role: ConversationMessageRow["role"] }> = [];
  let remaining = Math.max(0, Math.floor(maximumCharacters));

  for (let index = rows.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const row = rows[index];
    const roleOverhead = row.role.length + 8;

    if (remaining <= roleOverhead) break;
    const content = truncateContextText(row.body, remaining - roleOverhead);

    if (!content) continue;
    selected.push({ content, role: row.role });
    remaining -= content.length + roleOverhead;
  }

  return selected.reverse();
}

function parseStartTutorQuestionResult(value: unknown): StartTutorQuestionResult {
  if (!value || typeof value !== "object") {
    throw new Error("O banco nao retornou o estado do envio ao Tutor IA.");
  }

  const record = value as Record<string, unknown>;
  const state = record.state;
  const assistantMessageId = record.assistantMessageId;

  if (state !== "created" && state !== "duplicate" && state !== "pending") {
    throw new Error("O banco retornou um estado invalido para o envio ao Tutor IA.");
  }

  if (state === "created" && (typeof assistantMessageId !== "string" || !assistantMessageId)) {
    throw new Error("O banco nao retornou a resposta pendente do Tutor IA.");
  }

  return {
    ...(typeof assistantMessageId === "string" ? { assistantMessageId } : {}),
    state
  };
}

function normalizeConversationTitle(value: unknown) {
  if (typeof value !== "string") throw new TutorError("Digite um nome para o chat.");
  const title = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) throw new TutorError("Digite um nome para o chat.");
  if (title.length > 160) throw new TutorError("O nome do chat pode ter no maximo 160 caracteres.");
  return title;
}

function normalizeSearchText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const stopWords = new Set([
  "a", "ao", "aos", "as", "com", "como", "da", "das", "de", "do", "dos", "e", "ela", "ele", "em",
  "essa", "esse", "esta", "este", "eu", "foi", "na", "nas", "no", "nos", "o", "os", "ou", "para", "por",
  "qual", "que", "se", "sem", "sobre", "um", "uma", "voce"
]);

function getSearchTokens(value: string) {
  return Array.from(new Set(normalizeSearchText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !stopWords.has(token))))
    .slice(0, 30);
}

function selectRelevantChunks(chunks: Chunk[], query: string, maximumCharacters: number) {
  const totalCharacters = chunks.reduce((total, chunk) => total + chunk.text.length + 40, 0);

  if (totalCharacters <= maximumCharacters) return chunks;
  const normalizedQuery = normalizeSearchText(query);
  const tokens = getSearchTokens(query);
  const scored = chunks.map((chunk) => {
    const text = normalizeSearchText(chunk.text);
    let score = normalizedQuery.length >= 8 && text.includes(normalizedQuery) ? 25 : 0;

    for (const token of tokens) {
      const matches = text.match(new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"));
      score += Math.min(matches?.length ?? 0, 5) * 3;
    }

    return { chunk, score };
  }).sort((left, right) => right.score - left.score || left.chunk.orderIndex - right.chunk.orderIndex);
  const selectedIndexes = new Set<number>();

  for (const item of scored.slice(0, 18)) {
    selectedIndexes.add(item.chunk.orderIndex);

    if (item.score > 0) {
      selectedIndexes.add(item.chunk.orderIndex - 1);
      selectedIndexes.add(item.chunk.orderIndex + 1);
    }
  }

  const selected = chunks.filter((chunk) => selectedIndexes.has(chunk.orderIndex));
  const bounded: Chunk[] = [];
  let used = 0;

  for (const chunk of selected) {
    if (used + chunk.text.length > maximumCharacters && bounded.length > 0) continue;
    bounded.push(chunk);
    used += chunk.text.length + 40;
  }

  return bounded;
}

async function getOwnedConversation(conversationId: string, userId: string) {
  const result = await getSupabaseAdminClient()
    .from("ai_conversations")
    .select("id,user_id,lesson_id,lesson_title_snapshot,content_id_snapshot,title,summary,created_at,last_message_at,student_deleted_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .eq("agent_type", "lesson_tutor")
    .is("student_deleted_at", null)
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel carregar a conversa do Tutor IA");

  if (!result.data) throw new TutorError("Conversa nao encontrada.", 404);
  return result.data as ConversationRow;
}

export async function getTutorConversationAccess(conversationId: string, userId: string) {
  const conversation = await getOwnedConversation(conversationId, userId);

  if (!conversation.lesson_id) {
    throw new TutorError("Esta aula nao esta mais disponivel para continuar a conversa.", 410);
  }

  return {
    contentId: conversation.content_id_snapshot,
    lessonId: conversation.lesson_id
  };
}

export async function listTutorConversations(lessonId: string, userId: string) {
  const result = await getSupabaseAdminClient().rpc("list_tutor_conversations", {
    p_lesson_id: lessonId,
    p_user_id: userId
  });
  throwDatabaseError(result.error, "Nao foi possivel listar as conversas do Tutor IA");

  return ((result.data ?? []) as TutorConversationSummaryRow[]).map((conversation) => ({
      createdAt: conversation.created_at,
      id: conversation.id,
      lastMessageAt: conversation.last_message_at,
      messageCount: Number(conversation.message_count) || 0,
      preview: conversation.preview_body?.slice(0, 140) ?? "Conversa sem mensagens",
      title: conversation.title
    } satisfies TutorConversation));
}

export async function getTutorAvailability(lessonId: string) {
  const supabase = getSupabaseAdminClient();
  const [transcriptResult, providerResult] = await Promise.all([
    supabase
      .from("lesson_transcripts")
      .select("status")
      .eq("lesson_id", lessonId)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("ai_provider_configs")
      .select("provider")
      .eq("enabled", true)
      .eq("status", "configured")
      .order("is_default", { ascending: false })
      .order("priority", { ascending: false })
  ]);
  throwDatabaseError(transcriptResult.error, "Nao foi possivel validar a transcricao do Tutor IA");
  throwDatabaseError(providerResult.error, "Nao foi possivel validar o provedor do Tutor IA");
  const configuredProviders = Array.from(new Set((providerResult.data ?? [])
    .map((row) => row.provider)
    .filter((provider): provider is string => typeof provider === "string" && provider.length > 0)));
  let hasConnection = false;

  if (configuredProviders.length > 0) {
    const connectionResult = await supabase
      .from("ai_provider_connections")
      .select("id")
      .in("provider", configuredProviders)
      .eq("status", "active")
      .is("deleted_at", null)
      .or(`cooldown_until.is.null,cooldown_until.lte.${new Date().toISOString()}`)
      .limit(1)
      .maybeSingle();
    throwDatabaseError(connectionResult.error, "Nao foi possivel validar as conexoes do Tutor IA");
    hasConnection = Boolean(connectionResult.data);
  }

  const available = transcriptResult.data?.status === "ready" && configuredProviders.length > 0 && hasConnection;
  const reason = transcriptResult.data?.status !== "ready"
    ? "O produtor ainda nao preparou o conteudo desta aula para o Tutor IA."
    : configuredProviders.length === 0 || !hasConnection
      ? "O produtor ainda nao configurou o modelo de IA do tutor."
      : null;

  return { available, reason };
}

export async function createTutorConversation({
  contentId,
  lessonId,
  userId
}: {
  contentId: string;
  lessonId: string;
  userId: string;
}) {
  const availability = await getTutorAvailability(lessonId);

  if (!availability.available) throw new TutorError(availability.reason ?? "Tutor IA indisponivel.", 503);
  const supabase = getSupabaseAdminClient();
  const lessonResult = await supabase.from("lessons").select("title").eq("id", lessonId).maybeSingle();
  throwDatabaseError(lessonResult.error, "Nao foi possivel carregar a aula do Tutor IA");

  if (!lessonResult.data) throw new TutorError("Aula nao encontrada.", 404);
  const result = await supabase.from("ai_conversations").insert({
    agent_type: "lesson_tutor",
    content_id_snapshot: contentId,
    lesson_id: lessonId,
    lesson_title_snapshot: lessonResult.data.title,
    title: "Novo chat",
    user_id: userId
  }).select("id,title,created_at,last_message_at").single();
  throwDatabaseError(result.error, "Nao foi possivel criar a conversa do Tutor IA");
  const savedConversation = result.data!;

  return {
    createdAt: savedConversation.created_at,
    id: savedConversation.id,
    lastMessageAt: savedConversation.last_message_at,
    messageCount: 0,
    preview: "Conversa sem mensagens",
    title: savedConversation.title
  } satisfies TutorConversation;
}

export async function getTutorConversation(conversationId: string, userId: string) {
  const conversation = await getOwnedConversation(conversationId, userId);
  const result = await getSupabaseAdminClient()
    .from("ai_messages")
    .select("id,role,body,status,citations,created_at")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .in("role", ["user", "assistant"])
    .order("message_sequence");
  throwDatabaseError(result.error, "Nao foi possivel carregar as mensagens do Tutor IA");

  return {
    conversation: {
      createdAt: conversation.created_at,
      id: conversation.id,
      lastMessageAt: conversation.last_message_at,
      messageCount: result.data?.length ?? 0,
      preview: result.data?.at(-1)?.body?.slice(0, 140) ?? "Conversa sem mensagens",
      title: conversation.title
    } satisfies TutorConversation,
    messages: (result.data ?? []).map((message) => ({
      body: message.body,
      citations: Array.isArray(message.citations) ? message.citations as TutorCitation[] : [],
      createdAt: message.created_at,
      id: message.id,
      role: message.role as TutorMessage["role"],
      status: message.status as TutorMessage["status"]
    } satisfies TutorMessage))
  };
}

export async function hideTutorConversation(conversationId: string, userId: string) {
  const result = await getSupabaseAdminClient()
    .from("ai_conversations")
    .update({ student_deleted_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("user_id", userId)
    .eq("agent_type", "lesson_tutor")
    .is("student_deleted_at", null)
    .select("id")
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel excluir a conversa do Tutor IA");

  if (!result.data) throw new TutorError("Conversa nao encontrada.", 404);
  return { id: result.data.id as string };
}

export async function renameTutorConversation(conversationId: string, userId: string, value: unknown) {
  const title = normalizeConversationTitle(value);
  const result = await getSupabaseAdminClient()
    .from("ai_conversations")
    .update({ title })
    .eq("id", conversationId)
    .eq("user_id", userId)
    .eq("agent_type", "lesson_tutor")
    .is("student_deleted_at", null)
    .select("id,title")
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel renomear a conversa do Tutor IA");

  if (!result.data) throw new TutorError("Conversa nao encontrada.", 404);
  return { id: result.data.id as string, title: result.data.title as string };
}

async function enforceTutorLimits(userId: string, candidates: AIProviderRuntimeCandidate[]) {
  const primary = candidates[0];

  if (!primary) throw new TutorError("Nenhuma conexao de IA esta disponivel para o Tutor IA.", 503);
  const supabase = getSupabaseAdminClient();
  const rollingDay = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const dailyResult = await supabase
    .from("ai_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("role", "user")
    .gte("created_at", rollingDay);
  throwDatabaseError(dailyResult.error, "Nao foi possivel validar o limite diario do Tutor IA");

  if ((dailyResult.count ?? 0) >= primary.dailyQuestionLimit) {
    throw new TutorError("Voce atingiu o limite de perguntas das ultimas 24 horas.", 429);
  }

  const providerLimits = new Map<string, number>();

  for (const candidate of candidates) {
    if (!providerLimits.has(candidate.provider)) providerLimits.set(candidate.provider, candidate.monthlyQuestionLimit);
  }

  const monthlyCounts = await Promise.all(Array.from(providerLimits).map(async ([provider, limit]) => {
    const result = await supabase
      .from("ai_messages")
      .select("id", { count: "exact", head: true })
      .eq("provider", provider)
      .eq("role", "assistant")
      .eq("status", "completed")
      .gte("created_at", monthStart);
    throwDatabaseError(result.error, "Nao foi possivel validar o limite mensal do Tutor IA");
    return { allowed: (result.count ?? 0) < limit, provider };
  }));
  const allowedProviders = new Set(monthlyCounts.filter((entry) => entry.allowed).map((entry) => entry.provider));
  const allowedCandidates = candidates.filter((candidate) => allowedProviders.has(candidate.provider));

  if (!allowedCandidates.length) {
    throw new TutorError("O limite mensal do Tutor IA foi atingido. Tente novamente no proximo ciclo.", 429);
  }

  return allowedCandidates;
}

export async function submitTutorQuestion({
  clientRequestId,
  conversationId,
  question: rawQuestion,
  userId
}: {
  clientRequestId: string;
  conversationId: string;
  question: unknown;
  userId: string;
}) {
  const generationDeadlineAt = Date.now() + tutorGenerationBudgetMs;
  const question = normalizeQuestion(rawQuestion);
  const conversation = await getOwnedConversation(conversationId, userId);

  if (!conversation.lesson_id) throw new TutorError("Esta aula nao esta mais disponivel para novas perguntas.", 410);
  const supabase = getSupabaseAdminClient();
  const duplicateResult = await supabase
    .from("ai_messages")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("client_request_id", clientRequestId)
    .maybeSingle();
  throwDatabaseError(duplicateResult.error, "Nao foi possivel validar o envio da pergunta");

  if (duplicateResult.data) return getTutorConversation(conversationId, userId);
  const transcript = await getActiveLessonTranscript(conversation.lesson_id);

  if (!transcript) throw new TranscriptError("O Tutor IA ainda nao possui o conteudo desta aula.", 503);
  const candidates = await enforceTutorLimits(userId, await listAIProviderRuntimeCandidates());
  const primaryConfig = candidates[0];
  const startResult = await supabase.rpc("start_tutor_question_atomic", {
    p_client_request_id: clientRequestId,
    p_connection_id: primaryConfig.connectionId,
    p_conversation_id: conversationId,
    p_model: primaryConfig.model,
    p_provider: primaryConfig.provider,
    p_question: question,
    p_user_id: userId
  });
  throwDatabaseError(startResult.error, "Nao foi possivel iniciar a resposta do Tutor IA");
  const started = parseStartTutorQuestionResult(startResult.data);

  if (started.state === "duplicate") return getTutorConversation(conversationId, userId);
  if (started.state === "pending") {
    throw new TutorError("Aguarde a resposta anterior antes de enviar outra pergunta.", 409);
  }

  const assistantMessageId = started.assistantMessageId!;

  try {
    const [chunks, profileResult, historyResult] = await Promise.all([
      getLessonTranscriptChunks(conversation.lesson_id, transcript.id),
      supabase
        .from("lesson_ai_profiles")
        .select("transcript_id,summary,topics,chapters")
        .eq("lesson_id", conversation.lesson_id)
        .maybeSingle(),
      supabase
        .from("ai_messages")
        .select("role,body")
        .eq("conversation_id", conversationId)
        .eq("status", "completed")
        .in("role", ["user", "assistant"])
        .order("message_sequence", { ascending: false })
        .limit(24)
    ]);
    throwDatabaseError(profileResult.error, "Nao foi possivel carregar o perfil da aula");
    throwDatabaseError(historyResult.error, "Nao foi possivel carregar o contexto da conversa");
    const sharedContextLimit = Math.min(...candidates.map((candidate) => candidate.contextMaxCharacters));
    const profileMatchesTranscript = profileResult.data?.transcript_id === transcript.id;
    const rawSummary = profileMatchesTranscript && typeof profileResult.data?.summary === "string"
      ? profileResult.data.summary
      : "";
    const rawTopics = profileMatchesTranscript && Array.isArray(profileResult.data?.topics)
      ? profileResult.data.topics.filter((topic): topic is string => typeof topic === "string").join(", ")
      : "";
    const fixedSystemParts = [
      `Voce e o Tutor IA da aula \"${conversation.lesson_title_snapshot}\".`,
      "Responda em portugues do Brasil com clareza, didatica e objetividade.",
      "Use exclusivamente a transcricao e o historico desta conversa. Nao use conhecimento externo.",
      "Se a resposta nao estiver no material, diga claramente que esse ponto nao aparece nesta aula.",
      "Nunca escreva ou calcule horarios. Ignore quaisquer horarios que aparecam no historico da conversa.",
      "As linhas da transcricao possuem identificadores como [F12]. Cite somente identificadores fornecidos no CONTEUDO AUTORIZADO.",
      "Depois de cada afirmacao importante, acrescente um identificador [Fnumero] cuja linha comprove diretamente o que foi dito.",
      "Para localizar um assunto, cite a primeira linha em que a explicacao realmente comeca. Use apenas uma fonte por ponto quando ela for suficiente.",
      "Nao altere, combine, invente ou transforme os identificadores em intervalos. O servidor convertera fontes validas em tempos reais."
    ];
    const fixedSystem = fixedSystemParts.join("\n");
    const profileBudget = Math.max(0, Math.min(5_600, sharedContextLimit - fixedSystem.length - 3_500));
    const summary = truncateContextText(rawSummary, Math.floor(profileBudget * 0.7));
    const topics = truncateContextText(rawTopics, profileBudget - summary.length);
    const systemPrefix = [
      fixedSystem,
      summary ? `Resumo previamente analisado: ${summary}` : "",
      topics ? `Topicos identificados: ${topics}` : ""
    ].filter(Boolean).join("\n");
    const evidenceHeader = "\n\nCONTEUDO AUTORIZADO DA AULA:\n";
    const availableForHistoryAndEvidence = Math.max(
      1_000,
      sharedContextLimit - systemPrefix.length - evidenceHeader.length - tutorContextSafetyCharacters
    );
    const historyBudget = Math.min(10_000, Math.max(400, Math.floor(availableForHistoryAndEvidence * 0.35)));
    const historyRows = (historyResult.data ?? []).reverse().flatMap((message) => (
      (message.role === "assistant" || message.role === "user") && typeof message.body === "string"
        ? [{ body: message.body, role: message.role } satisfies ConversationMessageRow]
        : []
    ));
    const history = buildBoundedHistory(historyRows, historyBudget);
    const historyCharacters = history.reduce(
      (total, message) => total + message.content.length + message.role.length + 8,
      0
    );
    const maximumTranscriptCharacters = Math.max(1_000, availableForHistoryAndEvidence - historyCharacters);
    const recentContext = history.slice(-6).map((message) => message.content).join(" ");
    const relevantChunks = selectRelevantChunks(chunks, `${recentContext} ${question}`, maximumTranscriptCharacters);
    const evidence = buildTutorEvidence({
      chunks: relevantChunks,
      cues: transcript.cues,
      maximumCharacters: maximumTranscriptCharacters,
      transcriptId: transcript.id
    });
    const generated = await generateAITextWithFallback({
      candidates,
      deadlineAt: generationDeadlineAt,
      messages: history,
      system: `${systemPrefix}${evidenceHeader}${formatTutorEvidenceContext(evidence)}`
    });
    const resolvedAnswer = resolveTutorEvidenceCitations(
      generated.generation.text,
      evidence,
      TUTOR_CITATION_SEEK_MARGIN_SECONDS
    );
    const completeResult = await supabase.from("ai_messages").update({
      body: resolvedAnswer.body,
      citations: resolvedAnswer.citations,
      connection_id: generated.config.connectionId,
      gateway_request_id: generated.generation.gatewayRequestId,
      input_tokens: generated.generation.inputTokens,
      model: generated.config.model,
      output_tokens: generated.generation.outputTokens,
      provider: generated.config.provider,
      provider_attempts: generated.attempts,
      status: "completed"
    })
      .eq("id", assistantMessageId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();
    throwDatabaseError(completeResult.error, "Nao foi possivel salvar a resposta do Tutor IA");

    if (!completeResult.data) {
      throw new TutorError("Esta resposta expirou antes de ser concluida. Envie a pergunta novamente.", 409);
    }
    const conversationUpdate: Record<string, unknown> = { last_message_at: new Date().toISOString() };

    if (conversation.title === "Novo chat") conversationUpdate.title = makeConversationTitle(question);
    const updateConversationResult = await supabase
      .from("ai_conversations")
      .update(conversationUpdate)
      .eq("id", conversationId)
      .eq("user_id", userId)
      .eq("agent_type", "lesson_tutor");
    throwDatabaseError(updateConversationResult.error, "Nao foi possivel atualizar a conversa do Tutor IA");
    return getTutorConversation(conversationId, userId);
  } catch (error) {
    const errorCode = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "generation_failed";
    const failureResult = await supabase.from("ai_messages").update({
      body: "Nao consegui concluir esta resposta. Tente novamente em alguns instantes.",
      error_code: errorCode,
      provider_attempts: error instanceof AIProviderPoolError ? error.attempts : [],
      status: "failed"
    })
      .eq("id", assistantMessageId)
      .eq("status", "pending");

    if (failureResult.error) {
      console.error("Nao foi possivel encerrar a resposta pendente do Tutor IA.", failureResult.error);
    }

    throw error;
  }
}
