import "server-only";

// Escolha do provedor pelo ambiente (EMAIL_PROVIDER=resend|none). E o unico modulo que sabe qual
// implementacao esta por tras da interface: o job `email-outbox` pede `getEmailProvider()` e, sem
// provedor (sem chave ou desligado), deixa a fila esperando e registra o motivo uma vez por processo.
// Nos testes de integracao, tests/support/integration-email-provider.mjs entra no lugar deste arquivo.

import { readEmailConfig, type EmailConfig } from "./config";
import { createResendProvider } from "./providers/resend";
import type { EmailProvider } from "./types";

let warnedReason: string | null = null;

export function getEmailProvider(config: EmailConfig = readEmailConfig(process.env)): EmailProvider | null {
  if (config.provider === "none" || !config.resendApiKey) {
    const reason = config.disabledReason ?? "Provedor de e-mail desligado.";

    if (warnedReason !== reason) {
      warnedReason = reason;
      console.warn(`[e-mail] ${reason} Os e-mails ficam na fila (email_outbox) e expiram em 7 dias.`);
    }

    return null;
  }

  return createResendProvider({ apiKey: config.resendApiKey });
}
