import "server-only";

// Job do tick de minuto das sessoes gravadas dos Webinarios (docs/30 §1.6, §2.3 e §6.6): abre as sessoes
// `simulated` cuja hora chegou (roteiro + "Comecou agora" no sino), encerra as que passaram da duracao do video
// (presenca congelada, webinar_attendance) e cria o replay do webinario na primeira que encerra. Sem trabalho: uma
// consulta de sessoes e nada mais. Idempotente pelas RPCs (abrir uma sessao `live` nao muda nada; encerrar de novo
// refaz o mesmo resumo) e pelo indice unico do replay. Banco sem a migracao 202610290001: registra e termina sem
// erro (o tick continua verde). Quando trabalhou, as contagens vao para job_runs.metadata da linha deste job
// ({ tick_run_id, webinars_sessions }: o tick_run_id gravado pelo run-tick.ts fica). Roda antes dos lembretes:
// a sessao que o tick nao abriu a tempo e encerrada aqui com a curva, nao pelo encerramento automatico de la. Adendo de
// 10/11/2026 (R8): depois das gravadas, o roteiro da Live ao vivo (live-script-tick.ts: os itens "Num minuto da live"
// que venceram desde o "Começar para todos"); as contagens dele vao em job_runs.metadata.webinars_live_script.

import { runLiveScriptTick, type LiveScriptResult } from "@/server/webinars/live-script-tick";
import { runSessionsTick, type WebinarSessionsResult } from "@/server/webinars/sessions-tick";
import { WEBINARS_FEATURE } from "@/server/licensing/features";
import type { Job, JobContext } from "./registry";

export const WEBINAR_SESSIONS_JOB_NAME = "webinar-sessions";

function worked(result: WebinarSessionsResult) {
  return result.opened + result.finished + result.replays + result.skipped > 0;
}

/** Contagens do tick em job_runs.metadata (so numeros); o roteiro da live so quando ele trabalhou. */
async function recordJobMetrics(ctx: JobContext, result: WebinarSessionsResult, script: LiveScriptResult, jobMs: number) {
  const counts = { finished: result.finished, job_ms: jobMs, opened: result.opened, replays: result.replays, skipped: result.skipped };
  const live = script.released + script.skipped + script.failed > 0 ? { webinars_live_script: { failed: script.failed, released: script.released, sessions: script.sessions, skipped: script.skipped } } : {};
  const { error } = await ctx.supabase.from("job_runs").update({ metadata: { tick_run_id: ctx.tickRunId, webinars_sessions: counts, ...live } }).eq("id", ctx.runId);

  if (error) {
    console.error(`[webinarios] contagens das sessoes gravadas nao gravadas em job_runs: ${error.message}`);
  }
}

export const webinarSessionsJob: Job = {
  feature: WEBINARS_FEATURE,
  name: WEBINAR_SESSIONS_JOB_NAME,
  async run(ctx) {
    const startedAt = Date.now();
    const result = await runSessionsTick({ db: ctx.supabase, now: ctx.tickStartedAt, signal: ctx.signal });
    const script = await runLiveScriptTick({ db: ctx.supabase, now: ctx.tickStartedAt, signal: ctx.signal });
    const scriptWorked = script.released + script.skipped + script.failed > 0;

    if (worked(result)) {
      console.info(
        `[webinarios] tick ${ctx.tickRunId}: ${result.opened} sessao(oes) gravada(s) aberta(s), ${result.finished} encerrada(s), ` +
          `${result.replays} replay(s) criado(s), ${result.skipped} pulada(s).`
      );
    }
    if (scriptWorked) {
      console.info(`[webinarios] tick ${ctx.tickRunId}: ${script.released} comentario(s) do roteiro solto(s) na live, ${script.skipped} ja tinha(m) entrado.`);
    }
    if (worked(result) || scriptWorked) {
      await recordJobMetrics(ctx, result, script, Date.now() - startedAt);
    }
  }
};
