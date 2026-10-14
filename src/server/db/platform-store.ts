import { MEMBER_STYLE_DEFAULTS, normalizeMemberStyle, type MemberStyleConfig } from "@/lib/member-style";
import "server-only";
import { redactSecrets } from "@/lib/env-value";

import { cache } from "react";
import { unstable_noStore as noStore } from "next/cache";
import type { AuthenticatedUser } from "@/server/auth/session";
import { getAdminRoleForUser, getUserDisplayName } from "@/server/auth/session";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { persistImageAsset } from "@/server/db/media-assets";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { getReleaseRuleNotice } from "@/lib/release-rules";
import type { MemberReleaseState } from "@/lib/release-state";
import { resolveReleaseState, type ReleasePolicyEntitlement } from "@/server/access/release-policy";
import {
  getMemberContentHref,
  type MemberLibrary,
  type MemberLibraryAccess,
  type MemberLibraryContent,
  type MemberLibraryModule
} from "@/lib/member-library";
import { getSavedItemKey, getSavedTargetTypeForContentKind, savedItemCollectionLabel } from "@/lib/saved-items";
import { getAdminModerationData } from "@/server/comments/comment-store";
import {
  canOpenProductPage,
  itemsVisibleTo,
  onlyListedItems
} from "@/server/catalog/storefront-listing";
import { INVALID_SUPABASE_KEY_MESSAGE, isInvalidSupabaseKeyError } from "@/server/db/supabase-key-error";
import { MemberAreaConflictError } from "@/server/member-area/errors";
import { readPlatformSetting, updatePlatformSettingLatest, writePlatformSettingGuarded } from "@/server/member-area/settings-store";
import { pruneHomeSectionRefs } from "@/server/storefront/model";
import type {
  AdminAIAgent,
  AdminBlockedWordRule,
  AdminIntegrationSetting,
  AdminContentAccess,
  AdminDashboardData,
  AdminEntitlementStatus,
  AdminModerationItem,
  AdminProductCombo,
  AdminSellableProduct,
  AdminSourceProvider,
  ContentAccessModel,
  AdminStudent,
  AdminStudentCourse,
  CommerceScope,
  ContentModalStructure,
  ContentItem,
  ContentKind,
  ContentPageSettings,
  ContentPublicationStatus,
  CoursePresentationMode,
  ContentStatus,
  CourseModule,
  HomeHeroConfig,
  HomeSectionConfig,
  LessonVideoConfig,
  LessonReaction,
  LessonWatchState,
  LessonWatchStatus,
  LockedContentActionMode,
  HomeRow,
  PlatformBrandingConfig,
  PurchaseTarget,
  ReleaseRuleConfig,
  RowVisibility,
  SavedLessonItem,
  SavedModuleItem,
  SavedItemTargetType
} from "@/lib/platform-types";
import { getCourseProgressFromModules } from "@/lib/course-progress";

type PlatformStudent = {
  fullName: string;
  name: string;
};

type LessonProgressRecord = {
  completedLessonIds: string[];
  contentId: string;
  lessonReactions: Partial<Record<string, LessonReaction>>;
  lessonWatchStates: Record<string, LessonWatchState>;
  updatedAt: string;
  userId: string;
};

type SavedItemRecord = {
  collectionLabel: string;
  createdAt: string;
  id: string;
  targetId: string;
  targetType: SavedItemTargetType;
  userId: string;
};

type AccessEntitlementRecord = {
  endsAt: string | null;
  startsAt: string;
  status: AdminEntitlementStatus;
  targetId: string;
  targetType: "platform" | AdminStudentCourse["targetType"];
  userId: string;
};

type PlatformDatabase = {
  accessEntitlements: AccessEntitlementRecord[];
  aiAgents: AdminAIAgent[];
  blockedWordRules: AdminBlockedWordRule[];
  bootcamps: ContentItem[];
  branding: PlatformBrandingConfig;
  chartPoints: AdminDashboardData["chartPoints"];
  cohorts: string[];
  combos: AdminProductCombo[];
  contentPageSettings: Record<string, ContentPageSettings>;
  continueWatching: ContentItem[];
  courseModules: CourseModule[];
  courses: ContentItem[];
  entitlements: AdminDashboardData["entitlements"];
  formationInternalCourses: ContentItem[];
  formations: ContentItem[];
  hero: HomeHeroConfig;
  homeSectionConfigs: HomeSectionConfig[];
  homeSectionsConfigured: boolean;
  /**
   * Versao (coluna updated_at) da chave homeSections quando esta leitura foi feita; null = nunca
   * publicada. A Vitrine do admin antigo manda de volta ao publicar, para nao apagar uma fileira que a
   * Vitrine nova ou a tela Modulos gravou depois que ela abriu (409 em vez de perda silenciosa).
   */
  homeSectionsUpdatedAt: string | null;
  integrations: AdminIntegrationSetting[];
  lessonProgress: LessonProgressRecord[];
  metrics: AdminDashboardData["metrics"];
  moderationItems: AdminModerationItem[];
  pipeline: AdminDashboardData["pipeline"];
  recentLessons: ContentItem[];
  releaseRules: AdminDashboardData["releaseRules"];
  savedItems: SavedItemRecord[];
  student: PlatformStudent;
  students: AdminStudent[];
  upcomingProducts: ContentItem[];
  updatedAt: string;
  version: 1;
  webhookEvents: AdminDashboardData["webhookEvents"];
};

type ContentBucket =
  | "bootcamps"
  | "continue_watching"
  | "courses"
  | "formation_internal_courses"
  | "formations"
  | "recent_lessons"
  | "upcoming_products";

type ContentItemRow = {
  access_label: string | null;
  access_model: ContentAccessModel | null;
  bucket: ContentBucket;
  commerce_scope: CommerceScope | null;
  description: string | null;
  duration_label: string | null;
  eyebrow: string;
  id: string;
  image: string;
  instructor: ContentItem["instructor"] | null;
  is_locked: boolean;
  kind: ContentKind;
  lessons_label: string | null;
  level_label: string | null;
  /** Coluna do admin v2 (migracao 202610110010); so leitura aqui: contentItemToRow nunca a grava. */
  listing?: "listed" | "hidden" | null;
  max_students: number | null;
  progress: number;
  publication_status: ContentPublicationStatus;
  purchase_label: string | null;
  purchase_target: PurchaseTarget | null;
  purchase_url: string | null;
  release_rule: ReleaseRuleConfig | null;
  sort_order: number;
  status: ContentStatus;
  title: string;
};

type CourseModuleRow = {
  description: string;
  eyebrow: string;
  id: string;
  image: string;
  meta: string;
  owner_id: string | null;
  owner_kind: ContentKind | null;
  progress: number;
  release_rule: ReleaseRuleConfig | null;
  sort_order: number;
  title: string;
};

type LessonRow = {
  completed: boolean;
  description: string;
  duration: string;
  id: string;
  image: string | null;
  module_id: string;
  release_rule: ReleaseRuleConfig | null;
  sort_order: number;
  title: string;
  video_config: LessonVideoConfig | null;
};

type StudentRow = {
  access_count: number;
  avatar_url: string | null;
  city: string | null;
  document: string | null;
  email: string;
  external_customer_id: string | null;
  first_access_at: string | null;
  full_name: string;
  id: string;
  joined_at: string;
  last_activity_at: string;
  notes: string | null;
  phone: string | null;
  source_provider: AdminSourceProvider;
  state: string | null;
  status: AdminEntitlementStatus;
  tags: string[] | null;
};

type StudentCourseRow = {
  acquisition: AdminStudentCourse["acquisition"] | null;
  category: AdminStudentCourse["category"] | null;
  cohort: string | null;
  ends_at: string;
  external_order_id: string;
  id: string;
  last_activity_at: string;
  product: string;
  progress_percent: number;
  role: AdminStudentCourse["role"] | null;
  source_provider: AdminSourceProvider;
  starts_at: string;
  status: AdminEntitlementStatus;
  student_id: string;
  target_id: string;
  target_type: AdminStudentCourse["targetType"];
};

type StudentAccessLogRow = {
  action: NonNullable<AdminStudent["accessHistory"]>[number]["action"];
  device: string;
  id: string;
  location: string;
  occurred_at: string;
  student_id: string;
};

type LessonProgressRow = {
  completed_lesson_ids: string[];
  content_id: string;
  lesson_reactions?: Partial<Record<string, LessonReaction>> | null;
  lesson_watch_states?: Record<string, LessonWatchState> | null;
  updated_at: string;
  user_id: string;
};

type SavedItemRow = {
  collection_label: string;
  created_at: string;
  id: string;
  target_id: string;
  target_type: SavedItemTargetType;
  user_id: string;
};

type AccessEntitlementRow = {
  ends_at: string | null;
  starts_at: string;
  status: AdminEntitlementStatus;
  target_id: string;
  target_type: "platform" | AdminStudentCourse["targetType"];
  user_id: string;
};

type ProductComboRow = {
  cohort_name: string;
  created_at: string;
  description: string;
  id: string;
  name: string;
  status: AdminProductCombo["status"];
  students_count: number;
  updated_at: string;
};

type ProductComboItemRow = {
  combo_id: string;
  product_id: string;
  sort_order: number;
};

type LessonProgressExtrasRecord = {
  contentId: string;
  lessonReactions?: Partial<Record<string, LessonReaction>>;
  lessonWatchStates?: Record<string, LessonWatchState>;
  userId: string;
};

export type ContentWriteInput = {
  accessLabel?: string;
  accessModel?: ContentAccessModel;
  commerceScope?: CommerceScope;
  coursePresentationMode?: CoursePresentationMode;
  description?: string;
  durationLabel?: string;
  eyebrow?: string;
  homeModuleSectionEnabled?: boolean;
  heroImage?: string;
  id?: string;
  image?: string;
  isLocked?: boolean;
  kind: ContentKind;
  lessons?: string;
  lockedActionMode?: LockedContentActionMode;
  maxStudents?: number | null;
  parentFormationId?: string;
  purchaseLabel?: string;
  purchaseTarget?: PurchaseTarget;
  purchaseUrl?: string;
  publicationStatus?: ContentPublicationStatus;
  releaseRule?: ReleaseRuleConfig;
  status?: ContentStatus;
  title: string;
};

export type ContentOrderInput = {
  orderedIds: string[];
};

export type ModuleWriteInput = {
  description?: string;
  id?: string;
  image?: string;
  ownerId?: string;
  ownerKind?: ContentKind;
  releaseRule?: ReleaseRuleConfig;
  title: string;
};

export type ModuleOrderInput = {
  orderedIds: string[];
  ownerId?: string;
};

export type LessonWriteInput = {
  description?: string;
  duration?: string;
  id?: string;
  image?: string;
  moduleId: string;
  releaseRule?: ReleaseRuleConfig;
  title: string;
  video?: LessonVideoConfig | null;
};

export type LessonOrderInput = {
  moduleId: string;
  orderedIds: string[];
};

export type ProductComboWriteInput = {
  cohortName?: string;
  description?: string;
  id?: string;
  name: string;
  productIds: string[];
  status?: AdminProductCombo["status"];
};

export type PlatformAppearanceInput = {
  hero?: {
    enabled: boolean;
    image?: string;
  };
  logo?: {
    image: string | null;
  };
  /** Estilo da area do aluno (Marca > Estilo); sempre completo. */
  style?: MemberStyleConfig;
};

const defaultHero: HomeHeroConfig = {
  enabled: true,
  image: "/hero/bunker-707-red-front-hero.png",
  mediaType: "image",
  purpose: "school-brand",
  visibility: {
    badge: false,
    description: false,
    title: false
  }
};
const defaultLogoImage = "/brand/logo-bunker.svg";
const defaultBranding: PlatformBrandingConfig = {
  logoImage: defaultLogoImage,
  style: MEMBER_STYLE_DEFAULTS
};

function normalizePlatformBranding(value: unknown): PlatformBrandingConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultBranding;
  }

  const branding = value as Partial<PlatformBrandingConfig>;
  const style = normalizeMemberStyle(value);

  if (branding.logoImage === null) {
    return { logoImage: null, style };
  }

  const logoImage = typeof branding.logoImage === "string" ? branding.logoImage.trim() : "";
  return { logoImage: logoImage || defaultLogoImage, style };
}
const defaultStudent: PlatformStudent = {
  fullName: "Aluno Bunker707",
  name: "Aluno"
};
const defaultCohortName = "Turma A";

function normalizeHomeSectionOrder(sections: HomeSectionConfig[]) {
  return sections
    .slice()
    .sort((left, right) => left.order - right.order)
    .map((section, order) => ({ ...section, order }));
}

function normalizeHomeSectionConfigs(value: unknown): HomeSectionConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sectionTypes = new Set(["continue_watching", "content_carousel", "content_structure"]);
  const contentSources = new Set([
    "recent_lessons",
    "entitlement_products",
    "sellable_products",
    "upcoming_products",
    "manual",
    "selected_content_structure"
  ]);
  const layouts = new Set(["continue", "vertical", "compact", "immersive"]);
  const visibilities = new Set(["students", "non_students", "all"]);

  return normalizeHomeSectionOrder(value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    const section = entry as Partial<HomeSectionConfig>;

    if (
      typeof section.id !== "string" ||
      typeof section.title !== "string" ||
      !sectionTypes.has(section.sectionType ?? "") ||
      !contentSources.has(section.contentSource ?? "") ||
      !layouts.has(section.layout ?? "") ||
      !visibilities.has(section.visibility ?? "")
    ) {
      return [];
    }

    return [{
      contentSource: section.contentSource as HomeSectionConfig["contentSource"],
      id: section.id,
      isActive: section.isActive !== false,
      itemIds: Array.isArray(section.itemIds)
        ? section.itemIds.filter((itemId): itemId is string => typeof itemId === "string")
        : [],
      layout: section.layout as HomeSectionConfig["layout"],
      order: typeof section.order === "number" ? section.order : index,
      sectionType: section.sectionType as HomeSectionConfig["sectionType"],
      sourceContentId: typeof section.sourceContentId === "string" ? section.sourceContentId : undefined,
      subtitle: typeof section.subtitle === "string" ? section.subtitle : undefined,
      title: section.title,
      visibility: section.visibility as HomeSectionConfig["visibility"]
    }];
  }));
}

function contentBucketEntries(database: PlatformDatabase): Array<[ContentBucket, ContentItem[]]> {
  return [
    ["continue_watching", database.continueWatching],
    ["formations", database.formations],
    ["formation_internal_courses", database.formationInternalCourses],
    ["bootcamps", database.bootcamps],
    ["courses", database.courses],
    ["recent_lessons", database.recentLessons],
    ["upcoming_products", database.upcomingProducts]
  ];
}

function contentItemToRow(item: ContentItem, bucket: ContentBucket, sortOrder: number): ContentItemRow {
  return {
    access_label: item.accessLabel ?? null,
    access_model: item.accessModel ?? null,
    bucket,
    commerce_scope: item.commerceScope ?? null,
    description: item.description ?? null,
    duration_label: item.durationLabel ?? null,
    eyebrow: item.eyebrow,
    id: item.id,
    image: item.image,
    instructor: item.instructor ?? null,
    is_locked: item.isLocked ?? false,
    kind: item.kind,
    lessons_label: item.lessons ?? null,
    level_label: item.level ?? null,
    max_students: item.maxStudents ?? null,
    progress: item.progress,
    publication_status: item.publicationStatus ?? "published",
    purchase_label: item.purchaseLabel ?? null,
    purchase_target: item.purchaseTarget ?? null,
    purchase_url: item.purchaseUrl ?? null,
    release_rule: item.releaseRule ?? null,
    sort_order: sortOrder,
    status: item.status,
    title: item.title
  };
}

function contentRowToItem(row: ContentItemRow): ContentItem {
  return {
    accessLabel: row.access_label ?? undefined,
    accessModel: row.access_model ?? undefined,
    commerceScope: row.commerce_scope ?? undefined,
    description: row.description ?? undefined,
    durationLabel: row.duration_label ?? undefined,
    eyebrow: row.eyebrow,
    id: row.id,
    image: row.image,
    instructor: row.instructor ?? undefined,
    isLocked: row.is_locked || undefined,
    kind: row.kind,
    lessons: row.lessons_label ?? undefined,
    level: row.level_label ?? undefined,
    ...(row.listing === "hidden" ? { listing: "hidden" as const } : {}),
    maxStudents: row.max_students,
    progress: row.progress,
    publicationStatus: row.publication_status ?? "published",
    purchaseLabel: row.purchase_label ?? undefined,
    purchaseTarget: row.purchase_target ?? undefined,
    purchaseUrl: row.purchase_url ?? undefined,
    releaseRule: row.release_rule ?? undefined,
    status: row.status,
    title: row.title
  };
}

function moduleToRow(courseModule: CourseModule, sortOrder: number): CourseModuleRow {
  return {
    description: courseModule.description,
    eyebrow: courseModule.eyebrow,
    id: courseModule.id,
    image: courseModule.image,
    meta: courseModule.meta,
    owner_id: courseModule.ownerId ?? null,
    owner_kind: courseModule.ownerKind ?? null,
    progress: courseModule.progress,
    release_rule: courseModule.releaseRule ?? null,
    sort_order: sortOrder,
    title: courseModule.title
  };
}

function moduleRowToModule(row: CourseModuleRow, lessonRows: LessonRow[]): CourseModule {
  const lessons = lessonRows
    .filter((lesson) => lesson.module_id === row.id)
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((lesson) => ({
      completed: lesson.completed,
      description: lesson.description,
      duration: lesson.duration,
      id: lesson.id,
      image: lesson.image ?? undefined,
      releaseRule: lesson.release_rule ?? undefined,
      title: lesson.title,
      video: lesson.video_config ?? undefined
    }));

  return {
    description: row.description,
    eyebrow: row.eyebrow,
    id: row.id,
    image: row.image,
    lessons,
    meta: row.meta,
    ownerId: row.owner_id ?? undefined,
    ownerKind: row.owner_kind ?? undefined,
    progress: row.progress,
    releaseRule: row.release_rule ?? undefined,
    title: row.title
  };
}

function lessonToRow(lesson: CourseModule["lessons"][number], moduleId: string, sortOrder: number): LessonRow {
  return {
    completed: lesson.completed ?? false,
    description: lesson.description,
    duration: lesson.duration,
    id: lesson.id,
    image: lesson.image ?? null,
    module_id: moduleId,
    release_rule: lesson.releaseRule ?? null,
    sort_order: sortOrder,
    title: lesson.title,
    video_config: lesson.video ?? null
  };
}

function savedItemToRow(savedItem: SavedItemRecord): SavedItemRow {
  return {
    collection_label: savedItem.collectionLabel,
    created_at: savedItem.createdAt,
    id: savedItem.id,
    target_id: savedItem.targetId,
    target_type: savedItem.targetType,
    user_id: savedItem.userId
  };
}

function savedItemRowToRecord(row: SavedItemRow): SavedItemRecord {
  return {
    collectionLabel: row.collection_label,
    createdAt: row.created_at,
    id: row.id,
    targetId: row.target_id,
    targetType: row.target_type,
    userId: row.user_id
  };
}

function comboToRow(combo: AdminProductCombo): ProductComboRow {
  return {
    cohort_name: combo.cohortName || defaultCohortName,
    created_at: combo.createdAt,
    description: combo.description,
    id: combo.id,
    name: combo.name,
    status: combo.status,
    students_count: combo.studentsCount,
    updated_at: combo.updatedAt ?? combo.createdAt
  };
}

function comboItemRows(combo: AdminProductCombo): ProductComboItemRow[] {
  return combo.productIds.map((productId, index) => ({
    combo_id: combo.id,
    product_id: productId,
    sort_order: index
  }));
}

