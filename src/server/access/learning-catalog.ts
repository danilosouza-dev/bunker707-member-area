import "server-only";

import type { ReleaseRuleConfig } from "@/lib/platform-types";
import { isReleaseRuleSatisfied } from "@/server/access/release-policy";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

type ContentRow = {
  access_model: string | null;
  commerce_scope: string | null;
  description: string | null;
  id: string;
  is_locked: boolean;
  kind: string;
  publication_status: string;
  release_rule: ReleaseRuleConfig | null;
  sort_order: number;
  title: string;
};

type ContentSettingsRow = {
  content_id: string;
  settings: unknown;
};

type ModuleRow = {
  description: string | null;
  id: string;
  owner_id: string | null;
  release_rule: ReleaseRuleConfig | null;
  sort_order: number;
  status: string;
  title: string;
};

type LessonRow = {
  description: string | null;
  duration: string | null;
  id: string;
  module_id: string;
  release_rule: ReleaseRuleConfig | null;
  sort_order: number;
  status: string;
  title: string;
};

type EntitlementRow = {
  ends_at: string | null;
  starts_at: string;
  status: string;
  target_id: string;
  target_type: string;
};

type ProgressRow = {
  completed_lesson_ids: unknown;
  content_id: string;
  lesson_watch_states: unknown;
};

type ActiveTranscriptRow = {
  id: string;
  is_active: boolean;
  lesson_id: string;
  status: string;
};

type AIProfileRow = {
  chapters: unknown;
  faq: unknown;
  lesson_id: string;
  status: string;
  summary: string;
  topics: unknown;
  transcript_id: string;
};

export type AuthorizedLessonProgress = {
  completed: boolean;
  lastWatchedAt: string | null;
  maxProgressPercent: number;
  progressPercent: number;
  progressSeconds: number;
  status: "completed" | "in_progress" | "not_started";
};

export type AuthorizedLessonAIProfile = {
  chapters: unknown;
  faq: unknown;
  summary: string;
  topics: unknown;
  transcriptId: string;
};

export type AuthorizedLearningContent = {
  description: string;
  id: string;
  kind: string;
  sortOrder: number;
  title: string;
};

export type AuthorizedLearningModule = {
  contentId: string;
  description: string;
  id: string;
  sortOrder: number;
  title: string;
};

export type AuthorizedLearningLesson = {
  activeTranscriptId: string | null;
  aiProfile: AuthorizedLessonAIProfile | null;
  contentId: string;
  description: string;
  duration: string;
  id: string;
  moduleId: string;
  progress: AuthorizedLessonProgress;
  sortOrder: number;
  title: string;
};

export type AuthorizedLearningCatalog = {
  contents: AuthorizedLearningContent[];
  isAdmin: boolean;
  lessons: AuthorizedLearningLesson[];
  modules: AuthorizedLearningModule[];
};

// Compatibility names for the first platform-guide implementation. New code
// should prefer the AuthorizedLearning* names above.
export type AccessiblePublishedContent = AuthorizedLearningContent;
export type AccessiblePublishedModule = AuthorizedLearningModule;
export type AccessiblePublishedLesson = AuthorizedLearningLesson;
export type AccessiblePublishedCatalog = AuthorizedLearningCatalog;

function throwDatabaseError(error: { message: string } | null, context: string) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function trimText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function clampNumber(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return minimum;
  return Math.min(Math.max(value, minimum), maximum);
}

function parseDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function isActiveEntitlement(entitlement: EntitlementRow, now: number) {
  if (entitlement.status !== "active") return false;
  const startsAt = parseDate(entitlement.starts_at);
  const endsAt = entitlement.ends_at === null ? null : parseDate(entitlement.ends_at);

  if (startsAt === null || startsAt > now) return false;
  if (entitlement.ends_at !== null && (endsAt === null || endsAt < now)) return false;
  return true;
}

function getTargetTypeForContentKind(kind: string) {
  if (kind === "Formacao") return "formation";
  if (kind === "Mentoria") return "mentorship";
  if (kind === "Webinario") return "webinar";
  if (kind === "Produto") return "product";
  if (kind === "Bootcamp") return "bootcamp";
  return "standalone_course";
}

