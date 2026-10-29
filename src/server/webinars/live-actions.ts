"use server";

// Server Actions da sala da Live ao vivo (docs/30 §1.4, §2.4, §2.6, §5.2, §6.4, §6.5, §6.7, §8.1 e §8.3; fase 3): abrir
// a sala (Sessao de pratica), Comecar para todos, Encerrar live, trancar, o gravador por hora (Preparar gravacao,
// desligar, o "Gravar" na fila), a ancora (hora do servidor, uma vez), silenciar no chat, remover da sala, banir e
// desfazer, Enviar gravacao / Ligar um video da Bunny e "Alinhar chat". Os comandos da sala (silenciar todos, liberar,
// remover do iframe, trancar, gravar) saem do navegador de quem esta no console (executeCommand); aqui fica o que o
// banco guarda. Sempre a sessao `live` do webinario (outra: 409). Permissoes de §2.6: abrir, comecar, encerrar, o
// gravador, a ancora e banir pedem messaging.publish; trancar, silenciar, remover, desfazer, enviar a gravacao e
// alinhar, messaging.write. Ninguem da equipe e removido, silenciado nem banido (409). Toda acao grava recordAudit so
// com ids e contagens (o motivo digitado pela equipe vira um booleano) e revalida o console. O relogio e o do servidor.

