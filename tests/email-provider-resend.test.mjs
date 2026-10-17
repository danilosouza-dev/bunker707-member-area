import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Provedor Resend por HTTP: o que vai no pedido e como cada resposta vira "enviado", "tentar de novo",
// "limite" ou "falhou". O fetch e falso: nenhum pedido sai da maquina.

const { RESEND_API_URL, classifyResendFailure, createResendProvider } = await import("../src/server/email/providers/resend.ts");

const message = {
  from: "Bunker707 <equipe@mail.bunker707.com.br>",
  html: "<p>Olá</p>",
  idempotencyKey: "welcome:00000000-0000-4000-8000-000000000001",
  replyTo: "contato@bunker707.com.br",
  subject: "Seu acesso",
  text: "Olá",
  to: "aluna.teste@bunker707.test"
};

function fakeFetch(status, body, calls = []) {
  return Object.assign(
    async (url, init) => {
      calls.push({ init, url });

      return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    },
    { calls }
  );
}

test("envia com Bearer, Idempotency-Key e os campos do Resend; a resposta 200 devolve o id", async () => {
  const fetch = fakeFetch(200, { id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
  const provider = createResendProvider({ apiKey: "re_teste_123", fetch });
  const result = await provider.send(message);

  assert.deepEqual(result, { ok: true, providerMessageId: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });
  assert.equal(provider.name, "resend");
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, RESEND_API_URL);
  assert.equal(fetch.calls[0].init.method, "POST");
  assert.equal(fetch.calls[0].init.headers.Authorization, "Bearer re_teste_123");
  assert.equal(fetch.calls[0].init.headers["Idempotency-Key"], message.idempotencyKey);
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), {
    from: message.from,
    html: message.html,
    reply_to: message.replyTo,
    subject: message.subject,
    text: message.text,
    to: [message.to]
  });
});

test("sem Reply-To e sem texto, os campos nem vao no pedido", async () => {
  const fetch = fakeFetch(200, { id: "x" });
  await createResendProvider({ apiKey: "re_1", fetch }).send({ ...message, replyTo: null, text: null });
  const body = JSON.parse(fetch.calls[0].init.body);

  assert.equal("reply_to" in body, false);
  assert.equal("text" in body, false);
});

test("429 (limite por segundo ou cota do dia) e 'limite': volta para a fila sem contar tentativa", async () => {
  const perSecond = await createResendProvider({ apiKey: "re_1", fetch: fakeFetch(429, { message: "Too many requests", name: "rate_limit_exceeded", statusCode: 429 }) }).send(message);
  assert.equal(perSecond.ok, false);
  assert.equal(perSecond.outcome, "throttle");
  assert.equal(perSecond.retryAfterMs, 60_000);
  assert.match(perSecond.error, /HTTP 429: rate_limit_exceeded/);

  const daily = await createResendProvider({ apiKey: "re_1", fetch: fakeFetch(429, { message: "Daily quota", name: "daily_quota_exceeded" }) }).send(message);
  assert.equal(daily.outcome, "throttle");
  assert.equal(daily.retryAfterMs, 60 * 60_000);
});

test("5xx, timeout e chave de idempotencia ainda em uso sao 'tentar de novo'; 4xx de validacao e 'falhou'", async () => {
  assert.equal((await createResendProvider({ apiKey: "re_1", fetch: fakeFetch(500, "erro interno") }).send(message)).outcome, "retry");
  assert.equal((await createResendProvider({ apiKey: "re_1", fetch: fakeFetch(503, { name: "application_error" }) }).send(message)).outcome, "retry");
  assert.equal((await createResendProvider({ apiKey: "re_1", fetch: fakeFetch(409, { name: "concurrent_idempotent_requests" }) }).send(message)).outcome, "retry");
  assert.equal((await createResendProvider({ apiKey: "re_1", fetch: fakeFetch(409, { name: "invalid_idempotent_request" }) }).send(message)).outcome, "fail");
  assert.equal((await createResendProvider({ apiKey: "re_1", fetch: fakeFetch(422, { message: "Invalid `to`", name: "validation_error" }) }).send(message)).outcome, "fail");
  assert.equal((await createResendProvider({ apiKey: "re_1", fetch: fakeFetch(403, { message: "Domain is not verified", name: "validation_error" }) }).send(message)).outcome, "fail");
  assert.equal((await createResendProvider({ apiKey: "re_1", fetch: fakeFetch(401, { name: "missing_api_key" }) }).send(message)).outcome, "fail");
  assert.deepEqual(classifyResendFailure(408, null), { outcome: "retry", retryAfterMs: null });
});

test("sem resposta (rede caiu) e 'tentar de novo' com a mensagem do erro", async () => {
  const provider = createResendProvider({
    apiKey: "re_1",
    fetch: async () => {
      throw new Error("ECONNRESET");
    }
  });
  const result = await provider.send(message);

  assert.equal(result.ok, false);
  assert.equal(result.outcome, "retry");
  assert.match(result.error, /ECONNRESET/);
});

test("a chave de idempotencia precisa ter de 1 a 256 caracteres; fora disso falha antes de chamar o Resend", async () => {
  const fetch = fakeFetch(200, { id: "x" });
  const provider = createResendProvider({ apiKey: "re_1", fetch });

  assert.equal((await provider.send({ ...message, idempotencyKey: "" })).outcome, "fail");
  assert.equal((await provider.send({ ...message, idempotencyKey: "k".repeat(257) })).outcome, "fail");
  assert.equal(fetch.calls.length, 0);
  assert.throws(() => createResendProvider({ apiKey: "  " }), /sem chave/);
});

test("a mensagem de erro guardada e curta e nunca carrega a chave da API", async () => {
  const provider = createResendProvider({ apiKey: "re_segredo_123", fetch: fakeFetch(500, "x".repeat(5_000)) });
  const result = await provider.send(message);

  assert.ok(result.error.length <= 500);
  assert.doesNotMatch(result.error, /re_segredo_123/);
});
