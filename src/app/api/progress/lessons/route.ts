import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { replaceCompletedLessons } from "@/server/db/platform-store";
import { requireLessonsAccess } from "@/server/access/lesson-access";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import type { LessonReaction, LessonWatchStatus } from "@/lib/platform-types";

export async function PUT(request: Request) {
  const auth = await requireApiUser();

  if (auth.response) {
    return auth.response;
  }

  if (!auth.user) {
    return NextResponse.json({ error: "Sessao obrigatoria." }, { status: 401 });
  }

  let payload: {
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

  try {
    payload = await readBoundedJson<typeof payload>(request, 256_000);
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel ler o progresso enviado.", 400);
  }
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
  const reactionEntries = payload.lessonReactions && typeof payload.lessonReactions === "object"
    ? Object.entries(payload.lessonReactions)
    : [];
  const completedLessonIdsAreValid = payload.completedLessonIds === undefined || (
    Array.isArray(payload.completedLessonIds) &&
    payload.completedLessonIds.length <= 500 &&
    payload.completedLessonIds.every((lessonId) => typeof lessonId === "string" && lessonId.trim().length > 0)
  );
  const lessonReactionsAreValid = payload.lessonReactions === undefined || (
    payload.lessonReactions !== null &&
    !Array.isArray(payload.lessonReactions) &&
    reactionEntries.length <= 500 &&
    reactionEntries.every(([lessonId, reaction]) => (
      lessonId.trim().length > 0 &&
      (reaction === "not-for-me" || reaction === "liked" || reaction === "loved")
    ))
  );

  if (
    !payload.contentId ||
    !completedLessonIdsAreValid ||
    !lessonReactionsAreValid ||
    (payload.completedLessonIds === undefined && payload.lessonReactions === undefined && !hasWatchProgress)
  ) {
    return NextResponse.json({ error: "Progresso de aula invalido." }, { status: 400 });
  }

  const lessonId = payload.lessonId ?? payload.completedLessonIds?.[0] ?? Object.keys(payload.lessonReactions ?? {})[0];

  if (!lessonId) {
    return NextResponse.json({ error: "Aula obrigatoria para salvar progresso." }, { status: 400 });
  }

  const referencedLessonIds = Array.from(new Set([
    ...(payload.lessonId ? [payload.lessonId] : []),
    ...(payload.completedLessonIds ?? []),
    ...reactionEntries.map(([reactionLessonId]) => reactionLessonId)
  ]));

  try {
    await requireLessonsAccess({
      contentId: payload.contentId,
      lessonIds: referencedLessonIds,
      userId: auth.user.id
    });

    const data = await replaceCompletedLessons({
      completedLessonIds: payload.completedLessonIds,
      contentId: payload.contentId,
      durationSeconds: payload.durationSeconds,
      lessonId,
      lessonReactions: payload.lessonReactions,
      maxProgressPercent: payload.maxProgressPercent,
      progressPercent: payload.progressPercent,
      progressSeconds: payload.progressSeconds,
      resumeFrameUrl: payload.resumeFrameUrl,
      status: payload.status,
      userId: auth.user.id
    });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar o progresso da aula.");
  }
}

// O flush ao sair da aula usa navigator.sendBeacon, que só envia POST. Mesmo payload,
// mesma sessão por cookie e mesmas validações do PUT, sem duplicar o handler.
export { PUT as POST };
