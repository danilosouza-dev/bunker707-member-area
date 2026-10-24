// Sinais da pagina da aula para o pop-up dos avisos (docs/25 §4, docs/29 §4.5): o pop-up nunca abre por cima do
// player da aula tocando e "Ao concluir uma aula" (e "Ao concluir um curso") so abre depois que o servidor gravou a
// conclusao. A pagina da aula (lesson-experience.tsx) anuncia por um evento da window: o aluno deu play no nosso
// player, o YouTube com os nossos controles tocou ou parou, uma aula foi concluida (e se ela fechou o curso) e o
// estado da ponte com o player de fora. O resto e lido do DOM na hora de decidir (lessonMediaSnapshot): o <video>
// nativo muda de src na troca de aula sem disparar `pause`, e o do iPhone toca em tela cheia propria, entao nada
// aqui espelha o estado dele.
//
// Players de fora (Bunny, Vimeo, Mux) sao iframes de outra origem: a pagina le o play deles pela ponte
// (src/lib/lesson-embed-bridge.ts), so depois de confirmada (uma ida e volta respondida). Enquanto a ponte de um
// player da lista esta no aperto de mao, ela fica "pendente" (no maximo 15 s; antes do primeiro sinal da aula,
// um iframe da lista conta como pendente ate 15 s depois de o palco passar a mostrar um player da lista para a
// aula na tela, ou de a pagina abrir, o que vier por ultimo: a aula marca o palco com
// data-lesson-player-bridge quando o src e de um player da lista, pelo embedBridgeTarget, para que este modulo,
// que vai em toda pagina com o host do pop-up, nao carregue a lista de origens). Sem ponte (outra origem, ou sem
// resposta), a pagina nao le o player: conta como "mexeu no player" o foco dentro do iframe do palco e, numa
// tela de toque, o proprio iframe (um toque la dentro nunca chega a pagina). Qualquer script da pagina pode
// disparar o mesmo evento ou mudar os atributos: o pior que consegue e o navegador pedir um pop-up que o aluno
// ja pode ver (o servidor decide). Isomorfico: sem window no servidor, nada acontece.

import type { EmbedBridge } from "./lesson-embed-bridge";

export const LESSON_MEDIA_EVENT = "bunker707:lesson-media";

export type LessonPlayerKind = "iframe" | "native" | "youtube";

export type LessonMediaSignal =
  /** O aluno deu play no nosso player. */
  | { kind: "touched" }
  /** YouTube com os nossos controles (tocando ou carregando = tocando). */
  | { kind: "youtube"; playing: boolean }
  /**
   * Conclusao gravada no servidor (contentId = o produto da pagina da aula). v3b-2: courseCompleted so vem (true)
   * quando o servidor disse que esta conclusao fechou o curso.
   */
  | { contentId: string; courseCompleted?: true; kind: "completed"; lessonId: string }
  /**
   * v3b-2: ponte com o player de fora (Bunny, Vimeo, Mux) do iframe do palco. bridge: "pending" = aperto de mao
   * em andamento (no maximo EMBED_BRIDGE_RULES.pendingMaxMs); "confirmed" = respondeu getPaused; "silent" =
   * acabou sem resposta, ou a ponte desligou (troca de aula, saiu da pagina).
   */
  | { bridge: "confirmed" | "pending" | "silent"; fullscreen: boolean; kind: "embed"; lessonId: string; playing: boolean };

export type LessonMediaSnapshot = {
  /** A aula na tela (data-lesson-id do palco). */
  activeLessonId: string | null;
  /**
   * v3b-2: a ponte da aula na tela. "pending" tambem vale antes do primeiro sinal, quando o iframe do palco tem
   * origem da lista (embedBridgeTarget) e o palco mostra esse player para a aula na tela ha menos de
   * pendingMaxMs (contado da pagina abrir ou da troca de aula, o que vier por ultimo); "none" = sem ponte ou sem
   * resposta (iframe de outra origem, ponte "silent", sinal de outra aula, player que nao e iframe).
   */
  bridge: "confirmed" | "none" | "pending";
  fullscreen: boolean;
  playerKind: LessonPlayerKind | null;
  playing: boolean;
  /** v3b-2: a pagina le se o player toca (arquivo, YouTube, ou iframe com a ponte confirmada para a aula na tela). */
  readable: boolean;
  touched: boolean;
};

