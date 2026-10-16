import "server-only";

import {
  buildYouTubeCourseImportPreview,
  extractYouTubePlaylistId,
  type YouTubeCourseImportCommitInput,
  type YouTubeCourseImportModuleRange,
  type YouTubeCourseOrganizationMode,
  type YouTubePlaylistSourceItem
} from "@/lib/youtube-course-import";
import { persistImageAsset } from "@/server/db/media-assets";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

const maximumPlaylistItems = 500;
const maximumResponseBytes = 8 * 1024 * 1024;
const youtubeRequestTimeoutMs = 15_000;
const maximumContinuationRequests = 20;

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function textFromRuns(value: unknown) {
  const record = asRecord(value);

  if (!record) {
    return "";
  }

  if (typeof record.simpleText === "string") {
    return record.simpleText;
  }

  if (!Array.isArray(record.runs)) {
    return "";
  }

  return record.runs.map((run) => asRecord(run)?.text).filter((text): text is string => typeof text === "string").join("");
}

function parseClockDuration(value: string) {
  const parts = value.split(":").map((part) => Number.parseInt(part, 10));

  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    return undefined;
  }

  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseIsoDuration(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(value);

  if (!match) {
    return undefined;
  }

  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function bestThumbnail(value: unknown) {
  const record = asRecord(value);
  const thumbnails = Array.isArray(record?.thumbnails) ? record.thumbnails : [];

  return thumbnails
    .map((thumbnail) => asRecord(thumbnail)?.url)
    .filter((url): url is string => typeof url === "string" && url.startsWith("https://"))
    .at(-1);
}

function visitRecords(value: unknown, visitor: (record: JsonRecord) => void) {
  if (Array.isArray(value)) {
    value.forEach((item) => visitRecords(item, visitor));
    return;
  }

  const record = asRecord(value);

  if (!record) {
    return;
  }

  visitor(record);
  Object.values(record).forEach((item) => visitRecords(item, visitor));
}

function collectPublicPlaylistPage(value: unknown, startPosition: number) {
  const items: YouTubePlaylistSourceItem[] = [];
  const continuationTokens: string[] = [];
  let playlistDescription = "";
  let playlistTitle = "";

  visitRecords(value, (record) => {
    const metadata = asRecord(record.playlistMetadataRenderer);

    if (metadata) {
      playlistTitle ||= typeof metadata.title === "string" ? metadata.title : "";
      playlistDescription ||= typeof metadata.description === "string" ? metadata.description : "";
    }

    const renderer = asRecord(record.playlistVideoRenderer);

    if (renderer) {
      const videoId = typeof renderer.videoId === "string" ? renderer.videoId : "";
      const title = textFromRuns(renderer.title);

      if (/^[A-Za-z0-9_-]{11}$/.test(videoId) && title) {
        const positionText = textFromRuns(renderer.index);
        const position = Number.parseInt(positionText, 10);
        items.push({
          durationSeconds: typeof renderer.lengthSeconds === "string"
            ? Number.parseInt(renderer.lengthSeconds, 10)
            : parseClockDuration(textFromRuns(renderer.lengthText)),
          position: Number.isInteger(position) && position > 0 ? position : startPosition + items.length,
          thumbnailUrl: bestThumbnail(renderer.thumbnail),
          title,
          videoId
        });
      }
    }

    const continuation = asRecord(record.continuationCommand);

    if (typeof continuation?.token === "string") {
      continuationTokens.push(continuation.token);
    }
  });

  return { continuationTokens, items, playlistDescription, playlistTitle };
}

function extractAssignedJson(source: string, markers: string[]) {
  for (const marker of markers) {
    const markerIndex = source.indexOf(marker);

    if (markerIndex < 0) {
      continue;
    }

    const start = source.indexOf("{", markerIndex + marker.length);

    if (start < 0) {
      continue;
    }

    let depth = 0;
    let escaped = false;
    let inString = false;

    for (let index = start; index < source.length; index += 1) {
      const character = source[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;

        if (depth === 0) {
          return JSON.parse(source.slice(start, index + 1)) as unknown;
        }
      }
    }
  }

  throw new Error("A playlist publica nao retornou metadados que possam ser importados.");
}

async function fetchBoundedText(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(youtubeRequestTimeoutMs)
  });

  if (!response.ok) {
    throw new Error("Nao foi possivel consultar a playlist no YouTube.");
  }

  const declaredLength = Number(response.headers.get("content-length") ?? 0);

  if (declaredLength > maximumResponseBytes) {
    throw new Error("A resposta da playlist excedeu o limite seguro de leitura.");
  }

  const text = await response.text();

  if (text.length > maximumResponseBytes) {
    throw new Error("A resposta da playlist excedeu o limite seguro de leitura.");
  }

  return text;
}

