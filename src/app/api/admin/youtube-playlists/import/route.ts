import { NextResponse } from "next/server";
import type { YouTubeCourseImportCommitInput } from "@/lib/youtube-course-import";
import { requireApiAdmin } from "@/server/auth/guards";
import { jsonRouteError } from "@/server/http/route-errors";
import { readBoundedJson } from "@/server/http/bounded-json";
import { importYouTubePlaylistAsCourse } from "@/server/video/youtube-playlist-import";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<Partial<YouTubeCourseImportCommitInput>>(request, 5_600_000);

    if (
      typeof payload.playlistUrl !== "string"
      || typeof payload.title !== "string"
      || typeof payload.description !== "string"
      || typeof payload.image !== "string"
      || typeof payload.accessModel !== "string"
      || typeof payload.coursePresentationMode !== "string"
      || typeof payload.organizationMode !== "string"
      || !Array.isArray(payload.moduleRanges)
    ) {
      return NextResponse.json({ error: "Dados da importacao incompletos." }, { status: 400 });
    }

    const result = await importYouTubePlaylistAsCourse(payload as YouTubeCourseImportCommitInput);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel importar a playlist.");
  }
}
