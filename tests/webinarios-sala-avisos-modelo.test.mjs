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

test("snackToRestore: a troca de aparelho em andamento volta depois do sucesso que tomou o lugar dela; o passageiro nunca volta", () => {
  const TROCA = { key: "device_switch", persistent: true, text: "Trocando o microfone." };
  const ENVIADA = { key: "question_sent", text: "Pergunta enviada." };
  // A troca na tela; o sucesso das Perguntas toma o lugar.
  const comSucesso = model.nextSnackbar(TROCA, ENVIADA).snack;
  assert.equal(comSucesso, ENVIADA);
  assert.equal(model.snackToRestore(TROCA, comSucesso), null, "com o sucesso na tela, nada volta por cima dele");
  // O sucesso sumiu no tempo dele e a troca segue: ela volta.
  assert.equal(model.snackToRestore(TROCA, null), TROCA);
  // Na tela de novo, nada mais a fazer; a troca acabou, nada volta.
  assert.equal(model.snackToRestore(TROCA, TROCA), null);
  assert.equal(model.snackToRestore(null, null), null);
  // O aviso passageiro que saiu nao volta (o onGone ja o tirou).
  assert.equal(model.snackToRestore(MAO, null), null);
});

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

/* ------------------------------------------------------------------------------------------------
 * A sala liga o aviso (Y14): o motor sem avisos, os do motor que viram nossos e a gravacao que comecou
 * ---------------------------------------------------------------------------------------------- */

