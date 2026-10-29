import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// As rotas do aluno da sala ao vivo (docs/30 §1.3, §1.4, §4.7, §5.1, §5.4, §6.3, §8.1 a §8.3, D14, D15, D16 e D19;
// docs/18 §2.2), sem banco: o mesmo banco falso em memoria de tests/webinarios-sala-rotas.test.mjs, agora com
// webinar_session_bans, webinar_user_bans, webinar_presenters e admin_roles (o caminho real le todas). Aqui: o
// join-token (401, 404 fora do acesso / outro webinario / sessao gravada, 503 sem a sala ao vivo, 409 not_started do
// aluno na agendada, 200 na espera e no ar com as claims conferidas por verifyJitsiToken, o nome da sala gerado quando
// faltava, o papel pela regra unica e o moderator so de quem pode, a equipe na Sessao de pratica, removido 409 kicked,
// banido 409 banned, webinar_joined uma vez por abertura); os sinais do iframe (202 com os event_type combinados e so
// codigos, lote de 21 e nome desconhecido 400, removido 409, 6 lotes por minuto); os banimentos nas escritas da sala
// (silenciado: chat e pergunta 409 muted ate o prazo, reacao, curtida e enquete passam; removido e banido: tudo 409
// banned; fora da live so o banido de todos, 409 banned na gravada e no replay); a presenca da live (balde desde started_at, nunca a ancora, sem
// webinar_joined, a sessao relida, `kicked` na saida de quem foi removido); e GET .../session da live (bloco `live`
// sem o nome da sala, `me.ban`, a entrada recusada, os presentes pelo relogio da presenca).

const sessao = (globalThis.__salaAoVivoSessao ??= { user: null });

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

// A sessao das rotas (requireApiUser / requireApiSessionUser) vem do teste; o cliente do banco (pelo alias nas rotas e
// em admin-access.ts, e por caminho relativo em src/server/webinars/db.ts) e o banco falso de admin-action-stubs.
registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__salaAoVivoSessao.user;
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

const MEET = "meet.bunker707.test";
const SECRET = "s".repeat(48);
process.env.WEBINAR_MEET_DOMAIN = MEET;
process.env.WEBINAR_JWT_SECRET = SECRET;
delete process.env.WEBINAR_JWT_APP_ID;

const joinTokenRoute = await import("../src/app/api/webinars/[id]/join-token/route.ts");
const roomEventsRoute = await import("../src/app/api/webinars/[id]/room-events/route.ts");
const chatRoute = await import("../src/app/api/webinars/[id]/chat/route.ts");
const heartbeatRoute = await import("../src/app/api/webinars/[id]/heartbeat/route.ts");
const reactionsRoute = await import("../src/app/api/webinars/[id]/reactions/route.ts");
const questionsRoute = await import("../src/app/api/webinars/[id]/questions/route.ts");
const voteRoute = await import("../src/app/api/webinars/[id]/questions/[qid]/vote/route.ts");
const pollsRoute = await import("../src/app/api/webinars/[id]/polls/route.ts");
const sessionRoute = await import("../src/app/api/webinars/[id]/session/route.ts");
const liveRoom = await import("../src/server/webinars/live-room.ts");
const { resetRoomLimits } = await import("../src/server/webinars/room-limits.ts");
const { CHAT_CONSENT_VERSION } = await import("../src/server/webinars/model.ts");
const { ROOM_EVENT_TYPES } = await import("../src/server/webinars/live-model.ts");
const { isRoomName, verifyJitsiToken } = await import("../src/server/webinars/jitsi-token.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const MIN = 60_000;
const HOUR = 60 * MIN;
const WEBINAR = "eeeeeeee-0000-4000-8000-000000000001";
const LIVE = "eeeeeeee-0000-4000-8000-000000000002";
const GRAVADA = "eeeeeeee-0000-4000-8000-000000000003";
const REPLAY = "eeeeeeee-0000-4000-8000-000000000004";
const OTHER_WEBINAR = "eeeeeeee-0000-4000-8000-000000000005";
const OTHER_SESSION = "eeeeeeee-0000-4000-8000-000000000006";
const EMAIL = "ana@bunker707.test";
const iso = (time) => new Date(time).toISOString();
let proximoAluno = 100;

/** Uma pessoa nova por chamada: o teto global de escritas e por pessoa e vive no modulo. */
function novaPessoa() {
  proximoAluno += 1;
  const id = `66666666-6666-4666-8666-${String(proximoAluno).padStart(12, "0")}`;
  sessao.user = { id };
  return id;
}

/* ------------------------------------------------------------------------------------------------
 * Banco falso (o de tests/webinarios-sala-rotas.test.mjs)
 * ---------------------------------------------------------------------------------------------- */

const UNIQUE = {
  webinar_chat_consents: [["user_id"]],
  webinar_poll_answers: [["poll_id", "user_id"]],
  webinar_presence_samples: [["session_id", "user_id", "bucket"]],
  webinar_question_votes: [["question_id", "user_id"]],
  webinar_session_bans: [["session_id", "user_id", "kind"]],
  webinar_user_bans: [["user_id"]]
};
const NO_ID = new Set(["webinar_attendance", "webinar_chat_consents", "webinar_presence_samples", "webinar_question_votes", "webinar_session_bans", "webinar_user_bans", "webinar_presenters"]);
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
  // "metadata->>participant_id": o campo de dentro do jsonb, como o PostgREST le.
  const [base, path] = column.split("->>");
  const current = path === undefined ? row[column] : (row[base] ?? {})[path];
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

function bancoFalso({ tables = {} } = {}) {
  const calls = { from: [], rpc: [], writes: [] };
  const table = (name) => (tables[name] ??= []);

  function violates(name, row) {
    return (UNIQUE[name] ?? []).some((keys) => table(name).some((existing) => keys.every((key) => existing[key] === row[key])));
  }

  function query(name) {
    const state = { count: null, filters: [], head: false, limit: null, op: null, order: [], payload: null, range: null, single: null, upsertKeys: null };

    function stamp(row) {
      const now = iso(Date.now());
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
            Object.assign(existing, payload, { updated_at: iso(Date.now()) });
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
        touched.forEach((row) => Object.assign(row, state.payload, { updated_at: iso(Date.now()) }));
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
      not: () => chain,
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
      const run = () => (name === "communication_webinar_facts" ? { data: webinarFacts(args?.p_user_ids ?? null), error: null } : { data: null, error: null });
      const chain = { order: () => chain, range: () => chain, then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject) };
      return chain;
    },
    tables
  };

  /** A RPC das lives de cada aluno (202610300001): uma linha por aluno, com as lives da vaga 'registered' e da presenca. */
  function webinarFacts(users) {
    const wanted = (userId) => users === null || users.includes(userId);
    const sessionWebinar = new Map(table("webinar_sessions").map((row) => [row.id, row.webinar_id]));
    const byUser = new Map();
    const add = (userId, webinarId, key) => {
      if (!webinarId || !wanted(userId)) {
        return;
      }
      const own = byUser.get(userId) ?? { attended: null, registered: null, user_id: userId };
      own[key] = [...new Set([...(own[key] ?? []), webinarId])];
      byUser.set(userId, own);
    };
    table("webinar_registrations").filter((row) => row.status === "registered").forEach((row) => add(row.user_id, row.webinar_id, "registered"));
    table("webinar_attendance").forEach((row) => add(row.user_id, sessionWebinar.get(row.session_id), "attended"));
    return [...byUser.values()];
  }
}

/* ------------------------------------------------------------------------------------------------
 * A escola de mentira: uma Live ao vivo publicada para todos, no ar ha 95 s, gravando ha 30 s
 * ---------------------------------------------------------------------------------------------- */

