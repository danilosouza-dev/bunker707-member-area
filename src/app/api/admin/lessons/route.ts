import { NextResponse } from "next/server";
import { requireApiRole } from "@/server/auth/permissions";
import { invalidateCatalog } from "@/server/catalog/cache";
import { deleteLesson, reorderLessons, upsertLesson } from "@/server/db/platform-store";
import { readBoundedJson } from "@/server/http/bounded-json";
import { jsonRouteError } from "@/server/http/route-errors";
import type { LessonOrderInput, LessonWriteInput } from "@/server/db/platform-store";
import type { AdminReleaseRule } from "@/lib/platform-types";
import { normalizeLessonVideoConfig } from "@/lib/video-embed";
import { processLessonAIProfile } from "@/server/ai/lesson-profile";
import {
  getLessonTranscriptStatus,
  extractYouTubeVideoId,
  normalizeManualTranscript,
  prepareYouTubeTranscript,
  saveLessonTranscript,
  TranscriptError,
  type NormalizedTranscript,
  type TranscriptFormat
} from "@/server/ai/transcripts";

export const maxDuration = 60;

type LessonTranscriptPayload = {
  format?: unknown;
  language?: unknown;
  mode?: unknown;
  source?: unknown;
  text?: unknown;
};

export async function POST(request: Request) {
  const auth = await requireApiRole("catalog.write");

  if (auth.response || !auth.user) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<Partial<LessonWriteInput> & {
      releaseFixedDate?: string;
      releaseDelayUnit?: "horas" | "dias";
      releaseDelayValue?: string;
      releaseMode?: AdminReleaseRule["mode"];
      releaseRequirement?: string;
      transcript?: LessonTranscriptPayload;
    }>(request, 10_000_000);

    if (!payload.moduleId || !payload.title) {
      return NextResponse.json({ error: "Modulo e titulo da aula sao obrigatorios." }, { status: 400 });
    }

    const hasVideoInput = Object.prototype.hasOwnProperty.call(payload, "video");
    const normalizedVideo = payload.video == null ? null : normalizeLessonVideoConfig(payload.video);

    if (payload.video != null && !normalizedVideo) {
      return NextResponse.json({
        error: "Configuracao de video invalida. Use uma URL HTTPS ou um iframe HTTPS valido."
      }, { status: 400 });
    }

    const normalizedPayload = hasVideoInput ? { ...payload, video: normalizedVideo } : payload;

    const transcriptPayload = normalizedPayload.transcript;
    const transcriptMode = transcriptPayload?.mode;
    const currentTranscript = normalizedPayload.id ? await getLessonTranscriptStatus(normalizedPayload.id) : null;
    let preparedTranscript: NormalizedTranscript | null = null;

    if (transcriptMode === "manual") {
      const format = typeof transcriptPayload?.format === "string" ? transcriptPayload.format : "txt";

      if (!(["srt", "txt", "vtt"] as string[]).includes(format) || typeof transcriptPayload?.text !== "string") {
        throw new TranscriptError("Envie um arquivo SRT, VTT ou TXT, ou cole a transcricao da aula.");
      }

      preparedTranscript = normalizeManualTranscript({
        format: format as TranscriptFormat,
        language: typeof transcriptPayload.language === "string" ? transcriptPayload.language : "pt-BR",
        source: transcriptPayload.source === "upload" ? "upload" : "paste",
        text: transcriptPayload.text
      });
    } else if (
      transcriptMode === "youtube" ||
      !currentTranscript ||
      (
        currentTranscript.source === "youtube" &&
        extractYouTubeVideoId(normalizedPayload.video) !== currentTranscript.sourceVideoId
      )
    ) {
      preparedTranscript = await prepareYouTubeTranscript(
        normalizedPayload.video,
        typeof transcriptPayload?.language === "string" ? transcriptPayload.language : "pt"
      );
    }

    const result = await upsertLesson({
      ...normalizedPayload,
      releaseRule: normalizedPayload.releaseMode
        ? {
            delayUnit: normalizedPayload.releaseDelayUnit,
            delayValue: normalizedPayload.releaseDelayValue,
            fixedDate: normalizedPayload.releaseFixedDate,
            mode: normalizedPayload.releaseMode,
            requirement: normalizedPayload.releaseRequirement
          }
        : normalizedPayload.releaseRule
    } as LessonWriteInput);
    invalidateCatalog({ from: "route" });

    if (preparedTranscript) {
      await saveLessonTranscript({
        createdBy: auth.user.id,
        lessonId: result.lessonId,
        transcript: preparedTranscript
      });
    }

    let warning: string | undefined;

    if (preparedTranscript) {
      try {
        await processLessonAIProfile(result.lessonId);
      } catch (error) {
        warning = error instanceof Error ? error.message : "A transcricao foi salva, mas a analise ainda nao foi concluida.";
      }
    }

    return NextResponse.json({
      data: result.data,
      transcript: await getLessonTranscriptStatus(result.lessonId),
      ...(warning ? { warning } : {})
    });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel salvar a aula.");
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiRole("catalog.write");

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<{ id?: string }>(request, 10_000_000);

    if (!payload.id) {
      return NextResponse.json({ error: "Aula invalida." }, { status: 400 });
    }

    const data = await deleteLesson(payload.id);
    invalidateCatalog({ from: "route" });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel excluir a aula.");
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiRole("catalog.write");

  if (auth.response) {
    return auth.response;
  }

  try {
    const payload = await readBoundedJson<Partial<LessonOrderInput>>(request, 10_000_000);

    if (!payload.moduleId || !Array.isArray(payload.orderedIds) || payload.orderedIds.length === 0) {
      return NextResponse.json({ error: "Ordem de aulas invalida." }, { status: 400 });
    }

    const data = await reorderLessons({
      moduleId: payload.moduleId,
      orderedIds: payload.orderedIds
    });
    invalidateCatalog({ from: "route" });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel ordenar as aulas.");
  }
}
