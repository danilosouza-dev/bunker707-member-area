import "server-only";

// Sino do aluno (docs/22 §1.1 e §4.4; v2 em docs/23; v3a em docs/24): lista dos ultimos 90 dias, contadores
// (nao vistas = numero do sino; nao lidas = bolinha), marcar como vista/lida/aberta, clique, resposta
// "Aceitar / Recusar" (e mudar a resposta), o audio ouvido, a reacao, o voto na enquete e o "Excluir
// notificacao" do proprio sino. Sempre do proprio aluno (userId vem da sessao conferida na rota).
//
// v3a: a regra do que aparece no sino fica num lugar so, no banco (communication_visible_notifications,
// migracao 202610220001): aviso excluido ou ainda nao enviado (o teste da equipe aparece), resposta ou
// comentario que deixou de estar visivel na aula, linha depois do seu expires_at e linha que o aluno
// excluiu somem da lista, dos numeros, do "Marcar todas", do "abriu o sino" e de toda conferencia de uma
// linha (clique, resposta, audio, reacao, voto: 404). A pagina inteira (linhas, quem envia, quem
// respondeu, contagem da enquete e os dois numeros) vem numa ida ao banco (communication_inbox_page).
//
// v2: quem envia e resolvido na leitura (pessoa ainda em admin_roles; quem saiu da equipe vira a escola,
// tambem nas linhas antigas); "abriu" (opened_at) so com interacao de verdade, nunca com "Marcar todas".
// Banco sem a migracao = isMissingCommunicationSchema: sino vazio, escritas 404, nunca erro 500.

import { allowHideOf } from "@/components/member/notifications/notifications-model";
import { isHttpsOrLoopbackUrl } from "@/lib/loopback-url";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { isSafeHeroCtaHref } from "@/server/member-area/home-hero-links";
import { sanitizeProfileAvatarUrl } from "@/server/member-area/student-pages-model";
import { assertNoDbError, chunksOf, communicationsDb, CommunicationError, isMissingCommunicationSchema, type CommunicationsDb } from "./db";
import { FLOW_LIMITS } from "./flow-model";
import {
  isPollClosed,
  isReactionId,
  normalizePollChoice,
  notificationPollOf,
  parsePoll,
  pollTallyOf,
  shouldRecordInteraction,
  type NotificationPoll,
  type ReactionId
} from "./interactions-model";
import { noticeIconOfColumns, SCHOOL_NAME_FALLBACK_TEAM } from "./message-meta";
import {
  AUDIO_HEARD_SLOTS,
  commentNotificationTitle,
  CTA_DISPLAYS,
  decodeCursor,
  encodeCursor,
  normalizePeaks,
  NOTIFICATIONS_PAGE_SIZE,
  type CtaDisplay,
  type NotificationAudioProgress,
  type NotificationItem,
  type NotificationKind,
  type NotificationResponseValue,
  type NotificationsFilter,
  type NotificationsPage
} from "./notification-model";

export const NOTIFICATION_NOT_FOUND = "Notificacao nao encontrada.";
export const REACTIONS_NOT_ALLOWED = "Esta notificação não aceita reações.";
export const POLL_CLOSED = "A enquete foi encerrada.";
export const INVALID_VOTE = "Voto invalido.";
/** Excluir do sino num aviso em que a equipe desligou "Permitir que o aluno exclua" (403; o Desfazer vale sempre). */
export const HIDE_NOT_ALLOWED = "Esta notificação não pode ser excluída.";

/** Teto dos contadores de escrita do aluno numa linha (o check do banco para em 1000). */
const WRITES_CAP = 1_000;
const HEARD_MASK = /^[01]{48}$/;

type PageCampaign = {
  accept_label: string | null;
  /** O aluno pode excluir do sino (202610220002); ausente ou nulo = pode. */
  allow_hide?: boolean | null;
  allow_reactions: boolean | null;
  audio_duration_seconds: number | null;
  audio_mime: string | null;
  audio_peaks: unknown;
  audio_url: string | null;
  body: string | null;
  cta_display: string | null;
  cta_href: string | null;
  cta_label: string | null;
  cta_target: "new_tab" | "same_tab" | null;
  decline_label: string | null;
  icon: string | null;
  icon_color: string | null;
  id: string;
  image_alt: string | null;
  image_url: string | null;
  poll: unknown;
  response_mode: "accept_decline" | "none";
  /** Quem envia (pessoa da equipe); nulo = a escola. */
  sender_user_id: string | null;
  status: string;
  title: string;
};

