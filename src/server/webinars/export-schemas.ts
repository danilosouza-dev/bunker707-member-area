// Schemas zod da fase 4a: os paineis "Lives ao vivo" e "Lives gravadas" e o botao Exportar (docs/30 §3.1 a §3.3 e
// §3.7). Modulo puro (sem "server-only", imports relativos; zod v4): tests/webinarios-v4-contratos.test.mjs carrega
// direto pelo Node. As mensagens passam pela lista PROIBIDAS_WEBINARIO.

import { z } from "zod";
import { PANEL_KINDS, WEBINAR_EXPORT_REPORTS } from "./model";

export const EXPORT_MESSAGES = {
  invalid: "Pedido inválido.",
  period: "Escolha um período de até 1 ano.",
  report: "Escolha um dos relatórios.",
  scope: "Escolha uma sessão ou um período."
} as const;

const PERIOD_MAX_MS = 366 * 86_400_000;

/** O periodo de um painel ou exportacao: [start, end), no maximo 1 ano. */
export const panelPeriodSchema = z
  .object({
    end: z.iso.datetime({ offset: true }),
    start: z.iso.datetime({ offset: true })
  })
  .refine((period) => Date.parse(period.end) > Date.parse(period.start) && Date.parse(period.end) - Date.parse(period.start) <= PERIOD_MAX_MS, {
    message: EXPORT_MESSAGES.period,
    path: ["end"]
  });

/** Os filtros da aba (docs/30 §3.2 e §3.3), todos opcionais: a tela resolve em ids de sessao para webinar_panel. */
export const panelFiltersSchema = z.object({
  hour: z.number().int().min(0).max(23).nullable().default(null),
  hostUserId: z.uuid({ error: EXPORT_MESSAGES.invalid }).nullable().default(null),
  productId: z.string().trim().min(1).max(240).nullable().default(null),
  situation: z.enum(["realized", "scheduled", "cancelled"]).nullable().default(null),
  variant: z.enum(["A", "B", "C", "D"]).nullable().default(null),
  webinarId: z.uuid({ error: EXPORT_MESSAGES.invalid }).nullable().default(null),
  withOffer: z.boolean().default(false)
});
export type PanelFilters = z.infer<typeof panelFiltersSchema>;

export const panelQuerySchema = z.object({
  filters: panelFiltersSchema.default(panelFiltersSchema.parse({})),
  kind: z.enum(PANEL_KINDS, { error: EXPORT_MESSAGES.invalid }),
  period: panelPeriodSchema
});
export type PanelQuery = z.infer<typeof panelQuerySchema>;

/**
 * O pedido de um CSV (docs/30 §3.7): de uma sessao (o relatorio do webinario) ou do periodo de um painel (so o
 * Performance e o Simulacao fazem sentido no periodo; os outros pedem a sessao). Auditoria `webinar_export`.
 */
export const webinarExportSchema = z.discriminatedUnion("scope", [
  z.object({
    report: z.enum(WEBINAR_EXPORT_REPORTS, { error: EXPORT_MESSAGES.report }),
    scope: z.literal("session"),
    sessionId: z.uuid({ error: EXPORT_MESSAGES.invalid })
  }),
  z.object({
    filters: panelFiltersSchema.default(panelFiltersSchema.parse({})),
    kind: z.enum(["live", "simulated"], { error: EXPORT_MESSAGES.invalid }),
    period: panelPeriodSchema,
    report: z.enum(["performance", "simulacao"], { error: EXPORT_MESSAGES.report }),
    scope: z.literal("panel")
  })
]);
export type WebinarExportInput = z.infer<typeof webinarExportSchema>;
