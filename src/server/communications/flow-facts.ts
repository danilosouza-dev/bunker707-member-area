import "server-only";

// Fatos de um lote do motor dos fluxos (docs/23 §4.3, passo 4b). Por tick, ficam em cache os fluxos, as
// arvores vivas, o conteudo atual de cada passo (e do aviso de origem) e, so quando alguma regra pede, o
// indice de aulas e a contagem de comentarios. Por lote de ate 150 tarefas, UMA chamada ao RPC
// communication_flow_batch_facts traz as notificacoes pelas chaves (passos do fluxo, aviso de origem e
// avisos citados por regras), as visitas das paginas acompanhadas, os acessos, a passagem de cada aluno e
// quem e da equipe. Progresso, turmas, entrada e comentarios so sao lidos (loadAudienceFactsFor, so para
// os alunos do lote) quando alguma regra dos fluxos do lote usa. O limite do dia nao e lido aqui: so o RPC
// de aplicacao decide. As lives de cada aluno (regra "Participação em lives") so sao lidas, so para os alunos do
// lote, quando alguma regra dos fluxos do lote usa (communication_webinar_facts).

import { fetchPublishedLessonIndex } from "@/server/students/store";
import {
  accessOnlyFacts,
  fetchCommentCounts,
  loadAudienceFactsFor,
  loadWebinarFacts,
  messageFactOf,
  type AudienceEntitlementRow
} from "./audience-facts";
import {
  audienceFactNeeds,
  buildCommentRanks,
  collectMessageCampaignIds,
  messageRefKey,
  type AudienceCommentCounts,
  type AudienceContext,
  type AudienceDefinition,
  type AudienceStudentFacts,
  type MessageFact
} from "./audience-model";
import type { CommunicationsDb } from "./db";
import { entryOf, flowDefinitionsOf, watchedPageKeysOf, type DecideInput, type FlowMessageMeta, type FlowTree } from "./flow-model";
import {
  definitionOf,
  fetchFlowBatchFacts,
  fetchFlowMessageMeta,
  fetchFlowNodes,
  fetchFlowsByIds,
  nodeOfRow,
  preorderNodes,
  taskInputOf,
  type FlowBatchFactsRow,
  type FlowRow,
  type FlowTaskRow
} from "./flow-store";
import { pageKeyOfHref } from "../member-area/page-visit-model";

/**
 * Cache de um tick: o que nao muda entre um lote e outro do mesmo minuto. Fluxo com tarefa devolvida como
 * stale_version sai do cache (forgetFlows) e o proximo lote rele a arvore atual.
 */
export type FlowTickCache = {
  commentCounts: Promise<Map<string, AudienceCommentCounts>> | null;
  flows: Map<string, FlowRow>;
  lessonIndex: Promise<Map<string, Set<string>>> | null;
  /** Conteudo pelo id da versao (ou do aviso de origem). */
  metas: Map<string, FlowMessageMeta>;
  trees: Map<string, FlowTree>;
};

export function createFlowTickCache(): FlowTickCache {
  return { commentCounts: null, flows: new Map(), lessonIndex: null, metas: new Map(), trees: new Map() };
}

/** O fluxo mudou no meio do tick (stale_version): o proximo lote rele o fluxo e a arvore. */
export function forgetFlows(cache: FlowTickCache, flowIds: Iterable<string>) {
  for (const id of flowIds) {
    cache.flows.delete(id);
    cache.trees.delete(id);
  }
}

/**
 * Tarefa do lote com tudo o que a decisao precisa; `input` null = passo ou fluxo que nao esta mais vivo.
 * `revision`: a do fluxo lida antes da arvore (vai junto com a decisao; 7.4 recusa se mudou).
 */
export type FlowBatchItem = { input: DecideInput | null; revision: number | null; task: FlowTaskRow };

function timeOf(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) ? time : null;
}

function guarded<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/**
 * Fluxos e arvores do lote no cache; fluxo com passo que o cache nao conhece e relido (passo novo no meio do
 * tick). O fluxo e lido ANTES dos passos: a revision guardada nunca e mais nova que a arvore (uma gravacao no
 * meio deixa a revision velha, e 7.4 devolve a tarefa como stale_version em vez de aplicar a arvore velha).
 */
