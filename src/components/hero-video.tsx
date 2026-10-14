"use client";

import { Pause, Play, Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { cssImageUrl } from "@/lib/css-url";
import { normalizeHeroVideoOptions, youtubeThumbnailUrl, type HeroVideoSource } from "@/lib/hero-video";
import type { HeroVideoOptions } from "@/lib/platform-types";

// Video de destaque do produto (topo do modal da home e banner da pagina do curso).
// - Arquivo direto: <video> sem som, em repeticao, com a capa como poster.
// - YouTube: iframe do player (youtube-nocookie). Com "esconder logo e titulo" o iframe e ampliado alguns
//   pontos e recortado pelas bordas (a faixa do titulo em cima e a logo embaixo ficam fora da area visivel)
//   e nao recebe mouse, entao o player nunca mostra a propria interface; som e pausa ficam por conta dos
//   nossos botoes, que falam com o player pela API de mensagens (enablejsapi + "listening"). E um recorte
//   de CSS, nao um recurso oficial do YouTube: se o player mudar, o produtor pode desligar a opcao.
// - "Reduzir movimento" ou autoplay desligado: so a capa, com um botao de tocar.
// - Autoplay bloqueado pelo aparelho (iOS em economia de energia, por exemplo): o iframe volta a receber
//   toque para a pessoa usar o botao de tocar do proprio YouTube; arquivo direto ganha o nosso botao.

type HeroVideoProps = {
  className?: string;
  /** Posicao do grupo de botoes (som/pausa); padrao canto inferior direito. */
  controlsClassName?: string;
  options?: HeroVideoOptions;
  /** Capa escolhida pelo produtor. Sem ela, YouTube usa a miniatura do proprio video. */
  poster?: string | null;
  source: HeroVideoSource;
};

type Frame = { height: number; left: number; top: number; width: number };
type YouTubePhase = "loading" | "ready" | "playing" | "blocked";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";
const YOUTUBE_RATIO = 16 / 9;
/** Quanto cortar de cada borda (em px) para a faixa do titulo e a logo do YouTube ficarem fora da tela. */
const YOUTUBE_CROP_MIN_PX = 72;
const YOUTUBE_CROP_RATIO = 0.1;
/** Estados do player do YouTube (playerState). */
const YT_ENDED = 0;
const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_BUFFERING = 3;
/** Sem noticia do player ate aqui, o iframe aparece mesmo assim (a capa nao pode ficar para sempre). */
const PLAYER_REVEAL_TIMEOUT_MS = 4000;
/** Player pronto mas sem tocar ate aqui = autoplay bloqueado pelo aparelho. */
const AUTOPLAY_WAIT_MS = 2500;
const HANDSHAKE_RETRY_MS = 400;
const HANDSHAKE_MAX_TRIES = 12;

const CONTROL_BUTTON =
  "grid h-8 w-8 shrink-0 place-items-center rounded-full text-white transition hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";
/** Quanto a linha do tempo anda com as setas do teclado (segundos) e o volume (pontos). */
const TIMELINE_KEY_STEP_SECONDS = 5;
const VOLUME_KEY_STEP = 10;
/** Depois de mexer no som por aqui, ignora por um instante o que o player reporta (evita o botao piscar). */
const LOCAL_CONTROL_GRACE_MS = 1200;

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const minutesLabel = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);

  return `${hours > 0 ? `${hours}:` : ""}${minutesLabel}:${String(rest).padStart(2, "0")}`;
}

type MiniSliderProps = {
  ariaLabel: string;
  ariaValueText: string;
  className?: string;
  max: number;
  /** Chamado enquanto arrasta ou com as setas. */
  onChange: (value: number) => void;
  /** Chamado ao soltar (ou com as setas), para acoes mais pesadas como pular no video. */
  onCommit?: (value: number) => void;
  step: number;
  value: number;
};

