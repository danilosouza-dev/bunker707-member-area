import "server-only";

// Fila `email_outbox` e eventos do provedor (`email_webhook_events`), migracao 202610170002.
// Quem dispara chama `enqueueEmail` (uma linha, idempotente pela chave); o job `email-outbox` do tick
// chama `processEmailOutbox`, que aplica as regras puras de outbox-rules.ts no banco: limite diario,
// retentativa com espera, dead-letter, linhas orfas e validade da fila. Escrita so pelo servidor.

import type { SupabaseClient } from "@supabase/supabase-js";
import { setTimeout as sleep } from "node:timers/promises";
import {
  EXPIRED_IN_QUEUE_ERROR,
  MAX_EMAILS_PER_RUN,
  MAX_QUEUE_AGE_MS,
  PAUSE_BETWEEN_SENDS_MS,
  STALE_SENDING_MS,
  planAfterAttempt,
  remainingDailyQuota,
  startOfUtcDay,
  type EmailKind,
  type EmailOutboxStatus
} from "./outbox-rules";
import type { EmailProvider } from "./types";
import { outboxPatchFor, type ResendWebhookEvent } from "./webhook-events";

export type EmailOutboxDb = SupabaseClient;

// So as colunas criadas na 202610170002. O job do tick le esta lista a cada minuto: uma coluna de migracao
// posterior (ex.: anonymized_at, da retencao 202610170004) faria a fila inteira parar num banco que ainda
// nao recebeu a migracao, e o deploy pode sair antes dela. Quem precisa de outra coluna pede a mais no
// proprio select (tests/email-fila-antes-da-retencao.test.mjs confere contra o arquivo da 0002).
export const EMAIL_OUTBOX_COLUMNS =
  "id,kind,user_id,to_email,subject,html,text,idempotency_key,status,attempts,next_attempt_at,last_error,provider,provider_message_id,sent_at,delivered_at,bounced_at,metadata,created_at,updated_at";

export type EmailOutboxRow = {
  attempts: number;
  bounced_at: string | null;
  created_at: string;
  delivered_at: string | null;
  /** Nulo so em linha anonimizada pela retencao (migracao 202610170004, check no banco). */
  html: string | null;
  id: string;
  idempotency_key: string;
  kind: string;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  next_attempt_at: string;
  provider: string | null;
  provider_message_id: string | null;
  sent_at: string | null;
  status: EmailOutboxStatus;
  subject: string;
  text: string | null;
  /** Nulo so em linha anonimizada pela retencao (migracao 202610170004, check no banco). */
  to_email: string | null;
  updated_at: string;
  user_id: string | null;
};

const MAX_LAST_ERROR_LENGTH = 2_000;

function shortError(message: string) {
  const normalized = message.trim() || "Erro sem mensagem.";

  return normalized.length > MAX_LAST_ERROR_LENGTH ? `${normalized.slice(0, MAX_LAST_ERROR_LENGTH - 1)}…` : normalized;
}

function dbError(context: string, message: string | undefined) {
  return new Error(`${context}: ${message ?? "sem resposta do banco"}.`);
}

/* ------------------------------------------------------------------------------------------------
 * Enfileirar
 * ---------------------------------------------------------------------------------------------- */

export type EnqueueEmailInput = {
  kind: EmailKind;
  userId: string | null;
  to: string;
  subject: string;
  html: string;
  text?: string | null;
  idempotencyKey: string;
  /** So ids e rotulos curtos (produto, origem); nunca texto digitado nem dados alem do necessario. */
  metadata?: Record<string, unknown>;
};

/** Uma linha por chave: repetir a mesma chave devolve a linha que ja existia (`duplicate: true`). */
export async function enqueueEmail(db: EmailOutboxDb, input: EnqueueEmailInput): Promise<{ id: string; duplicate: boolean }> {
  const { data, error } = await db
    .from("email_outbox")
    .upsert(
      {
        html: input.html,
        idempotency_key: input.idempotencyKey,
        kind: input.kind,
        metadata: input.metadata ?? {},
        subject: input.subject,
        text: input.text ?? null,
        to_email: input.to,
        user_id: input.userId
      },
      { ignoreDuplicates: true, onConflict: "idempotency_key" }
    )
    .select("id");

  if (error) {
    throw dbError(`Não foi possível enfileirar o e-mail "${input.kind}"`, error.message);
  }

  const inserted = (data ?? []) as { id: string }[];

  if (inserted.length > 0) {
    return { duplicate: false, id: inserted[0].id };
  }

  const existing = await db.from("email_outbox").select("id").eq("idempotency_key", input.idempotencyKey).maybeSingle<{ id: string }>();

  if (existing.error) {
    throw dbError("Não foi possível ler o e-mail já enfileirado", existing.error.message);
  }

  return { duplicate: true, id: existing.data?.id ?? "" };
}

