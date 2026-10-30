// Frases do Assistente de IA, dos atendentes e do modo hibrido (docs/30 §1.6, §2.4, §6.6 e D24): o card Assistente do
// editor, o painel Atendimento do console, o que o aluno ve (o selo Assistente ja esta em WEBINAR_COPY.sala.selos), o
// aviso do sino quando a equipe responde depois e as recusas das acoes. Entram em WEBINAR_COPY.assistente. Modulo puro,
// sem imports. Dono: a frente 4c do Assistente.

export const ASSISTENTE_COPY = {
  card: {
    titulo: "Assistente",
    descricao: "Responde com o selo Assistente a perguntas da turma, com o que o vídeo diz e as respostas abaixo. Nunca finge ser aluno nem equipe.",
    ligar: "Ligar o Assistente neste webinário",
    responderTudoPadrao: "Começar cada sessão com Responder tudo",
    responderTudoDica: "Desligado, ele responde só quando chamado: na aba Perguntas ou com @assistente no chat.",
    perguntasERespostas: "Perguntas e respostas",
    perguntasERespostasDica: "O que o Assistente precisa saber além do vídeo: preço, prazo, garantia, como acessar.",
    pergunta: "Pergunta",
    resposta: "Resposta",
    adicionar: "Adicionar pergunta",
    remover: "Remover",
    salvar: "Salvar assistente",
    salvo: "Assistente salvo.",
    erro: "Não foi possível salvar o assistente. Tente de novo.",
    desligadoNoAmbiente: "O Assistente não está ligado neste ambiente.",
    semIa: "Nenhuma conexão de IA ativa: ligue uma em Configurações › IA.",
    salveOWebinarioAntes: "Salve o webinário antes de montar o Assistente.",
    carregando: "Carregando o Assistente…",
    erroCarregar: "Não foi possível ler o Assistente.",
    tentarDeNovo: "Tentar de novo",
    semPerguntas: "Nenhuma pergunta cadastrada. O Assistente responde só com o que o vídeo diz.",
    contador: (total: number, maximo: number) => `${total} de ${maximo}`,
    somenteLeitura: "Só quem edita a Comunicação muda o Assistente.",
    numero: (n: number) => `Pergunta ${n}`
  },
  console: {
    titulo: "Atendimento",
    responderTudo: "Responder tudo",
    responderTudoLigado: "O Assistente responde as perguntas novas que ninguém assumiu.",
    responderTudoDesligado: "O Assistente responde só quando chamado.",
    online: "Atendendo agora",
    ausente: "Ausente",
    ficarOnline: "Atender",
    ficarAusente: "Pausar",
    atendentes: "Quem está atendendo",
    ninguemAtendendo: "Ninguém atendendo: o aluno vê que a equipe responde depois pelo sino.",
    fila: "Perguntas novas",
    assumir: "Assumir",
    assumida: (nome: string) => `Com ${nome}`,
    devolver: "Devolver para a fila",
    passarPara: "Passar para",
    pediuEquipe: "Pediu a equipe",
    corrigir: "Corrigir resposta",
    corrigida: "Resposta corrigida.",
    semPerguntas: "Nenhuma pergunta esperando.",
    assistenteDesligado: "O Assistente está desligado neste webinário.",
    carregando: "Carregando o atendimento…",
    erroCarregar: "Não foi possível ler o atendimento. Tentando de novo…",
    comVoce: "Com você",
    abertas: (n: number) => (n === 1 ? "1 pergunta aberta" : `${n} perguntas abertas`),
    doChat: "Do chat",
    daAbaPerguntas: "Da aba Perguntas",
    responder: "Responder",
    respostaPlaceholder: "Escreva a resposta",
    respostaEnviada: "Resposta enviada.",
    respondidaPeloAssistente: "Respondida pelo Assistente",
    assistenteRespondendo: "O Assistente está respondendo",
    assistenteNaoRespondeu: "O Assistente não respondeu",
    salvarCorrecao: "Salvar correção",
    cancelar: "Cancelar",
    escolherAtendente: "Escolha quem atende"
  },
  aluno: {
    falarComAEquipe: "Falar com a equipe",
    pedidoEnviado: "Pronto: a equipe vai ver a sua pergunta.",
    equipeRespondeDepois: "A equipe responde depois pelo sino.",
    chamarAssistente: "Escreva @assistente para perguntar ao Assistente.",
    respondendo: "O Assistente está respondendo…",
    limite: "Você já fez muitas perguntas ao Assistente agora. Tente de novo em 1 minuto.",
    naoEncontrada: "Pergunta não encontrada.",
    indisponivel: "Não foi possível chamar a equipe agora. Tente de novo."
  },
  /** O sino quando a equipe responde depois (pergunta com "Falar com a equipe" ou fora da sessao). */
  sino: {
    titulo: (titulo: string) => `Resposta da equipe: ${titulo}`,
    corpo: (resposta: string) => resposta
  },
  /** As recusas das acoes da equipe (409/404/400 com a frase). */
  erros: {
    sessaoInexistente: "Essa sessão não existe mais.",
    perguntaInexistente: "Essa pergunta não existe mais.",
    mensagemInexistente: "Essa mensagem não existe mais.",
    soRespostaDoAssistente: "Só uma resposta do Assistente pode ser corrigida aqui.",
    atendenteInvalido: "Escolha alguém que está atendendo nesta sessão.",
    precisaMigracao: (migracao: string) => `O banco ainda não tem a atualização ${migracao}. Aplique a migração e tente de novo.`
  },
  /** O que o Assistente diz quando nao sabe (nunca inventa: chama a equipe). */
  naoSei: "Não tenho essa informação. Peça para falar com a equipe que alguém responde."
} as const;
