import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import {
  buildStoredCaptionTrack,
  normalizeStoredCaptionCues,
  type StoredLessonCaptions
} from "@/server/video/lesson-captions";
import {
  fetchYouTubeCaptions,
  normalizeYouTubeCaptionLanguage,
  type YouTubeCaptionCue
} from "@/server/video/youtube-captions";
import type { LessonVideoConfig } from "@/lib/platform-types";

export type TranscriptFormat = "json3" | "srt" | "txt" | "vtt";
export type TranscriptSource = "paste" | "upload" | "youtube";

export type TranscriptCue = {
  durationSeconds: number;
  endSeconds: number;
  startSeconds: number;
  text: string;
};

export type NormalizedTranscript = {
  checksum: string;
  cues: TranscriptCue[];
  format: TranscriptFormat;
  fullText: string;
  language: string;
  source: TranscriptSource;
  sourceVideoId?: string;
};

export type LessonTranscriptStatus = {
  chunkCount: number;
  createdAt: string;
  errorMessage: string | null;
  format: TranscriptFormat;
  language: string;
  profileStatus: "error" | "processing" | "ready" | "waiting_provider";
  source: TranscriptSource;
  sourceVideoId: string | null;
  status: "error" | "processing" | "ready";
  transcriptId: string;
  version: number;
};

type TranscriptRow = {
  checksum: string;
  created_at: string;
  cues: TranscriptCue[];
  error_message: string | null;
  full_text: string;
  id: string;
  language: string;
  lesson_id: string;
  source: TranscriptSource;
  source_format: TranscriptFormat;
  source_video_id: string | null;
  status: "error" | "processing" | "ready";
  version: number;
};

export class TranscriptError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "TranscriptError";
    this.status = status;
  }
}

function throwDatabaseError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function cleanCueText(value: string) {
  return value
    .replace(/<[^>]{1,200}>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function splitLongText(value: string, maximumLength = 1_500) {
  const text = cleanCueText(value);

  if (!text) return [];
  const segments: string[] = [];
  let remaining = text;

  while (remaining.length > maximumLength) {
    const candidate = remaining.slice(0, maximumLength + 1);
    const splitAt = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("? "), candidate.lastIndexOf("! "), candidate.lastIndexOf(" "));
    const safeSplitAt = splitAt >= Math.floor(maximumLength * 0.55) ? splitAt + 1 : maximumLength;
    segments.push(remaining.slice(0, safeSplitAt).trim());
    remaining = remaining.slice(safeSplitAt).trim();
  }

  if (remaining) segments.push(remaining);
  return segments;
}

function parseTimestamp(value: string) {
  const match = value.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?$/);

  if (!match) return null;
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number((match[4] ?? "0").padEnd(3, "0"));

  if (![hours, minutes, seconds, milliseconds].every(Number.isFinite) || minutes > 59 || seconds > 59) {
    return null;
  }

  return (hours * 3600) + (minutes * 60) + seconds + (milliseconds / 1000);
}

function parseTimedTranscript(text: string) {
  const lines = normalizeText(text).split("\n");
  const cues: TranscriptCue[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const timingLine = lines[index];

    if (!timingLine.includes("-->")) continue;
    const [rawStart, rawEndWithSettings] = timingLine.split("-->", 2);
    const rawEnd = rawEndWithSettings.trim().split(/\s+/, 1)[0];
    const startSeconds = parseTimestamp(rawStart);
    const endSeconds = parseTimestamp(rawEnd);

    if (startSeconds === null || endSeconds === null || endSeconds < startSeconds) continue;
    const body: string[] = [];

    for (index += 1; index < lines.length && lines[index].trim(); index += 1) {
      body.push(lines[index]);
    }

    const cueTexts = splitLongText(body.join(" "), 4_000);

    for (const cueText of cueTexts) {
      cues.push({
        durationSeconds: Math.max(0, endSeconds - startSeconds),
        endSeconds,
        startSeconds,
        text: cueText
      });
    }
  }

  return cues;
}

function parsePlainText(text: string) {
  const paragraphs = normalizeText(text)
    .split(/\n{2,}/)
    .map(cleanCueText)
    .filter(Boolean);
  const safeParagraphs = paragraphs.length > 0 ? paragraphs : [cleanCueText(text)].filter(Boolean);

  return safeParagraphs.flatMap((paragraph) => splitLongText(paragraph).map((segment) => ({
    durationSeconds: 0,
    endSeconds: 0,
    startSeconds: 0,
    text: segment
  })));
}

function validateTranscript({ cues, fullText }: { cues: TranscriptCue[]; fullText: string }) {
  if (!fullText || cues.length === 0) {
    throw new TranscriptError("A transcricao esta vazia ou nao possui trechos validos.");
  }

  if (fullText.length > 2_000_000) {
    throw new TranscriptError("A transcricao ultrapassa o limite de 2 milhoes de caracteres.", 413);
  }

  if (cues.length > 20_000) {
    throw new TranscriptError("A transcricao possui trechos demais para processamento.", 413);
  }
}

