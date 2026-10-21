import "server-only";

// Leituras de Comunicacao > Fluxos (docs/23 §2.4 a §2.8): a lista com os numeros de cada fluxo, os quatro
// numeros do topo, o fluxo aberto no construtor (o rascunho no formato do navegador, com o aviso de origem
// no fluxo das notificacoes seguintes) e o relatorio por passo (RPCs 7.7 e 7.8). Leituras dinamicas, como
// as de Avisos; banco sem a 202610200002 -> PendingMigrationError (a pagina mostra o aviso da migracao).
//
// Nenhum embed entre campaigns e communication_flows: duas FKs ligam as tabelas (PGRST201 sem a dica). O
// aviso de origem e o conteudo dos passos vem por consultas simples (tests/comunicacao-job.test.mjs confere).

import {
  availableFlowActions,
  FLOW_SITUATION_LABELS,
  FLOWS_PAGE_SIZE,
  flowFilterOfSituation,
  flowSituationOf,
  flowSituationTone,
  type FlowAction,
  type FlowFilter,
  type FlowPermissions,
  type FlowSituation,
  type FlowSituationTone,
  type FlowSourceNotice,
  type FlowStepStats,
  type FlowTotals
} from "@/components/admin/v2/communication/flows/flows-view-model";
import { pageKeyOfHref } from "@/server/member-area/page-visit-model";
import { describeAudience, EVERYONE, type AudienceDefinition } from "./audience-model";
import type { CampaignStatus } from "./campaign-model";
import { assertNoDbError, chunksOf, communicationsDb, type CommunicationsDb } from "./db";
import { saoPauloDayBounds, type FlowEndedReason, type FlowEntryMode, type FlowNode, type FlowOrigin, type FlowStatus } from "./flow-model";
import type { FlowDraft, FlowNodeDraft, FlowNoticeContent } from "./flow-schemas";
import {
  definitionOf,
  fetchFlow,
  fetchFlowNodes,
  fetchFlowNodeStats,
  fetchFlowStats,
  FLOW_COLUMNS,
  nodeOfRow,
  preorderNodes,
  type FlowNodeRow,
  type FlowRow,
  type FlowStatsRow
} from "./flow-store";
import { loadAudienceNames } from "./queries";
import { fetchCampaignEngagement, fetchCampaignsByIds, fetchCampaignStats, rowToDraft, type CampaignRow } from "./store";

const NO_PERMISSIONS: FlowPermissions = { canPublish: false, canPublishLarge: false, canWrite: false };
/** Fluxos lidos para a lista e o topo (os de aviso tambem; os excluidos nunca). */
const FLOWS_READ_LIMIT = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FlowPerson = { id: string; name: string };

/** O aviso de origem de um fluxo de aviso, com a situacao e quantos receberam. */
export type FlowSource = FlowSourceNotice & { deleted: boolean; recipients: number | null; sentAt: string | null; status: CampaignStatus };

export type FlowListItem = {
  actions: FlowAction[];
  entryCount: number | null;
  entryDescription: string;
  entryMode: FlowEntryMode;
  hasGoal: boolean;
  id: string;
  name: string;
  origin: FlowOrigin;
  situation: FlowSituation;
  situationLabel: string;
  situationTone: FlowSituationTone;
  source: { id: string; title: string } | null;
  status: FlowStatus;
  /** null = nunca ativado (a lista mostra "—"). */
  totals: FlowTotals | null;
  updatedAt: string;
};

export type FlowsPage = { items: FlowListItem[]; page: number; pageSize: number; total: number };

/** Fluxos ativos · No fluxo agora · Notificações enviadas e Atingiram o objetivo no periodo; sem fluxo, "—". */
export type FlowsOverview = { activeFlows: number | null; inFlowNow: number | null; reachedGoal: number | null; sent: number | null };

export type FlowRemovedStep = { id: string; kind: "condition" | "message"; parentId: string | null; removedAt: string; title: string };

export type FlowReport = {
  /** Entraram hoje (dia de Sao Paulo). */
  enteredToday: number;
  /** Numeros de cada passo (vivos e removidos), pelo id. */
  nodes: Record<string, FlowStepStats>;
  /** Tarefas vencidas ha mais de 10 minutos (a linha de atraso). */
  overdue: number;
  removed: FlowRemovedStep[];
  /** O funil do aviso de origem (fluxo de aviso). */
  sourceFunnel: { clicked: number; opened: number; recipients: number; seen: number } | null;
  totals: FlowTotals;
};

