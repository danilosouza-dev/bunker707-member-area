import "server-only";

// As sessoes gravadas pelo relogio (docs/30 §1.6, §2.3 e §6.6): a cada minuto o tick abre as sessoes `simulated`
// cuja hora marcada chegou (webinar publicado e nao cancelado; o roteiro entra e o "Comecou agora" sai pelo sino) e
// encerra as que passaram da duracao do video (a gravacao; sem duracao, a prevista do webinario), congelando a
// presenca e criando o replay do webinario na primeira sessao que encerra. Uma consulta de sessoes por tick
// (scheduled/waiting/live dos ultimos 7 dias ate agora); o webinario e as gravacoes dele sao lidos uma vez por
// tick. Uma sessao que ninguem abriu e cuja janela inteira ja passou (o tick ficou fora do ar) e encerrada direto,
// sem "Comecou agora" atrasado. As sessoes `live` (fase 3: o apresentador abre e encerra) e `replay` (nasce
// disponivel) ficam de fora. Banco sem a migracao 202610290001: registra e devolve zeros (o tick continua verde).
// O job e src/server/jobs/webinar-sessions-job.ts.

import { isPendingMigrationError } from "../db/pending-migration";
import { isMissingWebinarSchema, WEBINARS_MIGRATION, type WebinarsDb } from "./db";
import { toTime, type Webinar } from "./model";
import { sessionDurationMs } from "./room-model";
import { webinarFromRow, type RecordingRow, type SessionRow } from "./rows";
import { finishSession, openSession } from "./session-lifecycle";
import { fetchWebinarRow, listRecordingRows, listSessionRowsBetween } from "./store";

const DAY_MS = 24 * 60 * 60_000;
/** Sessoes marcadas ate 7 dias atras ainda entram (o tick pode ter ficado fora do ar). */
export const SESSIONS_LOOKBACK_MS = 7 * DAY_MS;

export type WebinarSessionsResult = {
  /** Sessoes gravadas que encerraram neste tick (passaram da duracao do video). */
  finished: number;
  /** Sessoes gravadas que abriram neste tick (hora marcada chegou). */
  opened: number;
  /** Banco sem a migracao 202610290001: nada feito, o tick continua verde. */
  pendingMigration: boolean;
  /** Sessoes `replay` criadas (uma por webinario, na primeira sessao gravada que encerra). */
  replays: number;
  /** Sessoes gravadas na hora, mas sem webinario publicado (rascunho, cancelado, apagado) ou que outro tick abriu antes. */
  skipped: number;
};

type WebinarContext = { recordings: RecordingRow[]; webinar: Webinar | null };

function isMissingWebinars(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

/** A gravacao que a sessao toca: a dela (recording_id) ou a base do webinario (sem sessao). */
function recordingOf(context: WebinarContext, session: SessionRow): RecordingRow | null {
  return (
    (session.recording_id ? context.recordings.find((recording) => recording.id === session.recording_id) : null) ??
    context.recordings.find((recording) => recording.session_id === null && recording.source === "bunny") ??
    context.recordings.find((recording) => recording.session_id === null) ??
    null
  );
}

/** O fim da sessao gravada pelo relogio: inicio (a hora marcada; started_at e a mesma coisa) + duracao do video. */
export function simulatedSessionEndsAt(session: Pick<SessionRow, "scheduled_at" | "started_at">, recording: Pick<RecordingRow, "duration_seconds"> | null, durationMinutes: number) {
  return toTime(session.started_at ?? session.scheduled_at) + sessionDurationMs(recording?.duration_seconds ?? null, durationMinutes);
}

/** Um tick das sessoes gravadas. `now` e `signal` vem do tick; nos testes, o relogio falso. */
export async function runSessionsTick(input: { db: WebinarsDb; now?: Date; signal?: AbortSignal }): Promise<WebinarSessionsResult> {
  const { db, signal } = input;
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const result: WebinarSessionsResult = { finished: 0, opened: 0, pendingMigration: false, replays: 0, skipped: 0 };

  if (signal?.aborted) {
    return result;
  }

  try {
    const sessions = await listSessionRowsBetween(db, {
      from: new Date(nowMs - SESSIONS_LOOKBACK_MS).toISOString(),
      statuses: ["scheduled", "waiting", "live"],
      to: now.toISOString()
    });
    const simulated = sessions.filter((session) => session.kind === "simulated");

    if (simulated.length === 0) {
      return result;
    }

    const contexts = new Map<string, WebinarContext>();
    const contextOf = async (webinarId: string): Promise<WebinarContext> => {
      let context = contexts.get(webinarId);

      if (!context) {
        const row = await fetchWebinarRow(db, webinarId);
        context = { recordings: row ? await listRecordingRows(db, [webinarId]) : [], webinar: row ? webinarFromRow(row) : null };
        contexts.set(webinarId, context);
      }

      return context;
    };

    for (const session of simulated) {
      if (signal?.aborted) {
        break;
      }

      const context = await contextOf(session.webinar_id);
      const { webinar } = context;

      if (!webinar || webinar.status !== "published" || webinar.cancelledAt) {
        result.skipped += 1;
        continue;
      }

      const endsAt = simulatedSessionEndsAt(session, recordingOf(context, session), webinar.durationMinutes);

      if (session.status === "live") {
        if (endsAt <= nowMs) {
          const finished = await finishSession(db, session.id, now);
          result.finished += 1;
          result.replays += finished.replayCreated ? 1 : 0;
        }

        continue;
      }

      // scheduled / waiting com a hora marcada ja passada (a consulta so traz essas).
      if (endsAt <= nowMs) {
        // A janela inteira passou sem ninguem abrir (o tick ficou fora do ar): encerra direto, sem "Comecou agora".
        const finished = await finishSession(db, session.id, now);
        result.finished += 1;
        result.replays += finished.replayCreated ? 1 : 0;
        continue;
      }

      const opened = await openSession(db, session.id, now);

      if (opened.changed) {
        result.opened += 1;
      } else {
        result.skipped += 1;
      }
    }
  } catch (error) {
    if (isMissingWebinars(error)) {
      result.pendingMigration = true;
      console.info(`[webinarios] tabelas das sessoes gravadas ausentes (migracao ${WEBINARS_MIGRATION} pendente); nada a fazer.`);

      return result;
    }

    throw error;
  }

  return result;
}
