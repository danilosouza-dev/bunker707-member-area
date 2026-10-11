// Regras puras de Configuracoes › Tutor IA (docs/17 §1.10): provedores, politica por provedor,
// estado das conexoes e consumo. Sem React e sem aliases: tests/admin-settings-ai.test.mjs carrega
// este arquivo direto pelo Node. As telas e o resumo do hub de Configuracoes usam daqui.
//
// Os limites espelham a validacao do servidor (src/server/ai/provider-config.ts), para o erro
// aparecer no campo ao sair dele, antes de ir a rota.

export const AI_PROVIDER_IDS = ["gemini", "openai", "anthropic"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export type AiProviderMeta = {
  defaultModel: string;
  id: AiProviderId;
  label: string;
  /** Nome curto para pilulas e listas. */
  shortLabel: string;
};

export const AI_PROVIDERS: readonly AiProviderMeta[] = [
  { defaultModel: "gemini-3.1-flash-lite", id: "gemini", label: "Google Gemini", shortLabel: "Gemini" },
  { defaultModel: "gpt-4.1-mini", id: "openai", label: "OpenAI / ChatGPT", shortLabel: "ChatGPT" },
  { defaultModel: "claude-haiku-4-5-20251001", id: "anthropic", label: "Anthropic / Claude", shortLabel: "Claude" }
];

export const AI_PROVIDER_PARAM = "provedor";

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Le ?provedor= do endereco; qualquer outra coisa volta para o primeiro provedor. */
export function parseAiProviderParam(value: string | string[] | null | undefined, fallback: AiProviderId = "gemini"): AiProviderId {
  const candidate = Array.isArray(value) ? value[0] : value;

  return isAiProviderId(candidate) ? candidate : fallback;
}

export function getAiProviderMeta(provider: AiProviderId): AiProviderMeta {
  return AI_PROVIDERS.find((item) => item.id === provider) ?? AI_PROVIDERS[0];
}

/* ------------------------------------------------------------------------------------------------
 * Politica do provedor (modelo e limites)
 * ---------------------------------------------------------------------------------------------- */

/** Mesmo formato de AIProviderConfig (src/server/ai/types.ts), so com o que a tela usa. */
export type AiPolicyConfig = {
  contextMaxCharacters: number;
  dailyQuestionLimit: number;
  defaultModel: string;
  enabled: boolean;
  isDefault: boolean;
  maxOutputTokens: number;
  monthlyQuestionLimit: number;
  priority: number;
  provider: AiProviderId;
  status?: "configured" | "needs_attention";
  temperature: number;
};

export type AiPolicyForm = {
  contextMaxCharacters: string;
  dailyQuestionLimit: string;
  defaultModel: string;
  enabled: boolean;
  isDefault: boolean;
  maxOutputTokens: string;
  monthlyQuestionLimit: string;
  priority: string;
  temperature: string;
};

export type AiPolicyNumberField = Exclude<keyof AiPolicyForm, "defaultModel" | "enabled" | "isDefault">;

type NumberRule = { integer: boolean; label: string; max: number; min: number };

export const AI_POLICY_NUMBER_RULES: Record<AiPolicyNumberField, NumberRule> = {
  contextMaxCharacters: { integer: true, label: "Tamanho máximo do contexto", max: 500_000, min: 5_000 },
  dailyQuestionLimit: { integer: true, label: "Perguntas por aluno em 24 h", max: 10_000, min: 1 },
  maxOutputTokens: { integer: true, label: "Tamanho máximo da resposta", max: 8_192, min: 64 },
  monthlyQuestionLimit: { integer: true, label: "Perguntas por mês neste provedor", max: 10_000_000, min: 1 },
  priority: { integer: true, label: "Prioridade", max: 1_000, min: -1_000 },
  temperature: { integer: false, label: "Temperatura", max: 1, min: 0 }
};

export function makeAiPolicyForm(provider: AiProviderId, config?: AiPolicyConfig | null): AiPolicyForm {
  return {
    contextMaxCharacters: String(config?.contextMaxCharacters ?? 60_000),
    dailyQuestionLimit: String(config?.dailyQuestionLimit ?? 20),
    defaultModel: config?.defaultModel ?? getAiProviderMeta(provider).defaultModel,
    enabled: config?.enabled ?? true,
    isDefault: config?.isDefault ?? false,
    maxOutputTokens: String(config?.maxOutputTokens ?? 900),
    monthlyQuestionLimit: String(config?.monthlyQuestionLimit ?? 10_000),
    priority: String(config?.priority ?? 0),
    // Virgula decimal, como o produtor escreve; parseLocaleNumber aceita as duas.
    temperature: String(config?.temperature ?? 0.2).replace(".", ",")
  };
}

const integerFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

/** Aceita "0,3" e "0.3"; devolve NaN para texto que nao e numero. */
export function parseLocaleNumber(value: string) {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");

  if (!normalized || !/^-?\d+(\.\d+)?$/.test(normalized)) {
    return Number.NaN;
  }

  return Number(normalized);
}

export function validateAiPolicyNumber(field: AiPolicyNumberField, value: string): string | null {
  const rule = AI_POLICY_NUMBER_RULES[field];
  const parsed = parseLocaleNumber(value);

  if (!Number.isFinite(parsed)) {
    return "Informe um número.";
  }

  if (rule.integer && !Number.isInteger(parsed)) {
    return "Use um número inteiro.";
  }

  if (parsed < rule.min || parsed > rule.max) {
    const min = rule.integer ? integerFormatter.format(rule.min) : String(rule.min).replace(".", ",");
    const max = rule.integer ? integerFormatter.format(rule.max) : String(rule.max).replace(".", ",");

    return `Use um valor entre ${min} e ${max}.`;
  }

  return null;
}

export function validateAiModel(value: string): string | null {
  const model = value.trim();

  if (!model) {
    return "Informe o modelo.";
  }

  if (model.length > 160 || /[\u0000-\u001f\u007f]/.test(model)) {
    return "Modelo inválido.";
  }

  return null;
}

export type AiPolicyErrors = Partial<Record<keyof AiPolicyForm, string>>;

export function validateAiPolicyForm(form: AiPolicyForm): AiPolicyErrors {
  const errors: AiPolicyErrors = {};
  const modelError = validateAiModel(form.defaultModel);

  if (modelError) {
    errors.defaultModel = modelError;
  }

  for (const field of Object.keys(AI_POLICY_NUMBER_RULES) as AiPolicyNumberField[]) {
    const error = validateAiPolicyNumber(field, form[field]);

    if (error) {
      errors[field] = error;
    }
  }

  return errors;
}

/** Corpo do PUT /api/admin/ai-providers (mesmo formato que o admin antigo envia). */
export function aiPolicyFormToPayload(provider: AiProviderId, form: AiPolicyForm) {
  return {
    contextMaxCharacters: parseLocaleNumber(form.contextMaxCharacters),
    dailyQuestionLimit: parseLocaleNumber(form.dailyQuestionLimit),
    defaultModel: form.defaultModel.trim(),
    enabled: form.enabled,
    isDefault: form.isDefault,
    maxOutputTokens: parseLocaleNumber(form.maxOutputTokens),
    monthlyQuestionLimit: parseLocaleNumber(form.monthlyQuestionLimit),
    priority: parseLocaleNumber(form.priority),
    provider,
    temperature: parseLocaleNumber(form.temperature)
  };
}

export function isAiPolicyFormDirty(left: AiPolicyForm, right: AiPolicyForm) {
  return (Object.keys(left) as (keyof AiPolicyForm)[]).some((key) => left[key] !== right[key]);
}

/* ------------------------------------------------------------------------------------------------
 * Conexoes (chaves de API e contas)
 * ---------------------------------------------------------------------------------------------- */

export type AiConnectionAuthMode = "api_key" | "account_gateway";
export type AiConnectionStatus = "active" | "paused" | "needs_attention" | "connecting";

/** Mesmo formato de AIProviderConnection (src/server/ai/types.ts), so com o que a tela usa. */
export type AiConnectionSummary = {
  authMode: AiConnectionAuthMode;
  cooldownUntil: string | null;
  credentialHint: string;
  healthTier: "draining" | "healthy" | "probing";
  id: string;
  label: string;
  lastErrorMessage: string | null;
  lastTestedAt: string | null;
  lastUsedAt: string | null;
  priority: number;
  provider: AiProviderId;
  status: AiConnectionStatus;
};

export type AiTone = "success" | "warning" | "error" | "neutral" | "muted";

export function describeAiConnectionState(
  connection: Pick<AiConnectionSummary, "cooldownUntil" | "healthTier" | "status">,
  now: Date = new Date()
): { label: string; tone: AiTone } {
  if (connection.status === "paused") {
    return { label: "Pausada", tone: "muted" };
  }

  if (connection.status === "needs_attention") {
    return { label: "Precisa de atenção", tone: "error" };
  }

  if (connection.status === "connecting") {
    return { label: "Conectando", tone: "warning" };
  }

  if (connection.cooldownUntil && new Date(connection.cooldownUntil).getTime() > now.getTime()) {
    return { label: "Em espera", tone: "warning" };
  }

  if (connection.healthTier === "draining") {
    return { label: "Instável", tone: "warning" };
  }

  if (connection.healthTier === "probing") {
    return { label: "Recuperando", tone: "warning" };
  }

  return { label: "Funcionando", tone: "success" };
}

export function countConnectionsByProvider(connections: readonly Pick<AiConnectionSummary, "provider" | "status">[]) {
  const counts: Record<AiProviderId, { active: number; total: number }> = {
    anthropic: { active: 0, total: 0 },
    gemini: { active: 0, total: 0 },
    openai: { active: 0, total: 0 }
  };

  for (const connection of connections) {
    const entry = counts[connection.provider];

    if (!entry) {
      continue;
    }

    entry.total += 1;

    if (connection.status === "active") {
      entry.active += 1;
    }
  }

  return counts;
}

/**
 * Estado do Tutor IA para o hub de Configuracoes, sem exagero: "Conectado" so quando um provedor
 * ligado tem ao menos uma conexao ativa; com conexao, mas todas com problema, "Precisa de atenção".
 */
export function summarizeAiSetup(
  configs: readonly Pick<AiPolicyConfig, "enabled" | "provider" | "status">[],
  connections: readonly Pick<AiConnectionSummary, "provider" | "status">[]
): { label: string; tone: AiTone } {
  const enabled = configs.filter((config) => config.enabled);

  if (enabled.length === 0) {
    return { label: "Em configuração", tone: "warning" };
  }

  const counts = countConnectionsByProvider(connections);
  const working = enabled.some((config) => config.status !== "needs_attention" && counts[config.provider]?.active > 0);

  if (working) {
    return { label: "Conectado", tone: "success" };
  }

  const hasAnyConnection = enabled.some((config) => (counts[config.provider]?.total ?? 0) > 0);

  return hasAnyConnection ? { label: "Precisa de atenção", tone: "error" } : { label: "Em configuração", tone: "warning" };
}

/* ------------------------------------------------------------------------------------------------
 * Consumo
 * ---------------------------------------------------------------------------------------------- */

export type AiUsageDay = {
  answers: number;
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AiUsageSeriesPoint = AiUsageDay & { label: string };

function toIsoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dayLabel(isoDay: string) {
  const [, month, day] = isoDay.split("-");

  return `${day}/${month}`;
}

/**
 * Serie diaria completa do periodo: o resumo so traz os dias com uso; os dias sem uso entram
 * com zero (a linha nao "pula" de um dia com uso para outro). Datas em UTC, como no banco.
 */
export function buildAiUsageSeries(byDay: readonly AiUsageDay[], days: number, now: Date = new Date()): AiUsageSeriesPoint[] {
  const total = Math.max(1, Math.min(365, Math.floor(days)));
  const byDate = new Map(byDay.map((entry) => [String(entry.date).slice(0, 10), entry]));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const points: AiUsageSeriesPoint[] = [];

  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const day = new Date(end.getTime() - offset * 86_400_000);
    const iso = toIsoDay(day);
    const entry = byDate.get(iso);

    points.push({
      answers: Number(entry?.answers ?? 0),
      date: iso,
      inputTokens: Number(entry?.inputTokens ?? 0),
      label: dayLabel(iso),
      outputTokens: Number(entry?.outputTokens ?? 0),
      totalTokens: Number(entry?.totalTokens ?? 0)
    });
  }

  return points;
}

/** Balde do periodo como vem de listAdminPeriodBuckets (src/components/admin/v2/period.ts). */
export type AiUsagePeriodBucket = { key: string; label: string; longLabel: string };

/** Linha do resumo por balde (get_ai_usage_summary_between): "2026-10-05" ou "2026-10-05T14". */
export type AiUsageBucketRow = {
  answers: number;
  bucket: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AiUsageBucketPoint = {
  answers: number;
  inputTokens: number;
  key: string;
  /** Eixo: "05/10", "14h" ou "05/10 14h". */
  label: string;
  /** Dica do grafico e linha da tabela por extenso: "Domingo, 5 de outubro, 14h". */
  longLabel: string;
  outputTokens: number;
  totalTokens: number;
};

/**
 * Serie do grafico de consumo no periodo escolhido: um ponto por balde (hora ou dia, no fuso da
 * escola), na ordem do tempo. O resumo so traz os baldes com uso; os outros entram com zero, e
 * baldes fora do periodo ficam de fora (nunca um ponto inventado).
 */
export function buildAiUsageBucketSeries(
  rows: readonly AiUsageBucketRow[],
  buckets: readonly AiUsagePeriodBucket[]
): AiUsageBucketPoint[] {
  const byKey = new Map(rows.map((row) => [String(row.bucket), row]));

  return buckets.map((bucket) => {
    const row = byKey.get(bucket.key);

    return {
      answers: Number(row?.answers ?? 0) || 0,
      inputTokens: Number(row?.inputTokens ?? 0) || 0,
      key: bucket.key,
      label: bucket.label,
      longLabel: bucket.longLabel,
      outputTokens: Number(row?.outputTokens ?? 0) || 0,
      totalTokens: Number(row?.totalTokens ?? 0) || 0
    };
  });
}

const compactFormatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, notation: "compact" });
const plainFormatter = new Intl.NumberFormat("pt-BR");

