import { NextResponse } from "next/server";

import { requireApiUser } from "@/server/auth/guards";
import { getHeadersOrigin } from "@/server/auth/site-origin";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import { createTvSession } from "@/server/video/tv-sessions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.response || !auth.user) return noStore(auth.response!);

  try {
    const payload = await readBoundedJson<{
      contentId?: unknown;
      currentTimeSeconds?: unknown;
      durationSeconds?: unknown;
      lessonId?: unknown;
    }>(request, 16_000);
    const contentId = typeof payload.contentId === "string" ? payload.contentId.trim() : "";
    const lessonId = typeof payload.lessonId === "string" ? payload.lessonId.trim() : "";
    const currentTimeSeconds = typeof payload.currentTimeSeconds === "number" ? payload.currentTimeSeconds : undefined;
    const durationSeconds = typeof payload.durationSeconds === "number" ? payload.durationSeconds : undefined;

    if (
      !contentId ||
      !lessonId ||
      (currentTimeSeconds !== undefined && (!Number.isFinite(currentTimeSeconds) || currentTimeSeconds < 0)) ||
      (durationSeconds !== undefined && (!Number.isFinite(durationSeconds) || durationSeconds < 0))
    ) {
      return noStore(NextResponse.json({ error: "Dados da sessao de TV invalidos." }, { status: 400 }));
    }

    const session = await createTvSession({
      contentId,
      currentTimeSeconds,
      durationSeconds,
      lessonId,
      userId: auth.user.id
    });
    // Origem pelos cabecalhos: no servidor proprio o request.url vem com o endereco interno do container.
    const tvUrl = new URL("/tv", await getHeadersOrigin());
    tvUrl.searchParams.set("code", session.pairingCode);

    return noStore(NextResponse.json({
      data: {
        session,
        tvPath: "/tv",
        tvUrl: tvUrl.toString()
      }
    }, { status: 201 }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel iniciar o Modo TV."));
  }
}
