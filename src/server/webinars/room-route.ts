// O que toda rota da Sala repete (docs/30 §5.1 e §8.2): sessao obrigatoria (401), o teto global de escritas do
// aluno (429 com Retry-After), o id do webinario (400), o corpo em JSON de ate 4 KB (413/400), a sessao do corpo ou
// de ?sessao= conferida contra o webinario (404), as recusas (409 { reason }) e os limites da sala (429), o historico
// gravado depois da resposta (after() do Next; fora de um pedido, na hora) e a resposta sem cache. As rotas so
// montam a conversa; as regras ficam em room-queries.ts e room-writes.ts.

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
import { webinarsDb } from "./db";
import { CHAT_LIMITS } from "./model";
import { loadRoomContext, type RoomContext } from "./room-queries";
import { RoomLimitError, RoomRefusedError } from "./room-writes";

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

/** As falhas das escritas da sala: 409 { reason } fora da hora ou do modo, 429 com Retry-After nos limites, o resto pelo status. */
export function roomErrorResponse(error: unknown, fallback: string) {
  if (error instanceof RoomRefusedError) {
    return noStore(NextResponse.json({ asOf: new Date().toISOString(), error: error.message, reason: error.reason }, { status: 409 }));
  }
  if (error instanceof RoomLimitError) {
    return tooMany(error.message, error.retryAfterSeconds);
  }
  return noStore(jsonRouteError(error, fallback));
}
