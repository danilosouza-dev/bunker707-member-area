// Substituto de src/server/auth/supabase.ts nos testes de integracao: o cliente "com a sessao do aluno"
// (que no app vem dos cookies do request) e o cliente que o teste criou com `actAsSignedIn`, logado de
// verdade no Auth local com a chave publica. Assim a RLS das tabelas do aluno (profiles) vale no teste.

export async function createSupabaseServerClient() {
  const session = globalThis.__integrationSession;

  if (!session?.supabase) {
    throw new Error("Este caminho usa a sessao do aluno no banco: chame actAsSignedIn(conta) no teste.");
  }

  return session.supabase;
}
