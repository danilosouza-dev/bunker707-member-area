import "server-only";

// Leituras e escritas dos fluxos da Comunicacao v2 (docs/23 §3 e §4): communication_flows, _flow_nodes,
// _flow_runs e _flow_tasks, e os RPCs da migracao 202610200002 (7.1 a 7.9, 7.13, 7.14 e 7.15). Quem decide
// e o modulo puro flow-model.ts; aqui so se le e se grava. Erros proprios dos RPCs (BK404, BK409, BK422)
// viram CommunicationError com a frase da tela.
//
// Duas relacoes ligam campaigns e communication_flows (communication_flows.source_campaign_id e
// campaigns.flow_id): todo embed entre as duas tabelas precisa da dica da FK
// (campaigns!communication_flows_source_campaign_id_fkey ou communication_flows!campaigns_flow_id_fkey),
// senao o PostgREST responde PGRST201 (relacao ambigua) e o job cairia todo minuto. O unico embed daqui e o
// da sondagem das seguintes (probeNoticeEntry), com a dica (tests/comunicacao-job.test.mjs confere as strings).

import { normalizeAudience, type AudienceDefinition } from "./audience-model";
import { toDbError } from "@/server/db/pending-migration";
import { assertNoDbError, chunksOf, CommunicationError, type CommunicationsDb } from "./db";
import {
  FLOW_LIMITS,
  saoPauloDayBounds,
  validateFlowGoal,
  validateFlowTree,
  watchedPageKeysOf,
  type FlowDecision,
  type FlowEndedReason,
  type FlowEntryMode,
  type FlowMessageMeta,
  type FlowNode,
  type FlowOrigin,
  type FlowStatus,
  type FlowTaskInput,
  type FlowTree
} from "./flow-model";
import type { FlowNoticeContent } from "./flow-schemas";
import { emptyNoticeDraft } from "./schemas";
import { draftToColumns, fetchCampaign, fetchCampaignsByIds, type CampaignContentColumns, type CampaignRow } from "./store";

/* ------------------------------------------------------------------------------------------------
 * Linhas
 * ---------------------------------------------------------------------------------------------- */

export const FLOW_COLUMNS =
  "id,name,origin,source_campaign_id,status,entry_audience,entry_mode,goal,watched_page_keys,revision,entry_count,entry_counted_at,entry_refreshed_at,entry_completed_at,goal_swept_at,activated_at,paused_at,ended_at,ended_reason,last_error,requested_by,requested_at,approved_by,approved_at,created_by,updated_by,created_at,updated_at,deleted_at,deleted_by";

export type FlowRow = {
  activated_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  ended_at: string | null;
  ended_reason: FlowEndedReason | null;
  entry_audience: unknown;
  entry_completed_at: string | null;
  entry_count: number | null;
  entry_counted_at: string | null;
  entry_mode: FlowEntryMode;
  entry_refreshed_at: string | null;
  goal: unknown;
  goal_swept_at: string | null;
  id: string;
  last_error: string | null;
  name: string;
  origin: FlowOrigin;
  paused_at: string | null;
  requested_at: string | null;
  requested_by: string | null;
  revision: number;
  source_campaign_id: string | null;
  status: FlowStatus;
  updated_at: string;
  updated_by: string | null;
  watched_page_keys: string[];
};

export const FLOW_NODE_COLUMNS =
  "id,flow_id,parent_id,branch,kind,position,anchor,anchor_node_id,offset_minutes,campaign_id,filter,expire_with_anchor,condition,wait_until_true,max_wait_minutes,removed_at,created_at,updated_at";

export type FlowNodeRow = {
  anchor: FlowNode["anchor"];
  anchor_node_id: string | null;
  branch: FlowNode["branch"];
  campaign_id: string | null;
  condition: unknown;
  created_at: string;
  expire_with_anchor: boolean;
  filter: unknown;
  flow_id: string;
  id: string;
  kind: FlowNode["kind"];
  max_wait_minutes: number | null;
  offset_minutes: number;
  parent_id: string | null;
  position: number;
  removed_at: string | null;
  updated_at: string;
  wait_until_true: boolean;
};

export type FlowTaskStatus = "canceled" | "done" | "pending" | "running" | "skipped";

/** Linha de communication_flow_tasks como o RPC de reserva (7.1) devolve (datas em texto, como vieram). */
export type FlowTaskRow = {
  anchor_at: string;
  attempts: number;
  claimed_at: string | null;
  deadline_at: string | null;
  deferrals: number;
  due_at: string;
  flow_active: boolean;
  flow_id: string;
  node_id: string;
  not_before: string | null;
  status: FlowTaskStatus;
  user_id: string;
};

/** Regras gravadas (jsonb) lidas sem confiar no conteudo; null = sem regra. Ilegivel vira "ninguem". */
export function definitionOf(value: unknown): AudienceDefinition | null {
  if (value === null || value === undefined) {
    return null;
  }

  const definition = value as AudienceDefinition;

  if (definition && typeof definition === "object" && (definition.kind === "everyone" || (definition.kind === "rules" && definition.root && Array.isArray(definition.root.items)))) {
    return definition;
  }

  return { kind: "rules", root: { items: [], match: "any" } };
}

export function nodeOfRow(row: FlowNodeRow): FlowNode {
  return {
    anchor: row.anchor,
    anchorNodeId: row.anchor_node_id,
    branch: row.branch,
    campaignId: row.campaign_id,
    condition: row.kind === "condition" ? (definitionOf(row.condition) ?? { kind: "rules", root: { items: [], match: "any" } }) : null,
    expireWithAnchor: row.expire_with_anchor,
    filter: definitionOf(row.filter),
    id: row.id,
    kind: row.kind,
    maxWaitMinutes: row.max_wait_minutes,
    offsetMinutes: row.offset_minutes,
    parentId: row.parent_id,
    position: row.position,
    waitUntilTrue: row.wait_until_true
  };
}

