import { NextResponse } from "next/server";

import {
  cancelAIAccountLink,
  pollAIAccountLink,
  submitAIAccountLinkCallback
} from "@/server/ai/account-link";
import { requireApiRole } from "@/server/auth/permissions";
import { jsonRouteError } from "@/server/http/route-errors";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireApiRole("admin.read");

  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const { sessionId } = await context.params;
    return noStore(NextResponse.json({ data: await pollAIAccountLink(sessionId, auth.user.id) }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel consultar a conexao da conta."));
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiRole("settings.ai");

  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const { sessionId } = await context.params;
    const payload = await request.json() as Record<string, unknown>;
    return noStore(NextResponse.json({
      data: await submitAIAccountLinkCallback(sessionId, payload.redirectUrl, auth.user.id)
    }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel concluir o retorno da conta."));
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiRole("settings.ai");

  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const { sessionId } = await context.params;
    return noStore(NextResponse.json({ data: await cancelAIAccountLink(sessionId, auth.user.id) }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel cancelar a conexao da conta."));
  }
}
