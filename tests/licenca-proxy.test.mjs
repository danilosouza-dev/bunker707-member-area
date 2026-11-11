import assert from "node:assert/strict";
import test from "node:test";
import { proxyStubs } from "./support/proxy-stubs.mjs";

// O src/proxy.ts e as páginas de um módulo vendido à parte (docs/32 §11.8). No modo "enforce", quem ainda não entrou e
// abre /webinarios segue para a própria página, que responde 404 sem o módulo na licença (e, com ele, manda para o
// login): o login nunca diz que um módulo desligado existe. No modo "off", o login de sempre, como antes. As outras
// páginas protegidas não mudam em nenhum modo.

process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "chave-publica-de-teste";
delete process.env.AUTH_SESSION_STRATEGY;

const { NextRequest } = await import("next/server");
const { proxy } = await import("../src/proxy.ts");

const antes = process.env.BUNKER_LICENSING_MODE;
const aluna = { id: "00000000-0000-4000-8000-000000000001", user_metadata: {} };

function pedido(caminho) {
  return new NextRequest(`http://127.0.0.1:3100${caminho}`, { headers: { cookie: "sb-127-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0" } });
}

test.beforeEach(() => {
  proxyStubs.reset();
  delete process.env.BUNKER_LICENSING_MODE;
});

test.after(() => {
  if (antes === undefined) delete process.env.BUNKER_LICENSING_MODE;
  else process.env.BUNKER_LICENSING_MODE = antes;
});

test("modo off: /webinarios sem sessão vai para o login, como antes", async () => {
  for (const caminho of ["/webinarios", "/webinarios/live-de-teste", "/webinarios/live-de-teste/sala?sessao=x"]) {
    const resposta = await proxy(pedido(caminho));

    assert.equal(resposta.status, 307, caminho);
    const destino = new URL(resposta.headers.get("location"));
    assert.equal(destino.pathname, "/login", caminho);
    assert.equal(destino.searchParams.get("next"), caminho);
  }
});

test("enforce: /webinarios sem sessão segue para a página (que decide), sem cache; as outras páginas, login como sempre", async () => {
  process.env.BUNKER_LICENSING_MODE = "enforce";

  for (const caminho of ["/webinarios", "/webinarios/live-de-teste", "/webinarios/live-de-teste/sala?sessao=x"]) {
    const resposta = await proxy(pedido(caminho));

    assert.equal(resposta.status, 200, caminho);
    assert.equal(resposta.headers.get("location"), null, caminho);
    assert.equal(resposta.headers.get("cache-control"), "private, no-store", caminho);
    assert.match(resposta.headers.get("content-security-policy"), /frame-ancestors 'none'/, caminho);
  }

  for (const caminho of ["/", "/favoritos", "/admin", "/admin/comunicacao/webinarios", "/perfil"]) {
    const resposta = await proxy(pedido(caminho));
    assert.equal(resposta.status, 307, caminho);
    assert.equal(new URL(resposta.headers.get("location")).pathname, "/login", caminho);
  }
});

test("enforce: com sessão, nada muda (a troca de senha obrigatória continua valendo em /webinarios)", async () => {
  process.env.BUNKER_LICENSING_MODE = "enforce";
  proxyStubs.userResult = { data: { user: aluna }, error: null };
  assert.equal((await proxy(pedido("/webinarios"))).status, 200);

  proxyStubs.userResult = { data: { user: { ...aluna, user_metadata: { must_change_password: true } } }, error: null };
  const resposta = await proxy(pedido("/webinarios"));
  assert.equal(resposta.status, 307);
  assert.equal(new URL(resposta.headers.get("location")).pathname, "/alterar-senha");
});
