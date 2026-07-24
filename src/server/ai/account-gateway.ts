import "server-only";

import type { AIProvider } from "@/server/ai/types";

const managementTimeoutMs = 20_000;
const probeTimeoutMs = 3_000;
const oauthProviderPaths: Record<AIProvider, string> = {
  anthropic: "anthropic-auth-url",
  gemini: "antigravity-auth-url",
  openai: "codex-auth-url"
};
const oauthProviderNames: Record<AIProvider, string> = {
  anthropic: "anthropic",
  gemini: "antigravity",
  openai: "codex"
};

type GatewayAuthFilePayload = {
  auth_index?: unknown;
  disabled?: unknown;
  email?: unknown;
  id?: unknown;
  label?: unknown;
  name?: unknown;
  priority?: unknown;
  provider?: unknown;
  recent_requests?: unknown;
  status?: unknown;
  status_message?: unknown;
  type?: unknown;
  unavailable?: unknown;
};

type GatewayModelPayload = {
  id?: unknown;
  owned_by?: unknown;
};

export type AccountGatewayAuth = {
  authIndex: string;
  disabled: boolean;
  email: string;
  id: string;
  label: string;
  name: string;
  priority: number;
  provider: AIProvider;
  status: string;
  statusMessage: string;
  unavailable: boolean;
};

export type AccountGatewayOAuthStart = {
  state: string;
  url: string;
};

export class AccountGatewayError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "account_gateway_error", status = 502) {
    super(message);
    this.name = "AccountGatewayError";
    this.code = code;
    this.status = status;
  }
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isInteger(parsed) ? parsed : 0;
}

function parseGatewayBaseUrl(value: string | undefined) {
  const raw = value?.trim();

  if (!raw) throw new AccountGatewayError("O Bunker AI Gateway ainda nao foi configurado neste ambiente.", "account_gateway_not_configured", 503);

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new AccountGatewayError("A URL do Bunker AI Gateway e invalida.", "account_gateway_invalid_url", 503);
  }

  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";

  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.search || url.hash) {
    throw new AccountGatewayError("A URL do Bunker AI Gateway nao atende aos requisitos de seguranca.", "account_gateway_invalid_url", 503);
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function getGatewaySecret(name: "BUNKER_AI_GATEWAY_API_KEY" | "BUNKER_AI_GATEWAY_MANAGEMENT_KEY") {
  const value = process.env[name]?.trim();

  if (!value) throw new AccountGatewayError("As credenciais do Bunker AI Gateway ainda nao foram configuradas.", "account_gateway_not_configured", 503);
  return value;
}

function makeGatewayUrl(path: string) {
  const base = parseGatewayBaseUrl(process.env.BUNKER_AI_GATEWAY_URL);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return new URL(`${base.toString().replace(/\/$/, "")}${normalizedPath}`);
}

async function readGatewayPayload(response: Response) {
  const text = await response.text();

  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AccountGatewayError("O Bunker AI Gateway retornou uma resposta invalida.", "account_gateway_invalid_response");
  }
}

async function gatewayManagementRequest(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), managementTimeoutMs);

  try {
    const response = await fetch(makeGatewayUrl(path), {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${getGatewaySecret("BUNKER_AI_GATEWAY_MANAGEMENT_KEY")}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers
      },
      redirect: "error",
      signal: controller.signal
    });
    const payload = await readGatewayPayload(response) as Record<string, unknown>;

    if (!response.ok) {
      const detail = readString(payload.error);
      throw new AccountGatewayError(
        detail ? `O Bunker AI Gateway recusou a operacao: ${detail}` : `O Bunker AI Gateway respondeu com HTTP ${response.status}.`,
        `account_gateway_http_${response.status}`,
        response.status >= 500 ? 502 : response.status
      );
    }

    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AccountGatewayError("O Bunker AI Gateway demorou demais para responder.", "account_gateway_timeout", 504);
    }

    if (error instanceof AccountGatewayError) throw error;
    throw new AccountGatewayError("Nao foi possivel conectar ao Bunker AI Gateway.", "account_gateway_network_error");
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeGatewayProvider(value: unknown): AIProvider | null {
  const provider = readString(value).toLowerCase();

  if (provider === "codex" || provider === "openai") return "openai";
  if (provider === "claude" || provider === "anthropic") return "anthropic";
  if (provider === "antigravity" || provider === "gemini" || provider === "gemini-cli") return "gemini";
  return null;
}

