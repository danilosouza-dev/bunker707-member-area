// A Simulacao completa, a parte pura (docs/30 §1.6, §3.5, §4.3, §6.6, §8.6, D6, D10, D25 e M6): o contador somado ao
// real, as entradas e saidas ("Ana M. entrou") e os avisos de venda de uma sessao gravada, calculados pelo offset do
// video e pela semente da sessao (webinar_sessions.simulation_seed), sempre do mesmo jeito: todos os alunos veem o mesmo
// numero e a mesma entrada no mesmo segundo, e o resumo congelado no fim (simulationTotals) e exatamente o que as
// janelas da sala mostraram de 0 ao fim. Nunca Math.random nem relogio: tudo recebe a semente e o offset. Os nomes vem
// da lista generica de WEBINAR_COPY.simulacao (nunca de alunos reais). Tambem: a frase da decisao de §8.6 montada e
// conferida igual no navegador e no servidor, e as contas da sala no navegador (a janela a pedir, a fusao das janelas,
// o numero do instante, a entrada e o aviso visiveis, o aviso anunciado ao leitor de tela).
//
// A Live ao vivo (adendo de 10/11/2026, R7) usa as mesmas contas com o zero no started_at (o "Começar para todos"):
// antes dele, na espera, o offset e negativo e vale o que a gravada faz antes da hora marcada (o numero do zero, sem
// entradas nem avisos); a forma da faixa e a da duracao prevista do webinario e, passada ela, o numero fica no do fim
// da forma ate o Encerrar live (a live pode passar do previsto); as entradas e os avisos so param no Encerrar
// (simulationFeed e simulationTotals com `kind: "live"`). A frase da decisao da live e simulationAckSentenceLive.
//
// Os participantes simulados mudados a qualquer momento (docs/30 D79, pedido do produtor de 11/11/2026): o contador
// passa a ter mudancas no tempo (SessionSimulation.countChanges, da tabela webinar_simulation_changes). Cada mudanca
// vale a partir do offset dela no relogio da Simulacao e nao pula de uma vez: sobe ou desce em linha reta em 90 s
// (SIMULATION_LIMITS.countRampSeconds), saindo do numero que a turma via no ponto de 15 s da mudanca, sempre igual para
// todos (countTimelineOf, timelineExtraAt). A janela da sala, o numero do console e o resumo do fim usam a mesma conta,
// entao o resumo junta os trechos de cada regra (D80). A frase de cada mudanca e a da decisao com o numero novo
// (simulationAudienceAckFor). As entradas e os avisos de venda continuam travados no ar.
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
  simulatedCountVaryOf,
  toTime,
  type SessionKind,
  type SessionSimulation,
  type SessionStatus,
  type SimulatedCountRule,
  type SimulatedCountVary,
  type SimulationCountChange,
  type SimulatedJoins,
  type SimulatedSaleNotices,
  type SimulationFeed,
  type SimulationTotals
} from "./model";
import { simulationAckSentenceLive, simulationAckSentenceV4, simulationDecisionRecorded, type SimulationAckInput } from "./simulation-ack";

/* ------------------------------------------------------------------------------------------------
 * Constantes
 * ---------------------------------------------------------------------------------------------- */

const STEP_MS = SIMULATION_LIMITS.counterStepSeconds * 1000;
const WINDOW_MS = SIMULATION_LIMITS.feedWindowSeconds * 1000;
const RAMP_MS = SIMULATION_LIMITS.countRampSeconds * 1000;

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
const STREAM = { counterJitter: 1, entryTime: 2, names: 3, leaveChance: 4, leaveName: 5, leaveTime: 6, varyTime: 7, varyValue: 8 } as const;

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

/* "Variar sozinho" (rodada v9, docs/30 D90): o numero fixo que sobe e desce sozinho, pela semente. */

