// Schemas zod da Oferta (fase 4b; docs/30 §2.2, §2.4 e §5.1). Modulo puro (sem "server-only", imports relativos; zod
// v4): tests/webinarios-v4-contratos.test.mjs carrega direto pelo Node. Os limites sao os checks da 202610300003
// (OFFER_LIMITS); as mensagens passam pela lista PROIBIDAS_WEBINARIO.

import { z } from "zod";
import { CHAT_LIMITS, OFFER_LIMITS, OFFER_STATUSES, OFFER_TRIGGERS, OFFER_VARIANT_LABELS } from "./model";

export const OFFER_MESSAGES = {
  checkoutUrl: "Cole o link de checkout completo, começando com https://.",
  headline: `O título da variante tem de 1 a ${OFFER_LIMITS.headline} caracteres.`,
  imageUrl: "A imagem precisa de um endereço https://.",
  invalid: "Pedido inválido.",
  labelsUnique: "Cada variante aparece uma vez (A, B, C, D).",
  needsVariant: "Ligue pelo menos uma variante com título e link de checkout.",
  product: "Escolha o produto que a compra libera.",
  showAt: "Diga em que minuto do vídeo a oferta aparece.",
  short: (max: number) => `Use até ${max} caracteres.`
} as const;

const optionalShort = (max: number) =>
  z
    .string()
    .trim()
    .max(max, OFFER_MESSAGES.short(max))
    .transform((value) => value || null)
    .nullable()
    .default(null);

const httpsUrl = (message: string) =>
  z
    .string()
    .trim()
    .min(OFFER_LIMITS.urlMin, message)
    .max(OFFER_LIMITS.url, message)
    .refine((value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }, message);

export const offerVariantDraftSchema = z.object({
  badge: optionalShort(OFFER_LIMITS.badge),
  checkoutUrl: httpsUrl(OFFER_MESSAGES.checkoutUrl),
  coupon: optionalShort(OFFER_LIMITS.coupon),
  enabled: z.boolean().default(true),
  headline: z.string().trim().min(1, OFFER_MESSAGES.headline).max(OFFER_LIMITS.headline, OFFER_MESSAGES.headline),
  id: z.uuid().nullable().optional(),
  imageUrl: httpsUrl(OFFER_MESSAGES.imageUrl).nullable().default(null),
  label: z.enum(OFFER_VARIANT_LABELS, { error: OFFER_MESSAGES.invalid }),
  priceFromLabel: optionalShort(OFFER_LIMITS.priceLabel),
  priceLabel: optionalShort(OFFER_LIMITS.priceLabel),
  weight: z.number().int().min(OFFER_LIMITS.weightMin).max(OFFER_LIMITS.weightMax).default(1)
});

/** O card Oferta do editor (saveOffer): "Divisao igual" = todos os pesos 1. */
export const offerDraftSchema = z
  .object({
    attributionDays: z.number().int().min(OFFER_LIMITS.attributionDaysMin).max(OFFER_LIMITS.attributionDaysMax).default(OFFER_LIMITS.attributionDaysDefault),
    deadlineMinutes: z.number().int().min(1).max(OFFER_LIMITS.deadlineMinutesMax).nullable().default(null),
    productId: z.string().trim().min(1, OFFER_MESSAGES.product).max(240, OFFER_MESSAGES.product),
    showAtOffsetMs: z.number().int().min(0).max(CHAT_LIMITS.offsetMaxMs).nullable().default(null),
    status: z.enum(OFFER_STATUSES).default("draft"),
    title: z.string().trim().max(OFFER_LIMITS.title, OFFER_MESSAGES.short(OFFER_LIMITS.title)).default(""),
    triggerKind: z.enum(OFFER_TRIGGERS, { error: OFFER_MESSAGES.invalid }),
    variants: z.array(offerVariantDraftSchema).max(OFFER_VARIANT_LABELS.length),
    visibleMinutes: z.number().int().min(1).max(OFFER_LIMITS.visibleMinutesMax).nullable().default(null)
  })
  .superRefine((draft, context) => {
    const labels = draft.variants.map((variant) => variant.label);
    if (new Set(labels).size !== labels.length) {
      context.addIssue({ code: "custom", message: OFFER_MESSAGES.labelsUnique, path: ["variants"] });
    }
    if (draft.triggerKind === "at_offset" && draft.showAtOffsetMs === null) {
      context.addIssue({ code: "custom", message: OFFER_MESSAGES.showAt, path: ["showAtOffsetMs"] });
    }
    if (draft.status === "active" && !draft.variants.some((variant) => variant.enabled)) {
      context.addIssue({ code: "custom", message: OFFER_MESSAGES.needsVariant, path: ["variants"] });
    }
  });
export type OfferDraftInput = z.input<typeof offerDraftSchema>;

/** saveOffer [messaging.write]. */
export const saveOfferSchema = z.object({ draft: offerDraftSchema, webinarId: z.uuid({ error: OFFER_MESSAGES.invalid }) });

/** "Mostrar agora" / "Esconder" no console [messaging.write] (a hora e o offset sao do servidor). */
export const offerDisplayActionSchema = z.object({ offerId: z.uuid({ error: OFFER_MESSAGES.invalid }), sessionId: z.uuid({ error: OFFER_MESSAGES.invalid }) });

/**
 * POST /api/webinars/[id]/offer-click { sessionId, offerId, offsetMs? } (docs/30 §5.1). Na sessao gravada o offset e o
 * do relogio do servidor (o do corpo e ignorado); no Replay livre vale o do corpo (a posicao do player), como no chat.
 */
export const offerClickBodySchema = z.object({
  offerId: z.uuid({ error: OFFER_MESSAGES.invalid }),
  offsetMs: z.number().int().min(CHAT_LIMITS.offsetMinMs).max(CHAT_LIMITS.offsetMaxMs).optional(),
  sessionId: z.uuid({ error: OFFER_MESSAGES.invalid })
});
