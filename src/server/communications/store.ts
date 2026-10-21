import "server-only";

// Leituras e escritas dos avisos (tabela campaigns), do sino (notifications) e do estado do pop-up por
// aluno (campaign_deliveries). Colunas explicitas, uma linha por vez nas edicoes da equipe (docs/13) e
// lotes de 500 no envio para os alunos. Concorrencia: toda edicao confere a versao lida pela tela
// (updated_at) e a situacao esperada; o job reserva cada aviso com update condicional, entao dois ticks
// nunca enviam o mesmo aviso ao mesmo tempo (e o envio e idempotente pelo dedupe_key).

import { normalizeAudience, type AudienceDefinition } from "./audience-model";
import { popupRefreshDueBefore, type CampaignKind, type CampaignStatus, type PopupRepeat } from "./campaign-model";
import { assertNoDbError, chunksOf, CommunicationError, type CommunicationsDb } from "./db";
import { noticeIconOfColumns, testSendExpiresAt, validityOfRow, validityToColumns } from "./message-meta";
import { normalizePeaks } from "./notification-model";
import type { NoticeDraft } from "./schemas";

/* ------------------------------------------------------------------------------------------------
 * Linhas
 * ---------------------------------------------------------------------------------------------- */

/** PostgREST: `.range()` depois da ultima linha (HTTP 416). */
const RANGE_NOT_SATISFIABLE = "PGRST103";

// v2 (migracao 202610200002): quem envia, icone, validade no sino e o passo do fluxo.
export const CAMPAIGN_COLUMNS =
  "id,kind,status,title,body,image_url,image_alt,audio_url,audio_mime,audio_duration_seconds,audio_peaks,cta_label,cta_href,cta_target,response_mode,accept_label,decline_label,audience,audience_count,audience_counted_at,send_at,starts_at,ends_at,popup_repeat,allow_snooze,dispatch_started_at,dispatch_attempts,last_error,sent_at,recipients_count,audience_refreshed_at,requested_by,requested_at,approved_by,approved_at,created_by,updated_by,created_at,updated_at,deleted_at,deleted_by,sender_user_id,icon,icon_color,validity_minutes,valid_until,flow_id,flow_node_id";

export type CampaignRow = {
  accept_label: string | null;
  allow_snooze: boolean;
  approved_at: string | null;
  approved_by: string | null;
  audience: unknown;
  audience_count: number | null;
  audience_counted_at: string | null;
  audience_refreshed_at: string | null;
  audio_duration_seconds: number | null;
  audio_mime: string | null;
  audio_peaks: unknown;
  audio_url: string | null;
  body: string;
  created_at: string;
  created_by: string | null;
  cta_href: string | null;
  cta_label: string | null;
  cta_target: "new_tab" | "same_tab" | null;
  decline_label: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  dispatch_attempts: number;
  dispatch_started_at: string | null;
  ends_at: string | null;
  /** Conteudo de um passo de fluxo (fora da lista de avisos); null = aviso comum. */
  flow_id: string | null;
  flow_node_id: string | null;
  /** Icone ao lado do titulo (ids do catalogo de message-meta.ts); os dois nulos = sem icone. */
  icon: string | null;
  icon_color: string | null;
  id: string;
  image_alt: string | null;
  image_url: string | null;
  kind: CampaignKind;
  last_error: string | null;
  popup_repeat: PopupRepeat;
  recipients_count: number | null;
  requested_at: string | null;
  requested_by: string | null;
  response_mode: "accept_decline" | "none";
  send_at: string | null;
  /** Quem envia (pessoa da equipe); null = a escola. */
  sender_user_id: string | null;
  sent_at: string | null;
  starts_at: string | null;
  status: CampaignStatus;
  title: string;
  updated_at: string;
  updated_by: string | null;
  /** Quanto tempo fica no sino: ate a data ou minutos depois de chegar (os dois nulos = 90 dias). */
  valid_until: string | null;
  validity_minutes: number | null;
};