/**
 * A hora da mudanca `index` do "Variar sozinho", em ms do relogio da Simulacao. As mudancas ficam numa grade de passo
 * igual a media do intervalo ((min + max) / 2), cada uma deslocada pela semente em ate um quarto da folga (max - min)
 * para cada lado: a distancia entre duas seguidas fica sempre entre o minimo e o maximo, e a hora de qualquer uma sai
 * direto do indice (sem somar as anteriores). Igual para todos os alunos.
 */
export function varyChangeAtMs(vary: SimulatedCountVary, seed: number, index: number): number {
  const minMs = vary.everyMinSeconds * 1000;
  const maxMs = Math.max(minMs, vary.everyMaxSeconds * 1000);
  const period = (minMs + maxMs) / 2;
  const spread = (maxMs - minMs) / 2;
  return Math.round(index * period + (seededUnit(seed, STREAM.varyTime, index) - 0.5) * spread);
}

/** O indice da ultima mudanca do "Variar sozinho" que ja caiu no offset (pode ser -1: antes da primeira). */
export function varyIndexAt(vary: SimulatedCountVary, seed: number, offsetMs: number): number {
  const period = ((vary.everyMinSeconds + Math.max(vary.everyMinSeconds, vary.everyMaxSeconds)) * 1000) / 2;
  let index = Math.floor(offsetMs / period) + 1;
  while (varyChangeAtMs(vary, seed, index) > offsetMs) {
    index -= 1;
  }
  return index;
}

/** Ate quanto o numero se afasta do fixo: `percent` % dele, arredondado (300 e 5 %: 15). */
export function varyDelta(base: number, vary: Pick<SimulatedCountVary, "percent">): number {
  return Math.round((Math.max(0, Math.trunc(base)) * vary.percent) / 100);
}

/** A faixa em que o numero fica ("Com +300 e 5%, o número fica entre 285 e 315."). */
export function varyRange(base: number, vary: Pick<SimulatedCountVary, "direction" | "percent">): { max: number; min: number } {
  const fixed = Math.max(0, Math.trunc(base));
  const delta = varyDelta(fixed, vary);
  return { max: vary.direction === "down" ? fixed : fixed + delta, min: vary.direction === "up" ? fixed : Math.max(0, fixed - delta) };
}

/** O numero fixo com o "Variar sozinho" no offset: o fixo mais o desvio sorteado pela semente para a mudanca em curso. */
function variedExtraAt(base: number, vary: SimulatedCountVary, seed: number, offsetMs: number): number {
  const unit = seededUnit(seed, STREAM.varyValue, varyIndexAt(vary, seed, Math.max(0, offsetMs)));
  const share = vary.direction === "both" ? unit * 2 - 1 : vary.direction === "up" ? unit : -unit;
  return Math.max(0, base + Math.round(share * varyDelta(base, vary)));
}

/**
 * A parte simulada do contador no offset (ms do video): "off" 0; "fixed" a base (com o "Variar sozinho", a base mais o
 * desvio da mudanca em curso, D90); "curve" de base ate peak nos
 * primeiros 20 % da duracao, fica e desce de leve nos ultimos 10 %, mais a variacao sorteada pela semente a cada 15 s
 * (de -jitter a +jitter). Um passo de 15 s tem um numero so (todos veem o mesmo); antes do zero vale o numero do zero;
 * do fim do video em diante, 0. Nunca negativo. `hold` (a Live ao vivo, R7): passada a duracao prevista, o numero fica
 * no do fim da forma (a live pode durar mais que o previsto; quem para e o Encerrar live, pelo `endMs` de quem chama).
 */
export function counterExtraAt(rule: SimulatedCountRule, seed: number, offsetMs: number, durationMs: number, hold = false): number {
  if (rule.mode === "off" || !Number.isFinite(offsetMs) || !(durationMs > 0) || (!hold && offsetMs >= durationMs)) {
    return 0;
  }
  const base = Math.max(0, Math.trunc(rule.base));
  if (rule.mode === "fixed") {
    const vary = simulatedCountVaryOf(rule);
    return vary ? variedExtraAt(base, vary, seed, offsetMs) : base;
  }
  const peak = Math.max(base, Math.trunc(rule.peak));
  const at = Math.max(0, Math.floor(offsetMs / STEP_MS) * STEP_MS);
  const step = at / STEP_MS;
  const value = base + (peak - base) * curveShape(Math.min(1, at / durationMs));
  const jitter = Math.max(0, Math.trunc(rule.jitter));
  const noise = jitter > 0 ? Math.round((seededUnit(seed, STREAM.counterJitter, step) * 2 - 1) * jitter) : 0;
  return Math.max(0, Math.round(value) + noise);
}

