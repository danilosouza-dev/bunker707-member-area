import type { MemberStyleConfig } from "./member-style";
import type { LucideIcon } from "lucide-react";
import type { MemberReleaseState } from "./release-state";

export type { MemberReleaseState } from "./release-state";

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
export type ContentPublicationStatus = "archived" | "draft" | "published";
export type RowVisibility = "students" | "non_students" | "all";
export type HomeSectionType = "continue_watching" | "content_carousel" | "content_structure";
export type HomeSectionContentSource =
  | "recent_lessons"
  | "entitlement_products"
  | "sellable_products"
  | "upcoming_products"
  | "manual"
  | "selected_content_structure";
export type HomeSectionLayout = "continue" | "vertical" | "compact" | "immersive";
export type HomeSectionConfig = {
  contentSource: HomeSectionContentSource;
  id: string;
  isActive: boolean;
  itemIds: string[];
  layout: HomeSectionLayout;
  order: number;
  sectionType: HomeSectionType;
  sourceContentId?: string;
  subtitle?: string;
  title: string;
  visibility: RowVisibility;
};
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
  /**
   * De onde conta o atraso de "after_enrollment"/"after_purchase". Ausente = inicio do acesso
   * (entitlements.starts_at, a data da compra). "warranty_end" = fim da garantia gravado no acesso
   * (Hotmart: purchase.warranty_expire_date), quando o pipeline de compras passar a gravar; sem a data
   * gravada, volta para o inicio do acesso. Ver getReleaseAnchorTimestamp em release-policy.ts.
   */
  anchor?: "access_start" | "warranty_end";
  delayUnit?: "horas" | "dias";
  delayValue?: string;
  fixedDate?: string;
  mode: ReleaseRuleMode;
  requirement?: string;
};

export type LessonVideoProvider = "youtube" | "vimeo" | "bunny" | "mux" | "custom_url" | "embed_code";
export type LessonReaction = "not-for-me" | "liked" | "loved";
export type LessonCommentStatus = "pending" | "approved" | "hidden" | "spam";
export type LessonCommentReaction =
  | "like"
  | "fire"
  | "insight"
  | "love"
  | "clap"
  | "laugh"
  | "wow"
  | "rocket"
  | "eyes"
  | "check";
export type LessonCommentAuthorRole = "student" | "producer" | "moderator";

export type LessonCommentRecord = {
  authorAvatarUrl?: string;
  authorId?: string;
  authorName: string;
  authorRole: LessonCommentAuthorRole;
  authorUsername: string;
  body: string;
  contentId: string;
  createdAt: string;
  id: string;
  isOwn: boolean;
  lessonId: string;
  parentCommentId?: string;
  reactions: Partial<Record<LessonCommentReaction, number>>;
  replies: LessonCommentRecord[];
  reportedByCurrentUser: boolean;
  selectedReaction?: LessonCommentReaction;
  status: LessonCommentStatus;
  updatedAt: string;
};

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
  /** content_items.listing: "hidden" = "Oculto por enquanto" (so quem tem acesso ve). Ausente = listado. */
  listing?: "listed" | "hidden";
  maxStudents?: number | null;
  parentContentId?: string;
  progress: number;
  publicationStatus?: ContentPublicationStatus;
  purchaseLabel?: string;
  purchaseTarget?: PurchaseTarget;
  purchaseUrl?: string;
  releaseRule?: ReleaseRuleConfig;
  /** Liberacao calculada no servidor para o aluno da requisicao (com a data real). */
  releaseState?: MemberReleaseState;
  status: ContentStatus;
  title: string;
};

export type HomeRow = {
  backgroundImage?: string;
  course?: ContentItem;
  id: string;
  items: ContentItem[];
  layout?: HomeSectionLayout;
  lockedActionMode?: LockedContentActionMode;
  modules?: CourseModule[];
  sectionId?: string;
  structureItems?: ContentItem[];
  subtitle?: string;
  title: string;
  variant: "continue" | "vertical" | "course_modules";
  visibility: RowVisibility;
};

