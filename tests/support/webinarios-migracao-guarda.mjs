// Ajudantes das guardas das migracoes da fase 4 dos webinarios (tests/webinarios-v4*.guard.test.mjs), no desenho de
// tests/webinarios-v3.guard.test.mjs: o hash acumulado das migracoes ja aplicadas, o SQL sem comentarios, o corpo de uma
// funcao, as secoes MCP e a conferencia de que um corpo novo contem o antigo inteiro (create or replace com o corpo
// completo, sem perder linha). Nada aqui e importado por src/.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";

export const root = new URL("../../", import.meta.url);
export const read = (path) => readFileSync(new URL(path, root), "utf8");
export const sqlCodeOf = (source) => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, "");
/** O SQL sem comentarios e sem o conteudo dos literais (as palavras proibidas so contam fora deles). */
export const statementsOf = (source) => sqlCodeOf(source).replace(/'[^']*'/g, "''");

export function migrationFiles() {
  return readdirSync(new URL("supabase/migrations/", root))
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** O sha256 de nome + conteudo de cada migracao ate `upto` (inclusive), na ordem. */
export function cumulativeHash(upto) {
  const before = migrationFiles().filter((name) => name <= upto);
  const hash = createHash("sha256");
  for (const name of before) {
    hash.update(`${name}\n`);
    hash.update(readFileSync(new URL(`supabase/migrations/${name}`, root)));
  }
  return { count: before.length, hash: hash.digest("hex") };
}

export function fileHash(path) {
  return createHash("sha256").update(read(path)).digest("hex");
}

export function functionBody(code, name) {
  const start = code.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} existe`);
  const open = code.indexOf("$$", start);
  const close = code.indexOf("$$", open + 2);
  return { body: code.slice(open + 2, close), header: code.slice(start, open) };
}

/** As secoes numeradas (" * N. ... MCP."), na ordem, todas marcadas MCP. */
export function assertSections(migration, count) {
  const sections = migration.match(/^ \* \d{1,2}\. .+$/gm) ?? [];
  assert.equal(sections.length, count, `${count} secoes`);
  sections.forEach((line, index) => {
    assert.ok(line.startsWith(` * ${index + 1}. `), line);
    assert.match(line, /\bMCP\b/, `secao ${index + 1} marcada MCP`);
  });
  assert.match(migration, /^-- Idempotente: pode rodar de novo sem efeito\.$/m);
}

/** Nenhum drop, delete, truncate, create/alter policy nem concurrently fora dos literais. */
export function assertOnlyAdds(migration) {
  const statements = statementsOf(migration);
  assert.doesNotMatch(statements, /\bdrop\b/i, "nenhum drop");
  assert.doesNotMatch(statements, /^\s*delete\b|\bdelete\s+from\b/im, "nenhum delete (so os `on delete` das chaves e o grant)");
  assert.doesNotMatch(statements, /\btruncate\b/i);
  assert.doesNotMatch(statements, /\bcreate\s+policy\b/i);
  assert.doesNotMatch(statements, /\balter\s+policy\b/i);
  assert.doesNotMatch(statements, /\bconcurrently\b/i);
  assert.doesNotMatch(statements, /storage\.objects/i);
  assert.doesNotMatch(statements, /security\s+definer/i, "tudo security invoker");
  // Indice e trigger so atras do "if not exists" (indice) ou da guarda do pg_trigger (trigger).
  assert.equal((statements.match(/\bcreate (?:unique )?index\b/gi) ?? []).length, (statements.match(/\bcreate (?:unique )?index if not exists\b/gi) ?? []).length);
  const triggers = statements.match(/\bcreate trigger (\w+)/g) ?? [];
  for (const entry of triggers) {
    const name = entry.replace("create trigger ", "");
    assert.match(sqlCodeOf(migration), new RegExp(`where tgname = '${name}'[\\s\\S]*?create trigger ${name}\\b`), `${name} atras da guarda do pg_trigger`);
  }
  // Toda constraint nova tem nome e entra atras da guarda do pg_constraint.
  for (const entry of statements.match(/add constraint (\w+)/g) ?? []) {
    const name = entry.replace("add constraint ", "");
    assert.match(sqlCodeOf(migration), new RegExp(`if not exists \\(select 1 from pg_constraint where conname = '${name}'\\) then\\s*alter table public\\.\\w+ add constraint ${name}`), name);
  }
  assert.equal((statements.match(/\badd column\b/gi) ?? []).length, (statements.match(/\badd column if not exists\b/gi) ?? []).length, "toda coluna com if not exists");
  assert.equal((statements.match(/\bcreate table\b/gi) ?? []).length, (statements.match(/\bcreate table if not exists\b/gi) ?? []).length, "toda tabela com if not exists");
}

/** A tabela nova e so do service_role: RLS, revoke de anon e authenticated, grant, nenhuma politica. */
export function assertServiceRoleOnly(code, table) {
  assert.match(code, new RegExp(`create table if not exists public\\.${table} \\(`), table);
  assert.match(code, new RegExp(`alter table public\\.${table} enable row level security;`), table);
  assert.match(code, new RegExp(`revoke all on public\\.${table} from anon, authenticated;`), table);
  assert.match(code, new RegExp(`grant select, insert, update, delete on public\\.${table} to service_role;`), table);
}

/** A funcao so do service_role (revoke de public, anon e authenticated; grant execute). */
export function assertFunctionServiceRole(code, signature) {
  const escaped = signature.replace(/[()[\]]/g, "\\$&");
  assert.match(code, new RegExp(`revoke all on function public\\.${escaped} from public, anon, authenticated;`), signature);
  assert.match(code, new RegExp(`grant execute on function public\\.${escaped} to service_role;`), signature);
}

/** Todas as linhas (sem espacos nas pontas e nao vazias) do corpo antigo aparecem no novo, na mesma ordem. */
export function assertKeepsBody(oldBody, newBody, label) {
  const newLines = newBody.split("\n").map((line) => line.trim());
  let cursor = 0;
  for (const line of oldBody.split("\n").map((value) => value.trim()).filter(Boolean)) {
    const found = newLines.indexOf(line, cursor);
    assert.notEqual(found, -1, `${label}: a linha "${line}" do corpo anterior continua, na ordem`);
    cursor = found + 1;
  }
}

/** Uma lista do app escrita como lista de literais do SQL ('a', 'b'). */
export const sqlList = (values) => values.map((value) => `'${value}'`).join(", ");
