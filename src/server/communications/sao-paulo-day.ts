// O dia de Sao Paulo (UTC-3 fixo, sem horario de verao, como campaign-model.ts e o resto do sistema): o limite
// diario dos fluxos (flow-model.ts, flow-store.ts) e o "hoje" da regra "Ganhou acesso recentemente"
// (audience-model.ts). Modulo puro, sem imports: o motor, o editor no navegador e os testes carregam direto.

const DAY_MS = 86_400_000;
/** Sao Paulo em UTC-3 fixo (03:00 UTC = 00:00 em Sao Paulo). */
const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Comeco do dia de Sao Paulo de `now` (00:00 local, em ms) e do dia seguinte. */
export function saoPauloDayBounds(now: number): { nextStart: number; start: number } {
  const start = Math.floor((now - SAO_PAULO_OFFSET_MS) / DAY_MS) * DAY_MS + SAO_PAULO_OFFSET_MS;

  return { nextStart: start + DAY_MS, start };
}
