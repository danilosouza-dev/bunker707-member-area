import "server-only";

import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { hasSupabaseAuthConfig } from "@/server/auth/config";
import { createSupabaseServerClient } from "@/server/auth/supabase";

export type AuthenticatedUser = User;
export type AdminRole = "owner" | "admin" | "editor" | "support" | "analyst";

const adminRoles = new Set<AdminRole>(["owner", "admin", "editor", "support", "analyst"]);

// Uma validacao por request: React.cache memoiza durante a renderizacao do servidor, entao layout, pagina,
// guards e loaders compartilham o mesmo getUser(). O proxy pode usar getClaims() (AUTH_SESSION_STRATEGY);
// aqui seguimos com getUser(), que consulta o Auth e enxerga sessao revogada. Nunca use getSession() no servidor.
// Quem troca a sessao no meio do request (login/logout em Server Action) nao deve reler o usuario depois disso.
export const getAuthenticatedUser = cache(async (): Promise<AuthenticatedUser | null> => {
  if (!hasSupabaseAuthConfig()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  try {
    const { data, error } = await supabase.auth.getUser();

    if (error || !data.user) {
      return null;
    }

    return data.user;
  } catch {
    return null;
  }
});

// Memoizado por request (chave: userId) para que guards, shell e redirects leiam admin_roles uma vez so.
export const getAdminRoleForUser = cache(async (userId: string): Promise<AdminRole | null> => {
  if (!hasSupabaseAuthConfig()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  try {
    const { data, error } = await supabase
      .from("admin_roles")
      .select("role")
      .eq("user_id", userId)
      .maybeSingle();

    if (error || !data || typeof data.role !== "string") {
      return null;
    }

    return adminRoles.has(data.role as AdminRole) ? (data.role as AdminRole) : null;
  } catch {
    return null;
  }
});

export function getUserDisplayName(user: Pick<User, "email" | "user_metadata">) {
  const metadata = user.user_metadata;
  const rawName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : typeof metadata.display_name === "string"
          ? metadata.display_name
          : "";
  const emailFallback = user.email?.split("@")[0] ?? "Aluno";
  const fullName = rawName.trim() || emailFallback;

  return {
    fullName,
    name: fullName.split(/\s+/)[0] || "Aluno"
  };
}
