import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import {
  assertFunctionServiceRole,
  assertKeepsBody,
  assertOnlyAdds,
  assertSections,
  cumulativeHash,
  fileHash,
  functionBody,
  migrationFiles,
  read,
  root,
  sqlCodeOf
} from "./support/webinarios-migracao-guarda.mjs";

// Guarda da fase 4e dos webinarios (docs/30 §1.2, §1.6, §2.2, A14, D25 e §11): a migracao
// 202610290008_webinars_v4e_just_in_time.sql (e a 0007 que nao existe: a Sala Live vertical nao tem dado novo).
// - as migracoes ate a 202610290006 continuam byte a byte, e a 0008 e o texto exato (hash);
// - quatro secoes MCP, idempotente, so acrescenta;
// - webinar_sessions.jit so na sessao `simulated`, uma por horario (indice unico parcial); SESSION_COLUMNS le `jit`
//   e o app exige a 0008 (WEBINARS_MIGRATION);
// - webinar_chat_window mantem o corpo inteiro da 202610290001 e so acrescenta a turma do dia das sessoes jit:
//   `audience` aprovadas, nunca a linha mestre nem os pendentes, pelo dia de Sao Paulo.

const MIGRATION = "supabase/migrations/202610290008_webinars_v4e_just_in_time.sql";
const rows = await import("../src/server/webinars/rows.ts");

test("as migracoes ate a 202610290006 continuam byte a byte; a 0007 nao existe; a 0008 e o texto exato", () => {
  const applied = cumulativeHash("202610290006_webinars_v4c_assistente.sql");
  assert.equal(applied.count, 59);
  assert.equal(applied.hash, "472aaa9ce161d9c36311fba15190bfe7f3fdc91b445bad0faa5c72262aaae4f8", "uma migracao anterior mudou");
  assert.ok(!migrationFiles().some((name) => name.startsWith("202610290007")), "a 4d (Sala Live vertical) nao tem migracao");
  assert.ok(migrationFiles().includes("202610290008_webinars_v4e_just_in_time.sql"));
  assert.equal(fileHash(MIGRATION), "33b6f6392a6a25998404beb5013b6510cfaae974dfacd534d921566a63df4cbf", "a 202610290008 mudou: confira de novo antes de aplicar na nuvem de teste (docs/21 §9.10; nenhuma foi aplicada ainda) e atualize este hash junto");
  const appMigration = read("src/server/webinars/db.ts").match(/WEBINARS_MIGRATION = "(\d+)"/)?.[1];
  assert.equal(appMigration, "202610290008", "toda leitura de sessao le jit: o aviso de migracao pendente aponta a 0008");
  assert.ok(rows.SESSION_COLUMNS.split(", ").includes("jit"));
  assert.ok(existsSync(new URL(MIGRATION, root)));
});

test("a 0008: quatro secoes MCP, idempotente, so acrescenta; jit so na sessao gravada, uma por horario", () => {
  const migration = read(MIGRATION);
  assertSections(migration, 4);
  assertOnlyAdds(migration);
  const code = sqlCodeOf(migration);
  assert.doesNotMatch(code, /\bcreate table\b/i);
  assert.match(code, /alter table public\.webinars add column if not exists jit_settings jsonb not null default '\{\}'::jsonb;/);
  assert.match(code, /check \(jsonb_typeof\(jit_settings\) = 'object' and pg_column_size\(jit_settings\) <= 65536\)/);
  assert.match(code, /alter table public\.webinar_sessions add column if not exists jit boolean not null default false;/);
  assert.match(code, /check \(not jit or kind = 'simulated'\)/);
  assert.match(code, /create unique index if not exists webinar_sessions_jit_slot_idx on public\.webinar_sessions \(webinar_id, scheduled_at\) where jit;/);
  assertFunctionServiceRole(code, "webinar_chat_window(uuid, integer, integer, uuid)");
});

test("webinar_chat_window: o corpo da 0001 inteiro e a turma do dia so nas sessoes jit", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const window = functionBody(code, "webinar_chat_window");
  assert.match(window.header, /security invoker/);
  const before = functionBody(sqlCodeOf(read("supabase/migrations/202610290001_webinars_v2_chat.sql")), "webinar_chat_window").body.replace(
    "select s.id, s.webinar_id, s.source_session_id, coalesce(r.anchor_offset_ms, 0) as anchor_ms",
    "select s.id, s.webinar_id, s.source_session_id, coalesce(r.anchor_offset_ms, 0) as anchor_ms, s.jit, s.scheduled_at"
  );
  assertKeepsBody(before, window.body, "webinar_chat_window");
  const jit = window.body.slice(window.body.lastIndexOf("union all"));
  for (const rule of [
    /where s\.jit/,
    /and js\.jit/,
    /and js\.webinar_id = s\.webinar_id/,
    /and js\.id <> s\.id/,
    /\(js\.scheduled_at at time zone 'America\/Sao_Paulo'\)::date = \(s\.scheduled_at at time zone 'America\/Sao_Paulo'\)::date/,
    /and m\.source = 'audience'/,
    /and m\.approved/,
    /and not m\.master/,
    /and m\.deleted_at is null/,
    /and m\.offset_ms between p_from_ms and p_to_ms/
  ]) {
    assert.match(jit, rule, String(rule));
  }
});
