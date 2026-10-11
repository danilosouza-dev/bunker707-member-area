import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// "Esqueci minha senha": cada pedido troca o codigo de verificacao guardado no navegador, entao um
// segundo clique invalida o link do e-mail anterior. O botao trava enquanto envia e por 1 minuto, os
// erros do Supabase viram frases que dizem o que fazer e o /auth/callback explica link que nao vale.

const reset = await import("../src/lib/auth/password-reset.ts");
const loginSource = await readFile(new URL("../src/components/login-experience.tsx", import.meta.url), "utf8");
const callbackSource = await readFile(new URL("../src/app/auth/callback/route.ts", import.meta.url), "utf8");
const loginPageSource = await readFile(new URL("../src/app/login/page.tsx", import.meta.url), "utf8");

test("limite de e-mails do Supabase vira aviso para aguardar, sem texto tecnico", () => {
  const message = reset.describePasswordResetError({
    code: "over_email_send_rate_limit",
    message: "email rate limit exceeded",
    status: 429
  });

  assert.match(message, /limite de e-mails/i);
  assert.match(message, /Aguarde/);
  assert.doesNotMatch(message, /rate limit|429/i);
});

test("pedido repetido em menos de 1 minuto pede para usar o e-mail mais recente", () => {
  assert.match(reset.describePasswordResetError({ code: "over_request_rate_limit", status: 429 }), /1 minuto/);
  assert.match(reset.describePasswordResetError({ status: 429 }), /e-mail mais recente/);
});

test("e-mail invalido e erro desconhecido nunca repassam a mensagem do servidor", () => {
  assert.equal(reset.describePasswordResetError({ code: "email_address_invalid" }), "Confira o e-mail digitado.");
  const unknown = reset.describePasswordResetError({ code: "unexpected_failure", message: "pq: connection refused" });
  assert.doesNotMatch(unknown, /pq:|connection/);
  assert.equal(reset.describePasswordResetError(null), unknown);
  assert.equal(reset.describePasswordResetError(undefined), unknown);
});

test("o login so mostra mensagem para os valores de ?erro= que o callback usa", () => {
  assert.equal(reset.readAuthLinkError("link"), reset.AUTH_LINK_ERROR_MESSAGE);
  assert.equal(reset.readAuthLinkError(["link", "x"]), reset.AUTH_LINK_ERROR_MESSAGE);
  assert.equal(reset.readAuthLinkError("oauth"), reset.AUTH_OAUTH_ERROR_MESSAGE);
  assert.equal(reset.readAuthLinkError(undefined), undefined);
  assert.equal(reset.readAuthLinkError("<script>"), undefined, "texto vindo do endereco nunca aparece na tela");
  assert.match(reset.AUTH_LINK_ERROR_MESSAGE, /outro navegador/);
});

test("link de e-mail e login social recebem mensagens diferentes", () => {
  assert.equal(reset.authCallbackErrorValue("email"), reset.AUTH_LINK_ERROR_VALUE);
  assert.equal(reset.authCallbackErrorValue("google"), reset.AUTH_OAUTH_ERROR_VALUE);
  assert.equal(reset.authCallbackErrorValue(null), reset.AUTH_OAUTH_ERROR_VALUE);
});

test("o botao Esqueci minha senha trava enquanto envia e por um minuto depois do envio", () => {
  assert.equal(reset.PASSWORD_RESET_COOLDOWN_MS, 60_000);
  assert.match(loginSource, /disabled=\{!authConfigured \|\| resetPending \|\| resetLocked\}/);
  assert.match(loginSource, /if \(resetPending \|\| resetLocked\) \{\s*return;/);
  assert.match(loginSource, /setTimeout\(\(\) => setResetLocked\(false\), PASSWORD_RESET_COOLDOWN_MS\)/);
  assert.match(loginSource, /finally \{\s*setResetPending\(false\);/);
  assert.match(loginSource, /describePasswordResetError\(error\)/);
  assert.doesNotMatch(loginSource, /Nao foi possivel enviar a recuperacao de senha/);
});

test("o callback devolve ?erro= quando o codigo nao troca por sessao ou o link expirou", () => {
  assert.equal((callbackSource.match(/searchParams\.set\(AUTH_LINK_ERROR_PARAM, authCallbackErrorValue\(provider\)\)/g) ?? []).length, 2);
  assert.match(callbackSource, /searchParams\.has\("error_code"\)/);
  assert.match(loginPageSource, /initialErrorMessage=\{readAuthLinkError\(resolvedSearchParams\?\.erro\)\}/);
});
