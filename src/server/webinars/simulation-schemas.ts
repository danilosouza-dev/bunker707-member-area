// Schemas zod da Simulacao completa (fase 4b; docs/30 §2.2, §4.3, §6.6, §8.6 e D10). Modulo puro (sem "server-only",
// imports relativos; zod v4). O salvar exige a caixa de §8.6 marcada sempre que algo simulado fica ligado (o selo, o
// contador, as entradas ou os avisos de venda); as mensagens passam pela lista PROIBIDAS_WEBINARIO.

import { z } from "zod";
import { CHAT_LIMITS, SIMULATED_COUNT_MODES, SIMULATION_LIMITS } from "./model";

export const SIMULATION_MESSAGES = {
  ack: "Marque a caixa com a decisão para ligar o selo ou os números simulados.",
  count: `Use números de 0 a ${SIMULATION_LIMITS.countMax}.`,
  invalid: "Pedido inválido.",
  peak: "O máximo precisa ser maior ou igual ao mínimo.",
  saleText: `Cada aviso tem de 1 a ${SIMULATION_LIMITS.saleNoticeText} caracteres.`,
  saleTooMany: `No máximo ${SIMULATION_LIMITS.saleNoticesMax} avisos por sessão.`
} as const;

const count = z.number().int().min(0, SIMULATION_MESSAGES.count).max(SIMULATION_LIMITS.countMax, SIMULATION_MESSAGES.count);

export const simulatedCountRuleSchema = z
  .object({
    base: count.default(0),
    jitter: z.number().int().min(0).max(SIMULATION_LIMITS.jitterMax).default(0),
    mode: z.enum(SIMULATED_COUNT_MODES).default("off"),
    peak: count.default(0)
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

/** Algo simulado ligado (o selo, o contador, as entradas ou os avisos de venda): pede a caixa de §8.6. */
export function simulationNeedsAck(rules: z.infer<typeof simulationRulesSchema>): boolean {
  return rules.showLiveBadge || rules.countRule.mode !== "off" || rules.joins.enabled || (rules.saleNotices.enabled && rules.saleNotices.items.length > 0);
}

/** saveSessionSimulation [messaging.publish] (docs/30 §5.2): a sessao gravada, as regras e a caixa marcada. */
export const saveSessionSimulationSchema = simulationRulesSchema
  .extend({
    ackText: z.string().trim().max(CHAT_LIMITS.simulationAck).optional(),
    acknowledged: z.boolean().default(false),
    sessionId: z.uuid({ error: SIMULATION_MESSAGES.invalid })
  })
  .superRefine((input, context) => {
    if (simulationNeedsAck(input) && (!input.acknowledged || !input.ackText)) {
      context.addIssue({ code: "custom", message: SIMULATION_MESSAGES.ack, path: ["acknowledged"] });
    }
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
