// Confere a licenca assinada (docs/32 §11.3 e §11.4). So confere: nenhuma funcao daqui assina.
//
// Formato do texto (versao 1), cinco partes separadas por ponto:
//
//   BKL1.<certificado>.<assinatura do certificado>.<licenca>.<assinatura da licenca>
//
// - <certificado> e <licenca> sao JSON em base64url canonico (sem preenchimento, sem espaco);
// - a raiz (uma das raizes gravadas no produto) assina o certificado da chave de emissao, que diz para que
//   ela serve (use: "license");
// - a chave de emissao, que mora no Emissor e pode ser trocada sem versao nova do produto, assina a licenca;
// - o texto assinado e o contexto (model.ts) mais a parte em base64url, exatamente como veio.
//
// Ed25519 pelo node:crypto. Erros voltam tipados, sem lancar: quem chama decide o que mostrar.

import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import {
  CERTIFICATE_SIGNING_CONTEXT,
  DAY_MS,
  LICENSE_SIGNING_CONTEXT,
  LICENSE_TOKEN_PREFIX,
  MAX_FILE_VALIDITY_MS,
  MAX_OBSERVATION_AHEAD_MS,
  MAX_PROVISIONAL_AHEAD_MS,
  certificatePayloadSchema,
  isSmallOrderPublicKey,
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
  | "conteudo"
  | "fora_dos_limites";

export type LicenseVerification =
  | { ok: true; license: LicensePayload; certificate: CertificatePayload }
  | { ok: false; error: LicenseVerificationError };

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const ROOT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Base64url canonico: decodificar e codificar de novo devolve o mesmo texto. Sem isso, os bits sobrando no
 * fim de cada parte dariam varios textos para a mesma licenca, e um registro que compare textos se engana.
 */
function decodeCanonical(segment: string): Buffer | null {
  if (!BASE64URL_SEGMENT.test(segment)) {
    return null;
  }

  const bytes = Buffer.from(segment, "base64url");
  return bytes.toString("base64url") === segment ? bytes : null;
}

function decodeJsonSegment(segment: string): unknown {
  const bytes = decodeCanonical(segment);

  if (!bytes) {
    return undefined;
  }

  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
}

function decodeSignature(segment: string): Buffer | null {
  const bytes = decodeCanonical(segment);
  return bytes && bytes.length === 64 ? bytes : null;
}

/** A chave publica Ed25519 a partir dos 32 bytes em base64url; recusa ponto de ordem pequena. */
function ed25519PublicKey(base64urlKey: unknown): KeyObject | null {
  if (typeof base64urlKey !== "string" || !PUBLIC_KEY_PATTERN.test(base64urlKey)) {
    return null;
  }

  const bytes = decodeCanonical(base64urlKey);

  if (!bytes || isSmallOrderPublicKey(bytes)) {
    return null;
  }

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

/** As raizes com o rid pedido, ja em formato de chave; entrada mal formada na lista e ignorada, nunca lanca. */
function rootKeysFor(roots: readonly TrustedRoot[], rid: string): KeyObject[] {
  if (!Array.isArray(roots)) {
    return [];
  }

  const keys: KeyObject[] = [];

  for (const root of roots) {
    if (root && typeof root === "object" && root.rid === rid && ROOT_ID_PATTERN.test(rid)) {
      const key = ed25519PublicKey(root.publicKey);

      if (key) {
        keys.push(key);
      }
    }
  }

  return keys;
}

/**
 * Os limites do que uma licenca pode prometer, alem do formato. A propria licenca afirma quando foi emitida,
 * entao uma chave de emissao vazada poderia emitir com data antiga; estes limites seguram o estrago.
 */
function withinBounds(license: LicensePayload, certificate: CertificatePayload): boolean {
  const issuedAt = Date.parse(license.issuedAt);
  const expiresAt = Date.parse(license.expiresAt);

  if (expiresAt < issuedAt || expiresAt - issuedAt > MAX_FILE_VALIDITY_MS) {
    return false;
  }

  if (expiresAt > Date.parse(certificate.notAfter) + MAX_FILE_VALIDITY_MS) {
    return false;
  }

  if (license.observeUntil !== undefined && Date.parse(license.observeUntil) > issuedAt + MAX_OBSERVATION_AHEAD_MS) {
    return false;
  }

  if (license.provisional && Date.parse(license.provisional.until) > issuedAt + MAX_PROVISIONAL_AHEAD_MS) {
    return false;
  }

  return license.features.every((feature) => feature.until === undefined || Date.parse(feature.until) <= issuedAt + MAX_PROVISIONAL_AHEAD_MS);
}

/**
 * Confere o texto da licenca contra as raizes confiaveis. So devolve `ok: true` quando a raiz e conhecida,
 * as duas assinaturas batem, a chave serve para licenca, a licenca foi emitida dentro do prazo do certificado,
 * o conteudo segue o formato e fica dentro dos limites. Nao olha o relogio para decidir se a licenca vale: isso
 * e da avaliacao (evaluate.ts), que precisa ler uma licenca vencida para mostrar o degrau certo.
 */
export function verifyLicenseToken(token: unknown, roots: readonly TrustedRoot[]): LicenseVerification {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_LICENSE_TOKEN_LENGTH) {
    return { ok: false, error: "formato" };
  }

  const parts = token.split(".");

  if (parts.length !== 5 || parts[0] !== LICENSE_TOKEN_PREFIX) {
    return { ok: false, error: "formato" };
  }

  const [, certificateSegment, certificateSignatureSegment, licenseSegment, licenseSignatureSegment] = parts;
  const certificateSignature = decodeSignature(certificateSignatureSegment);
  const licenseSignature = decodeSignature(licenseSignatureSegment);

  if (!certificateSignature || !licenseSignature || !decodeCanonical(licenseSegment)) {
    return { ok: false, error: "formato" };
  }

  const certificateParsed = certificatePayloadSchema.safeParse(decodeJsonSegment(certificateSegment));

  if (!certificateParsed.success) {
    return { ok: false, error: "formato" };
  }

  const certificate = certificateParsed.data;
  const rootKeys = rootKeysFor(roots, certificate.rid);

  if (rootKeys.length === 0) {
    return { ok: false, error: "raiz_desconhecida" };
  }

  if (!rootKeys.some((key) => signatureMatches(CERTIFICATE_SIGNING_CONTEXT, certificateSegment, certificateSignature, key))) {
    return { ok: false, error: "assinatura_do_certificado" };
  }

  const emissionKey = ed25519PublicKey(certificate.publicKey);

  if (!emissionKey || Date.parse(certificate.notAfter) - Date.parse(certificate.notBefore) > 1100 * DAY_MS) {
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

  // A licenca vale se foi emitida enquanto a chave de emissao valia. A troca da chave de emissao nao derruba as
  // licencas ja emitidas. A data de emissao e afirmada pela propria chave: os limites abaixo seguram uma chave vazada.
  if (!(issuedAt >= Date.parse(certificate.notBefore) && issuedAt <= Date.parse(certificate.notAfter))) {
    return { ok: false, error: "certificado_fora_do_prazo" };
  }

  if (!withinBounds(license, certificate)) {
    return { ok: false, error: "fora_dos_limites" };
  }

  return { ok: true, license, certificate };
}
