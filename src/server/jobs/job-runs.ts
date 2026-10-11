import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Persistencia de `public.job_runs` (RLS ligada, sem policies: so o service role escreve).

export type JobRunStatus = "running" | "succeeded" | "failed";

export type JobRunMetadata = Record<string, unknown>;

const MAX_JOB_RUN_ERROR_LENGTH = 2_000;

// Execucoes em `running` ha mais tempo que isso nao terminaram (funcao encerrada pela
// plataforma, timeout ou deploy no meio do tick) e passam a `failed`.
export const STALE_JOB_RUN_MINUTES = 15;

export function describeJobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim() || "Erro sem mensagem.";

  return normalized.length > MAX_JOB_RUN_ERROR_LENGTH
    ? `${normalized.slice(0, MAX_JOB_RUN_ERROR_LENGTH - 1)}…`
    : normalized;
}

export async function startJobRun(
  supabase: SupabaseClient,
  job: string,
  metadata: JobRunMetadata = {}
) {
  const { data, error } = await supabase
    .from("job_runs")
    .insert({ job, metadata, status: "running" satisfies JobRunStatus })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(`Não foi possível registrar o início do job "${job}": ${error?.message ?? "sem resposta"}.`);
  }

  return data.id;
}

export async function finishJobRun(
  supabase: SupabaseClient,
  runId: string,
  result: {
    status: Exclude<JobRunStatus, "running">;
    error?: string | null;
    metadata?: JobRunMetadata;
  }
) {
  const { error } = await supabase
    .from("job_runs")
    .update({
      error: result.error ? describeJobError(result.error) : null,
      finished_at: new Date().toISOString(),
      status: result.status,
      ...(result.metadata ? { metadata: result.metadata } : {})
    })
    .eq("id", runId)
    .eq("status", "running" satisfies JobRunStatus);

  if (error) {
    throw new Error(`Não foi possível registrar o fim da execução ${runId}: ${error.message}.`);
  }
}

export async function failStaleJobRuns(supabase: SupabaseClient, now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_JOB_RUN_MINUTES * 60_000).toISOString();
  const { error } = await supabase
    .from("job_runs")
    .update({
      error: "Execução interrompida antes de terminar (tempo esgotado ou encerramento da função).",
      finished_at: now.toISOString(),
      status: "failed" satisfies JobRunStatus
    })
    .eq("status", "running" satisfies JobRunStatus)
    .lt("started_at", cutoff);

  if (error) {
    throw new Error(`Não foi possível encerrar execuções antigas de jobs: ${error.message}.`);
  }
}
