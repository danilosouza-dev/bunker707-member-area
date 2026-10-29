// Frases dos Webinarios (docs/30 §2.7 e §1.2), do aluno e do admin, num arquivo so. As guardas de frases da
// Comunicacao (tests/comunicacao-admin-modelo.test.mjs e tests/pop-ups-v3b1-frases.test.mjs) nao leem este
// arquivo, de proposito: o Webinario usa "Sessão", "lembrete" e, na fase 4, "Oferta" na tela. A guarda propria
// e tests/webinarios-frases.test.mjs (PROIBIDAS_WEBINARIO em src/lib/webinar-copy.ts, abaixo).
// Modulo puro, sem imports.

/** Palavras que nunca entram num rotulo do Webinario (docs/30, Resumo e §10.1). */
export const PROIBIDAS_WEBINARIO = [
  "campanha",
  "público",
  "audiência",
  "evento",
  "webinar",
  "simulive",
  "host",
  "lobby",
  "broadcast",
  "stream",
  "gatilho",
  "trigger",
  "impressão",
  "home",
  "template",
  "layout",
  "jitsi"
] as const;

export const WEBINAR_COPY = {
  aluno: {
    adicionarCalendario: "Adicionar ao calendário",
    aguardando: "Aguardando o apresentador",
    aguardandoTexto: "O apresentador já vai começar.",
    apresentador: "Apresentador",
    assistirReplay: "Assistir o replay",
    baixarArquivo: "Baixar arquivo",
    cancelada: "Essa live foi cancelada.",
    cancelarVaga: "Cancelar minha vaga",
    comecaEm1h: "Começa em 1 h: Entrar",
    duracao: "Duração",
    emAndamento: "Em andamento",
    emBreve: "em breve",
    encerrada: "Essa live acabou.",
    encerradaReplayEmBreve: "Essa live acabou. O replay fica pronto em algumas horas.",
    entrar: "Entrar",
    erroCancelar: "Não foi possível cancelar a vaga. Tente de novo.",
    erroCarregar: "Algo falhou ao buscar as lives. Tente de novo em alguns instantes.",
    erroCarregarTitulo: "Não foi possível carregar as lives",
    erroVaga: "Não foi possível garantir a vaga. Tente de novo.",
    escolhaSessao: "Escolha a sessão.",
    esgotado: "As vagas acabaram. O replay fica disponível depois.",
    fecharAviso: "Fechar aviso",
    garantirVaga: "Garantir vaga",
    googleAgenda: "Google Agenda",
    horarioBrasilia: "horário de Brasília",
    liveAoVivo: "Live ao vivo",
    liveGravada: "Live gravada",
    lives: "Lives",
    menu: "Webinários",
    menuDescricao: "Lives ao vivo e gravadas da escola",
    naoDisponivel: "Esta live não está disponível para você.",
    outlook: "Outlook",
    previaSemGravar: "No modo de visualização, nada é gravado.",
    proximaLive: "Próxima live",
    proximas: "Próximas",
    quando: "Quando",
    replay: "Replay",
    replayDisponivel: "Replay disponível",
    replays: "Replays",
    selo: { aoVivo: "Ao vivo", replay: "Replay", sessao: "Sessão", vagaGarantida: "Vaga garantida" },
    semLives: "Nenhuma live marcada por enquanto. Quando houver, ela aparece aqui e na página inicial.",
    semLivesTitulo: "Nenhuma live marcada",
    semVaga: "Esta live não precisa de vaga: é só entrar na hora.",
    sessoes: "Sessões",
    situacoes: {
      cancelled: "Cancelado",
      ended: "Encerrada",
      live: "Ao vivo",
      registered: "Vaga garantida",
      scheduled: "Agendado",
      sold_out: "Vagas esgotadas",
      waiting: "Aguardando o apresentador"
    },
    subtitulo: "As lives da escola: garanta sua vaga e receba os lembretes 1 dia e 1 hora antes.",
    tentarDeNovo: "Tentar de novo",
    titulo: "Webinários",
    vagaGarantidaToast: "Vaga garantida. Avisamos você 1 dia e 1 hora antes.",
    vagaCanceladaToast: "Vaga cancelada.",
    vagasGarantidas: (n: number) => `${n} ${n === 1 ? "aluno" : "alunos"} com vaga garantida`,
    verComoParticipar: "Ver como participar",
    verNaAula: "Ver na aula",
    verTodas: "Ver todas"
  },
  sino: {
    /** "Amanhã às 20:00: {título}. Sua vaga está garantida." */
    h24: (titulo: string, hora: string) => `Amanhã às ${hora}: ${titulo}. Sua vaga está garantida.`,
    /** O de 24 h que saiu atrasado, no dia: "Hoje às 20:00: {título}. Sua vaga está garantida." */
    hoje: (titulo: string, hora: string) => `Hoje às ${hora}: ${titulo}. Sua vaga está garantida.`,
    h1: (titulo: string) => `Começa em 1 hora: ${titulo}. Entre pela área de membros.`,
    comecou: (titulo: string) => `Começou agora: ${titulo}. Entrar.`,
    cancelada: (titulo: string) => `Live cancelada: ${titulo}.`,
    remarcada: (titulo: string, quando: string) => `A live mudou para ${quando}: ${titulo}. Sua vaga continua garantida.`,
    replay: (titulo: string) => `Replay disponível: ${titulo}.`,
    tituloLembrete: "Lembrete da live",
    tituloComecou: "Começou agora",
    tituloCancelada: "Live cancelada",
    tituloRemarcada: "A live mudou de hora",
    tituloReplay: "Replay disponível"
  },
  email: {
    h24Assunto: (hora: string, titulo: string) => `Amanhã às ${hora}: ${titulo}`,
    hojeAssunto: (hora: string, titulo: string) => `Hoje às ${hora}: ${titulo}`,
    h1Assunto: (titulo: string) => `Começa em 1 hora: ${titulo}`,
    canceladaAssunto: (titulo: string) => `Live cancelada: ${titulo}`,
    h24Corpo: (nome: string, titulo: string, data: string, hora: string) =>
      `Olá, ${nome}. Sua vaga está garantida para ${titulo}, amanhã, ${data} às ${hora} (horário de Brasília). Entre pela área de membros pelo botão abaixo. Para não receber lembretes desta live, cancele sua vaga na página dela.`,
    hojeCorpo: (nome: string, titulo: string, hora: string) =>
      `Olá, ${nome}. Sua vaga está garantida para ${titulo}, hoje às ${hora} (horário de Brasília). Entre pela área de membros pelo botão abaixo.`,
    h1Corpo: (nome: string, titulo: string, hora: string) =>
      `Olá, ${nome}. ${titulo} começa às ${hora} (horário de Brasília). Entre pela área de membros pelo botão abaixo.`,
    canceladaCorpo: (nome: string, titulo: string) => `Olá, ${nome}. A live ${titulo} foi cancelada.`,
    botaoEntrar: "Entrar na área de membros",
    canceladaMotivo: (motivo: string) => `Motivo: ${motivo}`,
    tituloLembrete: "Lembrete da live",
    rodapeLembrete:
      "Você recebeu este e-mail porque garantiu vaga nesta live na área de membros da Bunker707. Para não receber mais lembretes dela, cancele sua vaga na página da live.",
    rodapeCancelada: "Você recebeu este e-mail porque tinha vaga garantida nesta live na área de membros da Bunker707."
  },
  admin: {
    abas: { gravadas: "Lives gravadas", lista: "Webinários", aoVivo: "Lives ao vivo" },
    abrirConsole: "Abrir o console",
    abrirSala: "Abrir a sala",
    cancelar: "Cancelar",
    comecarParaTodos: "Começar para todos",
    duplicar: "Duplicar",
    encerrarLive: "Encerrar live",
    excluir: "Excluir",
    novo: "Novo webinário",
    publicar: "Publicar",
    salvar: "Salvar",
    semDados: "Sem dados no período",
    semLivesAoVivo: "Sem lives ao vivo ainda",
    situacoes: {
      cancelled: "Cancelado",
      draft: "Rascunho",
      ended: "Encerrado",
      in_progress: "Em andamento",
      scheduled: "Agendado"
    },
    tipos: { live: "Live ao vivo", simulated: "Live gravada" },
    verRelatorio: "Ver relatório"
  }
} as const;

export type WebinarCopy = typeof WEBINAR_COPY;
