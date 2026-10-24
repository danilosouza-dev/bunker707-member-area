// Ponte com os players de fora da pagina da aula (Bunny, Vimeo, Mux; docs/29 §4.4): a pagina passa a saber
// quando o video do iframe toca, pausa e acaba, sem SDK de terceiro, sem script de fora e sem mudar a CSP. So
// mensagens entre janelas (postMessage), nos protocolos publicos dos players: o do Vimeo ({ method, value } /
// { event, data }) e o Player.js (Bunny e Mux: texto JSON com context "player.js").
//
// Confianca: aceita mensagem so das origens exatas do grupo do player (a Bunny e um grupo de duas: o src de
// uma aceita mensagens das duas) E do proprio iframe (event.source === iframe.contentWindow, com contentWindow
// nao nulo). Manda sempre com a targetOrigin exata (a origem do src ate a primeira mensagem aceita, depois a
// origem dela; nunca "*"). So conta como "ponte confirmada" depois de uma ida e volta respondida (getPaused):
// o `ready` do Player.js sai ate sem o referrer certo, quando o receptor recusa todo comando. Sem resposta,
// tudo fica como antes (a pagina nao le o player). Qualquer mensagem e lida sem confiar no formato.
//
// Puro: a janela, o iframe e o relogio chegam por parametro (tests/players-de-fora.test.mjs usa de mentira).
// O hook use-lesson-embed-bridge.ts so liga e desliga a sessao (createEmbedBridgeSession). Nenhum pedido de rede.
// As origens e as regras ficam em lesson-embed-origins.ts (reexportadas aqui): o sinal da aula, que vai em toda
// pagina, so carrega aquele pedaco.

import { EMBED_BRIDGE_RULES, embedBridgeTarget, type EmbedProtocol } from "./lesson-embed-origins";

export { EMBED_BRIDGE_GROUPS, EMBED_BRIDGE_RULES, embedBridgeTarget, type EmbedProtocol } from "./lesson-embed-origins";

export type EmbedMessage =
  | { kind: "ready" }
  | { kind: "ready_error" }
  | { kind: "play" }
  | { kind: "pause" }
  | { duration: number | null; kind: "ended"; seconds: number | null }
  | { duration: number | null; kind: "time"; seconds: number }
  | { kind: "paused_answer"; paused: boolean }
  | { fullscreen: boolean; kind: "fullscreen" };

const PLAYERJS_CONTEXT = "player.js";
const PLAYERJS_VERSION = "0.0.11";
const PLAYERJS_EVENTS: readonly string[] = ["ready", "play", "pause", "ended", "timeupdate", "getPaused"];
const VIMEO_EVENTS: readonly string[] = ["ready", "play", "playing", "pause", "ended", "timeupdate", "fullscreenchange"];
/** Os eventos que a ponte pede (o Vimeo tambem avisa a tela cheia; o Player.js nao tem esse evento). */
const PLAYERJS_SUBSCRIPTIONS = ["play", "pause", "ended", "timeupdate"] as const;
const VIMEO_SUBSCRIPTIONS = ["play", "pause", "ended", "timeupdate", "fullscreenchange"] as const;

type Loose = Record<string, unknown>;

