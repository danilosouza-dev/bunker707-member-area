import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// As Server Actions da sala da Live ao vivo (docs/30 §1.4, §2.6, §5.2, §6.4, §6.5, §6.7 e §8.3; fase 3), sem banco: o
// mesmo banco em memoria de tests/webinarios-roteiro-acoes.test.mjs (filtros, upsert por chave, 23505 nas chaves
// unicas) com as tabelas da 202610290002 e as RPCs como dubles (abrir, encerrar, ancora). A permissao vem de um duble
// que recusa tudo ou so as acoes pedidas (o analista sem messaging.publish); "next/cache" so anota; o gravador e o duble
// de recorder-dispatch.ts (WEBINAR_RECORDER_DISPATCH=fake fora da producao). Aqui: 403 sem permissao; abrir a sala
// (agendada -> espera, nome da sala gerado); Comecar para todos; Encerrar live; trancar; a ancora uma vez pela RPC; o
// Gravar (start, fila com recording_requested_at e a estimativa, gravando, sem maquina); Preparar gravacao sem o pedido
// automatico (o motivo, nada muda) e com o duble (preparing e jibri-up anotado); desligar o gravador (recusa gravando,
// aceita uploaded); silenciar 5/15/60/fim com until_at; remover; banir e desfazer so com publish; nunca a equipe;
// Enviar gravacao liga o video e cria o replay da sessao encerrada; Alinhar chat grava anchor_offset_ms e audita o antes
// e o depois sem mexer nas mensagens; toda acao grava a auditoria so com ids e contagens.

process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";

const estado = (globalThis.__salaAoVivoAcoes ??= { negar: false, revalidados: [] });
const HOST = "00000000-0000-4000-8000-000000000001";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      const source = `
        export async function requireRole(action) {
          const estado = globalThis.__salaAoVivoAcoes;
          if (estado.negar === true || (Array.isArray(estado.negar) && estado.negar.includes(action))) {
            const error = new Error("Sem permissão para Comunicação.");
            error.status = 403;
            throw error;
          }
          return globalThis.__adminActionStubs.role;
        }
        export async function requireScope() {}`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    if (specifier === "@/server/auth/session") {
      const source = `
        export async function getAuthenticatedUser() { return globalThis.__adminActionStubs.role.user; }
        export async function getAdminAccessForUser() { return null; }
        export function getUserDisplayName(user) {
          const fullName = (user.user_metadata?.full_name ?? "").trim() || "Equipe";
          return { fullName, name: fullName.split(/\\s+/)[0] };
        }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    if (specifier.endsWith("/db/supabase/client")) {
      const source = `
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    if (specifier === "next/cache") {
      const source = `
        export function revalidatePath(path) { globalThis.__salaAoVivoAcoes.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__salaAoVivoAcoes.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__salaAoVivoAcoes.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "produtor.teste@bunker707.test", id: HOST, user_metadata: { full_name: "Produtor de Teste" } } };

const live = await import("../src/server/webinars/live-actions.ts");
const consoleQueries = await import("../src/server/webinars/console-queries.ts");
const { fakeRecorderDispatches } = await import("../src/server/webinars/recorder-dispatch.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const { LIVE_ACTION_MESSAGES } = await import("../src/server/webinars/live-console-model.ts");

/* ------------------------------------------------------------------------------------------------
 * Banco em memoria (o mesmo de tests/webinarios-roteiro-acoes.test.mjs, com as tabelas da fase 3)
 * ---------------------------------------------------------------------------------------------- */

let relogio = Date.now() - 3_600_000;
const agora = () => new Date((relogio += 1_000)).toISOString();

const SESSION_DEFAULTS = {
  chat_mode: "open",
  chat_slow_mode_seconds: null,
  ended_at: null,
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
  script_fired_at: null,
  show_live_badge: false,
  simulation_ack_text: null,
  simulation_decided_at: null,
  simulation_decided_by: null,
  source_session_id: null,
  started_at: null,
  status: "scheduled"
};

const DEFAULTS = {
  webinar_chat_messages: { approved: true, author_user_id: null, deleted_at: null, kind: "message", master: false, pinned_at: null, reply_to_id: null, script_item_id: null },
  webinar_recordings: { anchor_offset_ms: 0, bunny_library_id: null, bunny_video_id: null, checked_at: null, duration_seconds: null, embed_url: null, error_message: null, file_name: null, provider: "bunny", purge_due_at: null, purged_at: null, session_id: null, sha256: null, size_bytes: null, source: "upload", status: "ready" },
  webinar_sessions: SESSION_DEFAULTS
};

const UNIQUE = {
  webinar_recordings: (row, rows) => row.bunny_video_id != null && rows.some((other) => other.provider === row.provider && other.bunny_video_id === row.bunny_video_id),
  webinar_sessions: (row, rows) => row.kind === "replay" && rows.some((other) => other.webinar_id === row.webinar_id && other.kind === "replay")
};

function matches(row, filters) {
  return filters.every(([method, column, value, extra]) => {
    switch (method) {
      case "eq":
        return row[column] === value;
      case "neq":
        return row[column] !== value;
      case "in":
        return value.includes(row[column]);
      case "is":
        return value === null ? row[column] == null : row[column] === value;
      case "not":
        if (value === "is") {
          return extra === null ? row[column] != null : row[column] !== extra;
        }
        return true;
      case "gt":
        return row[column] > value;
      case "gte":
        return row[column] >= value;
      case "lt":
        return row[column] < value;
      case "lte":
        return row[column] <= value;
      default:
        return true;
    }
  });
}

function bancoEmMemoria(seed = {}, rpc = {}) {
  const tables = {
    admin_audit_log: [],
    admin_roles: [],
    notifications: [],
    profiles: [],
    student_events: [],
    webinar_chat_messages: [],
    webinar_presenters: [],
    webinar_recording_events: [],
    webinar_recordings: [],
    webinar_registrations: [],
    webinar_session_bans: [],
    webinar_sessions: [],
    webinar_user_bans: [],
    webinars: [],
    ...structuredClone(seed)
  };
  const calls = [];
  const rpcs = [];

  function insertRows(table, payload) {
    const rows = (tables[table] ??= []);
    const inserted = [];
    for (const item of Array.isArray(payload) ? payload : [payload]) {
      const row = { created_at: agora(), id: randomUUID(), ...(DEFAULTS[table] ?? {}), ...structuredClone(item), updated_at: agora() };
      if (UNIQUE[table]?.(row, rows)) {
        return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint (${table})` } };
      }
      rows.push(row);
      inserted.push(row);
    }
    return { data: inserted, error: null };
  }

  function run(query) {
    calls.push(query);
    const rows = (tables[query.table] ??= []);

    if (query.op === "insert") {
      const result = insertRows(query.table, query.payload);
      if (result.error) {
        return { data: null, error: result.error };
      }
      return { data: query.single ? result.data[0] : structuredClone(result.data), error: null };
    }

    if (query.op === "upsert") {
      const conflict = (query.options?.onConflict ?? "id").split(",").map((part) => part.trim());
      const out = [];
      for (const item of Array.isArray(query.payload) ? query.payload : [query.payload]) {
        const existing = rows.find((row) => conflict.every((column) => item[column] !== undefined && row[column] === item[column]));
        if (existing) {
          Object.assign(existing, structuredClone(item), { updated_at: agora() });
          out.push(existing);
        } else {
          const result = insertRows(query.table, item);
          if (result.error) {
            return { data: null, error: result.error };
          }
          out.push(result.data[0]);
        }
      }
      return { data: query.single ? structuredClone(out[0]) : structuredClone(out), error: null };
    }

    const found = rows.filter((row) => matches(row, query.filters));

    if (query.op === "update") {
      found.forEach((row) => Object.assign(row, structuredClone(query.payload), { updated_at: agora() }));
      return { data: query.single ? (structuredClone(found[0]) ?? null) : structuredClone(found), error: null };
    }

    if (query.op === "delete") {
      tables[query.table] = rows.filter((row) => !found.includes(row));
      return { data: query.single ? (structuredClone(found[0]) ?? null) : structuredClone(found), error: null };
    }

    let result = [...found];
    for (const [column, ascending] of [...query.order].reverse()) {
      result.sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
    }
    if (query.range) {
      result = result.slice(query.range[0], query.range[1] + 1);
    } else if (query.limit !== null) {
      result = result.slice(0, query.limit);
    }
    return { count: found.length, data: query.single ? (structuredClone(result[0]) ?? null) : structuredClone(result), error: null };
  }

  function chain(query) {
    const self = {
      delete: () => ((query.op = "delete"), self),
      eq: (column, value) => (query.filters.push(["eq", column, value]), self),
      gt: (column, value) => (query.filters.push(["gt", column, value]), self),
      gte: (column, value) => (query.filters.push(["gte", column, value]), self),
      in: (column, value) => (query.filters.push(["in", column, value]), self),
      insert: (payload) => ((query.op = "insert"), (query.payload = payload), self),
      is: (column, value) => (query.filters.push(["is", column, value]), self),
      limit: (value) => ((query.limit = value), self),
      lt: (column, value) => (query.filters.push(["lt", column, value]), self),
      lte: (column, value) => (query.filters.push(["lte", column, value]), self),
      maybeSingle: () => ((query.single = true), self),
      neq: (column, value) => (query.filters.push(["neq", column, value]), self),
      not: (column, operator, value) => (query.filters.push(["not", column, operator, value]), self),
      or: (expression) => (query.filters.push(["or", expression]), self),
      order: (column, options = {}) => (query.order.push([column, options.ascending !== false]), self),
      range: (from, to) => ((query.range = [from, to]), self),
      select: () => self,
      single: () => ((query.single = true), self),
      then: (resolve, reject) => Promise.resolve(run(query)).then(resolve, reject),
      update: (payload) => ((query.op = "update"), (query.payload = payload), self),
      upsert: (payload, options) => ((query.op = "upsert"), (query.payload = payload), (query.options = options), self)
    };
    return self;
  }

  return {
    calls,
    from: (table) => chain({ filters: [], limit: null, op: "select", options: undefined, order: [], payload: undefined, range: null, single: false, table }),
    async rpc(name, args) {
      rpcs.push({ args, name });
      const handler = rpc[name];
      return handler ? handler(args, tables) : { data: null, error: null };
    },
    rpcs,
    tables
  };
}

