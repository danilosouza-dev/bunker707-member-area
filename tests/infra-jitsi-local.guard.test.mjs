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
      AudioEncoder: {},
      MediaStreamTrackProcessor: {},
      VideoEncoder: {},
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
  const workers = [];
  const made = [];
  const element = () => ({ appendChild() {}, setAttribute() {}, style: {} });
  const node = { connect: () => node, disconnect() {}, gain: {}, start() {} };
  const track = { getSettings: () => ({}), readyState: "live" };
  const parent = { postMessage: (message, origin) => sent.push({ message, origin }) };
  let moderator = true;
  const window = {
    addEventListener: (name, fn) => { listeners[name] = fn; },
    APP: { store: { getState: () => ({ "features/base/conference": { conference: { getLocalTracks: () => [], getParticipants: () => [], isModerator: () => moderator } }, "features/base/config": {} }) } },
    AudioContext: class { createConstantSource() { return node; } createGain() { return node; } createMediaStreamDestination() { return { stream: { getAudioTracks: () => [track] } }; } close() {} resume() { return Promise.resolve(); } },
    document: { body: { appendChild: (el) => made.push(el) }, createElement: element },
    AudioEncoder: {},
    MediaStream: class {},
    MediaStreamTrackProcessor: class { readable = {}; },
    VideoEncoder: {},
    navigator: { storage: { getDirectory: () => Promise.reject(new Error("sem")) } },
    parent,
    setInterval: (fn) => intervals.push(fn),
    setTimeout: () => 0,
    Worker: class { constructor() { this.heard = []; workers.push(this); } postMessage(data) { this.heard.push(data); } terminate() { this.over = true; } },
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
  const asked = () => workers[0].heard.filter((m) => m.papel === "comecar").length;
  const compositor = (data) => workers[0].onmessage({ data });
  assert.equal(asked(), 0, "sem o arquivo aberto no console, nada grava");
  assert.equal(workers.length, 1, "o disco e do console: aqui so a linha que compoe");
  say({ nome: "gravacao-local-2026-01-01-000000.mp4", pedido: "guardado" });
  assert.equal(asked(), 0);
  say({ nome: open.nome, pedido: "guardado" });
  say({ nome: open.nome, pedido: "guardado" });
  assert.equal(asked(), 1, "uma vez so");
  compositor({ medido: 23.976, ritmo: 47.952, tipo: "ritmo" });
  compositor({ tipo: "pronto" });
  assert.deepEqual(heard().map((m) => [m.tipo, m.nome]), [["comecou", open.nome]]);

  const bytes = new ArrayBuffer(4);
  compositor({ bytes, tipo: "parte" });
  const [chunk] = heard();
  assert.deepEqual([chunk.tipo, chunk.nome, chunk.bytes === bytes], ["pedaco", open.nome, true]);

  say({ pedido: "parar" });
  assert.equal(workers[0].heard.at(-1).papel, "fim");
  compositor({ tipo: "acabou" });
  const ending = heard();
  assert.deepEqual(ending.map((m) => m.tipo), ["fim", "estado"]);
  assert.match(ending[0].relatorio, /gravação no computador/);
  assert.equal(ending[1].gravando, false);
  assert.ok(workers[0].over);
});

/** O compositor num contexto de mentira: so as contas dele (o codificador de verdade se prova no ensaio do Chrome). */
function compositor() {
  const sent = [];
  const self = { postMessage: (message) => sent.push(message) };
  const context = vm.createContext({ performance: { now: () => 0 }, self, setInterval() {}, setTimeout() {}, clearTimeout() {} });
  vm.runInContext(read("bunker707-local-worker.js"), context);
  return { context, sent };
}

