import "server-only";

// Leituras e a escrita atomica dos pop-ups do aluno (Comunicacao v3b-1, docs/25 §4.3 a §4.5). As regras
// (pagina, momento, quantas vezes) moram em popup-display-model.ts; aqui so o banco:
// - a lista curta de pop-ups publicados que ainda nao acabaram (com folga sobre o teto de 50, para duas
//   publicacoes ao mesmo tempo nunca esconderem uma) e a configuracao de cada um;
// - os cursos de cada formacao escolhida numa pagina, com a regra do catalogo (fetchIncludedCourses): so o
//   curso incluido conta, inclusive os que entrarem na formacao depois;
// - a linha do aluno em campaign_deliveries (chave primaria) e a abertura pela RPC
//   communication_record_popup_impression, que so grava se a linha ainda e a que o app leu (updated_at).

import { POPUP_V3B1_RULES, type PopupColumns } from "./popup-display-model";
import { assertNoDbError, type CommunicationsDb } from "./db";

/** Conteudo do pop-up (para o show) e as colunas da configuracao (v3b-1). */
export const LIVE_POPUP_COLUMNS =
  "id,kind,status,title,body,image_url,image_alt,audio_url,audio_mime,audio_duration_seconds,audio_peaks,cta_label,cta_href,cta_target,popup_repeat,allow_snooze,starts_at,ends_at,sent_at,created_at,icon,icon_color," +
  "popup_pages,popup_exclude_pages,popup_trigger,popup_delay_seconds,popup_frequency,popup_every_minutes,popup_max_per_day,popup_max_total,popup_stop_on,popup_close,popup_snooze_minutes";

// v3a: as bases do "mostrar de novo para quem ja viu"; v3b-1: o ultimo zerar, as vezes no dia e o updated_at
// que a RPC da abertura compara (texto exato do PostgREST, com os microssegundos).
export const POPUP_DELIVERY_COLUMNS =
  "campaign_id,eligible,impressions,last_seen_at,clicked_at,dismissed_at,snoozed_until,snooze_count,impressions_before_reshow,snoozes_before_reshow,reshown_at,day_impressions,updated_at";

export type LivePopupRow = Partial<PopupColumns> & {
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
  /** Icone ao lado do titulo (ids do catalogo; fora dele = sem icone). */
  icon?: string | null;
  icon_color?: string | null;
  id: string;
  image_alt: string | null;
  image_url: string | null;
  kind: "popup";
  sent_at: string | null;
  starts_at: string | null;
  status: "active";
  title: string;
};

export type PopupDeliveryRow = {
  campaign_id: string;
  clicked_at: string | null;
  /** v3b-1: vezes no dia de Sao Paulo de last_seen_at. */
  day_impressions?: number | null;
  dismissed_at: string | null;
  eligible: boolean;
  impressions: number;
  impressions_before_reshow?: number | null;
  last_seen_at: string | null;
  reshown_at?: string | null;
  snooze_count: number;
  snoozed_until: string | null;
  snoozes_before_reshow?: number | null;
  /** Texto exato do banco: vai como esta para a RPC da abertura (nunca por new Date()). */
  updated_at: string;
};

/** Pop-ups publicados que ainda nao acabaram (o filtro fino da janela usa a hora de cada pedido). */
export async function loadLivePopupRows(db: CommunicationsDb, nowIso: string): Promise<LivePopupRow[]> {
  const { data, error } = await db
    .from("campaigns")
    .select(LIVE_POPUP_COLUMNS)
    .eq("kind", "popup")
    .eq("status", "active")
    .is("deleted_at", null)
    .or(`ends_at.is.null,ends_at.gt."${nowIso}"`)
    .order("starts_at", { ascending: false, nullsFirst: false })
    .limit(POPUP_V3B1_RULES.liveReadMax);
  assertNoDbError(error, "Pop-ups no ar");

  return (data ?? []) as unknown as LivePopupRow[];
}

