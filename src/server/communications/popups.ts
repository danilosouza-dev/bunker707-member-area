import "server-only";

// Pop-up da home do aluno (docs/22 §4; docs/17 §1.8.1): no maximo 1 a cada 24 h (o limite de 1 por
// sessao fica no navegador), so para quem esta no segmento (linha elegivel em campaign_deliveries,
// mantida pelo job), nunca de novo depois de clicar ou de "Não mostrar de novo". A lista curta de
// pop-ups no ar fica em cache (60 s, tag "communications"); o estado do aluno e lido na hora, em duas
// consultas pequenas por chave primaria/indice. A equipe nunca tem linha de entrega: nunca ve pop-up.

import { unstable_cache } from "next/cache";
import { isHttpsOrLoopbackUrl } from "@/lib/loopback-url";
import { isSafeHeroCtaHref } from "@/server/member-area/home-hero-links";
import { COMMUNICATIONS_TAG, LIVE_POPUPS_CACHE_KEY } from "./cache";
import {
  canSnooze,
  isPopupLive,
  pickPopup,
  popupEventPatch,
  type LivePopup,
  type PopupDeliveryState,
  type PopupEvent,
  type PopupRepeat
} from "./campaign-model";
import { assertNoDbError, communicationsDb, CommunicationError, isMissingCommunicationSchema } from "./db";
import { normalizePeaks, type PopupItem } from "./notification-model";

export const POPUP_NOT_FOUND = "Pop-up nao encontrado.";
export const SNOOZE_REFUSED = "Não dá para lembrar depois de novo.";

const LIVE_POPUP_COLUMNS =
  "id,kind,status,title,body,image_url,image_alt,audio_url,audio_mime,audio_duration_seconds,audio_peaks,cta_label,cta_href,cta_target,popup_repeat,allow_snooze,starts_at,ends_at,sent_at,created_at";
const DELIVERY_COLUMNS = "campaign_id,eligible,impressions,last_seen_at,clicked_at,dismissed_at,snoozed_until,snooze_count";

type LivePopupRow = {
  allow_snooze: boolean;
  audio_duration_seconds: number | null;
  audio_mime: string | null;
  audio_peaks: unknown;
  audio_url: string | null;
  body: string;
  created_at: string;
  cta_href: string | null;
  cta_label: string | null;
  cta_target: "new_tab" | "same_tab" | null;
  ends_at: string | null;
  id: string;
  image_alt: string | null;
  image_url: string | null;
  kind: "popup";
  popup_repeat: PopupRepeat;
  sent_at: string | null;
  starts_at: string | null;
  status: "active";
  title: string;
};

type DeliveryRow = {
  campaign_id: string;
  clicked_at: string | null;
  dismissed_at: string | null;
  eligible: boolean;
  impressions: number;
  last_seen_at: string | null;
  snooze_count: number;
  snoozed_until: string | null;
};

