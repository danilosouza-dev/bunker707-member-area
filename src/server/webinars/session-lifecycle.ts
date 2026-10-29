import "server-only";

// O ciclo de vida de uma sessao (docs/30 §2.3, §4.5, §5.2 e §6.6; entrega 2c): abrir (a RPC webinar_open_session
// poe a sessao em `live`, solta o roteiro pronto uma vez e, na gravada, fixa started_at na hora marcada; depois o
// "Comecou agora" no sino, uma vez por vaga) e encerrar (a RPC webinar_close_session resume as amostras em
// webinar_attendance, congela presence_curve e poe `ended`; depois a sessao `replay` do webinario nasce, uma por
// webinario, quando a gravacao esta pronta). Quem chama: o tick das sessoes gravadas (sessions-tick.ts) e as
// Server Actions do console (room-actions.ts: Comecar / Encerrar), so por openSession e finishSession. Nada aqui
// grava student_events: o tick nao tem aluno.

import { WebinarError, assertNoDbError, type WebinarsDb } from "./db";
import type { PresenceSummary } from "./model";
import { queueWebinarStartedNotices } from "./notify";
import { SESSION_COLUMNS, presenceSummaryOf, type RecordingRow, type SessionRow } from "./rows";
import { closeSessionRpc, openSessionRpc } from "./chat-store";
import { fetchSessionRow, listRecordingRows, listSessionRows } from "./store";

const SESSION_MISSING_MESSAGE = "Essa sessão não existe mais.";

export type OpenSessionOutcome = { changed: boolean; fired: number; notified: number };
export type FinishSessionOutcome = { replayCreated: boolean; summary: PresenceSummary | null };

/**
 * A gravacao que o replay vai tocar: a da propria sessao (recording_id); sem ela, a mais nova pronta com session_id da
 * sessao (a do gravador ou a enviada pela equipe durante a live: o job e o "Enviar gravacao" so ligam recording_id com
 * a sessao encerrada, para webinar_close_session medir a live por ended_at − started_at e nunca pela duracao do video);
 * sem nenhuma, a gravacao base do webinario (sem sessao; a colada pela equipe na Live gravada), desde que esteja pronta.
 * Na Live ao vivo (fase 3) a gravacao so fica pronta quando o MP4 chega na Bunny: ate la, nenhum replay.
 */
export function replayRecordingOf(recordings: readonly RecordingRow[], session: Pick<SessionRow, "recording_id"> & { id?: string }): RecordingRow | null {
  const own = session.recording_id ? recordings.find((recording) => recording.id === session.recording_id) : null;
  const bySession = own
    ? null
    : (recordings
        .filter((recording) => session.id !== undefined && recording.session_id === session.id && recording.status === "ready")
        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))[0] ?? null);
  const base =
    recordings.find((recording) => recording.session_id === null && recording.source === "bunny") ??
    recordings.find((recording) => recording.session_id === null) ??
    null;
  const candidate = own ?? bySession ?? base;

  return candidate && candidate.status === "ready" ? candidate : null;
}

/**
 * Abre a sessao: `live`, roteiro solto uma vez e o "Comecou agora" no sino para quem tem vaga (so quando a sessao
 * mudou de fato; notify.ts confere o webinario publicado e nao cancelado). O replay nunca "abre": ja nasce
 * disponivel. Sessao que nao existe: 404.
 */
export async function openSession(db: WebinarsDb, sessionId: string, now: Date): Promise<OpenSessionOutcome> {
  const session = await fetchSessionRow(db, sessionId);

  if (!session) {
    throw new WebinarError(SESSION_MISSING_MESSAGE, 404);
  }

  if (session.kind === "replay") {
    return { changed: false, fired: 0, notified: 0 };
  }

  const opened = await openSessionRpc(db, sessionId, now.toISOString());

  if (!opened.changed) {
    return { changed: false, fired: opened.fired, notified: 0 };
  }

  const notices = await queueWebinarStartedNotices(db, sessionId, now);

  return { changed: true, fired: opened.fired, notified: notices.notifications };
}

type ReplayInsert = {
  chat_mode: string;
  chat_slow_mode_seconds: number | null;
  kind: "replay";
  late_join_minutes: null;
  recording_id: string;
  scheduled_at: string;
  source_session_id: string;
  status: "live";
  webinar_id: string;
};

/** Grava a sessao `replay`; o indice unico (um replay por webinario) resolve a corrida: 23505 = ja existia. */
async function insertReplaySession(db: WebinarsDb, row: ReplayInsert): Promise<boolean> {
  const { data, error } = await db.from("webinar_sessions").insert(row).select(SESSION_COLUMNS).maybeSingle();

  if (error?.code === "23505") {
    return false;
  }

  assertNoDbError(error, "Webinarios: criar replay");

  return data !== null;
}

/**
 * Cria a sessao `replay` do webinario a partir de uma sessao encerrada, quando ainda nao existe e a gravacao esta
 * pronta: `kind = replay`, disponivel na hora (`live`), `scheduled_at = agora`, apontando para a sessao de origem (o
 * chat dela reaparece pelo segundo do video), sem Entrada atrasada, com os controles de chat da sessao encerrada.
 * Quem chama: finishSession (no fim), o job webinar-recordings (fase 3: o MP4 da live fica pronto horas depois) e o
 * "Enviar gravação" do console. Devolve se criou (outro replay ja existia, ou sem gravacao pronta: false).
 */
export async function createReplayForSession(db: WebinarsDb, sessionId: string, now: Date): Promise<boolean> {
  const session = await fetchSessionRow(db, sessionId);

  if (!session || session.kind === "replay" || session.status !== "ended") {
    return false;
  }

  const recording = replayRecordingOf(await listRecordingRows(db, [session.webinar_id]), session);

  if (!recording) {
    return false;
  }

  // A gravacao da propria live (pronta com a sessao ja encerrada): a sessao passa a apontar para ela, como o job faria.
  if (recording.session_id === session.id && !session.recording_id) {
    const { error } = await db.from("webinar_sessions").update({ recording_id: recording.id }).eq("id", session.id).is("recording_id", null);
    assertNoDbError(error, "Webinarios: ligar a gravacao a sessao encerrada");
  }

  const existing = (await listSessionRows(db, [session.webinar_id])).some((row) => row.kind === "replay");

  if (existing) {
    return false;
  }

  return insertReplaySession(db, {
    chat_mode: session.chat_mode,
    chat_slow_mode_seconds: session.chat_slow_mode_seconds,
    kind: "replay",
    late_join_minutes: null,
    recording_id: recording.id,
    scheduled_at: now.toISOString(),
    source_session_id: session.id,
    status: "live",
    webinar_id: session.webinar_id
  });
}

/**
 * Encerra a sessao (resumo por aluno + curva congelada, idempotente) e cria a sessao `replay` do webinario quando
 * ainda nao existe e a gravacao esta pronta (createReplayForSession).
 */
export async function finishSession(db: WebinarsDb, sessionId: string, now: Date): Promise<FinishSessionOutcome> {
  const summary = presenceSummaryOf(await closeSessionRpc(db, sessionId, now.toISOString()));
  const replayCreated = await createReplayForSession(db, sessionId, now);

  return { replayCreated, summary };
}
