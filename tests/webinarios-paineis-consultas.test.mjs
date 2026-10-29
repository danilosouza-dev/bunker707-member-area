import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";
import { aplicaFiltros, filterOf, scriptedDb, sessaoRow, webinarRow } from "./support/webinarios-banco-falso.mjs";

// As leituras dos paineis (docs/30 §3.1 a §3.3, §4.6; D9, M6, M9), sem banco e sem Next: "next/cache" vira um duble
// que imita o Data Cache (uma entrada por chave, devolvida para sempre) e o cliente do banco vira um banco falso com
// as sessoes, os webinarios, a Oferta e as RPCs webinar_panel e webinar_report. Aqui: a chave do cache pelo minuto do
// relogio (duas leituras no mesmo minuto, uma RPC; no minuto seguinte, outra) com o hash dos ids do recorte e a tag
// "webinars"; os filtros da aba que viram `p_session_ids` (e o periodo inteiro sem lista); o periodo anterior com a
// janela `previous` de period.ts; so agregados no cache (nada de nome); os nomes de produto e da equipe fora do cache;
// a migracao pendente de cada parte (202610300002 = aviso do painel, 202610300003 = Oferta em "—", sessoes = o aviso
// de WEBINARS_MIGRATION, que inclui a 202610300005 do jit); os numeros da lista; a curva da sessao pela visao do
// relatorio e o recorte do CSV do painel.

const cache = (globalThis.__webinariosPaineisCache ??= { calls: [], entries: new Map(), keys: [], options: [] });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/cache") {
      return {
        shortCircuit: true,
        url: `data:text/javascript,${encodeURIComponent(`
          export function unstable_cache(fn, keyParts, options) {
            const state = globalThis.__webinariosPaineisCache;
            state.keys.push(keyParts);
            state.options.push(options);
            return async (...args) => {
              const key = JSON.stringify([keyParts, args]);
              state.calls.push(keyParts);
              if (!state.entries.has(key)) {
                state.entries.set(key, await fn(...args));
              }
              return state.entries.get(key);
            };
          }
          export function revalidateTag() {}
          export function updateTag() {}
          export function revalidatePath() {}
          export function unstable_noStore() {}
          export function cacheTag() {}
          export function cacheLife() {}`)}`
      };
    }

    const resolved = nextResolve(specifier, context);

    if (typeof resolved.url === "string" && resolved.url.endsWith("/src/server/db/supabase/client.ts")) {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; } export function hasSupabaseConfig() { return true; }"
      };
    }

    return resolved;
  }
});

const queries = await import("../src/server/webinars/panel-queries.ts");
const { getWebinarReport } = await import("../src/server/webinars/report-queries.ts");
const model = await import("../src/server/webinars/panel-model.ts");
const period = await import("../src/components/admin/v2/period.ts");
const { WEBINARS_MIGRATION, WEBINARS_PANELS_MIGRATION } = await import("../src/server/webinars/db.ts");

const MIN = 60_000;
const NOW = Date.parse("2026-10-29T15:00:12.000Z");
const W_IA = "aaaaaaaa-0000-4000-8000-000000000001";
const W_PAPO = "aaaaaaaa-0000-4000-8000-000000000002";
const W_GRAVADA = "aaaaaaaa-0000-4000-8000-000000000004";
const HOST_ANA = "bbbbbbbb-0000-4000-8000-000000000001";
const HOST_BETO = "bbbbbbbb-0000-4000-8000-000000000002";
const S1 = "cccccccc-0000-4000-8000-000000000001";
const S2 = "cccccccc-0000-4000-8000-000000000002";
const S3 = "cccccccc-0000-4000-8000-000000000003";
const P1 = "cccccccc-0000-4000-8000-000000000009";
const R1 = "dddddddd-0000-4000-8000-000000000001";
const R2 = "dddddddd-0000-4000-8000-000000000002";
const ALUNA = "eeeeeeee-0000-4000-8000-000000000001";

const missing = (name) => ({ code: "PGRST202", message: `Could not find the function public.${name} without parameters in the schema cache` });
const missingTable = (name) => ({ code: "42P01", message: `relation "public.${name}" does not exist` });

