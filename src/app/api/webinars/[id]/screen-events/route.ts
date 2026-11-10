import { webinarsDb } from "@/server/webinars/room-queries";
import { takeScreenEventBatch } from "@/server/webinars/room-limits";
import { guardRoomRequest, loadCachedRoomContext, ok, parseRoomBody, recordAfterReply, roomErrorResponse, tooMany, type RouteContext } from "@/server/webinars/room-route";
import { ROOM_LIMIT_MESSAGE } from "@/server/webinars/room-writes";
import { screenEventRows } from "@/server/webinars/screen-queries";
import { screenEventsBodySchema } from "@/server/webinars/screen-schemas";

// As metricas da Na tela (docs/30 §4.7 e §5.1; especificacao de 10/11/2026, §5.5 e §7): POST { sessionId, events:
// [{ displayId, name: "shown" | "clicked" | "closed", form: "stage" | "strip" | "vertical", target? }] } em lotes de
// ate 6 (lote maior, nome, forma ou alvo desconhecido: 400). O "viu" vai uma vez por aluno e exibicao, depois de 1 s
// com o item na tela e 0 a 5 s ao acaso; o clique e o fechar vao pelo sendBeacon (o corpo JSON em text/plain). Guarda
// como os sinais da sala ao vivo (room-events): sessao pelas claims do JWT e o acesso conferido uma vez por aluno e
// sessao (loadCachedRoomContext, sem consulta com a memoria quente); fora do teto global de escritas, com o limite
// proprio de 12 lotes por minuto por aluno e sessao (429 com Retry-After). So a Live ao vivo e a gravada (o Replay: 404).
// Cada displayId precisa ser uma exibicao de banner ou QR Code daquela sessao (screen-queries.screenEventRows: os ids
// ficam 30 s na memoria; o desconhecido rele no maximo uma vez a cada 5 s e, continuando desconhecido, sai em
// silencio). Responde 202 { accepted } e grava em student_events depois da resposta (entity_type 'webinar', entity_id
// = a sessao; event_type webinar_screen_shown / _clicked / _closed; metadata { display_id, item_id, kind, form, target,
// offset_ms }, o offset pelo relogio do servidor). O clique e um link comum: nao ha rota de redirecionamento.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: Request, context: RouteContext) {
  const guarded = await guardRoomRequest(context, { session: "claims" });
  if ("response" in guarded) {
    return guarded.response;
  }

  const body = await parseRoomBody(request, screenEventsBodySchema);
  if ("response" in body) {
    return body.response;
  }

  const sessionId = body.data.sessionId.toLowerCase();
  const now = Date.now();
  const batch = takeScreenEventBatch(guarded.userId, sessionId, now);
  if (!batch.ok) {
    return tooMany(ROOM_LIMIT_MESSAGE, batch.retryAfterSeconds);
  }

  try {
    const room = await loadCachedRoomContext(guarded.userId, guarded.webinarId, sessionId, now);
    const events = await screenEventRows({ db: webinarsDb(), events: body.data.events, nowMs: now, session: room.session, userId: guarded.userId });
    await recordAfterReply(events);
    return ok({ accepted: events.length }, 202);
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível registrar o que apareceu na tela.");
  }
}
