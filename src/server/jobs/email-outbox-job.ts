import "server-only";

// Job do tick de minuto que esvazia a fila de e-mails (docs/04, secoes Jobs e E-mail). Idempotente:
// cada linha e reservada (`sending`) antes do envio e a chave de idempotencia vai ao provedor; curto:
// no maximo 25 envios por tick, parando quando o orcamento (`ctx.signal`) acaba.

import { readEmailConfig } from "@/server/email/config";
import { processEmailOutbox } from "@/server/email/outbox";
import { getEmailProvider } from "@/server/email/provider";
import type { Job } from "./registry";

export const EMAIL_OUTBOX_JOB_NAME = "email-outbox";

export const emailOutboxJob: Job = {
  name: EMAIL_OUTBOX_JOB_NAME,
  async run(ctx) {
    const config = readEmailConfig(process.env);
    const provider = getEmailProvider(config);
    const result = await processEmailOutbox({
      dailyLimit: config.dailyLimit,
      db: ctx.supabase,
      from: config.from,
      now: new Date(),
      provider,
      replyTo: config.replyTo,
      signal: ctx.signal
    });

    if (result.sent || result.failed || result.retried || result.expired) {
      console.info(
        `[e-mail] tick ${ctx.tickRunId}: ${result.sent} enviado(s), ${result.retried} para tentar de novo, ${result.failed} falha(s), ` +
          `${result.expired} expirado(s); ${result.queued} na fila, ${result.remainingToday} restantes hoje.`
      );
    }
  }
};
