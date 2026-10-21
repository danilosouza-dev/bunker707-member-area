import "server-only";

// Leituras de Comunicacao > Avisos e pop-ups (docs/22 §3; docs/17 §1.8): lista com os numeros de cada
// aviso, detalhe para o editor e o relatorio, os quatro numeros do topo e as opcoes do editor (produtos,
// turmas, segmentos de Alunos, marca para a previa). Chamadas pelas paginas do admin depois de
// requirePageArea("comunicacao"); banco sem a migracao 202610200001 -> PendingMigrationError (a pagina
// mostra o aviso da migracao).

import {
  followUpsModeOf,
  type FollowUpsMode,
  type FollowUpStats,
  type SavedFollowUp
} from "@/components/admin/v2/communication/follow-ups-view-model";
import { shouldClampNotificationBody } from "@/components/member/notifications/notifications-model";
import { ADMIN_ROLE_LABELS, can, type AdminRole } from "@/server/auth/roles";
import { getAdminAccessForUser, getAuthenticatedUser } from "@/server/auth/session";
import { listProductOptions } from "@/server/catalog/queries";
import type { ProductOption } from "@/server/catalog/types";
import { pageKeyOfHref } from "@/server/member-area/page-visit-model";
import { readPlatformSettings, type PlatformSettingSnapshot } from "@/server/member-area/settings-store";
import { sanitizeProfileAvatarUrl } from "@/server/member-area/student-pages-model";
import { normalizeLogo } from "@/server/storefront/model";
import { STUDENT_SEGMENT_PRESETS } from "@/server/students/model";
import { listSavedSegments } from "@/server/students/queries";
import {
  describeAudience,
  isAudienceGroup,
  messageRefKey,
  studentListParamsToAudience,
  type AudienceDefinition,
  type AudienceNames,
  type AudienceNode
} from "./audience-model";
import {
  availableNoticeActions,
  CAMPAIGN_KIND_LABELS,
  formatSaoPauloDateTime,
  SITUATION_LABELS,
  situationOf,
  situationTone,
  type CampaignKind,
  type CampaignSituation,
  type CampaignStatus,
  type NoticeAction,
  type NoticePermissions,
  type SituationTone
} from "./campaign-model";
import { assertNoDbError, chunksOf, communicationsDb, type CommunicationsDb } from "./db";
import { entryOf, followUpsFromTree, type FlowEndedReason, type FlowNode, type FlowStatus, type FollowUp } from "./flow-model";
import type { FlowNoticeContent } from "./flow-schemas";
import { definitionOf, fetchFlowNodeStats, fetchFlowStats, fetchFlowTree, lastSourceExpiry, type LoadedFlowTree } from "./flow-store";
import { noticeIconOfColumns, normalizeSchoolIcon, SCHOOL_NAME_FALLBACK_TEAM, type NoticeIconColor, type NoticeIconId } from "./message-meta";
import { emptyNoticeDraft, type NoticeDraft } from "./schemas";
import {
  audienceOfRow,
  EMPTY_CAMPAIGN_ENGAGEMENT,
  EMPTY_CAMPAIGN_STATS,
  fetchCampaign,
  fetchCampaignEngagement,
  fetchCampaignStats,
  fetchCampaignsByIds,
  fetchOverview,
  listCampaignRows,
  rowToDraft,
  type CampaignEngagement,
  type CampaignRow,
  type CampaignStats
} from "./store";

export const NOTICES_PAGE_SIZE = 20;
/** Nome da escola na previa (o mesmo do login padrao). */
export const SCHOOL_NAME = "Bunker707";

const NO_PERMISSIONS: NoticePermissions = { canPublish: false, canPublishLarge: false, canWrite: false };

export type NoticePerson = { id: string; name: string };

export type NoticeListItem = {
  actions: NoticeAction[];
  audienceCount: number | null;
  audienceDescription: string;
  /** Cliques sobre vistos, 0..100 (null sem ninguem que viu). */
  clickRate: number | null;
  createdAt: string;
  createdBy: NoticePerson | null;
  /** Notificacoes seguintes do aviso (v2): o chip "+2 seguintes" da lista. */
  followUpCount: number;
  /** Seguintes que ja chegaram aos alunos: o "Retirar também ... que já saíram (n)". */
  followUpsSent: number;
  /** Icone ao lado do titulo (v2): na lista, no lugar do icone do tipo quando nao ha imagem. */
  icon: { color: NoticeIconColor; id: NoticeIconId } | null;
  id: string;
  imageUrl: string | null;
  kind: CampaignKind;
  kindLabel: string;
  situation: CampaignSituation;
  situationLabel: string;
  situationTone: SituationTone;
  stats: CampaignStats;
  status: CampaignStatus;
  title: string;
  updatedAt: string;
  /** "Enviada em 21/10/2026 às 14:30", "De 14/10/2026 às 09:00 a 21/10/2026 às 23:59"... */
  whenLabel: string;
};

export type NoticesPage = { items: NoticeListItem[]; page: number; pageSize: number; total: number };

