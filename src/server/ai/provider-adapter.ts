import "server-only";

import type {
  AIConversationMessage,
  AIProviderGeneration,
  AIProviderRuntimeConfig
} from "@/server/ai/types";

const providerRequestTimeoutMs = 45_000;
const providerResponseMaxBytes = 2 * 1024 * 1024;

export class AIProviderError extends Error {
  code: string;
  retryAfterMs: number | null;
  scope: "connection" | "provider";

  constructor(
    message: string,
    code: string,
    options: {
      retryAfterMs?: number | null;
      scope?: "connection" | "provider";
    } = {}
  ) {
    super(message);
    this.name = "AIProviderError";
    this.code = code;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.scope = options.scope ?? "connection";
  }
}

function providerDisplayName(provider: AIProviderRuntimeConfig["provider"]) {
  if (provider === "gemini") return "Gemini";
  if (provider === "openai") return "OpenAI";
  return "Claude";
}

async function readProviderJson(response: Response) {
  const contentLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > providerResponseMaxBytes) {
    throw new AIProviderError("O provedor retornou uma resposta acima do limite seguro.", "response_too_large");
  }

  const text = await response.text();

  if (text.length > providerResponseMaxBytes) {
    throw new AIProviderError("O provedor retornou uma resposta acima do limite seguro.", "response_too_large");
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AIProviderError("O provedor retornou uma resposta invalida.", "invalid_provider_response");
  }
}

function readRetryAfterMs(response: Response) {
  const raw = response.headers.get("retry-after")?.trim();

  if (!raw) return null;
  const seconds = Number(raw);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(24 * 60 * 60 * 1000, Math.ceil(seconds * 1000));
  }

  const date = Date.parse(raw);
  if (!Number.isFinite(date)) return null;
  return Math.min(24 * 60 * 60 * 1000, Math.max(0, date - Date.now()));
}

