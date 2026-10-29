import { recordRoomEvents } from "@/server/webinars/live-room";
import { roomEventsBodySchema } from "@/server/webinars/live-schemas";
import { webinarsDb } from "@/server/webinars/room-queries";
import { takeRoomEventBatch } from "@/server/webinars/room-limits";
import { guardRoomRequest, loadCachedRoomContext, ok, parseRoomBody, recordAfterReply, roomErrorResponse, tooMany, type RouteContext } from "@/server/webinars/room-route";
import { ROOM_LIMIT_MESSAGE } from "@/server/webinars/room-writes";

// Os sinais do iframe da sala ao vivo (docs/30 §4.7, §5.1 e §6.3): POST { sessionId, events: [{ name, at, data }] } em
// lotes de ate 20 (nomes fixos de ROOM_EVENT_NAMES; lote maior ou nome desconhecido: 400). Cada sinal vira uma linha
// em student_events (entity_type `webinar`, entity_id = a sessao) so com codigos (webinar_room_joined, webinar_room_left,
// webinar_hand_raised, webinar_mic_toggled, webinar_camera_toggled, webinar_room_role, webinar_room_error), com `at` e
// `offset_ms`; recordingStatusChanged nao vira registro. Guarda como o heartbeat: sessao pelas claims do JWT e o acesso
// conferido uma vez por aluno e sessao (loadCachedRoomContext); fora do teto global de escritas, com o limite proprio
// de 6 lotes por minuto por aluno e sessao (429 com Retry-After). So a sessao `live` (outra: 404), em espera ou no ar
// (409 not_started / ended) e de quem nao foi removido nem banido (409 banned). Responde 202 { accepted } e grava
// depois da resposta.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context, { session: "claims" });
  if ("response" in guarded) {
    return guarded.response;
  }

  const body = await parseRoomBody(request, roomEventsBodySchema);
  if ("response" in body) {
    return body.response;
  }

  const sessionId = body.data.sessionId.toLowerCase();
  const now = Date.now();
  const batch = takeRoomEventBatch(guarded.userId, sessionId, now);
  if (!batch.ok) {
    return tooMany(ROOM_LIMIT_MESSAGE, batch.retryAfterSeconds);
  }

  try {
    const room = await loadCachedRoomContext(guarded.userId, guarded.webinarId, sessionId, now);
    const events = await recordRoomEvents({ context: room, db: webinarsDb(), events: body.data.events, now, userId: guarded.userId });
    await recordAfterReply(events);
    return ok({ accepted: events.length }, 202);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível registrar os sinais da sala.");
  }
}
