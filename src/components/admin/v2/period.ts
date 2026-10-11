// Periodo global do admin (docs/17 §1.4): Hoje · 1d · 3d · 7d · 30d ou um intervalo de datas do calendario.
//
// Modulo puro (sem React nem "use client"): as paginas do servidor, o seletor da barra superior e
// tests/admin-period.test.mjs usam as mesmas funcoes. Toda conta de "dia" usa o fuso da escola
// (America/Sao_Paulo) por Intl, nunca o fuso da maquina, para servidor e navegador chegarem aos mesmos
// limites. Os textos sao montados com tabelas proprias (meses e dias da semana) em vez do Intl, para o
// HTML do servidor e o do navegador serem identicos na hidratacao.
//
// Endereco (um unico parametro, para todo codigo que ja carrega ?periodo= entre abas continuar valendo):
//   ?periodo=hoje | 1d | 3d | 7d | 30d           presets (30d e o padrao e some do endereco)
//   ?periodo=2026-10-01..2026-10-10               intervalo, datas inclusivas no fuso da escola
//   ?periodo=2026-10-05                           um dia so (aceito na leitura; a escrita usa sempre "..")
//   ?periodo=7 | 30 | 90                          links antigos: 7d, 30d e o intervalo dos ultimos 90 dias
// Qualquer outro valor cai no padrao (30d), sem erro.
//
// Regras de cada preset:
//   hoje  desde 00:00 de hoje ate agora; comparado com ontem de 00:00 ate a mesma hora.
//   1d    as ultimas 24 horas corridas; comparado com as 24 horas anteriores.
//   Nd    N dias de calendario terminando hoje (hoje entra, ate agora): 7d = hoje + 6 dias inteiros antes.
//         Comparado com os N dias anteriores ate a mesma hora, para o dia de hoje (incompleto) nao
//         parecer uma queda e cada dia do grafico ter o mesmo dia da semana na comparacao.
//   intervalo  de 00:00 da data inicial ate 24:00 da final; se a final e hoje, ate agora (e a comparacao
//         corta na mesma hora). Periodo anterior: os N dias imediatamente antes.

import { ADMIN_PERIOD_PARAM } from "./filters";
import { ADMIN_TIME_ZONE } from "./format";

/* ------------------------------------------------------------------------------------------------
 * Tipos e constantes
 * ---------------------------------------------------------------------------------------------- */

/** Data de calendario no fuso da escola, "AAAA-MM-DD". */
export type CivilDate = string;

export const ADMIN_PERIOD_PRESETS = ["hoje", "1d", "3d", "7d", "30d"] as const;
export type AdminPeriodPreset = (typeof ADMIN_PERIOD_PRESETS)[number];
export const DEFAULT_ADMIN_PERIOD_PRESET: AdminPeriodPreset = "30d";

export type AdminPresetPeriod = { kind: "preset"; preset: AdminPeriodPreset };
export type AdminRangePeriod = { from: CivilDate; kind: "range"; to: CivilDate };
export type AdminPeriod = AdminPresetPeriod | AdminRangePeriod;

export const DEFAULT_ADMIN_PERIOD_VALUE: AdminPresetPeriod = { kind: "preset", preset: DEFAULT_ADMIN_PERIOD_PRESET };

/** Primeiro dia que o calendario oferece. */
export const ADMIN_PERIOD_MIN_DATE: CivilDate = "2020-01-01";
/** Maior intervalo personalizado, contando a data inicial e a final (um ano bissexto inteiro cabe). */
export const ADMIN_PERIOD_MAX_DAYS = 366;
/** Periodos de ate 3 dias de calendario viram graficos por hora (no maximo 72 pontos); acima, por dia. */
export const ADMIN_PERIOD_HOURLY_MAX_DAYS = 3;
/** Separador do intervalo no endereco (como na busca do GitHub: created:2026-10-01..2026-10-10). */
export const ADMIN_PERIOD_RANGE_SEPARATOR = "..";

export type AdminPeriodGranularity = "hour" | "day";

/** Uma janela de tempo: instantes [start, end) e os dias de calendario que ela toca, no fuso da escola. */
export type AdminPeriodWindow = {
  end: Date;
  from: CivilDate;
  start: Date;
  to: CivilDate;
};

