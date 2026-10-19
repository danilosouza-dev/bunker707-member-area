import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { proxyStubs } from "./support/proxy-stubs.mjs";

// Sessao nas paginas de conteudo do aluno (src/server/auth/session.ts e guards.ts; docs/06). No teste de
// carga de 19/10/2026 cada pagina ainda confirmava o usuario no Auth (getUser: uma chamada HTTP e 5
// consultas no banco), mesmo com o proxy ja validando o JWT pelos claims. Com AUTH_SESSION_STRATEGY=claims
// as paginas de conteudo usam so getClaims (assinatura pelo JWKS em cache); admin, compras, perfil,
// suporte e troca de senha seguem confirmando no Auth. Cliente do Supabase falso (proxy-stubs) que anota
// cada getClaims/getUser.

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-publica-de-teste";

const STUBS = {
  "next/headers": `export async function cookies() { return { getAll: () => [], set() {} }; } export async function headers() { return new Headers(); }`,
  "next/navigation": `export function redirect(path) { throw new Error("redirect:" + path); }`,
  "server-only": ``
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (Object.hasOwn(STUBS, specifier)) {
      return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(STUBS[specifier])}` };
    }

    return nextResolve(specifier, context);
  }
});

const { getSessionUser } = await import("../src/server/auth/session.ts");
const { requirePageUser, requireStudentPageUser } = await import("../src/server/auth/guards.ts");

const ALUNA_ID = "00000000-0000-4000-8000-000000000081";
const claimsDaAluna = {
  data: {
    claims: {
      app_metadata: { provider: "email" },
      email: "aluna@bunker707.test",
      role: "authenticated",
      sub: ALUNA_ID,
      user_metadata: { full_name: "Aluna Claims" }
    }
  },
  error: null
};
const usuarioDoAuth = { data: { user: { app_metadata: {}, aud: "authenticated", created_at: "2026-01-01T00:00:00Z", email: "aluna@bunker707.test", id: ALUNA_ID, user_metadata: {} } }, error: null };

test.beforeEach(() => {
  proxyStubs.reset();
  delete process.env.AUTH_SESSION_STRATEGY;
});

test("com claims, pagina de conteudo valida pelo JWT e nunca chama o Auth", async () => {
  process.env.AUTH_SESSION_STRATEGY = "claims";
  proxyStubs.claimsResult = claimsDaAluna;

  const user = await requireStudentPageUser("/conteudo/curso-ia");

  assert.deepEqual(user, {
    app_metadata: { provider: "email" },
    email: "aluna@bunker707.test",
    id: ALUNA_ID,
    user_metadata: { full_name: "Aluna Claims" }
  });
  assert.deepEqual(proxyStubs.authCalls, ["getClaims"]);
});

test("com claims, JWT invalido ou sem sub manda para o login com o caminho de volta, sem cair no getUser", async () => {
  process.env.AUTH_SESSION_STRATEGY = "claims";

  for (const claimsResult of [
    { data: null, error: new Error("invalid JWT") },
    { data: { claims: { role: "anon" } }, error: null }
  ]) {
    proxyStubs.reset();
    proxyStubs.claimsResult = claimsResult;

    await assert.rejects(requireStudentPageUser("/conteudo/curso-ia/aulas/m1"), {
      message: "redirect:/login?next=%2Fconteudo%2Fcurso-ia%2Faulas%2Fm1"
    });
    assert.deepEqual(proxyStubs.authCalls, ["getClaims"]);
  }
});

test("paginas que confirmam a conta (compras, perfil, suporte, troca de senha) seguem no getUser mesmo com claims", async () => {
  process.env.AUTH_SESSION_STRATEGY = "claims";
  proxyStubs.claimsResult = claimsDaAluna;
  proxyStubs.userResult = usuarioDoAuth;

  const user = await requirePageUser("/minhas-compras");

  assert.equal(user.created_at, "2026-01-01T00:00:00Z");
  assert.deepEqual(proxyStubs.authCalls, ["getUser"]);
});

test("sem AUTH_SESSION_STRATEGY=claims a pagina de conteudo confirma no Auth, como antes", async () => {
  proxyStubs.claimsResult = claimsDaAluna;
  proxyStubs.userResult = usuarioDoAuth;

  const user = await getSessionUser();

  assert.equal(user?.id, ALUNA_ID);
  assert.deepEqual(proxyStubs.authCalls, ["getUser"]);
});

test("quais paginas usam a sessao pelos claims e quais confirmam no Auth", () => {
  const read = (path) => readFileSync(new URL(`../src/app/${path}`, import.meta.url), "utf8");
  const conteudo = {
    "conteudo/[id]/aulas/[moduleId]/page.tsx": "/conteudo/${id}/aulas/${moduleId}",
    "conteudo/[id]/page.tsx": "/conteudo/${id}",
    "continue-assistindo/page.tsx": "/continue-assistindo",
    "favoritos/page.tsx": "/favoritos",
    "materiais/page.tsx": "/materiais",
    "minha-jornada/page.tsx": "/minha-jornada",
    "page.tsx": "/"
  };

  for (const [page, route] of Object.entries(conteudo)) {
    const source = read(page);
    assert.ok(source.includes(`requireStudentPageUser(${route.includes("$") ? `\`${route}\`` : `"${route}"`})`), page);
    assert.doesNotMatch(source, /\brequirePageUser\(|getAuthenticatedUser/, page);
  }

  for (const page of ["minhas-compras/page.tsx", "perfil/page.tsx", "suporte/page.tsx"]) {
    assert.match(read(page), /\brequirePageUser\(/, page);
    assert.doesNotMatch(read(page), /requireStudentPageUser/, page);
  }
  assert.match(read("alterar-senha/page.tsx"), /getAuthenticatedUser|requirePageUser/);
  assert.doesNotMatch(readFileSync(new URL("../src/server/auth/guards.ts", import.meta.url), "utf8").match(/export async function requirePageAdmin[\s\S]*?\n}/)[0], /requireStudentPageUser|getSessionUser/, "admin confirma no Auth");
});
