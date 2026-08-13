"use client";

import {
  Check,
  Copy,
  Gauge,
  LoaderCircle,
  MonitorPlay,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Square,
  Tv
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { normalizeTvPlaybackRates, type TvCommand } from "@/lib/tv-session-contract";

type TvSession = {
  availablePlaybackRates: number[];
  commandRevision: number;
  connectedAt: string | null;
  currentTimeSeconds: number;
  durationSeconds: number;
  endedAt: string | null;
  expiresAt: string;
  id: string;
  pairingCode: string;
  pairingExpiresAt: string;
  playbackRate: number;
  playbackState: "buffering" | "ended" | "paused" | "playing" | "unstarted";
  receiverCommandRevision: number;
  receiverLastSeenAt: string | null;
  status: "connected" | "ended" | "pending";
};

type TvSessionResponse = {
  data?: {
    session: TvSession;
    tvPath?: string;
    tvUrl?: string;
  };
  error?: string;
};

async function postTvCommand(sessionId: string, command: TvCommand) {
  const response = await fetch(`/api/tv/sessions/${encodeURIComponent(sessionId)}/commands`, {
    body: JSON.stringify(command),
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  const payload = await response.json() as TvSessionResponse;

  if (!response.ok || !payload.data?.session) {
    throw new Error(payload.error ?? "Nao foi possivel controlar a TV.");
  }

  return payload.data.session;
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

function formatPlaybackRate(playbackRate: number) {
  return `${String(playbackRate).replace(".", ",")}x`;
}

function getDisplayTvAddress(tvUrl: string) {
  try {
    const url = new URL(tvUrl);
    return `${url.host}/tv`;
  } catch {
    return "/tv";
  }
}

function RemoteButton({
  ariaLabel,
  children,
  disabled,
  onClick,
  primary = false
}: {
  ariaLabel: string;
  children: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={`grid h-12 w-12 place-items-center rounded-full border transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? "border-white bg-white text-black hover:bg-zinc-200"
          : "border-white/15 bg-white/[0.06] text-white hover:border-white/35 hover:bg-white/10"
      }`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function LessonTvControl({
  buttonClassName,
  captionsEnabled,
  contentId,
  currentTimeSeconds,
  durationSeconds,
  iconClassName = "h-5 w-5 stroke-[2.35]",
  isPlaying,
  lessonId,
  lessonTitle,
  muted,
  onConnected,
  onPlaybackRateConfirmed,
  playbackRate,
  quality,
  volume
}: {
  buttonClassName: string;
  captionsEnabled: boolean;
  contentId: string;
  currentTimeSeconds: number;
  durationSeconds: number;
  iconClassName?: string;
  isPlaying: boolean;
  lessonId: string;
  lessonTitle: string;
  muted: boolean;
  onConnected?: () => void;
  onPlaybackRateConfirmed?: (playbackRate: number) => void;
  playbackRate: number;
  quality: string;
  volume: number;
}) {
  const [copiedValue, setCopiedValue] = useState<"code" | "url" | null>(null);
  const [error, setError] = useState("");
  const [isCommandPending, setIsCommandPending] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pendingPlaybackRate, setPendingPlaybackRate] = useState<number | null>(null);
  const [session, setSession] = useState<TvSession | null>(null);
  const [tvUrl, setTvUrl] = useState("");
  const onPlaybackRateConfirmedRef = useRef(onPlaybackRateConfirmed);
  const pendingPlaybackRateRef = useRef<{ commandRevision: number; playbackRate: number } | null>(null);
  const syncStateRef = useRef({
    captionsEnabled,
    currentTimeSeconds,
    muted,
    playbackRate,
    quality,
    shouldPlay: isPlaying,
    volume
  });

  useEffect(() => {
    onPlaybackRateConfirmedRef.current = onPlaybackRateConfirmed;
  }, [onPlaybackRateConfirmed]);

  useEffect(() => {
    syncStateRef.current = {
      captionsEnabled,
      currentTimeSeconds,
      muted,
      playbackRate,
      quality,
      shouldPlay: isPlaying,
      volume
    };
  }, [captionsEnabled, currentTimeSeconds, isPlaying, muted, playbackRate, quality, volume]);

  const acceptSessionUpdate = useCallback((nextSession: TvSession) => {
    const pendingRate = pendingPlaybackRateRef.current;

    if (pendingRate && nextSession.receiverCommandRevision >= pendingRate.commandRevision) {
      pendingPlaybackRateRef.current = null;
      setPendingPlaybackRate(null);
      syncStateRef.current = {
        ...syncStateRef.current,
        playbackRate: nextSession.playbackRate
      };
      onPlaybackRateConfirmedRef.current?.(nextSession.playbackRate);
    }

    setSession(nextSession);
  }, []);

  const createSession = useCallback(async () => {
    pendingPlaybackRateRef.current = null;
    setPendingPlaybackRate(null);
    setIsCreating(true);
    setError("");

    try {
      const response = await fetch("/api/tv/sessions", {
        body: JSON.stringify({ contentId, currentTimeSeconds, durationSeconds, lessonId }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json() as TvSessionResponse;

      if (!response.ok || !payload.data?.session || !payload.data.tvUrl) {
        throw new Error(payload.error ?? "Nao foi possivel iniciar o Modo TV.");
      }

      acceptSessionUpdate(payload.data.session);
      setTvUrl(payload.data.tvUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Nao foi possivel iniciar o Modo TV.");
    } finally {
      setIsCreating(false);
    }
  }, [acceptSessionUpdate, contentId, currentTimeSeconds, durationSeconds, lessonId]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const sessionId = session?.id ?? "";
    const sessionStatus = session?.status;
    if (!isOpen || !sessionId || sessionStatus === "ended") return;

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/tv/sessions/${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
          credentials: "same-origin"
        });
        const payload = await response.json() as TvSessionResponse;

        if (!cancelled && response.ok && payload.data?.session) {
          if (sessionStatus === "pending" && payload.data.session.status === "connected") {
            onConnected?.();
            const syncState = syncStateRef.current;
            const synchronizedSession = await postTvCommand(payload.data.session.id, {
              ...syncState,
              type: "sync_player"
            });

            if (!cancelled) {
              acceptSessionUpdate({
                ...synchronizedSession,
                playbackState: syncState.shouldPlay ? "playing" : "paused"
              });
            }
            return;
          }
          acceptSessionUpdate(payload.data.session);
          setError("");
        } else if (!cancelled && !response.ok) {
          setError(payload.error ?? "Nao foi possivel sincronizar a TV.");
        }
      } catch {
        if (!cancelled) setError("A conexao com a TV foi interrompida. Tentando novamente...");
      }
    };

    void poll();
    const interval = window.setInterval(() => void poll(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [acceptSessionUpdate, isOpen, onConnected, session?.id, session?.status]);

  const secondsUntilPairingExpires = session
    ? Math.max(0, Math.ceil((new Date(session.pairingExpiresAt).getTime() - now) / 1000))
    : 0;
  const pairingExpired = session?.status === "pending" && secondsUntilPairingExpires === 0;
  const receiverIsOnline = session?.status === "connected" && Boolean(
    session.receiverLastSeenAt && now - new Date(session.receiverLastSeenAt).getTime() < 10_000
  );
  const displayPairingCode = session?.pairingCode
    ? `${session.pairingCode.slice(0, 3)} ${session.pairingCode.slice(3)}`
    : "";
  const playbackLabel = useMemo(() => {
    if (!session) return "";
    if (session.playbackState === "playing") return "Reproduzindo";
    if (session.playbackState === "buffering") return "Carregando";
    if (session.playbackState === "ended") return "Aula concluida";
    return "Pausado";
  }, [session]);

  async function copyValue(value: string, type: "code" | "url") {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedValue(type);
      window.setTimeout(() => setCopiedValue(null), 1600);
    } catch {
      setError("Nao foi possivel copiar automaticamente.");
    }
  }

  async function sendCommand(command: TvCommand, targetSession = session) {
    if (!targetSession || targetSession.status !== "connected") return null;
    const previousPlaybackState = targetSession.playbackState;
    const optimisticPlaybackState = command.type === "play"
      ? "playing"
      : command.type === "pause"
        ? "paused"
        : command.type === "sync_player"
          ? command.shouldPlay ? "playing" : "paused"
          : null;
    setIsCommandPending(true);
    setError("");
    if (optimisticPlaybackState) {
      setSession({ ...targetSession, playbackState: optimisticPlaybackState });
    }

    try {
      const updatedSession = await postTvCommand(targetSession.id, command);

      acceptSessionUpdate({
        ...updatedSession,
        ...(optimisticPlaybackState ? { playbackState: optimisticPlaybackState } : {})
      });
      return updatedSession;
    } catch (requestError) {
      setSession((current) => current?.id === targetSession.id
        ? { ...current, playbackState: previousPlaybackState }
        : current);
      setError(requestError instanceof Error ? requestError.message : "Nao foi possivel controlar a TV.");
      return null;
    } finally {
      setIsCommandPending(false);
    }
  }

  async function selectPlaybackRate(nextPlaybackRate: number) {
    if (!session || controlDisabled || pendingPlaybackRate !== null) return;

    const pendingRate = {
      commandRevision: session.commandRevision + 1,
      playbackRate: nextPlaybackRate
    };
    pendingPlaybackRateRef.current = pendingRate;
    setPendingPlaybackRate(nextPlaybackRate);
    syncStateRef.current = {
      ...syncStateRef.current,
      playbackRate: nextPlaybackRate
    };

    const updatedSession = await sendCommand({
      playbackRate: nextPlaybackRate,
      type: "set_playback_rate"
    }, session);

    if (!updatedSession) {
      pendingPlaybackRateRef.current = null;
      setPendingPlaybackRate(null);
      return;
    }

    if (!pendingPlaybackRateRef.current) return;

    pendingPlaybackRateRef.current = {
      commandRevision: updatedSession.commandRevision,
      playbackRate: nextPlaybackRate
    };
  }

  async function endSession() {
    if (!session) return;
    pendingPlaybackRateRef.current = null;
    setPendingPlaybackRate(null);
    setIsCommandPending(true);

    try {
      const response = await fetch(`/api/tv/sessions/${encodeURIComponent(session.id)}`, {
        credentials: "same-origin",
        method: "DELETE"
      });
      const payload = await response.json() as TvSessionResponse;
      if (!response.ok || !payload.data?.session) {
        throw new Error(payload.error ?? "Nao foi possivel encerrar a sessao.");
      }
      setSession(payload.data.session);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Nao foi possivel encerrar a sessao.");
    } finally {
      setIsCommandPending(false);
    }
  }

  function handleOpenChange(open: boolean) {
    setIsOpen(open);
    if (!open) return;

    if (!session || session.status === "ended") {
      void createSession();
      return;
    }

    if (session.status === "connected") {
      const syncState = syncStateRef.current;
      onConnected?.();
      void sendCommand({ ...syncState, type: "sync_player" }, session);
    }
  }

  const connected = session?.status === "connected";
  const controlDisabled = !connected || isCommandPending || pendingPlaybackRate !== null || !receiverIsOnline;
  const availablePlaybackRates = normalizeTvPlaybackRates([
    ...(session?.availablePlaybackRates ?? [1]),
    session?.playbackRate ?? 1
  ]);

  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <button
        aria-label="Assistir na TV"
        className={buttonClassName}
        onClick={() => handleOpenChange(true)}
        type="button"
      >
        <span className="pointer-events-none absolute bottom-[calc(100%+12px)] left-1/2 z-[80] -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-[4px] bg-[#e6e6e6] px-4 py-2 text-[13px] font-medium text-[#1f1f1f] opacity-0 shadow-xl shadow-black/35 transition duration-150 group-hover/action:translate-y-0 group-hover/action:opacity-100 group-focus-visible/action:translate-y-0 group-focus-visible/action:opacity-100 max-sm:hidden">
          Assistir na TV
          <span className="absolute left-1/2 top-full h-0 w-0 -translate-x-1/2 border-l-[7px] border-r-[7px] border-t-[8px] border-l-transparent border-r-transparent border-t-[#e6e6e6]" />
        </span>
        <MonitorPlay className={iconClassName} />
      </button>

      <DialogContent className="max-w-[560px] border-white/10 bg-[#171717] p-0 text-white" showCloseButton>
        <DialogHeader className="border-b border-white/10 px-5 py-4 pr-14 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.06]">
              <Tv className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-base font-semibold text-white">Assistir na TV</DialogTitle>
              <DialogDescription className="mt-0.5 truncate text-xs font-normal text-zinc-400">
                {lessonTitle}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {isCreating && !session ? (
            <div className="grid min-h-72 place-items-center text-center">
              <div>
                <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-zinc-300" />
                <p className="mt-3 text-sm text-zinc-400">Preparando uma conexao segura...</p>
              </div>
            </div>
          ) : null}

          {!isCreating && !session ? (
            <div className="grid min-h-72 place-items-center text-center">
              <div className="max-w-sm">
                <MonitorPlay className="mx-auto h-9 w-9 text-zinc-400" />
                <p className="mt-4 text-sm leading-6 text-zinc-300">{error || "Nao foi possivel iniciar o Modo TV."}</p>
                <button
                  className="mt-5 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-200"
                  onClick={() => void createSession()}
                  type="button"
                >
                  Tentar novamente
                </button>
              </div>
            </div>
          ) : null}

          {session?.status === "pending" ? (
            <div>
              <p className="text-sm leading-6 text-zinc-300">
                Na TV, abra <span className="font-medium text-white">{getDisplayTvAddress(tvUrl)}</span> e digite o codigo abaixo.
              </p>

              <div className="mt-5 grid gap-5 rounded-xl border border-white/10 bg-black/25 p-4 sm:grid-cols-[164px_minmax(0,1fr)] sm:items-center sm:p-5">
                <div className="mx-auto rounded-lg bg-white p-3 shadow-lg shadow-black/30">
                  {tvUrl ? (
                    <QRCodeSVG
                      aria-label="QR Code para abrir o Modo TV"
                      bgColor="#ffffff"
                      fgColor="#111111"
                      level="M"
                      marginSize={0}
                      size={140}
                      value={tvUrl}
                    />
                  ) : null}
                </div>

                <div className="min-w-0 text-center sm:text-left">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">Codigo de conexao</p>
                  <p className="mt-1 font-mono text-[30px] font-semibold tracking-[0.14em] text-white sm:text-[34px]">
                    {displayPairingCode}
                  </p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
                    <button
                      className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/12 bg-white/[0.05] px-3 text-xs font-medium text-zinc-200 transition hover:bg-white/10"
                      onClick={() => void copyValue(session.pairingCode, "code")}
                      type="button"
                    >
                      {copiedValue === "code" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedValue === "code" ? "Copiado" : "Copiar codigo"}
                    </button>
                    <button
                      className="inline-flex min-h-9 items-center gap-2 rounded-md border border-white/12 bg-white/[0.05] px-3 text-xs font-medium text-zinc-200 transition hover:bg-white/10"
                      onClick={() => void copyValue(tvUrl, "url")}
                      type="button"
                    >
                      {copiedValue === "url" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedValue === "url" ? "Copiado" : "Copiar endereco"}
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 text-xs text-zinc-500">
                <span className="inline-flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${pairingExpired ? "bg-red-500" : "animate-pulse bg-amber-400"}`} />
                  {pairingExpired ? "Codigo expirado" : "Aguardando a TV"}
                </span>
                {!pairingExpired ? <span>Expira em {Math.ceil(secondsUntilPairingExpires / 60)} min</span> : null}
              </div>

              {pairingExpired ? (
                <button
                  className="mt-5 w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-200"
                  onClick={() => void createSession()}
                  type="button"
                >
                  Gerar novo codigo
                </button>
              ) : null}
            </div>
          ) : null}

          {connected ? (
            <div>
              <div className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.035] p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${receiverIsOnline ? "bg-emerald-400" : "animate-pulse bg-amber-400"}`} />
                    <p className="text-sm font-medium text-white">{receiverIsOnline ? "TV conectada" : "Reconectando a TV"}</p>
                  </div>
                  <p className="mt-1 truncate text-xs text-zinc-500">{playbackLabel}</p>
                </div>
                <p className="shrink-0 font-mono text-xs text-zinc-400">
                  {formatPlaybackTime(session.currentTimeSeconds)} / {formatPlaybackTime(session.durationSeconds)}
                </p>
              </div>

              <div aria-label="Controle remoto da TV" className="mt-7 flex items-center justify-center gap-3" role="group">
                <RemoteButton
                  ariaLabel="Retroceder 10 segundos"
                  disabled={controlDisabled}
                  onClick={() => void sendCommand({ seconds: -10, type: "seek_relative" })}
                >
                  <span className="relative">
                    <RotateCcw className="h-5 w-5" />
                    <span className="absolute inset-0 grid place-items-center pt-0.5 text-[8px] font-bold">10</span>
                  </span>
                </RemoteButton>
                <RemoteButton
                  ariaLabel={session.playbackState === "playing" ? "Pausar na TV" : "Reproduzir na TV"}
                  disabled={controlDisabled}
                  onClick={() => void sendCommand({ type: session.playbackState === "playing" ? "pause" : "play" })}
                  primary
                >
                  {isCommandPending ? (
                    <LoaderCircle className="h-5 w-5 animate-spin" />
                  ) : session.playbackState === "playing" ? (
                    <Pause className="h-5 w-5 fill-current" />
                  ) : (
                    <Play className="ml-0.5 h-5 w-5 fill-current" />
                  )}
                </RemoteButton>
                <RemoteButton
                  ariaLabel="Avancar 10 segundos"
                  disabled={controlDisabled}
                  onClick={() => void sendCommand({ seconds: 10, type: "seek_relative" })}
                >
                  <span className="relative">
                    <RotateCw className="h-5 w-5" />
                    <span className="absolute inset-0 grid place-items-center pt-0.5 text-[8px] font-bold">10</span>
                  </span>
                </RemoteButton>
              </div>

              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="flex items-center justify-between gap-4">
                  <span className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-zinc-300">
                    <Gauge className="h-3.5 w-3.5 shrink-0 text-zinc-500" strokeWidth={1.8} />
                    Velocidade de reprodução
                  </span>
                  <span className="shrink-0 text-xs font-normal text-zinc-500">
                    {formatPlaybackRate(session.playbackRate)}
                  </span>
                </div>
                <div
                  aria-label="Velocidade de reprodução na TV"
                  className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-black/25 p-1"
                  role="radiogroup"
                >
                  {availablePlaybackRates.map((rate) => {
                    const confirmed = session.playbackRate === rate;
                    const pending = pendingPlaybackRate === rate;

                    return (
                      <button
                        aria-checked={confirmed}
                        className={`inline-flex h-8 items-center justify-center gap-1 rounded-md px-1.5 text-[11px] font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white disabled:cursor-not-allowed ${
                          confirmed
                            ? "bg-white text-black shadow-sm"
                            : "text-zinc-400 hover:bg-white/[0.07] hover:text-white"
                        }`}
                        disabled={controlDisabled || pendingPlaybackRate !== null}
                        key={rate}
                        onClick={() => void selectPlaybackRate(rate)}
                        role="radio"
                        type="button"
                      >
                        {pending ? <LoaderCircle className="h-3 w-3 animate-spin" /> : null}
                        {formatPlaybackRate(rate)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="mt-5 text-center text-xs leading-5 text-zinc-500">
                O progresso assistido na TV e salvo automaticamente nesta aula.
              </p>

              <button
                className="mt-6 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-red-500/25 bg-red-500/10 px-4 text-sm font-medium text-red-200 transition hover:border-red-500/40 hover:bg-red-500/15 disabled:opacity-50"
                disabled={isCommandPending}
                onClick={() => void endSession()}
                type="button"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                Encerrar na TV
              </button>
            </div>
          ) : null}

          {session?.status === "ended" ? (
            <div className="grid min-h-64 place-items-center text-center">
              <div className="max-w-sm">
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-full border border-white/10 bg-white/[0.05]">
                  <Tv className="h-5 w-5 text-zinc-300" />
                </span>
                <p className="mt-4 text-base font-medium text-white">Sessao encerrada</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">A TV nao tem mais acesso a esta aula.</p>
                <button
                  className="mt-5 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-zinc-200"
                  onClick={() => void createSession()}
                  type="button"
                >
                  Conectar outra TV
                </button>
              </div>
            </div>
          ) : null}

          {error && session ? (
            <p className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs leading-5 text-red-200" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
