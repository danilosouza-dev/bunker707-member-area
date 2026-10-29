// Linhas do banco dos Webinarios (202610280001) e a conversao para o modelo (model.ts). Modulo puro: sem
// "server-only", imports relativos; os testes carregam direto pelo Node. Quem grava e quem le as tabelas e
// store.ts/queries.ts; aqui so a forma das linhas e os mapeadores, para admin, aluno e tick lerem igual.

import { normalizeAudience, type AudienceDefinition } from "../communications/audience-model";
import { RECORDER_STATUSES, type RecorderStatus } from "./recorder-model";
import {
  ACCESS_MODES,
  CHAT_MODES,
  DISPLAY_NAME_MODES,
  SESSION_KINDS,
  SESSION_STATUSES,
  SLOW_MODE_SECONDS,
  WEBINAR_KINDS,
  WEBINAR_STATUSES,
  defaultQuality,
  defaultReminders,
  defaultRoomSettings,
  emptyReminderTexts,
  type AccessMode,
  type ChatMode,
  type DisplayNameMode,
  type PresenceSummary,
  type Quality,
  type RegistrationStatus,
  type ReminderSettings,
  type ReminderTexts,
  type ReplayLessonTarget,
  type RoomSettings,
  type SessionKind,
  type SessionStatus,
  type SlowModeSeconds,
  type Webinar,
  type WebinarDraft,
  type WebinarKind,
  type WebinarPresenter,
  type WebinarRegistration,
  type WebinarSession,
  type WebinarStatus
} from "./model";

export const WEBINAR_COLUMNS =
  "id, slug, kind, title, description, cover_url, status, host_user_id, access_mode, product_id, audience, registration_required, capacity, show_registered_count, reminders, reminder_texts, show_on_home, replay_days_on_home, show_banner, scheduled_at, duration_minutes, allow_student_camera, quality, room_settings, auto_record, replay_lesson_target, chat_retention_days, recording_retention_days, published_at, cancelled_at, cancel_reason, created_by, created_at, updated_at, deleted_at";

export type WebinarRow = {
  access_mode: string;
  allow_student_camera: boolean;
  audience: unknown;
  auto_record: boolean;
  cancel_reason: string | null;
  cancelled_at: string | null;
  capacity: number | null;
  chat_retention_days: number;
  cover_url: string | null;
  created_at: string;
  created_by: string | null;
  deleted_at: string | null;
  description: string | null;
  duration_minutes: number;
  host_user_id: string | null;
  id: string;
  kind: string;
  product_id: string | null;
  published_at: string | null;
  quality: unknown;
  recording_retention_days: number;
  registration_required: boolean;
  reminder_texts: unknown;
  reminders: unknown;
  replay_days_on_home: number;
  replay_lesson_target: unknown;
  room_settings: unknown;
  scheduled_at: string | null;
  show_banner: boolean;
  show_on_home: boolean;
  show_registered_count: boolean;
  slug: string;
  status: string;
  title: string;
  updated_at: string;
};

export const SESSION_COLUMNS =
  "id, webinar_id, kind, scheduled_at, started_at, ended_at, recording_anchor_at, status, recording_id, source_session_id, late_join_minutes, chat_mode, chat_slow_mode_seconds, show_live_badge, simulation_decided_by, simulation_decided_at, simulation_ack_text, presence_curve, script_fired_at, pinned_message_id, room_name, recorder_status, recorder_requested_at, recorder_release_requested_at, recorder_alerted_at, recording_requested_at, room_locked, browser_recording_at, created_at, updated_at";