export function formatAiNumber(value: number | null | undefined) {
  return plainFormatter.format(Number(value) || 0);
}

/** 1.234.567 -> "1,2 mi"; numeros pequenos ficam inteiros. */
export function formatAiCompact(value: number | null | undefined) {
  const number = Number(value) || 0;

  return Math.abs(number) < 10_000 ? plainFormatter.format(number) : compactFormatter.format(number);
}

/** Taxa de falhas em %, com uma casa; null sem tentativas. */
export function aiFailureRate(answers: number, failures: number) {
  const attempts = (Number(answers) || 0) + (Number(failures) || 0);

  return attempts > 0 ? Math.round(((Number(failures) || 0) / attempts) * 1000) / 10 : null;
}

const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo"
});

export function formatAiDateTime(value: string | null | undefined, fallback = "Nunca") {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? fallback : dateTimeFormatter.format(date);
}

/* ------------------------------------------------------------------------------------------------
 * Resumo de cada provedor (seletor no topo das telas)
 * ---------------------------------------------------------------------------------------------- */

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

export function describeAiPolicyStatus(config: Pick<AiPolicyConfig, "enabled" | "isDefault" | "status"> | null | undefined): {
  label: string;
  tone: AiTone;
} {
  if (!config) {
    return { label: "Não configurado", tone: "muted" };
  }

  if (config.status === "needs_attention") {
    return { label: "Precisa de atenção", tone: "error" };
  }

  if (!config.enabled) {
    return { label: "Desligado", tone: "muted" };
  }

  return config.isDefault ? { label: "Primeiro da fila", tone: "success" } : { label: "Ligado", tone: "success" };
}

export function buildAiProviderEntries(
  mode: "policy" | "connections",
  configs: readonly AiPolicyConfig[],
  connections: readonly Pick<AiConnectionSummary, "authMode" | "provider" | "status">[]
) {
  return AI_PROVIDERS.map((meta) => {
    const config = configs.find((item) => item.provider === meta.id) ?? null;
    const own = connections.filter((connection) => connection.provider === meta.id);

    if (mode === "policy") {
      return {
        detail: config?.defaultModel ?? "Escolha o modelo para ligar",
        provider: meta.id,
        status: describeAiPolicyStatus(config)
      };
    }

    const keys = own.filter((connection) => connection.authMode === "api_key").length;
    const accounts = own.length - keys;
    const active = own.filter((connection) => connection.status === "active").length;
    const detail = own.length === 0 ? "Nenhuma conexão" : `${plural(keys, "chave", "chaves")} · ${plural(accounts, "conta", "contas")}`;
    const status: { label: string; tone: AiTone } =
      own.length === 0
        ? { label: "Sem conexão", tone: "muted" }
        : active > 0
          ? { label: plural(active, "ativa", "ativas"), tone: "success" }
          : { label: "Nenhuma ativa", tone: "warning" };

    return { detail, provider: meta.id, status };
  });
}