function timeOf(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

/** Tarefa reservada como a decisao recebe (tempos em ms; o carimbo da reserva fica em texto exato). */
export function taskInputOf(row: FlowTaskRow): FlowTaskInput {
  return {
    anchorAt: timeOf(row.anchor_at) ?? 0,
    attempts: row.attempts,
    claimedAt: row.claimed_at ?? "",
    deadlineAt: timeOf(row.deadline_at),
    nodeId: row.node_id,
    notBefore: timeOf(row.not_before),
    userId: row.user_id
  };
}

/** Conteudo atual de um passo (ou do aviso de origem) como a decisao e a conferencia da arvore usam. */
export function messageMetaOfRow(row: Pick<CampaignRow, "audio_url" | "cta_href" | "id" | "response_mode" | "title" | "valid_until" | "validity_minutes">): FlowMessageMeta {
  return {
    campaignId: row.id,
    ctaHref: row.cta_href,
    hasAudio: Boolean(row.audio_url),
    hasCta: Boolean(row.cta_href),
    hasResponse: row.response_mode === "accept_decline",
    title: row.title,
    validUntil: row.valid_until,
    validityMinutes: row.validity_minutes
  };
}

/* ------------------------------------------------------------------------------------------------
 * Erros dos RPCs
 * ---------------------------------------------------------------------------------------------- */

export const FLOW_CHANGED_MESSAGE = "Este fluxo mudou em outra tela há instantes. Recarregue a página para ver a versão atual.";
export const FLOW_MISSING_MESSAGE = "Este fluxo não existe mais.";

/** Frase do RPC (sem acento, no SQL) -> frase da tela (docs/23 §2.7). */
const RPC_MESSAGES: Record<string, string> = {
  "Arvore do fluxo invalida.": "Passo inválido.",
  "Conteudo do passo invalido.": "Passo inválido.",
  "Este fluxo foi encerrado.": "Este fluxo foi encerrado.",
  "Este fluxo mudou em outra tela.": FLOW_CHANGED_MESSAGE,
  "Este fluxo nao existe mais.": FLOW_MISSING_MESSAGE,
  "Neste fluxo, quem entra foi decidido ao ativar.": "Neste fluxo, quem entra foi decidido ao ativar. Duplique para mudar.",
  "O jeito de entrar nao muda depois de ativar.": "O jeito de entrar não muda depois de ativar. Duplique para mudar.",
  "Para mudar a ordem, remova e crie de novo.": "Para mudar a ordem, remova e crie de novo.",
  "Para mudar a referencia de tempo, remova este passo e crie outro.": "Para mudar a referência de tempo, remova este passo e crie outro.",
  "Passo invalido.": "Passo inválido.",
  "Passo nao encontrado.": "Passo não encontrado.",
  "Use no maximo 20 passos.": `Use no máximo ${FLOW_LIMITS.maxNodes} passos (notificações e condições).`
};

const RPC_STATUS: Record<string, number> = { BK404: 404, BK409: 409, BK422: 422 };

type DbError = { code?: string | null; hint?: string | null; message: string } | null;

/** Erro de um RPC dos fluxos: BK404/BK409/BK422 viram CommunicationError; o resto, erro de banco. */
export function flowRpcError(error: NonNullable<DbError>, context: string): Error {
  const status = error.code ? RPC_STATUS[error.code] : undefined;

  if (status) {
    return new CommunicationError(RPC_MESSAGES[error.message] ?? error.message, status);
  }

  // Guarda o codigo do Postgres: a aplicacao em lote (bisseccao) decide por ele.
  return Object.assign(toDbError(error, context), { code: error.code ?? null });
}

async function callRpc<T>(db: CommunicationsDb, name: string, args: Record<string, unknown>, context: string): Promise<T> {
  const { data, error } = await db.rpc(name, args);

  if (error) {
    throw flowRpcError(error, context);
  }

  return data as T;
}

/* ------------------------------------------------------------------------------------------------
 * Fluxos e arvores
 * ---------------------------------------------------------------------------------------------- */

export async function fetchFlow(db: CommunicationsDb, id: string): Promise<FlowRow | null> {
  const { data, error } = await db.from("communication_flows").select(FLOW_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
  assertNoDbError(error, "Comunicacao: fluxo");

  return (data ?? null) as FlowRow | null;
}

export async function fetchFlowsByIds(db: CommunicationsDb, ids: readonly string[]): Promise<FlowRow[]> {
  const rows: FlowRow[] = [];

  for (const part of chunksOf(Array.from(new Set(ids)), 150)) {
    const { data, error } = await db.from("communication_flows").select(FLOW_COLUMNS).in("id", part);
    assertNoDbError(error, "Comunicacao: fluxos");
    rows.push(...((data ?? []) as FlowRow[]));
  }

  return rows;
}

/** Passos vivos (sem removed_at) dos fluxos, ou todos com `includeRemoved` (relatorio: "Passo removido em"). */
export async function fetchFlowNodes(db: CommunicationsDb, flowIds: readonly string[], options: { includeRemoved?: boolean } = {}): Promise<FlowNodeRow[]> {
  const rows: FlowNodeRow[] = [];

  for (const part of chunksOf(Array.from(new Set(flowIds)), 50)) {
    let query = db.from("communication_flow_nodes").select(FLOW_NODE_COLUMNS).in("flow_id", part);

    if (!options.includeRemoved) {
      query = query.is("removed_at", null);
    }

    const { data, error } = await query.order("flow_id").order("position").order("id");
    assertNoDbError(error, "Comunicacao: passos dos fluxos");
    rows.push(...((data ?? []) as FlowNodeRow[]));
  }

  return rows;
}

/** Pre-ordem a partir da entrada (pai antes do filho), na ordem de cada lado; passo solto vai no fim. */
export function preorderNodes(nodes: readonly FlowNode[]): FlowNode[] {
  const byParent = new Map<string | null, FlowNode[]>();

  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }

  const ordered: FlowNode[] = [];
  const seen = new Set<string>();
  const visit = (node: FlowNode) => {
    if (seen.has(node.id)) {
      return;
    }

    seen.add(node.id);
    ordered.push(node);

    const children = (byParent.get(node.id) ?? [])
      .slice()
      .sort((left, right) => (left.branch === right.branch ? 0 : left.branch === "yes" ? -1 : 1) || left.position - right.position || (left.id < right.id ? -1 : 1));

    children.forEach(visit);
  };

  nodes.filter((node) => node.kind === "entry").forEach(visit);
  nodes.forEach(visit);

  return ordered;
}

export type LoadedFlowTree = { flow: FlowRow; nodes: FlowNodeRow[]; tree: FlowTree };

/** O fluxo com a arvore viva (pre-ordem); null = nao existe ou foi excluido. */
export async function fetchFlowTree(db: CommunicationsDb, flowId: string): Promise<LoadedFlowTree | null> {
  const flow = await fetchFlow(db, flowId);

  if (!flow) {
    return null;
  }

  const nodes = await fetchFlowNodes(db, [flowId]);

  return { flow, nodes, tree: { nodes: preorderNodes(nodes.map(nodeOfRow)), origin: flow.origin } };
}

/** Fluxos no ar ou pausados (nao excluidos): as paginas acompanhadas e a lista da equipe. */
export async function fetchLiveFlows(db: CommunicationsDb, options: { origin?: FlowOrigin } = {}): Promise<FlowRow[]> {
  let query = db.from("communication_flows").select(FLOW_COLUMNS).in("status", ["active", "paused"]).is("deleted_at", null);

  if (options.origin) {
    query = query.eq("origin", options.origin);
  }

  const { data, error } = await query.order("created_at", { ascending: false }).limit(500);
  assertNoDbError(error, "Comunicacao: fluxos no ar");

  return (data ?? []) as FlowRow[];
}

/** Conteudo atual dos passos e dos avisos de origem, pelo id da versao. */
export async function fetchFlowMessageMeta(db: CommunicationsDb, campaignIds: readonly string[]): Promise<Map<string, FlowMessageMeta>> {
  const rows = await fetchCampaignsByIds(db, campaignIds.filter(Boolean));

  return new Map(rows.map((row) => [row.id, messageMetaOfRow(row)]));
}

/* ------------------------------------------------------------------------------------------------
 * Sondagens do passo 0 (consultas pequenas, nos indices parciais; nenhum embed)
 * ---------------------------------------------------------------------------------------------- */

/** Ha tarefa vencida (pendente) ou presa (reservada ha mais de 2 min), so de fluxo no ar? */
export async function probeDueFlowTasks(db: CommunicationsDb, now: Date): Promise<boolean> {
  const staleBefore = new Date(now.getTime() - FLOW_LIMITS.staleClaimMs).toISOString();
  const { data, error } = await db
    .from("communication_flow_tasks")
    .select("node_id")
    .eq("flow_active", true)
    .or(`and(status.eq.pending,due_at.lte."${now.toISOString()}"),and(status.eq.running,claimed_at.lt."${staleBefore}")`)
    .limit(1);
  assertNoDbError(error, "Comunicacao: tarefas vencidas dos fluxos");

  return (data ?? []).length > 0;
}

/**
 * Fluxos do construtor no ar com entrada a fazer: recem-ativados ou com "quem entra" mudado
 * (entry_refreshed_at nulo) e os de entrada continua cuja faixa de 15 minutos venceu.
 */
export async function probeBuilderEntry(db: CommunicationsDb, slot: Date, limit: number): Promise<FlowRow[]> {
  const { data, error } = await db
    .from("communication_flows")
    .select(FLOW_COLUMNS)
    .eq("status", "active")
    .is("deleted_at", null)
    .eq("origin", "builder")
    .or(`entry_refreshed_at.is.null,and(entry_refreshed_at.lt."${slot.toISOString()}",entry_mode.neq.current)`)
    .order("entry_refreshed_at", { ascending: true, nullsFirst: true })
    .limit(limit);
  assertNoDbError(error, "Comunicacao: entrada dos fluxos");

  return (data ?? []) as FlowRow[];
}

/**
 * Fluxos de aviso no ar ainda sem todos os que receberam (entry_completed_at nulo), so os cujo aviso de
 * origem ja saiu ("sent"), filtrado na mesma consulta (embed com a dica da FK): fluxos de avisos agendados
 * nunca ocupam o lugar de um aviso que acabou de sair. Os mais antigos primeiro.
 */
export async function probeNoticeEntry(db: CommunicationsDb, limit: number): Promise<{ flowId: string; sourceCampaignId: string }[]> {
  const { data, error } = await db
    .from("communication_flows")
    .select("id,source_campaign_id,source:campaigns!communication_flows_source_campaign_id_fkey!inner(status)")
    .eq("origin", "notice")
    .eq("status", "active")
    .is("deleted_at", null)
    .is("entry_completed_at", null)
    .eq("source.status", "sent")
    .order("created_at", { ascending: true })
    .limit(limit);
  assertNoDbError(error, "Comunicacao: entrada das notificacoes seguintes");

  return ((data ?? []) as { id: string; source_campaign_id: string | null }[])
    .filter((row) => row.source_campaign_id)
    .map((row) => ({ flowId: row.id, sourceCampaignId: row.source_campaign_id as string }));
}

/**
 * Na faixa de 15 minutos: fluxos no ar com objetivo, e os que podem ter terminado (construtor "so quem esta
 * agora" com a entrada feita; aviso com todos dentro), ainda nao conferidos nesta faixa. goal_swept_at e o
 * carimbo de "conferido nesta faixa" de todos eles (o job grava; nao muda a versao do editor): quem nao coube
 * numa faixa vem primeiro na seguinte, entao a fila gira mesmo com mais de 100 fluxos que nao terminam.
 */
export async function probeSlotWork(db: CommunicationsDb, slot: Date): Promise<FlowRow[]> {
  const slotIso = slot.toISOString();
  const { data, error } = await db
    .from("communication_flows")
    .select(FLOW_COLUMNS)
    .eq("status", "active")
    .is("deleted_at", null)
    .or(
      "goal.not.is.null," +
        "and(origin.eq.builder,entry_mode.eq.current,entry_refreshed_at.not.is.null)," +
        "and(origin.eq.notice,entry_completed_at.not.is.null)"
    )
    .or(`goal_swept_at.is.null,goal_swept_at.lt."${slotIso}"`)
    .order("goal_swept_at", { ascending: true, nullsFirst: true })
    .order("id")
    .limit(FLOW_LIMITS.activeFlows * 5);
  assertNoDbError(error, "Comunicacao: fluxos da faixa");

  return (data ?? []) as FlowRow[];
}

/** Ainda ha tarefa pendente ou reservada no fluxo? */
export async function flowHasOpenTasks(db: CommunicationsDb, flowId: string): Promise<boolean> {
  const { data, error } = await db.from("communication_flow_tasks").select("node_id").eq("flow_id", flowId).in("status", ["pending", "running"]).limit(1);
  assertNoDbError(error, "Comunicacao: tarefas do fluxo");

  return (data ?? []).length > 0;
}

/** Fim da ultima linha do aviso de origem no sino (null = ninguem recebeu). */
export async function lastSourceExpiry(db: CommunicationsDb, campaignId: string): Promise<number | null> {
  const { data, error } = await db
    .from("notifications")
    .select("expires_at")
    .eq("campaign_id", campaignId)
    .eq("is_test", false)
    .order("expires_at", { ascending: false })
    .limit(1);
  assertNoDbError(error, "Comunicacao: fim do aviso de origem");

  return timeOf(((data ?? []) as { expires_at: string }[])[0]?.expires_at);
}

/** Passagens (de qualquer situacao, baseline inclusive) de um fluxo: quem ja entrou nunca entra de novo. */
export async function fetchFlowRunUserIds(db: CommunicationsDb, flowId: string): Promise<Set<string>> {
  const ids = new Set<string>();

  for (let after: string | null = null; ; ) {
    let query = db.from("communication_flow_runs").select("user_id").eq("flow_id", flowId);

    if (after) {
      query = query.gt("user_id", after);
    }

    const { data, error } = await query.order("user_id").limit(1_000);
    assertNoDbError(error, "Comunicacao: passagens do fluxo");

    const rows = (data ?? []) as { user_id: string }[];
    rows.forEach((row) => ids.add(row.user_id));

    if (rows.length < 1_000) {
      return ids;
    }

    after = rows[rows.length - 1].user_id;
  }
}

/** Gravacoes do job no fluxo (contagem, faixa conferida, varredura): nao contam como edicao (gatilho). */
export async function updateFlowJobColumns(
  db: CommunicationsDb,
  flowId: string,
  patch: Partial<Pick<FlowRow, "entry_count" | "entry_counted_at" | "entry_refreshed_at" | "goal_swept_at" | "last_error">>,
  guard: { expectedUpdatedAt?: string } = {}
): Promise<boolean> {
  let query = db.from("communication_flows").update(patch).eq("id", flowId).eq("status", "active").is("deleted_at", null);

  if (guard.expectedUpdatedAt) {
    query = query.eq("updated_at", guard.expectedUpdatedAt);
  }

  const { data, error } = await query.select("id");
  assertNoDbError(error, "Comunicacao: gravar o fluxo");

  return (data ?? []).length > 0;
}

/* ------------------------------------------------------------------------------------------------
 * RPCs do motor
 * ---------------------------------------------------------------------------------------------- */

/** 7.1 Reserva ate `limit` tarefas vencidas de fluxos no ar (skip locked, carimbo unico por linha). */
export async function claimFlowTasks(db: CommunicationsDb, input: { limit: number; now: Date }): Promise<FlowTaskRow[]> {
  const rows = await callRpc<FlowTaskRow[] | null>(
    db,
    "communication_claim_flow_tasks",
    {
      p_limit: input.limit,
      p_max_attempts: FLOW_LIMITS.maxAttempts,
      p_now: input.now.toISOString(),
      p_stale_before: new Date(input.now.getTime() - FLOW_LIMITS.staleClaimMs).toISOString()
    },
    "Comunicacao: reservar tarefas dos fluxos"
  );

  return rows ?? [];
}

export type FlowEntry = {
  baseline: boolean;
  enteredAt: number;
  tasks: { anchorAt: number; deadlineAt: number | null; dueAt: number; nodeId: string }[];
  userId: string;
};

const iso = (time: number) => new Date(time).toISOString();
const isoOrNull = (time: number | null | undefined) => (typeof time === "number" && Number.isFinite(time) ? iso(time) : null);

/**
 * 7.2 Entrada num fluxo do construtor (em pedacos de 500); 0 quando o fluxo deixou de estar no ar ou mudou
 * desde a versao avaliada (`revision`, lida junto com "quem entra" e a arvore: o proximo tick refaz).
 */
export async function enrollFlow(db: CommunicationsDb, flowId: string, entries: readonly FlowEntry[], revision: number): Promise<number> {
  let entered = 0;

  for (const part of chunksOf(entries, 500)) {
    const count = await callRpc<number | null>(
      db,
      "communication_enroll_flow",
      {
        p_entries: part.map((entry) => ({
          baseline: entry.baseline,
          entered_at: iso(entry.enteredAt),
          revision,
          tasks: entry.tasks.map((task) => ({ anchor_at: iso(task.anchorAt), deadline_at: isoOrNull(task.deadlineAt), due_at: iso(task.dueAt), node_id: task.nodeId })),
          user_id: entry.userId
        })),
        p_flow_id: flowId
      },
      "Comunicacao: entrada no fluxo"
    );

    entered += count ?? 0;
  }

  return entered;
}

export type NoticeEnrollment = { backfilled: number; done: boolean; entered: number; waiting: boolean };

/** 7.3 Entrada das notificacoes seguintes (quem recebeu o aviso de origem), retomavel. */
export async function enrollNoticeRecipients(db: CommunicationsDb, input: { flowId: string; limit: number; now: Date }): Promise<NoticeEnrollment> {
  const result = await callRpc<Partial<NoticeEnrollment> | null>(
    db,
    "communication_enroll_notice_recipients",
    { p_flow_id: input.flowId, p_limit: input.limit, p_now: input.now.toISOString() },
    "Comunicacao: entrada das notificacoes seguintes"
  );

  return {
    backfilled: Number(result?.backfilled ?? 0) || 0,
    done: Boolean(result?.done),
    entered: Number(result?.entered ?? 0) || 0,
    waiting: Boolean(result?.waiting)
  };
}

/**
 * `revision`: a do fluxo lida junto com a arvore que decidiu (cache do tick). Mudou no banco = a tarefa volta
 * para a fila como stale_version (7.4); null = aplica sem conferir (a falha isolada pela bisseccao).
 */
export type FlowResult = { decision: FlowDecision; revision?: number | null; task: Pick<FlowTaskRow, "claimed_at" | "node_id" | "user_id"> };
export type FlowOutcome = { nodeId: string; notificationId: string | null; outcome: string; userId: string };

/** Uma decisao no formato de p_results do 7.4 (tempos em ISO; o carimbo da reserva como veio). */
export function resultPayload({ decision, revision, task }: FlowResult) {
  const children = "children" in decision ? decision.children : [];

  return {
    action: decision.action,
    campaign_id: decision.action === "send" ? decision.campaignId : null,
    children: children.map((child) => ({ anchor_at: iso(child.anchorAt), deadline_at: isoOrNull(child.deadlineAt), due_at: iso(child.dueAt), node_id: child.nodeId })),
    claimed_at: task.claimed_at,
    deadline_at: decision.action === "send" || decision.action === "defer" ? isoOrNull(decision.deadlineAt) : null,
    due_at: decision.action === "defer" || decision.action === "retry" ? iso(decision.dueAt) : null,
    error: decision.action === "retry" ? decision.error : decision.action === "finish" ? (decision.error ?? null) : null,
    expires_at: decision.action === "send" ? iso(decision.expiresAt) : null,
    node_id: task.node_id,
    result: decision.action === "finish" ? decision.result : null,
    revision: revision ?? null,
    user_id: task.user_id
  };
}

/** Erro de dado (22xxx) ou de restricao (23xxx) do Postgres: so a tarefa ruim falha; o resto do lote vale. */
function isDataError(error: unknown) {
  const code = (error as { code?: string | null } | null)?.code;

  return typeof code === "string" && /^2[23][0-9A-Z]{3}$/.test(code);
}

/**
 * 7.4 Aplica as decisoes de um lote numa transacao. Erro de dado ou de restricao: divide o lote ao meio
 * ate isolar a tarefa ruim, que e aplicada como "failed" com o erro (as outras gravam normalmente). Erro de
 * conexao ou de tempo e lancado: o job falha em job_runs, as reservas vencem em 2 minutos e o proximo tick
 * tenta de novo.
 */
export async function applyFlowResults(db: CommunicationsDb, input: { now: Date; results: readonly FlowResult[] }): Promise<FlowOutcome[]> {
  const { nextStart, start } = saoPauloDayBounds(input.now.getTime());
  const call = async (results: readonly FlowResult[]) => {
    const rows = await callRpc<{ outcome: string; sent_notification_id: string | null; task_node_id: string; task_user_id: string }[] | null>(
      db,
      "communication_apply_flow_results",
      {
        p_daily_cap: FLOW_LIMITS.dailyCap,
        p_day_start: iso(start),
        p_max_deferrals: FLOW_LIMITS.maxDeferrals,
        p_min_gap_minutes: FLOW_LIMITS.minGapMinutes,
        p_next_day_start: iso(nextStart),
        p_now: input.now.toISOString(),
        p_results: results.map(resultPayload)
      },
      "Comunicacao: aplicar as decisoes dos fluxos"
    );

    return (rows ?? []).map((row) => ({ nodeId: row.task_node_id, notificationId: row.sent_notification_id, outcome: row.outcome, userId: row.task_user_id }));
  };
  const run = async (results: readonly FlowResult[]): Promise<FlowOutcome[]> => {
    if (results.length === 0) {
      return [];
    }

    try {
      return await call(results);
    } catch (error) {
      if (!isDataError(error)) {
        throw error;
      }

      if (results.length > 1) {
        const middle = Math.ceil(results.length / 2);

        return [...(await run(results.slice(0, middle))), ...(await run(results.slice(middle)))];
      }

      const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000);
      console.error(`[comunicacao] tarefa ${results[0].task.node_id}/${results[0].task.user_id} falhou ao aplicar: ${message}`);

      return call([{ decision: { action: "finish", children: [], error: message, result: "failed" }, task: results[0].task }]);
    }
  };

  return run(input.results);
}

