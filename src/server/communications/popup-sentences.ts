// Frases da equipe sobre onde, quando e quantas vezes cada pop-up aparece (v3b-1, docs/25 §2.3, §2.4, §2.7,
// §2.8 e §2.9): as frases ao vivo dos cards do editor, as partes da frase de revisao, a segunda linha da
// lista, as linhas de "Detalhes" do relatorio, os avisos de "Quantas vezes" e a legenda da previa. Nada
// aqui chega ao aluno. Modulo puro: sem "server-only", imports relativos; o editor, a lista, o relatorio e
// tests/pop-ups-v3b1-frases.test.mjs usam as mesmas funcoes. Vocabulario fechado da equipe (docs/17 §1.3):
// o teste confere as frases.
//
// v3b-2 (docs/29 §6.3): cada frase com ramo por momento ganha "No primeiro acesso" (como "Ao abrir a página",
// com quem conta como aluno novo: a area ou os produtos escolhidos) e "Ao concluir um curso" (como "Ao
// concluir uma aula", com os cursos). Os ramos sao um registro por momento (MOMENT_WORDS), para o curso nunca
// cair no texto da pagina nem no da aula; tests/pop-ups-v3b2-frases.test.mjs confere cada frase.

import {
  canonicalPatterns,
  isDefaultPlacement,
  isLessonTrigger,
  pagePatternMatches,
  type PopupClose,
  type PopupFrequency,
  type PopupPageKind,
  type PopupSettings,
  type PopupTrigger
} from "./popup-display-model";

/** id do produto -> nome */
export type PopupNames = Readonly<Record<string, string>>;

export const POPUP_PAGE_KIND_LABELS: Record<PopupPageKind, string> = {
  content: "Página do produto",
  continue: "Continue assistindo",
  home: "Início",
  journey: "Minha jornada",
  lesson: "Páginas de aula",
  materials: "Materiais",
  profile: "Perfil",
  purchases: "Minhas compras",
  saved: "Favoritos",
  support: "Suporte"
};

/** Uma pagina sozinha na frase ("Aparece no Início"). */
const PAGE_PHRASES: Readonly<Record<string, string>> = {
  any: "em qualquer página",
  "content:*": "na página de qualquer produto",
  continue: "em Continue assistindo",
  home: "no Início",
  journey: "em Minha jornada",
  "lesson:*": "em qualquer aula",
  materials: "em Materiais",
  profile: "no Perfil",
  purchases: "em Minhas compras",
  saved: "em Favoritos",
  support: "no Suporte"
};

/** Uma pagina depois de "menos" (", menos Perfil e Suporte"). */
const EXCEPTION_LABELS: Readonly<Record<string, string>> = {
  "content:*": "páginas de produto",
  continue: "Continue assistindo",
  home: "Início",
  journey: "Minha jornada",
  "lesson:*": "aulas",
  materials: "Materiais",
  profile: "Perfil",
  purchases: "Minhas compras",
  saved: "Favoritos",
  support: "Suporte"
};

/**
 * As palavras de cada momento nas frases de "Quantas vezes": toda vez que... (revisao e aviso), toda vez
 * que... (frase ao vivo), quando volta depois do intervalo e como as vezes do dia podem vir seguidas.
 */
const MOMENT_WORDS: Record<PopupTrigger, { every: string; everyLive: string; everyNote: string; inARow: string; nextAfter: string }> = {
  course_completed: {
    every: "toda vez que o aluno concluir um curso",
    everyLive: "toda vez que concluir um curso",
    everyNote: "toda vez que o aluno concluir um curso",
    inARow: "uma a cada curso concluído",
    nextAfter: "no próximo curso concluído depois desse tempo"
  },
  first_login: {
    every: "toda vez que o aluno abrir uma das páginas",
    everyLive: "toda vez que abrir uma das páginas",
    everyNote: "toda vez que o aluno abrir uma das páginas escolhidas",
    inARow: "uma em cada página que o aluno abrir",
    nextAfter: "na próxima página que abrir depois desse tempo"
  },
  lesson_completed: {
    every: "toda vez que o aluno concluir uma aula",
    everyLive: "toda vez que concluir uma aula",
    everyNote: "toda vez que o aluno concluir uma aula",
    inARow: "uma a cada aula concluída",
    nextAfter: "na próxima aula concluída depois desse tempo"
  },
  page_load: {
    every: "toda vez que o aluno abrir uma das páginas",
    everyLive: "toda vez que abrir uma das páginas",
    everyNote: "toda vez que o aluno abrir uma das páginas escolhidas",
    inARow: "uma em cada página que o aluno abrir",
    nextAfter: "na próxima página que abrir depois desse tempo"
  }
};

