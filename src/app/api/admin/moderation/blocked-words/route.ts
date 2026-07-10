import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import {
  createBlockedWord,
  LessonCommentStoreError
} from "@/server/comments/comment-store";

export async function POST(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response || !auth.user) {
    return auth.response;
  }

  const payload = await request.json() as { message?: unknown; word?: unknown };
  const word = typeof payload.word === "string" ? payload.word : "";
  const message = typeof payload.message === "string" ? payload.message : undefined;

  try {
    const data = await createBlockedWord({
      actorId: auth.user.id,
      message,
      word
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Nao foi possivel adicionar a palavra bloqueada."
    }, {
      status: error instanceof LessonCommentStoreError ? error.status : 500
    });
  }
}
