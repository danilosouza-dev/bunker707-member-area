// Linhas do banco -> DTOs das telas de Produtos (contratos em ./types.ts). Modulo puro: sem
// "server-only", sem Supabase, so imports relativos de valor; tests/catalog-server.test.mjs carrega
// direto pelo Node. Datas `updated_at` passam como vieram do banco (texto ISO com microssegundos),
// porque voltam na escrita seguinte como `expectedUpdatedAt` e precisam bater exatamente.

import type { LessonVideoConfig, ReleaseRuleConfig } from "@/lib/platform-types";
import { normalizeHeroVideoOptions } from "../../lib/hero-video";
import { VIDEO_PROVIDER_LABELS } from "../../lib/video-detect";
import { normalizeLessonVideoConfig } from "../../lib/video-embed";
import {
  PRODUCT_AUDIENCE_LABELS,
  PRODUCT_FORMAT_LABELS,
  PRODUCT_SITUATION_LABELS,
  audienceFromColumns,
  describeReleasePhrase,
  formatFromKind,
  isComingSoonForVisitors,
  releaseRuleToPhrase,
  resolveProductAccent,
  situationFromPublicationStatus,
  type LessonStatus,
  type ProductFormat
} from "./model";
import type {
  FormationCourseItem,
  LessonNode,
  LessonVideoSummary,
  ModuleNode,
  ProductHeader,
  ProductHeroCorners,
  ProductListItem
} from "./types";

/* ------------------------------------------------------------------------------------------------
 * Linhas lidas (colunas explicitas, nunca select("*"))
 * ---------------------------------------------------------------------------------------------- */

export type ProductRow = {
  access_label: string | null;
  access_model: string | null;
  bucket: string;
  commerce_scope: string | null;
  description: string | null;
  eyebrow: string;
  id: string;
  image: string | null;
  instructor: { avatar?: string; handle?: string; name?: string } | null;
  kind: string;
  level_label: string | null;
  listing: string | null;
  max_students: number | null;
  publication_status: string | null;
  purchase_label: string | null;
  purchase_target: string | null;
  purchase_url: string | null;
  release_rule: ReleaseRuleConfig | null;
  sort_order: number;
  title: string;
  updated_at: string;
};

export const PRODUCT_COLUMNS =
  "id,bucket,kind,commerce_scope,access_model,listing,title,eyebrow,access_label,description,image,instructor,level_label,max_students,publication_status,purchase_label,purchase_target,purchase_url,release_rule,sort_order,updated_at";

export type ModuleRow = {
  id: string;
  image: string | null;
  owner_id: string | null;
  release_rule: ReleaseRuleConfig | null;
  sort_order: number;
  status: string;
  title: string;
  updated_at: string;
};

export const MODULE_COLUMNS = "id,owner_id,title,image,release_rule,sort_order,status,updated_at";

export type LessonRow = {
  description: string | null;
  duration: string | null;
  id: string;
  image: string | null;
  module_id: string;
  release_rule: ReleaseRuleConfig | null;
  sort_order: number;
  status: string;
  title: string;
  updated_at: string;
  video_config: LessonVideoConfig | null;
};

export const LESSON_COLUMNS =
  "id,module_id,title,description,duration,image,video_config,release_rule,sort_order,status,updated_at";

/** Linha devolvida pela RPC admin_product_list (migracao 202610110011). */
export type ProductListRpcRow = {
  access_model: string | null;
  accent: string | null;
  id: string;
  image: string | null;
  kind: string;
  lessons_published: number | null;
  lessons_total: number | null;
  listing: string | null;
  publication_status: string | null;
  purchase_url: string | null;
  students_with_access: number | null;
  title: string;
  total_count: number | null;
  updated_at: string;
};

export type ProductSettings = Record<string, unknown>;

/* ------------------------------------------------------------------------------------------------
 * Pequenos tradutores
 * ---------------------------------------------------------------------------------------------- */

export function coverUrlOf(image: string | null | undefined) {
  const value = image?.trim();

  return value ? value : null;
}

