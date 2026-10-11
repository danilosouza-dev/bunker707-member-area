// Importar playlist do YouTube (docs/17 §1.6.7): organizar os videos em modulos antes de importar.
// Modulo puro (sem React): a montagem da previa continua em src/lib/youtube-course-import.ts
// (rebuildYouTubeCoursePreviewWithRanges); aqui ficam as edicoes dos intervalos que a tela faz.

import type {
  YouTubeCourseImportModule,
  YouTubeCourseImportModuleRange,
  YouTubeCourseImportPreview,
  YouTubeCourseOrganizationMode,
  YouTubePlaylistSourceItem
} from "@/lib/youtube-course-import";
// Import relativo (e nao "@/"): este modulo e carregado direto pelo Node nos testes.
import { rebuildYouTubeCoursePreviewWithRanges } from "../../../../lib/youtube-course-import";

/** Como organizar, nas palavras do produtor. "single" grava como intervalo manual unico. */
export type PlaylistOrganization = "automatic" | "single" | "manual";

export const PLAYLIST_ORGANIZATION_LABELS: Record<PlaylistOrganization, string> = {
  automatic: "Organizar pelos títulos",
  manual: "Dividir manualmente",
  single: "Tudo em um módulo"
};

export const SINGLE_MODULE_TITLE = "Conteúdo do curso";

type VideoPosition = Pick<YouTubePlaylistSourceItem, "position">;

export function moduleRangeTitle(index: number) {
  return `Módulo ${String(index + 1).padStart(2, "0")}`;
}

/** Modo gravado no pedido de importacao. */
export function organizationModeFor(organization: PlaylistOrganization): YouTubeCourseOrganizationMode {
  return organization === "automatic" ? "automatic" : "manual_ranges";
}

/** Um modulo com todos os videos. */
export function singleModuleRange(videos: readonly VideoPosition[], title = SINGLE_MODULE_TITLE): YouTubeCourseImportModuleRange[] {
  if (videos.length === 0) {
    return [];
  }

  const positions = videos.map((video) => video.position);

  return [{ endPosition: Math.max(...positions), startPosition: Math.min(...positions), title }];
}

function videosInRange(videos: readonly VideoPosition[], range: YouTubeCourseImportModuleRange) {
  return videos.filter((video) => video.position >= range.startPosition && video.position <= range.endPosition);
}

/**
 * "Adicionar módulo" no modo manual: primeiro cobre videos que ainda nao estao em nenhum modulo;
 * se todos ja estao, divide ao meio o ultimo modulo com mais de um video. Sem como dividir, nao muda.
 */
export function addModuleRange(
  videos: readonly VideoPosition[],
  ranges: readonly YouTubeCourseImportModuleRange[]
): YouTubeCourseImportModuleRange[] {
  const assigned = new Set(ranges.flatMap((range) => videosInRange(videos, range).map((video) => video.position)));
  const unassigned = videos.filter((video) => !assigned.has(video.position));

  if (unassigned.length > 0) {
    return [
      ...ranges,
      {
        endPosition: unassigned[unassigned.length - 1].position,
        startPosition: unassigned[0].position,
        title: moduleRangeTitle(ranges.length)
      }
    ];
  }

  const candidate = ranges
    .map((range, index) => ({ index, videos: videosInRange(videos, range) }))
    .reverse()
    .find((entry) => entry.videos.length > 1);

  if (!candidate) {
    return [...ranges];
  }

  const rightStartIndex = Math.ceil(candidate.videos.length / 2);
  const next = ranges.map((range, index) =>
    index === candidate.index ? { ...range, endPosition: candidate.videos[rightStartIndex - 1].position } : range
  );

  next.splice(candidate.index + 1, 0, {
    endPosition: candidate.videos[candidate.videos.length - 1].position,
    startPosition: candidate.videos[rightStartIndex].position,
    title: moduleRangeTitle(next.length)
  });

  return next;
}

export function updateModuleRange(
  ranges: readonly YouTubeCourseImportModuleRange[],
  index: number,
  patch: Partial<YouTubeCourseImportModuleRange>
): YouTubeCourseImportModuleRange[] {
  return ranges.map((range, rangeIndex) => (rangeIndex === index ? { ...range, ...patch } : range));
}

export function removeModuleRange(ranges: readonly YouTubeCourseImportModuleRange[], index: number) {
  return ranges.filter((_, rangeIndex) => rangeIndex !== index);
}

/**
 * Primeiro problema dos intervalos, numa frase do produtor; null quando servem. Mesmas regras da
 * montagem da previa (src/lib/youtube-course-import.ts): nome, intervalo crescente, pelo menos um
 * video por modulo, nenhum video em dois modulos e nenhum video de fora.
 */
