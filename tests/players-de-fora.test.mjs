import assert from "node:assert/strict";
import test from "node:test";
import "./support/resolve-extensionless-ts.mjs";

// A ponte com os players de fora da aula (docs/29 §5.5; src/lib/lesson-embed-bridge.ts): quais origens ligam
// (exatas, a Bunny em grupo de duas), quais mensagens passam (so do proprio iframe e do grupo), o que se le delas
// sem confiar no formato (Vimeo e Player.js), o aperto de mao repetido com a targetOrigin exata, a confirmacao so
// pela resposta do getPaused (tambem de um ready tardio, e do Vimeo ja carregado que so responde o ping), o fim
// sem resposta, o `load` que recomeca, o desligar, e a sessao da pagina da aula (a logica do hook): religa so
// quando o iframe, a aula, o src ou o ligado mudam, anuncia ao pop-up so quando a ponte, o tocar ou a tela cheia
// mudam e chama os callbacks so com a ponte confirmada. Janela, iframe e relogio de mentira; nada de rede.

const bridge = await import("../src/lib/lesson-embed-bridge.ts");

const VIMEO = "https://player.vimeo.com/video/76979871?h=abc";
const BUNNY = "https://iframe.mediadelivery.net/embed/123/abc";
const BUNNY_NOVO = "https://player.mediadelivery.net";
const MUX = "https://player.mux.com/abcdef";

const pjs = (event, extra = {}) => JSON.stringify({ context: "player.js", event, version: "0.1.0", ...extra });

function janelaDeMentira() {
  return Object.assign(new EventTarget(), {
    clearInterval: (id) => clearInterval(id),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (callback, ms) => setInterval(callback, ms),
    setTimeout: (callback, ms) => setTimeout(callback, ms)
  });
}

/** Liga a ponte a um iframe de mentira; `mensagem` simula o player mandando para a pagina. */
function ligar({ src = VIMEO, win = janelaDeMentira() } = {}) {
  const enviados = [];
  const janelaDoPlayer = { postMessage: (message, targetOrigin) => enviados.push({ message, targetOrigin }) };
  const iframe = Object.assign(new EventTarget(), { contentWindow: janelaDoPlayer });
  const target = bridge.embedBridgeTarget(src);
  const mudancas = [];
  const desligar = bridge.connectEmbedBridge({ iframe, onChange: (state, message) => mudancas.push({ message, state }), target, win });
  const mensagem = (data, { origin = target.sendOrigin, source = janelaDoPlayer } = {}) =>
    win.dispatchEvent(Object.assign(new Event("message"), { data, origin, source }));

  return {
    desligar,
    enviados,
    estado: () => mudancas.at(-1)?.state ?? bridge.EMBED_BRIDGE_START,
    iframe,
    janelaDoPlayer,
    mensagem,
    mudancas,
    target,
    win
  };
}

const textos = (enviados) => enviados.map(({ message }) => (typeof message === "string" ? JSON.parse(message) : message));

// --- Origens -------------------------------------------------------------------------------------------

test("embedBridgeTarget: as quatro origens exatas (a Bunny devolve o grupo das duas); o resto nao liga", () => {
  assert.deepEqual(bridge.embedBridgeTarget(VIMEO), { origins: ["https://player.vimeo.com"], protocol: "vimeo", sendOrigin: "https://player.vimeo.com" });
  assert.deepEqual(bridge.embedBridgeTarget(MUX), { origins: ["https://player.mux.com"], protocol: "playerjs", sendOrigin: "https://player.mux.com" });

  const grupo = ["https://iframe.mediadelivery.net", "https://player.mediadelivery.net"];
  assert.deepEqual(bridge.embedBridgeTarget(BUNNY), { origins: grupo, protocol: "playerjs", sendOrigin: "https://iframe.mediadelivery.net" });
  assert.deepEqual(bridge.embedBridgeTarget(`${BUNNY_NOVO}/play/1/2`), { origins: grupo, protocol: "playerjs", sendOrigin: BUNNY_NOVO });

  for (const src of [
    "https://evil.player.vimeo.com/video/1",
    "https://player.vimeo.com.evil.com/video/1",
    "http://player.vimeo.com/video/1",
    "https://vimeo.com/76979871",
    "https://player.vimeo.com:8443/video/1",
    "https://user:senha@player.vimeo.com/video/1",
    "https://user@iframe.mediadelivery.net/embed/1",
    "https://www.youtube-nocookie.com/embed/abc",
    "/embed/relativo",
    "isto nao e endereco",
    "",
    null,
    undefined
  ]) {
    assert.equal(bridge.embedBridgeTarget(src), null, String(src));
  }

  assert.equal(bridge.embedBridgeTarget("https://PLAYER.VIMEO.COM/video/1")?.sendOrigin, "https://player.vimeo.com", "o navegador normaliza o host");
});

