import "server-only";

import type { LessonVideoConfig, ReleaseRuleConfig } from "@/lib/platform-types";
import { isReleaseRuleSatisfied } from "@/server/access/release-policy";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";

type AccessContentRow = {
  access_model: string | null;
  commerce_scope: string | null;
  id: string;
  is_locked: boolean;
  kind: string;
  publication_status: string;
  release_rule: ReleaseRuleConfig | null;
};

type AccessEntitlementRow = {
  ends_at: string | null;
  starts_at: string | null;
  status: string;
  target_id: string;
  target_type: string;
};

type AccessOrderModuleRow = {
  id: string;
  owner_id: string | null;
  sort_order: number;
  status: string;
};

type AccessOrderLessonRow = {
  id: string;
  module_id: string;
  sort_order: number;
  status: string;
};

export type LessonAccessContext = {
  contentId: string;
  isAdmin: boolean;
  lessonId: string;
  videoConfig: LessonVideoConfig | null;
};

export type LessonsAccessContext = {
  contentId: string;
  isAdmin: boolean;
  lessonIds: string[];
  lessonVideoConfigs: Record<string, LessonVideoConfig | null>;
};

export class LessonAccessError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LessonAccessError";
    this.status = status;
  }
}

function throwDatabaseError(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function isActiveAccessWindow(startsAt?: string | null, endsAt?: string | null) {
  const now = Date.now();
  const start = startsAt ? new Date(startsAt).getTime() : Number.NaN;
  const end = endsAt ? new Date(endsAt).getTime() : Number.NaN;

  return !(!Number.isNaN(start) && start > now) && !(!Number.isNaN(end) && end < now);
}

function getTargetTypeForContentKind(kind: string) {
  if (kind === "Formacao") return "formation";
  if (kind === "Mentoria") return "mentorship";
  if (kind === "Webinario") return "webinar";
  if (kind === "Produto") return "product";
  if (kind === "Bootcamp") return "bootcamp";
  return "standalone_course";
}

function getActiveContentEntitlements({
  content,
  entitlements,
  parentFormationId
}: {
  content: AccessContentRow;
  entitlements: AccessEntitlementRow[];
  parentFormationId?: string;
}) {
  const expectedTargetType = getTargetTypeForContentKind(content.kind);

  return entitlements.filter((entitlement) => {
    if (entitlement.status !== "active" || !isActiveAccessWindow(entitlement.starts_at, entitlement.ends_at)) {
      return false;
    }

    if (entitlement.target_type === "platform") {
      return entitlement.target_id === "platform" || entitlement.target_id === "*";
    }

    if (entitlement.target_type === expectedTargetType && entitlement.target_id === content.id) {
      return true;
    }

    return (
      content.commerce_scope === "included_content" &&
      entitlement.target_type === "formation" &&
      Boolean(parentFormationId && entitlement.target_id === parentFormationId)
    );
  });
}

function getCompletedLessonIds(value: unknown) {
  if (!Array.isArray(value)) return new Set<string>();
  return new Set(value.filter((lessonId): lessonId is string => (
    typeof lessonId === "string" && lessonId.trim().length > 0
  )).map((lessonId) => lessonId.trim()));
}

function getPreviousLessonByEntity(
  modules: AccessOrderModuleRow[],
  lessons: AccessOrderLessonRow[]
) {
  const orderedModules = modules
    .filter((courseModule) => courseModule.status === "published")
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));
  const previousLessonByLessonId = new Map<string, string | undefined>();
  const previousLessonByModuleId = new Map<string, string | undefined>();
  let previousLessonId: string | undefined;

  for (const courseModule of orderedModules) {
    previousLessonByModuleId.set(courseModule.id, previousLessonId);
    const moduleLessons = lessons
      .filter((lesson) => lesson.status === "published" && lesson.module_id === courseModule.id)
      .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));

    for (const lesson of moduleLessons) {
      previousLessonByLessonId.set(lesson.id, previousLessonId);
      previousLessonId = lesson.id;
    }
  }

  return { previousLessonByLessonId, previousLessonByModuleId };
}

