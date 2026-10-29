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

// Guarda da fase 4b dos webinarios (docs/30 §1.6, §2.2, §3.3 a §3.6, §4.2, §4.3, §5.1, §6.6, §8.6, M6 a M8 e §11): a
// migracao 202610290005_webinars_v4b_ofertas.sql.
// - as migracoes ate a 202610290004 continuam byte a byte, e a 0005 e o texto exato (hash);
// - nove secoes MCP, idempotente, so acrescenta (nenhum drop, delete nem politica; triggers atras da guarda);
// - as quatro tabelas da Oferta so do service_role; os checks batem com as listas e limites do app (model.ts,
//   offer-model.ts);
// - o valor da venda (M8) em webhook_events sem tocar o acesso; a Simulacao nunca na sessao `live`;
// - a variante por md5 (M7) igual a offerVariantFor; a conversao pelo sale_grants em attribution_days, nunca pelo
//   clique; o follow-up nunca le a Simulacao;
// - webinar_report e webinar_panel mantem o corpo anterior inteiro e so leem a Simulacao nas linhas sim_*.

const MIGRATION = "supabase/migrations/202610290005_webinars_v4b_ofertas.sql";
const model = await import("../src/server/webinars/model.ts");
const offerModel = await import("../src/server/webinars/offer-model.ts");

const NEW_TABLES = ["webinar_offers", "webinar_offer_variants", "webinar_offer_displays", "webinar_offer_clicks"];

test("as migracoes ate a 202610290004 continuam byte a byte; a 0005 e o texto exato (aplicar antes do merge)", () => {
  const applied = cumulativeHash("202610290004_webinars_v4a_paineis.sql");
  assert.equal(applied.count, 57);
  assert.equal(applied.hash, "ed615506da6f4b6b17e39cd51d67dc10d63d58d6f79fc9cba486433adcd9a88c", "uma migracao anterior mudou");
  assert.ok(migrationFiles().includes("202610290005_webinars_v4b_ofertas.sql"));
  assert.equal(fileHash(MIGRATION), "2ad2b6057e9530af94c42540323b6d39aa8cd9b1a9d4d0117cdd2c613a5a0933", "a 202610290005 mudou: confira de novo antes de aplicar na nuvem de teste (docs/21 §9.10; nenhuma foi aplicada ainda) e atualize este hash junto");
});

test("a 0005: nove secoes MCP, idempotente, so acrescenta; as quatro tabelas novas so do service_role", () => {
  const migration = read(MIGRATION);
  assertSections(migration, 9);
  assertOnlyAdds(migration);
  const code = sqlCodeOf(migration);
  assert.equal((code.match(/\bcreate table\b/gi) ?? []).length, 4);
  for (const table of NEW_TABLES) {
    assertServiceRoleOnly(code, table);
  }
  assert.doesNotMatch(code, /grant[^;]*to (?:anon|authenticated|public)\b/i);
  for (const signature of [
    "webinar_offer_variant(uuid, uuid)",
    "webinar_offer_conversions(timestamptz, integer)",
    "webinar_follow_up_facts(uuid[])",
    "webinar_report(uuid)",
    "webinar_panel(text, timestamptz, timestamptz, uuid[])"
  ]) {
    assertFunctionServiceRole(code, signature);
  }
  for (const name of ["webinar_offer_variant", "webinar_offer_conversions", "webinar_follow_up_facts", "webinar_report", "webinar_panel"]) {
    const fn = functionBody(code, name);
    assert.match(fn.header, /security invoker/, name);
    assert.match(fn.header, /set search_path = pg_catalog, public/, name);
  }
});

