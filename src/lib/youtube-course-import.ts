export const youtubeCourseNamingExample = "C01 - Curso | M01 - Fundamentos | A01 - Boas-vindas";
export const youtubeCourseLegacyNamingExample = "M01 - Fundamentos | A01 - Boas-vindas";

export type YouTubeCourseOrganizationMode = "automatic" | "manual_ranges";

export type YouTubeCourseImportModuleRange = {
  endPosition: number;
  startPosition: number;
  title: string;
};

export type YouTubePlaylistSourceItem = {
  description?: string;
  durationSeconds?: number;
  position: number;
  thumbnailUrl?: string;
  title: string;
  videoId: string;
};

export type YouTubeCourseImportLesson = {
  duration: string;
  durationSeconds?: number;
  order: number;
  originalTitle: string;
  sourcePosition: number;
  thumbnailUrl?: string;
  title: string;
  videoId: string;
};

export type YouTubeCourseImportModule = {
  lessons: YouTubeCourseImportLesson[];
  order: number;
  title: string;
};

export type YouTubeCourseImportPreview = {
  description: string;
  modules: YouTubeCourseImportModule[];
  naming: {
    compliantLessons: number;
    totalLessons: number;
  };
  organizationMode: YouTubeCourseOrganizationMode;
  playlistId: string;
  playlistUrl: string;
  thumbnailUrl?: string;
  title: string;
  totalLessons: number;
  videos: YouTubePlaylistSourceItem[];
  warnings: string[];
};

export type YouTubeCourseImportCommitInput = {
  accessModel: "closed" | "free";
  coursePresentationMode: "lesson_playlist" | "module_cards";
  description: string;
  image: string;
  moduleRanges: YouTubeCourseImportModuleRange[];
  organizationMode: YouTubeCourseOrganizationMode;
  playlistUrl: string;
  title: string;
};

const fullLessonTitle = /^\s*C(\d{1,3})\s*[-–—·:]\s*(.+?)\s*\|\s*M(\d{1,3})\s*[-–—·:]\s*(.+?)\s*\|\s*A(\d{1,3})\s*[-–—·:]\s*(.+?)\s*$/i;
const compactFullLessonTitle = /^\s*C(\d{1,3})\s*M(\d{1,3})\s*A(\d{1,3})\s*[-–—·:]\s*(.+?)\s*$/i;
const canonicalLessonTitle = /^\s*M(\d{1,3})\s*[-–—·:]\s*(.+?)\s*\|\s*A(\d{1,3})\s*[-–—·:]\s*(.+?)\s*$/i;
const compactLessonTitle = /^\s*M(\d{1,3})\s*A(\d{1,3})\s*[-–—·:]\s*(.+?)\s*$/i;
const playlistIdPattern = /^[A-Za-z0-9_-]{10,80}$/;