function banco(extra = {}) {
  const state = {
    offers: [{ attribution_days: 7, created_at: "2026-10-01T00:00:00Z", created_by: null, deadline_minutes: null, id: "f0f0f0f0-0000-4000-8000-000000000001", product_id: "prod-ia", show_at_offset_ms: 900_000, status: "active", title: "Oferta", trigger_kind: "at_offset", updated_at: "2026-10-01T00:00:00Z", visible_minutes: null, webinar_id: W_GRAVADA }],
    variants: [
      { badge: null, checkout_url: "https://pagar.exemplo.com/a", coupon: null, created_at: "2026-10-01T00:00:00Z", enabled: true, headline: "A", id: "f1f1f1f1-0000-4000-8000-000000000001", image_url: null, label: "A", offer_id: "f0f0f0f0-0000-4000-8000-000000000001", price_from_label: null, price_label: null, updated_at: "2026-10-01T00:00:00Z", weight: 1 },
      { badge: null, checkout_url: "https://pagar.exemplo.com/b", coupon: null, created_at: "2026-10-01T00:00:00Z", enabled: true, headline: "B", id: "f1f1f1f1-0000-4000-8000-000000000002", image_url: null, label: "B", offer_id: "f0f0f0f0-0000-4000-8000-000000000001", price_from_label: null, price_label: null, updated_at: "2026-10-01T00:00:00Z", weight: 1 }
    ],
    displays: [{ created_at: "2026-10-10T23:15:00Z", deadline_at: null, hidden_at: null, hidden_by: null, hide_offset_ms: 1_500_000, id: "f2f2f2f2-0000-4000-8000-000000000001", offer_id: "f0f0f0f0-0000-4000-8000-000000000001", session_id: R1, show_offset_ms: 900_000, shown_at: "2026-10-10T23:15:00Z", shown_by: null, snapshot: null, updated_at: "2026-10-10T23:15:00Z" }],
    panelError: null,
    panelRows: (args) => [
      ...(args.p_session_ids ?? [S1, S2]).flatMap((id) => [
        { item: "", metric: "duration", session_id: id, students: 0, total: "3600000" },
        { item: "", metric: "registered", session_id: id, students: 5, total: "5" },
        { item: "", metric: "present", session_id: id, students: 4, total: "4" },
        { item: "", metric: "watch_sum", session_id: id, students: 4, total: 4_800 }
      ]),
      { item: "", metric: "unique_present", session_id: null, students: 7, total: "7" },
      { item: "", metric: "unique_replay_viewers", session_id: null, students: 2, total: 2 }
    ],
    profiles: [
      { full_name: "Ana Equipe", id: HOST_ANA },
      { full_name: "Beto Equipe", id: HOST_BETO }
    ],
    products: [{ id: "prod-ia", title: "Formação em IA" }],
    reportRows: [
      { item: "0", metric: "presence", students: 3, total: 3 },
      { item: "1", metric: "presence", students: 2, total: 2 },
      { item: "0", metric: "peak", students: 3, total: 3 },
      { item: "1", metric: "drop", students: 1, total: 1 },
      { item: "", metric: "unique", students: 3, total: 3 }
    ],
    sessions: [
      sessaoRow({ ended_at: "2026-10-11T00:00:00Z", id: S1, jit: false, kind: "live", scheduled_at: "2026-10-10T23:00:00Z", status: "ended", webinar_id: W_IA }),
      sessaoRow({ ended_at: "2026-10-20T14:00:00Z", id: S2, jit: false, kind: "live", scheduled_at: "2026-10-20T13:00:00Z", status: "ended", webinar_id: W_PAPO }),
      sessaoRow({ id: S3, jit: false, kind: "live", scheduled_at: "2026-10-25T23:00:00Z", status: "cancelled", webinar_id: W_IA }),
      sessaoRow({ ended_at: "2026-09-20T00:00:00Z", id: P1, jit: false, kind: "live", scheduled_at: "2026-09-19T23:00:00Z", status: "ended", webinar_id: W_IA }),
      sessaoRow({ ended_at: "2026-10-11T00:00:00Z", id: R1, jit: false, scheduled_at: "2026-10-10T23:00:00Z", status: "ended", webinar_id: W_GRAVADA }),
      sessaoRow({ ended_at: "2026-10-12T14:00:00Z", id: R2, jit: true, scheduled_at: "2026-10-12T13:00:00Z", status: "ended", webinar_id: W_GRAVADA })
    ],
    sessionsError: null,
    offersError: null,
    simulation: { simulated_count_rule: { base: 50, jitter: 0, mode: "fixed", peak: 0 }, simulated_joins: null, simulated_sale_notices: null, simulation_seed: 1, simulation_summary: { counter_max: 300, joins_shown: 4, sale_notices_shown: 1 } },
    webinars: [
      webinarRow({ host_user_id: HOST_ANA, id: W_IA, kind: "live", product_id: "prod-ia", slug: "aula-de-ia", title: "Aula de IA" }),
      webinarRow({ host_user_id: HOST_BETO, id: W_PAPO, kind: "live", product_id: null, registration_required: false, slug: "bate-papo", title: "Bate-papo" }),
      webinarRow({ host_user_id: HOST_ANA, id: W_GRAVADA, kind: "simulated", product_id: "prod-ia", slug: "live-de-agentes", title: "Live de agentes" })
    ],
    ...extra
  };

  const db = scriptedDb((query) => {
    if (query.op === "rpc" && query.table === "webinar_panel") {
      return state.panelError ? { data: null, error: state.panelError } : { data: state.panelCut ? postgrestCut(state.panelRows(query.args), query) : state.panelRows(query.args), error: null };
    }
    if (query.op === "rpc" && query.table === "webinar_report") {
      return { data: state.reportRows, error: null };
    }
    if (query.table === "webinar_sessions") {
      if (state.sessionsError) {
        return { data: null, error: state.sessionsError };
      }
      if (String(query.payload).includes("simulated_count_rule")) {
        const ids = filterOf(query, "in")?.[2] ?? [];
        return { data: ids.map((id) => ({ id, kind: "simulated", ...state.simulation })), error: null };
      }
      if (!filterOf(query, "range")) {
        const kind = filterOf(query, "eq")?.[2];
        return { count: state.sessions.filter((session) => session.kind === kind).length, data: null, error: null };
      }
      return { data: aplicaFiltros(state.sessions, query.filters), error: null };
    }
    if (query.table === "webinars") {
      return { data: aplicaFiltros(state.webinars, query.filters), error: null };
    }
    if (query.table === "webinar_offers") {
      return state.offersError ? { data: null, error: state.offersError } : { data: aplicaFiltros(state.offers, query.filters.filter(([method]) => method !== "neq")), error: null };
    }
    if (query.table === "webinar_offer_variants") {
      return { data: aplicaFiltros(state.variants, query.filters), error: null };
    }
    if (query.table === "webinar_offer_displays") {
      return { data: aplicaFiltros(state.displays, query.filters), error: null };
    }
    if (query.table === "content_items") {
      return { data: aplicaFiltros(state.products, query.filters), error: null };
    }
    if (query.table === "profiles") {
      return { data: aplicaFiltros(state.profiles, query.filters), error: null };
    }
    return { data: [], error: null };
  });

  actionStubs.db = db;
  return { db, state };
}

