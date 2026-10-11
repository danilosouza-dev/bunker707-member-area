import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { requireApiAdmin, requirePageAdmin } from "@/server/auth/guards";
import { getAdminRoleForUser, getAuthenticatedUser } from "@/server/auth/session";
import { canRole, describeForbidden, rolesFor, type AdminAction } from "@/server/auth/roles";

export { canRole, rolesFor, type AdminAction } from "@/server/auth/roles";

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
 * Guard de Server Action: usuario autenticado com papel que pode executar `action`.
 * Lanca AdminPermissionError (401 sem sessao, 403 sem papel ou sem permissao); use dentro de
 * runAdminAction (src/server/actions/run-action.ts), que converte o erro em ActionResult.
 * Usuario e papel sao memoizados por requisicao (React.cache em session.ts).
 */
export async function requireRole(action: AdminAction) {
  const user = await getAuthenticatedUser();

  if (!user) {
    throw new AdminPermissionError("Sua sessão expirou. Entre de novo para continuar.", 401);
  }

  const role = await getAdminRoleForUser(user.id);

  if (!role) {
    throw new AdminPermissionError("Permissão administrativa obrigatória.", 403);
  }

  if (!canRole(role, action)) {
    throw new AdminPermissionError(describeForbidden(action), 403);
  }

  return { role, user };
}

/**
 * Guard de rota /api/admin/**: mesmo formato de requireApiAdmin ({ response, role, user }).
 * `response` vem preenchida (401/403) quando o pedido deve parar.
 */
export async function requireApiRole(action: AdminAction) {
  const auth = await requireApiAdmin({ roles: rolesFor(action) });

  if (auth.response && "role" in auth && auth.role) {
    return {
      response: NextResponse.json({ error: describeForbidden(action) }, { status: 403 }),
      role: auth.role,
      user: auth.user
    };
  }

  return auth;
}

/**
 * Guard de pagina para telas que so existem para quem escreve (ex.: /admin/produtos/novo).
 * Chame depois de requirePageAdmin(); sem permissao, volta para `fallbackHref`.
 */
export async function requirePageRole(action: AdminAction, fallbackHref = "/admin") {
  const session = await requirePageAdmin();

  if (!canRole(session.role, action)) {
    redirect(fallbackHref);
  }

  return session;
}
