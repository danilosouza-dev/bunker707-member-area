import "server-only";

// Leituras de Comunicacao > Avisos e pop-ups (docs/22 §3; docs/17 §1.8): lista com os numeros de cada
// aviso, detalhe para o editor e o relatorio, os quatro numeros do topo e as opcoes do editor (produtos,
// turmas, segmentos de Alunos, marca para a previa). Chamadas pelas paginas do admin depois de
// requirePageArea("comunicacao"); banco sem a migracao 202610200001 -> PendingMigrationError (a pagina
// mostra o aviso da migracao).
//
// v3b-2 (docs/29 §6.5): o relatorio do pop-up (getPopupReport: a RPC communication_popup_report e os nomes dos
// produtos citados, com cache de 60 s) e os produtos do "No primeiro acesso" nos nomes de "Detalhes".

import { unstable_cache } from "next/cache";
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
  noticeRecipients,
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
import { COMMUNICATIONS_TAG } from "./cache";
import { assertNoDbError, chunksOf, communicationsDb, describeError, isMissingCommunicationSchema, type CommunicationsDb } from "./db";
import { entryOf, followUpsFromTree, type FlowEndedReason, type FlowNode, type FlowStatus, type FollowUp } from "./flow-model";
import type { FlowNoticeContent } from "./flow-schemas";
import { definitionOf, fetchFlowNodeStats, fetchFlowTree, lastSourceExpiry, type LoadedFlowTree } from "./flow-store";
import { parsePoll, type PollOption } from "./interactions-model";
import { noticeIconOfColumns, normalizeSchoolIcon, SCHOOL_NAME_FALLBACK_TEAM, type NoticeIconColor, type NoticeIconId } from "./message-meta";
import { popupSettingsOfRow } from "./popup-display-model";
import type { PopupFontFace, PopupFontOption } from "./popup-design-model";
import { listPopupFontLibrary, loadPopupFontFaces } from "./popup-fonts";
import { buildPopupReport, popupReportProductIds, readPopupReportRows, type PopupReportView } from "./popup-report-model";
import { describePopupPlacementShort } from "./popup-sentences";
import { emptyNoticeDraft, type NoticeDraft } from "./schemas";
import {
  audienceOfRow,
  EMPTY_CAMPAIGN_ENGAGEMENT,
  EMPTY_CAMPAIGN_STATS,
  emptyMessageInteractions,
  fetchCampaign,
  fetchCampaignEngagement,
  fetchCampaignStats,
  fetchCampaignsByIds,
  fetchMessageInteractions,
  fetchNoticeCitations,
  fetchOverview,
  fetchPopupReport,
  listCampaignRows,
  reshowPopupDeliveries,
  rowToDraft,
  type CampaignEngagement,
  type CampaignRow,
  type CampaignStats,
  type MessageInteractions,
  type NoticeCitations
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
  /**
   * v3a: quantos avisos e fluxos citam a notificacao enviada nas regras (os dialogos de Excluir e Retirar do
   * sino avisam; nunca impedem); null para o que nao e notificacao enviada.
   */
  citations: NoticeCitations | null;
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
  /**
   * v3b-1: a segunda linha da coluna "Quando" do pop-up ("Em qualquer página (com exceções)", "Ao concluir
   * uma aula"); null quando e o padrao (so no Inicio, ao abrir, 3 s) e na notificacao.
   */
  placementLabel: string | null;
  /** v3b-1: "Quantas vezes" do pop-up (o aviso de "Mostrar de novo" muda com ele); null na notificacao. */
  popupMode: "once" | "repeat" | null;
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
  /**
   * Design do pop-up (docs/26): as fontes enviadas que o design usa, resolvidas aqui (a previa do relatorio e
   * do editor desenha com elas); [] no Padrão, sem fonte enviada ou se a leitura falhar.
   */
  designFonts: PopupFontFace[];
  draft: NoticeDraft;
  /** v3a: a ultima edicao de uma notificacao enviada ou de um pop-up no ar ou pausado (linha "Editado"). */
  editedAt: string | null;
  editedBy: NoticePerson | null;
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
  /**
   * v3a: reacoes, votos, excluidas do sino e mudancas de resposta da notificacao (sem os testes da equipe);
   * vazio para o pop-up e para o que ainda nao saiu.
   */
  interactions: MessageInteractions;
  lastError: string | null;
  /** v3b-1: nomes dos produtos citados nas paginas e excecoes do pop-up (as frases de "Detalhes"); {} sem nenhum. */
  popupNames: Record<string, string>;
  recipientsCount: number | null;
  requestedAt: string | null;
  /**
   * Pop-up no ar ou pausado: quantos voltam a contar como novo com "Mostrar de novo para quem já viu" (o switch
   * do editor). v3b-1: em qualquer "Quantas vezes": ainda no segmento, viram mais vezes do que adiaram e nao
   * escolheram "Não mostrar de novo" nem clicaram (quem clicou conta so no pop-up que para so quando termina);
   * null nos outros casos.
   */
  reshowable: number | null;
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

/**
 * Titulo de cada aviso citado, pela chave da regra ("campaign:<id>"); aviso excluido fica sem titulo.
 * v3a: tambem o texto de cada opcao da enquete (regra "votou em “X”"), so dos avisos com enquete.
 */
async function selectNoticeTitles(db: CommunicationsDb, ids: readonly string[]) {
  const titles: Record<string, string> = {};
  const pollOptions: Record<string, Record<string, string>> = {};
  const valid = Array.from(new Set(ids)).filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));

  for (const part of chunksOf(valid, 150)) {
    const { data, error } = await db.from("campaigns").select("id,title,poll").in("id", part).is("deleted_at", null);
    assertNoDbError(error, "Comunicacao: nomes (avisos)");

    for (const row of (data ?? []) as { id: string; poll: unknown; title: string | null }[]) {
      const key = messageRefKey({ campaignId: row.id, kind: "campaign" });
      const title = row.title?.trim();
      const poll = parsePoll(row.poll);

      if (title) {
        titles[key] = title;
      }

      if (poll) {
        pollOptions[key] = Object.fromEntries(poll.options.map((option) => [option.id, option.label]));
      }
    }
  }

  return { pollOptions, titles };
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
 * padrao da frase). `messages` so vem quando alguma regra cita um aviso; `pollOptions` (v3a), quando
 * algum aviso citado tem enquete.
 */
