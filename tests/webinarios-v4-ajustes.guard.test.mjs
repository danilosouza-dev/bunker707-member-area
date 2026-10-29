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
  sqlCodeOf
} from "./support/webinarios-migracao-guarda.mjs";

// Guarda dos ajustes da revisao da fase 4 dos webinarios (docs/30 §3.3, §3.4, §4.2, §4.5, §8.6 e §11): a migracao
// 202610290010_webinars_v4_ajustes.sql. As de 0004 a 0009 nao mudam (hash acumulado; nenhuma migracao da fase 4 foi
// aplicada ainda, em lugar nenhum: docs/21 §9.10) e os ajustes entram aqui, so acrescentando.
// - seis secoes MCP, idempotente, so acrescenta (nenhum drop, delete nem politica); a tabela nova so do service_role;
// - webinar_close_session mantem o corpo da 202610290001 inteiro e congela quem viu a oferta (webinar_offer_seen);
// - webinar_offer_conversions: o ultimo clique entre todos da janela (convertidos ou nao) e sem venda reembolsada;
// - webinar_follow_up_facts, webinar_report e webinar_panel: o corpo anterior inteiro menos as linhas trocadas (a lista
//   fixa abaixo), "Viram a oferta" pelo congelado com a sessao encerrada, a compra e a receita sem reembolso nem
//   chargeback, e no relatorio o "Falar com a equipe" contado uma vez.

const MIGRATION = "supabase/migrations/202610290010_webinars_v4_ajustes.sql";
const code = () => sqlCodeOf(read(MIGRATION));
const UNDONE = /g\.closed_by is null or g\.closed_by not in \('refund', 'chargeback'\)/;

test("as migracoes ate a 202610290009 continuam byte a byte; a 0010 e o texto exato (as seis da fase 4 a aplicar antes do merge)", () => {
  const applied = cumulativeHash("202610290009_webinars_v4f_traducao.sql");
  assert.equal(applied.count, 61);
  assert.equal(applied.hash, "5b79fca5bd361feb0ec7c4d02c1f83817efeb66db0f4701a9636a335cdaed3d5", "uma migracao anterior mudou");
  assert.ok(migrationFiles().includes("202610290010_webinars_v4_ajustes.sql"));
  assert.equal(fileHash(MIGRATION), "57d5ff68f2af978d41bc40a2494001bbdb504be1efd44ad2145389702ee3af9e", "a 202610290010 mudou: confira de novo antes de aplicar na nuvem de teste (docs/21 §9.10; nenhuma foi aplicada ainda) e atualize este hash junto");
});

test("a 0010: seis secoes MCP, idempotente, so acrescenta; webinar_offer_seen so do service_role; as funcoes so do service_role", () => {
  const migration = read(MIGRATION);
  assertSections(migration, 6);
  assertOnlyAdds(migration);
  const sql = code();
  assert.equal((sql.match(/\bcreate table\b/gi) ?? []).length, 1);
  assertServiceRoleOnly(sql, "webinar_offer_seen");
  assert.match(sql, /primary key \(session_id, offer_id, user_id\)/);
  assert.match(sql, /variant_label text check \(variant_label is null or variant_label in \('A', 'B', 'C', 'D'\)\)/);
  assert.doesNotMatch(sql, /grant[^;]*to (?:anon|authenticated|public)\b/i);
  for (const signature of ["webinar_close_session(uuid, timestamptz)", "webinar_offer_conversions(timestamptz, integer)", "webinar_follow_up_facts(uuid[])", "webinar_report(uuid)", "webinar_panel(text, timestamptz, timestamptz, uuid[])"]) {
    assertFunctionServiceRole(sql, signature);
  }
  for (const name of ["webinar_close_session", "webinar_offer_conversions", "webinar_follow_up_facts", "webinar_report", "webinar_panel"]) {
    const fn = functionBody(sql, name);
    assert.match(fn.header, /security invoker/, name);
    assert.match(fn.header, /set search_path = pg_catalog, public/, name);
  }
  // As sessoes ja encerradas ganham o congelado pelas amostras que ainda existem, sem duplicar ao rodar de novo.
  assert.match(sql, /insert into public\.webinar_offer_seen[\s\S]*?s\.presence_curve is not null[\s\S]*?on conflict \(session_id, offer_id, user_id\) do nothing;/);
});

test("webinar_close_session: o corpo da 0001 inteiro e o congelado de quem viu a oferta antes de por `ended`", () => {
  const before = functionBody(sqlCodeOf(read("supabase/migrations/202610290001_webinars_v2_chat.sql")), "webinar_close_session").body;
  const after = functionBody(code(), "webinar_close_session").body;
  assertKeepsBody(before, after, "webinar_close_session");
  assert.match(after, /insert into public\.webinar_offer_seen \(session_id, offer_id, user_id, variant_label\)[\s\S]*?public\.webinar_offer_variant\(ps\.user_id, d\.offer_id\)[\s\S]*?on conflict \(session_id, offer_id, user_id\) do nothing;\s*update public\.webinar_sessions/);
});

