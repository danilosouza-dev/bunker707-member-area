// A folga das linhas de fluxo no sino (docs/23 §7): modulo folha, sem imports, para o sino do aluno
// (src/components/member/notifications/notifications-model.ts) ler a constante sem trazer flow-model.ts, e com ele
// audience-model.ts, para o pacote do navegador de toda pagina do aluno. FLOW_LIMITS.flowRowSettleMs e esta.

/** Folga de inbox.ts wasVisibleAt para linhas de fluxo (maior que FLOW_LIMITS.applyStatementMs). */
export const FLOW_ROW_SETTLE_MS = 15_000;