const embed = await import("../src/lib/jitsi-room-config.ts");
const live = await import("../src/components/member/webinars/room/live-room-model.ts");
const { WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");
const AJUSTES = { allowStudentCamera: true, screenFps: 30, stage: 1080 };

test("o motor sem avisos na sala: notifications vazio e o selo do topo vazio para os 4 papeis; o som da mao sai so para o aluno e a Equipe; o console so sem o aviso da mao e sem o selo do topo (D95); o dialogo da live encerrada nunca abre (D97)", () => {
  for (const role of ["student", "team", "host", "co_host"]) {
    const config = embed.liveConfigOverwrite(role, AJUSTES, null, "room");
    assert.deepEqual(config.notifications, [], `sala, ${role}: nenhum aviso do motor`);
    assert.deepEqual(config.conferenceInfo, { alwaysVisible: [], autoHide: [] }, `sala, ${role}: sem o "✋ 1" nem o selo de gravacao do motor`);
    const plateia = role === "student" || role === "team";
    assert.deepEqual(config.disabledSounds, plateia ? ["RAISE_HAND_SOUND"] : undefined, `sala, ${role}: o som da mao`);
    assert.ok(!Object.hasOwn(config, "disabledNotifications"), `sala, ${role}: ja sem aviso nenhum`);
    assert.equal(config.notifyOnConferenceDestruction, false, `sala, ${role}: a live encerrada mostra a tela da pagina, nunca o dialogo do motor`);
  }
  // No console ninguem ouve o notificationTriggered: quem apresenta continua vendo os avisos do motor (a gravacao que
  // nao comecou, a tela negada) ate os avisos do console entrarem (V2-A59). Sai so o que o console ja mostra por conta
  // propria (teste do produtor de 12/11/2026, D95): o aviso "{nome} Gostaria de participar." da mao levantada e o selo
  // do motor no topo do video (o "✋ 1" amarelo). O som da mao continua para todos no console.
  assert.deepEqual(embed.CONSOLE_DISABLED_NOTIFICATIONS, ["notify.raisedHand"]);
  for (const role of ["student", "team", "host", "co_host"]) {
    const config = embed.liveConfigOverwrite(role, AJUSTES, null, "console");
    for (const key of ["notifications", "disabledSounds"]) {
      assert.ok(!Object.hasOwn(config, key), `console, ${role}: sem a chave ${key}`);
    }
    assert.deepEqual(config.disabledNotifications, ["notify.raisedHand"], `console, ${role}: so o aviso da mao sai`);
    assert.notEqual(config.disabledNotifications, embed.CONSOLE_DISABLED_NOTIFICATIONS, "uma copia: o motor nao mexe na lista do app");
    assert.deepEqual(config.conferenceInfo, { alwaysVisible: [], autoHide: [] }, `console, ${role}: sem o selo do motor no topo`);
    assert.equal(config.notifyOnConferenceDestruction, false, `console, ${role}: sem o dialogo "A chamada foi encerrada"`);
  }
  // A sala ouve o aviso do motor, que nunca vai ao servidor, e o console continua com a lista da sala mais a dele.
  assert.ok(embed.JITSI_LISTENED_EVENTS.includes("notificationTriggered"));
  assert.ok(!embed.CONSOLE_EXTRA_EVENTS.includes("notificationTriggered"));
  assert.equal(embed.toRoomEvent("notificationTriggered", { title: "toolbar.noAudioSignalTitle" }, { nowIso: "2026-11-05T23:00:00.000Z", ownId: "eu" }), null);
});

test("engineNoticeOf: so a lista fechada vira aviso nosso, com a nossa frase; o microfone sem som so com ele ligado, e a tela so no console", () => {
  const sala = { audioOn: true, surface: "room" };
  const semSom = model.engineNoticeOf({ title: "toolbar.noAudioSignalTitle" }, sala);
  assert.deepEqual(semSom, { action: { key: model.SNACK_SETTINGS_ACTION, label: "Configurações" }, key: "mic_no_signal", text: "Não está chegando som do seu microfone." });
  assert.equal(semSom.action.label, WEBINAR_COPY.aoVivo.configuracoes, "o nome do botao da barra");
  assert.deepEqual(model.engineNoticeOf({ description: "toolbar.noAudioSignalDesc", title: "toolbar.noAudioSignalTitle" }, sala), semSom, "a descricao do motor nao muda a frase");
  assert.equal(model.engineNoticeOf({ title: "toolbar.noAudioSignalTitle" }, { audioOn: false, surface: "room" }), null, "com o microfone desligado, nada");
  // Os avisos do motor que somem sem substituto, o texto do motor e o payload estranho.
  for (const payload of [
    { title: "notify.raisedHand" },
    { description: "notify.raisedHand", title: "notify.somebody" },
    { title: "notify.nextToSpeak" },
    { title: "dialog.thankYou" },
    { title: "notify.kickParticipant" },
    { title: 42 },
    { description: { key: "x" }, title: "toolbar.noAudioSignalTitle" },
    { name: "Fulano", title: "toolbar.noAudioSignalTitle" },
    { text: "Olá", title: "toolbar.noAudioSignalTitle" },
    {},
    null,
    "toolbar.noAudioSignalTitle"
  ]) {
    assert.equal(model.engineNoticeOf(payload, sala), null, JSON.stringify(payload));
  }
  // A tela: so no console, cada descricao com a frase dela; na sala, nada.
  const negada = { description: "dialog.screenSharingPermissionDeniedError", title: "dialog.screenSharingFailedTitle" };
  const falhou = { description: "dialog.screenSharingFailed", title: "dialog.screenSharingFailedTitle" };
  assert.equal(model.engineNoticeOf(negada, sala), null);
  assert.equal(model.engineNoticeOf(falhou, sala), null);
  const noConsole = { audioOn: false, surface: "console" };
  assert.deepEqual(model.engineNoticeOf(negada, noConsole), { key: "screen_denied", text: WEBINAR_COPY.salaV2.avisos.telaNegada });
  assert.deepEqual(model.engineNoticeOf(falhou, noConsole), { key: "screen_failed", text: WEBINAR_COPY.salaV2.avisos.telaFalhou });
  assert.equal(model.engineNoticeOf({ title: "dialog.screenSharingFailedTitle" }, noConsole), null, "sem a descricao conhecida, nada");
});

test("shouldAnnounceRecording: so a gravacao que liga com o aluno ja na sala avisa; ja ligada na entrada, desligar ou fora da sala, nada", () => {
  assert.equal(model.shouldAnnounceRecording(false, true, true), true, "ligou depois da entrada");
  assert.equal(model.shouldAnnounceRecording(true, true, true), false, "ja ligada na entrada");
  assert.equal(model.shouldAnnounceRecording(true, false, true), false, "desligou");
  assert.equal(model.shouldAnnounceRecording(false, false, true), false);
  assert.equal(model.shouldAnnounceRecording(false, true, false), false, "fora da sala (ou na virada da entrada)");
  assert.equal(live.liveNoticePhrase("recording_started"), "Esta live começou a ser gravada.");
});

test("applyLiveSignal: o Abaixar a mão do console vira 'A equipe abaixou a sua mão.'; o aviso do motor sem som vira o nosso, com Configurações", () => {
  const texto = JSON.stringify({ type: embed.LOWER_HAND_SIGNAL });
  const pedido = { eventData: { name: "endpoint-text-message", text: texto }, senderInfo: { id: "host-1" } };
  const levantada = { ...live.INITIAL_LIVE_SIGNALS, handRaised: true };
  const abaixada = live.applyLiveSignal(levantada, { name: "endpointTextMessageReceived", ownId: "eu", payload: pedido });
  assert.equal(abaixada.handRaised, false);
  assert.equal(abaixada.notice, "hand_lowered");
  assert.deepEqual(live.liveNoticeSnack(abaixada.notice), { key: "hand_lowered", text: "A equipe abaixou a sua mão." });
  // Com a mao ja abaixada, nada muda (nem aviso).
  assert.equal(live.applyLiveSignal(live.INITIAL_LIVE_SIGNALS, { name: "endpointTextMessageReceived", ownId: "eu", payload: pedido }), live.INITIAL_LIVE_SIGNALS);
  // A gravacao no navegador de quem modera continua ligando o selo, sem aviso de mao.
  const moderada = { ...live.INITIAL_LIVE_SIGNALS, participants: { moderators: ["host-1"], names: {} } };
  const gravando = { ...pedido, eventData: { name: "endpoint-text-message", text: JSON.stringify({ on: true, type: embed.RECORDING_SIGNAL }) } };
  const comSelo = live.applyLiveSignal(moderada, { name: "endpointTextMessageReceived", ownId: "eu", payload: gravando });
  assert.equal(comSelo.recording, true);
  assert.equal(comSelo.notice, null);
  // O motor avisou o microfone sem som: so com o microfone ligado, e o aviso tem a acao Configurações.
  const ligado = { ...live.INITIAL_LIVE_SIGNALS, audioOn: true };
  const semSom = live.applyLiveSignal(ligado, { name: "notificationTriggered", ownId: "eu", payload: { title: "toolbar.noAudioSignalTitle" } });
  assert.equal(semSom.notice, "mic_no_signal");
  assert.deepEqual(live.liveNoticeSnack(semSom.notice), model.engineSnack("mic_no_signal"));
  assert.equal(live.liveNoticeSnack(semSom.notice).action.label, "Configurações");
  assert.equal(live.applyLiveSignal(live.INITIAL_LIVE_SIGNALS, { name: "notificationTriggered", ownId: "eu", payload: { title: "toolbar.noAudioSignalTitle" } }), live.INITIAL_LIVE_SIGNALS);
  assert.equal(live.applyLiveSignal(ligado, { name: "notificationTriggered", ownId: "eu", payload: { title: "notify.raisedHand" } }), ligado);
});
