import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import {
  assinarLicenca,
  licencaBase,
  novaChaveDeEmissao,
  novaRaiz,
  passosDaAnual
} from "./support/licenca-de-teste.mjs";

// Núcleo do Verificador de licença (docs/32 §2.2, §11.3 e §11.4): a conferência da licença assinada e a
// situação que ela dá à escola. Um teste por situação do §2.2 que já dá para reproduzir sem banco.

const { verifyLicenseToken } = await import("../src/server/licensing/artifact.ts");
const { evaluateLicense, normalizeHost, resolveTrustedNow, sameHost } = await import("../src/server/licensing/evaluate.ts");
const { LICENSE_NOTICE, allowsActionClass } = await import("../src/server/licensing/model.ts");

const DIA = 24 * 60 * 60 * 1000;
const raiz = novaRaiz("raiz-2026");
const raizDeReserva = novaRaiz("raiz-reserva");
const RAIZES = [raiz.confiavel, raizDeReserva.confiavel];
const emissao = novaChaveDeEmissao(raiz);

function conferida(licenca = licencaBase()) {
  const resultado = verifyLicenseToken(assinarLicenca(emissao, licenca), RAIZES);
  assert.equal(resultado.ok, true, `a licença de teste confere: ${JSON.stringify(resultado)}`);
  return resultado.license;
}

function avaliar(licenca, opcoes = {}) {
  return evaluateLicense({
    license: licenca,
    everActivated: true,
    unreadableSince: null,
    now: new Date(opcoes.agora ?? "2026-11-11T12:00:00.000Z"),
    lastGoodCheckInAt: opcoes.ultimaConferencia === undefined ? new Date(opcoes.agora ?? "2026-11-11T12:00:00.000Z") : opcoes.ultimaConferencia,
    configuredHost: opcoes.endereco ?? "alunos.escola.test",
    hostMismatchSince: opcoes.enderecoDiferenteDesde ?? null,
    ...opcoes.entrada
  });
}

function emDias(baseIso, dias) {
  return new Date(Date.parse(baseIso) + dias * DIA).toISOString();
}

// ---- Conferência da assinatura ---------------------------------------------------------------------------

test("licença emitida pela nossa chave confere e devolve o titular, o endereço e os módulos", () => {
  const licenca = conferida();

  assert.equal(licenca.holder.name, "Escola de Teste Ltda");
  assert.equal(licenca.installation.host, "alunos.escola.test");
  assert.deepEqual(licenca.features, [{ key: "webinars" }]);
  assert.equal(licenca.delivery, "online");
});

test("licença com o conteúdo trocado depois de assinada não confere", () => {
  const texto = assinarLicenca(emissao, licencaBase());
  const partes = texto.split(".");
  const adulterada = { ...licencaBase(), features: [{ key: "webinars" }, { key: "modulo-pago" }] };
  partes[3] = Buffer.from(JSON.stringify(adulterada)).toString("base64url");

  assert.deepEqual(verifyLicenseToken(partes.join("."), RAIZES), { ok: false, error: "assinatura_da_licenca" });
});

test("licença assinada por uma raiz que o produto não conhece é recusada, mesmo com o nome da nossa", () => {
  const raizPirata = novaRaiz("raiz-pirata");
  const emissaoPirata = novaChaveDeEmissao(raizPirata);
  assert.deepEqual(verifyLicenseToken(assinarLicenca(emissaoPirata, licencaBase()), RAIZES), {
    ok: false,
    error: "raiz_desconhecida"
  });

  // Quem troca só o identificador da raiz no certificado esbarra na assinatura do certificado.
  const comNossoNome = novaChaveDeEmissao(raizPirata, { rid: "raiz-2026" });
  assert.deepEqual(verifyLicenseToken(assinarLicenca(comNossoNome, licencaBase()), RAIZES), {
    ok: false,
    error: "assinatura_do_certificado"
  });
});

test("a raiz não assina licença direto, e a assinatura do certificado não vale como assinatura de licença", () => {
  const assinadaPelaRaiz = assinarLicenca(emissao, licencaBase(), { assinarCom: raiz.privateKey });
  assert.deepEqual(verifyLicenseToken(assinadaPelaRaiz, RAIZES), { ok: false, error: "assinatura_da_licenca" });

  const partes = assinarLicenca(emissao, licencaBase()).split(".");
  const trocada = [partes[0], partes[1], partes[2], partes[1], partes[2]].join(".");
  assert.equal(verifyLicenseToken(trocada, RAIZES).ok, false);
});

