import "server-only";

// Job do tick de minuto da conversao da Oferta (docs/30 §4.2, M7): liga cada venda (sale_grants, criado so pelo
// webhook de venda em process-sale.ts) ao ultimo clique do mesmo aluno no mesmo produto em ate attribution_days, pela
// RPC webinar_offer_conversions (runOfferConversions em src/server/webinars/offer-store.ts), em lote de
// OFFER_LIMITS.conversionsPerRun, com a hora do tick (o mesmo minuto entregue duas vezes nao muda nada: so clique sem
// conversao e venda ainda nao ligada entram). Nunca cria venda nem acesso a partir de um clique. Sem trabalho: uma
// chamada. Tick ja sem tempo (ctx.signal): nao chama. Banco sem a 202610300003: registra e termina sem erro (o tick
// continua verde). Quando ligou alguma venda, a contagem vai para job_runs.metadata da linha deste job
// ({ tick_run_id, webinar_offer_conversions: { converted, job_ms } }: o tick_run_id gravado pelo run-tick.ts fica).

import { isPendingMigrationError } from "@/server/db/pending-migration";
import { isMissingWebinarSchema, WEBINARS_OFFERS_MIGRATION } from "@/server/webinars/db";
import { OFFER_LIMITS } from "@/server/webinars/model";
import { runOfferConversions } from "@/server/webinars/offer-store";
import type { Job, JobContext } from "./registry";

export const WEBINAR_OFFER_CONVERSIONS_JOB_NAME = "webinar-offer-conversions";

/** O que o job fez num tick (os testes leem). */
export type OfferConversionsResult = { converted: number; pendingMigration: boolean; skipped: boolean };

function isPendingOffersMigration(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

/** Contagem do tick em job_runs.metadata (so numeros). */
async function recordJobMetrics(ctx: JobContext, converted: number, jobMs: number) {
  const { error } = await ctx.supabase
    .from("job_runs")
    .update({ metadata: { tick_run_id: ctx.tickRunId, webinar_offer_conversions: { converted, job_ms: jobMs } } })
    .eq("id", ctx.runId);

  if (error) {
    console.error(`[webinarios] contagem das conversoes da oferta nao gravada em job_runs: ${error.message}`);
  }
}

/** Uma volta da conversao; a mesma conta do job, devolvida para os testes. */
export async function runOfferConversionsTick(ctx: JobContext): Promise<OfferConversionsResult> {
  if (ctx.signal.aborted) {
    return { converted: 0, pendingMigration: false, skipped: true };
  }

  const startedAt = Date.now();
  let converted: number;

  try {
    converted = await runOfferConversions(ctx.supabase, { limit: OFFER_LIMITS.conversionsPerRun, nowIso: ctx.tickStartedAt.toISOString() });
  } catch (error) {
    if (isPendingOffersMigration(error)) {
      console.info(`[webinarios] conversoes da oferta: migracao ${WEBINARS_OFFERS_MIGRATION} pendente; nada feito neste tick.`);

      return { converted: 0, pendingMigration: true, skipped: false };
    }

    throw error;
  }

  if (converted > 0) {
    console.info(`[webinarios] tick ${ctx.tickRunId}: ${converted} venda(s) ligada(s) ao clique da oferta.`);
    await recordJobMetrics(ctx, converted, Date.now() - startedAt);
  }

  return { converted, pendingMigration: false, skipped: false };
}

export const webinarOfferConversionsJob: Job = {
  name: WEBINAR_OFFER_CONVERSIONS_JOB_NAME,
  async run(ctx) {
    await runOfferConversionsTick(ctx);
  }
};