import { revalidatePath } from "next/cache";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { ActionFailure, ActionResult } from "@/lib/action-result";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { invalidateWebinars } from "./cache";
import { canEndSession, canOpenSession } from "./console-model";
import { WebinarError, WebinarFieldError, assertNoDbError, webinarsDb, type WebinarsDb } from "./db";
import { LIVE_ACTION_MESSAGES } from "./live-console-model";
import { muteUntilIso } from "./live-model";
import {
  alignChatSchema,
  attachRecordingSchema,
  banStudentSchema,
  banUserSchema,
  browserRecordingSchema,
  releaseRecorderSchema,
  roomLockSchema,
  sessionActionSchema,
  unbanStudentSchema,
  unbanUserSchema,
  type BanKind
} from "./live-schemas";
import {
  deleteSessionBan,
  deleteUserBan,
  ensureSessionRoomName,
  fetchSessionRecordingRow,
  markRecordingAnchorRpc,
  recentRecorderPrepareDurations,
  updateLiveSession,
  updateRecorderStatus,
  upsertSessionBan,
  upsertUserBan
} from "./live-store";
import type { PresenceSummary, SessionStatus } from "./model";
import { recorderDispatcherFrom, type DispatchOutcome } from "./recorder-dispatch";
import { canReleaseRecorder, canRequestRecorder, prepareEstimateMinutes, recordButtonAction, recorderPrepareStale, type RecorderStatus } from "./recorder-model";
import { parseBunnyEmbed } from "./room-model";
import { RECORDING_COLUMNS, recorderStatusOf, sessionFromRow, type RecordingRow, type SessionRow, type WebinarRow } from "./rows";
import { createReplayForSession, finishSession, openSession } from "./session-lifecycle";
import { fetchSessionRow, insertRecordingRow, requireWebinarRow, updateRecordingRow, updateSessionRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";
const BUNNY_LIBRARY = /^\d{1,12}$/;
const BUNNY_VIDEO = /^[0-9a-f-]{8,80}$/i;

export type LiveRoomOpened = { changed: boolean; sessionId: string; status: SessionStatus };
export type LiveStarted = { changed: boolean; notified: number; sessionId: string };
export type LiveEnded = { replayCreated: boolean; sessionId: string; summary: PresenceSummary | null };
export type RoomLock = { locked: boolean; sessionId: string };
export type RecorderPrepared = { recorderStatus: RecorderStatus; sessionId: string };
export type RecorderReleased = { force: boolean; sessionId: string };
/** O pedido da maquina recusado pelo ambiente (sem GITHUB_INFRA_TOKEN) ou pelo GitHub: a tela mostra a reserva. */
export type RecorderDispatchFailure = ActionFailure & { reason: Exclude<DispatchOutcome, { ok: true }>["reason"] };

type DispatchRefused = Exclude<DispatchOutcome, { ok: true }>;
type Dispatched<T> = { done: T; kind: "done" } | { failure: DispatchRefused; kind: "refused" };
export type RecordingRequested =
  | { action: "queue"; estimateMinutes: number | null; recordingRequestedAt: string }
  | { action: "recording" | "start" | "unavailable" };
export type AnchorMarked = { anchor: string | null; changed: boolean; reason: "already" | "not_live" | null; recorderStatus: RecorderStatus };
export type SessionBanSaved = { kind: BanKind; sessionId: string; untilAt: string | null; userId: string };
export type SessionBanUndone = { existed: boolean; kind: BanKind; sessionId: string; userId: string };
export type StudentBanned = { sessionId: string; userId: string };
export type StudentUnbanned = { existed: boolean; userId: string };
export type RecordingAttached = { created: boolean; recordingId: string; replayCreated: boolean; status: "processing" | "ready" };
export type ChatAligned = { after: number; before: number; recordingId: string };
export type BrowserRecordingSaved = { on: boolean; sessionId: string };

/* ------------------------------------------------------------------------------------------------
 * Apoio
 * ---------------------------------------------------------------------------------------------- */

function revalidateConsole(webinarId: string) {
  revalidatePath(`${LIST_PATH}/${webinarId}/sala`);
}

/** A situacao da sessao mudou: a lista, o editor e o console (e o relatorio, pela tag "webinars"). */
function revalidateWebinar(webinarId: string) {
  revalidatePath(LIST_PATH);
  revalidatePath(`${LIST_PATH}/${webinarId}`);
  revalidateConsole(webinarId);
  invalidateWebinars({ from: "action" });
}

type LiveSession = { row: SessionRow; webinar: WebinarRow };

/** A sessao `live` e o webinario dela; outra sessao: 409 (a gravada e o replay nao tem sala). */
async function loadLiveSession(db: WebinarsDb, sessionId: string): Promise<LiveSession> {
  const row = await fetchSessionRow(db, sessionId);

  if (!row) {
    throw new WebinarError(LIVE_ACTION_MESSAGES.sessionMissing, 404);
  }

  if (row.kind !== "live") {
    throw new WebinarError(LIVE_ACTION_MESSAGES.notLive, 409);
  }

  return { row, webinar: await requireWebinarRow(db, row.webinar_id) };
}

function statusOf(row: SessionRow): SessionStatus {
  return sessionFromRow(row).status;
}

function isClosed(row: SessionRow): boolean {
  const status = statusOf(row);
  return status === "ended" || status === "cancelled";
}

function assertPublished(webinar: WebinarRow) {
  if (webinar.cancelled_at || webinar.status !== "published") {
    throw new WebinarError(LIVE_ACTION_MESSAGES.notPublished, 409);
  }
}

/**
 * O alvo de remover, silenciar ou banir nunca e da equipe (docs/30 §1.4): quem tem linha em admin_roles, o Apresentador
 * do webinario ou um co-apresentador / Equipe da sala. 409.
 */
async function assertStudentTarget(db: WebinarsDb, webinar: WebinarRow, userId: string): Promise<void> {
  if (webinar.host_user_id === userId) {
    throw new WebinarError(LIVE_ACTION_MESSAGES.staffTarget, 409);
  }

  const [roles, presenters] = await Promise.all([
    db.from("admin_roles").select("user_id").eq("user_id", userId).limit(1),
    db.from("webinar_presenters").select("user_id").eq("webinar_id", webinar.id).eq("user_id", userId).limit(1)
  ]);
  assertNoDbError(roles.error, "Webinarios: conferir se o alvo e da equipe");
  assertNoDbError(presenters.error, "Webinarios: conferir se o alvo e apresentador");

  if ((roles.data ?? []).length > 0 || (presenters.data ?? []).length > 0) {
    throw new WebinarError(LIVE_ACTION_MESSAGES.staffTarget, 409);
  }
}

async function fetchRecordingRowById(db: WebinarsDb, id: string): Promise<RecordingRow | null> {
  const { data, error } = await db.from("webinar_recordings").select(RECORDING_COLUMNS).eq("id", id).limit(1);
  assertNoDbError(error, "Webinarios: ler a gravacao");
  return ((data ?? []) as RecordingRow[])[0] ?? null;
}

/** Outra gravacao ja usa este video da Bunny (o indice unico provider + bunny_video_id). */
async function bunnyVideoTaken(db: WebinarsDb, videoId: string, exceptId: string | null): Promise<boolean> {
  const { data, error } = await db.from("webinar_recordings").select("id").eq("provider", "bunny").eq("bunny_video_id", videoId).limit(5);
  assertNoDbError(error, "Webinarios: conferir o video da Bunny");
  return ((data ?? []) as { id: string }[]).some((row) => row.id !== exceptId);
}

function dispatchFailure(outcome: DispatchRefused): RecorderDispatchFailure {
  const error = outcome.reason === "not_configured" ? WEBINAR_COPY.consoleAoVivo.disparoAusente : WEBINAR_COPY.consoleAoVivo.disparoFalhou;
  return { error, ok: false, reason: outcome.reason, status: 409 };
}

/* ------------------------------------------------------------------------------------------------
 * Abrir a sala, Comecar para todos, Encerrar live
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.publish] Abrir a sala (Sessao de pratica, docs/30 §1.4 e §6.4 passo 5): a sessao agendada vai para a
 * espera (`waiting`) e ganha o nome da sala se ainda nao tinha. A equipe entra; o aluno entra e espera na sala de
 * espera ate Comecar para todos (o navegador do Apresentador liga a sala de espera ao entrar). Ja na espera: nada muda.
 */
export async function openLiveRoom(input: { sessionId: string }): Promise<ActionResult<LiveRoomOpened>> {
  return runAdminAction("messaging.publish", sessionActionSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);
    assertPublished(webinar);

    const status = statusOf(row);

    if (status !== "scheduled" && status !== "waiting") {
      throw new WebinarError(LIVE_ACTION_MESSAGES.notOpenable, 409);
    }

    let changed = false;

    if (status === "scheduled") {
      const updated = await updateSessionRow(db, row.id, { status: "waiting" }, { expectedStatuses: ["scheduled"] });

      if (updated) {
        changed = true;
      } else {
        const current = await fetchSessionRow(db, row.id);

        if (!current || statusOf(current) !== "waiting") {
          throw new WebinarError(LIVE_ACTION_MESSAGES.notOpenable, 409);
        }
      }
    }

    await ensureSessionRoomName(db, row);

    await recordAudit(db, {
      action: "webinar.room_opened",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { changed, session_id: row.id }
    });
    revalidateWebinar(webinar.id);

    return { changed, sessionId: row.id, status: "waiting" as const };
  });
}

