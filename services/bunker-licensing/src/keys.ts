// Chaves do Emissor (docs/32 §10, Duas chaves). A raiz fica fora de qualquer servidor e so assina o
// certificado da chave de emissao; a chave de emissao mora no Emissor e pode ser trocada sem versao nova do
// produto. As duas sao Ed25519. A chave privada so sai daqui cifrada (PKCS#8 com AES-256 e senha).

import { createPrivateKey, generateKeyPairSync, type KeyObject } from "node:crypto";

/** Tamanho minimo da senha que cifra uma chave privada. */
export const MIN_PASSPHRASE_LENGTH = 16;

export function generateSigningKey(): KeyObject {
  return generateKeyPairSync("ed25519").privateKey;
}

/** A chave privada cifrada com a senha, em PEM. Sem senha forte, recusa. */
export function exportEncryptedPrivateKey(key: KeyObject, passphrase: string): string {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`A senha da chave precisa ter pelo menos ${MIN_PASSPHRASE_LENGTH} caracteres.`);
  }

  return key.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase }) as string;
}

/** Le a chave privada cifrada. Recusa PEM sem cifra: chave de assinatura nunca fica em texto aberto no disco. */
export function importEncryptedPrivateKey(pem: string, passphrase: string): KeyObject {
  if (!pem.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----")) {
    throw new Error("A chave precisa estar cifrada com senha (ENCRYPTED PRIVATE KEY).");
  }

  const key = createPrivateKey({ key: pem, format: "pem", passphrase });

  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("A chave nao e Ed25519.");
  }

  return key;
}