/* ------------------------------------------------------------------------------------------------
 * Processar (job email-outbox)
 * ---------------------------------------------------------------------------------------------- */

export type ProcessEmailOutboxInput = {
  db: EmailOutboxDb;
  /** null = nenhum provedor configurado: a fila espera. */
  provider: EmailProvider | null;
  from: string;
  replyTo: string | null;
  dailyLimit: number;
  now?: Date;
  signal?: AbortSignal;
  maxPerRun?: number;
  pauseMs?: number;
};

export type ProcessEmailOutboxResult = {
  provider: string | null;
  /** Linhas ainda na fila ao terminar. */
  queued: number;
  sent: number;
  retried: number;
  failed: number;
  expired: number;
  /** Parou porque o provedor devolveu limite (429/cota). */
  throttled: boolean;
  /** Parou porque o orcamento do tick acabou. */
  stoppedByBudget: boolean;
  remainingToday: number;
};

async function countRows(db: EmailOutboxDb, build: (query: ReturnType<EmailOutboxDb["from"]>) => PromiseLike<{ count: number | null; error: { message: string } | null }>, context: string) {
  const { count, error } = await build(db.from("email_outbox"));

  if (error) {
    throw dbError(context, error.message);
  }

  return count ?? 0;
}

export function countQueuedEmails(db: EmailOutboxDb) {
  return countRows(db, (query) => query.select("id", { count: "exact", head: true }).eq("status", "queued" satisfies EmailOutboxStatus), "Não foi possível contar a fila de e-mails");
}

export function countEmailsSentSince(db: EmailOutboxDb, since: Date) {
  return countRows(db, (query) => query.select("id", { count: "exact", head: true }).gte("sent_at", since.toISOString()), "Não foi possível contar os e-mails do dia");
}

/** Linhas presas em `sending` (funcao encerrada no meio do envio) voltam para a fila. */
async function requeueStaleSending(db: EmailOutboxDb, now: Date) {
  const cutoff = new Date(now.getTime() - STALE_SENDING_MS).toISOString();
  const { error } = await db
    .from("email_outbox")
    .update({ next_attempt_at: now.toISOString(), status: "queued" satisfies EmailOutboxStatus })
    .eq("status", "sending" satisfies EmailOutboxStatus)
    .lt("updated_at", cutoff);

  if (error) {
    throw dbError("Não foi possível recuperar envios interrompidos", error.message);
  }
}

/** E-mail que esperou mais de 7 dias (sem provedor) nao sai mais: vira `failed` com o motivo. */
async function expireOldQueued(db: EmailOutboxDb, now: Date) {
  const cutoff = new Date(now.getTime() - MAX_QUEUE_AGE_MS).toISOString();
  const { data, error } = await db
    .from("email_outbox")
    .update({ last_error: EXPIRED_IN_QUEUE_ERROR, status: "failed" satisfies EmailOutboxStatus })
    .eq("status", "queued" satisfies EmailOutboxStatus)
    .lt("created_at", cutoff)
    .select("id");

  if (error) {
    throw dbError("Não foi possível expirar e-mails antigos da fila", error.message);
  }

  return (data ?? []).length;
}

async function fetchDueEmails(db: EmailOutboxDb, now: Date, limit: number): Promise<EmailOutboxRow[]> {
  const { data, error } = await db
    .from("email_outbox")
    .select(EMAIL_OUTBOX_COLUMNS)
    .eq("status", "queued" satisfies EmailOutboxStatus)
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw dbError("Não foi possível ler a fila de e-mails", error.message);
  }

  return (data ?? []) as EmailOutboxRow[];
}

