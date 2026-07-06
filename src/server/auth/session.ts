import "server-only";

import type { User } from "@supabase/supabase-js";
import { hasSupabaseAuthConfig } from "@/server/auth/config";
import { getLocalAuthenticatedUser } from "@/server/auth/local";
import { createSupabaseServerClient } from "@/server/auth/supabase";

export type AuthenticatedUser = User;
export type AdminRole = "owner" | "admin" | "editor" | "support" | "analyst";

const adminRoles = new Set<AdminRole>(["owner", "admin", "editor", "support", "analyst"]);

export async function getAuthenticatedUser() {
  const localUser = await getLocalAuthenticatedUser();

  if (localUser) {
    return localUser;
  }

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
}

export async function getAdminRoleForUser(userId: string) {
  const localUser = await getLocalAuthenticatedUser();

  if (localUser?.id === userId) {
    return "owner";
  }

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
}

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
