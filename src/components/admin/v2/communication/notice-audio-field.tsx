"use client";

import { AlertCircle, LoaderCircle, Mic, RotateCcw, Square, Upload } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { NoticeAudioPlayer } from "@/components/member/notifications/notice-audio-player";
import { Button } from "@/components/ui/button";
import type { NoticeDraft } from "@/server/communications/schemas";
import {
  AUDIO_TOO_LONG_MESSAGE,
  RECORDING_LIMIT_SECONDS,
  audioDurationSeconds,
  audioFileExtension,
  computeAudioPeaks,
  describeAudioProblem,
  formatAudioClock,
  pickRecorderMimeType
} from "./notices-view-model";

// Audio do aviso (docs/22 §4.5): "Enviar arquivo" (MP3, M4A, OGG, WEBM ou WAV) ou "Gravar agora" no
// proprio navegador (MediaRecorder; webm/opus no Chrome e no Firefox, mp4 no Safari), com cronometro,
// medidor do microfone e parada automatica em 5 minutos. Antes de enviar, o navegador decodifica o
// audio (AudioContext.decodeAudioData) para saber a duracao e desenhar a forma de onda (48 barras);
// arquivo acima de 5 min ou 10 MB e recusado aqui mesmo. O envio vai para a rota
// /api/admin/communications/audio (multipart: o audio passa do limite das Server Actions) e so o
// endereco, a duracao e a forma de onda entram no rascunho. Sem MediaRecorder, so "Enviar arquivo".

export type NoticeAudio = NonNullable<NoticeDraft["audio"]>;

type Phase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "recording" }
  | { durationSeconds: number; kind: "recorded"; mimeType: string; peaks: number[]; url: string }
  | { kind: "processing"; label: string };

type NoticeAudioFieldProps = {
  disabled?: boolean;
  error?: string | null;
  id: string;
  /** Motivo para o editor nao salvar agora (gravando, enviando, gravacao sem usar); null = livre. */
  onBusyChange?: (reason: string | null) => void;
  onChange: (audio: NoticeAudio | null) => void;
  value: NoticeAudio | null;
};

const MIC_DENIED_MESSAGE = "Libere o microfone nas configurações do navegador para gravar.";
const MIC_MISSING_MESSAGE = "Não encontramos um microfone neste aparelho.";
const DECODE_FAILED_MESSAGE = "Não foi possível ler este áudio. Use um arquivo MP3, M4A, OGG, WEBM ou WAV.";
const UPLOAD_FAILED_MESSAGE = "Não foi possível enviar o áudio. Tente de novo em instantes.";
const HINT = "MP3, M4A, OGG, WEBM ou WAV, até 5 minutos e 10 MB. O aluno ouve direto no aviso.";

type AudioContextConstructor = typeof AudioContext;

function audioContextClass(): AudioContextConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = window as Window & { webkitAudioContext?: AudioContextConstructor };

  return window.AudioContext ?? candidate.webkitAudioContext ?? null;
}

function canRecordNow() {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    pickRecorderMimeType((type) => window.MediaRecorder.isTypeSupported(type)) !== null
  );
}

const noopSubscribe = () => () => undefined;

/** Gravar no navegador e possivel aqui? (no servidor, nao: o botao so aparece depois de hidratar) */
function useCanRecord() {
  return useSyncExternalStore(noopSubscribe, canRecordNow, () => false);
}

/** Duracao e forma de onda, decodificando o audio no navegador. */
async function analyzeAudio(blob: Blob): Promise<{ durationSeconds: number; peaks: number[]; seconds: number }> {
  const Context = audioContextClass();

  if (!Context) {
    throw new Error("decode");
  }

  const context = new Context();

  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());

    return {
      durationSeconds: audioDurationSeconds(decoded.duration),
      peaks: computeAudioPeaks(decoded.getChannelData(0)),
      seconds: decoded.duration
    };
  } finally {
    void context.close().catch(() => undefined);
  }
}