/**
 * O PostgREST de verdade com uma RPC: aplica a ordem e o range pedidos e corta em max_rows = 1000 (supabase/config.toml)
 * sem erro; sem range, as 1000 primeiras na ordem em que a funcao devolveu.
 */
function postgrestCut(rows, query) {
  const orders = query.filters.filter(([method]) => method === "order");
  const sorted = [...rows].sort((a, b) => {
    for (const [, column, options] of orders) {
      const [x, y] = [a[column], b[column]];
      if (x === y) continue;
      if (x === null || x === undefined) return options?.nullsFirst ? -1 : 1;
      if (y === null || y === undefined) return options?.nullsFirst ? 1 : -1;
      return String(x) < String(y) ? -1 : 1;
    }
    return 0;
  });
  const range = filterOf(query, "range");
  const [from, to] = range ? [range[1], range[2]] : [0, rows.length - 1];
  return sorted.slice(from, Math.min(to + 1, from + 1000));
}

const resolved = period.resolveAdminPeriod(period.parseAdminPeriodParam("30d", new Date(NOW)), new Date(NOW));
const panelPeriod = { end: resolved.end, previous: resolved.previous, start: resolved.start };
const rpcCalls = (db, from = 0) => db.queries.slice(from).filter((query) => query.op === "rpc" && query.table === "webinar_panel");

function resetCache() {
  cache.calls.length = 0;
  cache.entries.clear();
  cache.keys.length = 0;
  cache.options.length = 0;
}

