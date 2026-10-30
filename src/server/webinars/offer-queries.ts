// A Oferta lida e clicada pelo aluno e lida pelo console (docs/30 §1.6, §2.4, §5.1, §8.6 e M7), pela service role.
// GET .../offer: so na sessao gravada e no replay (a live nunca tem card); oferta ligada com variante ligada; quem ja
// tem o produto (acesso interno ativo) ou ja comprou pela oferta (clique convertido) nao recebe nada; a variante e a
// do hash do aluno (offerVariantFor, nunca gravada); a janela vem da linha da sessao ou do minuto marcado, e a
// primeira leitura dentro da janela grava a linha uma vez (ensureOfferDisplayRow). POST .../offer-click: o banido de
// todos os webinarios recebe 409 banned; fora da janela, escondida ou com o prazo vencido, 409 offer_hidden; o mesmo
// aluno, oferta e sessao em ate 10 s recebe o mesmo link; senao um click_token novo, o clique gravado e o registro
// webinar_offer_clicked (so ids e numeros) que a rota grava depois da resposta. O link do checkout so sai aqui, com
// ?b7=<token>. Banco sem a 202610300003: o aluno recebe { offer: null } e o console o aviso da migracao.

import "server-only";

import { isPendingMigrationError } from "../db/pending-migration";
import { fetchEntitlements, type StudentEventInsert } from "../students/store";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { WebinarError, type WebinarsDb } from "./db";
import { fetchUserBan } from "./live-store";
import { OFFER_LIMITS, type OfferVariant, type StudentOfferView, type WebinarOffer, type WebinarSession } from "./model";
import { checkoutUrlWithToken, newClickToken, offerVariantFor } from "./offer-model";
import {
  offerClickCounts,
  offerClickRefusal,
  offerOffsetMs,
  offerOnScreen,
  offerWindowFor,
  ownsOfferProduct,
  plannedOfferDisplayDraft,
  plannedOfferWindow,
  replayDisplayOutdated,
  shouldRecordOfferDisplay,
  studentOfferPollMs,
  studentOfferView,
  type OfferClickCounts,
  type OfferWindow
} from "./offer-room-model";
import {
  ensureOfferDisplayRow,
  fetchOfferById,
  fetchOfferDisplayRow,
  fetchOfferForWebinar,
  fetchRecentOfferClick,
  hasConvertedOfferClick,
  insertOfferClick,
  listSessionOfferClicks,
  updateOfferDisplayRow
} from "./offer-store";
import type { RoomContext } from "./room-queries";
import { RoomRefusedError } from "./room-writes";
import { offerClickFromRow, offerDisplayFromRow, sessionFromRow, type OfferDisplayRow } from "./rows";
import { fetchSessionRow } from "./store";

const COPY = WEBINAR_COPY.oferta;

/** 409 { reason: "offer_hidden" }: o card nao esta na tela (fora da janela, escondido, prazo vencido ou sem oferta). */
export class OfferHiddenError extends WebinarError {
  reason = "offer_hidden" as const;

  constructor(message: string = COPY.aluno.foraDaTela) {
    super(message, 409);
    this.name = "OfferHiddenError";
  }
}

/** A Oferta do webinario; banco sem a 202610300003, nula (a sala segue sem o card). */
async function offerOrNull(load: () => Promise<WebinarOffer | null>): Promise<WebinarOffer | null> {
  try {
    return await load();
  } catch (error) {
    if (isPendingMigrationError(error)) {
      return null;
    }
    throw error;
  }
}

function offerIsLive(offer: WebinarOffer | null): offer is WebinarOffer {
  return Boolean(offer && offer.status === "active" && offer.triggerKind !== "never");
}

/* ------------------------------------------------------------------------------------------------
 * GET .../offer
 * ---------------------------------------------------------------------------------------------- */

export type StudentOfferResult = { offer: StudentOfferView | null; pollMs: number; serverTime: string };

/** Grava a linha do "Num minuto do video" nesta sessao, uma vez (duas leituras juntas ficam com a mesma linha). */
async function recordPlannedDisplay(input: { db: WebinarsDb; nowMs: number; offer: WebinarOffer; session: WebinarSession; window: OfferWindow }): Promise<OfferDisplayRow> {
  const { row } = await ensureOfferDisplayRow(input.db, plannedOfferDisplayDraft({ nowMs: input.nowMs, offer: input.offer, sessionId: input.session.id, window: input.window }));
  return row;
}

