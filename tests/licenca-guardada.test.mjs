import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { bancoDaLicenca } from "./support/licenca-banco-em-memoria.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz } from "./support/licenca-de-teste.mjs";

// O que a Instalação guarda sobre a própria licença (docs/32 §11.3 e §16): as regras de gravação da tabela
// license_state (src/server/licensing/store.ts), com um banco em memória no lugar do Supabase. Um teste por regra do
// contrato do store: a primeira vez da licença ilegível e do endereço diferente, a última hora vista que só anda um
// minuto por rodada do tick e é realinhada na conferência boa, a licença mais nova que só sobe, a licença nova aceita
// só se confere, não é mais antiga e é desta Instalação, e a conferência pedida na hora quando a guardada não confere.
// Mais: quando a conferência vence, e duas rodadas ao mesmo tempo. O banco de verdade fica em
// tests/integration/licenca-guardada.test.mjs.

const store = await import("../src/server/licensing/store.ts");

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const iso = (data) => data.toISOString();
const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const RAIZES = [raiz.confiavel];
const AGORA = new Date("2026-11-11T12:00:00.000Z");
const ENDERECO = "https://alunos.escola.test";
const VAZIO = store.EMPTY_LICENSE_RECORD;
const INSTALACAO = { installationId: "inst_0001", installationSecret: "segredo-de-teste-da-instalacao-0001", checkInSequence: "seq-1" };

const assinar = (licenca = licencaBase()) => assinarLicenca(emissao, licenca);
const depois = (ms, base = AGORA) => new Date(base.getTime() + ms);

/** A linha de uma Instalação em dia: licença guardada que confere, conferida agora. */
function emDia(licenca = licencaBase(), extra = {}) {
  return {
    ...VAZIO,
    ...INSTALACAO,
    version: 1,
    token: assinar(licenca),
    everActivated: true,
    lastSeenAt: AGORA,
    lastCheckIn: { emissorTime: AGORA, localTime: AGORA },
    newestIssuedAt: new Date(licenca.issuedAt),
    checkInAttemptedAt: AGORA,
    checkInResult: "ok",
    ...extra
  };
}

/** A licença guardada com o conteúdo trocado depois de assinada. */
function adulterada(licenca = licencaBase()) {
  const partes = assinar(licenca).split(".");
  partes[3] = Buffer.from(JSON.stringify({ ...licenca, features: [{ key: "webinars" }, { key: "pago" }] })).toString("base64url");
  return partes.join(".");
}

function rodada(linha, opcoes = {}) {
  return store.planLicenseTick(linha, { roots: RAIZES, configuredHost: opcoes.endereco ?? ENDERECO, systemNow: opcoes.agora ?? AGORA });
}

const aplicar = (linha, patch) => ({ ...linha, ...patch, version: linha.version + 1 });

/** O nonce que a Instalação sorteou para este pedido: volta dentro da licença assinada. */
const NONCE = "nonce-deste-pedido-0000000000000000000000";

/** A licença que o Emissor devolveria agora, para esta Instalação, em resposta a este pedido. */
const devolvidaAgora = (extra = {}) =>
  licencaBase({ issuedAt: "2026-11-11T12:00:00.000Z", expiresAt: "2027-02-09T12:00:00.000Z", nonce: NONCE, ...extra });

function aceitar(linha, token, extra = {}) {
  return store.planCheckInSuccess(linha, {
    token,
    sequence: "seq-2",
    nonce: NONCE,
    roots: RAIZES,
    receivedAt: depois(2_000),
    attemptStartedAt: AGORA,
    ...extra
  });
}

// ---- A leitura de cada pedido --------------------------------------------------------------------------

test("modo off: a situação sai sem criar o banco nem perguntar raízes, endereço ou relógio", async () => {
  const proibido = (nome) => () => {
    throw new Error(`${nome} no modo off`);
  };
  const situacao = await store.loadLicenseState({
    mode: "off",
    db: proibido("banco"),
    roots: proibido("raízes"),
    configuredHost: proibido("endereço"),
    systemNow: proibido("relógio")
  });

  assert.deepEqual(situacao, { mode: "off" });
});