/* As RPCs da 202610290001 e da 202610290002 como dubles (o comportamento que importa aqui). */
const RPC = {
  webinar_close_session: (args, tables) => {
    const row = tables.webinar_sessions.find((item) => item.id === args.p_session_id);
    row.status = "ended";
    row.ended_at = args.p_now;
    return { data: { avgPresent: 0, bucketSeconds: 30, buckets: [], durationMs: 60_000, frozenAt: args.p_now, peak: { b: 1, n: 4 }, reachedEnd: 0, unique: 4, watchAvg: 0, watchMax: 0 }, error: null };
  },
  webinar_mark_recording_anchor: (args, tables) => {
    const row = tables.webinar_sessions.find((item) => item.id === args.p_session_id);
    if (!row) {
      return { data: null, error: { code: "P0002", message: "not found" } };
    }
    if (row.recording_anchor_at) {
      return { data: { anchor: row.recording_anchor_at, changed: false, rebased: 0, reason: "already", recorderStatus: row.recorder_status }, error: null };
    }
    if (row.kind !== "live" || !["waiting", "live"].includes(row.status)) {
      return { data: { anchor: null, changed: false, rebased: 0, reason: "not_live", recorderStatus: row.recorder_status }, error: null };
    }
    row.recording_anchor_at = args.p_now;
    row.recorder_status = ["preparing", "ready"].includes(row.recorder_status) ? "recording" : row.recorder_status;
    row.recording_requested_at = null;
    const rebased = tables.webinar_chat_messages.filter((message) => message.session_id === row.id).length;
    return { data: { anchor: args.p_now, changed: true, rebased, reason: null, recorderStatus: row.recorder_status }, error: null };
  },
  webinar_open_session: (args, tables) => {
    const row = tables.webinar_sessions.find((item) => item.id === args.p_session_id);
    const changed = row.status !== "live";
    row.status = "live";
    row.started_at ??= args.p_now;
    return { data: { changed, fired: 0, status: "live" }, error: null };
  }
};

function usar(db) {
  actionStubs.db = db;
  estado.negar = false;
  estado.revalidados.length = 0;
  delete process.env.WEBINAR_RECORDER_DISPATCH;
  delete process.env.GITHUB_INFRA_TOKEN;
  return db;
}

const audits = (db, action) => db.tables.admin_audit_log.filter((row) => row.action === action);

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

function falha(result, status) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.status, status, JSON.stringify(result));
  return result;
}

/* ------------------------------------------------------------------------------------------------
 * Cenario
 * ---------------------------------------------------------------------------------------------- */

const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const S_MARCADA = "bbbbbbbb-2222-4222-8222-111111111111";
const S_ESPERA = "bbbbbbbb-2222-4222-8222-222222222222";
const S_NO_AR = "bbbbbbbb-2222-4222-8222-333333333333";
const S_ENCERRADA = "bbbbbbbb-2222-4222-8222-444444444444";
const S_GRAVADA = "bbbbbbbb-2222-4222-8222-555555555555";
const S_OUTRA = "bbbbbbbb-2222-4222-8222-666666666666";
const ALUNA = "cccccccc-3333-4333-8333-333333333333";
const ALUNO = "dddddddd-4444-4444-8444-444444444444";
const EQUIPE = "eeeeeeee-5555-4555-8555-555555555555";
const COAPRESENTADOR = "ffffffff-6666-4666-8666-666666666666";
const MIN = 60_000;
const VIDEO = "1a2b3c4d-0000-4000-8000-00000000abcd";

function sessao(extra) {
  return { ...SESSION_DEFAULTS, created_at: agora(), kind: "live", scheduled_at: new Date(Date.now() + 60 * MIN).toISOString(), updated_at: agora(), webinar_id: WEBINAR, ...extra };
}

