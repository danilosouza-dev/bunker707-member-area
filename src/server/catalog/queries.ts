import "server-only";

// Leituras de Produtos v2 (contratos em ./types.ts). Colunas explicitas, paginacao e contagens por RPC
// (migracao 202610110011), nunca getAdminDashboardData(). Toda leitura e chamada depois de
// requirePageAdmin() na pagina; nao repete o guard. Excluidos (status 'deleted') nunca aparecem.

import { cache } from "react";
import { normalizeLessonVideoConfig } from "@/lib/video-embed";
import { PendingMigrationError, isMissingSchemaObjectError } from "@/server/db/pending-migration";
import { CatalogNotFoundError } from "./errors";
import {
  audienceFromColumns,
  evaluatePublishChecklist,
  formatFromKind,
  releaseRuleToPhrase,
  resolveProductAccent,
  situationFromPublicationStatus,
  type ProductFormat
} from "./model";
import {
  buildModuleTree,
  buildProductHeader,
  countLessonsByOwner,
  countTree,
  coverUrlOf,
  customPurchaseLabelOf,
  formatDurationTotal,
  heroCornersOf,
  heroUrlOf,
  instructorNameOf,
  lessonPositionLabel,
  lessonThumbnailOf,
  mapFormationCourse,
  mapProductListRow,
  neighborLessonIds,
  productFormatOf,
  publishedLessonRows,
  studentLessonPreviewHrefFor,
  thumbnailSizeOf,
  type ProductListRpcRow,
  type ProductRow,
  videoInputOf
} from "./mappers";
import { PRODUCT_LIST_PAGE_SIZE } from "./schemas";
import {
  PRODUCT_UNIVERSE,
  catalogDb,
  countActiveAccess,
  failOnError,
  fetchIncludedCourses,
  fetchLessonCountRows,
  fetchLessonsFor,
  fetchModulesFor,
  fetchParentFormation,
  fetchProductRow,
  fetchProductSettings,
  fetchProductStructure,
  likeContains
} from "./store";
import type {
  FormationCourseItem,
  GetLessonEditorData,
  GetProductAccess,
  GetProductContent,
  GetProductDetails,
  GetProductHeader,
  GetPublishChecklist,
  ListProductOptions,
  ListProducts,
  ProductAccess,
  ProductHeader,
  ProductOption,
  PublishChecklist
} from "./types";

/** Formato -> valores de content_items.kind (Material cobre o "Produto" gravado e o "Material" antigo). */
export function kindsForFormat(format: ProductFormat): string[] {
  switch (format) {
    case "curso":
      return ["Curso"];
    case "formacao":
      return ["Formacao"];
    case "mentoria":
      return ["Mentoria"];
    case "bootcamp":
      return ["Bootcamp"];
    case "material":
      return ["Produto", "Material"];
    default:
      return ["Webinario"];
  }
}

async function callProductList(args: {
  kinds: string[] | null;
  limit: number;
  offset: number;
  search: string | null;
  status: string | null;
}) {
  const { data, error } = await catalogDb().rpc("admin_product_list", {
    p_kinds: args.kinds,
    p_limit: args.limit,
    p_offset: args.offset,
    p_search: args.search,
    p_status: args.status
  });
  failOnError(error, "Lista de produtos");

  return (data ?? []) as ProductListRpcRow[];
}

/**
 * Confere, uma vez por requisicao, se o banco ja tem o que as telas de Produtos v2 usam (coluna
 * content_items.listing e lessons.deleted_at da 202610110010; funcoes da 202610110011). Usado pelas
 * paginas que nao leem nada do banco antes de gravar (Novo produto, Importar): sem a migracao, a
 * pagina mostra o aviso em vez de deixar o produtor preencher um formulario que vai falhar.
 */
export const assertCatalogSchemaReady = cache(async () => {
  const db = catalogDb();
  const [listing, softDelete, rpc] = await Promise.all([
    db.from("content_items").select("listing").limit(1),
    db.from("lessons").select("deleted_at").limit(1),
    db.rpc("admin_product_students_with_access", { p_content_id: "__schema_probe__" })
  ]);

  for (const [error, context] of [
    [listing.error, "content_items.listing"],
    [softDelete.error, "lessons.deleted_at"],
    [rpc.error, "admin_product_students_with_access"]
  ] as const) {
    if (isMissingSchemaObjectError(error)) {
      throw new PendingMigrationError(`Produtos v2 (${context})`, error?.message);
    }

    failOnError(error, `Produtos v2 (${context})`);
  }
});

