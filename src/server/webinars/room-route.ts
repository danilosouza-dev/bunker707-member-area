// O que toda rota da Sala repete (docs/30 §5.1 e §8.2): sessao obrigatoria (401), o teto global de escritas do
// aluno (429 com Retry-After), o id do webinario (400), o corpo em JSON de ate 4 KB (413/400), a sessao do corpo ou
// de ?sessao= conferida contra o webinario (404), as recusas (409 { reason }), os limites da sala (429) e a sala ao
// vivo fora deste ambiente (503 { reason: "meet_unconfigured" }), o historico gravado depois da resposta (after() do
// Next; fora de um pedido, na hora) e a resposta sem cache. Os sinais frequentes (presenca e sinais do iframe) usam o
// acesso conferido uma vez por aluno e sessao e guardado por 10 minutos (loadCachedRoomContext), com a sessao `live`
// relida a cada 10 s (a situacao e o inicio mudam durante a live). As rotas so montam a conversa; as regras ficam em
// room-queries.ts, room-writes.ts e live-room.ts.

import "server-only";

import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSessionUser, requireApiUser } from "../auth/guards";
import { isUuid, noStore, recordCommunicationEvents } from "../communications/route-support";
import { STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS, takeStudentWrite } from "../communications/student-write-limit";
import { readBoundedJson } from "../http/bounded-json";
import { jsonRouteError } from "../http/route-errors";
import type { StudentEventInsert } from "../students/store";
import { CHAT_MESSAGES } from "./chat-schemas";
import { WebinarError, webinarsDb } from "./db";
import { LiveRoomUnavailableError, loadRoomSignalContext } from "./live-room";
import { CHAT_LIMITS } from "./model";
import { INVALID_SESSION_MESSAGE, loadRoomContext, type RoomContext } from "./room-queries";
import { RoomLimitError, RoomRefusedError } from "./room-writes";
import { sessionFromRow } from "./rows";
import { fetchSessionRow } from "./store";

export const ROOM_BODY_BYTES = 4_000;
export const INVALID_REQUEST: string = CHAT_MESSAGES.invalid;
export const INVALID_WEBINAR = "Webinário inválido.";

export type RouteContext = { params: Promise<{ id: string }> };

/** A posicao do player no replay (o corpo traz; na gravada o servidor ignora e usa o relogio). */
export const offsetMsFieldSchema = z.number().int().min(CHAT_LIMITS.offsetMinMs).max(CHAT_LIMITS.offsetMaxMs).optional();

export type Guarded = { response: NextResponse } | { userId: string; webinarId: string };

/** Sessao (401), teto de escritas quando `write` (429), id do webinario (400). */
export async function guardRoomRequest(context: RouteContext, options: { session?: "auth" | "claims"; write?: boolean } = {}): Promise<Guarded> {
  const auth = options.session === "claims" ? await requireApiSessionUser() : await requireApiUser();

  if (auth.response || !auth.user) {
    return { response: noStore(auth.response!) };
  }

  if (options.write && !takeStudentWrite(`webinar:${auth.user.id}`)) {
    return { response: tooMany(STUDENT_WRITE_LIMIT_MESSAGE, STUDENT_WRITE_RETRY_AFTER_SECONDS) };
  }

  const { id } = await context.params;

  if (!isUuid(id)) {
    return { response: noStore(NextResponse.json({ error: INVALID_WEBINAR }, { status: 400 })) };
  }

  return { userId: auth.user.id, webinarId: id.toLowerCase() };
}

export function tooMany(message: string, retryAfterSeconds: number) {
  return noStore(NextResponse.json({ error: message }, { headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) }, status: 429 }));
}

export function badRequest(message: string = INVALID_REQUEST) {
  return noStore(NextResponse.json({ error: message }, { status: 400 }));
}

export function ok(data: unknown, status = 200) {
  return noStore(NextResponse.json({ data }, { status }));
}

/** O corpo em JSON (ate 4 KB); sem corpo, um objeto vazio. */
export async function readRoomBody(request: Request): Promise<unknown> {
  if (!request.body || request.headers.get("content-length") === "0") {
    return {};
  }
  return readBoundedJson<unknown>(request, ROOM_BODY_BYTES);
}

/** O corpo lido e validado; devolve a resposta de erro (400/413) quando nao passa. */
export async function parseRoomBody<T>(request: Request, schema: z.ZodType<T>): Promise<{ data: T } | { response: NextResponse }> {
  let payload: unknown;
  try {
    payload = await readRoomBody(request);
  } catch (error) {
    return { response: noStore(jsonRouteError(error, INVALID_REQUEST, 400)) };
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return { response: badRequest(parsed.error.issues[0]?.message ?? INVALID_REQUEST) };
  }
  return { data: parsed.data };
}