export type FlowDetail = {
  actions: FlowAction[];
  activatedAt: string | null;
  approvedAt: string | null;
  approvedBy: FlowPerson | null;
  createdAt: string;
  createdBy: FlowPerson | null;
  /** O fluxo como o construtor edita (e como saveFlow recebe). */
  draft: FlowDraft;
  endedAt: string | null;
  endedReason: FlowEndedReason | null;
  entryCount: number | null;
  entryCountedAt: string | null;
  id: string;
  lastError: string | null;
  pausedAt: string | null;
  /** Numeros por passo; null enquanto o fluxo nunca foi ativado. */
  report: FlowReport | null;
  requestedAt: string | null;
  requestedBy: FlowPerson | null;
  situation: FlowSituation;
  situationLabel: string;
  situationTone: FlowSituationTone;
  source: FlowSource | null;
  status: FlowStatus;
  updatedAt: string;
  /** Versao atual do conteudo de cada passo de notificacao. */
  versions: Record<string, string>;
};

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

async function fetchAllFlows(db: CommunicationsDb): Promise<FlowRow[]> {
  const { data, error } = await db
    .from("communication_flows")
    .select(FLOW_COLUMNS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id")
    .limit(FLOWS_READ_LIMIT);
  assertNoDbError(error, "Comunicacao: fluxos");

  return (data ?? []) as FlowRow[];
}

const SOURCE_COLUMNS = "id,title,status,body,cta_href,audio_url,response_mode,validity_minutes,valid_until,recipients_count,sent_at,deleted_at";

type SourceRow = Pick<
  CampaignRow,
  "audio_url" | "body" | "cta_href" | "deleted_at" | "id" | "recipients_count" | "response_mode" | "sent_at" | "status" | "title" | "valid_until" | "validity_minutes"
>;

function sourceOfRow(row: SourceRow): FlowSource {
  return {
    body: row.body ?? "",
    ctaHref: row.cta_href,
    deleted: Boolean(row.deleted_at),
    hasAudio: Boolean(row.audio_url),
    hasResponse: row.response_mode === "accept_decline",
    id: row.id,
    recipients: row.recipients_count,
    sentAt: row.sent_at,
    status: row.status,
    title: row.title?.trim() || "Sem título",
    validUntil: row.valid_until,
    validityMinutes: row.validity_minutes
  };
}

/** Avisos de origem dos fluxos de aviso (excluidos tambem: o fluxo mostra o titulo de quando existia). */
async function fetchSources(db: CommunicationsDb, ids: readonly (string | null)[]): Promise<Map<string, FlowSource>> {
  const sources = new Map<string, FlowSource>();
  const wanted = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));

  for (const part of chunksOf(wanted, 150)) {
    const { data, error } = await db.from("campaigns").select(SOURCE_COLUMNS).in("id", part);
    assertNoDbError(error, "Comunicacao: avisos de origem dos fluxos");

    for (const row of (data ?? []) as SourceRow[]) {
      sources.set(row.id, sourceOfRow(row));
    }
  }

  return sources;
}

async function loadPeople(db: CommunicationsDb, ids: readonly (string | null)[]) {
  const people = new Map<string, FlowPerson>();
  const wanted = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));

  for (const part of chunksOf(wanted, 150)) {
    const { data, error } = await db.from("profiles").select("id,full_name,email").in("id", part);
    assertNoDbError(error, "Comunicacao: equipe dos fluxos");

    for (const row of (data ?? []) as { email: string | null; full_name: string | null; id: string }[]) {
      people.set(row.id, { id: row.id, name: row.full_name?.trim() || row.email?.split("@")[0] || "Equipe" });
    }
  }

  return people;
}

function entryAudienceOf(flow: Pick<FlowRow, "entry_audience">): AudienceDefinition {
  return definitionOf(flow.entry_audience) ?? EVERYONE;
}

function totalsOf(stats: FlowStatsRow | undefined): FlowTotals | null {
  return stats ? { active: stats.active, done: stats.done, ended: stats.ended, entered: stats.entered, goal: stats.goal, sent: stats.sent } : null;
}

