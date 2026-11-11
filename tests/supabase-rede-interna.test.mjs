import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { afterEach } from "node:test";

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

// O servidor do app no kit fala com o Supabase pela rede interna (docs/32 §11.7; src/server/db/supabase/internal-fetch.ts):
// com SUPABASE_INTERNAL_URL, o Auth, o PostgREST e o Storage vao ao gateway (http://api-gw:8000) sem passar pelo DNS
// nem pelo certificado do endereco publico. O cliente continua com o endereco publico: o nome do cookie da sessao, as URLs
// publicas do Storage e os links sao os que o navegador conhece. Sem a variavel (Vercel, dev, nossa producao), nada muda.
// Aqui roda o supabase-js e o @supabase/ssr de verdade, com o fetch global anotado.

const { createSupabaseInternalFetch, supabaseServerGlobalOptions } = await import("../src/server/db/supabase/internal-fetch.ts");

const PUBLICO = "https://api.escola.test";
const INTERNO = "http://api-gw:8000";
const fetchOriginal = globalThis.fetch;
let pedidos = [];

function anotarFetch() {
  pedidos = [];
  globalThis.fetch = async (entrada, opcoes = {}) => {
    const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const headers = new Headers(opcoes.headers ?? (entrada instanceof Request ? entrada.headers : undefined));
    pedidos.push({ url, method: opcoes.method ?? (entrada instanceof Request ? entrada.method : "GET"), authorization: headers.get("authorization"), apikey: headers.get("apikey") });
    if (url.includes("/auth/v1/user")) return Response.json({ id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", email: "aluna@escola.test" });
    if (url.includes("/auth/v1/admin/users")) return Response.json({ users: [], aud: "authenticated" });
    return Response.json([]);
  };
}

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  delete process.env.SUPABASE_INTERNAL_URL;
});

test("o fetch interno troca so o endereco publico do Supabase, na fronteira exata, e mantem o resto do pedido", async () => {
  const vistos = [];
  const base = async (entrada, opcoes) => {
    vistos.push({ entrada: entrada instanceof Request ? `Request ${entrada.method} ${entrada.url}` : String(entrada), opcoes });
    return new Response("ok");
  };
  const buscar = createSupabaseInternalFetch(`${PUBLICO}/`, ` ${INTERNO}/ `, base);
  await buscar(`${PUBLICO}/rest/v1/job_runs?select=id&limit=1`, { method: "GET", headers: { apikey: "chave" } });
  await buscar(new URL(`${PUBLICO}/auth/v1/user`));
  await buscar(new Request(`${PUBLICO}/storage/v1/object/avatars/a.webp`, { method: "POST", body: "conteudo" }));
  await buscar(`${PUBLICO}?x=1`);
  // Fora do endereco publico: igual, inclusive o host parecido e o mesmo host em http.
  await buscar("https://api.escola.test.outro.site/rest/v1/x");
  await buscar("http://api.escola.test/rest/v1/x");
  await buscar("https://i.ytimg.com/vi/abc/hqdefault.jpg");
  assert.deepEqual(vistos.map((v) => v.entrada), [
    `${INTERNO}/rest/v1/job_runs?select=id&limit=1`,
    `${INTERNO}/auth/v1/user`,
    `Request POST ${INTERNO}/storage/v1/object/avatars/a.webp`,
    `${INTERNO}?x=1`,
    "https://api.escola.test.outro.site/rest/v1/x",
    "http://api.escola.test/rest/v1/x",
    "https://i.ytimg.com/vi/abc/hqdefault.jpg"
  ]);
  assert.deepEqual(vistos[0].opcoes, { method: "GET", headers: { apikey: "chave" } });
  // O endereco interno com caminho (um proxy na frente, por exemplo) tambem vale.
  const comCaminho = createSupabaseInternalFetch(PUBLICO, "http://gw.interno:8000/supabase", base);
  await comCaminho(`${PUBLICO}/auth/v1/health`);
  assert.equal(vistos.at(-1).entrada, "http://gw.interno:8000/supabase/auth/v1/health");
});

test("sem endereco interno nada muda; endereco interno invalido para com a frase do que fazer", () => {
  for (const vazio of [undefined, null, "", "  \n"]) assert.equal(createSupabaseInternalFetch(PUBLICO, vazio), undefined);
  assert.deepEqual(supabaseServerGlobalOptions(PUBLICO), {});
  for (const errado of ["api-gw:8000", "ftp://api-gw:8000", "http://usuario:senha@api-gw:8000", "http://api-gw:8000/?x=1", "nao e endereco"]) {
    assert.throws(() => createSupabaseInternalFetch(PUBLICO, errado), /SUPABASE_INTERNAL_URL invalido: use http:\/\/host:porta ou https:\/\/host/, errado);
  }
  assert.throws(() => createSupabaseInternalFetch("api.escola.test", INTERNO), /NEXT_PUBLIC_SUPABASE_URL invalido/);
  process.env.SUPABASE_INTERNAL_URL = INTERNO;
  const a = supabaseServerGlobalOptions(PUBLICO);
  assert.equal(typeof a.fetch, "function");
  assert.equal(supabaseServerGlobalOptions(PUBLICO).fetch, a.fetch, "um fetch por par de enderecos, nao um por pedido");
});

