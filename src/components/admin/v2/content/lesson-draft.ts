// Rascunho do painel da aula (docs/17 §1.6.4): o que mudou, o que vai para updateLesson e como
// encaixar uma leitura nova do servidor sem apagar o que o produtor esta digitando.
// Modulo puro: tests/admin-content-tree.test.mjs carrega direto pelo Node.

import type { LessonEditorData, LessonStatus, ReleasePhrase, UpdateLessonInput } from "@/server/catalog/types";
import { detectLessonVideo } from "../../../../lib/video-detect";
import { releasePhraseSchema, structureTitleSchema } from "../../../../server/catalog/schemas";

export type LessonDraft = {
  /** "Outro provedor": aceita codigo de incorporacao de um host desconhecido. */
  allowEmbedCode: boolean;
  description: string;
  durationLabel: string;
  release: ReleasePhrase;
  status: LessonStatus;
  title: string;
  videoInput: string;
};

type EditableKey = Exclude<keyof LessonDraft, "allowEmbedCode">;

const EDITABLE_KEYS: readonly EditableKey[] = ["title", "description", "durationLabel", "videoInput", "release", "status"];

export function draftFromLesson(lesson: LessonEditorData["lesson"]): LessonDraft {
  return {
    allowEmbedCode: lesson.videoConfig?.provider === "embed_code",
    description: lesson.description ?? "",
    durationLabel: lesson.durationLabel ?? "",
    release: lesson.release,
    status: lesson.status,
    title: lesson.title,
    videoInput: lesson.videoInput ?? ""
  };
}

function normalizeRelease(phrase: ReleasePhrase) {
  switch (phrase.mode) {
    case "after_access":
      return `after_access:${phrase.amount}:${phrase.unit}`;
    case "fixed_date":
      return `fixed_date:${phrase.date}`;
    default:
      return phrase.mode;
  }
}

function sameValue(key: EditableKey, left: LessonDraft, right: LessonDraft) {
  if (key === "release") {
    return normalizeRelease(left.release) === normalizeRelease(right.release);
  }

  if (key === "status") {
    return left.status === right.status;
  }

  return left[key].trim() === right[key].trim();
}

export function changedFields(baseline: LessonDraft, draft: LessonDraft) {
  return EDITABLE_KEYS.filter((key) => !sameValue(key, baseline, draft));
}

export function isDraftDirty(baseline: LessonDraft, draft: LessonDraft) {
  return changedFields(baseline, draft).length > 0;
}

/**
 * Chegou uma leitura nova do servidor enquanto o painel tem alteracoes: o campo que o produtor nao
 * mexeu passa a valer o do servidor; o que ele mexeu continua como ele deixou.
 */
export function rebaseDraft(oldBaseline: LessonDraft, newBaseline: LessonDraft, draft: LessonDraft): LessonDraft {
  const next: LessonDraft = { ...draft };

  for (const key of EDITABLE_KEYS) {
    if (sameValue(key, oldBaseline, draft)) {
      (next as Record<EditableKey, unknown>)[key] = newBaseline[key];
    }
  }

  if (sameValue("videoInput", oldBaseline, draft)) {
    next.allowEmbedCode = newBaseline.allowEmbedCode;
  }

  return next;
}

/** Entrada de updateLesson so com o que mudou (campo ausente = nao mexe; video vazio = remove). */
export function buildLessonUpdate(input: {
  baseline: LessonDraft;
  draft: LessonDraft;
  expectedUpdatedAt: string;
  id: string;
}): UpdateLessonInput {
  const { baseline, draft } = input;
  const update: UpdateLessonInput = { allowEmbedCode: draft.allowEmbedCode, expectedUpdatedAt: input.expectedUpdatedAt, id: input.id };

  for (const key of changedFields(baseline, draft)) {
    switch (key) {
      case "title":
        update.title = draft.title.trim();
        break;
      case "description":
        update.description = draft.description.trim();
        break;
      case "durationLabel":
        update.durationLabel = draft.durationLabel.trim();
        break;
      case "videoInput":
        update.videoInput = draft.videoInput.trim() || null;
        break;
      case "release":
        update.release = draft.release;
        break;
      case "status":
        update.status = draft.status;
        break;
    }
  }

  return update;
}

