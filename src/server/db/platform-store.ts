import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { unstable_noStore as noStore } from "next/cache";
import {
  adminChartPoints,
  adminMetrics,
  adminPipeline
} from "@/server/db/admin-seed";
import type { AuthenticatedUser } from "@/server/auth/session";
import { getAdminRoleForUser, getUserDisplayName } from "@/server/auth/session";
import { getSupabaseAdminClient, hasSupabaseConfig } from "@/server/db/supabase/client";
import type { AccessPreviewMode } from "@/lib/access-preview";
import { getReleaseRuleNotice } from "@/lib/release-rules";
import { getSavedItemKey, getSavedTargetTypeForContentKind, savedItemCollectionLabel } from "@/lib/saved-items";
import type {
  AdminContentAccess,
  AdminDashboardData,
  AdminEntitlementStatus,
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
  CoursePresentationMode,
  ContentStatus,
  CourseModule,
  HomeHeroConfig,
  LessonVideoConfig,
  LessonReaction,
  LessonWatchState,
  LessonWatchStatus,
  LockedContentActionMode,
  HomeRow,
  PurchaseTarget,
  ReleaseRuleConfig,
  RowVisibility,
  SavedLessonItem,
  SavedModuleItem,
  SavedItemTargetType
} from "@/lib/platform-types";

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
  bootcamps: ContentItem[];
  chartPoints: AdminDashboardData["chartPoints"];
  cohorts: string[];
  contentPageSettings: Record<string, ContentPageSettings>;
  continueWatching: ContentItem[];
  courseModules: CourseModule[];
  courses: ContentItem[];
  entitlements: AdminDashboardData["entitlements"];
  formationInternalCourses: ContentItem[];
  formations: ContentItem[];
  hero: HomeHeroConfig;
  lessonProgress: LessonProgressRecord[];
  metrics: AdminDashboardData["metrics"];
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
  max_students: number | null;
  progress: number;
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
  purchaseLabel?: string;
  purchaseTarget?: PurchaseTarget;
  purchaseUrl?: string;
  releaseRule?: ReleaseRuleConfig;
  status?: ContentStatus;
  title: string;
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

