import { heartbeatBodySchema } from "@/server/webinars/chat-schemas";
import { loadRoomContext, webinarsDb } from "@/server/webinars/room-queries";
import { guardRoomRequest, ok, parseRoomBody, recordAfterReply, roomErrorResponse, type RouteContext } from "@/server/webinars/room-route";
import { recordStudentHeartbeat, type HeartbeatContext } from "@/server/webinars/room-writes";

// O sinal de presenca da Sala (docs/30 §5.1, §8.2 e D19): POST { sessionId, offsetSeconds, state, visible, leave? }
// a cada 15 s (e `leave: true` pelo sendBeacon ao sair, em text/plain). Sessao pelas claims do JWT
// (requireApiSessionUser, como /api/page-visits) e o acesso ao webinario conferido uma vez por aluno e sessao,
// guardado por 10 minutos na memoria do processo (um requireWebinarAccess por aluno e sessao, nao por sinal).
// Fica fora dos limites de escrita. Grava o balde de 30 s (na gravada o offset e o do servidor; no replay, o do
// player); o primeiro sinal depois de 90 s sem sinal grava webinar_joined e `leave` grava webinar_left. Responde
// { serverTime, offsetMs, ended, presentNow }.

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ACCESS_CACHE_MS = 10 * 60_000;
const ACCESS_CACHE_MAX = 20_000;

type CachedContext = { context: HeartbeatContext; expiresAt: number };

const accessCache = new Map<string, CachedContext>();

function remember(key: string, value: CachedContext) {
  accessCache.delete(key);
  while (accessCache.size >= ACCESS_CACHE_MAX) {
    const oldest = accessCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    accessCache.delete(oldest);
  }
  accessCache.set(key, value);
}

/** O contexto da sessao para este aluno, do cache (10 min) ou do banco (acesso conferido, sessao do webinario). */
async function contextFor(userId: string, webinarId: string, sessionId: string, now: number): Promise<HeartbeatContext> {
  const key = `${userId}:${webinarId}:${sessionId}`;
  const cached = accessCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.context;
  }
  const room = await loadRoomContext(webinarsDb(), userId, webinarId, sessionId, now);
  const context: HeartbeatContext = { durationMs: room.durationMs, recordingId: room.recording?.id ?? null, session: room.session };
  remember(key, { context, expiresAt: now + ACCESS_CACHE_MS });
  return context;
}

/** Zera o cache do acesso (testes). */
export function resetHeartbeatAccessCache() {
  accessCache.clear();
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
    const room = await contextFor(guarded.userId, guarded.webinarId, body.data.sessionId.toLowerCase(), now);
    const result = await recordStudentHeartbeat({ body: body.data, context: room, db: webinarsDb(), now, userAgent: request.headers.get("user-agent"), userId: guarded.userId });
    await recordAfterReply(result.events);
    return ok({ ended: result.ended, offsetMs: result.offsetMs, presentNow: result.presentNow, serverTime: result.serverTime });
  } catch (error) {
    return roomErrorResponse(error, "Não foi possível registrar a presença.");
  }
}
