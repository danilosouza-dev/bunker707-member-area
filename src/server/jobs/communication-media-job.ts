import "server-only";

// Job do tick de minuto que tira do Storage os arquivos da Comunicacao sem uso ha 30 dias (docs/22 §4.6; regras em
// src/server/communications/media-cleanup-model.ts, rodada em media-cleanup.ts). Roda a cada minuto, mas so
// trabalha uma vez por dia, a partir das 06:53 UTC: o job olha as proprias execucoes em job_runs (as que trabalharam
// levam `metadata.media_cleanup`) e decide em mediaCleanupDecision. Rodada que parou no teto de 500 arquivos ou no
// tempo continua 5 minutos depois; rodada que falhou espera 1 hora. Fica por ultimo no registro: usa so o que sobra
// do tick (com menos de 15 s sobrando, fica para o minuto seguinte) e tem orcamento proprio de 20 s. Banco sem a
// migracao 202610240001: registra e termina sem erro. Grava e registra so contagens.

import { runMediaCleanup, type MediaCleanupResult } from "@/server/communications/media-cleanup";
import { MEDIA_CLEANUP_RULES, mediaCleanupDecision, type MediaCleanupRunRecord } from "@/server/communications/media-cleanup-model";
import type { Job, JobContext } from "./registry";
import { JOBS_TICK_BUDGET_MS } from "./run-tick";

export const COMMUNICATION_MEDIA_JOB_NAME = "comunicacao-limpeza-de-arquivos";

/** Janela das execucoes anteriores lidas para decidir (cobre o dia inteiro e um pouco mais). */
const LOOKBACK_MS = 26 * 3_600_000;

type JobRunRow = { metadata: { media_cleanup?: { done?: unknown } } | null; started_at: string; status: string };

/** As execucoes deste job que trabalharam (com metadata.media_cleanup), da mais nova para a mais antiga. */
async function recentCleanupRuns(ctx: JobContext, now: Date): Promise<MediaCleanupRunRecord[]> {
  const { data, error } = await ctx.supabase
    .from("job_runs")
    .select("status,started_at,metadata")
    .eq("job", COMMUNICATION_MEDIA_JOB_NAME)
    .gte("started_at", new Date(now.getTime() - LOOKBACK_MS).toISOString())
    .not("metadata->media_cleanup", "is", null)
    .neq("id", ctx.runId)
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new Error(`Nao foi possivel ler as execucoes da limpeza de arquivos: ${error.message}`);
  }

  return ((data ?? []) as JobRunRow[]).map((row) => ({
    done: row.metadata?.media_cleanup?.done === true,
    startedAt: row.started_at,
    status: row.status === "succeeded" || row.status === "failed" ? row.status : "running"
  }));
}

async function writeMetadata(ctx: JobContext, mediaCleanup: Record<string, unknown>) {
  const { error } = await ctx.supabase
    .from("job_runs")
    .update({ metadata: { media_cleanup: mediaCleanup, tick_run_id: ctx.tickRunId } })
    .eq("id", ctx.runId);

  if (error) {
    throw new Error(`Nao foi possivel registrar a limpeza de arquivos em job_runs: ${error.message}`);
  }
}

function countsOf(result: MediaCleanupResult) {
  return {
    deleted: result.deleted,
    done: result.done,
    failed: result.failed,
    incomplete: result.incomplete,
    listed: result.listed,
    marked: result.marked,
    ms: result.ms,
    recent: result.recent,
    referenced: result.referenced,
    remaining: result.remaining,
    rescued: result.rescued,
    unmarked: result.unmarked,
    waiting: result.waiting
  };
}

export const communicationMediaJob: Job = {
  name: COMMUNICATION_MEDIA_JOB_NAME,
  async run(ctx) {
    const now = new Date();

    if (JOBS_TICK_BUDGET_MS - (now.getTime() - ctx.tickStartedAt.getTime()) < MEDIA_CLEANUP_RULES.minTickLeftMs) {
      return;
    }

    const decision = mediaCleanupDecision(now, await recentCleanupRuns(ctx, now));

    if (!decision.run) {
      return;
    }

    // Marca de que esta execucao trabalhou (outro tick no mesmo minuto ve e espera).
    await writeMetadata(ctx, { started_at: now.toISOString() });

    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(MEDIA_CLEANUP_RULES.budgetMs)]);
    const result = await runMediaCleanup({ db: ctx.supabase, now, signal });

    if (result.pendingMigration) {
      console.info("[comunicacao] limpeza de arquivos: migracao 202610240001 pendente; nada a fazer.");
      await writeMetadata(ctx, { done: true, pending_migration: true });
      return;
    }

    await writeMetadata(ctx, countsOf(result));
    console.info(
      `[comunicacao] limpeza de arquivos: ${result.listed} no Storage, ${result.referenced} em uso, ${result.marked} marcado(s) sem uso, ` +
        `${result.unmarked} desmarcado(s), ${result.deleted} apagado(s), ${result.failed} falha(s), ${result.remaining} para depois, ${result.ms} ms.`
    );
  }
};