test("modo enforce: a situação lê a linha uma vez, avalia e nunca grava; sem linha, é a tela de ativação", async () => {
  const ler = (banco) =>
    store.loadLicenseState({ mode: "enforce", db: () => banco, roots: () => RAIZES, configuredHost: () => ENDERECO, systemNow: () => AGORA });
  const banco = bancoDaLicenca(VAZIO, emDia());
  const situacao = await ler(banco);

  assert.equal(situacao.mode, "enforce");
  assert.equal(situacao.evaluation.degree, "ok");
  assert.equal(situacao.license.installation.id, "inst_0001");
  assert.equal(JSON.stringify(situacao).includes(INSTALACAO.installationSecret), false, "o segredo nunca entra na situação");
  assert.deepEqual(banco.chamadas, ["read"], "uma leitura e nenhuma gravação");

  const vazio = bancoDaLicenca(VAZIO);
  assert.equal((await ler(vazio)).evaluation.degree, "nao_ativada");
  assert.deepEqual(vazio.chamadas, ["read"]);
});

// ---- A última hora vista -------------------------------------------------------------------------------

test("a última hora vista anda um minuto por rodada e nunca copia o relógio do servidor, adiantado ou atrasado", () => {
  const linha = emDia(licencaBase(), { lastSeenAt: AGORA });

  for (const relogio of [new Date("2036-11-11T12:00:00.000Z"), new Date("2025-01-01T00:00:00.000Z"), AGORA, depois(30 * MINUTO)]) {
    assert.equal(iso(rodada(linha, { agora: relogio }).patch.lastSeenAt), "2026-11-11T12:01:00.000Z", iso(relogio));
  }
});

test("relógio parado: três rodadas andam três minutos, e a situação nunca fica antes disso", async () => {
  const banco = bancoDaLicenca(VAZIO, emDia(licencaBase(), { lastCheckIn: null }));
  const parado = new Date("2026-11-01T00:00:00.000Z");

  for (let vez = 0; vez < 3; vez += 1) {
    await store.mutateLicenseState(banco, (linha) => {
      const plano = rodada(linha, { agora: parado });
      return { patch: plano.patch, outcome: null };
    });
  }

  assert.equal(iso(banco.linha.lastSeenAt), "2026-11-11T12:03:00.000Z");
  const situacao = await store.loadLicenseState({
    mode: "enforce",
    db: () => banco,
    roots: () => RAIZES,
    configuredHost: () => ENDERECO,
    systemNow: () => parado
  });
  assert.equal(situacao.clock.source, "ultima_hora_vista");
  assert.equal(iso(situacao.clock.now), "2026-11-11T12:03:00.000Z");
});

test("sem última hora vista, ela começa da emissão da licença guardada, assinada, e não do relógio", () => {
  const linha = emDia(licencaBase(), { lastSeenAt: null, lastCheckIn: null, newestIssuedAt: null });
  assert.equal(iso(rodada(linha, { agora: new Date("2030-01-01T00:00:00.000Z") }).patch.lastSeenAt), "2026-11-10T12:01:00.000Z");
});

test("a última hora vista nunca volta: à frente da licença e da última conferência, ela segue dela", () => {
  const vista = new Date("2026-11-20T08:00:00.000Z");
  assert.equal(iso(rodada(emDia(licencaBase(), { lastSeenAt: vista })).patch.lastSeenAt), "2026-11-20T08:01:00.000Z");
});

test("data inválida guardada na última hora vista é ignorada e trocada pela conta certa", () => {
  const plano = rodada(emDia(licencaBase(), { lastSeenAt: new Date("infinity") }));
  assert.equal(iso(plano.patch.lastSeenAt), "2026-11-11T12:01:00.000Z", "a partir da última conferência");
});

test("Instalação sem licença, sem hora e sem identificador: a rodada não inventa nada e não grava", async () => {
  const banco = bancoDaLicenca(VAZIO);
  const feito = await store.mutateLicenseState(banco, (linha) => {
    const plano = rodada(linha);
    return { patch: plano.patch, outcome: plano.checkIn };
  });

  assert.deepEqual(feito, { record: null, outcome: { due: false, reason: "sem_instalacao" }, wrote: false });
  assert.deepEqual(banco.chamadas, ["read"]);
  assert.equal(banco.linha, null);
});

