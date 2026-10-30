// A Oferta no banco (docs/30 §2.2, §2.4, §4.2, §5.1, M7 e M8; migracao 202610300003), pela service role: a Oferta do
// webinario e as variantes, o que cada sessao mostrou (webinar_offer_displays), os cliques, a conversao pelo job do
// tick (RPC webinar_offer_conversions) e os fatos do follow-up (RPC webinar_follow_up_facts). Quem decide (a variante
// do aluno, a janela, o prazo, quem ve o card, o link) e offer-model.ts e os modulos da frente da Oferta; aqui so o
// acesso as linhas. Banco sem a 202610300003: o erro sobe como PendingMigrationError (WEBINARS_OFFERS_MIGRATION).

import "server-only";

import { assertNoDbError, type WebinarsDb } from "./db";
import { fetchAll } from "./store";
import type { OfferDraft, OfferDisplaySnapshot, OfferVariantLabel, WebinarFollowUpFacts, WebinarOffer } from "./model";
import {
  OFFER_CLICK_COLUMNS,
  OFFER_COLUMNS,
  OFFER_DISPLAY_COLUMNS,
  OFFER_VARIANT_COLUMNS,
  followUpFactsFromRow,
  offerFromRows,
  type FollowUpFactsRow,
  type OfferClickRow,
  type OfferDisplayRow,
  type OfferRow,
  type OfferVariantRow
} from "./rows";

const UNIQUE_VIOLATION = "23505";

/* ------------------------------------------------------------------------------------------------
 * A Oferta e as variantes
 * ---------------------------------------------------------------------------------------------- */

async function variantsOf(db: WebinarsDb, offerIds: readonly string[]): Promise<OfferVariantRow[]> {
  if (offerIds.length === 0) {
    return [];
  }
  const { data, error } = await db.from("webinar_offer_variants").select(OFFER_VARIANT_COLUMNS).in("offer_id", [...offerIds]).order("label", { ascending: true });
  assertNoDbError(error, "Webinarios: ler variantes da oferta");
  return (data ?? []) as OfferVariantRow[];
}

/** A Oferta (nao arquivada) do webinario, com as variantes; nulo quando a equipe ainda nao montou. */
export async function fetchOfferForWebinar(db: WebinarsDb, webinarId: string): Promise<WebinarOffer | null> {
  const { data, error } = await db.from("webinar_offers").select(OFFER_COLUMNS).eq("webinar_id", webinarId).neq("status", "archived").maybeSingle();
  assertNoDbError(error, "Webinarios: ler oferta");
  const row = (data as OfferRow | null) ?? null;
  return row ? offerFromRows(row, await variantsOf(db, [row.id])) : null;
}

export async function fetchOfferById(db: WebinarsDb, offerId: string): Promise<WebinarOffer | null> {
  const { data, error } = await db.from("webinar_offers").select(OFFER_COLUMNS).eq("id", offerId).maybeSingle();
  assertNoDbError(error, "Webinarios: ler oferta");
  const row = (data as OfferRow | null) ?? null;
  return row ? offerFromRows(row, await variantsOf(db, [row.id])) : null;
}

/** As Ofertas (nao arquivadas) de varios webinarios: o painel e o relatorio mostram o produto e as variantes. */
export async function listOffersForWebinars(db: WebinarsDb, webinarIds: readonly string[]): Promise<WebinarOffer[]> {
  if (webinarIds.length === 0) {
    return [];
  }
  const { data, error } = await db.from("webinar_offers").select(OFFER_COLUMNS).in("webinar_id", [...new Set(webinarIds)]).neq("status", "archived");
  assertNoDbError(error, "Webinarios: ler ofertas");
  const rows = (data ?? []) as OfferRow[];
  const variants = await variantsOf(
    db,
    rows.map((row) => row.id)
  );
  return rows.map((row) => offerFromRows(row, variants));
}

function offerRowPatch(draft: OfferDraft) {
  return {
    attribution_days: draft.attributionDays,
    deadline_minutes: draft.deadlineMinutes,
    product_id: draft.productId,
    show_at_offset_ms: draft.triggerKind === "at_offset" ? draft.showAtOffsetMs : null,
    status: draft.status,
    title: draft.title.trim(),
    trigger_kind: draft.triggerKind,
    visible_minutes: draft.visibleMinutes
  };
}

