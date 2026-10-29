"use server";

// Server Actions da Oferta (docs/30 §2.2, §2.4, §8.6 e M7; fase 4b): o card Oferta do editor (loadOfferEditor,
// saveOffer, archiveOffer) e o painel Oferta do console (loadOfferConsole a cada 5 s, showOfferNow, hideOffer). Todas
// com messaging.write por runAdminAction; as escritas gravam recordAudit so com ids e contagens (nunca o texto das
// variantes nem o link) e derrubam o cache do relatorio (invalidateWebinars). O relogio e sempre o do servidor: o
// "Mostrar agora" aparece no segundo do video de agora (hora marcada da sessao gravada) e so na sessao gravada que
// ainda nao terminou. Banco sem a 202610300003: a leitura devolve { pendingMigration } e a tela mostra o aviso.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { listProductOptions } from "@/server/catalog/queries";
import type { ProductOption } from "@/server/catalog/types";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { invalidateWebinars } from "./cache";
import { WEBINARS_OFFERS_MIGRATION, WebinarError, webinarsDb } from "./db";
import type { OfferDraft, WebinarKind, WebinarOffer } from "./model";
import { hideOfferDisplayPatch, manualOfferDisplay, offerOffsetMs, offerOnScreen, offerWindowFor, plannedOfferDisplayDraft } from "./offer-room-model";
import { loadConsoleOffer, requireOfferConsoleSession, type ConsoleOfferView } from "./offer-queries";
import { OFFER_MESSAGES, offerDisplayActionSchema, saveOfferSchema, type OfferDraftInput } from "./offer-schemas";
import { archiveOfferRow, ensureOfferDisplayRow, fetchOfferById, fetchOfferDisplayRow, fetchOfferForWebinar, saveOfferRows, updateOfferDisplayRow } from "./offer-store";
import { offerDisplayFromRow, type OfferDisplayRow } from "./rows";
import { requireWebinarRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";
const COPY = WEBINAR_COPY.oferta;

const webinarIdSchema = z.object({ webinarId: z.uuid({ error: OFFER_MESSAGES.invalid }) });
const sessionIdSchema = z.object({ sessionId: z.uuid({ error: OFFER_MESSAGES.invalid }) });
const archiveOfferSchema = z.object({ offerId: z.uuid({ error: OFFER_MESSAGES.invalid }), webinarId: z.uuid({ error: OFFER_MESSAGES.invalid }) });

export type PendingOfferMigration = { migration: string; pendingMigration: true };

export type OfferEditorData =
  | PendingOfferMigration
  | { kind: WebinarKind; offer: WebinarOffer | null; pendingMigration: false; products: ProductOption[]; productsLoaded: boolean };

export type OfferConsoleData = PendingOfferMigration | { pendingMigration: false; view: ConsoleOfferView };

const pending = (): PendingOfferMigration => ({ migration: WEBINARS_OFFERS_MIGRATION, pendingMigration: true });

/** Uma escrita que esbarra no banco sem a 202610300003 vira 409 com a frase da migracao (nunca um 500 generico). */
async function withOfferTables<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isPendingMigrationError(error)) {
      throw new WebinarError(COPY.card.precisaMigracao(WEBINARS_OFFERS_MIGRATION), 409);
    }
    throw error;
  }
}

/* ------------------------------------------------------------------------------------------------
 * O card Oferta do editor
 * ---------------------------------------------------------------------------------------------- */

/** [messaging.write] A Oferta do webinario (nula quando ainda nao existe) e os produtos do seletor. */
export async function loadOfferEditor(input: { webinarId: string }): Promise<ActionResult<OfferEditorData>> {
  return runAdminAction("messaging.write", webinarIdSchema, input, async ({ input: data }) => {
    const db = webinarsDb();
    const webinar = await requireWebinarRow(db, data.webinarId);
    let offer: WebinarOffer | null;
    try {
      offer = await fetchOfferForWebinar(db, webinar.id);
    } catch (error) {
      if (isPendingMigrationError(error)) {
        return pending();
      }
      throw error;
    }
    const products = await listProductOptions()
      .then((items) => ({ items, loaded: true }))
      .catch((error: unknown) => {
        console.error("[admin/webinarios] produtos da oferta", error);
        return { items: [] as ProductOption[], loaded: false };
      });
    return { kind: webinar.kind as WebinarKind, offer, pendingMigration: false, products: products.items, productsLoaded: products.loaded };
  });
}

