import { NextResponse } from "next/server";

import { getActiveLessonTranscriptCaptions } from "@/server/ai/transcripts";
import { jsonRouteError } from "@/server/http/route-errors";
import { resolveLessonCaptions } from "@/server/video/lesson-captions";
import { getTvReceiverSession } from "@/server/video/tv-sessions";
import { fetchYouTubeCaptions, normalizeYouTubeCaptionLanguage } from "@/server/video/youtube-captions";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Authorization");
  return response;
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

export async function GET(request: Request, context: RouteContext) {
  const language = normalizeYouTubeCaptionLanguage(new URL(request.url).searchParams.get("language") ?? "pt");

  if (!language) {
    return noStore(NextResponse.json({ error: "Idioma de legenda invalido." }, { status: 400 }));
  }

  try {
    const { sessionId } = await context.params;
    const data = await getTvReceiverSession(sessionId, getBearerToken(request), true);

    if (!data.lesson) {
      return noStore(NextResponse.json({ error: "A aula desta sessao nao esta mais disponivel." }, { status: 410 }));
    }

    // Mesma regra do player principal: legenda guardada na plataforma antes do YouTube ao vivo.
    const lessonId = data.lesson.id;
    const captions = await resolveLessonCaptions({
      fetchCaptions: fetchYouTubeCaptions,
      language,
      loadStoredCaptions: () => getActiveLessonTranscriptCaptions(lessonId),
      onStoredCaptionsError: (error) => {
        console.warn("[legendas TV] copia guardada indisponivel; tentando o YouTube", error);
      },
      videoId: data.lesson.video.assetId
    });

    return noStore(NextResponse.json(captions));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar as legendas na TV."));
  }
}
