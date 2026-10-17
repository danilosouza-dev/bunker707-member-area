import { expect, test } from "./fixtures";

// Regressao de 17/10/2026: o proxy.ts ficava na raiz do repositorio, e o Next 16 so compila
// `src/proxy.ts` quando o app esta em `src/app`. Sem o proxy, `/` anonima respondia 200 (a pagina se
// protegia sozinha, mas sem redirecionamento na borda) e nenhuma resposta trazia a CSP com nonce.
// Estes testes falham com o proxy fora de `src/` e passam com ele dentro. Rodam sem sessao e olham a
// resposta HTTP, nao a tela, porque e o cabecalho e o status que provam que o proxy esta no ar.

test.use({ storageState: { cookies: [], origins: [] } });

test("visitante sem sessao e barrado na borda: `/` responde 307 para /login?next= antes de qualquer pagina", async ({ request }) => {
  const resposta = await request.get("/", { maxRedirects: 0 });

  expect(resposta.status()).toBe(307);
  expect(resposta.headers()["location"]).toMatch(/\/login\?next=%2F$/);
  // O redirecionamento do proxy nunca fica em cache compartilhado.
  expect(resposta.headers()["cache-control"]).toBe("private, no-store");
});

test("toda resposta do app sai pelo proxy com a CSP de nonce por pedido", async ({ request }) => {
  const login = await request.get("/login");
  expect(login.status()).toBe(200);

  const csp = login.headers()["content-security-policy"];
  expect(csp, "a resposta de /login precisa trazer Content-Security-Policy").toBeDefined();
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  // O app de teste e servido em http: a diretiva so entra em pagina https, senao o WebKit/Safari tenta
  // buscar scripts, CSS e fontes por https ate em 127.0.0.1 e a pagina nao hidrata.
  expect(csp).not.toContain("upgrade-insecure-requests");

  // O nonce muda a cada pedido: dois pedidos nunca compartilham o mesmo.
  const outroLogin = await request.get("/login");
  const nonce = (valor: string | undefined) => /'nonce-([^']+)'/.exec(valor ?? "")?.[1];
  expect(nonce(outroLogin.headers()["content-security-policy"])).toBeDefined();
  expect(nonce(outroLogin.headers()["content-security-policy"])).not.toBe(nonce(csp));
});

test("pagina publica que o build pre-renderizaria (/tv) tambem sai com o nonce do pedido nos scripts", async ({ request }) => {
  const resposta = await request.get("/tv");
  expect(resposta.status()).toBe(200);

  const nonce = /'nonce-([^']+)'/.exec(resposta.headers()["content-security-policy"] ?? "")?.[1];
  expect(nonce).toBeDefined();
  // Pagina estatica sairia do build sem nonce: o navegador bloquearia os scripts do React e a TV
  // ficaria em branco. O layout raiz forca a renderizacao no pedido justamente por isso.
  expect(await resposta.text()).toContain(`nonce="${nonce}"`);
});

test("a tela de entrar carrega com o nonce da CSP no HTML, sem violacao e com todos os scripts, CSS e fontes da propria origem", async ({ page }, testInfo) => {
  const origemDosAssets = new URL("/_next/", testInfo.project.use.baseURL).toString();
  const violacoes: string[] = [];
  page.on("console", (mensagem) => {
    if (mensagem.type() === "error" && /Content Security Policy/i.test(mensagem.text())) {
      violacoes.push(mensagem.text());
    }
  });
  // Scripts, CSS e fontes do proprio app que falham (no WebKit, `upgrade-insecure-requests` os mandava
  // para https). So os de /_next/: o script do Speed Insights nao existe fora da Vercel e falha sempre.
  const falhasDaOrigem: string[] = [];
  page.on("requestfailed", (pedido) => {
    if (pedido.url().startsWith(origemDosAssets)) {
      falhasDaOrigem.push(`${pedido.url()} -> ${pedido.failure()?.errorText}`);
    }
  });

  const resposta = await page.goto("/login");
  expect(resposta?.headers()["content-security-policy"]).toMatch(/'nonce-/);
  await page.waitForLoadState("networkidle");

  // O Next le o nonce do cabecalho Content-Security-Policy do pedido e o carimba nos scripts.
  const nonce = /'nonce-([^']+)'/.exec(resposta?.headers()["content-security-policy"] ?? "")?.[1];
  expect(nonce).toBeDefined();
  await expect(page.locator("script[nonce]").first()).toBeAttached();
  await expect(page.getByRole("button", { exact: true, name: "Entrar" })).toBeVisible();
  expect(violacoes).toEqual([]);
  expect(falhasDaOrigem).toEqual([]);

  // Pagina hidratada: a tela de entrar valida o formulario no cliente antes de falar com o Auth.
  await page.locator('input[type="email"]').fill("aluna.teste@bunker707.test");
  await page.locator('input[type="password"]').fill("senha-errada");
  await page.getByRole("button", { exact: true, name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha inválidos.")).toBeVisible();
});

test.describe("com a sessao da aluna", () => {
  test.use({ storageState: "tests/e2e/.auth/aluna.json" });

  test("logada, abrir /login com ?next= que tem query volta para o caminho com a query intacta (sem %3F)", async ({ request }) => {
    // Regressao: o destino era montado por `pathname =`, que codifica o "?" como %3F e quebrava links de
    // aula com ?lessonId= (o segmento do modulo virava "M?lessonId=L" e dava 404).
    const resposta = await request.get("/login?next=%2F%3Fx%3D1", { maxRedirects: 0 });

    expect(resposta.status()).toBe(307);
    const destino = new URL(resposta.headers()["location"] ?? "", "http://127.0.0.1");
    expect(`${destino.pathname}${destino.search}`).toBe("/?x=1");
  });

  test("logada, um link com ?code= (convite, recuperacao, magic link) chega ao callback em vez de ser engolido pelo proxy", async ({ page }) => {
    // Antes, o proxy respondia 307 para a home e o navegador nunca pedia o callback. Agora a tela de
    // entrar encaminha o codigo (pelo roteador do Next, nao por 307 da borda: o layout raiz tem
    // loading.tsx e a pagina chega em streaming), por isso o que se confere e o pedido ao callback.
    const pedidoAoCallback = page.waitForRequest((pedido) => /\/auth\/callback\?.*code=codigo-de-teste/.test(pedido.url()));
    await page.goto("/login?code=codigo-de-teste");

    const pedido = await pedidoAoCallback;
    expect(new URL(pedido.url()).pathname).toBe("/auth/callback");
  });
});