/**
 * [messaging.write] Grava a Oferta do webinario (a primeira ou a que existe) com as variantes A, B, C e D: o zod de
 * offer-schemas.ts confere letras unicas, link https e, ligada, pelo menos uma variante ligada.
 */
export async function saveOffer(input: { draft: OfferDraftInput; webinarId: string }): Promise<ActionResult<WebinarOffer>> {
  return runAdminAction("messaging.write", saveOfferSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const webinar = await requireWebinarRow(db, data.webinarId);
    const draft: OfferDraft = data.draft;
    const saved = await withOfferTables(() => saveOfferRows(db, { draft, userId: user.id, webinarId: webinar.id }));

    await recordAudit(db, {
      action: "webinar.offer_saved",
      actorId: user.id,
      count: saved.variants.length,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: {
        attribution_days: saved.attributionDays,
        enabled_variants: saved.variants.filter((variant) => variant.enabled).length,
        offer_id: saved.id,
        product_id: saved.productId,
        status: saved.status,
        trigger_kind: saved.triggerKind,
        variants: saved.variants.length
      }
    });
    revalidatePath(`${LIST_PATH}/${webinar.id}`);
    invalidateWebinars({ from: "action" });

    return saved;
  });
}

/** [messaging.write] Arquiva a Oferta: o card some da sala; cliques, janelas e compras ficam no relatorio. */
export async function archiveOffer(input: { offerId: string; webinarId: string }): Promise<ActionResult<{ archived: true; offerId: string }>> {
  return runAdminAction("messaging.write", archiveOfferSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const offer = await withOfferTables(() => fetchOfferById(db, data.offerId));
    if (!offer || offer.webinarId !== data.webinarId) {
      throw new WebinarError(COPY.console.ofertaInvalida, 404);
    }
    await archiveOfferRow(db, offer.id);

    await recordAudit(db, {
      action: "webinar.offer_archived",
      actorId: user.id,
      count: offer.variants.length,
      entityId: offer.webinarId,
      entityType: "webinar",
      metadata: { offer_id: offer.id, previous_status: offer.status, variants: offer.variants.length }
    });
    revalidatePath(`${LIST_PATH}/${offer.webinarId}`);
    invalidateWebinars({ from: "action" });

    return { archived: true as const, offerId: offer.id };
  });
}

/* ------------------------------------------------------------------------------------------------
 * O painel Oferta do console
 * ---------------------------------------------------------------------------------------------- */

/** [messaging.write] A janela da oferta nesta sessao e os cliques por variante, relidos a cada 5 s. */
export async function loadOfferConsole(input: { sessionId: string }): Promise<ActionResult<OfferConsoleData>> {
  return runAdminAction("messaging.write", sessionIdSchema, input, async ({ input: data }) => {
    try {
      return { pendingMigration: false as const, view: await loadConsoleOffer(webinarsDb(), { sessionId: data.sessionId }) };
    } catch (error) {
      if (isPendingMigrationError(error)) {
        return pending();
      }
      throw error;
    }
  });
}

async function requireConsoleOffer(input: { offerId: string; sessionId: string }) {
  const db = webinarsDb();
  const session = await requireOfferConsoleSession(db, input.sessionId);
  const offer = await withOfferTables(() => fetchOfferById(db, input.offerId));
  if (!offer || offer.webinarId !== session.webinarId) {
    throw new WebinarError(COPY.console.ofertaInvalida, 404);
  }
  if (offer.status !== "active" || offer.triggerKind === "never") {
    throw new WebinarError(COPY.console.naoLigada, 409);
  }
  return { db, offer, session };
}

/**
 * [messaging.write] "Mostrar agora": a oferta aparece no segundo do video de agora nesta sessao gravada e some
 * `visibleMinutes` depois (ou no fim). Mostrar de novo reabre a janela da sessao com o prazo da primeira vez.
 */
