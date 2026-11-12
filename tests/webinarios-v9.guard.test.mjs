import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { assertOnlyAdds, assertSections, assertServiceRoleOnly, cumulativeHash, fileHash, migrationFiles, read, sqlCodeOf, sqlList, statementsOf } from "./support/webinarios-migracao-guarda.mjs";

// Guarda da migracao da rodada v9 dos webinarios (docs/30 D87 a D89, §4.2; docs/31 §14; docs/21 §9.16; docs/18 §1.2):
// a 202611150001_webinars_v9.sql (o que abre o link do banner, quem assina a resposta de uma pergunta e o comentario
// ou a pergunta que a equipe traz para a tela).
// - as 73 migracoes ate a 202611140002 continuam byte a byte (hash acumulado); a 202611150001 vem depois dela e e o
//   texto exato (hash);
// - quatro secoes MCP, idempotente, so acrescenta (nenhum drop); a tabela nova so do service_role; os checks das
//   tabelas que ja existem entram `not valid` e sao validados na ultima secao;
// - as listas do SQL sao as do app (SCREEN_LINK_TARGETS, ANSWER_AUTHOR_MODES, SCREEN_COMMENT_SOURCES,
//   SCREEN_COMMENT_HIDDEN_REASONS) e as colunas que screen-comment-store.ts le existem na tabela;
// - as listas que o app sempre le (SCREEN_ITEM_COLUMNS, QUESTION_COLUMNS, QUESTION_REPLY_COLUMNS) nao ganham coluna: o
//   app de antes e o app novo num banco sem a migracao continuam de pe; as colunas novas sao lidas a parte (`_V9`);
// - o aviso de migracao pendente aponta esta (WEBINARS_V9_MIGRATION e as copias dos modelos), e WEBINARS_MIGRATION e
//   esta, a mais nova dos webinarios.

const MIGRATION = "supabase/migrations/202611150001_webinars_v9.sql";
const screen = await import("../src/server/webinars/screen-model.ts");
const author = await import("../src/server/webinars/answer-author-model.ts");
const comment = await import("../src/server/webinars/screen-comment-model.ts");
// db.ts, screen-rows.ts, chat-rows.ts e screen-comment-store.ts: lidos do texto (alguns tem "server-only").
const dbSource = read("src/server/webinars/db.ts");
const screenRows = read("src/server/webinars/screen-rows.ts");
const chatRows = read("src/server/webinars/chat-rows.ts");
const commentStore = read("src/server/webinars/screen-comment-store.ts");
const migration = read(MIGRATION);
const code = sqlCodeOf(migration);

const constantOf = (source, name) => {
  const start = source.indexOf(`export const ${name} =`);
  assert.notEqual(start, -1, name);
  const end = source.indexOf(";", start);
  return source.slice(start, end);
};

test("as 73 migracoes ate a 202611140002 continuam byte a byte; a 202611150001 vem depois e e o texto exato", () => {
  const applied = cumulativeHash("202611140002_webinars_v8_plateia.sql");
  assert.equal(applied.count, 73);
  assert.equal(applied.hash, "009d5e4dd752cd5f5f0aafd0e5c223f24df9d8153dd6c3144b56658ee70c5a70", "uma migracao ja aplicada mudou: a correcao vai numa migracao nova");
  const files = migrationFiles();
  assert.ok(files.indexOf("202611150001_webinars_v9.sql") > files.indexOf("202611140002_webinars_v8_plateia.sql"), "depois dos participantes simulados");
  assert.equal(
    fileHash(MIGRATION),
    "ff8d5d6852d92b1d07d94abe3178aa4278bb80ef212d3f8097d83a5279b234c8",
    "a 202611150001 mudou: depois de aplicada na nuvem de teste (docs/21 §9.16), a correcao vai numa migracao nova; antes, aplique de novo e atualize este hash junto"
  );
});

test("a 202611150001: quatro secoes MCP, idempotente, so acrescenta; a tabela nova so do service_role", () => {
  assertSections(migration, 4);
  assertOnlyAdds(migration);
  assertServiceRoleOnly(code, "webinar_screen_comments");
  assert.equal((code.match(/\bcreate table\b/g) ?? []).length, 1, "uma tabela nova");
  assert.equal((code.match(/\badd column\b/g) ?? []).length, 3, "tres colunas novas");
  assert.doesNotMatch(statementsOf(migration), /\bupdate\s+public\./i, "nenhum dado antigo e reescrito");
  assert.doesNotMatch(statementsOf(migration), /alter table public\.webinar_sessions\b/, "nada muda na sessao");
  assert.match(code, /session_id uuid not null references public\.webinar_sessions\(id\) on delete cascade,/, "some com a sessao");
  assert.match(code, /message_id uuid references public\.webinar_chat_messages\(id\) on delete cascade,/, "some com a mensagem (a retencao)");
  assert.match(code, /question_id uuid references public\.webinar_questions\(id\) on delete cascade,/, "some com a pergunta (a retencao)");
  assert.match(code, /shown_by uuid references auth\.users\(id\) on delete set null,/, "a linha fica quando a pessoa sai");
  assert.match(code, /hidden_by uuid references auth\.users\(id\) on delete set null,/);
  assert.match(code, /create unique index if not exists webinar_screen_comments_active_idx on public\.webinar_screen_comments \(session_id\) where hidden_at is null;/, "um comentario na tela por sessao");
  assert.match(code, /create index if not exists webinar_screen_comments_session_idx on public\.webinar_screen_comments \(session_id, shown_at\);/);
  // Nenhuma copia do texto nem do nome: so a referencia.
  const table = code.slice(code.indexOf("create table if not exists public.webinar_screen_comments ("), code.indexOf("comment on table public.webinar_screen_comments"));
  assert.doesNotMatch(table, /\b(body|display_name|avatar\w*)\b/, "a tabela nao guarda texto, nome nem foto");
});

