import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { actionStubs } from "./support/admin-action-stubs.mjs";

// As Server Actions da fase 2b (docs/30 §2.2 "Roteiro de chat" e "Simulação", §2.4, §5.2, §6.6 D6, §8.3, §8.5,
// §8.6), sem banco: um banco em memoria que entende as consultas de chat-store.ts e store.ts (filtros, or, not,
// range, upsert por chave, chaves unicas da migracao 202610290001 como 23505) e as RPCs como dubles. A permissao
// vem de um duble que recusa quando o teste pede; "next/cache" so anota. Aqui: 403 sem permissao; o CSV
// (acrescentar e substituir, erros por linha); a transcricao que resolve as frases (pronta / nao achada); "Soltar
// agora" uma vez por sessao; a moderacao (liberar, fixar uma por sessao, apagar, promover so com o aceite); a frase
// da Simulacao conferida no servidor; abrir e encerrar pela mao; enquetes (modelos, abrir sem duplicar, encerrar e
// compartilhar); perguntas; a mensagem da equipe no relogio do servidor; o replay unico; e "Remover minhas
// mensagens" a pedido. O mesmo contra o banco local esta em tests/integration/webinarios-roteiro-e-console.test.mjs.

process.env.NEXT_PUBLIC_SITE_URL = "https://membros.exemplo.test";

const estado = (globalThis.__roteiroAcoes ??= { negar: false, revalidados: [] });
const HOST = "00000000-0000-4000-8000-000000000001";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/server/auth/permissions") {
      const source = `
        export async function requireRole() {
          const estado = globalThis.__roteiroAcoes;
          if (estado.negar) {
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
          const metadata = user.user_metadata ?? {};
          const rawName = typeof metadata.full_name === "string" ? metadata.full_name : "";
          const fullName = rawName.trim() || (user.email?.split("@")[0] ?? "Aluno");
          return { fullName, name: fullName.split(/\\s+/)[0] || "Aluno" };
        }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    // db.ts dos webinarios importa o cliente por caminho relativo (nao pelo alias que admin-action-stubs troca).
    if (specifier.endsWith("/db/supabase/client")) {
      const source = `
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    if (specifier === "next/cache") {
      const source = `
        export function revalidatePath(path) { globalThis.__roteiroAcoes.revalidados.push(path); }
        export function revalidateTag(tag) { globalThis.__roteiroAcoes.revalidados.push(tag); }
        export function updateTag(tag) { globalThis.__roteiroAcoes.revalidados.push(tag); }
        export function unstable_cache(fn) { return fn; }`;
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
    }

    return nextResolve(specifier, context);
  }
});

actionStubs.role = { role: "owner", user: { email: "produtor.teste@bunker707.test", id: HOST, user_metadata: { full_name: "Produtor de Teste" } } };

const scriptActions = await import("../src/server/webinars/script-actions.ts");
const roomActions = await import("../src/server/webinars/room-actions.ts");
const consoleModel = await import("../src/server/webinars/console-model.ts");
const { CHAT_MESSAGES } = await import("../src/server/webinars/chat-schemas.ts");

/* ------------------------------------------------------------------------------------------------
 * Banco em memoria
 * ---------------------------------------------------------------------------------------------- */

let relogio = Date.now() - 3_600_000;
const agora = () => new Date((relogio += 1_000)).toISOString();

const DEFAULTS = {
  webinar_chat_messages: { approved: true, approved_at: null, approved_by: null, author_user_id: null, deleted_at: null, deleted_by: null, deleted_reason: null, kind: "message", master: false, pinned_at: null, reply_to_id: null, script_item_id: null },
  webinar_chat_script_items: { created_by: null, generated_by_ai: false, kind: "message", offset_ms: null, phrase: null, phrase_delay_ms: 0, position: 0, resolved_offset_ms: null, resolved_transcript_id: null, status: "draft" },
  webinar_poll_options: { position: 0 },
  webinar_polls: { anonymous: false, closed_at: null, open_offset_ms: null, opened_at: null, position: 0, results_shared_at: null, session_id: null, status: "draft", template_poll_id: null },
  webinar_questions: { anonymous: false, answer_text: null, answered_at: null, answered_by: null, answered_live: false, deleted_at: null, deleted_reason: null, message_id: null, status: "open", upvotes: 0 },
  webinar_sessions: { chat_mode: "open", chat_slow_mode_seconds: null, ended_at: null, late_join_minutes: null, pinned_message_id: null, presence_curve: null, recording_anchor_at: null, recording_id: null, script_fired_at: null, show_live_badge: false, simulation_ack_text: null, simulation_decided_at: null, simulation_decided_by: null, source_session_id: null, started_at: null, status: "scheduled" }
};

/** As chaves unicas da 202610290001 (e a do replay da 0028) que o teste precisa sentir como 23505. */
const UNIQUE = {
  webinar_chat_messages: (row, rows) => row.script_item_id != null && rows.some((other) => other.session_id === row.session_id && other.script_item_id === row.script_item_id),
  webinar_poll_answers: (row, rows) => rows.some((other) => other.poll_id === row.poll_id && other.user_id === row.user_id),
  webinar_sessions: (row, rows) => row.kind === "replay" && rows.some((other) => other.webinar_id === row.webinar_id && other.kind === "replay")
};

function parseOr(expression) {
  return String(expression)
    .split(",")
    .map((part) => {
      const [column, op, ...rest] = part.split(".");
      const raw = rest.join(".");
      const value = raw === "null" ? null : raw === "true" ? true : raw === "false" ? false : raw;
      return { column, op, value };
    });
}

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
        if (value === "in") {
          const list = String(extra).replace(/^\(|\)$/g, "").split(",").filter(Boolean);
          return !list.includes(row[column]);
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
      case "like":
        return String(row[column] ?? "").startsWith(String(value).replace(/%$/, ""));
      case "or":
        return parseOr(column).some(({ column: col, op, value: val }) => (op === "eq" ? row[col] === val : op === "is" ? (val === null ? row[col] == null : row[col] === val) : true));
      default:
        return true;
    }
  });
}

