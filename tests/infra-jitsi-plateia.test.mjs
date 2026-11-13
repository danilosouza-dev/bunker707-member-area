import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Os participantes simulados desenhados pelo proprio motor de video (docs/30 D117 e §6.9): o arquivo
// infra/jitsi/web/bunker707-plateia.js, avaliado como o navegador faria, contra um motor de mentira com o mesmo
// formato do estado e das acoes que ele usa na tag fixada (base/participants, filmstrip, base/conference e
// base/config). O que o motor de verdade desenha com isso so o ensaio local prova (docs/30 §6.9); aqui se prova o que
// o arquivo pede ao motor: quem entra, quem sai, a ordem, o que ele recusa, o repasse ao gravador e de quem o gravador
// aceita a lista. A montagem, o smoke e o ?v= ficam na guarda ao lado (infra-jitsi-plateia.guard.test.mjs).

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "infra", "jitsi", "web", "bunker707-plateia.js"), "utf8");
const MESSAGE = "bunker707:plateia";
const plain = (value) => JSON.parse(JSON.stringify(value));

/** Um participante da conferencia como a biblioteca do motor entrega (so o que o arquivo le). */
const member = (id, { hidden = false, moderator = false } = {}) => ({ getId: () => id, isHidden: () => hidden, isModerator: () => moderator });

/**
 * O motor de mentira: o store com as quatro fatias, a conferencia com as escutas e os envios, e a janela com a
 * mensagem do pai e o relogio na mao do teste. A lista do motor (filmstrip.remoteParticipants) nasce em ordem
 * alfabetica a cada entrada, como o motor faz sem ninguem falando.
 */
function engine({ framed = true, recorder = false, storeReady = true } = {}) {
  const actions = [];
  const sent = [];
  const timers = [];
  const subscribers = [];
  const makeConference = (members = []) => {
    const handlers = {};
    return {
      getParticipants: () => members,
      handlers,
      members,
      on(name, handler) { (handlers[name] ??= []).push(handler); },
      sendEndpointMessage(to, payload) { sent.push({ payload: plain(payload), to }); }
    };
  };
  const state = {
    "features/base/conference": { conference: makeConference() },
    "features/base/config": { iAmRecorder: recorder },
    "features/base/participants": { remote: new Map() },
    "features/filmstrip": { remoteParticipants: [] }
  };
  const sortByName = () => {
    const remote = state["features/base/participants"].remote;
    state["features/filmstrip"] = { remoteParticipants: [...remote.keys()].sort((a, b) => String(remote.get(a).name).localeCompare(String(remote.get(b).name))) };
  };
  const store = {
    dispatch(action) {
      actions.push(action);
      const remote = state["features/base/participants"].remote;
      if (action.type === "PARTICIPANT_JOINED") { remote.set(action.participant.id, { ...action.participant }); sortByName(); }
      if (action.type === "PARTICIPANT_UPDATED") { remote.set(action.participant.id, { ...remote.get(action.participant.id), ...action.participant }); sortByName(); }
      if (action.type === "PARTICIPANT_LEFT") { remote.delete(action.participant.id); sortByName(); }
      if (action.type === "SET_REMOTE_PARTICIPANTS") { state["features/filmstrip"] = { remoteParticipants: action.participants }; }
      for (const subscriber of [...subscribers]) subscriber();
    },
    getState: () => state,
    subscribe(listener) { subscribers.push(listener); }
  };
  const parent = {};
  let onMessage = null;
  const window = {
    APP: storeReady ? { store } : undefined,
    addEventListener(name, handler) { if (name === "message") onMessage = handler; },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; }
  };
  window.parent = framed ? parent : window;
  vm.runInNewContext(source, { window });
  return {
    actions,
    /** Um participante de verdade entra pelo motor (nao pelo arquivo). */
    enter(id, name, extra = {}) { store.dispatch({ participant: { id, name, role: "participant", ...extra }, type: "PARTICIPANT_JOINED" }); },
    /** Um sinal da conferencia de agora (as escutas sao de cada conferencia). */
    fire(name, ...args) { for (const handler of state["features/base/conference"].conference.handlers[name] ?? []) handler(...args); },
    handlers: () => state["features/base/conference"].conference.handlers,
    makeConference,
    order: () => [...state["features/filmstrip"].remoteParticipants],
    /** A mensagem da pagina que montou o iframe (ou de outra janela, com `from`). */
    post(data, from = parent) { onMessage({ data, source: from }); },
    ready() { window.APP = { store }; },
    remoteIds: () => [...state["features/base/participants"].remote.keys()],
    runTimers() { for (const timer of timers.splice(0)) timer.callback(); },
    sent,
    setConference(conference) { state["features/base/conference"] = { conference }; for (const subscriber of [...subscribers]) subscriber(); },
    state,
    timers,
    types: () => actions.map((action) => action.type)
  };
}