/** Colunas que a equipe escreve (conteudo, segmento e agenda), a partir do rascunho do editor. */
export type CampaignContentColumns = Pick<
  CampaignRow,
  | "accept_label"
  | "allow_snooze"
  | "audio_duration_seconds"
  | "audio_mime"
  | "audio_url"
  | "body"
  | "cta_href"
  | "cta_label"
  | "cta_target"
  | "decline_label"
  | "ends_at"
  | "icon"
  | "icon_color"
  | "image_alt"
  | "image_url"
  | "kind"
  | "popup_repeat"
  | "response_mode"
  | "send_at"
  | "sender_user_id"
  | "starts_at"
  | "title"
  | "valid_until"
  | "validity_minutes"
> & { audience: AudienceDefinition; audio_peaks: number[] | null };

export type CampaignPatch = Partial<Omit<CampaignRow, "audience" | "audio_peaks" | "created_at" | "id" | "updated_at">> & {
  audience?: AudienceDefinition;
  audio_peaks?: number[] | null;
};

/* ------------------------------------------------------------------------------------------------
 * Rascunho <-> colunas
 * ---------------------------------------------------------------------------------------------- */

/** Segmento gravado (jsonb) lido sem confiar no conteudo. */
export function audienceOfRow(row: Pick<CampaignRow, "audience">): AudienceDefinition {
  const value = row.audience as AudienceDefinition | null;

  if (value && typeof value === "object" && (value.kind === "everyone" || (value.kind === "rules" && value.root && Array.isArray(value.root.items)))) {
    return value;
  }

  // Segmento ilegivel nunca vira "todos os alunos": vira um grupo "qualquer regra" vazio (ninguem).
  return { kind: "rules", root: { items: [], match: "any" } };
}

function peaksOf(value: unknown): number[] {
  return Array.isArray(value) ? value.filter((peak): peak is number => typeof peak === "number").map((peak) => Math.min(100, Math.max(0, Math.round(peak)))) : [];
}

export function draftToColumns(draft: NoticeDraft): CampaignContentColumns {
  const isInbox = draft.kind === "inbox";
  // Quem envia e o tempo no sino sao da notificacao (check campaigns_inbox_only_v2); o pop-up so tem o icone.
  const validity = isInbox ? validityToColumns(draft.validity) : { valid_until: null, validity_minutes: null };

  return {
    accept_label: isInbox && draft.response ? draft.response.acceptLabel : null,
    allow_snooze: isInbox ? true : draft.allowSnooze,
    audience: normalizeAudience(draft.audience),
    audio_duration_seconds: draft.audio ? draft.audio.durationSeconds : null,
    audio_mime: draft.audio ? draft.audio.mimeType : null,
    audio_peaks: draft.audio ? peaksOf(draft.audio.peaks) : null,
    audio_url: draft.audio ? draft.audio.url : null,
    body: draft.body,
    cta_href: draft.cta ? draft.cta.href : null,
    cta_label: draft.cta ? draft.cta.label : null,
    cta_target: draft.cta ? draft.cta.target : null,
    decline_label: isInbox && draft.response ? draft.response.declineLabel : null,
    ends_at: isInbox ? null : draft.window.endsAt,
    icon: draft.icon ? draft.icon.id : null,
    icon_color: draft.icon ? draft.icon.color : null,
    image_alt: draft.image ? draft.image.alt || null : null,
    image_url: draft.image ? draft.image.url : null,
    kind: draft.kind,
    popup_repeat: isInbox ? "once" : draft.repeat,
    response_mode: isInbox && draft.response ? "accept_decline" : "none",
    send_at: isInbox && draft.schedule.mode === "at" ? draft.schedule.sendAt : null,
    sender_user_id: isInbox && draft.sender ? draft.sender.userId : null,
    starts_at: isInbox ? null : draft.window.startsAt,
    title: draft.title,
    valid_until: validity.valid_until,
    validity_minutes: validity.validity_minutes
  };
}

