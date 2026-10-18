// Contratos de Produtos da fase 1 (docs/17 §1.6). So tipos: as frentes implementam as funcoes nos
// arquivos indicados em cada assinatura e as telas importam daqui (`import type`).
//
// Convencoes:
// - Leituras (queries.ts, "server-only") devolvem DTOs serializaveis prontos para a tela: rotulos em
//   portugues ja resolvidos, datas ISO, nada de linha crua do banco.
// - Mutacoes sao Server Actions ("use server") que recebem `unknown`, validam com o schema de
//   ./schemas.ts dentro de runAdminAction (src/server/actions/run-action.ts) e devolvem
//   ActionResult<T> com so a entidade alterada.
// - Toda mutacao de produto, modulo, aula, capa, ordem, formacao ou pacote chama
//   invalidateCatalog({ from: "action" }) (./cache.ts) depois de gravar.

import type { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import type { HeroVideoOptions, LessonVideoConfig, LessonVideoProvider } from "@/lib/platform-types";
import type { VideoDetection } from "@/lib/video-detect";
import type {
  YouTubeCourseImportCommitInput,
  YouTubeCourseImportModuleRange,
  YouTubeCourseImportPreview,
  YouTubeCourseOrganizationMode
} from "@/lib/youtube-course-import";
import type {
  LessonStatus,
  ProductAccent,
  ProductAudience,
  ProductFormat,
  ProductListing,
  ProductSituation,
  PublishChecklist,
  ReleasePhrase
} from "./model";
import type {
  comboSchema,
  createLessonsSchema,
  createModuleSchema,
  createProductSchema,
  deleteComboSchema,
  deleteProductSchema,
  formationCourseSchema,
  productListQuerySchema,
  publishProductSchema,
  renameProductSchema,
  reorderContentSchema,
  reorderFormationCoursesSchema,
  restoreStructureSchema,
  setLessonsStatusSchema,
  setModuleCoverSchema,
  setProductHeroCornersSchema,
  setProductHeroVideoOptionsSchema,
  setProductHeroVideoSchema,
  setProductImageSchema,
  setProductSituationSchema,
  softDeleteStructureSchema,
  updateLessonSchema,
  updateModuleSchema,
  updateProductAccessSchema,
  updateProductDetailsSchema,
  videoPreviewSchema
} from "./schemas";

export type {
  LessonStatus,
  ProductAccent,
  ProductAudience,
  ProductFormat,
  ProductListing,
  ProductSituation,
  PublishChecklist,
  ReleasePhrase
};

/* ================================================================================================
 * Entradas (z.input = o que a tela envia; z.output = o que o servidor recebe depois do parse)
 * ============================================================================================== */

export type ProductListQuery = z.output<typeof productListQuerySchema>;
export type CreateProductInput = z.input<typeof createProductSchema>;
export type RenameProductInput = z.input<typeof renameProductSchema>;
export type UpdateProductDetailsInput = z.input<typeof updateProductDetailsSchema>;
export type UpdateProductAccessInput = z.input<typeof updateProductAccessSchema>;
export type SetProductImageInput = z.input<typeof setProductImageSchema>;
export type SetProductHeroCornersInput = z.input<typeof setProductHeroCornersSchema>;
export type SetProductHeroVideoInput = z.input<typeof setProductHeroVideoSchema>;
export type SetProductHeroVideoOptionsInput = z.input<typeof setProductHeroVideoOptionsSchema>;
export type PublishProductInput = z.input<typeof publishProductSchema>;
export type SetProductSituationInput = z.input<typeof setProductSituationSchema>;
export type DeleteProductInput = z.input<typeof deleteProductSchema>;
export type CreateModuleInput = z.input<typeof createModuleSchema>;
export type UpdateModuleInput = z.input<typeof updateModuleSchema>;
export type CreateLessonsInput = z.input<typeof createLessonsSchema>;
export type UpdateLessonInput = z.input<typeof updateLessonSchema>;
export type SetLessonsStatusInput = z.input<typeof setLessonsStatusSchema>;
export type SoftDeleteStructureInput = z.input<typeof softDeleteStructureSchema>;
export type RestoreStructureInput = z.input<typeof restoreStructureSchema>;
export type ReorderContentInput = z.input<typeof reorderContentSchema>;
export type FormationCourseInput = z.input<typeof formationCourseSchema>;
export type ReorderFormationCoursesInput = z.input<typeof reorderFormationCoursesSchema>;
export type ComboInput = z.input<typeof comboSchema>;
export type DeleteComboInput = z.input<typeof deleteComboSchema>;
export type VideoPreviewInput = z.input<typeof videoPreviewSchema>;
export type SetModuleCoverInput = z.input<typeof setModuleCoverSchema>;

/* ================================================================================================
 * Leituras (DTOs)
 * ============================================================================================== */

export type ProductListItem = {
  accent: ProductAccent;
  audience: ProductAudience;
  audienceLabel: string;
  /** "Em breve" calculado (isComingSoonForVisitors); chip extra ao lado da Situação. */
  comingSoon: boolean;
  coverUrl: string | null;
  format: ProductFormat;
  formatLabel: string;
  id: string;
  lessonsPublished: number;
  lessonsTotal: number;
  situation: ProductSituation;
  situationLabel: string;
  /** Acessos ativos agora (entitlements ativos dentro da janela). */
  studentsWithAccess: number;
  /** "Estudando (7 d)": null ate existirem eventos de aula (fase 3); a tela mostra "—". */
  studyingLast7d: number | null;
  title: string;
  updatedAt: string;
};

export type ProductListPage = {
  items: ProductListItem[];
  page: number;
  pageSize: number;
  query: ProductListQuery;
  /** Total com os filtros aplicados (para "N produtos" e paginacao). */
  total: number;
  /** Total sem filtros: distingue "nenhum produto ainda" de "nenhum resultado para o filtro". */
  totalUnfiltered: number;
};

/** Cabecalho fixo da pagina do produto (layout de /admin/produtos/[id]). */
export type ProductHeader = {
  accent: ProductAccent;
  audience: ProductAudience;
  coverUrl: string | null;
  format: ProductFormat;
  formatLabel: string;
  id: string;
  /** Curso dentro de uma formacao: "Produtos / Formação X / Curso Y". */
  parentFormation: { id: string; title: string } | null;
  situation: ProductSituation;
  situationLabel: string;
  /** /conteudo/{id}?accessPreview=producer (rascunho ainda nao abre na area do aluno; ver plano). */
  studentPreviewHref: string;
  title: string;
  updatedAt: string;
};

export type LessonVideoSummary = {
  label: string;
  provider: LessonVideoProvider;
};

export type LessonNode = {
  durationLabel: string | null;
  id: string;
  moduleId: string;
  /** Posicao 1..n dentro do modulo. */
  position: number;
  release: ReleasePhrase;
  releaseLabel: string;
  status: LessonStatus;
  title: string;
  updatedAt: string;
  video: LessonVideoSummary | null;
};

export type ModuleNode = {
  /**
   * course_modules.image: a capa do card do modulo (pagina do curso e fileira de modulos da home).
   * O modulo nasce com uma copia da capa do produto; null = sem imagem.
   */
  coverUrl: string | null;
  id: string;
  lessons: LessonNode[];
  position: number;
  release: ReleasePhrase;
  releaseLabel: string;
  title: string;
  updatedAt: string;
};

export type FormationCourseItem = {
  accent: ProductAccent;
  coverUrl: string | null;
  id: string;
  lessonsPublished: number;
  lessonsTotal: number;
  position: number;
  situation: ProductSituation;
  situationLabel: string;
  title: string;
};

/** Aba Conteúdo. Para Formação, `modules` vem vazio e `formationCourses` traz os cursos. */
export type ProductContent = {
  counts: { lessons: number; modules: number; publishedLessons: number };
  formationCourses: FormationCourseItem[] | null;
  header: ProductHeader;
  modules: ModuleNode[];
};

/** Painel da aula (?aula=<id> na aba Conteúdo, ou /admin/produtos/[id]/aulas/[lessonId]). */
export type LessonEditorData = {
  lesson: LessonNode & {
    description: string;
    thumbnailUrl: string | null;
    videoConfig: LessonVideoConfig | null;
    /** Texto para preencher "Cole o link do vídeo" (url ou src do embed). */
    videoInput: string;
  };
  module: { id: string; position: number; title: string };
  nextLessonId: string | null;
  /** "Módulo 1, aula 1 de 4". */
  positionLabel: string;
  previousLessonId: string | null;
  product: { id: string; situation: ProductSituation; title: string };
  studentPreviewHref: string;
};

/** Aba Detalhes. */
export type ProductDetails = {
  accent: ProductAccent;
  coursePresentationMode: "module_cards" | "lesson_playlist";
  /** Soma das duracoes das aulas publicadas, ex.: "3 h 20 min"; null quando nao ha duracao. */
  durationTotalLabel: string | null;
  header: ProductHeader;
  heroCorners: ProductHeroCorners;
  heroUrl: string | null;
  /** YouTube ou arquivo direto; null sem video de destaque. */
  heroVideoKind: "file" | "youtube" | null;
  /** Opcoes do video de destaque, ja com os padroes. */
  heroVideoOptions: Required<HeroVideoOptions>;
  /** Link do video de destaque (YouTube canonico ou arquivo .mp4/.webm/.mov); null = destaque so com imagem. */
  heroVideoUrl: string | null;
  instructorName: string | null;
  level: string | null;
  lockedActionMode: "details_modal" | "external_link";
  shortDescription: string;
};

export type ProductCohortSummary = { name: string; studentsCount: number };

/** Aba Acesso e venda. */
export type ProductAccess = {
  audience: ProductAudience;
  cohorts: ProductCohortSummary[];
  combos: { id: string; name: string; status: "active" | "draft" | "paused" }[];
  header: ProductHeader;
  /** Codigo do produto na Hotmart; a venda aprovada com esse codigo libera o produto. */
  hotmartProductId: string | null;
  maxStudents: number | null;
  purchaseLabel: string | null;
  purchaseTarget: "same_tab" | "new_tab";
  purchaseUrl: string | null;
  release: ReleasePhrase;
  studentsWithAccess: number;
  /** Codigo do produto na Ticto; mesma regra, para vendas pela Ticto. */
  tictoProductId: string | null;
};

export type ComboListItem = {
  cohortName: string;
  description: string;
  /** Codigo do pacote na Hotmart; a venda aprovada com esse codigo libera todos os produtos. */
  hotmartProductId: string | null;
  id: string;
  name: string;
  products: { accent: ProductAccent; coverUrl: string | null; id: string; title: string }[];
  status: "active" | "draft" | "paused";
  /** Codigo do pacote na Ticto; mesma regra, para vendas pela Ticto. */
  tictoProductId: string | null;
  updatedAt: string;
};

/** Opcao de produto para seletores (pacotes, "Adicionar curso existente", filtro de Comunidade). */
export type ProductOption = {
  accent: ProductAccent;
  coverUrl: string | null;
  format: ProductFormat;
  id: string;
  situation: ProductSituation;
  title: string;
};

export type VideoPreview = {
  detection: VideoDetection;
  durationLabel: string | null;
  suggestedTitle: string | null;
  thumbnailUrl: string | null;
};

/* ================================================================================================
 * Resultados de mutacao
 * ============================================================================================== */

export type CreatedProduct = { href: string; id: string };
export type ProductSaved = { header: ProductHeader };
export type ProductImageSaved = { slot: "cover" | "hero"; updatedAt: string; url: string | null };
/** Cantos do banner da pagina do produto; "inherit" = segue Marca > Estilo. */
export type ProductHeroCorners = "inherit" | "rounded" | "soft";
export type ProductHeroCornersSaved = { corners: ProductHeroCorners; updatedAt: string };
export type ProductHeroVideoSaved = { updatedAt: string; videoKind: "file" | "youtube" | null; videoUrl: string | null };
export type ProductHeroVideoOptionsSaved = { options: Required<HeroVideoOptions>; updatedAt: string };
/** Capa do modulo gravada (setModuleCover, src/server/catalog/module-cover-actions.ts). */
export type ModuleCoverSaved = { coverUrl: string | null; id: string; updatedAt: string; usesProductCover: boolean };
export type ProductPublished = { checklist: PublishChecklist; header: ProductHeader; published: boolean };
export type StructureDeleted = { items: { id: string; previousStatus: LessonStatus }[]; kind: "module" | "lesson" };
export type ContentReordered = { modules: ModuleNode[] };

/* ================================================================================================
 * Cache do catalogo (./cache.ts)
 * ============================================================================================== */

export type CatalogProductRecord = {
  accessModel: "closed" | "free";
  bucket: string;
  commerceScope: string | null;
  description: string | null;
  id: string;
  image: string;
  kind: string;
  listing: ProductListing;
  parentFormationId: string | null;
  purchaseLabel: string | null;
  purchaseTarget: string | null;
  purchaseUrl: string | null;
  releaseRule: unknown;
  sortOrder: number;
  title: string;
  updatedAt: string;
};

export type CatalogModuleRecord = {
  description: string;
  id: string;
  image: string;
  ownerId: string | null;
  releaseRule: unknown;
  sortOrder: number;
  title: string;
};

export type CatalogLessonRecord = {
  description: string;
  duration: string;
  id: string;
  image: string | null;
  moduleId: string;
  releaseRule: unknown;
  sortOrder: number;
  title: string;
  videoConfig: LessonVideoConfig | null;
};

/** Catalogo publicado, igual para todos os alunos. Serializavel (unstable_cache grava em JSON). */
export type CatalogSnapshot = {
  generatedAt: string;
  lessons: CatalogLessonRecord[];
  modules: CatalogModuleRecord[];
  pageSettings: Record<string, Record<string, unknown>>;
  products: CatalogProductRecord[];
};

/* ================================================================================================
 * Assinaturas: leituras (frente A, src/server/catalog/queries.ts, "server-only")
 * Toda leitura e chamada depois de requirePageAdmin() na pagina; nao repete o guard.
 * ============================================================================================== */

/** `scope`: so estes produtos (Professor); null ou ausente = todos. */
export type ListProducts = (query: ProductListQuery, scope?: readonly string[] | null) => Promise<ProductListPage>;
/** null = produto inexistente (a pagina chama notFound()). Excluidos nunca aparecem. */
export type GetProductHeader = (productId: string) => Promise<ProductHeader | null>;
export type GetProductContent = (productId: string) => Promise<ProductContent | null>;
export type GetLessonEditorData = (productId: string, lessonId: string) => Promise<LessonEditorData | null>;
export type GetProductDetails = (productId: string) => Promise<ProductDetails | null>;
export type GetProductAccess = (productId: string) => Promise<ProductAccess | null>;
export type GetPublishChecklist = (productId: string) => Promise<PublishChecklist | null>;
/** Produtos para seletores; `formats` filtra (ex.: ["curso"] em "Adicionar curso existente"). */
export type ListProductOptions = (options?: { formats?: ProductFormat[]; q?: string }) => Promise<ProductOption[]>;
/** Frente E, src/server/catalog/combos.ts. */
export type ListCombos = () => Promise<ComboListItem[]>;

/* ================================================================================================
 * Assinaturas: Server Actions (todas recebem `unknown` e validam com o schema homonimo)
 * ============================================================================================== */

/** Frente A, src/server/catalog/product-actions.ts. Acao de papel entre colchetes. */
export type CreateProductAction = (input: CreateProductInput) => Promise<ActionResult<CreatedProduct>>; // [catalog.write]
export type RenameProductAction = (input: RenameProductInput) => Promise<ActionResult<ProductSaved>>; // [catalog.write]
export type UpdateProductDetailsAction = (input: UpdateProductDetailsInput) => Promise<ActionResult<ProductSaved>>; // [catalog.write]
export type UpdateProductAccessAction = (input: UpdateProductAccessInput) => Promise<ActionResult<ProductSaved>>; // [catalog.write]
export type SetProductImageAction = (input: SetProductImageInput) => Promise<ActionResult<ProductImageSaved>>; // [catalog.write]
export type SetProductHeroCornersAction = (input: SetProductHeroCornersInput) => Promise<ActionResult<ProductHeroCornersSaved>>; // [catalog.write]
export type SetProductHeroVideoAction = (input: SetProductHeroVideoInput) => Promise<ActionResult<ProductHeroVideoSaved>>; // [catalog.write]
export type SetProductHeroVideoOptionsAction = (input: SetProductHeroVideoOptionsInput) => Promise<ActionResult<ProductHeroVideoOptionsSaved>>; // [catalog.write]
export type PublishProductAction = (input: PublishProductInput) => Promise<ActionResult<ProductPublished>>; // [catalog.publish]
export type SetProductSituationAction = (input: SetProductSituationInput) => Promise<ActionResult<ProductSaved>>; // [catalog.publish]
export type DeleteProductAction = (input: DeleteProductInput) => Promise<ActionResult<{ id: string }>>; // [catalog.delete]
export type LoadPublishChecklistAction = (input: { id: string }) => Promise<ActionResult<PublishChecklist>>; // [catalog.publish]

/** Frente A, src/server/catalog/content-actions.ts. */
export type CreateModuleAction = (input: CreateModuleInput) => Promise<ActionResult<ModuleNode>>; // [catalog.write]
export type UpdateModuleAction = (input: UpdateModuleInput) => Promise<ActionResult<ModuleNode>>; // [catalog.write]
export type CreateLessonsAction = (input: CreateLessonsInput) => Promise<ActionResult<{ lessons: LessonNode[]; skipped: number }>>; // [catalog.write]
export type UpdateLessonAction = (input: UpdateLessonInput) => Promise<ActionResult<LessonNode>>; // [catalog.write]
export type SetLessonsStatusAction = (input: SetLessonsStatusInput) => Promise<ActionResult<{ ids: string[]; status: LessonStatus }>>; // [catalog.write]
export type SoftDeleteStructureAction = (input: SoftDeleteStructureInput) => Promise<ActionResult<StructureDeleted>>; // [catalog.write]
export type RestoreStructureAction = (input: RestoreStructureInput) => Promise<ActionResult<{ ids: string[] }>>; // [catalog.write]
export type ReorderContentAction = (input: ReorderContentInput) => Promise<ActionResult<ContentReordered>>; // [catalog.write]
export type PreviewVideoAction = (input: VideoPreviewInput) => Promise<ActionResult<VideoPreview>>; // [catalog.write]

/** Frente A, src/server/catalog/formation-actions.ts. */
export type AddCourseToFormationAction = (input: FormationCourseInput) => Promise<ActionResult<FormationCourseItem[]>>; // [catalog.write]
export type RemoveCourseFromFormationAction = (input: FormationCourseInput) => Promise<ActionResult<FormationCourseItem[]>>; // [catalog.write]
export type ReorderFormationCoursesAction = (input: ReorderFormationCoursesInput) => Promise<ActionResult<FormationCourseItem[]>>; // [catalog.write]

/** Frente E, src/server/catalog/combo-actions.ts. */
export type SaveComboAction = (input: ComboInput) => Promise<ActionResult<ComboListItem>>; // [catalog.write]
export type DeleteComboAction = (input: DeleteComboInput) => Promise<ActionResult<{ id: string }>>; // [catalog.write]

/** Frente A, src/server/catalog/import-actions.ts. A tela de importar (frente B) so usa estas duas. */
export type PreviewPlaylistInput = { playlistUrl: string };
export type ImportPlaylistInput = YouTubeCourseImportCommitInput;
export type PlaylistImported = {
  courseId: string;
  /** /admin/produtos/{courseId} */
  href: string;
  lessonCount: number;
  moduleCount: number;
  warnings: string[];
};
/** Curso que ja nasceu desta playlist: importar de novo sobrescreveria o que o produtor fez nele. */
export type ImportedPlaylistCourse = { href: string; id: string; title: string };
export type PlaylistPreview = YouTubeCourseImportPreview & { existingCourse: ImportedPlaylistCourse | null };
export type PreviewPlaylistAction = (input: PreviewPlaylistInput) => Promise<ActionResult<PlaylistPreview>>; // [catalog.write]
export type ImportPlaylistAction = (input: ImportPlaylistInput) => Promise<ActionResult<PlaylistImported>>; // [catalog.write]

/** Reorganizar a previa sem ir ao servidor: rebuildYouTubeCoursePreviewWithRanges (src/lib/youtube-course-import.ts). */
export type PlaylistModuleRanges = YouTubeCourseImportModuleRange[];
export type PlaylistOrganizationMode = YouTubeCourseOrganizationMode;

/* ================================================================================================
 * Acréscimos da frente A (fase 1)
 * ============================================================================================== */

/**
 * Entrada aceita por importPlaylist: o contrato legado + `audience` opcional ("Quem pode ver"), que
 * prevalece sobre `accessModel` e e o unico jeito de importar ja como "Oculto por enquanto".
 */
export type ImportPlaylistActionInput = ImportPlaylistInput & { audience?: ProductAudience };
