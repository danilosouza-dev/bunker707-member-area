// Modelos das paginas novas da barra lateral do aluno: Minha jornada, Continue assistindo, Materiais
// e Perfil (aba Meus acessos).
//
// Modulo puro (sem "server-only" e sem alias "@/", imports relativos) para os testes rodarem com
// node --test. Recebe a biblioteca do aluno (getMemberLibrary: so conteudo com acesso, progresso do
// proprio aluno) e devolve recortes pequenos, ja com os textos prontos (datas no fuso de Sao Paulo).
// Nada aqui inventa numero: sem dado, o campo fica vazio e a tela mostra o estado vazio.

import { isHttpsOrLoopbackUrl } from "../../lib/loopback-url";
import {
  clampMemberPercent,
  formatMemberCount,
  formatMemberDate,
  formatMemberDateTime,
  formatMemberRelativeTime,
  formatMemberRemaining,
  getMemberDayDifference,
  toMemberTimestamp
} from "../../lib/member-format";
import {
  getMemberContentLessonLocations,
  getMemberContinueWatching,
  getMemberPurchasedContents,
  indexMemberLibrary,
  memberContentKindLabels,
  memberProgressStatusLabels,
  summarizeMemberContentProgress,
  type MemberLessonLocation,
  type MemberLibrary,
  type MemberLibraryContent,
  type MemberLibraryLesson,
  type MemberProgressStatus
} from "../../lib/member-library";
import {
  getLessonMaterialTypeLabel,
  type LessonMaterialFileType,
  type LessonMaterialLearnerState,
  type StudentLessonMaterial
} from "../../lib/lesson-materials";

// ------------------------------------------------------------------------------------------------
// Pecas comuns
// ------------------------------------------------------------------------------------------------

/** Card de aula (MemberLessonCard) com os textos prontos. */
export type StudentLessonCardView = {
  /** Onde a aula esta: "Formação · Curso · Módulo". */
  context: string;
  href: string;
  /** Chave estavel: conteudo + aula. */
  id: string;
  image: string;
  /** "Assistida há 2 dias". */
  meta: string;
  /** 0-100; null = sem barra. */
  progressPercent: number | null;
  /** Selo sobre a imagem: "faltam 12min", "Concluída". */
  thumbnailLabel: string;
  title: string;
};

function joinContext(parts: Array<string | null | undefined>) {
  const seen = new Set<string>();

  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => {
      if (!part || seen.has(part.toLocaleLowerCase("pt-BR"))) {
        return false;
      }

      seen.add(part.toLocaleLowerCase("pt-BR"));
      return true;
    })
    .join(" · ");
}

function getParentContent(content: MemberLibraryContent, contentsById: ReadonlyMap<string, MemberLibraryContent>) {
  return content.parentContentId ? contentsById.get(content.parentContentId) : undefined;
}

/** "Assistida há 2 dias", "Assistida ontem", "Assistida agora". */
export function formatWatchedLabel(lastWatchedAt: string | null | undefined, now: number) {
  const relative = formatMemberRelativeTime(lastWatchedAt, now);
  return relative ? `Assistida ${relative}` : "";
}

function toTimestamp(value: string | null | undefined) {
  return toMemberTimestamp(value) ?? 0;
}

/**
 * Conteudos de primeiro nivel: tudo que nao e curso interno de uma formacao que tambem esta na
 * biblioteca. A formacao ja soma as aulas dos cursos internos (getMemberContentLessonLocations).
 */
export function getTopLevelMemberContents(library: MemberLibrary) {
  const nestedIds = new Set(library.contents.flatMap((content) => content.childContentIds));
  return library.contents.filter((content) => !nestedIds.has(content.id));
}

type LessonEntry = { location: MemberLessonLocation; parent?: MemberLibraryContent };

/** Todas as aulas da biblioteca, uma vez cada, com a formacao-mae quando houver. */
function listLibraryLessons(library: MemberLibrary): LessonEntry[] {
  const contentsById = indexMemberLibrary(library);
  const seen = new Set<string>();
  const entries: LessonEntry[] = [];

  for (const content of library.contents) {
    for (const location of getMemberContentLessonLocations(content, new Map(), library.accessPreviewMode)) {
      if (seen.has(location.lesson.id)) {
        continue;
      }

      seen.add(location.lesson.id);
      entries.push({ location, parent: getParentContent(content, contentsById) });
    }
  }

  return entries;
}