/** /conteudo/{id}?accessPreview=producer (modo de visualizacao do produtor que ja existe). */
export function studentPreviewHrefFor(productId: string) {
  return `/conteudo/${encodeURIComponent(productId)}?accessPreview=producer`;
}

/** A aula aberta no painel, na area do aluno: /conteudo/{produto}/aulas/{modulo}?lessonId={aula}&accessPreview=producer. */
export function studentLessonPreviewHrefFor(productId: string, moduleId: string, lessonId: string) {
  const query = new URLSearchParams({ lessonId, accessPreview: "producer" });

  return `/conteudo/${encodeURIComponent(productId)}/aulas/${encodeURIComponent(moduleId)}?${query.toString()}`;
}

export function productHrefFor(productId: string) {
  return `/admin/produtos/${encodeURIComponent(productId)}`;
}

export function parentFormationIdOf(settings: ProductSettings | null | undefined) {
  const value = settings?.parentFormationId;

  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Cantos do banner gravados em settings.hero.corners; ausente ou invalido = "inherit" (segue Marca > Estilo). */
export function heroCornersOf(settings: ProductSettings | null | undefined): ProductHeroCorners {
  const hero = settings?.hero;
  const corners = hero && typeof hero === "object" && !Array.isArray(hero) ? (hero as { corners?: unknown }).corners : undefined;

  return corners === "rounded" || corners === "soft" ? corners : "inherit";
}

function heroRecordOf(settings: ProductSettings | null | undefined) {
  const hero = settings?.hero;

  return hero && typeof hero === "object" && !Array.isArray(hero)
    ? (hero as { mediaSrc?: unknown; mediaType?: unknown; poster?: unknown; videoOptions?: unknown; youtubeId?: unknown })
    : null;
}

/** Tipo do video de destaque: YouTube (id gravado) ou arquivo direto; null sem video. */
export function heroVideoKindOf(settings: ProductSettings | null | undefined): "file" | "youtube" | null {
  const hero = heroRecordOf(settings);

  if (hero?.mediaType !== "video" || typeof hero.mediaSrc !== "string" || !hero.mediaSrc.trim()) {
    return null;
  }

  return typeof hero.youtubeId === "string" && hero.youtubeId ? "youtube" : "file";
}

/** Opcoes do video de destaque com os padroes preenchidos. */
export function heroVideoOptionsOf(settings: ProductSettings | null | undefined) {
  return normalizeHeroVideoOptions(heroRecordOf(settings)?.videoOptions);
}

/** Imagem de destaque: a imagem do banner ou, quando o destaque e um video, a capa (poster) dele. */
export function heroUrlOf(settings: ProductSettings | null | undefined) {
  const hero = heroRecordOf(settings);
  const source = hero?.mediaType === "video" ? hero.poster : hero?.mediaSrc;

  return typeof source === "string" && source.trim() ? source.trim() : null;
}

/** Link do video de destaque (settings.hero com mediaType "video"); null quando o destaque e so imagem. */
export function heroVideoUrlOf(settings: ProductSettings | null | undefined) {
  const hero = heroRecordOf(settings);

  return hero?.mediaType === "video" && typeof hero.mediaSrc === "string" && hero.mediaSrc.trim() ? hero.mediaSrc.trim() : null;
}

export function instructorNameOf(instructor: ProductRow["instructor"]) {
  const name = instructor?.name?.trim();

  return name ? name : null;
}

/** Texto do botao gravado: "Comprar" e o padrao derivado, nao um texto proprio do produtor. */
export function customPurchaseLabelOf(stored: string | null | undefined) {
  const value = stored?.trim();

  return value && value !== "Comprar" ? value : null;
}

export function lessonStatusOf(status: string | null | undefined): LessonStatus {
  return status === "published" ? "published" : "draft";
}

/* ------------------------------------------------------------------------------------------------
 * Duracao
 * ---------------------------------------------------------------------------------------------- */

/** "Duracao nao informada" (importacao antiga) e vazio nao sao duracao. */
export function durationLabelOf(duration: string | null | undefined) {
  const value = duration?.trim();

  if (!value || /n[aã]o informad/i.test(value)) {
    return null;
  }

  return value;
}

/**
 * Segundos de um rotulo gravado: "6:12", "1:02:03", "15 min", "1 h 20 min", "2h", "45min".
 * Rotulo desconhecido devolve null (nao entra na soma).
 */
export function parseDurationSeconds(label: string | null | undefined): number | null {
  const value = durationLabelOf(label)?.toLowerCase();

  if (!value) {
    return null;
  }

  const clock = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})$/.exec(value);

  if (clock) {
    const hours = Number(clock[1] ?? 0);
    const minutes = Number(clock[2]);
    const seconds = Number(clock[3]);

    return seconds < 60 ? hours * 3_600 + minutes * 60 + seconds : null;
  }

  const words = /^(?:(\d{1,3})\s*h(?:oras?|rs?)?)?\s*(?:(\d{1,4})\s*(?:min(?:utos?)?|m))?\s*(?:(\d{1,2})\s*s(?:eg(?:undos?)?)?)?$/.exec(value);

  if (words && (words[1] || words[2] || words[3])) {
    return Number(words[1] ?? 0) * 3_600 + Number(words[2] ?? 0) * 60 + Number(words[3] ?? 0);
  }

  return null;
}