const NUMBER = new Intl.NumberFormat("pt-BR");

function count(value: number) {
  return NUMBER.format(value);
}

function capitalize(text: string) {
  return text ? `${text.charAt(0).toLocaleUpperCase("pt-BR")}${text.slice(1)}` : text;
}

/** "a", "a e b", "a, b e c". */
function joinPhrases(phrases: readonly string[]) {
  if (phrases.length <= 1) {
    return phrases[0] ?? "";
  }

  return `${phrases.slice(0, -1).join(", ")} e ${phrases[phrases.length - 1]}`;
}

function nameOf(id: string, names: PopupNames) {
  const name = names[id];

  return typeof name === "string" && name.trim() ? name.trim() : null;
}

/** Ids dos produtos de um tipo (content | lesson), sem o curinga. */
function productIdsOf(patterns: readonly string[], kind: "content" | "lesson") {
  return patterns.filter((pattern) => pattern.startsWith(`${kind}:`) && pattern !== `${kind}:*`).map((pattern) => pattern.slice(kind.length + 1));
}

/** "1 minuto", "90 minutos", "2 horas", "1 dia", "1.501 minutos" (sempre a maior unidade exata). */
export function describeMinutes(minutes: number): string {
  const value = Math.max(0, Math.round(minutes));

  if (value >= 60 && value % 1_440 === 0) {
    const days = value / 1_440;

    return days === 1 ? "1 dia" : `${count(days)} dias`;
  }

  if (value >= 60 && value % 60 === 0) {
    const hours = value / 60;

    return hours === 1 ? "1 hora" : `${count(hours)} horas`;
  }

  return value === 1 ? "1 minuto" : `${count(value)} minutos`;
}

function seconds(value: number) {
  if (value > 0 && value % 60 === 0) {
    const minutes = value / 60;

    return minutes === 1 ? "1 minuto" : `${count(minutes)} minutos`;
  }

  return value === 1 ? "1 segundo" : `${count(value)} segundos`;
}

/* ------------------------------------------------------------------------------------------------
 * Onde
 * ---------------------------------------------------------------------------------------------- */

/** "em qualquer página", "no Início e nas aulas de Formação IA", "em 5 páginas escolhidas". */
export function describePopupPages(patterns: readonly string[], names: PopupNames): string {
  const list = canonicalPatterns(patterns);

  if (list.includes("any")) {
    return PAGE_PHRASES.any;
  }

  const phrases = list.filter((pattern) => !pattern.includes(":")).map((pattern) => PAGE_PHRASES[pattern] ?? pattern);
  const products = productIdsOf(list, "content");
  const lessons = productIdsOf(list, "lesson");

  if (list.includes("content:*")) {
    phrases.push(PAGE_PHRASES["content:*"]);
  } else if (products.length === 1) {
    phrases.push(`na página de ${nameOf(products[0], names) ?? "um produto"}`);
  } else if (products.length > 1) {
    phrases.push(`na página de ${count(products.length)} produtos`);
  }

  if (list.includes("lesson:*")) {
    phrases.push(PAGE_PHRASES["lesson:*"]);
  } else if (lessons.length === 1) {
    phrases.push(`nas aulas de ${nameOf(lessons[0], names) ?? "um produto"}`);
  } else if (lessons.length > 1) {
    phrases.push(`nas aulas de ${count(lessons.length)} produtos`);
  }

  return phrases.length > 3 ? `em ${count(list.length)} páginas escolhidas` : joinPhrases(phrases);
}

function exceptionLabel(pattern: string, names: PopupNames) {
  if (EXCEPTION_LABELS[pattern]) {
    return EXCEPTION_LABELS[pattern];
  }

  if (pattern.startsWith("content:")) {
    return `a página de ${nameOf(pattern.slice(8), names) ?? "um produto"}`;
  }

  return pattern.startsWith("lesson:") ? `as aulas de ${nameOf(pattern.slice(7), names) ?? "um produto"}` : pattern;
}

