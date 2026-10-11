import "server-only";

// Leitura da busca global do admin (Cmd/Ctrl+K): produtos, modulos e aulas pelo nome, 5 de cada.
// Chamada so pela Server Action searchAdmin (src/server/admin/search-actions.ts), que ja passou pelo
// guard de papel. Colunas explicitas; excluidos (status 'deleted') nunca aparecem.

import {
  ADMIN_SEARCH_GROUP_LIMIT,
  buildAdminLessonHref,
  buildAdminModuleHref,
  buildAdminProductHref,
  formatAdminLessonMeta,
  type AdminSearchResults
} from "@/components/admin/v2/search-model";
import { PRODUCT_FORMAT_LABELS, formatFromKind } from "@/server/catalog/model";
import { PRODUCT_UNIVERSE, catalogDb, failOnError, likeContains } from "@/server/catalog/store";

type ProductHitRow = { id: string; kind: string; title: string };
type ModuleHitRow = { id: string; owner_id: string | null; title: string };
type LessonHitRow = { id: string; module_id: string; title: string };

async function findProducts(pattern: string) {
  const { data, error } = await catalogDb()
    .from("content_items")
    .select("id,title,kind")
    .neq("kind", "Aula")
    .not("bucket", "in", PRODUCT_UNIVERSE.excludedBuckets)
    .or(PRODUCT_UNIVERSE.notIncluded)
    .ilike("title", pattern)
    .order("title", { ascending: true })
    .limit(ADMIN_SEARCH_GROUP_LIMIT * 2);
  failOnError(error, "Busca de produtos");

  return ((data ?? []) as ProductHitRow[]).flatMap((row) => {
    const format = formatFromKind(row.kind);

    return format ? [{ href: buildAdminProductHref(row.id), id: row.id, meta: PRODUCT_FORMAT_LABELS[format], title: row.title }] : [];
  });
}

async function findModules(pattern: string) {
  const { data, error } = await catalogDb()
    .from("course_modules")
    .select("id,owner_id,title")
    .ilike("title", pattern)
    .neq("status", "deleted")
    .order("title", { ascending: true })
    .limit(ADMIN_SEARCH_GROUP_LIMIT);
  failOnError(error, "Busca de módulos");

  return ((data ?? []) as ModuleHitRow[]).filter((row) => Boolean(row.owner_id));
}

async function findLessons(pattern: string) {
  const { data, error } = await catalogDb()
    .from("lessons")
    .select("id,module_id,title")
    .ilike("title", pattern)
    .neq("status", "deleted")
    .order("title", { ascending: true })
    .limit(ADMIN_SEARCH_GROUP_LIMIT);
  failOnError(error, "Busca de aulas");

  return (data ?? []) as LessonHitRow[];
}

async function fetchModulesById(ids: readonly string[]) {
  if (ids.length === 0) {
    return [];
  }

  const { data, error } = await catalogDb().from("course_modules").select("id,owner_id,title").in("id", [...ids]);
  failOnError(error, "Módulos da busca");

  return (data ?? []) as ModuleHitRow[];
}

async function fetchProductTitles(ids: readonly string[]) {
  if (ids.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await catalogDb().from("content_items").select("id,title").in("id", [...ids]);
  failOnError(error, "Produtos da busca");

  return new Map(((data ?? []) as { id: string; title: string }[]).map((row) => [row.id, row.title]));
}

/** Produtos, modulos e aulas cujo nome contem o texto (sem diferenciar maiusculas). */
export async function searchAdminCatalog(query: string): Promise<AdminSearchResults> {
  const pattern = likeContains(query);
  const [products, modules, lessons] = await Promise.all([findProducts(pattern), findModules(pattern), findLessons(pattern)]);

  const lessonModules = await fetchModulesById([...new Set(lessons.map((lesson) => lesson.module_id))]);
  const moduleById = new Map(lessonModules.map((row) => [row.id, row]));
  const ownerIds = new Set<string>();

  for (const row of [...modules, ...lessonModules]) {
    if (row.owner_id) {
      ownerIds.add(row.owner_id);
    }
  }

  const productTitles = await fetchProductTitles([...ownerIds]);

  return {
    lessons: lessons.flatMap((lesson) => {
      const parent = moduleById.get(lesson.module_id);

      if (!parent?.owner_id) {
        return [];
      }

      return [
        {
          href: buildAdminLessonHref(parent.owner_id, lesson.id),
          id: lesson.id,
          meta: formatAdminLessonMeta(productTitles.get(parent.owner_id), parent.title),
          title: lesson.title
        }
      ];
    }),
    modules: modules.flatMap((row) =>
      row.owner_id
        ? [{ href: buildAdminModuleHref(row.owner_id), id: row.id, meta: productTitles.get(row.owner_id) ?? "", title: row.title }]
        : []
    ),
    products: products.slice(0, ADMIN_SEARCH_GROUP_LIMIT)
  };
}