/** Marca `sending` so se ainda estiver `queued`: dois ticks no mesmo minuto nao enviam a mesma linha. */
async function claimEmail(db: EmailOutboxDb, id: string) {
  const { data, error } = await db
    .from("email_outbox")
    .update({ status: "sending" satisfies EmailOutboxStatus })
    .eq("id", id)
    .eq("status", "queued" satisfies EmailOutboxStatus)
    .select("id");

  if (error) {
    throw dbError("Não foi possível reservar o e-mail para envio", error.message);
  }

  return (data ?? []).length === 1;
}

async function updateOutbox(db: EmailOutboxDb, id: string, patch: Record<string, unknown>) {
  const { error } = await db.from("email_outbox").update(patch).eq("id", id);

  if (error) {
    throw dbError("Não foi possível gravar o resultado do envio", error.message);
  }
}

export async function processEmailOutbox(input: ProcessEmailOutboxInput): Promise<ProcessEmailOutboxResult> {
  const { db, provider } = input;
  const now = input.now ?? new Date();
  const maxPerRun = input.maxPerRun ?? MAX_EMAILS_PER_RUN;
  const pauseMs = input.pauseMs ?? PAUSE_BETWEEN_SENDS_MS;
  const result: ProcessEmailOutboxResult = {
    expired: 0,
    failed: 0,
    provider: provider?.name ?? null,
    queued: 0,
    remainingToday: 0,
    retried: 0,
    sent: 0,
    stoppedByBudget: false,
    throttled: false
  };

  await requeueStaleSending(db, now);
  result.expired = await expireOldQueued(db, now);

  if (!provider) {
    result.queued = await countQueuedEmails(db);

    return result;
  }

  const sentToday = await countEmailsSentSince(db, startOfUtcDay(now));
  result.remainingToday = remainingDailyQuota(input.dailyLimit, sentToday);

  if (result.remainingToday === 0) {
    result.queued = await countQueuedEmails(db);

    return result;
  }

  const due = await fetchDueEmails(db, now, Math.min(result.remainingToday, maxPerRun));

  for (let index = 0; index < due.length; index += 1) {
    const row = due[index];

    if (input.signal?.aborted) {
      result.stoppedByBudget = true;
      break;
    }

    if (!(await claimEmail(db, row.id))) {
      continue;
    }

    // Sem destinatario ou sem corpo so existe linha anonimizada pela retencao, que ja sai da fila como
    // failed; se uma aparecer mesmo assim, encerra com o motivo em vez de mandar um e-mail vazio.
    if (row.to_email === null || row.html === null) {
      await updateOutbox(db, row.id, { last_error: "Sem destinatário ou sem conteúdo: linha anonimizada pela retenção.", status: "failed" satisfies EmailOutboxStatus });
      result.failed += 1;
      continue;
    }

    const sendResult = await provider.send(
      {
        from: input.from,
        html: row.html,
        idempotencyKey: row.idempotency_key,
        replyTo: input.replyTo,
        subject: row.subject,
        text: row.text,
        to: row.to_email
      },
      { signal: input.signal }
    );
    const plan = planAfterAttempt(sendResult, row.attempts, new Date());

    if (plan.status === "sent") {
      await updateOutbox(db, row.id, {
        attempts: plan.attempts,
        last_error: null,
        provider: provider.name,
        provider_message_id: plan.providerMessageId,
        sent_at: new Date().toISOString(),
        status: "sent" satisfies EmailOutboxStatus
      });
      result.sent += 1;
      result.remainingToday -= 1;
    } else if (plan.status === "failed") {
      await updateOutbox(db, row.id, {
        attempts: plan.attempts,
        last_error: shortError(plan.error),
        provider: provider.name,
        status: "failed" satisfies EmailOutboxStatus
      });
      result.failed += 1;
      console.error(`[e-mail] ${row.kind} para a linha ${row.id} falhou de vez: ${shortError(plan.error)}`);
    } else {
      await updateOutbox(db, row.id, {
        attempts: plan.attempts,
        last_error: shortError(plan.error),
        next_attempt_at: plan.nextAttemptAt.toISOString(),
        provider: provider.name,
        status: "queued" satisfies EmailOutboxStatus
      });
      result.retried += 1;

      if (plan.stopRun) {
        result.throttled = true;
        console.warn(`[e-mail] provedor limitou o envio; a fila volta no proximo tick: ${shortError(plan.error)}`);
        break;
      }
    }

    if (index < due.length - 1 && pauseMs > 0) {
      await sleep(pauseMs, undefined, { signal: input.signal }).catch(() => undefined);
    }
  }

  result.queued = await countQueuedEmails(db);

  return result;
}

