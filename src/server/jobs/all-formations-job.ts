import "server-only";

// Job do tick de minuto de "todas as formacoes" (docs/05, secao "Prazo de acesso por curso e todas as
// formacoes"; regras em src/server/payments/all-formations.ts). E a rede de seguranca: a formacao entra para
// quem tem a concessao aberta na hora em que e publicada (product-actions.ts); o que nao couber nessa hora, ou a
// formacao publicada por outro caminho, entra aqui.
//
// - Sem nenhuma concessao aberta (hoje, e enquanto ninguem comprar "todas as formacoes"): uma consulta e nada mais.
// - Com concessoes: mais uma consulta (as formacoes publicadas) e, so quando falta alguma, ate
//   ALL_FORMATIONS_PER_ROUND acessos por rodada, respeitando o prazo do tick. O que sobra fica para o minuto seguinte.
// Idempotente: a formacao que ja entrou fica anotada na concessao e nao entra de novo. Banco sem a migracao
// 202611280001: termina sem erro. Os logs levam so contagens.

import { ALL_FORMATIONS_MIGRATION, materializeAllFormations } from "@/server/payments/all-formations";
import type { Job } from "./registry";

export const ALL_FORMATIONS_JOB_NAME = "todas-as-formacoes";

export const allFormationsJob: Job = {
  name: ALL_FORMATIONS_JOB_NAME,
  async run(ctx) {
    const result = await materializeAllFormations(ctx.supabase, { now: ctx.tickStartedAt, signal: ctx.signal });

    if (result.missingMigration) {
      console.info(`[vendas] migracao ${ALL_FORMATIONS_MIGRATION} pendente; nenhuma concessao de todas as formacoes para conferir.`);
      return;
    }

    if (result.granted + result.failed + result.pending > 0) {
      console.info(
        `[vendas] tick ${ctx.tickRunId}: todas as formacoes: acessos abertos ${result.granted}, com erro ${result.failed}, para a proxima rodada ${result.pending}.`
      );
    }

    if (result.failed > 0) {
      throw new Error(`${result.failed} acesso(s) de "todas as formações" não entraram; voltam na próxima rodada.`);
    }
  }
};
