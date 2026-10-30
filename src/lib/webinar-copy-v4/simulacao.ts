// Frases da Simulacao completa (docs/30 §1.6, §2.2, §3.5, §4.3, §6.6, §8.6 e D10): o card Simulacao (contador,
// entradas e saidas, avisos de venda, a decisao registrada), as recusas das Server Actions e o que o aluno ve na sala.
// Entram em WEBINAR_COPY.simulacao. Modulo puro, sem imports. Dono: a frente 4b da Simulacao.

export const SIMULACAO_COPY = {
  card: {
    contador: "Contador de plateia",
    contadorModos: { curve: "Real + faixa que varia", fixed: "Real + número fixo", off: "Só o real" },
    contadorDicas: {
      curve: (minimo: number, maximo: number) => `Soma de +${minimo} a +${maximo}: sobe no começo, fica e desce de leve no fim.`,
      fixed: (numero: number) => `O aluno vê quem está na sala + ${numero}.`,
      off: "O aluno vê só quem está na sala."
    },
    somar: "Somar ao real",
    minimo: "Mínimo",
    maximo: "Máximo",
    variacao: "Variação",
    variacaoDica: "Quanto o número sobe ou desce a cada 15 s (0 deixa a faixa lisa).",
    entradas: "Entradas e saídas",
    entradasDesligadas: "Desligadas",
    entradasLigadas: "Ligadas",
    entradasACada: (segundos: number) => `A cada ${segundos} s, com nomes genéricos`,
    entradasDica: "“Ana M. entrou” no chat, com nomes genéricos, nunca de alunos.",
    aCadaSegundos: "A cada (segundos)",
    noMaximo: "No máximo",
    avisosDeVenda: "Notificações de venda",
    avisosDesligados: "Desligadas",
    avisosLigados: "Ligadas",
    avisosDica: "Desligadas por padrão. Cada aviso aparece por 4 s por cima do vídeo, no minuto marcado.",
    avisoTexto: "Texto do aviso",
    avisoExemplo: "Carlos acabou de garantir a vaga na Formação",
    avisoMinuto: "Minuto do vídeo",
    avisoMinutoDica: "Minuto ou minuto:segundo, como 12 ou 12:30.",
    avisoMinutoInvalido: "Use o minuto (12) ou minuto:segundo (12:30).",
    adicionarAviso: "Adicionar aviso",
    removerAviso: "Remover aviso",
    semAvisos: "Nenhum aviso ainda.",
    limiteAvisos: (total: number) => `Até ${total} avisos por sessão.`,
    avisoCdc:
      "Pela lei (CDC, art. 37), nunca anuncie uma sessão gravada como ao vivo fora da área de membros. Dentro dela, o selo e os números simulados são sua decisão e ficam registrados com seu nome e a data.",
    numerosPadrao: "Números de plateia: reais, a não ser na sessão em que você ligar o contador ou as entradas.",
    caixa: "Confirmo a decisão acima para esta sessão.",
    salvar: "Salvar simulação",
    salvando: "Gravando…",
    descartar: "Descartar",
    salva: "Simulação salva.",
    erro: "Não foi possível salvar a simulação. Tente de novo.",
    marqueACaixa: "Marque a confirmação para gravar a decisão.",
    corrijaOsCampos: "Corrija os campos marcados para gravar.",
    numeroInvalido: "Use um número inteiro.",
    segundosInvalidos: (minimo: number, maximo: number) => `Use de ${minimo} a ${maximo} segundos.`,
    maximoInvalido: (maximo: number) => `Use de 0 a ${maximo} entradas.`,
    variacaoInvalida: (maximo: number) => `Use de 0 a ${maximo}.`,
    fechar: "Fechar",
    equipe: "Equipe",
    carregando: "Carregando a simulação…",
    erroCarregar: "Não foi possível carregar a simulação.",
    tentarDeNovo: "Tentar de novo",
    sessaoEncerrada: "Sessão encerrada: a decisão fica registrada como estava.",
    sessaoComecou: "A sessão já começou: o que a turma vê não muda até o fim.",
    congelado: (contador: number, entradas: number, avisos: number) =>
      `Nesta sessão: contador com até +${contador}, ${entradas} ${entradas === 1 ? "entrada" : "entradas"} e ${avisos} ${avisos === 1 ? "aviso" : "avisos"} de venda.`,
    soLiveGravada: "A Simulação existe só na sessão gravada.",
    relatorio: "Números simulados aparecem no relatório só no bloco Simulação."
  },
  /** As recusas das Server Actions do card (simulation-actions.ts). */
  servidor: {
    encerrada: "Essa sessão já terminou: a decisão fica registrada como estava.",
    comecou: "Essa sessão já começou: a Simulação não muda no meio, e o relatório guarda o que a turma viu.",
    fraseNaoBate: "A confirmação não bate com a frase de hoje. Marque de novo.",
    naoExiste: "Essa sessão não existe mais.",
    usarCardNovo: "Esta sessão tem números ou avisos simulados: decida pelo card Simulação, com a frase completa.",
    precisaMigracao: (migracao: string) => `A Simulação completa precisa da atualização do banco (migração ${migracao}).`
  },
  aluno: {
    entrou: (nome: string) => `${nome} entrou`,
    saiu: (nome: string) => `${nome} saiu`,
    rotuloAviso: "Aviso"
  },
  /** Nomes genericos das entradas simuladas (nunca de alunos reais, docs/30 §4.3). */
  nomesGenericos: [
    "Ana M.",
    "Bruno S.",
    "Carla R.",
    "Diego L.",
    "Elisa P.",
    "Felipe C.",
    "Gabriela T.",
    "Henrique A.",
    "Isabela F.",
    "João V.",
    "Karina B.",
    "Lucas N.",
    "Mariana D.",
    "Nicolas G.",
    "Olívia H.",
    "Pedro K.",
    "Rafaela O.",
    "Samuel E.",
    "Tatiana J.",
    "Vinícius Q."
  ]
} as const;
