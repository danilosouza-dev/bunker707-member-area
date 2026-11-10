// A Simulacao completa no banco (docs/30 §2.2, §3.5, §4.3, §6.6, §8.6, D6, D10 e D25; migracao 202610300003), pela
// service role: as regras de cada sessao gravada (contador, entradas, avisos de venda), a decisao registrada (o selo
// "Ao vivo" e a frase de §8.6 com quem e quando, colunas da fase 2) e o resumo congelado no fim. Estas colunas so sao
// lidas aqui e pelo bloco Simulacao; nenhuma consulta de numero real as le (D6, M6). Quem calcula o contador e as
// entradas (com a semente, so no servidor) e simulation-model.ts, da frente da Simulacao. Adendo de 10/11/2026 (R7): a
// sessao `live` tambem grava as regras e congela o resumo (check webinar_sessions_simulation_live_v7 da 202611100002:
// nunca o selo "Ao vivo" na live); no banco sem ela, o check antigo recusa a live e a escrita vira
// LiveSimulationPendingError (409 com a frase da migracao em quem chama).

import "server-only";

import { WebinarError, assertNoDbError, type WebinarsDb } from "./db";
import type { SessionSimulation, SimulatedCountRule, SimulatedJoins, SimulatedSaleNotices, SimulationTotals } from "./model";
import { SESSION_SIMULATION_COLUMNS, sessionSimulationFromRow, simulationRulesToRow, simulationTotalsToRow, type SessionSimulationRow } from "./rows";

const NOT_SIMULATED_MESSAGE = "Só a sessão da Live gravada e a da Live ao vivo têm Simulação.";

/** As especies de sessao com Simulacao: a gravada e, desde a 202611100002, a Live ao vivo (nunca o Replay). */
const SIMULATION_KINDS = ["simulated", "live"] as const;

/** O check da 202610300003 que proibia qualquer regra simulada na sessao `live` (sai na 202611100002). */
const OLD_LIVE_CHECK = "webinar_sessions_simulation_not_live_v4";

/** A live recusada pelo check antigo: o banco ainda nao tem a 202611100002. */
export class LiveSimulationPendingError extends Error {
  constructor() {
    super(`Webinarios: gravar simulacao da live: banco sem o check webinar_sessions_simulation_live_v7`);
    this.name = "LiveSimulationPendingError";
  }
}

/** O erro do PostgREST e o check antigo da live (23514 com o nome dele na mensagem). */
export function isOldLiveSimulationCheck(error: { code?: string | null; details?: string | null; message?: string | null } | null): boolean {
  return Boolean(error) && error?.code === "23514" && `${error?.message ?? ""} ${error?.details ?? ""}`.includes(OLD_LIVE_CHECK);
}

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
 * Grava a Simulacao da sessao gravada (ou da Live ao vivo, R7) de uma vez: o selo, as regras da fase 4 e a decisao
 * (D10). "off" / desligado grava nulo. O replay e recusado aqui (409; o Replay livre nunca simula); a live com o selo
 * ligado, no banco (check webinar_sessions_simulation_live_v7). Quem chama confere a caixa de §8.6 (o zod de
 * simulation-schemas.ts) e o selo da live. Banco sem a 202611100002: a live vira LiveSimulationPendingError.
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
    .in("kind", [...SIMULATION_KINDS])
    .select(SESSION_SIMULATION_COLUMNS);
  if (isOldLiveSimulationCheck(error)) {
    throw new LiveSimulationPendingError();
  }
  assertNoDbError(error, "Webinarios: gravar simulacao");
  const row = ((data ?? []) as SessionSimulationRow[])[0];
  if (!row) {
    throw new WebinarError(NOT_SIMULATED_MESSAGE, 409);
  }
  return sessionSimulationFromRow(row);
}

/**
 * Congela os totais no fim da sessao (como presence_curve, docs/30 §4.5): so uma vez (where simulation_summary is
 * null), na gravada e na Live ao vivo (R7). Devolve se foi esta chamada que congelou.
 */
export async function freezeSimulationSummary(db: WebinarsDb, input: { sessionId: string; totals: SimulationTotals }): Promise<boolean> {
  const { data, error } = await db
    .from("webinar_sessions")
    .update({ simulation_summary: simulationTotalsToRow(input.totals) })
    .eq("id", input.sessionId)
    .in("kind", [...SIMULATION_KINDS])
    .is("simulation_summary", null)
    .select("id");
  assertNoDbError(error, "Webinarios: congelar simulacao");
  return ((data ?? []) as { id: string }[]).length > 0;
}
