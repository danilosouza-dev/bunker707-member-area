import "server-only";

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getSafeRedirectPath } from "@/lib/auth/redirect";
import {
  getAdminRoleForUser,
  getAuthenticatedUser
} from "@/server/auth/session";

export async function requirePageUser(nextPath = "/") {
  const user = await getAuthenticatedUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(getSafeRedirectPath(nextPath))}`);
  }

  return user;
}

export async function requirePageAdmin() {
  const user = await requirePageUser("/admin");
  const role = await getAdminRoleForUser(user.id);

  if (!role) {
    redirect("/");
  }

  return { role, user };
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

  const role = await getAdminRoleForUser(auth.user.id);

  if (!role) {
    return {
      response: NextResponse.json({ error: "Permissao administrativa obrigatoria." }, { status: 403 }),
      user: auth.user
    };
  }

  if (options?.roles && !options.roles.includes(role)) {
    return {
      response: NextResponse.json({ error: "Seu papel administrativo nao permite esta operacao." }, { status: 403 }),
      role,
      user: auth.user
    };
  }

  return { response: null, role, user: auth.user };
}
