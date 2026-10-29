import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/admin-action-stubs.mjs";

// O job webinar-recordings do tick (docs/30 §4.5, §6.4 passos 3, 10 e 11, §6.7 e I6; D10), sem banco: relogio falso,
// o duble do adaptador do GitHub (fakeRecorderDispatcher) e um duble da Bunny. Aqui: o preparo automatico aos 30 min
// da hora marcada (nunca antes, so com "Gravar automaticamente", uma vez por sessao, nada sem adaptador, nada com o
// pedido recusado, nada depois do fim previsto); a consulta a Bunny (pronta: duracao, sessao ligada e replay da live
// encerrada, um so; erro, envio falho e video inexistente: failed; codificando: so checked_at, de 2 em 2 min; 24 h:
// desiste; sem cliente da Bunny, nada); a devolucao da maquina (uploaded, ou ready com a sessao encerrada ha 30 min;
// nunca recording / upload_failed; de novo depois de 2 h sem gone); o aviso de 6 h no sino do Apresentador e dos
// co-apresentadores, uma vez por pedido de maquina; a retencao (apaga na Bunny, 404 conta, purged_at, uma vez por hora);
// a migracao pendente; o job (nome, registro, contagens em job_runs) e o cliente da Bunny (endereco, AccessKey, 404).

const { BUNNY_VIDEO_STATUS, BunnyStreamError, bunnyStreamClient, bunnyStreamFrom } = await import("../src/server/webinars/bunny-stream.ts");
const { fakeRecorderDispatcher, fakeRecorderDispatches } = await import("../src/server/webinars/recorder-dispatch.ts");
const tick = await import("../src/server/webinars/recordings-tick.ts");
const { WEBINAR_RECORDINGS_JOB_NAME, webinarRecordingsJob } = await import("../src/server/jobs/webinar-recordings-job.ts");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const { EMPTY_RECORDINGS_RESULT, RECORDINGS_PURGE_MINUTE, RECORDINGS_TICK_MESSAGES, runRecordingsTick } = tick;

const MIN = 60_000;
const HOUR = 60 * MIN;
const HORA_MARCADA = Date.parse("2026-11-05T23:00:00.000Z");
const WEBINAR = "acacacac-0000-4000-8000-000000000001";
const SEM_AUTO = "acacacac-0000-4000-8000-000000000002";
const CANCELADO = "acacacac-0000-4000-8000-000000000003";
const SESSION = "acacacac-0000-4000-8000-000000000011";
const HOST = "acacacac-0000-4000-8000-000000000021";
const CO_HOST = "acacacac-0000-4000-8000-000000000022";
const EQUIPE = "acacacac-0000-4000-8000-000000000023";
const CO_HOST_VENCIDO = "acacacac-0000-4000-8000-000000000024";
const AUTOR = "acacacac-0000-4000-8000-000000000025";
const VIDEO = "0b6d8e1e-aaaa-bbbb-cccc-1234567890ab";
const iso = (time) => new Date(time).toISOString();
const em = (time) => new Date(time);

/* ------------------------------------------------------------------------------------------------
 * Banco falso (o mesmo desenho de tests/webinarios-gravador-webhook.test.mjs)
 * ---------------------------------------------------------------------------------------------- */

