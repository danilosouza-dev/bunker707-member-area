import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Guarda de arquitetura (docs/18 §1.2: conferencia de texto so vale como guarda, em arquivo .guard) do Gravar para Live
// gravada no console (docs/30 A63 e D125). As regras dos dois circulos tem teste de comportamento em
// webinarios-console-v2-modelo.test.mjs e o desenho da barra em webinarios-console-ao-vivo-tela.test.mjs; o arquivo da
// instancia, em infra-jitsi-gravacao.test.mjs. Aqui, as ligacoes que o HTML do servidor nao alcanca: o modo vai ao iframe
// antes do pedido de gravar, cada circulo pede o seu modo, o pedido volta a cada iframe montado e a sala volta quando a
// gravacao para, e o aviso do gravador so e aceito do proprio iframe e da origem do motor.
const here = dirname(fileURLToPath(import.meta.url));
const consoleDir = join(here, "..", "src", "components", "admin", "v2", "communication", "webinars", "session-console");
const semComentarios = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const fonte = (name) => semComentarios(readFileSync(join(consoleDir, name), "utf8"));

test("o console pede o modo ao iframe antes do pedido de gravar, e cada circulo pede o seu", () => {
  const main = fonte("session-console.tsx");
  const record = main.slice(main.indexOf("function recordNow(mode: RecordingMode)"), main.indexOf("function stopRecording()"));
  assert.ok(record.indexOf("room.recordingMode.choose(mode);") > 0, "o modo vai ao iframe");
  assert.ok(record.indexOf("room.recordingMode.choose(mode);") < record.indexOf("requestRecording({ sessionId })"), "antes do pedido de gravar");
  assert.match(main, /onRecord=\{\(\) => recordNow\("sala"\)\}/, "o Gravar grava a sala");
  assert.match(main, /onRecordClean=\{\(\) => recordNow\("tela"\)\}/, "o Live gravada grava so a tela");
  assert.match(main, /recorderMode=\{room\.recordingMode\.applied\}/, "o cartao Gravação diz o que o gravador aplicou");
});

test("o gancho do modo: o pedido pela mensagem do iframe, de novo a cada iframe na sala, a sala de volta quando a gravacao para e o aviso so do proprio iframe", () => {
  const hook = fonte("use-recording-mode.ts");
  assert.match(hook, /return post\(recordingModeMessage\(mode\)\);/);
  assert.match(hook, /if \(!joined \|\| !chosenRef\.current\) \{/, "o pedido volta quando o iframe entra na sala");
  assert.match(hook, /if \(wasRecording\.current && !recording && chosenRef\.current === "tela"\) \{\s*choose\("sala"\);/, "a gravacao parou: a sala");
  assert.match(hook, /if \(event\.origin !== origin \|\| !source \|\| event\.source !== source\) \{\s*return;/, "so do proprio iframe, pela origem do motor");
  assert.match(hook, /window\.sessionStorage\.(getItem|setItem)\(`\$\{STORAGE_PREFIX\}\$\{sessionId\}`/, "a escolha guardada por sessao, so na aba");
  const panel = fonte("live-room-panel.tsx");
  assert.match(panel, /useRecordingMode\(\{[\s\S]*?post: meet\.postToFrame,[\s\S]*?recording: room\.recording\.on,/);
});