/**
 * [messaging.publish] Comecar para todos: a sessao vai ao ar (webinar_open_session: `live`, started_at) e quem garantiu
 * vaga recebe o "Comecou agora" pelo sino (session-lifecycle.openSession). Da agendada ou da espera. O navegador do
 * Apresentador desliga a sala de espera em seguida (salvo Sala de espera ligada ou sala trancada).
 */
export async function startLiveSession(input: { sessionId: string }): Promise<ActionResult<LiveStarted>> {
  return runAdminAction("messaging.publish", sessionActionSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);
    assertPublished(webinar);

    if (!canOpenSession(statusOf(row))) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.notStartable, 409);
    }

    await ensureSessionRoomName(db, row);
    const outcome = await openSession(db, row.id, now);

    await recordAudit(db, {
      action: "webinar.live_started",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { changed: outcome.changed, from: statusOf(row), notified: outcome.notified, session_id: row.id }
    });
    revalidateWebinar(webinar.id);

    return { changed: outcome.changed, notified: outcome.notified, sessionId: row.id };
  });
}

/**
 * [messaging.publish] Encerrar live: grava o fim, resume a presenca e congela a curva (session-lifecycle.finishSession).
 * O replay da live nasce depois, quando a gravacao do Jibri (ou a enviada pela equipe) fica pronta. O "Gravar" que
 * ainda estava na fila e descartado. O navegador do Apresentador ja parou a gravacao e fecha a sala para todos depois.
 */
