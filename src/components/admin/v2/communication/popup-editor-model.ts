// Editor do pop-up no admin (v3b-1, docs/25 §2.2–§2.5): as pecas puras dos cards "Quando e onde aparece" e
// "Quantas vezes e como fecha". A escolha de "Onde aparece", a lista de paginas <-> padroes (nas paginas e
// nas excecoes), o que muda ao trocar o momento, o comeco de "Mais de uma vez", os tempos em minutos, horas
// ou dias e os textos dos dois cards. As regras do pop-up moram em popup-display-model.ts e as frases ao
// vivo em popup-sentences.ts; aqui so o que a tela precisa para montar os campos. Modulo puro (sem React,
// imports relativos, sem enum): tests/pop-ups-v3b1-editor.test.mjs carrega direto pelo Node. Vocabulario
// fechado da equipe (docs/17 §1.3): o teste confere os textos.

import { FIXED_PAGE_KEYS, type FixedPageKey } from "../../../../server/member-area/page-visit-model";
import {
  canonicalPatterns,
  defaultPopupSettings,
  reconcilePopupFrequency,
  type PopupClose,
  type PopupFrequency,
  type PopupSettings,
  type PopupStopOn,
  type PopupTrigger
} from "../../../../server/communications/popup-display-model";
import { popupDesignLinkButton } from "../../../../server/communications/popup-design-model";
import { freeLinkButton } from "../../../../server/communications/popup-free-render";
import { describeMinutes } from "../../../../server/communications/popup-sentences";
import type { NoticeDraft } from "../../../../server/communications/schemas";

/* ------------------------------------------------------------------------------------------------
 * Textos dos dois cards (docs/25 §2.3 e §2.4)
 * ---------------------------------------------------------------------------------------------- */

