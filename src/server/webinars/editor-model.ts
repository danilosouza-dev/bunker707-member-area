// Modelo de tela do admin dos Webinarios (docs/30 §2): enderecos e filtros da lista, situacoes e botoes
// (§2.3; na fase 3 Abrir a sala, Abrir o console e o Encerrar live da Live ao vivo levam ao console /[id]/sala, e
// sem messaging.publish os da sala aparecem desligados com a explicacao, §2.6), os cards do editor (§2.2, com o card
// Gravacao pela situacao do gravador e o Avisar com os atalhos Aviso no sino e Pop-up, webinarNotifyShortcuts), o
// mapa dos erros do zod para os campos, a previa do card do aluno, a sessao
// que vai para a tela sem o nome da sala (§8.1) e as conferencias de tela que o schema nao cobre. Modulo puro (sem
// React, sem "server-only", imports relativos):
// tests/webinarios-admin-modelo.test.mjs e tests/webinarios-frases.test.mjs carregam direto pelo Node.
// Todas as frases do admin que nao estao em src/lib/webinar-copy.ts ficam em WEBINAR_ADMIN_COPY, abaixo,
// e passam pela mesma guarda (PROIBIDAS_WEBINARIO).

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { countdownLabel, formatWebinarWhen, saoPauloTime } from "../../lib/webinar-time";
import {
  AUDIENCE_LIMITS,
  audienceDepth,
  countAudienceRules,
  describeAudience,
  isAudienceGroup,
  normalizeAudience,
  type AudienceDefinition,
  type AudienceNames,
  type AudienceNode,
  type AudienceRule
} from "../communications/audience-model";
import { formatSaoPauloDateTime, saoPauloLocalToIso } from "../communications/campaign-model";
import { RECORDER_LABELS, RECORDER_RULES, canRequestRecorder, type RecorderStatus } from "./recorder-model";
import { webinarReportHref } from "./report-page-model";
import { jitActive, jitSummary, withJitPublishProblems } from "./jit-model";
import {
  WEBINAR_LIMITS,
  WEBINAR_SITUATIONS,
  accessModeAnchorsAudience,
  accessModeUsesAudience,
  accessModeUsesProduct,
  emptyWebinarDraft,
  type AccessMode,
  type JitSettings,
  type SessionStatus,
  type WebinarDraft,
  type WebinarKind,
  type WebinarSession,
  type WebinarSituation,
  type WebinarStatus
} from "./model";
import { WEBINAR_NOTICE_COPY, audienceWithProduct, webinarNoticeAudience, webinarNoticeHref, webinarNoticeStatusBlock, withOwnWebinar } from "./notice-shortcut-model";
import { WEBINAR_MESSAGES, publishProblems } from "./schemas";

/* ------------------------------------------------------------------------------------------------
 * Frases do admin (as do aluno, do sino e do e-mail ficam em webinar-copy.ts)
 * ---------------------------------------------------------------------------------------------- */

