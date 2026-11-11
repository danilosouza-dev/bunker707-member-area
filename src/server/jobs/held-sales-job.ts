import "server-only";

// Job do tick de minuto que libera as vendas guardadas (docs/32 §2.2 e §11.3, a tarefa `vendas-guardadas`; regras em
// src/server/payments/held-sales-release.ts e held-sales-model.ts).
//
// - Modo "off" (a nossa escola hoje, a `dev`, a Vercel e os testes): nao faz nada; nem le o banco.
// - Modo "enforce": uma consulta as vendas guardadas por minuto. Com alguma e a licenca permitindo acesso novo de novo,
//   libera em ordem, com reivindicacao por venda (duas rodadas ao mesmo tempo nunca liberam a mesma venda duas vezes).
//   Com a licenca ainda barrando, so garante o e-mail da equipe do episodio.
// Vem logo depois da `licenca-conferencia`: a conferencia que regulariza a licenca nesta rodada ja libera as vendas
// nesta mesma rodada. Banco sem a migracao 202611110002: registra e termina sem erro. Os logs levam so contagens.

import { getConfiguredSiteOrigin } from "@/server/auth/site-origin";
import { licensingMode } from "@/server/licensing/build-config";
import { readCurrentLicenseState } from "@/server/licensing/current-state";
import { HELD_SALES_MIGRATION, runHeldSalesRound } from "@/server/payments/held-sales-release";
import type { Job } from "./registry";

export const HELD_SALES_JOB_NAME = "vendas-guardadas";

export const heldSalesJob: Job = {
  name: HELD_SALES_JOB_NAME,
  async run(ctx) {
    const result = await runHeldSalesRound({
      configuredHost: getConfiguredSiteOrigin,
      db: ctx.supabase,
      mode: licensingMode(),
      readLicense: readCurrentLicenseState,
      signal: ctx.signal
    });

    if (result.mode !== "enforce") {
      return;
    }

    if (result.missingMigration) {
      console.info(`[vendas] migracao ${HELD_SALES_MIGRATION} pendente; nenhuma venda guardada para liberar.`);
      return;
    }

    if (result.granted + result.discarded + result.failed > 0) {
      console.info(
        `[vendas] tick ${ctx.tickRunId}: vendas guardadas liberadas ${result.granted}, descartadas ${result.discarded}, com erro ${result.failed}` +
          `${result.contended > 0 ? `, com outra rodada ${result.contended}` : ""}.`
      );
    }
  }
};