test("licença emitida fora do prazo da chave de emissão é recusada; a emitida dentro continua valendo depois", () => {
  const aposentada = novaChaveDeEmissao(raiz, { notBefore: "2026-01-01T00:00:00.000Z", notAfter: "2026-06-30T23:59:59.000Z" });

  assert.deepEqual(verifyLicenseToken(assinarLicenca(aposentada, licencaBase({ issuedAt: "2026-11-10T12:00:00.000Z" })), RAIZES), {
    ok: false,
    error: "certificado_fora_do_prazo"
  });

  const antiga = verifyLicenseToken(assinarLicenca(aposentada, licencaBase({ issuedAt: "2026-05-01T12:00:00.000Z" })), RAIZES);
  assert.equal(antiga.ok, true);
});

test("a raiz de reserva também confere, e a licença precisa citar a chave que a assinou", () => {
  const daReserva = novaChaveDeEmissao(raizDeReserva, { kid: "emissao-reserva" });
  assert.equal(verifyLicenseToken(assinarLicenca(daReserva, licencaBase({ kid: "emissao-reserva" })), RAIZES).ok, true);
  assert.deepEqual(verifyLicenseToken(assinarLicenca(daReserva, licencaBase({ kid: "outra" })), RAIZES), {
    ok: false,
    error: "chave_diferente"
  });
});

test("texto quebrado, de outro formato ou grande demais é recusado sem lançar erro", () => {
  const texto = assinarLicenca(emissao, licencaBase());

  for (const ruim of ["", "BKL1", texto.replace(/^BKL1/, "BKL2"), texto.split(".").slice(0, 4).join("."), `${texto}.extra`, "x".repeat(20_000), null]) {
    assert.deepEqual(verifyLicenseToken(ruim, RAIZES), { ok: false, error: "formato" });
  }

  assert.deepEqual(verifyLicenseToken(assinarLicenca(emissao, licencaBase({ installation: { id: "i", host: "Com Espaço" } })), RAIZES), {
    ok: false,
    error: "conteudo"
  });
});

test("campo que esta versão não conhece é ignorado, e o módulo que ela não conhece não liga nada", () => {
  const licenca = conferida(licencaBase({ campoDoFuturo: { qualquer: 1 }, features: [{ key: "webinars" }, { key: "modulo-do-futuro" }] }));
  const situacao = avaliar(licenca);

  assert.equal("campoDoFuturo" in licenca, false);
  assert.deepEqual(situacao.features, ["webinars", "modulo-do-futuro"]);
});

// ---- Situação da escola ------------------------------------------------------------------------------------

test("instalação nunca ativada só mostra a tela de ativação: nenhuma ação do admin passa", () => {
  const situacao = evaluateLicense({
    license: null,
    everActivated: false,
    unreadableSince: null,
    now: new Date("2026-11-11T12:00:00.000Z"),
    lastGoodCheckInAt: null,
    configuredHost: "alunos.escola.test",
    hostMismatchSince: null
  });

  assert.equal(situacao.degree, "nao_ativada");
  for (const classe of ["leitura", "atendimento", "dever_legal", "matricula", "conteudo"]) {
    assert.equal(allowsActionClass(situacao.restrictions, classe), false, classe);
  }
  assert.deepEqual(situacao.features, []);
});

test("licença em dia: tudo liberado, módulos ligados e o titular para o 'Licenciado para'", () => {
  const situacao = avaliar(conferida());

  assert.equal(situacao.degree, "ok");
  assert.deepEqual(situacao.restrictions, { activationOnly: false, content: false, newAccess: false });
  assert.deepEqual(situacao.features, ["webinars"]);
  assert.equal(situacao.licensedTo, "Escola de Teste Ltda");
  assert.equal(situacao.kind, "annual");
  assert.equal(situacao.validUntil, "2027-11-10T23:59:59.000Z");
  assert.equal(situacao.notice, LICENSE_NOTICE);
});

