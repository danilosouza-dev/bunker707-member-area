import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// O webhook do gravador (docs/30 §5.3, §6.4 passos 4, 10 e 11, §6.7 e §8.2; D17), sem banco: as rotas de verdade
// (POST /api/webhooks/recorder e GET /api/webhooks/recorder/[sessionId]) contra um banco falso em memoria (tabelas como
// listas, filtros do PostgREST e as chaves unicas: sessao + estado + arquivo + maquina nos pedidos do gravador,
// provider + video da Bunny nas gravacoes, a chave do e-mail na fila), com a assinatura feita por recorderHeaders e um
// segredo de teste. Aqui: 401 sem cabecalhos, com assinatura errada, com carimbo de 6 min e sem segredo (nada gravado);
// 400 com corpo invalido; 413 acima de 64 KB; 202 ignored para sessao desconhecida (linha com session_id nulo); ready,
// recording, uploaded (a gravacao jibri em processing com os ids da Bunny, duracao, tamanho e sha256 minusculo),
// upload_failed (gravacao failed e um e-mail na fila, uma vez) e gone; o repetido (200 duplicate, nada muda), o fora de
// ordem, a sala de outra sessao e a sessao que nao e live (ignored com o motivo); a falha no meio (500) que o workflow
// repete e entao processa; o mesmo estado de maquina para uma maquina pedida de novo; o GET assinado do jibri-down.

const sem = (globalThis.__gravadorWebhook ??= { banco: true });

/** O modulo de src/ que um import pede ("server/db/supabase/client"), pelo alias ou por caminho relativo. */
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

// O cliente do banco (pedido pelo alias nas rotas e por caminho relativo em src/server/webinars/db.ts) e o banco falso.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (moduloDeSrc(specifier, context) === "server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return globalThis.__gravadorWebhook.banco; }`);
    }
    return nextResolve(specifier, context);
  }
});

process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";

const webhookRoute = await import("../src/app/api/webhooks/recorder/route.ts");
const statusRoute = await import("../src/app/api/webhooks/recorder/[sessionId]/route.ts");
const { recorderHeaders } = await import("../src/server/webinars/recorder-signature.ts");
const {
  RECORDER_WEBHOOK_REASONS,
  RECORDING_FAILED_EMAIL_KIND,
  handleRecorderWebhook,
  recordingFailedEmailKey,
  withoutEmptyFields
} = await import("../src/server/webinars/recorder-webhook.ts");
const { renderWebinarRecordingFailedEmail, webinarRecordingFailedEmailContent } = await import("../src/server/email/templates/webinar-recording-failed.ts");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const SECRET = "segredo-do-gravador-com-mais-de-32-caracteres-0001";
const WEBINAR = "abababab-0000-4000-8000-000000000001";
const SESSION = "abababab-0000-4000-8000-000000000002";
const SIMULATED = "abababab-0000-4000-8000-000000000003";
const HOST = "abababab-0000-4000-8000-000000000010";
const AUTHOR = "abababab-0000-4000-8000-000000000011";
const ROOM = "w-abababab-0000-4000-8000-000000000001-abcdefghijkmnpqr";
const FILE = `${ROOM}_2026-11-05-23-02-10.mp4`;
const VIDEO = "0b6d8e1e-aaaa-bbbb-cccc-1234567890ab";
const SHA = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";
const iso = (time) => new Date(time).toISOString();

/* ------------------------------------------------------------------------------------------------
 * Banco falso
 * ---------------------------------------------------------------------------------------------- */

/** As chaves unicas que o webhook encontra (202610280001, 202610290002 e 202610290003), a fila de e-mail e o sino. */
const UNIQUE = {
  email_outbox: (row) => row.idempotency_key,
  notifications: (row) => `${row.user_id}|${row.dedupe_key}`,
  // 202610290003: sessao + estado + arquivo + maquina (machine_requested_at).
  webinar_recording_events: (row) => (row.session_id ? `${row.session_id}|${row.state}|${row.file_name ?? ""}|${row.machine_requested_at ?? ""}` : null),
  webinar_recordings: (row) => (row.bunny_video_id ? `${row.provider}|${row.bunny_video_id}` : null),
  webinar_sessions: (row) => (row.kind === "replay" ? row.webinar_id : null)
};
const DEFAULTS = {
  email_outbox: { attempts: 0, status: "queued" },
  webinar_recording_events: { error_message: null, processed_at: null, processing_status: "pending" },
  webinar_recordings: {
    anchor_offset_ms: 0,
    bunny_library_id: null,
    bunny_video_id: null,
    checked_at: null,
    duration_seconds: null,
    embed_url: null,
    error_message: null,
    file_name: null,
    provider: "bunny",
    purge_due_at: null,
    purged_at: null,
    session_id: null,
    sha256: null,
    size_bytes: null,
    source: "upload",
    status: "ready"
  }
};

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function matches(row, [op, column, value, extra]) {
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
      return value === "is" && extra === null ? current !== null && current !== undefined : true;
    case "gte":
      return current != null && compare(current, value) >= 0;
    case "gt":
      return current != null && compare(current, value) > 0;
    case "lte":
      return current != null && compare(current, value) <= 0;
    case "lt":
      return current != null && compare(current, value) < 0;
    default:
      return true;
  }
}

