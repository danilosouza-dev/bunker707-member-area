import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import {
  deleteBlockedWord,
  LessonCommentStoreError,
  updateBlockedWord
} from "@/server/comments/comment-store";

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
  const auth = await requireApiAdmin();

  if (auth.response || !auth.user) {
    return auth.response;
  }

  const { ruleId } = await context.params;
  const payload = await request.json() as { active?: unknown };

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
  const auth = await requireApiAdmin();

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
