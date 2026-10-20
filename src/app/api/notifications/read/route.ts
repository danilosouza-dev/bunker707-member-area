import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { markAllSeen, markRead, readNotificationCounts } from "@/server/communications/inbox";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

// Sino do aluno: { seen: true } = abriu o sino (o numero zera, as bolinhas ficam); { ids: [...] } =
// marcou essas como lidas; { all: true } = "Marcar todas como lidas". Devolve os contadores novos.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_IDS = 50;

type ReadPayload = { all?: unknown; ids?: unknown; seen?: unknown };

export async function POST(request: Request) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  let payload: ReadPayload;

  try {
    payload = await readBoundedJson<ReadPayload>(request, 8_000);
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel ler o pedido.", 400));
  }

  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const ids = Array.isArray(body.ids) ? body.ids : null;

  if (ids && (ids.length === 0 || ids.length > MAX_IDS || !ids.every(isUuid))) {
    return noStore(NextResponse.json({ error: "Notificacao invalida." }, { status: 400 }));
  }

  if (!ids && body.seen !== true && body.all !== true) {
    return noStore(NextResponse.json({ error: "Pedido invalido." }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;

    if (ids) {
      const unique = Array.from(new Set(ids.map((id) => id.toLowerCase())));
      await markRead(userId, unique);
      await recordCommunicationEvents(
        unique.map((id) => ({ entity_id: id, entity_type: "notification", event_type: "notification_read", metadata: { notification_id: id }, user_id: userId }))
      );
    } else if (body.all === true) {
      await markRead(userId, "all");
      await recordCommunicationEvents([{ entity_type: "notification", event_type: "notification_read", metadata: { all: true }, user_id: userId }]);
    } else {
      await markAllSeen(userId);
    }

    return noStore(NextResponse.json({ data: await readNotificationCounts(userId) }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel atualizar as notificacoes."));
  }
}
