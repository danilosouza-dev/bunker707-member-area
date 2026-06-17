import type { LucideIcon } from "lucide-react";

export type ContentKind =
  | "Formacao"
  | "Curso"
  | "Mentoria"
  | "Webinario"
  | "Produto"
  | "Bootcamp"
  | "Aula"
  | "Material";
export type CommerceScope = "sellable_product" | "included_content" | "learning_content";
export type ContentStatus = "Novo" | "Em andamento" | "Concluido" | "Liberado" | "Bloqueado" | "Em breve";
export type RowVisibility = "students" | "non_students" | "all";
export type FormationCourseOpenMode = "course_page_modules" | "course_lesson_format";
export type CoursePresentationMode = "module_cards" | "lesson_playlist";
export type LockedContentActionMode = "details_modal" | "external_link";
export type ModuleOpenMode = "expand_lessons" | "lesson_page";
export type InternalCardActionMode = "button" | "implicit";
export type ContentAccessModel = "closed" | "free";
export type PurchaseTarget = "same_tab" | "new_tab";
export type SavedItemTargetType =
  | "formation"
  | "standalone_course"
  | "mentorship"
  | "webinar"
  | "product"
  | "bootcamp"
  | "module"
  | "lesson"
  | "material";
export type ReleaseRuleConfig = {
  delayUnit?: "horas" | "dias";
  delayValue?: string;
  fixedDate?: string;
  mode: ReleaseRuleMode;
  requirement?: string;
};

export type LessonVideoProvider = "youtube" | "vimeo" | "bunny" | "mux" | "custom_url" | "embed_code";
export type LessonReaction = "not-for-me" | "liked" | "loved";

export type LessonVideoConfig = {
  assetId?: string;
  embedCode?: string;
  provider: LessonVideoProvider;
  url?: string;
};

export type LessonWatchStatus = "in_progress" | "completed";

export type LessonWatchState = {
  durationSeconds?: number;
  lastWatchedAt: string;
  maxProgressPercent?: number;
  progressPercent: number;
  progressSeconds: number;
  resumeFrameUrl?: string;
  status: LessonWatchStatus;
};

export type ContentItem = {
  accessLabel?: string;
  accessModel?: ContentAccessModel;
  commerceScope?: CommerceScope;
  description?: string;
  durationLabel?: string;
  eyebrow: string;
  href?: string;
  id: string;
  image: string;
  instructor?: {
    avatar?: string;
    handle?: string;
    name: string;
  };
  isLocked?: boolean;
  isSaved?: boolean;
  kind: ContentKind;
  lessons?: string;
  level?: string;
  maxStudents?: number | null;
  progress: number;
  purchaseLabel?: string;
  purchaseTarget?: PurchaseTarget;
  purchaseUrl?: string;
  releaseRule?: ReleaseRuleConfig;
  status: ContentStatus;
  title: string;
};

export type HomeRow = {
  course?: ContentItem;
  id: string;
  items: ContentItem[];
  lockedActionMode?: LockedContentActionMode;
  modules?: CourseModule[];
  subtitle?: string;
  title: string;
  variant: "continue" | "vertical" | "course_modules";
  visibility: RowVisibility;
};

export type ContentModalStructure = {
  formationCourses: ContentItem[];
  modules: CourseModule[];
};

export type NavigationItem = {
  href?: string;
  icon: LucideIcon;
  label: string;
};

export type HomeHeroConfig = {
  badge?: string;
  description?: string;
  image: string;
  mediaType: "image" | "video";
  purpose: "school-brand" | "editorial-highlight" | "content-highlight";
  title?: string;
  visibility?: {
    badge?: boolean;
    description?: boolean;
    title?: boolean;
  };
};

export type ContentPageHeroConfig = {
  badge?: string;
  ctaHref?: string;
  ctaLabel?: string;
  description?: string;
  mediaSrc: string;
  mediaType: "image" | "video";
  poster?: string;
  title?: string;
  visibility?: {
    badge?: boolean;
    cta?: boolean;
    description?: boolean;
    title?: boolean;
  };
};

export type LessonPreview = {
  completed?: boolean;
  description: string;
  duration: string;
  id: string;
  image?: string;
  isSaved?: boolean;
  releaseRule?: ReleaseRuleConfig;
  title: string;
  video?: LessonVideoConfig;
};

export type CourseModule = {
  description: string;
  eyebrow: string;
  id: string;
  image: string;
  isSaved?: boolean;
  lessons: LessonPreview[];
  meta: string;
  ownerId?: string;
  ownerKind?: ContentKind;
  progress: number;
  releaseRule?: ReleaseRuleConfig;
  title: string;
};

export type SavedModuleItem = {
  description: string;
  id: string;
  image: string;
  isSaved?: boolean;
  meta: string;
  parentContentId: string;
  parentContentKind: ContentKind;
  parentContentTitle: string;
  parentIsLocked?: boolean;
  title: string;
};

export type SavedLessonItem = {
  description: string;
  duration: string;
  id: string;
  image: string;
  isSaved?: boolean;
  moduleId: string;
  moduleTitle: string;
  parentContentId: string;
  parentContentKind: ContentKind;
  parentContentTitle: string;
  parentIsLocked?: boolean;
  title: string;
};

