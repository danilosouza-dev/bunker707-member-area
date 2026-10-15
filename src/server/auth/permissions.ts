import "server-only";

import { NextResponse } from "next/server";
import { notFound, redirect } from "next/navigation";
import { adminHomeHref, canSeeAdminArea, type AdminNavId } from "@/components/admin/v2/nav";
import { requireApiAdmin, requirePageAdmin } from "@/server/auth/guards";
import { resolveTargetProductIds, type ProductScopeTarget } from "@/server/auth/product-scope";
import { getAdminAccessForUser, getAuthenticatedUser } from "@/server/auth/session";
import {
  OUT_OF_SCOPE_MESSAGE,
  can,
  describeForbidden,
  isProductInScope,
  scopeAllows,
  type AdminAccess,
  type AdminAction
} from "@/server/auth/roles";

export { can, canAny, canRole, canSeeProductSettings, isProductInScope, rolesFor, type AdminAccess, type AdminAction } from "@/server/auth/roles";
export type { ProductScopeTarget } from "@/server/auth/product-scope";

/** Erro de permissao com status HTTP; toActionError (src/lib/action-result.ts) o converte em 401/403. */
export class AdminPermissionError extends Error {
  status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "AdminPermissionError";
    this.status = status;
  }
}

/**
 * Onde a acao mexe, para quem tem acesso so a alguns cursos (Professor):
 * - um ProductScopeTarget (produto, modulo, aula ou comentario), conferido contra os cursos da pessoa;
 * - "any": a acao nao toca dado de curso (ex.: pre-visualizar um link de video);
 * - ausente: a acao vale para a escola toda e quem tem escopo e recusado (negar por padrao).
 */
export type ScopeTarget = ProductScopeTarget | "any";

/**
 * Guard de Server Action: usuario autenticado com permissao para `action`.
 * Lanca AdminPermissionError (401 sem sessao, 403 sem papel ou sem permissao); use dentro de
 * runAdminAction (src/server/actions/run-action.ts), que converte o erro em ActionResult.
 * Usuario e permissoes sao memoizados por requisicao (React.cache em session.ts).
 */
export async function requireRole(action: AdminAction) {
  const user = await getAuthenticatedUser();

  if (!user) {
    throw new AdminPermissionError("Sua sessão expirou. Entre de novo para continuar.", 401);
  }

  const access = await getAdminAccessForUser(user.id);

  if (!access) {
    throw new AdminPermissionError("Permissão administrativa obrigatória.", 403);
  }

  if (!can(access, action)) {
    throw new AdminPermissionError(describeForbidden(action), 403);
  }

  return { access, role: access.role, user };
}

/** Escopo por curso: sem escopo (escola toda) passa direto; com escopo, todo curso tocado tem que ser da pessoa. */
export async function requireScope(access: AdminAccess, target: ScopeTarget | undefined) {
  if (access.productIds === null || target === "any") {
    return;
  }

  if (!target || !scopeAllows(access, await resolveTargetProductIds(target))) {
    throw new AdminPermissionError(OUT_OF_SCOPE_MESSAGE, 403);
  }
}

/**
 * Guard de rota /api/admin/**: mesmo formato de requireApiAdmin ({ access, response, role, user }).
 * `response` vem preenchida (401/403) quando o pedido deve parar. `target` segue a regra de requireScope.
 */
export async function requireApiRole(action: AdminAction, target?: ScopeTarget) {
  const auth = await requireApiAdmin();

  if (auth.response || !("access" in auth) || !auth.access) {
    return auth;
  }

  if (!can(auth.access, action)) {
    return { ...auth, response: NextResponse.json({ error: describeForbidden(action) }, { status: 403 }) };
  }

  try {
    await requireScope(auth.access, target);
  } catch (error) {
    if (error instanceof AdminPermissionError) {
      return { ...auth, response: NextResponse.json({ error: error.message }, { status: error.status }) };
    }

    throw error;
  }

  return auth;
}

/**
 * Guard de pagina para telas de uma permissao (ex.: /admin/produtos/novo). Sem permissao, volta para
 * `fallbackHref` (ou para a primeira area que a pessoa enxerga).
 */
export async function requirePageRole(action: AdminAction, fallbackHref?: string) {
  const session = await requirePageAdmin();

  if (!can(session.access, action)) {
    redirect(fallbackHref ?? adminHomeHref(session.access));
  }

  return session;
}

/** Guard de pagina por area do menu (docs/17 §1.4): quem nao enxerga a area vai para a primeira que enxerga. */
export async function requirePageArea(area: AdminNavId) {
  const session = await requirePageAdmin();

  if (!canSeeAdminArea(session.access, area)) {
    redirect(adminHomeHref(session.access));
  }

  return session;
}

/**
 * Paginas de um produto (/admin/produtos/[id]/**): area Produtos e, para quem tem acesso so a alguns
 * cursos, so os dele. Fora disso: "nao encontrado" (sem revelar que o produto existe). Layout e pagina
 * renderizam em paralelo, entao cada pagina do produto chama esta guarda.
 */
export async function requireProductPage(productId: string) {
  const session = await requirePageArea("produtos");

  if (!isProductInScope(session.access, productId)) {
    notFound();
  }

  return session;
}
