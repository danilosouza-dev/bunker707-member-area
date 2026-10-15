import "server-only";

import { getSupabaseAdminClient } from "@/server/db/supabase/client";

// Em que cursos uma acao mexe (docs/17 §2.3, Professor). Resolve modulo, aula e comentario ate o
// produto dono (course_modules.owner_id), lendo inclusive o que esta na lixeira (status 'deleted'),
// para "Desfazer" e "Restaurar" funcionarem. Id que nao existe devolve null: quem chama recusa.

export type ProductScopeTarget = {
  commentIds?: readonly string[];
  lessonIds?: readonly string[];
  moduleIds?: readonly string[];
  productIds?: readonly string[];
};

/** Lotes pequenos: ids do catalogo sao textos longos e vao na URL do PostgREST. */
const LOOKUP_CHUNK = 50;

/** Formatos aceitos antes de consultar (id fora do formato = alvo invalido, nunca erro de banco). */
const CATALOG_ID = /^[A-Za-z0-9_-]{1,240}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LookupRow = Record<string, unknown>;

async function selectByIds(table: string, columns: string, ids: readonly string[]): Promise<LookupRow[]> {
  const db = getSupabaseAdminClient();
  const rows: LookupRow[] = [];

  for (let index = 0; index < ids.length; index += LOOKUP_CHUNK) {
    const { data, error } = await db.from(table).select(columns).in("id", ids.slice(index, index + LOOKUP_CHUNK));

    if (error) {
      throw new Error(`Escopo por curso (${table}): ${error.message}`);
    }

    rows.push(...((data ?? []) as unknown as LookupRow[]));
  }

  return rows;
}

function stringColumn(row: LookupRow, column: string) {
  const value = row[column];

  return typeof value === "string" && value ? value : null;
}

/** Produtos tocados pelo alvo; null quando algum id nao existe (ou modulo sem produto dono). */
export async function resolveTargetProductIds(target: ProductScopeTarget): Promise<string[] | null> {
  const products = new Set(target.productIds ?? []);
  const lessonIds = new Set(target.lessonIds ?? []);
  const moduleIds = new Set(target.moduleIds ?? []);
  const commentIds = [...new Set(target.commentIds ?? [])];

  if (
    [...products, ...lessonIds, ...moduleIds].some((id) => !CATALOG_ID.test(id)) ||
    commentIds.some((id) => !UUID.test(id))
  ) {
    return null;
  }

  if (commentIds.length > 0) {
    const rows = await selectByIds("lesson_comments", "id, lesson_id", commentIds);

    if (rows.length !== commentIds.length) {
      return null;
    }

    for (const row of rows) {
      const lessonId = stringColumn(row, "lesson_id");

      if (!lessonId) {
        return null;
      }

      lessonIds.add(lessonId);
    }
  }

  if (lessonIds.size > 0) {
    const rows = await selectByIds("lessons", "id, module_id", [...lessonIds]);

    if (rows.length !== lessonIds.size) {
      return null;
    }

    for (const row of rows) {
      const moduleId = stringColumn(row, "module_id");

      if (!moduleId) {
        return null;
      }

      moduleIds.add(moduleId);
    }
  }

  if (moduleIds.size > 0) {
    const rows = await selectByIds("course_modules", "id, owner_id", [...moduleIds]);

    if (rows.length !== moduleIds.size) {
      return null;
    }

    for (const row of rows) {
      const ownerId = stringColumn(row, "owner_id");

      if (!ownerId) {
        return null;
      }

      products.add(ownerId);
    }
  }

  return [...products];
}
