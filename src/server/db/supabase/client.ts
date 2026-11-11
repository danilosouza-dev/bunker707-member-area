import "server-only";

import { createClient } from "@supabase/supabase-js";
import { cleanEnvValue } from "@/lib/env-value";
import { createStoragePathsFetch } from "@/server/db/storage-paths";
import { supabaseServerGlobalOptions } from "@/server/db/supabase/internal-fetch";

const supabaseUrl = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? cleanEnvValue(process.env.SUPABASE_URL);
const supabaseSecretKey = cleanEnvValue(process.env.SUPABASE_SERVICE_ROLE_KEY) ?? cleanEnvValue(process.env.SUPABASE_SECRET_KEY);

export function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseSecretKey);
}

export function getSupabaseAdminClient() {
  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      "Supabase nao configurado. Defina NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEY no ambiente do servidor."
    );
  }

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    // O banco guarda o caminho dos arquivos do Storage e o app le e grava o endereco inteiro (docs/32 §11.5); no
    // servidor do kit, o transporte vai pela rede interna (SUPABASE_INTERNAL_URL, §11.7). Fora dele, so o primeiro.
    global: { fetch: createStoragePathsFetch(supabaseUrl, supabaseServerGlobalOptions(supabaseUrl).fetch) }
  });
}
