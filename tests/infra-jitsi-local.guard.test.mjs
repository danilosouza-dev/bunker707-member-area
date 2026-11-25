import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Guarda da gravacao no computador de quem apresenta (docs/30 D141; docs/18 §1.2): os dois arquivos da instancia nao falam
// com a rede, usam as faixas do motor (nunca uma copia, que deixaria a camera ligada), so agem no iframe de quem modera,
// e o ?v= de cada um acompanha o conteudo. O que sai no arquivo gravado se prova no ensaio com o Chrome de verdade
// (docs/30 D141), porque o gravador do navegador nao existe no Node.
const web = join(dirname(fileURLToPath(import.meta.url)), "..", "infra", "jitsi", "web");
const read = (name) => readFileSync(join(web, name), "utf8");
const strip = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const main = strip(read("bunker707-local.js"));
const worker = strip(read("bunker707-local-worker.js"));
const config = read("custom-config.js");
const v = (name) => createHash("sha256").update(readFileSync(join(web, name))).digest("hex").slice(0, 8);

test("nenhum dos dois fala com a rede, roda texto como codigo ou copia a faixa da camera", () => {
  for (const code of [main, worker]) {
    assert.doesNotMatch(code, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|import|require|eval|Function|innerHTML|outerHTML|insertAdjacentHTML|localStorage|sessionStorage|cookie|getUserMedia|getDisplayMedia)\b/);
    assert.doesNotMatch(code, /https?:\/\/|wss?:\/\//);
  }
  assert.doesNotMatch(main, /\.clone\(/, "a faixa e a do motor: desligou na sala, o aparelho apaga");
  assert.deepEqual(main.match(/window\.parent\.postMessage\([^)]*\)/g), ["window.parent.postMessage(message, host, transfer || [])"], "um so lugar manda a pagina, e so para a origem que mandou o ola");
  assert.doesNotMatch(worker, /window\.parent/);
});

test("o ?v= do carregador e o do worker sao o comeco do sha256 de cada arquivo", () => {
  assert.equal(/bunker707-local-worker\.js\?v=([0-9a-f]{8})'/.exec(main)?.[1], v("bunker707-local-worker.js"), `o worker mudou: troque o v em bunker707-local.js para ${v("bunker707-local-worker.js")}`);
  assert.equal(/script\.src = '\/libs\/bunker707-local\.js\?v=([0-9a-f]{8})';/.exec(config)?.[1], v("bunker707-local.js"), `o arquivo mudou: troque o v em custom-config.js para ${v("bunker707-local.js")}`);
});

test("o carregador: so no iframe do nosso app, nunca no gravador nem na sala aberta pelo endereco", () => {
  const loader = /\/\/ bunker707:local-loader:inicio\n([\s\S]*?)\/\/ bunker707:local-loader:fim\n/.exec(config)[1];
  const load = (hash) => {
    const added = [];
    vm.runInNewContext(loader, { document: { createElement: () => ({}), head: { appendChild: (el) => added.push(el) } }, window: { location: { hash } } });
    return added.length;
  };
  assert.equal(load('#config.bunkerTheme="dark"'), 1);
  assert.equal(load("#config.iAmRecorder=true"), 0);
  assert.equal(load('#config.bunkerTheme="dark"&config.iAmRecorder=true'), 0);
  assert.equal(load(""), 0);
});

test("o painel so aparece no iframe de quem modera: aluno, gravador e sala fora de iframe nao ganham nada", () => {
  const run = ({ framed = true, moderator = true, recorder = false }) => {
    const added = [];
    const intervals = [];
    const element = () => ({ appendChild() {}, setAttribute() {}, style: {} });
    const window = {
      APP: { store: { getState: () => ({ "features/base/conference": { conference: { getLocalTracks: () => [], isModerator: () => moderator } }, "features/base/config": { iAmRecorder: recorder } }) } },
      addEventListener() {},
      document: { body: { appendChild: (el) => added.push(el) }, createElement: element },
      MediaRecorder: {},
      MediaStreamTrackGenerator: {},
      MediaStreamTrackProcessor: {},
      navigator: { storage: { getDirectory: () => Promise.reject(new Error("sem")) } },
      setInterval: (fn) => intervals.push(fn),
      Worker: {},
    };
    window.parent = framed ? {} : window;
    vm.runInNewContext(read("bunker707-local.js"), { window });
    for (const fn of intervals) fn();
    return added.length;
  };
  assert.equal(run({}), 1);
  assert.equal(run({ moderator: false }), 0);
  assert.equal(run({ recorder: true }), 0);
  assert.equal(run({ framed: false }), 0);
});

test("o console manda (D142): o ola so da pagina que montou o iframe; os pedidos so da mesma origem; comecar abre o arquivo no console e so grava depois do guardado", async () => {
  const sent = [];
  const listeners = {};
  const intervals = [];
  const recorders = [];
  const workers = [];
  const made = [];
  const element = () => ({ appendChild() {}, setAttribute() {}, style: {} });
  const node = { connect: () => node, disconnect() {}, gain: {}, start() {} };
  const track = { getSettings: () => ({}), readyState: "live" };
  const parent = { postMessage: (message, origin) => sent.push({ message, origin }) };
  let moderator = true;
  class Recorder {
    static isTypeSupported = (type) => type.startsWith("video/mp4");
    constructor() { this.state = "inactive"; recorders.push(this); }
    start() { this.state = "recording"; this.onstart(); }
    stop() { this.state = "inactive"; this.onstop(); }
  }
  const window = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    APP: { store: { getState: () => ({ "features/base/conference": { conference: { getLocalTracks: () => [], getParticipants: () => [], isModerator: () => moderator } }, "features/base/config": {} }) } },
    AudioContext: class { createConstantSource() { return node; } createGain() { return node; } createMediaStreamDestination() { return { stream: { getAudioTracks: () => [track] } }; } close() {} resume() { return Promise.resolve(); } },
    document: { body: { appendChild: (el) => made.push(el) }, createElement: element },
    MediaRecorder: Recorder,
    MediaStream: class {},
    MediaStreamTrackGenerator: class { writable = {}; },
    MediaStreamTrackProcessor: class {},
    navigator: { storage: { getDirectory: () => Promise.reject(new Error("sem")) } },
    parent,
    setInterval: (fn) => intervals.push(fn),
    setTimeout: () => 0,
    Worker: class { constructor() { workers.push(this); } postMessage() {} terminate() { this.over = true; } },
  };
  vm.runInNewContext(read("bunker707-local.js"), { window });
  for (const fn of intervals) fn();
  const type = "bunker707:gravacao-local";
  const say = (data, { origin = "https://console.test", source = parent } = {}) => listeners.message({ data: { type, ...data }, origin, source });
  const heard = () => sent.splice(0).map((item) => item.message);

  say({ pedido: "comecar" });
  say({ pedido: "ola" }, { source: {} });
  assert.deepEqual(sent, [], "sem o ola da pagina que montou o iframe, nada");
  say({ pedido: "ola" });
  assert.equal(sent[0].origin, "https://console.test");
  const { localRecordingEventOf } = await import("../src/lib/jitsi-room-config.ts");
  assert.deepEqual([localRecordingEventOf(sent[0].message).kind, localRecordingEventOf(sent[0].message).state.ready], ["state", true], "o app entende o estado");
  heard();
  for (const fn of intervals) fn();
  assert.ok(made.every((panel) => panel.style.display === "none"), "com o console mandando, o painel de dentro da sala some");
  heard();

  say({ pedido: "comecar" }, { origin: "https://outro.test" });
  assert.deepEqual(heard(), [], "pedido de outra origem nao vale");
  moderator = false;
  say({ pedido: "comecar" });
  assert.deepEqual(heard().map((m) => m.tipo), ["falhou"], "quem nao modera nao grava");
  moderator = true;

  say({ pedido: "comecar" });
  const [open] = heard();
  assert.equal(open.tipo, "abrir");
  assert.equal(localRecordingEventOf(open).name, open.nome);
  assert.equal(recorders.length, 0, "sem o arquivo aberto no console, nada grava");
  assert.equal(workers.length, 1, "o disco e do console: aqui so a linha que compoe");
  say({ nome: "gravacao-local-2026-01-01-000000.mp4", pedido: "guardado" });
  assert.equal(recorders.length, 0);
  say({ nome: open.nome, pedido: "guardado" });
  assert.deepEqual(heard().map((m) => [m.tipo, m.nome]), [["comecou", open.nome]]);

  const bytes = new ArrayBuffer(4);
  recorders[0].ondataavailable({ data: { arrayBuffer: async () => bytes, size: 4 } });
  await new Promise((resolve) => setImmediate(resolve));
  const [chunk] = heard();
  assert.deepEqual([chunk.tipo, chunk.nome, chunk.bytes === bytes], ["pedaco", open.nome, true]);

  say({ pedido: "parar" });
  await new Promise((resolve) => setImmediate(resolve));
  const ending = heard();
  assert.deepEqual(ending.map((m) => m.tipo), ["fim", "estado"]);
  assert.match(ending[0].relatorio, /gravação no computador/);
  assert.equal(ending[1].gravando, false);
  assert.ok(workers[0].over);
});

