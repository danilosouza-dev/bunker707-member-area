"use client";

import { createContext, useContext } from "react";
import type { LessonStatus } from "@/server/catalog/types";
import type { LessonInputPlan } from "./lesson-paste";

// Acoes da arvore para os modulos e linhas (ContentTab fornece). Todas sao estaveis (useCallback com
// dependencias estaveis): as linhas memorizadas so redesenham quando a propria aula muda.

export type ContentTreeActions = {
  canWrite: boolean;
  createLessons: (moduleId: string, plan: LessonInputPlan) => void;
  createModule: (title: string) => void;
  deleteLessons: (lessonIds: string[]) => void;
  deleteModule: (moduleId: string) => void;
  lessonHref: (lessonId: string) => string;
  moveLessonsTo: (lessonIds: string[]) => void;
  openLesson: (lessonId: string) => void;
  /** Painel "Capa do módulo" (menu do modulo › "Trocar capa do módulo…" ou a miniatura). */
  openModuleCover: (moduleId: string) => void;
  openModuleRelease: (moduleId: string) => void;
  renameModule: (moduleId: string, title: string) => void;
  setAddingLessonIn: (moduleId: string | null) => void;
  setLessonsStatus: (lessonIds: string[], status: LessonStatus) => void;
  stepLesson: (lessonId: string, direction: -1 | 1) => void;
  stepModule: (moduleId: string, direction: -1 | 1) => void;
  toggleSelection: (lessonId: string, selected: boolean) => void;
};

export const ContentTreeContext = createContext<ContentTreeActions | null>(null);

export function useContentTreeActions() {
  const actions = useContext(ContentTreeContext);

  if (!actions) {
    throw new Error("useContentTreeActions precisa de ContentTreeContext (ContentTab).");
  }

  return actions;
}
