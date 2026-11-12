// A frase da decisao do produtor na fase 4 (docs/30 §8.6 e D10), gravada em webinar_sessions.simulation_ack_text (e em
// webinars.jit_settings.simulation.ackText) exatamente como foi mostrada e marcada. A da fase 2
// (room-model.ts, simulationAckSentence) cobre so o selo e os numeros de plateia; esta cobre tambem as entradas e os
// avisos de venda simulados, que a fase 4 liga. Modulo puro, sem imports: o card Simulacao (4b) e o "Comeca quando voce
// entra" (4e) usam a mesma frase. A Live ao vivo (adendo de 10/11/2026, R7) tem a variante dela
// (simulationAckSentenceLive): sem o trecho do selo "Ao vivo" (a live e ao vivo de verdade, e o "nunca e anunciada como ao
// vivo" fala do selo), com "nesta live ao vivo" e o resto igual; continua obrigatoria e conferida no servidor.
// Os participantes simulados mudados a qualquer momento (docs/30 D79, 11/11/2026): a frase de cada mudanca e a mesma
// frase da decisao com o numero novo dito nela (`audience`: "A partir de agora, os participantes simulados somam +300
// ao número de quem assiste."), logo antes do "Fora da área" na gravada e do "Responsável" na live. Sem `audience`, a
// frase e exatamente a de antes (o card Simulacao e o "Comeca quando voce entra" nao mudam).

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
  /**
   * Os participantes simulados de uma mudanca (D79): o +N que vale a partir de agora (0 tira). Ausente ou nulo, a frase
   * da decisao como sempre foi.
   */
  audience?: number | null;
};

const integer = new Intl.NumberFormat("pt-BR");

/** O trecho do numero novo (D79), com o espaco do fim; vazio sem mudanca de participantes. */
export function simulationAudienceClause(audience: number | null | undefined): string {
  if (typeof audience !== "number" || !Number.isFinite(audience)) {
    return "";
  }
  const extra = Math.max(0, Math.trunc(audience));
  return extra > 0
    ? `A partir de agora, os participantes simulados somam +${integer.format(extra)} ao número de quem assiste. `
    : "A partir de agora, sem participantes simulados: o aluno vê só o número real de quem assiste. ";
}

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
    simulationAudienceClause(input.audience) +
    `Fora da área de membros, esta sessão nunca é anunciada como ao vivo. Responsável: ${input.responsible.trim() || "—"}.`
  );
}

/**
 * A frase da Live ao vivo (R7): os numeros de plateia e os avisos de venda, sem o selo. A data e o responsavel como na
 * gravada; a conferencia do servidor (simulationAckMatches com `live`) monta esta e compara.
 */
export function simulationAckSentenceLive(input: Omit<SimulationAckInput, "badgeOn">): string {
  const numbers = input.countSimulated || input.joinsSimulated;
  return (
    `Decisão do produtor em ${input.date}: nesta live ao vivo, dentro da área de membros, ` +
    `os números de plateia ${numbers ? "são simulados" : "são reais"} ` +
    `e os avisos de venda ${input.saleNoticesSimulated ? "são simulados" : "não aparecem"}. ` +
    simulationAudienceClause(input.audience) +
    `Responsável: ${input.responsible.trim() || "—"}.`
  );
}

/**
 * A decisao da Simulacao ficou registrada (a frase e a hora; docs/30 §8.6, D10). Mora aqui (modulo puro, sem imports)
 * para o relatorio e as exportacoes saberem se algo simulado apareceu sem ler o calculo da Simulacao (D6/M6).
 */
export function simulationDecisionRecorded(session: { simulationAckText?: string | null; simulationDecidedAt?: string | null }): boolean {
  return typeof session.simulationAckText === "string" && session.simulationAckText.trim().length > 0 && Boolean(session.simulationDecidedAt);
}
