import "server-only";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

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
