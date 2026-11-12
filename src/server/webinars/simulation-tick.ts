// O resumo da Simulacao no tick de minuto (docs/30 §1.6, §3.5, §4.3 e §6.6; D6, M6): as sessoes `simulated` encerradas
// nas ultimas 6 h com alguma regra simulada (contador, entradas ou avisos de venda) e ainda sem simulation_summary
// ganham os totais que a sala mostrou de 0 ao fim (simulationTotals, com a semente da sessao; o fim e a duracao do video
// ou o Encerrar da equipe, o que veio primeiro), congelados uma vez (freezeSimulationSummary: so onde ainda e nulo).
// E o que o bloco Simulacao do relatorio e dos paineis le; nenhum numero real muda. Uma consulta por tick (lote de 50,
// as mais antigas primeiro); o webinario e as gravacoes de cada webinario sao lidos uma vez por tick. Uma falha numa
// sessao vira log e o lote segue; o fim do orcamento do tick (signal) para o lote. Banco sem a 202610300003: registra e
// devolve zeros (o tick continua verde). A sessao sem a decisao registrada (§8.6, D10) nao mostrou nada na sala
// (simulationDecisionRecorded): congela zeros. O job e src/server/jobs/webinar-simulation-summaries-job.ts. Adendo de
// 10/11/2026 (R7): as sessoes `live` encerradas entram tambem, com o zero no started_at, a forma da faixa pela duracao
// prevista do webinario e o fim no Encerrar live (simulationTotals com `live`); a live encerrada direto da espera (sem
// started_at) congela zeros. Os participantes simulados mudados no ar (D79 e D80, 11/11/2026): as mudancas do lote
// (webinar_simulation_changes, uma leitura por tick; banco sem a 202611140002, nenhuma) entram na conta, e o resumo
// junta os trechos de cada regra com as rampas, o maior numero que a turma viu. A sessao sem contador que ganhou
// mudanca no ar ficou com "Real + 0" (saveSimulatedAudience), entao o filtro das regras ja a encontra.

import "server-only";

import { isPendingMigrationError } from "../db/pending-migration";
import { assertNoDbError, isMissingWebinarSchema, WEBINARS_OFFERS_MIGRATION, type WebinarsDb } from "./db";
import { toTime } from "./model";
import { sessionDurationMs } from "./room-model";
import { pickRecording } from "./room-queries";
import { SESSION_SIMULATION_COLUMNS, sessionSimulationFromRow, type RecordingRow, type SessionSimulationRow, type WebinarRow } from "./rows";
import { liveSimulationEndOffsetMs, liveSimulationShapeMs, simulationDecisionRecorded, simulationEndOffsetMs, simulationTotals } from "./simulation-model";
import { freezeSimulationSummary, readSimulationChanges, withCountChanges } from "./simulation-store";
import { fetchWebinarRow, listRecordingRows } from "./store";

/** Sessoes por tick (as mais antigas primeiro; o resto entra no minuto seguinte). */
export const SIMULATION_SUMMARIES_BATCH = 50;
/** Encerradas ha ate 6 h: o tick que ficou fora do ar ainda congela; depois disso a sessao fica sem resumo. */
export const SIMULATION_SUMMARIES_LOOKBACK_MS = 6 * 60 * 60_000;

const PENDING_COLUMNS = `${SESSION_SIMULATION_COLUMNS}, webinar_id, status, scheduled_at, started_at, ended_at, recording_id, simulation_ack_text, simulation_decided_at`;

/** As regras gravadas como nulo quando desligadas (simulationRulesToRow): uma delas preenchida = havia regra. */
const HAS_RULE_FILTER = "simulated_count_rule.not.is.null,simulated_joins.not.is.null,simulated_sale_notices.not.is.null";

type PendingSummaryRow = SessionSimulationRow & {
  ended_at: string | null;
  recording_id: string | null;
  scheduled_at: string;
  simulation_ack_text?: string | null;
  simulation_decided_at?: string | null;
  started_at?: string | null;
  status: string;
  webinar_id: string;
};

/** As especies com Simulacao: a gravada e a Live ao vivo (R7). */
const SUMMARY_KINDS = ["simulated", "live"] as const;

export type SimulationSummariesResult = {
  /** Sessoes em que a conta deu erro (log; o lote seguiu). */
  failed: number;
  /** Resumos congelados neste tick. */
  frozen: number;
  /** Banco sem a 202610300003: nada feito, o tick continua verde. */
  pendingMigration: boolean;
  /** Sessoes lidas pela consulta. */
  scanned: number;
  /** Sessoes que outro tick congelou antes ou que voltaram sem regra. */
  skipped: number;
};

export const EMPTY_SIMULATION_SUMMARIES_RESULT: SimulationSummariesResult = { failed: 0, frozen: 0, pendingMigration: false, scanned: 0, skipped: 0 };

