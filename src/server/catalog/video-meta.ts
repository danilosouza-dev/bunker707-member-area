// Titulo, miniatura e duracao sugeridos pelo provedor do video (docs/17 §1.6.4: "Título, miniatura e
// duração são preenchidos automaticamente"). Usa so os oEmbed oficiais e publicos do YouTube e do
// Vimeo, com tempo maximo de 3 s e resposta limitada; qualquer falha devolve nulls, nunca erro.
// Isomorfico e sem "server-only" para tests/catalog-server.test.mjs testar o parser sem rede; so as
// Server Actions de ./content-actions.ts chamam a busca.

import type { LessonVideoConfig } from "@/lib/platform-types";
import { formatClockDuration } from "./mappers";

export type VideoMetadata = {
  durationLabel: string | null;
  durationSeconds: number | null;
  suggestedTitle: string | null;
  thumbnailUrl: string | null;
};

export const EMPTY_VIDEO_METADATA: VideoMetadata = {
  durationLabel: null,
  durationSeconds: null,
  suggestedTitle: null,
  thumbnailUrl: null
};

const OEMBED_TIMEOUT_MS = 3_000;
const OEMBED_MAX_BYTES = 64 * 1024;

/** Endereco do oEmbed oficial para o video; null para provedores sem oEmbed publico. */
export function oEmbedUrlFor(config: LessonVideoConfig | null | undefined) {
  if (!config) {
    return null;
  }

  if (config.provider === "youtube") {
    const id = config.assetId && /^[A-Za-z0-9_-]{11}$/.test(config.assetId) ? config.assetId : null;
    const watchUrl = id ? `https://www.youtube.com/watch?v=${id}` : config.url;

    return watchUrl ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl)}` : null;
  }

  if (config.provider === "vimeo") {
    const videoUrl = config.url ?? (config.assetId ? `https://vimeo.com/${config.assetId}` : null);

    return videoUrl ? `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(videoUrl)}` : null;
  }

  return null;
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2_048) {
    return null;
  }

  try {
    const url = new URL(value);

    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Resposta oEmbed -> sugestoes. Campos ausentes, de tipo errado ou fora do https viram null. */
export function parseOEmbedPayload(payload: unknown): VideoMetadata {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return EMPTY_VIDEO_METADATA;
  }

  const record = payload as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  const duration = typeof record.duration === "number" && Number.isFinite(record.duration) && record.duration > 0
    ? Math.round(record.duration)
    : null;

  return {
    durationLabel: formatClockDuration(duration),
    durationSeconds: duration,
    suggestedTitle: title || null,
    thumbnailUrl: safeHttpsUrl(record.thumbnail_url)
  };
}

async function readBoundedText(response: Response) {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done || !value) {
      break;
    }

    received += value.byteLength;

    if (received > OEMBED_MAX_BYTES) {
      await reader.cancel();
      throw new Error("oEmbed response too large");
    }

    chunks.push(value);
  }

  const merged = new Uint8Array(received);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

/** Busca as sugestoes do provedor; sem oEmbed, erro de rede, tempo esgotado ou resposta ruim = nulls. */
export async function fetchVideoMetadata(
  config: LessonVideoConfig | null | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<VideoMetadata> {
  const endpoint = oEmbedUrlFor(config);

  if (!endpoint) {
    return EMPTY_VIDEO_METADATA;
  }

  try {
    const response = await fetchImpl(endpoint, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(OEMBED_TIMEOUT_MS)
    });

    if (!response.ok) {
      return EMPTY_VIDEO_METADATA;
    }

    return parseOEmbedPayload(JSON.parse(await readBoundedText(response)));
  } catch {
    return EMPTY_VIDEO_METADATA;
  }
}

/** Busca varias de uma vez com no maximo `concurrency` pedidos simultaneos (colar varias aulas). */
export async function fetchVideoMetadataBatch(
  configs: readonly (LessonVideoConfig | null)[],
  concurrency = 6,
  fetchImpl: typeof fetch = fetch
): Promise<VideoMetadata[]> {
  const results: VideoMetadata[] = configs.map(() => EMPTY_VIDEO_METADATA);
  let cursor = 0;

  async function worker() {
    while (cursor < configs.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fetchVideoMetadata(configs[index], fetchImpl);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, configs.length) }, () => worker()));

  return results;
}