const STAGE_SELECTOR = "[data-lesson-player-stage]";
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,240}$/;
const PLAYER_KINDS: readonly string[] = ["iframe", "native", "youtube"];
const EMBED_BRIDGES: readonly string[] = ["confirmed", "pending", "silent"];
/** Enquanto espera o video parar, confere de novo a cada segundo (o <video> some ou troca na troca de aula). */
const STOP_RECHECK_MS = 1_000;
/** O teto da ponte pendente (EMBED_BRIDGE_RULES.pendingMaxMs; tests/pop-ups-v3b2-navegador confere que e o mesmo). */
const BRIDGE_PENDING_MS = 15_000;

/** `error`: o arquivo nao carregou (o WebKit deixa `paused` false depois do play que falhou). */
type VideoLike = { ended?: boolean; error?: unknown; paused?: boolean; webkitDisplayingFullscreen?: boolean };

type EmbedState = { bridge: EmbedBridge; fullscreen: boolean; lessonId: string | null; playing: boolean };

const EMBED_NONE: EmbedState = { bridge: "silent", fullscreen: false, lessonId: null, playing: false };

// Estado desta visualizacao de pagina (resetLessonMedia zera ao trocar de pagina).
let touchedFlag = false;
let youTubePlaying = false;
/** O ultimo sinal da ponte com o player de fora (de qual aula). */
let embed: EmbedState = EMBED_NONE;
/** Quando a pagina abriu (o ultimo resetLessonMedia): o iframe da lista conta como pendente ate pendingMaxMs depois. */
let resetAt = 0;
/**
 * A aula para a qual o palco mostra um player da lista e desde quando: a troca de aula dentro da pagina (a chave
 * da pagina nao muda, resetLessonMedia nao roda) reabre a janela pendente para a aula nova, ate a ponte dela
 * anunciar algo.
 */
let listedLessonId: string | null = null;
let listedSince = 0;

function stageElement(): Element | null {
  return typeof document === "undefined" ? null : document.querySelector(STAGE_SELECTOR);
}

function stageVideo(stage: Element | null): (EventTarget & VideoLike) | null {
  return (stage?.querySelector("video") as (EventTarget & VideoLike) | null | undefined) ?? null;
}

/** O foco esta num iframe do palco (o aluno entrou no player de fora). */
function iframeFocused() {
  if (typeof document === "undefined") {
    return false;
  }

  const active = document.activeElement as (Element & { closest?: (selector: string) => Element | null }) | null;

  return Boolean(active && active.tagName === "IFRAME" && typeof active.closest === "function" && active.closest(STAGE_SELECTOR));
}

function coarsePointer() {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** Guarda o estado e dispara o evento na window (o host do pop-up escuta a conclusao). */
export function announceLessonMedia(signal: LessonMediaSignal): void {
  if (signal.kind === "touched") {
    touchedFlag = true;
  } else if (signal.kind === "embed") {
    embed = { bridge: signal.bridge, fullscreen: signal.fullscreen, lessonId: signal.lessonId, playing: signal.playing };
  } else if (signal.kind === "youtube") {
    youTubePlaying = signal.playing;

    if (signal.playing) {
      touchedFlag = true;
    }
  }

  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }

  window.dispatchEvent(new CustomEvent<LessonMediaSignal>(LESSON_MEDIA_EVENT, { detail: signal }));
}

function documentFullscreen() {
  return (
    typeof document !== "undefined" &&
    Boolean(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement)
  );
}

/**
 * A ponte da aula na tela: o ultimo sinal dela ou, antes dele, o player da lista (o palco marcado com
 * data-lesson-player-bridge) nos primeiros 15 s desde que o palco mostra esse player para a aula na tela (a
 * abertura da pagina ou a troca de aula, o que vier por ultimo).
 */
