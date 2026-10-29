import { questionBodySchema, questionsQuerySchema } from "@/server/webinars/chat-schemas";
import { listStudentQuestions, webinarsDb } from "@/server/webinars/room-queries";
import { badRequest, guardRoomRequest, loadRoomContextFor, offsetMsFieldSchema, ok, parseRoomBody, recordAfterReply, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";
import { askStudentQuestion } from "@/server/webinars/room-writes";

// A aba Perguntas (docs/30 §1.3, §5.1 e D22): GET ?sessao=&ordem=votadas|recentes lista as abertas e as respondidas
// (a dispensada so para o autor) com `mine` e `voted`; POST { sessionId, body, anonymous, offsetMs? } faz a pergunta
// (sem o aceite do chat, o corpo traz consent + consentVersion + displayMode, ou 409 consent_required; anonima com a
// opcao desligada 400; 2 por minuto por aluno e sessao: 429 com Retry-After; palavra bloqueada 422) e responde 201.
// Sessao obrigatoria; o teto global de 30 escritas por minuto; fora do acesso ou sessao de outro webinario: 404.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const postSchema = questionBodySchema.extend({ offsetMs: offsetMsFieldSchema });

export async function GET(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context);
  if ("response" in guarded) {
    return guarded.response;
  }

  const parsed = questionsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message);
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, parsed.data.sessao.toLowerCase());
    const questions = await listStudentQuestions(webinarsDb(), room.session, guarded.userId, parsed.data.ordem === "recentes" ? "recent" : "votes");
    return ok({ questions, serverTime: new Date().toISOString() });
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível ler as perguntas.");
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
    const result = await askStudentQuestion({ body: body.data, context: room, db: webinarsDb(), offsetMs: body.data.offsetMs, userId: guarded.userId });
    await recordAfterReply(result.events);
    return ok({ question: result.question }, 201);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível enviar a pergunta.");
  }
}