test("webinar_offer_conversions: o ultimo clique entre todos da janela; o par cai se ele ja tem venda; venda reembolsada nao converte", () => {
  const body = functionBody(code(), "webinar_offer_conversions").body;
  const ranked = body.slice(body.indexOf("with ranked as ("), body.indexOf("candidates as ("));
  assert.doesNotMatch(ranked, /converted_sale_grant_id is null/, "a escolha do ultimo clique nao filtra os convertidos");
  assert.match(ranked, /order by g\.id, c\.offer_id, c\.clicked_at desc, c\.id desc/);
  assert.match(ranked, UNDONE);
  assert.match(ranked, /g\.created_at >= c\.clicked_at/);
  assert.match(ranked, /g\.created_at <= c\.clicked_at \+ make_interval\(days => o\.attribution_days\)/);
  const candidates = body.slice(body.indexOf("candidates as ("), body.indexOf("picked as ("));
  assert.match(candidates, /where r\.click_grant is null/, "so depois de escolher descarta o clique ja convertido");
  assert.match(candidates, /limit greatest\(1, least\(coalesce\(p_limit, 500\), 5000\)\)/, "o limite depois do filtro");
  assert.match(body, /and c\.converted_sale_grant_id is null;/);
});

/** As linhas do corpo anterior que deixaram de existir (as trocadas): exatamente estas. */
function assertOnlyChanged(file, name, changed) {
  const before = functionBody(sqlCodeOf(read(`supabase/migrations/${file}`)), name).body;
  const after = functionBody(code(), name).body;
  const kept = before
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !changed.includes(line));
  const afterLines = new Set(after.split("\n").map((line) => line.trim()));
  assert.deepEqual(
    before
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !afterLines.has(line)),
    changed,
    `${name}: so estas linhas mudaram`
  );
  assertKeepsBody(kept.join("\n"), after, name);
  return after;
}

test("webinar_follow_up_facts: viu a oferta pelo congelado na sessao encerrada; comprou sem reembolso; nunca a Simulacao", () => {
  const body = assertOnlyChanged("202610290005_webinars_v4b_ofertas.sql", "webinar_follow_up_facts", [
    "select s.id, s.webinar_id, s.kind,",
    "where o.webinar_id = any(p_webinar_ids) and c.converted_sale_grant_id is not null"
  ]);
  assert.match(body, /ps\.bucket between w\.b0 and w\.b1\s*where ss\.presence_curve is null/);
  assert.match(body, /from public\.webinar_offer_seen f\s*join ss on ss\.id = f\.session_id\s*where ss\.presence_curve is not null/);
  assert.match(body, /join public\.sale_grants g on g\.id = c\.converted_sale_grant_id/);
  assert.match(body, UNDONE);
  assert.doesNotMatch(body, /simulat|scripted|sim_/, "o follow-up nunca le a Simulacao (docs/30 §4.7)");
});

test("webinar_report e webinar_panel: viram pelo congelado na encerrada, compras e receita sem reembolso; o handoff uma vez", () => {
  const report = assertOnlyChanged("202610290006_webinars_v4c_assistente.sql", "webinar_report", [
    "where not exists (select 1 from staff where staff.user_id = ps.user_id)",
    "select c.offer_id, c.user_id, c.variant_label as label, c.converted_sale_grant_id",
    "from public.webinar_offer_clicks c, s"
  ]);
  const panel = assertOnlyChanged("202610290005_webinars_v4b_ofertas.sql", "webinar_panel", [
    "where not exists (select 1 from staff where staff.user_id = ps.user_id)",
    "select c.session_id, c.offer_id, c.user_id, c.variant_label as label, c.converted_sale_grant_id"
  ]);
  for (const [name, body] of [["webinar_report", report], ["webinar_panel", panel]]) {
    assert.match(body, /presence_curve is null and not exists \(select 1 from staff where staff\.user_id = ps\.user_id\)/, `${name}: amostras so na sessao em andamento`);
    assert.match(body, /from public\.webinar_offer_seen f/, `${name}: o congelado`);
    assert.match(body, /presence_curve is not null/, name);
    assert.match(body, /left join public\.sale_grants g on g\.id = c\.converted_sale_grant_id/, name);
    assert.match(body, /case when g\.id is not null and \(g\.closed_by is null or g\.closed_by not in \('refund', 'chargeback'\)\) then c\.converted_sale_grant_id end as converted_sale_grant_id/, name);
    assert.doesNotMatch(body, /simulated_count_rule|simulated_joins|simulated_sale_notices|simulation_seed/, `${name}: as regras nunca entram num numero`);
  }
  assert.match(
    report,
    /select m\.id from public\.webinar_chat_messages m, s where m\.session_id = s\.id and m\.handoff_requested_at is not null\s*and not exists \(\s*select 1 from public\.webinar_questions q2\s*where q2\.message_id = m\.id and q2\.session_id = s\.id and q2\.handoff_requested_at is not null\s*\)/,
    "a mensagem com a pergunta ligada conta so pela pergunta"
  );
});
