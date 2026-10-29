import { randomUUID } from "node:crypto";

// O banco do "Comeca quando voce entra" para os testes sem banco (docs/18 §2.5; docs/30 §1.6 e a 202610300005):
// tabelas como listas e os filtros do PostgREST que o app usa (eq, neq, in, is, gt, gte, lt, lte, or, order, limit,
// range, not, like, maybeSingle/single; insert, upsert, update e delete), cada consulta anotada em `calls`. Como o banco de
// verdade:
// - o indice unico webinar_sessions_jit_slot_idx: duas sessoes `jit` do mesmo webinario no mesmo instante respondem
//   23505 (o app le a que ja existe);
// - as datas voltam no formato do PostgREST ("+00:00" no lugar do "Z") e o eq/gte/lt comparam instantes, nunca o texto;
// - o check webinar_sessions_jit_simulated_v4 (jit so em `simulated`).
// A escola: uma Live gravada publicada para todos com a gravacao base da Bunny (60 min) e o just-in-time ligado (a cada
// 15 min, das 08:00 as 23:00), uma Live ao vivo e um webinario so de quem tem um produto. Nada aqui e importado por src/.

export const MIN = 60_000;
export const HOUR = 60 * MIN;

export const WEBINAR = "abababab-0000-4000-8000-0000000000e1";
export const LIVE_WEBINAR = "abababab-0000-4000-8000-0000000000e2";
export const PRODUCT_WEBINAR = "abababab-0000-4000-8000-0000000000e3";
export const RECORDING = "abababab-0000-4000-8000-0000000000e4";
export const SCHEDULED_SESSION = "abababab-0000-4000-8000-0000000000e5";
export const PRODUCT = "abababab-0000-4000-8000-0000000000e6";

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** O instante no formato que o PostgREST devolve (timestamptz com "+00:00"). */
export const pgIso = (value) => new Date(value).toISOString().replace("Z", "+00:00");

function sameValue(a, b) {
  if (a === b) return true;
  if (typeof a === "string" && typeof b === "string" && ISO_LIKE.test(a) && ISO_LIKE.test(b)) {
    return Date.parse(a) === Date.parse(b);
  }
  return false;
}

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string" && ISO_LIKE.test(a) && ISO_LIKE.test(b)) return Date.parse(a) - Date.parse(b);
  return String(a).localeCompare(String(b));
}