// ---- A licença mais nova e a ativação ------------------------------------------------------------------

test("licença guardada que confere: marca a Instalação como ativada e a data da mais nova sobe até a emissão dela", () => {
  const plano = rodada({ ...VAZIO, version: 1, token: assinar() });

  assert.equal(plano.patch.everActivated, true);
  assert.equal(iso(plano.patch.newestIssuedAt), "2026-11-10T12:00:00.000Z");
  assert.equal("newestIssuedAt" in rodada(emDia()).patch, false, "já na mesma data: nada a gravar");
});

test("a data da mais nova nunca desce: a licença guardada mais antiga não vale, a marca fica e a conferência é pedida", () => {
  const maisNova = new Date("2026-11-11T11:00:00.000Z");
  const plano = rodada(emDia(licencaBase(), { newestIssuedAt: maisNova }));

  assert.equal(plano.state.verificationError, "licenca_antiga");
  assert.equal("newestIssuedAt" in plano.patch, false);
  assert.equal(iso(plano.patch.unreadableSince), iso(AGORA));
  assert.equal(iso(plano.patch.checkInRequestedAt), iso(AGORA));
});

// ---- Licença ilegível ----------------------------------------------------------------------------------

test("licença guardada que não confere: grava desde quando na primeira rodada, pede a conferência na hora e não mexe nas seguintes", () => {
  const linha = emDia(licencaBase(), { token: adulterada() });
  const primeira = rodada(linha);

  assert.equal(primeira.state.verificationError, "assinatura_da_licenca");
  assert.equal(iso(primeira.patch.unreadableSince), iso(AGORA), "com a hora confiável");
  assert.equal(iso(primeira.patch.checkInRequestedAt), iso(AGORA));
  assert.deepEqual(primeira.checkIn, { due: true, reason: "pedida" }, "a conferência sai nesta mesma rodada");

  const seguinte = rodada({ ...aplicar(linha, primeira.patch), checkInRequestedAt: null, checkInResult: "nao_configurado" }, { agora: depois(MINUTO) });
  assert.equal("unreadableSince" in seguinte.patch, false, "a primeira vez continua valendo");
  assert.equal("checkInRequestedAt" in seguinte.patch, false, "não pede de novo a cada minuto");
});

test("a linha que perdeu a licença de uma Instalação já ativada também é ilegível", () => {
  const plano = rodada(emDia(licencaBase(), { token: null }));

  assert.equal(plano.state.evaluation.reasons[0].reason, "licenca_ilegivel");
  assert.equal(iso(plano.patch.unreadableSince), iso(AGORA));
  assert.equal(iso(plano.patch.checkInRequestedAt), iso(AGORA));
});

test("a licença guardada volta a conferir: a marca de ilegível é apagada", () => {
  const plano = rodada(emDia(licencaBase(), { unreadableSince: depois(-2 * DIA) }));
  assert.equal(plano.patch.unreadableSince, null);
});

test("marca de ilegível com data inválida fica como está e congela a escola: nunca vira agora", () => {
  const plano = rodada(emDia(licencaBase(), { token: null, unreadableSince: new Date("infinity") }));

  assert.equal("unreadableSince" in plano.patch, false);
  assert.equal(plano.state.evaluation.degree, "escola_congelada");
});

// ---- Endereço diferente --------------------------------------------------------------------------------

test("endereço configurado diferente do da licença: grava desde quando a primeira vez, mantém nas seguintes e apaga quando volta a bater", () => {
  const outro = "https://outra.escola.test";
  const linha = emDia();
  const primeira = rodada(linha, { endereco: outro });

  assert.equal(iso(primeira.patch.hostMismatchSince), iso(AGORA));
  assert.equal(primeira.state.evaluation.restrictions.newAccess, true, "sem acesso novo desde o Aviso");

  const mantida = aplicar(linha, primeira.patch);
  assert.equal("hostMismatchSince" in rodada(mantida, { endereco: outro, agora: depois(DIA) }).patch, false);
  assert.equal(rodada(mantida, { endereco: ENDERECO }).patch.hostMismatchSince, null);
});

