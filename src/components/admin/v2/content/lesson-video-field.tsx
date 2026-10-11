"use client";

import { CircleCheck, Code2, Info, Link2, LoaderCircle, PlayCircle, TriangleAlert } from "lucide-react";
import Image from "next/image";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { canOptimizeImageSrc } from "@/lib/image-hosts";
import { cn } from "@/lib/utils";
import { detectLessonVideo } from "@/lib/video-detect";
import type { VideoPreview } from "@/server/catalog/types";
import { AdminField, adminInputClass, adminTextareaClass, fieldDescribedBy } from "../form";
import { StatusChip } from "../status-chip";
import { VideoProviderIcon } from "./content-ui";

// Secao "Vídeo" do painel da aula (docs/17 §1.6.4): um campo so, "Cole o link do vídeo". O provedor
// e reconhecido na hora (detectLessonVideo, o mesmo que o servidor usa de novo ao salvar) e mostra um
// cartao com o provedor e um aviso de uma linha. "Outro provedor" libera o codigo de incorporacao.
// Sem seletor de provedor e sem "ID do vídeo": o link basta.

export const smallButtonClass = "h-8! gap-1.5 px-3 text-[13px]";

type LessonVideoFieldProps = {
  allowEmbedCode: boolean;
  disabled: boolean;
  durationLabel: string;
  error?: string | null;
  id: string;
  onAllowEmbedCodeChange: (allow: boolean) => void;
  onBlur: () => void;
  onChange: (value: string) => void;
  /** Sugestao do provedor para o link atual (null enquanto le ou quando nao ha). */
  preview: VideoPreview | null;
  previewLoading: boolean;
  /** Miniatura do video ja salvo (vale enquanto o link nao muda). */
  savedThumbnailUrl: string | null;
  savedVideoInput: string;
  value: string;
};

export function LessonVideoField({
  allowEmbedCode,
  disabled,
  durationLabel,
  error,
  id,
  onAllowEmbedCodeChange,
  onBlur,
  onChange,
  preview,
  previewLoading,
  savedThumbnailUrl,
  savedVideoInput,
  value
}: LessonVideoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = value.trim();
  const detection = trimmed ? detectLessonVideo(trimmed, { allowEmbedCode }) : null;
  const thumbnailUrl = preview?.thumbnailUrl ?? (trimmed === savedVideoInput.trim() ? savedThumbnailUrl : null);
  const hint = allowEmbedCode
    ? "Cole o código <iframe> que o provedor oferece. Só endereços https funcionam."
    : "YouTube, Vimeo, Bunny, Mux ou arquivo .mp4/.m3u8. Título, miniatura e duração vêm junto quando o provedor informa.";
  const describedBy = fieldDescribedBy(id, { error, hint: detection?.ok ? undefined : hint });

  function focusField() {
    window.requestAnimationFrame(() => (allowEmbedCode ? textareaRef.current : inputRef.current)?.focus());
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <AdminField
        error={error}
        hint={detection?.ok ? undefined : hint}
        id={id}
        label={allowEmbedCode ? "Link ou código de incorporação" : "Link do vídeo"}
      >
        {allowEmbedCode ? (
          <textarea
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={cn(adminTextareaClass, "min-h-20 font-mono text-[13px] leading-5")}
            disabled={disabled}
            id={id}
            onBlur={onBlur}
            onChange={(event) => onChange(event.target.value)}
            placeholder='<iframe src="https://…"></iframe>'
            ref={textareaRef}
            rows={3}
            spellCheck={false}
            value={value}
          />
        ) : (
          <input
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            className={adminInputClass}
            disabled={disabled}
            id={id}
            inputMode="url"
            onBlur={onBlur}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Cole o link do vídeo"
            ref={inputRef}
            spellCheck={false}
            type="text"
            value={value}
          />
        )}
      </AdminField>

      {detection?.ok ? (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3">
            <span className="relative grid h-9 w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-[var(--border-subtle)] bg-[var(--surface-1)] text-[var(--text-secondary)]">
              {thumbnailUrl ? (
                <Image
                  alt=""
                  className="object-cover"
                  fill
                  sizes="64px"
                  src={thumbnailUrl}
                  unoptimized={!canOptimizeImageSrc(thumbnailUrl)}
                />
              ) : (
                <PlayCircle aria-hidden="true" className="size-4" />
              )}
            </span>
            <span className="flex min-w-40 flex-1 flex-col">
              <span className="flex min-w-0 items-center gap-2 text-sm leading-5 font-medium text-[var(--text-primary)]">
                <VideoProviderIcon className="text-[var(--text-secondary)]" provider={detection.provider} />
                <span className="truncate">{detection.label}</span>
                <StatusChip tone="success">Reconhecido</StatusChip>
              </span>
              <span className="truncate text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums">
                {previewLoading ? (
                  <span className="inline-flex items-center gap-1.5">
                    <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
                    Lendo título e duração…
                  </span>
                ) : (
                  [durationLabel.trim() || "Duração não informada", thumbnailUrl ? "miniatura do provedor" : null]
                    .filter(Boolean)
                    .join(" · ")
                )}
              </span>
            </span>
            <Button
              className={cn(smallButtonClass, "ml-auto shrink-0 border-[var(--border-strong)]")}
              disabled={disabled}
              onClick={() => {
                onChange("");
                focusField();
              }}
              type="button"
              variant="secondary"
            >
              Trocar vídeo
            </Button>
          </div>
          <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--text-secondary)]">
            {detection.tone === "warning" ? (
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
            ) : (
              <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
            )}
            <span className="min-w-0">{detection.notice}</span>
          </p>
        </div>
      ) : !trimmed ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-5 text-[var(--text-tertiary)]">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Sem vídeo, a aula mostra só o nome e a descrição.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {allowEmbedCode ? (
          <Button
            className={cn(smallButtonClass, "border-[var(--border-strong)]")}
            disabled={disabled}
            onClick={() => {
              onAllowEmbedCodeChange(false);
              focusField();
            }}
            type="button"
            variant="secondary"
          >
            <Link2 aria-hidden="true" />
            Usar um link
          </Button>
        ) : (
          <Button
            className={cn(smallButtonClass, "border-[var(--border-strong)]")}
            disabled={disabled}
            onClick={() => {
              onAllowEmbedCodeChange(true);
              window.requestAnimationFrame(() => textareaRef.current?.focus());
            }}
            type="button"
            variant="secondary"
          >
            <Code2 aria-hidden="true" />
            Outro provedor
          </Button>
        )}
      </div>
    </div>
  );
}
