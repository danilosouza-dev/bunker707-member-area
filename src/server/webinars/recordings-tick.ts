// O gravador por hora e as gravacoes da Live ao vivo no tick de minuto (docs/30 §4.5, §6.4 passos 3, 10 e 11, §6.7 e
// I6; D10). Cinco passos, cada um em lote pequeno e parando quando o orcamento do tick acaba (signal):
//   1. Preparar automatico: a sessao `live` de webinario publicado, nao cancelado e com "Gravar automaticamente", ainda
//      sem maquina (recorder_status none e recorder_requested_at nulo, ou `gone` porque o passo 3 devolveu a maquina da
//      live remarcada), entre a hora marcada - 30 min e o fim previsto:
//      o adaptador dispara o jibri-up (recorder-dispatch.ts) e a sessao fica `preparing` com a hora do pedido (uma vez
//      por sessao). Sem adaptador (sem GITHUB_INFRA_TOKEN) nada muda;
//   2. Bunny: as gravacoes `processing` nao consultadas ha 2 min: `finished` vira `ready` com a duracao e, com a sessao
//      encerrada, liga a sessao (recording_id ainda nulo) e cria o replay (createReplayForSession). Com a live ainda no
//      ar (o host parou a gravacao aos 40 min e seguiu ate os 90), a gravacao fica so `ready` com session_id: ligada
//      antes do fim, webinar_close_session mediria a live pela duracao do video; o Encerrar live a acha pelo
//      session_id (replayRecordingOf) e liga depois de medir. Erro, envio falho,
//      video inexistente ou 24 h sem terminar viram `failed` com o motivo; o resto so anota a consulta (checked_at).
//      Sem BUNNY_STREAM_API_KEY / BUNNY_STREAM_LIBRARY_ID nao consulta (a equipe liga o video pelo console);
//   3. Devolver a maquina: `uploaded` (o MP4 esta na Bunny), ou `ready` com a sessao encerrada ha 30 min (maquina que
//      nao gravou), ou `ready` numa live agendada remarcada para longe (o preparo da nova data a mais de 60 min: a
//      maquina nao fica ligada ate la, e o passo 1 pede outra na nova janela), sem pedido de devolucao ou com o ultimo
//      ha mais de 2 h sem `gone`: jibri-down e a hora do pedido.
//      Nunca em recording / uploading / upload_failed (canReleaseRecorder); `unavailable` nao tem maquina;
//   4. Aviso de 6 h: a maquina viva ha mais de 6 h (recorderOverdue) vira uma notificacao no sino (kind 'webinar') do
//      Apresentador e dos co-apresentadores, uma vez por pedido de maquina (recorder_alerted_at);
//   5. Retencao (uma vez por hora, no minuto RECORDINGS_PURGE_MINUTE): a gravacao do NOSSO gravador (source jibri) com
//      purge_due_at vencido (prune_webinar_history marca) e apagada na Bunny (404 conta como apagado) e ganha purged_at.
//      A enviada ou ligada pela equipe (Enviar gravacao: source upload/bunny) nunca e apagada na Bunny: o video pode
//      ser uma aula da mesma biblioteca (BUNNY_STREAM_API_KEY alcanca tudo nela).
// Uma falha numa sessao ou gravacao vira log e o passo segue com as outras. Banco sem a migracao 202610290003: registra
// e devolve zeros (o tick continua verde). O job e src/server/jobs/webinar-recordings-job.ts.