test("Licença anual: Aviso 30 dias antes, carência de 15 dias, Admin limitado no 16º dia e Escola congelada no 46º", () => {
  const validade = "2027-11-10T23:59:59.000Z";
  const licenca = conferida(
    licencaBase({ expiresAt: "2028-03-01T00:00:00.000Z", plan: { kind: "annual", validUntil: validade, steps: passosDaAnual(validade) } })
  );
  const em = (iso) => avaliar(licenca, { agora: iso });

  const antes = em("2027-10-01T12:00:00.000Z");
  assert.equal(antes.degree, "ok");

  const perto = em("2027-10-20T12:00:00.000Z");
  assert.equal(perto.degree, "aviso");
  assert.equal(perto.restrictions.content, false);
  assert.equal(perto.nextStep.degree, "admin_limitado");
  assert.equal(perto.nextStep.at, emDias(validade, 15));

  const carencia = em("2027-11-20T12:00:00.000Z");
  assert.equal(carencia.degree, "aviso");
  assert.equal(allowsActionClass(carencia.restrictions, "conteudo"), true);

  const limitado = em("2027-11-26T12:00:00.000Z");
  assert.equal(limitado.degree, "admin_limitado");
  assert.equal(allowsActionClass(limitado.restrictions, "conteudo"), false);
  assert.equal(allowsActionClass(limitado.restrictions, "matricula"), true);
  assert.equal(allowsActionClass(limitado.restrictions, "dever_legal"), true);
  assert.equal(allowsActionClass(limitado.restrictions, "atendimento"), true);
  assert.equal(limitado.nextStep.degree, "escola_congelada");

  const congelada = em("2027-12-26T12:00:00.000Z");
  assert.equal(congelada.degree, "escola_congelada");
  assert.equal(allowsActionClass(congelada.restrictions, "matricula"), false);
  assert.equal(allowsActionClass(congelada.restrictions, "dever_legal"), true);
  assert.equal(allowsActionClass(congelada.restrictions, "leitura"), true);
  assert.deepEqual(congelada.features, ["webinars"], "o módulo continua para quem já é aluno");
  assert.equal(congelada.nextStep, null);
});

test("Ano adicional na garantia vale como provisório até a data dele; depois volta o confirmado", () => {
  const validadeAntiga = "2027-11-10T23:59:59.000Z";
  const validadeNova = "2028-11-10T23:59:59.000Z";
  const licenca = conferida(
    licencaBase({
      expiresAt: "2028-03-01T00:00:00.000Z",
      plan: { kind: "annual", validUntil: validadeAntiga, steps: passosDaAnual(validadeAntiga) },
      provisional: { kind: "annual", validUntil: validadeNova, steps: passosDaAnual(validadeNova), until: "2027-11-30T00:00:00.000Z" }
    })
  );

  const naGarantia = avaliar(licenca, { agora: "2027-11-27T12:00:00.000Z" });
  assert.equal(naGarantia.degree, "ok");
  assert.equal(naGarantia.provisional, true);
  assert.equal(naGarantia.validUntil, validadeNova);

  // Cortou o contato e pediu o reembolso: o provisório vence sozinho e a escola segue a escada de antes.
  const depois = avaliar(licenca, { agora: "2027-11-30T12:00:00.000Z" });
  assert.equal(depois.provisional, false);
  assert.equal(depois.degree, "admin_limitado");
});

test("vitalícia não tem passo de vencimento: anos depois continua em dia enquanto conversa com o Emissor", () => {
  // Cinco anos depois, assinada por uma chave de emissão nova (a troca da chave não muda o produto).
  const emissaoLonga = novaChaveDeEmissao(raiz, { kid: "emissao-2031", notAfter: "2040-01-01T00:00:00.000Z" });
  const vitalicia = licencaBase({
    kid: "emissao-2031",
    issuedAt: "2031-05-01T00:00:00.000Z",
    expiresAt: "2031-07-30T00:00:00.000Z",
    plan: { kind: "lifetime", steps: [] }
  });
  const daChaveNova = verifyLicenseToken(assinarLicenca(emissaoLonga, vitalicia), RAIZES);
  assert.equal(daChaveNova.ok, true);

  const situacao = avaliar(daChaveNova.license, { agora: "2031-05-02T00:00:00.000Z" });
  assert.equal(situacao.degree, "ok");
  assert.equal(situacao.kind, "lifetime");
  assert.equal(situacao.validUntil, null);
});

