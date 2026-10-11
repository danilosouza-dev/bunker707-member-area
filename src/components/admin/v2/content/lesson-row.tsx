"use client";

import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/types";
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Eye,
  EyeOff,
  FolderInput,
  GripVertical,
  MoreHorizontal,
  Trash2
} from "lucide-react";
import { memo, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { LESSON_STATUS_LABELS } from "@/server/catalog/model";
import { StatusChip } from "../status-chip";
import { adminTransition } from "../styles";
import {
  VideoProviderIcon,
  rowIconButtonClass,
  rowMenuContentClass,
  rowMenuDangerItemClass,
  rowMenuItemClass
} from "./content-ui";
import { isLessonDragData } from "./dnd";
import { useContentTreeActions } from "./tree-context";
import type { TreeLesson } from "./tree-model";

// Linha de aula da arvore (docs/17 §1.6.3, shot 07): alca, selecao, numero, nome, provedor, duracao,
// situacao e menu. 48 px de altura; no celular vira nome + chip, com provedor e duracao embaixo.

/**
 * Colunas: selecao, alca, numero, nome, provedor, duracao, situacao, menu. Celular (4: selecao, numero,
 * nome e menu; situacao, provedor e duracao numa segunda linha), a partir de 768 px (8, provedor so com
 * icone) e de 1024 px (rotulo do provedor).
 */
export const lessonRowGrid = cn(
  "grid-cols-[28px_20px_minmax(0,1fr)_44px]",
  "md:grid-cols-[20px_20px_24px_minmax(0,1fr)_24px_52px_104px_32px]",
  "lg:grid-cols-[20px_20px_24px_minmax(0,1fr)_120px_56px_104px_32px]"
);

type LessonRowProps = {
  active: boolean;
  isFirstInTree: boolean;
  isLastInTree: boolean;
  lesson: TreeLesson;
  moduleId: string;
  selected: boolean;
  /** Ha aulas selecionadas: as caixas de selecao ficam visiveis em todas as linhas. */
  selectionActive: boolean;
};

export function DropLine({ edge, inset = "inset-x-2" }: { edge: Edge; inset?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-10 h-0.5 rounded-full bg-[var(--text-primary)]",
        inset,
        edge === "top" ? "-top-px" : "-bottom-px"
      )}
    />
  );
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("a, button, input, textarea, [role='checkbox'], [role='menuitem']"));
}

