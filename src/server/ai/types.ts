export const aiProviders = ["gemini", "openai", "anthropic"] as const;

export type AIProvider = (typeof aiProviders)[number];

export const aiProviderAuthModes = ["api_key", "account_gateway"] as const;
export type AIProviderAuthMode = (typeof aiProviderAuthModes)[number];

export const aiProviderConnectionStatuses = ["active", "paused", "needs_attention", "connecting"] as const;
export type AIProviderConnectionStatus = (typeof aiProviderConnectionStatuses)[number];

export type AIConversationMessage = {
  content: string;
  role: "assistant" | "user";
};

export type AIProviderGeneration = {
  gatewayRequestId: string | null;
  inputTokens: number;
  outputTokens: number;
  text: string;
};

export type AIProviderRuntimeConfig = {
  apiKey: string;
  authMode: AIProviderAuthMode;
  connectionId: string;
  gatewayAuthId: string | null;
  gatewayBaseUrl: string | null;
  healthTier: "draining" | "healthy" | "probing";
  maxOutputTokens: number;
  model: string;
  provider: AIProvider;
  temperature: number;
};

export type AIProviderConfig = {
  contextMaxCharacters: number;
  dailyQuestionLimit: number;
  defaultModel: string;
  enabled: boolean;
  isDefault: boolean;
  lastTestedAt: string | null;
  maxOutputTokens: number;
  monthlyQuestionLimit: number;
  priority: number;
  provider: AIProvider;
  status: "configured" | "needs_attention";
  temperature: number;
  updatedAt: string;
};

export type AIProviderConnection = {
  authMode: AIProviderAuthMode;
  consecutiveFailures: number;
  cooldownUntil: string | null;
  credentialHint: string;
  gatewayAuthId: string | null;
  healthTier: "draining" | "healthy" | "probing";
  id: string;
  label: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  lastTestedAt: string | null;
  lastUsedAt: string | null;
  priority: number;
  provider: AIProvider;
  status: AIProviderConnectionStatus;
  updatedAt: string;
};

export type AIProviderAttempt = {
  authMode: AIProviderAuthMode;
  connectionId: string;
  errorCode: string | null;
  finishedAt: string;
  provider: AIProvider;
  startedAt: string;
  success: boolean;
};

export function isAIProvider(value: unknown): value is AIProvider {
  return typeof value === "string" && aiProviders.includes(value as AIProvider);
}

export function isAIProviderAuthMode(value: unknown): value is AIProviderAuthMode {
  return typeof value === "string" && aiProviderAuthModes.includes(value as AIProviderAuthMode);
}
