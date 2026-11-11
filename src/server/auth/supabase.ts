import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseAuthConfig } from "@/server/auth/config";
import { createStoragePathsFetch } from "@/server/db/storage-paths";
import { supabaseServerGlobalOptions } from "@/server/db/supabase/internal-fetch";

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
          // Server Component le cookies mas nao pode grava-los: nas paginas, quem renova a sessao e grava o
          // Set-Cookie e o proxy (src/proxy.ts). Em Route Handler e Server Action a gravacao funciona, e e
          // este setAll que devolve o cookie renovado nas rotas /api, que o proxy nao valida (docs/06).
        }
      }
    },
    // O banco guarda o caminho dos arquivos do Storage e o app le e grava o endereco inteiro (docs/32 §11.5); no
    // servidor do kit, o transporte vai pela rede interna (SUPABASE_INTERNAL_URL, §11.7), e o cookie continua com o
    // nome do endereco publico.
    global: { fetch: createStoragePathsFetch(url, supabaseServerGlobalOptions(url).fetch) }
  });
}