export type SessionRow = {
  chat_mode: string;
  chat_slow_mode_seconds: number | null;
  created_at: string;
  ended_at: string | null;
  id: string;
  kind: string;
  late_join_minutes: number | null;
  pinned_message_id: string | null;
  presence_curve: unknown;
  recording_anchor_at: string | null;
  recording_id: string | null;
  /* Fase 3 (202610290002): opcionais aqui para os dubles de banco das fases 1 e 2; o banco sempre devolve. */
  recorder_alerted_at?: string | null;
  recorder_release_requested_at?: string | null;
  recorder_requested_at?: string | null;
  recorder_status?: string | null;
  recording_requested_at?: string | null;
  room_locked?: boolean | null;
  room_name?: string | null;
  /* 202610290003: a reserva Gravar no navegador ligada (o selo Gravando do aluno). */
  browser_recording_at?: string | null;
  scheduled_at: string;
  script_fired_at: string | null;
  show_live_badge: boolean;
  simulation_ack_text: string | null;
  simulation_decided_at: string | null;
  simulation_decided_by: string | null;
  source_session_id: string | null;
  started_at: string | null;
  status: string;
  updated_at: string;
  webinar_id: string;
};

export const PRESENTER_COLUMNS = "webinar_id, user_id, role, can_moderate_room, valid_until, created_at";

export type PresenterRow = {
  can_moderate_room: boolean;
  created_at: string;
  role: string;
  user_id: string;
  valid_until: string | null;
  webinar_id: string;
};

export const REGISTRATION_COLUMNS =
  "id, webinar_id, session_id, user_id, status, source, source_campaign_id, reminder_24h_sent_at, reminder_1h_sent_at, started_notice_sent_at, cancelled_notice_sent_at, calendar_token, registered_at, cancelled_at, created_at, updated_at";

export type RegistrationRow = {
  calendar_token: string;
  cancelled_at: string | null;
  cancelled_notice_sent_at: string | null;
  created_at: string;
  id: string;
  registered_at: string;
  reminder_1h_sent_at: string | null;
  reminder_24h_sent_at: string | null;
  session_id: string | null;
  source: string | null;
  source_campaign_id: string | null;
  started_notice_sent_at: string | null;
  status: string;
  updated_at: string;
  user_id: string;
  webinar_id: string;
};

export const RECORDING_COLUMNS =
  "id, webinar_id, session_id, provider, bunny_library_id, bunny_video_id, embed_url, duration_seconds, status, source, file_name, anchor_offset_ms, size_bytes, sha256, error_message, purge_due_at, checked_at, purged_at, created_at, updated_at";

export type RecordingRow = {
  anchor_offset_ms: number;
  bunny_library_id: string | null;
  bunny_video_id: string | null;
  /* Fase 3 (202610290002): a ultima consulta a Bunny e o apagamento pela retencao. */
  checked_at?: string | null;
  created_at: string;
  duration_seconds: number | null;
  embed_url: string | null;
  error_message: string | null;
  file_name: string | null;
  id: string;
  provider: string;
  purge_due_at: string | null;
  purged_at?: string | null;
  session_id: string | null;
  sha256: string | null;
  size_bytes: number | null;
  source: string;
  status: string;
  updated_at: string;
  webinar_id: string;
};

