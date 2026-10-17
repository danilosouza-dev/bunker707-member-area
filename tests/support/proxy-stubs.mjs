import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import "./resolve-extensionless-ts.mjs";

// Carrega o proxy do app (src/proxy.ts) no Node, sem Next rodando e sem Supabase:
// - "@/..." aponta para src/ (como o tsconfig);
// - "@supabase/ssr" vira um cliente falso que anota cada createServerClient(), getUser() e getClaims()
//   em `proxyStubs`, para o teste afirmar quando o proxy consulta (ou nao) o Supabase Auth;
// - "next/server" e resolvido como arquivo .js (o pacote nao tem "exports").
// Importe este modulo antes e carregue o proxy e o NextRequest com import() dinamico.

const sourceRoot = new URL("../../src/", import.meta.url);

export const proxyStubs = {
  /** O que getClaims() devolve (claims validas ou nulas). */
  claimsResult: { data: null, error: new Error("Auth claims failed") },
  /** Cada createServerClient(): { key, url } recebidos. */
  clients: [],
  /** Cada chamada ao Auth: "getClaims" ou "getUser". */
  authCalls: [],
  /** O que getUser() devolve (usuario ou nulo). */
  userResult: { data: { user: null }, error: new Error("Auth session missing") },
  reset() {
    this.claimsResult = { data: null, error: new Error("Auth claims failed") };
    this.clients = [];
    this.authCalls = [];
    this.userResult = { data: { user: null }, error: new Error("Auth session missing") };
  }
};

globalThis.__proxyStubs = proxyStubs;

const supabaseSsrStub = `
export function createServerClient(url, key) {
  const stubs = globalThis.__proxyStubs;
  stubs.clients.push({ key, url });

  return {
    auth: {
      async getClaims() {
        stubs.authCalls.push("getClaims");
        return stubs.claimsResult;
      },
      async getUser() {
        stubs.authCalls.push("getUser");
        return stubs.userResult;
      }
    },
    from() {
      const chain = {
        eq: () => chain,
        maybeSingle: async () => ({ data: null, error: null }),
        select: () => chain
      };
      return chain;
    }
  };
}
`;

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
    if (specifier === "@supabase/ssr") {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(supabaseSsrStub)}` };
    }

    if (specifier.startsWith("@/")) {
      const url = resolveSourceAlias(specifier);

      if (url) {
        return { shortCircuit: true, url };
      }
    }

    // Next publica "next/server" etc. como arquivos .js na raiz do pacote, sem "exports".
    if (/^next\/[a-z-]+$/.test(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }

    return nextResolve(specifier, context);
  }
});