export async function loadAudienceNames(db: CommunicationsDb, definitions: readonly AudienceDefinition[]): Promise<AudienceNames> {
  const products = new Set<string>();
  const cohorts = new Set<string>();
  const campaigns = new Set<string>();
  definitions.forEach((definition) => collectIds(definition, products, cohorts, campaigns));

  const [productNames, cohortNames, notices] = await Promise.all([
    selectNames(db, "content_items", "title", Array.from(products)),
    selectNames(db, "cohorts", "name", Array.from(cohorts).filter((id) => /^[0-9a-f-]{36}$/i.test(id))),
    campaigns.size > 0 ? selectNoticeTitles(db, Array.from(campaigns)) : Promise.resolve(null)
  ]);

  if (!notices) {
    return { cohorts: cohortNames, products: productNames };
  }

  return Object.keys(notices.pollOptions).length > 0
    ? { cohorts: cohortNames, messages: notices.titles, pollOptions: notices.pollOptions, products: productNames }
    : { cohorts: cohortNames, messages: notices.titles, products: productNames };
}

/** Aviso enviado que o segmento pode citar em "O que fez com uma notificação" (o seletor do construtor). */
export type AudienceNoticeOption = {
  /** v3a: aceita reacoes (a regra oferece "reagiu"). */
  allowsReactions: boolean;
  /** Ha o que abrir ("Ver mais", audio, destino, resposta ou enquete); sem isso, nada de "abriu" na regra. */
  canOpen: boolean;
  hasAudio: boolean;
  hasCta: boolean;
  /** v3a: tem enquete (a regra oferece "votou na enquete"). */
  hasPoll: boolean;
  hasResponse: boolean;
  id: string;
  /** v3a: as opcoes da enquete, na ordem (vazio sem enquete). */
  pollOptions: PollOption[];
  sentAt: string;
  title: string;
};

/** Quantos avisos o seletor mostra (os mais recentes primeiro). */
export const AUDIENCE_NOTICE_OPTIONS_LIMIT = 200;
const AUDIENCE_NOTICE_DAYS = 90;