/** 7.15 Lote que falhou antes de aplicar: as reservas voltam para a fila e devolvem a tentativa. */
export async function releaseClaims(db: CommunicationsDb, tasks: readonly Pick<FlowTaskRow, "claimed_at" | "node_id" | "user_id">[]): Promise<number> {
  if (tasks.length === 0) {
    return 0;
  }

  const count = await callRpc<number | null>(
    db,
    "communication_release_flow_tasks",
    { p_claims: tasks.map((task) => ({ claimed_at: task.claimed_at, node_id: task.node_id, user_id: task.user_id })) },
    "Comunicacao: devolver tarefas dos fluxos"
  );

  return count ?? 0;
}

/** 7.6 Varredura do objetivo: acorda as tarefas que esperam ha mais tempo (menos as do limite do dia). */
export async function wakeFlowTasks(db: CommunicationsDb, input: { flowId: string; limit: number; now: Date }): Promise<number> {
  const count = await callRpc<number | null>(
    db,
    "communication_wake_flow_tasks",
    { p_flow_id: input.flowId, p_limit: input.limit, p_now: input.now.toISOString() },
    "Comunicacao: varredura do objetivo"
  );

  return count ?? 0;
}

export type FlowStatsRow = {
  active: number;
  done: number;
  ended: number;
  entered: number;
  enteredSince: number;
  flowId: string;
  goal: number;
  goalSince: number;
  overdue: number;
  sent: number;
  sentSince: number;
};

