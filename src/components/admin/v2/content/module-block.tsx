"use client";

import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/attach-closest-edge";
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/types";
import { ArrowDown, ArrowUp, GripVertical, ImageIcon, LockOpen, MoreHorizontal, Timer, Trash2 } from "lucide-react";
import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { adminCard, adminTransition } from "../styles";
import { pluralize, rowIconButtonClass, rowMenuContentClass, rowMenuDangerItemClass, rowMenuItemClass } from "./content-ui";
import { isLessonDragData, isModuleDragData } from "./dnd";
import { AddLessonButton, AddLessonInput } from "./inline-creators";
import { DropLine, LessonRow } from "./lesson-row";
import { useContentTreeActions } from "./tree-context";
import type { TreeModule } from "./tree-model";

// Bloco de um modulo (docs/17 §1.6.3): cabecalho com alca, miniatura da capa (9:13, abre o painel da
// capa), "Módulo N ·" + nome editavel no lugar, frase de liberacao, contagem e menu; depois as aulas e
// "+ Adicionar aula". O bloco inteiro e alvo de soltura: modulo arrastado cai antes/depois dele; aula
// solta fora de uma linha vai para o fim.

type ModuleBlockProps = {
  activeLessonId: string | null;
  addingLesson: boolean;
  firstLessonId: string | null;
  isFirst: boolean;
  isLast: boolean;
  lastLessonId: string | null;
  module: TreeModule;
  selection: ReadonlySet<string>;
  selectionActive: boolean;
};

function coverStyle(url: string) {
  return { backgroundImage: `url("${url.replace(/["\\\n\r]/g, (character) => encodeURIComponent(character))}")` };
}

/** Miniatura 9:13 (24 × 35 px) da capa do card do modulo; com permissao, abre o painel da capa. */
function ModuleCoverThumb({ canEdit, module }: { canEdit: boolean; module: TreeModule }) {
  const actions = useContentTreeActions();
  const box = cn(
    "relative grid h-[35px] w-6 shrink-0 place-items-center overflow-hidden rounded-[4px] border border-[var(--border-subtle)] bg-[var(--surface-2)] bg-cover bg-center",
    !module.coverUrl && "text-[var(--text-tertiary)]"
  );
  const content = module.coverUrl ? null : <ImageIcon aria-hidden="true" className="size-3" />;
  const style = module.coverUrl ? coverStyle(module.coverUrl) : undefined;

  if (!canEdit) {
    return (
      <span aria-hidden="true" className={box} style={style}>
        {content}
      </span>
    );
  }

  return (
    <button
      aria-label={`Trocar a capa do módulo ${module.position}`}
      className={cn(
        box,
        "hover:border-[var(--text-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]",
        adminTransition
      )}
      onClick={() => actions.openModuleCover(module.id)}
      style={style}
      title="Trocar a capa do módulo"
      type="button"
    >
      {content}
    </button>
  );
}

