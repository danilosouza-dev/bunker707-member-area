// Editor do pop-up no admin (v3b-1, docs/25 §2.2–§2.5): as pecas puras dos cards "Quando e onde aparece" e
// "Quantas vezes e como fecha". A escolha de "Onde aparece", a lista de paginas <-> padroes (nas paginas e
// nas excecoes), o que muda ao trocar o momento, o comeco de "Mais de uma vez", os tempos em minutos, horas
// ou dias e os textos dos dois cards. As regras do pop-up moram em popup-display-model.ts e as frases ao
// vivo em popup-sentences.ts; aqui so o que a tela precisa para montar os campos. Modulo puro (sem React,
// imports relativos, sem enum): tests/pop-ups-v3b1-editor.test.mjs carrega direto pelo Node. Vocabulario
// fechado da equipe (docs/17 §1.3): o teste confere os textos.
//
// v3b-2 (docs/29 §2.1 a §2.4): quatro momentos ("No primeiro acesso" com "Conta como primeiro acesso" e os produtos;
// "Ao concluir um curso" com "De quais cursos"), textos por momento (dica, "Quanto tempo depois", "Começa"),
// a trava do primeiro acesso no pop-up que ja foi ao ar e o erro "Escolha pelo menos um produto." dos produtos
// do primeiro acesso (so o editor ve: no rascunho salvo, a lista vazia e "A primeira vez na área").