test("cache: a chave pelo minuto do relogio e o hash dos ids; a tag webinars; recorte vazio nem vai ao banco", async () => {
  resetCache();
  const { db } = banco();
  const input = { end: "2026-10-29T15:01:00.000Z", kind: "live", now: NOW, sessionIds: [S2, S1], start: "2026-09-30T03:00:00.000Z" };

  const first = await queries.cachedPanelRows(input);
  await queries.cachedPanelRows({ ...input, now: NOW + 40_000, sessionIds: [S1, S2] });
  assert.equal(rpcCalls(db).length, 1, "mesmo minuto e os mesmos ids (em outra ordem): uma RPC");
  await queries.cachedPanelRows({ ...input, now: NOW + 2 * MIN });
  assert.equal(rpcCalls(db).length, 2, "no minuto seguinte, outra");

  assert.deepEqual(cache.keys[0], ["webinars-panel", "v1", "live", "2026-09-30T03:00:00.000Z", "2026-10-29T15:01:00.000Z", queries.panelSessionIdsHash([S1, S2]), String(Math.floor(NOW / MIN))]);
  assert.deepEqual(cache.options[0], { revalidate: 60, tags: ["webinars"] });
  assert.deepEqual(rpcCalls(db)[0].args, { p_end: "2026-10-29T15:01:00.000Z", p_kind: "live", p_session_ids: [S1, S2], p_start: "2026-09-30T03:00:00.000Z" }, "os ids em ordem");
  assert.equal(queries.panelSessionIdsHash([S2, S1]), queries.panelSessionIdsHash([S1, S2]));
  assert.notEqual(queries.panelSessionIdsHash([S1]), queries.panelSessionIdsHash([S1, S2]));
  assert.equal(queries.panelSessionIdsHash(null), "all");
  assert.equal(queries.panelCacheMinute(NOW), Math.floor(NOW / MIN));

  // So agregados no cache (M9): bigint como numero, nada de nome nem e-mail.
  assert.equal(first.find((entry) => entry.metric === "unique_present").total, 7);
  assert.doesNotMatch(JSON.stringify([...cache.entries.values()]), /full_name|email|Equipe|Formação/);

  const before = db.queries.length;
  assert.deepEqual(await queries.cachedPanelRows({ ...input, sessionIds: [] }), []);
  assert.equal(db.queries.length, before, "recorte vazio: nenhuma leitura");
});

test("webinar_panel com mais de 1000 linhas: a leitura pagina em ordem total e nada some (os unicos do periodo e a ultima sessao)", async () => {
  resetCache();
  // 45 sessoes x 30 linhas + os unicos no fim do union (como a funcao devolve): 1350 + 3 linhas.
  const ids = Array.from({ length: 45 }, (_, index) => `cccccccc-1000-4000-8000-${String(index).padStart(12, "0")}`);
  const metrics = ["duration", "registered", "present", "watch_sum", "watch_max", "reached_end", "peak", "messages", "reactions"];
  const big = () => [
    ...ids.flatMap((id) => [
      ...metrics.map((metric) => ({ item: metric === "peak" ? "3" : "", metric, session_id: id, students: 2, total: metric === "duration" ? 3_600_000 : 2 })),
      ...Array.from({ length: 21 }, (_, step) => ({ item: String(step * 5), metric: "retention", session_id: id, students: 2, total: 2 }))
    ]),
    { item: "", metric: "unique_present", session_id: null, students: 77, total: 77 },
    { item: "", metric: "unique_reached_end", session_id: null, students: 12, total: 12 },
    { item: "", metric: "unique_visitors", session_id: null, students: 90, total: 90 }
  ];
  const { db } = banco({ panelCut: true, panelRows: big });
  const rows = await queries.cachedPanelRows({ end: "2026-10-29T15:01:00.000Z", kind: "simulated", now: NOW, sessionIds: ids, start: "2026-09-30T03:00:00.000Z" });

  assert.equal(rows.length, big().length, "todas as linhas, nenhuma cortada");
  assert.equal(rows.find((entry) => entry.metric === "unique_present")?.total, 77, "os unicos (session_id nulo) nao caem fora");
  assert.equal(rows.find((entry) => entry.metric === "unique_visitors")?.total, 90);
  const last = ids.at(-1);
  assert.equal(rows.filter((entry) => entry.sessionId === last).length, 30, "a ultima sessao inteira");
  const calls = rpcCalls(db);
  assert.equal(calls.length, 2, "duas paginas de 1000");
  for (const call of calls) {
    assert.deepEqual(
      call.filters.filter(([method]) => method === "order").map(([, column, options]) => [column, options?.nullsFirst ?? false]),
      [["session_id", true], ["metric", false], ["item", false]],
      "uma ordem total e estavel (sem ela as paginas repetem ou pulam linhas)"
    );
  }
  assert.deepEqual(calls.map((call) => filterOf(call, "range").slice(1)), [[0, 999], [1000, 1999]]);
});

