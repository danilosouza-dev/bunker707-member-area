import "server-only";

// Leituras de Comunicacao > Avisos e pop-ups (docs/22 §3; docs/17 §1.8): lista com os numeros de cada
// aviso, detalhe para o editor e o relatorio, os quatro numeros do topo e as opcoes do editor (produtos,
// turmas, segmentos de Alunos, marca para a previa). Chamadas pelas paginas do admin depois de
// requirePageArea("comunicacao"); banco sem a migracao 202610200001 -> PendingMigrationError (a pagina
// mostra o aviso da migracao).

import { listProductOptions } from "@/server/catalog/queries";
import type { ProductOption } from "@/server/catalog/types";
import { readPlatformSettings } from "@/server/member-area/settings-store";
import { normalizeLogo } from "@/server/storefront/model";
import { STUDENT_SEGMENT_PRESETS } from "@/server/students/model";
import { listSavedSegments } from "@/server/students/queries";
import {
  describeAudience,
  isAudienceGroup,
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
import type { NoticeDraft } from "./schemas";
import {
  audienceOfRow,
  EMPTY_CAMPAIGN_STATS,
  fetchCampaign,
  fetchCampaignStats,
  fetchOverview,
  listCampaignRows,
  rowToDraft,
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
  lastError: string | null;
  recipientsCount: number | null;
  requestedAt: string | null;
  requestedBy: NoticePerson | null;
  sendAt: string | null;
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

function collectIds(definition: AudienceDefinition, products: Set<string>, cohorts: Set<string>) {
  const visit = (node: AudienceNode) => {
    if (isAudienceGroup(node)) {
      node.items.forEach(visit);
      return;
    }

    if (node.type === "product") {
      node.productIds.forEach((id) => products.add(id));
    } else if (node.type === "cohort") {
      node.cohortIds.forEach((id) => cohorts.add(id));
    } else if ((node.type === "progress" || node.type === "access_age" || node.type === "access_ending") && node.productId) {
      products.add(node.productId);
    }
  };

  if (definition.kind === "rules") {
    visit(definition.root);
  }
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

/** Nomes dos produtos e turmas citados nos segmentos (produto removido cai no texto padrao da frase). */
export async function loadAudienceNames(db: CommunicationsDb, definitions: readonly AudienceDefinition[]): Promise<AudienceNames> {
  const products = new Set<string>();
  const cohorts = new Set<string>();
  definitions.forEach((definition) => collectIds(definition, products, cohorts));

  const [productNames, cohortNames] = await Promise.all([
    selectNames(db, "content_items", "title", Array.from(products)),
    selectNames(db, "cohorts", "name", Array.from(cohorts).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))
  ]);

  return { cohorts: cohortNames, products: productNames };
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
  input: { names: AudienceNames; now: number; people: Map<string, NoticePerson>; permissions: NoticePermissions; stats: Map<string, CampaignStats> }
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
  const [stats, names, people] = await Promise.all([
    fetchCampaignStats(db, rows.map((row) => row.id)),
    loadAudienceNames(db, rows.map(audienceOfRow)),
    loadPeople(db, rows.map((row) => row.created_by))
  ]);

  return {
    items: rows.map((row) => toListItem(row, { names, now, people, permissions: input.permissions ?? NO_PERMISSIONS, stats })),
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

  const [stats, names, people] = await Promise.all([
    fetchCampaignStats(db, [row.id]),
    loadAudienceNames(db, [audienceOfRow(row)]),
    loadPeople(db, [row.created_by, row.requested_by, row.approved_by])
  ]);
  const item = toListItem(row, { names, now, people, permissions: input.permissions ?? NO_PERMISSIONS, stats });
  // approved_at tambem marca quem publicou direto com messaging.publish_large (o envio agendado nao volta
  // para aprovacao); o relatorio so mostra "Aprovado" quando houve pedido.
  const approved = Boolean(row.requested_at && row.approved_at);

  return {
    ...item,
    approvedAt: approved ? row.approved_at : null,
    approvedBy: approved && row.approved_by ? (people.get(row.approved_by) ?? null) : null,
    audienceCountedAt: row.audience_counted_at,
    draft: rowToDraft(row),
    lastError: row.last_error,
    recipientsCount: row.recipients_count,
    requestedAt: row.requested_at,
    requestedBy: row.requested_by ? (people.get(row.requested_by) ?? null) : null,
    sendAt: row.send_at,
    sentAt: row.sent_at
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

export type NoticeEditorOptions = {
  branding: { logoUrl: string | null; name: string };
  cohorts: { id: string; name: string }[];
  names: AudienceNames;
  products: NoticeEditorProduct[];
  /** false: a lista de produtos nao carregou agora (o resto do editor funciona). */
  productsLoaded: boolean;
  segments: NoticeSegmentOption[];
};

/** Nome e logo da escola para a previa (relatorio sem o resto das opcoes do editor). */
export async function loadNoticeBranding(): Promise<NoticeEditorOptions["branding"]> {
  const settings = await readPlatformSettings(["branding"]);

  return { logoUrl: normalizeLogo(settings.branding.value, settings.branding.exists), name: SCHOOL_NAME };
}

export async function loadNoticeEditorOptions(): Promise<NoticeEditorOptions> {
  const db = communicationsDb();
  const [productsResult, cohortsResult, savedSegments, settings] = await Promise.all([
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
    readPlatformSettings(["branding"])
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

  // Segmentos podem citar produto fora da lista do seletor (curso incluido numa formacao).
  const extra = await loadAudienceNames(db, segments.map((segment) => segment.definition));

  return {
    branding: { logoUrl: normalizeLogo(settings.branding.value, settings.branding.exists), name: SCHOOL_NAME },
    cohorts,
    names: { cohorts: { ...extra.cohorts, ...names.cohorts }, products: { ...extra.products, ...names.products } },
    products,
    productsLoaded: productsResult.loaded,
    segments
  };
}