function getLessonContext(entry: LessonEntry) {
  return joinContext([entry.parent?.title, entry.location.content.title, entry.location.module.title]);
}

function isLessonCompleted(lesson: MemberLibraryLesson) {
  return lesson.completed || lesson.watch?.status === "completed";
}

// ------------------------------------------------------------------------------------------------
// Continue assistindo
// ------------------------------------------------------------------------------------------------

export type ContinueWatchingView = {
  inProgress: StudentLessonCardView[];
  recentlyCompleted: StudentLessonCardView[];
};

export const RECENTLY_COMPLETED_LIMIT = 8;

export function buildContinueWatchingCards(library: MemberLibrary, now: number, options: { limit?: number } = {}) {
  const contentsById = indexMemberLibrary(library);

  return getMemberContinueWatching(library, options).map((entry): StudentLessonCardView => ({
    context: joinContext([
      (entry.parentContent ?? getParentContent(entry.content, contentsById))?.title,
      entry.content.title,
      entry.module.title
    ]),
    href: entry.href,
    id: `${entry.content.id}:${entry.lesson.id}`,
    image: entry.lesson.resumeImage || entry.lesson.image,
    meta: formatWatchedLabel(entry.lastWatchedAt, now),
    progressPercent: clampMemberPercent(entry.progressPercent),
    thumbnailLabel: formatMemberRemaining(entry.lesson.watch?.progressSeconds ?? 0, entry.lesson.watch?.durationSeconds),
    title: entry.lesson.title
  }));
}

export function buildContinueWatchingView(library: MemberLibrary, now: number): ContinueWatchingView {
  const recentlyCompleted = listLibraryLessons(library)
    .filter(({ location }) => (
      !location.lesson.isReleaseLocked &&
      isLessonCompleted(location.lesson) &&
      toMemberTimestamp(location.lesson.watch?.lastWatchedAt) !== null
    ))
    .sort((left, right) => toTimestamp(right.location.lesson.watch?.lastWatchedAt) - toTimestamp(left.location.lesson.watch?.lastWatchedAt))
    .slice(0, RECENTLY_COMPLETED_LIMIT)
    .map((entry): StudentLessonCardView => ({
      context: getLessonContext(entry),
      href: entry.location.href,
      id: `${entry.location.content.id}:${entry.location.lesson.id}`,
      image: entry.location.lesson.resumeImage || entry.location.lesson.image,
      meta: formatWatchedLabel(entry.location.lesson.watch?.lastWatchedAt, now),
      progressPercent: 100,
      thumbnailLabel: "Concluída",
      title: entry.location.lesson.title
    }));

  return { inProgress: buildContinueWatchingCards(library, now), recentlyCompleted };
}

// ------------------------------------------------------------------------------------------------
// Minha jornada
// ------------------------------------------------------------------------------------------------

export type JourneyProductView = {
  completedLessons: number;
  /** Pagina do conteudo. */
  href: string;
  id: string;
  image: string;
  kindLabel: string;
  /** "Última aula há 2 dias" ou "". */
  lastActivityLabel: string;
  lockedLessons: number;
  /** Frase da proxima liberacao ("Liberação em 08/01/2026"), quando houver aula a liberar. */
  nextReleaseLabel: string;
  percent: number;
  /** Proximo passo: Continuar / Começar / Revisar. null = so ha aula a liberar ou nenhuma aula. */
  resume: { href: string; label: "Começar" | "Continuar" | "Revisar"; lessonTitle: string } | null;
  status: MemberProgressStatus;
  statusLabel: string;
  title: string;
  totalLessons: number;
};

export type JourneyActivityView = {
  completed: boolean;
  context: string;
  href: string;
  id: string;
  /** "Concluída" ou "45% assistida". */
  statusLabel: string;
  /** "há 2 dias". */
  timeLabel: string;
  title: string;
};