type PageProfile = { avatar_url: string | null; full_name: string | null } | null;

/** Item de communication_inbox_page (4.3): a linha, o aviso e as pessoas citadas, ja resolvidos no banco. */
type PageRow = {
  actor_id: string | null;
  /** Perfil de quem respondeu (comentarios). */
  actor_profile: PageProfile;
  audio_completed_at: string | null;
  audio_heard: string | null;
  audio_heard_percent: number | null;
  audio_started_at: string | null;
  body: string | null;
  campaign: PageCampaign | null;
  campaign_id: string | null;
  clicked_at: string | null;
  created_at: string;
  expires_at: string | null;
  href: string | null;
  id: string;
  is_test: boolean;
  kind: NotificationKind;
  opened_at: string | null;
  payload: Record<string, unknown> | null;
  poll_choice: unknown;
  /** Contagem da enquete: so quando o aluno votou ou a enquete encerrou pela data (e a equipe deixou mostrar). */
  poll_tally: unknown;
  reaction: string | null;
  read_at: string | null;
  /** Autor da resposta citada (comentarios sem perfil). */
  reply: { author_avatar_url: string | null; author_name: string | null } | null;
  responded_at: string | null;
  response: NotificationResponseValue | null;
  seen_at: string | null;
  /** Quem envia ainda esta na equipe (admin_roles). */
  sender_on_team: boolean | null;
  sender_profile: PageProfile;
  title: string | null;
};

type InboxPage = { items: PageRow[] | null; unread: number | null; unseen: number | null };

/**
 * Item do sino com a lixeira por notificacao (ajustes da v3a): `allowHide` false = o cartao nao mostra o
 * "Excluir notificação". Comentario sempre pode.
 */
type BellItem = NotificationItem & { allowHide: boolean };

