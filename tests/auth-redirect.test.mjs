import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Destino depois de entrar (?next= do /login, do /auth/callback e da troca de senha). So caminho
// interno: navegadores tratam "\" como "/" em endereco http, entao "/\evil.com" viraria "//evil.com"
// no cabecalho Location e mandaria o aluno para outro site (redirecionamento aberto).

const { getSafeRedirectPath } = await import("../src/lib/auth/redirect.ts");

test("caminhos internos passam com busca e ancora", () => {
  assert.equal(getSafeRedirectPath("/minhas-compras"), "/minhas-compras");
  assert.equal(getSafeRedirectPath("/conteudo/curso-ia?aula=2#inicio"), "/conteudo/curso-ia?aula=2#inicio");
  assert.equal(getSafeRedirectPath("%2Fconteudo%2Fcurso-ia"), "/conteudo/curso-ia", "valor codificado no endereco");
  assert.equal(getSafeRedirectPath("/alterar-senha"), "/alterar-senha");
});

test("vazio, outro site e endereco que o navegador leria como outro site viram a home", () => {
  for (const value of [
    undefined,
    null,
    "",
    "https://evil.com",
    "evil.com",
    "//evil.com",
    "/%2F%2Fevil.com",
    "/\\evil.com",
    "/%5Cevil.com",
    "/%5C%5Cevil.com",
    "/\\\\evil.com",
    "/\t/evil.com",
    "/%09/evil.com",
    "/%0A/evil.com",
    "/%00",
    "/%E0%A4%A",
    // Segmento de ponto que, resolvido, deixa o caminho comecando com "//" (regressao de 17/10/2026).
    "/.//evil.com",
    "/..//evil.com",
    "/%2e//evil.com",
    "/./%2fevil.com",
    "/a/..//evil.com/x",
    "/.//evil.com?next=/x#y"
  ]) {
    assert.equal(getSafeRedirectPath(value), "/", JSON.stringify(value));
  }
});

test("o resultado nunca sai da origem quando montado como o /auth/callback e o proxy montam", () => {
  for (const value of [
    "/%5Cevil.com",
    "/\\\\evil.com",
    "/%255Cevil.com",
    "/a/..%2F..%2F%5Cevil.com",
    "/.//evil.com",
    "/..//evil.com",
    "/%2e//evil.com",
    "/./%2fevil.com",
    "/a/..//evil.com/x",
    "/ok"
  ]) {
    const url = new URL(getSafeRedirectPath(value), "https://membros.bunker707.com");
    assert.equal(url.origin, "https://membros.bunker707.com", JSON.stringify(value));
    assert.doesNotMatch(getSafeRedirectPath(value), /^\/\//, JSON.stringify(value));
  }
});

test("login e callback nunca sao destino, nem por caminho com ponto", () => {
  assert.equal(getSafeRedirectPath("/login"), "/");
  assert.equal(getSafeRedirectPath("/login?next=/x"), "/");
  assert.equal(getSafeRedirectPath("/auth/callback?code=1"), "/");
  assert.equal(getSafeRedirectPath("/conteudo/../login"), "/");
});