test("sem contato: nada até o 7º dia, Aviso no 8º, Admin limitado quando o arquivo vence e Escola congelada 30 dias depois", () => {
  const licenca = conferida(licencaBase({ issuedAt: "2026-11-10T12:00:00.000Z", expiresAt: "2026-12-10T12:00:00.000Z" }));
  const ultima = new Date("2026-11-10T12:00:00.000Z");
  const em = (dias) => avaliar(licenca, { agora: emDias("2026-11-10T12:00:00.000Z", dias), ultimaConferencia: ultima });

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

  assert.equal(avaliar(licenca, { agora: "2026-12-20T12:00:00.000Z", ultimaConferencia: null }).degree, "ok");
  assert.equal(avaliar(licenca, { agora: "2027-01-10T12:00:00.000Z", ultimaConferencia: null }).degree, "admin_limitado");
});

test("endereço configurado diferente do da licença: Aviso sem acesso novo, Admin limitado em 7 dias e Escola congelada em 30", () => {
  const licenca = conferida();
  const desde = new Date("2026-11-11T00:00:00.000Z");
  const em = (dias) =>
    avaliar(licenca, { agora: emDias(desde.toISOString(), dias), endereco: "copia.outra-escola.test", enderecoDiferenteDesde: desde, ultimaConferencia: new Date(emDias(desde.toISOString(), dias)) });

  const aviso = em(1);
  assert.equal(aviso.degree, "aviso");
  assert.equal(allowsActionClass(aviso.restrictions, "matricula"), false, "a cópia não matricula ninguém já no Aviso");
  assert.equal(allowsActionClass(aviso.restrictions, "conteudo"), true);
  assert.equal(em(7).degree, "admin_limitado");
  assert.equal(em(30).degree, "escola_congelada");
});

test("o endereço compara o nome exato: maiúsculas, ponto final e a porta 443 batem; www e outra porta não", () => {
  assert.equal(normalizeHost(" Alunos.Escola.TEST:443 "), "alunos.escola.test");
  assert.equal(sameHost("alunos.escola.test", "alunos.escola.test."), true);
  assert.equal(sameHost("alunos.escola.test", "www.alunos.escola.test"), false);
  assert.equal(sameHost("alunos.escola.test", "alunos.escola.test:8443"), false);
  assert.equal(sameHost("alunos.escola.test", "https://alunos.escola.test/"), false);
  assert.equal(sameHost("alunos.escola.test", null), false);
});

test("licença ilegível numa escola já ativada nunca vira 'não ativada': Aviso, 7 e 30 dias", () => {
  const desde = new Date("2026-11-11T00:00:00.000Z");
  const em = (dias) =>
    evaluateLicense({
      license: null,
      everActivated: true,
      unreadableSince: desde,
      now: new Date(emDias(desde.toISOString(), dias)),
      lastGoodCheckInAt: null,
      configuredHost: "alunos.escola.test",
      hostMismatchSince: null
    });

  assert.equal(em(0).degree, "aviso");
  assert.equal(em(0).restrictions.activationOnly, false);
  assert.equal(em(7).degree, "admin_limitado");
  assert.equal(em(30).degree, "escola_congelada");
});

test("passos datados pelo Emissor: pagamento desfeito escala por dia; desativada congela na hora", () => {
  const revogada = conferida(
    licencaBase({
      plan: {
        kind: "annual",
        validUntil: "2027-11-10T23:59:59.000Z",
        steps: [
          { degree: "aviso", from: "2026-11-11T00:00:00.000Z", reason: "pagamento_desfeito" },
          { degree: "admin_limitado", from: "2026-11-18T00:00:00.000Z", reason: "pagamento_desfeito" },
          { degree: "escola_congelada", from: "2026-12-11T00:00:00.000Z", reason: "pagamento_desfeito" }
        ]
      }
    })
  );

  assert.equal(avaliar(revogada, { agora: "2026-11-12T00:00:00.000Z" }).degree, "aviso");
  assert.equal(avaliar(revogada, { agora: "2026-11-18T00:00:00.000Z" }).degree, "admin_limitado");
  assert.equal(avaliar(revogada, { agora: "2026-12-11T00:00:00.000Z" }).degree, "escola_congelada");

  const desativada = conferida(
    licencaBase({ plan: { kind: "annual", steps: [{ degree: "escola_congelada", from: "2026-11-11T00:00:00.000Z", reason: "desativada" }] } })
  );
  const situacao = avaliar(desativada, { agora: "2026-11-11T00:00:01.000Z" });
  assert.equal(situacao.degree, "escola_congelada");
  assert.equal(situacao.reasons.at(-1).reason, "desativada");
});

