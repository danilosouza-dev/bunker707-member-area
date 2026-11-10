import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Guarda de arquitetura (docs/32 §11.2): o produto confere licenças e nunca as assina. Código de assinatura
// dentro de src/ daria a quem quisesse piratear um emissor de licenças pronto: bastaria trocar a chave
// pública gravada. Assinar é trabalho do Emissor (repositório próprio bunker-licensing), que nunca vai na imagem do
// comprador. Os testes assinam pelo dublê de tests/support/licenca-de-teste.mjs.

function arquivos(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      return arquivos(caminho);
    }
    return /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entrada.name) ? [caminho] : [];
  });
}

// O que denuncia código de assinatura. É disciplina interna, não proteção: o Verificador descreve o formato
// inteiro, e quem quiser escrever um emissor fora deste repositório escreve. A guarda impede que ele nasça aqui.
const PROIBIDO = [
  { nome: "createSign, createPrivateKey ou generateKeyPair", padrao: /\b(createSign|createPrivateKey|generateKeyPair|generateKeyPairSync)\b/ },
  { nome: "a palavra sign num arquivo que usa o crypto", padrao: /\bsign\b/, soComCrypto: true },
  { nome: "assinar pelo crypto.subtle", padrao: /subtle[\s\S]{0,80}["'.]\s*sign\b/ },
  { nome: "chave privada escrita no código (PEM)", padrao: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nome: "chave privada Ed25519 em DER base64", padrao: /MC4CAQAwBQYDK2Vw/ },
  { nome: "chave privada em JWK (campo d)", padrao: /["']?\bd["']?\s*:\s*["'][A-Za-z0-9_-]{43}["']/ },
  { nome: "contexto de assinatura da licença fora do modelo", padrao: /bunker-licensing\/license\/v|LICENSE_SIGNING_CONTEXT/, foraDe: ["model.ts", "artifact.ts"] }
];

const USA_CRYPTO = /(["'](node:)?crypto["'])|\bcrypto\.subtle\b|globalThis\.crypto/;

test("nenhum arquivo de src/ assina licença nem guarda chave privada", () => {
  const achados = [];

  for (const arquivo of arquivos("src")) {
    const codigo = readFileSync(arquivo, "utf8");

    for (const regra of PROIBIDO) {
      // O contexto mora em model.ts e é usado só por artifact.ts, que confere.
      if (regra.foraDe && regra.foraDe.some((nome) => arquivo === join("src", "server", "licensing", nome))) {
        continue;
      }

      if (regra.soComCrypto && !USA_CRYPTO.test(codigo)) {
        continue;
      }

      if (regra.padrao.test(codigo)) {
        achados.push(`${arquivo}: ${regra.nome}`);
      }
    }
  }

  assert.deepEqual(achados, []);
});

test("a guarda pega as formas de assinar que a revisão listou", () => {
  const exemplos = [
    'import * as crypto from "node:crypto"; crypto.sign(null, dados, chave);',
    'const { sign } = require("crypto");',
    'const c = await import("node:crypto"); c.sign(null, d, k);',
    'export { sign } from "node:crypto";',
    'await crypto.subtle["sign"]("Ed25519", k, d);',
    'const s = crypto.subtle; await s.sign("Ed25519", k, d);',
    'import { LICENSE_SIGNING_CONTEXT } from "./model";',
    'const contexto = "bunker-licensing/" + "license/v1";',
    'const chave = { kty: "OKP", crv: "Ed25519", d: "nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A", x: "x" };',
    'const der = "MC4CAQAwBQYDK2VwBCIEIJ2xne";',
    'import { createPrivateKey } from "node:crypto";'
  ];
  const pegos = exemplos.filter((codigo) =>
    PROIBIDO.some((regra) => (!regra.soComCrypto || USA_CRYPTO.test(codigo)) && regra.padrao.test(codigo))
  );

  // A concatenação do contexto em pedaços é a única que escapa: fica registrado aqui, sem fingir que pega.
  assert.deepEqual(
    exemplos.filter((codigo) => !pegos.includes(codigo)),
    ['const contexto = "bunker-licensing/" + "license/v1";']
  );
});

test("o Verificador confere com verify do node:crypto e não importa nada que assine", () => {
  const codigo = readFileSync(join("src", "server", "licensing", "artifact.ts"), "utf8");

  assert.match(codigo, /verify as verifySignature/);
  assert.doesNotMatch(codigo, /\bsign\s*\(/);
});

test("o modo e as raízes da licença nunca vão ao navegador e ficam gravados no build pela chave env do next.config", () => {
  const achados = arquivos("src")
    .concat(["next.config.ts"])
    .filter((arquivo) => /NEXT_PUBLIC_BUNKER_LICENS/.test(readFileSync(arquivo, "utf8")));
  assert.deepEqual(achados, []);

  const config = readFileSync("next.config.ts", "utf8");
  assert.match(config, /env:\s*\{[^}]*BUNKER_LICENSING_MODE:[^}]*BUNKER_LICENSING_ROOTS:/s);

  // Lidos por nome literal: só assim o Next troca pelo texto na hora de gerar a imagem.
  const leitura = readFileSync(join("src", "server", "licensing", "build-config.ts"), "utf8");
  assert.match(leitura, /process\.env\.BUNKER_LICENSING_MODE/);
  assert.match(leitura, /process\.env\.BUNKER_LICENSING_ROOTS/);
  assert.doesNotMatch(leitura, /process\.env\[/);
});