async function fetchPublicPlaylist(playlistId: string) {
  const playlistUrl = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
  const html = await fetchBoundedText(playlistUrl, {
    headers: {
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.7",
      "User-Agent": "Mozilla/5.0 (compatible; MemberAreaPlaylistImporter/1.0)"
    }
  });
  const initialData = extractAssignedJson(html, ["var ytInitialData =", "ytInitialData ="]);
  const firstPage = collectPublicPlaylistPage(initialData, 1);
  const apiKey = /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/.exec(html)?.[1];
  const clientVersion = /"INNERTUBE_CONTEXT_CLIENT_VERSION"\s*:\s*"([^"]+)"/.exec(html)?.[1]
    ?? /"clientVersion"\s*:\s*"([^"]+)"/.exec(html)?.[1];
  const items = [...firstPage.items];
  const seenTokens = new Set<string>();
  let nextToken = firstPage.continuationTokens.at(-1);
  let continuationRequests = 0;

  while (
    nextToken
    && apiKey
    && clientVersion
    && items.length < maximumPlaylistItems
    && !seenTokens.has(nextToken)
    && continuationRequests < maximumContinuationRequests
  ) {
    continuationRequests += 1;
    seenTokens.add(nextToken);
    const continuationText = await fetchBoundedText(
      `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}`,
      {
        body: JSON.stringify({
          context: {
            client: {
              clientName: "WEB",
              clientVersion,
              hl: "pt-BR"
            }
          },
          continuation: nextToken
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      }
    );
    const page = collectPublicPlaylistPage(JSON.parse(continuationText), items.length + 1);
    items.push(...page.items);
    nextToken = page.continuationTokens.at(-1);
  }

  return {
    description: firstPage.playlistDescription,
    items: items.slice(0, maximumPlaylistItems),
    title: firstPage.playlistTitle
  };
}

async function fetchOfficialPlaylist(playlistId: string, apiKey: string) {
  const metadataUrl = new URL("https://www.googleapis.com/youtube/v3/playlists");
  metadataUrl.search = new URLSearchParams({
    id: playlistId,
    key: apiKey,
    part: "snippet"
  }).toString();
  const metadata = JSON.parse(await fetchBoundedText(metadataUrl.toString())) as {
    items?: Array<{ snippet?: { description?: string; title?: string } }>;
  };
  const snippet = metadata.items?.[0]?.snippet;

  if (!snippet?.title) {
    throw new Error("Playlist nao encontrada ou indisponivel para importacao.");
  }

  const items: YouTubePlaylistSourceItem[] = [];
  let pageToken = "";

  do {
    const itemsUrl = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    itemsUrl.search = new URLSearchParams({
      key: apiKey,
      maxResults: "50",
      pageToken,
      part: "snippet,contentDetails",
      playlistId
    }).toString();
    const page = JSON.parse(await fetchBoundedText(itemsUrl.toString())) as {
      items?: Array<{
        contentDetails?: { videoId?: string };
        snippet?: {
          description?: string;
          position?: number;
          thumbnails?: Record<string, { url?: string }>;
          title?: string;
        };
      }>;
      nextPageToken?: string;
    };

    for (const item of page.items ?? []) {
      const videoId = item.contentDetails?.videoId ?? "";
      const title = item.snippet?.title?.trim() ?? "";

      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId) || !title || /^(private|deleted) video$/i.test(title)) {
        continue;
      }

      const thumbnails = Object.values(item.snippet?.thumbnails ?? {}).map((thumbnail) => thumbnail.url).filter(Boolean);
      items.push({
        description: item.snippet?.description,
        position: (item.snippet?.position ?? items.length) + 1,
        thumbnailUrl: thumbnails.at(-1),
        title,
        videoId
      });
    }

    pageToken = page.nextPageToken ?? "";
  } while (pageToken && items.length < maximumPlaylistItems);

  for (let index = 0; index < items.length; index += 50) {
    const group = items.slice(index, index + 50);
    const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    videosUrl.search = new URLSearchParams({
      id: group.map((item) => item.videoId).join(","),
      key: apiKey,
      part: "contentDetails"
    }).toString();
    const videos = JSON.parse(await fetchBoundedText(videosUrl.toString())) as {
      items?: Array<{ contentDetails?: { duration?: string }; id?: string }>;
    };
    const durationById = new Map((videos.items ?? []).map((item) => [item.id, parseIsoDuration(item.contentDetails?.duration)]));

    group.forEach((item) => {
      item.durationSeconds = durationById.get(item.videoId);
    });
  }

  return {
    description: snippet.description ?? "",
    items: items.slice(0, maximumPlaylistItems),
    title: snippet.title
  };
}

