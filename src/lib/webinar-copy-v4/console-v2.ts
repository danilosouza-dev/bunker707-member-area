// Frases do console V2 de quem apresenta (docs/31 §1, V2-12 a V2-15, fase 2 do redesign): o topo, o palco, a barra
// de quem apresenta, o painel com abas (as abas, o ⋯ e a aba Pessoas) e o chat do console. Entram em
// WEBINAR_COPY.consoleV2 e passam pela PROIBIDAS_WEBINARIO (tests/webinarios-frases.test.mjs). Modulo puro, sem imports. Dono: a fase 2 do redesign V2; cada
// fatia acrescenta aqui as frases que a tela dela usa. As frases que o console ja tinha continuam em
// WEBINAR_COPY.consoleAoVivo e em WEBINAR_ADMIN_COPY.console (editor-model.ts).

/** "1 com a mão levantada", "2 com a mão levantada" (o rodape da aba Pessoas). */
const comMao = (n: number) => (n === 1 ? "1 com a mão levantada" : `${n} com a mão levantada`);

export const CONSOLE_V2_COPY = {
  /* O topo (V2-13): o seletor de sessoes, o Atualizar e a faixa dos avisos. */
  /** A situacao gravada de cada sessao dentro do seletor, em minuscula depois do ponto do meio. */
  fases: { cancelled: "cancelada", ended: "encerrada", live: "no ar", scheduled: "agendada", waiting: "na espera" },
  /** "Sessão de 30/10 às 20:00 · no ar". */
  sessaoDe: (quando: string, fase: string) => `Sessão de ${quando} · ${fase}`,
  /** "Replay · 30/10 às 20:00". */
  replayDe: (quando: string) => `Replay · ${quando}`,
  /** O nome do seletor de sessoes, so para o leitor de tela. */
  rotuloSessao: "Sessão",
  atualizar: "Atualizar",
  /** A regiao viva do Atualizar (so para o leitor de tela): o clique no Atualizar. */
  atualizando: "Atualizando…",
  /** A faixa abaixo do topo, na tela, enquanto o retrato nao responde (e a regiao viva, na passagem). */
  semResposta: "Sem resposta do servidor; tentando de novo.",
  /** A regiao viva quando o retrato volta a responder. */
  conectadoDeNovo: "Conectado de novo.",
  /** O selo dos presentes pelo retrato de 5 s, sem o pico (o Replay, antes de comecar). */
  presentes: (n: number) => (n === 1 ? "1 presente" : `${n} presentes`),
  /** "12 presentes · pico 14" (consolePresenceBadge: o pico nunca abaixo dos presentes). */
  presentesComPico: (n: number, pico: number) => `${n === 1 ? "1 presente" : `${n} presentes`} · pico ${pico}`,
  /** Fecha o aviso de erro da faixa abaixo do topo. */
  fecharAviso: "Fechar",
  /** O esqueleto da tela enquanto o console carrega, so para o leitor de tela. */
  carregando: "Carregando o console da sessão",

  /**
   * Sair da pagina do console com quem esta nele dentro da sala (a sala mora na pagina: sair dela tira a pessoa da sala
   * para todos ate ela voltar). A janela no centro, como o Sair da sala do aluno, com a nova aba como saida sem cair.
   */
  sair: {
    titulo: "Sair do console?",
    texto: "Você está dentro da sala ao vivo. Se sair desta página, você sai da sala, e quem assiste deixa de ver e ouvir você até você voltar ao console.",
    dica: "Para ver outra página sem sair do ar, abra em uma nova aba.",
    ficar: "Continuar no console",
    novaAba: "Abrir em nova aba",
    sair: "Sair do console",
    /** O Sair confirmado: o console sai da sala antes de trocar de pagina (no maximo alguns segundos). */
    saindo: "Saindo da sala…"
  },

  /* O palco (V2-4 e V2-13): os selos sobre o video. */
  palco: {
    /**
     * O selo de baixo a esquerda: "Você · Apresentador", "Você · Co-apresentador" ou "Ana · Apresentador" (o papel sai
     * de WEBINAR_COPY.sala.selos, o mesmo do chat).
     */
    selo: (nome: string, papel: string) => `${nome} · ${papel}`
  },

  /* A barra de quem apresenta (V2-14), embaixo do palco. */
  barra: {
    /** O nome da barra (o <nav>). */
    rotulo: "Controles de quem apresenta",
    /** O circulo da propria tela (o nome do V2-6). */
    compartilharTela: "Compartilhar tela",
    /** A pilula da esquerda com quem bate na sala de espera: "Sala de espera · 2". */
    salaDeEspera: (n: number) => `Sala de espera · ${n}`,
    /** O circulo que abre a aba Mãos do painel, com quantas maos estao levantadas. */
    maos: (n: number) => (n > 0 ? `Mãos levantadas, ${n}` : "Mãos levantadas"),
    /** O circulo que abre as Enquetes do painel (no ⋯). */
    lancarEnquete: "Lançar enquete"
  },
  /** O balao da direita da barra, que abre e fecha o painel do console. */
  painel: {
    esconder: "Esconder o painel",
    mostrar: "Mostrar o painel",
    mostrarComNovas: (novas: string) => `Mostrar o painel, ${novas}`
  },
  /** O "Palco para todos ▾" do Apresentador: o que o video mostra para todos agora (o seguir a visao leva a todos). */
  visao: {
    palcoParaTodos: "Palco para todos",
    gradeParaTodos: "Grade para todos"
  },
  /* O painel com abas (V2-15), a direita do palco. */
  /** As abas, com o numero no proprio nome quando ha ("Perguntas 3", "Mãos 2"). */
  abas: { chat: "Chat", perguntas: "Perguntas", maos: "Mãos", pessoas: "Pessoas" },
  /** O nome da linha das abas, so para o leitor de tela. */
  rotuloAbas: "Painel do console",
  /** O ⋯ das outras entradas, sem nenhuma escolhida. */
  mais: "Mais painéis",
  /** O ⋯ com uma entrada escolhida (ele mostra o nome dela). */
  maisEscolhido: (nome: string) => `Mais painéis: ${nome}`,
  /** As entradas do ⋯, na ordem do V2-15; a Na tela (docs/31 §12, o mesmo nome de WEBINAR_COPY.naTela.console.entrada) primeiro. */
  entradas: { tela: "Na tela", enquetes: "Enquetes", roteiro: "Roteiro", oferta: "Oferta", atendimento: "Atendimento", presenca: "Presença", gravacao: "Gravação" },
  /** O X do painel, a partir de lg. */
  fecharPainel: "Fechar o painel",
  /** O trilho a direita do console (docs/31 §10): o nome de cada item comeca pelo rotulo visivel. */
  trilho: {
    /** O rotulo do ultimo item, que abre o menu das outras entradas. */
    mais: "Mais",
    /** "Perguntas, 3 abertas". */
    comNumero: (rotulo: string, numero: string) => `${rotulo}, ${numero}`,
    abertas: (n: number) => (n === 1 ? "1 aberta" : `${n} abertas`),
    maos: (n: number) => (n === 1 ? "1 levantada" : `${n} levantadas`)
  },

  /** A aba Pessoas (V2-14 e V2-15) e o Remover do ⋮ da miniatura do video (V2-A29), quando ele nao passa pelo nosso. */
  pessoas: {
    removidoSemRegistro: "A pessoa saiu da sala, mas pode voltar: ela ainda não aparece na lista da sessão.",
    equipeNaoSai: "Quem é da equipe não é removido da sala.",
    tenteDeNovo: "Ainda não dá para remover esta pessoa. Tente de novo em alguns segundos.",
    /** A moderacao de video desligada: os alunos abrem a camera sem pedir (aria-pressed diz o estado). */
    cameras: "Câmeras livres",
    /** O cabecalho da lista de quem esta na sala: "Na sala · 3". */
    naSala: (n: number) => `Na sala · ${n}`,
    /** "2 com a mão levantada". */
    comMao,
    /** O rodape da aba: "3 na sala · 2 com a mão levantada". */
    rodape: (naSala: number, maos: number) => `${naSala} na sala · ${comMao(maos)}`,
    /** O selo de quem compartilha a tela agora. */
    compartilhando: "Compartilhando",
    /** O microfone e a camera de cada pessoa, so para o leitor de tela (sem sinal do video, desligados). */
    midia: { cameraDesligada: "Câmera desligada", cameraLigada: "Câmera ligada", microfoneDesligado: "Microfone desligado", microfoneLigado: "Microfone ligado" }
  },

  /**
   * A aba Chat (V2-15 e V2-9): os dois seletores compactos com o rotulo visivel, as pendentes do chat moderado e as acoes
   * de cada mensagem. "Na moderação", Liberar, Fixar, Apagar e Enviar continuam em WEBINAR_ADMIN_COPY.console.chat.
   */
  chat: {
    quemEscreve: "Quem escreve:",
    modoLento: "Modo lento:",
    /** Quantas mensagens esperam a equipe no chat moderado: "1 aguardando". */
    aguardando: (n: number) => `${n} aguardando`,
    /** Recusar a pendente: ela some para todos, como Apagar. */
    recusar: "Recusar",
    /** A mensagem do aluno vira pergunta na aba Perguntas. */
    virarPergunta: "Virar pergunta",
    /** O ⋯ de cada mensagem, com o nome de quem escreveu. */
    maisAcoes: (nome: string) => `Mais ações da mensagem de ${nome}`
  }
} as const;
