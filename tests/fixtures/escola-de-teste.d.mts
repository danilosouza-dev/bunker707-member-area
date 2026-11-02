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

export const WEBINARIO_DE_TESTE: { descricao: string; id: string; sessaoId: string; slug: string; titulo: string };
export function seedWebinarioDeTeste(db: unknown): Promise<{ scheduledAt: string }>;
export function limparWebinarios(db: unknown): Promise<void>;

export const LIVE_GRAVADA_DE_TESTE: { gravacaoId: string; id: string; sessaoId: string; slug: string; titulo: string };
export function seedLiveGravadaEncerradaDeTeste(db: unknown): Promise<{ endedAt: string; startedAt: string }>;
export const LIVE_GRAVADA_NO_AR_DE_TESTE: {
  descricao: string;
  gravacaoId: string;
  id: string;
  mensagens: { cedo: string; tarde: string };
  origemId: string;
  sessaoId: string;
  slug: string;
  textos: { cedo: string; tarde: string };
  titulo: string;
  videoUrl: string;
};
export function seedLiveGravadaDeTeste(db: unknown, opcoes?: { comecouHa?: number; duracaoSegundos?: number; seloAoVivo?: boolean }): Promise<{ scheduledAt: string }>;

export const AMBIENTE_DA_SALA_AO_VIVO_DE_TESTE: {
  WEBINAR_JWT_APP_ID: string;
  WEBINAR_JWT_SECRET: string;
  WEBINAR_MEET_DOMAIN: string;
  WEBINAR_RECORDER_DISPATCH: string;
  WEBINAR_RECORDER_WEBHOOK_SECRET: string;
};
export function ambienteDaSalaAoVivo(env?: Record<string, string | undefined>): typeof AMBIENTE_DA_SALA_AO_VIVO_DE_TESTE;
export const LIVE_AO_VIVO_DE_TESTE: { coApresentador: "professor"; descricao: string; equipe: "analista"; id: string; roomName: string; sessaoId: string; slug: string; titulo: string };
export function seedLiveAoVivoDeTeste(
  db: unknown,
  opcoes?: { comecouHa?: number; equipeModera?: boolean; status?: "live" | "scheduled" | "waiting" }
): Promise<{ scheduledAt: string; startedAt: string | null }>;
export function abrirEnqueteDeTeste(
  db: unknown,
  opcoes: { options: string[]; question: string; sessionId: string; webinarId: string }
): Promise<{ optionIds: string[]; pollId: string }>;

/* Webinarios, fase 4 (docs/30 §11): as sementes dos paineis, da Oferta, da Simulacao e do "Comeca quando voce entra". */
export const LIVE_AO_VIVO_ENCERRADA_DE_TESTE: { id: string; sessaoId: string; slug: string; titulo: string };
export function seedLiveAoVivoEncerradaDeTeste(db: unknown): Promise<{ endedAt: string; startedAt: string }>;
export const OFERTA_DE_TESTE: {
  checkoutOrigem: string;
  id: string;
  produtoId: string;
  titulo: string;
  variantes: {
    badge: string | null;
    checkoutUrl: string;
    enabled: boolean;
    headline: string;
    label: "A" | "B" | "C" | "D";
    priceFromLabel: string | null;
    priceLabel: string | null;
    weight: number;
  }[];
};
export function seedOfertaDeTeste(
  db: unknown,
  opcoes?: { mostraEm?: number; prazo?: number | null; someEm?: number | null }
): Promise<{ ofertaId: string; variantes: { enabled: boolean; label: "A" | "B" | "C" | "D"; weight: number }[] }>;
export const SIMULACAO_DE_TESTE: { resumo: { counter_max: number; joins_shown: number; sale_notices_shown: number } };
export function seedSimulacaoDeTeste(db: unknown, opcoes?: { sessaoId?: string }): Promise<{ ackText: string; resumo: { counter_max: number; joins_shown: number; sale_notices_shown: number } }>;
export const JIT_DE_TESTE: { gravacaoId: string; id: string; slug: string; titulo: string; videoUrl: string };
export function seedJitDeTeste(db: unknown, opcoes?: { aCada?: 15 | 30 | 60; entradaAtrasada?: number | null }): Promise<{ everyMinutes: number; lateJoinMinutes: number | null }>;
