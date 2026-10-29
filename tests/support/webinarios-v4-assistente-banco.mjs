import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { actionStubs } from "./admin-action-stubs.mjs";

// Dubles da fase 4c (o Assistente de IA, os atendentes e o modo hibrido; docs/30 §1.6, §2.4, §6.6 e D24; docs/18
// §2.5) para os testes sem banco: um banco em memoria que entende as consultas das rotas da Sala, das Server Actions
// e de assistant-store.ts (filtros do PostgREST, or, not, neq, ordem, limite, contagem, upsert por chave e as chaves
// unicas da 202610290001 e da 202610290006 como 23505), o banco "sem a 202610290006" (tabelas e colunas novas
// respondem 42P01 / 42703), a escola de mentira (uma Live gravada no ar com a gravacao, a transcricao e a live de
// origem; ou a mesma sessao como Live ao vivo) e o gateway de IA falso no lugar de src/server/ai/provider-pool.ts
// (`iaFalsa`: as conexoes ativas e a resposta combinada pelo teste; nunca um provedor de verdade). A sessao do aluno
// das rotas vem de `sessaoDoAluno.user`. Importe este modulo antes de carregar o codigo de src/ com import().

export const sessaoDoAluno = (globalThis.__assistenteSessao ??= { user: null });

export const iaFalsa = (globalThis.__assistenteIa ??= {
  candidatos: [{ connectionId: "conexao-falsa", contextMaxCharacters: 20_000, model: "modelo-falso", provider: "openai" }],
  chamadas: [],
  responder: () => "Resposta do Assistente de teste.",
  zerar() {
    this.candidatos = [{ connectionId: "conexao-falsa", contextMaxCharacters: 20_000, model: "modelo-falso", provider: "openai" }];
    this.chamadas = [];
    this.responder = () => "Resposta do Assistente de teste.";
  }
});

