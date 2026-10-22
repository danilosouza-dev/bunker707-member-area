// Pop-ups da v3b-1 "frequencia, paginas e como fechar" (docs/25): em quais paginas cada pop-up aparece e em
// quais nunca, em que momento (ao abrir a pagina, ao concluir uma aula), quantas vezes para cada aluno, em
// quanto tempo o "Lembrar depois" traz de volta e como fecha. As regras moram so aqui: o servidor (resumo,
// show e eventos), o navegador do aluno (plano e fila), o editor do admin e os testes usam as mesmas
// funcoes; o banco so guarda o formato (checks da 202610220003) e grava a abertura de forma atomica.
// Modulo puro: sem "server-only", imports relativos, sem enum; tests/pop-ups-v3b1-modelo.test.mjs carrega
// direto pelo Node.
//
// Sem limite entre pop-ups (decisao do produtor, docs/24 §10.8): cada pop-up segue a propria frequencia; o
// sistema so garante um de cada vez na tela. Pisos tecnicos invisiveis (POPUP_V3B1_RULES): o mesmo pop-up
// nunca abre duas vezes em menos de 5 s para o mesmo aluno e o historico grava ate 100 aberturas por dia.

import { FIXED_PAGE_KEYS, FIXED_PAGE_PATHS } from "../member-area/page-visit-model";
import type { PopupDeliveryState, PopupRepeat } from "./campaign-model";
import type { PopupPlanItem } from "./notification-model";
// Sem import de flow-model.ts nem de popup-sentences.ts (campaign-model -> este modulo nao pode virar ciclo).

export const POPUP_TRIGGERS = ["page_load", "lesson_completed"] as const;
export type PopupTrigger = (typeof POPUP_TRIGGERS)[number];
export const POPUP_STOP_ON = ["click", "never"] as const;
export type PopupStopOn = (typeof POPUP_STOP_ON)[number];
export const POPUP_CLOSE_MODES = ["any", "x_only"] as const;
export type PopupClose = (typeof POPUP_CLOSE_MODES)[number];
export const POPUP_CLOSE_VIAS = ["x", "outside", "esc", "page"] as const;
export type PopupCloseVia = (typeof POPUP_CLOSE_VIAS)[number];
export const POPUP_PAGE_KINDS = ["home", "content", "lesson", "purchases", "saved", "materials", "journey", "continue", "profile", "support"] as const;
export type PopupPageKind = (typeof POPUP_PAGE_KINDS)[number];

export type PopupFrequency =
  | { mode: "once" }
  | { everyMinutes: number | null; maxPerDay: number | null; maxTotal: number | null; mode: "repeat"; stopOn: PopupStopOn };

export type PopupSettings = {
  close: PopupClose;
  delaySeconds: number;
  exclude: string[];
  frequency: PopupFrequency;
  pages: string[];
  /** Lembrar depois: em quantos minutos volta (5 a 10.080). */
  snoozeMinutes: number;
  trigger: PopupTrigger;
};

/** Mesmo texto da expressao do banco (communication_popup_pages_ok): o guard compara as duas. */
export const POPUP_PAGE_PATTERN = /^(any|home|purchases|saved|materials|journey|continue|profile|support|(?:content|lesson):(?:\*|[A-Za-z0-9_-]{1,240}))$/;
/** Uma pagina de verdade (sem curingas). */
export const POPUP_PAGE_KEY = /^(home|purchases|saved|materials|journey|continue|profile|support|(?:content|lesson):[A-Za-z0-9_-]{1,240})$/;

export const POPUP_V3B1_RULES = {
  defaultDelaySeconds: 3,
  delaySeconds: { max: 600, min: 0 },
  eventsPerDayMax: 100,
  everyMinutes: { max: 129_600, min: 1 },
  liveReadMax: 60,
  maxPages: 20,
  maxPerDay: { max: 100, min: 1 },
  maxTotal: { max: 1_000, min: 2 },
  minGapMs: 5_000,
  publishedMax: 50,
  snoozeMinutes: { default: 1_440, max: 10_080, min: 5 }
} as const;

