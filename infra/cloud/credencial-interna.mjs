#!/usr/bin/env node
// A credencial da API interna do Emissor (docs/api-interna.md do bunker-licensing; docs/20 §8C.9), sorteada no runner pela
// etapa conectar-licencas no formato do Emissor: `bki_` e 32 bytes sorteados em base64url (43 caracteres), como o
// `bin/painel.ts credencial-interna` dele. O resumo e o que o Emissor guarda em INTERNO_CREDENCIAL_HASH e compara
// (src/interno/credential.ts de la): SHA-256, em hexadecimal, de "bunker-licensing/interno:" seguido da credencial.
//
//   node infra/cloud/credencial-interna.mjs --credencial <arquivo> --resumo <arquivo>
//
// Grava os dois arquivos (0600) e nao imprime nada: a credencial so vai para o servidor da escola, e o resumo so para o do
// Emissor (infra/cloud/licencas.sh, conectar). O vetor em tests/infra-licencas-conectar.test.mjs saiu do codigo do Emissor.

import { createHash, randomBytes } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const PADRAO_CREDENCIAL = /^bki_[A-Za-z0-9_-]{43}$/;
export const PADRAO_RESUMO = /^[0-9a-f]{64}$/;

/** Uma credencial nova: 256 bits sorteados, no formato que o Emissor aceita. */
export function novaCredencial() {
  return `bki_${randomBytes(32).toString("base64url")}`;
}

/** O resumo que o Emissor guarda e compara, o mesmo de internalCredentialHash no bunker-licensing. */
export function resumoDaCredencial(credencial) {
  if (!PADRAO_CREDENCIAL.test(credencial)) {
    throw new Error("credencial fora do formato do Emissor (bki_ e 43 caracteres base64url)");
  }

  return createHash("sha256").update(`bunker-licensing/interno:${credencial}`, "utf8").digest("hex");
}

function gravar(caminho, texto) {
  writeFileSync(caminho, texto, { encoding: "utf8", mode: 0o600 });
  chmodSync(caminho, 0o600);
}

function principal() {
  const { values } = parseArgs({ options: { credencial: { type: "string" }, resumo: { type: "string" } } });

  if (!values.credencial || !values.resumo) {
    process.stderr.write("uso: node infra/cloud/credencial-interna.mjs --credencial <arquivo> --resumo <arquivo>\n");
    return 2;
  }

  const credencial = novaCredencial();
  gravar(values.credencial, credencial);
  gravar(values.resumo, `${resumoDaCredencial(credencial)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = principal();
}
