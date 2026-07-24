import "server-only";

import { getAccountGatewayRuntimeConfig } from "@/server/ai/account-gateway";
import { generateAIText, AIProviderError } from "@/server/ai/provider-adapter";
import {
  getAIProviderConnectionRow,
  recordAIProviderConnectionResult,
  type AIProviderConnectionRow
} from "@/server/ai/provider-connections";
import { AIProviderConfigError } from "@/server/ai/provider-config";
import {
  isAIProvider,
  type AIConversationMessage,
  type AIProvider,
  type AIProviderAttempt,
  type AIProviderGeneration,
  type AIProviderRuntimeConfig
} from "@/server/ai/types";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

type ProviderPolicyRow = {
  context_max_characters: number;
  daily_question_limit: number;
  default_model: string;
  enabled: boolean;
  is_default: boolean;
  max_output_tokens: number;
  monthly_question_limit: number;
  priority: number;
  provider: string;
  status: "configured" | "needs_attention";
  temperature: number | string;
};

export type AIProviderRuntimeCandidate = AIProviderRuntimeConfig & {
  contextMaxCharacters: number;
  dailyQuestionLimit: number;
  monthlyQuestionLimit: number;
};

export class AIProviderPoolError extends Error {
  attempts: AIProviderAttempt[];
  code: string;

  constructor(message: string, code: string, attempts: AIProviderAttempt[]) {
    super(message);
    this.name = "AIProviderPoolError";
    this.code = code;
    this.attempts = attempts;
  }
}

function throwDatabaseError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function compareNullableDates(left: string | null, right: string | null) {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return new Date(left).getTime() - new Date(right).getTime();
}

function isCoolingDown(row: AIProviderConnectionRow) {
  return Boolean(row.cooldown_until && new Date(row.cooldown_until).getTime() > Date.now());
}

function healthTierRank(value: AIProviderConnectionRow["health_tier"]) {
  if (value === "healthy") return 0;
  if (value === "probing") return 1;
  return 2;
}

async function readConnectionSecret(connectionId: string) {
  const result = await getSupabaseAdminClient().rpc("read_ai_provider_connection_secret", {
    p_connection_id: connectionId
  });
  throwDatabaseError(result.error, "Nao foi possivel ler a chave protegida da conexao");
  const secret = typeof result.data === "string" ? result.data.trim() : "";

  if (!secret) throw new AIProviderConfigError("A chave protegida desta conexao nao esta disponivel.", 503);
  return secret;
}

async function makeRuntimeCandidate(policy: ProviderPolicyRow, connection: AIProviderConnectionRow) {
  if (!isAIProvider(policy.provider) || connection.provider !== policy.provider) {
    throw new Error("Politica e conexao de IA incompativeis.");
  }

  let apiKey: string;
  let gatewayBaseUrl: string | null = null;

  if (connection.auth_mode === "account_gateway") {
    const gateway = getAccountGatewayRuntimeConfig();
    apiKey = gateway.apiKey;
    gatewayBaseUrl = gateway.baseUrl;

    if (!connection.gateway_auth_id) {
      throw new AIProviderConfigError("A conta conectada perdeu a referencia do gateway.", 503);
    }
  } else {
    apiKey = await readConnectionSecret(connection.id);
  }

  return {
    apiKey,
    authMode: connection.auth_mode,
    connectionId: connection.id,
    contextMaxCharacters: policy.context_max_characters,
    dailyQuestionLimit: policy.daily_question_limit,
    gatewayAuthId: connection.gateway_auth_id,
    gatewayBaseUrl,
    healthTier: connection.health_tier,
    maxOutputTokens: policy.max_output_tokens,
    model: policy.default_model,
    monthlyQuestionLimit: policy.monthly_question_limit,
    provider: policy.provider,
    temperature: Number(policy.temperature)
  } satisfies AIProviderRuntimeCandidate;
}

