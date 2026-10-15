import "server-only";

import { addCourseToMemberScope } from "@/server/auth/admin-access";
import { isActionScoped, MAX_SCOPED_PRODUCTS, type AdminAccess } from "@/server/auth/roles";
import { CatalogRuleError } from "./errors";

// Quem cria so nos proprios cursos (docs/17 §2.3): o curso novo entra na lista da pessoa, para ela
// continuar montando. Usado por criar produto e por importar playlist.

export const CREATOR_SCOPE_FULL = `Sua lista já tem ${MAX_SCOPED_PRODUCTS} cursos, o máximo. Peça ao dono para tirar algum antes de criar outro.`;
export const CREATOR_SCOPE_FAILED = "O curso foi criado, mas não entrou na sua lista. Peça ao dono para incluí-lo nos seus cursos.";

/** Antes de criar: com a lista cheia, o curso novo nao teria como entrar nela. */
export function assertCreatorScopeRoom(access: AdminAccess) {
  if (isActionScoped(access, "catalog.create") && access.courseIds.length >= MAX_SCOPED_PRODUCTS) {
    throw new CatalogRuleError(CREATOR_SCOPE_FULL);
  }
}

/** Depois de criar: poe o curso na lista; se nao der, avisa (o curso ja existe e o dono pode incluir). */
export async function addCreatedCourseToScope(access: AdminAccess, userId: string, productId: string) {
  if (!isActionScoped(access, "catalog.create")) {
    return;
  }

  let added = false;

  try {
    added = await addCourseToMemberScope(userId, productId);
  } catch (error) {
    console.error("[catalog] Curso novo na lista de quem criou:", error);
  }

  if (!added) {
    throw new CatalogRuleError(CREATOR_SCOPE_FAILED);
  }
}
