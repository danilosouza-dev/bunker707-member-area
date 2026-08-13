import { NextResponse } from "next/server";
import type { AdminCommentStatus } from "@/lib/platform-types";
import { requireApiAdmin } from "@/server/auth/guards";
import {
  LessonCommentStoreError,
  moderateLessonComment
} from "@/server/comments/comment-store";

type AdminCommentRouteContext = {
  params: Promise<{ commentId: string }>;
};

export async function PATCH(request: Request, context: AdminCommentRouteContext) {
  const auth = await requireApiAdmin();

  if (auth.response || !auth.user) {
    return auth.response;
  }

  const { commentId } = await context.params;
  const payload = await request.json() as { note?: unknown; status?: unknown };
  const status = typeof payload.status === "string" ? payload.status as AdminCommentStatus : undefined;
  const note = typeof payload.note === "string" ? payload.note : undefined;

  if (!commentId || !status) {
    return NextResponse.json({ error: "Comentario e status sao obrigatorios." }, { status: 400 });
  }

  try {
    const data = await moderateLessonComment({
      actorId: auth.user.id,
      commentId,
      note,
      status
    });

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Nao foi possivel moderar o comentario."
    }, {
      status: error instanceof LessonCommentStoreError ? error.status : 500
    });
  }
}
