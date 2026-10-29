// Modelo de tela do admin dos Webinarios (docs/30 §2): enderecos e filtros da lista, situacoes e botoes
// (§2.3), os cards do editor (§2.2), o mapa dos erros do zod para os campos, a previa do card do aluno e as
// conferencias de tela que o schema nao cobre. Modulo puro (sem React, sem "server-only", imports relativos):
// tests/webinarios-admin-modelo.test.mjs e tests/webinarios-frases.test.mjs carregam direto pelo Node.
// Todas as frases do admin que nao estao em src/lib/webinar-copy.ts ficam em WEBINAR_ADMIN_COPY, abaixo,
// e passam pela mesma guarda (PROIBIDAS_WEBINARIO).

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { countdownLabel, formatWebinarWhen, saoPauloTime } from "../../lib/webinar-time";
import { formatSaoPauloDateTime, saoPauloLocalToIso } from "../communications/campaign-model";
import {
  WEBINAR_LIMITS,
  WEBINAR_SITUATIONS,
  emptyWebinarDraft,
  type AccessMode,
  type WebinarDraft,
  type WebinarKind,
  type WebinarSituation
} from "./model";
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
    gravacao: { description: "Só na Live ao vivo: o servidor de gravação é criado antes da live e apagado no fim.", title: "Gravação" },
    qualidade: { description: "Cada aluno recebe o tamanho que cabe na tela dele; em 4G cai sozinho para 720p ou 360p.", title: "Qualidade" },
    quemPode: { description: "Quem não passa por aqui não vê o webinário em lugar nenhum.", title: "Quem pode" },
    replayAula: { description: "O replay vira uma aula com vídeo da Bunny; o chat da live fica na página do webinário.", title: "Publicar replay como aula" },
    revisao: { description: "", title: "Revisão" },
    sala: { description: "Controles padrão ao começar; a sessão copia ao abrir.", title: "Sala" },
    sessoes: { description: "Cada sessão tem a própria Simulação e o próprio relatório.", title: "Sessões" },
    vagaLembretes: { description: "O e-mail sai pela fila com os outros e-mails da área (Resend).", title: "Vaga e lembretes" }
  },
  fields: {
    accessModes: {
      audience: "Segmento",
      either: "Produto ou segmento",
      everyone: "Todos",
      product: "Quem tem o produto"
    },
    accessSegmentHint: "Quem entrar no segmento agora vê o webinário em até 15 min.",
    accessCapacityHint: "Só quem garantir vaga entra.",
    afterAbsent: "E-mail para quem não veio",
    afterAttended: "E-mail para quem veio",
    afterLive: "Depois da live",
    allowStudentCamera: "Câmeras dos alunos",
    allowStudentCameraHint: "Entram desligadas e o aluno liga se quiser. A câmera do aluno sai em 360p e o apresentador fecha quando quiser.",
    anonymousQuestions: "Perguntas anônimas permitidas",
    autoRecord: "Gravar automaticamente",
    autoRecordHint: "Um servidor de gravação é criado antes da live e apagado no fim, cobrado por hora (uma live de 2 h gravada em 1080p custa cerca de EUR 0,30).",
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
    lateJoinHint: "Até o fim ou até um número de minutos depois do começo.",
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
    qualityStageHint1080: "Com 1080p no palco, cada aluno recebe cerca de 5 a 8 Mbit/s.",
    qualityFixed: ["Miniaturas: até 360p (180p na fileira pequena, automático).", "Câmera dos alunos: até 360p.", "Gravação: 1080p."],
    questions: "Perguntas",
    reactions: "Reações",
    recordingSoon: "Enviar arquivo",
    recordingStatus: "Situação do servidor de gravação",
    recordingStatusNone: "Não preparado",
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
    replayLessonModuleHint: "O identificador do módulo do produto (a lista de módulos chega com a fase 3).",
    replayLessonTitle: "Título da aula",
    roomNameSoon: "A sala nasce ao publicar (fase 3).",
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
    shortcutHint: "Ctrl+Enter (⌘+Enter no Mac) salva o rascunho.",
    working: { publish: "Publicando…", save: "Salvando…" }
  },
  toasts: {
    cancelled: "Live cancelada. Quem tinha vaga recebe o aviso pelo sino e por e-mail.",
    deleted: "Rascunho excluído.",
    duplicated: "Cópia criada como rascunho.",
    nothingToSave: "Nenhuma mudança para salvar.",
    published: "Webinário publicado. O card entra na página inicial e os lembretes passam a valer.",
    rescheduled: "Hora marcada atualizada. Quem tinha vaga recebe o aviso.",
    saved: "Rascunho salvo.",
    savedPublished: "Webinário atualizado."
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
    eitherNeedsAudience: "Monte o segmento ou escolha só o produto.",
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
    open: "Abrir",
    openConsole: WEBINAR_COPY.admin.abrirConsole,
    openRoom: WEBINAR_COPY.admin.abrirSala,
    publish: WEBINAR_COPY.admin.publicar,
    publishReplay: "Publicar replay",
    save: WEBINAR_COPY.admin.salvar,
    viewReport: WEBINAR_COPY.admin.verRelatorio
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

/** Acoes que chegam em outra fase: aparecem desligadas com "em breve" (docs/30 §2.8), nunca somem em silencio. */
export const WEBINAR_SOON_ACTIONS: readonly WebinarAction[] = ["open_room", "open_console", "end", "view_report", "publish_replay"];

const PUBLISH_ACTIONS: readonly WebinarAction[] = ["publish", "cancel", "delete", "end"];

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
 * O que a pessoa pode fazer com o webinario nesta situacao (o servidor confere de novo): os botoes do topo de
 * §2.3 mais Abrir e Duplicar, que o menu "…" da lista oferece em qualquer situacao (§2.1).
 */
export function webinarActionsFor(situation: WebinarSituation, permissions: WebinarPermissions): WebinarAction[] {
  if (!permissions.canWrite) {
    return [];
  }

  const actions: WebinarAction[] = ["open", ...WEBINAR_HEADER_ACTIONS[situation]];

  if (!actions.includes("duplicate")) {
    actions.push("duplicate");
  }

  return actions.filter((action) => permissions.canPublish || !PUBLISH_ACTIONS.includes(action));
}

export type WebinarMenuEntry = { action: WebinarAction; destructive: boolean; label: string; separated: boolean; soon: boolean };

const MENU_ORDER: readonly WebinarAction[] = ["open", "open_room", "open_console", "view_report", "publish_replay", "duplicate", "cancel", "end", "delete"];
const DESTRUCTIVE_ACTIONS = new Set<WebinarAction>(["cancel", "delete", "end"]);

/**
 * Itens do menu "…" (docs/30 §2.1: Abrir, Duplicar, Cancelar, Excluir só rascunho). Salvar e Publicar ficam na
 * Revisao do editor; `exclude` tira o que a tela ja mostra como botao.
 */
export function webinarMenuEntries(situation: WebinarSituation, permissions: WebinarPermissions, exclude: readonly WebinarAction[] = []): WebinarMenuEntry[] {
  const available = new Set(webinarActionsFor(situation, permissions).filter((action) => action !== "save" && action !== "publish" && !exclude.includes(action)));
  const ordered = MENU_ORDER.filter((action) => available.has(action));

  return ordered.map((action, index) => ({
    action,
    destructive: DESTRUCTIVE_ACTIONS.has(action),
    label: WEBINAR_ACTION_LABELS[action],
    separated: index > 0 && DESTRUCTIVE_ACTIONS.has(action) && !DESTRUCTIVE_ACTIONS.has(ordered[index - 1]),
    soon: WEBINAR_SOON_ACTIONS.includes(action)
  }));
}

export function webinarActionNeedsConfirm(action: WebinarAction) {
  return action === "cancel" || action === "delete";
}

export type WebinarConfirmCopy = { confirmLabel: string; description: string; destructive: boolean; title: string };

export function webinarActionConfirm(action: "cancel" | "delete", target: { registeredCount: number; title: string }): WebinarConfirmCopy {
  if (action === "cancel") {
    return {
      confirmLabel: WEBINAR_ADMIN_COPY.confirm.cancel.confirmLabel,
      description: WEBINAR_ADMIN_COPY.confirm.cancel.description(target.registeredCount),
      destructive: true,
      title: WEBINAR_ADMIN_COPY.confirm.cancel.title(target.title.trim() || WEBINAR_ADMIN_COPY.preview.titlePlaceholder)
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

export const WEBINAR_EDITOR_CARDS = ["dados", "sessoes", "quemPode", "vagaLembretes", "avisar", "sala", "qualidade", "gravacao", "replayAula", "revisao"] as const;
export type WebinarEditorCard = (typeof WEBINAR_EDITOR_CARDS)[number];

/** Os cards na ordem, por tipo: Sessoes so na Live gravada, Gravacao so na Live ao vivo. */
export function webinarEditorCards(kind: WebinarKind): WebinarEditorCard[] {
  return WEBINAR_EDITOR_CARDS.filter((card) => (card === "sessoes" ? kind === "simulated" : card === "gravacao" ? kind === "live" : true));
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
    productId: draft.accessMode === "product" || draft.accessMode === "either" ? draft.productId : null,
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
    sessions: draft.kind === "simulated" ? draft.sessions.map((session) => ({ scheduledAt: session.scheduledAt })) : [],
    title: draft.title.trim()
  };
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
    sessions: source.sessions.map((session) => ({ scheduledAt: session.scheduledAt })),
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
    : { ...draft, kind, scheduledAt: null, sessions: draft.scheduledAt ? [{ scheduledAt: draft.scheduledAt }] : draft.sessions };
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
  { label: WEBINAR_ADMIN_COPY.fields.accessModes.either, value: "either" }
];

export function accessUsesProduct(mode: AccessMode) {
  return mode === "product" || mode === "either";
}

export function accessUsesAudience(mode: AccessMode) {
  return mode === "audience" || mode === "either";
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
    default:
      who = "todos os alunos";
  }

  if (draft.registrationRequired && draft.capacity) {
    return `${who}, até ${draft.capacity} ${draft.capacity === 1 ? "vaga" : "vagas"}`;
  }

  return who;
}

/** A frase da Revisao: o que falta para publicar ou o resumo do que vai ao ar. */
export function webinarReviewSentence(input: {
  draft: WebinarDraft;
  now: number;
  productName: string | null;
  registeredCount: number | null;
  situation: WebinarSituation | null;
}): string {
  const { draft } = input;
  const problems = publishProblems(draft, input.now);

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

  return `${webinarKindLabel(draft.kind)} em ${when}${sessions}, ${draft.durationMinutes} min, para ${access}${registration}.${home}${registered}`;
}

/** Limites expostos para a tela (o mesmo arquivo do servidor). */
export const WEBINAR_EDITOR_LIMITS = WEBINAR_LIMITS;
