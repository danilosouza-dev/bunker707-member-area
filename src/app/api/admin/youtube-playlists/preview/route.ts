import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import { jsonRouteError } from "@/server/http/route-errors";
import { readBoundedJson } from "@/server/http/bounded-json";
import { loadYouTubeCourseImportPreview } from "@/server/video/youtube-playlist-import";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<{ playlistUrl?: unknown }>(request, 4096);

    if (typeof payload.playlistUrl !== "string" || payload.playlistUrl.length > 500) {
      return NextResponse.json({ error: "Cole uma URL valida de playlist do YouTube." }, { status: 400 });
    }

    const data = await loadYouTubeCourseImportPreview(payload.playlistUrl);
    return NextResponse.json({ data }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return jsonRouteError(
      Object.assign(error instanceof Error ? error : new Error("Playlist invalida."), { status: 400 }),
      "Nao foi possivel ler a playlist."
    );
  }
}
