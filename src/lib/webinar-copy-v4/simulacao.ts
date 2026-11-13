// Frases da Simulacao completa (docs/30 §1.6, §2.2, §3.5, §4.3, §6.6, §8.6 e D10): o card Simulacao (contador,
// entradas e saidas, avisos de venda, a decisao registrada), as recusas das Server Actions e o que o aluno ve na sala.
// Entram em WEBINAR_COPY.simulacao. Modulo puro, sem imports. Dono: a frente 4b da Simulacao. O adendo de 10/11/2026
// (R7, a Simulacao na Live ao vivo) acrescenta as frases da live: o aviso do CDC, o minuto do aviso de venda contado da
// live, a sessao que ja comecou, as recusas (o Replay, o selo na live, a migracao 202611100002) e os presentes simulados
// do console.

export const SIMULACAO_COPY = {
  card: {
    contador: "Participantes simulados",
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
    numerosPadrao: "Números de plateia: reais, a não ser na sessão em que você somar participantes simulados ou ligar as entradas.",
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
    sessaoComecou: "A sessão já começou: os participantes simulados mudam aqui ou no console; as entradas e os avisos de venda ficam como estão até o fim.",
    congelado: (contador: number, entradas: number, avisos: number) =>
      `Nesta sessão: contador com até +${contador}, ${entradas} ${entradas === 1 ? "entrada" : "entradas"} e ${avisos} ${avisos === 1 ? "aviso" : "avisos"} de venda.`,
    soLiveGravada: "A Simulação existe só na sessão gravada.",
    relatorio: "Números simulados aparecem no relatório só no bloco Simulação.",
    /* A Live ao vivo (R7). */
    avisoCdcLive:
      "Pela lei (CDC, art. 37), nunca divulgue fora da área de membros os números simulados como se fossem reais. Dentro dela, os números e os avisos simulados são sua decisão e ficam registrados com seu nome e a data.",
    numerosPadraoLive: "Números de plateia: reais, a não ser que você some participantes simulados ou ligue as entradas da live.",
    sessaoLive: (quando: string) => `Live de ${quando}`,
    avisoMinutoLive: "Minuto da live",
    avisoMinutoLiveDica: "Contado do Começar para todos: minuto ou minuto:segundo, como 12 ou 12:30.",
    liveComecou: "A live já começou: os participantes simulados mudam aqui ou no console; as entradas e os avisos de venda ficam como estão até o fim.",
    /* A revisão v8 (achado 6): o botão do aviso de que a simulação mudou em outro lugar. */
    recarregar: "Recarregar"
  },
  /** As recusas das Server Actions do card (simulation-actions.ts). */
  servidor: {
    encerrada: "Essa sessão já terminou: a decisão fica registrada como estava.",
    comecou: "Essa sessão já começou: as entradas e os avisos de venda não mudam no meio, e o relatório guarda o que a turma viu. Os participantes simulados mudam em Participantes simulados.",
    fraseNaoBate: "A confirmação não bate com a frase de hoje. Marque de novo.",
    naoExiste: "Essa sessão não existe mais.",
    usarCardNovo: "Esta sessão tem números ou avisos simulados: decida pelo card Simulação, com a frase completa.",
    precisaMigracao: (migracao: string) => `A Simulação completa precisa da atualização do banco (migração ${migracao}).`,
    /* A Live ao vivo (R7). */
    semReplay: "O Replay nunca tem Simulação.",
    liveSemSelo: "A live já é ao vivo: o selo \"Ao vivo\" da sessão gravada não existe nela.",
    liveComecou: "Essa live já começou: as entradas e os avisos de venda não mudam no meio, e o relatório guarda o que a turma viu. Os participantes simulados mudam em Participantes simulados.",
    precisaMigracaoLive: (migracao: string) => `A Simulação na live ao vivo precisa da atualização do banco (migração ${migracao}).`,
    /* Os participantes simulados mudados a qualquer momento (D79). */
    plateiaEncerrada: "Essa sessão já terminou: os participantes simulados não mudam mais.",
    plateiaIgual: "Esse já é o número somado agora.",
    plateiaLimite: (limite: number) => `Esta sessão chegou ao limite de ${limite} mudanças dos participantes simulados.`,
    precisaMigracaoPlateia: (migracao: string) => `Mudar os participantes simulados precisa da atualização do banco (migração ${migracao}).`,
    /* A revisão v8 (achado 6): o card aberto antes de uma mudança feita no console ou noutra aba. */
    mudouEmOutroLugar: "A simulação desta sessão mudou em outro lugar. Recarregue para ver o número de agora."
  },
  /** O console da equipe (R7): a parte simulada separada do real, ao lado de "12 presentes · pico 14". */
  console: {
    simulados: (n: number) => `+${n.toLocaleString("pt-BR")} simulados`
  },
  /**
   * Os participantes simulados mudados a qualquer momento (docs/30 D79, 11/11/2026): o controle do console (no alto da
   * entrada Presença, aberto tambem pelo selo dos presentes) e do card Simulacao do editor depois do comeco.
   */
  plateia: {
    titulo: "Participantes simulados",
    descricao: "Somados ao número de quem assiste que o aluno vê. Você vê a parte simulada separada do real.",
    agora: "Somados agora",
    valor: (n: number) => `+${n.toLocaleString("pt-BR")}`,
    faixa: (minimo: number, maximo: number) => `de +${minimo.toLocaleString("pt-BR")} a +${maximo.toLocaleString("pt-BR")}`,
    campo: "Somar à plateia",
    campoDica: "Escolha um atalho ou digite o número que soma ao real.",
    atalhos: "Atalhos",
    atalhoRotulo: (n: number) => `Somar +${n.toLocaleString("pt-BR")}`,
    aplicar: "Aplicar",
    aplicando: "Aplicando…",
    tirar: "Tirar",
    tirarRotulo: "Tirar os participantes simulados (volta a +0)",
    igual: "Esse já é o número somado agora.",
    numeroInvalido: (maximo: number) => `Use um número inteiro de 0 a ${maximo.toLocaleString("pt-BR")}.`,
    antesDoComeco: "Antes do começo, o número novo vale na hora.",
    noAr: "No ar, o número sobe ou desce em linha reta em 1 min 30 s, igual para todos.",
    subindo: (n: number) => `A sala está chegando a +${n.toLocaleString("pt-BR")}.`,
    ultima: (nome: string, quando: string, origem: string) => `Mudado por ${nome} em ${quando}, ${origem}.`,
    origens: { console: "pelo console", editor: "pelo editor" },
    semMudanca: "Ainda sem mudança no console nem no editor.",
    encerrada: "A sessão terminou: os participantes simulados não mudam mais.",
    semPermissao: "Só quem publica na Comunicação muda os participantes simulados.",
    travados: "Os participantes simulados mudam a qualquer momento, também no ar, aqui ou no console. As entradas e os avisos de venda simulados travam quando a sessão começa.",
    verNoEditor: "Ver no editor",
    abrirConsole: "Mudar no console",
    aplicado: (n: number) => (n > 0 ? `Participantes simulados: +${n.toLocaleString("pt-BR")}. A sala recebe em segundos.` : "Participantes simulados tirados. A sala recebe em segundos."),
    abrirControle: (rotulo: string) => `${rotulo}. Abrir os participantes simulados`,
    previa: "A simulação não aparece na prévia.",
    historico: "Mudanças",
    mudancaLinha: (quando: string, valor: string, nome: string) => `${quando} · ${valor} · ${nome}`,
    antes: "antes do começo",
    /* "Variar sozinho" (rodada v9, pedido do produtor de 12/11/2026; docs/30 D90). */
    variar: {
      titulo: "Variar sozinho",
      dica: "O número sobe e desce sozinho em volta do que você somou, igual para todos os alunos.",
      ate: "Varia até (%)",
      direcao: "Para onde varia",
      direcoes: { both: "Para mais e para menos", down: "Só para menos", up: "Só para mais" },
      /* Os dois campos do intervalo numa linha so: "Muda a cada (segundos)  [20] a [60]". */
      aCada: "Muda a cada (segundos)",
      aCadaDe: "Muda a cada, de (segundos)",
      aCadaAte: "Muda a cada, até (segundos)",
      aCadaEntre: "a",
      exemplo: (numero: number, percentual: number, minimo: number, maximo: number) =>
        `Com +${numero.toLocaleString("pt-BR")} e ${percentual}%, o número fica entre ${minimo.toLocaleString("pt-BR")} e ${maximo.toLocaleString("pt-BR")}.`,
      ritmo: (de: number, ate: number) => (de === ate ? `Muda a cada ${de} s.` : `Muda a cada ${de} a ${ate} s, em horas sorteadas.`),
      exemploSemNumero: "Digite o número que soma ao real para ver o exemplo.",
      percentualInvalido: (minimo: number, maximo: number) => `Use de ${minimo} a ${maximo}%.`,
      segundosInvalidos: (minimo: number, maximo: number) => `Use de ${minimo} a ${maximo} segundos.`,
      ordemInvalida: "O segundo número precisa ser maior ou igual ao primeiro.",
      resumo: (percentual: number, direcao: string, de: number, ate: number) =>
        `Varia sozinho até ${percentual}%, ${direcao}, a cada ${de === ate ? `${de} s` : `${de} a ${ate} s`}.`,
      resumoDirecoes: { both: "para mais e para menos", down: "só para menos", up: "só para mais" },
      curto: (percentual: number) => `varia até ${percentual}%`,
      aplicado: (n: number, percentual: number) => `Participantes simulados: +${n.toLocaleString("pt-BR")}, variando até ${percentual}%. A sala recebe em segundos.`,
      igual: "Esse já é o número e a variação de agora.",
      soComNumero: "A variação vale quando o número somado é maior que zero."
    }
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
  ],
  /**
   * Os nomes das miniaturas dos participantes simulados que a equipe nao criou (docs/30 D120): cada primeiro nome com
   * cada inicial, no formato de todo aluno na sala (o primeiro nome e a inicial do sobrenome, D64). Os 20 primeiros
   * nomes e as iniciais cobrem os `nomesGenericos` das entradas: quem "entrou" no chat tem miniatura. Nunca nomes de
   * alunos reais.
   */
  primeirosNomes: [
    "Ana", "Bruno", "Carla", "Diego", "Elisa", "Felipe", "Gabriela", "Henrique", "Isabela", "João",
    "Karina", "Lucas", "Mariana", "Nicolas", "Olívia", "Pedro", "Rafaela", "Samuel", "Tatiana", "Vinícius",
    "Amanda", "André", "Beatriz", "Caio", "Camila", "Daniela", "Eduardo", "Fernanda", "Gustavo", "Helena",
    "Igor", "Júlia", "Larissa", "Leandro", "Letícia", "Marcelo", "Marina", "Natália", "Otávio", "Patrícia",
    "Paulo", "Renata", "Ricardo", "Roberta", "Rodrigo", "Sabrina", "Sérgio", "Simone", "Thiago", "Vanessa",
    "Vitor", "Aline", "Bianca", "Cláudio", "Débora", "Fábio", "Jéssica", "Luana", "Márcio", "Priscila"
  ],
  iniciais: ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "V"]
} as const;
