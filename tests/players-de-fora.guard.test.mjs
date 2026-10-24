import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// Guardas da ponte com os players de fora (docs/29 §4.4 e §5; docs/18 §2.2: conferencia de texto so para
// regra de seguranca e de arquitetura). O comportamento esta em tests/players-de-fora.test.mjs e nos testes de
// ponta a ponta: aqui so o que nao pode mudar sem ninguem perceber (nada de "*", nada de SDK nem script de fora,
// origens exatas, o referrer que os receptores do Player.js exigem, o iframe por estado e a CSP).

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");
/** O codigo sem os comentarios (os comentarios explicam o "*" que o codigo nunca usa). */
const semComentarios = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const bridgeSource = semComentarios(await source("../src/lib/lesson-embed-bridge.ts"));
const originsSource = semComentarios(await source("../src/lib/lesson-embed-origins.ts"));
const signalSource = await source("../src/lib/lesson-media-signal.ts");
const hookSource = await source("../src/components/use-lesson-embed-bridge.ts");
const lessonSource = await source("../src/components/lesson-experience.tsx");
const nextConfigSource = await source("../next.config.ts");
const proxySource = await source("../src/proxy.ts");
const packageJson = JSON.parse(await source("../package.json"));
const bridge = await import("../src/lib/lesson-embed-bridge.ts");

