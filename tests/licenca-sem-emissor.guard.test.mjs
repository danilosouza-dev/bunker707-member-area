import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// Guarda de arquitetura (docs/32 §11.2): o produto confere licenças e nunca as assina. Código de assinatura
// dentro de src/ daria a quem quisesse piratear um emissor de licenças pronto: bastaria trocar a chave
// pública gravada. Assinar é trabalho do Emissor (services/bunker-licensing), que nunca vai na imagem do
// comprador. Os testes assinam pelo dublê de tests/support/licenca-de-teste.mjs.

function arquivos(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) {
      return arquivos(caminho);
    }
    return /\.(ts|tsx|js|mjs)$/.test(entrada.name) ? [caminho] : [];
  });
}

const PROIBIDO = [
  { nome: "importar sign, createSign, createPrivateKey ou generateKeyPair de node:crypto", padrao: /import\s*\{[^}]*\b(sign|createSign|createPrivateKey|generateKeyPair|generateKeyPairSync)\b[^}]*\}\s*from\s*["'](node:)?crypto["']/ },
  { nome: "assinar pelo crypto.subtle", padrao: /subtle\s*\.\s*sign\s*\(/ },
  { nome: "chave privada escrita no código", padrao: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { nome: "contexto de assinatura da licença fora do modelo", padrao: /bunker-licensing\/license\/v1/ }
];

test("nenhum arquivo de src/ assina licença nem guarda chave privada", () => {
  const achados = [];

  for (const arquivo of arquivos("src")) {
    const codigo = readFileSync(arquivo, "utf8");

    for (const regra of PROIBIDO) {
      // O contexto mora em model.ts, que só o usa para conferir.
      if (regra.nome.startsWith("contexto") && arquivo === join("src", "server", "licensing", "model.ts")) {
        continue;
      }

      if (regra.padrao.test(codigo)) {
        achados.push(`${arquivo}: ${regra.nome}`);
      }
    }
  }

  assert.deepEqual(achados, []);
});

test("o Verificador confere com verify do node:crypto e não importa nada que assine", () => {
  const codigo = readFileSync(join("src", "server", "licensing", "artifact.ts"), "utf8");

  assert.match(codigo, /verify as verifySignature/);
  assert.doesNotMatch(codigo, /\bsign\s*\(/);
});