// --- Quem pode mandar ----------------------------------------------------------------------------------

test("mensagem: so do proprio iframe e das origens do grupo; iframe desmontado e source null nao passam", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const ponte = ligar();
  const outroIframe = { postMessage: () => undefined };

  ponte.mensagem({ event: "ready" }, { source: outroIframe });
  ponte.mensagem({ event: "ready" }, { origin: "https://evil.example" });
  ponte.mensagem({ event: "ready" }, { origin: "https://player.vimeo.com.evil.com" });
  ponte.mensagem({ event: "ready" }, { source: null });
  assert.equal(textos(ponte.enviados).filter((m) => m.method === "addEventListener").length, 0, "nada foi aceito");

  // O iframe desmontado: contentWindow null e um MessageEvent sintetico com source null.
  ponte.iframe.contentWindow = null;
  ponte.mensagem({ event: "ready" }, { source: null });
  ponte.mensagem({ method: "getPaused", value: false }, { source: null });
  assert.equal(ponte.mudancas.length, 0);
  ponte.desligar();
});

test("Bunny: src em iframe.mediadelivery.net e mensagens de player.mediadelivery.net (o mesmo iframe) passam e viram a targetOrigin; o Mux nao aceita a Bunny", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const bunny = ligar({ src: BUNNY });

  assert.equal(bunny.enviados[0].targetOrigin, "https://iframe.mediadelivery.net", "antes da primeira mensagem: a origem do src");
  bunny.mensagem(pjs("ready", { value: { src: "https://outro.exemplo" } }), { origin: BUNNY_NOVO });

  const depois = bunny.enviados.slice(1);
  assert.ok(depois.length >= 5, "inscricoes e a pergunta");
  assert.ok(depois.every(({ targetOrigin }) => targetOrigin === BUNNY_NOVO), "daqui para frente, a origem de quem respondeu");

  bunny.mensagem(pjs("getPaused", { listener: "b707-paused", value: true }), { origin: BUNNY_NOVO });
  assert.equal(bunny.estado().bridge, "confirmed");

  // O `load` do iframe chega depois do ready do host novo: o aperto de mao de novo vai para quem respondeu.
  const antesDoLoad = bunny.enviados.length;
  bunny.iframe.dispatchEvent(new Event("load"));
  assert.deepEqual(bunny.enviados.slice(antesDoLoad).map(({ targetOrigin }) => targetOrigin), [BUNNY_NOVO]);
  bunny.desligar();

  const mux = ligar({ src: MUX });
  mux.mensagem(pjs("ready"), { origin: BUNNY_NOVO });
  mux.mensagem(pjs("getPaused", { value: true }), { origin: BUNNY_NOVO });
  assert.equal(mux.mudancas.length, 0, "outro grupo");
  assert.ok(mux.enviados.every(({ targetOrigin }) => targetOrigin === "https://player.mux.com"));
  mux.desligar();
});

// --- O que se le ----------------------------------------------------------------------------------------

