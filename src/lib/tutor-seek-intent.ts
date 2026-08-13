export type PendingTutorSeek = {
  lessonId: string;
  seconds: number;
};

type PendingTutorSeekStore = {
  current: PendingTutorSeek | null;
};

export function queuePendingTutorSeek(
  store: PendingTutorSeekStore,
  lessonId: string,
  seconds: number
) {
  const normalizedLessonId = lessonId.trim();

  if (!normalizedLessonId || !Number.isFinite(seconds)) return null;
  const intent = {
    lessonId: normalizedLessonId,
    seconds: Math.max(0, seconds)
  } satisfies PendingTutorSeek;

  store.current = intent;
  return intent;
}

export function consumePendingTutorSeek(
  store: PendingTutorSeekStore,
  lessonId: string,
  applySeek: (seconds: number) => void
) {
  const intent = store.current;

  if (!intent || intent.lessonId !== lessonId) return null;
  applySeek(intent.seconds);

  if (store.current === intent) {
    store.current = null;
  }

  return intent.seconds;
}
