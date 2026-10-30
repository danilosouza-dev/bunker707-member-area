import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import "./support/transpile-tsx.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// O painel Configurações da sala ao vivo (docs/30 §1.3, §5.4, §6.3, §8.4, §8.5, D4; docs/18 §2.2), sem navegador:
// as secoes por papel e momento (o aluno so escolhe o microfone depois do Falar e a camera depois do aviso de gravacao
// aceito; o alto-falante so com a troca de saida do navegador e duas saidas com nome; nada de Qualidade do vídeo para
// quem apresenta), a lista de aparelhos (sem id vazio, sem o "default" repetido do Chrome, com o nome reserva), os
// argumentos dos metodos de aparelho (so o id: o rotulo faria o iframe pegar o primeiro de rotulo igual), quando a
// troca acabou (o aparelho escolhido em uso, o erro ou o teto; so entao o ruido volta), os comandos de ruido
// ({ enabled }), fundo e qualidade, o volume, o que o painel do aluno reaplica (so num iframe novo; nunca o desfoque a
// cada camera que liga) e o espelho guardado na pagina, a troca de aparelho cujos sinais de mudo nao vao a barra nem ao
// servidor (ate voltar ao estado de antes, o erro dela ou o prazo vencer), o toque em Microfone / Câmera que espera a
// troca acabar, os erros do navegador na barra e no aceite da camera (o cameraError desfaz o aceite, o micError nao
// mexe nele), o pedido do navegador sem resposta (nunca "ligado" sem faixa), o `allow` com speaker-selection, a barra e
// a engrenagem do iframe so para quem apresenta, os sinais novos fora do servidor, o painel desenhado em cada momento,
// o foco que nunca cai no body (o proprio botao Configurações, a barra que some), o card do console antes do palco e as
// frases pelas listas proibidas.

const settings = await import("../src/lib/jitsi-device-settings.ts");
const embed = await import("../src/lib/jitsi-room-config.ts");
const model = await import("../src/components/member/webinars/room/live-room-model.ts");
const panel = await import("../src/components/member/webinars/room/live-settings.tsx");
const { LiveControls } = await import("../src/components/member/webinars/room/live-controls.tsx");
const { PROIBIDAS_WEBINARIO, WEBINAR_COPY } = await import("../src/lib/webinar-copy.ts");

const ler = (caminho) => readFileSync(new URL(`../${caminho}`, import.meta.url), "utf8");
const semComentarios = (fonte) => fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const config = WEBINAR_COPY.aoVivo.config;
const noop = () => undefined;
const textoDe = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
/** Os nomes reserva por tipo, como a sala passa (DEVICE_NAMES de live-room.tsx). */
const RESERVA = { audioInput: config.reserva.microfone, audioOutput: config.reserva.altoFalante, videoInput: config.reserva.camera };

/** Como o Chrome lista as saidas com a permissao: o "default" repete o aparelho interno. */
const SAIDAS = [
  { deviceId: "default", groupId: "g-interno", kind: "audiooutput", label: "Padrão - Alto-falantes internos" },
  { deviceId: "som-interno", groupId: "g-interno", kind: "audiooutput", label: "Alto-falantes internos" },
  { deviceId: "som-usb", groupId: "g-usb", kind: "audiooutput", label: "Fone USB" }
];
/** Sem a permissao: um aparelho vazio. */
const SEM_PERMISSAO = [{ deviceId: "", groupId: "", kind: "audiooutput", label: "" }];

const aluno = (extra = {}) =>
  settings.deviceSettingsFor({
    allowStudentCamera: true,
    cameraConsented: false,
    isIOS: false,
    isMobile: false,
    joined: true,
    micAllowed: false,
    outputChangeAvailable: true,
    outputs: SEM_PERMISSAO,
    role: "student",
    videoOn: false,
    ...extra
  });

/* ------------------------------------------------------------------------------------------------
 * As secoes por papel e momento
 * ---------------------------------------------------------------------------------------------- */

test("o aluno antes da liberacao: volume e qualidade prontos; microfone, camera e alto-falante so com a frase do que falta; nenhuma troca liberada", () => {
  const antes = aluno();
  assert.equal(antes.aguardandoSala, false);
  assert.equal(antes.volume, "pronta");
  assert.equal(antes.qualidade, "pronta");
  assert.equal(antes.microfone, "aguardando", "o microfone so depois de o apresentador liberar e do Falar");
  assert.equal(antes.camera, "aguardando", "a camera so depois do aviso de gravacao aceito");
  assert.equal(antes.altoFalante, "aguardando", "sem a permissao, as saidas vem sem nome: a frase explica");
  assert.equal(antes.ruido, false);
  assert.equal(antes.espelhar, false);
  assert.equal(antes.desfocar, false);
  assert.equal(antes.maisFundos, false, "o dialogo de fundo do iframe nunca e do aluno");
  assert.equal(antes.atalhos, true);
  for (const kind of settings.DEVICE_KINDS) {
    assert.equal(settings.deviceSectionReady(antes, kind), false, `${kind}: nada de set*Device antes do consentimento`);
  }
});

test("o aluno depois do Falar e do aviso da camera: microfone com Reduzir ruído, camera com Espelhar (Desfocar so com ela ligada e fora do celular), alto-falante com duas saidas", () => {
  const falando = aluno({ micAllowed: true, outputs: SAIDAS });
  assert.equal(falando.microfone, "pronta");
  assert.equal(falando.ruido, true);
  assert.equal(falando.altoFalante, "pronta", "duas saidas com nome (o default do Chrome nao conta duas vezes)");
  assert.equal(falando.camera, "aguardando", "o Falar nao libera a camera");
  assert.ok(settings.deviceSectionReady(falando, "audioInput"));
  assert.ok(settings.deviceSectionReady(falando, "audioOutput"));
  assert.ok(!settings.deviceSectionReady(falando, "videoInput"));

  const camera = aluno({ cameraConsented: true, outputs: SAIDAS });
  assert.equal(camera.camera, "pronta");
  // O aviso da camera aceito nao libera o alto-falante: o rotulo das saidas (e o setSinkId) dependem do MICROFONE.
  assert.equal(aluno({ cameraConsented: true, outputs: SEM_PERMISSAO }).altoFalante, "aguardando", "a frase continua ate o aluno falar");
  assert.equal(aluno({ micAllowed: true, outputs: SEM_PERMISSAO }).altoFalante, "oculta", "falando e ainda sem duas saidas com nome: nada a explicar");
  assert.equal(camera.espelhar, true);
  assert.equal(camera.desfocar, false, "o desfoque do iframe so vale com a camera ligada");
  assert.equal(camera.microfone, "aguardando", "o aviso da camera nao libera o microfone");
  assert.equal(aluno({ cameraConsented: true, videoOn: true }).desfocar, true);
  assert.equal(aluno({ cameraConsented: true, isMobile: true, videoOn: true }).desfocar, false, "o desfoque nao roda no celular");
  assert.equal(aluno({ isMobile: true }).atalhos, false, "no celular, sem os atalhos do teclado");

  // Uma saida so (com nome) ou o navegador que nao troca a saida (Safari): sem a secao.
  assert.equal(aluno({ micAllowed: true, outputs: SAIDAS.slice(0, 2) }).altoFalante, "oculta");
  assert.equal(aluno({ micAllowed: true, outputChangeAvailable: false, outputs: SAIDAS }).altoFalante, "oculta");
  assert.equal(aluno({ outputChangeAvailable: false }).altoFalante, "oculta", "no Safari nem a frase");
  // No iPhone o volume do audio e so leitura: a faixa some (o Som da barra continua).
  assert.equal(aluno({ isIOS: true, isMobile: true }).volume, "oculta");
});

test("a camera dos alunos desligada no webinario: a secao Câmera so com a frase (antes e depois de entrar); a Equipe segue o aluno", () => {
  const bloqueada = aluno({ allowStudentCamera: false, cameraConsented: true });
  assert.equal(bloqueada.camera, "oculta");
  assert.equal(bloqueada.cameraBloqueada, true);
  assert.equal(settings.deviceSectionReady(bloqueada, "videoInput"), false);
  assert.equal(aluno({ allowStudentCamera: false, joined: false }).cameraBloqueada, true);
  assert.equal(aluno({ allowStudentCamera: null, joined: false }).cameraBloqueada, false, "antes do token nao se sabe");
  assert.deepEqual(aluno({ role: "team" }), aluno(), "a Equipe usa a mesma barra do aluno");
  assert.deepEqual(aluno({ role: null }), aluno(), "antes do token, como o aluno");
});

test("fora da sala: so os atalhos e a frase de que as escolhas aparecem ao entrar", () => {
  const fora = aluno({ joined: false, micAllowed: true, outputs: SAIDAS });
  assert.equal(fora.aguardandoSala, true);
  for (const secao of ["altoFalante", "camera", "microfone", "qualidade", "volume"]) {
    assert.equal(fora[secao], "oculta", secao);
  }
  assert.equal(fora.atalhos, true);
  for (const kind of settings.DEVICE_KINDS) {
    assert.equal(settings.deviceSectionReady(fora, kind), false);
  }
});

test("apresentador e co-apresentador: microfone, camera, ruido, espelho, fundo e 'Mais opções de fundo' prontos; nunca a Qualidade do vídeo (mudaria o envio do palco)", () => {
  for (const role of ["host", "co_host"]) {
    const palco = aluno({ allowStudentCamera: false, outputs: SAIDAS, role, videoOn: true });
    assert.equal(palco.microfone, "pronta", role);
    assert.equal(palco.camera, "pronta", `${role}: a permissao da camera dos alunos nao vale para o palco`);
    assert.equal(palco.cameraBloqueada, false);
    assert.equal(palco.ruido, true);
    assert.equal(palco.espelhar, true);
    assert.equal(palco.desfocar, true);
    assert.equal(palco.maisFundos, true);
    assert.equal(palco.altoFalante, "pronta");
    assert.equal(palco.qualidade, "oculta", `${role}: setVideoQuality nao pode baixar o proprio palco`);
    assert.equal(aluno({ outputs: SEM_PERMISSAO, role }).altoFalante, "oculta", "sem as saidas com nome, nada a explicar a quem apresenta");
    assert.equal(aluno({ isMobile: true, role, videoOn: true }).maisFundos, false);
  }
});

/* ------------------------------------------------------------------------------------------------
 * A lista de aparelhos e os argumentos
 * ---------------------------------------------------------------------------------------------- */

test("deviceOptions: sem a permissao a lista fica vazia; o 'default' e o 'communications' do Chrome juntam com o aparelho que repetem; ids repetidos saem; sem rotulo, o nome reserva", () => {
  assert.deepEqual(settings.deviceOptions(SEM_PERMISSAO), [], "id vazio: o navegador ainda nao deu a permissao");
  assert.deepEqual(settings.deviceOptions(null), []);

  const microfones = [
    { deviceId: "default", groupId: "g1", kind: "audioinput", label: "Padrão - Microfone interno" },
    { deviceId: "communications", groupId: "g2", kind: "audioinput", label: "Comunicações - Fone USB" },
    { deviceId: "mic-interno", groupId: "g1", kind: "audioinput", label: "Microfone interno" },
    { deviceId: "mic-usb", groupId: "g2", kind: "audioinput", label: "Fone USB" },
    { deviceId: "mic-usb", groupId: "g2", kind: "audioinput", label: "Fone USB" }
  ];
  const opcoes = settings.deviceOptions(microfones, config.reserva.microfone);
  assert.deepEqual(
    opcoes.map((option) => [option.deviceId, option.name, option.isDefault]),
    [
      ["mic-interno", "Microfone interno", true],
      ["mic-usb", "Fone USB", false]
    ]
  );
  assert.deepEqual(settings.deviceOptions(opcoes), opcoes, "a propria saida passa de novo sem mudar");
  // O rotulo mais longo que fecha o do default: "USB" nao rouba "Fone USB".
  const curto = settings.deviceOptions([
    { deviceId: "default", groupId: "", label: "Padrão - Fone USB" },
    { deviceId: "a", groupId: "", label: "USB" },
    { deviceId: "b", groupId: "", label: "Fone USB" }
  ]);
  assert.deepEqual(curto.find((option) => option.isDefault)?.deviceId, "b");

  const semNome = settings.deviceOptions([{ deviceId: "x1", label: "" }, { deviceId: "x2", label: "" }], config.reserva.microfone);
  assert.deepEqual(semNome.map((option) => option.name), ["Microfone 1", "Microfone 2"]);
  assert.deepEqual(semNome.map((option) => option.label), ["", ""], "o rotulo que vai ao iframe continua vazio (ele usa o id)");
  assert.equal(config.reserva.altoFalante(1), "Alto-falante 1");
  assert.equal(config.reserva.camera(2), "Câmera 2");

  // O aparelho em uso: o "default" do getCurrentDevices aponta para o que ele repete.
  assert.equal(settings.selectedDeviceId(opcoes, { deviceId: "default", groupId: "g1", label: "Padrão - Microfone interno" }), "mic-interno");
  assert.equal(settings.selectedDeviceId(opcoes, { deviceId: "mic-usb", label: "Fone USB" }), "mic-usb");
  assert.equal(settings.selectedDeviceId(opcoes, undefined), null);
});

/**
 * O "setDevice" do iframe da tag stable-11248 (device-selection/functions.web.ts e base/devices/functions.web.ts):
 * `label ? getDeviceIdByLabel(state, label, kind) : id`, e o getDeviceIdByLabel devolve o PRIMEIRO aparelho de rotulo
 * identico. Devolve o id que o iframe passaria a usar (nulo quando responde falso).
 */
function setDeviceDaTag(lista, [rotulo, id]) {
  if (!rotulo) {
    return id || null;
  }
  return lista.find((aparelho) => aparelho.label === rotulo)?.deviceId ?? null;
}

