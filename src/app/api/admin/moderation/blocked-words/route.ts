import { NextResponse } from "next/server";
import { requireApiRole } from "@/server/auth/permissions";
import {
  createBlockedWord,
  LessonCommentStoreError
} from "@/server/comments/comment-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

export async function POST(request: Request) {
  const auth = await requireApiRole("community.moderate");

  if (auth.response || !auth.user) {
    return auth.response;
  }

  let payload: { message?: unknown; word?: unknown };

  try {
    payload = await readBoundedJson<{ message?: unknown; word?: unknown }>(request, 64_000);
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel ler os dados enviados.", 400);
  }

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