function cenario(extra = {}) {
  const now = Date.now();
  return {
    admin_roles: [{ user_id: HOST }, { user_id: EQUIPE }],
    webinar_chat_messages: [{ author_user_id: ALUNA, body: "oi", created_at: agora(), display_name: "Ana M.", id: randomUUID(), offset_ms: 12_000, role: "student", session_id: S_NO_AR, source: "audience", webinar_id: WEBINAR }],
    webinar_presenters: [{ can_moderate_room: true, created_at: agora(), role: "co_host", user_id: COAPRESENTADOR, valid_until: null, webinar_id: WEBINAR }],
    webinar_sessions: [
      sessao({ id: S_MARCADA }),
      sessao({ id: S_ESPERA, room_name: `w-${WEBINAR}-abcdefghijkmnpqr`, status: "waiting" }),
      sessao({ id: S_NO_AR, room_name: `w-${WEBINAR}-bcdefghijkmnpqrs`, scheduled_at: new Date(now - 10 * MIN).toISOString(), started_at: new Date(now - 10 * MIN).toISOString(), status: "live" }),
      sessao({ ended_at: new Date(now - 30 * MIN).toISOString(), id: S_ENCERRADA, room_name: `w-${WEBINAR}-cdefghijkmnpqrst`, scheduled_at: new Date(now - 120 * MIN).toISOString(), started_at: new Date(now - 120 * MIN).toISOString(), status: "ended" }),
      sessao({ id: S_GRAVADA, kind: "simulated", status: "live" }),
      sessao({ id: S_OUTRA, recorder_requested_at: new Date(now - 3 * 60 * MIN).toISOString(), recorder_status: "gone", status: "ended" })
    ],
    webinars: [
      {
        access_mode: "everyone",
        allow_student_camera: true,
        audience: { kind: "everyone" },
        cancel_reason: null,
        cancelled_at: null,
        created_at: agora(),
        created_by: HOST,
        deleted_at: null,
        duration_minutes: 60,
        host_user_id: HOST,
        id: WEBINAR,
        kind: "live",
        published_at: agora(),
        registration_required: false,
        reminders: { email: false, h1: true, h24: true },
        room_settings: { chatMode: "open", practiceSession: true, waitingRoom: false },
        slug: "aula-ao-vivo",
        status: "published",
        title: "Aula ao vivo",
        updated_at: agora()
      }
    ],
    ...extra
  };
}

const linha = (db, id) => db.tables.webinar_sessions.find((row) => row.id === id);

const TODAS = () => [
  () => live.openLiveRoom({ sessionId: S_MARCADA }),
  () => live.startLiveSession({ sessionId: S_ESPERA }),
  () => live.endLiveSession({ sessionId: S_NO_AR }),
  () => live.setRoomLock({ locked: true, sessionId: S_NO_AR }),
  () => live.prepareRecorder({ sessionId: S_NO_AR }),
  () => live.releaseRecorder({ sessionId: S_NO_AR }),
  () => live.requestRecording({ sessionId: S_NO_AR }),
  () => live.markRecordingAnchor({ sessionId: S_NO_AR }),
  () => live.muteInChat({ minutes: 5, sessionId: S_NO_AR, userId: ALUNA }),
  () => live.kickFromSession({ sessionId: S_NO_AR, userId: ALUNA }),
  () => live.undoSessionBan({ kind: "muted", sessionId: S_NO_AR, userId: ALUNA }),
  () => live.banStudent({ sessionId: S_NO_AR, userId: ALUNA }),
  () => live.unbanStudent({ userId: ALUNA }),
  () => live.attachRecording({ embedUrl: `https://iframe.mediadelivery.net/embed/42/${VIDEO}`, sessionId: S_ENCERRADA }),
  () => live.alignChat({ anchorOffsetMs: 2000, recordingId: randomUUID() }),
  () => live.setBrowserRecording({ on: true, sessionId: S_NO_AR })
];

/* ------------------------------------------------------------------------------------------------
 * Permissoes (§2.6)
 * ---------------------------------------------------------------------------------------------- */

test("sem permissão: 403 em toda ação da sala ao vivo, sem tocar no banco", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));
  estado.negar = true;
  for (const chamada of TODAS()) {
    falha(await chamada(), 403);
  }
  assert.equal(db.calls.length, 0);
  assert.equal(db.rpcs.length, 0);
});

test("analista sem messaging.publish: abrir, começar, encerrar, o gravador, a ancora e banir recusam (403); trancar, silenciar, remover, desfazer, enviar a gravação e alinhar passam", async () => {
  usar(bancoEmMemoria(cenario(), RPC));
  estado.negar = ["messaging.publish"];
  const publish = [
    live.openLiveRoom({ sessionId: S_MARCADA }),
    live.startLiveSession({ sessionId: S_ESPERA }),
    live.endLiveSession({ sessionId: S_NO_AR }),
    live.prepareRecorder({ sessionId: S_NO_AR }),
    live.releaseRecorder({ sessionId: S_NO_AR }),
    live.requestRecording({ sessionId: S_NO_AR }),
    live.markRecordingAnchor({ sessionId: S_NO_AR }),
    live.banStudent({ sessionId: S_NO_AR, userId: ALUNA }),
    live.unbanStudent({ userId: ALUNA })
  ];
  for (const result of await Promise.all(publish)) {
    falha(result, 403);
  }
  ok(await live.setRoomLock({ locked: true, sessionId: S_NO_AR }));
  ok(await live.muteInChat({ minutes: 15, sessionId: S_NO_AR, userId: ALUNA }));
  ok(await live.kickFromSession({ sessionId: S_NO_AR, userId: ALUNO }));
  ok(await live.undoSessionBan({ kind: "muted", sessionId: S_NO_AR, userId: ALUNA }));
  // Enviar a gravação e Alinhar chat sao messaging.write (docs/30 §5.2): o analista sem publish tambem faz.
  const enviada = ok(await live.attachRecording({ durationSeconds: 60, embedUrl: `https://iframe.mediadelivery.net/embed/42/${VIDEO}`, sessionId: S_ENCERRADA }));
  ok(await live.alignChat({ anchorOffsetMs: 2000, recordingId: enviada.recordingId }));
  // A gravacao no navegador e do Apresentador (messaging.publish), como o Gravar.
  falha(await live.setBrowserRecording({ on: true, sessionId: S_NO_AR }), 403);
});

/* ------------------------------------------------------------------------------------------------
 * Abrir a sala, Comecar para todos, Encerrar live, Trancar
 * ---------------------------------------------------------------------------------------------- */

test("Abrir a sala: agendada vai para a espera e ganha o nome da sala; na espera nada muda; no ar, gravada, cancelada ou rascunho recusam (409)", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));

  const aberta = ok(await live.openLiveRoom({ sessionId: S_MARCADA }));
  assert.deepEqual(aberta, { changed: true, sessionId: S_MARCADA, status: "waiting" });
  assert.equal(linha(db, S_MARCADA).status, "waiting");
  assert.match(linha(db, S_MARCADA).room_name, new RegExp(`^w-${WEBINAR}-[a-z2-9]{16}$`), "o nome da sala gerado agora");
  assert.equal(audits(db, "webinar.room_opened")[0].metadata.changed, true);
  assert.ok(estado.revalidados.includes(`/admin/comunicacao/webinarios/${WEBINAR}/sala`));

  const nome = linha(db, S_MARCADA).room_name;
  const deNovo = ok(await live.openLiveRoom({ sessionId: S_MARCADA }));
  assert.equal(deNovo.changed, false);
  assert.equal(linha(db, S_MARCADA).room_name, nome, "o nome nao muda");

  falha(await live.openLiveRoom({ sessionId: S_NO_AR }), 409);
  const gravada = falha(await live.openLiveRoom({ sessionId: S_GRAVADA }), 409);
  assert.equal(gravada.error, LIVE_ACTION_MESSAGES.notLive);
  falha(await live.openLiveRoom({ sessionId: randomUUID() }), 404);

  const rascunho = usar(bancoEmMemoria(cenario({ webinars: [{ ...cenario().webinars[0], status: "draft" }] }), RPC));
  falha(await live.openLiveRoom({ sessionId: S_MARCADA }), 409);
  assert.equal(linha(rascunho, S_MARCADA).status, "scheduled");
});

