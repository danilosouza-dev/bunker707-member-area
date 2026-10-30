// O provedor do Assistente de IA do chat (docs/30 §6.6 e D24): a interface que assistant.ts chama (`answer` com o
// MATERIAL, a pergunta e a hora-limite) e a implementacao pelo gateway de IA da area, no padrao do Tutor
// (src/server/ai/tutor.ts): as conexoes ativas do pool (listAIProviderRuntimeCandidates) e a geracao com troca de
// conexao e teto de tempo (generateAITextWithFallback com deadlineAt). O prompt e o de assistant-model.ts; o MATERIAL
// e cortado no menor contexto das conexoes. "Tem conexao de IA ativa" (o card, o console e a dica da sala) le so as
// politicas e as conexoes, sem abrir chave nenhuma, e fica 60 s na memoria do processo. Os testes trocam o provedor
// por um duble (o parametro `provider` de assistant.ts) e nunca chamam um provedor de verdade.

import "server-only";

import { AIProviderPoolError, generateAITextWithFallback, listAIProviderRuntimeCandidates } from "../ai/provider-pool";
import { assistantQuotaDecision, assistantSystemPrompt, type QuotaCandidate } from "./assistant-model";
import { assertNoDbError, type WebinarsDb } from "./db";

/** Quem pergunta e o banco: os limites diario (por aluno) e mensal (por provedor) de Configuracoes › IA. */
export type AssistantQuota = { db: WebinarsDb; nowMs: number; userId: string };

export type AssistantAnswerInput = { context: string; deadlineAt: number; question: string; quota?: AssistantQuota };

export type AssistantAnswer = { body: string; model: string | null; provider: string | null };

export interface AssistantProvider {
  answer(input: AssistantAnswerInput): Promise<AssistantAnswer>;
}

/** Por que o provedor nao respondeu: sem conexao, passou do teto de tempo, o limite de Configuracoes › IA ou falhou. */
export type AssistantFailureKind = "failed" | "rate_limited" | "timeout" | "unconfigured";

export class AssistantProviderError extends Error {
  code: string;
  kind: AssistantFailureKind;

  constructor(kind: AssistantFailureKind, code: string, message = code) {
    super(message);
    this.name = "AssistantProviderError";
    this.code = code.slice(0, 80);
    this.kind = kind;
  }
}

/** O espaco do prompt fixo dentro do contexto da conexao (o MATERIAL fica com o resto). */
const PROMPT_ALLOWANCE = 1_500;

const DAY_MS = 24 * 60 * 60 * 1000;

