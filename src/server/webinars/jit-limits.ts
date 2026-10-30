// Os limites do "Comeca quando voce entra" (fase 4e; docs/30 §1.6 e A14) num modulo folha, sem imports. O contador do
// card na Inicio e da pagina do webinario (jit-countdown.tsx, pelo jit-clock.ts) roda no navegador: lendo estes numeros
// de model.ts, o modelo inteiro dos webinarios (limites, padroes e frases de todas as fases) entrava no JS inicial do
// Inicio. model.ts reexporta, entao quem ja importa de la nao muda.

export const JIT_LIMITS = {
  /** A janela de horas de Sao Paulo (inicio inclusive, fim exclusivo; 0 a 24). */
  hourMin: 0,
  hourMax: 24,
  /** Quantos dias a frente a pagina procura o proximo horario. */
  lookaheadDays: 7,
  lateJoinMax: 600
} as const;
