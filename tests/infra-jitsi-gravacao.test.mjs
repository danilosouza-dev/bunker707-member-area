import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// O modo da gravacao (docs/30 A63 e D125): o arquivo infra/jitsi/web/bunker707-gravacao.js, avaliado como o navegador
// faria, contra um motor de mentira com o mesmo formato do estado, das acoes e da biblioteca que ele usa na tag fixada.
// Aqui se prova o que o arquivo pede ao motor: no console, o modo na presenca de quem modera e o aviso do modo que o
// gravador aplicou; no gravador, de quem ele aceita o modo, a camada so com a tela, a tela fixada no palco, o volume de
// quem nao modera e o modo que nao volta atras no meio da gravacao. O que o motor desenha com isso, so o ensaio local
// prova (docs/30 A63). A montagem, o smoke e o ?v= ficam na guarda ao lado (infra-jitsi-gravacao.guard.test.mjs).

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "infra", "jitsi", "web", "bunker707-gravacao.js"), "utf8");
const MESSAGE = "bunker707:gravacao";
const APPLIED = "bunker707:gravacao-aplicada";
const plain = (value) => JSON.parse(JSON.stringify(value));

/** Uma faixa de video como a biblioteca do motor entrega (so o que o arquivo le). */
function screenTrack(sourceName, { muted = false, stream = { id: `stream-${sourceName}` } } = {}) {
  return { getOriginalStream: () => stream, getSourceName: () => sourceName, getType: () => "video", getVideoType: () => "desktop", isMuted: () => muted, stream };
}
const cameraTrack = (sourceName) => ({ getOriginalStream: () => ({ id: "cam" }), getSourceName: () => sourceName, getType: () => "video", getVideoType: () => "camera", isMuted: () => false });

/** Um participante da conferencia: id, papel, escondido (o gravador), propriedades e faixas. */
function member(id, { hidden = false, moderator = false, properties = {}, tracks = [] } = {}) {
  return { getId: () => id, getProperty: (name) => properties[name], getTracks: () => tracks, isHidden: () => hidden, isModerator: () => moderator, properties, tracks };
}

/**
 * O motor de mentira: o store com as fatias que o arquivo le, a conferencia com as escutas, as propriedades do proprio
 * participante e a lista de quem esta na sala, e a janela com o pai, a mensagem dele, o DOM minimo e o relogio.
 */
function engine({ framed = true, moderator = true, recorder = false, storeReady = true } = {}) {
  const actions = [];
  const posted = [];
  const timers = [];
  const subscribers = [];
  const appended = [];
  let now = 1_000_000;
  const makeConference = ({ joined = true, members = [] } = {}) => {
    const handlers = {};
    const own = {};
    return {
      getParticipants: () => members,
      handlers,
      isJoined: () => joined,
      isModerator: () => moderator,
      members,
      on(name, handler) { (handlers[name] ??= []).push(handler); },
      own,
      setLocalParticipantProperty(name, value) { own[name] = value; }
    };
  };
  const state = {
    // O console comeca com a sala; o gravador, sem (ele entra pelo teste, como entra pelo Jibri).
    "features/base/conference": { conference: recorder ? null : makeConference() },
    "features/base/config": { iAmRecorder: recorder },
    "features/large-video": { participantId: null },
    "features/video-layout": { remoteScreenShares: [] }
  };
  const notify = () => { for (const subscriber of [...subscribers]) subscriber(); };
  const store = {
    dispatch(action) {
      actions.push(plain(action));
      if (action.type === "PIN_PARTICIPANT") state["features/large-video"] = { participantId: action.participant.id };
      notify();
    },
    getState: () => state,
    subscribe(listener) { subscribers.push(listener); }
  };
  const element = (tag) => ({ attributes: {}, children: [], appendChild(child) { this.children.push(child); }, play() { this.playing = true; return { catch() {} }; }, setAttribute(name, value) { this.attributes[name] = value; }, tag });
  const body = element("body");
  const parent = { postMessage(data, origin) { posted.push({ data: plain(data), origin }); } };
  let onMessage = null;
  const window = {
    APP: storeReady ? { store } : undefined,
    addEventListener(name, handler) { if (name === "message") onMessage = handler; },
    document: { body: { appendChild(child) { appended.push(child); body.appendChild(child); } }, createElement: element, documentElement: body },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; }
  };
  window.parent = framed ? parent : window;
  vm.runInNewContext(source, { Date: { now: () => now }, window });
  return {
    actions,
    advance(ms) { now += ms; },
    appended,
    conference: () => state["features/base/conference"].conference,
    /** Um sinal da conferencia de agora (as escutas sao de cada conferencia). */
    fire(name, ...args) { for (const handler of state["features/base/conference"].conference.handlers[name] ?? []) handler(...args); },
    layer: () => appended[0] ?? null,
    makeConference,
    notify,
    /** A mensagem da pagina que montou o iframe (ou de outra janela, com `from`). */
    post(data, from = parent) { onMessage({ data, source: from }); },
    posted,
    ready() { window.APP = { store }; },
    runTimers() { for (const timer of timers.splice(0)) timer.callback(); },
    setConference(conference) { state["features/base/conference"] = { conference }; notify(); },
    state,
    types: () => actions.map((action) => action.type),
    video: () => appended[0]?.children[0] ?? null
  };
}

