import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import "./resolve-extensionless-ts.mjs";

// Carrega Server Actions do admin (src/server/catalog/*-actions.ts, src/server/member-area/*-actions.ts)
// no Node, sem Next e sem banco:
// - "@/..." aponta para src/ (como o tsconfig);
// - sessao, cliente do banco e cache do catalogo viram dublês controlados por `actionStubs`.
// Importe este modulo antes e carregue a action com import() dinamico.

const sourceRoot = new URL("../../src/", import.meta.url);

export const actionStubs = {
  /** Cliente do banco devolvido por getSupabaseAdminClient(). */
  db: null,
  invalidations: [],
  role: { role: "owner", user: { id: "00000000-0000-4000-8000-000000000001" } }
};

globalThis.__adminActionStubs = actionStubs;

function stubModule(source) {
  return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
}

const STUBS = {
  "@/server/auth/permissions": `export async function requireRole() { return globalThis.__adminActionStubs.role; } export async function requireScope() {}`,
  "@/server/catalog/cache": `export function invalidateCatalog(input) { globalThis.__adminActionStubs.invalidations.push(input); }`,
  // Area de membros: mesma lista de invalidacoes, com o alvo ("login" ou "home") junto.
  "@/server/member-area/cache": `export function invalidateMemberArea(target, input) { globalThis.__adminActionStubs.invalidations.push({ target, ...input }); }`,
  "@/server/db/supabase/client": `export function getSupabaseAdminClient() { return globalThis.__adminActionStubs.db; }`,
  "next/navigation": `export function unstable_rethrow() {} export function redirect() { throw new Error("redirect"); } export function notFound() { throw new Error("notFound"); }`,
  "server-only": ``
};

function resolveSourceAlias(specifier) {
  const path = fileURLToPath(new URL(specifier.slice(2), sourceRoot));

  for (const candidate of [path, `${path}.ts`, `${path}.tsx`, `${path}/index.ts`]) {
    if (/\.[cm]?[jt]sx?$/.test(candidate) && existsSync(candidate)) {
      return new URL(`file://${candidate}`).href;
    }
  }

  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(STUBS, specifier)) {
      return stubModule(STUBS[specifier]);
    }

    if (specifier.startsWith("@/")) {
      const url = resolveSourceAlias(specifier);

      if (url) {
        return { shortCircuit: true, url };
      }
    }

    // Next publica "next/headers" etc. como arquivos .js na raiz do pacote, sem "exports".
    if (/^next\/[a-z-]+$/.test(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }

    return nextResolve(specifier, context);
  }
});

/**
 * Banco falso com a superficie que as actions usam: from(tabela) encadeia filtros (eq e in filtram;
 * os demais passam) sobre `tables[tabela]` e registra a tabela; rpc(nome, args) registra a chamada e
 * devolve `rpcResults[nome]`. Escritas diretas (insert/update/delete/upsert) ficam em `calls.writes`.
 */
export function createFakeDb({ rpcResults = {}, tables = {} } = {}) {
  const calls = { from: [], rpc: [], writes: [] };

  function builder(table) {
    let rows = tables[table] ?? [];
    // Filtra so por colunas que a linha tem (caminhos JSON como settings->>x passam direto).
    const keep = (column, test) => {
      rows = rows.filter((row) => !(column in row) || test(row[column]));
      return chain;
    };
    const write = (op) => {
      calls.writes.push({ op, table });
      return chain;
    };
    const chain = {
      delete: () => write("delete"),
      eq: (column, value) => keep(column, (current) => current === value),
      in: (column, values) => keep(column, (current) => values.includes(current)),
      insert: () => write("insert"),
      limit: () => chain,
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      neq: () => chain,
      or: () => chain,
      order: () => chain,
      select: () => chain,
      then: (resolve, reject) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
      update: () => write("update"),
      upsert: () => write("upsert")
    };

    return chain;
  }

  return {
    calls,
    from(table) {
      calls.from.push(table);
      return builder(table);
    },
    async rpc(name, args) {
      calls.rpc.push({ args, name });
      return rpcResults[name] ?? { data: null, error: null };
    }
  };
}