function bridgeOf(stage: Element | null, playerKind: LessonPlayerKind | null, activeLessonId: string | null): LessonMediaSnapshot["bridge"] {
  const listed = playerKind === "iframe" && typeof stage?.getAttribute("data-lesson-player-bridge") === "string";

  // O palco passou a mostrar um player da lista para outra aula (ou voltou a mostrar um, depois de outro player):
  // a janela pendente recomeca para ela.
  if (!listed) {
    listedLessonId = null;
  } else if (activeLessonId !== listedLessonId) {
    listedLessonId = activeLessonId;
    listedSince = Date.now();
  }

  if (playerKind !== "iframe") {
    return "none";
  }

  if (embed.lessonId !== null && embed.lessonId === activeLessonId) {
    return embed.bridge === "silent" ? "none" : embed.bridge;
  }

  return listed && Date.now() - Math.max(resetAt, listedSince) < BRIDGE_PENDING_MS ? "pending" : "none";
}

/** Le a pagina na hora: o <video> do palco pelo proprio elemento, o YouTube e a ponte pelo ultimo sinal. */
export function lessonMediaSnapshot(): LessonMediaSnapshot {
  const stage = stageElement();
  const kind = stage?.getAttribute("data-lesson-player-kind") ?? null;
  const playerKind = kind && PLAYER_KINDS.includes(kind) ? (kind as LessonPlayerKind) : null;
  const activeLessonId = stage?.getAttribute("data-lesson-id") || null;
  const video = stageVideo(stage);
  // O arquivo que nao carregou (video.error) nao toca: no WebKit o play que falhou deixa paused false para sempre.
  const nativePlaying = Boolean(video && !video.paused && !video.ended && !video.error);
  const bridge = bridgeOf(stage, playerKind, activeLessonId);
  const embedActive = bridge === "confirmed";

  return {
    activeLessonId,
    bridge,
    // O iPhone toca o video da aula em tela cheia propria, onde document.fullscreenElement fica null; o Vimeo
    // avisa a tela cheia dele pela ponte.
    fullscreen: documentFullscreen() || Boolean(video?.webkitDisplayingFullscreen) || (embedActive && embed.fullscreen),
    playerKind,
    playing: nativePlaying || youTubePlaying || (embedActive && embed.playing),
    readable: playerKind === "native" || playerKind === "youtube" || embedActive,
    touched: touchedFlag || iframeFocused() || (playerKind === "iframe" && coarsePointer())
  };
}

/** Nova visualizacao de pagina: nada do que o aluno fez na pagina anterior vale aqui. */
export function resetLessonMedia(): void {
  touchedFlag = false;
  youTubePlaying = false;
  embed = EMBED_NONE;
  resetAt = Date.now();
  listedLessonId = null;
  listedSince = 0;
}

/** Le o sinal do evento sem confiar no formato (qualquer script da pagina pode disparar o mesmo nome). */
export function readLessonMediaSignal(event: Event): LessonMediaSignal | null {
  const detail = (event as CustomEvent<unknown>).detail;

  if (!detail || typeof detail !== "object") {
    return null;
  }

  const value = detail as Record<string, unknown>;

  if (value.kind === "touched") {
    return { kind: "touched" };
  }

  if (value.kind === "youtube") {
    return typeof value.playing === "boolean" ? { kind: "youtube", playing: value.playing } : null;
  }

  if (value.kind === "completed" && typeof value.contentId === "string" && PRODUCT_ID.test(value.contentId) && isLessonId(value.lessonId)) {
    // O curso fechado so vale com true (qualquer outro valor: a conclusao da aula, sem o curso).
    return value.courseCompleted === true
      ? { contentId: value.contentId, courseCompleted: true, kind: "completed", lessonId: value.lessonId }
      : { contentId: value.contentId, kind: "completed", lessonId: value.lessonId };
  }

  if (
    value.kind === "embed" &&
    isLessonId(value.lessonId) &&
    typeof value.bridge === "string" &&
    EMBED_BRIDGES.includes(value.bridge) &&
    typeof value.playing === "boolean" &&
    typeof value.fullscreen === "boolean"
  ) {
    return {
      bridge: value.bridge as EmbedBridge,
      fullscreen: value.fullscreen,
      kind: "embed",
      lessonId: value.lessonId,
      playing: value.playing
    };
  }

  return null;
}