/* ------------------------------------------------------------------------------------------------
 * Lista
 * ---------------------------------------------------------------------------------------------- */

export const listProducts: ListProducts = async (query) => {
  const pageSize = PRODUCT_LIST_PAGE_SIZE;
  const page = Math.max(1, query.page);
  const filters = {
    kinds: query.format ? kindsForFormat(query.format) : null,
    search: query.q ?? null,
    status: query.situation ?? null
  };
  const hasFilters = Boolean(filters.kinds || filters.search || filters.status);
  const rows = await callProductList({ ...filters, limit: pageSize, offset: (page - 1) * pageSize });
  let total = Number(rows[0]?.total_count ?? 0);

  if (rows.length === 0 && page > 1) {
    // Pagina alem do fim: o total vem da primeira pagina com os mesmos filtros.
    const firstPage = await callProductList({ ...filters, limit: 1, offset: 0 });
    total = Number(firstPage[0]?.total_count ?? 0);
  }

  let totalUnfiltered = total;

  if (hasFilters) {
    const unfiltered = await callProductList({ kinds: null, limit: 1, offset: 0, search: null, status: null });
    totalUnfiltered = Number(unfiltered[0]?.total_count ?? 0);
  }

  return {
    items: rows.flatMap((row) => {
      const item = mapProductListRow(row);
      return item ? [item] : [];
    }),
    page,
    pageSize,
    query,
    total,
    totalUnfiltered
  };
};

/* ------------------------------------------------------------------------------------------------
 * Cabeçalho
 * ---------------------------------------------------------------------------------------------- */

async function loadHeader(productId: string) {
  const row = await fetchProductRow(productId);

  if (!row || !productFormatOf(row)) {
    return null;
  }

  const settings = await fetchProductSettings(productId);
  const parentFormation = await fetchParentFormation(settings);
  const header = buildProductHeader(row, settings, parentFormation);

  return header ? { header, row, settings } : null;
}

export const getProductHeader: GetProductHeader = async (productId) => (await loadHeader(productId))?.header ?? null;

/* ------------------------------------------------------------------------------------------------
 * Formação: cursos incluídos
 * ---------------------------------------------------------------------------------------------- */

async function loadFormationCourseData(formationId: string) {
  const { courses, settings } = await fetchIncludedCourses(formationId);
  const countRows = await fetchLessonCountRows(courses.map((course) => course.id));
  const counts = countLessonsByOwner(countRows.modules, countRows.lessons);
  const items = courses.map((course, index) => mapFormationCourse(course, settings.get(course.id), counts.get(course.id), index + 1));

  return { items, modules: [...counts.values()].reduce((total, count) => total + count.modules, 0) };
}

/** Lista "Cursos desta formação" com aulas publicadas/total de cada curso. */
export async function loadFormationCourses(formationId: string): Promise<FormationCourseItem[]> {
  return (await loadFormationCourseData(formationId)).items;
}

/* ------------------------------------------------------------------------------------------------
 * Aba Conteúdo
 * ---------------------------------------------------------------------------------------------- */

export const getProductContent: GetProductContent = async (productId) => {
  const loaded = await loadHeader(productId);

  if (!loaded) {
    return null;
  }

  if (loaded.header.format === "formacao") {
    const { items, modules } = await loadFormationCourseData(productId);

    return {
      counts: {
        lessons: items.reduce((total, course) => total + course.lessonsTotal, 0),
        modules,
        publishedLessons: items.reduce((total, course) => total + course.lessonsPublished, 0)
      },
      formationCourses: items,
      header: loaded.header,
      modules: [],
      thumbnailSize: thumbnailSizeOf(loaded.settings)
    };
  }

  const { lessons, modules } = await fetchProductStructure(productId);
  const tree = buildModuleTree(modules, lessons);

  return { counts: countTree(tree), formationCourses: null, header: loaded.header, modules: tree, thumbnailSize: thumbnailSizeOf(loaded.settings) };
};

/* ------------------------------------------------------------------------------------------------
 * Painel da aula
 * ---------------------------------------------------------------------------------------------- */