export const POPUP_SETTINGS_DEFAULT: PopupSettings = {
  close: "any",
  delaySeconds: 3,
  exclude: [],
  frequency: { mode: "once" },
  pages: ["home"],
  snoozeMinutes: 1_440,
  trigger: "page_load"
};
/** "Ate o aluno clicar" da v1/v3a: de novo 1 dia depois de visto, ate clicar. */
export const POPUP_UNTIL_CLICK_V1: PopupFrequency = { everyMinutes: 1_440, maxPerDay: null, maxTotal: null, mode: "repeat", stopOn: "click" };

export type PopupColumns = {
  popup_close: PopupClose;
  popup_delay_seconds: number;
  popup_every_minutes: number | null;
  popup_exclude_pages: string[];
  popup_frequency: "once" | "repeat" | null;
  popup_max_per_day: number | null;
  popup_max_total: number | null;
  popup_pages: string[];
  popup_repeat: PopupRepeat;
  popup_snooze_minutes: number;
  popup_stop_on: PopupStopOn | null;
  popup_trigger: string;
};

/** O estado do aluno num pop-up (a linha de campaign_deliveries), com a coluna da v3b-1. */
export type PopupCountState = PopupDeliveryState & { dayImpressions: number; reshownAt: number | null };

/** Um pop-up da lista no ar (cache), com as paginas ja expandidas (formacao -> cursos). */
export type LivePopupRules = { allowSnooze: boolean; endsAt: number | null; id: string; rank: number; settings: PopupSettings; startsAt: number | null };

export type ShowRefusal = "changed" | "frequency" | "not_eligible" | "not_live" | "page" | "trigger";
export type ShowDecision = { ok: true } | { nextAt: number | null; ok: false; reason: Exclude<ShowRefusal, "changed"> };
export type FrequencyVerdict = { allowed: true } | { allowed: false; nextAt: number | null };
/** Quando o pop-up pode voltar depois de uma abertura (resposta do show): null = nao volta mais. */
export type PopupNext = { notBefore: string | null } | null;

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;

function iso(time: number) {
  return new Date(time).toISOString();
}

/** Copia nova do padrao (as listas nunca sao compartilhadas). */
export function defaultPopupSettings(): PopupSettings {
  return { ...POPUP_SETTINGS_DEFAULT, exclude: [], frequency: { mode: "once" }, pages: ["home"] };
}

/* ------------------------------------------------------------------------------------------------
 * Paginas
 * ---------------------------------------------------------------------------------------------- */

const FIXED_BY_PATH = new Map<string, string>(FIXED_PAGE_KEYS.map((key) => [FIXED_PAGE_PATHS[key], key]));
const CONTENT_ROUTE = /^\/conteudo\/([A-Za-z0-9_-]{1,240})$/;
const LESSON_ROUTE = /^\/conteudo\/([A-Za-z0-9_-]{1,240})\/aulas\/[^/]+$/;

/** Uma pagina de verdade da area do aluno (o `page` do show e o do resumo). */
export function isPopupPageKey(value: unknown): value is string {
  return typeof value === "string" && POPUP_PAGE_KEY.test(value);
}

/**
 * Chave da pagina do pop-up: "/" -> home, "/conteudo/x" -> content:x, "/conteudo/x/aulas/y" -> lesson:x, as
 * paginas fixas do menu. Query e hash nao contam; barra no fim nao importa. Login, Alterar senha, Modo TV,
 * admin e qualquer outra rota -> null (nunca um pop-up la).
 */
