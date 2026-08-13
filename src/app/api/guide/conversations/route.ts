import { NextResponse } from "next/server";

import {
  createPlatformGuideConversation,
  getPlatformGuideOverview
} from "@/server/ai/platform-guide";
import { requireApiUser } from "@/server/auth/guards";
import { jsonRouteError } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function GET() {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    return noStore(NextResponse.json({ data: await getPlatformGuideOverview(auth.user.id) }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar a IA Diretor."));
  }
}

export async function POST() {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const conversation = await createPlatformGuideConversation(auth.user.id);
    return noStore(NextResponse.json({ data: conversation }, { status: 201 }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel criar uma conversa com a IA Diretor."));
  }
}
