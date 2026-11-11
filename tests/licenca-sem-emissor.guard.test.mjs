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

test("o Verificador confere com o verify do node:crypto e com a Ed25519 em JavaScript puro embutida, e não importa nada que assine", () => {
  const codigo = readFileSync(join("src", "server", "licensing", "artifact.ts"), "utf8");

  assert.match(codigo, /verify as verifySignature/);
  // A segunda conferência (docs/32 §7.1, medida 7): um arquivo carregado antes do produto troca só o node:crypto.
  assert.match(codigo, /import \{ hashes as ed25519Hashes, verify as verifyEd25519 \} from "@noble\/ed25519";/);
  assert.match(codigo, /import \{ sha512 \} from "@noble\/hashes\/sha2\.js";/);
  assert.match(codigo, /ed25519Hashes\.sha512 = sha512;/, "o SHA-512 em JavaScript puro, posto antes de cada conferência");
  assert.match(codigo, /\{ zip215: false \}/, "RFC 8032 estrita: sem encodificação não canônica nem chave de ordem pequena");
  assert.match(codigo, /return nodeCryptoAccepts\(message, signature, key\) && pureJavaScriptAccepts\(message, signature, key\);/, "as duas têm de aceitar");
  assert.doesNotMatch(codigo, /\bsign\s*\(/);

  // As duas bibliotecas na versão exata: trocar de versão é uma decisão, não um npm update.
  const pacote = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pacote.dependencies["@noble/ed25519"], "3.2.0");
  assert.equal(pacote.dependencies["@noble/hashes"], "2.4.0");
});

test("o modo, as raízes e o endereço do Emissor nunca vão ao navegador e ficam gravados no build pela chave env do next.config", () => {
  const achados = arquivos("src")
    .concat(["next.config.ts"])
    .filter((arquivo) => /NEXT_PUBLIC_BUNKER_LICENS/.test(readFileSync(arquivo, "utf8")));
  assert.deepEqual(achados, []);

  const config = readFileSync("next.config.ts", "utf8");
  assert.match(config, /env:\s*\{[^}]*BUNKER_LICENSING_MODE:[^}]*BUNKER_LICENSING_ROOTS:[^}]*BUNKER_LICENSING_EMISSOR_URL:/s);

  // Lidos por nome literal: só assim o Next troca pelo texto na hora de gerar a imagem.
  const leitura = readFileSync(join("src", "server", "licensing", "build-config.ts"), "utf8");
  assert.match(leitura, /process\.env\.BUNKER_LICENSING_MODE/);
  assert.match(leitura, /process\.env\.BUNKER_LICENSING_ROOTS/);
  assert.match(leitura, /process\.env\.BUNKER_LICENSING_EMISSOR_URL/);
  assert.doesNotMatch(leitura, /process\.env\[/);

  // As variáveis da licença só são lidas ali: nenhum outro arquivo de src/ lê process.env.BUNKER_LICENSING_*.
  const leitores = arquivos("src").filter((arquivo) => /process\.env\s*(?:\.|\[\s*["'`])BUNKER_LICENSING/.test(readFileSync(arquivo, "utf8")));
  assert.deepEqual(leitores, [join("src", "server", "licensing", "build-config.ts")]);
});

test("o endereço do Emissor gravado no build: só https, ou http://127.0.0.1 nos testes; o cliente não segue redirecionamento", async () => {
  await import("./support/resolve-extensionless-ts.mjs");
  const { parseEmissorBaseUrl } = await import("../src/server/licensing/build-config.ts");

  assert.equal(parseEmissorBaseUrl("https://licencas-api.bunker707.com.br/"), "https://licencas-api.bunker707.com.br");
  assert.equal(parseEmissorBaseUrl("http://127.0.0.1:8080"), "http://127.0.0.1:8080");

  for (const recusado of ["http://licencas-api.bunker707.com.br", "http://localhost:8080", "http://127.0.0.1.nip.io", "https://a:b@emissor.test", "https://emissor.test/?x=1"]) {
    assert.equal(parseEmissorBaseUrl(recusado), null, recusado);
  }

  const cliente = readFileSync(join("src", "server", "licensing", "client.ts"), "utf8");
  assert.match(cliente, /redirect: "error"/);
  assert.match(cliente, /cache: "no-store"/);
  assert.doesNotMatch(cliente, /console\./, "o cliente do Emissor não escreve log");
});
