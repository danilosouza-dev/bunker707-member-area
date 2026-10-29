// "Comeca quando voce entra" (fase 4e; docs/30 §1.2, §1.6, §2.2, §2.7, A14 e D25), a parte pura. O horario de cada
// sessao e um limite de "a cada 15 / 30 / 60 min" no relogio de Sao Paulo dentro da janela de horas [inicio, fim) da
// equipe (o inicio da janela e sempre um limite: 15, 30 e 60 dividem a hora); a turma e quem entrou no mesmo horario
// (A14). Daqui saem:
// - nextJitSlot: o horario atual (o ultimo limite ja passado dentro da janela, de hoje ou de ontem perto da meia-noite)
//   e se ele ainda aceita entrada (a Entrada atrasada da sessao que nasce, a mesma conta de canJoinSimulated: nulo =
//   ate o fim do video; com minutos, ate aquele minuto), o proximo horario (o seguinte de hoje ou o inicio da janela de
//   um dos proximos dias, ate JIT_LIMITS.lookaheadDays), os minutos ate la e se a sala dele ja abriu (15 min antes,
//   ROOM_OPENS_MINUTES_BEFORE, como as outras sessoes gravadas);
// - jitEntryChoice: o que a rota POST /api/webinars/[id]/jit usa (o atual quando ainda aceita, senao o proximo quando a
//   sala dele ja abriu; fora disso, nada: a sala recusaria com "ainda nao comecou");
// - jitPageState: o que a pagina do aluno mostra agora ("A sessao das {hora} ja comecou", "A proxima sessao comeca em
//   {n} min" com o Entrar, ou fora do horario); o navegador refaz a conta a cada 15 s com os mesmos numeros;
// - withJitPublishProblems: a Live gravada com o just-in-time ligado publica sem hora marcada (so com o video);
// - jitDayRange e jitSummary: o dia de Sao Paulo das "Sessoes que nasceram hoje" e a frase da Revisao.
// Sem "server-only", imports relativos: tests/webinarios-jit-modelo.test.mjs carrega direto pelo Node e a pagina do
// aluno roda isto no navegador. Nada aqui le o banco nem o relogio: tudo recebe `nowMs`.

import { JIT_COPY } from "../../lib/webinar-copy-v4/jit";
import { WEBINAR_TIME_ZONE, saoPauloTime } from "../../lib/webinar-time";
import { JIT_LIMITS, type JitSettings, type SessionStatus, type WebinarKind } from "./model";
import { ROOM_OPENS_MINUTES_BEFORE } from "./room-model";

const MINUTE_MS = 60_000;

/** O que a conta do horario usa das regras (webinars.jit_settings). */
export type JitClockSettings = Pick<JitSettings, "endHour" | "everyMinutes" | "lateJoinMinutes" | "startHour">;

/** Um dia do calendario de Sao Paulo. */
export type SaoPauloDate = { day: number; month: number; year: number };

/* ------------------------------------------------------------------------------------------------
 * O relogio de Sao Paulo (Intl; sem horario de verao hoje, mas a conta nao supoe isso)
 * ---------------------------------------------------------------------------------------------- */

const WALL_FORMAT = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: WEBINAR_TIME_ZONE,
  year: "numeric"
});

/** O dia e o minuto do dia (0 a 1439) de um instante no relogio de Sao Paulo. */
export function saoPauloWallClock(ms: number): SaoPauloDate & { minuteOfDay: number } {
  const parts = WALL_FORMAT.formatToParts(new Date(ms));
  const pick = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? Number.NaN);
  return { day: pick("day"), minuteOfDay: (pick("hour") % 24) * 60 + pick("minute"), month: pick("month"), year: pick("year") };
}

/** Quanto o relogio de Sao Paulo esta a frente da UTC naquele instante (ms; -3 h hoje). */
function saoPauloOffsetMs(ms: number): number {
  const wall = saoPauloWallClock(ms);
  return Date.UTC(wall.year, wall.month - 1, wall.day, 0, wall.minuteOfDay) - Math.floor(ms / MINUTE_MS) * MINUTE_MS;
}

/** O instante (ms) de um minuto do dia de Sao Paulo: a hora de parede menos o fuso daquele instante (duas passadas). */
export function saoPauloWallToMs(date: SaoPauloDate, minuteOfDay: number): number {
  const wall = Date.UTC(date.year, date.month - 1, date.day, 0, minuteOfDay);
  const first = wall - saoPauloOffsetMs(wall);
  return wall - saoPauloOffsetMs(first);
}

function addDays(date: SaoPauloDate, days: number): SaoPauloDate {
  const moved = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { day: moved.getUTCDate(), month: moved.getUTCMonth() + 1, year: moved.getUTCFullYear() };
}

function todayOf(nowMs: number): SaoPauloDate {
  const wall = saoPauloWallClock(nowMs);
  return { day: wall.day, month: wall.month, year: wall.year };
}

