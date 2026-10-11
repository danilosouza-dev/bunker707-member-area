import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAuthConfig } from "@/server/auth/config";

export async function createSupabaseServerClient() {
  const { anonKey, url } = getSupabaseAuthConfig();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, options, value }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components can read cookies but cannot always write them.
          // Proxy (proxy.ts) refreshes sessions and applies Set-Cookie headers.
        }
      }
    }
  });
}