function comboRowsToCombos(comboRows: ProductComboRow[], itemRows: ProductComboItemRow[]): AdminProductCombo[] {
  return comboRows.map((row) => ({
    cohortName: row.cohort_name || defaultCohortName,
    createdAt: row.created_at,
    description: row.description,
    id: row.id,
    name: row.name,
    productIds: itemRows
      .filter((item) => item.combo_id === row.id)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((item) => item.product_id),
    status: row.status,
    studentsCount: row.students_count,
    updatedAt: row.updated_at
  }));
}

function studentToRow(studentRecord: AdminStudent): StudentRow {
  return {
    access_count: studentRecord.accessCount ?? 0,
    avatar_url: studentRecord.avatarUrl ?? null,
    city: studentRecord.city || null,
    document: studentRecord.document || null,
    email: studentRecord.email,
    external_customer_id: studentRecord.externalCustomerId || null,
    first_access_at: studentRecord.firstAccessAt ?? null,
    full_name: studentRecord.fullName,
    id: studentRecord.id,
    joined_at: studentRecord.joinedAt,
    last_activity_at: studentRecord.lastActivityAt,
    notes: studentRecord.notes || null,
    phone: studentRecord.phone || null,
    source_provider: studentRecord.sourceProvider,
    state: studentRecord.state || null,
    status: studentRecord.status,
    tags: studentRecord.tags
  };
}

function studentCourseToRow(course: AdminStudentCourse, studentId: string): StudentCourseRow {
  return {
    acquisition: course.acquisition ?? null,
    category: course.category ?? null,
    cohort: course.cohort ?? null,
    ends_at: course.endsAt,
    external_order_id: course.externalOrderId,
    id: course.id,
    last_activity_at: course.lastActivityAt,
    product: course.product,
    progress_percent: course.progressPercent,
    role: course.role ?? null,
    source_provider: course.sourceProvider,
    starts_at: course.startsAt,
    status: course.status,
    student_id: studentId,
    target_id: course.targetId,
    target_type: course.targetType
  };
}

function studentAccessLogToRow(log: NonNullable<AdminStudent["accessHistory"]>[number], studentId: string): StudentAccessLogRow {
  return {
    action: log.action,
    device: log.device,
    id: log.id,
    location: log.location,
    occurred_at: log.occurredAt,
    student_id: studentId
  };
}

function studentRowsToStudents(
  studentRows: StudentRow[],
  courseRows: StudentCourseRow[],
  accessLogRows: StudentAccessLogRow[]
): AdminStudent[] {
  return studentRows.map((row) => ({
    accessCount: row.access_count,
    accessHistory: accessLogRows
      .filter((log) => log.student_id === row.id)
      .map((log) => ({
        action: log.action,
        device: log.device,
        id: log.id,
        location: log.location,
        occurredAt: log.occurred_at
      })),
    avatarUrl: row.avatar_url ?? undefined,
    city: row.city ?? "",
    courses: courseRows
      .filter((course) => course.student_id === row.id)
      .map((course) => ({
        acquisition: course.acquisition ?? undefined,
        category: course.category ?? undefined,
        cohort: course.cohort ?? undefined,
        endsAt: course.ends_at,
        externalOrderId: course.external_order_id,
        id: course.id,
        lastActivityAt: course.last_activity_at,
        product: course.product,
        progressPercent: course.progress_percent,
        role: course.role ?? undefined,
        sourceProvider: course.source_provider,
        startsAt: course.starts_at,
        status: course.status,
        targetId: course.target_id,
        targetType: course.target_type
      })),
    document: row.document ?? "",
    email: row.email,
    externalCustomerId: row.external_customer_id ?? "",
    firstAccessAt: row.first_access_at ?? undefined,
    fullName: row.full_name,
    id: row.id,
    joinedAt: row.joined_at,
    lastActivityAt: row.last_activity_at,
    notes: row.notes ?? "",
    phone: row.phone ?? "",
    sourceProvider: row.source_provider,
    state: row.state ?? "",
    status: row.status,
    tags: row.tags ?? []
  }));
}

function settingsRows(database: PlatformDatabase) {
  return [
    { key: "aiAgents", value: database.aiAgents },
    { key: "blockedWordRules", value: database.blockedWordRules },
    { key: "branding", value: database.branding },
    { key: "hero", value: database.hero },
    { key: "homeSections", value: database.homeSectionConfigs },
    { key: "integrations", value: database.integrations },
    { key: "student", value: database.student },
    { key: "metrics", value: database.metrics },
    { key: "moderationItems", value: database.moderationItems },
    { key: "chartPoints", value: database.chartPoints },
    { key: "pipeline", value: database.pipeline },
    { key: "releaseRules", value: database.releaseRules },
    { key: "entitlements", value: database.entitlements },
    { key: "lessonProgressExtras", value: getLessonProgressExtrasRows(database.lessonProgress) },
    { key: "webhookEvents", value: database.webhookEvents },
    { key: "updatedAt", value: database.updatedAt },
    { key: "version", value: database.version }
  ];
}

function getLessonProgressExtrasKey(userId: string, contentId: string) {
  return `${userId}:${contentId}`;
}

function getLessonProgressExtrasRows(records: LessonProgressRecord[]): LessonProgressExtrasRecord[] {
  return records.map((record) => ({
    contentId: record.contentId,
    lessonReactions: normalizeLessonReactions(record.lessonReactions),
    lessonWatchStates: normalizeLessonWatchStates(record.lessonWatchStates),
    userId: record.userId
  }));
}

function isLessonReaction(value: unknown): value is LessonReaction {
  return value === "not-for-me" || value === "liked" || value === "loved";
}

function normalizeLessonReactions(value: unknown): Partial<Record<string, LessonReaction>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([lessonId, reaction]) => lessonId.trim().length > 0 && isLessonReaction(reaction))
  );
}

function isLessonWatchStatus(value: unknown): value is LessonWatchStatus {
  return value === "in_progress" || value === "completed";
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeProgressNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeImageUrl(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeLessonWatchState(value: unknown): LessonWatchState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<LessonWatchState>;
  const progressSeconds = Math.max(0, Math.round(normalizeProgressNumber(record.progressSeconds)));
  const durationSeconds = record.durationSeconds === undefined
    ? undefined
    : Math.max(0, Math.round(normalizeProgressNumber(record.durationSeconds)));
  const progressPercent = Math.round(clampNumber(normalizeProgressNumber(record.progressPercent), 0, 100));
  const maxProgressPercent = Math.round(clampNumber(
    normalizeProgressNumber(record.maxProgressPercent, progressPercent),
    0,
    100
  ));
  const status = isLessonWatchStatus(record.status) ? record.status : progressPercent >= 100 ? "completed" : "in_progress";
  const lastWatchedAt = typeof record.lastWatchedAt === "string" && record.lastWatchedAt.trim()
    ? record.lastWatchedAt
    : new Date().toISOString();
  const resumeFrameUrl = normalizeImageUrl(record.resumeFrameUrl);

  return {
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    lastWatchedAt,
    maxProgressPercent: status === "completed" ? 100 : Math.max(maxProgressPercent, progressPercent),
    progressPercent,
    progressSeconds,
    ...(resumeFrameUrl ? { resumeFrameUrl } : {}),
    status
  };
}

function normalizeLessonWatchStates(value: unknown): Record<string, LessonWatchState> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([lessonId, watchState]) => {
      const normalized = normalizeLessonWatchState(watchState);
      return lessonId.trim() && normalized ? [[lessonId, normalized]] : [];
    })
  );
}

function normalizeLessonProgressExtras(value: unknown) {
  if (!Array.isArray(value)) {
    return new Map<string, LessonProgressExtrasRecord>();
  }

  return new Map(
    value.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return [];
      }

      const record = entry as Partial<LessonProgressExtrasRecord>;

      if (!record.userId || !record.contentId) {
        return [];
      }

      const normalized: LessonProgressExtrasRecord = {
        contentId: record.contentId,
        lessonReactions: normalizeLessonReactions(record.lessonReactions),
        lessonWatchStates: normalizeLessonWatchStates(record.lessonWatchStates),
        userId: record.userId
      };

      return [[getLessonProgressExtrasKey(record.userId, record.contentId), normalized]];
    })
  );
}

function getSupabaseErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  return redactSecrets(message);
}

function getSupabaseErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? error.code : null;
}

async function getPlatformPersistenceProvider(): Promise<AdminDashboardData["persistenceProvider"]> {
  return "supabase";
}

function isMissingSupabaseSchemaObjectError(error: unknown) {
  const code = getSupabaseErrorCode(error);
  const message = getSupabaseErrorMessage(error);

  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    message.includes("does not exist") ||
    message.includes("Could not find") ||
    message.includes("schema cache")
  );
}

async function throwIfSupabaseError(error: unknown, context: string) {
  if (!error) {
    return;
  }

  if (isInvalidSupabaseKeyError(error)) {
    throw new Error(`${context}. ${INVALID_SUPABASE_KEY_MESSAGE}`);
  }

  const message = getSupabaseErrorMessage(error);
  throw new Error(`${context}. Confirme se a migration Supabase foi aplicada. Detalhe: ${message}`);
}

async function upsertRows(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  table: string,
  rows: unknown[],
  onConflict: string,
  context: string
) {
  if (rows.length === 0) {
    return;
  }

  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  await throwIfSupabaseError(error, context);
}

/**
 * platform_settings nao tem gatilho de updated_at. Toda gravacao de chave carimba a coluna para a
 * checagem de versao da Area de membros (src/server/member-area/settings-store.ts) perceber quando o
 * admin antigo, a Vitrine ou a Marca mudaram a mesma chave depois que outra tela a leu.
 */
function stampPlatformSettingRows(rows: Array<{ key: string; value: unknown }>, now = new Date().toISOString()) {
  return rows.map((row) => ({ ...row, updated_at: now }));
}

async function deleteMissingRows(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  table: string,
  column: string,
  wantedValues: string[],
  context: string
) {
  const existingResult = await supabase.from(table).select(column);
  await throwIfSupabaseError(existingResult.error, `Erro lendo ${table} para sincronizacao`);

  const wanted = new Set(wantedValues);
  const existingRows = (existingResult.data ?? []) as unknown as Array<Record<string, string>>;
  const missingValues = existingRows
    .map((row) => row[column])
    .filter((value) => value && !wanted.has(value));

  if (missingValues.length === 0) {
    return;
  }

  const { error } = await supabase.from(table).delete().in(column, missingValues);
  await throwIfSupabaseError(error, context);
}

async function deleteComboItemsForCombos(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  comboIds: string[]
) {
  if (comboIds.length === 0) {
    return;
  }

  const { error } = await supabase.from("product_combo_items").delete().in("combo_id", comboIds);
  await throwIfSupabaseError(error, "Erro removendo itens antigos dos combos");
}

type ReadSupabaseDatabaseOptions = {
  includeAdminData?: boolean;
  userEmail?: string;
  userId?: string;
};

function emptySupabaseResult() {
  return Promise.resolve({ data: [], error: null });
}

async function readSupabaseDatabase({
  includeAdminData = true,
  userEmail,
  userId
}: ReadSupabaseDatabaseOptions = {}) {
  const supabase = getSupabaseAdminClient();
  const cohortsQuery = includeAdminData
    ? supabase.from("cohorts").select("name").order("created_at", { ascending: true })
    : emptySupabaseResult();
  const contentItemsQuery = includeAdminData
    ? supabase.from("content_items").select("*").order("sort_order", { ascending: true })
    : supabase
      .from("content_items")
      .select("*")
      .eq("publication_status", "published")
      .order("sort_order", { ascending: true });
  // Admin le rascunhos, mas nunca o que foi excluido com "Desfazer" no admin v2 (status 'deleted').
  const modulesQuery = includeAdminData
    ? supabase.from("course_modules").select("*").neq("status", "deleted").order("sort_order", { ascending: true })
    : supabase.from("course_modules").select("*").eq("status", "published").order("sort_order", { ascending: true });
  const lessonsQuery = includeAdminData
    ? supabase.from("lessons").select("*").neq("status", "deleted").order("sort_order", { ascending: true })
    : supabase.from("lessons").select("*").eq("status", "published").order("sort_order", { ascending: true });
  const studentsQuery = includeAdminData
    ? supabase.from("students").select("*").order("created_at", { ascending: true })
    : userEmail
      ? supabase.from("students").select("*").ilike("email", userEmail.replace(/[\\%_]/g, "\\$&")).limit(1)
      : userId
        ? supabase.from("students").select("*").eq("id", userId).limit(1)
        : emptySupabaseResult();
  const studentCoursesQuery = includeAdminData
    ? supabase.from("student_courses").select("*").order("created_at", { ascending: true })
    : emptySupabaseResult();
  const accessLogsQuery = includeAdminData
    ? supabase.from("student_access_logs").select("*").order("created_at", { ascending: true })
    : emptySupabaseResult();
  const progressQuery = !includeAdminData && userId
    ? supabase.from("lesson_progress").select("*").eq("user_id", userId)
    : supabase.from("lesson_progress").select("*");
  const savedItemsQuery = !includeAdminData && userId
    ? supabase.from("saved_items").select("*").eq("user_id", userId).order("created_at", { ascending: true })
    : supabase.from("saved_items").select("*").order("created_at", { ascending: true });
  const productCombosQuery = includeAdminData
    ? supabase.from("product_combos").select("*").order("created_at", { ascending: true })
    : emptySupabaseResult();
  const productComboItemsQuery = includeAdminData
    ? supabase.from("product_combo_items").select("*").order("sort_order", { ascending: true })
    : emptySupabaseResult();
  const accessEntitlementsQuery = !includeAdminData && userId
    ? supabase.from("entitlements").select("user_id,target_type,target_id,status,starts_at,ends_at").eq("user_id", userId)
    : supabase.from("entitlements").select("user_id,target_type,target_id,status,starts_at,ends_at");
  const [
    contentItemsResult,
    contentSettingsResult,
    modulesResult,
    lessonsResult,
    cohortsResult,
    studentsResult,
    initialStudentCoursesResult,
    accessLogsResult,
    progressResult,
    savedItemsResult,
    productCombosResult,
    productComboItemsResult,
    accessEntitlementsResult,
    settingsResult
  ] = await Promise.all([
    contentItemsQuery,
    supabase.from("content_page_settings").select("*"),
    modulesQuery,
    lessonsQuery,
    cohortsQuery,
    studentsQuery,
    studentCoursesQuery,
    accessLogsQuery,
    progressQuery,
    savedItemsQuery,
    productCombosQuery,
    productComboItemsQuery,
    accessEntitlementsQuery,
    supabase.from("platform_settings").select("*")
  ]);

  const memberStudentIds = includeAdminData
    ? []
    : ((studentsResult.data ?? []) as StudentRow[]).map((student) => student.id);
  const studentCoursesResult = !includeAdminData && memberStudentIds.length > 0
    ? await supabase
      .from("student_courses")
      .select("*")
      .in("student_id", memberStudentIds)
      .order("created_at", { ascending: true })
    : initialStudentCoursesResult;

  for (const [result, context] of [
    [contentItemsResult, "Erro lendo content_items"],
    [contentSettingsResult, "Erro lendo content_page_settings"],
    [modulesResult, "Erro lendo course_modules"],
    [lessonsResult, "Erro lendo lessons"],
    [cohortsResult, "Erro lendo cohorts"],
    [studentsResult, "Erro lendo students"],
    [studentCoursesResult, "Erro lendo student_courses"],
    [accessLogsResult, "Erro lendo student_access_logs"],
    [progressResult, "Erro lendo lesson_progress"],
    [savedItemsResult, "Erro lendo saved_items"],
    [accessEntitlementsResult, "Erro lendo acessos"],
    [settingsResult, "Erro lendo platform_settings"]
  ] as const) {
    await throwIfSupabaseError(result.error, context);
  }

  const productComboTablesAvailable = !productCombosResult.error && !productComboItemsResult.error;

  if (!productComboTablesAvailable) {
    for (const [result, context] of [
      [productCombosResult, "Erro lendo product_combos"],
      [productComboItemsResult, "Erro lendo product_combo_items"]
    ] as const) {
      if (result.error && !isMissingSupabaseSchemaObjectError(result.error)) {
        await throwIfSupabaseError(result.error, context);
      }
    }
  }

  const contentRows = (contentItemsResult.data ?? []) as ContentItemRow[];
  const lessonRows = (lessonsResult.data ?? []) as LessonRow[];
  const settingsRowsRead = (settingsResult.data ?? []) as Array<{ key: string; updated_at?: string | null; value: unknown }>;
  const settingsMap = new Map(settingsRowsRead.map((setting) => [setting.key, setting.value]));
  const homeSectionsUpdatedAt = settingsRowsRead.find((setting) => setting.key === "homeSections")?.updated_at ?? null;
  const lessonProgressExtras = normalizeLessonProgressExtras(settingsMap.get("lessonProgressExtras"));
  const contentPageSettingsMap = Object.fromEntries(
    ((contentSettingsResult.data ?? []) as Array<{ content_id: string; settings: ContentPageSettings }>).map((setting) => [
      setting.content_id,
      setting.settings
    ])
  );

  const itemsByBucket = (bucket: ContentBucket) => contentRows
    .filter((row) => row.bucket === bucket)
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((row) => {
      const item = contentRowToItem(row);
      const parentFormationId = contentPageSettingsMap[item.id]?.parentFormationId;

      return parentFormationId ? { ...item, parentContentId: parentFormationId } : item;
    });

  return {
    accessEntitlements: ((accessEntitlementsResult.data ?? []) as AccessEntitlementRow[]).map((row) => ({
      endsAt: row.ends_at,
      startsAt: row.starts_at,
      status: row.status,
      targetId: row.target_id,
      targetType: row.target_type,
      userId: row.user_id
    })),
    aiAgents: (settingsMap.get("aiAgents") as PlatformDatabase["aiAgents"] | undefined) ?? [],
    blockedWordRules: (settingsMap.get("blockedWordRules") as PlatformDatabase["blockedWordRules"] | undefined) ?? [],
    bootcamps: itemsByBucket("bootcamps"),
    branding: settingsMap.has("branding") ? normalizePlatformBranding(settingsMap.get("branding")) : defaultBranding,
    // Legado decorativo: chartPoints, entitlements, metrics, pipeline, releaseRules e webhookEvents
    // vêm do JSON semeado em platform_settings, não de tabelas. O overview deixou de exibi-los;
    // serão removidos na fase 3 com os demais JSONs decorativos (docs/17 §2.4). Ficam só para tipar o legado.
    chartPoints: (settingsMap.get("chartPoints") as PlatformDatabase["chartPoints"] | undefined) ?? [],
    cohorts: ((cohortsResult.data ?? []) as Array<{ name: string }>).map((cohort) => cohort.name),
    combos: productComboTablesAvailable
      ? comboRowsToCombos(
        (productCombosResult.data ?? []) as ProductComboRow[],
        (productComboItemsResult.data ?? []) as ProductComboItemRow[]
      )
      : [],
    contentPageSettings: contentPageSettingsMap,
    continueWatching: itemsByBucket("continue_watching"),
    courseModules: ((modulesResult.data ?? []) as CourseModuleRow[]).map((row) => moduleRowToModule(row, lessonRows)),
    courses: itemsByBucket("courses"),
    entitlements: (settingsMap.get("entitlements") as PlatformDatabase["entitlements"] | undefined) ?? [],
    formationInternalCourses: itemsByBucket("formation_internal_courses"),
    formations: itemsByBucket("formations"),
    hero: (settingsMap.get("hero") as HomeHeroConfig | undefined) ?? defaultHero,
    homeSectionConfigs: normalizeHomeSectionConfigs(settingsMap.get("homeSections")),
    homeSectionsConfigured: settingsMap.has("homeSections"),
    homeSectionsUpdatedAt,
    integrations: (settingsMap.get("integrations") as PlatformDatabase["integrations"] | undefined) ?? [],
    lessonProgress: ((progressResult.data ?? []) as LessonProgressRow[]).map((row) => {
      const extras = lessonProgressExtras.get(getLessonProgressExtrasKey(row.user_id, row.content_id));

      return {
        completedLessonIds: row.completed_lesson_ids,
        contentId: row.content_id,
        lessonReactions: normalizeLessonReactions(row.lesson_reactions ?? extras?.lessonReactions),
        lessonWatchStates: normalizeLessonWatchStates(row.lesson_watch_states ?? extras?.lessonWatchStates),
        updatedAt: row.updated_at,
        userId: row.user_id
      };
    }),
    metrics: (settingsMap.get("metrics") as PlatformDatabase["metrics"] | undefined) ?? [],
    moderationItems: (settingsMap.get("moderationItems") as PlatformDatabase["moderationItems"] | undefined) ?? [],
    pipeline: (settingsMap.get("pipeline") as PlatformDatabase["pipeline"] | undefined) ?? [],
    recentLessons: itemsByBucket("recent_lessons"),
    releaseRules: (settingsMap.get("releaseRules") as PlatformDatabase["releaseRules"] | undefined) ?? [],
    savedItems: ((savedItemsResult.data ?? []) as SavedItemRow[]).map(savedItemRowToRecord),
    student: (settingsMap.get("student") as PlatformStudent | undefined) ?? defaultStudent,
    students: studentRowsToStudents(
      (studentsResult.data ?? []) as StudentRow[],
      (studentCoursesResult.data ?? []) as StudentCourseRow[],
      (accessLogsResult.data ?? []) as StudentAccessLogRow[]
    ),
    upcomingProducts: itemsByBucket("upcoming_products"),
    updatedAt: (settingsMap.get("updatedAt") as string | undefined) ?? new Date().toISOString(),
    version: 1,
    webhookEvents: (settingsMap.get("webhookEvents") as PlatformDatabase["webhookEvents"] | undefined) ?? []
  } satisfies PlatformDatabase;
}

