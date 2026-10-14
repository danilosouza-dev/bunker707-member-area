// Favoritos: o recorte que a tela mostra. A lista vem de getFavoritesPageData (tudo que o aluno salvou,
// inclusive o que ele nao pode abrir, marcado com isLocked/parentIsLocked); progresso e liberacao vem da
// biblioteca do aluno (getMemberLibrary), so para o que ele pode abrir. Nunca usa
// content_items.progress/status (colunas globais).
//
// Favoritar nao libera acesso: item sem acesso aparece como "Sem acesso" e leva para a pagina do
// produto, sem thumbnail de video (o endereco da thumbnail revelaria o video).
//
// Modulo puro (sem "server-only" e sem alias "@/") para os testes rodarem com node --test.

import {
  formatMemberCount,
  formatMemberRelativeTime,
  formatMemberRemaining
} from "../../lib/member-format";
import {
  getMemberContentHref,
  getMemberLessonHref,
  indexMemberLibrary,
  memberContentKindLabels,
  memberProgressStatusLabels,
  summarizeMemberContentProgress,
  type MemberLibrary,
  type MemberLibraryContent,
  type MemberLibraryLesson,
  type MemberLibraryModule
} from "../../lib/member-library";
import { withAccessPreviewParam } from "../../lib/access-preview";
import type { ContentItem, SavedItemTargetType, SavedLessonItem, SavedModuleItem } from "../../lib/platform-types";
import { getSavedItemKey, getSavedTargetTypeForContentKind } from "../../lib/saved-items";
import { normalizeMemberSearchText } from "./purchases-view";

export type FavoriteItemKind = "content" | "lesson" | "module";
export type FavoriteKindFilter = "all" | FavoriteItemKind;

export type FavoriteItemView = {
  /** false = o aluno nao pode abrir (sem compra/acesso): leva para a pagina do produto. */
  canOpen: boolean;
  /** Onde o item esta: "Curso de IA" ou "Curso de IA · Módulo 2". */
  context: string | null;
  href: string;
  /** Imagem do card. Aula sem acesso ou nao liberada nunca leva thumbnail de video. "" = sem imagem. */
  image: string;
  /** Chave do favorito (tipo:id), igual a do evento savedItemChangedEvent. */
  key: string;
  kind: FavoriteItemKind;
  kindLabel: string;
  /** Linha discreta: "12 de 40 aulas", "Assistida há 2 dias"... */
  meta: string | null;
  /** Progresso do aluno; null quando nao comecou ou sem acesso. */
  progress: { completed: boolean; percent: number } | null;
  /** Ainda nao liberado pela regra de liberacao ("Liberação em 08/01/2026"). */
  releaseLabel: string | null;
  searchText: string;
  /** "Concluído", "Em andamento", "Concluída"... null quando nao ha o que dizer. */
  statusLabel: string | null;
  targetId: string;
  targetType: SavedItemTargetType;
  /** Selo na miniatura da aula: "faltam 12min" ou a duracao. */
  thumbnailLabel: string | null;
  title: string;
};

export type FavoritesPageView = {
  /** Proximo passo do estado vazio: pagina inicial (com a previa, quando houver). */
  exploreHref: string;
  items: FavoriteItemView[];
};

export type FavoritesSource = {
  savedContentItems: ContentItem[];
  savedLessonItems: SavedLessonItem[];
  savedModuleItems: SavedModuleItem[];
};

type LessonLocation = { content: MemberLibraryContent; lesson: MemberLibraryLesson; module: MemberLibraryModule };
type ModuleLocation = { content: MemberLibraryContent; module: MemberLibraryModule };

const NO_ACCESS_LABEL = "Sem acesso";
const VIDEO_THUMBNAIL_PATTERN = /^https?:\/\/(?:[a-z0-9-]+\.)*(?:ytimg\.com|youtube\.com|youtube-nocookie\.com|vimeocdn\.com)\//i;

/** Thumbnail de video (YouTube/Vimeo) revela o video: so pode ir para quem pode assistir a aula. */
export function isVideoThumbnailUrl(value: string | null | undefined) {
  return Boolean(value && VIDEO_THUMBNAIL_PATTERN.test(value.trim()));
}

function indexLibraryLessons(library: MemberLibrary) {
  const modules = new Map<string, ModuleLocation>();
  const lessons = new Map<string, LessonLocation>();

  for (const content of library.contents) {
    for (const courseModule of content.modules) {
      if (!modules.has(courseModule.id)) modules.set(courseModule.id, { content, module: courseModule });

      for (const lesson of courseModule.lessons) {
        if (!lessons.has(lesson.id)) lessons.set(lesson.id, { content, lesson, module: courseModule });
      }
    }
  }

  return { lessons, modules };
}

function joinContext(...parts: Array<string | null | undefined>) {
  const text = parts.map((part) => part?.trim()).filter(Boolean).join(" · ");
  return text || null;
}