/** Duracao de uma aula vinda do provedor, no mesmo formato da importacao do YouTube ("6:12", "1:02:03"). */
export function formatClockDuration(totalSeconds: number | null | undefined) {
  if (!totalSeconds || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return null;
  }

  const whole = Math.round(totalSeconds);
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const seconds = whole % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Soma das duracoes para "Duração total": "3 h 20 min", "45 min"; null sem nenhuma duracao conhecida. */
export function formatDurationTotal(durations: readonly (string | null | undefined)[]) {
  let total = 0;
  let known = 0;

  for (const duration of durations) {
    const seconds = parseDurationSeconds(duration);

    if (seconds !== null) {
      total += seconds;
      known += 1;
    }
  }

  if (known === 0 || total <= 0) {
    return null;
  }

  const minutes = Math.max(1, Math.round(total / 60));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
  }

  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/* ------------------------------------------------------------------------------------------------
 * Video
 * ---------------------------------------------------------------------------------------------- */

export function videoSummaryOf(config: unknown): LessonVideoSummary | null {
  const video = normalizeLessonVideoConfig(config);

  return video ? { label: VIDEO_PROVIDER_LABELS[video.provider], provider: video.provider } : null;
}

/** Texto que preenche "Cole o link do vídeo" a partir do que esta gravado. */
export function videoInputOf(config: unknown) {
  const video = normalizeLessonVideoConfig(config);

  if (!video) {
    return "";
  }

  if (video.provider === "youtube" && video.assetId && /^[A-Za-z0-9_-]{11}$/.test(video.assetId)) {
    return `https://www.youtube.com/watch?v=${video.assetId}`;
  }

  if (video.provider === "vimeo" && !video.url && video.assetId) {
    return `https://vimeo.com/${video.assetId}`;
  }

  return video.url ?? "";
}

/** Miniatura da aula: a gravada, senao a do YouTube; os demais provedores ficam sem. */
export function lessonThumbnailOf(image: string | null | undefined, config: unknown) {
  const stored = image?.trim();

  if (stored && /^https:\/\//i.test(stored)) {
    return stored;
  }

  const video = normalizeLessonVideoConfig(config);

  if (video?.provider === "youtube") {
    const id = video.assetId ?? /[?&]v=([A-Za-z0-9_-]{11})/.exec(video.url ?? "")?.[1];

    if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) {
      return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
  }

  return null;
}

/**
 * Ao trocar o video da aula, a miniatura acompanha quando nao ha imagem ou quando ela veio do provedor
 * (YouTube ou Vimeo); uma imagem enviada pelo produtor no admin antigo nunca e sobrescrita.
 */
export function shouldRefreshLessonThumbnail(image: string | null | undefined) {
  const value = image?.trim();

  return !value || /^https:\/\/(?:i\.ytimg\.com|i\.vimeocdn\.com)\//i.test(value);
}

/* ------------------------------------------------------------------------------------------------
 * Produto
 * ---------------------------------------------------------------------------------------------- */

/** Formato do produto; null para linhas que nao sao produto ("Aula"). */
export function productFormatOf(row: { kind: string }): ProductFormat | null {
  return formatFromKind(row.kind);
}

export function buildProductHeader(
  row: ProductRow,
  settings: ProductSettings | null | undefined,
  parentFormation: { id: string; title: string } | null
): ProductHeader | null {
  const format = productFormatOf(row);

  if (!format) {
    return null;
  }

  const situation = situationFromPublicationStatus(row.publication_status);

  return {
    accent: resolveProductAccent(row.id, settings?.accent),
    audience: audienceFromColumns({ accessModel: row.access_model, listing: row.listing }),
    coverUrl: coverUrlOf(row.image),
    format,
    formatLabel: PRODUCT_FORMAT_LABELS[format],
    id: row.id,
    parentFormation,
    situation,
    situationLabel: PRODUCT_SITUATION_LABELS[situation],
    studentPreviewHref: studentPreviewHrefFor(row.id),
    title: row.title,
    updatedAt: row.updated_at
  };
}

export function mapProductListRow(row: ProductListRpcRow): ProductListItem | null {
  const format = formatFromKind(row.kind);

  if (!format) {
    return null;
  }

  const audience = audienceFromColumns({ accessModel: row.access_model, listing: row.listing });
  const situation = situationFromPublicationStatus(row.publication_status);

  return {
    accent: resolveProductAccent(row.id, row.accent),
    audience,
    audienceLabel: PRODUCT_AUDIENCE_LABELS[audience],
    comingSoon: isComingSoonForVisitors({ audience, purchaseUrl: row.purchase_url, situation }),
    coverUrl: coverUrlOf(row.image),
    format,
    formatLabel: PRODUCT_FORMAT_LABELS[format],
    id: row.id,
    lessonsPublished: Number(row.lessons_published ?? 0),
    lessonsTotal: Number(row.lessons_total ?? 0),
    situation,
    situationLabel: PRODUCT_SITUATION_LABELS[situation],
    studentsWithAccess: Number(row.students_with_access ?? 0),
    studyingLast7d: null,
    title: row.title,
    updatedAt: row.updated_at
  };
}

/* ------------------------------------------------------------------------------------------------
 * Árvore de conteúdo
 * ---------------------------------------------------------------------------------------------- */

function bySortOrder(left: { id: string; sort_order: number }, right: { id: string; sort_order: number }) {
  return left.sort_order - right.sort_order || left.id.localeCompare(right.id);
}

export function mapLessonNode(row: LessonRow, position: number): LessonNode {
  const release = releaseRuleToPhrase(row.release_rule);

  return {
    durationLabel: durationLabelOf(row.duration),
    id: row.id,
    moduleId: row.module_id,
    position,
    release,
    releaseLabel: describeReleasePhrase(release),
    status: lessonStatusOf(row.status),
    title: row.title,
    updatedAt: row.updated_at,
    video: videoSummaryOf(row.video_config)
  };
}

export function mapModuleNode(row: ModuleRow, position: number, lessons: readonly LessonRow[]): ModuleNode {
  const release = releaseRuleToPhrase(row.release_rule);

  return {
    coverUrl: coverUrlOf(row.image),
    id: row.id,
    lessons: lessons
      .filter((lesson) => lesson.module_id === row.id && lesson.status !== "deleted")
      .sort(bySortOrder)
      .map((lesson, index) => mapLessonNode(lesson, index + 1)),
    position,
    release,
    releaseLabel: describeReleasePhrase(release),
    title: row.title,
    updatedAt: row.updated_at
  };
}

/** Modulos e aulas nao excluidos, na ordem gravada, com posicoes 1..n. */
export function buildModuleTree(modules: readonly ModuleRow[], lessons: readonly LessonRow[]): ModuleNode[] {
  return modules
    .filter((module) => module.status !== "deleted")
    .slice()
    .sort(bySortOrder)
    .map((module, index) => mapModuleNode(module, index + 1, lessons));
}

export function countTree(modules: readonly ModuleNode[]) {
  const lessons = modules.flatMap((module) => module.lessons);

  return {
    lessons: lessons.length,
    modules: modules.length,
    publishedLessons: lessons.filter((lesson) => lesson.status === "published").length
  };
}

/** "Módulo 1, aula 1 de 4" (linha de apoio do painel da aula, depois do nome do produto, como no prototipo). */
export function lessonPositionLabel(module: { position: number; title: string }, lessonPosition: number, lessonsInModule: number) {
  return `Módulo ${module.position}, aula ${lessonPosition} de ${lessonsInModule}`;
}

/** Aula anterior e proxima no produto inteiro (atravessando modulos), para o painel da aula. */
export function neighborLessonIds(modules: readonly ModuleNode[], lessonId: string) {
  const ids = modules.flatMap((module) => module.lessons.map((lesson) => lesson.id));
  const index = ids.indexOf(lessonId);

  return {
    nextLessonId: index >= 0 && index < ids.length - 1 ? ids[index + 1] : null,
    previousLessonId: index > 0 ? ids[index - 1] : null
  };
}

/** Aulas que o aluno ve: aula publicada dentro de modulo publicado (nao excluidos). */
export function publishedLessonRows(modules: readonly ModuleRow[], lessons: readonly LessonRow[]) {
  const publishedModuleIds = new Set(modules.filter((module) => module.status === "published").map((module) => module.id));

  return lessons.filter((lesson) => lesson.status === "published" && publishedModuleIds.has(lesson.module_id));
}

export type LessonCounts = { lessonsPublished: number; lessonsTotal: number; modules: number };

/** Contagem por dono (produto ou curso incluido) a partir de linhas minimas. */
export function countLessonsByOwner(
  modules: readonly Pick<ModuleRow, "id" | "owner_id" | "status">[],
  lessons: readonly Pick<LessonRow, "module_id" | "status">[]
) {
  const counts = new Map<string, LessonCounts>();
  const moduleOwner = new Map<string, { owner: string; published: boolean }>();

  for (const moduleRow of modules) {
    if (!moduleRow.owner_id || moduleRow.status === "deleted") {
      continue;
    }

    moduleOwner.set(moduleRow.id, { owner: moduleRow.owner_id, published: moduleRow.status === "published" });
    const current = counts.get(moduleRow.owner_id) ?? { lessonsPublished: 0, lessonsTotal: 0, modules: 0 };
    current.modules += 1;
    counts.set(moduleRow.owner_id, current);
  }

  for (const lesson of lessons) {
    const owner = moduleOwner.get(lesson.module_id);

    if (!owner || lesson.status === "deleted") {
      continue;
    }

    const current = counts.get(owner.owner) ?? { lessonsPublished: 0, lessonsTotal: 0, modules: 0 };
    current.lessonsTotal += 1;

    if (lesson.status === "published" && owner.published) {
      current.lessonsPublished += 1;
    }

    counts.set(owner.owner, current);
  }

  return counts;
}

export function mapFormationCourse(
  row: Pick<ProductRow, "id" | "image" | "publication_status" | "title">,
  settings: ProductSettings | null | undefined,
  counts: LessonCounts | undefined,
  position: number
): FormationCourseItem {
  const situation = situationFromPublicationStatus(row.publication_status);

  return {
    accent: resolveProductAccent(row.id, settings?.accent),
    coverUrl: coverUrlOf(row.image),
    id: row.id,
    lessonsPublished: counts?.lessonsPublished ?? 0,
    lessonsTotal: counts?.lessonsTotal ?? 0,
    position,
    situation,
    situationLabel: PRODUCT_SITUATION_LABELS[situation],
    title: row.title
  };
}
