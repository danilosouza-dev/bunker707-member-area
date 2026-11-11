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
// Ed25519 conferido duas vezes, e as duas tem de aceitar (docs/32 §7.1, medida 7): pelo node:crypto e por uma
// implementacao em JavaScript puro embutida no produto (@noble/ed25519, com o SHA-512 tambem em JavaScript puro, de
// @noble/hashes). O comprador e dono do compose e pode mandar o Node carregar um arquivo antes do produto (NODE_OPTIONS
// ou a linha de comando) que troca o crypto.verify por um que sempre aceita; a revisao de 11/11/2026 fez isso e uma
// licenca forjada passou. Com a segunda conferencia, trocar so o node:crypto nao basta, e o produto vendido nem sobe com
// essas opcoes (node-start.ts). E um obstaculo, nao uma trava: quem altera a imagem passa pelos dois. Erros voltam
// tipados, sem lancar: quem chama decide o que mostrar.

import { createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";
import { hashes as ed25519Hashes, verify as verifyEd25519 } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
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

/** A chave publica Ed25519 nos dois formatos: o do node:crypto e os 32 bytes, para a conferencia em JavaScript puro. */
type Ed25519PublicKey = { object: KeyObject; bytes: Uint8Array };

/** A chave publica Ed25519 a partir dos 32 bytes em base64url; recusa ponto de ordem pequena. */
function ed25519PublicKey(base64urlKey: unknown): Ed25519PublicKey | null {
  if (typeof base64urlKey !== "string" || !PUBLIC_KEY_PATTERN.test(base64urlKey)) {
    return null;
  }

  const bytes = decodeCanonical(base64urlKey);

  if (!bytes || isSmallOrderPublicKey(bytes)) {
    return null;
  }

  try {
    return { object: createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: base64urlKey }, format: "jwk" }), bytes: new Uint8Array(bytes) };
  } catch {
    return null;
  }
}

/** A conferencia do node:crypto (OpenSSL). Rapida; um arquivo carregado antes do produto consegue troca-la. */
function nodeCryptoAccepts(message: Buffer, signature: Buffer, key: Ed25519PublicKey): boolean {
  try {
    return verifySignature(null, message, key.object, signature) === true;
  } catch {
    return false;
  }
}

/**
 * A conferencia em JavaScript puro, embutida no produto: RFC 8032 estrita (zip215: false), que recusa encodificacao nao
 * canonica e chave de ordem pequena, com o SHA-512 tambem em JavaScript puro (o do node:crypto ou o do crypto.subtle
 * poderia ser trocado como o verify). O SHA-512 e posto de novo antes de cada conferencia.
 */
function pureJavaScriptAccepts(message: Buffer, signature: Buffer, key: Ed25519PublicKey): boolean {
  try {
    ed25519Hashes.sha512 = sha512;
    return verifyEd25519(new Uint8Array(signature), new Uint8Array(message), key.bytes, { zip215: false }) === true;
  } catch {
    return false;
  }
}

/** A assinatura so confere se as duas conferencias aceitam. A do node:crypto vem primeiro: recusa o que e lixo sem custo. */
function signatureMatches(context: string, segment: string, signature: Buffer, key: Ed25519PublicKey): boolean {
  const message = Buffer.from(`${context}${segment}`, "utf8");
  return nodeCryptoAccepts(message, signature, key) && pureJavaScriptAccepts(message, signature, key);
}

/** As raizes com o rid pedido, ja em formato de chave; entrada mal formada na lista e ignorada, nunca lanca. */
function rootKeysFor(roots: readonly TrustedRoot[], rid: string): Ed25519PublicKey[] {
  if (!Array.isArray(roots)) {
    return [];
  }

  const keys: Ed25519PublicKey[] = [];

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
 * A memoria das conferencias deste processo: a conferencia em JavaScript puro custa alguns milissegundos por
 * assinatura, e a situacao da licenca e montada a cada pedido com a mesma licenca guardada. A conferencia nao depende do
 * relogio, so do texto e das raizes, entao o resultado de um par vale enquanto o processo vive. Poucas entradas: a
 * licenca guardada muda uma vez por dia. Cada leitura devolve uma copia.
 */
const VERIFICATION_MEMORY_SIZE = 8;
const verificationMemory = new Map<string, LicenseVerification>();

function verificationMemoryKey(token: string, roots: readonly TrustedRoot[]): string | null {
  if (!Array.isArray(roots)) {
    return null;
  }

  const rootsText = JSON.stringify(roots.map((root) => (root && typeof root === "object" ? [String(root.rid), String(root.publicKey)] : null)));
  return `${rootsText}\n${token}`;
}

/**
 * Confere o texto da licenca contra as raizes confiaveis. So devolve `ok: true` quando a raiz e conhecida,
 * as duas assinaturas batem (cada uma pelo node:crypto e pela conferencia em JavaScript puro), a chave serve para
 * licenca, a licenca foi emitida dentro do prazo do certificado, o conteudo segue o formato e fica dentro dos limites.
 * Nao olha o relogio para decidir se a licenca vale: isso e da avaliacao (evaluate.ts), que precisa ler uma licenca
 * vencida para mostrar o degrau certo.
 */
export function verifyLicenseToken(token: unknown, roots: readonly TrustedRoot[]): LicenseVerification {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_LICENSE_TOKEN_LENGTH) {
    return { ok: false, error: "formato" };
  }

  const key = verificationMemoryKey(token, roots);
  const remembered = key === null ? undefined : verificationMemory.get(key);

  if (remembered) {
    return structuredClone(remembered);
  }

  const verification = verifyUncached(token, roots);

  if (key !== null) {
    verificationMemory.set(key, structuredClone(verification));

    if (verificationMemory.size > VERIFICATION_MEMORY_SIZE) {
      const oldest = verificationMemory.keys().next().value;

      if (oldest !== undefined) {
        verificationMemory.delete(oldest);
      }
    }
  }

  return verification;
}

function verifyUncached(token: string, roots: readonly TrustedRoot[]): LicenseVerification {
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