/** Barra fina com arrasto, clique e teclado (setas, Home, End). Serve para a linha do tempo e para o volume. */
function MiniSlider({ ariaLabel, ariaValueText, className = "", max, onChange, onCommit, step, value }: MiniSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(value);
  const shown = dragging ? dragValue : value;
  const fraction = max > 0 ? Math.min(1, Math.max(0, shown / max)) : 0;

  function valueAt(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect();

    if (!rect || rect.width <= 0) {
      return value;
    }

    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * max;
  }

  return (
    <div
      aria-label={ariaLabel}
      aria-valuemax={Math.round(max)}
      aria-valuemin={0}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={ariaValueText}
      className={`group relative flex h-7 cursor-pointer touch-none items-center outline-none ${className}`}
      onKeyDown={(event) => {
        let next: number | null = null;

        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          next = Math.min(max, value + step);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          next = Math.max(0, value - step);
        } else if (event.key === "Home") {
          next = 0;
        } else if (event.key === "End") {
          next = max;
        }

        if (next !== null) {
          event.preventDefault();
          onChange(next);
          onCommit?.(next);
        }
      }}
      onPointerCancel={() => setDragging(false)}
      onPointerDown={(event) => {
        if (max <= 0) {
          return;
        }

        event.currentTarget.setPointerCapture(event.pointerId);
        const next = valueAt(event.clientX);

        setDragging(true);
        setDragValue(next);
        onChange(next);
      }}
      onPointerMove={(event) => {
        if (!dragging) {
          return;
        }

        const next = valueAt(event.clientX);

        setDragValue(next);
        onChange(next);
      }}
      onPointerUp={(event) => {
        if (!dragging) {
          return;
        }

        const next = valueAt(event.clientX);

        setDragging(false);
        onChange(next);
        onCommit?.(next);
      }}
      ref={trackRef}
      role="slider"
      tabIndex={0}
    >
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/25">
        <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--accent,#e50914)]" style={{ width: `${fraction * 100}%` }} />
      </div>
      <div
        className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
        style={{ left: `${fraction * 100}%` }}
      />
    </div>
  );
}

function subscribeToReducedMotion(onChange: () => void) {
  const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);

  mediaQuery.addEventListener("change", onChange);

  return () => mediaQuery.removeEventListener("change", onChange);
}

function getPrefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function subscribeNever() {
  return () => undefined;
}

/** Tamanho e posicao do iframe do YouTube dentro do container (cobrindo, cobrindo com recorte ou cabendo inteiro). */
function computeYouTubeFrame(width: number, height: number, mode: "cover" | "cover-crop" | "contain"): Frame | null {
  if (width <= 0 || height <= 0) {
    return null;
  }

  let frameWidth = width;
  let frameHeight = width / YOUTUBE_RATIO;

  if (mode === "contain") {
    if (frameHeight > height) {
      frameHeight = height;
      frameWidth = height * YOUTUBE_RATIO;
    }
  } else {
    if (frameHeight < height) {
      frameHeight = height;
      frameWidth = height * YOUTUBE_RATIO;
    }

    if (mode === "cover-crop") {
      const crop = Math.max(YOUTUBE_CROP_MIN_PX, height * YOUTUBE_CROP_RATIO);
      const neededHeight = height + crop * 2;

      if (frameHeight < neededHeight) {
        frameWidth *= neededHeight / frameHeight;
        frameHeight = neededHeight;
      }
    }
  }

  return {
    height: Math.ceil(frameHeight),
    left: Math.round((width - frameWidth) / 2),
    top: Math.round((height - frameHeight) / 2),
    width: Math.ceil(frameWidth)
  };
}

function sameFrame(a: Frame | null, b: Frame | null) {
  return Boolean(a && b && a.width === b.width && a.height === b.height && a.left === b.left && a.top === b.top);
}