/** O dia de Sao Paulo de `nowMs` como intervalo [inicio, fim) em ISO (as sessoes que nasceram hoje). */
export function jitDayRange(nowMs: number): { fromIso: string; toIso: string } {
  const today = todayOf(nowMs);
  return { fromIso: new Date(saoPauloWallToMs(today, 0)).toISOString(), toIso: new Date(saoPauloWallToMs(addDays(today, 1), 0)).toISOString() };
}

/* ------------------------------------------------------------------------------------------------
 * Os horarios
 * ---------------------------------------------------------------------------------------------- */

/** As regras usaveis: a janela dentro de 0 a 24 h e o fim depois do inicio (o zod ja garante; o navegador nao confia). */
function windowOf(settings: JitClockSettings): { end: number; every: number; start: number } | null {
  const every = settings.everyMinutes;
  const start = Math.trunc(settings.startHour) * 60;
  const end = Math.trunc(settings.endHour) * 60;
  if (!(every > 0) || !Number.isFinite(start) || !Number.isFinite(end) || start < JIT_LIMITS.hourMin * 60 || end > JIT_LIMITS.hourMax * 60 || end <= start) {
    return null;
  }
  return { end, every, start };
}

/** Os horarios (ms, em ordem) de um dia de Sao Paulo dentro da janela de horas. */
export function jitSlotsOfDay(settings: JitClockSettings, date: SaoPauloDate): number[] {
  const window = windowOf(settings);
  if (!window) {
    return [];
  }
  const slots: number[] = [];
  for (let minute = window.start; minute < window.end; minute += window.every) {
    slots.push(saoPauloWallToMs(date, minute));
  }
  return slots;
}

/** Se `ms` e um horario das regras (a rota so cria sessao num horario de verdade). */
export function isJitSlot(settings: JitClockSettings, ms: number): boolean {
  return Number.isFinite(ms) && jitSlotsOfDay(settings, todayOf(ms)).includes(ms);
}

export type JitSlot = { atMs: number; iso: string };

export type JitSlotInfo = {
  /** O ultimo horario ja comecado (dentro da janela), aceite ou nao entrada; nulo antes do primeiro. */
  current: JitSlot | null;
  /** O horario atual ainda aceita entrada (Entrada atrasada e o fim do video, como canJoinSimulated). */
  currentAcceptsEntry: boolean;
  /** Minutos ate o proximo horario (arredondado para cima; 1 no ultimo minuto); nulo sem proximo. */
  minutesUntilNext: number | null;
  /** O proximo horario (estritamente depois de agora); nulo quando a janela nao cabe nos proximos dias. */
  next: JitSlot | null;
  /** A sala do proximo horario ja abre (15 min antes, como as outras sessoes gravadas). */
  nextRoomOpen: boolean;
  /** O proximo horario e o seguinte da sequencia (ate `everyMinutes` a frente): as sessoes estao correndo agora. */
  running: boolean;
};

const slotOf = (atMs: number): JitSlot => ({ atMs, iso: new Date(atMs).toISOString() });

/**
 * O horario de agora e o proximo (docs/30 §1.6 e A14). `durationMs` e a duracao do video (a gravacao, senao a prevista
 * do webinario): o horario atual so aceita entrada antes do fim dele e, com a Entrada atrasada em minutos, ate aquele
 * minuto (nulo = ate o fim, como na sessao marcada).
 */
export function nextJitSlot(input: { durationMs?: number | null; nowMs: number; settings: JitClockSettings }): JitSlotInfo {
  const { nowMs, settings } = input;
  const empty: JitSlotInfo = { current: null, currentAcceptsEntry: false, minutesUntilNext: null, next: null, nextRoomOpen: false, running: false };
  if (!Number.isFinite(nowMs) || !windowOf(settings)) {
    return empty;
  }
  const today = todayOf(nowMs);
  let current: number | null = null;
  for (const slot of [...jitSlotsOfDay(settings, addDays(today, -1)), ...jitSlotsOfDay(settings, today)]) {
    if (slot <= nowMs && (current === null || slot > current)) {
      current = slot;
    }
  }
  let next: number | null = null;
  for (let day = 0; day <= JIT_LIMITS.lookaheadDays && next === null; day += 1) {
    next = jitSlotsOfDay(settings, addDays(today, day)).find((slot) => slot > nowMs) ?? null;
  }

  let currentAcceptsEntry = false;
  if (current !== null) {
    const offset = nowMs - current;
    const duration = input.durationMs ?? null;
    const beforeEnd = duration === null || !Number.isFinite(duration) || duration <= 0 || offset < duration;
    const beforeLateJoin = settings.lateJoinMinutes == null || offset <= settings.lateJoinMinutes * MINUTE_MS;
    currentAcceptsEntry = beforeEnd && beforeLateJoin;
  }

  const untilNext = next === null ? null : next - nowMs;
  return {
    current: current === null ? null : slotOf(current),
    currentAcceptsEntry,
    minutesUntilNext: untilNext === null ? null : Math.max(1, Math.ceil(untilNext / MINUTE_MS)),
    next: next === null ? null : slotOf(next),
    nextRoomOpen: untilNext !== null && untilNext <= ROOM_OPENS_MINUTES_BEFORE * MINUTE_MS,
    running: untilNext !== null && untilNext <= settings.everyMinutes * MINUTE_MS
  };
}