export type ResolvedAdminPeriod = AdminPeriodWindow & {
  /** Rotulo para leitores de tela e titulos, com o mes por extenso: "1 a 10 de outubro de 2026". */
  accessibleLabel: string;
  /** Rodape dos numeros: "vs. 7 dias anteriores", "vs. ontem até a mesma hora". */
  comparisonLabel: string;
  /** Tamanho nominal em dias: hoje e 1d valem 1; 7d vale 7; um intervalo, os dias contando as pontas. */
  days: number;
  /** true quando o periodo termina agora (os numeros ainda mudam); false num intervalo ja fechado. */
  endsNow: boolean;
  granularity: AdminPeriodGranularity;
  /** No meio de uma frase: "hoje", "nas últimas 24 horas", "nos últimos 7 dias", "de 1 a 10 de out. de 2026". */
  inlineLabel: string;
  isDefault: boolean;
  /** Titulo do periodo: "Hoje", "Últimas 24 horas", "Últimos 7 dias", "1 a 10 de out. de 2026". */
  label: string;
  /** Valor canonico de ?periodo= (inclusive o padrao "30d"); serve de `key` para reiniciar estado. */
  param: string;
  period: AdminPeriod;
  /** Mesmo tamanho, imediatamente antes (ou N dias antes, cortado na mesma hora, se o periodo termina agora). */
  previous: AdminPeriodWindow;
  /** Dias do periodo anterior: "21 a 30 de set. de 2026". */
  previousLabel: string;
  /** Texto do botao: "Hoje", "1d", "30d", "1–10 out.". */
  shortLabel: string;
};

type SearchParamValue = string | string[] | null | undefined;
type SearchParamsRecord = Record<string, string | string[] | undefined>;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

type PresetMeta = {
  comparisonLabel: string;
  days: number;
  inlineLabel: string;
  label: string;
  shortLabel: string;
};

const PRESET_META: Record<AdminPeriodPreset, PresetMeta> = {
  hoje: {
    comparisonLabel: "vs. ontem até a mesma hora",
    days: 1,
    inlineLabel: "hoje",
    label: "Hoje",
    shortLabel: "Hoje"
  },
  "1d": {
    comparisonLabel: "vs. 24 horas anteriores",
    days: 1,
    inlineLabel: "nas últimas 24 horas",
    label: "Últimas 24 horas",
    shortLabel: "1d"
  },
  "3d": {
    comparisonLabel: "vs. 3 dias anteriores",
    days: 3,
    inlineLabel: "nos últimos 3 dias",
    label: "Últimos 3 dias",
    shortLabel: "3d"
  },
  "7d": {
    comparisonLabel: "vs. 7 dias anteriores",
    days: 7,
    inlineLabel: "nos últimos 7 dias",
    label: "Últimos 7 dias",
    shortLabel: "7d"
  },
  "30d": {
    comparisonLabel: "vs. 30 dias anteriores",
    days: 30,
    inlineLabel: "nos últimos 30 dias",
    label: "Últimos 30 dias",
    shortLabel: "30d"
  }
};

export type AdminPeriodPresetOption = { label: string; preset: AdminPeriodPreset; shortLabel: string };

/** Pilulas do seletor, na ordem da barra: Hoje · 1d · 3d · 7d · 30d. */
export const ADMIN_PERIOD_PRESET_OPTIONS: readonly AdminPeriodPresetOption[] = ADMIN_PERIOD_PRESETS.map((preset) => ({
  label: PRESET_META[preset].label,
  preset,
  shortLabel: PRESET_META[preset].shortLabel
}));

const MONTHS_SHORT = ["jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.", "nov.", "dez."];
const MONTHS_LONG = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro"
];
const WEEKDAYS_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/* ------------------------------------------------------------------------------------------------
 * Datas de calendario (AAAA-MM-DD), sem fuso
 * ---------------------------------------------------------------------------------------------- */

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function splitCivil(civil: CivilDate) {
  const [year, month, day] = civil.split("-").map(Number);

  return { day, month, year };
}

