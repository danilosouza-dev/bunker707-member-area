import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { assertOnlyAdds, assertSections, assertServiceRoleOnly, cumulativeHash, fileHash, migrationFiles, read, sqlCodeOf, sqlList } from "./support/webinarios-migracao-guarda.mjs";

// Guarda da migracao do fio das Perguntas (docs/30 §1.3 e §2.4; docs/21 §9.12; docs/18 §1.2; decisao do produtor de
// 10/11/2026): a 202611100001_webinars_v6_respostas.sql, que cria webinar_question_replies.
// - as 64 migracoes ate a 202611010001 (todas aplicadas na nuvem de teste) continuam byte a byte (hash acumulado);
// - uma secao MCP, idempotente; so acrescenta (nada de drop, delete, truncate nem politica); a tabela e so do
//   service_role (o aluno nunca le nem grava direto);
// - os limites e a lista de papeis do SQL sao os do app (model.QUESTION_REPLY_LIMITS e QUESTION_REPLY_ROLES);
// - o aviso de migracao pendente aponta esta (WEBINARS_MIGRATION), a mais nova dos webinarios.

const MIGRATION = "supabase/migrations/202611100001_webinars_v6_respostas.sql";
const model = await import("../src/server/webinars/model.ts");
// db.ts tem "server-only": a constante e lida do texto.
const dbSource = read("src/server/webinars/db.ts");

test("as 64 migracoes ate a 202611010001 continuam byte a byte (todas aplicadas); a 202611100001 vem logo depois e e o texto exato", () => {
  const applied = cumulativeHash("202611010001_webinars_v5_coapresentador.sql");
  assert.equal(applied.count, 64);
  assert.equal(applied.hash, "5ce8b330f39f1180c45c06e7a744f2bbbf4e788637f6a74d33318fcc5e0ca8c8", "uma migracao ja aplicada mudou: a correcao vai numa migracao nova");
  const files = migrationFiles();
  assert.equal(files[files.indexOf("202611010001_webinars_v5_coapresentador.sql") + 1], "202611100001_webinars_v6_respostas.sql", "logo depois da do Co-apresentador");
  assert.equal(
    fileHash(MIGRATION),
    "a2f4acd80135eef7820f82b47d98f75b16848d5264d5d044b65242567b5067f5",
    "a 202611100001 mudou: depois de aplicada na nuvem de teste (docs/21 §9.12), a correcao vai numa migracao nova; antes, aplique de novo e atualize este hash junto"
  );
});

test("a 202611100001: uma secao MCP, idempotente, so acrescenta; a tabela do fio e so do service_role, com os tres indices atras do if not exists", () => {
  const migration = read(MIGRATION);
  assertSections(migration, 1);
  assertOnlyAdds(migration);
  const code = sqlCodeOf(migration);
  assertServiceRoleOnly(code, "webinar_question_replies");
  assert.equal((code.match(/\bcreate table\b/g) ?? []).length, 1, "uma tabela so");
  assert.doesNotMatch(code, /\balter table public\.webinar_questions\b|\balter table public\.webinar_chat_messages\b/, "as perguntas e o chat de antes nao mudam");
  assert.deepEqual(
    Array.from(code.matchAll(/create index if not exists (\w+) on public\.webinar_question_replies \(([^)]+)\)/g), (match) => `${match[1]}: ${match[2]}`),
    ["webinar_question_replies_session_idx: session_id, created_at", "webinar_question_replies_question_idx: question_id", "webinar_question_replies_user_idx: user_id"]
  );
  // Some com a pergunta, com a sessao e com a conta de quem escreveu; quem apagou vira nulo.
  assert.match(code, /question_id uuid not null references public\.webinar_questions\(id\) on delete cascade,/);
  assert.match(code, /session_id uuid not null references public\.webinar_sessions\(id\) on delete cascade,/);
  assert.match(code, /user_id uuid not null references auth\.users\(id\) on delete cascade,/);
  assert.match(code, /deleted_by uuid references auth\.users\(id\) on delete set null,/);
});

test("os limites e os papeis do SQL sao os do app; o aviso de migracao pendente aponta a 202611100001", () => {
  const code = sqlCodeOf(read(MIGRATION));
  assert.deepEqual([...model.QUESTION_REPLY_ROLES], ["host", "co_host", "team", "student"]);
  assert.match(code, new RegExp(`role text not null check \\(role in \\(${sqlList(model.QUESTION_REPLY_ROLES)}\\)\\),`));
  assert.match(code, new RegExp(`body text not null check \\(char_length\\(body\\) between 1 and ${model.QUESTION_REPLY_LIMITS.teamBody}\\),`));
  assert.ok(model.QUESTION_REPLY_LIMITS.studentBody <= model.QUESTION_REPLY_LIMITS.teamBody, "o texto do aluno cabe no check");
  assert.equal(model.QUESTION_REPLY_LIMITS.studentBody, model.CHAT_LIMITS.question, "o aluno escreve no fio o que escreve na pergunta");
  assert.equal(model.QUESTION_REPLY_LIMITS.teamBody, model.CHAT_LIMITS.answer, "a equipe escreve no fio o que escreve na resposta");
  assert.match(code, new RegExp(`display_name text not null check \\(char_length\\(display_name\\) between 1 and ${model.CHAT_LIMITS.displayName}\\),`));
  assert.match(code, /deleted_reason text check \(deleted_reason is null or deleted_reason in \('student', 'team', 'consent_revoked'\)\),/);
  assert.match(dbSource, /export const WEBINARS_MIGRATION = "202611100001";/);
  // Sem constante propria: o fio le vazio sem a migracao, e escrever nele cai no aviso geral.
  assert.doesNotMatch(dbSource, /WEBINARS_REPLIES_MIGRATION/);
});
