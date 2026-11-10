import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// O Emissor (services/bunker-licensing) assina e o produto confere (docs/32 §11.2 e §11.4). Estes testes
// prendem os dois lados ao mesmo formato por um vetor fixo, e conferem a ferramenta das chaves da cerimônia
// (a raiz fora de servidor, a chave de emissão cifrada, nada sobrescrito, senha nunca por argumento).

const { signCertificate, signLicense, publicKeyText } = await import("../services/bunker-licensing/src/signing.ts");
const { exportEncryptedPrivateKey, generateSigningKey, importEncryptedPrivateKey } = await import("../services/bunker-licensing/src/keys.ts");
const { verifyLicenseToken } = await import("../src/server/licensing/artifact.ts");

const vetor = JSON.parse(readFileSync(new URL("./fixtures/licenca-vetor.json", import.meta.url), "utf8"));
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
const daSemente = (hex) => createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(hex, "hex")]), format: "der", type: "pkcs8" });
const SENHA = "senha-de-teste-bem-comprida";
const CLI = new URL("../services/bunker-licensing/bin/chaves.ts", import.meta.url).pathname;

test("o Emissor reproduz o vetor fixo byte a byte: o formato não mudou do lado de quem assina", () => {
  const raiz = daSemente(vetor.sementes.raiz);
  const emissao = daSemente(vetor.sementes.emissao);

  assert.equal(publicKeyText(raiz), vetor.raiz.publicKey);
  assert.equal(signLicense(emissao, signCertificate(raiz, vetor.certificado), vetor.licenca), vetor.token);
});

test("o Verificador do produto confere o vetor fixo e lê o mesmo conteúdo: o formato não mudou do lado de quem confere", () => {
  const resultado = verifyLicenseToken(vetor.token, [vetor.raiz]);

  assert.equal(resultado.ok, true);
  assert.equal(resultado.license.installation.host, "alunos.vetor.test");
  assert.deepEqual(resultado.license.plan, vetor.licenca.plan);
  assert.equal(resultado.certificate.kid, "emissao-vetor");
});

test("licença assinada pelo Emissor com chaves novas confere; trocar uma letra do conteúdo derruba", () => {
  const raiz = generateSigningKey();
  const emissao = generateSigningKey();
  const certificado = signCertificate(raiz, { ...vetor.certificado, rid: "raiz-nova", kid: "emissao-nova", publicKey: publicKeyText(emissao) });
  const texto = signLicense(emissao, certificado, { ...vetor.licenca, kid: "emissao-nova" });
  const raizes = [{ rid: "raiz-nova", publicKey: publicKeyText(raiz) }];

  assert.equal(verifyLicenseToken(texto, raizes).ok, true);

  const partes = texto.split(".");
  const conteudo = Buffer.from(partes[3], "base64url").toString("utf8").replace("Escola Vetor", "Escola Vetoz");
  partes[3] = Buffer.from(conteudo, "utf8").toString("base64url");
  assert.deepEqual(verifyLicenseToken(partes.join("."), raizes), { ok: false, error: "assinatura_da_licenca" });
});

test("o Emissor recusa assinar licença que cita outra chave, certificado com prazo invertido e chave que não é Ed25519", () => {
  const raiz = daSemente(vetor.sementes.raiz);
  const certificado = signCertificate(raiz, vetor.certificado);

  assert.throws(() => signLicense(daSemente(vetor.sementes.emissao), certificado, { ...vetor.licenca, kid: "outra" }), /cita a chave outra/);
  assert.throws(() => signCertificate(raiz, { ...vetor.certificado, notAfter: vetor.certificado.notBefore }), /fim do certificado/);
  assert.throws(() => signCertificate(generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey, vetor.certificado), /Ed25519/);
});