export async function requireLessonsAccess({
  contentId,
  lessonIds,
  userId
}: {
  contentId: string;
  lessonIds: string[];
  userId: string;
}): Promise<LessonsAccessContext> {
  const uniqueLessonIds = Array.from(new Set(lessonIds.map((lessonId) => lessonId.trim()).filter(Boolean)));

  if (uniqueLessonIds.length === 0) {
    throw new LessonAccessError("Aula obrigatoria.", 400);
  }

  const supabase = getSupabaseAdminClient();
  const [lessonsResult, contentResult, contentSettingsResult, adminRoleResult] = await Promise.all([
    supabase
      .from("lessons")
      .select("id,module_id,release_rule,status,video_config")
      .in("id", uniqueLessonIds),
    supabase
      .from("content_items")
      .select("id,access_model,commerce_scope,is_locked,kind,release_rule,publication_status")
      .eq("id", contentId)
      .maybeSingle(),
    supabase
      .from("content_page_settings")
      .select("settings")
      .eq("content_id", contentId)
      .maybeSingle(),
    supabase
      .from("admin_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle()
  ]);

  throwDatabaseError(lessonsResult.error, "Nao foi possivel validar as aulas");
  throwDatabaseError(contentResult.error, "Nao foi possivel validar o conteudo");
  throwDatabaseError(contentSettingsResult.error, "Nao foi possivel validar a formacao do conteudo");
  throwDatabaseError(adminRoleResult.error, "Nao foi possivel validar o papel do usuario");

  const lessons = lessonsResult.data ?? [];

  if (lessons.length !== uniqueLessonIds.length || lessons.some((lesson) => lesson.status !== "published")) {
    throw new LessonAccessError("Aula nao encontrada.", 404);
  }

  const moduleIds = Array.from(new Set(lessons.map((lesson) => lesson.module_id)));
  const moduleResult = await supabase
    .from("course_modules")
    .select("id,owner_id,release_rule,status")
    .in("id", moduleIds);
  throwDatabaseError(moduleResult.error, "Nao foi possivel validar os modulos");
  const modules = moduleResult.data ?? [];

  if (
    modules.length !== moduleIds.length ||
    modules.some((courseModule) => courseModule.status !== "published" || courseModule.owner_id !== contentId) ||
    !contentResult.data
  ) {
    throw new LessonAccessError("Uma ou mais aulas nao pertencem a este conteudo.", 404);
  }

  const content = contentResult.data;
  const contentSettings = contentSettingsResult.data?.settings as { parentFormationId?: unknown } | undefined;
  const parentFormationId = typeof contentSettings?.parentFormationId === "string"
    ? contentSettings.parentFormationId.trim() || undefined
    : undefined;
  const isAdmin = Boolean(adminRoleResult.data);
  const lessonVideoConfigs = Object.fromEntries(lessons.map((lesson) => [
    lesson.id,
    (lesson.video_config as LessonVideoConfig | null) ?? null
  ]));
  const accessContext: LessonsAccessContext = {
    contentId,
    isAdmin,
    lessonIds: uniqueLessonIds,
    lessonVideoConfigs
  };

  if (isAdmin) {
    return accessContext;
  }

  if (content.publication_status !== "published") {
    throw new LessonAccessError("Conteudo nao encontrado.", 404);
  }

  const [entitlementResult, progressResult, orderedModulesResult, parentFormationResult] = await Promise.all([
    supabase
      .from("entitlements")
      .select("target_id,target_type,starts_at,ends_at,status")
      .eq("user_id", userId)
      .eq("status", "active"),
    supabase
      .from("lesson_progress")
      .select("completed_lesson_ids")
      .eq("user_id", userId)
      .eq("content_id", contentId)
      .maybeSingle(),
    supabase
      .from("course_modules")
      .select("id,owner_id,sort_order,status")
      .eq("owner_id", contentId)
      .eq("status", "published"),
    content.commerce_scope === "included_content" && parentFormationId
      ? supabase
        .from("content_items")
        .select("id,kind,publication_status")
        .eq("id", parentFormationId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  throwDatabaseError(entitlementResult.error, "Nao foi possivel validar o acesso do aluno");
  throwDatabaseError(progressResult.error, "Nao foi possivel validar o progresso do aluno");
  throwDatabaseError(orderedModulesResult.error, "Nao foi possivel validar a ordem dos modulos");
  throwDatabaseError(parentFormationResult.error, "Nao foi possivel validar a formacao principal");
  const parentFormation = parentFormationResult.data as {
    id: string;
    kind: string;
    publication_status: string;
  } | null;
  const validatedParentFormationId = parentFormation?.kind === "Formacao" &&
    parentFormation.publication_status === "published"
    ? parentFormation.id
    : undefined;
  const matchingEntitlements = getActiveContentEntitlements({
    content: content as AccessContentRow,
    entitlements: (entitlementResult.data ?? []) as AccessEntitlementRow[],
    parentFormationId: validatedParentFormationId
  });
  const hasOpenAccess = content.access_model === "free";

  if (!hasOpenAccess && matchingEntitlements.length === 0) {
    throw new LessonAccessError("Voce nao tem acesso a uma ou mais aulas.", 403);
  }

  const orderedModules = (orderedModulesResult.data ?? []) as AccessOrderModuleRow[];
  const orderedModuleIds = orderedModules.map((courseModule) => courseModule.id);
  const orderedLessonsResult = orderedModuleIds.length > 0
    ? await supabase
      .from("lessons")
      .select("id,module_id,sort_order,status")
      .in("module_id", orderedModuleIds)
      .eq("status", "published")
    : { data: [], error: null };
  throwDatabaseError(orderedLessonsResult.error, "Nao foi possivel validar a ordem das aulas");
  const completedLessonIds = getCompletedLessonIds(progressResult.data?.completed_lesson_ids);
  const previous = getPreviousLessonByEntity(
    orderedModules,
    (orderedLessonsResult.data ?? []) as AccessOrderLessonRow[]
  );
  const now = Date.now();
  const contentReleased = isReleaseRuleSatisfied({
    completedLessonIds,
    matchingEntitlements,
    now,
    releaseRule: content.release_rule
  });
  const modulesReleased = modules.every((courseModule) => isReleaseRuleSatisfied({
    completedLessonIds,
    matchingEntitlements,
    now,
    previousLessonId: previous.previousLessonByModuleId.get(courseModule.id),
    releaseRule: courseModule.release_rule as ReleaseRuleConfig | null
  }));
  const lessonsReleased = lessons.every((lesson) => isReleaseRuleSatisfied({
    completedLessonIds,
    matchingEntitlements,
    now,
    previousLessonId: previous.previousLessonByLessonId.get(lesson.id),
    releaseRule: lesson.release_rule as ReleaseRuleConfig | null
  }));

  if (!contentReleased || !modulesReleased || !lessonsReleased) {
    throw new LessonAccessError("Uma ou mais aulas ainda nao estao liberadas.", 403);
  }

  return accessContext;
}

export async function requireLessonAccess({
  contentId,
  lessonId,
  userId
}: {
  contentId: string;
  lessonId: string;
  userId: string;
}): Promise<LessonAccessContext> {
  const access = await requireLessonsAccess({ contentId, lessonIds: [lessonId], userId });

  return {
    contentId: access.contentId,
    isAdmin: access.isAdmin,
    lessonId: access.lessonIds[0],
    videoConfig: access.lessonVideoConfigs[access.lessonIds[0]] ?? null
  };
}