const toNumber = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0)) || 0;

/** 7.7 Numeros por fluxo (lista e topo de Fluxos). */
export async function fetchFlowStats(db: CommunicationsDb, flowIds: readonly string[], since: Date): Promise<Map<string, FlowStatsRow>> {
  const ids = Array.from(new Set(flowIds));

  if (ids.length === 0) {
    return new Map();
  }

  const rows = await callRpc<Record<string, unknown>[] | null>(
    db,
    "communication_flow_stats",
    { p_flow_ids: ids, p_since: since.toISOString() },
    "Comunicacao: numeros dos fluxos"
  );

  return new Map(
    (rows ?? []).map((row) => [
      String(row.flow_id),
      {
        active: toNumber(row.active),
        done: toNumber(row.done),
        ended: toNumber(row.ended),
        entered: toNumber(row.entered),
        enteredSince: toNumber(row.entered_since),
        flowId: String(row.flow_id),
        goal: toNumber(row.goal),
        goalSince: toNumber(row.goal_since),
        overdue: toNumber(row.overdue),
        sent: toNumber(row.sent),
        sentSince: toNumber(row.sent_since)
      }
    ])
  );
}

export const FLOW_NODE_STAT_FIELDS = [
  "reached",
  "waiting",
  "deferred_now",
  "sent",
  "yes_count",
  "no_count",
  "filtered",
  "goal",
  "expired",
  "cap",
  "failed",
  "removed",
  "received",
  "seen",
  "opened",
  "audio_started",
  "audio_completed",
  "clicked",
  "accepted",
  "declined",
  "studied_7d",
  "visited_cta"
] as const;
export type FlowNodeStats = Record<(typeof FLOW_NODE_STAT_FIELDS)[number], number>;

