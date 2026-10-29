import "server-only";

// Job do tick de minuto que congela a Simulacao das sessoes gravadas encerradas (docs/30 §1.6, §3.5, §4.3 e §6.6): para
// cada sessao `simulated` encerrada nas ultimas 6 h com regra simulada e sem simulation_summary, calcula com a semente
// os totais que a sala mostrou (o maior numero que o contador somou, quantas entradas e quantos avisos de venda) e
// grava uma vez (runSimulationSummariesTick em src/server/webinars/simulation-tick.ts; freezeSimulationSummary so onde
// ainda e nulo: o mesmo minuto entregue duas vezes nao muda nada). Vem logo depois de `webinar-sessions` (a sessao que
// acabou de encerrar congela no mesmo minuto) e cobre tambem o "Encerrar" manual do console. Leve: uma consulta, lote de
// 50, para no fim do orcamento do tick (ctx.signal). Banco sem a 202610290005: registra e termina sem erro (o tick
// continua verde). Quando trabalhou, as contagens vao para job_runs.metadata da linha deste job ({ tick_run_id,
// webinar_simulation_summaries: { failed, frozen, job_ms, scanned, skipped } }: o tick_run_id gravado pelo
// run-tick.ts fica). So numeros: nada da regra nem dos nomes.

import { runSimulationSummariesTick, type SimulationSummariesResult } from "@/server/webinars/simulation-tick";
import type { Job, JobContext } from "./registry";

export const WEBINAR_SIMULATION_SUMMARIES_JOB_NAME = "webinar-simulation-summaries";

function worked(result: SimulationSummariesResult) {
  return result.frozen + result.skipped + result.failed > 0;
}

/** Contagens do tick em job_runs.metadata (so numeros). */
async function recordJobMetrics(ctx: JobContext, result: SimulationSummariesResult, jobMs: number) {
  const counts = { failed: result.failed, frozen: result.frozen, job_ms: jobMs, scanned: result.scanned, skipped: result.skipped };
  const { error } = await ctx.supabase.from("job_runs").update({ metadata: { tick_run_id: ctx.tickRunId, webinar_simulation_summaries: counts } }).eq("id", ctx.runId);

  if (error) {
    console.error(`[webinarios] contagens do resumo da simulacao nao gravadas em job_runs: ${error.message}`);
  }
}

/** Uma volta do job; o mesmo resultado do tick, devolvido para os testes. */
export async function runSimulationSummariesJob(ctx: JobContext): Promise<SimulationSummariesResult> {
  const startedAt = Date.now();
  const result = await runSimulationSummariesTick({ db: ctx.supabase, now: ctx.tickStartedAt, signal: ctx.signal });

  if (worked(result)) {
    console.info(
      `[webinarios] tick ${ctx.tickRunId}: ${result.frozen} resumo(s) da simulacao congelado(s), ${result.skipped} pulado(s), ${result.failed} com erro.`
    );
    await recordJobMetrics(ctx, result, Date.now() - startedAt);
  }

  return result;
}

export const webinarSimulationSummariesJob: Job = {
  name: WEBINAR_SIMULATION_SUMMARIES_JOB_NAME,
  async run(ctx) {
    await runSimulationSummariesJob(ctx);
  }
};
