import { NextResponse } from "next/server";

import { processLessonAIProfile } from "@/server/ai/lesson-profile";
import {
  getLessonTranscriptStatus,
  loadLessonVideo,
  prepareYouTubeTranscript,
  saveLessonTranscript
} from "@/server/ai/transcripts";
import { requireApiAdmin } from "@/server/auth/guards";
import { jsonRouteError } from "@/server/http/route-errors";

type RouteContext = { params: Promise<{ lessonId: string }> };

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const revalidate = 0;

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiAdmin();

  if (auth.response || !auth.user) return auth.response;
  const { lessonId } = await context.params;

  try {
    const payload = await request.json().catch(() => ({})) as { language?: unknown };
    const lesson = await loadLessonVideo(lessonId);
    const transcript = await prepareYouTubeTranscript(
      lesson.video,
      typeof payload.language === "string" ? payload.language : "pt"
    );
    await saveLessonTranscript({ createdBy: auth.user.id, lessonId, transcript });
    let warning: string | undefined;

    try {
      await processLessonAIProfile(lessonId);
    } catch (error) {
      warning = error instanceof Error ? error.message : "A legenda foi importada, mas a analise ainda nao foi concluida.";
    }

    return NextResponse.json({
      data: await getLessonTranscriptStatus(lessonId),
      ...(warning ? { warning } : {})
    });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel importar a legenda do YouTube.");
  }
}
