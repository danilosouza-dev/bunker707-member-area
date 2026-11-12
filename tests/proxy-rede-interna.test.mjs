import assert from "node:assert/strict";
import test from "node:test";
import { proxyStubs } from "./support/proxy-stubs.mjs";

// O proxy do app (src/proxy.ts) cria o cliente de sessao com o fetch da rede interna quando o servidor e o do kit
// (SUPABASE_INTERNAL_URL; docs/32 §11.7): o getUser e o JWKS do getClaims vao ao gateway sem DNS nem certificado. O
// cliente continua com o endereco publico (o nome do cookie da sessao). Sem a variavel, nada muda.

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://api.escola.test";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-publica-de-teste";
delete process.env.AUTH_SESSION_STRATEGY;
delete process.env.SUPABASE_INTERNAL_URL;

const { NextRequest } = await import("next/server");
const { proxy } = await import("../src/proxy.ts");

const pedido = () => new NextRequest("https://alunos.escola.test/minhas-compras", { headers: { cookie: "sb-api-auth-token=base64-eyJ4IjoxfQ" } });

test("sem SUPABASE_INTERNAL_URL o proxy cria o cliente como sempre; com ela, com o fetch que leva ao gateway", async () => {
  proxyStubs.reset();
  await proxy(pedido());
  assert.equal(proxyStubs.clients.length, 1);
  assert.equal(proxyStubs.clients[0].url, "https://api.escola.test");
  assert.equal(proxyStubs.clientOptions[0].global?.fetch, undefined);

  process.env.SUPABASE_INTERNAL_URL = "http://api-gw:8000";
  const original = globalThis.fetch;
  try {
    proxyStubs.reset();
    await proxy(pedido());
    assert.equal(proxyStubs.clients[0].url, "https://api.escola.test", "o cliente continua com o endereco publico");
    const buscar = proxyStubs.clientOptions[0].global.fetch;
    assert.equal(typeof buscar, "function");
    const vistos = [];
    globalThis.fetch = async (url) => {
      vistos.push(String(url));
      return new Response("{}");
    };
    await buscar("https://api.escola.test/auth/v1/.well-known/jwks.json");
    await buscar("https://alunos.escola.test/api/health");
    assert.deepEqual(vistos, ["http://api-gw:8000/auth/v1/.well-known/jwks.json", "https://alunos.escola.test/api/health"]);
  } finally {
    globalThis.fetch = original;
    delete process.env.SUPABASE_INTERNAL_URL;
  }
});
