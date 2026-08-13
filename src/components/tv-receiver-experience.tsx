"use client";

import Image from "next/image";
import {
  AlertCircle,
  CheckCircle2,
  LoaderCircle,
  Maximize,
  Minimize,
  MonitorPlay,
  Play,
  RotateCcw,
  Tv
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import {
  YouTubeManualStreamPlayer,
  type YouTubeManualPlayerController
} from "@/components/youtube-manual-stream-player";
import { findActiveCaptionCue } from "@/lib/media-captions";
import {
  isTvPlaybackRate,
  normalizeTvPlaybackRates,
  type TvCommand
} from "@/lib/tv-session-contract";

type TvPlaybackState = "buffering" | "ended" | "paused" | "playing" | "unstarted";

type TvSession = {
  availablePlaybackRates: number[];
  commandRevision: number;
  currentTimeSeconds: number;
  durationSeconds: number;
  expiresAt: string;
  id: string;
  lastCommand: TvCommand | null;
  playbackRate: number;
  playbackState: TvPlaybackState;
  receiverCommandRevision: number;
  status: "connected" | "ended" | "pending";
};

type TvLesson = {
  durationLabel: string;
  id: string;
  posterUrl: string | null;
  title: string;
  video: {
    assetId: string;
    provider: "youtube";
  };
};

type ReceiverResponse = {
  data?: {
    lesson?: TvLesson;
    receiverToken?: string;
    session: TvSession;
  };
  error?: string;
};

type TvCaptionCue = {
  durationSeconds: number;
  startSeconds: number;
  text: string;
};

type TvCaptionsResponse = {
  cues?: TvCaptionCue[];
  error?: string;
};

type TvAudioStream = {
  url: string;
};

type TvVideoStream = {
  height: number;
  label: string;
  url: string;
  width: number;
};

type TvStreamsResponse = {
  audio?: TvAudioStream;
  error?: string;
  qualities?: TvVideoStream[];
};

type TvYouTubePlayer = {
  destroy?: () => void;
  getAvailablePlaybackRates?: () => number[];
  getCaptionTime?: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlaybackRate?: () => number;
  getPlayerState?: () => number;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate?: (playbackRate: number) => void;
  setVolume?: (volume: number) => void;
  mute?: () => void;
  unloadModule?: (module: string) => void;
  unMute?: () => void;
};

type YouTubeEvent = { target: TvYouTubePlayer };
type YouTubePlaybackRateEvent = YouTubeEvent & { data: number };
type YouTubeStateEvent = YouTubeEvent & { data: number };

type TvYouTubeNamespace = {
  Player: new (
    iframe: HTMLIFrameElement,
    options: {
      events: {
        onAutoplayBlocked?: () => void;
        onError?: () => void;
        onPlaybackRateChange?: (event: YouTubePlaybackRateEvent) => void;
        onReady?: (event: YouTubeEvent) => void;
        onStateChange?: (event: YouTubeStateEvent) => void;
      };
    }
  ) => TvYouTubePlayer;
};

type TvWindow = Omit<Window, "YT" | "onYouTubeIframeAPIReady"> & {
  YT?: TvYouTubeNamespace;
  onYouTubeIframeAPIReady?: () => void;
};

type TvFullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
};

type TvFullscreenElement = HTMLDivElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const receiverStorageKey = "bunker707.tv.receiver";
const captionRefreshIntervalMs = 50;
const receiverCommandPollDelayMs = 250;
const receiverControlsHideDelayMs = 2_400;
let youTubeApiPromise: Promise<void> | null = null;

function loadYouTubeApi() {
  if (typeof window === "undefined") return Promise.resolve();
  const tvWindow = window as unknown as TvWindow;
  if (tvWindow.YT?.Player) return Promise.resolve();
  if (youTubeApiPromise) return youTubeApiPromise;

  youTubeApiPromise = new Promise<void>((resolve, reject) => {
    const previousCallback = tvWindow.onYouTubeIframeAPIReady;
    tvWindow.onYouTubeIframeAPIReady = () => {
      previousCallback?.();
      resolve();
    };

    const existingScript = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
    if (existingScript) {
      const startedAt = Date.now();
      const interval = window.setInterval(() => {
        if (tvWindow.YT?.Player) {
          window.clearInterval(interval);
          resolve();
        } else if (Date.now() - startedAt > 15_000) {
          window.clearInterval(interval);
          reject(new Error("Não foi possível carregar o player desta aula."));
        }
      }, 100);
      return;
    }

    const script = document.createElement("script");
    script.async = true;
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => reject(new Error("Não foi possível carregar o player desta aula."));
    document.head.appendChild(script);
  });

  return youTubeApiPromise;
}

function getPlaybackState(value: number): TvPlaybackState {
  if (value === 0) return "ended";
  if (value === 1) return "playing";
  if (value === 2 || value === 5) return "paused";
  if (value === 3) return "buffering";
  return "unstarted";
}

function getPlayerMetric(read: () => number) {
  try {
    const value = read();
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  } catch {
    return 0;
  }
}

function getYouTubePoster(assetId: string, configuredPoster: string | null) {
  return configuredPoster || `https://i.ytimg.com/vi/${assetId}/maxresdefault.jpg`;
}

