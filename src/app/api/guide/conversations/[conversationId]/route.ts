import { NextResponse } from "next/server";

import {
  getPlatformGuideConversation,
  hidePlatformGuideConversation,
  renamePlatformGuideConversation
} from "@/server/ai/platform-guide";
import { requireApiUser } from "@/server/auth/guards";
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
    return noStore(NextResponse.json({
      data: await getPlatformGuideConversation(conversationId, auth.user.id)
    }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar esta conversa da IA Diretor."));
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) return noStore(auth.response!);
  const { conversationId } = await context.params;

  try {
    return noStore(NextResponse.json({
      data: await hidePlatformGuideConversation(conversationId, auth.user.id)
    }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel excluir esta conversa da IA Diretor."));
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) return noStore(auth.response!);
  const { conversationId } = await context.params;

  try {
    const body = await request.json().catch(() => ({})) as { title?: unknown };
    return noStore(NextResponse.json({
      data: await renamePlatformGuideConversation(conversationId, auth.user.id, body.title)
    }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel renomear esta conversa da IA Diretor."));
  }
}
