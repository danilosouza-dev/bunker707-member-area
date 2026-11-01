import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// O aviso da sala no estilo do YouTube (o snackbar invertido; docs/31; docs/18 §2.2), as regras puras, sem navegador:
// um aviso de cada vez (o novo troca, o mesmo tipo so reinicia o tempo), o tempo que falta com a pausa do ponteiro e do
// foco (WCAG 2.2.1), que so acaba quando os dois saem, e o lugar do aviso no computador, no celular em pe e deitado.
// Quem liga o aviso (a sala e o console) acrescenta aqui as regras dele.

const model = await import("../src/components/member/webinars/room/room-snackbar-model.ts");

const MAO = { key: "hand-lowered", text: "A equipe abaixou a sua mão." };
const SEM_SOM = { action: { key: "settings", label: "Configurações" }, key: "no-audio", text: "Não está chegando som do seu microfone." };

test("nextSnackbar: um de cada vez; o novo troca o atual na hora, e o mesmo tipo so reinicia o tempo, sem entrar de novo", () => {
  // Nada na tela: o aviso entra.
  assert.deepEqual(model.nextSnackbar(null, MAO), { restart: false, snack: MAO });
  // Outro tipo: troca na hora (entra de novo, com o movimento).
  const trocou = model.nextSnackbar(MAO, SEM_SOM);
  assert.equal(trocou.restart, false);
  assert.equal(trocou.snack, SEM_SOM);
  // O mesmo tipo repetido: o tempo recomeca e o aviso continua o mesmo (o mesmo objeto, no mesmo lugar).
  const repetido = model.nextSnackbar(MAO, { ...MAO });
  assert.equal(repetido.restart, true);
  assert.equal(repetido.snack, MAO, "o mesmo aviso");
  const comAcao = model.nextSnackbar(SEM_SOM, { ...SEM_SOM, action: { ...SEM_SOM.action } });
  assert.equal(comAcao.restart, true);
  assert.equal(comAcao.snack, SEM_SOM);
  // O mesmo tipo com a frase nova (o aparelho que mudou): reinicia no lugar, com a frase nova.
  const frase = { key: "device", text: "Não foi possível usar a câmera." };
  const outraFrase = { key: "device", text: "Não foi possível usar o microfone." };
  assert.deepEqual(model.nextSnackbar(frase, outraFrase), { restart: true, snack: outraFrase });
});

test("snackbarRemainingMs: conta so fora da pausa, para com o ponteiro ou o foco, volta a contar de onde parou e acaba em 0", () => {
  const seis = 6000;
  assert.equal(model.snackbarRemainingMs({ durationMs: seis, elapsedMs: 0, paused: false }), 6000);
  assert.equal(model.snackbarRemainingMs({ durationMs: seis, elapsedMs: 2500, paused: false }), 3500);
  // Em pausa nao some (null), por mais que o tempo corra.
  assert.equal(model.snackbarRemainingMs({ durationMs: seis, elapsedMs: 2500, paused: true }), null);
  assert.equal(model.snackbarRemainingMs({ durationMs: seis, elapsedMs: 9000, paused: true }), null);
  // A pausa acaba: volta a contar do tempo ja contado (o tempo da pausa nao entra no elapsedMs).
  assert.equal(model.snackbarRemainingMs({ durationMs: seis, elapsedMs: 2500, paused: false }), 3500);
  // No fim, 0 (some agora), nunca negativo; um tempo negativo conta como zero.
  assert.equal(model.snackbarRemainingMs({ durationMs: seis, elapsedMs: 6000, paused: false }), 0);
  assert.equal(model.snackbarRemainingMs({ durationMs: seis, elapsedMs: 8200, paused: false }), 0);
  assert.equal(model.snackbarRemainingMs({ durationMs: seis, elapsedMs: -50, paused: false }), 6000);
});