function getMatchingEntitlements({
  content,
  entitlements,
  now,
  parentFormationId
}: {
  content: ContentRow;
  entitlements: EntitlementRow[];
  now: number;
  parentFormationId?: string;
}) {
  const expectedTargetType = getTargetTypeForContentKind(content.kind);

  return entitlements.filter((entitlement) => {
    if (!isActiveEntitlement(entitlement, now)) return false;
    if (
      entitlement.target_type === "platform" &&
      (entitlement.target_id === "platform" || entitlement.target_id === "*")
    ) {
      return true;
    }
    if (entitlement.target_type === expectedTargetType && entitlement.target_id === content.id) {
      return true;
    }
    return (
      content.commerce_scope === "included_content" &&
      entitlement.target_type === "formation" &&
      typeof parentFormationId === "string" &&
      parentFormationId.length > 0 &&
      entitlement.target_id === parentFormationId
    );
  });
}

function getParentFormationId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const parentFormationId = (value as { parentFormationId?: unknown }).parentFormationId;
  return typeof parentFormationId === "string" && parentFormationId.trim()
    ? parentFormationId.trim()
    : undefined;
}

function getCompletedLessonIds(rows: ProgressRow[], contentId: string) {
  const completed = new Set<string>();

  for (const row of rows) {
    if (row.content_id !== contentId || !Array.isArray(row.completed_lesson_ids)) continue;
    for (const lessonId of row.completed_lesson_ids) {
      if (typeof lessonId === "string" && lessonId.trim()) completed.add(lessonId.trim());
    }
  }
  return completed;
}

function getWatchState(rows: ProgressRow[], contentId: string, lessonId: string) {
  const row = rows.find((progress) => progress.content_id === contentId);

  if (!row?.lesson_watch_states || typeof row.lesson_watch_states !== "object" || Array.isArray(row.lesson_watch_states)) {
    return null;
  }
  const value = (row.lesson_watch_states as Record<string, unknown>)[lessonId];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function mapLessonProgress(rows: ProgressRow[], contentId: string, lessonId: string): AuthorizedLessonProgress {
  const completedLessonIds = getCompletedLessonIds(rows, contentId);
  const watchState = getWatchState(rows, contentId, lessonId);
  const completed = completedLessonIds.has(lessonId) || watchState?.status === "completed";
  const rawProgressPercent = clampNumber(watchState?.progressPercent, 0, 100);
  const progressPercent = completed ? 100 : Math.min(Math.round(rawProgressPercent), 99);
  const rawMaximum = clampNumber(watchState?.maxProgressPercent, 0, 100);
  const maxProgressPercent = completed
    ? 100
    : Math.min(Math.round(Math.max(progressPercent, rawMaximum)), 99);
  const progressSeconds = Math.max(0, Math.round(clampNumber(watchState?.progressSeconds, 0, Number.MAX_SAFE_INTEGER)));
  const lastWatchedAt = typeof watchState?.lastWatchedAt === "string" && parseDate(watchState.lastWatchedAt) !== null
    ? watchState.lastWatchedAt
    : null;
  const inProgress = !completed && (progressSeconds > 0 || progressPercent > 0 || watchState?.status === "in_progress");

  return {
    completed,
    lastWatchedAt,
    maxProgressPercent,
    progressPercent,
    progressSeconds,
    status: completed ? "completed" : inProgress ? "in_progress" : "not_started"
  };
}

function getPreviousLessonByEntity({
  lessons,
  modules,
  contentId
}: {
  lessons: LessonRow[];
  modules: ModuleRow[];
  contentId: string;
}) {
  const orderedModules = modules
    .filter((courseModule) => courseModule.owner_id === contentId && courseModule.status === "published")
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
  const orderedLessons = orderedModules.flatMap((courseModule) => lessons
    .filter((lesson) => lesson.module_id === courseModule.id && lesson.status === "published")
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id)));
  const previousLessonByLessonId = new Map<string, string | undefined>();
  const previousLessonByModuleId = new Map<string, string | undefined>();
  let previousLessonId: string | undefined;

  for (const courseModule of orderedModules) {
    previousLessonByModuleId.set(courseModule.id, previousLessonId);
    const moduleLessons = orderedLessons.filter((lesson) => lesson.module_id === courseModule.id);

    for (const lesson of moduleLessons) {
      previousLessonByLessonId.set(lesson.id, previousLessonId);
      previousLessonId = lesson.id;
    }
  }
  return { previousLessonByLessonId, previousLessonByModuleId };
}

