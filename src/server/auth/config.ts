import "server-only";
import { cleanEnvValue } from "@/lib/env-value";

const supabaseUrl = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? cleanEnvValue(process.env.SUPABASE_URL);
const supabasePublicKey =
  cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

export function hasSupabaseAuthConfig() {
  return Boolean(supabaseUrl && supabasePublicKey);
}

export function getSupabaseAuthConfig() {
  if (!supabaseUrl || !supabasePublicKey) {
    throw new Error(
      "Supabase Auth nao configurado. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY ou NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  return {
    anonKey: supabasePublicKey,
    url: supabaseUrl
  };
}
