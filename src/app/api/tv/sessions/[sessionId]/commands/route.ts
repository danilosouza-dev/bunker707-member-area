import { NextResponse } from "next/server";

import { isTvPlaybackRate, type TvCommand } from "@/lib/tv-session-contract";
import { requireApiUser } from "@/server/auth/guards";
import { jsonRouteError } from "@/server/http/route-errors";
import { sendTvCommand } from "@/server/video/tv-sessions";

type RouteContext = { params: Promise<{ sessionId: string }> };

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

function parseCommand(payload: unknown): TvCommand | null {
  if (!payload || typeof payload !== "object" || !("type" in payload)) return null;
  const type = payload.type;

  if (type === "play" || type === "pause") return { type };
  if (
    type === "set_playback_rate" &&
    "playbackRate" in payload &&
    isTvPlaybackRate(payload.playbackRate)
  ) {
    return { playbackRate: payload.playbackRate, type };
  }
  if (
    type === "seek_relative" &&
    "seconds" in payload &&
    (payload.seconds === -10 || payload.seconds === 10)
  ) {
    return { seconds: payload.seconds, type };
  }
  if (
    type === "sync_player" &&
    "captionsEnabled" in payload &&
    typeof payload.captionsEnabled === "boolean" &&
    "currentTimeSeconds" in payload &&
    typeof payload.currentTimeSeconds === "number" &&
    Number.isFinite(payload.currentTimeSeconds) &&
    payload.currentTimeSeconds >= 0 &&
    payload.currentTimeSeconds <= 86_400 &&
    "muted" in payload &&
    typeof payload.muted === "boolean" &&
    "playbackRate" in payload &&
    isTvPlaybackRate(payload.playbackRate) &&
    "quality" in payload &&
    typeof payload.quality === "string" &&
    (payload.quality === "auto" || /^\d{2,5}p(?:\d{1,3})?(?: HDR)?$/.test(payload.quality)) &&
    "shouldPlay" in payload &&
    typeof payload.shouldPlay === "boolean" &&
    "volume" in payload &&
    typeof payload.volume === "number" &&
    Number.isFinite(payload.volume) &&
    payload.volume >= 0 &&
    payload.volume <= 100
  ) {
    return {
      captionsEnabled: payload.captionsEnabled,
      currentTimeSeconds: payload.currentTimeSeconds,
      muted: payload.muted,
      playbackRate: payload.playbackRate,
      quality: payload.quality,
      shouldPlay: payload.shouldPlay,
      type,
      volume: payload.volume
    };
  }

  return null;
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await requireApiUser();
  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const command = parseCommand(await request.json());
    if (!command) {
      return noStore(NextResponse.json({ error: "Comando de TV invalido." }, { status: 400 }));
    }

    const { sessionId } = await context.params;
    const session = await sendTvCommand(sessionId, auth.user.id, command);
    return noStore(NextResponse.json({ data: { session } }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel controlar a TV."));
  }
}
