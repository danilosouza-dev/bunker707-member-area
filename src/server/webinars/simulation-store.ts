// A Simulacao completa no banco (docs/30 §2.2, §3.5, §4.3, §6.6, §8.6, D6, D10 e D25; migracao 202610300003), pela
// service role: as regras de cada sessao gravada (contador, entradas, avisos de venda), a decisao registrada (o selo
// "Ao vivo" e a frase de §8.6 com quem e quando, colunas da fase 2) e o resumo congelado no fim. Estas colunas so sao
// lidas aqui e pelo bloco Simulacao; nenhuma consulta de numero real as le (D6, M6). Quem calcula o contador e as
// entradas (com a semente, so no servidor) e simulation-model.ts, da frente da Simulacao. Adendo de 10/11/2026 (R7): a
// sessao `live` tambem grava as regras e congela o resumo (check webinar_sessions_simulation_live_v7 da 202611100002:
// nunca o selo "Ao vivo" na live); no banco sem ela, o check antigo recusa a live e a escrita vira
// LiveSimulationPendingError (409 com a frase da migracao em quem chama). Os participantes simulados mudados a qualquer
// momento (D79 e D80; 202611110002): cada mudanca e uma linha de webinar_simulation_changes (so acrescenta; a regra, o
// offset em que vale, a frase confirmada, quem e de onde), e a leitura da Simulacao traz as que valem no ar em
// `countChanges`. Banco sem a tabela: a leitura das mudancas devolve vazio (a Simulacao segue como antes) e so a escrita
// vira PendingMigrationError (409 com a frase da 202611110002 em quem chama). Correcoes da revisao v8 (11/11/2026): a
// janela da sala le a decisao, a situacao e o fim da linha de agora junto com as regras (fetchSessionSimulationFeed;
// achado 1), o card do editor so grava por cima da decisao que carregou (expectedDecidedAt, SimulationChangedError;
// achado 6) e as mudancas sao lidas em paginas, todas (listSimulationChanges; achado 8).

import "server-only";

import { isPendingMigrationError } from "../db/pending-migration";
import { WebinarError, assertNoDbError, isMissingWebinarSchema, type WebinarsDb } from "./db";
import type { SessionSimulation, SimulatedCountRule, SimulatedJoins, SimulatedSaleNotices, SimulationChangeRecord, SimulationChangeSource, SimulationTotals } from "./model";
import {
  SESSION_SIMULATION_COLUMNS,
  SESSION_SIMULATION_FEED_COLUMNS,
  sessionSimulationFeedStateFromRow,
  sessionSimulationFromRow,
  simulationRulesToRow,
  simulationTotalsToRow,
  type SessionSimulationFeedRow,
  type SessionSimulationFeedState,
  type SessionSimulationRow
} from "./rows";
import { SIMULATION_CHANGE_COLUMNS, countChangesOf, simulationChangeFromRow, simulationChangeToRow, type SimulationChangeRow } from "./simulation-change-rows";
import { fetchAll } from "./store";

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
  if (!row) {
    return null;
  }
  const changes = await readSimulationChanges(db, [row.id]);
  return withCountChanges(sessionSimulationFromRow(row), changes);
}

/**
 * A Simulacao e a linha fresca da sessao para a janela da sala (GET .../simulation; correcao da revisao v8, achado 1):
 * numa leitura, as regras e a decisao, a situacao, a hora marcada, o inicio e o fim de agora, para a rota nunca decidir
 * "sem decisao" pela sessao do cache do acesso (ate 10 min na gravada) enquanto a consulta de 5 s do chat ja levou o
 * carimbo novo a sala. Sem a linha, nulo; banco sem as colunas, o erro de sempre (quem chama devolve a janela vazia).
 */
export async function fetchSessionSimulationFeed(db: WebinarsDb, sessionId: string): Promise<{ simulation: SessionSimulation; state: SessionSimulationFeedState } | null> {
  const { data, error } = await db.from("webinar_sessions").select(SESSION_SIMULATION_FEED_COLUMNS).eq("id", sessionId).maybeSingle();
  assertNoDbError(error, "Webinarios: ler simulacao da sessao para a sala");
  const row = (data as SessionSimulationFeedRow | null) ?? null;
  if (!row) {
    return null;
  }
  const changes = await readSimulationChanges(db, [row.id]);
  return { simulation: withCountChanges(sessionSimulationFromRow(row), changes), state: sessionSimulationFeedStateFromRow(row) };
}

