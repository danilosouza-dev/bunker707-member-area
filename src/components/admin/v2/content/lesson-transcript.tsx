"use client";

import { AlertCircle, ClipboardPaste, Download, RefreshCw, Upload } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { LessonVideoProvider } from "@/lib/platform-types";
import { cn } from "@/lib/utils";
import { adminTextareaClass } from "../form";
import { StatusChip } from "../status-chip";
import { adminToast } from "../toast";
import {
  MAX_TRANSCRIPT_FILE_BYTES,
  describeTranscript,
  describeTutorReadiness,
  transcriptFormatFromFileName,
  type TranscriptStatus
} from "./lesson-draft";
import { smallButtonClass } from "./lesson-video-field";

// Secao "Transcrição e Tutor IA" do painel da aula (docs/17 §1.6.4). Usa as mesmas rotas que o admin
// antigo ja usa (GET/PUT /api/admin/lessons/{id}/transcript, .../import-youtube, .../tutor/process),
// com o visual do admin novo. Grava na hora, independente do "Salvar" da aula: a transcricao e o
// preparo do Tutor IA nao dependem do resto do formulario.

type TranscriptSectionProps = {
  canWrite: boolean;
  lessonId: string;
  /** Provedor do video ja salvo: "Importar do YouTube" so aparece para YouTube. */
  savedProvider: LessonVideoProvider | null;
};

type Busy = "import" | "paste" | "process" | "upload";

type TranscriptResponse = { data?: TranscriptStatus | null; error?: string };

const LANGUAGE = "pt-BR";

function transcriptUrl(lessonId: string, suffix = "") {
  return `/api/admin/lessons/${encodeURIComponent(lessonId)}/transcript${suffix}`;
}

async function readResponse(response: Response, fallback: string) {
  let payload: TranscriptResponse = {};

  try {
    payload = (await response.json()) as TranscriptResponse;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || fallback);
  }

  return payload.data ?? null;
}

const sourceLabels: Record<TranscriptStatus["source"], string> = {
  paste: "texto colado",
  upload: "arquivo enviado",
  youtube: "legenda do YouTube"
};