test("Começar para todos abre pela RPC (no ar, started_at) da agendada ou da espera; no ar de novo recusa; Encerrar live fecha pela RPC e descarta o Gravar da fila", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));

  const comecou = ok(await live.startLiveSession({ sessionId: S_ESPERA }));
  assert.deepEqual([comecou.changed, comecou.sessionId], [true, S_ESPERA]);
  assert.equal(linha(db, S_ESPERA).status, "live");
  assert.deepEqual(db.rpcs.map((call) => call.name), ["webinar_open_session"]);
  assert.equal(audits(db, "webinar.live_started")[0].metadata.from, "waiting");

  ok(await live.startLiveSession({ sessionId: S_MARCADA }));
  assert.ok(linha(db, S_MARCADA).room_name, "a agendada ganha a sala ao comecar");
  falha(await live.startLiveSession({ sessionId: S_NO_AR }), 409);

  linha(db, S_NO_AR).recording_requested_at = new Date().toISOString();
  const encerrada = ok(await live.endLiveSession({ sessionId: S_NO_AR }));
  assert.deepEqual([encerrada.sessionId, encerrada.summary.unique, encerrada.replayCreated], [S_NO_AR, 4, false]);
  assert.equal(linha(db, S_NO_AR).status, "ended");
  assert.equal(linha(db, S_NO_AR).recording_requested_at, null, "o Gravar da fila sai");
  const audit = audits(db, "webinar.live_ended")[0];
  assert.deepEqual([audit.count, audit.metadata.unique, audit.metadata.peak], [4, 4, 4]);

  const nova = usar(bancoEmMemoria(cenario(), RPC));
  falha(await live.endLiveSession({ sessionId: S_MARCADA }), 409, "agendada nao encerra");
  assert.equal(nova.rpcs.length, 0);
  falha(await live.endLiveSession({ sessionId: S_ENCERRADA }), 409);
  falha(await live.endLiveSession({ sessionId: S_GRAVADA }), 409);
});

test("Trancar e destrancar gravam room_locked e a auditoria; sessao encerrada recusa", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));
  assert.deepEqual(ok(await live.setRoomLock({ locked: true, sessionId: S_NO_AR })), { locked: true, sessionId: S_NO_AR });
  assert.equal(linha(db, S_NO_AR).room_locked, true);
  ok(await live.setRoomLock({ locked: false, sessionId: S_NO_AR }));
  assert.equal(linha(db, S_NO_AR).room_locked, false);
  assert.deepEqual(
    audits(db, "webinar.room_locked").map((row) => row.metadata.locked),
    [true, false]
  );
  falha(await live.setRoomLock({ locked: true, sessionId: S_ENCERRADA }), 409);
});

/* ------------------------------------------------------------------------------------------------
 * O gravador e a ancora (§6.4, §6.5 e §6.7)
 * ---------------------------------------------------------------------------------------------- */

test("a ancora: a RPC grava pela hora do servidor uma vez; a segunda chamada devolve a mesma (already); sessao que nao e live recusa", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));
  linha(db, S_NO_AR).recorder_status = "ready";
  linha(db, S_NO_AR).recording_requested_at = new Date().toISOString();
  const antes = Date.now();

  const primeira = ok(await live.markRecordingAnchor({ sessionId: S_NO_AR }));
  assert.equal(primeira.changed, true);
  assert.equal(primeira.recorderStatus, "recording");
  const ancora = Date.parse(primeira.anchor);
  assert.ok(ancora >= antes && ancora <= Date.now(), "hora do servidor, nunca a do navegador");
  assert.equal(linha(db, S_NO_AR).recording_anchor_at, primeira.anchor);
  assert.equal(linha(db, S_NO_AR).recording_requested_at, null);
  assert.deepEqual(Object.keys(db.rpcs[0].args).sort(), ["p_now", "p_session_id"], "o navegador nao manda hora");

  const segunda = ok(await live.markRecordingAnchor({ sessionId: S_NO_AR }));
  assert.deepEqual([segunda.changed, segunda.reason, segunda.anchor], [false, "already", primeira.anchor]);
  assert.deepEqual(
    audits(db, "webinar.recording_anchor").map((row) => [row.metadata.changed, row.metadata.rebased]),
    [
      [true, 1],
      [false, 0]
    ]
  );
  falha(await live.markRecordingAnchor({ sessionId: S_GRAVADA }), 409);
  const naoAoVivo = ok(await live.markRecordingAnchor({ sessionId: S_MARCADA }));
  assert.equal(naoAoVivo.reason, "not_live");
});

test("Gravar: pronta -> start; preparando -> fila com recording_requested_at e a estimativa pelas ultimas subidas; gravando -> recording; sem maquina -> unavailable; agendada recusa", async () => {
  const pedido = new Date(Date.now() - 2 * MIN).toISOString();
  const db = usar(
    bancoEmMemoria(
      cenario({
        webinar_recording_events: [
          { id: randomUUID(), payload: {}, processing_status: "processed", received_at: new Date(Date.now() - 2 * 60 * MIN - 6 * MIN).toISOString(), session_id: S_OUTRA, state: "ready" }
        ]
      }),
      RPC
    )
  );
  // A outra sessao levou 6 min do pedido ao ready: com 2 min de espera, faltam 4.
  linha(db, S_OUTRA).recorder_requested_at = new Date(Date.now() - 2 * 60 * MIN - 12 * MIN).toISOString();

  linha(db, S_NO_AR).recorder_status = "ready";
  assert.deepEqual(ok(await live.requestRecording({ sessionId: S_NO_AR })), { action: "start" });
  assert.equal(linha(db, S_NO_AR).recording_requested_at, null);

  linha(db, S_NO_AR).recorder_status = "preparing";
  linha(db, S_NO_AR).recorder_requested_at = pedido;
  const fila = ok(await live.requestRecording({ sessionId: S_NO_AR }));
  assert.equal(fila.action, "queue");
  assert.equal(fila.estimateMinutes, 4);
  assert.equal(linha(db, S_NO_AR).recording_requested_at, fila.recordingRequestedAt);
  const repetida = ok(await live.requestRecording({ sessionId: S_NO_AR }));
  assert.equal(repetida.recordingRequestedAt, fila.recordingRequestedAt, "o segundo clique nao troca a hora da fila");

  linha(db, S_NO_AR).recorder_status = "recording";
  assert.deepEqual(ok(await live.requestRecording({ sessionId: S_NO_AR })), { action: "recording" });
  linha(db, S_NO_AR).recorder_status = "none";
  assert.deepEqual(ok(await live.requestRecording({ sessionId: S_NO_AR })), { action: "unavailable" });
  assert.deepEqual(
    audits(db, "webinar.recording_requested").map((row) => row.metadata.action),
    ["start", "queue", "queue", "recording", "unavailable"]
  );

  falha(await live.requestRecording({ sessionId: S_MARCADA }), 409);
  falha(await live.requestRecording({ sessionId: S_ENCERRADA }), 409);
});

