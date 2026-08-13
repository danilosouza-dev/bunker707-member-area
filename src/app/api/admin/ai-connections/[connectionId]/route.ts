import { NextResponse } from "next/server";

import {
  removeAIProviderConnection,
  saveAIProviderAPIConnection,
  updateAIProviderConnection,
  getAIProviderConnectionRow
} from "@/server/ai/provider-connections";
import { requireApiAdmin } from "@/server/auth/guards";
import { jsonRouteError } from "@/server/http/route-errors";

type RouteContext = { params: Promise<{ connectionId: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await requireApiAdmin();

  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const { connectionId } = await context.params;
    const payload = await request.json() as Record<string, unknown>;
    const row = await getAIProviderConnectionRow(connectionId);
    const connection = row.auth_mode === "api_key" && payload.apiKey !== undefined
      ? await saveAIProviderAPIConnection({
          actorId: auth.user.id,
          apiKey: payload.apiKey,
          connectionId,
          label: payload.label,
          priority: payload.priority,
          provider: row.provider
        })
      : await updateAIProviderConnection({
          actorId: auth.user.id,
          connectionId,
          label: payload.label,
          paused: payload.paused,
          priority: payload.priority
        });
    return noStore(NextResponse.json({ data: connection }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel atualizar a conexao de IA."));
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireApiAdmin();

  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const { connectionId } = await context.params;
    return noStore(NextResponse.json({
      data: await removeAIProviderConnection(connectionId, auth.user.id)
    }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel remover a conexao de IA."));
  }
}
