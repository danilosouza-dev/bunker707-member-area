/**
 * Encerra a sessão pelo servidor e sai para /login.
 *
 * O route handler POST /api/auth/logout faz o signOut no Supabase Auth e expira os
 * cookies; o navegador não carrega nenhum cliente de autenticação. Compartilhado pelo
 * shell do aluno (app-shell) e pelo shell do admin (account-menu), que fazem apenas o
 * trabalho próprio (ex.: salvar progresso) antes de chamar esta função.
 */
export async function signOutAndLeave(options: { redirectTo?: string } = {}) {
  const redirectTo = options.redirectTo ?? "/login";

  try {
    await fetch("/api/auth/logout", {
      credentials: "same-origin",
      method: "POST"
    });
  } catch {
    // Falha de rede: a sessão continua válida e o /login devolve a pessoa para a home.
  } finally {
    // Navegação completa: descarta o cache do router e o estado em memória.
    window.location.replace(redirectTo);
  }
}