test("os checks da Oferta batem com as listas e os limites do app", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const limits = model.OFFER_LIMITS;
  assert.match(code, new RegExp(`trigger_kind text not null default 'at_offset' check \\(trigger_kind in \\(${sqlList(model.OFFER_TRIGGERS)}\\)\\)`));
  assert.match(code, new RegExp(`status text not null default 'draft' check \\(status in \\(${sqlList(model.OFFER_STATUSES)}\\)\\)`));
  assert.match(code, new RegExp(`label text not null check \\(label in \\(${sqlList(model.OFFER_VARIANT_LABELS)}\\)\\)`));
  assert.match(code, new RegExp(`variant_label text not null check \\(variant_label in \\(${sqlList(model.OFFER_VARIANT_LABELS)}\\)\\)`));
  assert.match(code, new RegExp(`char_length\\(headline\\) between 1 and ${limits.headline}`));
  assert.match(code, new RegExp(`char_length\\(title\\) <= ${limits.title}`));
  assert.match(code, new RegExp(`char_length\\(badge\\) <= ${limits.badge}`));
  assert.match(code, new RegExp(`char_length\\(price_from_label\\) <= ${limits.priceLabel}`));
  assert.match(code, new RegExp(`char_length\\(price_label\\) <= ${limits.priceLabel}`));
  assert.match(code, new RegExp(`char_length\\(coupon\\) <= ${limits.coupon}`));
  assert.match(code, new RegExp(`char_length\\(checkout_url\\) between ${limits.urlMin} and ${limits.url} and checkout_url ~ '\\^https://'`));
  assert.match(code, new RegExp(`weight integer not null default 1 check \\(weight between ${limits.weightMin} and ${limits.weightMax}\\)`));
  assert.match(code, new RegExp(`attribution_days integer not null default ${limits.attributionDaysDefault} check \\(attribution_days between ${limits.attributionDaysMin} and ${limits.attributionDaysMax}\\)`));
  assert.match(code, new RegExp(`visible_minutes between 1 and ${limits.visibleMinutesMax}`));
  assert.match(code, new RegExp(`deadline_minutes between 1 and ${limits.deadlineMinutesMax}`));
  const tokenPattern = code.match(/click_token ~ '([^']+)'/)?.[1];
  assert.ok(tokenPattern);
  const sample = offerModel.newClickToken();
  assert.ok(new RegExp(tokenPattern).test(sample) && offerModel.isClickToken(sample), "o token do app passa no check do banco");
  assert.match(code, /create unique index if not exists webinar_offers_one_active_idx on public\.webinar_offers \(webinar_id\) where status <> 'archived';/, "uma Oferta ativa por webinario");
  assert.match(code, /create unique index if not exists webinar_offer_displays_session_idx on public\.webinar_offer_displays \(session_id, offer_id\);/);
  assert.match(code, /create unique index if not exists webinar_offer_clicks_token_idx on public\.webinar_offer_clicks \(click_token\);/);
  assert.match(code, /on public\.webinar_offer_clicks \(offer_id, converted_sale_grant_id\) where converted_sale_grant_id is not null;/, "uma venda converte um clique por oferta");
  assert.match(code, /converted_sale_grant_id uuid references public\.sale_grants\(id\) on delete set null/);
});

test("M8: o valor da venda em webhook_events, com nome e guarda; a regra de acesso nao muda", () => {
  const migration = read(MIGRATION);
  const code = sqlCodeOf(migration);
  assert.match(code, /alter table public\.webhook_events add column if not exists amount_cents bigint;/);
  assert.match(code, /alter table public\.webhook_events add column if not exists currency text;/);
  assert.match(code, /check \(currency is null or currency ~ '\^\[A-Z\]\{3\}\$'\)/);
  assert.doesNotMatch(code, /\bentitlements\b/, "a 0005 nunca le nem muda acesso");
  assert.doesNotMatch(read("src/server/payments/process-sale.ts"), /amount_cents|amount\b/, "process-sale.ts (acesso) nao le o valor");
});

test("a Simulacao: as colunas de §4.3, a semente, nunca na sessao live", () => {
  const code = sqlCodeOf(read(MIGRATION));
  for (const column of ["simulated_count_rule jsonb", "simulated_joins jsonb", "simulated_sale_notices jsonb", "simulation_summary jsonb"]) {
    assert.match(code, new RegExp(`alter table public\\.webinar_sessions add column if not exists ${column};`), column);
  }
  assert.match(code, /add column if not exists simulation_seed integer not null default \(floor\(random\(\) \* 2147483647\)\)::integer;/);
  assert.match(
    code,
    /check \(kind <> 'live' or \(simulated_count_rule is null and simulated_joins is null and simulated_sale_notices is null and simulation_summary is null\)\)/,
    "uma sessao live tem as regras simuladas desligadas (docs/30 §4.3)"
  );
});

