import "server-only";

// Acesso ao banco de Produtos v2: leituras com colunas explicitas e escritas de UMA entidade por vez
// (docs/13: "Escritas devem ser granulares"). Nunca readAdminDatabase/upsertRows de tabela inteira.
// Usado por queries.ts e pelas Server Actions desta pasta.

import { toDbError } from "@/server/db/pending-migration";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { CatalogConflictError, CatalogNotFoundError } from "./errors";
import {
  LESSON_COLUMNS,
  MODULE_COLUMNS,
  PRODUCT_COLUMNS,
  parentFormationIdOf,
  type LessonRow,
  type ModuleRow,
  type ProductRow,
  type ProductSettings
} from "./mappers";
import { lessonCountLabel } from "./rules";

export type CatalogDb = ReturnType<typeof getSupabaseAdminClient>;

export function catalogDb(): CatalogDb {
  return getSupabaseAdminClient();
}

type DbError = { code?: string; message: string } | null;

/** Erro de banco: objeto ainda inexistente (migracao pendente) vira PendingMigrationError. */
export function failOnError(error: DbError, context: string) {
  if (error) {
    throw toDbError(error, context);
  }
}

/** Universo de "produto" para seletores: sem cursos incluidos, sem "Aula", sem buckets de demonstracao. */
export const PRODUCT_UNIVERSE = {
  excludedBuckets: "(continue_watching,recent_lessons)",
  notIncluded: "commerce_scope.is.null,commerce_scope.neq.included_content"
} as const;

