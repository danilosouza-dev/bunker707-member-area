import { NextResponse } from "next/server";

import {
  PlatformGuideError,
  submitPlatformGuideQuestion
} from "@/server/ai/platform-guide";
import { requireApiUser } from "@/server/auth/guards";
import { jsonRouteError } from "@/server/http/route-errors";

type RouteContext = { params: Promise<{ conversationId: string }> };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const maxDuration = 60;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) return noStore(auth.response!);
  const { conversationId } = await context.params;

  try {
    const payload = await request.json() as { clientRequestId?: unknown; question?: unknown };
    const clientRequestId = typeof payload.clientRequestId === "string" ? payload.clientRequestId : "";

    if (!uuidPattern.test(clientRequestId)) {
      throw new PlatformGuideError("Identificador de envio invalido.");
    }

    const data = await submitPlatformGuideQuestion({
      clientRequestId,
      conversationId,
      question: payload.question,
      userId: auth.user.id
    });
    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel obter a resposta da IA Diretor."));
  }
}
