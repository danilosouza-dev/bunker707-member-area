export const TV_PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export function isTvPlaybackRate(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    TV_PLAYBACK_RATES.some((playbackRate) => playbackRate === value);
}

export function normalizeTvPlaybackRates(values: unknown) {
  if (!Array.isArray(values)) return [1];

  const playbackRates = [...new Set(values
    .map((value) => typeof value === "number" ? value : Number(value))
    .filter(isTvPlaybackRate))]
    .sort((left, right) => left - right);

  return playbackRates.length > 0 ? playbackRates : [1];
}

export type TvCommand =
  | { type: "pause" }
  | { type: "play" }
  | { playbackRate: number; type: "set_playback_rate" }
  | { seconds: -10 | 10; type: "seek_relative" }
  | {
      captionsEnabled: boolean;
      currentTimeSeconds: number;
      muted: boolean;
      playbackRate: number;
      quality: string;
      shouldPlay: boolean;
      type: "sync_player";
      volume: number;
    };