test("sem licença legível, a marca do endereço não muda: não há com o que comparar", () => {
  const plano = rodada(emDia(licencaBase(), { token: adulterada(), hostMismatchSince: depois(-DIA) }));
  assert.equal("hostMismatchSince" in plano.patch, false);
});

// ---- A licença que chega do Emissor --------------------------------------------------------------------

test("licença nova do Emissor: troca a licença e a sequência, guarda a hora assinada e realinha a hora vista, até para trás", () => {
  const linha = emDia(licencaBase(), {
    lastSeenAt: new Date("2026-11-12T08:00:00.000Z"),
    unreadableSince: depois(-HORA),
    checkInRequestedAt: depois(-MINUTO),
    checkInResult: "em_andamento"
  });
  const token = assinar(devolvidaAgora());
  const plano = aceitar(linha, token);

  assert.equal(plano.outcome.accepted, true);
  assert.equal(plano.patch.token, token);
  assert.equal(plano.patch.checkInSequence, "seq-2");
  assert.equal(plano.patch.everActivated, true);
  assert.equal(iso(plano.patch.newestIssuedAt), "2026-11-11T12:00:00.000Z");
  assert.equal(iso(plano.patch.lastSeenAt), "2026-11-11T12:00:00.000Z", "a hora do Emissor manda, mesmo com a vista adiantada");
  assert.deepEqual(plano.patch.lastCheckIn, { emissorTime: new Date("2026-11-11T12:00:00.000Z"), localTime: depois(2_000) });
  assert.equal(plano.patch.unreadableSince, null);
  assert.equal(plano.patch.checkInResult, "ok");
  assert.equal(plano.patch.checkInRequestedAt, null, "a tentativa atendeu o pedido");
});

test("licença do Emissor que não confere, de outra raiz ou adulterada, é recusada: grava o motivo e nada mais muda", () => {
  const pirata = novaChaveDeEmissao(novaRaiz("raiz-2026"));

  for (const token of [assinarLicenca(pirata, devolvidaAgora()), adulterada(devolvidaAgora())]) {
    const plano = aceitar(emDia(), token);
    assert.deepEqual(plano.outcome, { accepted: false, result: "licenca_invalida" });
    assert.deepEqual(plano.patch, { checkInResult: "licenca_invalida" });
  }
});

test("licença do Emissor com o nonce deste pedido é fresca: vale mesmo mais antiga que a mais nova já aceita, e a marca a acompanha", () => {
  const linha = emDia(devolvidaAgora());
  const antiga = aceitar(linha, assinar(devolvidaAgora({ issuedAt: "2026-11-11T11:59:59.000Z" })));

  assert.equal(antiga.outcome.accepted, true, "o relógio do nosso Emissor que pulou para a frente e voltou não prende a escola");
  assert.equal(iso(antiga.patch.newestIssuedAt), "2026-11-11T11:59:59.000Z");
  assert.equal(iso(antiga.patch.lastSeenAt), "2026-11-11T11:59:59.000Z");

  const mesma = aceitar(linha, assinar(devolvidaAgora({ features: [] })));
  assert.equal(mesma.outcome.accepted, true);
  assert.equal(iso(mesma.patch.newestIssuedAt), "2026-11-11T12:00:00.000Z");
});

test("licença do Emissor sem o nonce deste pedido (a resposta de outro pedido, ou a por arquivo) é recusada: nada muda", () => {
  for (const token of [assinar(devolvidaAgora({ nonce: "nonce-de-outro-pedido-00000000000000000000" })), assinar(devolvidaAgora({ nonce: undefined }))]) {
    const plano = aceitar(emDia(), token);
    assert.deepEqual(plano.outcome, { accepted: false, result: "nonce_diferente" });
    assert.deepEqual(plano.patch, { checkInResult: "nonce_diferente" });
  }

  assert.deepEqual(aceitar(emDia(), assinar(devolvidaAgora()), { nonce: "" }).outcome, { accepted: false, result: "nonce_diferente" }, "sem nonce no pedido, nada é fresco");
});

