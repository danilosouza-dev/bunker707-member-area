import {
  isYouTubeUnofficialStreamsEnabled,
  youTubeUnofficialStreamsDisabledCode
} from "./feature-flags";

const requestTimeoutMs = 8_000;
const maxRequestTimeoutMs = 15_000;
const watchPageMaxBytes = 3 * 1024 * 1024;
const playerResponseMaxBytes = 3 * 1024 * 1024;
const maxAdaptiveFormats = 512;
const maxStreamUrlLength = 8_192;
const maxStreamQueryParameters = 96;
const maxStreamLifetimeSeconds = 24 * 60 * 60;
const minimumRemainingLifetimeSeconds = 30;

const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{11}$/;
const platformResourceIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;
const qualityLabelPattern = /^(\d{2,5})p(?:\d{1,3})?(?: HDR)?$/;
const mimeTypePattern = /^(video|audio)\/(mp4|webm)(?:;\s*codecs="([A-Za-z0-9., _-]{1,160})")?$/i;
const upstreamUserAgent =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const androidVrClientVersion = "1.65.10";
const androidVrUserAgent =
  "com.google.android.apps.youtube.vr.oculus/1.65.10 " +
  "(Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type RawAdaptiveFormat = {
  bitrate?: unknown;
  height?: unknown;
  itag?: unknown;
  mimeType?: unknown;
  qualityLabel?: unknown;
  url?: unknown;
  width?: unknown;
};

type ParsedMimeType = {
  codecs: string;
  container: "mp4" | "webm";
  kind: "audio" | "video";
  mimeType: string;
};

type ParsedStreamUrl = {
  expiresAtMilliseconds: number;
  url: string;
};

type VideoStreamCandidate = YouTubeVideoStream & {
  codecs: string;
  container: "mp4" | "webm";
  expiresAtMilliseconds: number;
};

type AudioStreamCandidate = YouTubeAudioStream & {
  container: "mp4" | "webm";
  expiresAtMilliseconds: number;
};

export type YouTubeVideoStream = {
  bitrate: number;
  height: number;
  itag: number;
  label: string;
  mimeType: string;
  url: string;
  width: number;
};

export type YouTubeAudioStream = {
  bitrate: number;
  itag: number;
  mimeType: string;
  url: string;
};

export type YouTubeStreamsResult = {
  audio: YouTubeAudioStream;
  expiresAt: string;
  qualities: YouTubeVideoStream[];
};

export class YouTubeStreamsError extends Error {
  code: string;
  status: number;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "YouTubeStreamsError";
    this.code = code;
    this.status = status;
  }
}

function upstreamError(message: string, code: string) {
  return new YouTubeStreamsError(message, 502, code);
}

function inputError(message: string, code: string) {
  return new YouTubeStreamsError(message, 400, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown, maximum: number) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= maximum
    ? value
    : null;
}

function parseMimeType(value: unknown): ParsedMimeType | null {
  if (typeof value !== "string" || value.length > 220) {
    return null;
  }

  const match = value.trim().match(mimeTypePattern);

  if (!match) {
    return null;
  }

  const kind = match[1].toLowerCase() as "audio" | "video";
  const container = match[2].toLowerCase() as "mp4" | "webm";
  const codecs = match[3]?.trim() ?? "";
  const mimeType = `${kind}/${container}${codecs ? `; codecs="${codecs}"` : ""}`;

  return { codecs, container, kind, mimeType };
}

function parseQualityLabel(value: unknown, height: number) {
  if (typeof value !== "string" || value.length > 32) {
    return null;
  }

  const label = value.replace(/\s+/g, " ").trim();
  const match = label.match(qualityLabelPattern);

  return match && Number.parseInt(match[1], 10) === height ? label : null;
}

function isAllowedGoogleVideoHostname(hostname: string) {
  return hostname === "googlevideo.com" || hostname.endsWith(".googlevideo.com");
}

export function validateGoogleVideoStreamUrl(
  value: string,
  nowMilliseconds = Date.now()
): ParsedStreamUrl {
  if (!value || value.length > maxStreamUrlLength) {
    throw upstreamError("A origem retornou uma URL de midia invalida.", "invalid_stream_url");
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw upstreamError("A origem retornou uma URL de midia invalida.", "invalid_stream_url");
  }

  if (
    url.protocol !== "https:" ||
    !isAllowedGoogleVideoHostname(url.hostname) ||
    url.port !== "" ||
    url.pathname !== "/videoplayback" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    Array.from(url.searchParams).length > maxStreamQueryParameters
  ) {
    throw upstreamError("A origem retornou uma URL de midia nao permitida.", "unsafe_stream_url");
  }

  const expirationValues = url.searchParams.getAll("expire");

  if (expirationValues.length !== 1 || !/^\d{10,11}$/.test(expirationValues[0])) {
    throw upstreamError("A origem retornou uma URL de midia sem validade segura.", "invalid_stream_expiration");
  }

  const expiresAtSeconds = Number.parseInt(expirationValues[0], 10);
  const nowSeconds = Math.floor(nowMilliseconds / 1_000);

  if (
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds < nowSeconds + minimumRemainingLifetimeSeconds ||
    expiresAtSeconds > nowSeconds + maxStreamLifetimeSeconds
  ) {
    throw upstreamError("A origem retornou uma URL de midia fora da validade permitida.", "unsafe_stream_expiration");
  }

  return {
    expiresAtMilliseconds: expiresAtSeconds * 1_000,
    url: url.toString()
  };
}