const readAdminDatabase = cache(async () => {
  noStore();
  return readSupabaseDatabase({ includeAdminData: true });
});

const readMemberDatabase = cache(async (userId: string, userEmail: string) => {
  noStore();
  return readSupabaseDatabase({
    includeAdminData: false,
    userEmail: userEmail || undefined,
    userId: userId || undefined
  });
});

function readDatabaseForUser(user?: AuthenticatedUser | string) {
  const { email, userId } = getUserIdentity(user);
  return readMemberDatabase(userId ?? "", email ?? "");
}

function getAllContentItems(database: PlatformDatabase) {
  return [
    ...database.continueWatching,
    ...database.formations,
    ...database.formationInternalCourses,
    ...database.bootcamps,
    ...database.courses,
    ...database.recentLessons,
    ...database.upcomingProducts
  ];
}

function getUserIdentity(user?: AuthenticatedUser | string) {
  if (!user) {
    return {};
  }

  if (typeof user === "string") {
    return { userId: user };
  }

  return {
    email: user.email?.trim().toLowerCase(),
    userId: user.id
  };
}

function parseAccessDateValue(value?: string | null) {
  const trimmedValue = value?.trim();

  if (!trimmedValue || /^vital[ií]cio$/i.test(trimmedValue)) {
    return null;
  }

  const brazilianDateMatch = trimmedValue.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);

  if (brazilianDateMatch) {
    const [, day, month, year] = brazilianDateMatch;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12));
  }

  const parsedDate = new Date(trimmedValue);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function accessDateValueToIso(value?: string | null) {
  return parseAccessDateValue(value)?.toISOString() ?? null;
}

function isActiveAccessWindow(startsAt?: string | null, endsAt?: string | null) {
  const now = Date.now();
  const parsedStartDate = parseAccessDateValue(startsAt);
  const parsedEndDate = parseAccessDateValue(endsAt);

  if (parsedStartDate && parsedStartDate.getTime() > now) {
    return false;
  }

  return !(parsedEndDate && parsedEndDate.getTime() < now);
}

function getAccessTargetKey(targetType: AccessEntitlementRecord["targetType"], targetId: string) {
  return `${targetType}:${targetId}`;
}

function normalizeEntitlementSourceProvider(provider: AdminSourceProvider) {
  return provider.trim().toLowerCase() === "tiktok" ? "tiktok" : provider.trim().toLowerCase();
}

function isActiveEntitlement(entitlement: AccessEntitlementRecord) {
  return entitlement.status === "active" && isActiveAccessWindow(entitlement.startsAt, entitlement.endsAt);
}

function isActiveStudentCourse(course: AdminStudentCourse) {
  return (
    course.status === "active" &&
    !/^bloqueado/i.test(course.endsAt.trim()) &&
    isActiveAccessWindow(course.startsAt, course.endsAt)
  );
}

function getUserAccessKeys(database: PlatformDatabase, user?: AuthenticatedUser | string) {
  const { email, userId } = getUserIdentity(user);
  const accessKeys = new Set<string>();

  if (userId) {
    for (const entitlement of database.accessEntitlements) {
      if (entitlement.userId === userId && isActiveEntitlement(entitlement)) {
        accessKeys.add(getAccessTargetKey(entitlement.targetType, entitlement.targetId));
      }
    }
  }

  for (const studentRecord of database.students) {
    const studentMatchesUser =
      Boolean(userId && studentRecord.id === userId) ||
      Boolean(email && studentRecord.email.toLowerCase() === email);

    if (!studentMatchesUser || studentRecord.status !== "active") {
      continue;
    }

    for (const course of studentRecord.courses) {
      if (isActiveStudentCourse(course)) {
        accessKeys.add(getAccessTargetKey(course.targetType, course.targetId));
      }
    }
  }

  return accessKeys;
}

function hasUserEntitlementForItem(item: ContentItem, userAccessKeys: Set<string>) {
  if (userAccessKeys.has("platform:platform") || userAccessKeys.has("platform:*")) {
    return true;
  }

  if (userAccessKeys.has(getAccessTargetKey(getTargetType(item.kind), item.id))) {
    return true;
  }

  if (item.commerceScope === "included_content") {
    return Boolean(
      item.parentContentId &&
      userAccessKeys.has(getAccessTargetKey("formation", item.parentContentId))
    );
  }

  return false;
}

function hasPurchaseAccess(
  item: ContentItem,
  accessPreviewMode?: AccessPreviewMode,
  userAccessKeys = new Set<string>()
) {
  if (item.accessModel === "free") {
    return true;
  }

  if (accessPreviewMode === "producer" || accessPreviewMode === "student_with_access") {
    return true;
  }

  if (accessPreviewMode === "student_without_access") {
    return false;
  }

  return hasUserEntitlementForItem(item, userAccessKeys);
}

function applyAccessPreviewToItem(
  item: ContentItem,
  accessPreviewMode?: AccessPreviewMode,
  userAccessKeys = new Set<string>()
): ContentItem {
  const hasPreviewAccess = hasPurchaseAccess(item, accessPreviewMode, userAccessKeys);
  const isClosed = item.accessModel !== "free";
  const isPurchaseLocked = isClosed && !hasPreviewAccess;
  const isPreviewingUnlocked =
    (accessPreviewMode === "producer" || accessPreviewMode === "student_with_access") && isClosed;
  const isUnlockedForUser = hasUserEntitlementForItem(item, userAccessKeys) && isClosed;

  return {
    ...item,
    accessLabel: isPreviewingUnlocked || isUnlockedForUser ? "Comprado" : item.accessLabel,
    isLocked: isPurchaseLocked || undefined,
    purchaseLabel: isPurchaseLocked ? item.purchaseLabel ?? "Comprar" : item.purchaseLabel,
    status: item.status === "Bloqueado" && hasPreviewAccess ? "Liberado" : item.status
  };
}

function applyAccessPreviewToItems(
  items: ContentItem[],
  accessPreviewMode?: AccessPreviewMode,
  userAccessKeys = new Set<string>()
) {
  return items.map((item) => applyAccessPreviewToItem(item, accessPreviewMode, userAccessKeys));
}

function getSavedItemSet(database: PlatformDatabase, userId?: string) {
  if (!userId) {
    return new Set<string>();
  }

  return new Set(
    database.savedItems
      .filter((savedItem) => savedItem.userId === userId && savedItem.collectionLabel === savedItemCollectionLabel)
      .map((savedItem) => getSavedItemKey(savedItem.targetType, savedItem.targetId))
  );
}

function applySavedStateToItem(item: ContentItem, savedItems: Set<string>): ContentItem {
  return {
    ...item,
    isSaved: savedItems.has(getSavedItemKey(getSavedTargetTypeForContentKind(item.kind), item.id)) || undefined
  };
}

function applySavedStateToItems(items: ContentItem[], savedItems: Set<string>) {
  return items.map((item) => applySavedStateToItem(item, savedItems));
}

function applySavedStateToModules(modules: CourseModule[], savedItems: Set<string>) {
  return modules.map((module) => ({
    ...module,
    isSaved: savedItems.has(getSavedItemKey("module", module.id)) || undefined,
    lessons: module.lessons.map((lesson) => ({
      ...lesson,
      isSaved: savedItems.has(getSavedItemKey("lesson", lesson.id)) || undefined
    }))
  }));
}

function getSavedContentItems(
  database: PlatformDatabase,
  accessPreviewMode: AccessPreviewMode | undefined,
  savedItems: Set<string>,
  userAccessKeys: Set<string>
) {
  return getAllContentItems(database)
    .filter((item) => savedItems.has(getSavedItemKey(getSavedTargetTypeForContentKind(item.kind), item.id)))
    .map((item) => applySavedStateToItem(applyAccessPreviewToItem(item, accessPreviewMode, userAccessKeys), savedItems));
}

function getSavedModuleItems(
  database: PlatformDatabase,
  accessPreviewMode: AccessPreviewMode | undefined,
  savedItems: Set<string>,
  userAccessKeys: Set<string>
): SavedModuleItem[] {
  const seenModuleIds = new Set<string>();
  const modules: SavedModuleItem[] = [];

  for (const parentItem of getAllContentItems(database)) {
    const parentWithAccess = applyAccessPreviewToItem(parentItem, accessPreviewMode, userAccessKeys);

    for (const courseModule of getModulesForContent(database, parentItem)) {
      if (seenModuleIds.has(courseModule.id) || !savedItems.has(getSavedItemKey("module", courseModule.id))) {
        continue;
      }

      seenModuleIds.add(courseModule.id);
      modules.push({
        description: courseModule.description,
        id: courseModule.id,
        image: courseModule.image,
        isSaved: true,
        meta: courseModule.meta,
        parentContentId: parentItem.id,
        parentContentKind: parentItem.kind,
        parentContentTitle: parentItem.title,
        parentIsLocked: parentWithAccess.isLocked,
        title: courseModule.title
      });
    }
  }

  return modules;
}

function getSavedLessonItems(
  database: PlatformDatabase,
  accessPreviewMode: AccessPreviewMode | undefined,
  savedItems: Set<string>,
  userAccessKeys: Set<string>,
  release: MemberReleaseContext
): SavedLessonItem[] {
  const seenLessonIds = new Set<string>();
  const lessons: SavedLessonItem[] = [];

  for (const parentItem of getAllContentItems(database)) {
    const parentWithAccess = applyAccessPreviewToItem(parentItem, accessPreviewMode, userAccessKeys);

    for (const courseModule of getModulesForContent(database, parentItem)) {
      for (const lesson of courseModule.lessons) {
        if (seenLessonIds.has(lesson.id) || !savedItems.has(getSavedItemKey("lesson", lesson.id))) {
          continue;
        }

        seenLessonIds.add(lesson.id);
        // Thumbnail do YouTube so para aula liberada de conteudo com acesso (o endereco revela o video).
        const canShowVideoThumbnail = !parentWithAccess.isLocked &&
          isMemberLessonReleased(resolveContentReleaseStates(release, parentItem), courseModule.id, lesson.id);
        lessons.push({
          description: lesson.description,
          duration: lesson.duration,
          id: lesson.id,
          image: (canShowVideoThumbnail ? getVideoThumbnailUrl(lesson.video) : "") || lesson.image || courseModule.image,
          isSaved: true,
          moduleId: courseModule.id,
          moduleTitle: courseModule.title,
          parentContentId: parentItem.id,
          parentContentKind: parentItem.kind,
          parentContentTitle: parentItem.title,
          parentIsLocked: parentWithAccess.isLocked,
          title: lesson.title
        });
      }
    }
  }

  return lessons;
}

// --- Liberacao por aluno (src/server/access/release-policy.ts) ---------------------------------------
// Fonte unica da data de liberacao na tela: o mesmo resolveReleaseState que as APIs da aula usam
// (lesson-access.ts), com os acessos do aluno que casam com o conteudo (plataforma, o proprio conteudo
// ou a formacao publicada que inclui o curso) e as aulas que ELE concluiu. Um instante (`now`) por
// requisicao.
// - Previa do produtor e visitante nao tem compra real: so a data fixa e calculada; o resto vira
//   "unknown" (frase generica, continua bloqueado, como antes).
// - Aula nao liberada nunca leva o video para o navegador (nem a thumbnail do YouTube, que revela o ID).
// - Ponto de extensao da garantia: quando o pipeline de compras gravar o fim da garantia no acesso,
//   mande `warranty_ends_at` junto de `starts_at` em getReleasePolicyEntitlements; a regra com
//   `anchor: "warranty_end"` passa a contar dali (release-policy.ts, getReleaseAnchorTimestamp).

type ContentReleaseStates = {
  content: MemberReleaseState;
  lessons: Map<string, MemberReleaseState>;
  modules: Map<string, MemberReleaseState>;
};

type MemberReleaseContext = {
  /** false = previa do produtor ou visitante (sem compra real para calcular a data). */
  canResolveForUser: boolean;
  completedLessonIdsByContent: Map<string, ReadonlySet<string>>;
  contentStates: Map<string, ContentReleaseStates>;
  database: PlatformDatabase;
  now: number;
  userEntitlements: AccessEntitlementRecord[];
};

type MemberLessonVideoMode = "keep_released" | "strip_all";

const releasedMemberState: MemberReleaseState = { status: "released" };
const unknownMemberState: MemberReleaseState = { status: "unknown" };
const emptyCompletedLessonIds: ReadonlySet<string> = new Set();

function createMemberReleaseContext(
  database: PlatformDatabase,
  user: AuthenticatedUser | string | undefined,
  accessPreviewMode: AccessPreviewMode | undefined
): MemberReleaseContext {
  const { userId } = getUserIdentity(user);
  const completedLessonIdsByContent = new Map<string, ReadonlySet<string>>();

  if (userId) {
    for (const record of database.lessonProgress) {
      if (record.userId === userId) {
        completedLessonIdsByContent.set(
          record.contentId,
          new Set(Array.isArray(record.completedLessonIds) ? record.completedLessonIds : [])
        );
      }
    }
  }

  return {
    canResolveForUser: Boolean(userId) && !accessPreviewMode,
    completedLessonIdsByContent,
    contentStates: new Map(),
    database,
    now: Date.now(),
    userEntitlements: userId ? database.accessEntitlements.filter((entitlement) => entitlement.userId === userId) : []
  };
}

/**
 * Acessos ativos do aluno que valem para o conteudo: plataforma inteira, o proprio conteudo ou, para
 * curso interno, a formacao publicada que o inclui (mesma regra de lesson-access.ts).
 */
function getMatchingAccessEntitlements(
  database: PlatformDatabase,
  item: ContentItem,
  userEntitlements: AccessEntitlementRecord[]
) {
  const targetType = getTargetType(item.kind);
  const parentFormationId = item.commerceScope === "included_content" &&
    item.parentContentId &&
    database.formations.some((formation) => formation.id === item.parentContentId)
    ? item.parentContentId
    : undefined;

  return userEntitlements.filter((entitlement) => (
    isActiveEntitlement(entitlement) && (
      (entitlement.targetType === "platform" && (entitlement.targetId === "platform" || entitlement.targetId === "*")) ||
      (entitlement.targetType === targetType && entitlement.targetId === item.id) ||
      (Boolean(parentFormationId) && entitlement.targetType === "formation" && entitlement.targetId === parentFormationId)
    )
  ));
}

function getReleasePolicyEntitlements(entitlements: AccessEntitlementRecord[]): ReleasePolicyEntitlement[] {
  // Extensao futura: { starts_at, warranty_ends_at } quando o acesso guardar o fim da garantia.
  return entitlements.map((entitlement) => ({ starts_at: entitlement.startsAt }));
}

/** Aula anterior de cada aula e de cada modulo, na ordem do curso (mesma regra de lesson-access.ts). */
function getPreviousLessonMaps(modules: CourseModule[]) {
  const previousLessonByLessonId = new Map<string, string | undefined>();
  const previousLessonByModuleId = new Map<string, string | undefined>();
  let previousLessonId: string | undefined;

  for (const courseModule of modules) {
    previousLessonByModuleId.set(courseModule.id, previousLessonId);

    for (const lesson of courseModule.lessons) {
      previousLessonByLessonId.set(lesson.id, previousLessonId);
      previousLessonId = lesson.id;
    }
  }

  return { previousLessonByLessonId, previousLessonByModuleId };
}

function resolveMemberReleaseState(
  context: MemberReleaseContext,
  matchingEntitlements: ReleasePolicyEntitlement[],
  completedLessonIds: ReadonlySet<string>,
  releaseRule: ReleaseRuleConfig | undefined,
  previousLessonId?: string
): MemberReleaseState {
  if (!releaseRule || releaseRule.mode === "immediate") {
    return releasedMemberState;
  }

  if (!context.canResolveForUser) {
    const state = resolveReleaseState({
      completedLessonIds: emptyCompletedLessonIds,
      matchingEntitlements: [],
      now: context.now,
      releaseRule
    });

    return state.status === "released" || (state.status === "scheduled" && releaseRule.mode === "fixed_date")
      ? state
      : unknownMemberState;
  }

  return resolveReleaseState({
    completedLessonIds,
    matchingEntitlements,
    now: context.now,
    previousLessonId,
    releaseRule
  });
}

/** Estados do conteudo, de cada modulo e de cada aula para o aluno (cache por requisicao). */
function resolveContentReleaseStates(context: MemberReleaseContext, item: ContentItem): ContentReleaseStates {
  const cached = context.contentStates.get(item.id);

  if (cached) {
    return cached;
  }

  const matchingEntitlements = context.canResolveForUser
    ? getReleasePolicyEntitlements(getMatchingAccessEntitlements(context.database, item, context.userEntitlements))
    : [];
  const completedLessonIds = context.completedLessonIdsByContent.get(item.id) ?? emptyCompletedLessonIds;
  const modules = getModulesForContent(context.database, item);
  const previous = getPreviousLessonMaps(modules);
  const states: ContentReleaseStates = {
    content: resolveMemberReleaseState(context, matchingEntitlements, completedLessonIds, item.releaseRule),
    lessons: new Map(),
    modules: new Map()
  };

  for (const courseModule of modules) {
    states.modules.set(courseModule.id, resolveMemberReleaseState(
      context,
      matchingEntitlements,
      completedLessonIds,
      courseModule.releaseRule,
      previous.previousLessonByModuleId.get(courseModule.id)
    ));

    for (const lesson of courseModule.lessons) {
      states.lessons.set(lesson.id, resolveMemberReleaseState(
        context,
        matchingEntitlements,
        completedLessonIds,
        lesson.releaseRule,
        previous.previousLessonByLessonId.get(lesson.id)
      ));
    }
  }

  context.contentStates.set(item.id, states);
  return states;
}

/** Aula aberta para o aluno: conteudo, modulo e aula liberados. */
function isMemberLessonReleased(states: ContentReleaseStates, moduleId: string, lessonId: string) {
  return (
    states.content.status === "released" &&
    (states.modules.get(moduleId) ?? releasedMemberState).status === "released" &&
    (states.lessons.get(lessonId) ?? releasedMemberState).status === "released"
  );
}

