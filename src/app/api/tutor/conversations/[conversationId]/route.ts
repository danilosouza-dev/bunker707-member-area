import { NextResponse } from "next/server";

import { requireLessonAccess } from "@/server/access/lesson-access";
import {
  getTutorConversation,
  getTutorConversationAccess,
  hideTutorConversation,
  renameTutorConversation
} from "@/server/ai/tutor";
import { requireApiUser } from "@/server/auth/guards";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

type RouteContext = { params: Promise<{ conversationId: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) return noStore(auth.response!);
  const { conversationId } = await context.params;

  try {
    const access = await getTutorConversationAccess(conversationId, auth.user.id);
    await requireLessonAccess({ ...access, userId: auth.user.id });
    return noStore(NextResponse.json({ data: await getTutorConversation(conversationId, auth.user.id) }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar esta conversa do Tutor IA."));
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) return noStore(auth.response!);
  const { conversationId } = await context.params;

  try {
    return noStore(NextResponse.json({ data: await hideTutorConversation(conversationId, auth.user.id) }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel excluir esta conversa do Tutor IA."));
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) return noStore(auth.response!);
  const { conversationId } = await context.params;

  try {
    const body = await readBoundedJson<{ title?: unknown }>(request, 16_000).catch(() => ({})) as { title?: unknown };
    return noStore(NextResponse.json({ data: await renameTutorConversation(conversationId, auth.user.id, body.title) }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel renomear esta conversa do Tutor IA."));
  }
}