export type NoticeDetail = NoticeListItem & {
  approvedAt: string | null;
  approvedBy: NoticePerson | null;
  audienceCountedAt: string | null;
  draft: NoticeDraft;
  /** Abriram, comecaram o audio e ouviram ate o fim (v2), sem os testes da equipe. */
  engagement: CampaignEngagement;
  /** Conteudo de um passo de fluxo: /avisos/[id] leva para o fluxo (null = aviso comum). */
  flowId: string | null;
  flowNodeId: string | null;
  /** "Depois desta notificação" (v2): o fluxo do aviso, quando ha; null = nenhuma seguinte ainda (ou pop-up). */
  followUps: NoticeFollowUpsDetail | null;
  /**
   * Opcoes do editor para mudar as seguintes no relatorio, depois do envio (so para quem pode: messaging.publish
   * e, acima de 500, messaging.publish_large); null nos outros casos.
   */
  followUpOptions: NoticeEditorOptions | null;
  lastError: string | null;
  recipientsCount: number | null;
  requestedAt: string | null;
  requestedBy: NoticePerson | null;
  sendAt: string | null;
  /**
   * Quem envia gravado (pessoa da equipe, com o nome e a foto que o aluno ve); null = a escola. `onTeam`
   * false: saiu da equipe e a notificacao aparece como a escola.
   */
  sender: (NoticePerson & { avatarUrl: string | null; onTeam: boolean }) | null;
  sentAt: string | null;
};

export type CommunicationOverview = {
  activeNow: number;
  /** 0..100; null quando ninguem viu no periodo. */
  clickRate: number | null;
  clicked: number;
  seen: number;
  studied7d: number;
};

/* ------------------------------------------------------------------------------------------------
 * Nomes (produtos, turmas, pessoas)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Ids citados no segmento: produtos (tambem os da pagina visitada e do acesso ganho, v2), turmas e avisos
 * das regras "o que fez com a notificacao X" (os passos de um fluxo tem o titulo no proprio fluxo).
 */
function collectIds(definition: AudienceDefinition, products: Set<string>, cohorts: Set<string>, campaigns: Set<string>) {
  const visit = (node: AudienceNode) => {
    if (isAudienceGroup(node)) {
      node.items.forEach(visit);
      return;
    }

    if (node.type === "product" || node.type === "access_gained") {
      node.productIds.forEach((id) => products.add(id));
    } else if (node.type === "cohort") {
      node.cohortIds.forEach((id) => cohorts.add(id));
    } else if ((node.type === "progress" || node.type === "access_age" || node.type === "access_ending") && node.productId) {
      products.add(node.productId);
    } else if (node.type === "page_visit" && (node.page.kind === "content" || node.page.kind === "checkout") && node.page.productId) {
      products.add(node.page.productId);
    } else if (node.type === "message" && node.ref.kind === "campaign" && node.ref.campaignId) {
      campaigns.add(node.ref.campaignId);
    }
  };

  if (definition.kind === "rules") {
    visit(definition.root);
  }
}

/** Titulo de cada aviso citado, pela chave da regra ("campaign:<id>"); aviso excluido fica sem titulo. */
async function selectNoticeTitles(db: CommunicationsDb, ids: readonly string[]) {
  const titles: Record<string, string> = {};
  const valid = Array.from(new Set(ids)).filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

  for (const part of chunksOf(valid, 150)) {
    const { data, error } = await db.from("campaigns").select("id,title").in("id", part).is("deleted_at", null);
    assertNoDbError(error, "Comunicacao: nomes (avisos)");

    for (const row of (data ?? []) as { id: string; title: string | null }[]) {
      const title = row.title?.trim();

      if (title) {
        titles[messageRefKey({ campaignId: row.id, kind: "campaign" })] = title;
      }
    }
  }

  return titles;
}

async function selectNames(db: CommunicationsDb, table: "cohorts" | "content_items", column: "name" | "title", ids: readonly string[]) {
  const names: Record<string, string> = {};

  for (const part of chunksOf(Array.from(new Set(ids)), 150)) {
    const { data, error } = await db.from(table).select(`id,${column}`).in("id", part);
    assertNoDbError(error, `Comunicacao: nomes (${table})`);

    for (const row of (data ?? []) as Record<string, string | null>[]) {
      const name = row[column]?.trim();

      if (row.id && name) {
        names[row.id] = name;
      }
    }
  }

  return names;
}

/**
 * Nomes dos produtos, turmas e avisos citados nos segmentos (produto ou aviso removido cai no texto
 * padrao da frase). `messages` so vem quando alguma regra cita um aviso.
 */
