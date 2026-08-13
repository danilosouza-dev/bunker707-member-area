import "server-only";

import {
  AccountGatewayError,
  cancelAccountGatewayOAuth,
  getAccountGatewayOAuthStatus,
  listAccountGatewayAuths,
  startAccountGatewayOAuth,
  submitAccountGatewayOAuthCallback
} from "@/server/ai/account-gateway";
import { upsertAccountGatewayConnection } from "@/server/ai/provider-connections";
import { AIProviderConfigError } from "@/server/ai/provider-config";
import { isAIProvider, type AIProvider } from "@/server/ai/types";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

type AccountLinkSessionRow = {
  actor_id: string | null;
  error_message: string | null;
  expires_at: string;
  gateway_auth_ids_before: unknown;
  gateway_state: string;
  id: string;
  label: string;
  provider: string;
  status: "cancelled" | "completed" | "failed" | "pending";
};

type OAuthCleanupResult = {
  errorCode: string | null;
  status: "already_absent" | "failed" | "succeeded";
};

function throwDatabaseError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function normalizeLabel(value: unknown, provider: AIProvider) {
  const fallback = provider === "gemini" ? "Conta Gemini" : provider === "openai" ? "Conta ChatGPT / Codex" : "Conta Claude";
  const label = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : fallback;

  if (!label || label.length > 120 || /[\u0000-\u001f\u007f]/.test(label)) {
    throw new AIProviderConfigError("Nome da conta invalido.");
  }

  return label;
}

function validateSessionId(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new AIProviderConfigError("Sessao de conexao invalida.");
  }

  return value;
}

function validateOAuthRedirectUrl(value: unknown, expectedState: string) {
  if (typeof value !== "string" || value.length > 8_000) {
    throw new AIProviderConfigError("Cole a URL completa exibida pelo navegador apos o login.");
  }

  let url: URL;

  try {
    url = new URL(value.trim());
  } catch {
    throw new AIProviderConfigError("A URL de retorno da conta e invalida.");
  }

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";

  if (!local || url.protocol !== "http:" || (url.username || url.password)) {
    throw new AIProviderConfigError("Use somente a URL local de retorno exibida pelo provedor.");
  }

  const returnedState = url.searchParams.get("state")?.trim() ?? "";

  if (!returnedState || returnedState !== expectedState) {
    throw new AIProviderConfigError("A URL pertence a outra tentativa de conexao. Inicie novamente.", 409);
  }

  if (!url.searchParams.get("code") && !url.searchParams.get("error")) {
    throw new AIProviderConfigError("A URL de retorno ainda nao possui o codigo de autorizacao.");
  }

  return url.toString();
}

async function getOwnedLinkSession(sessionId: unknown, actorId: string) {
  const id = validateSessionId(sessionId);
  const result = await getSupabaseAdminClient()
    .from("ai_account_link_sessions")
    .select("id,actor_id,provider,label,gateway_state,gateway_auth_ids_before,status,error_message,expires_at")
    .eq("id", id)
    .eq("actor_id", actorId)
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel carregar a conexao de conta");

  if (!result.data) throw new AIProviderConfigError("Tentativa de conexao nao encontrada.", 404);
  const session = result.data as AccountLinkSessionRow;

  if (!isAIProvider(session.provider)) throw new Error("Provedor invalido salvo na tentativa de conexao.");
  return { ...session, provider: session.provider };
}

async function auditLink(provider: AIProvider, actorId: string | null, action: "oauth_failed" | "oauth_started", metadata: Record<string, unknown>) {
  const result = await getSupabaseAdminClient().from("ai_provider_connection_events").insert({
    action,
    actor_id: actorId,
    connection_id: null,
    metadata,
    provider
  });
  throwDatabaseError(result.error, "Nao foi possivel auditar a conexao da conta");
}

function safeCleanupErrorCode(error: unknown) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code.trim()
    : "account_gateway_cleanup_failed";

  return /^[a-z0-9_.:-]{1,120}$/i.test(code) ? code : "account_gateway_cleanup_failed";
}

