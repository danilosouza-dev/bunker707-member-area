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
// 202610300005_webinars_v4e_just_in_time.sql (a 4d, Sala Live vertical, nao tem dado novo nem migracao: a 4e vem
// logo depois da 4c, sem buraco).
// - as migracoes ate a 202610300004 continuam byte a byte, e a 202610300005 e o texto exato (hash);
// - quatro secoes MCP, idempotente, so acrescenta;
// - webinar_sessions.jit so na sessao `simulated`, uma por horario (indice unico parcial); SESSION_COLUMNS le `jit`
//   e o aviso de migracao pendente (WEBINARS_MIGRATION) aponta a mais nova dos webinarios, que inclui a 202610300005;
// - webinar_chat_window mantem o corpo inteiro da 202610290001 e so acrescenta a turma do dia das sessoes jit:
//   `audience` aprovadas, nunca a linha mestre nem os pendentes, pelo dia de Sao Paulo.

const MIGRATION = "supabase/migrations/202610300005_webinars_v4e_just_in_time.sql";
const rows = await import("../src/server/webinars/rows.ts");

test("as migracoes ate a 202610300004 continuam byte a byte; a fase 4 sem buraco; a 202610300005 e o texto exato", () => {
  const applied = cumulativeHash("202610300004_webinars_v4c_assistente.sql");
  assert.equal(applied.count, 60);
  assert.equal(applied.hash, "7eeca5319aa12b198867d5db4b52ecb9946f56aaed25c10524688df6a1b3e414", "uma migracao anterior mudou");
  assert.deepEqual(
    migrationFiles().filter((name) => name.startsWith("2026103000")),
    [
      "202610300001_webinars_quem_pode_regras.sql",
      "202610300002_webinars_v4a_paineis.sql",
      "202610300003_webinars_v4b_ofertas.sql",
      "202610300004_webinars_v4c_assistente.sql",
      "202610300005_webinars_v4e_just_in_time.sql",
      "202610300006_webinars_v4f_traducao.sql",
      "202610300007_webinars_v4_ajustes.sql"
    ],
    "a fase 4 vem depois da 202610300001, na ordem e sem buraco (a 4d, Sala Live vertical, nao tem migracao)"
  );
  assert.ok(migrationFiles().includes("202610300005_webinars_v4e_just_in_time.sql"));
  assert.equal(fileHash(MIGRATION), "a38aecc10f7beff4581ca1826d34f4d63b57bbe382eabffa0c1983bfe642a957", "a 202610300005 mudou: ela ja foi aplicada na nuvem de teste (docs/21 §9.10): a correcao vai numa migracao nova, nunca neste arquivo");
  const appMigration = read("src/server/webinars/db.ts").match(/WEBINARS_MIGRATION = "(\d+)"/)?.[1];
  // Toda leitura de sessao le jit (202610300005), e o aviso de migracao pendente aponta a mais nova dos webinarios, a
  // 202610300007 (aplicar ate ela inclui a 202610300005), como pede a guarda tests/webinarios-quem-pode-migracao.guard.test.mjs.
  assert.equal(appMigration, "202610300007", "toda leitura de sessao le jit: o aviso de migracao pendente aponta uma migracao que inclui a 202610300005");
  assert.ok(appMigration >= "202610300005");
  assert.ok(rows.SESSION_COLUMNS.split(", ").includes("jit"));
  assert.ok(existsSync(new URL(MIGRATION, root)));
});

test("a 202610300005: quatro secoes MCP, idempotente, so acrescenta; jit so na sessao gravada, uma por horario", () => {
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
