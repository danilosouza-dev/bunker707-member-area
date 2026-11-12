// Schemas zod da Simulacao completa (fase 4b; docs/30 §2.2, §4.3, §6.6, §8.6 e D10). Modulo puro (sem "server-only",
// imports relativos; zod v4). O salvar nao pede mais a caixa de §8.6 (decisao do produtor em 12/11/2026, D86): o
// servidor monta e grava a frase da decisao; as mensagens passam pela lista PROIBIDAS_WEBINARIO.

import { z } from "zod";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { CHAT_LIMITS, SIMULATED_COUNT_MODES, SIMULATED_COUNT_VARY_DIRECTIONS, SIMULATION_LIMITS } from "./model";

export const SIMULATION_MESSAGES = {
  count: `Use números de 0 a ${SIMULATION_LIMITS.countMax}.`,
  invalid: "Pedido inválido.",
  peak: "O máximo precisa ser maior ou igual ao mínimo.",
  saleText: `Cada aviso tem de 1 a ${SIMULATION_LIMITS.saleNoticeText} caracteres.`,
  saleTooMany: `No máximo ${SIMULATION_LIMITS.saleNoticesMax} avisos por sessão.`,
  /* "Variar sozinho" (rodada v9, docs/30 D90). */
  varyEvery: WEBINAR_COPY.simulacao.plateia.variar.segundosInvalidos(SIMULATION_LIMITS.varyEverySecondsMin, SIMULATION_LIMITS.varyEverySecondsMax),
  varyOrder: WEBINAR_COPY.simulacao.plateia.variar.ordemInvalida,
  varyPercent: WEBINAR_COPY.simulacao.plateia.variar.percentualInvalido(SIMULATION_LIMITS.varyPercentMin, SIMULATION_LIMITS.varyPercentMax)
} as const;

const count = z.number().int().min(0, SIMULATION_MESSAGES.count).max(SIMULATION_LIMITS.countMax, SIMULATION_MESSAGES.count);

const varySeconds = z.number().int().min(SIMULATION_LIMITS.varyEverySecondsMin, SIMULATION_MESSAGES.varyEvery).max(SIMULATION_LIMITS.varyEverySecondsMax, SIMULATION_MESSAGES.varyEvery);

/**
 * "Variar sozinho" (rodada v9, docs/30 D90): ate `percent` % do numero fixo, para o lado de `direction`, uma mudanca a
 * cada `everyMinSeconds` a `everyMaxSeconds` segundos. So vale no "Real + número fixo" maior que zero; nos outros
 * modos e ignorado ao gravar (rows.simulatedCountRuleToRow).
 */
export const simulatedCountVarySchema = z
  .object({
    direction: z.enum(SIMULATED_COUNT_VARY_DIRECTIONS),
    everyMaxSeconds: varySeconds,
    everyMinSeconds: varySeconds,
    percent: z.number().int().min(SIMULATION_LIMITS.varyPercentMin, SIMULATION_MESSAGES.varyPercent).max(SIMULATION_LIMITS.varyPercentMax, SIMULATION_MESSAGES.varyPercent)
  })
  .refine((vary) => vary.everyMaxSeconds >= vary.everyMinSeconds, { message: SIMULATION_MESSAGES.varyOrder, path: ["everyMaxSeconds"] });

export const simulatedCountRuleSchema = z
  .object({
    base: count.default(0),
    jitter: z.number().int().min(0).max(SIMULATION_LIMITS.jitterMax).default(0),
    mode: z.enum(SIMULATED_COUNT_MODES).default("off"),
    peak: count.default(0),
    vary: simulatedCountVarySchema.nullable().optional()
  })
  .refine((rule) => rule.mode !== "curve" || rule.peak >= rule.base, { message: SIMULATION_MESSAGES.peak, path: ["peak"] });

export const simulatedJoinsSchema = z.object({
  enabled: z.boolean().default(false),
  everySeconds: z.number().int().min(SIMULATION_LIMITS.joinsEverySecondsMin).max(SIMULATION_LIMITS.joinsEverySecondsMax).default(60),
  max: z.number().int().min(0).max(SIMULATION_LIMITS.joinsMax).default(30),
  names: z.literal("generic").default("generic")
});

