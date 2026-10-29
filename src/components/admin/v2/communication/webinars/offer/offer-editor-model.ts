// O formulario do card Oferta do editor (docs/30 §2.2), a parte pura: a Oferta gravada vira campos de texto (minutos,
// dias, precos) e volta como o rascunho que saveOffer confere com o zod de offer-schemas.ts. "Divisao igual": todas as
// variantes com peso 1. As letras entram na ordem A, B, C, D (Adicionar variante pega a primeira livre). Sem React e
// sem imports do servidor alem dos tipos e listas de model.ts: o teste carrega direto pelo Node.

import { OFFER_LIMITS, OFFER_VARIANT_LABELS, type OfferStatus, type OfferTrigger, type OfferVariantLabel, type WebinarOffer } from "../../../../../../server/webinars/model";

export type OfferVariantForm = {
  badge: string;
  checkoutUrl: string;
  coupon: string;
  enabled: boolean;
  headline: string;
  id: string | null;
  imageUrl: string;
  label: OfferVariantLabel;
  priceFromLabel: string;
  priceLabel: string;
};

export type OfferForm = {
  attributionDays: string;
  deadline: "minutes" | "none";
  deadlineMinutes: string;
  productId: string | null;
  showAtMinutes: string;
  status: Exclude<OfferStatus, "archived">;
  title: string;
  triggerKind: OfferTrigger;
  variants: OfferVariantForm[];
  visible: "end" | "minutes";
  visibleMinutes: string;
};

/** O rascunho que vai para saveOffer (a forma de OfferDraftInput). */
export type OfferFormDraft = {
  attributionDays: number;
  deadlineMinutes: number | null;
  productId: string;
  showAtOffsetMs: number | null;
  status: Exclude<OfferStatus, "archived">;
  title: string;
  triggerKind: OfferTrigger;
  variants: {
    badge: string | null;
    checkoutUrl: string;
    coupon: string | null;
    enabled: boolean;
    headline: string;
    id: string | null;
    imageUrl: string | null;
    label: OfferVariantLabel;
    priceFromLabel: string | null;
    priceLabel: string | null;
    weight: number;
  }[];
  visibleMinutes: number | null;
};

const MINUTE = 60_000;

export function emptyVariant(label: OfferVariantLabel): OfferVariantForm {
  return { badge: "", checkoutUrl: "", coupon: "", enabled: true, headline: "", id: null, imageUrl: "", label, priceFromLabel: "", priceLabel: "" };
}

/** Uma oferta nova: variante A ligada, "Num minuto do video", ate o fim, sem prazo, compra em 7 dias, em rascunho. */
export function emptyOfferForm(): OfferForm {
  return {
    attributionDays: String(OFFER_LIMITS.attributionDaysDefault),
    deadline: "none",
    deadlineMinutes: "",
    productId: null,
    showAtMinutes: "",
    status: "draft",
    title: "",
    triggerKind: "at_offset",
    variants: [emptyVariant("A")],
    visible: "end",
    visibleMinutes: ""
  };
}

function minutesText(ms: number | null): string {
  if (ms === null) {
    return "";
  }
  const minutes = ms / MINUTE;
  return Number.isInteger(minutes) ? String(minutes) : String(Math.round(minutes * 100) / 100);
}

/** A Oferta gravada como campos (nula = oferta nova). */
export function offerFormOf(offer: WebinarOffer | null): OfferForm {
  if (!offer) {
    return emptyOfferForm();
  }
  return {
    attributionDays: String(offer.attributionDays),
    deadline: offer.deadlineMinutes ? "minutes" : "none",
    deadlineMinutes: offer.deadlineMinutes ? String(offer.deadlineMinutes) : "",
    productId: offer.productId || null,
    showAtMinutes: minutesText(offer.showAtOffsetMs),
    status: offer.status === "active" ? "active" : "draft",
    title: offer.title,
    triggerKind: offer.triggerKind,
    variants:
      offer.variants.length > 0
        ? offer.variants.map((variant) => ({
            badge: variant.badge ?? "",
            checkoutUrl: variant.checkoutUrl,
            coupon: variant.coupon ?? "",
            enabled: variant.enabled,
            headline: variant.headline,
            id: variant.id,
            imageUrl: variant.imageUrl ?? "",
            label: variant.label,
            priceFromLabel: variant.priceFromLabel ?? "",
            priceLabel: variant.priceLabel ?? ""
          }))
        : [emptyVariant("A")],
    visible: offer.visibleMinutes ? "minutes" : "end",
    visibleMinutes: offer.visibleMinutes ? String(offer.visibleMinutes) : ""
  };
}

