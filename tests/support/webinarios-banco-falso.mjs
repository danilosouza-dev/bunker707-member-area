// Banco falso dos webinarios para os testes sem banco (docs/18 §2.5), a mesma ideia de tests/webinarios-lembretes.test.mjs
// (e de tests/comunicacao-job.test.mjs): cada consulta (from ou rpc) e anotada com a operacao, o que foi gravado e os
// filtros, e a resposta vem de `respond(consulta)`. `bancoDosWebinarios` guarda webinarios, sessoes, gravacoes, vagas,
// enquetes, perguntas, roteiro, amostras e o historico em memoria, aplica os filtros das consultas e imita as RPCs da
// migracao 202610290001 (abrir e encerrar a sessao mudam a linha; o relatorio e a lista por aluno devolvem o que o
// teste passou). Nada aqui e importado por src/.

export function scriptedDb(respond) {
  const queries = [];

  function chain(query) {
    return new Proxy(
      {},
      {
        get(_target, property) {
          if (property === "then") {
            return (resolve, reject) => Promise.resolve(respond(query)).then(resolve, reject);
          }

          return (...args) => {
            if (["delete", "insert", "select", "update", "upsert"].includes(property) && !query.op) {
              query.op = property;
              query.payload = args[0];
            } else {
              query.filters.push([property, ...args]);
            }

            return chain(query);
          };
        }
      }
    );
  }

  return {
    queries,
    from(table) {
      const query = { filters: [], op: null, payload: undefined, table };
      queries.push(query);
      return chain(query);
    },
    rpc(name, args) {
      const query = { args, filters: [], op: "rpc", payload: undefined, table: name };
      queries.push(query);
      return chain(query);
    }
  };
}

/** Um filtro do PostgREST sobre uma linha em memoria (eq, in, is, gt, gte, lt, lte e o `or` de session_id). */
export function casa(row, [metodo, coluna, valor]) {
  switch (metodo) {
    case "eq":
      return row[coluna] === valor;
    case "neq":
      return row[coluna] !== valor;
    case "in":
      return valor.includes(row[coluna]);
    case "is":
      return valor === null ? row[coluna] == null : row[coluna] === valor;
    case "gt":
      return row[coluna] > valor;
    case "gte":
      return row[coluna] >= valor;
    case "lt":
      return row[coluna] < valor;
    case "lte":
      return row[coluna] <= valor;
    case "or":
      return String(coluna)
        .split(",")
        .some((parte) => {
          const [col, op, val] = parte.split(".");
          return op === "eq" ? row[col] === val : row[col] == null;
        });
    default:
      return true;
  }
}

export const aplicaFiltros = (rows, filters) => rows.filter((row) => filters.every((filtro) => casa(row, filtro)));
export const filterOf = (query, name) => query.filters.find(([method]) => method === name);
export const tabelas = (db, desde = 0) => db.queries.slice(desde).map((query) => `${query.table}:${query.op}`);

export const CRIADO = "2026-10-28T12:00:00.000Z";
export const WEBINAR_ID = "aaaaaaaa-1111-4111-8111-111111111111";
export const SESSAO_ID = "bbbbbbbb-2222-4222-8222-222222222222";
export const GRAVACAO_ID = "99999999-2222-4222-8222-222222222299";
export const ALUNA = "cccccccc-3333-4333-8333-333333333333";
export const ALUNO = "dddddddd-4444-4444-8444-444444444444";
export const EQUIPE = "eeeeeeee-5555-4555-8555-555555555555";

export function webinarRow(extra = {}) {
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
    created_at: CRIADO,
    created_by: null,
    deleted_at: null,
    description: null,
    duration_minutes: 60,
    host_user_id: null,
    id: WEBINAR_ID,
    kind: "simulated",
    product_id: null,
    published_at: CRIADO,
    quality: {},
    recording_retention_days: 730,
    registration_required: true,
    reminder_texts: {},
    reminders: { email: true, h1: true, h24: true },
    replay_days_on_home: 7,
    replay_lesson_target: null,
    room_settings: {},
    scheduled_at: null,
    show_banner: true,
    show_on_home: true,
    show_registered_count: false,
    slug: "live-de-agentes",
    status: "published",
    title: "Live de agentes",
    updated_at: CRIADO,
    ...extra
  };
}