import "server-only";

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { describeError } from "../communications/db";
import { insertNotificationRows, type NotificationInsert } from "../communications/store";
import { isPendingMigrationError } from "../db/pending-migration";
import { BUNNY_VIDEO_STATUS, BunnyStreamError, type BunnyStreamClient, type BunnyVideo } from "./bunny-stream";
import { assertNoDbError, isMissingWebinarSchema, WEBINARS_MIGRATION, type WebinarsDb } from "./db";
import { webinarConsoleHref } from "./editor-model";
import { liveSessionEndsAtMs } from "./live-model";
import { listLiveSessionsByRecorder, listProcessingRecordings, listRecordingsToPurge, updateLiveSession, updateRecorderStatus } from "./live-store";
import { toTime } from "./model";
import { RECORDER_RULES, RECORDER_STATUSES, canReleaseRecorder, recorderMachineAlive, recorderOverdue } from "./recorder-model";
import type { RecorderDispatcher } from "./recorder-dispatch";
import { parseBunnyEmbed } from "./room-model";
import { RECORDING_COLUMNS, recorderStatusOf, type RecordingRow, type SessionRow, type WebinarRow } from "./rows";
import { createReplayForSession } from "./session-lifecycle";
import { fetchSessionRow, fetchWebinarRow, listPresenterRows, listSessionRowsBetween } from "./store";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
/** A sessao live mais longa dura 8 h (webinars.duration_minutes <= 480): o preparo olha 24 h para tras. */
export const RECORDER_PREPARE_LOOKBACK_MS = 24 * HOUR_MS;
/** A maquina pronta que nao gravou e devolvida 30 min depois de a sessao encerrar. */
export const RECORDER_IDLE_RELEASE_MINUTES = 30;
/** Gravacoes por tick: consulta a Bunny e retencao. */
export const RECORDINGS_BATCH = 20;
/** A retencao nao tem pressa: o passo 5 roda uma vez por hora, neste minuto (UTC). */
export const RECORDINGS_PURGE_MINUTE = 49;
/** O aviso de 6 h fica no sino por um dia. */
const ALERT_EXPIRES_MS = 24 * HOUR_MS;

/**
 * Os motivos gravados em webinar_recordings.error_message pelo job (o console mostra), pelas frases de
 * WEBINAR_COPY.gravacao; tests/webinarios-gravacoes-job.test.mjs passa estas frases pela PROIBIDAS_WEBINARIO.
 */
export const RECORDINGS_TICK_MESSAGES = {
  bunnyError: WEBINAR_COPY.gravacao.bunnyErro,
  bunnyMissing: WEBINAR_COPY.gravacao.bunnySemVideo,
  bunnyUploadFailed: WEBINAR_COPY.gravacao.bunnyEnvioFalhou,
  gaveUp: WEBINAR_COPY.gravacao.bunnyDesistiu(RECORDER_RULES.bunnyGiveUpHours)
} as const;

export type WebinarRecordingsResult = {
  /** Avisos de maquina ligada ha mais de 6 h (sessoes avisadas). */
  alerted: number;
  /** Gravacoes que viraram `failed` (erro na Bunny, video inexistente ou 24 h sem terminar). */
  failed: number;
  /** Banco sem a migracao mais nova (WEBINARS_MIGRATION): nada feito, o tick continua verde. */
  pendingMigration: boolean;
  /** Maquinas pedidas pelo preparo automatico. */
  prepared: number;
  /** Videos apagados na Bunny pela retencao (purged_at). */
  purged: number;
  /** Gravacoes que ficaram prontas na Bunny. */
  ready: number;
  /** Pedidos de devolucao da maquina (jibri-down). */
  released: number;
  /** Sessoes `replay` criadas quando a gravacao ficou pronta. */
  replays: number;
};

export const EMPTY_RECORDINGS_RESULT: WebinarRecordingsResult = { alerted: 0, failed: 0, pendingMigration: false, prepared: 0, purged: 0, ready: 0, released: 0, replays: 0 };

type TickContext = {
  bunny: BunnyStreamClient | null;
  db: WebinarsDb;
  dispatcher: RecorderDispatcher | null;
  now: Date;
  nowIso: string;
  nowMs: number;
  result: WebinarRecordingsResult;
  signal?: AbortSignal;
  webinar(id: string): Promise<WebinarRow | null>;
};

function isMissingWebinars(error: unknown) {
  return isPendingMigrationError(error) || isMissingWebinarSchema(error);
}

