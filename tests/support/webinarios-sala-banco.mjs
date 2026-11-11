// O banco falso das rotas da Sala (tests/webinarios-sala-rotas.test.mjs e tests/webinarios-na-tela-rotas.test.mjs;
// docs/18 §2.2): tabelas como listas, os filtros do PostgREST que as rotas usam, as chaves unicas das tabelas da
// 202610290001 (e o nome unico da pessoa que comenta da 202611110001, com o insert de varias linhas atomico), a RPC
// webinar_chat_window com a linha mestre deslocada pela ancora e a escola de mentira (uma Live
// gravada publicada para todos, com a gravacao da Bunny e a live de origem). Cada `from` fica em `calls.from` e cada
// escrita em `calls.writes`: os testes contam as consultas. Nada aqui e importado por src/.

import { randomUUID } from "node:crypto";

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const WEBINAR = "cccccccc-0000-4000-8000-000000000001";
export const SESSION = "cccccccc-0000-4000-8000-000000000002";
export const LIVE_SOURCE = "cccccccc-0000-4000-8000-000000000003";
export const REPLAY = "cccccccc-0000-4000-8000-000000000004";
export const OTHER_WEBINAR = "cccccccc-0000-4000-8000-000000000005";
export const OTHER_SESSION = "cccccccc-0000-4000-8000-000000000006";
export const RECORDING = "cccccccc-0000-4000-8000-000000000007";
export const iso = (time) => new Date(time).toISOString();

/* ------------------------------------------------------------------------------------------------
 * Banco falso
 * ---------------------------------------------------------------------------------------------- */

export const UNIQUE = {
  webinar_chat_consents: [["user_id"]],
  // O indice unico (webinar_id, name_key) da 202611110001: name_key e a coluna gerada (webinar_persona_name_key).
  webinar_personas: [["webinar_id", "name_key"]],
  webinar_poll_answers: [["poll_id", "user_id"]],
  webinar_presence_samples: [["session_id", "user_id", "bucket"]],
  webinar_question_votes: [["question_id", "user_id"]]
};