function civilToUtcMs(civil: CivilDate) {
  const { day, month, year } = splitCivil(civil);

  return Date.UTC(year, month - 1, day);
}

function pad(value: number, size = 2) {
  return String(value).padStart(size, "0");
}

function toCivil(year: number, month: number, day: number): CivilDate {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

function utcMsToCivil(ms: number): CivilDate {
  const date = new Date(ms);

  return toCivil(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

/** "AAAA-MM-DD" que existe no calendario (2024-02-29 sim, 2026-02-29 nao). */
export function isCivilDate(value: unknown): value is CivilDate {
  if (typeof value !== "string") {
    return false;
  }

  const match = CIVIL_DATE_PATTERN.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function addCivilDays(civil: CivilDate, days: number): CivilDate {
  return utcMsToCivil(civilToUtcMs(civil) + Math.trunc(days) * DAY_MS);
}

/** Dias de `from` ate `to` (2026-10-01 -> 2026-10-10 = 9). Negativo quando `to` vem antes. */
export function diffCivilDays(from: CivilDate, to: CivilDate) {
  return Math.round((civilToUtcMs(to) - civilToUtcMs(from)) / DAY_MS);
}

/** Dias contando as duas pontas (2026-10-01 a 2026-10-10 = 10). */
export function countCivilDays(from: CivilDate, to: CivilDate) {
  return diffCivilDays(from, to) + 1;
}

export function compareCivilDates(left: CivilDate, right: CivilDate) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Primeiro dia do mes `months` meses depois (negativo: antes). */
export function addCivilMonths(civil: CivilDate, months: number): CivilDate {
  const { month, year } = splitCivil(civil);
  const index = year * 12 + (month - 1) + Math.trunc(months);

  return toCivil(Math.floor(index / 12), (index % 12) + 1, 1);
}

function lastDayOfMonth(civil: CivilDate): CivilDate {
  return addCivilDays(addCivilMonths(civil, 1), -1);
}

function weekdayOf(civil: CivilDate) {
  return new Date(civilToUtcMs(civil)).getUTCDay();
}

/* ------------------------------------------------------------------------------------------------
 * Fuso da escola (America/Sao_Paulo) por Intl
 * ---------------------------------------------------------------------------------------------- */

const zonedFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  second: "2-digit",
  timeZone: ADMIN_TIME_ZONE,
  year: "numeric"
});

type ZonedParts = { day: number; hour: number; minute: number; month: number; second: number; year: number };

function zonedParts(instant: number): ZonedParts {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};

  for (const part of zonedFormatter.formatToParts(new Date(instant))) {
    if (part.type !== "literal") {
      values[part.type] = Number(part.value);
    }
  }

  return {
    day: values.day ?? 1,
    // Alguns motores ainda escrevem meia-noite como "24" mesmo com h23.
    hour: (values.hour ?? 0) % 24,
    minute: values.minute ?? 0,
    month: values.month ?? 1,
    second: values.second ?? 0,
    year: values.year ?? 1970
  };
}

/** Diferenca (ms) entre o relogio da escola e o UTC naquele instante. */
function zoneOffsetAt(instant: number) {
  const parts = zonedParts(instant);
  const wallClockAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);

  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

/** Instante em que o relogio da escola marca aquela data e hora. */
function zonedToInstant(civil: CivilDate, hour = 0, minute = 0, second = 0, ms = 0) {
  const { day, month, year } = splitCivil(civil);
  const guess = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const guessOffset = zoneOffsetAt(guess);
  const candidate = guess - guessOffset;
  const candidateOffset = zoneOffsetAt(candidate);

  return candidateOffset === guessOffset ? candidate : guess - candidateOffset;
}

function civilOfInstant(instant: number): CivilDate {
  const parts = zonedParts(instant);

  return toCivil(parts.year, parts.month, parts.day);
}

/** Data de calendario daquele instante no fuso da escola. */
export function getAdminCivilDate(instant: Date): CivilDate {
  return civilOfInstant(instant.getTime());
}

/** "Hoje" no fuso da escola (o mesmo no servidor e no navegador, em qualquer fuso da maquina). */
export function getAdminToday(now: Date): CivilDate {
  return civilOfInstant(now.getTime());
}

/** 00:00 daquela data no fuso da escola. */
export function startOfAdminDay(civil: CivilDate): Date {
  return new Date(zonedToInstant(civil));
}

/** O mesmo horario do relogio da escola, `days` dias de calendario antes ou depois. */
function shiftByCivilDays(instant: number, days: number) {
  const parts = zonedParts(instant);
  const ms = ((instant % 1000) + 1000) % 1000;
  const civil = addCivilDays(toCivil(parts.year, parts.month, parts.day), days);

  return zonedToInstant(civil, parts.hour, parts.minute, parts.second, ms);
}

function floorToZonedHour(instant: number) {
  const parts = zonedParts(instant);

  return zonedToInstant(toCivil(parts.year, parts.month, parts.day), parts.hour);
}

/** Chave do balde do grafico: "2026-10-05" por dia ou "2026-10-05T14" por hora, no fuso da escola. */
export function getAdminBucketKey(instant: Date, granularity: AdminPeriodGranularity) {
  const parts = zonedParts(instant.getTime());
  const civil = toCivil(parts.year, parts.month, parts.day);

  return granularity === "day" ? civil : `${civil}T${pad(parts.hour)}`;
}

/* ------------------------------------------------------------------------------------------------
 * Textos
 * ---------------------------------------------------------------------------------------------- */

function capitalize(text: string) {
  return text.charAt(0).toLocaleUpperCase("pt-BR") + text.slice(1);
}

/**
 * Intervalo por extenso: "5 de out. de 2026", "1 a 10 de out. de 2026", "28 de set. a 10 de out. de 2026",
 * "28 de dez. de 2025 a 3 de jan. de 2026". Com `month: "long"`, o mes vai por extenso.
 */
export function formatAdminDateRange(from: CivilDate, to: CivilDate, options: { month?: "long" | "short" } = {}) {
  const months = options.month === "long" ? MONTHS_LONG : MONTHS_SHORT;
  const start = splitCivil(from);
  const end = splitCivil(to);
  const endText = `${end.day} de ${months[end.month - 1]} de ${end.year}`;

  if (from === to) {
    return endText;
  }

  if (start.year !== end.year) {
    return `${start.day} de ${months[start.month - 1]} de ${start.year} a ${endText}`;
  }

  if (start.month !== end.month) {
    return `${start.day} de ${months[start.month - 1]} a ${endText}`;
  }

  return `${start.day} a ${endText}`;
}

/**
 * Intervalo curto para o botao: "5 out.", "1–10 out.", "28 set.–10 out.". O ano so aparece quando
 * nao e o ano de hoje: "1–10 out. 2025", "28 dez. 2025–3 jan. 2026".
 */
export function formatAdminDateRangeShort(from: CivilDate, to: CivilDate, now: Date) {
  const currentYear = splitCivil(getAdminToday(now)).year;
  const start = splitCivil(from);
  const end = splitCivil(to);
  const crossesYear = start.year !== end.year;
  const showYear = crossesYear || end.year !== currentYear;
  const yearSuffix = showYear ? ` ${end.year}` : "";
  const endText = `${end.day} ${MONTHS_SHORT[end.month - 1]}${yearSuffix}`;

  if (from === to) {
    return endText;
  }

  if (crossesYear) {
    return `${start.day} ${MONTHS_SHORT[start.month - 1]} ${start.year}–${endText}`;
  }

  if (start.month !== end.month) {
    return `${start.day} ${MONTHS_SHORT[start.month - 1]}–${endText}`;
  }

  return `${start.day}–${endText}`;
}

/** "1 dia", "10 dias". */
export function formatAdminDayCount(days: number) {
  return days === 1 ? "1 dia" : `${days} dias`;
}

function rangeTexts(from: CivilDate, to: CivilDate, now: Date) {
  const days = countCivilDays(from, to);
  const label = formatAdminDateRange(from, to);

  return {
    accessibleLabel: formatAdminDateRange(from, to, { month: "long" }),
    comparisonLabel: days === 1 ? "vs. dia anterior" : `vs. ${days} dias anteriores`,
    inlineLabel: from === to ? `em ${label}` : `de ${label}`,
    label,
    shortLabel: formatAdminDateRangeShort(from, to, now)
  };
}

/* ------------------------------------------------------------------------------------------------
 * Endereco: leitura
 * ---------------------------------------------------------------------------------------------- */

function firstValue(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

function isPreset(value: string): value is AdminPeriodPreset {
  return (ADMIN_PERIOD_PRESETS as readonly string[]).includes(value);
}

export type AdminPeriodRangeProblem = "invalid" | "inverted" | "before-min" | "future" | "too-long";

export type AdminPeriodRangeValidation =
  | { days: number; ok: true; period: AdminRangePeriod }
  | { message: string; ok: false; reason: AdminPeriodRangeProblem };

const RANGE_PROBLEM_MESSAGES: Record<AdminPeriodRangeProblem, string> = {
  "before-min": "Escolha datas a partir de janeiro de 2020.",
  future: "Escolha datas até hoje.",
  invalid: "Escolha a data inicial e a final.",
  inverted: "A data final precisa ser igual ou depois da inicial.",
  "too-long": `Escolha no máximo ${ADMIN_PERIOD_MAX_DAYS} dias.`
};

/**
 * Confere um intervalo do calendario (ou do endereco): datas reais, inicial <= final, a partir de
 * 2020-01-01, final ate hoje no fuso da escola e no maximo 366 dias contando as pontas.
 */
export function validateAdminPeriodRange(
  from: string | null | undefined,
  to: string | null | undefined,
  now: Date
): AdminPeriodRangeValidation {
  const problem = (reason: AdminPeriodRangeProblem): AdminPeriodRangeValidation => ({
    message: RANGE_PROBLEM_MESSAGES[reason],
    ok: false,
    reason
  });

  if (!isCivilDate(from) || !isCivilDate(to)) {
    return problem("invalid");
  }

  if (compareCivilDates(from, to) > 0) {
    return problem("inverted");
  }

  if (compareCivilDates(from, ADMIN_PERIOD_MIN_DATE) < 0) {
    return problem("before-min");
  }

  if (compareCivilDates(to, getAdminToday(now)) > 0) {
    return problem("future");
  }

  const days = countCivilDays(from, to);

  if (days > ADMIN_PERIOD_MAX_DAYS) {
    return problem("too-long");
  }

  return { days, ok: true, period: { from, kind: "range", to } };
}

/**
 * Le ?periodo= e devolve null quando ele falta ou e invalido. Serve para telas em que "sem periodo"
 * quer dizer outra coisa (a fila da Comunidade mostra tudo o que esta aberto).
 */
export function parseAdminPeriodParamStrict(value: SearchParamValue, now: Date): AdminPeriod | null {
  const raw = firstValue(value)?.trim().toLowerCase() ?? "";

  if (!raw) {
    return null;
  }

  if (isPreset(raw)) {
    return { kind: "preset", preset: raw };
  }

  // Links antigos (pilulas 7 · 30 · 90 dias).
  if (raw === "7" || raw === "30") {
    return { kind: "preset", preset: `${raw}d` as AdminPeriodPreset };
  }

  if (raw === "90") {
    const today = getAdminToday(now);

    return { from: addCivilDays(today, -89), kind: "range", to: today };
  }

  const pieces = raw.split(ADMIN_PERIOD_RANGE_SEPARATOR);

  if (pieces.length > 2) {
    return null;
  }

  const result = validateAdminPeriodRange(pieces[0], pieces[1] ?? pieces[0], now);

  return result.ok ? result.period : null;
}

/** Le ?periodo=; ausente ou invalido vira o padrao (ultimos 30 dias), sem erro. */
export function parseAdminPeriodParam(value: SearchParamValue, now: Date): AdminPeriod {
  return parseAdminPeriodParamStrict(value, now) ?? DEFAULT_ADMIN_PERIOD_VALUE;
}

/* ------------------------------------------------------------------------------------------------
 * Endereco: escrita
 * ---------------------------------------------------------------------------------------------- */

/** Valor canonico de ?periodo=: "hoje", "7d", "2026-10-01..2026-10-10" (um dia: "2026-10-05..2026-10-05"). */
export function formatAdminPeriodParam(period: AdminPeriod) {
  return period.kind === "preset" ? period.preset : `${period.from}${ADMIN_PERIOD_RANGE_SEPARATOR}${period.to}`;
}

export function isDefaultAdminPeriod(period: AdminPeriod) {
  return period.kind === "preset" && period.preset === DEFAULT_ADMIN_PERIOD_PRESET;
}

export function isSameAdminPeriod(left: AdminPeriod, right: AdminPeriod) {
  return formatAdminPeriodParam(left) === formatAdminPeriodParam(right);
}

type SearchParamsLike = Pick<URLSearchParams, "get" | "toString">;

/** URLSearchParams ou o ReadonlyURLSearchParams do Next (useSearchParams), sem depender de instanceof. */
function isSearchParamsLike(value: unknown): value is SearchParamsLike {
  return typeof value === "object" && value !== null && typeof (value as SearchParamsLike).get === "function";
}

function toSearchParams(current: SearchParamsLike | SearchParamsRecord | string | null | undefined) {
  if (current === null || current === undefined) {
    return new URLSearchParams();
  }

  if (typeof current === "string" || isSearchParamsLike(current)) {
    return new URLSearchParams(current.toString());
  }

  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(current)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, entry);
    }
  }

  return params;
}

