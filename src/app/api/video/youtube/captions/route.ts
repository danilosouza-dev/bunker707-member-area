import { NextResponse } from "next/server";
import { requireLessonAccess } from "@/server/access/lesson-access";
import { getActiveLessonTranscriptCaptions } from "@/server/ai/transcripts";
import { requireApiUser } from "@/server/auth/guards";
import { jsonRouteError } from "@/server/http/route-errors";
import { resolveLessonCaptions } from "@/server/video/lesson-captions";
import {
  fetchYouTubeCaptions,
  isValidYouTubeVideoId,
  normalizeYouTubeCaptionLanguage
} from "@/server/video/youtube-captions";
import { isValidPlatformResourceId } from "@/server/video/youtube-streams";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function disableResponseCaching(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

function jsonResponse(body: unknown, status = 200) {
  return disableResponseCaching(NextResponse.json(body, { status }));
}

function getStoredYouTubeVideoId(videoConfig: {
  assetId?: string;
  provider?: string;
  url?: string;
} | null) {
  if (videoConfig?.provider !== "youtube") {
    return "";
  }

  const assetId = videoConfig.assetId?.trim() ?? "";

  if (isValidYouTubeVideoId(assetId)) {
    return assetId;
  }

  const value = videoConfig.url?.trim() ?? "";

  if (isValidYouTubeVideoId(value)) {
    return value;
  }

  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    let candidate = "";

    if (hostname === "youtu.be" || hostname.endsWith(".youtu.be")) {
      candidate = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com") ||
      hostname === "youtube-nocookie.com" ||
      hostname.endsWith(".youtube-nocookie.com")
    ) {
      candidate = url.searchParams.get("v") ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
    }

    return isValidYouTubeVideoId(candidate) ? candidate : "";
  } catch {
    return "";
  }
}

export async function GET(request: Request) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return auth.response ? disableResponseCaching(auth.response) : jsonResponse({ error: "Sessao obrigatoria." }, 401);
  }

  const searchParams = new URL(request.url).searchParams;
  const contentId = searchParams.get("contentId")?.trim() ?? "";
  const lessonId = searchParams.get("lessonId")?.trim() ?? "";
  const requestedLanguage = searchParams.get("language") ?? searchParams.get("lang") ?? "pt";
  const language = normalizeYouTubeCaptionLanguage(requestedLanguage);

  if (!isValidPlatformResourceId(contentId) || !isValidPlatformResourceId(lessonId)) {
    return jsonResponse({ error: "Parametros de video invalidos." }, 400);
  }

  if (!language) {
    return jsonResponse({ error: "Idioma de legenda invalido." }, 400);
  }

  try {
    const access = await requireLessonAccess({ contentId, lessonId, userId: auth.user.id });
    const videoId = getStoredYouTubeVideoId(access.videoConfig);

    if (!isValidYouTubeVideoId(videoId)) {
      return jsonResponse({ error: "Video da aula nao encontrado." }, 404);
    }

    // Legenda guardada na plataforma primeiro; o YouTube ao vivo so quando nao ha copia.
    const captions = await resolveLessonCaptions({
      fetchCaptions: fetchYouTubeCaptions,
      language,
      loadStoredCaptions: () => getActiveLessonTranscriptCaptions(lessonId),
      onStoredCaptionsError: (error) => {
        console.warn("[legendas] copia guardada indisponivel; tentando o YouTube", error);
      },
      videoId
    });

    return jsonResponse(captions);
  } catch (error) {
    return disableResponseCaching(jsonRouteError(
      error,
      "Nao foi possivel carregar as legendas deste video."
    ));
  }
}
