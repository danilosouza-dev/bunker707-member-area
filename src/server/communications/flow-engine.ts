import "server-only";

// Motor dos fluxos e das notificacoes seguintes (docs/23 §4.3): fase 2 do job "comunicacao", depois dos
// envios e pop-ups da v1, no mesmo tick de minuto, com orcamento proprio (25 s). Cada passo e limitado e
// para quando o tick e abortado ou o orcamento acaba.
//
// 0. Ha trabalho? Tres consultas pequenas (tarefa vencida ou presa de fluxo no ar; fluxo do construtor com
//    entrada a fazer; fluxo de aviso esperando quem recebeu, so se o aviso ja saiu) e, no minuto da faixa
//    de 15 minutos, mais uma (objetivo a varrer, fluxo que pode ter terminado). Nada: volta sem ler aluno.
// 1. Entrada das notificacoes seguintes (RPC 7.3), ate 3 fluxos por tick.
// 2. Entrada dos fluxos do construtor recem-ativados ou com "quem entra" mudado (baseline no "so quem
//    entrar depois"), e 3. a entrada continua na faixa de 15 minutos: avaliam "quem entra" sobre os fatos do
//    tick (o carregador compartilhado com a v1) e gravam pelo RPC 7.2, ate 5.000 por tick.
// 4. Tarefas vencidas em lotes de 150 (ate 20 lotes): reserva (7.1), fatos do lote, decisoes puras
//    (flow-model.ts) e uma aplicacao atomica (7.4, com bisseccao). Lote que falha antes de aplicar devolve
//    as reservas e a tentativa (7.15).
// 5. Varredura do objetivo (uma vez por faixa) e 6. fim automatico (Concluido) dos fluxos sem mais nada.

import { resolveAudienceUserIds } from "./audience";
import { collectMessageCampaignIds } from "./audience-model";
import { popupRefreshDueBefore } from "./campaign-model";
import { describeError, isMissingCommunicationSchema, type CommunicationsDb } from "./db";
import { createFactsLoader, type FactsLoader } from "./facts-loader";
import { createFlowTickCache, loadFlowBatchContext } from "./flow-facts";
import { childTasksOf, decideFlowTask, entryOf, FLOW_LIMITS, type FlowDecision } from "./flow-model";
import {
  applyFlowResults,
  changeFlowState,
  claimFlowTasks,
  definitionOf,
  enrollFlow,
  enrollNoticeRecipients,
  fetchFlowNodes,
  fetchFlowRunUserIds,
  flowHasOpenTasks,
  lastSourceExpiry,
  nodeOfRow,
  preorderNodes,
  probeBuilderEntry,
  probeDueFlowTasks,
  probeNoticeEntry,
  probeSlotWork,
  releaseClaims,
  updateFlowJobColumns,
  wakeFlowTasks,
  type FlowEntry,
  type FlowOutcome,
  type FlowRow
} from "./flow-store";

/** Fluxos por tick em cada passo de entrada (1, 2 e 3). */
export const FLOW_ENTRY_FLOWS_PER_TICK = 3;
const SLOT_MS = FLOW_LIMITS.pollMinutes * 60_000;

export type FlowsPhaseResult = {
  backfilled: number;
  /** Tarefas reservadas (conferidas). */
  claimed: number;
  /** Condicoes decididas (Sim ou Nao). */
  decided: number;
  /** Adiadas: ainda nao era a hora, limite do dia ou intervalo de 1 h, nova tentativa, devolvidas. */
  deferred: number;
  /** Alunos que entraram (passagem ativa). */
  entered: number;
  failed: number;
  finished: number;
  ms: number;
  pendingMigration: boolean;
  sent: number;
  /** Puladas: fora do filtro, venceu o prazo, limite do dia, objetivo, retirada, passo removido, fluxo encerrado. */
  skipped: number;
  /** Tarefas acordadas pela varredura do objetivo. */
  woken: number;
  /** Houve trabalho neste tick (vale gravar as contagens em job_runs). */
  worked: boolean;
};

export const EMPTY_FLOWS: FlowsPhaseResult = {
  backfilled: 0,
  claimed: 0,
  decided: 0,
  deferred: 0,
  entered: 0,
  failed: 0,
  finished: 0,
  ms: 0,
  pendingMigration: false,
  sent: 0,
  skipped: 0,
  woken: 0,
  worked: false
};

const DEFERRED_OUTCOMES = new Set(["defer", "deferred", "retry", "released", "stale_version"]);
const SKIPPED_OUTCOMES = new Set(["canceled", "cap_skipped", "expired", "filtered", "goal", "withdrawn"]);

function tally(result: FlowsPhaseResult, outcomes: readonly FlowOutcome[]) {
  for (const { outcome } of outcomes) {
    if (outcome === "send") {
      result.sent += 1;
    } else if (outcome === "yes" || outcome === "no") {
      result.decided += 1;
    } else if (outcome === "failed") {
      result.failed += 1;
    } else if (DEFERRED_OUTCOMES.has(outcome)) {
      result.deferred += 1;
    } else if (SKIPPED_OUTCOMES.has(outcome)) {
      result.skipped += 1;
    }
  }
}