/** Item a item: para no fim do orcamento; uma falha vira log (a migracao pendente sobe para o tick inteiro). */
async function eachItem<T>(ctx: TickContext, items: readonly T[], label: (item: T) => string, run: (item: T) => Promise<void>) {
  for (const item of items) {
    if (ctx.signal?.aborted) {
      break;
    }

    try {
      await run(item);
    } catch (error) {
      if (isMissingWebinars(error)) {
        throw error;
      }

      console.error(`[webinarios] gravacoes: ${label(item)}: ${describeError(error)}`);
    }
  }
}

/* ------------------------------------------------------------------------------------------------
 * 1. Preparar automatico
 * ---------------------------------------------------------------------------------------------- */

/** A maquina pronta de uma live remarcada e devolvida quando o proximo preparo esta a mais que isto (ela nao fica ligada ate a nova data). */
export const RECORDER_RESCHEDULE_RELEASE_MINUTES = 60;

/**
 * A maquina foi devolvida porque a live foi remarcada (shouldReleaseRecorder: `ready` com a sessao agendada longe): o
 * pedido de devolucao veio antes do preparo da nova data menos 60 min. Uma devolucao pedida pela equipe dentro da
 * janela (Desligar o gravador perto da hora) nao conta: o preparo automatico nao pede outra maquina sozinho.
 */
function releasedForReschedule(session: SessionRow): boolean {
  if (session.status !== "scheduled" || recorderStatusOf(session.recorder_status) !== "gone" || !session.recorder_release_requested_at) {
    return false;
  }
  const prepareAt = toTime(session.scheduled_at) - RECORDER_RULES.prepareLeadMinutes * MINUTE_MS;
  return toTime(session.recorder_release_requested_at) <= prepareAt - RECORDER_RESCHEDULE_RELEASE_MINUTES * MINUTE_MS;
}

/** A sessao ainda sem maquina pedida (none, nunca pedida) ou com a maquina devolvida pela remarcacao (gone). */
function waitsForRecorder(session: SessionRow): boolean {
  return session.kind === "live" && ((recorderStatusOf(session.recorder_status) === "none" && !session.recorder_requested_at) || releasedForReschedule(session));
}

/**
 * A sessao pede maquina agora: live, sem maquina (ou com a devolvida pela remarcacao), webinario publicado com "Gravar
 * automaticamente", na janela.
 */
export function shouldPrepareRecorder(session: SessionRow, webinar: WebinarRow | null, nowMs: number): boolean {
  if (!waitsForRecorder(session)) {
    return false;
  }

  if (!webinar || webinar.status !== "published" || webinar.cancelled_at || webinar.deleted_at || !webinar.auto_record) {
    return false;
  }

  if (session.status !== "scheduled" && session.status !== "waiting" && session.status !== "live") {
    return false;
  }

  const startsAt = toTime(session.scheduled_at);
  const endsAt = liveSessionEndsAtMs({ scheduledAt: session.scheduled_at, startedAt: session.started_at }, webinar.duration_minutes);

  return startsAt - RECORDER_RULES.prepareLeadMinutes * MINUTE_MS <= nowMs && nowMs < endsAt;
}

async function prepareRecorders(ctx: TickContext, dispatcher: RecorderDispatcher) {
  const sessions = await listSessionRowsBetween(ctx.db, {
    from: new Date(ctx.nowMs - RECORDER_PREPARE_LOOKBACK_MS).toISOString(),
    statuses: ["scheduled", "waiting", "live"],
    to: new Date(ctx.nowMs + RECORDER_RULES.prepareLeadMinutes * MINUTE_MS).toISOString()
  });
  const candidates = sessions.filter(waitsForRecorder);

  await eachItem(ctx, candidates, (session) => `preparo da sessao ${session.id}`, async (session) => {
    if (!shouldPrepareRecorder(session, await ctx.webinar(session.webinar_id), ctx.nowMs)) {
      return;
    }

    const outcome = await dispatcher.request(session.id);

    if (!outcome.ok) {
      console.error(`[webinarios] gravador da sessao ${session.id} nao pedido (${outcome.reason}${outcome.status ? ` ${outcome.status}` : ""}); o tick tenta de novo.`);
      return;
    }

    // Um `ready` que chegou antes desta linha ja gravou a hora do pedido: a troca so vale se ainda estiver como foi lida.
    const updated = await updateRecorderStatus(ctx.db, session.id, {
      expected: [recorderStatusOf(session.recorder_status)],
      patch: { recorder_alerted_at: null, recorder_release_requested_at: null, recorder_requested_at: ctx.nowIso },
      to: "preparing"
    });

    if (updated) {
      ctx.result.prepared += 1;
    }
  });
}

