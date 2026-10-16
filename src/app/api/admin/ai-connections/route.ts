import { NextResponse } from "next/server";

import { getAccountGatewayStatus } from "@/server/ai/account-gateway";
import {
  listAIProviderConnections,
  saveAIProviderAPIConnection
} from "@/server/ai/provider-connections";
import { requireApiRole } from "@/server/auth/permissions";
import { jsonRouteError } from "@/server/http/route-errors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function GET() {
  const auth = await requireApiRole("settings.ai");

  if (auth.response) return noStore(auth.response);

  try {
    const [connections, gateway] = await Promise.all([
      listAIProviderConnections(),
      getAccountGatewayStatus()
    ]);

    return noStore(NextResponse.json({
      data: {
        connections,
        gateway
      }
    }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar as conexoes de IA."));
  }
}

export async function POST(request: Request) {
  const auth = await requireApiRole("settings.ai");

  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const payload = await request.json() as Record<string, unknown>;
    const connection = await saveAIProviderAPIConnection({
      actorId: auth.user.id,
      apiKey: payload.apiKey,
      label: payload.label,
      priority: payload.priority,
      provider: payload.provider
    });
    return noStore(NextResponse.json({ data: connection }, { status: 201 }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel criar a conexao de API."));
  }
}
