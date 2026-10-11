// "+ Adicionar aula" (docs/17 §1.6.3): digitar um nome, colar um link ou colar varias linhas.
// Modulo puro (sem React, sem "@/" em import de valor): tests/admin-content-tree.test.mjs carrega
// direto pelo Node. O servidor reconhece o video de novo (detectLessonVideo em createLessons); aqui
// e so para mostrar o chip na hora e nao mandar link que o servidor recusaria.

import type { LessonVideoProvider } from "@/lib/platform-types";
import { detectLessonVideo, looksLikeVideoLink } from "../../../../lib/video-detect";
import { MAX_LESSONS_PER_PASTE, parseLessonPaste } from "../../../../server/catalog/model";

export type PlannedLesson = {
  title: string;
  video: { label: string; provider: LessonVideoProvider } | null;
  videoInput?: string;
};

export type LeftoverLine = { line: string; message: string };

export type LessonInputPlan = {
  items: PlannedLesson[];
  /** Linhas alem do limite de uma colagem, como o produtor colou (para colar de novo). */
  overflow: string[];
  /**
   * Linhas com link que nao reconhecemos (o produtor corrige ou usa "Outro provedor" no painel).
   * `line` e a linha inteira ("Titulo | link" ou so o link), pronta para voltar ao campo.
   */
  rejected: LeftoverLine[];
  /** Linhas alem do limite de uma colagem. */
  truncated: number;
};

/** Volta a linha como o produtor escreveu: "Titulo | link", so o link ou so o titulo. */
function lineOf(item: { title: string; videoInput?: string }) {
  if (!item.videoInput) {
    return item.title;
  }

  return item.title ? `${item.title} | ${item.videoInput}` : item.videoInput;
}

/** Texto digitado ou colado -> aulas a criar, linhas recusadas e o que passou do limite. */
export function planLessonInput(text: string, max: number = MAX_LESSONS_PER_PASTE): LessonInputPlan {
  const parsed = parseLessonPaste(text);
  const items: PlannedLesson[] = [];
  const rejected: LessonInputPlan["rejected"] = [];

  for (const item of parsed.slice(0, max)) {
    if (!item.videoInput) {
      items.push({ title: item.title, video: null });
      continue;
    }

    const detection = detectLessonVideo(item.videoInput);

    if (!detection.ok) {
      rejected.push({ line: lineOf(item), message: detection.message });
      continue;
    }

    items.push({
      title: item.title,
      video: { label: detection.label, provider: detection.provider },
      videoInput: item.videoInput
    });
  }

  const overflow = parsed.slice(max).map(lineOf);

  return { items, overflow, rejected, truncated: overflow.length };
}

/**
 * O que nao virou aula numa colagem de varias linhas, cada linha com o motivo: links nao reconhecidos
 * e o que passou do limite. A tela lista embaixo do campo, com "Corrigir" para trazer a linha de volta.
 */
export function leftoverLines(plan: LessonInputPlan): LeftoverLine[] {
  return [
    ...plan.rejected,
    ...plan.overflow.map((line) => ({ line, message: `Ficou de fora do limite de ${MAX_LESSONS_PER_PASTE} aulas por vez.` }))
  ];
}

/** Resumo de uma colagem que nao criou nenhuma aula: "Nenhuma aula criada · 2 links não reconhecidos". */
export function describeNothingCreated(plan: LessonInputPlan) {
  return describeCreationResult({ created: 0, rejected: plan.rejected.length, skipped: 0, truncated: plan.truncated });
}

/** Colagem com mais de uma linha preenchida vira varias aulas de uma vez. */
export function isMultiLinePaste(text: string) {
  return text.split(/\r?\n/).filter((line) => line.trim()).length > 1;
}

/** Colar so um link no campo vazio ja cria a aula com o video. */
export function isSingleVideoPaste(text: string) {
  return !isMultiLinePaste(text) && looksLikeVideoLink(text);
}

export type InputFeedback =
  | { kind: "hint" }
  | { kind: "video"; label: string; notice: string; provider: LessonVideoProvider; tone: "neutral" | "warning" }
  | { kind: "error"; message: string };

/** O que aparece embaixo do campo enquanto o produtor digita. */
export function describeLessonInput(value: string): InputFeedback {
  const text = value.trim();

  if (!text) {
    return { kind: "hint" };
  }

  const [item] = parseLessonPaste(text);

  if (!item?.videoInput) {
    return { kind: "hint" };
  }

  const detection = detectLessonVideo(item.videoInput);

  return detection.ok
    ? { kind: "video", label: detection.label, notice: detection.notice, provider: detection.provider, tone: detection.tone }
    : { kind: "error", message: detection.message };
}

function plural(count: number, singular: string, pluralForm: string) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Resumo da colagem: "3 aulas criadas · 1 link não reconhecido". */
export function describeCreationResult(input: { created: number; rejected: number; skipped: number; truncated: number }) {
  const parts = [input.created === 0 ? "Nenhuma aula criada" : plural(input.created, "aula criada", "aulas criadas")];

  if (input.rejected > 0) {
    parts.push(plural(input.rejected, "link não reconhecido", "links não reconhecidos"));
  }

  if (input.skipped > 0) {
    parts.push(plural(input.skipped, "linha vazia ignorada", "linhas vazias ignoradas"));
  }

  if (input.truncated > 0) {
    parts.push(`${plural(input.truncated, "linha ficou", "linhas ficaram")} de fora (limite de ${MAX_LESSONS_PER_PASTE} por vez)`);
  }

  return parts.join(" · ");
}

/** Titulo da linha provisoria enquanto o servidor cria a aula (o titulo do provedor chega depois). */
export function provisionalLessonTitle(item: PlannedLesson) {
  if (item.title.trim()) {
    return item.title.trim();
  }

  return item.video ? "Lendo o título do vídeo…" : "Nova aula";
}