test("parseEmbedMessage: Player.js sem confiar no formato", () => {
  const ler = (data) => bridge.parseEmbedMessage("playerjs", data);

  assert.deepEqual(ler(pjs("ready", { value: { events: ["play"] } })), { kind: "ready" });
  assert.deepEqual(ler(pjs("play")), { kind: "play" });
  assert.deepEqual(ler(pjs("pause")), { kind: "pause" });
  assert.deepEqual(ler(pjs("ended")), { duration: null, kind: "ended", seconds: null });
  assert.deepEqual(ler(pjs("timeupdate", { value: { duration: 120, seconds: 12.5 } })), { duration: 120, kind: "time", seconds: 12.5 });
  assert.deepEqual(
    ler(pjs("timeupdate", { value: JSON.stringify({ duration: 120, seconds: 3 }) })),
    { duration: 120, kind: "time", seconds: 3 },
    "a Bunny legada manda o value como texto JSON"
  );
  assert.deepEqual(ler(pjs("getPaused", { listener: "b707-paused", value: false })), { kind: "paused_answer", paused: false });
  assert.deepEqual(ler({ context: "player.js", event: "play" }), { kind: "play" }, "objeto tambem");

  assert.equal(ler(`${pjs("play")}${" ".repeat(4_100)}`), null, "texto acima de 4.096 nem e lido");
  assert.equal(ler("{quebrado"), null);
  assert.equal(ler(JSON.stringify({ context: "outro", event: "play" })), null, "context errado");
  assert.equal(ler(JSON.stringify({ event: "play" })), null, "sem context");
  assert.equal(ler(pjs("seeked")), null, "evento fora da lista");
  assert.equal(ler(pjs("getPaused", { value: "true" })), null, "getPaused precisa de booleano");
  assert.equal(ler(pjs("timeupdate", { value: { seconds: -1 } })), null, "negativo");
  assert.equal(ler(pjs("timeupdate", { value: { seconds: "12" } })), null, "texto");
  assert.equal(ler(pjs("timeupdate", { value: { seconds: 86_401 } })), null, "acima de 24 h");
  assert.deepEqual(ler(pjs("timeupdate", { value: { duration: -5, seconds: 4 } })), { duration: null, kind: "time", seconds: 4 }, "duracao ruim vira null");
  assert.equal(ler(JSON.stringify({ context: "player.js", method: "play" })), null, "comando (method) nao e evento");
  assert.equal(ler(null), null);
  assert.equal(ler(42), null);
  assert.equal(ler([pjs("play")]), null);
});

test("parseEmbedMessage: Vimeo como objeto e como texto; ping vira ready e o erro de carga vira ready_error", () => {
  const ler = (data) => bridge.parseEmbedMessage("vimeo", data);

  assert.deepEqual(ler({ event: "ready" }), { kind: "ready" });
  assert.deepEqual(ler(JSON.stringify({ event: "ready", player_id: "x" })), { kind: "ready" });
  assert.deepEqual(ler({ method: "ping" }), { kind: "ready" }, "o player ja carregado responde o ping assim");
  assert.deepEqual(ler({ data: { method: "ready", message: "x" }, event: "error" }), { kind: "ready_error" });
  assert.equal(ler({ data: { method: "getPaused" }, event: "error" }), null, "outro erro nao derruba a ponte");
  assert.deepEqual(ler({ data: { duration: 60, percent: 0.1, seconds: 6 }, event: "play" }), { kind: "play" });
  assert.deepEqual(ler({ event: "playing" }), { kind: "play" });
  assert.deepEqual(ler({ data: { seconds: 6 }, event: "pause" }), { kind: "pause" });
  assert.deepEqual(ler({ data: { duration: 60, seconds: 60 }, event: "ended" }), { duration: 60, kind: "ended", seconds: 60 });
  assert.deepEqual(ler(JSON.stringify({ data: { duration: 60, seconds: 7.25 }, event: "timeupdate" })), { duration: 60, kind: "time", seconds: 7.25 });
  assert.deepEqual(ler({ data: { fullscreen: true }, event: "fullscreenchange" }), { fullscreen: true, kind: "fullscreen" });
  assert.deepEqual(ler({ method: "getPaused", value: true }), { kind: "paused_answer", paused: true });

  assert.equal(ler({ data: { fullscreen: "sim" }, event: "fullscreenchange" }), null);
  assert.equal(ler({ data: { seconds: Number.POSITIVE_INFINITY }, event: "timeupdate" }), null, "Infinity");
  assert.equal(ler({ event: "volumechange" }), null);
  assert.equal(ler({ method: "getPaused", value: 0 }), null);
  assert.equal(ler(JSON.stringify({ event: "ready" }).padEnd(4_200, " ")), null, "texto acima de 4.096");
});

