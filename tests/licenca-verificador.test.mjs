import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import {
  CONTEXTO_CERTIFICADO,
  assinarLicenca,
  licencaBase,
  novaChaveDeEmissao,
  novaRaiz,
  passosDaAnual
} from "./support/licenca-de-teste.mjs";

// Núcleo do Verificador de licença (docs/32 §2.2, §11.3 e §11.4): a conferência da licença assinada e a
// situação que ela dá à escola. Um teste por situação do §2.2 que já dá para reproduzir sem banco, e um por
// achado da revisão independente de 10/11/2026 (datas inválidas, licença ilegível, plano provisório, relógio,
// limites do que uma chave vazada consegue emitir, endereço).

const { verifyLicenseToken } = await import("../src/server/licensing/artifact.ts");
const { daysUntil, evaluateLicense, isFeatureOn, normalizeHost, resolveTrustedNow, sameHost } = await import(
  "../src/server/licensing/evaluate.ts"
);
const { LICENSE_NOTICE, allowsActionClass } = await import("../src/server/licensing/model.ts");

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const iso = (ms) => new Date(ms).toISOString();
const raiz = novaRaiz("raiz-2026");
const raizDeReserva = novaRaiz("raiz-reserva");
const RAIZES = [raiz.confiavel, raizDeReserva.confiavel];
const emissao = novaChaveDeEmissao(raiz);
const VALIDADE = "2027-11-10T23:59:59-03:00";

function conferida(licenca = licencaBase(), chave = emissao) {
  const resultado = verifyLicenseToken(assinarLicenca(chave, licenca), RAIZES);
  assert.equal(resultado.ok, true, `a licença de teste confere: ${JSON.stringify(resultado)}`);
  return resultado.license;
}

/** A licença que a conferência diária deixaria guardada: emitida 1 h antes do instante, valendo 90 dias. */
function emitidaEm(instante, sobrescrever = {}) {
  const emitida = Date.parse(instante) - HORA;
  return conferida(licencaBase({ issuedAt: iso(emitida), expiresAt: iso(emitida + 90 * DIA), ...sobrescrever }));
}

function avaliar(licenca, opcoes) {
  return evaluateLicense({
    license: licenca,
    everActivated: true,
    unreadableSince: null,
    now: opcoes.agora instanceof Date ? opcoes.agora : new Date(opcoes.agora),
    configuredHost: opcoes.endereco ?? "alunos.escola.test",
    hostMismatchSince: opcoes.enderecoDiferenteDesde ?? null
  });
}

function ilegivel(agora, desde) {
  return evaluateLicense({
    license: null,
    everActivated: true,
    unreadableSince: desde,
    now: new Date(agora),
    configuredHost: "alunos.escola.test",
    hostMismatchSince: null
  });
}

const anual = (sobrescrever = {}) => ({ plan: { kind: "annual", validUntil: VALIDADE, steps: passosDaAnual(VALIDADE) }, ...sobrescrever });

// ---- Conferência da assinatura ---------------------------------------------------------------------------

test("licença emitida pela nossa chave confere e devolve o titular, o endereço e os módulos", () => {
  const licenca = conferida();

  assert.equal(licenca.holder.name, "Escola de Teste Ltda");
  assert.equal(licenca.installation.host, "alunos.escola.test");
  assert.deepEqual(licenca.features, [{ key: "webinars" }]);
  assert.equal(licenca.delivery, "online");
  assert.deepEqual(licenca.statusSteps, []);
});

test("licença com o conteúdo trocado depois de assinada não confere", () => {
  const partes = assinarLicenca(emissao, licencaBase()).split(".");
  partes[3] = Buffer.from(JSON.stringify({ ...licencaBase(), features: [{ key: "webinars" }, { key: "modulo-pago" }] })).toString("base64url");

  assert.deepEqual(verifyLicenseToken(partes.join("."), RAIZES), { ok: false, error: "assinatura_da_licenca" });
});

test("licença assinada por uma raiz que o produto não conhece é recusada, mesmo com o nome da nossa", () => {
  const raizPirata = novaRaiz("raiz-pirata");
  assert.deepEqual(verifyLicenseToken(assinarLicenca(novaChaveDeEmissao(raizPirata), licencaBase()), RAIZES), {
    ok: false,
    error: "raiz_desconhecida"
  });

  const comNossoNome = novaChaveDeEmissao(raizPirata, { rid: "raiz-2026" });
  assert.deepEqual(verifyLicenseToken(assinarLicenca(comNossoNome, licencaBase()), RAIZES), {
    ok: false,
    error: "assinatura_do_certificado"
  });
});

