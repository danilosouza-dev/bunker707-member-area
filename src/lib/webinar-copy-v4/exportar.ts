// Frases do botao Exportar e dos CSVs com os nomes do Zoom (docs/30 §2.5, §3.4, §3.5 e §3.7) e dos blocos novos do
// relatorio (Oferta, Respostas do Assistente e a Simulacao completa); entram em WEBINAR_COPY.exportar. Os cabecalhos
// das colunas dos CSVs ficam aqui, na ordem de §3.7. Modulo puro, sem imports. Dono: a frente 4a do relatorio e dos CSVs.

export const EXPORTAR_COPY = {
  botao: "Exportar",
  menuRotulo: "Escolha o relatório",
  relatorios: {
    attendee: "Attendee (lista por aluno)",
    performance: "Performance (números da sessão)",
    poll: "Poll (respostas das enquetes)",
    qa: "Q&A (perguntas)",
    registration: "Registration (vagas)",
    simulacao: "Simulação (só a parte simulada)",
    survey: "Survey (pesquisa do fim)"
  },
  /** No painel (o periodo inteiro) so estes dois fazem sentido (webinarExportSchema). */
  relatoriosDoPeriodo: {
    performance: "Performance (todas as sessões do período)",
    simulacao: "Simulação (só a parte simulada)"
  },
  pronto: "CSV pronto.",
  erro: "Não foi possível gerar o CSV. Tente de novo.",
  sessaoNaoExiste: "Essa sessão não existe mais.",
  migracaoPendente: (migracao: string) => `Esta parte precisa da atualização do banco (migração ${migracao}).`,
  semLinhas: "Nada para exportar nesta sessão.",
  surveyVazio: "A pesquisa do fim ainda não existe: o arquivo sai só com as colunas.",
  cabecalhoPerformance: "Estes números são reais; a simulação não entra em nenhum deles.",
  cabecalhoSimulacao: "Estes números são da simulação e não entram em nenhum outro número.",
  colunas: {
    registration: ["Nome", "E-mail", "Data da vaga", "Situação", "Link de origem", "Aviso de origem", "Compareceu", "Viu o replay", "Lembrete 24 h", "Lembrete 1 h"],
    attendee: [
      "Compareceu",
      "Nome",
      "E-mail",
      "Hora da vaga",
      "Entrou",
      "Saiu",
      "Entradas",
      "Tempo na sessão (min)",
      "Até o fim (95 %)",
      "Mensagens",
      "Reações",
      "Perguntas",
      "Enquetes respondidas",
      "Oferta clicada (variante)",
      "Pontuação (0–100)",
      "Dispositivo"
    ],
    performance: [
      "Webinário",
      "Sessão",
      "Tipo",
      "Data",
      "Duração",
      "Vagas garantidas",
      "Presentes",
      "Comparecimento",
      "Pico",
      "Minuto do pico",
      "Tempo médio",
      "Tempo máximo",
      "Até o fim",
      "Mensagens",
      "Alunos que comentaram",
      "Reações",
      "Perguntas feitas",
      "Respondidas",
      "Dispensadas",
      "Enquetes respondidas",
      "Viram a oferta",
      "Cliques",
      "Compras",
      "Conversão",
      "Replay vistos"
    ],
    qa: ["Nº", "Hora", "Minuto do vídeo", "Nome", "E-mail", "Pergunta", "Votos", "Situação", "Respondida por", "Resposta", "Ao vivo", "Hora da resposta"],
    poll: ["Enquete", "Pergunta", "Nome", "E-mail", "Hora", "Minuto do vídeo", "Resposta(s)"],
    survey: ["Nome", "E-mail", "Hora", "Pergunta", "Resposta"],
    simulacao: ["Tipo", "Minuto do vídeo", "Solta em", "Persona", "Texto", "Disparou"]
  },
  /** O CSV Simulacao do periodo (painel Lives gravadas): as colunas de §3.7 depois de qual webinario e qual sessao. */
  colunasDoPeriodo: { simulacao: ["Webinário", "Sessão", "Data"] },
  valores: {
    sim: "Sim",
    nao: "Não",
    vagaGarantida: "Vaga garantida",
    cancelada: "Cancelada",
    aberta: "Aberta",
    respondida: "Respondida",
    dispensada: "Dispensada",
    tipos: { live: "Ao vivo", replay: "Replay", simulated: "Gravada" },
    alunoAnonimo: (n: number) => `Aluno ${n}`,
    equipe: "Equipe",
    assistente: "Assistente",
    simulacaoTipos: { aviso: "Aviso de venda", comentario: "Comentário do roteiro", contador: "Contador", entrada: "Entrada" },
    soltaEm: { at_offset: "Num minuto do vídeo", manual: "Pelo botão da equipe", on_phrase: "Quando o apresentador diz" },
    contador: (regra: string, maior: number, real: number) => `${regra} · maior número mostrado: ${maior} · participantes de verdade: ${real}`,
    entrada: (cadaSegundos: number, ate: number, mostradas: number) => `uma a cada ${cadaSegundos} s, até ${ate} · ${mostradas} mostradas`,
    dispositivo: { desktop: "computador", mobile: "celular" }
  },
  blocos: {
    oferta: "Oferta",
    assistente: "Respostas do Assistente"
  },
  oferta: {
    viram: "Viram a oferta",
    cliques: "Cliques",
    compras: "Compras",
    receita: "Receita",
    conversao: "Conversão",
    sobreCliques: (n: number) => `${n} % dos cliques`,
    porVariante: "Por variante",
    colunaVariante: "Variante",
    variante: (letra: string) => `Variante ${letra}`,
    semOferta: "Esta sessão não teve oferta.",
    receitaAMedir: "—",
    definicoes: {
      viram: "presentes na janela da oferta",
      compras: "pelos webhooks de venda, em até 7 dias depois do clique",
      conversao: "compras ÷ participantes (e ÷ cliques, abaixo)"
    }
  },
  assistente: {
    respostas: "Respostas",
    tempoMedio: "Tempo médio de resposta",
    corrigidas: "Corrigidas pela equipe",
    apagadas: "Apagadas pela equipe",
    pedidosDeEquipe: "Pediram para falar com a equipe",
    segundos: (n: number) => `${n} s`,
    semRespostas: "O Assistente não respondeu nesta sessão.",
    nota: "Respostas reais a alunos reais: ficam fora da Simulação e das mensagens de alunos e equipe."
  },
  simulacao: {
    contador: "Contador simulado",
    regra: { curve: "real + faixa que varia", fixed: "real + número fixo", off: "real" },
    maiorNumero: (n: number) => `maior número mostrado: ${n}`,
    real: (n: number) => `participantes de verdade: ${n}`,
    entradas: "Entradas simuladas",
    avisosDeVenda: "Avisos de venda simulados",
    apareceram: (n: number) => (n === 1 ? "1 apareceu" : `${n} apareceram`),
    porSoltaEm: "Comentários do roteiro por Solta em"
  },
  quedas: {
    trechoDaTranscricao: "No vídeo, nesse minuto:",
    semTranscricao: "Sem transcrição deste trecho."
  }
} as const;
