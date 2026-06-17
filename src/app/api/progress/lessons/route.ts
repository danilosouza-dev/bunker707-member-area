import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { replaceCompletedLessons } from "@/server/db/platform-store";
import type { LessonReaction, LessonWatchStatus } from "@/lib/platform-types";

export async function PUT(request: Request) {
  const auth = await requireApiUser();

  if (auth.response) {
    return auth.response;
  }

  if (!auth.user) {
    return NextResponse.json({ error: "Sessao obrigatoria." }, { status: 401 });
  }

  const payload = await request.json() as {
    completedLessonIds?: string[];
    contentId?: string;
    durationSeconds?: number;
    lessonId?: string;
    lessonReactions?: Partial<Record<string, LessonReaction>>;
    maxProgressPercent?: number;
    progressPercent?: number;
    progressSeconds?: number;
    resumeFrameUrl?: string;
    status?: LessonWatchStatus;
  };
  const hasWatchProgress =
    typeof payload.lessonId === "string" &&
    (
      typeof payload.progressSeconds === "number" ||
      typeof payload.progressPercent === "number" ||
      typeof payload.maxProgressPercent === "number" ||
      typeof payload.resumeFrameUrl === "string" ||
      payload.status === "in_progress" ||
      payload.status === "completed"
    );

  if (
    !payload.contentId ||
    (payload.completedLessonIds !== undefined && !Array.isArray(payload.completedLessonIds)) ||
    (payload.completedLessonIds === undefined && payload.lessonReactions === undefined && !hasWatchProgress)
  ) {
    return NextResponse.json({ error: "Progresso de aula invalido." }, { status: 400 });
  }

  const data = await replaceCompletedLessons({
    completedLessonIds: payload.completedLessonIds,
    contentId: payload.contentId,
    durationSeconds: payload.durationSeconds,
    lessonId: hasWatchProgress ? payload.lessonId : undefined,
    lessonReactions: payload.lessonReactions,
    maxProgressPercent: payload.maxProgressPercent,
    progressPercent: payload.progressPercent,
    progressSeconds: payload.progressSeconds,
    resumeFrameUrl: payload.resumeFrameUrl,
    status: payload.status,
    userId: auth.user.id
  });

  return NextResponse.json({ data });
}