function videoPreference(candidate: VideoStreamCandidate) {
  const hasH264 = candidate.codecs
    .split(",")
    .some((codec) => /^(?:avc1|avc3)(?:\.|$)/i.test(codec.trim()));

  if (candidate.container === "mp4" && hasH264) {
    return 3;
  }

  return candidate.container === "mp4" ? 2 : 1;
}

function choosePreferredVideo(
  current: VideoStreamCandidate | undefined,
  candidate: VideoStreamCandidate
) {
  if (!current) {
    return candidate;
  }

  const currentPreference = videoPreference(current);
  const candidatePreference = videoPreference(candidate);

  if (candidatePreference !== currentPreference) {
    return candidatePreference > currentPreference ? candidate : current;
  }

  if (candidate.bitrate !== current.bitrate) {
    return candidate.bitrate > current.bitrate ? candidate : current;
  }

  return candidate.itag < current.itag ? candidate : current;
}

function choosePreferredAudio(
  current: AudioStreamCandidate | undefined,
  candidate: AudioStreamCandidate
) {
  if (!current || candidate.bitrate > current.bitrate) {
    return candidate;
  }

  if (candidate.bitrate < current.bitrate) {
    return current;
  }

  if (candidate.container !== current.container) {
    return candidate.container === "mp4" ? candidate : current;
  }

  return candidate.itag < current.itag ? candidate : current;
}

function getAdaptiveFormats(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.streamingData)) {
    return [];
  }

  const formats = payload.streamingData.adaptiveFormats;

  return Array.isArray(formats) ? formats.slice(0, maxAdaptiveFormats) : [];
}

export function parseYouTubePlayerStreams(
  payload: unknown,
  nowMilliseconds = Date.now()
): YouTubeStreamsResult {
  const videoByLabel = new Map<string, VideoStreamCandidate>();
  let audio: AudioStreamCandidate | undefined;

  for (const rawFormatValue of getAdaptiveFormats(payload)) {
    if (!isRecord(rawFormatValue)) {
      continue;
    }

    const rawFormat = rawFormatValue as RawAdaptiveFormat;
    const bitrate = parsePositiveInteger(rawFormat.bitrate, 1_000_000_000);
    const itag = parsePositiveInteger(rawFormat.itag, 1_000_000);
    const mime = parseMimeType(rawFormat.mimeType);
    const rawUrl = typeof rawFormat.url === "string" ? rawFormat.url : "";

    if (!bitrate || !itag || !mime || !rawUrl) {
      continue;
    }

    let streamUrl: ParsedStreamUrl;

    try {
      streamUrl = validateGoogleVideoStreamUrl(rawUrl, nowMilliseconds);
    } catch {
      continue;
    }

    if (mime.kind === "audio") {
      audio = choosePreferredAudio(audio, {
        bitrate,
        container: mime.container,
        expiresAtMilliseconds: streamUrl.expiresAtMilliseconds,
        itag,
        mimeType: mime.mimeType,
        url: streamUrl.url
      });
      continue;
    }

    const width = parsePositiveInteger(rawFormat.width, 16_384);
    const height = parsePositiveInteger(rawFormat.height, 16_384);

    if (!width || !height) {
      continue;
    }

    const label = parseQualityLabel(rawFormat.qualityLabel, height);

    if (!label) {
      continue;
    }

    const candidate: VideoStreamCandidate = {
      bitrate,
      codecs: mime.codecs,
      container: mime.container,
      expiresAtMilliseconds: streamUrl.expiresAtMilliseconds,
      height,
      itag,
      label,
      mimeType: mime.mimeType,
      url: streamUrl.url,
      width
    };
    videoByLabel.set(label, choosePreferredVideo(videoByLabel.get(label), candidate));
  }

  const selectedVideos = Array.from(videoByLabel.values()).sort((left, right) => (
    right.height - left.height ||
    right.bitrate - left.bitrate ||
    left.label.localeCompare(right.label)
  ));

  if (!audio || selectedVideos.length === 0) {
    throw upstreamError("A origem nao retornou faixas de audio e video utilizaveis.", "usable_streams_unavailable");
  }

  const expiresAtMilliseconds = Math.min(
    audio.expiresAtMilliseconds,
    ...selectedVideos.map((video) => video.expiresAtMilliseconds)
  );

  return {
    audio: {
      bitrate: audio.bitrate,
      itag: audio.itag,
      mimeType: audio.mimeType,
      url: audio.url
    },
    expiresAt: new Date(expiresAtMilliseconds).toISOString(),
    qualities: selectedVideos.map(({
      bitrate,
      height,
      itag,
      label,
      mimeType,
      url,
      width
    }) => ({ bitrate, height, itag, label, mimeType, url, width }))
  };
}