export const LessonRow = memo(function LessonRow({
  active,
  isFirstInTree,
  isLastInTree,
  lesson,
  moduleId,
  selected,
  selectionActive
}: LessonRowProps) {
  const actions = useContentTreeActions();
  const rowRef = useRef<HTMLLIElement>(null);
  const gripRef = useRef<HTMLSpanElement>(null);
  const [edge, setEdge] = useState<Edge | null>(null);
  const [dragging, setDragging] = useState(false);
  const canEdit = actions.canWrite && !lesson.pending;
  const lessonId = lesson.id;

  useEffect(() => {
    const row = rowRef.current;
    const grip = gripRef.current;

    if (!row || !grip || !canEdit) {
      return;
    }

    return combine(
      draggable({
        dragHandle: grip,
        element: row,
        getInitialData: () => ({ kind: "content-lesson", lessonId, moduleId }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false)
      }),
      // A propria linha tambem e alvo (sem linha de soltura): soltar a aula onde ela estava nao a
      // manda para o fim do modulo, que e o alvo logo abaixo.
      dropTargetForElements({
        canDrop: ({ source }) => isLessonDragData(source.data),
        element: row,
        getData: ({ element, input }) =>
          attachClosestEdge({ kind: "content-lesson", lessonId, moduleId }, { allowedEdges: ["top", "bottom"], element, input }),
        getIsSticky: () => true,
        onDrag: ({ self, source }) => setEdge(source.data.lessonId === lessonId ? null : extractClosestEdge(self.data)),
        onDragEnter: ({ self, source }) => setEdge(source.data.lessonId === lessonId ? null : extractClosestEdge(self.data)),
        onDragLeave: () => setEdge(null),
        onDrop: () => setEdge(null)
      })
    );
  }, [canEdit, lessonId, moduleId]);

  function handleRowClick(event: MouseEvent<HTMLLIElement>) {
    if (lesson.pending || isInteractiveTarget(event.target)) {
      return;
    }

    actions.openLesson(lessonId);
  }

  function handleTitleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    actions.openLesson(lessonId);
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLAnchorElement>) {
    if (!actions.canWrite || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return;
    }

    event.preventDefault();
    actions.stepLesson(lessonId, event.key === "ArrowUp" ? -1 : 1);
  }

  const durationLabel = lesson.durationLabel || "—";
  const providerLabel = lesson.video?.label ?? "Sem vídeo";
  const hasScheduledRelease = lesson.release.mode !== "immediate";

  return (
    <li
      aria-busy={lesson.pending || undefined}
      className={cn(
        "group/lesson relative grid min-h-12 items-center gap-x-2 border-b border-[var(--border-subtle)] py-1 pr-1 pl-2 last:border-b-0 md:pr-2",
        lessonRowGrid,
        lesson.pending ? "cursor-progress" : "cursor-pointer",
        active
          ? "bg-[var(--surface-2)] shadow-[inset_2px_0_0_var(--text-primary)]"
          : selected
            ? "bg-[var(--hover-overlay)]"
            : "hover:bg-[var(--hover-overlay)]",
        dragging && "opacity-40",
        adminTransition
      )}
      data-lesson-row={lessonId}
      onClick={handleRowClick}
      ref={rowRef}
    >
      {edge ? <DropLine edge={edge} /> : null}

      <span
        className={cn(
          "grid place-items-center",
          !selected && !selectionActive && "md:opacity-0 md:group-hover/lesson:opacity-100 md:group-focus-within/lesson:opacity-100",
          adminTransition
        )}
      >
        {actions.canWrite ? (
          <Checkbox
            aria-label={`Selecionar a aula ${lesson.title}`}
            checked={selected}
            className="border-[var(--border-strong)] bg-[var(--surface-1)] data-checked:border-[var(--text-primary)]"
            disabled={lesson.pending}
            onCheckedChange={(checked) => actions.toggleSelection(lessonId, checked === true)}
          />
        ) : null}
      </span>

      <span
        aria-hidden="true"
        className={cn(
          "hidden h-7 w-5 place-items-center rounded text-[var(--text-tertiary)] md:grid",
          canEdit ? "cursor-grab hover:text-[var(--text-primary)] active:cursor-grabbing" : "invisible"
        )}
        ref={gripRef}
        title={canEdit ? "Arraste para mudar a ordem" : undefined}
      >
        <GripVertical className="size-3.5" />
      </span>

      <span className="text-right text-[13px] leading-5 text-[var(--text-tertiary)] tabular-nums">{lesson.position}</span>

      <span className="flex min-w-0 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          {lesson.pending ? (
            <span className="truncate text-sm leading-5 text-[var(--text-secondary)]">{lesson.title}</span>
          ) : (
            <a
              aria-current={active ? "true" : undefined}
              aria-keyshortcuts={actions.canWrite ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
              className="min-w-0 truncate rounded-sm text-sm leading-5 text-[var(--text-primary)] hover:underline hover:decoration-[var(--border-strong)] hover:underline-offset-4"
              data-lesson-focus={lessonId}
              data-navigation-feedback="false"
              href={actions.lessonHref(lessonId)}
              onClick={handleTitleClick}
              onKeyDown={handleTitleKeyDown}
            >
              {lesson.title}
            </a>
          )}
          {hasScheduledRelease ? (
            <span className="inline-flex shrink-0 text-[var(--text-tertiary)]" title={lesson.releaseLabel}>
              <CalendarClock aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{lesson.releaseLabel}</span>
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-[var(--text-secondary)] tabular-nums md:hidden">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              lesson.pending
                ? "bg-[var(--text-tertiary)]"
                : lesson.status === "published"
                  ? "bg-[var(--success)]"
                  : "bg-[var(--text-secondary)]"
            )}
          />
          <span className="truncate">
            {lesson.pending ? "Criando…" : LESSON_STATUS_LABELS[lesson.status]} · {providerLabel}
            {lesson.durationLabel ? ` · ${lesson.durationLabel}` : ""}
          </span>
        </span>
      </span>

      <span
        className={cn(
          "hidden min-w-0 items-center gap-1.5 text-[13px] leading-5 md:inline-flex",
          lesson.video ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"
        )}
        title={providerLabel}
      >
        {lesson.video ? <VideoProviderIcon provider={lesson.video.provider} /> : <span aria-hidden="true" className="w-4 text-center">—</span>}
        <span className="hidden truncate lg:inline">{providerLabel}</span>
        <span className="sr-only lg:hidden">{providerLabel}</span>
      </span>

      <span className="hidden text-right text-[13px] leading-5 text-[var(--text-secondary)] tabular-nums md:block">{durationLabel}</span>

      <span className="hidden min-w-0 md:flex">
        {lesson.pending ? (
          <StatusChip tone="muted">Criando…</StatusChip>
        ) : (
          <StatusChip tone={lesson.status === "published" ? "success" : "neutral"}>{LESSON_STATUS_LABELS[lesson.status]}</StatusChip>
        )}
      </span>

      <span className="flex justify-end">
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={`Ações da aula ${lesson.title}`} className={rowIconButtonClass}>
              <MoreHorizontal aria-hidden="true" className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className={rowMenuContentClass}>
              <DropdownMenuItem className={rowMenuItemClass} onClick={() => actions.moveLessonsTo([lessonId])}>
                <FolderInput aria-hidden="true" />
                Mover para…
              </DropdownMenuItem>
              <DropdownMenuItem className={rowMenuItemClass} disabled={isFirstInTree} onClick={() => actions.stepLesson(lessonId, -1)}>
                <ArrowUp aria-hidden="true" />
                Subir
              </DropdownMenuItem>
              <DropdownMenuItem className={rowMenuItemClass} disabled={isLastInTree} onClick={() => actions.stepLesson(lessonId, 1)}>
                <ArrowDown aria-hidden="true" />
                Descer
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
              {lesson.status === "published" ? (
                <DropdownMenuItem className={rowMenuItemClass} onClick={() => actions.setLessonsStatus([lessonId], "draft")}>
                  <EyeOff aria-hidden="true" />
                  Despublicar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className={rowMenuItemClass} onClick={() => actions.setLessonsStatus([lessonId], "published")}>
                  <Eye aria-hidden="true" />
                  Publicar
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
              <DropdownMenuItem className={rowMenuDangerItemClass} onClick={() => actions.deleteLessons([lessonId])}>
                <Trash2 aria-hidden="true" />
                Excluir aula
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </span>
    </li>
  );
});
