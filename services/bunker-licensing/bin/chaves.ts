// Cerimonia das chaves do Emissor (docs/32 §10 e fase 0 do §12). Roda num computador fora de qualquer
// servidor, de preferencia desligado da internet. As senhas chegam por variavel de ambiente, nunca por
// argumento (argumento fica no historico do terminal e na lista de processos).
//
//   node bin/chaves.ts raiz --rid raiz-2026 --saida raiz-2026.pem
//       senha em BUNKER_SENHA_RAIZ. Grava a raiz cifrada e mostra {rid, publicKey}, que vai para
//       BUNKER_LICENSING_ROOTS no build do produto. Rode duas vezes: a raiz e a raiz de reserva.
//
//   node bin/chaves.ts emissao --raiz raiz-2026.pem --rid raiz-2026 --kid emissao-2026-11 --dias 400 --saida emissao-2026-11.pem
//       senhas em BUNKER_SENHA_RAIZ e BUNKER_SENHA_EMISSAO. Gera a chave de emissao cifrada, que vai para
//       os segredos do Emissor, e mostra o certificado assinado pela raiz, que vai para a configuracao dele.
//
//   node bin/chaves.ts publica --chave raiz-2026.pem
//       senha em BUNKER_SENHA_CHAVE. Mostra a chave publica de uma chave guardada.
//
// Nenhum arquivo existente e sobrescrito; os arquivos gravados so podem ser lidos pelo dono (0600).

import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { exportEncryptedPrivateKey, generateSigningKey, importEncryptedPrivateKey } from "../src/keys.ts";
import { LICENSE_FORMAT_VERSION, publicKeyText, signCertificate } from "../src/signing.ts";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

class UsageError extends Error {}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new UsageError(`Falta --${name}.`);
  }

  return value;
}

function identifier(value: string | undefined, name: string): string {
  const text = required(value, name);

  if (!ID_PATTERN.test(text)) {
    throw new UsageError(`--${name} aceita so letras minusculas, numeros e hifen (ate 64): ${text}`);
  }

  return text;
}

function secret(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new UsageError(`Defina a senha em ${name} (variavel de ambiente), nunca como argumento.`);
  }

  return value;
}

function writeNew(path: string, content: string): void {
  try {
    writeFileSync(path, content, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new UsageError(`${path} ja existe. Nenhuma chave e sobrescrita: escolha outro nome.`);
    }

    throw error;
  }
}

function commandRoot(args: string[]): unknown {
  const { values } = parseArgs({ args, options: { rid: { type: "string" }, saida: { type: "string" } } });
  const rid = identifier(values.rid, "rid");
  const output = required(values.saida, "saida");
  const key = generateSigningKey();

  writeNew(output, exportEncryptedPrivateKey(key, secret("BUNKER_SENHA_RAIZ")));
  return { rid, publicKey: publicKeyText(key) };
}

function commandEmission(args: string[]): unknown {
  const { values } = parseArgs({
    args,
    options: {
      raiz: { type: "string" },
      rid: { type: "string" },
      kid: { type: "string" },
      dias: { type: "string" },
      saida: { type: "string" },
      inicio: { type: "string" }
    }
  });
  const rid = identifier(values.rid, "rid");
  const kid = identifier(values.kid, "kid");
  const days = Number(required(values.dias, "dias"));
  const output = required(values.saida, "saida");

  if (!Number.isInteger(days) || days < 1 || days > 1100) {
    throw new UsageError("--dias precisa ser um numero inteiro de 1 a 1100.");
  }

  const start = values.inicio ? new Date(values.inicio) : new Date();

  if (Number.isNaN(start.getTime())) {
    throw new UsageError(`--inicio nao e uma data: ${values.inicio}`);
  }

  const root = importEncryptedPrivateKey(readFileSync(required(values.raiz, "raiz"), "utf8"), secret("BUNKER_SENHA_RAIZ"));
  const emission = generateSigningKey();
  const certificate = signCertificate(root, {
    v: LICENSE_FORMAT_VERSION,
    use: "license",
    kid,
    rid,
    publicKey: publicKeyText(emission),
    notBefore: start.toISOString(),
    notAfter: new Date(start.getTime() + days * DAY_MS).toISOString()
  });

  writeNew(output, exportEncryptedPrivateKey(emission, secret("BUNKER_SENHA_EMISSAO")));
  return { kid, rid, certificate: { segment: certificate.segment, signature: certificate.signature } };
}

function commandPublic(args: string[]): unknown {
  const { values } = parseArgs({ args, options: { chave: { type: "string" } } });
  const key = importEncryptedPrivateKey(readFileSync(required(values.chave, "chave"), "utf8"), secret("BUNKER_SENHA_CHAVE"));
  return { publicKey: publicKeyText(key) };
}

const COMMANDS: Record<string, (args: string[]) => unknown> = {
  raiz: commandRoot,
  emissao: commandEmission,
  publica: commandPublic
};

const [command, ...rest] = process.argv.slice(2);
const run = command ? COMMANDS[command] : undefined;

try {
  if (!run) {
    throw new UsageError(`Comando: ${Object.keys(COMMANDS).join(", ")}. Veja o comeco de bin/chaves.ts.`);
  }

  process.stdout.write(`${JSON.stringify(run(rest), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
}
