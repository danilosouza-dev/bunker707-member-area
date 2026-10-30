import "server-only";

// Job do tick de minuto do gravador por hora e das gravacoes da Live ao vivo (docs/30 §4.5, §6.4 passos 3, 10 e 11,
// §6.7 e I6): pede a maquina 30 min antes da live com "Gravar automaticamente" (jibri-up pelo workflow), consulta a
// Bunny ate a gravacao ficar pronta (e cria o replay da live encerrada), devolve a maquina (jibri-down) quando o MP4
// esta na Bunny ou ela nao gravou, avisa no sino a maquina ligada ha mais de 6 h e apaga na Bunny a gravacao com a
// retencao vencida (uma vez por hora). O adaptador do GitHub (GITHUB_INFRA_TOKEN; WEBINAR_RECORDER_DISPATCH=fake fora
// da producao) e o cliente da Bunny (BUNNY_STREAM_API_KEY + BUNNY_STREAM_LIBRARY_ID) vem do ambiente: sem eles, os
// passos que dependem deles nao rodam. Sem trabalho: uma consulta de sessoes por passo ligado. Idempotente pelas
// marcas na sessao (recorder_requested_at, recorder_release_requested_at, recorder_alerted_at), pela situacao
// `processing` da gravacao, pelo dedupe_key do sino e pelo indice unico do replay. Banco sem a migracao 202610290003:
// registra e termina sem erro (o tick continua verde). Quando trabalhou, as contagens vao para job_runs.metadata da
// linha deste job ({ tick_run_id, webinars_recordings }: o tick_run_id gravado pelo run-tick.ts fica).

import { bunnyStreamFrom } from "@/server/webinars/bunny-stream";
import { recorderDispatcherFrom } from "@/server/webinars/recorder-dispatch";
import { runRecordingsTick, type WebinarRecordingsResult } from "@/server/webinars/recordings-tick";
import type { Job, JobContext } from "./registry";

export const WEBINAR_RECORDINGS_JOB_NAME = "webinar-recordings";

function worked(result: WebinarRecordingsResult) {
  return result.prepared + result.ready + result.failed + result.replays + result.released + result.alerted + result.purged > 0;
}

/** Contagens do tick em job_runs.metadata (so numeros). */
async function recordJobMetrics(ctx: JobContext, result: WebinarRecordingsResult, jobMs: number) {
  const counts = {
    alerted: result.alerted,
    failed: result.failed,
    job_ms: jobMs,
    prepared: result.prepared,
    purged: result.purged,
    ready: result.ready,
    released: result.released,
    replays: result.replays
  };
  const { error } = await ctx.supabase.from("job_runs").update({ metadata: { tick_run_id: ctx.tickRunId, webinars_recordings: counts } }).eq("id", ctx.runId);

  if (error) {
    console.error(`[webinarios] contagens das gravacoes nao gravadas em job_runs: ${error.message}`);
  }
}

export const webinarRecordingsJob: Job = {
  name: WEBINAR_RECORDINGS_JOB_NAME,
  async run(ctx) {
    const startedAt = Date.now();
    const result = await runRecordingsTick({
      bunny: bunnyStreamFrom(process.env),
      db: ctx.supabase,
      dispatcher: recorderDispatcherFrom(process.env),
      now: ctx.tickStartedAt,
      signal: ctx.signal
    });

    if (worked(result)) {
      console.info(
        `[webinarios] tick ${ctx.tickRunId}: ${result.prepared} gravador(es) pedido(s), ${result.ready} gravacao(oes) pronta(s), ${result.failed} falha(s), ` +
          `${result.replays} replay(s), ${result.released} devolucao(oes), ${result.alerted} aviso(s) de 6 h, ${result.purged} apagada(s) pela retencao.`
      );
      await recordJobMetrics(ctx, result, Date.now() - startedAt);
    }
  }
};