test("o ritmo da gravacao e o dobro do da camera (24 vira 48, 30 vira 60), com um quadro perdido na medicao e o que o aparelho diz no desempate; ritmo que nao existe, 60", () => {
  const rate = (fps, { hint = 0, lost = [] } = {}) => {
    const { context } = compositor();
    const stamps = Array.from({ length: 61 }, (_, n) => (n * 1e6) / fps).filter((_, n) => !lost.includes(n));
    context.stamps = stamps;
    vm.runInContext(`feeds.set("camera", { stamps }); cadence(${hint});`, context);
    return Number((context.NUM / context.DEN).toFixed(3));
  };
  assert.equal(rate(24000 / 1001, { hint: 23.98 }), 47.952);
  assert.equal(rate(23.95, { hint: 23.976 }), 47.952, "a medicao curta erra um pouco; o aparelho desempata");
  assert.equal(rate(24, { hint: 24 }), 48);
  assert.equal(rate(25), 50);
  assert.equal(rate(30000 / 1001, { hint: 29.97, lost: [10, 33] }), 59.94);
  assert.equal(rate(59.94, { hint: 59.94 }), 59.94, "camera a 60: uma casa por quadro");
  assert.equal(rate(27.6, { hint: 29.97 }), 60, "o aparelho que nao entrega o que diz");
});

test("o arquivo: um moov com as duas faixas, e cada fragmento com a hora e a duracao exatas (um quadro que faltou vira o anterior mais longo); o som na ordem, sem buraco", () => {
  const { context, sent } = compositor();
  vm.runInContext("NUM = 48000; DEN = 1001; mp4 = { aac: new Uint8Array([17, 144]), audio: [], avcC: new Uint8Array([1, 2, 3]), headed: false, seq: 1, sound: 0, video: [] };", context);
  const push = (slots, sounds) => vm.runInContext(`${JSON.stringify(slots)}.forEach((slot, n) => mp4.video.push({ data: new Uint8Array(5 + n), key: n === 0, slot })); for (let i = 0; i < ${sounds}; i += 1) mp4.audio.push(new Uint8Array(7));`, context);
  push([0, 1, 3], 2);
  vm.runInContext("cut(4)", context);
  push([4, 5], 3);
  vm.runInContext("cut(6)", context);
  const file = Buffer.concat(sent.map((m) => Buffer.from(m.bytes)));
  const boxes = (start, end) => {
    const out = [];
    for (let at = start; at < end; at += file.readUInt32BE(at)) out.push({ end: at + file.readUInt32BE(at), start: at, type: file.toString("latin1", at + 4, at + 8) });
    return out;
  };
  const top = boxes(0, file.length);
  assert.deepEqual(top.map((b) => b.type), ["ftyp", "moov", "moof", "mdat", "moof", "mdat"]);
  assert.equal(boxes(top[1].start + 8, top[1].end).filter((b) => b.type === "trak").length, 2);
  const read32 = (at) => file.readUInt32BE(at);
  const moof = (index) => {
    const [video, sound] = boxes(top[index].start + 8, top[index].end).filter((b) => b.type === "traf").map((traf) => {
      const inner = Object.fromEntries(boxes(traf.start + 8, traf.end).map((b) => [b.type, b]));
      return { count: read32(inner.trun.start + 12), offset: read32(inner.trun.start + 16), rows: inner.trun.start + 20, time: Number(file.readBigUInt64BE(inner.tfdt.start + 12)) };
    });
    return { sound, video };
  };
  const first = moof(2);
  assert.deepEqual([first.video.time, first.sound.time, first.video.count, first.sound.count], [0, 0, 3, 2]);
  assert.deepEqual([0, 1, 2].map((n) => read32(first.video.rows + n * 12)), [1001000, 2002000, 1001000], "a casa 2 faltou: o quadro 1 dura duas");
  assert.equal(top[2].start + first.video.offset, top[3].start + 8, "os dados comecam no mdat");
  assert.equal(first.sound.offset - first.video.offset, 5 + 6 + 7);
  const second = moof(4);
  assert.deepEqual([second.video.time, second.sound.time], [4 * 1001000, 2 * 1024]);
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
