import { NextResponse } from "next/server";

import { processLessonAIProfile } from "@/server/ai/lesson-profile";
import { getLessonTranscriptStatus } from "@/server/ai/transcripts";
import { requireApiAdmin } from "@/server/auth/guards";
import { jsonRouteError } from "@/server/http/route-errors";

type RouteContext = { params: Promise<{ lessonId: string }> };

export const maxDuration = 60;

export async function POST(_request: Request, context: RouteContext) {
  const auth = await requireApiAdmin();

  if (auth.response) return auth.response;
  const { lessonId } = await context.params;

  try {
    await processLessonAIProfile(lessonId);
    return NextResponse.json({ data: await getLessonTranscriptStatus(lessonId) });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel analisar esta aula para o Tutor IA.");
  }
}