export function LessonTranscriptSection({ canWrite, lessonId, savedProvider }: TranscriptSectionProps) {
  const pasteId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<TranscriptStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch(transcriptUrl(lessonId), { cache: "no-store", credentials: "same-origin", signal: controller.signal })
      .then((response) => readResponse(response, "Não foi possível carregar a transcrição."))
      .then((data) => {
        setStatus(data);
        setLoaded(true);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar a transcrição.");
        setLoaded(true);
      });

    return () => controller.abort();
  }, [lessonId]);

  async function run(kind: Busy, request: () => Promise<Response>, fallback: string, success: string) {
    setBusy(kind);
    setError(null);

    try {
      const data = await readResponse(await request(), fallback);
      setStatus(data);
      adminToast.success(success);

      return true;
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : fallback);

      return false;
    } finally {
      setBusy(null);
    }
  }

  function importFromYouTube() {
    void run(
      "import",
      () =>
        fetch(transcriptUrl(lessonId, "/import-youtube"), {
          body: JSON.stringify({ language: LANGUAGE }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "POST"
        }),
      "Não foi possível importar a legenda do YouTube.",
      "Legenda do YouTube importada"
    );
  }

  function uploadFile(file: File | undefined) {
    if (!file) {
      return;
    }

    if (!transcriptFormatFromFileName(file.name)) {
      setError("Envie um arquivo SRT, VTT ou TXT.");

      return;
    }

    if (file.size > MAX_TRANSCRIPT_FILE_BYTES) {
      setError("O arquivo pode ter no máximo 2 MB.");

      return;
    }

    const form = new FormData();
    form.set("file", file);
    form.set("language", LANGUAGE);

    void run(
      "upload",
      () => fetch(transcriptUrl(lessonId), { body: form, credentials: "same-origin", method: "PUT" }),
      "Não foi possível enviar a transcrição.",
      "Transcrição enviada"
    );
  }

  async function savePaste() {
    const text = pasteText.trim();

    if (!text) {
      setError("Cole o texto da aula antes de usar.");

      return;
    }

    const saved = await run(
      "paste",
      () =>
        fetch(transcriptUrl(lessonId), {
          body: JSON.stringify({ format: "txt", language: LANGUAGE, source: "paste", text }),
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          method: "PUT"
        }),
      "Não foi possível salvar o texto.",
      "Transcrição salva"
    );

    if (saved) {
      setPasteOpen(false);
      setPasteText("");
    }
  }

  function prepareTutor() {
    void run(
      "process",
      () =>
        fetch(`/api/admin/lessons/${encodeURIComponent(lessonId)}/tutor/process`, {
          credentials: "same-origin",
          method: "POST"
        }),
      "Não foi possível preparar a aula para o Tutor IA.",
      "Aula preparada para o Tutor IA"
    );
  }

  const described = describeTranscript(status);
  const canRetryTutor = status?.status === "ready" && (status.profileStatus === "error" || status.profileStatus === "waiting_provider");
  const working = busy !== null;

  return (
    <div aria-busy={working || !loaded} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {loaded ? (
          <StatusChip tone={described.tone}>{described.label}</StatusChip>
        ) : (
          <StatusChip tone="muted">Carregando…</StatusChip>
        )}
        {status ? (
          <span className="text-[13px] leading-5 text-[var(--text-secondary)]">
            {sourceLabels[status.source]}
            {status.version > 1 ? ` · versão ${status.version}` : ""}
          </span>
        ) : null}
      </div>

      {loaded ? <p className="text-[13px] leading-5 text-[var(--text-secondary)]">{describeTutorReadiness(status)}</p> : null}

      {error ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--error)]" role="alert">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{error}</span>
        </p>
      ) : null}

      {canWrite && loaded ? (
        <div className="flex flex-wrap items-center gap-2">
          {savedProvider === "youtube" ? (
            <Button
              className={cn(smallButtonClass, "border-[var(--border-strong)]")}
              disabled={working}
              onClick={importFromYouTube}
              type="button"
              variant="secondary"
            >
              <Download aria-hidden="true" />
              {busy === "import" ? "Importando…" : "Importar do YouTube"}
            </Button>
          ) : null}
          <Button
            className={cn(smallButtonClass, "border-[var(--border-strong)]")}
            disabled={working}
            onClick={() => fileRef.current?.click()}
            type="button"
            variant="secondary"
          >
            <Upload aria-hidden="true" />
            {busy === "upload" ? "Enviando…" : "Enviar SRT/VTT/TXT"}
          </Button>
          <Button
            aria-controls={pasteOpen ? pasteId : undefined}
            aria-expanded={pasteOpen}
            className={cn(smallButtonClass, "border-[var(--border-strong)]")}
            disabled={working}
            onClick={() => setPasteOpen((open) => !open)}
            type="button"
            variant="secondary"
          >
            <ClipboardPaste aria-hidden="true" />
            Colar texto
          </Button>
          {canRetryTutor ? (
            <Button
              className={cn(smallButtonClass, "text-[var(--text-secondary)]")}
              disabled={working}
              onClick={prepareTutor}
              type="button"
              variant="ghost"
            >
              <RefreshCw aria-hidden="true" />
              {busy === "process" ? "Preparando…" : "Preparar para o Tutor IA"}
            </Button>
          ) : null}
          <input
            accept=".srt,.vtt,.txt,text/plain,text/vtt"
            className="sr-only"
            onChange={(event) => {
              uploadFile(event.target.files?.[0]);
              event.target.value = "";
            }}
            ref={fileRef}
            tabIndex={-1}
            type="file"
          />
        </div>
      ) : null}

      {canWrite && pasteOpen ? (
        <div className="flex flex-col gap-2" id={pasteId}>
          <label className="text-[13px] leading-5 font-medium text-[var(--text-primary)]" htmlFor={`${pasteId}-text`}>
            Texto da transcrição
          </label>
          <textarea
            className={cn(adminTextareaClass, "min-h-28")}
            disabled={working}
            id={`${pasteId}-text`}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder="Cole aqui o texto falado na aula"
            rows={5}
            value={pasteText}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button className={smallButtonClass} disabled={working} onClick={() => void savePaste()} type="button">
              {busy === "paste" ? "Salvando…" : "Usar este texto"}
            </Button>
            <Button
              className={cn(smallButtonClass, "text-[var(--text-secondary)]")}
              disabled={working}
              onClick={() => {
                setPasteOpen(false);
                setPasteText("");
              }}
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
