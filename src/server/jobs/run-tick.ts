import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  describeJobError,
  failStaleJobRuns,
  finishJobRun,
  startJobRun,
  type JobRunMetadata
} from "@/server/jobs/job-runs";
import type { Job } from "@/server/jobs/registry";
import type { FeatureKey } from "@/server/licensing/features";

export const TICK_JOB_NAME = "tick";

// Orcamento do tick inteiro. Fica abaixo do `maxDuration` da rota (60 s) e do timeout
// do pg_net (55 s) para que o resultado seja gravado antes de a funcao ser encerrada.
export const JOBS_TICK_BUDGET_MS = 45_000;

const jobNamePattern = /^[a-z0-9][a-z0-9-]{0,119}$/;

export type JobsTickResult = {
  ok: boolean;
  tickRunId: string;
  ran: string[];
  failed: string[];
  skipped: string[];
  /** Tarefas de um modulo desligado na licenca (docs/32 §11.8): nao rodaram e nao gravaram linha em job_runs. */
  featureOff: string[];
};

/** Todo modulo ligado: o modo "off" da licenca (a nossa escola hoje, a dev, a Vercel e os testes). */
const ALL_FEATURES_ON = () => true;

function assertValidRegistry(jobs: readonly Job[]) {
  const names = new Set<string>();

  for (const job of jobs) {
    if (!jobNamePattern.test(job.name) || job.name === TICK_JOB_NAME) {
      throw new Error(`Nome de job inválido no registro: "${job.name}".`);
    }

    if (names.has(job.name)) {
      throw new Error(`Job duplicado no registro: "${job.name}".`);
    }

    names.add(job.name);
  }
}

function rejectWhenAborted(signal: AbortSignal) {
  return new Promise<never>((_, reject) => {
    const abort = () => reject(new Error("Tempo do tick esgotado antes de o job terminar."));

    if (signal.aborted) {
      abort();
      return;
    }

    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function runJobsTick({
  budgetMs = JOBS_TICK_BUDGET_MS,
  isFeatureEnabled = ALL_FEATURES_ON,
  jobs,
  metadata = {},
  supabase
}: {
  budgetMs?: number;
  /** O modulo esta ligado na licenca agora? A rota do tick pergunta uma vez por rodada (getCurrentLicenseState). */
  isFeatureEnabled?: (feature: FeatureKey) => boolean;
  jobs: readonly Job[];
  metadata?: JobRunMetadata;
  supabase: SupabaseClient;
}): Promise<JobsTickResult> {
  assertValidRegistry(jobs);

  const tickStartedAt = new Date();
  const signal = AbortSignal.timeout(budgetMs);
  const deadline = rejectWhenAborted(signal);
  // Evita unhandled rejection quando nenhum job chega a disputar com o prazo.
  deadline.catch(() => undefined);

  try {
    await failStaleJobRuns(supabase, tickStartedAt);
  } catch (error) {
    console.error("Falha ao encerrar execuções antigas de jobs.", error);
  }

  const tickRunId = await startJobRun(supabase, TICK_JOB_NAME, metadata);
  const ran: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  const featureOff: string[] = [];
  // So entra no registro da rodada quando algum modulo esta desligado: no modo "off" a linha do tick fica como antes.
  const withFeatureOff = () => (featureOff.length > 0 ? { feature_off: featureOff } : {});

  try {
    for (const job of jobs) {
      // Tarefa de um modulo desligado (docs/32 §11.8): nao roda e nao conta como pulada por falta de tempo.
      if (job.feature !== undefined && !isFeatureEnabled(job.feature)) {
        featureOff.push(job.name);
        continue;
      }

      if (signal.aborted) {
        skipped.push(job.name);
        continue;
      }

      const runId = await startJobRun(supabase, job.name, { tick_run_id: tickRunId });
      ran.push(job.name);

      try {
        await Promise.race([
          job.run({ runId, signal, supabase, tickRunId, tickStartedAt }),
          deadline
        ]);
        await finishJobRun(supabase, runId, { status: "succeeded" });
      } catch (error) {
        failed.push(job.name);
        console.error(`Job "${job.name}" falhou.`, error);
        await finishJobRun(supabase, runId, { error: describeJobError(error), status: "failed" })
          .catch((finishError) => console.error(`Falha ao registrar o erro do job "${job.name}".`, finishError));
      }
    }
  } catch (error) {
    await finishJobRun(supabase, tickRunId, {
      error: describeJobError(error),
      metadata: { ...metadata, failed, ran, skipped, ...withFeatureOff() },
      status: "failed"
    }).catch((finishError) => console.error("Falha ao registrar o erro do tick de jobs.", finishError));
    throw error;
  }

  const ok = failed.length === 0 && skipped.length === 0;

  await finishJobRun(supabase, tickRunId, {
    error: ok
      ? null
      : [
          failed.length ? `Falharam: ${failed.join(", ")}.` : "",
          skipped.length ? `Ficaram para o próximo tick: ${skipped.join(", ")}.` : ""
        ].filter(Boolean).join(" "),
    metadata: { ...metadata, failed, ran, skipped, ...withFeatureOff() },
    status: ok ? "succeeded" : "failed"
  });

  return { failed, featureOff, ok, ran, skipped, tickRunId };
}
