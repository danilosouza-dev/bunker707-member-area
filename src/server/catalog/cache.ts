import "server-only";

import { revalidateTag, unstable_cache, updateTag } from "next/cache";
import type { LessonVideoConfig } from "@/lib/platform-types";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import {
  CATALOG_CACHE_KEY,
  CATALOG_TAG,
  planCatalogInvalidation,
  type CatalogInvalidationSource
} from "@/server/catalog/cache-policy";
import type {
  CatalogLessonRecord,
  CatalogModuleRecord,
  CatalogProductRecord,
  CatalogSnapshot
} from "@/server/catalog/types";

export { CATALOG_TAG } from "@/server/catalog/cache-policy";

// Cache do catalogo publicado (docs/17 §2.3), fase 1: unstable_cache por tag, sem `cacheComponents`.
// A area do aluno le as linhas publicadas pelo cache proprio do platform-store, com a mesma tag (desde
// 19/10/2026); este snapshot ainda nao tem leitor. TODA mutacao de catalogo chama invalidateCatalog().
//
// Restricoes do unstable_cache (Next 16.4): a funcao nao pode ler cookies/headers nem chamar
// revalidateTag/updateTag; o resultado e gravado em JSON. Por isso o loader usa o cliente de servico
// (sem sessao) e devolve so dados serializaveis do catalogo publicado, igual para todos os alunos.

type ContentRow = {
  access_model: string | null;
  bucket: string;
  commerce_scope: string | null;
  description: string | null;
  id: string;
  image: string;
  kind: string;
  listing: string | null;
  purchase_label: string | null;
  purchase_target: string | null;
  purchase_url: string | null;
  release_rule: unknown;
  sort_order: number;
  title: string;
  updated_at: string;
};

type ModuleRow = {
  description: string;
  id: string;
  image: string;
  owner_id: string | null;
  release_rule: unknown;
  sort_order: number;
  title: string;
};

type LessonRow = {
  description: string;
  duration: string;
  id: string;
  image: string | null;
  module_id: string;
  release_rule: unknown;
  sort_order: number;
  title: string;
  video_config: LessonVideoConfig | null;
};

const contentColumns =
  "id,bucket,kind,commerce_scope,access_model,listing,title,description,image,purchase_url,purchase_label,purchase_target,release_rule,sort_order,updated_at";
const moduleColumns = "id,owner_id,title,description,image,release_rule,sort_order";
const lessonColumns = "id,module_id,title,description,duration,image,video_config,release_rule,sort_order";

function fail(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

async function loadCatalogSnapshot(): Promise<CatalogSnapshot> {
  const supabase = getSupabaseAdminClient();
  const [contentResult, settingsResult, modulesResult, lessonsResult] = await Promise.all([
    supabase
      .from("content_items")
      .select(contentColumns)
      .eq("publication_status", "published")
      .order("sort_order", { ascending: true }),
    supabase.from("content_page_settings").select("content_id,settings"),
    supabase
      .from("course_modules")
      .select(moduleColumns)
      .eq("status", "published")
      .order("sort_order", { ascending: true }),
    supabase
      .from("lessons")
      .select(lessonColumns)
      .eq("status", "published")
      .order("sort_order", { ascending: true })
  ]);

  fail(contentResult.error, "Catalogo: produtos");
  fail(settingsResult.error, "Catalogo: configuracoes de pagina");
  fail(modulesResult.error, "Catalogo: modulos");
  fail(lessonsResult.error, "Catalogo: aulas");

  const productRows = (contentResult.data ?? []) as ContentRow[];
  const publishedIds = new Set(productRows.map((row) => row.id));
  const pageSettings: CatalogSnapshot["pageSettings"] = {};

  for (const row of (settingsResult.data ?? []) as { content_id: string; settings: unknown }[]) {
    if (publishedIds.has(row.content_id) && row.settings && typeof row.settings === "object") {
      pageSettings[row.content_id] = row.settings as Record<string, unknown>;
    }
  }

  const products: CatalogProductRecord[] = productRows.map((row) => {
    const parentFormationId = pageSettings[row.id]?.parentFormationId;

    return {
      accessModel: row.access_model === "free" ? "free" : "closed",
      bucket: row.bucket,
      commerceScope: row.commerce_scope,
      description: row.description,
      id: row.id,
      image: row.image,
      kind: row.kind,
      listing: row.listing === "hidden" ? "hidden" : "listed",
      parentFormationId: typeof parentFormationId === "string" && parentFormationId ? parentFormationId : null,
      purchaseLabel: row.purchase_label,
      purchaseTarget: row.purchase_target,
      purchaseUrl: row.purchase_url,
      releaseRule: row.release_rule ?? null,
      sortOrder: row.sort_order,
      title: row.title,
      updatedAt: row.updated_at
    };
  });

  const modules: CatalogModuleRecord[] = ((modulesResult.data ?? []) as ModuleRow[])
    .filter((row) => row.owner_id === null || publishedIds.has(row.owner_id))
    .map((row) => ({
      description: row.description,
      id: row.id,
      image: row.image,
      ownerId: row.owner_id,
      releaseRule: row.release_rule ?? null,
      sortOrder: row.sort_order,
      title: row.title
    }));
  const moduleIds = new Set(modules.map((module) => module.id));
  const lessons: CatalogLessonRecord[] = ((lessonsResult.data ?? []) as LessonRow[])
    .filter((row) => moduleIds.has(row.module_id))
    .map((row) => ({
      description: row.description,
      duration: row.duration,
      id: row.id,
      image: row.image,
      moduleId: row.module_id,
      releaseRule: row.release_rule ?? null,
      sortOrder: row.sort_order,
      title: row.title,
      videoConfig: row.video_config ?? null
    }));

  return { generatedAt: new Date().toISOString(), lessons, modules, pageSettings, products };
}

/**
 * Catalogo publicado em cache ate a proxima invalidacao. Depende da coluna content_items.listing
 * (migracao da frente A, 202610110010); nao chame antes de a migracao estar aplicada.
 */
export const getCatalogCached = unstable_cache(loadCatalogSnapshot, [...CATALOG_CACHE_KEY], {
  tags: [CATALOG_TAG]
});

/**
 * Unica forma de invalidar o catalogo. Chame depois de gravar, nunca dentro de uma funcao em cache.
 * - Server Action: invalidateCatalog({ from: "action" }) -> updateTag("catalog").
 * - Rota REST legada, job, webhook: invalidateCatalog({ from: "route" }) -> revalidateTag("catalog", "max").
 */
export function invalidateCatalog({ from }: { from: CatalogInvalidationSource }) {
  const plan = planCatalogInvalidation(from);

  if (plan.api === "updateTag") {
    updateTag(plan.tag);
    return;
  }

  revalidateTag(plan.tag, plan.profile);
}