test("separação de domínio: a raiz não assina licença, e a chave de emissão assinando no contexto do certificado não vale", () => {
  assert.deepEqual(verifyLicenseToken(assinarLicenca(emissao, licencaBase(), { assinarCom: raiz.privateKey }), RAIZES), {
    ok: false,
    error: "assinatura_da_licenca"
  });

  // Mesma chave, mesmo conteúdo, só o contexto trocado: a assinatura não serve.
  assert.deepEqual(verifyLicenseToken(assinarLicenca(emissao, licencaBase(), { contexto: CONTEXTO_CERTIFICADO }), RAIZES), {
    ok: false,
    error: "assinatura_da_licenca"
  });

  const partes = assinarLicenca(emissao, licencaBase()).split(".");
  assert.equal(verifyLicenseToken([partes[0], partes[1], partes[2], partes[1], partes[2]].join("."), RAIZES).ok, false);
});

test("chave certificada para outro uso (a dos pacotes, por exemplo) nunca emite licença", () => {
  const pacotes = novaChaveDeEmissao(raiz, { use: "packages" });
  assert.deepEqual(verifyLicenseToken(assinarLicenca(pacotes, licencaBase()), RAIZES), { ok: false, error: "formato" });
});

test("licença emitida fora do prazo da chave de emissão é recusada; a emitida dentro continua valendo depois", () => {
  const aposentada = novaChaveDeEmissao(raiz, { notBefore: "2026-01-01T00:00:00.000Z", notAfter: "2026-06-30T23:59:59.000Z" });

  assert.deepEqual(verifyLicenseToken(assinarLicenca(aposentada, licencaBase()), RAIZES), { ok: false, error: "certificado_fora_do_prazo" });

  const antiga = licencaBase({ issuedAt: "2026-05-01T12:00:00.000Z", expiresAt: "2026-07-30T12:00:00.000Z" });
  assert.equal(verifyLicenseToken(assinarLicenca(aposentada, antiga), RAIZES).ok, true);
});

test("chave de emissão vazada não emite licença longa: arquivo, observação, compra e módulo provisórios têm teto", () => {
  const aposentada = novaChaveDeEmissao(raiz, { notBefore: "2026-01-01T00:00:00.000Z", notAfter: "2026-06-30T23:59:59.000Z" });
  const datadaNoPassado = { issuedAt: "2026-06-30T23:00:00.000Z" };
  const casos = [
    { expiresAt: "2099-01-01T00:00:00.000Z" },
    { expiresAt: "2026-09-01T00:00:00.000Z", observeUntil: "2099-01-01T00:00:00.000Z" },
    { expiresAt: "2026-09-01T00:00:00.000Z", features: [{ key: "webinars", until: "2099-01-01T00:00:00.000Z" }] },
    {
      expiresAt: "2026-09-01T00:00:00.000Z",
      provisional: { kind: "lifetime", steps: [], until: "2099-01-01T00:00:00.000Z" }
    },
    { expiresAt: "2026-06-01T00:00:00.000Z" }
  ];

  for (const caso of casos) {
    assert.deepEqual(verifyLicenseToken(assinarLicenca(aposentada, licencaBase({ ...datadaNoPassado, ...caso })), RAIZES), {
      ok: false,
      error: "fora_dos_limites"
    }, JSON.stringify(caso));
  }
});

test("certificado de chave de emissão com mais de 1.100 dias é recusado", () => {
  const longa = novaChaveDeEmissao(raiz, { notBefore: "2026-01-01T00:00:00.000Z", notAfter: "2030-01-01T00:00:00.000Z" });
  assert.deepEqual(verifyLicenseToken(assinarLicenca(longa, licencaBase()), RAIZES), { ok: false, error: "assinatura_do_certificado" });
});

test("a raiz de reserva também confere, raízes repetidas ou mal formadas não quebram, e a licença precisa citar a chave", () => {
  const daReserva = novaChaveDeEmissao(raizDeReserva, { kid: "emissao-reserva" });
  assert.equal(verifyLicenseToken(assinarLicenca(daReserva, licencaBase({ kid: "emissao-reserva" })), RAIZES).ok, true);
  assert.deepEqual(verifyLicenseToken(assinarLicenca(daReserva, licencaBase({ kid: "outra" })), RAIZES), { ok: false, error: "chave_diferente" });

  const outra = novaRaiz("raiz-2026");
  const texto = assinarLicenca(emissao, licencaBase());
  assert.equal(verifyLicenseToken(texto, [null, { rid: 1 }, outra.confiavel, raiz.confiavel]).ok, true, "tenta toda raiz com o mesmo rid");
  assert.deepEqual(verifyLicenseToken(texto, [null, { rid: "raiz-2026", publicKey: "curta" }]), { ok: false, error: "raiz_desconhecida" });
  assert.deepEqual(verifyLicenseToken(texto, null), { ok: false, error: "raiz_desconhecida" });
});