/* ------------------------------------------------------------------------------------------------
 * 2. A codificacao na Bunny
 * ---------------------------------------------------------------------------------------------- */

/** Biblioteca e video da gravacao: os ids gravados pelo webhook, ou o endereco do player colado pela equipe. */
export function bunnyRefOfRecording(recording: Pick<RecordingRow, "bunny_library_id" | "bunny_video_id" | "embed_url">, fallbackLibraryId: string | null): { libraryId: string; videoId: string } | null {
  if (recording.bunny_video_id) {
    const libraryId = recording.bunny_library_id ?? fallbackLibraryId;
    return libraryId ? { libraryId, videoId: recording.bunny_video_id } : null;
  }

  return parseBunnyEmbed(recording.embed_url);
}

/** O endereco do player da Bunny para a gravacao que ficou pronta (so com ids validos). */
export function bunnyEmbedUrl(libraryId: string, videoId: string): string | null {
  return /^\d{1,12}$/.test(libraryId) && /^[0-9a-f-]{8,80}$/i.test(videoId) ? `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId.toLowerCase()}` : null;
}

/** Atualiza a gravacao so se ela ainda estiver `processing` (a equipe pode ter trocado o video pelo console). */
async function patchProcessingRecording(db: WebinarsDb, id: string, patch: Partial<RecordingRow>): Promise<RecordingRow | null> {
  const { data, error } = await db.from("webinar_recordings").update(patch).eq("id", id).eq("status", "processing").select(RECORDING_COLUMNS);
  assertNoDbError(error, "Webinarios: gravar a consulta da Bunny");
  return ((data ?? []) as RecordingRow[])[0] ?? null;
}

/** Liga a gravacao a sessao quando a sessao ainda nao tem nenhuma. */
async function linkSessionRecording(db: WebinarsDb, sessionId: string, recordingId: string): Promise<void> {
  const { error } = await db.from("webinar_sessions").update({ recording_id: recordingId }).eq("id", sessionId).is("recording_id", null);
  assertNoDbError(error, "Webinarios: ligar a gravacao a sessao");
}

