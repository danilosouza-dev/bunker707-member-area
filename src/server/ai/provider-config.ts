import "server-only";

import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import {
  isAIProvider,
  type AIProvider,
  type AIProviderConfig
} from "@/server/ai/types";

type ProviderConfigRow = {
  context_max_characters: number;
  daily_question_limit: number;
  default_model: string;
  enabled: boolean;
  is_default: boolean;
  last_tested_at: string | null;
  max_output_tokens: number;
  monthly_question_limit: number;
  priority: number;
  provider: string;
  status: "configured" | "needs_attention";
  temperature: number | string;
  updated_at: string;
};

export class AIProviderConfigError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "AIProviderConfigError";
    this.status = status;
  }
}

function throwDatabaseError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function toProviderConfig(row: ProviderConfigRow): AIProviderConfig {
  if (!isAIProvider(row.provider)) {
    throw new Error("Provedor de IA invalido salvo no banco.");
  }

  return {
    contextMaxCharacters: row.context_max_characters,
    dailyQuestionLimit: row.daily_question_limit,
    defaultModel: row.default_model,
    enabled: row.enabled,
    isDefault: row.is_default,
    lastTestedAt: row.last_tested_at,
    maxOutputTokens: row.max_output_tokens,
    monthlyQuestionLimit: row.monthly_question_limit,
    priority: row.priority,
    provider: row.provider,
    status: row.status,
    temperature: Number(row.temperature),
    updatedAt: row.updated_at
  };
}

function validateInteger(value: unknown, fallback: number, minimum: number, maximum: number, label: string) {
  const parsed = typeof value === "number" ? value : Number(value ?? fallback);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new AIProviderConfigError(`${label} invalido.`);
  }

  return parsed;
}

function validateModel(value: unknown) {
  if (typeof value !== "string") throw new AIProviderConfigError("Modelo obrigatorio.");
  const model = value.trim();

  if (model.length < 1 || model.length > 160 || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new AIProviderConfigError("Modelo invalido.");
  }

  return model;
}

export async function listAIProviderConfigs() {
  const result = await getSupabaseAdminClient()
    .from("ai_provider_configs")
    .select("provider,default_model,is_default,status,daily_question_limit,monthly_question_limit,max_output_tokens,context_max_characters,temperature,last_tested_at,updated_at,enabled,priority")
    .order("is_default", { ascending: false })
    .order("priority", { ascending: false })
    .order("provider");
  throwDatabaseError(result.error, "Nao foi possivel carregar os provedores de IA");
  return (result.data as ProviderConfigRow[]).map(toProviderConfig);
}

export async function saveAIProviderConfig({
  actorId,
  contextMaxCharacters,
  dailyQuestionLimit,
  defaultModel,
  enabled,
  isDefault,
  maxOutputTokens,
  monthlyQuestionLimit,
  priority,
  provider,
  temperature
}: {
  actorId: string;
  contextMaxCharacters?: unknown;
  dailyQuestionLimit?: unknown;
  defaultModel: unknown;
  enabled?: unknown;
  isDefault?: unknown;
  maxOutputTokens?: unknown;
  monthlyQuestionLimit?: unknown;
  priority?: unknown;
  provider: unknown;
  temperature?: unknown;
}) {
  if (!isAIProvider(provider)) throw new AIProviderConfigError("Provedor de IA invalido.");
  const supabase = getSupabaseAdminClient();
  const existingConfigsResult = await supabase
    .from("ai_provider_configs")
    .select("provider,is_default");
  throwDatabaseError(existingConfigsResult.error, "Nao foi possivel validar o provedor padrao");
  const hasDefaultElsewhere = (existingConfigsResult.data ?? []).some((config) => (
    config.provider !== provider && config.is_default
  ));
  const shouldBeDefault = Boolean(isDefault) || !hasDefaultElsewhere;

  if (shouldBeDefault) {
    const clearDefaultResult = await supabase
      .from("ai_provider_configs")
      .update({ is_default: false, updated_by: actorId })
      .neq("provider", provider);
    throwDatabaseError(clearDefaultResult.error, "Nao foi possivel atualizar o provedor padrao");
  }

  const parsedTemperature = typeof temperature === "number" ? temperature : Number(temperature ?? 0.2);

  if (!Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 1) {
    throw new AIProviderConfigError("Temperatura invalida.");
  }

  const model = validateModel(defaultModel);
  const upsertResult = await supabase.from("ai_provider_configs").upsert({
    context_max_characters: validateInteger(contextMaxCharacters, 60000, 5000, 500000, "Limite de contexto"),
    created_by: actorId,
    daily_question_limit: validateInteger(dailyQuestionLimit, 20, 1, 10000, "Limite diario"),
    default_model: model,
    enabled: enabled === undefined ? true : Boolean(enabled),
    is_default: shouldBeDefault,
    max_output_tokens: validateInteger(maxOutputTokens, 900, 64, 8192, "Limite de resposta"),
    monthly_question_limit: validateInteger(monthlyQuestionLimit, 10000, 1, 10000000, "Limite mensal"),
    priority: validateInteger(priority, 0, -1000, 1000, "Prioridade do provedor"),
    provider,
    status: "configured",
    temperature: parsedTemperature,
    updated_by: actorId
  }, { onConflict: "provider" });
  throwDatabaseError(upsertResult.error, "Nao foi possivel salvar a politica do provedor de IA");

  const eventResult = await supabase.from("ai_provider_config_events").insert({
    action: shouldBeDefault ? "set_default" : "saved",
    actor_id: actorId,
    metadata: { enabled: enabled === undefined ? true : Boolean(enabled), model },
    provider
  });
  throwDatabaseError(eventResult.error, "Nao foi possivel auditar a configuracao de IA");
  return listAIProviderConfigs();
}