export async function endLiveSession(input: { sessionId: string }): Promise<ActionResult<LiveEnded>> {
  return runAdminAction("messaging.publish", sessionActionSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);

    if (!canEndSession(statusOf(row))) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.notEndable, 409);
    }

    const outcome = await finishSession(db, row.id, now);

    if (row.recording_requested_at || row.browser_recording_at) {
      await updateLiveSession(db, row.id, { browser_recording_at: null, recording_requested_at: null });
    }

    await recordAudit(db, {
      action: "webinar.live_ended",
      actorId: user.id,
      count: outcome.summary?.unique ?? null,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: {
        peak: outcome.summary?.peak?.n ?? null,
        recorder_status: recorderStatusOf(row.recorder_status),
        replay_created: outcome.replayCreated,
        session_id: row.id,
        unique: outcome.summary?.unique ?? null
      }
    });
    revalidateWebinar(webinar.id);

    return { replayCreated: outcome.replayCreated, sessionId: row.id, summary: outcome.summary };
  });
}

/** [messaging.write] Trancar / Destrancar a sala (room_locked; o navegador liga a sala de espera com toggleLobby). */
export async function setRoomLock(input: { locked: boolean; sessionId: string }): Promise<ActionResult<RoomLock>> {
  return runAdminAction("messaging.write", roomLockSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);

    if (isClosed(row)) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.closed, 409);
    }

    const updated = await updateLiveSession(db, row.id, { room_locked: data.locked });

    if (!updated) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.sessionMissing, 404);
    }

    await recordAudit(db, {
      action: "webinar.room_locked",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { locked: data.locked, session_id: row.id }
    });
    revalidateConsole(webinar.id);

    return { locked: data.locked, sessionId: row.id };
  });
}

/* ------------------------------------------------------------------------------------------------
 * O gravador por hora (docs/30 §6.4 passos 3, 7 e 11; §6.7)
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.publish] Preparar gravacao (requestRecorder de §5.2): pede a maquina ao workflow (jibri-up) e poe o
 * gravador em `preparing` com a hora do pedido. Tambem com o preparo vencido (25 min sem `ready` nem `unavailable`:
 * o jibri-up morreu sem avisar), que pede de novo. Sem o pedido automatico neste ambiente, responde o motivo
 * (`not_configured`) com a frase da reserva e nada muda; o GitHub recusando, `github_error`.
 */
export async function prepareRecorder(input: { sessionId: string }): Promise<ActionResult<RecorderPrepared> | RecorderDispatchFailure> {
  const result = await runAdminAction("messaging.publish", sessionActionSchema, input, async ({ input: data, user }): Promise<Dispatched<RecorderPrepared>> => {
    const db = webinarsDb();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);
    const status = recorderStatusOf(row.recorder_status);
    // O preparo que nao respondeu em 25 min (o jibri-up morreu sem avisar) pode ser pedido de novo.
    const stale = recorderPrepareStale({ nowMs: Date.now(), requestedAt: row.recorder_requested_at ?? null, status });

    if (isClosed(row)) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.closed, 409);
    }

    if (!canRequestRecorder(status, { stale })) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.alreadyRecording, 409);
    }

    const dispatcher = recorderDispatcherFrom(process.env);

    if (!dispatcher) {
      return { failure: { ok: false, reason: "not_configured", step: "jibri-up" }, kind: "refused" };
    }

    const outcome = await dispatcher.request(row.id);

    await recordAudit(db, {
      action: "webinar.recorder_requested",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { dispatcher: dispatcher.kind, from: status, ok: outcome.ok, reason: outcome.ok ? null : outcome.reason, session_id: row.id }
    });

    if (!outcome.ok) {
      return { failure: outcome, kind: "refused" };
    }

    const nowIso = new Date().toISOString();
    const updated = await updateRecorderStatus(db, row.id, {
      expected: stale ? ["none", "unavailable", "gone", "preparing"] : ["none", "unavailable", "gone"],
      patch: { recorder_alerted_at: null, recorder_release_requested_at: null, recorder_requested_at: nowIso },
      to: "preparing"
    });

    if (!updated) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.alreadyRecording, 409);
    }

    revalidateConsole(webinar.id);

    return { done: { recorderStatus: "preparing", sessionId: row.id }, kind: "done" };
  });

  if (!result.ok) {
    return result;
  }

  return result.data.kind === "refused" ? dispatchFailure(result.data.failure) : { data: result.data.done, ok: true };
}

