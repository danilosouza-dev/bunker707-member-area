import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Assinatura dos webhooks do Resend (padrao Svix) e leitura dos eventos. Vetor de teste publicado em
// docs.svix.com/receiving/verifying-payloads/how-manual.

const { SVIX_TOLERANCE_SECONDS, isWebhookSecretConfigured, parseSvixSignatures, signSvixPayload, verifySvixSignature } =
  await import("../src/server/email/webhook-signature.ts");
const { outboxPatchFor, parseResendWebhookEvent } = await import("../src/server/email/webhook-events.ts");

const vector = {
  body: '{"event_type":"ping","data":{"success":true}}',
  id: "msg_loFOjxBNrRLzqYUf",
  secret: "whsec_plJ3nmyCDGBKInavdOK15jsl",
  signature: "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=",
  timestamp: "1731705121"
};
const vectorNow = Number(vector.timestamp) * 1000;

test("o vetor publicado pelo Svix verifica (HMAC-SHA256 de id.timestamp.corpo com o segredo whsec_)", () => {
  assert.equal(signSvixPayload(vector.secret, vector.id, vector.timestamp, vector.body), vector.signature.slice(3));
  assert.deepEqual(verifySvixSignature({ ...vector, now: vectorNow }), { ok: true });
});

test("corpo alterado, segredo errado ou assinatura de outro id sao recusados", () => {
  assert.equal(verifySvixSignature({ ...vector, body: `${vector.body} `, now: vectorNow }).ok, false);
  assert.equal(verifySvixSignature({ ...vector, now: vectorNow, secret: `whsec_${randomBytes(24).toString("base64")}` }).ok, false);
  assert.equal(verifySvixSignature({ ...vector, id: "msg_outro", now: vectorNow }).ok, false);
  assert.equal(verifySvixSignature({ ...vector, now: vectorNow, signature: "v1,AAAA" }).reason, "bad_signature");
});

test("timestamp fora da janela de 5 minutos e recusado (replay); dentro dela passa", () => {
  assert.equal(verifySvixSignature({ ...vector, now: vectorNow + (SVIX_TOLERANCE_SECONDS + 1) * 1000 }).reason, "stale_timestamp");
  assert.equal(verifySvixSignature({ ...vector, now: vectorNow - (SVIX_TOLERANCE_SECONDS + 1) * 1000 }).reason, "stale_timestamp");
  assert.equal(verifySvixSignature({ ...vector, now: vectorNow + SVIX_TOLERANCE_SECONDS * 1000 }).ok, true);
  assert.equal(verifySvixSignature({ ...vector, now: vectorNow, timestamp: "ontem" }).reason, "bad_timestamp");
});

test("cabecalhos ausentes e segredo invalido tem motivos proprios; varias assinaturas no cabecalho sao aceitas", () => {
  assert.equal(verifySvixSignature({ ...vector, now: vectorNow, signature: null }).reason, "missing_headers");
  assert.equal(verifySvixSignature({ ...vector, id: "", now: vectorNow }).reason, "missing_headers");
  assert.equal(verifySvixSignature({ ...vector, now: vectorNow, secret: "" }).reason, "bad_secret");
  assert.equal(verifySvixSignature({ ...vector, now: vectorNow, secret: "whsec_curto" }).reason, "bad_secret");
  assert.equal(isWebhookSecretConfigured(vector.secret), true);
  assert.equal(isWebhookSecretConfigured(undefined), false);
  assert.equal(isWebhookSecretConfigured("whsec_"), false);
  assert.deepEqual(parseSvixSignatures("v2,abc v1,def  v1,ghi"), ["def", "ghi"]);
  assert.equal(verifySvixSignature({ ...vector, now: vectorNow, signature: `v1,AAAA ${vector.signature}` }).ok, true);
});

test("um segredo gerado agora assina e verifica o proprio payload", () => {
  const secret = `whsec_${randomBytes(24).toString("base64")}`;
  const body = JSON.stringify({ data: { email_id: "abc" }, type: "email.delivered" });
  const now = Date.now();
  const timestamp = String(Math.floor(now / 1000));
  const signature = `v1,${signSvixPayload(secret, "msg_1", timestamp, body)}`;

  assert.deepEqual(verifySvixSignature({ body, id: "msg_1", now, secret, signature, timestamp }), { ok: true });
});

test("leitura do evento: tipo, id do e-mail e o motivo do bounce, da reclamacao ou da falha", () => {
  const bounced = parseResendWebhookEvent({
    created_at: "2026-10-17T12:00:00.000Z",
    data: { bounce: { message: "Caixa cheia", subType: "General", type: "Permanent" }, email_id: "e-1", to: ["a@b.test"] },
    type: "email.bounced"
  });

  assert.deepEqual(bounced, { detail: "Permanent/General: Caixa cheia", emailId: "e-1", known: true, occurredAt: "2026-10-17T12:00:00.000Z", type: "email.bounced" });
  assert.deepEqual(outboxPatchFor(bounced), { error: "Permanent/General: Caixa cheia", kind: "bounced" });

  const complained = parseResendWebhookEvent({ data: { email_id: "e-2" }, type: "email.complained" });
  assert.equal(outboxPatchFor(complained).kind, "complained");
  assert.match(outboxPatchFor(complained).error, /spam/);

  const failed = parseResendWebhookEvent({ data: { email_id: "e-3", failed: { reason: "Dominio nao verificado" } }, type: "email.failed" });
  assert.deepEqual(outboxPatchFor(failed), { error: "Dominio nao verificado", kind: "failed" });

  assert.equal(outboxPatchFor(parseResendWebhookEvent({ data: { email_id: "e-4" }, type: "email.delivered" })).kind, "delivered");
  assert.equal(outboxPatchFor(parseResendWebhookEvent({ data: { email_id: "e-5" }, type: "email.opened" })).kind, "ignore");
  assert.equal(outboxPatchFor(parseResendWebhookEvent({ data: { email_id: "e-6" }, type: "email.delivery_delayed" })).kind, "delayed");
});

test("payloads sem tipo, tipos desconhecidos e campos longos nao derrubam a leitura", () => {
  assert.equal(parseResendWebhookEvent(null), null);
  assert.equal(parseResendWebhookEvent({ data: {} }), null);
  assert.equal(parseResendWebhookEvent([]), null);
  const unknown = parseResendWebhookEvent({ data: { email_id: "x".repeat(500) }, type: "contact.created" });
  assert.equal(unknown.known, false);
  assert.equal(unknown.emailId.length, 120);
  assert.equal(outboxPatchFor(unknown).kind, "ignore");
  assert.equal(parseResendWebhookEvent({ data: { bounce: { message: "m".repeat(2_000) }, email_id: "e" }, type: "email.bounced" }).detail.length <= 600, true);
});