export type JourneyView = {
  activity: JourneyActivityView[];
  continueWatching: StudentLessonCardView[];
  /** Total de aulas em andamento (o card mostra so as primeiras). */
  continueWatchingTotal: number;
  /** Botao do topo: retomar a aula mais recente ou comecar o primeiro curso. */
  primaryAction: { href: string; label: string } | null;
  products: JourneyProductView[];
  stats: {
    completedContents: number;
    completedLessons: number;
    inProgressContents: number;
    lastActivityAt: string | null;
    /** "há 2 dias" ou "". */
    lastActivityLabel: string;
    totalContents: number;
    totalLessons: number;
  };
};

export const JOURNEY_CONTINUE_LIMIT = 4;
export const JOURNEY_ACTIVITY_LIMIT = 10;

const statusOrder: Record<MemberProgressStatus, number> = { completed: 2, in_progress: 0, not_started: 1 };

function buildJourneyProduct(
  content: MemberLibraryContent,
  contentsById: ReadonlyMap<string, MemberLibraryContent>,
  library: MemberLibrary,
  now: number
): { lastWatchedAt: string | null; view: JourneyProductView } {
  const progress = summarizeMemberContentProgress(content, contentsById, library.accessPreviewMode);
  const locations = getMemberContentLessonLocations(content, contentsById, library.accessPreviewMode);
  const nextLocked = locations.find(({ lesson }) => lesson.isReleaseLocked && !lesson.completed);
  let resume: JourneyProductView["resume"] = null;

  if (progress.status === "completed") {
    const first = locations.find(({ lesson }) => !lesson.isReleaseLocked);
    resume = first ? { href: first.href, label: "Revisar", lessonTitle: first.lesson.title } : null;
  } else if (progress.resume) {
    resume = {
      href: progress.resume.href,
      label: progress.status === "not_started" ? "Começar" : "Continuar",
      lessonTitle: progress.resume.lesson.title
    };
  }

  const lastActivity = formatMemberRelativeTime(progress.lastWatchedAt, now);

  const view: JourneyProductView = {
    completedLessons: progress.completedLessons,
    href: content.href,
    id: content.id,
    image: content.image,
    kindLabel: memberContentKindLabels[content.kind] ?? content.kind,
    lastActivityLabel: lastActivity ? `Última aula ${lastActivity}` : "",
    lockedLessons: progress.lockedLessons,
    nextReleaseLabel: content.isReleaseLocked
      ? content.releaseLabel ?? ""
      : nextLocked?.lesson.releaseLabel ?? "",
    percent: progress.percent,
    resume,
    status: progress.status,
    statusLabel: memberProgressStatusLabels[progress.status],
    title: content.title,
    totalLessons: progress.totalLessons
  };

  return { lastWatchedAt: progress.lastWatchedAt, view };
}