function bancoEmMemoria(seed = {}, rpc = {}) {
  const tables = {
    admin_audit_log: [],
    admin_roles: [{ user_id: HOST }],
    notifications: [],
    profiles: [],
    student_events: [],
    webinar_attendance: [],
    webinar_chat_consents: [],
    webinar_chat_messages: [],
    webinar_chat_script_items: [],
    webinar_poll_answers: [],
    webinar_poll_options: [],
    webinar_polls: [],
    webinar_presence_samples: [],
    webinar_presenters: [],
    webinar_questions: [],
    webinar_recording_transcripts: [],
    webinar_recordings: [],
    webinar_registrations: [],
    webinar_sessions: [],
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
      return { data: query.single ? out[0] : structuredClone(out), error: null };
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
    if (query.head) {
      return { count: found.length, data: null, error: null };
    }
    return { count: found.length, data: query.single ? (structuredClone(result[0]) ?? null) : structuredClone(result), error: null };
  }

  function chain(query) {
    const self = {
      contains: (column, value) => (query.filters.push(["contains", column, value]), self),
      delete: () => ((query.op = "delete"), self),
      eq: (column, value) => (query.filters.push(["eq", column, value]), self),
      gt: (column, value) => (query.filters.push(["gt", column, value]), self),
      gte: (column, value) => (query.filters.push(["gte", column, value]), self),
      in: (column, value) => (query.filters.push(["in", column, value]), self),
      insert: (payload) => ((query.op = "insert"), (query.payload = payload), self),
      is: (column, value) => (query.filters.push(["is", column, value]), self),
      like: (column, value) => (query.filters.push(["like", column, value]), self),
      limit: (value) => ((query.limit = value), self),
      lt: (column, value) => (query.filters.push(["lt", column, value]), self),
      lte: (column, value) => (query.filters.push(["lte", column, value]), self),
      maybeSingle: () => ((query.single = true), self),
      neq: (column, value) => (query.filters.push(["neq", column, value]), self),
      not: (column, operator, value) => (query.filters.push(["not", column, operator, value]), self),
      or: (expression) => (query.filters.push(["or", expression]), self),
      order: (column, options = {}) => (query.order.push([column, options.ascending !== false]), self),
      range: (from, to) => ((query.range = [from, to]), self),
      select: (_columns, options = {}) => ((query.head = Boolean(options.head)), self),
      single: () => ((query.single = true), self),
      then: (resolve, reject) => Promise.resolve(run(query)).then(resolve, reject),
      update: (payload) => ((query.op = "update"), (query.payload = payload), self),
      upsert: (payload, options) => ((query.op = "upsert"), (query.payload = payload), (query.options = options), self)
    };
    return self;
  }

  return {
    calls,
    from: (table) => chain({ filters: [], head: false, limit: null, op: "select", options: undefined, order: [], payload: undefined, range: null, single: false, table }),
    async rpc(name, args) {
      rpcs.push({ args, name });
      const handler = rpc[name];
      return handler ? handler(args, tables) : { data: null, error: null };
    },
    rpcs,
    tables
  };
}

function usar(db) {
  actionStubs.db = db;
  estado.negar = false;
  estado.revalidados.length = 0;
  return db;
}

const audits = (db, action) => db.tables.admin_audit_log.filter((row) => row.action === action);

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.data;
}

/* ------------------------------------------------------------------------------------------------
 * Cenario
 * ---------------------------------------------------------------------------------------------- */

const WEBINAR = "aaaaaaaa-1111-4111-8111-111111111111";
const RECORDING = "aaaaaaaa-1111-4111-8111-222222222222";
const SESSAO_NO_AR = "bbbbbbbb-2222-4222-8222-111111111111";
const SESSAO_MARCADA = "bbbbbbbb-2222-4222-8222-222222222222";
const SESSAO_ENCERRADA = "bbbbbbbb-2222-4222-8222-333333333333";
const ALUNA = "cccccccc-3333-4333-8333-333333333333";
const ALUNO = "dddddddd-4444-4444-8444-444444444444";
const MIN = 60_000;

function cenario(extra = {}) {
  const now = Date.now();
  const noAr = new Date(now - 5 * MIN).toISOString();
  return {
    webinar_chat_consents: [{ consent_version: 1, consented_at: agora(), display_mode: "first_name_initial", nickname: null, revoked_at: null, user_id: ALUNA }],
    webinar_recordings: [{ anchor_offset_ms: 0, duration_seconds: 3600, embed_url: "https://iframe.mediadelivery.net/embed/1/abc", id: RECORDING, provider: "bunny", session_id: null, source: "bunny", status: "ready", webinar_id: WEBINAR }],
    webinar_sessions: [
      { ...DEFAULTS.webinar_sessions, id: SESSAO_NO_AR, kind: "simulated", recording_id: RECORDING, scheduled_at: noAr, started_at: noAr, status: "live", webinar_id: WEBINAR },
      { ...DEFAULTS.webinar_sessions, id: SESSAO_MARCADA, kind: "simulated", recording_id: RECORDING, scheduled_at: new Date(now + 24 * 60 * MIN).toISOString(), status: "scheduled", webinar_id: WEBINAR },
      { ...DEFAULTS.webinar_sessions, ended_at: new Date(now - 60 * MIN).toISOString(), id: SESSAO_ENCERRADA, kind: "simulated", recording_id: RECORDING, scheduled_at: new Date(now - 120 * MIN).toISOString(), started_at: new Date(now - 120 * MIN).toISOString(), status: "ended", webinar_id: WEBINAR }
    ],
    webinars: [
      {
        access_mode: "everyone",
        audience: { kind: "everyone" },
        cancel_reason: null,
        cancelled_at: null,
        created_at: agora(),
        created_by: HOST,
        deleted_at: null,
        duration_minutes: 60,
        host_user_id: HOST,
        id: WEBINAR,
        kind: "simulated",
        published_at: agora(),
        registration_required: true,
        reminders: { email: false, h1: true, h24: true },
        room_settings: { chatMode: "open" },
        slug: "aula-de-ia",
        status: "published",
        title: "Aula de IA",
        updated_at: agora()
      }
    ],
    ...extra
  };
}

const VTT = ["WEBVTT", "", "00:00:30.000 --> 00:00:35.000", "Agora vamos começar a aula de hoje", "", "00:00:36.000 --> 00:00:40.000", "Olá pessoal, sejam bem-vindos", ""].join("\n");

function scriptItem(extra = {}) {
  return { ...DEFAULTS.webinar_chat_script_items, body: "Boa noite!", created_at: agora(), id: randomUUID(), persona_name: "Duda", persona_role: "student", trigger_kind: "at_offset", updated_at: agora(), webinar_id: WEBINAR, ...extra };
}

function message(extra = {}) {
  return { ...DEFAULTS.webinar_chat_messages, body: "oi", created_at: agora(), display_name: "Ana M.", id: randomUUID(), offset_ms: 1000, role: "student", session_id: SESSAO_NO_AR, source: "audience", webinar_id: WEBINAR, ...extra };
}

/* ------------------------------------------------------------------------------------------------
 * Permissao
 * ---------------------------------------------------------------------------------------------- */

