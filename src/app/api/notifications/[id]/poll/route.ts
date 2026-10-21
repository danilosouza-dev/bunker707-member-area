import { NextResponse } from "next/server";
import { requireApiSessionUser } from "@/server/auth/guards";
import { voteOnNotificationPoll } from "@/server/communications/inbox";
import { isUuid, noStore, recordCommunicationEvents } from "@/server/communications/route-support";
import { pollVoteBodySchema } from "@/server/communications/schemas";
import { STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS, takeStudentWrite } from "@/server/communications/student-write-limit";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

// Voto na enquete da notificacao (v3a, docs/24 §1.6): { optionIds: [...] } (vazio = tirar o voto; uma
// opcao quando a enquete nao permite varias). Devolve { poll } como o aluno ve agora: o resultado so vem
// quando ele votou e a equipe deixou mostrar, sem os testes da equipe e nunca com nomes. 409 com a enquete
// encerrada; 404 quando a linha nao e do aluno, nao aparece no sino ou o aviso nao tem enquete. Sessao
// pelas claims do JWT; ate 30 escritas do aluno por minuto (429).

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

const INVALID_VOTE = "Voto invalido.";

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
    // Corpo grande demais continua 413; sem corpo ou JSON quebrado e so um voto invalido.
    const tooLarge = typeof error === "object" && error !== null && "status" in error && error.status === 413;

    return noStore(tooLarge ? jsonRouteError(error, INVALID_VOTE, 400) : NextResponse.json({ error: INVALID_VOTE }, { status: 400 }));
  }

  const parsed = pollVoteBodySchema.safeParse(payload);

  if (!parsed.success) {
    return noStore(NextResponse.json({ error: INVALID_VOTE }, { status: 400 }));
  }

  try {
    const userId = auth.user.id;
    const notificationId = id.toLowerCase();
    const result = await voteOnNotificationPoll(userId, notificationId, parsed.data.optionIds);

    if (result.recordEvent) {
      await recordCommunicationEvents([
        {
          entity_id: notificationId,
          entity_type: "notification",
          event_type: "notification_voted",
          metadata: { campaign_id: result.campaignId, option_ids: result.choice },
          user_id: userId
        }
      ]);
    }

    return noStore(NextResponse.json({ data: { poll: result.poll } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel registrar o voto."));
  }
}
