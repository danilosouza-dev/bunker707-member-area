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
  assert.doesNotMatch(main, /window\.parent\.postMessage/, "nada sai para a pagina que montou o iframe");
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

test("o painel fica abaixo do selo Ao vivo do palco (25/11/2026: o selo cobriu o botao) e o arquivo baixa sozinho ao parar", () => {
  const top = Number(/position:fixed;left:12px;top:(\d+)px/.exec(main)?.[1]);
  assert.ok(top >= 56, `o selo ocupa o alto do palco (top ${top})`);
  assert.match(main, /left\.unshift\(item\); render\(\); download\(item\);/);
});
