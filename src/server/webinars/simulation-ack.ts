// A frase da decisao do produtor na fase 4 (docs/30 §8.6 e D10), gravada em webinar_sessions.simulation_ack_text (e em
// webinars.jit_settings.simulation.ackText) exatamente como foi mostrada e marcada. A da fase 2
// (room-model.ts, simulationAckSentence) cobre so o selo e os numeros de plateia; esta cobre tambem as entradas e os
// avisos de venda simulados, que a fase 4 liga. Modulo puro, sem imports: o card Simulacao (4b) e o "Comeca quando voce
// entra" (4e) usam a mesma frase.

export type SimulationAckInput = {
  badgeOn: boolean;
  /** DD/MM/AAAA, Sao Paulo. */
  date: string;
  /** O contador somado ao real (simulated_count_rule diferente de "off"). */
  countSimulated: boolean;
  /** "Ana M. entrou" (simulated_joins ligado). */
  joinsSimulated: boolean;
  responsible: string;
  /** Avisos de venda (simulated_sale_notices ligado com pelo menos um). */
  saleNoticesSimulated: boolean;
};

/** Algo simulado ligado: o editor so salva com a caixa marcada (simulationNeedsAck em simulation-schemas.ts). */
export function simulationIsOn(input: Pick<SimulationAckInput, "badgeOn" | "countSimulated" | "joinsSimulated" | "saleNoticesSimulated">): boolean {
  return input.badgeOn || input.countSimulated || input.joinsSimulated || input.saleNoticesSimulated;
}

export function simulationAckSentenceV4(input: SimulationAckInput): string {
  const numbers = input.countSimulated || input.joinsSimulated;
  return (
    `Decisão do produtor em ${input.date}: nesta sessão gravada, dentro da área de membros, o selo "Ao vivo" ` +
    `${input.badgeOn ? "fica ligado" : "fica desligado"}, os números de plateia ${numbers ? "são simulados" : "são reais"} ` +
    `e os avisos de venda ${input.saleNoticesSimulated ? "são simulados" : "não aparecem"}. ` +
    `Fora da área de membros, esta sessão nunca é anunciada como ao vivo. Responsável: ${input.responsible.trim() || "—"}.`
  );
}

/**
 * A decisao da Simulacao ficou registrada (a frase e a hora; docs/30 §8.6, D10). Mora aqui (modulo puro, sem imports)
 * para o relatorio e as exportacoes saberem se algo simulado apareceu sem ler o calculo da Simulacao (D6/M6).
 */
export function simulationDecisionRecorded(session: { simulationAckText?: string | null; simulationDecidedAt?: string | null }): boolean {
  return typeof session.simulationAckText === "string" && session.simulationAckText.trim().length > 0 && Boolean(session.simulationDecidedAt);
}
