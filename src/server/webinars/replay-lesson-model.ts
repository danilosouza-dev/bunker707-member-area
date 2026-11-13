// Publicar replay como aula, a parte pura (docs/30 §2.2 e §6.8; D108 a D114): qual e a aula de um webinario, o titulo,
// o video e a duracao dela, em que modulo do produto ela entra, e o que cada recusa diz na tela. Quem grava e
// replay-lesson.ts (o servidor); aqui nada toca o banco. Modulo puro (tests/webinarios-replay-aula.test.mjs).

import type { LessonVideoConfig } from "../../lib/platform-types";
import { detectLessonVideo } from "../../lib/video-detect";
import { MAX_LESSONS_PER_MODULE } from "../catalog/model";
import type { ReplayLessonTarget } from "./model";

/**
 * Uma aula por webinario (D109): o id sai do id do webinario, entao publicar de novo nunca cria a segunda aula (a chave
 * primaria de `lessons` recusa), e a aula excluida pela equipe continua ocupando o id (o automatico nao a recria).
 */
export const REPLAY_LESSON_ID_PREFIX = "lesson-replay-";

export function replayLessonIdFor(webinarId: string): string {
  return `${REPLAY_LESSON_ID_PREFIX}${webinarId}`;
}

/** O modulo criado quando o produto escolhido ainda nao tem nenhum (D111). */
export const REPLAY_LESSON_MODULE_TITLE = "Lives";

const TITLE_MAX = 120;
const DESCRIPTION_MAX = 2000;
const TITLE_FALLBACK = "Replay da live";

function oneLine(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** O titulo da aula: o do card Publicar replay como aula; vazio, o do webinario (ate 120 caracteres, como toda aula). */
export function replayLessonTitle(target: Pick<ReplayLessonTarget, "title">, webinarTitle: string | null | undefined): string {
  const title = oneLine(target.title) || oneLine(webinarTitle) || TITLE_FALLBACK;

  return title.length > TITLE_MAX ? `${title.slice(0, TITLE_MAX - 1).trimEnd()}…` : title;
}

/** A descricao da aula: a do webinario, sem passar do que a pagina da aula comporta. */
export function replayLessonDescription(webinarDescription: string | null | undefined): string {
  const text = (webinarDescription ?? "").trim();

  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : text;
}

/**
 * O video da aula: o mesmo que a equipe teria se colasse o endereco do player da Bunny no painel da aula
 * (detectLessonVideo: `{ assetId, provider: "bunny", url }`). So o player da Bunny vale; outro endereco, nulo.
 */
export function replayLessonVideo(recording: { bunny_library_id: string | null; bunny_video_id: string | null; embed_url: string | null }): LessonVideoConfig | null {
  const fromIds = recording.bunny_library_id && recording.bunny_video_id ? `https://iframe.mediadelivery.net/embed/${recording.bunny_library_id}/${recording.bunny_video_id}` : null;

  for (const candidate of [recording.embed_url, fromIds]) {
    const detected = candidate ? detectLessonVideo(candidate) : null;

    if (detected?.ok && detected.provider === "bunny") {
      return detected.config;
    }
  }

  return null;
}

/** "1:02:03" ou "12:05", como as outras aulas (vazio sem a duracao). */
export function replayLessonDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return "";
  }

  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const rest = whole % 60;

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

export type ReplayLessonModule = { id: string; sort_order: number };

/**
 * Em que modulo a aula entra (D111): o escolhido no card, se ainda e um modulo do produto; sem escolha, o ultimo modulo
 * do produto (as lives novas ficam no fim do curso); sem modulo nenhum, `create` (o servidor cria o modulo "Lives").
 */
export function pickReplayLessonModule(modules: readonly ReplayLessonModule[], moduleId: string | null): { kind: "create" } | { kind: "missing" } | { id: string; kind: "module" } {
  if (moduleId) {
    return modules.some((module) => module.id === moduleId) ? { id: moduleId, kind: "module" } : { kind: "missing" };
  }

  const last = modules.slice().sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)).at(-1);

  return last ? { id: last.id, kind: "module" } : { kind: "create" };
}

/** Por que o replay nao virou aula. `auto_off` e `removed` so existem no automatico (ninguem ve). */
export const REPLAY_LESSON_SKIPS = ["auto_off", "formation", "module_full", "module_missing", "no_replay", "no_target", "no_video", "product_missing", "removed"] as const;
export type ReplayLessonSkip = (typeof REPLAY_LESSON_SKIPS)[number];

export const REPLAY_LESSON_MESSAGES: Record<ReplayLessonSkip, string> = {
  auto_off: "O webinário não publica o replay sozinho.",
  formation: "Uma formação é feita de cursos. Escolha um curso para receber a aula do replay.",
  module_full: `O módulo escolhido já tem ${MAX_LESSONS_PER_MODULE} aulas, o limite. Escolha outro módulo no card Publicar replay como aula.`,
  module_missing: "O módulo escolhido não existe mais neste produto. Escolha outro no card Publicar replay como aula.",
  no_replay: "O replay ainda não está pronto. A aula nasce quando a gravação terminar de processar.",
  no_target: "Escolha o produto no card Publicar replay como aula e salve antes de publicar o replay.",
  no_video: "A gravação do replay não tem um vídeo da Bunny para virar aula.",
  product_missing: "O produto escolhido para a aula do replay não existe mais. Escolha outro no card Publicar replay como aula.",
  removed: "A aula deste replay foi excluída pela equipe."
};

export type ReplayLessonMode = "auto" | "manual";

export type ReplayLessonOutcome =
  /** A aula nasceu (ou voltou da exclusao, `restored`), publicada, no fim do modulo. */
  | { lessonId: string; moduleCreated: boolean; moduleId: string; productId: string; restored: boolean; status: "published"; title: string }
  /** O replay ja era uma aula: nada muda (a equipe pode ter editado o titulo, o modulo ou o video). */
  | { lessonId: string; status: "exists"; title: string }
  | { reason: ReplayLessonSkip; status: "skipped" };