const ana = { id: "simp1", name: "Ana M.", photo: "https://storage.example/webinars/personas/a.webp" };
const bruno = { id: "simp2", name: "Bruno S.", photo: "" };
const carla = { id: "simg1", name: "Carla R.", photo: "" };

test("a lista da pagina vira participantes so deste navegador: a foto, o nome, o papel de participante e a marca que tira do palco", () => {
  const room = engine();
  room.post({ people: [ana, bruno], type: MESSAGE });
  const joined = room.actions.filter((action) => action.type === "PARTICIPANT_JOINED");
  assert.equal(joined.length, 2);
  const conference = room.state["features/base/conference"].conference;
  assert.equal(joined[0].participant.conference, conference, "na conferencia de agora");
  assert.deepEqual(plain({ ...joined[0].participant, conference: undefined }), { avatarURL: ana.photo, botType: "bunker707-plateia", id: "simp1", name: "Ana M.", role: "participant" });
  assert.equal(joined[1].participant.avatarURL, undefined, "sem foto, as iniciais do motor");
  assert.equal(joined[1].participant.botType, "bunker707-plateia", "o motor pula quem tem botType ao escolher o video grande por falta de opcao");
  assert.equal(joined[1].participant.role, "participant", "nunca moderador: sem o icone e sem poder");
  assert.equal(joined.some((action) => "local" in action.participant || "fakeParticipant" in action.participant), false);
});

test("so a pagina que montou o iframe manda: outra janela, outro tipo, a sala aberta pelo endereco e a lista que nao e lista ficam de fora", () => {
  const room = engine();
  room.post({ people: [ana], type: MESSAGE }, { outra: "janela" });
  room.post({ people: [ana], type: "outra-coisa" });
  room.post({ people: "simp1", type: MESSAGE });
  room.post(null);
  assert.deepEqual(room.types(), [], "nada entrou");

  const direct = engine({ framed: false });
  direct.post({ people: [ana], type: MESSAGE }, direct.state);
  assert.deepEqual(direct.types(), [], "fora de um iframe ninguem manda a lista por mensagem");
});

test("a lista e conferida: id no nosso formato e sem repetir, nome de 1 a 60, foto so por https e no maximo 300 pessoas", () => {
  const room = engine();
  const many = Array.from({ length: 320 }, (_, index) => ({ id: `simg${index.toString(36)}`, name: `Pessoa ${index}` }));
  room.post({
    people: [
      { id: "abc123", name: "Id De Verdade" },
      { id: "simx1", name: "Grupo Errado" },
      { id: "simg-1", name: "Tracinho" },
      { id: "simp1", name: "   " },
      { id: "simp1", name: `  ${"N".repeat(80)}  ` },
      { id: "simp1", name: "Repetida" },
      { id: "simp2", name: "Foto Http", photo: "http://storage.example/a.webp" },
      { id: "simp3", name: "Foto Script", photo: "javascript:alert(1)" },
      { id: "simp4", name: "Foto Com Espaco", photo: "https://storage.example/a b.webp" },
      { id: "simp5", name: "Foto Certa", photo: "https://storage.example/a.webp" },
      { id: 7, name: "Id Numero" },
      null,
      ...many
    ],
    type: MESSAGE
  });
  const joined = room.actions.filter((action) => action.type === "PARTICIPANT_JOINED").map((action) => action.participant);
  assert.equal(joined.length, 300, "o teto");
  assert.deepEqual(joined.slice(0, 5).map((person) => [person.id, person.name.length <= 60 ? person.name : "longo", person.avatarURL ?? null]), [
    ["simp1", "N".repeat(60), null],
    ["simp2", "Foto Http", null],
    ["simp3", "Foto Script", null],
    ["simp4", "Foto Com Espaco", null],
    ["simp5", "Foto Certa", "https://storage.example/a.webp"]
  ]);
  assert.equal(joined.some((person) => ["abc123", "simx1", "simg-1"].includes(person.id)), false);
});

test("a lista seguinte: quem saiu sai, quem mudou de nome ou de foto e atualizado, e quem continua igual nao gera nada", () => {
  const room = engine();
  room.post({ people: [ana, bruno, carla], type: MESSAGE });
  room.actions.length = 0;
  room.post({ people: [ana, { ...bruno, name: "Bruno Souza", photo: "https://storage.example/b.webp" }], type: MESSAGE });
  assert.deepEqual(
    room.actions.filter((action) => action.type !== "SET_REMOTE_PARTICIPANTS").map((action) => [action.type, action.participant.id, action.participant.name ?? null, action.participant.avatarURL ?? null]),
    [
      ["PARTICIPANT_LEFT", "simg1", null, null],
      ["PARTICIPANT_UPDATED", "simp2", "Bruno Souza", "https://storage.example/b.webp"]
    ]
  );
  room.actions.length = 0;
  room.post({ people: [], type: MESSAGE });
  assert.deepEqual(room.actions.map((action) => [action.type, action.participant.id]), [["PARTICIPANT_LEFT", "simp1"], ["PARTICIPANT_LEFT", "simp2"]], "a lista vazia tira todos");
  assert.deepEqual(room.remoteIds(), []);
});