function literal(text) {
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

function matches(row, filter) {
  const [op, column, value, extra] = filter;
  const current = row[column];
  switch (op) {
    case "not":
      if (value === "is") return extra === null ? current !== null && current !== undefined : current !== extra;
      if (value === "eq") return !sameValue(current, extra);
      if (value === "in") return !String(extra).replace(/^\(|\)$/g, "").split(",").map(literal).includes(current);
      return true;
    case "like": {
      const pattern = new RegExp(`^${String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`);
      return typeof current === "string" && pattern.test(current);
    }
    case "eq":
      return sameValue(current, value);
    case "neq":
      return !sameValue(current, value);
    case "in":
      return value.some((item) => sameValue(current, item));
    case "is":
      return value === null ? current === null || current === undefined : current === value;
    case "gte":
      return current != null && compare(current, value) >= 0;
    case "gt":
      return current != null && compare(current, value) > 0;
    case "lte":
      return current != null && compare(current, value) <= 0;
    case "lt":
      return current != null && compare(current, value) < 0;
    case "or":
      return column.split(",").some((part) => {
        const [col, operator, ...rest] = part.split(".");
        return matches(row, [operator, col, literal(rest.join("."))]);
      });
    default:
      return true;
  }
}

const TIMESTAMP_COLUMNS = ["scheduled_at", "started_at", "ended_at", "created_at", "updated_at", "simulation_decided_at"];

function asPgRow(row) {
  const out = { ...row };
  for (const column of TIMESTAMP_COLUMNS) {
    if (typeof out[column] === "string" && ISO_LIKE.test(out[column])) {
      out[column] = pgIso(out[column]);
    }
  }
  return out;
}

/** O banco em memoria: `tables` muda no lugar; `calls` anota cada consulta; `rpc` sao funcoes (args, tables). */
export function bancoDoJit({ rpc = {}, tables = {} } = {}) {
  const calls = { from: [], queries: [], rpc: [], writes: [] };
  const table = (name) => (tables[name] ??= []);

  function query(name) {
    const state = { columns: null, filters: [], limit: null, op: null, order: [], payload: null, range: null, single: null };

    function finish(rows) {
      if (state.single === "single") return rows[0] ? { data: structuredClone(rows[0]), error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
      if (state.single === "maybe") return { data: rows[0] ? structuredClone(rows[0]) : null, error: null };
      return { data: structuredClone(rows), error: null };
    }

    function violatesJitSlot(row) {
      if (name !== "webinar_sessions" || row.jit !== true) return null;
      if (row.kind !== "simulated") return { code: "23514", message: 'new row violates check constraint "webinar_sessions_jit_simulated_v4"' };
      const clash = table(name).some((other) => other.jit === true && other.webinar_id === row.webinar_id && sameValue(other.scheduled_at, row.scheduled_at));
      return clash ? { code: "23505", message: 'duplicate key value violates unique constraint "webinar_sessions_jit_slot_idx"' } : null;
    }

    function run() {
      calls.queries.push({ columns: state.columns, filters: state.filters, op: state.op ?? "select", payload: state.payload, table: name });
      const rows = table(name);
      const filtered = () => rows.filter((row) => state.filters.every((filter) => matches(row, filter)));
      const now = pgIso(Date.now());

      if (state.op === "insert" || state.op === "upsert") {
        const payloads = Array.isArray(state.payload) ? state.payload : [state.payload];
        const touched = [];
        for (const payload of payloads) {
          const row = asPgRow({ id: randomUUID(), created_at: now, updated_at: now, ...(name === "webinar_sessions" ? { jit: false } : {}), ...structuredClone(payload) });
          const violation = violatesJitSlot(row);
          if (violation) {
            calls.writes.push({ error: violation.code, op: state.op, payload: state.payload, table: name });
            return { data: null, error: violation };
          }
          rows.push(row);
          touched.push(row);
        }
        calls.writes.push({ op: state.op, payload: state.payload, table: name });
        return finish(touched);
      }
      if (state.op === "update") {
        const touched = filtered();
        touched.forEach((row) => Object.assign(row, asPgRow(structuredClone(state.payload)), { updated_at: now }));
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
      like: filter("like"),
      limit: (value) => ((state.limit = value), chain),
      lt: filter("lt"),
      lte: filter("lte"),
      maybeSingle: () => ((state.single = "maybe"), chain),
      neq: filter("neq"),
      not: (column, operator, value) => (state.filters.push(["not", column, operator, value]), chain),
      or: (expression) => (state.filters.push(["or", expression, null]), chain),
      order: (column, options) => (state.order.push([column, options?.ascending !== false]), chain),
      range: (from, to) => ((state.range = [from, to]), chain),
      select: (columns) => {
        state.op ??= "select";
        state.columns = columns ?? "*";
        return chain;
      },
      single: () => ((state.single = "single"), chain),
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
      update: (payload) => ((state.op = "update"), (state.payload = payload), chain),
      upsert: (payload) => ((state.op = "upsert"), (state.payload = payload), chain)
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

/* ------------------------------------------------------------------------------------------------
 * A escola de mentira
 * ---------------------------------------------------------------------------------------------- */

export const JIT_ON = { enabled: true, endHour: 23, everyMinutes: 15, lateJoinMinutes: null, simulation: null, startHour: 8 };

export function webinarRow(id = WEBINAR, extra = {}) {
  const now = Date.now();
  return {
    access_mode: "everyone",
    allow_student_camera: true,
    assistant_settings: {},
    audience: { kind: "everyone" },
    auto_record: true,
    cancel_reason: null,
    cancelled_at: null,
    capacity: null,
    chat_retention_days: 730,
    cover_url: null,
    created_at: pgIso(now - 24 * HOUR),
    created_by: null,
    deleted_at: null,
    description: "Agentes de IA na prática.",
    duration_minutes: 60,
    host_user_id: null,
    id,
    jit_settings: id === WEBINAR ? JIT_ON : {},
    kind: id === LIVE_WEBINAR ? "live" : "simulated",
    product_id: id === PRODUCT_WEBINAR ? PRODUCT : null,
    published_at: pgIso(now - 24 * HOUR),
    quality: {},
    recording_retention_days: 730,
    registration_required: true,
    reminder_texts: {},
    reminders: { email: true, h1: true, h24: true },
    replay_days_on_home: 7,
    replay_lesson_target: null,
    room_settings: { anonymousQuestions: true, chatMode: "moderated", displayName: "first_name_initial", slowModeSeconds: 20 },
    scheduled_at: null,
    show_banner: true,
    show_on_home: true,
    show_registered_count: false,
    slug: id === WEBINAR ? "agentes-quando-voce-entra" : id === LIVE_WEBINAR ? "live-de-sexta" : "live-do-produto",
    status: "published",
    title: id === WEBINAR ? "Agentes quando você entra" : id === LIVE_WEBINAR ? "Live de sexta" : "Live do produto",
    updated_at: pgIso(now - HOUR),
    ...extra
  };
}

export function recordingRow(extra = {}) {
  const now = Date.now();
  return {
    anchor_offset_ms: 0,
    bunny_library_id: "12345",
    bunny_video_id: "0b1c2d3e-aaaa-4bbb-8ccc-123456789abc",
    created_at: pgIso(now - 24 * HOUR),
    duration_seconds: 3600,
    embed_url: "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc",
    error_message: null,
    file_name: null,
    id: RECORDING,
    provider: "bunny",
    purge_due_at: null,
    session_id: null,
    sha256: null,
    size_bytes: null,
    source: "bunny",
    status: "ready",
    updated_at: pgIso(now - 24 * HOUR),
    webinar_id: WEBINAR,
    ...extra
  };
}

export function sessionRow(id, extra = {}) {
  const now = Date.now();
  return {
    browser_recording_at: null,
    chat_mode: "open",
    chat_slow_mode_seconds: null,
    created_at: pgIso(now - HOUR),
    ended_at: null,
    id,
    jit: false,
    kind: "simulated",
    late_join_minutes: null,
    pinned_message_id: null,
    presence_curve: null,
    recorder_alerted_at: null,
    recorder_release_requested_at: null,
    recorder_requested_at: null,
    recorder_status: "none",
    recording_anchor_at: null,
    recording_id: RECORDING,
    recording_requested_at: null,
    room_locked: false,
    room_name: null,
    scheduled_at: pgIso(now + 3 * 24 * HOUR),
    script_fired_at: null,
    show_live_badge: false,
    simulated_count_rule: null,
    simulated_joins: null,
    simulated_sale_notices: null,
    simulation_ack_text: null,
    simulation_decided_at: null,
    simulation_decided_by: null,
    simulation_seed: 1234,
    simulation_summary: null,
    source_session_id: null,
    started_at: null,
    status: "scheduled",
    updated_at: pgIso(now - HOUR),
    webinar_id: WEBINAR,
    ...extra
  };
}

/** As tabelas da escola: os tres webinarios, a gravacao base e uma sessao marcada da Live gravada daqui a 3 dias. */
export function escolaDoJit({ jit = JIT_ON, webinar = {} } = {}) {
  return {
    admin_audit_log: [],
    admin_roles: [],
    entitlements: [],
    profiles: [],
    student_events: [],
    webinar_assistant_knowledge: [],
    webinar_offer_variants: [],
    webinar_offers: [],
    webinar_presenters: [],
    webinar_recordings: [recordingRow()],
    webinar_registrations: [],
    webinar_sessions: [sessionRow(SCHEDULED_SESSION)],
    webinar_user_bans: [],
    webinars: [webinarRow(WEBINAR, { jit_settings: jit, ...webinar }), webinarRow(LIVE_WEBINAR), webinarRow(PRODUCT_WEBINAR, { access_mode: "product" })]
  };
}