/** A primeira letra livre (A, B, C, D) ou nula com as quatro. */
export function nextVariantLabel(variants: readonly Pick<OfferVariantForm, "label">[]): OfferVariantLabel | null {
  const used = new Set(variants.map((variant) => variant.label));
  return OFFER_VARIANT_LABELS.find((label) => !used.has(label)) ?? null;
}

export function addVariant(form: OfferForm): OfferForm {
  const label = nextVariantLabel(form.variants);
  if (!label) {
    return form;
  }
  const variants = [...form.variants, emptyVariant(label)].sort((a, b) => a.label.localeCompare(b.label));
  return { ...form, variants };
}

export function removeVariant(form: OfferForm, label: OfferVariantLabel): OfferForm {
  if (form.variants.length <= 1) {
    return form;
  }
  return { ...form, variants: form.variants.filter((variant) => variant.label !== label) };
}

/** Numero inteiro de um campo; vazio ou invalido = nulo (o zod do servidor diz o que falta). */
export function integerOrNull(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!text) {
    return null;
  }
  const number = Number(text);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function minutesToMs(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!text) {
    return null;
  }
  const minutes = Number(text);
  return Number.isFinite(minutes) && minutes >= 0 ? Math.round(minutes * MINUTE) : null;
}

const textOrNull = (value: string) => (value.trim() ? value.trim() : null);

/** O rascunho de saveOffer: "Divisao igual" = peso 1 em todas; o minuto so no "Num minuto do video". */
export function offerDraftOfForm(form: OfferForm): OfferFormDraft {
  return {
    attributionDays: integerOrNull(form.attributionDays) ?? OFFER_LIMITS.attributionDaysDefault,
    deadlineMinutes: form.deadline === "minutes" ? integerOrNull(form.deadlineMinutes) : null,
    productId: form.productId ?? "",
    showAtOffsetMs: form.triggerKind === "at_offset" ? minutesToMs(form.showAtMinutes) : null,
    status: form.status,
    title: form.title.trim(),
    triggerKind: form.triggerKind,
    variants: form.variants.map((variant) => ({
      badge: textOrNull(variant.badge),
      checkoutUrl: variant.checkoutUrl.trim(),
      coupon: textOrNull(variant.coupon),
      enabled: variant.enabled,
      headline: variant.headline.trim(),
      id: variant.id,
      imageUrl: textOrNull(variant.imageUrl),
      label: variant.label,
      priceFromLabel: textOrNull(variant.priceFromLabel),
      priceLabel: textOrNull(variant.priceLabel),
      weight: 1
    })),
    visibleMinutes: form.visible === "minutes" ? integerOrNull(form.visibleMinutes) : null
  };
}

/** Os erros por campo do saveOffer ("draft.variants.0.checkoutUrl" -> "variants.0.checkoutUrl"), a primeira frase. */
export function offerFieldErrors(fieldErrors: Record<string, string[]> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [path, messages] of Object.entries(fieldErrors ?? {})) {
    const key = path.replace(/^draft\./, "");
    if (messages[0] && !result[key]) {
      result[key] = messages[0];
    }
  }
  return result;
}

/* ------------------------------------------------------------------------------------------------
 * O console: "Mostrar agora" / "Esconder"
 * ---------------------------------------------------------------------------------------------- */

type ConsoleActionResult<T> = { data: T; ok: true } | { error?: string | null; ok: false };

/**
 * A chamada de "Mostrar agora" ou "Esconder" do console sem nunca lancar: a Server Action rejeita quando a rede cai ou
 * o deploy troca no meio (a action nao e encontrada); a rejeicao e o `ok: false` viram a frase de erro, e o console
 * sempre religa os botoes (o `busy` volta a nulo depois desta promessa).
 */
export async function settleConsoleOfferAction<T>(call: () => Promise<ConsoleActionResult<T>>, fallbackError: string): Promise<{ data: T; ok: true } | { error: string; ok: false }> {
  const result = await Promise.resolve()
    .then(call)
    .catch(() => null);
  if (!result) {
    return { error: fallbackError, ok: false };
  }
  if (!result.ok) {
    return { error: result.error || fallbackError, ok: false };
  }
  return { data: result.data, ok: true };
}
