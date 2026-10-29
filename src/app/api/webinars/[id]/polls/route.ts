import { pollAnswerBodySchema, sessionQuerySchema } from "@/server/webinars/chat-schemas";
import { listStudentPolls, webinarsDb } from "@/server/webinars/room-queries";
import { badRequest, guardRoomRequest, loadRoomContextFor, offsetMsFieldSchema, ok, parseRoomBody, recordAfterReply, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";
import { answerStudentPoll } from "@/server/webinars/room-writes";

// As enquetes da Sala (docs/30 §1.3 e §5.1): GET ?sessao= devolve as abertas (com a resposta do aluno) e as
// encerradas com "Compartilhar resultado" (com as contagens); POST { sessionId, pollId, optionIds, offsetMs? }
// grava a resposta e responde 201 { poll }; a segunda resposta a mesma enquete e 409 (chave unica poll + aluno);
// enquete encerrada 409 { reason: "poll_closed" }. Sessao obrigatoria; o teto global de 30 escritas por minuto;
// fora do acesso ou sessao de outro webinario: 404.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const postSchema = pollAnswerBodySchema.extend({ offsetMs: offsetMsFieldSchema });

export async function GET(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context);
  if ("response" in guarded) {
    return guarded.response;
  }

  const parsed = sessionQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success || !parsed.data.sessao) {
    return badRequest(parsed.success ? undefined : parsed.error.issues[0]?.message);
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, parsed.data.sessao.toLowerCase());
    return ok({ polls: await listStudentPolls(webinarsDb(), room.session, guarded.userId), serverTime: new Date().toISOString() });
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível ler as enquetes.");
  }
}

export async function POST(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context, { write: true });
  if ("response" in guarded) {
    return guarded.response;
  }

  const body = await parseRoomBody(request, postSchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, body.data.sessionId.toLowerCase());
    const result = await answerStudentPoll({ context: room, db: webinarsDb(), offsetMs: body.data.offsetMs, optionIds: body.data.optionIds, pollId: body.data.pollId.toLowerCase(), userId: guarded.userId });
    await recordAfterReply(result.events);
    return ok({ poll: result.poll }, 201);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível responder a enquete.");
  }
}
