"use server";

// A gravacao no computador de quem apresenta, enviada para a Bunny pelo console (docs/30 D142). O arquivo nunca passa pelo
// nosso servidor: aqui so nasce o video vazio na Bunny, a linha da gravacao (`uploading`) e a autorizacao do envio com
// retomada (a assinatura, nunca a chave). Depois do ultimo pedaco, a linha vira `processing` e o job webinar-recordings
// segue como sempre: pronta na Bunny, ela toma o lugar da do gravador (promoteLocalRecording). [messaging.write]

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { recordAudit } from "@/server/audit/log";
import { BUNNY_VIDEO_STATUS, bunnyStreamFrom, type BunnyStreamClient, type BunnyUploadTicket } from "./bunny-stream";
import { invalidateWebinars } from "./cache";
import { WebinarError, assertNoDbError, webinarsDb, type WebinarsDb } from "./db";
import { LIVE_ACTION_MESSAGES } from "./live-console-model";
import { finishLocalUploadSchema, prepareLocalUploadSchema } from "./live-schemas";
import { RECORDING_COLUMNS, type RecordingRow, type SessionRow } from "./rows";
import { runWebinarAction } from "./run-webinar-action";
import { fetchSessionRow, insertRecordingRow, requireWebinarRow, updateRecordingRow } from "./store";

const LIST_PATH = "/admin/comunicacao/webinarios";
/** O prazo do envio na Bunny: ela guarda um envio parado por cerca de 48 h, e a assinatura nova nao estende. */
const UPLOAD_TICKET_SECONDS = 47 * 60 * 60;
const ANCHOR_LIMIT_MS = 3_600_000;

export type LocalUploadPrepared = { done: true } | { done: false; ticket: BunnyUploadTicket };

async function liveSession(db: WebinarsDb, sessionId: string): Promise<SessionRow> {
  const row = await fetchSessionRow(db, sessionId);

  if (!row) {
    throw new WebinarError(LIVE_ACTION_MESSAGES.sessionMissing, 404);
  }

  if (row.kind !== "live") {
    throw new WebinarError(LIVE_ACTION_MESSAGES.notLive, 409);
  }

  return row;
}

async function localRow(db: WebinarsDb, sessionId: string, fileName: string): Promise<RecordingRow | null> {
  const { data, error } = await db
    .from("webinar_recordings")
    .select(RECORDING_COLUMNS)
    .eq("session_id", sessionId)
    .eq("source", "upload")
    .eq("file_name", fileName)
    .order("created_at", { ascending: false })
    .limit(1);
  assertNoDbError(error, "Webinarios: ler a gravacao do computador");
  return ((data ?? []) as RecordingRow[])[0] ?? null;
}

function bunny(): BunnyStreamClient {
  const client = bunnyStreamFrom(process.env);

  if (!client) {
    throw new WebinarError(LIVE_ACTION_MESSAGES.bunnyMissing, 409);
  }

  return client;
}

async function createVideo(client: BunnyStreamClient, title: string): Promise<string> {
  try {
    return await client.createVideo(title);
  } catch (error) {
    console.error("[webinarios] gravacao no computador: criar o video na Bunny:", error instanceof Error ? error.message : error);
    throw new WebinarError(LIVE_ACTION_MESSAGES.bunnyUnreachable, 409);
  }
}

/** O arquivo ja chegou inteiro na Bunny (a ultima resposta se perdeu no caminho)? Sem resposta dela, nao. */
async function alreadyThere(client: BunnyStreamClient, row: RecordingRow): Promise<boolean> {
  if (!row.bunny_library_id || !row.bunny_video_id) {
    return false;
  }

  try {
    const video = await client.getVideo(row.bunny_library_id, row.bunny_video_id);
    return video !== null && video.status !== BUNNY_VIDEO_STATUS.created && video.status !== BUNNY_VIDEO_STATUS.error && video.status !== BUNNY_VIDEO_STATUS.uploadFailed;
  } catch {
    throw new WebinarError(LIVE_ACTION_MESSAGES.bunnyUnreachable, 409);
  }
}