export function popupPageKeyOf(pathname: unknown): string | null {
  if (typeof pathname !== "string" || !pathname.startsWith("/") || pathname.startsWith("//")) {
    return null;
  }

  const raw = pathname.split(/[?#]/, 1)[0] ?? "";
  const path = raw.length > 1 ? raw.replace(/\/+$/, "") || "/" : raw;
  const fixed = FIXED_BY_PATH.get(path);

  if (fixed) {
    return fixed;
  }

  const content = CONTENT_ROUTE.exec(path);

  if (content) {
    return `content:${content[1]}`;
  }

  const lesson = LESSON_ROUTE.exec(path);

  return lesson ? `lesson:${lesson[1]}` : null;
}

export function pageKindOf(key: string): PopupPageKind | null {
  return isPopupPageKey(key) ? (key.split(":")[0] as PopupPageKind) : null;
}

export function pagePatternMatches(pattern: string, key: string) {
  if (pattern === "any") {
    return true;
  }

  if (pattern === "content:*") {
    return key.startsWith("content:");
  }

  if (pattern === "lesson:*") {
    return key.startsWith("lesson:");
  }

  return pattern === key;
}

/** O pop-up pode aparecer nesta pagina? A excecao vence. */
export function popupAllowsPage(placement: { exclude: readonly string[]; pages: readonly string[] }, key: string) {
  if (!isPopupPageKey(key) || placement.exclude.some((pattern) => pagePatternMatches(pattern, key))) {
    return false;
  }

  return placement.pages.some((pattern) => pagePatternMatches(pattern, key));
}

/** content:<id> -> content:*, lesson:<id> -> lesson:* (o mapa que vai para todo aluno nunca leva id de produto). */
export function coarsePagePattern(pattern: string) {
  if (pattern.startsWith("content:")) {
    return "content:*";
  }

  return pattern.startsWith("lesson:") ? "lesson:*" : pattern;
}

/** Algum padrao cobre a pagina (sem excecoes: um superconjunto, §4.4). */
export function coversPage(patterns: readonly string[], key: string) {
  return isPopupPageKey(key) && patterns.some((pattern) => pagePatternMatches(pattern, key));
}

/** As dez paginas que "qualquer página" cobre (para saber quando as excecoes tiram tudo). */
const EVERY_PAGE_KIND = ["home", "content:*", "lesson:*", ...FIXED_PAGE_KEYS.filter((key) => key !== "home")];

/** As excecoes tiram todas as paginas escolhidas? (o pop-up nao apareceria em lugar nenhum) */
export function placementCoversNothing(placement: { exclude: readonly string[]; pages: readonly string[] }) {
  const excluded = new Set(placement.exclude);

  if (placement.pages.length === 0) {
    return false;
  }

  return placement.pages.every((pattern) => {
    if (pattern === "any") {
      return EVERY_PAGE_KIND.every((kind) => excluded.has(kind));
    }

    if (pattern === "content:*" || pattern === "lesson:*") {
      return excluded.has(pattern);
    }

    return excluded.has(pattern) || excluded.has(coarsePagePattern(pattern));
  });
}

/** Ordem de leitura dos padroes: qualquer, Inicio, as fixas na ordem do menu, produtos, aulas. */
function patternRank(pattern: string) {
  if (pattern === "any") {
    return 0;
  }

  const fixed = (FIXED_PAGE_KEYS as readonly string[]).indexOf(pattern);

  if (fixed >= 0) {
    return 1 + fixed;
  }

  if (pattern === "content:*") {
    return 20;
  }

  if (pattern.startsWith("content:")) {
    return 21;
  }

  if (pattern === "lesson:*") {
    return 30;
  }

  return pattern.startsWith("lesson:") ? 31 : 99;
}

function comparePatterns(left: string, right: string) {
  return patternRank(left) - patternRank(right) || (left < right ? -1 : left > right ? 1 : 0);
}

/** Padroes aparados, sem repeticao, na ordem de leitura. */
export function canonicalPatterns(patterns: readonly string[]): string[] {
  const unique = new Set<string>();

  for (const pattern of patterns) {
    if (typeof pattern === "string" && pattern.trim()) {
      unique.add(pattern.trim());
    }
  }

  return [...unique].sort(comparePatterns);
}

/**
 * Formacao escolhida vale tambem para as paginas dos cursos dela (tambem os que entrarem depois): cada
 * content:<F> / lesson:<F> ganha content:<c> / lesson:<c> de cada curso. Curingas e paginas fixas ficam.
 */
export function expandFormationPatterns(
  patterns: readonly string[],
  coursesOf: ReadonlyMap<string, readonly string[]> | ((id: string) => readonly string[] | null | undefined)
): string[] {
  const lookup = typeof coursesOf === "function" ? coursesOf : (id: string) => coursesOf.get(id);
  const expanded: string[] = [];

  for (const pattern of patterns) {
    expanded.push(pattern);

    const match = /^(content|lesson):([A-Za-z0-9_-]{1,240})$/.exec(pattern);

    if (!match) {
      continue;
    }

    for (const course of lookup(match[2]) ?? []) {
      const key = `${match[1]}:${course}`;

      if (isPopupPageKey(key)) {
        expanded.push(key);
      }
    }
  }

  return canonicalPatterns(expanded);
}

/* ------------------------------------------------------------------------------------------------
 * Colunas <-> configuracao
 * ---------------------------------------------------------------------------------------------- */

type PopupColumnsInput = Partial<Record<keyof PopupColumns, unknown>>;

function integerIn(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function v1Frequency(repeat: unknown): PopupFrequency {
  return repeat === "until_action" ? { ...POPUP_UNTIL_CLICK_V1 } : { mode: "once" };
}

/**
 * "Quantas vezes" da linha. popup_frequency nulo = pop-up gravado antes da v3b-1 (ou pelo app da v3a ate o
 * deploy): vem de popup_repeat (once = Uma vez; until_action = de novo 1 dia depois de visto, ate clicar).
 */
export function frequencyOfColumns(row: PopupColumnsInput): PopupFrequency {
  const mode = row.popup_frequency ?? null;

  if (mode === null) {
    return v1Frequency(row.popup_repeat);
  }

  if (mode !== "repeat") {
    return { mode: "once" };
  }

  const { everyMinutes, maxPerDay, maxTotal } = POPUP_V3B1_RULES;

  return {
    everyMinutes: integerIn(row.popup_every_minutes, everyMinutes.min, everyMinutes.max),
    maxPerDay: integerIn(row.popup_max_per_day, maxPerDay.min, maxPerDay.max),
    maxTotal: integerIn(row.popup_max_total, maxTotal.min, maxTotal.max),
    mode: "repeat",
    stopOn: row.popup_stop_on === "never" ? "never" : "click"
  };
}

function patternsOf(value: unknown, fallback: readonly string[], allowAny: boolean) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const valid = value.filter((pattern): pattern is string => typeof pattern === "string" && POPUP_PAGE_PATTERN.test(pattern) && (allowAny || pattern !== "any"));

  return valid.length > 0 || fallback.length === 0 ? canonicalPatterns(valid) : [...fallback];
}

/**
 * Configuracao do pop-up a partir da linha; cada campo cai no padrao quando falta ou e invalido (linha lida
 * antes da migracao nao tem nenhum; um momento da v3b-2, como at_start, lido por este app vira page_load).
 */
export function popupSettingsOfRow(row: PopupColumnsInput): PopupSettings {
  const fallback = POPUP_SETTINGS_DEFAULT;
  const { delaySeconds, snoozeMinutes } = POPUP_V3B1_RULES;

  return {
    close: row.popup_close === "x_only" ? "x_only" : "any",
    delaySeconds: integerIn(row.popup_delay_seconds, delaySeconds.min, delaySeconds.max) ?? fallback.delaySeconds,
    exclude: patternsOf(row.popup_exclude_pages, fallback.exclude, false),
    frequency: frequencyOfColumns(row),
    pages: patternsOf(row.popup_pages, fallback.pages, true),
    snoozeMinutes: integerIn(row.popup_snooze_minutes, snoozeMinutes.min, snoozeMinutes.max) ?? fallback.snoozeMinutes,
    trigger: (POPUP_TRIGGERS as readonly unknown[]).includes(row.popup_trigger) ? (row.popup_trigger as PopupTrigger) : fallback.trigger
  };
}

export function repeatOfFrequency(frequency: PopupFrequency): PopupRepeat {
  return frequency.mode === "once" ? "once" : "until_action";
}

/** As onze colunas popup_* e popup_repeat (sempre coerente com "Quantas vezes", check campaigns_popup_frequency_v3b). */
export function popupSettingsToColumns(settings: PopupSettings): PopupColumns {
  const { frequency } = settings;
  const repeat = frequency.mode === "repeat" ? frequency : null;

  return {
    popup_close: settings.close,
    popup_delay_seconds: settings.delaySeconds,
    popup_every_minutes: repeat ? repeat.everyMinutes : null,
    popup_exclude_pages: [...settings.exclude],
    popup_frequency: frequency.mode,
    popup_max_per_day: repeat ? repeat.maxPerDay : null,
    popup_max_total: repeat ? repeat.maxTotal : null,
    popup_pages: [...settings.pages],
    popup_repeat: repeatOfFrequency(frequency),
    popup_snooze_minutes: settings.snoozeMinutes,
    popup_stop_on: repeat ? repeat.stopOn : null,
    popup_trigger: settings.trigger
  };
}

/** O que uma notificacao (e um passo de fluxo) grava: os padroes (check campaigns_popup_only_v3b). */
export const POPUP_COLUMNS_FOR_INBOX: PopupColumns = {
  popup_close: "any",
  popup_delay_seconds: 3,
  popup_every_minutes: null,
  popup_exclude_pages: [],
  popup_frequency: null,
  popup_max_per_day: null,
  popup_max_total: null,
  popup_pages: ["home"],
  popup_repeat: "once",
  popup_snooze_minutes: 1_440,
  popup_stop_on: null,
  popup_trigger: "page_load"
};

export function sameFrequency(left: PopupFrequency, right: PopupFrequency) {
  if (left.mode === "once" || right.mode === "once") {
    return left.mode === right.mode;
  }

  return left.everyMinutes === right.everyMinutes && left.maxPerDay === right.maxPerDay && left.maxTotal === right.maxTotal && left.stopOn === right.stopOn;
}

/**
 * "Quantas vezes" de um rascunho que pode trazer so o `repeat` da v1/v3a. `popup.frequency` manda sempre que
 * vem; sem ele, a regra da v1 do `repeat`. Os dois discordam e `frequency` e a gravada (`stored`, so o
 * caminho de salvar do servidor passa): quem chamou mudou so o `repeat` (o teste da v1 faz
 * `{ ...detalhe.draft, repeat: "until_action" }`) -> a regra da v1 do `repeat`. Sem a linha gravada
 * (rascunho novo, draftToColumns), `{ mode: "once" }` com `repeat: "until_action"` e o mesmo caso: o
 * `{ mode: "once" }` veio do rascunho vazio (`{ ...emptyNoticeDraft("popup"), repeat: "until_action" }`) e
 * quem escolhe "Uma vez" de verdade grava os dois juntos (popupFrequencyPatch).
 */
export function reconcilePopupFrequency(input: { frequency: PopupFrequency | undefined; repeat: PopupRepeat; stored: PopupFrequency | null }): PopupFrequency {
  const { frequency, repeat, stored } = input;

  if (frequency === undefined) {
    return v1Frequency(repeat);
  }

  if (repeatOfFrequency(frequency) === repeat) {
    return frequency;
  }

  if (stored !== null) {
    return sameFrequency(frequency, stored) ? v1Frequency(repeat) : frequency;
  }

  return frequency.mode === "once" ? v1Frequency(repeat) : frequency;
}

/** O unico jeito de o editor e o Duplicar mudarem "Quantas vezes": `popup.frequency` e `repeat` juntos. */
export function popupFrequencyPatch(draft: { popup?: PopupSettings }, frequency: PopupFrequency): { popup: PopupSettings; repeat: PopupRepeat } {
  return { popup: { ...(draft.popup ?? defaultPopupSettings()), frequency }, repeat: repeatOfFrequency(frequency) };
}

/** Forma canonica (o editor compara mudancas nao salvas e draftToColumns grava): padroes em ordem, sem sobra. */
export function canonicalPopupSettings(settings: PopupSettings): PopupSettings {
  const { frequency } = settings;

  return {
    close: settings.close,
    delaySeconds: settings.delaySeconds,
    exclude: canonicalPatterns(settings.exclude),
    frequency:
      frequency.mode === "once"
        ? { mode: "once" }
        : { everyMinutes: frequency.everyMinutes, maxPerDay: frequency.maxPerDay, maxTotal: frequency.maxTotal, mode: "repeat", stopOn: frequency.stopOn },
    pages: canonicalPatterns(settings.pages),
    snoozeMinutes: settings.snoozeMinutes,
    trigger: settings.trigger
  };
}

/** So no Inicio, ao abrir a pagina, 3 s depois, sem excecoes (o que todo pop-up de antes faz). */
export function isDefaultPlacement(settings: Pick<PopupSettings, "delaySeconds" | "exclude" | "pages" | "trigger">) {
  return (
    settings.trigger === "page_load" &&
    settings.pages.length === 1 &&
    settings.pages[0] === "home" &&
    settings.exclude.length === 0 &&
    settings.delaySeconds === POPUP_V3B1_RULES.defaultDelaySeconds
  );
}

/* ------------------------------------------------------------------------------------------------
 * Quantas vezes (por aluno)
 * ---------------------------------------------------------------------------------------------- */

/**
 * O dia de Sao Paulo (UTC-3 fixo, como o resto do sistema): o mesmo de saoPauloDayBounds de flow-model.ts
 * (copia separada para flow-model nao entrar no pacote do navegador; um teste confere as duas).
 */
export function popupDayBounds(now: number): { nextStart: number; start: number } {
  const start = Math.floor((now - SAO_PAULO_OFFSET_MS) / DAY_MS) * DAY_MS + SAO_PAULO_OFFSET_MS;

  return { nextStart: start + DAY_MS, start };
}

const NEVER: FrequencyVerdict = { allowed: false, nextAt: null };

/**
 * A frequencia deixa abrir agora? Paradas definitivas primeiro (fora do segmento, "Não mostrar de novo",
 * "Uma vez" ja visto, clicou em "para quando clica", limite total), depois as esperas; `nextAt` e a mais
 * tardia delas. Tudo conta so o que veio depois do ultimo "mostrar de novo" (reshownAt e os "before").
 */
export function frequencyVerdict(frequency: PopupFrequency, state: PopupCountState, now: number): FrequencyVerdict {
  const impressions = state.impressions - (state.impressionsBeforeReshow ?? 0);
  const snoozes = state.snoozeCount - (state.snoozesBeforeReshow ?? 0);
  const lastSeen = state.lastSeenAt !== null && (state.reshownAt === null || state.lastSeenAt > state.reshownAt) ? state.lastSeenAt : null;
  const { nextStart, start } = popupDayBounds(now);

  if (!state.eligible || state.dismissedAt !== null) {
    return NEVER;
  }

  if (frequency.mode === "once") {
    // Cada "Lembrar depois" vale mais uma vez; clicou (mesmo sem a abertura gravada), acabou.
    if (state.clickedAt !== null || impressions > snoozes) {
      return NEVER;
    }
  } else {
    if (frequency.stopOn === "click" && state.clickedAt !== null) {
      return NEVER;
    }

    if (frequency.maxTotal !== null && impressions - snoozes >= frequency.maxTotal) {
      return NEVER;
    }
  }

  const waits: number[] = [];

  if (state.snoozedUntil !== null && state.snoozedUntil > now) {
    waits.push(state.snoozedUntil);
  }

  if (lastSeen !== null && now - lastSeen < POPUP_V3B1_RULES.minGapMs) {
    waits.push(lastSeen + POPUP_V3B1_RULES.minGapMs);
  }

  if (frequency.mode === "repeat") {
    // Linha vista hoje antes da v3b-1 tem day_impressions 0 e conta 1 (a mesma conta da RPC 5.1).
    if (frequency.maxPerDay !== null && lastSeen !== null && lastSeen >= start && Math.max(state.dayImpressions, 1) >= frequency.maxPerDay) {
      waits.push(nextStart);
    }

    if (frequency.everyMinutes !== null && lastSeen !== null && now - lastSeen < frequency.everyMinutes * MIN_MS) {
      waits.push(lastSeen + frequency.everyMinutes * MIN_MS);
    }
  }

  return waits.length === 0 ? { allowed: true } : { allowed: false, nextAt: Math.max(...waits) };
}

/** Depois de uma abertura (o estado ja com ela): quando o pop-up pode voltar; null = nao volta mais. */
export function showNext(frequency: PopupFrequency, after: PopupCountState, now: number): PopupNext {
  const verdict = frequencyVerdict(frequency, after, now);

  if (verdict.allowed) {
    return { notBefore: null };
  }

  return verdict.nextAt === null ? null : { notBefore: iso(verdict.nextAt) };
}

/**
 * Quem "Mostrar de novo para quem já viu" zera (o predicado da RPC 5.2): no segmento, sem "Não mostrar de
 * novo", viu mais vezes do que adiou desde o ultimo zerar e nao clicou, menos nos pop-ups que so param
 * quando terminam (`stopOn` "never"), onde o clique nunca parou ninguem. `stopOn` null = Uma vez (e linha antiga).
 */
export function reshowTarget(delivery: PopupDeliveryState, stopOn: PopupStopOn | null) {
  return (
    delivery.eligible &&
    delivery.dismissedAt === null &&
    (delivery.clickedAt === null || stopOn === "never") &&
    delivery.impressions - (delivery.impressionsBeforeReshow ?? 0) > delivery.snoozeCount - (delivery.snoozesBeforeReshow ?? 0)
  );
}

/* ------------------------------------------------------------------------------------------------
 * Decisao do show, plano do aluno e mapa das paginas
 * ---------------------------------------------------------------------------------------------- */

/** A janela do pop-up esta aberta agora (comeco no passado ou sem comeco; fim no futuro ou sem fim). */
export function popupWindowOpen(popup: Pick<LivePopupRules, "endsAt" | "startsAt">, now: number) {
  return (popup.startsAt === null || popup.startsAt <= now) && (popup.endsAt === null || popup.endsAt > now);
}

/**
 * O servidor deixa abrir este pop-up agora, nesta pagina e neste momento? Na ordem: no ar, elegivel, pagina,
 * momento, frequencia. Depois o servidor grava pela RPC 5.1 com o updated_at que leu (null = "changed").
 */
export function decideShow(input: {
  delivery: PopupCountState | null;
  now: number;
  pageKey: string;
  popup: LivePopupRules | null;
  trigger: string;
}): ShowDecision {
  const { delivery, now, popup } = input;

  if (!popup || !popupWindowOpen(popup, now)) {
    return { nextAt: null, ok: false, reason: "not_live" };
  }

  if (!delivery || !delivery.eligible) {
    return { nextAt: null, ok: false, reason: "not_eligible" };
  }

  if (!popupAllowsPage(popup.settings, input.pageKey)) {
    return { nextAt: null, ok: false, reason: "page" };
  }

  if (input.trigger !== popup.settings.trigger) {
    return { nextAt: null, ok: false, reason: "trigger" };
  }

  const verdict = frequencyVerdict(popup.settings.frequency, delivery, now);

  return verdict.allowed ? { ok: true } : { nextAt: verdict.nextAt, ok: false, reason: "frequency" };
}

function byRank(left: LivePopupRules, right: LivePopupRules) {
  return right.rank - left.rank || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

/**
 * O plano do aluno (sem conteudo): os pop-ups no ar do segmento dele que ainda podem aparecer, na ordem (o
 * comeco da janela mais recente primeiro; sem comeco, a publicacao; empate pelo id). Nunca filtrado por
 * pagina nem por horizonte: o plano serve todas as paginas dos proximos 60 s.
 */
export function planPopups(input: { deliveries: readonly PopupCountState[]; live: readonly LivePopupRules[]; now: number }): PopupPlanItem[] {
  const { now } = input;
  const byCampaign = new Map(input.deliveries.map((delivery) => [delivery.campaignId, delivery] as const));
  const plan: PopupPlanItem[] = [];

  for (const popup of [...input.live].sort(byRank)) {
    if (!popupWindowOpen(popup, now)) {
      continue;
    }

    const delivery = byCampaign.get(popup.id);

    if (!delivery || !delivery.eligible) {
      continue;
    }

    const { frequency } = popup.settings;
    const verdict = frequencyVerdict(frequency, delivery, now);

    if (!verdict.allowed && verdict.nextAt === null) {
      continue;
    }

    plan.push({
      delaySeconds: popup.settings.delaySeconds,
      exclude: [...popup.settings.exclude],
      id: popup.id,
      notBefore: verdict.allowed || verdict.nextAt === null ? null : iso(verdict.nextAt),
      pages: [...popup.settings.pages],
      stopOn: frequency.mode === "once" ? null : frequency.stopOn,
      trigger: popup.settings.trigger
    });
  }

  return plan;
}

/**
 * Onde algum pop-up no ar pode aparecer: a uniao grossa das paginas (content:* e lesson:* no lugar dos ids,
 * que sao slugs legiveis dos titulos), ["any"] quando algum aparece em qualquer pagina. Excecoes ficam de
 * fora de proposito (superconjunto: um falso positivo custa uma leitura do plano a cada 60 s).
 */
export function pagesCovering(live: readonly LivePopupRules[], now: number): string[] {
  const patterns = new Set<string>();

  for (const popup of live) {
    if (popupWindowOpen(popup, now)) {
      popup.settings.pages.forEach((pattern) => patterns.add(coarsePagePattern(pattern)));
    }
  }

  return patterns.has("any") ? ["any"] : canonicalPatterns([...patterns]);
}
