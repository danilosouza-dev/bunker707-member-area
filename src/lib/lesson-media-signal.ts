// Sinais da pagina da aula para o pop-up dos avisos (docs/25 §4): o pop-up nunca abre por cima do nosso
// player tocando e "Ao concluir uma aula" so abre depois que o servidor gravou a conclusao. A pagina da aula
// (lesson-experience.tsx) anuncia tres coisas por um evento da window: o aluno deu play no nosso player, o
// YouTube com os nossos controles tocou ou parou, e uma aula foi concluida. O resto e lido do DOM na hora de
// decidir (lessonMediaSnapshot): o <video> nativo muda de src na troca de aula sem disparar `pause`, e o do
// iPhone toca em tela cheia propria, entao nada aqui espelha o estado dele.
//
// Players de fora (Bunny, Vimeo, Mux) sao iframes de outra origem: a pagina nao le o play deles. Conta como
// "mexeu no player" o foco dentro do iframe do palco e, numa tela de toque, o proprio iframe (um toque la
// dentro nunca chega a pagina). Qualquer script da pagina pode disparar o mesmo evento ou mudar os
// atributos: o pior que consegue e o navegador pedir um pop-up que o aluno ja pode ver (o servidor decide).
// Isomorfico: sem window no servidor, nada acontece.

export const LESSON_MEDIA_EVENT = "bunker707:lesson-media";

export type LessonPlayerKind = "iframe" | "native" | "youtube";

export type LessonMediaSignal =
  /** O aluno deu play no nosso player. */
  | { kind: "touched" }
  /** YouTube com os nossos controles (tocando ou carregando = tocando). */
  | { kind: "youtube"; playing: boolean }
  /** Conclusao gravada no servidor (contentId = o produto da pagina da aula). */
  | { contentId: string; kind: "completed"; lessonId: string };

export type LessonMediaSnapshot = {
  /** A aula na tela (data-lesson-id do palco). */
  activeLessonId: string | null;
  fullscreen: boolean;
  playerKind: LessonPlayerKind | null;
  playing: boolean;
  touched: boolean;
};

const STAGE_SELECTOR = "[data-lesson-player-stage]";
const PRODUCT_ID = /^[A-Za-z0-9_-]{1,240}$/;
const PLAYER_KINDS: readonly string[] = ["iframe", "native", "youtube"];
/** Enquanto espera o video parar, confere de novo a cada segundo (o <video> some ou troca na troca de aula). */
const STOP_RECHECK_MS = 1_000;

type VideoLike = { ended?: boolean; paused?: boolean; webkitDisplayingFullscreen?: boolean };

// Estado desta visualizacao de pagina (resetLessonMedia zera ao trocar de pagina).
let touchedFlag = false;
let youTubePlaying = false;

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

/** Le a pagina na hora: o <video> do palco pelo proprio elemento, o YouTube pelo ultimo sinal. */
export function lessonMediaSnapshot(): LessonMediaSnapshot {
  const stage = stageElement();
  const kind = stage?.getAttribute("data-lesson-player-kind") ?? null;
  const playerKind = kind && PLAYER_KINDS.includes(kind) ? (kind as LessonPlayerKind) : null;
  const video = stageVideo(stage);
  const nativePlaying = Boolean(video && !video.paused && !video.ended);
  const documentFullscreen =
    typeof document !== "undefined" &&
    Boolean(document.fullscreenElement || (document as Document & { webkitFullscreenElement?: Element | null }).webkitFullscreenElement);

  return {
    activeLessonId: stage?.getAttribute("data-lesson-id") || null,
    // O iPhone toca o video da aula em tela cheia propria, onde document.fullscreenElement fica null.
    fullscreen: documentFullscreen || Boolean(video?.webkitDisplayingFullscreen),
    playerKind,
    playing: nativePlaying || youTubePlaying,
    touched: touchedFlag || iframeFocused() || (playerKind === "iframe" && coarsePointer())
  };
}

/** Nova visualizacao de pagina: nada do que o aluno fez na pagina anterior vale aqui. */
export function resetLessonMedia(): void {
  touchedFlag = false;
  youTubePlaying = false;
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

  if (
    value.kind === "completed" &&
    typeof value.contentId === "string" &&
    PRODUCT_ID.test(value.contentId) &&
    typeof value.lessonId === "string" &&
    value.lessonId.length > 0 &&
    value.lessonId.length <= 240
  ) {
    return { contentId: value.contentId, kind: "completed", lessonId: value.lessonId };
  }

  return null;
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
 * Chama `onStop` (uma vez) quando nada do nosso player toca: pause, ended, emptied e abort do video do palco,
 * o YouTube parado, e a conferencia de 1 s (o video trocado ou desmontado na troca de aula nao avisa).
 * Devolve a funcao que para de esperar.
 */
export function waitLessonMediaStop(onStop: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  let done = false;
  const video = stageVideo(stageElement());
  const mediaEvents = ["pause", "ended", "emptied", "abort"] as const;

  function check() {
    if (done || lessonMediaSnapshot().playing) {
      return;
    }

    stop();
    onStop();
  }

  function handleSignal(event: Event) {
    const signal = readLessonMediaSignal(event);

    if (signal?.kind === "youtube" && !signal.playing) {
      check();
    }
  }

  const interval = window.setInterval(check, STOP_RECHECK_MS);

  mediaEvents.forEach((name) => video?.addEventListener(name, check));
  window.addEventListener(LESSON_MEDIA_EVENT, handleSignal);

  function stop() {
    done = true;
    window.clearInterval(interval);
    mediaEvents.forEach((name) => video?.removeEventListener(name, check));
    window.removeEventListener(LESSON_MEDIA_EVENT, handleSignal);
  }

  return stop;
}
