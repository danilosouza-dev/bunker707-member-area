import { NextResponse } from "next/server";

import { isTvPlaybackRate } from "@/lib/tv-session-contract";
import { jsonRouteError } from "@/server/http/route-errors";
import {
  getTvReceiverSession,
  updateTvReceiverState,
  type TvPlaybackState
} from "@/server/video/tv-sessions";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Authorization");
  return response;
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
}

function isPlaybackState(value: unknown): value is TvPlaybackState {
  return value === "buffering" || value === "ended" || value === "paused" || value === "playing" || value === "unstarted";
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { sessionId } = await context.params;
    const includeLesson = new URL(request.url).searchParams.get("includeLesson") === "1";
    const data = await getTvReceiverSession(sessionId, getBearerToken(request), includeLesson);
    return noStore(NextResponse.json({ data }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel sincronizar a TV."));
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const payload = await request.json() as {
      appliedCommandRevision?: unknown;
      availablePlaybackRates?: unknown;
      currentTimeSeconds?: unknown;
      durationSeconds?: unknown;
      playbackRate?: unknown;
      playbackState?: unknown;
    };

    if (
      typeof payload.appliedCommandRevision !== "number" ||
      !Number.isFinite(payload.appliedCommandRevision) ||
      payload.appliedCommandRevision < 0 ||
      !Array.isArray(payload.availablePlaybackRates) ||
      payload.availablePlaybackRates.length < 1 ||
      payload.availablePlaybackRates.length > 8 ||
      !payload.availablePlaybackRates.every(isTvPlaybackRate) ||
      new Set(payload.availablePlaybackRates).size !== payload.availablePlaybackRates.length ||
      typeof payload.currentTimeSeconds !== "number" ||
      !Number.isFinite(payload.currentTimeSeconds) ||
      payload.currentTimeSeconds < 0 ||
      typeof payload.durationSeconds !== "number" ||
      !Number.isFinite(payload.durationSeconds) ||
      payload.durationSeconds < 0 ||
      !isTvPlaybackRate(payload.playbackRate) ||
      !isPlaybackState(payload.playbackState)
    ) {
      return noStore(NextResponse.json({ error: "Estado de reproducao invalido." }, { status: 400 }));
    }

    const { sessionId } = await context.params;
    const session = await updateTvReceiverState({
      appliedCommandRevision: payload.appliedCommandRevision,
      availablePlaybackRates: payload.availablePlaybackRates,
      currentTimeSeconds: payload.currentTimeSeconds,
      durationSeconds: payload.durationSeconds,
      playbackRate: payload.playbackRate,
      playbackState: payload.playbackState,
      receiverToken: getBearerToken(request),
      sessionId
    });
    return noStore(NextResponse.json({ data: { session } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel salvar a reproducao da TV."));
  }
}