function oneOf<T extends string | number>(values: readonly T[], value: unknown, fallback: T): T {
  return (values as readonly unknown[]).includes(value) ? (value as T) : fallback;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export function qualityOfRow(value: unknown): Quality {
  const raw = asObject(value);
  const base = defaultQuality();
  return {
    screenFps: oneOf([30, 15] as const, raw.screenFps, base.screenFps),
    stage: oneOf([720, 1080] as const, raw.stage, base.stage)
  };
}

export function roomSettingsOfRow(value: unknown): RoomSettings {
  const raw = asObject(value);
  const base = defaultRoomSettings();
  return {
    anonymousQuestions: asBoolean(raw.anonymousQuestions, base.anonymousQuestions),
    chatMode: oneOf<ChatMode>(CHAT_MODES, raw.chatMode, base.chatMode),
    displayName: oneOf<DisplayNameMode>(DISPLAY_NAME_MODES, raw.displayName, base.displayName),
    newCommentsVisible: asBoolean(raw.newCommentsVisible, base.newCommentsVisible),
    polls: asBoolean(raw.polls, base.polls),
    practiceSession: asBoolean(raw.practiceSession, base.practiceSession),
    questions: asBoolean(raw.questions, base.questions),
    reactions: asBoolean(raw.reactions, base.reactions),
    slowModeSeconds: (SLOW_MODE_SECONDS as readonly number[]).includes(raw.slowModeSeconds as number) ? (raw.slowModeSeconds as SlowModeSeconds) : null,
    waitingRoom: asBoolean(raw.waitingRoom, base.waitingRoom)
  };
}

export function remindersOfRow(value: unknown): ReminderSettings {
  const raw = asObject(value);
  const base = defaultReminders();
  return { email: asBoolean(raw.email, base.email), h1: asBoolean(raw.h1, base.h1), h24: asBoolean(raw.h24, base.h24) };
}

export function reminderTextsOfRow(value: unknown): ReminderTexts {
  const raw = asObject(value);
  const base = emptyReminderTexts();
  return {
    afterAbsent: asText(raw.afterAbsent, 600) ?? base.afterAbsent,
    afterAttended: asText(raw.afterAttended, 600) ?? base.afterAttended,
    confirmation: asText(raw.confirmation, 600) ?? base.confirmation,
    h1: asText(raw.h1, 600) ?? base.h1,
    h24: asText(raw.h24, 600) ?? base.h24,
    started: asText(raw.started, 600) ?? base.started
  };
}

export function replayLessonTargetOfRow(value: unknown): ReplayLessonTarget | null {
  const raw = asObject(value);
  const productId = asText(raw.productId, 240);
  if (!productId) {
    return null;
  }
  return {
    autoPublish: asBoolean(raw.autoPublish, false),
    moduleId: asText(raw.moduleId, 240),
    productId,
    title: asText(raw.title, 120)
  };
}

export function audienceOfRow(value: unknown): AudienceDefinition {
  const raw = asObject(value);
  if (raw.kind === "rules" && raw.root && typeof raw.root === "object") {
    return normalizeAudience(raw as unknown as AudienceDefinition);
  }
  return { kind: "everyone" };
}

export function presenterFromRow(row: PresenterRow): WebinarPresenter {
  return {
    canModerateRoom: row.can_moderate_room === true,
    role: row.role === "team" ? "team" : "co_host",
    userId: row.user_id
  };
}

/** A linha de webinars (e os apresentadores) no modelo do app. O video da Live gravada vem a parte (recording). */
export function webinarFromRow(row: WebinarRow, presenters: readonly PresenterRow[] = [], recording: RecordingRow | null = null): Webinar {
  return {
    accessMode: oneOf<AccessMode>(ACCESS_MODES, row.access_mode, "everyone"),
    allowStudentCamera: row.allow_student_camera !== false,
    audience: audienceOfRow(row.audience),
    autoRecord: row.auto_record !== false,
    cancelReason: row.cancel_reason,
    cancelledAt: row.cancelled_at,
    capacity: row.capacity,
    chatRetentionDays: row.chat_retention_days,
    coverUrl: row.cover_url,
    createdAt: row.created_at,
    createdBy: row.created_by,
    description: row.description ?? "",
    durationMinutes: row.duration_minutes,
    hostUserId: row.host_user_id,
    id: row.id,
    kind: oneOf<WebinarKind>(WEBINAR_KINDS, row.kind, "live"),
    presenters: presenters.filter((presenter) => presenter.webinar_id === row.id).map(presenterFromRow),
    productId: row.product_id,
    publishedAt: row.published_at,
    quality: qualityOfRow(row.quality),
    recordingRetentionDays: row.recording_retention_days,
    recordingVideoUrl: recording?.embed_url ?? null,
    registrationRequired: row.registration_required !== false,
    reminderTexts: reminderTextsOfRow(row.reminder_texts),
    reminders: remindersOfRow(row.reminders),
    replayDaysOnHome: row.replay_days_on_home,
    replayLessonTarget: replayLessonTargetOfRow(row.replay_lesson_target),
    roomSettings: roomSettingsOfRow(row.room_settings),
    scheduledAt: row.scheduled_at,
    // As sessoes da Live gravada vem de webinar_sessions; quem monta o rascunho do editor preenche aqui.
    sessions: [],
    showBanner: row.show_banner !== false,
    showOnHome: row.show_on_home !== false,
    showRegisteredCount: row.show_registered_count === true,
    slug: row.slug,
    status: oneOf<WebinarStatus>(WEBINAR_STATUSES, row.status, "draft"),
    title: row.title,
    updatedAt: row.updated_at
  };
}

export function sessionFromRow(row: SessionRow): WebinarSession {
  return {
    browserRecordingAt: row.browser_recording_at ?? null,
    chatMode: oneOf<ChatMode>(CHAT_MODES, row.chat_mode, "open"),
    chatSlowModeSeconds: (SLOW_MODE_SECONDS as readonly number[]).includes(row.chat_slow_mode_seconds as number) ? (row.chat_slow_mode_seconds as SlowModeSeconds) : null,
    createdAt: row.created_at,
    endedAt: row.ended_at,
    id: row.id,
    kind: oneOf<SessionKind>(SESSION_KINDS, row.kind, "live"),
    lateJoinMinutes: row.late_join_minutes,
    pinnedMessageId: row.pinned_message_id ?? null,
    presenceCurve: presenceSummaryOf(row.presence_curve),
    recordingAnchorAt: row.recording_anchor_at,
    recordingId: row.recording_id,
    recorderAlertedAt: row.recorder_alerted_at ?? null,
    recorderReleaseRequestedAt: row.recorder_release_requested_at ?? null,
    recorderRequestedAt: row.recorder_requested_at ?? null,
    recorderStatus: recorderStatusOf(row.recorder_status),
    recordingRequestedAt: row.recording_requested_at ?? null,
    roomLocked: row.room_locked === true,
    roomName: row.room_name ?? null,
    scheduledAt: row.scheduled_at,
    scriptFiredAt: row.script_fired_at ?? null,
    showLiveBadge: row.show_live_badge === true,
    simulationAckText: row.simulation_ack_text ?? null,
    simulationDecidedAt: row.simulation_decided_at ?? null,
    simulationDecidedBy: row.simulation_decided_by ?? null,
    sourceSessionId: row.source_session_id,
    startedAt: row.started_at,
    status: oneOf<SessionStatus>(SESSION_STATUSES, row.status, "scheduled"),
    updatedAt: row.updated_at,
    webinarId: row.webinar_id
  };
}

/** recorder_status da 202610290002; fora da lista (ou ausente, nos dubles antigos) vale "none". */
export function recorderStatusOf(value: unknown): RecorderStatus {
  return oneOf<RecorderStatus>(RECORDER_STATUSES, value, "none");
}

/** presence_curve congelada pela webinar_close_session (202610290001); nulo enquanto a sessao nao encerrou. */
export function presenceSummaryOf(value: unknown): PresenceSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const buckets = Array.isArray(source.buckets)
    ? source.buckets
        .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null))
        .filter((entry): entry is Record<string, unknown> => Boolean(entry))
        .map((entry) => ({ b: toCount(entry.b), n: toCount(entry.n) }))
    : [];
  const peak = source.peak && typeof source.peak === "object" ? (source.peak as Record<string, unknown>) : null;
  return {
    avgPresent: typeof source.avgPresent === "number" ? source.avgPresent : Number(source.avgPresent ?? 0) || 0,
    bucketSeconds: toCount(source.bucketSeconds) || 30,
    buckets,
    durationMs: toCount(source.durationMs),
    frozenAt: typeof source.frozenAt === "string" ? source.frozenAt : null,
    peak: peak ? { b: toCount(peak.b), n: toCount(peak.n) } : null,
    reachedEnd: toCount(source.reachedEnd),
    unique: toCount(source.unique),
    watchAvg: toCount(source.watchAvg),
    watchMax: toCount(source.watchMax)
  };
}