test("chave pública de ordem pequena é recusada: nem raiz nem chave de emissão aceitam assinatura sem chave privada", () => {
  const identidade = Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]).toString("base64url");
  const assinaturaVazia = Buffer.concat([Buffer.from([1]), Buffer.alloc(63)]).toString("base64url");
  const certificado = Buffer.from(
    JSON.stringify({ v: 1, use: "license", kid: "emissao-teste", rid: "raiz-2026", publicKey: identidade, notBefore: "2026-01-01T00:00:00.000Z", notAfter: "2027-01-01T00:00:00.000Z" })
  ).toString("base64url");
  const licenca = Buffer.from(JSON.stringify(licencaBase())).toString("base64url");
  const texto = ["BKL1", certificado, assinaturaVazia, licenca, assinaturaVazia].join(".");

  assert.equal(verifyLicenseToken(texto, [{ rid: "raiz-2026", publicKey: identidade }]).ok, false);
  assert.deepEqual(verifyLicenseToken(texto, [{ rid: "raiz-2026", publicKey: identidade }]), { ok: false, error: "raiz_desconhecida" });
});

test("texto quebrado, de outro formato, com espaço, não canônico ou grande demais é recusado sem lançar erro", () => {
  const texto = assinarLicenca(emissao, licencaBase());
  const partes = texto.split(".");
  const alfabeto = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const ultimo = partes[4].at(-1);
  // Os 4 bits que sobram no último caractere da assinatura: outro caractere, os mesmos 64 bytes.
  const variante = partes[4].slice(0, -1) + alfabeto[alfabeto.indexOf(ultimo) ^ 1];
  assert.deepEqual(Buffer.from(variante, "base64url"), Buffer.from(partes[4], "base64url"));

  for (const ruim of [
    "",
    "BKL1",
    texto.replace(/^BKL1/, "BKL2"),
    partes.slice(0, 4).join("."),
    `${texto}.extra`,
    ` ${texto}`,
    `${texto}\n`,
    [...partes.slice(0, 4), variante].join("."),
    `${partes[0]}.${partes[1]}=.${partes.slice(2).join(".")}`,
    "x".repeat(20_000),
    null,
    42
  ]) {
    assert.deepEqual(verifyLicenseToken(ruim, RAIZES), { ok: false, error: "formato" }, String(ruim).slice(0, 40));
  }

  assert.deepEqual(verifyLicenseToken(assinarLicenca(emissao, licencaBase({ installation: { id: "i", host: "Com Espaço" } })), RAIZES), {
    ok: false,
    error: "conteudo"
  });
  assert.deepEqual(verifyLicenseToken(assinarLicenca(emissao, licencaBase({ plan: { kind: "annual", steps: [] } })), RAIZES), {
    ok: false,
    error: "conteudo"
  }, "a anual sem validade não vira vitalícia");
});

test("campo que esta versão não conhece é ignorado, e o módulo que ela não conhece não liga nada", () => {
  const licenca = conferida(licencaBase({ campoDoFuturo: { qualquer: 1 }, features: [{ key: "webinars" }, { key: "modulo-do-futuro" }] }));

  assert.equal("campoDoFuturo" in licenca, false);
  assert.deepEqual(avaliar(licenca, { agora: "2026-11-10T13:00:00.000Z" }).features, ["webinars", "modulo-do-futuro"]);
});

// ---- Situação da escola ------------------------------------------------------------------------------------

test("instalação nunca ativada só mostra a tela de ativação; só o dever legal passa", () => {
  const situacao = evaluateLicense({
    license: null,
    everActivated: false,
    unreadableSince: null,
    now: new Date("2026-11-11T12:00:00.000Z"),
    configuredHost: "alunos.escola.test",
    hostMismatchSince: null
  });

  assert.equal(situacao.degree, "nao_ativada");
  for (const classe of ["leitura", "atendimento", "matricula", "conteudo"]) {
    assert.equal(allowsActionClass(situacao.restrictions, classe), false, classe);
  }
  assert.equal(allowsActionClass(situacao.restrictions, "dever_legal"), true, "pedido da LGPD numa cópia nunca ativada");
  assert.deepEqual(situacao.features, []);
});