test("os argumentos dos metodos de aparelho: so o id (o rotulo vazio); duas webcams iguais e o rotulo com espaco nas pontas trocam para a escolhida; os metodos sao da api (nao executeCommand)", () => {
  assert.deepEqual(settings.setDeviceArgs({ deviceId: "mic-usb", label: "Fone USB" }), ["", "mic-usb"], "nunca o rotulo");
  assert.deepEqual(settings.setDeviceArgs({ deviceId: "x1", label: "" }), ["", "x1"]);

  // Duas webcams iguais: o Chrome da o mesmo rotulo as duas. Com o rotulo, o iframe trocaria sempre para a primeira.
  const cameras = [
    { deviceId: "cam-a", groupId: "ga", kind: "videoinput", label: "HD Pro Webcam C920 (046d:082d)" },
    { deviceId: "cam-b", groupId: "gb", kind: "videoinput", label: "HD Pro Webcam C920 (046d:082d)" }
  ];
  const opcoesDeCamera = settings.deviceOptions(cameras, config.reserva.camera);
  const segunda = opcoesDeCamera.find((option) => option.deviceId === "cam-b");
  assert.equal(setDeviceDaTag(cameras, [segunda.label, segunda.deviceId]), "cam-a", "o jeito de antes: a segunda nunca era escolhida");
  assert.equal(setDeviceDaTag(cameras, settings.setDeviceArgs(segunda)), "cam-b");
  // Um rotulo com espaco no fim (comum em descritor USB): a lista apara, e o rotulo aparado nao acha nada no iframe.
  const microfones = [{ deviceId: "mic-pnp", groupId: "g", kind: "audioinput", label: "USB PnP Sound Device " }];
  const pnp = settings.deviceOptions(microfones)[0];
  assert.equal(pnp.label, "USB PnP Sound Device");
  assert.equal(setDeviceDaTag(microfones, [pnp.label, pnp.deviceId]), null, "o jeito de antes: o iframe respondia falso");
  assert.equal(setDeviceDaTag(microfones, settings.setDeviceArgs(pnp)), "mic-pnp");
  assert.deepEqual(settings.SET_DEVICE_METHOD, { audioInput: "setAudioInputDevice", audioOutput: "setAudioOutputDevice", videoInput: "setVideoInputDevice" });

  const lido = settings.devicesSnapshotOf(
    {
      available: { audioInput: [], audioOutput: SAIDAS, videoInput: [{ deviceId: "cam", groupId: "", label: "" }] },
      current: { audioOutput: SAIDAS[0] },
      multipleAudioInput: true,
      outputChangeAvailable: true
    },
    RESERVA
  );
  assert.equal(lido.outputChangeAvailable, true);
  assert.equal(lido.multipleAudioInput, true);
  assert.equal(lido.current.audioOutput, "som-interno");
  assert.equal(lido.current.audioInput, null);
  assert.deepEqual(lido.lists.videoInput.map((option) => option.name), ["Câmera 1"]);
  assert.equal(settings.devicesSnapshotOf({ available: null, current: null, multipleAudioInput: "sim", outputChangeAvailable: 1 }, RESERVA).outputChangeAvailable, false);
});

test("os comandos: Reduzir ruído em objeto (nunca toggleNoiseSuppression), Desfocar com 'blur' / 'none', Economizar dados 360 e Automática 2160 (o valor de entrada do iframe) so na volta, o volume de 0 a 1", () => {
  assert.deepEqual(settings.noiseSuppressionCommand(true), ["setNoiseSuppressionEnabled", { enabled: true }]);
  assert.deepEqual(settings.noiseSuppressionCommand(false), ["setNoiseSuppressionEnabled", { enabled: false }]);
  assert.deepEqual(settings.blurCommand(true), ["setBlurredBackground", "blur"]);
  assert.deepEqual(settings.blurCommand(false), ["setBlurredBackground", "none"]);
  assert.deepEqual(settings.backgroundOffCommand(), ["setVirtualBackground", false, ""], "o fundo desligado vale sem a camera ligada");
  assert.deepEqual(settings.receiveQualityCommand("economizar"), ["setVideoQuality", 360]);
  // A volta de Economizar devolve o estado de entrada do iframe da tag (preferredVideoQuality = ULTRA = 2160): so nele a
  // tela compartilhada no palco chega sem teto; com 1080 ela ficaria com o teto do tamanho do palco.
  assert.deepEqual(settings.receiveQualityCommand("automatica", "economizar"), ["setVideoQuality", 2160]);
  assert.equal(settings.RECEIVE_QUALITY_HEIGHT.automatica, 2160);
  assert.equal(settings.receiveQualityCommand("automatica"), null, "na entrada nada e mandado");
  assert.equal(settings.receiveQualityCommand("economizar", "economizar"), null);
  assert.equal(settings.participantVolume(80), 0.8);
  assert.equal(settings.participantVolume(150), 1);
  assert.equal(settings.participantVolume(-5), 0);
  assert.equal(settings.clampPercent(Number.NaN), 100);
  assert.equal(settings.soundLevel(false, 80), 0, "o Som da barra desligado zera");
  assert.equal(settings.soundLevel(true, 40), 0.4);

  const fontes = ["src/lib/jitsi-device-settings.ts", "src/components/webinars/use-jitsi-devices.ts", "src/components/member/webinars/room/live-settings.tsx"].map((caminho) => semComentarios(ler(caminho)));
  for (const fonte of fontes) {
    assert.doesNotMatch(fonte, /"toggleNoiseSuppression"/, "o comando que ninguem trata na tag fixada");
  }
});