export function sessaoRow(extra = {}) {
  return {
    chat_mode: "open",
    chat_slow_mode_seconds: null,
    created_at: CRIADO,
    ended_at: null,
    id: SESSAO_ID,
    kind: "simulated",
    late_join_minutes: null,
    pinned_message_id: null,
    presence_curve: null,
    recording_anchor_at: null,
    recording_id: GRAVACAO_ID,
    scheduled_at: "2026-11-05T23:00:00.000Z",
    script_fired_at: null,
    show_live_badge: false,
    simulation_ack_text: null,
    simulation_decided_at: null,
    simulation_decided_by: null,
    source_session_id: null,
    started_at: null,
    status: "scheduled",
    updated_at: CRIADO,
    webinar_id: WEBINAR_ID,
    ...extra
  };
}

export function gravacaoRow(extra = {}) {
  return {
    anchor_offset_ms: 0,
    bunny_library_id: "1",
    bunny_video_id: "abc",
    created_at: CRIADO,
    duration_seconds: 1800,
    embed_url: "https://iframe.mediadelivery.net/embed/1/abc",
    error_message: null,
    file_name: null,
    id: GRAVACAO_ID,
    provider: "bunny",
    purge_due_at: null,
    session_id: null,
    sha256: null,
    size_bytes: null,
    source: "bunny",
    status: "ready",
    updated_at: CRIADO,
    webinar_id: WEBINAR_ID,
    ...extra
  };
}

/** Vaga da sessao (session_id) ou geral do webinario (session_id nulo). */
export function vagaRow(userId, extra = {}) {
  return {
    calendar_token: `token-${userId.slice(0, 8)}`,
    cancelled_at: null,
    cancelled_notice_sent_at: null,
    created_at: CRIADO,
    id: `ffffffff-0000-4000-8000-${userId.slice(0, 12)}`,
    registered_at: CRIADO,
    reminder_1h_sent_at: null,
    reminder_24h_sent_at: null,
    session_id: SESSAO_ID,
    source: null,
    source_campaign_id: null,
    started_notice_sent_at: null,
    status: "registered",
    updated_at: CRIADO,
    user_id: userId,
    webinar_id: WEBINAR_ID,
    ...extra
  };
}

export const perfil = (id, email, full_name) => ({ avatar_url: null, created_at: CRIADO, email, full_name, id, last_sign_in_at: null, phone: null });
export const perfis = [perfil(ALUNA, "ana@exemplo.test", "Ana Souza"), perfil(ALUNO, "bruno@exemplo.test", "Bruno Lima")];

/** O resumo que webinar_close_session congela (presence_curve), com numeros simples. */
export function resumoDePresenca(extra = {}) {
  return {
    avgPresent: 1.5,
    bucketSeconds: 30,
    buckets: [
      { b: 0, n: 2 },
      { b: 1, n: 2 },
      { b: 2, n: 1 }
    ],
    durationMs: 1_800_000,
    frozenAt: "2026-11-05T23:31:00.000Z",
    peak: { b: 0, n: 2 },
    reachedEnd: 1,
    unique: 2,
    watchAvg: 900,
    watchMax: 1800,
    ...extra
  };
}

let replayCounter = 0;

/**
 * O banco dos webinarios em memoria. As RPCs imitam a migracao: `webinar_open_session` poe a sessao em live
 * (started_at = hora marcada na gravada) e devolve { changed, fired, status }; `webinar_close_session` poe ended,
 * grava presence_curve e devolve o resumo; `webinar_report` e `webinar_attendees` devolvem `relatorio` e `presentes`.
 * `replayDuplicado` faz o insert do replay bater no indice unico (23505); `abrir`/`encerrar` trocam as RPCs.
 */