export type JitEntryChoice = { slot: JitSlot; which: "current" | "next" };

/**
 * O horario de quem acabou de chegar (a rota): o atual quando ainda aceita entrada, senao o proximo quando a sala dele
 * ja abriu; fora disso, nulo (a pagina mostra a contagem e o Entrar liga sozinho 15 min antes).
 */
export function jitEntryChoice(info: JitSlotInfo): JitEntryChoice | null {
  if (info.current && info.currentAcceptsEntry) {
    return { slot: info.current, which: "current" };
  }
  if (info.next && info.nextRoomOpen) {
    return { slot: info.next, which: "next" };
  }
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * A pagina do aluno
 * ---------------------------------------------------------------------------------------------- */

/**
 * O que a pagina mostra agora: `current` (a sessao das {hora} ja comecou e ainda aceita entrada: Entrar), `next` (A
 * proxima sessao comeca em {n} min; o Entrar liga quando a sala abre, `roomOpen`) ou `closed` (fora do horario: as
 * sessoes abrem a partir de {hora}).
 */
export type JitPageState =
  | { kind: "closed"; nextIso: string | null; opensLabel: string }
  | { kind: "current"; slotIso: string; timeLabel: string }
  | { kind: "next"; minutes: number; roomOpen: boolean; slotIso: string; timeLabel: string };

export function jitPageState(input: { durationMs?: number | null; nowMs: number; settings: JitClockSettings }): JitPageState {
  const info = nextJitSlot(input);
  if (info.current && info.currentAcceptsEntry) {
    return { kind: "current", slotIso: info.current.iso, timeLabel: saoPauloTime(info.current.iso) };
  }
  if (info.next && info.running) {
    return { kind: "next", minutes: info.minutesUntilNext ?? 1, roomOpen: info.nextRoomOpen, slotIso: info.next.iso, timeLabel: saoPauloTime(info.next.iso) };
  }
  return { kind: "closed", nextIso: info.next?.iso ?? null, opensLabel: JIT_COPY.card.horaDe(Math.trunc(input.settings.startHour)) };
}

/** A frase de agora (docs/30 §2.7): "A próxima sessão começa em {n} min" e as outras duas. */
export function jitPageSentence(state: JitPageState): string {
  switch (state.kind) {
    case "current":
      return JIT_COPY.aluno.sessaoJaComecou(state.timeLabel);
    case "next":
      return JIT_COPY.aluno.proximaSessaoEm(state.minutes);
    default:
      return JIT_COPY.aluno.foraDoHorario(state.opensLabel);
  }
}

/** O Entrar liga: a sessao atual ainda aceita, ou a sala do proximo horario ja abriu. */
export function jitCanEnter(state: JitPageState): boolean {
  return state.kind === "current" || (state.kind === "next" && state.roomOpen);
}

/* ------------------------------------------------------------------------------------------------
 * O resto do app
 * ---------------------------------------------------------------------------------------------- */

/** Uma sessao `jit` que nasceu hoje, como o card Sessoes do editor mostra (a hora e a situacao; o console pelo id). */
export type JitSessionSummary = { id: string; scheduledAt: string; status: SessionStatus };

/** A sessao nasceu pelo just-in-time (o editor, a lista, a faixa e os lembretes nunca mexem nela). */
export function isJitSession(session: { jit?: boolean | null }): boolean {
  return session.jit === true;
}

/** O just-in-time vale para este webinario (so a Live gravada, ligado). */
export function jitActive(kind: WebinarKind, settings: Pick<JitSettings, "enabled"> | null | undefined): boolean {
  return kind === "simulated" && settings?.enabled === true;
}

/**
 * O que falta para publicar com o just-in-time ligado (docs/30 §2.2): a Live gravada publica sem hora marcada (as
 * sessoes nascem quando os alunos chegam); o video continua obrigatorio. Sem o just-in-time, a lista fica como veio.
 */
export function withJitPublishProblems<T extends { path: string }>(problems: readonly T[], input: { jit: Pick<JitSettings, "enabled"> | null | undefined; kind: WebinarKind }): T[] {
  if (!jitActive(input.kind, input.jit)) {
    return [...problems];
  }
  return problems.filter((problem) => problem.path !== "sessions");
}

/** "Começa quando você entra: a cada 15 min, das 08:00 às 23:00 (horário de Brasília)" (a Revisao do editor). */
export function jitSummary(settings: Pick<JitSettings, "endHour" | "everyMinutes" | "startHour">): string {
  return JIT_COPY.card.resumo(settings.everyMinutes, JIT_COPY.card.horaDe(settings.startHour), JIT_COPY.card.horaDe(settings.endHour));
}
