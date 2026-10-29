import { issueJoinToken } from "@/server/webinars/live-room";
import { joinTokenBodySchema } from "@/server/webinars/live-schemas";
import { webinarsDb } from "@/server/webinars/room-queries";
import { guardRoomRequest, ok, parseRoomBody, recordAfterReply, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";

// O token da sala ao vivo (docs/30 §5.1, §5.4 e §8.1): POST { sessionId } devolve { jwt, room, domain, role,
// expiresAt, refreshAt, settings } (o nome da sala so aqui, nunca na URL; o navegador pede outro em `refreshAt`). So a
// sessao `live` (outra: 404), o aluno na espera ou no ar (409 not_started / ended), nunca removido desta sessao (409
// kicked) nem banido de todas (409 banned); a equipe tambem na Sessao de pratica. Papel e nome decididos no servidor
// (live-room.ts); o token nunca e guardado nem escrito em log. Sem a sala ao vivo neste ambiente: 503
// { reason: "meet_unconfigured" }. Sessao obrigatoria (401); conta no teto de 30 escritas por minuto; corpo de ate 4 KB;
// fora do acesso ou sessao de outro webinario: 404 sem dizer se existe; vaga obrigatoria (A12): 403. A primeira entrada
// da abertura grava webinar_joined depois da resposta.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context, { write: true });
  if ("response" in guarded) {
    return guarded.response;
  }

  const body = await parseRoomBody(request, joinTokenBodySchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const result = await issueJoinToken({
      db: webinarsDb(),
      sessionId: body.data.sessionId.toLowerCase(),
      userAgent: request.headers.get("user-agent"),
      userId: guarded.userId,
      webinarId: guarded.webinarId
    });
    await recordAfterReply(result.events);
    return ok(result.reply);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível abrir a sala.");
  }
}