// --- Aperto de mao e confirmacao ------------------------------------------------------------------------

test("aperto de mao: ate 12 vezes, a cada 400 ms, sempre com a targetOrigin exata; para no ready; inscricoes com listener (Player.js)", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const ponte = ligar({ src: MUX });
  const apertos = () => textos(ponte.enviados).filter((m) => m.method === "addEventListener" && m.value === "ready");

  assert.equal(apertos().length, 1, "o primeiro sai na hora");
  t.mock.timers.tick(400 * 5);
  assert.equal(apertos().length, 6);
  assert.deepEqual(apertos()[0], { context: "player.js", listener: "b707-ready", method: "addEventListener", value: "ready", version: "0.0.11" });

  ponte.mensagem(pjs("ready"));
  t.mock.timers.tick(400 * 10);
  assert.equal(apertos().length, 6, "parou no ready");

  const inscricoes = textos(ponte.enviados).filter((m) => m.method === "addEventListener" && m.value !== "ready");
  assert.deepEqual(inscricoes.map((m) => [m.value, m.listener]), [["play", "b707-play"], ["pause", "b707-pause"], ["ended", "b707-ended"], ["timeupdate", "b707-timeupdate"]]);
  assert.ok(ponte.enviados.every(({ targetOrigin }) => targetOrigin === "https://player.mux.com"), "nunca '*'");
  assert.ok(textos(ponte.enviados).some((m) => m.method === "getPaused" && m.listener === "b707-paused"));
  ponte.desligar();

  // Vimeo: o aperto e { method: "ping" } (objeto), ate 12 vezes, e depois disso a ponte fica sem resposta.
  const vimeo = ligar();
  t.mock.timers.tick(400 * 20);
  assert.equal(vimeo.enviados.length, 12);
  assert.ok(vimeo.enviados.every(({ message, targetOrigin }) => message.method === "ping" && targetOrigin === "https://player.vimeo.com"));
  assert.equal(vimeo.estado().bridge, "silent", "12 apertos sem resposta");
  vimeo.desligar();
});

test("ready tardio (depois dos 12 apertos, com a ponte ja sem resposta) ainda inscreve, pergunta e confirma", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const ponte = ligar({ src: BUNNY });

  t.mock.timers.tick(5_000);
  assert.equal(ponte.estado().bridge, "silent");

  // A Bunny legada so cria o receptor no loadeddata (no iPhone, depois do play): o ready chega agora.
  ponte.mensagem(pjs("ready"));
  assert.ok(textos(ponte.enviados).some((m) => m.method === "getPaused"), "perguntou depois do ready tardio");
  ponte.mensagem(pjs("getPaused", { listener: "b707-paused", value: false }));
  assert.equal(ponte.estado().bridge, "confirmed");
  assert.equal(ponte.estado().playing, true, "ja tocava (deu play antes do ready)");
  ponte.desligar();
});

test("Vimeo ja carregado: nenhum {event:'ready'}, so a resposta {method:'ping'} ao aperto de mao inscreve, pergunta e confirma", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const ponte = ligar();

  ponte.mensagem({ method: "ping" });
  const depois = textos(ponte.enviados).slice(1);
  assert.deepEqual(
    depois.filter((m) => m.method === "addEventListener").map((m) => m.value),
    ["play", "pause", "ended", "timeupdate", "fullscreenchange"]
  );
  assert.ok(depois.some((m) => m.method === "getPaused"));
  assert.equal(ponte.estado().bridge, "pending", "ainda nao respondeu a pergunta");

  ponte.mensagem({ method: "getPaused", value: true });
  assert.equal(ponte.estado().bridge, "confirmed");
  assert.equal(ponte.estado().playing, false);
  ponte.desligar();
});

