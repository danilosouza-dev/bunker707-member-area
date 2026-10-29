import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// As rotas da Sala (docs/30 §4.7, §5.1, §8.3 e §8.5; docs/18 §2.2), sem banco: um banco falso em memoria (tabelas
// como listas, filtros do PostgREST, chaves unicas das tabelas da 202610290001 e a RPC webinar_chat_window com a
// linha mestre deslocada pela ancora) e a sessao do aluno pelo teste. Aqui: 401 sem sessao, 400 sem id, 404 fora do
// acesso e sessao de outro webinario; a janela do chat (linha mestre + a pendente do proprio aluno) e a consulta de
// mensagens novas com o cursor; o aceite obrigatorio uma vez (409 consent_required, depois webinar_chat_consented
// e o nome exibido pela escolha); offset do relogio do servidor na gravada e do corpo no replay; 409 chat_off /
// team_only / not_started / ended; rajada 5/60 s e modo lento 429 com Retry-After; palavra bloqueada 422; moderado
// grava approved = false e devolve pending; a pergunta pelo chat; Remover minhas mensagens (apaga tudo, retira o
// aceite, grava revoked); o sinal de presenca (balde do servidor, webinar_joined no primeiro, samples no mesmo
// balde, webinar_left no leave, o acesso em cache); reacoes 1/s e 20/min e as contagens; perguntas 2/min, a lista
// com mine/voted e a dispensada so para o autor, o voto que alterna; enquetes (uma resposta, 409 na segunda,
// encerrada 409, opcao invalida 400, resultado so compartilhado); e a resposta da sessao com os campos da sala.

const sessao = (globalThis.__salaRotasSessao ??= { user: null });

/** O modulo de src/ que um import pede ("server/auth/guards"), pelo alias ou por caminho relativo. */
function moduloDeSrc(specifier, context) {
  if (specifier.startsWith("@/")) {
    return specifier.slice(2);
  }
  if (/^\.{1,2}\//.test(specifier) && context.parentURL) {
    const url = new URL(specifier, context.parentURL).href;
    const index = url.indexOf("/src/");
    return index === -1 ? null : url.slice(index + 5).replace(/\.tsx?$/, "");
  }
  return null;
}

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

// A sessao das rotas (requireApiUser / requireApiSessionUser) vem do teste; o cliente do banco (pedido pelo alias
// nas rotas e por caminho relativo em src/server/webinars/db.ts) e o banco falso de admin-action-stubs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__salaRotasSessao.user;
          return user ? { response: null, user } : { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
        }
        export const requireApiSessionUser = requireApiUser;`);
    }
    if (modulo === "server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }
    return nextResolve(specifier, context);
  }
});

const chatRoute = await import("../src/app/api/webinars/[id]/chat/route.ts");
const globalChatRoute = await import("../src/app/api/webinars/chat/route.ts");
const heartbeatRoute = await import("../src/app/api/webinars/[id]/heartbeat/route.ts");
const reactionsRoute = await import("../src/app/api/webinars/[id]/reactions/route.ts");
const questionsRoute = await import("../src/app/api/webinars/[id]/questions/route.ts");
const voteRoute = await import("../src/app/api/webinars/[id]/questions/[qid]/vote/route.ts");
const pollsRoute = await import("../src/app/api/webinars/[id]/polls/route.ts");
const sessionRoute = await import("../src/app/api/webinars/[id]/session/route.ts");
const { resetRoomLimits } = await import("../src/server/webinars/room-limits.ts");
const { CHAT_CONSENT_VERSION } = await import("../src/server/webinars/model.ts");

const MIN = 60_000;
const HOUR = 60 * MIN;
const WEBINAR = "cccccccc-0000-4000-8000-000000000001";
const SESSION = "cccccccc-0000-4000-8000-000000000002";
const LIVE_SOURCE = "cccccccc-0000-4000-8000-000000000003";
const REPLAY = "cccccccc-0000-4000-8000-000000000004";
const OTHER_WEBINAR = "cccccccc-0000-4000-8000-000000000005";
const OTHER_SESSION = "cccccccc-0000-4000-8000-000000000006";
const RECORDING = "cccccccc-0000-4000-8000-000000000007";
const iso = (time) => new Date(time).toISOString();
let proximoAluno = 100;

/** Um aluno novo por teste: o teto global de escritas e por aluno e vive no modulo. */
function novoAluno() {
  proximoAluno += 1;
  const id = `55555555-5555-4555-8555-${String(proximoAluno).padStart(12, "0")}`;
  sessao.user = { id };
  return id;
}

/* ------------------------------------------------------------------------------------------------
 * Banco falso
 * ---------------------------------------------------------------------------------------------- */

const UNIQUE = {
  webinar_chat_consents: [["user_id"]],
  webinar_poll_answers: [["poll_id", "user_id"]],
  webinar_presence_samples: [["session_id", "user_id", "bucket"]],
  webinar_question_votes: [["question_id", "user_id"]]
};
const NO_ID = new Set(["webinar_attendance", "webinar_chat_consents", "webinar_presence_samples", "webinar_question_votes"]);
const DEFAULTS = {
  student_events: { entity_id: null, entity_type: null, metadata: {} },
  webinar_chat_consents: { nickname: null, revoked_at: null },
  webinar_chat_messages: { approved: true, approved_at: null, approved_by: null, deleted_at: null, deleted_by: null, deleted_reason: null, kind: "message", master: false, pinned_at: null, reply_to_id: null, script_item_id: null },
  webinar_poll_answers: { deleted_at: null },
  webinar_presence_samples: { samples: 1 },
  webinar_questions: { anonymous: false, answer_text: null, answered_at: null, answered_by: null, answered_live: false, deleted_at: null, deleted_reason: null, message_id: null, status: "open", upvotes: 0 }
};

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

function matches(row, [op, column, value]) {
  const current = row[column];
  switch (op) {
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
const relogio = { agora: () => Date.now() };

function bancoFalso({ rpc = {}, tables = {} } = {}) {
  const calls = { from: [], rpc: [], writes: [] };
  const table = (name) => (tables[name] ??= []);

  function violates(name, row, ignore) {
    return (UNIQUE[name] ?? []).some((keys) => table(name).some((existing) => existing !== ignore && keys.every((key) => existing[key] === row[key])));
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
function janelaDoChat(args, tables) {
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

function escola({ chatMode = "open", kind = "simulated", scheduledAt = Date.now() - 10 * MIN, slowMode = null, status = "scheduled", accessMode = "everyone" } = {}) {
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
    room_settings: { anonymousQuestions: true, chatMode: "open", displayName: "first_name_initial" },
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

function montar(options) {
  resetRoomLimits();
  heartbeatRoute.resetHeartbeatAccessCache();
  const db = bancoFalso({ rpc: { webinar_chat_window: janelaDoChat }, tables: escola(options) });
  actionStubs.db = db;
  const userId = novoAluno();
  db.tables.profiles.push({ avatar_url: null, created_at: iso(Date.now()), email: "ana@bunker707.test", full_name: "Ana Maria Souza", id: userId, last_sign_in_at: null, phone: null });
  return { db, userId };
}

const contexto = (id = WEBINAR) => ({ params: Promise.resolve({ id }) });
const pedido = (path, method = "GET", body, headers = {}) =>
  new Request(`http://localhost/api/webinars/${path}`, body === undefined ? { headers, method } : { body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers }, method });
