import { NextResponse } from "next/server";
import { requireApiUser } from "@/server/auth/guards";
import { markAllSeen, markRead, readNotificationCounts } from "@/server/communications/inbox";
import { parseNotificationsAsOf } from "@/server/communications/notification-model";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

// Sino do aluno: { seen: true } = abriu o sino (o numero zera, as bolinhas ficam); { ids: [...] } =
// abriu essas (lidas e abertas: cartao, "Ver mais"); { all: true } = "Marcar todas como lidas" (nunca
// conta como aberta). Devolve os contadores novos. Os dois de "todas" aceitam `asOf` (a hora do servidor
// que veio com a lista): so mexem no que ja aparecia naquela hora. asOf invalido, no futuro ou de mais
// de 90 dias e ignorado (tudo o que aparece agora). E `shown` (ate 50 ids): avisos que o painel mostrou e
// chegaram ha menos de 15 s, para as linhas de fluxo nessa folga contarem tambem (docs/23). Linha que
// ja saiu do sino (expires_at) nunca muda.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_IDS = 50;

type ReadPayload = { all?: unknown; asOf?: unknown; ids?: unknown; seen?: unknown; shown?: unknown };

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

  const shown = body.shown === undefined || ids ? [] : body.shown;

  if (!Array.isArray(shown) || shown.length > MAX_IDS || !shown.every(isUuid)) {
    return noStore(NextResponse.json({ error: "Notificacao invalida." }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;
    const asOf = parseNotificationsAsOf(body.asOf, Date.now());

    if (ids) {
      const unique = Array.from(new Set(ids.map((id) => id.toLowerCase())));
      await markRead(userId, unique);
      await recordCommunicationEvents(
        unique.map((id) => ({ entity_id: id, entity_type: "notification", event_type: "notification_read", metadata: { notification_id: id }, user_id: userId }))
      );
    } else if (body.all === true) {
      await markRead(userId, "all", { asOf, shown });
      await recordCommunicationEvents([{ entity_type: "notification", event_type: "notification_read", metadata: { all: true }, user_id: userId }]);
    } else {
      await markAllSeen(userId, { asOf, shown });
    }

    return noStore(NextResponse.json({ data: await readNotificationCounts(userId) }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel atualizar as notificacoes."));
  }
}