function situationOfFlow(flow: FlowRow, sources: Map<string, FlowSource>) {
  return flowSituationOf({
    endedReason: flow.ended_reason,
    origin: flow.origin,
    sourceStatus: flow.source_campaign_id ? (sources.get(flow.source_campaign_id)?.status ?? null) : null,
    status: flow.status
  });
}

/* ------------------------------------------------------------------------------------------------
 * Lista e topo
 * ---------------------------------------------------------------------------------------------- */

/**
 * Lista da equipe, 20 por pagina, mais novos primeiro, com a pilula (?situacao=) aplicada pela situacao
 * de cada fluxo (um fluxo de aviso agendado e "ativo" para a pilula). Os numeros sao do fluxo inteiro.
 */
export async function listFlows(input: { filter?: FlowFilter; page?: number; permissions?: FlowPermissions } = {}): Promise<FlowsPage> {
  const db = communicationsDb();
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const flows = await fetchAllFlows(db);
  const sources = await fetchSources(db, flows.map((flow) => flow.source_campaign_id));
  const matching = flows.filter((flow) => !input.filter || flowFilterOfSituation(situationOfFlow(flow, sources)) === input.filter);
  const rows = matching.slice((page - 1) * FLOWS_PAGE_SIZE, page * FLOWS_PAGE_SIZE);
  const [stats, names] = await Promise.all([
    fetchFlowStats(
      db,
      rows.map((flow) => flow.id),
      new Date()
    ),
    loadAudienceNames(db, rows.map(entryAudienceOf))
  ]);
  const permissions = input.permissions ?? NO_PERMISSIONS;

  return {
    items: rows.map((flow) => {
      const situation = situationOfFlow(flow, sources);
      const source = flow.source_campaign_id ? (sources.get(flow.source_campaign_id) ?? null) : null;

      return {
        actions: availableFlowActions({ origin: flow.origin, sourceStatus: source?.status ?? null, status: flow.status }, permissions),
        entryCount: flow.entry_count,
        entryDescription: describeAudience(entryAudienceOf(flow), names),
        entryMode: flow.entry_mode,
        hasGoal: flow.goal !== null,
        id: flow.id,
        name: flow.name,
        origin: flow.origin,
        situation,
        situationLabel: FLOW_SITUATION_LABELS[situation],
        situationTone: flowSituationTone(situation),
        source: source ? { id: source.id, title: source.title } : null,
        status: flow.status,
        totals: flow.activated_at ? totalsOf(stats.get(flow.id)) : null,
        updatedAt: flow.updated_at
      };
    }),
    page,
    pageSize: FLOWS_PAGE_SIZE,
    total: matching.length
  };
}

/**
 * Os quatro numeros do topo (docs/23 §2.4): fluxos no ar agora, alunos dentro agora e, dentro do periodo
 * da barra, notificacoes enviadas e quem saiu pelo objetivo. A RPC 7.7 conta "desde"; um periodo que ja
 * terminou desconta o que veio depois do fim (uma segunda leitura desde o fim). Sem fluxo ativado, "—".
 */
export async function flowsOverview(period: { end: Date; start: Date }, now = Date.now()): Promise<FlowsOverview> {
  const db = communicationsDb();
  const flows = (await fetchAllFlows(db)).filter((flow) => flow.activated_at);

  if (flows.length === 0) {
    return { activeFlows: null, inFlowNow: null, reachedGoal: null, sent: null };
  }

  const ids = flows.map((flow) => flow.id);
  const [stats, after] = await Promise.all([
    fetchFlowStats(db, ids, period.start),
    period.end.getTime() < now - 60_000 ? fetchFlowStats(db, ids, period.end) : Promise.resolve(new Map<string, FlowStatsRow>())
  ]);
  let inFlowNow = 0;
  let sent = 0;
  let reachedGoal = 0;

  for (const row of stats.values()) {
    const later = after.get(row.flowId);
    inFlowNow += row.active;
    sent += row.sentSince - (later?.sentSince ?? 0);
    reachedGoal += row.goalSince - (later?.goalSince ?? 0);
  }

  return { activeFlows: flows.filter((flow) => flow.status === "active").length, inFlowNow, reachedGoal, sent };
}

