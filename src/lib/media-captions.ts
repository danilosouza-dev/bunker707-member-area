export type TimedCaptionCue = {
  durationSeconds: number;
  startSeconds: number;
};

export function findActiveCaptionCue<T extends TimedCaptionCue>(
  cues: T[],
  currentTimeSeconds: number,
  toleranceSeconds = 0.05
) {
  if (!Number.isFinite(currentTimeSeconds) || cues.length === 0) return null;

  let lowerBound = 0;
  let upperBound = cues.length - 1;
  let activeCueIndex = -1;

  while (lowerBound <= upperBound) {
    const middle = Math.floor((lowerBound + upperBound) / 2);

    if (cues[middle].startSeconds <= currentTimeSeconds + toleranceSeconds) {
      activeCueIndex = middle;
      lowerBound = middle + 1;
    } else {
      upperBound = middle - 1;
    }
  }

  if (activeCueIndex < 0) return null;

  const cue = cues[activeCueIndex];
  const cueEnd = cue.startSeconds + Math.max(cue.durationSeconds, 0.25);
  return currentTimeSeconds <= cueEnd + toleranceSeconds ? cue : null;
}