test("Preparar gravação sem o pedido automático: responde o motivo (not_configured) com a frase da reserva e não muda nada", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));
  const result = falha(await live.prepareRecorder({ sessionId: S_NO_AR }), 409);
  assert.equal(result.reason, "not_configured");
  assert.equal(result.error, WEBINAR_COPY.consoleAoVivo.disparoAusente);
  assert.equal(linha(db, S_NO_AR).recorder_status, "none");
  assert.equal(linha(db, S_NO_AR).recorder_requested_at, null);
  assert.equal(db.tables.admin_audit_log.length, 0, "nada foi pedido");
});

test("Preparar gravação com o duble (WEBINAR_RECORDER_DISPATCH=fake): jibri-up anotado, preparing com a hora do pedido; pedir de novo recusa; Desligar o gravador recusa gravando e aceita uploaded (jibri-down)", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));
  process.env.WEBINAR_RECORDER_DISPATCH = "fake";
  linha(db, S_NO_AR).recorder_alerted_at = new Date().toISOString();
  const antes = fakeRecorderDispatches().length;

  assert.deepEqual(ok(await live.prepareRecorder({ sessionId: S_NO_AR })), { recorderStatus: "preparing", sessionId: S_NO_AR });
  const sessaoNoAr = linha(db, S_NO_AR);
  assert.equal(sessaoNoAr.recorder_status, "preparing");
  assert.ok(sessaoNoAr.recorder_requested_at);
  assert.equal(sessaoNoAr.recorder_alerted_at, null, "o aviso de 6 h volta a valer para a maquina nova");
  assert.deepEqual(fakeRecorderDispatches().slice(antes), [{ force: false, sessionId: S_NO_AR, step: "jibri-up" }]);
  assert.deepEqual(audits(db, "webinar.recorder_requested")[0].metadata, { dispatcher: "fake", from: "none", ok: true, reason: null, session_id: S_NO_AR });

  falha(await live.prepareRecorder({ sessionId: S_NO_AR }), 409);
  falha(await live.prepareRecorder({ sessionId: S_ENCERRADA }), 409);

  // O jibri-up morreu sem avisar (nem ready nem unavailable): passados 25 min do pedido, Preparar gravacao pede de novo
  // e o Gravar deixa de ir para a fila (a reserva).
  sessaoNoAr.recorder_requested_at = new Date(Date.now() - 26 * MIN).toISOString();
  assert.deepEqual(ok(await live.requestRecording({ sessionId: S_NO_AR })), { action: "unavailable" }, "o preparo vencido nao entra na fila");
  assert.deepEqual(ok(await live.prepareRecorder({ sessionId: S_NO_AR })), { recorderStatus: "preparing", sessionId: S_NO_AR }, "preparar de novo depois do prazo");
  assert.ok(Date.now() - Date.parse(linha(db, S_NO_AR).recorder_requested_at) < MIN, "a hora do pedido novo");
  assert.deepEqual(fakeRecorderDispatches().at(-1), { force: false, sessionId: S_NO_AR, step: "jibri-up" });
  falha(await live.prepareRecorder({ sessionId: S_NO_AR }), 409);

  sessaoNoAr.recorder_status = "recording";
  const gravando = falha(await live.releaseRecorder({ sessionId: S_NO_AR }), 409);
  assert.equal(gravando.error, LIVE_ACTION_MESSAGES.recorderNotReleasable);

  sessaoNoAr.recorder_status = "uploaded";
  assert.deepEqual(ok(await live.releaseRecorder({ sessionId: S_NO_AR })), { force: false, sessionId: S_NO_AR });
  assert.ok(linha(db, S_NO_AR).recorder_release_requested_at);
  assert.deepEqual(fakeRecorderDispatches().at(-1), { force: false, sessionId: S_NO_AR, step: "jibri-down" });

  sessaoNoAr.recorder_status = "upload_failed";
  falha(await live.releaseRecorder({ sessionId: S_NO_AR }), 409);
  ok(await live.releaseRecorder({ force: true, sessionId: S_NO_AR }));
  assert.deepEqual(fakeRecorderDispatches().at(-1), { force: true, sessionId: S_NO_AR, step: "jibri-down" });
  assert.deepEqual(
    audits(db, "webinar.recorder_released").map((row) => row.metadata.force),
    [false, true]
  );

  delete process.env.WEBINAR_RECORDER_DISPATCH;
  linha(db, S_NO_AR).recorder_status = "uploaded";
  assert.equal(falha(await live.releaseRecorder({ sessionId: S_NO_AR }), 409).reason, "not_configured");
});

/* ------------------------------------------------------------------------------------------------
 * Silenciar, remover, banir (§1.4 e §8.3)
 * ---------------------------------------------------------------------------------------------- */

test("Silenciar no chat 5 / 15 / 60 min com until_at e até o fim sem; o motivo vira booleano na auditoria; Desfazer apaga", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));
  const bans = () => db.tables.webinar_session_bans.filter((row) => row.user_id === ALUNA && row.kind === "muted");

  for (const minutes of [5, 15, 60]) {
    const antes = Date.now();
    const result = ok(await live.muteInChat({ minutes, reason: "xingou no chat", sessionId: S_NO_AR, userId: ALUNA }));
    const until = Date.parse(result.untilAt);
    assert.ok(until >= antes + minutes * MIN && until <= Date.now() + minutes * MIN, `${minutes} min`);
    assert.equal(bans().length, 1, "uma linha por aluno e tipo: o prazo novo troca o velho");
    assert.equal(bans()[0].until_at, result.untilAt);
    assert.equal(bans()[0].by_user_id, HOST);
  }
  const ateOFim = ok(await live.muteInChat({ minutes: null, sessionId: S_NO_AR, userId: ALUNA }));
  assert.equal(ateOFim.untilAt, null);
  assert.equal(bans()[0].until_at, null);

  const registros = audits(db, "webinar.chat_muted");
  assert.deepEqual(
    registros.map((row) => row.metadata.minutes),
    [5, 15, 60, null]
  );
  assert.deepEqual(registros[0].metadata, { kind: "muted", minutes: 5, session_id: S_NO_AR, target_user_id: ALUNA, with_reason: true });
  assert.ok(!JSON.stringify(db.tables.admin_audit_log).includes("xingou"), "o texto do motivo nao vai para a auditoria");

  const desfeito = ok(await live.undoSessionBan({ kind: "muted", sessionId: S_NO_AR, userId: ALUNA }));
  assert.equal(desfeito.existed, true);
  assert.equal(bans().length, 0);
  assert.equal(ok(await live.undoSessionBan({ kind: "muted", sessionId: S_NO_AR, userId: ALUNA })).existed, false);
  assert.equal(audits(db, "webinar.session_ban_undone").length, 2);

  falha(await live.muteInChat({ minutes: 7, sessionId: S_NO_AR, userId: ALUNA }), 400);
  falha(await live.muteInChat({ minutes: 5, sessionId: S_ENCERRADA, userId: ALUNA }), 409);
  falha(await live.muteInChat({ minutes: 5, sessionId: S_GRAVADA, userId: ALUNA }), 409);
});

