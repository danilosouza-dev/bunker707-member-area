// Duble de src/signing.ts do bunker-licensing (so o certificado da chave de emissao), para os testes da cerimonia.
import { createPublicKey, sign } from "node:crypto";

export const LICENSE_FORMAT_VERSION = 1;
export const CERTIFICATE_SIGNING_CONTEXT = "bunker-licensing/certificate/v1\n";

export function publicKeyText(key) {
  return createPublicKey(key).export({ format: "jwk" }).x;
}

export function signCertificate(rootPrivateKey, payload) {
  const segment = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(null, Buffer.from(`${CERTIFICATE_SIGNING_CONTEXT}${segment}`, "utf8"), rootPrivateKey).toString("base64url");
  return { kid: payload.kid, segment, signature };
}