export const simulatedSaleNoticesSchema = z.object({
  enabled: z.boolean().default(false),
  items: z
    .array(
      z.object({
        offsetMs: z.number().int().min(CHAT_LIMITS.offsetMinMs).max(CHAT_LIMITS.offsetMaxMs),
        text: z.string().trim().min(1, SIMULATION_MESSAGES.saleText).max(SIMULATION_LIMITS.saleNoticeText, SIMULATION_MESSAGES.saleText)
      })
    )
    .max(SIMULATION_LIMITS.saleNoticesMax, SIMULATION_MESSAGES.saleTooMany)
    .default([])
});

/** As regras da Simulacao (a mesma forma no card da sessao e no "Comeca quando voce entra"). */
export const simulationRulesSchema = z.object({
  countRule: simulatedCountRuleSchema.default({ base: 0, jitter: 0, mode: "off", peak: 0 }),
  joins: simulatedJoinsSchema.default({ enabled: false, everySeconds: 60, max: 30, names: "generic" }),
  saleNotices: simulatedSaleNoticesSchema.default({ enabled: false, items: [] }),
  showLiveBadge: z.boolean().default(false)
});
export type SimulationRulesInput = z.input<typeof simulationRulesSchema>;

/**
 * Algo simulado ligado (o selo, o contador, as entradas ou os avisos de venda). O card Simulacao nao pede mais a caixa
 * (D86); o "Começa quando você entra" (jit-schemas.ts) ainda pede a dele.
 */
export function simulationNeedsAck(rules: z.infer<typeof simulationRulesSchema>): boolean {
  return rules.showLiveBadge || rules.countRule.mode !== "off" || rules.joins.enabled || (rules.saleNotices.enabled && rules.saleNotices.items.length > 0);
}

/**
 * saveSessionSimulation [messaging.publish] (docs/30 §5.2): a sessao e as regras. Sem frase nem caixa desde 12/11/2026
 * (decisao do produtor, D86): o servidor monta e grava sozinho a frase da decisao, com o nome de quem salva e a data.
 */
export const saveSessionSimulationSchema = simulationRulesSchema.extend({
    /**
     * A hora da decisao que o card carregou (nula: a sessao sem decisao). Diferente da gravada agora, a Simulacao mudou
     * em outro lugar (o console ou outra aba) e o salvar volta 409 (a revisao v8, achado 6). Ausente (a pagina de
     * antes), sem a conferencia.
     */
    expectedDecidedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    sessionId: z.uuid({ error: SIMULATION_MESSAGES.invalid })
});

/**
 * saveSimulatedAudience [messaging.publish] (docs/30 D79): os participantes simulados da sessao a partir de agora (o +N;
 * 0 e o Tirar), com a frase da mudanca marcada sempre que soma algo, e de onde veio (o console ou o card do editor).
 */
/**
 * Os participantes simulados a partir de agora (D79). Sem frase nem caixa desde 12/11/2026 (decisao do produtor, D86):
 * o servidor grava sozinho a frase da mudanca no registro (webinar_simulation_changes.ack_text).
 */
export const saveSimulatedAudienceSchema = z.object({
  extra: count,
  sessionId: z.uuid({ error: SIMULATION_MESSAGES.invalid }),
  source: z.enum(["console", "editor"]).default("console"),
  /** "Variar sozinho" (D90): ausente ou nula, o numero parado. Com o +0 (o Tirar), ignorada. */
  vary: simulatedCountVarySchema.nullable().optional()
});

/** GET /api/webinars/[id]/simulation?sessao=&from=&to= (ms do relogio do video; no maximo a janela de 2 min). */
export const simulationFeedQuerySchema = z
  .object({
    from: z.coerce.number().int().min(CHAT_LIMITS.offsetMinMs).max(CHAT_LIMITS.offsetMaxMs),
    sessao: z.uuid({ error: SIMULATION_MESSAGES.invalid }),
    to: z.coerce.number().int().min(CHAT_LIMITS.offsetMinMs).max(CHAT_LIMITS.offsetMaxMs)
  })
  .refine((query) => query.to >= query.from && query.to - query.from <= SIMULATION_LIMITS.feedWindowSeconds * 1000, {
    message: SIMULATION_MESSAGES.invalid,
    path: ["to"]
  });
