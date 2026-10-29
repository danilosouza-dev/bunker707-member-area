import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { actionStubs } from "./admin-action-stubs.mjs";

// Dubles da fase 4f (a traducao do chat e do roteiro; docs/30 §1.6; docs/18 §2.5) para os testes sem banco: a sessao
// do aluno das rotas (`sessaoDaTraducao.user`), o cliente do banco (o banco em memoria de `actionStubs.db`), o gateway
// de IA falso no lugar de src/server/ai/provider-pool.ts (`iaDaTraducao`: as conexoes ativas e a resposta combinada
// pelo teste; por padrao devolve "[EN] texto" no JSON pedido; nunca um provedor de verdade), o banco em memoria que
// entende as consultas das rotas da Sala e de translation-store.ts (filtros do PostgREST, ordem, limite, upsert por
// chave com ignoreDuplicates, as chaves unicas de webinar_text_translations e webinar_viewer_prefs como 23505), o banco
// "sem a 202610290009" (as tabelas novas respondem 42P01) e a escola de mentira: uma Live gravada no ar com a live de
// origem, uma sessao irma, um outro webinario e as mensagens do chat de cada caso. Importe este modulo antes de
// carregar o codigo de src/ com import().

export const sessaoDaTraducao = (globalThis.__traducaoSessao ??= { user: null });

/** O JSON que o gateway falso devolve por padrao: cada texto com o prefixo do idioma e o idioma de origem "pt". */
export function respostaPadrao(args) {
  const pedido = JSON.parse(args.messages[0].content);
  const alvo = /para (ingles|espanhol|portugues)/.exec(args.system)?.[1] ?? "ingles";
  const prefixo = { espanhol: "[ES]", ingles: "[EN]", portugues: "[PT]" }[alvo];
  return JSON.stringify({ items: pedido.items.map((item) => ({ i: item.i, lang: "pt", text: `${prefixo} ${item.text}` })) });
}