export function bancoDosWebinarios({
  abrir = null,
  encerrar = null,
  enquetes = [],
  equipe = [],
  eventos = [],
  gravacoes = [gravacaoRow()],
  opcoes = [],
  perfis: contatos = perfis,
  perguntas = [],
  presentes = [],
  relatorio = [],
  replayDuplicado = false,
  resumo = resumoDePresenca(),
  roteiro = [],
  sessoes = [sessaoRow()],
  vagas = [],
  webinars = [webinarRow()]
} = {}) {
  const estado = {
    gravacoes: gravacoes.map((row) => ({ ...row })),
    sessoes: sessoes.map((row) => ({ ...row })),
    vagas: vagas.map((row) => ({ ...row }))
  };
  const db = scriptedDb((query) => {
    const single = query.filters.some(([method]) => method === "maybeSingle" || method === "single");
    const le = (rows) => {
      const achadas = aplicaFiltros(rows, query.filters);
      return { data: single ? (achadas[0] ?? null) : achadas, error: null };
    };
    const grava = (rows) => {
      const achadas = aplicaFiltros(rows, query.filters);
      achadas.forEach((row) => Object.assign(row, query.payload));
      return achadas;
    };

    switch (`${query.table}:${query.op}`) {
      case "webinar_sessions:select":
        return le([...estado.sessoes].sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at)));
      case "webinar_sessions:update":
        return { data: grava(estado.sessoes), error: null };
      case "webinar_sessions:insert": {
        if (replayDuplicado) {
          return { data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "webinar_sessions_replay_idx"' } };
        }
        replayCounter += 1;
        const row = sessaoRow({ ...query.payload, created_at: query.payload.scheduled_at, id: `77777777-0000-4000-8000-${String(replayCounter).padStart(12, "0")}`, updated_at: query.payload.scheduled_at });
        estado.sessoes.push(row);
        return { data: single ? row : [row], error: null };
      }
      case "webinars:select":
        return le(webinars);
      case "webinar_recordings:select":
        return le(estado.gravacoes);
      case "webinar_registrations:select":
        return le(estado.vagas);
      case "webinar_registrations:update":
        return { data: grava(estado.vagas).map((row) => ({ id: row.id })), error: null };
      case "admin_roles:select":
        return { data: equipe.map((user_id) => ({ user_id })), error: null };
      case "profiles:select":
        return le(contatos);
      case "student_events:select":
        return le(eventos);
      case "webinar_polls:select":
        return le(enquetes);
      case "webinar_poll_options:select":
        return le(opcoes);
      case "webinar_questions:select":
        return le(perguntas);
      case "webinar_chat_script_items:select":
        return le(roteiro);
      case "job_runs:update":
        return { data: null, error: null };
      case "webinar_open_session:rpc": {
        if (abrir) {
          return abrir(query.args, estado);
        }
        const sessao = estado.sessoes.find((row) => row.id === query.args.p_session_id);
        if (!sessao) {
          return { data: null, error: { code: "P0002", message: `webinar session ${query.args.p_session_id} not found` } };
        }
        if (sessao.status === "ended" || sessao.status === "cancelled") {
          return { data: { changed: false, fired: 0, status: sessao.status }, error: null };
        }
        const changed = sessao.status !== "live";
        const fired = sessao.script_fired_at ? 0 : roteiro.filter((item) => item.status === "ready" && item.trigger_kind !== "manual").length;
        Object.assign(sessao, {
          script_fired_at: sessao.script_fired_at ?? query.args.p_now,
          started_at: sessao.started_at ?? (sessao.kind === "simulated" ? sessao.scheduled_at : query.args.p_now),
          status: "live"
        });
        return { data: { changed, fired, status: "live" }, error: null };
      }
      case "webinar_close_session:rpc": {
        if (encerrar) {
          return encerrar(query.args, estado);
        }
        const sessao = estado.sessoes.find((row) => row.id === query.args.p_session_id);
        if (!sessao) {
          return { data: null, error: { code: "P0002", message: `webinar session ${query.args.p_session_id} not found` } };
        }
        const congelado = { ...resumo, frozenAt: query.args.p_now };
        Object.assign(sessao, { ended_at: sessao.ended_at ?? query.args.p_now, presence_curve: congelado, status: sessao.status === "cancelled" ? "cancelled" : "ended" });
        return { data: congelado, error: null };
      }
      case "webinar_report:rpc":
        return { data: typeof relatorio === "function" ? relatorio(query.args) : relatorio, error: null };
      case "webinar_attendees:rpc":
        return { data: presentes, error: null };
      default:
        return { data: null, error: null };
    }
  });

  return Object.assign(db, { estado });
}

export const sinos = (db) => db.queries.filter((query) => query.table === "notifications" && query.op === "upsert").flatMap((query) => query.payload);
export const rpcs = (db, name) => db.queries.filter((query) => query.op === "rpc" && query.table === name);
export const contexto = (supabase, now, extra = {}) => ({ runId: "run", signal: new AbortController().signal, supabase, tickRunId: "tick", tickStartedAt: now, ...extra });

/** Roda `fn` com console[metodo] capturado; devolve [resultado, linhas]. */
export async function silenciando(metodo, fn) {
  const linhas = [];
  const original = console[metodo];
  console[metodo] = (...args) => linhas.push(args.join(" "));

  try {
    return [await fn(), linhas];
  } finally {
    console[metodo] = original;
  }
}
