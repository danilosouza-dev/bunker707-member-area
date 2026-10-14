import type { HeroVideoOptions } from "./platform-types";

// Video de destaque do produto (topo do modal da home e banner da pagina do curso): arquivo direto
// (.mp4/.webm/.mov) ou YouTube. Modulo puro, usado pelo servidor, pelo admin e pelo componente do aluno.

export type HeroVideoSource =
  | { kind: "file"; src: string }
  | { kind: "youtube"; id: string };

/** Padroes quando o produtor nunca mexeu nas opcoes: toca sozinho, sem som, em repeticao, com botao de som. */
export const HERO_VIDEO_OPTION_DEFAULTS: Required<HeroVideoOptions> = {
  autoplay: true,
  hideBranding: true,
  loop: true,
  nativeControls: false,
  pauseButton: false,
  soundButton: true,
  startWithSound: false,
  timeline: false,
  volumeSlider: false
};

function flag(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

/** Opcoes gravadas (parciais, ou lixo de versoes antigas) -> objeto completo com os padroes. */
export function normalizeHeroVideoOptions(raw: unknown): Required<HeroVideoOptions> {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};

  return {
    autoplay: flag(source.autoplay, HERO_VIDEO_OPTION_DEFAULTS.autoplay),
    hideBranding: flag(source.hideBranding, HERO_VIDEO_OPTION_DEFAULTS.hideBranding),
    loop: flag(source.loop, HERO_VIDEO_OPTION_DEFAULTS.loop),
    nativeControls: flag(source.nativeControls, HERO_VIDEO_OPTION_DEFAULTS.nativeControls),
    pauseButton: flag(source.pauseButton, HERO_VIDEO_OPTION_DEFAULTS.pauseButton),
    soundButton: flag(source.soundButton, HERO_VIDEO_OPTION_DEFAULTS.soundButton),
    startWithSound: flag(source.startWithSound, HERO_VIDEO_OPTION_DEFAULTS.startWithSound),
    timeline: flag(source.timeline, HERO_VIDEO_OPTION_DEFAULTS.timeline),
    volumeSlider: flag(source.volumeSlider, HERO_VIDEO_OPTION_DEFAULTS.volumeSlider)
  };
}

/** De onde vem o video: id do YouTube quando gravado, senao o link direto do arquivo. */
export function heroVideoSourceOf(media: { mediaSrc: string; youtubeId?: string }): HeroVideoSource {
  return media.youtubeId ? { id: media.youtubeId, kind: "youtube" } : { kind: "file", src: media.mediaSrc };
}

/** Miniatura que o YouTube publica para todo video (hq = 480x360 sempre existe; maxres so em alguns). */
export function youtubeThumbnailUrl(id: string, quality: "hq" | "maxres" = "hq") {
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${quality === "maxres" ? "maxresdefault" : "hqdefault"}.jpg`;
}

/** Capa do video: a imagem de destaque, ou a miniatura do YouTube, ou a reserva (capa do card). */
export function heroVideoPosterOf(media: { poster?: string; youtubeId?: string }, fallback?: string | null) {
  if (media.poster) {
    return media.poster;
  }

  if (media.youtubeId) {
    return youtubeThumbnailUrl(media.youtubeId);
  }

  return fallback ?? null;
}
