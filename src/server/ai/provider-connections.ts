import "server-only";

import {
  AccountGatewayError,
  deleteAccountGatewayAuth,
  setAccountGatewayAuthPaused,
  setAccountGatewayAuthPriority,
  type AccountGatewayAuth
} from "@/server/ai/account-gateway";
import {
  isAIProvider,
  type AIProvider,
  type AIProviderConnection,
  type AIProviderConnectionStatus
} from "@/server/ai/types";
import { AIProviderConfigError } from "@/server/ai/provider-config";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

export type AIProviderConnectionRow = {
  auth_mode: "account_gateway" | "api_key";
  consecutive_failures: number;
  cooldown_until: string | null;
  credential_hint: string;
  deleted_at: string | null;
  gateway_auth_id: string | null;
  gateway_auth_index: string | null;
  gateway_auth_name: string | null;
  health_tier: "draining" | "healthy" | "probing";
  id: string;
  label: string;
  last_error_code: string | null;
  last_error_at: string | null;
  last_error_message: string | null;
  last_tested_at: string | null;
  last_used_at: string | null;
  priority: number;
  probe_success_streak: number;
  provider: string;
  status: AIProviderConnectionStatus;
  updated_at: string;
  vault_secret_id?: string | null;
};

function throwDatabaseError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function getGatewayFailureMetadata(error: unknown) {
  if (error instanceof AccountGatewayError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status
    };
  }

  return {
    code: "account_gateway_operation_failed",
    message: error instanceof Error ? error.message : "Falha operacional no gateway.",
    status: 502
  };
}

function validateConnectionId(value: unknown, required = false) {
  if (value === null || value === undefined || value === "") {
    if (required) throw new AIProviderConfigError("Conexao de IA invalida.");
    return null;
  }

  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AIProviderConfigError("Conexao de IA invalida.");
  }

  return value;
}

function validateLabel(value: unknown, fallback: string) {
  const label = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : fallback;

  if (!label || label.length > 120 || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new AIProviderConfigError("Nome da conexao invalido.");
  }

  return label;
}

function validatePriority(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : Number(value ?? fallback);

  if (!Number.isInteger(parsed) || parsed < -1000 || parsed > 1000) {
    throw new AIProviderConfigError("Prioridade da conexao invalida.");
  }

  return parsed;
}

function toConnection(row: AIProviderConnectionRow): AIProviderConnection {
  if (!isAIProvider(row.provider)) throw new Error("Provedor invalido salvo na conexao de IA.");

  return {
    authMode: row.auth_mode,
    consecutiveFailures: row.consecutive_failures,
    cooldownUntil: row.cooldown_until,
    credentialHint: row.credential_hint,
    gatewayAuthId: row.gateway_auth_id,
    healthTier: row.health_tier,
    id: row.id,
    label: row.label,
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    lastTestedAt: row.last_tested_at,
    lastUsedAt: row.last_used_at,
    priority: row.priority,
    provider: row.provider,
    status: row.status,
    updatedAt: row.updated_at
  };
}

async function auditConnection({
  action,
  actorId,
  connectionId,
  metadata,
  provider
}: {
  action: string;
  actorId?: string | null;
  connectionId: string | null;
  metadata?: Record<string, unknown>;
  provider: AIProvider;
}) {
  const result = await getSupabaseAdminClient().from("ai_provider_connection_events").insert({
    action,
    actor_id: actorId ?? null,
    connection_id: connectionId,
    metadata: metadata ?? {},
    provider
  });
  throwDatabaseError(result.error, "Nao foi possivel auditar a conexao de IA");
}