export const WEBINAR_ADMIN_COPY = {
  emBreve: "em breve",
  list: {
    columns: {
      createdBy: "Quem criou",
      peak: "Presentes (pico)",
      registered: "Vagas garantidas",
      situation: "Situação",
      title: "Webinário",
      when: "Quando"
    },
    empty: {
      allDescription: "Crie uma Live ao vivo ou uma Live gravada para os alunos.",
      allTitle: "Nenhum webinário ainda",
      filteredDescription: "Tente outro nome, outra situação ou outro tipo.",
      filteredTitle: "Nenhum webinário encontrado",
      liveTabDescription: "Quando uma Live ao vivo acontecer, os números dela aparecem aqui.",
      recordedTabDescription: "Quando uma Live gravada acontecer, os números dela aparecem aqui."
    },
    filtersLabel: "Situação",
    itemLabel: "webinários",
    kindFiltersLabel: "Tipo",
    kinds: { live: "Ao vivo", simulated: "Gravada" },
    listHeading: "Webinários",
    clearFilters: "Limpar filtros",
    searchLabel: "Buscar pelo título",
    searchPlaceholder: "Buscar pelo título",
    sessionsCount: (count: number) => `${count} ${count === 1 ? "sessão" : "sessões"}`,
    tabsLabel: "Seções de webinários",
    todos: "Todos"
  },
  kpis: {
    liveNow: { definition: "Sessões na sala agora", definitionShort: "Na sala agora", label: "Ao vivo agora" },
    registered: { definition: "Alunos com vaga garantida nas sessões do período", definitionShort: "Com vaga no período", label: "Vagas garantidas" },
    replay: { definition: "Assistiram o replay no período", definitionShort: "Replay no período", label: "Assistiram o replay" },
    attended: { definition: "Entraram na sala no período", definitionShort: "Entraram na sala", label: "Compareceram" },
    webinars: { definition: "Sessões com hora marcada no período", definitionShort: "Sessões no período", label: "Webinários" }
  },
  header: {
    breadcrumbList: "Webinários",
    editTitle: "Editar webinário",
    newDescription: "Uma Live ao vivo ou uma Live gravada, com vaga garantida e lembretes.",
    newTitle: "Novo webinário",
    notFoundAction: "Ver webinários",
    notFoundDescription: "Ele pode ter sido excluído. Os outros webinários continuam na lista.",
    notFoundTitle: "Este webinário não existe mais",
    pendingTitle: "Webinário",
    updatedAt: (when: string) => `Atualizado em ${when}.`
  },
  kindChoice: {
    description: "O tipo trava depois de publicar.",
    live: { description: "O apresentador no palco, os alunos assistem, comentam e reagem na hora marcada.", title: WEBINAR_COPY.admin.tipos.live },
    simulated: { description: "Um vídeo da Bunny toca pelo relógio da sala nas sessões marcadas, com a turma comentando junto.", title: WEBINAR_COPY.admin.tipos.simulated },
    title: "Qual é o tipo?"
  },
  cards: {
    avisar: { description: "Onde o webinário aparece para quem pode ver.", title: "Avisar" },
    dados: { description: "Título, capa, quem apresenta e a hora marcada.", title: "Dados" },
    enquetes: { description: "Prontas para abrir na hora, no console da sessão.", title: "Enquetes" },
    oferta: { description: WEBINAR_COPY.oferta.card.descricao, title: WEBINAR_COPY.oferta.card.titulo },
    assistente: { description: WEBINAR_COPY.assistente.card.descricao, title: WEBINAR_COPY.assistente.card.titulo },
    gravacao: { description: "Só na Live ao vivo: o servidor de gravação é criado antes da live e apagado no fim.", title: "Gravação" },
    qualidade: { description: "Cada aluno recebe o tamanho que cabe na tela dele; em 4G cai sozinho para 720p ou 360p.", title: "Qualidade" },
    quemPode: { description: "Quem não passa por aqui não vê o webinário em lugar nenhum.", title: "Quem pode" },
    replayAula: { description: "O replay vira uma aula com vídeo da Bunny; o chat da live fica na página do webinário.", title: "Publicar replay como aula" },
    revisao: { description: "", title: "Revisão" },
    roteiro: { description: "Mensagens do roteiro nunca entram nas métricas reais.", title: "Roteiro de chat" },
    sala: { description: "Controles padrão ao começar; a sessão copia ao abrir.", title: "Sala" },
    sessoes: { description: "Cada sessão tem a própria Simulação e o próprio relatório.", title: "Sessões" },
    simulacao: { description: "Por sessão: o selo que o aluno vê na sala, com a decisão registrada.", title: "Simulação" },
    vagaLembretes: { description: "O e-mail sai pela fila com os outros e-mails da área (Resend).", title: "Vaga e lembretes" }
  },
  /** Roteiro de chat (docs/30 §2.2, §6.6 D6). */
  script: {
    add: "Adicionar mensagem",
    columns: { body: "Mensagem", delay: "Atraso (s)", name: "Nome", phrase: "Frase do apresentador", role: "Papel", status: "Situação", time: "Tempo", trigger: "Solta em" },
    csvHint: "Quatro colunas: Tempo;Nome;Papel;Mensagem. Tempo como 1:02:03, 02:03 ou 63 (segundos); Papel Aluno ou Equipe.",
    empty: "Nenhuma mensagem no roteiro. Importe um CSV ou adicione uma a uma.",
    exportChat: "Baixar o chat de uma sessão como CSV",
    exportChatHint: "O chat real de uma sessão encerrada, no formato do roteiro, para reaproveitar.",
    exportCsv: "Exportar CSV",
    importAppend: "Acrescentar ao fim",
    importConfirm: "Importar",
    importCsv: "Importar CSV",
    importErrors: (count: number) => (count === 1 ? "1 linha com problema fica de fora:" : `${count} linhas com problema ficam de fora:`),
    importLine: (line: number, message: string) => `Linha ${line}: ${message}`,
    importNothing: "Nenhuma linha válida no arquivo.",
    importPreview: (count: number) => (count === 1 ? "1 mensagem pronta para entrar." : `${count} mensagens prontas para entrar.`),
    importReplace: "Substituir o roteiro",
    importTitle: "Importar CSV do roteiro",
    importTruncated: "O arquivo tinha mais linhas que o limite; só as primeiras 5.000 entraram.",
    noRecording: "Cole o endereço do vídeo da Bunny no card Dados e salve antes de enviar a transcrição.",
    remove: "Remover mensagem",
    resolve: "Resolver frases",
    resolved: (ready: number, unresolved: number) => `${ready} ${ready === 1 ? "frase achada" : "frases achadas"} na transcrição; ${unresolved} ${unresolved === 1 ? "não achada" : "não achadas"}.`,
    roles: { student: "Aluno", team: "Equipe" },
    save: "Salvar roteiro",
    saving: "Salvando…",
    statuses: { disabled: "Desligada", draft: "Rascunho", ready: "Pronta", unresolved: "Frase não achada" },
    summary: (summary: { disabled: number; manual: number; ready: number; unresolved: number }) =>
      `${summary.ready} ${summary.ready === 1 ? "entra sozinha" : "entram sozinhas"} · ${summary.manual} pelo botão · ${summary.unresolved} sem minuto · ${summary.disabled} ${summary.disabled === 1 ? "desligada" : "desligadas"}`,
    timePlaceholder: "mm:ss",
    toggleOff: "Desligar",
    toggleOn: "Ligar",
    transcriptFile: "Enviar arquivo (.vtt, .srt ou .txt)",
    transcriptHint: "Cole a transcrição (VTT, SRT ou texto corrido) ou envie o arquivo. Ela serve para soltar mensagens quando o apresentador diz uma frase.",
    transcriptNone: "Transcreva o vídeo para soltar mensagens por frase dita.",
    transcriptPaste: "Colar transcrição",
    transcriptSave: "Salvar transcrição",
    transcriptSummary: (cues: number, format: string, when: string) => `Transcrição ${format.toUpperCase()} com ${cues} ${cues === 1 ? "trecho" : "trechos"}, enviada em ${when}.`,
    transcriptTitle: "Transcrição do vídeo",
    unsaved: "Mudanças no roteiro ainda não salvas."
  },
  /** Simulação (docs/30 §2.2 e §8.6, D10). */
  simulation: {
    ackLabel: "Li e confirmo a frase acima.",
    badge: 'Selo "Ao vivo"',
    badgeHint: "Desligado, o aluno vê o selo Sessão e o número real da turma.",
    confirm: "Confirmar decisão",
    decidedBy: (name: string, when: string) => `Decisão de ${name} em ${when}.`,
    legal:
      "Pela lei (CDC, art. 37), nunca anuncie uma sessão gravada como ao vivo fora da área de membros. Dentro dela, o selo e os números simulados são sua decisão e ficam registrados com seu nome e a data.",
    needsPublish: "Só quem publica na Comunicação decide o selo.",
    noSessions: "Marque as sessões no card Sessões e salve para decidir o selo de cada uma.",
    sessionLabel: (when: string) => `Sessão de ${when}`,
    undecided: "Sem decisão registrada: o selo fica desligado.",
    unsaved: "Marque a confirmação para gravar a decisão."
  },
  /** Enquetes prontas (docs/30 §2.2 e §2.4). */
  polls: {
    add: "Adicionar enquete",
    addOption: "Adicionar opção",
    anonymous: "Respostas anônimas",
    empty: "Nenhuma enquete pronta. A equipe abre, encerra e compartilha o resultado no console.",
    kind: "Tipo",
    kinds: { multiple: "Várias opções", single: "Uma opção", survey: "Pesquisa" },
    limit: (count: number) => `Até ${count} enquetes por webinário.`,
    optionPlaceholder: (index: number) => `Opção ${index}`,
    options: "Opções",
    question: "Pergunta",
    remove: "Remover enquete",
    removeOption: "Remover opção",
    save: "Salvar enquetes",
    saving: "Salvando…",
    unsaved: "Mudanças nas enquetes ainda não salvas."
  },
  /** O console da sessao (docs/30 §2.4). */
  console: {
    backToEditor: "Voltar ao editor",
    breadcrumb: "Console",
    chat: {
      approve: "Liberar",
      composer: "Escreva para a turma",
      delete: "Apagar",
      empty: "Nenhuma mensagem ainda.",
      master: "Nas próximas turmas",
      noConsent: "Sem consentimento do aluno",
      pending: "Na moderação",
      pin: "Fixar",
      pinned: "Fixada",
      promote: "Aprovar para as próximas turmas",
      send: "Enviar",
      slowMode: "Modo lento",
      sources: { ai: "Assistente", audience: "Turma de hoje", original: "Chat original", scripted: "Roteiro", team: "Equipe" },
      title: "Chat",
      unpin: "Desafixar",
      whoWrites: "Quem pode escrever"
    },
    description: "A mesa da equipe durante a sessão: chat, roteiro, enquetes e perguntas.",
    end: "Encerrar sessão",
    endConfirm: {
      confirmLabel: "Encerrar sessão",
      description: "O vídeo para para todo mundo, a presença é resumida e a sessão vira Encerrada. Isso não tem volta.",
      title: "Encerrar a sessão agora?"
    },
    lasted: (text: string) => `Durou ${text}`,
    offline: "Sem resposta do servidor; tentando de novo.",
    onAirFor: (text: string) => `No ar há ${text}`,
    open: "Abrir sessão",
    openConfirm: {
      confirmLabel: "Abrir sessão",
      description: "A sessão entra no ar para quem pode ver, o roteiro pronto entra no chat e quem garantiu vaga recebe o Começou agora pelo sino.",
      title: "Abrir a sessão agora?"
    },
    phases: { cancelled: "Cancelada", ended: "Encerrada", live: "No ar", replay: "Replay disponível", scheduled: "Agendada", waiting: "Na espera" },
    polls: {
      answers: (count: number) => (count === 1 ? "1 resposta" : `${count} respostas`),
      close: "Encerrar",
      closed: "Encerrada",
      empty: "Nenhuma enquete pronta. Crie no editor do webinário.",
      launch: "Abrir",
      launched: "Nesta sessão",
      open: "Aberta",
      share: "Compartilhar resultado",
      shared: "Resultado compartilhado",
      templates: "Prontas",
      title: "Enquetes"
    },
    presentNow: (count: number) => (count === 1 ? "1 presente agora" : `${count} presentes agora`),
    questions: {
      anonymous: "Anônima",
      answerLive: "Respondida ao vivo",
      answerPlaceholder: "Escreva a resposta",
      answerWritten: "Responder por escrito",
      dismiss: "Dispensar",
      empty: "Nenhuma pergunta ainda.",
      reopen: "Reabrir",
      statuses: { answered: "Respondida", dismissed: "Dispensada", open: "Aberta" },
      title: "Perguntas",
      votes: (count: number) => (count === 1 ? "1 voto" : `${count} votos`)
    },
    readOnly: "Esta sessão não aceita mais ações da equipe.",
    refresh: "Atualizar",
    report: "Ver relatório",
    script: {
      due: (text: string) => `Entra em ${text}`,
      empty: "Sem roteiro nesta Live gravada.",
      fire: "Soltar agora",
      fired: "Entrou",
      manual: "Pelo botão",
      passed: "Minuto já passou",
      summary: (fired: number, pending: number, manual: number) => `${fired} ${fired === 1 ? "entrou" : "entraram"} · ${pending} a caminho · ${manual} pelo botão`,
      title: "Roteiro"
    },
    sessionPicker: "Sessão",
    startsIn: (text: string) => `Começa em ${text}`,
    title: "Console da sessão",
    updating: "Atualizando…"
  },
  fields: {
    accessModes: {
      audience: "Segmento",
      both: "Quem tem o produto e está no segmento",
      either: "Produto ou segmento",
      everyone: "Todos",
      product: "Quem tem o produto"
    },
    /**
     * Segmento e "both": o segmento vale na hora e quem garantiu vaga fica (a ancora, D41), mas o produto e a turma que o
     * segmento pede sao conferidos de novo.
     */
    accessSegmentHint: "Vale na hora. Quem garantiu vaga continua vendo, mesmo se sair do segmento. O produto e a turma que o segmento pede são conferidos sempre.",
    /**
     * "Produto ou segmento": sem ancora (D41), vale o produto ou o segmento de agora, a cada pedido; nem a vaga nem ter
     * entrado na sala seguram, entao quem sai do segmento sem o produto no meio da live sai da sala (o video e o chat) e
     * nao volta. Para a vaga segurar (e para limitar as vagas), o Segmento com o produto como uma das regras.
     */
    accessEitherHint:
      "Vale na hora, e aqui nem a vaga nem ter entrado na sala seguram: quem sair do segmento sem o produto, mesmo no meio da live, sai da sala e não consegue voltar. Para segurar, use Segmento com o produto como uma das regras (por exemplo, “tem o produto X” ou “ganhou acesso hoje”).",
    /** Regra "Ganhou acesso recentemente" com "Entrar direto, sem vaga" (Segmento e "both"): nada segura quem saiu do segmento. */
    accessTimeRuleNoSeat: "Sem Garantir vaga, quem sair do segmento antes de entrar na sala deixa de ver a live (quando o dia vira, por exemplo).",
    /** Regra "Ganhou acesso recentemente" no "Produto ou segmento", com ou sem vaga: sem ancora, a regra vence ate na sala. */
    accessTimeRuleEither: "Quem entrou pela regra de tempo e não tem o produto sai quando ela vence (quando o dia vira, por exemplo), com vaga ou sem, mesmo no meio da live.",
    accessCapacityHint: "Só quem garantir vaga entra.",
    afterAbsent: "E-mail para quem não veio",
    afterAttended: "E-mail para quem veio",
    afterLive: "Depois da live",
    allowStudentCamera: "Câmeras dos alunos",
    allowStudentCameraHint: "Entram desligadas e o aluno liga se quiser. A câmera do aluno sai em 360p e o apresentador fecha quando quiser.",
    anonymousQuestions: "Perguntas anônimas permitidas",
    autoRecord: "Gravar automaticamente",
    autoRecordHint: `Um servidor de gravação é criado ${RECORDER_RULES.prepareLeadMinutes} min antes da live e apagado no fim, cobrado por hora (uma live de 2 h gravada em 1080p custa cerca de EUR 0,30).`,
    autoRecordOffHint: "Desligado: ninguém cria o servidor sozinho. A equipe prepara a gravação no console, pelo botão Preparar gravação.",
    bannerSwitch: "Faixa no topo",
    bannerSwitchHint: "Ao vivo e 1 h antes para quem garantiu vaga.",
    canModerateRoom: "Pode remover e silenciar na sala",
    capacity: "Limite de vagas",
    capacityOff: "Ligue Garantir vaga para limitar as vagas.",
    chatMode: "Chat",
    chatModes: { moderated: "Moderado", off: "Desligado", open: "Aberto", team_only: "Só a equipe" },
    coHosts: "Co-apresentadores",
    coHostsHint: "Contas da área, até 5.",
    confirmationText: "Texto da confirmação",
    cover: "Capa",
    coverHint: "2:3, como a capa de produto. O card da página inicial e a página do webinário usam a mesma imagem.",
    description: "Descrição",
    displayName: "Como o aluno aparece",
    displayNames: { anonymous: "Sempre anônimo", first_name_initial: "Primeiro nome + inicial", nickname: "Apelido" },
    duration: "Duração prevista (min)",
    email: "E-mail",
    emailHint: "Cada lembrete sai uma vez por aluno.",
    flowLink: "Fluxo",
    /** Avisar › Aviso no sino e Pop-up (docs/30 §2.2): atalhos que abrem o editor da Comunicacao preenchido. */
    notifyBlocked: WEBINAR_NOTICE_COPY.blocked,
    notifyInbox: "Aviso no sino",
    notifyInboxHint: `Abre um aviso novo já preenchido: para quem está no Quem pode agora, com o nome, a data e o botão ${WEBINAR_NOTICE_COPY.ctaSee}. Nada é enviado até você publicar.`,
    notifyLinksTitle: "Avisar pela Comunicação",
    /**
     * A dica embaixo do atalho Pop-up, pelo Quem pode salvo (webinarNotifyPopupHint, D42): no Segmento e no "both" a vaga
     * segura a live mas nao entra no aviso; no "Produto ou segmento" (sem ancora) quem sai do segmento sem o produto perde
     * a live e os avisos dela; em Todos e Quem tem o produto nao ha segmento.
     */
    notifyPopupHint: {
      anchored: `Abre um pop-up novo já preenchido para a hora da live, com o botão ${WEBINAR_NOTICE_COPY.ctaEnter}, para quem está no Quem pode agora. Quem garantiu vaga e já saiu do segmento não vê o pop-up: recebe o Começou agora pelo sino. Nada é salvo até você salvar.`,
      either: `Abre um pop-up novo já preenchido para a hora da live, com o botão ${WEBINAR_NOTICE_COPY.ctaEnter}, para quem está no Quem pode agora. Quem saiu do segmento sem o produto não vê a live nem recebe os avisos dela. Nada é salvo até você salvar.`,
      plain: `Abre um pop-up novo já preenchido para a hora da live, com o botão ${WEBINAR_NOTICE_COPY.ctaEnter}, para quem está no Quem pode agora. Nada é salvo até você salvar.`
    },
    h1: "1 hora antes",
    h1Text: "Texto do lembrete de 1 hora",
    h24: "1 dia antes",
    h24Text: "Texto do lembrete de 1 dia",
    homeCard: "Card na página inicial",
    homeCardHint: "Entra na página inicial de quem pode ver quando o webinário é publicado.",
    host: "Apresentador",
    hostHint: "Um membro da equipe que pode publicar na Comunicação.",
    hostPlaceholder: "Escolher quem apresenta",
    justInTime: "Começa quando você entra",
    lateJoin: "Entrada atrasada",
    lateJoinAlways: "Até o fim",
    lateJoinHint: "Até o fim ou até um número de minutos depois do começo.",
    lateJoinMinutes: "Minutos depois do começo",
    lateJoinUntil: "Até um minuto",
    openConsole: WEBINAR_COPY.admin.abrirConsole,
    replayCancel: "Fechar o replay",
    replayCreate: "Liberar o replay",
    replayHint: "Depois da primeira sessão encerrar, o aluno assiste com a barra e o chat pelo segundo do vídeo.",
    replayOn: (when: string) => `Replay disponível desde ${when}.`,
    replaySwitch: "Replay livre",
    replayWaiting: "Abre depois da primeira sessão encerrar.",
    sessionSaved: (when: string) => `Sessão de ${when}`,
    micOff: "Todos entram sem microfone",
    micOffHint: "Fixo nesta versão.",
    micSelf: "Permitir que o aluno abra o microfone sozinho",
    micSelfHint: "Desligado nesta versão.",
    newCommentsVisible: "Comentários novos aparecem para a turma",
    newCommentsHistory: "Entram no histórico só depois de aprovados",
    newCommentsHistoryHint: "Fixo: a equipe aprova no console.",
    polls: "Enquetes",
    pollsHint: "Prontas para abrir na hora.",
    popupLink: "Pop-up",
    practiceSession: "Sessão de prática",
    practiceSessionHint: "A sala fica só com a equipe até Começar para todos.",
    product: "Produto",
    qualityScreen: "Tela compartilhada",
    qualityScreenOptions: { 15: "1080p a 15 quadros", 30: "1080p a 30 quadros" },
    qualityScreenHint: "15 quadros usa menos banda, com a mesma nitidez para texto parado.",
    qualityStage: "Câmera do palco",
    qualityStageHint1080: "Com 1080p no palco, cada aluno recebe cerca de 5 a 8 Mbit/s. Meta do servidor atual: cerca de 30 a 40 alunos com câmera.",
    qualityFixed: ["Miniaturas: até 360p (180p na fileira pequena, automático).", "Câmera dos alunos: até 360p.", "Gravação: 1080p."],
    questions: "Perguntas",
    reactions: "Reações",
    recordingAfterPublish: "A sala e o servidor de gravação nascem ao publicar; a situação aparece aqui depois disso.",
    recordingStatus: "Situação do servidor de gravação",
    recordingUploadHint: "Reserva: a gravação do navegador do apresentador ou do OBS, enviada pelo console.",
    recordingUrl: "Vídeo da Bunny",
    recordingUrlHint: "Cole o endereço do player (embed) do vídeo na Bunny.",
    registration: "Garantir vaga",
    registrationOff: "Entrar direto, sem vaga",
    registrationOn: "O aluno garante a vaga com 1 clique e recebe os lembretes.",
    reminderSino: "Sino",
    reminderSinoHint: "Sempre ligado para quem garantiu vaga.",
    reminderTextEmpty: "Vazio = padrão.",
    replayAutoPublish: "Publicar sozinho quando o replay ficar pronto",
    replayDays: "Replay disponível por (dias)",
    replayDaysHint: "Quantos dias o card do replay fica na página inicial.",
    replayLesson: "Publicar o replay como aula",
    replayLessonModule: "Módulo",
    replayLessonModuleHint: "O identificador do módulo do produto (a escolha pela lista de módulos chega depois).",
    replayLessonTitle: "Título da aula",
    scheduledAt: "Data e hora",
    sessions: "Horários marcados",
    sessionsAdd: "Adicionar sessão",
    sessionsRemove: "Remover sessão",
    sessionsEmpty: "Marque pelo menos uma sessão.",
    showRegisteredCount: "Mostrar quantos garantiram vaga",
    slowMode: "Modo lento",
    slowModes: { 10: "10 s", 20: "20 s", 30: "30 s", 60: "60 s", off: "Desligado" },
    startedText: "Texto do Começou agora",
    team: "Equipe da sala",
    teamHint: "Membros com permissão de escrever na Comunicação.",
    title: "Título",
    titlePlaceholder: "Ex.: Como montar seu primeiro agente",
    type: "Tipo",
    typeLocked: "O tipo não muda depois de publicar.",
    waitingRoom: "Sala de espera",
    whatsapp: "WhatsApp"
  },
  people: {
    empty: "Ninguém da equipe ainda.",
    none: "Ninguém",
    search: "Buscar pelo nome",
    selected: (count: number, max: number) => `${count} de ${max}`
  },
  preview: {
    dateMissing: "—",
    deviceLabel: "Aparelho da prévia",
    draftNote: "Rascunho: os alunos só veem depois de publicar.",
    homeCard: "Card na página inicial",
    pageCard: "Página do webinário",
    publishedNote: "É o que os alunos veem agora.",
    sessionsLabel: (count: number) => (count === 1 ? "1 sessão marcada" : `${count} sessões marcadas`),
    titlePlaceholder: "Seu título aparece aqui"
  },
  review: {
    buttons: { publish: WEBINAR_COPY.admin.publicar, save: WEBINAR_COPY.admin.salvar, saveDraft: "Salvar rascunho" },
    missing: (items: readonly string[]) => `Para publicar, falta: ${items.join("; ")}`,
    publishedHint: "Já publicado: salvar muda o que os alunos veem.",
    saveFirst: "Salve o rascunho primeiro: este card vale para um webinário já gravado.",
    shortcutHint: "Ctrl+Enter (⌘+Enter no Mac) salva o rascunho.",
    working: { publish: "Publicando…", save: "Salvando…" }
  },
  toasts: {
    cancelled: "Live cancelada. Quem tinha vaga recebe o aviso pelo sino e por e-mail.",
    chatExported: "CSV do chat pronto.",
    deleted: "Rascunho excluído.",
    duplicated: "Cópia criada como rascunho.",
    ended: "Sessão encerrada. O relatório fica pronto em instantes.",
    messageSent: "Mensagem enviada.",
    nothingToSave: "Nenhuma mudança para salvar.",
    opened: "Sessão aberta. O roteiro pronto entrou no chat.",
    phrasesResolved: "Frases conferidas na transcrição.",
    pollsSaved: "Enquetes salvas.",
    published: "Webinário publicado. O card entra na página inicial e os lembretes passam a valer.",
    replayCancelled: "Replay fechado.",
    replayCreated: "Replay liberado para quem pode ver.",
    rescheduled: "Hora marcada atualizada. Quem tinha vaga recebe o aviso.",
    saved: "Rascunho salvo.",
    savedPublished: "Webinário atualizado.",
    scriptExported: "CSV do roteiro pronto.",
    scriptImported: (count: number) => (count === 1 ? "1 mensagem entrou no roteiro." : `${count} mensagens entraram no roteiro.`),
    scriptSaved: "Roteiro salvo.",
    simulationSaved: "Decisão registrada.",
    transcriptSaved: "Transcrição salva."
  },
  confirm: {
    cancel: {
      confirmLabel: "Cancelar a live",
      description: (count: number) =>
        count === 0
          ? "Ninguém garantiu vaga ainda. O webinário sai da página inicial e da página de webinários."
          : `${count} ${count === 1 ? "aluno" : "alunos"} com vaga garantida ${count === 1 ? "recebe" : "recebem"} o aviso de live cancelada pelo sino e por e-mail.`,
      reasonLabel: "Motivo (vai no e-mail)",
      title: (title: string) => `Cancelar “${title}”?`
    },
    delete: {
      confirmLabel: "Excluir",
      description: "O rascunho sai da lista. Nenhum aluno viu nada.",
      title: "Excluir este rascunho?"
    },
    end: {
      confirmLabel: "Encerrar live",
      description: "A sessão que está no ar vira Encerrada para todo mundo e a presença é resumida. Isso não tem volta.",
      title: (title: string) => `Encerrar “${title}” agora?`
    }
  },
  failures: {
    conflictTitle: "Este webinário mudou em outra tela",
    generic: "Não foi possível concluir",
    publishSaved: "O rascunho foi salvo, mas não foi publicado",
    reload: "Recarregar",
    reviewFields: "Revise os campos destacados.",
    waitUpload: "Espere a capa terminar de enviar e tente de novo."
  },
  problems: {
    eitherNeedsAudience: WEBINAR_MESSAGES.accessAudience,
    hostCannotPublish: "O apresentador precisa poder publicar na Comunicação.",
    hostInPresenters: "O apresentador já é quem apresenta.",
    replayLessonNeedsProduct: "Escolha o produto da aula do replay.",
    sessionsIncomplete: "Informe data e hora de cada sessão."
  },
  menu: {
    cancel: WEBINAR_COPY.admin.cancelar,
    delete: WEBINAR_COPY.admin.excluir,
    duplicate: WEBINAR_COPY.admin.duplicar,
    end: WEBINAR_COPY.admin.encerrarLive,
    /** O sufixo do item desligado por permissao ("Abrir a sala · só quem publica"). */
    onlyPublishers: "só quem publica",
    open: "Abrir",
    openConsole: WEBINAR_COPY.admin.abrirConsole,
    openRoom: WEBINAR_COPY.admin.abrirSala,
    publish: WEBINAR_COPY.admin.publicar,
    publishReplay: "Publicar replay",
    save: WEBINAR_COPY.admin.salvar,
    viewReport: WEBINAR_COPY.admin.verRelatorio
  },
  /** Por que um botao da sala ao vivo esta desligado para quem so escreve na Comunicacao (docs/30 §2.6). */
  blocked: {
    end: "Só quem publica na Comunicação encerra a live.",
    openRoom: "Só quem publica na Comunicação abre a sala.",
    prepare: "Só quem publica na Comunicação prepara a gravação."
  }
} as const;