function formatPlaybackTime(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function getQualityLabel(quality: string) {
  if (quality === "auto") return "Automático";
  const height = Number.parseInt(quality, 10);
  if (height >= 2160) return "4K";
  if (height >= 1440) return "2K";
  return quality;
}

export function TvReceiverExperience() {
  const [activeCaption, setActiveCaption] = useState<TvCaptionCue | null>(null);
  const [code, setCode] = useState("");
  const [captionCues, setCaptionCues] = useState<TvCaptionCue[]>([]);
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [displayCurrentTime, setDisplayCurrentTime] = useState(0);
  const [displayDuration, setDisplayDuration] = useState(0);
  const [error, setError] = useState("");
  const [fullscreenError, setFullscreenError] = useState("");
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [initialStartSeconds, setInitialStartSeconds] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [lesson, setLesson] = useState<TvLesson | null>(null);
  const [needsPlaybackActivation, setNeedsPlaybackActivation] = useState(false);
  const [origin] = useState(() => typeof window === "undefined" ? "" : window.location.origin);
  const [phase, setPhase] = useState<"connected" | "connecting" | "ended" | "enter">("enter");
  const [playbackState, setPlaybackState] = useState<TvPlaybackState>("paused");
  const [playerReady, setPlayerReady] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [selectedQuality, setSelectedQuality] = useState("auto");
  const [session, setSession] = useState<TvSession | null>(null);
  const [syncError, setSyncError] = useState("");
  const [tvStreams, setTvStreams] = useState<{ audio: TvAudioStream | null; qualities: TvVideoStream[] }>({
    audio: null,
    qualities: []
  });
  const [volume, setVolume] = useState(100);
  const [muted, setMuted] = useState(false);
  const [manualSwitch, setManualSwitch] = useState({ seconds: 0, shouldPlay: false, token: 0 });
  const appliedCommandRevisionRef = useRef(0);
  const availablePlaybackRatesRef = useRef<number[]>([1]);
  const controlsHideTimeoutRef = useRef<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const playerFrameRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<TvYouTubePlayer | null>(null);
  const pendingPlaybackRateCommandRef = useRef<{ revision: number; timeoutId: number } | null>(null);
  const pendingSyncCommandRef = useRef<Extract<TvCommand, { type: "sync_player" }> | null>(null);
  const playbackRateRef = useRef(1);
  const playbackStateRef = useRef<TvPlaybackState>("paused");
  const receiverTokenRef = useRef("");
  const selectedQualityRef = useRef("auto");

  const clearControlsHideTimeout = useCallback(() => {
    if (controlsHideTimeoutRef.current !== null) {
      window.clearTimeout(controlsHideTimeoutRef.current);
      controlsHideTimeoutRef.current = null;
    }
  }, []);

  const revealControlsTemporarily = useCallback(() => {
    clearControlsHideTimeout();
    setControlsVisible(true);
    controlsHideTimeoutRef.current = window.setTimeout(() => {
      setControlsVisible(false);
      controlsHideTimeoutRef.current = null;
    }, receiverControlsHideDelayMs);
  }, [clearControlsHideTimeout]);

  const hideControls = useCallback(() => {
    clearControlsHideTimeout();
    setControlsVisible(false);
  }, [clearControlsHideTimeout]);

  useEffect(() => clearControlsHideTimeout, [clearControlsHideTimeout]);

  useEffect(() => () => {
    const pendingCommand = pendingPlaybackRateCommandRef.current;
    if (pendingCommand) window.clearTimeout(pendingCommand.timeoutId);
  }, []);

  useEffect(() => {
    const fullscreenDocument = document as TvFullscreenDocument;
    const updateFullscreenState = () => {
      setIsFullscreen(Boolean(document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement));
    };

    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);
    document.addEventListener("webkitfullscreenchange", updateFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
      document.removeEventListener("webkitfullscreenchange", updateFullscreenState);
    };
  }, []);

  const capturePlayerPlaybackRate = useCallback((player: TvYouTubePlayer) => {
    let reportedPlaybackRate = playbackRateRef.current;
    let reportedPlaybackRates = availablePlaybackRatesRef.current;

    try {
      const value = player.getPlaybackRate?.();
      if (isTvPlaybackRate(value)) reportedPlaybackRate = value;
    } catch {
      // The provider can be between playback engines while a command is applied.
    }

    try {
      reportedPlaybackRates = normalizeTvPlaybackRates([
        ...(player.getAvailablePlaybackRates?.() ?? reportedPlaybackRates),
        reportedPlaybackRate
      ]);
    } catch {
      reportedPlaybackRates = normalizeTvPlaybackRates([
        ...reportedPlaybackRates,
        reportedPlaybackRate
      ]);
    }

    playbackRateRef.current = reportedPlaybackRate;
    availablePlaybackRatesRef.current = reportedPlaybackRates;
    setPlaybackRate(reportedPlaybackRate);

    return {
      availablePlaybackRates: reportedPlaybackRates,
      playbackRate: reportedPlaybackRate
    };
  }, []);

  const confirmPendingPlaybackRateCommand = useCallback((player: TvYouTubePlayer) => {
    const pendingCommand = pendingPlaybackRateCommandRef.current;
    capturePlayerPlaybackRate(player);

    if (!pendingCommand) return;
    window.clearTimeout(pendingCommand.timeoutId);
    appliedCommandRevisionRef.current = Math.max(
      appliedCommandRevisionRef.current,
      pendingCommand.revision
    );
    pendingPlaybackRateCommandRef.current = null;
  }, [capturePlayerPlaybackRate]);

  const applyPlayerSync = useCallback((player: TvYouTubePlayer, command: Extract<TvCommand, { type: "sync_player" }>) => {
    setCaptionsEnabled(command.captionsEnabled);
    setMuted(command.muted);
    setVolume(command.volume);

    try {
      player.unloadModule?.("captions");
    } catch {
      // Native YouTube captions stay disabled; the receiver renders the Bunker707 track.
    }

    player.setVolume?.(command.volume);
    player.setPlaybackRate?.(command.playbackRate);
    capturePlayerPlaybackRate(player);

    if (command.muted || command.volume === 0) {
      player.mute?.();
    } else {
      player.unMute?.();
    }

    player.seekTo(command.currentTimeSeconds, true);
    if (command.shouldPlay) {
      player.playVideo();
    } else {
      player.pauseVideo();
    }
  }, [capturePlayerPlaybackRate]);

  const saveReceiverCredentials = useCallback((sessionId: string, receiverToken: string) => {
    receiverTokenRef.current = receiverToken;
    window.sessionStorage.setItem(receiverStorageKey, JSON.stringify({ receiverToken, sessionId }));
  }, []);

  const clearReceiverCredentials = useCallback(() => {
    receiverTokenRef.current = "";
    window.sessionStorage.removeItem(receiverStorageKey);
  }, []);

  const connectWithCode = useCallback(async (pairingCode: string) => {
    const safeCode = normalizeCode(pairingCode);
    if (safeCode.length !== 6) {
      setError("Digite o codigo de seis caracteres exibido na plataforma.");
      return;
    }

    setPhase("connecting");
    setError("");

    try {
      const response = await fetch("/api/tv/connect", {
        body: JSON.stringify({ code: safeCode }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json() as ReceiverResponse;

      if (!response.ok || !payload.data?.lesson || !payload.data.receiverToken || !payload.data.session) {
        throw new Error(payload.error ?? "Nao foi possivel conectar esta TV.");
      }

      saveReceiverCredentials(payload.data.session.id, payload.data.receiverToken);
      appliedCommandRevisionRef.current = payload.data.session.receiverCommandRevision;
      setInitialStartSeconds(payload.data.session.currentTimeSeconds);
      setDisplayCurrentTime(payload.data.session.currentTimeSeconds);
      setDisplayDuration(payload.data.session.durationSeconds);
      setCaptionCues([]);
      setCaptionsEnabled(false);
      setHasPlaybackStarted(false);
      setManualSwitch({ seconds: payload.data.session.currentTimeSeconds, shouldPlay: false, token: 0 });
      setMuted(false);
      const sessionPlaybackRate = isTvPlaybackRate(payload.data.session.playbackRate)
        ? payload.data.session.playbackRate
        : 1;
      playbackRateRef.current = sessionPlaybackRate;
      availablePlaybackRatesRef.current = normalizeTvPlaybackRates([
        ...(payload.data.session.availablePlaybackRates ?? []),
        sessionPlaybackRate
      ]);
      setPlaybackRate(sessionPlaybackRate);
      setSelectedQuality("auto");
      selectedQualityRef.current = "auto";
      setTvStreams({ audio: null, qualities: [] });
      setVolume(100);
      setLesson(payload.data.lesson);
      setSession(payload.data.session);
      setPlaybackState(payload.data.session.playbackState);
      playbackStateRef.current = payload.data.session.playbackState;
      revealControlsTemporarily();
      setPhase("connected");
      setCode("");
      window.history.replaceState(null, "", "/tv");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Nao foi possivel conectar esta TV.");
      setPhase("enter");
    }
  }, [revealControlsTemporarily, saveReceiverCredentials]);

  const restoreReceiver = useCallback(async (sessionId: string, receiverToken: string) => {
    setPhase("connecting");
    setError("");

    try {
      const response = await fetch(`/api/tv/receiver/${encodeURIComponent(sessionId)}?includeLesson=1`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${receiverToken}` }
      });
      const payload = await response.json() as ReceiverResponse;

      if (!response.ok || !payload.data?.lesson || !payload.data.session) {
        throw new Error(payload.error ?? "A sessao salva nao esta mais disponivel.");
      }

      receiverTokenRef.current = receiverToken;
      appliedCommandRevisionRef.current = payload.data.session.receiverCommandRevision;
      setInitialStartSeconds(payload.data.session.currentTimeSeconds);
      setDisplayCurrentTime(payload.data.session.currentTimeSeconds);
      setDisplayDuration(payload.data.session.durationSeconds);
      setCaptionCues([]);
      setCaptionsEnabled(false);
      setHasPlaybackStarted(false);
      setManualSwitch({ seconds: payload.data.session.currentTimeSeconds, shouldPlay: false, token: 0 });
      setMuted(false);
      const sessionPlaybackRate = isTvPlaybackRate(payload.data.session.playbackRate)
        ? payload.data.session.playbackRate
        : 1;
      playbackRateRef.current = sessionPlaybackRate;
      availablePlaybackRatesRef.current = normalizeTvPlaybackRates([
        ...(payload.data.session.availablePlaybackRates ?? []),
        sessionPlaybackRate
      ]);
      setPlaybackRate(sessionPlaybackRate);
      setSelectedQuality("auto");
      selectedQualityRef.current = "auto";
      setTvStreams({ audio: null, qualities: [] });
      setVolume(100);
      setLesson(payload.data.lesson);
      setSession(payload.data.session);
      setPlaybackState(payload.data.session.playbackState);
      playbackStateRef.current = payload.data.session.playbackState;
      revealControlsTemporarily();
      setPhase(payload.data.session.status === "ended" ? "ended" : "connected");
    } catch (requestError) {
      clearReceiverCredentials();
      setError(requestError instanceof Error ? requestError.message : "A sessao salva nao esta mais disponivel.");
      setPhase("enter");
    }
  }, [clearReceiverCredentials, revealControlsTemporarily]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const queryCode = normalizeCode(new URLSearchParams(window.location.search).get("code") ?? "");

      if (queryCode.length === 6) {
        setCode(queryCode);
        window.history.replaceState(null, "", "/tv");
        void connectWithCode(queryCode);
        return;
      }

      try {
        const saved = JSON.parse(window.sessionStorage.getItem(receiverStorageKey) ?? "null") as {
          receiverToken?: unknown;
          sessionId?: unknown;
        } | null;

        if (typeof saved?.sessionId === "string" && typeof saved.receiverToken === "string") {
          void restoreReceiver(saved.sessionId, saved.receiverToken);
        }
      } catch {
        clearReceiverCredentials();
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [clearReceiverCredentials, connectWithCode, restoreReceiver]);

  useEffect(() => {
    const sessionId = session?.id ?? "";
    if (phase !== "connected" || !sessionId || !lesson) return;
    const controller = new AbortController();

    void fetch(`/api/tv/receiver/${encodeURIComponent(sessionId)}/captions?language=pt`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${receiverTokenRef.current}` },
      signal: controller.signal
    }).then(async (response) => {
      const payload = await response.json() as TvCaptionsResponse;
      if (!response.ok) throw new Error(payload.error ?? "Legendas indisponiveis.");
      return (payload.cues ?? []).filter((cue) => (
        Number.isFinite(cue.startSeconds) &&
        cue.startSeconds >= 0 &&
        Number.isFinite(cue.durationSeconds) &&
        cue.durationSeconds >= 0 &&
        typeof cue.text === "string" &&
        cue.text.trim().length > 0
      ));
    }).then((cues) => {
      if (!controller.signal.aborted) setCaptionCues(cues);
    }).catch(() => {
      if (!controller.signal.aborted) setCaptionCues([]);
    });

    return () => controller.abort();
  }, [lesson, phase, session?.id]);

  useEffect(() => {
    const sessionId = session?.id ?? "";
    if (phase !== "connected" || !sessionId || selectedQuality === "auto") {
      return;
    }
    const controller = new AbortController();

    void fetch(`/api/tv/receiver/${encodeURIComponent(sessionId)}/streams`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${receiverTokenRef.current}` },
      signal: controller.signal
    }).then(async (response) => {
      const payload = await response.json() as TvStreamsResponse;
      if (!response.ok || !payload.audio || !payload.qualities) {
        throw new Error(payload.error ?? "Qualidade indisponivel.");
      }
      if (!payload.qualities.some((quality) => quality.label === selectedQuality)) {
        throw new Error("A resolucao escolhida nao esta disponivel para esta TV.");
      }
      return { audio: payload.audio, qualities: payload.qualities };
    }).then((streams) => {
      if (!controller.signal.aborted) {
        setTvStreams(streams);
        setSyncError("");
      }
    }).catch((streamError) => {
      if (!controller.signal.aborted) {
        setError(streamError instanceof Error ? streamError.message : "Nao foi possivel carregar a qualidade escolhida.");
      }
    });

    return () => controller.abort();
  }, [phase, selectedQuality, session?.id]);

  const embedUrl = useMemo(() => {
    if (!lesson || !origin) return "";
    const params = new URLSearchParams({
      autoplay: "0",
      cc_load_policy: "0",
      controls: "0",
      disablekb: "1",
      enablejsapi: "1",
      fs: "0",
      iv_load_policy: "3",
      modestbranding: "1",
      origin,
      playsinline: "1",
      rel: "0",
      start: String(Math.max(0, Math.floor(initialStartSeconds)))
    });
    return `https://www.youtube-nocookie.com/embed/${lesson.video.assetId}?${params}`;
  }, [initialStartSeconds, lesson, origin]);

  useEffect(() => {
    if (phase !== "connected" || selectedQuality !== "auto" || !embedUrl || !iframeRef.current) return;
    let cancelled = false;
    const iframe = iframeRef.current;

    void loadYouTubeApi().then(() => {
      const tvWindow = window as unknown as TvWindow;
      if (cancelled || !tvWindow.YT?.Player) return;
      playerRef.current = new tvWindow.YT.Player(iframe, {
        events: {
          onAutoplayBlocked: () => setNeedsPlaybackActivation(true),
          onError: () => setError("Não foi possível reproduzir esta aula na TV."),
          onPlaybackRateChange: ({ data, target }) => {
            if (cancelled) return;
            if (isTvPlaybackRate(data)) {
              playbackRateRef.current = data;
              setPlaybackRate(data);
            }
            confirmPendingPlaybackRateCommand(target);
          },
          onReady: ({ target }) => {
            if (cancelled) return;
            playerRef.current = target;
            try {
              target.unloadModule?.("captions");
            } catch {
              // The receiver renders its own caption track.
            }
            capturePlayerPlaybackRate(target);
            setPlayerReady(true);
            if (initialStartSeconds > 0) target.seekTo(initialStartSeconds, true);
            target.pauseVideo();
          },
          onStateChange: ({ data }) => {
            const nextState = getPlaybackState(data);
            playbackStateRef.current = nextState;
            setPlaybackState(nextState);
            if (nextState === "playing") {
              try {
                playerRef.current?.unloadModule?.("captions");
              } catch {
                // Keep provider captions disabled after YouTube reloads player modules.
              }
              setHasPlaybackStarted(true);
              setNeedsPlaybackActivation(false);
            }
          }
        }
      });
    }).catch((apiError) => {
      if (!cancelled) setError(apiError instanceof Error ? apiError.message : "Nao foi possivel carregar o player.");
    });

    return () => {
      cancelled = true;
      setPlayerReady(false);
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [capturePlayerPlaybackRate, confirmPendingPlaybackRateCommand, embedUrl, initialStartSeconds, phase, selectedQuality]);

  useEffect(() => {
    if (phase !== "connected" || !session || !playerReady || !playerRef.current) return;
    if (session.commandRevision <= appliedCommandRevisionRef.current || !session.lastCommand) return;

    const timeout = window.setTimeout(() => {
      const player = playerRef.current;
      const command = session.lastCommand;
      if (!player || !command) return;

      if (command.type === "sync_player") {
        pendingSyncCommandRef.current = command;
        setCaptionsEnabled(command.captionsEnabled);
        setDisplayCurrentTime(command.currentTimeSeconds);
        setMuted(command.muted);
        setVolume(command.volume);

        if (command.quality !== selectedQualityRef.current) {
          player.pauseVideo();
          setHasPlaybackStarted(false);
          setInitialStartSeconds(command.currentTimeSeconds);
          setManualSwitch((current) => ({
            seconds: command.currentTimeSeconds,
            shouldPlay: command.shouldPlay,
            token: current.token + 1
          }));
          selectedQualityRef.current = command.quality;
          setSelectedQuality(command.quality);
          setPlayerReady(false);
          if (command.quality === "auto") setTvStreams({ audio: null, qualities: [] });
          return;
        }

        applyPlayerSync(player, command);
        pendingSyncCommandRef.current = null;
      } else if (command.type === "play") {
        player.playVideo();
      } else if (command.type === "pause") {
        player.pauseVideo();
      } else if (command.type === "set_playback_rate") {
        if (pendingPlaybackRateCommandRef.current?.revision === session.commandRevision) return;
        player.setPlaybackRate?.(command.playbackRate);
        if (selectedQualityRef.current === "auto") {
          const confirmationTimeout = window.setTimeout(() => {
            confirmPendingPlaybackRateCommand(player);
          }, 500);
          pendingPlaybackRateCommandRef.current = {
            revision: session.commandRevision,
            timeoutId: confirmationTimeout
          };
          capturePlayerPlaybackRate(player);
          return;
        }
        capturePlayerPlaybackRate(player);
      } else if (command.type === "seek_relative") {
        const currentTime = getPlayerMetric(() => player.getCurrentTime());
        const duration = getPlayerMetric(() => player.getDuration());
        player.seekTo(Math.min(Math.max(currentTime + command.seconds, 0), duration || Number.MAX_SAFE_INTEGER), true);
      }

      appliedCommandRevisionRef.current = session.commandRevision;
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [applyPlayerSync, capturePlayerPlaybackRate, confirmPendingPlaybackRateCommand, phase, playerReady, session]);

  useEffect(() => {
    const sessionId = session?.id ?? "";
    if (phase !== "connected" || !sessionId) return;
    let cancelled = false;
    let nextPollTimeout: number | null = null;

    const poll = async () => {
      try {
        const response = await fetch(`/api/tv/receiver/${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${receiverTokenRef.current}` }
        });
        const payload = await response.json() as ReceiverResponse;

        if (!response.ok || !payload.data?.session) {
          throw new Error(payload.error ?? "A conexao com a plataforma foi interrompida.");
        }

        if (cancelled) return;
        setSyncError("");
        setSession(payload.data.session);

        if (payload.data.session.status === "ended") {
          playerRef.current?.pauseVideo();
          clearReceiverCredentials();
          setPhase("ended");
        }
      } catch (requestError) {
        if (!cancelled) setSyncError(requestError instanceof Error ? requestError.message : "Reconectando...");
      } finally {
        if (!cancelled) {
          nextPollTimeout = window.setTimeout(() => void poll(), receiverCommandPollDelayMs);
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (nextPollTimeout !== null) window.clearTimeout(nextPollTimeout);
    };
  }, [clearReceiverCredentials, phase, session?.id]);

  useEffect(() => {
    const sessionId = session?.id ?? "";
    if (phase !== "connected" || !sessionId || !playerReady) return;
    let cancelled = false;

    const heartbeat = async () => {
      const player = playerRef.current;
      if (!player) return;
      const currentTimeSeconds = getPlayerMetric(() => player.getCurrentTime());
      const durationSeconds = getPlayerMetric(() => player.getDuration());
      const playbackMetrics = capturePlayerPlaybackRate(player);
      setDisplayCurrentTime(currentTimeSeconds);
      setDisplayDuration(durationSeconds);

      try {
        const response = await fetch(`/api/tv/receiver/${encodeURIComponent(sessionId)}`, {
          body: JSON.stringify({
            appliedCommandRevision: appliedCommandRevisionRef.current,
            availablePlaybackRates: playbackMetrics.availablePlaybackRates,
            currentTimeSeconds,
            durationSeconds,
            playbackRate: playbackMetrics.playbackRate,
            playbackState: playbackStateRef.current
          }),
          headers: {
            Authorization: `Bearer ${receiverTokenRef.current}`,
            "Content-Type": "application/json"
          },
          method: "PUT"
        });
        const payload = await response.json() as ReceiverResponse;

        if (!response.ok || !payload.data?.session) {
          throw new Error(payload.error ?? "Nao foi possivel salvar o progresso.");
        }

        if (!cancelled) {
          setSession(payload.data.session);
          setSyncError("");
        }
      } catch (requestError) {
        if (!cancelled) setSyncError(requestError instanceof Error ? requestError.message : "Reconectando...");
      }
    };

    void heartbeat();
    const interval = window.setInterval(() => void heartbeat(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [capturePlayerPlaybackRate, phase, playerReady, session?.id]);

  useEffect(() => {
    if (phase !== "connected" || !playerReady) return;
    const refreshMetrics = () => {
      const player = playerRef.current;
      if (!player) return;
      setDisplayCurrentTime(getPlayerMetric(() => player.getCurrentTime()));
      setDisplayDuration(getPlayerMetric(() => player.getDuration()));
    };

    refreshMetrics();
    const interval = window.setInterval(refreshMetrics, 200);
    return () => window.clearInterval(interval);
  }, [phase, playerReady, selectedQuality]);

  useEffect(() => {
    if (
      phase !== "connected" ||
      !playerReady ||
      !captionsEnabled ||
      !hasPlaybackStarted ||
      captionCues.length === 0
    ) {
      return;
    }

    const refreshCaption = () => {
      const player = playerRef.current;
      if (!player) return;
      const captionTime = getPlayerMetric(() => player.getCaptionTime?.() ?? player.getCurrentTime());
      const nextCaption = findActiveCaptionCue(captionCues, captionTime);
      setActiveCaption((currentCaption) => currentCaption === nextCaption ? currentCaption : nextCaption);
    };

    refreshCaption();
    const interval = window.setInterval(refreshCaption, captionRefreshIntervalMs);
    return () => window.clearInterval(interval);
  }, [captionCues, captionsEnabled, hasPlaybackStarted, phase, playerReady, selectedQuality]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void connectWithCode(code);
  }

  function resetReceiver() {
    clearReceiverCredentials();
    clearControlsHideTimeout();
    playerRef.current?.destroy?.();
    playerRef.current = null;
    setCode("");
    setActiveCaption(null);
    setCaptionCues([]);
    setCaptionsEnabled(false);
    setControlsVisible(true);
    setDisplayCurrentTime(0);
    setDisplayDuration(0);
    setError("");
    setHasPlaybackStarted(false);
    setInitialStartSeconds(0);
    setLesson(null);
    setManualSwitch({ seconds: 0, shouldPlay: false, token: 0 });
    setMuted(false);
    setNeedsPlaybackActivation(false);
    if (pendingPlaybackRateCommandRef.current) {
      window.clearTimeout(pendingPlaybackRateCommandRef.current.timeoutId);
      pendingPlaybackRateCommandRef.current = null;
    }
    pendingSyncCommandRef.current = null;
    playbackRateRef.current = 1;
    availablePlaybackRatesRef.current = [1];
    setPlaybackRate(1);
    setPlayerReady(false);
    setSelectedQuality("auto");
    selectedQualityRef.current = "auto";
    setSession(null);
    setSyncError("");
    setTvStreams({ audio: null, qualities: [] });
    setVolume(100);
    setPhase("enter");
  }

  function activatePlayback() {
    const player = playerRef.current;
    if (!player) return;
    player.playVideo();
    setNeedsPlaybackActivation(false);
  }

  async function toggleFullscreen() {
    const playerFrame = playerFrameRef.current as TvFullscreenElement | null;
    if (!playerFrame) return;

    const fullscreenDocument = document as TvFullscreenDocument;
    const activeFullscreenElement = document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement;

    try {
      if (activeFullscreenElement) {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else {
          await fullscreenDocument.webkitExitFullscreen?.();
        }
      } else if (playerFrame.requestFullscreen) {
        await playerFrame.requestFullscreen();
      } else if (playerFrame.webkitRequestFullscreen) {
        await playerFrame.webkitRequestFullscreen();
      } else {
        throw new Error("Fullscreen API unavailable");
      }
      setFullscreenError("");
    } catch {
      setFullscreenError("Esta TV nao liberou o modo de tela cheia. Use o controle ou o menu do navegador.");
    }
  }

  const posterUrl = lesson ? getYouTubePoster(lesson.video.assetId, lesson.posterUrl) : "";
  const selectedManualStream = selectedQuality === "auto"
    ? null
    : tvStreams.qualities.find((quality) => quality.label === selectedQuality) ?? null;
  const visibleActiveCaption = captionsEnabled && hasPlaybackStarted ? activeCaption : null;
  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#0e0e0e] text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(229,9,20,0.12),transparent_38%),radial-gradient(circle_at_80%_100%,rgba(255,255,255,0.045),transparent_30%)]" />

      <header className="relative z-10 flex h-20 items-center justify-between border-b border-white/[0.07] px-5 sm:px-8 lg:px-10">
        <Image alt="Bunker707" className="h-auto w-[150px] sm:w-[175px]" height={35} priority src="/brand/logo-bunker.svg" unoptimized width={306} />
        <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
          <Tv className="h-4 w-4" />
          Modo TV
        </div>
      </header>

      {phase === "enter" || phase === "connecting" ? (
        <section className="relative z-10 grid min-h-[calc(100dvh-5rem)] place-items-center px-5 py-10">
          <div className="w-full max-w-md text-center">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/40">
              <MonitorPlay className="h-7 w-7 text-zinc-200" />
            </span>
            <h1 className="mt-6 font-heading text-2xl font-semibold tracking-tight text-white sm:text-3xl">Assistir na TV</h1>
            <p className="mx-auto mt-3 max-w-sm text-sm font-normal leading-6 text-zinc-400">
              Digite o codigo exibido na aula para conectar esta tela com seguranca.
            </p>

            <form className="mt-8" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="tv-pairing-code">Codigo de conexao</label>
              <input
                autoCapitalize="characters"
                autoComplete="one-time-code"
                autoFocus
                className="h-16 w-full rounded-xl border border-white/12 bg-black/25 px-4 text-center font-mono text-2xl font-semibold uppercase tracking-[0.32em] text-white outline-none transition placeholder:text-zinc-700 focus:border-white/35 focus:ring-2 focus:ring-white/10 disabled:opacity-60 sm:text-3xl"
                disabled={phase === "connecting"}
                id="tv-pairing-code"
                inputMode="text"
                maxLength={6}
                onChange={(event) => {
                  setCode(normalizeCode(event.target.value));
                  setError("");
                }}
                placeholder="ABC123"
                spellCheck={false}
                value={code}
              />
              <button
                className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={phase === "connecting" || code.length !== 6}
                type="submit"
              >
                {phase === "connecting" ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Conectando...
                  </>
                ) : (
                  <>
                    <Tv className="h-4 w-4" />
                    Conectar esta TV
                  </>
                )}
              </button>
            </form>

            {error ? (
              <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm leading-5 text-red-200" role="alert">
                {error}
              </p>
            ) : null}

            <p className="mt-6 text-xs leading-5 text-zinc-600">
              O codigo expira em poucos minutos e funciona uma unica vez.
            </p>
          </div>
        </section>
      ) : null}

      {phase === "connected" && lesson ? (
        <section className="relative z-10 mx-auto flex min-h-[calc(100dvh-5rem)] max-w-[1600px] flex-col px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div
              className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-[0_30px_100px_rgba(0,0,0,0.55)] ring-1 ring-white/10 fullscreen:h-screen fullscreen:w-screen fullscreen:aspect-auto fullscreen:rounded-none fullscreen:ring-0"
              onFocusCapture={revealControlsTemporarily}
              onKeyDownCapture={revealControlsTemporarily}
              onPointerDown={revealControlsTemporarily}
              onPointerLeave={hideControls}
              onPointerMove={revealControlsTemporarily}
              ref={playerFrameRef}
            >
              {selectedQuality === "auto" && embedUrl ? (
                <iframe
                  allow="autoplay; encrypted-media"
                  aria-hidden="true"
                  className="pointer-events-none absolute left-1/2 top-0 h-full w-[300%] max-w-none -translate-x-1/2 select-none border-0"
                  data-tv-youtube-receiver
                  ref={iframeRef}
                  referrerPolicy="strict-origin-when-cross-origin"
                  sandbox="allow-same-origin allow-scripts allow-presentation"
                  src={embedUrl}
                  tabIndex={-1}
                  title={`Reproducao de ${lesson.title}`}
                />
              ) : selectedManualStream && tvStreams.audio ? (
                <YouTubeManualStreamPlayer
                  audioUrl={tvStreams.audio.url}
                  initialMuted={muted}
                  initialPlaybackRate={playbackRate}
                  initialVolume={volume}
                  key={`tv-${lesson.id}-${selectedQuality}`}
                  onAutoplayBlocked={() => setNeedsPlaybackActivation(true)}
                  onControllerReady={(controller: YouTubeManualPlayerController) => {
                    playerRef.current = controller;
                    capturePlayerPlaybackRate(controller);
                    setPlayerReady(true);
                  }}
                  onEnded={() => {
                    playbackStateRef.current = "ended";
                    setPlaybackState("ended");
                  }}
                  onError={() => setError("Nao foi possivel reproduzir a qualidade escolhida nesta TV.")}
                  onPlaybackStateChange={(_, state) => {
                    playbackStateRef.current = state;
                    setPlaybackState(state);
                    if (state === "playing") {
                      setHasPlaybackStarted(true);
                      setNeedsPlaybackActivation(false);
                    }
                  }}
                  posterUrl={posterUrl}
                  shouldPlay={manualSwitch.shouldPlay}
                  startSeconds={manualSwitch.seconds}
                  switchToken={manualSwitch.token}
                  videoUrl={selectedManualStream.url}
                />
              ) : null}

              {!playerReady || !hasPlaybackStarted ? (
                <div className="absolute inset-0 grid place-items-center bg-cover bg-center" style={{ backgroundImage: `linear-gradient(rgba(0,0,0,.5),rgba(0,0,0,.6)),url(${posterUrl})` }}>
                  {!playerReady ? <LoaderCircle className="h-8 w-8 animate-spin text-white" /> : null}
                </div>
              ) : null}

              {visibleActiveCaption ? (
                <div
                  aria-live="off"
                  className="pointer-events-none absolute inset-x-[7%] bottom-[6%] z-20 flex justify-center sm:inset-x-[10%]"
                  data-tv-custom-caption
                >
                  <span className="max-w-full whitespace-pre-line text-center text-lg font-semibold leading-snug text-white [text-shadow:0_2px_2px_rgba(0,0,0,1),0_0_7px_rgba(0,0,0,0.98)] sm:text-2xl lg:text-3xl">
                    {visibleActiveCaption.text}
                  </span>
                </div>
              ) : null}

              <div
                aria-hidden={!controlsVisible}
                className={`pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-end bg-gradient-to-t from-black/80 via-black/25 to-transparent px-2 pb-1 pt-8 transition-opacity duration-200 sm:px-3 sm:pb-2 ${controlsVisible ? "opacity-100" : "opacity-0"}`}
                data-tv-player-controls
              >
                <button
                  aria-label={isFullscreen ? "Sair da tela cheia" : "Tela cheia"}
                  aria-pressed={isFullscreen}
                  className={`grid h-10 w-10 shrink-0 place-items-center text-white transition hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:h-11 sm:w-11 ${controlsVisible ? "pointer-events-auto" : "pointer-events-none"}`}
                  data-tv-fullscreen-control
                  onClick={() => void toggleFullscreen()}
                  type="button"
                >
                  {isFullscreen ? (
                    <Minimize className="h-5 w-5" strokeWidth={2} />
                  ) : (
                    <Maximize className="h-5 w-5" strokeWidth={2} />
                  )}
                </button>
              </div>

              {fullscreenError ? (
                <p className="absolute bottom-16 right-3 z-30 max-w-xs rounded-lg border border-amber-400/20 bg-black/85 px-3 py-2 text-xs leading-5 text-amber-100 shadow-xl sm:bottom-[4.5rem] sm:right-4" role="status">
                  {fullscreenError}
                </p>
              ) : null}

              {needsPlaybackActivation ? (
                <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center backdrop-blur-sm">
                  <div className="max-w-md">
                    <Play className="mx-auto h-9 w-9 text-white" />
                    <p className="mt-4 text-lg font-medium">Ative a reproducao nesta TV</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">O navegador pediu uma confirmacao unica antes de aceitar o controle remoto.</p>
                    <button className="mt-5 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-black hover:bg-zinc-200" onClick={activatePlayback} type="button">
                      Ativar reproducao
                    </button>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div className="absolute inset-0 grid place-items-center bg-black/85 p-6 text-center">
                  <div className="max-w-md">
                    <AlertCircle className="mx-auto h-8 w-8 text-red-300" />
                    <p className="mt-4 text-sm leading-6 text-zinc-200">{error}</p>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${syncError ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} />
                <p className="text-xs font-medium text-zinc-400">{syncError ? "Reconectando ao controle" : "Conectado ao controle remoto"}</p>
              </div>
              <h1 className="mt-1 truncate text-base font-medium text-white sm:text-lg">{lesson.title}</h1>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-zinc-500">
              <span>{getQualityLabel(selectedQuality)}</span>
              <span>{playbackState === "playing" ? "Reproduzindo" : playbackState === "buffering" ? "Carregando" : playbackState === "ended" ? "Concluida" : "Pausada"}</span>
              <span className="font-mono text-zinc-400">{formatPlaybackTime(displayCurrentTime)} / {formatPlaybackTime(displayDuration)}</span>
            </div>
          </div>
        </section>
      ) : null}

      {phase === "ended" ? (
        <section className="relative z-10 grid min-h-[calc(100dvh-5rem)] place-items-center px-5 py-10 text-center">
          <div className="max-w-md">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-emerald-400/20 bg-emerald-400/10">
              <CheckCircle2 className="h-7 w-7 text-emerald-300" />
            </span>
            <h1 className="mt-6 font-heading text-2xl font-semibold text-white">Sessao encerrada</h1>
            <p className="mt-3 text-sm leading-6 text-zinc-400">Esta TV foi desconectada. Para assistir novamente, gere um novo codigo na pagina da aula.</p>
            <button className="mt-6 inline-flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.06] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/10" onClick={resetReceiver} type="button">
              <RotateCcw className="h-4 w-4" />
              Digitar outro codigo
            </button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