/**
 * [messaging.publish] Desligar o gravador (releaseRecorder de §5.2): jibri-down so com o arquivo seguro (`uploaded`, ou
 * `ready` sem gravar); `force` (FORCAR=1) so com a confirmacao do produtor, e nunca sem maquina viva. Grava a hora do
 * pedido de devolucao; o `gone` chega pelo webhook.
 */
export async function releaseRecorder(input: { force?: boolean; sessionId: string }): Promise<ActionResult<RecorderReleased> | RecorderDispatchFailure> {
  const result = await runAdminAction("messaging.publish", releaseRecorderSchema, input, async ({ input: data, user }): Promise<Dispatched<RecorderReleased>> => {
    const db = webinarsDb();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);
    const status = recorderStatusOf(row.recorder_status);
    const force = data.force === true;

    if (!canReleaseRecorder(status, force)) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.recorderNotReleasable, 409);
    }

    const dispatcher = recorderDispatcherFrom(process.env);

    if (!dispatcher) {
      return { failure: { ok: false, reason: "not_configured", step: "jibri-down" }, kind: "refused" };
    }

    const outcome = await dispatcher.release(row.id, { force });

    await recordAudit(db, {
      action: "webinar.recorder_released",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { dispatcher: dispatcher.kind, force, ok: outcome.ok, reason: outcome.ok ? null : outcome.reason, session_id: row.id, status }
    });

    if (!outcome.ok) {
      return { failure: outcome, kind: "refused" };
    }

    await updateLiveSession(db, row.id, { recorder_release_requested_at: new Date().toISOString() });
    revalidateConsole(webinar.id);

    return { done: { force, sessionId: row.id }, kind: "done" };
  });

  if (!result.ok) {
    return result;
  }

  return result.data.kind === "refused" ? dispatchFailure(result.data.failure) : { data: result.data.done, ok: true };
}

/**
 * [messaging.publish] O clique em Gravar (docs/30 §1.4 e §6.7): com a maquina pronta, `start` (o navegador do
 * Apresentador manda startRecording); preparando, o clique fica na fila (recording_requested_at) com a estimativa
 * "Preparando a gravacao, {n} min" e a gravacao comeca sozinha no `ready`; ja gravando, `recording`; sem maquina,
 * `unavailable` ("Gravacao nao preparada para esta live" e a reserva). So com a live na espera ou no ar.
 */
export async function requestRecording(input: { sessionId: string }): Promise<ActionResult<RecordingRequested>> {
  return runAdminAction("messaging.publish", sessionActionSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);
    const status = statusOf(row);

    if (status !== "waiting" && status !== "live") {
      throw new WebinarError(LIVE_ACTION_MESSAGES.notRecording, 409);
    }

    const recorder = recorderStatusOf(row.recorder_status);
    const action = recordButtonAction(recorder, { stale: recorderPrepareStale({ nowMs: now.getTime(), requestedAt: row.recorder_requested_at ?? null, status: recorder }) });
    let reply: RecordingRequested;

    if (action === "queue") {
      const recordingRequestedAt = row.recording_requested_at ?? now.toISOString();

      if (!row.recording_requested_at) {
        await updateLiveSession(db, row.id, { recording_requested_at: recordingRequestedAt });
      }

      const estimateMinutes = prepareEstimateMinutes({ nowMs: now.getTime(), pastDurationsMs: await recentRecorderPrepareDurations(db), requestedAt: row.recorder_requested_at ?? null });
      reply = { action, estimateMinutes, recordingRequestedAt };
    } else {
      reply = { action };
    }

    await recordAudit(db, {
      action: "webinar.recording_requested",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { action, recorder_status: recorder, session_id: row.id }
    });

    if (action === "queue") {
      revalidateConsole(webinar.id);
    }

    return reply;
  });
}

/**
 * [messaging.publish] A ancora (docs/30 §6.5): o navegador do Apresentador chama quando o iframe avisa a gravacao
 * ligada (recordingStatusChanged on). Grava recording_anchor_at = agora pela hora do servidor, uma vez (a RPC confere
 * com a linha travada), poe o gravador em `recording`, tira o "Gravar" da fila e recalcula pela ancora o offset do que
 * a sessao ja tinha. A segunda chamada devolve a ancora que ja existe (`already`).
 */
