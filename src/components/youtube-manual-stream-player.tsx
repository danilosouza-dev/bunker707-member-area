"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type YouTubeManualPlayerController = {
  destroy: () => void;
  getAvailablePlaybackRates: () => number[];
  getCaptionTime: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlaybackRate: () => number;
  getPlayerState: () => number;
  getVolume: () => number;
  isMuted: () => boolean;
  mute: () => void;
  pauseVideo: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setPlaybackRate: (playbackRate: number) => void;
  setVolume: (volume: number) => void;
  unMute: () => void;
};

type YouTubeManualStreamPlayerProps = {
  audioUrl: string;
  initialMuted: boolean;
  initialPlaybackRate: number;
  initialVolume: number;
  onAutoplayBlocked?: () => void;
  onControllerReady: (controller: YouTubeManualPlayerController) => void;
  onEnded: (controller: YouTubeManualPlayerController) => void;
  onError: () => void;
  onPlaybackStateChange: (
    controller: YouTubeManualPlayerController,
    state: "buffering" | "paused" | "playing"
  ) => void;
  posterUrl: string;
  shouldPlay: boolean;
  startSeconds: number;
  switchToken: number;
  videoUrl: string;
};

const playerStateEnded = 0;
const playerStatePlaying = 1;
const playerStatePaused = 2;
const playerStateBuffering = 3;
const supportedPlaybackRates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const futureDataReadyState = 3;
const hardSyncThresholdSeconds = 0.75;
const softSyncThresholdSeconds = 0.08;
const settledSyncThresholdSeconds = 0.025;
const syncPlaybackRateCorrection = 0.05;
const periodicSyncIntervalMilliseconds = 500;

function normalizePlaybackRate(playbackRate: number) {
  return supportedPlaybackRates.includes(playbackRate) ? playbackRate : 1;
}

