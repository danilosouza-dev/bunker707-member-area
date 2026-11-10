import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz, passosDaAnual } from "./support/licenca-de-teste.mjs";

// A situação da licença montada a partir do que a Instalação guarda (docs/32 §11.3): o modo gravado no build,
// a conferência da licença guardada, a hora confiável e a pergunta única "este módulo está ligado? esta ação
// passa?". No modo "off" (a nossa escola hoje, a dev e os testes) nada muda no app.

const { EMPTY_LICENSE_SNAPSHOT, computeLicenseState } = await import("../src/server/licensing/state.ts");
const { licensingMode, parseTrustedRoots } = await import("../src/server/licensing/build-config.ts");
const { LicenseRestrictionError, isActionClassAllowed, isFeatureEnabled, isGrantEnabled, requireActionClass, requireFeature } =
  await import("../src/server/licensing/require-feature.ts");

const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const RAIZES = [raiz.confiavel];
const AGORA = new Date("2026-11-11T12:00:00.000Z");

function estado(snapshot, opcoes = {}) {
  return computeLicenseState({
    mode: opcoes.modo ?? "enforce",
    roots: opcoes.raizes ?? RAIZES,
    snapshot: { ...EMPTY_LICENSE_SNAPSHOT, ...snapshot },
    systemNow: opcoes.agora ?? AGORA,
    configuredHost: opcoes.endereco ?? "alunos.escola.test"
  });
}

function conferidaHoje(licenca = licencaBase()) {
  return {
    token: assinarLicenca(emissao, licenca),
    everActivated: true,
    lastCheckIn: { emissorTime: AGORA, localTime: AGORA },
    lastSeenAt: AGORA
  };
}

test("modo off: sem licença nenhuma, todo módulo ligado e toda ação liberada, como antes", () => {
  const situacao = estado(EMPTY_LICENSE_SNAPSHOT, { modo: "off" });

  assert.deepEqual(situacao, { mode: "off" });
  assert.equal(isFeatureEnabled(situacao, "webinars"), true);
  assert.equal(isFeatureEnabled(situacao, "qualquer-modulo"), true);
  for (const classe of ["leitura", "atendimento", "dever_legal", "matricula", "conteudo"]) {
    assert.equal(isActionClassAllowed(situacao, classe), true, classe);
  }
  assert.doesNotThrow(() => requireFeature(situacao, "webinars"));
});

test("modo off não liga as páginas de vendedor: só a licença assinada da nossa escola traz essa chave", () => {
  assert.equal(isGrantEnabled(estado(EMPTY_LICENSE_SNAPSHOT, { modo: "off" }), "seller-pages"), false);

  const nossa = estado(conferidaHoje(licencaBase({ grants: ["seller-pages"] })));
  assert.equal(isGrantEnabled(nossa, "seller-pages"), true);
  assert.equal(isGrantEnabled(estado(conferidaHoje()), "seller-pages"), false);
});

test("modo enforce sem licença: só a tela de ativação; o módulo responde 404 e a ação, 403", () => {
  const situacao = estado(EMPTY_LICENSE_SNAPSHOT);

  assert.equal(situacao.evaluation.degree, "nao_ativada");
  assert.equal(isFeatureEnabled(situacao, "webinars"), false);
  assert.throws(() => requireFeature(situacao, "webinars"), (erro) => erro instanceof LicenseRestrictionError && erro.status === 404);
  assert.throws(() => requireActionClass(situacao, "leitura"), (erro) => erro instanceof LicenseRestrictionError && erro.status === 403);
});

test("modo enforce com a licença em dia: módulos da licença ligados, outros desligados, tudo liberado", () => {
  const situacao = estado(conferidaHoje());

  assert.equal(situacao.verificationError, null);
  assert.equal(situacao.evaluation.degree, "ok");
  assert.equal(isFeatureEnabled(situacao, "webinars"), true);
  assert.equal(isFeatureEnabled(situacao, "modulo-nao-comprado"), false);
  assert.equal(isActionClassAllowed(situacao, "conteudo"), true);
});

test("licença guardada adulterada numa escola já ativada: Aviso de licença ilegível, nunca a tela de ativação", () => {
  const { token, ...resto } = conferidaHoje();
  const partes = token.split(".");
  partes[3] = Buffer.from(JSON.stringify(licencaBase({ features: [{ key: "webinars" }, { key: "pago" }] }))).toString("base64url");
  const situacao = estado({ ...resto, token: partes.join(".") });

  assert.equal(situacao.verificationError, "assinatura_da_licenca");
  assert.equal(situacao.evaluation.degree, "aviso");
  assert.equal(situacao.evaluation.reasons[0].reason, "licenca_ilegivel");
  assert.equal(isFeatureEnabled(situacao, "pago"), false);
});

test("licença de outra raiz (um emissor pirata com a chave trocada) não liga nada", () => {
  const pirata = novaRaiz("raiz-2026");
  const emissaoPirata = novaChaveDeEmissao(pirata);
  const situacao = estado({ token: assinarLicenca(emissaoPirata, licencaBase()), everActivated: false });

  assert.equal(situacao.verificationError, "assinatura_do_certificado");
  assert.equal(situacao.evaluation.degree, "nao_ativada");
});

test("relógio do servidor adiantado com conferência recente: vale a hora do Emissor e a anual não vence antes da hora", () => {
  const validade = "2027-11-10T23:59:59.000Z";
  const licenca = licencaBase({ expiresAt: "2028-03-01T00:00:00.000Z", plan: { kind: "annual", validUntil: validade, steps: passosDaAnual(validade) } });
  const horaDoEmissor = new Date("2027-06-01T00:00:00.000Z");
  const relogioErrado = new Date("2029-01-01T00:00:00.000Z");
  const situacao = estado(
    { token: assinarLicenca(emissao, licenca), everActivated: true, lastCheckIn: { emissorTime: horaDoEmissor, localTime: relogioErrado }, lastSeenAt: horaDoEmissor },
    { agora: new Date(relogioErrado.getTime() + 60_000) }
  );

  assert.equal(situacao.clock.source, "emissor");
  assert.equal(situacao.clock.clockWrong, true);
  assert.equal(situacao.evaluation.degree, "ok");
});

test("o modo só exige licença com o texto exato 'enforce', e as raízes ignoram o que não segue o formato", () => {
  const antes = process.env.BUNKER_LICENSING_MODE;

  try {
    for (const valor of [undefined, "", "on", "ENFORCE", "enforce "]) {
      if (valor === undefined) delete process.env.BUNKER_LICENSING_MODE;
      else process.env.BUNKER_LICENSING_MODE = valor;
      assert.equal(licensingMode(), "off", JSON.stringify(valor));
    }
    process.env.BUNKER_LICENSING_MODE = "enforce";
    assert.equal(licensingMode(), "enforce");
  } finally {
    if (antes === undefined) delete process.env.BUNKER_LICENSING_MODE;
    else process.env.BUNKER_LICENSING_MODE = antes;
  }

  assert.deepEqual(parseTrustedRoots(undefined), []);
  assert.deepEqual(parseTrustedRoots("não é json"), []);
  assert.deepEqual(parseTrustedRoots('{"rid":"x"}'), []);
  assert.deepEqual(
    parseTrustedRoots(JSON.stringify([raiz.confiavel, { rid: "curta", publicKey: "abc" }, { rid: "raiz-2026", publicKey: raiz.confiavel.publicKey }])),
    [raiz.confiavel]
  );
});