test("snackbarHoldStep: o ponteiro em cima ou o foco dentro param o tempo; ele so volta a contar quando os dois saem, e quem mostra so ouve a mudanca", () => {
  const { SNACKBAR_HOLD_FREE, snackbarHoldStep } = model;
  assert.deepEqual(SNACKBAR_HOLD_FREE, { focus: false, pointer: false });
  /** Aplica as mudancas em ordem e devolve o que quem mostra ouviu (so as mudancas do pausado) e onde parou. */
  const sequencia = (mudancas, inicio = SNACKBAR_HOLD_FREE) => {
    const ouviu = [];
    let hold = inicio;
    for (const mudanca of mudancas) {
      const passo = snackbarHoldStep(hold, mudanca);
      hold = passo.hold;
      if (passo.paused !== null) {
        ouviu.push(passo.paused ? "pausa" : "conta");
      }
    }
    return { hold, ouviu };
  };

  // Cada um sozinho: entra e sai.
  assert.deepEqual(sequencia([{ pointer: true }, { pointer: false }]).ouviu, ["pausa", "conta"]);
  assert.deepEqual(sequencia([{ focus: true }, { focus: false }]).ouviu, ["pausa", "conta"]);
  // O foco na acao, o ponteiro entra e sai: o foco continua dentro, nada volta a contar; so a saida do foco conta.
  assert.deepEqual(sequencia([{ focus: true }, { pointer: true }, { pointer: false }]).ouviu, ["pausa"]);
  assert.deepEqual(sequencia([{ focus: true }, { pointer: true }, { pointer: false }, { focus: false }]).ouviu, ["pausa", "conta"]);
  // O ponteiro em cima e o foco que sai: continua parado ate o ponteiro sair.
  assert.deepEqual(sequencia([{ pointer: true }, { focus: true }, { focus: false }]).ouviu, ["pausa"]);
  assert.deepEqual(sequencia([{ pointer: true }, { focus: true }, { focus: false }, { pointer: false }]).ouviu, ["pausa", "conta"]);
  // O foco que anda do texto para a acao (outro focusin) e o mesmo valor de novo nao repetem nada.
  assert.deepEqual(sequencia([{ focus: true }, { focus: true }, { pointer: false }]).ouviu, ["pausa"]);
  // A caixa trocou e levou o botao focado: o foco conferido na tela (fora) volta a contar, se o ponteiro nao esta em cima.
  assert.deepEqual(sequencia([{ focus: false }], { focus: true, pointer: false }), { hold: SNACKBAR_HOLD_FREE, ouviu: ["conta"] });
  assert.deepEqual(sequencia([{ focus: false }], { focus: true, pointer: true }).ouviu, []);
  // O passo nao muda o estado de quem chamou.
  const antes = { focus: true, pointer: false };
  snackbarHoldStep(antes, { focus: false });
  assert.deepEqual(antes, { focus: true, pointer: false });
});

test("snackbarPlacement: no palco a partir de lg; em pe, nunca sobre o video (acima do campo da folha aberta ou preso ao pe da tela); deitado, no pe do painel ao lado ou no palco", () => {
  const lugar = (desktop, landscape, panelShown) => model.snackbarPlacement({ desktop, landscape, panelShown });
  // A partir de lg: sempre no palco, com o painel aberto ou fechado.
  assert.equal(lugar(true, true, true), "stage");
  assert.equal(lugar(true, true, false), "stage");
  assert.equal(lugar(true, false, true), "stage");
  // Abaixo de lg, em pe.
  assert.equal(lugar(false, false, true), "sheet", "a folha aberta: logo acima do campo");
  assert.equal(lugar(false, false, false), "screen", "a folha fechada: preso ao pe da tela");
  // Abaixo de lg, deitado.
  assert.equal(lugar(false, true, true), "side", "o painel ao lado: no pe da coluna dele");
  assert.equal(lugar(false, true, false), "stage", "o painel fechado: no palco");
});