test("licença em dia: tudo liberado, módulos ligados e o titular para o 'Licenciado para'", () => {
  const situacao = avaliar(emitidaEm("2026-11-11T12:00:00.000Z"), { agora: "2026-11-11T12:00:00.000Z" });

  assert.equal(situacao.degree, "ok");
  assert.deepEqual(situacao.restrictions, { activationOnly: false, content: false, newAccess: false });
  assert.deepEqual(situacao.features, ["webinars"]);
  assert.equal(situacao.licensedTo, "Escola de Teste Ltda");
  assert.equal(situacao.kind, "annual");
  assert.equal(situacao.validUntil, VALIDADE);
  assert.equal(situacao.notice, LICENSE_NOTICE);
  assert.equal(isFeatureOn(situacao, "webinars"), true);
  assert.equal(isFeatureOn(situacao, "outro"), false);
});

test("Licença anual em Brasília: Aviso 30 dias antes, carência até 25/11, Admin limitado em 26/11 e Escola congelada em 26/12", () => {
  const em = (instante) => avaliar(emitidaEm(instante, anual()), { agora: instante });

  assert.equal(em("2027-10-01T12:00:00-03:00").degree, "ok");

  const perto = em("2027-10-20T12:00:00-03:00");
  assert.equal(perto.degree, "aviso");
  assert.equal(perto.restrictions.content, false);
  assert.deepEqual(perto.nextStep, { degree: "admin_limitado", at: "2027-11-26T00:00:00-03:00", reason: "anual_vencida" });

  const carencia = em("2027-11-25T23:59:00-03:00");
  assert.equal(carencia.degree, "aviso");
  assert.equal(allowsActionClass(carencia.restrictions, "conteudo"), true);

  const limitado = em("2027-11-26T00:00:00-03:00");
  assert.equal(limitado.degree, "admin_limitado");
  assert.equal(allowsActionClass(limitado.restrictions, "conteudo"), false);
  assert.equal(allowsActionClass(limitado.restrictions, "matricula"), true);
  assert.equal(allowsActionClass(limitado.restrictions, "dever_legal"), true);
  assert.equal(allowsActionClass(limitado.restrictions, "atendimento"), true);
  assert.equal(limitado.nextStep.degree, "escola_congelada");

  assert.equal(em("2027-12-25T23:59:00-03:00").degree, "admin_limitado");

  const congelada = em("2027-12-26T00:00:00-03:00");
  assert.equal(congelada.degree, "escola_congelada");
  assert.equal(allowsActionClass(congelada.restrictions, "matricula"), false);
  assert.equal(allowsActionClass(congelada.restrictions, "dever_legal"), true);
  assert.equal(allowsActionClass(congelada.restrictions, "leitura"), true);
  assert.deepEqual(congelada.features, ["webinars"], "o módulo continua para quem já é aluno");
  assert.equal(congelada.nextStep, null);
});

test("rede de segurança: a anual que chega sem os passos não vira vitalícia (Admin limitado 60 dias depois, congelada aos 90)", () => {
  const sem = (instante) => avaliar(emitidaEm(instante, { plan: { kind: "annual", validUntil: VALIDADE, steps: [] } }), { agora: instante });
  const fim = Date.parse(VALIDADE);

  assert.equal(sem(iso(fim + 59 * DIA)).degree, "ok");
  assert.equal(sem(iso(fim + 60 * DIA)).degree, "admin_limitado");
  assert.equal(sem(iso(fim + 90 * DIA)).degree, "escola_congelada");
});

test("Ano adicional na garantia vale como provisório até a data dele, a faixa mostra o que volta nesse dia, e depois volta o confirmado", () => {
  const nova = "2028-11-10T23:59:59-03:00";
  const licenca = emitidaEm("2027-11-27T12:00:00.000Z", {
    ...anual(),
    provisional: { kind: "annual", validUntil: nova, steps: passosDaAnual(nova), until: "2027-11-30T00:00:00.000Z" }
  });

  const naGarantia = avaliar(licenca, { agora: "2027-11-27T12:00:00.000Z" });
  assert.equal(naGarantia.degree, "ok");
  assert.equal(naGarantia.provisional, true);
  assert.equal(naGarantia.validUntil, nova);
  assert.deepEqual(naGarantia.nextStep, { degree: "admin_limitado", at: "2027-11-30T00:00:00.000Z", reason: "compra_na_garantia" });

  // Cortou o contato e pediu o reembolso: na data exata o provisório deixa de valer e volta a escada de antes.
  const depois = avaliar(licenca, { agora: "2027-11-30T00:00:00.000Z" });
  assert.equal(depois.provisional, false);
  assert.equal(depois.degree, "admin_limitado");
});

