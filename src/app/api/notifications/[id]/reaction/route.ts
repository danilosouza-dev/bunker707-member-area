import { NextResponse } from "next/server";
import { requireApiSessionUser } from "@/server/auth/guards";
import { reactToNotification } from "@/server/communications/inbox";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { reactionBodySchema } from "@/server/communications/schemas";
import { STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS, takeStudentWrite } from "@/server/communications/student-write-limit";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

// Reacao do aluno numa notificacao (v3a, docs/24 §1.4): { reaction: "like" | "love" | ... | null } (null =
// tirar). Uma por aluno, so a propria; a mesma reacao nao muda nada. Conta como interacao (vista, lida e
// aberta). 409 quando a equipe nao permitiu reacoes; 404 quando a linha nao e do aluno ou nao aparece no
// sino. Sessao pelas claims do JWT; ate 30 escritas do aluno por minuto (429).

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

const INVALID_REACTION = "Reacao invalida.";

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

  let payload: unknown;

  try {
    payload = await readBoundedJson<unknown>(request, 1_000);
  } catch (error) {
    // Corpo grande demais continua 413; sem corpo ou JSON quebrado e so uma reacao invalida.
    const tooLarge = typeof error === "object" && error !== null && "status" in error && error.status === 413;

    return noStore(tooLarge ? jsonRouteError(error, INVALID_REACTION, 400) : NextResponse.json({ error: INVALID_REACTION }, { status: 400 }));
  }

  const parsed = reactionBodySchema.safeParse(payload);

  if (!parsed.success) {
    return noStore(NextResponse.json({ error: INVALID_REACTION }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;
    const notificationId = id.toLowerCase();
    const result = await reactToNotification(userId, notificationId, parsed.data.reaction);

    if (result.recordEvent) {
      await recordCommunicationEvents([
        {
          entity_id: notificationId,
          entity_type: "notification",
          event_type: "notification_reacted",
          metadata: { campaign_id: result.campaignId, reaction: result.reaction },
          user_id: userId
        }
      ]);
    }

    return noStore(NextResponse.json({ data: { reaction: result.reaction } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel registrar a reacao."));
  }
}
