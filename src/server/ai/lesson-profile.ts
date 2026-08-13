import "server-only";

import {
  generateAITextWithFallback,
  listAIProviderRuntimeCandidates
} from "@/server/ai/provider-pool";
import { AIProviderConfigError } from "@/server/ai/provider-config";
import {
  getActiveLessonTranscript,
  getLessonTranscriptChunks,
  TranscriptError
} from "@/server/ai/transcripts";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

type LessonAnalysis = {
  chapters: Array<{ startSeconds?: number; title: string }>;
  faq: Array<{ answer: string; question: string }>;
  summary: string;
  topics: string[];
};

function throwDatabaseError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function distributeChunks<T>(items: T[], maximum: number) {
  if (items.length <= maximum) return items;
  const selected: T[] = [];

  for (let index = 0; index < maximum; index += 1) {
    selected.push(items[Math.round((index * (items.length - 1)) / (maximum - 1))]);
  }

  return selected;
}

function buildAnalysisContext(
  chunks: Array<{ endSeconds: number; orderIndex: number; startSeconds: number; text: string }>,
  characterLimit: number
) {
  const estimatedChunkCount = Math.max(1, Math.floor(characterLimit / 1_800));
  const selected = distributeChunks(chunks, estimatedChunkCount);
  let used = 0;
  const lines: string[] = [];

  for (const chunk of selected) {
    const label = chunk.endSeconds > 0
      ? `[${Math.floor(chunk.startSeconds / 60).toString().padStart(2, "0")}:${Math.floor(chunk.startSeconds % 60).toString().padStart(2, "0")}]`
      : `[Trecho ${chunk.orderIndex + 1}]`;
    const line = `${label} ${chunk.text}`;

    if (used + line.length > characterLimit) break;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}

function parseAnalysis(text: string): LessonAnalysis {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned) as unknown;
  } catch {
    throw new Error("O provedor nao retornou a analise da aula no formato esperado.");
  }

  if (!parsed || typeof parsed !== "object") throw new Error("Analise de aula invalida.");
  const record = parsed as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim().slice(0, 12_000) : "";
  const topics = Array.isArray(record.topics)
    ? record.topics.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 200)).filter(Boolean).slice(0, 40)
    : [];
  const chapters = Array.isArray(record.chapters)
    ? record.chapters.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const chapter = item as Record<string, unknown>;
        const title = typeof chapter.title === "string" ? chapter.title.trim().slice(0, 240) : "";
        const startSeconds = typeof chapter.startSeconds === "number" && Number.isFinite(chapter.startSeconds)
          ? Math.max(0, Math.round(chapter.startSeconds))
          : undefined;
        return title ? [{ ...(startSeconds === undefined ? {} : { startSeconds }), title }] : [];
      }).slice(0, 30)
    : [];
  const faq = Array.isArray(record.faq)
    ? record.faq.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const entry = item as Record<string, unknown>;
        const question = typeof entry.question === "string" ? entry.question.trim().slice(0, 500) : "";
        const answer = typeof entry.answer === "string" ? entry.answer.trim().slice(0, 2_000) : "";
        return question && answer ? [{ answer, question }] : [];
      }).slice(0, 20)
    : [];

  if (!summary) throw new Error("A analise da aula nao trouxe um resumo valido.");
  return { chapters, faq, summary, topics };
}

export async function processLessonAIProfile(lessonId: string) {
  const transcript = await getActiveLessonTranscript(lessonId);

  if (!transcript) throw new TranscriptError("Adicione uma transcricao antes de processar o Tutor IA.", 422);
  const supabase = getSupabaseAdminClient();

  try {
    const candidates = await listAIProviderRuntimeCandidates();

    if (!candidates.length) throw new AIProviderConfigError("Nenhuma conexao ativa foi configurada para analisar a aula.", 503);
    const primaryConfig = candidates[0];
    const processingResult = await supabase.from("lesson_ai_profiles").update({
      connection_id: primaryConfig.connectionId,
      error_message: null,
      model: primaryConfig.model,
      provider: primaryConfig.provider,
      status: "processing"
    })
      .eq("lesson_id", lessonId)
      .eq("transcript_id", transcript.id)
      .select("lesson_id")
      .maybeSingle();
    throwDatabaseError(processingResult.error, "Nao foi possivel iniciar a analise da aula");

    if (!processingResult.data) {
      throw new TranscriptError("A transcricao ativa mudou antes do inicio da analise. Tente novamente.", 409);
    }
    const chunks = await getLessonTranscriptChunks(lessonId, transcript.id);
    const sharedContextLimit = Math.min(...candidates.map((candidate) => candidate.contextMaxCharacters));
    const context = buildAnalysisContext(chunks, Math.min(sharedContextLimit, 120_000));
    const generated = await generateAITextWithFallback({
      candidates,
      messages: [{
        content: `Analise a aula abaixo e devolva somente JSON valido.\n\nTRANSCRICAO DA AULA:\n${context}`,
        role: "user"
      }],
      system: [
        "Voce organiza uma aula para um tutor educacional.",
        "Use exclusivamente o texto fornecido e nao acrescente conhecimento externo.",
        "Responda em portugues do Brasil.",
        "Formato exato: {\"summary\":\"...\",\"topics\":[\"...\"],\"chapters\":[{\"title\":\"...\",\"startSeconds\":0}],\"faq\":[{\"question\":\"...\",\"answer\":\"...\"}]}.",
        "Se a transcricao nao tiver horarios reais, omita startSeconds dos capitulos."
      ].join("\n")
    });
    const analysis = parseAnalysis(generated.generation.text);
    const readyResult = await supabase.from("lesson_ai_profiles").update({
      chapters: analysis.chapters,
      connection_id: generated.config.connectionId,
      error_message: null,
      faq: analysis.faq,
      model: generated.config.model,
      processed_at: new Date().toISOString(),
      provider: generated.config.provider,
      status: "ready",
      summary: analysis.summary,
      topics: analysis.topics
    })
      .eq("lesson_id", lessonId)
      .eq("transcript_id", transcript.id)
      .eq("status", "processing")
      .select("lesson_id")
      .maybeSingle();
    throwDatabaseError(readyResult.error, "Nao foi possivel salvar a analise da aula");

    if (!readyResult.data) {
      throw new TranscriptError("A transcricao ativa mudou durante a analise. Processe novamente a versao atual.", 409);
    }

    return { status: "ready" as const };
  } catch (error) {
    const waitingProvider = error instanceof AIProviderConfigError && error.status === 503;
    const failureResult = await supabase.from("lesson_ai_profiles").update({
      error_message: waitingProvider ? null : error instanceof Error ? error.message.slice(0, 2_000) : "Falha desconhecida.",
      status: waitingProvider ? "waiting_provider" : "error"
    })
      .eq("lesson_id", lessonId)
      .eq("transcript_id", transcript.id)
      .eq("status", "processing")
      .select("lesson_id")
      .maybeSingle();
    throwDatabaseError(failureResult.error, "Nao foi possivel registrar o estado da analise");

    if (waitingProvider) return { status: "waiting_provider" as const };
    throw error;
  }
}
