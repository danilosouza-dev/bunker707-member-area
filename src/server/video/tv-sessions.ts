import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { LessonVideoConfig, LessonWatchStatus } from "@/lib/platform-types";
import {
  isTvPlaybackRate,
  normalizeTvPlaybackRates,
  type TvCommand
} from "@/lib/tv-session-contract";
import { requireLessonAccess } from "@/server/access/lesson-access";
import { getSupabaseAdminClient } from "@/server/db/supabase/client";
import { replaceCompletedLessons } from "@/server/db/platform-store";

const PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_CODE_LENGTH = 6;
const PAIRING_WINDOW_MS = 10 * 60 * 1000;
const SESSION_WINDOW_MS = 4 * 60 * 60 * 1000;

export type TvPlaybackState = "buffering" | "ended" | "paused" | "playing" | "unstarted";
export type TvSessionStatus = "connected" | "ended" | "pending";
export type { TvCommand } from "@/lib/tv-session-contract";

type TvSessionRow = {
  available_playback_rates: Array<number | string>;
  command_revision: number | string;
  connected_at: string | null;
  content_id: string;
  created_at: string;
  current_time_seconds: number | string;
  duration_seconds: number | string;
  ended_at: string | null;
  expires_at: string;
  id: string;
  last_command: TvCommand | null;
  lesson_id: string;
  pairing_code: string;
  pairing_expires_at: string;
  playback_rate: number | string;
  playback_state: TvPlaybackState;
  receiver_command_revision: number | string;
  receiver_last_seen_at: string | null;
  receiver_token_hash: string | null;
  status: TvSessionStatus;
  updated_at: string;
  user_id: string;
};

export type SafeTvSession = {
  availablePlaybackRates: number[];
  commandRevision: number;
  connectedAt: string | null;
  contentId: string;
  createdAt: string;
  currentTimeSeconds: number;
  durationSeconds: number;
  endedAt: string | null;
  expiresAt: string;
  id: string;
  lastCommand: TvCommand | null;
  lessonId: string;
  pairingCode: string;
  pairingExpiresAt: string;
  playbackRate: number;
  playbackState: TvPlaybackState;
  receiverCommandRevision: number;
  receiverLastSeenAt: string | null;
  status: TvSessionStatus;
};

export type TvReceiverLesson = {
  durationLabel: string;
  id: string;
  posterUrl: string | null;
  title: string;
  video: {
    assetId: string;
    provider: "youtube";
  };
};

export class TvSessionError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "TvSessionError";
    this.status = status;
  }
}

function throwDatabaseError(error: { message: string } | null, context: string) {
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
}

function getNumber(value: number | string) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeSession(row: TvSessionRow): SafeTvSession {
  const playbackRateValue = getNumber(row.playback_rate);
  const playbackRate = isTvPlaybackRate(playbackRateValue) ? playbackRateValue : 1;
  const availablePlaybackRates = normalizeTvPlaybackRates([
    ...normalizeTvPlaybackRates(row.available_playback_rates),
    playbackRate
  ]);

  return {
    availablePlaybackRates,
    commandRevision: getNumber(row.command_revision),
    connectedAt: row.connected_at,
    contentId: row.content_id,
    createdAt: row.created_at,
    currentTimeSeconds: getNumber(row.current_time_seconds),
    durationSeconds: getNumber(row.duration_seconds),
    endedAt: row.ended_at,
    expiresAt: row.expires_at,
    id: row.id,
    lastCommand: row.last_command,
    lessonId: row.lesson_id,
    pairingCode: row.pairing_code,
    pairingExpiresAt: row.pairing_expires_at,
    playbackRate,
    playbackState: row.playback_state,
    receiverCommandRevision: getNumber(row.receiver_command_revision),
    receiverLastSeenAt: row.receiver_last_seen_at,
    status: row.status
  };
}

function createPairingCode() {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  return Array.from(bytes, (byte) => PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length]).join("");
}

function hashReceiverToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function extractYouTubeId(videoConfig: LessonVideoConfig | null) {
  const candidates = [videoConfig?.assetId, videoConfig?.url];

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) continue;
    if (/^[\w-]{11}$/.test(value)) return value;

    try {
      const url = new URL(value);
      const hostname = url.hostname.replace(/^www\./, "");

      if (hostname === "youtu.be") {
        const id = url.pathname.split("/").filter(Boolean)[0] ?? "";
        if (/^[\w-]{11}$/.test(id)) return id;
      }

      if (hostname === "youtube.com" || hostname.endsWith(".youtube.com") || hostname === "youtube-nocookie.com") {
        const queryId = url.searchParams.get("v") ?? "";
        if (/^[\w-]{11}$/.test(queryId)) return queryId;

        const pathId = url.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/)?.[1] ?? "";
        if (/^[\w-]{11}$/.test(pathId)) return pathId;
      }
    } catch {
      const match = value.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?.*?v=|embed\/|shorts\/|live\/))([\w-]{11})/i);
      if (match?.[1]) return match[1];
    }
  }

  return "";
}