export async function listAIProviderRuntimeCandidates({
  allowNeedsAttention = false,
  provider
}: {
  allowNeedsAttention?: boolean;
  provider?: AIProvider;
} = {}) {
  const supabase = getSupabaseAdminClient();
  let policyQuery = supabase
    .from("ai_provider_configs")
    .select("provider,default_model,is_default,status,daily_question_limit,monthly_question_limit,max_output_tokens,context_max_characters,temperature,enabled,priority")
    .eq("enabled", true);

  if (!allowNeedsAttention) policyQuery = policyQuery.eq("status", "configured");
  if (provider) policyQuery = policyQuery.eq("provider", provider);
  const [policyResult, connectionResult] = await Promise.all([
    policyQuery.order("is_default", { ascending: false }).order("priority", { ascending: false }),
    supabase
      .from("ai_provider_connections")
      .select("id,provider,auth_mode,label,credential_hint,gateway_auth_id,gateway_auth_index,gateway_auth_name,status,priority,consecutive_failures,health_tier,probe_success_streak,cooldown_until,last_error_at,last_error_code,last_error_message,last_tested_at,last_used_at,deleted_at,updated_at,vault_secret_id,created_at")
      .is("deleted_at", null)
      .in("status", allowNeedsAttention ? ["active", "needs_attention"] : ["active"])
  ]);
  throwDatabaseError(policyResult.error, "Nao foi possivel carregar as politicas de IA");
  throwDatabaseError(connectionResult.error, "Nao foi possivel carregar o pool de conexoes de IA");
  const policies = policyResult.data as ProviderPolicyRow[];
  const connections = (connectionResult.data as Array<AIProviderConnectionRow & { created_at: string }>)
    .filter((connection) => allowNeedsAttention || !isCoolingDown(connection));
  const candidates: AIProviderRuntimeCandidate[] = [];

  for (const policy of policies) {
    const providerConnections = connections
      .filter((connection) => connection.provider === policy.provider)
      .sort((left, right) => (
        healthTierRank(left.health_tier) - healthTierRank(right.health_tier)
        || right.priority - left.priority
        || compareNullableDates(left.last_used_at, right.last_used_at)
        || left.created_at.localeCompare(right.created_at)
      ));

    for (const connection of providerConnections) {
      try {
        candidates.push(await makeRuntimeCandidate(policy, connection));
      } catch (error) {
        console.error(`A conexao de IA ${connection.id} nao pode ser preparada.`, error);

        if (connection.auth_mode === "api_key") {
          await safelyRecordConnectionResult({
            affectsHealth: true,
            connectionId: connection.id,
            errorCode: "credential_unavailable",
            errorMessage: error instanceof Error ? error.message : "A chave protegida nao esta disponivel.",
            success: false
          });
        }
      }
    }
  }

  return candidates;
}

export async function getAIProviderRuntimeCandidateForConnection(connectionId: string) {
  const connection = await getAIProviderConnectionRow(connectionId);
  const result = await getSupabaseAdminClient()
    .from("ai_provider_configs")
    .select("provider,default_model,is_default,status,daily_question_limit,monthly_question_limit,max_output_tokens,context_max_characters,temperature,enabled,priority")
    .eq("provider", connection.provider)
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel carregar a politica da conexao de IA");

  if (!result.data) {
    throw new AIProviderConfigError("Salve primeiro o modelo e os limites deste provedor.", 409);
  }

  return makeRuntimeCandidate(result.data as ProviderPolicyRow, connection);
}

function getErrorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  return "generation_failed";
}

async function safelyRecordConnectionResult(args: Parameters<typeof recordAIProviderConnectionResult>[0]) {
  try {
    await recordAIProviderConnectionResult(args);
  } catch (error) {
    console.error("Falha ao registrar a saude da conexao de IA.", error);
  }
}

async function claimNextRuntimeCandidate(candidates: AIProviderRuntimeCandidate[]) {
  const result = await getSupabaseAdminClient().rpc("claim_ai_provider_connection", {
    p_connection_ids: candidates.map((candidate) => candidate.connectionId)
  });
  throwDatabaseError(result.error, "Nao foi possivel reservar uma conexao do pool de IA");
  const claimedId = typeof result.data === "string" ? result.data : null;

  return claimedId
    ? candidates.find((candidate) => candidate.connectionId === claimedId) ?? null
    : null;
}

function removeRemainingProviderCandidates(candidates: AIProviderRuntimeCandidate[], provider: AIProvider) {
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (candidates[index].provider === provider) candidates.splice(index, 1);
  }
}