function escola({ accessMode = "everyone", anchorAgoMs = 30_000, audience = { kind: "everyone" }, durationMinutes = 60, roomName = null, scheduledAgoMs = 2 * MIN, startedAgoMs = 95_000, status = "live" } = {}) {
  const now = Date.now();
  const webinar = (id, extra = {}) => ({
    // O "both" grava 'product' + audience_restricts (202610300001).
    access_mode: accessMode === "both" ? "product" : accessMode,
    allow_student_camera: true,
    audience,
    audience_restricts: accessMode === "both",
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
    duration_minutes: durationMinutes,
    host_user_id: null,
    id,
    kind: "live",
    product_id: accessMode === "product" || accessMode === "both" ? "curso-x" : null,
    published_at: iso(now - HOUR),
    quality: { screenFps: 15, stage: 1080 },
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
    slug: "live-ao-vivo",
    status: "published",
    title: "Live ao vivo",
    updated_at: iso(now - HOUR),
    ...extra
  });
  const session = (id, extra = {}) => ({
    chat_mode: "open",
    chat_slow_mode_seconds: null,
    created_at: iso(now - HOUR),
    ended_at: null,
    id,
    kind: "live",
    late_join_minutes: null,
    pinned_message_id: null,
    presence_curve: null,
    recorder_alerted_at: null,
    recorder_release_requested_at: null,
    recorder_requested_at: null,
    recorder_status: "none",
    recording_anchor_at: null,
    recording_id: null,
    recording_requested_at: null,
    room_locked: false,
    room_name: null,
    scheduled_at: iso(now - 2 * MIN),
    script_fired_at: null,
    show_live_badge: true,
    simulation_ack_text: null,
    simulation_decided_at: null,
    simulation_decided_by: null,
    source_session_id: null,
    started_at: null,
    status: "scheduled",
    updated_at: iso(now - HOUR),
    webinar_id: WEBINAR,
    ...extra
  });
  const noAr = status === "live" || status === "ended";
  return {
    admin_functions: [],
    admin_roles: [],
    entitlements: [],
    lesson_comment_blocked_words: [],
    profiles: [],
    student_events: [],
    webinar_chat_consents: [],
    webinar_chat_messages: [],
    webinar_poll_answers: [],
    webinar_poll_options: [],
    webinar_polls: [],
    webinar_presence_samples: [],
    webinar_presenters: [],
    webinar_question_votes: [],
    webinar_questions: [],
    webinar_reactions: [],
    webinar_recordings: [],
    webinar_registrations: [],
    webinar_session_bans: [],
    webinar_sessions: [
      session(LIVE, {
        ended_at: status === "ended" ? iso(now - MIN) : null,
        recorder_status: anchorAgoMs === null ? "none" : "recording",
        recording_anchor_at: noAr && anchorAgoMs !== null ? iso(now - anchorAgoMs) : null,
        room_name: roomName,
        scheduled_at: iso(now - scheduledAgoMs),
        started_at: noAr ? iso(now - startedAgoMs) : null,
        status
      }),
      session(GRAVADA, { kind: "simulated", scheduled_at: iso(now - 10 * MIN) }),
      session(REPLAY, { kind: "replay", scheduled_at: iso(now - HOUR), status: "live" }),
      session(OTHER_SESSION, { webinar_id: OTHER_WEBINAR })
    ],
    webinar_user_bans: [],
    webinars: [webinar(WEBINAR), webinar(OTHER_WEBINAR, { slug: "outra-live", title: "Outra live" })]
  };
}

function montar(options) {
  resetRoomLimits();
  heartbeatRoute.resetHeartbeatAccessCache();
  const db = bancoFalso({ tables: escola(options) });
  actionStubs.db = db;
  const userId = novaPessoa();
  perfil(db, userId);
  return { db, userId };
}

function perfil(db, userId, fullName = "Ana Maria Souza") {
  db.tables.profiles.push({ avatar_url: "https://cdn.bunker707.test/ana.png", created_at: iso(Date.now()), email: EMAIL, full_name: fullName, id: userId, last_sign_in_at: null, phone: null });
}

/** Uma pessoa da equipe (admin_roles) como a sessao atual. */
function daEquipe(db, role = "editor", fullName = "Bruno Lima Castro") {
  const id = novaPessoa();
  perfil(db, id, fullName);
  db.tables.admin_roles.push({ permissions: {}, role, user_id: id });
  return id;
}

const contexto = (id = WEBINAR) => ({ params: Promise.resolve({ id }) });
const pedido = (path, method = "GET", body, headers = {}) =>
  new Request(`http://localhost/api/webinars/${path}`, body === undefined ? { headers, method } : { body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers }, method });
const json = async (response) => ({ body: await response.json(), headers: response.headers, status: response.status });
const eventos = (db, type) => db.tables.student_events.filter((row) => row.event_type === type);
const sessaoLive = (db) => db.tables.webinar_sessions.find((row) => row.id === LIVE);

async function token(sessionId = LIVE, headers = {}) {
  return json(await joinTokenRoute.POST(pedido(`${WEBINAR}/join-token`, "POST", { sessionId }, headers), contexto()));
}

async function sinais(events, sessionId = LIVE) {
  return json(await roomEventsRoute.POST(pedido(`${WEBINAR}/room-events`, "POST", { events, sessionId }), contexto()));
}

