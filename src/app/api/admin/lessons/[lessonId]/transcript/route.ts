import { NextResponse } from "next/server";

import { processLessonAIProfile } from "@/server/ai/lesson-profile";
import {
  getLessonTranscriptStatus,
  normalizeManualTranscript,
  saveLessonTranscript,
  TranscriptError,
  type TranscriptFormat
} from "@/server/ai/transcripts";
import { requireApiRole } from "@/server/auth/permissions";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";

type RouteContext = { params: Promise<{ lessonId: string }> };

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const revalidate = 0;

function noStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

async function readManualTranscript(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    const language = String(form.get("language") ?? "pt-BR");

    if (!(file instanceof File)) throw new TranscriptError("Selecione um arquivo de transcricao.");
    if (file.size > 2_000_000) throw new TranscriptError("O arquivo ultrapassa o limite de 2 MB.", 413);
    const extension = file.name.split(".").pop()?.toLowerCase();

    if (!extension || !(["srt", "txt", "vtt"] as string[]).includes(extension)) {
      throw new TranscriptError("Envie um arquivo SRT, VTT ou TXT.");
    }

    return normalizeManualTranscript({
      format: extension as TranscriptFormat,
      language,
      source: "upload",
      text: await file.text()
    });
  }

  const payload = await readBoundedJson<{
    format?: unknown;
    language?: unknown;
    source?: unknown;
    text?: unknown;
  }>(request, 256_000);
  const format = typeof payload.format === "string" ? payload.format : "txt";

  if (!(["srt", "txt", "vtt"] as string[]).includes(format)) {
    throw new TranscriptError("Formato de transcricao invalido.");
  }

  if (typeof payload.text !== "string") throw new TranscriptError("Informe a transcricao da aula.");
  return normalizeManualTranscript({
    format: format as TranscriptFormat,
    language: typeof payload.language === "string" ? payload.language : "pt-BR",
    source: payload.source === "upload" ? "upload" : "paste",
    text: payload.text
  });
}

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireApiRole("admin.read");

  if (auth.response) return noStore(auth.response);
  const { lessonId } = await context.params;

  try {
    return noStore(NextResponse.json({ data: await getLessonTranscriptStatus(lessonId) }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel carregar a transcricao da aula."));
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await requireApiRole("catalog.write");

  if (auth.response || !auth.user) return noStore(auth.response!);
  const { lessonId } = await context.params;

  try {
    const transcript = await readManualTranscript(request);
    await saveLessonTranscript({ createdBy: auth.user.id, lessonId, transcript });
    let warning: string | undefined;

    try {
      await processLessonAIProfile(lessonId);
    } catch (error) {
      warning = error instanceof Error ? error.message : "A transcricao foi salva, mas a analise ainda nao foi concluida.";
    }

    return noStore(NextResponse.json({
      data: await getLessonTranscriptStatus(lessonId),
      ...(warning ? { warning } : {})
    }));
  } catch (error) {
    return noStore(jsonRouteError(error, "Nao foi possivel salvar a transcricao da aula."));
  }
}