async function ensureFlows(db: CommunicationsDb, tasks: readonly FlowTaskRow[], cache: FlowTickCache) {
  const flowIds = Array.from(new Set(tasks.map((task) => task.flow_id)));
  const stale = new Set(flowIds.filter((id) => !cache.flows.has(id)));

  for (const task of tasks) {
    const tree = cache.trees.get(task.flow_id);

    if (tree && !tree.nodes.some((node) => node.id === task.node_id)) {
      stale.add(task.flow_id);
    }
  }

  if (stale.size === 0) {
    return;
  }

  const ids = Array.from(stale);
  const flows = await fetchFlowsByIds(db, ids);
  const nodes = await fetchFlowNodes(db, ids);

  for (const flow of flows) {
    cache.flows.set(flow.id, flow);
    cache.trees.set(flow.id, {
      nodes: preorderNodes(nodes.filter((row) => row.flow_id === flow.id).map(nodeOfRow)),
      origin: flow.origin
    });
  }
}

/** Conteudo atual de cada passo de notificacao e do aviso de origem, no cache por id da versao. */
async function ensureMetas(db: CommunicationsDb, flows: readonly FlowRow[], cache: FlowTickCache) {
  const wanted = new Set<string>();

  for (const flow of flows) {
    for (const node of cache.trees.get(flow.id)?.nodes ?? []) {
      if (node.kind === "message" && node.campaignId) {
        wanted.add(node.campaignId);
      }
    }

    if (flow.source_campaign_id) {
      wanted.add(flow.source_campaign_id);
    }
  }

  const missing = Array.from(wanted).filter((id) => !cache.metas.has(id));

  if (missing.length > 0) {
    for (const [id, meta] of await fetchFlowMessageMeta(db, missing)) {
      cache.metas.set(id, meta);
    }
  }
}

/** O que cada fluxo do lote pede ao RPC de fatos e o que a avaliacao precisa saber dele. */
type FlowPlan = {
  /** Passo -> chave da pagina do botao (null = externo ou nao acompanhado). */
  ctaPageKeys: Record<string, string | null>;
  dedupeKeys: string[];
  definitions: AudienceDefinition[];
  entryId: string | null;
  flow: FlowRow;
  goal: AudienceDefinition | null;
  /** Conteudo pelo id do passo (a entrada de um fluxo de aviso = o aviso de origem). */
  messagesByNode: Record<string, FlowMessageMeta>;
  messageKeys: string[];
  pageKeys: string[];
  tree: FlowTree;
};

function planOf(flow: FlowRow, tree: FlowTree, cache: FlowTickCache): FlowPlan {
  const goal = definitionOf(flow.goal);
  const definitions = flowDefinitionsOf(tree, goal);
  const entry = entryOf(tree);
  const source = flow.source_campaign_id ? (cache.metas.get(flow.source_campaign_id) ?? null) : null;
  const messagesByNode: Record<string, FlowMessageMeta> = {};
  const dedupeKeys: string[] = [];
  const messageKeys: string[] = [];
  const ctaPageKeys: Record<string, string | null> = {};

  for (const node of tree.nodes) {
    if (node.kind === "message") {
      dedupeKeys.push(`flow:${node.id}`);
      messageKeys.push(messageRefKey({ kind: "node", nodeId: node.id }));

      const meta = node.campaignId ? cache.metas.get(node.campaignId) : undefined;

      if (meta) {
        messagesByNode[node.id] = meta;
      }

      ctaPageKeys[node.id] = pageKeyOfHref(meta?.ctaHref ?? null);
    }
  }

  if (flow.origin === "notice" && flow.source_campaign_id && entry) {
    dedupeKeys.push(`campaign:${flow.source_campaign_id}`);
    messageKeys.push(messageRefKey({ kind: "node", nodeId: entry.id }), messageRefKey({ campaignId: flow.source_campaign_id, kind: "campaign" }));
    ctaPageKeys[entry.id] = pageKeyOfHref(source?.ctaHref ?? null);

    if (source) {
      messagesByNode[entry.id] = source;
    }
  }

  for (const campaignId of collectMessageCampaignIds(definitions)) {
    dedupeKeys.push(`campaign:${campaignId}`);
    messageKeys.push(messageRefKey({ campaignId, kind: "campaign" }));
  }

  const pageKeys = new Set([...(flow.watched_page_keys ?? []), ...watchedPageKeysOf(tree, goal, messagesByNode, source?.ctaHref ?? null)]);

  return { ctaPageKeys, dedupeKeys, definitions, entryId: entry?.id ?? null, flow, goal, messageKeys, messagesByNode, pageKeys: Array.from(pageKeys), tree };
}

