// Frases do "Comeca quando voce entra" (docs/30 §1.2, §1.6, §2.2, §2.7 e A14): o card Sessoes do editor, a pagina do
// webinario e a sala na espera. Entram em WEBINAR_COPY.jit. Modulo puro; o unico import e o das frases do aluno
// (jit-aluno.ts, um modulo folha que o contador da Inicio le sem trazer estas). Dono: a frente 4e do just-in-time.

import { JIT_ALUNO_COPY, jitHoraDe } from "./jit-aluno";

export const JIT_COPY = {
  card: {
    titulo: "Começa quando você entra",
    descricao: "A sala abre no próximo horário para quem chega; quem entra no mesmo horário forma a turma.",
    ligar: "Ligar Começa quando você entra",
    ligado: "Ligado: a página mostra a contagem até o próximo horário e o Entrar, sem Garantir vaga.",
    desligado: "Desligado: valem só as sessões marcadas acima.",
    aCada: "Uma sessão a cada",
    minutos: (n: number) => `${n} min`,
    janela: "Entre",
    janelaAte: "e",
    horaDe: jitHoraDe,
    horarioDeBrasilia: "horário de Brasília",
    inicioDaJanela: "Início da janela",
    fimDaJanela: "Fim da janela",
    entradaAtrasada: "Entrada atrasada",
    ateOFim: "até o fim",
    ateMinutos: (n: number) => `até ${n} min`,
    minutosDepois: "Minutos depois do começo",
    entradaAtrasadaDica:
      "Até o fim: quem chega entra na sessão que já começou, no minuto em que ela está. Até um minuto: depois dele, quem chega espera o próximo horário.",
    simulacao: "Simulação das sessões que nascem aqui",
    simulacaoDica: "Cada sessão copia esta decisão ao nascer. Os números simulados aparecem no relatório só no bloco Simulação.",
    caixa: "Confirmo a decisão acima para as sessões que nascem aqui.",
    decididoPor: (nome: string, quando: string) => `Decisão de ${nome} em ${quando}.`,
    precisaPublicar: "Só quem publica na Comunicação liga o selo ou os números simulados.",
    salvar: "Salvar",
    salvando: "Salvando…",
    salvo: "Começa quando você entra salvo.",
    erro: "Não foi possível salvar. Tente de novo.",
    corrijaOsCampos: "Corrija os campos marcados para salvar.",
    marqueACaixa: "Marque a confirmação para gravar a decisão.",
    semMudanca: "Nenhuma mudança para salvar.",
    semVideo: "Cole o endereço do vídeo no card Dados e salve antes de ligar.",
    resumo: (minutos: number, de: string, ate: string) => `Começa quando você entra: a cada ${minutos} min, das ${de} às ${ate} (horário de Brasília)`,
    turma: "Quem entrar no mesmo horário vê os comentários uns dos outros; os de outros horários do dia aparecem pelo segundo em que foram escritos."
  },
  aluno: JIT_ALUNO_COPY,
  /** As recusas da rota POST /api/webinars/[id]/jit e da Server Action do card. */
  servidor: {
    desligado: "Este webinário não tem Começa quando você entra.",
    foraDoHorario: "A sala abre 15 min antes do próximo horário.",
    soLiveGravada: "Começa quando você entra existe só na Live gravada.",
    cancelado: "Esse webinário foi cancelado.",
    precisaMigracao: (migracao: string) => `Começa quando você entra precisa da atualização do banco (migração ${migracao}).`
  },
  admin: {
    sessoesDoDia: "Sessões que nasceram hoje",
    nasceuAs: (hora: string) => `Começou às ${hora}`,
    nenhumaHoje: "Ninguém entrou hoje ainda."
  }
} as const;