/**
 * Cursos de cada formacao (id da formacao -> ids dos cursos), com a regra do catalogo: o curso aponta para a
 * formacao (content_page_settings.settings.parentFormationId) e e conteudo incluido (um curso com o
 * parentFormationId velho, vendido sozinho, nunca conta). No maximo duas consultas; nenhuma sem ids.
 */
export async function fetchFormationCourses(db: CommunicationsDb, ids: readonly string[]): Promise<Map<string, string[]>> {
  const coursesOf = new Map<string, string[]>();

  if (ids.length === 0) {
    return coursesOf;
  }

  const settings = await db
    .from("content_page_settings")
    .select("content_id,parentFormationId:settings->>parentFormationId")
    .in("settings->>parentFormationId", [...ids]);
  assertNoDbError(settings.error, "Cursos das formacoes dos pop-ups");

  const links = ((settings.data ?? []) as unknown as { content_id: string; parentFormationId: string | null }[]).filter(
    (row) => typeof row.parentFormationId === "string" && row.parentFormationId !== row.content_id
  );

  if (links.length === 0) {
    return coursesOf;
  }

  const included = await db
    .from("content_items")
    .select("id")
    .in("id", [...new Set(links.map((row) => row.content_id))])
    .eq("commerce_scope", "included_content");
  assertNoDbError(included.error, "Cursos das formacoes dos pop-ups");

  const includedIds = new Set(((included.data ?? []) as { id: string }[]).map((row) => row.id));

  for (const link of links) {
    if (includedIds.has(link.content_id)) {
      coursesOf.set(link.parentFormationId!, [...(coursesOf.get(link.parentFormationId!) ?? []), link.content_id]);
    }
  }

  return coursesOf;
}

/** A linha do aluno num pop-up (chave primaria), ou null. */
export async function fetchPopupDelivery(db: CommunicationsDb, userId: string, campaignId: string): Promise<PopupDeliveryRow | null> {
  const { data, error } = await db
    .from("campaign_deliveries")
    .select(POPUP_DELIVERY_COLUMNS)
    .eq("campaign_id", campaignId)
    .eq("user_id", userId)
    .maybeSingle();
  assertNoDbError(error, "Pop-up do aluno");

  return (data ?? null) as PopupDeliveryRow | null;
}

/** As linhas do aluno nos pop-ups pedidos (uma consulta pela chave primaria). */
export async function fetchPopupDeliveries(db: CommunicationsDb, userId: string, campaignIds: readonly string[]): Promise<PopupDeliveryRow[]> {
  if (campaignIds.length === 0) {
    return [];
  }

  const { data, error } = await db.from("campaign_deliveries").select(POPUP_DELIVERY_COLUMNS).eq("user_id", userId).in("campaign_id", [...campaignIds]);
  assertNoDbError(error, "Pop-ups do aluno");

  return (data ?? []) as unknown as PopupDeliveryRow[];
}

export type PopupImpressionCounts = { day_impressions: number; impressions: number };

/**
 * Uma abertura (RPC 5.1): grava so se a linha ainda tem o `updated_at` lido (texto exato do PostgREST), esta
 * elegivel, sem "Não mostrar de novo" e com o pop-up no ar. null = recusada (nada gravado).
 */
export async function recordPopupImpression(
  db: CommunicationsDb,
  input: { campaignId: string; dayStart: string; expectedUpdatedAt: string; now: string; userId: string }
): Promise<PopupImpressionCounts | null> {
  const { data, error } = await db.rpc("communication_record_popup_impression", {
    p_campaign_id: input.campaignId,
    p_day_start: input.dayStart,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_now: input.now,
    p_user_id: input.userId
  });
  assertNoDbError(error, "Abertura do pop-up");

  const counts = data as { day_impressions?: unknown; impressions?: unknown } | null;

  if (!counts || typeof counts.impressions !== "number" || typeof counts.day_impressions !== "number") {
    return null;
  }

  return { day_impressions: counts.day_impressions, impressions: counts.impressions };
}