/**
 * Os pontos do contador numa janela: um a cada 15 s, a partir do passo em que `fromMs` cai (o numero de `fromMs`). A
 * forma da faixa e sempre a do video inteiro (`durationMs`); `endMs` e o fim real (o Encerrar antecipado da equipe):
 * dali em diante, 0, sem espremer a curva no trecho que sobrou. `hold`: o da Live ao vivo (counterExtraAt).
 */
export function counterPointsBetween(
  rule: SimulatedCountRule,
  seed: number,
  fromMs: number,
  toMs: number,
  durationMs: number,
  endMs: number = durationMs,
  hold = false
): { atMs: number; extra: number }[] {
  if (rule.mode === "off" || !(toMs >= fromMs)) {
    return [];
  }
  const last = Math.min(toMs, fromMs + WINDOW_MS);
  const first = Math.floor(fromMs / STEP_MS) * STEP_MS;
  return pointTimesBetween(first, last, [{ fromMs: Number.NEGATIVE_INFINITY, rule }], seed).map((at) => ({ atMs: at, extra: at >= endMs ? 0 : counterExtraAt(rule, seed, at, durationMs, hold) }));
}

/**
 * As horas dos pontos do contador em [firstMs, lastMs] (`firstMs` ja na grade): um a cada 15 s, mais a hora exata de
 * cada mudanca do "Variar sozinho" (D90) nos trechos em que a regra que vale tem a variacao (`spans`, na ordem: cada
 * regra vale de `fromMs` ate o comeco da seguinte). Em ordem, sem repetir. E a mesma lista para a janela da sala e
 * para o resumo do fim: o resumo e exatamente o que as janelas mostraram.
 */
function pointTimesBetween(firstMs: number, lastMs: number, spans: readonly { fromMs: number; rule: SimulatedCountRule }[], seed: number): number[] {
  const times = new Set<number>();
  for (let at = firstMs; at <= lastMs; at += STEP_MS) {
    times.add(at);
  }
  spans.forEach((span, index) => {
    const vary = simulatedCountVaryOf(span.rule);
    if (!vary) {
      return;
    }
    const from = Math.max(firstMs, span.fromMs, 0);
    const to = Math.min(lastMs, (spans[index + 1]?.fromMs ?? Number.POSITIVE_INFINITY) - 1);
    if (!(to >= from)) {
      return;
    }
    for (let k = varyIndexAt(vary, seed, from); ; k += 1) {
      const at = varyChangeAtMs(vary, seed, k);
      if (at > to) {
        break;
      }
      if (at >= from) {
        times.add(at);
      }
    }
  });
  return [...times].sort((a, b) => a - b);
}

/* ------------------------------------------------------------------------------------------------
 * Os participantes simulados mudados no ar (D79): o contador com mudancas no tempo
 * ---------------------------------------------------------------------------------------------- */

/** Uma mudanca pronta para a conta: o numero de onde a rampa sai (`fromExtra`, o que a turma via na mudanca). */
type TimelineChange = SimulationCountChange & { fromExtra: number };

/** O contador de uma sessao com as mudancas no ar, pronto para pedir o numero de qualquer offset. */
export type CountTimeline = {
  base: SimulatedCountRule;
  changes: readonly TimelineChange[];
  durationMs: number;
  hold: boolean;
  seed: number;
};