export function normalizeManualTranscript({
  format,
  language,
  source,
  text
}: {
  format: TranscriptFormat;
  language: string;
  source: "paste" | "upload";
  text: string;
}): NormalizedTranscript {
  if (!(["srt", "txt", "vtt"] as TranscriptFormat[]).includes(format)) {
    throw new TranscriptError("Formato de transcricao manual invalido.");
  }

  const normalizedLanguage = normalizeYouTubeCaptionLanguage(language);

  if (!normalizedLanguage) throw new TranscriptError("Idioma da transcricao invalido.");
  const normalizedInput = normalizeText(text);
  const cues = format === "txt" ? parsePlainText(normalizedInput) : parseTimedTranscript(normalizedInput);
  const fullText = cues.map((cue) => cue.text).join("\n").trim();
  validateTranscript({ cues, fullText });

  return {
    checksum: createHash("sha256").update(`${normalizedLanguage}\n${fullText}`).digest("hex"),
    cues,
    format,
    fullText,
    language: normalizedLanguage,
    source
  };
}

function fromYouTubeCues(cues: YouTubeCaptionCue[]) {
  return cues.map((cue) => ({
    durationSeconds: Math.max(0, cue.durationSeconds),
    endSeconds: Math.max(cue.startSeconds, cue.startSeconds + cue.durationSeconds),
    startSeconds: Math.max(0, cue.startSeconds),
    text: cleanCueText(cue.text)
  })).filter((cue) => cue.text);
}

export function normalizeYouTubeTranscript({
  cues,
  language,
  videoId
}: {
  cues: YouTubeCaptionCue[];
  language: string;
  videoId: string;
}): NormalizedTranscript {
  const normalizedCues = fromYouTubeCues(cues);
  const fullText = normalizedCues.map((cue) => cue.text).join("\n").trim();
  validateTranscript({ cues: normalizedCues, fullText });

  return {
    checksum: createHash("sha256").update(`${videoId}\n${language}\n${fullText}`).digest("hex"),
    cues: normalizedCues,
    format: "json3",
    fullText,
    language,
    source: "youtube",
    sourceVideoId: videoId
  };
}

export function extractYouTubeVideoId(video: LessonVideoConfig | null | undefined) {
  if (video?.provider !== "youtube") return "";
  const assetId = video.assetId?.trim() ?? "";

  if (/^[A-Za-z0-9_-]{11}$/.test(assetId)) return assetId;
  const rawUrl = video.url?.trim() ?? "";

  if (/^[A-Za-z0-9_-]{11}$/.test(rawUrl)) return rawUrl;

  try {
    const url = new URL(rawUrl);

    if (url.hostname === "youtu.be" || url.hostname.endsWith(".youtu.be")) {
      return url.pathname.split("/").filter(Boolean)[0] ?? "";
    }

    if (url.hostname === "youtube.com" || url.hostname.endsWith(".youtube.com")) {
      return url.searchParams.get("v") ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
    }
  } catch {
    return "";
  }

  return "";
}

export async function prepareYouTubeTranscript(video: LessonVideoConfig | null | undefined, requestedLanguage = "pt") {
  const videoId = extractYouTubeVideoId(video);

  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
    throw new TranscriptError("Informe um link ou ID valido do YouTube para importar a legenda.");
  }

  const language = normalizeYouTubeCaptionLanguage(requestedLanguage) ?? "pt";
  const result = await fetchYouTubeCaptions({ language, videoId });

  if (result.cues.length === 0) {
    throw new TranscriptError(
      "Este video nao possui uma legenda publica utilizavel. Envie um arquivo SRT, VTT ou TXT, ou cole a transcricao.",
      422
    );
  }

  return normalizeYouTubeTranscript({ cues: result.cues, language, videoId });
}

function buildTranscriptChunks(cues: TranscriptCue[]) {
  const chunks: Array<{ end_seconds: number; order_index: number; start_seconds: number; text: string }> = [];
  let current: TranscriptCue[] = [];
  let currentLength = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      end_seconds: current[current.length - 1].endSeconds,
      order_index: chunks.length,
      start_seconds: current[0].startSeconds,
      text: current.map((cue) => cue.text).join(" ").trim()
    });
    current = [];
    currentLength = 0;
  };

  for (const cue of cues) {
    const proposedLength = currentLength + cue.text.length + 1;
    const proposedDuration = current.length > 0 ? cue.endSeconds - current[0].startSeconds : 0;

    if (current.length > 0 && (proposedLength > 1_600 || proposedDuration > 90)) flush();
    current.push(cue);
    currentLength += cue.text.length + 1;
  }

  flush();
  return chunks;
}