test("Lives ao vivo: as canceladas saem do recorte (ids na RPC), o periodo anterior na janela previous, nomes fora do cache", async () => {
  resetCache();
  const { db } = banco();
  const result = await queries.loadWebinarPanel(db, { filters: model.emptyPanelFilters(), kind: "live", now: NOW, period: panelPeriod, sessionId: null });

  assert.equal(result.status, "ok");
  const calls = rpcCalls(db);
  assert.equal(calls.length, 2, "o periodo e o anterior");
  const current = calls.find((call) => call.args.p_start === model.panelWindowOf(resolved).start);
  const previous = calls.find((call) => call.args.p_start === model.panelWindowOf(resolved.previous).start);
  assert.deepEqual(current.args.p_session_ids, [S1, S2], "S3 cancelada fica fora: a lista vai na RPC");
  assert.equal(current.args.p_end, model.panelWindowOf(resolved).end);
  assert.equal(previous.args.p_session_ids, null, "no anterior o recorte e o periodo inteiro (P1)");
  assert.equal(previous.args.p_end, model.panelWindowOf(resolved.previous).end);

  const sessionQuery = db.queries.find((query) => query.table === "webinar_sessions" && filterOf(query, "range"));
  assert.deepEqual(filterOf(sessionQuery, "in"), ["in", "kind", ["live"]]);
  assert.ok(sessionQuery.filters.some(([method, column]) => method === "gte" && column === "scheduled_at"));

  const view = result.view;
  assert.equal(view.kpis.find((kpi) => kpi.id === "present").value, 7);
  assert.equal(view.kpis.find((kpi) => kpi.id === "registered").value, 10);
  assert.equal(view.kpis.find((kpi) => kpi.id === "realized").delta, 100, "2 lives contra 1 no periodo anterior");
  assert.deepEqual(view.filterOptions.hosts.map((option) => option.label), ["Ana Equipe", "Beto Equipe"]);
  assert.deepEqual(view.filterOptions.products, [{ id: "prod-ia", label: "Formação em IA" }]);
  assert.deepEqual(view.exportWindow, model.panelWindowOf(resolved));

  // Nomes: so produtos e a equipe que apresenta (os hosts), nunca os alunos.
  const profileQuery = db.queries.find((query) => query.table === "profiles");
  assert.deepEqual(filterOf(profileQuery, "in")[2].sort(), [HOST_ANA, HOST_BETO].sort());
  assert.equal(profileQuery.payload, "id,full_name");
  assert.ok(!db.queries.some((query) => query.table === "profiles" && String(query.payload).includes("email")));
});

test("filtros da aba viram p_session_ids e os unicos do topo seguem o recorte", async () => {
  resetCache();
  const { db } = banco();
  const filters = model.readPanelFilters("live", { apresentador: HOST_BETO });
  const result = await queries.loadWebinarPanel(db, { filters, kind: "live", now: NOW, period: panelPeriod, sessionId: null });

  assert.equal(result.status, "ok");
  assert.deepEqual(rpcCalls(db)[0].args.p_session_ids, [S2]);
  assert.equal(result.view.hasFilters, true);
  assert.deepEqual(result.view.filterParams, { apresentador: HOST_BETO });
  assert.equal(result.view.table.total, 1);

  resetCache();
  const none = banco();
  const empty = await queries.loadWebinarPanel(none.db, { filters: model.readPanelFilters("live", { produto: "nao-existe" }), kind: "live", now: NOW, period: panelPeriod, sessionId: null });
  assert.equal(empty.view.empty, "filtered");
  assert.equal(rpcCalls(none.db).filter((call) => call.args.p_start === model.panelWindowOf(resolved).start).length, 0, "recorte vazio: sem RPC do periodo");
});