const comAceite = { consent: true, consentVersion: CHAT_CONSENT_VERSION };
const IPHONE = { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" };

/** As claims do token da resposta, conferidas pela assinatura. */
function claimsDe(resposta) {
  const claims = verifyJitsiToken(resposta.body.data.jwt, SECRET);
  assert.ok(claims, "o token confere com o segredo do servidor");
  return claims;
}

function perto(atual, esperado, folga, rotulo) {
  assert.ok(Math.abs(atual - esperado) <= folga, `${rotulo}: ${atual} perto de ${esperado}`);
}

/* ------------------------------------------------------------------------------------------------
 * join-token
 * ---------------------------------------------------------------------------------------------- */

test("join-token: 401 sem sessao; 400 sem sessionId; 404 fora do acesso, sessao de outro webinario, sessao gravada e replay; 503 sem WEBINAR_MEET_DOMAIN", async () => {
  montar();
  sessao.user = null;
  assert.equal((await token()).status, 401);

  novaPessoa();
  const semSessao = await json(await joinTokenRoute.POST(pedido(`${WEBINAR}/join-token`, "POST", {}), contexto()));
  assert.equal(semSessao.status, 400);
  assert.equal((await token(OTHER_SESSION)).status, 404, "sessao de outro webinario");
  const gravada = await token(GRAVADA);
  assert.equal(gravada.status, 404, "a gravada nao tem sala ao vivo");
  assert.equal(gravada.body.error, "Sessão inválida.");
  assert.equal((await token(REPLAY)).status, 404, "nem o replay");

  const { db } = montar({ accessMode: "product" });
  const semAcesso = await token();
  assert.equal(semAcesso.status, 404, "fora do acesso: 404 sem dizer se existe");
  assert.ok(db.calls.from.includes("entitlements"), "leu os acessos do aluno");
  assert.equal(sessaoLive(db).room_name, null, "nada gravado para quem nao entra");

  const { db: semMeet } = montar();
  const dominio = process.env.WEBINAR_MEET_DOMAIN;
  delete process.env.WEBINAR_MEET_DOMAIN;
  try {
    const embreve = await token();
    assert.equal(embreve.status, 503);
    assert.deepEqual(embreve.body, { error: WEBINAR_COPY.aoVivo.emBreve, reason: "meet_unconfigured" });
    const sessaoSemMeet = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${LIVE}`), contexto()));
    assert.equal(sessaoSemMeet.body.data.live.meetConfigured, false, "a sala mostra em breve");
  } finally {
    process.env.WEBINAR_MEET_DOMAIN = dominio;
  }
  assert.equal(semMeet.tables.student_events.length, 0);
});

test("join-token em 'Quem tem o produto e está no segmento': 404 so com o produto ou so com o segmento, 200 com os dois; a vaga segura o segmento, nunca o produto", async () => {
  // Segmento: entrou na area nos ultimos 7 dias.
  const audience = { kind: "rules", root: { items: [{ days: 7, op: "within", type: "sign_in" }], match: "all" } };
  const acesso = (userId) => ({ created_at: iso(Date.now() - 30 * 24 * HOUR), ends_at: null, id: randomUUID(), starts_at: iso(Date.now() - 30 * 24 * HOUR), status: "active", target_id: "curso-x", target_type: "standalone_course", user_id: userId });
  const noSegmento = (db, userId) => {
    db.tables.profiles.find((row) => row.id === userId).last_sign_in_at = iso(Date.now() - HOUR);
  };

  const { db, userId } = montar({ accessMode: "both", audience });
  const nenhum = await token();
  assert.equal(nenhum.status, 404, "sem o produto e fora do segmento");
  assert.equal(nenhum.body.error, WEBINAR_COPY.aluno.naoDisponivel, "404 sem dizer se existe");

  db.tables.entitlements.push(acesso(userId));
  assert.equal((await token()).status, 404, "so o produto: o segmento restringe");

  const soSegmento = novaPessoa();
  perfil(db, soSegmento);
  noSegmento(db, soSegmento);
  assert.equal((await token()).status, 404, "so o segmento: nao abre a live a quem nao tem o produto");

  const osDois = novaPessoa();
  perfil(db, osDois);
  noSegmento(db, osDois);
  db.tables.entitlements.push(acesso(osDois));
  const entrou = await token();
  assert.equal(entrou.status, 200, JSON.stringify(entrou.body));
  assert.ok(claimsDe(entrou).room, "o token da sala");
  assert.equal(sessaoLive(db).room_name !== null, true);

  // A ancora: com o produto e a vaga garantida neste webinario, fora do segmento continua entrando.
  const comVaga = novaPessoa();
  perfil(db, comVaga);
  db.tables.entitlements.push(acesso(comVaga));
  db.tables.webinar_registrations.push({ calendar_token: randomUUID().replaceAll("-", ""), id: randomUUID(), registered_at: iso(Date.now() - 24 * HOUR), session_id: null, status: "registered", user_id: comVaga, webinar_id: WEBINAR });
  assert.equal((await token()).status, 200, "a vaga segura o segmento");
  assert.ok(db.calls.rpc.some((call) => call.name === "communication_webinar_facts" && JSON.stringify(call.args) === JSON.stringify({ p_user_ids: [comVaga] })), "as lives so da propria pessoa");

  // Reembolsado: a vaga (e ate o segmento) nao seguram o produto.
  const reembolsado = novaPessoa();
  perfil(db, reembolsado);
  noSegmento(db, reembolsado);
  db.tables.entitlements.push({ ...acesso(reembolsado), status: "revoked" });
  db.tables.webinar_registrations.push({ calendar_token: randomUUID().replaceAll("-", ""), id: randomUUID(), registered_at: iso(Date.now() - 24 * HOUR), session_id: null, status: "registered", user_id: reembolsado, webinar_id: WEBINAR });
  assert.equal((await token()).status, 404, "o produto e conferido a cada renovacao do token");
  assert.ok(!db.calls.rpc.some((call) => call.name === "communication_comment_counts"), "nada da contagem de comentarios de todos os alunos");
});

test("join-token do aluno: 409 not_started na agendada; 200 na espera e no ar com as claims da regra (iss, aud, sub, room, nbf, exp), sem moderator, o nome sem e-mail e o nome da sala gerado uma vez", async () => {
  const { db } = montar({ status: "scheduled" });
  const cedo = await token();
  assert.equal(cedo.status, 409);
  assert.equal(cedo.body.reason, "not_started");
  assert.equal(cedo.body.error, WEBINAR_COPY.sala.naoComecou);
  assert.equal(sessaoLive(db).room_name, null);

  // Com a Sessao de pratica (o padrao do card Sala), a sala aberta e so da equipe: o aluno espera fora (D35).
  sessaoLive(db).status = "waiting";
  const pratica = await token();
  assert.equal(pratica.status, 409, JSON.stringify(pratica.body));
  assert.equal(pratica.body.reason, "not_started");
  db.tables.webinars[0].room_settings.practiceSession = false;
  const espera = await token();
  assert.equal(espera.status, 200, JSON.stringify(espera.body));
  const sala = sessaoLive(db).room_name;
  assert.ok(isRoomName(sala), `o nome da sala gerado agora (${sala})`);
  assert.ok(sala.startsWith(`w-${WEBINAR}-`));
  assert.equal(espera.body.data.room, sala);

  const { db: noAr, userId } = montar();
  const antes = Date.now();
  const resposta = await token();
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  const { data } = resposta.body;
  assert.equal(data.domain, MEET);
  assert.equal(data.role, "student");
  assert.deepEqual(data.settings, { allowStudentCamera: true, screenFps: 15, stage: 1080 }, "o card Qualidade e o card Sala");
  const claims = claimsDe(resposta);
  const agora = Math.floor(antes / 1000);
  assert.equal(claims.iss, "bunker707");
  assert.equal(claims.aud, "bunker707");
  assert.equal(claims.sub, MEET);
  assert.equal(claims.room, sessaoLive(noAr).room_name);
  assert.equal(claims.room, data.room);
  perto(claims.nbf, agora - 60, 2, "nbf = agora - 60 s");
  // No ar ha 95 s, 60 min previstos: o fim previsto + 30 min e daqui a 88 min; o token curto vence antes (agora + 15 min):
  // o Remover e o Banir nao revogam o token que o navegador ja tem (seguranca-01).
  perto(claims.exp, agora + 15 * 60, 2, "exp = agora + 15 min");
  assert.deepEqual(claims.context.user, { id: userId, name: "Ana S." }, "primeiro nome + inicial, sem e-mail nem avatar");
  assert.deepEqual(
    claims.context.features,
    { livestreaming: false, "outbound-call": false, recording: false, "screen-sharing": false },
    "o aluno tambem leva as features: sem a claim o Jitsi deixa compartilhar a tela"
  );
  assert.equal(data.expiresAt, new Date(claims.exp * 1000).toISOString());
  assert.equal(data.refreshAt, new Date(claims.exp * 1000 - 5 * MIN).toISOString(), "pede outro 5 min antes do exp");
  assert.ok(!JSON.stringify(data).includes(EMAIL));

  // O segundo token usa a mesma sala (nunca gera outra).
  assert.equal((await token()).body.data.room, data.room);

  // Com o aceite do chat, o nome do chat (apelido); com o card Sala anonimo e sem aceite, "Aluno {n}".
  noAr.tables.webinar_chat_consents.push({ consent_version: CHAT_CONSENT_VERSION, display_mode: "nickname", nickname: "aninha", revoked_at: null, user_id: userId });
  assert.equal(claimsDe(await token()).context.user.name, "aninha");
  const { db: anonimo } = montar();
  anonimo.tables.webinars[0].room_settings.displayName = "anonymous";
  assert.match(claimsDe(await token()).context.user.name, /^Aluno \d{3}$/);
});

test("join-token: o exp nunca passa de agora + 15 min, nem numa live longa nem na que passou da duracao prevista", async () => {
  montar({ durationMinutes: 600 });
  const antes = Math.floor(Date.now() / 1000);
  perto(claimsDe(await token()).exp, antes + 15 * 60, 2, "exp = agora + 15 min");

  montar({ scheduledAgoMs: 2 * HOUR + 5 * MIN, startedAgoMs: 2 * HOUR });
  const depois = Math.floor(Date.now() / 1000);
  const atrasada = await token();
  assert.equal(atrasada.status, 200);
  perto(claimsDe(atrasada).exp, depois + 15 * 60, 2, "exp = agora + 15 min (o fim previsto + 30 min ficou para tras)");
  assert.equal(atrasada.body.data.refreshAt, new Date(claimsDe(atrasada).exp * 1000 - 5 * MIN).toISOString(), "pede outro 5 min antes");
});

test("papeis pela regra unica: host (moderator, grava, tela), co-apresentador (moderator, tela), Equipe da sala com e sem can_moderate_room, Equipe por messaging.write, apresentador vencido e host sem messaging.publish viram aluno; a equipe entra na Sessao de pratica", async () => {
  const { db } = montar({ status: "scheduled" });
  const papelDe = async () => {
    const resposta = await token();
    return resposta.status === 200 ? { claims: claimsDe(resposta), role: resposta.body.data.role, status: 200 } : { reason: resposta.body.reason, status: resposta.status };
  };

  const host = daEquipe(db);
  db.tables.webinars[0].host_user_id = host;
  const doHost = await papelDe();
  assert.equal(doHost.status, 200, "o host entra na Sessao de pratica (agendada)");
  assert.equal(doHost.role, "host");
  assert.equal(doHost.claims.context.user.moderator, true);
  assert.equal(doHost.claims.context.user.affiliation, "owner");
  assert.equal(doHost.claims.context.user.name, "Bruno C.", "a equipe com primeiro nome + inicial");
  assert.deepEqual(doHost.claims.context.features, { livestreaming: false, "outbound-call": false, recording: true, "screen-sharing": true });

  const coHost = novaPessoa();
  perfil(db, coHost, "Carla Dias");
  db.tables.webinar_presenters.push({ can_moderate_room: false, created_at: iso(Date.now()), role: "co_host", user_id: coHost, valid_until: null, webinar_id: WEBINAR });
  const doCoHost = await papelDe();
  assert.equal(doCoHost.role, "co_host");
  assert.equal(doCoHost.claims.context.user.moderator, true);
  assert.deepEqual(doCoHost.claims.context.features, { livestreaming: false, "outbound-call": false, recording: false, "screen-sharing": true });

  const moderadora = novaPessoa();
  perfil(db, moderadora);
  db.tables.webinar_presenters.push({ can_moderate_room: true, created_at: iso(Date.now()), role: "team", user_id: moderadora, valid_until: null, webinar_id: WEBINAR });
  const daModeradora = await papelDe();
  assert.equal(daModeradora.role, "team");
  assert.equal(daModeradora.claims.context.user.moderator, true, "Pode remover e silenciar na sala");

  const naoModera = novaPessoa();
  perfil(db, naoModera);
  db.tables.webinar_presenters.push({ can_moderate_room: false, created_at: iso(Date.now()), role: "team", user_id: naoModera, valid_until: null, webinar_id: WEBINAR });
  const semModerar = await papelDe();
  assert.equal(semModerar.role, "team");
  assert.equal(semModerar.claims.context.user.moderator, undefined);

  daEquipe(db);
  const equipe = await papelDe();
  assert.equal(equipe.role, "team", "messaging.write sem estar no editor");
  assert.equal(equipe.claims.context.user.moderator, undefined);
  assert.deepEqual(equipe.claims.context.features, { livestreaming: false, "outbound-call": false, recording: false, "screen-sharing": false });

  daEquipe(db, "support");
  assert.deepEqual(await papelDe(), { reason: "not_started", status: 409 }, "suporte sem messaging.write e aluno");

  const vencido = novaPessoa();
  perfil(db, vencido);
  db.tables.webinar_presenters.push({ can_moderate_room: true, created_at: iso(Date.now()), role: "co_host", user_id: vencido, valid_until: iso(Date.now() - MIN), webinar_id: WEBINAR });
  assert.deepEqual(await papelDe(), { reason: "not_started", status: 409 }, "o prazo do apresentador venceu");

  const exHost = novaPessoa();
  perfil(db, exHost);
  db.tables.webinars[0].host_user_id = exHost;
  assert.deepEqual(await papelDe(), { reason: "not_started", status: 409 }, "host sem messaging.publish nao e host");

  // O papel nunca vem do navegador: o corpo com role e ignorado (o zod so le sessionId).
  novaPessoa();
  const forcado = await json(await joinTokenRoute.POST(pedido(`${WEBINAR}/join-token`, "POST", { role: "host", sessionId: LIVE }), contexto()));
  assert.equal(forcado.status, 409);
  assert.equal(db.tables.student_events.length, 0, "a equipe na sala nao e plateia: nenhum webinar_joined");
});

test("join-token: removido 409 kicked, banido 409 banned, encerrada 409 ended; silenciado entra; a equipe nunca e barrada; a vaga obrigatoria e do aluno", async () => {
  const { db, userId } = montar();
  db.tables.webinar_session_bans.push({ by_user_id: null, created_at: iso(Date.now()), kind: "muted", reason: null, session_id: LIVE, until_at: null, user_id: userId });
  assert.equal((await token()).status, 200, "silenciado no chat continua assistindo");

  db.tables.webinar_session_bans.push({ by_user_id: null, created_at: iso(Date.now()), kind: "kicked", reason: "spam", session_id: LIVE, until_at: null, user_id: userId });
  const removido = await token();
  assert.equal(removido.status, 409);
  assert.equal(removido.body.reason, "kicked");
  assert.equal(removido.body.error, WEBINAR_COPY.aoVivo.removido);
  assert.ok(!("jwt" in removido.body));

  const banido = novaPessoa();
  perfil(db, banido);
  db.tables.webinar_user_bans.push({ by_user_id: null, created_at: iso(Date.now()), reason: null, session_id: OTHER_SESSION, user_id: banido });
  const resposta = await token();
  assert.equal(resposta.status, 409);
  assert.equal(resposta.body.reason, "banned");
  assert.equal(resposta.body.error, WEBINAR_COPY.aoVivo.banido);

  const host = daEquipe(db);
  db.tables.webinars[0].host_user_id = host;
  db.tables.webinar_user_bans.push({ by_user_id: null, created_at: iso(Date.now()), reason: null, session_id: LIVE, user_id: host });
  assert.equal((await token()).status, 200, "a equipe nunca e barrada");

  const { db: encerrada } = montar({ status: "ended" });
  const fim = await token();
  assert.equal(fim.status, 409);
  assert.equal(fim.body.reason, "ended");
  daEquipe(encerrada);
  assert.equal((await token()).body.reason, "ended", "nem a equipe depois do fim");

  const { db: comVagas } = montar();
  Object.assign(comVagas.tables.webinars[0], { capacity: 50, registration_required: true });
  const semVaga = await token();
  assert.equal(semVaga.status, 403);
  assert.match(semVaga.body.error, /só entra quem garantiu a vaga/);
  daEquipe(comVagas);
  assert.equal((await token()).status, 200, "a equipe entra sem vaga");
});

test("webinar_joined uma vez por abertura: o primeiro token grava { kind, device }; o segundo em 90 s nao; o sinal de presenca que chega antes do token tambem abre; depois de 90 s sem sinal, abre de novo", async () => {
  const { db, userId } = montar();
  assert.equal((await token(LIVE, IPHONE)).status, 200);
  assert.deepEqual(
    eventos(db, "webinar_joined").map((row) => [row.user_id, row.entity_type, row.entity_id, row.metadata]),
    [[userId, "webinar", LIVE, { device: "mobile", kind: "live" }]]
  );
  assert.equal((await token()).status, 200);
  assert.equal(eventos(db, "webinar_joined").length, 1, "renovar o token nao e entrada nova");
  const texto = JSON.stringify(db.tables.student_events);
  assert.ok(!texto.includes(EMAIL) && !texto.includes("Ana") && !texto.includes("eyJ"), "nenhum texto, e-mail ou token no historico");

  // A pagina dispara o sinal de presenca e o token juntos: o sinal chegou primeiro.
  const outro = novaPessoa();
  perfil(db, outro);
  const bater = await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 0, sessionId: LIVE, state: "playing", visible: true }), contexto());
  assert.equal(bater.status, 200);
  assert.equal(eventos(db, "webinar_joined").length, 1, "o sinal da live nao grava a entrada");
  assert.equal((await token()).status, 200);
  assert.deepEqual(eventos(db, "webinar_joined").filter((row) => row.user_id === outro).map((row) => row.metadata), [{ device: "desktop", kind: "live" }]);
  assert.equal((await token()).status, 200);
  assert.equal(eventos(db, "webinar_joined").filter((row) => row.user_id === outro).length, 1);

  // Dois minutos depois, sem sinal nenhum: voltou a abrir a sala.
  const depois = await liveRoom.issueJoinToken({ db, now: Date.now() + 2 * MIN, sessionId: LIVE, userAgent: null, userId: outro, webinarId: WEBINAR });
  assert.equal(depois.events.length, 1);
  assert.equal(depois.events[0].event_type, "webinar_joined");
  assert.equal(typeof depois.reply.jwt, "string");
});

/* ------------------------------------------------------------------------------------------------
 * room-events
 * ---------------------------------------------------------------------------------------------- */

test("room-events: 202 com os event_type combinados, so codigos, `at` e `offset_ms` pela ancora; recordingStatusChanged e sinal sem os campos ficam fora; 400 no lote de 21 e no nome desconhecido; 401 sem sessao", async () => {
  const { db, userId } = montar();
  const at = iso(Date.now() - 1000);
  const resposta = await sinais([
    { at, data: { displayName: "Ana Maria Souza", email: EMAIL, participantId: "a1b2c3d4" }, name: "videoConferenceJoined" },
    { at, data: { raised: true }, name: "raiseHandUpdated" },
    { at, data: { muted: false }, name: "audioMuteStatusChanged" },
    { at, data: { consented: true, muted: false }, name: "videoMuteStatusChanged" },
    { at, data: { role: "participant" }, name: "participantRoleChanged" },
    { at, data: { code: "conference.connectionError", fatal: true, message: "texto livre do erro" }, name: "errorOccurred" },
    { at, name: "videoConferenceLeft" },
    { at, data: { on: true }, name: "recordingStatusChanged" },
    { at, data: {}, name: "raiseHandUpdated" }
  ]);
  assert.equal(resposta.status, 202, JSON.stringify(resposta.body));
  assert.deepEqual(resposta.body.data, { accepted: 7 });
  const linhas = db.tables.student_events;
  assert.deepEqual(
    linhas.map((row) => row.event_type),
    ["webinar_room_joined", "webinar_hand_raised", "webinar_mic_toggled", "webinar_camera_toggled", "webinar_room_role", "webinar_room_error", "webinar_room_left"]
  );
  const tipos = new Set(Object.values(ROOM_EVENT_TYPES).filter(Boolean));
  assert.ok(linhas.every((row) => tipos.has(row.event_type) && row.entity_type === "webinar" && row.entity_id === LIVE && row.user_id === userId));
  const semRelogio = linhas.map(({ metadata }) => {
    const { at: quando, offset_ms: offset, ...resto } = metadata;
    assert.equal(quando, at);
    perto(offset, 30_000, 3000, "offset do relogio do chat da live (desde a ancora)");
    return resto;
  });
  assert.deepEqual(semRelogio, [{ participant_id: "a1b2c3d4" }, { raised: true }, { on: true }, { consented: true, on: true }, { role: "participant" }, { code: "conference.connectionError", fatal: true }, {}]);
  const texto = JSON.stringify(linhas);
  assert.ok(!texto.includes("Ana") && !texto.includes(EMAIL) && !texto.includes("texto livre"), "nunca texto livre");

  const vinteEUm = Array.from({ length: 21 }, () => ({ at, name: "raiseHandUpdated", data: { raised: true } }));
  assert.equal((await sinais(vinteEUm)).status, 400);
  assert.equal((await sinais([{ at, name: "participantKickedOut" }])).status, 400, "nome fora da lista");
  assert.equal((await sinais([])).status, 400, "lote vazio");
  sessao.user = null;
  assert.equal((await sinais([{ at, name: "videoConferenceLeft" }])).status, 401);
  assert.equal(db.tables.student_events.length, 7);
});

test("room-events: 404 na sessao gravada e de outro webinario; 409 not_started na agendada (a equipe passa na Sessao de pratica), 409 banned para removido e banido; 6 lotes por minuto (o 7o e 429 com Retry-After)", async () => {
  const at = iso(Date.now());
  const sinal = [{ at, name: "videoConferenceLeft" }];
  const { db, userId } = montar({ status: "scheduled" });
  assert.equal((await sinais(sinal, GRAVADA)).status, 404);
  assert.equal((await sinais(sinal, OTHER_SESSION)).status, 404);
  const cedo = await sinais(sinal);
  assert.equal(cedo.status, 409);
  assert.equal(cedo.body.reason, "not_started");
  daEquipe(db);
  assert.equal((await sinais(sinal)).status, 202, "a equipe na Sessao de pratica");

  const { db: noAr } = montar();
  sessao.user = { id: userId };
  noAr.tables.webinar_session_bans.push({ by_user_id: null, created_at: iso(Date.now()), kind: "kicked", reason: null, session_id: LIVE, until_at: null, user_id: userId });
  const removido = await sinais(sinal);
  assert.equal(removido.status, 409);
  assert.equal(removido.body.reason, "banned");
  assert.equal(removido.body.error, WEBINAR_COPY.aoVivo.removido);
  const banido = novaPessoa();
  noAr.tables.webinar_user_bans.push({ by_user_id: null, created_at: iso(Date.now()), reason: null, session_id: null, user_id: banido });
  assert.equal((await sinais(sinal)).body.reason, "banned");
  assert.equal(noAr.tables.student_events.length, 0);

  novaPessoa();
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await sinais(sinal)).status, 202, `lote ${i + 1}`);
  }
  const setimo = await sinais(sinal);
  assert.equal(setimo.status, 429);
  assert.match(setimo.headers.get("Retry-After") ?? "", /^\d+$/);
});

test("room-events: com a live encerrada, 409 ended para o aluno e para a equipe, e nada gravado (o lote do pagehide nao contamina o historico)", async () => {
  const at = iso(Date.now());
  const { db } = montar({ status: "ended" });
  const aluno = await sinais([{ at, name: "videoConferenceLeft" }]);
  assert.equal(aluno.status, 409);
  assert.equal(aluno.body.reason, "ended");
  daEquipe(db);
  const equipe = await sinais([{ at, data: { participantId: "p-equipe" }, name: "videoConferenceJoined" }]);
  assert.equal(equipe.status, 409, "a recusa nao depende do papel");
  assert.equal(equipe.body.reason, "ended");
  assert.equal(db.tables.student_events.length, 0);
});

test("room-events: o id de participante que ja e de outra conta nesta sessao fica gravado sem o id (a primeira conta fica com ele)", async () => {
  const at = iso(Date.now());
  const { db, userId: bia } = montar();
  assert.equal((await sinais([{ at, data: { participantId: "p-bia" }, name: "videoConferenceJoined" }])).status, 202);
  const ana = novaPessoa();
  perfil(db, ana, "Ana Lima");
  assert.equal((await sinais([{ at, data: { participantId: "p-bia" }, name: "videoConferenceJoined" }])).status, 202, "o lote passa");
  assert.equal((await sinais([{ at, data: { participantId: "p-ana" }, name: "videoConferenceJoined" }])).status, 202);
  const entradas = eventos(db, "webinar_room_joined").map((row) => [row.user_id, row.metadata.participant_id]);
  assert.deepEqual(entradas, [
    [bia, "p-bia"],
    [ana, null],
    [ana, "p-ana"]
  ]);
  sessao.user = { id: bia };
  assert.equal((await sinais([{ at, data: { participantId: "p-bia" }, name: "videoConferenceJoined" }])).status, 202);
  assert.equal(eventos(db, "webinar_room_joined").at(-1).metadata.participant_id, "p-bia", "a mesma conta reentrando com o proprio id continua ligada");
});

test("room-events e presenca com vagas limitadas (A12): o aluno sem a vaga recebe 403; a equipe no palco pela pagina do aluno passa sem a vaga, como no join-token", async () => {
  const at = iso(Date.now());
  const sinal = [{ at, name: "videoConferenceLeft" }];
  const { db } = montar();
  Object.assign(db.tables.webinars[0], { capacity: 50, registration_required: true });
  const semVaga = await sinais(sinal);
  assert.equal(semVaga.status, 403);
  assert.match(semVaga.body.error, /só entra quem garantiu a vaga/);
  daEquipe(db);
  assert.equal((await sinais(sinal)).status, 202, "a equipe sem vaga manda os sinais");
  const presenca = await heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 0, sessionId: LIVE, state: "playing", visible: true }), contexto());
  assert.ok(presenca.status < 400, `a presenca da equipe sem vaga passa (${presenca.status})`);
});

test("D31: a mensagem do aluno na Live ao vivo nasce na linha mestre (aberta e moderada, esta so aparece depois de liberada); na Live gravada, nao", async () => {
  const { db } = montar();
  const noAr = await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "oi da live", sessionId: LIVE, ...comAceite }), contexto()));
  assert.equal(noAr.status, 201, JSON.stringify(noAr.body));
  assert.equal(db.tables.webinar_chat_messages.at(-1).master, true, "o replay le da live so master and approved");

  sessaoLive(db).chat_mode = "moderated";
  resetRoomLimits();
  const moderada = await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "pendente", sessionId: LIVE }), contexto()));
  assert.equal(moderada.status, 201, JSON.stringify(moderada.body));
  assert.deepEqual([db.tables.webinar_chat_messages.at(-1).master, db.tables.webinar_chat_messages.at(-1).approved], [true, false], "master, mas so aparece no replay depois de liberada");

  const { db: gravada } = montar();
  gravada.tables.webinar_sessions.find((row) => row.id === GRAVADA).scheduled_at = iso(Date.now() - MIN);
  const naGravada = await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "oi da gravada", sessionId: GRAVADA, ...comAceite }), contexto()));
  assert.equal(naGravada.status, 201, JSON.stringify(naGravada.body));
  assert.equal(gravada.tables.webinar_chat_messages.at(-1).master, false);
});

/* ------------------------------------------------------------------------------------------------
 * Banimentos nas escritas
 * ---------------------------------------------------------------------------------------------- */

test("silenciado no chat: mensagem e pergunta 409 muted com a hora ate quando vale; reacao, curtida e enquete passam; vencido o prazo, escreve de novo", async () => {
  const { db, userId } = montar();
  const POLL = "ffffffff-0000-4000-8000-000000000001";
  const SIM = "ffffffff-0000-4000-8000-00000000000a";
  const PERGUNTA = "ffffffff-0000-4000-8000-000000000002";
  db.tables.webinar_polls.push({ anonymous: false, closed_at: null, created_at: iso(Date.now()), created_by: null, id: POLL, kind: "single", open_offset_ms: 0, opened_at: iso(Date.now()), position: 0, question: "Gostou?", results_shared_at: null, session_id: LIVE, status: "open", template_poll_id: null, updated_at: iso(Date.now()), webinar_id: WEBINAR });
  db.tables.webinar_poll_options.push({ created_at: iso(Date.now()), id: SIM, label: "Sim", poll_id: POLL, position: 0 });
  db.tables.webinar_questions.push({ anonymous: false, body: "de outro", created_at: iso(Date.now()), deleted_at: null, display_name: "Zé", id: PERGUNTA, offset_ms: 0, session_id: LIVE, status: "open", upvotes: 0, user_id: "11111111-1111-4111-8111-111111111111" });
  const ban = { by_user_id: null, created_at: iso(Date.now()), kind: "muted", reason: null, session_id: LIVE, until_at: iso(Date.now() + 5 * MIN), user_id: userId };
  db.tables.webinar_session_bans.push(ban);

  const mensagem = await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "oi", sessionId: LIVE, ...comAceite }), contexto()));
  assert.equal(mensagem.status, 409);
  assert.equal(mensagem.body.reason, "muted");
  assert.match(mensagem.body.error, /^Você está sem escrever no chat até \d{2}:\d{2}\.$/);
  const pergunta = await json(await questionsRoute.POST(pedido(`${WEBINAR}/questions`, "POST", { body: "posso?", sessionId: LIVE, ...comAceite }), contexto()));
  assert.equal(pergunta.status, 409);
  assert.equal(pergunta.body.reason, "muted");
  assert.equal(db.tables.webinar_chat_messages.length + db.tables.webinar_questions.filter((row) => row.user_id === userId).length, 0, "nada gravado");
  assert.equal(db.tables.webinar_chat_consents.length, 0, "nem o aceite");

  assert.equal((await reactionsRoute.POST(pedido(`${WEBINAR}/reactions`, "POST", { reaction: "clap", sessionId: LIVE }), contexto())).status, 201, "reage silenciado");
  const voto = await json(await voteRoute.POST(pedido(`${WEBINAR}/questions/${PERGUNTA}/vote`, "POST", { sessionId: LIVE }), { params: Promise.resolve({ id: WEBINAR, qid: PERGUNTA }) }));
  assert.deepEqual(voto.body.data, { upvotes: 1, voted: true }, "curte silenciado");
  assert.equal((await pollsRoute.POST(pedido(`${WEBINAR}/polls`, "POST", { optionIds: [SIM], pollId: POLL, sessionId: LIVE }), contexto())).status, 201, "responde a enquete silenciado");

  // Ate o fim da sessao: a frase sem hora.
  ban.until_at = null;
  const ateOFim = await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "oi", sessionId: LIVE, ...comAceite }), contexto()));
  assert.equal(ateOFim.body.error, WEBINAR_COPY.aoVivo.silenciadoAteOFim);

  // O prazo venceu: escreve de novo (o silencio sai pela hora, sem ninguem apagar a linha).
  ban.until_at = iso(Date.now() - 1000);
  const depois = await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "voltei", sessionId: LIVE, ...comAceite }), contexto()));
  assert.equal(depois.status, 201, JSON.stringify(depois.body));
  perto(depois.body.data.message.offsetMs, 30_000, 3000, "o offset do chat da live e pela ancora");
  assert.equal((await json(await questionsRoute.POST(pedido(`${WEBINAR}/questions`, "POST", { body: "e agora?", sessionId: LIVE }), contexto()))).status, 201);
});

test("removido e banido: mensagem, pergunta, reacao, curtida e enquete 409 banned; fora da live nenhuma leitura de banimento", async () => {
  const { db, userId } = montar();
  const POLL = "ffffffff-0000-4000-8000-000000000003";
  const SIM = "ffffffff-0000-4000-8000-00000000000b";
  const PERGUNTA = "ffffffff-0000-4000-8000-000000000004";
  db.tables.webinar_polls.push({ anonymous: false, closed_at: null, created_at: iso(Date.now()), created_by: null, id: POLL, kind: "single", open_offset_ms: 0, opened_at: iso(Date.now()), position: 0, question: "Gostou?", results_shared_at: null, session_id: LIVE, status: "open", template_poll_id: null, updated_at: iso(Date.now()), webinar_id: WEBINAR });
  db.tables.webinar_poll_options.push({ created_at: iso(Date.now()), id: SIM, label: "Sim", poll_id: POLL, position: 0 });
  db.tables.webinar_questions.push({ anonymous: false, body: "de outro", created_at: iso(Date.now()), deleted_at: null, display_name: "Zé", id: PERGUNTA, offset_ms: 0, session_id: LIVE, status: "open", upvotes: 0, user_id: "11111111-1111-4111-8111-111111111111" });

  const escritas = async () => [
    await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "oi", sessionId: LIVE, ...comAceite }), contexto())),
    await json(await questionsRoute.POST(pedido(`${WEBINAR}/questions`, "POST", { body: "posso?", sessionId: LIVE, ...comAceite }), contexto())),
    await json(await reactionsRoute.POST(pedido(`${WEBINAR}/reactions`, "POST", { reaction: "fire", sessionId: LIVE }), contexto())),
    await json(await voteRoute.POST(pedido(`${WEBINAR}/questions/${PERGUNTA}/vote`, "POST", { sessionId: LIVE }), { params: Promise.resolve({ id: WEBINAR, qid: PERGUNTA }) })),
    await json(await pollsRoute.POST(pedido(`${WEBINAR}/polls`, "POST", { optionIds: [SIM], pollId: POLL, sessionId: LIVE }), contexto()))
  ];

  db.tables.webinar_session_bans.push({ by_user_id: null, created_at: iso(Date.now()), kind: "kicked", reason: null, session_id: LIVE, until_at: null, user_id: userId });
  for (const resposta of await escritas()) {
    assert.equal(resposta.status, 409);
    assert.equal(resposta.body.reason, "banned");
    assert.equal(resposta.body.error, WEBINAR_COPY.aoVivo.removido);
  }

  const banido = novaPessoa();
  perfil(db, banido);
  db.tables.webinar_user_bans.push({ by_user_id: null, created_at: iso(Date.now()), reason: null, session_id: OTHER_SESSION, user_id: banido });
  for (const resposta of await escritas()) {
    assert.equal(resposta.status, 409);
    assert.equal(resposta.body.reason, "banned");
    assert.equal(resposta.body.error, WEBINAR_COPY.aoVivo.banido);
  }
  assert.equal(db.tables.webinar_chat_messages.length + db.tables.webinar_reactions.length + db.tables.webinar_poll_answers.length + db.tables.webinar_question_votes.length, 0, "nada gravado");
  assert.equal(db.tables.webinar_questions.length, 1, "so a pergunta de outro aluno");
  assert.equal(db.tables.student_events.length, 0);

  // Na Live gravada (outra sessao do mesmo webinario) removido e silenciado da live nao sao lidos: so o banido de todos.
  const { db: gravada } = montar();
  gravada.tables.webinar_sessions.find((row) => row.id === GRAVADA).scheduled_at = iso(Date.now() - MIN);
  const naGravada = await json(await reactionsRoute.POST(pedido(`${WEBINAR}/reactions`, "POST", { reaction: "clap", sessionId: GRAVADA }), contexto()));
  assert.equal(naGravada.status, 201, JSON.stringify(naGravada.body));
  assert.ok(!gravada.calls.from.includes("webinar_session_bans"), "fora da live, removido e silenciado nao sao lidos");
  assert.equal(gravada.calls.from.filter((name) => name === "webinar_user_bans").length, 1, "uma leitura pela chave do banido de todos");
});

test("banido de todos os webinarios: na Live gravada e no Replay o chat e a reacao respondem 409 banned e a sessao recusa a entrada; removido ou silenciado na live continua livre na gravada", async () => {
  const { db, userId } = montar();
  db.tables.webinar_sessions.find((row) => row.id === GRAVADA).scheduled_at = iso(Date.now() - MIN);
  db.tables.webinar_user_bans.push({ by_user_id: null, created_at: iso(Date.now()), reason: null, session_id: LIVE, user_id: userId });

  const chatGravada = await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "voltei", sessionId: GRAVADA, ...comAceite }), contexto()));
  assert.equal(chatGravada.status, 409, JSON.stringify(chatGravada.body));
  assert.equal(chatGravada.body.reason, "banned");
  assert.equal(chatGravada.body.error, WEBINAR_COPY.aoVivo.banido);
  const chatReplay = await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "voltei", offsetMs: 1000, sessionId: REPLAY, ...comAceite }), contexto()));
  assert.equal(chatReplay.status, 409, JSON.stringify(chatReplay.body));
  assert.equal(chatReplay.body.reason, "banned");
  const reacaoReplay = await json(await reactionsRoute.POST(pedido(`${WEBINAR}/reactions`, "POST", { reaction: "clap", sessionId: REPLAY }), contexto()));
  assert.equal(reacaoReplay.status, 409);
  assert.equal(reacaoReplay.body.reason, "banned");
  assert.equal(db.tables.webinar_chat_messages.length + db.tables.webinar_reactions.length, 0, "nada gravado");

  for (const sessionId of [GRAVADA, REPLAY]) {
    const leitura = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${sessionId}`), contexto()));
    assert.equal(leitura.status, 200, JSON.stringify(leitura.body));
    assert.deepEqual(leitura.body.data.session.join, { ok: false, reason: "banned" }, sessionId);
    assert.equal(leitura.body.data.me.ban.banned, true);
    assert.equal(leitura.body.data.video, null, "sem o video da Bunny");
  }

  // Removido e silenciado na live X: a Live gravada Y continua livre.
  const { db: outra, userId: aluna } = montar();
  outra.tables.webinar_sessions.find((row) => row.id === GRAVADA).scheduled_at = iso(Date.now() - MIN);
  outra.tables.webinar_session_bans.push(
    { by_user_id: null, created_at: iso(Date.now()), kind: "kicked", reason: null, session_id: LIVE, until_at: null, user_id: aluna },
    { by_user_id: null, created_at: iso(Date.now()), kind: "muted", reason: null, session_id: LIVE, until_at: null, user_id: aluna }
  );
  const livre = await json(await chatRoute.POST(pedido(`${WEBINAR}/chat`, "POST", { body: "oi", sessionId: GRAVADA, ...comAceite }), contexto()));
  assert.equal(livre.status, 201, JSON.stringify(livre.body));
});