const stub = (source) => ({ shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` });

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

registerHooks({
  resolve(specifier, context, nextResolve) {
    const modulo = moduloDeSrc(specifier, context);
    if (modulo === "server/auth/guards") {
      return stub(`
        export async function requireApiUser() {
          const user = globalThis.__assistenteSessao.user;
          return user ? { response: null, user } : { response: Response.json({ error: "Sessao obrigatoria." }, { status: 401 }), user: null };
        }
        export const requireApiSessionUser = requireApiUser;`);
    }
    if (modulo === "server/db/supabase/client") {
      return stub(`
        export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }
        export function hasSupabaseConfig() { return true; }`);
    }
    if (modulo === "server/ai/provider-pool") {
      return stub(`
        export class AIProviderPoolError extends Error {
          constructor(message, code, attempts = []) { super(message); this.name = "AIProviderPoolError"; this.code = code; this.attempts = attempts; }
        }
        export async function listAIProviderRuntimeCandidates() { return [...globalThis.__assistenteIa.candidatos]; }
        export async function generateAITextWithFallback(args) {
          const ia = globalThis.__assistenteIa;
          ia.chamadas.push(args);
          const text = await ia.responder(args);
          const config = args.candidates[0];
          return { attempts: [], config, generation: { gatewayRequestId: null, inputTokens: 1, outputTokens: 1, text } };
        }`);
    }
    return nextResolve(specifier, context);
  }
});

/* ------------------------------------------------------------------------------------------------
 * O banco em memoria
 * ---------------------------------------------------------------------------------------------- */

const UNIQUE = {
  notifications: [["user_id", "dedupe_key"]],
  webinar_ai_requests: [["target_kind", "target_id"]],
  webinar_attendants: [["session_id", "user_id"]],
  webinar_chat_consents: [["user_id"]],
  webinar_poll_answers: [["poll_id", "user_id"]],
  webinar_presence_samples: [["session_id", "user_id", "bucket"]],
  webinar_question_votes: [["question_id", "user_id"]]
};
const NO_ID = new Set(["webinar_attendance", "webinar_attendants", "webinar_chat_consents", "webinar_presence_samples", "webinar_question_votes"]);
const DEFAULTS = {
  admin_audit_log: { count: null, entity_id: null, entity_type: null, metadata: {} },
  notifications: { payload: {} },
  student_events: { entity_id: null, entity_type: null, metadata: {} },
  webinar_ai_requests: { answered_at: null, error_code: null, model: null, provider: null, reply_message_id: null, skip_reason: null, status: "pending" },
  webinar_assistant_knowledge: { created_by: null, position: 0 },
  webinar_attendants: { status: "online" },
  webinar_chat_consents: { nickname: null, revoked_at: null },
  webinar_chat_messages: {
    approved: true,
    approved_at: null,
    approved_by: null,
    assigned_at: null,
    assigned_to: null,
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    edited_at: null,
    edited_by: null,
    handoff_requested_at: null,
    kind: "message",
    master: false,
    pinned_at: null,
    reply_to_id: null,
    script_item_id: null
  },
  webinar_poll_answers: { deleted_at: null },
  webinar_presence_samples: { samples: 1 },
  webinar_questions: {
    anonymous: false,
    answer_source: null,
    answer_text: null,
    answered_at: null,
    answered_by: null,
    answered_live: false,
    assigned_at: null,
    assigned_to: null,
    deleted_at: null,
    deleted_reason: null,
    handoff_requested_at: null,
    message_id: null,
    status: "open",
    upvotes: 0
  }
};

/** O que so existe com a 202610290006: tabelas novas e colunas novas (o banco "sem a migracao" responde erro). */
export const MIGRACAO_0006 = {
  colunas: {
    webinar_chat_messages: ["assigned_to", "assigned_at", "handoff_requested_at", "edited_at", "edited_by"],
    webinar_questions: ["assigned_to", "assigned_at", "answer_source", "handoff_requested_at"],
    webinar_sessions: ["assistant_reply_all"],
    webinars: ["assistant_settings"]
  },
  tabelas: ["webinar_ai_requests", "webinar_assistant_knowledge", "webinar_attendants"]
};

function literal(text) {
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  return text.replace(/^"(.*)"$/, "$1");
}

/** Compara instantes quando os dois lados sao datas (o PostgREST devolve "+00:00", o toISOString escreve "Z"). */
function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const ta = typeof a === "string" ? Date.parse(a) : Number.NaN;
  const tb = typeof b === "string" ? Date.parse(b) : Number.NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb) && /\d{4}-\d{2}-\d{2}T/.test(a) && /\d{4}-\d{2}-\d{2}T/.test(b)) return ta - tb;
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
    case "gte":
      return current !== null && current !== undefined && compare(current, value) >= 0;
    case "gt":
      return current !== null && current !== undefined && compare(current, value) > 0;
    case "lte":
      return current !== null && current !== undefined && compare(current, value) <= 0;
    case "lt":
      return current !== null && current !== undefined && compare(current, value) < 0;
    case "not":
      if (value === "is") return extra === null ? current !== null && current !== undefined : current !== extra;
      if (value === "in") return !String(extra).replace(/^\(|\)$/g, "").split(",").includes(current);
      return true;
    case "or":
      return column.split(",").some((part) => {
        const [col, operator, ...rest] = part.split(".");
        return matches(row, [operator, col, literal(rest.join("."))]);
      });
    default:
      return true;
  }
}

/** O relogio do banco falso (created_at das linhas novas). */
export const relogioDoBanco = { agora: () => Date.now() };

const iso = (time) => new Date(time).toISOString();

/**
 * O banco em memoria: `tables` (listas por tabela), `rpc` (dubles das RPCs) e `semMigracao` (o banco sem a
 * 202610290006). `calls` guarda as tabelas lidas, as RPCs e as escritas.
 */
export function bancoFalso({ rpc = {}, semMigracao = false, tables = {} } = {}) {
  const calls = { from: [], rpc: [], writes: [] };
  const table = (name) => (tables[name] ??= []);

  function violates(name, row, ignore) {
    return (UNIQUE[name] ?? []).some((keys) => table(name).some((existing) => existing !== ignore && keys.every((key) => existing[key] === row[key])));
  }

  function missingIn(name, state) {
    if (!semMigracao) return null;
    if (MIGRACAO_0006.tabelas.includes(name)) {
      return { code: "42P01", message: `relation "public.${name}" does not exist` };
    }
    const columns = MIGRACAO_0006.colunas[name] ?? [];
    const mentioned = [
      typeof state.columns === "string" ? state.columns : "",
      JSON.stringify(state.payload ?? {}),
      state.filters.map(([, column]) => String(column)).join(",")
    ].join(" ");
    const missing = columns.find((column) => new RegExp(`\\b${column}\\b`).test(mentioned));
    return missing ? { code: "42703", message: `column ${name}.${missing} does not exist` } : null;
  }

  function query(name) {
    const state = { columns: null, count: null, filters: [], head: false, ignoreDuplicates: false, limit: null, op: null, order: [], payload: null, range: null, single: null, upsertKeys: null };

    function stamp(row) {
      const now = iso(relogioDoBanco.agora());
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
      const missing = missingIn(name, state);
      if (missing) {
        return { count: null, data: null, error: missing };
      }
      const rows = table(name);
      const filtered = () => rows.filter((row) => state.filters.every((filter) => matches(row, filter)));

      if (state.op === "insert" || state.op === "upsert") {
        const payloads = Array.isArray(state.payload) ? state.payload : [state.payload];
        const touched = [];
        for (const payload of payloads) {
          const existing = state.op === "upsert" ? rows.find((row) => state.upsertKeys.every((key) => row[key] === payload[key])) : null;
          if (existing) {
            if (!state.ignoreDuplicates) {
              Object.assign(existing, payload, { updated_at: iso(relogioDoBanco.agora()) });
              touched.push(existing);
            }
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
        touched.forEach((row) => Object.assign(row, state.payload, { updated_at: iso(relogioDoBanco.agora()) }));
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
      select: (columns, options) => {
        state.op ??= "select";
        state.columns ??= columns ?? "*";
        if (options?.count) state.count = options.count;
        if (options?.head) state.head = true;
        return chain;
      },
      single: () => ((state.single = "single"), chain),
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
      update: (payload) => ((state.op = "update"), (state.payload = payload), chain),
      upsert: (payload, options) => (
        (state.op = "upsert"), (state.payload = payload), (state.upsertKeys = (options?.onConflict ?? "id").split(",")), (state.ignoreDuplicates = options?.ignoreDuplicates === true), chain
      )
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

/** A RPC webinar_chat_window: as linhas da sessao (aprovadas, ou minhas) + a linha mestre das outras sessoes do webinario. */
export function janelaDoChat(args, tables) {
  const session = tables.webinar_sessions.find((row) => row.id === args.p_session_id);
  const own = tables.webinar_chat_messages.filter(
    (row) => row.session_id === args.p_session_id && !row.deleted_at && row.offset_ms >= args.p_from_ms && row.offset_ms <= args.p_to_ms && (row.approved || (args.p_user_id && row.author_user_id === args.p_user_id))
  );
  const master = tables.webinar_chat_messages.filter(
    (row) => row.master && row.approved && !row.deleted_at && row.session_id !== args.p_session_id && row.webinar_id === session?.webinar_id && row.offset_ms >= args.p_from_ms && row.offset_ms <= args.p_to_ms
  );
  return [...own, ...master].sort((a, b) => a.offset_ms - b.offset_ms);
}

/* ------------------------------------------------------------------------------------------------
 * A escola de mentira
 * ---------------------------------------------------------------------------------------------- */

const MIN = 60_000;
const HOUR = 60 * MIN;

export const WEBINAR = "abcdabcd-0000-4000-8000-000000000001";
export const SESSAO = "abcdabcd-0000-4000-8000-000000000002";
export const OUTRA_SESSAO = "abcdabcd-0000-4000-8000-000000000003";
export const GRAVACAO = "abcdabcd-0000-4000-8000-000000000004";
export const PRODUTO = "abcdabcd-0000-4000-8000-000000000005";
export const EQUIPE = "abcdabcd-0000-4000-8000-0000000000e1";
export const EQUIPE_2 = "abcdabcd-0000-4000-8000-0000000000e2";
export const OUTRO_ALUNO = "abcdabcd-0000-4000-8000-0000000000a9";

/**
 * Uma Live gravada publicada para todos, no ar ha 10 min (`kind: "live"` faz a mesma sessao ser a Live ao vivo
 * no ar), com o Assistente ligado (`assistant`), o "Responder tudo" da sessao (`replyAll`), a gravacao com a
 * transcricao em volta do minuto 10, uma pergunta e resposta cadastrada, o produto e uma conexao de IA ativa
 * (`semIa` tira as conexoes).
 */
export function escola({ assistant = { enabled: true, replyAllDefault: false }, chatMode = "open", kind = "simulated", replyAll = false, semIa = false, startedMinutesAgo = 10 } = {}) {
  const now = Date.now();
  const startedAt = iso(now - startedMinutesAgo * MIN);
  const webinar = {
    access_mode: "everyone",
    allow_student_camera: true,
    assistant_settings: assistant,
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
    description: "Uma live sobre agentes de IA na pratica.",
    duration_minutes: 60,
    host_user_id: EQUIPE,
    id: WEBINAR,
    kind,
    product_id: PRODUTO,
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
    slug: "live-do-assistente",
    status: "published",
    title: "Live do Assistente",
    updated_at: iso(now - HOUR)
  };
  const session = (id, extra = {}) => ({
    assistant_reply_all: replyAll,
    chat_mode: chatMode,
    chat_slow_mode_seconds: null,
    created_at: iso(now - HOUR),
    ended_at: null,
    id,
    jit: false,
    kind,
    late_join_minutes: null,
    pinned_message_id: null,
    presence_curve: null,
    recording_anchor_at: kind === "live" ? startedAt : null,
    recording_id: kind === "live" ? null : GRAVACAO,
    room_locked: false,
    room_name: kind === "live" ? "w-abcdabcd-abcdefghijkmnpqr" : null,
    scheduled_at: startedAt,
    script_fired_at: null,
    show_live_badge: false,
    simulation_ack_text: null,
    simulation_decided_at: null,
    simulation_decided_by: null,
    source_session_id: null,
    started_at: kind === "live" ? startedAt : null,
    status: kind === "live" ? "live" : "scheduled",
    updated_at: iso(now - HOUR),
    webinar_id: WEBINAR,
    ...extra
  });
  return {
    admin_audit_log: [],
    admin_roles: [{ role: "owner", user_id: EQUIPE }, { role: "editor", user_id: EQUIPE_2 }],
    ai_provider_configs: [{ enabled: true, provider: "openai", status: "configured" }],
    ai_provider_connections: semIa ? [] : [{ cooldown_until: null, deleted_at: null, id: "conexao-falsa", provider: "openai", status: "active" }],
    content_items: [{ id: PRODUTO, title: "Formacao em Agentes" }],
    entitlements: [],
    lesson_comment_blocked_words: [{ active: true, message: "Sem isso aqui.", word: "palavrão" }],
    notifications: [],
    profiles: [
      { avatar_url: null, created_at: iso(now), email: "equipe@bunker707.test", full_name: "Equipe Teste", id: EQUIPE, last_sign_in_at: null, phone: null },
      { avatar_url: null, created_at: iso(now), email: "equipe2@bunker707.test", full_name: "Bia Atendente", id: EQUIPE_2, last_sign_in_at: null, phone: null }
    ],
    student_events: [],
    webinar_ai_requests: [],
    webinar_assistant_knowledge: [
      { answer: "O preco e R$ 997 a vista ou 12 x de R$ 99,70.", created_at: iso(now - HOUR), created_by: EQUIPE, id: randomUUID(), position: 0, question: "Quanto custa a Formacao?", updated_at: iso(now - HOUR), webinar_id: WEBINAR }
    ],
    webinar_attendants: [],
    webinar_chat_consents: [],
    webinar_chat_messages: [],
    webinar_presence_samples: [],
    webinar_presenters: [],
    webinar_questions: [],
    webinar_recording_transcripts: [
      {
        checksum: "x",
        created_at: iso(now - HOUR),
        created_by: null,
        cues: [
          { endSeconds: 5, startSeconds: 0, text: "Bem-vindos a live." },
          { endSeconds: 560, startSeconds: 550, text: "Agora vamos falar das ferramentas do agente." },
          { endSeconds: 605, startSeconds: 598, text: "A memoria guarda o que o agente ja fez." },
          { endSeconds: 2000, startSeconds: 1990, text: "No fim, a oferta da Formacao." }
        ],
        id: randomUUID(),
        language: "pt",
        recording_id: GRAVACAO,
        source_format: "vtt",
        updated_at: iso(now - HOUR)
      }
    ],
    webinar_recordings: [
      {
        anchor_offset_ms: 0,
        bunny_library_id: "12345",
        bunny_video_id: "0b1c2d3e-aaaa-4bbb-8ccc-123456789abc",
        created_at: iso(now - HOUR),
        duration_seconds: 3600,
        embed_url: "https://iframe.mediadelivery.net/embed/12345/0b1c2d3e-aaaa-4bbb-8ccc-123456789abc",
        error_message: null,
        file_name: null,
        id: GRAVACAO,
        provider: "bunny",
        purge_due_at: null,
        session_id: null,
        sha256: null,
        size_bytes: null,
        source: "upload",
        status: "ready",
        updated_at: iso(now - HOUR),
        webinar_id: WEBINAR
      }
    ],
    webinar_registrations: [],
    webinar_session_bans: [],
    webinar_sessions: [session(SESSAO), session(OUTRA_SESSAO, { scheduled_at: iso(now + 24 * HOUR), status: "scheduled" })],
    webinar_user_bans: [],
    webinars: [webinar]
  };
}

let proximoAluno = 500;

/** Um aluno novo (o teto global de escritas e por aluno e vive no modulo), com o perfil. */
export function novoAluno(db) {
  proximoAluno += 1;
  const id = `66666666-6666-4666-8666-${String(proximoAluno).padStart(12, "0")}`;
  sessaoDoAluno.user = { id };
  db.tables.profiles.push({ avatar_url: null, created_at: iso(Date.now()), email: `aluno${proximoAluno}@bunker707.test`, full_name: "Ana Maria Souza", id, last_sign_in_at: null, phone: null });
  return id;
}

/** O banco da escola (com `opcoes` de escola()) ligado aos dubles; devolve o banco e o aluno da vez. */
export function montarEscola(opcoes = {}, { semMigracao = false } = {}) {
  const db = bancoFalso({ rpc: { webinar_chat_window: janelaDoChat }, semMigracao, tables: escola(opcoes) });
  actionStubs.db = db;
  iaFalsa.zerar();
  const userId = novoAluno(db);
  return { db, userId };
}

export const atendente = (userId, extra = {}) => ({ created_at: iso(Date.now() - HOUR), last_seen_at: iso(Date.now() - 10_000), session_id: SESSAO, status: "online", user_id: userId, ...extra });
