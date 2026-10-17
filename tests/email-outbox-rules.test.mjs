import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Regras puras da fila de e-mails: limite diario por dia UTC, retentativa com espera crescente,
// dead-letter, validade da fila e chaves de idempotencia.

const rules = await import("../src/server/email/outbox-rules.ts");
const {
  EMAIL_RETRY_DELAYS_MS,
  EXPIRED_IN_QUEUE_ERROR,
  MAX_EMAIL_ATTEMPTS,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_QUEUE_AGE_MS,
  idempotencyKeyOf,
  isExpiredInQueue,
  planAfterAttempt,
  purchaseIdempotencyKey,
  remainingDailyQuota,
  retryDelayMs,
  startOfUtcDay,
  welcomeIdempotencyKey
} = rules;

const now = new Date("2026-10-17T15:30:00.000Z");

test("o dia do limite e o dia do calendario UTC (o Resend conta assim), nao o de Sao Paulo", () => {
  assert.equal(startOfUtcDay(now).toISOString(), "2026-10-17T00:00:00.000Z");
  // 23:30 em Sao Paulo (UTC-3) ja e 02:30 do dia seguinte em UTC.
  assert.equal(startOfUtcDay(new Date("2026-10-18T02:30:00.000Z")).toISOString(), "2026-10-18T00:00:00.000Z");
  assert.equal(remainingDailyQuota(90, 0), 90);
  assert.equal(remainingDailyQuota(90, 89), 1);
  assert.equal(remainingDailyQuota(90, 90), 0);
  assert.equal(remainingDailyQuota(90, 120), 0);
  assert.equal(remainingDailyQuota(0, 0), 0);
});

test("a espera cresce a cada falha (1 min, 5 min, 30 min, 2 h, 12 h) e para na ultima", () => {
  assert.deepEqual(EMAIL_RETRY_DELAYS_MS, [60_000, 300_000, 1_800_000, 7_200_000, 43_200_000]);
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(3), 1_800_000);
  assert.equal(retryDelayMs(99), 43_200_000);
  assert.equal(retryDelayMs(0), 60_000);
});

test("sucesso vira sent com o id do provedor e conta a tentativa", () => {
  assert.deepEqual(planAfterAttempt({ ok: true, providerMessageId: "abc" }, 0, now), { attempts: 1, providerMessageId: "abc", status: "sent" });
});

test("erro passageiro volta para a fila com a espera da tentativa; na quinta falha vira failed", () => {
  const first = planAfterAttempt({ error: "HTTP 500", ok: false, outcome: "retry" }, 0, now);
  assert.equal(first.status, "queued");
  assert.equal(first.attempts, 1);
  assert.equal(first.stopRun, false);
  assert.equal(first.nextAttemptAt.getTime(), now.getTime() + 60_000);
  assert.equal(first.error, "HTTP 500");

  const second = planAfterAttempt({ error: "HTTP 500", ok: false, outcome: "retry" }, 1, now);
  assert.equal(second.nextAttemptAt.getTime(), now.getTime() + 300_000);

  const withHint = planAfterAttempt({ error: "em uso", ok: false, outcome: "retry", retryAfterMs: 10_000 }, 1, now);
  assert.equal(withHint.nextAttemptAt.getTime(), now.getTime() + 10_000);

  const last = planAfterAttempt({ error: "HTTP 500", ok: false, outcome: "retry" }, MAX_EMAIL_ATTEMPTS - 1, now);
  assert.deepEqual(last, { attempts: MAX_EMAIL_ATTEMPTS, error: "HTTP 500", status: "failed" });
});

test("limite do provedor nao conta tentativa, espera o tempo indicado e manda parar o lote", () => {
  const plan = planAfterAttempt({ error: "HTTP 429", ok: false, outcome: "throttle", retryAfterMs: 3_600_000 }, 2, now);

  assert.equal(plan.status, "queued");
  assert.equal(plan.attempts, 2);
  assert.equal(plan.stopRun, true);
  assert.equal(plan.nextAttemptAt.getTime(), now.getTime() + 3_600_000);
  assert.equal(planAfterAttempt({ error: "HTTP 429", ok: false, outcome: "throttle" }, 0, now).nextAttemptAt.getTime(), now.getTime() + 60_000);
});

test("erro definitivo vira failed na primeira vez", () => {
  assert.deepEqual(planAfterAttempt({ error: "HTTP 422", ok: false, outcome: "fail" }, 0, now), { attempts: 1, error: "HTTP 422", status: "failed" });
});

test("e-mail parado na fila ha mais de 7 dias expira em vez de sair atrasado", () => {
  assert.equal(MAX_QUEUE_AGE_MS, 7 * 24 * 60 * 60_000);
  assert.equal(isExpiredInQueue(new Date(now.getTime() - MAX_QUEUE_AGE_MS - 1), now), true);
  assert.equal(isExpiredInQueue(new Date(now.getTime() - MAX_QUEUE_AGE_MS + 60_000).toISOString(), now), false);
  assert.equal(isExpiredInQueue("data invalida", now), false);
  assert.match(EXPIRED_IN_QUEUE_ERROR, /7 dias/);
});

test("chaves de idempotencia: boas-vindas por conta; compra por evento da venda ou pelos acessos abertos", () => {
  assert.equal(welcomeIdempotencyKey("u-1"), "welcome:u-1");
  assert.equal(purchaseIdempotencyKey({ entitlementIds: ["e-2", "e-1"], sourceEventId: "HP-123", sourceProvider: "hotmart", userId: "u-1" }), "purchase:hotmart:HP-123:u-1");
  assert.equal(purchaseIdempotencyKey({ entitlementIds: ["e-2", "e-1"], sourceEventId: null, sourceProvider: "hotmart", userId: "u-1" }), "purchase:hotmart:u-1:e-1:e-2");
  assert.equal(idempotencyKeyOf("a", " b ", null, undefined, "", 3), "a:b:3");
});

test("chave acima de 256 caracteres vira prefixo + SHA-256, estavel para a mesma entrada", () => {
  const long = idempotencyKeyOf("purchase", "hotmart", "u-1", ..."abcdefghij".split("").map((letter) => letter.repeat(40)));

  assert.ok(long.length <= MAX_IDEMPOTENCY_KEY_LENGTH, `${long.length}`);
  assert.match(long, /^purchase:hotmart:u-1:[a]{19}:[0-9a-f]{64}$/);
  assert.equal(long, idempotencyKeyOf("purchase", "hotmart", "u-1", ..."abcdefghij".split("").map((letter) => letter.repeat(40))));
});
