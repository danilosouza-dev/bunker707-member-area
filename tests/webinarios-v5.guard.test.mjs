import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { assertSections, cumulativeHash, fileHash, migrationFiles, read, sqlCodeOf, sqlList, statementsOf } from "./support/webinarios-migracao-guarda.mjs";

// Guarda da migracao do redesign V2 dos webinarios, fase 2 (docs/31 V2-9 e V2-A12; docs/21 §9.11; docs/18 §1.2): a
// 202611010001_webinars_v5_coapresentador.sql, que troca o check sem nome de webinar_chat_messages.role (da 0029) pelo
// check nomeado webinar_chat_messages_role_v5 com `co_host`.
// - as 63 migracoes ate a 202610300007 (todas aplicadas na nuvem de teste) continuam byte a byte (hash acumulado);
// - duas secoes MCP, idempotente; o unico drop e o do check antigo, dentro do bloco que so roda sem o check novo; o
//   check novo entra `not valid` na secao 1 e a secao 2 so o valida;
// - a lista do check e a do app (model.CHAT_ROLES); nada de delete, truncate, politica, tabela nova nem grant;
// - o aviso de migracao pendente aponta esta (WEBINARS_MIGRATION), sem constante propria para o co-apresentador.

const MIGRATION = "supabase/migrations/202611010001_webinars_v5_coapresentador.sql";
const model = await import("../src/server/webinars/model.ts");
// db.ts tem "server-only": as constantes sao lidas do texto.
const dbSource = read("src/server/webinars/db.ts");

/** O codigo de cada secao (sem comentarios), na ordem: o que vem depois do cabecalho numerado ate o proximo. */
function sectionsOf(source) {
  const headers = Array.from(source.matchAll(/^ \* (\d{1,2})\. .+\n \* -+ \*\/$/gm));
  return headers.map((header, index) => {
    const start = header.index + header[0].length;
    const end = index + 1 < headers.length ? source.lastIndexOf("/*", headers[index + 1].index) : source.length;
    return sqlCodeOf(source.slice(start, end)).trim();
  });
}

test("as 63 migracoes ate a 202610300007 continuam byte a byte (todas aplicadas); a 202611010001 vem logo depois e e o texto exato", () => {
  const applied = cumulativeHash("202610300007_webinars_v4_ajustes.sql");
  assert.equal(applied.count, 63);
  assert.equal(applied.hash, "0d38f79dbfea55c759cb0d68f8e9d2c73159996b405c6d2d09160cd124145a8e", "uma migracao ja aplicada mudou: a correcao vai numa migracao nova");
  const files = migrationFiles();
  assert.equal(files[files.indexOf("202610300007_webinars_v4_ajustes.sql") + 1], "202611010001_webinars_v5_coapresentador.sql", "logo depois dos ajustes da fase 4");
  assert.equal(
    fileHash(MIGRATION),
    "09236171456faae78dbfc097df1d86936aa38c16e3c58048fd5407c9fc127649",
    "a 202611010001 mudou: depois de aplicada na nuvem de teste (docs/21 §9.11), a correcao vai numa migracao nova; antes, aplique de novo e atualize este hash junto"
  );
});

test("a 202611010001: duas secoes MCP, idempotente; o unico drop e o do check sem nome, so sem o check novo; nada de delete, truncate, politica, tabela nem grant", () => {
  const migration = read(MIGRATION);
  assertSections(migration, 2);
  const statements = statementsOf(migration);
  const drops = statements.match(/\bdrop\s+\w+(?:\s+if\s+exists)?\s+[\w.]+/gi) ?? [];
  assert.deepEqual(
    drops.map((drop) => drop.replace(/\s+/g, " ").toLowerCase()),
    ["drop constraint if exists webinar_chat_messages_role_check"],
    "so o check antigo sai"
  );
  assert.doesNotMatch(statements, /^\s*delete\b|\bdelete\s+from\b/im, "nenhum delete");
  assert.doesNotMatch(statements, /\btruncate\b|\bcreate\s+policy\b|\balter\s+policy\b|\bconcurrently\b|\bcreate\s+table\b|\bgrant\b|\brevoke\b|\bupdate\s+public\b|security\s+definer/i);
  // So a tabela do chat muda, e so pelo check do papel.
  assert.deepEqual(Array.from(statements.matchAll(/\balter table ([\w.]+)/gi), (match) => match[1]), ["public.webinar_chat_messages", "public.webinar_chat_messages", "public.webinar_chat_messages"]);

  const [first, second] = sectionsOf(migration);
  // Secao 1: o drop e o add dentro do mesmo `if not exists` (rodar de novo nao derruba nem recria nada), o add sem ler
  // as linhas (`not valid`).
  assert.match(
    first,
    /^do \$\$\s*begin\s*if not exists \(select 1 from pg_constraint where conname = 'webinar_chat_messages_role_v5'\) then\s*alter table public\.webinar_chat_messages drop constraint if exists webinar_chat_messages_role_check;\s*alter table public\.webinar_chat_messages add constraint webinar_chat_messages_role_v5\s*check \(role in \([^)]*\)\) not valid;\s*end if;\s*end;\s*\$\$;$/,
    "o drop e o add juntos, atras da guarda do pg_constraint"
  );
  assert.doesNotMatch(first, /\bvalidate\b/, "a secao 1 nao le as linhas");
  // Secao 2: so o validate (de novo, nada muda).
  assert.equal(second.replace(/\s+/g, " "), "alter table public.webinar_chat_messages validate constraint webinar_chat_messages_role_v5;");
});

test("a lista do check novo e a do app (model.CHAT_ROLES, com co_host); o aviso de migracao pendente aponta a 202611010001", () => {
  const code = sqlCodeOf(read(MIGRATION));
  assert.ok(model.CHAT_ROLES.includes("co_host"));
  assert.match(code, new RegExp(`add constraint webinar_chat_messages_role_v5\\s*check \\(role in \\(${sqlList(model.CHAT_ROLES)}\\)\\) not valid;`));
  assert.equal((code.match(/check \(role in \(/g) ?? []).length, 1, "um check so");
  assert.match(dbSource, /export const WEBINARS_MIGRATION = "202611010001";/);
  // Sem constante propria: o insert do co_host sem a migracao da o erro comum da acao, nunca o aviso (docs/21 §9.11).
  assert.doesNotMatch(dbSource, /WEBINARS_COHOST_MIGRATION/);
  // O nome que o Postgres deu ao check de coluna da 0029 (conferido na nuvem de teste antes de escrever a migracao).
  assert.match(sqlCodeOf(read("supabase/migrations/202610290001_webinars_v2_chat.sql")), /create table if not exists public\.webinar_chat_messages \([\s\S]*?\n  role text not null check \(role in \(/);
});
