// Biblioteca do aluno: tudo que ele pode abrir, com o progresso DELE, em um formato unico para
// Minhas compras, Favoritos, Minha jornada, Continue assistindo e Materiais.
//
// - O servidor monta a biblioteca em `getMemberLibrary` (src/server/db/platform-store.ts) a partir do
//   acesso real (entitlements, conteudo gratuito ou previa do produtor) e do progresso do proprio aluno.
//   Conteudo sem acesso nunca entra; aula bloqueada pela regra de liberacao entra marcada, sem imagem de
//   video (a thumbnail do YouTube revelaria o video).
// - Este modulo e puro (sem "server-only" e sem alias "@/") para os testes rodarem com node --test.
// - Paginas passam para componentes de cliente so o recorte que vao mostrar, nunca a biblioteca inteira.

import { withAccessPreviewParam, type AccessPreviewMode } from "./access-preview";
import type { CommerceScope, ContentKind } from "./platform-types";

export type MemberLibraryWatch = {
  durationSeconds?: number;
  lastWatchedAt: string;
  maxProgressPercent: number;
  progressPercent: number;
  progressSeconds: number;
  status: "completed" | "in_progress";
};

export type MemberLibraryLesson = {
  completed: boolean;
  /** Conteudo dono do modulo (curso, bootcamp, curso interno da formacao...). */
  contentId: string;
  duration: string;
  id: string;
  /** Imagem da propria aula: thumbnail oficial do video (so se liberada) ou a cadastrada. "" = sem imagem. */
  image: string;
  /** Aula ainda nao liberada para este aluno pela regra de liberacao. */
  isReleaseLocked: boolean;
  isSaved: boolean;
  moduleId: string;
  /** O aluno ja reagiu a aula (Nao gostei / Gostei / Amei). */
  rated: boolean;
  /** Texto do bloqueio quando `isReleaseLocked` ("Liberação em 08/01/2026" ou a frase generica). */
  releaseLabel?: string;
  /** Imagem para retomar: frame salvo > thumbnail > imagem da aula > capa do modulo. "" = sem imagem. */
  resumeImage: string;
  title: string;
  watch: MemberLibraryWatch | null;
};

export type MemberLibraryModule = {
  contentId: string;
  id: string;
  image: string;
  isReleaseLocked: boolean;
  isSaved: boolean;
  lessons: MemberLibraryLesson[];
  releaseLabel?: string;
  title: string;
};

export type MemberLibraryAccess = {
  /** null = sem data de fim (vitalicio) ou sem acesso real (gratuito/previa). */
  endsAt: string | null;
  /** entitlement = acesso real do aluno; free = conteudo gratuito; preview = previa do produtor/admin. */
  kind: "entitlement" | "free" | "preview";
  /** Inicio do acesso real mais antigo para este conteudo (data da compra/liberacao). */
  startsAt: string | null;
};

export type MemberLibraryContent = {
  access: MemberLibraryAccess;
  /** Formacao: cursos internos que o aluno pode abrir, na ordem do produtor. */
  childContentIds: string[];
  commerceScope?: CommerceScope;
  description: string;
  eyebrow: string;
  /** /conteudo/{id}, ja com o parametro de previa quando houver. */
  href: string;
  id: string;
  image: string;
  isReleaseLocked: boolean;
  isSaved: boolean;
  kind: ContentKind;
  modules: MemberLibraryModule[];
  parentContentId?: string;
  releaseLabel?: string;
  title: string;
};

export type MemberLibrary = {
  accessPreviewMode?: AccessPreviewMode;
  contents: MemberLibraryContent[];
  userId: string | null;
};

export type MemberProgressStatus = "completed" | "in_progress" | "not_started";

export type MemberLessonLocation = {
  content: MemberLibraryContent;
  href: string;
  lesson: MemberLibraryLesson;
  module: MemberLibraryModule;
};

export type MemberContentProgress = {
  completedLessons: number;
  /** Ultima vez que o aluno assistiu algo deste conteudo (inclui cursos internos da formacao). */
  lastWatchedAt: string | null;
  lockedLessons: number;
  /** Aulas concluidas / aulas do conteudo, 0-100. */
  percent: number;
  /** Onde continuar: aula em andamento mais recente; senao, a primeira liberada nao concluida. */
  resume: MemberLessonLocation | null;
  status: MemberProgressStatus;
  totalLessons: number;
};

export type MemberContinueWatchingEntry = MemberLessonLocation & {
  lastWatchedAt: string;
  progressPercent: number;
  /** Formacao que inclui o curso desta aula, quando houver. */
  parentContent?: MemberLibraryContent;
};

export const memberProgressStatusLabels: Record<MemberProgressStatus, string> = {
  completed: "Concluído",
  in_progress: "Em andamento",
  not_started: "Não iniciado"
};

export const memberContentKindLabels: Record<ContentKind, string> = {
  Aula: "Aula",
  Bootcamp: "Bootcamp",
  Curso: "Curso",
  Formacao: "Formação",
  Material: "Material",
  Mentoria: "Mentoria",
  Produto: "Material",
  Webinario: "Gravação de live"
};

export function getMemberContentHref(contentId: string, accessPreviewMode?: AccessPreviewMode) {
  return withAccessPreviewParam(`/conteudo/${encodeURIComponent(contentId)}`, accessPreviewMode);
}