test("passo de situação não some atrás de compra provisória: desativada continua congelada", () => {
  const licenca = emitidaEm("2027-11-15T12:00:00.000Z", {
    statusSteps: [{ degree: "escola_congelada", from: "2027-11-11T00:00:00.000Z", reason: "desativada" }],
    provisional: { kind: "lifetime", steps: [], until: "2027-11-25T00:00:00.000Z" }
  });
  const situacao = avaliar(licenca, { agora: "2027-11-15T12:00:00.000Z" });

  assert.equal(situacao.provisional, true);
  assert.equal(situacao.degree, "escola_congelada");
});

test("vitalícia não tem passo de vencimento: anos depois continua em dia enquanto conversa com o Emissor", () => {
  const chave2031 = novaChaveDeEmissao(raiz, { kid: "emissao-2031", notBefore: "2030-06-01T00:00:00.000Z", notAfter: "2033-05-01T00:00:00.000Z" });
  const licenca = conferida(
    licencaBase({ kid: "emissao-2031", issuedAt: "2031-05-01T00:00:00.000Z", expiresAt: "2031-07-30T00:00:00.000Z", plan: { kind: "lifetime", steps: [] } }),
    chave2031
  );
  const situacao = avaliar(licenca, { agora: "2031-05-02T00:00:00.000Z" });

  assert.equal(situacao.degree, "ok");
  assert.equal(situacao.kind, "lifetime");
  assert.equal(situacao.validUntil, null);
});

test("sem contato conta da emissão da licença guardada: Aviso no 8º dia, Admin limitado quando o arquivo vence, congelada 30 dias depois", () => {
  const licenca = conferida(licencaBase({ issuedAt: "2026-11-10T12:00:00.000Z", expiresAt: "2026-12-10T12:00:00.000Z" }));
  const em = (dias) => avaliar(licenca, { agora: iso(Date.parse("2026-11-10T12:00:00.000Z") + dias * DIA) });

  assert.equal(em(6.9).degree, "ok");
  assert.equal(em(7).degree, "aviso");
  assert.equal(em(7).reasons[0].reason, "sem_contato");
  assert.equal(em(29.9).degree, "aviso");
  assert.equal(em(30).degree, "admin_limitado");
  assert.equal(em(59.9).degree, "admin_limitado");
  assert.equal(em(60).degree, "escola_congelada");
  assert.equal(em(400).degree, "escola_congelada", "nunca cai abaixo da Escola congelada");
});

test("licença por arquivo não recebe o Aviso de sem contato, mas vence do mesmo jeito", () => {
  const licenca = conferida(licencaBase({ delivery: "file", expiresAt: "2027-01-10T12:00:00.000Z" }));

  assert.equal(avaliar(licenca, { agora: "2026-12-20T12:00:00.000Z" }).degree, "ok");
  assert.equal(avaliar(licenca, { agora: "2027-01-10T12:00:00.000Z" }).degree, "admin_limitado");
});

test("relógio voltado para antes da licença não a deixa nova de novo: a hora nunca fica antes da emissão", () => {
  const licenca = conferida(
    licencaBase({ issuedAt: "2026-11-20T12:00:00.000Z", expiresAt: "2027-01-20T12:00:00.000Z", statusSteps: [{ degree: "aviso", from: "2026-11-19T00:00:00.000Z", reason: "suspensa" }] })
  );

  assert.equal(avaliar(licenca, { agora: "2026-11-01T00:00:00.000Z" }).degree, "aviso");
});

test("endereço configurado diferente do da licença: Aviso sem acesso novo, Admin limitado em 7 dias e Escola congelada em 30", () => {
  const desde = Date.parse("2026-11-11T00:00:00.000Z");
  const em = (dias) => {
    const agora = iso(desde + dias * DIA);
    return avaliar(emitidaEm(agora), { agora, endereco: "copia.outra-escola.test", enderecoDiferenteDesde: new Date(desde) });
  };

  const aviso = em(1);
  assert.equal(aviso.degree, "aviso");
  assert.equal(allowsActionClass(aviso.restrictions, "matricula"), false, "a cópia não matricula ninguém já no Aviso");
  assert.equal(allowsActionClass(aviso.restrictions, "conteudo"), true);
  assert.equal(em(7).degree, "admin_limitado");
  assert.equal(em(30).degree, "escola_congelada");
});