/* ------------------------------------------------------------------------------------------------
 * Presenca da live
 * ---------------------------------------------------------------------------------------------- */

test("heartbeat da live: o balde desde started_at (nunca a ancora), sem webinar_joined, presentNow, a live que passou da duracao nao acaba sozinha; a sessao e relida (encerrar aparece no sinal seguinte); a saida de quem foi removido e `kicked`", async () => {
  const { db, userId } = montar();
  const bater = (body = {}) => heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 5, sessionId: LIVE, state: "playing", visible: true, ...body }), contexto());
  const primeiro = await json(await bater());
  assert.equal(primeiro.status, 200, JSON.stringify(primeiro.body));
  const amostra = db.tables.webinar_presence_samples[0];
  assert.equal(amostra.bucket, 3, "no ar ha 95 s = balde 3 (pela ancora, de 30 s atras, seria o 1)");
  perto(amostra.offset_seconds, 95, 2, "offset da presenca desde o inicio");
  perto(primeiro.body.data.offsetMs, 30_000, 3000, "o relogio do chat da live (ancora) na resposta");
  assert.equal(primeiro.body.data.ended, false);
  assert.equal(primeiro.body.data.presentNow, 1);
  assert.equal(eventos(db, "webinar_joined").length, 0, "na live a entrada e do join-token");

  // A equipe encerra a live: o sinal seguinte (a sessao guardada tem mais de 10 s) ja diz ended.
  sessaoLive(db).status = "ended";
  assert.equal((await json(await bater())).body.data.ended, false, "dentro dos 10 s, a sessao guardada");
  const relogio = Date.now;
  const adiante = relogio() + 11_000;
  Date.now = () => adiante;
  try {
    const depois = await json(await bater());
    assert.equal(depois.body.data.ended, true, "a sessao relida");
  } finally {
    Date.now = relogio;
  }

  // A live passou da duracao prevista e continua no ar: nao acaba sozinha.
  const { db: longa } = montar({ scheduledAgoMs: 2 * HOUR + 5 * MIN, startedAgoMs: 2 * HOUR });
  const atrasada = await json(await bater());
  assert.equal(atrasada.body.data.ended, false);
  assert.equal(longa.tables.webinar_presence_samples[0].bucket, 240, "2 h = balde 240");

  // Quem foi removido sai com reason `kicked`.
  const { db: removido, userId: aluno } = montar();
  assert.equal((await bater()).status, 200);
  removido.tables.webinar_session_bans.push({ by_user_id: null, created_at: iso(Date.now()), kind: "kicked", reason: null, session_id: LIVE, until_at: null, user_id: aluno });
  assert.equal((await bater({ leave: true, state: "hidden", visible: false })).status, 200);
  assert.deepEqual(eventos(removido, "webinar_left").map((row) => row.metadata), [{ kind: "live", reason: "kicked", seconds_present: 30 }]);
  assert.notEqual(userId, aluno);
});

