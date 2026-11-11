import "server-only";

// Job do tick de minuto que cuida da licenca desta Instalacao (docs/32 §11.3, a tarefa `licenca-conferencia`; regras
// em src/server/licensing/tick.ts e store.ts).
//
// - Modo "off" (a nossa escola hoje, a `dev`, a Vercel e os testes): nao faz nada; nem le o banco.
// - Modo "enforce": avanca a ultima hora vista (um minuto por rodada), grava a primeira vez que percebe a licenca
//   ilegivel ou o endereco diferente e, quando a conferencia diaria vence (no minuto sorteado da Instalacao), foi
//   pedida ou falhou ha mais de 1 hora, fala com o Emissor com tempo limite de 10 s, pelo cliente HTTP quando o build
//   traz o endereco do Emissor (src/server/licensing/client.ts) e pelo "nao configurado" quando nao traz. Depois, o
//   e-mail da mudanca de degrau para os donos e administradores (src/server/licensing/degree-email.ts), uma vez por
//   mudanca, pela fila de e-mail.
// Falha do Emissor nunca vira erro do agendador: fica em license_state, e a licenca guardada continua valendo. Falha do
// e-mail de degrau tambem nao: a rodada seguinte tenta de novo. Banco sem a migracao 202611100002 (so no modo
// "enforce"): registra e termina sem erro. Os logs levam so motivos e codigos, nunca a licenca, o segredo ou a sequencia.

import { getConfiguredSiteOrigin } from "@/server/auth/site-origin";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { licensingMode, trustedRoots } from "@/server/licensing/build-config";
import { emissorClient, installationVersions } from "@/server/licensing/client";
import { forgetLicenseStateMemory } from "@/server/licensing/current-state";
import { notifyLicenseDegreeChange } from "@/server/licensing/degree-email";
import { LICENSE_STATE_MIGRATION, licenseStateDbOf } from "@/server/licensing/store-db";
import { runLicenseTick } from "@/server/licensing/tick";
import type { Job } from "./registry";

export const LICENSE_CHECK_IN_JOB_NAME = "licenca-conferencia";

export const licenseCheckInJob: Job = {
  name: LICENSE_CHECK_IN_JOB_NAME,
  async run(ctx) {
    try {
      const result = await runLicenseTick({
        mode: licensingMode(),
        db: () => licenseStateDbOf(ctx.supabase),
        client: emissorClient,
        roots: trustedRoots,
        configuredHost: getConfiguredSiteOrigin,
        now: () => new Date(),
        versions: installationVersions,
        signal: ctx.signal
      });

      if (result.mode !== "enforce") {
        return;
      }

      // A linha mudou nesta rodada (ao menos a ultima hora vista): o proximo pedido le a tabela de novo.
      forgetLicenseStateMemory();

      if (result.result !== null || result.contended) {
        console.info(
          `[licenca] tick ${ctx.tickRunId}: conferencia ${result.checkIn?.reason ?? "nao decidida"}, ` +
            `resultado ${result.result ?? "nao gravado"}${result.contended ? " (outra gravacao chegou antes)" : ""}.`
        );
      }

      // A rodada que perdeu a disputa nao sabe a situacao: o e-mail espera a seguinte.
      if (result.state) {
        try {
          const notice = await notifyLicenseDegreeChange(ctx.supabase, result.state, getConfiguredSiteOrigin());

          if (notice.queued > 0) {
            console.info(`[licenca] tick ${ctx.tickRunId}: e-mail de degrau para ${notice.queued} pessoa(s) da equipe.`);
          }
        } catch (error) {
          console.error(`[licenca] tick ${ctx.tickRunId}: e-mail de degrau nao enfileirado: ${error instanceof Error ? error.message : "erro desconhecido"}`);
        }
      }
    } catch (error) {
      if (isPendingMigrationError(error)) {
        console.info(`[licenca] migracao ${LICENSE_STATE_MIGRATION} pendente; nada a fazer.`);
        return;
      }

      throw error;
    }
  }
};
