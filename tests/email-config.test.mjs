import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Variaveis de e-mail (docs/06, secao E-mail transacional): qual provedor fica ligado e com que remetente.

const { DEFAULT_EMAIL_DAILY_LIMIT, DEFAULT_EMAIL_FROM, DEFAULT_EMAIL_REPLY_TO, isValidSender, readEmailConfig, readEmailDailyLimit } =
  await import("../src/server/email/config.ts");

test("sem EMAIL_PROVIDER o envio fica desligado (none) mesmo com a chave do Resend presente", () => {
  const config = readEmailConfig({ RESEND_API_KEY: "re_teste_123" });

  assert.equal(config.provider, "none");
  assert.match(config.disabledReason, /EMAIL_PROVIDER vazio/);
  assert.equal(config.resendApiKey, "re_teste_123");
});

test("EMAIL_PROVIDER=resend sem RESEND_API_KEY vira none com o motivo (dev e previews nao quebram)", () => {
  const config = readEmailConfig({ EMAIL_PROVIDER: "resend" });

  assert.equal(config.provider, "none");
  assert.match(config.disabledReason, /sem RESEND_API_KEY/);
});

test("EMAIL_PROVIDER=resend com a chave liga o Resend com remetente, Reply-To e limite padrao", () => {
  const config = readEmailConfig({ EMAIL_PROVIDER: " Resend ", RESEND_API_KEY: " re_teste_123 " });

  assert.equal(config.provider, "resend");
  assert.equal(config.disabledReason, null);
  assert.equal(config.resendApiKey, "re_teste_123");
  assert.equal(config.from, DEFAULT_EMAIL_FROM);
  assert.equal(config.replyTo, DEFAULT_EMAIL_REPLY_TO);
  assert.equal(config.dailyLimit, DEFAULT_EMAIL_DAILY_LIMIT);
  assert.equal(config.webhookSecret, null);
});

test("remetente, Reply-To, limite diario e segredo do webhook vem das variaveis quando definidos", () => {
  const config = readEmailConfig({
    EMAIL_DAILY_LIMIT: "40",
    EMAIL_FROM: "Escola <oi@mail.exemplo.test>",
    EMAIL_PROVIDER: "resend",
    EMAIL_REPLY_TO: "suporte@exemplo.test",
    RESEND_API_KEY: "re_teste_123",
    RESEND_WEBHOOK_SECRET: "whsec_abc"
  });

  assert.equal(config.from, "Escola <oi@mail.exemplo.test>");
  assert.equal(config.replyTo, "suporte@exemplo.test");
  assert.equal(config.dailyLimit, 40);
  assert.equal(config.webhookSecret, "whsec_abc");
  assert.equal(readEmailConfig({ EMAIL_PROVIDER: "resend", EMAIL_REPLY_TO: "none", RESEND_API_KEY: "re_1" }).replyTo, null);
});

test("provedor desconhecido, remetente invalido ou Reply-To invalido desligam o envio com o motivo", () => {
  assert.equal(readEmailConfig({ EMAIL_PROVIDER: "ses", RESEND_API_KEY: "re_1" }).provider, "none");
  assert.match(readEmailConfig({ EMAIL_PROVIDER: "ses", RESEND_API_KEY: "re_1" }).disabledReason, /nao e um provedor conhecido|não é um provedor conhecido/);
  const badFrom = readEmailConfig({ EMAIL_FROM: "sem-arroba", EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_1" });
  assert.equal(badFrom.provider, "none");
  assert.match(badFrom.disabledReason, /EMAIL_FROM/);
  const badReply = readEmailConfig({ EMAIL_PROVIDER: "resend", EMAIL_REPLY_TO: "x", RESEND_API_KEY: "re_1" });
  assert.equal(badReply.provider, "none");
  assert.match(badReply.disabledReason, /EMAIL_REPLY_TO/);
});

test("limite diario: vazio ou invalido volta ao padrao; zero e aceito (pausa o envio)", () => {
  assert.equal(readEmailDailyLimit(undefined), DEFAULT_EMAIL_DAILY_LIMIT);
  assert.equal(readEmailDailyLimit(""), DEFAULT_EMAIL_DAILY_LIMIT);
  assert.equal(readEmailDailyLimit("abc"), DEFAULT_EMAIL_DAILY_LIMIT);
  assert.equal(readEmailDailyLimit("-5"), DEFAULT_EMAIL_DAILY_LIMIT);
  assert.equal(readEmailDailyLimit("1.5"), DEFAULT_EMAIL_DAILY_LIMIT);
  assert.equal(readEmailDailyLimit("0"), 0);
  assert.equal(readEmailDailyLimit("250"), 250);
});

test("isValidSender aceita 'Nome <conta@dominio>' e so o endereco; recusa quebra de linha", () => {
  assert.equal(isValidSender("Bunker707 <equipe@mail.bunker707.com.br>"), true);
  assert.equal(isValidSender("equipe@mail.bunker707.com.br"), true);
  assert.equal(isValidSender("Equipe <equipe@mail.bunker707.com.br>\nBcc: x@y.z"), false);
  assert.equal(isValidSender("equipe"), false);
  assert.equal(isValidSender("<equipe@>"), false);
});