test("M7: a variante por md5 e a mesma de offerVariantFor (conferida num Postgres 16 em 29/10/2026)", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const variant = functionBody(code, "webinar_offer_variant").body;
  assert.match(variant, /\('x' \|\| substr\(md5\(p_user_id::text \|\| p_offer_id::text\), 1, 8\)\)::bit\(32\)::bigint % v\.total\) < v\.upto/);
  assert.match(variant, /order by o\.label rows between unbounded preceding and current row/);
  assert.match(variant, /where o\.offer_id = p_offer_id and o\.enabled/);
  // Os mesmos quatro alunos com pesos A=1, B=2, C=1, D=3 deram B, B, C e D no Postgres local.
  const variants = [["A", 1], ["B", 2], ["C", 1], ["D", 3]].map(([label, weight]) => ({ enabled: true, label, weight }));
  const offerId = "50000000-0000-4000-8000-000000000001";
  const expected = {
    "00000000-0000-4000-8000-0000000000a1": "B",
    "00000000-0000-4000-8000-0000000000b2": "B",
    "00000000-0000-4000-8000-0000000000c3": "C",
    "9d2f6a3e-1b7c-4e8a-9f00-5c4d3b2a1e0f": "D"
  };
  for (const [userId, label] of Object.entries(expected)) {
    assert.equal(offerModel.offerVariantFor({ offerId, userId, variants })?.label, label, userId);
  }
});

test("a conversao liga o clique ao sale_grants em attribution_days; o follow-up nunca le a Simulacao", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const conversions = functionBody(code, "webinar_offer_conversions").body;
  assert.match(conversions, /join public\.sale_grants g on g\.user_id = c\.user_id and g\.product_id = o\.product_id/);
  assert.match(conversions, /g\.created_at >= c\.clicked_at/);
  assert.match(conversions, /g\.created_at <= c\.clicked_at \+ make_interval\(days => o\.attribution_days\)/);
  assert.match(conversions, /order by g\.id, c\.offer_id, c\.clicked_at desc/, "o ultimo clique antes da venda");
  assert.match(conversions, /and c\.converted_sale_grant_id is null;/);
  const facts = functionBody(code, "webinar_follow_up_facts").body;
  assert.doesNotMatch(facts, /simulat|scripted|sim_/, "o follow-up nunca le a Simulacao (docs/30 §4.7)");
  assert.match(facts, /not exists \(select 1 from public\.admin_roles a where a\.user_id = f\.user_id\)/);
  for (const action of ["registered", "attended", "watched_replay", "offer_seen", "left_before_offer", "clicked", "purchased"]) {
    assert.match(facts, new RegExp(`\\b${action}\\b`), action);
  }
});

test("webinar_report e webinar_panel: o corpo anterior inteiro, a Oferta real e a Simulacao so nas linhas sim_*", () => {
  const code = sqlCodeOf(read(MIGRATION));
  const report = functionBody(code, "webinar_report").body;
  assertKeepsBody(functionBody(sqlCodeOf(read("supabase/migrations/202610290001_webinars_v2_chat.sql")), "webinar_report").body, report, "webinar_report");
  const panel = functionBody(code, "webinar_panel").body;
  // A unica linha que muda no painel: a sessao passa a trazer o resumo congelado (o bloco Simulacao separado).
  const panelBefore = functionBody(sqlCodeOf(read("supabase/migrations/202610290004_webinars_v4a_paineis.sql")), "webinar_panel").body.replace(
    "select s.id, s.webinar_id, s.kind, s.presence_curve,",
    "select s.id, s.webinar_id, s.kind, s.presence_curve, s.simulation_summary,"
  );
  assertKeepsBody(panelBefore, panel, "webinar_panel");
  for (const body of [report, panel]) {
    // A Simulacao so entra pelo resumo congelado, e so nas linhas sim_*.
    const reads = body.split("\n").filter((line) => /simulation_summary|summary->/.test(line));
    assert.ok(reads.length > 0);
    assert.doesNotMatch(body, /simulated_count_rule|simulated_joins|simulated_sale_notices|simulation_seed/, "as regras nunca entram num numero");
    assert.match(body, /'sim_counter', 'max', \((?:sim\.summary|ss\.simulation_summary)->>'counter_max'\)::bigint/);
    assert.match(body, /join public\.sale_grants g on g\.id = c\.converted_sale_grant_id/, "a compra so pelo sale_grants (webhook)");
    assert.match(body, /e\.amount_cents is not null and e\.currency is not null/);
  }
});