export function buildJourneyView(library: MemberLibrary, now: number): JourneyView {
  const contentsById = indexMemberLibrary(library);
  const topLevel = getTopLevelMemberContents(library);
  const products = topLevel
    .map((content, index) => ({ index, ...buildJourneyProduct(content, contentsById, library, now) }))
    .sort((left, right) => (
      statusOrder[left.view.status] - statusOrder[right.view.status] ||
      // Dentro da mesma situacao, primeiro o que da para estudar agora (o resto so tem aula a liberar).
      (left.view.resume ? 0 : 1) - (right.view.resume ? 0 : 1) ||
      toTimestamp(right.lastWatchedAt) - toTimestamp(left.lastWatchedAt) ||
      left.index - right.index
    ))
    .map(({ view }) => view);

  const lessons = listLibraryLessons(library);
  const watched = lessons
    .filter(({ location }) => toMemberTimestamp(location.lesson.watch?.lastWatchedAt) !== null)
    .sort((left, right) => toTimestamp(right.location.lesson.watch?.lastWatchedAt) - toTimestamp(left.location.lesson.watch?.lastWatchedAt));
  const lastActivityAt = watched[0]?.location.lesson.watch?.lastWatchedAt ?? null;
  const activity = watched
    .filter(({ location }) => !location.lesson.isReleaseLocked)
    .slice(0, JOURNEY_ACTIVITY_LIMIT)
    .map((entry): JourneyActivityView => {
      const { lesson } = entry.location;
      const completed = isLessonCompleted(lesson);

      return {
        completed,
        context: getLessonContext(entry),
        href: entry.location.href,
        id: `${entry.location.content.id}:${lesson.id}`,
        statusLabel: completed ? "Concluída" : `${clampMemberPercent(lesson.watch?.progressPercent)}% assistida`,
        timeLabel: formatMemberRelativeTime(lesson.watch?.lastWatchedAt, now),
        title: lesson.title
      };
    });

  const allContinue = buildContinueWatchingCards(library, now);
  const firstStartable = products.find((product) => product.resume && product.status !== "completed");
  const primaryAction = allContinue[0]
    ? { href: allContinue[0].href, label: "Continuar de onde parei" }
    : firstStartable?.resume
      ? { href: firstStartable.resume.href, label: firstStartable.resume.label === "Começar" ? "Começar a estudar" : "Continuar de onde parei" }
      : null;

  return {
    activity,
    continueWatching: allContinue.slice(0, JOURNEY_CONTINUE_LIMIT),
    continueWatchingTotal: allContinue.length,
    primaryAction,
    products,
    stats: {
      completedContents: products.filter((product) => product.status === "completed").length,
      completedLessons: lessons.filter(({ location }) => isLessonCompleted(location.lesson)).length,
      inProgressContents: products.filter((product) => product.status === "in_progress").length,
      lastActivityAt,
      lastActivityLabel: formatMemberRelativeTime(lastActivityAt, now),
      totalContents: products.length,
      totalLessons: lessons.length
    }
  };
}

// ------------------------------------------------------------------------------------------------
// Materiais
// ------------------------------------------------------------------------------------------------

export type StudentMaterialLessonTarget = {
  /** Onde a aula esta dentro do produto: "Curso interno · Módulo 2". */
  context: string;
  href: string;
  lessonId: string;
  lessonTitle: string;
  productId: string;
  productKindLabel: string;
  productTitle: string;
};

export type StudentMaterialTargets = {
  learnerByLessonId: Map<string, LessonMaterialLearnerState>;
  /** Aulas LIBERADAS do aluno, na ordem do produto e do curso. */
  lessons: StudentMaterialLessonTarget[];
};

/**
 * Aulas cujos materiais podem ser lidos: so aulas liberadas (sem bloqueio de liberacao no conteudo,
 * no modulo ou na aula) de conteudo que esta na biblioteca (acesso real, gratuito ou previa do admin).
 * O estado de cada aula (avaliou? quanto assistiu?) alimenta a regra extra de cada material.
 */
export function getStudentMaterialTargets(library: MemberLibrary): StudentMaterialTargets {
  const contentsById = indexMemberLibrary(library);
  const learnerByLessonId = new Map<string, LessonMaterialLearnerState>();
  const lessons: StudentMaterialLessonTarget[] = [];
  const seen = new Set<string>();

  for (const product of getTopLevelMemberContents(library)) {
    if (product.isReleaseLocked) {
      continue;
    }

    for (const location of getMemberContentLessonLocations(product, contentsById, library.accessPreviewMode)) {
      const { content, lesson } = location;

      if (seen.has(lesson.id) || lesson.isReleaseLocked || content.isReleaseLocked || location.module.isReleaseLocked) {
        continue;
      }

      seen.add(lesson.id);
      learnerByLessonId.set(lesson.id, {
        maxProgressPercent: clampMemberPercent(lesson.watch?.maxProgressPercent ?? 0),
        rated: lesson.rated
      });
      lessons.push({
        context: joinContext([content.id === product.id ? "" : content.title, location.module.title]),
        href: location.href,
        lessonId: lesson.id,
        lessonTitle: lesson.title,
        productId: product.id,
        productKindLabel: memberContentKindLabels[product.kind] ?? product.kind,
        productTitle: product.title
      });
    }
  }

  return { learnerByLessonId, lessons };
}

