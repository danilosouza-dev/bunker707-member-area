import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import "./resolve-extensionless-ts.mjs";

// Carrega o codigo do servidor (rotas /api, platform-store, regras de acesso) no Node, sem Next, mas
// com o banco LOCAL de verdade (docs/18 §2.5). So tres coisas sao trocadas:
// - "@/..." aponta para src/ (como o tsconfig);
// - a sessao (src/server/auth/session.ts) vira integration-session.mjs, controlada por `actAs` ou
//   `actAsSignedIn` (login real no Auth local, para o codigo que grava com a sessao do aluno);
// - "server-only", "next/navigation" e "next/cache" viram dubles inofensivos (nao ha request do Next aqui;
//   a invalidacao de cache fica anotada em integration-next-cache.mjs).
// Importe este modulo antes e carregue o codigo do app com import() dinamico.

const sourceRoot = new URL("../../src/", import.meta.url);
const sessionStubUrl = new URL("./integration-session.mjs", import.meta.url).href;
const supabaseSessionStubUrl = new URL("./integration-supabase-session.mjs", import.meta.url).href;
const nextCacheStubUrl = new URL("./integration-next-cache.mjs", import.meta.url).href;

export { actAs, actAsSignedIn, integrationSession } from "./integration-session.mjs";

function stubModule(source) {
  return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(source)}` };
}

const STUBS = {
  "next/navigation": `export function unstable_rethrow() {} export function redirect(path) { throw new Error("redirect:" + path); } export function notFound() { throw new Error("notFound"); }`,
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
    if (specifier === "@/server/auth/session") {
      return { shortCircuit: true, url: sessionStubUrl };
    }

    // O cliente "com a sessao do aluno" (cookies do request no app) vem do login feito por actAsSignedIn.
    if (specifier === "@/server/auth/supabase") {
      return { shortCircuit: true, url: supabaseSessionStubUrl };
    }

    // Invalidacao de cache do Next (revalidatePath etc.) so existe dentro de um request: vira anotacao.
    if (specifier === "next/cache") {
      return { shortCircuit: true, url: nextCacheStubUrl };
    }

    if (Object.hasOwn(STUBS, specifier)) {
      return stubModule(STUBS[specifier]);
    }

    if (specifier.startsWith("@/")) {
      const url = resolveSourceAlias(specifier);

      if (url) {
        return { shortCircuit: true, url };
      }
    }

    // Next publica "next/headers", "next/server" etc. como arquivos .js na raiz do pacote, sem "exports".
    if (/^next\/[a-z-]+$/.test(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }

    return nextResolve(specifier, context);
  }
});