/** As mudancas validas (offset finito, de 0 em diante), na ordem do relogio; a ordem gravada desempata. */
export function sortedCountChanges(changes: readonly SimulationCountChange[] | undefined): SimulationCountChange[] {
  return (changes ?? [])
    .map((change, index) => ({ change, index }))
    .filter(({ change }) => Number.isFinite(change.atMs) && change.atMs >= 0)
    .sort((a, b) => a.change.atMs - b.change.atMs || a.index - b.index)
    .map(({ change }) => ({ atMs: Math.floor(change.atMs), rule: change.rule }));
}

/** A ultima mudanca que ja vale no offset (o indice em `changes`, na ordem do relogio), ou -1. */
function changeIndexAt(changes: readonly { atMs: number }[], offsetMs: number): number {
  let found = -1;
  for (let index = 0; index < changes.length; index += 1) {
    if (changes[index].atMs > offsetMs) {
      break;
    }
    found = index;
  }
  return found;
}

/** O numero no offset com as mudancas dadas (a rampa de cada uma sai do `fromExtra` dela). */
function extraWithChanges(head: Omit<CountTimeline, "changes">, changes: readonly TimelineChange[], offsetMs: number): number {
  const { durationMs, hold, seed } = head;
  if (!Number.isFinite(offsetMs) || !(durationMs > 0) || (!hold && offsetMs >= durationMs)) {
    return 0;
  }
  const index = changeIndexAt(changes, offsetMs);
  if (index < 0) {
    return counterExtraAt(head.base, seed, offsetMs, durationMs, hold);
  }
  const change = changes[index];
  const target = counterExtraAt(change.rule, seed, offsetMs, durationMs, hold);
  const progress = (offsetMs - change.atMs) / RAMP_MS;
  if (progress >= 1) {
    return target;
  }
  return Math.max(0, Math.round(change.fromExtra + (target - change.fromExtra) * progress));
}

/**
 * O contador da sessao com as mudancas no ar (D79). Cada mudanca sai do numero que a turma via no ponto de 15 s em que
 * ela caiu (contando as mudancas de antes dela) e chega na regra nova em 90 s, em linha reta. Sem mudancas, e a regra
 * de sempre (timelineExtraAt igual a counterExtraAt). `hold`: o da Live ao vivo (counterExtraAt).
 */
export function countTimelineOf(simulation: Pick<SessionSimulation, "countChanges" | "countRule" | "seed">, durationMs: number, hold = false): CountTimeline {
  const head = { base: simulation.countRule, durationMs, hold, seed: simulation.seed };
  const changes: TimelineChange[] = [];
  for (const change of sortedCountChanges(simulation.countChanges)) {
    // O ultimo ponto que a sala recebeu ate a mudanca: o de 15 s ou, com o "Variar sozinho" valendo, a ultima mudanca dele.
    const times = pointTimesBetween(Math.floor(change.atMs / STEP_MS) * STEP_MS, change.atMs, timelineSpans(head.base, changes), head.seed);
    changes.push({ ...change, fromExtra: extraWithChanges(head, changes, times[times.length - 1]) });
  }
  return { ...head, changes };
}

/** Os trechos de cada regra na ordem do relogio: a de antes do comeco e a de cada mudanca, do offset dela em diante. */
function timelineSpans(base: SimulatedCountRule, changes: readonly { atMs: number; rule: SimulatedCountRule }[]): { fromMs: number; rule: SimulatedCountRule }[] {
  return [{ fromMs: Number.NEGATIVE_INFINITY, rule: base }, ...changes.map((change) => ({ fromMs: change.atMs, rule: change.rule }))];
}

/** As horas dos pontos do contador da sessao em [firstMs, lastMs] (pointTimesBetween com os trechos da sessao). */
function timelinePointTimes(timeline: CountTimeline, firstMs: number, lastMs: number): number[] {
  return pointTimesBetween(firstMs, lastMs, timelineSpans(timeline.base, timeline.changes), timeline.seed);
}

/** A parte simulada do contador no offset, com as mudancas no ar (a rampa de 90 s de cada uma). Nunca negativo. */
export function timelineExtraAt(timeline: CountTimeline, offsetMs: number): number {
  return extraWithChanges(timeline, timeline.changes, offsetMs);
}

