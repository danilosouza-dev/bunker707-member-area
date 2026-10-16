import "server-only";

import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { loadAdminAccess } from "@/server/auth/admin-access";
import { hasSupabaseAuthConfig } from "@/server/auth/config";
import type { AdminAccess, AdminRole } from "@/server/auth/roles";
import { createSupabaseServerClient } from "@/server/auth/supabase";

export type AuthenticatedUser = User;
export type { AdminAccess, AdminRole };

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
// Papel e permissoes valem na hora: mudar ou remover alguem da equipe vale a partir da proxima
// requisicao dessa pessoa, sem precisar derrubar a sessao (docs/17 §2.3).
export const getAdminAccessForUser = cache(async (userId: string): Promise<AdminAccess | null> => {
  if (!hasSupabaseAuthConfig()) {
    return null;
  }

  try {
    return await loadAdminAccess(userId);
  } catch {
    return null;
  }
});

export const getAdminRoleForUser = cache(async (userId: string): Promise<AdminRole | null> => (await getAdminAccessForUser(userId))?.role ?? null);

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
