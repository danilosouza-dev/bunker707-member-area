import "server-only";

// Sino do aluno (docs/22 §2): lista dos ultimos 90 dias, contadores (nao vistas = numero do sino; nao
// lidas = bolinha), marcar como vista/lida, clique e resposta "Aceitar / Recusar". Sempre do proprio
// aluno (userId vem da sessao conferida na rota). O que nao deve aparecer some na leitura: aviso
// excluido ou ainda nao enviado (o teste da equipe aparece), resposta ou comentario que deixou de estar
// visivel na aula. Banco sem a migracao 202610200001: tudo vazio, nunca erro 500.

import { isHttpsOrLoopbackUrl } from "@/lib/loopback-url";
import { isSafeHeroCtaHref } from "@/server/member-area/home-hero-links";
import { sanitizeProfileAvatarUrl } from "@/server/member-area/student-pages-model";
import { INBOX_HISTORY_DAYS } from "./campaign-model";
import { assertNoDbError, chunksOf, communicationsDb, CommunicationError, isMissingCommunicationSchema, type CommunicationsDb } from "./db";
import {
  commentNotificationTitle,
  decodeCursor,
  encodeCursor,
  normalizePeaks,
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationItem,
  type NotificationKind,
  type NotificationResponseValue,
  type NotificationsFilter,
  type NotificationsPage
} from "./notification-model";

const DAY_MS = 86_400_000;
/** Teto das contagens (o sino mostra "9+"; a pilula "Não lidas" mostra ate este numero). */
const UNSEEN_COUNT_CAP = 100;
const UNREAD_COUNT_CAP = 500;
/** Rodadas de leitura para completar uma pagina quando ha linhas escondidas no meio. */
const MAX_PAGE_ROUNDS = 5;

export const NOTIFICATION_NOT_FOUND = "Notificacao nao encontrada.";
export const ALREADY_RESPONDED = "Você já respondeu.";

const NOTIFICATION_COLUMNS = "id,user_id,kind,campaign_id,is_test,actor_id,title,body,href,payload,seen_at,read_at,clicked_at,response,responded_at,created_at";
const CAMPAIGN_EMBED =
  "campaign:campaigns(id,status,deleted_at,title,body,image_url,image_alt,audio_url,audio_mime,audio_duration_seconds,audio_peaks,cta_label,cta_href,cta_target,response_mode,accept_label,decline_label)";
const VISIBILITY_COLUMNS = "id,kind,is_test,payload,campaign:campaigns(status,deleted_at)";

type EmbeddedCampaign = {
  accept_label: string | null;
  audio_duration_seconds: number | null;
  audio_mime: string | null;
  audio_peaks: unknown;
  audio_url: string | null;
  body: string;
  cta_href: string | null;
  cta_label: string | null;
  cta_target: "new_tab" | "same_tab" | null;
  decline_label: string | null;
  deleted_at: string | null;
  id: string;
  image_alt: string | null;
  image_url: string | null;
  response_mode: "accept_decline" | "none";
  status: string;
  title: string;
};

type NotificationRow = {
  actor_id: string | null;
  body: string | null;
  campaign: EmbeddedCampaign | EmbeddedCampaign[] | null;
  campaign_id: string | null;
  clicked_at: string | null;
  created_at: string;
  href: string | null;
  id: string;
  is_test: boolean;
  kind: NotificationKind;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  response: NotificationResponseValue | null;
  responded_at: string | null;
  seen_at: string | null;
  title: string | null;
  user_id: string;
};

type VisibilityRow = Pick<NotificationRow, "id" | "is_test" | "kind" | "payload"> & {
  campaign: Pick<EmbeddedCampaign, "deleted_at" | "status"> | Pick<EmbeddedCampaign, "deleted_at" | "status">[] | null;
};