export async function showOfferNow(input: { offerId: string; sessionId: string }): Promise<ActionResult<ConsoleOfferView>> {
  return runAdminAction("messaging.write", offerDisplayActionSchema, input, async ({ input: data, user }) => {
    const { db, offer, session } = await requireConsoleOffer(data);
    const nowMs = Date.now();
    const offsetMs = offerOffsetMs(session, nowMs);
    if (!Number.isFinite(offsetMs)) {
      throw new WebinarError(COPY.console.soNaGravada, 409);
    }

    const existing = await fetchOfferDisplayRow(db, { offerId: offer.id, sessionId: session.id });
    const draft = manualOfferDisplay({ existing: existing ? offerDisplayFromRow(existing) : null, jit: session.jit, nowMs, offer, offsetMs, sessionId: session.id, userId: user.id });
    const patch = {
      deadline_at: draft.deadline_at,
      hidden_at: draft.hidden_at,
      hidden_by: draft.hidden_by,
      hide_offset_ms: draft.hide_offset_ms,
      show_offset_ms: draft.show_offset_ms,
      shown_at: draft.shown_at,
      shown_by: draft.shown_by,
      snapshot: draft.snapshot
    };
    let row: OfferDisplayRow | null;
    if (existing) {
      row = await updateOfferDisplayRow(db, existing.id, patch);
    } else {
      const ensured = await ensureOfferDisplayRow(db, {
        deadline_at: draft.deadline_at,
        hide_offset_ms: draft.hide_offset_ms,
        offer_id: draft.offer_id,
        session_id: draft.session_id,
        show_offset_ms: draft.show_offset_ms,
        shown_by: draft.shown_by,
        snapshot: draft.snapshot
      });
      // Duas maos ao mesmo tempo: quem chegou depois atualiza a linha que a outra criou.
      row = ensured.created ? ensured.row : await updateOfferDisplayRow(db, ensured.row.id, patch);
    }

    await recordAudit(db, {
      action: "webinar.offer_shown",
      actorId: user.id,
      entityId: session.webinarId,
      entityType: "webinar",
      metadata: {
        display_id: row?.id ?? null,
        hide_offset_ms: draft.hide_offset_ms,
        offer_id: offer.id,
        offset_ms: Math.round(offsetMs),
        session_id: session.id,
        show_offset_ms: draft.show_offset_ms,
        with_deadline: draft.deadline_at !== null
      }
    });
    revalidatePath(`${LIST_PATH}/${session.webinarId}/sala`);
    invalidateWebinars({ from: "action" });

    return loadConsoleOffer(db, { nowMs, sessionId: session.id });
  });
}

/** [messaging.write] "Esconder": a janela da sessao fecha no segundo do video de agora. */
export async function hideOffer(input: { offerId: string; sessionId: string }): Promise<ActionResult<ConsoleOfferView>> {
  return runAdminAction("messaging.write", offerDisplayActionSchema, input, async ({ input: data, user }) => {
    const { db, offer, session } = await requireConsoleOffer(data);
    const nowMs = Date.now();
    const offsetMs = offerOffsetMs(session, nowMs);
    let existing = await fetchOfferDisplayRow(db, { offerId: offer.id, sessionId: session.id });
    const window = offerWindowFor({ display: existing ? offerDisplayFromRow(existing) : null, offer, session });
    if (!window || !offerOnScreen(window, offsetMs)) {
      throw new WebinarError(COPY.console.jaEscondida, 409);
    }
    // O minuto marcado ja estava na tela sem a linha (nenhum aluno leu ainda): grava a linha e fecha.
    if (!existing) {
      existing = (await ensureOfferDisplayRow(db, plannedOfferDisplayDraft({ nowMs, offer, sessionId: session.id, window }))).row;
    }
    const patch = hideOfferDisplayPatch({ display: offerDisplayFromRow(existing), nowMs, offsetMs, userId: user.id });
    await updateOfferDisplayRow(db, existing.id, patch);

    await recordAudit(db, {
      action: "webinar.offer_hidden",
      actorId: user.id,
      entityId: session.webinarId,
      entityType: "webinar",
      metadata: { display_id: existing.id, hide_offset_ms: patch.hide_offset_ms, offer_id: offer.id, session_id: session.id }
    });
    revalidatePath(`${LIST_PATH}/${session.webinarId}/sala`);
    invalidateWebinars({ from: "action" });

    return loadConsoleOffer(db, { nowMs, sessionId: session.id });
  });
}