test("no console, o modo pedido pela pagina vai na presenca de quem modera; outra janela, outro tipo e outro modo ficam de fora", () => {
  const room = engine();
  room.post({ modo: "tela", type: MESSAGE }, {});
  room.post({ modo: "tela", type: "bunker707:plateia" });
  room.post({ modo: "camera", type: MESSAGE });
  assert.deepEqual(room.conference().own, {}, "nada pedido ainda");

  room.post({ modo: "tela", type: MESSAGE });
  assert.deepEqual(room.conference().own, { bunkerGravacao: "tela" });
  room.post({ modo: "sala", type: MESSAGE });
  assert.deepEqual(room.conference().own, { bunkerGravacao: "sala" }, "o Gravar de sempre troca o pedido antes de gravar");

  // Sala nova na mesma pagina (a conferencia de novo): o pedido vai de novo na presenca nova.
  const again = room.makeConference();
  room.setConference(again);
  assert.deepEqual(again.own, { bunkerGravacao: "sala" });
});

test("no console, o pedido que chega antes da sala entrar vai quando a conferencia aparece", () => {
  const room = engine({ storeReady: false });
  room.post({ modo: "tela", type: MESSAGE });
  room.ready();
  room.runTimers();
  assert.deepEqual(room.conference().own, { bunkerGravacao: "tela" });
});

test("o console avisa a pagina o modo que o gravador aplicou, uma vez por mudanca; o iframe do aluno nao avisa nada", () => {
  const recorderMember = member("rec00001", { hidden: true, properties: {} });
  const room = engine();
  room.setConference(room.makeConference({ members: [member("aaaa0001"), recorderMember] }));
  assert.deepEqual(room.posted, [{ data: { modo: null, type: APPLIED }, origin: "*" }], "sem gravador com modo: nulo");

  recorderMember.properties.bunkerGravacaoAplicada = "tela";
  room.fire("conference.participant_property_changed", recorderMember, "bunkerGravacaoAplicada", undefined, "tela");
  room.notify();
  assert.deepEqual(room.posted.slice(1), [{ data: { modo: "tela", type: APPLIED }, origin: "*" }], "so a palavra do modo");

  // Um aluno com a propriedade nao conta: so o participante escondido (o gravador).
  const student = member("aaaa0002", { properties: { bunkerGravacaoAplicada: "sala" } });
  room.conference().members.push(student);
  room.fire("conference.userJoined", "aaaa0002", student);
  assert.equal(room.posted.length, 2);

  const learner = engine({ moderator: false });
  learner.setConference(learner.makeConference({ members: [recorderMember] }));
  assert.deepEqual(learner.posted, [], "o iframe do aluno nao avisa nada");
});

