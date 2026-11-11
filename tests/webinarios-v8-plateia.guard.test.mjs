import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { assertOnlyAdds, assertSections, assertServiceRoleOnly, cumulativeHash, fileHash, migrationFiles, read, sqlCodeOf, sqlList, statementsOf } from "./support/webinarios-migracao-guarda.mjs";

// Guarda da migracao dos participantes simulados mudados a qualquer momento (docs/30 D79 e D80, §4.1 e §4.3; docs/21
// §9.15; docs/18 §1.2): a 202611110002_webinars_v8_plateia.sql.
// - as 66 migracoes ate a 202611100002 continuam byte a byte (hash acumulado); a 202611110002 vem depois dela (a
//   202611110001 de outra frente da mesma rodada pode ficar no meio) e e o texto exato (hash);
// - duas secoes MCP, idempotente, so acrescenta (nenhum drop); a tabela nova so do service_role;
// - os limites do SQL sao os do app (o offset de CHAT_LIMITS, a frase de CHAT_LIMITS.simulationAck, as origens de
//   SIMULATION_CHANGE_SOURCES, as colunas que simulation-change-rows.ts le e grava);
// - nenhuma coluna nova em webinar_sessions (a sessao so guarda a decisao vigente); o aviso aponta esta
//   (WEBINARS_AUDIENCE_MIGRATION, a mesma de AUDIENCE_MIGRATION, que o controle mostra), e WEBINARS_MIGRATION passa a ser
//   esta, a mais nova dos webinarios (a guarda tests/webinarios-quem-pode-migracao.guard.test.mjs pede).

const MIGRATION = "supabase/migrations/202611110002_webinars_v8_plateia.sql";
const model = await import("../src/server/webinars/model.ts");
const rows = await import("../src/server/webinars/simulation-change-rows.ts");
const audience = await import("../src/server/webinars/simulation-audience-model.ts");
// db.ts tem "server-only": as constantes sao lidas do texto.
const dbSource = read("src/server/webinars/db.ts");
const migration = read(MIGRATION);
const code = sqlCodeOf(migration);

test("as 66 migracoes ate a 202611100002 continuam byte a byte; a 202611110002 vem depois e e o texto exato", () => {
  const applied = cumulativeHash("202611100002_webinars_v7_na_tela.sql");
  assert.equal(applied.count, 66);
  assert.equal(applied.hash, "9292354986d87ef4d7d03efff3c382b374b4937b1fc2ca421e423987a5b834bb", "uma migracao ja aplicada mudou: a correcao vai numa migracao nova");
  const files = migrationFiles();
  assert.ok(files.indexOf("202611110002_webinars_v8_plateia.sql") > files.indexOf("202611100002_webinars_v7_na_tela.sql"), "depois da Na tela");
  assert.equal(
    fileHash(MIGRATION),
    "3bc28131d3548c3d2bae9c591e6bfcd4daa642edbd587b3f5a7dcb02bcc1eb2e",
    "a 202611110002 mudou: depois de aplicada na nuvem de teste (docs/21 §9.15), a correcao vai numa migracao nova; antes, aplique de novo e atualize este hash junto"
  );
});

test("a 202611110002: duas secoes MCP, idempotente, so acrescenta; a tabela so do service_role; nenhuma coluna nova na sessao", () => {
  assertSections(migration, 2);
  assertOnlyAdds(migration);
  assertServiceRoleOnly(code, "webinar_simulation_changes");
  assert.equal((code.match(/\bcreate table\b/g) ?? []).length, 1, "uma tabela nova");
  assert.match(code, /session_id uuid not null references public\.webinar_sessions\(id\) on delete cascade,/, "some com a sessao");
  assert.match(code, /changed_by uuid references auth\.users\(id\) on delete set null,/, "a linha fica quando a pessoa sai");
  assert.match(code, /create index if not exists webinar_simulation_changes_session_idx on public\.webinar_simulation_changes \(session_id, created_at\);/);
  assert.doesNotMatch(statementsOf(migration), /alter table public\.webinar_sessions/, "nada muda na sessao");
  assert.doesNotMatch(statementsOf(migration), /\bupdate\s+public\./i, "nenhum dado antigo e reescrito");
});

test("os limites do SQL sao os do app (simulation-change-rows.ts, model.ts)", () => {
  assert.match(code, new RegExp(`at_offset_ms integer check \\(at_offset_ms is null or at_offset_ms between 0 and ${model.CHAT_LIMITS.offsetMaxMs}\\),`));
  assert.match(code, new RegExp(`ack_text text not null check \\(char_length\\(ack_text\\) between 1 and ${model.CHAT_LIMITS.simulationAck}\\),`));
  assert.match(code, new RegExp(`source text not null default '${model.SIMULATION_CHANGE_SOURCES[0]}' check \\(source in \\(${sqlList(model.SIMULATION_CHANGE_SOURCES)}\\)\\),`));
  assert.match(code, /count_rule jsonb check \(count_rule is null or \(jsonb_typeof\(count_rule\) = 'object' and pg_column_size\(count_rule\) <= 4096\)\),/);
  // As colunas que o app le e grava existem na tabela, e nenhuma outra.
  const columns = rows.SIMULATION_CHANGE_COLUMNS.split(",").map((column) => column.trim());
  for (const column of columns) {
    assert.match(code, new RegExp(`\\n  ${column} `), column);
  }
  const written = Object.keys(rows.simulationChangeToRow({ ackText: "x", atMs: 0, changedBy: "u", rule: { base: 1, jitter: 0, mode: "fixed", peak: 1 }, sessionId: "s", source: "console" }));
  assert.deepEqual(written.filter((column) => !columns.includes(column)), [], "o insert so usa colunas que existem");
});

test("o aviso de migracao pendente aponta esta (WEBINARS_AUDIENCE_MIGRATION = AUDIENCE_MIGRATION) e WEBINARS_MIGRATION e esta, a mais nova", () => {
  assert.match(dbSource, /export const WEBINARS_AUDIENCE_MIGRATION = "202611110002";/);
  assert.equal(audience.AUDIENCE_MIGRATION, "202611110002");
  assert.match(dbSource, /export const WEBINARS_MIGRATION = "202611110002";/, "a mais nova dos webinarios: aplicar ate ela inclui todas as de antes");
});