/**
 * Grava a Oferta do webinario (insere a primeira ou atualiza a que existe) e as variantes: cada letra do rascunho e
 * gravada pela chave (offer_id, label); as letras que sairam do rascunho sao apagadas. O zod de offer-schemas.ts ja
 * conferiu o rascunho (letras unicas, link https, ao menos uma ligada).
 */
export async function saveOfferRows(db: WebinarsDb, input: { draft: OfferDraft; userId: string; webinarId: string }): Promise<WebinarOffer> {
  const current = await fetchOfferForWebinar(db, input.webinarId);
  let offerId: string;
  if (current) {
    const { error } = await db.from("webinar_offers").update(offerRowPatch(input.draft)).eq("id", current.id);
    assertNoDbError(error, "Webinarios: gravar oferta");
    offerId = current.id;
  } else {
    const { data, error } = await db
      .from("webinar_offers")
      .insert({ ...offerRowPatch(input.draft), created_by: input.userId, webinar_id: input.webinarId })
      .select("id")
      .single();
    assertNoDbError(error, "Webinarios: criar oferta");
    offerId = (data as { id: string }).id;
  }

  const labels = input.draft.variants.map((variant) => variant.label);
  if (input.draft.variants.length > 0) {
    const { error } = await db.from("webinar_offer_variants").upsert(
      input.draft.variants.map((variant) => ({
        badge: variant.badge,
        checkout_url: variant.checkoutUrl,
        coupon: variant.coupon,
        enabled: variant.enabled,
        headline: variant.headline.trim(),
        image_url: variant.imageUrl,
        label: variant.label,
        offer_id: offerId,
        price_from_label: variant.priceFromLabel,
        price_label: variant.priceLabel,
        weight: variant.weight
      })),
      { onConflict: "offer_id,label" }
    );
    assertNoDbError(error, "Webinarios: gravar variantes");
  }
  let removal = db.from("webinar_offer_variants").delete().eq("offer_id", offerId);
  if (labels.length > 0) {
    removal = removal.not("label", "in", `(${labels.join(",")})`);
  }
  const { error: removeError } = await removal;
  assertNoDbError(removeError, "Webinarios: apagar variantes");

  const saved = await fetchOfferById(db, offerId);
  if (!saved) {
    throw new Error("Webinarios: a oferta sumiu ao gravar");
  }
  return saved;
}

/** Arquiva a Oferta (o card some; cliques, janelas e conversoes ficam para o relatorio). */
export async function archiveOfferRow(db: WebinarsDb, offerId: string): Promise<void> {
  const { error } = await db.from("webinar_offers").update({ status: "archived" }).eq("id", offerId);
  assertNoDbError(error, "Webinarios: arquivar oferta");
}

/** Duplicar webinario (docs/30 §5.2: "duplicar copia roteiro, enquetes e oferta"): a Oferta vira rascunho no novo. */
export async function copyOfferToWebinar(db: WebinarsDb, input: { fromWebinarId: string; toWebinarId: string; userId: string }): Promise<WebinarOffer | null> {
  const source = await fetchOfferForWebinar(db, input.fromWebinarId);
  if (!source) {
    return null;
  }
  return saveOfferRows(db, {
    draft: {
      attributionDays: source.attributionDays,
      deadlineMinutes: source.deadlineMinutes,
      productId: source.productId,
      showAtOffsetMs: source.showAtOffsetMs,
      status: "draft",
      title: source.title,
      triggerKind: source.triggerKind,
      variants: source.variants.map((variant) => ({
        badge: variant.badge,
        checkoutUrl: variant.checkoutUrl,
        coupon: variant.coupon,
        enabled: variant.enabled,
        headline: variant.headline,
        imageUrl: variant.imageUrl,
        label: variant.label,
        priceFromLabel: variant.priceFromLabel,
        priceLabel: variant.priceLabel,
        weight: variant.weight
      })),
      visibleMinutes: source.visibleMinutes
    },
    userId: input.userId,
    webinarId: input.toWebinarId
  });
}

