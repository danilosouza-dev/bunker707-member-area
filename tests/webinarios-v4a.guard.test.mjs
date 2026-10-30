import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import {
  assertFunctionServiceRole,
  assertOnlyAdds,
  assertSections,
  cumulativeHash,
  fileHash,
  functionBody,
  migrationFiles,
  read,
  sqlCodeOf
} from "./support/webinarios-migracao-guarda.mjs";

// Guarda da fase 4a dos webinarios (docs/30 §3.1 a §3.3, §3.6, §4.6 e §11; docs/18 §1.2): a migracao
// 202610300002_webinars_v4a_paineis.sql, a primeira da fase 4, logo depois da 202610300001 do "Quem pode" por regras.
// - as migracoes ate a 202610300001 (aplicadas na nuvem de teste) continuam byte a byte, e a 202610300002 e o texto
//   exato (hash);
// - tres secoes MCP, idempotente, sem drop, delete, truncate, politica nem concurrently;
// - webinar_panel so do service_role, security invoker, a assinatura exata, so alunos (admin_roles fora) e so numeros
//   reais: o chat so `audience`, nunca `scripted` / `ai` nem as colunas de Simulacao (D6, D10, M6);
// - as metricas que a 202610300002 devolve estao nas listas do app (PANEL_SESSION_METRICS / PANEL_PERIOD_METRICS) e a
//   retencao sai nos 21 pontos de PANEL_RETENTION_POINTS.

const MIGRATION = "supabase/migrations/202610300002_webinars_v4a_paineis.sql";
const model = await import("../src/server/webinars/model.ts");

test("as migracoes ate a 202610300001 continuam byte a byte; a 202610300002 e o texto exato (ja aplicada)", () => {
  const applied = cumulativeHash("202610300001_webinars_quem_pode_regras.sql");
  assert.equal(applied.count, 57);
  assert.equal(applied.hash, "731f61dfc62bed59450739366af5f18b4f5ff2ffb9aa0d9931f4fc8f54155f2d", "uma migracao ja aplicada mudou");
  assert.ok(migrationFiles().includes("202610300002_webinars_v4a_paineis.sql"));
  assert.equal(fileHash(MIGRATION), "6c5b7f779e3aace5bc9e4aaf2a66b110a8b56e54d448884abfa08addcb1da7e0", "a 202610300002 mudou: ela ja foi aplicada na nuvem de teste (docs/21 §9.10): a correcao vai numa migracao nova, nunca neste arquivo");
});

test("a 202610300002: tres secoes MCP, idempotente, so acrescenta", () => {
  const migration = read(MIGRATION);
  assertSections(migration, 3);
  assertOnlyAdds(migration);
  const code = sqlCodeOf(migration);
  assert.doesNotMatch(code, /\bcreate table\b/i, "nenhuma tabela nova");
  assert.match(code, /create index if not exists webinar_sessions_kind_scheduled_idx on public\.webinar_sessions \(kind, scheduled_at\);/);
});

test("webinar_panel: so service_role, security invoker, a assinatura dos paineis", () => {
  const code = sqlCodeOf(read(MIGRATION));
  assertFunctionServiceRole(code, "webinar_panel(text, timestamptz, timestamptz, uuid[])");
  const panel = functionBody(code, "webinar_panel");
  assert.match(panel.header, /\(p_kind text, p_start timestamptz, p_end timestamptz, p_session_ids uuid\[\] default null\)/);
  assert.match(panel.header, /returns table \(session_id uuid, metric text, item text, total bigint, students bigint\)/);
  assert.match(panel.header, /language sql\s+stable\s+security invoker\s+set search_path = pg_catalog, public/);
  assert.match(panel.body, /\(p_kind = 'all' or s\.kind = p_kind\)/);
  assert.match(panel.body, /s\.scheduled_at >= p_start and s\.scheduled_at < p_end/, "o periodo e [inicio, fim) pela hora marcada (docs/30 §3.1)");
  assert.match(panel.body, /p_session_ids is null or s\.id = any\(p_session_ids\)/);
  assert.match(panel.body, /w\.deleted_at is null/);
});

test("webinar_panel: so alunos e so numeros reais (nunca scripted, ai nem simulacao)", () => {
  const panel = functionBody(sqlCodeOf(read(MIGRATION)), "webinar_panel").body;
  assert.match(panel, /staff as \(select a\.user_id from public\.admin_roles a\)/);
  assert.ok((panel.match(/not exists \(select 1 from staff where staff\.user_id = /g) ?? []).length >= 8, "a equipe fora de cada fonte");
  assert.match(panel, /m\.source = 'audience'/, "mensagens: so alunos (docs/30 §3.2)");
  assert.doesNotMatch(panel, /scripted|'ai'|simulation_|simulated_|sim_/, "a 202610300002 nao le nada simulado (D6, M6; 'simulated' e o tipo da sessao)");
  assert.match(panel, /ss\.presence_curve is null and ps\.bucket >= 0/, "as amostras so da sessao em andamento");
});

test("webinar_panel: as metricas batem com as listas do app e a retencao tem os 21 pontos", () => {
  const panel = functionBody(sqlCodeOf(read(MIGRATION)), "webinar_panel").body;
  const metrics = [...panel.matchAll(/(?:select [^;]*?, |as session_id, )'(\w+)'(?:::text)?(?: as metric)?, /g)].map((match) => match[1]);
  const named = new Set(metrics);
  for (const metric of named) {
    assert.ok([...model.PANEL_SESSION_METRICS, ...model.PANEL_PERIOD_METRICS].includes(metric), `${metric} esta nas listas do app`);
  }
  for (const metric of ["duration", "registered", "present", "attended_registered", "watch_sum", "watch_max", "reached_end", "peak", "messages", "question", "reactions", "poll_answers", "replay_viewers", "visitors", "retention"]) {
    assert.ok(named.has(metric), `${metric} sai na 202610300002`);
  }
  assert.match(panel, /generate_series\(0, 100, 5\)/);
  assert.deepEqual(model.PANEL_RETENTION_POINTS, Array.from({ length: 21 }, (_, index) => index * 5));
});
