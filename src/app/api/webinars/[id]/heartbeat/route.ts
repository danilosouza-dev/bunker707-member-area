import { heartbeatBodySchema } from "@/server/webinars/chat-schemas";
import { webinarsDb } from "@/server/webinars/room-queries";
import { guardRoomRequest, loadCachedRoomContext, ok, parseRoomBody, recordAfterReply, resetRoomAccessCache, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";
import { recordStudentHeartbeat } from "@/server/webinars/room-writes";

// O sinal de presenca da Sala (docs/30 §5.1, §8.2 e D19): POST { sessionId, offsetSeconds, state, visible, leave? }
// a cada 15 s (e `leave: true` pelo sendBeacon ao sair, em text/plain). Sessao pelas claims do JWT
// (requireApiSessionUser, como /api/page-visits) e o acesso ao webinario conferido uma vez por aluno e sessao,
// guardado por 10 minutos na memoria do processo (loadCachedRoomContext; na live a sessao e relida a cada 10 s).
// Fica fora dos limites de escrita. Grava o balde de 30 s (na gravada o offset e o do servidor; na live, desde o
// inicio de verdade; no replay, o do player); o primeiro sinal depois de 90 s sem sinal grava webinar_joined (na live
// quem grava e o join-token) e `leave` grava webinar_left. Responde { serverTime, offsetMs, ended, presentNow }.

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Zera o cache do acesso (testes). */
export function resetHeartbeatAccessCache() {
  resetRoomAccessCache();
}

export async function POST(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context, { session: "claims" });
  if ("response" in guarded) {
    return guarded.response;
  }

  const body = await parseRoomBody(request, heartbeatBodySchema);
  if ("response" in body) {
    return body.response;
  }

  try {
    const now = Date.now();
    const room = await loadCachedRoomContext(guarded.userId, guarded.webinarId, body.data.sessionId.toLowerCase(), now);
    const result = await recordStudentHeartbeat({
      body: body.data,
      context: { durationMs: room.durationMs, recordingId: room.recording?.id ?? null, session: room.session },
      db: webinarsDb(),
      now,
      userAgent: request.headers.get("user-agent"),
      userId: guarded.userId
    });
    await recordAfterReply(result.events);
    return ok({ ended: result.ended, offsetMs: result.offsetMs, presentNow: result.presentNow, serverTime: result.serverTime });
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível registrar a presença.");
  }
}
