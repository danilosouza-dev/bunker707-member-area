import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import {
  LessonCommentStoreError,
  reportLessonComment
} from "@/server/comments/comment-store";

type CommentReportRouteContext = {
  params: Promise<{ commentId: string }>;
};

export async function POST(request: Request, context: CommentReportRouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return auth.response;
  }

  const { commentId } = await context.params;
  const payload = await request.json().catch(() => ({})) as { reason?: unknown };
  const reason = typeof payload.reason === "string" ? payload.reason : undefined;

  if (!commentId) {
    return NextResponse.json({ error: "Comentario obrigatorio." }, { status: 400 });
  }

  try {
    const data = await reportLessonComment({
      commentId,
      reason,
      userId: auth.user.id
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Nao foi possivel enviar a denuncia."
    }, {
      status: error instanceof LessonCommentStoreError ? error.status : 500
    });
  }
}