/* ------------------------------------------------------------------------------------------------
 * O que cada sessao mostrou (webinar_offer_displays)
 * ---------------------------------------------------------------------------------------------- */

export async function fetchOfferDisplayRow(db: WebinarsDb, input: { offerId: string; sessionId: string }): Promise<OfferDisplayRow | null> {
  const { data, error } = await db.from("webinar_offer_displays").select(OFFER_DISPLAY_COLUMNS).eq("session_id", input.sessionId).eq("offer_id", input.offerId).maybeSingle();
  assertNoDbError(error, "Webinarios: ler janela da oferta");
  return (data as OfferDisplayRow | null) ?? null;
}

export async function listOfferDisplayRows(db: WebinarsDb, sessionIds: readonly string[]): Promise<OfferDisplayRow[]> {
  if (sessionIds.length === 0) {
    return [];
  }
  const { data, error } = await db.from("webinar_offer_displays").select(OFFER_DISPLAY_COLUMNS).in("session_id", [...new Set(sessionIds)]);
  assertNoDbError(error, "Webinarios: ler janelas da oferta");
  return (data ?? []) as OfferDisplayRow[];
}

export type OfferDisplayInsert = {
  deadline_at: string | null;
  hide_offset_ms: number | null;
  offer_id: string;
  session_id: string;
  show_offset_ms: number;
  shown_by: string | null;
  snapshot: OfferDisplaySnapshot;
};

/**
 * A janela da sessao gravada uma vez (a primeira leitura do card "Num minuto do video" ou o "Mostrar agora"): duas
 * chamadas juntas ficam com a mesma linha (no 23505, le a que ja existe). Devolve a linha e se foi esta chamada que
 * criou.
 */
export async function ensureOfferDisplayRow(db: WebinarsDb, row: OfferDisplayInsert): Promise<{ created: boolean; row: OfferDisplayRow }> {
  const { data, error } = await db.from("webinar_offer_displays").insert(row).select(OFFER_DISPLAY_COLUMNS).single();
  if (error?.code === UNIQUE_VIOLATION) {
    const existing = await fetchOfferDisplayRow(db, { offerId: row.offer_id, sessionId: row.session_id });
    if (existing) {
      return { created: false, row: existing };
    }
  }
  assertNoDbError(error, "Webinarios: gravar janela da oferta");
  return { created: true, row: data as OfferDisplayRow };
}

export type OfferDisplayPatch = Partial<Pick<OfferDisplayRow, "deadline_at" | "hidden_at" | "hidden_by" | "hide_offset_ms" | "show_offset_ms" | "shown_at" | "shown_by">> & {
  snapshot?: OfferDisplaySnapshot;
};