/** Decisao de uma tarefa cujo passo ou fluxo saiu do cache vivo: o RPC cancela (removido, encerrado) ou falha. */
const MISSING_STEP: FlowDecision = { action: "finish", children: [], error: "Passo nao encontrado.", result: "failed" };

/**
 * Fase dos fluxos do job "comunicacao". Banco sem a migracao 202610200002: registra e volta com
 * `pendingMigration` (o tick continua verde). Outros erros sobem (o job falha em job_runs).
 */
export async function processFlows(input: {
  budgetMs?: number;
  db: CommunicationsDb;
  facts?: FactsLoader;
  now?: Date;
  signal?: AbortSignal;
}): Promise<FlowsPhaseResult> {
  const startedAt = Date.now();
  const { db, signal } = input;
  const now = input.now ?? new Date();
  const deadline = startedAt + (input.budgetMs ?? FLOW_LIMITS.phaseBudgetMs);
  const facts = input.facts ?? createFactsLoader(db, now);
  const result: FlowsPhaseResult = { ...EMPTY_FLOWS };
  const stop = () => Boolean(signal?.aborted) || Date.now() >= deadline;
  const slot = new Date(popupRefreshDueBefore(now.getTime(), SLOT_MS));
  // Minuto da faixa: o primeiro tick de cada faixa de 15 minutos faz a varredura e o fim automatico.
  const slotMinute = now.getTime() - slot.getTime() < 60_000;

  try {
    const [dueTasks, builderFlows, noticeFlows, slotFlows] = await Promise.all([
      probeDueFlowTasks(db, now),
      probeBuilderEntry(db, slot, FLOW_ENTRY_FLOWS_PER_TICK),
      probeNoticeEntry(db, FLOW_ENTRY_FLOWS_PER_TICK),
      slotMinute ? probeSlotWork(db, slot) : Promise.resolve([] as FlowRow[])
    ]);

    if (!dueTasks && builderFlows.length === 0 && noticeFlows.length === 0 && slotFlows.length === 0) {
      return { ...result, ms: Date.now() - startedAt };
    }

    result.worked = true;

    // 1. Notificacoes seguintes: quem recebeu o aviso de origem (e o complemento de uma seguinte nova).
    for (const { flowId } of noticeFlows) {
      if (stop()) {
        break;
      }

      const enrollment = await enrollNoticeRecipients(db, { flowId, limit: FLOW_LIMITS.entryPerTick, now });
      result.entered += enrollment.entered;
      result.backfilled += enrollment.backfilled;
    }

    // 2 e 3. Fluxos do construtor: entrada inicial (ou refeita) e entrada continua.
    let enrolledThisTick = 0;

    for (const flow of builderFlows) {
      if (stop() || enrolledThisTick >= FLOW_LIMITS.entryPerTick) {
        break;
      }

      const entered = await enterBuilderFlow({ budget: FLOW_LIMITS.entryPerTick - enrolledThisTick, db, facts, flow, now });
      enrolledThisTick += entered.written;
      result.entered += entered.active;
    }

    // 4. Tarefas vencidas.
    if (dueTasks || result.entered > 0 || result.backfilled > 0) {
      await runDueTasks({ db, now, result, stop });
    }

    // 5 e 6. Uma vez por faixa: varredura do objetivo e fim automatico.
    for (const flow of slotFlows) {
      if (stop()) {
        break;
      }

      if (flow.goal && (!flow.goal_swept_at || Date.parse(flow.goal_swept_at) < slot.getTime())) {
        result.woken += await wakeFlowTasks(db, { flowId: flow.id, limit: FLOW_LIMITS.goalSweepPerSlot, now });
        await updateFlowJobColumns(db, flow.id, { goal_swept_at: slot.toISOString() });
      }

      if (await mayFinish(db, flow, now)) {
        await changeFlowState(db, { actorId: null, expectedUpdatedAt: null, flowId: flow.id, now, reason: "finished", to: "ended" }).then(
          () => {
            result.finished += 1;
          },
          (error: unknown) => console.error(`[comunicacao] fluxo ${flow.id} nao concluido: ${describeError(error)}`)
        );
      }
    }
  } catch (error) {
    if (isMissingCommunicationSchema(error)) {
      console.error("[comunicacao] tabelas dos fluxos ausentes (migracao 202610200002 pendente); nada a fazer.");
      return { ...result, ms: Date.now() - startedAt, pendingMigration: true };
    }

    throw error;
  }

  return { ...result, ms: Date.now() - startedAt };
}

