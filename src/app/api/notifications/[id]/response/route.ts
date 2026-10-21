import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { respondToNotification } from "@/server/communications/inbox";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

// "Aceitar" ou "Recusar" num aviso que pede resposta. A primeira resposta vale; repetir e 409.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return noStore(NextResponse.json({ error: "Notificacao invalida." }, { status: 400 }));
  }

  let payload: { response?: unknown };

  try {
    payload = await readBoundedJson<{ response?: unknown }>(request, 8_000);
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel ler a resposta.", 400));
  }

  const response = payload && typeof payload === "object" ? payload.response : undefined;

  if (response !== "accepted" && response !== "declined") {
    return noStore(NextResponse.json({ error: "Resposta invalida." }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;
    const result = await respondToNotification(userId, id.toLowerCase(), response);

    await recordCommunicationEvents([
      {
        entity_id: id.toLowerCase(),
        entity_type: "notification",
        event_type: "notification_responded",
        metadata: { campaign_id: result.campaignId, response },
        user_id: userId
      }
    ]);

    return noStore(NextResponse.json({ data: { response } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel registrar a resposta."));
  }
}
