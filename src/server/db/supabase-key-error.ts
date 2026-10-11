// Chave do servidor trocada: o .env aponta NEXT_PUBLIC_SUPABASE_URL para um projeto e a secret key
// (SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY) e de outro. O Supabase responde 401
// {"message":"Invalid API key","hint":"... owned by another Supabase project."}. Sem esta deteccao a
// tela de erro mandava conferir migracoes, o que levava a pessoa para o lugar errado.
//
// Modulo puro (sem "server-only") para os testes rodarem com node --test.

export const INVALID_SUPABASE_KEY_MESSAGE =
  "A chave do servidor do Supabase não pertence ao projeto configurado. Copie a secret key (sb_secret_...) do mesmo projeto de NEXT_PUBLIC_SUPABASE_URL em Settings > API Keys e cole em SUPABASE_SECRET_KEY no .env.local.";

type KeyErrorLike = { code?: unknown; hint?: unknown; message?: unknown; status?: unknown } | null | undefined;

export function isInvalidSupabaseKeyError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as KeyErrorLike;
  const message = typeof candidate?.message === "string" ? candidate.message : "";
  const hint = typeof candidate?.hint === "string" ? candidate.hint : "";

  return /invalid api key/i.test(message) || /owned by another supabase project/i.test(hint);
}
