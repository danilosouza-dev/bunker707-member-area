// Dublê do banco para o follow-up por segmento (docs/30 §1.6, fase 4b) e o carregador de fatos da Comunicacao, sem
// rede (docs/18 §2.5): select, eq, neq, in, is, gt, gte, lt, lte, order, range, limit, maybeSingle e single filtram e
// ordenam de verdade, `count: "exact"` devolve o total e toda resposta para em 1000 linhas (o teto do PostgREST, que
// tambem corta RPC). As RPCs devolvem as linhas dadas (os filtros e a ordem valem sobre elas) ou um erro; cada consulta
// fica anotada (fonte, colunas, argumentos da RPC, tamanho de cada `in`, range). Nada aqui e importado por src/.

export const PG_TETO = 1000;

export function memoryDb(tables = {}, rpcs = {}) {
  const log = [];

  function query(source, rows, extra = {}) {
    const state = { columns: "", count: false, filters: [], ins: [], limit: Infinity, order: [], range: null };
    const run = () => {
      const entry = { args: extra.args, columns: state.columns, ins: state.ins, order: state.order, range: state.range, source };
      log.push(entry);

      if (extra.error) {
        return { count: null, data: null, error: extra.error };
      }

      let result = rows.filter((row) => state.filters.every((keep) => keep(row)));

      for (const [column, ascending] of [...state.order].reverse()) {
        result = [...result].sort((left, right) => (left[column] < right[column] ? -1 : left[column] > right[column] ? 1 : 0) * (ascending ? 1 : -1));
      }

      const total = result.length;

      if (state.range) {
        result = result.slice(state.range[0], state.range[1] + 1);
      }

      result = result.slice(0, Math.min(state.limit, PG_TETO));

      return { count: state.count ? total : null, data: result, error: null };
    };
    const api = {
      eq: (column, value) => (state.filters.push((row) => row[column] === value), api),
      gt: (column, value) => (state.filters.push((row) => row[column] > value), api),
      gte: (column, value) => (state.filters.push((row) => row[column] >= value), api),
      in: (column, values) => (state.ins.push({ column, size: values.length }), state.filters.push((row) => values.includes(row[column])), api),
      is: (column, value) => (state.filters.push((row) => (row[column] ?? null) === value), api),
      limit: (value) => ((state.limit = value), api),
      lt: (column, value) => (state.filters.push((row) => row[column] < value), api),
      lte: (column, value) => (state.filters.push((row) => row[column] <= value), api),
      maybeSingle: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      neq: (column, value) => (state.filters.push((row) => row[column] !== value), api),
      not: () => api,
      or: () => api,
      order: (column, options) => (state.order.push([column, options?.ascending !== false]), api),
      range: (from, to) => ((state.range = [from, to]), api),
      select: (columns, options) => ((state.columns = columns ?? ""), (state.count = options?.count === "exact"), api),
      single: async () => {
        const result = run();
        return { data: result.data?.[0] ?? null, error: result.error };
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject)
    };

    return api;
  }

  return {
    from: (table) => query(table, tables[table] ?? []),
    log,
    rpc: (name, args) => {
      const spec = rpcs[name];
      const isError = spec && !Array.isArray(spec) && spec.error;

      return query(`rpc:${name}`, isError ? [] : (spec ?? []), { args, error: isError ? spec.error : null });
    }
  };
}

export const consultas = (db, source) => db.log.filter((entry) => entry.source === source);

/** Uma linha de webinar_follow_up_facts (tudo falso menos o que vier em `fatos`). */
export function fatoDoWebinario(webinarId, userId, fatos = {}) {
  return {
    attended: false,
    clicked: false,
    left_before_offer: false,
    offer_seen: false,
    purchased: false,
    registered: false,
    user_id: userId,
    watched_replay: false,
    webinar_id: webinarId,
    ...fatos
  };
}

/** Uma escola minima para o carregador de fatos: `total` alunos com perfil e acesso a curso-a; `equipe` em admin_roles. */
export function escolaMinima({ equipe = [], total }) {
  const uid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const profiles = [];
  const entitlements = [];

  for (let index = 1; index <= total; index += 1) {
    profiles.push({ avatar_url: null, created_at: "2026-04-01T12:00:00.000Z", email: null, full_name: `Aluno ${index}`, id: uid(index), last_sign_in_at: null, phone: null });
    entitlements.push({
      created_at: "2026-09-01T12:00:00.000Z",
      ends_at: null,
      id: `e${index}`,
      starts_at: "2026-09-01T12:00:00.000Z",
      status: "active",
      target_id: "curso-a",
      target_type: "content",
      user_id: uid(index)
    });
  }

  return {
    tables: {
      admin_roles: equipe.map((index) => ({ user_id: uid(index) })),
      cohort_memberships: [],
      course_modules: [],
      entitlements,
      lesson_progress: [],
      lessons: [],
      profiles
    },
    uid
  };
}
