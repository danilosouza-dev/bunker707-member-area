import "server-only";

// Job do tick de minuto das sessoes gravadas dos Webinarios (docs/30 §1.6, §2.3 e §6.6): abre as sessoes
// `simulated` cuja hora chegou (roteiro + "Comecou agora" no sino), encerra as que passaram da duracao do video
// (presenca congelada, webinar_attendance) e cria o replay do webinario na primeira que encerra. Sem trabalho: uma
// consulta de sessoes e nada mais. Idempotente pelas RPCs (abrir uma sessao `live` nao muda nada; encerrar de novo
// refaz o mesmo resumo) e pelo indice unico do replay. Banco sem a migracao 202610290001: registra e termina sem
// erro (o tick continua verde). Quando trabalhou, as contagens vao para job_runs.metadata da linha deste job
// ({ tick_run_id, webinars_sessions }: o tick_run_id gravado pelo run-tick.ts fica). Roda antes dos lembretes:
// a sessao que o tick nao abriu a tempo e encerrada aqui com a curva, nao pelo encerramento automatico de la.

import { runSessionsTick, type WebinarSessionsResult } from "@/server/webinars/sessions-tick";
import type { Job, JobContext } from "./registry";

export const WEBINAR_SESSIONS_JOB_NAME = "webinar-sessions";

function worked(result: WebinarSessionsResult) {
  return result.opened + result.finished + result.replays + result.skipped > 0;
}

/** Contagens do tick em job_runs.metadata (so numeros). */
async function recordJobMetrics(ctx: JobContext, result: WebinarSessionsResult, jobMs: number) {
  const counts = { finished: result.finished, job_ms: jobMs, opened: result.opened, replays: result.replays, skipped: result.skipped };
  const { error } = await ctx.supabase.from("job_runs").update({ metadata: { tick_run_id: ctx.tickRunId, webinars_sessions: counts } }).eq("id", ctx.runId);

  if (error) {
    console.error(`[webinarios] contagens das sessoes gravadas nao gravadas em job_runs: ${error.message}`);
  }
}

export const webinarSessionsJob: Job = {
  name: WEBINAR_SESSIONS_JOB_NAME,
  async run(ctx) {
    const startedAt = Date.now();
    const result = await runSessionsTick({ db: ctx.supabase, now: ctx.tickStartedAt, signal: ctx.signal });

    if (worked(result)) {
      console.info(
        `[webinarios] tick ${ctx.tickRunId}: ${result.opened} sessao(oes) gravada(s) aberta(s), ${result.finished} encerrada(s), ` +
          `${result.replays} replay(s) criado(s), ${result.skipped} pulada(s).`
      );
      await recordJobMetrics(ctx, result, Date.now() - startedAt);
    }
  }
};
