// O provedor da traducao do chat e do roteiro (docs/30 §1.6, fase 4f): a interface que translation.ts chama
// (`translate` com os textos, o idioma do aluno e a hora-limite; devolve, alinhado pelos indices, o corpo traduzido e
// o idioma em que cada texto foi escrito, ou nulo no texto que nao voltou) e a implementacao pelo gateway de IA da
// area, no padrao do Tutor (src/server/ai/tutor.ts) e do Assistente (assistant-provider.ts): as conexoes ativas do
// pool (listAIProviderRuntimeCandidates) e a geracao com troca de conexao e teto de tempo
// (generateAITextWithFallback com deadlineAt), com o prompt e a leitura do JSON de translation-model.ts. Os textos
// vao em grupos que cabem no menor contexto das conexoes; o grupo que nao cabe mais no tempo fica nulo (tenta de novo
// depois). Tambem aqui um duble em memoria (memoryTranslationProvider) para scripts e testes; os testes nunca chamam
// um provedor de verdade.

import "server-only";

import { AIProviderPoolError, generateAITextWithFallback, listAIProviderRuntimeCandidates } from "../ai/provider-pool";
import { monthlyAiUsage } from "./assistant-provider";
import type { WebinarsDb } from "./db";
import type { ChatLanguage, SourceLanguage } from "./model";
import { TRANSLATION_BATCH_CHARS, TRANSLATION_DEFAULT_PROVIDER, chunkTextsByChars, parseTranslationOutput, translationSystemPrompt, translationUserMessage, type TranslatedText } from "./translation-model";

export type { TranslatedText };

export type TranslateOptions = {
  /** O banco: o limite mensal de Configuracoes › IA (o mesmo do Tutor e do Assistente) tira o provedor que gastou o mes. */
  db?: WebinarsDb;
  deadlineAt?: number;
  /** Quem escreveu cada texto (translationGroupOf): autores diferentes nunca dividem um pedido ao gateway. */
  groups?: readonly (string | undefined)[];
};

export interface TranslationProvider {
  /** O nome que vai para webinar_text_translations.provider quando o resultado nao traz outro. */
  readonly name: string;
  translate(texts: readonly string[], target: ChatLanguage, options?: TranslateOptions): Promise<(TranslatedText | null)[]>;
}

/** Por que o provedor nao traduziu: sem conexao, passou do teto de tempo ou falhou (o codigo do pool vai junto). */
export type TranslationFailureKind = "failed" | "timeout" | "unconfigured";

export class TranslationProviderError extends Error {
  code: string;
  kind: TranslationFailureKind;

  constructor(kind: TranslationFailureKind, code: string, message = code) {
    super(message);
    this.name = "TranslationProviderError";
    this.code = code.slice(0, 80);
    this.kind = kind;
  }
}

/** O espaco do prompt fixo e do JSON dentro do contexto da conexao (os textos ficam com o resto). */
const PROMPT_ALLOWANCE = 1_500;

function failureOf(error: unknown): TranslationProviderError {
  if (error instanceof TranslationProviderError) {
    return error;
  }
  if (error instanceof AIProviderPoolError) {
    const kind: TranslationFailureKind = error.code === "provider_deadline_exceeded" ? "timeout" : error.code === "no_available_connection" ? "unconfigured" : "failed";
    return new TranslationProviderError(kind, error.code, error.message);
  }
  return new TranslationProviderError("failed", "generation_failed", error instanceof Error ? error.message : String(error));
}

/** O provedor de verdade: o pool de conexoes de IA da area, como o Tutor e o Assistente. */
export const gatewayTranslationProvider: TranslationProvider = {
  name: TRANSLATION_DEFAULT_PROVIDER,
  async translate(texts, target, options = {}) {
    const results: (TranslatedText | null)[] = texts.map(() => null);
    if (texts.length === 0) {
      return results;
    }
    const pool = await listAIProviderRuntimeCandidates();
    if (pool.length === 0) {
      throw new TranslationProviderError("unconfigured", "no_active_connection");
    }
    // O limite mensal de Configuracoes › IA vale tambem aqui (o diario e por aluno; a traducao nao e de ninguem).
    const limited = pool.filter((candidate) => Number.isFinite(candidate.monthlyQuestionLimit));
    const usage = options.db && limited.length > 0 ? await monthlyAiUsage(options.db, { nowMs: Date.now(), providers: limited.map((candidate) => candidate.provider) }) : new Map<string, number>();
    const candidates = pool.filter((candidate) => !Number.isFinite(candidate.monthlyQuestionLimit) || (usage.get(candidate.provider) ?? 0) < candidate.monthlyQuestionLimit);
    if (candidates.length === 0) {
      console.error("[webinarios] a traducao chegou ao limite mensal da IA (Configuracoes › IA): lote adiado.");
      throw new TranslationProviderError("failed", "monthly_limit");
    }
    const limit = Math.min(...candidates.map((candidate) => candidate.contextMaxCharacters));
    const room = Number.isFinite(limit) && limit > PROMPT_ALLOWANCE * 2 ? Math.min(TRANSLATION_BATCH_CHARS, limit - PROMPT_ALLOWANCE) : TRANSLATION_BATCH_CHARS;
    let translatedAny = false;
    let lastFailure: TranslationProviderError | null = null;

    for (const group of chunkTextsByChars(texts, room, options.groups ?? texts.map((_, index) => `#${index}`))) {
      if (typeof options.deadlineAt === "number" && Date.now() >= options.deadlineAt - 1_000) {
        break;
      }
      try {
        const generated = await generateAITextWithFallback({
          candidates,
          deadlineAt: options.deadlineAt,
          messages: [{ content: translationUserMessage(group.map((index) => texts[index] ?? "")), role: "user" }],
          system: translationSystemPrompt(target)
        });
        const parsed = parseTranslationOutput(generated.generation.text, group.length);
        if (!parsed) {
          lastFailure = new TranslationProviderError("failed", "invalid_output");
          continue;
        }
        const provider = `${TRANSLATION_DEFAULT_PROVIDER}:${generated.config.provider ?? ""}`.replace(/:$/, "");
        parsed.forEach((item, position) => {
          const index = group[position];
          if (item && index !== undefined) {
            results[index] = { ...item, provider };
            translatedAny = true;
          }
        });
      } catch (error) {
        lastFailure = failureOf(error);
        if (lastFailure.kind !== "failed") {
          break;
        }
      }
    }

    if (!translatedAny && lastFailure) {
      throw lastFailure;
    }
    return results;
  }
};

/**
 * Um provedor em memoria (scripts locais e testes): `translateOne(texto, idioma)` devolve o corpo e o idioma de
 * origem (ou nulo para "nao voltou"); cada chamada fica em `calls`.
 */
export function memoryTranslationProvider(
  translateOne: (text: string, target: ChatLanguage) => { body: string; sourceLanguage: SourceLanguage | null } | null | Promise<{ body: string; sourceLanguage: SourceLanguage | null } | null>,
  name = "memoria"
): TranslationProvider & { calls: { groups?: (string | undefined)[]; target: ChatLanguage; texts: string[] }[] } {
  const calls: { groups?: (string | undefined)[]; target: ChatLanguage; texts: string[] }[] = [];
  return {
    calls,
    name,
    async translate(texts, target, options = {}) {
      calls.push({ groups: options.groups ? [...options.groups] : undefined, target, texts: [...texts] });
      return Promise.all(texts.map(async (text) => (await translateOne(text, target)) ?? null));
    }
  };
}