const json = async (response) => ({ body: await response.json(), status: response.status });
const eventos = (db, type) => db.tables.student_events.filter((row) => row.event_type === type);

async function enviar(body, extra = {}) {
  return json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { sessionId: SESSION, ...body }), contexto(extra.webinarId ?? WEBINAR)));
}

const comAceite = { consent: true, consentVersion: CHAT_CONSENT_VERSION };

/* ------------------------------------------------------------------------------------------------
 * Guardas comuns
 * ---------------------------------------------------------------------------------------------- */

test("guardas: 401 sem sessao, 400 sem id, 404 fora do acesso e para sessao de outro webinario, 400 janela invalida", async () => {
  montar();
  sessao.user = null;
  assert.equal((await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=0&to=1000`), contexto())).status, 401);
  assert.equal((await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 0, sessionId: SESSION }), contexto())).status, 401);
  novoAluno();
  assert.equal((await chatRoute.GET(pedido(`nao-e-id/chat?sessao=${SESSION}&from=0&to=1000`), contexto("nao-e-id"))).status, 400);
  const outra = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${OTHER_SESSION}&from=0&to=1000`), contexto()));
  assert.equal(outra.status, 404, "sessao de outro webinario");
  const janela = await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=0&to=${16 * MIN}`), contexto());
  assert.equal(janela.status, 400, "mais de 15 min");
  assert.equal((await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}`), contexto())).status, 400, "nem janela nem cursor");

  // Quem pode so com o produto e nao tem acesso: 404 sem dizer se existe.
  const { db } = montar({ accessMode: "product" });
  const semAcesso = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=0&to=1000`), contexto()));
  assert.equal(semAcesso.status, 404);
  assert.ok(db.calls.from.includes("entitlements"), "leu os acessos do aluno");
});

/* ------------------------------------------------------------------------------------------------
 * Chat
 * ---------------------------------------------------------------------------------------------- */

test("janela do chat: a linha mestre vem deslocada pela ancora (100 s na live = 95 s no video) e a pendente so para o autor; a consulta de mensagens novas devolve o cursor", async () => {
  const { db, userId } = montar();
  db.tables.webinar_chat_messages.push(
    { approved: false, author_user_id: userId, body: "minha pendente", created_at: iso(Date.now() - 1000), deleted_at: null, display_name: "Ana S.", id: "cccccccc-aaaa-4000-8000-000000000002", kind: "message", master: false, offset_ms: 96_000, pinned_at: null, reply_to_id: null, role: "student", script_item_id: null, session_id: SESSION, source: "audience", webinar_id: WEBINAR },
    { approved: false, author_user_id: "11111111-1111-4111-8111-111111111112", body: "pendente de outro", created_at: iso(Date.now() - 1000), deleted_at: null, display_name: "Zé", id: "cccccccc-aaaa-4000-8000-000000000003", kind: "message", master: false, offset_ms: 97_000, pinned_at: null, reply_to_id: null, role: "student", script_item_id: null, session_id: SESSION, source: "audience", webinar_id: WEBINAR }
  );
  const janela = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=90000&to=120000`), contexto()));
  assert.equal(janela.status, 200, JSON.stringify(janela.body));
  assert.equal(janela.body.data.mode, "window");
  assert.deepEqual(
    janela.body.data.messages.map((message) => [message.displayName, message.offsetMs, message.pending, message.mine]),
    [
      ["Bia C.", 95_000, false, false],
      ["Ana S.", 96_000, true, true]
    ]
  );
  assert.equal(janela.body.data.messages[0].role, "student");
  assert.ok(!("source" in janela.body.data.messages[0]), "a origem fica so no banco");

  const desde = iso(Date.now() - 2000);
  const novas = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&since=${encodeURIComponent(desde)}`), contexto()));
  assert.equal(novas.status, 200, JSON.stringify(novas.body));
  assert.equal(novas.body.data.mode, "recent");
  assert.deepEqual(novas.body.data.messages.map((message) => message.body), ["minha pendente"], "a pendente de outro aluno nao vem");
  assert.equal(novas.body.data.next.after, "cccccccc-aaaa-4000-8000-000000000002");
  const repetida = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&since=${encodeURIComponent(novas.body.data.next.since)}&after=${novas.body.data.next.after}`), contexto()));
  assert.deepEqual(repetida.body.data.messages, [], "depois do cursor, nada de novo");
  assert.deepEqual(repetida.body.data.next, novas.body.data.next, "o cursor se mantem");
});