export const getLessonEditorData: GetLessonEditorData = async (productId, lessonId) => {
  const row = await fetchProductRow(productId);

  if (!row || !productFormatOf(row)) {
    return null;
  }

  const { lessons, modules } = await fetchProductStructure(productId);
  const lessonRow = lessons.find((lesson) => lesson.id === lessonId);

  if (!lessonRow) {
    return null;
  }

  const tree = buildModuleTree(modules, lessons);
  const moduleNode = tree.find((module) => module.id === lessonRow.module_id);
  const lessonNode = moduleNode?.lessons.find((lesson) => lesson.id === lessonId);

  if (!moduleNode || !lessonNode) {
    return null;
  }

  const config = normalizeLessonVideoConfig(lessonRow.video_config);
  const situation = situationFromPublicationStatus(row.publication_status);

  return {
    lesson: {
      ...lessonNode,
      description: lessonRow.description ?? "",
      thumbnailUrl: lessonThumbnailOf(lessonRow.image, config),
      videoConfig: config,
      videoInput: videoInputOf(config)
    },
    module: { id: moduleNode.id, position: moduleNode.position, title: moduleNode.title },
    ...neighborLessonIds(tree, lessonId),
    positionLabel: lessonPositionLabel(moduleNode, lessonNode.position, moduleNode.lessons.length),
    product: { id: row.id, situation, title: row.title },
    studentPreviewHref: studentLessonPreviewHrefFor(row.id, moduleNode.id, lessonNode.id)
  };
};

/* ------------------------------------------------------------------------------------------------
 * Aba Detalhes
 * ---------------------------------------------------------------------------------------------- */

/** Aulas que contam para o produto: as proprias e, em Formacao, as dos cursos incluidos. */
async function loadOwnedStructure(productId: string, format: ProductFormat) {
  const ownerIds = [productId];

  if (format === "formacao") {
    const { courses } = await fetchIncludedCourses(productId);
    ownerIds.push(...courses.map((course) => course.id));
  }

  const modules = await fetchModulesFor(ownerIds);
  const lessons = await fetchLessonsFor(modules.map((module) => module.id));

  return { lessons, modules };
}

export const getProductDetails: GetProductDetails = async (productId) => {
  const loaded = await loadHeader(productId);

  if (!loaded) {
    return null;
  }

  const { header, row, settings } = loaded;
  const { lessons, modules } = await loadOwnedStructure(productId, header.format);
  const published = publishedLessonRows(modules, lessons);

  return {
    accent: header.accent,
    coursePresentationMode: settings.coursePresentationMode === "lesson_playlist" ? "lesson_playlist" : "module_cards",
    durationTotalLabel: formatDurationTotal(published.map((lesson) => lesson.duration)),
    header,
    heroCorners: heroCornersOf(settings),
    heroUrl: heroUrlOf(settings),
    instructorName: instructorNameOf(row.instructor),
    level: row.level_label?.trim() || null,
    lockedActionMode: settings.lockedActionMode === "external_link" ? "external_link" : "details_modal",
    shortDescription: row.description ?? "",
    thumbnailSize: thumbnailSizeOf(settings)
  };
};

/* ------------------------------------------------------------------------------------------------
 * Aba Acesso e venda
 * ---------------------------------------------------------------------------------------------- */

async function loadCohorts(productId: string) {
  const { data, error } = await catalogDb().rpc("admin_product_cohorts", { p_content_id: productId });

  if (error) {
    // Turmas sao so leitura nesta aba; sem a RPC (migracao ainda nao aplicada) a lista fica vazia.
    console.error("[catalog] Turmas do produto:", error.message);
    return [];
  }

  return ((data ?? []) as { name: string; students_count: number }[]).map((cohort) => ({
    name: cohort.name,
    studentsCount: Number(cohort.students_count ?? 0)
  }));
}

async function loadCombosFor(productId: string) {
  const db = catalogDb();
  const { data: itemData, error: itemError } = await db.from("product_combo_items").select("combo_id").eq("product_id", productId);
  failOnError(itemError, "Pacotes do produto");

  const comboIds = [...new Set(((itemData ?? []) as { combo_id: string }[]).map((item) => item.combo_id))];

  if (comboIds.length === 0) {
    return [];
  }

  const { data, error } = await db.from("product_combos").select("id,name,status").in("id", comboIds).order("name", { ascending: true });
  failOnError(error, "Pacotes do produto");

  return ((data ?? []) as { id: string; name: string; status: string }[]).map((combo): ProductAccess["combos"][number] => ({
    id: combo.id,
    name: combo.name,
    status: combo.status === "active" || combo.status === "paused" ? combo.status : "draft"
  }));
}