test("o gravador aceita o modo so de quem modera: com o pedido de um aluno, a gravacao segue a de sempre", () => {
  const room = engine({ framed: false, recorder: true });
  const student = member("aaaa0001", { properties: { bunkerGravacao: "tela" }, tracks: [screenTrack("aaaa0001-v1")] });
  room.setConference(room.makeConference({ members: [student, member("aaaa0002", { moderator: true })] }));
  assert.equal(room.layer(), null, "nenhuma camada");
  assert.deepEqual(room.types(), [], "nenhum volume mexido, nenhuma tela fixada");
  assert.deepEqual(room.conference().own, { bunkerGravacaoAplicada: "sala" }, "o gravador conta que gravou a sala");
});

test("o gravador no modo tela: a camada preta so com a tela de quem modera, a tela fixada no palco e so a voz de quem modera", () => {
  const room = engine({ framed: false, recorder: true });
  const screen = screenTrack("host0001-v1");
  const host = member("host0001", { moderator: true, properties: { bunkerGravacao: "tela" }, tracks: [cameraTrack("host0001-v0"), screen] });
  const student = member("aaaa0001");
  const recorderSelf = member("rec00001", { hidden: true });
  room.state["features/video-layout"] = { remoteScreenShares: ["host0001-v1"] };
  room.setConference(room.makeConference({ members: [host, student, recorderSelf] }));

  assert.deepEqual(room.conference().own, { bunkerGravacaoAplicada: "tela" });
  const layer = room.layer();
  assert.ok(layer, "a camada por cima da pagina");
  assert.match(layer.attributes.style, /position:fixed;inset:0;z-index:2147483647;background:#000/);
  assert.equal(room.video().srcObject, screen.stream, "o video nosso com a faixa da tela");
  assert.equal(room.video().muted, true, "o som fica com o motor (a voz de quem modera)");
  assert.deepEqual(room.actions, [
    { participant: { id: "host0001-v1" }, type: "PIN_PARTICIPANT" },
    { participantId: "aaaa0001", type: "SET_VOLUME", volume: 0 }
  ], "a tela no palco e o aluno sem volume; o gravador e quem modera nao sao tocados");

  // Mudancas do store nao repetem nada.
  room.notify();
  assert.equal(room.actions.length, 2);
  assert.equal(room.appended.length, 1, "uma camada so");
});

test("o modo tela fica ate o fim da gravacao: o console que recarrega (sem o pedido) nao devolve o palco ao video", () => {
  const room = engine({ framed: false, recorder: true });
  const host = member("host0001", { moderator: true, properties: { bunkerGravacao: "tela" }, tracks: [screenTrack("host0001-v1")] });
  room.state["features/video-layout"] = { remoteScreenShares: ["host0001-v1"] };
  room.setConference(room.makeConference({ members: [host] }));
  delete host.properties.bunkerGravacao;
  room.fire("conference.participant_property_changed", host, "bunkerGravacao", "tela", undefined);
  room.notify();
  assert.deepEqual(room.conference().own, { bunkerGravacaoAplicada: "tela" });
  assert.equal(room.video().srcObject, host.tracks[0].stream);
});

test("a tela muda: parar de compartilhar deixa preto, a tela nova entra e, com duas, vale a mais recente", () => {
  const room = engine({ framed: false, recorder: true });
  const first = screenTrack("host0001-v1");
  const host = member("host0001", { moderator: true, properties: { bunkerGravacao: "tela" }, tracks: [first] });
  const cohost = member("coho0001", { moderator: true, tracks: [] });
  room.state["features/video-layout"] = { remoteScreenShares: ["host0001-v1"] };
  room.setConference(room.makeConference({ members: [host, cohost] }));
  assert.equal(room.video().srcObject, first.stream);

  // Parou de compartilhar: a faixa sai.
  host.tracks.length = 0;
  room.state["features/video-layout"] = { remoteScreenShares: [] };
  room.fire("conference.trackRemoved", first);
  assert.equal(room.video().srcObject, null, "sem tela, preto");
  assert.deepEqual(room.actions.at(-1), { participant: { id: null }, type: "PIN_PARTICIPANT" }, "a fixacao da tela que saiu e solta");

  // A tela silenciada pelo motor tambem e preto.
  const muted = screenTrack("host0001-v1", { muted: true });
  host.tracks.push(muted);
  room.fire("track.trackMuteChanged", muted);
  assert.equal(room.video().srcObject, null);

  // Duas telas: a mais recente da lista do motor.
  host.tracks.length = 0;
  const hostScreen = screenTrack("host0001-v1");
  const cohostScreen = screenTrack("coho0001-v1");
  host.tracks.push(hostScreen);
  cohost.tracks.push(cohostScreen);
  room.state["features/video-layout"] = { remoteScreenShares: ["host0001-v1", "coho0001-v1"] };
  room.fire("conference.trackAdded", cohostScreen);
  assert.equal(room.video().srcObject, cohostScreen.stream);
  assert.deepEqual(room.actions.filter((action) => action.type === "PIN_PARTICIPANT").map((action) => action.participant.id), ["host0001-v1", null, "coho0001-v1"]);
});

test("a visao seguida de quem apresenta tira a tela do palco: o gravador fixa de novo, no maximo a cada 3 s", () => {
  const room = engine({ framed: false, recorder: true });
  const host = member("host0001", { moderator: true, properties: { bunkerGravacao: "tela" }, tracks: [screenTrack("host0001-v1")] });
  room.state["features/video-layout"] = { remoteScreenShares: ["host0001-v1"] };
  room.setConference(room.makeConference({ members: [host] }));
  const pins = () => room.actions.filter((action) => action.type === "PIN_PARTICIPANT").length;
  assert.equal(pins(), 1);

  room.state["features/large-video"] = { participantId: "host0001" };
  room.notify();
  assert.equal(pins(), 1, "antes de 3 s, nada");
  room.advance(3001);
  room.notify();
  assert.equal(pins(), 2, "depois, fixa de novo");
  room.notify();
  assert.equal(pins(), 2, "fixada, para");
});

test("quem entra depois sem moderar fica sem volume; quem vira moderador no meio volta a ser ouvido", () => {
  const room = engine({ framed: false, recorder: true });
  const host = member("host0001", { moderator: true, properties: { bunkerGravacao: "tela" } });
  room.setConference(room.makeConference({ members: [host] }));
  const late = member("aaaa0009");
  room.conference().members.push(late);
  room.fire("conference.userJoined", "aaaa0009", late);
  assert.deepEqual(room.actions.filter((action) => action.type === "SET_VOLUME"), [{ participantId: "aaaa0009", type: "SET_VOLUME", volume: 0 }]);

  late.isModerator = () => true;
  room.notify();
  assert.deepEqual(room.actions.filter((action) => action.type === "SET_VOLUME").at(-1), { participantId: "aaaa0009", type: "SET_VOLUME", volume: 1 });
});

test("o gravador que entrou gravando a sala passa para a tela se o pedido chega depois; antes de entrar, nada decide", () => {
  const room = engine({ framed: false, recorder: true });
  const host = member("host0001", { moderator: true, properties: {} });
  const joining = room.makeConference({ joined: false, members: [host] });
  room.setConference(joining);
  assert.deepEqual(joining.own, {}, "antes de entrar, nem sala nem tela");

  const joined = room.makeConference({ members: [host] });
  room.setConference(joined);
  assert.deepEqual(joined.own, { bunkerGravacaoAplicada: "sala" });
  host.properties.bunkerGravacao = "tela";
  room.fire("conference.participant_property_changed", host, "bunkerGravacao", undefined, "tela");
  assert.deepEqual(joined.own, { bunkerGravacaoAplicada: "tela" });
  assert.ok(room.layer());
});

test("um erro do motor nunca sai do arquivo: a gravacao segue", () => {
  const room = engine({ framed: false, recorder: true });
  const host = member("host0001", { moderator: true, properties: { bunkerGravacao: "tela" } });
  host.getTracks = () => { throw new Error("estourou"); };
  const broken = room.makeConference({ members: [host] });
  broken.setLocalParticipantProperty = () => { throw new Error("estourou"); };
  assert.doesNotThrow(() => room.setConference(broken));
  assert.doesNotThrow(() => room.post({ modo: "tela", type: MESSAGE }));
});