test("endereço certo na configuração mas pedidos chegando por outro: a mesma escada, pelo que o store registrou", () => {
  const desde = Date.parse("2026-11-11T00:00:00.000Z");
  const em = (dias) => {
    const agora = iso(desde + dias * DIA);
    return avaliar(emitidaEm(agora), { agora, enderecoDiferenteDesde: new Date(desde) });
  };

  assert.equal(em(1).degree, "aviso");
  assert.equal(em(1).restrictions.newAccess, true);
  assert.equal(em(7).degree, "admin_limitado");
  assert.equal(em(30).degree, "escola_congelada");
});

test("endereço diferente sem data registrada: conta como agora, e sem acesso novo desde já", () => {
  const situacao = avaliar(emitidaEm("2026-11-20T00:00:00.000Z"), { agora: "2026-11-20T00:00:00.000Z", endereco: "copia.test" });

  assert.equal(situacao.degree, "aviso");
  assert.equal(situacao.restrictions.newAccess, true);
  assert.equal(situacao.nextStep.degree, "admin_limitado");
});

test("o endereço compara o nome exato: maiúsculas, ponto final, 443, https e acento em punycode batem; www, outra porta e http não", () => {
  assert.equal(normalizeHost(" Alunos.Escola.TEST:443 "), "alunos.escola.test");
  assert.equal(normalizeHost("https://Alunos.Escola.test/"), "alunos.escola.test");
  assert.equal(normalizeHost("alunos.escolá.com.br"), "alunos.xn--escol-1qa.com.br");
  assert.equal(normalizeHost("alunos.escola.test, proxy.interno"), "alunos.escola.test", "primeiro da lista do X-Forwarded-Host");
  assert.equal(sameHost("alunos.escola.test", "alunos.escola.test."), true);
  assert.equal(sameHost("alunos.escola.test", "www.alunos.escola.test"), false);
  assert.equal(sameHost("alunos.escola.test", "alunos.escola.test:8443"), false);
  assert.equal(sameHost("alunos.escola.test", "http://alunos.escola.test"), false);
  assert.equal(sameHost("alunos.escola.test", "https://usuario@alunos.escola.test"), false);
  assert.equal(sameHost("alunos.escola.test", "[::1]"), false);
  assert.equal(sameHost("alunos.escola.test", null), false);
});

test("licença ilegível numa escola já ativada: nenhum acesso novo desde já, Aviso, 7 e 30 dias, nunca 'não ativada'", () => {
  const desde = new Date("2026-11-11T00:00:00.000Z");
  const em = (dias) => ilegivel(iso(desde.getTime() + dias * DIA), desde);

  assert.equal(em(0).degree, "aviso");
  assert.equal(em(0).restrictions.activationOnly, false);
  assert.equal(em(0).restrictions.newAccess, true, "nada prova o direito de dar acesso");
  assert.equal(allowsActionClass(em(0).restrictions, "dever_legal"), true);
  assert.equal(em(7).degree, "admin_limitado");
  assert.equal(em(30).degree, "escola_congelada");
});

test("licença ilegível: data ausente ou no futuro conta como agora; data inválida conta como há muito tempo", () => {
  const agora = "2026-11-20T00:00:00.000Z";

  assert.equal(ilegivel(agora, null).degree, "aviso");
  assert.equal(ilegivel(agora, null).restrictions.newAccess, true);
  assert.equal(ilegivel(agora, new Date("2099-01-01T00:00:00.000Z")).degree, "aviso");
  assert.equal(ilegivel(agora, new Date("infinity")).degree, "escola_congelada");
});

test("passos de situação datados pelo Emissor: pagamento desfeito escala por dia; desativada congela na hora", () => {
  const passos = [
    { degree: "aviso", from: "2026-11-11T00:00:00.000Z", reason: "pagamento_desfeito" },
    { degree: "admin_limitado", from: "2026-11-18T00:00:00.000Z", reason: "pagamento_desfeito" },
    { degree: "escola_congelada", from: "2026-12-11T00:00:00.000Z", reason: "pagamento_desfeito" }
  ];
  const em = (instante) => avaliar(emitidaEm(instante, { statusSteps: passos }), { agora: instante });

  assert.equal(em("2026-11-12T00:00:00.000Z").degree, "aviso");
  assert.equal(em("2026-11-18T00:00:00.000Z").degree, "admin_limitado");
  assert.equal(em("2026-12-11T00:00:00.000Z").degree, "escola_congelada");

  const desativada = avaliar(
    emitidaEm("2026-11-11T00:00:01.000Z", { statusSteps: [{ degree: "escola_congelada", from: "2026-11-11T00:00:00.000Z", reason: "desativada" }] }),
    { agora: "2026-11-11T00:00:01.000Z" }
  );
  assert.equal(desativada.degree, "escola_congelada");
  assert.equal(desativada.reasons.at(-1).reason, "desativada");
});