async function attachTranscriptContext(
  lessons: Array<Omit<AuthorizedLearningLesson, "activeTranscriptId" | "aiProfile">>
): Promise<AuthorizedLearningLesson[]> {
  if (lessons.length === 0) return [];
  const supabase = getSupabaseAdminClient();
  const lessonIds = lessons.map((lesson) => lesson.id);
  const [transcriptsResult, profilesResult] = await Promise.all([
    supabase
      .from("lesson_transcripts")
      .select("id,lesson_id,status,is_active")
      .in("lesson_id", lessonIds)
      .eq("is_active", true)
      .eq("status", "ready"),
    supabase
      .from("lesson_ai_profiles")
      .select("lesson_id,transcript_id,status,summary,chapters,topics,faq")
      .in("lesson_id", lessonIds)
      .eq("status", "ready")
  ]);
  throwDatabaseError(transcriptsResult.error, "Nao foi possivel validar as transcricoes ativas do catalogo");
  throwDatabaseError(profilesResult.error, "Nao foi possivel carregar os perfis de IA do catalogo");
  const activeTranscriptByLessonId = new Map(
    ((transcriptsResult.data ?? []) as ActiveTranscriptRow[])
      .filter((transcript) => transcript.is_active && transcript.status === "ready")
      .map((transcript) => [transcript.lesson_id, transcript.id])
  );
  const profileByLessonId = new Map(
    ((profilesResult.data ?? []) as AIProfileRow[])
      .filter((profile) => (
        profile.status === "ready" &&
        activeTranscriptByLessonId.get(profile.lesson_id) === profile.transcript_id
      ))
      .map((profile) => [profile.lesson_id, profile])
  );

  return lessons.map((lesson) => {
    const activeTranscriptId = activeTranscriptByLessonId.get(lesson.id) ?? null;
    const profile = profileByLessonId.get(lesson.id);

    return {
      ...lesson,
      activeTranscriptId,
      aiProfile: profile
        ? {
            chapters: profile.chapters,
            faq: profile.faq,
            summary: trimText(profile.summary),
            topics: profile.topics,
            transcriptId: profile.transcript_id
          }
        : null
    };
  });
}