/**
 * Entrada de um fluxo do construtor: quem combina com "quem entra" agora (fatos do tick) e ainda nao tem
 * passagem. entry_refreshed_at nulo (recem-ativado, regras mudadas no ar): "so quem esta agora" e "e quem
 * entrar depois" entram de verdade; "so quem entrar a partir de agora" grava baseline (nunca entra). Faixa
 * vencida no modo continuo: quem passou a combinar entra. Ninguem faltando: grava a faixa e a contagem (so
 * se o fluxo nao mudou no meio; senao o proximo tick refaz com as regras atuais).
 */
async function enterBuilderFlow(input: { budget: number; db: CommunicationsDb; facts: FactsLoader; flow: FlowRow; now: Date }) {
  const { db, flow, now } = input;
  const audience = definitionOf(flow.entry_audience) ?? { kind: "everyone" };
  const loaded = await input.facts.load(collectMessageCampaignIds(audience));
  const matching = resolveAudienceUserIds(audience, loaded);
  const already = await fetchFlowRunUserIds(db, flow.id);
  const missing = matching.filter((userId) => !already.has(userId));
  const baseline = flow.entry_refreshed_at === null && flow.entry_mode === "new_only";
  const batch = missing.slice(0, Math.max(0, input.budget));
  let active = 0;

  if (batch.length > 0) {
    const nodes = preorderNodes((await fetchFlowNodes(db, [flow.id])).map(nodeOfRow));
    const tree = { nodes, origin: flow.origin };
    const entry = entryOf(tree);
    const nowMs = now.getTime();
    const tasks = entry && !baseline ? childTasksOf(entry, null, tree, { completedAt: nowMs, expiresAt: () => null, sentAt: () => null }) : [];
    const entries: FlowEntry[] = batch.map((userId) => ({ baseline, enteredAt: nowMs, tasks, userId }));

    active = await enrollFlow(db, flow.id, entries);

    if (active === 0 && !baseline) {
      // Fluxo pausado, encerrado ou excluido entre a avaliacao e agora: ninguem entrou.
      return { active: 0, written: batch.length };
    }
  }

  if (missing.length <= batch.length) {
    await updateFlowJobColumns(
      db,
      flow.id,
      { entry_count: matching.length, entry_counted_at: now.toISOString(), entry_refreshed_at: now.toISOString() },
      { expectedUpdatedAt: flow.updated_at }
    );
  }

  return { active, written: batch.length };
}

/** Lotes de 150 tarefas vencidas ate 20 lotes por tick ou o fim do orcamento. */
async function runDueTasks(input: { db: CommunicationsDb; now: Date; result: FlowsPhaseResult; stop: () => boolean }) {
  const { db, now, result } = input;
  const cache = createFlowTickCache();

  for (let batchIndex = 0; batchIndex < FLOW_LIMITS.maxBatchesPerTick && !input.stop(); batchIndex += 1) {
    const tasks = await claimFlowTasks(db, { limit: FLOW_LIMITS.batchSize, now });

    if (tasks.length === 0) {
      return;
    }

    result.claimed += tasks.length;

    let decisions;

    try {
      const items = await loadFlowBatchContext(db, tasks, now, cache);
      decisions = items.map((item) => ({ decision: item.input ? decideFlowTask(item.input) : MISSING_STEP, task: item.task }));
    } catch (error) {
      // Nada foi aplicado: as reservas voltam para a fila e a tentativa e devolvida (so queda de tick conta).
      console.error(`[comunicacao] lote de ${tasks.length} tarefa(s) dos fluxos devolvido: ${describeError(error)}`);
      await releaseClaims(db, tasks).catch((releaseError: unknown) =>
        console.error(`[comunicacao] tarefas dos fluxos nao devolvidas (voltam em 2 minutos): ${describeError(releaseError)}`)
      );
      result.deferred += tasks.length;

      if (isMissingCommunicationSchema(error)) {
        throw error;
      }

      return;
    }

    tally(result, await applyFlowResults(db, { now, results: decisions }));

    if (tasks.length < FLOW_LIMITS.batchSize) {
      return;
    }
  }
}

/**
 * Fluxo que pode terminar (Concluido): construtor "so quem esta agora" com a entrada feita e nada pendente;
 * aviso com todos dentro, nada pendente e todas as linhas do aviso de origem ja fora do sino (ate la o
 * fluxo fica no ar sem custo: e o que deixa a equipe acrescentar uma seguinte depois).
 */
async function mayFinish(db: CommunicationsDb, flow: FlowRow, now: Date) {
  const builderDone = flow.origin === "builder" && flow.entry_mode === "current" && flow.entry_refreshed_at !== null;
  const noticeDone = flow.origin === "notice" && flow.entry_completed_at !== null && flow.source_campaign_id !== null;

  if ((!builderDone && !noticeDone) || (await flowHasOpenTasks(db, flow.id))) {
    return false;
  }

  if (noticeDone) {
    const lastExpiry = await lastSourceExpiry(db, flow.source_campaign_id as string);

    return lastExpiry === null || lastExpiry < now.getTime();
  }

  return true;
}