type CommentInfo = { author_avatar_url: string | null; author_name: string; deleted_at: string | null; id: string; status: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sinceIso(now: number) {
  return new Date(now - INBOX_HISTORY_DAYS * DAY_MS).toISOString();
}

function single<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function payloadId(payload: Record<string, unknown> | null, key: "commentId" | "parentCommentId") {
  const value = payload?.[key];

  return typeof value === "string" && UUID.test(value) ? value : null;
}

function payloadText(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Respostas e comentarios citados pelas notificacoes automaticas (visiveis = aprovados e nao apagados). */
async function loadComments(db: CommunicationsDb, rows: readonly Pick<NotificationRow, "kind" | "payload">[]) {
  const ids = new Set<string>();

  for (const row of rows) {
    if (row.kind !== "notice") {
      for (const key of ["commentId", "parentCommentId"] as const) {
        const id = payloadId(row.payload, key);

        if (id) {
          ids.add(id);
        }
      }
    }
  }

  const comments = new Map<string, CommentInfo>();

  for (const part of chunksOf(Array.from(ids), 150)) {
    const { data, error } = await db.from("lesson_comments").select("id,status,deleted_at,author_name,author_avatar_url").in("id", part);
    assertNoDbError(error, "Sino: comentarios");
    ((data ?? []) as CommentInfo[]).forEach((comment) => comments.set(comment.id, comment));
  }

  return comments;
}

function isCommentVisible(comment: CommentInfo | undefined) {
  return Boolean(comment && comment.status === "approved" && !comment.deleted_at);
}

/** A linha deve aparecer no sino? */
function isVisible(row: VisibilityRow | NotificationRow, comments: Map<string, CommentInfo>) {
  if (row.kind === "notice") {
    const campaign = single(row.campaign);

    return Boolean(campaign && !campaign.deleted_at && (row.is_test || campaign.status === "sent"));
  }

  const replyId = payloadId(row.payload, "commentId");
  const parentId = payloadId(row.payload, "parentCommentId");

  return Boolean(replyId && isCommentVisible(comments.get(replyId)) && (!parentId || isCommentVisible(comments.get(parentId))));
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

function toItem(row: NotificationRow, comments: Map<string, CommentInfo>, actors: Map<string, { avatarUrl: string | null; name: string | null }>): NotificationItem {
  const base = {
    createdAt: row.created_at,
    id: row.id,
    kind: row.kind,
    readAt: row.read_at,
    seenAt: row.seen_at
  };

  if (row.kind === "notice") {
    const campaign = single(row.campaign)!;
    const imageUrl = safeMediaUrl(campaign.image_url);
    const audioUrl = safeMediaUrl(campaign.audio_url);

    return {
      ...base,
      actor: null,
      audio:
        audioUrl && campaign.audio_duration_seconds
          ? { durationSeconds: campaign.audio_duration_seconds, mimeType: campaign.audio_mime, peaks: normalizePeaks(campaign.audio_peaks), url: audioUrl }
          : null,
      body: campaign.body ?? "",
      context: null,
      cta:
        campaign.cta_href && campaign.cta_label && campaign.cta_target && isSafeHeroCtaHref(campaign.cta_href)
          ? { href: campaign.cta_href, label: campaign.cta_label, target: campaign.cta_target }
          : null,
      href: null,
      image: imageUrl ? { alt: campaign.image_alt ?? "", url: imageUrl } : null,
      response:
        campaign.response_mode === "accept_decline"
          ? { acceptLabel: campaign.accept_label ?? "Aceitar", declineLabel: campaign.decline_label ?? "Recusar", value: row.response }
          : null,
      title: campaign.title
    };
  }

  const reply = comments.get(payloadId(row.payload, "commentId") ?? "");
  const actor = row.actor_id ? actors.get(row.actor_id) : undefined;
  const name = actor?.name ?? reply?.author_name?.trim() ?? null;
  const avatarUrl = actor ? actor.avatarUrl : sanitizeProfileAvatarUrl(reply?.author_avatar_url);

  return {
    ...base,
    actor: name ? { avatarUrl, name } : null,
    audio: null,
    body: row.body ?? "",
    context: payloadText(row.payload, "lessonTitle"),
    cta: null,
    href: row.href && isSafeHeroCtaHref(row.href) ? row.href : null,
    image: null,
    response: null,
    title: commentNotificationTitle(row.kind, name)
  };
}

async function loadActors(db: CommunicationsDb, ids: readonly string[]) {
  const actors = new Map<string, { avatarUrl: string | null; name: string | null }>();

  for (const part of chunksOf(Array.from(new Set(ids)), 150)) {
    const { data, error } = await db.from("profiles").select("id,full_name,avatar_url").in("id", part);
    assertNoDbError(error, "Sino: quem respondeu");

    for (const profile of (data ?? []) as { avatar_url: string | null; full_name: string | null; id: string }[]) {
      actors.set(profile.id, { avatarUrl: sanitizeProfileAvatarUrl(profile.avatar_url), name: profile.full_name?.trim() || null });
    }
  }

  return actors;
}

async function countVisible(db: CommunicationsDb, userId: string, column: "read_at" | "seen_at", cap: number, now: number) {
  const { data, error } = await db
    .from("notifications")
    .select(VISIBILITY_COLUMNS)
    .eq("user_id", userId)
    .is(column, null)
    .gte("created_at", sinceIso(now))
    .order("created_at", { ascending: false })
    .limit(cap);
  assertNoDbError(error, "Sino: contagem");

  const rows = (data ?? []) as unknown as VisibilityRow[];
  const comments = await loadComments(db, rows);

  return rows.filter((row) => isVisible(row, comments)).length;
}

async function readCounts(db: CommunicationsDb, userId: string, now: number) {
  const [unseen, unread] = await Promise.all([
    countVisible(db, userId, "seen_at", UNSEEN_COUNT_CAP, now),
    countVisible(db, userId, "read_at", UNREAD_COUNT_CAP, now)
  ]);

  return { unread, unseen };
}

/** Pagina do sino (mais novas primeiro), com os contadores. */
export async function listNotifications(input: {
  cursor?: string | null;
  filter?: NotificationsFilter;
  limit?: number;
  now?: number;
  userId: string;
}): Promise<NotificationsPage> {
  const db = communicationsDb();
  const now = input.now ?? Date.now();
  const limit = Math.min(50, Math.max(1, input.limit ?? NOTIFICATIONS_PAGE_SIZE));
  const batchSize = (limit + 1) * 2;
  let after = decodeCursor(input.cursor);
  const visible: { comments: Map<string, CommentInfo>; row: NotificationRow }[] = [];
  let exhausted = false;
  let lastScanned: NotificationRow | null = null;

  try {
    for (let round = 0; round < MAX_PAGE_ROUNDS && visible.length <= limit && !exhausted; round += 1) {
      let query = db
        .from("notifications")
        .select(`${NOTIFICATION_COLUMNS},${CAMPAIGN_EMBED}`)
        .eq("user_id", input.userId)
        .gte("created_at", sinceIso(now));

      if (input.filter === "unread") {
        query = query.is("read_at", null);
      }

      if (after) {
        query = query.or(`created_at.lt."${after.createdAt}",and(created_at.eq."${after.createdAt}",id.lt.${after.id})`);
      }

      const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(batchSize);
      assertNoDbError(error, "Sino: notificacoes");

      const rows = (data ?? []) as unknown as NotificationRow[];
      exhausted = rows.length < batchSize;

      if (rows.length === 0) {
        break;
      }

      lastScanned = rows[rows.length - 1];
      after = decodeCursor(encodeCursor({ createdAt: lastScanned.created_at, id: lastScanned.id }));

      const comments = await loadComments(db, rows);
      visible.push(...rows.filter((row) => isVisible(row, comments)).map((row) => ({ comments, row })));
    }

    const page = visible.slice(0, limit);
    const comments = new Map<string, CommentInfo>();
    visible.forEach((entry) => entry.comments.forEach((comment, id) => comments.set(id, comment)));

    const actors = await loadActors(
      db,
      page.map((entry) => entry.row.actor_id).filter((id): id is string => Boolean(id))
    );
    let nextCursor: string | null = null;

    if (visible.length > limit) {
      const last = page[page.length - 1].row;
      nextCursor = encodeCursor({ createdAt: last.created_at, id: last.id });
    } else if (!exhausted && lastScanned) {
      // Muitas linhas escondidas seguidas: a proxima pagina continua depois da ultima lida.
      nextCursor = encodeCursor({ createdAt: lastScanned.created_at, id: lastScanned.id });
    }

    const counts = await readCounts(db, input.userId, now);

    return { items: page.map((entry) => toItem(entry.row, comments, actors)), nextCursor, ...counts };
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      return { items: [], nextCursor: null, unread: 0, unseen: 0 };
    }

    throw error;
  }
}

/** Numero do sino (nao vistas nos ultimos 90 dias). */
export async function countUnseen(userId: string, now = Date.now()) {
  try {
    return await countVisible(communicationsDb(), userId, "seen_at", UNSEEN_COUNT_CAP, now);
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      return 0;
    }

    throw error;
  }
}

/** Nao lidas nos ultimos 90 dias. */
export async function countUnread(userId: string, now = Date.now()) {
  try {
    return await countVisible(communicationsDb(), userId, "read_at", UNREAD_COUNT_CAP, now);
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      return 0;
    }

    throw error;
  }
}