export async function removeAIProviderConfig(provider: unknown, actorId: string) {
  if (!isAIProvider(provider)) throw new AIProviderConfigError("Provedor de IA invalido.");
  const supabase = getSupabaseAdminClient();
  const connectionsResult = await supabase
    .from("ai_provider_connections")
    .select("id", { count: "exact", head: true })
    .eq("provider", provider)
    .is("deleted_at", null);
  throwDatabaseError(connectionsResult.error, "Nao foi possivel validar as conexoes do provedor");

  if ((connectionsResult.count ?? 0) > 0) {
    throw new AIProviderConfigError("Remova primeiro as conexoes de API e contas deste provedor.", 409);
  }

  const removeResult = await supabase.from("ai_provider_configs").delete().eq("provider", provider);
  throwDatabaseError(removeResult.error, "Nao foi possivel remover a politica do provedor");
  const remainingResult = await supabase
    .from("ai_provider_configs")
    .select("provider,is_default")
    .order("priority", { ascending: false })
    .order("updated_at", { ascending: false });
  throwDatabaseError(remainingResult.error, "Nao foi possivel reorganizar os provedores de IA");

  if (remainingResult.data?.length && !remainingResult.data.some((config) => config.is_default)) {
    const defaultResult = await supabase
      .from("ai_provider_configs")
      .update({ is_default: true, updated_by: actorId })
      .eq("provider", remainingResult.data[0].provider);
    throwDatabaseError(defaultResult.error, "Nao foi possivel definir o novo provedor padrao");
  }

  const eventResult = await supabase.from("ai_provider_config_events").insert({
    action: "removed",
    actor_id: actorId,
    metadata: {},
    provider
  });
  throwDatabaseError(eventResult.error, "Nao foi possivel auditar a remocao do provedor");
  return listAIProviderConfigs();
}

export async function getAIProviderRuntimeConfig(provider?: AIProvider, allowNeedsAttention = false) {
  const { listAIProviderRuntimeCandidates } = await import("@/server/ai/provider-pool");
  const candidates = await listAIProviderRuntimeCandidates({ allowNeedsAttention, provider });

  if (!candidates.length) {
    throw new AIProviderConfigError("O produtor ainda nao configurou uma conexao ativa para o Tutor IA.", 503);
  }

  return candidates[0];
}

export async function recordAIProviderTest(provider: AIProvider, actorId: string, success: boolean) {
  const supabase = getSupabaseAdminClient();
  const updateResult = await supabase
    .from("ai_provider_configs")
    .update({
      last_tested_at: new Date().toISOString(),
      status: success ? "configured" : "needs_attention",
      updated_by: actorId
    })
    .eq("provider", provider);
  throwDatabaseError(updateResult.error, "Nao foi possivel registrar o teste do provedor");
  const eventResult = await supabase.from("ai_provider_config_events").insert({
    action: "tested",
    actor_id: actorId,
    metadata: { success },
    provider
  });
  throwDatabaseError(eventResult.error, "Nao foi possivel auditar o teste do provedor");
}