/* ------------------------------------------------------------------------------------------------
 * Enderecos, abas e filtros da lista (docs/30 §2.1)
 * ---------------------------------------------------------------------------------------------- */

export const WEBINARS_HREF = "/admin/comunicacao/webinarios";
export const NEW_WEBINAR_HREF = `${WEBINARS_HREF}/novo`;
export const WEBINARS_PAGE_SIZE = 20;

export const WEBINAR_TAB_PARAM = "aba";
export const WEBINAR_SITUATION_PARAM = "situacao";
export const WEBINAR_KIND_PARAM = "tipo";
export const WEBINAR_SEARCH_PARAM = "busca";
export const WEBINAR_PAGE_PARAM = "pagina";
export const WEBINAR_SEARCH_MAX = 80;

export const WEBINAR_LIST_TABS = [
  { label: WEBINAR_COPY.admin.abas.lista, value: "webinarios" },
  { label: WEBINAR_COPY.admin.abas.aoVivo, value: "ao-vivo" },
  { label: WEBINAR_COPY.admin.abas.gravadas, value: "gravadas" }
] as const;
export type WebinarListTab = (typeof WEBINAR_LIST_TABS)[number]["value"];

const SITUATION_PARAM_VALUES: Record<WebinarSituation, string> = {
  cancelled: "cancelado",
  draft: "rascunho",
  ended: "encerrado",
  in_progress: "em-andamento",
  scheduled: "agendado"
};