async function cleanupAccountGatewayOAuthBestEffort(state: string, context: string): Promise<OAuthCleanupResult> {
  try {
    await cancelAccountGatewayOAuth(state);
    return { errorCode: null, status: "succeeded" };
  } catch (error) {
    if (error instanceof AccountGatewayError && error.code === "account_gateway_http_404") {
      return { errorCode: null, status: "already_absent" };
    }

    console.error(context, error);
    return { errorCode: safeCleanupErrorCode(error), status: "failed" };
  }
}

async function safelyAuditLink(
  provider: AIProvider,
  actorId: string | null,
  action: "oauth_failed" | "oauth_started",
  metadata: Record<string, unknown>
) {
  try {
    await auditLink(provider, actorId, action, metadata);
  } catch (error) {
    console.error("Nao foi possivel registrar a auditoria da conexao de conta.", error);
  }
}

export async function startAIAccountLink(providerValue: unknown, labelValue: unknown, actorId: string) {
  if (!isAIProvider(providerValue)) throw new AIProviderConfigError("Provedor de IA invalido.");
  const provider = providerValue;
  const label = normalizeLabel(labelValue, provider);
  const supabase = getSupabaseAdminClient();
  const expiredSessionsResult = await supabase
    .from("ai_account_link_sessions")
    .select("id,actor_id,gateway_state")
    .eq("provider", provider)
    .eq("status", "pending")
    .lte("expires_at", new Date().toISOString());
  throwDatabaseError(expiredSessionsResult.error, "Nao foi possivel carregar tentativas antigas de conexao");

  const expiredSessions = await Promise.all((expiredSessionsResult.data ?? []).map(async (session) => ({
    ...session,
    cleanup: await cleanupAccountGatewayOAuthBestEffort(
      session.gateway_state,
      `Nao foi possivel limpar a sessao OAuth expirada ${session.id} no gateway.`
    )
  })));

  const expiredIds = expiredSessions.map((session) => session.id);
  const expireResult = expiredIds.length
    ? await supabase.from("ai_account_link_sessions").update({
        error_message: "Tempo de conexao esgotado.",
        status: "failed"
      }).in("id", expiredIds).eq("status", "pending")
    : { error: null };
  throwDatabaseError(expireResult.error, "Nao foi possivel expirar tentativas antigas de conexao");

  for (const expiredSession of expiredSessions) {
    await safelyAuditLink(provider, expiredSession.actor_id, "oauth_failed", {
      cleanup_error_code: expiredSession.cleanup.errorCode,
      cleanup_status: expiredSession.cleanup.status,
      error: "oauth_timeout",
      session_id: expiredSession.id
    });
  }

  const before = await listAccountGatewayAuths(provider);
  const oauth = await startAccountGatewayOAuth(provider);
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const result = await supabase.from("ai_account_link_sessions").insert({
    actor_id: actorId,
    expires_at: expiresAt,
    gateway_auth_ids_before: before.map((auth) => auth.id),
    gateway_state: oauth.state,
    label,
    provider,
    status: "pending"
  }).select("id").single();
  if (result.error || !result.data) {
    await cleanupAccountGatewayOAuthBestEffort(
      oauth.state,
      "Nao foi possivel cancelar a sessao OAuth que falhou ao persistir."
    );

    if (result.error?.code === "23505") {
      throw new AIProviderConfigError("Ja existe uma conexao deste provedor em andamento. Conclua ou cancele a tentativa aberta.", 409);
    }

    throwDatabaseError(result.error ?? { message: "O banco nao retornou a sessao criada." }, "Nao foi possivel salvar a tentativa de conexao");
  }
  await auditLink(provider, actorId, "oauth_started", { session_id: result.data!.id });

  return {
    expiresAt,
    sessionId: result.data!.id as string,
    url: oauth.url
  };
}

export async function submitAIAccountLinkCallback(sessionId: unknown, redirectUrl: unknown, actorId: string) {
  const session = await getOwnedLinkSession(sessionId, actorId);

  if (session.status !== "pending") throw new AIProviderConfigError("Esta tentativa de conexao nao esta mais ativa.", 409);
  if (new Date(session.expires_at).getTime() <= Date.now()) throw new AIProviderConfigError("Esta tentativa expirou. Inicie novamente.", 410);
  const normalizedUrl = validateOAuthRedirectUrl(redirectUrl, session.gateway_state);
  await submitAccountGatewayOAuthCallback(session.provider, session.gateway_state, normalizedUrl);
  return { status: "processing" as const };
}

