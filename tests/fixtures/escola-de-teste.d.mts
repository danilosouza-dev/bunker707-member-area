// Tipos da escola de teste para os arquivos TypeScript do Playwright (o codigo esta em escola-de-teste.mjs).

export type ContaDeTeste = { email: string; nome: string };
export type ContaDeTesteCriada = ContaDeTeste & { id: string };

export const SENHA_DE_TESTE: string;

export const ESCOLA_DE_TESTE: {
  contas: {
    aluna: ContaDeTeste;
    alunoSemAcesso: ContaDeTeste;
    analista: ContaDeTeste;
    produtor: ContaDeTeste;
  };
  curso: {
    aulas: { aula1: string; aula2: string; aula3: string };
    id: string;
    modulos: { modulo1: string; modulo2: string };
    titulo: string;
  };
  cursoBloqueado: { id: string; titulo: string };
};

export function usuarioDeTeste(conta: ContaDeTesteCriada): {
  app_metadata: Record<string, unknown>;
  aud: string;
  created_at: string;
  email: string;
  id: string;
  user_metadata: Record<string, unknown>;
};

export function contasDeTeste(db: unknown): Promise<{
  aluna: ContaDeTesteCriada;
  alunoSemAcesso: ContaDeTesteCriada;
  analista: ContaDeTesteCriada;
  produtor: ContaDeTesteCriada;
}>;

export function seedEscolaDeTeste(db: unknown): Promise<{
  aluna: ContaDeTesteCriada;
  alunoSemAcesso: ContaDeTesteCriada;
  analista: ContaDeTesteCriada;
  produtor: ContaDeTesteCriada;
}>;

export function limparProgresso(db: unknown, userIds: string[]): Promise<void>;