export async function listAIProviderConnections(provider?: AIProvider) {
  let query = getSupabaseAdminClient()
    .from("ai_provider_connections")
    .select("id,provider,auth_mode,label,credential_hint,gateway_auth_id,gateway_auth_index,gateway_auth_name,status,priority,consecutive_failures,health_tier,probe_success_streak,cooldown_until,last_error_at,last_error_code,last_error_message,last_tested_at,last_used_at,deleted_at,updated_at")
    .is("deleted_at", null)
    .order("provider")
    .order("priority", { ascending: false })
    .order("created_at");

  if (provider) query = query.eq("provider", provider);
  const result = await query;
  throwDatabaseError(result.error, "Nao foi possivel carregar as conexoes de IA");
  return (result.data as AIProviderConnectionRow[]).map(toConnection);
}

export async function getAIProviderConnectionRow(connectionId: unknown) {
  const id = validateConnectionId(connectionId, true)!;
  const result = await getSupabaseAdminClient()
    .from("ai_provider_connections")
    .select("id,provider,auth_mode,label,credential_hint,gateway_auth_id,gateway_auth_index,gateway_auth_name,status,priority,consecutive_failures,health_tier,probe_success_streak,cooldown_until,last_error_at,last_error_code,last_error_message,last_tested_at,last_used_at,deleted_at,updated_at,vault_secret_id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel carregar a conexao de IA");

  if (!result.data) throw new AIProviderConfigError("Conexao de IA nao encontrada.", 404);
  return result.data as AIProviderConnectionRow;
}

export async function saveAIProviderAPIConnection({
  actorId,
  apiKey,
  connectionId,
  label,
  priority,
  provider
}: {
  actorId: string;
  apiKey?: unknown;
  connectionId?: unknown;
  label?: unknown;
  priority?: unknown;
  provider: unknown;
}) {
  if (!isAIProvider(provider)) throw new AIProviderConfigError("Provedor de IA invalido.");
  const id = validateConnectionId(connectionId);
  const existing = id ? await getAIProviderConnectionRow(id) : null;

  if (existing && (existing.provider !== provider || existing.auth_mode !== "api_key")) {
    throw new AIProviderConfigError("A conexao nao pode mudar de provedor ou tipo.", 409);
  }

  const secret = typeof apiKey === "string" ? apiKey.trim() : "";

  if (!id && !secret) throw new AIProviderConfigError("Informe a chave de API para criar a conexao.");
  const normalizedLabel = validateLabel(label, existing?.label ?? `API ${provider}`);
  const normalizedPriority = validatePriority(priority, existing?.priority ?? 0);
  const result = await getSupabaseAdminClient().rpc("upsert_ai_provider_api_connection", {
    p_actor_id: actorId,
    p_connection_id: id,
    p_label: normalizedLabel,
    p_priority: normalizedPriority,
    p_provider: provider,
    p_secret: secret
  });
  throwDatabaseError(result.error, "Nao foi possivel proteger e salvar a conexao de API");
  const savedId = String(result.data ?? "");

  if (!savedId) throw new Error("O banco nao retornou a conexao de API salva.");
  await auditConnection({
    action: id ? "updated" : "created",
    actorId,
    connectionId: savedId,
    metadata: { key_replaced: Boolean(secret), priority: normalizedPriority },
    provider
  });
  return getAIProviderConnectionRow(savedId).then(toConnection);
}

export async function upsertAccountGatewayConnection({
  actorId,
  auth,
  label
}: {
  actorId: string;
  auth: AccountGatewayAuth;
  label: string;
}) {
  const normalizedLabel = validateLabel(label, auth.label);
  const credentialHint = auth.email || auth.label || auth.name;
  const status: AIProviderConnectionStatus = auth.disabled
    ? "paused"
    : auth.unavailable || (auth.status && auth.status !== "active")
      ? "needs_attention"
      : "active";
  const result = await getSupabaseAdminClient().from("ai_provider_connections").upsert({
    auth_mode: "account_gateway",
    consecutive_failures: 0,
    cooldown_until: null,
    created_by: actorId,
    credential_hint: credentialHint.slice(0, 160),
    deleted_at: null,
    deleted_by: null,
    gateway_auth_id: auth.id,
    gateway_auth_index: auth.authIndex || null,
    gateway_auth_name: auth.name || null,
    health_tier: status === "active" ? "healthy" : "draining",
    label: normalizedLabel,
    last_error_code: null,
    last_error_message: auth.statusMessage ? auth.statusMessage.slice(0, 2000) : null,
    priority: validatePriority(auth.priority),
    probe_success_streak: 0,
    provider: auth.provider,
    status,
    updated_by: actorId,
    vault_secret_id: null
  }, { onConflict: "gateway_auth_id" }).select("id").single();
  throwDatabaseError(result.error, "Nao foi possivel registrar a conta conectada");
  const connectionId = result.data!.id as string;
  await auditConnection({
    action: "oauth_completed",
    actorId,
    connectionId,
    metadata: { gateway_auth_index: auth.authIndex },
    provider: auth.provider
  });
  return getAIProviderConnectionRow(connectionId).then(toConnection);
}