export const getProductAccess: GetProductAccess = async (productId) => {
  const loaded = await loadHeader(productId);

  if (!loaded) {
    return null;
  }

  const { header, row } = loaded;
  const [cohorts, combos, studentsWithAccess] = await Promise.all([
    loadCohorts(productId),
    loadCombosFor(productId),
    countActiveAccess(productId)
  ]);

  return {
    audience: header.audience,
    cohorts,
    combos,
    header,
    maxStudents: typeof row.max_students === "number" && row.max_students > 0 ? row.max_students : null,
    purchaseLabel: customPurchaseLabelOf(row.purchase_label),
    purchaseTarget: row.purchase_target === "new_tab" ? "new_tab" : "same_tab",
    purchaseUrl: row.purchase_url?.trim() || null,
    release: releaseRuleToPhrase(row.release_rule),
    studentsWithAccess
  };
};

/* ------------------------------------------------------------------------------------------------
 * Publicar
 * ---------------------------------------------------------------------------------------------- */

/** Checklist a partir de uma linha ja lida (reusado por publishProduct). */
export async function evaluateChecklistFor(row: ProductRow): Promise<PublishChecklist | null> {
  const format = productFormatOf(row);

  if (!format) {
    return null;
  }

  const { lessons, modules } = await loadOwnedStructure(row.id, format);
  const published = publishedLessonRows(modules, lessons);

  return evaluatePublishChecklist({
    audience: audienceFromColumns({ accessModel: row.access_model, listing: row.listing }),
    format,
    hasCover: Boolean(coverUrlOf(row.image)),
    publishedLessons: published.length,
    publishedLessonsWithoutVideo: published.filter((lesson) => !normalizeLessonVideoConfig(lesson.video_config)).length,
    purchaseUrl: row.purchase_url
  });
}

export const getPublishChecklist: GetPublishChecklist = async (productId) => {
  const row = await fetchProductRow(productId);

  return row ? evaluateChecklistFor(row) : null;
};

/* ------------------------------------------------------------------------------------------------
 * Seletores
 * ---------------------------------------------------------------------------------------------- */

export const listProductOptions: ListProductOptions = async (options) => {
  const db = catalogDb();
  let query = db
    .from("content_items")
    .select("id,title,kind,image,publication_status")
    .neq("kind", "Aula")
    .not("bucket", "in", PRODUCT_UNIVERSE.excludedBuckets)
    .or(PRODUCT_UNIVERSE.notIncluded)
    .order("title", { ascending: true })
    .limit(200);

  if (options?.formats?.length) {
    query = query.in("kind", options.formats.flatMap(kindsForFormat));
  }

  const search = options?.q?.trim();

  if (search) {
    query = query.ilike("title", likeContains(search.slice(0, 80)));
  }

  const { data, error } = await query;
  failOnError(error, "Produtos para escolher");

  const rows = (data ?? []) as Pick<ProductRow, "id" | "image" | "kind" | "publication_status" | "title">[];
  const ids = rows.map((row) => row.id);
  const accents = new Map<string, unknown>();

  if (ids.length > 0) {
    const { data: settingsData, error: settingsError } = await db
      .from("content_page_settings")
      .select("content_id,accent:settings->>accent")
      .in("content_id", ids);
    failOnError(settingsError, "Cores dos produtos");

    for (const setting of (settingsData ?? []) as { accent: unknown; content_id: string }[]) {
      accents.set(setting.content_id, setting.accent);
    }
  }

  return rows.flatMap((row): ProductOption[] => {
    const format = formatFromKind(row.kind);

    return format
      ? [{
          accent: resolveProductAccent(row.id, accents.get(row.id)),
          coverUrl: coverUrlOf(row.image),
          format,
          id: row.id,
          situation: situationFromPublicationStatus(row.publication_status),
          title: row.title
        }]
      : [];
  });
};

/** Cabecalho a partir de uma linha ja lida ou recem-gravada (Server Actions devolvem `{ header }`). */
export async function headerForRow(row: ProductRow): Promise<ProductHeader> {
  const settings = await fetchProductSettings(row.id);
  const parentFormation = await fetchParentFormation(settings);
  const header = buildProductHeader(row, settings, parentFormation);

  if (!header) {
    throw new CatalogNotFoundError("Não encontramos este produto. Ele pode ter sido excluído.");
  }

  return header;
}