export async function saveLessonTranscript({
  createdBy,
  lessonId,
  transcript
}: {
  createdBy: string;
  lessonId: string;
  transcript: NormalizedTranscript;
}) {
  const supabase = getSupabaseAdminClient();
  const lessonResult = await supabase.from("lessons").select("id").eq("id", lessonId).maybeSingle();
  throwDatabaseError(lessonResult.error, "Nao foi possivel validar a aula da transcricao");

  if (!lessonResult.data) throw new TranscriptError("Aula nao encontrada.", 404);
  const chunks = buildTranscriptChunks(transcript.cues);
  const saveResult = await supabase.rpc("save_lesson_transcript_atomic", {
    p_checksum: transcript.checksum,
    p_chunks: chunks,
    p_created_by: createdBy,
    p_cues: transcript.cues,
    p_full_text: transcript.fullText,
    p_language: transcript.language,
    p_lesson_id: lessonId,
    p_source: transcript.source,
    p_source_format: transcript.format,
    p_source_video_id: transcript.sourceVideoId ?? null
  });
  throwDatabaseError(saveResult.error, "Nao foi possivel salvar e preparar a transcricao");

  if (typeof saveResult.data !== "string" || !saveResult.data) {
    throw new Error("O banco nao retornou a transcricao preparada.");
  }

  return getLessonTranscriptStatus(lessonId);
}

/**
 * Transcricao ativa da aula no formato de legenda do player. Devolve `null` quando a aula nao
 * tem transcricao, quando ela esta marcada com erro ou quando nenhuma cue e aproveitavel.
 */
export async function getActiveLessonTranscriptCaptions(lessonId: string): Promise<StoredLessonCaptions | null> {
  const supabase = getSupabaseAdminClient();
  const result = await supabase
    .from("lesson_transcripts")
    .select("cues,language,source,status")
    .eq("lesson_id", lessonId)
    .eq("is_active", true)
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel carregar a legenda guardada da aula");

  if (!result.data || result.data.status === "error") return null;
  const cues = normalizeStoredCaptionCues(result.data.cues);

  if (cues.length === 0) return null;

  return {
    cues,
    track: buildStoredCaptionTrack({
      language: typeof result.data.language === "string" && result.data.language ? result.data.language : "pt-BR",
      source: String(result.data.source ?? "")
    })
  };
}

export async function getLessonTranscriptStatus(lessonId: string): Promise<LessonTranscriptStatus | null> {
  const supabase = getSupabaseAdminClient();
  const transcriptResult = await supabase
    .from("lesson_transcripts")
    .select("id,version,source,source_format,source_video_id,language,status,error_message,created_at")
    .eq("lesson_id", lessonId)
    .eq("is_active", true)
    .maybeSingle();
  throwDatabaseError(transcriptResult.error, "Nao foi possivel carregar a transcricao da aula");

  if (!transcriptResult.data) return null;
  const [profileResult, chunkResult] = await Promise.all([
    supabase.from("lesson_ai_profiles").select("transcript_id,status").eq("lesson_id", lessonId).maybeSingle(),
    supabase.from("content_chunks").select("id", { count: "exact", head: true }).eq("transcript_id", transcriptResult.data.id)
  ]);
  throwDatabaseError(profileResult.error, "Nao foi possivel carregar o perfil da aula");
  throwDatabaseError(chunkResult.error, "Nao foi possivel contar os trechos da aula");

  return {
    chunkCount: chunkResult.count ?? 0,
    createdAt: transcriptResult.data.created_at,
    errorMessage: transcriptResult.data.error_message,
    format: transcriptResult.data.source_format as TranscriptFormat,
    language: transcriptResult.data.language,
    profileStatus: (
      profileResult.data?.transcript_id === transcriptResult.data.id
        ? profileResult.data?.status ?? "waiting_provider"
        : "waiting_provider"
    ) as LessonTranscriptStatus["profileStatus"],
    source: transcriptResult.data.source as TranscriptSource,
    sourceVideoId: transcriptResult.data.source_video_id,
    status: transcriptResult.data.status as LessonTranscriptStatus["status"],
    transcriptId: transcriptResult.data.id,
    version: transcriptResult.data.version
  };
}

export async function getActiveLessonTranscript(lessonId: string) {
  const result = await getSupabaseAdminClient()
    .from("lesson_transcripts")
    .select("id,lesson_id,version,source,source_format,source_video_id,language,full_text,cues,checksum,status,error_message,created_at")
    .eq("lesson_id", lessonId)
    .eq("is_active", true)
    .eq("status", "ready")
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel carregar a transcricao ativa");
  return (result.data as TranscriptRow | null) ?? null;
}

export async function getLessonTranscriptChunks(lessonId: string, transcriptId: string) {
  const result = await getSupabaseAdminClient()
    .from("content_chunks")
    .select("id,order_index,start_seconds,end_seconds,text")
    .eq("lesson_id", lessonId)
    .eq("transcript_id", transcriptId)
    .order("order_index");
  throwDatabaseError(result.error, "Nao foi possivel carregar os trechos da aula");

  return (result.data ?? []).map((row) => ({
    endSeconds: Number(row.end_seconds),
    id: row.id as string,
    orderIndex: row.order_index as number,
    startSeconds: Number(row.start_seconds),
    text: row.text as string
  }));
}

export async function loadLessonVideo(lessonId: string) {
  const result = await getSupabaseAdminClient()
    .from("lessons")
    .select("id,title,video_config")
    .eq("id", lessonId)
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel carregar o video da aula");

  if (!result.data) throw new TranscriptError("Aula nao encontrada.", 404);
  return {
    title: result.data.title as string,
    video: (result.data.video_config as LessonVideoConfig | null) ?? null
  };
}