export function HeroVideo({ className = "", controlsClassName = "bottom-4 right-4", options, poster, source }: HeroVideoProps) {
  const settings = normalizeHeroVideoOptions(options);
  const instanceId = useId();
  const prefersReducedMotion = useSyncExternalStore(subscribeToReducedMotion, getPrefersReducedMotion, () => false);
  // O player (iframe ou <video>) so existe no navegador, depois da hidratacao: no servidor sai a capa.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [startedByClick, setStartedByClick] = useState(false);
  // O som comeca ligado so quando a pessoa clicou para tocar (gesto dela); no autoplay, sempre mudo.
  // Fica separado de `muted` para o src do iframe nao mudar (e recarregar) a cada toque no botao de som.
  const [startMuted, setStartMuted] = useState(true);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(100);
  const [paused, setPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Enquanto arrasta a linha do tempo, mostra o tempo do arrasto e ignora o que o player reporta.
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);
  const [playerFailed, setPlayerFailed] = useState(false);
  const [fileBlocked, setFileBlocked] = useState(false);
  const [youtubePhase, setYoutubePhase] = useState<YouTubePhase>("loading");
  const [revealed, setRevealed] = useState(false);
  const [youtubePosterQuality, setYoutubePosterQuality] = useState<"hq" | "maxres">("hq");
  const [frame, setFrame] = useState<Frame | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // O que a pessoa pediu (som/pausa) enquanto o player ainda nao estava pronto para receber comandos.
  const desiredRef = useRef({ muted: true, paused: false });
  const youtubeReadyRef = useRef(false);
  // Ate quando ignorar som/volume reportados pelo player, logo depois de um ajuste feito por aqui.
  const localControlUntilRef = useRef(0);

  const autoStart = settings.autoplay && !prefersReducedMotion;
  const playerActive = mounted && !ended && !playerFailed && (autoStart || startedByClick);
  const youtube = source.kind === "youtube";
  const youtubeId = youtube ? source.id : null;
  const cropped = youtube && settings.hideBranding && !settings.nativeControls;
  // Autoplay bloqueado no YouTube: o iframe volta a receber toque para a pessoa usar o botao do proprio player.
  const youtubeNeedsTap = youtube && playerActive && youtubePhase === "blocked";
  const ownControls = playerActive && !youtubeNeedsTap && !(youtube && settings.nativeControls);
  const anyControl = settings.soundButton || settings.volumeSlider || settings.pauseButton || settings.timeline;
  const showPlayButton = mounted && !playerFailed && (!playerActive || (!youtube && fileBlocked));
  const posterSrc = poster || (youtubeId ? youtubeThumbnailUrl(youtubeId, youtubePosterQuality) : "");
  const hasFrame = frame !== null;

  const embedSrc = useMemo(() => {
    if (!youtubeId || !playerActive) {
      return null;
    }

    const params = new URLSearchParams({
      autoplay: "1",
      controls: settings.nativeControls ? "1" : "0",
      disablekb: "1",
      enablejsapi: "1",
      fs: settings.nativeControls ? "1" : "0",
      iv_load_policy: "3",
      modestbranding: "1",
      mute: startMuted ? "1" : "0",
      playsinline: "1",
      rel: "0"
    });

    if (settings.loop) {
      params.set("loop", "1");
      params.set("playlist", youtubeId);
    }

    if (typeof window !== "undefined") {
      params.set("origin", window.location.origin);
    }

    return `${YOUTUBE_EMBED_ORIGIN}/embed/${encodeURIComponent(youtubeId)}?${params.toString()}`;
    // O src so muda com o video ou com opcoes que exigem recarregar o player; som e pausa vao por mensagem.
  }, [youtubeId, playerActive, settings.nativeControls, settings.loop, startMuted]);

  // Tamanho do iframe do YouTube. clientWidth/Height ignoram transform: o modal anima o topo com scale() na abertura.
  useEffect(() => {
    if (!youtube || !playerActive) {
      return;
    }

    const container = containerRef.current;

    if (!container) {
      return;
    }

    const mode = settings.nativeControls ? "contain" : settings.hideBranding ? "cover-crop" : "cover";
    const measure = () => {
      const next = computeYouTubeFrame(container.clientWidth, container.clientHeight, mode);

      setFrame((current) => (sameFrame(current, next) ? current : next));
    };
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;

    observer?.observe(container);
    window.addEventListener("resize", measure);
    measure();

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [youtube, playerActive, settings.nativeControls, settings.hideBranding]);

  function postToYouTube(func: string, args: unknown[] = []) {
    iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ args, event: "command", func, id: instanceId }), YOUTUBE_EMBED_ORIGIN);
  }

  // Conversa com o player do YouTube: o "listening" liga os eventos (pronto, estado, erro); com eles a capa
  // so sai quando o video esta tocando, o fim sem repeticao volta para a capa, erro volta para a capa e
  // autoplay bloqueado libera o toque no proprio player.
  useEffect(() => {
    const iframe = iframeRef.current;

    if (!embedSrc || !hasFrame || !iframe) {
      return;
    }

    youtubeReadyRef.current = false;
    setYoutubePhase("loading");
    setRevealed(false);

    let gotMessage = false;
    let handshakeTries = 0;
    let handshakeTimer: ReturnType<typeof setInterval> | null = null;
    let blockedTimer: ReturnType<typeof setTimeout> | null = null;
    const revealTimer = setTimeout(() => setRevealed(true), PLAYER_REVEAL_TIMEOUT_MS);

    const sendListening = () => {
      iframe.contentWindow?.postMessage(JSON.stringify({ channel: "widget", event: "listening", id: instanceId }), YOUTUBE_EMBED_ORIGIN);
    };
    const stopHandshake = () => {
      if (handshakeTimer) {
        clearInterval(handshakeTimer);
        handshakeTimer = null;
      }
    };
    const onLoad = () => {
      sendListening();
      stopHandshake();
      // O embed ignora o "listening" se ainda nao registrou o handler: repete ate chegar a primeira mensagem.
      handshakeTimer = setInterval(() => {
        if (gotMessage || handshakeTries >= HANDSHAKE_MAX_TRIES) {
          stopHandshake();
          return;
        }

        handshakeTries += 1;
        sendListening();
      }, HANDSHAKE_RETRY_MS);
    };
    const applyDesired = () => {
      const desired = desiredRef.current;

      postToYouTube(desired.muted ? "mute" : "unMute");

      if (!desired.muted) {
        postToYouTube("setVolume", [100]);
      }

      if (desired.paused) {
        postToYouTube("pauseVideo");
      }
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== YOUTUBE_EMBED_ORIGIN || event.source !== iframe.contentWindow) {
        return;
      }

      let data: {
        event?: unknown;
        info?: { currentTime?: unknown; duration?: unknown; muted?: unknown; playerState?: unknown; volume?: unknown };
      } | null = null;

      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }

      if (!data || typeof data !== "object") {
        return;
      }

      gotMessage = true;

      if (data.event === "onReady") {
        youtubeReadyRef.current = true;
        setYoutubePhase((current) => (current === "loading" ? "ready" : current));
        applyDesired();

        if (!desiredRef.current.paused && !blockedTimer) {
          blockedTimer = setTimeout(() => {
            setYoutubePhase((current) => (current === "ready" ? "blocked" : current));
            setRevealed(true);
          }, AUTOPLAY_WAIT_MS);
        }
      } else if (data.event === "onError") {
        setPlayerFailed(true);
      } else if (data.event === "infoDelivery" && data.info) {
        const info = data.info;

        if (typeof info.currentTime === "number") {
          setCurrentTime(info.currentTime);
        }

        if (typeof info.duration === "number" && info.duration > 0) {
          setDuration(info.duration);
        }

        if (Date.now() > localControlUntilRef.current) {
          if (typeof info.volume === "number") {
            setVolume(Math.round(info.volume));
          }

          if (typeof info.muted === "boolean") {
            setMuted(info.muted);
          }
        }

        if (typeof info.playerState !== "number") {
          return;
        }

        const state = info.playerState;

        if (state === YT_PLAYING || state === YT_BUFFERING) {
          if (blockedTimer) {
            clearTimeout(blockedTimer);
            blockedTimer = null;
          }

          setYoutubePhase("playing");
          setRevealed(true);
          setPaused(false);
        } else if (state === YT_PAUSED) {
          setPaused(true);
        } else if (state === YT_ENDED && !settings.loop) {
          setEnded(true);
        }
      }
    };

    window.addEventListener("message", onMessage);
    iframe.addEventListener("load", onLoad);

    return () => {
      window.removeEventListener("message", onMessage);
      iframe.removeEventListener("load", onLoad);
      stopHandshake();
      clearTimeout(revealTimer);

      if (blockedTimer) {
        clearTimeout(blockedTimer);
      }
    };
    // instanceId e estavel; postToYouTube so usa refs. O efeito reinicia quando o iframe e recriado (src ou frame).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedSrc, hasFrame, settings.loop]);

  // Arquivo direto: descobre se o autoplay foi bloqueado (a promessa de play() falha) para mostrar o botao de tocar.
  useEffect(() => {
    const video = videoRef.current;

    if (youtube || !playerActive || !video) {
      return;
    }

    let cancelled = false;

    video.play().then(
      () => {
        if (!cancelled) {
          setFileBlocked(false);
        }
      },
      () => {
        if (!cancelled) {
          setFileBlocked(true);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [youtube, playerActive, source]);

  // Ao tocar pelo teclado o botao de tocar some; o foco segue para o primeiro controle (som/pausa) ou para o topo.
  useEffect(() => {
    if (!startedByClick) {
      return;
    }

    const target = controlsRef.current?.querySelector<HTMLElement>("button") ?? containerRef.current;

    target?.focus({ preventScroll: true });
  }, [startedByClick]);

  function startByClick() {
    const video = videoRef.current;

    desiredRef.current = { muted: false, paused: false };
    setStartMuted(false);
    setMuted(false);
    setPaused(false);
    setEnded(false);
    setPlayerFailed(false);

    if (!youtube && playerActive && video) {
      // O <video> ja existe (autoplay bloqueado): o clique e o gesto que libera a reproducao.
      video.muted = false;
      void video.play().then(() => setFileBlocked(false)).catch(() => setFileBlocked(true));
      return;
    }

    setStartedByClick(true);
  }

  function toggleSound() {
    const nextMuted = !muted;

    desiredRef.current.muted = nextMuted;
    localControlUntilRef.current = Date.now() + LOCAL_CONTROL_GRACE_MS;
    setMuted(nextMuted);

    if (youtube) {
      if (youtubeReadyRef.current) {
        postToYouTube(nextMuted ? "mute" : "unMute");

        if (!nextMuted) {
          postToYouTube("setVolume", [100]);
        }
      }
    } else if (videoRef.current) {
      videoRef.current.muted = nextMuted;
    }
  }

  function changeVolume(nextVolume: number) {
    const level = Math.round(Math.min(100, Math.max(0, nextVolume)));
    const nextMuted = level === 0;

    desiredRef.current.muted = nextMuted;
    localControlUntilRef.current = Date.now() + LOCAL_CONTROL_GRACE_MS;
    setVolume(level);
    setMuted(nextMuted);

    if (youtube) {
      if (youtubeReadyRef.current) {
        postToYouTube("setVolume", [level]);
        postToYouTube(nextMuted ? "mute" : "unMute");
      }
    } else if (videoRef.current) {
      videoRef.current.volume = level / 100;
      videoRef.current.muted = nextMuted;
    }
  }

  function seekTo(seconds: number) {
    const target = Math.min(duration > 0 ? duration : seconds, Math.max(0, seconds));

    setCurrentTime(target);

    if (youtube) {
      if (youtubeReadyRef.current) {
        postToYouTube("seekTo", [target, true]);
      }
    } else if (videoRef.current) {
      videoRef.current.currentTime = target;
    }
  }

  function togglePause() {
    const nextPaused = !paused;

    desiredRef.current.paused = nextPaused;
    setPaused(nextPaused);

    if (youtube) {
      if (youtubeReadyRef.current) {
        postToYouTube(nextPaused ? "pauseVideo" : "playVideo");
      }
    } else if (videoRef.current) {
      if (nextPaused) {
        videoRef.current.pause();
      } else {
        void videoRef.current.play().catch(() => undefined);
      }
    }
  }

  // Duas camadas irmas: a midia fica por baixo dos degrades e do titulo do topo (a animacao de entrada cria um
  // contexto de empilhamento proprio), e os botoes ficam numa camada acima de tudo, transparente ao mouse fora deles.
  return (
    <>
    <div className={`${className} overflow-hidden outline-none`} data-hero-video={source.kind} ref={containerRef} tabIndex={-1}>
      {/* Capa: fica por baixo do player ate ele comecar a tocar e e tudo o que aparece sem autoplay. */}
      {posterSrc ? (
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: cssImageUrl(posterSrc) }}>
          {youtubeId && !poster && youtubePosterQuality === "hq" ? (
            // Sonda oculta da miniatura grande: o YouTube responde 404 com uma imagem de 120x90, entao a
            // decisao e pelo tamanho carregado. Comeca na padrao (sempre existe) e sobe para a grande se houver.
            // eslint-disable-next-line @next/next/no-img-element -- nao e uma imagem exibida, so a sonda de tamanho
            <img
              alt=""
              aria-hidden="true"
              className="hidden"
              onLoad={(event) => {
                if (event.currentTarget.naturalWidth > 120) {
                  setYoutubePosterQuality("maxres");
                }
              }}
              src={youtubeThumbnailUrl(youtubeId, "maxres")}
            />
          ) : null}
        </div>
      ) : null}

      {playerActive && !youtube ? (
        <video
          aria-hidden="true"
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
          loop={settings.loop}
          muted={muted}
          onEnded={() => {
            if (!settings.loop) {
              setEnded(true);
            }
          }}
          onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
          onError={() => setPlayerFailed(true)}
          onPause={() => setPaused(true)}
          onPlay={() => setPaused(false)}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onVolumeChange={(event) => {
            setVolume(Math.round(event.currentTarget.volume * 100));
            setMuted(event.currentTarget.muted);
          }}
          playsInline
          poster={posterSrc || undefined}
          ref={videoRef}
          src={source.src}
        />
      ) : null}

      {playerActive && youtube && embedSrc && frame ? (
        <iframe
          allow={settings.nativeControls ? "autoplay; encrypted-media; fullscreen; picture-in-picture" : "autoplay; encrypted-media; picture-in-picture"}
          allowFullScreen={settings.nativeControls}
          aria-hidden={cropped && !youtubeNeedsTap ? "true" : undefined}
          className={`absolute border-0 transition-opacity duration-300 ${revealed ? "opacity-100" : "opacity-0"} ${
            cropped && !youtubeNeedsTap ? "pointer-events-none" : ""
          }`}
          ref={iframeRef}
          referrerPolicy="strict-origin-when-cross-origin"
          src={embedSrc}
          style={{ height: frame.height, left: frame.left, top: frame.top, width: frame.width }}
          tabIndex={cropped && !youtubeNeedsTap ? -1 : undefined}
          title="Vídeo de destaque"
        />
      ) : null}
    </div>

    {showPlayButton || (ownControls && anyControl) ? (
      <div className="pointer-events-none absolute inset-0 z-30" data-hero-video-controls="" ref={controlsRef}>
        {showPlayButton ? (
          <button
            aria-label="Tocar vídeo de destaque"
            className="pointer-events-auto absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white/92 text-black shadow-2xl shadow-black/40 transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            onClick={startByClick}
            type="button"
          >
            <Play className="h-7 w-7 fill-current" />
          </button>
        ) : null}

        {ownControls && anyControl ? (
          /* Grupo de controles nossos: so os que o produtor ligou, numa pilula escura no canto do video. */
          <div
            className={`pointer-events-auto absolute flex max-w-[calc(100%-2rem)] items-center gap-1 rounded-full bg-black/70 px-1.5 py-1 text-white shadow-lg shadow-black/30 backdrop-blur-sm ${controlsClassName}`}
            data-hero-video-controlbar=""
          >
            {settings.pauseButton ? (
              <button aria-label={paused ? "Continuar vídeo" : "Pausar vídeo"} className={CONTROL_BUTTON} onClick={togglePause} type="button">
                {paused ? <Play className="h-4 w-4 fill-current" /> : <Pause className="h-4 w-4 fill-current" />}
              </button>
            ) : null}
            {settings.timeline ? (
              <div className="flex min-w-0 items-center gap-2 px-1">
                <MiniSlider
                  ariaLabel="Linha do tempo"
                  ariaValueText={`${formatClock(scrubTime ?? currentTime)} de ${formatClock(duration)}`}
                  className="w-24 sm:w-36"
                  max={duration}
                  onChange={(value) => setScrubTime(value)}
                  onCommit={(value) => {
                    setScrubTime(null);
                    seekTo(value);
                  }}
                  step={TIMELINE_KEY_STEP_SECONDS}
                  value={scrubTime ?? currentTime}
                />
                <span className="text-[11px] font-semibold tabular-nums text-zinc-200">
                  {formatClock(scrubTime ?? currentTime)} / {formatClock(duration)}
                </span>
              </div>
            ) : null}
            {settings.soundButton || settings.volumeSlider ? (
              <div className="flex items-center gap-1">
                {settings.soundButton ? (
                  <button aria-label={muted ? "Ativar som" : "Desativar som"} aria-pressed={!muted} className={CONTROL_BUTTON} onClick={toggleSound} type="button">
                    {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : volume < 50 ? <Volume1 className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                  </button>
                ) : null}
                {settings.volumeSlider ? (
                  <MiniSlider
                    ariaLabel="Volume"
                    ariaValueText={muted ? "Sem som" : `${volume}%`}
                    className="w-14 pr-1"
                    max={100}
                    onChange={changeVolume}
                    step={VOLUME_KEY_STEP}
                    value={muted ? 0 : volume}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null}
    </>
  );
}