export async function loadAudienceNames(db: CommunicationsDb, definitions: readonly AudienceDefinition[]): Promise<AudienceNames> {
  const products = new Set<string>();
  const cohorts = new Set<string>();
  const campaigns = new Set<string>();
  definitions.forEach((definition) => collectIds(definition, products, cohorts, campaigns));

  const [productNames, cohortNames, messageTitles] = await Promise.all([
    selectNames(db, "content_items", "title", Array.from(products)),
    selectNames(db, "cohorts", "name", Array.from(cohorts).filter((id) => /^[0-9a-f-]{36}$/i.test(id))),
    campaigns.size > 0 ? selectNoticeTitles(db, Array.from(campaigns)) : Promise.resolve(null)
  ]);

  return messageTitles ? { cohorts: cohortNames, messages: messageTitles, products: productNames } : { cohorts: cohortNames, products: productNames };
}

/** Aviso enviado que o segmento pode citar em "O que fez com uma notificação" (o seletor do construtor). */
export type AudienceNoticeOption = {
  /** Ha o que abrir ("Ver mais", audio, botao ou resposta); sem isso, nada de "abriu" na regra. */
  canOpen: boolean;
  hasAudio: boolean;
  hasCta: boolean;
  hasResponse: boolean;
  id: string;
  sentAt: string;
  title: string;
};

/** Quantos avisos o seletor mostra (os mais recentes primeiro). */
export const AUDIENCE_NOTICE_OPTIONS_LIMIT = 200;
const AUDIENCE_NOTICE_DAYS = 90;

/**
 * Notificacoes enviadas nos ultimos 90 dias (fora as dos fluxos), mais recentes primeiro: o seletor da
 * regra "O que fez com uma notificação" no segmento (docs/23 §7). O que cada uma tem (audio, botao,
 * resposta) decide as acoes oferecidas.
 */