export async function listSessionSimulations(db: WebinarsDb, sessionIds: readonly string[]): Promise<SessionSimulation[]> {
  if (sessionIds.length === 0) {
    return [];
  }
  const { data, error } = await db.from("webinar_sessions").select(SESSION_SIMULATION_COLUMNS).in("id", [...new Set(sessionIds)]);
  assertNoDbError(error, "Webinarios: ler simulacoes");
  const rows = (data ?? []) as SessionSimulationRow[];
  const changes = await readSimulationChanges(db, rows.map((row) => row.id));
  return rows.map((row) => withCountChanges(sessionSimulationFromRow(row), changes));
}

/* ------------------------------------------------------------------------------------------------
 * As mudancas dos participantes simulados (D79 e D80; 202611110002)
 * ---------------------------------------------------------------------------------------------- */

/** A Simulacao com as mudancas que valem no ar (as de antes do comeco ja estao na regra da sessao). */
export function withCountChanges(simulation: SessionSimulation, records: readonly SimulationChangeRecord[]): SessionSimulation {
  return { ...simulation, countChanges: countChangesOf(records.filter((record) => record.sessionId === simulation.sessionId)) };
}

/**
 * As mudancas das sessoes, na ordem em que foram gravadas (a mais antiga primeiro), todas: em paginas de 1.000 numa
 * ordem total (created_at e id), porque o PostgREST corta a resposta em 1.000 linhas sem erro e o tick (ate 50 sessoes)
 * e o card (todas as sessoes do webinario) perderiam as mais novas, as que valem agora (a revisao v8, achado 8). Sem a
 * tabela, PendingMigrationError.
 */
export async function listSimulationChanges(db: WebinarsDb, sessionIds: readonly string[]): Promise<SimulationChangeRecord[]> {
  const ids = [...new Set(sessionIds)];
  if (ids.length === 0) {
    return [];
  }
  const rows = await fetchAll<SimulationChangeRow>(
    (from, to) =>
      db
        .from("webinar_simulation_changes")
        .select(SIMULATION_CHANGE_COLUMNS)
        .in("session_id", ids)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    "Webinarios: ler mudancas dos participantes simulados"
  );
  return rows.map(simulationChangeFromRow);
}