function groupByUser<Row extends { u: string }>(rows: readonly Row[]) {
  const groups = new Map<string, Row[]>();

  for (const row of rows) {
    const list = groups.get(row.u);

    if (list) {
      list.push(row);
    } else {
      groups.set(row.u, [row]);
    }
  }

  return groups;
}

/**
 * As notificacoes de um aluno pelas chaves das regras: "flow:<passo>" vira "node:<passo>"; o aviso de
 * origem ("campaign:<aviso>") vale como "campaign:<aviso>" e como "node:<entrada>" do fluxo de aviso. Linha de
 * passo retirado (aviso nao "sent") nao conta: como se nao tivesse recebido.
 */
function messagesOfUser(rows: readonly FlowBatchFactsRow["messages"][number][], entryBySource: ReadonlyMap<string, string[]>) {
  const messages: Record<string, MessageFact> = {};

  for (const row of rows) {
    if (row.live === false) {
      continue;
    }

    const fact = messageFactOf(row);

    if (row.k.startsWith("flow:")) {
      messages[messageRefKey({ kind: "node", nodeId: row.k.slice("flow:".length) })] = fact;
    } else if (row.k.startsWith("campaign:")) {
      const campaignId = row.k.slice("campaign:".length);

      messages[row.k] = fact;

      for (const entryId of entryBySource.get(campaignId) ?? []) {
        messages[messageRefKey({ kind: "node", nodeId: entryId })] = fact;
      }
    }
  }

  return messages;
}

/**
 * Tudo o que as decisoes de um lote precisam, sem decidir nada: fluxos, arvores e conteudo (cache do tick),
 * um RPC de fatos do lote e, so se alguma regra pedir, os fatos completos destes alunos.
 */