test("modo de observação calcula o degrau e avisa, mas não limita nada", () => {
  const passos = { observeUntil: "2027-01-10T00:00:00.000Z", statusSteps: [{ degree: "escola_congelada", from: "2026-11-11T00:00:00.000Z", reason: "pagamento_desfeito" }] };
  const observando = avaliar(emitidaEm("2026-12-01T00:00:00.000Z", passos), { agora: "2026-12-01T00:00:00.000Z", endereco: "outro.escola.test" });

  assert.equal(observando.observing, true);
  assert.equal(observando.degree, "escola_congelada");
  assert.equal(observando.enforcedDegree, "aviso");
  assert.deepEqual(observando.restrictions, { activationOnly: false, content: false, newAccess: false });

  const depois = avaliar(emitidaEm("2027-01-10T00:00:00.000Z", passos), { agora: "2027-01-10T00:00:00.000Z" });
  assert.equal(depois.observing, false);
  assert.equal(depois.enforcedDegree, "escola_congelada");
});

test("módulo comprado na garantia liga só até a data dele; módulo fora da licença nunca liga", () => {
  const licenca = conferida(licencaBase({ features: [{ key: "webinars", until: "2026-11-20T00:00:00.000Z" }] }));

  assert.deepEqual(avaliar(licenca, { agora: "2026-11-15T00:00:00.000Z" }).features, ["webinars"]);
  assert.deepEqual(avaliar(licenca, { agora: "2026-11-20T00:00:00.000Z" }).features, []);
});

test("data inválida no banco nunca libera: hora inválida fecha a escola; 'desde quando' inválido conta como há muito tempo", () => {
  const licenca = emitidaEm("2026-11-20T00:00:00.000Z");

  const semHora = avaliar(licenca, { agora: new Date("infinity") });
  assert.equal(semHora.degree, "escola_congelada");
  assert.equal(semHora.reasons[0].reason, "relogio_invalido");
  assert.equal(semHora.restrictions.newAccess, true);
  assert.equal(semHora.restrictions.content, true);

  const enderecoInvalido = avaliar(licenca, { agora: "2026-11-20T00:00:00.000Z", enderecoDiferenteDesde: new Date("infinity") });
  assert.equal(enderecoInvalido.degree, "escola_congelada");
});

test("faixa: dias até o próximo passo, arredondados para cima, nunca negativos", () => {
  const agora = new Date("2026-11-20T00:00:00.000Z");

  assert.equal(daysUntil("2026-11-21T00:00:00.000Z", agora), 1);
  assert.equal(daysUntil("2026-11-21T00:00:01.000Z", agora), 2);
  assert.equal(daysUntil("2026-11-19T00:00:00.000Z", agora), 0);
  assert.equal(daysUntil("não é data", agora), 0);
});

// ---- Relógio -----------------------------------------------------------------------------------------------

test("com conferência recente, vale a hora do Emissor com o relógio do servidor adiantado até 48 h", () => {
  const emissor = new Date("2026-11-10T12:00:00.000Z");
  const local = new Date(emissor.getTime() + 40 * HORA);
  const relogio = resolveTrustedNow({ systemNow: new Date(local.getTime() + HORA), lastSeenAt: emissor, lastCheckIn: { emissorTime: emissor, localTime: local } });

  assert.equal(relogio.source, "emissor");
  assert.equal(relogio.now.toISOString(), "2026-11-10T13:00:00.000Z");
  assert.equal(relogio.clockWrong, false);
});

