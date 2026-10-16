import type { CourseModule, LessonWatchState, LessonWatchStatus } from "@/lib/platform-types";

// Regras do progresso da aula, compartilhadas pelo servidor (platform-store) e pela pagina da aula
// (lesson-experience). Modulo puro: sem React, sem banco, testado em Node (tests/lesson-progress-rules).
//
// Regra (docs/02, pagina da aula): a lista de aulas concluidas (completed_lesson_ids) e a verdade.
// O status gravado por aula acompanha a lista: uma aula concluida nao volta a "em andamento" por
// batida de progresso (play, heartbeat de 15 s, pausa, troca de aula, saida da pagina), so a
// posicao assistida avanca. Ela deixa de ser concluida apenas quando o aluno desmarca, e ai o
// cliente manda a lista sem ela. "Continue assistindo" nunca lista aula concluida.

export type LessonWatchStates = Record<string, LessonWatchState>;

/** O que a tela mostrava antes de um clique otimista, para voltar se a gravacao falhar. */
export type LessonProgressSnapshot = {
  wasCompleted: boolean;
  watchState: LessonWatchState | undefined;
};

function clampPercent(value: number) {
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), 100) : 0;
}

function roundSeconds(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** Status gravado da aula: concluida quando o pedido diz "completed" ou quando ela esta na lista. */
export function resolveLessonWatchStatus(input: {
  isInCompletedList: boolean;
  requestedStatus: LessonWatchStatus | undefined;
}): LessonWatchStatus {
  return input.requestedStatus === "completed" || input.isInCompletedList ? "completed" : "in_progress";
}

/** "Continue assistindo": aula comecada, nao terminada e fora da lista de concluidas. */
export function isLessonResumable(
  lessonId: string,
  watchState: Pick<LessonWatchState, "progressPercent" | "status">,
  completedLessonIds: ReadonlySet<string>
) {
  return (
    !completedLessonIds.has(lessonId) &&
    watchState.status !== "completed" &&
    watchState.progressPercent > 0 &&
    watchState.progressPercent < 100
  );
}

/** Aulas concluidas segundo o servidor (`lesson.completed` vem de completed_lesson_ids). */
export function getCompletedLessonIdsFromModules(modules: ReadonlyArray<Pick<CourseModule, "lessons">>) {
  return modules.flatMap((courseModule) => (
    courseModule.lessons
      .filter((lesson) => lesson.completed)
      .map((lesson) => lesson.id)
  ));
}

/**
 * Props novas (router.refresh ou outra navegacao para a mesma tela): a lista local passa a ser a do
 * servidor, menos as aulas com gravacao em andamento, que mantem o que a tela mostra ate o PUT
 * responder. Devolve o mesmo Set quando nada muda, para nao re-renderizar a toa.
 */
export function reconcileCompletedLessonIds(
  current: Set<string>,
  serverCompletedLessonIds: Iterable<string>,
  pendingLessonIds: Iterable<string> = []
) {
  const next = new Set(serverCompletedLessonIds);

  for (const lessonId of pendingLessonIds) {
    if (current.has(lessonId)) {
      next.add(lessonId);
    } else {
      next.delete(lessonId);
    }
  }

  if (next.size === current.size && [...next].every((lessonId) => current.has(lessonId))) {
    return current;
  }

  return next;
}

/** Lista com ou sem a aula; a mesma referencia quando ja esta assim. */
export function withLessonCompletion(current: Set<string>, lessonId: string, completed: boolean) {
  if (current.has(lessonId) === completed) {
    return current;
  }

  const next = new Set(current);

  if (completed) {
    next.add(lessonId);
  } else {
    next.delete(lessonId);
  }

  return next;
}

/** Estados por aula com o da aula trocado (ou removido, com `undefined`); a mesma referencia se igual. */
export function withLessonWatchState(
  current: LessonWatchStates,
  lessonId: string,
  watchState: LessonWatchState | undefined
): LessonWatchStates {
  if (current[lessonId] === watchState) {
    return current;
  }

  if (watchState === undefined) {
    const next = { ...current };
    delete next[lessonId];
    return next;
  }

  return { ...current, [lessonId]: watchState };
}

/**
 * Proximo estado local de uma batida de progresso (play, heartbeat, pausa, fim do video, flush).
 * Aula na lista de concluidas continua "completed" com 100%: so a posicao (segundos) e a hora mudam.
 */
export function buildWatchProgressState(input: {
  durationSeconds?: number;
  existing: LessonWatchState | undefined;
  isInCompletedList: boolean;
  now: string;
  progressPercent: number;
  progressSeconds: number;
  status: LessonWatchStatus;
}): LessonWatchState {
  const status = resolveLessonWatchStatus({ isInCompletedList: input.isInCompletedList, requestedStatus: input.status });
  const progressSeconds = roundSeconds(input.progressSeconds);
  const requestedPercent = clampPercent(input.progressPercent);
  const progressPercent = status === "completed"
    ? 100
    : Math.min(progressSeconds > 0 ? Math.max(requestedPercent, 1) : requestedPercent, 99);
  const maxProgressPercent = status === "completed"
    ? 100
    : Math.max(input.existing?.maxProgressPercent ?? input.existing?.progressPercent ?? 0, progressPercent);
  const durationSeconds = input.durationSeconds !== undefined
    ? roundSeconds(input.durationSeconds)
    : input.existing?.durationSeconds;

  return {
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    lastWatchedAt: input.now,
    maxProgressPercent,
    progressPercent,
    progressSeconds,
    ...(input.existing?.resumeFrameUrl ? { resumeFrameUrl: input.existing.resumeFrameUrl } : {}),
    status
  };
}

/**
 * Clique em Concluir/Concluida. Concluir leva a aula a 100% no fim do video; desmarcar volta a
 * "em andamento" na posicao real (segundos assistidos sobre a duracao), nunca em 100%.
 */
export function buildCompletionToggle(input: {
  allLessonIds: ReadonlySet<string>;
  completedLessonIds: Set<string>;
  durationSeconds?: number;
  existing: LessonWatchState | undefined;
  lessonId: string;
  now: string;
}) {
  const willComplete = !input.completedLessonIds.has(input.lessonId);
  const completedLessonIds = withLessonCompletion(input.completedLessonIds, input.lessonId, willComplete);
  const payloadCompletedLessonIds = Array.from(completedLessonIds)
    .filter((lessonId) => input.allLessonIds.has(lessonId))
    .sort();
  const durationSeconds = input.durationSeconds ?? input.existing?.durationSeconds;
  const existingSeconds = input.existing?.progressSeconds ?? 0;
  let watchState: LessonWatchState;

  if (willComplete) {
    watchState = {
      ...(durationSeconds !== undefined ? { durationSeconds: roundSeconds(durationSeconds) } : {}),
      lastWatchedAt: input.now,
      maxProgressPercent: 100,
      progressPercent: 100,
      progressSeconds: roundSeconds(durationSeconds ?? existingSeconds),
      ...(input.existing?.resumeFrameUrl ? { resumeFrameUrl: input.existing.resumeFrameUrl } : {}),
      status: "completed"
    };
  } else {
    const percentFromSeconds = durationSeconds && durationSeconds > 0
      ? clampPercent((existingSeconds / durationSeconds) * 100)
      : undefined;
    const requestedPercent = percentFromSeconds ?? input.existing?.progressPercent ?? 0;
    const progressPercent = Math.min(existingSeconds > 0 ? Math.max(requestedPercent, 1) : requestedPercent, 99);

    watchState = {
      ...(durationSeconds !== undefined ? { durationSeconds: roundSeconds(durationSeconds) } : {}),
      lastWatchedAt: input.now,
      maxProgressPercent: Math.max(input.existing?.maxProgressPercent ?? 0, input.existing?.progressPercent ?? 0, progressPercent),
      progressPercent,
      progressSeconds: roundSeconds(existingSeconds),
      ...(input.existing?.resumeFrameUrl ? { resumeFrameUrl: input.existing.resumeFrameUrl } : {}),
      status: "in_progress"
    };
  }

  return { completedLessonIds, payloadCompletedLessonIds, watchState, willComplete };
}