/** So entidades com regra recebem o estado (regra imediata nao precisa de nada). */
function withMemberReleaseState<T extends { releaseRule?: ReleaseRuleConfig; releaseState?: MemberReleaseState }>(
  entity: T,
  state: MemberReleaseState | undefined
): T {
  if (!state || !entity.releaseRule || entity.releaseRule.mode === "immediate") {
    return entity;
  }

  return { ...entity, releaseState: state };
}

function applyMemberReleaseToItem(context: MemberReleaseContext, item: ContentItem): ContentItem {
  if (!item.releaseRule || item.releaseRule.mode === "immediate") {
    return item;
  }

  return withMemberReleaseState(item, resolveContentReleaseStates(context, item).content);
}

function applyMemberReleaseToItems(context: MemberReleaseContext, items: ContentItem[]) {
  return items.map((item) => applyMemberReleaseToItem(context, item));
}

/**
 * Estados de liberacao nos modulos e aulas de `item`.
 * - "keep_released" (pagina da aula): aula liberada mantem o video; as outras chegam sem video.
 * - "strip_all" (home, modal, pagina do conteudo): nenhuma aula leva video; a imagem da aula vira a
 *   thumbnail so quando a aula esta liberada e o aluno tem acesso ao conteudo.
 */
function applyMemberReleaseToModules(
  context: MemberReleaseContext,
  item: ContentItem,
  modules: CourseModule[],
  { hasAccess, videoMode }: { hasAccess: boolean; videoMode: MemberLessonVideoMode }
): CourseModule[] {
  const states = resolveContentReleaseStates(context, item);

  return modules.map((courseModule) => ({
    ...withMemberReleaseState(courseModule, states.modules.get(courseModule.id)),
    lessons: courseModule.lessons.map((lesson) => {
      const lessonWithState = withMemberReleaseState(lesson, states.lessons.get(lesson.id));
      const isReleased = hasAccess && isMemberLessonReleased(states, courseModule.id, lesson.id);

      if (videoMode === "keep_released" && isReleased) {
        return lessonWithState;
      }

      const { video, ...lessonWithoutVideo } = lessonWithState;
      const thumbnail = isReleased ? getVideoThumbnailUrl(video) : "";

      return { ...lessonWithoutVideo, image: thumbnail || lesson.image };
    })
  }));
}

function applyMemberReleaseToHomeRow(context: MemberReleaseContext, row: HomeRow): HomeRow {
  const course = row.course ? applyMemberReleaseToItem(context, row.course) : undefined;

  return {
    ...row,
    course,
    items: applyMemberReleaseToItems(context, row.items),
    modules: row.modules && row.course
      ? applyMemberReleaseToModules(context, row.course, row.modules, {
          hasAccess: !row.course.isLocked,
          videoMode: "strip_all"
        })
      : row.modules,
    structureItems: row.structureItems ? applyMemberReleaseToItems(context, row.structureItems) : row.structureItems
  };
}

function getSellableItems(database: PlatformDatabase) {
  return [...database.formations, ...database.bootcamps, ...database.courses].filter(
    (item) => item.commerceScope === "sellable_product"
  );
}

function getPurchasedProducts(
  database: PlatformDatabase,
  accessPreviewMode?: AccessPreviewMode,
  userAccessKeys = new Set<string>()
) {
  return getSellableItems(database)
    .filter((item) => hasPurchaseAccess(item, accessPreviewMode, userAccessKeys))
    .map((item) => applyAccessPreviewToItem(item, accessPreviewMode, userAccessKeys));
}

function getProductsAvailableForSale(
  database: PlatformDatabase,
  accessPreviewMode?: AccessPreviewMode,
  userAccessKeys = new Set<string>()
) {
  // "Oculto por enquanto" nunca e oferecido para compra (itemsAvailableForSale em storefront-listing.ts).
  return onlyListedItems(getSellableItems(database))
    .filter((item) => !hasPurchaseAccess(item, accessPreviewMode, userAccessKeys))
    .map((item) => applyAccessPreviewToItem(item, accessPreviewMode, userAccessKeys));
}

function getOnlineCourseSectionLabel(item: ContentItem) {
  if (item.kind === "Curso") {
    return "Cursos Online";
  }

  if (item.kind === "Mentoria") {
    return "Mentorias Online";
  }

  if (item.kind === "Webinario") {
    return "Webinarios Online";
  }

  if (item.kind === "Bootcamp") {
    return "Bootcamps Online";
  }

  return "Cursos Online";
}

function getHomeCourseModuleRows(
  database: PlatformDatabase,
  accessPreviewMode: AccessPreviewMode | undefined,
  userId: string | undefined,
  userAccessKeys: Set<string>,
  savedItems: Set<string>
): HomeRow[] {
  return onlyListedItems(getSellableItems(database)).flatMap((item) => {
    const settings = database.contentPageSettings[item.id];

    if (!settings?.homeModuleSection?.enabled || !supportsCoursePresentationMode(item.kind)) {
      return [];
    }

    const course = applySavedStateToItem(applyAccessPreviewToItem(item, accessPreviewMode, userAccessKeys), savedItems);

    const modules = applySavedStateToModules(
      applyLessonProgress(database, course.id, getModulesForContent(database, course), userId),
      savedItems
    );

    if (modules.length === 0) {
      return [];
    }

    return [{
      course,
      id: `course-modules-${course.id}`,
      items: [course],
      lockedActionMode: settings.lockedActionMode ?? "details_modal",
      modules,
      subtitle: getOnlineCourseSectionLabel(course),
      title: course.title,
      variant: "course_modules",
      visibility: "all"
    }];
  });
}

function getDefaultHomeSectionConfigs(database: PlatformDatabase): HomeSectionConfig[] {
  const structuralSections = getHomeCourseModuleRows(
    database,
    undefined,
    undefined,
    new Set(),
    new Set()
  ).flatMap((row) => row.course ? [{
      contentSource: "selected_content_structure" as const,
      id: row.id,
      isActive: true,
      itemIds: [],
      layout: "compact" as const,
      order: 0,
      sectionType: "content_structure" as const,
      sourceContentId: row.course.id,
      subtitle: row.subtitle,
      title: row.title,
      visibility: "all" as const
    }] : []);

  return normalizeHomeSectionOrder([
    {
      contentSource: "recent_lessons",
      id: "continue-watching",
      isActive: true,
      itemIds: [],
      layout: "continue",
      order: 0,
      sectionType: "continue_watching",
      subtitle: "Retome exatamente de onde parou.",
      title: "Continue assistindo",
      visibility: "students"
    },
    {
      contentSource: "entitlement_products",
      id: "my-purchases",
      isActive: true,
      itemIds: [],
      layout: "vertical",
      order: 1,
      sectionType: "content_carousel",
      subtitle: "Todos os produtos que voce ja tem acesso: formacoes, bootcamps e cursos.",
      title: "Minhas compras",
      visibility: "students"
    },
    ...structuralSections,
    {
      contentSource: "sellable_products",
      id: "showcase",
      isActive: true,
      itemIds: [],
      layout: "vertical",
      order: structuralSections.length + 2,
      sectionType: "content_carousel",
      subtitle: "Produtos disponiveis e destaques configurados pela Bunker707.",
      title: "Produtos a venda",
      visibility: "all"
    },
    {
      contentSource: "upcoming_products",
      id: "upcoming",
      isActive: true,
      itemIds: [],
      layout: "vertical",
      order: structuralSections.length + 3,
      sectionType: "content_carousel",
      subtitle: "Proximos cursos, formacoes e turmas para entrar no radar.",
      title: "Em breve na Bunker707",
      visibility: "all"
    }
  ]);
}

function getPublishedHomeSectionConfigs(database: PlatformDatabase) {
  return database.homeSectionsConfigured
    ? normalizeHomeSectionOrder(database.homeSectionConfigs)
    : getDefaultHomeSectionConfigs(database);
}

function formatWatchProgressLabel(watchState: LessonWatchState, lesson: { duration: string }) {
  if (watchState.durationSeconds && watchState.durationSeconds > 0) {
    const watchedMinutes = Math.max(1, Math.floor(watchState.progressSeconds / 60));
    const totalMinutes = Math.max(1, Math.ceil(watchState.durationSeconds / 60));
    return `${watchedMinutes}/${totalMinutes} min`;
  }

  return lesson.duration;
}

function getContinueWatchingFromProgress(
  database: PlatformDatabase,
  accessPreviewMode: AccessPreviewMode | undefined,
  user: AuthenticatedUser | string | undefined,
  userAccessKeys: Set<string>
) {
  const { userId } = getUserIdentity(user);

  if (!userId) {
    return [];
  }

  const contentItems = getAllContentItems(database);
  const release = createMemberReleaseContext(database, user, accessPreviewMode);

  return database.lessonProgress
    .filter((record) => record.userId === userId)
    .flatMap((record) => {
      const parentItem = contentItems.find((item) => item.id === record.contentId);

      if (!parentItem) {
        return [];
      }

      const parentWithAccess = applyAccessPreviewToItem(parentItem, accessPreviewMode, userAccessKeys);

      if (parentWithAccess.isLocked) {
        return [];
      }

      return Object.entries(normalizeLessonWatchStates(record.lessonWatchStates)).flatMap(([lessonId, watchState]) => {
        if (watchState.status === "completed" || watchState.progressPercent <= 0 || watchState.progressPercent >= 100) {
          return [];
        }

        for (const courseModule of getModulesForContent(database, parentItem)) {
          const lesson = courseModule.lessons.find((moduleLesson) => moduleLesson.id === lessonId);

          if (!lesson) {
            continue;
          }

          // Mesma conta do servidor da aula: so entra aula que o aluno consegue abrir agora.
          if (!isMemberLessonReleased(resolveContentReleaseStates(release, parentItem), courseModule.id, lesson.id)) {
            return [];
          }

          const item = {
            accessLabel: "Liberado",
            description: lesson.description,
            eyebrow: `${parentItem.title} · ${courseModule.title}`,
            href: `/conteudo/${parentItem.id}/aulas/${courseModule.id}?lessonId=${encodeURIComponent(lesson.id)}`,
            id: lesson.id,
            image: getLessonResumeImage(watchState, lesson, courseModule),
            kind: "Aula",
            lessons: formatWatchProgressLabel(watchState, lesson),
            progress: watchState.progressPercent,
            status: "Em andamento",
            title: lesson.title
          } satisfies ContentItem;

          return [{ item, lastWatchedAt: watchState.lastWatchedAt }];
        }

        return [];
      });
    })
    .sort((left, right) => Date.parse(right.lastWatchedAt) - Date.parse(left.lastWatchedAt))
    .map(({ item }) => item);
}

function getHomeRows(
  database: PlatformDatabase,
  accessPreviewMode?: AccessPreviewMode,
  user?: AuthenticatedUser | string
): HomeRow[] {
  const { userId } = getUserIdentity(user);
  const savedItems = getSavedItemSet(database, userId);
  const userAccessKeys = getUserAccessKeys(database, user);
  const continueWatchingItems = [
    ...getContinueWatchingFromProgress(database, accessPreviewMode, user, userAccessKeys),
    ...applyAccessPreviewToItems(database.continueWatching, accessPreviewMode, userAccessKeys)
  ];

  return resolveConfiguredHomeRows(
    database,
    getPublishedHomeSectionConfigs(database),
    accessPreviewMode,
    user,
    { continueWatchingItems, savedItems, userAccessKeys, userId }
  );
}

function resolveConfiguredHomeRows(
  database: PlatformDatabase,
  sections: HomeSectionConfig[],
  accessPreviewMode: AccessPreviewMode | undefined,
  user: AuthenticatedUser | string | undefined,
  context?: {
    continueWatchingItems: ContentItem[];
    savedItems: Set<string>;
    userAccessKeys: Set<string>;
    userId?: string;
  }
): HomeRow[] {
  const { userId } = context ?? getUserIdentity(user);
  const savedItems = context?.savedItems ?? getSavedItemSet(database, userId);
  const userAccessKeys = context?.userAccessKeys ?? getUserAccessKeys(database, user);
  const continueWatchingItems = context?.continueWatchingItems ?? [
    ...getContinueWatchingFromProgress(database, accessPreviewMode, user, userAccessKeys),
    ...applyAccessPreviewToItems(database.continueWatching, accessPreviewMode, userAccessKeys)
  ];
  const sellableItems = getSellableItems(database);
  const sellableById = new Map(sellableItems.map((item) => [item.id, item]));
  // "Oculto por enquanto": fora da vitrine; em listas com curadoria, so para quem tem acesso.
  const canSeeHidden = (item: ContentItem) => hasPurchaseAccess(item, accessPreviewMode, userAccessKeys);

  return normalizeHomeSectionOrder(sections).flatMap<HomeRow>((section) => {
    if (!section.isActive) {
      return [];
    }

    if (section.visibility === "students" && accessPreviewMode === "student_without_access") {
      return [];
    }

    if (section.visibility === "non_students" && accessPreviewMode === "student_with_access") {
      return [];
    }

    if (section.sectionType === "content_structure") {
      const source = section.sourceContentId ? sellableById.get(section.sourceContentId) : undefined;

      if (!source || itemsVisibleTo([source], canSeeHidden).length === 0) {
        return [];
      }

      const course = applySavedStateToItem(
        applyAccessPreviewToItem(source, accessPreviewMode, userAccessKeys),
        savedItems
      );
      const modules = applySavedStateToModules(
        applyLessonProgress(database, course.id, getModulesForContent(database, course), userId),
        savedItems
      );
      const structureItems = course.kind === "Formacao"
        ? applySavedStateToItems(
          applyAccessPreviewToItems(
            itemsVisibleTo(
              database.formationInternalCourses.filter((item) => item.parentContentId === course.id),
              canSeeHidden
            ),
            accessPreviewMode,
            userAccessKeys
          ),
          savedItems
        )
        : [];

      if (modules.length === 0 && structureItems.length === 0) {
        return [];
      }

      const settings = database.contentPageSettings[course.id];

      return [{
        backgroundImage: settings?.hero?.mediaSrc ?? course.image,
        course,
        id: section.id,
        items: [course],
        layout: section.layout,
        lockedActionMode: settings?.lockedActionMode ?? "details_modal",
        modules,
        sectionId: section.id,
        structureItems,
        subtitle: section.subtitle ?? getOnlineCourseSectionLabel(course),
        title: section.title,
        variant: "course_modules" as const,
        visibility: section.visibility
      }];
    }

    let items: ContentItem[];

    if (section.contentSource === "recent_lessons") {
      items = accessPreviewMode === "student_without_access" ? [] : continueWatchingItems;
    } else if (section.contentSource === "entitlement_products") {
      items = getPurchasedProducts(database, accessPreviewMode, userAccessKeys);
    } else if (section.contentSource === "upcoming_products") {
      items = applyAccessPreviewToItems(onlyListedItems(database.upcomingProducts), accessPreviewMode, userAccessKeys);
    } else if (section.contentSource === "manual") {
      items = itemsVisibleTo(
        section.itemIds.flatMap((itemId) => {
          const item = sellableById.get(itemId);
          return item ? [item] : [];
        }),
        canSeeHidden
      ).map((item) => applyAccessPreviewToItem(item, accessPreviewMode, userAccessKeys));
    } else {
      items = getProductsAvailableForSale(database, accessPreviewMode, userAccessKeys);
    }

    return [{
      id: section.id,
      items: applySavedStateToItems(items, savedItems),
      layout: section.layout,
      sectionId: section.id,
      subtitle: section.subtitle,
      title: section.title,
      variant: section.sectionType === "continue_watching" ? "continue" as const : "vertical" as const,
      visibility: section.visibility
    }];
  });
}

function getHomeModalStructures(
  database: PlatformDatabase,
  rows: HomeRow[],
  accessPreviewMode: AccessPreviewMode | undefined,
  user: AuthenticatedUser | string | undefined,
  release: MemberReleaseContext
): Record<string, ContentModalStructure> {
  const items = rows.flatMap((row) => row.items);
  const uniqueItems = new Map(items.map((item) => [item.id, item]));
  const { userId } = getUserIdentity(user);
  const savedItems = getSavedItemSet(database, userId);
  const userAccessKeys = getUserAccessKeys(database, user);

  return Object.fromEntries(
    Array.from(uniqueItems.values()).map((item) => [
      item.id,
      {
        formationCourses: item.kind === "Formacao"
          ? applyMemberReleaseToItems(release, applySavedStateToItems(
            applyAccessPreviewToItems(
              itemsVisibleTo(
                database.formationInternalCourses.filter((course) => course.parentContentId === item.id),
                (course) => hasPurchaseAccess(course, accessPreviewMode, userAccessKeys)
              ),
              accessPreviewMode,
              userAccessKeys
            ),
            savedItems
          ))
          : [],
        // O modal da home so mostra capa, titulo e duracao das aulas: nenhum video sai daqui.
        modules: applyMemberReleaseToModules(
          release,
          item,
          applySavedStateToModules(applyLessonProgress(database, item.id, getModulesForContent(database, item), userId), savedItems),
          { hasAccess: hasPurchaseAccess(item, accessPreviewMode, userAccessKeys), videoMode: "strip_all" }
        )
      }
    ])
  );
}

function getAccess(item: ContentItem): AdminContentAccess {
  if (item.status === "Em breve") {
    return "Em breve";
  }

  if (item.accessModel === "free") {
    return "Liberado";
  }

  if (item.isLocked) {
    return "Bloqueado";
  }

  if (item.progress === 0 || item.status === "Novo") {
    return "Drip";
  }

  return "Liberado";
}

function getReleaseSummary(item: ContentItem) {
  if (item.accessModel === "free") {
    return "Gratuito para cadastro";
  }

  if (item.releaseRule) {
    return describeReleaseRule(item.releaseRule);
  }

  if (item.status === "Em breve") {
    return "Data fixa futura";
  }

  if (item.isLocked) {
    return "Bloqueado até ganhar acesso";
  }

  if (item.kind === "Formacao") {
    return "Cursos internos por ordem";
  }

  if (item.kind === "Curso") {
    return item.commerceScope === "included_content" ? "Incluso na formacao" : "Apos compra";
  }

  return "Liberacao imediata";
}

function describeReleaseRule(releaseRule: ReleaseRuleConfig) {
  if (releaseRule.mode === "immediate") {
    return "Liberar imediatamente";
  }

  if (releaseRule.mode === "after_enrollment") {
    const delay = releaseRule.delayValue
      ? ` apos ${releaseRule.delayValue} ${releaseRule.delayUnit ?? "dias"}`
      : "";
    return `Depois da inscricao${delay}`;
  }

  if (releaseRule.mode === "after_purchase") {
    const delay = releaseRule.delayValue
      ? ` apos ${releaseRule.delayValue} ${releaseRule.delayUnit ?? "dias"}`
      : "";
    return `Depois da compra${delay}`;
  }

  if (releaseRule.mode === "after_previous_lesson") {
    return "Depois da aula anterior";
  }

  if (releaseRule.mode === "fixed_date") {
    return releaseRule.fixedDate ? `Agendado para ${releaseRule.fixedDate}` : "Data e hora fixa";
  }

  return releaseRule.requirement || "Atividade obrigatoria";
}

function getModulesForContent(database: PlatformDatabase, item: ContentItem) {
  const ownedModules = database.courseModules.filter((module) => module.ownerId === item.id);

  if (ownedModules.length > 0) {
    return ownedModules;
  }

  const hasScopedModules = database.courseModules.some((module) => module.ownerId);
  return hasScopedModules ? [] : database.courseModules;
}

function getModulesCount(database: PlatformDatabase, item: ContentItem) {
  if (item.kind === "Formacao") {
    const modules = getModulesForContent(database, item);
    return modules.length > 0 ? modules.length : database.formationInternalCourses.length;
  }

  if (item.kind === "Aula" || item.kind === "Material") {
    return 0;
  }

  return getModulesForContent(database, item).length;
}

