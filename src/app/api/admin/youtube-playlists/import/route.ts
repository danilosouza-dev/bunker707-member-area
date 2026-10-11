import { NextResponse } from "next/server";
import type { YouTubeCourseImportCommitInput } from "@/lib/youtube-course-import";
import { requireApiRole } from "@/server/auth/permissions";
import { invalidateCatalog } from "@/server/catalog/cache";
import { jsonRouteError } from "@/server/http/route-errors";
import { readBoundedJson } from "@/server/http/bounded-json";
import { importYouTubePlaylistAsCourse } from "@/server/video/youtube-playlist-import";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await requireApiRole("catalog.write");

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
    invalidateCatalog({ from: "route" });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel importar a playlist.");
  }
}