export async function loadAudienceNoticeOptions(db: CommunicationsDb, now = Date.now()): Promise<AudienceNoticeOption[]> {
  const since = new Date(now - AUDIENCE_NOTICE_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("campaigns")
    .select("id,title,body,sent_at,audio_url,cta_href,response_mode")
    .eq("kind", "inbox")
    .eq("status", "sent")
    .is("flow_id", null)
    .is("deleted_at", null)
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .order("id")
    .limit(AUDIENCE_NOTICE_OPTIONS_LIMIT);
  assertNoDbError(error, "Comunicacao: notificacoes enviadas");

  type Row = { audio_url: string | null; body: string | null; cta_href: string | null; id: string; response_mode: string | null; sent_at: string; title: string | null };

  return ((data ?? []) as Row[]).map((row) => {
    const hasAudio = Boolean(row.audio_url);
    const hasCta = Boolean(row.cta_href);
    const hasResponse = row.response_mode === "accept_decline";

    return {
      // Aviso curto so de texto aparece inteiro no sino: nao ha o que abrir (docs/23 V7).
      canOpen: hasAudio || hasCta || hasResponse || shouldClampNotificationBody(row.body ?? ""),
      hasAudio,
      hasCta,
      hasResponse,
      id: row.id,
      sentAt: row.sent_at,
      title: row.title?.trim() || "Sem título"
    };
  });
}

async function loadPeople(db: CommunicationsDb, ids: readonly (string | null)[]) {
  const people = new Map<string, NoticePerson>();
  const wanted = ids.filter((id): id is string => Boolean(id));

  for (const part of chunksOf(Array.from(new Set(wanted)), 150)) {
    const { data, error } = await db.from("profiles").select("id,full_name,email").in("id", part);
    assertNoDbError(error, "Comunicacao: equipe");

    for (const row of (data ?? []) as { email: string | null; full_name: string | null; id: string }[]) {
      people.set(row.id, { id: row.id, name: row.full_name?.trim() || row.email?.split("@")[0] || "Equipe" });
    }
  }

  return people;
}

/* ------------------------------------------------------------------------------------------------
 * Linha da lista
 * ---------------------------------------------------------------------------------------------- */

function rate(clicked: number, seen: number) {
  return seen > 0 ? Math.round((clicked / seen) * 1000) / 10 : null;
}

/** Quando o aviso sai ou aparece, no fuso de Sao Paulo. */
export function describeNoticeWhen(row: Pick<CampaignRow, "ends_at" | "kind" | "send_at" | "sent_at" | "starts_at" | "status">) {
  if (row.kind === "inbox") {
    switch (row.status) {
      case "sent":
        return `Enviada em ${formatSaoPauloDateTime(row.sent_at ?? row.send_at)}`;
      case "sending":
        return "Enviando agora";
      case "scheduled":
        return `Agendada para ${formatSaoPauloDateTime(row.send_at)}`;
      case "canceled":
        return row.sent_at ? `Retirada (enviada em ${formatSaoPauloDateTime(row.sent_at)})` : "Cancelada";
      default:
        return row.send_at ? `Para ${formatSaoPauloDateTime(row.send_at)}` : "Envio na hora de publicar";
    }
  }

  const start = formatSaoPauloDateTime(row.starts_at);
  const end = formatSaoPauloDateTime(row.ends_at);

  if (start && end) {
    return `De ${start} a ${end}`;
  }

  if (start) {
    return `A partir de ${start}`;
  }

  if (end) {
    return `Até ${end}`;
  }

  return row.sent_at ? `Desde ${formatSaoPauloDateTime(row.sent_at)}, sem data para acabar` : "Sem data para acabar";
}

function toListItem(
  row: CampaignRow,
  input: {
    followUps?: ReadonlyMap<string, { count: number; sent: number }>;
    names: AudienceNames;
    now: number;
    people: Map<string, NoticePerson>;
    permissions: NoticePermissions;
    stats: Map<string, CampaignStats>;
  }
): NoticeListItem {
  const timing = { endsAt: row.ends_at, kind: row.kind, sendAt: row.send_at, startsAt: row.starts_at, status: row.status };
  const situation = situationOf(timing, input.now);
  const stats = input.stats.get(row.id) ?? EMPTY_CAMPAIGN_STATS;

  return {
    actions: availableNoticeActions(timing, input.now, input.permissions),
    audienceCount: row.audience_count,
    audienceDescription: describeAudience(audienceOfRow(row), input.names),
    clickRate: rate(stats.clicked, stats.seen),
    createdAt: row.created_at,
    createdBy: row.created_by ? (input.people.get(row.created_by) ?? null) : null,
    followUpCount: input.followUps?.get(row.id)?.count ?? 0,
    followUpsSent: input.followUps?.get(row.id)?.sent ?? 0,
    icon: noticeIconOfColumns(row.icon, row.icon_color),
    id: row.id,
    imageUrl: row.image_url,
    kind: row.kind,
    kindLabel: CAMPAIGN_KIND_LABELS[row.kind],
    situation,
    situationLabel: SITUATION_LABELS[situation],
    situationTone: situationTone(situation),
    stats,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
    whenLabel: describeNoticeWhen(row)
  };
}

/** Lista da equipe, 20 por pagina, mais novos primeiro, com os numeros de cada aviso. */
export async function listNotices(input: { kind?: CampaignKind; now?: number; page?: number; permissions?: NoticePermissions }): Promise<NoticesPage> {
  const db = communicationsDb();
  const now = input.now ?? Date.now();
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const { rows, total } = await listCampaignRows(db, { kind: input.kind, page, pageSize: NOTICES_PAGE_SIZE });
  const [stats, names, people, followUps] = await Promise.all([
    fetchCampaignStats(db, rows.map((row) => row.id)),
    loadAudienceNames(db, rows.map(audienceOfRow)),
    loadPeople(db, rows.map((row) => row.created_by)),
    loadFollowUpCounts(db, rows.filter((row) => row.kind === "inbox").map((row) => row.id))
  ]);

  return {
    items: rows.map((row) => toListItem(row, { followUps, names, now, people, permissions: input.permissions ?? NO_PERMISSIONS, stats })),
    page,
    pageSize: NOTICES_PAGE_SIZE,
    total
  };
}

/** Um aviso para o editor ou o relatorio; null se nao existe (ou foi excluido). */
export async function getNoticeDetail(id: string, input: { now?: number; permissions?: NoticePermissions } = {}): Promise<NoticeDetail | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }

  const db = communicationsDb();
  const now = input.now ?? Date.now();
  const row = await fetchCampaign(db, id);

  if (!row) {
    return null;
  }

  const permissions = input.permissions ?? NO_PERMISSIONS;
  const [stats, engagement, names, people, sender, followUps] = await Promise.all([
    fetchCampaignStats(db, [row.id]),
    fetchCampaignEngagement(db, [row.id]),
    loadAudienceNames(db, [audienceOfRow(row)]),
    loadPeople(db, [row.created_by, row.requested_by, row.approved_by]),
    row.sender_user_id ? loadSender(db, row.sender_user_id) : Promise.resolve(null),
    row.kind === "inbox" && !row.flow_id ? loadNoticeFollowUps(db, row, permissions) : Promise.resolve({ detail: null, options: null })
  ]);
  const counts = followUps.detail ? new Map([[row.id, { count: followUps.detail.count, sent: followUps.detail.sent }]]) : undefined;
  const item = toListItem(row, { followUps: counts, names, now, people, permissions, stats });
  // approved_at tambem marca quem publicou direto com messaging.publish_large (o envio agendado nao volta
  // para aprovacao); o relatorio so mostra "Aprovado" quando houve pedido.
  const approved = Boolean(row.requested_at && row.approved_at);

  return {
    ...item,
    approvedAt: approved ? row.approved_at : null,
    approvedBy: approved && row.approved_by ? (people.get(row.approved_by) ?? null) : null,
    audienceCountedAt: row.audience_counted_at,
    draft: rowToDraft(row),
    engagement: engagement.get(row.id) ?? EMPTY_CAMPAIGN_ENGAGEMENT,
    flowId: row.flow_id,
    flowNodeId: row.flow_node_id,
    followUpOptions: followUps.options,
    followUps: followUps.detail,
    lastError: row.last_error,
    recipientsCount: row.recipients_count,
    requestedAt: row.requested_at,
    requestedBy: row.requested_by ? (people.get(row.requested_by) ?? null) : null,
    sendAt: row.send_at,
    sender,
    sentAt: row.sent_at
  };
}