import { FIXED_PAGE_KEYS, type FixedPageKey } from "../../../../server/member-area/page-visit-model";
import {
  canonicalPatterns,
  defaultPopupSettings,
  isLessonTrigger,
  isPageTrigger,
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
    courseExceptionsLabel: "Menos os cursos de alguns produtos",
    courseFormationHint: "Numa formação, o pop-up aparece ao concluir cada curso dela.",
    courseScopeAria: "De quais cursos",
    courseScopeLabel: "De quais cursos",
    courseScopeOptions: [
      { label: "De qualquer curso", value: "any" },
      { label: "Só destes produtos", value: "some" }
    ],
    delayHint: {
      course_completed: "Conta a partir de quando o curso fica concluído.",
      first_login: "Conta a partir de quando a página abre.",
      lesson_completed: "Conta a partir de quando a aula fica concluída.",
      page_load: "Conta a partir de quando a página abre (na hora marcada, a partir dessa hora)."
    },
    delayLabel: "Quanto tempo depois",
    delayOtherLabel: "Quantos segundos",
    delayOtherSuffix: "segundos",
    delayZeroHint: "Abre assim que a página termina de carregar (no Início, pode levar cerca de 2 segundos).",
    description: "Em que momento e em quais páginas o pop-up abre.",
    exceptionsDescription: "Ex.: em qualquer página, menos Perfil e Suporte.",
    exceptionsLabel: "Nunca mostrar em algumas páginas",
    exceptionsLegend: "Nunca nestas páginas",
    firstAccessAria: "Conta como primeiro acesso",
    firstAccessDelayNote: "Para quem acabou de comprar, pode levar até 15 minutos para valer: nesse caso, ele aparece na página seguinte que o aluno abrir.",
    firstAccessHint: {
      area: "Vale para quem ganhou a conta depois que o pop-up começou e para quem ainda não tinha entrado nenhuma vez. Quem já usava a área não vê.",
      products:
        "Vale para quem ganhou acesso a um destes produtos depois que o pop-up começou, mesmo que já usasse a área, e para quem tem acesso a um deles mas ainda não tinha entrado. Quem perde o acesso deixa de ver. Para um curso de uma formação, escolha a formação (o acesso vem por ela)."
    },
    firstAccessLabel: "Conta como primeiro acesso",
    firstAccessLocked: "Num pop-up que já foi ao ar, “No primeiro acesso” não troca com os outros momentos. Para isso, duplique o pop-up.",
    firstAccessOptions: [
      { label: "A primeira vez na área", value: "area" },
      { label: "A primeira vez com estes produtos", value: "products" }
    ],
    formationHint: "Uma formação vale também para os cursos dela.",
    lessonDescription: "A página com o vídeo da aula.",
    lessonExceptionsLabel: "Menos as aulas de alguns produtos",
    lessonHint:
      "Na aula, se o vídeo estiver tocando, o pop-up espera ele parar. Se o aluno assistir mais de 10 minutos sem parar, ele não aparece nessa visita. Em vídeo colado de outro site, ele só abre antes do play (no celular, não abre nessas aulas). No iPhone, nas aulas com vídeo do Bunny, ele às vezes não abre: ali o vídeo só responde à página depois do play.",
    lessonScopeAria: "De quais aulas",
    lessonScopeLabel: "De quais aulas",
    note: "Um pop-up de cada vez: se dois tiverem que abrir juntos, o segundo espera o primeiro fechar. Na aula, nunca com o vídeo tocando: ele espera o vídeo parar. Quando a página não consegue saber se o vídeo toca (vídeo colado de outro site e, no iPhone, às vezes o do Bunny), ele só abre antes do play, e no celular não abre.",
    pagesLegend: "Páginas",
    productsEmpty: "Nenhum produto ainda. Crie um em Produtos.",
    productsUnavailable: "Não foi possível carregar a lista de produtos agora. Recarregue a página para escolher um produto.",
    startsAtHint: {
      course_completed: "A partir dessa hora, quem concluir um curso vê o pop-up. Nada abre sozinho na hora marcada.",
      first_login:
        "A partir dessa hora, quem abrir uma das páginas escolhidas vê o pop-up, e quem já estiver numa delas vê na hora (com alguns segundos de diferença entre os alunos).",
      lesson_completed: "A partir dessa hora, quem concluir uma aula vê o pop-up. Nada abre sozinho na hora marcada.",
      page_load:
        "A partir dessa hora, quem abrir uma das páginas escolhidas vê o pop-up, e quem já estiver numa delas vê na hora (com alguns segundos de diferença entre os alunos)."
    },
    /** Com "Começa" no futuro, nos momentos de pagina (a hora marcada ao vivo). */
    startsAtLiveNote:
      "Para um aviso de hora curta, marque também “Termina”: quem voltar para a aba depois disso não vê. Publique com antecedência: quem já estava com a área aberta antes de você publicar só vê ao abrir outra página ou voltar para a aba.",
    title: "Quando e onde aparece",
    triggerAria: "Quando o pop-up aparece",
    triggerHint: {
      course_completed:
        "Aparece na página da aula logo depois que o aluno conclui a última aula que faltava do curso (todas as aulas publicadas). Com o vídeo ainda tocando, espera ele parar.",
      first_login: "Aparece só para aluno novo (ou para quem acabou de ganhar acesso aos produtos escolhidos), na primeira página escolhida que ele abrir.",
      lesson_completed:
        "Aparece na página da aula logo depois que a aula fica concluída: no fim do vídeo ou quando o aluno toca em Concluir. Com o vídeo ainda tocando, espera ele parar. Se o aluno já começou outra aula, o pop-up espera a próxima aula concluída. Em vídeo colado de outro site, só quando o aluno toca em Concluir.",
      page_load:
        "Abre pouco depois de o aluno abrir uma das páginas escolhidas. Com “Começa: Em uma data”, também abre na hora marcada para quem já estiver numa dessas páginas."
    },
    triggerLabel: "Quando aparece",
    whereAria: "Onde o pop-up aparece",
    whereHint: {
      any: "Em todas as páginas da área do aluno, também nas aulas (com o vídeo parado). Nunca no login nem no Modo TV.",
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
      course_completed: "Depois desse tempo, ele volta no próximo curso concluído.",
      first_login:
        "Depois desse tempo, ele volta na próxima vez que o aluno abrir uma das páginas escolhidas. Nunca abre sozinho no meio de uma página que o aluno já está vendo.",
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
  { label: "Ao concluir uma aula", value: "lesson_completed" },
  { label: "No primeiro acesso", value: "first_login" },
  { label: "Ao concluir um curso", value: "course_completed" }
] as const satisfies readonly { label: string; value: PopupTrigger }[];

function lessonPatterns(patterns: readonly string[]) {
  return canonicalPatterns(patterns.filter((pattern) => pattern.startsWith("lesson:")));
}

/**
 * "Nunca nestas páginas" so existe com "Em qualquer página" ou com "Qualquer produto" / "Qualquer aula"
 * marcados (ao concluir uma aula ou um curso: com "De qualquer produto" / "De qualquer curso").
 */
export function canExclude(settings: Pick<PopupSettings, "pages" | "trigger">) {
  if (isLessonTrigger(settings.trigger)) {
    return settings.pages.includes("lesson:*");
  }

  return settings.pages.some((pattern) => pattern === "any" || pattern === "content:*" || pattern === "lesson:*");
}

/** Sem lugar para excecoes (Só no Início, produtos escolhidos...), elas saem. */
export function tidyPopupPlacement(settings: PopupSettings): PopupSettings {
  return canExclude(settings) || settings.exclude.length === 0 ? settings : { ...settings, exclude: [] };
}

/** A configuracao sem os produtos do primeiro acesso (a chave so existe em "No primeiro acesso"). */
function withoutAccessProducts(settings: PopupSettings): PopupSettings {
  const copy = { ...settings };
  delete copy.accessProducts;

  return copy;
}

/**
 * Trocar o momento: para um momento de conclusao ("Ao concluir uma aula", "Ao concluir um curso") ficam so as
 * aulas das paginas (nenhuma -> qualquer aula) e das excecoes; de volta para um momento de pagina ("Ao abrir a
 * página", "No primeiro acesso"), as aulas escolhidas viram "Páginas de aula". Entre dois momentos de pagina
 * (ou dois de conclusao) as paginas ficam. Os produtos do primeiro acesso so existem em "No primeiro acesso"
 * (sair apaga; entrar comeca em [], "A primeira vez na área"). "Quanto tempo depois" nunca muda sozinho.
 */
export function settingsForTrigger(settings: PopupSettings, trigger: PopupTrigger): PopupSettings {
  if (trigger === settings.trigger) {
    return settings;
  }

  const base: PopupSettings = trigger === "first_login" ? { ...withoutAccessProducts(settings), accessProducts: [], trigger } : { ...withoutAccessProducts(settings), trigger };

  if (isLessonTrigger(trigger) === isLessonTrigger(settings.trigger)) {
    return tidyPopupPlacement(base);
  }

  if (isLessonTrigger(trigger)) {
    const pages = lessonPatterns(settings.pages);

    return tidyPopupPlacement({ ...base, exclude: lessonPatterns(settings.exclude), pages: pages.length > 0 ? pages : ["lesson:*"] });
  }

  return tidyPopupPlacement({ ...base, exclude: lessonPatterns(settings.exclude), pages: lessonPatterns(settings.pages) });
}

/**
 * Trava do primeiro acesso (docs/29 D8): num pop-up que ja foi ao ar (`sentAt` nao nulo), "No primeiro acesso"
 * nao troca com os outros momentos. Devolve as pilulas desabilitadas: as outras tres quando o salvo e "No
 * primeiro acesso"; senao, so ela. Nada no rascunho que nunca foi ao ar. O servidor recusa do mesmo jeito.
 */
export function lockedTriggersOf(input: { savedTrigger: PopupTrigger | null | undefined; sentAt: string | null | undefined }): PopupTrigger[] {
  if (!input.sentAt || !input.savedTrigger) {
    return [];
  }

  return input.savedTrigger === "first_login"
    ? POPUP_TRIGGER_OPTIONS.map((option) => option.value).filter((value) => value !== "first_login")
    : ["first_login"];
}

/** Ids escolhidos que nao estao mais na lista de produtos (o chip "Produto removido", que da para tirar). */
export function removedProductIds(selected: readonly string[], products: readonly { id: string }[]): string[] {
  const known = new Set(products.map((product) => product.id));

  return selected.filter((id) => !known.has(id));
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

/** "Conta como primeiro acesso": a primeira vez na area ([] produtos) ou com os produtos escolhidos. */
export type PopupFirstAccessChoice = "area" | "products";

export type PopupPlacementUi = {
  /** "Onde aparece" (a lista com so o Inicio marcado continua em "Escolher páginas"). */
  choice: PopupPlacementChoice;
  /** A chave "Nunca mostrar em algumas páginas" (ou "Menos as aulas de alguns produtos") ligada. */
  exceptions: boolean;
  /**
   * v3b-2: "Conta como primeiro acesso" (so em "No primeiro acesso"). "products" com a lista vazia e so da
   * tela: salvar pede "Escolha pelo menos um produto." (popupPlacementProblems).
   */
  firstAccess: PopupFirstAccessChoice;
  pending: { exclude: PopupChecklistPending; pages: PopupChecklistPending };
};

export function placementUiOf(settings: Pick<PopupSettings, "accessProducts" | "exclude" | "pages">): PopupPlacementUi {
  return {
    choice: placementChoiceOf(settings),
    exceptions: settings.exclude.length > 0,
    firstAccess: (settings.accessProducts ?? []).length > 0 ? "products" : "area",
    pending: { exclude: NO_PENDING_LINES, pages: NO_PENDING_LINES }
  };
}

/** As excecoes saem com o lugar delas: a chave desliga e nada fica esperando produto. */
export function syncPlacementUi(ui: PopupPlacementUi, settings: PopupSettings): PopupPlacementUi {
  return canExclude(settings) || !ui.exceptions ? ui : { ...ui, exceptions: false, pending: { ...ui.pending, exclude: NO_PENDING_LINES } };
}

/**
 * Os erros que so o editor ve (antes de existir padrao): "Escolha pelo menos um produto." numa linha de
 * produto marcada sem produto, nas paginas (`popup.pages`) ou nas excecoes (`popup.exclude`), e em "A
 * primeira vez com estes produtos" sem produto (`popup.accessProducts`). O zod confere o resto, com as mesmas
 * chaves.
 */
export function popupPlacementProblems(settings: PopupSettings, ui: PopupPlacementUi): Record<string, string> {
  const problems: Record<string, string> = {};
  const lesson = isLessonTrigger(settings.trigger);
  const pagesShown = lesson || ui.choice === "pages";
  const pending = lesson ? { content: false, lesson: ui.pending.pages.lesson } : ui.pending.pages;

  if (pagesShown && checklistProblem(checklistOf(settings.pages, pending))) {
    problems["popup.pages"] = CHOOSE_PRODUCT_MESSAGE;
  }

  if (ui.exceptions && canExclude(settings) && checklistProblem(checklistOf(settings.exclude, ui.pending.exclude))) {
    problems["popup.exclude"] = CHOOSE_PRODUCT_MESSAGE;
  }

  if (settings.trigger === "first_login" && ui.firstAccess === "products" && (settings.accessProducts ?? []).length === 0) {
    problems["popup.accessProducts"] = CHOOSE_PRODUCT_MESSAGE;
  }

  return problems;
}

/** "Começa" no futuro num momento de pagina: a linha da hora marcada ao vivo (startsAtLiveNote). */
export function showsStartsAtLiveNote(input: { now: number; startsAt: string | null; trigger: PopupTrigger }) {
  const startsAt = input.startsAt === null ? Number.NaN : Date.parse(input.startsAt);

  return isPageTrigger(input.trigger) && Number.isFinite(startsAt) && startsAt > input.now;
}

/* ------------------------------------------------------------------------------------------------
 * Ao concluir uma aula (ou um curso): de quais aulas (ou cursos)
 * ---------------------------------------------------------------------------------------------- */

export type PopupLessonScope = "any" | "some";

export const POPUP_LESSON_SCOPE_OPTIONS = [
  { label: "De qualquer produto", value: "any" },
  { label: "Só de aulas destes produtos", value: "some" }
] as const satisfies readonly { label: string; value: PopupLessonScope }[];

/** "De quais aulas" e "De quais cursos": qualquer (lesson:*) ou so de alguns produtos (lesson:<id>). */
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
