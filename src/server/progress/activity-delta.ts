// Quanto de estudo real um progresso novo representa (docs/17 §1.11). Modulo puro, testado em Node.
//
// O player grava a cada 15 s; a TV, a cada 2 s. Contamos so o avanco do tempo de video entre duas
// gravacoes confirmadas, com dois tetos: 30 s por gravacao (um salto maior e "pulou no video", vale
// zero) e o dobro do tempo de relogio desde a gravacao anterior (um cliente que grava +20 s a cada
// 200 ms nao soma horas). Rever um trecho (voltar) nao conta. Primeira gravacao da aula vale ate 15 s.

export const ACTIVITY_MAX_SECONDS_PER_WRITE = 30;
export const ACTIVITY_FIRST_WRITE_SECONDS = 15;
export const ACTIVITY_MAX_COMPLETED_PER_WRITE = 50;

export type ActivityDeltaInput = {
  nextCompletedLessonIds: readonly string[];
  nextProgressSeconds: number;
  now: number;
  previousCompletedLessonIds: readonly string[];
  /** ISO da gravacao anterior desta aula; null na primeira. */
  previousLastWatchedAt: string | null;
  /** null quando a aula nunca tinha sido gravada. */
  previousProgressSeconds: number | null;
};

export type ActivityDelta = { completed: number; seconds: number };

export function activityDeltaOf(input: ActivityDeltaInput): ActivityDelta {
  const previousSet = new Set(input.previousCompletedLessonIds);
  const completed = Math.min(
    ACTIVITY_MAX_COMPLETED_PER_WRITE,
    input.nextCompletedLessonIds.filter((lessonId, index, all) => !previousSet.has(lessonId) && all.indexOf(lessonId) === index).length
  );

  const previous = input.previousProgressSeconds;
  const raw = Math.floor(input.nextProgressSeconds - (previous ?? 0));

  if (!Number.isFinite(raw) || raw <= 0 || raw > ACTIVITY_MAX_SECONDS_PER_WRITE) {
    return { completed, seconds: 0 };
  }

  if (previous === null || !input.previousLastWatchedAt) {
    return { completed, seconds: Math.min(raw, ACTIVITY_FIRST_WRITE_SECONDS) };
  }

  const previousAt = Date.parse(input.previousLastWatchedAt);
  const wallSeconds = Number.isNaN(previousAt) ? ACTIVITY_FIRST_WRITE_SECONDS : Math.max(0, (input.now - previousAt) / 1000);

  return { completed, seconds: Math.max(0, Math.floor(Math.min(raw, 2 * wallSeconds))) };
}

/** Ha algo a gravar? Evita uma ida ao banco por heartbeat parado. */
export function hasActivity(delta: ActivityDelta) {
  return delta.seconds > 0 || delta.completed > 0;
}