export function rowToDraft(row: CampaignRow): NoticeDraft {
  return {
    allowSnooze: row.allow_snooze,
    audience: audienceOfRow(row),
    audio:
      row.audio_url && row.audio_duration_seconds
        ? {
            durationSeconds: row.audio_duration_seconds,
            mimeType: row.audio_mime,
            peaks: Array.isArray(row.audio_peaks) && row.audio_peaks.length > 0 ? peaksOf(row.audio_peaks) : normalizePeaks(null),
            url: row.audio_url
          }
        : null,
    body: row.body,
    cta: row.cta_href && row.cta_label && row.cta_target ? { href: row.cta_href, label: row.cta_label, target: row.cta_target } : null,
    icon: noticeIconOfColumns(row.icon, row.icon_color),
    image: row.image_url ? { alt: row.image_alt ?? "", url: row.image_url } : null,
    kind: row.kind,
    repeat: row.popup_repeat,
    response:
      row.kind === "inbox" && row.response_mode === "accept_decline"
        ? { acceptLabel: row.accept_label ?? "Aceitar", declineLabel: row.decline_label ?? "Recusar" }
        : null,
    schedule: row.kind === "inbox" && row.send_at ? { mode: "at", sendAt: row.send_at } : { mode: "now" },
    sender: row.kind === "inbox" && row.sender_user_id ? { userId: row.sender_user_id } : null,
    title: row.title,
    validity: row.kind === "inbox" ? validityOfRow(row) : { mode: "default" },
    window: { endsAt: row.kind === "popup" ? row.ends_at : null, startsAt: row.kind === "popup" ? row.starts_at : null }
  };
}

/* ------------------------------------------------------------------------------------------------
 * Avisos
 * ---------------------------------------------------------------------------------------------- */

export const NOTICE_CHANGED_MESSAGE = "Este aviso mudou em outra tela há instantes. Recarregue a página para ver a versão atual.";
export const NOTICE_MISSING_MESSAGE = "Este aviso não existe mais.";

