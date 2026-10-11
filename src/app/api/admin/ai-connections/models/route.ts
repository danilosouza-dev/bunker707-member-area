import { NextResponse } from "next/server";

import { listAccountGatewayModels } from "@/server/ai/account-gateway";
import { requireApiRole } from "@/server/auth/permissions";
import { AIProviderConfigError } from "@/server/ai/provider-config";
import { isAIProvider } from "@/server/ai/types";
import { jsonRouteError } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET(request: Request) {
  const auth = await requireApiRole("admin.read");

  if (auth.response) return noStore(auth.response);

  try {
    const provider = new URL(request.url).searchParams.get("provider");

    if (!isAIProvider(provider)) throw new AIProviderConfigError("Provedor de IA invalido.");
    return noStore(NextResponse.json({ data: await listAccountGatewayModels(provider) }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar os modelos das contas conectadas."));
  }
}
