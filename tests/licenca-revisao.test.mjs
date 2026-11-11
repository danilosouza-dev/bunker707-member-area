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

// ---- clock-rewind.mjs: um UPDATE periódico na linha segura os prazos -----------------------------------

/**
 * O Emissor bloqueado, o agendador rodando (uma rodada por hora, para o teste ser rápido) e, a cada `editarACadaDias`,
 * o UPDATE `last_seen_at = null, last_check_in_local_at = now()`. Devolve a situação nos dias pedidos.
 */
function simularUpdatePeriodico(editarACadaDias, dias) {
  const T0 = Date.parse("2026-11-10T12:00:00.000Z");
  let linha = instalacaoEmDia(T0);
  const situacoes = new Map();
  const ultimaHora = Math.max(...dias) * 24;

  for (let hora = 1; hora <= ultimaHora; hora += 1) {
    const agora = T0 + hora * HORA;

    if (editarACadaDias > 0 && hora % (editarACadaDias * 24) === 0) {
      linha = { ...linha, lastSeenAt: null, lastCheckIn: { emissorTime: linha.lastCheckIn.emissorTime, localTime: new Date(agora) } };
    }

    const plano = store.planLicenseTick(linha, { roots: RAIZES, configuredHost: ENDERECO, systemNow: new Date(agora) });
    linha = { ...linha, ...plano.patch };

    if (plano.checkIn.due) {
      linha = { ...linha, checkInResult: "sem_resposta" };
    }

    if (dias.includes(hora / 24)) {
      situacoes.set(hora / 24, situacao(linha, agora));
    }
  }

  return { T0, situacoes };
}

test("UPDATE semanal na linha com o Emissor bloqueado não segura os prazos: a hora confiável nunca fica mais de 48 h atrás do relógio (revisão: clock-rewind)", () => {
  const { T0, situacoes } = simularUpdatePeriodico(6, [10, 33, 61, 63]);

  // Sem contato: Aviso no 8º dia; o arquivo vence no dia 30 (Admin limitado) e a escola congela 30 dias depois. Antes da
  // correção, o UPDATE a cada 6 dias deixava a escola "em dia" no dia 61, só com a faixa de relógio errado. Agora o UPDATE
  // segura cada passo por no máximo 48 h.
  for (const [dia, esperado] of [[10, "aviso"], [33, "admin_limitado"], [61, "admin_limitado"], [63, "escola_congelada"]]) {
    const vista = situacoes.get(dia);
    assert.equal(vista.evaluation.degree, esperado, `dia ${dia}`);
    assert.ok(vista.clock.now.getTime() >= T0 + dia * DIA - 48 * HORA, `dia ${dia}: a hora confiável fica no máximo 48 h atrás do relógio`);
  }

  // Sem o UPDATE, a mesma escada no relógio do servidor: o piso só tira o que o UPDATE ganhava além de 48 h.
  const controle = simularUpdatePeriodico(0, [8, 31, 61]).situacoes;
  assert.deepEqual([8, 31, 61].map((dia) => controle.get(dia).evaluation.degree), ["aviso", "admin_limitado", "escola_congelada"]);
});
