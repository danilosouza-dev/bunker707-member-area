"use client";

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { YouTubeCourseImportModule, YouTubeCourseImportModuleRange, YouTubePlaylistSourceItem } from "@/lib/youtube-course-import";
import { cn } from "@/lib/utils";
import { adminInputClass } from "../form";
import { adminCard, adminTransition } from "../styles";
import { MAX_IMPORT_MODULES, addModuleRange, describeLessonCount, removeModuleRange, updateModuleRange } from "./playlist-ranges";

// Partes visuais do Importar: a previa dos modulos (como vao ficar) e o editor de "Dividir
// manualmente" (nome e intervalo de cada modulo). A logica dos intervalos fica em playlist-ranges.ts.

const VISIBLE_LESSONS = 5;

function ModulePreviewCard({ courseModule, position }: { courseModule: YouTubeCourseImportModule; position: number }) {
  const [expanded, setExpanded] = useState(false);
  const lessons = expanded ? courseModule.lessons : courseModule.lessons.slice(0, VISIBLE_LESSONS);
  const hidden = courseModule.lessons.length - lessons.length;

  return (
    <li className={cn(adminCard, "min-w-0 overflow-hidden")}>
      <div className="flex min-h-11 min-w-0 items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2">
        <span className="shrink-0 text-[13px] text-[var(--text-secondary)] tabular-nums">Módulo {position}</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text-primary)]" title={courseModule.title}>
          {courseModule.title}
        </span>
        <span className="shrink-0 text-[13px] text-[var(--text-secondary)] tabular-nums">{describeLessonCount(courseModule.lessons.length)}</span>
      </div>
      <ol className="flex flex-col py-1">
        {lessons.map((lesson) => (
          <li className="flex h-9 min-w-0 items-center gap-3 px-4 text-sm" key={`${lesson.videoId}-${lesson.sourcePosition}`}>
            <span className="w-6 shrink-0 text-right text-[13px] text-[var(--text-tertiary)] tabular-nums">{lesson.order}</span>
            <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]" title={lesson.title}>
              {lesson.title}
            </span>
            {lesson.duration ? (
              <span className="shrink-0 text-[13px] text-[var(--text-secondary)] tabular-nums">{lesson.duration}</span>
            ) : null}
          </li>
        ))}
      </ol>
      {hidden > 0 || expanded ? (
        <div className="border-t border-[var(--border-subtle)] px-2 py-1">
          <Button
            className="h-8! px-2 text-[13px] text-[var(--text-secondary)]"
            onClick={() => setExpanded((current) => !current)}
            type="button"
            variant="ghost"
          >
            {expanded ? "Mostrar menos" : `Mostrar mais ${describeLessonCount(hidden)}`}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function PlaylistModulesPreview({ modules }: { modules: readonly YouTubeCourseImportModule[] }) {
  return (
    <ol aria-label="Como os módulos vão ficar" className="flex min-w-0 flex-col gap-3">
      {modules.map((courseModule, index) => (
        <ModulePreviewCard courseModule={courseModule} key={`${index}-${courseModule.title}`} position={index + 1} />
      ))}
    </ol>
  );
}

type RangeEditorProps = {
  disabled?: boolean;
  onChange: (ranges: YouTubeCourseImportModuleRange[]) => void;
  ranges: readonly YouTubeCourseImportModuleRange[];
  videos: readonly YouTubePlaylistSourceItem[];
};

function toPosition(value: string) {
  const parsed = Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : 0;
}

/** "Dividir manualmente": nome e intervalo de videos de cada modulo, na ordem da playlist. */
export function PlaylistRangeEditor({ disabled = false, onChange, ranges, videos }: RangeEditorProps) {
  const first = videos[0]?.position ?? 1;
  const last = videos.at(-1)?.position ?? first;
  const titleAt = (position: number) => videos.find((video) => video.position === position)?.title ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ol aria-label="Módulos" className="flex min-w-0 flex-col gap-2">
        {ranges.map((range, index) => {
          const startTitle = titleAt(range.startPosition);
          const endTitle = titleAt(range.endPosition);

          return (
            <li className={cn(adminCard, "flex min-w-0 flex-col gap-2 p-3")} key={index}>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  aria-label={`Nome do módulo ${index + 1}`}
                  autoComplete="off"
                  className={cn(adminInputClass, "sm:flex-1")}
                  disabled={disabled}
                  maxLength={120}
                  onChange={(event) => onChange(updateModuleRange(ranges, index, { title: event.target.value }))}
                  placeholder={`Módulo ${index + 1}`}
                  value={range.title}
                />
                <div className="flex shrink-0 items-center gap-2 text-[13px] text-[var(--text-secondary)]">
                  <span>Vídeos</span>
                  <Input
                    aria-label={`Primeiro vídeo do módulo ${index + 1}`}
                    className={cn(adminInputClass, "w-16 px-2 text-center tabular-nums")}
                    disabled={disabled}
                    inputMode="numeric"
                    max={last}
                    min={first}
                    onChange={(event) => onChange(updateModuleRange(ranges, index, { startPosition: toPosition(event.target.value) }))}
                    type="number"
                    value={range.startPosition > 0 ? String(range.startPosition) : ""}
                  />
                  <span>a</span>
                  <Input
                    aria-label={`Último vídeo do módulo ${index + 1}`}
                    className={cn(adminInputClass, "w-16 px-2 text-center tabular-nums")}
                    disabled={disabled}
                    inputMode="numeric"
                    max={last}
                    min={first}
                    onChange={(event) => onChange(updateModuleRange(ranges, index, { endPosition: toPosition(event.target.value) }))}
                    type="number"
                    value={range.endPosition > 0 ? String(range.endPosition) : ""}
                  />
                  <Button
                    aria-label={`Remover o módulo ${index + 1}`}
                    className="ml-auto w-9 px-0 text-[var(--text-secondary)] sm:ml-0"
                    disabled={disabled || ranges.length <= 1}
                    onClick={() => onChange(removeModuleRange(ranges, index))}
                    type="button"
                    variant="ghost"
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </div>
              {startTitle || endTitle ? (
                <p className="truncate text-xs leading-5 text-[var(--text-secondary)]" title={`${startTitle ?? "—"} → ${endTitle ?? "—"}`}>
                  {startTitle ?? "—"} <span className="text-[var(--text-tertiary)]">→</span> {endTitle ?? "—"}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      <Button
        className={cn("self-start px-3", adminTransition)}
        disabled={disabled || ranges.length >= MAX_IMPORT_MODULES}
        onClick={() => onChange(addModuleRange(videos, ranges))}
        type="button"
        variant="secondary"
      >
        <Plus aria-hidden="true" className="size-4" />
        Adicionar módulo
      </Button>
    </div>
  );
}
