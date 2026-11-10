import { NextResponse } from "next/server";

import { startAIAccountLink } from "@/server/ai/account-link";
import { requireApiRole } from "@/server/auth/permissions";
import { jsonRouteError } from "@/server/http/route-errors";
import { licenseRouteRefusal } from "@/server/licensing/guards";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request) {
  const licenseRefusal = await licenseRouteRefusal({ actionClass: "conteudo" });
  if (licenseRefusal) return licenseRefusal;

  const auth = await requireApiRole("settings.ai");

  if (auth.response || !auth.user) return auth.response;

  try {
    const payload = await request.json() as Record<string, unknown>;
    return NextResponse.json({
      data: await startAIAccountLink(payload.provider, payload.label, auth.user.id)
    }, { status: 201 });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel iniciar a conexao com a conta.");
  }
}