test("Remover da sala: kicked até o fim (sem until_at, mesmo se mandarem minutos); nunca a equipe (admin, Apresentador, co-apresentador)", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));
  const removido = ok(await live.kickFromSession({ minutes: 60, sessionId: S_NO_AR, userId: ALUNO }));
  assert.deepEqual(removido, { kind: "kicked", sessionId: S_NO_AR, untilAt: null, userId: ALUNO });
  assert.deepEqual(
    db.tables.webinar_session_bans.map((row) => [row.user_id, row.kind, row.until_at]),
    [[ALUNO, "kicked", null]]
  );
  assert.equal(audits(db, "webinar.kicked")[0].metadata.target_user_id, ALUNO);

  for (const alvo of [HOST, EQUIPE, COAPRESENTADOR]) {
    const recusa = falha(await live.kickFromSession({ sessionId: S_NO_AR, userId: alvo }), 409);
    assert.equal(recusa.error, LIVE_ACTION_MESSAGES.staffTarget);
    falha(await live.muteInChat({ minutes: 5, sessionId: S_NO_AR, userId: alvo }), 409);
    falha(await live.banStudent({ sessionId: S_NO_AR, userId: alvo }), 409);
  }
  assert.equal(db.tables.webinar_session_bans.length, 1);
  assert.equal(db.tables.webinar_user_bans.length, 0);
});

test("Banir: banido de todos os webinários e removido desta sessão; Desfazer banimento apaga só o banimento; só com messaging.publish", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));
  assert.deepEqual(ok(await live.banStudent({ reason: "spam", sessionId: S_NO_AR, userId: ALUNA })), { sessionId: S_NO_AR, userId: ALUNA });
  assert.deepEqual(
    db.tables.webinar_user_bans.map((row) => [row.user_id, row.session_id, row.by_user_id, row.reason]),
    [[ALUNA, S_NO_AR, HOST, "spam"]]
  );
  assert.deepEqual(
    db.tables.webinar_session_bans.map((row) => [row.user_id, row.kind]),
    [[ALUNA, "kicked"]]
  );
  assert.deepEqual(audits(db, "webinar.banned")[0].metadata, { session_id: S_NO_AR, target_user_id: ALUNA, with_reason: true });

  assert.deepEqual(ok(await live.unbanStudent({ userId: ALUNA })), { existed: true, userId: ALUNA });
  assert.equal(db.tables.webinar_user_bans.length, 0);
  assert.equal(db.tables.webinar_session_bans.length, 1, "o remover desta sessao continua (Desfazer à parte)");
  assert.equal(audits(db, "webinar.unbanned")[0].entity_type, "student");

  estado.negar = ["messaging.publish"];
  falha(await live.banStudent({ sessionId: S_NO_AR, userId: ALUNO }), 403);
  falha(await live.unbanStudent({ userId: ALUNA }), 403);
  assert.equal(db.tables.webinar_user_bans.length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * Enviar gravacao e Alinhar chat (§5.2, §6.5)
 * ---------------------------------------------------------------------------------------------- */

test("Enviar gravação: o player com a duração liga o vídeo pronto à sessão encerrada e cria o replay; sem duração fica processing; endereço errado 400; vídeo de outra gravação 409", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));

  falha(await live.attachRecording({ embedUrl: "https://exemplo.test/video", sessionId: S_ENCERRADA }), 400);
  falha(await live.attachRecording({ sessionId: S_ENCERRADA }), 400);

  const ligado = ok(await live.attachRecording({ durationSeconds: 3600, embedUrl: `https://iframe.mediadelivery.net/embed/42/${VIDEO}`, sessionId: S_ENCERRADA }));
  assert.deepEqual([ligado.created, ligado.status, ligado.replayCreated], [true, "ready", true]);
  const gravacao = db.tables.webinar_recordings.find((row) => row.id === ligado.recordingId);
  assert.deepEqual(
    [gravacao.session_id, gravacao.webinar_id, gravacao.source, gravacao.provider, gravacao.bunny_library_id, gravacao.bunny_video_id, gravacao.duration_seconds, gravacao.embed_url],
    [S_ENCERRADA, WEBINAR, "upload", "bunny", "42", VIDEO, 3600, `https://iframe.mediadelivery.net/embed/42/${VIDEO}`]
  );
  assert.equal(linha(db, S_ENCERRADA).recording_id, ligado.recordingId);
  const replay = db.tables.webinar_sessions.find((row) => row.kind === "replay");
  assert.deepEqual([replay?.source_session_id, replay?.recording_id], [S_ENCERRADA, ligado.recordingId]);
  assert.equal(audits(db, "webinar.recording_attached")[0].metadata.replay_created, true);

  const outra = falha(await live.attachRecording({ bunnyLibraryId: "42", bunnyVideoId: VIDEO, sessionId: S_NO_AR }), 409);
  assert.equal(outra.error, LIVE_ACTION_MESSAGES.videoTaken);

  const semDuracao = ok(await live.attachRecording({ bunnyLibraryId: "42", bunnyVideoId: "99999999-aaaa-4bbb-8ccc-dddddddddddd", sessionId: S_NO_AR }));
  assert.deepEqual([semDuracao.status, semDuracao.replayCreated], ["processing", false], "o job consulta a Bunny");
});

test("Enviar gravação com a live no ar: so a linha da gravacao (com session_id), sem ligar recording_id: o Encerrar live mede pelo relogio e liga depois", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));
  const noAr = ok(await live.attachRecording({ durationSeconds: 2400, embedUrl: `https://iframe.mediadelivery.net/embed/42/${VIDEO}`, sessionId: S_NO_AR }));
  assert.deepEqual([noAr.status, noAr.replayCreated], ["ready", false]);
  assert.equal(db.tables.webinar_recordings.find((row) => row.id === noAr.recordingId).session_id, S_NO_AR);
  assert.equal(linha(db, S_NO_AR).recording_id ?? null, null, "a live no ar nao aponta para o video de 40 min");

  const naEspera = ok(await live.attachRecording({ bunnyLibraryId: "42", bunnyVideoId: "99999999-aaaa-4bbb-8ccc-dddddddddd01", sessionId: S_ESPERA }));
  assert.equal(linha(db, S_ESPERA).recording_id ?? null, null, "nem na espera");
  assert.ok(naEspera.recordingId);

  // Encerrar live: a RPC mede (o duble nao olha a gravacao) e o replay nasce com a gravacao achada pelo session_id.
  const encerrada = ok(await live.endLiveSession({ sessionId: S_NO_AR }));
  assert.equal(encerrada.replayCreated, true);
  assert.equal(linha(db, S_NO_AR).recording_id, noAr.recordingId, "ligada depois de medir");
});

test("Gravar no navegador: a sessao guarda browser_recording_at ao ligar e limpa ao parar (o selo Gravando do aluno); encerrada recusa ligar; Encerrar live limpa", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));
  assert.deepEqual(ok(await live.setBrowserRecording({ on: true, sessionId: S_NO_AR })), { on: true, sessionId: S_NO_AR });
  const ligada = linha(db, S_NO_AR).browser_recording_at;
  assert.ok(ligada && Date.now() - Date.parse(ligada) < MIN);
  ok(await live.setBrowserRecording({ on: true, sessionId: S_NO_AR }));
  assert.equal(linha(db, S_NO_AR).browser_recording_at, ligada, "ligar de novo mantem a hora");
  ok(await live.setBrowserRecording({ on: false, sessionId: S_NO_AR }));
  assert.equal(linha(db, S_NO_AR).browser_recording_at, null);
  assert.deepEqual(audits(db, "webinar.browser_recording").map((row) => row.metadata.on), [true, true, false]);

  falha(await live.setBrowserRecording({ on: true, sessionId: S_ENCERRADA }), 409);
  falha(await live.setBrowserRecording({ on: true, sessionId: S_GRAVADA }), 409);

  ok(await live.setBrowserRecording({ on: true, sessionId: S_NO_AR }));
  ok(await live.endLiveSession({ sessionId: S_NO_AR }));
  assert.equal(linha(db, S_NO_AR).browser_recording_at, null, "a live encerrada nao fica gravando");
});