/* ------------------------------------------------------------------------------------------------
 * Eventos do provedor (webhook assinado)
 * ---------------------------------------------------------------------------------------------- */

export type RecordEmailWebhookEventInput = {
  provider: string;
  /** Id unico do evento no provedor (cabecalho svix-id). */
  eventId: string;
  eventType: string;
  providerMessageId: string | null;
  payload: unknown;
};

/** Guarda o payload bruto; o mesmo evento (provider + event_id) entregue de novo devolve `duplicate: true`. */
export async function recordEmailWebhookEvent(db: EmailOutboxDb, input: RecordEmailWebhookEventInput): Promise<{ id: string | null; duplicate: boolean }> {
  const { data, error } = await db
    .from("email_webhook_events")
    .upsert(
      {
        event_id: input.eventId,
        event_type: input.eventType,
        payload: input.payload,
        provider: input.provider,
        provider_message_id: input.providerMessageId
      },
      { ignoreDuplicates: true, onConflict: "provider,event_id" }
    )
    .select("id");

  if (error) {
    throw dbError("Não foi possível guardar o evento do provedor de e-mail", error.message);
  }

  const inserted = (data ?? []) as { id: string }[];

  return inserted.length > 0 ? { duplicate: false, id: inserted[0].id } : { duplicate: true, id: null };
}

export async function markEmailWebhookEventProcessed(db: EmailOutboxDb, id: string, result: { outboxId: string | null; error?: string | null }) {
  const { error } = await db
    .from("email_webhook_events")
    .update({ error: result.error ? shortError(result.error) : null, outbox_id: result.outboxId, processed_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    throw dbError("Não foi possível marcar o evento do provedor como processado", error.message);
  }
}

/**
 * Aplica o evento na linha da fila com aquele id do provedor. So linhas `sent` mudam (bounce,
 * reclamacao e falha nao voltam atras); e-mails que nao sairam desta fila (Auth do Supabase pelo
 * mesmo Resend) nao tem linha e sao so auditados.
 */
export async function applyEmailWebhookEvent(db: EmailOutboxDb, event: ResendWebhookEvent, now = new Date()): Promise<{ outboxId: string | null; applied: boolean }> {
  const patch = outboxPatchFor(event);

  if (patch.kind === "ignore" || !event.emailId) {
    return { applied: false, outboxId: null };
  }

  const { data, error } = await db
    .from("email_outbox")
    .select("id,status")
    .eq("provider_message_id", event.emailId)
    .limit(1)
    .maybeSingle<{ id: string; status: EmailOutboxStatus }>();

  if (error) {
    throw dbError("Não foi possível localizar o e-mail do evento", error.message);
  }

  if (!data) {
    return { applied: false, outboxId: null };
  }

  if (data.status !== "sent") {
    return { applied: false, outboxId: data.id };
  }

  const occurredAt = event.occurredAt && Number.isFinite(Date.parse(event.occurredAt)) ? new Date(event.occurredAt).toISOString() : now.toISOString();
  let update: Record<string, unknown>;

  switch (patch.kind) {
    case "bounced":
      update = { bounced_at: occurredAt, last_error: shortError(patch.error), status: "bounced" satisfies EmailOutboxStatus };
      break;
    case "complained":
      update = { last_error: shortError(patch.error), status: "complained" satisfies EmailOutboxStatus };
      break;
    case "failed":
      update = { last_error: shortError(patch.error), status: "failed" satisfies EmailOutboxStatus };
      break;
    case "delivered":
      update = { delivered_at: occurredAt };
      break;
    case "delayed":
      update = { last_error: shortError(patch.error) };
      break;
  }

  const { error: updateError } = await db.from("email_outbox").update(update).eq("id", data.id).eq("status", "sent" satisfies EmailOutboxStatus);

  if (updateError) {
    throw dbError("Não foi possível aplicar o evento do provedor na fila", updateError.message);
  }

  return { applied: true, outboxId: data.id };
}