test("heartbeat na sala de espera depois da hora marcada: balde negativo; depois de Comecar para todos a contagem vem de started_at e a espera nunca soma nos mesmos baldes", async () => {
  const { db, userId } = montar({ scheduledAgoMs: 10 * MIN, status: "waiting" });
  const bater = () => heartbeatRoute.POST(pedido(`${WEBINAR}/heartbeat`, "POST", { offsetSeconds: 0, sessionId: LIVE, state: "paused", visible: true }), contexto());
  assert.equal((await bater()).status, 200);
  const espera = db.tables.webinar_presence_samples.filter((row) => row.user_id === userId);
  assert.deepEqual(espera.map((row) => row.bucket), [-1], "10 min depois da hora marcada, ainda na espera: balde -1, fora do que webinar_close_session soma");

  // Comecar para todos (webinar_open_session: live, started_at = agora): o sinal seguinte cai no balde 0, so dele.
  Object.assign(sessaoLive(db), { started_at: iso(Date.now()), status: "live" });
  heartbeatRoute.resetHeartbeatAccessCache();
  assert.equal((await bater()).status, 200);
  const baldes = db.tables.webinar_presence_samples.filter((row) => row.user_id === userId).map((row) => [row.bucket, row.samples ?? 1]);
  assert.deepEqual(baldes, [
    [-1, 1],
    [0, 1]
  ], "a espera e o inicio em baldes diferentes");
});

