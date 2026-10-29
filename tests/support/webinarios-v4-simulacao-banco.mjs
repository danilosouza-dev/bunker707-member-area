import { randomUUID } from "node:crypto";

// O banco da Simulacao para os testes sem banco (docs/18 §2.5; docs/30 §4.3 e a 202610300003): tabelas como listas e
// os filtros do PostgREST que o app usa (eq, neq, in, is, not, gt, gte, lt, lte, or com "col.not.is.null", order,
// limit, range, maybeSingle/single; insert, upsert, update e delete), cada consulta anotada em `calls` (a tabela, a
// operacao, as colunas lidas e o que foi gravado). A escola de mentira: uma Live gravada publicada para todos, com a
// sessao gravada no ar (com as colunas simulated_*, simulation_summary e simulation_seed), a live de origem, o replay,
// uma sessao gravada encerrada, a gravacao da Bunny de 60 min e um outro webinario. `semAsColunasDaSimulacao` imita o
// banco sem a 202610300003 (42703 em qualquer leitura ou escrita das colunas novas). Nada aqui e importado por src/.

export const MIN = 60_000;
export const HOUR = 60 * MIN;

export const WEBINAR = "eeeeeeee-0000-4000-8000-0000000000a1";
export const SESSION = "eeeeeeee-0000-4000-8000-0000000000a2";
export const LIVE_SESSION = "eeeeeeee-0000-4000-8000-0000000000a3";
export const REPLAY = "eeeeeeee-0000-4000-8000-0000000000a4";
export const ENDED_SESSION = "eeeeeeee-0000-4000-8000-0000000000a5";
export const OTHER_WEBINAR = "eeeeeeee-0000-4000-8000-0000000000a6";
export const OTHER_SESSION = "eeeeeeee-0000-4000-8000-0000000000a7";
export const RECORDING = "eeeeeeee-0000-4000-8000-0000000000a8";

export const iso = (time) => new Date(time).toISOString();

const NEW_COLUMNS = /simulated_|simulation_seed|simulation_summary/;

function literal(text) {
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
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
      if (value === "eq") return current !== extra;
      if (value === "in") return !String(extra).replace(/^\(|\)$/g, "").split(",").map(literal).includes(current);
      return true;
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
        if (operator === "not") {
          const [inner, ...tail] = rest;
          return matches(row, ["not", col, inner, literal(tail.join("."))]);
        }
        return matches(row, [operator, col, literal(rest.join("."))]);
      });
    default:
      return true;
  }
}

