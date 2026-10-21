import { NextResponse } from "next/server";
import { requireApiSessionUser } from "@/server/auth/guards";
import { POPUP_EVENTS, type PopupEvent } from "@/server/communications/campaign-model";
import { recordPopupEvent } from "@/server/communications/popups";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

// Evento do aluno no pop-up da home: { event: "impressed" | "clicked" | "closed" | "dismissed" |
// "snoozed" }. Aceita o corpo em text/plain (sendBeacon na hora de sair da pagina manda assim). Sessao
// pelas claims do JWT (v3a, docs/24): so mexe na linha do proprio aluno.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

const EVENT_TYPES: Record<PopupEvent, string> = {
  clicked: "message_clicked",
  closed: "message_closed",
  dismissed: "message_dismissed",
  impressed: "message_impressed",
  snoozed: "message_snoozed"
};

function isPopupEvent(value: unknown): value is PopupEvent {
  return typeof value === "string" && (POPUP_EVENTS as readonly string[]).includes(value);
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiSessionUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return noStore(NextResponse.json({ error: "Pop-up invalido." }, { status: 400 }));
  }

  let payload: { event?: unknown };

  try {
    payload = await readBoundedJson<{ event?: unknown }>(request, 8_000);
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel ler o evento.", 400));
  }

  const event = payload && typeof payload === "object" ? payload.event : undefined;

  if (!isPopupEvent(event)) {
    return noStore(NextResponse.json({ error: "Evento invalido." }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;
    const campaignId = id.toLowerCase();

    await recordPopupEvent(userId, campaignId, event);
    await recordCommunicationEvents([
      { entity_id: campaignId, entity_type: "campaign", event_type: EVENT_TYPES[event], metadata: { campaign_id: campaignId }, user_id: userId }
    ]);

    return noStore(NextResponse.json({ data: { ok: true } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel registrar o evento do pop-up."));
  }
}