/** 7.8 Numeros por passo (relatorio). `ctaKeys`: passo -> chave da pagina do botao acompanhada. */
export async function fetchFlowNodeStats(db: CommunicationsDb, flowId: string, ctaKeys: Record<string, string | null>): Promise<Map<string, FlowNodeStats>> {
  const rows = await callRpc<Record<string, unknown>[] | null>(
    db,
    "communication_flow_node_stats",
    {
      p_cta_keys: Object.entries(ctaKeys)
        .filter(([, pageKey]) => pageKey)
        .map(([nodeId, pageKey]) => ({ node_id: nodeId, page_key: pageKey })),
      p_flow_id: flowId
    },
    "Comunicacao: numeros dos passos"
  );

  return new Map(
    (rows ?? []).map((row) => [String(row.node_id), Object.fromEntries(FLOW_NODE_STAT_FIELDS.map((field) => [field, toNumber(row[field])])) as FlowNodeStats])
  );
}

export type FlowBatchFactsRow = {
  accesses: { created_at: string; ends_at: string | null; starts_at: string; status: string; target_id: string; target_type: string; u: string }[];
  messages: {
    audio_completed_at: string | null;
    audio_started_at: string | null;
    campaign_id: string | null;
    clicked_at: string | null;
    expires_at: string;
    k: string;
    live: boolean | null;
    opened_at: string | null;
    response: string | null;
    seen_at: string | null;
    u: string;
    visible_at: string;
  }[];
  runs: { entered_at: string; f: string; u: string }[];
  staff: string[];
  visits: { at: string; k: string; u: string }[];
};