const dataDirectory = path.join(process.cwd(), ".data");
const databasePath = path.join(dataDirectory, "bunker707-platform.json");
const defaultHero: HomeHeroConfig = {
  image: "/hero/bunker-707-red-front-hero.png",
  mediaType: "image",
  purpose: "school-brand",
  visibility: {
    badge: false,
    description: false,
    title: false
  }
};
const defaultStudent: PlatformStudent = {
  fullName: "Aluno Bunker707",
  name: "Aluno"
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function makeEmptyDatabase(): PlatformDatabase {
  return {
    accessEntitlements: [],
    bootcamps: [],
    chartPoints: cloneJson(adminChartPoints).map((point) => ({
      ...point,
      access: 0,
      progress: 0,
      revenueEvents: 0
    })),
    cohorts: [],
    contentPageSettings: {},
    continueWatching: [],
    courseModules: [],
    courses: [],
    entitlements: [],
    formationInternalCourses: [],
    formations: [],
    hero: cloneJson(defaultHero),
    lessonProgress: [],
    metrics: cloneJson(adminMetrics).map((metric) => ({
      ...metric,
      delta: "Sem dados ainda",
      value: "0"
    })),
    pipeline: cloneJson(adminPipeline).map((item) => ({
      ...item,
      count: 0
    })),
    recentLessons: [],
    releaseRules: [],
    savedItems: [],
    student: cloneJson(defaultStudent),
    students: [],
    upcomingProducts: [],
    updatedAt: new Date().toISOString(),
    version: 1,
    webhookEvents: []
  };
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
    maxStudents: row.max_students,
    progress: row.progress,
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
    { key: "hero", value: database.hero },
    { key: "student", value: database.student },
    { key: "metrics", value: database.metrics },
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

function normalizeDatabase(database: Partial<PlatformDatabase>): PlatformDatabase {
  const emptyDatabase = makeEmptyDatabase();

  return {
    ...emptyDatabase,
    ...database,
    accessEntitlements: database.accessEntitlements ?? emptyDatabase.accessEntitlements,
    bootcamps: database.bootcamps ?? emptyDatabase.bootcamps,
    chartPoints: database.chartPoints ?? emptyDatabase.chartPoints,
    cohorts: database.cohorts ?? emptyDatabase.cohorts,
    contentPageSettings: database.contentPageSettings ?? emptyDatabase.contentPageSettings,
    continueWatching: database.continueWatching ?? emptyDatabase.continueWatching,
    courseModules: database.courseModules ?? emptyDatabase.courseModules,
    courses: database.courses ?? emptyDatabase.courses,
    entitlements: database.entitlements ?? emptyDatabase.entitlements,
    formationInternalCourses: database.formationInternalCourses ?? emptyDatabase.formationInternalCourses,
    formations: database.formations ?? emptyDatabase.formations,
    hero: database.hero ?? emptyDatabase.hero,
    lessonProgress: (database.lessonProgress ?? emptyDatabase.lessonProgress).map((record) => ({
      ...record,
      completedLessonIds: record.completedLessonIds ?? [],
      lessonReactions: normalizeLessonReactions(record.lessonReactions),
      lessonWatchStates: normalizeLessonWatchStates(record.lessonWatchStates)
    })),
    metrics: database.metrics ?? emptyDatabase.metrics,
    pipeline: database.pipeline ?? emptyDatabase.pipeline,
    recentLessons: database.recentLessons ?? emptyDatabase.recentLessons,
    releaseRules: database.releaseRules ?? emptyDatabase.releaseRules,
    savedItems: database.savedItems ?? emptyDatabase.savedItems,
    student: database.student ?? emptyDatabase.student,
    students: database.students ?? emptyDatabase.students,
    upcomingProducts: database.upcomingProducts ?? emptyDatabase.upcomingProducts,
    updatedAt: database.updatedAt ?? emptyDatabase.updatedAt,
    version: 1,
    webhookEvents: database.webhookEvents ?? emptyDatabase.webhookEvents
  };
}

async function throwIfSupabaseError(error: unknown, context: string) {
  if (!error) {
    return;
  }

  const message = error instanceof Error ? error.message : JSON.stringify(error);
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

let lessonProgressColumnSupportPromise: Promise<{
  lessonReactions: boolean;
  lessonWatchStates: boolean;
}> | null = null;

async function hasSupabaseColumn(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  table: string,
  column: string
) {
  const { error } = await supabase.from(table).select(column).limit(1);

  if (!error) {
    return true;
  }

  const message = error instanceof Error ? error.message : JSON.stringify(error);
  const code = typeof error === "object" && error && "code" in error ? error.code : null;

  if (code === "42703" || code === "PGRST204" || message.includes("does not exist") || message.includes("Could not find")) {
    return false;
  }

  await throwIfSupabaseError(error, `Erro verificando coluna ${table}.${column}`);
  return false;
}

async function getLessonProgressColumnSupport(supabase: ReturnType<typeof getSupabaseAdminClient>) {
  lessonProgressColumnSupportPromise ??= Promise.all([
    hasSupabaseColumn(supabase, "lesson_progress", "lesson_reactions"),
    hasSupabaseColumn(supabase, "lesson_progress", "lesson_watch_states")
  ]).then(([lessonReactions, lessonWatchStates]) => ({
    lessonReactions,
    lessonWatchStates
  }));

  return lessonProgressColumnSupportPromise;
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

async function writeSupabaseDatabase(database: PlatformDatabase) {
  const supabase = getSupabaseAdminClient();
  const nextDatabase = {
    ...database,
    updatedAt: new Date().toISOString()
  };

  const contentRows = contentBucketEntries(nextDatabase).flatMap(([bucket, items]) =>
    items.map((item, index) => contentItemToRow(item, bucket, index))
  );
  const moduleRows = nextDatabase.courseModules.map(moduleToRow);
  const lessonRows = nextDatabase.courseModules.flatMap((courseModule) =>
    courseModule.lessons.map((lesson, index) => lessonToRow(lesson, courseModule.id, index))
  );
  const studentRows = nextDatabase.students.map(studentToRow);
  const studentCourseRows = nextDatabase.students.flatMap((studentRecord) =>
    studentRecord.courses.map((course) => studentCourseToRow(course, studentRecord.id))
  );
  const accessLogRows = nextDatabase.students.flatMap((studentRecord) =>
    (studentRecord.accessHistory ?? []).map((log) => studentAccessLogToRow(log, studentRecord.id))
  );
  const contentSettingsRows = Object.entries(nextDatabase.contentPageSettings).map(([contentId, settings]) => ({
    content_id: contentId,
    settings
  }));
  const lessonProgressColumnSupport = await getLessonProgressColumnSupport(supabase);
  const progressRows = nextDatabase.lessonProgress.map((record) => ({
    completed_lesson_ids: record.completedLessonIds,
    content_id: record.contentId,
    ...(lessonProgressColumnSupport.lessonReactions ? { lesson_reactions: record.lessonReactions } : {}),
    ...(lessonProgressColumnSupport.lessonWatchStates ? { lesson_watch_states: record.lessonWatchStates } : {}),
    updated_at: record.updatedAt,
    user_id: record.userId
  }));
  const savedItemRows = nextDatabase.savedItems.map(savedItemToRow);
  const platformSettingRows = settingsRows(nextDatabase);

  await upsertRows(supabase, "content_items", contentRows, "id", "Erro sincronizando content_items");
  await upsertRows(supabase, "content_page_settings", contentSettingsRows, "content_id", "Erro sincronizando content_page_settings");
  await upsertRows(supabase, "course_modules", moduleRows, "id", "Erro sincronizando course_modules");
  await upsertRows(supabase, "lessons", lessonRows, "id", "Erro sincronizando lessons");
  await upsertRows(
    supabase,
    "cohorts",
    nextDatabase.cohorts.map((name) => ({ name })),
    "name",
    "Erro sincronizando cohorts"
  );
  await upsertRows(supabase, "students", studentRows, "id", "Erro sincronizando students");
  await upsertRows(supabase, "student_courses", studentCourseRows, "id", "Erro sincronizando student_courses");
  await upsertRows(supabase, "student_access_logs", accessLogRows, "id", "Erro sincronizando student_access_logs");
  await upsertRows(supabase, "lesson_progress", progressRows, "user_id,content_id", "Erro sincronizando lesson_progress");
  await upsertRows(supabase, "saved_items", savedItemRows, "id", "Erro sincronizando saved_items");
  await upsertRows(supabase, "platform_settings", platformSettingRows, "key", "Erro sincronizando platform_settings");

  await deleteMissingRows(supabase, "student_access_logs", "id", accessLogRows.map((row) => row.id), "Erro removendo historicos antigos");
  await deleteMissingRows(supabase, "student_courses", "id", studentCourseRows.map((row) => row.id), "Erro removendo acessos antigos");
  await deleteMissingRows(supabase, "students", "id", studentRows.map((row) => row.id), "Erro removendo alunos antigos");
  await deleteMissingRows(supabase, "saved_items", "id", savedItemRows.map((row) => row.id), "Erro removendo favoritos antigos");
  await deleteMissingRows(
    supabase,
    "content_page_settings",
    "content_id",
    contentSettingsRows.map((row) => row.content_id),
    "Erro removendo configuracoes de pagina antigas"
  );
  await deleteMissingRows(supabase, "cohorts", "name", nextDatabase.cohorts, "Erro removendo turmas antigas");
  await deleteMissingRows(supabase, "content_items", "id", contentRows.map((row) => row.id), "Erro removendo conteudos antigos");

  return nextDatabase;
}

async function readSupabaseDatabase() {
  const supabase = getSupabaseAdminClient();
  const [
    contentItemsResult,
    contentSettingsResult,
    modulesResult,
    lessonsResult,
    cohortsResult,
    studentsResult,
    studentCoursesResult,
    accessLogsResult,
    progressResult,
    savedItemsResult,
    accessEntitlementsResult,
    settingsResult
  ] = await Promise.all([
    supabase.from("content_items").select("*").order("sort_order", { ascending: true }),
    supabase.from("content_page_settings").select("*"),
    supabase.from("course_modules").select("*").order("sort_order", { ascending: true }),
    supabase.from("lessons").select("*").order("sort_order", { ascending: true }),
    supabase.from("cohorts").select("name").order("created_at", { ascending: true }),
    supabase.from("students").select("*").order("created_at", { ascending: true }),
    supabase.from("student_courses").select("*").order("created_at", { ascending: true }),
    supabase.from("student_access_logs").select("*").order("created_at", { ascending: true }),
    supabase.from("lesson_progress").select("*"),
    supabase.from("saved_items").select("*").order("created_at", { ascending: true }),
    supabase.from("entitlements").select("user_id,target_type,target_id,status,starts_at,ends_at"),
    supabase.from("platform_settings").select("*")
  ]);

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
    [accessEntitlementsResult, "Erro lendo entitlements"],
    [settingsResult, "Erro lendo platform_settings"]
  ] as const) {
    await throwIfSupabaseError(result.error, context);
  }

  const contentRows = (contentItemsResult.data ?? []) as ContentItemRow[];
  const lessonRows = (lessonsResult.data ?? []) as LessonRow[];
  const settingsMap = new Map(
    ((settingsResult.data ?? []) as Array<{ key: string; value: unknown }>).map((setting) => [setting.key, setting.value])
  );
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
    .map(contentRowToItem);

  return {
    accessEntitlements: ((accessEntitlementsResult.data ?? []) as AccessEntitlementRow[]).map((row) => ({
      endsAt: row.ends_at,
      startsAt: row.starts_at,
      status: row.status,
      targetId: row.target_id,
      targetType: row.target_type,
      userId: row.user_id
    })),
    bootcamps: itemsByBucket("bootcamps"),
    chartPoints: (settingsMap.get("chartPoints") as PlatformDatabase["chartPoints"] | undefined) ?? [],
    cohorts: ((cohortsResult.data ?? []) as Array<{ name: string }>).map((cohort) => cohort.name),
    contentPageSettings: contentPageSettingsMap,
    continueWatching: itemsByBucket("continue_watching"),
    courseModules: ((modulesResult.data ?? []) as CourseModuleRow[]).map((row) => moduleRowToModule(row, lessonRows)),
    courses: itemsByBucket("courses"),
    entitlements: (settingsMap.get("entitlements") as PlatformDatabase["entitlements"] | undefined) ?? [],
    formationInternalCourses: itemsByBucket("formation_internal_courses"),
    formations: itemsByBucket("formations"),
    hero: (settingsMap.get("hero") as HomeHeroConfig | undefined) ?? defaultHero,
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

async function writeDatabase(database: PlatformDatabase) {
  if (hasSupabaseConfig()) {
    return writeSupabaseDatabase(database);
  }

  await mkdir(dataDirectory, { recursive: true });
  const nextDatabase = {
    ...normalizeDatabase(database),
    updatedAt: new Date().toISOString()
  };
  const temporaryPath = `${databasePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(nextDatabase, null, 2)}\n`, "utf8");
  await rename(temporaryPath, databasePath);
  return nextDatabase;
}

async function readDatabase() {
  noStore();

  if (hasSupabaseConfig()) {
    return readSupabaseDatabase();
  }

  try {
    const rawDatabase = await readFile(databasePath, "utf8");
    return normalizeDatabase(JSON.parse(rawDatabase) as Partial<PlatformDatabase>);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : null;

    if (code !== "ENOENT") {
      throw error;
    }

    const emptyDatabase = makeEmptyDatabase();
    return writeDatabase(emptyDatabase);
  }
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

function hasAccess(item: ContentItem) {
  return !item.isLocked;
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
    return Array.from(userAccessKeys).some((accessKey) => accessKey.startsWith("formation:"));
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

  if (hasUserEntitlementForItem(item, userAccessKeys)) {
    return true;
  }

  return hasAccess(item);
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
  userAccessKeys: Set<string>
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
        lessons.push({
          description: lesson.description,
          duration: lesson.duration,
          id: lesson.id,
          image: lesson.image ?? courseModule.image,
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
  return getSellableItems(database).flatMap((item) => {
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

          const releaseNotice =
            getReleaseRuleNotice(lesson.releaseRule, "aula") ??
            getReleaseRuleNotice(courseModule.releaseRule, "modulo");

          if (releaseNotice?.isLocked) {
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

  return [
    {
      id: "continue-watching",
      items: accessPreviewMode === "student_without_access"
        ? []
        : applySavedStateToItems(
          continueWatchingItems,
          savedItems
        ),
      subtitle: "Retome exatamente de onde parou.",
      title: "Continue assistindo",
      variant: "continue",
      visibility: "students"
    },
    {
      id: "my-purchases",
      items: applySavedStateToItems(getPurchasedProducts(database, accessPreviewMode, userAccessKeys), savedItems),
      subtitle: "Todos os produtos que voce ja tem acesso: formacoes, bootcamps e cursos.",
      title: "Minhas compras",
      variant: "vertical",
      visibility: "students"
    },
    ...getHomeCourseModuleRows(database, accessPreviewMode, userId, userAccessKeys, savedItems),
    {
      id: "showcase",
      items: applySavedStateToItems(
        applyAccessPreviewToItems(getSellableItems(database), accessPreviewMode, userAccessKeys),
        savedItems
      ),
      subtitle: "Produtos disponiveis e destaques configurados pela Bunker707.",
      title: "Produtos a venda",
      variant: "vertical",
      visibility: "all"
    },
    {
      id: "upcoming",
      items: applySavedStateToItems(
        applyAccessPreviewToItems(database.upcomingProducts, accessPreviewMode, userAccessKeys),
        savedItems
      ),
      subtitle: "Proximos cursos, formacoes e turmas para entrar no radar.",
      title: "Em breve na Bunker707",
      variant: "vertical",
      visibility: "all"
    }
  ];
}

function getHomeModalStructures(
  database: PlatformDatabase,
  rows: HomeRow[],
  accessPreviewMode?: AccessPreviewMode,
  user?: AuthenticatedUser | string
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
          ? applySavedStateToItems(
            applyAccessPreviewToItems(database.formationInternalCourses, accessPreviewMode, userAccessKeys),
            savedItems
          )
          : [],
        modules: applySavedStateToModules(applyLessonProgress(database, item.id, getModulesForContent(database, item), userId), savedItems)
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
    return "Bloqueado sem entitlement";
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
    updatedAt: database.updatedAt ? "Persistido agora" : "Sem data",
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
  return getHomeRows(database).map((row, index) => ({
    contentCount: row.variant === "course_modules" ? row.modules?.length ?? 0 : row.items.length,
    id: row.id,
    order: index + 1,
    source:
      row.variant === "continue"
        ? "Progresso do aluno"
        : row.variant === "course_modules"
          ? "Modulos de curso escolhido"
        : row.visibility === "students"
          ? "Entitlements ativos"
          : "Curadoria persistida",
    title: row.title,
    visibility: row.visibility
  }));
}

function toAdminDashboardData(database: PlatformDatabase): AdminDashboardData {
  return {
    chartPoints: database.chartPoints,
    cohorts: database.cohorts,
    contentRecords: getAdminRecords(database),
    courseModules: database.courseModules,
    entitlements: database.entitlements,
    formationCourses: database.formationInternalCourses,
    homeSections: getAdminHomeSections(database),
    metrics: database.metrics,
    pipeline: database.pipeline,
    persistenceProvider: hasSupabaseConfig() ? "supabase" : "local_fallback",
    releaseRules: database.releaseRules,
    sellableProducts: getSellableProducts(database),
    students: database.students,
    webhookEvents: database.webhookEvents
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
    image:
      input.image ||
      "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    isLocked,
    kind: input.kind,
    lessons: input.lessons || (input.kind === "Aula" ? "Aula" : "0 aulas"),
    maxStudents: input.maxStudents ?? null,
    progress: 0,
    purchaseLabel: input.purchaseLabel ?? (isLocked && accessModel !== "free" ? "Comprar" : undefined),
    purchaseTarget: input.purchaseTarget ?? "same_tab",
    purchaseUrl: input.purchaseUrl,
    releaseRule: input.releaseRule,
    status: input.status ?? (accessModel === "free" ? "Liberado" : isLocked ? "Bloqueado" : "Novo"),
    title: input.title
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
    return modules;
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
  const database = await readDatabase();
  const adminRole = user ? await getAdminRoleForUser(user.id) : null;

  return {
    canUseAccessPreview: Boolean(adminRole),
    student: getStudentForUser(database, user)
  };
}

export async function getHomePageData(accessPreviewMode?: AccessPreviewMode, user?: AuthenticatedUser | string) {
  const database = await readDatabase();
  const homeRows = getHomeRows(database, accessPreviewMode, user).filter((row) => row.items.length > 0);

  return {
    hero: database.hero,
    homeRows,
    modalStructures: getHomeModalStructures(database, homeRows, accessPreviewMode, user)
  };
}

export async function getPurchasesPageData(accessPreviewMode?: AccessPreviewMode, user?: AuthenticatedUser | string) {
  const database = await readDatabase();
  return {
    purchasedProducts: getPurchasedProducts(database, accessPreviewMode, getUserAccessKeys(database, user))
  };
}

export async function getFavoritesPageData(accessPreviewMode?: AccessPreviewMode, user?: AuthenticatedUser | string) {
  const database = await readDatabase();
  const { userId } = getUserIdentity(user);
  const savedItems = getSavedItemSet(database, userId);
  const userAccessKeys = getUserAccessKeys(database, user);

  return {
    savedContentItems: getSavedContentItems(database, accessPreviewMode, savedItems, userAccessKeys),
    savedLessonItems: getSavedLessonItems(database, accessPreviewMode, savedItems, userAccessKeys),
    savedModuleItems: getSavedModuleItems(database, accessPreviewMode, savedItems, userAccessKeys)
  };
}

export async function getContentRouteParams() {
  const database = await readDatabase();
  return getAllContentItems(database).map((item) => ({
    id: item.id
  }));
}

export async function getLessonRouteParams() {
  const database = await readDatabase();
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
  const database = await readDatabase();
  const allContentItems = getAllContentItems(database);
  const item = allContentItems.find((content) => content.id === contentId) ?? null;
  const { userId } = getUserIdentity(user);
  const savedItems = getSavedItemSet(database, userId);
  const userAccessKeys = getUserAccessKeys(database, user);

  if (!item) {
    return null;
  }

  return {
    allContentItems: applySavedStateToItems(
      applyAccessPreviewToItems(allContentItems, accessPreviewMode, userAccessKeys),
      savedItems
    ),
    courseModules: applySavedStateToModules(applyLessonProgress(database, contentId, getModulesForContent(database, item), userId), savedItems),
    formationInternalCourses: applySavedStateToItems(
      applyAccessPreviewToItems(database.formationInternalCourses, accessPreviewMode, userAccessKeys),
      savedItems
    ),
    formations: applySavedStateToItems(
      applyAccessPreviewToItems(database.formations, accessPreviewMode, userAccessKeys),
      savedItems
    ),
    hero: database.hero,
    item: applySavedStateToItem(applyAccessPreviewToItem(item, accessPreviewMode, userAccessKeys), savedItems),
    settings: database.contentPageSettings[item.id]
  };
}

export async function getLessonPageData(
  contentId: string,
  moduleId: string,
  user?: AuthenticatedUser | string,
  accessPreviewMode?: AccessPreviewMode
) {
  const database = await readDatabase();
  const allContentItems = getAllContentItems(database);
  const item = allContentItems.find((content) => content.id === contentId) ?? null;
  const { userId } = getUserIdentity(user);
  const savedItems = getSavedItemSet(database, userId);
  const userAccessKeys = getUserAccessKeys(database, user);
  const modules = item
    ? applySavedStateToModules(applyLessonProgress(database, contentId, getModulesForContent(database, item), userId), savedItems)
    : [];
  const selectedModule = modules.find((courseModule) => courseModule.id === moduleId) ?? null;
  const parentFormation = item?.commerceScope === "included_content" ? database.formations[0] : undefined;

  if (!item || !selectedModule) {
    return null;
  }

  return {
    allModules: modules,
    initialLessonReactions: getLessonReactions(database, contentId, userId),
    initialLessonWatchStates: getLessonWatchStates(database, contentId, userId),
    item: applySavedStateToItem(applyAccessPreviewToItem(item, accessPreviewMode, userAccessKeys), savedItems),
    returnContent: parentFormation
      ? applySavedStateToItem(applyAccessPreviewToItem(parentFormation, accessPreviewMode, userAccessKeys), savedItems)
      : undefined,
    selectedModule
  };
}

export async function getAdminDashboardData() {
  const database = await readDatabase();
  return toAdminDashboardData(database);
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
    source_event_id: `admin-student:${studentRecord.id}:${course.id ?? course.targetId}`,
    source_provider: normalizeEntitlementSourceProvider(course.sourceProvider ?? studentRecord.sourceProvider),
    starts_at: accessDateValueToIso(course.startsAt) ?? new Date().toISOString(),
    status: course.status,
    target_id: course.targetId,
    target_type: course.targetType,
    user_id: userId
  };
  const existingResult = await supabase
    .from("entitlements")
    .select("id")
    .eq("user_id", userId)
    .eq("target_type", course.targetType)
    .eq("target_id", course.targetId)
    .limit(1)
    .maybeSingle();

  await throwIfSupabaseError(existingResult.error, "Erro consultando entitlement existente");

  const writeResult = existingResult.data?.id
    ? await supabase.from("entitlements").update(entitlementRow).eq("id", existingResult.data.id)
    : await supabase.from("entitlements").insert(entitlementRow);

  await throwIfSupabaseError(writeResult.error, "Erro sincronizando entitlement do aluno");
}

async function syncSupabaseEntitlementsForStudents(students: AdminStudent[]) {
  if (!hasSupabaseConfig()) {
    return;
  }

  const supabase = getSupabaseAdminClient();
  const userIdsByEmail = await getSupabaseUserIdsByEmail(
    supabase,
    students.map((studentRecord) => studentRecord.email)
  );

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
  const database = await readDatabase();
  database.students = students;
  await writeDatabase(database);
  await syncSupabaseEntitlementsForStudents(students);
  return toAdminDashboardData(database);
}

export async function upsertContentItem(input: ContentWriteInput) {
  const database = await readDatabase();
  const existingItem = input.id ? getAllContentItems(database).find((item) => item.id === input.id) : undefined;
  const normalizedItem = normalizeContentInput(input);
  const item = {
    ...existingItem,
    ...normalizedItem,
    id: existingItem?.id ?? input.id ?? normalizedItem.id,
    progress: existingItem?.progress ?? 0
  };
  removeContentById(database, item.id);
  getContentBucket(database, item).unshift(item);

  if (input.heroImage !== undefined) {
    const currentSettings = database.contentPageSettings[item.id] ?? {};
    const heroImage = input.heroImage.trim();

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

  await writeDatabase(database);
  return toAdminDashboardData(database);
}

export async function deleteContentItem(itemId: string) {
  const database = await readDatabase();
  const ownedModules = database.courseModules.filter((module) => module.ownerId === itemId);
  const ownedTargetIds = new Set([
    itemId,
    ...ownedModules.map((module) => module.id),
    ...ownedModules.flatMap((module) => module.lessons.map((lesson) => lesson.id))
  ]);
  removeContentById(database, itemId);
  delete database.contentPageSettings[itemId];
  database.courseModules = database.courseModules.filter((module) => module.ownerId !== itemId);
  database.savedItems = database.savedItems.filter((savedItem) => !ownedTargetIds.has(savedItem.targetId));
  database.students = database.students.map((studentRecord) => ({
    ...studentRecord,
    courses: studentRecord.courses.filter((course) => course.targetId !== itemId)
  }));
  await writeDatabase(database);
  return toAdminDashboardData(database);
}

export async function upsertCourseModule(input: ModuleWriteInput) {
  const database = await readDatabase();
  const moduleId = input.id || makeId("module", input.title);
  const existingModule = database.courseModules.find((module) => module.id === moduleId);
  const ownerId = input.ownerId ?? existingModule?.ownerId;
  const ownerKind = input.ownerKind ?? existingModule?.ownerKind;
  const ownerModulesCount = database.courseModules.filter((module) =>
    ownerId ? module.ownerId === ownerId : !module.ownerId
  ).length;
  const nextModule: CourseModule = {
    description: input.description || "Modulo cadastrado no CMS persistido.",
    eyebrow: existingModule?.eyebrow ?? `Modulo ${String(ownerModulesCount + 1).padStart(2, "0")}`,
    id: moduleId,
    image:
      input.image ||
      "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=900&q=80",
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
      : [nextModule, ...database.courseModules]
  ).map((module) => ({
    ...module,
    meta: `${module.lessons.length} aula${module.lessons.length === 1 ? "" : "s"}`
  }));

  await writeDatabase(database);
  return toAdminDashboardData(database);
}

export async function upsertLesson(input: LessonWriteInput) {
  const database = await readDatabase();
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
  const nextLesson = {
    completed: existingLesson?.completed ?? false,
    description: input.description || existingLesson?.description || "Aula cadastrada no CMS persistido.",
    duration: input.duration || existingLesson?.duration || "15 min",
    id: lessonId,
    image: input.image || existingLesson?.image,
    releaseRule: input.releaseRule ?? existingLesson?.releaseRule,
    title: input.title,
    video: hasVideoInput ? input.video ?? undefined : existingLesson?.video
  };

  database.courseModules = database.courseModules.map((module, index) => {
    const moduleLessons = module.lessons.filter((lesson) => lesson.id !== lessonId);
    const lessons = index === moduleIndex ? [nextLesson, ...moduleLessons] : moduleLessons;

    return {
      ...module,
      lessons,
      meta: `${lessons.length} aula${lessons.length === 1 ? "" : "s"}`
    };
  });

  await writeDatabase(database);
  return toAdminDashboardData(database);
}

export async function addCohort(name: string) {
  const database = await readDatabase();
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error("Nome da turma e obrigatorio.");
  }

  if (!database.cohorts.includes(trimmedName)) {
    database.cohorts = [trimmedName, ...database.cohorts];
  }

  await writeDatabase(database);
  return toAdminDashboardData(database);
}

function targetExists(database: PlatformDatabase, targetType: SavedItemTargetType, targetId: string) {
  if (["formation", "standalone_course", "mentorship", "webinar", "product", "bootcamp", "material"].includes(targetType)) {
    return getAllContentItems(database).some((item) => (
      item.id === targetId &&
      getSavedTargetTypeForContentKind(item.kind) === targetType
    ));
  }

  if (targetType === "module") {
    return database.courseModules.some((module) => module.id === targetId);
  }

  return database.courseModules.some((module) => module.lessons.some((lesson) => lesson.id === targetId));
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
  const database = await readDatabase();
  const normalizedCollectionLabel = collectionLabel.trim() || savedItemCollectionLabel;
  const existingIndex = database.savedItems.findIndex((savedItem) => (
    savedItem.userId === userId &&
    savedItem.targetType === targetType &&
    savedItem.targetId === targetId &&
    savedItem.collectionLabel === normalizedCollectionLabel
  ));

  if (!targetExists(database, targetType, targetId)) {
    throw new Error("Item para salvar nao encontrado.");
  }

  if (!saved) {
    if (existingIndex >= 0) {
      database.savedItems.splice(existingIndex, 1);
      await writeDatabase(database);
    }

    return {
      collectionLabel: normalizedCollectionLabel,
      saved: false,
      targetId,
      targetType
    };
  }

  const nextRecord: SavedItemRecord = existingIndex >= 0
    ? database.savedItems[existingIndex]
    : {
        collectionLabel: normalizedCollectionLabel,
        createdAt: new Date().toISOString(),
        id: `saved-${normalizedCollectionLabel}-${targetType}-${targetId}-${userId}`.replace(/[^a-zA-Z0-9_-]+/g, "-"),
        targetId,
        targetType,
        userId
      };

  if (existingIndex >= 0) {
    database.savedItems[existingIndex] = nextRecord;
  } else {
    database.savedItems.push(nextRecord);
  }

  await writeDatabase(database);

  return {
    collectionLabel: normalizedCollectionLabel,
    saved: true,
    targetId,
    targetType
  };
}

let lessonProgressWriteQueue = Promise.resolve();

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
  const writeResult = lessonProgressWriteQueue.then(() => replaceCompletedLessonsUnsafe(input));
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
  const database = await readDatabase();
  const currentIndex = database.lessonProgress.findIndex(
    (record) => record.userId === userId && record.contentId === contentId
  );
  const currentRecord = currentIndex >= 0 ? database.lessonProgress[currentIndex] : null;
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

  if (currentIndex >= 0) {
    database.lessonProgress[currentIndex] = nextRecord;
  } else {
    database.lessonProgress.push(nextRecord);
  }

  await writeDatabase(database);
  return nextRecord;
}

export function getDefaultAdminStatus(sourceProvider: AdminSourceProvider): AdminEntitlementStatus {
  return sourceProvider === "Manual" ? "active" : "active";
}