test("modo de observação calcula o degrau e avisa, mas não limita nada", () => {
  const licenca = conferida(
    licencaBase({
      observeUntil: "2027-01-10T00:00:00.000Z",
      plan: { kind: "annual", steps: [{ degree: "escola_congelada", from: "2026-11-11T00:00:00.000Z", reason: "pagamento_desfeito" }] }
    })
  );
  const observando = avaliar(licenca, { agora: "2026-12-01T00:00:00.000Z", endereco: "outro.escola.test" });

  assert.equal(observando.observing, true);
  assert.equal(observando.degree, "escola_congelada");
  assert.equal(observando.enforcedDegree, "aviso");
  assert.deepEqual(observando.restrictions, { activationOnly: false, content: false, newAccess: false });

  const depois = avaliar(licenca, { agora: "2027-01-10T00:00:00.000Z" });
  assert.equal(depois.observing, false);
  assert.equal(depois.enforcedDegree, "escola_congelada");
});

test("módulo comprado na garantia liga só até a data dele; módulo fora da licença nunca liga", () => {
  const licenca = conferida(licencaBase({ features: [{ key: "webinars", until: "2026-11-20T00:00:00.000Z" }] }));

  assert.deepEqual(avaliar(licenca, { agora: "2026-11-19T00:00:00.000Z" }).features, ["webinars"]);
  assert.deepEqual(avaliar(licenca, { agora: "2026-11-20T00:00:00.000Z" }).features, []);
});

// ---- Relógio -----------------------------------------------------------------------------------------------

test("com conferência recente, vale a hora do Emissor mesmo com o relógio do servidor errado", () => {
  const emissor = new Date("2026-11-10T12:00:00.000Z");
  const local = new Date("2029-01-01T00:00:00.000Z");
  const relogio = resolveTrustedNow({
    systemNow: new Date(local.getTime() + 60 * 60 * 1000),
    lastSeenAt: emissor,
    lastCheckIn: { emissorTime: emissor, localTime: local }
  });

  assert.equal(relogio.source, "emissor");
  assert.equal(relogio.now.toISOString(), "2026-11-10T13:00:00.000Z");
  assert.equal(relogio.clockWrong, true, "a diferença de mais de 48 h vira aviso de relógio errado");
});

test("relógio parado ou atrasado não segura o prazo: vale a última hora vista", () => {
  const relogio = resolveTrustedNow({
    systemNow: new Date("2026-11-01T00:00:00.000Z"),
    lastSeenAt: new Date("2027-12-01T00:00:00.000Z"),
    lastCheckIn: null
  });

  assert.equal(relogio.source, "relogio");
  assert.equal(relogio.now.toISOString(), "2027-12-01T00:00:00.000Z");

  // Conferência antiga e relógio voltado para trás: também vale a última hora vista.
  const voltou = resolveTrustedNow({
    systemNow: new Date("2026-11-05T00:00:00.000Z"),
    lastSeenAt: new Date("2026-11-12T00:00:00.000Z"),
    lastCheckIn: { emissorTime: new Date("2026-11-10T00:00:00.000Z"), localTime: new Date("2026-11-10T00:00:00.000Z") }
  });
  assert.equal(voltou.now.toISOString(), "2026-11-12T00:00:00.000Z");
});

test("sem conferência nas últimas 48 h, vale o relógio do servidor", () => {
  const relogio = resolveTrustedNow({
    systemNow: new Date("2026-11-20T00:00:00.000Z"),
    lastSeenAt: new Date("2026-11-19T23:59:00.000Z"),
    lastCheckIn: { emissorTime: new Date("2026-11-10T00:00:00.000Z"), localTime: new Date("2026-11-10T00:00:00.000Z") }
  });

  assert.equal(relogio.source, "relogio");
  assert.equal(relogio.now.toISOString(), "2026-11-20T00:00:00.000Z");
  assert.equal(relogio.clockWrong, false);
});
