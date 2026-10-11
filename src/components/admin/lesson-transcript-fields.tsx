"use client";

import * as React from "react";
import {
  AlertCircle,
  BrainCircuit,
  CirclePlay,
  CheckCircle2,
  FileText,
  LoaderCircle,
  RefreshCw,
  Upload
} from "lucide-react";

import type { LessonVideoProvider } from "@/lib/platform-types";

export type LessonTranscriptDraft = {
  fileName: string;
  format: "srt" | "txt" | "vtt";
  language: string;
  mode: "keep" | "manual" | "youtube";
  source: "paste" | "upload";
  text: string;
};

type TranscriptStatus = {
  chunkCount: number;
  createdAt: string;
  errorMessage: string | null;
  format: "json3" | "srt" | "txt" | "vtt";
  language: string;
  profileStatus: "error" | "processing" | "ready" | "waiting_provider";
  source: "paste" | "upload" | "youtube";
  sourceVideoId: string | null;
  status: "error" | "processing" | "ready";
  transcriptId: string;
  version: number;
};

export const emptyLessonTranscriptDraft: LessonTranscriptDraft = {
  fileName: "",
  format: "txt",
  language: "pt-BR",
  mode: "youtube",
  source: "paste",
  text: ""
};

export const keepLessonTranscriptDraft: LessonTranscriptDraft = {
  ...emptyLessonTranscriptDraft,
  mode: "keep"
};

