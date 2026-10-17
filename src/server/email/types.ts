// Contrato do envio de e-mail transacional (docs/04, secao E-mail). Modulo puro, sem "server-only"
// nem aliases: os testes em tests/email-*.test.mjs carregam estes tipos direto pelo Node.
//
// Quem envia e-mail no app nunca fala com o Resend: enfileira em `email_outbox` (outbox.ts) e o job
// `email-outbox` do tick de minuto chama `EmailProvider.send`. Trocar de provedor (Resend hoje, SES
// na segunda rodada) e escrever outra implementacao desta interface e apontar EMAIL_PROVIDER.

export type EmailMessage = {
  /** Remetente no formato `Nome <conta@dominio>` (EMAIL_FROM). */
  from: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  html: string;
  /** Versao em texto simples; vazia, o provedor gera a partir do HTML. */
  text?: string | null;
  /** Mesma chave = mesmo e-mail: o provedor nao envia duas vezes dentro da janela dele (Resend: 24 h). */
  idempotencyKey: string;
};

/**
 * O que fazer com a linha da fila depois de uma falha:
 * - `retry`: erro passageiro (rede, 5xx, chave de idempotencia ainda em uso): tenta de novo com espera;
 * - `throttle`: limite do provedor (429, cota do dia): a linha volta para a fila sem contar tentativa e o
 *   lote para ate a proxima janela;
 * - `fail`: erro definitivo (remetente invalido, dominio nao verificado, chave recusada): marca `failed`.
 */
export type EmailFailureOutcome = "retry" | "throttle" | "fail";

export type EmailSendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; outcome: EmailFailureOutcome; error: string; retryAfterMs?: number | null };

export type EmailProvider = {
  readonly name: string;
  send(message: EmailMessage, options?: { signal?: AbortSignal }): Promise<EmailSendResult>;
};
