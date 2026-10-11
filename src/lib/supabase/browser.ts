"use client";

import { createBrowserClient } from "@supabase/ssr";
import { cleanEnvValue } from "@/lib/env-value";

function getBrowserSupabaseConfig() {
  const url = cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const publicKey =
    cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);

  if (!url || !publicKey) {
    throw new Error(
      "Supabase Auth nao configurado neste ambiente. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY ou NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  return { publicKey, url };
}

export function hasBrowserSupabaseConfig() {
  return Boolean(
    cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      (cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ?? cleanEnvValue(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY))
  );
}

export function createBrowserSupabaseClient() {
  const { publicKey, url } = getBrowserSupabaseConfig();
  return createBrowserClient(url, publicKey);
}
