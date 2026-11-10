// Confere a licenca assinada (docs/32 §11.3 e §11.4). So confere: nenhuma funcao daqui assina.
//
// Formato do texto (versao 1), cinco partes separadas por ponto:
//
//   BKL1.<certificado>.<assinatura do certificado>.<licenca>.<assinatura da licenca>
//
// - <certificado> e <licenca> sao JSON em base64url;
// - a raiz (uma das raizes gravadas no produto) assina o certificado da chave de emissao;
// - a chave de emissao, que mora no Emissor e pode ser trocada sem versao nova do produto, assina a licenca;
// - o texto assinado e o contexto (model.ts) mais a parte em base64url, exatamente como veio.
//
// Ed25519 pelo node:crypto. Erros voltam tipados, sem lancar: quem chama decide o que mostrar.

import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import {
  CERTIFICATE_SIGNING_CONTEXT,
  LICENSE_SIGNING_CONTEXT,
  LICENSE_TOKEN_PREFIX,
  certificatePayloadSchema,
  licensePayloadSchema,
  type CertificatePayload,
  type LicensePayload,
  type TrustedRoot
} from "./model";

/** Tamanho maximo do texto da licenca: uma licenca normal fica abaixo de 4 KB. */
export const MAX_LICENSE_TOKEN_LENGTH = 16_384;

export type LicenseVerificationError =
  | "formato"
  | "raiz_desconhecida"
  | "assinatura_do_certificado"
  | "certificado_fora_do_prazo"
  | "chave_diferente"
  | "assinatura_da_licenca"
  | "conteudo";

export type LicenseVerification =
  | { ok: true; license: LicensePayload; certificate: CertificatePayload }
  | { ok: false; error: LicenseVerificationError };

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

function decodeJsonSegment(segment: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function decodeSignature(segment: string): Buffer | null {
  const bytes = Buffer.from(segment, "base64url");
  return bytes.length === 64 ? bytes : null;
}

function ed25519PublicKey(base64urlKey: string): KeyObject | null {
  try {
    return createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: base64urlKey }, format: "jwk" });
  } catch {
    return null;
  }
}

function signatureMatches(context: string, segment: string, signature: Buffer, key: KeyObject): boolean {
  try {
    return verifySignature(null, Buffer.from(`${context}${segment}`, "utf8"), key, signature);
  } catch {
    return false;
  }
}

/**
 * Confere o texto da licenca contra as raizes confiaveis. So devolve `ok: true` quando a raiz e
 * conhecida, as duas assinaturas batem, a licenca foi emitida dentro do prazo do certificado e o
 * conteudo segue o formato. Nao olha o relogio para decidir se a licenca vale: isso e da avaliacao
 * (evaluate.ts), que precisa ler uma licenca vencida para mostrar o degrau certo.
 */
export function verifyLicenseToken(token: string, roots: readonly TrustedRoot[]): LicenseVerification {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_LICENSE_TOKEN_LENGTH) {
    return { ok: false, error: "formato" };
  }

  const parts = token.trim().split(".");

  if (parts.length !== 5 || parts[0] !== LICENSE_TOKEN_PREFIX || !parts.slice(1).every((part) => BASE64URL_SEGMENT.test(part))) {
    return { ok: false, error: "formato" };
  }

  const [, certificateSegment, certificateSignatureSegment, licenseSegment, licenseSignatureSegment] = parts;
  const certificateSignature = decodeSignature(certificateSignatureSegment);
  const licenseSignature = decodeSignature(licenseSignatureSegment);

  if (!certificateSignature || !licenseSignature) {
    return { ok: false, error: "formato" };
  }

  const certificateParsed = certificatePayloadSchema.safeParse(decodeJsonSegment(certificateSegment));

  if (!certificateParsed.success) {
    return { ok: false, error: "formato" };
  }

  const certificate = certificateParsed.data;
  const root = roots.find((candidate) => candidate.rid === certificate.rid);
  const rootKey = root ? ed25519PublicKey(root.publicKey) : null;

  if (!rootKey) {
    return { ok: false, error: "raiz_desconhecida" };
  }

  if (!signatureMatches(CERTIFICATE_SIGNING_CONTEXT, certificateSegment, certificateSignature, rootKey)) {
    return { ok: false, error: "assinatura_do_certificado" };
  }

  const emissionKey = ed25519PublicKey(certificate.publicKey);

  if (!emissionKey) {
    return { ok: false, error: "assinatura_do_certificado" };
  }

  if (!signatureMatches(LICENSE_SIGNING_CONTEXT, licenseSegment, licenseSignature, emissionKey)) {
    return { ok: false, error: "assinatura_da_licenca" };
  }

  const licenseParsed = licensePayloadSchema.safeParse(decodeJsonSegment(licenseSegment));

  if (!licenseParsed.success) {
    return { ok: false, error: "conteudo" };
  }

  const license = licenseParsed.data;

  if (license.kid !== certificate.kid) {
    return { ok: false, error: "chave_diferente" };
  }

  const issuedAt = Date.parse(license.issuedAt);

  // A licenca vale se foi emitida enquanto a chave de emissao valia. Assim a troca da chave de emissao
  // nao derruba as licencas ja emitidas, e uma chave aposentada nao emite licenca nova.
  if (issuedAt < Date.parse(certificate.notBefore) || issuedAt > Date.parse(certificate.notAfter)) {
    return { ok: false, error: "certificado_fora_do_prazo" };
  }

  return { ok: true, license, certificate };
}
