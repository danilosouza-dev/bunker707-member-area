// Leitura do evento do webhook do Resend (resend.com/docs/webhooks/event-types) para o que a fila
// precisa saber: tipo, id do e-mail no Resend e o motivo quando e bounce, reclamacao ou falha.
// Modulo puro; nada aqui confia no payload para alem de ler campos de texto curtos.

export const RESEND_EVENT_TYPES = [
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.complained",
  "email.bounced",
  "email.opened",
  "email.clicked",
  "email.failed",
  "email.received",
  "email.scheduled",
  "email.suppressed"
] as const;
export type ResendEventType = (typeof RESEND_EVENT_TYPES)[number];

export const MAX_WEBHOOK_PAYLOAD_BYTES = 64 * 1024;
const MAX_DETAIL_LENGTH = 500;
const MAX_TYPE_LENGTH = 60;
const MAX_EMAIL_ID_LENGTH = 120;

export type ResendWebhookEvent = {
  /** `email.bounced` etc.; tipos desconhecidos vem como texto para auditoria e sao ignorados. */
  type: string;
  known: boolean;
  /** `data.email_id`: o id que o Resend devolveu no envio (email_outbox.provider_message_id). */
  emailId: string | null;
  occurredAt: string | null;
  /** Mensagem do bounce, da reclamacao ou da falha, curta, para `last_error`. */
  detail: string | null;
};

function shortString(value: unknown, maximumLength: number) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim().slice(0, maximumLength) : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function parseResendWebhookEvent(payload: unknown): ResendWebhookEvent | null {
  const root = asObject(payload);
  const type = shortString(root?.type, MAX_TYPE_LENGTH);

  if (!root || !type) {
    return null;
  }

  const data = asObject(root.data);
  const bounce = asObject(data?.bounce);
  const failed = asObject(data?.failed);
  const detailSource =
    shortString(bounce?.message, MAX_DETAIL_LENGTH) ??
    shortString(failed?.reason, MAX_DETAIL_LENGTH) ??
    shortString(data?.reason, MAX_DETAIL_LENGTH) ??
    (type === "email.complained" ? "O destinatário marcou o e-mail como spam." : null);
  const bounceKind = [shortString(bounce?.type, 40), shortString(bounce?.subType, 40)].filter(Boolean).join("/");

  return {
    detail: detailSource ? (bounceKind ? `${bounceKind}: ${detailSource}` : detailSource) : null,
    emailId: shortString(data?.email_id, MAX_EMAIL_ID_LENGTH),
    known: (RESEND_EVENT_TYPES as readonly string[]).includes(type),
    occurredAt: shortString(root.created_at, 40) ?? shortString(data?.created_at, 40),
    type
  };
}

export type OutboxWebhookPatch =
  | { kind: "bounced"; error: string }
  | { kind: "complained"; error: string }
  | { kind: "failed"; error: string }
  | { kind: "delivered" }
  | { kind: "delayed"; error: string }
  | { kind: "ignore" };

/** O que o evento muda na linha da fila. Eventos de abertura, clique e envio nao mudam nada. */
export function outboxPatchFor(event: ResendWebhookEvent): OutboxWebhookPatch {
  switch (event.type) {
    case "email.bounced":
      return { error: event.detail ?? "O servidor do destinatário recusou o e-mail.", kind: "bounced" };
    case "email.complained":
      return { error: event.detail ?? "O destinatário marcou o e-mail como spam.", kind: "complained" };
    case "email.failed":
    case "email.suppressed":
      return { error: event.detail ?? "O Resend não conseguiu enviar o e-mail.", kind: "failed" };
    case "email.delivered":
      return { kind: "delivered" };
    case "email.delivery_delayed":
      return { error: event.detail ?? "Entrega atrasada pelo servidor do destinatário.", kind: "delayed" };
    default:
      return { kind: "ignore" };
  }
}
