import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import {
  getAdminAccessForUser,
  getAuthenticatedUser,
  getSessionUser
} from "@/server/auth/session";

function redirectToLogin(nextPath: string): never {
  redirect(`/login?next=${encodeURIComponent(getSafeRedirectPath(nextPath))}`);
}

/** Usuario confirmado no Auth (getUser): admin, compras, perfil, suporte, troca de senha. */
export async function requirePageUser(nextPath = "/") {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirectToLogin(nextPath);
  }

  return user;
}

/** Paginas de conteudo do aluno: sessao pelos claims do JWT quando AUTH_SESSION_STRATEGY=claims (session.ts). */
export async function requireStudentPageUser(nextPath = "/") {
  const user = await getSessionUser();

  if (!user) {
    redirectToLogin(nextPath);
  }

  return user;
}

/** Pessoa da equipe (qualquer papel). `access` traz as permissoes efetivas; `role`, o papel. */
export async function requirePageAdmin() {
  const user = await requirePageUser("/admin");
  const access = await getAdminAccessForUser(user.id);

  if (!access) {
    redirect("/");
  }

  return { access, role: access.role, user };
}

export async function requireApiUser() {
  const user = await getAuthenticatedUser();

  if (!user) {
    return {
      response: NextResponse.json({ error: "Sessao obrigatoria." }, { status: 401 }),
      user: null
    };
  }

  return { response: null, user };
}

export async function requireApiAdmin(options?: { roles?: readonly string[] }) {
  const auth = await requireApiUser();

  if (auth.response || !auth.user) {
    return auth;
  }

  const access = await getAdminAccessForUser(auth.user.id);

  if (!access) {
    return {
      response: NextResponse.json({ error: "Permissao administrativa obrigatoria." }, { status: 403 }),
      user: auth.user
    };
  }

  const role = access.role;

  if (options?.roles && !options.roles.includes(role)) {
    return {
      access,
      response: NextResponse.json({ error: "Seu papel administrativo nao permite esta operacao." }, { status: 403 }),
      role,
      user: auth.user
    };
  }

  return { access, response: null, role, user: auth.user };
}
