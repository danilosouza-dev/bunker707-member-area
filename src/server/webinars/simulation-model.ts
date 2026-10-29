// A Simulacao completa, a parte pura (docs/30 §1.6, §3.5, §4.3, §6.6, §8.6, D6, D10, D25 e M6): o contador somado ao
// real, as entradas e saidas ("Ana M. entrou") e os avisos de venda de uma sessao gravada, calculados pelo offset do
// video e pela semente da sessao (webinar_sessions.simulation_seed), sempre do mesmo jeito: todos os alunos veem o mesmo
// numero e a mesma entrada no mesmo segundo, e o resumo congelado no fim (simulationTotals) e exatamente o que as
// janelas da sala mostraram de 0 ao fim. Nunca Math.random nem relogio: tudo recebe a semente e o offset. Os nomes vem
// da lista generica de WEBINAR_COPY.simulacao (nunca de alunos reais). Tambem: a frase da decisao de §8.6 montada e
// conferida igual no navegador e no servidor, e as contas da sala no navegador (a janela a pedir, a fusao das janelas,
// o numero do instante, a entrada e o aviso visiveis, o aviso anunciado ao leitor de tela).
//
// Sem "server-only", imports relativos: tests/webinarios-simulacao-modelo.test.mjs carrega direto pelo Node. Nenhum
// numero daqui entra numa metrica real, num CSV real ou numa regra da Comunicacao (D6, M6): os paineis, o relatorio e
// os segmentos nunca importam este arquivo (o teste confere).

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { saoPauloDate } from "../../lib/webinar-time";
import {
  CHAT_LIMITS,
  SIMULATION_LIMITS,
  defaultSimulatedCountRule,
  defaultSimulatedJoins,
  defaultSimulatedSaleNotices,
  toTime,
  type SessionKind,
  type SessionSimulation,
  type SessionStatus,
  type SimulatedCountRule,
  type SimulatedJoins,
  type SimulatedSaleNotices,
  type SimulationFeed,
  type SimulationTotals
} from "./model";
import { simulationAckSentenceV4, simulationDecisionRecorded, type SimulationAckInput } from "./simulation-ack";

/* ------------------------------------------------------------------------------------------------
 * Constantes
 * ---------------------------------------------------------------------------------------------- */

const STEP_MS = SIMULATION_LIMITS.counterStepSeconds * 1000;
const WINDOW_MS = SIMULATION_LIMITS.feedWindowSeconds * 1000;

/** O desenho da faixa ("Real + faixa que varia"): sobe nos primeiros 20 %, fica e desce 15 % da faixa nos ultimos 10 %. */
export const SIMULATION_CURVE = { fallShare: 0.15, fallStart: 0.9, riseEnd: 0.2 } as const;

/**
 * As entradas: uma por intervalo de `everySeconds`, na primeira metade do intervalo (o segundo exato sai da semente,
 * para o ritmo nao parecer de relogio); a saida opcional cai na segunda metade, a partir da 4a entrada, em 1 de cada 4
 * intervalos (pela semente), com o nome de quem entrou antes.
 */
export const SIMULATION_JOINS = { entryShare: 0.5, leaveChance: 0.25, leaveFromSlot: 3 } as const;

/** O que a sala mostra e por quanto tempo (docs/30 §1.6 e §1.7). */
export const SIMULATION_ROOM = {
  /** A linha "Ana M. entrou" fica 8 s acima do campo do chat (ou ate a proxima). */
  joinVisibleMs: 8_000,
  /** O aviso de venda fica 4 s por cima do palco. */
  saleVisibleMs: 4_000,
  /** O leitor de tela ouve no maximo um aviso de venda por minuto (nunca cada um; as entradas, nunca). */
  announceGapMs: 60_000,
  /** A janela seguinte e pedida 30 s antes do fim da atual (janelas de 120 s: uma a cada 90 s, como o chat). */
  windowLeadMs: 30_000,
  /** A primeira janela comeca 15 s antes do offset (o numero e a entrada que acabaram de passar). */
  backlogMs: 15_000,
  /** O que ficou mais de 5 min para tras sai da memoria da sala. */
  keepMs: 5 * 60_000,
  /** Sem nada ligado na sessao, a sala pergunta de novo so a cada 5 min (a equipe pode ligar durante a sessao). */
  idleRetryMs: 5 * 60_000,
  /** Depois de uma falha, a proxima tentativa em 30 s. */
  failureRetryMs: 30_000,
  /** A sala confere a janela a cada 5 s. */
  checkEveryMs: 5_000
} as const;