test("chave privada só sai cifrada com senha forte, e só entra cifrada", () => {
  const chave = generateSigningKey();

  assert.throws(() => exportEncryptedPrivateKey(chave, "curta"), /pelo menos 16/);

  const pem = exportEncryptedPrivateKey(chave, SENHA);
  assert.match(pem, /^-----BEGIN ENCRYPTED PRIVATE KEY-----/);
  assert.equal(publicKeyText(importEncryptedPrivateKey(pem, SENHA)), publicKeyText(chave));
  assert.throws(() => importEncryptedPrivateKey(pem, "senha-errada-mas-comprida"));

  const aberta = chave.export({ type: "pkcs8", format: "pem" });
  assert.throws(() => importEncryptedPrivateKey(aberta, SENHA), /cifrada com senha/);
});

function chaves(args, env = {}) {
  const resultado = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, ...env }
  });
  return { codigo: resultado.status, saida: resultado.stdout, erro: resultado.stderr };
}

test("cerimônia das chaves: a raiz e a emissão saem cifradas, e a licença da emissão confere com a raiz impressa", () => {
  const pasta = mkdtempSync(join(tmpdir(), "chaves-"));

  try {
    const raizArquivo = join(pasta, "raiz.pem");
    const emissaoArquivo = join(pasta, "emissao.pem");

    const raiz = chaves(["raiz", "--rid", "raiz-teste", "--saida", raizArquivo], { BUNKER_SENHA_RAIZ: SENHA });
    assert.equal(raiz.codigo, 0, raiz.erro);
    const raizPublica = JSON.parse(raiz.saida);
    assert.equal(raizPublica.rid, "raiz-teste");
    assert.equal(statSync(raizArquivo).mode & 0o777, 0o600);
    assert.match(readFileSync(raizArquivo, "utf8"), /ENCRYPTED PRIVATE KEY/);

    const emissao = chaves(
      ["emissao", "--raiz", raizArquivo, "--rid", "raiz-teste", "--kid", "emissao-teste", "--dias", "400", "--inicio", "2026-11-01T00:00:00Z", "--saida", emissaoArquivo],
      { BUNKER_SENHA_RAIZ: SENHA, BUNKER_SENHA_EMISSAO: `${SENHA}-emissao` }
    );
    assert.equal(emissao.codigo, 0, emissao.erro);
    const { certificate, kid } = JSON.parse(emissao.saida);
    const chaveDeEmissao = importEncryptedPrivateKey(readFileSync(emissaoArquivo, "utf8"), `${SENHA}-emissao`);

    const texto = signLicense(chaveDeEmissao, { kid, ...certificate }, { ...vetor.licenca, kid });
    const resultado = verifyLicenseToken(texto, [raizPublica]);
    assert.equal(resultado.ok, true);
    assert.equal(resultado.certificate.notBefore, "2026-11-01T00:00:00.000Z");
    assert.equal(resultado.certificate.notAfter, "2027-12-06T00:00:00.000Z");
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});

test("cerimônia das chaves: não sobrescreve arquivo, não aceita senha faltando e não aceita identificador estranho", () => {
  const pasta = mkdtempSync(join(tmpdir(), "chaves-"));

  try {
    const existente = join(pasta, "ja-existe.pem");
    writeFileSync(existente, "conteudo de antes");

    const sobrescrever = chaves(["raiz", "--rid", "raiz-teste", "--saida", existente], { BUNKER_SENHA_RAIZ: SENHA });
    assert.equal(sobrescrever.codigo, 2);
    assert.match(sobrescrever.erro, /já existe|ja existe/);
    assert.equal(readFileSync(existente, "utf8"), "conteudo de antes");

    const semSenha = chaves(["raiz", "--rid", "raiz-teste", "--saida", join(pasta, "nova.pem")]);
    assert.equal(semSenha.codigo, 2);
    assert.match(semSenha.erro, /BUNKER_SENHA_RAIZ/);

    const idEstranho = chaves(["raiz", "--rid", "Raiz Com Espaço", "--saida", join(pasta, "outra.pem")], { BUNKER_SENHA_RAIZ: SENHA });
    assert.equal(idEstranho.codigo, 2);

    assert.equal(chaves(["apagar-tudo"]).codigo, 2);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
});