function isLoose(value: unknown): value is Loose {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Objeto, ou texto JSON de ate maxMessageChars; o resto nao se le. */
function readObject(data: unknown): Loose | null {
  if (typeof data === "string") {
    if (data.length > EMBED_BRIDGE_RULES.maxMessageChars) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(data);
      return isLoose(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return isLoose(data) ? data : null;
}

/** Segundos finitos entre 0 e maxSeconds; o resto (negativo, Infinity, texto) vira null. */
function secondsOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= EMBED_BRIDGE_RULES.maxSeconds ? value : null;
}

function timing(kind: "ended" | "time", value: unknown): EmbedMessage | null {
  const data = readObject(value);
  const seconds = secondsOf(data?.seconds);
  const duration = secondsOf(data?.duration);

  if (kind === "ended") {
    return { duration, kind: "ended", seconds };
  }

  return seconds === null ? null : { duration, kind: "time", seconds };
}

function pausedAnswer(value: unknown): EmbedMessage | null {
  return typeof value === "boolean" ? { kind: "paused_answer", paused: value } : null;
}

function playerJsMessage(data: Loose): EmbedMessage | null {
  if (data.context !== PLAYERJS_CONTEXT || typeof data.event !== "string" || !PLAYERJS_EVENTS.includes(data.event)) {
    return null;
  }

  switch (data.event) {
    case "ready":
      return { kind: "ready" };
    case "play":
      return { kind: "play" };
    case "pause":
      return { kind: "pause" };
    case "ended":
      return timing("ended", data.value);
    case "timeupdate":
      // A Bunny legada manda o value como texto JSON: readObject aceita os dois.
      return timing("time", data.value);
    default:
      return pausedAnswer(data.value);
  }
}

function vimeoMessage(data: Loose): EmbedMessage | null {
  // O player ja carregado responde ao aperto de mao assim, sem novo `ready` (SDK vimeo/player.js, isPingResponse).
  if (data.method === "ping") {
    return { kind: "ready" };
  }

  if (data.method === "getPaused") {
    return pausedAnswer(data.value);
  }

  if (data.event === "error") {
    return isLoose(data.data) && data.data.method === "ready" ? { kind: "ready_error" } : null;
  }

  if (typeof data.event !== "string" || !VIMEO_EVENTS.includes(data.event)) {
    return null;
  }

  switch (data.event) {
    case "ready":
      return { kind: "ready" };
    case "play":
    case "playing":
      return { kind: "play" };
    case "pause":
      return { kind: "pause" };
    case "ended":
      return timing("ended", data.data);
    case "timeupdate":
      return timing("time", data.data);
    default:
      return isLoose(data.data) && typeof data.data.fullscreen === "boolean" ? { fullscreen: data.data.fullscreen, kind: "fullscreen" } : null;
  }
}

/** Le uma mensagem do player (objeto ou texto), sem confiar no formato. */
export function parseEmbedMessage(protocol: EmbedProtocol, data: unknown): EmbedMessage | null {
  const value = readObject(data);

  if (!value) {
    return null;
  }

  return protocol === "vimeo" ? vimeoMessage(value) : playerJsMessage(value);
}

function playerJsCommand(method: string, extra: { listener: string; value?: string }) {
  return JSON.stringify({ context: PLAYERJS_CONTEXT, version: PLAYERJS_VERSION, method, ...extra });
}

/** O aperto de mao, ja no formato do protocolo (objeto no Vimeo, texto JSON no Player.js). */
export function embedHandshake(protocol: EmbedProtocol): unknown {
  return protocol === "vimeo"
    ? { method: "ping" }
    : playerJsCommand("addEventListener", { value: "ready", listener: "b707-ready" });
}

/** As inscricoes nos eventos (no Player.js sempre com `listener`: a Bunny nova ignora sem). */
export function embedSubscriptions(protocol: EmbedProtocol): unknown[] {
  return protocol === "vimeo"
    ? VIMEO_SUBSCRIPTIONS.map((value) => ({ method: "addEventListener", value }))
    : PLAYERJS_SUBSCRIPTIONS.map((value) => playerJsCommand("addEventListener", { value, listener: `b707-${value}` }));
}

/** A pergunta "esta pausado?": a resposta e o que confirma a ponte. */
export function embedAskPaused(protocol: EmbedProtocol): unknown {
  return protocol === "vimeo" ? { method: "getPaused" } : playerJsCommand("getPaused", { listener: "b707-paused" });
}

export type EmbedBridge = "confirmed" | "pending" | "silent";

export type EmbedBridgeState = {
  bridge: EmbedBridge;
  duration: number | null;
  ended: boolean;
  fullscreen: boolean;
  playing: boolean;
  seconds: number | null;
};

export const EMBED_BRIDGE_START: EmbedBridgeState = Object.freeze({
  bridge: "pending",
  duration: null,
  ended: false,
  fullscreen: false,
  playing: false,
  seconds: null
});

function withChanges(state: EmbedBridgeState, changes: Partial<EmbedBridgeState>): EmbedBridgeState {
  const keys = Object.keys(changes) as (keyof EmbedBridgeState)[];

  return keys.some((key) => state[key] !== changes[key]) ? { ...state, ...changes } : state;
}

/** O estado depois da mensagem; repetida (o `play` em dobro da Bunny) devolve o mesmo objeto. */
export function reduceEmbedState(state: EmbedBridgeState, message: EmbedMessage): EmbedBridgeState {
  switch (message.kind) {
    case "play":
      return withChanges(state, { ended: false, playing: true });
    case "pause":
      return withChanges(state, { playing: false });
    case "ended":
      return withChanges(state, {
        duration: message.duration ?? state.duration,
        ended: true,
        playing: false,
        seconds: message.seconds ?? state.seconds
      });
    case "time":
      return withChanges(state, { duration: message.duration ?? state.duration, seconds: message.seconds });
    case "paused_answer":
      return withChanges(state, message.paused ? { bridge: "confirmed", playing: false } : { bridge: "confirmed", ended: false, playing: true });
    case "ready_error":
      return withChanges(state, { bridge: "silent" });
    case "fullscreen":
      return withChanges(state, { fullscreen: message.fullscreen });
    default:
      return state;
  }
}

/** O que anunciar ao pop-up: so quando a ponte, o tocar ou a tela cheia mudam (tempo e duracao nunca). */
export type EmbedAnnouncement = { bridge: EmbedBridge; fullscreen: boolean; playing: boolean };

export function embedAnnouncement(previous: EmbedAnnouncement | null, next: EmbedAnnouncement): EmbedAnnouncement | null {
  if (previous && previous.bridge === next.bridge && previous.fullscreen === next.fullscreen && previous.playing === next.playing) {
    return null;
  }

  return { bridge: next.bridge, fullscreen: next.fullscreen, playing: next.playing };
}

/** onTime no maximo 1 vez por minTimeReportMs. */
export function shouldReportTime(lastReportedAt: number | null, now: number): boolean {
  return lastReportedAt === null || now - lastReportedAt >= EMBED_BRIDGE_RULES.minTimeReportMs;
}

type BridgeWindow = Pick<Window, "addEventListener" | "clearInterval" | "clearTimeout" | "removeEventListener" | "setInterval" | "setTimeout">;
type BridgeIframe = Pick<HTMLIFrameElement, "addEventListener" | "contentWindow" | "removeEventListener">;
type BridgeTarget = NonNullable<ReturnType<typeof embedBridgeTarget>>;

/**
 * Liga a ponte a um iframe: ouve `message` na janela (so origem do grupo e event.source === iframe.contentWindow,
 * com contentWindow nao nulo), manda o aperto de mao repetido, registra os eventos depois do ready (tambem de um
 * ready que chega tarde) e pergunta getPaused ate a primeira resposta (= confirmada). A targetOrigin e a origem do
 * src ate a primeira mensagem aceita; depois, a origem dela (sempre do grupo, nunca "*"). Recomeca no `load` do
 * iframe. Devolve a funcao que desliga tudo.
 */
export function connectEmbedBridge(input: {
  iframe: BridgeIframe;
  now?: () => number;
  onChange: (state: EmbedBridgeState, message: EmbedMessage | null) => void;
  target: BridgeTarget;
  win: BridgeWindow;
}): () => void {
  const { iframe, onChange, target, win } = input;
  let state: EmbedBridgeState = EMBED_BRIDGE_START;
  let sendOrigin = target.sendOrigin;
  let handshakeTimer: ReturnType<typeof win.setInterval> | null = null;
  let askTimer: ReturnType<typeof win.setInterval> | null = null;
  let deadline: ReturnType<typeof win.setTimeout> | null = null;
  let stopped = false;

  function post(message: unknown) {
    const frame = iframe.contentWindow;

    if (!frame) {
      return;
    }

    try {
      frame.postMessage(message, sendOrigin);
    } catch {
      // Janela trocando de documento: a proxima tentativa (ou o `load`) manda de novo.
    }
  }

  function update(next: EmbedBridgeState, message: EmbedMessage | null) {
    if (next === state) {
      return;
    }

    state = next;
    onChange(state, message);
  }

  /** Acabaram as tentativas (ou o prazo) sem confirmar: a pagina volta a nao ler o player (ouvir continua). */
  function giveUp() {
    if (state.bridge === "pending") {
      update({ ...state, bridge: "silent" }, null);
    }
  }

  function stopHandshake() {
    if (handshakeTimer !== null) {
      win.clearInterval(handshakeTimer);
      handshakeTimer = null;
    }
  }

  function stopAsking() {
    if (askTimer !== null) {
      win.clearInterval(askTimer);
      askTimer = null;
    }
  }

  /** Repete `send` a cada handshakeEveryMs ate handshakeTries; esgotou, chama `exhausted`. */
  function repeat(send: () => void, exhausted: () => void) {
    let tries = 1;

    send();

    return win.setInterval(() => {
      if (tries >= EMBED_BRIDGE_RULES.handshakeTries) {
        exhausted();
        return;
      }

      tries += 1;
      send();
    }, EMBED_BRIDGE_RULES.handshakeEveryMs);
  }

  function handleReady() {
    stopHandshake();
    embedSubscriptions(target.protocol).forEach(post);

    if (askTimer === null) {
      askTimer = repeat(
        () => post(embedAskPaused(target.protocol)),
        () => {
          stopAsking();
          giveUp();
        }
      );
    }
  }

  function begin() {
    stopHandshake();
    stopAsking();

    if (deadline !== null) {
      win.clearTimeout(deadline);
    }

    deadline = win.setTimeout(() => {
      deadline = null;
      giveUp();
    }, EMBED_BRIDGE_RULES.pendingMaxMs);
    handshakeTimer = repeat(
      () => post(embedHandshake(target.protocol)),
      () => {
        stopHandshake();
        giveUp();
      }
    );
  }

  function handleMessage(event: MessageEvent) {
    const frame = iframe.contentWindow;

    if (stopped || frame === null || event.source !== frame || !target.origins.includes(event.origin)) {
      return;
    }

    const message = parseEmbedMessage(target.protocol, event.data);

    if (!message) {
      return;
    }

    // Daqui para frente, manda para quem respondeu (sempre do grupo; a Bunny nova responde da outra origem).
    sendOrigin = event.origin;

    if (message.kind === "ready") {
      handleReady();
      return;
    }

    if (message.kind === "paused_answer") {
      stopAsking();
    }

    update(reduceEmbedState(state, message), message);
  }

  function handleLoad() {
    if (stopped) {
      return;
    }

    // Documento novo no iframe: tudo de novo, com o prazo de novo. A targetOrigin fica a da ultima mensagem
    // aceita (a Bunny que abre no host novo manda o `ready` dela antes do `load` do iframe).
    update(EMBED_BRIDGE_START, null);
    begin();
  }

  win.addEventListener("message", handleMessage);
  iframe.addEventListener("load", handleLoad);
  begin();

  return () => {
    stopped = true;
    win.removeEventListener("message", handleMessage);
    iframe.removeEventListener("load", handleLoad);
    stopHandshake();
    stopAsking();

    if (deadline !== null) {
      win.clearTimeout(deadline);
      deadline = null;
    }
  };
}

export type EmbedCallbacks = {
  onEnded: (info: { duration: number | null; seconds: number | null }) => void;
  onPause: (info: { duration: number | null; seconds: number | null }) => void;
  onPlay: () => void;
  onTime: (info: { duration: number | null; seconds: number }) => void;
};

type SessionSettings = { enabled: boolean; iframe: BridgeIframe | null; lessonId: string | null; src: string | null };

const SILENT: EmbedAnnouncement = { bridge: "silent", fullscreen: false, playing: false };

/**
 * A ponte de uma pagina de aula, fora do React (o hook so a liga e desliga): `set` religa so quando enabled,
 * iframe, lessonId ou src mudam (callbacks novos nunca religam); ao desligar ou trocar de aula anuncia
 * { bridge: "silent", fullscreen: false, playing: false } da aula anterior; chama os callbacks so com a ponte
 * confirmada, lendo sempre os mais novos (`callbacks()`); onTime pelo shouldReportTime.
 */
export function createEmbedBridgeSession(input: {
  announce: (signal: EmbedAnnouncement & { lessonId: string }) => void;
  callbacks: () => EmbedCallbacks;
  now?: () => number;
  win: BridgeWindow;
}): {
  set(next: SessionSettings): void;
  stop(): void;
} {
  const now = input.now ?? (() => Date.now());
  let settings: SessionSettings | null = null;
  let disconnect: (() => void) | null = null;
  let lessonId: string | null = null;
  let announced: EmbedAnnouncement | null = null;
  let timeReportedAt: number | null = null;

  function announce(next: EmbedAnnouncement) {
    const changed = embedAnnouncement(announced, next);

    if (changed && lessonId !== null) {
      announced = changed;
      input.announce({ ...changed, lessonId });
    }
  }

  function teardown() {
    disconnect?.();
    disconnect = null;

    if (lessonId !== null) {
      // Um `playing` da aula anterior nunca segura o pop-up.
      announce(SILENT);
    }

    lessonId = null;
    announced = null;
    timeReportedAt = null;
  }

  function handleChange(state: EmbedBridgeState, message: EmbedMessage | null) {
    announce({ bridge: state.bridge, fullscreen: state.fullscreen, playing: state.playing });

    if (state.bridge !== "confirmed" || !message) {
      return;
    }

    const callbacks = input.callbacks();
    const info = { duration: state.duration, seconds: state.seconds };

    if (message.kind === "play" || (message.kind === "paused_answer" && !message.paused)) {
      callbacks.onPlay();
    } else if (message.kind === "pause") {
      callbacks.onPause(info);
    } else if (message.kind === "ended") {
      callbacks.onEnded(info);
    } else if (message.kind === "time" && state.playing && shouldReportTime(timeReportedAt, now())) {
      timeReportedAt = now();
      callbacks.onTime({ duration: state.duration, seconds: message.seconds });
    }
  }

  return {
    set(next) {
      if (
        settings &&
        settings.enabled === next.enabled &&
        settings.iframe === next.iframe &&
        settings.lessonId === next.lessonId &&
        settings.src === next.src
      ) {
        return;
      }

      settings = { ...next };
      teardown();

      const target = next.enabled && next.iframe && next.lessonId ? embedBridgeTarget(next.src) : null;

      if (!target || !next.iframe || !next.lessonId) {
        return;
      }

      lessonId = next.lessonId;
      announce({ bridge: "pending", fullscreen: false, playing: false });
      disconnect = connectEmbedBridge({ iframe: next.iframe, now, onChange: handleChange, target, win: input.win });
    },
    stop() {
      settings = null;
      teardown();
    }
  };
}