test("licença do Emissor para outra Instalação é recusada", () => {
  const plano = aceitar(emDia(), assinar(devolvidaAgora({ installation: { id: "inst_9999", host: "alunos.escola.test" } })));
  assert.deepEqual(plano.outcome, { accepted: false, result: "outra_instalacao" });
  assert.equal("token" in plano.patch, false);
});

test("marca da mais nova com data inválida: a licença guardada não vale, e só a resposta fresca do Emissor conserta a marca", () => {
  const linha = emDia(licencaBase(), { newestIssuedAt: new Date("infinity") });
  assert.equal(rodada(linha).state.verificationError, "licenca_antiga", "a guardada nunca vale com a marca inválida");

  const plano = aceitar(linha, assinar(devolvidaAgora()));
  assert.equal(plano.outcome.accepted, true);
  assert.equal(iso(plano.patch.newestIssuedAt), "2026-11-11T12:00:00.000Z");
});

test("falha da conferência: grava o motivo e atende o pedido feito antes da tentativa; o feito durante fica para a seguinte", () => {
  const antes = store.planCheckInFailure(emDia(licencaBase(), { checkInRequestedAt: depois(-MINUTO) }), { result: "sem_resposta", attemptStartedAt: AGORA });
  assert.deepEqual(antes.patch, { checkInResult: "sem_resposta", checkInRequestedAt: null });

  const durante = store.planCheckInFailure(emDia(licencaBase(), { checkInRequestedAt: depois(5_000) }), { result: "sem_resposta", attemptStartedAt: AGORA });
  assert.deepEqual(durante.patch, { checkInResult: "sem_resposta" });

  const estranho = store.planCheckInFailure(emDia(), { result: "Falha: <html>", attemptStartedAt: AGORA });
  assert.deepEqual(estranho.patch, { checkInResult: "erro_inesperado" }, "só códigos no formato da coluna");
});

// ---- Quando conferir -----------------------------------------------------------------------------------

test("sem identificador e segredo da Instalação não há conferência, e a rodada não reserva nada", () => {
  const plano = rodada(emDia(licencaBase(), { installationId: null, installationSecret: null, lastCheckIn: null, checkInResult: null }));

  assert.deepEqual(plano.checkIn, { due: false, reason: "sem_instalacao" });
  assert.equal("checkInResult" in plano.patch, false);
});

test("a primeira conferência sai na hora; a diária volta no minuto sorteado da Instalação, entre 6 e 30 horas depois", () => {
  const nunca = rodada(emDia(licencaBase(), { lastCheckIn: null, checkInResult: null }));
  assert.deepEqual(nunca.checkIn, { due: true, reason: "diaria" });
  assert.equal(nunca.patch.checkInResult, "em_andamento", "reservada na mesma gravação");
  assert.equal(iso(nunca.patch.checkInAttemptedAt), iso(AGORA));

  const minuto = store.checkInMinuteOfDay("inst_0001");

  for (const atrasoDaUltima of [0, 3 * HORA, 13 * HORA, 23 * HORA]) {
    const ultimaBoa = depois(atrasoDaUltima, new Date(Date.UTC(2026, 10, 11) + minuto * MINUTO));
    const proxima = store.nextDailyCheckInMs(ultimaBoa.getTime(), "inst_0001");
    const linha = emDia(licencaBase(), { lastCheckIn: { emissorTime: ultimaBoa, localTime: ultimaBoa }, checkInAttemptedAt: ultimaBoa });

    assert.equal(new Date(proxima).getUTCHours() * 60 + new Date(proxima).getUTCMinutes(), minuto, "no minuto sorteado");
    assert.ok(proxima - ultimaBoa.getTime() >= 6 * HORA && proxima - ultimaBoa.getTime() <= 30 * HORA, `${atrasoDaUltima / HORA} h`);
    assert.deepEqual(store.checkInDecision(linha, new Date(proxima - MINUTO)), { due: false, reason: "em_dia" });
    assert.deepEqual(store.checkInDecision(linha, new Date(proxima)), { due: true, reason: "diaria" });
  }

  const minutos = new Set(Array.from({ length: 60 }, (_, indice) => store.checkInMinuteOfDay(`inst_${indice}`)));
  assert.ok(minutos.size > 50, "as Instalações se espalham pelo dia");
});

