// Assinatura das licencas no formato BKL1 (docs/32 §11.2 e §11.4). Este e o unico lugar do repositorio que
// assina licenca de verdade. Mora em services/, que o .dockerignore tira da imagem do produto, e a guarda
// tests/licenca-sem-emissor.guard.test.mjs impede que codigo de assinatura entre em src/.
//
// O formato e o mesmo que o Verificador confere (src/server/licensing/artifact.ts):
//
//   BKL1.<certificado>.<assinatura do certificado>.<licenca>.<assinatura da licenca>
//
// - <certificado> e <licenca> sao JSON em base64url;
// - a raiz assina o certificado da chave de emissao; a chave de emissao assina a licenca;
// - o texto assinado e o contexto mais a parte em base64url, exatamente como vai no texto.
// O vetor fixo em tests/fixtures/licenca-vetor.json prende os dois lados ao mesmo formato.

import { createPublicKey, sign, type KeyObject } from "node:crypto";

export const LICENSE_TOKEN_PREFIX = "BKL1";
export const LICENSE_FORMAT_VERSION = 1;
export const CERTIFICATE_SIGNING_CONTEXT = "bunker-licensing/certificate/v1\n";
export const LICENSE_SIGNING_CONTEXT = "bunker-licensing/license/v1\n";

export type CertificatePayload = {
  v: 1;
  kid: string;
  rid: string;
  publicKey: string;
  notBefore: string;
  notAfter: string;
};

/** O certificado ja assinado pela raiz: as duas partes que vao no comeco de toda licenca daquela chave. */
export type SignedCertificate = { kid: string; segment: string; signature: string };

function segmentOf(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function signSegment(context: string, segment: string, privateKey: KeyObject): string {
  return sign(null, Buffer.from(`${context}${segment}`, "utf8"), privateKey).toString("base64url");
}

function assertEd25519Private(key: KeyObject): void {
  if (key.type !== "private" || key.asymmetricKeyType !== "ed25519") {
    throw new Error("A chave precisa ser uma chave privada Ed25519.");
  }
}

/** A chave publica Ed25519 no formato do produto: os 32 bytes em base64url (o `x` da JWK). */
export function publicKeyText(key: KeyObject): string {
  const jwk = createPublicKey(key).export({ format: "jwk" });

  if (typeof jwk.x !== "string") {
    throw new Error("A chave nao e Ed25519.");
  }

  return jwk.x;
}

/** A raiz assina o certificado da chave de emissao. Roda fora de servidor, na cerimonia das chaves. */
export function signCertificate(rootPrivateKey: KeyObject, payload: CertificatePayload): SignedCertificate {
  assertEd25519Private(rootPrivateKey);

  if (Date.parse(payload.notAfter) <= Date.parse(payload.notBefore)) {
    throw new Error("O fim do certificado precisa vir depois do comeco.");
  }

  const segment = segmentOf(payload);
  return { kid: payload.kid, segment, signature: signSegment(CERTIFICATE_SIGNING_CONTEXT, segment, rootPrivateKey) };
}

/**
 * A chave de emissao assina a licenca. A licenca precisa citar a mesma chave (`kid`) do certificado, e o
 * formato do conteudo e conferido pelo Verificador; aqui so se garante que o texto sai montado certo.
 */
export function signLicense(emissionPrivateKey: KeyObject, certificate: SignedCertificate, payload: { kid: string } & Record<string, unknown>): string {
  assertEd25519Private(emissionPrivateKey);

  if (payload.kid !== certificate.kid) {
    throw new Error(`A licenca cita a chave ${payload.kid}, mas o certificado e da chave ${certificate.kid}.`);
  }

  const segment = segmentOf(payload);
  const signature = signSegment(LICENSE_SIGNING_CONTEXT, segment, emissionPrivateKey);
  return [LICENSE_TOKEN_PREFIX, certificate.segment, certificate.signature, segment, signature].join(".");
}
