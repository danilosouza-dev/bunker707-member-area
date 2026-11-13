import { randomUUID } from "node:crypto";

// Banco em memoria dos testes de unidade dos webinarios (o desenho de tests/webinarios-gravacoes-job.test.mjs, de onde
// saiu em 13/11/2026 para tests/webinarios-replay-aula.test.mjs usar o mesmo): `from(tabela)` encadeia filtros (eq,
// neq, in, is, gt, gte, lt, lte; "coluna->>chave" le uma chave de jsonb), order, limit, maybeSingle e single, e aplica
// de verdade insert, upsert e update nas linhas de `tables`. `unique` diz a chave unica de cada tabela (uma funcao da
// linha; nulo = sem restricao): a segunda linha com a mesma chave volta 23505, como o Postgres. `falhar(tabela, op,
// erro, vezes)` faz as proximas chamadas daquela operacao voltarem o erro. Toda chamada fica em `calls`.

const iso = (time) => new Date(time).toISOString();

function compare(a, b) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

/** O valor da coluna; "coluna->>chave" le a chave de um jsonb como texto, como o PostgREST. */
function valueOf(row, column) {
  const path = /^([a-z_]+)->>([A-Za-z_]+)$/.exec(column);

  if (!path) return row[column];

  const value = row[path[1]]?.[path[2]];

  return value == null ? null : String(value);
}

function matches(row, [op, column, value]) {
  const current = valueOf(row, column);
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

export function bancoEmMemoria(seed = {}, { unique: UNIQUE = {} } = {}) {
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
      throw new Error("quem usa este banco nao chama RPC");
    },
    tables
  };
}