function normalizeGatewayModelProvider(model: GatewayModelPayload): AIProvider | null {
  const id = readString(model.id).toLowerCase();
  const owner = readString(model.owned_by).toLowerCase();

  if (owner.includes("openai") || owner.includes("codex") || /^(?:gpt|o\d|codex)-/.test(id)) return "openai";
  if (owner.includes("anthropic") || /^claude-/.test(id)) return "anthropic";
  if (owner.includes("google") || owner.includes("gemini") || /^gemini-/.test(id)) return "gemini";
  return null;
}

function isTutorTextModel(id: string) {
  return !/(?:image|embedding|moderation|transcri|speech|audio|realtime|tts|auto-review)/i.test(id);
}

export function getAccountGatewayRuntimeConfig() {
  return {
    apiKey: getGatewaySecret("BUNKER_AI_GATEWAY_API_KEY"),
    baseUrl: parseGatewayBaseUrl(process.env.BUNKER_AI_GATEWAY_URL).toString().replace(/\/$/, "")
  };
}

export function getAccountGatewayConfigurationStatus() {
  const configured = Boolean(
    process.env.BUNKER_AI_GATEWAY_URL?.trim()
    && process.env.BUNKER_AI_GATEWAY_API_KEY?.trim()
    && process.env.BUNKER_AI_GATEWAY_MANAGEMENT_KEY?.trim()
  );

  return {
    configured,
    reachable: false,
    message: configured
      ? "Gateway configurado. Verificando disponibilidade..."
      : "Configure o Bunker AI Gateway para liberar conexoes por conta."
  };
}

export async function getAccountGatewayStatus() {
  const configuration = getAccountGatewayConfigurationStatus();

  if (!configuration.configured) return configuration;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);

  try {
    const response = await fetch(makeGatewayUrl("/v1/models"), {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${getGatewaySecret("BUNKER_AI_GATEWAY_API_KEY")}`
      },
      redirect: "error",
      signal: controller.signal
    });
    await response.body?.cancel();

    if (!response.ok) {
      return {
        configured: true,
        reachable: false,
        message: `Gateway configurado, mas indisponivel (HTTP ${response.status}). Verifique o servico antes de conectar uma conta.`
      };
    }

    return {
      configured: true,
      reachable: true,
      message: "Gateway persistente conectado e pronto para alternar contas."
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      message: "Gateway configurado, mas indisponivel. Verifique se o servico esta ativo antes de conectar uma conta."
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function listAccountGatewayAuths(provider?: AIProvider) {
  const payload = await gatewayManagementRequest("/v0/management/auth-files");
  const files = Array.isArray(payload.files) ? payload.files as GatewayAuthFilePayload[] : [];

  return files.flatMap((file) => {
    const normalizedProvider = normalizeGatewayProvider(file.provider ?? file.type);

    if (!normalizedProvider || (provider && normalizedProvider !== provider)) return [];
    const id = readString(file.id) || readString(file.name);

    if (!id) return [];
    const email = readString(file.email);
    const name = readString(file.name) || id;

    return [{
      authIndex: readString(file.auth_index),
      disabled: file.disabled === true,
      email,
      id,
      label: readString(file.label) || email || name,
      name,
      priority: readInteger(file.priority),
      provider: normalizedProvider,
      status: readString(file.status) || "active",
      statusMessage: readString(file.status_message),
      unavailable: file.unavailable === true
    } satisfies AccountGatewayAuth];
  });
}

export async function listAccountGatewayModels(provider: AIProvider) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), probeTimeoutMs);

  try {
    const response = await fetch(makeGatewayUrl("/v1/models"), {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${getGatewaySecret("BUNKER_AI_GATEWAY_API_KEY")}`
      },
      redirect: "error",
      signal: controller.signal
    });
    const payload = await readGatewayPayload(response) as { data?: GatewayModelPayload[] };

    if (!response.ok) {
      throw new AccountGatewayError(
        `O Bunker AI Gateway respondeu com HTTP ${response.status} ao listar modelos.`,
        `account_gateway_http_${response.status}`,
        response.status >= 500 ? 502 : response.status
      );
    }

    const models = Array.isArray(payload.data) ? payload.data : [];
    return [...new Set(models.flatMap((model) => {
      const id = readString(model.id);
      return id && normalizeGatewayModelProvider(model) === provider && isTutorTextModel(id) ? [id] : [];
    }))].sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AccountGatewayError("O Bunker AI Gateway demorou demais para listar modelos.", "account_gateway_timeout", 504);
    }

    if (error instanceof AccountGatewayError) throw error;
    throw new AccountGatewayError("Nao foi possivel carregar os modelos das contas conectadas.", "account_gateway_network_error");
  } finally {
    clearTimeout(timeout);
  }
}