test("conferência que falhou tenta de novo de hora em hora; o relógio voltado para antes da tentativa não segura", () => {
  const falhou = emDia(licencaBase(), { checkInResult: "sem_resposta", checkInAttemptedAt: AGORA });

  assert.deepEqual(store.checkInDecision(falhou, depois(59 * MINUTO)), { due: false, reason: "aguardando_nova_tentativa" });
  assert.deepEqual(store.checkInDecision(falhou, depois(HORA)), { due: true, reason: "nova_tentativa" });
  assert.deepEqual(store.checkInDecision(falhou, depois(-DIA)), { due: true, reason: "nova_tentativa" });
});

test("conferência pedida sai na hora, mesmo com a diária em dia e logo depois de uma falha", () => {
  for (const extra of [{}, { checkInResult: "sem_resposta", checkInAttemptedAt: depois(-MINUTO) }]) {
    assert.deepEqual(store.checkInDecision(emDia(licencaBase(), { checkInRequestedAt: AGORA, ...extra }), depois(MINUTO)), { due: true, reason: "pedida" });
  }
});

test("conferência reservada há menos de 5 minutos não sai de novo; a reserva esquecida conta como falha e espera 1 hora", () => {
  const reservada = emDia(licencaBase(), { checkInResult: "em_andamento", checkInAttemptedAt: AGORA, checkInRequestedAt: AGORA });

  assert.deepEqual(store.checkInDecision(reservada, depois(4 * MINUTO)), { due: false, reason: "em_andamento" }, "nem pedida");
  assert.deepEqual(store.checkInDecision({ ...reservada, checkInRequestedAt: null }, depois(5 * MINUTO)), { due: false, reason: "aguardando_nova_tentativa" });
  assert.deepEqual(store.checkInDecision({ ...reservada, checkInRequestedAt: null }, depois(HORA)), { due: true, reason: "nova_tentativa" });
});

// ---- Duas rodadas ao mesmo tempo -----------------------------------------------------------------------

test("duas rodadas ao mesmo tempo: a gravação com a versão velha é recusada, a rodada lê de novo e só uma reserva a conferência", async () => {
  let outraGravou = false;
  const banco = bancoDaLicenca(VAZIO, emDia(licencaBase(), { lastCheckIn: null, checkInResult: null }), {
    antesDeGravar(atual) {
      if (!outraGravou) {
        outraGravou = true;
        atual.mexer({ checkInAttemptedAt: AGORA, checkInResult: "em_andamento", lastSeenAt: depois(MINUTO) });
      }
    }
  });
  const feito = await store.mutateLicenseState(banco, (linha) => {
    const plano = rodada(linha);
    return { patch: plano.patch, outcome: plano.checkIn };
  });

  assert.deepEqual(banco.chamadas, ["read", "write", "read", "write"]);
  assert.deepEqual(feito.outcome, { due: false, reason: "em_andamento" }, "a outra rodada já conferia");
  assert.equal(feito.wrote, true);
  assert.equal(iso(banco.linha.lastSeenAt), "2026-11-11T12:02:00.000Z", "a conta refeita sobre a linha nova");
});

test("a gravação desiste depois de 3 tentativas perdidas e não grava nada por cima", async () => {
  const banco = bancoDaLicenca(VAZIO, emDia(), { antesDeGravar: (atual) => atual.mexer({}) });
  const feito = await store.mutateLicenseState(banco, () => ({ patch: { checkInResult: "sem_resposta" }, outcome: null }));

  assert.equal(feito, null);
  assert.equal(banco.chamadas.filter((chamada) => chamada === "write").length, store.LICENSE_WRITE_ATTEMPTS);
  assert.equal(banco.linha.checkInResult, "ok");
});