/* ------------------------------------------------------------------------------------------------
 * Fluxo aberto
 * ---------------------------------------------------------------------------------------------- */

function draftNodeOf(node: FlowNode): FlowNodeDraft {
  if (node.kind === "entry") {
    return { branch: null, id: node.id, kind: "entry", parentId: null, position: node.position };
  }

  if (node.kind === "message") {
    return {
      anchor: node.anchor,
      anchorNodeId: node.anchorNodeId,
      branch: node.branch,
      filter: node.filter,
      id: node.id,
      kind: "message",
      offsetMinutes: node.offsetMinutes,
      parentId: node.parentId,
      position: node.position
    };
  }

  return {
    anchor: node.anchor,
    anchorNodeId: node.anchorNodeId,
    branch: node.branch,
    condition: node.condition ?? { kind: "rules", root: { items: [], match: "all" } },
    id: node.id,
    kind: "condition",
    maxWaitMinutes: node.maxWaitMinutes,
    offsetMinutes: node.offsetMinutes,
    parentId: node.parentId,
    position: node.position,
    waitUntilTrue: node.waitUntilTrue
  };
}

/** Conteudo de um passo como o construtor edita ("Até a notificação principal sumir" vem do passo). */
export function flowContentOfRow(row: CampaignRow, expireWithAnchor: boolean): FlowNoticeContent {
  const draft = rowToDraft(row);

  return {
    audio: draft.audio,
    body: draft.body,
    cta: draft.cta,
    icon: draft.icon,
    image: draft.image,
    response: draft.response,
    sender: draft.sender,
    title: draft.title,
    validity: expireWithAnchor ? { mode: "with_anchor" } : draft.validity
  };
}

/** O fluxo como o construtor edita: passos vivos em pre-ordem e o conteudo atual de cada notificacao. */
export function flowDraftOf(flow: FlowRow, rows: readonly FlowNodeRow[], campaigns: ReadonlyMap<string, CampaignRow>) {
  const live = rows.filter((row) => !row.removed_at);
  const nodes = preorderNodes(live.map(nodeOfRow));
  const messages: Record<string, FlowNoticeContent> = {};
  const versions: Record<string, string> = {};

  for (const row of live) {
    const campaign = row.kind === "message" && row.campaign_id ? campaigns.get(row.campaign_id) : undefined;

    if (campaign) {
      messages[row.id] = flowContentOfRow(campaign, row.expire_with_anchor);
      versions[row.id] = campaign.id;
    }
  }

  const draft: FlowDraft = {
    entry: { audience: entryAudienceOf(flow), mode: flow.entry_mode },
    goal: definitionOf(flow.goal),
    messages,
    name: flow.name,
    nodes: nodes.map(draftNodeOf),
    origin: flow.origin
  };

  return { draft, versions };
}

/** Numeros por passo (7.8, com a pagina do botao de cada notificacao) e do fluxo (7.7, com o dia de hoje). */
async function getFlowReport(
  db: CommunicationsDb,
  input: { campaigns: ReadonlyMap<string, CampaignRow>; flow: FlowRow; now: number; rows: readonly FlowNodeRow[]; source: FlowSource | null }
): Promise<FlowReport> {
  const ctaKeys: Record<string, string | null> = {};

  for (const row of input.rows) {
    if (row.kind === "message" && row.campaign_id) {
      ctaKeys[row.id] = pageKeyOfHref(input.campaigns.get(row.campaign_id)?.cta_href ?? null);
    }
  }

  const today = new Date(saoPauloDayBounds(input.now).start);
  const sourceId = input.source?.id ?? null;
  const [nodeStats, stats, sourceStats, sourceEngagement] = await Promise.all([
    fetchFlowNodeStats(db, input.flow.id, ctaKeys),
    fetchFlowStats(db, [input.flow.id], today),
    sourceId ? fetchCampaignStats(db, [sourceId]) : Promise.resolve(null),
    sourceId ? fetchCampaignEngagement(db, [sourceId]) : Promise.resolve(null)
  ]);
  const row = stats.get(input.flow.id);
  const titleOf = (nodeRow: FlowNodeRow) => (nodeRow.campaign_id ? input.campaigns.get(nodeRow.campaign_id)?.title?.trim() : null) || "Condição";
  const sourceRow = sourceId ? sourceStats?.get(sourceId) : undefined;

  return {
    enteredToday: row?.enteredSince ?? 0,
    nodes: Object.fromEntries(nodeStats),
    overdue: row?.overdue ?? 0,
    removed: input.rows
      .filter((nodeRow) => nodeRow.removed_at && nodeRow.kind !== "entry")
      .map((nodeRow) => ({
        id: nodeRow.id,
        kind: nodeRow.kind === "condition" ? ("condition" as const) : ("message" as const),
        parentId: nodeRow.parent_id,
        removedAt: nodeRow.removed_at as string,
        title: nodeRow.kind === "condition" ? "Condição" : titleOf(nodeRow)
      })),
    sourceFunnel: sourceId
      ? {
          clicked: sourceRow?.clicked ?? 0,
          opened: sourceEngagement?.get(sourceId)?.opened ?? 0,
          recipients: sourceRow?.recipients ?? input.source?.recipients ?? 0,
          seen: sourceRow?.seen ?? 0
        }
      : null,
    totals: totalsOf(row) ?? { active: 0, done: 0, ended: 0, entered: 0, goal: 0, sent: 0 }
  };
}