function timeOf(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

/** Pop-ups publicados que ainda nao acabaram (o filtro fino da janela usa a hora de cada pedido). */
async function loadLivePopupRows(): Promise<LivePopupRow[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await communicationsDb()
    .from("campaigns")
    .select(LIVE_POPUP_COLUMNS)
    .eq("kind", "popup")
    .eq("status", "active")
    .is("deleted_at", null)
    .or(`ends_at.is.null,ends_at.gt."${nowIso}"`)
    .order("starts_at", { ascending: false, nullsFirst: false })
    .limit(50);

  if (error) {
    if (isMissingCommunicationSchema(error)) {
      return [];
    }

    assertNoDbError(error, "Pop-ups no ar");
  }

  return (data ?? []) as LivePopupRow[];
}

const getLivePopupRows = unstable_cache(loadLivePopupRows, [...LIVE_POPUPS_CACHE_KEY], {
  revalidate: 60,
  tags: [COMMUNICATIONS_TAG]
});

function toDeliveryState(row: DeliveryRow): PopupDeliveryState {
  return {
    campaignId: row.campaign_id,
    clickedAt: timeOf(row.clicked_at),
    dismissedAt: timeOf(row.dismissed_at),
    eligible: row.eligible,
    impressions: row.impressions,
    lastSeenAt: timeOf(row.last_seen_at),
    snoozeCount: row.snooze_count,
    snoozedUntil: timeOf(row.snoozed_until)
  };
}

/** Ordem dos pop-ups: o inicio da janela; sem inicio, quando foi publicado. */
function popupStart(row: Pick<LivePopupRow, "created_at" | "sent_at" | "starts_at">) {
  return timeOf(row.starts_at) ?? timeOf(row.sent_at) ?? timeOf(row.created_at) ?? 0;
}

function isLiveRow(row: LivePopupRow, now: number) {
  return isPopupLive({ endsAt: row.ends_at, kind: "popup", sendAt: null, startsAt: row.starts_at, status: row.status }, now);
}

function safeMediaUrl(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    return isHttpsOrLoopbackUrl(url) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function toPopupItem(row: LivePopupRow, delivery: PopupDeliveryState): PopupItem {
  const imageUrl = safeMediaUrl(row.image_url);
  const audioUrl = safeMediaUrl(row.audio_url);

  return {
    audio:
      audioUrl && row.audio_duration_seconds
        ? { durationSeconds: row.audio_duration_seconds, mimeType: row.audio_mime, peaks: normalizePeaks(row.audio_peaks), url: audioUrl }
        : null,
    body: row.body ?? "",
    canSnooze: canSnooze(delivery, row.allow_snooze),
    cta:
      row.cta_href && row.cta_label && row.cta_target && isSafeHeroCtaHref(row.cta_href)
        ? { href: row.cta_href, label: row.cta_label, target: row.cta_target }
        : null,
    id: row.id,
    image: imageUrl ? { alt: row.image_alt ?? "", url: imageUrl } : null,
    title: row.title
  };
}

/** O pop-up que o aluno deve ver agora na home, ou null. */
export async function getEligiblePopup(userId: string, now = Date.now()): Promise<PopupItem | null> {
  try {
    const live = (await getLivePopupRows()).filter((row) => isLiveRow(row, now));

    if (live.length === 0) {
      return null;
    }

    const db = communicationsDb();
    const [deliveries, lastSeen] = await Promise.all([
      db.from("campaign_deliveries").select(DELIVERY_COLUMNS).eq("user_id", userId).in("campaign_id", live.map((row) => row.id)),
      db
        .from("campaign_deliveries")
        .select("last_seen_at")
        .eq("user_id", userId)
        .not("last_seen_at", "is", null)
        .order("last_seen_at", { ascending: false })
        .limit(1)
    ]);
    assertNoDbError(deliveries.error, "Pop-up do aluno");
    assertNoDbError(lastSeen.error, "Ultimo pop-up do aluno");

    const states = ((deliveries.data ?? []) as DeliveryRow[]).map(toDeliveryState);
    const livePopups: LivePopup[] = live.map((row) => ({
      allowSnooze: row.allow_snooze,
      id: row.id,
      repeat: row.popup_repeat,
      startsAt: popupStart(row)
    }));
    const chosen = pickPopup({
      deliveries: states,
      lastAnyPopupSeenAt: timeOf(((lastSeen.data ?? []) as { last_seen_at: string | null }[])[0]?.last_seen_at),
      live: livePopups,
      now
    });

    if (!chosen) {
      return null;
    }

    const row = live.find((item) => item.id === chosen)!;
    const delivery = states.find((state) => state.campaignId === chosen)!;

    return toPopupItem(row, delivery);
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      return null;
    }

    throw error;
  }
}

/**
 * Evento do aluno no pop-up (impressao, clique, fechar, "Não mostrar de novo", "Lembrar depois"). So
 * vale para pop-up no ar com linha elegivel do proprio aluno; "Lembrar depois" alem do limite e 409.
 */
export async function recordPopupEvent(userId: string, campaignId: string, event: PopupEvent, now = Date.now()) {
  const db = communicationsDb();

  try {
    const [campaignResult, deliveryResult] = await Promise.all([
      db.from("campaigns").select("id,kind,status,starts_at,ends_at,allow_snooze,deleted_at").eq("id", campaignId).is("deleted_at", null).maybeSingle(),
      db.from("campaign_deliveries").select(DELIVERY_COLUMNS).eq("campaign_id", campaignId).eq("user_id", userId).maybeSingle()
    ]);
    assertNoDbError(campaignResult.error, "Pop-up");
    assertNoDbError(deliveryResult.error, "Pop-up do aluno");

    const campaign = campaignResult.data as
      | { allow_snooze: boolean; ends_at: string | null; id: string; kind: string; starts_at: string | null; status: string }
      | null;
    const delivery = deliveryResult.data as DeliveryRow | null;

    if (
      !campaign ||
      campaign.kind !== "popup" ||
      !isPopupLive({ endsAt: campaign.ends_at, kind: "popup", sendAt: null, startsAt: campaign.starts_at, status: campaign.status as "active" }, now) ||
      !delivery ||
      !delivery.eligible
    ) {
      throw new CommunicationError(POPUP_NOT_FOUND, 404);
    }

    const state = toDeliveryState(delivery);
    const patch = popupEventPatch(state, event, { allowSnooze: campaign.allow_snooze, now });

    if (!patch) {
      throw new CommunicationError(SNOOZE_REFUSED, 409);
    }

    if (Object.keys(patch).length === 0) {
      return { changed: false };
    }

    let update = db.from("campaign_deliveries").update(patch).eq("campaign_id", campaignId).eq("user_id", userId);

    // Contadores mudam so sobre o valor lido (duas abas ao mesmo tempo nao passam do limite).
    if (event === "snoozed") {
      update = update.eq("snooze_count", state.snoozeCount);
    } else if (event === "impressed") {
      update = update.eq("impressions", state.impressions);
    }

    const { data, error } = await update.select("campaign_id");
    assertNoDbError(error, "Pop-up do aluno");

    if (event === "snoozed" && (data ?? []).length !== 1) {
      throw new CommunicationError(SNOOZE_REFUSED, 409);
    }

    return { changed: (data ?? []).length === 1 };
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      throw new CommunicationError(POPUP_NOT_FOUND, 404);
    }

    throw error;
  }
}
