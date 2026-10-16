import "server-only";

import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { customFunctionIdsOf, isAdminAction, resolveAdminAccess, type AdminAccess, type CustomFunctionDefinition } from "@/server/auth/roles";

// Permissoes efetivas de uma pessoa da equipe (docs/17 §2.3): a linha de admin_roles mais as funcoes
// personalizadas que ela cita (admin_functions). Lido com a chave do servidor; quem chama ja sabe quem
// e a pessoa (sessao validada, ou o dono da aula/comentario no servidor).

type AdminDb = ReturnType<typeof getSupabaseAdminClient>;

type FunctionRow = { actions: unknown; id: string; scoped_actions: unknown };

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * Funcoes personalizadas por id. Erro ao ler e propagado: a pessoa fica sem admin ate a leitura voltar
 * (menos acesso, nunca mais). Funcao que nao existe mais so nao vem, e nao da nada.
 */
export async function readCustomFunctions(db: AdminDb, ids: readonly string[]): Promise<Map<string, CustomFunctionDefinition>> {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await db.from("admin_functions").select("id, actions, scoped_actions").in("id", [...ids]);

  if (error) {
    throw new Error(`Equipe: nao foi possivel ler as funcoes personalizadas (${error.message}).`);
  }

  return new Map(
    ((data ?? []) as FunctionRow[]).map((row) => [
      row.id,
      { actions: stringList(row.actions).filter(isAdminAction), id: row.id, scopedActions: stringList(row.scoped_actions).filter(isAdminAction) }
    ])
  );
}

/** Permissoes efetivas da pessoa, ou null se ela nao e da equipe. Erro ao ler admin_roles e propagado. */
export async function loadAdminAccess(userId: string, db: AdminDb = getSupabaseAdminClient()): Promise<AdminAccess | null> {
  const { data, error } = await db.from("admin_roles").select("role, permissions").eq("user_id", userId).maybeSingle();

  if (error) {
    throw new Error(`Equipe: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const row = data as { permissions: unknown; role: unknown };
  const customFunctions = await readCustomFunctions(db, customFunctionIdsOf(row.permissions));

  return resolveAdminAccess(row.role, row.permissions, customFunctions);
}

/**
 * Curso criado por quem cria so nos proprios cursos: entra na lista da pessoa. Um UPDATE so no banco
 * (admin_add_course_to_member_scope, com a linha travada): nao desfaz o que o dono mudou ao mesmo
 * tempo, nao perde curso criado em paralelo e respeita o teto de cursos. false = nao entrou (lista
 * cheia ou pessoa fora da equipe).
 */
export async function addCourseToMemberScope(userId: string, productId: string, db: AdminDb = getSupabaseAdminClient()): Promise<boolean> {
  const { data, error } = await db.rpc("admin_add_course_to_member_scope", { p_product_id: productId, p_user_id: userId });

  if (error) {
    throw new Error(`Equipe: nao foi possivel guardar o curso novo na lista da pessoa (${error.message}).`);
  }

  return data === true;
}
