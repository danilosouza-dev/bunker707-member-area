import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import {
  assertOnlyAdds,
  assertSections,
  assertServiceRoleOnly,
  cumulativeHash,
  fileHash,
  migrationFiles,
  read,
  sqlCodeOf,
  sqlList
} from "./support/webinarios-migracao-guarda.mjs";

// Guarda da fase 4f dos webinarios (docs/30 §1.6 e §11): a migracao 202610300006_webinars_v4f_traducao.sql.
// - as migracoes ate a 202610300005 continuam byte a byte, e a 202610300006 e o texto exato (hash);
// - tres secoes MCP, idempotente, so acrescenta; as duas tabelas novas so do service_role;
// - os idiomas batem com CHAT_LANGUAGES / SOURCE_LANGUAGES; a traducao e guardada uma vez por texto (sha256) e idioma.

const MIGRATION = "supabase/migrations/202610300006_webinars_v4f_traducao.sql";
const model = await import("../src/server/webinars/model.ts");
const hash = await import("../src/server/webinars/text-hash.ts");

test("as migracoes ate a 202610300005 continuam byte a byte; a 202610300006 e o texto exato (aplicar antes do merge)", () => {
  const applied = cumulativeHash("202610300005_webinars_v4e_just_in_time.sql");
  assert.equal(applied.count, 61);
  assert.equal(applied.hash, "c242f358a4005715e920b37ef1866a58d8124f7f571e4f1466e6c4dda61df358", "uma migracao anterior mudou");
  assert.ok(migrationFiles().includes("202610300006_webinars_v4f_traducao.sql"));
  assert.equal(fileHash(MIGRATION), "0b9f580166b520ab5799628270ec2b6584b667a153ac74f65b7acf4523a29a94", "a 202610300006 mudou: confira de novo antes de aplicar na nuvem de teste (docs/21 §9.10; nenhuma foi aplicada ainda) e atualize este hash junto");
});

test("a 202610300006: tres secoes MCP, idempotente, so acrescenta; duas tabelas so do service_role", () => {
  const migration = read(MIGRATION);
  assertSections(migration, 3);
  assertOnlyAdds(migration);
  const code = sqlCodeOf(migration);
  assert.equal((code.match(/\bcreate table\b/gi) ?? []).length, 2);
  for (const table of ["webinar_viewer_prefs", "webinar_text_translations"]) {
    assertServiceRoleOnly(code, table);
  }
  assert.doesNotMatch(code, /grant[^;]*to (?:anon|authenticated|public)\b/i);
});

test("os idiomas batem com o app; a chave e o sha256 do texto normalizado", () => {
  const code = sqlCodeOf(read(MIGRATION));
  assert.match(code, new RegExp(`chat_language in \\(${sqlList(model.CHAT_LANGUAGES)}\\)`));
  assert.match(code, new RegExp(`language text not null check \\(language in \\(${sqlList(model.CHAT_LANGUAGES)}\\)\\)`));
  assert.match(code, new RegExp(`source_language in \\(${sqlList(model.SOURCE_LANGUAGES)}\\)`));
  assert.match(code, new RegExp(`check \\(language is null or language in \\(${sqlList(model.CHAT_LANGUAGES)}\\)\\)`));
  assert.match(code, new RegExp(`char_length\\(body\\) between 1 and ${model.TRANSLATION_LIMITS.body}`));
  assert.match(code, /primary key \(source_hash, language\)/, "uma traducao por texto e idioma");
  const pattern = code.match(/source_hash ~ '([^']+)'/)?.[1];
  assert.ok(pattern && new RegExp(pattern).test(hash.translationSourceHash("Olá, turma!")));
  assert.equal(hash.translationSourceHash("  Olá,\n turma! "), hash.translationSourceHash("Olá, turma!"), "espacos e quebras nao mudam a chave");
});