test("o aparelho de quem assiste: iPhone, iPad (que se diz Mac com toque), Android e computador", () => {
  const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  assert.deepEqual(settings.deviceEnvironmentOf({ userAgent: iphone }), { isIOS: true, isMobile: true });
  assert.deepEqual(settings.deviceEnvironmentOf({ maxTouchPoints: 5, userAgent: mac }), { isIOS: true, isMobile: true });
  assert.deepEqual(settings.deviceEnvironmentOf({ maxTouchPoints: 0, userAgent: mac }), { isIOS: false, isMobile: false });
  assert.deepEqual(settings.deviceEnvironmentOf({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile" }), { isIOS: false, isMobile: true });
});

/* ------------------------------------------------------------------------------------------------
 * A barra: a troca que nao e a equipe, os erros do navegador e o aceite da camera
 * ---------------------------------------------------------------------------------------------- */

test("a troca de camera: os sinais de mudo da faixa nova (o par muted:true / muted:false) nao vao a barra nem ao servidor, e a troca acaba quando o mudo volta ao de antes", () => {
  const falando = { ...model.INITIAL_LIVE_SIGNALS, audioOn: true, micAllowed: true, videoOn: true };
  const T = 1_000_000;
  const sinal = (state, name, payload) => model.applyLiveSignal(state, { name, ownId: "eu", payload });

  // Sem a troca: a faixa nova parece a equipe fechando a camera.
  assert.equal(sinal(falando, "videoMuteStatusChanged", { muted: true }).notice, "camera_closed");
  assert.equal(model.deviceSwitchStep(null, "videoInput", "videoMuteStatusChanged", { muted: true }, T).swallow, false, "sem troca, o sinal segue");

  // A camera ligada e trocada: o par (a faixa velha sai, a nova entra) e engolido inteiro, nada sobra para o lote.
  const troca = model.startDeviceSwitch(falando, "videoInput", 1, T);
  assert.deepEqual(troca, { before: true, deadline: T + model.LIVE_ROOM_RULES.deviceSwitchMs, held: null, id: 1 });
  let passo = model.deviceSwitchStep(troca, "videoInput", "videoMuteStatusChanged", { muted: true }, T + 10);
  assert.equal(passo.swallow, true, "o muted:true da troca nao vira webinar_camera_toggled { on: false }");
  assert.deepEqual(passo.next.held, { muted: true });
  passo = model.deviceSwitchStep(passo.next, "videoInput", "videoMuteStatusChanged", { muted: false }, T + 30);
  assert.deepEqual(passo, { next: null, swallow: true }, "de volta ao estado de antes: a troca acaba e o { on: true, consented: false } nao sai");
  // O que a sala faria com cada sinal: o item do lote vem de toRoomEvent, que so roda para o que nao foi engolido.
  assert.ok(embed.toRoomEvent("videoMuteStatusChanged", { muted: false }, { nowIso: "2026-11-05T23:00:00.000Z", ownId: "eu" }), "sem a troca, seria uma linha");
  // Os outros sinais seguem.
  assert.equal(model.deviceSwitchStep(troca, "videoInput", "audioMuteStatusChanged", { muted: true }, T).swallow, false);
  assert.equal(model.deviceSwitchStep(troca, "videoInput", "raiseHandUpdated", { handRaised: 1 }, T).swallow, false);
  // A camera fechada e trocada (o iframe abre a faixa nova e a fecha de novo): o muted:true ja e o estado de antes.
  const fechada = model.startDeviceSwitch({ audioOn: false, videoOn: false }, "videoInput", 3, T);
  assert.deepEqual(model.deviceSwitchStep(fechada, "videoInput", "videoMuteStatusChanged", { muted: true }, T + 5), { next: null, swallow: true });

  assert.equal(model.startDeviceSwitch(falando, "audioOutput", 4, T), null, "o alto-falante nao mexe em faixa");
  assert.deepEqual(model.DEVICE_SWITCH_KINDS, ["videoInput"]);
  assert.equal(model.deviceSwitchSignalOf("videoInput"), "videoMuteStatusChanged");
});

test("a troca de microfone nao abre troca (na tag o mudo do microfone nao muda ao trocar): a equipe que silencia logo depois chega como a equipe, na hora", () => {
  const falando = { ...model.INITIAL_LIVE_SIGNALS, audioOn: true, micAllowed: true };
  const T = 1_500_000;
  const sinal = (state, name, payload) => model.applyLiveSignal(state, { name, ownId: "eu", payload });
  // A troca do microfone nao manda audioMuteStatusChanged (replaceStoredTracks despacha setAudioMuted com o mesmo valor):
  // nenhuma janela fica aberta para engolir o que vem depois.
  assert.equal(model.startDeviceSwitch(falando, "audioInput", 5, T), null);
  // 3 s depois da troca, a equipe usa "Silenciar quem está falando": o muted:true nao e engolido...
  const passo = model.deviceSwitchStep(null, "audioInput", "audioMuteStatusChanged", { muted: true }, T + 3_000);
  assert.equal(passo.swallow, false);
  // ...e vira o aviso da equipe, com o Microfone fora da barra (antes: engolido e aplicado 13 s depois como "nosso").
  const silenciado = sinal(falando, "audioMuteStatusChanged", { muted: true });
  assert.equal(silenciado.notice, "mic_silenced");
  assert.equal(silenciado.micAllowed, false);
  assert.ok(embed.toRoomEvent("audioMuteStatusChanged", { muted: true }, { nowIso: "2026-11-05T23:00:00.000Z", ownId: "eu" }), "e o 'microfone desligado' vai ao historico na hora");

  // A sala so abre a janela dos sinais para a camera; o microfone so segura o toque em Microfone ate a troca acabar.
  const sala = semComentarios(ler("src/components/member/webinars/room/use-live-room.ts"));
  assert.match(sala, /const deviceSwitchStarted = useCallback\(\s*\(kind: DeviceKind\): DeviceSwitchHooks \| undefined => \{\s*if \(kind !== "audioInput" && kind !== "videoInput"\) \{\s*return undefined;/);
  assert.match(sala, /if \(kind !== "videoInput"\) \{\s*return \{ done, minMs \};\s*\}\s*switchesRef\.current\[kind\] = startDeviceSwitch\(/);
});

test("o prazo da troca de camera conta da resposta do set*Device e de cada sinal dela: a webcam lenta nao vira 'a equipe fechou'; a troca ja encerrada nao apaga a marca de um pedido do aluno; a troca que acaba aplica o que ficou como nosso", () => {
  const sinal = (state, name, payload) => model.applyLiveSignal(state, { name, ownId: "eu", payload });
  const ligada = { ...model.INITIAL_LIVE_SIGNALS, videoOn: true };
  const PRAZO = model.LIVE_ROOM_RULES.deviceSwitchMs;
  const T = 2_000_000;
  assert.ok(PRAZO >= 8_000, "cobre uma webcam USB que demora a abrir");

  // O set*Device responde em 0,2 s; a faixa nova so chega 6 s depois da resposta: ainda e da troca.
  let troca = model.startDeviceSwitch(ligada, "videoInput", 7, T);
  troca = model.answerDeviceSwitch(troca, 7, T + 200);
  assert.equal(troca.deadline, T + 200 + PRAZO);
  assert.deepEqual(model.deviceSwitchCheck(troca, 7, T + 6_200), { action: "wait", ms: PRAZO - 6_000 });
  const lenta = model.deviceSwitchStep(troca, "videoInput", "videoMuteStatusChanged", { muted: true }, T + 6_200);
  assert.equal(lenta.swallow, true, "nada de 'A equipe fechou a sua câmera'");
  assert.equal(lenta.next.deadline, T + 6_200 + PRAZO, "cada sinal da troca conta o prazo de novo");
  // A resposta de uma troca mais velha nao mexe na troca nova.
  assert.equal(model.answerDeviceSwitch(troca, 6, T + 9_999), troca);

  // A faixa nova que nao voltou (a webcam nao abriu): no fim do prazo vale o ultimo sinal, como NOSSO.
  const vencida = model.deviceSwitchCheck(lenta.next, 7, lenta.next.deadline);
  assert.deepEqual(vencida, { action: "expire", held: { muted: true } });
  const aplicado = sinal(model.expectDeviceSwitch(ligada, "videoInput"), "videoMuteStatusChanged", vencida.held);
  assert.equal(aplicado.notice, null, "a faixa que nao voltou nao e a equipe");
  assert.equal(aplicado.videoOn, false);
  // Sem nenhum sinal no prazo: vence sem nada para aplicar.
  assert.deepEqual(model.deviceSwitchCheck(model.startDeviceSwitch(ligada, "videoInput", 8, T), 8, T + PRAZO), { action: "expire", held: null });

  // A troca ja encerrada (o mudo voltou, o erro, a troca que acabou): o relogio dela nao apaga a marca de um pedido do
  // aluno feito depois; o muted:true seguinte e do pedido, nunca da equipe.
  let estado = model.expectVideoToggle(ligada);
  assert.deepEqual(model.deviceSwitchCheck(null, 9, T + PRAZO + 1), { action: "gone" }, "a troca encerrada nao apaga a marca do pedido");
  assert.deepEqual(model.deviceSwitchCheck(model.startDeviceSwitch(ligada, "videoInput", 10, T), 9, T + PRAZO + 1), { action: "gone" }, "nem uma troca mais nova");
  estado = sinal(estado, "videoMuteStatusChanged", { muted: true });
  assert.equal(estado.notice, null, "nada de camera_closed");

  // A troca que acaba de verdade (o hook viu a camera escolhida em uso) fecha a janela e aplica como nosso o que ficou.
  const guardada = model.deviceSwitchStep(model.startDeviceSwitch(ligada, "videoInput", 11, T), "videoInput", "videoMuteStatusChanged", { muted: true }, T + 50).next;
  assert.deepEqual(model.deviceSwitchSettled(guardada, 11), { held: { muted: true }, next: null });
  assert.deepEqual(model.deviceSwitchSettled(guardada, 12), { held: null, next: guardada }, "outra troca: nada muda");
  assert.deepEqual(model.deviceSwitchSettled(null, 11), { held: null, next: null });
});

test("micError e cameraError: o aviso na barra (permissao negada ou o aparelho que nao abriu) e o fim do aceite pendente da camera", () => {
  const sinal = (state, name, payload) => model.applyLiveSignal(state, { name, ownId: "eu", payload });
  const pedindo = { ...model.INITIAL_LIVE_SIGNALS, expectAudio: true, expectVideo: true, micAllowed: true };
  const negado = sinal(pedindo, "micError", { message: "x", type: "gum.permission_denied" });
  assert.equal(negado.notice, "mic_denied");
  assert.equal(negado.expectAudio, false);
  assert.equal(model.liveNoticePhrase(negado.notice), "O navegador bloqueou o microfone. Libere o acesso nas permissões do site.");
  assert.equal(sinal(pedindo, "micError", { type: "gum.not_found" }).notice, "mic_failed");
  const camera = sinal(pedindo, "cameraError", { type: "gum.permission_denied" });
  assert.equal(camera.notice, "camera_denied");
  assert.equal(camera.expectVideo, false, "a frase de camera dos alunos desligada nao vem depois");
  assert.equal(model.cameraRequestUnanswered(camera), camera);
  assert.equal(sinal(pedindo, "cameraError", { type: "gum.general" }).notice, "camera_failed");
  for (const notice of ["mic_denied", "mic_failed", "camera_denied", "camera_failed"]) {
    assert.ok(model.liveNoticePhrase(notice), notice);
  }

  assert.deepEqual(model.consentForVideoSignal(true, "cameraError", { type: "gum.permission_denied" }), { consented: false, pending: false });
  assert.deepEqual(model.consentForVideoSignal(true, "micError", { type: "gum.permission_denied" }), { consented: false, pending: true }, "o erro do microfone nao mexe no aceite da camera");
  assert.deepEqual(model.consentForVideoSignal(true, "deviceListChanged"), { consented: false, pending: true }, "a lista nova nao mexe no aceite");
});

test("o cameraError que encerra o aceite pendente desfaz o aceite: o proximo clique em Câmera abre o aviso de novo e a camera que ligar depois vai com consented", () => {
  // O aluno aceitou o aviso (pendente) e o navegador recusou a camera: o aceite acabou sem a camera ligar.
  const pendente = true;
  const depoisDoErro = model.consentForVideoSignal(pendente, "cameraError", { type: "gum.permission_denied" });
  assert.equal(model.cameraConsentEndedByError(pendente, depoisDoErro), true, "a sala desfaz o cameraConsented");
  // Sem o aceite desta abertura, o clique seguinte pede o aviso (e so o Ligar câmera marca o proximo sinal).
  assert.equal(model.cameraClick({ allowStudentCamera: true, consented: false, videoOn: false }), "ask");
  const ligou = model.consentForVideoSignal(true, "videoMuteStatusChanged", { muted: false });
  assert.deepEqual(ligou, { consented: true, pending: false });
  assert.deepEqual(embed.toRoomEvent("videoMuteStatusChanged", { muted: false }, { extra: { consented: true }, nowIso: "2026-11-05T23:00:00.000Z", ownId: "eu" })?.data, { consented: true, muted: false });

  // A camera que ligou (aceite consumido) ou o erro do microfone: o aceite fica como esta.
  assert.equal(model.cameraConsentEndedByError(true, ligou), false);
  assert.equal(model.cameraConsentEndedByError(true, model.consentForVideoSignal(true, "micError", { type: "gum.permission_denied" })), false);
  assert.equal(model.cameraConsentEndedByError(false, model.consentForVideoSignal(false, "cameraError", {})), false, "sem aceite pendente (a troca de camera que falhou), nada a desfazer");

  // A sala liga o retorno: o erro que encerra o pendente chama onCameraConsentEnded, que desfaz o cameraConsented.
  const sala = semComentarios(ler("src/components/member/webinars/room/use-live-room.ts"));
  assert.match(sala, /const pending = consentNextVideoRef\.current;\s*const consent = consentForVideoSignal\(pending, name, payload\);\s*consentNextVideoRef\.current = consent\.pending;\s*if \(cameraConsentEndedByError\(pending, consent\)\) \{\s*consentEndedRef\.current\(\);/);
  const tela = semComentarios(ler("src/components/member/webinars/room/live-room.tsx"));
  assert.match(tela, /const onCameraConsentEnded = useCallback\(\(\) => setCameraConsented\(false\), \[\]\);/);
  assert.match(tela, /useLiveRoom\(\{[\s\S]*?onCameraConsentEnded,/);
});

test("o Ligar câmera recusado pelo navegador (a tag nao avisa cameraError no toggleVideo): no fim do prazo a permissao relida da camera_denied, nunca 'a camera dos alunos esta desligada', e o aceite pendente sai", () => {
  const pedindo = { ...model.INITIAL_LIVE_SIGNALS, expectVideo: true };
  // A camera bloqueada no navegador (permissao 'denied'): nenhum cameraError chega; o prazo vence e a permissao diz.
  const negada = model.cameraRequestUnanswered(pedindo, "denied");
  assert.equal(negada.notice, "camera_denied");
  assert.equal(negada.expectVideo, false);
  assert.equal(model.liveNoticePhrase(negada.notice), WEBINAR_COPY.aoVivo.cameraNegada);
  assert.equal(model.cameraConsentEndedByDenial(true, "denied"), true, "o aceite pendente sai: o proximo clique abre o aviso de novo");
  // A permissao dada (ou sem como saber): a moderacao de video recusou, como antes.
  for (const permissao of ["granted", null]) {
    assert.equal(model.cameraRequestUnanswered(pedindo, permissao).notice, "camera_blocked", String(permissao));
    assert.equal(model.cameraConsentEndedByDenial(true, permissao), false, String(permissao));
  }
  assert.equal(model.cameraRequestUnanswered(pedindo).notice, "camera_blocked");
  // O pedido do navegador fechado no X (a permissao continua 'prompt'): a camera nao foi liberada, nunca "a camera dos
  // alunos esta desligada"; o aceite fica (a camera que abrir depois vai com ele e tira o aviso).
  const semResposta = model.cameraRequestUnanswered(pedindo, "prompt");
  assert.equal(semResposta.notice, "camera_unanswered");
  assert.equal(model.liveNoticePhrase(semResposta.notice), WEBINAR_COPY.aoVivo.cameraSemResposta);
  assert.equal(model.cameraConsentEndedByDenial(true, "prompt"), false);
  assert.equal(model.applyLiveSignal(semResposta, { name: "videoMuteStatusChanged", ownId: "eu", payload: { muted: false } }).notice, null, "o aluno liberou depois: o aviso sai");
  // A moderacao de video segurando o aluno (isParticipantForceMuted): o iframe nem pede ao navegador, entao a permissao
  // 'prompt' nao e o motivo; a barra diz que a camera dos alunos esta desligada.
  assert.equal(model.cameraRequestUnanswered(pedindo, "prompt", true).notice, "camera_blocked");
  assert.equal(model.cameraRequestUnanswered(pedindo, "denied", true).notice, "camera_blocked");
  assert.equal(model.cameraRequestUnanswered(pedindo, "prompt", false).notice, "camera_unanswered");
  // A camera que ligou no prazo: nada a avisar, e o aceite ja foi com ela (sem aceite pendente, nada a desfazer).
  const ligada = { ...pedindo, videoOn: true };
  assert.equal(model.cameraRequestUnanswered(ligada, "denied"), ligada);
  assert.equal(model.cameraConsentEndedByDenial(false, "denied"), false);
  // Com a permissao ja negada no clique, a conferencia e na hora (o navegador recusa sem perguntar).
  assert.equal(model.cameraAnswerDelayMs("denied"), 0);

  // A sala rele a permissao no fim do prazo e desfaz o aceite pela mesma volta do cameraError (onCameraConsentEnded).
  const sala = semComentarios(ler("src/components/member/webinars/room/use-live-room.ts"));
  const toggleCamera = sala.slice(sala.indexOf("const sendCameraToggle = useCallback("), sala.indexOf("const audioMutedNow = useCallback("));
  assert.match(toggleCamera, /later\(\(\) => \{\s*void Promise\.all\(\[mediaPermissionState\("camera"\), videoForceMutedNow\(\)\]\)\.then\(\(\[answer, forceMuted\]\) => \{/);
  assert.match(toggleCamera, /if \(cameraConsentEndedByDenial\(consentNextVideoRef\.current, answer\)\) \{\s*consentNextVideoRef\.current = false;\s*consentEndedRef\.current\(\);\s*\}\s*setSignals\(\(previous\) => cameraRequestUnanswered\(previous, answer, forceMuted\)\);/);
  assert.match(sala, /return iframeAnswer\(\(\) => current\.isParticipantForceMuted\?\.\(own, "video"\)\);/);
});

/**
 * A sala por dentro, so o pedido do microfone (como turnMicOn e onEvent de use-live-room.ts ligam o modelo): o pedido,
 * a barra e o lote do servidor. `api` e o iframe montado agora (nulo depois da queda que desmontou a sala).
 */
function salaDoMicrofone() {
  const sala = { api: { iframe: 1 }, estado: { ...model.INITIAL_LIVE_SIGNALS, micPrompt: true, notice: "mic_released" }, lote: [], pedido: null, seq: 0 };
  const aplicar = (payload) => {
    sala.lote.push(embed.toRoomEvent("audioMuteStatusChanged", payload, { nowIso: "2026-11-05T23:00:00.000Z", ownId: "eu" }).data);
    sala.estado = model.applyLiveSignal(sala.estado, { name: "audioMuteStatusChanged", ownId: "eu", payload });
  };
  const sinal = (payload) => {
    const passo = model.micAskStep(sala.pedido, "audioMuteStatusChanged", payload);
    sala.pedido = passo.next;
    if (passo.release !== null) {
      aplicar(passo.release);
    }
    if (!passo.swallow) {
      aplicar(payload);
    }
  };
  return {
    sala,
    /** Falar (ou Microfone para ligar): o pedido abre ANTES do toggleAudio; o iframe manda o "ligado" na hora (ou nao, preso). */
    falar(nowMs, permission, { ligadoVem = true } = {}) {
      sala.estado = sala.estado.micPrompt ? model.acceptMic(sala.estado) : model.expectAudioToggle(sala.estado);
      sala.seq += 1;
      sala.pedido = model.startMicAsk(sala.pedido, { api: sala.api, id: sala.seq, nowMs, permission });
      if (ligadoVem) {
        sinal({ muted: false });
      }
      return sala.seq;
    },
    /** Um audioMuteStatusChanged do iframe, como o onEvent: o pedido segura o "ligado"; o mudo o encerra e passa depois. */
    sinal,
    /** Uma conferencia (o isAudioMuted do iframe do pedido e a permissao), como o check de turnMicOn. */
    conferir(id, nowMs, { muted, permission }) {
      const saida = model.micAskCheck(sala.pedido, id, { api: sala.api, muted, nowMs, permission });
      if (saida.action === "late") {
        sala.pedido = saida.next;
        sala.estado = model.micRequestUnanswered(sala.estado, saida.notice);
      } else if (saida.action === "denied") {
        sala.pedido = null;
        sala.estado = model.micRequestDenied(sala.estado);
      } else if (saida.action === "release") {
        sala.pedido = null;
        aplicar(saida.signal);
      }
      return saida;
    },
    /** A queda (handleDrop): o pedido acaba; sem `volta`, a sala desmonta o iframe (api nula); com ela, outro iframe. */
    queda({ volta = false } = {}) {
      sala.pedido = null;
      sala.api = volta ? { iframe: 2 } : null;
    }
  };
}

/** As conferencias de `de` ate `ate` (ms), no intervalo que o modelo pede, com o iframe sem faixa e a permissao dada. */
function conferirSemFaixa(m, id, de, ate, permission) {
  const acoes = [];
  for (let t = de; t <= ate; ) {
    const saida = m.conferir(id, t, { muted: true, permission });
    acoes.push(saida.action);
    if (saida.action !== "wait" && saida.action !== "late") {
      break;
    }
    t += saida.action === "wait" ? saida.ms : model.LIVE_ROOM_RULES.micLateCheckMs;
  }
  return acoes;
}

test("o Falar sempre segura o 'ligado' do iframe ate a faixa abrir, com ou sem a permissao do site: a recusa vira 'O navegador bloqueou o microfone…' e nenhuma linha 'ligado'", () => {
  // O prazo do pedido: com a permissao do site dada, 5 s (a faixa abre em centenas de ms); sem ela, 30 s.
  assert.equal(model.micAnswerDelayMs("granted"), model.LIVE_ROOM_RULES.cameraAnswerMs);
  for (const permissao of ["prompt", "denied", null]) {
    assert.equal(model.micAnswerDelayMs(permissao), model.LIVE_ROOM_RULES.cameraPromptMs, String(permissao));
  }
  assert.equal(model.micAskNeeded, undefined, "nenhum caminho sem o pedido: todo Falar segura o 'ligado'");
  const api = { iframe: 1 };
  const pedido = model.startMicAsk(null, { api, id: 1, nowMs: 1_000, permission: "granted" });
  assert.deepEqual(pedido, { api, deadline: 6_000, held: null, id: 1, noticed: false });
  // O "ligado" ainda guardado passa para o pedido seguinte no mesmo iframe; de outro iframe, nunca.
  const comLigado = { ...pedido, held: { muted: false } };
  assert.deepEqual(model.startMicAsk(comLigado, { api, id: 2, nowMs: 2_000, permission: "prompt" }).held, { muted: false });
  assert.equal(model.startMicAsk(comLigado, { api: { iframe: 2 }, id: 2, nowMs: 2_000, permission: "prompt" }).held, null);

  // O Falar: o toggleAudio grava audio.muted = false antes do getUserMedia, e o sinal chega na hora: guardado.
  const recusa = salaDoMicrofone();
  const id = recusa.falar(0, "prompt");
  assert.deepEqual(recusa.sala.pedido.held, { muted: false }, "nem a barra, nem o lote do servidor");
  assert.deepEqual(recusa.sala.lote, []);
  assert.equal(recusa.sala.estado.audioOn, false);
  assert.equal(model.micAskStep(recusa.sala.pedido, "raiseHandUpdated", { handRaised: 1, id: "eu" }).swallow, false, "os outros sinais seguem");
  assert.deepEqual(recusa.conferir(id, 500, { muted: true, permission: "prompt" }), { action: "wait", ms: model.LIVE_ROOM_RULES.micCheckMs });
  // O aluno clica em Bloquear: a permissao vira 'denied' e a faixa nunca abre.
  assert.deepEqual(recusa.conferir(id, 1_000, { muted: true, permission: "denied" }), { action: "denied" });
  assert.equal(recusa.sala.estado.notice, "mic_denied");
  assert.equal(model.liveNoticePhrase(recusa.sala.estado.notice), "O navegador bloqueou o microfone. Libere o acesso nas permissões do site.");
  assert.equal(recusa.sala.estado.audioOn, false, "a barra mostra o microfone desligado");
  assert.equal(recusa.sala.estado.expectAudio, false);
  assert.equal(recusa.sala.estado.micAllowed, true, "o botao Microfone fica para tentar de novo depois de liberar");
  assert.deepEqual(recusa.sala.lote, [], "nenhuma linha 'ligado'");
  assert.equal(recusa.sala.pedido, null, "a recusa encerra o pedido: a conferencia para");

  // A permissao dada: a faixa abre (isAudioMuted falso) e o 'ligado' guardado vai, uma vez, para a barra e o servidor.
  const falando = salaDoMicrofone();
  const outro = falando.falar(0, "granted");
  assert.deepEqual(falando.conferir(outro, 500, { muted: false, permission: "granted" }), { action: "release", signal: { muted: false } });
  assert.equal(falando.sala.estado.audioOn, true);
  assert.equal(falando.sala.estado.notice, null);
  assert.deepEqual(falando.sala.lote, [{ muted: false }]);
  assert.deepEqual(falando.conferir(outro, 1_000, { muted: false, permission: "granted" }), { action: "gone" }, "solto uma vez so");

  // Preso no 'ligado' sem faixa (um pedido anterior) e o toque de novo: o toggleAudio abre a faixa sem sinal novo; a
  // sala cria o ligado quando ela abrir.
  const preso = salaDoMicrofone();
  preso.falar(0, "prompt", { ligadoVem: false });
  const seguinte = preso.falar(40_000, "granted", { ligadoVem: false });
  assert.deepEqual(preso.conferir(seguinte, 40_500, { muted: false, permission: "granted" }), { action: "release", signal: { muted: false } });

  // A equipe silencia com o pedido aberto: o 'ligado' guardado sai antes e o mudo passa depois, como a equipe.
  const silencio = salaDoMicrofone();
  silencio.falar(0, "prompt");
  silencio.sinal({ muted: true });
  assert.equal(silencio.sala.pedido, null);
  assert.deepEqual(silencio.sala.lote, [{ muted: false }, { muted: true }]);
  assert.equal(silencio.sala.estado.notice, "mic_silenced");
  assert.equal(silencio.sala.estado.micAllowed, false);

  // A sala: o Falar e o Microfone desligado passam pelo turnMicOn; o pedido abre SEMPRE, antes do toggleAudio; o sinal
  // guardado sai do onEvent antes do lote e da barra.
  const sala = semComentarios(ler("src/components/member/webinars/room/use-live-room.ts"));
  assert.match(sala, /const accept = useCallback\(\(\) => \{\s*setSignals\(acceptMic\);\s*turnMicOn\(\);/);
  assert.match(sala, /const sendMicToggle = useCallback\(\(\) => \{\s*setSignals\(expectAudioToggle\);\s*if \(signalsRef\.current\.audioOn\) \{\s*commandRef\.current\("toggleAudio"\);\s*\} else \{\s*turnMicOn\(\);/);
  const turnMicOn = sala.slice(sala.indexOf("const turnMicOn = useCallback("), sala.indexOf("const accept = useCallback("));
  assert.doesNotMatch(turnMicOn, /micAskNeeded|asking/, "nenhum toggleAudio sem o pedido");
  assert.match(turnMicOn, /micAskRef\.current = startMicAsk\(previous, \{ api, id, nowMs: Date\.now\(\), permission \}\);\s*if \(!commandRef\.current\("toggleAudio"\)\) \{/);
  assert.match(turnMicOn, /const outcome = micAskCheck\(micAskRef\.current, id, \{ api: jitsi\.api\.current, muted, nowMs: Date\.now\(\), permission: answer \}\);/);
  assert.match(turnMicOn, /audioMutedNow\(api\)/, "o isAudioMuted do iframe do pedido");
  assert.match(turnMicOn, /micAskRef\.current = null;\s*if \(outcome\.action === "denied"\) \{\s*setSignals\(micRequestDenied\);\s*\} else \{\s*handleSignal\("audioMuteStatusChanged", outcome\.signal\);/);
  const onEvent = sala.slice(sala.indexOf("const onEvent = useCallback("), sala.indexOf("const configOverwrite = useMemo("));
  assert.match(onEvent, /const ask = micAskStep\(micAskRef\.current, name, payload\);\s*micAskRef\.current = ask\.next;\s*if \(ask\.release !== null\) \{\s*handleSignal\("audioMuteStatusChanged", ask\.release\);\s*\}\s*if \(ask\.swallow\) \{\s*return;\s*\}/);
  assert.match(onEvent, /if \(name === "videoConferenceJoined"\) \{[\s\S]*?micAskRef\.current = null;/, "um iframe novo nao herda o pedido");
  assert.doesNotMatch(sala, /micStuckRef/, "o 'preso' e o proprio pedido de pe");
});

test("o Falar com a permissao do site dada e o microfone que nao abre (o macOS bloqueou o navegador, outro programa o ocupa, o fone saiu): nada de 'ligado' na barra nem no servidor, e o aviso de que o microfone nao abriu", () => {
  // Na tag, o toggleAudio manda { muted:false } antes do getUserMedia; a falha vira so TRACK_CREATE_ERROR, sem sinal.
  const m = salaDoMicrofone();
  const id = m.falar(0, "granted");
  // Antes: com a permissao dada nao havia pedido, e o { muted:false } ia direto para a barra e para o lote.
  const antes = model.applyLiveSignal(model.acceptMic({ ...model.INITIAL_LIVE_SIGNALS, micPrompt: true }), { name: "audioMuteStatusChanged", ownId: "eu", payload: { muted: false } });
  assert.equal(antes.audioOn, true, "o defeito de antes: a barra mostrava o microfone ligado sem microfone nenhum");
  const acoes = conferirSemFaixa(m, id, 500, 5_000, "granted");
  assert.deepEqual(acoes.slice(0, -1), Array(acoes.length - 1).fill("wait"), "conferindo a cada 0,5 s ate o prazo de 5 s");
  assert.equal(acoes.at(-1), "late");
  assert.equal(m.sala.estado.notice, "mic_failed");
  assert.equal(model.liveNoticePhrase(m.sala.estado.notice), WEBINAR_COPY.aoVivo.microfoneFalhou);
  assert.equal(m.sala.estado.audioOn, false, "a barra mostra o Microfone desligado");
  assert.equal(m.sala.estado.expectAudio, false, "nenhum 'esperando o nosso' sobrando para ler o silenciar da equipe como nosso");
  assert.equal(m.sala.estado.micAllowed, true, "o botao Microfone fica para tentar de novo");
  assert.deepEqual(m.sala.lote, [], "nenhuma linha webinar_mic_toggled on:true");
  assert.equal(m.sala.pedido.held, null, "o 'ligado' guardado foi descartado");
  // Sem a permissao (o pedido do navegador aberto) o mesmo prazo e de 30 s, e o aviso e o do pedido sem resposta.
  const semResposta = salaDoMicrofone();
  const pedido = semResposta.falar(0, "prompt");
  assert.equal(conferirSemFaixa(semResposta, pedido, 500, 30_000, "prompt").at(-1), "late");
  assert.equal(semResposta.sala.estado.notice, "mic_unanswered");
  // Sem resposta do iframe no fim do prazo (sem como saber): nunca vira "ligado".
  const mudo = salaDoMicrofone();
  const semIframe = mudo.falar(0, "prompt");
  assert.equal(mudo.conferir(semIframe, 30_000, { muted: null, permission: "prompt" }).action, "late");
  assert.deepEqual(mudo.sala.lote, []);
  // O microfone que abre tarde (o outro programa soltou e o aluno tocou de novo, ou o sistema liberou): o aviso sai.
  const tarde = model.applyLiveSignal(m.sala.estado, { name: "audioMuteStatusChanged", ownId: "eu", payload: { muted: false } });
  assert.equal(tarde.notice, null);
});

test("o pedido do microfone acaba na queda e no iframe novo: o 'ligado' guardado nunca vai depois, a conferencia para e o mudo de um iframe antes da entrada dele nao conta", () => {
  // Falar sem a permissao (o pedido do navegador aberto) e o Wi-Fi cai aos 8 s; aos 22 s, "Não conseguimos voltar".
  const m = salaDoMicrofone();
  const id = m.falar(0, "prompt");
  m.queda();
  // Aos 30 s, sem iframe (isAudioMuted sem resposta): antes, o "ligado" guardado ia para a barra e a fila (que continua
  // ligada em 'lost'); agora o pedido nem existe.
  assert.deepEqual(m.conferir(id, 30_000, { muted: null, permission: "prompt" }), { action: "gone" });
  assert.deepEqual(m.sala.lote, []);
  assert.equal(m.sala.estado.audioOn, false);
  // Mesmo com o pedido de pe, outro iframe (a volta) ou a sala desmontada o encerram: a conferencia para.
  const api = { iframe: 1 };
  const pedido = { ...model.startMicAsk(null, { api, id: 3, nowMs: 0, permission: "prompt" }), held: { muted: false } };
  assert.deepEqual(model.micAskCheck(pedido, 3, { api: null, muted: null, nowMs: 30_000, permission: "prompt" }), { action: "gone" });
  assert.deepEqual(model.micAskCheck(pedido, 3, { api: { iframe: 2 }, muted: false, nowMs: 1_000, permission: "granted" }), { action: "gone" }, "a faixa do iframe novo nao solta o pedido do velho");
  // A volta: o iframe novo manda { muted:true } antes do videoConferenceJoined (o startWithAudioMuted na chegada); com
  // o pedido ja encerrado, nada de "ligado" e "desligado" falsos.
  const volta = salaDoMicrofone();
  volta.falar(0, "prompt");
  volta.queda({ volta: true });
  volta.sinal({ muted: true });
  assert.deepEqual(volta.sala.lote, [{ muted: true }], "o pedido encerrado nao solta 'ligado' nenhum (e a sala nem deixa este mudo chegar: abaixo)");

  // A sala: a queda encerra o pedido e para de contar os sinais de mudo; so o iframe que entrou repassa o mudo.
  const sala = semComentarios(ler("src/components/member/webinars/room/use-live-room.ts"));
  const queda = sala.slice(sala.indexOf("const handleDrop = useCallback("), sala.indexOf("const readRoomsInfo = useCallback("));
  assert.match(queda, /const handleDrop = useCallback\(\(\) => \{\s*micAskRef\.current = null;\s*joinedApiRef\.current = null;/);
  const onEvent = sala.slice(sala.indexOf("const onEvent = useCallback("), sala.indexOf("const configOverwrite = useMemo("));
  assert.match(onEvent, /const frame = meetApiRef\.current\?\.current \?\? null;\s*if \(\(name === "audioMuteStatusChanged" \|\| name === "videoMuteStatusChanged"\) && \(frame === null \|\| joinedApiRef\.current !== frame\)\) \{\s*return;\s*\}/);
  assert.ok(onEvent.indexOf("joinedApiRef.current !== frame") < onEvent.indexOf("micAskStep("), "antes do pedido do microfone e do lote");
  assert.match(onEvent, /if \(name === "videoConferenceJoined"\) \{[\s\S]*?joinedApiRef\.current = frame;/);
  assert.match(sala, /meetApiRef\.current = jitsi\.api;/);
  assert.match(sala, /const hangUp = useCallback\(\(\) => \{\s*leavingRef\.current = true;\s*micAskRef\.current = null;/);
});

test("o pedido do microfone nao vence por prazo: o aluno que libera depois de minutos (o pedido escondido no Firefox) liga a barra e a linha, nunca o microfone aberto com a barra desligada", () => {
  const m = salaDoMicrofone();
  const id = m.falar(0, "prompt");
  // Aos 30 s, o aviso; depois, a cada 2 s, sem fim (antes: aos 5 min 30 s a conferencia parava, e a faixa que abria aos 8
  // min ia ao ar sem a barra saber e sem linha nenhuma).
  const acoes = conferirSemFaixa(m, id, 500, 10 * 60_000, "prompt");
  assert.equal(acoes.filter((acao) => acao === "late").length, 1, "o aviso uma vez so");
  assert.ok(acoes.every((acao) => acao === "wait" || acao === "late"), "nunca 'gone' por prazo");
  assert.deepEqual(m.conferir(id, 6 * 60_000, { muted: true, permission: "prompt" }), { action: "wait", ms: model.LIVE_ROOM_RULES.micLateCheckMs });
  assert.equal(m.sala.estado.notice, "mic_unanswered");
  assert.equal(m.sala.estado.audioOn, false);
  // Aos 8 min o aluno escolhe Permitir: a faixa abre sem sinal novo (o iframe ja estava no "ligado"); a sala cria o ligado.
  assert.deepEqual(m.conferir(id, 8 * 60_000, { muted: false, permission: "granted" }), { action: "release", signal: { muted: false } });
  assert.equal(m.sala.estado.audioOn, true, "a barra liga junto com o microfone");
  assert.equal(m.sala.estado.notice, null, "o aviso de pedido sem resposta sai");
  assert.deepEqual(m.sala.lote, [{ muted: false }], "so agora a linha 'ligado'");
  // Ou bloqueia depois do prazo: a frase do bloqueio e a conferencia para.
  const bloqueia = salaDoMicrofone();
  const outro = bloqueia.falar(0, "prompt");
  conferirSemFaixa(bloqueia, outro, 500, 31_000, "prompt");
  assert.deepEqual(bloqueia.conferir(outro, 7 * 60_000, { muted: true, permission: "denied" }), { action: "denied" });
  assert.equal(bloqueia.sala.estado.notice, "mic_denied");
  assert.equal(model.LIVE_ROOM_RULES.micLateMs, undefined, "nenhum prazo final");
  assert.ok(model.LIVE_ROOM_RULES.micLateCheckMs > model.LIVE_ROOM_RULES.micCheckMs);

  // A sala: o "late" desliga a barra com o aviso, guarda o pedido avisado e continua conferindo devagar.
  const sala = semComentarios(ler("src/components/member/webinars/room/use-live-room.ts"));
  const turnMicOn = sala.slice(sala.indexOf("const turnMicOn = useCallback("), sala.indexOf("const accept = useCallback("));
  assert.match(turnMicOn, /if \(outcome\.action === "late"\) \{\s*micAskRef\.current = outcome\.next;\s*setSignals\(\(state\) => micRequestUnanswered\(state, outcome\.notice\)\);\s*later\(check, LIVE_ROOM_RULES\.micLateCheckMs\);\s*return;\s*\}/);
  assert.match(turnMicOn, /if \(outcome\.action === "wait"\) \{\s*later\(check, outcome\.ms\);\s*return;\s*\}/);
  assert.doesNotMatch(sala, /micLateMs|deadline =/);
});

/* ------------------------------------------------------------------------------------------------
 * O fim de verdade da troca e o toque no meio dela
 * ---------------------------------------------------------------------------------------------- */

/**
 * A troca do microfone na tag stable-11248 (conference.js, onAudioDeviceChanged): o set*Device responde logo depois do
 * dispatch; o ruido e desligado ja; a faixa nova entra depois do getUserMedia (`gumMs`), sem o efeito (o loadEffects
 * rodou com ele desligado), e so entao o getCurrentDevices diz o aparelho novo. O "ligado" que chega antes da faixa nova
 * vai para a faixa velha e o estado fica ligado: a faixa nova fica sem o efeito.
 */
function trocaDeMicrofoneNaTag({ gumMs, quandoLigar }) {
  // O ruido desligado no comeco da troca; o "ligado" grava o estado e vai para a faixa que estiver em uso naquela hora.
  return { efeitoNaFaixaNova: quandoLigar >= gumMs, ruido: true };
}

/** Quando o hook manda o ruido de volta: a cada DEVICE_SWITCH_POLL_MS confere o aparelho em uso ate deviceSwitchDone. */
function quandoOHookReaplica({ gumMs, erroMs = null }) {
  for (let t = settings.DEVICE_SWITCH_POLL_MS; ; t += settings.DEVICE_SWITCH_POLL_MS) {
    const current = t >= gumMs && erroMs === null ? "mic-bt" : "mic-interno";
    if (settings.deviceSwitchDone({ chosen: "mic-bt", current, elapsedMs: t, failed: erroMs !== null && t >= erroMs })) {
      return t;
    }
  }
}

test("trocar o microfone: o Reduzir ruído volta so quando a faixa nova entra (o aparelho escolhido em uso, o erro ou o teto), nunca num prazo fixo; a lista mostra o escolhido ate la", () => {
  // Um fone Bluetooth leva uns 2,5 s: com o prazo fixo de 1,5 s o ruido ia para a faixa velha e o fone ficava sem ele.
  assert.deepEqual(trocaDeMicrofoneNaTag({ gumMs: 2_500, quandoLigar: 1_500 }), { efeitoNaFaixaNova: false, ruido: true }, "o defeito de antes");
  const reaplica = quandoOHookReaplica({ gumMs: 2_500 });
  assert.ok(reaplica >= 2_500, `o ruido sai aos ${reaplica} ms, depois da faixa nova`);
  assert.deepEqual(trocaDeMicrofoneNaTag({ gumMs: 2_500, quandoLigar: reaplica }), { efeitoNaFaixaNova: true, ruido: true });
  // A troca que falhou (micError: a faixa velha fica, sem o ruido que a tag desligou) tambem acaba e o ruido volta nela.
  assert.equal(quandoOHookReaplica({ erroMs: 900, gumMs: Number.POSITIVE_INFINITY }), 1_000);
  // Nada responde: o teto.
  assert.equal(quandoOHookReaplica({ gumMs: Number.POSITIVE_INFINITY }), settings.DEVICE_SWITCH_MAX_MS);
  assert.equal(settings.deviceSwitchDone({ chosen: "x", current: "y", elapsedMs: 0, failed: true }), true, "o set*Device respondeu falso");
  assert.equal(settings.deviceSwitchErrorOf("micError"), "audioInput");
  assert.equal(settings.deviceSwitchErrorOf("cameraError"), "videoInput");
  assert.equal(settings.deviceSwitchErrorOf("deviceListChanged"), null);
  assert.equal(settings.DEVICE_SWITCH_SETTLE_MS, undefined, "nenhum prazo fixo");

  const hook = semComentarios(ler("src/components/webinars/use-jitsi-devices.ts"));
  const escolher = hook.slice(hook.indexOf("const escolher = useCallback("), hook.indexOf("const ruido = useCallback("));
  assert.match(escolher, /const done = deviceSwitchDone\(\{ chosen: option\.deviceId, current: read\.current\[kind\], elapsedMs: Date\.now\(\) - answeredAt, failed: answer === false \|\| now\.failed, minMs: hooks\.minMs \}\);\s*if \(!done\) \{\s*later\(check, DEVICE_SWITCH_POLL_MS\);\s*return;\s*\}/);
  // O ruido e o `done` da sala so depois do fim de verdade, com a leitura daquele momento.
  const espera = escolher.indexOf("later(check, DEVICE_SWITCH_POLL_MS)");
  const leitura = escolher.indexOf("aplicarLeitura(read)");
  const ruido = escolher.indexOf("panelEffectsAfterSwitch(");
  assert.ok(espera > 0 && espera < leitura && leitura < ruido && ruido < escolher.lastIndexOf("hooks.done?.()"));
  assert.equal((escolher.match(/panelEffectsAfterSwitch\(/g) ?? []).length, 1, "o ruido volta num lugar so");
  assert.match(escolher, /if \(!switchesRef\.current\[kind\] && currentRef\.current\[kind\] === option\.deviceId\) \{\s*return true;/, "o aparelho ja em uso nao troca (a tag desligaria o ruido)");
  assert.match(escolher, /\} catch \{\s*hooks\.done\?\.\(\);\s*return false;/, "o set*Device que falha libera o toque que esperava");
  // Uma releitura no meio (um sinal) nao volta a lista para o aparelho antigo; o erro daquele tipo acaba a troca.
  assert.match(hook, /const pending = switchesRef\.current\[kind\];\s*if \(pending\) \{\s*current\[kind\] = pending\.chosen;/);
  assert.match(hook, /const failedKind = deviceSwitchErrorOf\(name\);/);
});

/**
 * A troca de camera na tag stable-11248 (onVideoDeviceChanged + useVideoStream + replaceStoredTracks): o mudo de quando
 * a troca comecou vale para a faixa nova; o videoMuteStatusChanged sai de isLocalTrackMuted (sem faixa: mudo). Devolve
 * os sinais que a troca manda quando a faixa nova entra, com o mudo de agora (`mudoAgora`).
 */
function sinaisDaTrocaDeCameraNaTag({ mudoAgora, mudoNoComeco }) {
  const sinais = [];
  if (!mudoAgora) {
    sinais.push({ muted: true }); // a faixa velha sai
  }
  if (!mudoNoComeco) {
    sinais.push({ muted: false }); // a nova entra sem mudo
  }
  return sinais;
}

/** A sala por dentro, so o que importa aqui: a janela da troca, o portao do toque, a barra e o lote do servidor. */
function salaComTroca(inicial) {
  const sala = { estado: inicial, gate: model.OPEN_SWITCH_GATE, lote: [], toggles: 0, troca: null };
  const aplicar = (payload, switchKind) => {
    sala.lote.push(embed.toRoomEvent("videoMuteStatusChanged", payload, { nowIso: "2026-11-05T23:00:00.000Z", ownId: "eu" }).data);
    sala.estado = model.applyLiveSignal(switchKind ? model.expectDeviceSwitch(sala.estado, switchKind) : sala.estado, { name: "videoMuteStatusChanged", ownId: "eu", payload });
  };
  return {
    sala,
    comecarTroca(id) {
      sala.gate = model.gateSwitchStarted(sala.gate, id);
      sala.troca = model.startDeviceSwitch(sala.estado, "videoInput", id, 0);
    },
    tocarCamera() {
      const passo = model.gateToggle(sala.gate);
      sala.gate = passo.gate;
      if (passo.send) {
        sala.troca = null;
        sala.estado = model.expectVideoToggle(sala.estado);
        sala.toggles += 1;
      }
      return passo.send;
    },
    sinal(payload) {
      const passo = model.deviceSwitchStep(sala.troca, "videoInput", "videoMuteStatusChanged", payload, 100);
      sala.troca = passo.next;
      if (!passo.swallow) {
        aplicar(payload);
      }
    },
    trocaAcabou(id) {
      const fim = model.deviceSwitchSettled(sala.troca, id);
      sala.troca = fim.next;
      if (fim.held !== null) {
        aplicar(fim.held, "videoInput");
      }
      const passo = model.gateSwitchDone(sala.gate, id);
      sala.gate = passo.gate;
      if (passo.send) {
        sala.estado = model.expectVideoToggle(sala.estado);
        sala.toggles += 1;
      }
      return passo.send;
    }
  };
}

/**
 * O getCurrentDevices da tag stable-11248 para a camera (device-selection/functions.web.ts): `settings.cameraDeviceId ??
 * userSelectedCameraDeviceId`. O primeiro so nasce quando uma faixa de camera entra (TRACK_ADDED) e comeca vazio em
 * cada iframe novo; o segundo e gravado na hora do set*Device (setVideoInputDeviceAndUpdateSettings).
 */
function cameraEmUsoNaTag({ escolhida, faixaAntes, faixaDaTrocaEntrou, usada }) {
  const cameraDeviceId = faixaDaTrocaEntrou ? escolhida : faixaAntes ? usada : undefined;
  return cameraDeviceId ?? escolhida;
}

/** Quando o hook da a troca por acabada (a cada DEVICE_SWITCH_POLL_MS), com a faixa da troca entrando aos `gumMs`. */
function quandoATrocaDeCameraAcaba({ faixaAntes, gumMs, minMs }) {
  for (let t = settings.DEVICE_SWITCH_POLL_MS; ; t += settings.DEVICE_SWITCH_POLL_MS) {
    const current = cameraEmUsoNaTag({ escolhida: "cam-usb", faixaAntes, faixaDaTrocaEntrou: t >= gumMs, usada: "cam-integrada" });
    if (settings.deviceSwitchDone({ chosen: "cam-usb", current, elapsedMs: t, failed: false, minMs })) {
      return t;
    }
  }
}

test("a troca de camera num iframe que ainda nao teve faixa de camera (a volta depois de uma queda, com a camera desligada): o toque em Câmera so vai depois da faixa da troca, nunca no meio dela", () => {
  // A webcam USB leva 1,5 s. Sem o piso, a primeira conferencia (0,5 s) ja via o escolhido e o toque ia no meio da troca.
  assert.equal(quandoATrocaDeCameraAcaba({ faixaAntes: false, gumMs: 1_500, minMs: 0 }), 500, "o defeito de antes");
  const semFaixa = quandoATrocaDeCameraAcaba({ faixaAntes: false, gumMs: 1_500, minMs: settings.DEVICE_SWITCH_MAX_MS });
  assert.ok(semFaixa >= 1_500 && semFaixa === settings.DEVICE_SWITCH_MAX_MS, "sem faixa de camera neste iframe: so o teto");
  // Com a camera ja ligada antes neste iframe, o cameraDeviceId so muda quando a faixa da troca entra: sem piso.
  assert.equal(quandoATrocaDeCameraAcaba({ faixaAntes: true, gumMs: 1_500, minMs: 0 }), 1_500);
  // O erro da troca (cameraError) e o set*Device que responde falso continuam acabando na hora, mesmo com o piso.
  assert.equal(settings.deviceSwitchDone({ chosen: "cam-usb", current: "cam-usb", elapsedMs: 500, failed: true, minMs: settings.DEVICE_SWITCH_MAX_MS }), true);
  assert.equal(settings.deviceSwitchDone({ chosen: "cam-usb", current: "cam-usb", elapsedMs: 9_500, failed: false, minMs: settings.DEVICE_SWITCH_MAX_MS }), false);

  // A sala: a marca da faixa de camera nasce com o primeiro "ligada" do iframe (o videoConferenceJoined a zera) e a
  // troca da camera sem ela pede o teto como piso; a do microfone nao.
  const sala = semComentarios(ler("src/components/member/webinars/room/use-live-room.ts"));
  const onEvent = sala.slice(sala.indexOf("const onEvent = useCallback("), sala.indexOf("const configOverwrite = useMemo("));
  assert.match(onEvent, /if \(name === "videoConferenceJoined"\) \{[\s\S]*?cameraTrackRef\.current = false;/);
  assert.match(onEvent, /if \(name === "videoMuteStatusChanged" && field\(payload, "muted"\) === false\) \{\s*cameraTrackRef\.current = true;\s*\}/);
  assert.ok(onEvent.indexOf("cameraTrackRef.current = true") < onEvent.indexOf("deviceSwitchStep("), "o 'ligada' da propria troca tambem conta");
  assert.match(sala, /const minMs = kind === "videoInput" && !cameraTrackRef\.current \? DEVICE_SWITCH_MAX_MS : 0;/);
  assert.match(sala, /return \{\s*answered: \(\) => \{[\s\S]*?\},\s*done,\s*minMs\s*\};/);
});

test("Câmera tocada no meio da troca de camera: o toque espera a faixa nova e vai depois; a camera desligada nao vira 'A equipe fechou a sua câmera' e a ligada nao volta ao ar sozinha", () => {
  // Caso 1: camera desligada (o aceite ja foi), troca para a webcam B e o toque para ligar antes de B abrir.
  const c1 = salaComTroca({ ...model.INITIAL_LIVE_SIGNALS });
  c1.comecarTroca(1);
  assert.equal(c1.tocarCamera(), false, "nada de toggleVideo enquanto B abre (ele ligaria a camera antiga)");
  // O botao continua com o estado real (desligada) e ocupado; a linha de aviso diz o que acontece no fim da troca.
  assert.equal(c1.sala.estado.videoOn, false);
  assert.equal(model.pendingTogglePhrase({ audioInput: false, videoInput: c1.sala.gate.queued }, c1.sala.estado), WEBINAR_COPY.aoVivo.trocandoCameraLiga);
  // B abre mutada (a camera estava desligada no comeco): sem faixa ligada, nenhum sinal.
  for (const payload of sinaisDaTrocaDeCameraNaTag({ mudoAgora: true, mudoNoComeco: true })) {
    c1.sinal(payload);
  }
  assert.equal(c1.trocaAcabou(1), true, "a troca acabou: o toque vai agora, na faixa B");
  assert.equal(c1.sala.toggles, 1);
  c1.sinal({ muted: false }); // o toggleVideo liga B
  assert.equal(c1.sala.estado.videoOn, true);
  assert.equal(c1.sala.estado.notice, null, "nunca 'A equipe fechou a sua câmera'");
  assert.deepEqual(c1.sala.lote, [{ consented: false, muted: false }], "uma linha so, a do toque");

  // Caso 2: camera ligada, troca para B e o toque para desligar antes de B abrir.
  const c2 = salaComTroca({ ...model.INITIAL_LIVE_SIGNALS, videoOn: true });
  c2.comecarTroca(2);
  assert.equal(c2.tocarCamera(), false);
  // A camera continua no ar ate a troca acabar: o botao mostra "ligada" (nunca "desligada" com a imagem indo para a live
  // e a gravacao), ocupado, e a frase avisa que ela desliga quando a troca terminar.
  assert.equal(c2.sala.estado.videoOn, true);
  assert.equal(model.pendingTogglePhrase({ audioInput: false, videoInput: c2.sala.gate.queued }, c2.sala.estado), WEBINAR_COPY.aoVivo.trocandoCameraDesliga);
  // B entra sem mudo (a camera estava ligada no comeco): a velha sai e a nova entra, engolidos pela janela da troca.
  for (const payload of sinaisDaTrocaDeCameraNaTag({ mudoAgora: false, mudoNoComeco: false })) {
    c2.sinal(payload);
  }
  assert.deepEqual(c2.sala.lote, [], "a troca nao vira linha");
  assert.equal(c2.trocaAcabou(2), true);
  c2.sinal({ muted: true }); // o toggleVideo desliga B
  assert.equal(c2.sala.estado.videoOn, false, "desligada, como o aluno pediu");
  assert.equal(c2.sala.estado.notice, null);
  assert.deepEqual(c2.sala.lote, [{ consented: false, muted: true }]);

  // Como era: o toque ia na hora e a tag gravava de volta o mudo do comeco da troca.
  let antes = model.expectVideoToggle({ ...model.INITIAL_LIVE_SIGNALS });
  antes = model.applyLiveSignal(antes, { name: "videoMuteStatusChanged", ownId: "eu", payload: { muted: false } });
  for (const payload of sinaisDaTrocaDeCameraNaTag({ mudoAgora: false, mudoNoComeco: true })) {
    antes = model.applyLiveSignal(antes, { name: "videoMuteStatusChanged", ownId: "eu", payload });
  }
  assert.equal(antes.notice, "camera_closed", "o defeito de antes, no caso 1");

  // Dois toques no meio da troca se desfazem; uma troca mais antiga que acaba depois de outra comecar nao solta o toque;
  // o toque que esperava continua esperando a troca nova.
  let gate = model.gateSwitchStarted(model.OPEN_SWITCH_GATE, 5);
  gate = model.gateToggle(gate).gate;
  gate = model.gateToggle(gate).gate;
  assert.deepEqual(model.gateSwitchDone(gate, 5), { gate: model.OPEN_SWITCH_GATE, send: false });
  gate = model.gateToggle(model.gateSwitchStarted(model.OPEN_SWITCH_GATE, 6)).gate;
  gate = model.gateSwitchStarted(gate, 7);
  assert.deepEqual(model.gateSwitchDone(gate, 6), { gate, send: false });
  assert.deepEqual(model.gateSwitchDone(gate, 7), { gate: model.OPEN_SWITCH_GATE, send: true });
  assert.deepEqual(model.gateToggle(model.OPEN_SWITCH_GATE), { gate: model.OPEN_SWITCH_GATE, send: true }, "sem troca, o toque vai na hora");

  // O cameraError da troca fecha a janela: a equipe que fecha a camera logo depois chega como a equipe.
  const ligada = { ...model.INITIAL_LIVE_SIGNALS, videoOn: true };
  const aberta = model.startDeviceSwitch(ligada, "videoInput", 8, 0);
  assert.deepEqual(model.deviceSwitchStep(aberta, "videoInput", "cameraError", { type: "gum.not_readable" }, 100), { next: null, swallow: false });
  assert.equal(model.deviceSwitchStep(null, "videoInput", "videoMuteStatusChanged", { muted: true }, 3_000).swallow, false);
  assert.equal(model.applyLiveSignal(ligada, { name: "videoMuteStatusChanged", ownId: "eu", payload: { muted: true } }).notice, "camera_closed");

  // A sala: o toque passa pelo portao; a troca que acaba fecha a janela, aplica o guardado como nosso e solta o toque;
  // um iframe novo nao herda nada; a barra mostra o estado real, ocupada, e a frase do que vem.
  const sala = semComentarios(ler("src/components/member/webinars/room/use-live-room.ts"));
  assert.match(sala, /const toggleCamera = useCallback\(\s*\(consented: boolean\) => \{\s*if \(consented\) \{\s*consentNextVideoRef\.current = true;\s*\}\s*const gate = gateToggle\(gatesRef\.current\.videoInput\);\s*setGate\("videoInput", gate\.gate\);\s*if \(gate\.send\) \{\s*sendCameraToggle\(\);/);
  assert.match(sala, /const toggleMic = useCallback\(\(\) => \{\s*const gate = gateToggle\(gatesRef\.current\.audioInput\);\s*setGate\("audioInput", gate\.gate\);\s*if \(gate\.send\) \{\s*sendMicToggle\(\);/);
  assert.match(sala, /const settled = deviceSwitchSettled\(switchesRef\.current\[kind\], id\);\s*switchesRef\.current\[kind\] = settled\.next;\s*if \(settled\.held !== null\) \{\s*handleSignal\(deviceSwitchSignalOf\(kind\), settled\.held, kind\);\s*\}\s*const gate = gateSwitchDone\(gatesRef\.current\[kind\], id\);\s*setGate\(kind, gate\.gate\);\s*if \(gate\.send\) \{\s*sendToggleRef\.current\[kind\]\(\);/);
  assert.match(sala, /setGate\("audioInput", OPEN_SWITCH_GATE\);\s*setGate\("videoInput", OPEN_SWITCH_GATE\);/);
  const tela = semComentarios(ler("src/components/member/webinars/room/live-room.tsx"));
  assert.match(tela, /videoOn=\{room\.signals\.videoOn\}/);
  assert.match(tela, /audioOn=\{room\.signals\.audioOn\}/);
  assert.match(tela, /cameraWaiting=\{room\.pendingToggle\.videoInput\}/);
  assert.match(tela, /micWaiting=\{room\.pendingToggle\.audioInput\}/);
  assert.match(tela, /const notice = liveNoticePhrase\(room\.signals\.notice === "mic_released" \? null : room\.signals\.notice\) \?\? pendingTogglePhrase\(room\.pendingToggle, room\.signals\);/);
  assert.equal(model.pendingToggleShown, undefined, "nenhum estado pedido no botao");
  const barra = renderToStaticMarkup(
    createElement(LiveControls, {
      allowStudentCamera: true,
      audioOn: true,
      cameraWaiting: true,
      cinemaMode: false,
      cinemaOn: false,
      fullscreenOn: false,
      handRaised: false,
      joined: true,
      micAllowed: true,
      micWaiting: false,
      notice: null,
      onCamera: noop,
      onFullscreen: noop,
      onHand: noop,
      onMic: noop,
      onReact: noop,
      onSound: noop,
      onToggleReactions: noop,
      onToggleSettings: noop,
      reactionsDisabled: false,
      reactionsOpen: false,
      settingsOpen: false,
      showMedia: true,
      soundOn: true,
      videoOn: true
    })
  );
  // A Câmera ligada esperando a troca (o toque para desligar): ocupada, com o estado real (ligada, "Desligar câmera") e o
  // circulo girando no lugar do icone (parado com movimento reduzido); o Microfone, sem espera, com o icone dele.
  const camera = barra.match(/<button aria-busy="true"[^>]*aria-label="Câmera"[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(camera, /aria-pressed="true"/);
  assert.match(camera, /title="Desligar câmera"/);
  assert.match(camera, /<svg[^>]*class="[^"]*lucide-loader-circle[^"]*size-5 animate-spin motion-reduce:animate-none/);
  assert.doesNotMatch(camera, /lucide-video/);
  assert.doesNotMatch(barra, /<button aria-busy="true"[^>]*aria-label="Microfone"/);
  const microfone = barra.match(/<button[^>]*aria-label="Microfone"[\s\S]*?<\/button>/)?.[0] ?? "";
  assert.match(microfone, /lucide-mic/);
  assert.doesNotMatch(microfone, /animate-spin/);
});

test("o toque em Microfone no meio da troca de microfone tambem espera: a tag religaria o microfone que o aluno desligou quando a faixa nova entrasse", () => {
  // Microfone ligado, troca para o fone e o toque para desligar antes de o fone abrir.
  let gate = model.gateSwitchStarted(model.OPEN_SWITCH_GATE, 1);
  const toque = model.gateToggle(gate);
  assert.equal(toque.send, false, "nada de toggleAudio no meio da troca");
  gate = toque.gate;
  // O microfone segue no ar ate a troca acabar: o botao mostra "ligado", ocupado, e a frase avisa quando ele desliga.
  const ligado = { ...model.INITIAL_LIVE_SIGNALS, audioOn: true, micAllowed: true };
  assert.equal(model.pendingTogglePhrase({ audioInput: gate.queued, videoInput: false }, ligado), WEBINAR_COPY.aoVivo.trocandoMicrofoneDesliga);
  assert.equal(model.pendingTogglePhrase({ audioInput: gate.queued, videoInput: false }, { ...ligado, audioOn: false }), WEBINAR_COPY.aoVivo.trocandoMicrofoneLiga);
  assert.equal(model.pendingTogglePhrase({ audioInput: gate.queued, videoInput: false }, { ...ligado, micAllowed: false }), null, "sem o botao Microfone (a equipe silenciou), sem a frase");
  assert.equal(model.pendingTogglePhrase({ audioInput: false, videoInput: false }, ligado), null, "sem toque esperando");
  // A faixa nova entra sem mudo (o mudo do comeco): nenhum sinal; a troca acaba e o toque vai, na faixa nova.
  const fim = model.gateSwitchDone(gate, 1);
  assert.equal(fim.send, true);
  let estado = model.expectAudioToggle({ ...model.INITIAL_LIVE_SIGNALS, audioOn: true, micAllowed: true });
  estado = model.applyLiveSignal(estado, { name: "audioMuteStatusChanged", ownId: "eu", payload: { muted: true } });
  assert.equal(estado.audioOn, false);
  assert.equal(estado.notice, null, "o toque do aluno, nunca 'A equipe silenciou'");
  assert.equal(estado.micAllowed, true);
});

test("o painel e o foco: o proprio botao Configurações fecha mandando o foco ao botao; a barra que some (a live encerrada, removido ou banido) fecha o painel e as reacoes e o foco volta para a sala", () => {
  const tela = semComentarios(ler("src/components/member/webinars/room/live-room.tsx"));
  // Fechar pelo botao: closeSettings(true), que foca o botao antes de o painel sumir (o WebKit nao foca no clique).
  assert.match(tela, /function toggleSettings\(\) \{\s*if \(settingsOpen\) \{\s*closeSettings\(true\);\s*return;\s*\}/);
  // A barra some: o painel e as reacoes fecham (o celular devolve a gaveta; o Esc seguinte sai da sala).
  assert.match(tela, /const barShown = !minimized && !blocked && screen !== "ended";/);
  assert.match(tela, /if \(barWasShown !== barShown\) \{\s*setBarWasShown\(barShown\);\s*if \(!barShown\) \{\s*setSettingsOpen\(false\);\s*setReactionsOpen\(false\);\s*\}\s*\}/);
  assert.match(tela, /const settingsTakeover = settingsShown && !desktop;/);
  assert.match(tela, /\} else if \(reactionsShown \|\| settingsShown\) \{/);
  assert.match(tela, /\{!barShown \? null : \(\s*<LiveControls/);
  assert.match(tela, /if \(root && !minimized && barFocusLost\(\{ active: document\.activeElement, barShown, barWasShown: was, body: document\.body \}\)\) \{\s*const first = root\.querySelector<HTMLElement>\("\[data-room-first-focus\]"\);\s*\(first \?\? root\.querySelector<HTMLElement>\(ROOM_FOCUSABLE\)\)\?\.focus\(\);/);

  const body = { nome: "body" };
  assert.equal(model.barFocusLost({ active: body, barShown: false, barWasShown: true, body }), true, "o foco estava no painel quando a live acabou");
  assert.equal(model.barFocusLost({ active: null, barShown: false, barWasShown: true, body }), true);
  assert.equal(model.barFocusLost({ active: { nome: "chat" }, barShown: false, barWasShown: true, body }), false, "o foco estava em outro lugar");
  assert.equal(model.barFocusLost({ active: body, barShown: true, barWasShown: true, body }), false);
  assert.equal(model.barFocusLost({ active: body, barShown: false, barWasShown: false, body }), false);
});

test("o card Configurações do console abre acima do palco (logo depois do botao no teclado, antes da barra do iframe) e o proprio botao fecha mandando o foco a ele", async () => {
  const { LiveRoomPanel } = await import("../src/components/admin/v2/communication/webinars/session-console/live-room-panel.tsx");
  const secoes = settings.deviceSettingsFor({
    allowStudentCamera: true,
    cameraConsented: false,
    isIOS: false,
    isMobile: false,
    joined: true,
    micAllowed: false,
    outputChangeAvailable: true,
    outputs: SAIDAS,
    role: "host",
    videoOn: true
  });
  const handle = {
    chooseDevice: noop,
    deviceSettings: secoes,
    devices: aparelhos(),
    frameStatus: "joined",
    joined: true,
    lobby: false,
    meetConfigured: true,
    retry: noop,
    role: "host",
    room: { people: [], recording: { on: false } },
    setSettingsOpen: noop,
    settingsOpen: true,
    startTesting: noop,
    testing: false,
    tokenError: null,
    videoOn: true
  };
  const markup = renderToStaticMarkup(
    createElement(LiveRoomPanel, { busy: false, handle, live: { recorder: { status: "idle" }, roomLocked: false }, session: { status: "live" }, stageRef: { current: null } })
  );
  const card = markup.indexOf('id="console-live-settings"');
  const palco = markup.indexOf("data-live-stage=");
  const botao = markup.indexOf('aria-controls="console-live-settings"');
  assert.ok(botao >= 0 && card > botao, "o card depois do botao");
  assert.ok(palco > card, "e antes do palco (o Tab do botao entra no card, nao na barra do iframe)");
  const fechado = renderToStaticMarkup(
    createElement(LiveRoomPanel, { busy: false, handle: { ...handle, settingsOpen: false }, live: { recorder: { status: "idle" }, roomLocked: false }, session: { status: "live" }, stageRef: { current: null } })
  );
  assert.equal(fechado.indexOf('id="console-live-settings"'), -1);

  const fonte = semComentarios(ler("src/components/admin/v2/communication/webinars/session-console/live-room-panel.tsx"));
  assert.match(fonte, /onClick=\{\(\) => \{\s*if \(handle\.settingsOpen\) \{\s*settingsButton\.current\?\.focus\(\);\s*\}\s*handle\.setSettingsOpen\(!handle\.settingsOpen\);/);
});

/* ------------------------------------------------------------------------------------------------
 * O iframe: allow, a barra e a engrenagem por papel, os sinais novos
 * ---------------------------------------------------------------------------------------------- */

test("o iframe: allow com speaker-selection; o aluno e a Equipe continuam sem barra, sem atalhos e sem a captura inicial; quem apresenta ganha fundo, engrenagem so de aparelhos e a barra sempre visivel", () => {
  assert.equal(embed.JITSI_IFRAME_ALLOW, "camera; microphone; display-capture; autoplay; fullscreen; speaker-selection");
  const qualidade = { allowStudentCamera: true, screenFps: 30, stage: 1080 };
  for (const role of ["student", "team"]) {
    const config = embed.liveConfigOverwrite(role, qualidade);
    assert.deepEqual(config.toolbarButtons, [], role);
    assert.equal(config.disableShortcuts, true, role);
    assert.equal(config.disableInitialGUM, true, role);
    assert.equal(config.toolbarConfig, undefined, role);
    assert.equal(embed.liveInterfaceConfigOverwrite(role).SETTINGS_SECTIONS, undefined, `${role}: sem engrenagem`);
    // O "Flip" do menu da propria miniatura inverteria o espelho sem a pagina saber (a caixa Espelhar ficaria ao contrario).
    assert.equal(config.disableLocalVideoFlip, true, `${role}: o espelho so pelo nosso painel`);
  }
  assert.equal(embed.liveInterfaceConfigOverwrite().SETTINGS_SECTIONS, undefined, "sem o papel, como o aluno");
  assert.equal(embed.liveInterfaceConfigOverwrite(null).SETTINGS_SECTIONS, undefined);
  for (const role of ["host", "co_host"]) {
    const config = embed.liveConfigOverwrite(role, qualidade);
    assert.ok(config.toolbarButtons.includes("settings"), `${role}: a engrenagem`);
    assert.ok(config.toolbarButtons.includes("select-background"), `${role}: o fundo`);
    assert.equal(config.toolbarButtons.at(-1), "hangup");
    assert.deepEqual(config.toolbarConfig, { alwaysVisible: true }, `${role}: as setinhas nao somem`);
    assert.deepEqual(embed.liveInterfaceConfigOverwrite(role).SETTINGS_SECTIONS, ["devices"], `${role}: so a aba de aparelhos`);
    assert.equal(config.disableLocalVideoFlip, undefined, `${role}: o espelho tambem pela barra do iframe (o card e sem estado)`);
  }
});

test("deviceListChanged, micError e cameraError: a sala escuta, mas nada vai ao servidor", () => {
  for (const name of ["deviceListChanged", "micError", "cameraError"]) {
    assert.ok(embed.JITSI_LISTENED_EVENTS.includes(name), name);
    assert.equal(embed.toRoomEvent(name, { type: "gum.permission_denied" }, { nowIso: "2026-11-05T23:00:00.000Z", ownId: "eu" }), null, name);
  }
});

/* ------------------------------------------------------------------------------------------------
 * As fontes: o painel so troca depois do consentimento
 * ---------------------------------------------------------------------------------------------- */

test("as fontes: set*Device so no escolher do hook, depois de podeTrocar e de antesDeTrocar; a sala confere a secao e marca a troca; o volume vale para quem entra depois", () => {
  const hook = semComentarios(ler("src/components/webinars/use-jitsi-devices.ts"));
  const escolher = hook.slice(hook.indexOf("const escolher = useCallback("), hook.indexOf("const ruido = useCallback("));
  assert.match(escolher, /!latest\.current\.podeTrocar\(kind\)\)\s*\{\s*return false;/, "sem a secao pronta, nada");
  assert.ok(escolher.indexOf("antesDeTrocar") < escolher.indexOf("method.apply(current, setDeviceArgs(option))"), "a troca abre antes do set*Device");
  assert.match(escolher, /\.then\(\(answer\) => \{\s*hooks\.answered\?\.\(\);/, "a resposta do set*Device conta o prazo da troca de novo");
  assert.match(escolher, /if \(!latest\.current\.efeitosNoIframe\) \{\s*panelEffectsAfterSwitch\(effectsRef\.current, kind\)/, "o ruido do aluno volta depois de trocar o microfone; o de quem apresenta, nunca");
  assert.equal((hook.match(/SET_DEVICE_METHOD\[/g) ?? []).length, 1, "um lugar so troca aparelho");
  assert.doesNotMatch(semComentarios(ler("src/components/member/webinars/room/use-live-room.ts")), /set(AudioInput|AudioOutput|VideoInput)Device/);

  const room = semComentarios(ler("src/components/member/webinars/room/live-room.tsx"));
  assert.match(room, /function chooseDevice\(kind: DeviceKind, option: DeviceOption\) \{\s*if \(deviceSectionReady\(deviceSettings, kind\)\) \{\s*room\.devices\.escolher\(kind, option\);/);
  assert.match(room, /cameraConsented,\s*isIOS,\s*isMobile,\s*joined,\s*micAllowed: room\.signals\.micAllowed,/, "o microfone pelo Falar, a camera pelo aviso aceito");

  const sala = semComentarios(ler("src/components/member/webinars/room/use-live-room.ts"));
  // A troca abre com o estado de agora, e o relogio so aplica (como nosso) o sinal guardado da propria troca.
  assert.match(sala, /switchesRef\.current\[kind\] = startDeviceSwitch\(signalsRef\.current, kind, id, Date\.now\(\)\);/);
  assert.match(sala, /const outcome = deviceSwitchCheck\(switchesRef\.current\[kind\], id, Date\.now\(\)\);/);
  assert.match(sala, /handleSignal\(deviceSwitchSignalOf\(kind\), outcome\.held, kind\);/);
  assert.match(sala, /answered: \(\) => \{\s*switchesRef\.current\[kind\] = answerDeviceSwitch\(switchesRef\.current\[kind\], id, Date\.now\(\)\);/);
  assert.match(sala, /antesDeTrocar: deviceSwitchStarted/);
  assert.doesNotMatch(sala, /settleDeviceSwitch/, "nenhum relogio apaga a marca de um pedido do aluno");
  // O sinal engolido pela troca sai do onEvent ANTES do pushEvent (o lote do servidor) e do applyLiveSignal (a barra).
  const onEvent = sala.slice(sala.indexOf("const onEvent = useCallback("), sala.indexOf("const configOverwrite = useMemo("));
  assert.match(onEvent, /const step = deviceSwitchStep\(switchesRef\.current\[kind\], kind, name, payload, Date\.now\(\)\);\s*switchesRef\.current\[kind\] = step\.next;\s*if \(step\.swallow\) \{\s*return;\s*\}\s*\}/);
  assert.ok(onEvent.indexOf("deviceSwitchStep(") < onEvent.lastIndexOf("handleSignal(name, payload);"), "a troca separa o sinal antes do lote e da barra");
  assert.doesNotMatch(onEvent, /pushEvent|applyLiveSignal/, "o lote e a barra so pelo handleSignal");
  const handle = sala.slice(sala.indexOf("const handleSignal = useCallback("), sala.indexOf("const onEvent = useCallback("));
  assert.match(handle, /pushEvent\(toRoomEvent\(name, payload/);
  assert.match(handle, /applyLiveSignal\(switchKind \? expectDeviceSwitch\(previous, switchKind\) : previous,/);
  // O toque do aluno que vai ao iframe (sem troca no meio, ou quando ela acaba) e dele: a janela da troca nao o engole.
  assert.match(sala, /const sendCameraToggle = useCallback\(\(\) => \{\s*switchesRef\.current\.videoInput = null;/);
  assert.match(sala, /const level = soundLevelRef\.current\(\);\s*if \(typeof id === "string" && level < 1\) \{\s*commandRef\.current\("setParticipantVolume", id, level\);/, "quem entra depois chega com o volume");
  assert.match(sala, /const toggleSound = useCallback\(\(\) => \{[\s\S]*?aplicarNivel\(nivel\(\)\);/, "o Som da barra volta ao volume da faixa");
  assert.match(sala, /devicesSignalRef\.current\(name, payload\);/, "cada sinal passa pelo painel");
  const aoSinal = hook.slice(hook.indexOf("const aoSinal = useCallback("), hook.indexOf("const espelhar = useCallback("));
  assert.match(aoSinal, /name === "deviceListChanged" \|\| name === "audioMuteStatusChanged" \|\| name === "videoMuteStatusChanged"\) \{\s*reler\(\);/, "a lista nova quando um fone entra ou a permissao chega");
  assert.match(aoSinal, /if \(!latest\.current\.efeitosNoIframe\) \{\s*const step = panelEffectsOnSignal\(effectsRef\.current, name, payload\);/, "so o aluno reaplica (num iframe novo)");
  assert.doesNotMatch(aoSinal, /blurCommand/, "nada de desfoque a cada camera que liga");
  assert.match(semComentarios(ler("src/components/webinars/use-jitsi-meet.ts")), /iframe\.setAttribute\("allow", JITSI_IFRAME_ALLOW\)/);
});

/* ------------------------------------------------------------------------------------------------
 * O painel desenhado
 * ---------------------------------------------------------------------------------------------- */

const aparelhos = (extra = {}) => ({
  blur: false,
  current: { audioInput: "mic-interno", audioOutput: "som-interno", videoInput: null },
  espelhar: noop,
  fundo: noop,
  lists: {
    audioInput: settings.deviceOptions([
      { deviceId: "mic-interno", label: "Microfone interno" },
      { deviceId: "mic-usb", label: "Fone USB" }
    ]),
    audioOutput: settings.deviceOptions(SAIDAS),
    videoInput: settings.deviceOptions([{ deviceId: "cam", label: "" }], config.reserva.camera)
  },
  maisFundos: noop,
  mirror: true,
  noise: false,
  qualidade: noop,
  quality: "automatica",
  ruido: noop,
  volume: noop,
  volumePercent: 80,
  ...extra
});
const painel = (sections, extra = {}) => renderToStaticMarkup(createElement(panel.LiveSettings, { devices: aparelhos(), onChoose: noop, sections, showMedia: true, ...extra }));

test("o painel antes da liberacao: o volume em 80%, as frases do microfone, da camera e do alto-falante, a qualidade e os atalhos; nenhuma lista de aparelho", () => {
  const html = painel(aluno());
  assert.match(html, /data-testid="live-settings"/);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-label="Configurações"/);
  assert.match(html, /type="range"[^>]*value="80"|value="80"[^>]*type="range"/);
  assert.match(html, /aria-label="Volume"/);
  assert.match(html, /aria-valuetext="80%"/);
  assert.match(html, /class="h-11 /, "os campos tem 44 px");
  const texto = textoDe(html);
  for (const frase of [config.microfoneAguardando, config.cameraAguardando, config.altoFalanteAguardando, config.qualidadeAutomatica, config.qualidadeEconomizar, WEBINAR_COPY.aoVivo.atalhoReagir, WEBINAR_COPY.aoVivo.atalhoMao, WEBINAR_COPY.aoVivo.atalhoEnquete]) {
    assert.ok(texto.includes(frase), frase);
  }
  assert.doesNotMatch(html, /<select/, "nenhuma escolha de aparelho antes do consentimento");
  assert.doesNotMatch(texto, new RegExp(config.reduzirRuido));
  assert.match(html, /type="radio"[^>]*value="automatica"/);
  assert.match(html, /checked=""[^>]*value="automatica"|value="automatica"[^>]*checked=""/);
  assert.doesNotMatch(painel(aluno(), { showMedia: false }), new RegExp(WEBINAR_COPY.aoVivo.atalhoMao), "quem apresenta nao tem a mao nossa");
  assert.match(textoDe(painel(aluno({ joined: false }))), new RegExp(config.foraDaSala));
});

test("o painel depois do Falar e do aviso: as listas com o nome de cada secao, o aparelho em uso marcado, Reduzir ruído e Espelhar; a camera sem nome vira 'Câmera 1'", () => {
  const html = painel(aluno({ cameraConsented: true, micAllowed: true, outputs: SAIDAS }));
  assert.match(html, /<select aria-labelledby="live-settings-microfone"[^>]*data-live-device="audioInput"/);
  assert.match(html, /<select aria-labelledby="live-settings-alto-falante"[^>]*data-live-device="audioOutput"/);
  assert.match(html, /<select aria-labelledby="live-settings-camera"[^>]*data-live-device="videoInput"/);
  assert.match(html, /id="live-settings-microfone">Microfone</);
  assert.match(html, /<option selected="" value="mic-interno">Microfone interno<\/option>|<option value="mic-interno" selected="">/);
  assert.match(html, />Fone USB</);
  assert.match(html, />Câmera 1</);
  const texto = textoDe(html);
  assert.ok(texto.includes(config.reduzirRuido));
  assert.ok(texto.includes(config.espelhar));
  assert.ok(!texto.includes(config.desfocar), "camera desligada: sem desfocar");
  assert.ok(!texto.includes(config.maisFundos), "o dialogo de fundo do iframe e so de quem apresenta");
  assert.ok(textoDe(painel(aluno({ cameraConsented: true, videoOn: true }))).includes(config.desfocar));
  // Quem apresenta por esta pagina (sem a nossa barra de midia: showMedia falso) tem a barra do iframe, que tambem muda
  // ruido, fundo e espelho: acoes sem estado (nenhuma caixa que a barra do iframe deixaria errada) e Mais opções de fundo.
  const host = painel(aluno({ outputs: SAIDAS, role: "host", videoOn: true }), { cameraOn: true, showMedia: false });
  const textoHost = textoDe(host);
  for (const acao of [config.ruidoLigar, config.ruidoDesligar, config.inverterImagem, config.desfocar, config.fundoTirar, config.maisFundos]) {
    assert.match(host, new RegExp(`<button class="[^"]*h-11[^"]*" type="button">(?:<svg[\\s\\S]*?</svg>)?${acao}</button>`), acao);
  }
  assert.doesNotMatch(host, /type="checkbox"/, "quem apresenta: sem caixa com estado suposto");
  assert.ok(!textoHost.includes(config.qualidade), "quem apresenta nao tem Qualidade do vídeo");
  // A camera nunca ligada neste navegador (a lista vem sem id): a frase de liga-la na barra do video no lugar da lista.
  const hostSemCamera = painel(aluno({ role: "host" }), { cameraOn: false, devices: aparelhos({ lists: { ...aparelhos().lists, videoInput: [] } }), showMedia: false });
  assert.ok(textoDe(hostSemCamera).includes(config.cameraNaBarraDoVideo));
  assert.doesNotMatch(hostSemCamera, /data-live-device="videoInput"/);
  assert.ok(!textoDe(hostSemCamera).includes(config.semAparelho));
  assert.ok(!textoDe(painel(aluno({ cameraConsented: true }), { devices: aparelhos({ lists: { ...aparelhos().lists, videoInput: [] } }) })).includes(config.cameraNaBarraDoVideo), "o aluno nao (a camera dele liga pela nossa barra)");
  const sala = semComentarios(ler("src/components/member/webinars/room/use-live-room.ts"));
  assert.match(sala, /efeitosNoIframe: roomRole === "host" \|\| roomRole === "co_host",/);
  assert.match(painel(aluno({ micAllowed: true }), { devices: aparelhos({ lists: { audioInput: [], audioOutput: [], videoInput: [] } }) }), new RegExp(config.semAparelho));

  const bloqueada = textoDe(painel(aluno({ allowStudentCamera: false })));
  assert.ok(bloqueada.includes(WEBINAR_COPY.aoVivo.cameraBloqueada), "a frase que antes so aparecia no Como usar");
  assert.ok(!bloqueada.includes(config.cameraAguardando));
  assert.ok(!textoDe(painel(aluno({ isIOS: true, isMobile: true }))).includes(config.volume), "no iPhone, sem a faixa");
  assert.ok(!textoDe(painel(aluno({ isMobile: true }))).includes(WEBINAR_COPY.aoVivo.atalhos), "no celular, sem os atalhos");
});

test("depois do Falar ou do aviso da camera, com o navegador ainda sem a permissao (o pedido aberto, fechado no X ou bloqueado): a frase de liberar o acesso, nunca 'nenhum aparelho', sem Reduzir ruído nem Espelhar; o alto-falante espera", () => {
  // A lista crua com aparelhos e todos sem id: o navegador sem a permissao daquele tipo (nao "nenhum aparelho").
  const lido = settings.devicesSnapshotOf(
    {
      available: {
        audioInput: [{ deviceId: "", groupId: "", kind: "audioinput", label: "" }],
        audioOutput: SEM_PERMISSAO,
        videoInput: [{ deviceId: "cam", groupId: "", kind: "videoinput", label: "" }]
      },
      current: {},
      multipleAudioInput: true,
      outputChangeAvailable: true
    },
    RESERVA
  );
  assert.deepEqual(lido.semPermissao, { audioInput: true, audioOutput: true, videoInput: false });
  assert.deepEqual(lido.lists.audioInput, []);
  assert.deepEqual(settings.devicesSnapshotOf({ available: { audioInput: [], audioOutput: [], videoInput: [] }, current: null, multipleAudioInput: false, outputChangeAvailable: false }, RESERVA).semPermissao, { audioInput: false, audioOutput: false, videoInput: false }, "lista vazia de verdade: sem aparelho");
  assert.deepEqual(settings.EMPTY_DEVICES.semPermissao, { audioInput: false, audioOutput: false, videoInput: false });

  // As secoes: o consentimento dado e a permissao que falta.
  const falou = aluno({ micAllowed: true, outputs: SEM_PERMISSAO, semPermissao: { audioInput: true, audioOutput: true } });
  assert.equal(falou.microfone, "permissao");
  assert.equal(falou.ruido, false, "sem faixa, sem Reduzir ruído");
  assert.equal(falou.altoFalante, "aguardando", "as saidas sem nome enquanto o microfone esta sem a permissao");
  assert.equal(settings.deviceSectionReady(falou, "audioInput"), false, "nada a trocar");
  const aceitou = aluno({ cameraConsented: true, semPermissao: { videoInput: true }, videoOn: false });
  assert.equal(aceitou.camera, "permissao");
  assert.equal(aceitou.espelhar, false);
  assert.equal(aceitou.desfocar, false);
  assert.equal(settings.deviceSectionReady(aceitou, "videoInput"), false);
  assert.equal(aluno({ semPermissao: { audioInput: true, videoInput: true } }).microfone, "aguardando", "antes do Falar, a frase do Falar");
  assert.equal(aluno({ semPermissao: { audioInput: true, videoInput: true } }).camera, "aguardando");
  assert.equal(aluno({ micAllowed: true, outputs: SAIDAS, semPermissao: { audioInput: false } }).microfone, "pronta", "com a permissao, a lista");
  assert.equal(aluno({ allowStudentCamera: false, cameraConsented: true, semPermissao: { videoInput: true } }).camera, "oculta", "a camera dos alunos desligada continua so com a frase dela");
  // Quem apresenta tem as frases dele (a camera nunca ligada: liga-la na barra do video): nada muda.
  assert.equal(aluno({ role: "host", semPermissao: { audioInput: true, videoInput: true } }).microfone, "pronta");
  assert.equal(aluno({ role: "host", semPermissao: { audioInput: true, videoInput: true } }).camera, "pronta");

  // O painel: a frase no lugar da lista, sem "Nenhum aparelho encontrado", sem a caixa.
  const vazio = aparelhos({ lists: { audioInput: [], audioOutput: [], videoInput: [] } });
  const microfone = painel(falou, { devices: vazio });
  const textoMicrofone = textoDe(microfone);
  assert.ok(textoMicrofone.includes(config.microfoneSemPermissao));
  assert.ok(textoMicrofone.includes(config.altoFalanteAguardando), "o alto-falante nao some: a frase de espera");
  assert.ok(!textoMicrofone.includes(config.semAparelho), "nunca a causa errada");
  assert.ok(!textoMicrofone.includes(config.reduzirRuido));
  assert.doesNotMatch(microfone, /data-live-device="audioInput"/);
  const camera = painel(aceitou, { devices: vazio });
  assert.ok(textoDe(camera).includes(config.cameraSemPermissao));
  assert.ok(!textoDe(camera).includes(config.semAparelho));
  assert.ok(!textoDe(camera).includes(config.espelhar));
  // Sem nenhum aparelho de verdade (a lista vazia, com a permissao): a frase de sempre.
  assert.ok(textoDe(painel(aluno({ micAllowed: true }), { devices: vazio })).includes(config.semAparelho));

  // A sala passa a marca do hook as secoes.
  const tela = semComentarios(ler("src/components/member/webinars/room/live-room.tsx"));
  assert.match(tela, /deviceSettingsFor\(\{[\s\S]*?semPermissao: room\.devices\.semPermissao,[\s\S]*?\}\);/);
});

/* ------------------------------------------------------------------------------------------------
 * O que o painel reaplica e o espelho guardado
 * ---------------------------------------------------------------------------------------------- */

test("o que o painel do aluno reaplica: so num iframe novo (o ruido ligado ou desligado e o fundo desligado na entrada, a qualidade, o desfoque uma vez quando a camera ligar); dentro do mesmo iframe, nem o desfoque na camera que liga, nem nada na troca da camera; quem apresenta nunca", () => {
  const zero = settings.INITIAL_PANEL_EFFECTS;
  const sinal = settings.panelEffectsOnSignal;
  assert.deepEqual(zero, { blur: false, blurOnNextVideo: false, noise: false, quality: "automatica" });

  // O aluno desfocou com a camera ligada; a camera fecha e abre de novo: nenhum comando novo (o iframe cria a faixa
  // nova com o efeito).
  let passo = sinal({ ...zero, blur: true }, "videoMuteStatusChanged", { muted: true });
  assert.deepEqual(passo.commands, []);
  passo = sinal(passo.effects, "videoMuteStatusChanged", { muted: false });
  assert.deepEqual(passo.commands, [], "depois de setBlurredBackground e de um videoMuteStatusChanged { muted: false }, nada");

  // Um iframe novo (a volta depois de uma queda): o ruido e a qualidade na entrada; o desfoque quando a camera ligar, uma vez.
  passo = sinal({ ...zero, blur: true, noise: true, quality: "economizar" }, "videoConferenceJoined", { id: "eu" });
  assert.deepEqual(passo.commands, [
    ["setNoiseSuppressionEnabled", { enabled: true }],
    ["setVideoQuality", 360]
  ], "o fundo desfocado fica para a camera ligada: nada de desligar o fundo na entrada");
  assert.equal(passo.effects.blurOnNextVideo, true);
  assert.deepEqual(sinal(passo.effects, "videoMuteStatusChanged", { muted: true }).commands, [], "com a camera fechada, ainda nao");
  passo = sinal(passo.effects, "videoMuteStatusChanged", { muted: false });
  assert.deepEqual(passo.commands, [["setBlurredBackground", "blur"]]);
  assert.deepEqual(sinal(passo.effects, "videoMuteStatusChanged", { muted: false }).commands, [], "uma vez so");
  // A live seguinte no mesmo navegador: o iframe guardou o ruido e o fundo da anterior ('features/noise-suppression' e
  // 'features/virtual-background' persistem na tag), mas o painel abre desmarcado. O painel manda o que mostra: o ruido
  // desligado (sem faixa, o iframe so grava o estado) e o fundo desligado ja sem a camera (o setBlurredBackground seria
  // ignorado com ela fechada); o microfone depois do Falar e a camera depois do aviso saem sem os efeitos guardados.
  assert.deepEqual(sinal(zero, "videoConferenceJoined", {}).commands, [
    ["setNoiseSuppressionEnabled", { enabled: false }],
    ["setVirtualBackground", false, ""]
  ]);
  assert.deepEqual(sinal({ ...zero, noise: true }, "videoConferenceJoined", {}).commands, [
    ["setNoiseSuppressionEnabled", { enabled: true }],
    ["setVirtualBackground", false, ""]
  ]);
  // O aluno tirou o desfoque antes de a camera ligar no iframe novo: nada vai.
  const desmarcou = { ...sinal({ ...zero, blur: true }, "videoConferenceJoined", {}).effects, blur: false, blurOnNextVideo: false };
  assert.deepEqual(sinal(desmarcou, "videoMuteStatusChanged", { muted: false }).commands, []);

  // A troca: o ruido do aluno volta depois de trocar o microfone; a troca da camera nao reaplica nada.
  assert.deepEqual(settings.panelEffectsAfterSwitch({ ...zero, noise: true }, "audioInput"), [["setNoiseSuppressionEnabled", { enabled: true }]]);
  assert.deepEqual(settings.panelEffectsAfterSwitch({ ...zero, blur: true, noise: true }, "videoInput"), []);
  assert.deepEqual(settings.panelEffectsAfterSwitch(zero, "audioInput"), []);

  // Quem apresenta (efeitosNoIframe): o comando vai, mas nada e guardado nem reaplicado por cima da barra do iframe.
  const hook = semComentarios(ler("src/components/webinars/use-jitsi-devices.ts"));
  assert.match(hook, /if \(executeCommand\(\.\.\.noiseSuppressionCommand\(on\)\) && !latest\.current\.efeitosNoIframe\) \{/);
  assert.match(hook, /if \(executeCommand\(\.\.\.blurCommand\(on\)\) && !latest\.current\.efeitosNoIframe\) \{/);
  const consolePanel = semComentarios(ler("src/components/admin/v2/communication/webinars/session-console/live-room-panel.tsx"));
  assert.match(consolePanel, /useJitsiDevices\(\{[\s\S]*?efeitosNoIframe: true,/);
});

test("o espelho do aluno guardado na pagina: o painel abre com o valor guardado (desmarcado quando o aluno desligou numa live anterior) e sem a caixa antes de ler; quem apresenta nao tem caixa", () => {
  assert.equal(settings.MIRROR_STORAGE_KEY, "bunker707:webinar-espelho");
  assert.equal(settings.storedMirror(null), true, "nada guardado: o padrao do iframe, espelhado");
  assert.equal(settings.storedMirror("0"), false);
  assert.equal(settings.storedMirror("1"), true);

  const pronta = aluno({ cameraConsented: true });
  const espelho = (mirror) => painel(pronta, { devices: aparelhos({ mirror }) });
  assert.match(espelho(false), /<input(?![^>]*checked="")(?=[^>]*type="checkbox")[^>]*>\s*<span[^>]*>Espelhar a minha imagem/, "guardado desligado: a caixa abre desmarcada");
  assert.match(espelho(true), /<input(?=[^>]*checked="")(?=[^>]*type="checkbox")[^>]*>\s*<span[^>]*>Espelhar a minha imagem/);
  assert.ok(!textoDe(espelho(null)).includes(config.espelhar), "antes de ler o valor guardado, sem a caixa");

  // O hook le o guardado (localStorage em try/catch, pelo useSyncExternalStore: nulo no servidor) e grava ao inverter;
  // para quem apresenta, nulo (a barra do iframe tambem inverte).
  const hook = semComentarios(ler("src/components/webinars/use-jitsi-devices.ts"));
  assert.match(hook, /try \{\s*return storedMirror\(window\.localStorage\.getItem\(MIRROR_STORAGE_KEY\)\);\s*\} catch \{/);
  assert.match(hook, /useSyncExternalStore\(subscribeMirror, readMirror, serverMirror\)/);
  assert.match(hook, /if \(executeCommand\("toggleCameraMirror"\) && !latest\.current\.efeitosNoIframe\) \{\s*writeMirror\(!readMirror\(\)\);/);
  assert.match(hook, /mirror: input\.efeitosNoIframe \? null : storedMirrorOn,/);
});

test("um controle do painel que some com o foco (a equipe silencia, a camera fecha, a queda) leva o foco ao Fechar, nunca ao body", () => {
  const body = { nome: "body" };
  const removido = { isConnected: false };
  const naTela = { isConnected: true };
  // O foco estava no Reduzir ruído; a equipe silenciou e a secao Microfone virou a frase: o foco caiu no body.
  assert.equal(panel.panelFocusLost({ active: body, body, last: removido }), true);
  assert.equal(panel.panelFocusLost({ active: null, body, last: removido }), true);
  // O controle continua na tela, o foco esta em outro lugar de proposito, ou nunca entrou no painel: nada.
  assert.equal(panel.panelFocusLost({ active: body, body, last: naTela }), false);
  assert.equal(panel.panelFocusLost({ active: { nome: "chat" }, body, last: removido }), false);
  assert.equal(panel.panelFocusLost({ active: body, body, last: null }), false);
  // O painel guarda o ultimo controle com o foco e, depois de cada pintura, manda o foco ao Fechar.
  const fonte = semComentarios(ler("src/components/member/webinars/room/live-settings.tsx"));
  assert.match(fonte, /useLayoutEffect\(\(\) => \{\s*if \(panelFocusLost\(\{ active: document\.activeElement, body: document\.body, last: lastFocusRef\.current \}\)\) \{\s*lastFocusRef\.current = null;\s*closeRef\.current\?\.focus\(\);/);
  assert.match(fonte, /onFocus=\{\(event\) => \{\s*lastFocusRef\.current = event\.target instanceof HTMLElement \? event\.target : null;/);
  assert.match(fonte, /onClick=\{onClose\}\s*ref=\{closeRef\}/);
});

test("o painel tem Fechar quando a sala passa onClose (o foco volta ao botao Configurações)", () => {
  const sem = painel(aluno());
  assert.ok(!textoDe(sem).includes(config.fechar), "sem onClose, sem o botao");
  const com = painel(aluno(), { onClose: noop });
  assert.match(com, /<button class="[^"]*h-11[^"]*" type="button">[\s\S]*?Fechar<\/button>/, "44 px");
  const tela = semComentarios(ler("src/components/member/webinars/room/live-room.tsx"));
  assert.match(tela, /onClose=\{\(\) => closeSettings\(true\)\}/);
  assert.match(tela, /function closeSettings\(focusButton = false\) \{\s*if \(focusButton\) \{\s*panelButton\(LIVE_SETTINGS_ID\)\?\.focus\(\);/);
});

/* ------------------------------------------------------------------------------------------------
 * As frases
 * ---------------------------------------------------------------------------------------------- */

test("as frases do painel e dos avisos novos passam pela PROIBIDAS_WEBINARIO e nao citam o motor de video", () => {
  const textos = [
    WEBINAR_COPY.aoVivo.configuracoes,
    WEBINAR_COPY.aoVivo.microfoneNegado,
    WEBINAR_COPY.aoVivo.microfoneFalhou,
    WEBINAR_COPY.aoVivo.cameraNegada,
    WEBINAR_COPY.aoVivo.cameraFalhou,
    WEBINAR_COPY.aoVivo.cameraSemResposta,
    WEBINAR_COPY.aoVivo.microfoneSemResposta,
    WEBINAR_COPY.aoVivo.trocandoCameraDesliga,
    WEBINAR_COPY.aoVivo.trocandoCameraLiga,
    WEBINAR_COPY.aoVivo.trocandoMicrofoneDesliga,
    WEBINAR_COPY.aoVivo.trocandoMicrofoneLiga,
    ...Object.values(config).flatMap((valor) => (typeof valor === "string" ? [valor] : typeof valor === "function" ? [valor(3)] : Object.values(valor).map((fn) => fn(1))))
  ];
  assert.ok(textos.length >= 20);
  for (const texto of textos) {
    const lower = texto.toLocaleLowerCase("pt-BR");
    for (const palavra of PROIBIDAS_WEBINARIO) {
      assert.ok(!lower.includes(palavra), `"${texto}" usa "${palavra}"`);
    }
    assert.doesNotMatch(texto, /jitsi/i);
  }
  assert.equal(model.LIVE_ROOM_COPY.configuracoes, "Configurações");
});