export async function fetchCampaign(db: CommunicationsDb, id: string): Promise<CampaignRow | null> {
  const { data, error } = await db.from("campaigns").select(CAMPAIGN_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  assertNoDbError(error, "Comunicacao: aviso");

  return (data ?? null) as CampaignRow | null;
}

export async function fetchCampaignsByIds(db: CommunicationsDb, ids: readonly string[]): Promise<CampaignRow[]> {
  const unique = Array.from(new Set(ids));

  if (unique.length === 0) {
    return [];
  }

  const rows: CampaignRow[] = [];

  for (const part of chunksOf(unique, 150)) {
    const { data, error } = await db.from("campaigns").select(CAMPAIGN_COLUMNS).in("id", part);
    assertNoDbError(error, "Comunicacao: avisos");
    rows.push(...((data ?? []) as CampaignRow[]));
  }

  return rows;
}

/**
 * Lista da equipe: mais novos primeiro, sem os excluidos e sem o conteudo dos passos de fluxo (esse fica
 * no fluxo). Pagina depois do fim: o PostgREST responde 416 (PGRST103) em vez de lista vazia; aqui vira
 * pagina vazia (o total pode nao vir, e a tela volta para uma pagina que existe).
 */
export async function listCampaignRows(
  db: CommunicationsDb,
  input: { kind?: CampaignKind; page: number; pageSize: number }
): Promise<{ rows: CampaignRow[]; total: number }> {
  const from = (Math.max(1, input.page) - 1) * input.pageSize;
  let query = db.from("campaigns").select(CAMPAIGN_COLUMNS, { count: "exact" }).is("deleted_at", null).is("flow_id", null);

  if (input.kind) {
    query = query.eq("kind", input.kind);
  }

  const { count, data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + input.pageSize - 1);

  if (error?.code === RANGE_NOT_SATISFIABLE) {
    return { rows: [], total: count ?? 0 };
  }

  assertNoDbError(error, "Comunicacao: lista de avisos");

  return { rows: (data ?? []) as CampaignRow[], total: count ?? 0 };
}

export async function insertCampaign(
  db: CommunicationsDb,
  row: CampaignContentColumns & { created_by: string; status: CampaignStatus; updated_by: string }
): Promise<CampaignRow> {
  const { data, error } = await db.from("campaigns").insert(row).select(CAMPAIGN_COLUMNS).single();
  assertNoDbError(error, "Comunicacao: criar aviso");

  return data as CampaignRow;
}

/**
 * Atualiza UMA linha se ninguem mudou desde `expectedUpdatedAt` e se a situacao ainda e uma das
 * `expectedStatuses`. Nada atualizado: 404 se o aviso sumiu, 409 se mudou em outra tela.
 */
export async function updateCampaign(
  db: CommunicationsDb,
  id: string,
  patch: CampaignPatch,
  guard: { expectedStatuses?: readonly CampaignStatus[]; expectedUpdatedAt?: string | null } = {}
): Promise<CampaignRow> {
  let query = db.from("campaigns").update(patch).eq("id", id).is("deleted_at", null);

  if (guard.expectedUpdatedAt) {
    query = query.eq("updated_at", guard.expectedUpdatedAt);
  }

  if (guard.expectedStatuses?.length) {
    query = query.in("status", [...guard.expectedStatuses]);
  }

  const { data, error } = await query.select(CAMPAIGN_COLUMNS);
  assertNoDbError(error, "Comunicacao: gravar aviso");

  const rows = (data ?? []) as CampaignRow[];

  if (rows.length === 1) {
    return rows[0];
  }

  const current = await fetchCampaign(db, id);

  throw new CommunicationError(current ? NOTICE_CHANGED_MESSAGE : NOTICE_MISSING_MESSAGE, current ? 409 : 404);
}

/** Exclusao da equipe: some da lista e do aluno (o historico e os numeros ficam no banco). */
export async function softDeleteCampaign(
  db: CommunicationsDb,
  id: string,
  input: { actorId: string; expectedStatuses: readonly CampaignStatus[]; expectedUpdatedAt?: string | null; now: Date }
) {
  return updateCampaign(
    db,
    id,
    { deleted_at: input.now.toISOString(), deleted_by: input.actorId, updated_by: input.actorId },
    { expectedStatuses: input.expectedStatuses, expectedUpdatedAt: input.expectedUpdatedAt }
  );
}

/** Um tick nunca passa de 60 s: reserva em `sending` mais velha que isto foi de um tick que caiu. */
export const STALE_DISPATCH_MS = 2 * 60 * 1000;

/**
 * Reserva ate `limit` notificacoes vencidas para enviar: agendadas com send_at <= agora (scheduled ->
 * sending) e envios parados (sending com reserva vencida ou liberada). Cada reserva e um update
 * condicional sobre o valor lido, entao dois ticks ao mesmo tempo nunca pegam o mesmo aviso.
 */
export async function claimDueInbox(db: CommunicationsDb, now: Date, limit: number): Promise<CampaignRow[]> {
  const nowIso = now.toISOString();
  const staleIso = new Date(now.getTime() - STALE_DISPATCH_MS).toISOString();
  const [due, stalled] = await Promise.all([
    db
      .from("campaigns")
      .select("id,status,dispatch_started_at")
      .eq("kind", "inbox")
      .eq("status", "scheduled")
      .is("deleted_at", null)
      .lte("send_at", nowIso)
      .order("send_at", { ascending: true })
      .limit(limit),
    db
      .from("campaigns")
      .select("id,status,dispatch_started_at")
      .eq("kind", "inbox")
      .eq("status", "sending")
      .is("deleted_at", null)
      .or(`dispatch_started_at.is.null,dispatch_started_at.lt."${staleIso}"`)
      .order("send_at", { ascending: true })
      .limit(limit)
  ]);
  assertNoDbError(due.error, "Comunicacao: notificacoes agendadas");
  assertNoDbError(stalled.error, "Comunicacao: envios parados");

  type Candidate = Pick<CampaignRow, "dispatch_started_at" | "id" | "status">;
  const candidates = [...((stalled.data ?? []) as Candidate[]), ...((due.data ?? []) as Candidate[])].slice(0, limit);
  const claimed: CampaignRow[] = [];

  for (const candidate of candidates) {
    let query = db
      .from("campaigns")
      .update(candidate.status === "scheduled" ? { dispatch_started_at: nowIso, status: "sending" } : { dispatch_started_at: nowIso })
      .eq("id", candidate.id)
      .eq("status", candidate.status)
      .is("deleted_at", null);

    query = candidate.dispatch_started_at ? query.eq("dispatch_started_at", candidate.dispatch_started_at) : query.is("dispatch_started_at", null);

    const { data, error } = await query.select(CAMPAIGN_COLUMNS);
    assertNoDbError(error, "Comunicacao: reservar envio");
    claimed.push(...((data ?? []) as CampaignRow[]));
  }

  return claimed;
}

/**
 * Pop-ups no ar (ou com janela futura) cujo segmento nao foi recalculado desde o comeco da faixa atual
 * de `staleMs` (relogio alinhado: os vencidos caem juntos e dividem a leitura dos alunos do tick).
 */
export async function fetchPopupsToRefresh(db: CommunicationsDb, now: Date, staleMs: number, limit: number): Promise<CampaignRow[]> {
  const nowIso = now.toISOString();
  const staleIso = new Date(popupRefreshDueBefore(now.getTime(), staleMs)).toISOString();
  const { data, error } = await db
    .from("campaigns")
    .select(CAMPAIGN_COLUMNS)
    .eq("kind", "popup")
    .eq("status", "active")
    .is("deleted_at", null)
    .or(`ends_at.is.null,ends_at.gt."${nowIso}"`)
    .or(`audience_refreshed_at.is.null,audience_refreshed_at.lt."${staleIso}"`)
    .order("audience_refreshed_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  assertNoDbError(error, "Comunicacao: pop-ups para atualizar");

  return (data ?? []) as CampaignRow[];
}

/* ------------------------------------------------------------------------------------------------
 * Sino (notifications)
 * ---------------------------------------------------------------------------------------------- */

export type NotificationInsert = {
  actor_id?: string | null;
  body?: string | null;
  campaign_id?: string | null;
  dedupe_key: string;
  /** Fim no sino (computeExpiresAt); sem valor, o gatilho do banco poe created_at + 90 dias. */
  expires_at?: string | null;
  href?: string | null;
  is_test?: boolean;
  kind: "comment_mention" | "comment_reply" | "notice";
  payload?: Record<string, unknown>;
  title?: string | null;
  user_id: string;
};

export const NOTIFICATION_INSERT_CHUNK = 500;

/** Insere em lotes de 500; a mesma (aluno, dedupe_key) nunca entra duas vezes (repetir e seguro). */
export async function insertNotificationRows(db: CommunicationsDb, rows: readonly NotificationInsert[], signal?: AbortSignal) {
  let written = 0;

  for (const part of chunksOf(rows, NOTIFICATION_INSERT_CHUNK)) {
    if (signal?.aborted) {
      break;
    }

    const { error } = await db.from("notifications").upsert(part, { ignoreDuplicates: true, onConflict: "user_id,dedupe_key" });
    assertNoDbError(error, "Comunicacao: gravar notificacoes");
    written += part.length;
  }

  return written;
}

const ID_PAGE = 1_000;

/** Quem ja recebeu a notificacao do aviso (para o envio retomado nao reler o que ja gravou). */
export async function fetchCampaignRecipientIds(db: CommunicationsDb, campaignId: string): Promise<Set<string>> {
  const ids = new Set<string>();

  for (let from = 0; ; from += ID_PAGE) {
    const { data, error } = await db
      .from("notifications")
      .select("user_id")
      .eq("campaign_id", campaignId)
      .eq("is_test", false)
      .order("user_id")
      .range(from, from + ID_PAGE - 1);
    assertNoDbError(error, "Comunicacao: quem ja recebeu");

    const rows = (data ?? []) as { user_id: string }[];
    rows.forEach((row) => ids.add(row.user_id));

    if (rows.length < ID_PAGE) {
      return ids;
    }
  }
}

export async function countCampaignRecipients(db: CommunicationsDb, campaignId: string) {
  const { count, error } = await db
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", campaignId)
    .eq("is_test", false);
  assertNoDbError(error, "Comunicacao: contar quem recebeu");

  return count ?? 0;
}

/** Retirar uma notificacao enviada: apaga as linhas dos alunos (o teste da equipe fica). */
export async function deleteCampaignNotifications(db: CommunicationsDb, campaignId: string) {
  const { count, error } = await db
    .from("notifications")
    .delete({ count: "exact" })
    .eq("campaign_id", campaignId)
    .eq("is_test", false);
  assertNoDbError(error, "Comunicacao: retirar notificacoes");

  return count ?? 0;
}

/**
 * "Enviar teste para mim" (o aviso, uma notificacao seguinte ou um passo do fluxo): a versao vai para o
 * sino de quem pediu, marcada como teste (fora dos numeros), e fica pelo menos 1 hora (o rascunho com
 * "ate uma data" que ja passou tambem aparece). Repetir traz de volta como nova: chega agora, com o fim
 * recalculado e o audio sem nada ouvido.
 */
export async function upsertTestNotification(
  db: CommunicationsDb,
  campaign: Pick<CampaignRow, "id" | "valid_until" | "validity_minutes">,
  userId: string,
  now: number
) {
  const dedupeKey = `campaign-test:${campaign.id}`;
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(testSendExpiresAt({ validUntil: campaign.valid_until, validityMinutes: campaign.validity_minutes }, now)).toISOString();
  const existing = await db.from("notifications").select("id").eq("user_id", userId).eq("dedupe_key", dedupeKey).maybeSingle();
  assertNoDbError(existing.error, "Comunicacao: teste");

  const result = existing.data
    ? await db
        .from("notifications")
        .update({
          audio_completed_at: null,
          audio_heard: null,
          audio_heard_percent: null,
          audio_started_at: null,
          clicked_at: null,
          created_at: nowIso,
          expires_at: expiresAt,
          opened_at: null,
          read_at: null,
          responded_at: null,
          response: null,
          seen_at: null
        })
        .eq("id", (existing.data as { id: string }).id)
    : await db
        .from("notifications")
        .insert({ campaign_id: campaign.id, created_at: nowIso, dedupe_key: dedupeKey, expires_at: expiresAt, is_test: true, kind: "notice", user_id: userId });
  assertNoDbError(result.error, "Comunicacao: teste");
}

/* ------------------------------------------------------------------------------------------------
 * Pop-up por aluno (campaign_deliveries)
 * ---------------------------------------------------------------------------------------------- */

export async function fetchDeliveryEligibility(db: CommunicationsDb, campaignId: string): Promise<Map<string, boolean>> {
  const result = new Map<string, boolean>();

  for (let from = 0; ; from += ID_PAGE) {
    const { data, error } = await db
      .from("campaign_deliveries")
      .select("user_id,eligible")
      .eq("campaign_id", campaignId)
      .order("user_id")
      .range(from, from + ID_PAGE - 1);
    assertNoDbError(error, "Comunicacao: alunos do pop-up");

    const rows = (data ?? []) as { eligible: boolean; user_id: string }[];
    rows.forEach((row) => result.set(row.user_id, row.eligible));

    if (rows.length < ID_PAGE) {
      return result;
    }
  }
}

/** Alunos que passam a ver o pop-up: cria a linha ou volta a deixar elegivel (impressoes ficam). */
export async function upsertDeliveries(db: CommunicationsDb, campaignId: string, userIds: readonly string[]) {
  for (const part of chunksOf(userIds, NOTIFICATION_INSERT_CHUNK)) {
    const { error } = await db
      .from("campaign_deliveries")
      .upsert(
        part.map((userId) => ({ campaign_id: campaignId, eligible: true, user_id: userId })),
        { onConflict: "campaign_id,user_id" }
      );
    assertNoDbError(error, "Comunicacao: alunos do pop-up");
  }
}

export async function setDeliveryEligibility(db: CommunicationsDb, campaignId: string, userIds: readonly string[], eligible: boolean) {
  for (const part of chunksOf(userIds, 150)) {
    const { error } = await db.from("campaign_deliveries").update({ eligible }).eq("campaign_id", campaignId).in("user_id", part);
    assertNoDbError(error, "Comunicacao: alunos do pop-up");
  }
}

/* ------------------------------------------------------------------------------------------------
 * Numeros (RPCs da migracao 202610200001)
 * ---------------------------------------------------------------------------------------------- */

export type CampaignStats = {
  accepted: number;
  clicked: number;
  closedWithoutClick: number;
  declined: number;
  dismissed: number;
  recipients: number;
  seen: number;
  snoozed: number;
  studied7d: number;
};

export const EMPTY_CAMPAIGN_STATS: CampaignStats = {
  accepted: 0,
  clicked: 0,
  closedWithoutClick: 0,
  declined: 0,
  dismissed: 0,
  recipients: 0,
  seen: 0,
  snoozed: 0,
  studied7d: 0
};

const toNumber = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0)) || 0;

