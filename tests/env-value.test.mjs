import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Chave colada com quebra de linha no painel da Vercel derrubou o servidor ("invalid header value") e a
// mensagem de erro levou a chave inteira para o log. As chaves passam a ser limpas e os logs, mascarados.

const { cleanEnvValue, redactSecrets } = await import("../src/lib/env-value.ts");
const pending = await import("../src/server/db/pending-migration.ts");

test("chave com espaco ou quebra de linha volta inteira e sem espaco", () => {
  assert.equal(cleanEnvValue("sb_secret_abcDEF\n\nghi123_XYZ"), "sb_secret_abcDEFghi123_XYZ");
  assert.equal(cleanEnvValue("  https://exemplo.supabase.co \n"), "https://exemplo.supabase.co");
  assert.equal(cleanEnvValue(""), undefined, "vazio cai na proxima opcao do ??");
  assert.equal(cleanEnvValue("   "), undefined);
  assert.equal(cleanEnvValue(undefined), undefined);
});

test("mensagens de erro nunca carregam chave secreta, publicavel ou token", () => {
  const raw = 'TypeError: Headers.set: "sb_secret_lFkAA\n\nPm9tExemploFicticio_123" is an invalid header value.';
  const safe = redactSecrets(raw);
  assert.doesNotMatch(safe, /Pm9tExemplo|lFkAA/);
  assert.match(safe, /sb_secret_\[oculto\]/);
  assert.doesNotMatch(redactSecrets("chave sb_publishable_Abcdefghijkl123"), /Abcdefghijkl/);
  assert.doesNotMatch(redactSecrets("Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlMTIz"), /eyJhbGci/);
  assert.equal(redactSecrets("Could not find the function public.x"), "Could not find the function public.x");
});

test("erro do banco embrulhado pela camada de dados sai sem a chave", () => {
  const error = pending.toDbError({ message: 'Headers.set: "sb_secret_lFkAA\nPm9tExemploFicticio_123" is an invalid header value.' }, "Configurações da área de membros");
  assert.doesNotMatch(error.message, /Pm9tExemplo/);
  assert.match(error.message, /^Configurações da área de membros: /);
});