test("a ordem: quem modera e a tela compartilhada em cima, os alunos de verdade na ordem do motor, os simulados com foto e os sem foto", () => {
  const room = engine();
  room.enter("aaaa0001", "Zuleica R.");
  room.enter("aaaa0002", "Danilo S.", { role: "moderator" });
  room.enter("aaaa0002-v1", "Danilo S.", { fakeParticipant: "RemoteScreenShare", role: undefined });
  room.enter("aaaa0003", "Bento A.");
  assert.equal(room.types().includes("SET_REMOTE_PARTICIPANTS"), false, "sem simulado nenhum, o arquivo nao toca na ordem do motor");

  room.post({ people: [carla, ana, { id: "simg2", name: "Alice B.", photo: "" }, { id: "simp9", name: "Wagner T.", photo: "https://storage.example/w.webp" }], type: MESSAGE });
  assert.deepEqual(room.order(), ["aaaa0002", "aaaa0002-v1", "aaaa0003", "aaaa0001", "simp1", "simp9", "simg1", "simg2"], "os simulados na ordem que a pagina mandou, a foto primeiro");
  assert.equal(room.actions.filter((action) => action.type === "SET_REMOTE_PARTICIPANTS").length, 1, "quatro entradas, uma correcao de ordem so, no fim");

  // Outra aluna de verdade entra: o motor refaz a ordem dele (alfabetica) e o arquivo poe os grupos de novo.
  room.actions.length = 0;
  room.enter("aaaa0004", "Amanda C.");
  assert.deepEqual(room.order(), ["aaaa0002", "aaaa0002-v1", "aaaa0004", "aaaa0003", "aaaa0001", "simp1", "simp9", "simg1", "simg2"]);
  assert.equal(room.actions.filter((action) => action.type === "SET_REMOTE_PARTICIPANTS").length, 1, "uma correcao so, sem laco");

  // O motor poe quem fala na frente entre os de verdade: a ordem dele entre os de verdade fica.
  room.state["features/filmstrip"] = { remoteParticipants: ["aaaa0001", "aaaa0002", "aaaa0002-v1", "aaaa0004", "aaaa0003", "simp1", "simp9", "simg1", "simg2"] };
  room.actions.length = 0;
  room.setConference(room.state["features/base/conference"].conference);
  assert.deepEqual(room.order(), ["aaaa0002", "aaaa0002-v1", "aaaa0001", "aaaa0004", "aaaa0003", "simp1", "simp9", "simg1", "simg2"], "quem modera primeiro; a aluna que fala continua a frente das outras");

  // Com tudo no lugar, uma mudanca qualquer do motor nao gera acao nenhuma.
  room.actions.length = 0;
  room.setConference(room.state["features/base/conference"].conference);
  assert.deepEqual(room.types(), []);
});

test("sala nova na mesma pagina: o motor esquece todo mundo, e o arquivo poe a lista de novo sem mandar ninguem sair", () => {
  const room = engine();
  room.post({ people: [ana, bruno], type: MESSAGE });
  room.actions.length = 0;
  room.state["features/base/participants"].remote.clear();
  room.state["features/filmstrip"] = { remoteParticipants: [] };
  room.setConference(null);
  assert.deepEqual(room.types(), [], "sem conferencia, nada");
  const again = room.makeConference();
  room.setConference(again);
  const joined = room.actions.filter((action) => action.type === "PARTICIPANT_JOINED");
  assert.deepEqual(joined.map((action) => action.participant.id), ["simp1", "simp2"]);
  assert.equal(joined[0].participant.conference, again, "na conferencia nova");
  assert.equal(room.types().includes("PARTICIPANT_LEFT"), false);
});

test("o app sobe depois do arquivo: ele espera o store e aplica a lista que chegou antes", () => {
  const room = engine({ storeReady: false });
  room.post({ people: [ana], type: MESSAGE });
  assert.deepEqual(room.types(), []);
  assert.equal(room.timers.length, 1, "confere de novo em meio segundo");
  room.runTimers();
  assert.equal(room.timers.length, 1, "ainda sem o store: espera mais");
  room.ready();
  room.runTimers();
  assert.deepEqual(room.actions.filter((action) => action.type === "PARTICIPANT_JOINED").map((action) => action.participant.id), ["simp1"]);
});