export async function markRecordingAnchor(input: { sessionId: string }): Promise<ActionResult<AnchorMarked>> {
  return runAdminAction("messaging.publish", sessionActionSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);
    const outcome = await markRecordingAnchorRpc(db, row.id, new Date().toISOString());

    await recordAudit(db, {
      action: "webinar.recording_anchor",
      actorId: user.id,
      count: outcome.rebased,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { changed: outcome.changed, reason: outcome.reason, rebased: outcome.rebased, recorder_status: outcome.recorderStatus, session_id: row.id }
    });

    if (outcome.changed) {
      revalidateWebinar(webinar.id);
    }

    return { anchor: outcome.anchor, changed: outcome.changed, reason: outcome.reason, recorderStatus: outcome.recorderStatus };
  });
}

/**
 * [messaging.publish] A reserva "Gravar no navegador" (docs/30 §6.7, D3) ligou ou desligou: o navegador do Apresentador
 * chama no recordingStatusChanged da gravacao local (que so avisa o navegador de quem grava). Grava
 * browser_recording_at (a hora em que ligou; nulo ao parar) para o selo Gravando do aluno na proxima leitura da sessao
 * (o console tambem manda o sinal RECORDING_SIGNAL para o efeito na hora). Ligar so com a live na espera ou no ar.
 */
export async function setBrowserRecording(input: { on: boolean; sessionId: string }): Promise<ActionResult<BrowserRecordingSaved>> {
  return runAdminAction("messaging.publish", browserRecordingSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);

    if (data.on && isClosed(row)) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.closed, 409);
    }

    const at = data.on ? (row.browser_recording_at ?? new Date().toISOString()) : null;

    if ((row.browser_recording_at ?? null) !== at) {
      await updateLiveSession(db, row.id, { browser_recording_at: at });
      invalidateWebinars({ from: "action" });
    }

    await recordAudit(db, {
      action: "webinar.browser_recording",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { on: data.on, session_id: row.id }
    });

    return { on: data.on, sessionId: row.id };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Silenciar no chat, remover da sala, banir (docs/30 §1.4 e §8.3)
 * ---------------------------------------------------------------------------------------------- */

async function saveSessionBan(input: { kind: BanKind; minutes?: 5 | 15 | 60 | null; reason?: string; sessionId: string; userId: string }, actorId: string): Promise<SessionBanSaved> {
  const db = webinarsDb();
  const { row, webinar } = await loadLiveSession(db, input.sessionId);

  if (isClosed(row)) {
    throw new WebinarError(LIVE_ACTION_MESSAGES.closed, 409);
  }

  await assertStudentTarget(db, webinar, input.userId);

  const untilAt = input.kind === "muted" ? muteUntilIso(input.minutes ?? null, Date.now()) : null;
  await upsertSessionBan(db, { by_user_id: actorId, kind: input.kind, reason: input.reason?.trim() || null, session_id: row.id, until_at: untilAt, user_id: input.userId });

  await recordAudit(db, {
    action: input.kind === "muted" ? "webinar.chat_muted" : "webinar.kicked",
    actorId,
    entityId: webinar.id,
    entityType: "webinar",
    metadata: { kind: input.kind, minutes: input.kind === "muted" ? (input.minutes ?? null) : null, session_id: row.id, target_user_id: input.userId, with_reason: Boolean(input.reason?.trim()) }
  });
  revalidateConsole(webinar.id);
  invalidateWebinars({ from: "action" });

  return { kind: input.kind, sessionId: row.id, untilAt, userId: input.userId };
}

/** [messaging.write] Silenciar no chat por 5 / 15 / 60 min ou ate o fim (nulo): o aluno assiste, mas nao escreve nem pergunta. */
export async function muteInChat(input: { minutes?: 5 | 15 | 60 | null; reason?: string; sessionId: string; userId: string }): Promise<ActionResult<SessionBanSaved>> {
  const raw = input && typeof input === "object" ? { ...input, kind: "muted" } : input;
  return runAdminAction("messaging.write", banStudentSchema, raw, async ({ input: data, user }) => saveSessionBan({ ...data, kind: "muted" }, user.id));
}