export async function fetchCampaignStats(db: CommunicationsDb, ids: readonly string[]): Promise<Map<string, CampaignStats>> {
  const stats = new Map<string, CampaignStats>();

  if (ids.length === 0) {
    return stats;
  }

  const { data, error } = await db.rpc("communication_campaign_stats", { p_campaign_ids: [...ids] });
  assertNoDbError(error, "Comunicacao: numeros dos avisos");

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    stats.set(String(row.campaign_id), {
      accepted: toNumber(row.accepted),
      clicked: toNumber(row.clicked),
      closedWithoutClick: toNumber(row.closed_without_click),
      declined: toNumber(row.declined),
      dismissed: toNumber(row.dismissed),
      recipients: toNumber(row.recipients),
      seen: toNumber(row.seen),
      snoozed: toNumber(row.snoozed),
      studied7d: toNumber(row.studied_7d)
    });
  }

  return stats;
}

/** Abriram, comecaram o audio e ouviram ate o fim (v2): so as linhas dos alunos, nunca o teste da equipe. */
export type CampaignEngagement = { audioCompleted: number; audioStarted: number; opened: number };

export const EMPTY_CAMPAIGN_ENGAGEMENT: CampaignEngagement = { audioCompleted: 0, audioStarted: 0, opened: 0 };