test("o console de quem modera repassa: nao desenha nada e manda a lista so ao gravador, em partes de 100", () => {
  const room = engine();
  const conference = room.makeConference([member("aaaa0001"), member("rec00001", { hidden: true }), member("aaaa0002", { moderator: true })]);
  room.setConference(conference);
  // A pagina tinha mandado desenhar (o console de antes): ao virar repasse, o que estava desenhado sai.
  room.post({ people: [ana], type: MESSAGE });
  room.actions.length = 0;
  const people = Array.from({ length: 230 }, (_, index) => ({ id: `simg${index.toString(36)}`, name: `Pessoa ${index}`, photo: "" }));
  room.post({ people, relay: true, type: MESSAGE });
  assert.deepEqual(room.actions.map((action) => [action.type, action.participant.id]), [["PARTICIPANT_LEFT", "simp1"]], "quem repassa nunca desenha");
  assert.deepEqual(room.sent.map((item) => [item.to, item.payload.type, item.payload.seq, item.payload.part, item.payload.parts, item.payload.people.length]), [
    ["rec00001", MESSAGE, 1, 0, 3, 100],
    ["rec00001", MESSAGE, 1, 1, 3, 100],
    ["rec00001", MESSAGE, 1, 2, 3, 30]
  ]);
  assert.deepEqual(room.sent[2].payload.people[29], { id: "simg6d", name: "Pessoa 229", photo: "" });

  // O gravador que entra depois recebe a ultima lista, quando o canal dele ja abriu.
  room.sent.length = 0;
  conference.members.push(member("rec00002", { hidden: true }));
  room.fire("conference.userJoined", "aaaa0009", member("aaaa0009"));
  assert.equal(room.timers.length, 0, "um aluno que entra nao dispara o repasse");
  room.fire("conference.userJoined", "rec00002", member("rec00002", { hidden: true }));
  assert.equal(room.timers.length, 1);
  assert.equal(room.timers[0].delay, 3000);
  room.runTimers();
  assert.deepEqual([...new Set(room.sent.map((item) => item.to))], ["rec00001", "rec00002"]);
  assert.deepEqual([...new Set(room.sent.map((item) => item.payload.seq))], [2], "um envio novo");

  // Sem gravador na sala, nada e enviado.
  const alone = engine();
  alone.post({ people, relay: true, type: MESSAGE });
  assert.deepEqual(alone.sent, []);
});

test("o gravador so aceita a lista de quem modera, junta as partes e segue a lista seguinte", () => {
  const recorder = engine({ framed: false, recorder: true });
  const host = member("aaaa0002", { moderator: true });
  const student = member("aaaa0001");
  const part = (seq, index, parts, people) => ({ part: index, parts, people, seq, type: MESSAGE });
  const receive = (from, payload) => recorder.fire("conference.endpoint_message_received", from, payload);

  receive(student, part(1, 0, 1, [ana]));
  assert.deepEqual(recorder.types(), [], "um aluno que manda a lista direto pelo motor e ignorado");
  receive(host, { people: [ana], type: "outra-coisa" });
  receive(host, part(1, 0, 9, [ana]));
  receive(host, part(1, 3, 2, [ana]));
  receive(host, { part: 0, parts: 1, people: "simp1", seq: 1, type: MESSAGE });
  assert.deepEqual(recorder.types(), [], "mensagem torta");

  receive(host, part(4, 0, 2, [ana, bruno]));
  assert.deepEqual(recorder.types(), [], "so com todas as partes");
  receive(host, part(4, 1, 2, [carla]));
  assert.deepEqual(recorder.actions.filter((action) => action.type === "PARTICIPANT_JOINED").map((action) => action.participant.id), ["simp1", "simp2", "simg1"]);
  assert.deepEqual(recorder.order(), ["simp1", "simp2", "simg1"], "na gravacao, a mesma ordem: a foto primeiro");

  recorder.actions.length = 0;
  receive(host, part(5, 0, 1, [bruno]));
  assert.deepEqual(recorder.actions.filter((action) => action.type === "PARTICIPANT_LEFT").map((action) => action.participant.id), ["simp1", "simg1"]);

  // O gravador nao repassa nem escuta a pagina: nao ha pagina.
  assert.deepEqual(recorder.sent, []);
  assert.equal(recorder.handlers()["conference.userJoined"], undefined);
});

test("um erro do motor nunca sai do arquivo: a acao que estoura fica para tras e a sala segue", () => {
  const room = engine();
  const original = room.state;
  const store = { ...original };
  assert.ok(store);
  // O dispatch estoura numa entrada: as outras entram.
  const remote = room.state["features/base/participants"].remote;
  const realSet = remote.set.bind(remote);
  remote.set = (id, value) => { if (id === "simp2") throw new Error("estourou"); return realSet(id, value); };
  assert.doesNotThrow(() => room.post({ people: [ana, bruno, carla], type: MESSAGE }));
  assert.deepEqual(room.remoteIds(), ["simp1", "simg1"]);
});
