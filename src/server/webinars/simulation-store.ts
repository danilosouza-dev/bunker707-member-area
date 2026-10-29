// A Simulacao completa no banco (docs/30 §2.2, §3.5, §4.3, §6.6, §8.6, D6, D10 e D25; migracao 202610290005), pela
// service role: as regras de cada sessao gravada (contador, entradas, avisos de venda), a decisao registrada (o selo
// "Ao vivo" e a frase de §8.6 com quem e quando, colunas da fase 2) e o resumo congelado no fim. Estas colunas so sao
// lidas aqui e pelo bloco Simulacao; nenhuma consulta de numero real as le (D6, M6). Quem calcula o contador e as
// entradas (com a semente, so no servidor) e simulation-model.ts, da frente da Simulacao.

import "server-only";

import { WebinarError, assertNoDbError, type WebinarsDb } from "./db";
import type { SessionSimulation, SimulatedCountRule, SimulatedJoins, SimulatedSaleNotices, SimulationTotals } from "./model";
import { SESSION_SIMULATION_COLUMNS, sessionSimulationFromRow, simulationRulesToRow, simulationTotalsToRow, type SessionSimulationRow } from "./rows";

const NOT_SIMULATED_MESSAGE = "Só a sessão da Live gravada tem Simulação.";

export async function fetchSessionSimulation(db: WebinarsDb, sessionId: string): Promise<SessionSimulation | null> {
  const { data, error } = await db.from("webinar_sessions").select(SESSION_SIMULATION_COLUMNS).eq("id", sessionId).maybeSingle();
  assertNoDbError(error, "Webinarios: ler simulacao da sessao");
  const row = (data as SessionSimulationRow | null) ?? null;
  return row ? sessionSimulationFromRow(row) : null;
}

export async function listSessionSimulations(db: WebinarsDb, sessionIds: readonly string[]): Promise<SessionSimulation[]> {
  if (sessionIds.length === 0) {
    return [];
  }
  const { data, error } = await db.from("webinar_sessions").select(SESSION_SIMULATION_COLUMNS).in("id", [...new Set(sessionIds)]);
  assertNoDbError(error, "Webinarios: ler simulacoes");
  return ((data ?? []) as SessionSimulationRow[]).map(sessionSimulationFromRow);
}

export type SessionSimulationSave = {
  ackText: string | null;
  countRule: SimulatedCountRule;
  decidedAt: string;
  decidedBy: string;
  joins: SimulatedJoins;
  saleNotices: SimulatedSaleNotices;
  sessionId: string;
  showLiveBadge: boolean;
};

/**
 * Grava a Simulacao da sessao gravada de uma vez: o selo, as regras da fase 4 e a decisao (D10). "off" / desligado
 * grava nulo. A sessao `live` e recusada aqui (409) e no banco (check webinar_sessions_simulation_not_live_v4); o
 * replay tambem (o Replay livre nunca simula). Quem chama confere a caixa de §8.6 (o zod de simulation-schemas.ts).
 */
export async function saveSessionSimulationRows(db: WebinarsDb, input: SessionSimulationSave): Promise<SessionSimulation> {
  const { data, error } = await db
    .from("webinar_sessions")
    .update({
      ...simulationRulesToRow(input),
      show_live_badge: input.showLiveBadge,
      simulation_ack_text: input.ackText,
      simulation_decided_at: input.decidedAt,
      simulation_decided_by: input.decidedBy
    })
    .eq("id", input.sessionId)
    .eq("kind", "simulated")
    .select(SESSION_SIMULATION_COLUMNS);
  assertNoDbError(error, "Webinarios: gravar simulacao");
  const row = ((data ?? []) as SessionSimulationRow[])[0];
  if (!row) {
    throw new WebinarError(NOT_SIMULATED_MESSAGE, 409);
  }
  return sessionSimulationFromRow(row);
}

/**
 * Congela os totais no fim da sessao (como presence_curve, docs/30 §4.5): so uma vez (where simulation_summary is
 * null). Devolve se foi esta chamada que congelou.
 */
export async function freezeSimulationSummary(db: WebinarsDb, input: { sessionId: string; totals: SimulationTotals }): Promise<boolean> {
  const { data, error } = await db
    .from("webinar_sessions")
    .update({ simulation_summary: simulationTotalsToRow(input.totals) })
    .eq("id", input.sessionId)
    .eq("kind", "simulated")
    .is("simulation_summary", null)
    .select("id");
  assertNoDbError(error, "Webinarios: congelar simulacao");
  return ((data ?? []) as { id: string }[]).length > 0;
}