/* ------------------------------------------------------------------------------------------------
 * GET .../session da live
 * ---------------------------------------------------------------------------------------------- */

test("GET session da live: o bloco live (sem o nome da sala, o token nem a situacao do gravador), me.ban, a entrada recusa removido e banido, presentNow pelo relogio da presenca, nenhum video da Bunny", async () => {
  const { db, userId } = montar({ roomName: `w-${WEBINAR}-abcdefghijkmnpqr` });
  db.tables.webinar_presence_samples.push({ bucket: 3, first_at: iso(Date.now()), last_at: iso(Date.now()), offset_seconds: 95, samples: 1, session_id: LIVE, state: "playing", user_id: "11111111-1111-4111-8111-111111111111" });
  const resposta = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${LIVE}`), contexto()));
  assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
  const { data } = resposta.body;
  assert.deepEqual(data.live, { lobby: false, locked: false, meetConfigured: true, practice: false, recording: true, startedAt: sessaoLive(db).started_at, status: "live" });
  assert.deepEqual(data.session.join, { ok: true });
  assert.deepEqual(data.me.ban, { banned: false, kicked: false, muted: false, mutedUntil: null });
  assert.equal(data.presentNow, 1, "o balde 3 e o de agora pelo inicio (pela ancora seria o 1)");
  assert.equal(data.video, null);
  const texto = JSON.stringify(data);
  assert.ok(!texto.includes("abcdefghijkmnpqr") && !/room_?name|recorder|jwt/i.test(texto), "nada da sala alem de LiveRoomInfo");

  const ate = iso(Date.now() + 15 * MIN);
  db.tables.webinar_session_bans.push({ by_user_id: null, created_at: iso(Date.now()), kind: "muted", reason: null, session_id: LIVE, until_at: ate, user_id: userId });
  const silenciado = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${LIVE}`), contexto()));
  assert.deepEqual(silenciado.body.data.me.ban, { banned: false, kicked: false, muted: true, mutedUntil: ate });
  assert.deepEqual(silenciado.body.data.session.join, { ok: true }, "silenciado entra");

  db.tables.webinar_session_bans.push({ by_user_id: null, created_at: iso(Date.now()), kind: "kicked", reason: null, session_id: LIVE, until_at: null, user_id: userId });
  const removido = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${LIVE}`), contexto()));
  assert.deepEqual(removido.body.data.session.join, { ok: false, reason: "kicked" });
  assert.equal(removido.body.data.me.ban.kicked, true);

  const banido = novaPessoa();
  perfil(db, banido);
  db.tables.webinar_user_bans.push({ by_user_id: null, created_at: iso(Date.now()), reason: null, session_id: null, user_id: banido });
  const resp = await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${LIVE}`), contexto()));
  assert.deepEqual(resp.body.data.session.join, { ok: false, reason: "banned" });
  assert.equal(resp.body.data.me.ban.banned, true);

  // Agendada: o aluno espera; na espera com a Sessao de pratica (o padrao), ainda espera e a sala diz que a sala de
  // espera esta ligada; sem a Sessao de pratica, a sala aberta e de todos.
  const { db: agendada } = montar({ status: "scheduled" });
  const ler = async () => (await json(await sessionRoute.GET(pedido(`${WEBINAR}/session?sessao=${LIVE}`), contexto()))).body.data;
  assert.deepEqual((await ler()).session.join, { ok: false, reason: "not_started" });
  sessaoLive(agendada).status = "waiting";
  const pratica = await ler();
  assert.deepEqual(pratica.session.join, { ok: false, reason: "not_started" }, "Sessao de pratica: so a equipe na sala");
  assert.deepEqual([pratica.live.lobby, pratica.live.practice], [true, true]);
  agendada.tables.webinars[0].room_settings.practiceSession = false;
  const aberta = await ler();
  assert.deepEqual(aberta.session.join, { ok: true });
  assert.deepEqual([aberta.live.lobby, aberta.live.practice], [false, false]);
  sessaoLive(agendada).room_locked = true;
  assert.equal((await ler()).live.lobby, true, "a sala trancada liga a sala de espera para quem chega");
});