function ModuleTitle({ module }: { module: TreeModule }) {
  const actions = useContentTreeActions();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(module.title);
  const canEdit = actions.canWrite && !module.pending;

  function commit() {
    const title = value.trim().slice(0, 120);
    setEditing(false);

    if (title && title !== module.title) {
      actions.renameModule(module.id, title);
    } else {
      setValue(module.title);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setValue(module.title);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        aria-label={`Nome do módulo ${module.position}`}
        autoFocus
        className="h-8 w-full max-w-[360px] min-w-0 rounded-md border border-[var(--text-secondary)] bg-[var(--surface-2)] px-2 text-sm font-semibold text-[var(--text-primary)] outline-none"
        maxLength={120}
        onBlur={commit}
        onChange={(event) => setValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={handleKeyDown}
        value={value}
      />
    );
  }

  if (!canEdit) {
    return <span className="min-w-0 truncate px-1.5 text-sm font-semibold text-[var(--text-primary)]">{module.title}</span>;
  }

  return (
    <button
      className={cn(
        "min-w-0 truncate rounded-md px-1.5 py-0.5 text-left text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-overlay)]",
        adminTransition
      )}
      onClick={() => {
        setValue(module.title);
        setEditing(true);
      }}
      title="Renomear módulo"
      type="button"
    >
      {module.title}
    </button>
  );
}

export const ModuleBlock = memo(function ModuleBlock({
  activeLessonId,
  addingLesson,
  firstLessonId,
  isFirst,
  isLast,
  lastLessonId,
  module,
  selection,
  selectionActive
}: ModuleBlockProps) {
  const actions = useContentTreeActions();
  const sectionRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  const [moduleEdge, setModuleEdge] = useState<Edge | null>(null);
  const [zoneActive, setZoneActive] = useState(false);
  const [startActive, setStartActive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const canEdit = actions.canWrite && !module.pending;
  const moduleId = module.id;
  // Referencia estavel do modulo para o campo "+ Adicionar aula": a chave provisoria de quando foi
  // criado (o id definitivo pode chegar enquanto o produtor digita).
  const moduleRef = module.clientKey ?? module.id;

  useEffect(() => {
    const section = sectionRef.current;
    const header = headerRef.current;
    const grip = gripRef.current;

    if (!section || !header || !grip || !canEdit) {
      return;
    }

    return combine(
      draggable({
        dragHandle: grip,
        element: section,
        getInitialData: () => ({ kind: "content-module", moduleId }),
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false)
      }),
      dropTargetForElements({
        canDrop: ({ source }) =>
          (isModuleDragData(source.data) && source.data.moduleId !== moduleId) || isLessonDragData(source.data),
        element: section,
        getData: ({ element, input, source }) =>
          isModuleDragData(source.data)
            ? attachClosestEdge({ kind: "content-module", moduleId }, { allowedEdges: ["top", "bottom"], element, input })
            : { kind: "content-module-zone", moduleId },
        getIsSticky: () => true,
        onDrag: ({ location, self, source }) => {
          if (isModuleDragData(source.data)) {
            setModuleEdge(extractClosestEdge(self.data));
          } else {
            setZoneActive(location.current.dropTargets[0]?.element === section);
          }
        },
        onDragLeave: () => {
          setModuleEdge(null);
          setZoneActive(false);
        },
        onDrop: () => {
          setModuleEdge(null);
          setZoneActive(false);
        }
      }),
      dropTargetForElements({
        canDrop: ({ source }) => isLessonDragData(source.data),
        element: header,
        getData: () => ({ kind: "content-module-start", moduleId }),
        onDragEnter: () => setStartActive(true),
        onDragLeave: () => setStartActive(false),
        onDrop: () => setStartActive(false)
      })
    );
  }, [canEdit, moduleId]);

  function handleGripKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) {
      return;
    }

    event.preventDefault();
    actions.stepModule(moduleId, event.key === "ArrowUp" ? -1 : 1);
  }

  const lessonCount = module.lessons.length;
  const hasPendingLessons = module.lessons.some((lesson) => lesson.pending);

  return (
    <section
      aria-busy={module.pending || undefined}
      aria-label={`Módulo ${module.position}: ${module.title}`}
      className={cn(adminCard, "relative min-w-0", dragging && "opacity-40")}
      data-module-block={moduleId}
      ref={sectionRef}
    >
      {moduleEdge ? <DropLine edge={moduleEdge} inset="inset-x-0 [&]:-my-[7px]" /> : null}

      <div
        className={cn(
          "relative flex min-h-[52px] flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--border-subtle)] py-1.5 pr-1 pl-2 md:flex-nowrap md:pr-2",
          startActive && "shadow-[inset_0_-2px_0_var(--text-primary)]"
        )}
        ref={headerRef}
      >
        <button
          aria-keyshortcuts={canEdit ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          aria-label={`Mover o módulo ${module.position}. Arraste ou use Alt e as setas.`}
          className={cn(
            "hidden h-7 w-5 shrink-0 place-items-center rounded text-[var(--text-tertiary)] md:grid",
            canEdit ? "cursor-grab hover:text-[var(--text-primary)] active:cursor-grabbing" : "invisible"
          )}
          data-module-focus={moduleId}
          disabled={!canEdit}
          onKeyDown={handleGripKeyDown}
          ref={gripRef}
          type="button"
        >
          <GripVertical aria-hidden="true" className="size-3.5" />
        </button>

        <div className="flex min-w-0 flex-1 basis-48 items-center gap-0.5">
          <span className="shrink-0 pl-1 md:pl-0">
            <ModuleCoverThumb canEdit={canEdit} module={module} />
          </span>
          <span className="shrink-0 pl-2 text-sm font-medium whitespace-nowrap text-[var(--text-secondary)]">
            Módulo {module.position} ·
          </span>
          <ModuleTitle key={`${moduleId}:${module.title}`} module={module} />
        </div>

        <div className="flex w-full min-w-0 items-center justify-between gap-1 pl-1 md:ml-auto md:w-auto md:shrink-0 md:justify-end md:gap-2 md:pl-0">
          {canEdit ? (
            <button
              className={cn(
                "inline-flex h-9 max-w-[240px] min-w-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-[var(--text-secondary)] md:h-7",
                "hover:bg-[var(--hover-overlay)] hover:text-[var(--text-primary)]",
                adminTransition
              )}
              onClick={() => actions.openModuleRelease(moduleId)}
              title="Mudar a liberação do módulo"
              type="button"
            >
              {module.release.mode === "immediate" ? (
                <LockOpen aria-hidden="true" className="size-3.5 shrink-0" />
              ) : (
                <Timer aria-hidden="true" className="size-3.5 shrink-0" />
              )}
              <span className="truncate">{module.releaseLabel}</span>
            </button>
          ) : (
            <span className="max-w-[240px] truncate px-2 text-[13px] text-[var(--text-secondary)]">{module.releaseLabel}</span>
          )}
          <span className="hidden text-[13px] whitespace-nowrap text-[var(--text-tertiary)] tabular-nums sm:inline">
            {pluralize(lessonCount, "aula", "aulas")}
          </span>
          {canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger aria-label={`Ações do módulo ${module.position}`} className={rowIconButtonClass}>
                <MoreHorizontal aria-hidden="true" className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={rowMenuContentClass}>
                <DropdownMenuItem className={rowMenuItemClass} onClick={() => actions.openModuleRelease(moduleId)}>
                  <Timer aria-hidden="true" />
                  Liberação…
                </DropdownMenuItem>
                <DropdownMenuItem className={rowMenuItemClass} onClick={() => actions.openModuleCover(moduleId)}>
                  <ImageIcon aria-hidden="true" />
                  Trocar capa do módulo…
                </DropdownMenuItem>
                <DropdownMenuItem className={rowMenuItemClass} disabled={isFirst} onClick={() => actions.stepModule(moduleId, -1)}>
                  <ArrowUp aria-hidden="true" />
                  Subir módulo
                </DropdownMenuItem>
                <DropdownMenuItem className={rowMenuItemClass} disabled={isLast} onClick={() => actions.stepModule(moduleId, 1)}>
                  <ArrowDown aria-hidden="true" />
                  Descer módulo
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-[var(--border-subtle)]" />
                <DropdownMenuItem
                  className={rowMenuDangerItemClass}
                  disabled={hasPendingLessons}
                  onClick={() => actions.deleteModule(moduleId)}
                >
                  <Trash2 aria-hidden="true" />
                  Excluir módulo
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {lessonCount > 0 ? (
        <ol aria-label={`Aulas do módulo ${module.position}`} className="flex flex-col">
          {module.lessons.map((lesson) => (
            <LessonRow
              active={activeLessonId === lesson.id}
              isFirstInTree={lesson.id === firstLessonId}
              isLastInTree={lesson.id === lastLessonId}
              key={lesson.clientKey ?? lesson.id}
              lesson={lesson}
              moduleId={moduleId}
              selected={selection.has(lesson.id)}
              selectionActive={selectionActive}
            />
          ))}
        </ol>
      ) : (
        <p className="border-b border-[var(--border-subtle)] px-4 py-3 text-[13px] text-[var(--text-tertiary)] md:pl-9">
          Nenhuma aula neste módulo ainda.
        </p>
      )}

      {actions.canWrite ? (
        <div
          className={cn(
            "relative px-2 py-1.5 md:pl-7",
            zoneActive && "shadow-[inset_0_2px_0_var(--text-primary)]"
          )}
        >
          {addingLesson ? (
            <AddLessonInput moduleId={moduleRef} moduleTitle={module.title} />
          ) : (
            <AddLessonButton onClick={() => actions.setAddingLessonIn(moduleRef)} />
          )}
        </div>
      ) : null}
    </section>
  );
});
