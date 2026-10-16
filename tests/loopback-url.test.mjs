import assert from "node:assert/strict";
import test from "node:test";
import { isHttpsOrLoopbackUrl, isLoopbackHost } from "../src/lib/loopback-url.ts";

// Enderecos aceitos como publicos para fotos e imagens: https sempre; http so na propria maquina
// (Supabase local dos testes). Regra compartilhada pela foto do perfil, pelo menu e pela CSP.

test("https em qualquer host e aceito; http so em loopback", () => {
  assert.equal(isHttpsOrLoopbackUrl(new URL("https://abc.supabase.co/storage/v1/object/public/content-assets/avatars/x.webp")), true);
  assert.equal(isHttpsOrLoopbackUrl(new URL("http://127.0.0.1:55321/storage/v1/object/public/content-assets/avatars/x.png")), true);
  assert.equal(isHttpsOrLoopbackUrl(new URL("http://localhost:55321/storage/v1/object/public/a.png")), true);
  assert.equal(isHttpsOrLoopbackUrl(new URL("http://abc.supabase.co/storage/v1/object/public/a.png")), false, "http fora da maquina nao entra");
  assert.equal(isHttpsOrLoopbackUrl(new URL("http://192.168.0.3:55321/a.png")), false, "ip da rede local nao e loopback");
  assert.equal(isHttpsOrLoopbackUrl(new URL("ftp://127.0.0.1/a.png")), false);
});

test("isLoopbackHost conhece so os nomes da propria maquina", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("127.0.0.1.evil.test"), false);
  assert.equal(isLoopbackHost("supabase.co"), false);
});
