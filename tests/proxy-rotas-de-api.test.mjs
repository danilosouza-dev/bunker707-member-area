import assert from "node:assert/strict";
import test from "node:test";
import { proxyStubs } from "./support/proxy-stubs.mjs";

// Achado de 17/10/2026 (revisao da PR #84): o proxy chamava supabase.auth.getUser() em toda requisicao
// a /api/* com cookie de sessao, dobrando as chamadas ao Supabase Auth nas rotas mais frequentes (poll
// e heartbeat do Modo TV, progresso, comentarios, tutor). Os handlers ja validam e renovam a sessao
// por conta propria (requireApiUser, requireApiRole, createSupabaseServerClient) ou usam token proprio
// (TV, jobs, webhooks). Estes testes chamam o proxy como funcao, com um cliente do Supabase falso que
// conta as chamadas: em /api/* nenhuma; nas paginas, a validacao continua.

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-publica-de-teste";
delete process.env.AUTH_SESSION_STRATEGY;

const { NextRequest } = await import("next/server");
const { proxy } = await import("../src/proxy.ts");

const cookieDeSessao = "sb-127-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0";
const aluna = { id: "00000000-0000-4000-8000-000000000001", user_metadata: {} };

function pedido(caminho, { cookie = cookieDeSessao, method = "GET" } = {}) {
  return new NextRequest(`http://127.0.0.1:3100${caminho}`, { headers: cookie ? { cookie } : {}, method });
}

function nonceDaCsp(response) {
  return /'nonce-([^']+)'/.exec(response.headers.get("content-security-policy") ?? "")?.[1];
}

test.beforeEach(() => {
  proxyStubs.reset();
  delete process.env.AUTH_SESSION_STRATEGY;
});

test("rota /api com cookie de sessao passa pelo proxy sem consultar o Supabase Auth, e sai com a CSP e o nonce do pedido", async () => {
  const rotas = [
    ["/api/health", "GET"],
    ["/api/progress/lessons", "PUT"],
    ["/api/tv/sessions/abc/commands", "POST"],
    ["/api/tv/receiver/abc?includeLesson=1", "GET"],
    ["/api/comments/lessons/aula-1", "GET"],
    ["/api/webhooks/resend", "POST"]
  ];

  for (const [caminho, method] of rotas) {
    proxyStubs.reset();

    const response = await proxy(pedido(caminho, { method }));

    assert.equal(response.status, 200, caminho);
    assert.equal(response.headers.get("location"), null, caminho);
    assert.deepEqual(proxyStubs.clients, [], `${caminho}: o proxy nao deve criar o cliente de sessao`);
    assert.deepEqual(proxyStubs.authCalls, [], `${caminho}: o proxy nao deve chamar getUser/getClaims`);

    const nonce = nonceDaCsp(response);
    assert.ok(nonce, `${caminho}: a resposta precisa trazer a CSP com nonce`);
    // O nonce segue para o handler no cabecalho x-nonce do pedido reescrito.
    assert.equal(response.headers.get("x-middleware-request-x-nonce"), nonce, caminho);
    assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  }
});

test("rota /api sem cookie nenhum tambem nao cria o cliente de sessao", async () => {
  const response = await proxy(pedido("/api/health", { cookie: null }));

  assert.equal(response.status, 200);
  assert.deepEqual(proxyStubs.clients, []);
  assert.deepEqual(proxyStubs.authCalls, []);
});

test("com AUTH_SESSION_STRATEGY=claims, rota /api com cookie tambem nao chama getClaims", async () => {
  process.env.AUTH_SESSION_STRATEGY = "claims";

  const response = await proxy(pedido("/api/tv/receiver/abc"));

  assert.equal(response.status, 200);
  assert.deepEqual(proxyStubs.authCalls, []);
  assert.ok(nonceDaCsp(response));
});

test("pagina protegida com o mesmo cookie continua validando a sessao no proxy: sem usuario vai para /login, com usuario passa", async () => {
  // Controle do dublê: prova que o cliente falso esta ligado ao proxy e que so /api/* o dispensa.
  const barrada = await proxy(pedido("/minhas-compras"));

  assert.equal(barrada.status, 307);
  assert.equal(new URL(barrada.headers.get("location")).pathname, "/login");
  assert.equal(new URL(barrada.headers.get("location")).searchParams.get("next"), "/minhas-compras");
  assert.equal(barrada.headers.get("cache-control"), "private, no-store");
  assert.equal(proxyStubs.clients.length, 1);
  assert.deepEqual(proxyStubs.authCalls, ["getUser"]);

  proxyStubs.reset();
  proxyStubs.userResult = { data: { user: aluna }, error: null };

  const liberada = await proxy(pedido("/minhas-compras"));

  assert.equal(liberada.status, 200);
  assert.equal(liberada.headers.get("location"), null);
  assert.equal(liberada.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(proxyStubs.authCalls, ["getUser"]);
  assert.ok(nonceDaCsp(liberada));
});

test("com AUTH_SESSION_STRATEGY=claims, pagina protegida valida pelo getClaims (controle do dublê)", async () => {
  process.env.AUTH_SESSION_STRATEGY = "claims";
  proxyStubs.claimsResult = { data: { claims: { sub: aluna.id, user_metadata: {} } }, error: null };

  const response = await proxy(pedido("/"));

  assert.equal(response.status, 200);
  assert.deepEqual(proxyStubs.authCalls, ["getClaims"]);
});