/** "Mostrar agora" de novo / "Esconder" (o console): muda a janela da sessao. */
export async function updateOfferDisplayRow(db: WebinarsDb, id: string, patch: OfferDisplayPatch): Promise<OfferDisplayRow | null> {
  const { data, error } = await db.from("webinar_offer_displays").update(patch).eq("id", id).select(OFFER_DISPLAY_COLUMNS);
  assertNoDbError(error, "Webinarios: mudar janela da oferta");
  return ((data ?? []) as OfferDisplayRow[])[0] ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Os cliques
 * ---------------------------------------------------------------------------------------------- */

export type OfferClickInsert = {
  click_token: string;
  offer_id: string;
  offset_ms: number;
  session_id: string;
  user_id: string;
  variant_id: string | null;
  variant_label: OfferVariantLabel;
};

export async function insertOfferClick(db: WebinarsDb, row: OfferClickInsert): Promise<OfferClickRow> {
  const { data, error } = await db.from("webinar_offer_clicks").insert(row).select(OFFER_CLICK_COLUMNS).single();
  assertNoDbError(error, "Webinarios: gravar clique na oferta");
  return data as OfferClickRow;
}

/** O clique do aluno nesta oferta e sessao desde `sinceIso` (o mesmo link sai de novo sem gravar outro clique). */
export async function fetchRecentOfferClick(db: WebinarsDb, input: { offerId: string; sessionId: string; sinceIso: string; userId: string }): Promise<OfferClickRow | null> {
  const { data, error } = await db
    .from("webinar_offer_clicks")
    .select(OFFER_CLICK_COLUMNS)
    .eq("offer_id", input.offerId)
    .eq("session_id", input.sessionId)
    .eq("user_id", input.userId)
    .gte("clicked_at", input.sinceIso)
    .order("clicked_at", { ascending: false })
    .limit(1);
  assertNoDbError(error, "Webinarios: ler clique na oferta");
  return ((data ?? []) as OfferClickRow[])[0] ?? null;
}

/** Os cliques de uma sessao (o console conta por variante ao vivo; o relatorio e o CSV leem a RPC). */
export async function listSessionOfferClicks(db: WebinarsDb, sessionId: string, limit = 5000): Promise<OfferClickRow[]> {
  const { data, error } = await db.from("webinar_offer_clicks").select(OFFER_CLICK_COLUMNS).eq("session_id", sessionId).order("clicked_at", { ascending: true }).limit(limit);
  assertNoDbError(error, "Webinarios: ler cliques da sessao");
  return (data ?? []) as OfferClickRow[];
}

/** As vendas que nao valem mais como compra: o reembolso e o chargeback desfazem a venda (o cancelamento da assinatura nao). */
export const UNDONE_SALE_CLOSES: readonly string[] = ["refund", "chargeback"];

/**
 * O aluno ja comprou pela oferta (algum clique convertido numa venda que segue valendo): o card some para ele em
 * qualquer sessao ou replay. A venda reembolsada ou com chargeback nao conta: quem perdeu o acesso volta a ver a
 * oferta e pode comprar de novo. Duas leituras: os grants dos cliques convertidos e como cada um fechou.
 */
export async function hasConvertedOfferClick(db: WebinarsDb, input: { offerId: string; userId: string }): Promise<boolean> {
  const { data, error } = await db
    .from("webinar_offer_clicks")
    .select("converted_sale_grant_id")
    .eq("offer_id", input.offerId)
    .eq("user_id", input.userId)
    .not("converted_sale_grant_id", "is", null)
    .limit(50);
  assertNoDbError(error, "Webinarios: ler compra pela oferta");
  const grantIds = [...new Set(((data ?? []) as { converted_sale_grant_id: string | null }[]).map((row) => row.converted_sale_grant_id).filter((id): id is string => Boolean(id)))];
  if (grantIds.length === 0) {
    return false;
  }
  const grants = await db.from("sale_grants").select("id, closed_by").in("id", grantIds);
  assertNoDbError(grants.error, "Webinarios: ler a venda da oferta");
  return ((grants.data ?? []) as { closed_by: string | null; id: string }[]).some((grant) => !grant.closed_by || !UNDONE_SALE_CLOSES.includes(grant.closed_by));
}

/* ------------------------------------------------------------------------------------------------
 * A conversao (o job do tick) e os fatos do follow-up
 * ---------------------------------------------------------------------------------------------- */

/** webinar_offer_conversions: liga ate `limit` vendas aos cliques (M7); devolve quantos cliques converteram agora. */
export async function runOfferConversions(db: WebinarsDb, input: { limit: number; nowIso: string }): Promise<number> {
  const { data, error } = await db.rpc("webinar_offer_conversions", { p_limit: input.limit, p_now: input.nowIso });
  assertNoDbError(error, "Webinarios: conversoes da oferta");
  const value = typeof data === "number" ? data : Number(data);
  return Number.isFinite(value) ? value : 0;
}

/** webinar_follow_up_facts: o que cada aluno fez em cada webinario (as regras de follow-up da Comunicacao). */
export async function fetchWebinarFollowUpFacts(db: WebinarsDb, webinarIds: readonly string[]): Promise<WebinarFollowUpFacts[]> {
  const ids = [...new Set(webinarIds)];
  if (ids.length === 0) {
    return [];
  }
  // O PostgREST corta qualquer resposta (RPC tambem) em 1000 linhas sem erro: paginado em ordem estavel.
  const rows = await fetchAll<FollowUpFactsRow>(
    (from, to) => db.rpc("webinar_follow_up_facts", { p_webinar_ids: ids }).order("webinar_id").order("user_id").range(from, to),
    "Webinarios: fatos do follow-up"
  );
  return rows.map(followUpFactsFromRow);
}
