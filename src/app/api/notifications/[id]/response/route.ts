import { NextResponse } from "next/server";
import { requireApiSessionUser } from "@/server/auth/guards";
import { respondToNotification } from "@/server/communications/inbox";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS, takeStudentWrite } from "@/server/communications/student-write-limit";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

// "Aceitar" ou "Recusar" num aviso que pede resposta, tambem para mudar a resposta enquanto a notificacao
// estiver no sino (v3a, docs/24 §1.5): { response }. Devolve { changed, response }; a mesma resposta nao
// muda nada. Sessao pelas claims do JWT; ate 30 escritas do aluno por minuto (429).

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

const INVALID_RESPONSE = "Resposta invalida.";

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiSessionUser();

  if (auth.response || !auth.user) {
    return noStore(auth.response!);
  }

  if (!takeStudentWrite(auth.user.id)) {
    return noStore(
      NextResponse.json({ error: STUDENT_WRITE_LIMIT_MESSAGE }, { headers: { "Retry-After": String(STUDENT_WRITE_RETRY_AFTER_SECONDS) }, status: 429 })
    );
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return noStore(NextResponse.json({ error: "Notificacao invalida." }, { status: 400 }));
  }

  let payload: { response?: unknown };

  try {
    payload = await readBoundedJson<{ response?: unknown }>(request, 8_000);
  } catch (error) {
    // Corpo grande demais continua 413; sem corpo ou JSON quebrado e so uma resposta invalida.
    const tooLarge = typeof error === "object" && error !== null && "status" in error && error.status === 413;

    return noStore(tooLarge ? jsonRouteError(error, INVALID_RESPONSE, 400) : NextResponse.json({ error: INVALID_RESPONSE }, { status: 400 }));
  }

  const response = payload && typeof payload === "object" ? payload.response : undefined;

  if (response !== "accepted" && response !== "declined") {
    return noStore(NextResponse.json({ error: INVALID_RESPONSE }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;
    const notificationId = id.toLowerCase();
    const result = await respondToNotification(userId, notificationId, response);

    if (result.recordEvent) {
      await recordCommunicationEvents([
        {
          entity_id: notificationId,
          entity_type: "notification",
          event_type: "notification_responded",
          metadata: { campaign_id: result.campaignId, changed: result.changed, response },
          user_id: userId
        }
      ]);
    }

    return noStore(NextResponse.json({ data: { changed: result.changed, response } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel registrar a resposta."));
  }
}
