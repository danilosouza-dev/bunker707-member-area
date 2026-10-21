import { NextResponse } from "next/server";
import { requireApiSessionUser } from "@/server/auth/guards";
import { setNotificationHidden } from "@/server/communications/inbox";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { hideBodySchema } from "@/server/communications/schemas";
import { STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS, takeStudentWrite } from "@/server/communications/student-write-limit";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

// "Excluir notificação" do proprio sino e o "Desfazer" (v3a, docs/24 §1.3): { hidden: true | false }. Some
// so para este aluno: da lista, dos numeros, do "Marcar todas" e do "abriu o sino"; continua "recebeu"
// nos relatorios. Repetir e sucesso sem escrita. Devolve os numeros novos { unread, unseen }. Vale para
// avisos e para as notificacoes de comentario. Sessao pelas claims do JWT; ate 30 escritas do aluno por
// minuto (429).

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

const INVALID_REQUEST = "Pedido invalido.";

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
    // Corpo grande demais continua 413; sem corpo ou JSON quebrado e so um pedido invalido.
    const tooLarge = typeof error === "object" && error !== null && "status" in error && error.status === 413;

    return noStore(tooLarge ? jsonRouteError(error, INVALID_REQUEST, 400) : NextResponse.json({ error: INVALID_REQUEST }, { status: 400 }));
  }

  const parsed = hideBodySchema.safeParse(payload);

  if (!parsed.success) {
    return noStore(NextResponse.json({ error: INVALID_REQUEST }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;
    const notificationId = id.toLowerCase();
    const result = await setNotificationHidden(userId, notificationId, parsed.data.hidden);

    if (result.recordEvent) {
      await recordCommunicationEvents([
        {
          entity_id: notificationId,
          entity_type: "notification",
          event_type: "notification_hidden",
          metadata: { campaign_id: result.campaignId, hidden: result.hidden },
          user_id: userId
        }
      ]);
    }

    return noStore(NextResponse.json({ data: result.counts }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel atualizar a notificacao."));
  }
}