/** 7.9 Fatos de um lote num jsonb so: notificacoes pelas chaves, visitas, acessos, passagens e equipe. */
export async function fetchFlowBatchFacts(
  db: CommunicationsDb,
  input: { dedupeKeys: readonly string[]; flowIds: readonly string[]; pageKeys: readonly string[]; userIds: readonly string[] }
): Promise<FlowBatchFactsRow> {
  const data = await callRpc<Partial<FlowBatchFactsRow> | null>(
    db,
    "communication_flow_batch_facts",
    { p_dedupe_keys: [...input.dedupeKeys], p_flow_ids: [...input.flowIds], p_page_keys: [...input.pageKeys], p_user_ids: [...input.userIds] },
    "Comunicacao: fatos do lote dos fluxos"
  );

  return { accesses: data?.accesses ?? [], messages: data?.messages ?? [], runs: data?.runs ?? [], staff: data?.staff ?? [], visits: data?.visits ?? [] };
}

export type FlowStateChange = {
  /** Pessoa da equipe; null = o job (concluido) ou o aviso de origem. */
  actorId: string | null;
  /** Contagem de quem entra agora (500 alunos), gravada junto. */
  entryCount?: number | null;
  /** Versao lida pela tela; null = quem muda e o aviso de origem ou o proprio job. */
  expectedUpdatedAt: string | null;
  flowId: string;
  now: Date;
  /** ended: team | source_withdrawn | source_deleted | finished; active: approved | null. */
  reason?: string | null;
  to: "active" | "draft" | "ended" | "paused" | "pending_approval";
};

/** 7.13 Situacao do fluxo (ativar, aprovar, pausar, retomar, encerrar, voltar a rascunho) com o fluxo travado. */
export async function changeFlowState(db: CommunicationsDb, input: FlowStateChange): Promise<FlowRow> {
  return callRpc<FlowRow>(
    db,
    "communication_change_flow_state",
    {
      p_actor: input.actorId,
      p_entry_count: input.entryCount ?? null,
      p_expected_updated_at: input.expectedUpdatedAt,
      p_flow_id: input.flowId,
      p_now: input.now.toISOString(),
      p_reason: input.reason ?? null,
      p_to: input.to
    },
    "Comunicacao: situacao do fluxo"
  );
}

/** 7.14 Retira um passo do sino (todas as versoes); devolve quantas linhas o TS ainda vai apagar. */
export async function withdrawFlowStep(
  db: CommunicationsDb,
  input: { actorId: string; expectedUpdatedAt: string; flowId: string; nodeId: string; now: Date }
): Promise<number> {
  const count = await callRpc<number | null>(
    db,
    "communication_withdraw_flow_step",
    { p_actor: input.actorId, p_expected_updated_at: input.expectedUpdatedAt, p_flow_id: input.flowId, p_node_id: input.nodeId, p_now: input.now.toISOString() },
    "Comunicacao: retirar passo do fluxo"
  );

  return count ?? 0;
}

/* ------------------------------------------------------------------------------------------------
 * Gravacao da arvore (saveFlow do construtor e saveNoticeFollowUps do editor de avisos; docs/23 §6.2)
 * ---------------------------------------------------------------------------------------------- */

export type SaveFlowTreeInput = {
  actorId: string;
  /** Conteudo de cada passo de notificacao, pelo id do passo. */
  contents: Record<string, FlowNoticeContent>;
  /** Versao lida pela tela (fluxo existente). Sem ela, vale a versao lida agora. */
  expectedUpdatedAt?: string | null;
  flow: {
    /** So construtor (no fluxo de aviso, "quem entra" e quem recebeu o aviso). */
    entryAudience?: AudienceDefinition;
    entryMode?: FlowEntryMode;
    goal: AudienceDefinition | null;
    name: string;
    origin: FlowOrigin;
    /** So fluxo de aviso. */
    sourceCampaignId?: string | null;
  };
  /** Fluxo existente; ausente = fluxo novo (nasce rascunho). */
  flowId?: string | null;
  now: Date;
  /** A arvore inteira (passos vivos; ids do navegador). O campaignId dos passos e ignorado: a versao sai daqui. */
  tree: FlowTree;
};

export type SaveFlowTreeResult = {
  flow: FlowRow;
  /** Passos cujo conteudo ganhou versao nova (fluxo no ar) ou foi criado agora. */
  newVersions: string[];
  /** Id do navegador -> id gravado (os ids do navegador sao os ids dos passos). */
  nodeIds: Record<string, string>;
  /** Quem envia cada notificacao (para o e-mail "enviada em seu nome"). */
  senderIds: string[];
  /** Passo -> versao atual do conteudo. */
  versions: Record<string, string>;
};