function sanitizeInitialMetric(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 86_400);
}

async function endExistingSessions(userId: string) {
  const now = new Date().toISOString();
  const result = await getSupabaseAdminClient()
    .from("tv_sessions")
    .update({ ended_at: now, status: "ended" })
    .eq("user_id", userId)
    .in("status", ["pending", "connected"]);
  throwDatabaseError(result.error, "Nao foi possivel encerrar a sessao de TV anterior");
}

export async function createTvSession({
  contentId,
  currentTimeSeconds,
  durationSeconds,
  lessonId,
  userId
}: {
  contentId: string;
  currentTimeSeconds?: number;
  durationSeconds?: number;
  lessonId: string;
  userId: string;
}) {
  const access = await requireLessonAccess({ contentId, lessonId, userId });
  const youTubeId = access.videoConfig?.provider === "youtube"
    ? extractYouTubeId(access.videoConfig)
    : "";

  if (!youTubeId) {
    throw new TvSessionError("O Modo TV não está disponível para esta aula.", 409);
  }

  await endExistingSessions(userId);

  const now = Date.now();
  const supabase = getSupabaseAdminClient();
  const row = {
    available_playback_rates: [1],
    content_id: contentId,
    current_time_seconds: sanitizeInitialMetric(currentTimeSeconds),
    duration_seconds: sanitizeInitialMetric(durationSeconds),
    expires_at: new Date(now + SESSION_WINDOW_MS).toISOString(),
    lesson_id: lessonId,
    pairing_expires_at: new Date(now + PAIRING_WINDOW_MS).toISOString(),
    playback_rate: 1,
    playback_state: "paused" satisfies TvPlaybackState,
    status: "pending" satisfies TvSessionStatus,
    user_id: userId
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await supabase
      .from("tv_sessions")
      .insert({ ...row, pairing_code: createPairingCode() })
      .select("*")
      .single();

    if (!result.error && result.data) {
      return normalizeSession(result.data as TvSessionRow);
    }

    if (result.error?.code !== "23505") {
      throwDatabaseError(result.error, "Nao foi possivel criar a sessao de TV");
    }
  }

  throw new Error("Nao foi possivel gerar um codigo de TV unico.");
}

export async function getOwnerTvSession(sessionId: string, userId: string) {
  const result = await getSupabaseAdminClient()
    .from("tv_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel carregar a sessao de TV");

  if (!result.data) {
    throw new TvSessionError("Sessao de TV nao encontrada.", 404);
  }

  return normalizeSession(result.data as TvSessionRow);
}

export async function sendTvCommand(sessionId: string, userId: string, command: TvCommand) {
  const result = await getSupabaseAdminClient().rpc("send_tv_session_command", {
    p_command: command,
    p_session_id: sessionId,
    p_user_id: userId
  });
  throwDatabaseError(result.error, "Nao foi possivel enviar o comando para a TV");
  const row = (result.data as TvSessionRow[] | null)?.[0];

  if (!row) {
    throw new TvSessionError("A TV nao esta conectada ou a sessao expirou.", 409);
  }

  return normalizeSession(row);
}

export async function endTvSession(sessionId: string, userId: string) {
  const now = new Date().toISOString();
  const result = await getSupabaseAdminClient()
    .from("tv_sessions")
    .update({ ended_at: now, status: "ended" })
    .eq("id", sessionId)
    .eq("user_id", userId)
    .neq("status", "ended")
    .select("*")
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel encerrar a sessao de TV");

  if (result.data) return normalizeSession(result.data as TvSessionRow);
  return getOwnerTvSession(sessionId, userId);
}

async function getReceiverLesson(session: SafeTvSession): Promise<TvReceiverLesson> {
  const result = await getSupabaseAdminClient()
    .from("lessons")
    .select("duration,id,image,title,video_config")
    .eq("id", session.lessonId)
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel carregar a aula na TV");

  if (!result.data) {
    throw new TvSessionError("A aula desta sessao nao esta mais disponivel.", 404);
  }

  const videoConfig = result.data.video_config as LessonVideoConfig | null;
  const assetId = videoConfig?.provider === "youtube" ? extractYouTubeId(videoConfig) : "";

  if (!assetId) {
    throw new TvSessionError("Esta aula nao pode ser reproduzida no Modo TV.", 409);
  }

  return {
    durationLabel: result.data.duration,
    id: result.data.id,
    posterUrl: result.data.image ?? null,
    title: result.data.title,
    video: { assetId, provider: "youtube" }
  };
}

