import "server-only";

// Job do tick de minuto dos Webinarios (docs/30 §2.7 e §6.4, passo 2): os lembretes de 24 h e 1 h de quem garantiu
// vaga, pelo sino (kind 'webinar') e pela fila de e-mail, e a sessao que encerra sozinha 2 h depois do fim previsto.
// Sem trabalho: uma consulta de sessoes e nada mais. Idempotente pela marca na vaga, pelo dedupe_key do sino e pela
// chave do e-mail (src/server/webinars/reminders.ts). Banco sem a migracao 202610280001: registra e termina sem erro
// (o tick continua verde). Quando trabalhou, as contagens vao para job_runs.metadata da linha deste job
// ({ tick_run_id, webinars }: o tick_run_id gravado pelo run-tick.ts fica).

import { processWebinarReminders, type WebinarRemindersResult } from "@/server/webinars/reminders";
import type { Job, JobContext } from "./registry";

export const WEBINAR_REMINDERS_JOB_NAME = "webinar-reminders";

function worked(result: WebinarRemindersResult) {
  return result.reminders24h + result.reminders1h + result.emails + result.autoEnded + result.skipped > 0;
}

/** Contagens do tick em job_runs.metadata (so numeros). */
async function recordJobMetrics(ctx: JobContext, result: WebinarRemindersResult, jobMs: number) {
  const counts = {
    auto_ended: result.autoEnded,
    emails: result.emails,
    job_ms: jobMs,
    reminders_1h: result.reminders1h,
    reminders_24h: result.reminders24h,
    skipped: result.skipped
  };
  const { error } = await ctx.supabase.from("job_runs").update({ metadata: { tick_run_id: ctx.tickRunId, webinars: counts } }).eq("id", ctx.runId);

  if (error) {
    console.error(`[webinarios] contagens dos lembretes nao gravadas em job_runs: ${error.message}`);
  }
}

export const webinarRemindersJob: Job = {
  name: WEBINAR_REMINDERS_JOB_NAME,
  async run(ctx) {
    const startedAt = Date.now();
    const result = await processWebinarReminders({ db: ctx.supabase, now: ctx.tickStartedAt, signal: ctx.signal });

    if (worked(result)) {
      console.info(
        `[webinarios] tick ${ctx.tickRunId}: ${result.reminders24h} lembrete(s) de 24 h, ${result.reminders1h} de 1 h, ${result.emails} e-mail(s) na fila, ` +
          `${result.autoEnded} sessao(oes) encerrada(s) sozinha(s), ${result.skipped} pulada(s).`
      );
      await recordJobMetrics(ctx, result, Date.now() - startedAt);
    }
  }
};
