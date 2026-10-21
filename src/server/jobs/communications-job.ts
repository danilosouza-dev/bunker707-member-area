import "server-only";

// Job do tick de minuto da Comunicacao (docs/22 §4.2 e §4.3; docs/23 §4.3; docs/04, secao Jobs), em duas fases
// que dividem um carregador de fatos so (facts-loader.ts: os alunos sao lidos no maximo uma vez por tick):
// 1. v1: envia as notificacoes do sino agendadas que venceram (ate 3 por tick, em lotes de 500 alunos,
//    retomavel) e recalcula quem ve cada pop-up no ar (ate 5 por tick, a cada 15 minutos);
// 2. fluxos e notificacoes seguintes (flow-engine.ts), com orcamento proprio de 25 s; sem trabalho, tres
//    consultas pequenas e nenhum aluno lido.
// Idempotente: cada aviso e reservado antes do envio, cada tarefa de fluxo tambem, e o mesmo aluno nunca
// recebe a mesma notificacao duas vezes. Banco vazio ou sem as migracoes 202610200001/202610200002:
// registra e termina sem erro (o tick continua verde). Quando os fluxos trabalharam, as contagens vao para
// job_runs.metadata da linha deste job ({ tick_run_id, flows }: o tick_run_id gravado pelo run-tick.ts fica).

import { processCommunications } from "@/server/communications/dispatch";
import { createFactsLoader } from "@/server/communications/facts-loader";
import { EMPTY_FLOWS, processFlows, type FlowsPhaseResult } from "@/server/communications/flow-engine";
import { FLOW_LIMITS } from "@/server/communications/flow-model";
import type { Job, JobContext } from "./registry";

export const COMMUNICATIONS_JOB_NAME = "comunicacao";

/** Contagens da fase dos fluxos em job_runs.metadata (so ids e numeros). */
async function recordJobMetrics(ctx: JobContext, flows: FlowsPhaseResult, jobMs: number) {
  const counts = {
    backfilled: flows.backfilled,
    claimed: flows.claimed,
    decided: flows.decided,
    deferred: flows.deferred,
    entered: flows.entered,
    failed: flows.failed,
    finished: flows.finished,
    job_ms: jobMs,
    ms: flows.ms,
    sent: flows.sent,
    skipped: flows.skipped,
    woken: flows.woken
  };
  const { error } = await ctx.supabase.from("job_runs").update({ metadata: { flows: counts, tick_run_id: ctx.tickRunId } }).eq("id", ctx.runId);

  if (error) {
    console.error(`[comunicacao] contagens dos fluxos nao gravadas em job_runs: ${error.message}`);
  }
}

export const communicationsJob: Job = {
  name: COMMUNICATIONS_JOB_NAME,
  async run(ctx) {
    const startedAt = Date.now();
    const now = new Date();
    const facts = createFactsLoader(ctx.supabase, now);
    const result = await processCommunications({ db: ctx.supabase, facts, now, signal: ctx.signal });

    if (result.dispatched || result.sending || result.awaitingApproval || result.failed || result.refreshed) {
      console.info(
        `[comunicacao] tick ${ctx.tickRunId}: ${result.dispatched} notificacao(oes) enviada(s), ${result.sending} em andamento, ` +
          `${result.awaitingApproval} de volta para aprovacao, ${result.failed} falha(s), ${result.refreshed} pop-up(s) recalculado(s).`
      );
    }

    const flows =
      ctx.signal.aborted || result.pendingMigration
        ? EMPTY_FLOWS
        : await processFlows({ budgetMs: FLOW_LIMITS.phaseBudgetMs, db: ctx.supabase, facts, now, signal: ctx.signal });

    if (flows.worked) {
      console.info(
        `[comunicacao] fluxos: ${flows.claimed} conferidas, ${flows.sent} enviadas, ${flows.deferred} adiadas, ${flows.skipped} puladas, ` +
          `${flows.failed} falha(s), ${flows.entered} entraram, ${flows.ms} ms.`
      );
      await recordJobMetrics(ctx, flows, Date.now() - startedAt);
    }
  }
};
