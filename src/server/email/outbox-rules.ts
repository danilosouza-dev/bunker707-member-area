// Regras puras da fila `email_outbox` (docs/04, secao E-mail): limite diario, retentativa com
// espera crescente, validade da fila e chaves de idempotencia. Sem banco e sem "server-only":
// tests/email-outbox-rules.test.mjs cobre cada regra; outbox.ts aplica as regras no banco.

import { createHash } from "node:crypto";
import type { EmailSendResult } from "./types";

export const EMAIL_OUTBOX_STATUSES = ["queued", "sending", "sent", "failed", "bounced", "complained"] as const;
export type EmailOutboxStatus = (typeof EMAIL_OUTBOX_STATUSES)[number];

export const EMAIL_KINDS = ["welcome", "purchase"] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

/** Depois desta quantidade de falhas passageiras a linha vira `failed` (dead-letter). */
export const MAX_EMAIL_ATTEMPTS = 5;
/** Espera antes de cada nova tentativa, pela tentativa que acabou de falhar (1a, 2a, ...). */
export const EMAIL_RETRY_DELAYS_MS: readonly number[] = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];
/** Linha em `sending` ha mais tempo que isso ficou orfa (funcao encerrada no meio): volta para a fila. */
export const STALE_SENDING_MS = 10 * 60_000;
/** E-mail que esperou mais que isso na fila (provedor desligado) nao e enviado: vira `failed` com motivo. */
export const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60_000;
export const EXPIRED_IN_QUEUE_ERROR = "Expirou na fila: ficou mais de 7 dias sem provedor de e-mail configurado.";
/** Envios por tick: o Resend aceita 2 pedidos por segundo e o tick tem 45 s de orcamento. */
export const MAX_EMAILS_PER_RUN = 25;
export const PAUSE_BETWEEN_SENDS_MS = 550;
/** Tamanho maximo da chave de idempotencia guardada (e aceita pelo Resend). */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

/** Inicio do dia UTC em que `now` esta: a cota diaria do Resend conta por dia do calendario UTC. */
export function startOfUtcDay(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Quantos e-mails ainda cabem hoje. */
export function remainingDailyQuota(dailyLimit: number, sentToday: number) {
  return Math.max(0, Math.floor(dailyLimit) - Math.max(0, sentToday));
}

export function retryDelayMs(attemptsSoFar: number) {
  const index = Math.min(Math.max(attemptsSoFar, 1), EMAIL_RETRY_DELAYS_MS.length) - 1;

  return EMAIL_RETRY_DELAYS_MS[index];
}

export type AttemptPlan =
  | { status: "sent"; attempts: number; providerMessageId: string | null }
  | { status: "queued"; attempts: number; nextAttemptAt: Date; error: string; stopRun: boolean }
  | { status: "failed"; attempts: number; error: string };

/**
 * O que gravar na linha depois de uma tentativa. `attemptsBefore` e o valor atual da coluna.
 * - sucesso: `sent`;
 * - `throttle` (limite do provedor): volta para a fila SEM contar tentativa e o lote para (`stopRun`);
 * - `retry`: conta a tentativa e espera; na ultima permitida vira `failed`;
 * - `fail`: `failed` na hora.
 */
export function planAfterAttempt(result: EmailSendResult, attemptsBefore: number, now: Date): AttemptPlan {
  if (result.ok) {
    return { attempts: attemptsBefore + 1, providerMessageId: result.providerMessageId, status: "sent" };
  }

  if (result.outcome === "throttle") {
    const delay = result.retryAfterMs ?? 60_000;

    return { attempts: attemptsBefore, error: result.error, nextAttemptAt: new Date(now.getTime() + delay), status: "queued", stopRun: true };
  }

  const attempts = attemptsBefore + 1;

  if (result.outcome === "fail" || attempts >= MAX_EMAIL_ATTEMPTS) {
    return { attempts, error: result.error, status: "failed" };
  }

  const delay = result.retryAfterMs ?? retryDelayMs(attempts);

  return { attempts, error: result.error, nextAttemptAt: new Date(now.getTime() + delay), status: "queued", stopRun: false };
}

export function isExpiredInQueue(createdAt: string | Date, now: Date) {
  const created = typeof createdAt === "string" ? Date.parse(createdAt) : createdAt.getTime();

  return Number.isFinite(created) && now.getTime() - created > MAX_QUEUE_AGE_MS;
}

/** Chave curta e estavel: partes unidas por ":"; acima do limite vira um SHA-256 com o prefixo. */
export function idempotencyKeyOf(...parts: (string | number | null | undefined)[]) {
  const key = parts.map((part) => String(part ?? "").trim()).filter(Boolean).join(":");

  if (key.length <= MAX_IDEMPOTENCY_KEY_LENGTH) {
    return key;
  }

  const prefix = key.slice(0, 40).replace(/:+$/, "");

  return `${prefix}:${createHash("sha256").update(key, "utf8").digest("hex")}`;
}

export function welcomeIdempotencyKey(userId: string) {
  return idempotencyKeyOf("welcome", userId);
}

export function purchaseIdempotencyKey(input: { entitlementIds: string[]; sourceEventId: string | null | undefined; sourceProvider: string; userId: string }) {
  if (input.sourceEventId) {
    return idempotencyKeyOf("purchase", input.sourceProvider, input.sourceEventId, input.userId);
  }

  return idempotencyKeyOf("purchase", input.sourceProvider, input.userId, ...[...input.entitlementIds].sort());
}