export async function connectTvReceiver(pairingCode: string) {
  const receiverToken = randomBytes(32).toString("base64url");
  const result = await getSupabaseAdminClient().rpc("connect_tv_session", {
    p_pairing_code: pairingCode,
    p_receiver_token_hash: hashReceiverToken(receiverToken)
  });
  throwDatabaseError(result.error, "Nao foi possivel conectar a TV");
  const row = (result.data as TvSessionRow[] | null)?.[0];

  if (!row) {
    throw new TvSessionError("Codigo invalido, expirado ou ja utilizado.", 404);
  }

  const session = normalizeSession(row);

  try {
    await requireLessonAccess({
      contentId: session.contentId,
      lessonId: session.lessonId,
      userId: row.user_id
    });
    const lesson = await getReceiverLesson(session);
    return { lesson, receiverToken, session };
  } catch (error) {
    await endTvSession(session.id, row.user_id).catch(() => undefined);
    throw error;
  }
}

async function getReceiverRow(sessionId: string, receiverToken: string) {
  if (!receiverToken || receiverToken.length < 32) {
    throw new TvSessionError("Token da TV obrigatorio.", 401);
  }

  const result = await getSupabaseAdminClient()
    .from("tv_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("receiver_token_hash", hashReceiverToken(receiverToken))
    .maybeSingle();
  throwDatabaseError(result.error, "Nao foi possivel validar a TV");

  if (!result.data) {
    throw new TvSessionError("Sessao de TV invalida.", 401);
  }

  const row = result.data as TvSessionRow;

  if (row.status !== "ended" && new Date(row.expires_at).getTime() <= Date.now()) {
    await endTvSession(row.id, row.user_id);
    throw new TvSessionError("A sessao de TV expirou.", 410);
  }

  return row;
}

export async function getTvReceiverSession(sessionId: string, receiverToken: string, includeLesson = false) {
  const row = await getReceiverRow(sessionId, receiverToken);
  const session = normalizeSession(row);
  const lesson = includeLesson && session.status !== "ended"
    ? await (async () => {
        await requireLessonAccess({
          contentId: row.content_id,
          lessonId: row.lesson_id,
          userId: row.user_id
        });
        return getReceiverLesson(session);
      })()
    : undefined;
  return {
    ...(lesson ? { lesson } : {}),
    session
  };
}

export async function updateTvReceiverState({
  appliedCommandRevision,
  availablePlaybackRates,
  currentTimeSeconds,
  durationSeconds,
  playbackRate,
  playbackState,
  receiverToken,
  sessionId
}: {
  appliedCommandRevision: number;
  availablePlaybackRates: number[];
  currentTimeSeconds: number;
  durationSeconds: number;
  playbackRate: number;
  playbackState: TvPlaybackState;
  receiverToken: string;
  sessionId: string;
}) {
  const row = await getReceiverRow(sessionId, receiverToken);

  if (row.status !== "connected") {
    throw new TvSessionError("A sessao de TV foi encerrada.", 410);
  }

  const safeDuration = sanitizeInitialMetric(durationSeconds);
  const safeCurrentTime = Math.min(sanitizeInitialMetric(currentTimeSeconds), safeDuration > 0 ? safeDuration : 86_400);
  const safePlaybackRate = isTvPlaybackRate(playbackRate) ? playbackRate : 1;
  const safeAvailablePlaybackRates = normalizeTvPlaybackRates([
    ...availablePlaybackRates,
    safePlaybackRate
  ]);
  const safeAppliedRevision = Math.min(
    Math.max(Math.round(appliedCommandRevision), 0),
    getNumber(row.command_revision)
  );
  const now = new Date().toISOString();
  const updateResult = await getSupabaseAdminClient()
    .from("tv_sessions")
    .update({
      available_playback_rates: safeAvailablePlaybackRates,
      current_time_seconds: safeCurrentTime,
      duration_seconds: safeDuration,
      playback_rate: safePlaybackRate,
      playback_state: playbackState,
      receiver_command_revision: safeAppliedRevision,
      receiver_last_seen_at: now
    })
    .eq("id", sessionId)
    .eq("receiver_token_hash", hashReceiverToken(receiverToken))
    .eq("status", "connected")
    .select("*")
    .maybeSingle();
  throwDatabaseError(updateResult.error, "Nao foi possivel atualizar a reproducao na TV");

  if (!updateResult.data) {
    throw new TvSessionError("A sessao de TV foi encerrada.", 410);
  }

  const completed = playbackState === "ended" || (safeDuration > 0 && safeCurrentTime >= safeDuration - 1);
  const progressPercent = completed
    ? 100
    : safeDuration > 0
      ? Math.min(Math.max(Math.round((safeCurrentTime / safeDuration) * 100), safeCurrentTime > 0 ? 1 : 0), 99)
      : safeCurrentTime > 0 ? 1 : 0;
  const status: LessonWatchStatus = completed ? "completed" : "in_progress";

  await replaceCompletedLessons({
    contentId: row.content_id,
    durationSeconds: safeDuration || undefined,
    lessonId: row.lesson_id,
    maxProgressPercent: progressPercent,
    progressPercent,
    progressSeconds: safeCurrentTime,
    status,
    userId: row.user_id
  });

  return normalizeSession(updateResult.data as TvSessionRow);
}