export const POPUP_EDITOR_COPY = {
  placement: {
    contentDescription: "A página com a capa e a lista de aulas.",
    delayHint: {
      lesson_completed: "Conta a partir de quando a aula fica concluída.",
      page_load: "Conta a partir de quando a página abre."
    },
    delayLabel: "Quanto tempo depois",
    delayOtherLabel: "Quantos segundos",
    delayOtherSuffix: "segundos",
    delayZeroHint: "Abre assim que a página termina de carregar (no Início, pode levar cerca de 2 segundos).",
    description: "Em que momento e em quais páginas o pop-up abre.",
    exceptionsDescription: "Ex.: em qualquer página, menos Perfil e Suporte.",
    exceptionsLabel: "Nunca mostrar em algumas páginas",
    exceptionsLegend: "Nunca nestas páginas",
    formationHint: "Uma formação vale também para os cursos dela.",
    lessonDescription: "A página com o vídeo da aula.",
    lessonExceptionsLabel: "Menos as aulas de alguns produtos",
    lessonHint:
      "Na aula, o pop-up só abre antes de o aluno dar o play: com um tempo longo em “Quanto tempo depois”, quase ninguém vê. No celular, nas aulas com vídeo do Bunny, do Vimeo ou do Mux, ele não abre ao abrir a página: para essas aulas, use “Ao concluir uma aula”.",
    lessonScopeAria: "De quais aulas",
    lessonScopeLabel: "De quais aulas",
    note: "Um pop-up de cada vez: se dois tiverem que abrir juntos, o segundo espera o primeiro fechar. Na aula, nunca com o vídeo do nosso player tocando; nos vídeos do Bunny, do Vimeo e do Mux, só antes do play (no computador) ou depois do Concluir.",
    pagesLegend: "Páginas",
    productsEmpty: "Nenhum produto ainda. Crie um em Produtos.",
    productsUnavailable: "Não foi possível carregar a lista de produtos agora. Recarregue a página para escolher um produto.",
    startsAtHint: "A partir dessa hora, quem abrir uma das páginas escolhidas vê o pop-up.",
    title: "Quando e onde aparece",
    triggerAria: "Quando o pop-up aparece",
    triggerHint: {
      lesson_completed:
        "Aparece na página da aula logo depois que a aula fica concluída: no fim do vídeo (vídeo de arquivo e YouTube) ou quando o aluno toca em Concluir. Nos vídeos do Bunny, do Vimeo e do Mux, por enquanto, só quando ele toca em Concluir. Com o vídeo de arquivo ou do YouTube ainda tocando, espera ele parar. Se o aluno já começou outra aula, o pop-up espera a próxima aula concluída.",
      page_load: "Abre pouco depois de o aluno abrir uma das páginas escolhidas."
    },
    triggerLabel: "Quando aparece",
    whereAria: "Onde o pop-up aparece",
    whereHint: {
      any: "Em todas as páginas da área do aluno, também nas aulas (só antes do play). Nunca no login nem no Modo TV.",
      home: "Na página inicial da área.",
      pages: "Marque as páginas onde ele pode aparecer."
    },
    whereLabel: "Onde aparece",
    /** Excecao gravada para todo um tipo (so por chamada direta: o editor escolhe produtos). */
    wholeKindException: { content: "Todas as páginas de produto.", lesson: "Todas as aulas." }
  },
  frequency: {
    closeAria: "Como o aluno fecha o pop-up",
    closeHint: {
      any: "O aluno fecha no X, no Esc ou clicando fora.",
      x_only: "Clicar fora não fecha. O Esc continua fechando, para quem usa teclado ou leitor de tela."
    },
    closeLabel: "Como fechar",
    description: "Para cada aluno: quantas vezes aparece, o que faz parar e como ele fecha.",
    dismissLine: "“Não mostrar de novo” sempre vale: quem escolhe não vê mais este pop-up.",
    intervalDescription: {
      lesson_completed: "Depois desse tempo, ele volta na próxima aula concluída.",
      page_load:
        "Depois desse tempo, ele volta na próxima vez que o aluno abrir uma das páginas escolhidas. Nunca abre sozinho no meio de uma página que o aluno já está vendo."
    },
    intervalField: "Tempo",
    intervalLabel: "Tempo entre uma vez e outra",
    intervalUnitAria: "Unidade do tempo",
    modeAria: "Quantas vezes o pop-up aparece",
    onceHint: "Aparece uma vez para cada aluno e para quando ele fecha, clica no botão ou escolhe “Não mostrar de novo”. Cada “Lembrar depois” vale mais uma vez.",
    perDayDescription: "Conta de meia-noite a meia-noite, no horário de Brasília.",
    perDayField: "Vezes por dia",
    perDayLabel: "Limitar por dia",
    snoozeField: "Volta em",
    snoozeLabel: "Permitir “Lembrar depois”",
    snoozeUnitAria: "Unidade do tempo do Lembrar depois",
    stopAria: "O que faz o pop-up parar de aparecer",
    stopHint: {
      click: "Quem clica no botão não vê mais. Quem só fecha volta no ritmo acima.",
      never: "Continua no ritmo acima até a data de fim, mesmo para quem clicou. Só “Não mostrar de novo” faz parar."
    },
    stopLabel: "Para de aparecer",
    stopNoButton: "Este pop-up não tem botão. Ligue “Levar o aluno a algum lugar” ou escolha outra opção.",
    /** Design Personalizado ou Livre (docs/26, docs/27): o botao mora no card Design, sem a chave "Levar o aluno a algum lugar". */
    stopNoButtonDesign: "Este pop-up não tem botão. Acrescente o Botão principal no Design ou escolha outra opção.",
    title: "Quantas vezes e como fecha",
    totalDescription: "“Lembrar depois” não gasta vez.",
    totalField: "Vezes no total",
    totalLabel: "Limite total"
  }
} as const;

/* ------------------------------------------------------------------------------------------------
 * O pop-up do rascunho
 * ---------------------------------------------------------------------------------------------- */

/**
 * A configuracao do pop-up do rascunho; sem a chave (rascunho que comecou como notificacao, rascunho antigo),
 * o padrao com "Quantas vezes" vindo de `repeat` (a regra da v1).
 */
export function popupSettingsOfDraft(draft: Pick<NoticeDraft, "popup" | "repeat">): PopupSettings {
  return draft.popup ?? { ...defaultPopupSettings(), frequency: reconcilePopupFrequency({ frequency: undefined, repeat: draft.repeat, stored: null }) };
}

/* ------------------------------------------------------------------------------------------------
 * Quando aparece
 * ---------------------------------------------------------------------------------------------- */

export const POPUP_TRIGGER_OPTIONS = [
  { label: "Ao abrir a página", value: "page_load" },
  { label: "Ao concluir uma aula", value: "lesson_completed" }
] as const satisfies readonly { label: string; value: PopupTrigger }[];