/**
 * [messaging.write] Remover da sala (Remove): o aluno nao recebe outro token nem escreve nesta sessao (kicked, ate o
 * fim). O navegador de quem modera manda kickParticipant ao iframe depois desta acao.
 */
export async function kickFromSession(input: { reason?: string; sessionId: string; userId: string }): Promise<ActionResult<SessionBanSaved>> {
  const raw = input && typeof input === "object" ? { ...input, kind: "kicked", minutes: null } : input;
  return runAdminAction("messaging.write", banStudentSchema, raw, async ({ input: data, user }) => saveSessionBan({ ...data, kind: "kicked", minutes: null }, user.id));
}

/** [messaging.write] Desfazer o silencio ou o remover desta sessao (apaga a linha). */
export async function undoSessionBan(input: { kind: BanKind; sessionId: string; userId: string }): Promise<ActionResult<SessionBanUndone>> {
  return runAdminAction("messaging.write", unbanStudentSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);
    const existed = await deleteSessionBan(db, { kind: data.kind, sessionId: row.id, userId: data.userId });

    await recordAudit(db, {
      action: "webinar.session_ban_undone",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { existed, kind: data.kind, session_id: row.id, target_user_id: data.userId }
    });
    revalidateConsole(webinar.id);
    invalidateWebinars({ from: "action" });

    return { existed, kind: data.kind, sessionId: row.id, userId: data.userId };
  });
}

/**
 * [messaging.publish] Banir: o aluno sai da sala e nao entra em nenhum webinario ate a equipe desfazer
 * (webinar_user_bans), e fica removido desta sessao (kicked). O navegador manda kickParticipant depois.
 */
export async function banStudent(input: { reason?: string; sessionId: string; userId: string }): Promise<ActionResult<StudentBanned>> {
  return runAdminAction("messaging.publish", banUserSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);
    await assertStudentTarget(db, webinar, data.userId);

    const reason = data.reason?.trim() || null;
    await upsertUserBan(db, { by_user_id: user.id, reason, session_id: row.id, user_id: data.userId });
    await upsertSessionBan(db, { by_user_id: user.id, kind: "kicked", reason, session_id: row.id, until_at: null, user_id: data.userId });

    await recordAudit(db, {
      action: "webinar.banned",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { session_id: row.id, target_user_id: data.userId, with_reason: Boolean(reason) }
    });
    revalidateConsole(webinar.id);
    invalidateWebinars({ from: "action" });

    return { sessionId: row.id, userId: data.userId };
  });
}

/** [messaging.publish] Desfazer o banimento de todos os webinarios (apaga a linha de webinar_user_bans). */
export async function unbanStudent(input: { reason?: string; userId: string }): Promise<ActionResult<StudentUnbanned>> {
  return runAdminAction("messaging.publish", unbanUserSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const existed = await deleteUserBan(db, data.userId);

    await recordAudit(db, {
      action: "webinar.unbanned",
      actorId: user.id,
      entityId: data.userId,
      entityType: "student",
      metadata: { existed, target_user_id: data.userId, with_reason: Boolean(data.reason?.trim()) }
    });
    revalidatePath(LIST_PATH);
    invalidateWebinars({ from: "action" });

    return { existed, userId: data.userId };
  });
}

/* ------------------------------------------------------------------------------------------------
 * Enviar gravacao e Alinhar chat (docs/30 §5.2, §6.5 e §6.7 "Currently unavailable")
 * ---------------------------------------------------------------------------------------------- */

function bunnyRefFrom(data: { bunnyLibraryId?: string; bunnyVideoId?: string; embedUrl?: string }): { libraryId: string; videoId: string } {
  if (data.embedUrl) {
    const ref = parseBunnyEmbed(data.embedUrl);

    if (!ref) {
      throw new WebinarFieldError("embedUrl", LIVE_ACTION_MESSAGES.attachInvalid);
    }

    return ref;
  }

  const libraryId = data.bunnyLibraryId?.trim() ?? "";
  const videoId = data.bunnyVideoId?.trim().toLowerCase() ?? "";

  if (!BUNNY_LIBRARY.test(libraryId) || !BUNNY_VIDEO.test(videoId)) {
    throw new WebinarFieldError("bunnyVideoId", LIVE_ACTION_MESSAGES.attachInvalid);
  }

  return { libraryId, videoId };
}