const KIND_PARAM_VALUES: Record<WebinarKind, string> = { live: "ao-vivo", simulated: "gravada" };

export const WEBINAR_SITUATION_FILTERS: readonly { label: string; value: WebinarSituation | null }[] = [
  { label: WEBINAR_ADMIN_COPY.list.todos, value: null },
  ...WEBINAR_SITUATIONS.map((situation) => ({ label: WEBINAR_COPY.admin.situacoes[situation], value: situation }))
];

export const WEBINAR_KIND_FILTERS: readonly { label: string; value: WebinarKind }[] = [
  { label: WEBINAR_ADMIN_COPY.list.kinds.live, value: "live" },
  { label: WEBINAR_ADMIN_COPY.list.kinds.simulated, value: "simulated" }
];

type ParamValue = string | string[] | undefined | null;
/** Os searchParams da pagina (o mesmo formato de SearchParamsRecord da paginacao). */
export type ParamsRecord = Record<string, string | string[] | undefined>;

function firstParam(value: ParamValue) {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parseWebinarTabParam(value: ParamValue): WebinarListTab {
  const text = firstParam(value).toLowerCase();
  const tab = WEBINAR_LIST_TABS.find((item) => item.value === text);

  return tab?.value ?? "webinarios";
}

export function parseWebinarSituationParam(value: ParamValue): WebinarSituation | null {
  const text = firstParam(value).toLowerCase();
  const found = (Object.entries(SITUATION_PARAM_VALUES) as [WebinarSituation, string][]).find(([, param]) => param === text);

  return found?.[0] ?? null;
}

export function parseWebinarKindParam(value: ParamValue): WebinarKind | null {
  const text = firstParam(value).toLowerCase();

  return text === KIND_PARAM_VALUES.live ? "live" : text === KIND_PARAM_VALUES.simulated ? "simulated" : null;
}

export function parseWebinarSearchParam(value: ParamValue) {
  return firstParam(value).replace(/\s+/g, " ").slice(0, WEBINAR_SEARCH_MAX);
}

/** Pagina da lista (?pagina=); invalido volta para 1. */
export function parseWebinarsPage(value: ParamValue) {
  const page = Number(firstParam(value));

  return Number.isInteger(page) && page > 1 && page <= 10_000 ? page : 1;
}

export type WebinarsListState = {
  kind: WebinarKind | null;
  page: number;
  search: string;
  situation: WebinarSituation | null;
  tab: WebinarListTab;
};

export function webinarsStateOf(params: ParamsRecord): WebinarsListState {
  return {
    kind: parseWebinarKindParam(params[WEBINAR_KIND_PARAM]),
    page: parseWebinarsPage(params[WEBINAR_PAGE_PARAM]),
    search: parseWebinarSearchParam(params[WEBINAR_SEARCH_PARAM]),
    situation: parseWebinarSituationParam(params[WEBINAR_SITUATION_PARAM]),
    tab: parseWebinarTabParam(params[WEBINAR_TAB_PARAM])
  };
}

/** O endereco da lista com o estado dado (o periodo da barra superior vai junto quando informado). */
export function webinarsHref(state: Partial<WebinarsListState> & { periodo?: string | null } = {}) {
  const params = new URLSearchParams();

  if (state.tab && state.tab !== "webinarios") {
    params.set(WEBINAR_TAB_PARAM, state.tab);
  }

  if (state.situation) {
    params.set(WEBINAR_SITUATION_PARAM, SITUATION_PARAM_VALUES[state.situation]);
  }

  if (state.kind) {
    params.set(WEBINAR_KIND_PARAM, KIND_PARAM_VALUES[state.kind]);
  }

  const search = state.search?.trim();

  if (search) {
    params.set(WEBINAR_SEARCH_PARAM, search.slice(0, WEBINAR_SEARCH_MAX));
  }

  if (state.page && state.page > 1) {
    params.set(WEBINAR_PAGE_PARAM, String(state.page));
  }

  if (state.periodo) {
    params.set("periodo", state.periodo);
  }

  const query = params.toString();

  return query ? `${WEBINARS_HREF}?${query}` : WEBINARS_HREF;
}

/** Troca uma parte do filtro mantendo as outras e o periodo; qualquer troca volta para a pagina 1. */
export function webinarsFilterHref(current: ParamsRecord, patch: Partial<Omit<WebinarsListState, "page">>) {
  const state = webinarsStateOf(current);

  return webinarsHref({ ...state, ...patch, page: 1, periodo: firstParam(current.periodo) || null });
}

export function webinarAdminHref(id: string) {
  return `${WEBINARS_HREF}/${encodeURIComponent(id)}`;
}

/** O console da sessao (docs/30 §2.4): /[id]/sala, com ?sessao= quando a equipe escolhe uma. */
export const WEBINAR_SESSION_PARAM = "sessao";

export function webinarConsoleHref(id: string, sessionId?: string | null) {
  const base = `${webinarAdminHref(id)}/sala`;

  return sessionId ? `${base}?${WEBINAR_SESSION_PARAM}=${encodeURIComponent(sessionId)}` : base;
}

/** A aba Relatório (docs/30 §2.5): /[id]/relatorio, o endereco e da entrega 2c (report-page-model.ts). */
export { webinarReportHref };

/** "Novo webinário" ja com o tipo (?tipo=ao-vivo|gravada). */
export function newWebinarHref(kind?: WebinarKind | null) {
  return kind ? `${NEW_WEBINAR_HREF}?${WEBINAR_KIND_PARAM}=${KIND_PARAM_VALUES[kind]}` : NEW_WEBINAR_HREF;
}

/**
 * ?pagina= depois da ultima pagina: o endereco da ultima pagina com webinarios (ou da primeira), com os outros
 * filtros. Pagina que existe ou que ainda tem linhas: null.
 */
export function webinarsPageFallbackHref(input: { itemCount: number; page: number; pageSize: number; searchParams: ParamsRecord; total: number }): string | null {
  if (input.page <= 1 || input.itemCount > 0) {
    return null;
  }

  const lastPage = Math.max(1, Math.ceil(Math.max(0, input.total) / Math.max(1, input.pageSize)));

  if (lastPage >= input.page) {
    return null;
  }

  const state = webinarsStateOf(input.searchParams);

  return webinarsHref({ ...state, page: lastPage, periodo: firstParam(input.searchParams.periodo) || null });
}

export function hasWebinarFilters(state: Pick<WebinarsListState, "kind" | "search" | "situation">) {
  return Boolean(state.kind || state.situation || state.search.trim());
}

/** Busca por titulo sem acento e sem maiuscula. */
export function foldWebinarText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export function matchesWebinarSearch(title: string, search: string) {
  const term = foldWebinarText(search);

  return term === "" || foldWebinarText(title).includes(term);
}

/* ------------------------------------------------------------------------------------------------
 * Situacoes e botoes (docs/30 §2.3)
 * ---------------------------------------------------------------------------------------------- */

export type WebinarTone = "error" | "muted" | "neutral" | "success" | "warning";

export function webinarSituationLabel(situation: WebinarSituation) {
  return WEBINAR_COPY.admin.situacoes[situation];
}

export function webinarSituationTone(situation: WebinarSituation): WebinarTone {
  switch (situation) {
    case "scheduled":
      return "success";
    case "in_progress":
      return "warning";
    case "cancelled":
      return "error";
    case "ended":
      return "muted";
    default:
      return "neutral";
  }
}

export function webinarKindLabel(kind: WebinarKind) {
  return WEBINAR_COPY.admin.tipos[kind];
}

export const WEBINAR_ACTIONS = ["open", "save", "publish", "open_room", "cancel", "duplicate", "delete", "open_console", "end", "view_report", "publish_replay"] as const;
export type WebinarAction = (typeof WEBINAR_ACTIONS)[number];

export type WebinarPermissions = { canPublish: boolean; canWrite: boolean };

/**
 * Acoes que chegam em outra fase: aparecem desligadas com "em breve" (docs/30 §2.8), nunca somem em silencio.
 * Fase 2b: Abrir o console, Encerrar live e Ver relatório passaram a valer. Fase 3: Abrir a sala leva ao console da
 * sessao (a Sessao de pratica da Live ao vivo; na Live gravada, o console da fase 2). Fica so o replay como aula.
 */
export const WEBINAR_SOON_ACTIONS: readonly WebinarAction[] = ["publish_replay"];

/** Acoes que so navegam (o menu e o topo abrem outra tela em vez de chamar uma Server Action). */
export const WEBINAR_LINK_ACTIONS: readonly WebinarAction[] = ["open", "open_room", "open_console", "view_report"];

/**
 * Na Live ao vivo, Encerrar live tambem so navega: a acao mora no console, porque e o navegador do apresentador que
 * para a gravacao e desliga a sala para todos antes de a sessao virar Encerrada (docs/30 §6.4 passo 9). Na Live
 * gravada continua a Server Action com confirmacao (fase 2b).
 */
export function isWebinarLinkAction(action: WebinarAction, kind?: WebinarKind | null): boolean {
  return WEBINAR_LINK_ACTIONS.includes(action) || (action === "end" && kind === "live");
}

/** Para onde a acao leva (nulo: a acao roda aqui). Abrir a sala e Abrir o console levam ao console /[id]/sala. */
export function webinarActionHref(action: WebinarAction, id: string, kind?: WebinarKind | null): string | null {
  switch (action) {
    case "open":
      return webinarAdminHref(id);
    case "open_room":
    case "open_console":
      return webinarConsoleHref(id);
    case "view_report":
      return webinarReportHref(id);
    case "end":
      return kind === "live" ? webinarConsoleHref(id) : null;
    default:
      return null;
  }
}

const PUBLISH_ACTIONS: readonly WebinarAction[] = ["publish", "cancel", "delete", "end", "open_room"];

/**
 * Por que a acao aparece desligada (docs/30 §2.6): quem so escreve na Comunicacao ve os botoes da sala que pedem
 * messaging.publish (Abrir a sala; Encerrar live da Live ao vivo) com a explicacao, em vez de nao achar o caminho.
 * As outras acoes de quem publica (Publicar, Cancelar, Excluir, Encerrar da Live gravada) seguem fora da tela.
 */
export function webinarActionBlockedReason(action: WebinarAction, permissions: WebinarPermissions, kind?: WebinarKind | null): string | null {
  if (permissions.canPublish || !PUBLISH_ACTIONS.includes(action)) {
    return null;
  }

  if (action === "open_room") {
    return WEBINAR_ADMIN_COPY.blocked.openRoom;
  }

  return action === "end" && kind === "live" ? WEBINAR_ADMIN_COPY.blocked.end : null;
}

export const WEBINAR_ACTION_LABELS: Record<WebinarAction, string> = {
  cancel: WEBINAR_ADMIN_COPY.menu.cancel,
  delete: WEBINAR_ADMIN_COPY.menu.delete,
  duplicate: WEBINAR_ADMIN_COPY.menu.duplicate,
  end: WEBINAR_ADMIN_COPY.menu.end,
  open: WEBINAR_ADMIN_COPY.menu.open,
  open_console: WEBINAR_ADMIN_COPY.menu.openConsole,
  open_room: WEBINAR_ADMIN_COPY.menu.openRoom,
  publish: WEBINAR_ADMIN_COPY.menu.publish,
  publish_replay: WEBINAR_ADMIN_COPY.menu.publishReplay,
  save: WEBINAR_ADMIN_COPY.menu.save,
  view_report: WEBINAR_ADMIN_COPY.menu.viewReport
};

/** Os botoes do topo por situacao, na ordem da tabela de §2.3. */
export const WEBINAR_HEADER_ACTIONS: Record<WebinarSituation, readonly WebinarAction[]> = {
  cancelled: ["duplicate"],
  draft: ["save", "publish", "delete"],
  ended: ["view_report", "publish_replay", "duplicate"],
  in_progress: ["open_console", "end"],
  scheduled: ["save", "open_room", "cancel", "duplicate"]
};

/**
 * O que aparece para a pessoa com o webinario nesta situacao (o servidor confere de novo): os botoes do topo de
 * §2.3 mais Abrir e Duplicar, que o menu "…" da lista oferece em qualquer situacao (§2.1). Sem messaging.publish, os
 * botoes da sala ao vivo ficam (desligados, webinarActionBlockedReason) e os outros de quem publica saem.
 */
export function webinarActionsFor(situation: WebinarSituation, permissions: WebinarPermissions, kind?: WebinarKind | null): WebinarAction[] {
  if (!permissions.canWrite) {
    return [];
  }

  const actions: WebinarAction[] = ["open", ...WEBINAR_HEADER_ACTIONS[situation]];

  if (!actions.includes("duplicate")) {
    actions.push("duplicate");
  }

  return actions.filter((action) => permissions.canPublish || !PUBLISH_ACTIONS.includes(action) || webinarActionBlockedReason(action, permissions, kind) !== null);
}

export type WebinarMenuEntry = {
  action: WebinarAction;
  /** Desligado por permissao: a explicacao (o item mostra "· só quem publica"); nulo quando vale. */
  blocked: string | null;
  destructive: boolean;
  /** O texto do item como a tela mostra (com "· em breve" ou "· só quem publica" quando desligado). */
  display: string;
  label: string;
  separated: boolean;
  soon: boolean;
};

const MENU_ORDER: readonly WebinarAction[] = ["open", "open_room", "open_console", "view_report", "publish_replay", "duplicate", "cancel", "end", "delete"];
const DESTRUCTIVE_ACTIONS = new Set<WebinarAction>(["cancel", "delete", "end"]);

/**
 * Itens do menu "…" (docs/30 §2.1: Abrir, Abrir a sala, Duplicar, Cancelar, Excluir só rascunho). Salvar e Publicar
 * ficam na Revisao do editor; `exclude` tira o que a tela ja mostra como botao. `kind` decide o Encerrar live (link
 * para o console na Live ao vivo).
 */
export function webinarMenuEntries(situation: WebinarSituation, permissions: WebinarPermissions, exclude: readonly WebinarAction[] = [], kind?: WebinarKind | null): WebinarMenuEntry[] {
  const available = new Set(webinarActionsFor(situation, permissions, kind).filter((action) => action !== "save" && action !== "publish" && !exclude.includes(action)));
  const ordered = MENU_ORDER.filter((action) => available.has(action));

  return ordered.map((action, index) => {
    const label = WEBINAR_ACTION_LABELS[action];
    const soon = WEBINAR_SOON_ACTIONS.includes(action);
    const blocked = webinarActionBlockedReason(action, permissions, kind);

    return {
      action,
      blocked,
      destructive: DESTRUCTIVE_ACTIONS.has(action),
      display: soon ? `${label} · ${WEBINAR_ADMIN_COPY.emBreve}` : blocked ? `${label} · ${WEBINAR_ADMIN_COPY.menu.onlyPublishers}` : label,
      label,
      separated: index > 0 && DESTRUCTIVE_ACTIONS.has(action) && !DESTRUCTIVE_ACTIONS.has(ordered[index - 1]),
      soon
    };
  });
}

export type WebinarHeaderButton = {
  action: WebinarAction;
  /** Desligado por permissao: a explicacao que a tela escreve embaixo do cabecalho. */
  blocked: string | null;
  /** O link (nulo quando desligado: em breve ou sem permissao). */
  href: string | null;
  label: string;
  soon: boolean;
};

/**
 * Os botoes do topo do editor (docs/30 §2.3) que nao sao Salvar e Publicar (na Revisao): os que navegam (Abrir a sala,
 * Abrir o console, Ver relatório; Encerrar live na Live ao vivo) e os que chegam depois ("em breve"). Cancelar,
 * Duplicar, Excluir e o Encerrar da Live gravada ficam no menu "…" ao lado.
 */
export function webinarHeaderButtons(input: { id: string; kind: WebinarKind; permissions: WebinarPermissions; situation: WebinarSituation }): WebinarHeaderButton[] {
  if (!input.permissions.canWrite) {
    return [];
  }

  return WEBINAR_HEADER_ACTIONS[input.situation].flatMap((action): WebinarHeaderButton[] => {
    const soon = WEBINAR_SOON_ACTIONS.includes(action);
    const href = webinarActionHref(action, input.id, input.kind);

    if (action === "save" || action === "publish" || (!soon && !href)) {
      return [];
    }

    const blocked = webinarActionBlockedReason(action, input.permissions, input.kind);

    return [{ action, blocked, href: soon || blocked ? null : href, label: WEBINAR_ACTION_LABELS[action], soon }];
  });
}

export type WebinarRowShortcut = { action: "open_console" | "open_room"; href: string; label: string };

/**
 * O atalho na linha da lista (docs/30 §2.1 e §2.3): a Live ao vivo agendada leva a sala (so quem publica; quem nao
 * publica acha o item desligado no menu "…") e a Live ao vivo em andamento ao console. A Live gravada fica com o menu.
 */
export function webinarRowShortcut(item: { id: string; kind: WebinarKind; situation: WebinarSituation }, permissions: WebinarPermissions): WebinarRowShortcut | null {
  if (item.kind !== "live" || !permissions.canWrite) {
    return null;
  }

  if (item.situation === "in_progress") {
    return { action: "open_console", href: webinarConsoleHref(item.id), label: WEBINAR_ACTION_LABELS.open_console };
  }

  return item.situation === "scheduled" && permissions.canPublish ? { action: "open_room", href: webinarConsoleHref(item.id), label: WEBINAR_ACTION_LABELS.open_room } : null;
}

/** Cancelar, Excluir e o Encerrar live da Live gravada pedem confirmacao; o da Live ao vivo so leva ao console. */
export function webinarActionNeedsConfirm(action: WebinarAction, kind?: WebinarKind | null) {
  return action === "cancel" || action === "delete" || (action === "end" && kind !== "live");
}

export type WebinarConfirmCopy = { confirmLabel: string; description: string; destructive: boolean; title: string };

export type WebinarConfirmableAction = "cancel" | "delete" | "end";

export function webinarActionConfirm(action: WebinarConfirmableAction, target: { registeredCount: number; title: string }): WebinarConfirmCopy {
  const title = target.title.trim() || WEBINAR_ADMIN_COPY.preview.titlePlaceholder;

  if (action === "cancel") {
    return {
      confirmLabel: WEBINAR_ADMIN_COPY.confirm.cancel.confirmLabel,
      description: WEBINAR_ADMIN_COPY.confirm.cancel.description(target.registeredCount),
      destructive: true,
      title: WEBINAR_ADMIN_COPY.confirm.cancel.title(title)
    };
  }

  if (action === "end") {
    return {
      confirmLabel: WEBINAR_ADMIN_COPY.confirm.end.confirmLabel,
      description: WEBINAR_ADMIN_COPY.confirm.end.description,
      destructive: true,
      title: WEBINAR_ADMIN_COPY.confirm.end.title(title)
    };
  }

  return {
    confirmLabel: WEBINAR_ADMIN_COPY.confirm.delete.confirmLabel,
    description: WEBINAR_ADMIN_COPY.confirm.delete.description,
    destructive: true,
    title: WEBINAR_ADMIN_COPY.confirm.delete.title
  };
}

export const WEBINAR_ACTION_TOASTS: Partial<Record<WebinarAction, string>> = {
  cancel: WEBINAR_ADMIN_COPY.toasts.cancelled,
  delete: WEBINAR_ADMIN_COPY.toasts.deleted,
  duplicate: WEBINAR_ADMIN_COPY.toasts.duplicated,
  end: WEBINAR_ADMIN_COPY.toasts.ended,
  publish: WEBINAR_ADMIN_COPY.toasts.published
};

export function savedWebinarToast(status: "draft" | "published" | "archived") {
  return status === "published" ? WEBINAR_ADMIN_COPY.toasts.savedPublished : WEBINAR_ADMIN_COPY.toasts.saved;
}

export function webinarFailureTitle(input: { savedDraft: boolean; status: number }) {
  if (input.status === 409) {
    return WEBINAR_ADMIN_COPY.failures.conflictTitle;
  }

  return input.savedDraft ? WEBINAR_ADMIN_COPY.failures.publishSaved : WEBINAR_ADMIN_COPY.failures.generic;
}

/* ------------------------------------------------------------------------------------------------
 * Cards do editor (docs/30 §2.2) e o mapa dos erros
 * ---------------------------------------------------------------------------------------------- */

export const WEBINAR_EDITOR_CARDS = [
  "dados",
  "sessoes",
  "simulacao",
  "roteiro",
  "quemPode",
  "vagaLembretes",
  "avisar",
  "sala",
  "enquetes",
  "oferta",
  "assistente",
  "qualidade",
  "gravacao",
  "replayAula",
  "revisao"
] as const;
export type WebinarEditorCard = (typeof WEBINAR_EDITOR_CARDS)[number];

/**
 * Cards que so existem num webinario ja gravado (precisam do id): o roteiro, a Simulacao, as enquetes e, na fase 4, a
 * Oferta (4b) e o Assistente (4c), que salvam pelas proprias Server Actions.
 */
export const WEBINAR_SAVED_ONLY_CARDS: readonly WebinarEditorCard[] = ["simulacao", "roteiro", "enquetes", "oferta", "assistente"];

const SIMULATED_ONLY_CARDS: readonly WebinarEditorCard[] = ["sessoes", "simulacao", "roteiro"];

/** Os cards na ordem, por tipo: Sessoes, Simulacao e Roteiro so na Live gravada, Gravacao so na Live ao vivo. */
export function webinarEditorCards(kind: WebinarKind): WebinarEditorCard[] {
  return WEBINAR_EDITOR_CARDS.filter((card) => (SIMULATED_ONLY_CARDS.includes(card) ? kind === "simulated" : card === "gravacao" ? kind === "live" : true));
}

export function webinarCardTitle(card: WebinarEditorCard) {
  return WEBINAR_ADMIN_COPY.cards[card];
}

/** Em que card cada campo do rascunho fica (o foco do primeiro erro e o resumo do banner). */
const FIELD_CARDS: readonly [string, WebinarEditorCard][] = [
  ["accessMode", "quemPode"],
  ["audience", "quemPode"],
  ["productId", "quemPode"],
  ["capacity", "quemPode"],
  ["showRegisteredCount", "quemPode"],
  ["registrationRequired", "vagaLembretes"],
  ["reminders", "vagaLembretes"],
  ["reminderTexts", "vagaLembretes"],
  ["showOnHome", "avisar"],
  ["replayDaysOnHome", "avisar"],
  ["showBanner", "avisar"],
  ["roomSettings", "sala"],
  ["allowStudentCamera", "sala"],
  ["quality", "qualidade"],
  ["autoRecord", "gravacao"],
  ["replayLessonTarget", "replayAula"],
  ["sessions", "sessoes"],
  ["jit", "sessoes"],
  ["kind", "dados"],
  ["title", "dados"],
  ["coverUrl", "dados"],
  ["description", "dados"],
  ["hostUserId", "dados"],
  ["presenters", "dados"],
  ["scheduledAt", "dados"],
  ["durationMinutes", "dados"],
  ["recordingVideoUrl", "dados"]
];

export function webinarCardOfField(key: string): WebinarEditorCard {
  const found = FIELD_CARDS.find(([prefix]) => key === prefix || key.startsWith(`${prefix}.`));

  return found?.[1] ?? "dados";
}

export type WebinarFieldErrors = Record<string, string>;

/** Problemas do zod -> primeira mensagem de cada campo ("sessions.1.scheduledAt"). */
export function webinarErrorsFrom(issues: readonly { message: string; path: readonly PropertyKey[] }[]): WebinarFieldErrors {
  const errors: WebinarFieldErrors = {};

  for (const issue of issues) {
    const key = issue.path.map(String).join(".");

    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }

  return errors;
}

/** fieldErrors da ActionResult ({ "draft.title": ["..."] }) no mesmo formato, sem o "draft." do schema de salvar. */
export function webinarErrorsFromAction(fieldErrors: Record<string, string[] | undefined> | undefined): WebinarFieldErrors {
  const errors: WebinarFieldErrors = {};

  for (const [key, messages] of Object.entries(fieldErrors ?? {})) {
    const message = messages?.[0];

    if (message) {
      errors[key.startsWith("draft.") ? key.slice("draft.".length) : key] = message;
    }
  }

  return errors;
}

/** Erros do segmento por regra ("audience.root.items.1.items.0.percent" -> "1.0"); o segmento inteiro fica em "". */
export function webinarAudienceErrorsFrom(errors: WebinarFieldErrors): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, message] of Object.entries(errors)) {
    if (key !== "audience" && !key.startsWith("audience.")) {
      continue;
    }

    const parts = key.split(".").slice(1);
    const indexes: number[] = [];

    if (parts[0] === "root") {
      for (let index = 1; index + 1 < parts.length && parts[index] === "items"; index += 2) {
        const position = Number(parts[index + 1]);

        if (!Number.isInteger(position)) {
          break;
        }

        indexes.push(position);
      }
    }

    const nodeKey = indexes.join(".");

    if (!(nodeKey in result)) {
      result[nodeKey] = message;
    }
  }

  return result;
}