test("Enviar gravação depois do envio do gravador que falhou: atualiza a mesma gravação (sem duplicar) e limpa o erro", async () => {
  const falhou = { anchor_offset_ms: 0, created_at: agora(), error_message: "Envio para a Bunny falhou.", file_name: "sala_2026-11-05-23-00-05.mp4", id: randomUUID(), provider: "bunny", session_id: S_ENCERRADA, source: "jibri", status: "failed", updated_at: agora(), webinar_id: WEBINAR };
  const db = usar(bancoEmMemoria(cenario({ webinar_recordings: [{ ...DEFAULTS.webinar_recordings, ...falhou }] }), RPC));
  const result = ok(await live.attachRecording({ durationSeconds: 1800, embedUrl: `https://iframe.mediadelivery.net/play/42/${VIDEO}`, sessionId: S_ENCERRADA }));
  assert.deepEqual([result.created, result.recordingId], [false, falhou.id]);
  assert.equal(db.tables.webinar_recordings.length, 1);
  assert.deepEqual([db.tables.webinar_recordings[0].status, db.tables.webinar_recordings[0].error_message, db.tables.webinar_recordings[0].source], ["ready", null, "upload"]);
});

test("Alinhar chat: grava anchor_offset_ms, audita o antes e o depois e nenhuma mensagem muda de offset; gravação inexistente 404; fora do limite 400", async () => {
  const recordingId = randomUUID();
  const db = usar(
    bancoEmMemoria(cenario({ webinar_recordings: [{ ...DEFAULTS.webinar_recordings, anchor_offset_ms: 1000, created_at: agora(), id: recordingId, session_id: S_ENCERRADA, updated_at: agora(), webinar_id: WEBINAR }] }), RPC)
  );
  const offsets = () => db.tables.webinar_chat_messages.map((row) => row.offset_ms);
  const antes = offsets();

  assert.deepEqual(ok(await live.alignChat({ anchorOffsetMs: -3000, recordingId })), { after: -3000, before: 1000, recordingId });
  assert.equal(db.tables.webinar_recordings[0].anchor_offset_ms, -3000);
  assert.deepEqual(offsets(), antes);
  assert.deepEqual(audits(db, "webinar.chat_aligned")[0].metadata, { after: -3000, before: 1000, recording_id: recordingId, session_id: S_ENCERRADA });

  falha(await live.alignChat({ anchorOffsetMs: 0, recordingId: randomUUID() }), 404);
  falha(await live.alignChat({ anchorOffsetMs: 3_600_001, recordingId }), 400);
});

test("toda ação que muda algo grava a auditoria só com ids e contagens (nada de nome, e-mail nem texto digitado)", async () => {
  const db = usar(bancoEmMemoria(cenario(), RPC));
  process.env.WEBINAR_RECORDER_DISPATCH = "fake";
  ok(await live.openLiveRoom({ sessionId: S_MARCADA }));
  ok(await live.startLiveSession({ sessionId: S_MARCADA }));
  ok(await live.setRoomLock({ locked: true, sessionId: S_MARCADA }));
  ok(await live.prepareRecorder({ sessionId: S_MARCADA }));
  ok(await live.requestRecording({ sessionId: S_MARCADA }));
  ok(await live.markRecordingAnchor({ sessionId: S_MARCADA }));
  ok(await live.muteInChat({ minutes: 5, reason: "motivo secreto", sessionId: S_MARCADA, userId: ALUNA }));
  ok(await live.kickFromSession({ reason: "motivo secreto", sessionId: S_MARCADA, userId: ALUNO }));
  ok(await live.undoSessionBan({ kind: "kicked", sessionId: S_MARCADA, userId: ALUNO }));
  ok(await live.banStudent({ reason: "motivo secreto", sessionId: S_MARCADA, userId: ALUNO }));
  ok(await live.unbanStudent({ reason: "motivo secreto", userId: ALUNO }));
  ok(await live.endLiveSession({ sessionId: S_MARCADA }));
  const anexo = ok(await live.attachRecording({ durationSeconds: 60, embedUrl: `https://iframe.mediadelivery.net/embed/42/${VIDEO}`, sessionId: S_MARCADA }));
  ok(await live.alignChat({ anchorOffsetMs: 500, recordingId: anexo.recordingId }));

  assert.deepEqual(
    db.tables.admin_audit_log.map((row) => row.action),
    [
      "webinar.room_opened",
      "webinar.live_started",
      "webinar.room_locked",
      "webinar.recorder_requested",
      "webinar.recording_requested",
      "webinar.recording_anchor",
      "webinar.chat_muted",
      "webinar.kicked",
      "webinar.session_ban_undone",
      "webinar.banned",
      "webinar.unbanned",
      "webinar.live_ended",
      "webinar.recording_attached",
      "webinar.chat_aligned"
    ]
  );
  assert.ok(db.tables.admin_audit_log.every((row) => row.actor_id === HOST));
  const texto = JSON.stringify(db.tables.admin_audit_log);
  assert.ok(!/motivo secreto|Produtor|produtor\.teste|full_name|email/.test(texto), texto);
});

/* ------------------------------------------------------------------------------------------------
 * Os dados do console (console-queries.ts: o bloco `live` do retrato de 5 s)
 * ---------------------------------------------------------------------------------------------- */

