import { NextResponse } from "next/server";
import { isUuid, noStore } from "@/server/communications/route-support";
import { questionReplyBodySchema } from "@/server/webinars/chat-schemas";
import { webinarsDb } from "@/server/webinars/room-queries";
import { guardRoomRequest, loadRoomContextFor, ok, parseRoomBody, recordAfterReply, roomErrorResponse } from "@/server/webinars/room-route";
import { replyStudentQuestion } from "@/server/webinars/room-writes";

// O fio de uma pergunta (docs/30 §1.3 e §5.1; decisao do produtor de 10/11/2026): POST { sessionId, body } grava a
// resposta do aluno no fio da propria pergunta e responde { reply } (201). So quem perguntou (403 para os outros) e so
// depois de a equipe responder (409); pergunta de outra sessao, apagada ou dispensada de outro aluno: 404; fora da hora
// da sessao 409; na live, removido, banido ou silenciado no chat 409; sem o aceite do chat em dia 409 consent_required
// (o corpo pode trazer o aceite, como a primeira pergunta); 5 por 60 s (429); palavra bloqueada 422. Sessao
// obrigatoria; o teto global de 30 escritas. O historico (`webinar_question_reply_sent`, sem o texto) vai depois da
// resposta.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ReplyRouteContext = { params: Promise<{ id: string; qid: string }> };

export async function POST(request: Request, context: ReplyRouteContext) {
  const guarded = await guardRoomRequest({ params: context.params.then(({ id }) => ({ id })) }, { write: true });
  if ("response" in guarded) {
    return guarded.response;
  }

  const { qid } = await context.params;
  if (!isUuid(qid)) {
    return noStore(NextResponse.json({ error: "Pergunta inválida." }, { status: 400 }));
  }

  const body = await parseRoomBody(request, questionReplyBodySchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, body.data.sessionId.toLowerCase());
    const result = await replyStudentQuestion({ body: body.data, context: room, db: webinarsDb(), questionId: qid.toLowerCase(), userId: guarded.userId });
    await recordAfterReply(result.events);
    return ok({ reply: result.reply }, 201);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível enviar a resposta.");
  }
}
