import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import {
  assertFunctionServiceRole,
  assertKeepsBody,
  assertOnlyAdds,
  assertSections,
  assertServiceRoleOnly,
  cumulativeHash,
  fileHash,
  functionBody,
  migrationFiles,
  read,
  sqlCodeOf,
  sqlList
} from "./support/webinarios-migracao-guarda.mjs";

// Guarda da fase 4c dos webinarios (docs/30 §1.6, §2.4, §3.4, §6.6, D24 e §11): a migracao
// 202610290006_webinars_v4c_assistente.sql.
// - as migracoes ate a 202610290005 continuam byte a byte, e a 0006 e o texto exato (hash);
// - sete secoes MCP, idempotente, so acrescenta; as tres tabelas novas so do service_role;
// - os checks batem com as listas do app (ASSISTANT_TARGETS, ASSISTANT_REQUEST_STATUSES, ASSISTANT_SKIP_REASONS,
//   ATTENDANT_STATUSES, ANSWER_SOURCES, ASSISTANT_LIMITS); um pedido ao Assistente por alvo e sem texto;
// - webinar_report mantem o corpo da 0005 inteiro e ganha o bloco "Respostas do Assistente" so de source = 'ai'.

const MIGRATION = "supabase/migrations/202610290006_webinars_v4c_assistente.sql";
const model = await import("../src/server/webinars/model.ts");

test("as migracoes ate a 202610290005 continuam byte a byte; a 0006 e o texto exato (aplicar antes do merge)", () => {
  const applied = cumulativeHash("202610290005_webinars_v4b_ofertas.sql");
  assert.equal(applied.count, 58);
  assert.equal(applied.hash, "b615773a1b4deab5527aa22ece207ac9bedb48fd751d8146b9d3f639fff01554", "uma migracao anterior mudou");
  assert.ok(migrationFiles().includes("202610290006_webinars_v4c_assistente.sql"));
  assert.equal(fileHash(MIGRATION), "ca069985348cfbfc76fcbbaf2da3aa30ec9b373a9800218a0f0aecd63dfd6aee", "a 202610290006 mudou: confira de novo antes de aplicar na nuvem de teste (docs/21 §9.10; nenhuma foi aplicada ainda) e atualize este hash junto");
});

test("a 0006: sete secoes MCP, idempotente, so acrescenta; tres tabelas novas so do service_role", () => {
  const migration = read(MIGRATION);
  assertSections(migration, 7);
  assertOnlyAdds(migration);
  const code = sqlCodeOf(migration);
  assert.equal((code.match(/\bcreate table\b/gi) ?? []).length, 3);
  for (const table of ["webinar_assistant_knowledge", "webinar_attendants", "webinar_ai_requests"]) {
    assertServiceRoleOnly(code, table);
  }
  assert.doesNotMatch(code, /grant[^;]*to (?:anon|authenticated|public)\b/i);
  assertFunctionServiceRole(code, "webinar_report(uuid)");
});

test("os checks batem com as listas do app; um pedido por alvo, sem texto", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const limits = model.ASSISTANT_LIMITS;
  assert.match(code, new RegExp(`target_kind text not null check \\(target_kind in \\(${sqlList(model.ASSISTANT_TARGETS)}\\)\\)`));
  assert.match(code, new RegExp(`status text not null default 'pending' check \\(status in \\(${sqlList(model.ASSISTANT_REQUEST_STATUSES)}\\)\\)`));
  assert.match(code, new RegExp(`skip_reason in \\(${sqlList(model.ASSISTANT_SKIP_REASONS)}\\)`));
  assert.match(code, new RegExp(`status text not null default 'online' check \\(status in \\(${sqlList(model.ATTENDANT_STATUSES)}\\)\\)`));
  assert.match(code, new RegExp(`answer_source in \\(${sqlList(model.ANSWER_SOURCES)}\\)`));
  assert.match(code, new RegExp(`char_length\\(question\\) between ${limits.questionMin} and ${limits.question}`));
  assert.match(code, new RegExp(`char_length\\(answer\\) between 1 and ${limits.answer}`));
  assert.match(code, /create unique index if not exists webinar_ai_requests_target_idx on public\.webinar_ai_requests \(target_kind, target_id\);/, "o Assistente nunca responde duas vezes");
  const requests = code.slice(code.indexOf("create table if not exists public.webinar_ai_requests"), code.indexOf("comment on table public.webinar_ai_requests"));
  assert.doesNotMatch(requests, /\b(body|text|prompt|question|answer)\b\s+text/, "o pedido nao guarda texto (docs/05)");
  assert.match(code, /primary key \(session_id, user_id\)/, "um atendente por sessao");
  assert.match(code, /alter table public\.webinar_sessions add column if not exists assistant_reply_all boolean not null default false;/);
  assert.match(code, /check \(jsonb_typeof\(assistant_settings\) = 'object' and pg_column_size\(assistant_settings\) <= 4096\)/);
});

test("webinar_report: o corpo da 0005 inteiro e as Respostas do Assistente so de source = 'ai', fora da Simulacao", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const report = functionBody(code, "webinar_report").body;
  assertKeepsBody(functionBody(sqlCodeOf(read("supabase/migrations/202610290005_webinars_v4b_ofertas.sql")), "webinar_report").body, report, "webinar_report");
  assert.match(report, /where m\.session_id = s\.id and m\.source = 'ai'/);
  for (const item of ["replies", "avg_seconds", "edited", "deleted", "handoffs"]) {
    assert.match(report, new RegExp(`select 'ai', '${item}'`), item);
  }
  const aiLines = report.split("\n").filter((line) => line.includes("'ai', '"));
  assert.ok(aiLines.every((line) => !/sim_|scripted/.test(line)), "o Assistente nao e Simulacao (D24, M6)");
});