async function checkRecording(ctx: TickContext, bunny: BunnyStreamClient, recording: RecordingRow) {
  const ref = bunnyRefOfRecording(recording, bunny.libraryId);
  const gaveUp = ctx.nowMs - toTime(recording.created_at) > RECORDER_RULES.bunnyGiveUpHours * HOUR_MS;
  // undefined = sem resposta que diga algo (rede, tempo, 5xx): fica para a proxima consulta.
  let video: BunnyVideo | null | undefined;

  if (ref) {
    try {
      video = await bunny.getVideo(ref.libraryId, ref.videoId, { signal: ctx.signal });
    } catch (error) {
      if (!(error instanceof BunnyStreamError)) {
        throw error;
      }
      console.warn(`[webinarios] gravacao ${recording.id}: ${error.message}`);
    }
  }

  const fail = async (message: string) => {
    if (await patchProcessingRecording(ctx.db, recording.id, { checked_at: ctx.nowIso, error_message: message, status: "failed" })) {
      ctx.result.failed += 1;
      console.warn(`[webinarios] gravacao ${recording.id} falhou na Bunny: ${message}`);
    }
  };

  if (video === null) {
    await fail(RECORDINGS_TICK_MESSAGES.bunnyMissing);
    return;
  }

  if (video?.status === BUNNY_VIDEO_STATUS.finished && ref) {
    const ready = await patchProcessingRecording(ctx.db, recording.id, {
      checked_at: ctx.nowIso,
      duration_seconds: video.lengthSeconds ?? recording.duration_seconds,
      embed_url: recording.embed_url ?? bunnyEmbedUrl(ref.libraryId, ref.videoId),
      error_message: null,
      status: "ready"
    });

    if (!ready) {
      return;
    }

    ctx.result.ready += 1;

    if (recording.session_id) {
      const session = await fetchSessionRow(ctx.db, recording.session_id);

      // So com a sessao encerrada: ligar uma live ainda no ar faria o encerramento medir a duracao pelo video.
      if (session && (session.status === "ended" || session.status === "cancelled")) {
        await linkSessionRecording(ctx.db, recording.session_id, recording.id);

        if (await createReplayForSession(ctx.db, recording.session_id, ctx.now)) {
          ctx.result.replays += 1;
        }
      }
    }

    return;
  }

  if (video?.status === BUNNY_VIDEO_STATUS.error) {
    await fail(RECORDINGS_TICK_MESSAGES.bunnyError);
    return;
  }

  if (video?.status === BUNNY_VIDEO_STATUS.uploadFailed) {
    await fail(RECORDINGS_TICK_MESSAGES.bunnyUploadFailed);
    return;
  }

  if (gaveUp) {
    await fail(RECORDINGS_TICK_MESSAGES.gaveUp);
    return;
  }

  await patchProcessingRecording(ctx.db, recording.id, { checked_at: ctx.nowIso });
}

async function checkProcessingRecordings(ctx: TickContext, bunny: BunnyStreamClient) {
  const checkedBefore = ctx.nowMs - RECORDER_RULES.bunnyCheckEveryMinutes * MINUTE_MS;
  const due = (await listProcessingRecordings(ctx.db, RECORDINGS_BATCH)).filter((recording) => !recording.checked_at || toTime(recording.checked_at) <= checkedBefore);

  await eachItem(ctx, due, (recording) => `consulta da gravacao ${recording.id}`, (recording) => checkRecording(ctx, bunny, recording));
}

/* ------------------------------------------------------------------------------------------------
 * 3. Devolver a maquina
 * ---------------------------------------------------------------------------------------------- */

/**
 * A maquina pode voltar: o MP4 esta na Bunny, ou ela nao gravou e a sessao encerrou ha 30 min, ou ela esta pronta
 * (`ready`, nunca `preparing`, que ainda nao tem maquina confirmada) numa live agendada cujo preparo ficou para mais de
 * 60 min daqui (remarcada para outro dia: a maquina nao fica ligada ate la; o preparo automatico pede outra na nova
 * janela); sem pedido recente.
 */
export function shouldReleaseRecorder(session: SessionRow, nowMs: number): boolean {
  const status = recorderStatusOf(session.recorder_status);

  if (session.kind !== "live" || !canReleaseRecorder(status)) {
    return false;
  }

  if (session.recorder_release_requested_at && nowMs - toTime(session.recorder_release_requested_at) < RECORDER_RULES.releaseRetryMinutes * MINUTE_MS) {
    return false;
  }

  if (status === "uploaded") {
    return true;
  }

  if (status === "ready" && session.status === "scheduled") {
    const prepareAt = toTime(session.scheduled_at) - RECORDER_RULES.prepareLeadMinutes * MINUTE_MS;
    return Number.isFinite(prepareAt) && prepareAt - nowMs > RECORDER_RESCHEDULE_RELEASE_MINUTES * MINUTE_MS;
  }

  const finished = session.status === "ended" || session.status === "cancelled";
  const finishedAt = toTime(session.ended_at ?? session.updated_at);

  return finished && Number.isFinite(finishedAt) && nowMs - finishedAt >= RECORDER_IDLE_RELEASE_MINUTES * MINUTE_MS;
}