export function YouTubeManualStreamPlayer({
  audioUrl,
  initialMuted,
  initialPlaybackRate,
  initialVolume,
  onAutoplayBlocked,
  onControllerReady,
  onEnded,
  onError,
  onPlaybackStateChange,
  posterUrl,
  shouldPlay,
  startSeconds,
  switchToken,
  videoUrl
}: YouTubeManualStreamPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const desiredPlayingRef = useRef(false);
  const frameRevealAnimationRef = useRef<number | null>(null);
  const playAttemptRef = useRef<Promise<void> | null>(null);
  const playbackGenerationRef = useRef(0);
  const playbackRateRef = useRef(normalizePlaybackRate(initialPlaybackRate));
  const playbackStateRef = useRef(playerStatePaused);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPreparingFrame, setIsPreparingFrame] = useState(true);

  const alignAudio = useCallback((threshold = 0.03) => {
    const audio = audioRef.current;
    const video = videoRef.current;

    if (!audio || !video || !Number.isFinite(video.currentTime)) {
      return;
    }

    if (Math.abs(audio.currentTime - video.currentTime) > threshold) {
      try {
        audio.playbackRate = playbackRateRef.current;
        audio.currentTime = video.currentTime;
      } catch {
        // The audio metadata can finish loading a fraction after the video metadata.
      }
    }
  }, []);

  const correctAudioDrift = useCallback(() => {
    const audio = audioRef.current;
    const video = videoRef.current;

    if (!audio || !video) {
      return;
    }

    const drift = audio.currentTime - video.currentTime;
    const absoluteDrift = Math.abs(drift);
    const basePlaybackRate = playbackRateRef.current;

    if (absoluteDrift > hardSyncThresholdSeconds) {
      alignAudio(0);
      return;
    }

    if (absoluteDrift > softSyncThresholdSeconds) {
      const correction = drift > 0
        ? 1 - syncPlaybackRateCorrection
        : 1 + syncPlaybackRateCorrection;
      audio.playbackRate = basePlaybackRate * correction;
      return;
    }

    if (absoluteDrift < settledSyncThresholdSeconds) {
      audio.playbackRate = basePlaybackRate;
    }
  }, [alignAudio]);

  const revealPreparedFrame = useCallback(() => {
    if (frameRevealAnimationRef.current !== null) {
      window.cancelAnimationFrame(frameRevealAnimationRef.current);
    }

    frameRevealAnimationRef.current = window.requestAnimationFrame(() => {
      frameRevealAnimationRef.current = window.requestAnimationFrame(() => {
        frameRevealAnimationRef.current = null;
        setIsPreparingFrame(false);
      });
    });
  }, []);

  const pauseBoth = useCallback(() => {
    desiredPlayingRef.current = false;
    playbackStateRef.current = playerStatePaused;
    videoRef.current?.pause();
    audioRef.current?.pause();
  }, []);

  const setPlaybackRate = useCallback((playbackRate: number) => {
    const nextPlaybackRate = normalizePlaybackRate(playbackRate);
    playbackRateRef.current = nextPlaybackRate;

    if (audioRef.current) {
      audioRef.current.defaultPlaybackRate = nextPlaybackRate;
      audioRef.current.playbackRate = nextPlaybackRate;
    }

    if (videoRef.current) {
      videoRef.current.defaultPlaybackRate = nextPlaybackRate;
      videoRef.current.playbackRate = nextPlaybackRate;
    }
  }, []);

  const playBoth = useCallback(async () => {
    const audio = audioRef.current;
    const video = videoRef.current;

    if (!audio || !video) {
      return;
    }

    desiredPlayingRef.current = true;
    audio.playbackRate = playbackRateRef.current;
    alignAudio(0.18);

    if (
      audio.readyState < futureDataReadyState ||
      video.readyState < futureDataReadyState ||
      audio.seeking ||
      video.seeking
    ) {
      playbackStateRef.current = playerStateBuffering;
      return;
    }

    if (playAttemptRef.current) {
      await playAttemptRef.current;
      return;
    }

    const playbackGeneration = playbackGenerationRef.current;

    const playAttempt = (async () => {
      try {
        await Promise.all([video.play(), audio.play()]);

        if (playbackGeneration !== playbackGenerationRef.current) {
          return;
        }

        if (!desiredPlayingRef.current) {
          video.pause();
          audio.pause();
          return;
        }

        alignAudio(0.06);
        playbackStateRef.current = playerStatePlaying;
      } catch {
        if (playbackGeneration === playbackGenerationRef.current) {
          desiredPlayingRef.current = false;
          playbackStateRef.current = playerStatePaused;
          video.pause();
          audio.pause();
          onAutoplayBlocked?.();
        }
      } finally {
        if (playbackGeneration === playbackGenerationRef.current) {
          playAttemptRef.current = null;
        }
      }
    })();

    playAttemptRef.current = playAttempt;
    await playAttempt;
  }, [alignAudio, onAutoplayBlocked]);

  const controller = useMemo<YouTubeManualPlayerController>(() => ({
    destroy: pauseBoth,
    getAvailablePlaybackRates: () => [...supportedPlaybackRates],
    getCaptionTime: () => audioRef.current?.currentTime ?? videoRef.current?.currentTime ?? 0,
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    getDuration: () => videoRef.current?.duration ?? 0,
    getPlaybackRate: () => videoRef.current?.playbackRate ?? 1,
    getPlayerState: () => {
      const video = videoRef.current;

      if (video?.ended) return playerStateEnded;
      return playbackStateRef.current;
    },
    getVolume: () => (audioRef.current?.volume ?? 1) * 100,
    isMuted: () => audioRef.current?.muted ?? false,
    mute: () => {
      if (audioRef.current) audioRef.current.muted = true;
    },
    pauseVideo: pauseBoth,
    playVideo: () => {
      void playBoth();
    },
    seekTo: (seconds) => {
      const audio = audioRef.current;
      const video = videoRef.current;

      if (!audio || !video || !Number.isFinite(seconds)) {
        return;
      }

      audio.pause();
      const duration = Number.isFinite(video.duration) ? video.duration : seconds;
      const target = Math.max(0, Math.min(duration, seconds));
      video.currentTime = target;

      try {
        audio.currentTime = target;
      } catch {
        // The audio seek is retried by the seeked/canplay handlers.
      }
    },
    setPlaybackRate,
    setVolume: (volume) => {
      if (audioRef.current) {
        audioRef.current.volume = Math.max(0, Math.min(1, volume / 100));
      }
    },
    unMute: () => {
      if (audioRef.current) audioRef.current.muted = false;
    }
  }), [pauseBoth, playBoth, setPlaybackRate]);

  const handleVideoBuffering = useCallback(() => {
    audioRef.current?.pause();

    if (!desiredPlayingRef.current) {
      return;
    }

    playbackStateRef.current = playerStateBuffering;
    onPlaybackStateChange(controller, "buffering");
  }, [controller, onPlaybackStateChange]);

  const handleAudioBuffering = useCallback(() => {
    videoRef.current?.pause();
    audioRef.current?.pause();

    if (!desiredPlayingRef.current) {
      return;
    }

    playbackStateRef.current = playerStateBuffering;
    onPlaybackStateChange(controller, "buffering");
  }, [controller, onPlaybackStateChange]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.volume = Math.max(0, Math.min(1, initialVolume / 100));
    audio.muted = initialMuted;
  }, [initialMuted, initialVolume]);

  useEffect(() => {
    setPlaybackRate(initialPlaybackRate);
  }, [initialPlaybackRate, setPlaybackRate]);

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    audio.pause();
    audio.load();
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;

    if (!audio || !video) {
      return;
    }

    playbackGenerationRef.current += 1;
    playAttemptRef.current = null;
    desiredPlayingRef.current = shouldPlay;
    playbackStateRef.current = playerStatePaused;
    video.pause();
    audio.pause();
    video.load();
  }, [shouldPlay, switchToken, videoUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    const video = videoRef.current;

    return () => {
      desiredPlayingRef.current = false;
      if (frameRevealAnimationRef.current !== null) {
        window.cancelAnimationFrame(frameRevealAnimationRef.current);
      }
      video?.pause();
      audio?.pause();
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const audio = audioRef.current;
      const video = videoRef.current;

      if (
        desiredPlayingRef.current &&
        audio &&
        video
      ) {
        if (video.readyState < futureDataReadyState) {
          audio.pause();
          return;
        }

        if (audio.readyState < futureDataReadyState) {
          video.pause();
          return;
        }

        if (audio.seeking || video.seeking) {
          return;
        }

        if (audio.paused || video.paused) {
          void playBoth();
          return;
        }

        correctAudioDrift();
      }
    }, periodicSyncIntervalMilliseconds);

    return () => window.clearInterval(interval);
  }, [correctAudioDrift, playBoth]);

  return (
    <>
      <video
        className="h-full w-full bg-black object-contain"
        onCanPlay={() => {
          onControllerReady(controller);

          if (desiredPlayingRef.current) {
            void playBoth();
          }
        }}
        onEnded={() => {
          desiredPlayingRef.current = false;
          playbackStateRef.current = playerStateEnded;
          audioRef.current?.pause();
          onEnded(controller);
        }}
        onError={onError}
        onLoadedMetadata={(event) => {
          const duration = event.currentTarget.duration;
          const target = Math.max(0, Math.min(Number.isFinite(duration) ? duration : startSeconds, startSeconds));

          if (target > 0) {
            event.currentTarget.currentTime = target;
          }

          try {
            if (audioRef.current) audioRef.current.currentTime = target;
          } catch {
            // The audio metadata handler will align again.
          }

          onControllerReady(controller);
        }}
        onLoadedData={revealPreparedFrame}
        onLoadStart={() => setIsPreparingFrame(true)}
        onPause={() => {
          audioRef.current?.pause();

          if (!desiredPlayingRef.current) {
            playbackStateRef.current = playerStatePaused;
            onPlaybackStateChange(controller, "paused");
          }
        }}
        onPlaying={() => {
          playbackStateRef.current = playerStatePlaying;
          alignAudio(0.18);
          revealPreparedFrame();

          onPlaybackStateChange(controller, "playing");
        }}
        onSeeked={() => {
          alignAudio(0);

          if (desiredPlayingRef.current) {
            void playBoth();
          }
        }}
        onSeeking={() => audioRef.current?.pause()}
        onStalled={handleVideoBuffering}
        onWaiting={handleVideoBuffering}
        aria-hidden="true"
        muted
        playsInline
        poster={posterUrl}
        preload="auto"
        ref={videoRef}
        src={videoUrl}
      />
      <audio
        className="hidden"
        onCanPlay={() => {
          alignAudio(0.18);

          if (desiredPlayingRef.current) {
            void playBoth();
          }
        }}
        onError={onError}
        onLoadedMetadata={() => alignAudio(0)}
        onSeeked={() => {
          if (desiredPlayingRef.current) {
            void playBoth();
          }
        }}
        onStalled={handleAudioBuffering}
        onWaiting={handleAudioBuffering}
        preload="auto"
        ref={audioRef}
        src={audioUrl}
      />
      <div
        aria-hidden={!isPreparingFrame}
        className={`pointer-events-none absolute inset-0 z-[1] grid place-items-center overflow-hidden bg-black transition-opacity duration-200 ${
          isPreparingFrame ? "opacity-100" : "opacity-0"
        }`}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-contain bg-center bg-no-repeat opacity-90"
          style={{ backgroundImage: `url(${posterUrl})` }}
        />
        <div aria-hidden="true" className="absolute inset-0 bg-black/28" />
        {isPreparingFrame ? (
          <span
            aria-label="Preparando qualidade do video"
            className="relative h-9 w-9 animate-spin rounded-full border-2 border-white/35 border-t-white"
            role="status"
          />
        ) : null}
      </div>
    </>
  );
}