/**
 * [messaging.write] Enviar gravacao / Ligar um video da Bunny (a reserva de D3 e o socorro do upload_failed): o video
 * (endereco do player ou biblioteca + video) vira a gravacao da sessao (a que ja existe e atualizada; senao uma nova),
 * `ready` quando a equipe informa a duracao, senao `processing` para o job consultar a Bunny; a sessao aponta para ela
 * (so fora da espera e do ar: no ar, o Encerrar live liga depois de medir) e, encerrada, ganha o replay
 * (createReplayForSession).
 */
export async function attachRecording(input: {
  bunnyLibraryId?: string;
  bunnyVideoId?: string;
  durationSeconds?: number | null;
  embedUrl?: string;
  sessionId: string;
}): Promise<ActionResult<RecordingAttached>> {
  return runAdminAction("messaging.write", attachRecordingSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const now = new Date();
    const { row, webinar } = await loadLiveSession(db, data.sessionId);
    const ref = bunnyRefFrom(data);
    const existing = await fetchSessionRecordingRow(db, row.id);

    if (await bunnyVideoTaken(db, ref.videoId, existing?.id ?? null)) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.videoTaken, 409);
    }

    const duration = data.durationSeconds && data.durationSeconds > 0 ? data.durationSeconds : null;
    const status = duration ? ("ready" as const) : ("processing" as const);
    const fields = {
      bunny_library_id: ref.libraryId,
      bunny_video_id: ref.videoId,
      duration_seconds: duration,
      embed_url: `https://iframe.mediadelivery.net/embed/${ref.libraryId}/${ref.videoId}`,
      provider: "bunny",
      source: "upload",
      status
    };
    const recording = existing
      ? await updateRecordingRow(db, existing.id, { ...fields, checked_at: null, error_message: null, session_id: row.id })
      : await insertRecordingRow(db, { ...fields, session_id: row.id, webinar_id: webinar.id });

    if (!recording) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.recordingMissing, 404);
    }

    // Com a live na espera ou no ar, so a linha da gravacao (com session_id): ligada antes do fim, o Encerrar live
    // mediria a duracao pelo video; o encerramento a acha pelo session_id e liga depois (replayRecordingOf).
    const sessionStatus = statusOf(row);
    if (sessionStatus !== "waiting" && sessionStatus !== "live") {
      await updateSessionRow(db, row.id, { recording_id: recording.id });
    }
    const replayCreated = sessionStatus === "ended" && status === "ready" ? await createReplayForSession(db, row.id, now) : false;

    await recordAudit(db, {
      action: "webinar.recording_attached",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { recording_id: recording.id, replaced: existing !== null, replay_created: replayCreated, session_id: row.id, status }
    });
    revalidateWebinar(webinar.id);

    return { created: existing === null, recordingId: recording.id, replayCreated, status };
  });
}

/**
 * [messaging.write] Alinhar chat (docs/30 §6.5): grava o ajuste fino webinar_recordings.anchor_offset_ms (posicao no
 * video = offset_ms - anchor_offset_ms). Nenhum offset de mensagem e reescrito; a auditoria leva o antes e o depois.
 */
export async function alignChat(input: { anchorOffsetMs: number; recordingId: string }): Promise<ActionResult<ChatAligned>> {
  return runAdminAction("messaging.write", alignChatSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const recording = await fetchRecordingRowById(db, data.recordingId);

    if (!recording) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.recordingMissing, 404);
    }

    const before = recording.anchor_offset_ms ?? 0;
    const updated = await updateRecordingRow(db, recording.id, { anchor_offset_ms: data.anchorOffsetMs });

    if (!updated) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.recordingMissing, 404);
    }

    await recordAudit(db, {
      action: "webinar.chat_aligned",
      actorId: user.id,
      entityId: recording.webinar_id,
      entityType: "webinar",
      metadata: { after: data.anchorOffsetMs, before, recording_id: recording.id, session_id: recording.session_id }
    });
    revalidateConsole(recording.webinar_id);
    invalidateWebinars({ from: "action" });

    return { after: data.anchorOffsetMs, before, recordingId: recording.id };
  });
}