function getLessonsCount(database: PlatformDatabase, item: ContentItem) {
  if (item.kind === "Formacao") {
    return getModulesForContent(database, item).reduce((total, module) => total + module.lessons.length, 0);
  }

  if (item.kind === "Aula") {
    return 1;
  }

  if (item.kind === "Material") {
    return 0;
  }

  return getModulesForContent(database, item).reduce((total, module) => total + module.lessons.length, 0);
}

function getVisibility(item: ContentItem): RowVisibility {
  return item.isLocked ? "all" : "students";
}

function getStudentForUser(database: PlatformDatabase, user?: AuthenticatedUser): PlatformStudent {
  if (!user) {
    return database.student;
  }

  const displayName = getUserDisplayName(user);
  const userEmail = user.email?.toLowerCase();
  const matchingStudent = database.students.find((studentRecord) => {
    if (studentRecord.id === user.id) {
      return true;
    }

    return Boolean(userEmail && studentRecord.email.toLowerCase() === userEmail);
  });
  const fullName = matchingStudent?.fullName || displayName.fullName;

  return {
    fullName,
    name: fullName.split(/\s+/)[0] || displayName.name
  };
}

function getAdminRecords(database: PlatformDatabase) {
  return [
    ...database.formations,
    ...database.courses,
    ...database.bootcamps,
    ...database.formationInternalCourses
  ].map((content) => ({
    access: getAccess(content),
    commerceScope: content.commerceScope ?? "learning_content",
    content,
    kind: content.kind,
    lessonsCount: getLessonsCount(database, content),
    modulesCount: getModulesCount(database, content),
    owner: "CMS Bunker707",
    pageSettings: database.contentPageSettings[content.id],
    releaseSummary: getReleaseSummary(content),
    status: content.status,
    updatedAt: database.updatedAt ?? "",
    visibility: getVisibility(content)
  }));
}

function getTargetType(kind: ContentKind): AdminStudentCourse["targetType"] {
  if (kind === "Formacao") {
    return "formation";
  }

  if (kind === "Mentoria") {
    return "mentorship";
  }

  if (kind === "Webinario") {
    return "webinar";
  }

  if (kind === "Produto") {
    return "product";
  }

  if (kind === "Bootcamp") {
    return "bootcamp";
  }

  return "standalone_course";
}

function getSellableProducts(database: PlatformDatabase): AdminSellableProduct[] {
  return getSellableItems(database).map((item) => ({
    id: item.id,
    image: item.image,
    kind: item.kind,
    targetType: getTargetType(item.kind),
    title: item.title
  }));
}

function getAdminHomeSections(database: PlatformDatabase) {
  const rowsById = new Map(getHomeRows(database).map((row) => [row.id, row]));

  return getPublishedHomeSectionConfigs(database).map((section) => {
    const row = rowsById.get(section.id);

    return {
      ...section,
      contentCount: row?.variant === "course_modules"
        ? (row.modules?.length ?? 0) + (row.structureItems?.length ?? 0)
        : row?.items.length ?? 0,
      source:
        section.contentSource === "recent_lessons"
          ? "Progresso do aluno"
          : section.contentSource === "entitlement_products"
            ? "Acessos ativos"
            : section.contentSource === "selected_content_structure"
              ? "Estrutura de conteudo"
              : section.contentSource === "manual"
                ? "Selecao manual"
                : "Curadoria automatica"
    };
  });
}

function getEffectiveCohorts(database: PlatformDatabase) {
  return database.cohorts.length > 0 ? database.cohorts : [defaultCohortName];
}

function toAdminDashboardData(
  database: PlatformDatabase,
  persistenceProvider: AdminDashboardData["persistenceProvider"]
): AdminDashboardData {
  const homeRows = getHomeRows(database).filter((row) => (
    row.variant === "course_modules"
      ? (row.modules?.length ?? 0) + (row.structureItems?.length ?? 0) > 0
      : row.items.length > 0
  ));

  return {
    aiAgents: database.aiAgents,
    blockedWordRules: database.blockedWordRules,
    branding: database.branding,
    chartPoints: database.chartPoints,
    cohorts: getEffectiveCohorts(database),
    combos: database.combos,
    contentRecords: getAdminRecords(database),
    courseModules: database.courseModules,
    entitlements: database.entitlements,
    formationCourses: database.formationInternalCourses,
    hero: database.hero,
    homeSectionConfigs: getPublishedHomeSectionConfigs(database),
    homeSectionsUpdatedAt: database.homeSectionsUpdatedAt,
    homeRows,
    homeSections: getAdminHomeSections(database),
    integrations: database.integrations,
    metrics: database.metrics,
    moderationItems: database.moderationItems,
    pipeline: database.pipeline,
    persistenceProvider,
    releaseRules: database.releaseRules,
    sellableProducts: getSellableProducts(database),
    students: database.students,
    webhookEvents: database.webhookEvents
  };
}

async function toHydratedAdminDashboardData(database: PlatformDatabase) {
  const [persistenceProvider, moderationData] = await Promise.all([
    getPlatformPersistenceProvider(),
    getAdminModerationData()
  ]);

  return {
    ...toAdminDashboardData(database, persistenceProvider),
    ...moderationData
  };
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

function makeId(prefix: string, title: string) {
  return `${prefix}-${slugify(title) || Date.now()}-${Date.now().toString(36)}`;
}

function getContentBucket(database: PlatformDatabase, item: ContentItem) {
  if (item.kind === "Formacao") {
    return database.formations;
  }

  if (item.kind === "Bootcamp") {
    return database.bootcamps;
  }

  if (item.kind === "Aula") {
    return database.recentLessons;
  }

  if (item.commerceScope === "included_content") {
    return database.formationInternalCourses;
  }

  return database.courses;
}

function supportsCoursePresentationMode(kind: ContentKind) {
  return ["Curso", "Bootcamp", "Mentoria", "Webinario", "Produto"].includes(kind);
}

function removeContentById(database: PlatformDatabase, itemId: string) {
  database.formations = database.formations.filter((item) => item.id !== itemId);
  database.bootcamps = database.bootcamps.filter((item) => item.id !== itemId);
  database.courses = database.courses.filter((item) => item.id !== itemId);
  database.formationInternalCourses = database.formationInternalCourses.filter((item) => item.id !== itemId);
  database.recentLessons = database.recentLessons.filter((item) => item.id !== itemId);
  database.upcomingProducts = database.upcomingProducts.filter((item) => item.id !== itemId);
  database.continueWatching = database.continueWatching.filter((item) => item.id !== itemId);
}

function normalizeContentInput(input: ContentWriteInput): ContentItem {
  const commerceScope = input.commerceScope ?? (input.kind === "Aula" ? "learning_content" : "sellable_product");
  const accessModel = input.accessModel ?? "closed";
  const isLocked = input.isLocked ?? (input.status === "Bloqueado" || accessModel === "closed");
  const idPrefix =
    input.kind === "Formacao"
      ? "formation"
      : input.kind === "Mentoria"
        ? "mentorship"
        : input.kind === "Webinario"
          ? "webinar"
          : input.kind === "Produto"
            ? "product"
      : input.kind === "Bootcamp"
        ? "bootcamp"
        : input.kind === "Aula"
          ? "lesson"
          : commerceScope === "included_content"
            ? "formation-course"
            : "course";

  return {
    accessLabel: input.accessLabel ?? (commerceScope === "included_content" ? "Curso da formacao" : input.kind),
    accessModel,
    commerceScope,
    description: input.description || "Conteudo cadastrado no CMS persistido da Bunker707.",
    durationLabel: input.durationLabel,
    eyebrow: input.eyebrow || input.kind,
    id: input.id || makeId(idPrefix, input.title),
    image: input.image?.trim() ?? "",
    isLocked,
    kind: input.kind,
    lessons: input.lessons || (input.kind === "Aula" ? "Aula" : "0 aulas"),
    maxStudents: input.maxStudents ?? null,
    progress: 0,
    publicationStatus: input.publicationStatus ?? "draft",
    purchaseLabel: input.purchaseLabel ?? (isLocked && accessModel !== "free" ? "Comprar" : undefined),
    purchaseTarget: input.purchaseTarget ?? "same_tab",
    purchaseUrl: input.purchaseUrl,
    releaseRule: input.releaseRule,
    status: input.status ?? (accessModel === "free" ? "Liberado" : isLocked ? "Bloqueado" : "Novo"),
    title: input.title
  };
}

function normalizeProductComboInput(
  database: PlatformDatabase,
  input: ProductComboWriteInput
): AdminProductCombo {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Nome do combo e obrigatorio.");
  }

  const sellableProductIds = new Set(getSellableItems(database).map((item) => item.id));
  const productIds = Array.from(new Set(input.productIds ?? []))
    .map((productId) => productId.trim())
    .filter((productId) => sellableProductIds.has(productId));

  if (productIds.length === 0) {
    throw new Error("Selecione pelo menos um produto valido para o combo.");
  }

  const existingCombo = input.id
    ? database.combos.find((combo) => combo.id === input.id)
    : undefined;
  const createdAt = existingCombo?.createdAt ?? new Date().toISOString();

  return {
    cohortName: input.cohortName?.trim() || existingCombo?.cohortName || defaultCohortName,
    createdAt,
    description: input.description?.trim() ?? existingCombo?.description ?? "",
    id: existingCombo?.id ?? input.id ?? makeId("combo", name),
    name,
    productIds,
    status: input.status ?? existingCombo?.status ?? "draft",
    studentsCount: existingCombo?.studentsCount ?? 0,
    updatedAt: new Date().toISOString()
  };
}

function getLessonReactions(database: PlatformDatabase, contentId: string, userId?: string) {
  if (!userId) {
    return {};
  }

  return normalizeLessonReactions(
    database.lessonProgress.find((record) => record.userId === userId && record.contentId === contentId)
      ?.lessonReactions
  );
}

function getLessonWatchStates(database: PlatformDatabase, contentId: string, userId?: string) {
  if (!userId) {
    return {};
  }

  return normalizeLessonWatchStates(
    database.lessonProgress.find((record) => record.userId === userId && record.contentId === contentId)
      ?.lessonWatchStates
  );
}

function extractYouTubeId(value?: string) {
  if (!value) {
    return "";
  }

  const trimmedValue = value.trim();

  if (/^[\w-]{11}$/.test(trimmedValue)) {
    return trimmedValue;
  }

  try {
    const url = new URL(trimmedValue);

    if (url.hostname.includes("youtu.be")) {
      return url.pathname.replace("/", "");
    }

    if (url.hostname.includes("youtube.com")) {
      return url.searchParams.get("v") ?? url.pathname.split("/").filter(Boolean).pop() ?? "";
    }
  } catch {
    return trimmedValue;
  }

  return "";
}

function minimizeStudentYouTubeVideoConfigs(modules: CourseModule[]) {
  return modules.map((courseModule) => ({
    ...courseModule,
    lessons: courseModule.lessons.map((lesson) => {
      if (lesson.video?.provider !== "youtube") {
        return lesson;
      }

      const videoId = lesson.video.assetId?.trim() || extractYouTubeId(lesson.video.url);

      return {
        ...lesson,
        video: {
          ...(videoId && /^[A-Za-z0-9_-]{11}$/.test(videoId) ? { assetId: videoId } : {}),
          provider: "youtube" as const
        }
      };
    })
  }));
}