test("confirmacao so pela resposta do getPaused; a pergunta repete ate 12 vezes; o erro de carga e o prazo de 15 s acabam sem resposta", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const ponte = ligar({ src: MUX });
  const perguntas = () => textos(ponte.enviados).filter((m) => m.method === "getPaused").length;

  ponte.mensagem(pjs("ready"));
  ponte.mensagem(pjs("play"));
  assert.equal(ponte.estado().bridge, "pending", "o ready e os eventos nao confirmam (sem referrer o ready sai mesmo assim)");
  assert.equal(ponte.estado().playing, true);
  t.mock.timers.tick(400 * 3);
  assert.equal(perguntas(), 4);
  t.mock.timers.tick(400 * 20);
  assert.equal(perguntas(), 12, "no maximo 12");
  assert.equal(ponte.estado().bridge, "silent", "o receptor recusou todo comando: nenhuma resposta");
  ponte.desligar();

  const comErro = ligar();
  comErro.mensagem({ data: { method: "ready" }, event: "error" });
  assert.equal(comErro.estado().bridge, "silent");
  comErro.desligar();

  // Temporizadores repetidos congelados (aba escondida): so o prazo de 15 s acaba com a espera.
  const congelada = Object.assign(janelaDeMentira(), { setInterval: () => 0 });
  const lenta = ligar({ win: congelada });
  t.mock.timers.tick(14_999);
  assert.equal(lenta.estado().bridge, "pending");
  t.mock.timers.tick(1);
  assert.equal(lenta.estado().bridge, "silent");
  lenta.desligar();
});

test("reduceEmbedState: play em dobro nao muda nada; ended para e guarda o tempo; tempo nao mexe no tocar", () => {
  const confirmado = bridge.reduceEmbedState(bridge.EMBED_BRIDGE_START, { kind: "paused_answer", paused: true });
  const tocando = bridge.reduceEmbedState(confirmado, { kind: "play" });

  assert.deepEqual(confirmado, { ...bridge.EMBED_BRIDGE_START, bridge: "confirmed" });
  assert.equal(bridge.reduceEmbedState(tocando, { kind: "play" }), tocando, "o play em dobro da Bunny: o mesmo objeto");
  assert.equal(bridge.reduceEmbedState(tocando, { duration: null, kind: "time", seconds: 4 }).playing, true);

  const fim = bridge.reduceEmbedState(tocando, { duration: 60, kind: "ended", seconds: 60 });
  assert.deepEqual(fim, { bridge: "confirmed", duration: 60, ended: true, fullscreen: false, playing: false, seconds: 60 });
  assert.equal(bridge.reduceEmbedState(fim, { duration: null, kind: "ended", seconds: null }), fim, "ended repetido");
  assert.equal(bridge.reduceEmbedState(fim, { kind: "play" }).ended, false);
  assert.equal(bridge.reduceEmbedState(tocando, { fullscreen: true, kind: "fullscreen" }).fullscreen, true);
  assert.equal(bridge.reduceEmbedState(tocando, { kind: "ready_error" }).bridge, "silent");
  assert.equal(bridge.reduceEmbedState(tocando, { kind: "ready" }), tocando);
  assert.ok(Object.isFrozen(bridge.EMBED_BRIDGE_START));
});

test("o load do iframe zera (volta a pending, com prazo novo) e recomeca; desligar tira ouvinte, intervalos e prazo", (t) => {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  const ponte = ligar();

  ponte.mensagem({ event: "ready" });
  ponte.mensagem({ method: "getPaused", value: false });
  assert.equal(ponte.estado().bridge, "confirmed");

  const antes = ponte.enviados.length;
  ponte.iframe.dispatchEvent(new Event("load"));
  assert.deepEqual(ponte.estado(), bridge.EMBED_BRIDGE_START, "documento novo: pendente de novo");
  assert.equal(textos(ponte.enviados.slice(antes))[0].method, "ping", "recomecou o aperto de mao");

  t.mock.timers.tick(14_000);
  assert.equal(ponte.estado().bridge, "silent");

  ponte.desligar();
  const depois = ponte.enviados.length;
  const mudancas = ponte.mudancas.length;
  t.mock.timers.tick(60_000);
  ponte.mensagem({ event: "ready" });
  ponte.iframe.dispatchEvent(new Event("load"));
  assert.equal(ponte.enviados.length, depois, "nada mais sai");
  assert.equal(ponte.mudancas.length, mudancas, "nada mais muda");
});

// --- A sessao da pagina da aula (a logica do hook) -------------------------------------------------------

