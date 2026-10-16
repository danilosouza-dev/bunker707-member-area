// Substituto de src/server/auth/session.ts nos testes de integracao: a sessao e simulada (quem esta
// logado e quem o teste disser com `actAs`), mas as permissoes da equipe vem do banco local de verdade.
// Fora daqui, nada do app e trocado: cliente do banco, regras de acesso e gravacoes sao as reais.

export const integrationSession = (globalThis.__integrationSession ??= { user: null });

/** Pessoa logada para as proximas chamadas (null = sem sessao). */
export function actAs(user) {
  integrationSession.user = user;
}

export async function getAuthenticatedUser() {
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