function assertProviderResponse(response: Response, config: AIProviderRuntimeConfig) {
  if (response.ok) return;

  const displayName = providerDisplayName(config.provider);
  const credentialLabel = config.authMode === "account_gateway" ? "A conta conectada ou sua permissao" : "A chave ou permissao";
  const message = response.status === 401 || response.status === 403
    ? `${credentialLabel} do ${displayName} foi recusada.`
    : response.status === 402
      ? `A conta do ${displayName} nao possui um plano ou saldo disponivel para esta solicitacao.`
      : response.status === 429
        ? `O ${displayName} informou que o limite de uso foi atingido.`
        : response.status === 404
          ? `O modelo configurado no ${displayName} nao esta disponivel. Escolha um modelo atual e teste novamente.`
          : `O ${displayName} nao conseguiu gerar a resposta (HTTP ${response.status}).`;

  const connectionScoped = response.status === 401
    || response.status === 402
    || response.status === 403
    || response.status === 408
    || response.status === 429
    || response.status >= 500;

  throw new AIProviderError(message, `provider_http_${response.status}`, {
    retryAfterMs: readRetryAfterMs(response),
    scope: connectionScoped ? "connection" : "provider"
  });
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

async function callGemini(
  config: AIProviderRuntimeConfig,
  system: string,
  messages: AIConversationMessage[],
  signal: AbortSignal
): Promise<AIProviderGeneration> {
  const model = config.model.replace(/^models\//, "");
  const endpoint = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`);

  const response = await fetch(endpoint, {
    body: JSON.stringify({
      contents: messages.map((message) => ({
        parts: [{ text: message.content }],
        role: message.role === "assistant" ? "model" : "user"
      })),
      generationConfig: {
        maxOutputTokens: config.maxOutputTokens,
        temperature: config.temperature
      },
      systemInstruction: {
        parts: [{ text: system }]
      }
    }),
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": config.apiKey
    },
    method: "POST",
    redirect: "error",
    signal
  });
  assertProviderResponse(response, config);
  const payload = await readProviderJson(response) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
    usageMetadata?: { candidatesTokenCount?: unknown; promptTokenCount?: unknown };
  };
  const text = (payload.candidates?.[0]?.content?.parts ?? [])
    .map((part) => readString(part.text))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {
    throw new AIProviderError("O Gemini nao retornou texto para esta solicitacao.", "empty_provider_response");
  }

  return {
    gatewayRequestId: null,
    inputTokens: readNumber(payload.usageMetadata?.promptTokenCount),
    outputTokens: readNumber(payload.usageMetadata?.candidatesTokenCount),
    text
  };
}

async function callOpenAI(
  config: AIProviderRuntimeConfig,
  system: string,
  messages: AIConversationMessage[],
  signal: AbortSignal
): Promise<AIProviderGeneration> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    body: JSON.stringify({
      input: messages.map((message) => ({ content: message.content, role: message.role })),
      instructions: system,
      max_output_tokens: config.maxOutputTokens,
      model: config.model,
      temperature: config.temperature
    }),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    method: "POST",
    signal
  });
  assertProviderResponse(response, config);
  const payload = await readProviderJson(response) as {
    output?: Array<{ content?: Array<{ text?: unknown; type?: unknown }> }>;
    output_text?: unknown;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  const text = readString(payload.output_text) || (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((item) => readString(item.text))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {
    throw new AIProviderError("A OpenAI nao retornou texto para esta solicitacao.", "empty_provider_response");
  }

  return {
    gatewayRequestId: null,
    inputTokens: readNumber(payload.usage?.input_tokens),
    outputTokens: readNumber(payload.usage?.output_tokens),
    text
  };
}

async function callAnthropic(
  config: AIProviderRuntimeConfig,
  system: string,
  messages: AIConversationMessage[],
  signal: AbortSignal
): Promise<AIProviderGeneration> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    body: JSON.stringify({
      max_tokens: config.maxOutputTokens,
      messages: messages.map((message) => ({ content: message.content, role: message.role })),
      model: config.model,
      system,
      temperature: config.temperature
    }),
    cache: "no-store",
    headers: {
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      "x-api-key": config.apiKey
    },
    method: "POST",
    signal
  });
  assertProviderResponse(response, config);
  const payload = await readProviderJson(response) as {
    content?: Array<{ text?: unknown; type?: unknown }>;
    usage?: { input_tokens?: unknown; output_tokens?: unknown };
  };
  const text = (payload.content ?? [])
    .map((item) => readString(item.text))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {
    throw new AIProviderError("O Claude nao retornou texto para esta solicitacao.", "empty_provider_response");
  }

  return {
    gatewayRequestId: null,
    inputTokens: readNumber(payload.usage?.input_tokens),
    outputTokens: readNumber(payload.usage?.output_tokens),
    text
  };
}

async function callAccountGateway(
  config: AIProviderRuntimeConfig,
  system: string,
  messages: AIConversationMessage[],
  signal: AbortSignal
): Promise<AIProviderGeneration> {
  if (!config.gatewayBaseUrl || !config.gatewayAuthId) {
    throw new AIProviderError("A conta conectada nao possui uma rota valida no gateway.", "account_gateway_invalid_connection");
  }

  const requestId = crypto.randomUUID();
  const response = await fetch(`${config.gatewayBaseUrl}/v1/chat/completions`, {
    body: JSON.stringify({
      max_tokens: config.maxOutputTokens,
      messages: [
        { content: system, role: "system" },
        ...messages.map((message) => ({ content: message.content, role: message.role }))
      ],
      model: config.model,
      stream: false,
      temperature: config.temperature
    }),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": requestId,
      "X-Bunker-Auth-ID": config.gatewayAuthId,
      "X-Client-Request-Id": requestId
    },
    method: "POST",
    signal
  });
  assertProviderResponse(response, config);
  const payload = await readProviderJson(response) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    output?: Array<{ content?: Array<{ text?: unknown }> }>;
    output_text?: unknown;
    usage?: {
      completion_tokens?: unknown;
      input_tokens?: unknown;
      output_tokens?: unknown;
      prompt_tokens?: unknown;
    };
  };
  const text = readString(payload.choices?.[0]?.message?.content)
    || readString(payload.output_text)
    || (payload.output ?? [])
      .flatMap((item) => item.content ?? [])
      .map((item) => readString(item.text))
      .filter(Boolean)
      .join("\n")
      .trim();

  if (!text) {
    throw new AIProviderError("A conta conectada nao retornou texto para esta solicitacao.", "empty_provider_response");
  }

  return {
    gatewayRequestId: requestId,
    inputTokens: readNumber(payload.usage?.prompt_tokens ?? payload.usage?.input_tokens),
    outputTokens: readNumber(payload.usage?.completion_tokens ?? payload.usage?.output_tokens),
    text
  };
}

export async function generateAIText({
  config,
  messages,
  system,
  timeoutMs = providerRequestTimeoutMs
}: {
  config: AIProviderRuntimeConfig;
  messages: AIConversationMessage[];
  system: string;
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  const safeTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.max(1_000, Math.min(providerRequestTimeoutMs, Math.floor(timeoutMs)))
    : providerRequestTimeoutMs;
  const timeout = setTimeout(() => controller.abort(), safeTimeoutMs);

  try {
    if (config.authMode === "account_gateway") {
      return await callAccountGateway(config, system, messages, controller.signal);
    }

    if (config.provider === "gemini") {
      return await callGemini(config, system, messages, controller.signal);
    }

    if (config.provider === "openai") {
      return await callOpenAI(config, system, messages, controller.signal);
    }

    return await callAnthropic(config, system, messages, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AIProviderError("O provedor demorou demais para responder.", "provider_timeout");
    }

    if (error instanceof AIProviderError) throw error;
    throw new AIProviderError("Nao foi possivel conectar ao provedor de IA.", "provider_network_error");
  } finally {
    clearTimeout(timeout);
  }
}