export function getMemberLessonHref(
  contentId: string,
  moduleId: string,
  lessonId: string,
  accessPreviewMode?: AccessPreviewMode
) {
  return withAccessPreviewParam(
    `/conteudo/${encodeURIComponent(contentId)}/aulas/${encodeURIComponent(moduleId)}?lessonId=${encodeURIComponent(lessonId)}`,
    accessPreviewMode
  );
}

export function indexMemberLibrary(library: MemberLibrary) {
  return new Map(library.contents.map((content) => [content.id, content]));
}

function toTimestamp(value: string | null | undefined) {
  if (!value) return Number.NaN;
  return new Date(value).getTime();
}

function isInProgress(lesson: MemberLibraryLesson) {
  return Boolean(
    !lesson.completed &&
    lesson.watch &&
    lesson.watch.status !== "completed" &&
    lesson.watch.progressPercent > 0 &&
    lesson.watch.progressPercent < 100
  );
}

/**
 * Aulas do conteudo na ordem do curso, com o conteudo dono de cada uma. Formacao: modulos proprios e
 * depois os cursos internos, na ordem cadastrada.
 */
export function getMemberContentLessonLocations(
  content: MemberLibraryContent,
  contentsById: ReadonlyMap<string, MemberLibraryContent>,
  accessPreviewMode?: AccessPreviewMode
): MemberLessonLocation[] {
  const owners = [content, ...content.childContentIds.flatMap((childId) => {
    const child = contentsById.get(childId);
    return child && child.id !== content.id ? [child] : [];
  })];

  return owners.flatMap((owner) => owner.modules.flatMap((courseModule) => courseModule.lessons.map((lesson) => ({
    content: owner,
    href: getMemberLessonHref(owner.id, courseModule.id, lesson.id, accessPreviewMode),
    lesson,
    module: courseModule
  }))));
}

export function summarizeMemberContentProgress(
  content: MemberLibraryContent,
  contentsById: ReadonlyMap<string, MemberLibraryContent>,
  accessPreviewMode?: AccessPreviewMode
): MemberContentProgress {
  const locations = getMemberContentLessonLocations(content, contentsById, accessPreviewMode);
  const totalLessons = locations.length;
  const completedLessons = locations.filter(({ lesson }) => lesson.completed).length;
  const lockedLessons = locations.filter(({ lesson }) => lesson.isReleaseLocked && !lesson.completed).length;
  const watched = locations
    .filter(({ lesson }) => Number.isFinite(toTimestamp(lesson.watch?.lastWatchedAt)))
    .sort((left, right) => toTimestamp(right.lesson.watch?.lastWatchedAt) - toTimestamp(left.lesson.watch?.lastWatchedAt));
  const lastWatchedAt = watched[0]?.lesson.watch?.lastWatchedAt ?? null;
  const resume = watched.find(({ lesson }) => isInProgress(lesson) && !lesson.isReleaseLocked)
    ?? locations.find(({ lesson }) => !lesson.completed && !lesson.isReleaseLocked)
    ?? null;
  const percent = totalLessons > 0 ? Math.round((completedLessons / totalLessons) * 100) : 0;
  const started = completedLessons > 0 || locations.some(({ lesson }) => (lesson.watch?.progressPercent ?? 0) > 0);
  const status: MemberProgressStatus = totalLessons > 0 && completedLessons === totalLessons
    ? "completed"
    : started
      ? "in_progress"
      : "not_started";

  return { completedLessons, lastWatchedAt, lockedLessons, percent, resume, status, totalLessons };
}

/**
 * Aulas comecadas e nao terminadas (0% < progresso < 100%), liberadas, da mais recente para a mais
 * antiga. Mesma regra da fileira "Continue assistindo" da home.
 */
export function getMemberContinueWatching(
  library: MemberLibrary,
  options: { limit?: number } = {}
): MemberContinueWatchingEntry[] {
  const contentsById = indexMemberLibrary(library);
  const seenLessonIds = new Set<string>();
  const entries: MemberContinueWatchingEntry[] = [];

  for (const content of library.contents) {
    for (const courseModule of content.modules) {
      for (const lesson of courseModule.lessons) {
        if (seenLessonIds.has(lesson.id) || lesson.isReleaseLocked || !isInProgress(lesson) || !lesson.watch) {
          continue;
        }

        seenLessonIds.add(lesson.id);
        entries.push({
          content,
          href: getMemberLessonHref(content.id, courseModule.id, lesson.id, library.accessPreviewMode),
          lastWatchedAt: lesson.watch.lastWatchedAt,
          lesson,
          module: courseModule,
          parentContent: content.parentContentId ? contentsById.get(content.parentContentId) : undefined,
          progressPercent: lesson.watch.progressPercent
        });
      }
    }
  }

  entries.sort((left, right) => (toTimestamp(right.lastWatchedAt) || 0) - (toTimestamp(left.lastWatchedAt) || 0));

  return typeof options.limit === "number" ? entries.slice(0, Math.max(options.limit, 0)) : entries;
}

/** Produtos comprados/liberados de primeiro nivel (sem cursos internos de formacao). */
export function getMemberPurchasedContents(library: MemberLibrary) {
  return library.contents.filter((content) => content.commerceScope === "sellable_product");
}