function getVideoThumbnailUrl(video?: LessonVideoConfig) {
  if (video?.provider !== "youtube") {
    return "";
  }

  const videoId = video.assetId || extractYouTubeId(video.url);

  return videoId ? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg` : "";
}

function getLessonResumeImage(
  watchState: LessonWatchState,
  lesson: CourseModule["lessons"][number],
  courseModule: CourseModule
) {
  return watchState.resumeFrameUrl || getVideoThumbnailUrl(lesson.video) || lesson.image || courseModule.image;
}

function applyLessonProgress(database: PlatformDatabase, contentId: string, modules: CourseModule[], userId?: string) {
  const progressRecord = userId
    ? database.lessonProgress.find((record) => record.userId === userId && record.contentId === contentId)
    : undefined;
  const completedLessonIds = new Set(progressRecord?.completedLessonIds ?? []);
  const lessonWatchStates = normalizeLessonWatchStates(progressRecord?.lessonWatchStates);
  const hasWatchProgress = Object.keys(lessonWatchStates).length > 0;

  if (completedLessonIds.size === 0 && !hasWatchProgress) {
    if (!userId) {
      return modules;
    }

    // Sem registro proprio de progresso, o estado global lessons.completed/progress nao pode vazar para o aluno.
    return modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({ ...lesson, completed: false })),
      progress: 0
    }));
  }

  return modules.map((module) => {
    const lessons = module.lessons.map((lesson) => ({
      ...lesson,
      completed: completedLessonIds.has(lesson.id)
    }));
    const progress = lessons.length > 0
      ? Math.round(
        lessons.reduce((total, lesson) => {
          if (lesson.completed) {
            return total + 100;
          }

          return total + clampNumber(lessonWatchStates[lesson.id]?.progressPercent ?? 0, 0, 100);
        }, 0) / lessons.length
      )
      : module.progress;

    return {
      ...module,
      lessons,
      progress
    };
  });
}

export async function getAppShellData(user?: AuthenticatedUser) {
  const database = await readDatabaseForUser(user);
  const adminRole = user ? await getAdminRoleForUser(user.id) : null;

  return {
    branding: database.branding,
    canUseAccessPreview: Boolean(adminRole),
    student: getStudentForUser(database, user)
  };
}

export async function getHomePageData(accessPreviewMode?: AccessPreviewMode, user?: AuthenticatedUser | string) {
  const database = await readDatabaseForUser(user);
  const release = createMemberReleaseContext(database, user, accessPreviewMode);
  const homeRows = getHomeRows(database, accessPreviewMode, user).filter((row) => row.items.length > 0)
    .map((row) => applyMemberReleaseToHomeRow(release, row));

  const modalStructures = getHomeModalStructures(database, homeRows, accessPreviewMode, user, release);

  return {
    hero: database.hero,
    // O card da home mostra o progresso do aluno no produto (anel no hover) com a mesma conta do modal.
    homeRows: homeRows.map((row) => withStudentProgress(row, modalStructures)),
    modalStructures
  };
}

/** Progresso do aluno em cada item da fileira (media dos modulos; content_items.progress so sem modulos). */
function withStudentProgress(row: HomeRow, structures: Record<string, ContentModalStructure>): HomeRow {
  const withProgress = (item: ContentItem): ContentItem => ({
    ...item,
    progress: getCourseProgressFromModules(structures[item.id]?.modules ?? [], item.progress)
  });

  return {
    ...row,
    course: row.course ? withProgress(row.course) : row.course,
    items: row.items.map(withProgress)
  };
}

export async function getPurchasesPageData(accessPreviewMode?: AccessPreviewMode, user?: AuthenticatedUser | string) {
  const database = await readDatabaseForUser(user);
  return {
    purchasedProducts: getPurchasedProducts(database, accessPreviewMode, getUserAccessKeys(database, user))
  };
}

export async function getFavoritesPageData(accessPreviewMode?: AccessPreviewMode, user?: AuthenticatedUser | string) {
  const database = await readDatabaseForUser(user);
  const { userId } = getUserIdentity(user);
  const savedItems = getSavedItemSet(database, userId);
  const userAccessKeys = getUserAccessKeys(database, user);

  return {
    savedContentItems: getSavedContentItems(database, accessPreviewMode, savedItems, userAccessKeys),
    savedLessonItems: getSavedLessonItems(
      database,
      accessPreviewMode,
      savedItems,
      userAccessKeys,
      createMemberReleaseContext(database, user, accessPreviewMode)
    ),
    savedModuleItems: getSavedModuleItems(database, accessPreviewMode, savedItems, userAccessKeys)
  };
}

// --- Biblioteca do aluno (src/lib/member-library.ts) -------------------------------------------------
// Minhas compras, Favoritos e as paginas novas da barra lateral leem daqui. So entra conteudo que o
// aluno pode abrir (mesma regra de hasPurchaseAccess), com o progresso dele; nada de video sai daqui.

type MemberLibraryRelease = { isReleaseLocked: boolean; releaseLabel?: string };

/**
 * Ponto unico de liberacao da biblioteca: o estado calculado no servidor para o aluno (release-policy,
 * via resolveContentReleaseStates) vira o texto com a data real ("Liberação em 08/01/2026"); previa e
 * sem compra caem na frase generica da regra.
 */
function resolveMemberLibraryRelease(
  releaseRule: ReleaseRuleConfig | undefined,
  entityLabel: "aula" | "modulo" | string,
  releaseState: MemberReleaseState | undefined,
  now: number
): MemberLibraryRelease {
  const notice = getReleaseRuleNotice(releaseRule, entityLabel, releaseState, now);
  return notice?.isLocked ? { isReleaseLocked: true, releaseLabel: notice.detail } : { isReleaseLocked: false };
}

function getMemberLibraryAccess(
  database: PlatformDatabase,
  item: ContentItem,
  userEntitlements: AccessEntitlementRecord[],
  accessPreviewMode: AccessPreviewMode | undefined
): MemberLibraryAccess {
  const matching = getMatchingAccessEntitlements(database, item, userEntitlements);

  if (matching.length > 0) {
    const startsAt = matching
      .map((entitlement) => entitlement.startsAt)
      .filter((value) => Number.isFinite(Date.parse(value)))
      .sort((left, right) => Date.parse(left) - Date.parse(right))[0] ?? null;
    const endsAt = matching.some((entitlement) => !entitlement.endsAt)
      ? null
      : matching
        .map((entitlement) => entitlement.endsAt as string)
        .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

    return { endsAt, kind: "entitlement", startsAt };
  }

  if (item.accessModel === "free") {
    return { endsAt: null, kind: "free", startsAt: null };
  }

  return { endsAt: null, kind: accessPreviewMode ? "preview" : "entitlement", startsAt: null };
}

function toMemberLibraryModules(
  database: PlatformDatabase,
  item: ContentItem,
  contentRelease: MemberLibraryRelease,
  savedItems: Set<string>,
  userId: string | undefined,
  release: MemberReleaseContext
): MemberLibraryModule[] {
  const modules = applyLessonProgress(database, item.id, getModulesForContent(database, item), userId);
  const watchStates = getLessonWatchStates(database, item.id, userId);
  const reactions = getLessonReactions(database, item.id, userId);
  const releaseStates = resolveContentReleaseStates(release, item);

  return modules.map((courseModule) => {
    const moduleRelease = contentRelease.isReleaseLocked
      ? contentRelease
      : resolveMemberLibraryRelease(courseModule.releaseRule, "modulo", releaseStates.modules.get(courseModule.id), release.now);

    return {
      contentId: item.id,
      id: courseModule.id,
      image: courseModule.image,
      isReleaseLocked: moduleRelease.isReleaseLocked,
      isSaved: savedItems.has(getSavedItemKey("module", courseModule.id)),
      lessons: courseModule.lessons.map((lesson) => {
        const lessonRelease = moduleRelease.isReleaseLocked
          ? moduleRelease
          : resolveMemberLibraryRelease(lesson.releaseRule, "aula", releaseStates.lessons.get(lesson.id), release.now);
        const watchState = watchStates[lesson.id];
        // Aula bloqueada nunca leva a thumbnail do video (o endereco revelaria o video antes da liberacao).
        const image = lessonRelease.isReleaseLocked
          ? lesson.image ?? ""
          : getVideoThumbnailUrl(lesson.video) || lesson.image || "";

        return {
          completed: Boolean(lesson.completed),
          contentId: item.id,
          duration: lesson.duration,
          id: lesson.id,
          image,
          isReleaseLocked: lessonRelease.isReleaseLocked,
          isSaved: savedItems.has(getSavedItemKey("lesson", lesson.id)),
          moduleId: courseModule.id,
          rated: Boolean(reactions[lesson.id]),
          releaseLabel: lessonRelease.releaseLabel,
          resumeImage: lessonRelease.isReleaseLocked
            ? image || courseModule.image
            : watchState?.resumeFrameUrl || image || courseModule.image,
          title: lesson.title,
          watch: watchState
            ? {
                ...(watchState.durationSeconds !== undefined ? { durationSeconds: watchState.durationSeconds } : {}),
                lastWatchedAt: watchState.lastWatchedAt,
                maxProgressPercent: watchState.maxProgressPercent ?? watchState.progressPercent,
                progressPercent: watchState.progressPercent,
                progressSeconds: watchState.progressSeconds,
                status: watchState.status
              }
            : null
        };
      }),
      releaseLabel: moduleRelease.releaseLabel,
      title: courseModule.title
    };
  });
}

export async function getMemberLibrary(
  accessPreviewMode?: AccessPreviewMode,
  user?: AuthenticatedUser | string
): Promise<MemberLibrary> {
  const database = await readDatabaseForUser(user);
  const { userId } = getUserIdentity(user);
  const savedItems = getSavedItemSet(database, userId);
  const userAccessKeys = getUserAccessKeys(database, user);
  const userEntitlements = userId
    ? database.accessEntitlements.filter((entitlement) => entitlement.userId === userId)
    : [];
  const release = createMemberReleaseContext(database, user, accessPreviewMode);
  const candidates = new Map<string, ContentItem>();

  // Buckets de conteudo real; continue_watching/recent_lessons/upcoming_products sao legado da home.
  for (const item of [
    ...database.formations,
    ...database.bootcamps,
    ...database.courses,
    ...database.formationInternalCourses
  ]) {
    if (!candidates.has(item.id) && hasPurchaseAccess(item, accessPreviewMode, userAccessKeys)) {
      candidates.set(item.id, item);
    }
  }

  const contents = Array.from(candidates.values()).map((item): MemberLibraryContent => {
    const contentRelease = resolveMemberLibraryRelease(
      item.releaseRule,
      item.kind.toLowerCase(),
      resolveContentReleaseStates(release, item).content,
      release.now
    );

    return {
      access: getMemberLibraryAccess(database, item, userEntitlements, accessPreviewMode),
      childContentIds: item.kind === "Formacao"
        ? database.formationInternalCourses
          .filter((course) => course.parentContentId === item.id && candidates.has(course.id))
          .map((course) => course.id)
        : [],
      commerceScope: item.commerceScope,
      description: item.description ?? "",
      eyebrow: item.eyebrow,
      href: getMemberContentHref(item.id, accessPreviewMode),
      id: item.id,
      image: item.image,
      isReleaseLocked: contentRelease.isReleaseLocked,
      isSaved: savedItems.has(getSavedItemKey(getSavedTargetTypeForContentKind(item.kind), item.id)),
      kind: item.kind,
      modules: toMemberLibraryModules(database, item, contentRelease, savedItems, userId, release),
      parentContentId: item.parentContentId,
      releaseLabel: contentRelease.releaseLabel,
      title: item.title
    };
  });

  return { accessPreviewMode, contents, userId: userId ?? null };
}

export async function getContentRouteParams() {
  const database = await readAdminDatabase();
  return getAllContentItems(database).map((item) => ({
    id: item.id
  }));
}

export async function getLessonRouteParams() {
  const database = await readAdminDatabase();
  return getAllContentItems(database).flatMap((item) =>
    getModulesForContent(database, item).map((module) => ({
      id: item.id,
      moduleId: module.id
    }))
  );
}

export async function getContentPageData(
  contentId: string,
  user?: AuthenticatedUser | string,
  accessPreviewMode?: AccessPreviewMode
) {
  const database = await readDatabaseForUser(user);
  const allContentItems = getAllContentItems(database);
  const item = allContentItems.find((content) => content.id === contentId) ?? null;
  const { userId } = getUserIdentity(user);
  const savedItems = getSavedItemSet(database, userId);
  const userAccessKeys = getUserAccessKeys(database, user);

  // "Oculto por enquanto" sem acesso responde como inexistente.
  if (!item || !canOpenProductPage(item, hasPurchaseAccess(item, accessPreviewMode, userAccessKeys))) {
    return null;
  }

  const hasAccess = hasPurchaseAccess(item, accessPreviewMode, userAccessKeys);
  const release = createMemberReleaseContext(database, user, accessPreviewMode);

  return {
    allContentItems: applySavedStateToItems(
      applyAccessPreviewToItems(allContentItems, accessPreviewMode, userAccessKeys),
      savedItems
    ),
    // A pagina do conteudo so mostra modulos e contagem de aulas: nenhum video sai daqui.
    courseModules: applyMemberReleaseToModules(
      release,
      item,
      applySavedStateToModules(applyLessonProgress(database, contentId, getModulesForContent(database, item), userId), savedItems),
      { hasAccess, videoMode: "strip_all" }
    ),
    formationInternalCourses: applyMemberReleaseToItems(release, applySavedStateToItems(
      applyAccessPreviewToItems(
        itemsVisibleTo(
          item.kind === "Formacao"
            ? database.formationInternalCourses.filter((course) => course.parentContentId === item.id)
            : database.formationInternalCourses,
          (course) => hasPurchaseAccess(course, accessPreviewMode, userAccessKeys)
        ),
        accessPreviewMode,
        userAccessKeys
      ),
      savedItems
    )),
    formations: applySavedStateToItems(
      applyAccessPreviewToItems(database.formations, accessPreviewMode, userAccessKeys),
      savedItems
    ),
    hero: database.hero,
    item: applyMemberReleaseToItem(
      release,
      applySavedStateToItem(applyAccessPreviewToItem(item, accessPreviewMode, userAccessKeys), savedItems)
    ),
    settings: database.contentPageSettings[item.id]
  };
}

export async function getLessonPageData(
  contentId: string,
  moduleId: string,
  user?: AuthenticatedUser | string,
  accessPreviewMode?: AccessPreviewMode
) {
  const database = await readDatabaseForUser(user);
  const allContentItems = getAllContentItems(database);
  const item = allContentItems.find((content) => content.id === contentId) ?? null;
  const { userId } = getUserIdentity(user);
  const savedItems = getSavedItemSet(database, userId);
  const userAccessKeys = getUserAccessKeys(database, user);
  const release = createMemberReleaseContext(database, user, accessPreviewMode);
  // Aula ainda nao liberada para o aluno chega sem video (nem ID do YouTube); sem acesso, nenhuma leva.
  const modules = item
    ? minimizeStudentYouTubeVideoConfigs(
        applyMemberReleaseToModules(
          release,
          item,
          applySavedStateToModules(
            applyLessonProgress(database, contentId, getModulesForContent(database, item), userId),
            savedItems
          ),
          {
            hasAccess: hasPurchaseAccess(item, accessPreviewMode, userAccessKeys),
            videoMode: "keep_released"
          }
        )
      )
    : [];
  const selectedModule = modules.find((courseModule) => courseModule.id === moduleId) ?? null;
  const parentFormation = item?.commerceScope === "included_content"
    ? database.formations.find((formation) => formation.id === item.parentContentId)
    : undefined;

  if (!item || !selectedModule) {
    return null;
  }

  return {
    allModules: modules,
    initialLessonReactions: getLessonReactions(database, contentId, userId),
    initialLessonWatchStates: getLessonWatchStates(database, contentId, userId),
    item: applyMemberReleaseToItem(
      release,
      applySavedStateToItem(applyAccessPreviewToItem(item, accessPreviewMode, userAccessKeys), savedItems)
    ),
    returnContent: parentFormation
      ? applySavedStateToItem(applyAccessPreviewToItem(parentFormation, accessPreviewMode, userAccessKeys), savedItems)
      : undefined,
    selectedModule
  };
}

export async function getAdminDashboardData() {
  const database = await readAdminDatabase();
  return toHydratedAdminDashboardData(database);
}

function validateHomeSectionConfigs(configs: HomeSectionConfig[], database: PlatformDatabase) {
  const sellableIds = new Set(getSellableItems(database).map((item) => item.id));
  // Produto que nao esta mais a venda (excluido ou fora de venda) nao trava a publicacao: sai da
  // escolha manual e leva junto a fileira de modulos dele, como a home do aluno ja faz. Cobre a tela
  // antiga e a corrida com uma exclusao entre abrir a Vitrine e publicar.
  const { sections } = pruneHomeSectionRefs(configs, (itemId) => sellableIds.has(itemId));
  const ids = new Set<string>();
  const automaticSources = new Set<string>();
  const validLayoutsByType: Record<HomeSectionConfig["sectionType"], Set<HomeSectionConfig["layout"]>> = {
    continue_watching: new Set(["continue"]),
    content_carousel: new Set(["vertical"]),
    content_structure: new Set(["compact", "immersive"])
  };

  for (const section of sections) {
    const id = section.id.trim();

    if (!id || ids.has(id)) {
      throw new Error("Cada secao precisa ter um identificador unico.");
    }

    if (!section.title.trim()) {
      throw new Error("O titulo da secao e obrigatorio.");
    }

    if (!validLayoutsByType[section.sectionType].has(section.layout)) {
      throw new Error(`O layout ${section.layout} nao e valido para esta secao.`);
    }

    if (section.contentSource === "manual") {
      if (section.sectionType !== "content_carousel") {
        throw new Error("Selecao manual so pode ser usada em carrosseis de conteudo.");
      }
    } else if (section.contentSource !== "selected_content_structure") {
      if (automaticSources.has(section.contentSource)) {
        throw new Error("Cada fonte automatica pode aparecer apenas uma vez.");
      }

      automaticSources.add(section.contentSource);
    }

    ids.add(id);
  }

  return normalizeHomeSectionOrder(sections.map((section) => ({
    ...section,
    id: section.id.trim(),
    itemIds: Array.from(new Set(section.itemIds)),
    subtitle: section.subtitle?.trim() || undefined,
    title: section.title.trim()
  })));
}

export type PublishHomeSectionsOptions = {
  /**
   * Versao (updated_at) da chave homeSections que a tela leu; null = nunca publicada. Com ela a
   * gravacao e condicional no proprio UPDATE (writePlatformSettingGuarded): se a tela Modulos, a outra
   * Vitrine ou outra pessoa gravou depois da leitura (inclusive enquanto o banco inteiro e lido aqui
   * em cima), responde 409 sem gravar. Sem ela (chamada antiga), grava sem conferir.
   */
  expectedUpdatedAt?: string | null;
};

export async function publishHomeSections(configs: HomeSectionConfig[], options: PublishHomeSectionsOptions = {}) {
  const database = await readAdminDatabase();
  const normalized = validateHomeSectionConfigs(configs, database);
  const supabase = getSupabaseAdminClient();
  const now = new Date();
  const stamp = now.toISOString();
  let sectionsUpdatedAt = stamp;

  if (options.expectedUpdatedAt !== undefined) {
    sectionsUpdatedAt = (await writePlatformSettingGuarded("homeSections", normalized, options.expectedUpdatedAt, now)).updatedAt;
  } else {
    await upsertRows(
      supabase,
      "platform_settings",
      stampPlatformSettingRows([{ key: "homeSections", value: normalized }], stamp),
      "key",
      "Erro publicando secoes da Home"
    );
  }

  database.homeSectionConfigs = normalized;
  database.homeSectionsConfigured = true;
  database.updatedAt = stamp;
  // A versao exata desta gravacao: a tela manda de volta no proximo Publicar.
  database.homeSectionsUpdatedAt = sectionsUpdatedAt;

  try {
    await upsertRows(
      supabase,
      "platform_settings",
      stampPlatformSettingRows([{ key: "updatedAt", value: database.updatedAt }], stamp),
      "key",
      "Erro publicando secoes da Home"
    );
  } catch (error) {
    // Carimbo geral do legado: as fileiras ja estao gravadas, que e o que o aluno ve.
    console.error("[vitrine] carimbo updatedAt", error);
  }

  return toHydratedAdminDashboardData(database);
}

async function persistAppearanceImage(value: string, ownerPath: string, context: string) {
  const persisted = (await persistImageAsset(value, ownerPath)).trim();
  const isHttpUrl = /^https?:\/\//i.test(persisted);
  const isLocalPath = persisted.startsWith("/") && !persisted.startsWith("//");

  if (
    !persisted ||
    persisted.length > 2048 ||
    /[\s"'()<>\\]/.test(persisted) ||
    (!isHttpUrl && !isLocalPath)
  ) {
    throw createAdminMutationError(`${context} precisa ser um upload valido ou uma URL http(s).`, 400);
  }

  return persisted;
}

/**
 * Aparencia do admin antigo sobre o destaque gravado AGORA: so liga/desliga e troca imagem e tipo de
 * midia. O resto (textos, botao, capa do video, chaves que o legado nao conhece) fica como esta.
 */
function applyAppearanceToHero(stored: unknown, input: { enabled: boolean; image: string | null }): HomeHeroConfig {
  const current = stored && typeof stored === "object" && !Array.isArray(stored) ? (stored as HomeHeroConfig) : defaultHero;

  if (!input.enabled) {
    return { ...current, enabled: false };
  }

  const image = input.image ?? current.image;

  if (!image) {
    throw createAdminMutationError("Envie uma imagem ou informe uma URL para a capa da home.", 400);
  }

  return {
    ...current,
    enabled: true,
    image,
    mediaType: input.image ? (/\.(mp4|webm|mov)(\?|#|$)/i.test(image) ? "video" : "image") : current.mediaType
  };
}

export async function updatePlatformAppearance(input: PlatformAppearanceInput) {
  if (input.hero === undefined && input.logo === undefined && input.style === undefined) {
    throw createAdminMutationError("Nenhuma alteracao de aparencia informada.", 400);
  }

  if (input.logo !== undefined && input.logo.image !== null && !input.logo.image.trim()) {
    throw createAdminMutationError("Envie uma imagem ou informe uma URL para a logo.", 400);
  }

  const database = await readAdminDatabase();
  const settingsKeys: string[] = [];

  if (input.hero !== undefined) {
    const enabled = input.hero.enabled;
    const providedImage = enabled ? input.hero.image?.trim() : undefined;
    // O envio da imagem leva segundos. So depois dele o destaque e relido e gravado com a versao lida
    // (updatePlatformSettingLatest): o que a tela Destaque publicar nesse meio-tempo nao se perde.
    const uploadedImage = providedImage
      ? await persistAppearanceImage(providedImage, "platform/home-hero", "A capa da home")
      : null;
    const saved = await updatePlatformSettingLatest("hero", (current) =>
      applyAppearanceToHero(current.exists ? current.value : null, { enabled, image: uploadedImage })
    );

    database.hero = saved.value;
  }

  if (input.logo !== undefined) {
    // Trocar a logo nunca apaga o estilo (cantos, botoes, menu) gravado na mesma chave.
    const style = normalizeMemberStyle(database.branding);

    if (input.logo.image === null) {
      database.branding = { logoImage: null, style };
    } else {
      const providedLogo = input.logo.image.trim();

      if (!providedLogo) {
        throw createAdminMutationError("Envie uma imagem ou informe uma URL para a logo.", 400);
      }

      database.branding = {
        logoImage: await persistAppearanceImage(providedLogo, "platform/logo", "A logo da plataforma"),
        style
      };
    }

    settingsKeys.push("branding");
  }

  if (input.style !== undefined) {
    database.branding = { ...database.branding, style: normalizeMemberStyle({ style: input.style }) };

    if (!settingsKeys.includes("branding")) {
      settingsKeys.push("branding");
    }
  }

  database.updatedAt = new Date().toISOString();
  settingsKeys.push("updatedAt");

  const wantedKeys = new Set(settingsKeys);
  await upsertRows(
    getSupabaseAdminClient(),
    "platform_settings",
    stampPlatformSettingRows(settingsRows(database).filter((row) => wantedKeys.has(row.key)), database.updatedAt),
    "key",
    "Erro salvando aparencia da plataforma"
  );

  return toHydratedAdminDashboardData(database);
}

async function getSupabaseUserIdsByEmail(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  emails: string[]
) {
  const wantedEmails = new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean));
  const userIdsByEmail = new Map<string, string>();

  if (wantedEmails.size === 0) {
    return userIdsByEmail;
  }

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000
    });

    if (error) {
      throw new Error(`Nao foi possivel consultar usuarios do Supabase Auth: ${error.message}`);
    }

    for (const userRecord of data.users) {
      const email = userRecord.email?.trim().toLowerCase();

      if (email && wantedEmails.has(email)) {
        userIdsByEmail.set(email, userRecord.id);
      }
    }

    if (userIdsByEmail.size === wantedEmails.size || data.users.length < 1000) {
      break;
    }
  }

  return userIdsByEmail;
}

function getAdminStudentEntitlementSourceEventId(studentRecord: AdminStudent, course: AdminStudentCourse) {
  return `admin-student:${studentRecord.id}:${course.id ?? course.targetId}`;
}

function getAdminStudentEntitlementGrants(
  students: AdminStudent[],
  userIdsByEmail: Map<string, string>
) {
  return students.flatMap((studentRecord) => {
    const userId = userIdsByEmail.get(studentRecord.email.trim().toLowerCase());

    if (!userId) {
      return [];
    }

    return studentRecord.courses.flatMap((course) => {
      if (!course.targetId || !course.targetType) {
        return [];
      }

      return [{
        key: `${userId}:${getAdminStudentEntitlementSourceEventId(studentRecord, course)}`,
        sourceEventId: getAdminStudentEntitlementSourceEventId(studentRecord, course),
        userId
      }];
    });
  });
}

async function revokeStaleSupabaseEntitlementsForStudents(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  userIdsByEmail: Map<string, string>,
  previousStudents: AdminStudent[],
  nextStudents: AdminStudent[]
) {
  const previousGrants = getAdminStudentEntitlementGrants(previousStudents, userIdsByEmail);

  if (previousGrants.length === 0) {
    return;
  }

  const nextGrantKeys = new Set(getAdminStudentEntitlementGrants(nextStudents, userIdsByEmail).map((grant) => grant.key));
  const staleGrants = previousGrants.filter((grant) => (
    !nextGrantKeys.has(grant.key)
  ));

  if (staleGrants.length === 0) {
    return;
  }

  const staleSourceEventIdsByUserId = new Map<string, string[]>();

  for (const grant of staleGrants) {
    staleSourceEventIdsByUserId.set(grant.userId, [
      ...(staleSourceEventIdsByUserId.get(grant.userId) ?? []),
      grant.sourceEventId
    ]);
  }

  for (const [userId, sourceEventIds] of staleSourceEventIdsByUserId.entries()) {
    const { error } = await supabase
      .from("entitlements")
      .update({
        ends_at: new Date().toISOString(),
        status: "revoked"
      })
      .eq("user_id", userId)
      .in("source_event_id", sourceEventIds);

    await throwIfSupabaseError(error, "Erro revogando acessos removidos do aluno");
  }
}

async function upsertSupabaseEntitlementForStudentCourse(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  userId: string,
  studentRecord: AdminStudent,
  course: AdminStudentCourse
) {
  if (!course.targetId || !course.targetType) {
    return;
  }

  const entitlementRow = {
    ends_at: accessDateValueToIso(course.endsAt),
    product_id: course.targetId,
    source_event_id: getAdminStudentEntitlementSourceEventId(studentRecord, course),
    source_provider: normalizeEntitlementSourceProvider(course.sourceProvider ?? studentRecord.sourceProvider),
    starts_at: accessDateValueToIso(course.startsAt) ?? new Date().toISOString(),
    status: course.status,
    target_id: course.targetId,
    target_type: course.targetType,
    user_id: userId
  };
  const upsertResult = await supabase
    .from("entitlements")
    .upsert(entitlementRow, { onConflict: "user_id,source_event_id" });

  // 42P10: o indice unico (migration 202610010002) ainda nao foi aplicado no banco; usa o caminho legado.
  if (upsertResult.error?.code === "42P10") {
    const existingResult = await supabase
      .from("entitlements")
      .select("id")
      .eq("user_id", userId)
      .eq("source_event_id", entitlementRow.source_event_id)
      .limit(1)
      .maybeSingle();

    await throwIfSupabaseError(existingResult.error, "Erro consultando acesso existente");

    const writeResult = existingResult.data?.id
      ? await supabase.from("entitlements").update(entitlementRow).eq("id", existingResult.data.id)
      : await supabase.from("entitlements").insert(entitlementRow);

    await throwIfSupabaseError(writeResult.error, "Erro sincronizando acesso do aluno");
    return;
  }

  await throwIfSupabaseError(upsertResult.error, "Erro sincronizando acesso do aluno");
}

async function syncSupabaseEntitlementsForStudents(students: AdminStudent[], previousStudents: AdminStudent[]) {
  const supabase = getSupabaseAdminClient();
  const userIdsByEmail = await getSupabaseUserIdsByEmail(
    supabase,
    [...students, ...previousStudents].map((studentRecord) => studentRecord.email)
  );

  await revokeStaleSupabaseEntitlementsForStudents(supabase, userIdsByEmail, previousStudents, students);

  for (const studentRecord of students) {
    const userId = userIdsByEmail.get(studentRecord.email.trim().toLowerCase());

    if (!userId) {
      continue;
    }

    for (const course of studentRecord.courses) {
      await upsertSupabaseEntitlementForStudentCourse(supabase, userId, studentRecord, course);
    }
  }
}

export async function replaceAdminStudents(students: AdminStudent[]) {
  const database = await readAdminDatabase();
  const previousStudents = database.students;
  const incomingIds = new Set(students.map((studentRecord) => studentRecord.id));
  const removedCount = previousStudents.filter((studentRecord) => !incomingIds.has(studentRecord.id)).length;

  // Trava contra payload truncado/malformado: remocoes em massa exigem exclusao explicita por aluno.
  if (removedCount > 10 && removedCount > previousStudents.length / 2) {
    throw createAdminMutationError(
      `O salvamento removeria ${removedCount} de ${previousStudents.length} alunos. Exclusoes em massa devem ser feitas aluno a aluno.`,
      409
    );
  }

  database.students = students;
  const supabase = getSupabaseAdminClient();
  const studentRows = students.map(studentToRow);
  const studentCourseRows = students.flatMap((studentRecord) =>
    studentRecord.courses.map((course) => studentCourseToRow(course, studentRecord.id))
  );
  const accessLogRows = students.flatMap((studentRecord) =>
    (studentRecord.accessHistory ?? []).map((log) => studentAccessLogToRow(log, studentRecord.id))
  );

  await upsertRows(supabase, "students", studentRows, "id", "Erro sincronizando students");
  await upsertRows(supabase, "student_courses", studentCourseRows, "id", "Erro sincronizando student_courses");
  await upsertRows(supabase, "student_access_logs", accessLogRows, "id", "Erro sincronizando student_access_logs");
  await deleteMissingRows(supabase, "student_access_logs", "id", accessLogRows.map((row) => row.id), "Erro removendo historicos antigos");
  await deleteMissingRows(supabase, "student_courses", "id", studentCourseRows.map((row) => row.id), "Erro removendo acessos antigos");
  await deleteMissingRows(supabase, "students", "id", studentRows.map((row) => row.id), "Erro removendo alunos antigos");
  await syncSupabaseEntitlementsForStudents(students, previousStudents);
  return toHydratedAdminDashboardData(database);
}

export async function upsertContentItem(input: ContentWriteInput) {
  const database = await readAdminDatabase();
  const existingItem = input.id ? getAllContentItems(database).find((item) => item.id === input.id) : undefined;
  const normalizedItem = normalizeContentInput(input);
  const [persistedCoverImage, persistedHeroImage] = await Promise.all([
    persistImageAsset(normalizedItem.image, `content/${normalizedItem.id}/cover`),
    input.heroImage !== undefined
      ? persistImageAsset(input.heroImage, `content/${normalizedItem.id}/hero`)
      : Promise.resolve(undefined)
  ]);
  const item = {
    ...existingItem,
    ...normalizedItem,
    id: existingItem?.id ?? input.id ?? normalizedItem.id,
    image: persistedCoverImage,
    progress: existingItem?.progress ?? 0
  };
  removeContentById(database, item.id);
  getContentBucket(database, item).unshift(item);

  if (input.heroImage !== undefined) {
    const currentSettings = database.contentPageSettings[item.id] ?? {};
    const heroImage = persistedHeroImage?.trim() ?? "";

    if (heroImage) {
      database.contentPageSettings[item.id] = {
        ...currentSettings,
        hero: {
          ...currentSettings.hero,
          mediaSrc: heroImage,
          mediaType: "image",
          visibility: {
            badge: false,
            cta: false,
            description: false,
            title: false,
            ...currentSettings.hero?.visibility
          }
        }
      };
    } else {
      const remainingSettings = { ...currentSettings };
      delete remainingSettings.hero;

      if (Object.keys(remainingSettings).length > 0) {
        database.contentPageSettings[item.id] = remainingSettings;
      } else {
        delete database.contentPageSettings[item.id];
      }
    }
  }

  if (input.coursePresentationMode !== undefined) {
    const currentSettings = database.contentPageSettings[item.id] ?? {};

    if (supportsCoursePresentationMode(item.kind)) {
      database.contentPageSettings[item.id] = {
        ...currentSettings,
        coursePresentationMode: input.coursePresentationMode
      };
    } else {
      const remainingSettings = { ...currentSettings };
      delete remainingSettings.coursePresentationMode;

      if (Object.keys(remainingSettings).length > 0) {
        database.contentPageSettings[item.id] = remainingSettings;
      } else {
        delete database.contentPageSettings[item.id];
      }
    }
  }

  if (input.lockedActionMode !== undefined) {
    const currentSettings = database.contentPageSettings[item.id] ?? {};

    if (supportsCoursePresentationMode(item.kind)) {
      database.contentPageSettings[item.id] = {
        ...currentSettings,
        lockedActionMode: input.lockedActionMode
      };
    } else {
      const remainingSettings = { ...currentSettings };
      delete remainingSettings.lockedActionMode;

      if (Object.keys(remainingSettings).length > 0) {
        database.contentPageSettings[item.id] = remainingSettings;
      } else {
        delete database.contentPageSettings[item.id];
      }
    }
  }

  if (input.homeModuleSectionEnabled !== undefined) {
    const currentSettings = database.contentPageSettings[item.id] ?? {};

    if (supportsCoursePresentationMode(item.kind) && input.homeModuleSectionEnabled) {
      database.contentPageSettings[item.id] = {
        ...currentSettings,
        homeModuleSection: {
          enabled: true
        }
      };
    } else {
      const remainingSettings = { ...currentSettings };
      delete remainingSettings.homeModuleSection;

      if (Object.keys(remainingSettings).length > 0) {
        database.contentPageSettings[item.id] = remainingSettings;
      } else {
        delete database.contentPageSettings[item.id];
      }
    }
  }

  if (input.parentFormationId !== undefined) {
    const currentSettings = database.contentPageSettings[item.id] ?? {};
    const parentFormationId = input.parentFormationId.trim();

    if (item.commerceScope === "included_content" && parentFormationId) {
      const parentFormation = database.formations.find((formation) => formation.id === parentFormationId);

      if (!parentFormation || parentFormation.kind !== "Formacao" || parentFormation.id === item.id) {
        throw new Error("Selecione uma formacao principal valida para este curso interno.");
      }
      database.contentPageSettings[item.id] = {
        ...currentSettings,
        parentFormationId
      };
      item.parentContentId = parentFormationId;
    } else {
      const remainingSettings = { ...currentSettings };
      delete remainingSettings.parentFormationId;

      if (Object.keys(remainingSettings).length > 0) {
        database.contentPageSettings[item.id] = remainingSettings;
      } else {
        delete database.contentPageSettings[item.id];
      }
      delete item.parentContentId;
    }
  }

  const supabase = getSupabaseAdminClient();
  const contentRows = contentBucketEntries(database).flatMap(([bucket, items]) =>
    items.map((content, index) => contentItemToRow(content, bucket, index))
  );
  await upsertRows(supabase, "content_items", contentRows, "id", "Erro salvando content_items");

  const itemSettings = database.contentPageSettings[item.id];

  if (itemSettings) {
    await upsertRows(supabase, "content_page_settings", [{
      content_id: item.id,
      settings: itemSettings
    }], "content_id", "Erro salvando content_page_settings");
  } else {
    const deleteSettingsResult = await supabase.from("content_page_settings").delete().eq("content_id", item.id);
    await throwIfSupabaseError(deleteSettingsResult.error, "Erro removendo content_page_settings");
  }

  return toHydratedAdminDashboardData(database);
}

/**
 * Tira o produto excluido da vitrine (platform_settings.homeSections): sai das escolhas manuais, a
 * fileira de modulos dele sai inteira e a escolha manual que fica vazia sai tambem (pruneHomeSectionRefs,
 * a mesma regra da home do aluno). Rele a chave na hora e grava com a versao lida
 * (writePlatformSettingGuarded); se outra tela gravou no meio, rele e tenta mais uma vez. Vitrine
 * nunca publicada: nada a gravar (a ordem padrao ja nao mostra o produto). Devolve o que foi gravado
 * ou null quando nao havia nada a tirar.
 */
async function removeProductFromHomeSections(productId: string) {
  for (let attempt = 0; ; attempt += 1) {
    const current = await readPlatformSetting("homeSections");

    if (!current.exists) {
      return null;
    }

    const pruned = pruneHomeSectionRefs(normalizeHomeSectionConfigs(current.value), (itemId) => itemId !== productId);

    if (pruned.removed.length === 0) {
      return null;
    }

    try {
      const saved = await writePlatformSettingGuarded("homeSections", pruned.sections, current.updatedAt);

      return { sections: pruned.sections, updatedAt: saved.updatedAt };
    } catch (error) {
      if (!(error instanceof MemberAreaConflictError) || attempt >= 1) {
        throw error;
      }
    }
  }
}

export async function deleteContentItem(itemId: string) {
  const database = await readAdminDatabase();
  const combosBeforeDelete = database.combos;
  const ownedModules = database.courseModules.filter((module) => module.ownerId === itemId);
  const ownedTargetIds = new Set([
    itemId,
    ...ownedModules.map((module) => module.id),
    ...ownedModules.flatMap((module) => module.lessons.map((lesson) => lesson.id))
  ]);
  removeContentById(database, itemId);
  delete database.contentPageSettings[itemId];
  database.courseModules = database.courseModules.filter((module) => module.ownerId !== itemId);
  database.combos = database.combos.flatMap((combo) => {
    const productIds = combo.productIds.filter((productId) => productId !== itemId);

    return productIds.length > 0
      ? [{ ...combo, productIds, updatedAt: new Date().toISOString() }]
      : [];
  });
  database.savedItems = database.savedItems.filter((savedItem) => !ownedTargetIds.has(savedItem.targetId));
  database.students = database.students.map((studentRecord) => ({
    ...studentRecord,
    courses: studentRecord.courses.filter((course) => course.targetId !== itemId)
  }));
  const removedComboIds = combosBeforeDelete
    .filter((combo) => combo.productIds.includes(itemId) && combo.productIds.length === 1)
    .map((combo) => combo.id);
  const supabase = getSupabaseAdminClient();
  const deleteContentResult = await supabase.from("content_items").delete().eq("id", itemId);
  await throwIfSupabaseError(deleteContentResult.error, "Erro removendo conteudo");

  // Junto com a exclusao, o produto sai das fileiras da vitrine. Falhar aqui nao desfaz a exclusao: a
  // home do aluno ja ignora o produto e a Vitrine/publishHomeSections limpam de novo ao publicar.
  try {
    const homeSections = await removeProductFromHomeSections(itemId);

    if (homeSections) {
      database.homeSectionConfigs = homeSections.sections;
      database.homeSectionsUpdatedAt = homeSections.updatedAt;
    }
  } catch (error) {
    console.error("[vitrine] limpeza das fileiras ao excluir produto", error);
  }

  if (ownedTargetIds.size > 0) {
    const deleteSavedResult = await supabase.from("saved_items").delete().in("target_id", Array.from(ownedTargetIds));
    await throwIfSupabaseError(deleteSavedResult.error, "Erro removendo favoritos do conteudo");
  }

  const deleteStudentCoursesResult = await supabase.from("student_courses").delete().eq("target_id", itemId);
  await throwIfSupabaseError(deleteStudentCoursesResult.error, "Erro removendo acessos do conteudo");

  // Entitlements apontando para o conteudo removido sao revogados (nao apagados) para manter trilha de auditoria
  // e impedir que um re-import com id deterministico (ex.: yt-course-<playlistId>) reanexe acessos antigos.
  const revokeEntitlementsResult = await supabase
    .from("entitlements")
    .update({ status: "revoked" })
    .eq("target_id", itemId)
    .eq("status", "active");
  await throwIfSupabaseError(revokeEntitlementsResult.error, "Erro revogando acessos do conteúdo removido");

  if (removedComboIds.length > 0) {
    const deleteCombosResult = await supabase.from("product_combos").delete().in("id", removedComboIds);
    await throwIfSupabaseError(deleteCombosResult.error, "Erro removendo combos vazios");
  }

  return toHydratedAdminDashboardData(database);
}

export async function reorderContentItems(input: ContentOrderInput) {
  const database = await readAdminDatabase();
  const orderedIds = normalizeOrderedIds(input.orderedIds);
  const hasKnownContentId = contentBucketEntries(database).some(([, items]) =>
    items.some((item) => orderedIds.includes(item.id))
  );

  if (!hasKnownContentId) {
    throw createAdminMutationError("Nenhum conteudo valido foi encontrado para ordenar.", 400);
  }

  database.formations = reorderContentBucket(database.formations, orderedIds);
  database.bootcamps = reorderContentBucket(database.bootcamps, orderedIds);
  database.courses = reorderContentBucket(database.courses, orderedIds);
  database.formationInternalCourses = reorderContentBucket(database.formationInternalCourses, orderedIds);
  database.recentLessons = reorderContentBucket(database.recentLessons, orderedIds);
  database.upcomingProducts = reorderContentBucket(database.upcomingProducts, orderedIds);
  database.continueWatching = reorderContentBucket(database.continueWatching, orderedIds);

  const contentRows = contentBucketEntries(database).flatMap(([bucket, items]) =>
    items.map((content, index) => contentItemToRow(content, bucket, index))
  );
  await upsertRows(
    getSupabaseAdminClient(),
    "content_items",
    contentRows,
    "id",
    "Erro ordenando conteudos"
  );

  return toHydratedAdminDashboardData(database);
}

export async function upsertProductCombo(input: ProductComboWriteInput) {
  const database = await readAdminDatabase();
  const combo = normalizeProductComboInput(database, input);

  database.combos = [
    combo,
    ...database.combos.filter((currentCombo) => currentCombo.id !== combo.id)
  ];

  const supabase = getSupabaseAdminClient();
  await upsertRows(supabase, "product_combos", [comboToRow(combo)], "id", "Erro salvando combo");
  await deleteComboItemsForCombos(supabase, [combo.id]);
  await upsertRows(
    supabase,
    "product_combo_items",
    comboItemRows(combo),
    "combo_id,product_id",
    "Erro salvando itens do combo"
  );
  return toHydratedAdminDashboardData(database);
}

export async function deleteProductCombo(comboId: string) {
  const database = await readAdminDatabase();

  database.combos = database.combos.filter((combo) => combo.id !== comboId);

  const deleteResult = await getSupabaseAdminClient().from("product_combos").delete().eq("id", comboId);
  await throwIfSupabaseError(deleteResult.error, "Erro removendo combo");
  return toHydratedAdminDashboardData(database);
}

function createAdminMutationError(message: string, status: number) {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function normalizeOrderedIds(orderedIds: string[]) {
  return Array.from(new Set(
    orderedIds
      .map((id) => id.trim())
      .filter(Boolean)
  ));
}

function reorderItemsByIds<T extends { id: string }>(
  items: T[],
  orderedIds: string[],
  entityLabel: string
) {
  const normalizedIds = normalizeOrderedIds(orderedIds);

  if (normalizedIds.length === 0) {
    throw createAdminMutationError(`Informe a ordem de ${entityLabel}.`, 400);
  }

  const itemById = new Map(items.map((item) => [item.id, item]));
  const orderedItems = normalizedIds.flatMap((id) => {
    const item = itemById.get(id);
    return item ? [item] : [];
  });

  if (orderedItems.length === 0) {
    throw createAdminMutationError(`Nenhum ${entityLabel} valido foi encontrado para ordenar.`, 400);
  }

  const movedIds = new Set(orderedItems.map((item) => item.id));

  return [
    ...orderedItems,
    ...items.filter((item) => !movedIds.has(item.id))
  ];
}

function reorderContentBucket(items: ContentItem[], orderedIds: string[]) {
  const ids = new Set(orderedIds);

  if (!items.some((item) => ids.has(item.id))) {
    return items;
  }

  return reorderItemsByIds(items, orderedIds, "conteudos");
}

function reorderItemsInsideGroup<T extends { id: string }>(
  items: T[],
  predicate: (item: T) => boolean,
  orderedIds: string[],
  entityLabel: string
) {
  const groupItems = items.filter(predicate);

  if (groupItems.length === 0) {
    throw createAdminMutationError(`Nenhum ${entityLabel} encontrado para ordenar.`, 404);
  }

  const reorderedGroup = reorderItemsByIds(groupItems, orderedIds, entityLabel);
  const queue = [...reorderedGroup];

  return items.map((item) => predicate(item) ? queue.shift() ?? item : item);
}

function removeDeletedLearningReferences(
  database: PlatformDatabase,
  lessonIds: Set<string>,
  moduleIds: Set<string>
) {
  const removedSavedItemIds = database.savedItems
    .filter((savedItem) => (
      (savedItem.targetType === "lesson" && lessonIds.has(savedItem.targetId)) ||
      (savedItem.targetType === "module" && moduleIds.has(savedItem.targetId))
    ))
    .map((savedItem) => savedItem.id);
  const updatedProgressRecords: LessonProgressRecord[] = [];
  const removedSavedItemIdSet = new Set(removedSavedItemIds);
  database.savedItems = database.savedItems.filter((savedItem) => !removedSavedItemIdSet.has(savedItem.id));
  database.lessonProgress = database.lessonProgress.map((progress) => {
    const completedLessonIds = progress.completedLessonIds.filter((lessonId) => !lessonIds.has(lessonId));
    const lessonReactions = { ...progress.lessonReactions };
    const lessonWatchStates = { ...progress.lessonWatchStates };
    let changed = completedLessonIds.length !== progress.completedLessonIds.length;

    for (const lessonId of lessonIds) {
      if (lessonId in lessonReactions) {
        delete lessonReactions[lessonId];
        changed = true;
      }

      if (lessonId in lessonWatchStates) {
        delete lessonWatchStates[lessonId];
        changed = true;
      }
    }

    if (!changed) {
      return progress;
    }

    const nextProgress = {
      ...progress,
      completedLessonIds,
      lessonReactions,
      lessonWatchStates,
      updatedAt: new Date().toISOString()
    };
    updatedProgressRecords.push(nextProgress);
    return nextProgress;
  });

  return { removedSavedItemIds, updatedProgressRecords };
}

async function persistDeletedLearningReferences(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  cleanup: ReturnType<typeof removeDeletedLearningReferences>
) {
  if (cleanup.removedSavedItemIds.length > 0) {
    const deleteSavedItemsResult = await supabase
      .from("saved_items")
      .delete()
      .in("id", cleanup.removedSavedItemIds);
    await throwIfSupabaseError(deleteSavedItemsResult.error, "Erro removendo favoritos da estrutura excluida");
  }

  await upsertRows(
    supabase,
    "lesson_progress",
    cleanup.updatedProgressRecords.map((progress) => ({
      completed_lesson_ids: progress.completedLessonIds,
      content_id: progress.contentId,
      lesson_reactions: progress.lessonReactions,
      lesson_watch_states: progress.lessonWatchStates,
      updated_at: progress.updatedAt,
      user_id: progress.userId
    })),
    "user_id,content_id",
    "Erro removendo referencias de progresso da estrutura excluida"
  );
}

export async function deleteCourseModule(moduleId: string) {
  const database = await readAdminDatabase();
  const courseModule = database.courseModules.find((module) => module.id === moduleId);

  if (!courseModule) {
    throw createAdminMutationError("Modulo nao encontrado.", 404);
  }

  const lessonIds = new Set(courseModule.lessons.map((lesson) => lesson.id));
  const supabase = getSupabaseAdminClient();
  const deleteResult = await supabase.from("course_modules").delete().eq("id", moduleId);
  await throwIfSupabaseError(deleteResult.error, "Erro removendo modulo");

  database.courseModules = database.courseModules.filter((module) => module.id !== moduleId);
  const cleanup = removeDeletedLearningReferences(database, lessonIds, new Set([moduleId]));
  await persistDeletedLearningReferences(supabase, cleanup);
  return toHydratedAdminDashboardData(database);
}

export async function reorderCourseModules(input: ModuleOrderInput) {
  const database = await readAdminDatabase();
  const ownerId = input.ownerId?.trim();
  const hasScopedModules = ownerId
    ? database.courseModules.some((module) => module.ownerId === ownerId)
    : false;
  const matchesTargetOwner = (module: CourseModule) =>
    hasScopedModules ? module.ownerId === ownerId : !module.ownerId;

  database.courseModules = reorderItemsInsideGroup(
    database.courseModules,
    matchesTargetOwner,
    input.orderedIds,
    "modulos"
  );

  const moduleRows = database.courseModules.map(moduleToRow);
  await upsertRows(
    getSupabaseAdminClient(),
    "course_modules",
    moduleRows,
    "id",
    "Erro ordenando modulos"
  );

  return toHydratedAdminDashboardData(database);
}

export async function upsertCourseModule(input: ModuleWriteInput) {
  const database = await readAdminDatabase();
  const moduleId = input.id || makeId("module", input.title);
  const existingModule = database.courseModules.find((module) => module.id === moduleId);
  const ownerId = input.ownerId ?? existingModule?.ownerId;
  const ownerKind = input.ownerKind ?? existingModule?.ownerKind;
  const ownerModulesCount = database.courseModules.filter((module) =>
    ownerId ? module.ownerId === ownerId : !module.ownerId
  ).length;
  const moduleImage = await persistImageAsset(
    input.image || existingModule?.image || "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=900&q=80",
    `modules/${moduleId}/cover`
  );
  const nextModule: CourseModule = {
    description: input.description || "Modulo cadastrado no CMS persistido.",
    eyebrow: existingModule?.eyebrow ?? `Modulo ${String(ownerModulesCount + 1).padStart(2, "0")}`,
    id: moduleId,
    image: moduleImage,
    lessons: existingModule?.lessons ?? [],
    meta: "0 aulas",
    ownerId,
    ownerKind,
    progress: existingModule?.progress ?? 0,
    releaseRule: input.releaseRule ?? existingModule?.releaseRule,
    title: input.title
  };

  database.courseModules = (
    existingModule
      ? database.courseModules.map((module) => (module.id === moduleId ? nextModule : module))
      : [...database.courseModules, nextModule]
  ).map((module) => ({
    ...module,
    meta: `${module.lessons.length} aula${module.lessons.length === 1 ? "" : "s"}`
  }));

  const moduleRows = database.courseModules.map(moduleToRow);
  await upsertRows(
    getSupabaseAdminClient(),
    "course_modules",
    moduleRows,
    "id",
    "Erro salvando modulo"
  );
  return toHydratedAdminDashboardData(database);
}

export async function upsertLesson(input: LessonWriteInput) {
  const database = await readAdminDatabase();
  const moduleIndex = database.courseModules.findIndex((module) => module.id === input.moduleId);

  if (moduleIndex < 0) {
    throw new Error("Modulo nao encontrado.");
  }

  const courseModule = database.courseModules[moduleIndex];
  const lessonId = input.id || makeId(`${courseModule.id}-lesson`, input.title);
  const existingLesson = database.courseModules
    .flatMap((module) => module.lessons)
    .find((lesson) => lesson.id === lessonId);
  const hasVideoInput = Object.prototype.hasOwnProperty.call(input, "video");
  const lessonImage = await persistImageAsset(
    input.image || existingLesson?.image,
    `lessons/${lessonId}/thumbnail`
  );
  const nextLesson = {
    completed: existingLesson?.completed ?? false,
    description: input.description || existingLesson?.description || "Aula cadastrada no CMS persistido.",
    duration: input.duration || existingLesson?.duration || "15 min",
    id: lessonId,
    image: lessonImage || undefined,
    releaseRule: input.releaseRule ?? existingLesson?.releaseRule,
    title: input.title,
    video: hasVideoInput ? input.video ?? undefined : existingLesson?.video
  };

  database.courseModules = database.courseModules.map((module, index) => {
    const currentLessonIndex = module.lessons.findIndex((lesson) => lesson.id === lessonId);
    const moduleLessons = module.lessons.filter((lesson) => lesson.id !== lessonId);
    const insertAt = currentLessonIndex >= 0 ? currentLessonIndex : moduleLessons.length;
    const lessons = index === moduleIndex
      ? [
          ...moduleLessons.slice(0, insertAt),
          nextLesson,
          ...moduleLessons.slice(insertAt)
        ]
      : moduleLessons;

    return {
      ...module,
      lessons,
      meta: `${lessons.length} aula${lessons.length === 1 ? "" : "s"}`
    };
  });

  const supabase = getSupabaseAdminClient();
  const moduleRows = database.courseModules.map(moduleToRow);
  const lessonRows = database.courseModules.flatMap((module) =>
    module.lessons.map((lesson, index) => lessonToRow(lesson, module.id, index))
  );
  await upsertRows(supabase, "course_modules", moduleRows, "id", "Erro atualizando modulo da aula");
  await upsertRows(supabase, "lessons", lessonRows, "id", "Erro salvando aula");
  return {
    data: toHydratedAdminDashboardData(database),
    lessonId
  };
}

export async function reorderLessons(input: LessonOrderInput) {
  const database = await readAdminDatabase();
  const moduleIndex = database.courseModules.findIndex((module) => module.id === input.moduleId);

  if (moduleIndex < 0) {
    throw createAdminMutationError("Modulo nao encontrado.", 404);
  }

  database.courseModules = database.courseModules.map((module, index) => {
    if (index !== moduleIndex) {
      return module;
    }

    const lessons = reorderItemsByIds(module.lessons, input.orderedIds, "aulas");

    return {
      ...module,
      lessons
    };
  });

  const lessonRows = database.courseModules.flatMap((module) =>
    module.lessons.map((lesson, index) => lessonToRow(lesson, module.id, index))
  );
  await upsertRows(
    getSupabaseAdminClient(),
    "lessons",
    lessonRows,
    "id",
    "Erro ordenando aulas"
  );

  return toHydratedAdminDashboardData(database);
}

export async function deleteLesson(lessonId: string) {
  const database = await readAdminDatabase();
  const ownerModule = database.courseModules.find((module) =>
    module.lessons.some((lesson) => lesson.id === lessonId)
  );

  if (!ownerModule) {
    throw createAdminMutationError("Aula nao encontrada.", 404);
  }

  const supabase = getSupabaseAdminClient();
  const deleteResult = await supabase.from("lessons").delete().eq("id", lessonId);
  await throwIfSupabaseError(deleteResult.error, "Erro removendo aula");
  const remainingLessonsCount = ownerModule.lessons.filter((lesson) => lesson.id !== lessonId).length;
  const moduleMeta = `${remainingLessonsCount} aula${remainingLessonsCount === 1 ? "" : "s"}`;
  const updateModuleResult = await supabase
    .from("course_modules")
    .update({ meta: moduleMeta })
    .eq("id", ownerModule.id);
  await throwIfSupabaseError(updateModuleResult.error, "Erro atualizando a quantidade de aulas do modulo");

  database.courseModules = database.courseModules.map((module) => {
    if (module.id !== ownerModule.id) {
      return module;
    }

    const lessons = module.lessons.filter((lesson) => lesson.id !== lessonId);

    return {
      ...module,
      lessons,
      meta: moduleMeta
    };
  });
  const cleanup = removeDeletedLearningReferences(database, new Set([lessonId]), new Set());
  await persistDeletedLearningReferences(supabase, cleanup);
  return toHydratedAdminDashboardData(database);
}

export async function addCohort(name: string) {
  const database = await readAdminDatabase();
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Nome da turma e obrigatorio.");
  }

  if (!database.cohorts.includes(trimmedName)) {
    database.cohorts = [trimmedName, ...database.cohorts];
  }

  await upsertRows(
    getSupabaseAdminClient(),
    "cohorts",
    [{ name: trimmedName }],
    "name",
    "Erro salvando turma"
  );
  return toHydratedAdminDashboardData(database);
}

export type AdminDashboardCollectionsInput = Partial<Pick<
  PlatformDatabase,
  "aiAgents" | "blockedWordRules" | "integrations" | "moderationItems"
>>;

export async function updateAdminDashboardCollections(input: AdminDashboardCollectionsInput) {
  const database = await readAdminDatabase();

  if (Array.isArray(input.aiAgents)) {
    database.aiAgents = input.aiAgents;
  }

  if (Array.isArray(input.blockedWordRules)) {
    database.blockedWordRules = input.blockedWordRules;
  }

  if (Array.isArray(input.integrations)) {
    database.integrations = input.integrations;
  }

  if (Array.isArray(input.moderationItems)) {
    database.moderationItems = input.moderationItems;
  }

  const updatedKeys = new Set(Object.keys(input));
  const rows = stampPlatformSettingRows(settingsRows(database).filter((row) => updatedKeys.has(row.key)));
  await upsertRows(
    getSupabaseAdminClient(),
    "platform_settings",
    rows,
    "key",
    "Erro salvando configuracoes administrativas"
  );
  return toHydratedAdminDashboardData(database);
}

async function savedItemTargetExists(targetType: SavedItemTargetType, targetId: string) {
  const supabase = getSupabaseAdminClient();

  if (["formation", "standalone_course", "mentorship", "webinar", "product", "bootcamp"].includes(targetType)) {
    const result = await supabase
      .from("content_items")
      .select("id,kind")
      .eq("id", targetId)
      .maybeSingle();
    await throwIfSupabaseError(result.error, "Erro validando conteudo favorito");
    return Boolean(
      result.data &&
      getSavedTargetTypeForContentKind(result.data.kind as ContentKind) === targetType
    );
  }

  if (targetType === "module") {
    const result = await supabase.from("course_modules").select("id").eq("id", targetId).maybeSingle();
    await throwIfSupabaseError(result.error, "Erro validando modulo favorito");
    return Boolean(result.data);
  }

  if (targetType === "lesson") {
    const result = await supabase.from("lessons").select("id").eq("id", targetId).maybeSingle();
    await throwIfSupabaseError(result.error, "Erro validando aula favorita");
    return Boolean(result.data);
  }

  return false;
}

export async function setSavedItem({
  collectionLabel = savedItemCollectionLabel,
  saved,
  targetId,
  targetType,
  userId
}: {
  collectionLabel?: string;
  saved: boolean;
  targetId: string;
  targetType: SavedItemTargetType;
  userId: string;
}) {
  const supabase = getSupabaseAdminClient();
  const normalizedCollectionLabel = collectionLabel.trim() || savedItemCollectionLabel;

  if (!await savedItemTargetExists(targetType, targetId)) {
    throw new Error("Item para salvar nao encontrado.");
  }

  if (!saved) {
    const deleteResult = await supabase
      .from("saved_items")
      .delete()
      .eq("user_id", userId)
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .eq("collection_label", normalizedCollectionLabel);
    await throwIfSupabaseError(deleteResult.error, "Erro removendo favorito");

    return {
      collectionLabel: normalizedCollectionLabel,
      saved: false,
      targetId,
      targetType
    };
  }

  const nextRecord: SavedItemRecord = {
    collectionLabel: normalizedCollectionLabel,
    createdAt: new Date().toISOString(),
    id: `saved-${normalizedCollectionLabel}-${targetType}-${targetId}-${userId}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
    targetId,
    targetType,
    userId
  };
  const upsertResult = await supabase
    .from("saved_items")
    .upsert(savedItemToRow(nextRecord), {
      onConflict: "user_id,target_type,target_id,collection_label"
    });
  await throwIfSupabaseError(upsertResult.error, "Erro salvando favorito");

  return {
    collectionLabel: normalizedCollectionLabel,
    saved: true,
    targetId,
    targetType
  };
}