test("Lives gravadas: Com oferta e Variante pela Oferta do webinario e a foto da sessao; Simulacao so no bloco", async () => {
  resetCache();
  const { db } = banco();
  const filters = model.readPanelFilters("simulated", { "com-oferta": "sim", hora: "20" });
  const result = await queries.loadWebinarPanel(db, { filters, kind: "simulated", now: NOW, period: panelPeriod, sessionId: R1 });

  assert.equal(result.status, "ok");
  assert.deepEqual(rpcCalls(db)[0].args.p_session_ids, [R1], "20h em Sao Paulo com Oferta: so R1");
  assert.equal(result.view.offersAvailable, true);
  assert.deepEqual(result.view.presence.offerWindow, { hideOffsetMs: 1_500_000, showOffsetMs: 900_000, variants: [] });
  assert.deepEqual(result.view.filterOptions.variants, ["A", "B"]);
  assert.equal(result.view.simulation.available, true);
  assert.deepEqual(result.view.simulation.rules, ["Real + 50"]);
  const simulationQuery = db.queries.find((query) => query.table === "webinar_sessions" && String(query.payload).includes("simulated_count_rule"));
  assert.deepEqual(filterOf(simulationQuery, "in")[2], [R1], "as regras so das sessoes do recorte");
});

test("migracao pendente: sem webinar_panel o aviso da 202610300002; sem a coluna das sessoes o de WEBINARS_MIGRATION; sem a Oferta, '—' e o resto segue", async () => {
  resetCache();
  const noPanel = banco({ panelError: missing("webinar_panel") });
  assert.deepEqual(await queries.loadWebinarPanel(noPanel.db, { filters: model.emptyPanelFilters(), kind: "live", now: NOW, period: panelPeriod, sessionId: null }), {
    migration: WEBINARS_PANELS_MIGRATION,
    status: "pending_migration"
  });
  assert.equal(WEBINARS_PANELS_MIGRATION, "202610300002");

  resetCache();
  const noSessions = banco({ sessionsError: { code: "42703", message: "column webinar_sessions.jit does not exist" } });
  assert.deepEqual(await queries.loadWebinarPanel(noSessions.db, { filters: model.emptyPanelFilters(), kind: "live", now: NOW, period: panelPeriod, sessionId: null }), {
    migration: WEBINARS_MIGRATION,
    status: "pending_migration"
  });

  resetCache();
  const noOffers = banco({ offersError: missingTable("webinar_offers") });
  const result = await queries.loadWebinarPanel(noOffers.db, { filters: model.emptyPanelFilters(), kind: "simulated", now: NOW, period: panelPeriod, sessionId: null });
  assert.equal(result.status, "ok");
  assert.equal(result.view.offersAvailable, false);
  assert.equal(result.view.kpis.find((kpi) => kpi.id === "offerSeen").value, null);
  assert.equal(result.view.kpis.find((kpi) => kpi.id === "revenue").text, "—");
  assert.equal(result.view.simulation.available, false);
  assert.ok(!noOffers.db.queries.some((query) => String(query.payload).includes("simulated_count_rule")), "sem a 202610300003, nem tenta ler a Simulacao");

  resetCache();
  const broken = banco({ panelError: { code: "XX000", message: "falhou" } });
  actionStubs.db = broken.db;
  assert.deepEqual(await queries.getWebinarPanel({ filters: model.emptyPanelFilters(), kind: "live", now: NOW, period: panelPeriod, sessionId: null }), { status: "error" });
});

test("sem nenhuma sessao no periodo: 'never' quando o tipo nunca teve sessao, 'period' quando teve", async () => {
  resetCache();
  const never = banco({ sessions: [] });
  const result = await queries.loadWebinarPanel(never.db, { filters: model.emptyPanelFilters(), kind: "live", now: NOW, period: panelPeriod, sessionId: null });
  assert.equal(result.view.empty, "never");

  resetCache();
  const old = banco({
    sessions: [sessaoRow({ ended_at: "2025-01-01T01:00:00Z", id: P1, jit: false, kind: "live", scheduled_at: "2025-01-01T00:00:00Z", status: "ended", webinar_id: W_IA })]
  });
  const quiet = await queries.loadWebinarPanel(old.db, { filters: model.emptyPanelFilters(), kind: "live", now: NOW, period: panelPeriod, sessionId: null });
  assert.equal(quiet.view.empty, "period");
});

