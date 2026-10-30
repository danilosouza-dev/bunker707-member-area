import { reactionBodySchema, reactionsQuerySchema } from "@/server/webinars/chat-schemas";
import { recentReactionCounts, webinarsDb } from "@/server/webinars/room-queries";
import { badRequest, guardRoomRequest, loadRoomContextFor, offsetMsFieldSchema, ok, parseRoomBody, recordAfterReply, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";
import { sendStudentReaction } from "@/server/webinars/room-writes";

// As reacoes da Sala (docs/30 §5.1 e D16): POST { sessionId, reaction, offsetMs? } grava uma reacao (no maximo 1 por
// segundo e 20 por minuto por aluno e sessao, contadas no banco: 429 com Retry-After; na live, removido ou banido 409
// banned, o silenciado no chat reage) e responde 201; GET ?sessao=&since= devolve as contagens por reacao dos ultimos
// 10 s para a animacao. Sessao obrigatoria; o teto global de 30 escritas por minuto; fora do acesso ou sessao de outro
// webinario: 404.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const postSchema = reactionBodySchema.extend({ offsetMs: offsetMsFieldSchema });

export async function GET(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context);
  if ("response" in guarded) {
    return guarded.response;
  }

  const parsed = reactionsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message);
  }

  try {
    const room = await loadRoomContextFor(guarded.userId, guarded.webinarId, parsed.data.sessao.toLowerCase());
    return ok(await recentReactionCounts(webinarsDb(), room.session, parsed.data.since ?? null));
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível ler as reações.");
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
    const result = await sendStudentReaction({ context: room, db: webinarsDb(), offsetMs: body.data.offsetMs, reaction: body.data.reaction, userId: guarded.userId });
    await recordAfterReply(result.events);
    return ok({ offsetMs: result.offsetMs, reaction: result.reaction }, 201);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível reagir.");
  }
}