/** Algum trecho do contador soma algo: a regra de antes do comeco ou uma das mudancas. */
export function countTimelineOn(simulation: Pick<SessionSimulation, "countChanges" | "countRule">): boolean {
  return simulation.countRule.mode !== "off" || (simulation.countChanges ?? []).some((change) => change.rule.mode !== "off");
}

/** Os pontos do contador numa janela, com as mudancas (o mesmo passo de counterPointsBetween; 0 do fim real em diante). */
export function timelinePointsBetween(timeline: CountTimeline, fromMs: number, toMs: number, endMs: number = timeline.durationMs): { atMs: number; extra: number }[] {
  if (!countTimelineOn({ countChanges: [...timeline.changes], countRule: timeline.base }) || !(toMs >= fromMs)) {
    return [];
  }
  const last = Math.min(toMs, fromMs + WINDOW_MS);
  return timelinePointTimes(timeline, Math.floor(fromMs / STEP_MS) * STEP_MS, last).map((at) => ({ atMs: at, extra: at >= endMs ? 0 : timelineExtraAt(timeline, at) }));
}

/** A regra que vale no offset (a da ultima mudanca que ja caiu, senao a de antes do comeco): o "+300" do console. */
export function simulationAudienceRuleAt(simulation: Pick<SessionSimulation, "countChanges" | "countRule">, offsetMs: number): SimulatedCountRule {
  const changes = sortedCountChanges(simulation.countChanges);
  const index = Number.isFinite(offsetMs) ? changeIndexAt(changes, offsetMs) : -1;
  return index >= 0 ? changes[index].rule : simulation.countRule;
}

/** Ate que offset a rampa da ultima mudanca anda (a sala chega no numero novo); nulo sem rampa em curso. */
export function simulationAudienceRampEndMs(simulation: Pick<SessionSimulation, "countChanges">, offsetMs: number): number | null {
  const changes = sortedCountChanges(simulation.countChanges);
  const index = Number.isFinite(offsetMs) ? changeIndexAt(changes, offsetMs) : -1;
  if (index < 0) {
    return null;
  }
  const end = changes[index].atMs + RAMP_MS;
  return offsetMs < end ? end : null;
}

/**
 * A regra de uma mudanca do console ou do card: "Real + número fixo" com o +N; 0 e "Só o real" (o Tirar). Com o
 * "Variar sozinho" (D90), a regra leva a variacao (so quando vale: o numero maior que zero, dentro dos limites).
 */
export function simulationAudienceRule(extra: number, vary?: SimulatedCountVary | null): SimulatedCountRule {
  const base = Math.max(0, Math.min(SIMULATION_LIMITS.countMax, Math.trunc(Number.isFinite(extra) ? extra : 0)));
  if (!(base > 0)) {
    return defaultSimulatedCountRule();
  }
  const rule: SimulatedCountRule = { base, jitter: 0, mode: "fixed", peak: base };
  const valid = simulatedCountVaryOf({ ...rule, vary });
  return valid ? { ...rule, vary: valid } : rule;
}

