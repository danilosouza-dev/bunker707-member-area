import "server-only";

import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { loadAdminAccess } from "@/server/auth/admin-access";
import { getAuthSessionStrategy } from "@/lib/auth/session-strategy";
import { hasSupabaseAuthConfig } from "@/server/auth/config";
import type { AdminAccess, AdminRole } from "@/server/auth/roles";
import { createSupabaseServerClient } from "@/server/auth/supabase";
import { isGuestUser } from "@/lib/auth/guest-account";

export type AuthenticatedUser = User;
/** O que as paginas de conteudo do aluno usam do usuario; um AuthenticatedUser tambem serve. */
export type SessionUser = Pick<User, "app_metadata" | "email" | "id" | "user_metadata">;
export type { AdminAccess, AdminRole };

// Uma validacao por request: React.cache memoiza durante a renderizacao do servidor, entao layout, pagina,
// guards e loaders compartilham o mesmo getUser(). O proxy pode usar getClaims() (AUTH_SESSION_STRATEGY);
// aqui seguimos com getUser(), que consulta o Auth e enxerga sessao revogada. Nunca use getSession() no servidor.
// Quem troca a sessao no meio do request (login/logout em Server Action) nao deve reler o usuario depois disso.
export const getAuthenticatedUserOrGuest = cache(async (): Promise<AuthenticatedUser | null> => {
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

// Paginas de conteudo do aluno (home, curso, aula, favoritos, materiais, jornada, continue assistindo).
// Com AUTH_SESSION_STRATEGY=claims o JWT e validado pela assinatura (JWKS em cache no processo), sem ir ao
// Auth: no teste de carga de 19/10/2026 o getUser custava uma chamada ao Auth e 5 consultas no banco por
// pagina (docs/20 §12.1). O proxy ja renovou a sessao antes da renderizacao. Conta apagada ou sessao
// revogada so deixam de entrar aqui quando o token vence (JWT_EXPIRY, 1 h); o acesso aos cursos
// (entitlements) e lido do banco a cada pagina e vale na hora. Admin, compras, perfil, suporte e troca de
// senha seguem com getAuthenticatedUser. Sem "claims", e o proprio getAuthenticatedUser.
export const getSessionUserOrGuest = cache(async (): Promise<SessionUser | null> => {
  if (getAuthSessionStrategy() !== "claims") {
    return getAuthenticatedUserOrGuest();
  }

  if (!hasSupabaseAuthConfig()) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  try {
    const { data, error } = await supabase.auth.getClaims();
    const claims = error ? null : data?.claims;

    if (!claims?.sub) {
      return null;
    }

    return {
      app_metadata: claims.app_metadata ?? {},
      email: claims.email,
      id: claims.sub,
      user_metadata: claims.user_metadata ?? {}
    };
  } catch {
    return null;
  }
});

// O convidado do link aberto de um webinario (docs/30 §14, app_metadata.webinar_guest) nao e aluno: para todo o resto
// do app ele e "sem sessao". So as paginas e rotas do webinario dele pedem a versao OrGuest (requireStudentPageUser,
// requireApiUser e requireApiSessionUser com allowGuest), e o acesso ao webinario decide o resto (access.ts).
export const getAuthenticatedUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const user = await getAuthenticatedUserOrGuest();

  return user && !isGuestUser(user) ? user : null;
});

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const user = await getSessionUserOrGuest();

  return user && !isGuestUser(user) ? user : null;
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