async function releaseRecorders(ctx: TickContext, dispatcher: RecorderDispatcher) {
  const sessions = (await listLiveSessionsByRecorder(ctx.db, ["uploaded", "ready"])).filter((session) => shouldReleaseRecorder(session, ctx.nowMs));

  await eachItem(ctx, sessions, (session) => `devolucao da maquina da sessao ${session.id}`, async (session) => {
    const outcome = await dispatcher.release(session.id);

    if (!outcome.ok) {
      console.error(`[webinarios] maquina da sessao ${session.id} nao devolvida (${outcome.reason}${outcome.status ? ` ${outcome.status}` : ""}); o tick tenta de novo.`);
      return;
    }

    await updateLiveSession(ctx.db, session.id, { recorder_release_requested_at: ctx.nowIso });
    ctx.result.released += 1;
  });
}

/* ------------------------------------------------------------------------------------------------
 * 4. Aviso de 6 h
 * ---------------------------------------------------------------------------------------------- */

/** A maquina passou de 6 h e este pedido de maquina ainda nao foi avisado. */
export function shouldAlertRecorder(session: SessionRow, nowMs: number): boolean {
  const requestedAt = session.recorder_requested_at ?? null;

  if (!recorderOverdue({ nowMs, requestedAt, status: recorderStatusOf(session.recorder_status) })) {
    return false;
  }

  return !session.recorder_alerted_at || toTime(session.recorder_alerted_at) < toTime(requestedAt);
}

/** `webinar:<sessao>:recorder_6h:<recorder_requested_at>`: um aviso por pedido de maquina. */
export function recorderAlertDedupeKey(sessionId: string, requestedAt: string): string {
  const time = toTime(requestedAt);
  return `webinar:${sessionId}:recorder_6h:${Number.isFinite(time) ? new Date(time).toISOString() : requestedAt}`;
}

/** Quem recebe o aviso: o Apresentador e os co-apresentadores validos; sem nenhum, quem criou o webinario. */
async function alertRecipients(ctx: TickContext, webinar: WebinarRow): Promise<string[]> {
  const presenters = await listPresenterRows(ctx.db, [webinar.id]);
  const coHosts = presenters
    .filter((presenter) => presenter.webinar_id === webinar.id && presenter.role === "co_host" && (!presenter.valid_until || toTime(presenter.valid_until) > ctx.nowMs))
    .map((presenter) => presenter.user_id);
  const people = [...new Set([webinar.host_user_id, ...coHosts].filter((id): id is string => Boolean(id)))];

  return people.length > 0 ? people : webinar.created_by ? [webinar.created_by] : [];
}

async function alertForgottenRecorders(ctx: TickContext) {
  const alive = RECORDER_STATUSES.filter((status) => recorderMachineAlive(status));
  const sessions = (await listLiveSessionsByRecorder(ctx.db, alive)).filter((session) => shouldAlertRecorder(session, ctx.nowMs));

  await eachItem(ctx, sessions, (session) => `aviso de 6 h da sessao ${session.id}`, async (session) => {
    const webinar = await ctx.webinar(session.webinar_id);

    if (!webinar) {
      return;
    }

    const requestedAt = session.recorder_requested_at as string;
    const rows: NotificationInsert[] = (await alertRecipients(ctx, webinar)).map((userId) => ({
      body: WEBINAR_COPY.sino.gravadorEsquecido(webinar.title),
      dedupe_key: recorderAlertDedupeKey(session.id, requestedAt),
      expires_at: new Date(ctx.nowMs + ALERT_EXPIRES_MS).toISOString(),
      href: webinarConsoleHref(webinar.id),
      kind: "webinar",
      payload: { kind: "recorder_6h", sessionId: session.id, webinarId: webinar.id },
      title: WEBINAR_COPY.sino.tituloGravadorEsquecido,
      user_id: userId
    }));

    if (rows.length > 0) {
      await insertNotificationRows(ctx.db, rows);
    } else {
      console.warn(`[webinarios] maquina da sessao ${session.id} ligada ha mais de 6 h e ninguem para avisar no sino.`);
    }

    await updateLiveSession(ctx.db, session.id, { recorder_alerted_at: ctx.nowIso });
    ctx.result.alerted += 1;
  });
}