test("o piso da hora confiável: nunca mais de 48 h atrás do relógio do servidor, e o preço é o relógio adiantado mais que isso", () => {
  const emissor = new Date("2026-11-10T12:00:00.000Z");
  const local = new Date("2029-01-01T00:00:00.000Z");
  const relogio = resolveTrustedNow({ systemNow: new Date(local.getTime() + HORA), lastSeenAt: emissor, lastCheckIn: { emissorTime: emissor, localTime: local } });

  // O banco (a última hora vista e a última conferência) não segura mais a hora: o relógio do servidor é o piso. O preço
  // fica dito no docs/32 §11.3: o relógio adiantado anos adianta os prazos no que passa de 48 h, com a faixa avisando.
  assert.equal(relogio.source, "relogio");
  assert.equal(relogio.now.toISOString(), "2028-12-30T01:00:00.000Z");
  assert.equal(relogio.clockWrong, true, "a diferença de mais de 48 h vira aviso de relógio errado");

  // O relógio atrasado não tem piso nenhum a pagar: vale a última hora vista, como antes.
  const atrasado = resolveTrustedNow({ systemNow: new Date("2026-11-01T00:00:00.000Z"), lastSeenAt: emissor, lastCheckIn: { emissorTime: emissor, localTime: emissor } });
  assert.equal(atrasado.now.toISOString(), emissor.toISOString());
});

test("relógio adiantado de forma constante e Emissor fora do ar por 3 dias: a hora continua certa, sem pular para o futuro", () => {
  const emissor = new Date("2027-06-01T00:00:00.000Z");
  const local = new Date(emissor.getTime() + 30 * HORA);
  const relogio = resolveTrustedNow({ systemNow: new Date(local.getTime() + 3 * DIA), lastSeenAt: emissor, lastCheckIn: { emissorTime: emissor, localTime: local } });

  assert.equal(relogio.now.toISOString(), "2027-06-04T00:00:00.000Z");
  assert.equal(relogio.source, "relogio");
});

test("relógio parado ou atrasado não segura o prazo: vale a última hora vista", () => {
  const parado = resolveTrustedNow({ systemNow: new Date("2026-11-01T00:00:00.000Z"), lastSeenAt: new Date("2027-12-01T00:00:00.000Z"), lastCheckIn: null });
  assert.equal(parado.source, "ultima_hora_vista");
  assert.equal(parado.now.toISOString(), "2027-12-01T00:00:00.000Z");

  const voltou = resolveTrustedNow({
    systemNow: new Date("2026-11-05T00:00:00.000Z"),
    lastSeenAt: new Date("2026-11-12T00:00:00.000Z"),
    lastCheckIn: { emissorTime: new Date("2026-11-10T00:00:00.000Z"), localTime: new Date("2026-11-10T00:00:00.000Z") }
  });
  assert.equal(voltou.now.toISOString(), "2026-11-12T00:00:00.000Z");
});

test("relógio voltado para antes da última conferência não usa tempo negativo: vale o relógio", () => {
  const relogio = resolveTrustedNow({
    systemNow: new Date("2026-11-05T00:00:00.000Z"),
    lastSeenAt: null,
    lastCheckIn: { emissorTime: new Date("2026-11-10T00:00:00.000Z"), localTime: new Date("2026-11-10T00:00:00.000Z") }
  });

  assert.equal(relogio.source, "relogio");
  assert.equal(relogio.now.toISOString(), "2026-11-05T00:00:00.000Z");
});

test("sem conferência nas últimas 48 h, vale o menor entre o relógio e a hora do Emissor mais o tempo corrido", () => {
  const relogio = resolveTrustedNow({
    systemNow: new Date("2026-11-20T00:00:00.000Z"),
    lastSeenAt: new Date("2026-11-19T23:59:00.000Z"),
    lastCheckIn: { emissorTime: new Date("2026-11-10T00:00:00.000Z"), localTime: new Date("2026-11-10T00:00:00.000Z") }
  });

  assert.equal(relogio.source, "relogio");
  assert.equal(relogio.now.toISOString(), "2026-11-20T00:00:00.000Z");
  assert.equal(relogio.clockWrong, false);
});

test("data inválida no relógio guardado é ignorada, nunca vira hora inválida que libera", () => {
  const invalida = new Date("infinity");
  const sistema = new Date("2026-11-20T00:00:00.000Z");

  const semUltima = resolveTrustedNow({ systemNow: sistema, lastSeenAt: invalida, lastCheckIn: null });
  assert.equal(semUltima.now.toISOString(), sistema.toISOString());

  const semConferencia = resolveTrustedNow({ systemNow: sistema, lastSeenAt: null, lastCheckIn: { emissorTime: invalida, localTime: sistema } });
  assert.equal(semConferencia.source, "relogio");
  assert.equal(semConferencia.now.toISOString(), sistema.toISOString());
  assert.equal(semConferencia.clockSkewMs, null);
});
