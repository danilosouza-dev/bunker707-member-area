import { NextResponse } from "next/server";
import { requireApiAdmin } from "@/server/auth/guards";
import { deleteLesson, reorderLessons, upsertLesson } from "@/server/db/platform-store";
import { jsonRouteError } from "@/server/http/route-errors";
import type { LessonOrderInput, LessonWriteInput } from "@/server/db/platform-store";
import type { AdminReleaseRule } from "@/lib/platform-types";
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
  const auth = await requireApiAdmin();

  if (auth.response || !auth.user) {
    return auth.response;
  }

  const payload = await request.json() as Partial<LessonWriteInput> & {
    releaseFixedDate?: string;
    releaseDelayUnit?: "horas" | "dias";
    releaseDelayValue?: string;
    releaseMode?: AdminReleaseRule["mode"];
    releaseRequirement?: string;
    transcript?: LessonTranscriptPayload;
  };

  if (!payload.moduleId || !payload.title) {
    return NextResponse.json({ error: "Modulo e titulo da aula sao obrigatorios." }, { status: 400 });
  }

  try {
    const transcriptPayload = payload.transcript;
    const transcriptMode = transcriptPayload?.mode;
    const currentTranscript = payload.id ? await getLessonTranscriptStatus(payload.id) : null;
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
        extractYouTubeVideoId(payload.video) !== currentTranscript.sourceVideoId
      )
    ) {
      preparedTranscript = await prepareYouTubeTranscript(
        payload.video,
        typeof transcriptPayload?.language === "string" ? transcriptPayload.language : "pt"
      );
    }

    const result = await upsertLesson({
      ...payload,
      releaseRule: payload.releaseMode
        ? {
            delayUnit: payload.releaseDelayUnit,
            delayValue: payload.releaseDelayValue,
            fixedDate: payload.releaseFixedDate,
            mode: payload.releaseMode,
            requirement: payload.releaseRequirement
          }
        : payload.releaseRule
    } as LessonWriteInput);

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
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as { id?: string };

  if (!payload.id) {
    return NextResponse.json({ error: "Aula invalida." }, { status: 400 });
  }

  try {
    const data = await deleteLesson(payload.id);

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel excluir a aula.");
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiAdmin();

  if (auth.response) {
    return auth.response;
  }

  const payload = await request.json() as Partial<LessonOrderInput>;

  if (!payload.moduleId || !Array.isArray(payload.orderedIds) || payload.orderedIds.length === 0) {
    return NextResponse.json({ error: "Ordem de aulas invalida." }, { status: 400 });
  }

  try {
    const data = await reorderLessons({
      moduleId: payload.moduleId,
      orderedIds: payload.orderedIds
    });

    return NextResponse.json({ data });
  } catch (error) {
    return jsonRouteError(error, "Nao foi possivel ordenar as aulas.");
  }
}
