#!/usr/bin/env node
// Confere no runner, antes de qualquer segredo sair dele, o que a etapa secrets-licencas leva ao servidor do Emissor
// (docs/20 §8C.5; docs/32 §10, "Duas chaves"):
//   - a chave de emissao esta cifrada (ENCRYPTED PRIVATE KEY), abre com a senha (16 ou mais caracteres) e e Ed25519;
//   - ela NAO e uma das raizes de LICENCAS_RAIZES: a raiz nunca sai da cerimonia das chaves;
//   - o certificado (a saida JSON de `bin/chaves.ts emissao`) e desta chave, serve para licenca (use "license"), esta no
//     prazo e foi assinado por uma das raizes (o mesmo contexto que o Verificador confere, src/server/licensing).
// Le tudo das variaveis LICENCAS_EMISSAO_CHAVE, LICENCAS_EMISSAO_SENHA, LICENCAS_EMISSAO_CERTIFICADO e LICENCAS_RAIZES
// (segredos do repositorio no GitHub) e so imprime o que e publico: kid, rid, validade e a chave publica de emissao.
//   node infra/cloud/licencas-chave.mjs
// Sai com 1 e uma mensagem em portugues quando algo nao confere.

import { createPrivateKey, createPublicKey, verify } from "node:crypto";

// O mesmo de src/server/licensing/model.ts (produto) e src/signing.ts (bunker-licensing): parte do formato BKL1.
const CERTIFICATE_SIGNING_CONTEXT = "bunker-licensing/certificate/v1\n";
const MIN_PASSPHRASE_LENGTH = 16;
const ROOT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

function fail(message) {
  process.stderr.write(`ERRO: ${message}\n`);
  process.exit(1);
}

function required(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") fail(`${name} vazio: cadastre o segredo no GitHub (Settings > Secrets and variables > Actions; docs/20 §8C.5).`);
  return value;
}

function json(name) {
  try {
    return JSON.parse(required(name));
  } catch {
    return fail(`${name} nao e JSON (cole a saida da cerimonia como foi impressa).`);
  }
}

const pem = required("LICENCAS_EMISSAO_CHAVE");
// Arquivo de senha costuma terminar com quebra de linha; ela nao faz parte da senha (o Emissor tira do mesmo jeito).
const passphrase = required("LICENCAS_EMISSAO_SENHA").replace(/\r?\n$/, "");
const roots = json("LICENCAS_RAIZES");
const certificate = json("LICENCAS_EMISSAO_CERTIFICADO");

if (!Array.isArray(roots) || roots.length < 1 || roots.length > 4 || !roots.every((root) => ROOT_ID.test(root?.rid ?? "") && PUBLIC_KEY.test(root?.publicKey ?? ""))) {
  fail('LICENCAS_RAIZES precisa ser a lista de 1 a 4 raizes publicas da cerimonia: [{"rid":"...","publicKey":"..."}].');
}
if (!pem.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----")) {
  fail("LICENCAS_EMISSAO_CHAVE precisa ser a chave de emissao cifrada com senha (ENCRYPTED PRIVATE KEY), como a cerimonia grava. Chave em texto aberto nunca vai para o servidor.");
}
if (passphrase.length < MIN_PASSPHRASE_LENGTH) fail(`LICENCAS_EMISSAO_SENHA precisa ter pelo menos ${MIN_PASSPHRASE_LENGTH} caracteres.`);

let privateKey;
try {
  privateKey = createPrivateKey({ key: pem, format: "pem", passphrase });
} catch {
  fail("A senha nao abre a chave: LICENCAS_EMISSAO_SENHA e LICENCAS_EMISSAO_CHAVE nao sao do mesmo par (ou o PEM foi colado incompleto).");
}
if (privateKey.asymmetricKeyType !== "ed25519") fail("LICENCAS_EMISSAO_CHAVE nao e uma chave Ed25519.");
const publicKey = createPublicKey(privateKey).export({ format: "jwk" }).x;

if (roots.some((root) => root.publicKey === publicKey)) {
  fail("LICENCAS_EMISSAO_CHAVE e uma das RAIZES de LICENCAS_RAIZES. A raiz nunca vai para servidor nenhum: so assina o certificado na cerimonia. Use a chave de emissao (bin/chaves.ts emissao) e apague este segredo do GitHub.");
}

const segment = certificate?.certificate?.segment;
const signature = certificate?.certificate?.signature;
if (typeof segment !== "string" || typeof signature !== "string" || !BASE64URL.test(segment) || !BASE64URL.test(signature)) {
  fail("LICENCAS_EMISSAO_CERTIFICADO nao e a saida de `bin/chaves.ts emissao` ({kid, rid, certificate: {segment, signature}}).");
}
let payload;
try {
  payload = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
} catch {
  fail("O certificado de LICENCAS_EMISSAO_CERTIFICADO nao se le (segment fora do formato).");
}
if (payload?.use !== "license") fail("O certificado nao e de uma chave de emissao de licencas (use diferente de \"license\").");
if (payload.publicKey !== publicKey) fail("O certificado e de outra chave: LICENCAS_EMISSAO_CERTIFICADO e LICENCAS_EMISSAO_CHAVE precisam sair da mesma rodada de `bin/chaves.ts emissao`.");
const root = roots.find((candidate) => candidate.rid === payload.rid);
if (!root) fail(`O certificado foi assinado pela raiz ${payload.rid}, que nao esta em LICENCAS_RAIZES.`);
const rootKey = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: root.publicKey }, format: "jwk" });
if (!verify(null, Buffer.from(`${CERTIFICATE_SIGNING_CONTEXT}${segment}`, "utf8"), rootKey, Buffer.from(signature, "base64url"))) {
  fail(`A assinatura do certificado nao confere com a raiz ${payload.rid} de LICENCAS_RAIZES.`);
}

const now = Date.now();
const notBefore = Date.parse(payload.notBefore);
const notAfter = Date.parse(payload.notAfter);
if (!Number.isFinite(notBefore) || !Number.isFinite(notAfter)) fail("O certificado tem datas que nao se leem.");
if (now >= notAfter) fail(`O certificado da chave ${payload.kid} venceu em ${payload.notAfter}: rode a cerimonia de novo (bin/chaves.ts emissao) com outro --kid.`);
if (now < notBefore) fail(`O certificado da chave ${payload.kid} so comeca a valer em ${payload.notBefore}.`);
const days = Math.floor((notAfter - now) / 86_400_000);

process.stdout.write(`  chave de emissao ${payload.kid} (raiz ${payload.rid}), certificado valido ate ${payload.notAfter} (${days} dias)\n`);
process.stdout.write(`  chave publica de emissao: ${publicKey}; nenhuma raiz entre os segredos\n`);
if (days < 60) process.stdout.write(`AVISO: o certificado vence em ${days} dias: prepare a troca da chave de emissao (README do bunker-licensing).\n`);