function monthStartIso(nowMs: number) {
  const now = new Date(nowMs);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * O que o provedor ja respondeu no mes (o Assistente e o Tutor, que dividem a mesma politica): a conta do limite
 * mensal de Configuracoes › IA. Os provedores sem limite nem sao contados.
 */
export async function monthlyAiUsage(db: WebinarsDb, input: { nowMs: number; providers: readonly string[] }): Promise<Map<string, number>> {
  const since = monthStartIso(input.nowMs);
  const usage = new Map<string, number>();
  for (const provider of [...new Set(input.providers)]) {
    const [assistant, tutor] = await Promise.all([
      db.from("webinar_ai_requests").select("id", { count: "exact", head: true }).eq("provider", provider).eq("status", "answered").gte("requested_at", since),
      db.from("ai_messages").select("id", { count: "exact", head: true }).eq("provider", provider).eq("role", "assistant").eq("status", "completed").gte("created_at", since)
    ]);
    assertNoDbError(assistant.error, "Webinarios: uso mensal do assistente");
    assertNoDbError(tutor.error, "Webinarios: uso mensal da IA");
    usage.set(provider, (assistant.count ?? 0) + (tutor.count ?? 0));
  }
  return usage;
}

/**
 * As conexoes que podem responder agora pelos limites de Configuracoes › IA (os mesmos do Tutor): o diario por aluno
 * soma os pedidos do Assistente que chamaram a IA (respondidos ou falhos) nas ultimas 24 h em todas as sessoes; o
 * mensal tira o provedor que ja gastou o mes. Passou do limite: AssistantProviderError `rate_limited` (o pedido fica
 * pulado com o motivo) e o log que o alarme le.
 */
export async function withinAssistantQuota<T extends QuotaCandidate>(candidates: readonly T[], quota: AssistantQuota): Promise<T[]> {
  const limited = candidates.filter((candidate) => typeof candidate.monthlyQuestionLimit === "number" && Number.isFinite(candidate.monthlyQuestionLimit));
  const [daily, monthly] = await Promise.all([
    quota.db
      .from("webinar_ai_requests")
      .select("id", { count: "exact", head: true })
      .eq("user_id", quota.userId)
      .in("status", ["answered", "failed"])
      .gte("requested_at", new Date(quota.nowMs - DAY_MS).toISOString()),
    limited.length > 0 ? monthlyAiUsage(quota.db, { nowMs: quota.nowMs, providers: limited.map((candidate) => candidate.provider) }) : Promise.resolve(new Map<string, number>())
  ]);
  assertNoDbError(daily.error, "Webinarios: uso diario do assistente");
  const decision = assistantQuotaDecision({ candidates, dailyUsed: daily.count ?? 0, monthlyUsed: monthly });
  if (decision.reason) {
    console.error(`[webinarios] o Assistente chegou ao limite ${decision.reason === "daily" ? "diario do aluno" : "mensal da IA"} (Configuracoes › IA): pedido pulado.`);
    throw new AssistantProviderError("rate_limited", decision.reason === "daily" ? "daily_limit" : "monthly_limit");
  }
  return decision.allowed;
}

/** O provedor de verdade: o pool de conexoes de IA da area, como o Tutor. */
export const gatewayAssistantProvider: AssistantProvider = {
  async answer({ context, deadlineAt, question, quota }) {
    const pool = await listAIProviderRuntimeCandidates();
    if (pool.length === 0) {
      throw new AssistantProviderError("unconfigured", "no_active_connection");
    }
    const candidates = quota ? await withinAssistantQuota(pool, quota) : pool;
    const limit = Math.min(...candidates.map((candidate) => candidate.contextMaxCharacters));
    const material = Number.isFinite(limit) && limit > PROMPT_ALLOWANCE ? context.slice(0, limit - PROMPT_ALLOWANCE) : context;
    try {
      const generated = await generateAITextWithFallback({
        candidates,
        deadlineAt,
        messages: [{ content: question, role: "user" }],
        system: assistantSystemPrompt(material)
      });
      return { body: generated.generation.text, model: generated.config.model ?? null, provider: generated.config.provider ?? null };
    } catch (error) {
      if (error instanceof AIProviderPoolError) {
        const kind: AssistantFailureKind = error.code === "provider_deadline_exceeded" ? "timeout" : error.code === "no_available_connection" ? "unconfigured" : "failed";
        throw new AssistantProviderError(kind, error.code, error.message);
      }
      throw error;
    }
  }
};

/* ------------------------------------------------------------------------------------------------
 * "Tem conexao de IA ativa" (sem abrir chave)
 * ---------------------------------------------------------------------------------------------- */

const AVAILABILITY_TTL_MS = 60_000;
let availability: { at: number; value: boolean } | null = null;

/** Zera a memoria de 60 s (testes). */
export function resetAssistantAvailabilityCache() {
  availability = null;
}

/**
 * Ha politica de IA ligada e configurada e ao menos uma conexao ativa fora do resfriamento (a mesma conta da IA
 * Diretor). Fica 60 s na memoria do processo: a sala de cada aluno pergunta a cada minuto.
 */
export async function hasActiveAiConnection(db: WebinarsDb, nowMs: number = Date.now()): Promise<boolean> {
  if (availability && nowMs - availability.at < AVAILABILITY_TTL_MS) {
    return availability.value;
  }
  const policies = await db.from("ai_provider_configs").select("provider").eq("enabled", true).eq("status", "configured");
  assertNoDbError(policies.error, "Webinarios: politicas de IA do assistente");
  const providers = [...new Set(((policies.data ?? []) as { provider: string | null }[]).map((row) => row.provider).filter((provider): provider is string => Boolean(provider)))];
  let value = false;
  if (providers.length > 0) {
    const connections = await db
      .from("ai_provider_connections")
      .select("id")
      .in("provider", providers)
      .eq("status", "active")
      .is("deleted_at", null)
      .or(`cooldown_until.is.null,cooldown_until.lte.${new Date(nowMs).toISOString()}`)
      .limit(1);
    assertNoDbError(connections.error, "Webinarios: conexoes de IA do assistente");
    value = ((connections.data ?? []) as { id: string }[]).length > 0;
  }
  availability = { at: nowMs, value };
  return value;
}
