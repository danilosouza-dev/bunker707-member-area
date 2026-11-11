import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";
import { bancoDaLicenca } from "./support/licenca-banco-em-memoria.mjs";
import { assinarLicenca, licencaBase, novaChaveDeEmissao, novaRaiz, passosDaAnual } from "./support/licenca-de-teste.mjs";

// Os cenários da revisão independente da licença no produto (11/11/2026), um teste por cenário confirmado, cada um com o
// nome do script da revisão. Cada teste falhava antes da correção e passa depois (docs/32 §16).

const store = await import("../src/server/licensing/store.ts");
const { computeLicenseState } = await import("../src/server/licensing/state.ts");
const { runLicenseCheckInNow, runLicenseTick } = await import("../src/server/licensing/tick.ts");

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;
const iso = (ms) => new Date(ms).toISOString();
const raiz = novaRaiz("raiz-2026");
const emissao = novaChaveDeEmissao(raiz);
const RAIZES = [raiz.confiavel];
const ENDERECO = "https://alunos.escola.test";
const VAZIO = store.EMPTY_LICENSE_RECORD;
const INSTALACAO = { installationId: "inst_0001", installationSecret: "segredo-de-teste-da-instalacao-0001", checkInSequence: "sequencia-0000000000001" };

const assinar = (licenca) => assinarLicenca(emissao, licenca);

/** A situação de um pedido, com a linha guardada e o relógio do servidor dado. */
function situacao(linha, agoraMs, endereco = ENDERECO) {
  return computeLicenseState({ mode: "enforce", roots: RAIZES, snapshot: store.snapshotOf(linha), systemNow: new Date(agoraMs), configuredHost: endereco });
}

/** Uma Instalação em dia, conferida pela última vez em `emitidaMs`. */
function instalacaoEmDia(emitidaMs, licenca = {}) {
  const token = assinar(licencaBase({ issuedAt: iso(emitidaMs), expiresAt: iso(emitidaMs + 30 * DIA), ...licenca }));
  return {
    ...VAZIO,
    ...INSTALACAO,
    version: 1,
    token,
    everActivated: true,
    lastSeenAt: new Date(emitidaMs),
    lastCheckIn: { emissorTime: new Date(emitidaMs), localTime: new Date(emitidaMs) },
    newestIssuedAt: new Date(emitidaMs),
    checkInAttemptedAt: new Date(emitidaMs),
    checkInResult: "ok"
  };
}

// ---- emissor-glitch.mjs: o relógio do nosso Emissor pula para a frente -----------------------------------

test("relógio do nosso Emissor que pula para a frente: a conferência seguinte, com o nonce do pedido, traz a escola de volta (revisão: emissor-glitch)", async () => {
  const REAL = Date.parse("2027-10-01T12:00:00.000Z");
  const validade = "2027-11-10T23:59:59-03:00";
  const anual = { kind: "annual", validUntil: validade, steps: passosDaAnual(validade) };
  let relogioDoEmissor = REAL + 80 * DIA;
  const pedidos = [];
  const emissor = {
    async checkIn(pedido) {
      pedidos.push(pedido);
      const emitida = relogioDoEmissor;
      const token = assinar(licencaBase({ issuedAt: iso(emitida), expiresAt: iso(emitida + 30 * DIA), plan: anual, nonce: pedido.nonce }));
      return { ok: true, token, sequence: `sequencia-nova-${String(pedidos.length).padStart(8, "0")}` };
    }
  };
  const banco = bancoDaLicenca(VAZIO, instalacaoEmDia(REAL - DIA, { plan: anual }));
  const dependencias = (agoraMs) => ({ db: () => banco, client: () => emissor, roots: () => RAIZES, configuredHost: () => ENDERECO, now: () => new Date(agoraMs) });

  // Uma conferência durante o salto de +80 dias: licença válida, assinada, com o nonce certo. Ela vale, e o estrago é real.
  const primeira = await runLicenseTick({ mode: "enforce", ...dependencias(REAL) });
  assert.equal(primeira.result, "ok");
  assert.equal(situacao(banco.linha, REAL + MINUTO).evaluation.degree, "admin_limitado", "a hora do Emissor manda, mesmo errada");

  // O Emissor acerta o relógio. A conferência seguinte traz o nonce deste pedido: é fresca, e vale mesmo mais antiga
  // que a mais nova já aceita. Antes da correção ela era recusada como licenca_antiga, e a escola ficava presa.
  relogioDoEmissor = REAL + HORA;
  const seguinte = await runLicenseCheckInNow(dependencias(REAL + HORA));
  assert.deepEqual(seguinte, { done: true, result: "ok" });

  const linha = banco.linha;
  assert.equal(iso(linha.newestIssuedAt.getTime()), iso(REAL + HORA), "a mais nova aceita acompanha a resposta fresca");
  assert.equal(iso(linha.lastSeenAt.getTime()), iso(REAL + HORA), "a última hora vista também");
  assert.deepEqual(linha.lastCheckIn, { emissorTime: new Date(REAL + HORA), localTime: new Date(REAL + HORA) });

  const depois = situacao(linha, REAL + HORA + MINUTO);
  assert.equal(depois.evaluation.degree, "ok");
  assert.equal(depois.clock.now.toISOString(), iso(REAL + HORA + MINUTO));

  // A rodada seguinte do tick anda a hora vista a partir da hora certa, não da licença do salto.
  await runLicenseTick({ mode: "enforce", ...dependencias(REAL + HORA + MINUTO) });
  assert.equal(iso(banco.linha.lastSeenAt.getTime()), iso(REAL + HORA + MINUTO));

  // A anti-volta continua para a licença guardada e para a licença por arquivo: a mais antiga que a mais nova não vale.
  const antiga = assinar(licencaBase({ issuedAt: iso(REAL - DIA), expiresAt: iso(REAL + 29 * DIA), plan: anual }));
  assert.equal(situacao({ ...banco.linha, token: antiga }, REAL + 2 * HORA).verificationError, "licenca_antiga");
  const arquivoAntigo = assinar(licencaBase({ issuedAt: iso(REAL), expiresAt: iso(REAL + 30 * DIA), plan: anual, delivery: "file" }));
  assert.deepEqual(store.planLicenseFile(banco.linha, { token: arquivoAntigo, roots: RAIZES, configuredHost: ENDERECO }).outcome, {
    accepted: false,
    result: "licenca_antiga"
  });

  // Sem o nonce deste pedido, a resposta não é fresca: a de outro pedido (a repetida) não entra.
  const repetida = store.planCheckInSuccess(
    { ...banco.linha, checkInAttemptedAt: new Date(REAL + 3 * HORA), checkInResult: "em_andamento" },
    {
      token: assinar(licencaBase({ issuedAt: iso(REAL + 2 * HORA), expiresAt: iso(REAL + 30 * DIA), plan: anual, nonce: "outro-pedido-0000000000000000" })),
      sequence: "sequencia-nova-99999999",
      nonce: "este-pedido-00000000000000000",
      roots: RAIZES,
      receivedAt: new Date(REAL + 3 * HORA),
      attemptStartedAt: new Date(REAL + 3 * HORA)
    }
  );
  assert.deepEqual(repetida.outcome, { accepted: false, result: "nonce_diferente" });
});