export async function loadFlowBatchContext(
  db: CommunicationsDb,
  tasks: readonly FlowTaskRow[],
  now: Date,
  cache: FlowTickCache = createFlowTickCache()
): Promise<FlowBatchItem[]> {
  const nowMs = now.getTime();

  if (tasks.length === 0) {
    return [];
  }

  await ensureFlows(db, tasks, cache);

  const flows = Array.from(new Set(tasks.map((task) => task.flow_id)))
    .map((id) => cache.flows.get(id))
    .filter((flow): flow is FlowRow => Boolean(flow));

  await ensureMetas(db, flows, cache);

  const plans = new Map(flows.map((flow) => [flow.id, planOf(flow, cache.trees.get(flow.id) ?? { nodes: [], origin: flow.origin }, cache)]));
  const planList = Array.from(plans.values());
  const userIds = Array.from(new Set(tasks.map((task) => task.user_id))).sort();
  const batch = await fetchFlowBatchFacts(db, {
    dedupeKeys: Array.from(new Set(planList.flatMap((plan) => plan.dedupeKeys))).sort(),
    flowIds: flows.map((flow) => flow.id).sort(),
    pageKeys: Array.from(new Set(planList.flatMap((plan) => plan.pageKeys))).sort(),
    userIds
  });
  const staff = new Set(batch.staff);
  const accessesByUser = new Map(
    Array.from(groupByUser(batch.accesses), ([userId, rows]) => [
      userId,
      rows.map((row): AudienceEntitlementRow => ({
        created_at: row.created_at,
        ends_at: row.ends_at,
        starts_at: row.starts_at,
        status: row.status as AudienceEntitlementRow["status"],
        target_id: row.target_id,
        target_type: row.target_type as AudienceEntitlementRow["target_type"],
        user_id: userId
      }))
    ])
  );
  const messagesByUser = groupByUser(batch.messages);
  const visitsByUser = groupByUser(batch.visits);
  const enteredAt = new Map(batch.runs.map((run) => [`${run.f}|${run.u}`, timeOf(run.entered_at)]));
  const entryBySource = new Map<string, string[]>();

  for (const plan of planList) {
    if (plan.flow.origin === "notice" && plan.flow.source_campaign_id && plan.entryId) {
      entryBySource.set(plan.flow.source_campaign_id, [...(entryBySource.get(plan.flow.source_campaign_id) ?? []), plan.entryId]);
    }
  }

  // Progresso, turmas, entrada e comentarios: so quando alguma regra dos fluxos do lote usa. As lives (regra
  // "Participação em lives"): so destes alunos, so quando alguma regra pede; null num banco sem a migracao.
  const needs = audienceFactNeeds(planList.flatMap((plan) => plan.definitions));
  const baseFacts = new Map<string, AudienceStudentFacts>();
  let baseContext: Pick<AudienceContext, "commentRanks" | "lessonTotals"> = { commentRanks: buildCommentRanks([]), lessonTotals: {} };
  const webinarFacts = needs.webinars ? await loadWebinarFacts(db, { userIds }) : null;

  if (needs.students) {
    // O indice de aulas so para progresso, ritmo e turma (audienceFactNeeds.lessons); entrada, ultimo estudo e
    // comentarios nao usam.
    if (needs.lessons) {
      cache.lessonIndex ??= guarded(fetchPublishedLessonIndex(db));
    }

    if (needs.comments !== "none") {
      cache.commentCounts ??= guarded(fetchCommentCounts(db));
    }

    const loaded = await loadAudienceFactsFor(db, userIds, now, {
      commentCounts: needs.comments === "none" ? undefined : await cache.commentCounts!,
      comments: needs.comments,
      entitlements: Array.from(accessesByUser.values()).flat(),
      lessonIndex: needs.lessons ? await cache.lessonIndex! : new Map<string, Set<string>>(),
      staff
    });

    loaded.facts.forEach((fact) => baseFacts.set(fact.userId, fact));
    baseContext = { commentRanks: loaded.context.commentRanks, lessonTotals: loaded.context.lessonTotals };
  }

  const ctaPageKeys = Object.assign({}, ...planList.map((plan) => plan.ctaPageKeys)) as Record<string, string | null>;
  const messageKeys = new Set(planList.flatMap((plan) => plan.messageKeys));
  const context: AudienceContext = { ...baseContext, flow: { ctaPageKeys }, messageKeys, now: nowMs, ...(webinarFacts ? { webinarFactsLoaded: true } : {}) };
  const userMessages = new Map(userIds.map((userId) => [userId, messagesOfUser(messagesByUser.get(userId) ?? [], entryBySource)]));
  const userVisits = new Map(
    userIds.map((userId) => [
      userId,
      Object.fromEntries(
        (visitsByUser.get(userId) ?? []).map((visit) => [visit.k, timeOf(visit.at)]).filter((entry): entry is [string, number] => entry[1] !== null)
      ) as Record<string, number>
    ])
  );

  return tasks.map((task) => {
    const plan = plans.get(task.flow_id);
    const node = plan?.tree.nodes.find((item) => item.id === task.node_id);

    if (!plan || !node) {
      return { input: null, revision: plan?.flow.revision ?? null, task };
    }

    const base = baseFacts.get(task.user_id) ?? accessOnlyFacts(task.user_id, accessesByUser.get(task.user_id) ?? [], nowMs);
    const entered = enteredAt.get(`${task.flow_id}|${task.user_id}`) ?? null;
    const lives = webinarFacts?.get(task.user_id);
    const facts: AudienceStudentFacts = {
      ...base,
      messages: userMessages.get(task.user_id) ?? {},
      ...(entered === null ? {} : { flow: { enteredAt: entered, pageVisits: userVisits.get(task.user_id) ?? {} } }),
      ...(lives ? { webinars: lives } : {})
    };

    return {
      input: {
        context,
        facts,
        goal: plan.goal,
        message: node.kind === "message" ? (plan.messagesByNode[node.id] ?? null) : null,
        node,
        now: nowMs,
        staff: staff.has(task.user_id),
        task: taskInputOf(task),
        tree: plan.tree
      },
      revision: plan.flow.revision,
      task
    };
  });
}