function toCount(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

export function registrationFromRow(row: RegistrationRow): WebinarRegistration {
  return {
    calendarToken: row.calendar_token,
    cancelledAt: row.cancelled_at,
    id: row.id,
    registeredAt: row.registered_at,
    reminder1hSentAt: row.reminder_1h_sent_at,
    reminder24hSentAt: row.reminder_24h_sent_at,
    sessionId: row.session_id,
    source: row.source,
    sourceCampaignId: row.source_campaign_id,
    startedNoticeSentAt: row.started_notice_sent_at,
    status: (row.status === "cancelled" ? "cancelled" : "registered") as RegistrationStatus,
    userId: row.user_id,
    webinarId: row.webinar_id
  };
}

/** O patch de webinars a partir do rascunho (as sessoes, os apresentadores e o video vao para as outras tabelas). */
export function webinarRowPatch(draft: WebinarDraft): Omit<WebinarRow, "cancel_reason" | "cancelled_at" | "created_at" | "created_by" | "deleted_at" | "id" | "published_at" | "slug" | "status" | "updated_at"> {
  return {
    access_mode: draft.accessMode,
    allow_student_camera: draft.allowStudentCamera,
    audience: normalizeAudience(draft.audience),
    auto_record: draft.autoRecord,
    capacity: draft.registrationRequired ? draft.capacity : null,
    chat_retention_days: draft.chatRetentionDays,
    cover_url: draft.coverUrl,
    description: draft.description.trim() ? draft.description.trim() : null,
    duration_minutes: draft.durationMinutes,
    host_user_id: draft.hostUserId,
    kind: draft.kind,
    product_id: draft.accessMode === "product" || draft.accessMode === "either" ? draft.productId : null,
    quality: draft.quality,
    recording_retention_days: draft.recordingRetentionDays,
    registration_required: draft.registrationRequired,
    reminder_texts: Object.fromEntries(Object.entries(draft.reminderTexts).filter(([, value]) => value)),
    reminders: draft.reminders,
    replay_days_on_home: draft.replayDaysOnHome,
    replay_lesson_target: draft.replayLessonTarget,
    room_settings: draft.roomSettings,
    scheduled_at: draft.kind === "live" ? draft.scheduledAt : null,
    show_banner: draft.showBanner,
    show_on_home: draft.showOnHome,
    show_registered_count: draft.showRegisteredCount,
    title: draft.title.trim()
  };
}

/* ------------------------------------------------------------------------------------------------
 * Fase 3 (202610290002): banimentos e o webhook do gravador. O modelo (estado do aluno, regras) fica em live-model.ts;
 * as leituras e escritas em live-store.ts.
 * ---------------------------------------------------------------------------------------------- */

export const SESSION_BAN_COLUMNS = "session_id, user_id, kind, until_at, by_user_id, reason, created_at";

/** webinar_session_bans: remover da sala (kicked, ate o fim) e silenciar no chat (muted, ate until_at ou o fim). */
export type SessionBanRow = {
  by_user_id: string | null;
  created_at: string;
  kind: "kicked" | "muted";
  reason: string | null;
  session_id: string;
  until_at: string | null;
  user_id: string;
};

export const USER_BAN_COLUMNS = "user_id, session_id, by_user_id, reason, created_at";

/** webinar_user_bans: banido de todos os webinarios ate a equipe desfazer. */
export type UserBanRow = {
  by_user_id: string | null;
  created_at: string;
  reason: string | null;
  session_id: string | null;
  user_id: string;
};

export const RECORDING_EVENT_COLUMNS =
  "id, session_id, state, room, file_name, machine_requested_at, payload, signature_valid, processing_status, received_at, processed_at, error_message";

export const RECORDING_EVENT_STATUSES = ["pending", "processed", "ignored", "failed"] as const;
export type RecordingEventStatus = (typeof RECORDING_EVENT_STATUSES)[number];

/**
 * webinar_recording_events: cada chamada do webhook do gravador, bruta (payload) e idempotente por sessao + estado +
 * arquivo + maquina (machine_requested_at, 202610290003: a hora do pedido da maquina no ready / unavailable / gone).
 */
export type RecordingEventRow = {
  error_message: string | null;
  file_name: string | null;
  id: string;
  machine_requested_at?: string | null;
  payload: Record<string, unknown>;
  processed_at: string | null;
  processing_status: RecordingEventStatus;
  received_at: string;
  room: string | null;
  session_id: string | null;
  signature_valid: boolean;
  state: string;
};
