import { randomUUID } from "node:crypto";

// O banco da Oferta para os testes sem banco (docs/18 §2.5; docs/30 §4.2 e a 202610290005): o mesmo desenho do banco
// falso de tests/webinarios-sala-rotas.test.mjs (tabelas como listas, os filtros do PostgREST que o app usa: eq, neq,
// in, is, not is/in, gt, gte, lt, lte, or, order, limit, range, maybeSingle/single, select com count/head; insert,
// upsert por onConflict, update e delete; 23505 nas chaves unicas) com as tabelas da Oferta (webinar_offers,
// webinar_offer_variants, webinar_offer_displays com a chave (session_id, offer_id), webinar_offer_clicks com o
// click_token unico) e a escola de mentira: uma Live gravada publicada para todos, com a sessao gravada, a live de
// origem, o replay, a gravacao da Bunny de 60 min e um outro webinario. O relogio das linhas novas e controlado pelo
// teste (relogio.agora). Nada aqui e importado por src/.

export const MIN = 60_000;
export const HOUR = 60 * MIN;

export const WEBINAR = "cccccccc-0000-4000-8000-0000000000b1";
export const SESSION = "cccccccc-0000-4000-8000-0000000000b2";
export const LIVE_SESSION = "cccccccc-0000-4000-8000-0000000000b3";
export const REPLAY = "cccccccc-0000-4000-8000-0000000000b4";
export const OTHER_WEBINAR = "cccccccc-0000-4000-8000-0000000000b5";
export const OTHER_SESSION = "cccccccc-0000-4000-8000-0000000000b6";
export const RECORDING = "cccccccc-0000-4000-8000-0000000000b7";
export const OFFER = "dddddddd-0000-4000-8000-0000000000c1";
export const OTHER_OFFER = "dddddddd-0000-4000-8000-0000000000c2";
export const PRODUCT = "formacao-agentes";

export const iso = (time) => new Date(time).toISOString();

/** O relogio das linhas novas (created_at, clicked_at, shown_at): o teste adianta para a janela de 10 s do clique. */
export const relogio = { agora: () => Date.now() };

const UNIQUE = {
  webinar_chat_consents: [["user_id"]],
  webinar_offer_clicks: [["click_token"]],
  webinar_offer_displays: [["session_id", "offer_id"]],
  webinar_offer_variants: [["offer_id", "label"]],
  webinar_presence_samples: [["session_id", "user_id", "bucket"]]
};
const NO_ID = new Set(["webinar_chat_consents", "webinar_presence_samples"]);

function defaultsOf(table, now) {
  switch (table) {
    case "student_events":
      return { entity_id: null, entity_type: null, metadata: {} };
    case "webinar_offers":
      return { attribution_days: 7, created_by: null, deadline_minutes: null, show_at_offset_ms: null, status: "draft", title: "", trigger_kind: "at_offset", visible_minutes: null };
    case "webinar_offer_variants":
      return { badge: null, coupon: null, enabled: true, image_url: null, price_from_label: null, price_label: null, weight: 1 };
    case "webinar_offer_displays":
      return { deadline_at: null, hidden_at: null, hidden_by: null, hide_offset_ms: null, shown_at: now, shown_by: null, snapshot: {} };
    case "webinar_offer_clicks":
      return { clicked_at: now, converted_at: null, converted_sale_grant_id: null, variant_id: null };
    default:
      return {};
  }
}