/** Colunas de conteudo de uma notificacao de fluxo (sempre notificacao; sem segmento nem agenda proprios). */
export function flowContentColumns(content: FlowNoticeContent): CampaignContentColumns {
  return draftToColumns({
    ...emptyNoticeDraft("inbox"),
    ...content,
    // "Ate a notificacao principal sumir" e do passo (expire_with_anchor), nao do conteudo: aqui, 90 dias de teto.
    validity: content.validity.mode === "with_anchor" ? { mode: "default" } : content.validity
  });
}

const CONTENT_COMPARE_FIELDS = [
  "accept_label",
  "audio_duration_seconds",
  "audio_mime",
  "audio_peaks",
  "audio_url",
  "body",
  "cta_href",
  "cta_label",
  "cta_target",
  "decline_label",
  "icon",
  "icon_color",
  "image_alt",
  "image_url",
  "response_mode",
  "sender_user_id",
  "title",
  "valid_until",
  "validity_minutes"
] as const;

/** O conteudo gravado e o mesmo que o da tela? (datas comparadas pelo instante) */
function sameContent(row: CampaignRow, columns: CampaignContentColumns) {
  return CONTENT_COMPARE_FIELDS.every((field) => {
    const saved = (row as unknown as Record<string, unknown>)[field] ?? null;
    const next = (columns as unknown as Record<string, unknown>)[field] ?? null;

    if (field === "valid_until") {
      return timeOf(saved as string | null) === timeOf(next as string | null);
    }

    if (field === "audio_peaks") {
      return JSON.stringify(Array.isArray(saved) && saved.length > 0 ? saved : null) === JSON.stringify(Array.isArray(next) && next.length > 0 ? next : null);
    }

    return saved === next;
  });
}

function nodePayload(node: FlowNode, campaignId: string | null) {
  return {
    anchor: node.kind === "entry" ? "previous" : node.anchor,
    anchor_node_id: node.kind === "entry" || node.anchor === "previous" ? null : node.anchorNodeId,
    branch: node.branch,
    campaign_id: node.kind === "message" ? campaignId : null,
    condition: node.kind === "condition" && node.condition ? normalizeAudience(node.condition) : null,
    expire_with_anchor: node.kind === "message" ? node.expireWithAnchor : false,
    filter: node.kind === "message" && node.filter ? normalizeAudience(node.filter) : null,
    id: node.id,
    kind: node.kind,
    max_wait_minutes: node.kind === "condition" && node.waitUntilTrue ? node.maxWaitMinutes : null,
    offset_minutes: node.kind === "entry" ? 0 : node.offsetMinutes,
    parent_id: node.parentId,
    position: node.position,
    wait_until_true: node.kind === "condition" ? node.waitUntilTrue : false
  };
}

/**
 * Toma a versao de um fluxo fora do ar antes de editar o conteudo no lugar: aguardando aprovacao volta a
 * rascunho (7.13, cancela o pedido); rascunho ganha revision + 1 so se ninguem mudou desde a leitura (o
 * gatilho muda updated_at). 409 se mudou.
 */
async function claimFlowVersion(db: CommunicationsDb, flow: FlowRow, input: { actorId: string; expectedUpdatedAt: string; now: Date }): Promise<FlowRow> {
  if (flow.status === "pending_approval") {
    return changeFlowState(db, { actorId: input.actorId, expectedUpdatedAt: input.expectedUpdatedAt, flowId: flow.id, now: input.now, to: "draft" });
  }

  const { data, error } = await db
    .from("communication_flows")
    .update({ revision: flow.revision + 1, updated_by: input.actorId })
    .eq("id", flow.id)
    .eq("status", "draft")
    .eq("updated_at", input.expectedUpdatedAt)
    .is("deleted_at", null)
    .select(FLOW_COLUMNS);
  assertNoDbError(error, "Comunicacao: versao do fluxo");

  const claimed = ((data ?? []) as FlowRow[])[0];

  if (!claimed) {
    throw new CommunicationError(FLOW_CHANGED_MESSAGE, 409);
  }

  return claimed;
}

/**
 * Grava a arvore na ordem de §6.2: (1) fluxo novo nasce rascunho; (2) cada notificacao cujo conteudo
 * mudou: no ar ou pausado, sempre versao nova ("sent", sent_at agora; versao enviada nunca e editada no
 * lugar), em rascunho ou aguardando aprovacao, a versao rascunho e editada no lugar (ou criada para passo
 * novo); (3) communication_save_flow com a versao conferida e as paginas acompanhadas. Se (3) falhar, as
 * versoes de (2) ficam orfas e invisiveis (nenhum passo aponta para elas; a lista filtra flow_id) e saem
 * com o fluxo; a versao rascunho editada no lugar so muda depois de tomar a versao do fluxo
 * (claimFlowVersion), entao uma falha em (3) nunca deixa conteudo trocado na versao que alguem revisou.
 * Invalidar o cache (invalidateLivePopups), a auditoria e o revalidatePath ficam com a acao.
 */