test("cliente administrativo do supabase-js: Auth, PostgREST e Storage pela rede interna; URL publica do Storage continua publica", async () => {
  process.env.SUPABASE_INTERNAL_URL = INTERNO;
  anotarFetch();
  const cliente = createClient(PUBLICO, "sb_secret_teste", { auth: { autoRefreshToken: false, persistSession: false }, global: supabaseServerGlobalOptions(PUBLICO) });
  await cliente.from("job_runs").select("id").limit(1);
  await cliente.auth.admin.listUsers();
  await cliente.storage.from("avatars").list("aluno1");
  assert.deepEqual(pedidos.map((p) => new URL(p.url).origin), [INTERNO, INTERNO, INTERNO]);
  assert.match(pedidos[0].url, /^http:\/\/api-gw:8000\/rest\/v1\/job_runs\?select=id&limit=1$/);
  assert.match(pedidos[1].url, /^http:\/\/api-gw:8000\/auth\/v1\/admin\/users/);
  assert.match(pedidos[2].url, /^http:\/\/api-gw:8000\/storage\/v1\/object\/list\/avatars$/);
  for (const p of pedidos) assert.equal(p.apikey, "sb_secret_teste", "a chave segue no pedido");
  assert.equal(cliente.storage.from("avatars").getPublicUrl("aluno1/foto.webp").data.publicUrl, `${PUBLICO}/storage/v1/object/public/avatars/aluno1/foto.webp`);

  // Sem a variavel, o mesmo codigo vai ao endereco publico, como sempre.
  delete process.env.SUPABASE_INTERNAL_URL;
  anotarFetch();
  const semInterno = createClient(PUBLICO, "sb_secret_teste", { auth: { autoRefreshToken: false, persistSession: false }, global: supabaseServerGlobalOptions(PUBLICO) });
  await semInterno.from("job_runs").select("id").limit(1);
  assert.equal(new URL(pedidos[0].url).origin, PUBLICO);
});

test("sessao do @supabase/ssr: o cookie continua sb-<rotulo publico>-auth-token e o getUser vai pela rede interna", async () => {
  process.env.SUPABASE_INTERNAL_URL = INTERNO;
  anotarFetch();
  const agora = Math.floor(Date.now() / 1000);
  const sessao = {
    access_token: "token-de-acesso-da-aluna",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: agora + 3600,
    refresh_token: "renovacao",
    user: { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", email: "aluna@escola.test" }
  };
  const cookies = [{ name: "sb-api-auth-token", value: `base64-${Buffer.from(JSON.stringify(sessao)).toString("base64url")}` }];
  const lidos = [];
  const cliente = createServerClient(PUBLICO, "sb_publishable_teste", {
    cookies: {
      getAll() {
        lidos.push("getAll");
        return cookies;
      },
      setAll() {}
    },
    global: supabaseServerGlobalOptions(PUBLICO)
  });
  const { data, error } = await cliente.auth.getUser();
  assert.equal(error, null);
  assert.equal(data.user.email, "aluna@escola.test");
  const chamada = pedidos.find((p) => p.url.includes("/auth/v1/user"));
  assert.equal(chamada.url, `${INTERNO}/auth/v1/user`);
  assert.equal(chamada.authorization, "Bearer token-de-acesso-da-aluna", "a sessao saiu do cookie com o nome do endereco publico");
  assert.ok(lidos.length > 0);
});

test("os tres clientes do servidor passam o fetch interno; o do navegador nunca", () => {
  const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
  assert.match(ler("src/server/db/supabase/client.ts"), /global: supabaseServerGlobalOptions\(supabaseUrl\)/);
  assert.match(ler("src/server/auth/supabase.ts"), /global: supabaseServerGlobalOptions\(url\)/);
  assert.match(ler("src/proxy.ts"), /global: supabaseServerGlobalOptions\(supabaseUrl as string\)/);
  const navegador = ler("src/lib/supabase/browser.ts");
  assert.doesNotMatch(navegador, /SUPABASE_INTERNAL_URL|internal-fetch/);
  // Nenhum arquivo do navegador le a variavel (ela nao tem NEXT_PUBLIC_ e nem deve ter).
  assert.doesNotMatch(ler(".env.example"), /^NEXT_PUBLIC_SUPABASE_INTERNAL_URL=/m);
  assert.match(ler(".env.example"), /^SUPABASE_INTERNAL_URL=$/m);
});
