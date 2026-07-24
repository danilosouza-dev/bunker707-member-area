import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/auth/guards";
import { jsonRouteError } from "@/server/http/route-errors";
import { endTvSession, getOwnerTvSession } from "@/server/video/tv-sessions";

type RouteContext = { params: Promise<{ sessionId: string }> };

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

  try {
    const { sessionId } = await context.params;
    const session = await getOwnerTvSession(sessionId, auth.user.id);
    return noStore(NextResponse.json({ data: { session } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel consultar o Modo TV."));
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiUser();
  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const { sessionId } = await context.params;
    const session = await endTvSession(sessionId, auth.user.id);
    return noStore(NextResponse.json({ data: { session } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel encerrar o Modo TV."));
  }
}