/** Material como a linha (MemberMaterialRow) precisa; `url` so existe quando liberado. */
export type StudentMaterialItemView = Pick<
  StudentLessonMaterial,
  "description" | "fileType" | "generatedByAi" | "id" | "lockMessage" | "locked" | "sizeBytes" | "title" | "typeLabel" | "url"
>;

export type StudentMaterialLessonView = {
  context: string;
  href: string;
  id: string;
  materials: StudentMaterialItemView[];
  title: string;
};

export type StudentMaterialGroupView = {
  id: string;
  kindLabel: string;
  lessons: StudentMaterialLessonView[];
  lockedCount: number;
  title: string;
  total: number;
};

export type StudentMaterialsView = {
  groups: StudentMaterialGroupView[];
  lockedCount: number;
  total: number;
  types: Array<{ count: number; id: LessonMaterialFileType; label: string }>;
};

function toMaterialItemView(material: StudentLessonMaterial): StudentMaterialItemView {
  return {
    description: material.description,
    fileType: material.fileType,
    generatedByAi: material.generatedByAi,
    id: material.id,
    lockMessage: material.lockMessage,
    locked: material.locked,
    sizeBytes: material.sizeBytes,
    title: material.title,
    typeLabel: material.typeLabel,
    // Defesa extra: material bloqueado nunca leva o endereco para o navegador.
    ...(material.locked || !material.url ? {} : { url: material.url })
  };
}

/** Agrupa por produto -> aula, na ordem do curso. Material de aula fora de `targets` e descartado. */
export function buildStudentMaterialsView(
  targets: StudentMaterialTargets,
  materials: readonly StudentLessonMaterial[]
): StudentMaterialsView {
  const byLesson = new Map<string, StudentLessonMaterial[]>();

  for (const material of materials) {
    const list = byLesson.get(material.lessonId) ?? [];
    list.push(material);
    byLesson.set(material.lessonId, list);
  }

  const groups: StudentMaterialGroupView[] = [];
  const typeCounts = new Map<LessonMaterialFileType, number>();
  let total = 0;
  let lockedCount = 0;

  for (const target of targets.lessons) {
    const lessonMaterials = byLesson.get(target.lessonId);

    if (!lessonMaterials?.length) {
      continue;
    }

    let group = groups.find((item) => item.id === target.productId);

    if (!group) {
      group = { id: target.productId, kindLabel: target.productKindLabel, lessons: [], lockedCount: 0, title: target.productTitle, total: 0 };
      groups.push(group);
    }

    const items = lessonMaterials.map(toMaterialItemView);
    const locked = items.filter((item) => item.locked).length;

    group.lessons.push({ context: target.context, href: target.href, id: target.lessonId, materials: items, title: target.lessonTitle });
    group.total += items.length;
    group.lockedCount += locked;
    total += items.length;
    lockedCount += locked;

    for (const item of items) {
      typeCounts.set(item.fileType, (typeCounts.get(item.fileType) ?? 0) + 1);
    }
  }

  const types = Array.from(typeCounts.entries())
    .map(([id, count]) => ({ count, id, label: getLessonMaterialTypeLabel(id) }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "pt-BR"));

  return { groups, lockedCount, total, types };
}

export function formatMaterialsSummary(view: Pick<StudentMaterialsView, "lockedCount" | "total">) {
  const total = formatMemberCount(view.total, "material", "materiais");
  return view.lockedCount > 0 ? `${total} · ${view.lockedCount} para liberar` : total;
}

// ------------------------------------------------------------------------------------------------
// Perfil › Meus acessos
// ------------------------------------------------------------------------------------------------

export type ProfileAccessView = {
  /**
   * "Acesso vitalício" (inicio conhecido, sem fim), "Acesso até 01/01/2027", "Conteúdo gratuito",
   * "Visualização do produtor" ou "" (acesso ativo sem datas conhecidas: nada inventado).
   */
  durationLabel: string;
  /** Termina em ate 30 dias. */
  endsSoon: boolean;
  /** "Termina em 12 dias", quando `endsSoon`. */
  endsSoonLabel: string;
  href: string;
  id: string;
  image: string;
  kind: "entitlement" | "free" | "preview";
  kindLabel: string;
  /** "Desde 01/01/2026" ou "". */
  sinceLabel: string;
  statusLabel: string;
  title: string;
};

