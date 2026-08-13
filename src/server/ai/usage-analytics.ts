import "server-only";

import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { AIProviderConfigError } from "@/server/ai/provider-config";

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
