// Reconhece o link de video colado pelo produtor (docs/17 §1.6.4, campo "Cole o link do video").
// Modulo puro e isomorfico: o VideoField usa no navegador para mostrar o chip na hora; a Server Action
// usa de novo no servidor (nunca confia no provedor escolhido pelo cliente).
//
// O resultado `config` segue exatamente o formato que o player do aluno ja le
// (getPlayerRenderConfig em src/components/lesson-experience.tsx):
// - youtube: assetId = id de 11 caracteres; url = link canonico de watch;
// - vimeo: assetId = id numerico; url = link original (o player monta player.vimeo.com/video/{id});
// - bunny e mux: o player usa `url` como iframe, entao gravamos o endereco de embed oficial;
// - custom_url: arquivo direto (.mp4, .webm, .mov, .m3u8) tocado pela tag <video>;
// - embed_code: so pelo caminho "Outro provedor", com o src HTTPS extraido do <iframe>.

import type { LessonVideoConfig, LessonVideoProvider } from "@/lib/platform-types";

export type VideoDetectionFailureReason = "empty" | "not_https" | "unknown_link" | "invalid_embed" | "too_long";

export type VideoDetection =
  | {
      config: LessonVideoConfig;
      label: string;
      notice: string;
      ok: true;
      provider: LessonVideoProvider;
      /** Tom do aviso no chip: "warning" quando ha logo/marca de terceiros ou acao manual. */
      tone: "neutral" | "warning";
    }
  | {
      message: string;
      ok: false;
      reason: VideoDetectionFailureReason;
    };

export const VIDEO_PROVIDER_LABELS: Record<LessonVideoProvider, string> = {
  bunny: "Bunny",
  custom_url: "Link direto",
  embed_code: "Código de incorporação",
  mux: "Mux",
  vimeo: "Vimeo",
  youtube: "YouTube"
};

export const VIDEO_PROVIDER_NOTICES: Record<LessonVideoProvider, string> = {
  bunny: "Bunny — vídeo protegido, sem logo de terceiros.",
  custom_url: "Link direto — o arquivo é tocado pelo navegador do aluno.",
  embed_code: "Código de incorporação — confira se o provedor permite exibir neste site.",
  mux: "Mux — vídeo protegido, sem logo de terceiros.",
  vimeo: "Vimeo — ative a restrição por domínio no Vimeo.",
  youtube: "YouTube — a logo e o título do YouTube aparecem no player."
};

const VIDEO_PROVIDER_TONES: Record<LessonVideoProvider, "neutral" | "warning"> = {
  bunny: "neutral",
  custom_url: "neutral",
  embed_code: "warning",
  mux: "neutral",
  vimeo: "warning",
  youtube: "warning"
};

const MAX_INPUT_LENGTH = 16_384;
const youtubeIdPattern = /^[A-Za-z0-9_-]{11}$/;
const directFilePattern = /\.(?:mp4|webm|mov|m3u8)$/i;

function success(provider: LessonVideoProvider, config: LessonVideoConfig): VideoDetection {
  return {
    config,
    label: VIDEO_PROVIDER_LABELS[provider],
    notice: VIDEO_PROVIDER_NOTICES[provider],
    ok: true,
    provider,
    tone: VIDEO_PROVIDER_TONES[provider]
  };
}

function failure(reason: VideoDetectionFailureReason): VideoDetection {
  const messages: Record<VideoDetectionFailureReason, string> = {
    empty: "Cole o link do vídeo.",
    invalid_embed: "Não encontramos um endereço https no código de incorporação.",
    not_https: "Use um link que comece com https://.",
    too_long: "O texto colado é longo demais para um link de vídeo.",
    unknown_link: "Não reconhecemos este link. Use YouTube, Vimeo, Bunny, Mux ou um arquivo .mp4."
  };

  return { message: messages[reason], ok: false, reason };
}

function hostMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function parseHttpsUrl(value: string): URL | "not_https" | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol === "http:") {
    return "not_https";
  }

  if (url.protocol !== "https:" || url.username || url.password) {
    return null;
  }

  return url;
}