/**
 * O que o schema nao confere e a tela sim (docs/30 §2.2): o apresentador fora da lista de co-apresentadores e
 * com permissao de publicar, "Produto ou segmento" com um segmento montado, as sessoes com data e hora, e a aula
 * do replay com produto.
 */
export function webinarScreenProblems(draft: WebinarDraft, context: { publishers?: ReadonlySet<string> | null } = {}): WebinarFieldErrors {
  const errors: WebinarFieldErrors = {};

  if (draft.hostUserId) {
    const index = draft.presenters.findIndex((presenter) => presenter.userId === draft.hostUserId);

    if (index >= 0) {
      errors[`presenters.${index}.userId`] = WEBINAR_ADMIN_COPY.problems.hostInPresenters;
    }

    if (context.publishers && !context.publishers.has(draft.hostUserId)) {
      errors.hostUserId = WEBINAR_ADMIN_COPY.problems.hostCannotPublish;
    }
  }

  if (draft.accessMode === "either" && draft.audience.kind === "everyone") {
    errors.audience = WEBINAR_ADMIN_COPY.problems.eitherNeedsAudience;
  }

  draft.sessions.forEach((session, index) => {
    if (!Number.isFinite(Date.parse(session.scheduledAt))) {
      errors[`sessions.${index}.scheduledAt`] = WEBINAR_MESSAGES.dateTime;
    }
  });

  if (draft.kind === "live" && draft.scheduledAt !== null && !Number.isFinite(Date.parse(draft.scheduledAt))) {
    errors.scheduledAt = WEBINAR_MESSAGES.dateTime;
  }

  if (draft.replayLessonTarget && !draft.replayLessonTarget.productId) {
    errors["replayLessonTarget.productId"] = WEBINAR_ADMIN_COPY.problems.replayLessonNeedsProduct;
  }

  return errors;
}