/** Os fluxos do gerador com semente (cada sorteio tem o seu: mudar um nao mexe nos outros). */
const STREAM = { counterJitter: 1, entryTime: 2, names: 3, leaveChance: 4, leaveName: 5, leaveTime: 6 } as const;

/* ------------------------------------------------------------------------------------------------
 * O gerador com semente
 * ---------------------------------------------------------------------------------------------- */

function mix32(value: number): number {
  let x = value | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Um numero em [0, 1) que so depende da semente, do fluxo e do indice (o mesmo no servidor e em qualquer maquina). */
export function seededUnit(seed: number, stream: number, index: number): number {
  const a = mix32(Math.trunc(seed) ^ Math.imul(stream + 1, 0x9e3779b1));
  const b = mix32(a ^ Math.imul(Math.trunc(index) + 1, 0x85ebca6b));
  return mix32(b ^ 0x27d4eb2d) / 4_294_967_296;
}

/* ------------------------------------------------------------------------------------------------
 * O contador
 * ---------------------------------------------------------------------------------------------- */

/** A forma da faixa de 0 a 1 ao longo da sessao (fracao da duracao em [0, 1)). */
function curveShape(fraction: number): number {
  const { fallShare, fallStart, riseEnd } = SIMULATION_CURVE;
  if (fraction < riseEnd) {
    const t = Math.max(0, fraction) / riseEnd;
    return 1 - (1 - t) * (1 - t);
  }
  if (fraction < fallStart) {
    return 1;
  }
  return 1 - fallShare * Math.min(1, (fraction - fallStart) / (1 - fallStart));
}

/**
 * A parte simulada do contador no offset (ms do video): "off" 0; "fixed" a base; "curve" de base ate peak nos
 * primeiros 20 % da duracao, fica e desce de leve nos ultimos 10 %, mais a variacao sorteada pela semente a cada 15 s
 * (de -jitter a +jitter). Um passo de 15 s tem um numero so (todos veem o mesmo); antes do zero vale o numero do zero;
 * do fim do video em diante, 0. Nunca negativo.
 */
export function counterExtraAt(rule: SimulatedCountRule, seed: number, offsetMs: number, durationMs: number): number {
  if (rule.mode === "off" || !Number.isFinite(offsetMs) || !(durationMs > 0) || offsetMs >= durationMs) {
    return 0;
  }
  const base = Math.max(0, Math.trunc(rule.base));
  if (rule.mode === "fixed") {
    return base;
  }
  const peak = Math.max(base, Math.trunc(rule.peak));
  const at = Math.max(0, Math.floor(offsetMs / STEP_MS) * STEP_MS);
  const step = at / STEP_MS;
  const value = base + (peak - base) * curveShape(at / durationMs);
  const jitter = Math.max(0, Math.trunc(rule.jitter));
  const noise = jitter > 0 ? Math.round((seededUnit(seed, STREAM.counterJitter, step) * 2 - 1) * jitter) : 0;
  return Math.max(0, Math.round(value) + noise);
}

/**
 * Os pontos do contador numa janela: um a cada 15 s, a partir do passo em que `fromMs` cai (o numero de `fromMs`). A
 * forma da faixa e sempre a do video inteiro (`durationMs`); `endMs` e o fim real (o Encerrar antecipado da equipe):
 * dali em diante, 0, sem espremer a curva no trecho que sobrou.
 */
export function counterPointsBetween(rule: SimulatedCountRule, seed: number, fromMs: number, toMs: number, durationMs: number, endMs: number = durationMs): { atMs: number; extra: number }[] {
  if (rule.mode === "off" || !(toMs >= fromMs)) {
    return [];
  }
  const points: { atMs: number; extra: number }[] = [];
  const last = Math.min(toMs, fromMs + WINDOW_MS);
  for (let at = Math.floor(fromMs / STEP_MS) * STEP_MS; at <= last; at += STEP_MS) {
    points.push({ atMs: at, extra: at >= endMs ? 0 : counterExtraAt(rule, seed, at, durationMs) });
  }
  return points;
}

/* ------------------------------------------------------------------------------------------------
 * As entradas e saidas
 * ---------------------------------------------------------------------------------------------- */

const NAMES: readonly string[] = WEBINAR_COPY.simulacao.nomesGenericos;

/** A ordem dos nomes num ciclo (Fisher-Yates com a semente do ciclo). */
function basePermutation(seed: number, cycle: number): number[] {
  const order = NAMES.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(seededUnit(seed, STREAM.names, cycle * 64 + index) * (index + 1));
    [order[index], order[pick]] = [order[pick], order[index]];
  }
  return order;
}