/** RPC communication_campaign_engagement (migracao 202610200002); communication_campaign_stats fica igual. */
export async function fetchCampaignEngagement(db: CommunicationsDb, ids: readonly string[]): Promise<Map<string, CampaignEngagement>> {
  const engagement = new Map<string, CampaignEngagement>();

  if (ids.length === 0) {
    return engagement;
  }

  const { data, error } = await db.rpc("communication_campaign_engagement", { p_campaign_ids: [...ids] });
  assertNoDbError(error, "Comunicacao: aberturas e audio dos avisos");

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    engagement.set(String(row.campaign_id), {
      audioCompleted: toNumber(row.audio_completed),
      audioStarted: toNumber(row.audio_started),
      opened: toNumber(row.opened)
    });
  }

  return engagement;
}

export type CommunicationOverviewRow = { activeNow: number; clicked: number; seen: number; studied7d: number };

export async function fetchOverview(db: CommunicationsDb, start: Date, end: Date): Promise<CommunicationOverviewRow> {
  const { data, error } = await db.rpc("communication_overview", { p_end: end.toISOString(), p_start: start.toISOString() });
  assertNoDbError(error, "Comunicacao: numeros do periodo");

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;

  return {
    activeNow: toNumber(row?.active_now),
    clicked: toNumber(row?.clicked),
    seen: toNumber(row?.seen),
    studied7d: toNumber(row?.studied_7d)
  };
}