/** O banco em memoria: `tables` muda no lugar; `calls` anota cada consulta; `rpc` sao funcoes (args, tables). */
export function bancoDaSimulacao({ rpc = {}, semColunas = false, tables = {} } = {}) {
  const calls = { from: [], queries: [], rpc: [], writes: [] };
  const table = (name) => (tables[name] ??= []);

  function query(name) {
    const state = { columns: null, filters: [], limit: null, op: null, order: [], payload: null, range: null, single: null };

    function finish(rows) {
      if (state.single === "single") return rows[0] ? { data: structuredClone(rows[0]), error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
      if (state.single === "maybe") return { data: rows[0] ? structuredClone(rows[0]) : null, error: null };
      return { data: structuredClone(rows), error: null };
    }

    function run() {
      calls.queries.push({ columns: state.columns, filters: state.filters, op: state.op ?? "select", payload: state.payload, table: name });
      const touchesNew = NEW_COLUMNS.test(state.columns ?? "") || (state.payload && NEW_COLUMNS.test(Object.keys(Array.isArray(state.payload) ? (state.payload[0] ?? {}) : state.payload).join(",")));
      if (semColunas && name === "webinar_sessions" && touchesNew) {
        return { data: null, error: { code: "42703", message: 'column webinar_sessions.simulated_count_rule does not exist' } };
      }
      const rows = table(name);
      const filtered = () => rows.filter((row) => state.filters.every((filter) => matches(row, filter)));
      const now = iso(Date.now());

      if (state.op === "insert" || state.op === "upsert") {
        const payloads = Array.isArray(state.payload) ? state.payload : [state.payload];
        const touched = payloads.map((payload) => {
          const row = { id: randomUUID(), created_at: now, ...structuredClone(payload) };
          rows.push(row);
          return row;
        });
        calls.writes.push({ op: state.op, payload: state.payload, table: name });
        return finish(touched);
      }
      if (state.op === "update") {
        const touched = filtered();
        touched.forEach((row) => Object.assign(row, structuredClone(state.payload), name === "job_runs" ? {} : { updated_at: now }));
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

/** O banco sem a 202610300003: 42703 em qualquer leitura ou escrita das colunas novas da Simulacao. */
export function semAsColunasDaSimulacao(options = {}) {
  return bancoDaSimulacao({ ...options, semColunas: true });
}

/* ------------------------------------------------------------------------------------------------
 * A escola de mentira
 * ---------------------------------------------------------------------------------------------- */

export const CONTADOR = { base: 40, jitter: 0, mode: "fixed", peak: 40 };
export const ENTRADAS = { enabled: true, every_seconds: 30, max: 50, names: "generic" };
export const AVISOS = { enabled: true, items: [{ offset_ms: 11 * MIN, text: "Carlos acabou de garantir a vaga na Formação" }] };
/** A decisao registrada da sessao (docs/30 §8.6, D10): sem ela, nada simulado aparece nem entra no resumo. */
export const DECISAO = {
  simulation_ack_text: "Decisão do produtor em 05/11/2026: nesta sessão gravada, dentro da área de membros, o selo \"Ao vivo\" fica desligado, os números de plateia são simulados e os avisos de venda são simulados. Fora da área de membros, esta sessão nunca é anunciada como ao vivo. Responsável: Produtor de Teste.",
  simulation_decided_at: "2026-11-05T12:00:00.000Z",
  simulation_decided_by: "00000000-0000-4000-8000-000000000001"
};

export function webinarRow(id = WEBINAR, extra = {}, now = Date.now()) {
  return {
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
  };
}

export function sessionRow(id, extra = {}, now = Date.now()) {
  return {
    browser_recording_at: null,
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
    recorder_alerted_at: null,
    recorder_release_requested_at: null,
    recorder_requested_at: null,
    recorder_status: "none",
    recording_anchor_at: null,
    recording_id: RECORDING,
    recording_requested_at: null,
    room_locked: false,
    room_name: null,
    scheduled_at: iso(now - 10 * MIN),
    script_fired_at: null,
    show_live_badge: false,
    simulated_count_rule: null,
    simulated_joins: null,
    simulated_sale_notices: null,
    simulation_ack_text: null,
    simulation_decided_at: null,
    simulation_decided_by: null,
    simulation_seed: 424242,
    simulation_summary: null,
    source_session_id: LIVE_SESSION,
    started_at: null,
    status: "live",
    updated_at: iso(now - HOUR),
    webinar_id: WEBINAR,
    ...extra
  };
}

export function recordingRow(extra = {}, now = Date.now()) {
  return {
    anchor_offset_ms: 0,
    bunny_library_id: "12345",
    bunny_video_id: "0b1c2d3e-aaaa-4bbb-8ccc-123456789abc",
    created_at: iso(now - HOUR),
    duration_seconds: 3600,
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
    webinar_id: WEBINAR,
    ...extra
  };
}

/**
 * As tabelas da escola: a sessao gravada no ar ha `minutosNoAr` minutos com as regras de `sessao` (padrao: nenhuma),
 * a live de origem encerrada, o replay, uma gravada encerrada ha 1 h e a sessao de outro webinario.
 */
export function escolaDaSimulacao({ duracaoSegundos = 3600, minutosNoAr = 10, sessao = {}, webinar = {} } = {}) {
  const now = Date.now();
  return {
    admin_audit_log: [],
    admin_roles: [],
    entitlements: [],
    job_runs: [],
    profiles: [],
    student_events: [],
    webinar_recordings: [recordingRow({ duration_seconds: duracaoSegundos }, now)],
    webinar_registrations: [],
    webinar_sessions: [
      sessionRow(SESSION, { scheduled_at: iso(now - minutosNoAr * MIN), ...sessao }, now),
      sessionRow(LIVE_SESSION, { kind: "live", recording_anchor_at: iso(now - 30 * 24 * HOUR), scheduled_at: iso(now - 30 * 24 * HOUR), simulation_seed: 7, source_session_id: null, status: "ended" }, now),
      sessionRow(REPLAY, { kind: "replay", scheduled_at: iso(now - 29 * 24 * HOUR), status: "live" }, now),
      sessionRow(ENDED_SESSION, { ended_at: iso(now - HOUR), scheduled_at: iso(now - 2 * HOUR), status: "ended" }, now),
      sessionRow(OTHER_SESSION, { webinar_id: OTHER_WEBINAR }, now)
    ],
    webinar_user_bans: [],
    webinars: [webinarRow(WEBINAR, webinar, now), webinarRow(OTHER_WEBINAR, {}, now)]
  };
}