export async function startAccountGatewayOAuth(provider: AIProvider) {
  // The producer pastes the localhost callback URL back into Bunker707. Asking
  // CLIProxyAPI for its Web UI mode would start a fixed callback listener in
  // the gateway container (where the producer's browser cannot reach it) and
  // would also serialize concurrent logins for the same provider by port.
  const payload = await gatewayManagementRequest(`/v0/management/${oauthProviderPaths[provider]}`);
  const state = readString(payload.state);
  const url = readString(payload.url);

  if (!state || !url) {
    throw new AccountGatewayError("O gateway nao iniciou a conexao com a conta.", "account_gateway_oauth_invalid_response");
  }

  return { state, url } satisfies AccountGatewayOAuthStart;
}

export async function submitAccountGatewayOAuthCallback(provider: AIProvider, state: string, redirectUrl: string) {
  await gatewayManagementRequest("/v0/management/oauth-callback", {
    body: JSON.stringify({
      provider: oauthProviderNames[provider],
      redirect_url: redirectUrl,
      state
    }),
    method: "POST"
  });
}

export async function getAccountGatewayOAuthStatus(state: string) {
  const query = new URLSearchParams({ state });
  const payload = await gatewayManagementRequest(`/v0/management/get-auth-status?${query.toString()}`);
  const status = readString(payload.status);

  return {
    error: readString(payload.error),
    status: status === "ok" || status === "error" ? status : "wait"
  } as const;
}

export async function cancelAccountGatewayOAuth(state: string) {
  const query = new URLSearchParams({ state });
  await gatewayManagementRequest(`/v0/management/oauth-session?${query.toString()}`, { method: "DELETE" });
}

export async function setAccountGatewayAuthPaused(gatewayAuthId: string, paused: boolean) {
  await gatewayManagementRequest("/v0/management/auth-files/status", {
    body: JSON.stringify({ disabled: paused, name: gatewayAuthId }),
    method: "PATCH"
  });
}

export async function setAccountGatewayAuthPriority(gatewayAuthId: string, priority: number) {
  await gatewayManagementRequest("/v0/management/auth-files/fields", {
    body: JSON.stringify({ name: gatewayAuthId, priority }),
    method: "PATCH"
  });
}

export async function deleteAccountGatewayAuth(gatewayAuthId: string) {
  const query = new URLSearchParams({ name: gatewayAuthId });
  await gatewayManagementRequest(`/v0/management/auth-files?${query.toString()}`, { method: "DELETE" });
}
