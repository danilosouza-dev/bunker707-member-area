import "server-only";

// Perfil do proprio aluno (tabela profiles): nome, telefone e foto.
//
// Leitura com a sessao do aluno (createSupabaseServerClient): a politica de RLS da tabela so deixa
// cada pessoa ler a propria linha, e o filtro por id = usuario logado fica explicito aqui tambem.
// Nunca usa a chave de servico e nunca le o perfil de outra pessoa.
//
// Sem configuracao do Supabase ou em erro de leitura: devolve null e a pagina mostra o que vem da
// conta (e-mail, data de cadastro) com "Não informado" no resto.

import { redactSecrets } from "@/lib/env-value";
import { hasSupabaseAuthConfig } from "@/server/auth/config";
import type { AuthenticatedUser } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/server/auth/supabase";

export type StudentProfileRecord = {
  avatarUrl: string | null;
  fullName: string | null;
  phone: string | null;
};

type ProfileRow = {
  avatar_url: string | null;
  full_name: string | null;
  phone: string | null;
};

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function getStudentProfileRecord(user: Pick<AuthenticatedUser, "id">): Promise<StudentProfileRecord | null> {
  if (!user.id || !hasSupabaseAuthConfig()) {
    return null;
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name,phone,avatar_url")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("[perfil] leitura do perfil do aluno", redactSecrets(error.message));
      return null;
    }

    const row = data as ProfileRow | null;

    return row
      ? { avatarUrl: cleanText(row.avatar_url), fullName: cleanText(row.full_name), phone: cleanText(row.phone) }
      : null;
  } catch (error) {
    console.error("[perfil] leitura do perfil do aluno", redactSecrets(error instanceof Error ? error.message : String(error)));
    return null;
  }
}