export async function pollAIAccountLink(sessionId: unknown, actorId: string) {
  const session = await getOwnedLinkSession(sessionId, actorId);

  if (session.status === "completed") return { status: "completed" as const };
  if (session.status === "failed") {
    return { error: session.error_message || "A conexao da conta falhou.", status: "failed" as const };
  }
  if (session.status === "cancelled") return { status: "cancelled" as const };

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    const cleanup = await cleanupAccountGatewayOAuthBestEffort(
      session.gateway_state,
      "Nao foi possivel cancelar a sessao OAuth expirada no gateway."
    );

    const expiredResult = await getSupabaseAdminClient().from("ai_account_link_sessions").update({
      error_message: "Tempo de conexao esgotado.",
      status: "failed"
    }).eq("id", session.id).eq("status", "pending");
    throwDatabaseError(expiredResult.error, "Nao foi possivel expirar a conexao da conta");
    await safelyAuditLink(session.provider, actorId, "oauth_failed", {
      cleanup_error_code: cleanup.errorCode,
      cleanup_status: cleanup.status,
      error: "oauth_timeout",
      session_id: session.id
    });
    return { error: "Tempo de conexao esgotado. Inicie novamente.", status: "failed" as const };
  }

  const gatewayStatus = await getAccountGatewayOAuthStatus(session.gateway_state);

  if (gatewayStatus.status === "wait") return { status: "pending" as const };

  if (gatewayStatus.status === "error") {
    const message = gatewayStatus.error || "O provedor nao concluiu a conexao.";
    await getSupabaseAdminClient().from("ai_account_link_sessions").update({
      error_message: message.slice(0, 2000),
      status: "failed"
    }).eq("id", session.id);
    await auditLink(session.provider, actorId, "oauth_failed", { error: message, session_id: session.id });
    return { error: message, status: "failed" as const };
  }

  const beforeIds = new Set(Array.isArray(session.gateway_auth_ids_before)
    ? session.gateway_auth_ids_before.filter((value): value is string => typeof value === "string")
    : []);
  const accounts = await listAccountGatewayAuths(session.provider);
  const connectedAccount = accounts.find((account) => !beforeIds.has(account.id));

  if (!connectedAccount) {
    const message = "O login terminou, mas nenhuma nova conta foi encontrada no gateway.";
    await getSupabaseAdminClient().from("ai_account_link_sessions").update({
      error_message: message,
      status: "failed"
    }).eq("id", session.id);
    await auditLink(session.provider, actorId, "oauth_failed", { error: message, session_id: session.id });
    return { error: message, status: "failed" as const };
  }

  const connection = await upsertAccountGatewayConnection({
    actorId,
    auth: connectedAccount,
    label: session.label
  });
  const completedAt = new Date().toISOString();
  const completeResult = await getSupabaseAdminClient().from("ai_account_link_sessions").update({
    completed_at: completedAt,
    status: "completed"
  }).eq("id", session.id);
  throwDatabaseError(completeResult.error, "Nao foi possivel concluir o registro da conta");
  return { connection, status: "completed" as const };
}

export async function cancelAIAccountLink(sessionId: unknown, actorId: string) {
  const session = await getOwnedLinkSession(sessionId, actorId);

  if (session.status === "pending") {
    const cleanup = await cleanupAccountGatewayOAuthBestEffort(
      session.gateway_state,
      "Nao foi possivel remover a sessao OAuth cancelada do gateway."
    );
    const result = await getSupabaseAdminClient().from("ai_account_link_sessions").update({
      status: "cancelled"
    }).eq("id", session.id).eq("status", "pending");
    throwDatabaseError(result.error, "Nao foi possivel cancelar a conexao da conta");

    if (cleanup.status === "failed") {
      await safelyAuditLink(session.provider, actorId, "oauth_failed", {
        cleanup_error_code: cleanup.errorCode,
        cleanup_status: cleanup.status,
        error: "oauth_cleanup_failed_after_cancel",
        session_id: session.id
      });
    }
  }

  return { status: "cancelled" as const };
}