test("o retrato da live: gravador com a estimativa e a diferença do arquivo, a gravação com a prévia, removidos/silenciados/banidos, o mapa aluno -> participante com o nome da sala e nada do nome da sala nem token", async () => {
  const now = new Date();
  const nowMs = now.getTime();
  const sala = `w-${WEBINAR}-bcdefghijkmnpqrs`;
  const db = usar(
    bancoEmMemoria(
      cenario({
        profiles: [
          { full_name: "Ana Maria Souza", id: ALUNA },
          { full_name: "Bruno Lima", id: ALUNO },
          { full_name: "Carla Dias", id: COAPRESENTADOR }
        ],
        student_events: [
          { created_at: new Date(nowMs - 9 * MIN).toISOString(), entity_id: S_NO_AR, entity_type: "webinar", event_type: "webinar_room_joined", id: randomUUID(), metadata: { participant_id: "p-velho" }, user_id: ALUNA },
          { created_at: new Date(nowMs - 2 * MIN).toISOString(), entity_id: S_NO_AR, entity_type: "webinar", event_type: "webinar_room_joined", id: randomUUID(), metadata: { participant_id: "p-ana" }, user_id: ALUNA },
          { created_at: new Date(nowMs - 3 * MIN).toISOString(), entity_id: S_NO_AR, entity_type: "webinar", event_type: "webinar_room_joined", id: randomUUID(), metadata: { participant_id: "p-carla" }, user_id: COAPRESENTADOR },
          { created_at: new Date(nowMs - 3 * MIN).toISOString(), entity_id: S_ESPERA, entity_type: "webinar", event_type: "webinar_room_joined", id: randomUUID(), metadata: { participant_id: "p-outra" }, user_id: ALUNO }
        ],
        webinar_chat_consents: [{ consent_version: 1, consented_at: agora(), created_at: agora(), display_mode: "nickname", nickname: "Aninha", revoked_at: null, updated_at: agora(), user_id: ALUNA }],
        webinar_recording_events: [
          { file_name: null, id: randomUUID(), payload: {}, processing_status: "processed", received_at: new Date(nowMs - 2 * 60 * MIN - 6 * MIN).toISOString(), session_id: S_OUTRA, state: "ready" },
          { file_name: `${sala}_2026-11-05-23-03-20.mp4`, id: randomUUID(), payload: { fileName: `${sala}_2026-11-05-23-03-20.mp4`, state: "uploaded" }, processing_status: "processed", received_at: new Date(nowMs - MIN).toISOString(), session_id: S_NO_AR, state: "uploaded" }
        ],
        webinar_recordings: [{ ...DEFAULTS.webinar_recordings, anchor_offset_ms: 1500, bunny_library_id: "42", bunny_video_id: VIDEO, created_at: agora(), duration_seconds: 3600, embed_url: `https://iframe.mediadelivery.net/embed/42/${VIDEO}`, id: randomUUID(), session_id: S_NO_AR, source: "jibri", status: "ready", updated_at: agora(), webinar_id: WEBINAR }],
        webinar_session_bans: [
          { by_user_id: HOST, created_at: agora(), kind: "kicked", reason: null, session_id: S_NO_AR, until_at: null, user_id: ALUNO },
          { by_user_id: HOST, created_at: agora(), kind: "muted", reason: null, session_id: S_NO_AR, until_at: new Date(nowMs + 10 * MIN).toISOString(), user_id: ALUNA }
        ],
        webinar_user_bans: [{ by_user_id: HOST, created_at: agora(), reason: "spam", session_id: S_NO_AR, user_id: ALUNO }]
      }),
      RPC
    )
  );
  Object.assign(linha(db, S_NO_AR), { recorder_requested_at: new Date(nowMs - 2 * MIN).toISOString(), recorder_status: "preparing", recording_anchor_at: "2026-11-05T23:03:15.000Z", room_locked: true });
  linha(db, S_OUTRA).recorder_requested_at = new Date(nowMs - 2 * 60 * MIN - 12 * MIN).toISOString();
  process.env.WEBINAR_MEET_DOMAIN = "meet.exemplo.test";
  process.env.WEBINAR_JWT_SECRET = "s".repeat(40);

  try {
    const retrato = await consoleQueries.getConsoleSnapshot(WEBINAR, S_NO_AR, now);
    const bloco = retrato.live;
    assert.equal(bloco.meetConfigured, true);
    assert.equal(bloco.roomLocked, true);
    assert.deepEqual(
      { ...bloco.recorder },
      {
        anchorAt: "2026-11-05T23:03:15.000Z",
        dispatchConfigured: false,
        driftMs: 5_000,
        estimateMinutes: 4,
        fileStartedAt: "2026-11-05T23:03:20.000Z",
        recordingRequestedAt: null,
        releaseRequestedAt: null,
        requestedAt: linha(db, S_NO_AR).recorder_requested_at,
        status: "preparing"
      }
    );
    assert.equal(bloco.recording.anchorOffsetMs, 1500);
    assert.equal(bloco.recording.status, "ready");
    assert.match(bloco.recording.previewUrl, new RegExp(`^https://iframe\\.mediadelivery\\.net/embed/42/${VIDEO}\\?autoplay=false`));

    const pessoas = Object.fromEntries(bloco.people.map((item) => [item.userId, item]));
    assert.deepEqual(Object.keys(pessoas).sort(), [ALUNA, ALUNO, COAPRESENTADOR].sort(), "quem entrou, quem foi barrado e quem escreveu");
    assert.deepEqual([pessoas[ALUNA].displayName, pessoas[ALUNA].participantId, pessoas[ALUNA].ban.muted, pessoas[ALUNA].staff], ["Aninha", "p-ana", true, false], "o participante mais novo e o nome do chat");
    assert.deepEqual([pessoas[ALUNO].displayName, pessoas[ALUNO].participantId, pessoas[ALUNO].ban.kicked, pessoas[ALUNO].ban.banned], ["Bruno L.", null, true, true], "a entrada em outra sessao nao conta");
    assert.deepEqual([pessoas[COAPRESENTADOR].staff, pessoas[COAPRESENTADOR].displayName], [true, "Carla D."]);
    assert.deepEqual(
      bloco.people.map((item) => item.userId),
      [ALUNA, ALUNO, COAPRESENTADOR],
      "os barrados primeiro (por nome), depois o resto"
    );

    assert.equal(retrato.session.roomName, null, "o nome da sala nunca vai para o console");
    assert.ok(!JSON.stringify(retrato).includes(sala.slice(0, 40) + "bcdefghijkmnpqrs"), "nem em lugar nenhum do retrato");
    assert.ok(!JSON.stringify(retrato).includes("jwt"));

    delete process.env.WEBINAR_JWT_SECRET;
    assert.equal((await consoleQueries.getConsoleSnapshot(WEBINAR, S_NO_AR, now)).live.meetConfigured, false, "sem o segredo, a sala nao existe neste ambiente");
    assert.equal((await consoleQueries.getConsoleSnapshot(WEBINAR, S_GRAVADA, now)).live, null, "a gravada nao tem o bloco da sala");

    const pagina = await consoleQueries.getSessionConsoleData(WEBINAR, S_NO_AR, now);
    assert.ok(pagina.sessions.every((item) => item.roomName === null), "o seletor de sessoes tambem sem o nome da sala");
    assert.deepEqual([pagina.webinar.practiceSession, pagina.webinar.waitingRoom, pagina.webinar.allowStudentCamera], [true, false, true]);
  } finally {
    delete process.env.WEBINAR_MEET_DOMAIN;
    delete process.env.WEBINAR_JWT_SECRET;
  }
});

test("fase 4 (4e com o Atendimento da 4c): o seletor do console mostra das sessoes 'Comeca quando voce entra' so as de hoje em Sao Paulo e as em andamento; a pedida fica", () => {
  // 05/11/2026 23:30 em UTC = 20:30 em Sao Paulo: "hoje" e o dia 05 em Sao Paulo.
  const nowMs = Date.parse("2026-11-05T23:30:00.000Z");
  const sessao = (id, scheduledAt, extra = {}) => ({ id, jit: true, scheduledAt, status: "scheduled", ...extra });
  const sessions = [
    { id: "comum-velha", jit: false, scheduledAt: "2026-10-01T23:00:00.000Z", status: "ended" },
    sessao("jit-hoje-cedo", "2026-11-05T11:15:00.000Z", { status: "ended" }),
    sessao("jit-hoje-noite", "2026-11-06T01:45:00+00:00"),
    sessao("jit-ontem", "2026-11-05T02:15:00.000Z", { status: "ended" }),
    sessao("jit-ontem-no-ar", "2026-11-04T23:00:00.000Z", { status: "live" }),
    sessao("jit-amanha", "2026-11-06T12:00:00.000Z"),
    sessao("jit-pedida", "2026-11-01T12:00:00.000Z", { status: "ended" })
  ];
  assert.deepEqual(
    consoleQueries.consoleSessionsFor(sessions, nowMs).map((item) => item.id),
    ["comum-velha", "jit-hoje-cedo", "jit-hoje-noite", "jit-ontem-no-ar"],
    "22:45 em Sao Paulo ainda e hoje; 23:15 do dia 04 em Sao Paulo nao"
  );
  assert.ok(consoleQueries.consoleSessionsFor(sessions, nowMs, "jit-pedida").some((item) => item.id === "jit-pedida"), "a pedida por ?sessao= continua no seletor");
});