/** O +N da regra (fixed: a base; off: 0); a faixa que varia nao tem um numero so (nulo). */
export function simulationAudienceExtraOf(rule: SimulatedCountRule): number | null {
  return rule.mode === "off" ? 0 : rule.mode === "fixed" ? rule.base : null;
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
export function simulationRulesOn(simulation: Pick<SessionSimulation, "countChanges" | "countRule" | "joins" | "saleNotices">): boolean {
  return (
    countTimelineOn(simulation) ||
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
 * nao muda: o resumo do fim e o que a turma viu com a regra que valia. Na Live ao vivo (R7) o zero e o started_at (o
 * "Começar para todos"): na espera, mesmo depois da hora marcada, a regra ainda muda; com o started_at, no ar ou
 * encerrada, nao.
 */
export function simulationSessionStarted(session: { kind?: SessionKind; scheduledAt: string; startedAt?: string | null; status: SessionStatus }, nowMs: number): boolean {
  if (session.status === "live" || session.status === "ended") {
    return true;
  }
  if (session.kind === "live") {
    return Number.isFinite(toTime(session.startedAt ?? null));
  }
  const zero = toTime(session.scheduledAt);
  return Number.isFinite(zero) && zero <= nowMs;
}

/** O offset da espera da Live ao vivo antes do started_at: sempre negativo, no maximo −1 s (o numero do zero). */
export const LIVE_SIMULATION_WAITING_MAX_MS = -1000;

/**
 * O relogio da Simulacao (R7): na gravada, desde a hora marcada (o zero do video); na Live ao vivo, desde o started_at
 * (o "Começar para todos"), nunca pela ancora da gravacao, que so move o chat. Na espera da live, sem started_at, o
 * offset fica negativo (no maximo −1 s), mesmo depois da hora marcada: vale o numero do zero e nada de entrada nem
 * aviso, como a gravada antes da hora. O mesmo relogio da presenca da live (live-model.presenceOffsetMs). NaN sem hora.
 */
export function simulationClockMs(session: { kind: SessionKind; scheduledAt: string; startedAt?: string | null }, nowMs: number): number {
  if (session.kind === "live") {
    const started = toTime(session.startedAt ?? null);
    if (Number.isFinite(started)) {
      return nowMs - started;
    }
    const scheduled = toTime(session.scheduledAt);
    return Number.isFinite(scheduled) ? Math.min(nowMs - scheduled, LIVE_SIMULATION_WAITING_MAX_MS) : LIVE_SIMULATION_WAITING_MAX_MS;
  }
  return nowMs - toTime(session.scheduledAt);
}

/** A forma da faixa da Live ao vivo: a duracao prevista do webinario (nunca menos de 1 min). */
export function liveSimulationShapeMs(durationMinutes: number): number {
  return Math.max(1, Number.isFinite(durationMinutes) ? durationMinutes : 1) * 60_000;
}

/**
 * O fim da Live ao vivo no relogio da Simulacao: o Encerrar live (ended_at − started_at); no ar, sem fim (Infinity).
 * Encerrada sem ter comecado (direto da espera), 0: nada simulado conta.
 */
export function liveSimulationEndOffsetMs(session: { endedAt: string | null; startedAt: string | null }): number {
  const started = toTime(session.startedAt);
  const ended = toTime(session.endedAt);
  if (!Number.isFinite(ended)) {
    return Number.POSITIVE_INFINITY;
  }
  return Number.isFinite(started) ? Math.max(0, ended - started) : 0;
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
 * de [fromMs, toMs] (no maximo 120 s). Na sessao gravada e na Live ao vivo (R7) com algo ligado; o replay, a cancelada
 * e a sessao sem regra devolvem `enabled: false` e listas vazias. Nunca a semente nem as regras. Na live, `durationMs`
 * e a duracao prevista (so a forma da faixa, que segura o numero do fim dali em diante) e `endMs` o Encerrar live
 * (liveSimulationEndOffsetMs; no ar, sem fim): as entradas e os avisos so param nele.
 */
export function simulationFeed(input: {
  /** A duracao do video (a forma da faixa do contador; nunca a cortada pelo Encerrar); na live, a prevista. */
  durationMs: number;
  /** O fim real no relogio do video (simulationEndOffsetMs; na live, liveSimulationEndOffsetMs); sem ele, o fim do video. */
  endMs?: number;
  fromMs: number;
  kind: SessionKind;
  simulation: SessionSimulation | null;
  status?: SessionStatus;
  toMs: number;
}): SimulationFeed {
  const { durationMs, fromMs, simulation } = input;
  const live = input.kind === "live";
  if ((input.kind !== "simulated" && !live) || input.status === "cancelled" || !simulation || !simulationRulesOn(simulation)) {
    return emptySimulationFeed(fromMs, input.toMs);
  }
  const toMs = Math.min(input.toMs, fromMs + WINDOW_MS);
  const endMs = live ? (input.endMs ?? Number.POSITIVE_INFINITY) : Math.min(durationMs, input.endMs ?? durationMs);
  // Entradas e avisos so ate o fim real; o contador fica com a forma do video e zera depois do fim.
  const eventsTo = Math.min(toMs, endMs - 1);
  const limitMs = live ? endMs : durationMs;
  return {
    // O contador com as mudancas no ar (D79); sem mudancas, o mesmo que counterPointsBetween.
    counter: timelinePointsBetween(countTimelineOf(simulation, durationMs, live), fromMs, toMs, endMs),
    enabled: true,
    from: fromMs,
    joins: joinsBetween(simulation.joins, simulation.seed, fromMs, eventsTo, limitMs),
    saleNotices: saleNoticesBetween(simulation.saleNotices, fromMs, eventsTo, limitMs),
    to: toMs
  };
}

/**
 * A parte simulada do contador agora, para o console da equipe (R7: "12 presentes · pico 14 · +300 simulados"): o
 * numero que a sala soma ao real no offset, pela mesma janela da sala; nulo sem contador ligado (ou sem regra, replay,
 * cancelada). As entradas e os avisos nao entram aqui. Nunca vai para um numero real.
 */
export function simulationCounterNow(input: Omit<Parameters<typeof simulationFeed>[0], "fromMs" | "toMs"> & { offsetMs: number }): number | null {
  if (!Number.isFinite(input.offsetMs)) {
    return null;
  }
  const feed = simulationFeed({ ...input, fromMs: input.offsetMs, toMs: input.offsetMs });
  return feed.enabled ? counterExtraFromPoints(feed.counter, input.offsetMs) : null;
}

/**
 * O que o fim da sessao congela em simulation_summary (docs/30 §3.5 e §4.3): o maior numero que o contador somou ao
 * real, quantas entradas e quantos avisos de venda apareceram de 0 ao fim real (`endMs`, cortado pelo Encerrar da
 * equipe em simulationEndOffsetMs), com a faixa do contador desenhada sobre o video inteiro (`videoMs`), como a sala
 * recebeu durante a sessao. E exatamente o que as janelas de simulationFeed mostraram nesse trecho (o teste de
 * propriedade confere); as saidas nao contam como entradas. Um numero so vale para os dois (o video inteiro).
 */
export function simulationTotals(
  simulation: Pick<SessionSimulation, "countChanges" | "countRule" | "joins" | "saleNotices" | "seed">,
  span: number | { endMs: number; videoMs: number },
  live = false
): SimulationTotals {
  const videoMs = typeof span === "number" ? span : span.videoMs;
  // Na Live ao vivo (R7) a live pode passar do previsto: o fim e o Encerrar live, e o contador segura o numero do fim da forma.
  const spanEnd = typeof span === "number" ? span : span.endMs;
  const endMs = live ? Math.min(spanEnd, CHAT_LIMITS.offsetMaxMs) : Math.min(videoMs, spanEnd);
  if (!(videoMs > 0) || !(endMs > 0) || !Number.isFinite(endMs)) {
    return { counterMax: 0, joinsShown: 0, saleNoticesShown: 0 };
  }
  const limitMs = live ? endMs : videoMs;
  let counterMax = 0;
  // Os trechos de cada regra juntos (D80): o maior numero dos pontos de 15 s que a sala recebeu, com as rampas.
  if (countTimelineOn(simulation)) {
    const timeline = countTimelineOf(simulation, videoMs, live);
    // Os mesmos pontos das janelas da sala: os de 15 s e a hora de cada mudanca do "Variar sozinho" (D90).
    for (const at of timelinePointTimes(timeline, 0, endMs - 1)) {
      counterMax = Math.max(counterMax, timelineExtraAt(timeline, at));
    }
  }
  return {
    counterMax,
    joinsShown: joinsBetween(simulation.joins, simulation.seed, 0, endMs - 1, limitMs).filter((event) => !event.left).length,
    saleNoticesShown: saleNoticesBetween(simulation.saleNotices, 0, endMs - 1, limitMs).length
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
/** O numero fixo como fica gravado: sem o que nao usa, com o "Variar sozinho" so quando vale. */
function simulationAudienceFixedRule(count: SimulatedCountRule): SimulatedCountRule {
  const rule: SimulatedCountRule = { base: count.base, jitter: 0, mode: "fixed", peak: count.base };
  const vary = simulatedCountVaryOf({ ...rule, vary: count.vary });
  return vary ? { ...rule, vary } : rule;
}

export function normalizeSimulationRules(rules: SimulationRules): SimulationRules {
  const count = rules.countRule;
  const countRule: SimulatedCountRule =
    count.mode === "off"
      ? defaultSimulatedCountRule()
      : count.mode === "fixed"
        ? simulationAudienceFixedRule(count)
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

/**
 * A frase de §8.6 para hoje (data de Sao Paulo) com o nome de quem decide. `live` (R7): a variante da Live ao vivo,
 * sem o trecho do selo (simulationAckSentenceLive).
 */
export function simulationAckFor(input: { live?: boolean; nowMs: number; responsible: string; rules: SimulationRules }): string {
  const flags = simulationAckFlags(input.rules);
  const date = saoPauloDate(new Date(input.nowMs).toISOString());
  if (input.live) {
    return simulationAckSentenceLive({ countSimulated: flags.countSimulated, date, joinsSimulated: flags.joinsSimulated, responsible: input.responsible, saleNoticesSimulated: flags.saleNoticesSimulated });
  }
  return simulationAckSentenceV4({ ...flags, date, responsible: input.responsible });
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
 * com os espacos e as aspas normalizados. Qualquer outra diferenca (nome, selo, numeros, avisos, a variante da live)
 * recusa.
 */
export function simulationAckMatches(input: { ackText: string | null | undefined; live?: boolean; nowMs: number; responsible: string; rules: SimulationRules }): boolean {
  const given = normalizeSimulationAck(input.ackText ?? "");
  if (!given) {
    return false;
  }
  return [input.nowMs, input.nowMs - 86_400_000].some(
    (nowMs) => normalizeSimulationAck(simulationAckFor({ live: input.live, nowMs, responsible: input.responsible, rules: input.rules })) === given
  );
}

/**
 * O que a frase de uma mudanca dos participantes simulados (D79) diz alem do numero: o selo da gravada e o que continua
 * ligado (as entradas e os avisos de venda, travados no ar). O console e o card recebem isto do servidor, nunca as
 * regras inteiras.
 */
export type SimulationAudienceFlags = { badgeOn: boolean; joinsSimulated: boolean; saleNoticesSimulated: boolean };

export function simulationAudienceFlagsOf(rules: Pick<SimulationRules, "joins" | "saleNotices" | "showLiveBadge">): SimulationAudienceFlags {
  return {
    badgeOn: rules.showLiveBadge,
    joinsSimulated: rules.joins.enabled,
    saleNoticesSimulated: rules.saleNotices.enabled && rules.saleNotices.items.length > 0
  };
}

/**
 * A frase de uma mudanca dos participantes simulados (D79): a mesma frase da decisao (a da live na live), com os numeros
 * de plateia pelo +N novo e pelas entradas, e o trecho do numero ("A partir de agora, os participantes simulados somam
 * +300 ao número de quem assiste."). Data de Sao Paulo e o nome de quem muda, como simulationAckFor.
 */
export function simulationAudienceAckFor(input: { extra: number; flags: SimulationAudienceFlags; live?: boolean; nowMs: number; responsible: string }): string {
  const extra = Math.max(0, Math.trunc(Number.isFinite(input.extra) ? input.extra : 0));
  const date = saoPauloDate(new Date(input.nowMs).toISOString());
  const common = {
    audience: extra,
    countSimulated: extra > 0,
    date,
    joinsSimulated: input.flags.joinsSimulated,
    responsible: input.responsible,
    saleNoticesSimulated: input.flags.saleNoticesSimulated
  };
  return input.live ? simulationAckSentenceLive(common) : simulationAckSentenceV4({ ...common, badgeOn: input.flags.badgeOn });
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
