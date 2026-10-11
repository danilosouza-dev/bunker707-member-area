import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Secret key de outro projeto Supabase: a tela de erro precisa apontar a chave, nao as migracoes.

const keyError = await import("../src/server/db/supabase-key-error.ts");
const pending = await import("../src/server/db/pending-migration.ts");

const invalidKey = {
  hint: "Double check the provided API key for typos. This API key might also be owned by another Supabase project.",
  message: "Invalid API key"
};

test("reconhece a resposta do Supabase para chave de outro projeto", () => {
  assert.equal(keyError.isInvalidSupabaseKeyError(invalidKey), true);
  assert.equal(keyError.isInvalidSupabaseKeyError({ message: "invalid api key" }), true);
  assert.equal(keyError.isInvalidSupabaseKeyError({ hint: invalidKey.hint, message: "x" }), true);
});

test("nao confunde erro comum, migracao pendente ou valores vazios com chave errada", () => {
  assert.equal(keyError.isInvalidSupabaseKeyError(null), false);
  assert.equal(keyError.isInvalidSupabaseKeyError("Invalid API key"), false);
  assert.equal(keyError.isInvalidSupabaseKeyError({ code: "PGRST202", message: "Could not find the function public.x" }), false);
  assert.equal(keyError.isInvalidSupabaseKeyError({ code: "23505", message: "duplicate key value" }), false);
});

test("telas novas do admin mostram a mensagem da chave, nao o aviso de migracao pendente", () => {
  const error = pending.toDbError(invalidKey, "Lista de produtos");
  assert.equal(pending.isPendingMigrationError(error), false);
  assert.match(error.message, /^Lista de produtos: A chave do servidor do Supabase não pertence ao projeto configurado/);
  assert.match(error.message, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(error.message, /migra/i);
});
