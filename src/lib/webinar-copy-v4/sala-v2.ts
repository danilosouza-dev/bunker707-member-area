// Frases da sala do aluno V2 (docs/31 §1, V2-1 a V2-19): o tema, o painel, a visao do video, a enquete no palco e os
// selos. Entram em WEBINAR_COPY.salaV2 e passam pela PROIBIDAS_WEBINARIO (tests/webinarios-frases.test.mjs). Modulo
// puro, sem imports. Dono: a fase 1 do redesign V2. As frases que a sala ja tinha continuam em WEBINAR_COPY.sala.

export const SALA_V2_COPY = {
  /**
   * A janela que avisa que a live acabou, quando o aluno estava na sala (docs/30 D104): no lugar do dialogo do motor de
   * video, com o desenho da area.
   */
  encerrada: {
    titulo: "A live foi encerrada",
    texto: "Obrigado por participar. Você já pode sair da sala.",
    ok: "OK"
  },
  /**
   * Os avisos da sala no estilo do YouTube (o aviso invertido, RoomSnackbar): os do motor somem, e so estes, mais os
   * passageiros da barra de antes e os sucessos do chat e das Perguntas, aparecem no aviso. A acao do microfone sem som
   * e o "Configurações" da barra (WEBINAR_COPY.aoVivo.configuracoes), que abre o painel. As duas da tela sao do console.
   */
  avisos: {
    gravacaoComecou: "Esta live começou a ser gravada.",
    maoAbaixada: "A equipe abaixou a sua mão.",
    semSomDoMicrofone: "Não está chegando som do seu microfone.",
    telaFalhou: "Não deu para compartilhar a tela. Tente de novo.",
    telaNegada: "O navegador não deixou compartilhar a tela. Libere nas permissões do site."
  },
  /**
   * O cabecalho (V2-3, no estilo do YouTube): a linha de baixo do titulo no computador comeca pelo numero ("128
   * assistindo agora · Quinta, 30 de outubro · 20:00 · 60 min · com Danilo Souza") e a do celular tambem ("128
   * assistindo agora · com Danilo Souza"); os trechos se juntam com " · ", e o milhar sai como no Brasil ("1.234
   * assistindo agora"). O "{n} assistindo" de WEBINAR_COPY.sala fica para o topo do vertical. Sem a logo de Marca, o
   * nome da escola em texto no lugar dela (e o alt da logo).
   */
  cabecalho: {
    assistindoAgora: (n: number) => (n === 1 ? "1 assistindo agora" : `${n.toLocaleString("pt-BR")} assistindo agora`),
    com: (nome: string) => `com ${nome}`,
    duracao: (minutos: number) => `${minutos} min`,
    marca: "Bunker707"
  },
  /**
   * O chat da sala no estilo do YouTube (o comentario; no console e na gaveta do vertical, o balao do Zoom, V2-9): o
   * leitor de tela ouve quem escreveu antes do texto ("Marina R., Equipe, há 2 minutos: ", so os trechos que existem: o
   * aluno nao tem papel, o Replay nao tem tempo e, com o nome igual ao papel, so o papel: "Assistente, há 2 minutos: ");
   * a linha do autor e so para quem ve. A fixada leva "Fixada pela equipe" acima do nome. O menu ⋮ "Mais opções" do
   * cabecalho do painel (o ⋯ da linha do campo no balao) leva o Remover minhas mensagens.
   */
  chat: {
    autor: (partes: readonly string[]) => `${partes.join(", ")}: `,
    fixadaPelaEquipe: "Fixada pela equipe",
    maisOpcoes: "Mais opções",
    /** O nome da minha mensagem na linha de baixo do balao e para o leitor de tela (o protótipo: "Você · 20:43"). */
    voce: "Você"
  },
  /**
   * A enquete no meio do palco (V2-10): o rotulo pelo tipo, "Enviar resposta" e "Responder depois", que recolhe para o
   * card do chat ("Enquete aberta · você deixou para depois" com "Responder agora"); o resultado compartilhado no mesmo
   * lugar, com o total de respostas e "Fechar". Quando ela abre sozinha, o leitor de tela ouve "Enquete aberta: {pergunta}"
   * (ou "Enquete · resultado: {pergunta}"): com a pergunta, a segunda enquete que entra no lugar da primeira tambem e
   * anunciada.
   */
  enquete: {
    anuncioAberta: (pergunta: string) => `Enquete aberta: ${pergunta}`,
    anuncioResultado: (pergunta: string) => `Enquete · resultado: ${pergunta}`,
    deixouParaDepois: "Enquete aberta · você deixou para depois",
    enviarResposta: "Enviar resposta",
    fechar: "Fechar",
    respostaMultipla: "Enquete · resposta múltipla",
    respostaUnica: "Enquete · resposta única",
    respostas: (n: number) => (n === 1 ? "1 resposta" : `${n} respostas`),
    responderAgora: "Responder agora",
    responderDepois: "Responder depois",
    resultado: "Enquete · resultado"
  },
  /**
   * O painel do chat (V2-6 a V2-8): o balao da barra diz o que faz ("Esconder o chat" com o painel aberto, "Mostrar o
   * chat" com ele fechado e, com mensagens novas, "Mostrar o chat, 3 mensagens novas", a contagem que vem de
   * WEBINAR_COPY.sala.mensagensNovas), o X do painel fecha e a lista das abas (abaixo de lg) e o trilho a direita (a
   * partir de lg, no estilo do YouTube) se chamam "Painel da sala": cada um so numa largura. O balao fica so abaixo de lg.
   */
  painel: {
    esconder: "Esconder o chat",
    fechar: "Fechar o painel",
    mostrar: "Mostrar o chat",
    mostrarComNovas: (novas: string) => `Mostrar o chat, ${novas}`,
    rotulo: "Painel da sala"
  },
  /**
   * As Perguntas no estilo do YouTube (a partir de lg): os chips de filtro numa linha so (Todas, Sem resposta,
   * Respondidas, Minhas; "Todas" e "Respondidas" vem de WEBINAR_COPY.sala.filtros), o grupo "Filtrar perguntas", o
   * botao de ordenar do cabecalho ("Ordenar perguntas", com Mais votadas e Mais recentes de WEBINAR_COPY.sala.ordem) e
   * o vazio que diz o filtro (o de "Todas" e WEBINAR_COPY.sala.semPerguntas). Cada pergunta e um comentario, e a
   * resposta escrita da Equipe ou do Assistente fica no fio "1 resposta", que abre e fecha. O envio do campo e
   * "Perguntar" (o "Fazer uma pergunta" de WEBINAR_COPY.sala fica so no campo vazio).
   */
  perguntas: {
    /* O fio da pergunta (10/11/2026): quem perguntou comenta a resposta da equipe, e a equipe responde de novo. */
    adicioneResposta: "Adicione uma resposta",
    aceiteParaResponder: "Para responder, aceite as regras do chat uma vez.",
    aindaSemResposta: "Você pode responder depois que a equipe responder.",
    fioCheio: "Esta conversa chegou ao limite de respostas.",
    responder: "Responder",
    respostaEnviada: "Resposta enviada.",
    /** O aviso da sala quando a equipe fala numa pergunta do aluno com a aba Perguntas fora da tela (docs/30 D100). */
    respostaNova: "Responderam a sua pergunta.",
    /** A acao do aviso: abre a aba Perguntas. */
    verResposta: "Ver",
    /** O nome do item Perguntas com resposta nova ("Perguntas, 2 respostas novas"). */
    respostasNovas: (n: number) => (n === 1 ? "1 resposta nova" : `${n} respostas novas`),
    /* O campo de responder fechou porque a pergunta deixou de aceitar resposta (reaberta, dispensada, apagada ou o fio cheio). */
    respostaFechada: "Esta pergunta não aceita respostas agora.",
    soQuemPerguntou: "Só quem fez a pergunta e a equipe respondem aqui.",
    suaResposta: "Sua resposta",
    filtrar: "Filtrar perguntas",
    minhas: "Minhas",
    /* O botao do fio aberto, depois das respostas (como o "Ocultar respostas" do YouTube). */
    ocultarRespostas: "Ocultar respostas",
    ordenar: "Ordenar perguntas",
    perguntar: "Perguntar",
    respostas: (n: number) => (n === 1 ? "1 resposta" : `${n} respostas`),
    semResposta: "Sem resposta",
    vazioMinhas: "Você ainda não fez perguntas.",
    vazioRespondidas: "Nenhuma pergunta respondida ainda.",
    vazioSemResposta: "Nenhuma pergunta sem resposta."
  },
  /** Os selos do palco (V2-4): quem apresenta, embaixo a esquerda, sobre o video. */
  selos: {
    apresentador: (nome: string) => `${nome} · Apresentador`
  },
  /**
   * O botao de tema do cabecalho diz para onde vai: no escuro, "Tema claro"; no claro, "Tema escuro" (V2-12). Abaixo de
   * sm, na live, o mesmo botao fica na linha "Tema" do painel Configurações (V2-18).
   */
  tema: {
    claro: "Tema claro",
    escuro: "Tema escuro",
    titulo: "Tema"
  },
  /**
   * O trilho a direita (a sala no estilo do YouTube, a partir de lg): cada item tem o nome da aba ("Chat" tambem no
   * Replay); o Chat com mensagens novas de outras pessoas se chama "Chat, 3 mensagens novas" (a contagem vem de
   * WEBINAR_COPY.sala.mensagensNovas), com o rotulo visivel no comeco do nome.
   */
  trilho: {
    comNovas: (rotulo: string, novas: string) => `${rotulo}, ${novas}`
  },
  /**
   * A visao do video da live (V2-16), no botao da barra a partir de lg: o nome diz o que o video mostra agora ("Visão do
   * vídeo: Palco"), e o menu "Visão do vídeo" tem Palco (o video grande com as miniaturas ao lado) e Grade (todos do
   * mesmo tamanho). Sem as palavras da PROIBIDAS_WEBINARIO.
   */
  visao: {
    atual: (nome: string) => `Visão do vídeo: ${nome}`,
    grade: "Grade",
    palco: "Palco",
    rotulo: "Visão do vídeo",
    /* As miniaturas das cameras onde a pessoa escolher (rodada v9, pedido do produtor de 12/11/2026; docs/30 D91). */
    miniaturas: {
      rotulo: "Miniaturas",
      opcoes: { bottom: "Embaixo", hidden: "Esconder", side: "Lateral" },
      /**
       * A troca entre Lateral e Embaixo pede o vídeo carregado de novo. Com o microfone e a câmera da pessoa desligados,
       * a sala recarrega o vídeo sozinha; com algo dela no ar, ela escolhe a hora (docs/30 D96).
       */
      esperaManual: "A mudança vale quando o vídeo recarregar. Recarregar agora desliga o seu microfone e a sua câmera por alguns segundos.",
      /** Com a sala trancada, recarregar mandaria o aluno para a sala de espera. */
      esperaTrancada: "Com a sala trancada, a mudança vale na próxima vez que você entrar.",
      recarregarAgora: "Recarregar o vídeo agora",
      /** No palco, enquanto o video recarrega por causa da troca (docs/30 D98): nunca "Reconectando…", que e a frase da queda. */
      mudando: "Mudando as miniaturas de lugar…",
      /** Só no console de quem apresenta, com o Esconder marcado. */
      escondidasNaGravacao: "Escondidas para você e na gravação. Cada aluno escolhe as dele."
    }
  }
} as const;