test("guarda: a ponte nunca manda com '*', nao carrega script de fora e nao escreve HTML", () => {
  assert.doesNotMatch(bridgeSource, /postMessage\([^)]*["'`]\*["'`]/);
  assert.doesNotMatch(bridgeSource, /["'`]\*["'`]/, "nenhum '*' no modulo");
  assert.doesNotMatch(originsSource, /["'`]\*["'`]|postMessage/, "nem no das origens");
  assert.doesNotMatch(bridgeSource, /<script/i);
  assert.doesNotMatch(bridgeSource, /import\(\s*["'`]https?:/);
  assert.doesNotMatch(bridgeSource, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(bridgeSource, /\bfetch\(|XMLHttpRequest|sendBeacon/, "nenhum pedido de rede");
  // A unica chamada de postMessage usa a origem guardada (a do src ou a de quem respondeu, sempre do grupo).
  assert.deepEqual(bridgeSource.match(/postMessage\([^)]*\)/g), ["postMessage(message, sendOrigin)"]);
  assert.doesNotMatch(hookSource, /postMessage|addEventListener\("message"/, "o hook so liga e desliga a sessao");
});

test("guarda: as quatro origens https exatas, nos tres grupos; a conferencia da mensagem exige o proprio iframe", () => {
  assert.deepEqual(
    bridge.EMBED_BRIDGE_GROUPS.map((group) => ({ origins: [...group.origins], protocol: group.protocol })),
    [
      { origins: ["https://iframe.mediadelivery.net", "https://player.mediadelivery.net"], protocol: "playerjs" },
      { origins: ["https://player.mux.com"], protocol: "playerjs" },
      { origins: ["https://player.vimeo.com"], protocol: "vimeo" }
    ]
  );
  for (const code of [bridgeSource, originsSource]) {
    assert.doesNotMatch(code, /\.endsWith\(|hostname\.includes|origin\.includes|\.indexOf\(\s*["'`]\./, "nunca endsWith/includes no host");
  }

  assert.match(originsSource, /candidate\.origins\.includes\(url\.origin\)/, "a origem inteira do src, comparada com a lista");
  assert.match(bridgeSource, /frame === null \|\| event\.source !== frame \|\| !target\.origins\.includes\(event\.origin\)/);
  assert.match(bridgeSource, /const frame = iframe\.contentWindow;/);
});

test("guarda: o iframe do palco manda o referrer e mantem allow-same-origin; o Next manda Referrer-Policy; a ponte recebe o elemento por estado", () => {
  const iframe = lessonSource.slice(lessonSource.indexOf("<iframe\n"), lessonSource.indexOf("/>", lessonSource.indexOf("<iframe\n")));

  assert.match(iframe, /referrerPolicy="strict-origin-when-cross-origin"/);
  assert.match(iframe, /"allow-same-origin allow-scripts allow-presentation allow-popups"/);
  assert.match(iframe, /\? youtubeIframeRef\s*: setEmbedIframe/);
  assert.match(nextConfigSource, /key: "Referrer-Policy",\s*value: "strict-origin-when-cross-origin"/);

  const call = lessonSource.slice(lessonSource.indexOf("const embedBridge = useLessonEmbedBridge({"));
  const enabled = /enabled: ([^\n]+),\n/.exec(call)?.[1] ?? "";

  assert.match(enabled, /canRenderEmbeddedPlayer/);
  assert.match(enabled, /!isActiveLessonLocked/);
  assert.match(call, /iframe: embedIframe,/);
  assert.match(lessonSource, /const \[embedIframe, setEmbedIframe\] = useState<HTMLIFrameElement \| null>\(null\);/);
  assert.doesNotMatch(lessonSource, /useRef<HTMLIFrameElement>\(null\);[^\n]*embed/i, "um RefObject nao refaz o render");
  assert.ok(
    lessonSource.indexOf("const embedBridge = useLessonEmbedBridge({") < lessonSource.indexOf("if (!activeLesson) {\n    return ("),
    "o hook vem antes do retorno da aula vazia (regra dos hooks)"
  );
  // O cronometro inventado de 15 s nao roda com a ponte confirmada.
  assert.match(lessonSource, /activeLesson\.video\?\.provider === "youtube" \|\|\s*embedBridge\.bridge === "confirmed"\s*\) \{\s*return;/);
});

test("guarda: nenhum SDK de player no package.json", () => {
  const deps = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });

  assert.deepEqual(deps.filter((name) => name === "@vimeo/player" || name === "player.js" || name.startsWith("@mux/") || /bunny/i.test(name)), []);
});

test("guarda: a CSP nao ganhou origem nova em script-src", () => {
  const scriptSrc = proxySource.split("\n").find((line) => line.includes("`script-src 'self'"));

  assert.ok(scriptSrc, "a linha do script-src");
  assert.match(scriptSrc, /\["https:\/\/www\.youtube\.com", \.\.\.observabilityScriptSources\]/);
  assert.doesNotMatch(scriptSrc, /vimeo|mediadelivery|mux|bunny/i);
});

test("guarda: o sinal da aula (em toda pagina, com o host do pop-up) nao carrega a ponte nem a lista de origens; a aula marca o palco", () => {
  assert.doesNotMatch(signalSource, /^import \{[^}]*\} from "\.\/lesson-embed-(bridge|origins)";/m, "da ponte, so tipos");
  assert.match(signalSource, /^import type \{ EmbedBridge \} from "\.\/lesson-embed-bridge";/m);
  assert.match(
    lessonSource,
    /data-lesson-player-bridge=\{activePlayerRenderConfig\?\.kind === "iframe" && !usesCustomYouTubeControls && embedBridgeTarget\(activePlayerRenderConfig\.src\) \? "" : undefined\}/,
    "o mesmo src do iframe do palco"
  );
  assert.match(bridgeSource, /export \{ EMBED_BRIDGE_GROUPS, EMBED_BRIDGE_RULES, embedBridgeTarget, type EmbedProtocol \} from "\.\/lesson-embed-origins";/);
  // O codigo da ponte so baixa na aula com player da lista (import() no hook): fora do JS inicial.
  assert.match(hookSource, /const loadBridge = \(\) => import\("@\/lib\/lesson-embed-bridge"\);/);
  assert.doesNotMatch(hookSource, /^import \{[^}]*\} from "@\/lib\/lesson-embed-bridge";/m, "da ponte, so tipos");
  assert.doesNotMatch(lessonSource, /^import \{[^}]*\} from "@\/lib\/lesson-embed-bridge";/m);
});
