import { NextResponse } from "next/server";
import type { AdminCommentStatus } from "@/lib/platform-types";
import { requireApiRole } from "@/server/auth/permissions";
import {
  LessonCommentStoreError,
  moderateLessonComment
} from "@/server/comments/comment-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

type AdminCommentRouteContext = {
  params: Promise<{ commentId: string }>;
};

export async function PATCH(request: Request, context: AdminCommentRouteContext) {
  const { commentId } = await context.params;
  const auth = await requireApiRole("community.moderate", { commentIds: [commentId] });

  if (auth.response || !auth.user) {
    return auth.response;
  }

  let payload: { note?: unknown; status?: unknown };

  try {
    payload = await readBoundedJson<{ note?: unknown; status?: unknown }>(request, 64_000);
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel ler os dados enviados.", 400);
  }

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