export const ACCESS_ENDS_SOON_DAYS = 30;

export function buildProfileAccesses(library: MemberLibrary, now: number): ProfileAccessView[] {
  return getMemberPurchasedContents(library).map((content): ProfileAccessView => {
    const { access } = content;
    const base = {
      href: content.href,
      id: content.id,
      image: content.image,
      kind: access.kind,
      kindLabel: memberContentKindLabels[content.kind] ?? content.kind,
      title: content.title
    };

    if (access.kind === "free") {
      return { ...base, durationLabel: "Conteúdo gratuito", endsSoon: false, endsSoonLabel: "", sinceLabel: "", statusLabel: "Gratuito" };
    }

    if (access.kind === "preview") {
      return { ...base, durationLabel: "Visualização do produtor", endsSoon: false, endsSoonLabel: "", sinceLabel: "", statusLabel: "Prévia" };
    }

    // Acesso sem datas conhecidas (so pelo cadastro antigo, que pode ter fim): fica "Ativo", sem prometer
    // "vitalício". Mesma regra de getPurchaseAccessLabel (Minhas compras).
    if (!access.startsAt && !access.endsAt) {
      return { ...base, durationLabel: "", endsSoon: false, endsSoonLabel: "", sinceLabel: "", statusLabel: "Ativo" };
    }

    const since = formatMemberDate(access.startsAt);
    const endsAt = formatMemberDate(access.endsAt);
    const daysLeft = access.endsAt ? getMemberDayDifference(now, access.endsAt) : null;
    const endsSoon = typeof daysLeft === "number" && daysLeft >= 0 && daysLeft <= ACCESS_ENDS_SOON_DAYS;

    return {
      ...base,
      durationLabel: endsAt ? `Acesso até ${endsAt}` : "Acesso vitalício",
      endsSoon,
      endsSoonLabel: endsSoon
        ? daysLeft === 0
          ? "Termina hoje"
          : daysLeft === 1
            ? "Termina amanhã"
            : `Termina em ${daysLeft} dias`
        : "",
      sinceLabel: since ? `Desde ${since}` : "",
      statusLabel: "Ativo"
    };
  });
}

// ------------------------------------------------------------------------------------------------
// Perfil › Meus dados
// ------------------------------------------------------------------------------------------------

export type ProfileDetailsView = {
  avatarUrl: string | null;
  email: string;
  fullName: string;
  /** "11/10/2026 às 14:30" ou "". */
  lastSignInLabel: string;
  /** "01/01/2026" ou "". */
  memberSinceLabel: string;
  phone: string;
};

/** Foto do perfil so com https (sem usuario/senha no endereco). */
export function sanitizeProfileAvatarUrl(value: string | null | undefined) {
  const trimmed = value?.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    // https, ou http so na propria maquina (Supabase local dos testes); nunca com usuario e senha.
    return isHttpsOrLoopbackUrl(url) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

export function buildProfileDetails(input: {
  account: { createdAt?: string | null; email?: string | null; lastSignInAt?: string | null };
  displayName: string;
  profile: { avatarUrl?: string | null; phone?: string | null } | null;
}): ProfileDetailsView {
  return {
    avatarUrl: sanitizeProfileAvatarUrl(input.profile?.avatarUrl),
    email: input.account.email?.trim() ?? "",
    fullName: input.displayName.trim() || "Aluno",
    lastSignInLabel: formatMemberDateTime(input.account.lastSignInAt),
    memberSinceLabel: formatMemberDate(input.account.createdAt),
    phone: input.profile?.phone?.trim() ?? ""
  };
}

export const PROFILE_TABS = ["dados", "acessos", "seguranca", "privacidade"] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];

export function normalizeProfileTab(value: string | string[] | null | undefined): ProfileTab {
  const tab = Array.isArray(value) ? value[0] : value;
  return (PROFILE_TABS as readonly string[]).includes(tab ?? "") ? (tab as ProfileTab) : "dados";
}