export async function loadStudentOffer(input: { context: Pick<RoomContext, "durationMs" | "session" | "webinar">; db: WebinarsDb; nowMs?: number; userId: string }): Promise<StudentOfferResult> {
  const { context, db, userId } = input;
  const nowMs = input.nowMs ?? Date.now();
  const session = context.session;
  const empty = (teamMayChange = false): StudentOfferResult => ({ offer: null, pollMs: studentOfferPollMs({ session, teamMayChange }), serverTime: new Date(nowMs).toISOString() });

  if (session.kind === "live") {
    return empty();
  }
  const offer = await offerOrNull(() => fetchOfferForWebinar(db, context.webinar.id));
  if (!offerIsLive(offer)) {
    return empty();
  }
  const variant = offerVariantFor({ offerId: offer.id, userId, variants: offer.variants });
  if (!variant) {
    return empty();
  }

  const [converted, entitlements, displayRow] = await Promise.all([
    hasConvertedOfferClick(db, { offerId: offer.id, userId }),
    fetchEntitlements(db, { userId }),
    fetchOfferDisplayRow(db, { offerId: offer.id, sessionId: session.id })
  ]);
  if (converted || ownsOfferProduct(entitlements, offer.productId, nowMs)) {
    return empty();
  }

  let display = displayRow;
  const offsetMs = offerOffsetMs(session, nowMs);
  const planned = plannedOfferWindow(offer, session);
  if (display && planned && session.kind === "replay" && replayDisplayOutdated(offerDisplayFromRow(display), planned)) {
    const draft = plannedOfferDisplayDraft({ nowMs, offer, sessionId: session.id, window: planned });
    display =
      (await updateOfferDisplayRow(db, display.id, { deadline_at: draft.deadline_at, hide_offset_ms: draft.hide_offset_ms, show_offset_ms: draft.show_offset_ms, snapshot: draft.snapshot })) ?? display;
  }
  let window = offerWindowFor({ display: display ? offerDisplayFromRow(display) : null, offer, session });
  if (window && !display && shouldRecordOfferDisplay({ durationMs: context.durationMs, offsetMs, session, window })) {
    display = await recordPlannedDisplay({ db, nowMs, offer, session, window });
    window = offerWindowFor({ display: offerDisplayFromRow(display), offer, session });
  }

  if (!window || (window.hidden && !offerOnScreen(window, Number.isFinite(offsetMs) ? offsetMs : window.showAtMs))) {
    // "Pelo botao da equipe" sem o Mostrar agora (ou ja escondida): nada na tela; a sala rele mais vezes.
    return empty(offer.triggerKind === "manual");
  }

  // Na gravada o servidor sabe o segundo do video; no replay quem decide e o player (a janela vai junto). Com o card
  // na tela (ou pelo botao da equipe), a sala rele mais vezes: o Esconder do console chega logo.
  const visible = session.kind === "simulated" ? offerOnScreen(window, offsetMs) : true;
  return {
    offer: studentOfferView({ offer, variant, visible, window }),
    pollMs: studentOfferPollMs({ session, teamMayChange: offer.triggerKind === "manual" || (session.kind === "simulated" && visible) }),
    serverTime: new Date(nowMs).toISOString()
  };
}

/* ------------------------------------------------------------------------------------------------
 * POST .../offer-click
 * ---------------------------------------------------------------------------------------------- */

export type OfferClickResult = { created: boolean; events: StudentEventInsert[]; url: string };

function clickedEvent(userId: string, sessionId: string, metadata: { offer_id: string; offset_ms: number; variant: string }): StudentEventInsert {
  return { entity_id: sessionId, entity_type: "webinar", event_type: "webinar_offer_clicked", metadata, user_id: userId };
}

export async function clickStudentOffer(input: {
  bodyOffsetMs?: number | null;
  context: Pick<RoomContext, "durationMs" | "session" | "webinar">;
  db: WebinarsDb;
  nowMs?: number;
  offerId: string;
  userId: string;
}): Promise<OfferClickResult> {
  const { context, db, userId } = input;
  const nowMs = input.nowMs ?? Date.now();
  const session = context.session;
  if (session.kind === "live") {
    throw new OfferHiddenError();
  }

  // Na Live gravada e no Replay, so o banido de todos os webinarios recusa (D33), como as outras escritas da sala.
  if (await fetchUserBan(db, userId)) {
    throw new RoomRefusedError("banned", WEBINAR_COPY.aoVivo.banido);
  }

  const offer = await offerOrNull(() => fetchOfferById(db, input.offerId));
  if (!offer || offer.webinarId !== context.webinar.id || offer.status === "archived") {
    throw new WebinarError(COPY.aluno.naoEncontrada, 404);
  }
  if (!offerIsLive(offer)) {
    throw new OfferHiddenError();
  }
  const variant: OfferVariant | null = offerVariantFor({ offerId: offer.id, userId, variants: offer.variants });
  if (!variant) {
    throw new OfferHiddenError();
  }

  const display = await fetchOfferDisplayRow(db, { offerId: offer.id, sessionId: session.id });
  const offsetMs = offerOffsetMs(session, nowMs, input.bodyOffsetMs);
  const window = offerWindowFor({ display: display ? offerDisplayFromRow(display) : null, offer, session });
  if (offerClickRefusal({ nowMs, offsetMs, window })) {
    throw new OfferHiddenError();
  }
  // O link precisa ser https (o zod do editor ja confere; uma linha antiga fora disso nao abre nada).
  if (checkoutUrlWithToken(variant.checkoutUrl, "") === null) {
    throw new OfferHiddenError();
  }
  // O clique tambem garante a linha do que a sessao mostrou (o aluno clicou antes de qualquer leitura no minuto).
  if (window && !display && shouldRecordOfferDisplay({ durationMs: context.durationMs, offsetMs, session, window })) {
    await recordPlannedDisplay({ db, nowMs, offer, session, window });
  }

  const recent = await fetchRecentOfferClick(db, {
    offerId: offer.id,
    sessionId: session.id,
    sinceIso: new Date(nowMs - OFFER_LIMITS.clickRepeatSeconds * 1000).toISOString(),
    userId
  });
  if (recent) {
    const again = checkoutUrlWithToken(variant.checkoutUrl, recent.click_token);
    if (again) {
      return { created: false, events: [], url: again };
    }
  }

  const token = newClickToken();
  const url = checkoutUrlWithToken(variant.checkoutUrl, token);
  if (!url) {
    throw new OfferHiddenError();
  }
  const offset = Math.round(offsetMs);
  await insertOfferClick(db, {
    click_token: token,
    offer_id: offer.id,
    offset_ms: offset,
    session_id: session.id,
    user_id: userId,
    variant_id: variant.id,
    variant_label: variant.label
  });
  return { created: true, events: [clickedEvent(userId, session.id, { offer_id: offer.id, offset_ms: offset, variant: variant.label })], url };
}

