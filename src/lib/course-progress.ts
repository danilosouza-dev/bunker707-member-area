// Progresso do aluno num produto a partir dos modulos (mesma conta do modal de detalhes): cada modulo
// vale o progresso gravado ou, sem ele, a fracao de aulas concluidas; o produto e a media dos modulos.
// Modulo puro: usado no modal (navegador) e no platform-store (servidor), para o card da home mostrar o
// mesmo numero que o modal.

type LessonLike = { completed?: boolean };
type ModuleLike = { lessons: LessonLike[]; progress: number };

export function clampProgress(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
}

export function getCompletedLessonsCount(module: ModuleLike) {
  return module.lessons.filter((lesson) => lesson.completed).length;
}

export function getModuleProgress(module: ModuleLike) {
  const savedModuleProgress = clampProgress(module.progress);
  const completedLessons = getCompletedLessonsCount(module);

  if (savedModuleProgress > 0 || module.lessons.length === 0 || completedLessons === 0) {
    return savedModuleProgress;
  }

  return clampProgress((completedLessons / module.lessons.length) * 100);
}

/** Media do progresso dos modulos; sem modulos, o valor gravado no produto. */
export function getCourseProgressFromModules(modules: ModuleLike[], fallbackProgress: number) {
  if (modules.length === 0) {
    return clampProgress(fallbackProgress);
  }

  const moduleProgressTotal = modules.reduce((total, module) => total + getModuleProgress(module), 0);

  return clampProgress(moduleProgressTotal / modules.length);
}