export const iaDaTraducao = (globalThis.__traducaoIa ??= {
  candidatos: [{ connectionId: "conexao-falsa", contextMaxCharacters: 20_000, model: "modelo-falso", provider: "openai" }],
  chamadas: [],
  responder: respostaPadrao,
  zerar() {
    this.candidatos = [{ connectionId: "conexao-falsa", contextMaxCharacters: 20_000, model: "modelo-falso", provider: "openai" }];
    this.chamadas = [];
    this.responder = respostaPadrao;
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
          const user = globalThis.__traducaoSessao.user;
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
        export async function listAIProviderRuntimeCandidates() { return [...globalThis.__traducaoIa.candidatos]; }
        export async function generateAITextWithFallback(args) {
          const ia = globalThis.__traducaoIa;
          ia.chamadas.push(args);
          const text = await ia.responder(args);
          return { attempts: [], config: args.candidates[0], generation: { gatewayRequestId: null, inputTokens: 1, outputTokens: 1, text } };
        }`);
    }
    return nextResolve(specifier, context);
  }
});

/* ------------------------------------------------------------------------------------------------
 * O banco em memoria
 * ---------------------------------------------------------------------------------------------- */

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const iso = (time) => new Date(time).toISOString();

export const WEBINAR = "cccccccc-0000-4000-8000-0000000000f1";
export const SESSION = "cccccccc-0000-4000-8000-0000000000f2";
export const LIVE_SESSION = "cccccccc-0000-4000-8000-0000000000f3";
export const SIBLING = "cccccccc-0000-4000-8000-0000000000f4";
export const OTHER_WEBINAR = "cccccccc-0000-4000-8000-0000000000f5";
export const OTHER_SESSION = "cccccccc-0000-4000-8000-0000000000f6";
export const RECORDING = "cccccccc-0000-4000-8000-0000000000f7";
export const AUTHOR = "77777777-0000-4000-8000-000000000001";

/** As mensagens da escola, pelo papel no teste. */
export const MSG = {
  /** Da propria sessao, em portugues: traduz. */
  turma: "dddddddd-0000-4000-8000-000000000001",
  /** Da linha mestre (a live de origem): traduz. */
  mestre: "dddddddd-0000-4000-8000-000000000002",
  /** O mesmo texto da `turma`, com outros espacos (outra linha do roteiro): a mesma chave. */
  repetida: "dddddddd-0000-4000-8000-000000000003",
  /** De outro webinario: nunca. */
  outroWebinario: "dddddddd-0000-4000-8000-000000000004",
  /** De uma sessao irma (nao jit, fora da linha mestre): nunca. */
  irma: "dddddddd-0000-4000-8000-000000000005",
  /** Pendente de outro aluno na moderacao: nunca. */
  pendente: "dddddddd-0000-4000-8000-000000000006",
  /** Apagada: nunca. */
  apagada: "dddddddd-0000-4000-8000-000000000007",
  /** Escrita em ingles (coluna language): em "en" passa como foi escrita. */
  emIngles: "dddddddd-0000-4000-8000-000000000008",
  /** So emoji: nada a traduzir. */
  emoji: "dddddddd-0000-4000-8000-000000000009"
};

export const TEXTO_TURMA = "Muito obrigado pela aula, você é demais";
export const TEXTO_MESTRE = "Bem-vindos à aula de agentes de IA";

const UNIQUE = {
  webinar_chat_consents: [["user_id"]],
  webinar_text_translations: [["source_hash", "language"]],
  webinar_viewer_prefs: [["user_id"]]
};
const NO_ID = new Set(["webinar_chat_consents", "webinar_text_translations", "webinar_viewer_prefs"]);

function defaultsOf(table) {
  switch (table) {
    case "student_events":
      return { entity_id: null, entity_type: null, metadata: {} };
    case "webinar_viewer_prefs":
      return { chat_language: null };
    case "webinar_text_translations":
      return { source_language: null };
    default:
      return {};
  }
}

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
      if (value === "in") return !String(extra).replace(/^\(|\)$/g, "").split(",").map(literal).includes(current);
      if (value === "eq") return current !== extra;
      return true;
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

/** O banco em memoria: `tables` muda no lugar; `calls` anota cada leitura (from) e escrita (writes). */
export function bancoDaTraducao({ tables = {} } = {}) {
  const calls = { from: [], rpc: [], writes: [] };
  const table = (name) => (tables[name] ??= []);

  function violates(name, row) {
    return (UNIQUE[name] ?? []).some((keys) => table(name).some((existing) => existing !== row && keys.every((key) => existing[key] === row[key])));
  }

  function query(name) {
    const state = { count: null, filters: [], head: false, ignoreDuplicates: false, limit: null, op: null, order: [], payload: null, range: null, single: null, upsertKeys: null };

    function stamp(row) {
      const now = iso(Date.now());
      const base = { ...defaultsOf(name) };
      if (!NO_ID.has(name)) base.id = randomUUID();
      return { ...base, created_at: now, updated_at: now, ...structuredClone(row) };
    }

    function finish(rows) {
      if (state.head) return { count: rows.length, data: null, error: null };
      if (state.single === "single") return rows[0] ? { data: structuredClone(rows[0]), error: null } : { data: null, error: { code: "PGRST116", message: "no rows" } };
      if (state.single === "maybe") return { data: rows[0] ? structuredClone(rows[0]) : null, error: null };
      return { count: state.count ? rows.length : null, data: structuredClone(rows), error: null };
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
            if (state.ignoreDuplicates) continue;
            Object.assign(existing, structuredClone(payload), { updated_at: iso(Date.now()) });
            touched.push(existing);
            continue;
          }
          const row = stamp(payload);
          if (violates(name, row)) {
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint (${name})` } };
          }
          rows.push(row);
          touched.push(row);
        }
        calls.writes.push({ op: state.op, payload: state.payload, table: name });
        return finish(touched);
      }
      if (state.op === "update") {
        const touched = filtered();
        touched.forEach((row) => Object.assign(row, structuredClone(state.payload), { updated_at: iso(Date.now()) }));
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
      select: (_columns, options) => {
        state.op ??= "select";
        if (options?.count) state.count = options.count;
        if (options?.head) state.head = true;
        return chain;
      },
      single: () => ((state.single = "single"), chain),
      then: (resolve, reject) => Promise.resolve().then(run).then(resolve, reject),
      update: (payload) => ((state.op = "update"), (state.payload = payload), chain),
      upsert: (payload, options) => (
        (state.op = "upsert"), (state.payload = payload), (state.upsertKeys = (options?.onConflict ?? "id").split(",")), (state.ignoreDuplicates = Boolean(options?.ignoreDuplicates)), chain
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
      return { then: (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject) };
    },
    tables
  };
}

/** Um banco em que as tabelas da traducao ainda nao existem (a 202610290009 pendente): 42P01 em qualquer leitura delas. */
export function semAsTabelasDaTraducao(db) {
  const from = db.from.bind(db);
  db.from = (name) => {
    if (name === "webinar_text_translations" || name === "webinar_viewer_prefs") {
      db.calls.from.push(name);
      const erro = { data: null, error: { code: "42P01", message: `relation "public.${name}" does not exist` } };
      const chain = new Proxy({}, { get: (_target, property) => (property === "then" ? (resolve) => resolve(erro) : () => chain) });
      return chain;
    }
    return from(name);
  };
  return db;
}

