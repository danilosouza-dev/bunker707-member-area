import assert from "node:assert/strict";
import test from "node:test";
import "./support/transpile-tsx.mjs";

// O aviso da sala no estilo do YouTube (o snackbar invertido; docs/31; docs/18 §2.2), as regras puras, sem navegador:
// um aviso de cada vez (o novo troca, o mesmo tipo so reinicia o tempo), o tempo que falta com a pausa do ponteiro e do
// foco (WCAG 2.2.1) e o lugar do aviso no computador, no celular em pe e deitado. Quem liga o aviso (a sala e o
// console) acrescenta aqui as regras dele.

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