/** As colunas geradas que o banco calcula (as linhas dos testes nao trazem): o nome comparavel da pessoa que comenta. */
const GENERATED = {
  webinar_personas: { name_key: (row) => String(row.name ?? "").normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR") }
};

function columnOf(name, row, key) {
  const generated = GENERATED[name]?.[key];
  return generated ? generated(row) : row[key];
}
export const NO_ID = new Set(["webinar_attendance", "webinar_chat_consents", "webinar_presence_samples", "webinar_question_votes"]);
export const DEFAULTS = {
  student_events: { entity_id: null, entity_type: null, metadata: {} },
  webinar_chat_consents: { nickname: null, revoked_at: null },
  webinar_chat_messages: { approved: true, approved_at: null, approved_by: null, deleted_at: null, deleted_by: null, deleted_reason: null, kind: "message", master: false, pinned_at: null, reply_to_id: null, script_item_id: null },
  webinar_poll_answers: { deleted_at: null },
  webinar_presence_samples: { samples: 1 },
  webinar_question_replies: { anonymous: false, deleted_at: null, deleted_by: null, deleted_reason: null },
  webinar_questions: { anonymous: false, answer_text: null, answered_at: null, answered_by: null, answered_live: false, deleted_at: null, deleted_reason: null, message_id: null, status: "open", upvotes: 0 }
};

export function literal(text) {
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  return text.replace(/^"(.*)"$/, "$1");
}

export function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function matches(row, [op, column, value, extra]) {
  const current = row[column];
  switch (op) {
    // .not(coluna, "is", null), .not(coluna, "eq", valor) e .not("id", "in", "(a,b)"): o roteiro que ja entrou, as lives
    // no ar e os itens que saem do roteiro ao salvar (R8).
    case "not":
      if (value === "is") return extra === null ? current !== null && current !== undefined : current !== extra;
      if (value === "eq") return current !== extra;
      if (value === "in") return !String(extra).replace(/^\(|\)$/g, "").split(",").map(literal).includes(current);
      return true;
    case "eq":
      return current === value;
    case "in":
      return value.includes(current);
    case "is":
      return value === null ? current === null || current === undefined : current === value;
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

/** O relogio do banco falso (created_at das linhas novas): o teste adianta para testar a janela de 60 s das reacoes. */
export const relogio = { agora: () => Date.now() };

export function bancoFalso({ rpc = {}, tables = {} } = {}) {
  const calls = { from: [], reads: [], rpc: [], writes: [] };
  const table = (name) => (tables[name] ??= []);

  function violates(name, row, ignore) {
    return (UNIQUE[name] ?? []).some((keys) => table(name).some((existing) => existing !== ignore && keys.every((key) => columnOf(name, existing, key) === columnOf(name, row, key))));
  }

  function query(name) {
    const state = { count: null, filters: [], head: false, limit: null, op: null, order: [], payload: null, range: null, single: null, upsertKeys: null };

    function stamp(row) {
      const now = iso(relogio.agora());
      const base = { ...(DEFAULTS[name] ?? {}) };
      if (!NO_ID.has(name)) base.id = randomUUID();
      return { ...base, created_at: now, updated_at: now, ...row };
    }

    function finish(rows) {
      if (state.head) return { count: rows.length, data: null, error: null };
      if (state.single === "single") return rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
      if (state.single === "maybe") return { data: rows[0] ?? null, error: null };
      return { count: state.count ? rows.length : null, data: rows, error: null };
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
            Object.assign(existing, payload, { updated_at: iso(relogio.agora()) });
            touched.push(existing);
            continue;
          }
          const row = stamp(payload);
          if (violates(name, row)) {
            // Um insert de varias linhas e atomico no banco: o lote recusado nao deixa nenhuma linha gravada.
            for (const added of touched) {
              const index = rows.indexOf(added);
              if (index !== -1 && state.op === "insert") rows.splice(index, 1);
            }
            return { data: null, error: { code: "23505", message: `duplicate key (${name})` } };
          }
          rows.push(row);
          touched.push(row);
        }
        calls.writes.push({ op: state.op, payload: state.payload, table: name });
        return finish(touched);
      }
      if (state.op === "update") {
        const touched = filtered();
        touched.forEach((row) => Object.assign(row, state.payload, { updated_at: iso(relogio.agora()) }));
        calls.writes.push({ filters: state.filters, op: "update", payload: state.payload, table: name });
        return finish(touched);
      }
      if (state.op === "delete") {
        const removed = filtered();
        tables[name] = rows.filter((row) => !removed.includes(row));
        calls.writes.push({ filters: state.filters, op: "delete", table: name });
        return finish(removed);
      }
      // As leituras com os filtros: os testes conferem o que foi pedido (so as respostas do aluno, por exemplo).
      calls.reads.push({ filters: state.filters.map((filter) => [...filter]), table: name });
      let result = filtered();
      for (const [column, ascending] of [...state.order].reverse()) {
        result = [...result].sort((a, b) => (ascending ? compare(a[column], b[column]) : compare(b[column], a[column])));
      }
      if (state.range) result = result.slice(state.range[0], state.range[1] + 1);
      if (state.limit !== null) result = result.slice(0, state.limit);
      // O teto do PostgREST (max_rows = 1000 em supabase/config.toml): a resposta corta em 1000 linhas, sem erro.
      result = result.slice(0, 1000);
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
      not: (column, operator, value) => (state.filters.push(["not", column, operator, value]), chain),
      or: (expression) => ((state.filters.push(["or", expression, null]), chain)),
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
      return { then: (resolve, reject) => Promise.resolve().then(() => ({ data: rpc[name] ? rpc[name](args, tables) : null, error: null })).then(resolve, reject) };
    },
    tables
  };
}

/** A RPC webinar_chat_window do banco falso: as linhas da sessao (aprovadas, ou minhas) + a linha mestre das outras sessoes do webinario, a da live deslocada pela ancora. */
export function janelaDoChat(args, tables) {
  const session = tables.webinar_sessions.find((row) => row.id === args.p_session_id);
  const anchor = tables.webinar_recordings?.find((row) => row.id === session?.recording_id)?.anchor_offset_ms ?? 0;
  const own = tables.webinar_chat_messages.filter(
    (row) => row.session_id === args.p_session_id && !row.deleted_at && row.offset_ms >= args.p_from_ms && row.offset_ms <= args.p_to_ms && (row.approved || (args.p_user_id && row.author_user_id === args.p_user_id))
  );
  const master = tables.webinar_chat_messages
    .filter((row) => row.master && row.approved && !row.deleted_at && row.session_id !== args.p_session_id && row.webinar_id === session?.webinar_id)
    .map((row) => {
      const source = tables.webinar_sessions.find((item) => item.id === row.session_id);
      return { ...row, offset_ms: source?.kind === "live" ? row.offset_ms - anchor : row.offset_ms };
    })
    .filter((row) => row.offset_ms >= args.p_from_ms && row.offset_ms <= args.p_to_ms);
  return [...own, ...master].sort((a, b) => a.offset_ms - b.offset_ms || compare(a.created_at, b.created_at));
}