function lessonPatterns(patterns: readonly string[]) {
  return canonicalPatterns(patterns.filter((pattern) => pattern.startsWith("lesson:")));
}

/**
 * "Nunca nestas páginas" so existe com "Em qualquer página" ou com "Qualquer produto" / "Qualquer aula"
 * marcados (ao concluir uma aula: com "De qualquer produto").
 */
export function canExclude(settings: Pick<PopupSettings, "pages" | "trigger">) {
  if (settings.trigger === "lesson_completed") {
    return settings.pages.includes("lesson:*");
  }

  return settings.pages.some((pattern) => pattern === "any" || pattern === "content:*" || pattern === "lesson:*");
}

/** Sem lugar para excecoes (Só no Início, produtos escolhidos...), elas saem. */
export function tidyPopupPlacement(settings: PopupSettings): PopupSettings {
  return canExclude(settings) || settings.exclude.length === 0 ? settings : { ...settings, exclude: [] };
}

/**
 * Trocar o momento: para "Ao concluir uma aula" ficam so as aulas das paginas (nenhuma -> qualquer aula) e
 * das excecoes; de volta para "Ao abrir a página", as aulas escolhidas viram "Páginas de aula". "Quanto
 * tempo depois" nunca muda sozinho.
 */
export function settingsForTrigger(settings: PopupSettings, trigger: PopupTrigger): PopupSettings {
  if (trigger === settings.trigger) {
    return settings;
  }

  if (trigger === "lesson_completed") {
    const pages = lessonPatterns(settings.pages);

    return tidyPopupPlacement({ ...settings, exclude: lessonPatterns(settings.exclude), pages: pages.length > 0 ? pages : ["lesson:*"], trigger });
  }

  return tidyPopupPlacement({ ...settings, exclude: lessonPatterns(settings.exclude), pages: lessonPatterns(settings.pages), trigger });
}

/* ------------------------------------------------------------------------------------------------
 * Onde aparece
 * ---------------------------------------------------------------------------------------------- */

export type PopupPlacementChoice = "any" | "home" | "pages";

export const POPUP_PLACEMENT_OPTIONS = [
  { label: "Só no Início", value: "home" },
  { label: "Em qualquer página", value: "any" },
  { label: "Escolher páginas", value: "pages" }
] as const satisfies readonly { label: string; value: PopupPlacementChoice }[];

/** Como a configuracao gravada reabre: so o Inicio, qualquer pagina ou a lista. */
export function placementChoiceOf(settings: Pick<PopupSettings, "pages">): PopupPlacementChoice {
  if (settings.pages.includes("any")) {
    return "any";
  }

  return settings.pages.length === 1 && settings.pages[0] === "home" ? "home" : "pages";
}

/** As paginas de cada escolha ("Escolher páginas" vindo de qualquer pagina comeca com o Inicio marcado). */
export function settingsForPlacementChoice(settings: PopupSettings, choice: PopupPlacementChoice): PopupSettings {
  const pages = choice === "home" ? ["home"] : choice === "any" ? ["any"] : settings.pages.includes("any") ? ["home"] : [...settings.pages];

  return tidyPopupPlacement({ ...settings, pages });
}

/* ------------------------------------------------------------------------------------------------
 * Lista de paginas <-> padroes (nas paginas e nas excecoes)
 * ---------------------------------------------------------------------------------------------- */

export type PopupChecklistKind = "content" | "lesson";
/** Uma linha de produto: marcada, "Qualquer" ou "Só estes", e os produtos escolhidos. */
export type PopupChecklistLine = { checked: boolean; mode: "any" | "some"; products: string[] };
export type PopupChecklist = { content: PopupChecklistLine; fixed: FixedPageKey[]; lesson: PopupChecklistLine };
/** Linha marcada em "Só estes produtos" ainda sem produto (nao vira padrao: so o editor sabe dela). */
export type PopupChecklistPending = { content: boolean; lesson: boolean };
export type PopupChecklistList = "exclude" | "pages";

export const NO_PENDING_LINES: PopupChecklistPending = { content: false, lesson: false };
export const CHOOSE_PRODUCT_MESSAGE = "Escolha pelo menos um produto.";