/* ------------------------------------------------------------------------------------------------
 * 5. Retencao
 * ---------------------------------------------------------------------------------------------- */

async function markPurged(db: WebinarsDb, id: string, nowIso: string): Promise<boolean> {
  const { data, error } = await db.from("webinar_recordings").update({ purged_at: nowIso }).eq("id", id).is("purged_at", null).select("id");
  assertNoDbError(error, "Webinarios: marcar a gravacao apagada");
  return (data ?? []).length > 0;
}

async function purgeRecordings(ctx: TickContext, bunny: BunnyStreamClient) {
  const recordings = await listRecordingsToPurge(ctx.db, ctx.nowIso, RECORDINGS_BATCH);

  await eachItem(ctx, recordings, (recording) => `retencao da gravacao ${recording.id}`, async (recording) => {
    // So o video que o nosso gravador subiu (a lista ja filtra; a conferencia fica aqui tambem por seguranca).
    if (recording.source !== "jibri") {
      return;
    }

    const ref = bunnyRefOfRecording(recording, bunny.libraryId);

    if (ref) {
      try {
        await bunny.deleteVideo(ref.libraryId, ref.videoId, { signal: ctx.signal });
      } catch (error) {
        if (!(error instanceof BunnyStreamError)) {
          throw error;
        }
        console.warn(`[webinarios] gravacao ${recording.id} nao apagada na Bunny (tenta na proxima hora): ${error.message}`);
        return;
      }
    }

    if (await markPurged(ctx.db, recording.id, ctx.nowIso)) {
      ctx.result.purged += 1;
    }
  });
}

/* ------------------------------------------------------------------------------------------------
 * O tick
 * ---------------------------------------------------------------------------------------------- */

/**
 * Um tick do gravador e das gravacoes. `dispatcher` e recorderDispatcherFrom(process.env) e `bunny` e
 * bunnyStreamFrom(process.env) no job; nulos, os passos que dependem deles nao rodam. `now`/`signal` vem do tick.
 */
export async function runRecordingsTick(input: {
  bunny?: BunnyStreamClient | null;
  db: WebinarsDb;
  dispatcher?: RecorderDispatcher | null;
  now?: Date;
  signal?: AbortSignal;
}): Promise<WebinarRecordingsResult> {
  const now = input.now ?? new Date();
  const result: WebinarRecordingsResult = { ...EMPTY_RECORDINGS_RESULT };

  if (input.signal?.aborted) {
    return result;
  }

  const webinars = new Map<string, Promise<WebinarRow | null>>();
  const ctx: TickContext = {
    bunny: input.bunny ?? null,
    db: input.db,
    dispatcher: input.dispatcher ?? null,
    now,
    nowIso: now.toISOString(),
    nowMs: now.getTime(),
    result,
    signal: input.signal,
    webinar(id) {
      let row = webinars.get(id);

      if (!row) {
        row = fetchWebinarRow(input.db, id);
        webinars.set(id, row);
      }

      return row;
    }
  };

  try {
    if (ctx.dispatcher) {
      await prepareRecorders(ctx, ctx.dispatcher);
    }

    if (ctx.bunny && !ctx.signal?.aborted) {
      await checkProcessingRecordings(ctx, ctx.bunny);
    }

    if (ctx.dispatcher && !ctx.signal?.aborted) {
      await releaseRecorders(ctx, ctx.dispatcher);
    }

    if (!ctx.signal?.aborted) {
      await alertForgottenRecorders(ctx);
    }

    if (ctx.bunny && !ctx.signal?.aborted && now.getUTCMinutes() === RECORDINGS_PURGE_MINUTE) {
      await purgeRecordings(ctx, ctx.bunny);
    }
  } catch (error) {
    if (isMissingWebinars(error)) {
      console.info(`[webinarios] tabelas do gravador ausentes (migracao ${WEBINARS_MIGRATION} pendente); nada a fazer.`);

      return { ...EMPTY_RECORDINGS_RESULT, pendingMigration: true };
    }

    throw error;
  }

  return result;
}