/** Passa a linha de `uploading` para `processing`; nulo se ela ja tinha passado. */
async function markProcessing(db: WebinarsDb, id: string): Promise<boolean> {
  const { data, error } = await db.from("webinar_recordings").update({ checked_at: null, error_message: null, status: "processing" }).eq("id", id).eq("status", "uploading").select("id");
  assertNoDbError(error, "Webinarios: concluir o envio da gravacao do computador");
  return (data ?? []).length > 0;
}

function revalidate(webinarId: string) {
  revalidatePath(`${LIST_PATH}/${webinarId}/sala`);
  invalidateWebinars({ from: "action" });
}

/** O video e a autorizacao do envio deste arquivo: os mesmos a cada retomada; `done` quando ele ja chegou inteiro. */
export async function prepareLocalUpload(input: {
  durationSeconds: number;
  fileName: string;
  fresh?: boolean;
  sessionId: string;
  sizeBytes: number;
  startedAtMs: number;
}): Promise<ActionResult<LocalUploadPrepared>> {
  return runWebinarAction("messaging.write", "atendimento", prepareLocalUploadSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const session = await liveSession(db, data.sessionId);
    const webinar = await requireWebinarRow(db, session.webinar_id);
    const client = bunny();
    const existing = await localRow(db, session.id, data.fileName);
    const expiresAt = Math.floor(Date.now() / 1000) + UPLOAD_TICKET_SECONDS;

    if (existing && existing.status !== "uploading" && existing.status !== "failed") {
      return { done: true as const };
    }

    if (existing?.status === "uploading" && data.fresh && (await alreadyThere(client, existing))) {
      await markProcessing(db, existing.id);
      revalidate(webinar.id);
      return { done: true as const };
    }

    if (existing?.status === "uploading" && !data.fresh && existing.bunny_video_id) {
      return { done: false as const, ticket: client.uploadTicket(existing.bunny_video_id, expiresAt) };
    }

    const videoId = await createVideo(client, webinar.title);
    // A posicao no video e o offset da mensagem (contado da ancora, ou do comeco da live) menos este ajuste.
    const anchor = Date.parse(session.recording_anchor_at ?? session.started_at ?? "");
    const offset = Number.isFinite(anchor) ? Math.round(data.startedAtMs - anchor) : 0;
    const fields = {
      anchor_offset_ms: Math.max(-ANCHOR_LIMIT_MS, Math.min(ANCHOR_LIMIT_MS, offset)),
      bunny_library_id: client.libraryId,
      bunny_video_id: videoId,
      duration_seconds: data.durationSeconds,
      embed_url: `https://iframe.mediadelivery.net/embed/${client.libraryId}/${videoId}`,
      size_bytes: data.sizeBytes,
      status: "uploading"
    };
    const row = existing
      ? await updateRecordingRow(db, existing.id, { ...fields, error_message: null })
      : await insertRecordingRow(db, { ...fields, file_name: data.fileName, provider: "bunny", session_id: session.id, source: "upload", webinar_id: webinar.id });

    await recordAudit(db, {
      action: "webinar.local_recording_upload_started",
      actorId: user.id,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { recording_id: row?.id ?? null, retried: existing !== null, session_id: session.id, size_bytes: data.sizeBytes }
    });

    return { done: false as const, ticket: client.uploadTicket(videoId, expiresAt) };
  });
}

/** O ultimo pedaco chegou: a Bunny codifica, o job confere e o video passa a valer. */
export async function finishLocalUpload(input: { fileName: string; sessionId: string }): Promise<ActionResult<{ changed: boolean }>> {
  return runWebinarAction("messaging.write", "atendimento", finishLocalUploadSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const session = await liveSession(db, data.sessionId);
    const row = await localRow(db, session.id, data.fileName);

    if (!row) {
      throw new WebinarError(LIVE_ACTION_MESSAGES.recordingMissing, 404);
    }

    const changed = await markProcessing(db, row.id);

    if (changed) {
      await recordAudit(db, {
        action: "webinar.local_recording_uploaded",
        actorId: user.id,
        entityId: session.webinar_id,
        entityType: "webinar",
        metadata: { recording_id: row.id, session_id: session.id }
      });
      revalidate(session.webinar_id);
    }

    return { changed };
  });
}
