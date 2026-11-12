import { NextResponse } from "next/server";
import { isUuid, noStore } from "@/server/communications/route-support";
import { questionLikeBodySchema } from "@/server/webinars/chat-schemas";
import { webinarsDb } from "@/server/webinars/room-queries";
import { guardRoomRequest, loadRoomContextFor, ok, parseRoomBody, roomErrorResponse } from "@/server/webinars/room-route";
import { likeStudentQuestionItem } from "@/server/webinars/room-writes";
import { WEBINARS_FEATURE } from "@/server/licensing/features";
import { licenseRouteRefusal } from "@/server/licensing/guards";

// Curtir / Tirar a curtida da resposta de uma pergunta (docs/30 §5.1 e D101): POST { sessionId, replyId? } alterna a
// curtida do aluno na resposta escrita da pergunta (sem `replyId`) ou numa resposta do fio e responde { liked, likes }.
// Pergunta de outra sessao, apagada ou dispensada de outro aluno, resposta apagada ou de outra pergunta: 404; fora da
// hora da sessao: 409; na live, removido ou banido 409 banned (o silenciado no chat curte); banco sem a 202611170001:
// 409 com o aviso. Sessao obrigatoria; o teto global de 30 escritas.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type LikeRouteContext = { params: Promise<{ id: string; qid: string }> };

export async function POST(request: Request, context: LikeRouteContext) {
  const licenseRefusal = await licenseRouteRefusal({ actionClass: "atendimento", feature: WEBINARS_FEATURE });
  if (licenseRefusal) return licenseRefusal;

  const guarded = await guardRoomRequest({ params: context.params.then(({ id }) => ({ id })) }, { write: true });
  if ("response" in guarded) {
    return guarded.response;
  }

  const { qid } = await context.params;
  if (!isUuid(qid)) {
    return noStore(NextResponse.json({ error: "Pergunta inválida." }, { status: 400 }));
  }

  const body = await parseRoomBody(request, questionLikeBodySchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, body.data.sessionId.toLowerCase());
    return ok(await likeStudentQuestionItem({ context: room, db: webinarsDb(), questionId: qid.toLowerCase(), replyId: body.data.replyId?.toLowerCase() ?? null, userId: guarded.userId }));
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível curtir a resposta.");
  }
}