/** Linha de communication_visible_notifications (4.1): o que aparece no sino, com o que as rotas conferem. */
type VisibleRow = {
  allow_reactions: boolean | null;
  campaign_id: string | null;
  clicked_at: string | null;
  created_at: string;
  expires_at: string;
  /** Passo do fluxo que gerou a linha (notificacoes seguintes e fluxos); nulo nas outras. */
  flow_node_id: string | null;
  has_audio: boolean | null;
  id: string;
  interaction_writes: number | null;
  is_test: boolean;
  kind: NotificationKind;
  opened_at: string | null;
  poll: unknown;
  poll_choice: string[] | null;
  reaction: string | null;
  read_at: string | null;
  response: NotificationResponseValue | null;
  response_mode: "accept_decline" | "none" | null;
  seen_at: string | null;
  sent_at: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function payloadText(payload: Record<string, unknown> | null, key: string) {
  const value = payload?.[key];

  return typeof value === "string" && value.trim() ? value.trim() : null;
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

/** Ouvido gravado (48 trechos, OU acumulado); sem nada ainda = nada ouvido. */
function audioProgressOf(row: Pick<PageRow, "audio_completed_at" | "audio_heard" | "audio_heard_percent">): NotificationAudioProgress {
  const heard = row.audio_heard && HEARD_MASK.test(row.audio_heard) ? row.audio_heard : "0".repeat(AUDIO_HEARD_SLOTS);

  return {
    completed: Boolean(row.audio_completed_at),
    heard,
    percent: typeof row.audio_heard_percent === "number" ? Math.min(100, Math.max(0, row.audio_heard_percent)) : 0
  };
}

function ctaDisplayOf(value: unknown): CtaDisplay {
  return typeof value === "string" && (CTA_DISPLAYS as readonly string[]).includes(value) ? (value as CtaDisplay) : "button";
}

function pollChoiceOf(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : null;
}

/** Enquete do aviso como o aluno recebe (resultado so com a contagem que o banco mandou). */
function notificationPollOfRow(campaign: Pick<PageCampaign, "poll">, row: Pick<PageRow, "poll_choice" | "poll_tally">, now: number): NotificationPoll | null {
  const poll = parsePoll(campaign.poll);

  return poll ? notificationPollOf(poll, { choice: pollChoiceOf(row.poll_choice), closed: isPollClosed(poll, now), tally: pollTallyOf(row.poll_tally) }) : null;
}

/**
 * Quem envia o aviso, resolvido agora: a pessoa ainda na equipe (foto do perfil ou iniciais; sem nome,
 * "Equipe Bunker707", nunca o e-mail). Quem saiu da equipe, conta apagada ou a escola = null.
 */
function noticeSender(row: Pick<PageRow, "sender_on_team" | "sender_profile">): NotificationItem["actor"] {
  if (!row.sender_on_team) {
    return null;
  }

  return {
    avatarUrl: sanitizeProfileAvatarUrl(row.sender_profile?.avatar_url),
    name: row.sender_profile?.full_name?.trim() || SCHOOL_NAME_FALLBACK_TEAM
  };
}

/** Icone do aviso de live pelo tipo gravado no payload (docs/30 D27): no ar, cancelada ou o calendario dos lembretes. */
function webinarNotificationIcon(payload: Record<string, unknown> | null) {
  const kind = payloadText(payload, "kind");

  if (kind === "started") {
    return noticeIconOfColumns("live", "red");
  }

  // Fase 4c: a equipe respondeu a pergunta do aluno depois (notify.queueWebinarAnswerNotice).
  if (kind === "answer") {
    return noticeIconOfColumns("megaphone", "green");
  }

  return kind === "cancelled" ? noticeIconOfColumns("alert", "amber") : noticeIconOfColumns("calendar", "white");
}

/** Item do sino a partir da linha da pagina (null = aviso sem a campanha, que a regra do banco ja tira). */
function toItem(row: PageRow, now: number): BellItem | null {
  const base = {
    audioProgress: null,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    icon: null,
    id: row.id,
    kind: row.kind,
    openedAt: row.opened_at ?? null,
    readAt: row.read_at,
    seenAt: row.seen_at
  };

  if (row.kind === "notice") {
    const campaign = row.campaign;

    if (!campaign) {
      return null;
    }

    const imageUrl = safeMediaUrl(campaign.image_url);
    const audioUrl = safeMediaUrl(campaign.audio_url);
    const audio =
      audioUrl && campaign.audio_duration_seconds
        ? { durationSeconds: campaign.audio_duration_seconds, mimeType: campaign.audio_mime, peaks: normalizePeaks(campaign.audio_peaks), url: audioUrl }
        : null;

    return {
      ...base,
      actor: noticeSender(row),
      allowHide: allowHideOf(campaign.allow_hide),
      audio,
      audioProgress: audio ? audioProgressOf(row) : null,
      body: campaign.body ?? "",
      context: null,
      cta:
        campaign.cta_href && campaign.cta_label && campaign.cta_target && isSafeHeroCtaHref(campaign.cta_href)
          ? { display: ctaDisplayOf(campaign.cta_display), href: campaign.cta_href, label: campaign.cta_label, target: campaign.cta_target }
          : null,
      href: null,
      icon: noticeIconOfColumns(campaign.icon, campaign.icon_color),
      image: imageUrl ? { alt: campaign.image_alt ?? "", url: imageUrl } : null,
      poll: notificationPollOfRow(campaign, row, now),
      reactions: campaign.allow_reactions ? { value: isReactionId(row.reaction) ? row.reaction : null } : null,
      response:
        campaign.response_mode === "accept_decline"
          ? { acceptLabel: campaign.accept_label ?? "Aceitar", declineLabel: campaign.decline_label ?? "Recusar", value: row.response }
          : null,
      title: campaign.title
    };
  }

  if (row.kind === "webinar") {
    // Lembrete ou aviso de live (docs/30 D27): titulo, texto e link vem da propria linha, que o servidor escreve; a
    // escola envia; sem botao, reacoes, enquete nem resposta; o link e a pagina da live.
    return {
      ...base,
      actor: null,
      allowHide: true,
      audio: null,
      body: row.body ?? "",
      context: null,
      cta: null,
      href: row.href && isSafeHeroCtaHref(row.href) ? row.href : null,
      icon: webinarNotificationIcon(row.payload),
      image: null,
      poll: null,
      reactions: null,
      response: null,
      title: row.title?.trim() || WEBINAR_COPY.sino.tituloLembrete
    };
  }

  // Quem respondeu: o perfil; sem perfil (ou sem nome nele), o nome e a foto gravados no comentario.
  const actor = row.actor_profile
    ? { avatarUrl: sanitizeProfileAvatarUrl(row.actor_profile.avatar_url), name: row.actor_profile.full_name?.trim() || null }
    : undefined;
  const name = actor?.name ?? row.reply?.author_name?.trim() ?? null;
  const avatarUrl = actor ? actor.avatarUrl : sanitizeProfileAvatarUrl(row.reply?.author_avatar_url);

  return {
    ...base,
    actor: name ? { avatarUrl, name } : null,
    allowHide: true,
    audio: null,
    body: row.body ?? "",
    context: payloadText(row.payload, "lessonTitle"),
    cta: null,
    href: row.href && isSafeHeroCtaHref(row.href) ? row.href : null,
    image: null,
    poll: null,
    reactions: null,
    response: null,
    title: commentNotificationTitle(row.kind, name)
  };
}

function countOf(value: unknown) {
  const number = typeof value === "number" ? value : Number(value ?? 0);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

/** Os dois numeros do sino numa ida ao banco (communication_inbox_counts, pela regra unica). */
async function readCounts(db: CommunicationsDb, userId: string, now: number) {
  const { data, error } = await db.rpc("communication_inbox_counts", { p_now: new Date(now).toISOString(), p_user_id: userId });
  assertNoDbError(error, "Sino: contagem");

  const counts = (data ?? null) as { unread?: unknown; unseen?: unknown } | null;

  return { unread: countOf(counts?.unread), unseen: countOf(counts?.unseen) };
}

/** Pagina do sino (mais novas primeiro), com os contadores: uma ida ao banco (communication_inbox_page). */
export async function listNotifications(input: {
  cursor?: string | null;
  filter?: NotificationsFilter;
  limit?: number;
  now?: number;
  userId: string;
}): Promise<NotificationsPage> {
  const db = communicationsDb();
  const now = input.now ?? Date.now();
  // Antes da leitura: o que for gravado durante a leitura fica fora do "Marcar todas" (continua nova).
  const asOf = new Date(now).toISOString();
  const limit = Math.min(50, Math.max(1, input.limit ?? NOTIFICATIONS_PAGE_SIZE));
  const after = decodeCursor(input.cursor);

  try {
    const { data, error } = await db.rpc("communication_inbox_page", {
      p_cursor_created_at: after?.createdAt ?? null,
      p_cursor_id: after?.id ?? null,
      p_filter: input.filter === "unread" ? "unread" : "all",
      p_limit: limit,
      p_now: asOf,
      p_user_id: input.userId
    });
    assertNoDbError(error, "Sino: notificacoes");

    const result = (data ?? null) as InboxPage | null;
    // O banco devolve ate limit + 1: a sobra so diz que ha proxima pagina.
    const rows = Array.isArray(result?.items) ? result.items : [];
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null;
    const items = page.map((row) => toItem(row, now)).filter((item): item is BellItem => item !== null);

    return { asOf, items, nextCursor, unread: countOf(result?.unread), unseen: countOf(result?.unseen) };
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      return { asOf, items: [], nextCursor: null, unread: 0, unseen: 0 };
    }

    throw error;
  }
}

/** Numero do sino (nao vistas nos ultimos 90 dias). */
export async function countUnseen(userId: string, now = Date.now()) {
  return (await readNotificationCounts(userId, now)).unseen;
}

/** Nao lidas nos ultimos 90 dias. */
export async function countUnread(userId: string, now = Date.now()) {
  return (await readNotificationCounts(userId, now)).unread;
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

const VISIBLE_IDS_PAGE = 1_000;
const MARK_CHUNK = 150;
const VISIBLE_IDS_COLUMNS = "id,kind,is_test,flow_node_id,created_at,sent_at";

type VisibilityRow = Pick<VisibleRow, "created_at" | "flow_node_id" | "id" | "is_test" | "kind" | "sent_at">;

/**
 * Aviso que ja aparecia no sino em `asOf`: enviado ate la (o envio grava as linhas antes e so no fim
 * passa a "Enviada"). O teste da equipe aparece na hora; o created_at ja vem filtrado no banco.
 *
 * Linha de fluxo (flow_node_id): vale o created_at dela, nao o sent_at do aviso (uma versao nova nasce
 * "Enviada" e as linhas chegam uma a uma muito depois; e a linha e gravada dentro da transacao do
 * motor, que so aparece para as outras leituras no commit, ate ~10 s depois do created_at). So conta
 * com created_at ate asOf - 15 s, ou quando o painel diz que mostrou (`shown`).
 */
function wasVisibleAt(row: VisibilityRow, asOf: string, shown: ReadonlySet<string>) {
  if (row.kind !== "notice" || row.is_test) {
    return true;
  }

  if (row.flow_node_id) {
    return shown.has(row.id) || Date.parse(row.created_at) <= Date.parse(asOf) - FLOW_LIMITS.flowRowSettleMs;
  }

  return Boolean(row.sent_at && Date.parse(row.sent_at) <= Date.parse(asOf));
}

/**
 * Ids das notificacoes do aluno, nos ultimos 90 dias, ainda sem `column` e que aparecem no sino agora
 * (a regra unica do banco). "Marcar todas" e "abriu o sino" so mexem nestas: aviso ainda sendo enviado,
 * resposta escondida pela moderacao ou notificacao que o aluno excluiu nao muda. Com `asOf` (a hora da
 * lista que o painel mostrou), so o que ja aparecia naquela hora: o que chegou ou foi enviado com o
 * painel aberto continua novo.
 */
async function visibleIdsWithout(
  db: CommunicationsDb,
  userId: string,
  column: "read_at" | "seen_at",
  now: number,
  asOf: string | null,
  shown: ReadonlySet<string>
) {
  const ids: string[] = [];

  for (let from = 0; ; from += VISIBLE_IDS_PAGE) {
    let query = db
      .rpc("communication_visible_notifications", { p_id: null, p_now: new Date(now).toISOString(), p_user_id: userId })
      .select(VISIBLE_IDS_COLUMNS)
      .is(column, null);

    if (asOf) {
      query = query.lte("created_at", asOf);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + VISIBLE_IDS_PAGE - 1);
    assertNoDbError(error, "Sino: notificacoes para marcar");

    const rows = (data ?? []) as unknown as VisibilityRow[];
    ids.push(...rows.filter((row) => !asOf || wasVisibleAt(row, asOf, shown)).map((row) => row.id));

    if (rows.length < VISIBLE_IDS_PAGE) {
      return ids;
    }
  }
}

/**
 * Visto, depois lido e (pedido por id) aberto, em lotes de ids: o banco exige "lida" so depois de
 * "vista" e "aberta" so depois de "lida". Linha que ja saiu do sino (expires_at) nao muda.
 */
async function markIds(db: CommunicationsDb, userId: string, ids: readonly string[], input: { nowIso: string; open: boolean; read: boolean }) {
  for (const part of chunksOf(Array.from(new Set(ids)), MARK_CHUNK)) {
    const seen = await db
      .from("notifications")
      .update({ seen_at: input.nowIso })
      .eq("user_id", userId)
      .in("id", part)
      .is("seen_at", null)
      .gt("expires_at", input.nowIso);
    assertNoDbError(seen.error, "Sino: marcar como vistas");

    if (input.read) {
      // So o que ja esta visto: uma linha que nao passou pelo update acima nunca quebra a regra do banco.
      const read = await db
        .from("notifications")
        .update({ read_at: input.nowIso })
        .eq("user_id", userId)
        .in("id", part)
        .is("read_at", null)
        .not("seen_at", "is", null)
        .gt("expires_at", input.nowIso);
      assertNoDbError(read.error, "Sino: marcar como lidas");
    }

    if (input.open) {
      // Aberta: interacao de verdade (cartao, "Ver mais"), tambem num cartao ja lido pelo "Marcar todas".
      const opened = await db
        .from("notifications")
        .update({ opened_at: input.nowIso })
        .eq("user_id", userId)
        .in("id", part)
        .is("opened_at", null)
        .not("read_at", "is", null)
        .gt("expires_at", input.nowIso);
      assertNoDbError(opened.error, "Sino: marcar como abertas");
    }
  }
}

type MarkAllOptions = {
  /** Hora da lista que o painel mostrou (ja conferida por parseNotificationsAsOf); null = tudo o que aparece agora. */
  asOf?: string | null;
  now?: Date;
  /**
   * Avisos que o painel mostrou e que chegaram ha menos de 15 s (ja conferidos como uuids pela rota):
   * linhas de fluxo nessa folga contam mesmo assim (wasVisibleAt).
   */
  shown?: readonly string[];
};

function shownSet(options: MarkAllOptions) {
  return new Set((options.shown ?? []).map((id) => id.toLowerCase()));
}

/** Abriu o sino: tudo que aparece na lista conta como visto (o numero zera; as bolinhas ficam). */
export async function markAllSeen(userId: string, options: MarkAllOptions = {}) {
  const db = communicationsDb();
  const now = options.now ?? new Date();

  try {
    const ids = await visibleIdsWithout(db, userId, "seen_at", now.getTime(), options.asOf ?? null, shownSet(options));
    await markIds(db, userId, ids, { nowIso: now.toISOString(), open: false, read: false });
  } catch (error) {
    if (!isMissingCommunicationSchema(error)) {
      throw error;
    }
  }
}

/**
 * Marca como lidas as notificacoes pedidas (ou todas as que aparecem no sino; `asOf` e `shown` valem so
 * para "all"). Lida tambem conta como vista. Pedidas por id (o aluno abriu o cartao ou "Ver mais")
 * tambem contam como abertas; "all" ("Marcar todas") nunca.
 */
export async function markRead(userId: string, ids: readonly string[] | "all", options: MarkAllOptions = {}) {
  const db = communicationsDb();
  const now = options.now ?? new Date();

  try {
    const targets = ids === "all" ? await visibleIdsWithout(db, userId, "read_at", now.getTime(), options.asOf ?? null, shownSet(options)) : ids;
    await markIds(db, userId, targets, { nowIso: now.toISOString(), open: ids !== "all", read: true });
  } catch (error) {
    if (!isMissingCommunicationSchema(error)) {
      throw error;
    }
  }
}

/** O que a rota exige da notificacao alem de aparecer no sino (senao 404; reacoes nao permitidas = 409). */
type OwnRequirement = "audio" | "poll" | "reactions" | "response";

/**
 * A notificacao do proprio aluno, visivel no sino agora (a regra unica: communication_visible_notifications
 * com p_id) e com o que a rota pede (`require`); senao 404 (sem dizer se existe para outra pessoa).
 */
async function fetchOwnVisible(db: CommunicationsDb, userId: string, id: string, options: { now: Date; require?: OwnRequirement }): Promise<VisibleRow> {
  if (!UUID.test(id)) {
    throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
  }

  let row: VisibleRow | null;

  try {
    const { data, error } = await db
      .rpc("communication_visible_notifications", { p_id: id, p_now: options.now.toISOString(), p_user_id: userId })
      .maybeSingle();
    assertNoDbError(error, "Sino: notificacao");
    row = (data ?? null) as VisibleRow | null;
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
    }

    throw error;
  }

  if (!row) {
    throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
  }

  const notice = row.kind === "notice";
  const missing =
    (options.require === "audio" && !(notice && row.has_audio)) ||
    (options.require === "response" && !(notice && row.response_mode === "accept_decline")) ||
    (options.require === "poll" && !(notice && parsePoll(row.poll))) ||
    (options.require === "reactions" && !notice);

  if (missing) {
    throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
  }

  if (options.require === "reactions" && !row.allow_reactions) {
    throw new CommunicationError(REACTIONS_NOT_ALLOWED, 409);
  }

  return row;
}

function nextWrites(writes: number | null | undefined) {
  return Math.min((writes ?? 0) + 1, WRITES_CAP);
}

/** Seguiu o link da notificacao (ou o botao do aviso): conta como vista, lida, aberta e clicada. */
export async function markClicked(userId: string, id: string, now = new Date()) {
  const db = communicationsDb();
  const row = await fetchOwnVisible(db, userId, id, { now });
  const nowIso = now.toISOString();
  const { error } = await db
    .from("notifications")
    .update({
      clicked_at: row.clicked_at ?? nowIso,
      opened_at: row.opened_at ?? nowIso,
      read_at: row.read_at ?? nowIso,
      seen_at: row.seen_at ?? nowIso
    })
    .eq("id", row.id)
    .eq("user_id", userId);
  assertNoDbError(error, "Sino: clique");

  return { campaignId: row.campaign_id, kind: row.kind };
}

type RespondResult = { changed?: unknown; first?: unknown; response?: unknown; writes?: unknown };

/**
 * "Aceitar" ou "Recusar" num aviso que pede resposta (conta como aberta), tambem para mudar a resposta
 * enquanto a notificacao estiver no sino (communication_respond_notification: responded_at fica o da
 * primeira; response_changes conta as mudancas). Mesma resposta = nada muda.
 */
export async function respondToNotification(userId: string, id: string, response: NotificationResponseValue, now = new Date()) {
  const db = communicationsDb();
  const row = await fetchOwnVisible(db, userId, id, { now, require: "response" });
  const { data, error } = await db.rpc("communication_respond_notification", {
    p_notification_id: row.id,
    p_now: now.toISOString(),
    p_response: response,
    p_user_id: userId
  });
  assertNoDbError(error, "Sino: resposta");

  const result = (data ?? null) as RespondResult | null;

  if (!result) {
    throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
  }

  const changed = result.changed === true;
  const first = result.first === true;

  return {
    campaignId: row.campaign_id,
    changed,
    first,
    // Evento so quando algo mudou e a linha ainda nao passou do teto (writes = escritas antes desta).
    recordEvent: shouldRecordInteraction(countOf(result.writes), first || changed),
    response
  };
}

/**
 * Reacao do aluno (uma por notificacao; null = tirar). Conta como interacao (vista, lida e aberta).
 * Mesma reacao = nada muda. So em aviso com "Permitir reacoes" (senao 409).
 */
export async function reactToNotification(userId: string, id: string, reaction: ReactionId | null, now = new Date()) {
  const db = communicationsDb();
  const row = await fetchOwnVisible(db, userId, id, { now, require: "reactions" });
  const current = isReactionId(row.reaction) ? row.reaction : null;

  if (current === reaction) {
    return { campaignId: row.campaign_id, changed: false, reaction, recordEvent: false };
  }

  const nowIso = now.toISOString();
  const writes = nextWrites(row.interaction_writes);
  const patch = reaction
    ? {
        interaction_writes: writes,
        opened_at: row.opened_at ?? nowIso,
        reacted_at: nowIso,
        reaction,
        read_at: row.read_at ?? nowIso,
        seen_at: row.seen_at ?? nowIso
      }
    : { interaction_writes: writes, reacted_at: null, reaction: null };
  const { error } = await db.from("notifications").update(patch).eq("id", row.id).eq("user_id", userId);
  assertNoDbError(error, "Sino: reacao");

  return { campaignId: row.campaign_id, changed: true, reaction, recordEvent: shouldRecordInteraction(row.interaction_writes ?? 0, true) };
}

type VoteResult = { changed?: unknown; choice?: unknown; first?: unknown; tally?: unknown; writes?: unknown };

/**
 * Voto na enquete do aviso (optionIds vazio = tirar o voto), enquanto a enquete estiver aberta (senao
 * 409). Conta como interacao. Devolve a enquete como o aluno ve agora (o resultado so vem quando ele
 * votou e a equipe deixou mostrar).
 */
export async function voteOnNotificationPoll(userId: string, id: string, optionIds: readonly unknown[], now = new Date()) {
  const db = communicationsDb();
  const row = await fetchOwnVisible(db, userId, id, { now, require: "poll" });
  const poll = parsePoll(row.poll)!;

  if (isPollClosed(poll, now.getTime())) {
    throw new CommunicationError(POLL_CLOSED, 409);
  }

  const normalized = normalizePollChoice(poll, optionIds);

  if (!normalized.ok) {
    throw new CommunicationError(normalized.message, 400);
  }

  const { data, error } = await db.rpc("communication_vote_notification_poll", {
    p_notification_id: row.id,
    p_now: now.toISOString(),
    p_option_ids: normalized.choice,
    p_user_id: userId
  });
  assertNoDbError(error, "Sino: voto");

  const result = (data ?? null) as VoteResult | null;

  if (!result) {
    throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
  }

  const choice = pollChoiceOf(result.choice) ?? [];
  const changed = result.changed === true;
  const first = result.first === true;

  return {
    campaignId: row.campaign_id,
    changed,
    choice,
    first,
    poll: notificationPollOf(poll, { choice, closed: false, tally: pollTallyOf(result.tally) }),
    recordEvent: shouldRecordInteraction(countOf(result.writes), first || changed)
  };
}

/**
 * "Excluir notificacao" do proprio sino (hidden true) e o "Desfazer" (false): some so para este aluno,
 * da lista, dos numeros e das marcacoes; continua "recebeu" nos relatorios. Excluir conta como vista.
 * Repetir (excluir o que ja saiu, desfazer o que esta no sino) e sucesso sem escrita. Devolve os numeros.
 */
export async function setNotificationHidden(userId: string, id: string, hidden: boolean, now = new Date()) {
  const db = communicationsDb();
  const nowIso = now.toISOString();
  let changed = false;
  let campaignId: string | null = null;
  let writesBefore = 0;

  if (hidden) {
    let row: VisibleRow | null = null;

    try {
      row = await fetchOwnVisible(db, userId, id, { now });
    } catch (error) {
      if (!(error instanceof CommunicationError) || error.status !== 404 || !(await isOwnHidden(db, userId, id))) {
        throw error;
      }
    }

    if (row && row.kind === "notice" && row.campaign_id && !(await campaignAllowsHide(db, row.campaign_id))) {
      throw new CommunicationError(HIDE_NOT_ALLOWED, 403);
    }

    if (row) {
      const { data, error } = await db
        .from("notifications")
        .update({ hidden_at: nowIso, interaction_writes: nextWrites(row.interaction_writes), seen_at: row.seen_at ?? nowIso })
        .eq("id", row.id)
        .eq("user_id", userId)
        .is("hidden_at", null)
        .select("id");
      assertNoDbError(error, "Sino: excluir do sino");
      changed = (data ?? []).length === 1;
      campaignId = row.campaign_id;
      writesBefore = row.interaction_writes ?? 0;
    }
  } else {
    const own = await readOwnRow(db, userId, id);

    if (!own) {
      throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
    }

    if (own.hidden_at) {
      const { data, error } = await db
        .from("notifications")
        .update({ hidden_at: null, interaction_writes: nextWrites(own.interaction_writes) })
        .eq("id", own.id)
        .eq("user_id", userId)
        .not("hidden_at", "is", null)
        .select("id");
      assertNoDbError(error, "Sino: voltar para o sino");
      changed = (data ?? []).length === 1;
      campaignId = own.campaign_id;
      writesBefore = own.interaction_writes ?? 0;
    }
  }

  return {
    campaignId,
    changed,
    counts: await readNotificationCounts(userId, now.getTime()),
    hidden,
    recordEvent: shouldRecordInteraction(writesBefore, changed)
  };
}

type OwnRow = { campaign_id: string | null; hidden_at: string | null; id: string; interaction_writes: number | null; kind: NotificationKind };

/** A linha do proprio aluno por id, apareca ou nao no sino (o "Desfazer" e o excluir repetido). */
async function readOwnRow(db: CommunicationsDb, userId: string, id: string): Promise<OwnRow | null> {
  if (!UUID.test(id)) {
    return null;
  }

  try {
    const { data, error } = await db
      .from("notifications")
      .select("id,kind,campaign_id,hidden_at,interaction_writes")
      .eq("id", id)
      .eq("user_id", userId)
      .maybeSingle();
    assertNoDbError(error, "Sino: notificacao do aluno");

    return (data ?? null) as OwnRow | null;
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      return null;
    }

    throw error;
  }
}

async function isOwnHidden(db: CommunicationsDb, userId: string, id: string) {
  return Boolean((await readOwnRow(db, userId, id))?.hidden_at);
}

/** A equipe deixou o aluno excluir este aviso do sino (campaigns.allow_hide; ausente = pode). */
async function campaignAllowsHide(db: CommunicationsDb, campaignId: string) {
  try {
    const { data, error } = await db.from("campaigns").select("allow_hide").eq("id", campaignId).maybeSingle();
    assertNoDbError(error, "Sino: aviso pode ser excluido");

    return allowHideOf((data as { allow_hide?: unknown } | null)?.allow_hide);
  } catch (error) {
    // Banco sem a 202610220002: a lixeira continua como antes.
    if (isMissingCommunicationSchema(error)) {
      return true;
    }

    throw error;
  }
}

type AudioRecord = { completed: boolean; completedNow: boolean; heard: string; percent: number; startedNow: boolean };

/**
 * Audio do aviso no sino (POST /api/notifications/[id]/audio): "started" no primeiro play (visto, lido,
 * aberto e o comeco do audio) ou "progress" com os 48 trechos ouvidos, somados por OU no banco (so
 * cresce; 44 ou mais = ouvido). So na propria linha, visivel, dentro do expires_at e com audio; senao
 * 404. Banco sem a 202610200002: 404.
 */
export async function recordNotificationAudio(
  userId: string,
  id: string,
  input: { event: "progress"; heard: string } | { event: "started" },
  now = new Date()
) {
  const db = communicationsDb();
  const row = await fetchOwnVisible(db, userId, id, { now, require: "audio" });

  try {
    const { data, error } = await db.rpc("communication_record_notification_audio", {
      p_event: input.event,
      p_heard: input.event === "progress" ? input.heard : null,
      p_notification_id: row.id,
      p_now: now.toISOString(),
      p_user_id: userId
    });
    assertNoDbError(error, "Sino: audio ouvido");

    const result = (data ?? null) as AudioRecord | null;

    if (!result) {
      throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
    }

    const audioProgress: NotificationAudioProgress = {
      completed: Boolean(result.completed),
      heard: HEARD_MASK.test(result.heard) ? result.heard : "0".repeat(AUDIO_HEARD_SLOTS),
      percent: Math.min(100, Math.max(0, Math.trunc(Number(result.percent) || 0)))
    };

    return { audioProgress, campaignId: row.campaign_id, completedNow: Boolean(result.completedNow), startedNow: Boolean(result.startedNow) };
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      throw new CommunicationError(NOTIFICATION_NOT_FOUND, 404);
    }

    throw error;
  }
}