test("o console: os avisos so do proprio iframe, o arquivo fecha antes de encerrar a live, o envio so com a live fora do ar e apagar so pelo botao", () => {
  const base = join(web, "..", "..", "..", "src", "components", "admin", "v2", "communication", "webinars", "session-console");
  const hook = readFileSync(join(base, "use-local-recording.ts"), "utf8");
  assert.match(hook, /if \(event\.origin !== origin \|\| !source \|\| event\.source !== source\) \{\s*return;/);
  assert.match(hook, /if \(!canWrite \|\| sessionOpen \|\| current !== null \|\| upload !== null\) \{\s*return;/, "nunca disputa a internet com a live no ar");
  const sent = hook.slice(hook.indexOf("const sendFile"), hook.indexOf("const start = "));
  assert.doesNotMatch(sent, /removeLocalFile/, "enviar nunca apaga");
  const main = readFileSync(join(base, "session-console.tsx"), "utf8");
  assert.match(main, /await local\.stop\(\);[\s\S]*?endLiveSession\(\{ sessionId \}\)/);
  assert.match(main, /if \(mode === "sala" && followLocal && local\.available && permissions\.canWrite\) \{\s*local\.start\(\);/);
  const proxy = readFileSync(join(web, "..", "..", "..", "src", "proxy.ts"), "utf8");
  assert.match(proxy, /connect-src 'self' https:\/\/video\.bunnycdn\.com /);
  const disk = readFileSync(join(web, "..", "..", "..", "public", "workers", "gravacao-local.js"), "utf8");
  assert.doesNotMatch(disk, /\b(fetch|XMLHttpRequest|WebSocket|importScripts|eval)\b/);
  assert.match(disk, /handle\.write\(bytes, \{ at: offset \}\) !== bytes\.byteLength/, "o disco cheio nunca conta como guardado");
});

test("o painel fica abaixo do selo Ao vivo do palco (25/11/2026: o selo cobriu o botao) e o arquivo baixa sozinho ao parar", () => {
  const top = Number(/position:fixed;left:12px;top:(\d+)px/.exec(main)?.[1]);
  assert.ok(top >= 56, `o selo ocupa o alto do palco (top ${top})`);
  assert.match(main, /left\.unshift\(item\); render\(\); download\(item\);/);
});