/** A ordem do ciclo, sem repetir o ultimo nome do ciclo anterior logo na virada. */
function permutation(seed: number, cycle: number): number[] {
  const order = basePermutation(seed, cycle);
  if (cycle > 0 && order.length > 2 && order[0] === basePermutation(seed, cycle - 1)[order.length - 1]) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
}

/** O nome generico da entrada n (nunca o mesmo duas vezes seguidas; os 20 nomes antes de repetir). */
export function simulatedNameFor(seed: number, slot: number): string {
  const cycle = Math.floor(slot / NAMES.length);
  return NAMES[permutation(seed, cycle)[slot % NAMES.length]] ?? NAMES[0];
}

/** Uma entrada ou saida simulada (a saida vem com `left`). */
export type SimulationJoinEvent = { atMs: number; left?: true; name: string };

/**
 * As entradas (e as saidas) de [fromMs, toMs] (inclusive), so dentro do video ([0, durationMs)): a entrada n cai no
 * intervalo n de `everySeconds`, de 0 ate `max` entradas. Desligado ou max 0: nenhuma.
 */
export function joinsBetween(joins: SimulatedJoins, seed: number, fromMs: number, toMs: number, durationMs: number): SimulationJoinEvent[] {
  if (!joins.enabled || joins.max <= 0 || !(durationMs > 0)) {
    return [];
  }
  const every = Math.max(SIMULATION_LIMITS.joinsEverySecondsMin, Math.trunc(joins.everySeconds)) * 1000;
  const low = Math.max(0, Math.ceil(fromMs));
  const high = Math.min(Math.floor(toMs), durationMs - 1);
  if (high < low) {
    return [];
  }
  const events: SimulationJoinEvent[] = [];
  const lastSlot = Math.min(Math.trunc(joins.max) - 1, Math.floor(high / every));
  for (let slot = Math.floor(low / every); slot <= lastSlot; slot += 1) {
    const start = slot * every;
    const entryAt = start + Math.floor(seededUnit(seed, STREAM.entryTime, slot) * every * SIMULATION_JOINS.entryShare);
    if (entryAt >= low && entryAt <= high) {
      events.push({ atMs: entryAt, name: simulatedNameFor(seed, slot) });
    }
    if (slot >= SIMULATION_JOINS.leaveFromSlot && seededUnit(seed, STREAM.leaveChance, slot) < SIMULATION_JOINS.leaveChance) {
      const half = every * SIMULATION_JOINS.entryShare;
      const leaveAt = start + Math.ceil(half) + Math.floor(seededUnit(seed, STREAM.leaveTime, slot) * (every - Math.ceil(half)));
      if (leaveAt >= low && leaveAt <= high) {
        const earlier = Math.floor(seededUnit(seed, STREAM.leaveName, slot) * slot);
        events.push({ atMs: leaveAt, left: true, name: simulatedNameFor(seed, earlier) });
      }
    }
  }
  return events;
}

/* ------------------------------------------------------------------------------------------------
 * Os avisos de venda
 * ---------------------------------------------------------------------------------------------- */