let lessonProgressWriteQueue = Promise.resolve();

const LESSON_PROGRESS_CONFLICT_CODE = "lesson-progress-conflict";

function createLessonProgressConflictError() {
  return Object.assign(new Error("Progresso atualizado por outra sessao."), {
    code: LESSON_PROGRESS_CONFLICT_CODE
  });
}

export async function replaceCompletedLessons(input: {
  completedLessonIds?: string[];
  contentId: string;
  durationSeconds?: number;
  lessonId?: string;
  lessonReactions?: Partial<Record<string, LessonReaction>>;
  maxProgressPercent?: number;
  progressPercent?: number;
  progressSeconds?: number;
  resumeFrameUrl?: string;
  status?: LessonWatchStatus;
  userId: string;
}) {
  // A fila local serializa escritas da mesma instancia; o compare-and-swap em replaceCompletedLessonsUnsafe
  // protege contra instancias serverless concorrentes, com releitura e novo merge em caso de conflito.
  const writeResult = lessonProgressWriteQueue.then(async () => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await replaceCompletedLessonsUnsafe(input);
      } catch (error) {
        if ((error as { code?: string }).code !== LESSON_PROGRESS_CONFLICT_CODE || attempt >= 3) {
          throw error;
        }
      }
    }
  });
  lessonProgressWriteQueue = writeResult.then(() => undefined, () => undefined);
  return writeResult;
}