test("os checks das tabelas que ja existem entram not valid e sao validados na secao 4", () => {
  for (const [table, name] of [
    ["webinar_screen_items", "webinar_screen_items_link_target_v9"],
    ["webinar_questions", "webinar_questions_answer_author_v9"],
    ["webinar_question_replies", "webinar_question_replies_author_as_v9"]
  ]) {
    const added = code.indexOf(`add constraint ${name}`);
    const validated = code.indexOf(`alter table public.${table} validate constraint ${name};`);
    assert.notEqual(added, -1, name);
    assert.match(code.slice(added, added + 400), /\) not valid;/, `${name} entra sem ler as linhas`);
    assert.ok(validated > added, `${name} validado depois`);
  }
  assert.equal((code.match(/\bvalidate constraint\b/g) ?? []).length, 3);
});

test("as listas do SQL sao as do app", () => {
  assert.match(code, new RegExp(`add column if not exists link_target text not null default '${screen.SCREEN_DEFAULT_LINK_TARGET}';`), "o padrao e a imagem e o botao");
  assert.match(code, new RegExp(`check \\(link_target in \\(${sqlList(screen.SCREEN_LINK_TARGETS)}\\)\\) not valid;`));
  assert.match(code, new RegExp(`check \\(author_as is null or author_as in \\(${sqlList(author.ANSWER_AUTHOR_MODES)}\\)\\) not valid;`));
  assert.match(code, /check \(answer_author is null or \(jsonb_typeof\(answer_author\) = 'object' and pg_column_size\(answer_author\) <= 512\)\) not valid;/);
  assert.match(code, new RegExp(`source text not null check \\(source in \\(${sqlList(comment.SCREEN_COMMENT_SOURCES)}\\)\\),`));
  assert.match(code, new RegExp(`hidden_reason text check \\(hidden_reason is null or hidden_reason in \\(${sqlList(comment.SCREEN_COMMENT_HIDDEN_REASONS)}\\)\\),`));
  // O que o app grava em answer_author cabe no check (o nome mais longo e o papel).
  const longest = author.answerAuthorToRow({ as: "custom", name: "x".repeat(author.ANSWER_AUTHOR_LIMITS.nameMax), role: "moderator" });
  assert.ok(JSON.stringify(longest).length <= 512, "a assinatura mais longa cabe");
  // As colunas que o app le existem na tabela, e nenhuma outra.
  const columns = (commentStore.match(/export const SCREEN_COMMENT_COLUMNS = "([^"]+)";/)?.[1] ?? "").split(",").map((column) => column.trim());
  assert.equal(columns.length, 13);
  for (const column of columns) {
    assert.match(code, new RegExp(`\\n  ${column} `), column);
  }
  const declared = [...code.slice(code.indexOf("create table if not exists public.webinar_screen_comments ("), code.indexOf("constraint webinar_screen_comments_target_v9")).matchAll(/\n  (\w+) /g)].map((match) => match[1]);
  assert.deepEqual(declared.sort(), [...columns].sort(), "a tabela nao tem coluna que o app nao le");
});

test("as listas que o app sempre le nao ganham coluna nova; as colunas novas sao lidas a parte", () => {
  assert.doesNotMatch(constantOf(screenRows, "SCREEN_ITEM_COLUMNS"), /link_target/, "o app num banco sem a migracao continua lendo os itens");
  assert.doesNotMatch(constantOf(chatRows, "QUESTION_COLUMNS"), /answer_author/);
  assert.doesNotMatch(constantOf(chatRows, "QUESTION_REPLY_COLUMNS"), /author_as/);
  assert.match(screenRows, /export const SCREEN_ITEM_COLUMNS_V9 = `\$\{SCREEN_ITEM_COLUMNS\}, link_target`;/);
  assert.match(chatRows, /export const QUESTION_COLUMNS_V9 = `\$\{QUESTION_COLUMNS\}, answer_author`;/);
  assert.match(chatRows, /export const QUESTION_REPLY_COLUMNS_V9 = `\$\{QUESTION_REPLY_COLUMNS\}, author_as`;/);
});

test("o aviso de migracao pendente aponta esta, e WEBINARS_MIGRATION e esta (a mais nova dos webinarios)", () => {
  assert.match(dbSource, /export const WEBINARS_V9_MIGRATION = "202611150001";/);
  assert.match(dbSource, /export const WEBINARS_MIGRATION = "202611150001";/);
  assert.equal(screen.SCREEN_V9_MIGRATION, "202611150001");
  assert.equal(author.ANSWER_AUTHOR_MIGRATION, "202611150001");
  assert.equal(comment.SCREEN_COMMENT_MIGRATION, "202611150001");
  const webinarFiles = migrationFiles().filter((name) => /webinar/.test(name));
  assert.equal(webinarFiles.at(-1), "202611150001_webinars_v9.sql", "nenhuma migracao de webinario mais nova sem o aviso atualizado");
});
