import "server-only";

// Job do tick de minuto que envia ao Emissor os pedidos da venda que vira Licenca do Bunker Members (docs/32 §11.10; a
// tarefa `licencas-vendas`; regras em src/server/licensing/interno/requests-model.ts e requests-tick.ts).
//
// - Sem a API interna do Emissor configurada (a copia do comprador, a `dev` sem o simulador): nao faz nada; nem le o banco.
// - Com ela (a nossa escola): uma consulta por minuto a fila; com pedidos na vez, ate 10 por rodada, cada um com o tempo
//   limite do cliente e o orcamento do tick. O Emissor fora do ar so atrasa: a linha volta para a fila com a espera.
// Fica no fim, antes da limpeza de arquivos: nao atrasa os e-mails, os avisos nem as lives. Banco sem a migracao
// 202611130001: registra uma vez e termina sem erro. Os logs levam so contagens e codigos.

import { isLicenseSalesSchemaMissing } from "@/server/licensing/interno/requests-store";
import { runLicenseRequestsRound } from "@/server/licensing/interno/requests-tick";
import { getSellerFeatures } from "@/server/licensing/interno/seller";
import type { Job } from "./registry";

export const LICENSE_SALES_JOB_NAME = "licencas-vendas";

let missingSchemaLogged = false;

export const licenseSalesJob: Job = {
  name: LICENSE_SALES_JOB_NAME,
  async run(ctx) {
    const seller = await getSellerFeatures();

    if (!seller.enabled) {
      return;
    }

    try {
      const result = await runLicenseRequestsRound({ client: seller.client, db: ctx.supabase, signal: ctx.signal });

      if (result.sent + result.failed + result.dismissed > 0) {
        console.info(
          `[licencas-vendas] tick ${ctx.tickRunId}: enviados ${result.sent}, com erro ${result.failed}, dispensados ${result.dismissed}, esperando a venda ${result.waiting}` +
            `${result.contended > 0 ? `, com outra rodada ${result.contended}` : ""}${result.errors.length > 0 ? ` (${[...new Set(result.errors)].join(", ")})` : ""}.`
        );
      }
    } catch (error) {
      if (isLicenseSalesSchemaMissing(error)) {
        if (!missingSchemaLogged) {
          missingSchemaLogged = true;
          console.info("[licencas-vendas] migracao 202611130001 pendente; nada a enviar.");
        }

        return;
      }

      throw error;
    }
  }
};
