// Tipos da escola de teste para os arquivos TypeScript do Playwright (o codigo esta em escola-de-teste.mjs).

export type ContaDeTeste = { email: string; nome: string };
export type ContaDeTesteCriada = ContaDeTeste & { id: string };

export const SENHA_DE_TESTE: string;
export const DATA_DE_LIBERACAO_FUTURA: string;
export const INICIO_DO_ACESSO: string;

export const ESCOLA_DE_TESTE: {
  contas: {
    aluna: ContaDeTeste;
    alunaAcessoExpirado: ContaDeTeste;
    alunoSemAcesso: ContaDeTeste;
    analista: ContaDeTeste;
    professor: ContaDeTeste;
    produtor: ContaDeTeste;
  };
  curso: {
    aulas: { aula1: string; aula2: string; aula3: string };
    id: string;
    modulos: { modulo1: string; modulo2: string };
    titulo: string;
  };
  cursoBloqueado: { aulas: { aula1: string }; id: string; modulos: { modulo1: string }; titulo: string };
  materiais: { apostila: string; checklist: string; daAulaFutura: string; rascunho: string };
  cursoLiberacao: {
    aulas: { futura: string; liberada: string; rascunho: string };
    id: string;
    modulos: { modulo1: string };
    titulo: string;
  };
};

export const PACOTE_DE_TESTE: { id: string; nome: string; produtos: string[] };

export function desconectarVendas(db: unknown): Promise<void>;
export function ligarProdutoNaPlataforma(db: unknown, input: { codigo: string; plataforma?: "hotmart" | "ticto" | "kiwify"; produtoId: string }): Promise<void>;
export function ligarProdutoNaHotmart(db: unknown, input: { codigo: string; produtoId: string }): Promise<void>;
export function garantirPacoteDeTeste(db: unknown, codigoNaPlataforma: string, plataforma?: "hotmart" | "ticto" | "kiwify"): Promise<void>;
export function limparVendasDeTeste(db: unknown, input?: { codigos?: string[]; prefixoDoEvento?: string }): Promise<void>;

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
  alunaAcessoExpirado: ContaDeTesteCriada;
  alunoSemAcesso: ContaDeTesteCriada;
  analista: ContaDeTesteCriada;
  professor: ContaDeTesteCriada;
  produtor: ContaDeTesteCriada;
}>;

export function seedEscolaDeTeste(db: unknown): Promise<{
  aluna: ContaDeTesteCriada;
  alunaAcessoExpirado: ContaDeTesteCriada;
  alunoSemAcesso: ContaDeTesteCriada;
  analista: ContaDeTesteCriada;
  professor: ContaDeTesteCriada;
  produtor: ContaDeTesteCriada;
}>;

export function limparProgresso(db: unknown, userIds: string[]): Promise<void>;
export function limparSessoesDeTv(db: unknown, userIds: string[]): Promise<void>;
export function limparConversasDeIa(db: unknown, userIds: string[]): Promise<void>;
export function limparTranscricaoDeTeste(db: unknown, lessonId: string): Promise<void>;
export function limparProvedoresDeIa(db: unknown): Promise<void>;
export function limparComentarios(db: unknown, userIds: string[]): Promise<void>;
export function limparFotoDoPerfil(db: unknown, userIds: string[]): Promise<void>;
export function apagarContaDeTeste(db: unknown, email: string): Promise<void>;
export function limparConfiguracoesDeTeste(db: unknown, keys: string[]): Promise<void>;
export function apagarProdutosDeTeste(db: unknown, prefixoDoTitulo: string): Promise<void>;
export function definirCapaDoProduto(db: unknown, titulo: string, image?: string): Promise<void>;
export function limparComunicacao(db: unknown): Promise<void>;