function toSearchText(...parts: Array<string | null | undefined>) {
  return normalizeMemberSearchText(parts.filter(Boolean).join(" "));
}

function toContentFavorite(
  item: ContentItem,
  library: MemberLibrary,
  contentsById: ReadonlyMap<string, MemberLibraryContent>
): FavoriteItemView {
  const targetType = getSavedTargetTypeForContentKind(item.kind);
  const kindLabel = memberContentKindLabels[item.kind] ?? item.kind;
  const libraryContent = contentsById.get(item.id);
  const base = {
    context: item.eyebrow?.trim() || null,
    image: item.image,
    key: getSavedItemKey(targetType, item.id),
    kind: "content" as const,
    kindLabel,
    targetId: item.id,
    targetType,
    thumbnailLabel: null,
    title: item.title
  };

  if (item.isLocked) {
    return {
      ...base,
      canOpen: false,
      href: getMemberContentHref(item.id, library.accessPreviewMode),
      meta: null,
      progress: null,
      releaseLabel: null,
      searchText: toSearchText(item.title, item.eyebrow, kindLabel, NO_ACCESS_LABEL),
      statusLabel: NO_ACCESS_LABEL
    };
  }

  if (!libraryContent) {
    // Acesso liberado (ex.: conteudo gratuito fora da biblioteca), mas sem aulas conhecidas aqui.
    return {
      ...base,
      canOpen: true,
      href: getMemberContentHref(item.id, library.accessPreviewMode),
      meta: null,
      progress: null,
      releaseLabel: null,
      searchText: toSearchText(item.title, item.eyebrow, kindLabel),
      statusLabel: null
    };
  }

  const summary = summarizeMemberContentProgress(libraryContent, contentsById, library.accessPreviewMode);
  const statusLabel = memberProgressStatusLabels[summary.status];
  const meta = summary.totalLessons === 0
    ? "Aulas em breve"
    : summary.status === "not_started"
      ? formatMemberCount(summary.totalLessons, "aula")
      : `${summary.completedLessons.toLocaleString("pt-BR")} de ${formatMemberCount(summary.totalLessons, "aula")}`;

  return {
    ...base,
    canOpen: true,
    href: libraryContent.href,
    meta,
    progress: summary.status === "not_started" ? null : { completed: summary.status === "completed", percent: summary.percent },
    releaseLabel: libraryContent.isReleaseLocked ? libraryContent.releaseLabel ?? "Aguardando liberação" : null,
    searchText: toSearchText(item.title, item.eyebrow, kindLabel, statusLabel),
    statusLabel: summary.status === "not_started" ? null : statusLabel
  };
}

function toModuleFavorite(module: SavedModuleItem, library: MemberLibrary, modules: ReadonlyMap<string, ModuleLocation>): FavoriteItemView {
  const location = modules.get(module.id);
  const base = {
    image: module.image,
    key: getSavedItemKey("module", module.id),
    kind: "module" as const,
    kindLabel: "Módulo",
    targetId: module.id,
    targetType: "module" as const,
    thumbnailLabel: null,
    title: module.title
  };

  if (module.parentIsLocked) {
    return {
      ...base,
      canOpen: false,
      context: joinContext(module.parentContentTitle),
      href: getMemberContentHref(module.parentContentId, library.accessPreviewMode),
      meta: null,
      progress: null,
      releaseLabel: null,
      searchText: toSearchText(module.title, module.parentContentTitle, "Módulo", NO_ACCESS_LABEL),
      statusLabel: NO_ACCESS_LABEL
    };
  }

  const contentId = location?.content.id ?? module.parentContentId;
  const href = withAccessPreviewParam(
    `/conteudo/${encodeURIComponent(contentId)}/aulas/${encodeURIComponent(module.id)}`,
    library.accessPreviewMode
  );
  const context = joinContext(location?.content.title ?? module.parentContentTitle);

  if (!location) {
    return {
      ...base,
      canOpen: true,
      context,
      href,
      meta: module.meta?.trim() || null,
      progress: null,
      releaseLabel: null,
      searchText: toSearchText(module.title, module.parentContentTitle, "Módulo"),
      statusLabel: null
    };
  }

  const lessons = location.module.lessons;
  const completed = lessons.filter((lesson) => lesson.completed).length;
  const started = completed > 0 || lessons.some((lesson) => (lesson.watch?.progressPercent ?? 0) > 0);
  const isCompleted = lessons.length > 0 && completed === lessons.length;
  const percent = lessons.length > 0 ? Math.round((completed / lessons.length) * 100) : 0;
  const statusLabel = isCompleted ? memberProgressStatusLabels.completed : started ? memberProgressStatusLabels.in_progress : null;

  return {
    ...base,
    canOpen: true,
    context,
    href,
    meta: lessons.length === 0
      ? "Aulas em breve"
      : started
        ? `${completed.toLocaleString("pt-BR")} de ${formatMemberCount(lessons.length, "aula")}`
        : formatMemberCount(lessons.length, "aula"),
    progress: started ? { completed: isCompleted, percent } : null,
    releaseLabel: location.module.isReleaseLocked ? location.module.releaseLabel ?? "Aguardando liberação" : null,
    searchText: toSearchText(module.title, context, "Módulo", statusLabel),
    statusLabel
  };
}

