import "server-only";

import type { User } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import {
  isLocalAuthEnabled,
  localAuthCookieName,
  localAuthCookieValue
} from "@/lib/auth/local";
import { hasSupabaseAuthConfig } from "@/server/auth/config";

export function getLocalDevUser(): User {
  return {
    app_metadata: {
      provider: "local-dev",
      providers: ["local-dev"]
    },
    aud: "authenticated",
    created_at: new Date(0).toISOString(),
    email: "aluno.local@bunker707.dev",
    id: "00000000-0000-4000-8000-000000000707",
    user_metadata: {
      full_name: "Aluno Local"
    }
  } as User;
}

export async function getLocalAuthenticatedUser() {
  const headerStore = await headers();
  const hostname = headerStore.get("host")?.split(":")[0] ?? null;

  if (!isLocalAuthEnabled(hasSupabaseAuthConfig(), hostname)) {
    return null;
  }

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(localAuthCookieName)?.value;

  return cookieValue === localAuthCookieValue ? getLocalDevUser() : null;
}