export async function generateAITextWithFallback({
  actorId,
  beforeAttempt,
  candidates,
  deadlineAt,
  messages,
  system,
  tested = false
}: {
  actorId?: string | null;
  beforeAttempt?: (candidate: AIProviderRuntimeCandidate) => Promise<void>;
  candidates: AIProviderRuntimeCandidate[];
  deadlineAt?: number;
  messages: AIConversationMessage[];
  system: string;
  tested?: boolean;
}): Promise<{
  attempts: AIProviderAttempt[];
  config: AIProviderRuntimeCandidate;
  generation: AIProviderGeneration;
}> {
  if (!candidates.length) {
    throw new AIProviderConfigError("Nenhuma conexao ativa esta disponivel para o Tutor IA.", 503);
  }

  const attempts: AIProviderAttempt[] = [];
  let lastError: unknown;
  const remainingCandidates = [...candidates];
  const safeDeadlineAt = typeof deadlineAt === "number" && Number.isFinite(deadlineAt)
    ? deadlineAt
    : null;

  while (remainingCandidates.length > 0) {
    if (safeDeadlineAt !== null && Date.now() >= safeDeadlineAt - 1_000) {
      lastError = new AIProviderError(
        "O tempo seguro para responder foi atingido. Tente novamente.",
        "provider_deadline_exceeded",
        { scope: "provider" }
      );
      break;
    }

    let config: AIProviderRuntimeCandidate | null;

    if (tested) {
      config = remainingCandidates.shift() ?? null;
    } else {
      const provider = remainingCandidates[0].provider;
      const providerCandidates = remainingCandidates.filter((candidate) => candidate.provider === provider);
      config = await claimNextRuntimeCandidate(providerCandidates);

      if (!config) {
        removeRemainingProviderCandidates(remainingCandidates, provider);
        continue;
      }

      const claimedIndex = remainingCandidates.findIndex((candidate) => candidate.connectionId === config!.connectionId);
      if (claimedIndex >= 0) remainingCandidates.splice(claimedIndex, 1);
    }

    if (!config) continue;
    const startedAt = new Date().toISOString();

    try {
      await beforeAttempt?.(config);
      const remainingTimeMs = safeDeadlineAt === null ? null : safeDeadlineAt - Date.now();
      const generation = await generateAIText({
        config,
        messages,
        system,
        ...(remainingTimeMs === null
          ? {}
          : { timeoutMs: Math.min(20_000, Math.max(1_000, remainingTimeMs - 1_000)) })
      });
      const finishedAt = new Date().toISOString();
      attempts.push({
        authMode: config.authMode,
        connectionId: config.connectionId,
        errorCode: null,
        finishedAt,
        provider: config.provider,
        startedAt,
        success: true
      });
      await safelyRecordConnectionResult({
        actorId,
        connectionId: config.connectionId,
        success: true,
        tested
      });
      return { attempts, config, generation };
    } catch (error) {
      lastError = error;
      const code = getErrorCode(error);
      const affectsHealth = !(error instanceof AIProviderError) || error.scope === "connection";
      attempts.push({
        authMode: config.authMode,
        connectionId: config.connectionId,
        errorCode: code,
        finishedAt: new Date().toISOString(),
        provider: config.provider,
        startedAt,
        success: false
      });
      await safelyRecordConnectionResult({
        actorId,
        affectsHealth,
        connectionId: config.connectionId,
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : "Falha desconhecida.",
        retryAfterMs: error instanceof AIProviderError ? error.retryAfterMs : null,
        success: false,
        tested
      });

      if (!affectsHealth) {
        removeRemainingProviderCandidates(remainingCandidates, config.provider);
      }
    }
  }

  if (!attempts.length) {
    const deadlineCode = getErrorCode(lastError);

    if (deadlineCode === "provider_deadline_exceeded" && lastError instanceof Error) {
      throw new AIProviderPoolError(lastError.message, deadlineCode, attempts);
    }

    throw new AIProviderPoolError(
      "Nenhuma conexao do pool esta disponivel neste momento.",
      "no_available_connection",
      attempts
    );
  }

  const code = getErrorCode(lastError);
  const message = lastError instanceof AIProviderError
    ? lastError.message
    : lastError instanceof Error
      ? lastError.message
      : "Nenhuma conexao de IA conseguiu concluir a solicitacao.";
  throw new AIProviderPoolError(message, code, attempts);
}