function isMissingSimulation(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

function hasRule(row: PendingSummaryRow) {
  return row.simulated_count_rule != null || row.simulated_joins != null || row.simulated_sale_notices != null;
}

/** As sessoes gravadas e ao vivo encerradas desde `sinceIso` com regra simulada e sem resumo (as mais antigas primeiro). */
export async function listSessionsToSummarize(db: WebinarsDb, input: { limit: number; sinceIso: string }): Promise<PendingSummaryRow[]> {
  const { data, error } = await db
    .from("webinar_sessions")
    .select(PENDING_COLUMNS)
    .in("kind", [...SUMMARY_KINDS])
    .eq("status", "ended")
    .is("simulation_summary", null)
    .gte("ended_at", input.sinceIso)
    .or(HAS_RULE_FILTER)
    .order("ended_at", { ascending: true })
    .limit(input.limit);
  assertNoDbError(error, "Webinarios: ler simulacoes a congelar");
  return (data ?? []) as PendingSummaryRow[];
}

type WebinarContext = { recordings: RecordingRow[]; webinar: WebinarRow | null };

/**
 * A duracao que a sala usou (a mesma conta de roomContextOf: a gravacao da sessao ou a pronta do webinario; sem
 * duracao, a prevista do webinario). Sem o webinario (apagado), o tempo que a sessao ficou no ar.
 */
function sessionVideoMs(context: WebinarContext, row: PendingSummaryRow): number {
  if (!context.webinar) {
    return Math.max(0, toTime(row.ended_at) - toTime(row.scheduled_at)) || 0;
  }
  const recording = pickRecording(context.recordings, { recordingId: row.recording_id });
  return sessionDurationMs(recording?.duration_seconds ?? null, context.webinar.duration_minutes);
}

/** Um tick do resumo da Simulacao. `now` e `signal` vem do tick; nos testes, o relogio falso. */
export async function runSimulationSummariesTick(input: { db: WebinarsDb; now?: Date; signal?: AbortSignal }): Promise<SimulationSummariesResult> {
  const { db, signal } = input;
  const now = input.now ?? new Date();
  const result: SimulationSummariesResult = { ...EMPTY_SIMULATION_SUMMARIES_RESULT };

  if (signal?.aborted) {
    return result;
  }

  try {
    const rows = await listSessionsToSummarize(db, { limit: SIMULATION_SUMMARIES_BATCH, sinceIso: new Date(now.getTime() - SIMULATION_SUMMARIES_LOOKBACK_MS).toISOString() });
    result.scanned = rows.length;
    // As mudancas no ar das sessoes do lote (D79), numa leitura so.
    const changes = rows.length > 0 ? await readSimulationChanges(db, rows.map((row) => row.id)) : [];
    const contexts = new Map<string, WebinarContext>();
    const contextOf = async (webinarId: string): Promise<WebinarContext> => {
      let context = contexts.get(webinarId);
      if (!context) {
        const webinar = await fetchWebinarRow(db, webinarId);
        context = { recordings: webinar ? await listRecordingRows(db, [webinarId]) : [], webinar };
        contexts.set(webinarId, context);
      }
      return context;
    };

    for (const row of rows) {
      if (signal?.aborted) {
        break;
      }
      const live = row.kind === "live";
      if ((row.kind !== "simulated" && !live) || row.status !== "ended" || row.simulation_summary != null || !hasRule(row)) {
        result.skipped += 1;
        continue;
      }

      try {
        const context = await contextOf(row.webinar_id);
        // A forma do contador e a do video inteiro (como a sala recebeu); o Encerrar antecipado so corta o fim. Na live,
        // a forma e a duracao prevista e o fim e o Encerrar live (o numero do fim da forma segura ate la).
        const videoMs = live ? liveSimulationShapeMs(context.webinar?.duration_minutes ?? 1) : sessionVideoMs(context, row);
        const endMs = live
          ? liveSimulationEndOffsetMs({ endedAt: row.ended_at, startedAt: row.started_at ?? null })
          : simulationEndOffsetMs({ endedAt: row.ended_at, scheduledAt: row.scheduled_at }, videoMs);
        const decided = simulationDecisionRecorded({ simulationAckText: row.simulation_ack_text, simulationDecidedAt: row.simulation_decided_at });
        const totals = decided ? simulationTotals(withCountChanges(sessionSimulationFromRow(row), changes), { endMs, videoMs }, live) : { counterMax: 0, joinsShown: 0, saleNoticesShown: 0 };
        const frozen = await freezeSimulationSummary(db, { sessionId: row.id, totals });
        if (frozen) {
          result.frozen += 1;
        } else {
          result.skipped += 1;
        }
      } catch (error) {
        if (isMissingSimulation(error)) {
          throw error;
        }
        result.failed += 1;
        console.error(`[webinarios] resumo da simulacao da sessao ${row.id} nao congelado: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    if (isMissingSimulation(error)) {
      result.pendingMigration = true;
      console.info(`[webinarios] colunas da simulacao ausentes (migracao ${WEBINARS_OFFERS_MIGRATION} pendente); nada a congelar.`);
      return result;
    }
    throw error;
  }

  return result;
}