export async function readNotificationCounts(userId: string, now = Date.now()) {
  try {
    return await readCounts(communicationsDb(), userId, now);
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      return { unread: 0, unseen: 0 };
    }

    throw error;
  }
}

/** Abriu o sino: tudo que estava na lista conta como visto (o numero zera; as bolinhas ficam). */
export async function markAllSeen(userId: string, now = new Date()) {
  try {
    const { error } = await communicationsDb()
      .from("notifications")
      .update({ seen_at: now.toISOString() })
      .eq("user_id", userId)
      .is("seen_at", null);
    assertNoDbError(error, "Sino: marcar como vistas");
  } catch (error) {
    if (!isMissingCommunicationSchema(error)) {
      throw error;
    }
  }
}

/** Marca como lidas as notificacoes pedidas (ou todas). Lida tambem conta como vista. */
export async function markRead(userId: string, ids: readonly string[] | "all", now = new Date()) {
  const db = communicationsDb();
  const nowIso = now.toISOString();

  try {
    let seen = db.from("notifications").update({ seen_at: nowIso }).eq("user_id", userId).is("seen_at", null);
    let read = db.from("notifications").update({ read_at: nowIso }).eq("user_id", userId).is("read_at", null);

    if (ids !== "all") {
      seen = seen.in("id", [...ids]);
      read = read.in("id", [...ids]);
    }

    // Nesta ordem: o banco exige "lida" so depois de "vista".
    assertNoDbError((await seen).error, "Sino: marcar como vistas");
    assertNoDbError((await read).error, "Sino: marcar como lidas");
  } catch (error) {
    if (!isMissingCommunicationSchema(error)) {
      throw error;
    }
  }
}

