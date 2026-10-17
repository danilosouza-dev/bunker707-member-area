// Leitura das variaveis de e-mail (docs/06, secao E-mail transacional). Modulo puro: o teste em
// tests/email-config.test.mjs chama `readEmailConfig` com objetos de ambiente montados na hora.

export const EMAIL_PROVIDERS = ["resend", "none"] as const;
export type EmailProviderName = (typeof EMAIL_PROVIDERS)[number];

/** Abaixo dos 100 e-mails/dia do Resend Free; os e-mails do Supabase Auth (SMTP) nao entram nesta conta. */
export const DEFAULT_EMAIL_DAILY_LIMIT = 90;
export const MAX_EMAIL_DAILY_LIMIT = 100_000;

/** Remetente e Reply-To decididos em docs/19 §2: dominio verificado no Resend e caixa real da raiz. */
export const DEFAULT_EMAIL_FROM = "Bunker707 <equipe@mail.bunker707.com.br>";
export const DEFAULT_EMAIL_REPLY_TO = "contato@bunker707.com.br";

export type EmailConfig = {
  /** `none` quando desligado de proposito ou quando falta a chave: o envio vira no-op com log. */
  provider: EmailProviderName;
  /** Por que o provedor ficou em `none` (para o log), ou null quando esta ligado. */
  disabledReason: string | null;
  resendApiKey: string | null;
  from: string;
  replyTo: string | null;
  dailyLimit: number;
  /** Segredo `whsec_...` do endpoint de webhook do Resend; null = rota responde 503. */
  webhookSecret: string | null;
};

type Env = Record<string, string | undefined>;

function clean(value: string | undefined) {
  const trimmed = (value ?? "").trim();

  return trimmed.length > 0 ? trimmed : null;
}

/** Remetente: `Nome <conta@dominio>` ou so `conta@dominio`, sem quebra de linha (cabecalho de e-mail). */
export function isValidSender(value: string) {
  if (/[\r\n]/.test(value)) {
    return false;
  }

  const match = /^(?:[^<>]*<)?([^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>?$/.exec(value.trim());

  return Boolean(match);
}

export function readEmailDailyLimit(value: string | undefined) {
  const cleaned = clean(value);

  if (!cleaned) {
    return DEFAULT_EMAIL_DAILY_LIMIT;
  }

  const parsed = Number(cleaned);

  if (!Number.isInteger(parsed) || parsed < 0 || parsed > MAX_EMAIL_DAILY_LIMIT) {
    return DEFAULT_EMAIL_DAILY_LIMIT;
  }

  return parsed;
}

export function readEmailConfig(env: Env = process.env): EmailConfig {
  const requested = (clean(env.EMAIL_PROVIDER) ?? "none").toLowerCase();
  const resendApiKey = clean(env.RESEND_API_KEY);
  const from = clean(env.EMAIL_FROM) ?? DEFAULT_EMAIL_FROM;
  const replyToRaw = clean(env.EMAIL_REPLY_TO);
  const replyTo = replyToRaw === null ? DEFAULT_EMAIL_REPLY_TO : replyToRaw.toLowerCase() === "none" ? null : replyToRaw;
  const base = {
    dailyLimit: readEmailDailyLimit(env.EMAIL_DAILY_LIMIT),
    from,
    replyTo,
    resendApiKey,
    webhookSecret: clean(env.RESEND_WEBHOOK_SECRET)
  };

  if (requested === "none") {
    return { ...base, disabledReason: "EMAIL_PROVIDER vazio ou \"none\": envio de e-mail desligado.", provider: "none" };
  }

  if (requested !== "resend") {
    return { ...base, disabledReason: `EMAIL_PROVIDER="${requested}" não é um provedor conhecido (resend | none).`, provider: "none" };
  }

  if (!resendApiKey) {
    return { ...base, disabledReason: "EMAIL_PROVIDER=resend sem RESEND_API_KEY: envio de e-mail desligado.", provider: "none" };
  }

  if (!isValidSender(from)) {
    return { ...base, disabledReason: "EMAIL_FROM inválido: use \"Nome <conta@dominio>\".", provider: "none" };
  }

  if (replyTo && !isValidSender(replyTo)) {
    return { ...base, disabledReason: "EMAIL_REPLY_TO inválido: use um endereço de e-mail ou \"none\".", provider: "none" };
  }

  return { ...base, disabledReason: null, provider: "resend" };
}