/** Os avisos de venda de [fromMs, toMs] (inclusive), so dentro do video, na ordem do minuto. Desligado: nenhum. */
export function saleNoticesBetween(notices: SimulatedSaleNotices, fromMs: number, toMs: number, durationMs: number): { atMs: number; text: string }[] {
  if (!notices.enabled || !(durationMs > 0)) {
    return [];
  }
  const low = Math.max(0, fromMs);
  const high = Math.min(toMs, durationMs - 1);
  return notices.items
    .filter((item) => item.offsetMs >= low && item.offsetMs <= high && item.text.trim().length > 0)
    .sort((a, b) => a.offsetMs - b.offsetMs)
    .map((item) => ({ atMs: item.offsetMs, text: item.text.trim() }));
}

/* ------------------------------------------------------------------------------------------------
 * A janela do aluno e o resumo do fim
 * ---------------------------------------------------------------------------------------------- */

/** Algo que a sala mostra esta ligado (o selo sozinho nao muda o contador nem o chat). */
export function simulationRulesOn(simulation: Pick<SessionSimulation, "countRule" | "joins" | "saleNotices">): boolean {
  return (
    simulation.countRule.mode !== "off" ||
    (simulation.joins.enabled && simulation.joins.max > 0) ||
    (simulation.saleNotices.enabled && simulation.saleNotices.items.length > 0)
  );
}

/**
 * A decisao registrada da sessao (docs/30 §8.6, D10): a frase marcada e a hora gravadas por saveSessionSimulation ou
 * copiadas pela sessao `jit` com a decisao. Sem ela, nada simulado aparece ao aluno nem entra no resumo, mesmo com a
 * regra gravada: uma regra que chegou sem a decisao (copia, edicao fora da tela) nunca vira numero na sala.
 */
export { simulationDecisionRecorded };

export function emptySimulationFeed(fromMs: number, toMs: number): SimulationFeed {
  return { counter: [], enabled: false, from: fromMs, joins: [], saleNotices: [], to: toMs };
}

/**
 * A sessao gravada ja comecou para a Simulacao (docs/30 §4.3 e §8.6): no ar, ou com a hora marcada (o zero do video)
 * ja passada, mesmo que o status ainda diga agendada (o tick abre a sessao ate 1 min depois). Dai em diante a regra
 * nao muda: o resumo do fim e o que a turma viu com a regra que valia.
 */
export function simulationSessionStarted(session: { scheduledAt: string; status: SessionStatus }, nowMs: number): boolean {
  if (session.status === "live" || session.status === "ended") {
    return true;
  }
  const zero = toTime(session.scheduledAt);
  return Number.isFinite(zero) && zero <= nowMs;
}

/**
 * O fim da sessao no relogio do video: a duracao do video, ou o instante em que a equipe encerrou antes (ended_at menos
 * a hora marcada, o zero da sessao gravada), o que vier primeiro.
 */
export function simulationEndOffsetMs(session: { endedAt: string | null; scheduledAt: string }, durationMs: number): number {
  const zero = toTime(session.scheduledAt);
  const ended = toTime(session.endedAt);
  if (!Number.isFinite(zero) || !Number.isFinite(ended)) {
    return Math.max(0, durationMs);
  }
  return Math.max(0, Math.min(durationMs, ended - zero));
}

/**
 * GET /api/webinars/[id]/simulation (docs/30 §6.6): o contador (so a parte simulada), as entradas e os avisos de venda
 * de [fromMs, toMs] (no maximo 120 s). So na sessao gravada com algo ligado; a live, o replay, a cancelada e a sessao
 * sem regra devolvem `enabled: false` e listas vazias. Nunca a semente nem as regras.
 */
export function simulationFeed(input: {
  /** A duracao do video (a forma da faixa do contador; nunca a cortada pelo Encerrar). */
  durationMs: number;
  /** O fim real no relogio do video (simulationEndOffsetMs); sem ele, o fim do video. */
  endMs?: number;
  fromMs: number;
  kind: SessionKind;
  simulation: SessionSimulation | null;
  status?: SessionStatus;
  toMs: number;
}): SimulationFeed {
  const { durationMs, fromMs, simulation } = input;
  if (input.kind !== "simulated" || input.status === "cancelled" || !simulation || !simulationRulesOn(simulation)) {
    return emptySimulationFeed(fromMs, input.toMs);
  }
  const toMs = Math.min(input.toMs, fromMs + WINDOW_MS);
  const endMs = Math.min(durationMs, input.endMs ?? durationMs);
  // Entradas e avisos so ate o fim real; o contador fica com a forma do video e zera depois do fim.
  const eventsTo = Math.min(toMs, endMs - 1);
  return {
    counter: counterPointsBetween(simulation.countRule, simulation.seed, fromMs, toMs, durationMs, endMs),
    enabled: true,
    from: fromMs,
    joins: joinsBetween(simulation.joins, simulation.seed, fromMs, eventsTo, durationMs),
    saleNotices: saleNoticesBetween(simulation.saleNotices, fromMs, eventsTo, durationMs),
    to: toMs
  };
}