type OwnRow = Pick<NotificationRow, "campaign_id" | "clicked_at" | "id" | "is_test" | "kind" | "payload" | "read_at" | "response" | "seen_at"> & {
  campaign: Pick<EmbeddedCampaign, "deleted_at" | "response_mode" | "status"> | Pick<EmbeddedCampaign, "deleted_at" | "response_mode" | "status">[] | null;
};

/** A notificacao do proprio aluno, visivel no sino; senao 404 (sem dizer se existe para outra pessoa). */
async function fetchOwnVisible(db: CommunicationsDb, userId: string, id: string): Promise<OwnRow> {
  if (!UUID.test(id)) {
    throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
  }

  try {
    const { data, error } = await db
      .from("notifications")
      .select("id,kind,campaign_id,is_test,payload,seen_at,read_at,clicked_at,response,campaign:campaigns(status,deleted_at,response_mode)")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    assertNoDbError(error, "Sino: notificacao");

    const row = (data ?? null) as unknown as OwnRow | null;

    if (!row || !isVisible(row as unknown as VisibilityRow, await loadComments(db, [row]))) {
      throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
    }

    return row;
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
    }

    throw error;
  }
}

/** Seguiu o link da notificacao (ou o botao do aviso): conta como vista, lida e clicada. */
export async function markClicked(userId: string, id: string, now = new Date()) {
  const db = communicationsDb();
  const row = await fetchOwnVisible(db, userId, id);
  const nowIso = now.toISOString();
  const { error } = await db
    .from("notifications")
    .update({ clicked_at: row.clicked_at ?? nowIso, read_at: row.read_at ?? nowIso, seen_at: row.seen_at ?? nowIso })
    .eq("id", row.id)
    .eq("user_id", userId);
  assertNoDbError(error, "Sino: clique");

  return { campaignId: row.campaign_id, kind: row.kind };
}

/** "Aceitar" ou "Recusar" num aviso que pede resposta. A primeira resposta vale; a segunda e 409. */
export async function respondToNotification(userId: string, id: string, response: NotificationResponseValue, now = new Date()) {
  const db = communicationsDb();
  const row = await fetchOwnVisible(db, userId, id);
  const campaign = single(row.campaign);

  if (row.kind !== "notice" || campaign?.response_mode !== "accept_decline") {
    throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
  }

  if (row.response) {
    throw new CommunicationError(ALREADY_RESPONDED, 409);
  }

  const nowIso = now.toISOString();
  const { data, error } = await db
    .from("notifications")
    .update({ read_at: row.read_at ?? nowIso, responded_at: nowIso, response, seen_at: row.seen_at ?? nowIso })
    .eq("id", row.id)
    .eq("user_id", userId)
    .is("response", null)
    .select("id");
  assertNoDbError(error, "Sino: resposta");

  if ((data ?? []).length !== 1) {
    throw new CommunicationError(ALREADY_RESPONDED, 409);
  }

  return { campaignId: row.campaign_id, response };
}