async function replaceCompletedLessonsUnsafe({
  completedLessonIds,
  contentId,
  durationSeconds,
  lessonId,
  lessonReactions,
  maxProgressPercent,
  progressPercent,
  progressSeconds,
  resumeFrameUrl,
  status,
  userId
}: {
  completedLessonIds?: string[];
  contentId: string;
  durationSeconds?: number;
  lessonId?: string;
  lessonReactions?: Partial<Record<string, LessonReaction>>;
  maxProgressPercent?: number;
  progressPercent?: number;
  progressSeconds?: number;
  resumeFrameUrl?: string;
  status?: LessonWatchStatus;
  userId: string;
}) {
  const supabase = getSupabaseAdminClient();
  const currentResult = await supabase
    .from("lesson_progress")
    .select("completed_lesson_ids,content_id,lesson_reactions,lesson_watch_states,updated_at,user_id")
    .eq("user_id", userId)
    .eq("content_id", contentId)
    .maybeSingle();
  await throwIfSupabaseError(currentResult.error, "Erro lendo progresso da aula");
  const currentRow = currentResult.data as LessonProgressRow | null;
  const currentRecord: LessonProgressRecord | null = currentRow
    ? {
        completedLessonIds: currentRow.completed_lesson_ids,
        contentId: currentRow.content_id,
        lessonReactions: normalizeLessonReactions(currentRow.lesson_reactions),
        lessonWatchStates: normalizeLessonWatchStates(currentRow.lesson_watch_states),
        updatedAt: currentRow.updated_at,
        userId: currentRow.user_id
      }
    : null;
  const uniqueLessonIds = Array.from(new Set(completedLessonIds ?? currentRecord?.completedLessonIds ?? []));
  const nextLessonWatchStates = normalizeLessonWatchStates(currentRecord?.lessonWatchStates);

  if (lessonId) {
    const existingWatchState = nextLessonWatchStates[lessonId];
    const incomingProgressSeconds = Math.round(clampNumber(
      normalizeProgressNumber(progressSeconds, existingWatchState?.progressSeconds ?? 0),
      0,
      Number.MAX_SAFE_INTEGER
    ));
    const safeProgressSeconds = progressSeconds === undefined
      ? existingWatchState?.progressSeconds ?? 0
      : incomingProgressSeconds;
    const safeDurationSeconds = durationSeconds === undefined
      ? existingWatchState?.durationSeconds
      : Math.round(clampNumber(normalizeProgressNumber(durationSeconds, existingWatchState?.durationSeconds ?? 0), 0, Number.MAX_SAFE_INTEGER));
    const computedPercent = safeDurationSeconds && safeDurationSeconds > 0
      ? (safeProgressSeconds / safeDurationSeconds) * 100
      : existingWatchState?.progressPercent ?? 0;
    const safeProgressPercent = Math.round(clampNumber(
      normalizeProgressNumber(progressPercent, computedPercent),
      0,
      100
    ));
    const nextStatus = status === "completed" ? "completed" : "in_progress";
    const nextProgressPercent = nextStatus === "completed"
      ? 100
      : Math.min(safeProgressSeconds > 0 ? Math.max(safeProgressPercent, 1) : safeProgressPercent, 99);
    const incomingMaxProgressPercent = Math.round(clampNumber(
      normalizeProgressNumber(maxProgressPercent, nextProgressPercent),
      0,
      100
    ));
    const safeMaxProgressPercent = nextStatus === "completed"
      ? 100
      : Math.max(
          existingWatchState?.maxProgressPercent ?? existingWatchState?.progressPercent ?? 0,
          incomingMaxProgressPercent,
          nextProgressPercent
        );
    const safeResumeFrameUrl = normalizeImageUrl(resumeFrameUrl) ?? existingWatchState?.resumeFrameUrl;

    nextLessonWatchStates[lessonId] = {
      ...(safeDurationSeconds !== undefined ? { durationSeconds: safeDurationSeconds } : {}),
      lastWatchedAt: new Date().toISOString(),
      maxProgressPercent: safeMaxProgressPercent,
      progressPercent: nextProgressPercent,
      progressSeconds: safeProgressSeconds,
      ...(safeResumeFrameUrl ? { resumeFrameUrl: safeResumeFrameUrl } : {}),
      status: nextStatus
    };

    if (nextStatus === "completed" && !uniqueLessonIds.includes(lessonId)) {
      uniqueLessonIds.push(lessonId);
    }
  }

  const nextRecord = {
    completedLessonIds: uniqueLessonIds,
    contentId,
    lessonReactions: lessonReactions
      ? normalizeLessonReactions(lessonReactions)
      : normalizeLessonReactions(currentRecord?.lessonReactions),
    lessonWatchStates: nextLessonWatchStates,
    updatedAt: new Date().toISOString(),
    userId
  };

  const nextRow = {
    completed_lesson_ids: nextRecord.completedLessonIds,
    content_id: nextRecord.contentId,
    lesson_reactions: nextRecord.lessonReactions,
    lesson_watch_states: nextRecord.lessonWatchStates,
    updated_at: nextRecord.updatedAt,
    user_id: nextRecord.userId
  };

  if (currentRow) {
    const updateResult = await supabase
      .from("lesson_progress")
      .update(nextRow)
      .eq("user_id", nextRecord.userId)
      .eq("content_id", nextRecord.contentId)
      .eq("updated_at", currentRow.updated_at)
      .select("user_id");
    await throwIfSupabaseError(updateResult.error, "Erro salvando progresso da aula");

    if ((updateResult.data ?? []).length === 0) {
      throw createLessonProgressConflictError();
    }

    return nextRecord;
  }

  const insertResult = await supabase.from("lesson_progress").insert(nextRow);

  if (insertResult.error?.code === "23505") {
    throw createLessonProgressConflictError();
  }

  await throwIfSupabaseError(insertResult.error, "Erro salvando progresso da aula");
  return nextRecord;
}

export function getDefaultAdminStatus(): AdminEntitlementStatus {
  return "active";
}
