// As mudancas dos participantes simulados no banco (docs/30 §4.3, D79 e D80; migracao 202611140002): a linha de
// webinar_simulation_changes no formato do app, lida com o mesmo cuidado das colunas simulated_* (a regra passa pelo
// simulatedCountRuleOfRow, o offset e a origem sao conferidos, o resto vira nulo ou o padrao). Modulo puro (sem
// "server-only", imports relativos): os testes carregam direto pelo Node. So o codigo da Simulacao e o bloco Simulacao
// do relatorio leem estas linhas; nenhum numero real (D6, M6).

import { CHAT_LIMITS, SIMULATION_CHANGE_SOURCES, type SimulationChangeRecord, type SimulationChangeSource, type SimulationCountChange } from "./model";
import { simulatedCountRuleOfRow } from "./rows";

export const SIMULATION_CHANGE_COLUMNS = "id, session_id, at_offset_ms, count_rule, ack_text, changed_by, source, created_at";

export type SimulationChangeRow = {
  ack_text: string | null;
  at_offset_ms: number | string | null;
  changed_by: string | null;
  count_rule: unknown;
  created_at: string;
  id: string;
  session_id: string;
  source: string | null;
};

function offsetOf(value: number | string | null): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= CHAT_LIMITS.offsetMaxMs ? number : null;
}

export function simulationChangeFromRow(row: SimulationChangeRow): SimulationChangeRecord {
  const source = (SIMULATION_CHANGE_SOURCES as readonly string[]).includes(row.source ?? "") ? (row.source as SimulationChangeSource) : "console";
  return {
    ackText: (row.ack_text ?? "").slice(0, CHAT_LIMITS.simulationAck),
    atMs: offsetOf(row.at_offset_ms),
    changedAt: row.created_at,
    changedBy: row.changed_by ?? null,
    id: row.id,
    rule: simulatedCountRuleOfRow(row.count_rule),
    sessionId: row.session_id,
    source
  };
}

/** As mudancas que valem no ar (com offset), na ordem do relogio e da gravacao: o que a conta do contador usa. */
export function countChangesOf(records: readonly SimulationChangeRecord[]): SimulationCountChange[] {
  return records
    .filter((record): record is SimulationChangeRecord & { atMs: number } => record.atMs !== null)
    .map((record, index) => ({ index, record }))
    .sort((a, b) => a.record.atMs - b.record.atMs || a.record.changedAt.localeCompare(b.record.changedAt) || a.index - b.index)
    .map(({ record }) => ({ atMs: record.atMs, rule: record.rule }));
}

/** O que vai para a linha: a regra no formato de simulated_count_rule ("Só o real" grava nulo). */
export function simulationChangeToRow(input: { ackText: string; atMs: number | null; changedBy: string; rule: SimulationChangeRecord["rule"]; sessionId: string; source: SimulationChangeSource }) {
  return {
    ack_text: input.ackText.slice(0, CHAT_LIMITS.simulationAck),
    at_offset_ms: input.atMs === null ? null : Math.max(0, Math.min(CHAT_LIMITS.offsetMaxMs, Math.floor(input.atMs))),
    changed_by: input.changedBy,
    count_rule: input.rule.mode === "off" ? null : { base: input.rule.base, jitter: input.rule.jitter, mode: input.rule.mode, peak: input.rule.peak },
    session_id: input.sessionId,
    source: input.source
  };
}