/* ------------------------------------------------------------------------------------------------
 * A escola de mentira
 * ---------------------------------------------------------------------------------------------- */

function mensagem(id, extra = {}) {
  const now = Date.now();
  return {
    approved: true,
    approved_at: null,
    approved_by: null,
    author_user_id: AUTHOR,
    body: TEXTO_TURMA,
    created_at: iso(now - 5 * MIN),
    deleted_at: null,
    deleted_by: null,
    deleted_reason: null,
    display_name: "Ana S.",
    id,
    kind: "message",
    language: null,
    master: false,
    offset_ms: 60_000,
    pinned_at: null,
    reply_to_id: null,
    role: "student",
    script_item_id: null,
    session_id: SESSION,
    source: "audience",
    webinar_id: WEBINAR,
    ...extra
  };
}

/** As tabelas da escola: a sessao gravada no ar ha 10 min, a live de origem, a irma, o outro webinario e as mensagens. */
export function escolaDaTraducao({ mensagens = null } = {}) {
  const now = Date.now();
  const webinarRow = (id) => ({
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
    updated_at: iso(now - HOUR)
  });
  const sessionRow = (id, extra = {}) => ({
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
    recording_anchor_at: null,
    recording_id: RECORDING,
    scheduled_at: iso(now - 10 * MIN),
    script_fired_at: null,
    show_live_badge: false,
    simulation_ack_text: null,
    simulation_decided_at: null,
    simulation_decided_by: null,
    source_session_id: LIVE_SESSION,
    started_at: null,
    status: "live",
    updated_at: iso(now - HOUR),
    webinar_id: WEBINAR,
    ...extra
  });
  return {
    admin_roles: [],
    entitlements: [],
    profiles: [],
    student_events: [],
    webinar_chat_messages: mensagens ?? [
      mensagem(MSG.turma),
      mensagem(MSG.mestre, { author_user_id: null, body: TEXTO_MESTRE, display_name: "Equipe", master: true, offset_ms: 30_000, role: "team", session_id: LIVE_SESSION, source: "live" }),
      mensagem(MSG.repetida, { author_user_id: null, body: `  Muito  obrigado pela aula,\n você é demais `, display_name: "Bia", source: "scripted" }),
      mensagem(MSG.outroWebinario, { body: "Mensagem de outra live sobre agentes, muito boa", session_id: OTHER_SESSION, webinar_id: OTHER_WEBINAR }),
      mensagem(MSG.irma, { body: "Comentario da outra turma, muito bom mesmo", session_id: SIBLING }),
      mensagem(MSG.pendente, { approved: false, body: "Pergunta ainda na moderacao, voce pode ver?" }),
      mensagem(MSG.apagada, { body: "Mensagem que a equipe apagou da aula", deleted_at: iso(now - MIN) }),
      mensagem(MSG.emIngles, { body: "Thank you for the class, this is great", language: "en" }),
      mensagem(MSG.emoji, { body: "👏👏👏" })
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
        id: RECORDING,
        provider: "bunny",
        purge_due_at: null,
        session_id: LIVE_SESSION,
        sha256: null,
        size_bytes: null,
        source: "upload",
        status: "ready",
        updated_at: iso(now - HOUR),
        webinar_id: WEBINAR
      }
    ],
    webinar_registrations: [],
    webinar_sessions: [
      sessionRow(SESSION),
      sessionRow(LIVE_SESSION, { kind: "live", recording_anchor_at: iso(now - 30 * 24 * HOUR), scheduled_at: iso(now - 30 * 24 * HOUR), source_session_id: null, status: "ended" }),
      sessionRow(SIBLING, { scheduled_at: iso(now - 3 * HOUR) }),
      sessionRow(OTHER_SESSION, { webinar_id: OTHER_WEBINAR })
    ],
    webinar_text_translations: [],
    webinar_user_bans: [],
    webinar_viewer_prefs: [],
    webinars: [webinarRow(WEBINAR), webinarRow(OTHER_WEBINAR)]
  };
}

/** Monta o banco da escola e o liga as rotas (getSupabaseAdminClient). */
export function montarBanco(opcoes = {}) {
  const db = bancoDaTraducao({ tables: escolaDaTraducao(opcoes) });
  actionStubs.db = db;
  return db;
}

export { mensagem };