function toLessonFavorite(
  lesson: SavedLessonItem,
  library: MemberLibrary,
  lessons: ReadonlyMap<string, LessonLocation>,
  now: number
): FavoriteItemView {
  const location = lessons.get(lesson.id);
  const base = {
    key: getSavedItemKey("lesson", lesson.id),
    kind: "lesson" as const,
    kindLabel: "Aula",
    targetId: lesson.id,
    targetType: "lesson" as const,
    title: lesson.title
  };

  if (lesson.parentIsLocked) {
    return {
      ...base,
      canOpen: false,
      context: joinContext(lesson.parentContentTitle, lesson.moduleTitle),
      href: getMemberContentHref(lesson.parentContentId, library.accessPreviewMode),
      image: isVideoThumbnailUrl(lesson.image) ? "" : lesson.image,
      meta: null,
      progress: null,
      releaseLabel: null,
      searchText: toSearchText(lesson.title, lesson.parentContentTitle, lesson.moduleTitle, "Aula", NO_ACCESS_LABEL),
      statusLabel: NO_ACCESS_LABEL,
      thumbnailLabel: null
    };
  }

  if (!location) {
    const context = joinContext(lesson.parentContentTitle, lesson.moduleTitle);

    return {
      ...base,
      canOpen: true,
      context,
      href: getMemberLessonHref(lesson.parentContentId, lesson.moduleId, lesson.id, library.accessPreviewMode),
      image: lesson.image,
      meta: null,
      progress: null,
      releaseLabel: null,
      searchText: toSearchText(lesson.title, context, "Aula"),
      statusLabel: null,
      thumbnailLabel: lesson.duration?.trim() || null
    };
  }

  const { content, lesson: libraryLesson, module: libraryModule } = location;
  const context = joinContext(content.title, libraryModule.title);
  const watch = libraryLesson.watch;
  const isCompleted = libraryLesson.completed;
  const inProgress = !isCompleted && Boolean(watch && watch.progressPercent > 0 && watch.progressPercent < 100);
  const remaining = inProgress && watch ? formatMemberRemaining(watch.progressSeconds, watch.durationSeconds) : "";
  const watchedAgo = inProgress && watch ? formatMemberRelativeTime(watch.lastWatchedAt, now) : "";
  const statusLabel = isCompleted ? "Concluída" : inProgress ? "Em andamento" : null;

  return {
    ...base,
    canOpen: true,
    context,
    href: getMemberLessonHref(content.id, libraryModule.id, libraryLesson.id, library.accessPreviewMode),
    // A biblioteca ja tira a thumbnail do video de aula nao liberada; aqui nunca se volta a ela.
    image: libraryLesson.isReleaseLocked
      ? libraryLesson.image || libraryModule.image || ""
      : libraryLesson.image || lesson.image || libraryModule.image || "",
    meta: isCompleted ? "Concluída" : watchedAgo ? `Assistida ${watchedAgo}` : null,
    progress: isCompleted ? { completed: true, percent: 100 } : inProgress && watch ? { completed: false, percent: watch.progressPercent } : null,
    releaseLabel: libraryLesson.isReleaseLocked ? libraryLesson.releaseLabel ?? "Aguardando liberação" : null,
    searchText: toSearchText(lesson.title, context, "Aula", statusLabel),
    statusLabel,
    thumbnailLabel: remaining || libraryLesson.duration?.trim() || lesson.duration?.trim() || null
  };
}

function dedupeByKey(items: FavoriteItemView[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

/**
 * Favoritos do aluno: conteudos, modulos e aulas (nessa ordem), cada um com o progresso dele quando
 * pode abrir. Repetidos (o mesmo conteudo em duas fileiras do catalogo) aparecem uma vez so.
 */
export function buildFavoritesPageView(
  source: FavoritesSource,
  library: MemberLibrary,
  options: { now?: number } = {}
): FavoritesPageView {
  const now = options.now ?? Date.now();
  const contentsById = indexMemberLibrary(library);
  const { lessons, modules } = indexLibraryLessons(library);

  return {
    exploreHref: withAccessPreviewParam("/", library.accessPreviewMode),
    items: dedupeByKey([
      ...source.savedContentItems.map((item) => toContentFavorite(item, library, contentsById)),
      ...source.savedModuleItems.map((item) => toModuleFavorite(item, library, modules)),
      ...source.savedLessonItems.map((item) => toLessonFavorite(item, library, lessons, now))
    ])
  };
}