function positiveOrder(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function extractYouTubePlaylistId(value: string) {
  const normalized = value.trim();

  if (playlistIdPattern.test(normalized)) {
    return normalized;
  }

  let url: URL;

  try {
    url = new URL(normalized);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");

  if (!(hostname === "youtube.com" || hostname === "m.youtube.com" || hostname === "music.youtube.com")) {
    return null;
  }

  const playlistId = url.searchParams.get("list")?.trim() ?? "";
  return playlistIdPattern.test(playlistId) ? playlistId : null;
}

export function formatLessonDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) {
    return "Duracao nao informada";
  }

  const wholeSeconds = Math.round(seconds);
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainingSeconds = wholeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function parseYouTubeCourseLessonTitle(value: string) {
  const fullMatch = fullLessonTitle.exec(value);

  if (fullMatch) {
    const courseOrder = positiveOrder(fullMatch[1]);
    const moduleOrder = positiveOrder(fullMatch[3]);
    const lessonOrder = positiveOrder(fullMatch[5]);

    if (courseOrder && moduleOrder && lessonOrder) {
      return {
        courseOrder,
        courseTitle: fullMatch[2].trim(),
        lessonOrder,
        lessonTitle: fullMatch[6].trim(),
        moduleOrder,
        moduleTitle: fullMatch[4].trim()
      };
    }
  }

  const compactFullMatch = compactFullLessonTitle.exec(value);

  if (compactFullMatch) {
    const courseOrder = positiveOrder(compactFullMatch[1]);
    const moduleOrder = positiveOrder(compactFullMatch[2]);
    const lessonOrder = positiveOrder(compactFullMatch[3]);

    if (courseOrder && moduleOrder && lessonOrder) {
      return {
        courseOrder,
        courseTitle: `Curso ${String(courseOrder).padStart(2, "0")}`,
        lessonOrder,
        lessonTitle: compactFullMatch[4].trim(),
        moduleOrder,
        moduleTitle: `Modulo ${String(moduleOrder).padStart(2, "0")}`
      };
    }
  }

  const canonicalMatch = canonicalLessonTitle.exec(value);

  if (canonicalMatch) {
    const moduleOrder = positiveOrder(canonicalMatch[1]);
    const lessonOrder = positiveOrder(canonicalMatch[3]);

    if (moduleOrder && lessonOrder) {
      return {
        courseOrder: undefined,
        courseTitle: undefined,
        lessonOrder,
        lessonTitle: canonicalMatch[4].trim(),
        moduleOrder,
        moduleTitle: canonicalMatch[2].trim()
      };
    }
  }

  const compactMatch = compactLessonTitle.exec(value);

  if (compactMatch) {
    const moduleOrder = positiveOrder(compactMatch[1]);
    const lessonOrder = positiveOrder(compactMatch[2]);

    if (moduleOrder && lessonOrder) {
      return {
        courseOrder: undefined,
        courseTitle: undefined,
        lessonOrder,
        lessonTitle: compactMatch[3].trim(),
        moduleOrder,
        moduleTitle: `Modulo ${String(moduleOrder).padStart(2, "0")}`
      };
    }
  }

  return null;
}

function normalizePlaylistItems(items: YouTubePlaylistSourceItem[]) {
  const seenVideoIds = new Set<string>();

  return [...items]
    .sort((left, right) => left.position - right.position)
    .filter((item) => {
      if (!/^[A-Za-z0-9_-]{11}$/.test(item.videoId) || seenVideoIds.has(item.videoId)) {
        return false;
      }

      seenVideoIds.add(item.videoId);
      return true;
    });
}

function lessonFromSourceItem(item: YouTubePlaylistSourceItem, order: number, title?: string): YouTubeCourseImportLesson {
  return {
    duration: formatLessonDuration(item.durationSeconds),
    durationSeconds: item.durationSeconds,
    order,
    originalTitle: item.title,
    sourcePosition: item.position,
    thumbnailUrl: item.thumbnailUrl,
    title: title?.trim() || item.title.trim(),
    videoId: item.videoId
  };
}

function buildManualModules(items: YouTubePlaylistSourceItem[], ranges: YouTubeCourseImportModuleRange[]) {
  if (!Array.isArray(ranges) || ranges.length === 0 || ranges.length > 100) {
    throw new Error("Defina entre 1 e 100 modulos para organizar a playlist.");
  }

  const positions = new Set(items.map((item) => item.position));
  const assignedPositions = new Set<number>();
  const normalizedRanges = ranges.map((range, index) => {
    const title = typeof range.title === "string" ? range.title.trim() : "";
    const startPosition = Number(range.startPosition);
    const endPosition = Number(range.endPosition);

    if (!title || title.length > 180) {
      throw new Error(`Informe um nome valido para o modulo ${index + 1}.`);
    }

    if (!Number.isInteger(startPosition) || !Number.isInteger(endPosition) || startPosition <= 0 || endPosition < startPosition) {
      throw new Error(`O intervalo do modulo “${title}” e invalido.`);
    }

    const lessons = items.filter((item) => item.position >= startPosition && item.position <= endPosition);

    if (lessons.length === 0) {
      throw new Error(`O modulo “${title}” nao contem nenhum video disponivel.`);
    }

    for (const lesson of lessons) {
      if (assignedPositions.has(lesson.position)) {
        throw new Error(`O video ${lesson.position} aparece em mais de um modulo.`);
      }
      assignedPositions.add(lesson.position);
    }

    return {
      endPosition,
      lessons,
      startPosition,
      title
    };
  }).sort((left, right) => left.startPosition - right.startPosition);

  const missingPositions = [...positions].filter((position) => !assignedPositions.has(position));

  if (missingPositions.length > 0) {
    const sample = missingPositions.slice(0, 5).join(", ");
    throw new Error(`${missingPositions.length} video${missingPositions.length === 1 ? " nao foi atribuido" : "s nao foram atribuidos"} a um modulo${sample ? `: ${sample}${missingPositions.length > 5 ? "..." : ""}` : ""}.`);
  }

  return normalizedRanges.map((range, moduleIndex) => ({
    lessons: range.lessons.map((item, lessonIndex) => {
      const parsed = parseYouTubeCourseLessonTitle(item.title);
      return lessonFromSourceItem(item, lessonIndex + 1, parsed?.lessonTitle);
    }),
    order: moduleIndex + 1,
    title: range.title
  }));
}

export function suggestYouTubeCourseModuleRanges(preview: YouTubeCourseImportPreview): YouTubeCourseImportModuleRange[] {
  const positions = preview.videos.map((video) => video.position);

  if (positions.length === 0) {
    return [];
  }

  const ranges = preview.modules.map((courseModule) => ({
    endPosition: Math.max(...courseModule.lessons.map((lesson) => lesson.sourcePosition)),
    startPosition: Math.min(...courseModule.lessons.map((lesson) => lesson.sourcePosition)),
    title: courseModule.title
  })).sort((left, right) => left.startPosition - right.startPosition);

  try {
    buildManualModules(preview.videos, ranges);
    return ranges;
  } catch {
    return [{
      endPosition: Math.max(...positions),
      startPosition: Math.min(...positions),
      title: "Conteudo do curso"
    }];
  }
}

export function rebuildYouTubeCoursePreviewWithRanges(
  preview: YouTubeCourseImportPreview,
  ranges: YouTubeCourseImportModuleRange[]
) {
  return buildYouTubeCourseImportPreview({
    description: preview.description,
    items: preview.videos,
    moduleRanges: ranges,
    organizationMode: "manual_ranges",
    playlistId: preview.playlistId,
    title: preview.title
  });
}

export function buildYouTubeCourseImportPreview(input: {
  description?: string;
  items: YouTubePlaylistSourceItem[];
  moduleRanges?: YouTubeCourseImportModuleRange[];
  organizationMode?: YouTubeCourseOrganizationMode;
  playlistId: string;
  title: string;
}) {
  if (!playlistIdPattern.test(input.playlistId)) {
    throw new Error("Playlist do YouTube invalida.");
  }

  const warnings: string[] = [];
  const organizationMode = input.organizationMode ?? "automatic";
  const items = normalizePlaylistItems(input.items);

  if (items.length === 0) {
    throw new Error("Nenhuma aula valida foi encontrada nesta playlist.");
  }

  if (organizationMode === "manual_ranges") {
    const modules = buildManualModules(items, input.moduleRanges ?? []);
    const firstThumbnail = items.find((item) => item.thumbnailUrl)?.thumbnailUrl;

    return {
      description: input.description?.trim() ?? "",
      modules,
      naming: {
        compliantLessons: items.filter((item) => Boolean(parseYouTubeCourseLessonTitle(item.title))).length,
        totalLessons: items.length
      },
      organizationMode,
      playlistId: input.playlistId,
      playlistUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(input.playlistId)}`,
      thumbnailUrl: firstThumbnail,
      title: input.title.trim() || "Curso importado",
      totalLessons: items.length,
      videos: items,
      warnings
    } satisfies YouTubeCourseImportPreview;
  }

  const moduleMap = new Map<number, YouTubeCourseImportModule>();
  const fallbackLessons: YouTubeCourseImportLesson[] = [];
  let unrecognizedTitles = 0;
  const courseTitles = new Set<string>();

  for (const item of items) {
    const parsed = parseYouTubeCourseLessonTitle(item.title);
    if (!parsed) {
      unrecognizedTitles += 1;
      fallbackLessons.push(lessonFromSourceItem(item, fallbackLessons.length + 1));
      continue;
    }

    if (parsed.courseTitle) {
      courseTitles.add(parsed.courseTitle);
    }

    const moduleOrder = parsed.moduleOrder;
    const moduleTitle = parsed.moduleTitle;
    const currentModule = moduleMap.get(moduleOrder) ?? {
      lessons: [],
      order: moduleOrder,
      title: moduleTitle
    };

    if (currentModule.title !== moduleTitle) {
      warnings.push(`O modulo ${String(moduleOrder).padStart(2, "0")} apareceu com nomes diferentes; foi mantido “${currentModule.title}”.`);
    }

    const requestedLessonOrder = parsed.lessonOrder;
    const duplicatedOrder = currentModule.lessons.some((lesson) => lesson.order === requestedLessonOrder);

    currentModule.lessons.push(lessonFromSourceItem(
      item,
      duplicatedOrder ? currentModule.lessons.length + 1 : requestedLessonOrder,
      parsed.lessonTitle
    ));
    moduleMap.set(moduleOrder, currentModule);
  }

  if (courseTitles.size > 1) {
    warnings.push("Os videos informam nomes de curso diferentes. Revise a nomenclatura antes de publicar.");
  }

  if (unrecognizedTitles > 0) {
    warnings.push(
      `${unrecognizedTitles} aula${unrecognizedTitles === 1 ? " nao segue" : "s nao seguem"} o padrao “${youtubeCourseNamingExample}” e ${unrecognizedTitles === 1 ? "foi agrupada" : "foram agrupadas"} em Conteudo do curso.`
    );
  }

  const recognizedModules = [...moduleMap.values()].sort((left, right) => left.order - right.order);
  const fallbackModule = fallbackLessons.length > 0
    ? [{
        lessons: fallbackLessons,
        order: Math.max(0, ...recognizedModules.map((courseModule) => courseModule.order)) + 1,
        title: "Conteudo do curso"
      }]
    : [];
  const modules = [...recognizedModules, ...fallbackModule]
    .map((courseModule) => ({
      ...courseModule,
      lessons: [...courseModule.lessons].sort((left, right) => left.order - right.order)
    }));
  const firstThumbnail = modules.flatMap((courseModule) => courseModule.lessons).find((lesson) => lesson.thumbnailUrl)?.thumbnailUrl;

  return {
    description: input.description?.trim() ?? "",
    modules,
    naming: {
      compliantLessons: items.length - unrecognizedTitles,
      totalLessons: items.length
    },
    organizationMode,
    playlistId: input.playlistId,
    playlistUrl: `https://www.youtube.com/playlist?list=${encodeURIComponent(input.playlistId)}`,
    thumbnailUrl: firstThumbnail,
    title: input.title.trim() || "Curso importado",
    totalLessons: modules.reduce((sum, courseModule) => sum + courseModule.lessons.length, 0),
    videos: items,
    warnings: Array.from(new Set(warnings))
  } satisfies YouTubeCourseImportPreview;
}