test("sem permissão: 403 em toda ação do roteiro e do console, sem tocar no banco", async () => {
  const db = usar(bancoEmMemoria(cenario()));
  estado.negar = true;
  const chamadas = [
    () => scriptActions.saveScriptItems({ items: [], webinarId: WEBINAR }),
    () => scriptActions.importScriptCsv({ csv: "Tempo;Nome;Papel;Mensagem\n0:10;Duda;Aluno;oi", webinarId: WEBINAR }),
    () => scriptActions.exportScriptCsv({ webinarId: WEBINAR }),
    () => scriptActions.exportSessionChatCsv({ sessionId: SESSAO_ENCERRADA }),
    () => scriptActions.saveTranscript({ format: "vtt", text: VTT, webinarId: WEBINAR }),
    () => scriptActions.resolveScriptPhrases({ webinarId: WEBINAR }),
    () => scriptActions.fireScriptItem({ itemId: randomUUID(), sessionId: SESSAO_NO_AR }),
    () => roomActions.openSessionNow({ sessionId: SESSAO_MARCADA }),
    () => roomActions.endSessionNow({ sessionId: SESSAO_NO_AR }),
    () => roomActions.sendTeamMessage({ body: "oi", sessionId: SESSAO_NO_AR }),
    () => roomActions.moderateMessage({ action: "approve", messageId: randomUUID() }),
    () => roomActions.setSessionChatMode({ chatMode: "open", sessionId: SESSAO_NO_AR, slowModeSeconds: null }),
    () => roomActions.savePolls({ polls: [], webinarId: WEBINAR }),
    () => roomActions.launchPoll({ pollId: randomUUID(), sessionId: SESSAO_NO_AR }),
    () => roomActions.closePoll({ pollId: randomUUID(), sessionId: SESSAO_NO_AR }),
    () => roomActions.answerQuestion({ answerText: "x", questionId: randomUUID() }),
    () => roomActions.setQuestionStatus({ questionId: randomUUID(), status: "dismissed" }),
    () => roomActions.saveSimulation({ sessionId: SESSAO_MARCADA, showLiveBadge: false }),
    () => roomActions.createReplaySession({ webinarId: WEBINAR }),
    () => roomActions.cancelReplaySession({ webinarId: WEBINAR }),
    () => roomActions.removeStudentMessages({ reason: "pediu", userId: ALUNA })
  ];
  for (const chamada of chamadas) {
    const result = await chamada();
    assert.deepEqual([result.ok, result.status], [false, 403]);
  }
  assert.equal(db.calls.length, 0);
  estado.negar = false;
});

/* ------------------------------------------------------------------------------------------------
 * Roteiro
 * ---------------------------------------------------------------------------------------------- */