test("janela do chat na gravada: nunca passa da janela a frente do relogio do servidor (o chat original de depois de agora fica para depois); no replay, ate onde o aluno pedir", async () => {
  const { db } = montar();
  // A sessao gravada esta no minuto 10 (600 s); a linha mestre do minuto 15 (900 s no video) ainda nao pode sair.
  db.tables.webinar_chat_messages.push({ approved: true, author_user_id: "11111111-1111-4111-8111-111111111111", body: "spoiler do minuto 15", created_at: iso(Date.now() - 30 * 24 * HOUR), deleted_at: null, display_name: "Bia C.", id: "cccccccc-aaaa-4000-8000-00000000000f", kind: "message", master: true, offset_ms: 905_000, pinned_at: null, reply_to_id: null, role: "student", script_item_id: null, session_id: LIVE_SOURCE, source: "original", webinar_id: WEBINAR });
  const adiante = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=590000&to=1400000`), contexto()));
  assert.equal(adiante.status, 200, JSON.stringify(adiante.body));
  assert.deepEqual(adiante.body.data.messages.map((message) => message.body), [], "nada do minuto 15 agora");
  const ate = adiante.body.data.window.toMs;
  assert.ok(ate >= 600_000 + 120_000 && ate <= 600_000 + 120_000 + 15_000, `a janela devolvida para no relogio do servidor + 120 s (${ate})`);
  assert.equal(adiante.body.data.window.fromMs, 590_000);

  const depois = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=880000&to=920000`), contexto()));
  assert.deepEqual(depois.body.data.messages, [], "pedida toda depois do limite, vazia");
  assert.deepEqual(depois.body.data.window, { fromMs: 880_000, toMs: 879_999 }, "a seguinte recomeca do mesmo ponto");

  const replay = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${REPLAY}&from=880000&to=920000`), contexto()));
  assert.deepEqual(replay.body.data.messages.map((message) => message.body), ["spoiler do minuto 15"], "no replay o aluno pula pelo video");
  assert.deepEqual(replay.body.data.window, { fromMs: 880_000, toMs: 920_000 });
});

test("POST chat: a primeira exige o aceite (409 consent_required); com ele grava o aceite, o nome exibido pela escolha e os registros; o offset e o do servidor", async () => {
  const { db, userId } = montar({ scheduledAt: Date.now() - 90_000 });
  const semAceite = await enviar({ body: "oi" });
  assert.equal(semAceite.status, 409);
  assert.equal(semAceite.body.reason, "consent_required");
  assert.equal(db.tables.webinar_chat_messages.filter((row) => row.author_user_id === userId).length, 0);

  const versaoErrada = await enviar({ body: "oi", consent: true, consentVersion: CHAT_CONSENT_VERSION + 1 });
  assert.equal(versaoErrada.status, 409);

  const primeira = await enviar({ body: "  oi, turma  ", offsetMs: 5, ...comAceite });
  assert.equal(primeira.status, 201, JSON.stringify(primeira.body));
  assert.equal(primeira.body.data.pending, false);
  assert.equal(primeira.body.data.message.displayName, "Ana S.", "primeiro nome e inicial");
  assert.equal(primeira.body.data.message.body, "oi, turma");
  assert.equal(primeira.body.data.message.mine, true);
  assert.ok(primeira.body.data.message.offsetMs >= 89_000 && primeira.body.data.message.offsetMs <= 95_000, `offset do servidor (${primeira.body.data.message.offsetMs}), nunca o 5 do corpo`);
  const linha = db.tables.webinar_chat_messages.find((row) => row.author_user_id === userId);
  assert.equal(linha.source, "audience");
  assert.equal(linha.master, false);
  assert.equal(linha.role, "student");
  assert.deepEqual(db.tables.webinar_chat_consents.map((row) => [row.user_id, row.consent_version, row.display_mode, row.revoked_at]), [[userId, CHAT_CONSENT_VERSION, "first_name_initial", null]]);
  assert.deepEqual(
    db.tables.student_events.map((row) => [row.event_type, row.entity_type, row.entity_id, row.metadata]),
    [
      ["webinar_chat_consented", "webinar", SESSION, { consent_version: CHAT_CONSENT_VERSION, display: "first_name_initial" }],
      ["webinar_chat_sent", "webinar", SESSION, { kind: "message", length: 9, message_id: linha.id, offset_ms: linha.offset_ms }]
    ]
  );
  assert.ok(!JSON.stringify(db.tables.student_events).includes("oi, turma"), "nunca o texto no historico");

  const segunda = await enviar({ body: "de novo, sem repetir o aceite" });
  assert.equal(segunda.status, 201);
  assert.equal(eventos(db, "webinar_chat_consented").length, 1, "o aceite nao se repete");
});

test("POST chat: Participar como anonimo vira Aluno {n} estavel; apelido; a pergunta pelo chat abre a linha em webinar_questions", async () => {
  const { db, userId } = montar();
  const anonima = await enviar({ anonymous: true, body: "quem sou eu?", ...comAceite });
  assert.equal(anonima.status, 201, JSON.stringify(anonima.body));
  assert.match(anonima.body.data.message.displayName, /^Aluno \d{3}$/);
  assert.equal(db.tables.webinar_chat_consents[0].display_mode, "anonymous");
  assert.equal(eventos(db, "webinar_chat_consented")[0].metadata.display, "anonymous");
  const outra = await enviar({ body: "e agora?" });
  assert.equal(outra.body.data.message.displayName, anonima.body.data.message.displayName, "o numero e estavel");

  const { db: db2 } = montar();
  const apelido = await enviar({ body: "oi", displayMode: "nickname", nickname: "aninha", ...comAceite });
  assert.equal(apelido.body.data.message.displayName, "aninha");
  const pergunta = await enviar({ body: "e quando sai o modulo 2?", kind: "question" });
  assert.equal(pergunta.status, 201, JSON.stringify(pergunta.body));
  assert.equal(pergunta.body.data.message.kind, "question");
  const linhaDaPergunta = db2.tables.webinar_questions[0];
  assert.equal(linhaDaPergunta.message_id, pergunta.body.data.message.id);
  assert.equal(linhaDaPergunta.display_name, "aninha");
  assert.deepEqual(eventos(db2, "webinar_question_sent")[0].metadata, { anonymous: false, offset_ms: linhaDaPergunta.offset_ms, question_id: linhaDaPergunta.id });
  assert.equal(db2.tables.webinar_chat_consents[0].user_id, sessao.user.id);
  assert.notEqual(userId, sessao.user.id);
});

test("POST chat: fora da hora e do modo (409 not_started / ended / chat_off / team_only); o replay sempre aceita e grava o offset do corpo", async () => {
  montar({ scheduledAt: Date.now() + HOUR });
  assert.equal((await enviar({ body: "cedo", ...comAceite })).body.reason, "not_started");
  montar({ scheduledAt: Date.now() - 2 * HOUR });
  assert.equal((await enviar({ body: "tarde", ...comAceite })).body.reason, "ended");
  montar({ status: "ended" });
  assert.equal((await enviar({ body: "encerrada pela equipe", ...comAceite })).body.reason, "ended");
  montar({ chatMode: "off" });
  const desligado = await enviar({ body: "x", ...comAceite });
  assert.equal(desligado.status, 409);
  assert.equal(desligado.body.reason, "chat_off");
  montar({ chatMode: "team_only" });
  assert.equal((await enviar({ body: "x", ...comAceite })).body.reason, "team_only");

  const { db } = montar();
  const replay = await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "no replay", offsetMs: 42_000, sessionId: REPLAY, ...comAceite }), contexto()));
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.data.message.offsetMs, 42_000, "a posicao do player que veio no corpo");
  assert.equal(db.tables.webinar_chat_messages.at(-1).session_id, REPLAY);
});

test("POST chat: rajada 5/60 s (a 6a e 429 com Retry-After), modo lento 429, palavra bloqueada 422, moderado grava approved = false e devolve pending", async () => {
  montar();
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await enviar({ body: `m${i}`, ...comAceite })).status, 201, `mensagem ${i + 1}`);
  }
  const sexta = await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "m6", sessionId: SESSION }), contexto());
  assert.equal(sexta.status, 429);
  assert.match(sexta.headers.get("Retry-After") ?? "", /^\d+$/);

  montar({ slowMode: 20 });
  assert.equal((await enviar({ body: "primeira", ...comAceite })).status, 201);
  const lenta = await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "segunda", sessionId: SESSION }), contexto());
  assert.equal(lenta.status, 429);
  const espera = Number(lenta.headers.get("Retry-After"));
  assert.ok(espera >= 1 && espera <= 20, `Retry-After do modo lento (${espera})`);
  assert.match((await lenta.json()).error, /enviar de novo em \d+ s/);

  const { db } = montar();
  const bloqueada = await enviar({ body: "isso é um PALAVRÃO feio", ...comAceite });
  assert.equal(bloqueada.status, 422);
  assert.equal(bloqueada.body.error, "Sem isso aqui.");
  assert.equal(db.tables.webinar_chat_messages.filter((row) => row.source === "audience").length, 0, "recusada antes de gravar");

  const { db: moderado, userId } = montar({ chatMode: "moderated" });
  const pendente = await enviar({ body: "espera a equipe", ...comAceite });
  assert.equal(pendente.status, 201);
  assert.equal(pendente.body.data.pending, true);
  assert.equal(pendente.body.data.message.pending, true);
  assert.equal(moderado.tables.webinar_chat_messages.find((row) => row.author_user_id === userId).approved, false);
  const perguntaPendente = await enviar({ body: "e o certificado?", kind: "question" });
  assert.equal(perguntaPendente.status, 201);
  assert.equal(moderado.tables.webinar_questions.length, 0, "a pergunta pendente so entra na aba quando a equipe libera");
  assert.equal(eventos(moderado, "webinar_question_sent").length, 0);
});

test("POST chat: dois pedidos juntos no modo lento passam um so; a mensagem recusada (palavra bloqueada) devolve a vez", async () => {
  montar({ slowMode: 20 });
  const juntos = await Promise.all([enviar({ body: "um", ...comAceite }), enviar({ body: "dois", ...comAceite })]);
  assert.deepEqual(juntos.map((item) => item.status).sort(), [201, 429], "o modo lento reserva a vez antes de qualquer espera");

  const { db } = montar({ slowMode: 20 });
  assert.equal((await enviar({ body: "isso é um palavrão", ...comAceite })).status, 422);
  const depois = await enviar({ body: "agora sim" });
  assert.equal(depois.status, 201, "a recusada nao conta para o modo lento");
  assert.equal(db.tables.webinar_chat_messages.filter((row) => row.source === "audience").length, 1);
});

test("DELETE chat { all: true }: apaga (soft, consent_revoked) mensagens, perguntas e respostas de enquete de todas as sessoes, retira o aceite e grava revoked; a rota sem id faz o mesmo", async () => {
  const { db, userId } = montar();
  assert.equal((await enviar({ body: "a", ...comAceite })).status, 201);
  assert.equal((await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "b", sessionId: REPLAY }), contexto()))).status, 201);
  db.tables.webinar_questions.push({ anonymous: false, body: "?", created_at: iso(Date.now()), deleted_at: null, display_name: "Ana S.", id: randomUUID(), offset_ms: 0, session_id: SESSION, status: "open", upvotes: 0, user_id: userId });
  db.tables.webinar_poll_answers.push({ created_at: iso(Date.now()), deleted_at: null, id: randomUUID(), offset_ms: 0, option_ids: [randomUUID()], poll_id: randomUUID(), session_id: SESSION, user_id: userId });

  const semCorpo = await chatRoute.DELETE(pedido(`${WEBINAR}/chat`, "DELETE", { all: false }), contexto());
  assert.equal(semCorpo.status, 400);

  const removido = await json(await chatRoute.DELETE(pedido(`${WEBINAR}/chat`, "DELETE", { all: true }), contexto()));
  assert.equal(removido.status, 200, JSON.stringify(removido.body));
  assert.equal(removido.body.data.removed, 4);
  assert.ok(db.tables.webinar_chat_messages.filter((row) => row.author_user_id === userId).every((row) => row.deleted_at && row.deleted_reason === "consent_revoked"));
  assert.equal(db.tables.webinar_chat_messages.find((row) => row.master).deleted_at, null, "a linha mestre de outro aluno fica");
  assert.ok(db.tables.webinar_questions[0].deleted_at);
  assert.ok(db.tables.webinar_poll_answers[0].deleted_at);
  assert.ok(db.tables.webinar_chat_consents[0].revoked_at, "o aceite retirado");
  assert.deepEqual(eventos(db, "webinar_chat_consented").at(-1).metadata, { consent_version: CHAT_CONSENT_VERSION, revoked: true });

  // Depois de revogar, a proxima mensagem pede o aceite de novo.
  assert.equal((await enviar({ body: "de volta" })).body.reason, "consent_required");

  const deNovo = await json(await globalChatRoute.DELETE(pedido("chat", "DELETE", { all: true })));
  assert.equal(deNovo.status, 200);
  assert.equal(deNovo.body.data.removed, 0, "nada mais a remover");
  sessao.user = null;
  assert.equal((await globalChatRoute.DELETE(pedido("chat", "DELETE", { all: true }))).status, 401);
});

/* ------------------------------------------------------------------------------------------------
 * Presenca
 * ---------------------------------------------------------------------------------------------- */

test("heartbeat: o balde pelo offset do servidor (nao o do corpo), webinar_joined no primeiro sinal com o aparelho, samples no mesmo balde, webinar_left no leave, o acesso em cache", async () => {
  const { db, userId } = montar({ scheduledAt: Date.now() - 95_000 });
  const bater = (body, headers) => heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { sessionId: SESSION, state: "playing", visible: true, ...body }, headers), contexto());

  const primeiro = await json(await bater({ offsetSeconds: 5 }, { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" }));
  assert.equal(primeiro.status, 200, JSON.stringify(primeiro.body));
  assert.equal(primeiro.body.data.ended, false);
  assert.equal(primeiro.body.data.presentNow, 1);
  assert.ok(primeiro.body.data.offsetMs >= 94_000, "o offset do servidor");
  const amostra = db.tables.webinar_presence_samples[0];
  assert.equal(amostra.bucket, 3, "95 s = balde 3 (30 s cada), nunca o 5 s do corpo");
  assert.equal(amostra.user_id, userId);
  assert.deepEqual(eventos(db, "webinar_joined").map((row) => [row.entity_id, row.metadata]), [[SESSION, { device: "mobile", kind: "simulated" }]]);

  const segundo = await json(await bater({ offsetSeconds: 6 }));
  assert.equal(segundo.status, 200);
  assert.equal(db.tables.webinar_presence_samples.length, 1, "o mesmo balde");
  assert.equal(db.tables.webinar_presence_samples[0].samples, 2);
  assert.equal(eventos(db, "webinar_joined").length, 1, "nao e uma entrada nova");
  const leiturasDoWebinario = db.calls.from.filter((name) => name === "webinars").length;
  assert.equal(leiturasDoWebinario, 1, "o acesso foi conferido uma vez: o segundo sinal veio do cache");

  const saida = await json(await bater({ leave: true, offsetSeconds: 7, state: "hidden", visible: false }));
  assert.equal(saida.status, 200);
  const left = eventos(db, "webinar_left");
  assert.equal(left.length, 1);
  assert.deepEqual(left[0].metadata, { kind: "simulated", reason: "closed", seconds_present: 30 });

  // Outro aluno: mais um presente; o replay grava webinar_replay_started no primeiro sinal.
  novoAluno();
  const outro = await json(await bater({ offsetSeconds: 0 }));
  assert.equal(outro.body.data.presentNow, 2);
  const replay = await json(await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 1230, sessionId: REPLAY, state: "playing", visible: true }), contexto()));
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.data.offsetMs, null, "o replay nao tem relogio");
  assert.equal(db.tables.webinar_presence_samples.find((row) => row.session_id === REPLAY).bucket, 41, "1230 s = balde 41, pela posicao do player");
  assert.deepEqual(eventos(db, "webinar_replay_started").map((row) => row.metadata), [{ recording_id: RECORDING }]);

  const corpoRuim = await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { sessionId: SESSION }), contexto());
  assert.equal(corpoRuim.status, 400);
});

/* ------------------------------------------------------------------------------------------------
 * Reacoes, perguntas e enquetes
 * ---------------------------------------------------------------------------------------------- */

test("reacoes: 201 com o registro; a segunda no mesmo segundo e 429 (Retry-After 1); a 21a no minuto e 429 (60); as contagens dos ultimos 10 s", async () => {
  const { db, userId } = montar();
  const reagir = (reaction) => reactionsRoute.POST(pedido(`${WEBINAR}/reactions`, "POST", { reaction, sessionId: SESSION }), contexto());
  const primeira = await json(await reagir("clap"));
  assert.equal(primeira.status, 201, JSON.stringify(primeira.body));
  assert.equal(db.tables.webinar_reactions.length, 1);
  assert.deepEqual(eventos(db, "webinar_reaction_sent")[0].metadata, { offset_ms: db.tables.webinar_reactions[0].offset_ms, reaction: "clap" });

  const seguida = await reagir("fire");
  assert.equal(seguida.status, 429);
  assert.equal(seguida.headers.get("Retry-After"), "1");

  // 20 reacoes espalhadas no ultimo minuto (nenhuma no ultimo segundo), gravadas por outra instancia do app: a
  // memoria desta nao as viu (zerada), o banco segura a 21a.
  db.tables.webinar_reactions.length = 0;
  resetRoomLimits();
  // De 50 s a 2,5 s atras, a cada 2,5 s: 3 delas (17, 18 e 19) caem nos ultimos 10 s.
  for (let i = 0; i < 20; i += 1) {
    db.tables.webinar_reactions.push({ created_at: iso(Date.now() - 50_000 + i * 2500), id: randomUUID(), offset_ms: 0, reaction: "like", session_id: SESSION, user_id: userId });
  }
  const vigesimaPrimeira = await reagir("wow");
  assert.equal(vigesimaPrimeira.status, 429);
  assert.equal(vigesimaPrimeira.headers.get("Retry-After"), "60");

  db.tables.webinar_reactions.push({ created_at: iso(Date.now() - 3000), id: randomUUID(), offset_ms: 0, reaction: "love", session_id: SESSION, user_id: "11111111-1111-4111-8111-111111111111" });
  const contagens = await json(await reactionsRoute.GET(pedido(`${WEBINAR}/reactions?sessao=${SESSION}`), contexto()));
  assert.equal(contagens.status, 200);
  assert.equal(contagens.body.data.counts.love, 1);
  assert.ok(contagens.body.data.counts.like >= 2 && contagens.body.data.counts.like <= 4, `as dos ultimos 10 s (${contagens.body.data.counts.like})`);
  const invalida = await reactionsRoute.POST(pedido(`${WEBINAR}/reactions`, "POST", { reaction: "banana", sessionId: SESSION }), contexto());
  assert.equal(invalida.status, 400);

  // Duas reacoes no mesmo instante: a memoria reserva antes da contagem no banco, entao so uma passa.
  const { db: outra } = montar();
  const juntas = await Promise.all([reagir("clap"), reagir("fire")]);
  assert.deepEqual(juntas.map((response) => response.status).sort(), [201, 429]);
  assert.equal(outra.tables.webinar_reactions.length, 1);
});

test("perguntas: 201 (anonima vira Aluno {n}), a 3a no minuto e 429; a lista com mine e voted, a dispensada so para o autor, a ordem; o voto alterna e reconta", async () => {
  const { db, userId } = montar();
  const perguntar = (body) => questionsRoute.POST(pedido(`${WEBINAR}/questions`, "POST", { sessionId: SESSION, ...body }), contexto());
  // Sem o aceite do chat, nada com o nome do aluno (D10): 409 consent_required, nada gravado, a rajada nao conta.
  const semAceite = await json(await perguntar({ anonymous: true, body: "Vai ter certificado?" }));
  assert.equal(semAceite.status, 409);
  assert.equal(semAceite.body.reason, "consent_required");
  assert.equal(db.tables.webinar_questions.length, 0);
  const primeira = await json(await perguntar({ anonymous: true, body: "Vai ter certificado?", ...comAceite }));
  assert.equal(primeira.status, 201, JSON.stringify(primeira.body));
  assert.match(primeira.body.data.question.displayName, /^Aluno \d{3}$/);
  assert.equal(primeira.body.data.question.mine, true);
  assert.deepEqual(eventos(db, "webinar_question_sent")[0].metadata, { anonymous: true, offset_ms: db.tables.webinar_questions[0].offset_ms, question_id: db.tables.webinar_questions[0].id });
  assert.equal(db.tables.webinar_chat_consents[0].display_mode, "first_name_initial", "a Anonima e da pergunta, nao do nome no chat");
  assert.equal(eventos(db, "webinar_chat_consented").length, 1, "o aceite veio com a pergunta");
  const segunda = await json(await perguntar({ anonymous: false, body: "E a apostila?" }));
  assert.equal(segunda.status, 201);
  assert.equal(segunda.body.data.question.displayName, "Ana S.", "com o aceite, o nome como no chat");
  // As duas podem cair no mesmo milissegundo do banco falso: a primeira fica 2 s antes para a ordem "mais recentes".
  db.tables.webinar_questions.find((row) => row.body === "Vai ter certificado?").created_at = iso(Date.now() - 2000);
  assert.equal((await perguntar({ anonymous: false, body: "terceira" })).status, 429);

  const deOutro = "11111111-1111-4111-8111-111111111113";
  db.tables.webinar_questions.push(
    { anonymous: false, body: "respondida", created_at: iso(Date.now() - 5000), deleted_at: null, display_name: "Zé", id: randomUUID(), offset_ms: 0, session_id: SESSION, status: "answered", answer_text: "Sim!", answered_live: false, upvotes: 7, user_id: deOutro },
    { anonymous: false, body: "dispensada de outro", created_at: iso(Date.now() - 4000), deleted_at: null, display_name: "Zé", id: randomUUID(), offset_ms: 0, session_id: SESSION, status: "dismissed", upvotes: 0, user_id: deOutro }
  );
  const votadas = await json(await questionsRoute.GET(pedido(`${WEBINAR}/questions?sessao=${SESSION}&ordem=votadas`), contexto()));
  assert.equal(votadas.status, 200, JSON.stringify(votadas.body));
  assert.deepEqual(
    votadas.body.data.questions.map((question) => [question.body, question.status, question.mine, question.voted]),
    [
      ["respondida", "answered", false, false],
      ["Vai ter certificado?", "open", true, false],
      ["E a apostila?", "open", true, false]
    ],
    "a dispensada de outro aluno some"
  );
  assert.equal(votadas.body.data.questions[0].answerText, "Sim!");

  const alvo = votadas.body.data.questions[0].id;
  const votar = async () => json(await voteRoute.POST(pedido(`${WEBINAR}/questions/${alvo}/vote`, "POST", { sessionId: SESSION }), { params: Promise.resolve({ id: WEBINAR, qid: alvo }) }));
  const votou = await votar();
  assert.deepEqual(votou.body.data, { upvotes: 1, voted: true }, "recontado pelos votos de verdade");
  assert.deepEqual((await votar()).body.data, { upvotes: 0, voted: false });
  const lista = await json(await questionsRoute.GET(pedido(`${WEBINAR}/questions?sessao=${SESSION}&ordem=recentes`), contexto()));
  assert.equal(lista.body.data.questions[0].body, "E a apostila?", "mais recentes primeiro");
  const outraSessao = await voteRoute.POST(pedido(`${WEBINAR}/questions/${alvo}/vote`, "POST", { sessionId: REPLAY }), { params: Promise.resolve({ id: WEBINAR, qid: alvo }) });
  assert.equal(outraSessao.status, 404, "pergunta de outra sessao");
  const dispensada = db.tables.webinar_questions.find((row) => row.status === "dismissed").id;
  const naDispensada = await voteRoute.POST(pedido(`${WEBINAR}/questions/${dispensada}/vote`, "POST", { sessionId: SESSION }), { params: Promise.resolve({ id: WEBINAR, qid: dispensada }) });
  assert.equal(naDispensada.status, 404, "a dispensada de outro aluno nao aparece, nem para curtir");
  assert.equal(db.tables.webinar_question_votes.length, 0);
  assert.equal(db.tables.webinar_questions.filter((row) => row.user_id === userId).length, 2);

  // Anonima com a opcao desligada no card Sala: 400 (nunca grava com o nome sem avisar).
  const { db: semAnonimas } = montar();
  semAnonimas.tables.webinars.find((row) => row.id === WEBINAR).room_settings.anonymousQuestions = false;
  const desligada = await json(await perguntar({ anonymous: true, body: "posso sem nome?", ...comAceite }));
  assert.equal(desligada.status, 400);
  assert.match(desligada.body.error, /anônimas estão desligadas/);
  assert.equal(semAnonimas.tables.webinar_questions.length, 0);

  // Curtir fora da hora da sessao (a gravada acabou): 409 ended.
  const { db: encerrada } = montar({ scheduledAt: Date.now() - 2 * HOUR });
  const antiga = randomUUID();
  encerrada.tables.webinar_questions.push({ anonymous: false, body: "antiga", created_at: iso(Date.now() - HOUR), deleted_at: null, display_name: "Zé", id: antiga, offset_ms: 0, session_id: SESSION, status: "open", upvotes: 0, user_id: deOutro });
  const tarde = await json(await voteRoute.POST(pedido(`${WEBINAR}/questions/${antiga}/vote`, "POST", { sessionId: SESSION }), { params: Promise.resolve({ id: WEBINAR, qid: antiga }) }));
  assert.equal(tarde.status, 409);
  assert.equal(tarde.body.reason, "ended");
  assert.equal(encerrada.tables.webinar_question_votes.length, 0);
});

test("enquetes: a aberta com myOptionIds nulo; 201 na resposta; a segunda e 409; encerrada 409 poll_closed; opcao invalida 400; o resultado so compartilhado", async () => {
  const { db } = montar();
  const poll = (id, extra = {}) => ({ anonymous: false, closed_at: null, created_at: iso(Date.now()), created_by: null, id, kind: "single", open_offset_ms: 0, opened_at: iso(Date.now()), position: 0, question: "Gostou?", results_shared_at: null, session_id: SESSION, status: "open", template_poll_id: null, updated_at: iso(Date.now()), webinar_id: WEBINAR, ...extra });
  const ABERTA = "dddddddd-0000-4000-8000-000000000001";
  const FECHADA = "dddddddd-0000-4000-8000-000000000002";
  const MODELO = "dddddddd-0000-4000-8000-000000000003";
  const SIM = "dddddddd-0000-4000-8000-00000000000a";
  const NAO = "dddddddd-0000-4000-8000-00000000000b";
  db.tables.webinar_polls.push(poll(ABERTA), poll(FECHADA, { closed_at: iso(Date.now()), results_shared_at: iso(Date.now()), status: "closed" }), poll(MODELO, { session_id: null, status: "draft" }));
  db.tables.webinar_poll_options.push(
    { created_at: iso(Date.now()), id: SIM, label: "Sim", poll_id: ABERTA, position: 0 },
    { created_at: iso(Date.now()), id: NAO, label: "Não", poll_id: ABERTA, position: 1 },
    { created_at: iso(Date.now()), id: "dddddddd-0000-4000-8000-00000000000c", label: "A", poll_id: FECHADA, position: 0 }
  );
  db.tables.webinar_poll_answers.push({ created_at: iso(Date.now()), deleted_at: null, id: randomUUID(), offset_ms: 0, option_ids: ["dddddddd-0000-4000-8000-00000000000c"], poll_id: FECHADA, session_id: SESSION, user_id: "11111111-1111-4111-8111-111111111111" });

  const lista = await json(await pollsRoute.GET(pedido(`${WEBINAR}/polls?sessao=${SESSION}`), contexto()));
  assert.equal(lista.status, 200, JSON.stringify(lista.body));
  assert.deepEqual(
    lista.body.data.polls.map((item) => [item.id, item.status, item.myOptionIds, item.results]),
    [
      [ABERTA, "open", null, null],
      [FECHADA, "closed", null, { counts: { "dddddddd-0000-4000-8000-00000000000c": 1 }, total: 1 }]
    ],
    "o modelo fica de fora; a encerrada vem com o resultado compartilhado"
  );

  const responder = async (body) => json(await pollsRoute.POST(pedido(`${WEBINAR}/polls`, "POST", { sessionId: SESSION, ...body }), contexto()));
  const invalida = await responder({ optionIds: [randomUUID()], pollId: ABERTA });
  assert.equal(invalida.status, 400);
  const duas = await responder({ optionIds: [SIM, NAO], pollId: ABERTA });
  assert.equal(duas.status, 400, "resposta unica");
  const ok = await responder({ optionIds: [SIM], pollId: ABERTA });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.data.poll.myOptionIds, [SIM]);
  assert.equal(ok.body.data.poll.results, null, "sem resultado ate a equipe compartilhar");
  assert.deepEqual(eventos(db, "webinar_poll_answered")[0].metadata, { offset_ms: db.tables.webinar_poll_answers.at(-1).offset_ms, options: 1, poll_id: ABERTA });
  const repetida = await responder({ optionIds: [NAO], pollId: ABERTA });
  assert.equal(repetida.status, 409);
  const fechada = await responder({ optionIds: ["dddddddd-0000-4000-8000-00000000000c"], pollId: FECHADA });
  assert.equal(fechada.status, 409);
  assert.equal(fechada.body.reason, "poll_closed");
  const deOutraSessao = await responder({ optionIds: [SIM], pollId: ABERTA, sessionId: REPLAY });
  assert.equal(deOutraSessao.status, 404);
});

/* ------------------------------------------------------------------------------------------------
 * A sessao com os campos da sala
 * ---------------------------------------------------------------------------------------------- */

test("GET session: os campos da fase 2 (relogio, fase, entrada, modo do chat, selo, video da Bunny montado no servidor, fixada, enquetes, presentes, aceite, replay)", async () => {
  const { db, userId } = montar({ scheduledAt: Date.now() - 2 * MIN });
  db.tables.webinar_chat_messages.push({ approved: true, author_user_id: null, body: "link da apostila", created_at: iso(Date.now()), deleted_at: null, display_name: "Equipe", id: "cccccccc-aaaa-4000-8000-000000000009", kind: "message", master: false, offset_ms: 1000, pinned_at: iso(Date.now()), reply_to_id: null, role: "team", script_item_id: null, session_id: SESSION, source: "team", webinar_id: WEBINAR });
  db.tables.webinar_sessions.find((row) => row.id === SESSION).pinned_message_id = "cccccccc-aaaa-4000-8000-000000000009";
  db.tables.webinar_presence_samples.push({ bucket: 4, first_at: iso(Date.now()), last_at: iso(Date.now()), offset_seconds: 120, samples: 1, session_id: SESSION, state: "playing", user_id: "11111111-1111-4111-8111-111111111111" });

  const resposta = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  const { data } = resposta.body;
  assert.equal(data.session.id, SESSION);
  assert.equal(data.session.kind, "simulated");
  assert.equal(data.session.phase, "waiting", "a fase 1 continua (hora marcada chegou e a equipe nao abriu)");
  assert.equal(data.session.roomPhase, "live");
  assert.deepEqual(data.session.join, { ok: true });
  assert.ok(data.session.offsetMs >= 119_000 && data.session.offsetMs <= 125_000, `offset autoritativo (${data.session.offsetMs})`);
  assert.equal(data.session.durationMs, 3_600_000, "a duracao da gravacao");
  assert.equal(data.session.chatMode, "open");
  assert.equal(data.session.chatSlowModeSeconds, null);
  assert.equal(data.session.showLiveBadge, true);
  assert.equal(data.webinar.replaySessionId, REPLAY);
  assert.equal(data.presentNow, 1);
  assert.deepEqual(data.me, { calendarUrl: null, consented: false, displayMode: null, displayName: null, nickname: null, registered: false, registeredAt: null });
  assert.equal(data.pinned.body, "link da apostila");
  assert.equal(data.pinned.pinned, true);
  assert.deepEqual(data.polls, []);
  const video = new URL(data.video.embedUrl);
  assert.equal(data.video.provider, "bunny");
  assert.equal(video.origin + video.pathname, "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc");
  assert.equal(video.searchParams.get("autoplay"), "true");
  assert.equal(video.searchParams.get("muted"), "true");
  assert.equal(video.searchParams.get("controls"), "false", "sem barra na gravada");
  assert.ok(Number(video.searchParams.get("t")) >= 119, "entra no segundo atual");
  assert.equal(video.searchParams.get("token"), null, "sem BUNNY_EMBED_TOKEN_KEY nao ha token");

  // O replay: player livre (com barra, sem autoplay), sem relogio.
  const replay = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${REPLAY}`), contexto()));
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.data.session.kind, "replay");
  assert.equal(replay.body.data.session.offsetMs, null);
  assert.equal(replay.body.data.session.roomPhase, null);
  assert.deepEqual(replay.body.data.session.join, { ok: true });
  const livre = new URL(replay.body.data.video.embedUrl);
  assert.equal(livre.searchParams.get("controls"), null);
  assert.equal(livre.searchParams.get("autoplay"), "false");

  // Com o aceite gravado, `me` traz como o aluno aparece.
  assert.equal((await enviar({ body: "oi", displayMode: "nickname", nickname: "aninha", ...comAceite })).status, 201);
  const depois = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.deepEqual(depois.body.data.me, { calendarUrl: null, consented: true, displayMode: "nickname", displayName: "aninha", nickname: "aninha", registered: false, registeredAt: null });
  assert.equal(db.tables.webinar_chat_consents[0].user_id, userId);

  assert.equal(data.session.anonymousQuestions, true, "a opcao Anonima das perguntas vem do card Sala");

  // Antes de 15 min da hora, a sala nao abre (join) e o video (com o token da Bunny) nao sai; a sessao responde.
  montar({ scheduledAt: Date.now() + HOUR });
  const cedo = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.deepEqual(cedo.body.data.session.join, { ok: false, reason: "not_started" });
  assert.equal(cedo.body.data.session.roomPhase, "waiting");
  assert.equal(cedo.body.data.video, null, "sem video fora da entrada");
  montar({ scheduledAt: Date.now() - 2 * HOUR });
  const tarde = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.deepEqual(tarde.body.data.session.join, { ok: false, reason: "ended" });
  assert.equal(tarde.body.data.video, null, "nem depois do fim");

  // O replay que a equipe cancelou some: a sessao e as rotas da sala respondem 404.
  const { db: semReplay } = montar();
  semReplay.tables.webinar_sessions.find((row) => row.id === REPLAY).status = "cancelled";
  assert.equal((await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${REPLAY}`), contexto())).status, 404);
  assert.equal((await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${REPLAY}&from=0&to=1000`), contexto())).status, 404);
  assert.equal((await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 0, sessionId: REPLAY }), contexto())).status, 404);
});

