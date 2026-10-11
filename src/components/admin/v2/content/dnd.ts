// Dados de arrastar da aba Conteudo (@atlaskit/pragmatic-drag-and-drop + hitbox). Cada elemento
// arrastavel ou alvo de soltura carrega um objeto com `kind`; o monitor da aba traduz o alvo mais
// interno para LessonDropTarget/ModuleDropTarget (tree-model.ts) e grava a ordem.

import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge/extract-closest-edge";
import type { LessonDropTarget, ModuleDropTarget } from "./tree-model";

export type LessonDragData = { kind: "content-lesson"; lessonId: string; moduleId: string };
export type ModuleDragData = { kind: "content-module"; moduleId: string };
export type CourseDragData = { kind: "formation-course"; courseId: string };

/** Cabecalho do modulo: soltar uma aula ali poe a aula no comeco do modulo. */
export type ModuleStartDropData = { kind: "content-module-start"; moduleId: string };
/** Corpo do modulo fora de qualquer linha (modulo vazio, "+ Adicionar aula"): fim do modulo. */
export type ModuleZoneDropData = { kind: "content-module-zone"; moduleId: string };

type DragRecord = Record<string | symbol, unknown>;

export function isLessonDragData(data: DragRecord): data is DragRecord & LessonDragData {
  return data.kind === "content-lesson" && typeof data.lessonId === "string" && typeof data.moduleId === "string";
}

export function isModuleDragData(data: DragRecord): data is DragRecord & ModuleDragData {
  return data.kind === "content-module" && typeof data.moduleId === "string";
}

export function isCourseDragData(data: DragRecord): data is DragRecord & CourseDragData {
  return data.kind === "formation-course" && typeof data.courseId === "string";
}

/** Alvo mais interno -> onde a aula cai. */
export function toLessonDropTarget(data: DragRecord): LessonDropTarget | null {
  if (isLessonDragData(data)) {
    const edge = extractClosestEdge(data);

    return edge ? { kind: edge === "top" ? "before" : "after", lessonId: data.lessonId } : null;
  }

  if (data.kind === "content-module-start" && typeof data.moduleId === "string") {
    return { kind: "start", moduleId: data.moduleId };
  }

  if (data.kind === "content-module-zone" && typeof data.moduleId === "string") {
    return { kind: "end", moduleId: data.moduleId };
  }

  return null;
}

/** Alvo mais interno -> onde o modulo cai. */
export function toModuleDropTarget(data: DragRecord): ModuleDropTarget | null {
  if (!isModuleDragData(data)) {
    return null;
  }

  const edge = extractClosestEdge(data);

  return edge ? { kind: edge === "top" ? "before" : "after", moduleId: data.moduleId } : null;
}

/** Alvo -> onde o curso da formacao cai (antes/depois de outro curso). */
export function toCourseDropTarget(data: DragRecord): { id: string; kind: "before" | "after" } | null {
  if (!isCourseDragData(data)) {
    return null;
  }

  const edge = extractClosestEdge(data);

  return edge ? { id: data.courseId, kind: edge === "top" ? "before" : "after" } : null;
}

/** Foca a alca/nome de uma linha depois que ela mudou de lugar (a linha pode ter remontado). */
export function focusTreeItem(selector: string) {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(selector)?.focus({ preventScroll: false });
  });
}

export function lessonFocusSelector(lessonId: string) {
  return `[data-lesson-focus="${CSS.escape(lessonId)}"]`;
}

export function moduleFocusSelector(moduleId: string) {
  return `[data-module-focus="${CSS.escape(moduleId)}"]`;
}

export function courseFocusSelector(courseId: string) {
  return `[data-course-focus="${CSS.escape(courseId)}"]`;
}