async function uploadAudio(blob: Blob, mimeType: string): Promise<{ mimeType: string | null; url: string }> {
  const type = mimeType.split(";")[0].trim() || "audio/webm";
  const form = new FormData();
  form.append("file", new File([blob], `aviso.${audioFileExtension(type)}`, { type }));

  const response = await fetch("/api/admin/communications/audio", { body: form, credentials: "same-origin", method: "POST" });
  const payload = (await response.json().catch(() => null)) as { data?: { mimeType: string | null; url: string }; error?: string } | null;

  if (!response.ok || !payload?.data?.url) {
    throw new Error(payload?.error || UPLOAD_FAILED_MESSAGE);
  }

  return payload.data;
}

function busyReason(phase: Phase) {
  switch (phase.kind) {
    case "requesting":
    case "recording":
      return "Termine a gravação do áudio antes de salvar.";
    case "recorded":
      return "Use ou descarte a gravação do áudio antes de salvar.";
    case "processing":
      return "Espere o áudio terminar de enviar e salve de novo.";
    default:
      return null;
  }
}

export function NoticeAudioField({ disabled = false, error, id, onBusyChange, onChange, value }: NoticeAudioFieldProps) {
  const canRecord = useCanRecord();
  const [phase, setPhaseState] = useState<Phase>({ kind: "idle" });
  const [replacing, setReplacing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const meter = useRef<HTMLSpanElement>(null);
  const session = useRef<{
    chunks: Blob[];
    context: AudioContext | null;
    frame: number | null;
    mimeType: string;
    recorder: MediaRecorder | null;
    startedAt: number;
    stream: MediaStream | null;
    timer: number | null;
  } | null>(null);
  const recordedUrl = useRef<string | null>(null);
  const pendingBlob = useRef<Blob | null>(null);
  const onBusyChangeRef = useRef(onBusyChange);

  useEffect(() => {
    onBusyChangeRef.current = onBusyChange;
  }, [onBusyChange]);

  function setPhase(next: Phase) {
    setPhaseState(next);
    onBusyChangeRef.current?.(busyReason(next));
  }

  function releaseRecordedUrl() {
    if (recordedUrl.current) {
      URL.revokeObjectURL(recordedUrl.current);
      recordedUrl.current = null;
    }
  }

  function stopSession() {
    const current = session.current;

    if (!current) {
      return;
    }

    if (current.timer !== null) {
      window.clearInterval(current.timer);
    }

    if (current.frame !== null) {
      window.cancelAnimationFrame(current.frame);
    }

    current.stream?.getTracks().forEach((track) => track.stop());
    void current.context?.close().catch(() => undefined);
    session.current = null;
  }

  // Saiu da tela no meio: solta o microfone e o endereco temporario da gravacao.
  useEffect(
    () => () => {
      const current = session.current;

      if (current) {
        if (current.recorder && current.recorder.state !== "inactive") {
          current.recorder.onstop = null;
          current.recorder.stop();
        }

        if (current.timer !== null) {
          window.clearInterval(current.timer);
        }

        if (current.frame !== null) {
          window.cancelAnimationFrame(current.frame);
        }

        current.stream?.getTracks().forEach((track) => track.stop());
        void current.context?.close().catch(() => undefined);
        session.current = null;
      }

      if (recordedUrl.current) {
        URL.revokeObjectURL(recordedUrl.current);
        recordedUrl.current = null;
      }
    },
    []
  );

  async function finishWith(blob: Blob, mimeType: string, analyzed?: { durationSeconds: number; peaks: number[] }) {
    setPhase({ kind: "processing", label: analyzed ? "Enviando o áudio..." : "Preparando o áudio..." });

    try {
      const meta = analyzed ?? (await analyzeAudio(blob));

      setPhase({ kind: "processing", label: "Enviando o áudio..." });
      const uploaded = await uploadAudio(blob, mimeType);

      releaseRecordedUrl();
      onChange({ durationSeconds: meta.durationSeconds, mimeType: uploaded.mimeType, peaks: meta.peaks, url: uploaded.url });
      setReplacing(false);
      setPhase({ kind: "idle" });
    } catch (failure) {
      const message = failure instanceof Error && failure.message !== "decode" ? failure.message : DECODE_FAILED_MESSAGE;
      setLocalError(message);
      setPhase({ kind: "idle" });
    }
  }

  async function chooseFile(file: File) {
    setLocalError(null);
    const sizeProblem = describeAudioProblem({ bytes: file.size });

    if (sizeProblem) {
      setLocalError(sizeProblem);
      return;
    }

    setPhase({ kind: "processing", label: "Preparando o áudio..." });

    let analyzed: Awaited<ReturnType<typeof analyzeAudio>>;

    try {
      analyzed = await analyzeAudio(file);
    } catch {
      setLocalError(DECODE_FAILED_MESSAGE);
      setPhase({ kind: "idle" });
      return;
    }

    const durationProblem = describeAudioProblem({ seconds: analyzed.seconds });

    if (durationProblem) {
      setLocalError(durationProblem);
      setPhase({ kind: "idle" });
      return;
    }

    await finishWith(file, file.type || "audio/mpeg", analyzed);
  }

  function stopRecording() {
    const recorder = session.current?.recorder;

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
  }

  async function startRecording() {
    setLocalError(null);
    releaseRecordedUrl();
    setElapsed(0);

    const mimeType = pickRecorderMimeType((type) => window.MediaRecorder.isTypeSupported(type));

    if (!mimeType) {
      setLocalError(MIC_MISSING_MESSAGE);
      return;
    }

    setPhase({ kind: "requesting" });
    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (failure) {
      const name = failure instanceof DOMException ? failure.name : "";
      setLocalError(name === "NotFoundError" || name === "OverconstrainedError" ? MIC_MISSING_MESSAGE : MIC_DENIED_MESSAGE);
      setPhase({ kind: "idle" });
      return;
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    const current = {
      chunks: [] as Blob[],
      context: null as AudioContext | null,
      frame: null as number | null,
      mimeType: recorder.mimeType || mimeType,
      recorder,
      startedAt: Date.now(),
      stream,
      timer: null as number | null
    };
    session.current = current;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        current.chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(current.chunks, { type: current.mimeType });
      stopSession();
      setPhase({ kind: "processing", label: "Preparando o áudio..." });

      analyzeAudio(blob)
        .then((analyzed) => {
          if (analyzed.durationSeconds > RECORDING_LIMIT_SECONDS) {
            setLocalError(AUDIO_TOO_LONG_MESSAGE);
            setPhase({ kind: "idle" });
            return;
          }

          const url = URL.createObjectURL(blob);
          recordedUrl.current = url;
          pendingBlob.current = blob;
          setPhase({ durationSeconds: analyzed.durationSeconds, kind: "recorded", mimeType: current.mimeType, peaks: analyzed.peaks, url });
        })
        .catch(() => {
          setLocalError(DECODE_FAILED_MESSAGE);
          setPhase({ kind: "idle" });
        });
    };

    // Medidor: volume (RMS) do microfone a cada quadro, direto no estilo (sem re-render).
    const Context = audioContextClass();

    if (Context) {
      const context = new Context();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      current.context = context;
      const samples = new Uint8Array(analyser.fftSize);
      const draw = () => {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;

        for (const sample of samples) {
          const centered = (sample - 128) / 128;
          sum += centered * centered;
        }

        const level = Math.min(1, Math.sqrt(sum / samples.length) * 3);

        if (meter.current) {
          meter.current.style.transform = `scaleX(${level.toFixed(3)})`;
        }

        current.frame = window.requestAnimationFrame(draw);
      };
      current.frame = window.requestAnimationFrame(draw);
    }

    current.timer = window.setInterval(() => {
      const seconds = (Date.now() - current.startedAt) / 1000;
      setElapsed(seconds);

      if (seconds >= RECORDING_LIMIT_SECONDS) {
        stopRecording();
      }
    }, 250);

    recorder.start(1000);
    setPhase({ kind: "recording" });
  }

  function discardRecording() {
    releaseRecordedUrl();
    pendingBlob.current = null;
    setPhase({ kind: "idle" });
  }

  function acceptRecording() {
    if (phase.kind !== "recorded" || !pendingBlob.current) {
      return;
    }

    const blob = pendingBlob.current;
    pendingBlob.current = null;
    void finishWith(blob, phase.mimeType, { durationSeconds: phase.durationSeconds, peaks: phase.peaks });
  }

  const shownError = localError ?? error ?? null;
  const showChooser = (!value || replacing) && phase.kind === "idle";

  return (
    <div className="flex min-w-0 flex-col gap-2" id={id} tabIndex={-1}>
      <input
        accept="audio/*"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";

          if (file) {
            void chooseFile(file);
          }
        }}
        ref={fileInput}
        tabIndex={-1}
        type="file"
      />

      {value && phase.kind === "idle" && !replacing ? (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="rounded-[14px] bg-[#141414] p-2">
            <NoticeAudioPlayer audio={value} label="Áudio do aviso" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="px-3" disabled={disabled} onClick={() => setReplacing(true)} type="button" variant="secondary">
              Trocar áudio
            </Button>
            <Button
              className="px-3 text-[var(--text-secondary)]"
              disabled={disabled}
              onClick={() => {
                setLocalError(null);
                onChange(null);
              }}
              type="button"
              variant="ghost"
            >
              Remover
            </Button>
          </div>
        </div>
      ) : null}

      {showChooser ? (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button className="px-3" disabled={disabled} onClick={() => fileInput.current?.click()} type="button" variant="secondary">
              <Upload aria-hidden="true" className="size-4" />
              Enviar arquivo
            </Button>
            {canRecord ? (
              <Button className="px-3" disabled={disabled} onClick={() => void startRecording()} type="button" variant="secondary">
                <Mic aria-hidden="true" className="size-4" />
                Gravar agora
              </Button>
            ) : null}
            {replacing ? (
              <Button className="px-3 text-[var(--text-secondary)]" onClick={() => setReplacing(false)} type="button" variant="ghost">
                Cancelar
              </Button>
            ) : null}
          </div>
          <p className="text-xs leading-5 text-[var(--text-secondary)]">{HINT}</p>
        </div>
      ) : null}

      {phase.kind === "requesting" ? (
        <p className="flex items-center gap-2 text-[13px] leading-5 text-[var(--text-secondary)]" role="status">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          Esperando a permissão do microfone...
        </p>
      ) : null}

      {phase.kind === "recording" ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-[var(--border-strong)] bg-[var(--surface-2)] p-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="size-2.5 shrink-0 animate-pulse rounded-full bg-[var(--error)] motion-reduce:animate-none" />
            <span className="text-sm font-medium text-[var(--text-primary)]">Gravando</span>
            <span aria-live="off" className="ml-auto text-sm text-[var(--text-secondary)] tabular-nums">
              {formatAudioClock(elapsed)} de {formatAudioClock(RECORDING_LIMIT_SECONDS)}
            </span>
          </div>
          <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <span className="block h-full origin-left bg-[var(--text-primary)] transition-transform duration-75 motion-reduce:transition-none" ref={meter} style={{ transform: "scaleX(0)" }} />
          </span>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs leading-5 text-[var(--text-secondary)]">A gravação para sozinha em 5 minutos.</p>
            <Button className="px-3" onClick={stopRecording} type="button">
              <Square aria-hidden="true" className="size-3.5 fill-current" />
              Parar
            </Button>
          </div>
          <span className="sr-only" role="status">
            Gravando áudio
          </span>
        </div>
      ) : null}

      {phase.kind === "recorded" ? (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="rounded-[14px] bg-[#141414] p-2">
            <NoticeAudioPlayer
              audio={{ durationSeconds: phase.durationSeconds, mimeType: phase.mimeType, peaks: phase.peaks, url: phase.url }}
              label="Gravação"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button className="px-3" onClick={acceptRecording} type="button">
              Usar gravação
            </Button>
            <Button className="px-3" onClick={() => void startRecording()} type="button" variant="secondary">
              <RotateCcw aria-hidden="true" className="size-4" />
              Regravar
            </Button>
            <Button className="px-3 text-[var(--text-secondary)]" onClick={discardRecording} type="button" variant="ghost">
              Descartar
            </Button>
          </div>
        </div>
      ) : null}

      {phase.kind === "processing" ? (
        <p className="flex items-center gap-2 text-[13px] leading-5 text-[var(--text-secondary)]" role="status">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
          {phase.label}
        </p>
      ) : null}

      {shownError ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" id={`${id}-error`} role="alert">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {shownError}
        </p>
      ) : null}
    </div>
  );
}