/** ?sessao= (ou o sessionId do corpo) conferido e em minusculas; invalido = 400. */
export function sessionIdOf(request: Request, fallback?: string | null): { sessionId: string } | { response: NextResponse } {
  const raw = new URL(request.url).searchParams.get("sessao") ?? fallback ?? null;
  if (!isUuid(raw)) {
    return { response: badRequest(CHAT_MESSAGES.session) };
  }
  return { sessionId: raw.toLowerCase() };
}

/** O contexto da sessao do webinario para este aluno (404 fora do acesso ou sessao de outro webinario). */
export async function loadRoomContextFor(userId: string, webinarId: string, sessionId: string, now = Date.now()): Promise<RoomContext> {
  return loadRoomContext(webinarsDb(), userId, webinarId, sessionId, now);
}

/** Quanto o acesso conferido vale na memoria do processo (um requireWebinarAccess por aluno e sessao, nao por sinal). */
export const ROOM_ACCESS_CACHE_MS = 10 * 60_000;
/** A sessao `live` guardada e relida depois disto (espera -> no ar -> encerrada, started_at e a ancora). */
export const LIVE_SESSION_REFRESH_MS = 10_000;
const ROOM_ACCESS_CACHE_MAX = 20_000;

/** O que os sinais frequentes usam do contexto (sem a lista de sessoes do webinario: menos memoria por aluno). */
export type RoomSignalContext = Pick<RoomContext, "durationMs" | "recording" | "session" | "webinar">;

type CachedRoom = { checkedAt: number; context: RoomSignalContext; expiresAt: number };

const roomAccessCache = new Map<string, CachedRoom>();

function rememberRoom(key: string, value: CachedRoom) {
  roomAccessCache.delete(key);
  while (roomAccessCache.size >= ROOM_ACCESS_CACHE_MAX) {
    const oldest = roomAccessCache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    roomAccessCache.delete(oldest);
  }
  roomAccessCache.set(key, value);
}

/**
 * O contexto da sessao para os sinais frequentes (presenca a cada 15 s, sinais do iframe): do cache (10 min) ou do
 * banco (acesso conferido, sessao do webinario, vaga obrigatoria; na live a equipe passa sem a vaga). Na sessao `live` a linha da sessao e relida quando
 * o que esta guardado tem mais de 10 s (uma leitura pela chave), para a presenca e os sinais seguirem a situacao, o
 * inicio de verdade e a ancora de agora; a sessao que sumiu ou mudou de webinario sai do cache e responde 404.
 */
export async function loadCachedRoomContext(userId: string, webinarId: string, sessionId: string, now = Date.now()): Promise<RoomSignalContext> {
  const key = `${userId}:${webinarId}:${sessionId}`;
  const cached = roomAccessCache.get(key);
  if (cached && cached.expiresAt > now) {
    if (cached.context.session.kind !== "live" || now - cached.checkedAt < LIVE_SESSION_REFRESH_MS) {
      return cached.context;
    }
    const row = await fetchSessionRow(webinarsDb(), sessionId);
    if (!row || row.webinar_id !== webinarId) {
      roomAccessCache.delete(key);
      throw new WebinarError(INVALID_SESSION_MESSAGE, 404);
    }
    const context: RoomSignalContext = { ...cached.context, session: sessionFromRow(row) };
    rememberRoom(key, { checkedAt: now, context, expiresAt: cached.expiresAt });
    return context;
  }
  const { durationMs, recording, session, webinar } = await loadRoomSignalContext(webinarsDb(), { nowMs: now, sessionId, userId, webinarId });
  const context: RoomSignalContext = { durationMs, recording, session, webinar };
  rememberRoom(key, { checkedAt: now, context, expiresAt: now + ROOM_ACCESS_CACHE_MS });
  return context;
}

/** Zera o acesso guardado (testes). */
export function resetRoomAccessCache() {
  roomAccessCache.clear();
}

/** Depois da resposta (after() do Next); fora de um pedido do Next (testes, scripts), na hora. */
export async function afterReply(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    await task();
  }
}

/** Grava o historico depois da resposta (nunca muda a resposta: falha vira log). */
export async function recordAfterReply(events: readonly StudentEventInsert[]) {
  if (events.length === 0) {
    return;
  }
  await afterReply(() => recordCommunicationEvents([...events]));
}

/**
 * As falhas das escritas da sala: 409 { reason } fora da hora ou do modo (e os banimentos da live), 429 com Retry-After
 * nos limites, 503 { reason: "meet_unconfigured" } sem a sala ao vivo neste ambiente, o resto pelo status.
 */
export function roomErrorResponse(error: unknown, fallback: string) {
  if (error instanceof LiveRoomUnavailableError) {
    return noStore(NextResponse.json({ error: error.message, reason: error.reason }, { status: 503 }));
  }
  if (error instanceof RoomRefusedError) {
    return noStore(NextResponse.json({ asOf: new Date().toISOString(), error: error.message, reason: error.reason }, { status: 409 }));
  }
  if (error instanceof RoomLimitError) {
    return tooMany(error.message, error.retryAfterSeconds);
  }
  return noStore(jsonRouteError(error, fallback));
}