/** "", ", menos Perfil", ", menos Perfil e Suporte", ", menos 3 páginas". */
export function describePopupExceptions(patterns: readonly string[], names: PopupNames): string {
  const list = canonicalPatterns(patterns).filter((pattern) => pattern !== "any");

  if (list.length === 0) {
    return "";
  }

  return list.length > 2 ? `, menos ${count(list.length)} páginas` : `, menos ${joinPhrases(list.map((pattern) => exceptionLabel(pattern, names)))}`;
}

/** Ao concluir uma aula: "ao concluir uma aula", "... de Formação IA", "... de 2 produtos". */
function lessonMomentPhrase(patterns: readonly string[], names: PopupNames) {
  const list = canonicalPatterns(patterns);
  const lessons = productIdsOf(list, "lesson");

  if (list.includes("any") || list.includes("lesson:*") || lessons.length === 0) {
    return "ao concluir uma aula";
  }

  return lessons.length === 1 ? `ao concluir uma aula de ${nameOf(lessons[0], names) ?? "um produto"}` : `ao concluir uma aula de ${count(lessons.length)} produtos`;
}

/** Ao concluir uma aula: "", ", menos as aulas de Curso X", ", menos as aulas de 2 produtos". */
function lessonExceptionPhrase(patterns: readonly string[], names: PopupNames) {
  const lessons = productIdsOf(canonicalPatterns(patterns), "lesson");

  if (lessons.length === 0) {
    return "";
  }

  return lessons.length === 1 ? `, menos as aulas de ${nameOf(lessons[0], names) ?? "um produto"}` : `, menos as aulas de ${count(lessons.length)} produtos`;
}

/** Ao concluir um curso: "ao concluir um curso", "... de Formação IA", "... de 2 produtos". */
function courseMomentPhrase(patterns: readonly string[], names: PopupNames) {
  const list = canonicalPatterns(patterns);
  const lessons = productIdsOf(list, "lesson");

  if (list.includes("any") || list.includes("lesson:*") || lessons.length === 0) {
    return "ao concluir um curso";
  }

  return lessons.length === 1 ? `ao concluir um curso de ${nameOf(lessons[0], names) ?? "um produto"}` : `ao concluir um curso de ${count(lessons.length)} produtos`;
}

/** Ao concluir um curso: "", ", menos os cursos de Curso X", ", menos os cursos de 2 produtos". */
function courseExceptionPhrase(patterns: readonly string[], names: PopupNames) {
  const lessons = productIdsOf(canonicalPatterns(patterns), "lesson");

  if (lessons.length === 0) {
    return "";
  }

  return lessons.length === 1 ? `, menos os cursos de ${nameOf(lessons[0], names) ?? "um produto"}` : `, menos os cursos de ${count(lessons.length)} produtos`;
}

/** No primeiro acesso, os produtos: "Formação IA", "2 produtos" (produto sem nome: "um produto"). */
function accessProductsPhrase(ids: readonly string[], names: PopupNames) {
  return ids.length === 1 ? (nameOf(ids[0], names) ?? "um produto") : `${count(ids.length)} produtos`;
}

/** Os produtos do "No primeiro acesso" (so nesse momento; vazio = a primeira vez na area). */
function accessProductsOf(settings: PopupSettings) {
  return settings.trigger === "first_login" ? [...new Set(settings.accessProducts ?? [])] : [];
}

/** A frase ao vivo do card "Quando e onde aparece": "Aparece em qualquer página, menos Perfil." */
export function describePopupPlacement(settings: PopupSettings, names: PopupNames): string {
  switch (settings.trigger) {
    case "lesson_completed":
      return `Aparece ${lessonMomentPhrase(settings.pages, names)}${lessonExceptionPhrase(settings.exclude, names)}.`;
    case "course_completed":
      return `Aparece ${courseMomentPhrase(settings.pages, names)}${courseExceptionPhrase(settings.exclude, names)}.`;
    case "first_login": {
      const products = accessProductsOf(settings);
      const who = products.length === 0 ? "na primeira vez que o aluno entra na área" : `na primeira vez depois de ganhar acesso a ${accessProductsPhrase(products, names)}`;

      return `Aparece ${who}, ${describePopupPages(settings.pages, names)}${describePopupExceptions(settings.exclude, names)}.`;
    }
    default:
      return `Aparece ${describePopupPages(settings.pages, names)}${describePopupExceptions(settings.exclude, names)}.`;
  }
}