/** As mudancas para a conta e para a tela: sem a tabela (banco sem a 202611110002), nenhuma, e a Simulacao segue. */
export async function readSimulationChanges(db: WebinarsDb, sessionIds: readonly string[]): Promise<SimulationChangeRecord[]> {
  try {
    return await listSimulationChanges(db, sessionIds);
  } catch (error) {
    if (isPendingMigrationError(error) || isMissingWebinarSchema(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * O nome de quem mudou (profiles.full_name; sem nome, "Equipe"), como os nomes de quem decidiu no editor. Uma leitura
 * para todos; nada de e-mail. A falha da leitura deixa os nomes de fora (a tela mostra "Equipe").
 */
export async function loadSimulationChangeNames(db: WebinarsDb, records: readonly SimulationChangeRecord[]): Promise<Record<string, string>> {
  const ids = [...new Set(records.map((record) => record.changedBy).filter((id): id is string => Boolean(id)))].slice(0, 150);
  if (ids.length === 0) {
    return {};
  }
  try {
    const { data, error } = await db.from("profiles").select("id,full_name").in("id", ids);
    assertNoDbError(error, "Webinarios: quem mudou os participantes simulados");
    return Object.fromEntries(((data ?? []) as { full_name: string | null; id: string }[]).map((row) => [row.id, row.full_name?.trim() || "Equipe"]));
  } catch (error) {
    console.error(`[webinarios] nomes das mudancas dos participantes simulados: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

/** Grava uma mudanca (so acrescenta). Sem a tabela, PendingMigrationError. */
export async function insertSimulationChange(
  db: WebinarsDb,
  input: { ackText: string; atMs: number | null; changedBy: string; rule: SimulatedCountRule; sessionId: string; source: SimulationChangeSource }
): Promise<SimulationChangeRecord> {
  const { data, error } = await db.from("webinar_simulation_changes").insert(simulationChangeToRow(input)).select(SIMULATION_CHANGE_COLUMNS);
  assertNoDbError(error, "Webinarios: gravar mudanca dos participantes simulados");
  const row = ((data ?? []) as SimulationChangeRow[])[0];
  if (!row) {
    throw new WebinarError("Webinarios: a mudanca dos participantes simulados nao voltou do banco", 500);
  }
  return simulationChangeFromRow(row);
}

/**
 * Depois de uma mudanca (D79): a decisao registrada passa a ser a frase dela (quem, quando e o texto, como o card
 * Simulacao grava), o que tambem muda o updated_at da sessao (o carimbo que a consulta de 5 s do chat leva a sala).
 * `countRule` so antes do comeco (a mudanca troca a regra da sessao) ou na primeira mudanca no ar de uma sessao sem
 * contador ("Real + 0", o mesmo numero): o resumo do fim e a janela da sala reconhecem a sessao com regra. A live com o
 * check antigo (banco sem a 202611100002) vira LiveSimulationPendingError.
 */
export async function recordSimulationDecision(
  db: WebinarsDb,
  input: { ackText: string; countRule?: SimulatedCountRule; decidedAt: string; decidedBy: string; sessionId: string }
): Promise<void> {
  const count = input.countRule;
  const rule = count ? { simulated_count_rule: count.mode === "off" ? null : { base: count.base, jitter: count.jitter, mode: count.mode, peak: count.peak } } : {};
  const { data, error } = await db
    .from("webinar_sessions")
    .update({ ...rule, simulation_ack_text: input.ackText, simulation_decided_at: input.decidedAt, simulation_decided_by: input.decidedBy })
    .eq("id", input.sessionId)
    .in("kind", [...SIMULATION_KINDS])
    .select("id");
  if (isOldLiveSimulationCheck(error)) {
    throw new LiveSimulationPendingError();
  }
  assertNoDbError(error, "Webinarios: registrar a decisao dos participantes simulados");
  if (((data ?? []) as { id: string }[]).length === 0) {
    throw new WebinarError(NOT_SIMULATED_MESSAGE, 409);
  }
}

export type SessionSimulationSave = {
  ackText: string | null;
  countRule: SimulatedCountRule;
  decidedAt: string;
  decidedBy: string;
  /**
   * A decisao que estava gravada quando quem salva leu a sessao (nula: sem decisao). Com ela, a escrita so passa se a
   * sessao ainda tem essa decisao; senao, SimulationChangedError (a revisao v8, achado 6). Ausente, grava sempre.
   */
  expectedDecidedAt?: string | null;
  joins: SimulatedJoins;
  saleNotices: SimulatedSaleNotices;
  sessionId: string;
  showLiveBadge: boolean;
};

/** A Simulacao da sessao mudou entre a leitura e a escrita (o console ou outra aba gravou antes). */
export class SimulationChangedError extends Error {
  constructor() {
    super("Webinarios: a simulacao da sessao mudou em outro lugar");
    this.name = "SimulationChangedError";
  }
}

/**
 * Grava a Simulacao da sessao gravada (ou da Live ao vivo, R7) de uma vez: o selo, as regras da fase 4 e a decisao
 * (D10). "off" / desligado grava nulo. O replay e recusado aqui (409; o Replay livre nunca simula); a live com o selo
 * ligado, no banco (check webinar_sessions_simulation_live_v7). Quem chama confere a caixa de §8.6 (o zod de
 * simulation-schemas.ts) e o selo da live. Banco sem a 202611100002: a live vira LiveSimulationPendingError.
 */
export async function saveSessionSimulationRows(db: WebinarsDb, input: SessionSimulationSave): Promise<SessionSimulation> {
  let query = db
    .from("webinar_sessions")
    .update({
      ...simulationRulesToRow(input),
      show_live_badge: input.showLiveBadge,
      simulation_ack_text: input.ackText,
      simulation_decided_at: input.decidedAt,
      simulation_decided_by: input.decidedBy
    })
    .eq("id", input.sessionId)
    .in("kind", [...SIMULATION_KINDS]);
  // So por cima da decisao que quem salva leu (a escrita condicional fecha a corrida entre a leitura e a gravacao).
  if (input.expectedDecidedAt !== undefined) {
    query = input.expectedDecidedAt === null ? query.is("simulation_decided_at", null) : query.eq("simulation_decided_at", input.expectedDecidedAt);
  }
  const { data, error } = await query.select(SESSION_SIMULATION_COLUMNS);
  if (isOldLiveSimulationCheck(error)) {
    throw new LiveSimulationPendingError();
  }
  assertNoDbError(error, "Webinarios: gravar simulacao");
  const row = ((data ?? []) as SessionSimulationRow[])[0];
  if (!row) {
    if (input.expectedDecidedAt !== undefined) {
      throw new SimulationChangedError();
    }
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