/** Quem envia gravado: o nome e a foto que o aluno ve e se ainda esta na equipe (quem saiu envia como a escola). */
async function loadSender(db: CommunicationsDb, userId: string): Promise<NonNullable<NoticeDetail["sender"]>> {
  const [role, profile] = await Promise.all([
    db.from("admin_roles").select("user_id").eq("user_id", userId).maybeSingle(),
    db.from("profiles").select("full_name,avatar_url").eq("id", userId).maybeSingle()
  ]);
  assertNoDbError(role.error, "Comunicacao: quem envia");
  assertNoDbError(profile.error, "Comunicacao: perfil de quem envia");

  const person = profile.data as { avatar_url: string | null; full_name: string | null } | null;

  return {
    avatarUrl: sanitizeProfileAvatarUrl(person?.avatar_url),
    id: userId,
    name: person?.full_name?.trim() || SCHOOL_NAME_FALLBACK_TEAM,
    onTeam: Boolean(role.data)
  };
}

/** Os quatro numeros do topo (Avisos ativos, Vistos, Taxa de clique, Voltaram a estudar) no periodo. */
export async function getCommunicationOverview(period: { end: Date; start: Date }): Promise<CommunicationOverview> {
  const overview = await fetchOverview(communicationsDb(), period.start, period.end);

  return { ...overview, clickRate: rate(overview.clicked, overview.seen) };
}

/* ------------------------------------------------------------------------------------------------
 * Opcoes do editor
 * ---------------------------------------------------------------------------------------------- */

export type NoticeEditorProduct = Pick<ProductOption, "accent" | "coverUrl" | "format" | "id" | "situation" | "title">;

export type NoticeSegmentOption = {
  definition: AudienceDefinition;
  /** Regra escrita do segmento pronto de Alunos (vazio nos salvos). */
  formula: string;
  id: string;
  label: string;
  source: "preset" | "saved";
  /** Partes do segmento de Alunos que nao viram regra ("busca por nome"...). */
  unsupported: string[];
};

/** Pessoa da equipe que pode aparecer em "Quem envia" (o nome e a foto que o aluno ve). */
export type NoticeSenderOption = {
  avatarUrl: string | null;
  id: string;
  /** Quem esta com o editor aberto ("Eu (...)"). */
  isMe: boolean;
  /** profiles.full_name; sem nome, "Equipe Bunker707" (nunca o e-mail). */
  name: string;
  /** "Professor", "Dono"... */
  roleLabel: string;
};

