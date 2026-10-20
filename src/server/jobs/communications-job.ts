import "server-only";

// Job do tick de minuto da Comunicacao (docs/22 §4.2 e §4.3; docs/04, secao Jobs): envia as notificacoes do sino
// agendadas que venceram (ate 3 por tick, em lotes de 500 alunos, retomavel) e recalcula quem ve cada
// pop-up no ar (ate 5 por tick, a cada 15 minutos). Idempotente: cada aviso e reservado antes do envio
// e o mesmo aluno nunca recebe a mesma notificacao duas vezes. Banco vazio ou sem a migracao
// 202610200001: registra e termina sem erro (o tick continua verde).

import { processCommunications } from "@/server/communications/dispatch";
import type { Job } from "./registry";

export const COMMUNICATIONS_JOB_NAME = "comunicacao";

export const communicationsJob: Job = {
  name: COMMUNICATIONS_JOB_NAME,
  async run(ctx) {
    const result = await processCommunications({ db: ctx.supabase, now: new Date(), signal: ctx.signal });

    if (result.dispatched || result.sending || result.failed || result.refreshed) {
      console.info(
        `[comunicacao] tick ${ctx.tickRunId}: ${result.dispatched} notificacao(oes) enviada(s), ${result.sending} em andamento, ` +
          `${result.failed} falha(s), ${result.refreshed} pop-up(s) recalculado(s).`
      );
    }
  }
};