/** As paginas fixas na ordem do menu (Início primeiro). */
export const POPUP_FIXED_PAGES: readonly FixedPageKey[] = FIXED_PAGE_KEYS;

const UNCHECKED_LINE: PopupChecklistLine = { checked: false, mode: "any", products: [] };

function lineOf(patterns: readonly string[], kind: PopupChecklistKind, pending: boolean): PopupChecklistLine {
  if (patterns.includes(`${kind}:*`)) {
    return { checked: true, mode: "any", products: [] };
  }

  const products = patterns.filter((pattern) => pattern.startsWith(`${kind}:`)).map((pattern) => pattern.slice(kind.length + 1));

  if (products.length > 0) {
    return { checked: true, mode: "some", products };
  }

  return pending ? { checked: true, mode: "some", products: [] } : { ...UNCHECKED_LINE, products: [] };
}

/** A lista marcada a partir dos padroes (e das linhas que esperam produto). "Qualquer página" fica fora. */
export function checklistOf(patterns: readonly string[], pending: PopupChecklistPending = NO_PENDING_LINES): PopupChecklist {
  const list = canonicalPatterns(patterns);

  return {
    content: lineOf(list, "content", pending.content),
    fixed: POPUP_FIXED_PAGES.filter((key) => list.includes(key)),
    lesson: lineOf(list, "lesson", pending.lesson)
  };
}

/** Os padroes da lista marcada, na ordem de leitura. */
export function patternsOfChecklist(checklist: PopupChecklist): string[] {
  const patterns: string[] = [...checklist.fixed];

  for (const kind of ["content", "lesson"] as const) {
    const line = checklist[kind];

    if (line.checked) {
      patterns.push(...(line.mode === "any" ? [`${kind}:*`] : line.products.map((id) => `${kind}:${id}`)));
    }
  }

  return canonicalPatterns(patterns);
}

function lineIsPending(line: PopupChecklistLine) {
  return line.checked && line.mode === "some" && line.products.length === 0;
}

export function pendingOfChecklist(checklist: PopupChecklist): PopupChecklistPending {
  return { content: lineIsPending(checklist.content), lesson: lineIsPending(checklist.lesson) };
}

/** "Escolha pelo menos um produto." quando uma linha pede produtos e nao tem nenhum (so o editor confere). */
export function checklistProblem(checklist: PopupChecklist): string | null {
  return lineIsPending(checklist.content) || lineIsPending(checklist.lesson) ? CHOOSE_PRODUCT_MESSAGE : null;
}

export function toggleChecklistPage(checklist: PopupChecklist, key: FixedPageKey, checked: boolean): PopupChecklist {
  const fixed = checked ? [...checklist.fixed, key] : checklist.fixed.filter((current) => current !== key);

  return { ...checklist, fixed: POPUP_FIXED_PAGES.filter((current) => fixed.includes(current)) };
}

/** Marcar uma linha de produto: nas paginas comeca em "Qualquer"; nas excecoes, direto no seletor. */
export function toggleChecklistLine(checklist: PopupChecklist, kind: PopupChecklistKind, checked: boolean, list: PopupChecklistList): PopupChecklist {
  const line: PopupChecklistLine = !checked
    ? { ...UNCHECKED_LINE, products: [] }
    : list === "pages"
      ? { checked: true, mode: "any", products: [] }
      : { checked: true, mode: "some", products: [] };

  return { ...checklist, [kind]: line };
}

/** "Qualquer produto" | "Só estes produtos" (e "Qualquer aula" | "Aulas destes produtos"). */
export function checklistLineMode(checklist: PopupChecklist, kind: PopupChecklistKind, mode: PopupChecklistLine["mode"]): PopupChecklist {
  return { ...checklist, [kind]: { checked: true, mode, products: mode === "some" ? [...checklist[kind].products] : [] } };
}

export function checklistLineProducts(checklist: PopupChecklist, kind: PopupChecklistKind, products: readonly string[]): PopupChecklist {
  return { ...checklist, [kind]: { checked: true, mode: "some", products: [...new Set(products)] } };
}

/* ------------------------------------------------------------------------------------------------
 * Estado da tela do card "Quando e onde aparece" (o que nao vira padrao)
 * ---------------------------------------------------------------------------------------------- */

