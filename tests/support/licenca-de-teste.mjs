import { generateKeyPairSync, sign } from "node:crypto";

// Dublê do Emissor para os testes do Verificador (docs/32 §11.2 e §11.4). Gera raízes e chaves de emissão
// de mentira e assina licenças no formato BKL1. Fica só em tests/: o produto nunca assina licença
// (tests/licenca-sem-emissor.guard.test.mjs). O Emissor de verdade (services/bunker-licensing) terá o
// mesmo formato; os contextos e o prefixo abaixo são os de src/server/licensing/model.ts.

export const PREFIXO = "BKL1";
export const CONTEXTO_CERTIFICADO = "bunker-licensing/certificate/v1\n";
export const CONTEXTO_LICENCA = "bunker-licensing/license/v1\n";

function segmento(objeto) {
  return Buffer.from(JSON.stringify(objeto), "utf8").toString("base64url");
}

function assinar(contexto, parte, chavePrivada) {
  return sign(null, Buffer.from(`${contexto}${parte}`, "utf8"), chavePrivada).toString("base64url");
}

/** Um par Ed25519 com a chave pública no formato do produto (os 32 bytes em base64url). */
export function novoParDeChaves() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { publicKey: publicKey.export({ format: "jwk" }).x, privateKey };
}

/** Uma raiz: o identificador vai no certificado; a chave pública vai gravada no produto. */
export function novaRaiz(rid = "raiz-teste") {
  const par = novoParDeChaves();
  return { rid, publicKey: par.publicKey, privateKey: par.privateKey, confiavel: { rid, publicKey: par.publicKey } };
}

/** Certificado da chave de emissão, assinado pela raiz. */
export function novaChaveDeEmissao(raiz, opcoes = {}) {
  const par = novoParDeChaves();
  const certificado = {
    v: 1,
    kid: opcoes.kid ?? "emissao-teste",
    rid: opcoes.rid ?? raiz.rid,
    publicKey: par.publicKey,
    notBefore: opcoes.notBefore ?? "2026-01-01T00:00:00.000Z",
    notAfter: opcoes.notAfter ?? "2030-01-01T00:00:00.000Z"
  };
  const parteCertificado = segmento(certificado);
  return {
    kid: certificado.kid,
    privateKey: par.privateKey,
    parteCertificado,
    assinaturaCertificado: assinar(CONTEXTO_CERTIFICADO, parteCertificado, opcoes.assinarCom ?? raiz.privateKey)
  };
}

/** Licença de exemplo: anual, em dia, num endereço, com os Webinários ligados. */
export function licencaBase(sobrescrever = {}) {
  return {
    v: 1,
    kid: "emissao-teste",
    licenseId: "lic_0001",
    holder: { name: "Escola de Teste Ltda" },
    installation: { id: "inst_0001", host: "alunos.escola.test" },
    issuedAt: "2026-11-10T12:00:00.000Z",
    expiresAt: "2027-02-08T12:00:00.000Z",
    plan: { kind: "annual", validUntil: "2027-11-10T23:59:59.000Z", steps: [] },
    features: [{ key: "webinars" }],
    ...sobrescrever
  };
}

/** Assina a licença com a chave de emissão e monta o texto BKL1. */
export function assinarLicenca(chaveDeEmissao, licenca, opcoes = {}) {
  const parteLicenca = segmento(licenca);
  const assinatura = assinar(CONTEXTO_LICENCA, parteLicenca, opcoes.assinarCom ?? chaveDeEmissao.privateKey);
  return [PREFIXO, chaveDeEmissao.parteCertificado, chaveDeEmissao.assinaturaCertificado, parteLicenca, assinatura].join(".");
}

/** Os passos datados que o Emissor manda para a Licença anual vencendo (docs/32 §2.2): 30 dias antes, 15 de carência, 16º e 46º dia. */
export function passosDaAnual(validadeIso) {
  const fim = Date.parse(validadeIso);
  const dia = 24 * 60 * 60 * 1000;
  return [
    { degree: "aviso", from: new Date(fim - 30 * dia).toISOString(), reason: "anual_vencendo" },
    { degree: "aviso", from: new Date(fim).toISOString(), reason: "anual_carencia" },
    { degree: "admin_limitado", from: new Date(fim + 15 * dia).toISOString(), reason: "anual_vencida" },
    { degree: "escola_congelada", from: new Date(fim + 45 * dia).toISOString(), reason: "anual_vencida" }
  ];
}