export type ContentPageSettings = {
  coursePresentationMode?: CoursePresentationMode;
  formationCourseOpenMode?: FormationCourseOpenMode;
  homeModuleSection?: {
    enabled: boolean;
  };
  hero?: ContentPageHeroConfig;
  internalCardActionMode?: InternalCardActionMode;
  lockedActionMode?: LockedContentActionMode;
  moduleOpenMode?: ModuleOpenMode;
};

export type AdminContentAccess = "Liberado" | "Bloqueado" | "Drip" | "Em breve";
export type AdminView = "overview" | "students" | "catalog" | "structure";
export type ReleaseRuleMode =
  | "immediate"
  | "after_enrollment"
  | "after_purchase"
  | "after_previous_lesson"
  | "fixed_date"
  | "activity_required";
export type AdminSourceProvider = "Hotmart" | "Ticto" | "TikTok" | "Kiwify" | "Manual";
export type AdminEntitlementStatus = "active" | "suspended" | "revoked" | "expired";
export type AdminStudentRole = "Estudante" | "Professor" | "Mentor";
export type AdminStudentCategory = "Aluno" | "Professor" | "Cortesia" | "Importado" | "VIP";
export type AdminStudentAcquisition = "Compra" | "Importado" | "Manual" | "Cortesia";

export type AdminContentRecord = {
  access: AdminContentAccess;
  commerceScope: CommerceScope;
  content: ContentItem;
  kind: ContentKind;
  lessonsCount: number;
  modulesCount: number;
  owner: string;
  pageSettings?: ContentPageSettings;
  releaseSummary: string;
  status: ContentStatus;
  updatedAt: string;
  visibility: RowVisibility;
};

export type AdminMetric = {
  delta: string;
  label: string;
  tone: "red" | "green" | "amber" | "neutral";
  value: string;
};

export type AdminChartPoint = {
  access: number;
  label: string;
  progress: number;
  revenueEvents: number;
};

export type AdminReleaseRule = {
  affectedStudents: number;
  condition: string;
  delay?: string;
  id: string;
  mode: ReleaseRuleMode;
  scope: "Produto" | "Curso" | "Modulo" | "Aula" | "Material";
  status: "Ativa" | "Rascunho" | "Pausada";
  target: string;
  title: string;
};

export type AdminEntitlement = {
  email: string;
  endsAt: string;
  id: string;
  product: string;
  sourceProvider: AdminSourceProvider;
  status: AdminEntitlementStatus;
  target: string;
  user: string;
};

export type AdminWebhookEvent = {
  id: string;
  provider: AdminSourceProvider;
  receivedAt: string;
  retries: number;
  status: "processed" | "pending" | "failed";
  type: string;
};

export type AdminStudentCourse = {
  acquisition?: AdminStudentAcquisition;
  category?: AdminStudentCategory;
  cohort?: string;
  endsAt: string;
  externalOrderId: string;
  id: string;
  lastActivityAt: string;
  product: string;
  progressPercent: number;
  role?: AdminStudentRole;
  sourceProvider: AdminSourceProvider;
  startsAt: string;
  status: AdminEntitlementStatus;
  targetId: string;
  targetType: "formation" | "standalone_course" | "mentorship" | "webinar" | "product" | "bootcamp";
};

export type AdminStudentAccessLog = {
  action: "login" | "lesson_started" | "lesson_completed" | "material_downloaded" | "access_email_sent";
  device: string;
  id: string;
  location: string;
  occurredAt: string;
};

export type AdminStudent = {
  accessCount?: number;
  accessHistory?: AdminStudentAccessLog[];
  avatarUrl?: string;
  city: string;
  courses: AdminStudentCourse[];
  document: string;
  email: string;
  externalCustomerId: string;
  firstAccessAt?: string;
  fullName: string;
  id: string;
  joinedAt: string;
  lastActivityAt: string;
  notes: string;
  phone: string;
  sourceProvider: AdminSourceProvider;
  state: string;
  status: AdminEntitlementStatus;
  tags: string[];
};

export type AdminSellableProduct = {
  id: string;
  image: string;
  kind: ContentKind;
  targetType: AdminStudentCourse["targetType"];
  title: string;
};

export type AdminHomeSection = {
  contentCount: number;
  id: string;
  order: number;
  source: string;
  title: string;
  visibility: RowVisibility;
};

export type AdminPipelineItem = {
  count: number;
  label: string;
  tone: string;
};

export type AdminDashboardData = {
  chartPoints: AdminChartPoint[];
  cohorts: string[];
  contentRecords: AdminContentRecord[];
  courseModules: CourseModule[];
  entitlements: AdminEntitlement[];
  formationCourses: ContentItem[];
  homeSections: AdminHomeSection[];
  metrics: AdminMetric[];
  pipeline: AdminPipelineItem[];
  persistenceProvider: "local_fallback" | "supabase";
  releaseRules: AdminReleaseRule[];
  sellableProducts: AdminSellableProduct[];
  students: AdminStudent[];
  webhookEvents: AdminWebhookEvent[];
};
