import { NextResponse } from "next/server";
import type { LessonCommentReaction } from "@/lib/platform-types";
import { requireApiUser } from "@/server/auth/guards";
import {
  setLessonCommentReaction
} from "@/server/comments/comment-store";
import { jsonRouteError } from "@/server/http/route-errors";

type CommentReactionRouteContext = {
  params: Promise<{ commentId: string }>;
};

export async function PUT(request: Request, context: CommentReactionRouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return auth.response;
  }

  const { commentId } = await context.params;
  const payload = await request.json() as { reaction?: unknown };
  const reaction = payload.reaction === null
    ? null
    : typeof payload.reaction === "string"
      ? payload.reaction as LessonCommentReaction
      : undefined;

  if (!commentId || reaction === undefined) {
    return NextResponse.json({ error: "Reacao invalida." }, { status: 400 });
  }

  try {
    const data = await setLessonCommentReaction({
      commentId,
      reaction,
      userId: auth.user.id
    });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar a reacao.");
  }
}