export type PopupPlacementUi = {
  /** "Onde aparece" (a lista com so o Inicio marcado continua em "Escolher páginas"). */
  choice: PopupPlacementChoice;
  /** A chave "Nunca mostrar em algumas páginas" (ou "Menos as aulas de alguns produtos") ligada. */
  exceptions: boolean;
  pending: { exclude: PopupChecklistPending; pages: PopupChecklistPending };
};

export function placementUiOf(settings: Pick<PopupSettings, "exclude" | "pages">): PopupPlacementUi {
  return { choice: placementChoiceOf(settings), exceptions: settings.exclude.length > 0, pending: { exclude: NO_PENDING_LINES, pages: NO_PENDING_LINES } };
}

/** As excecoes saem com o lugar delas: a chave desliga e nada fica esperando produto. */
export function syncPlacementUi(ui: PopupPlacementUi, settings: PopupSettings): PopupPlacementUi {
  return canExclude(settings) || !ui.exceptions ? ui : { ...ui, exceptions: false, pending: { ...ui.pending, exclude: NO_PENDING_LINES } };
}

/**
 * Os erros que so o editor ve (antes de existir padrao): "Escolha pelo menos um produto." numa linha de
 * produto marcada sem produto, nas paginas (`popup.pages`) ou nas excecoes (`popup.exclude`). O zod confere
 * o resto, com as mesmas chaves.
 */
export function popupPlacementProblems(settings: PopupSettings, ui: PopupPlacementUi): Record<string, string> {
  const problems: Record<string, string> = {};
  const pagesShown = settings.trigger === "lesson_completed" || ui.choice === "pages";
  const pending = settings.trigger === "lesson_completed" ? { content: false, lesson: ui.pending.pages.lesson } : ui.pending.pages;

  if (pagesShown && checklistProblem(checklistOf(settings.pages, pending))) {
    problems["popup.pages"] = CHOOSE_PRODUCT_MESSAGE;
  }

  if (ui.exceptions && canExclude(settings) && checklistProblem(checklistOf(settings.exclude, ui.pending.exclude))) {
    problems["popup.exclude"] = CHOOSE_PRODUCT_MESSAGE;
  }

  return problems;
}

/* ------------------------------------------------------------------------------------------------
 * Ao concluir uma aula: de quais aulas
 * ---------------------------------------------------------------------------------------------- */

export type PopupLessonScope = "any" | "some";

export const POPUP_LESSON_SCOPE_OPTIONS = [
  { label: "De qualquer produto", value: "any" },
  { label: "Só de aulas destes produtos", value: "some" }
] as const satisfies readonly { label: string; value: PopupLessonScope }[];

export function lessonScopeOf(settings: Pick<PopupSettings, "pages">): PopupLessonScope {
  return settings.pages.includes("lesson:*") ? "any" : "some";
}

/* ------------------------------------------------------------------------------------------------
 * Quanto tempo depois
 * ---------------------------------------------------------------------------------------------- */

export type PopupDelayChoice = "0" | "3" | "10" | "30" | "60" | "other";

export const POPUP_DELAY_OPTIONS = [
  { label: "Logo", value: "0" },
  { label: "3 s", value: "3" },
  { label: "10 s", value: "10" },
  { label: "30 s", value: "30" },
  { label: "1 min", value: "60" },
  { label: "Outro", value: "other" }
] as const satisfies readonly { label: string; value: PopupDelayChoice }[];

export function delayChoiceOf(seconds: number): PopupDelayChoice {
  const choice = String(seconds);

  return choice === "0" || choice === "3" || choice === "10" || choice === "30" || choice === "60" ? choice : "other";
}

/* ------------------------------------------------------------------------------------------------
 * Quantas vezes
 * ---------------------------------------------------------------------------------------------- */

export type PopupRepeatFrequency = Extract<PopupFrequency, { mode: "repeat" }>;

export const POPUP_FREQUENCY_OPTIONS = [
  { label: "Uma vez", value: "once" },
  { label: "Mais de uma vez", value: "repeat" }
] as const satisfies readonly { label: string; value: PopupFrequency["mode"] }[];

/** O que cada chave de "Mais de uma vez" traz ao ligar pela primeira vez. */
export const POPUP_REPEAT_DEFAULTS = { everyMinutes: 1_440, maxPerDay: 1, maxTotal: 10 } as const;

