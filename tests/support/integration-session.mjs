// Substituto de src/server/auth/session.ts nos testes de integracao: a sessao e simulada (quem esta
// logado e quem o teste disser com `actAs`), mas as permissoes da equipe vem do banco local de verdade.
// Fora daqui, nada do app e trocado: cliente do banco, regras de acesso e gravacoes sao as reais.

export const integrationSession = (globalThis.__integrationSession ??= { supabase: null, user: null });

/** Pessoa logada para as proximas chamadas (null = sem sessao). Sem cliente do aluno no banco. */
export function actAs(user) {
  integrationSession.user = user;
  integrationSession.supabase = null;
}

/**
 * Entra de verdade no Auth local como a conta (e-mail e senha de teste) e deixa o cliente dessa sessao
 * disponivel para o codigo do app que grava "com a sessao do aluno" (RLS valendo), como a foto do perfil.
 */
export async function actAsSignedIn(conta, senha) {
  const { createClient } = await import("@supabase/supabase-js");
  const { readLocalSupabaseConfig } = await import("./local-db.mjs");
  const { anonKey, url } = readLocalSupabaseConfig();
  const supabase = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email: conta.email, password: senha });

  if (error || !data.user) {
    throw new Error(`Nao foi possivel entrar como ${conta.email}: ${error?.message ?? "sem usuario"}`);
  }

  integrationSession.user = data.user;
  integrationSession.supabase = supabase;

  return data.user;
}

export async function getAuthenticatedUser() {
  return integrationSession.user;
}

// Paginas de conteudo (getSessionUser: claims do JWT no app): aqui e a mesma pessoa simulada.
export async function getSessionUser() {
  return integrationSession.user;
}

// Import dinamico: o alias "@/" so existe depois que integration-hooks.mjs registra os ganchos.
export async function getAdminAccessForUser(userId) {
  const { loadAdminAccess } = await import("@/server/auth/admin-access");

  try {
    return await loadAdminAccess(userId);
  } catch {
    return null;
  }
}

export async function getAdminRoleForUser(userId) {
  return (await getAdminAccessForUser(userId))?.role ?? null;
}

// Copia da regra do app (src/server/auth/session.ts): nome a partir dos metadados ou do e-mail.
export function getUserDisplayName(user) {
  const metadata = user.user_metadata ?? {};
  const rawName =
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : typeof metadata.name === "string"
        ? metadata.name
        : typeof metadata.display_name === "string"
          ? metadata.display_name
          : "";
  const emailFallback = user.email?.split("@")[0] ?? "Aluno";
  const fullName = rawName.trim() || emailFallback;

  return {
    fullName,
    name: fullName.split(/\s+/)[0] || "Aluno"
  };
}