test("limite de vagas (A12): so quem garantiu a vaga entra; sem ela, as rotas da sala respondem 403 e a sessao diz no_seat sem o video; o replay nao pede vaga", async () => {
  const { db, userId } = montar();
  Object.assign(db.tables.webinars.find((row) => row.id === WEBINAR), { capacity: 50, registration_required: true });

  const semVaga = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.equal(semVaga.status, 200, JSON.stringify(semVaga.body));
  assert.deepEqual(semVaga.body.data.session.join, { ok: false, reason: "no_seat" });
  assert.equal(semVaga.body.data.video, null);
  const chat = await json(await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=0&to=1000`), contexto()));
  assert.equal(chat.status, 403);
  assert.match(chat.body.error, /só entra quem garantiu a vaga/);
  assert.equal((await enviar({ body: "oi", ...comAceite })).status, 403);
  assert.equal((await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 0, sessionId: SESSION }), contexto())).status, 403);
  assert.equal(db.tables.webinar_presence_samples.length, 0);

  const replay = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${REPLAY}`), contexto()));
  assert.deepEqual(replay.body.data.session.join, { ok: true }, "o replay e de quem tem acesso");

  db.tables.webinar_registrations.push({ calendar_token: "tok", cancelled_at: null, created_at: iso(Date.now()), id: randomUUID(), registered_at: iso(Date.now() - HOUR), reminder_1h_sent_at: null, reminder_24h_sent_at: null, session_id: SESSION, source: null, source_campaign_id: null, started_notice_sent_at: null, status: "registered", updated_at: iso(Date.now()), user_id: userId, webinar_id: WEBINAR });
  heartbeatRoute.resetHeartbeatAccessCache();
  const comVaga = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${SESSION}`), contexto()));
  assert.deepEqual(comVaga.body.data.session.join, { ok: true });
  assert.ok(comVaga.body.data.video, "com a vaga, o video");
  assert.equal((await chatRoute.GET(pedido(`${WEBINAR}/chat?sessao=${SESSION}&from=0&to=1000`), contexto())).status, 200);
  assert.equal((await enviar({ body: "oi", ...comAceite })).status, 201);
});