/**
 * Curso escolhido em "Página do produto" que abre direto na aula (coursePresentationMode lesson_playlist)
 * nunca mostra a pagina do produto: " (Curso X abre direto na aula: marque também “Páginas de aula”.)"; null
 * quando nenhum, ou quando "Páginas de aula" ja cobre.
 */
export function opensOnLessonNote(settings: PopupSettings, opensOnLesson: readonly string[], names: PopupNames): string | null {
  // Vale nos momentos de pagina ("Ao abrir a página" e "No primeiro acesso").
  if (isLessonTrigger(settings.trigger)) {
    return null;
  }

  const direct = new Set(opensOnLesson);
  const affected = productIdsOf(canonicalPatterns(settings.pages), "content").filter(
    (id) => direct.has(id) && !settings.pages.some((pattern) => pagePatternMatches(pattern, `lesson:${id}`))
  );

  if (affected.length === 0) {
    return null;
  }

  const first = nameOf(affected[0], names) ?? "Um produto";
  const who = affected.length === 1 ? `${first} abre` : `${first} e mais ${count(affected.length - 1)} abrem`;

  return ` (${who} direto na aula: marque também “Páginas de aula”.)`;
}

/* ------------------------------------------------------------------------------------------------
 * Quantas vezes
 * ---------------------------------------------------------------------------------------------- */

function perDayPhrase(maxPerDay: number) {
  return maxPerDay === 1 ? "até 1 vez por dia" : `até ${count(maxPerDay)} vezes por dia`;
}

/** A parte da revisao: "no máximo 1 vez", "até 3 vezes por dia, com pelo menos 2 horas entre uma vez e outra, até o aluno clicar". */
export function describePopupFrequency(frequency: PopupFrequency, trigger: PopupTrigger): string {
  if (frequency.mode === "once") {
    return "no máximo 1 vez";
  }

  const parts: string[] = [];

  if (frequency.maxPerDay !== null) {
    parts.push(perDayPhrase(frequency.maxPerDay));
  }

  if (frequency.everyMinutes !== null) {
    parts.push(`com pelo menos ${describeMinutes(frequency.everyMinutes)} entre uma vez e outra`);
  }

  if (frequency.maxPerDay === null && frequency.everyMinutes === null) {
    parts.push(MOMENT_WORDS[trigger].every);
  }

  if (frequency.maxTotal !== null) {
    parts.push(`no máximo ${count(frequency.maxTotal)} vezes no total`);
  }

  parts.push(frequency.stopOn === "click" ? "até o aluno clicar" : "até o pop-up terminar");

  return parts.join(", ");
}

/** Legenda da previa e fim das frases ao vivo. */
export function popupCloseCaption(close: PopupClose): string {
  return close === "x_only" ? "Fecha só no X (e no Esc)." : "Fecha no X, no Esc ou clicando fora.";
}

/** A frase ao vivo do card "Quantas vezes e como fecha". */
export function describePopupFrequencyLive(settings: PopupSettings, allowSnooze: boolean): string {
  const { frequency } = settings;
  const caption = popupCloseCaption(settings.close);

  if (frequency.mode === "once") {
    return `Cada aluno vê uma vez${allowSnooze ? " (mais uma a cada “Lembrar depois”)" : ""}. ${caption}`;
  }

  const words = MOMENT_WORDS[settings.trigger];
  const parts: string[] = [];

  if (frequency.maxPerDay !== null) {
    parts.push(perDayPhrase(frequency.maxPerDay));
  }

  if (frequency.everyMinutes !== null) {
    parts.push(`com pelo menos ${describeMinutes(frequency.everyMinutes)} entre uma vez e outra (${words.nextAfter})`);
  }

  if (frequency.maxPerDay === null && frequency.everyMinutes === null) {
    parts.push(words.everyLive);
  }

  if (frequency.maxTotal !== null) {
    parts.push(`no máximo ${count(frequency.maxTotal)} vezes no total`);
  }

  parts.push(frequency.stopOn === "click" ? "até clicar no botão" : "até o pop-up terminar");

  return `Cada aluno vê ${parts.join(", ")}. ${caption}`;
}

/* ------------------------------------------------------------------------------------------------
 * Revisao, lista e relatorio
 * ---------------------------------------------------------------------------------------------- */