/**
 * Um fluxo para o construtor ou o relatorio; null se nao existe (ou foi excluido). Traz o rascunho no
 * formato do navegador, a versao atual de cada passo, o aviso de origem e, depois de ativado, os numeros.
 */
export async function getFlowDetail(id: string, input: { now?: number; permissions?: FlowPermissions } = {}): Promise<FlowDetail | null> {
  if (!UUID.test(id)) {
    return null;
  }

  const db = communicationsDb();
  const now = input.now ?? Date.now();
  const flow = await fetchFlow(db, id);

  if (!flow) {
    return null;
  }

  const rows = await fetchFlowNodes(db, [flow.id], { includeRemoved: true });
  const [campaignRows, sources, people] = await Promise.all([
    fetchCampaignsByIds(
      db,
      rows.map((row) => row.campaign_id).filter((campaignId): campaignId is string => Boolean(campaignId))
    ),
    fetchSources(db, [flow.source_campaign_id]),
    loadPeople(db, [flow.created_by, flow.requested_by, flow.approved_by])
  ]);
  const campaigns = new Map(campaignRows.map((row) => [row.id, row]));
  const source = flow.source_campaign_id ? (sources.get(flow.source_campaign_id) ?? null) : null;
  const { draft, versions } = flowDraftOf(flow, rows, campaigns);
  const situation = situationOfFlow(flow, sources);
  const report = flow.activated_at || flow.status === "active" || flow.status === "paused" ? await getFlowReport(db, { campaigns, flow, now, rows, source }) : null;
  const person = (userId: string | null) => (userId ? (people.get(userId) ?? null) : null);

  return {
    actions: availableFlowActions({ origin: flow.origin, sourceStatus: source?.status ?? null, status: flow.status }, input.permissions ?? NO_PERMISSIONS),
    activatedAt: flow.activated_at,
    approvedAt: flow.approved_at,
    approvedBy: person(flow.approved_by),
    createdAt: flow.created_at,
    createdBy: person(flow.created_by),
    draft,
    endedAt: flow.ended_at,
    endedReason: flow.ended_reason,
    entryCount: flow.entry_count,
    entryCountedAt: flow.entry_counted_at,
    id: flow.id,
    lastError: flow.last_error,
    pausedAt: flow.paused_at,
    report,
    requestedAt: flow.requested_at,
    requestedBy: person(flow.requested_by),
    situation,
    situationLabel: FLOW_SITUATION_LABELS[situation],
    situationTone: flowSituationTone(situation),
    source,
    status: flow.status,
    updatedAt: flow.updated_at,
    versions
  };
}

/** Todas as regras do fluxo (quem entra, filtros, condicoes, objetivo): os nomes das frases. */
export function flowDefinitions(draft: FlowDraft): AudienceDefinition[] {
  const definitions: AudienceDefinition[] = [draft.entry.audience];

  for (const node of draft.nodes) {
    if (node.kind === "message" && node.filter) {
      definitions.push(node.filter);
    }

    if (node.kind === "condition") {
      definitions.push(node.condition);
    }
  }

  if (draft.goal) {
    definitions.push(draft.goal);
  }

  return definitions;
}