const UNIQUE = {
  notifications: (row) => `${row.user_id}|${row.dedupe_key}`,
  webinar_recordings: (row) => (row.bunny_video_id ? `${row.provider}|${row.bunny_video_id}` : null),
  webinar_sessions: (row) => (row.kind === "replay" ? row.webinar_id : null)
};

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function matches(row, [op, column, value]) {
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

function bancoFalso(seed = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const calls = [];
  const falhas = [];
  const table = (name) => (tables[name] ??= []);
  const violates = (name, row, ignore) => {
    const key = UNIQUE[name]?.(row);
    return key != null && table(name).some((existing) => existing !== ignore && UNIQUE[name](existing) === key);
  };

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
        const touched = [];
        for (const payload of Array.isArray(state.payload) ? state.payload : [state.payload]) {
          const keys = state.options?.onConflict?.split(",");
          const existing = state.op === "upsert" && keys ? rows.find((row) => keys.every((key) => row[key] === payload[key])) : null;
          if (existing) {
            if (!state.options?.ignoreDuplicates) touched.push(Object.assign(existing, payload));
            continue;
          }
          const row = { id: randomUUID(), created_at: now, updated_at: now, ...payload };
          if (violates(name, row)) return { data: null, error: { code: "23505", message: `duplicate key (${name})` } };
          rows.push(row);
          touched.push(row);
        }
        return finish(touched);
      }
      if (state.op === "update") {
        const touched = filtered();
        touched.forEach((row) => Object.assign(row, state.payload));
        return finish(touched);
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

    const filter = (op) => (column, value) => {
      state.filters.push([op, column, value]);
      return chain;
    };
    const chain = {
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
    from: query,
    rpc() {
      throw new Error("o job nao chama RPC");
    },
    tables
  };
}

/* ------------------------------------------------------------------------------------------------
 * A escola de mentira
 * ---------------------------------------------------------------------------------------------- */

function webinarRow(id, extra = {}) {
  return {
    auto_record: true,
    cancelled_at: null,
    created_by: AUTOR,
    deleted_at: null,
    duration_minutes: 60,
    host_user_id: HOST,
    id,
    kind: "live",
    status: "published",
    title: "Live de agentes",
    ...extra
  };
}

function sessaoRow(id, extra = {}) {
  return {
    chat_mode: "open",
    chat_slow_mode_seconds: null,
    created_at: iso(HORA_MARCADA - 24 * HOUR),
    ended_at: null,
    id,
    kind: "live",
    late_join_minutes: null,
    recorder_alerted_at: null,
    recorder_release_requested_at: null,
    recorder_requested_at: null,
    recorder_status: "none",
    recording_anchor_at: null,
    recording_id: null,
    recording_requested_at: null,
    room_locked: false,
    room_name: null,
    scheduled_at: iso(HORA_MARCADA),
    source_session_id: null,
    started_at: null,
    status: "scheduled",
    updated_at: iso(HORA_MARCADA - 24 * HOUR),
    webinar_id: WEBINAR,
    ...extra
  };
}

function gravacaoRow(extra = {}) {
  return {
    anchor_offset_ms: 0,
    bunny_library_id: "42",
    bunny_video_id: VIDEO,
    checked_at: null,
    created_at: iso(HORA_MARCADA + 70 * MIN),
    duration_seconds: 3754,
    embed_url: null,
    error_message: null,
    file_name: "w-sala_2026-11-05-23-02-10.mp4",
    id: randomUUID(),
    provider: "bunny",
    purge_due_at: null,
    purged_at: null,
    session_id: SESSION,
    sha256: null,
    size_bytes: null,
    source: "jibri",
    status: "processing",
    updated_at: iso(HORA_MARCADA + 70 * MIN),
    webinar_id: WEBINAR,
    ...extra
  };
}

function escola({ gravacoes = [], presenters = [], sessoes = [sessaoRow(SESSION)], webinars = [webinarRow(WEBINAR)] } = {}) {
  return bancoFalso({ job_runs: [{ id: "run", metadata: null }], notifications: [], webinar_presenters: presenters, webinar_recordings: gravacoes, webinar_sessions: sessoes, webinars });
}

/** O duble da Bunny: `videos` diz o que cada GET responde (objeto, null = 404, "erro" = BunnyStreamError); anota as chamadas. */
function bunnyFalsa(videos = {}, { apagar = {} } = {}) {
  const log = [];
  return {
    async deleteVideo(libraryId, videoId) {
      log.push(["DELETE", libraryId, videoId]);
      const answer = apagar[videoId] ?? "deleted";
      if (answer === "erro") throw new BunnyStreamError("Bunny: apagar respondeu 500.", 500);
      return answer;
    },
    async getVideo(libraryId, videoId) {
      log.push(["GET", libraryId, videoId]);
      const answer = videos[videoId];
      if (answer === "erro") throw new BunnyStreamError("Bunny: GET do video (sem resposta em tempo).");
      return answer === undefined ? { lengthSeconds: null, status: BUNNY_VIDEO_STATUS.transcoding } : answer;
    },
    libraryId: "42",
    log
  };
}

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

async function rodar(db, now, extra = {}) {
  const [result, logs] = await quieto(() => runRecordingsTick({ db, now: em(now), ...extra }));
  return Object.assign(result, { logs });
}

const sessaoDe = (db, id = SESSION) => db.tables.webinar_sessions.find((row) => row.id === id);
const resultado = (extra = {}) => ({ ...EMPTY_RECORDINGS_RESULT, ...extra });
const semLogs = ({ logs, ...result }) => (void logs, result);

/* ------------------------------------------------------------------------------------------------
 * 1. Preparar automatico
 * ---------------------------------------------------------------------------------------------- */

test("preparo automatico: nao antes dos 30 min, aos 30 min pede a maquina uma vez e a sessao fica preparing com a hora do pedido", async () => {
  const db = escola();
  const dispatcher = fakeRecorderDispatcher([]);

  assert.deepEqual(semLogs(await rodar(db, HORA_MARCADA - 31 * MIN, { dispatcher })), resultado());
  assert.equal(dispatcher.log.length, 0);
  assert.equal(sessaoDe(db).recorder_status, "none");

  assert.deepEqual(semLogs(await rodar(db, HORA_MARCADA - 30 * MIN, { dispatcher })), resultado({ prepared: 1 }));
  assert.deepEqual(dispatcher.log, [{ force: false, sessionId: SESSION, step: "jibri-up" }]);
  assert.equal(sessaoDe(db).recorder_status, "preparing");
  assert.equal(sessaoDe(db).recorder_requested_at, iso(HORA_MARCADA - 30 * MIN));

  // Os ticks seguintes nao pedem outra maquina (recorder_requested_at ja existe).
  assert.deepEqual(semLogs(await rodar(db, HORA_MARCADA - 29 * MIN, { dispatcher })), resultado());
  assert.equal(dispatcher.log.length, 1);
});

test("preparo automatico: so com Gravar automaticamente, webinario publicado e nao cancelado, dentro da janela; a sessao no ar tambem conta", async () => {
  const db = escola({
    sessoes: [
      sessaoRow("acacacac-0000-4000-8000-000000000031", { webinar_id: SEM_AUTO }),
      sessaoRow("acacacac-0000-4000-8000-000000000032", { webinar_id: CANCELADO }),
      sessaoRow("acacacac-0000-4000-8000-000000000033", { scheduled_at: iso(HORA_MARCADA - 61 * MIN), status: "live" }),
      sessaoRow("acacacac-0000-4000-8000-000000000034", { kind: "simulated" }),
      sessaoRow("acacacac-0000-4000-8000-000000000035", { scheduled_at: iso(HORA_MARCADA - 20 * MIN), started_at: iso(HORA_MARCADA - 20 * MIN), status: "live" })
    ],
    webinars: [webinarRow(WEBINAR), webinarRow(SEM_AUTO, { auto_record: false }), webinarRow(CANCELADO, { cancelled_at: iso(HORA_MARCADA - HOUR) })]
  });
  const dispatcher = fakeRecorderDispatcher([]);

  const result = await rodar(db, HORA_MARCADA, { dispatcher });

  assert.equal(result.prepared, 1);
  assert.deepEqual(dispatcher.log.map((item) => item.sessionId), ["acacacac-0000-4000-8000-000000000035"], "so a live no ar, com auto_record, antes do fim previsto");
});

test("sem adaptador (sem GITHUB_INFRA_TOKEN) nada muda; o pedido recusado pelo GitHub nao marca a sessao e o tick tenta de novo", async () => {
  const db = escola({ sessoes: [sessaoRow(SESSION), sessaoRow("acacacac-0000-4000-8000-000000000036", { recorder_requested_at: iso(HORA_MARCADA - 3 * HOUR), recorder_status: "uploaded" })] });

  assert.deepEqual(semLogs(await rodar(db, HORA_MARCADA - 10 * MIN, { dispatcher: null })), resultado());
  assert.equal(sessaoDe(db).recorder_status, "none");
  assert.equal(sessaoDe(db, "acacacac-0000-4000-8000-000000000036").recorder_release_requested_at, null, "sem adaptador, nada de devolucao");
  assert.ok(!db.calls.some((call) => call.state.op === "update"), "nenhuma escrita");

  const recusa = {
    kind: "github",
    release: async () => ({ ok: false, reason: "github_error", status: 422, step: "jibri-down" }),
    request: async () => ({ ok: false, reason: "github_error", status: 422, step: "jibri-up" })
  };
  const result = await rodar(db, HORA_MARCADA - 10 * MIN, { dispatcher: recusa });
  assert.equal(result.prepared, 0);
  assert.equal(result.released, 0);
  assert.equal(sessaoDe(db).recorder_status, "none");
  assert.equal(sessaoDe(db).recorder_requested_at, null);
  assert.ok(result.logs.some((linha) => linha.startsWith("error:") && linha.includes("github_error 422")));
});

/* ------------------------------------------------------------------------------------------------
 * 2. A codificacao na Bunny
 * ---------------------------------------------------------------------------------------------- */

test("Bunny pronta: a gravacao fica ready com a duracao e o player, liga a sessao encerrada e cria o replay, um so", async () => {
  const gravacao = gravacaoRow();
  const db = escola({ gravacoes: [gravacao], sessoes: [sessaoRow(SESSION, { ended_at: iso(HORA_MARCADA + 65 * MIN), recorder_status: "uploaded", status: "ended" })] });
  const bunny = bunnyFalsa({ [VIDEO]: { lengthSeconds: 3700, status: BUNNY_VIDEO_STATUS.finished } });
  const agora = HORA_MARCADA + 80 * MIN;

  const result = await rodar(db, agora, { bunny });

  assert.deepEqual(semLogs(result), resultado({ ready: 1, replays: 1 }));
  assert.deepEqual(bunny.log, [["GET", "42", VIDEO]]);
  const pronta = db.tables.webinar_recordings[0];
  assert.equal(pronta.status, "ready");
  assert.equal(pronta.duration_seconds, 3700);
  assert.equal(pronta.checked_at, iso(agora));
  assert.equal(pronta.embed_url, `https://iframe.mediadelivery.net/embed/42/${VIDEO}`);
  assert.equal(sessaoDe(db).recording_id, gravacao.id);
  const replays = db.tables.webinar_sessions.filter((row) => row.kind === "replay");
  assert.equal(replays.length, 1);
  assert.equal(replays[0].recording_id, gravacao.id);
  assert.equal(replays[0].source_session_id, SESSION);
  assert.equal(replays[0].status, "live", "o replay nasce disponivel");

  // Os ticks seguintes nao consultam de novo nem criam outro replay.
  assert.deepEqual(semLogs(await rodar(db, agora + 5 * MIN, { bunny })), resultado());
  assert.equal(bunny.log.length, 1);
  assert.equal(db.tables.webinar_sessions.filter((row) => row.kind === "replay").length, 1);
});

test("Bunny pronta com a live ainda no ar: a gravacao fica ready so com session_id (nao liga recording_id: o encerramento mede a live pelo relogio, nunca pelo video); o replay espera o fim", async () => {
  const gravacao = gravacaoRow();
  const db = escola({ gravacoes: [gravacao], sessoes: [sessaoRow(SESSION, { recorder_status: "uploaded", status: "live" })] });

  const result = await rodar(db, HORA_MARCADA + 50 * MIN, { bunny: bunnyFalsa({ [VIDEO]: { lengthSeconds: null, status: BUNNY_VIDEO_STATUS.finished } }) });

  assert.deepEqual(semLogs(result), resultado({ ready: 1 }));
  assert.equal(db.tables.webinar_recordings[0].duration_seconds, 3754, "sem duracao da Bunny, fica a do arquivo");
  assert.equal(db.tables.webinar_recordings[0].session_id, SESSION);
  assert.equal(sessaoDe(db).recording_id, null, "a live no ar nao aponta para a gravacao de 40 min");
  assert.equal(db.tables.webinar_sessions.filter((row) => row.kind === "replay").length, 0);
});

test("Bunny com erro, envio falho ou video inexistente: a gravacao fica failed com o motivo", async () => {
  const erro = gravacaoRow({ bunny_video_id: "11111111-aaaa-bbbb-cccc-000000000001" });
  const envio = gravacaoRow({ bunny_video_id: "11111111-aaaa-bbbb-cccc-000000000002" });
  const sumiu = gravacaoRow({ bunny_video_id: "11111111-aaaa-bbbb-cccc-000000000003" });
  const db = escola({ gravacoes: [erro, envio, sumiu] });
  const bunny = bunnyFalsa({
    [erro.bunny_video_id]: { lengthSeconds: null, status: BUNNY_VIDEO_STATUS.error },
    [envio.bunny_video_id]: { lengthSeconds: null, status: BUNNY_VIDEO_STATUS.uploadFailed },
    [sumiu.bunny_video_id]: null
  });

  const result = await rodar(db, HORA_MARCADA + 2 * HOUR, { bunny });

  assert.deepEqual(semLogs(result), resultado({ failed: 3 }));
  const porVideo = Object.fromEntries(db.tables.webinar_recordings.map((row) => [row.bunny_video_id, [row.status, row.error_message]]));
  assert.deepEqual(porVideo, {
    [erro.bunny_video_id]: ["failed", RECORDINGS_TICK_MESSAGES.bunnyError],
    [envio.bunny_video_id]: ["failed", RECORDINGS_TICK_MESSAGES.bunnyUploadFailed],
    [sumiu.bunny_video_id]: ["failed", RECORDINGS_TICK_MESSAGES.bunnyMissing]
  });
  assert.equal(db.tables.webinar_sessions.filter((row) => row.kind === "replay").length, 0);
});

test("Bunny ainda codificando: so checked_at, de 2 em 2 min; a rede fora tambem so anota; depois de 24 h desiste", async () => {
  const gravacao = gravacaoRow();
  const db = escola({ gravacoes: [gravacao] });
  const bunny = bunnyFalsa();
  const inicio = Date.parse(gravacao.created_at);

  assert.deepEqual(semLogs(await rodar(db, inicio + MIN, { bunny })), resultado());
  assert.equal(db.tables.webinar_recordings[0].status, "processing");
  assert.equal(db.tables.webinar_recordings[0].checked_at, iso(inicio + MIN));

  await rodar(db, inicio + 2 * MIN, { bunny });
  assert.equal(bunny.log.length, 1, "consultada ha 1 min: espera");
  await rodar(db, inicio + 3 * MIN, { bunny });
  assert.equal(bunny.log.length, 2, "2 min depois: consulta de novo");

  const semRede = bunnyFalsa({ [VIDEO]: "erro" });
  const fora = await rodar(db, inicio + 6 * MIN, { bunny: semRede });
  assert.deepEqual(semLogs(fora), resultado());
  assert.equal(db.tables.webinar_recordings[0].status, "processing");
  assert.equal(db.tables.webinar_recordings[0].checked_at, iso(inicio + 6 * MIN));
  assert.ok(fora.logs.some((linha) => linha.startsWith("warn:") && linha.includes(gravacao.id)));

  const desistiu = await rodar(db, inicio + 24 * HOUR + MIN, { bunny });
  assert.deepEqual(semLogs(desistiu), resultado({ failed: 1 }));
  assert.equal(db.tables.webinar_recordings[0].status, "failed");
  assert.equal(db.tables.webinar_recordings[0].error_message, RECORDINGS_TICK_MESSAGES.gaveUp);
});

test("sem o cliente da Bunny (BUNNY_STREAM_API_KEY / BUNNY_STREAM_LIBRARY_ID) a gravacao fica processing e nada e consultado", async () => {
  const db = escola({ gravacoes: [gravacaoRow({ created_at: iso(HORA_MARCADA - 48 * HOUR) })] });

  assert.deepEqual(semLogs(await rodar(db, HORA_MARCADA, { bunny: null })), resultado());
  assert.equal(db.tables.webinar_recordings[0].status, "processing");
  assert.equal(db.tables.webinar_recordings[0].checked_at, null);
  assert.ok(!db.calls.some((call) => call.table === "webinar_recordings"), "nem le as gravacoes");
});

/* ------------------------------------------------------------------------------------------------
 * 3. Devolver a maquina
 * ---------------------------------------------------------------------------------------------- */

test("devolucao: uploaded volta (jibri-down) e repete depois de 2 h sem gone; recording e upload_failed nunca; ready so 30 min depois do fim", async () => {
  const id = (n) => `acacacac-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  const pedido = iso(HORA_MARCADA - 30 * MIN);
  const db = escola({
    sessoes: [
      sessaoRow(id(1), { ended_at: iso(HORA_MARCADA + HOUR), recorder_requested_at: pedido, recorder_status: "uploaded", status: "ended" }),
      sessaoRow(id(2), { recorder_requested_at: pedido, recorder_status: "recording", status: "live" }),
      sessaoRow(id(3), { ended_at: iso(HORA_MARCADA + HOUR), recorder_requested_at: pedido, recorder_status: "upload_failed", status: "ended" }),
      sessaoRow(id(4), { ended_at: iso(HORA_MARCADA + HOUR), recorder_requested_at: pedido, recorder_status: "ready", status: "ended" }),
      sessaoRow(id(5), { ended_at: iso(HORA_MARCADA + HOUR + 20 * MIN), recorder_requested_at: pedido, recorder_status: "ready", status: "ended" }),
      sessaoRow(id(6), { recorder_requested_at: pedido, recorder_status: "ready", status: "live" }),
      sessaoRow(id(7), { recorder_requested_at: pedido, recorder_status: "uploading", status: "ended" }),
      sessaoRow(id(8), { recorder_requested_at: pedido, recorder_status: "unavailable", status: "ended" })
    ]
  });
  const dispatcher = fakeRecorderDispatcher([]);
  const agora = HORA_MARCADA + HOUR + 31 * MIN;

  const result = await rodar(db, agora, { dispatcher });

  assert.equal(result.released, 2);
  assert.deepEqual(dispatcher.log.map((item) => [item.sessionId, item.step, item.force]), [
    [id(1), "jibri-down", false],
    [id(4), "jibri-down", false]
  ]);
  assert.equal(sessaoDe(db, id(1)).recorder_release_requested_at, iso(agora));
  assert.equal(sessaoDe(db, id(2)).recorder_release_requested_at, null);

  await rodar(db, agora + HOUR, { dispatcher });
  assert.equal(dispatcher.log.length, 3, "1 h depois so a ready que fez 30 min agora");
  assert.equal(dispatcher.log[2].sessionId, id(5));

  const deNovo = await rodar(db, agora + 2 * HOUR, { dispatcher });
  assert.equal(deNovo.released, 2, "2 h sem gone: pede de novo as duas primeiras");
  assert.deepEqual(dispatcher.log.slice(3).map((item) => item.sessionId), [id(1), id(4)]);
  assert.ok(!dispatcher.log.some((item) => [id(2), id(3), id(6), id(7), id(8)].includes(item.sessionId)), "nunca com o MP4 em risco nem sem maquina");
});

test("live remarcada com a maquina do preparo automatico pronta: devolvida (nao fica ligada ate a nova data); perto da hora nao; na nova data o preparo automatico pede outra", async () => {
  const db = escola();
  const dispatcher = fakeRecorderDispatcher([]);
  await rodar(db, HORA_MARCADA - 30 * MIN, { dispatcher });
  Object.assign(sessaoDe(db), { recorder_status: "ready" });

  // Perto da hora (o preparo e agora): nada volta.
  assert.equal((await rodar(db, HORA_MARCADA - 20 * MIN, { dispatcher })).released, 0);

  // A equipe remarca para o dia seguinte (rescheduleSession so troca scheduled_at): o tick devolve a maquina.
  const amanha = HORA_MARCADA + 24 * HOUR;
  sessaoDe(db).scheduled_at = iso(amanha);
  const devolvida = await rodar(db, HORA_MARCADA - 15 * MIN, { dispatcher });
  assert.equal(devolvida.released, 1);
  assert.deepEqual(dispatcher.log.at(-1), { force: false, sessionId: SESSION, step: "jibri-down" });
  assert.equal(sessaoDe(db).recorder_release_requested_at, iso(HORA_MARCADA - 15 * MIN));
  Object.assign(sessaoDe(db), { recorder_status: "gone" }); // o webhook do jibri-down

  // Na nova data, o preparo automatico pede outra maquina (uma vez).
  assert.equal((await rodar(db, amanha - 31 * MIN, { dispatcher })).prepared, 0, "antes da janela");
  const denovo = await rodar(db, amanha - 30 * MIN, { dispatcher });
  assert.equal(denovo.prepared, 1);
  assert.deepEqual(dispatcher.log.at(-1), { force: false, sessionId: SESSION, step: "jibri-up" });
  assert.deepEqual([sessaoDe(db).recorder_status, sessaoDe(db).recorder_requested_at, sessaoDe(db).recorder_release_requested_at], ["preparing", iso(amanha - 30 * MIN), null]);
  assert.equal((await rodar(db, amanha - 29 * MIN, { dispatcher })).prepared, 0, "uma vez");
});

test("a maquina que a equipe desligou perto da hora (gone dentro da janela) nao volta sozinha; preparing nunca e devolvido pela remarcacao", async () => {
  const desligada = sessaoRow(SESSION, { recorder_release_requested_at: iso(HORA_MARCADA - 20 * MIN), recorder_requested_at: iso(HORA_MARCADA - 30 * MIN), recorder_status: "gone" });
  const preparando = sessaoRow("acacacac-0000-4000-8000-000000000012", { recorder_requested_at: iso(HORA_MARCADA - 30 * MIN), recorder_status: "preparing", scheduled_at: iso(HORA_MARCADA + 24 * HOUR) });
  const db = escola({ sessoes: [desligada, preparando] });
  const dispatcher = fakeRecorderDispatcher([]);
  const result = await rodar(db, HORA_MARCADA - 10 * MIN, { dispatcher });
  assert.deepEqual([result.prepared, result.released], [0, 0]);
  assert.equal(dispatcher.log.length, 0);
});

/* ------------------------------------------------------------------------------------------------
 * 4. Aviso de 6 h
 * ---------------------------------------------------------------------------------------------- */

test("aviso de 6 h: uma notificacao no sino do Apresentador e dos co-apresentadores validos, uma vez por pedido de maquina", async () => {
  const pedido = HORA_MARCADA - 30 * MIN;
  const db = escola({
    presenters: [
      { can_moderate_room: true, created_at: iso(pedido), role: "co_host", user_id: CO_HOST, valid_until: null, webinar_id: WEBINAR },
      { can_moderate_room: true, created_at: iso(pedido), role: "team", user_id: EQUIPE, valid_until: null, webinar_id: WEBINAR },
      { can_moderate_room: false, created_at: iso(pedido), role: "co_host", user_id: CO_HOST_VENCIDO, valid_until: iso(pedido), webinar_id: WEBINAR }
    ],
    sessoes: [sessaoRow(SESSION, { recorder_requested_at: iso(pedido), recorder_status: "recording", status: "live" })]
  });

  assert.equal((await rodar(db, pedido + 6 * HOUR - MIN)).alerted, 0, "5 h 59 min: ainda nao");

  const agora = pedido + 6 * HOUR + MIN;
  const result = await rodar(db, agora);

  assert.deepEqual(semLogs(result), resultado({ alerted: 1 }));
  const sino = db.tables.notifications;
  assert.deepEqual(sino.map((linha) => linha.user_id).sort(), [HOST, CO_HOST].sort());
  for (const linha of sino) {
    assert.equal(linha.kind, "webinar");
    assert.equal(linha.title, WEBINAR_COPY.sino.tituloGravadorEsquecido);
    assert.equal(linha.body, WEBINAR_COPY.sino.gravadorEsquecido("Live de agentes"));
    assert.equal(linha.href, `/admin/comunicacao/webinarios/${WEBINAR}/sala`);
    assert.equal(linha.dedupe_key, `webinar:${SESSION}:recorder_6h:${iso(pedido)}`);
    assert.deepEqual(linha.payload, { kind: "recorder_6h", sessionId: SESSION, webinarId: WEBINAR });
    assert.ok(Date.parse(linha.expires_at) > agora);
  }
  assert.equal(sessaoDe(db).recorder_alerted_at, iso(agora));

  assert.equal((await rodar(db, agora + HOUR)).alerted, 0, "uma vez");
  assert.equal(db.tables.notifications.length, 2);

  // Outra maquina pedida depois (a equipe preparou de novo): o aviso vale para o pedido novo.
  const novoPedido = agora + 2 * HOUR;
  Object.assign(sessaoDe(db), { recorder_requested_at: iso(novoPedido), recorder_status: "preparing" });
  assert.equal((await rodar(db, novoPedido + 6 * HOUR + MIN)).alerted, 1);
  assert.equal(db.tables.notifications.length, 4);

  // Maquina devolvida (gone) ou nunca pedida: nada.
  Object.assign(sessaoDe(db), { recorder_alerted_at: null, recorder_status: "gone" });
  assert.equal((await rodar(db, novoPedido + 9 * HOUR)).alerted, 0);
});

test("aviso de 6 h sem Apresentador nem co-apresentador: vai para quem criou o webinario", async () => {
  const pedido = HORA_MARCADA - 30 * MIN;
  const db = escola({
    sessoes: [sessaoRow(SESSION, { recorder_requested_at: iso(pedido), recorder_status: "upload_failed", status: "ended" })],
    webinars: [webinarRow(WEBINAR, { host_user_id: null })]
  });

  await rodar(db, pedido + 7 * HOUR);

  assert.deepEqual(db.tables.notifications.map((linha) => linha.user_id), [AUTOR]);
});

/* ------------------------------------------------------------------------------------------------
 * 5. Retencao
 * ---------------------------------------------------------------------------------------------- */

test("retencao: no minuto da hora, apaga na Bunny (404 conta como apagado) e marca purged_at; com a Bunny fora, tenta na hora seguinte", async () => {
  const vencida = gravacaoRow({ purge_due_at: iso(HORA_MARCADA - HOUR), status: "ready" });
  const sumida = gravacaoRow({ bunny_video_id: "22222222-aaaa-bbbb-cccc-000000000001", purge_due_at: iso(HORA_MARCADA - HOUR), status: "ready" });
  const doPlayer = gravacaoRow({ bunny_library_id: null, bunny_video_id: null, embed_url: "https://iframe.mediadelivery.net/embed/77/33333333-aaaa-bbbb-cccc-000000000001", purge_due_at: iso(HORA_MARCADA - HOUR), status: "ready" });
  const semVideo = gravacaoRow({ bunny_library_id: null, bunny_video_id: null, purge_due_at: iso(HORA_MARCADA - HOUR), status: "ready" });
  const falha = gravacaoRow({ bunny_video_id: "44444444-aaaa-bbbb-cccc-000000000001", purge_due_at: iso(HORA_MARCADA - HOUR), status: "ready" });
  const futura = gravacaoRow({ bunny_video_id: "55555555-aaaa-bbbb-cccc-000000000001", purge_due_at: "2026-11-07T00:00:00.000Z", status: "ready" });
  const db = escola({ gravacoes: [vencida, sumida, doPlayer, semVideo, falha, futura] });
  const bunny = bunnyFalsa({}, { apagar: { [falha.bunny_video_id]: "erro", [sumida.bunny_video_id]: "missing" } });
  const minuto = (m) => Date.parse(`2026-11-06T10:${String(m).padStart(2, "0")}:00.000Z`);

  assert.equal((await rodar(db, minuto(RECORDINGS_PURGE_MINUTE - 1), { bunny })).purged, 0, "fora do minuto da retencao");
  assert.equal(bunny.log.filter(([metodo]) => metodo === "DELETE").length, 0);

  const result = await rodar(db, minuto(RECORDINGS_PURGE_MINUTE), { bunny });

  assert.equal(result.purged, 4);
  assert.deepEqual(
    bunny.log.filter(([metodo]) => metodo === "DELETE"),
    [
      ["DELETE", "42", VIDEO],
      ["DELETE", "42", sumida.bunny_video_id],
      ["DELETE", "77", "33333333-aaaa-bbbb-cccc-000000000001"],
      ["DELETE", "42", falha.bunny_video_id]
    ],
    "a gravacao sem video nao chama a Bunny"
  );
  const apagada = (row) => db.tables.webinar_recordings.find((item) => item.id === row.id).purged_at;
  assert.equal(apagada(vencida), iso(minuto(RECORDINGS_PURGE_MINUTE)));
  assert.ok(apagada(sumida) && apagada(doPlayer) && apagada(semVideo));
  assert.equal(apagada(falha), null, "a Bunny fora: tenta de novo");
  assert.equal(apagada(futura), null);
  assert.ok(result.logs.some((linha) => linha.startsWith("warn:") && linha.includes(falha.id)));
});

test("retencao: so o video do nosso gravador (source jibri) e apagado na Bunny; o enviado ou ligado pela equipe (pode ser uma aula) nunca", async () => {
  const doGravador = gravacaoRow({ purge_due_at: iso(HORA_MARCADA - HOUR), source: "jibri", status: "ready" });
  const daEquipe = gravacaoRow({ bunny_video_id: "66666666-aaaa-bbbb-cccc-000000000001", purge_due_at: iso(HORA_MARCADA - HOUR), source: "upload", status: "ready" });
  const ligada = gravacaoRow({ bunny_video_id: "77777777-aaaa-bbbb-cccc-000000000001", purge_due_at: iso(HORA_MARCADA - HOUR), source: "bunny", status: "ready" });
  const db = escola({ gravacoes: [daEquipe, ligada, doGravador] });
  const bunny = bunnyFalsa();
  const result = await rodar(db, Date.parse(`2026-11-06T10:${RECORDINGS_PURGE_MINUTE}:00.000Z`), { bunny });

  assert.equal(result.purged, 1);
  assert.deepEqual(bunny.log.filter(([metodo]) => metodo === "DELETE"), [["DELETE", "42", VIDEO]], "so o DELETE do video do gravador");
  const linha = (row) => db.tables.webinar_recordings.find((item) => item.id === row.id);
  assert.ok(linha(doGravador).purged_at);
  assert.equal(linha(daEquipe).purged_at, null, "o video da equipe fica na Bunny");
  assert.equal(linha(ligada).purged_at, null);
});

/* ------------------------------------------------------------------------------------------------
 * Migracao pendente, frases, o job e o cliente da Bunny
 * ---------------------------------------------------------------------------------------------- */

test("banco sem a migracao mais nova (WEBINARS_MIGRATION: a 202610300001 pela ordem dos arquivos; a fase 4 exige tambem a 0008): zeros, pendingMigration e o log da migracao", async () => {
  const comAdaptador = escola();
  comAdaptador.falhar("webinar_sessions", "select", { code: "42703", message: "column webinar_sessions.recorder_status does not exist" });
  const result = await rodar(comAdaptador, HORA_MARCADA - 10 * MIN, { bunny: bunnyFalsa(), dispatcher: fakeRecorderDispatcher([]) });
  assert.deepEqual(semLogs(result), resultado({ pendingMigration: true }));
  assert.ok(result.logs.some((linha) => linha.startsWith("info:") && linha.includes("migracao 202610300001 pendente")));

  const soAviso = escola();
  soAviso.falhar("webinar_sessions", "select", { code: "42703", message: "column webinar_sessions.recorder_alerted_at does not exist" });
  assert.equal((await rodar(soAviso, HORA_MARCADA)).pendingMigration, true);

  const outroErro = escola();
  outroErro.falhar("webinar_sessions", "select", { code: "57014", message: "canceling statement due to statement timeout" });
  await assert.rejects(() => runRecordingsTick({ db: outroErro, now: em(HORA_MARCADA) }), /statement timeout/);
});

test("o tick abortado nao faz nada", async () => {
  const db = escola();
  const controller = new AbortController();
  controller.abort();
  const result = await rodar(db, HORA_MARCADA - 10 * MIN, { dispatcher: fakeRecorderDispatcher([]), signal: controller.signal });
  assert.deepEqual(semLogs(result), resultado());
  assert.equal(db.calls.length, 0);
});

test("as frases do job passam pela lista propria dos webinarios", () => {
  const textos = [...Object.values(RECORDINGS_TICK_MESSAGES), WEBINAR_COPY.sino.tituloGravadorEsquecido, WEBINAR_COPY.sino.gravadorEsquecido("Aula de IA")];
  for (const texto of textos) {
    const lower = texto.toLocaleLowerCase("pt-BR");
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!lower.includes(palavra), `"${texto}" usa "${palavra}"`);
    }
  }
  assert.match(RECORDINGS_TICK_MESSAGES.gaveUp, /24 horas/);
});

test("o job: nome, registro depois dos lembretes e as contagens em job_runs quando trabalhou (adaptador falso pelo ambiente)", async () => {
  assert.equal(WEBINAR_RECORDINGS_JOB_NAME, "webinar-recordings");
  assert.equal(webinarRecordingsJob.name, WEBINAR_RECORDINGS_JOB_NAME);
  assert.match(webinarRecordingsJob.name, /^[a-z0-9][a-z0-9-]{0,119}$/);
  const registry = readFileSync(new URL("../src/server/jobs/registry.ts", import.meta.url), "utf8");
  assert.match(registry, /\[emailOutboxJob, communicationsJob, webinarSessionsJob, webinarSimulationSummariesJob, webinarRemindersJob, webinarRecordingsJob, webinarOfferConversionsJob, communicationMediaJob\]/);
  assert.match(registry, /- `webinar-recordings` \(/, "a linha no comentario dos jobs registrados");

  const env = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "test", WEBINAR_RECORDER_DISPATCH: "fake" });
  delete process.env.BUNNY_STREAM_API_KEY;
  try {
    const db = escola();
    const contexto = { runId: "run", signal: new AbortController().signal, supabase: db, tickRunId: "tick", tickStartedAt: em(HORA_MARCADA - 30 * MIN) };
    const [, logs] = await quieto(() => webinarRecordingsJob.run(contexto));
    assert.ok(fakeRecorderDispatches().some((item) => item.sessionId === SESSION && item.step === "jibri-up"));
    assert.equal(sessaoDe(db).recorder_status, "preparing");
    assert.deepEqual(db.tables.job_runs[0].metadata, {
      tick_run_id: "tick",
      webinars_recordings: { ...{ alerted: 0, failed: 0, prepared: 1, purged: 0, ready: 0, released: 0, replays: 0 }, job_ms: db.tables.job_runs[0].metadata.webinars_recordings.job_ms }
    });
    assert.ok(logs.some((linha) => linha.includes("1 gravador(es) pedido(s)")));

    // Sem trabalho: nada em job_runs.
    const parado = escola({ sessoes: [] });
    await quieto(() => webinarRecordingsJob.run({ ...contexto, supabase: parado }));
    assert.equal(parado.tables.job_runs[0].metadata, null);
  } finally {
    for (const key of ["NODE_ENV", "WEBINAR_RECORDER_DISPATCH", "BUNNY_STREAM_API_KEY"]) {
      if (env[key] === undefined) delete process.env[key];
      else process.env[key] = env[key];
    }
  }
});

test("o cliente da Bunny: so com chave e biblioteca validas; GET e DELETE no endereco da biblioteca com AccessKey; 404 e as falhas", async () => {
  assert.equal(bunnyStreamFrom({}), null);
  assert.equal(bunnyStreamFrom({ BUNNY_STREAM_API_KEY: "chave-da-biblioteca-0001", BUNNY_STREAM_LIBRARY_ID: "abc" }), null, "biblioteca e numero");
  assert.equal(bunnyStreamFrom({ BUNNY_STREAM_API_KEY: "curta", BUNNY_STREAM_LIBRARY_ID: "42" }), null);
  assert.equal(bunnyStreamFrom({ BUNNY_STREAM_API_KEY: " chave-da-biblioteca-0001 ", BUNNY_STREAM_LIBRARY_ID: " 42 " }).libraryId, "42");

  const pedidos = [];
  const respostas = [];
  const fetchFalso = async (url, init) => {
    pedidos.push({ headers: init.headers, method: init.method, signal: init.signal, url });
    const next = respostas.shift();
    if (next instanceof Error) throw next;
    return { json: async () => next.body, ok: next.status >= 200 && next.status < 300, status: next.status };
  };
  const client = bunnyStreamClient({ apiKey: "chave-da-biblioteca-0001", fetchImpl: fetchFalso, libraryId: "42" });

  respostas.push({ body: { guid: VIDEO, length: 3700.4, status: 4 }, status: 200 });
  assert.deepEqual(await client.getVideo("42", VIDEO), { lengthSeconds: 3700, status: 4 });
  assert.equal(pedidos[0].url, `https://video.bunnycdn.com/library/42/videos/${VIDEO}`);
  assert.equal(pedidos[0].method, "GET");
  assert.equal(pedidos[0].headers.AccessKey, "chave-da-biblioteca-0001");
  assert.ok(pedidos[0].signal instanceof AbortSignal, "teto de tempo em todo pedido");

  respostas.push({ body: { length: 0, status: 3 }, status: 200 });
  assert.deepEqual(await client.getVideo("42", VIDEO), { lengthSeconds: null, status: 3 });
  respostas.push({ body: {}, status: 404 });
  assert.equal(await client.getVideo("42", VIDEO), null);
  respostas.push({ body: {}, status: 500 });
  await assert.rejects(() => client.getVideo("42", VIDEO), (error) => error instanceof BunnyStreamError && error.status === 500);
  respostas.push({ body: { title: "sem status" }, status: 200 });
  await assert.rejects(() => client.getVideo("42", VIDEO), BunnyStreamError);
  respostas.push(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
  await assert.rejects(() => client.getVideo("42", VIDEO), /sem resposta em tempo/);

  respostas.push({ body: { success: true }, status: 200 });
  assert.equal(await client.deleteVideo("42", VIDEO), "deleted");
  assert.equal(pedidos.at(-1).method, "DELETE");
  respostas.push({ body: {}, status: 404 });
  assert.equal(await client.deleteVideo("42", VIDEO), "missing");
  respostas.push({ body: {}, status: 401 });
  await assert.rejects(() => client.deleteVideo("42", VIDEO), BunnyStreamError);

  const antes = pedidos.length;
  await assert.rejects(() => client.getVideo("42/../1", VIDEO), BunnyStreamError);
  await assert.rejects(() => client.deleteVideo("42", "../../videos"), BunnyStreamError);
  assert.equal(pedidos.length, antes, "id invalido nem sai para a rede");
});