/** Midia do topo do modal do curso: a "Imagem de destaque" do produto ou o video de destaque com a capa. */
export type ContentModalMedia = {
  mediaSrc: string;
  mediaType: "image" | "video";
  poster?: string;
  videoOptions?: HeroVideoOptions;
  youtubeId?: string;
};

export type ContentModalStructure = {
  formationCourses: ContentItem[];
  /** Ausente = o modal usa a capa do card (item.image), como antes. */
  media?: ContentModalMedia;
  modules: CourseModule[];
};

export type NavigationItem = {
  href?: string;
  icon: LucideIcon;
  label: string;
};

export type HomeHeroConfig = {
  badge?: string;
  /** Botao do destaque (Area de membros > Destaque). Link interno ("/...") ou https. */
  cta?: {
    href: string;
    label: string;
    target: "same_tab" | "new_tab";
  };
  description?: string;
  enabled?: boolean;
  /** Cor da luz de fundo atras do destaque (#rrggbb). Ausente = automatica, medida na imagem. */
  glowColor?: string;
  /** Imagem (mediaType "image") ou link do video (mediaType "video"). */
  image: string;
  mediaType: "image" | "video";
  /** Capa do video: aparece enquanto carrega e para quem prefere menos movimento. */
  poster?: string;
  purpose: "school-brand" | "editorial-highlight" | "content-highlight";
  title?: string;
  visibility?: {
    badge?: boolean;
    cta?: boolean;
    description?: boolean;
    title?: boolean;
  };
};

export type PlatformBrandingConfig = {
  logoImage: string | null;
  /**
   * Icone da escola (Marca): o circulo das notificacoes que a escola envia. Ausente = o simbolo padrao
   * (SCHOOL_DEFAULT_ICON em src/server/communications/message-meta.ts).
   */
  schoolIcon?: string;
  /** Cantos, botoes e menu da area do aluno (src/lib/member-style.ts). Ausente = padrao discreto. */
  style?: MemberStyleConfig;
};

/** Cantos do banner da pagina do produto: ausente ou "inherit" = segue Marca > Estilo. */
export type ContentPageHeroCorners = "inherit" | "rounded" | "soft";

export type ContentPageHeroConfig = {
  badge?: string;
  corners?: ContentPageHeroCorners;
  ctaHref?: string;
  ctaLabel?: string;
  description?: string;
  mediaSrc: string;
  mediaType: "image" | "video";
  poster?: string;
  title?: string;
  /** Opcoes do video de destaque (arquivo ou YouTube); ausentes = padroes de src/lib/hero-video.ts. */
  videoOptions?: HeroVideoOptions;
  visibility?: {
    badge?: boolean;
    cta?: boolean;
    description?: boolean;
    title?: boolean;
  };
  /** Video de destaque pelo YouTube (id de 11 caracteres); mediaSrc guarda o link canonico de watch. */
  youtubeId?: string;
};

/** Como o video de destaque se comporta; cada chave ausente usa o padrao. */
export type HeroVideoOptions = {
  /** Toca sozinho ao abrir. Desligado: capa com botao de tocar. */
  autoplay?: boolean;
  /** Tenta comecar com som no autoplay; se o navegador bloquear, recomeca sem som. */
  startWithSound?: boolean;
  /** YouTube: recorta as bordas e bloqueia o mouse para a logo e o titulo nao aparecerem. */
  hideBranding?: boolean;
  loop?: boolean;
  /** YouTube: mostra os controles do proprio YouTube (sem recorte, com a logo). */
  nativeControls?: boolean;
  /** Botao nosso de pausar/continuar. */
  pauseButton?: boolean;
  /** Botao nosso de ligar/desligar o som. */
  soundButton?: boolean;
  /** Linha do tempo nossa, com arrasto e tempos. */
  timeline?: boolean;
  /** Controle de volume nosso (deslizante). */
  volumeSlider?: boolean;
};

