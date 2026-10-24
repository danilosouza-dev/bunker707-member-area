import { NextResponse } from "next/server";
import { requireApiSessionUser } from "@/server/auth/guards";
import { readNotificationCounts, recordNotificationAudio } from "@/server/communications/inbox";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { audioEventSchema } from "@/server/communications/schemas";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

// Audio do aviso no sino (docs/23): { event: "started" } no primeiro play (visto, lido, aberto e o comeco
// do audio; devolve tambem os contadores, porque substitui o POST /read {ids}) e { event: "progress",
// heard } com os 48 trechos ouvidos (somados por OU no banco: so cresce; 44 ou mais = ouvido). Escrita
// de telemetria, idempotente: sessao pelas claims do JWT (requireApiSessionUser, sem ida ao Auth).
// Aceita text/plain (o beacon da aba escondida e do painel fechando). 404 quando a linha nao e do aluno,
// nao aparece, ja saiu do sino ou o aviso nao tem audio (sem dizer se existe).

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiSessionUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return noStore(NextResponse.json({ error: "Notificacao invalida." }, { status: 400 }));
  }

  let payload: unknown;

  try {
    payload = await readBoundedJson<unknown>(request, 2_000);
  } catch (error) {
    // Corpo grande demais continua 413; sem corpo ou JSON quebrado e so um evento invalido.
    const tooLarge = typeof error === "object" && error !== null && "status" in error && error.status === 413;

    return noStore(tooLarge ? jsonRouteError(error, "Evento invalido.", 400) : NextResponse.json({ error: "Evento invalido." }, { status: 400 }));
  }

  const parsed = audioEventSchema.safeParse(payload);

  if (!parsed.success) {
    return noStore(NextResponse.json({ error: "Evento invalido." }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;
    const notificationId = id.toLowerCase();
    const recorded = await recordNotificationAudio(userId, notificationId, parsed.data);
    const events = [
      ...(recorded.startedNow ? ["notification_audio_started"] : []),
      ...(recorded.completedNow ? ["notification_audio_completed"] : [])
    ];

    await recordCommunicationEvents(
      events.map((eventType) => ({
        entity_id: notificationId,
        entity_type: "notification",
        event_type: eventType,
        metadata: { campaign_id: recorded.campaignId },
        user_id: userId
      }))
    );

    const counts = parsed.data.event === "started" ? await readNotificationCounts(userId) : null;

    return noStore(NextResponse.json({ data: { audioProgress: recorded.audioProgress, ...(counts ?? {}) } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel guardar o audio ouvido."));
  }
}