function sessao(t) {
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  let agora = 1_000_000;
  const anuncios = [];
  const chamadas = [];
  const feitos = (nome) => ({
    onEnded: (info) => chamadas.push([nome, "ended", info]),
    onPause: (info) => chamadas.push([nome, "pause", info]),
    onPlay: () => chamadas.push([nome, "play"]),
    onTime: (info) => chamadas.push([nome, "time", info])
  });
  let callbacks = feitos("v1");
  const win = janelaDeMentira();
  const s = bridge.createEmbedBridgeSession({
    announce: (signal) => anuncios.push(signal),
    callbacks: () => callbacks,
    now: () => agora,
    win
  });
  const enviados = [];
  const novoIframe = () => {
    const janelaDoPlayer = { postMessage: (message, targetOrigin) => enviados.push({ message, targetOrigin }) };
    return Object.assign(new EventTarget(), { contentWindow: janelaDoPlayer });
  };
  const mensagem = (iframe, data) => win.dispatchEvent(Object.assign(new Event("message"), { data, origin: "https://player.vimeo.com", source: iframe.contentWindow }));

  return {
    andar: (ms) => {
      agora += ms;
      t.mock.timers.tick(ms);
    },
    anuncios,
    chamadas,
    enviados,
    mensagem,
    novoIframe,
    s,
    trocarCallbacks: (nome) => {
      callbacks = feitos(nome);
    }
  };
}

test("sessao: sem iframe nada liga; o iframe montado depois liga e anuncia pending; o mesmo set nao repete nada", (t) => {
  const { anuncios, enviados, novoIframe, s } = sessao(t);
  const base = { enabled: true, iframe: null, lessonId: "aula-1", src: VIMEO };

  s.set(base);
  assert.deepEqual(anuncios, []);
  assert.equal(enviados.length, 0);

  const iframe = novoIframe();
  s.set({ ...base, iframe });
  assert.deepEqual(anuncios, [{ bridge: "pending", fullscreen: false, lessonId: "aula-1", playing: false }]);
  assert.equal(enviados.length, 1, "um aperto de mao");

  s.set({ ...base, iframe });
  assert.equal(anuncios.length, 1, "nem silent nem pending de novo");
  assert.equal(enviados.length, 1, "nem outro aperto");
  s.stop();
});

test("sessao: callbacks novos nao religam e a proxima mensagem chama os novos; callbacks so com a ponte confirmada", (t) => {
  const { chamadas, enviados, mensagem, novoIframe, s, trocarCallbacks } = sessao(t);
  const iframe = novoIframe();
  const base = { enabled: true, iframe, lessonId: "aula-1", src: VIMEO };

  s.set(base);
  mensagem(iframe, { event: "ready" });
  mensagem(iframe, { event: "play" });
  mensagem(iframe, { data: { seconds: 1 }, event: "timeupdate" });
  assert.deepEqual(chamadas, [], "pendente: so os anuncios");

  mensagem(iframe, { method: "getPaused", value: false });
  assert.deepEqual(chamadas, [["v1", "play"]], "confirmou tocando: o play");

  const enviadosAntes = enviados.length;
  trocarCallbacks("v2");
  s.set({ ...base });
  assert.equal(enviados.length, enviadosAntes, "nada religou");

  mensagem(iframe, { data: { duration: 60, seconds: 10 }, event: "pause" });
  mensagem(iframe, { data: { duration: 60, seconds: 60 }, event: "ended" });
  assert.deepEqual(chamadas.slice(1), [
    // O pause leva o ultimo tempo que a ponte guardou (o timeupdate de 1 s, sem duracao).
    ["v2", "pause", { duration: null, seconds: 1 }],
    ["v2", "ended", { duration: 60, seconds: 60 }]
  ]);
  s.stop();
});