export async function saveFlowTree(db: CommunicationsDb, input: SaveFlowTreeInput): Promise<SaveFlowTreeResult> {
  const nowIso = input.now.toISOString();
  // Fluxo existente: vale a origem gravada (o fluxo de aviso nunca vira do construtor, nem o contrario).
  let origin = input.flow.origin;
  let flow: FlowRow;
  let existing = new Map<string, FlowNodeRow>();

  if (input.flowId) {
    const loaded = await fetchFlowTree(db, input.flowId);

    if (!loaded) {
      throw new CommunicationError(FLOW_MISSING_MESSAGE, 404);
    }

    flow = loaded.flow;
    origin = flow.origin;

    if (flow.status === "ended") {
      throw new CommunicationError("Este fluxo foi encerrado.", 409);
    }

    if (input.expectedUpdatedAt && timeOf(input.expectedUpdatedAt) !== timeOf(flow.updated_at)) {
      throw new CommunicationError(FLOW_CHANGED_MESSAGE, 409);
    }

    existing = new Map(loaded.nodes.map((row) => [row.id, row]));
  } else {
    const { data, error } = await db
      .from("communication_flows")
      .insert({
        created_by: input.actorId,
        entry_audience: origin === "builder" ? normalizeAudience(input.flow.entryAudience ?? { kind: "everyone" }) : { kind: "everyone" },
        entry_mode: origin === "builder" ? (input.flow.entryMode ?? "current") : "current",
        goal: input.flow.goal ? normalizeAudience(input.flow.goal) : null,
        name: input.flow.name,
        origin,
        source_campaign_id: origin === "notice" ? (input.flow.sourceCampaignId ?? null) : null,
        status: "draft",
        updated_by: input.actorId
      })
      .select(FLOW_COLUMNS)
      .single();
    assertNoDbError(error, "Comunicacao: criar fluxo");
    flow = data as FlowRow;
  }

  const live = flow.status === "active" || flow.status === "paused";
  const nodes = preorderNodes(input.tree.nodes);
  const entry = nodes.find((node) => node.kind === "entry") ?? null;
  const source = origin === "notice" && flow.source_campaign_id ? await fetchCampaign(db, flow.source_campaign_id) : null;
  const metas: Record<string, FlowMessageMeta> = {};
  const columnsByNode = new Map<string, CampaignContentColumns>();

  for (const node of nodes) {
    if (node.kind !== "message") {
      continue;
    }

    const content = input.contents[node.id];

    if (!content) {
      throw new CommunicationError("Escreva um título.", 422);
    }

    const columns = flowContentColumns(content);
    columnsByNode.set(node.id, columns);
    metas[node.id] = { ...messageMetaOfRow({ ...columns, id: "" }), campaignId: "" };
  }

  if (source && entry) {
    metas[entry.id] = messageMetaOfRow(source);
  }

  const tree: FlowTree = { nodes, origin };
  const problem = [...validateFlowTree(tree, metas), ...validateFlowGoal(tree, input.flow.goal, metas)].find((issue) => issue.level === "save");

  if (problem) {
    throw new CommunicationError(problem.message, 422);
  }

  // (2) Conteudo: versao atual de cada passo existente, para comparar.
  const currentIds = nodes.map((node) => existing.get(node.id)?.campaign_id).filter((id): id is string => Boolean(id));
  const current = new Map((await fetchCampaignsByIds(db, currentIds)).map((row) => [row.id, row]));
  const versions: Record<string, string> = {};
  const toInsert: { columns: CampaignContentColumns; nodeId: string }[] = [];
  let expectedUpdatedAt = input.flowId ? (input.expectedUpdatedAt ?? flow.updated_at) : flow.updated_at;
  const editsInPlace = Array.from(columnsByNode).some(([nodeId, columns]) => {
    const row = current.get(existing.get(nodeId)?.campaign_id ?? "");

    return Boolean(row && row.flow_id === flow.id && !live && row.status === "draft" && !sameContent(row, columns));
  });

  // Rascunho editado no lugar so depois de tomar a versao: se o RPC (3) recusar, a versao ja mudou (quem
  // aprovar ou ativar com a versao que revisou recebe 409, nunca o conteudo trocado) e um pedido de
  // aprovacao ja foi cancelado (o fluxo volta a rascunho antes de qualquer conteudo mudar).
  if (input.flowId && editsInPlace) {
    flow = await claimFlowVersion(db, flow, { actorId: input.actorId, expectedUpdatedAt: flow.updated_at, now: input.now });
    expectedUpdatedAt = flow.updated_at;
  }

  for (const [nodeId, columns] of columnsByNode) {
    const row = current.get(existing.get(nodeId)?.campaign_id ?? "");

    if (row && row.flow_id === flow.id && sameContent(row, columns)) {
      versions[nodeId] = row.id;
      continue;
    }

    if (row && row.flow_id === flow.id && !live && row.status === "draft") {
      const { data, error } = await db
        .from("campaigns")
        .update({ ...columns, updated_by: input.actorId })
        .eq("id", row.id)
        .eq("flow_id", flow.id)
        .eq("status", "draft")
        .select("id");
      assertNoDbError(error, "Comunicacao: gravar notificacao do fluxo");

      if ((data ?? []).length === 1) {
        versions[nodeId] = row.id;
        continue;
      }
    }

    toInsert.push({ columns, nodeId });
  }

  if (toInsert.length > 0) {
    const { data, error } = await db
      .from("campaigns")
      .insert(
        toInsert.map(({ columns, nodeId }) => ({
          ...columns,
          created_by: input.actorId,
          flow_id: flow.id,
          flow_node_id: nodeId,
          sent_at: live ? nowIso : null,
          status: live ? "sent" : "draft",
          updated_by: input.actorId
        }))
      )
      .select("id,flow_node_id");
    assertNoDbError(error, "Comunicacao: criar notificacao do fluxo");

    for (const row of (data ?? []) as { flow_node_id: string; id: string }[]) {
      versions[row.flow_node_id] = row.id;
    }
  }

  // (3) A arvore, com a versao conferida. Paginas acompanhadas pelas regras e pelos botoes.
  const watched = watchedPageKeysOf(tree, input.flow.goal, metas, source?.cta_href ?? null);
  const flowPayload: Record<string, unknown> = {
    goal: input.flow.goal ? normalizeAudience(input.flow.goal) : null,
    name: input.flow.name,
    watched_page_keys: watched
  };

  if (origin === "builder") {
    if (input.flow.entryAudience) {
      flowPayload.entry_audience = normalizeAudience(input.flow.entryAudience);
    }

    if (input.flow.entryMode) {
      flowPayload.entry_mode = input.flow.entryMode;
    }
  }

  const saved = await callRpc<FlowRow>(
    db,
    "communication_save_flow",
    {
      p_actor: input.actorId,
      p_expected_updated_at: expectedUpdatedAt,
      p_flow: flowPayload,
      p_flow_id: flow.id,
      p_nodes: nodes.map((node) => nodePayload(node, versions[node.id] ?? null)),
      p_now: nowIso
    },
    "Comunicacao: gravar fluxo"
  );

  return {
    flow: saved,
    newVersions: toInsert.map((item) => item.nodeId),
    nodeIds: Object.fromEntries(nodes.map((node) => [node.id, node.id])),
    senderIds: Array.from(new Set(Array.from(columnsByNode.values(), (columns) => columns.sender_user_id).filter((id): id is string => Boolean(id)))).sort(),
    versions
  };
}