/** O rascunho como vai para o servidor: datas incompletas ("") viram nulo ou saem, textos sem espaco nas pontas. */
export function canonicalWebinarDraft(draft: WebinarDraft): WebinarDraft {
  const texts = draft.reminderTexts;
  const trimText = (value: string | null) => (value && value.trim() ? value.trim() : null);

  return {
    ...draft,
    capacity: draft.registrationRequired ? draft.capacity : null,
    coverUrl: trimText(draft.coverUrl),
    description: draft.description.trim(),
    presenters: draft.presenters.map((presenter) => ({ ...presenter, canModerateRoom: presenter.role === "team" && presenter.canModerateRoom })),
    productId: accessModeUsesProduct(draft.accessMode) ? draft.productId : null,
    recordingVideoUrl: draft.kind === "simulated" ? trimText(draft.recordingVideoUrl) : null,
    reminderTexts: {
      afterAbsent: trimText(texts.afterAbsent),
      afterAttended: trimText(texts.afterAttended),
      confirmation: trimText(texts.confirmation),
      h1: trimText(texts.h1),
      h24: trimText(texts.h24),
      started: trimText(texts.started)
    },
    replayLessonTarget: draft.replayLessonTarget ? { ...draft.replayLessonTarget, moduleId: trimText(draft.replayLessonTarget.moduleId), title: trimText(draft.replayLessonTarget.title) } : null,
    scheduledAt: draft.kind === "live" ? draft.scheduledAt : null,
    sessions: draft.kind === "simulated" ? draft.sessions.map(canonicalSession) : [],
    title: draft.title.trim()
  };
}

/** A sessao do rascunho com a Entrada atrasada normalizada (vazio ou invalido = sempre). */
export function canonicalSession(session: WebinarDraft["sessions"][number]): WebinarDraft["sessions"][number] {
  const minutes = session.lateJoinMinutes;
  const lateJoinMinutes = typeof minutes === "number" && Number.isInteger(minutes) && minutes >= 0 ? Math.min(minutes, WEBINAR_LIMITS.lateJoinMax) : null;

  return { lateJoinMinutes, scheduledAt: session.scheduledAt };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "null";
}

export function isSameWebinarDraft(left: WebinarDraft, right: WebinarDraft) {
  return stableJson(canonicalWebinarDraft(left)) === stableJson(canonicalWebinarDraft(right));
}

/**
 * Depois do "Recarregar" de um 409: o que esta tela nao mexeu (igual ao que ela tinha gravado) segue o servidor;
 * o que ela mudou fica. Campo a campo, no primeiro nivel do rascunho.
 */
export function rebaseWebinarDraft(base: WebinarDraft, local: WebinarDraft, server: WebinarDraft): WebinarDraft {
  const result = { ...server } as Record<string, unknown>;

  for (const key of Object.keys(local) as (keyof WebinarDraft)[]) {
    if (stableJson(local[key]) !== stableJson(base[key])) {
      result[key] = local[key];
    }
  }

  return result as WebinarDraft;
}

/** Rascunho novo ja com o tipo escolhido na primeira tela (docs/30 §2.2). */
export function startWebinarDraft(kind: WebinarKind): WebinarDraft {
  return emptyWebinarDraft(kind);
}

/** So os campos do rascunho (um webinario gravado traz id, slug, situacao... a mais). */
export function webinarDraftOf(source: WebinarDraft): WebinarDraft {
  return {
    accessMode: source.accessMode,
    allowStudentCamera: source.allowStudentCamera,
    audience: source.audience,
    autoRecord: source.autoRecord,
    capacity: source.capacity,
    chatRetentionDays: source.chatRetentionDays,
    coverUrl: source.coverUrl,
    description: source.description,
    durationMinutes: source.durationMinutes,
    hostUserId: source.hostUserId,
    kind: source.kind,
    presenters: source.presenters.map((presenter) => ({ ...presenter })),
    productId: source.productId,
    quality: { ...source.quality },
    recordingRetentionDays: source.recordingRetentionDays,
    recordingVideoUrl: source.recordingVideoUrl,
    registrationRequired: source.registrationRequired,
    reminderTexts: { ...source.reminderTexts },
    reminders: { ...source.reminders },
    replayDaysOnHome: source.replayDaysOnHome,
    replayLessonTarget: source.replayLessonTarget ? { ...source.replayLessonTarget } : null,
    roomSettings: { ...source.roomSettings },
    scheduledAt: source.scheduledAt,
    sessions: source.sessions.map(canonicalSession),
    showBanner: source.showBanner,
    showOnHome: source.showOnHome,
    showRegisteredCount: source.showRegisteredCount,
    title: source.title
  };
}

/** Ao trocar o tipo num rascunho, o que so vale para o outro tipo sai. */
export function webinarDraftForKind(draft: WebinarDraft, kind: WebinarKind): WebinarDraft {
  if (draft.kind === kind) {
    return draft;
  }

  return kind === "live"
    ? { ...draft, kind, recordingVideoUrl: null, scheduledAt: draft.sessions[0]?.scheduledAt ?? draft.scheduledAt, sessions: [] }
    : { ...draft, kind, scheduledAt: null, sessions: draft.scheduledAt ? [{ lateJoinMinutes: null, scheduledAt: draft.scheduledAt }] : draft.sessions };
}

export function isWebinarKindLocked(status: "archived" | "draft" | "published" | null | undefined) {
  return status === "published" || status === "archived";
}

