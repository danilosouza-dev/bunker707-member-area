import { NextResponse } from "next/server";
import { isUuid, noStore } from "@/server/communications/route-support";
import { questionVoteBodySchema } from "@/server/webinars/chat-schemas";
import { webinarsDb } from "@/server/webinars/room-queries";
import { guardRoomRequest, loadRoomContextFor, ok, parseRoomBody, roomErrorResponse } from "@/server/webinars/room-route";
import { voteStudentQuestion } from "@/server/webinars/room-writes";

// Curtir / Tirar a curtida de uma pergunta (docs/30 §5.1): POST { sessionId } alterna o voto do aluno e responde {
// upvotes, voted }. Pergunta de outra sessao, apagada ou dispensada de outro aluno: 404; fora da hora da sessao: 409;
// na live, removido ou banido 409 banned (o silenciado no chat curte). Sessao obrigatoria; o teto global de 30
// escritas.

export const dynamic = "force-dynamic";
export const revalidate = 0;

type VoteRouteContext = { params: Promise<{ id: string; qid: string }> };

export async function POST(request: Request, context: VoteRouteContext) {
  const guarded = await guardRoomRequest({ params: context.params.then(({ id }) => ({ id })) }, { write: true });
  if ("response" in guarded) {
    return guarded.response;
  }

  const { qid } = await context.params;
  if (!isUuid(qid)) {
    return noStore(NextResponse.json({ error: "Pergunta inválida." }, { status: 400 }));
  }

  const body = await parseRoomBody(request, questionVoteBodySchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, body.data.sessionId.toLowerCase());
    return ok(await voteStudentQuestion({ context: room, db: webinarsDb(), questionId: qid.toLowerCase(), userId: guarded.userId }));
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível curtir a pergunta.");
  }
}
