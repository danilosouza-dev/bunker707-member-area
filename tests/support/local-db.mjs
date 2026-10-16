import { createClient } from "@supabase/supabase-js";

// Cliente do Supabase LOCAL para os testes de integracao e de ponta a ponta (docs/18 §2.5).
//
// As variaveis vem de .env.test.local, que `npm run db:start` escreve a partir de `supabase status`
// (nunca de .env.local). Antes de qualquer consulta, a trava abaixo confere que o endereco e o da
// maquina: os testes gravam e apagam dados, e dev e producao hoje dividem o mesmo projeto Supabase.

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export class SupabaseLocalError extends Error {
  constructor(message) {
    super(message);
    this.name = "SupabaseLocalError";
  }
}

/** URL e chave de servico do Supabase local, ou erro explicando o que falta. */
export function readLocalSupabaseConfig(env = process.env) {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !serviceKey || !anonKey) {
    throw new SupabaseLocalError(
      "Supabase local nao configurado. Rode `npm run db:start` (precisa do Docker aberto) e tente de novo."
    );
  }

  let host;

  try {
    host = new URL(url).hostname;
  } catch {
    throw new SupabaseLocalError(`NEXT_PUBLIC_SUPABASE_URL invalida: ${url}`);
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new SupabaseLocalError(
      `Os testes de integracao e ponta a ponta so rodam contra o Supabase LOCAL, e NEXT_PUBLIC_SUPABASE_URL aponta para "${host}". ` +
        "Nunca aponte os testes para o projeto compartilhado de dev/producao. Rode `npm run db:start` e confira .env.test.local."
    );
  }

  return { anonKey, serviceKey, url };
}

/** Cliente com a chave de servico (mesma que o servidor do app usa), apontando para o Supabase local. */
export function createLocalAdminClient() {
  const { serviceKey, url } = readLocalSupabaseConfig();

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
}

/** Lanca o erro do Supabase com contexto; devolve `data` quando deu certo. */
export function unwrap(result, context) {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }

  return result.data;
}
