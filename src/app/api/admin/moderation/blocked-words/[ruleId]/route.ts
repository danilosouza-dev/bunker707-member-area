import { NextResponse } from "next/server";
import { requireApiRole } from "@/server/auth/permissions";
import {
  deleteBlockedWord,
  LessonCommentStoreError,
  updateBlockedWord
} from "@/server/comments/comment-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

type BlockedWordRouteContext = {
  params: Promise<{ ruleId: string }>;
};

function errorResponse(error: unknown, fallbackMessage: string) {
  return NextResponse.json({
    error: error instanceof Error ? error.message : fallbackMessage
  }, {
    status: error instanceof LessonCommentStoreError ? error.status : 500
  });
}

export async function PATCH(request: Request, context: BlockedWordRouteContext) {
  const auth = await requireApiRole("community.moderate");

  if (auth.response || !auth.user) {
    return auth.response;
  }

  const { ruleId } = await context.params;
  let payload: { active?: unknown };

  try {
    payload = await readBoundedJson<{ active?: unknown }>(request, 64_000);
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel ler os dados enviados.", 400);
  }

  if (!ruleId || typeof payload.active !== "boolean") {
    return NextResponse.json({ error: "Regra de bloqueio invalida." }, { status: 400 });
  }

  try {
    const data = await updateBlockedWord({
      active: payload.active,
      actorId: auth.user.id,
      id: ruleId
    });
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error, "Nao foi possivel atualizar a palavra bloqueada.");
  }
}

export async function DELETE(_request: Request, context: BlockedWordRouteContext) {
  const auth = await requireApiRole("community.moderate");

  if (auth.response || !auth.user) {
    return auth.response;
  }

  const { ruleId } = await context.params;

  if (!ruleId) {
    return NextResponse.json({ error: "Regra de bloqueio invalida." }, { status: 400 });
  }

  try {
    const data = await deleteBlockedWord(ruleId);
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error, "Nao foi possivel excluir a palavra bloqueada.");
  }
}
