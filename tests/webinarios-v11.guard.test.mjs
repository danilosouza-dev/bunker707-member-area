import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { assertOnlyAdds, assertSections, assertServiceRoleOnly, cumulativeHash, fileHash, migrationFiles, read, sqlCodeOf, statementsOf } from "./support/webinarios-migracao-guarda.mjs";

// Guarda da migracao da rodada v11 dos webinarios (docs/30 D101, §4.2; docs/31 §16; docs/21 §9.18; docs/18 §1.2): a
// 202611170001_webinars_v11.sql (as curtidas da resposta e do fio de uma pergunta).
// - as 75 migracoes ate a 202611160001 continuam byte a byte (hash acumulado); a 202611170001 vem depois dela e e o
//   texto exato (hash);
// - uma secao MCP, idempotente, so acrescenta (nenhum drop): uma tabela nova, so do service_role, com tres indices;
//   nenhuma coluna nova nas tabelas que ja existem (as listas que o app sempre le nao mudam);
// - a tabela some com a sessao, a pergunta, a resposta do fio e a conta; uma curtida por pessoa em cada alvo;
// - as colunas que o app le existem na tabela, e o aviso de migracao pendente aponta esta (QUESTION_LIKES_MIGRATION);
//   WEBINARS_MIGRATION e esta ou uma mais nova (desde 13/11/2026, a 202611180001 das pessoas da escola).

const MIGRATION = "supabase/migrations/202611170001_webinars_v11.sql";
const likes = await import("../src/server/webinars/question-likes-model.ts");
const dbSource = read("src/server/webinars/db.ts");
const chatStore = read("src/server/webinars/chat-store.ts");
const migration = read(MIGRATION);
const code = sqlCodeOf(migration);

test("as 75 migracoes ate a 202611160001 continuam byte a byte; a 202611170001 vem depois e e o texto exato", () => {
  const applied = cumulativeHash("202611160001_webinars_v10.sql");
  assert.equal(applied.count, 75);
  assert.equal(applied.hash, "47646f8c80c72e3200efc96be9b8b85a047bcfa1aac2aa15ab6b59e29775b7e8", "uma migracao ja aplicada mudou: a correcao vai numa migracao nova");
  const files = migrationFiles();
  assert.ok(files.indexOf("202611170001_webinars_v11.sql") > files.indexOf("202611160001_webinars_v10.sql"), "depois da rodada v10");
  assert.equal(
    fileHash(MIGRATION),
    "4cbc0c6998da78cf23c99dc8f83ae086426db95eaed04b7392fb0e0104ec3a96",
    "a 202611170001 mudou: depois de aplicada na nuvem de teste (docs/21 §9.18), a correcao vai numa migracao nova; antes, aplique de novo e atualize este hash junto"
  );
});

test("a 202611170001: uma secao MCP, idempotente, so acrescenta uma tabela so do service_role; nada muda nas tabelas que ja existem", () => {
  assertSections(migration, 1);
  assertOnlyAdds(migration);
  assertServiceRoleOnly(code, "webinar_question_likes");
  assert.equal((code.match(/\bcreate table\b/g) ?? []).length, 1, "uma tabela nova");
  assert.equal((code.match(/\balter table\b/g) ?? []).length, 1, "so o enable row level security da tabela nova");
  assert.equal((code.match(/\badd column\b/g) ?? []).length, 0, "nenhuma coluna nova nas tabelas que ja existem");
  assert.doesNotMatch(statementsOf(migration), /\bupdate\s+public\./i, "nenhum dado antigo e reescrito");
  // A curtida some com a sessao, a pergunta, a resposta do fio e a conta (a retencao e o Remover minhas mensagens).
  assert.match(code, /session_id uuid not null references public\.webinar_sessions\(id\) on delete cascade,/);
  assert.match(code, /question_id uuid not null references public\.webinar_questions\(id\) on delete cascade,/);
  assert.match(code, /reply_id uuid references public\.webinar_question_replies\(id\) on delete cascade,/, "nula: a curtida e da resposta escrita");
  assert.match(code, /user_id uuid not null references auth\.users\(id\) on delete cascade,/);
  // Uma curtida por pessoa em cada alvo; a leitura da sessao numa consulta so.
  assert.match(code, /create unique index if not exists webinar_question_likes_answer_idx on public\.webinar_question_likes \(question_id, user_id\) where reply_id is null;/);
  assert.match(code, /create unique index if not exists webinar_question_likes_reply_idx on public\.webinar_question_likes \(reply_id, user_id\) where reply_id is not null;/);
  assert.match(code, /create index if not exists webinar_question_likes_session_idx on public\.webinar_question_likes \(session_id\);/);
  // Nenhum texto, nome nem foto: so quem curtiu o que.
  const table = code.slice(code.indexOf("create table if not exists public.webinar_question_likes ("), code.indexOf("comment on table public.webinar_question_likes"));
  assert.doesNotMatch(table, /\b(body|display_name|avatar\w*)\b/);
  // A conferencia de uma linha que o produtor roda depois de aplicar (docs/21 §9.18) esta no cabecalho, com o resultado.
  assert.match(migration, /'webinar_question_likes_session_idx'\)\) as total; -- 4$/m);
});

test("as colunas que o app le existem na tabela; a leitura e tolerante e a escrita avisa a migracao", () => {
  const columns = likes.QUESTION_LIKE_COLUMNS.split(",").map((column) => column.trim());
  assert.deepEqual(columns, ["question_id", "reply_id", "user_id"]);
  for (const column of [...columns, "session_id", "created_at", "id"]) {
    assert.match(code, new RegExp(`\\n  ${column} `), column);
  }
  // Sem a tabela, a leitura devolve vazio (as perguntas seguem como antes).
  const leitura = chatStore.slice(chatStore.indexOf("export async function listQuestionLikeRows("), chatStore.indexOf("export async function toggleQuestionLike("));
  assert.match(leitura, /if \(isPendingMigrationError\(failure\)\) \{\s*return \[\];/);
});

test("o aviso de migracao pendente aponta esta, e WEBINARS_MIGRATION e esta ou uma mais nova", () => {
  assert.equal(likes.QUESTION_LIKES_MIGRATION, "202611170001");
  // Desde 13/11/2026 a mais nova e a 202611180001 (as pessoas que comentam da escola, D116); a guarda dela confere o
  // arquivo e o aviso geral.
  assert.ok((dbSource.match(/export const WEBINARS_MIGRATION = "(\d+)";/)?.[1] ?? "") >= "202611170001", "o aviso geral aponta esta ou uma mais nova");
  for (const file of ["src/server/webinars/room-actions.ts", "src/server/webinars/room-writes.ts"]) {
    assert.match(read(file), /migracaoPendente\(QUESTION_LIKES_MIGRATION\)/, `${file}: curtir sem a migracao responde 409 com o aviso desta`);
  }
});