/**
 * Notificacoes enviadas nos ultimos 90 dias (fora as dos fluxos), mais recentes primeiro: o seletor da
 * regra "O que fez com uma notificação" no segmento (docs/23 §7). O que cada uma tem (audio, destino,
 * resposta e, v3a, reacoes e enquete) decide as acoes oferecidas.
 */
export async function loadAudienceNoticeOptions(db: CommunicationsDb, now = Date.now()): Promise<AudienceNoticeOption[]> {
  const since = new Date(now - AUDIENCE_NOTICE_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("campaigns")
    .select("id,title,body,sent_at,audio_url,cta_href,response_mode,allow_reactions,poll")
    .eq("kind", "inbox")
    .eq("status", "sent")
    .is("flow_id", null)
    .is("deleted_at", null)
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .order("id")
    .limit(AUDIENCE_NOTICE_OPTIONS_LIMIT);
  assertNoDbError(error, "Comunicacao: notificacoes enviadas");

  type Row = {
    allow_reactions: boolean | null;
    audio_url: string | null;
    body: string | null;
    cta_href: string | null;
    id: string;
    poll: unknown;
    response_mode: string | null;
    sent_at: string;
    title: string | null;
  };

  return ((data ?? []) as Row[]).map((row) => {
    const hasAudio = Boolean(row.audio_url);
    const hasCta = Boolean(row.cta_href);
    const hasResponse = row.response_mode === "accept_decline";
    const poll = parsePoll(row.poll);

    return {
      allowsReactions: row.allow_reactions === true,
      // Aviso curto so de texto aparece inteiro no sino: nao ha o que abrir (docs/23 V7). Enquete conta
      // (votar abre); reacao nao (docs/24 T15).
      canOpen: hasAudio || hasCta || hasResponse || poll !== null || shouldClampNotificationBody(row.body ?? ""),
      hasAudio,
      hasCta,
      hasPoll: poll !== null,
      hasResponse,
      id: row.id,
      pollOptions: poll?.options ?? [],
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
    citations?: ReadonlyMap<string, NoticeCitations>;
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
  const sentNotice = row.kind === "inbox" && row.status === "sent";
  const popupSettings = row.kind === "popup" ? popupSettingsOfRow(row) : null;

  return {
    // v3a: o menu sabe quantos a notificacao alcancou (Editar a enviada acima de 500 so com
    // messaging.publish_large), a mesma conta do servidor. v3b-1: Mostrar de novo em qualquer "Quantas vezes".
    actions: availableNoticeActions(timing, input.now, input.permissions, { popupRepeat: row.popup_repeat, recipients: noticeRecipients(row) }),
    audienceCount: row.audience_count,
    audienceDescription: describeAudience(audienceOfRow(row), input.names),
    citations: sentNotice ? (input.citations?.get(row.id) ?? { flows: 0, notices: 0 }) : null,
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
    placementLabel: popupSettings ? describePopupPlacementShort(popupSettings) : null,
    popupMode: popupSettings ? popupSettings.frequency.mode : null,
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

/** v3a: notificacoes enviadas da lista (as que podem ser citadas pelas regras de outros avisos e fluxos). */
function sentNoticeIds(rows: readonly CampaignRow[]) {
  return rows.filter((row) => row.kind === "inbox" && row.status === "sent").map((row) => row.id);
}

/** Lista da equipe, 20 por pagina, mais novos primeiro, com os numeros de cada aviso. */
export async function listNotices(input: { kind?: CampaignKind; now?: number; page?: number; permissions?: NoticePermissions }): Promise<NoticesPage> {
  const db = communicationsDb();
  const now = input.now ?? Date.now();
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const { rows, total } = await listCampaignRows(db, { kind: input.kind, page, pageSize: NOTICES_PAGE_SIZE });
  // v3a: as regras que citam cada notificacao enviada, uma ida so por pagina (nenhuma sem enviada).
  const [stats, names, people, followUps, citations] = await Promise.all([
    fetchCampaignStats(db, rows.map((row) => row.id)),
    loadAudienceNames(db, rows.map(audienceOfRow)),
    loadPeople(db, rows.map((row) => row.created_by)),
    loadFollowUpCounts(db, rows.filter((row) => row.kind === "inbox").map((row) => row.id)),
    fetchNoticeCitations(db, sentNoticeIds(rows))
  ]);

  return {
    items: rows.map((row) => toListItem(row, { citations, followUps, names, now, people, permissions: input.permissions ?? NO_PERMISSIONS, stats })),
    page,
    pageSize: NOTICES_PAGE_SIZE,
    total
  };
}

/**
 * Pop-up publicado ou pausado: quantos o "Mostrar de novo para quem já viu" alcanca agora (docs/24 §2.4; v3b-1,
 * docs/25 §4.7: a mesma contagem do RPC, certa em qualquer "Quantas vezes"); null nos outros casos.
 */
async function reshowableOf(db: CommunicationsDb, row: CampaignRow, now: number) {
  if (row.kind !== "popup" || (row.status !== "active" && row.status !== "paused")) {
    return null;
  }

  return (await reshowPopupDeliveries(db, { apply: false, campaignId: row.id, max: null, now: new Date(now) }))?.count ?? null;
}

/**
 * v3b-1: produtos citados nas paginas e excecoes do pop-up (content:<id> e lesson:<id>; curingas nao contam).
 * v3b-2: tambem os produtos do "No primeiro acesso" (os nomes de "Detalhes" e da frase).
 */
function popupProductIds(row: CampaignRow) {
  if (row.kind !== "popup") {
    return [];
  }

  const settings = popupSettingsOfRow(row);
  const ids = new Set<string>(settings.accessProducts ?? []);

  for (const pattern of [...settings.pages, ...settings.exclude]) {
    const id = /^(?:content|lesson):(.+)$/.exec(pattern)?.[1];

    if (id && id !== "*") {
      ids.add(id);
    }
  }

  return Array.from(ids);
}

/**
 * O rascunho de um aviso gravado (editor, relatorio, publicar, aprovar e duplicar). v3b-1: o "Até o aluno
 * clicar" gravado antes da migracao 202610220003 (popup_frequency nulo) num pop-up sem botao nunca parou por
 * clique, porque ninguem clica; abre como "Só quando o pop-up terminar", o mesmo para o aluno, em vez de uma
 * recusa no campo "Para de aparecer" que ninguem escolheu.
 */
export function noticeDraftOfRow(row: CampaignRow): NoticeDraft {
  const draft = rowToDraft(row);
  const frequency = draft.popup?.frequency;

  if (row.kind !== "popup" || row.popup_frequency !== null || draft.cta || !draft.popup || frequency?.mode !== "repeat" || frequency.stopOn !== "click") {
    return draft;
  }

  return { ...draft, popup: { ...draft.popup, frequency: { ...frequency, stopOn: "never" } } };
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
  // v3a: reacoes, votos e excluidas so existem nas linhas dos alunos (notificacao que saiu).
  const hasStudentRows = row.kind === "inbox" && !row.flow_id && (row.status === "sending" || row.status === "sent" || row.status === "canceled");
  const popupProducts = popupProductIds(row);
  const draft = noticeDraftOfRow(row);
  // Livre (docs/27): as fontes do que estiver no rascunho (Livre ou Personalizado).
  const designFontIds = (draft.freeDesign ?? draft.design)?.fonts ?? [];
  const [stats, engagement, names, people, sender, followUps, interactions, citations, reshowable, popupNames, designFonts] = await Promise.all([
    fetchCampaignStats(db, [row.id]),
    fetchCampaignEngagement(db, [row.id]),
    loadAudienceNames(db, [audienceOfRow(row)]),
    loadPeople(db, [row.created_by, row.requested_by, row.approved_by, row.edited_by]),
    row.sender_user_id ? loadSender(db, row.sender_user_id) : Promise.resolve(null),
    row.kind === "inbox" && !row.flow_id ? loadNoticeFollowUps(db, row, permissions) : Promise.resolve({ detail: null, options: null }),
    hasStudentRows ? fetchMessageInteractions(db, { campaignIds: [row.id] }) : Promise.resolve(new Map<string, MessageInteractions>()),
    row.flow_id ? Promise.resolve(new Map<string, NoticeCitations>()) : fetchNoticeCitations(db, sentNoticeIds([row])),
    row.flow_id ? Promise.resolve(null) : reshowableOf(db, row, now),
    // v3b-1: os nomes das frases de "Detalhes" (uma leitura, so quando o pop-up cita produtos).
    popupProducts.length > 0 ? selectNames(db, "content_items", "title", popupProducts) : Promise.resolve({} as Record<string, string>),
    // Design do pop-up (docs/26): uma leitura, so quando o design usa fonte enviada; falha = a pilha do sistema.
    designFontIds.length > 0
      ? loadPopupFontFaces(db, designFontIds).catch((error: unknown) => {
          console.error("[admin/comunicacao] fontes do design", error);
          return [] as PopupFontFace[];
        })
      : Promise.resolve([] as PopupFontFace[])
  ]);
  const counts = followUps.detail ? new Map([[row.id, { count: followUps.detail.count, sent: followUps.detail.sent }]]) : undefined;
  const item = toListItem(row, { citations, followUps: counts, names, now, people, permissions, stats });
  // approved_at tambem marca quem publicou direto com messaging.publish_large (o envio agendado nao volta
  // para aprovacao); o relatorio so mostra "Aprovado" quando houve pedido.
  const approved = Boolean(row.requested_at && row.approved_at);

  return {
    ...item,
    approvedAt: approved ? row.approved_at : null,
    approvedBy: approved && row.approved_by ? (people.get(row.approved_by) ?? null) : null,
    audienceCountedAt: row.audience_counted_at,
    designFonts,
    draft,
    editedAt: row.edited_at,
    editedBy: row.edited_by ? (people.get(row.edited_by) ?? null) : null,
    engagement: engagement.get(row.id) ?? EMPTY_CAMPAIGN_ENGAGEMENT,
    flowId: row.flow_id,
    flowNodeId: row.flow_node_id,
    followUpOptions: followUps.options,
    followUps: followUps.detail,
    interactions: interactions.get(row.id) ?? emptyMessageInteractions(),
    lastError: row.last_error,
    popupNames,
    recipientsCount: row.recipients_count,
    requestedAt: row.requested_at,
    requestedBy: row.requested_by ? (people.get(row.requested_by) ?? null) : null,
    reshowable,
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

/* ------------------------------------------------------------------------------------------------
 * Relatorio do pop-up (v3b-2, docs/29 §6.5)
 * ---------------------------------------------------------------------------------------------- */

export type PopupReportResult = { status: "error" } | { status: "pending_migration" } | { status: "ok"; view: PopupReportView };

/** Duas leituras: a RPC (so service_role) e, quando o relatorio cita produtos, os nomes deles. */
async function loadPopupReport(campaignId: string): Promise<PopupReportView> {
  const db = communicationsDb();
  const rows = readPopupReportRows(await fetchPopupReport(db, campaignId));
  const productIds = popupReportProductIds(rows);
  const names = productIds.length > 0 ? await selectNames(db, "content_items", "title", productIds) : {};

  return buildPopupReport(rows, names);
}

// Cache de 60 s (tag "communications": toda acao de aviso invalida); so o resultado certo entra (o erro sobe e
// nao fica guardado). O id entra pelos argumentos da chamada.
const cachedPopupReport = unstable_cache(loadPopupReport, ["communications-popup-report", "v3b2"], {
  revalidate: 60,
  tags: [COMMUNICATIONS_TAG]
});

/** Relatorio de um pop-up (cache de 60 s, tag communications): duas leituras, a RPC e os nomes dos produtos citados. */
export async function getPopupReport(campaignId: string): Promise<PopupReportResult> {
  try {
    return { status: "ok", view: await cachedPopupReport(campaignId) };
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      return { status: "pending_migration" };
    }

    console.error("[admin/comunicacao] relatorio do pop-up", describeError(error));
    return { status: "error" };
  }
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
  /**
   * v3b-1: produtos que abrem direto na primeira aula (coursePresentationMode "lesson_playlist"): a frase do
   * card "Quando e onde aparece" avisa quando um deles esta so em "Página do produto".
   */
  opensOnLesson: string[];
  products: NoticeEditorProduct[];
  /**
   * Design do pop-up (docs/26): a biblioteca de fontes enviadas (nao excluidas, por nome) para o seletor e a
   * previa; [] sem a migracao 202610230001 ou se a leitura falhar (o resto do editor funciona).
   */
  popupFonts: PopupFontOption[];
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

/**
 * v3b-1: produtos que abrem direto na primeira aula (content_page_settings.settings.coursePresentationMode =
 * "lesson_playlist", o redirect de /conteudo/[id]): neles so "Páginas de aula" vale, e a frase do card
 * "Quando e onde aparece" avisa quando um deles esta so em "Página do produto".
 */
async function loadOpensOnLesson(db: CommunicationsDb): Promise<string[]> {
  const { data, error } = await db.from("content_page_settings").select("content_id").eq("settings->>coursePresentationMode", "lesson_playlist");
  assertNoDbError(error, "Comunicacao: produtos que abrem direto na aula");

  return ((data ?? []) as { content_id: string }[]).map((row) => row.content_id).sort();
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
  const [productsResult, cohortsResult, savedSegments, settings, senders, notices, opensOnLesson, popupFonts] = await Promise.all([
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
    }),
    // So o aviso da frase depende disto: uma falha nao tira o editor do ar.
    loadOpensOnLesson(db).catch((error: unknown) => {
      console.error("[admin/comunicacao] produtos que abrem direto na aula", error);
      return [] as string[];
    }),
    // Design do pop-up (docs/26): so o seletor de fontes depende disto.
    listPopupFontLibrary(db).catch((error: unknown) => {
      console.error("[admin/comunicacao] biblioteca de fontes", error);
      return [] as PopupFontOption[];
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
      // v3a: as opcoes das enquetes citadas ("votaram em “Sábado” na enquete …").
      ...(extra.pollOptions ? { pollOptions: extra.pollOptions } : {}),
      products: { ...extra.products, ...names.products }
    },
    notices,
    opensOnLesson,
    popupFonts,
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
    // Ajustes da v3a: a lixeira do passo (sem ela, salvar de novo voltaria a permitir excluir).
    allowHide: draft.allowHide ?? true,
    audio: draft.audio,
    body: draft.body,
    cta: draft.cta,
    icon: draft.icon,
    image: draft.image,
    // v3a: a enquete e as reacoes do passo (sem elas, salvar de novo criaria uma versao sem enquete).
    poll: draft.poll ?? null,
    reactions: draft.reactions ?? false,
    response: draft.response,
    sender: draft.sender,
    title: draft.title,
    validity: node.expireWithAnchor ? { mode: "with_anchor" } : draft.validity
  };
}

/** A arvore do cartao (followUpsFromTree) com o conteudo atual de cada passo, pela versao gravada. */
function savedFollowUpsOf(tree: LoadedFlowTree["tree"], drawn: readonly FollowUp[], versions: ReadonlyMap<string, CampaignRow>): SavedFollowUp[] {
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

  return drawn.map(toSaved);
}

/**
 * As seguintes do aviso como o cartao desenha, para guardar num modelo (docs/28 D7; saveTemplateFromNotice): a parte
 * de loadNoticeFollowUps que monta os itens, sem numeros nem modo. null = o aviso nao tem fluxo (ou nao e notificacao);
 * `items` null = so o construtor desenha a arvore (condicao, outra base, mais niveis). O objetivo vem como esta
 * gravado (o "other" do construtor e decidido por quem chama).
 */
export async function loadNoticeFollowUpDrafts(
  db: CommunicationsDb,
  row: CampaignRow
): Promise<{ entryId: string; goal: AudienceDefinition | null; items: SavedFollowUp[] | null } | null> {
  if (row.kind !== "inbox" || row.flow_id) {
    return null;
  }

  const loaded = await loadNoticeFlow(db, row.id);
  const entry = loaded ? entryOf(loaded.tree) : null;

  if (!loaded || !entry) {
    return null;
  }

  const goal = definitionOf(loaded.flow.goal);
  const drawn = followUpsFromTree(loaded.tree);

  if (!drawn) {
    return { entryId: entry.id, goal, items: null };
  }

  const messageNodes = loaded.tree.nodes.filter((node) => node.kind === "message");
  const versions = new Map((await fetchCampaignsByIds(db, messageNodes.map((node) => node.campaignId ?? "").filter(Boolean))).map((version) => [version.id, version]));

  return { entryId: entry.id, goal, items: savedFollowUpsOf(loaded.tree, drawn, versions) };
}

/**
 * Linhas das seguintes no sino (sem os testes): exatamente o que "Retirar também as notificações seguintes
 * que já saíram (n)" apaga (withdrawNotice), inclusive as de um passo removido depois de sair.
 */
async function countFollowUpRows(db: CommunicationsDb, flowId: string): Promise<number> {
  const { count, error } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("flow_id", flowId).eq("is_test", false);
  assertNoDbError(error, "Comunicacao: linhas das seguintes");

  return count ?? 0;
}

/**
 * Seguintes por aviso na lista (o chip "+2 seguintes" e o "Retirar também ... (n)"): os passos de
 * notificacao vivos de cada fluxo e quantas linhas ja chegaram ao sino. Consultas simples: nenhum embed
 * entre campaigns e communication_flows (duas FKs ligam as tabelas).
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
  const rows = new Map(await Promise.all(live.map(async (flowId) => [flowId, await countFollowUpRows(db, flowId)] as const)));

  for (const flow of flows) {
    result.set(flow.source_campaign_id, { count: counts.get(flow.id) ?? 0, sent: rows.get(flow.id) ?? 0 });
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
  "failed",
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
  // O maior dos dois (a mesma conta de saveNoticeFollowUps): num envio cortado, recipients_count e parcial.
  const recipients = row.recipients_count === null && row.audience_count === null ? null : Math.max(row.recipients_count ?? 0, row.audience_count ?? 0);
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
  const goal = definitionOf(flow.goal);
  const live = flow.status !== "draft" && flow.status !== "pending_approval";
  const ctaKeys = Object.fromEntries(messageNodes.map((node) => [node.id, pageKeyOfHref(versions.get(node.campaignId ?? "")?.cta_href ?? null)]));
  const definitions = [...messageNodes.map((node) => node.filter), ...tree.nodes.map((node) => node.condition), goal].filter((item): item is AudienceDefinition => Boolean(item));
  // v3a: reagiram e votaram de cada seguinte (as linhas "Reagiram" e "Votaram" do cartao no relatorio).
  const [nodeStats, ruleNames, sent, interactions] = await Promise.all([
    live ? fetchFlowNodeStats(db, flow.id, ctaKeys) : Promise.resolve(new Map()),
    loadAudienceNames(db, definitions),
    live ? countFollowUpRows(db, flow.id) : Promise.resolve(0),
    live ? fetchMessageInteractions(db, { flowId: flow.id }) : Promise.resolve(new Map<string, MessageInteractions>())
  ]);
  const titles: Record<string, string> = { ...(entry ? { [messageRefKey({ kind: "node", nodeId: entry.id })]: row.title } : {}) };

  // v3a: as opcoes das enquetes da principal e das seguintes ("votaram em “Sábado” na enquete …").
  const polls: Record<string, Record<string, string>> = {};
  const addPoll = (nodeId: string, poll: { options: readonly PollOption[] } | null | undefined) => {
    if (poll) {
      polls[messageRefKey({ kind: "node", nodeId })] = Object.fromEntries(poll.options.map((option) => [option.id, option.label]));
    }
  };

  if (entry) {
    addPoll(entry.id, parsePoll(row.poll));
  }

  for (const node of messageNodes) {
    titles[messageRefKey({ kind: "node", nodeId: node.id })] = contentOfNode(node.id).title.trim() || "Sem título";
    addPoll(node.id, contentOfNode(node.id).poll);
  }

  const names: AudienceNames = {
    ...ruleNames,
    messages: { ...ruleNames.messages, ...titles },
    ...(Object.keys(polls).length > 0 ? { pollOptions: { ...ruleNames.pollOptions, ...polls } } : {})
  };
  const stats: Record<string, FollowUpStats> = {};

  for (const node of messageNodes) {
    const values = nodeStats.get(node.id);

    if (values) {
      const interaction = interactions.get(node.id);
      stats[node.id] = {
        ...(Object.fromEntries(FOLLOW_UP_STAT_FIELDS.map((field) => [field, values[field] ?? 0])) as FollowUpStats),
        reacted: interaction?.reacted ?? 0,
        voted: interaction?.pollVoters ?? 0
      };
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
      items: drawn ? savedFollowUpsOf(tree, drawn, versions) : null,
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
