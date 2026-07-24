import { NextResponse } from "next/server";

import { requireLessonAccess } from "@/server/access/lesson-access";
import { requireApiUser } from "@/server/auth/guards";
import {
  createTutorConversation,
  getTutorAvailability,
  listTutorConversations
} from "@/server/ai/tutor";
import { jsonRouteError } from "@/server/http/route-errors";

type RouteContext = { params: Promise<{ lessonId: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) return noStore(auth.response!);
  const { lessonId } = await context.params;
  const contentId = new URL(request.url).searchParams.get("contentId")?.trim() ?? "";

  if (!contentId) return noStore(NextResponse.json({ error: "Conteudo obrigatorio." }, { status: 400 }));

  try {
    await requireLessonAccess({ contentId, lessonId, userId: auth.user.id });
    const [availability, conversations] = await Promise.all([
      getTutorAvailability(lessonId),
      listTutorConversations(lessonId, auth.user.id)
    ]);
    return noStore(NextResponse.json({ data: { availability, conversations } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar o Tutor IA."));
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) return noStore(auth.response!);
  const { lessonId } = await context.params;

  try {
    const payload = await request.json() as { contentId?: unknown };
    const contentId = typeof payload.contentId === "string" ? payload.contentId.trim() : "";

    if (!contentId) return noStore(NextResponse.json({ error: "Conteudo obrigatorio." }, { status: 400 }));
    await requireLessonAccess({ contentId, lessonId, userId: auth.user.id });
    const conversation = await createTutorConversation({ contentId, lessonId, userId: auth.user.id });
    return noStore(NextResponse.json({ data: conversation }, { status: 201 }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel criar uma conversa com o Tutor IA."));
  }
}