test("numeros da lista: Compareceram e Assistiram o replay pela RPC 'all'; sem a 202610300002, '—'", async () => {
  resetCache();
  const { db } = banco();
  const numbers = await queries.getWebinarListNumbers(resolved, { now: NOW });
  assert.deepEqual(numbers, { attended: 7, replayViewers: 2 });
  assert.deepEqual(rpcCalls(db)[0].args, { p_end: model.panelWindowOf(resolved).end, p_kind: "all", p_session_ids: null, p_start: model.panelWindowOf(resolved).start });

  resetCache();
  banco({ panelError: missing("webinar_panel") });
  assert.deepEqual(await queries.getWebinarListNumbers(resolved, { now: NOW }), { attended: null, replayViewers: null });
});

test("curva da sessao escolhida: pela visao do relatorio (webinar_report), com a janela da oferta; sem sessao, vazio", async () => {
  resetCache();
  const { db } = banco();
  const curve = await queries.getPanelPresence({ durationMs: 1_800_000, offerWindow: { hideOffsetMs: null, showOffsetMs: 60_000, variants: [] }, sessionId: R1 }, { now: NOW, report: getWebinarReport });

  assert.equal(curve.status, "ok");
  assert.deepEqual(curve.chart.points.map((point) => [point.minute, point.n]), [
    [0, 3],
    [0.5, 2]
  ]);
  assert.deepEqual(curve.chart.offerWindow, { from: 1, to: 30 });
  assert.ok(db.queries.some((query) => query.op === "rpc" && query.table === "webinar_report" && query.args.p_session_id === R1));

  assert.deepEqual(await queries.getPanelPresence({ durationMs: 0, offerWindow: null, sessionId: null }, { report: getWebinarReport }), { status: "empty" });
  const pending = await queries.getPanelPresence({ durationMs: 0, offerWindow: null, sessionId: R1 }, { report: async () => ({ status: "pending_migration" }) });
  assert.deepEqual(pending, { status: "pending_migration" });
  void ALUNA;
});

test("muitas sessoes do Começa quando você entra: as leituras por id vao em partes de 150 (o endereco do PostgREST tem limite)", async () => {
  resetCache();
  const many = Array.from({ length: 160 }, (_, index) =>
    sessaoRow({
      ended_at: "2026-10-15T12:00:00Z",
      id: `9a9a9a9a-0000-4000-8000-${String(index).padStart(12, "0")}`,
      jit: true,
      scheduled_at: new Date(Date.parse("2026-10-15T11:00:00Z") + index * 15 * MIN).toISOString(),
      status: "ended",
      webinar_id: W_GRAVADA
    })
  );
  const { db } = banco({ sessions: many });
  const result = await queries.loadWebinarPanel(db, { filters: model.emptyPanelFilters(), kind: "simulated", now: NOW, period: panelPeriod, sessionId: null });

  assert.equal(result.status, "ok");
  const displayReads = db.queries.filter((query) => query.table === "webinar_offer_displays").map((query) => filterOf(query, "in")[2].length);
  assert.deepEqual(displayReads, [150, 10]);
  const simulationReads = db.queries.filter((query) => String(query.payload).includes("simulated_count_rule")).map((query) => filterOf(query, "in")[2].length);
  assert.deepEqual(simulationReads, [150, 10]);
  assert.equal(rpcCalls(db)[0].args.p_session_ids, null, "o periodo inteiro: a lista nao vai na RPC");
  assert.equal(result.view.table.total, 160);
  assert.ok(result.view.table.rows.every((entry) => entry.jit));
});

test("panel-queries nao importa report-queries (o CSV do painel usa resolvePanelSelection sem ciclo)", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../src/server/webinars/panel-queries.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import \{[^}]*\} from "\.\/report-queries";/m);
  assert.match(source, /^import type \{ WebinarReportResult \} from "\.\/report-queries";/m);
});

test("o recorte do CSV do painel e o mesmo da tela (resolvePanelSelection)", async () => {
  resetCache();
  const { db } = banco();
  const selection = await queries.resolvePanelSelection(db, { filters: model.readPanelFilters("live", { situacao: "realizadas" }), kind: "live", window: resolved });

  assert.deepEqual(selection.selected.map((session) => session.id), [S1, S2]);
  assert.deepEqual(selection.sessionIds, [S1, S2]);
  assert.deepEqual(selection.window, model.panelWindowOf(resolved));
  assert.equal(selection.offers.byWebinar.size, 0, "nenhuma Oferta nas lives ao vivo do periodo");
});