function getYouTubeId(url: URL) {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    return segments[0] ?? "";
  }

  if (!hostMatches(host, "youtube.com") && !hostMatches(host, "youtube-nocookie.com")) {
    return null;
  }

  if (segments[0] === "watch") {
    return url.searchParams.get("v") ?? "";
  }

  if (["embed", "shorts", "live", "v"].includes(segments[0] ?? "")) {
    return segments[1] ?? "";
  }

  return "";
}

function detectFromUrl(url: URL): VideoDetection {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const youtubeId = getYouTubeId(url);

  if (youtubeId !== null) {
    return youtubeIdPattern.test(youtubeId)
      ? success("youtube", { assetId: youtubeId, provider: "youtube", url: `https://www.youtube.com/watch?v=${youtubeId}` })
      : failure("unknown_link");
  }

  if (hostMatches(host, "vimeo.com")) {
    const videoId = host === "player.vimeo.com"
      ? (segments[0] === "video" ? segments[1] : undefined)
      : segments.find((segment) => /^\d+$/.test(segment));

    return videoId && /^\d+$/.test(videoId)
      ? success("vimeo", { assetId: videoId, provider: "vimeo", url: url.toString() })
      : failure("unknown_link");
  }

  if (host === "iframe.mediadelivery.net" || host === "player.mediadelivery.net") {
    const [kind, libraryId, videoId] = segments;

    if ((kind === "embed" || kind === "play") && libraryId && /^\d+$/.test(libraryId) && videoId && /^[A-Za-z0-9-]{8,64}$/.test(videoId)) {
      return success("bunny", {
        assetId: videoId,
        provider: "bunny",
        url: `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}`
      });
    }

    return failure("unknown_link");
  }

  if (host === "stream.mux.com" || host === "player.mux.com") {
    const playbackId = (segments[0] ?? "").replace(/\.m3u8$/i, "");

    return /^[A-Za-z0-9]{10,128}$/.test(playbackId)
      ? success("mux", { assetId: playbackId, provider: "mux", url: `https://player.mux.com/${playbackId}` })
      : failure("unknown_link");
  }

  if (directFilePattern.test(url.pathname)) {
    return success("custom_url", { provider: "custom_url", url: url.toString() });
  }

  return failure("unknown_link");
}

function extractIframeSrc(value: string) {
  const iframeTag = value.match(/<iframe\b[^>]*>/i)?.[0];

  if (!iframeTag) {
    return null;
  }

  const sourceMatch = iframeTag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const source = sourceMatch?.[1] ?? sourceMatch?.[2] ?? sourceMatch?.[3] ?? "";

  return source.replaceAll("&amp;", "&").trim();
}

/**
 * Reconhece um link colado. `allowEmbedCode` libera o caminho "Outro provedor": um <iframe> de host
 * desconhecido vira `embed_code`. Sem ele, um <iframe> so e aceito se o src for de um provedor conhecido.
 */
export function detectLessonVideo(rawInput: string, options: { allowEmbedCode?: boolean } = {}): VideoDetection {
  const input = rawInput.trim();

  if (!input) {
    return failure("empty");
  }

  if (input.length > MAX_INPUT_LENGTH) {
    return failure("too_long");
  }

  if (/^<iframe\b/i.test(input)) {
    const source = extractIframeSrc(input);
    const url = source ? parseHttpsUrl(source) : null;

    if (!url || url === "not_https") {
      return failure("invalid_embed");
    }

    const known = detectFromUrl(url);

    if (known.ok) {
      return known;
    }

    return options.allowEmbedCode
      ? success("embed_code", { provider: "embed_code", url: url.toString() })
      : failure("unknown_link");
  }

  const url = parseHttpsUrl(input);

  if (url === "not_https") {
    return failure("not_https");
  }

  if (!url) {
    return failure("unknown_link");
  }

  const detected = detectFromUrl(url);

  if (!detected.ok && options.allowEmbedCode) {
    return success("embed_code", { provider: "embed_code", url: url.toString() });
  }

  return detected;
}

/** Texto parece um link de video (para "colar um link no nome cria a aula ja com o video"). */
export function looksLikeVideoLink(value: string) {
  const input = value.trim();

  return /^https?:\/\/\S+$/i.test(input) || /^<iframe\b/i.test(input);
}
