// Schemas zod do "Comeca quando voce entra" (fase 4e; docs/30 §1.6, §2.2, A14 e D25). Modulo puro (sem
// "server-only", imports relativos; zod v4). As mensagens passam pela lista PROIBIDAS_WEBINARIO.

import { z } from "zod";
import { CHAT_LIMITS, JIT_EVERY_MINUTES, JIT_LIMITS } from "./model";
import { simulationNeedsAck, simulationRulesSchema } from "./simulation-schemas";

export const JIT_MESSAGES = {
  ack: "Marque a caixa com a decisão para ligar o selo ou os números simulados.",
  every: "Escolha a cada 15, 30 ou 60 minutos.",
  hours: "O fim da janela precisa vir depois do início.",
  invalid: "Pedido inválido."
} as const;

const everyMinutesSchema = z.union([z.literal(JIT_EVERY_MINUTES[0]), z.literal(JIT_EVERY_MINUTES[1]), z.literal(JIT_EVERY_MINUTES[2])], { error: JIT_MESSAGES.every });

/** A Simulacao que cada sessao `jit` copia (com a caixa de §8.6 quando algo simulado fica ligado). */
export const jitSimulationSchema = simulationRulesSchema
  .extend({
    ackText: z.string().trim().max(CHAT_LIMITS.simulationAck).nullable().default(null),
    acknowledged: z.boolean().default(false)
  })
  .superRefine((input, context) => {
    if (simulationNeedsAck(input) && (!input.acknowledged || !input.ackText)) {
      context.addIssue({ code: "custom", message: JIT_MESSAGES.ack, path: ["acknowledged"] });
    }
  });

/** webinars.jit_settings como o card Sessoes edita (a decisao da Simulacao ganha quem e quando no servidor). */
export const jitSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    endHour: z.number().int().min(JIT_LIMITS.hourMin + 1).max(JIT_LIMITS.hourMax),
    everyMinutes: everyMinutesSchema,
    lateJoinMinutes: z.number().int().min(0).max(JIT_LIMITS.lateJoinMax).nullable().default(null),
    simulation: jitSimulationSchema.nullable().default(null),
    startHour: z.number().int().min(JIT_LIMITS.hourMin).max(JIT_LIMITS.hourMax - 1)
  })
  .refine((settings) => settings.endHour > settings.startHour, { message: JIT_MESSAGES.hours, path: ["endHour"] });
export type JitSettingsInput = z.input<typeof jitSettingsSchema>;

/** saveJitSettings [messaging.write; com a Simulacao ligada, messaging.publish, como saveSimulation]. */
export const saveJitSettingsSchema = z.object({ settings: jitSettingsSchema, webinarId: z.uuid({ error: JIT_MESSAGES.invalid }) });

/** POST /api/webinars/[id]/jit {}: a sessao do proximo horario para quem acabou de chegar (sem corpo alem do vazio). */
export const jitEnterBodySchema = z.object({}).strict();