function literal(text) {
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  return text.replace(/^"(.*)"$/, "$1");
}

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function matches(row, filter) {
  const [op, column, value, extra] = filter;
  const current = row[column];
  switch (op) {
    case "eq":
      return current === value;
    case "neq":
      return current !== value;
    case "in":
      return value.includes(current);
    case "is":
      return value === null ? current === null || current === undefined : current === value;
    case "not":
      if (value === "is") return extra === null ? current !== null && current !== undefined : current !== extra;
      if (value === "in") return !String(extra).replace(/^\(|\)$/g, "").split(",").map(literal).includes(current);
      if (value === "eq") return current !== extra;
      return true;
    case "gte":
      return compare(current, value) >= 0;
    case "gt":
      return compare(current, value) > 0;
    case "lte":
      return compare(current, value) <= 0;
    case "lt":
      return compare(current, value) < 0;
    case "or":
      return column.split(",").some((part) => {
        const [col, operator, ...rest] = part.split(".");
        return matches(row, [operator, col, literal(rest.join("."))]);
      });
    default:
      return true;
  }
}

/** O banco em memoria: `tables` muda no lugar; `calls.writes` anota cada escrita; `rpc` sao funcoes (args, tables). */
export function bancoDaOferta({ rpc = {}, tables = {} } = {}) {
  const calls = { from: [], rpc: [], writes: [] };
  const table = (name) => (tables[name] ??= []);

  function violates(name, row) {
    return (UNIQUE[name] ?? []).some((keys) => table(name).some((existing) => existing !== row && keys.every((key) => existing[key] === row[key])));
  }

  function query(name) {
    const state = { count: null, filters: [], head: false, limit: null, op: null, order: [], payload: null, range: null, single: null, upsertKeys: null };

    function stamp(row) {
      const now = iso(relogio.agora());
      const base = { ...defaultsOf(name, now) };
      if (!NO_ID.has(name)) base.id = randomUUID();
      return { ...base, created_at: now, updated_at: now, ...structuredClone(row) };
    }

    function finish(rows) {
      if (state.head) return { count: rows.length, data: null, error: null };
      if (state.single === "single") return rows[0] ? { data: structuredClone(rows[0]), error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
      if (state.single === "maybe") return { data: rows[0] ? structuredClone(rows[0]) : null, error: null };
      return { count: state.count ? rows.length : null, data: structuredClone(rows), error: null };
    }

    function run() {
      const rows = table(name);
      const filtered = () => rows.filter((row) => state.filters.every((filter) => matches(row, filter)));

      if (state.op === "insert" || state.op === "upsert") {
        const payloads = Array.isArray(state.payload) ? state.payload : [state.payload];
        const touched = [];
        for (const payload of payloads) {
          const existing = state.op === "upsert" ? rows.find((row) => state.upsertKeys.every((key) => row[key] === payload[key])) : null;
          if (existing) {
            Object.assign(existing, structuredClone(payload), { updated_at: iso(relogio.agora()) });
            touched.push(existing);
            continue;
          }
          const row = stamp(payload);
          if (violates(name, row)) {
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint (${name})` } };
          }
          rows.push(row);
          touched.push(row);
        }
        calls.writes.push({ op: state.op, payload: state.payload, table: name });
        return finish(touched);
      }
      if (state.op === "update") {
        const touched = filtered();
        touched.forEach((row) => Object.assign(row, structuredClone(state.payload), { updated_at: iso(relogio.agora()) }));
        calls.writes.push({ filters: state.filters, op: "update", payload: state.payload, table: name });
        return finish(touched);
      }
      if (state.op === "delete") {
        const removed = filtered();
        tables[name] = rows.filter((row) => !removed.includes(row));
        calls.writes.push({ filters: state.filters, op: "delete", table: name });
        return finish(removed);
      }
      let result = filtered();
      for (const [column, ascending] of [...state.order].reverse()) {
        result = [...result].sort((a, b) => (ascending ? compare(a[column], b[column]) : compare(b[column], a[column])));
      }
      if (state.range) result = result.slice(state.range[0], state.range[1] + 1);
      if (state.limit !== null) result = result.slice(0, state.limit);
      return finish(result);
    }

    const filter = (op) => (column, value) => {
      state.filters.push([op, column, value]);
      return chain;
    };
    const chain = {
      delete: () => ((state.op = "delete"), chain),
      eq: filter("eq"),
      gt: filter("gt"),
      gte: filter("gte"),
      in: filter("in"),
      insert: (payload) => ((state.op = "insert"), (state.payload = payload), chain),
      is: filter("is"),
      limit: (value) => ((state.limit = value), chain),
      lt: filter("lt"),
      lte: filter("lte"),
      maybeSingle: () => ((state.single = "maybe"), chain),
      neq: filter("neq"),
      not: (column, operator, value) => (state.filters.push(["not", column, operator, value]), chain),
      or: (expression) => (state.filters.push(["or", expression, null]), chain),
      order: (column, options) => (state.order.push([column, options?.ascending !== false]), chain),
      range: (from, to) => ((state.range = [from, to]), chain),
      select: (_columns, options) => {
        state.op ??= "select";
        if (options?.count) state.count = options.count;
        if (options?.head) state.head = true;
        return chain;
      },
      single: () => ((state.single = "single"), chain),
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
      update: (payload) => ((state.op = "update"), (state.payload = payload), chain),
      upsert: (payload, options) => ((state.op = "upsert"), (state.payload = payload), (state.upsertKeys = (options?.onConflict ?? "id").split(",")), chain)
    };
    return chain;
  }

  return {
    calls,
    from(name) {
      calls.from.push(name);
      return query(name);
    },
    rpc(name, args) {
      calls.rpc.push({ args, name });
      return { then: (resolve, reject) => Promise.resolve().then(() => (rpc[name] ? rpc[name](args, tables) : { data: null, error: null })).then(resolve, reject) };
    },
    tables
  };
}

/** Um banco em que as tabelas da Oferta ainda nao existem (a 202610290005 pendente): 42P01 em qualquer leitura delas. */
export function semAsTabelasDaOferta(db) {
  const from = db.from.bind(db);
  db.from = (name) => {
    if (name.startsWith("webinar_offer")) {
      const erro = { data: null, error: { code: "42P01", message: `relation "public.${name}" does not exist` } };
      const chain = new Proxy({}, { get: (_target, property) => (property === "then" ? (resolve) => resolve(erro) : () => chain) });
      return chain;
    }
    return from(name);
  };
  return db;
}

/* ------------------------------------------------------------------------------------------------
 * A escola de mentira
 * ---------------------------------------------------------------------------------------------- */

export function variantRow(label, extra = {}) {
  return {
    badge: `Selo ${label}`,
    checkout_url: `https://pay.hotmart.com/${label}?off=lancamento`,
    coupon: label === "A" ? "B707" : null,
    created_at: iso(Date.now() - HOUR),
    enabled: true,
    headline: `Formação em Agentes ${label}`,
    id: `eeeeeeee-0000-4000-8000-00000000000${"ABCD".indexOf(label) + 1}`,
    image_url: null,
    label,
    offer_id: OFFER,
    price_from_label: "R$ 1.997",
    price_label: "R$ 997",
    updated_at: iso(Date.now() - HOUR),
    weight: 1,
    ...extra
  };
}

export function offerRow(extra = {}) {
  return {
    attribution_days: 7,
    created_at: iso(Date.now() - HOUR),
    created_by: null,
    deadline_minutes: null,
    id: OFFER,
    product_id: PRODUCT,
    show_at_offset_ms: 5 * MIN,
    status: "active",
    title: "Oferta da live",
    trigger_kind: "at_offset",
    updated_at: iso(Date.now() - HOUR),
    visible_minutes: 20,
    webinar_id: WEBINAR,
    ...extra
  };
}

/**
 * As tabelas da escola: a sessao gravada no ar ha `minutosNoAr` minutos (hora marcada = agora - minutosNoAr), a live
 * de origem encerrada, o replay e a sessao de outro webinario; a oferta e as variantes A e B quando `oferta` nao e
 * false (as linhas podem ser trocadas por `variantes`).
 */
export function escolaDaOferta({ duracaoSegundos = 3600, minutosNoAr = 10, oferta = {}, sessao = {}, variantes = null, webinar = {} } = {}) {
  const now = Date.now();
  const webinarRow = (id, extra = {}) => ({
    access_mode: "everyone",
    allow_student_camera: true,
    audience: { kind: "everyone" },
    auto_record: true,
    cancel_reason: null,
    cancelled_at: null,
    capacity: null,
    chat_retention_days: 730,
    cover_url: null,
    created_at: iso(now - HOUR),
    created_by: null,
    deleted_at: null,
    description: "",
    duration_minutes: 60,
    host_user_id: null,
    id,
    kind: "simulated",
    product_id: null,
    published_at: iso(now - HOUR),
    quality: {},
    recording_retention_days: 730,
    registration_required: false,
    reminder_texts: {},
    reminders: {},
    replay_days_on_home: 7,
    replay_lesson_target: null,
    room_settings: { anonymousQuestions: true, chatMode: "open", displayName: "first_name_initial" },
    scheduled_at: null,
    show_banner: true,
    show_on_home: true,
    show_registered_count: false,
    slug: id === WEBINAR ? "live-de-agentes" : "outra-live",
    status: "published",
    title: id === WEBINAR ? "Live de agentes" : "Outra live",
    updated_at: iso(now - HOUR),
    ...extra
  });
  const sessionRow = (id, extra = {}) => ({
    chat_mode: "open",
    chat_slow_mode_seconds: null,
    created_at: iso(now - HOUR),
    ended_at: null,
    id,
    jit: false,
    kind: "simulated",
    late_join_minutes: null,
    pinned_message_id: null,
    presence_curve: null,
    recording_anchor_at: null,
    recording_id: RECORDING,
    scheduled_at: iso(now - minutosNoAr * MIN),
    script_fired_at: null,
    show_live_badge: false,
    simulation_ack_text: null,
    simulation_decided_at: null,
    simulation_decided_by: null,
    source_session_id: LIVE_SESSION,
    started_at: null,
    status: "live",
    updated_at: iso(now - HOUR),
    webinar_id: WEBINAR,
    ...extra
  });
  return {
    admin_audit_log: [],
    admin_roles: [],
    entitlements: [],
    profiles: [],
    sale_grants: [],
    student_events: [],
    webinar_offer_clicks: [],
    webinar_offer_displays: [],
    webinar_offer_variants: oferta === false ? [] : (variantes ?? [variantRow("A"), variantRow("B")]),
    webinar_offers: oferta === false ? [] : [offerRow(oferta)],
    webinar_recordings: [
      {
        anchor_offset_ms: 0,
        bunny_library_id: "12345",
        bunny_video_id: "0b1c2d3e-aaaa-4bbb-8ccc-123456789abc",
        created_at: iso(now - HOUR),
        duration_seconds: duracaoSegundos,
        embed_url: "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc",
        error_message: null,
        file_name: null,
        id: RECORDING,
        provider: "bunny",
        purge_due_at: null,
        session_id: LIVE_SESSION,
        sha256: null,
        size_bytes: null,
        source: "upload",
        status: "ready",
        updated_at: iso(now - HOUR),
        webinar_id: WEBINAR
      }
    ],
    webinar_registrations: [],
    webinar_sessions: [
      sessionRow(SESSION, sessao),
      sessionRow(LIVE_SESSION, { kind: "live", recording_anchor_at: iso(now - 30 * 24 * HOUR), scheduled_at: iso(now - 30 * 24 * HOUR), source_session_id: null, status: "ended" }),
      sessionRow(REPLAY, { kind: "replay", scheduled_at: iso(now - 29 * 24 * HOUR), status: "ended" }),
      sessionRow(OTHER_SESSION, { webinar_id: OTHER_WEBINAR })
    ],
    webinar_user_bans: [],
    webinars: [webinarRow(WEBINAR, webinar), webinarRow(OTHER_WEBINAR)]
  };
}