export async function loadYouTubeCourseImportPreview(
  value: string,
  options?: {
    moduleRanges?: YouTubeCourseImportModuleRange[];
    organizationMode?: YouTubeCourseOrganizationMode;
  }
) {
  const playlistId = extractYouTubePlaylistId(value);

  if (!playlistId) {
    throw new Error("Cole uma URL valida de playlist do YouTube.");
  }

  const officialApiKey = process.env.YOUTUBE_DATA_API_KEY?.trim();
  const source = officialApiKey
    ? await fetchOfficialPlaylist(playlistId, officialApiKey)
    : await fetchPublicPlaylist(playlistId);

  return buildYouTubeCourseImportPreview({
    description: source.description,
    items: source.items,
    moduleRanges: options?.moduleRanges,
    organizationMode: options?.organizationMode,
    playlistId,
    title: source.title
  });
}

function publicInputError(message: string, status = 400) {
  return Object.assign(new Error(message), { status });
}

function validateCourseImage(value: string) {
  const image = value.trim();

  if (!image) {
    return "";
  }

  if (image.length > 5_500_000) {
    throw publicInputError("A capa excede o limite de 4 MB para importacao.", 413);
  }

  if (image.startsWith("data:image/")) {
    return image;
  }

  try {
    const url = new URL(image);

    if (url.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw publicInputError("Use uma capa HTTPS valida, envie uma imagem ou deixe o campo vazio.");
  }

  return image;
}

export type YouTubePlaylistCourseImportResult = {
  importResult: {
    courseId: string;
    /** A playlist ja tinha virado este curso (sincronizacao): situacao e capa foram mantidas. */
    courseExisted?: boolean;
    lessonCount: number;
    moduleCount: number;
    /** Curso novo nasce em Rascunho; sincronizar mantem a situacao que o curso ja tinha. */
    publicationStatus: "draft" | "published";
  };
  warnings: string[];
};

/**
 * Miolo da importacao, sem devolver o banco inteiro: valida, rele a playlist no servidor, envia a capa
 * ao Storage e grava pela RPC transacional admin_import_new_youtube_course (import_youtube_course so
 * para playlist que ainda nao virou curso, com trava por playlist). Usado pela Server Action do admin
 * (src/server/catalog/import-actions.ts).
 */
export async function importYouTubePlaylistCourse(input: YouTubeCourseImportCommitInput): Promise<YouTubePlaylistCourseImportResult> {
  const title = input.title.trim();
  const description = input.description.trim();

  if (!title || title.length > 180) {
    throw publicInputError("Informe um nome de curso com ate 180 caracteres.");
  }

  if (description.length > 10_000) {
    throw publicInputError("A descricao deve ter ate 10.000 caracteres.");
  }

  if (!(input.accessModel === "closed" || input.accessModel === "free")) {
    throw publicInputError("Modelo de acesso invalido.");
  }

  if (!(input.coursePresentationMode === "lesson_playlist" || input.coursePresentationMode === "module_cards")) {
    throw publicInputError("Modo de apresentacao invalido.");
  }

  if (!(input.organizationMode === "automatic" || input.organizationMode === "manual_ranges")) {
    throw publicInputError("Modo de organizacao invalido.");
  }

  if (!Array.isArray(input.moduleRanges) || input.moduleRanges.length > 100) {
    throw publicInputError("Intervalos de modulos invalidos.");
  }

  // A playlist e relida no servidor para impedir que o navegador injete IDs de video ou uma arvore adulterada.
  const preview = await loadYouTubeCourseImportPreview(input.playlistUrl, {
    moduleRanges: input.organizationMode === "manual_ranges" ? input.moduleRanges : undefined,
    organizationMode: input.organizationMode
  });
  const image = await persistImageAsset(validateCourseImage(input.image), `content/yt-course-${preview.playlistId}/cover`);
  const supabase = getSupabaseAdminClient();
  const manifest = {
    accessModel: input.accessModel,
    coursePresentationMode: input.coursePresentationMode,
    description,
    image,
    moduleRanges: input.organizationMode === "manual_ranges" ? input.moduleRanges : [],
    modules: preview.modules,
    naming: preview.naming,
    organizationMode: input.organizationMode,
    playlistId: preview.playlistId,
    playlistUrl: preview.playlistUrl,
    title
  };
  const result = await supabase.rpc("admin_import_new_youtube_course", { course_import: manifest });

  if (result.error) {
    if (result.error.message?.includes("playlist_already_imported")) {
      throw publicInputError("Esta playlist acabou de virar um curso. Abra o curso em Produtos.", 409);
    }

    console.error("Erro importando playlist do YouTube", result.error);
    throw new Error("Nao foi possivel gravar o curso importado.");
  }

  return {
    importResult: result.data as YouTubePlaylistCourseImportResult["importResult"],
    warnings: preview.warnings
  };
}
