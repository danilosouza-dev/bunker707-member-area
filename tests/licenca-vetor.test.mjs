import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O vetor fixo do formato BKL1 (docs/32 §11.4), igual neste repositório e no do Emissor (bunker-licensing). Lá,
// o Emissor tem de reproduzi-lo byte a byte; aqui, o Verificador tem de conferi-lo e ler o mesmo conteúdo. Se um
// dos lados mudar o formato sozinho, o teste dele fica vermelho.

const { verifyLicenseToken } = await import("../src/server/licensing/artifact.ts");
const vetor = JSON.parse(readFileSync(new URL("./fixtures/licenca-vetor.json", import.meta.url), "utf8"));

test("o Verificador confere o vetor fixo que o Emissor assina e lê o mesmo conteúdo", () => {
  const resultado = verifyLicenseToken(vetor.token, [vetor.raiz]);

  assert.equal(resultado.ok, true, JSON.stringify(resultado));
  assert.equal(resultado.certificate.use, "license");
  assert.equal(resultado.certificate.kid, vetor.certificado.kid);
  assert.equal(resultado.license.installation.host, vetor.licenca.installation.host);
  assert.deepEqual(resultado.license.plan, vetor.licenca.plan);
  assert.deepEqual(resultado.license.features, vetor.licenca.features);
});

test("o vetor só confere com a raiz dele: outra raiz, ou a mesma com outro nome, não serve", () => {
  assert.deepEqual(verifyLicenseToken(vetor.token, [{ ...vetor.raiz, rid: "outra-raiz" }]), { ok: false, error: "raiz_desconhecida" });

  const partes = vetor.token.split(".");
  const conteudo = Buffer.from(partes[3], "base64url").toString("utf8").replace("Escola Vetor", "Escola Vetoz");
  partes[3] = Buffer.from(conteudo, "utf8").toString("base64url");
  assert.deepEqual(verifyLicenseToken(partes.join("."), [vetor.raiz]), { ok: false, error: "assinatura_da_licenca" });
});