export async function updateAIProviderConnection({
  actorId,
  connectionId,
  label,
  paused,
  priority
}: {
  actorId: string;
  connectionId: unknown;
  label?: unknown;
  paused?: unknown;
  priority?: unknown;
}) {
  const row = await getAIProviderConnectionRow(connectionId);
  const provider = row.provider as AIProvider;
  const updates: Record<string, unknown> = { updated_by: actorId };
  let gatewayPauseChanged = false;
  let gatewayPauseFailure: ReturnType<typeof getGatewayFailureMetadata> | null = null;
  let gatewayPriorityChanged = false;
  let action = "updated";

  if (label !== undefined) updates.label = validateLabel(label, row.label);

  if (priority !== undefined) {
    const normalizedPriority = validatePriority(priority, row.priority);
    updates.priority = normalizedPriority;

    if (row.auth_mode === "account_gateway" && row.gateway_auth_id) {
      await setAccountGatewayAuthPriority(row.gateway_auth_id, normalizedPriority);
      gatewayPriorityChanged = true;
    }
  }

  if (paused !== undefined) {
    if (typeof paused !== "boolean") throw new AIProviderConfigError("Estado da conexao invalido.");

    if (row.auth_mode === "account_gateway" && row.gateway_auth_id) {
      try {
        await setAccountGatewayAuthPaused(row.gateway_auth_id, paused);
        gatewayPauseChanged = true;
      } catch (error) {
        if (paused) {
          gatewayPauseFailure = getGatewayFailureMetadata(error);
          console.error("A conexao sera pausada localmente, mas o gateway nao confirmou a pausa.", error);
        } else {
          if (gatewayPriorityChanged) {
            try {
              await setAccountGatewayAuthPriority(row.gateway_auth_id, row.priority);
            } catch (rollbackError) {
              console.error("Nao foi possivel reverter a prioridade da conta.", rollbackError);
            }
          }
          throw error;
        }
      }
    }

    const now = new Date().toISOString();
    updates.status = paused ? "paused" : "active";
    updates.cooldown_until = null;
    updates.consecutive_failures = paused ? row.consecutive_failures : 0;
    updates.health_tier = paused ? "draining" : "healthy";
    updates.probe_success_streak = 0;
    updates.last_error_at = paused
      ? gatewayPauseFailure ? now : row.last_error_at
      : null;
    updates.last_error_code = paused
      ? gatewayPauseFailure?.code ?? row.last_error_code
      : null;
    updates.last_error_message = paused
      ? gatewayPauseFailure?.message.slice(0, 2000) ?? row.last_error_message
      : null;
    action = paused ? "paused" : "resumed";
  }

  const result = await getSupabaseAdminClient()
    .from("ai_provider_connections")
    .update(updates)
    .eq("id", row.id);
  if (result.error && row.auth_mode === "account_gateway" && row.gateway_auth_id) {
    try {
      if (gatewayPauseChanged) {
        await setAccountGatewayAuthPaused(row.gateway_auth_id, row.status === "paused");
      }
      if (gatewayPriorityChanged) {
        await setAccountGatewayAuthPriority(row.gateway_auth_id, row.priority);
      }
    } catch (rollbackError) {
      console.error("Nao foi possivel reverter a conta apos falha ao atualizar a conexao.", rollbackError);
    }
  }
  throwDatabaseError(result.error, "Nao foi possivel atualizar a conexao de IA");
  await auditConnection({
    action,
    actorId,
    connectionId: row.id,
    metadata: {
      ...updates,
      gateway_pause_confirmed: paused === undefined ? undefined : gatewayPauseChanged,
      gateway_pause_error_code: gatewayPauseFailure?.code,
      gateway_pause_error_status: gatewayPauseFailure?.status
    },
    provider
  });
  return getAIProviderConnectionRow(row.id).then(toConnection);
}