async function readLimitedResponseText(response: Response, maxBytes: number) {
  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : Number.NaN;

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw upstreamError("A resposta da origem excede o limite permitido.", "upstream_payload_too_large");
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    bytesRead += value.byteLength;

    if (bytesRead > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw upstreamError("A resposta da origem excede o limite permitido.", "upstream_payload_too_large");
    }

    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}

export function isValidYouTubeVideoId(value: string) {
  return youtubeVideoIdPattern.test(value);
}

export function isValidPlatformResourceId(value: string) {
  return platformResourceIdPattern.test(value);
}

export function extractYouTubePlayerConfig(watchPage: string) {
  const apiKey = watchPage.match(/"INNERTUBE_API_KEY"\s*:\s*"([A-Za-z0-9_-]{20,80})"/)?.[1] ?? null;
  const visitorData = watchPage.match(/"VISITOR_DATA"\s*:\s*"([^"\\]{10,2048})"/)?.[1] ?? null;

  return {
    apiKey,
    visitorData: visitorData && /^[A-Za-z0-9_%=-]+$/.test(visitorData) ? visitorData : null
  };
}

export async function fetchYouTubeStreams({
  fetchImpl = fetch,
  timeoutMs = requestTimeoutMs,
  videoId
}: {
  fetchImpl?: Fetcher;
  timeoutMs?: number;
  videoId: string;
}): Promise<YouTubeStreamsResult> {
  // Flag desligada: falha antes de qualquer chamada ao YouTube. As rotas ja checam a flag
  // antes; esta checagem protege qualquer outro chamador.
  if (!isYouTubeUnofficialStreamsEnabled()) {
    throw new YouTubeStreamsError(
      "A seleção manual de qualidade está desativada.",
      404,
      youTubeUnofficialStreamsDisabledCode
    );
  }

  if (!isValidYouTubeVideoId(videoId)) {
    throw inputError("Identificador de video invalido.", "invalid_video_id");
  }

  const boundedTimeoutMs = Number.isFinite(timeoutMs)
    ? Math.min(maxRequestTimeoutMs, Math.max(1, Math.floor(timeoutMs)))
    : requestTimeoutMs;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), boundedTimeoutMs);

  try {
    const watchUrl = new URL("https://www.youtube.com/watch");
    watchUrl.searchParams.set("v", videoId);
    watchUrl.searchParams.set("hl", "pt-BR");
    watchUrl.searchParams.set("bpctr", "9999999999");
    watchUrl.searchParams.set("has_verified", "1");
    const watchResponse = await fetchImpl(watchUrl, {
      cache: "no-store",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5",
        "User-Agent": upstreamUserAgent
      },
      redirect: "error",
      signal: controller.signal
    });

    if (!watchResponse.ok) {
      throw upstreamError("A origem nao disponibilizou a pagina do video.", "watch_page_unavailable");
    }

    const watchPage = await readLimitedResponseText(watchResponse, watchPageMaxBytes);
    const { apiKey, visitorData } = extractYouTubePlayerConfig(watchPage);

    if (!apiKey || !visitorData) {
      throw upstreamError("A origem nao retornou a configuracao publica necessaria.", "player_config_unavailable");
    }

    const playerUrl = new URL("https://www.youtube.com/youtubei/v1/player");
    playerUrl.searchParams.set("key", apiKey);
    const playerResponse = await fetchImpl(playerUrl, {
      body: JSON.stringify({
        contentCheckOk: true,
        context: {
          client: {
            androidSdkVersion: 32,
            clientName: "ANDROID_VR",
            clientVersion: androidVrClientVersion,
            deviceMake: "Oculus",
            deviceModel: "Quest 3",
            gl: "BR",
            hl: "pt-BR",
            osName: "Android",
            osVersion: "12L",
            userAgent: androidVrUserAgent,
            visitorData
          }
        },
        racyCheckOk: true,
        videoId
      }),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": androidVrUserAgent,
        "X-Goog-Visitor-Id": visitorData,
        "X-YouTube-Client-Name": "28",
        "X-YouTube-Client-Version": androidVrClientVersion
      },
      method: "POST",
      redirect: "error",
      signal: controller.signal
    });

    if (!playerResponse.ok) {
      throw upstreamError("A origem nao disponibilizou as faixas de midia.", "player_api_unavailable");
    }

    const playerResponseText = await readLimitedResponseText(playerResponse, playerResponseMaxBytes);
    let playerPayload: unknown;

    try {
      playerPayload = JSON.parse(playerResponseText) as unknown;
    } catch {
      throw upstreamError("A origem retornou uma configuracao de midia invalida.", "invalid_player_response");
    }

    return parseYouTubePlayerStreams(playerPayload);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new YouTubeStreamsError(
        "A origem demorou demais para responder.",
        504,
        "upstream_timeout"
      );
    }

    if (error instanceof YouTubeStreamsError) {
      throw error;
    }

    throw upstreamError("Nao foi possivel consultar as faixas de midia.", "upstream_request_failed");
  } finally {
    clearTimeout(timeout);
  }
}
