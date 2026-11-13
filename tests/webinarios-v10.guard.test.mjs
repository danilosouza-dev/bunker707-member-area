import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { assertOnlyAdds, assertSections, cumulativeHash, fileHash, migrationFiles, read, sqlCodeOf, statementsOf } from "./support/webinarios-migracao-guarda.mjs";

// Guarda da migracao da rodada v10 dos webinarios (docs/30 D94, §4.2; docs/31 §15; docs/21 §9.17; docs/18 §1.2): a
// 202611160001_webinars_v10.sql (a equipe marca como visto o fio de uma pergunta).
// - as 74 migracoes ate a 202611150001 continuam byte a byte (hash acumulado); a 202611160001 vem depois dela e e o
//   texto exato (hash);
// - uma secao MCP, idempotente, so acrescenta (nenhum drop, nenhuma tabela, nenhum dado antigo reescrito): duas colunas
//   em webinar_questions, as duas nulas por padrao;
// - a lista que o app sempre le (QUESTION_COLUMNS) e a da v9 (QUESTION_COLUMNS_V9) nao ganham coluna: o app de antes e
//   o app novo num banco sem a migracao continuam de pe; a coluna nova e lida a parte (QUESTION_COLUMNS_V10), e
//   `thread_seen_by` so e gravada, nunca lida para a tela;
// - o aviso de migracao pendente aponta esta (WEBINARS_V10_MIGRATION), e WEBINARS_MIGRATION e esta ou uma mais nova (a
//   mais nova tem a guarda dela: tests/webinarios-v11.guard.test.mjs).

const MIGRATION = "supabase/migrations/202611160001_webinars_v10.sql";
// db.ts, chat-rows.ts, chat-store.ts e room-actions.ts: lidos do texto (alguns tem "server-only").
const dbSource = read("src/server/webinars/db.ts");
const chatRows = read("src/server/webinars/chat-rows.ts");
const chatStore = read("src/server/webinars/chat-store.ts");
const roomActions = read("src/server/webinars/room-actions.ts");
const migration = read(MIGRATION);
const code = sqlCodeOf(migration);

const constantOf = (source, name) => {
  const start = source.indexOf(`export const ${name} =`);
  assert.notEqual(start, -1, name);
  const end = source.indexOf(";", start);
  return source.slice(start, end);
};

test("as 74 migracoes ate a 202611150001 continuam byte a byte; a 202611160001 vem depois e e o texto exato", () => {
  const applied = cumulativeHash("202611150001_webinars_v9.sql");
  assert.equal(applied.count, 74);
  assert.equal(applied.hash, "0af9b12fdad94a9e01d91335d422ba32d7f1688bc8e2aac0550bb41f43177f97", "uma migracao ja aplicada mudou: a correcao vai numa migracao nova");
  const files = migrationFiles();
  assert.ok(files.indexOf("202611160001_webinars_v10.sql") > files.indexOf("202611150001_webinars_v9.sql"), "depois da rodada v9");
  assert.equal(
    fileHash(MIGRATION),
    "51397127111837609c46081175d0c845d02224d491a549803e1733c1216626a5",
    "a 202611160001 mudou: depois de aplicada na nuvem de teste (docs/21 §9.17), a correcao vai numa migracao nova; antes, aplique de novo e atualize este hash junto"
  );
});

test("a 202611160001: uma secao MCP, idempotente, so acrescenta duas colunas nulas em webinar_questions", () => {
  assertSections(migration, 1);
  assertOnlyAdds(migration);
  assert.equal((code.match(/\bcreate table\b/g) ?? []).length, 0, "nenhuma tabela nova");
  assert.equal((code.match(/\bcreate (unique )?index\b/g) ?? []).length, 0, "nenhum indice novo");
  assert.equal((code.match(/\badd column\b/g) ?? []).length, 2, "duas colunas novas");
  assert.equal((code.match(/\badd constraint\b/g) ?? []).length, 0, "nenhum check que leia as linhas");
  assert.match(code, /alter table public\.webinar_questions add column if not exists thread_seen_at timestamptz;/, "nula por padrao: nunca marcada, como sempre");
  assert.match(code, /alter table public\.webinar_questions add column if not exists thread_seen_by uuid references auth\.users\(id\) on delete set null;/, "a marca fica quando a pessoa sai");
  assert.doesNotMatch(code, /\bnot null\b/, "nenhuma coluna obrigatoria: o app de antes continua gravando perguntas");
  assert.doesNotMatch(statementsOf(migration), /\bupdate\s+public\./i, "nenhum dado antigo e reescrito");
  assert.deepEqual(
    [...new Set([...statementsOf(migration).matchAll(/alter table public\.(\w+)/g)].map((match) => match[1]))],
    ["webinar_questions"],
    "so a tabela das perguntas muda"
  );
  // A conferencia de uma linha que o produtor roda depois de aplicar (docs/21 §9.17) esta no cabecalho, com o resultado.
  assert.match(migration, /column_name in \('thread_seen_at', 'thread_seen_by'\); -- 2$/m);
});

test("as listas que o app sempre le nao ganham coluna nova; a coluna nova e lida a parte e cai para a lista anterior", () => {
  assert.doesNotMatch(constantOf(chatRows, "QUESTION_COLUMNS"), /thread_seen/, "o app num banco sem a migracao continua lendo as perguntas");
  assert.doesNotMatch(constantOf(chatRows, "QUESTION_COLUMNS_V9"), /thread_seen/, "a lista da v9 continua a da v9");
  assert.match(chatRows, /export const QUESTION_COLUMNS_V10 = `\$\{QUESTION_COLUMNS_V9\}, thread_seen_at`;/);
  assert.doesNotMatch(constantOf(chatRows, "QUESTION_COLUMNS_V10"), /thread_seen_by/, "quem marcou so e gravado");
  // A leitura tenta a mais nova, depois a da v9, depois a de sempre.
  assert.match(chatStore, /\[QUESTION_COLUMNS_V10, QUESTION_COLUMNS_V9\]/);
});

test("o aviso de migracao pendente aponta esta, e WEBINARS_MIGRATION e esta ou uma mais nova", () => {
  assert.match(dbSource, /export const WEBINARS_V10_MIGRATION = "202611160001";/);
  assert.ok((dbSource.match(/export const WEBINARS_MIGRATION = "(\d+)";/)?.[1] ?? "") >= "202611160001", "o aviso geral aponta esta ou uma mais nova");
  assert.match(roomActions, /migracaoPendente\(WEBINARS_V10_MIGRATION\)/, "marcar como vista sem a migracao: 409 com o aviso desta");
});