export async function removeAIProviderConnection(connectionId: unknown, actorId: string) {
  const row = await getAIProviderConnectionRow(connectionId);
  const provider = row.provider as AIProvider;
  let gatewayPaused = false;
  let gatewayDeleted: boolean | null = null;
  let gatewayPauseFailure: ReturnType<typeof getGatewayFailureMetadata> | null = null;
  let gatewayDeleteFailure: ReturnType<typeof getGatewayFailureMetadata> | null = null;

  if (row.auth_mode === "account_gateway" && row.gateway_auth_id) {
    try {
      await setAccountGatewayAuthPaused(row.gateway_auth_id, true);
      gatewayPaused = true;
    } catch (error) {
      if (error instanceof AccountGatewayError && error.code === "account_gateway_http_404") {
        gatewayDeleted = true;
      } else {
        gatewayPauseFailure = getGatewayFailureMetadata(error);
        console.error("A conexao sera removida localmente, mas o gateway nao confirmou a pausa.", error);
      }
    }
  }

  const result = await getSupabaseAdminClient().rpc("delete_ai_provider_connection", {
    p_actor_id: actorId,
    p_connection_id: row.id
  });

  if (result.error) {
    if (gatewayPaused && row.gateway_auth_id) {
      try {
        await setAccountGatewayAuthPaused(row.gateway_auth_id, false);
      } catch (rollbackError) {
        console.error("Nao foi possivel reativar a conta apos falha ao remover a conexao.", rollbackError);
      }
    }

    throwDatabaseError(result.error, "Nao foi possivel remover a conexao de IA");
  }

  if (row.auth_mode === "account_gateway" && row.gateway_auth_id && gatewayDeleted !== true) {
    try {
      await deleteAccountGatewayAuth(row.gateway_auth_id);
      gatewayDeleted = true;
    } catch (cleanupError) {
      if (cleanupError instanceof AccountGatewayError && cleanupError.code === "account_gateway_http_404") {
        gatewayDeleted = true;
      } else {
        // The connection was removed from the runtime pool before remote cleanup,
        // so it cannot serve traffic through Bunker707 while ops retries cleanup.
        gatewayDeleted = false;
        gatewayDeleteFailure = getGatewayFailureMetadata(cleanupError);
        console.error("A conexao foi removida, mas o arquivo do gateway precisa de limpeza.", cleanupError);
      }
    }
  }

  await auditConnection({
    action: "removed",
    actorId,
    connectionId: row.id,
    metadata: {
      auth_mode: row.auth_mode,
      gateway_deleted: gatewayDeleted,
      gateway_delete_error_code: gatewayDeleteFailure?.code,
      gateway_delete_error_status: gatewayDeleteFailure?.status,
      gateway_pause_confirmed: gatewayPaused,
      gateway_pause_error_code: gatewayPauseFailure?.code,
      gateway_pause_error_status: gatewayPauseFailure?.status,
      label: row.label
    },
    provider
  });
  return { id: row.id };
}