/** Pop-up sem botao: "Quando o aluno clica no botão" fica desligado (nunca pararia). */
/**
 * "Quando o aluno clica no botão" sem nada para clicar nunca pararia: desligada sem `cta`, a nao ser que o design
 * Personalizado tenha um segundo botao com link (docs/26 D9: o link conta como o clique, como no schema) ou o Livre
 * tenha o botao "Abrir um link" visivel (docs/27; no maximo um, entao o clique contado e sempre de um botao so).
 */
export function clickStopDisabled(draft: Pick<NoticeDraft, "cta"> & Partial<Pick<NoticeDraft, "design" | "freeDesign">>) {
  return draft.cta === null && !popupDesignLinkButton(draft.design) && !freeLinkButton(draft.freeDesign);
}

/**
 * "Mais de uma vez" a partir de "Uma vez": 1 por dia, ate clicar (sem botao: so quando o pop-up terminar).
 * Os ultimos valores desta tela (`remembered`) voltam quando a equipe vai e volta.
 */
export function repeatStartOf(draft: Pick<NoticeDraft, "cta"> & Partial<Pick<NoticeDraft, "design" | "freeDesign">>, remembered: PopupRepeatFrequency | null = null): PopupRepeatFrequency {
  const fallbackStop: PopupStopOn = clickStopDisabled(draft) ? "never" : "click";

  if (remembered) {
    return { ...remembered, stopOn: remembered.stopOn === "click" && clickStopDisabled(draft) ? "never" : remembered.stopOn };
  }

  return { everyMinutes: null, maxPerDay: POPUP_REPEAT_DEFAULTS.maxPerDay, maxTotal: null, mode: "repeat", stopOn: fallbackStop };
}

export const POPUP_STOP_OPTIONS = [
  { label: "Quando o aluno clica no botão", value: "click" },
  { label: "Só quando o pop-up terminar", value: "never" }
] as const satisfies readonly { label: string; value: PopupStopOn }[];

export const POPUP_CLOSE_OPTIONS = [
  { label: "No X ou clicando fora", value: "any" },
  { label: "Só no X", value: "x_only" }
] as const satisfies readonly { label: string; value: PopupClose }[];

/* ------------------------------------------------------------------------------------------------
 * Tempos em minutos, horas ou dias (intervalo e "Volta em")
 * ---------------------------------------------------------------------------------------------- */

export type PopupMinuteUnit = "days" | "hours" | "minutes";

const UNIT_MINUTES: Record<PopupMinuteUnit, number> = { days: 1_440, hours: 60, minutes: 1 };

export const POPUP_MINUTE_UNIT_OPTIONS = [
  { label: "minutos", value: "minutes" },
  { label: "horas", value: "hours" },
  { label: "dias", value: "days" }
] as const satisfies readonly { label: string; value: PopupMinuteUnit }[];

/** Minutos -> [numero] [minutos | horas | dias] na maior unidade exata (1.440 = 1 dia, 120 = 2 horas, 90 = 90 minutos). */
export function minutesToParts(minutes: number): { amount: number; unit: PopupMinuteUnit } {
  if (!Number.isFinite(minutes)) {
    return { amount: Number.NaN, unit: "minutes" };
  }

  const value = Math.round(minutes);

  if (value > 0 && value % UNIT_MINUTES.days === 0) {
    return { amount: value / UNIT_MINUTES.days, unit: "days" };
  }

  if (value > 0 && value % UNIT_MINUTES.hours === 0) {
    return { amount: value / UNIT_MINUTES.hours, unit: "hours" };
  }

  return { amount: value, unit: "minutes" };
}

/** [numero] [unidade] -> minutos; numero invalido fica invalido (o zod diz os limites). */
export function partsToMinutes(amount: number, unit: PopupMinuteUnit) {
  return Number.isFinite(amount) ? Math.round(amount * UNIT_MINUTES[unit]) : Number.NaN;
}

/** Descricao de "Permitir “Lembrar depois”": "Volta em 1 dia, até 2 vezes." */
export function snoozeSwitchDescription(snoozeMinutes: number) {
  return Number.isFinite(snoozeMinutes) && snoozeMinutes > 0
    ? `Volta em ${describeMinutes(snoozeMinutes)}, até 2 vezes.`
    : "Volta no tempo de “Volta em”, até 2 vezes.";
}