export async function resolveAuthorizedLearningCatalog(userId: string): Promise<AuthorizedLearningCatalog> {
  const normalizedUserId = userId.trim();

  if (!normalizedUserId) throw new Error("Usuario obrigatorio para resolver o catalogo autorizado.");
  const supabase = getSupabaseAdminClient();
  const now = Date.now();
  const [contentsResult, settingsResult, modulesResult, lessonsResult, adminRoleResult, entitlementsResult, progressResult] = await Promise.all([
    supabase
      .from("content_items")
      .select("id,kind,title,description,access_model,commerce_scope,is_locked,release_rule,publication_status,sort_order")
      .eq("publication_status", "published")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("content_page_settings").select("content_id,settings"),
    supabase
      .from("course_modules")
      .select("id,owner_id,title,description,release_rule,status,sort_order")
      .eq("status", "published")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("lessons")
      .select("id,module_id,title,description,duration,release_rule,status,sort_order")
      .eq("status", "published")
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true }),
    supabase.from("admin_roles").select("role").eq("user_id", normalizedUserId).maybeSingle(),
    supabase
      .from("entitlements")
      .select("target_id,target_type,starts_at,ends_at,status")
      .eq("user_id", normalizedUserId)
      .eq("status", "active"),
    supabase
      .from("lesson_progress")
      .select("content_id,completed_lesson_ids,lesson_watch_states")
      .eq("user_id", normalizedUserId)
  ]);
  throwDatabaseError(contentsResult.error, "Nao foi possivel listar os conteudos publicados");
  throwDatabaseError(settingsResult.error, "Nao foi possivel validar as formacoes dos conteudos");
  throwDatabaseError(modulesResult.error, "Nao foi possivel listar os modulos publicados");
  throwDatabaseError(lessonsResult.error, "Nao foi possivel listar as aulas publicadas");
  throwDatabaseError(adminRoleResult.error, "Nao foi possivel validar o papel do usuario");
  throwDatabaseError(entitlementsResult.error, "Nao foi possivel validar o acesso do aluno");
  throwDatabaseError(progressResult.error, "Nao foi possivel carregar o progresso do aluno");
  const contents = (contentsResult.data ?? []) as ContentRow[];
  const settings = (settingsResult.data ?? []) as ContentSettingsRow[];
  const modules = (modulesResult.data ?? []) as ModuleRow[];
  const lessons = (lessonsResult.data ?? []) as LessonRow[];
  const entitlements = (entitlementsResult.data ?? []) as EntitlementRow[];
  const progressRows = (progressResult.data ?? []) as ProgressRow[];
  const isAdmin = Boolean(adminRoleResult.data);
  const parentFormationByContent = new Map(
    settings.flatMap((row) => {
      const parentFormationId = getParentFormationId(row.settings);
      return parentFormationId ? [[row.content_id, parentFormationId] as const] : [];
    })
  );
  const publishedFormationIds = new Set(contents
    .filter((content) => content.kind === "Formacao" && content.publication_status === "published")
    .map((content) => content.id));
  const authorizedContentRows = new Map<string, ContentRow>();
  const matchingEntitlementsByContent = new Map<string, EntitlementRow[]>();

  for (const content of contents) {
    if (content.publication_status !== "published") continue;
    const parentFormationId = parentFormationByContent.get(content.id);
    const matchingEntitlements = getMatchingEntitlements({
      content,
      entitlements,
      now,
      parentFormationId: parentFormationId && publishedFormationIds.has(parentFormationId)
        ? parentFormationId
        : undefined
    });
    const hasOpenAccess = content.access_model === "free" || content.is_locked === false;
    const hasAccess = isAdmin || hasOpenAccess || matchingEntitlements.length > 0;

    if (!hasAccess) continue;
    const completedLessonIds = getCompletedLessonIds(progressRows, content.id);

    if (!isAdmin && !isReleaseRuleSatisfied({
      completedLessonIds,
      matchingEntitlements,
      now,
      releaseRule: content.release_rule
    })) {
      continue;
    }
    authorizedContentRows.set(content.id, content);
    matchingEntitlementsByContent.set(content.id, matchingEntitlements);
  }

  const authorizedModuleRows = new Map<string, ModuleRow>();

  for (const content of authorizedContentRows.values()) {
    const completedLessonIds = getCompletedLessonIds(progressRows, content.id);
    const previous = getPreviousLessonByEntity({ contentId: content.id, lessons, modules });

    for (const courseModule of modules) {
      if (
        courseModule.status !== "published" ||
        courseModule.owner_id !== content.id ||
        (!isAdmin && !isReleaseRuleSatisfied({
          completedLessonIds,
          matchingEntitlements: matchingEntitlementsByContent.get(content.id) ?? [],
          now,
          previousLessonId: previous.previousLessonByModuleId.get(courseModule.id),
          releaseRule: courseModule.release_rule
        }))
      ) {
        continue;
      }
      authorizedModuleRows.set(courseModule.id, courseModule);
    }
  }

  const authorizedLessonRows: Array<Omit<AuthorizedLearningLesson, "activeTranscriptId" | "aiProfile">> = [];

  for (const content of authorizedContentRows.values()) {
    const completedLessonIds = getCompletedLessonIds(progressRows, content.id);
    const previous = getPreviousLessonByEntity({ contentId: content.id, lessons, modules });

    for (const lesson of lessons) {
      const courseModule = authorizedModuleRows.get(lesson.module_id);

      if (
        lesson.status !== "published" ||
        !courseModule ||
        courseModule.owner_id !== content.id ||
        (!isAdmin && !isReleaseRuleSatisfied({
          completedLessonIds,
          matchingEntitlements: matchingEntitlementsByContent.get(content.id) ?? [],
          now,
          previousLessonId: previous.previousLessonByLessonId.get(lesson.id),
          releaseRule: lesson.release_rule
        }))
      ) {
        continue;
      }
      authorizedLessonRows.push({
        contentId: content.id,
        description: trimText(lesson.description),
        duration: trimText(lesson.duration),
        id: lesson.id,
        moduleId: courseModule.id,
        progress: mapLessonProgress(progressRows, content.id, lesson.id),
        sortOrder: lesson.sort_order,
        title: lesson.title
      });
    }
  }
  const authorizedLessons = await attachTranscriptContext(authorizedLessonRows);

  return {
    contents: Array.from(authorizedContentRows.values()).map((content) => ({
      description: trimText(content.description),
      id: content.id,
      kind: content.kind,
      sortOrder: content.sort_order,
      title: content.title
    })),
    isAdmin,
    lessons: authorizedLessons,
    modules: Array.from(authorizedModuleRows.values()).map((courseModule) => ({
      contentId: courseModule.owner_id!,
      description: trimText(courseModule.description),
      id: courseModule.id,
      sortOrder: courseModule.sort_order,
      title: courseModule.title
    }))
  };
}

export const getAccessiblePublishedCatalog = resolveAuthorizedLearningCatalog;
