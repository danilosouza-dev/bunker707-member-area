"use client";

import { CheckCheck, LoaderCircle, Pause, Play, RotateCw } from "lucide-react";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { NotificationAudio } from "@/server/communications/notification-model";
import { cn } from "@/lib/utils";
import {
  AUDIO_SEEK_STEP_SECONDS,
  audioGroupLabel,
  clampAudioTime,
  countHeard,
  EMPTY_HEARD,
  formatAudioPosition,
  formatAudioRate,
  formatAudioTime,
  heardBars,
  heardPercent,
  heardSlotsFromRanges,
  listenState,
  nextAudioRate,
  normalizeHeard,
  orHeard,
  shouldFlushAudio,
  waveformBarCount,
  waveformHeights,
  WAVEFORM_MAX_BARS,
  type AudioFlushReason,
  type AudioListenState,
  type AudioProgressEvent,
  type AudioRate
} from "./notifications-model";

// Audio curto do aviso (sino, pop-up e previa do admin): pilula com tocar/pausar, forma de onda que
// tambem e a barra de posicao (clique, arraste e setas), tempo e velocidade 1x/1,5x/2x. O arquivo so e
// baixado no primeiro play (preload="none") e so um audio toca por vez na pagina. Em `preview` (previa
// do admin, dentro de moldura inert) desenha o mesmo visual parado, sem <audio> nem rede. No toque
// (celular), so pula com um toque parado ou um arraste para o lado: rolar a lista com o dedo em cima da
// onda nao mexe na posicao.
//
// No sino (`listen`, docs/23), o player mostra o que o aluno ja ouviu, como o WhatsApp: nunca tocado
// (bolinha branca antes do tempo), ouvido em parte (barras ouvidas mais claras), ouvido (44 de 48
// trechos: onda verde e o CheckCheck). O ouvido sai do que tocou de verdade (audio.played), soma com o
// que o servidor ja tem e vai por `onProgress`: fetch tocando (5 trechos a mais e 15 s), na pausa e no
// fim; beacon com a aba escondida, na saida da pagina e quando o painel fecha. O pop-up nao passa
// `listen`: desenha exatamente a v1 e nao guarda nada.

let currentlyPlaying: HTMLAudioElement | null = null;

/** Quanto o dedo anda (px) antes de decidir entre arrastar a posicao e rolar a pagina. */
const TOUCH_SLOP_PX = 8;

function claimPlayback(element: HTMLAudioElement) {
  if (currentlyPlaying && currentlyPlaying !== element) {
    currentlyPlaying.pause();
  }

  currentlyPlaying = element;
}

function releasePlayback(element: HTMLAudioElement) {
  if (currentlyPlaying === element) {
    currentlyPlaying = null;
  }
}

const pillClassName = "flex min-w-0 items-center gap-3 rounded-[14px] border border-white/[0.08] bg-white/[0.05] p-2 pr-3";
const playButtonClassName =
  "grid size-9 shrink-0 place-items-center rounded-full bg-white text-black transition-colors hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none";
// Largura fixa: o tempo cresce ao tocar ("0:58" -> "0:12 / 0:58") sem empurrar a onda.
const timeClassName = "min-w-[3.75rem] shrink-0 text-right text-xs tabular-nums text-zinc-300";
const speedClassName =
  "inline-flex h-7 min-w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.08] px-2 text-[11px] font-semibold tabular-nums text-zinc-200 transition-colors hover:bg-white/[0.14] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white motion-reduce:transition-none";

