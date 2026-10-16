import { NextResponse } from "next/server";

import { getAIUsageSummary } from "@/server/ai/usage-analytics";
import { requireApiRole } from "@/server/auth/permissions";
import { jsonRouteError } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(request: Request) {
  const auth = await requireApiRole("settings.ai");

  if (auth.response) return noStore(auth.response);

  try {
    const days = new URL(request.url).searchParams.get("days") ?? "30";
    return noStore(NextResponse.json({ data: await getAIUsageSummary(days) }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar o consumo do Tutor IA."));
  }
}