/* ------------------------------------------------------------------------------------------------
 * O console (loadOfferConsole, a cada 5 s)
 * ---------------------------------------------------------------------------------------------- */

export type ConsoleOfferVariant = { enabled: boolean; headline: string; label: OfferVariant["label"] };

export type ConsoleOfferView = {
  /** "Mostrar agora" / "Esconder" valem: sessao gravada que nao terminou e oferta ligada (nao "Nunca"). */
  canShow: boolean;
  clicks: OfferClickCounts;
  offer: { id: string; status: WebinarOffer["status"]; title: string; triggerKind: WebinarOffer["triggerKind"]; variants: ConsoleOfferVariant[] } | null;
  /** Na tela agora pelo relogio do servidor (so na gravada; no replay cada aluno tem o proprio minuto). */
  onScreen: boolean;
  serverTime: string;
  sessionKind: WebinarSession["kind"];
  sessionStatus: WebinarSession["status"];
  window: OfferWindow | null;
};

export async function loadConsoleOffer(db: WebinarsDb, input: { nowMs?: number; sessionId: string; webinarId?: string | null }): Promise<ConsoleOfferView> {
  const nowMs = input.nowMs ?? Date.now();
  const row = await fetchSessionRow(db, input.sessionId);
  if (!row || (input.webinarId && row.webinar_id !== input.webinarId)) {
    throw new WebinarError(COPY.console.sessaoInvalida, 404);
  }
  const session = sessionFromRow(row);
  const offer = await fetchOfferForWebinar(db, session.webinarId);
  const base: ConsoleOfferView = {
    canShow: false,
    clicks: offerClickCounts([]),
    offer: null,
    onScreen: false,
    serverTime: new Date(nowMs).toISOString(),
    sessionKind: session.kind,
    sessionStatus: session.status,
    window: null
  };
  if (!offer) {
    return base;
  }
  const [display, clickRows] = await Promise.all([fetchOfferDisplayRow(db, { offerId: offer.id, sessionId: session.id }), listSessionOfferClicks(db, session.id)]);
  const clicks = clickRows.map(offerClickFromRow).filter((click) => click.offerId === offer.id);
  const window = offerWindowFor({ display: display ? offerDisplayFromRow(display) : null, offer, session });
  const offsetMs = offerOffsetMs(session, nowMs);
  const open = session.kind === "simulated" && session.status !== "ended" && session.status !== "cancelled";
  return {
    ...base,
    canShow: open && offerIsLive(offer),
    clicks: offerClickCounts(
      clicks,
      offer.variants.map((variant) => variant.label)
    ),
    offer: {
      id: offer.id,
      status: offer.status,
      title: offer.title,
      triggerKind: offer.triggerKind,
      variants: offer.variants.map((variant) => ({ enabled: variant.enabled, headline: variant.headline, label: variant.label }))
    },
    onScreen: session.kind === "simulated" && offerIsLive(offer) && offerOnScreen(window, offsetMs),
    window
  };
}

/** A sessao do console conferida: existe, e do webinario, e a gravada que ainda nao terminou (Mostrar / Esconder). */
export async function requireOfferConsoleSession(db: WebinarsDb, sessionId: string): Promise<WebinarSession> {
  const row = await fetchSessionRow(db, sessionId);
  if (!row) {
    throw new WebinarError(COPY.console.sessaoInvalida, 404);
  }
  const session = sessionFromRow(row);
  if (session.kind !== "simulated" || session.status === "ended" || session.status === "cancelled") {
    throw new WebinarError(COPY.console.soNaGravada, 409);
  }
  return session;
}
