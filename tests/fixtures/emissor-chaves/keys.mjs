// Duble de src/keys.ts do bunker-licensing (o codigo das chaves dentro da imagem do Emissor), so para os testes da
// cerimonia-licencas (tests/infra-licencas-cerimonia.test.mjs): a mesma API e o mesmo formato (Ed25519, PKCS#8 cifrado
// com AES-256 e senha). A cerimonia de verdade roda o codigo do Emissor, na imagem do GHCR.
import { createPrivateKey, generateKeyPairSync } from "node:crypto";

export const MIN_PASSPHRASE_LENGTH = 16;

export function generateSigningKey() {
  return generateKeyPairSync("ed25519").privateKey;
}

export function exportEncryptedPrivateKey(key, passphrase) {
  if (typeof passphrase !== "string" || passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error("senha curta");
  return key.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase });
}

export function importEncryptedPrivateKey(pem, passphrase) {
  if (!pem.includes("-----BEGIN ENCRYPTED PRIVATE KEY-----")) throw new Error("A chave precisa estar cifrada com senha.");
  const key = createPrivateKey({ key: pem, format: "pem", passphrase });
  if (key.asymmetricKeyType !== "ed25519") throw new Error("A chave nao e Ed25519.");
  return key;
}
