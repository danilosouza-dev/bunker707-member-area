// Materiais de apoio das aulas (tabela lesson_materials, migracao 202610130001).
//
// Modulo puro (sem imports de runtime) para a aba Materiais da aula, a pagina /materiais e os testes.
// Quem decide se o aluno pode abrir a aula e o servidor (requireLessonsAccess / catalogo do aluno); aqui
// so fica a regra extra de cada material (avaliar a aula, assistir X%) e a apresentacao.
//
// Seguranca: o endereco do arquivo so sai do servidor quando o material esta liberado para o aluno
// (`toStudentLessonMaterial` zera `url` quando bloqueado). Nunca mande a linha crua para o navegador.

export const LESSON_MATERIAL_FILE_TYPES = [
  "pdf",
  "spreadsheet",
  "document",
  "presentation",
  "image",
  "archive",
  "audio",
  "video",
  "link",
  "other"
] as const;

export type LessonMaterialFileType = (typeof LESSON_MATERIAL_FILE_TYPES)[number];

export const LESSON_MATERIAL_UNLOCK_RULES = ["none", "lesson_rated", "lesson_progress"] as const;

export type LessonMaterialUnlockRule = (typeof LESSON_MATERIAL_UNLOCK_RULES)[number];

/** Linha de lesson_materials como o servidor le (colunas da migracao 202610130001). */
export type LessonMaterialRow = {
  created_at: string;
  description: string | null;
  file_size_bytes: number | null;
  file_type: string;
  file_url: string;
  generated_by_ai: boolean;
  id: string;
  lesson_id: string;
  sort_order: number;
  status: string;
  title: string;
  unlock_rule: string;
  unlock_threshold: number | null;
};

/** O que o aluno ja fez na aula, para avaliar a regra extra do material. */
export type LessonMaterialLearnerState = {
  /** Maior percentual ja assistido (0-100). */
  maxProgressPercent: number;
  /** O aluno ja deu uma reacao (Nao gostei / Gostei / Amei) na aula. */
  rated: boolean;
};

export type LessonMaterialLockReason = "lesson_progress" | "lesson_rated";

/** Material pronto para o navegador. `url` so existe quando `locked` e false. */
export type StudentLessonMaterial = {
  description: string;
  fileType: LessonMaterialFileType;
  generatedByAi: boolean;
  id: string;
  lessonId: string;
  lockReason?: LessonMaterialLockReason;
  locked: boolean;
  /** Texto curto do bloqueio, ex.: "Avalie esta aula para liberar". */
  lockMessage?: string;
  sizeBytes: number | null;
  sortOrder: number;
  title: string;
  /** Rotulo do tipo, ex.: "PDF", "Planilha", "Link". */
  typeLabel: string;
  unlockThreshold: number | null;
  url?: string;
};

const fileTypeLabels: Record<LessonMaterialFileType, string> = {
  archive: "Arquivo compactado",
  audio: "Áudio",
  document: "Documento",
  image: "Imagem",
  link: "Link",
  other: "Arquivo",
  pdf: "PDF",
  presentation: "Apresentação",
  spreadsheet: "Planilha",
  video: "Vídeo"
};

const extensionFileTypes: Array<[RegExp, LessonMaterialFileType]> = [
  [/\.pdf$/i, "pdf"],
  [/\.(xlsx?|csv|ods|numbers)$/i, "spreadsheet"],
  [/\.(docx?|odt|rtf|txt|md|pages)$/i, "document"],
  [/\.(pptx?|odp|key)$/i, "presentation"],
  [/\.(png|jpe?g|webp|gif|svg|avif)$/i, "image"],
  [/\.(zip|rar|7z|tar|gz)$/i, "archive"],
  [/\.(mp3|wav|m4a|ogg|aac)$/i, "audio"],
  [/\.(mp4|mov|webm|mkv)$/i, "video"]
];

export function isLessonMaterialFileType(value: unknown): value is LessonMaterialFileType {
  return typeof value === "string" && (LESSON_MATERIAL_FILE_TYPES as readonly string[]).includes(value);
}

export function getLessonMaterialTypeLabel(fileType: LessonMaterialFileType) {
  return fileTypeLabels[fileType];
}

