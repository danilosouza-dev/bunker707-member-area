import "server-only";

import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { AIProviderConfigError } from "@/server/ai/provider-config";
import { toDbError } from "@/server/db/pending-migration";

export type AIAgentType = "lesson_tutor" | "platform_guide";

export type AIUsageSummary = {
  byAgent: Array<{
    activeStudents: number;
    agentType: AIAgentType;
    answers: number;
    conversations: number;
    inputTokens: number;
    lessons: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  byConnection: Array<{
    answers: number;
    authMode: "account_gateway" | "api_key" | null;
    connectionId: string | null;
    inputTokens: number;
    label: string;
    outputTokens: number;
    provider: string;
    totalTokens: number;
  }>;
  byDay: Array<{
    activeStudents: number;
    answers: number;
    date: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  }>;
  byLesson: Array<{
    activeStudents: number;
    answers: number;
    conversations: number;
    inputTokens: number;
    lessonId: string | null;
    lessonTitle: string;
    outputTokens: number;
    totalTokens: number;
  }>;
  byProvider: Array<{
    activeStudents: number;
    answers: number;
    inputTokens: number;
    model: string;
    outputTokens: number;
    provider: string;
    totalTokens: number;
  }>;
  byStudent: Array<{
    activeDays: number;
    answers: number;
    avatarUrl: string | null;
    conversations: number;
    email: string | null;
    fullName: string;
    inputTokens: number;
    lastActivityAt: string;
    lessonTutorAnswers: number;
    lessons: number;
    outputTokens: number;
    platformGuideAnswers: number;
    totalTokens: number;
    userId: string;
  }>;
  days: number;
  from: string;
  generatedAt: string;
  totals: {
    activeStudents: number;
    answers: number;
    conversations: number;
    failures: number;
    inputTokens: number;
    lessons: number;
    outputTokens: number;
    totalTokens: number;
  };
};

/** @deprecated Use AIUsageSummary. Kept while older callers migrate names. */
export type AITutorUsageSummary = AIUsageSummary;

function parseDays(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 30);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    throw new AIProviderConfigError("Periodo de consumo invalido.");
  }

  return parsed;
}

export async function getAIUsageSummary(daysValue: unknown, agentType?: AIAgentType) {
  const days = parseDays(daysValue);
  const result = await getSupabaseAdminClient().rpc("get_ai_usage_summary", {
    p_agent_type: agentType ?? null,
    p_days: days
  });

  if (result.error) throw new Error(`Nao foi possivel carregar o consumo de IA: ${result.error.message}`);
  return result.data as AIUsageSummary;
}

/* ------------------------------------------------------------------------------------------------
 * Consumo por intervalo (admin novo, Configuracoes › Tutor IA › Consumo)
 * ---------------------------------------------------------------------------------------------- */

/** Migracao que cria get_ai_usage_summary_between; sem ela, a tela mostra o aviso de atualizacao. */
export const AI_USAGE_BETWEEN_MIGRATION = "202610120002";

export type AIUsageGranularity = "hour" | "day";

/** Um balde da serie: "2026-10-05" por dia ou "2026-10-05T14" por hora, no fuso de Sao Paulo. */
export type AIUsageBucket = {
  activeStudents: number;
  answers: number;
  bucket: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AIUsageSummaryBetween = Omit<AIUsageSummary, "byDay" | "days"> & {
  byBucket: AIUsageBucket[];
  granularity: AIUsageGranularity;
  to: string;
};

type UsageWindowInput = {
  agentType?: AIAgentType;
  end: Date;
  granularity: AIUsageGranularity;
  start: Date;
};

/** Ate um ano bissexto inteiro, com um dia de folga (mesmo teto da funcao no banco). */
const MAX_WINDOW_MS = 367 * 86_400_000;

function assertUsageWindow({ end, granularity, start }: UsageWindowInput) {
  const startMs = start.getTime();
  const endMs = end.getTime();

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > MAX_WINDOW_MS) {
    throw new AIProviderConfigError("Periodo de consumo invalido.");
  }

  if (granularity !== "hour" && granularity !== "day") {
    throw new AIProviderConfigError("Granularidade de consumo invalida.");
  }
}

/**
 * Consumo de IA no intervalo [start, end), com a serie por hora ou por dia no fuso da escola.
 * Banco sem a migracao 202610120002: lanca PendingMigrationError (ver src/server/db/pending-migration.ts).
 */
export async function getAIUsageSummaryBetween(input: UsageWindowInput): Promise<AIUsageSummaryBetween> {
  assertUsageWindow(input);

  const result = await getSupabaseAdminClient().rpc("get_ai_usage_summary_between", {
    p_agent_type: input.agentType ?? null,
    p_end: input.end.toISOString(),
    p_granularity: input.granularity,
    p_start: input.start.toISOString()
  });

  if (result.error) {
    throw toDbError(result.error, "Consumo de IA");
  }

  return result.data as AIUsageSummaryBetween;
}