/** ", logo ao abrir", ", 10 segundos depois de abrir", ", 1 minuto depois de abrir"; 3 s (o padrao) = nada. */
function openDelayPhrase(delaySeconds: number) {
  if (delaySeconds === 3) {
    return "";
  }

  return delaySeconds === 0 ? ", logo ao abrir" : `, ${seconds(delaySeconds)} depois de abrir`;
}

/** ", logo depois", ", 10 segundos depois"; 3 s (o padrao) = nada. */
function lessonDelayPhrase(delaySeconds: number) {
  if (delaySeconds === 3) {
    return "";
  }

  return delaySeconds === 0 ? ", logo depois" : `, ${seconds(delaySeconds)} depois`;
}

/**
 * As partes do pop-up na frase de revisao (describeNoticeReview): para quem (v3b-2: so no "No primeiro
 * acesso", que entra no lugar de "para {318 alunos}"; null nos outros momentos), onde e quando (null quando
 * tudo e o padrao: so no Inicio, ao abrir a pagina, 3 s depois) e quantas vezes.
 */
export function popupReviewParts(settings: PopupSettings, names: PopupNames): { audience: string | null; frequency: string; placement: string | null } {
  const frequency = describePopupFrequency(settings.frequency, settings.trigger);

  if (isDefaultPlacement(settings)) {
    return { audience: null, frequency, placement: null };
  }

  switch (settings.trigger) {
    case "lesson_completed":
      return {
        audience: null,
        frequency,
        placement: `${lessonMomentPhrase(settings.pages, names)}${lessonExceptionPhrase(settings.exclude, names)}${lessonDelayPhrase(settings.delaySeconds)}`
      };
    case "course_completed":
      return {
        audience: null,
        frequency,
        placement: `${courseMomentPhrase(settings.pages, names)}${courseExceptionPhrase(settings.exclude, names)}${lessonDelayPhrase(settings.delaySeconds)}`
      };
    case "first_login": {
      const products = accessProductsOf(settings);

      return {
        audience:
          products.length === 0
            ? "para quem entrar pela primeira vez"
            : `para quem entrar pela primeira vez depois de ganhar acesso a ${accessProductsPhrase(products, names)}`,
        frequency,
        placement: `${describePopupPages(settings.pages, names)}${describePopupExceptions(settings.exclude, names)}${openDelayPhrase(settings.delaySeconds)}`
      };
    }
    default:
      return {
        audience: null,
        frequency,
        placement: `${describePopupPages(settings.pages, names)}${describePopupExceptions(settings.exclude, names)}${openDelayPhrase(settings.delaySeconds)}`
      };
  }
}

/** Segunda linha da coluna "Quando" na lista (sem nomes de produto); null quando tudo e o padrao. */
export function describePopupPlacementShort(settings: PopupSettings): string | null {
  if (isDefaultPlacement(settings)) {
    return null;
  }

  const suffix = settings.exclude.length > 0 ? " (com exceções)" : "";

  switch (settings.trigger) {
    case "lesson_completed":
      return `Ao concluir uma aula${suffix}`;
    case "course_completed":
      return `Ao concluir um curso${suffix}`;
    case "first_login":
      return `No primeiro acesso${suffix}`;
    default:
      break;
  }

  const pages = canonicalPatterns(settings.pages);
  const single = pages[0] ?? "home";
  let label: string;

  if (pages.includes("any")) {
    label = "Em qualquer página";
  } else if (pages.length > 1) {
    label = `Em ${count(pages.length)} páginas`;
  } else if (single.startsWith("content:")) {
    label = "Na página do produto";
  } else if (single.startsWith("lesson:")) {
    label = "Nas páginas de aula";
  } else {
    label = capitalize(PAGE_PHRASES[single] ?? PAGE_PHRASES.home);
  }

  return `${label}${suffix}`;
}

/** "Quando aparece" em "Detalhes": "Ao abrir a página", "No primeiro acesso à área", "No primeiro acesso a Formação IA". */
function momentLabel(settings: PopupSettings, names: PopupNames) {
  switch (settings.trigger) {
    case "lesson_completed":
      return "Ao concluir uma aula";
    case "course_completed":
      return "Ao concluir um curso";
    case "first_login": {
      const products = accessProductsOf(settings);

      return products.length === 0 ? "No primeiro acesso à área" : `No primeiro acesso a ${accessProductsPhrase(products, names)}`;
    }
    default:
      return "Ao abrir a página";
  }
}