export function LessonTranscriptFields({
  draft,
  lessonId,
  onChange,
  videoProvider
}: {
  draft: LessonTranscriptDraft;
  lessonId?: string;
  onChange: (draft: LessonTranscriptDraft) => void;
  videoProvider: LessonVideoProvider;
}) {
  const [status, setStatus] = React.useState<TranscriptStatus | null>(null);
  const [loading, setLoading] = React.useState(Boolean(lessonId));
  const [busy, setBusy] = React.useState<"import" | "process" | "save" | null>(null);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const currentPropsRef = React.useRef({ draft, onChange, videoProvider });

  React.useEffect(() => {
    currentPropsRef.current = { draft, onChange, videoProvider };
  }, [draft, onChange, videoProvider]);

  const loadStatus = React.useCallback(async () => {
    if (!lessonId) return;
    await Promise.resolve();
    setLoading(true);

    try {
      const response = await fetch(`/api/admin/lessons/${encodeURIComponent(lessonId)}/transcript`, {
        cache: "no-store",
        credentials: "same-origin"
      });
      const payload = await response.json() as { data?: TranscriptStatus | null; error?: string };

      if (!response.ok) throw new Error(payload.error ?? "Nao foi possivel carregar a transcricao.");
      setStatus(payload.data ?? null);

      const current = currentPropsRef.current;

      if (!payload.data && current.draft.mode === "keep") {
        current.onChange({
          ...emptyLessonTranscriptDraft,
          mode: current.videoProvider === "youtube" ? "youtube" : "manual"
        });
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Nao foi possivel carregar a transcricao.");
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  React.useEffect(() => {
    const timeout = window.setTimeout(() => void loadStatus(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadStatus]);

  React.useEffect(() => {
    if (videoProvider !== "youtube" && draft.mode === "youtube") {
      onChange({ ...draft, mode: "manual" });
    }
  }, [draft, onChange, videoProvider]);

  function updateDraft(values: Partial<LessonTranscriptDraft>) {
    onChange({ ...draft, ...values });
    setError("");
    setMessage("");
  }

  async function readTranscriptFile(file: File | undefined) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();

    if (!extension || !(["srt", "txt", "vtt"] as string[]).includes(extension)) {
      setError("Envie um arquivo SRT, VTT ou TXT.");
      return;
    }

    if (file.size > 2_000_000) {
      setError("O arquivo de transcricao pode ter no maximo 2 MB.");
      return;
    }

    updateDraft({
      fileName: file.name,
      format: extension as LessonTranscriptDraft["format"],
      mode: "manual",
      source: "upload",
      text: await file.text()
    });
  }

  async function importYouTube() {
    if (!lessonId) return;
    setBusy("import");
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/lessons/${encodeURIComponent(lessonId)}/transcript/import-youtube`, {
        body: JSON.stringify({ language: draft.language }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = await response.json() as { data?: TranscriptStatus; error?: string; warning?: string };

      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Nao foi possivel importar a legenda.");
      setStatus(payload.data);
      onChange(keepLessonTranscriptDraft);
      setMessage(payload.warning ?? "Legenda importada e salva na aula.");
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Nao foi possivel importar a legenda.");
    } finally {
      setBusy(null);
    }
  }

  async function saveManualTranscript() {
    if (!lessonId || !draft.text.trim()) return;
    setBusy("save");
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/lessons/${encodeURIComponent(lessonId)}/transcript`, {
        body: JSON.stringify({
          format: draft.format,
          language: draft.language,
          source: draft.source,
          text: draft.text
        }),
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        method: "PUT"
      });
      const payload = await response.json() as { data?: TranscriptStatus; error?: string; warning?: string };

      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Nao foi possivel salvar a transcricao.");
      setStatus(payload.data);
      onChange(keepLessonTranscriptDraft);
      setMessage(payload.warning ?? "Transcricao salva e preparada para o Tutor IA.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Nao foi possivel salvar a transcricao.");
    } finally {
      setBusy(null);
    }
  }

  async function processProfile() {
    if (!lessonId) return;
    setBusy("process");
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/admin/lessons/${encodeURIComponent(lessonId)}/tutor/process`, {
        credentials: "same-origin",
        method: "POST"
      });
      const payload = await response.json() as { data?: TranscriptStatus; error?: string };

      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Nao foi possivel analisar a aula.");
      setStatus(payload.data);
      setMessage(payload.data.profileStatus === "waiting_provider"
        ? "Transcricao pronta. Configure um provedor de IA para concluir a analise."
        : "Aula analisada e pronta para o Tutor IA.");
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : "Nao foi possivel analisar a aula.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-[8px] border border-white/10 bg-white/[0.025] p-3.5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[7px] bg-[var(--accent)]/10 text-[var(--accent)]">
          <BrainCircuit className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Conteudo do Tutor IA</p>
          <p className="mt-1 text-xs font-medium leading-5 text-zinc-500">
            A legenda do YouTube e importada automaticamente. Se o video nao tiver legenda, envie ou cole a transcricao.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-[7px] bg-black/20 px-3 py-2 text-xs font-medium text-zinc-500">
          <LoaderCircle className="size-3.5 animate-spin" />
          Carregando transcricao atual...
        </div>
      ) : status ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[7px] border border-emerald-400/15 bg-emerald-500/[0.055] px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2 text-xs font-medium text-emerald-100/85">
            <CheckCircle2 className="size-4 shrink-0 text-emerald-400" />
            <span className="truncate">
              Versao {status.version} • {status.source === "youtube" ? "YouTube" : status.format.toUpperCase()} • {status.chunkCount} trechos
            </span>
          </span>
          <span className="text-[11px] font-semibold text-emerald-300">
            {status.profileStatus === "ready"
              ? "Tutor pronto"
              : status.profileStatus === "waiting_provider"
                ? "Aguardando modelo de IA"
                : status.profileStatus === "processing"
                  ? "Analisando"
                  : "Requer reprocessamento"}
          </span>
        </div>
      ) : null}

      {videoProvider === "youtube" ? (
        <label className={`flex cursor-pointer items-start gap-3 rounded-[7px] border px-3 py-2.5 transition ${draft.mode === "youtube" ? "border-red-400/30 bg-red-500/[0.07]" : "border-white/[0.07] bg-black/15 hover:bg-white/[0.04]"}`}>
          <input
            checked={draft.mode === "youtube"}
            className="mt-0.5 size-4 accent-[var(--accent)]"
            name={`transcript-mode-${lessonId ?? "new"}`}
            onChange={() => updateDraft({ mode: "youtube" })}
            type="radio"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-xs font-semibold text-zinc-200"><CirclePlay className="size-3.5 text-red-400" /> Importar legenda do YouTube</span>
            <span className="mt-1 block text-[11px] leading-4 text-zinc-500">Usa a faixa pública do vídeo e salva uma cópia permanente na plataforma.</span>
          </span>
        </label>
      ) : null}

      <label className={`flex cursor-pointer items-start gap-3 rounded-[7px] border px-3 py-2.5 transition ${draft.mode === "manual" ? "border-white/20 bg-white/[0.055]" : "border-white/[0.07] bg-black/15 hover:bg-white/[0.04]"}`}>
        <input
          checked={draft.mode === "manual"}
          className="mt-0.5 size-4 accent-[var(--accent)]"
          name={`transcript-mode-${lessonId ?? "new"}`}
          onChange={() => updateDraft({ mode: "manual" })}
          type="radio"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-xs font-semibold text-zinc-200"><FileText className="size-3.5" /> Enviar ou colar transcricao</span>
          <span className="mt-1 block text-[11px] leading-4 text-zinc-500">Aceita SRT, VTT e TXT. SRT/VTT preservam os momentos exatos do video.</span>
        </span>
      </label>

      {draft.mode === "manual" ? (
        <div className="space-y-3 rounded-[7px] border border-white/[0.07] bg-black/15 p-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <label className="grid gap-1.5 text-xs font-semibold text-zinc-500">
              Arquivo de legenda
              <span className="relative flex min-h-10 cursor-pointer items-center gap-2 rounded-[7px] border border-dashed border-white/15 bg-black/20 px-3 text-xs font-medium text-zinc-300 hover:bg-white/[0.04]">
                <Upload className="size-3.5" />
                <span className="truncate">{draft.fileName || "Selecionar SRT, VTT ou TXT"}</span>
                <input
                  accept=".srt,.vtt,.txt,text/plain,text/vtt,application/x-subrip"
                  className="absolute inset-0 cursor-pointer opacity-0"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    void readTranscriptFile(file);
                  }}
                  type="file"
                />
              </span>
            </label>
            <label className="grid gap-1.5 text-xs font-semibold text-zinc-500">
              Idioma
              <input
                className="h-10 rounded-[7px] border border-white/10 bg-black/25 px-3 text-xs font-medium text-white outline-none focus:border-white/25"
                onChange={(event) => updateDraft({ language: event.target.value })}
                placeholder="pt-BR"
                value={draft.language}
              />
            </label>
          </div>
          <label className="grid gap-1.5 text-xs font-semibold text-zinc-500">
            Ou cole a transcricao
            <textarea
              className="min-h-28 resize-y rounded-[7px] border border-white/10 bg-black/25 px-3 py-2.5 text-xs font-medium leading-5 text-white outline-none placeholder:text-zinc-600 focus:border-white/25"
              onChange={(event) => updateDraft({ fileName: "", format: "txt", source: "paste", text: event.target.value })}
              placeholder="Cole aqui a transcricao completa da aula..."
              value={draft.text}
            />
          </label>
        </div>
      ) : null}

      {error ? (
        <p className="flex items-start gap-2 rounded-[7px] border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-medium leading-5 text-red-200">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      ) : null}
      {message ? <p className="rounded-[7px] border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-200">{message}</p> : null}

      {lessonId ? (
        <div className="flex flex-wrap justify-end gap-2">
          {status ? (
            <button
              className="inline-flex min-h-9 items-center gap-2 rounded-[7px] border border-white/10 bg-white/[0.045] px-3 text-xs font-semibold text-zinc-300 transition hover:bg-white/[0.08] hover:text-white disabled:opacity-50"
              disabled={Boolean(busy)}
              onClick={() => void processProfile()}
              type="button"
            >
              {busy === "process" ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              Reprocessar IA
            </button>
          ) : null}
          {draft.mode === "youtube" ? (
            <button
              className="inline-flex min-h-9 items-center gap-2 rounded-[7px] bg-white px-3 text-xs font-semibold text-black transition hover:bg-zinc-200 disabled:opacity-50"
              disabled={Boolean(busy)}
              onClick={() => void importYouTube()}
              type="button"
            >
              {busy === "import" ? <LoaderCircle className="size-3.5 animate-spin" /> : <CirclePlay className="size-3.5" />}
              Importar agora
            </button>
          ) : draft.mode === "manual" ? (
            <button
              className="inline-flex min-h-9 items-center gap-2 rounded-[7px] bg-white px-3 text-xs font-semibold text-black transition hover:bg-zinc-200 disabled:opacity-50"
              disabled={Boolean(busy) || !draft.text.trim()}
              onClick={() => void saveManualTranscript()}
              type="button"
            >
              {busy === "save" ? <LoaderCircle className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />}
              Salvar transcricao
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] font-medium leading-4 text-zinc-500">A transcricao sera validada e salva junto com a nova aula.</p>
      )}
    </div>
  );
}