export type LessonPreview = {
  completed?: boolean;
  description: string;
  duration: string;
  id: string;
  image?: string;
  isSaved?: boolean;
  releaseRule?: ReleaseRuleConfig;
  /** Liberacao calculada no servidor para o aluno; aula nao liberada chega sem `video`. */
  releaseState?: MemberReleaseState;
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
  /** Liberacao calculada no servidor para o aluno da requisicao. */
  releaseState?: MemberReleaseState;
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
  parentFormationId?: string;
};

export type AdminContentAccess = "Liberado" | "Bloqueado" | "Drip" | "Em breve";
export type AdminView =
  | "overview"
  | "students"
  | "catalog"
  | "combos"
  | "structure"
  | "community"
  | "moderation"
  | "ai-agents"
  | "personalization"
  | "integrations";
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

export type AdminHomeSection = HomeSectionConfig & {
  contentCount: number;
  source: string;
};

export type AdminPipelineItem = {
  count: number;
  label: string;
  tone: string;
};

export type AdminProductComboStatus = "active" | "draft" | "paused";

export type AdminProductCombo = {
  cohortName: string;
  createdAt: string;
  description: string;
  id: string;
  name: string;
  productIds: string[];
  studentsCount: number;
  status: AdminProductComboStatus;
  updatedAt?: string;
};

export type AdminCommentStatus = LessonCommentStatus;
export type AdminCommentKind = "comment" | "reply";

export type AdminModerationItem = {
  analysisStatus: "pending" | "processing" | "completed" | "failed";
  authorId?: string;
  authorName: string;
  authorRole: LessonCommentAuthorRole;
  body: string;
  createdAt: string;
  id: string;
  kind: AdminCommentKind;
  lessonId: string;
  lessonTitle: string;
  moderationNote?: string;
  parentAuthorName?: string;
  productId: string;
  productTitle: string;
  reactionCount: number;
  reportCount: number;
  status: AdminCommentStatus;
  updatedAt: string;
};

export type AdminBlockedWordRule = {
  active: boolean;
  createdAt?: string;
  id: string;
  message: string;
  updatedAt?: string;
  word: string;
};

export type AdminIntegrationProvider = "Hotmart" | "Ticto" | "TikTok" | "Kiwify" | "Manual";
export type AdminIntegrationStatus = "not_configured" | "configured" | "needs_attention";

export type AdminIntegrationSetting = {
  events: string[];
  id: string;
  lastSyncAt?: string;
  provider: AdminIntegrationProvider;
  secretStatus: "missing" | "saved";
  status: AdminIntegrationStatus;
  webhookUrl: string;
};

export type AdminAIAgentScope = "comments" | "lesson_tutor" | "global_assistant" | "home_chat";
export type AdminAIAgentStatus = "draft" | "training" | "active" | "paused";

export type AdminAIAgent = {
  autoReply: boolean;
  id: string;
  instructions: string;
  lastTrainedAt?: string;
  name: string;
  productIds: string[];
  scope: AdminAIAgentScope;
  status: AdminAIAgentStatus;
  trainingSources: string[];
};

export type AdminDashboardData = {
  aiAgents: AdminAIAgent[];
  blockedWordRules: AdminBlockedWordRule[];
  branding: PlatformBrandingConfig;
  chartPoints: AdminChartPoint[];
  cohorts: string[];
  combos: AdminProductCombo[];
  contentRecords: AdminContentRecord[];
  courseModules: CourseModule[];
  entitlements: AdminEntitlement[];
  formationCourses: ContentItem[];
  hero: HomeHeroConfig;
  homeRows: HomeRow[];
  homeSectionConfigs: HomeSectionConfig[];
  /** Versao (updated_at) de platform_settings.homeSections lida junto com homeSectionConfigs; null = nunca publicada. */
  homeSectionsUpdatedAt?: string | null;
  homeSections: AdminHomeSection[];
  integrations: AdminIntegrationSetting[];
  metrics: AdminMetric[];
  moderationItems: AdminModerationItem[];
  pipeline: AdminPipelineItem[];
  persistenceProvider: "supabase";
  releaseRules: AdminReleaseRule[];
  sellableProducts: AdminSellableProduct[];
  students: AdminStudent[];
  webhookEvents: AdminWebhookEvent[];
};