test("sessao: trocar de aula anuncia silent (sem tocar) da anterior e pending da nova; desligar anuncia silent", (t) => {
  const { anuncios, mensagem, novoIframe, s } = sessao(t);
  const primeiro = novoIframe();

  s.set({ enabled: true, iframe: primeiro, lessonId: "aula-1", src: VIMEO });
  mensagem(primeiro, { event: "ready" });
  mensagem(primeiro, { method: "getPaused", value: false });
  assert.deepEqual(anuncios.at(-1), { bridge: "confirmed", fullscreen: false, lessonId: "aula-1", playing: true });

  const segundo = novoIframe();
  s.set({ enabled: true, iframe: segundo, lessonId: "aula-2", src: `${VIMEO}&outra=1` });
  assert.deepEqual(anuncios.slice(-2), [
    { bridge: "silent", fullscreen: false, lessonId: "aula-1", playing: false },
    { bridge: "pending", fullscreen: false, lessonId: "aula-2", playing: false }
  ]);

  // Mensagem do iframe antigo nao chega mais.
  const total = anuncios.length;
  mensagem(primeiro, { event: "pause" });
  assert.equal(anuncios.length, total);

  s.set({ enabled: false, iframe: segundo, lessonId: "aula-2", src: VIMEO });
  assert.deepEqual(anuncios.at(-1), { bridge: "silent", fullscreen: false, lessonId: "aula-2", playing: false });

  s.set({ enabled: true, iframe: segundo, lessonId: "aula-2", src: VIMEO });
  s.stop();
  assert.deepEqual(anuncios.at(-1), { bridge: "silent", fullscreen: false, lessonId: "aula-2", playing: false });
  s.stop();
  assert.deepEqual(anuncios.at(-1), { bridge: "silent", fullscreen: false, lessonId: "aula-2", playing: false }, "stop de novo nao anuncia nada");

  // Origem fora da lista: nada liga, nada e anunciado.
  const antes = anuncios.length;
  s.set({ enabled: true, iframe: novoIframe(), lessonId: "aula-3", src: "https://player.exemplo.com/v/1" });
  assert.equal(anuncios.length, antes);
  s.stop();
});

test("sessao: onTime no maximo 1 vez por segundo com quatro timeupdate por segundo; o tempo nunca vira anuncio", (t) => {
  const { andar, anuncios, chamadas, mensagem, novoIframe, s } = sessao(t);
  const iframe = novoIframe();

  s.set({ enabled: true, iframe, lessonId: "aula-1", src: VIMEO });
  mensagem(iframe, { event: "ready" });
  mensagem(iframe, { method: "getPaused", value: false });
  const anunciosAntes = anuncios.length;

  for (let quarto = 0; quarto < 12; quarto += 1) {
    mensagem(iframe, { data: { duration: 60, seconds: quarto * 0.25 }, event: "timeupdate" });
    andar(250);
  }

  assert.deepEqual(
    chamadas.filter(([, nome]) => nome === "time").map(([, , info]) => info.seconds),
    [0, 1, 2],
    "3 s de video, 3 chamadas"
  );
  assert.equal(anuncios.length, anunciosAntes, "12 timeupdate, nenhum anuncio");

  mensagem(iframe, { event: "pause" });
  mensagem(iframe, { data: { duration: 60, seconds: 3.5 }, event: "timeupdate" });
  andar(2_000);
  mensagem(iframe, { data: { duration: 60, seconds: 3.6 }, event: "timeupdate" });
  assert.equal(chamadas.filter(([, nome]) => nome === "time").length, 3, "parado: o tempo nao conta");
  s.stop();
});

test("embedAnnouncement e shouldReportTime", () => {
  const base = { bridge: "confirmed", fullscreen: false, playing: true };

  assert.deepEqual(bridge.embedAnnouncement(null, base), base);
  assert.equal(bridge.embedAnnouncement(base, { ...base }), null, "igual: nada");
  assert.deepEqual(bridge.embedAnnouncement(base, { ...base, playing: false }), { ...base, playing: false });
  assert.deepEqual(bridge.embedAnnouncement(base, { ...base, bridge: "silent" }), { ...base, bridge: "silent" });
  assert.deepEqual(bridge.embedAnnouncement(base, { ...base, fullscreen: true }), { ...base, fullscreen: true });
  assert.equal(
    bridge.embedAnnouncement(base, { ...base, seconds: 12 }),
    null,
    "mudou so o tempo (um timeupdate): nada"
  );

  assert.equal(bridge.shouldReportTime(null, 5), true);
  assert.equal(bridge.shouldReportTime(1_000, 1_999), false);
  assert.equal(bridge.shouldReportTime(1_000, 2_000), true);
  assert.equal(bridge.EMBED_BRIDGE_RULES.minTimeReportMs, 1_000);
});
