import "server-only";

// Acesso ao banco da Comunidade (leituras e acoes do admin). Cliente de servico, colunas explicitas,
// leituras por lote de ids (nunca a tabela inteira). Os mapeamentos ficam em ./mappers (puros).

import { toDbError } from "@/server/db/pending-migration";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import {
  COMMENT_COLUMNS,
  collectProductIds,
  createLessonPathResolver,
  type CommentRow,
  type LessonPathResolver,
  type LessonRow,
  type ModuleRow,
  type ProductRow,
  type ProductSettingsRow
} from "./mappers";

export type CommunityDb = ReturnType<typeof getSupabaseAdminClient>;

export function communityDb(): CommunityDb {
  return getSupabaseAdminClient();
}

/** Erro de dominio com status HTTP; toActionError o converte em ActionFailure com esta mensagem. */
export class CommunityError extends Error {
  status: 400 | 403 | 404 | 409 | 422;

  constructor(message: string, status: 400 | 403 | 404 | 409 | 422 = 400) {
    super(message);
    this.name = "CommunityError";
    this.status = status;
  }
}

/** Erro de banco vira 500 generico na acao (a mensagem tecnica fica so no log do servidor). */
export function assertNoDbError(error: { code?: string; message: string } | null, context: string) {
  if (error) {
    // Banco sem a migracao 202610110020: PendingMigrationError, que a pagina troca pelo aviso.
    throw toDbError(error, context);
  }
}

const IN_FILTER_CHUNK = 150;

function chunk<T>(values: readonly T[], size = IN_FILTER_CHUNK) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

/** Le linhas por lista de ids em lotes (o filtro `in` vai na URL do PostgREST). */
export async function selectByIds<Row>(
  table: string,
  columns: string,
  column: string,
  ids: readonly string[],
  context: string
): Promise<Row[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)));

  if (unique.length === 0) {
    return [];
  }

  const db = communityDb();
  const results = await Promise.all(chunk(unique).map((part) => db.from(table).select(columns).in(column, part)));
  const rows: Row[] = [];

  for (const result of results) {
    assertNoDbError(result.error, context);
    rows.push(...((result.data ?? []) as Row[]));
  }

  return rows;
}

/** Comentarios por id, na ordem pedida (ids que sumiram no meio sao ignorados). */
export async function loadCommentsByIds(ids: readonly string[]) {
  const rows = await selectByIds<CommentRow>("lesson_comments", COMMENT_COLUMNS, "id", ids, "Comunidade: comentarios");
  const byId = new Map(rows.map((row) => [row.id, row]));

  return ids.map((id) => byId.get(id)).filter((row): row is CommentRow => Boolean(row));
}

/** Contagens de reacoes e denuncias dos comentarios. */
export async function loadReactionAndReportRows(commentIds: readonly string[]) {
  const [reactions, reports] = await Promise.all([
    selectByIds<{ comment_id: string }>("lesson_comment_reactions", "comment_id", "comment_id", commentIds, "Comunidade: reacoes"),
    selectByIds<{ comment_id: string }>("lesson_comment_reports", "comment_id", "comment_id", commentIds, "Comunidade: denuncias")
  ]);

  return { reactions, reports };
}

/**
 * Caminho "Produto › Módulo › Aula" de cada par (produto do comentario, aula): aulas -> modulos ->
 * produtos (donos e de contexto) -> cor do produto.
 */
export async function loadLessonPathResolver(pairs: readonly { contentId: string; lessonId: string }[]): Promise<LessonPathResolver> {
  const lessons = await selectByIds<LessonRow>(
    "lessons",
    "id,module_id,title",
    "id",
    pairs.map((pair) => pair.lessonId),
    "Comunidade: aulas"
  );
  const modules = await selectByIds<ModuleRow>(
    "course_modules",
    "id,owner_id,title",
    "id",
    lessons.map((lesson) => lesson.module_id),
    "Comunidade: modulos"
  );
  const productIds = collectProductIds(
    pairs.map((pair) => pair.contentId),
    modules
  );
  const [products, settings] = await Promise.all([
    selectByIds<ProductRow>("content_items", "id,title", "id", productIds, "Comunidade: produtos"),
    selectByIds<ProductSettingsRow>("content_page_settings", "content_id,settings", "content_id", productIds, "Comunidade: cores")
  ]);

  return createLessonPathResolver({ lessons, modules, products, settings });
}

/** Nomes da equipe para o historico de moderacao (perfil; sem perfil, null). */
export async function loadProfileNames(userIds: readonly string[]) {
  const rows = await selectByIds<{ full_name: string | null; id: string }>(
    "profiles",
    "id,full_name",
    "id",
    userIds,
    "Comunidade: nomes da equipe"
  );

  return new Map(rows.filter((row) => row.full_name?.trim()).map((row) => [row.id, row.full_name!.trim()]));
}
