import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import {
  reportLessonComment
} from "@/server/comments/comment-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

type CommentReportRouteContext = {
  params: Promise<{ commentId: string }>;
};

export async function POST(request: Request, context: CommentReportRouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return auth.response;
  }

  const { commentId } = await context.params;
  const payload = await readBoundedJson<{ reason?: unknown }>(request, 16_000).catch(() => ({})) as { reason?: unknown };
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
    return jsonRouteError(error, "Nao foi possivel enviar a denuncia.");
  }
}