/**
 * O que o fim da sessao congela em simulation_summary (docs/30 §3.5 e §4.3): o maior numero que o contador somou ao
 * real, quantas entradas e quantos avisos de venda apareceram de 0 ao fim real (`endMs`, cortado pelo Encerrar da
 * equipe em simulationEndOffsetMs), com a faixa do contador desenhada sobre o video inteiro (`videoMs`), como a sala
 * recebeu durante a sessao. E exatamente o que as janelas de simulationFeed mostraram nesse trecho (o teste de
 * propriedade confere); as saidas nao contam como entradas. Um numero so vale para os dois (o video inteiro).
 */
export function simulationTotals(simulation: Pick<SessionSimulation, "countRule" | "joins" | "saleNotices" | "seed">, span: number | { endMs: number; videoMs: number }): SimulationTotals {
  const videoMs = typeof span === "number" ? span : span.videoMs;
  const endMs = Math.min(videoMs, typeof span === "number" ? span : span.endMs);
  if (!(videoMs > 0) || !(endMs > 0)) {
    return { counterMax: 0, joinsShown: 0, saleNoticesShown: 0 };
  }
  let counterMax = 0;
  if (simulation.countRule.mode !== "off") {
    for (let at = 0; at < endMs; at += STEP_MS) {
      counterMax = Math.max(counterMax, counterExtraAt(simulation.countRule, simulation.seed, at, videoMs));
    }
  }
  return {
    counterMax,
    joinsShown: joinsBetween(simulation.joins, simulation.seed, 0, endMs - 1, videoMs).filter((event) => !event.left).length,
    saleNoticesShown: saleNoticesBetween(simulation.saleNotices, 0, endMs - 1, videoMs).length
  };
}

/* ------------------------------------------------------------------------------------------------
 * As regras salvas e a frase da decisao (§8.6, D10)
 * ---------------------------------------------------------------------------------------------- */

export type SimulationRules = {
  countRule: SimulatedCountRule;
  joins: SimulatedJoins;
  saleNotices: SimulatedSaleNotices;
  showLiveBadge: boolean;
};

/**
 * As regras na forma em que ficam gravadas (e comparaveis): "off" e "fixed" sem o que nao usam, as entradas e os avisos
 * desligados com o padrao, os avisos ligados sem nenhum item contam como desligados, os itens na ordem do minuto.
 */
export function normalizeSimulationRules(rules: SimulationRules): SimulationRules {
  const count = rules.countRule;
  const countRule: SimulatedCountRule =
    count.mode === "off"
      ? defaultSimulatedCountRule()
      : count.mode === "fixed"
        ? { base: count.base, jitter: 0, mode: "fixed", peak: count.base }
        : { base: count.base, jitter: count.jitter, mode: "curve", peak: Math.max(count.base, count.peak) };
  const joins: SimulatedJoins = rules.joins.enabled ? { enabled: true, everySeconds: rules.joins.everySeconds, max: rules.joins.max, names: "generic" } : defaultSimulatedJoins();
  const items = rules.saleNotices.items.map((item) => ({ offsetMs: item.offsetMs, text: item.text.trim() })).sort((a, b) => a.offsetMs - b.offsetMs);
  const saleNotices: SimulatedSaleNotices = rules.saleNotices.enabled && items.length > 0 ? { enabled: true, items } : defaultSimulatedSaleNotices();
  return { countRule, joins, saleNotices, showLiveBadge: rules.showLiveBadge };
}