export function describeRangeProblem(
  videos: readonly VideoPosition[],
  ranges: readonly YouTubeCourseImportModuleRange[]
): string | null {
  if (ranges.length === 0) {
    return "Adicione pelo menos um módulo.";
  }

  if (ranges.length > MAX_IMPORT_MODULES) {
    return `Use no máximo ${MAX_IMPORT_MODULES} módulos.`;
  }

  const assigned = new Set<number>();

  for (const [index, range] of ranges.entries()) {
    const title = range.title.trim();

    if (!title) {
      return `Dê um nome ao módulo ${index + 1}.`;
    }

    const { endPosition, startPosition } = range;

    if (!Number.isInteger(startPosition) || !Number.isInteger(endPosition) || startPosition < 1 || endPosition < startPosition) {
      return `No módulo “${title}”, o último vídeo precisa vir depois do primeiro.`;
    }

    const inside = videosInRange(videos, range);

    if (inside.length === 0) {
      return `O módulo “${title}” não tem nenhum vídeo.`;
    }

    for (const video of inside) {
      if (assigned.has(video.position)) {
        return `O vídeo ${video.position} está em mais de um módulo.`;
      }

      assigned.add(video.position);
    }
  }

  const missing = videos.map((video) => video.position).filter((position) => !assigned.has(position));

  if (missing.length === 0) {
    return null;
  }

  const sample = `${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}`;

  return missing.length === 1 ? `O vídeo ${sample} ficou sem módulo.` : `${missing.length} vídeos ficaram sem módulo: ${sample}.`;
}

export const MAX_IMPORT_MODULES = 100;

/** Nomes de modulo que a leitura automatica escreve sem acento ("Conteudo do curso", "Modulo 01"). */
export function accentModuleTitle(title: string) {
  return title
    .replace(/^Conteudo do curso$/i, SINGLE_MODULE_TITLE)
    .replace(/^Modulo(?=\s|$)/, "Módulo");
}

/** Ponto de partida do "Dividir manualmente": os grupos que a leitura achou, com os nomes acentuados. */
export function initialManualRanges(suggested: readonly YouTubeCourseImportModuleRange[]): YouTubeCourseImportModuleRange[] {
  return suggested.map((range) => ({ ...range, title: accentModuleTitle(range.title) }));
}

/** Organizacao sugerida ao ler a playlist: pelos titulos quando algum video indica o modulo. */
export function suggestedOrganization(naming: { compliantLessons: number; totalLessons: number }): PlaylistOrganization {
  return naming.compliantLessons > 0 ? "automatic" : "single";
}

/** Frase de apoio de cada organizacao. */
export function describeOrganization(
  organization: PlaylistOrganization,
  naming: { compliantLessons: number; totalLessons: number }
) {
  if (organization === "single") {
    return "Todos os vídeos em um módulo só, na ordem da playlist.";
  }

  if (organization === "manual") {
    return "Diga em qual vídeo cada módulo começa e termina, na ordem da playlist.";
  }

  if (naming.totalLessons > 0 && naming.compliantLessons >= naming.totalLessons) {
    return "Todos os títulos indicam o módulo (ex.: “M01 - Fundamentos | A01 - Boas-vindas”); organizamos por eles.";
  }

  if (naming.compliantLessons === 0) {
    return "Nenhum título indica o módulo (ex.: “M01 - Fundamentos | A01 - Boas-vindas”): tudo entra em “Conteúdo do curso”.";
  }

  return `${naming.compliantLessons} de ${naming.totalLessons} títulos indicam o módulo (ex.: “M01 - Fundamentos | A01 - Boas-vindas”). Os outros entram em “Conteúdo do curso”.`;
}

export type PlaylistArrangement = {
  modules: YouTubeCourseImportModule[];
  /** Frase do problema dos intervalos; com problema, `modules` vem vazio e a importacao nao sai. */
  problem: string | null;
  /** Intervalos enviados na importacao (vazio na organizacao pelos titulos). */
  ranges: YouTubeCourseImportModuleRange[];
};

/** Como a playlist vai ficar com a organizacao escolhida (a previa que a tela mostra). */
export function arrangePlaylist(
  preview: YouTubeCourseImportPreview,
  organization: PlaylistOrganization,
  manualRanges: readonly YouTubeCourseImportModuleRange[]
): PlaylistArrangement {
  if (organization === "automatic") {
    return { modules: preview.modules, problem: null, ranges: [] };
  }

  const ranges = organization === "single" ? singleModuleRange(preview.videos) : [...manualRanges];
  const problem = describeRangeProblem(preview.videos, ranges);

  if (problem) {
    return { modules: [], problem, ranges };
  }

  try {
    return { modules: rebuildYouTubeCoursePreviewWithRanges(preview, ranges).modules, problem: null, ranges };
  } catch {
    return { modules: [], problem: "Revise os intervalos dos módulos.", ranges };
  }
}

/** Titulo e descricao vindos do YouTube, cortados nos limites do produto (80 e 300 caracteres). */
export function suggestedProductText(preview: { description: string; title: string }) {
  const title = preview.title.trim().slice(0, 80).trim();
  const description = preview.description.replace(/\s+/g, " ").trim().slice(0, 300).trim();

  return { description, title };
}

/** "1 aula" / "12 aulas"; "1 módulo" / "3 módulos". */
export function describeLessonCount(count: number) {
  return count === 1 ? "1 aula" : `${count} aulas`;
}

/** "1 aula encontrada" / "12 aulas encontradas". */
export function describeFoundLessons(count: number) {
  return count === 1 ? "1 aula encontrada" : `${count} aulas encontradas`;
}

export function describeModuleCount(count: number) {
  return count === 1 ? "1 módulo" : `${count} módulos`;
}
