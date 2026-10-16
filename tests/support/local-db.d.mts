// Tipos de local-db.mjs para os arquivos TypeScript do Playwright.
import type { SupabaseClient } from "@supabase/supabase-js";

export class SupabaseLocalError extends Error {}
export function readLocalSupabaseConfig(env?: NodeJS.ProcessEnv): { anonKey: string; serviceKey: string; url: string };
export function createLocalAdminClient(): SupabaseClient;
export function unwrap<T>(result: { data: T; error: { message: string } | null }, context: string): T;