/**
 * Endereco da mesma tela com outro periodo, mantendo ?produto= e os demais parametros. O padrao (30d)
 * some do endereco. Trocar o periodo volta para a primeira pagina (?pagina= sai), como os outros filtros.
 */
export function buildAdminPeriodHref(
  pathname: string,
  current: SearchParamsLike | SearchParamsRecord | string | null | undefined,
  period: AdminPeriod
) {
  const params = toSearchParams(current);

  params.delete(ADMIN_PERIOD_PARAM);
  params.delete("pagina");

  if (!isDefaultAdminPeriod(period)) {
    params.set(ADMIN_PERIOD_PARAM, formatAdminPeriodParam(period));
  }

  const query = params.toString();

  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Endereco do menu Periodo. `period = null` e a opcao "Tudo" (telas como a fila da Comunidade, em que
 * sem ?periodo= a tela mostra tudo): tira o parametro. Nessas telas (`hasAllOption`), o padrao (30d)
 * fica escrito no endereco, senao escolher "Últimos 30 dias" viraria "Tudo".
 */
export function buildAdminPeriodMenuHref(
  pathname: string,
  current: SearchParamsLike | SearchParamsRecord | string | null | undefined,
  period: AdminPeriod | null,
  hasAllOption = false
) {
  if (period === null) {
    const params = toSearchParams(current);

    params.delete(ADMIN_PERIOD_PARAM);
    params.delete("pagina");

    const query = params.toString();

    return query ? `${pathname}?${query}` : pathname;
  }

  const href = buildAdminPeriodHref(pathname, current, period);

  if (!hasAllOption || !isDefaultAdminPeriod(period)) {
    return href;
  }

  return `${href}${href.includes("?") ? "&" : "?"}${ADMIN_PERIOD_PARAM}=${formatAdminPeriodParam(period)}`;
}

/* ------------------------------------------------------------------------------------------------
 * Resolucao: instantes, periodo anterior, granularidade e rotulos
 * ---------------------------------------------------------------------------------------------- */

function makeWindow(start: number, end: number, from: CivilDate, to: CivilDate): AdminPeriodWindow {
  return { end: new Date(end), from, start: new Date(start), to };
}

/**
 * Transforma o periodo escolhido em instantes e textos, a partir de `now` (passe o mesmo `now` para
 * tudo o que for calculado na mesma tela).
 */
export function resolveAdminPeriod(period: AdminPeriod, now: Date): ResolvedAdminPeriod {
  const nowMs = now.getTime();
  const today = civilOfInstant(nowMs);
  const param = formatAdminPeriodParam(period);
  const isDefault = isDefaultAdminPeriod(period);

  if (period.kind === "preset" && period.preset === "1d") {
    const meta = PRESET_META["1d"];
    const start = nowMs - DAY_MS;
    const previousStart = start - DAY_MS;
    const previousFrom = civilOfInstant(previousStart);
    const previousTo = civilOfInstant(start);

    return {
      ...makeWindow(start, nowMs, civilOfInstant(start), today),
      accessibleLabel: meta.label,
      comparisonLabel: meta.comparisonLabel,
      days: meta.days,
      endsNow: true,
      granularity: "hour",
      inlineLabel: meta.inlineLabel,
      isDefault,
      label: meta.label,
      param,
      period,
      previous: makeWindow(previousStart, start, previousFrom, previousTo),
      previousLabel: formatAdminDateRange(previousFrom, previousTo),
      shortLabel: meta.shortLabel
    };
  }

  // Periodos alinhados ao calendario: hoje, 3d, 7d, 30d e intervalos.
  const from = period.kind === "range" ? period.from : addCivilDays(today, -(PRESET_META[period.preset].days - 1));
  const to = period.kind === "range" ? period.to : today;
  const days = countCivilDays(from, to);
  const start = zonedToInstant(from);
  const endsNow = compareCivilDates(to, today) >= 0;
  const end = endsNow ? Math.max(start, nowMs) : zonedToInstant(addCivilDays(to, 1));
  const previousFrom = addCivilDays(from, -days);
  const previousTo = addCivilDays(to, -days);
  const texts = period.kind === "range" ? rangeTexts(from, to, now) : PRESET_META[period.preset];

  return {
    ...makeWindow(start, end, from, to),
    accessibleLabel: "accessibleLabel" in texts ? texts.accessibleLabel : texts.label,
    comparisonLabel: texts.comparisonLabel,
    days,
    endsNow,
    granularity: days <= ADMIN_PERIOD_HOURLY_MAX_DAYS ? "hour" : "day",
    inlineLabel: texts.inlineLabel,
    isDefault,
    label: texts.label,
    param,
    period,
    previous: makeWindow(zonedToInstant(previousFrom), shiftByCivilDays(end, -days), previousFrom, previousTo),
    previousLabel: formatAdminDateRange(previousFrom, previousTo),
    shortLabel: texts.shortLabel
  };
}

/** Atalho das paginas do servidor: le ?periodo= e resolve com o mesmo `now`. */
export function readAdminPeriod(searchParams: SearchParamsLike | SearchParamsRecord, now: Date): ResolvedAdminPeriod {
  const value = isSearchParamsLike(searchParams) ? searchParams.get(ADMIN_PERIOD_PARAM) : searchParams[ADMIN_PERIOD_PARAM];

  return resolveAdminPeriod(parseAdminPeriodParam(value, now), now);
}

/* ------------------------------------------------------------------------------------------------
 * Baldes dos graficos (um ponto por hora ou por dia, sem buracos)
 * ---------------------------------------------------------------------------------------------- */

export type AdminPeriodBucket = {
  /** Mesmo formato de getAdminBucketKey: "2026-10-05" ou "2026-10-05T14". */
  key: string;
  /** Eixo: "05/10" por dia; "14h" (periodo de um dia) ou "05/10 14h" por hora. */
  label: string;
  /** Dica do grafico: "Domingo, 5 de outubro" ou "Domingo, 5 de outubro, 14h". */
  longLabel: string;
  start: Date;
};

function dayAxisLabel(civil: CivilDate) {
  const { day, month } = splitCivil(civil);

  return `${pad(day)}/${pad(month)}`;
}

function dayLongLabel(civil: CivilDate, withYear: boolean) {
  const { day, month, year } = splitCivil(civil);
  const text = `${WEEKDAYS_LONG[weekdayOf(civil)]}, ${day} de ${MONTHS_LONG[month - 1]}${withYear ? ` de ${year}` : ""}`;

  return capitalize(text);
}

/**
 * Todos os baldes do periodo (ou do periodo anterior, alinhado ponto a ponto), na ordem do tempo.
 * Por dia: um por data de `from` a `to`. Por hora: da hora cheia do inicio ate a hora em curso.
 */
export function listAdminPeriodBuckets(resolved: ResolvedAdminPeriod, which: "current" | "previous" = "current"): AdminPeriodBucket[] {
  const window = which === "previous" ? resolved.previous : resolved;
  const withYear = window.from.slice(0, 4) !== window.to.slice(0, 4);

  if (resolved.granularity === "day") {
    const buckets: AdminPeriodBucket[] = [];

    for (let civil = window.from; compareCivilDates(civil, window.to) <= 0; civil = addCivilDays(civil, 1)) {
      buckets.push({ key: civil, label: dayAxisLabel(civil), longLabel: dayLongLabel(civil, withYear), start: startOfAdminDay(civil) });
    }

    return buckets;
  }

  const buckets: AdminPeriodBucket[] = [];
  const end = window.end.getTime();
  const singleDay = window.from === window.to;
  let cursor = floorToZonedHour(window.start.getTime());

  do {
    const parts = zonedParts(cursor);
    const civil = toCivil(parts.year, parts.month, parts.day);
    const hour = `${parts.hour}h`;

    buckets.push({
      key: `${civil}T${pad(parts.hour)}`,
      label: singleDay ? hour : `${dayAxisLabel(civil)} ${hour}`,
      longLabel: `${dayLongLabel(civil, withYear)}, ${hour}`,
      start: new Date(cursor)
    });
    cursor += HOUR_MS;
  } while (cursor < end);

  return buckets;
}

/* ------------------------------------------------------------------------------------------------
 * Calendario do seletor
 * ---------------------------------------------------------------------------------------------- */

export type AdminPeriodCalendarBounds = {
  maxDays: number;
  /** Primeira data que pode ser escolhida. */
  min: CivilDate;
  /** Hoje no fuso da escola: datas depois dele ficam desativadas. */
  today: CivilDate;
};

export function getAdminPeriodCalendarBounds(now: Date): AdminPeriodCalendarBounds {
  return { maxDays: ADMIN_PERIOD_MAX_DAYS, min: ADMIN_PERIOD_MIN_DATE, today: getAdminToday(now) };
}

/**
 * Primeiro mes a mostrar para que o ultimo dos `numberOfMonths` meses seja o de `to`
 * (2 meses lado a lado terminando no mes da data final), sem passar de janeiro de 2020.
 */
export function getAdminCalendarStartMonth(to: CivilDate, numberOfMonths: number): CivilDate {
  const first = addCivilMonths(to, -(Math.max(1, Math.trunc(numberOfMonths)) - 1));

  return compareCivilDates(first, ADMIN_PERIOD_MIN_DATE) < 0 ? ADMIN_PERIOD_MIN_DATE : first;
}

/**
 * Ponte com o calendario (react-day-picker sem `timeZone`), que trabalha com datas locais do navegador:
 * meio-dia local daquela data. A volta usa os mesmos campos locais, entao o fuso da maquina se anula.
 */
export function civilDateToPickerDate(civil: CivilDate): Date {
  const { day, month, year } = splitCivil(civil);
  const date = new Date(2000, 0, 1, 12);

  date.setFullYear(year, month - 1, day);

  return date;
}

export function pickerDateToCivilDate(date: Date | null | undefined): CivilDate | null {
  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return toCivil(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export type AdminPeriodShortcut = { id: "este-mes" | "mes-passado" | "90-dias" | "este-ano"; label: string; period: AdminRangePeriod };

/** Atalhos ao lado do calendario. Todos cabem no limite de 366 dias. */
export function getAdminPeriodShortcuts(now: Date): AdminPeriodShortcut[] {
  const today = getAdminToday(now);
  const monthStart = addCivilMonths(today, 0);
  const previousMonthStart = addCivilMonths(today, -1);

  return [
    { id: "este-mes", label: "Este mês", period: { from: monthStart, kind: "range", to: today } },
    { id: "mes-passado", label: "Mês passado", period: { from: previousMonthStart, kind: "range", to: lastDayOfMonth(previousMonthStart) } },
    { id: "90-dias", label: "Últimos 90 dias", period: { from: addCivilDays(today, -89), kind: "range", to: today } },
    { id: "este-ano", label: "Este ano", period: { from: `${today.slice(0, 4)}-01-01`, kind: "range", to: today } }
  ];
}