function isLessonId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 240;
}

/**
 * Blur da window com o foco num iframe do palco = o aluno mexeu no player de fora. No iPhone o toque num
 * iframe de outra origem nem sempre dispara esse blur: o snapshot tambem confere o foco na hora.
 */
export function watchLessonPlayerFocus(): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const timers = new Set<number>();

  function check() {
    if (iframeFocused()) {
      touchedFlag = true;
    }
  }

  function handleBlur() {
    check();
    // O activeElement pode mudar so depois do blur.
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      check();
    }, 0);
    timers.add(timer);
  }

  window.addEventListener("blur", handleBlur);

  return () => {
    window.removeEventListener("blur", handleBlur);
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
  };
}

/**
 * Chama `onDone` (uma vez) quando `pending()` deixa de valer: nos eventos dados (o video do palco, o document),
 * no sinal da aula que `wakes` aceita e na conferencia de 1 s. Devolve a funcao que para de esperar.
 */
function waitUntilClear(
  pending: () => boolean,
  onDone: () => void,
  target: EventTarget | null,
  names: readonly string[],
  capture: boolean,
  wakes: (signal: LessonMediaSignal) => boolean
): () => void {
  let done = false;

  function check() {
    if (done || pending()) {
      return;
    }

    stop();
    onDone();
  }

  function handleSignal(event: Event) {
    const signal = readLessonMediaSignal(event);

    if (signal && wakes(signal)) {
      check();
    }
  }

  const interval = window.setInterval(check, STOP_RECHECK_MS);

  names.forEach((name) => target?.addEventListener(name, check, capture));
  window.addEventListener(LESSON_MEDIA_EVENT, handleSignal);

  function stop() {
    done = true;
    window.clearInterval(interval);
    names.forEach((name) => target?.removeEventListener(name, check, capture));
    window.removeEventListener(LESSON_MEDIA_EVENT, handleSignal);
  }

  return stop;
}

/**
 * Chama `onStop` (uma vez) quando nada do player da aula toca: pause, ended, emptied, abort e error do video do
 * palco (o arquivo que nao carregou nao toca), o YouTube parado, a ponte do player de fora parada, e a
 * conferencia de 1 s (o video trocado ou desmontado na troca de aula nao avisa). Devolve a funcao que para de
 * esperar.
 */
export function waitLessonMediaStop(onStop: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  return waitUntilClear(
    () => lessonMediaSnapshot().playing,
    onStop,
    stageVideo(stageElement()),
    ["pause", "ended", "emptied", "abort", "error"],
    false,
    (signal) => (signal.kind === "youtube" || signal.kind === "embed") && !signal.playing
  );
}

/** Avisos do document de que a tela cheia mudou (webkitendfullscreen: o video saindo da tela cheia do iPhone). */
const FULLSCREEN_EVENTS = ["fullscreenchange", "webkitfullscreenchange", "webkitendfullscreen"] as const;

/**
 * Chama `onEnd` (uma vez) quando nada mais esta em tela cheia (o document, o video do palco no iPhone, o player
 * de fora pela ponte): os avisos de tela cheia do document (na captura: webkitendfullscreen nao sobe), o sinal da
 * ponte com `fullscreen: false` e a conferencia de 1 s. Vale fora da aula tambem (sem palco, so o document).
 * Devolve a funcao que para de esperar.
 */
export function waitLessonFullscreenEnd(onEnd: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => undefined;
  }

  return waitUntilClear(
    () => lessonMediaSnapshot().fullscreen,
    onEnd,
    document,
    FULLSCREEN_EVENTS,
    true,
    (signal) => signal.kind === "embed" && !signal.fullscreen
  );
}