/** As linhas de "Detalhes" no relatorio do pop-up, depois de "Quando". */
export function popupSettingsLines(
  settings: PopupSettings,
  names: PopupNames
): { label: "Como fecha" | "Onde" | "Quando aparece" | "Quantas vezes"; value: string }[] {
  // Ao concluir uma aula ou um curso: so paginas de aula (as excecoes sao aulas de produtos).
  const lesson = isLessonTrigger(settings.trigger);
  const where = lesson
    ? `${describePopupPages(settings.pages, names)}${lessonExceptionPhrase(settings.exclude, names)}`
    : `${describePopupPages(settings.pages, names)}${describePopupExceptions(settings.exclude, names)}`;
  const delay = settings.delaySeconds === 0 ? (lesson ? "logo depois" : "logo") : `${seconds(settings.delaySeconds)} depois`;

  return [
    { label: "Onde", value: capitalize(where) },
    { label: "Quando aparece", value: `${momentLabel(settings, names)}, ${delay}` },
    { label: "Quantas vezes", value: capitalize(describePopupFrequency(settings.frequency, settings.trigger)) },
    { label: "Como fecha", value: settings.close === "x_only" ? "Só no X (e no Esc)" : "No X, no Esc ou clicando fora" }
  ];
}

/* ------------------------------------------------------------------------------------------------
 * Avisos do card "Quantas vezes e como fecha"
 * ---------------------------------------------------------------------------------------------- */

/**
 * As linhas sob os campos de "Mais de uma vez", na ordem: o conflito entre o limite por dia e o tempo entre
 * uma vez e outra, sem ritmo nenhum, as vezes do dia seguidas e "Só quando o pop-up terminar" sem data de fim.
 */
export function popupFrequencyNotes(input: { endsAt: string | null; frequency: PopupFrequency; trigger: PopupTrigger }): { text: string; tone: "info" | "warning" }[] {
  const { frequency } = input;
  const words = MOMENT_WORDS[input.trigger];
  const notes: { text: string; tone: "info" | "warning" }[] = [];

  if (frequency.mode === "once") {
    return notes;
  }

  const { everyMinutes, maxPerDay } = frequency;

  if (maxPerDay !== null && everyMinutes !== null && Math.ceil(1_440 / everyMinutes) < maxPerDay) {
    const fits = Math.ceil(1_440 / everyMinutes);

    notes.push({
      text: `Com ${describeMinutes(everyMinutes)} entre uma vez e outra, cabem no máximo ${fits === 1 ? "1 vez" : `${count(fits)} vezes`} por dia, não ${count(maxPerDay)}. Diminua o tempo entre uma vez e outra ou desligue essa opção.`,
      tone: "warning"
    });
  }

  if (maxPerDay === null && everyMinutes === null) {
    const until = frequency.stopOn === "click" ? ", até ele clicar no botão" : ", até o pop-up terminar";

    notes.push({ text: `Sem limite por dia nem tempo entre uma vez e outra, o pop-up aparece ${words.everyNote}${until}.`, tone: "warning" });
  }

  if (maxPerDay !== null && maxPerDay > 1 && everyMinutes === null) {
    notes.push({
      text: `Sem tempo entre uma vez e outra, as ${count(maxPerDay)} vezes do dia podem acontecer seguidas, ${words.inARow}. Para espalhar pelo dia, ligue “Tempo entre uma vez e outra”.`,
      tone: "info"
    });
  }

  if (frequency.stopOn === "never" && input.endsAt === null) {
    notes.push({ text: "Sem data para acabar, ele continua aparecendo enquanto o aluno estiver no segmento.", tone: "warning" });
  }

  return notes;
}

/** O "Lembrar depois" esconde por mais tempo do que o intervalo de "Mais de uma vez"; null nos outros casos. */
export function popupSnoozeNote(input: { allowSnooze: boolean; frequency: PopupFrequency; snoozeMinutes: number }): string | null {
  const { frequency } = input;

  if (!input.allowSnooze || frequency.mode !== "repeat" || frequency.everyMinutes === null || frequency.everyMinutes >= input.snoozeMinutes) {
    return null;
  }

  return `“Lembrar depois” esconde o pop-up por ${describeMinutes(input.snoozeMinutes)}, mais do que o tempo entre uma vez e outra.`;
}