/** Escapa %, _ e \ para um ilike de "contem". */
export function likeContains(value: string) {
  return `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/* ------------------------------------------------------------------------------------------------
 * Produto
 * ---------------------------------------------------------------------------------------------- */

export async function fetchProductRow(productId: string, db = catalogDb()): Promise<ProductRow | null> {
  const { data, error } = await db.from("content_items").select(PRODUCT_COLUMNS).eq("id", productId).maybeSingle();
  failOnError(error, "Produto");

  const row = (data ?? null) as ProductRow | null;

  return row && row.kind !== "Aula" ? row : null;
}

export async function requireProductRow(productId: string, db = catalogDb()) {
  const row = await fetchProductRow(productId, db);

  if (!row) {
    throw new CatalogNotFoundError("Não encontramos este produto. Ele pode ter sido excluído.");
  }

  return row;
}

export async function fetchProductSettings(productId: string, db = catalogDb()): Promise<ProductSettings> {
  const { data, error } = await db.from("content_page_settings").select("settings").eq("content_id", productId).maybeSingle();
  failOnError(error, "Configuracoes do produto");

  const settings = (data as { settings?: unknown } | null)?.settings;

  return settings && typeof settings === "object" && !Array.isArray(settings) ? { ...(settings as ProductSettings) } : {};
}

export async function fetchSettingsFor(productIds: readonly string[], db = catalogDb()) {
  const settings = new Map<string, ProductSettings>();

  if (productIds.length === 0) {
    return settings;
  }

  const { data, error } = await db.from("content_page_settings").select("content_id,settings").in("content_id", [...productIds]);
  failOnError(error, "Configuracoes dos produtos");

  for (const row of (data ?? []) as { content_id: string; settings: unknown }[]) {
    if (row.settings && typeof row.settings === "object" && !Array.isArray(row.settings)) {
      settings.set(row.content_id, row.settings as ProductSettings);
    }
  }

  return settings;
}

/**
 * Muda so as chaves pedidas de content_page_settings.settings, num UPDATE atomico no banco
 * (admin_patch_product_settings): `unset` sai, `set` entra (chave por chave, sem fundir objetos
 * internos). Sem leitura previa no servidor, duas escritas ao mesmo tempo (cor em Detalhes + hero, ou o
 * admin legado) nao apagam a chave uma da outra. Sem nenhuma chave, a linha sai.
 */
export async function patchProductSettings(
  productId: string,
  patch: { set?: ProductSettings; unset?: readonly string[] },
  db = catalogDb()
): Promise<ProductSettings> {
  const set = patch.set ?? {};
  const unset = [...new Set(patch.unset ?? [])].filter((key) => !(key in set));

  if (Object.keys(set).length === 0 && unset.length === 0) {
    return fetchProductSettings(productId, db);
  }

  const { data, error } = await db.rpc("admin_patch_product_settings", {
    p_content_id: productId,
    p_set: set,
    p_unset: unset
  });
  failOnError(error, "Salvando configuracoes do produto");

  return data && typeof data === "object" && !Array.isArray(data) ? { ...(data as ProductSettings) } : {};
}

export async function fetchParentFormation(settings: ProductSettings, db = catalogDb()) {
  const parentId = parentFormationIdOf(settings);

  if (!parentId) {
    return null;
  }

  const { data, error } = await db.from("content_items").select("id,title,kind").eq("id", parentId).maybeSingle();
  failOnError(error, "Formacao do curso");

  const row = data as { id: string; kind: string; title: string } | null;

  return row && row.kind === "Formacao" ? { id: row.id, title: row.title } : null;
}

/**
 * Alunos com acesso ativo agora (entitlements ativos dentro da janela) a um produto, contados uma vez
 * por aluno pela RPC admin_product_students_with_access. Sem a RPC (migracao ainda nao aplicada), conta
 * as linhas: pode passar do numero de alunos, mas nunca diz zero quando ha acesso.
 */
export async function countActiveAccess(productId: string, db = catalogDb()) {
  const { data, error: rpcError } = await db.rpc("admin_product_students_with_access", { p_content_id: productId });

  if (!rpcError && typeof data === "number") {
    return data;
  }

  const now = new Date().toISOString();
  const { count, error } = await db
    .from("entitlements")
    .select("id", { count: "exact", head: true })
    .eq("target_id", productId)
    .eq("status", "active")
    .lte("starts_at", now)
    .or(`ends_at.is.null,ends_at.gt."${now}"`);
  failOnError(error, "Acessos do produto");

  return count ?? 0;
}

/**
 * Atualiza UMA linha conferindo o updated_at lido pela tela (decisao 10). 0 linhas: 404 se nao existe
 * (ou foi excluida), 409 se mudou depois da leitura. `expectedUpdatedAt` ausente = sem checagem.
 */
export async function updateRowGuarded<Row>(input: {
  columns: string;
  db?: CatalogDb;
  excludeDeleted?: boolean;
  expectedUpdatedAt?: string;
  id: string;
  notFoundMessage?: string;
  patch: Record<string, unknown>;
  table: "content_items" | "course_modules" | "lessons";
}): Promise<Row> {
  const db = input.db ?? catalogDb();
  // O trigger set_updated_at regrava updated_at = now() em todo update; mandamos o campo para que um
  // pedido sem outras mudancas ainda "toque" a linha e devolva o updated_at novo.
  let query = db.from(input.table).update({ ...input.patch, updated_at: new Date().toISOString() }).eq("id", input.id);

  if (input.excludeDeleted) {
    query = query.neq("status", "deleted");
  }

  if (input.expectedUpdatedAt) {
    query = query.eq("updated_at", input.expectedUpdatedAt);
  }

  const { data, error } = await query.select(input.columns);
  failOnError(error, `Atualizando ${input.table}`);

  const rows = (data ?? []) as Row[];

  if (rows.length > 0) {
    return rows[0];
  }

  let existsQuery = db.from(input.table).select("id").eq("id", input.id);

  if (input.excludeDeleted) {
    existsQuery = existsQuery.neq("status", "deleted");
  }

  const exists = await existsQuery.maybeSingle();
  failOnError(exists.error, `Conferindo ${input.table}`);

  if (!exists.data) {
    throw new CatalogNotFoundError(input.notFoundMessage);
  }

  throw new CatalogConflictError();
}

/* ------------------------------------------------------------------------------------------------
 * Módulos e aulas
 * ---------------------------------------------------------------------------------------------- */

export async function fetchModulesFor(ownerIds: readonly string[], db = catalogDb()): Promise<ModuleRow[]> {
  if (ownerIds.length === 0) {
    return [];
  }

  const { data, error } = await db
    .from("course_modules")
    .select(MODULE_COLUMNS)
    .in("owner_id", [...ownerIds])
    .neq("status", "deleted")
    .order("sort_order", { ascending: true });
  failOnError(error, "Modulos");

  return (data ?? []) as ModuleRow[];
}

export async function fetchLessonsFor(moduleIds: readonly string[], db = catalogDb()): Promise<LessonRow[]> {
  if (moduleIds.length === 0) {
    return [];
  }

  const lessons: LessonRow[] = [];

  // Lotes para nao estourar o tamanho da URL do filtro `in`.
  for (let index = 0; index < moduleIds.length; index += 100) {
    const { data, error } = await db
      .from("lessons")
      .select(LESSON_COLUMNS)
      .in("module_id", moduleIds.slice(index, index + 100))
      .neq("status", "deleted")
      .order("sort_order", { ascending: true });
    failOnError(error, "Aulas");
    lessons.push(...((data ?? []) as LessonRow[]));
  }

  return lessons;
}

/** Modulos e aulas (nao excluidos) de um produto. */
export async function fetchProductStructure(productId: string, db = catalogDb()) {
  const modules = await fetchModulesFor([productId], db);
  const lessons = await fetchLessonsFor(modules.map((module) => module.id), db);

  return { lessons, modules };
}

export async function fetchModuleRow(moduleId: string, db = catalogDb()): Promise<ModuleRow | null> {
  const { data, error } = await db.from("course_modules").select(MODULE_COLUMNS).eq("id", moduleId).neq("status", "deleted").maybeSingle();
  failOnError(error, "Modulo");

  return (data ?? null) as ModuleRow | null;
}

export async function fetchLessonRow(lessonId: string, db = catalogDb()): Promise<LessonRow | null> {
  const { data, error } = await db.from("lessons").select(LESSON_COLUMNS).eq("id", lessonId).neq("status", "deleted").maybeSingle();
  failOnError(error, "Aula");

  return (data ?? null) as LessonRow | null;
}

/** course_modules.meta = "N aula(s)" contando so aulas nao excluidas; grava so quando muda. */
export async function refreshModuleMeta(moduleIds: readonly string[], db = catalogDb()) {
  const uniqueIds = [...new Set(moduleIds)];

  if (uniqueIds.length === 0) {
    return;
  }

  const [modulesResult, lessonsResult] = await Promise.all([
    db.from("course_modules").select("id,meta").in("id", uniqueIds),
    db.from("lessons").select("module_id").in("module_id", uniqueIds).neq("status", "deleted")
  ]);
  failOnError(modulesResult.error, "Modulos para contagem");
  failOnError(lessonsResult.error, "Aulas para contagem");

  const counts = new Map<string, number>();

  for (const row of (lessonsResult.data ?? []) as { module_id: string }[]) {
    counts.set(row.module_id, (counts.get(row.module_id) ?? 0) + 1);
  }

  await Promise.all(
    ((modulesResult.data ?? []) as { id: string; meta: string | null }[]).flatMap((module) => {
      const meta = lessonCountLabel(counts.get(module.id) ?? 0);

      if (module.meta === meta) {
        return [];
      }

      return [
        db
          .from("course_modules")
          .update({ meta })
          .eq("id", module.id)
          .then(({ error }) => failOnError(error, "Atualizando contagem do modulo"))
      ];
    })
  );
}

/* ------------------------------------------------------------------------------------------------
 * Formação
 * ---------------------------------------------------------------------------------------------- */

export type IncludedCourseRow = Pick<ProductRow, "commerce_scope" | "id" | "image" | "kind" | "publication_status" | "sort_order" | "title">;

/** Cursos incluidos numa formacao (commerce_scope included_content + settings.parentFormationId), na ordem. */
export async function fetchIncludedCourses(formationId: string, db = catalogDb()) {
  const { data: settingsData, error: settingsError } = await db
    .from("content_page_settings")
    .select("content_id,settings")
    .eq("settings->>parentFormationId", formationId);
  failOnError(settingsError, "Cursos da formacao");

  const settingsRows = (settingsData ?? []) as { content_id: string; settings: ProductSettings }[];

  if (settingsRows.length === 0) {
    return { courses: [] as IncludedCourseRow[], settings: new Map<string, ProductSettings>() };
  }

  const { data, error } = await db
    .from("content_items")
    .select("id,title,kind,image,publication_status,commerce_scope,sort_order")
    .in("id", settingsRows.map((row) => row.content_id))
    .eq("commerce_scope", "included_content")
    .order("sort_order", { ascending: true });
  failOnError(error, "Cursos da formacao");

  const courses = ((data ?? []) as IncludedCourseRow[])
    .slice()
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id));

  return {
    courses,
    settings: new Map(settingsRows.map((row) => [row.content_id, row.settings]))
  };
}

/** Linhas minimas para contar aulas por dono (produto ou curso incluido). */
export async function fetchLessonCountRows(ownerIds: readonly string[], db = catalogDb()) {
  if (ownerIds.length === 0) {
    return { lessons: [] as { module_id: string; status: string }[], modules: [] as { id: string; owner_id: string | null; status: string }[] };
  }

  const { data: moduleData, error: moduleError } = await db
    .from("course_modules")
    .select("id,owner_id,status")
    .in("owner_id", [...ownerIds])
    .neq("status", "deleted");
  failOnError(moduleError, "Modulos para contagem");

  const modules = (moduleData ?? []) as { id: string; owner_id: string | null; status: string }[];
  const lessons: { module_id: string; status: string }[] = [];
  const moduleIds = modules.map((module) => module.id);

  for (let index = 0; index < moduleIds.length; index += 100) {
    const { data, error } = await db
      .from("lessons")
      .select("module_id,status")
      .in("module_id", moduleIds.slice(index, index + 100))
      .neq("status", "deleted");
    failOnError(error, "Aulas para contagem");
    lessons.push(...((data ?? []) as { module_id: string; status: string }[]));
  }

  return { lessons, modules };
}