/* ------------------------------------------------------------------------------------------------
 * A escola de mentira: uma Live gravada publicada para todos, com a gravacao da Bunny e a live de origem
 * ---------------------------------------------------------------------------------------------- */

export function escola({ chatMode = "open", kind = "simulated", scheduledAt = Date.now() - 10 * MIN, slowMode = null, status = "scheduled", accessMode = "everyone" } = {}) {
  const now = Date.now();
  const webinar = (id, extra = {}) => ({
    access_mode: accessMode,
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
    kind,
    product_id: accessMode === "product" ? "curso-x" : null,
    published_at: iso(now - HOUR),
    quality: {},
    recording_retention_days: 730,
    registration_required: false,
    reminder_texts: {},
    reminders: {},
    replay_days_on_home: 7,
    replay_lesson_target: null,
    room_settings: { chatMode: "open" },
    scheduled_at: null,
    show_banner: true,
    show_on_home: true,
    show_registered_count: false,
    slug: "live-de-mentira",
    status: "published",
    title: "Live de mentira",
    updated_at: iso(now - HOUR),
    ...extra
  });
  const session = (id, extra = {}) => ({
    chat_mode: chatMode,
    chat_slow_mode_seconds: slowMode,
    created_at: iso(now - HOUR),
    ended_at: null,
    id,
    kind: "simulated",
    late_join_minutes: null,
    pinned_message_id: null,
    presence_curve: null,
    recording_anchor_at: null,
    recording_id: RECORDING,
    scheduled_at: iso(scheduledAt),
    script_fired_at: null,
    show_live_badge: true,
    simulation_ack_text: null,
    simulation_decided_at: null,
    simulation_decided_by: null,
    source_session_id: LIVE_SOURCE,
    started_at: null,
    status,
    updated_at: iso(now - HOUR),
    webinar_id: WEBINAR,
    ...extra
  });
  return {
    admin_roles: [],
    entitlements: [],
    lesson_comment_blocked_words: [{ active: true, message: "Sem isso aqui.", word: "palavrão" }],
    profiles: [],
    student_events: [],
    webinar_chat_consents: [],
    webinar_chat_messages: [
      // A linha mestre da live real: offset 100 s na live, 95 s no video (ancora de 5 s).
      { approved: true, author_user_id: "11111111-1111-4111-8111-111111111111", body: "oi da live", created_at: iso(now - 30 * 24 * HOUR), deleted_at: null, display_name: "Bia C.", id: "cccccccc-aaaa-4000-8000-000000000001", kind: "message", master: true, offset_ms: 100_000, pinned_at: null, reply_to_id: null, role: "student", script_item_id: null, session_id: LIVE_SOURCE, source: "original", webinar_id: WEBINAR }
    ],
    webinar_poll_answers: [],
    webinar_poll_options: [],
    webinar_polls: [],
    webinar_presence_samples: [],
    webinar_question_replies: [],
    webinar_question_votes: [],
    webinar_questions: [],
    webinar_reactions: [],
    webinar_recordings: [
      { anchor_offset_ms: 5000, bunny_library_id: "12345", bunny_video_id: "0b1c2d3e-aaaa-4bbb-8ccc-123456789abc", created_at: iso(now - HOUR), duration_seconds: 3600, embed_url: "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc", error_message: null, file_name: null, id: RECORDING, provider: "bunny", purge_due_at: null, session_id: LIVE_SOURCE, sha256: null, size_bytes: null, source: "upload", status: "ready", updated_at: iso(now - HOUR), webinar_id: WEBINAR }
    ],
    webinar_registrations: [],
    webinar_sessions: [
      session(SESSION),
      session(LIVE_SOURCE, { kind: "live", recording_anchor_at: iso(now - 30 * 24 * HOUR), scheduled_at: iso(now - 30 * 24 * HOUR), status: "ended" }),
      session(REPLAY, { kind: "replay", scheduled_at: iso(now - 29 * 24 * HOUR), status: "ended" }),
      session(OTHER_SESSION, { webinar_id: OTHER_WEBINAR })
    ],
    webinars: [webinar(WEBINAR), webinar(OTHER_WEBINAR, { slug: "outra-live", title: "Outra live" })]
  };
}