function getFailureState(code: string, failureCount: number, retryAfterMs: number | null) {
  if (
    code === "account_gateway_invalid_connection"
    || code === "credential_unavailable"
    || code === "provider_http_401"
    || code === "provider_http_402"
    || code === "provider_http_403"
  ) {
    return { cooldownUntil: null, permanent: true, status: "needs_attention" as const };
  }

  if (code === "provider_http_429") {
    const delayMs = retryAfterMs ?? 120 * 1000;
    return {
      cooldownUntil: new Date(Date.now() + Math.max(1_000, delayMs)).toISOString(),
      permanent: false,
      status: "active" as const
    };
  }

  if (code === "provider_timeout" || code === "provider_network_error" || code.startsWith("provider_http_5")) {
    const exponentialDelayMs = Math.min(15 * 60 * 1000, 15 * 1000 * (2 ** Math.max(0, failureCount - 1)));
    return {
      cooldownUntil: new Date(Date.now() + Math.max(1_000, retryAfterMs ?? exponentialDelayMs)).toISOString(),
      permanent: false,
      status: "active" as const
    };
  }

  return {
    cooldownUntil: new Date(Date.now() + Math.max(1_000, retryAfterMs ?? 5 * 60 * 1000)).toISOString(),
    permanent: false,
    status: "active" as const
  };
}

export async function recordAIProviderConnectionResult({
  actorId,
  affectsHealth = true,
  connectionId,
  errorCode,
  errorMessage,
  retryAfterMs = null,
  success,
  tested = false
}: {
  actorId?: string | null;
  affectsHealth?: boolean;
  connectionId: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryAfterMs?: number | null;
  success: boolean;
  tested?: boolean;
}) {
  const code = errorCode?.slice(0, 200) || "generation_failed";

  for (let optimisticAttempt = 0; optimisticAttempt < 5; optimisticAttempt += 1) {
    const row = await getAIProviderConnectionRow(connectionId);
    const now = new Date().toISOString();
    const nextFailureCount = row.consecutive_failures + 1;
    const failureState = getFailureState(code, nextFailureCount, retryAfterMs);
    const nextProbeStreak = success ? row.probe_success_streak + 1 : 0;
    const recovered = success && (row.health_tier === "healthy" || nextProbeStreak >= 3);
    const updates = !affectsHealth ? {
      last_tested_at: tested ? now : row.last_tested_at,
      last_used_at: now
    } : success ? {
      consecutive_failures: 0,
      cooldown_until: null,
      health_tier: recovered ? "healthy" : "probing",
      last_error_code: null,
      last_error_at: null,
      last_error_message: null,
      last_tested_at: tested ? now : row.last_tested_at,
      last_used_at: now,
      probe_success_streak: recovered ? 0 : nextProbeStreak,
      status: row.status === "paused" ? "paused" : "active"
    } : {
      consecutive_failures: nextFailureCount,
      cooldown_until: failureState.cooldownUntil,
      health_tier: failureState.permanent || nextFailureCount >= 2 ? "draining" : row.health_tier,
      last_error_code: code,
      last_error_at: now,
      last_error_message: (errorMessage || "Falha ao usar esta conexao.").slice(0, 2000),
      last_tested_at: tested ? now : row.last_tested_at,
      last_used_at: now,
      probe_success_streak: 0,
      status: row.status === "paused" ? "paused" : failureState.status
    };
    const result = await getSupabaseAdminClient()
      .from("ai_provider_connections")
      .update(updates)
      .eq("id", row.id)
      .eq("updated_at", row.updated_at)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    throwDatabaseError(result.error, "Nao foi possivel atualizar a saude da conexao de IA");

    if (!result.data) continue;
    await auditConnection({
      action: tested ? "tested" : success ? "runtime_succeeded" : "runtime_failed",
      actorId,
      connectionId: row.id,
      metadata: {
        affects_health: affectsHealth,
        error_code: success ? null : code,
        retry_after_ms: retryAfterMs,
        success
      },
      provider: row.provider as AIProvider
    });
    return;
  }

  throw new Error("A saude da conexao mudou simultaneamente muitas vezes. Tente novamente.");
}