/* ------------------------------------------------------------------------------------------------
 * Datas do editor (Sao Paulo) e sessoes
 * ---------------------------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

function addDays(date: string, days: number) {
  const base = new Date(`${date}T12:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);

  return base.toISOString().slice(0, 10);
}

/** Hora marcada sugerida: amanha as 20:00 de Sao Paulo (a hora cheia mais comum das lives). */
export function defaultWebinarScheduledAt(now: number) {
  const today = new Date(now - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return saoPauloLocalToIso(addDays(today, 1), "20:00") ?? new Date(now + DAY_MS).toISOString();
}

/** A proxima sessao sugerida: um dia depois da ultima marcada (ou amanha as 20:00). */
export function nextWebinarSessionAt(sessions: readonly { scheduledAt: string }[], now: number) {
  const times = sessions.map((session) => Date.parse(session.scheduledAt)).filter((time) => Number.isFinite(time));

  if (times.length === 0) {
    return defaultWebinarScheduledAt(now);
  }

  return new Date(Math.max(...times) + DAY_MS).toISOString();
}

export function sortWebinarSessions<T extends { scheduledAt: string }>(sessions: readonly T[]): T[] {
  return [...sessions].sort((left, right) => (Date.parse(left.scheduledAt) || 0) - (Date.parse(right.scheduledAt) || 0));
}

export const DURATION_PRESETS: readonly number[] = [30, 45, 60, 90, 120, 180];

export const ACCESS_MODE_OPTIONS: readonly { label: string; value: AccessMode }[] = [
  { label: WEBINAR_ADMIN_COPY.fields.accessModes.everyone, value: "everyone" },
  { label: WEBINAR_ADMIN_COPY.fields.accessModes.product, value: "product" },
  { label: WEBINAR_ADMIN_COPY.fields.accessModes.audience, value: "audience" },
  { label: WEBINAR_ADMIN_COPY.fields.accessModes.either, value: "either" },
  { label: WEBINAR_ADMIN_COPY.fields.accessModes.both, value: "both" }
];

export function accessUsesProduct(mode: AccessMode) {
  return accessModeUsesProduct(mode);
}

export function accessUsesAudience(mode: AccessMode) {
  return accessModeUsesAudience(mode);
}

/** As lives do seletor da regra "Participação em lives" no Quem pode, sem a propria live (uma regra nela seria um laco). */
export function webinarAudienceChoices<T extends { id: string }>(webinars: readonly T[] | null | undefined, webinarId: string | null): T[] {
  return (webinars ?? []).filter((webinar) => webinar.id !== webinarId);
}

/**
 * A dica embaixo do segmento: no Segmento e no "both", vale na hora e a vaga e a ancora; no "Produto ou segmento", sem
 * ancora, como segurar a vaga (D41).
 */
export function webinarAccessHint(mode: AccessMode): string | null {
  if (mode === "either") {
    return WEBINAR_ADMIN_COPY.fields.accessEitherHint;
  }

  return accessModeAnchorsAudience(mode) ? WEBINAR_ADMIN_COPY.fields.accessSegmentHint : null;
}

function someRule(node: AudienceNode, test: (rule: AudienceRule) => boolean): boolean {
  return isAudienceGroup(node) ? node.items.some((item) => someRule(item, test)) : test(node);
}

/**
 * O aviso do card Quem pode quando o segmento tem regra de tempo ("Ganhou acesso recentemente", que vira com o dia ou
 * com as horas). No Segmento e no "both", onde a vaga e a ancora, so com "Entrar direto, sem vaga": sem vaga nada
 * segura quem saiu do segmento antes de entrar na sala. No "Produto ou segmento", sem ancora, com ou sem vaga: nem a
 * vaga nem a presenca seguram, e quem nao tem o produto sai quando a regra vence, ate no meio da live (D41).
 */
export function webinarAccessNotice(draft: Pick<WebinarDraft, "accessMode" | "audience" | "registrationRequired">): string | null {
  if (!accessUsesAudience(draft.accessMode) || draft.audience.kind !== "rules" || !someRule(draft.audience.root, (rule) => rule.type === "access_recent")) {
    return null;
  }

  if (draft.accessMode === "either") {
    return WEBINAR_ADMIN_COPY.fields.accessTimeRuleEither;
  }

  return accessModeAnchorsAudience(draft.accessMode) && !draft.registrationRequired ? WEBINAR_ADMIN_COPY.fields.accessTimeRuleNoSeat : null;
}

/**
 * O segmento que a contagem ao vivo do editor conta (previewNoticeAudience). Em "Quem tem o produto e está no segmento",
 * o produto entra como regra junto do segmento, num grupo "todas": as regras de um grupo "todas" entram soltas; um
 * grupo "qualquer" entra inteiro (e, se ja tiver grupos dentro, cada caminho dele ganha o produto, para nao passar de
 * um grupo dentro do principal). Sem produto escolhido, conta so o segmento (o erro do produto ja esta no card). A
 * montagem e a mesma do atalho Avisar (audienceWithProduct, em notice-shortcut-model.ts). Com o webinario salvo
 * (`webinarId`), a regra "nunca ... em nenhuma live" nao conta a propria live (withOwnWebinar, como no Quem pode): a
 * contagem nao cai a cada vaga nesta live; se a troca passar dos limites, conta o segmento como esta.
 */
export function webinarCountAudience(draft: Pick<WebinarDraft, "accessMode" | "audience" | "productId">, webinarId?: string | null): AudienceDefinition {
  const own = withOwnWebinar(draft.audience, webinarId);
  const segment = countAudienceRules(own) <= AUDIENCE_LIMITS.maxRules && audienceDepth(own) <= AUDIENCE_LIMITS.maxDepth ? own : draft.audience;

  return draft.accessMode === "both" && draft.productId ? audienceWithProduct(draft.productId, segment) : segment;
}

/**
 * A frase embaixo do "≈ N agora" no card Quem pode: o segmento como a equipe montou (no "both", com o produto junto),
 * sem a troca da propria live de webinarCountAudience, que so vale para o numero. Assim a frase nunca mostra uma regra
 * que a equipe nao montou nem pode montar ("garantiram vaga nesta live"), e o rascunho, que nao aparece na lista de
 * lives, nunca vira "uma live removida".
 */
export function webinarAudienceDescription(draft: Pick<WebinarDraft, "accessMode" | "audience" | "productId">, names: AudienceNames): string {
  return describeAudience(normalizeAudience(webinarCountAudience(draft)), names);
}

/* ------------------------------------------------------------------------------------------------
 * Avisar › Aviso no sino e Pop-up (docs/30 §2.2)
 * ---------------------------------------------------------------------------------------------- */

export type WebinarNotifyShortcuts = {
  /** O motivo dos dois atalhos desligados (uma frase so, embaixo deles); null = ligados. */
  blocked: string | null;
  inbox: WebinarCardLink;
  popup: WebinarCardLink;
  /** A dica embaixo do Pop-up, pelo Quem pode salvo (webinarNotifyPopupHint). */
  popupHint: string;
};

/**
 * A dica do atalho Pop-up pelo modo do Quem pode (D42): no Segmento e no "both" (com a ancora), quem tem vaga e saiu
 * do segmento fica fora do pop-up e recebe o Comecou agora; no "Produto ou segmento" (sem ancora), quem saiu do
 * segmento sem o produto nao ve a live nem recebe os avisos dela; em Todos e Quem tem o produto, sem frase de segmento.
 */
export function webinarNotifyPopupHint(mode: AccessMode): string {
  const hints = WEBINAR_ADMIN_COPY.fields.notifyPopupHint;

  if (mode === "either") {
    return hints.either;
  }

  return accessModeAnchorsAudience(mode) ? hints.anchored : hints.plain;
}

/**
 * Os atalhos do card Avisar: abrem /admin/comunicacao/avisos/novo?webinario=<id>&tipo= (o aviso preenchido com o
 * webinario SALVO, sem gravar nada; notice-shortcut-model.ts). Desligados, com o motivo, nesta ordem: sem
 * messaging.write (a mesma permissao do editor do aviso); webinario nunca salvo ou rascunho; cancelado; encerrado; com
 * mudanca sem salvar; Quem pode que nao cabe num aviso (AUDIENCE_LIMITS). `draft` e o webinario salvo.
 */
export function webinarNotifyShortcuts(input: {
  dirty: boolean;
  draft: Pick<WebinarDraft, "accessMode" | "audience" | "productId">;
  permissions: WebinarPermissions;
  saved: { id: string; situation: WebinarSituation; status: WebinarStatus } | null;
}): WebinarNotifyShortcuts {
  const fields = WEBINAR_ADMIN_COPY.fields;
  const blocked = !input.permissions.canWrite
    ? WEBINAR_NOTICE_COPY.blocked.write
    : (webinarNoticeStatusBlock(input.saved) ??
      (input.dirty ? WEBINAR_NOTICE_COPY.blocked.dirty : null) ??
      (() => {
        const translated = webinarNoticeAudience({ ...input.draft, id: input.saved?.id ?? null });

        return translated.ok ? null : translated.reason;
      })());
  const link = (kind: "inbox" | "popup", label: string): WebinarCardLink => ({
    blocked,
    href: blocked || !input.saved ? null : webinarNoticeHref(input.saved.id, kind),
    label
  });

  return { blocked, inbox: link("inbox", fields.notifyInbox), popup: link("popup", fields.popupLink), popupHint: webinarNotifyPopupHint(input.draft.accessMode) };
}

/* ------------------------------------------------------------------------------------------------
 * Previa do card do aluno e a revisao
 * ---------------------------------------------------------------------------------------------- */

export type WebinarPreviewCard = {
  countdown: string;
  coverUrl: string | null;
  kindLabel: string;
  registrationLabel: string;
  sessionsLabel: string | null;
  title: string;
  whenLabel: string;
};

/** Hora marcada da primeira sessao que ainda vai acontecer (ou a ultima marcada). */
export function webinarFirstSessionAt(draft: Pick<WebinarDraft, "kind" | "scheduledAt" | "sessions">, now: number): string | null {
  if (draft.kind === "live") {
    return draft.scheduledAt && Number.isFinite(Date.parse(draft.scheduledAt)) ? draft.scheduledAt : null;
  }

  const sorted = sortWebinarSessions(draft.sessions.filter((session) => Number.isFinite(Date.parse(session.scheduledAt))));
  const next = sorted.find((session) => Date.parse(session.scheduledAt) >= now);

  return (next ?? sorted[sorted.length - 1])?.scheduledAt ?? null;
}

export function webinarPreviewCard(draft: WebinarDraft, now: number): WebinarPreviewCard {
  const at = webinarFirstSessionAt(draft, now);
  const whenLabel = at ? formatWebinarWhen(at) : WEBINAR_ADMIN_COPY.preview.dateMissing;

  return {
    // A mesma contagem regressiva da pagina do aluno (webinar-time.ts).
    countdown: at ? countdownLabel(at, now) : "",
    coverUrl: draft.coverUrl,
    kindLabel: webinarKindLabel(draft.kind),
    registrationLabel: draft.registrationRequired ? WEBINAR_COPY.aluno.garantirVaga : WEBINAR_COPY.aluno.entrar,
    sessionsLabel: draft.kind === "simulated" && draft.sessions.length > 1 ? WEBINAR_ADMIN_COPY.preview.sessionsLabel(draft.sessions.length) : null,
    title: draft.title.trim() || WEBINAR_ADMIN_COPY.preview.titlePlaceholder,
    whenLabel
  };
}

/** Os textos dos lembretes como o aluno recebe (o padrao quando o texto da equipe esta vazio). */
export function reminderPreviewText(kind: "confirmation" | "h1" | "h24" | "started", draft: Pick<WebinarDraft, "reminderTexts" | "title">, at: string | null) {
  const custom = draft.reminderTexts[kind];

  if (custom && custom.trim()) {
    return custom.trim();
  }

  const title = draft.title.trim() || WEBINAR_ADMIN_COPY.preview.titlePlaceholder;
  const time = at ? saoPauloTime(at) : "20:00";

  switch (kind) {
    case "confirmation":
      return WEBINAR_COPY.aluno.vagaGarantidaToast;
    case "h24":
      return WEBINAR_COPY.sino.h24(title, time);
    case "h1":
      return WEBINAR_COPY.sino.h1(title);
    default:
      return WEBINAR_COPY.sino.comecou(title);
  }
}

export function describeWebinarAccess(draft: Pick<WebinarDraft, "accessMode" | "capacity" | "registrationRequired">, productName: string | null) {
  const product = productName ?? "o produto escolhido";
  let who: string;

  switch (draft.accessMode) {
    case "product":
      who = `quem tem ${product}`;
      break;
    case "audience":
      who = "quem está no segmento";
      break;
    case "either":
      who = `quem tem ${product} ou está no segmento`;
      break;
    case "both":
      who = `quem tem ${product} e está no segmento`;
      break;
    default:
      who = "todos os alunos";
  }

  if (draft.registrationRequired && draft.capacity) {
    return `${who}, até ${draft.capacity} ${draft.capacity === 1 ? "vaga" : "vagas"}`;
  }

  return who;
}

/**
 * O que falta para publicar na tela (publishProblems) com o "Comeca quando voce entra" gravado: a Live gravada com ele
 * ligado publica sem hora marcada (docs/30 §2.2; a Server Action confere de novo com as regras do banco).
 */
export function webinarPublishProblems(draft: WebinarDraft, now: number, jit: Pick<JitSettings, "enabled"> | null | undefined) {
  return withJitPublishProblems(publishProblems(draft, now), { jit, kind: draft.kind });
}

/** A frase da Revisao: o que falta para publicar ou o resumo do que vai ao ar (com o just-in-time, os horarios dele). */
export function webinarReviewSentence(input: {
  draft: WebinarDraft;
  /** Fase 4e: as regras gravadas do "Comeca quando voce entra" (nulo ou desligado: so as horas marcadas). */
  jit?: Pick<JitSettings, "enabled" | "endHour" | "everyMinutes" | "startHour"> | null;
  now: number;
  productName: string | null;
  registeredCount: number | null;
  situation: WebinarSituation | null;
}): string {
  const { draft } = input;
  const problems = webinarPublishProblems(draft, input.now, input.jit);

  if ((input.situation === null || input.situation === "draft") && problems.length > 0) {
    const messages = Array.from(new Set(problems.map((problem) => problem.message.replace(/\.$/, ""))));

    return `${WEBINAR_ADMIN_COPY.review.missing(messages)}.`;
  }

  const at = webinarFirstSessionAt(draft, input.now);
  const when = at ? formatSaoPauloDateTime(at) : "—";
  const sessions = draft.kind === "simulated" ? ` (${draft.sessions.length} ${draft.sessions.length === 1 ? "sessão" : "sessões"})` : "";
  const access = describeWebinarAccess(draft, input.productName);
  const registration = draft.registrationRequired
    ? draft.reminders.h24 || draft.reminders.h1
      ? `, com Garantir vaga e lembrete ${[draft.reminders.h24 ? "1 dia" : null, draft.reminders.h1 ? "1 hora" : null].filter(Boolean).join(" e ")} antes`
      : ", com Garantir vaga"
    : ", sem vaga";
  const registered = typeof input.registeredCount === "number" && input.registeredCount > 0 ? ` ${input.registeredCount} ${input.registeredCount === 1 ? "aluno já garantiu" : "alunos já garantiram"} vaga.` : "";
  const home = draft.showOnHome ? " O card entra na página inicial." : "";
  const jit = input.jit && jitActive(draft.kind, input.jit) ? jitSummary(input.jit) : null;
  const schedule = jit && draft.sessions.length === 0 ? ` com ${jit}` : ` em ${when}${sessions}${jit ? ` e ${jit}` : ""}`;

  return `${webinarKindLabel(draft.kind)}${schedule}, ${draft.durationMinutes} min, para ${access}${registration}.${home}${registered}`;
}

/* ------------------------------------------------------------------------------------------------
 * A sessao da Live ao vivo no admin (fase 3): o que vai para a tela, o card Gravacao e o pico da lista
 * ---------------------------------------------------------------------------------------------- */

/**
 * A sessao como vai para a tela (props de componente cliente): sem o nome da sala. O `room_name` so existe no
 * servidor e dentro do token de quem entra (docs/30 §8.1); quem adivinha o nome nao entra, mas ele nunca e mostrado.
 */
export type WebinarScreenSession = WebinarSession & { roomName: null };

export function webinarScreenSession(session: WebinarSession): WebinarScreenSession {
  return { ...session, roomName: null };
}

/** O que o editor precisa da sessao `live` (card Gravacao): a situacao e o gravador, nunca o nome da sala. */
export type WebinarLiveSessionSummary = {
  endedAt: string | null;
  id: string;
  recorderRequestedAt: string | null;
  recorderStatus: RecorderStatus;
  recordingAnchorAt: string | null;
  recordingRequestedAt: string | null;
  scheduledAt: string;
  startedAt: string | null;
  status: SessionStatus;
};

/**
 * A sessao `live` do webinario, campo a campo: a que ainda vale (nao cancelada; a mais recente) ou, num webinario
 * cancelado, a ultima cancelada (o card mostra a situacao do gravador dela, sem caminhos para o console).
 */
export function webinarLiveSessionOf(sessions: readonly WebinarSession[]): WebinarLiveSessionSummary | null {
  const latest = (list: readonly WebinarSession[]) =>
    list.reduce<WebinarSession | null>((best, session) => (!best || Date.parse(session.scheduledAt) > Date.parse(best.scheduledAt) ? session : best), null);
  const lives = sessions.filter((session) => session.kind === "live");
  const live = latest(lives.filter((session) => session.status !== "cancelled")) ?? latest(lives);

  if (!live) {
    return null;
  }

  return {
    endedAt: live.endedAt,
    id: live.id,
    recorderRequestedAt: live.recorderRequestedAt,
    recorderStatus: live.recorderStatus,
    recordingAnchorAt: live.recordingAnchorAt,
    recordingRequestedAt: live.recordingRequestedAt,
    scheduledAt: live.scheduledAt,
    startedAt: live.startedAt,
    status: live.status
  };
}

/** O tom do selo de cada situacao do gravador (os nomes de §2.2 vem de RECORDER_LABELS). */
export const RECORDER_TONES: Record<RecorderStatus, WebinarTone> = {
  gone: "muted",
  none: "neutral",
  preparing: "warning",
  ready: "success",
  recording: "success",
  unavailable: "error",
  upload_failed: "error",
  uploaded: "success",
  uploading: "warning"
};

/** Um link do card (nulo o href quando desligado por permissao, com a explicacao). */
export type WebinarCardLink = { blocked: string | null; href: string | null; label: string };

export type WebinarRecordingCardView = {
  /** A frase do Gravar automaticamente, ligado ou desligado. */
  autoRecordHint: string;
  /** Antes de publicar (sem a sessao `live`): a sala e o gravador nascem ao publicar. */
  pendingNote: string | null;
  /** Preparar gravação: so com a maquina por pedir e a sessao por acontecer ou no ar. */
  prepare: WebinarCardLink | null;
  /** Sem a sala neste ambiente (WEBINAR_MEET_DOMAIN e o segredo do token): o aviso discreto. */
  roomMissingNote: string | null;
  status: { label: string; tone: WebinarTone; value: RecorderStatus };
  /** Enviar gravação (a reserva de D3): a sessao existe e nao foi cancelada. */
  upload: WebinarCardLink | null;
};

const OPEN_SESSION_STATUSES: readonly SessionStatus[] = ["scheduled", "waiting", "live"];

/**
 * O card Gravacao da Live ao vivo (docs/30 §2.2, §6.4 passo 3 e §6.7): a situacao do servidor de gravacao da sessao
 * (`recorder_status`, "Não preparado" antes de publicar), Gravar automaticamente com o custo, e os dois caminhos para o
 * console: Preparar gravação (messaging.publish, como a Server Action) e Enviar gravação (messaging.write).
 */
export function webinarRecordingCard(input: {
  autoRecord: boolean;
  liveRoomReady: boolean;
  liveSession: Pick<WebinarLiveSessionSummary, "recorderStatus" | "status"> | null;
  permissions: WebinarPermissions;
  webinarId: string | null;
}): WebinarRecordingCardView {
  const { liveSession, permissions, webinarId } = input;
  const value: RecorderStatus = liveSession?.recorderStatus ?? "none";
  const base = {
    autoRecordHint: input.autoRecord ? WEBINAR_ADMIN_COPY.fields.autoRecordHint : WEBINAR_ADMIN_COPY.fields.autoRecordOffHint,
    roomMissingNote: input.liveRoomReady ? null : WEBINAR_COPY.consoleAoVivo.salaEmBreve,
    status: { label: RECORDER_LABELS[value], tone: RECORDER_TONES[value], value }
  };

  if (!liveSession || !webinarId) {
    return { ...base, pendingNote: WEBINAR_ADMIN_COPY.fields.recordingAfterPublish, prepare: null, upload: null };
  }

  const href = webinarConsoleHref(webinarId);
  const prepare: WebinarCardLink | null =
    OPEN_SESSION_STATUSES.includes(liveSession.status) && canRequestRecorder(value)
      ? { blocked: permissions.canPublish ? null : WEBINAR_ADMIN_COPY.blocked.prepare, href: permissions.canPublish ? href : null, label: WEBINAR_COPY.consoleAoVivo.prepararGravacao }
      : null;
  const upload: WebinarCardLink | null = liveSession.status !== "cancelled" && permissions.canWrite ? { blocked: null, href, label: WEBINAR_COPY.consoleAoVivo.enviarGravacao } : null;

  return { ...base, pendingNote: null, prepare, upload };
}

/** Presentes (pico) da lista (docs/30 §2.1): o maior pico das curvas congeladas no fim das sessoes; sem curva, nulo ("—"). */
export function webinarPeakPresent(sessions: readonly Pick<WebinarSession, "kind" | "presenceCurve">[]): number | null {
  let peak: number | null = null;

  for (const session of sessions) {
    const value = session.kind === "replay" ? undefined : session.presenceCurve?.peak?.n;

    if (typeof value === "number" && Number.isFinite(value) && (peak === null || value > peak)) {
      peak = value;
    }
  }

  return peak;
}

/** Limites expostos para a tela (o mesmo arquivo do servidor). */
export const WEBINAR_EDITOR_LIMITS = WEBINAR_LIMITS;