/** Quantas barras cabem na largura da onda (mede antes de pintar e acompanha a largura). */
function useWaveformBars(ref: React.RefObject<HTMLElement | null>) {
  const [count, setCount] = useState(WAVEFORM_MAX_BARS);

  useLayoutEffect(() => {
    const element = ref.current;

    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    // O ResizeObserver avisa uma vez ao comecar a observar (antes de pintar) e a cada troca de largura.
    const observer = new ResizeObserver(() => setCount(waveformBarCount(element.clientWidth)));
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return count;
}

/** Cor de uma barra: antes da posicao (tocando) branca; depois, verde (ouvido), clara (ouvida) ou apagada. */
function barClassName(input: { before: boolean; completed: boolean; heard: boolean; listening: boolean }) {
  if (input.before) {
    return "bg-white";
  }

  if (!input.listening) {
    return "bg-white/30";
  }

  if (input.completed) {
    return "bg-emerald-400";
  }

  return input.heard ? "bg-white/60" : "bg-white/30";
}

function Waveform({
  completed = false,
  heard = null,
  heights,
  progress
}: {
  completed?: boolean;
  /** Barras ja ouvidas (heardBars); null = sem `listen` (pop-up, editor): so a posicao. */
  heard?: readonly boolean[] | null;
  heights: readonly number[];
  progress: number;
}) {
  const played = Math.round(progress * heights.length);

  return (
    <span aria-hidden="true" className="flex h-8 w-full items-center justify-between gap-[2px] overflow-hidden">
      {heights.map((height, index) => (
        <span
          className={cn(
            "w-[3px] shrink-0 rounded-full",
            barClassName({ before: index < played, completed, heard: Boolean(heard?.[index]), listening: heard !== null })
          )}
          // Posicao fixa de cada barra: o indice e a identidade.
          key={index}
          style={{ height: `${height}%` }}
        />
      ))}
    </span>
  );
}

/** Sinal que nao e so cor, antes do tempo: bolinha branca (nunca tocado) ou CheckCheck (ouvido). */
function ListenCue({ state }: { state: AudioListenState | null }) {
  if (state === "never") {
    return <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-zinc-100" />;
  }

  if (state === "completed") {
    return (
      <>
        <CheckCheck aria-hidden="true" className="size-3.5 shrink-0 text-emerald-400" strokeWidth={2.4} />
        <span className="sr-only">Áudio ouvido</span>
      </>
    );
  }

  return null;
}

/** O que o sino sabe do audio deste aluno (o servidor soma tudo, entre visitas e aparelhos). */
export type NoticeAudioListen = { completed: boolean; heard: string };

export type NoticeAudioPlayerProps = {
  audio: NotificationAudio;
  className?: string;
  /** Igual a `preview`: dentro de moldura inert nao ha o que tocar. */
  inert?: boolean;
  /** Nome do grupo para o leitor de tela, ex.: "Áudio do aviso" (com `listen`, ganha o estado). */
  label: string;
  /**
   * Sino: o ouvido gravado deste aluno. Desenha os quatro estados (tambem parado, na previa do admin) e
   * liga `onProgress`. Sem ele (pop-up, editor), o player e exatamente o da v1.
   */
  listen?: NoticeAudioListen | null;
  /** Primeiro play (v1: o painel marcava a notificacao como lida). */
  onPlay?: () => void;
  /** Sino: "started" no primeiro play e a mascara ouvida quando cresce (shouldFlushAudio). */
  onProgress?: (event: AudioProgressEvent) => void;
  preview?: boolean;
};

/** Trocar o arquivo (editor do admin) recomeca o player do zero: posicao, duracao e erro sao do arquivo. */
export function NoticeAudioPlayer(props: NoticeAudioPlayerProps) {
  return <AudioPlayer key={props.audio.url} {...props} />;
}

function AudioPlayer({ audio, className, inert = false, label, listen = null, onPlay, onProgress, preview = false }: NoticeAudioPlayerProps) {
  const waveRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  /** Toque ou caneta que ainda nao virou arraste (pode ser o comeco de uma rolagem). */
  const touchStartRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const playNotifiedRef = useRef(false);
  const barCount = useWaveformBars(waveRef);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [started, setStarted] = useState(false);
  /** Ja tocou nesta visita (pular pela onda sem tocar nao tira o "ainda nao ouvido"). */
  const [hasPlayed, setHasPlayed] = useState(false);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState<number | null>(null);
  const [rate, setRate] = useState<AudioRate>(1);
  const [failed, setFailed] = useState(false);
  /** Trechos tocados nesta visita (somados por OU; recarregar o arquivo nao apaga). */
  const [localHeard, setLocalHeard] = useState(EMPTY_HEARD);
  const localHeardRef = useRef(EMPTY_HEARD);
  /** O que ja foi mandado ao servidor (OU de tudo) e quando. */
  const sentHeardRef = useRef(EMPTY_HEARD);
  const lastSentAtRef = useRef(0);
  const staticMode = preview || inert;
  /** Sino de verdade: guarda o ouvido (a previa so desenha). */
  const tracking = Boolean(listen) && !staticMode;
  // Gravacao do navegador (webm) costuma vir sem duracao; vale a medida gravada com o aviso.
  const duration = mediaDuration ?? Math.max(audio.durationSeconds, 0);
  const heights = waveformHeights(audio.peaks, barCount);
  const progress = duration > 0 ? Math.min(current / duration, 1) : 0;
  // Ouvido: o do servidor somado ao desta visita (o verde aparece na hora, antes da resposta).
  const heard = listen ? orHeard(listen.heard, staticMode ? EMPTY_HEARD : localHeard) : null;
  const listened = heard ? listenState(heard, !staticMode && hasPlayed) : null;
  const state: AudioListenState | null = listened && listen?.completed ? "completed" : listened;
  const completed = state === "completed";
  const groupLabel = state ? audioGroupLabel(label, { percent: heardPercent(heard), playing: !staticMode && playing, state }) : label;

  // Sai da pagina (ou troca de aviso): para de tocar e libera a vez.
  useEffect(() => {
    const element = audioRef.current;

    return () => {
      if (element) {
        element.pause();
        releasePlayback(element);
      }
    };
  }, [audio.url]);

  /** Soma o que o elemento ja tocou (audio.played) ao ouvido desta visita. */
  function collectHeard(element: HTMLAudioElement | null) {
    let mask = localHeardRef.current;

    if (element && element.played.length > 0) {
      const ranges: { end: number; start: number }[] = [];

      for (let index = 0; index < element.played.length; index += 1) {
        ranges.push({ end: element.played.end(index), start: element.played.start(index) });
      }

      const total = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : duration;
      mask = orHeard(mask, heardSlotsFromRanges(ranges, total));
    }

    localHeardRef.current = mask;
    return mask;
  }

  /** Manda o ouvido quando cresceu (o caminho e a hora vem de shouldFlushAudio). Nada antes do primeiro play. */
  function flushHeard(reason: AudioFlushReason, element: HTMLAudioElement | null) {
    if (!tracking || !listen || !onProgress || !playNotifiedRef.current) {
      return;
    }

    const mask = orHeard(listen.heard, collectHeard(element));
    const known = orHeard(listen.heard, sentHeardRef.current);
    const via = shouldFlushAudio({
      heard: countHeard(mask),
      known: countHeard(known),
      msSinceLastSend: Date.now() - lastSentAtRef.current,
      reason
    });

    if (!via) {
      return;
    }

    sentHeardRef.current = orHeard(sentHeardRef.current, mask);
    lastSentAtRef.current = Date.now();
    onProgress({ event: "progress", heard: normalizeHeard(mask), via });
  }

  function trackHeard(element: HTMLAudioElement, reason: AudioFlushReason) {
    if (!tracking) {
      return;
    }

    const mask = collectHeard(element);
    setLocalHeard((previous) => (previous === mask ? previous : mask));
    flushHeard(reason, element);
  }

  // Aba escondida, saida da pagina e o painel fechando: o ouvido vai por beacon (a resposta nao e lida).
  const flushOnLeave = useEffectEvent((reason: AudioFlushReason, element: HTMLAudioElement | null) => flushHeard(reason, element));

  useEffect(() => {
    if (!tracking) {
      return;
    }

    const element = audioRef.current;

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        flushOnLeave("hidden", element);
      }
    }

    function handlePageHide() {
      flushOnLeave("pagehide", element);
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      flushOnLeave("unmount", element);
    };
  }, [tracking]);

  function seekTo(seconds: number) {
    const next = clampAudioTime(seconds, duration);
    const element = audioRef.current;

    setCurrent(next);
    setStarted(true);

    if (!element) {
      return;
    }

    // Antes dos metadados o navegador ignora currentTime: guarda e aplica em loadedmetadata.
    if (element.readyState >= 1) {
      element.currentTime = next;
    } else {
      pendingSeekRef.current = next;
    }
  }

  async function play() {
    const element = audioRef.current;

    if (!element) {
      return;
    }

    setFailed(false);
    claimPlayback(element);
    element.playbackRate = rate;

    try {
      await element.play();
    } catch (error) {
      // Bloqueio do navegador ou pausa logo em seguida nao e erro do arquivo.
      if (error instanceof DOMException && (error.name === "AbortError" || error.name === "NotAllowedError")) {
        return;
      }

      setFailed(true);
    }
  }

  function togglePlay() {
    const element = audioRef.current;

    if (!element) {
      return;
    }

    if (element.paused) {
      void play();
    } else {
      element.pause();
    }
  }

  function retry() {
    const element = audioRef.current;

    if (!element) {
      return;
    }

    setFailed(false);
    element.load();
    void play();
  }

  function changeRate() {
    const next = nextAudioRate(rate);
    setRate(next);

    if (audioRef.current) {
      audioRef.current.playbackRate = next;
      audioRef.current.defaultPlaybackRate = next;
    }
  }

  function secondsAt(clientX: number) {
    const rect = waveRef.current?.getBoundingClientRect();

    if (!rect || rect.width <= 0) {
      return current;
    }

    return ((clientX - rect.left) / rect.width) * duration;
  }

  function startDragging(event: PointerEvent<HTMLDivElement>) {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    seekTo(secondsAt(event.clientX));
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || duration <= 0) {
      return;
    }

    // Mouse pula na hora; toque e caneta esperam para saber se e toque, arraste para o lado ou rolagem.
    if (event.pointerType === "mouse") {
      startDragging(event);
      return;
    }

    touchStartRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (draggingRef.current) {
      seekTo(secondsAt(event.clientX));
      return;
    }

    const start = touchStartRef.current;

    if (!start || start.id !== event.pointerId) {
      return;
    }

    const dx = Math.abs(event.clientX - start.x);
    const dy = Math.abs(event.clientY - start.y);

    if (dx > TOUCH_SLOP_PX && dx > dy) {
      touchStartRef.current = null;
      startDragging(event);
    } else if (dy > TOUCH_SLOP_PX) {
      // Rolagem: o navegador fica com o gesto (touch-pan-y) e a posicao nao muda.
      touchStartRef.current = null;
    }
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = touchStartRef.current;
    touchStartRef.current = null;

    // Toque parado: pula para onde o dedo tocou.
    if (start && start.id === event.pointerId) {
      seekTo(secondsAt(event.clientX));
      return;
    }

    handlePointerEnd(event);
  }

  function handlePointerCancel(event: PointerEvent<HTMLDivElement>) {
    // O navegador tomou o gesto (rolagem): nada de pular.
    touchStartRef.current = null;
    handlePointerEnd(event);
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) {
      return;
    }

    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function handleSliderKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowDown: current - AUDIO_SEEK_STEP_SECONDS,
      ArrowLeft: current - AUDIO_SEEK_STEP_SECONDS,
      ArrowRight: current + AUDIO_SEEK_STEP_SECONDS,
      ArrowUp: current + AUDIO_SEEK_STEP_SECONDS,
      End: duration,
      Home: 0,
      PageDown: current - duration / 10,
      PageUp: current + duration / 10
    };

    if (!(event.key in moves) || duration <= 0) {
      return;
    }

    event.preventDefault();
    seekTo(moves[event.key]);
  }

  const timeLabel = formatAudioTime(current, duration, started);
  const rateLabel = formatAudioRate(rate);

  const heardBarList = heard ? heardBars(heard, heights.length) : null;
  const cueClassName = state === "never" || state === "completed" ? "inline-flex items-center justify-end gap-1.5" : undefined;

  if (staticMode) {
    return (
      <div aria-label={groupLabel} className={cn(pillClassName, className)} role="group">
        <span aria-hidden="true" className={playButtonClassName}>
          <Play className="size-4 translate-x-px fill-current" strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1" ref={waveRef}>
          <Waveform completed={completed} heard={heardBarList} heights={heights} progress={0} />
        </div>
        <span className={cn(timeClassName, cueClassName)}>
          <ListenCue state={state} />
          {formatAudioTime(0, duration, false)}
        </span>
        <span aria-hidden="true" className={speedClassName}>
          {formatAudioRate(1)}
        </span>
      </div>
    );
  }

  return (
    <div className={className}>
      <div aria-label={groupLabel} className={pillClassName} role="group">
        <button
          aria-label={playing ? "Pausar áudio" : "Tocar áudio"}
          className={playButtonClassName}
          onClick={togglePlay}
          type="button"
        >
          {waiting && playing ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2.4} />
          ) : playing ? (
            <Pause aria-hidden="true" className="size-4 fill-current" strokeWidth={2.4} />
          ) : (
            <Play aria-hidden="true" className="size-4 translate-x-px fill-current" strokeWidth={2.4} />
          )}
        </button>
        <div
          aria-label="Posição do áudio"
          aria-valuemax={Math.round(duration)}
          aria-valuemin={0}
          aria-valuenow={Math.round(current)}
          aria-valuetext={formatAudioPosition(current, duration)}
          className="min-w-0 flex-1 cursor-pointer touch-pan-y rounded-[6px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          onKeyDown={handleSliderKeyDown}
          onLostPointerCapture={() => {
            draggingRef.current = false;
          }}
          onPointerCancel={handlePointerCancel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          ref={waveRef}
          role="slider"
          tabIndex={0}
        >
          <Waveform completed={completed} heard={heardBarList} heights={heights} progress={progress} />
        </div>
        <span className={cn(timeClassName, cueClassName)}>
          <ListenCue state={state} />
          {timeLabel}
        </span>
        <button aria-label={`Velocidade ${rateLabel}`} className={speedClassName} onClick={changeRate} type="button">
          {rateLabel}
        </button>
      </div>
      {failed ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-red-300" role="alert">
          Não foi possível tocar o áudio.
          <button
            className="inline-flex items-center gap-1 rounded-[6px] font-semibold text-white underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            onClick={retry}
            type="button"
          >
            <RotateCw aria-hidden="true" className="size-3.5" />
            Tentar de novo
          </button>
        </p>
      ) : null}
      <audio
        onEnded={(event) => {
          trackHeard(event.currentTarget, "ended");
          setPlaying(false);
          setWaiting(false);
          setStarted(false);
          setCurrent(0);
          event.currentTarget.currentTime = 0;
          releasePlayback(event.currentTarget);
        }}
        onError={() => {
          setPlaying(false);
          setWaiting(false);
          setFailed(true);
        }}
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;

          if (Number.isFinite(element.duration) && element.duration > 0) {
            setMediaDuration(element.duration);
          }

          element.playbackRate = rate;

          if (pendingSeekRef.current !== null) {
            element.currentTime = pendingSeekRef.current;
            pendingSeekRef.current = null;
          }
        }}
        onPause={(event) => {
          setPlaying(false);
          setWaiting(false);
          releasePlayback(event.currentTarget);
          trackHeard(event.currentTarget, "pause");
        }}
        onPlay={(event) => {
          claimPlayback(event.currentTarget);
          setPlaying(true);
          setHasPlayed(true);

          if (!playNotifiedRef.current) {
            playNotifiedRef.current = true;
            lastSentAtRef.current = Date.now();
            onPlay?.();

            if (tracking) {
              onProgress?.({ event: "started" });
            }
          }

          setStarted(true);
        }}
        onPlaying={() => setWaiting(false)}
        onTimeUpdate={(event) => {
          if (!draggingRef.current) {
            setCurrent(event.currentTarget.currentTime);
          }

          trackHeard(event.currentTarget, "timeupdate");
        }}
        onWaiting={() => setWaiting(true)}
        preload="none"
        ref={audioRef}
        src={audio.url}
      />
    </div>
  );
}