/** Endereco aceito para material: https, sem usuario/senha no endereco. */
export function isSafeLessonMaterialUrl(value: string | null | undefined): value is string {
  const trimmed = value?.trim();

  if (!trimmed) {
    return false;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Tipo gravado; quando falta ou e invalido, deduz pela extensao do endereco (senao "link"). */
export function resolveLessonMaterialFileType(fileType: string | null | undefined, url?: string | null): LessonMaterialFileType {
  if (isLessonMaterialFileType(fileType) && fileType !== "other") {
    return fileType;
  }

  if (url) {
    try {
      const pathname = new URL(url).pathname;
      const match = extensionFileTypes.find(([pattern]) => pattern.test(pathname));

      if (match) {
        return match[1];
      }
    } catch {
      // endereco invalido: cai no padrao abaixo
    }
  }

  return isLessonMaterialFileType(fileType) ? fileType : "link";
}

/** "2,4 MB", "820 KB". Sem tamanho devolve "". */
export function formatLessonMaterialSize(bytes: number | null | undefined) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(Math.round(bytes / 1024), 1).toLocaleString("pt-BR")} KB`;
  }

  return `${(bytes / (1024 * 1024)).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

function normalizeUnlockRule(value: string | null | undefined): LessonMaterialUnlockRule {
  return value === "lesson_rated" || value === "lesson_progress" ? value : "none";
}

function normalizeThreshold(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.min(Math.max(Math.round(value), 1), 100);
}

/** Regra extra do material para este aluno: null = liberado. */
export function getLessonMaterialLock(
  rule: string | null | undefined,
  threshold: number | null | undefined,
  learner: LessonMaterialLearnerState
): { message: string; reason: LessonMaterialLockReason } | null {
  const unlockRule = normalizeUnlockRule(rule);

  if (unlockRule === "lesson_rated") {
    return learner.rated ? null : { message: "Avalie esta aula para liberar", reason: "lesson_rated" };
  }

  if (unlockRule === "lesson_progress") {
    const required = normalizeThreshold(threshold) ?? 100;
    return learner.maxProgressPercent >= required
      ? null
      : { message: `Assista ${required}% da aula para liberar`, reason: "lesson_progress" };
  }

  return null;
}

/**
 * Linha do banco -> material do aluno. Devolve null para linha que nao deve aparecer (rascunho,
 * excluida, sem titulo ou com endereco inseguro). Bloqueado: sem `url`.
 */
export function toStudentLessonMaterial(row: LessonMaterialRow, learner: LessonMaterialLearnerState): StudentLessonMaterial | null {
  const title = row.title?.trim();

  if (row.status !== "published" || !title || !isSafeLessonMaterialUrl(row.file_url)) {
    return null;
  }

  const fileType = resolveLessonMaterialFileType(row.file_type, row.file_url);
  const lock = getLessonMaterialLock(row.unlock_rule, row.unlock_threshold, learner);

  return {
    description: row.description?.trim() ?? "",
    fileType,
    generatedByAi: Boolean(row.generated_by_ai),
    id: row.id,
    lessonId: row.lesson_id,
    lockMessage: lock?.message,
    lockReason: lock?.reason,
    locked: Boolean(lock),
    sizeBytes: typeof row.file_size_bytes === "number" && row.file_size_bytes > 0 ? row.file_size_bytes : null,
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
    title,
    typeLabel: getLessonMaterialTypeLabel(fileType),
    unlockThreshold: normalizeThreshold(row.unlock_threshold),
    url: lock ? undefined : row.file_url.trim()
  };
}

/** Nada assistido e sem avaliacao. */
export const EMPTY_LESSON_MATERIAL_LEARNER_STATE: LessonMaterialLearnerState = { maxProgressPercent: 0, rated: false };

function readSavedPercent(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;
}

/**
 * Junta ao estado conhecido do aluno o que um salvamento de progresso CONFIRMADO pelo servidor gravou
 * (mesma leitura da rota de materiais: aula concluida conta 100%). A aba Materiais decide quando buscar
 * de novo com base nisto, nunca com o estado otimista da tela: senao pergunta ao servidor antes de a
 * avaliacao ou o progresso estarem gravados e guarda a resposta "bloqueado".
 */
export function mergeSavedLessonMaterialLearnerState(
  previous: LessonMaterialLearnerState,
  saved: { completed?: boolean; maxProgressPercent?: number; progressPercent?: number; rated?: boolean }
): LessonMaterialLearnerState {
  return {
    maxProgressPercent: saved.completed
      ? 100
      : Math.max(previous.maxProgressPercent, readSavedPercent(saved.maxProgressPercent), readSavedPercent(saved.progressPercent)),
    rated: saved.rated ?? previous.rated
  };
}

/**
 * A lista guardada (buscada quando o aluno estava em `fetchedWith`) ficou velha para `learner`?
 * Busca de novo quando a avaliacao gravada mudou, ou quando o progresso gravado subiu e ja cumpre o
 * limite de algum material que veio bloqueado por progresso (o limite do proprio material, sem faixas).
 * Como `fetchedWith` passa a ser o estado da nova busca, uma resposta ainda bloqueada nao repete a busca.
 */
export function shouldRefetchLessonMaterials(
  cached: { fetchedWith: LessonMaterialLearnerState; materials: readonly StudentLessonMaterial[] } | undefined,
  learner: LessonMaterialLearnerState
): boolean {
  if (!cached) {
    return true;
  }

  if (cached.fetchedWith.rated !== learner.rated) {
    return true;
  }

  if (learner.maxProgressPercent <= cached.fetchedWith.maxProgressPercent) {
    return false;
  }

  return cached.materials.some((material) => (
    material.locked &&
    material.lockReason === "lesson_progress" &&
    getLessonMaterialLock("lesson_progress", material.unlockThreshold, learner) === null
  ));
}

export function sortStudentLessonMaterials(materials: StudentLessonMaterial[]) {
  return [...materials].sort((left, right) => (
    left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, "pt-BR")
  ));
}