test("importar CSV: acrescenta no fim com as posicoes, devolve os erros por linha; substituir troca tudo; a auditoria so leva contagens", async () => {
  const existente = scriptItem({ offset_ms: 5_000, position: 0, status: "ready" });
  const db = usar(bancoEmMemoria(cenario({ webinar_chat_script_items: [existente] })));
  const csv = ["Tempo;Nome;Papel;Mensagem", "00:30;Duda;Aluno;Boa noite!", "1:00;Equipe;Equipe;Bem-vindos", "0:45;Rafa;Chefe;eita", ";Sem tempo;Aluno;oi"].join("\n");

  const acrescentado = ok(await scriptActions.importScriptCsv({ csv, webinarId: WEBINAR }));
  assert.equal(acrescentado.imported, 2);
  assert.deepEqual(
    acrescentado.errors.map((error) => error.line),
    [4, 5]
  );
  assert.deepEqual(
    acrescentado.items.map((item) => [item.position, item.offsetMs, item.personaRole, item.status]),
    [
      [0, 5_000, "student", "ready"],
      [1, 30_000, "student", "ready"],
      [2, 60_000, "team", "ready"]
    ]
  );
  assert.equal(acrescentado.items[0].id, existente.id, "o item que ja existia continua com o id");
  assert.deepEqual(acrescentado.summary, { disabled: 0, manual: 0, ready: 3, unresolved: 0 });

  const substituido = ok(await scriptActions.importScriptCsv({ csv, replace: true, webinarId: WEBINAR }));
  assert.deepEqual(
    substituido.items.map((item) => [item.position, item.body]),
    [
      [0, "Boa noite!"],
      [1, "Bem-vindos"]
    ]
  );
  assert.equal(db.tables.webinar_chat_script_items.length, 2);

  const [auditoria] = audits(db, "webinar.script_imported");
  assert.deepEqual(auditoria.metadata, { errors: 2, imported: 2, items: 3, replace: false, truncated: false });
  assert.doesNotMatch(JSON.stringify(db.tables.admin_audit_log), /Boa noite|Bem-vindos/, "nunca o texto das mensagens");
  assert.ok(estado.revalidados.includes(`/admin/comunicacao/webinarios/${WEBINAR}`));
  assert.ok(estado.revalidados.includes(`/admin/comunicacao/webinarios/${WEBINAR}/sala`));

  const nada = ok(await scriptActions.importScriptCsv({ csv: "Tempo;Nome;Papel;Mensagem\nabc;Duda;Aluno;oi", webinarId: WEBINAR }));
  assert.equal(nada.imported, 0);
  assert.equal(nada.items.length, 2, "nenhuma linha valida: o roteiro fica como estava");

  const exportado = ok(await scriptActions.exportScriptCsv({ webinarId: WEBINAR }));
  assert.ok(exportado.csv.startsWith("﻿Tempo;Nome;Papel;Mensagem\r\n"));
  assert.match(exportado.csv, /00:30;Duda;Aluno;Boa noite!/);
  assert.equal(exportado.rows, 2);
  assert.match(exportado.fileName, /^roteiro-aula-de-ia-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("salvar o roteiro: a situacao e do servidor (pronta com minuto, frase achada ou nao, manual pronta, desligada fica); id de outro webinario vira item novo", async () => {
  const transcript = { checksum: "x".repeat(64), created_at: agora(), created_by: HOST, cues: [{ endSeconds: 35, startSeconds: 30, text: "Agora vamos começar a aula de hoje" }, { endSeconds: 40, startSeconds: 36, text: "Olá pessoal, sejam bem-vindos" }], id: randomUUID(), language: "pt-BR", recording_id: RECORDING, source_format: "vtt", updated_at: agora() };
  const db = usar(bancoEmMemoria(cenario({ webinar_recording_transcripts: [transcript] })));
  const base = { body: "Mensagem", kind: "message", offsetMs: null, personaName: "Duda", personaRole: "student", phrase: null, phraseDelayMs: 0, status: "draft" };

  const salvo = ok(
    await scriptActions.saveScriptItems({
      items: [
        { ...base, offsetMs: 10_000, triggerKind: "at_offset" },
        { ...base, phrase: "vamos começar", phraseDelayMs: 2_000, triggerKind: "on_phrase" },
        { ...base, phrase: "frase que ninguém disse aqui", triggerKind: "on_phrase" },
        { ...base, triggerKind: "manual" },
        { ...base, id: randomUUID(), offsetMs: 20_000, status: "disabled", triggerKind: "at_offset" }
      ],
      webinarId: WEBINAR
    })
  );
  assert.deepEqual(
    salvo.items.map((item) => [item.position, item.triggerKind, item.status, item.resolvedOffsetMs]),
    [
      [0, "at_offset", "ready", null],
      [1, "on_phrase", "ready", 32_000],
      [2, "on_phrase", "unresolved", null],
      [3, "manual", "ready", null],
      [4, "at_offset", "disabled", null]
    ]
  );
  assert.equal(salvo.items[1].resolvedTranscriptId, transcript.id);
  assert.deepEqual(salvo.summary, { disabled: 1, manual: 1, ready: 2, unresolved: 1 });
  assert.equal(db.tables.webinar_chat_script_items.length, 5, "o id desconhecido nao virou upsert: entrou como novo");

  // Salvar de novo com um item a menos apaga o que saiu e mantem os ids dos que ficaram.
  const deNovo = ok(await scriptActions.saveScriptItems({ items: salvo.items.slice(0, 2).map((item) => ({ ...base, id: item.id, offsetMs: item.offsetMs, phrase: item.phrase, phraseDelayMs: item.phraseDelayMs, triggerKind: item.triggerKind })), webinarId: WEBINAR }));
  assert.deepEqual(
    deNovo.items.map((item) => item.id),
    salvo.items.slice(0, 2).map((item) => item.id)
  );
  assert.equal(db.tables.webinar_chat_script_items.length, 2);

  const aoVivo = usar(bancoEmMemoria(cenario({ webinars: [{ ...cenario().webinars[0], kind: "live" }] })));
  const recusa = await scriptActions.saveScriptItems({ items: [], webinarId: WEBINAR });
  assert.deepEqual([recusa.ok, recusa.status], [false, 409], "roteiro so na Live gravada");
  assert.equal(aoVivo.tables.webinar_chat_script_items.length, 0);
});

test("a transcricao: grava as cues na gravacao base e resolve as frases (pronta com o atraso / nao achada); sem video, 409; texto vazio, erro no campo", async () => {
  const items = [
    scriptItem({ phrase: "vamos começar", phrase_delay_ms: 1_500, status: "unresolved", trigger_kind: "on_phrase" }),
    scriptItem({ phrase: "frase que ninguém disse aqui", status: "unresolved", trigger_kind: "on_phrase" }),
    scriptItem({ offset_ms: 7_000, status: "ready" })
  ];
  const db = usar(bancoEmMemoria(cenario({ webinar_chat_script_items: items })));

  const salvo = ok(await scriptActions.saveTranscript({ format: "vtt", text: VTT, webinarId: WEBINAR }));
  assert.deepEqual([salvo.ready, salvo.unresolved, salvo.hasTranscript], [1, 1, true]);
  assert.deepEqual(salvo.transcript.cues, 2);
  assert.equal(salvo.transcript.format, "vtt");
  const [linha] = db.tables.webinar_recording_transcripts;
  assert.equal(linha.recording_id, RECORDING);
  assert.equal(linha.cues.length, 2);
  assert.equal(linha.created_by, HOST);
  assert.match(linha.full_text, /vamos começar/);
  const porId = new Map(db.tables.webinar_chat_script_items.map((row) => [row.id, row]));
  assert.deepEqual([porId.get(items[0].id).status, porId.get(items[0].id).resolved_offset_ms, porId.get(items[0].id).resolved_transcript_id], ["ready", 31_500, linha.id]);
  assert.deepEqual([porId.get(items[1].id).status, porId.get(items[1].id).resolved_offset_ms], ["unresolved", null]);
  assert.equal(porId.get(items[2].id).status, "ready", "o item por minuto nao muda");

  // A segunda transcricao substitui a primeira (uma por gravacao) e refaz a conta.
  const outra = ok(await scriptActions.saveTranscript({ format: "txt", text: "Um texto corrido sem frases do roteiro.", webinarId: WEBINAR }));
  assert.deepEqual([outra.ready, outra.unresolved], [0, 2]);
  assert.equal(db.tables.webinar_recording_transcripts.length, 1);
  assert.equal(porId.get(items[0].id).status, "unresolved");

  const resolvido = ok(await scriptActions.resolveScriptPhrases({ webinarId: WEBINAR }));
  assert.deepEqual([resolvido.ready, resolvido.unresolved, resolvido.hasTranscript], [0, 2, true]);
  assert.deepEqual(audits(db, "webinar.transcript_saved").map((row) => row.metadata.cues), [2, 1]);

  const vazio = await scriptActions.saveTranscript({ format: "vtt", text: "WEBVTT\n\n", webinarId: WEBINAR });
  assert.deepEqual([vazio.status, Object.keys(vazio.fieldErrors ?? {})], [400, ["text"]]);

  usar(bancoEmMemoria(cenario({ webinar_recordings: [] })));
  const semVideo = await scriptActions.saveTranscript({ format: "vtt", text: VTT, webinarId: WEBINAR });
  assert.deepEqual([semVideo.ok, semVideo.status], [false, 409]);
});

test("Soltar agora: o item vira mensagem scripted da persona no minuto do relogio do servidor; o mesmo item na mesma sessao da 409; sessao encerrada ou replay nao aceita", async () => {
  const item = scriptItem({ body: "Boa noite, turma!", persona_role: "team", trigger_kind: "manual" });
  const db = usar(bancoEmMemoria(cenario({ webinar_chat_script_items: [item] })));

  const solto = ok(await scriptActions.fireScriptItem({ itemId: item.id, sessionId: SESSAO_NO_AR }));
  assert.equal(solto.message.source, "scripted");
  assert.equal(solto.message.role, "team");
  assert.equal(solto.message.displayName, "Duda");
  assert.equal(solto.message.body, "Boa noite, turma!");
  assert.equal(solto.message.scriptItemId, item.id);
  assert.equal(solto.message.authorUserId, null);
  assert.ok(Math.abs(solto.message.offsetMs - 5 * MIN) < 10_000, `offset pelo relogio do servidor: ${solto.message.offsetMs}`);

  const repetido = await scriptActions.fireScriptItem({ itemId: item.id, sessionId: SESSAO_NO_AR });
  assert.deepEqual([repetido.ok, repetido.status], [false, 409]);
  assert.equal(db.tables.webinar_chat_messages.length, 1);

  const encerrada = await scriptActions.fireScriptItem({ itemId: item.id, sessionId: SESSAO_ENCERRADA });
  assert.deepEqual([encerrada.ok, encerrada.status], [false, 409]);

  const deOutro = await scriptActions.fireScriptItem({ itemId: randomUUID(), sessionId: SESSAO_NO_AR });
  assert.equal(deOutro.status, 404);

  const [auditoria] = audits(db, "webinar.script_fired");
  assert.deepEqual(Object.keys(auditoria.metadata).sort(), ["item_id", "offset_ms", "session_id", "trigger_kind"]);
});

/* ------------------------------------------------------------------------------------------------
 * Console: chat e moderacao
 * ---------------------------------------------------------------------------------------------- */

test("a mensagem da equipe: role host para o Apresentador, source team, aprovada, no offset do servidor; o replay nao tem; a sessao encerrada nao aceita", async () => {
  const db = usar(bancoEmMemoria(cenario({ webinar_sessions: [...cenario().webinar_sessions, { ...DEFAULTS.webinar_sessions, id: randomUUID(), kind: "replay", recording_id: RECORDING, scheduled_at: agora(), status: "live", webinar_id: WEBINAR }] })));
  const enviada = ok(await roomActions.sendTeamMessage({ body: "Bem-vindos!", sessionId: SESSAO_NO_AR }));
  assert.equal(enviada.message.role, "host", "quem apresenta escreve como Apresentador");
  assert.equal(enviada.message.source, "team");
  assert.equal(enviada.message.approved, true);
  assert.equal(enviada.message.displayName, "Produtor T.");
  assert.equal(enviada.message.authorUserId, HOST);
  assert.ok(Math.abs(enviada.message.offsetMs - 5 * MIN) < 10_000);

  actionStubs.role = { ...actionStubs.role, user: { ...actionStubs.role.user, id: ALUNO, user_metadata: { full_name: "Equipe Dois" } } };
  const daEquipe = ok(await roomActions.sendTeamMessage({ body: "Oi", sessionId: SESSAO_NO_AR }));
  assert.equal(daEquipe.message.role, "team");
  actionStubs.role = { ...actionStubs.role, user: { ...actionStubs.role.user, id: HOST, user_metadata: { full_name: "Produtor de Teste" } } };

  const replay = db.tables.webinar_sessions.find((row) => row.kind === "replay");
  const noReplay = await roomActions.sendTeamMessage({ body: "Oi", sessionId: replay.id });
  assert.deepEqual([noReplay.ok, noReplay.status], [false, 409]);
  const encerrada = await roomActions.sendTeamMessage({ body: "Oi", sessionId: SESSAO_ENCERRADA });
  assert.equal(encerrada.status, 409);
  assert.doesNotMatch(JSON.stringify(db.tables.admin_audit_log), /Bem-vindos/);
});

test("moderacao: liberar grava quem e quando; fixar uma por sessao; apagar some com motivo team e tira a fixada; promover so a da turma com aceite", async () => {
  const pendente = message({ approved: false, author_user_id: ALUNA });
  const semAceite = message({ author_user_id: ALUNO, display_name: "Aluno 231" });
  const daEquipe = message({ author_user_id: HOST, display_name: "Produtor T.", role: "team", source: "team" });
  const db = usar(bancoEmMemoria(cenario({ webinar_chat_messages: [pendente, semAceite, daEquipe] })));
  const sessao = () => db.tables.webinar_sessions.find((row) => row.id === SESSAO_NO_AR);
  const linha = (id) => db.tables.webinar_chat_messages.find((row) => row.id === id);

  const fixarPendente = await roomActions.moderateMessage({ action: "pin", messageId: pendente.id });
  assert.deepEqual([fixarPendente.ok, fixarPendente.status], [false, 409], "libere antes de fixar");

  const liberada = ok(await roomActions.moderateMessage({ action: "approve", messageId: pendente.id }));
  assert.equal(liberada.message.approved, true);
  assert.equal(linha(pendente.id).approved_by, HOST);
  assert.ok(linha(pendente.id).approved_at);

  const fixada = ok(await roomActions.moderateMessage({ action: "pin", messageId: pendente.id }));
  assert.equal(fixada.pinnedMessageId, pendente.id);
  assert.equal(sessao().pinned_message_id, pendente.id);
  assert.ok(linha(pendente.id).pinned_at);

  const outraFixada = ok(await roomActions.moderateMessage({ action: "pin", messageId: daEquipe.id }));
  assert.equal(outraFixada.pinnedMessageId, daEquipe.id);
  assert.equal(linha(pendente.id).pinned_at, null, "uma fixada por sessao");

  const promovidaSemAceite = await roomActions.moderateMessage({ action: "promote", messageId: semAceite.id });
  assert.deepEqual([promovidaSemAceite.ok, promovidaSemAceite.status], [false, 409]);
  assert.match(promovidaSemAceite.error, /consentimento/i);
  assert.equal(linha(semAceite.id).master, false);

  const promovida = ok(await roomActions.moderateMessage({ action: "promote", messageId: pendente.id }));
  assert.equal(promovida.message.master, true);
  assert.equal(promovida.message.source, "original");

  const equipePromovida = await roomActions.moderateMessage({ action: "promote", messageId: daEquipe.id });
  assert.equal(equipePromovida.status, 409, "so mensagem da turma vira linha mestre");

  const apagada = ok(await roomActions.moderateMessage({ action: "delete", messageId: daEquipe.id, reason: "fora do tema" }));
  assert.equal(apagada.pinnedMessageId, null, "apagar a fixada desafixa");
  assert.equal(linha(daEquipe.id).deleted_reason, "team");
  assert.equal(linha(daEquipe.id).deleted_by, HOST);
  assert.equal(sessao().pinned_message_id, null);

  const deNovo = await roomActions.moderateMessage({ action: "approve", messageId: daEquipe.id });
  assert.equal(deNovo.status, 404, "apagada nao volta");

  assert.deepEqual(
    audits(db, "webinar.moderated").map((row) => row.metadata.action),
    ["approve", "pin", "pin", "promote", "delete"]
  );
  assert.doesNotMatch(JSON.stringify(db.tables.admin_audit_log), /fora do tema/, "o motivo digitado nao vai para a auditoria");

  const modo = ok(await roomActions.setSessionChatMode({ chatMode: "moderated", sessionId: SESSAO_NO_AR, slowModeSeconds: 30 }));
  assert.deepEqual([modo.chatMode, modo.slowModeSeconds, sessao().chat_mode, sessao().chat_slow_mode_seconds], ["moderated", 30, "moderated", 30]);
  const desligado = ok(await roomActions.setSessionChatMode({ chatMode: "off", sessionId: SESSAO_NO_AR, slowModeSeconds: 30 }));
  assert.equal(desligado.slowModeSeconds, null, "chat desligado nao tem modo lento");
});

/* ------------------------------------------------------------------------------------------------
 * Abrir, encerrar e a Simulacao
 * ---------------------------------------------------------------------------------------------- */

test("abrir pela mao: so agendada ou na espera de webinario publicado (a RPC abre e o sino avisa); encerrar so na espera ou no ar", async () => {
  const rpc = {
    webinar_close_session: (args, tables) => {
      const row = tables.webinar_sessions.find((item) => item.id === args.p_session_id);
      row.status = "ended";
      row.ended_at = args.p_now;
      return { data: { avgPresent: 0, bucketSeconds: 30, buckets: [], durationMs: 60_000, frozenAt: args.p_now, peak: null, reachedEnd: 0, unique: 3, watchAvg: 0, watchMax: 0 }, error: null };
    },
    webinar_open_session: (args, tables) => {
      const row = tables.webinar_sessions.find((item) => item.id === args.p_session_id);
      const changed = row.status !== "live";
      row.status = "live";
      row.script_fired_at = args.p_now;
      return { data: { changed, fired: 2, status: "live" }, error: null };
    }
  };
  const db = usar(bancoEmMemoria(cenario(), rpc));

  const encerradaNaoAbre = await roomActions.openSessionNow({ sessionId: SESSAO_ENCERRADA });
  assert.deepEqual([encerradaNaoAbre.ok, encerradaNaoAbre.status], [false, 409]);
  const noArNaoAbre = await roomActions.openSessionNow({ sessionId: SESSAO_NO_AR });
  assert.equal(noArNaoAbre.status, 409);

  const aberta = ok(await roomActions.openSessionNow({ sessionId: SESSAO_MARCADA }));
  assert.deepEqual([aberta.changed, aberta.fired, aberta.sessionId], [true, 2, SESSAO_MARCADA]);
  assert.deepEqual(db.rpcs.map((call) => call.name), ["webinar_open_session"]);
  assert.equal(db.tables.webinar_sessions.find((row) => row.id === SESSAO_MARCADA).status, "live");
  assert.equal(audits(db, "webinar.session_opened")[0].metadata.fired, 2);

  const marcadaNaoEncerra = usar(bancoEmMemoria(cenario(), rpc));
  const recusa = await roomActions.endSessionNow({ sessionId: SESSAO_MARCADA });
  assert.deepEqual([recusa.ok, recusa.status], [false, 409]);
  assert.equal(marcadaNaoEncerra.rpcs.length, 0);

  const encerrada = ok(await roomActions.endSessionNow({ sessionId: SESSAO_NO_AR }));
  assert.equal(encerrada.sessionId, SESSAO_NO_AR);
  assert.equal(encerrada.summary.unique, 3);
  assert.equal(marcadaNaoEncerra.tables.webinar_sessions.find((row) => row.id === SESSAO_NO_AR).status, "ended");
  assert.equal(audits(marcadaNaoEncerra, "webinar.session_ended")[0].metadata.unique, 3);

  const rascunho = usar(bancoEmMemoria(cenario({ webinars: [{ ...cenario().webinars[0], published_at: null, status: "draft" }] }), rpc));
  const naoPublicado = await roomActions.openSessionNow({ sessionId: SESSAO_MARCADA });
  assert.equal(naoPublicado.status, 409);
  assert.equal(rascunho.rpcs.length, 0);
});

test("Simulação (§8.6): ligar exige a frase de hoje com o nome de quem decide; a frase errada ou sem a caixa recusa no campo; desligar grava a decisao; a auditoria leva os valores", async () => {
  const db = usar(bancoEmMemoria(cenario()));
  const sessao = () => db.tables.webinar_sessions.find((row) => row.id === SESSAO_MARCADA);
  const frase = consoleModel.consoleAckSentence({ badgeOn: true, nowMs: Date.now(), responsible: "Produtor de Teste" });

  const semCaixa = await roomActions.saveSimulation({ ackText: frase, sessionId: SESSAO_MARCADA, showLiveBadge: true });
  assert.deepEqual([semCaixa.status, Object.keys(semCaixa.fieldErrors ?? {})], [400, ["acknowledged"]]);
  assert.equal(semCaixa.fieldErrors.acknowledged[0], CHAT_MESSAGES.simulationAck);

  const fraseErrada = await roomActions.saveSimulation({ ackText: frase.replace("Produtor de Teste", "Outra Pessoa"), acknowledged: true, sessionId: SESSAO_MARCADA, showLiveBadge: true });
  assert.deepEqual([fraseErrada.status, Object.keys(fraseErrada.fieldErrors ?? {})], [400, ["acknowledged"]]);
  assert.equal(sessao().show_live_badge, false);

  const ligado = ok(await roomActions.saveSimulation({ ackText: `  ${frase}  `, acknowledged: true, sessionId: SESSAO_MARCADA, showLiveBadge: true }));
  assert.equal(ligado.session.showLiveBadge, true);
  assert.equal(ligado.deciderName, "Produtor de Teste");
  assert.deepEqual([sessao().show_live_badge, sessao().simulation_ack_text, sessao().simulation_decided_by], [true, frase, HOST]);
  assert.ok(sessao().simulation_decided_at);

  const desligado = ok(await roomActions.saveSimulation({ sessionId: SESSAO_MARCADA, showLiveBadge: false }));
  assert.equal(desligado.session.showLiveBadge, false);
  assert.match(sessao().simulation_ack_text, /fica desligado/, "desligar tambem registra a decisao");
  assert.deepEqual(
    audits(db, "webinar.simulation_saved").map((row) => [row.metadata.show_live_badge, row.metadata.numbers_simulated, row.metadata.decided_by, typeof row.metadata.ack_text]),
    [
      [true, false, HOST, "string"],
      [false, false, HOST, "string"]
    ]
  );

  const noAr = await roomActions.saveSimulation({ ackText: frase, acknowledged: true, sessionId: SESSAO_NO_AR, showLiveBadge: true });
  assert.equal(noAr.ok, true, "a sessao no ar ainda muda o selo");
  const encerrada = ok(await roomActions.saveSimulation({ sessionId: SESSAO_ENCERRADA, showLiveBadge: false }));
  assert.equal(encerrada.session.showLiveBadge, false);
});

/* ------------------------------------------------------------------------------------------------
 * Enquetes e perguntas
 * ---------------------------------------------------------------------------------------------- */

test("enquetes: os modelos (cria, atualiza com as opcoes, apaga o que saiu); abrir copia o modelo na sessao sem duplicar; encerrar e compartilhar", async () => {
  const db = usar(bancoEmMemoria(cenario()));
  const salvas = ok(await roomActions.savePolls({ polls: [{ anonymous: false, kind: "single", options: [{ label: "Sim" }, { label: "Não" }], question: "Vem na próxima?" }, { anonymous: true, kind: "multiple", options: [{ label: "A" }, { label: "B" }, { label: "C" }], question: "Quais temas?" }], webinarId: WEBINAR }));
  assert.deepEqual([salvas.created, salvas.updated, salvas.deleted], [2, 0, 0]);
  assert.deepEqual(
    salvas.polls.map((poll) => [poll.position, poll.question, poll.options.map((option) => option.label), poll.sessionId, poll.status]),
    [
      [0, "Vem na próxima?", ["Sim", "Não"], null, "draft"],
      [1, "Quais temas?", ["A", "B", "C"], null, "draft"]
    ]
  );

  const [primeira, segunda] = salvas.polls;
  const idDeOutra = segunda.options[0].id;
  const atualizadas = ok(
    await roomActions.savePolls({
      polls: [{ anonymous: true, id: primeira.id, kind: "single", options: [{ id: primeira.options[1].id, label: "Não" }, { id: idDeOutra, label: "Talvez" }, { label: "Sim!" }], question: "Vem?" }],
      webinarId: WEBINAR
    })
  );
  assert.deepEqual([atualizadas.created, atualizadas.updated, atualizadas.deleted], [0, 1, 1]);
  assert.equal(atualizadas.polls.length, 1);
  assert.deepEqual(atualizadas.polls[0].options.map((option) => option.label), ["Não", "Talvez", "Sim!"]);
  assert.equal(atualizadas.polls[0].options[0].id, primeira.options[1].id, "a opcao que ficou mantem o id");
  assert.notEqual(atualizadas.polls[0].options[1].id, idDeOutra, "id de opcao de outra enquete nao e aproveitado");
  assert.equal(db.tables.webinar_polls.length, 1);

  const modelo = atualizadas.polls[0];
  const aberta = ok(await roomActions.launchPoll({ pollId: modelo.id, sessionId: SESSAO_NO_AR }));
  assert.deepEqual([aberta.poll.sessionId, aberta.poll.templatePollId, aberta.poll.status, aberta.poll.question], [SESSAO_NO_AR, modelo.id, "open", "Vem?"]);
  assert.ok(aberta.poll.openedAt);
  assert.ok(Math.abs(aberta.poll.openOffsetMs - 5 * MIN) < 10_000);
  assert.deepEqual(aberta.poll.options.map((option) => option.label), ["Não", "Talvez", "Sim!"]);

  const deNovo = ok(await roomActions.launchPoll({ pollId: modelo.id, sessionId: SESSAO_NO_AR }));
  assert.equal(deNovo.poll.id, aberta.poll.id, "uma copia aberta por modelo e sessao");
  assert.equal(db.tables.webinar_polls.filter((row) => row.session_id === SESSAO_NO_AR).length, 1);

  const abrirCopia = await roomActions.launchPoll({ pollId: aberta.poll.id, sessionId: SESSAO_NO_AR });
  assert.equal(abrirCopia.status, 409, "abre pelo modelo, nao pela copia");
  const naEncerrada = await roomActions.launchPoll({ pollId: modelo.id, sessionId: SESSAO_ENCERRADA });
  assert.equal(naEncerrada.status, 409);

  const encerrada = ok(await roomActions.closePoll({ pollId: aberta.poll.id, sessionId: SESSAO_NO_AR }));
  assert.deepEqual([encerrada.poll.status, encerrada.poll.resultsSharedAt], ["closed", null]);
  assert.ok(encerrada.poll.closedAt);
  const compartilhada = ok(await roomActions.closePoll({ pollId: aberta.poll.id, sessionId: SESSAO_NO_AR, shareResults: true }));
  assert.ok(compartilhada.poll.resultsSharedAt);
  const modeloNaoEncerra = await roomActions.closePoll({ pollId: modelo.id, sessionId: SESSAO_NO_AR });
  assert.equal(modeloNaoEncerra.status, 404);
  assert.deepEqual(db.tables.admin_audit_log.map((row) => row.action).filter((action) => action.startsWith("webinar.poll_")), ["webinar.poll_launched", "webinar.poll_closed", "webinar.poll_closed"]);
  assert.equal(audits(db, "webinar.polls_saved").length, 2);
});

test("perguntas: responder por escrito vira linha da equipe no chat e marca respondida; ao vivo so marca; sem nada, erro no campo; dispensar e reabrir", async () => {
  const pergunta = { ...DEFAULTS.webinar_questions, body: "Vai ter replay?", created_at: agora(), display_name: "Ana M.", id: randomUUID(), offset_ms: 2_000, session_id: SESSAO_NO_AR, updated_at: agora(), upvotes: 3, user_id: ALUNA };
  const outra = { ...pergunta, body: "E certificado?", id: randomUUID() };
  const db = usar(bancoEmMemoria(cenario({ webinar_questions: [pergunta, outra] })));

  const semNada = await roomActions.answerQuestion({ questionId: pergunta.id });
  assert.deepEqual([semNada.status, Object.keys(semNada.fieldErrors ?? {})], [400, ["answerText"]]);

  const escrita = ok(await roomActions.answerQuestion({ answerText: "Vai, fica 7 dias.", questionId: pergunta.id }));
  assert.deepEqual([escrita.question.status, escrita.question.answerText, escrita.question.answeredBy, escrita.question.answeredLive], ["answered", "Vai, fica 7 dias.", HOST, false]);
  assert.equal(escrita.message.kind, "answer");
  assert.equal(escrita.message.source, "team");
  assert.equal(escrita.message.role, "host");
  assert.equal(db.tables.webinar_chat_messages.length, 1);

  const aoVivo = ok(await roomActions.answerQuestion({ answeredLive: true, questionId: outra.id }));
  assert.deepEqual([aoVivo.question.status, aoVivo.question.answeredLive, aoVivo.message], ["answered", true, null]);

  const dispensada = ok(await roomActions.setQuestionStatus({ questionId: outra.id, status: "dismissed" }));
  assert.equal(dispensada.question.status, "dismissed");
  const reaberta = ok(await roomActions.setQuestionStatus({ questionId: outra.id, status: "open" }));
  assert.equal(reaberta.question.status, "open");
  assert.doesNotMatch(JSON.stringify(db.tables.admin_audit_log), /replay\?|7 dias/, "nem a pergunta nem a resposta vao para a auditoria");
});

/* ------------------------------------------------------------------------------------------------
 * Replay livre e LGPD
 * ---------------------------------------------------------------------------------------------- */

test("o replay: so depois de uma sessao encerrar e com video pronto; nasce uma vez (a segunda chamada devolve a mesma); fechar e reabrir mantem a linha", async () => {
  const semEncerrada = usar(bancoEmMemoria(cenario({ webinar_sessions: cenario().webinar_sessions.filter((row) => row.status !== "ended") })));
  const cedo = await roomActions.createReplaySession({ webinarId: WEBINAR });
  assert.deepEqual([cedo.ok, cedo.status], [false, 409]);
  assert.equal(semEncerrada.tables.webinar_sessions.some((row) => row.kind === "replay"), false);

  const db = usar(bancoEmMemoria(cenario()));
  const criado = ok(await roomActions.createReplaySession({ webinarId: WEBINAR }));
  assert.deepEqual([criado.created, criado.session.kind, criado.session.status, criado.session.sourceSessionId, criado.session.recordingId, criado.session.lateJoinMinutes], [true, "replay", "live", SESSAO_ENCERRADA, RECORDING, null]);
  const repetido = ok(await roomActions.createReplaySession({ webinarId: WEBINAR }));
  assert.deepEqual([repetido.created, repetido.session.id], [false, criado.session.id]);
  assert.equal(db.tables.webinar_sessions.filter((row) => row.kind === "replay").length, 1);

  const fechado = ok(await roomActions.cancelReplaySession({ webinarId: WEBINAR }));
  assert.equal(fechado.sessionId, criado.session.id);
  assert.equal(db.tables.webinar_sessions.find((row) => row.kind === "replay").status, "cancelled");
  const fecharDeNovo = await roomActions.cancelReplaySession({ webinarId: WEBINAR });
  assert.equal(fecharDeNovo.status, 404);

  const reaberto = ok(await roomActions.createReplaySession({ webinarId: WEBINAR }));
  assert.deepEqual([reaberto.created, reaberto.session.id, reaberto.session.status], [true, criado.session.id, "live"]);
  assert.deepEqual(audits(db, "webinar.replay_created").map((row) => row.metadata.reopened), [false, true]);

  usar(bancoEmMemoria(cenario({ webinar_recordings: [{ ...cenario().webinar_recordings[0], status: "processing" }] })));
  const semVideo = await roomActions.createReplaySession({ webinarId: WEBINAR });
  assert.equal(semVideo.status, 409);
});

test("Remover minhas mensagens a pedido do aluno: apaga chat, perguntas e respostas de enquete, retira o aceite, registra o historico e o motivo na auditoria", async () => {
  const db = usar(
    bancoEmMemoria(
      cenario({
        webinar_chat_messages: [message({ author_user_id: ALUNA }), message({ author_user_id: ALUNA, session_id: SESSAO_ENCERRADA }), message({ author_user_id: ALUNO })],
        webinar_poll_answers: [{ created_at: agora(), deleted_at: null, id: randomUUID(), offset_ms: 0, option_ids: [randomUUID()], poll_id: randomUUID(), session_id: SESSAO_NO_AR, user_id: ALUNA }],
        webinar_questions: [{ ...DEFAULTS.webinar_questions, body: "?", created_at: agora(), display_name: "Ana M.", id: randomUUID(), offset_ms: 0, session_id: SESSAO_NO_AR, updated_at: agora(), user_id: ALUNA }]
      })
    )
  );

  const removido = ok(await roomActions.removeStudentMessages({ reason: "pedido por e-mail em 29/10", userId: ALUNA }));
  assert.deepEqual(removido, { answers: 1, consentRevoked: true, messages: 2, questions: 1 });
  assert.deepEqual(
    db.tables.webinar_chat_messages.filter((row) => row.author_user_id === ALUNA).map((row) => row.deleted_reason),
    ["consent_revoked", "consent_revoked"]
  );
  assert.equal(db.tables.webinar_chat_messages.find((row) => row.author_user_id === ALUNO).deleted_at, null, "o outro aluno fica");
  assert.ok(db.tables.webinar_chat_consents[0].revoked_at);
  const [evento] = db.tables.student_events;
  assert.deepEqual([evento.event_type, evento.entity_type, evento.user_id, evento.metadata.revoked, evento.metadata.by_team], ["webinar_chat_consented", "webinar", ALUNA, true, true]);
  const [auditoria] = audits(db, "webinar.student_messages_removed");
  assert.equal(auditoria.entity_id, ALUNA);
  assert.deepEqual(auditoria.metadata, { answers: 1, consent_revoked: true, messages: 2, questions: 1, reason: "pedido por e-mail em 29/10" });

  const deNovo = ok(await roomActions.removeStudentMessages({ reason: "repetido", userId: ALUNA }));
  assert.deepEqual(deNovo, { answers: 0, consentRevoked: false, messages: 0, questions: 0 }, "repetir nao apaga nem retira duas vezes");
});

test("o chat de uma sessao vira CSV do roteiro: so turma, chat original e equipe aprovados, em ordem do video, com o papel por extenso", async () => {
  const db = usar(
    bancoEmMemoria(
      cenario({
        webinar_chat_messages: [
          message({ body: "Segunda", offset_ms: 20_000, session_id: SESSAO_ENCERRADA }),
          message({ body: "Primeira", offset_ms: 10_000, session_id: SESSAO_ENCERRADA }),
          message({ body: "Da equipe", display_name: "Produtor T.", offset_ms: 15_000, role: "host", session_id: SESSAO_ENCERRADA, source: "team" }),
          message({ body: "Do roteiro", offset_ms: 5_000, session_id: SESSAO_ENCERRADA, source: "scripted" }),
          message({ approved: false, body: "Pendente", offset_ms: 1_000, session_id: SESSAO_ENCERRADA }),
          message({ body: "Apagada", deleted_at: agora(), offset_ms: 2_000, session_id: SESSAO_ENCERRADA })
        ]
      })
    )
  );
  const exportado = ok(await scriptActions.exportSessionChatCsv({ sessionId: SESSAO_ENCERRADA }));
  const linhas = exportado.csv.replace(/^﻿/, "").trim().split("\r\n");
  assert.deepEqual(linhas, ["Tempo;Nome;Papel;Mensagem", "00:10;Ana M.;Aluno;Primeira", "00:15;Produtor T.;Equipe;Da equipe", "00:20;Ana M.;Aluno;Segunda"]);
  assert.equal(exportado.rows, 3);
  assert.equal(audits(db, "webinar.chat_exported")[0].metadata.session_id, SESSAO_ENCERRADA);
});
