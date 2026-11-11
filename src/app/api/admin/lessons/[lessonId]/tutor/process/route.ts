import { NextResponse } from "next/server";

import { processLessonAIProfile } from "@/server/ai/lesson-profile";
import { getLessonTranscriptStatus } from "@/server/ai/transcripts";
import { requireApiRole } from "@/server/auth/permissions";
import { jsonRouteError } from "@/server/http/route-errors";
import { licenseRouteRefusal } from "@/server/licensing/guards";

type RouteContext = { params: Promise<{ lessonId: string }> };

export const maxDuration = 60;

export async function POST(_request: Request, context: RouteContext) {
  const licenseRefusal = await licenseRouteRefusal({ actionClass: "conteudo" });
  if (licenseRefusal) return licenseRefusal;

  const { lessonId } = await context.params;
  const auth = await requireApiRole("catalog.content", { lessonIds: [lessonId] });

  if (auth.response) return auth.response;

  try {
    await processLessonAIProfile(lessonId);
    return NextResponse.json({ data: await getLessonTranscriptStatus(lessonId) });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel analisar esta aula para o Tutor IA.");
  }
}