export type NoticeEditorOptions = {
  /** Icone da escola (Marca; o simbolo padrao sem nada configurado), nome e logo para a previa. */
  branding: { iconUrl: string; logoUrl: string | null; name: string };
  /** Quem esta com o editor aberto pode trocar o icone em Area de membros > Marca (storefront.write). */
  canEditBrand: boolean;
  cohorts: { id: string; name: string }[];
  /** Quem esta com o editor aberto (null fora de uma sessao). */
  currentUserId: string | null;
  names: AudienceNames;
  /** Notificacoes enviadas nos ultimos 90 dias: o seletor da regra "O que fez com uma notificação". */
  notices: AudienceNoticeOption[];
  products: NoticeEditorProduct[];
  /** false: a lista de produtos nao carregou agora (o resto do editor funciona). */
  productsLoaded: boolean;
  segments: NoticeSegmentOption[];
  /** Quem pode ser escolhido em "Quem envia": so a equipe (admin_roles), em ordem alfabetica. */
  senders: NoticeSenderOption[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function brandingOf(settings: Record<"branding", PlatformSettingSnapshot>): NoticeEditorOptions["branding"] {
  const value = settings.branding.value;

  return {
    iconUrl: normalizeSchoolIcon(settings.branding.exists && isRecord(value) ? value.schoolIcon : undefined),
    logoUrl: normalizeLogo(value, settings.branding.exists),
    name: SCHOOL_NAME
  };
}

/** Icone, nome e logo da escola para a previa (relatorio sem o resto das opcoes do editor). */
export async function loadNoticeBranding(): Promise<NoticeEditorOptions["branding"]> {
  return brandingOf(await readPlatformSettings(["branding"]));
}

/**
 * A equipe que pode enviar em nome da escola (admin_roles), com o nome e a foto do perfil. Relida pelo
 * editor quando a janela volta ao foco (a pessoa acabou de colocar a foto em Perfil).
 */
export async function loadNoticeSenders(db: CommunicationsDb, currentUserId: string | null): Promise<NoticeSenderOption[]> {
  const { data, error } = await db.from("admin_roles").select("user_id,role").limit(1_000);
  assertNoDbError(error, "Comunicacao: equipe para quem envia");

  const roles = new Map(((data ?? []) as { role: AdminRole; user_id: string }[]).map((row) => [row.user_id, row.role] as const));
  const profiles = new Map<string, { avatar_url: string | null; full_name: string | null }>();

  for (const part of chunksOf(Array.from(roles.keys()), 150)) {
    const result = await db.from("profiles").select("id,full_name,avatar_url").in("id", part);
    assertNoDbError(result.error, "Comunicacao: perfis da equipe");

    for (const row of (result.data ?? []) as { avatar_url: string | null; full_name: string | null; id: string }[]) {
      profiles.set(row.id, row);
    }
  }

  return Array.from(roles, ([id, role]) => {
    const profile = profiles.get(id);

    return {
      avatarUrl: sanitizeProfileAvatarUrl(profile?.avatar_url),
      id,
      isMe: id === currentUserId,
      name: profile?.full_name?.trim() || SCHOOL_NAME_FALLBACK_TEAM,
      roleLabel: ADMIN_ROLE_LABELS[role] ?? ADMIN_ROLE_LABELS.custom
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "pt-BR") || left.id.localeCompare(right.id));
}

/** Quem esta com o editor aberto e se pode mexer na Marca (a sessao ja foi conferida pela pagina). */
async function editorViewer() {
  const user = await getAuthenticatedUser();
  const access = user ? await getAdminAccessForUser(user.id) : null;

  return { canEditBrand: can(access, "storefront.write"), currentUserId: user?.id ?? null };
}

/**
 * Opcoes do editor. `audiences`: os segmentos ja gravados no aviso aberto, para a frase do "Para quem"
 * ter o nome de um produto ou de uma notificacao fora das listas (aviso citado com mais de 90 dias).
 */
export async function loadNoticeEditorOptions(input: { audiences?: readonly AudienceDefinition[] } = {}): Promise<NoticeEditorOptions> {
  const db = communicationsDb();
  const viewer = await editorViewer();
  const [productsResult, cohortsResult, savedSegments, settings, senders, notices] = await Promise.all([
    listProductOptions()
      .then((items) => ({ items, loaded: true }))
      .catch((error: unknown) => {
        console.error("[admin/comunicacao] produtos do editor", error);
        return { items: [] as ProductOption[], loaded: false };
      }),
    db.from("cohorts").select("id,name").order("name", { ascending: true }),
    listSavedSegments().catch((error: unknown) => {
      console.error("[admin/comunicacao] segmentos salvos", error);
      return [];
    }),
    readPlatformSettings(["branding"]),
    loadNoticeSenders(db, viewer.currentUserId),
    loadAudienceNoticeOptions(db).catch((error: unknown) => {
      console.error("[admin/comunicacao] notificacoes enviadas do seletor", error);
      return [] as AudienceNoticeOption[];
    })
  ]);
  assertNoDbError(cohortsResult.error, "Comunicacao: turmas");

  const products = productsResult.items.map((product) => ({
    accent: product.accent,
    coverUrl: product.coverUrl,
    format: product.format,
    id: product.id,
    situation: product.situation,
    title: product.title
  }));
  const cohorts = ((cohortsResult.data ?? []) as { id: string; name: string }[]).map((row) => ({ id: row.id, name: row.name }));
  const segments: NoticeSegmentOption[] = [
    ...STUDENT_SEGMENT_PRESETS.map((preset) => {
      const converted = studentListParamsToAudience(preset.params);

      return { definition: converted.definition, formula: preset.formula, id: `preset:${preset.id}`, label: preset.label, source: "preset" as const, unsupported: converted.unsupported };
    }),
    ...savedSegments.map((segment) => {
      const converted = studentListParamsToAudience(segment.params);

      return { definition: converted.definition, formula: "", id: `saved:${segment.id}`, label: segment.name, source: "saved" as const, unsupported: converted.unsupported };
    })
  ];
  const names: AudienceNames = {
    cohorts: Object.fromEntries(cohorts.map((cohort) => [cohort.id, cohort.name])),
    products: Object.fromEntries(products.map((product) => [product.id, product.title]))
  };

  // Segmentos podem citar produto fora da lista do seletor (curso incluido numa formacao) e aviso fora
  // dos ultimos 90 dias.
  const extra = await loadAudienceNames(db, [...segments.map((segment) => segment.definition), ...(input.audiences ?? [])]);

  return {
    branding: brandingOf(settings),
    canEditBrand: viewer.canEditBrand,
    cohorts,
    currentUserId: viewer.currentUserId,
    names: {
      cohorts: { ...extra.cohorts, ...names.cohorts },
      ...(extra.messages ? { messages: extra.messages } : {}),
      products: { ...extra.products, ...names.products }
    },
    notices,
    products,
    productsLoaded: productsResult.loaded,
    segments,
    senders
  };
}

/* ------------------------------------------------------------------------------------------------
 * Notificacoes seguintes do aviso (v2, docs/23 §2.2): o fluxo de origem "notice" visto do aviso
 * ---------------------------------------------------------------------------------------------- */

/** "Depois desta notificação" no editor e "Notificações seguintes" no relatorio. */
export type NoticeFollowUpsDetail = {
  /** Seguintes vivas (passos de notificacao). */
  count: number;
  endedReason: FlowEndedReason | null;
  /** Entrada do fluxo (a notificacao principal nas regras); null = ainda sem fluxo. */
  entryNodeId: string | null;
  flowId: string | null;
  /** Objetivo do fluxo (a linha "Parar ... para quem tiver acesso a"); null = sem. */
  goal: AudienceDefinition | null;
  /** As seguintes como o cartao desenha; null = so o construtor desenha (condicao, outra base, mais niveis). */
  items: SavedFollowUp[] | null;
  /** Os passos em frases, para o cartao so leitura quando `items` e null. */
  lines: string[];
  /** Editor, no ar ou so leitura (e por que). */
  mode: FollowUpsMode;
  /** Titulos ("node:<passo>") e produtos das regras, para as frases. */
  names: AudienceNames;
  /** Linhas das seguintes que ja chegaram ao sino (sem os testes). */
  sent: number;
  /** Numeros de cada passo (relatorio); vazio enquanto o fluxo e rascunho. */
  stats: Record<string, FollowUpStats>;
  status: FlowStatus | null;
  updatedAt: string | null;
};

/** O fluxo das seguintes do aviso (um so, nao excluido); null = o aviso ainda nao tem seguintes. */
export async function loadNoticeFlow(db: CommunicationsDb, campaignId: string): Promise<LoadedFlowTree | null> {
  const { data, error } = await db
    .from("communication_flows")
    .select("id")
    .eq("source_campaign_id", campaignId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  assertNoDbError(error, "Comunicacao: fluxo do aviso");

  const [flow] = (data ?? []) as { id: string }[];

  return flow ? fetchFlowTree(db, flow.id) : null;
}

/** Conteudo de um passo de notificacao pela versao atual; "with_anchor" vem do passo (expire_with_anchor). */
export function followUpContentOf(node: Pick<FlowNode, "expireWithAnchor">, row: CampaignRow | undefined): FlowNoticeContent {
  const draft = row ? rowToDraft(row) : emptyNoticeDraft("inbox");

  return {
    audio: draft.audio,
    body: draft.body,
    cta: draft.cta,
    icon: draft.icon,
    image: draft.image,
    response: draft.response,
    sender: draft.sender,
    title: draft.title,
    validity: node.expireWithAnchor ? { mode: "with_anchor" } : draft.validity
  };
}

/**
 * Seguintes por aviso na lista (o chip "+2 seguintes" e o "Retirar também ... (n)"): os passos de
 * notificacao vivos de cada fluxo e quantas ja sairam (7.7). Consultas simples: nenhum embed entre
 * campaigns e communication_flows (duas FKs ligam as tabelas).
 */
async function loadFollowUpCounts(db: CommunicationsDb, campaignIds: readonly string[]): Promise<Map<string, { count: number; sent: number }>> {
  const result = new Map<string, { count: number; sent: number }>();
  const flows: { id: string; source_campaign_id: string; status: FlowStatus }[] = [];

  for (const part of chunksOf(Array.from(new Set(campaignIds)), 150)) {
    const { data, error } = await db.from("communication_flows").select("id,source_campaign_id,status").in("source_campaign_id", part).is("deleted_at", null);
    assertNoDbError(error, "Comunicacao: seguintes da lista");
    flows.push(...((data ?? []) as typeof flows));
  }

  if (flows.length === 0) {
    return result;
  }

  const counts = new Map<string, number>();

  for (const part of chunksOf(flows.map((flow) => flow.id), 50)) {
    const { data, error } = await db.from("communication_flow_nodes").select("flow_id").in("flow_id", part).eq("kind", "message").is("removed_at", null);
    assertNoDbError(error, "Comunicacao: passos das seguintes da lista");

    for (const row of (data ?? []) as { flow_id: string }[]) {
      counts.set(row.flow_id, (counts.get(row.flow_id) ?? 0) + 1);
    }
  }

  const live = flows.filter((flow) => flow.status !== "draft" && flow.status !== "pending_approval").map((flow) => flow.id);
  const stats = live.length > 0 ? await fetchFlowStats(db, live, new Date(0)) : new Map<string, { sent: number }>();

  for (const flow of flows) {
    result.set(flow.source_campaign_id, { count: counts.get(flow.id) ?? 0, sent: stats.get(flow.id)?.sent ?? 0 });
  }

  return result;
}

const FOLLOW_UP_STAT_FIELDS = [
  "accepted",
  "audio_completed",
  "audio_started",
  "cap",
  "clicked",
  "declined",
  "expired",
  "filtered",
  "goal",
  "opened",
  "reached",
  "received",
  "removed",
  "seen",
  "waiting"
] as const satisfies readonly (keyof FollowUpStats)[];

/**
 * As seguintes do aviso para o editor e o relatorio: a arvore como o cartao desenha (ou as frases, quando so
 * o construtor desenha), o objetivo, os numeros de cada passo e a situacao (editor, no ar ou so leitura).
 * No ar, as opcoes do editor vem junto (a folha da seguinte usa os mesmos campos do aviso).
 */
async function loadNoticeFollowUps(
  db: CommunicationsDb,
  row: CampaignRow,
  permissions: NoticePermissions
): Promise<{ detail: NoticeFollowUpsDetail; options: NoticeEditorOptions | null }> {
  const loaded = await loadNoticeFlow(db, row.id);
  const recipients = row.recipients_count ?? row.audience_count;
  const sentNotice = row.status === "sending" || row.status === "sent";
  const modeFor = (input: { drawable: boolean; flowEndedReason: FlowEndedReason | null; flowStatus: FlowStatus | null }) =>
    followUpsModeOf({ ...input, canPublish: permissions.canPublish, canPublishLarge: permissions.canPublishLarge, noticeStatus: row.status, recipients });

  if (!loaded) {
    let mode = modeFor({ drawable: true, flowEndedReason: null, flowStatus: null });

    // Depois do envio sem seguintes: todas as linhas ja sairam do sino = nada a acrescentar.
    if (mode.kind === "live" && sentNotice) {
      const last = await lastSourceExpiry(db, row.id);

      if (last === null || last <= Date.now()) {
        mode = modeFor({ drawable: true, flowEndedReason: "finished", flowStatus: "ended" });
      }
    }

    return {
      detail: {
        count: 0,
        endedReason: null,
        entryNodeId: null,
        flowId: null,
        goal: null,
        items: [],
        lines: [],
        mode,
        names: { cohorts: {}, products: {} },
        sent: 0,
        stats: {},
        status: null,
        updatedAt: null
      },
      options: mode.kind === "live" ? await loadNoticeEditorOptions({ audiences: [audienceOfRow(row)] }) : null
    };
  }

  const { flow, tree } = loaded;
  const entry = entryOf(tree);
  const drawn = followUpsFromTree(tree);
  const messageNodes = tree.nodes.filter((node) => node.kind === "message");
  const versions = new Map((await fetchCampaignsByIds(db, messageNodes.map((node) => node.campaignId ?? "").filter(Boolean))).map((version) => [version.id, version]));
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));
  const contentOfNode = (nodeId: string) => {
    const node = byId.get(nodeId);

    return followUpContentOf(node ?? { expireWithAnchor: false }, versions.get(node?.campaignId ?? ""));
  };
  const toSaved = (followUp: FollowUp): SavedFollowUp => ({
    campaignId: followUp.campaignId,
    children: followUp.children.map(toSaved),
    content: contentOfNode(followUp.id),
    id: followUp.id,
    when: followUp.when,
    who: followUp.who
  });
  const goal = definitionOf(flow.goal);
  const live = flow.status !== "draft" && flow.status !== "pending_approval";
  const ctaKeys = Object.fromEntries(messageNodes.map((node) => [node.id, pageKeyOfHref(versions.get(node.campaignId ?? "")?.cta_href ?? null)]));
  const definitions = [...messageNodes.map((node) => node.filter), ...tree.nodes.map((node) => node.condition), goal].filter((item): item is AudienceDefinition => Boolean(item));
  const [nodeStats, ruleNames] = await Promise.all([live ? fetchFlowNodeStats(db, flow.id, ctaKeys) : Promise.resolve(new Map()), loadAudienceNames(db, definitions)]);
  const titles: Record<string, string> = { ...(entry ? { [messageRefKey({ kind: "node", nodeId: entry.id })]: row.title } : {}) };

  for (const node of messageNodes) {
    titles[messageRefKey({ kind: "node", nodeId: node.id })] = contentOfNode(node.id).title.trim() || "Sem título";
  }

  const names: AudienceNames = { ...ruleNames, messages: { ...ruleNames.messages, ...titles } };
  const stats: Record<string, FollowUpStats> = {};
  let sent = 0;

  for (const node of messageNodes) {
    const values = nodeStats.get(node.id);

    if (values) {
      stats[node.id] = Object.fromEntries(FOLLOW_UP_STAT_FIELDS.map((field) => [field, values[field] ?? 0])) as FollowUpStats;
      sent += values.received ?? 0;
    }
  }

  const lines = drawn
    ? []
    : tree.nodes
        .filter((node) => node.kind !== "entry")
        .map((node) =>
          node.kind === "message"
            ? `Notificação “${titles[messageRefKey({ kind: "node", nodeId: node.id })]}”`
            : `Condição: ${describeAudience(node.condition ?? { kind: "everyone" }, names)}`
        );
  const mode = modeFor({ drawable: drawn !== null, flowEndedReason: flow.ended_reason, flowStatus: flow.status });

  return {
    detail: {
      count: messageNodes.length,
      endedReason: flow.ended_reason,
      entryNodeId: entry?.id ?? null,
      flowId: flow.id,
      goal,
      items: drawn ? drawn.map(toSaved) : null,
      lines,
      mode,
      names,
      sent,
      stats,
      status: flow.status,
      updatedAt: flow.updated_at
    },
    options: mode.kind === "live" ? await loadNoticeEditorOptions({ audiences: [audienceOfRow(row), ...definitions] }) : null
  };
}
