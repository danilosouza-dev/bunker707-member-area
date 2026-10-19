import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Links de e-mail do Auth no servidor proprio (convite, recuperacao, link magico): ?token_hash= confirmado no
// servidor por /auth/confirm. Com o {{ .ConfirmationURL }} do GoTrue o convite voltava com #access_token
// (fluxo implicito), que o app recusa, e a pessoa caia no login sem sessao (19/10/2026, primeiro convite real).
const routeSource = await readFile(new URL("../src/app/auth/confirm/route.ts", import.meta.url), "utf8");
const proxySource = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
const template = (name) => readFile(new URL(`../infra/compose/volumes/auth-templates/${name}.html`, import.meta.url), "utf8");

test("/auth/confirm confirma o token_hash no servidor e nunca troca codigo PKCE", () => {
  assert.match(routeSource, /searchParams\.get\("token_hash"\)/);
  assert.match(routeSource, /supabase\.auth\.verifyOtp\(\{ token_hash: tokenHash, type: type as EmailOtpType \}\)/);
  assert.doesNotMatch(routeSource, /exchangeCodeForSession/);
  // So tipos de link de e-mail; outro valor de ?type= nem chega ao Auth.
  assert.match(routeSource, /new Set<EmailOtpType>\(\["invite", "recovery", "magiclink", "email", "signup", "email_change"\]\)/);
  assert.match(routeSource, /if \(tokenHash && type && emailOtpTypes\.has\(type\)\)/);
});

test("convite e recuperacao terminam em definir a senha; destino sempre passa pelo filtro de redirecionamento", () => {
  assert.match(routeSource, /new Set<EmailOtpType>\(\["invite", "recovery"\]\)/);
  assert.match(routeSource, /new URL\("\/alterar-senha", origin\)/);
  assert.match(routeSource, /getSafeRedirectPath\(requestUrl\.searchParams\.get\("next"\)\)/);
  // Link invalido volta ao login com o aviso de link (?erro=link), que oferece "Esqueci minha senha".
  assert.match(routeSource, /loginUrl\.searchParams\.set\(AUTH_LINK_ERROR_PARAM, AUTH_LINK_ERROR_VALUE\)/);
});

test("o proxy deixa /auth/confirm publico e nao desvia um link com token_hash de quem ja tem sessao", () => {
  assert.match(proxySource, /const publicPagePrefixes = \["\/login", "\/auth\/callback", "\/auth\/confirm"\];/);
  assert.match(proxySource, /request\.nextUrl\.searchParams\.has\("token_hash"\)/);
  assert.match(proxySource, /if \(publicPage && user && !emailLink\)/);
});

test("os modelos de convite, recuperacao e link magico apontam para /auth/confirm com o token_hash do GoTrue", async () => {
  for (const [name, type] of [["invite", "invite"], ["recovery", "recovery"], ["magic_link", "magiclink"]]) {
    const html = await template(name);
    assert.ok(html.includes(`href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}"`), `${name}.html`);
    assert.doesNotMatch(html, /ConfirmationURL/, `${name}.html nao pode voltar ao fluxo implicito`);
  }
});

test("redirecionamentos de /auth/confirm, /auth/callback e o link da TV usam a origem dos cabecalhos", async () => {
  // No servidor proprio o request.url do Next vem com o endereco interno do container (0.0.0.0:3000): o
  // primeiro teste de /auth/confirm na Hetzner mandou para https://0.0.0.0:3000/login.
  const callbackSource = await readFile(new URL("../src/app/auth/callback/route.ts", import.meta.url), "utf8");
  const tvSource = await readFile(new URL("../src/app/api/tv/sessions/route.ts", import.meta.url), "utf8");
  for (const [name, source] of [["confirm", routeSource], ["callback", callbackSource], ["tv", tvSource]]) {
    assert.match(source, /await getHeadersOrigin\(\)/, name);
    assert.doesNotMatch(source, /requestUrl\.origin|new URL\("\/tv", request\.url\)/, name);
  }
});