/** Tabelas em memoria com os filtros que o webhook usa; `falhar(tabela, op, erro)` faz a proxima consulta falhar. */
function bancoFalso(seed = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const calls = [];
  const falhas = [];
  const table = (name) => (tables[name] ??= []);

  function violates(name, row, ignore) {
    const key = UNIQUE[name]?.(row);
    return key != null && table(name).some((existing) => existing !== ignore && UNIQUE[name](existing) === key);
  }

  function query(name) {
    const state = { filters: [], limit: null, op: null, options: null, order: [], payload: null, single: null };
    calls.push({ state, table: name });

    function finish(rows) {
      if (state.single === "single") return rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
      if (state.single === "maybe") return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    }

    function run() {
      const falha = falhas.find((item) => item.table === name && item.op === state.op && item.times > 0);
      if (falha) {
        falha.times -= 1;
        return { data: null, error: falha.error };
      }
      const rows = table(name);
      const filtered = () => rows.filter((row) => state.filters.every((filter) => matches(row, filter)));
      const now = iso(Date.now());

      if (state.op === "insert" || state.op === "upsert") {
        const payloads = Array.isArray(state.payload) ? state.payload : [state.payload];
        const touched = [];
        for (const payload of payloads) {
          const keys = state.options?.onConflict?.split(",");
          const existing = state.op === "upsert" && keys ? rows.find((row) => keys.every((key) => row[key] === payload[key])) : null;
          if (existing) {
            if (!state.options?.ignoreDuplicates) {
              Object.assign(existing, payload, { updated_at: now });
              touched.push(existing);
            }
            continue;
          }
          const row = { id: randomUUID(), ...(DEFAULTS[name] ?? {}), created_at: now, received_at: now, updated_at: now, ...payload };
          if (violates(name, row)) {
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint (${name})` } };
          }
          rows.push(row);
          touched.push(row);
        }
        return finish(touched);
      }
      if (state.op === "update") {
        const touched = filtered();
        for (const row of touched) {
          const next = { ...row, ...state.payload };
          if (violates(name, next, row)) {
            return { data: null, error: { code: "23505", message: `duplicate key (${name})` } };
          }
        }
        touched.forEach((row) => Object.assign(row, state.payload, { updated_at: now }));
        return finish(touched);
      }
      if (state.op === "delete") {
        const removed = filtered();
        tables[name] = rows.filter((row) => !removed.includes(row));
        return finish(removed);
      }
      let result = filtered();
      for (const [column, ascending, nullsFirst] of [...state.order].reverse()) {
        result = [...result].sort((a, b) => {
          if (a[column] == null || b[column] == null) {
            if (a[column] == b[column]) return 0;
            return (a[column] == null) === nullsFirst ? -1 : 1;
          }
          return ascending ? compare(a[column], b[column]) : compare(b[column], a[column]);
        });
      }
      if (state.limit !== null) result = result.slice(0, state.limit);
      return finish(result);
    }

    const filter = (op) => (column, value, extra) => {
      state.filters.push([op, column, value, extra]);
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
      not: filter("not"),
      order: (column, options) => (state.order.push([column, options?.ascending !== false, options?.nullsFirst ?? options?.ascending === false]), chain),
      range: () => chain,
      select: () => ((state.op ??= "select"), chain),
      single: () => ((state.single = "single"), chain),
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
      update: (payload) => ((state.op = "update"), (state.payload = payload), chain),
      upsert: (payload, options) => ((state.op = "upsert"), (state.payload = payload), (state.options = options ?? null), chain)
    };
    return chain;
  }

  return {
    calls,
    falhar(name, op, error, times = 1) {
      falhas.push({ error, op, table: name, times });
    },
    from(name) {
      return query(name);
    },
    rpc() {
      throw new Error("o webhook nao chama RPC");
    },
    tables
  };
}

/** A escola: uma Live ao vivo publicada com a sala, o Apresentador e quem criou, e uma Live gravada. */
function escola({ hostUserId = HOST, profiles, session = {}, sessions = [] } = {}) {
  const now = Date.now();
  const webinar = (id, extra = {}) => ({
    auto_record: true,
    cancelled_at: null,
    created_by: AUTHOR,
    deleted_at: null,
    duration_minutes: 60,
    host_user_id: hostUserId,
    id,
    kind: "live",
    status: "published",
    title: "Live de agentes",
    ...extra
  });
  const sessao = (id, extra = {}) => ({
    chat_mode: "open",
    chat_slow_mode_seconds: null,
    created_at: iso(now - 3_600_000),
    ended_at: null,
    id,
    kind: "live",
    late_join_minutes: null,
    recorder_alerted_at: null,
    recorder_release_requested_at: null,
    recorder_requested_at: iso(now - 40 * 60_000),
    recorder_status: "preparing",
    recording_anchor_at: null,
    recording_id: null,
    recording_requested_at: null,
    room_locked: false,
    room_name: ROOM,
    scheduled_at: iso(now - 10 * 60_000),
    source_session_id: null,
    started_at: null,
    status: "live",
    updated_at: iso(now - 3_600_000),
    webinar_id: WEBINAR,
    ...extra
  });
  const banco = bancoFalso({
    email_outbox: [],
    profiles: profiles ?? [
      { email: "host@exemplo.test", full_name: "Helena Host", id: HOST },
      { email: "autor@exemplo.test", full_name: "Artur Autor", id: AUTHOR }
    ],
    webinar_recording_events: [],
    webinar_recordings: [],
    webinar_sessions: [sessao(SESSION, session), sessao(SIMULATED, { kind: "simulated", recorder_requested_at: null, recorder_status: "none", room_name: null }), ...sessions.map((extra) => sessao(extra.id, extra))],
    webinars: [webinar(WEBINAR)]
  });
  actionStubs.db = banco;
  return banco;
}

const sessaoDe = (banco, id = SESSION) => banco.tables.webinar_sessions.find((row) => row.id === id);
const eventos = (banco) => banco.tables.webinar_recording_events;
const gravacoes = (banco) => banco.tables.webinar_recordings;

/** Silencia console.info/warn/error durante `fn` e devolve [resultado, linhas]. */
async function quieto(fn) {
  const linhas = [];
  const original = { error: console.error, info: console.info, warn: console.warn };
  for (const metodo of ["error", "info", "warn"]) {
    console[metodo] = (...args) => linhas.push(`${metodo}: ${args.join(" ")}`);
  }
  try {
    return [await fn(), linhas];
  } finally {
    Object.assign(console, original);
  }
}

/** POST assinado (ou com os cabecalhos que o teste mandar) na rota de verdade; devolve { status, body }. */
async function postar(body, { headers, raw, secret = SECRET, signedAt = Date.now() } = {}) {
  const text = raw ?? JSON.stringify(body);
  const request = new Request("https://membros.exemplo.test/api/webhooks/recorder", {
    body: text,
    headers: headers ?? recorderHeaders(secret, text, signedAt),
    method: "POST"
  });
  const [response, logs] = await quieto(() => webhookRoute.POST(request));
  return { body: await response.json(), logs, response, status: response.status };
}

async function consultar(sessionId, { headers, secret = SECRET } = {}) {
  const request = new Request(`https://membros.exemplo.test/api/webhooks/recorder/${sessionId}`, { headers: headers ?? recorderHeaders(secret, "", Date.now()), method: "GET" });
  const [response] = await quieto(() => statusRoute.GET(request, { params: Promise.resolve({ sessionId }) }));
  return { body: await response.json(), status: response.status };
}

const uploaded = (extra = {}) => ({
  bunnyLibraryId: "42",
  bunnyVideoId: VIDEO,
  durationSeconds: 3754,
  fileName: FILE,
  room: ROOM,
  sessionId: SESSION,
  sha256: SHA,
  sizeBytes: 2_147_483_648,
  startedAt: "2026-11-05T23:02:10Z",
  state: "uploaded",
  ...extra
});

test.beforeEach(() => {
  process.env.WEBINAR_RECORDER_WEBHOOK_SECRET = SECRET;
  sem.banco = true;
});

/* ------------------------------------------------------------------------------------------------
 * Assinatura, corpo e tamanho
 * ---------------------------------------------------------------------------------------------- */

test("401 sem cabecalhos, com assinatura errada, com carimbo de 6 min e sem segredo configurado: nada e gravado", async () => {
  const banco = escola();
  const body = { sessionId: SESSION, state: "ready" };
  const text = JSON.stringify(body);
  const certos = recorderHeaders(SECRET, text, Date.now());

  const semCabecalhos = await postar(body, { headers: { "content-type": "application/json" } });
  assert.equal(semCabecalhos.status, 401);
  assert.deepEqual(semCabecalhos.body, { error: "Assinatura inválida." });

  const errada = await postar(body, { headers: { ...certos, "x-bunker-signature": "0".repeat(64) } });
  assert.equal(errada.status, 401);
  const outroSegredo = await postar(body, { secret: "outro-segredo-com-mais-de-32-caracteres-9999" });
  assert.equal(outroSegredo.status, 401);
  const corpoTrocado = await postar({ sessionId: SESSION, state: "gone" }, { headers: certos });
  assert.equal(corpoTrocado.status, 401, "a assinatura e sobre o texto exato");

  const velha = await postar(body, { signedAt: Date.now() - 6 * 60_000 });
  assert.equal(velha.status, 401, "carimbo fora da janela de 5 min");
  assert.ok(velha.logs.some((linha) => /stale_timestamp/.test(linha)));

  delete process.env.WEBINAR_RECORDER_WEBHOOK_SECRET;
  const semSegredo = await postar(body);
  assert.equal(semSegredo.status, 401, "sem segredo no servidor tambem e 401");
  assert.ok(semSegredo.logs.some((linha) => /^error: .*WEBINAR_RECORDER_WEBHOOK_SECRET/.test(linha)));

  assert.equal(eventos(banco).length, 0, "nenhum pedido guardado");
  assert.equal(sessaoDe(banco).recorder_status, "preparing", "a sessao nao mudou");
  assert.equal(banco.calls.length, 0, "o banco nem foi consultado");
});

test("400 com JSON quebrado, sem estado, com estado desconhecido ou sessao que nao e uuid; 413 acima de 64 KB; nada e gravado", async () => {
  const banco = escola();

  assert.equal((await postar(null, { raw: "{nao e json" })).status, 400);
  assert.equal((await postar({ sessionId: SESSION })).status, 400);
  assert.equal((await postar({ sessionId: SESSION, state: "exploded" })).status, 400);
  assert.equal((await postar({ sessionId: "sessao-de-teste", state: "ready" })).status, 400);
  assert.equal((await postar({ sessionId: SESSION, sha256: "nao-e-hex", state: "uploaded" })).status, 400);

  const grande = JSON.stringify({ filler: "x".repeat(65 * 1024), sessionId: SESSION, state: "ready" });
  const enorme = await postar(null, { raw: grande });
  assert.equal(enorme.status, 413);
  assert.deepEqual(enorme.body, { error: "Corpo grande demais." });

  assert.equal(eventos(banco).length, 0);
  assert.equal(sessaoDe(banco).recorder_status, "preparing");
});

test("sem banco configurado: 503; o finalize.sh manda null nos campos que nao tem e isso vale como ausente", async () => {
  escola();
  sem.banco = false;
  const semBanco = await postar({ sessionId: SESSION, state: "ready" });
  assert.equal(semBanco.status, 503);

  assert.deepEqual(withoutEmptyFields({ bunnyVideoId: null, durationSeconds: null, sessionId: SESSION, sha256: "", startedAt: null, state: "upload_failed" }), {
    sessionId: SESSION,
    state: "upload_failed"
  });
  assert.equal(withoutEmptyFields("texto"), "texto");
});

/* ------------------------------------------------------------------------------------------------
 * Sessao desconhecida, ready, repetido e fora de ordem
 * ---------------------------------------------------------------------------------------------- */

test("sessao desconhecida: 202 ignored, o pedido fica guardado com session_id nulo e o log so tem ids", async () => {
  const banco = escola();
  const desconhecida = "abababab-0000-4000-8000-0000000000ff";

  const resposta = await postar({ room: ROOM, sessionId: desconhecida, state: "ready" });

  assert.equal(resposta.status, 202);
  assert.deepEqual(resposta.body, { status: "ignored" });
  const [linha] = eventos(banco);
  assert.equal(linha.session_id, null);
  assert.equal(linha.state, "ready");
  assert.equal(linha.processing_status, "ignored");
  assert.equal(linha.error_message, RECORDER_WEBHOOK_REASONS.unknown_session);
  assert.equal(linha.signature_valid, true);
  assert.deepEqual(linha.payload, { room: ROOM, sessionId: desconhecida, state: "ready" });
  const log = resposta.logs.find((texto) => texto.startsWith("info:"));
  assert.ok(log.includes(linha.id) && log.includes(desconhecida), "o log leva os ids");
  assert.ok(!log.includes(ROOM), "nunca o corpo");
});

test("ready: o gravador fica pronto, o pedido processed; o mesmo ready de novo e 200 duplicate sem mudar nada", async () => {
  const banco = escola();
  const pedido = sessaoDe(banco).recorder_requested_at;

  const resposta = await postar({ sessionId: SESSION, state: "ready" });

  assert.equal(resposta.status, 200);
  assert.deepEqual(resposta.body, { recorderStatus: "ready", status: "processed" });
  assert.equal(sessaoDe(banco).recorder_status, "ready");
  assert.equal(sessaoDe(banco).recorder_requested_at, pedido, "o pedido do app fica");
  const [linha] = eventos(banco);
  assert.equal(linha.processing_status, "processed");
  assert.ok(linha.processed_at);
  assert.equal(linha.session_id, SESSION);

  const antes = JSON.stringify(banco.tables);
  const repetido = await postar({ sessionId: SESSION, state: "ready" });
  assert.equal(repetido.status, 200);
  assert.deepEqual(repetido.body, { status: "duplicate" });
  assert.equal(JSON.stringify(banco.tables), antes, "nada mudou");
});

test("ready de uma maquina pedida a mao, repetido: a segunda chamada e duplicate e fica uma linha so (a chave leva a hora que a sessao recebeu)", async () => {
  const banco = escola({ session: { recorder_requested_at: null, recorder_status: "none" } });

  const primeiro = await postar({ sessionId: SESSION, state: "ready" });
  assert.deepEqual(primeiro.body, { recorderStatus: "ready", status: "processed" });
  const hora = sessaoDe(banco).recorder_requested_at;
  assert.ok(hora, "a hora do pedido foi gravada na sessao");

  const repetido = await postar({ sessionId: SESSION, state: "ready" });
  assert.equal(repetido.status, 200);
  assert.deepEqual(repetido.body, { status: "duplicate" });
  assert.deepEqual(
    eventos(banco).map((linha) => [linha.state, linha.machine_requested_at, linha.processing_status]),
    [["ready", hora, "processed"]]
  );
  assert.equal(sessaoDe(banco).recorder_status, "ready");
  // A maquina pedida a mao nao tem subida medida (a hora do pedido e a do proprio ready): fica fora da estimativa.
  const store = await import("../src/server/webinars/live-store.ts");
  assert.deepEqual(await store.recentRecorderPrepareDurations(banco), []);
});

test("ready e unavailable de uma maquina pedida a mao (sem recorder_requested_at) gravam a hora; unavailable de novo depois de outro pedido vale", async () => {
  const banco = escola({ session: { recorder_requested_at: null, recorder_status: "none" } });

  const indisponivel = await postar({ sessionId: SESSION, state: "unavailable" });
  assert.deepEqual(indisponivel.body, { recorderStatus: "unavailable", status: "processed" });
  const hora = sessaoDe(banco).recorder_requested_at;
  assert.ok(hora && Date.now() - Date.parse(hora) < 60_000, "a hora do pedido foi gravada agora");

  // A equipe pede outra maquina (console: preparing com a hora do pedido novo) e a Hetzner continua sem estoque: o
  // mesmo estado de novo vale, numa linha propria (a maquina esta na chave unica).
  const novoPedido = iso(Date.now() - 1000);
  Object.assign(sessaoDe(banco), { recorder_requested_at: novoPedido, recorder_status: "preparing" });
  const deNovo = await postar({ sessionId: SESSION, state: "unavailable" });
  assert.deepEqual(deNovo.body, { recorderStatus: "unavailable", status: "processed" });
  assert.equal(sessaoDe(banco).recorder_status, "unavailable");
  assert.deepEqual(
    eventos(banco).map((linha) => [linha.state, linha.machine_requested_at, linha.processing_status]),
    [
      ["unavailable", hora, "processed"],
      ["unavailable", novoPedido, "processed"]
    ],
    "cada maquina com a sua linha (a pedida a mao leva a hora gravada na sessao)"
  );

  // Agora a maquina sobe: ready a partir de unavailable.
  const pronto = await postar({ sessionId: SESSION, state: "ready" });
  assert.deepEqual(pronto.body, { recorderStatus: "ready", status: "processed" });
});

test("fora de ordem (uploaded depois de gone), sala de outra sessao e sessao que nao e live: 200 ignored com o motivo, nada muda", async () => {
  const banco = escola({ session: { recorder_status: "gone" } });

  const velho = await postar(uploaded());
  assert.equal(velho.status, 200);
  assert.deepEqual(velho.body, { reason: "out_of_order", recorderStatus: "gone", status: "ignored" });
  assert.equal(sessaoDe(banco).recorder_status, "gone");
  assert.equal(gravacoes(banco).length, 0, "nenhuma gravacao nasce de pedido velho");
  assert.equal(eventos(banco)[0].processing_status, "ignored");
  assert.equal(eventos(banco)[0].error_message, RECORDER_WEBHOOK_REASONS.out_of_order);

  sessaoDe(banco).recorder_status = "recording";
  const outraSala = await postar(uploaded({ fileName: "w-outra_2026-11-05-23-02-10.mp4", room: "w-outra-sala" }));
  assert.deepEqual(outraSala.body, { reason: "room_mismatch", recorderStatus: "recording", status: "ignored" });
  assert.equal(sessaoDe(banco).recorder_status, "recording");
  assert.equal(eventos(banco).at(-1).error_message, RECORDER_WEBHOOK_REASONS.room_mismatch);

  const gravada = await postar({ sessionId: SIMULATED, state: "ready" });
  assert.deepEqual(gravada.body, { reason: "not_live", recorderStatus: "none", status: "ignored" });
  assert.equal(sessaoDe(banco, SIMULATED).recorder_status, "none");
  assert.equal(gravacoes(banco).length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * recording, uploaded, upload_failed e gone
 * ---------------------------------------------------------------------------------------------- */

test("recording pelo webhook (ready -> recording) nao grava a ancora: ela e da acao do Apresentador", async () => {
  const banco = escola({ session: { recorder_status: "ready" } });

  const resposta = await postar({ sessionId: SESSION, state: "recording" });

  assert.deepEqual(resposta.body, { recorderStatus: "recording", status: "processed" });
  assert.equal(sessaoDe(banco).recorder_status, "recording");
  assert.equal(sessaoDe(banco).recording_anchor_at, null);
});

test("uploaded: a gravacao jibri nasce em processing com os ids da Bunny, duracao, tamanho, sha256 minusculo e o arquivo; repetido nao duplica", async () => {
  const banco = escola({ session: { recorder_status: "recording" } });

  const resposta = await postar(uploaded());

  assert.deepEqual(resposta.body, { recorderStatus: "uploaded", status: "processed" });
  assert.equal(sessaoDe(banco).recorder_status, "uploaded");
  assert.equal(sessaoDe(banco).recording_id, null, "a sessao so liga a gravacao quando a Bunny termina (job)");
  assert.equal(gravacoes(banco).length, 1);
  const [gravacao] = gravacoes(banco);
  assert.equal(gravacao.webinar_id, WEBINAR);
  assert.equal(gravacao.session_id, SESSION);
  assert.equal(gravacao.source, "jibri");
  assert.equal(gravacao.provider, "bunny");
  assert.equal(gravacao.status, "processing");
  assert.equal(gravacao.bunny_library_id, "42");
  assert.equal(gravacao.bunny_video_id, VIDEO);
  assert.equal(gravacao.duration_seconds, 3754);
  assert.equal(gravacao.size_bytes, 2_147_483_648);
  assert.equal(gravacao.sha256, SHA.toLowerCase());
  assert.equal(gravacao.file_name, FILE);
  assert.equal(gravacao.checked_at, null, "o job consulta logo");
  assert.deepEqual(eventos(banco)[0].payload, uploaded(), "o corpo inteiro guardado");

  const repetido = await postar(uploaded());
  assert.deepEqual(repetido.body, { status: "duplicate" });
  assert.equal(gravacoes(banco).length, 1);
  assert.equal(eventos(banco).length, 1);
});

test("uploaded com o video da Bunny ja ligado a outra gravacao (o unico provider + video): a mesma gravacao, sem erro", async () => {
  const banco = escola({ session: { recorder_status: "recording" } });
  banco.tables.webinar_recordings.push({ ...{ anchor_offset_ms: 0, checked_at: null, embed_url: null, error_message: null, purge_due_at: null, purged_at: null, sha256: null, size_bytes: null }, bunny_library_id: "42", bunny_video_id: VIDEO, created_at: iso(Date.now() - 60_000), duration_seconds: null, file_name: null, id: randomUUID(), provider: "bunny", session_id: null, source: "upload", status: "processing", updated_at: iso(Date.now()), webinar_id: WEBINAR });

  const resposta = await postar(uploaded());

  assert.equal(resposta.status, 200);
  assert.deepEqual(resposta.body, { recorderStatus: "uploaded", status: "processed" });
  assert.equal(gravacoes(banco).length, 1, "nenhuma linha nova");
});

test("upload_failed: a gravacao fica failed com o motivo e um e-mail entra na fila para o Apresentador, uma vez", async () => {
  const banco = escola({ session: { recorder_status: "recording" } });
  const corpo = { bunnyLibraryId: null, bunnyVideoId: null, durationSeconds: null, error: "bunny_upload_failed_attempt_3", fileName: FILE, room: ROOM, sessionId: SESSION, sha256: "", startedAt: null, state: "upload_failed" };

  const resposta = await postar(corpo);

  assert.deepEqual(resposta.body, { recorderStatus: "upload_failed", status: "processed" });
  assert.equal(sessaoDe(banco).recorder_status, "upload_failed");
  const [gravacao] = gravacoes(banco);
  assert.equal(gravacao.status, "failed");
  assert.equal(gravacao.source, "jibri");
  assert.equal(gravacao.error_message, "bunny_upload_failed_attempt_3");
  assert.equal(gravacao.file_name, FILE);
  assert.equal(gravacao.bunny_video_id, null);

  const fila = banco.tables.email_outbox;
  assert.equal(fila.length, 1);
  const [email] = fila;
  assert.equal(email.kind, RECORDING_FAILED_EMAIL_KIND);
  assert.equal(email.kind, "webinar_recording_failed");
  assert.equal(email.to_email, "host@exemplo.test");
  assert.equal(email.user_id, HOST);
  assert.equal(email.idempotency_key, recordingFailedEmailKey(SESSION, FILE));
  assert.equal(email.subject, WEBINAR_COPY.email.gravacaoFalhouAssunto("Live de agentes"));
  assert.ok(email.html.includes(`https://membros.exemplo.test/admin/comunicacao/webinarios/${WEBINAR}/sala`), "o botao leva ao console da live");
  assert.ok(email.text.includes("bunny_upload_failed_attempt_3"));
  assert.deepEqual(email.metadata, { session_id: SESSION, webinar_id: WEBINAR });
  assert.deepEqual(eventos(banco)[0].payload, corpo, "o corpo inteiro, com os nulls, fica guardado");

  // O finalize.sh repete (5 tentativas): duplicate, sem outro e-mail.
  const repetido = await postar(corpo);
  assert.deepEqual(repetido.body, { status: "duplicate" });
  assert.equal(banco.tables.email_outbox.length, 1);
});

test("upload_failed sem Apresentador com e-mail: o e-mail vai para quem criou o webinario; sem ninguem, so o log", async () => {
  const semHost = escola({ hostUserId: null, session: { recorder_status: "recording" } });
  await postar({ error: "bunny_not_configured", fileName: FILE, sessionId: SESSION, state: "upload_failed" });
  assert.equal(semHost.tables.email_outbox[0].to_email, "autor@exemplo.test");
  assert.equal(semHost.tables.email_outbox[0].user_id, AUTHOR);

  const ninguem = escola({ profiles: [], session: { recorder_status: "recording" } });
  const resposta = await postar({ error: "bunny_not_configured", fileName: FILE, sessionId: SESSION, state: "upload_failed" });
  assert.equal(resposta.status, 200);
  assert.equal(ninguem.tables.email_outbox.length, 0);
  assert.ok(resposta.logs.some((linha) => /^warn: .*nao tem Apresentador nem autor com e-mail/.test(linha)));
  assert.equal(gravacoes(ninguem)[0].status, "failed", "a gravacao falha fica do mesmo jeito");
});

test("gone: a maquina sumiu e o Gravar na fila sai; gone de novo e duplicate", async () => {
  const banco = escola({ session: { recorder_status: "uploaded", recording_requested_at: iso(Date.now() - 60_000) } });

  const resposta = await postar({ sessionId: SESSION, state: "gone" });

  assert.deepEqual(resposta.body, { recorderStatus: "gone", status: "processed" });
  assert.equal(sessaoDe(banco).recorder_status, "gone");
  assert.equal(sessaoDe(banco).recording_requested_at, null);
  assert.deepEqual((await postar({ sessionId: SESSION, state: "gone" })).body, { status: "duplicate" });
});

/* ------------------------------------------------------------------------------------------------
 * Falha no meio e a migracao pendente
 * ---------------------------------------------------------------------------------------------- */

test("falha no meio: 500 com o pedido failed; o workflow repete e o pedido e processado (a gravacao nasce uma vez)", async () => {
  const banco = escola({ session: { recorder_status: "recording" } });
  banco.falhar("webinar_recordings", "insert", { code: "57014", message: "canceling statement due to statement timeout" });

  const falhou = await postar(uploaded());

  assert.equal(falhou.status, 500);
  assert.deepEqual(falhou.body, { error: "Não foi possível processar o pedido do gravador.", status: "failed" });
  assert.equal(eventos(banco)[0].processing_status, "failed");
  assert.match(eventos(banco)[0].error_message, /statement timeout/);
  assert.equal(sessaoDe(banco).recorder_status, "uploaded", "a troca da situacao ja tinha passado");
  assert.equal(gravacoes(banco).length, 0);

  const repetido = await postar(uploaded());

  assert.equal(repetido.status, 200);
  assert.deepEqual(repetido.body, { recorderStatus: "uploaded", status: "processed" });
  assert.equal(gravacoes(banco).length, 1);
  assert.equal(gravacoes(banco)[0].status, "processing");
  assert.equal(eventos(banco).length, 1);
  assert.equal(eventos(banco)[0].processing_status, "processed");
  assert.equal(eventos(banco)[0].error_message, null);
});

test("a segunda maquina da mesma sessao (ready, gone, Preparar de novo, ready): duas linhas, cada uma com o corpo e a hora dela; a estimativa mede a segunda", async () => {
  const banco = escola();
  const store = await import("../src/server/webinars/live-store.ts");
  const primeiroPedido = sessaoDe(banco).recorder_requested_at;

  assert.deepEqual((await postar({ sessionId: SESSION, state: "ready" })).body, { recorderStatus: "ready", status: "processed" });
  assert.deepEqual((await postar({ sessionId: SESSION, state: "gone" })).body, { recorderStatus: "gone", status: "processed" });
  // Preparar gravacao de novo (live-actions.prepareRecorder): preparing com a hora do pedido novo.
  const segundoPedido = iso(Date.now() - 4 * 60_000);
  Object.assign(sessaoDe(banco), { recorder_requested_at: segundoPedido, recorder_status: "preparing" });
  const segundo = await postar({ marca: "segunda-maquina", sessionId: SESSION, state: "ready" });
  assert.deepEqual(segundo.body, { recorderStatus: "ready", status: "processed" });

  const prontos = eventos(banco).filter((linha) => linha.state === "ready");
  assert.equal(prontos.length, 2, "uma linha por maquina");
  assert.deepEqual(prontos.map((linha) => linha.machine_requested_at), [primeiroPedido, segundoPedido]);
  assert.equal(prontos[1].payload.marca, "segunda-maquina", "o corpo bruto da segunda chamada fica guardado");
  assert.ok(prontos.every((linha) => linha.processing_status === "processed"));

  const medidas = await store.recentRecorderPrepareDurations(banco);
  assert.equal(medidas.length, 2, "as duas subidas contam");
  assert.ok(medidas.every((ms) => ms > 0));
  // As duas linhas podem ter o mesmo received_at no banco falso: confere sem depender da ordem entre elas.
  assert.ok(medidas.some((ms) => Math.abs(ms - 4 * 60_000) < 10_000), `a segunda maquina levou cerca de 4 min (${medidas.join(", ")} ms)`);

  // A mesma maquina mandando o ready de novo continua 200 duplicate.
  assert.deepEqual((await postar({ sessionId: SESSION, state: "ready" })).body, { status: "duplicate" });
});

test("pedido preso em pending (o processo caiu no meio): depois de 60 s a repeticao o retoma e processa uma vez; ainda recente, 409 pending sem criar nada; duas repeticoes juntas criam uma gravacao so", async () => {
  const preso = (recebidoHa) => ({
    error_message: null,
    file_name: FILE,
    id: randomUUID(),
    machine_requested_at: null,
    payload: uploaded(),
    processed_at: null,
    processing_status: "pending",
    received_at: iso(Date.now() - recebidoHa),
    room: ROOM,
    session_id: SESSION,
    signature_valid: true,
    state: "uploaded"
  });

  // (a) preso ha 5 min: retomado e processado.
  const banco = escola({ session: { recorder_status: "recording" } });
  eventos(banco).push(preso(5 * 60_000));
  const retomado = await postar(uploaded());
  assert.equal(retomado.status, 200, JSON.stringify(retomado.body));
  assert.deepEqual(retomado.body, { recorderStatus: "uploaded", status: "processed" });
  assert.equal(gravacoes(banco).length, 1);
  assert.deepEqual([gravacoes(banco)[0].source, gravacoes(banco)[0].status], ["jibri", "processing"]);
  assert.equal(sessaoDe(banco).recorder_status, "uploaded", "o jibri-down ja pode devolver a maquina");
  assert.equal(eventos(banco).length, 1);
  assert.equal(eventos(banco)[0].processing_status, "processed");
  assert.deepEqual((await postar(uploaded())).body, { status: "duplicate" }, "depois de processado, so duplicate");

  // (b) preso ha 5 s (pode estar em processamento): 409 pending, o finalize.sh repete depois; nada criado.
  const recente = escola({ session: { recorder_status: "recording" } });
  eventos(recente).push(preso(5_000));
  const espera = await postar(uploaded());
  assert.equal(espera.status, 409);
  assert.deepEqual(espera.body, { status: "pending" });
  assert.equal(gravacoes(recente).length, 0);
  assert.equal(sessaoDe(recente).recorder_status, "recording");

  // (c) duas repeticoes juntas: so uma retoma a linha; a gravacao nasce uma vez.
  const juntas = escola({ session: { recorder_status: "recording" } });
  eventos(juntas).push(preso(5 * 60_000));
  const respostas = await Promise.all([postar(uploaded()), postar(uploaded())]);
  assert.deepEqual(respostas.map((resposta) => resposta.status).sort(), [200, 409]);
  assert.equal(gravacoes(juntas).length, 1);
  assert.equal(eventos(juntas)[0].processing_status, "processed");
});

test("banco sem a migracao 202610290003 (a mais nova): 503 e o log da migracao", async () => {
  const banco = escola();
  banco.falhar("webinar_sessions", "select", { code: "42703", message: 'column webinar_sessions.room_name does not exist' });

  const resposta = await postar({ sessionId: SESSION, state: "ready" });

  assert.equal(resposta.status, 503);
  assert.ok(resposta.logs.some((linha) => linha.includes("migracao 202610290003 pendente")));
  assert.equal(eventos(banco).length, 0);
});

test("o handler sem o Next devolve o mesmo (para a integracao da frente F7)", async () => {
  const banco = escola();
  const rawBody = JSON.stringify({ sessionId: SESSION, state: "ready" });
  const headers = recorderHeaders(SECRET, rawBody, Date.now());
  const [resposta] = await quieto(() =>
    handleRecorderWebhook({ db: banco, now: new Date(), rawBody, secret: SECRET, signature: headers["x-bunker-signature"], timestamp: headers["x-bunker-timestamp"] })
  );
  assert.deepEqual(resposta, { body: { recorderStatus: "ready", status: "processed" }, status: 200 });
});

/* ------------------------------------------------------------------------------------------------
 * GET assinado (jibri-down)
 * ---------------------------------------------------------------------------------------------- */

test("GET assinado devolve { recorderStatus, recordingStatus }; 401 sem assinatura; 400 id invalido; 404 sessao inexistente", async () => {
  const banco = escola({ session: { recorder_status: "recording" } });

  assert.deepEqual(await consultar(SESSION), { body: { recorderStatus: "recording", recordingStatus: null }, status: 200 });

  await postar(uploaded());
  assert.deepEqual(await consultar(SESSION), { body: { recorderStatus: "uploaded", recordingStatus: "processing" }, status: 200 });

  const semAssinatura = await consultar(SESSION, { headers: {} });
  assert.equal(semAssinatura.status, 401);
  const assinadaComCorpo = await consultar(SESSION, { headers: recorderHeaders(SECRET, "{}", Date.now()) });
  assert.equal(assinadaComCorpo.status, 401, "a assinatura do GET e sobre o corpo vazio");
  assert.equal((await consultar("sessao-de-teste")).status, 400);
  assert.equal((await consultar("abababab-0000-4000-8000-0000000000ee")).status, 404);
  assert.equal(eventos(banco).length, 1, "o GET nao grava nada");
});

/* ------------------------------------------------------------------------------------------------
 * Frases
 * ---------------------------------------------------------------------------------------------- */

test("as frases do webhook e do e-mail passam pela lista propria dos webinarios", () => {
  const input = { error: "bunny_upload_failed_attempt_3", link: "https://membros.exemplo.test/admin/comunicacao/webinarios/x/sala", title: "Aula de IA" };
  const rendered = renderWebinarRecordingFailedEmail(input);
  const content = webinarRecordingFailedEmailContent(input);
  // O endereco do console (/webinarios/) nao e frase: so os textos do e-mail passam pela lista.
  const textos = [...Object.values(RECORDER_WEBHOOK_REASONS), rendered.subject, content.heading, content.footer, ...content.blocks.map((block) => block.text ?? block.label)];
  for (const texto of textos) {
    const lower = texto.toLocaleLowerCase("pt-BR");
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!lower.includes(palavra), `"${texto}" usa "${palavra}"`);
    }
  }
  assert.equal(rendered.subject, "A gravação não subiu: Aula de IA");
  assert.ok(rendered.html.includes(WEBINAR_COPY.email.gravacaoFalhouBotao));
  assert.ok(rendered.text.includes(WEBINAR_COPY.email.gravacaoFalhouRodape));
  const longo = renderWebinarRecordingFailedEmail({ error: "x".repeat(500), link: "https://membros.exemplo.test/", title: "T" });
  assert.ok(!longo.text.includes("x".repeat(201)), "o motivo entra curto");
});
