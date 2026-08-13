import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import {
  createLessonComment,
  listLessonComments
} from "@/server/comments/comment-store";
import { jsonRouteError } from "@/server/http/route-errors";

type LessonCommentsRouteContext = {
  params: Promise<{ lessonId: string }>;
};

function commentErrorResponse(error: unknown, fallbackMessage: string) {
  return jsonRouteError(error, fallbackMessage);
}

export async function GET(request: Request, context: LessonCommentsRouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return auth.response;
  }

  const { lessonId } = await context.params;
  const contentId = new URL(request.url).searchParams.get("contentId")?.trim();

  if (!contentId || !lessonId) {
    return NextResponse.json({ error: "Aula e conteudo sao obrigatorios." }, { status: 400 });
  }

  try {
    const comments = await listLessonComments({
      contentId,
      lessonId,
      userId: auth.user.id
    });

    return NextResponse.json({ data: comments });
  } catch (error) {
    return commentErrorResponse(error, "Nao foi possivel carregar os comentarios.");
  }
}

export async function POST(request: Request, context: LessonCommentsRouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return auth.response;
  }

  const { lessonId } = await context.params;
  const payload = await request.json() as {
    body?: unknown;
    contentId?: unknown;
    parentCommentId?: unknown;
  };
  const contentId = typeof payload.contentId === "string" ? payload.contentId.trim() : "";
  const body = typeof payload.body === "string" ? payload.body : "";
  const parentCommentId = typeof payload.parentCommentId === "string"
    ? payload.parentCommentId.trim() || undefined
    : undefined;

  if (!contentId || !lessonId) {
    return NextResponse.json({ error: "Aula e conteudo sao obrigatorios." }, { status: 400 });
  }

  try {
    const comment = await createLessonComment({
      body,
      contentId,
      lessonId,
      parentCommentId,
      user: auth.user
    });

    return NextResponse.json({ data: comment }, { status: 201 });
  } catch (error) {
    return commentErrorResponse(error, "Nao foi possivel enviar o comentario.");
  }
}