/** O que a frase de §8.6 diz (o mesmo criterio de simulationNeedsAck em simulation-schemas.ts). */
export function simulationAckFlags(rules: SimulationRules): Omit<SimulationAckInput, "date" | "responsible"> {
  return {
    badgeOn: rules.showLiveBadge,
    countSimulated: rules.countRule.mode !== "off",
    joinsSimulated: rules.joins.enabled,
    saleNoticesSimulated: rules.saleNotices.enabled && rules.saleNotices.items.length > 0
  };
}

/** A frase de §8.6 para hoje (data de Sao Paulo) com o nome de quem decide. */
export function simulationAckFor(input: { nowMs: number; responsible: string; rules: SimulationRules }): string {
  return simulationAckSentenceV4({ ...simulationAckFlags(input.rules), date: saoPauloDate(new Date(input.nowMs).toISOString()), responsible: input.responsible });
}

/** Texto comparavel: NFC, aspas retas, um espaco so, sem espacos nas pontas. */
export function normalizeSimulationAck(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A frase marcada e a que o servidor montaria agora? Aceita a de hoje e a de ontem (a tela aberta antes da meia-noite),
 * com os espacos e as aspas normalizados. Qualquer outra diferenca (nome, selo, numeros, avisos) recusa.
 */
export function simulationAckMatches(input: { ackText: string | null | undefined; nowMs: number; responsible: string; rules: SimulationRules }): boolean {
  const given = normalizeSimulationAck(input.ackText ?? "");
  if (!given) {
    return false;
  }
  return [input.nowMs, input.nowMs - 86_400_000].some((nowMs) => normalizeSimulationAck(simulationAckFor({ nowMs, responsible: input.responsible, rules: input.rules })) === given);
}

/** A frase cabe na coluna (simulation_ack_text, CHAT_LIMITS.simulationAck). */
export function clampSimulationAck(text: string): string {
  return text.slice(0, CHAT_LIMITS.simulationAck);
}

/* ------------------------------------------------------------------------------------------------
 * Na sala (navegador): a janela a pedir, a fusao e o que aparece agora
 * ---------------------------------------------------------------------------------------------- */

export type SimulationWindow = { fromMs: number; toMs: number };

/** O que a sala guarda das janelas que ja chegaram. */
export type SimulationRoomData = {
  counter: { atMs: number; extra: number }[];
  enabled: boolean;
  joins: SimulationJoinEvent[];
  saleNotices: { atMs: number; text: string }[];
};

export const EMPTY_SIMULATION_ROOM: SimulationRoomData = { counter: [], enabled: false, joins: [], saleNotices: [] };

function boundedOffset(value: number): number {
  return Math.max(CHAT_LIMITS.offsetMinMs, Math.min(CHAT_LIMITS.offsetMaxMs - WINDOW_MS, Math.floor(value)));
}

/** A janela que comeca 15 s antes do offset (ao entrar ou depois de um salto). */
export function simulationWindowAt(offsetMs: number): SimulationWindow {
  const fromMs = boundedOffset(offsetMs - SIMULATION_ROOM.backlogMs);
  return { fromMs, toMs: fromMs + WINDOW_MS };
}

/**
 * Qual janela pedir agora: a primeira ao entrar; a seguinte (que comeca onde a anterior parou) quando o offset chega a
 * 30 s do fim da atual; de novo do offset quando ele passou da janela (aba congelada) ou voltou mais de uma janela para
 * tras (o relogio do aparelho corrigido de vez). A janela pedida antes da hora comeca ate 30 s a frente do offset: o
 * que vem antes dela ja chegou na anterior (a sala junta as janelas).
 */
export function simulationWindowToFetch(input: { current: SimulationWindow | null; offsetMs: number }): SimulationWindow | null {
  const { current, offsetMs } = input;
  if (!current || offsetMs > current.toMs || offsetMs < current.fromMs - WINDOW_MS) {
    return simulationWindowAt(offsetMs);
  }
  if (offsetMs >= current.toMs - SIMULATION_ROOM.windowLeadMs) {
    const fromMs = current.toMs + 1;
    return { fromMs, toMs: fromMs + WINDOW_MS };
  }
  return null;
}

const eventKey = (event: SimulationJoinEvent) => `${event.atMs}:${event.left ? "s" : "e"}:${event.name}`;

/** Junta a janela que chegou ao que a sala ja tinha: sem repetir, em ordem, sem o que ficou 5 min para tras. */
export function mergeSimulationFeed(previous: SimulationRoomData, feed: SimulationFeed, offsetMs: number): SimulationRoomData {
  if (!feed.enabled) {
    return EMPTY_SIMULATION_ROOM;
  }
  const oldest = offsetMs - SIMULATION_ROOM.keepMs;
  const counter = new Map<number, number>();
  for (const point of [...previous.counter, ...feed.counter]) {
    counter.set(point.atMs, point.extra);
  }
  const joins = new Map<string, SimulationJoinEvent>();
  for (const event of [...previous.joins, ...(feed.joins as SimulationJoinEvent[])]) {
    joins.set(eventKey(event), event.left ? { atMs: event.atMs, left: true, name: event.name } : { atMs: event.atMs, name: event.name });
  }
  const notices = new Map<string, { atMs: number; text: string }>();
  for (const notice of [...previous.saleNotices, ...feed.saleNotices]) {
    notices.set(`${notice.atMs}:${notice.text}`, notice);
  }
  const counterPoints = [...counter.entries()].map(([atMs, extra]) => ({ atMs, extra })).sort((a, b) => a.atMs - b.atMs);
  // Do contador fica o ultimo ponto antes do corte (o numero de agora pode vir dele).
  const firstKept = counterPoints.findIndex((point) => point.atMs >= oldest);
  return {
    counter: firstKept <= 0 ? counterPoints : counterPoints.slice(firstKept - 1),
    enabled: true,
    joins: [...joins.values()].filter((event) => event.atMs >= oldest).sort((a, b) => a.atMs - b.atMs),
    saleNotices: [...notices.values()].filter((notice) => notice.atMs >= oldest).sort((a, b) => a.atMs - b.atMs)
  };
}

/** A parte simulada do contador no offset (o ultimo ponto que ja passou); sem ponto, nulo (a sala mostra so o real). */
export function counterExtraFromPoints(points: readonly { atMs: number; extra: number }[], offsetMs: number): number | null {
  let found: number | null = null;
  for (const point of points) {
    if (point.atMs > offsetMs) {
      break;
    }
    found = point.extra;
  }
  if (found === null && points.length > 0 && offsetMs < points[0].atMs) {
    return points[0].extra;
  }
  return found;
}

/** A entrada (ou saida) que acabou de passar do offset e ainda aparece (8 s), ou nenhuma. */
export function visibleJoin(joins: readonly SimulationJoinEvent[], offsetMs: number): SimulationJoinEvent | null {
  let found: SimulationJoinEvent | null = null;
  for (const event of joins) {
    if (event.atMs > offsetMs) {
      break;
    }
    found = event;
  }
  return found && offsetMs - found.atMs < SIMULATION_ROOM.joinVisibleMs ? found : null;
}

/** O aviso de venda na tela agora (4 s a partir do minuto marcado), ou nenhum. */
export function visibleSaleNotice(notices: readonly { atMs: number; text: string }[], offsetMs: number): { atMs: number; text: string } | null {
  let found: { atMs: number; text: string } | null = null;
  for (const notice of notices) {
    if (notice.atMs > offsetMs) {
      break;
    }
    found = notice;
  }
  return found && offsetMs - found.atMs < SIMULATION_ROOM.saleVisibleMs ? found : null;
}

/**
 * O aviso que o leitor de tela ouviu por ultimo (aria-live polite): no maximo um por minuto, o primeiro de cada minuto;
 * os outros aparecem so na tela. A frase so muda quando um aviso novo entra na conta (assim nada e lido duas vezes).
 */
export function announcedSaleNotice(notices: readonly { atMs: number; text: string }[], offsetMs: number): { atMs: number; text: string } | null {
  let last: { atMs: number; text: string } | null = null;
  for (const notice of notices) {
    if (notice.atMs > offsetMs) {
      break;
    }
    if (!last || notice.atMs - last.atMs >= SIMULATION_ROOM.announceGapMs) {
      last = notice;
    }
  }
  return last;
}