export type LessonDraftErrors = Partial<Record<"release" | "title" | "videoInput", string>>;

/** Validacao ao salvar e ao sair do campo; o botao Salvar nunca fica desabilitado por isso. */
export function validateLessonDraft(draft: LessonDraft): LessonDraftErrors {
  const errors: LessonDraftErrors = {};
  const title = structureTitleSchema.safeParse(draft.title);

  if (!title.success) {
    errors.title = title.error.issues[0]?.message ?? "Dê um nome à aula.";
  }

  if (draft.videoInput.trim()) {
    const detection = detectLessonVideo(draft.videoInput, { allowEmbedCode: draft.allowEmbedCode });

    if (!detection.ok) {
      errors.videoInput = detection.message;
    }
  }

  const release = releasePhraseSchema.safeParse(draft.release);

  if (!release.success) {
    errors.release = release.error.issues[0]?.message ?? "Revise a liberação.";
  }

  return errors;
}

/** Titulo que o provedor pode substituir: vazio ou o "Aula N" que o servidor poe quando nao ha nome. */
export function shouldAdoptSuggestedTitle(title: string) {
  const value = title.trim();

  return !value || /^Aula \d+$/i.test(value) || value === "Nova aula";
}

/* ------------------------------------------------------------------------------------------------
 * Transcrição e Tutor IA (rotas /api/admin/lessons/{id}/transcript*)
 * ---------------------------------------------------------------------------------------------- */

export type TranscriptStatus = {
  chunkCount: number;
  createdAt: string;
  errorMessage: string | null;
  format: "json3" | "srt" | "txt" | "vtt";
  language: string;
  profileStatus: "error" | "processing" | "ready" | "waiting_provider";
  source: "paste" | "upload" | "youtube";
  sourceVideoId: string | null;
  status: "error" | "processing" | "ready";
  transcriptId: string;
  version: number;
};

export const MAX_TRANSCRIPT_FILE_BYTES = 2_000_000;

function formatDayMonth(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(date);
}

export function describeTranscript(status: TranscriptStatus | null): { label: string; tone: "error" | "muted" | "success" | "warning" } {
  if (!status) {
    return { label: "Sem transcrição", tone: "muted" };
  }

  if (status.status === "processing") {
    return { label: "Gerando em segundo plano", tone: "warning" };
  }

  if (status.status === "error") {
    return { label: "Transcrição com erro", tone: "error" };
  }

  const day = formatDayMonth(status.createdAt);

  return { label: day ? `Gerada em ${day}` : "Transcrição pronta", tone: "success" };
}

/** Frase sobre o Tutor IA abaixo do estado da transcrição. */
export function describeTutorReadiness(status: TranscriptStatus | null) {
  if (!status) {
    return "O Tutor IA usa a transcrição para responder dúvidas sobre esta aula.";
  }

  switch (status.profileStatus) {
    case "ready":
      return "O Tutor IA já responde dúvidas com base nesta aula.";
    case "processing":
      return "Preparando a aula para o Tutor IA. Pode salvar e fechar.";
    case "waiting_provider":
      return "Transcrição pronta. Falta ligar um modelo em Configurações › Tutor IA.";
    default:
      return "Não conseguimos preparar a aula para o Tutor IA. Tente de novo.";
  }
}

export function transcriptFormatFromFileName(name: string): "srt" | "txt" | "vtt" | null {
  const extension = name.split(".").pop()?.toLowerCase();

  return extension === "srt" || extension === "txt" || extension === "vtt" ? extension : null;
}
