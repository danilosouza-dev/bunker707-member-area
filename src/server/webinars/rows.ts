// Linhas do banco dos Webinarios (202610280001) e a conversao para o modelo (model.ts). Modulo puro: sem
// "server-only", imports relativos; os testes carregam direto pelo Node. Quem grava e quem le as tabelas e
// store.ts/queries.ts; aqui so a forma das linhas e os mapeadores, para admin, aluno e tick lerem igual.

import { normalizeAudience, type AudienceDefinition } from "../communications/audience-model";
import { RECORDER_STATUSES, type RecorderStatus } from "./recorder-model";
import {
  ACCESS_MODE_COLUMN_VALUES,
  CHAT_MODES,
  DISPLAY_NAME_MODES,
  SESSION_KINDS,
  SESSION_STATUSES,
  SLOW_MODE_SECONDS,
  WEBINAR_KINDS,
  WEBINAR_STATUSES,
  accessModeUsesProduct,
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
  type WebinarStatus,
  ANSWER_SOURCES,
  ASSISTANT_REQUEST_STATUSES,
  ASSISTANT_SKIP_REASONS,
  ASSISTANT_TARGETS,
  ATTENDANT_STATUSES,
  CHAT_LANGUAGES,
  CHAT_LIMITS,
  JIT_EVERY_MINUTES,
  JIT_LIMITS,
  OFFER_LIMITS,
  OFFER_STATUSES,
  OFFER_TRIGGERS,
  OFFER_VARIANT_LABELS,
  SIMULATED_COUNT_MODES,
  SIMULATION_LIMITS,
  SOURCE_LANGUAGES,
  defaultAssistantSettings,
  defaultJitSettings,
  defaultSimulatedCountRule,
  defaultSimulatedJoins,
  type AnswerSource,
  type AssistantKnowledgeItem,
  type AssistantRequest,
  type AssistantRequestStatus,
  type AssistantSettings,
  type AssistantSkipReason,
  type AssistantTarget,
  type Attendant,
  type AttendanceMarks,
  type AttendantStatus,
  type ChatLanguage,
  type JitEveryMinutes,
  type JitSettings,
  type JitSimulationTemplate,
  type OfferClick,
  type OfferDisplay,
  type OfferDisplaySnapshot,
  type OfferStatus,
  type OfferTrigger,
  type OfferVariant,
  type OfferVariantLabel,
  type PanelRow,
  type SessionSimulation,
  type SimulatedCountMode,
  type SimulatedCountRule,
  type SimulatedJoins,
  type SimulatedSaleNotice,
  type SimulatedSaleNotices,
  type SimulationTotals,
  type SourceLanguage,
  type TextTranslation,
  type ViewerPrefs,
  type WebinarFollowUpFacts,
  type WebinarOffer
} from "./model";

export const WEBINAR_COLUMNS =
  "id, slug, kind, title, description, cover_url, status, host_user_id, access_mode, audience_restricts, product_id, audience, registration_required, capacity, show_registered_count, reminders, reminder_texts, show_on_home, replay_days_on_home, show_banner, scheduled_at, duration_minutes, allow_student_camera, quality, room_settings, auto_record, replay_lesson_target, chat_retention_days, recording_retention_days, published_at, cancelled_at, cancel_reason, created_by, created_at, updated_at, deleted_at";

export type WebinarRow = {
  access_mode: string;
  /** 202610300001: com access_mode 'product', o segmento tambem e exigido (o modo "both" do app). */
  audience_restricts: boolean;
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
  "id, webinar_id, kind, scheduled_at, started_at, ended_at, recording_anchor_at, status, recording_id, source_session_id, late_join_minutes, chat_mode, chat_slow_mode_seconds, show_live_badge, simulation_decided_by, simulation_decided_at, simulation_ack_text, presence_curve, script_fired_at, pinned_message_id, room_name, recorder_status, recorder_requested_at, recorder_release_requested_at, recorder_alerted_at, recording_requested_at, room_locked, browser_recording_at, jit, created_at, updated_at";

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
  /* 202610290008 (fase 4e): a sessao "Comeca quando voce entra"; opcional para os dubles das fases 1 a 3. */
  jit?: boolean | null;
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

/**
 * O "Quem pode" da linha: 'product' com audience_restricts = "both" (Quem tem o produto e está no segmento); os outros
 * valores do check da 202610280001 como estao. Um valor que este app nao conhece (um banco mais novo, num rollback)
 * fecha ("both": produto E segmento), nunca abre a todos.
 */
export function accessModeOfRow(row: Pick<WebinarRow, "access_mode" | "audience_restricts">): AccessMode {
  if (!(ACCESS_MODE_COLUMN_VALUES as readonly string[]).includes(row.access_mode)) {
    return "both";
  }

  return row.access_mode === "product" && row.audience_restricts === true ? "both" : (row.access_mode as AccessMode);
}

/** O access_mode e o audience_restricts gravados para um modo do app ("both" = 'product' + true; D41). */
export function accessModeColumns(mode: AccessMode): Pick<WebinarRow, "access_mode" | "audience_restricts"> {
  return mode === "both" ? { access_mode: "product", audience_restricts: true } : { access_mode: mode, audience_restricts: false };
}

/** A linha de webinars (e os apresentadores) no modelo do app. O video da Live gravada vem a parte (recording). */
export function webinarFromRow(row: WebinarRow, presenters: readonly PresenterRow[] = [], recording: RecordingRow | null = null): Webinar {
  return {
    accessMode: accessModeOfRow(row),
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
    jit: row.jit === true,
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
    ...accessModeColumns(draft.accessMode),
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
    product_id: accessModeUsesProduct(draft.accessMode) ? draft.productId : null,
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

/* ------------------------------------------------------------------------------------------------
 * Fase 4 (202610290004 a 202610290009): as linhas novas e os leitores sem confiar no formato (jsonb e bigint podem vir
 * de qualquer jeito: o que nao bate volta ao padrao, nunca quebra a tela). Quem le e grava e o store de cada parte
 * (panel-store.ts, offer-store.ts, simulation-store.ts, assistant-store.ts, jit-store.ts, translation-store.ts); o
 * zod de quem salva fica em offer-schemas.ts, simulation-schemas.ts, assistant-schemas.ts, jit-schemas.ts e
 * translation-schemas.ts.
 * ---------------------------------------------------------------------------------------------- */

function asCount(value: unknown): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? Math.trunc(number) : 0;
}

function asInteger(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : fallback;
}

function asNullableInteger(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.trunc(number))) : null;
}

function asIsoOrNull(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

/* 4a: webinar_panel ------------------------------------------------------------------------------ */

/** As linhas de webinar_panel: bigint pode vir como texto; linha sem metrica fica de fora. */
export function readPanelRows(rows: readonly unknown[]): PanelRow[] {
  const result: PanelRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const source = row as Record<string, unknown>;
    if (typeof source.metric !== "string") {
      continue;
    }
    result.push({
      item: typeof source.item === "string" ? source.item : String(source.item ?? ""),
      metric: source.metric,
      sessionId: typeof source.session_id === "string" && source.session_id ? source.session_id : null,
      students: asCount(source.students),
      total: asCount(source.total)
    });
  }
  return result;
}

/* 4b: a Oferta ----------------------------------------------------------------------------------- */

export const OFFER_COLUMNS =
  "id, webinar_id, product_id, title, trigger_kind, show_at_offset_ms, visible_minutes, deadline_minutes, attribution_days, status, created_by, created_at, updated_at";

export type OfferRow = {
  attribution_days: number;
  created_at: string;
  created_by: string | null;
  deadline_minutes: number | null;
  id: string;
  product_id: string;
  show_at_offset_ms: number | null;
  status: string;
  title: string;
  trigger_kind: string;
  updated_at: string;
  visible_minutes: number | null;
  webinar_id: string;
};

export const OFFER_VARIANT_COLUMNS =
  "id, offer_id, label, enabled, headline, badge, price_from_label, price_label, coupon, checkout_url, image_url, weight, created_at, updated_at";

export type OfferVariantRow = {
  badge: string | null;
  checkout_url: string;
  coupon: string | null;
  created_at: string;
  enabled: boolean;
  headline: string;
  id: string;
  image_url: string | null;
  label: string;
  offer_id: string;
  price_from_label: string | null;
  price_label: string | null;
  updated_at: string;
  weight: number;
};

export function offerVariantFromRow(row: OfferVariantRow): OfferVariant {
  return {
    badge: row.badge ?? null,
    checkoutUrl: row.checkout_url,
    coupon: row.coupon ?? null,
    enabled: row.enabled !== false,
    headline: row.headline,
    id: row.id,
    imageUrl: row.image_url ?? null,
    label: oneOf<OfferVariantLabel>(OFFER_VARIANT_LABELS, row.label, "A"),
    offerId: row.offer_id,
    priceFromLabel: row.price_from_label ?? null,
    priceLabel: row.price_label ?? null,
    weight: asInteger(row.weight, OFFER_LIMITS.weightMin, OFFER_LIMITS.weightMax, 1)
  };
}

/** A Oferta com as variantes dela, na ordem A, B, C, D. */
export function offerFromRows(row: OfferRow, variants: readonly OfferVariantRow[]): WebinarOffer {
  return {
    attributionDays: asInteger(row.attribution_days, OFFER_LIMITS.attributionDaysMin, OFFER_LIMITS.attributionDaysMax, OFFER_LIMITS.attributionDaysDefault),
    createdAt: row.created_at,
    createdBy: row.created_by ?? null,
    deadlineMinutes: asNullableInteger(row.deadline_minutes, 1, OFFER_LIMITS.deadlineMinutesMax),
    id: row.id,
    productId: row.product_id,
    showAtOffsetMs: asNullableInteger(row.show_at_offset_ms, 0, CHAT_LIMITS.offsetMaxMs),
    status: oneOf<OfferStatus>(OFFER_STATUSES, row.status, "draft"),
    title: row.title ?? "",
    triggerKind: oneOf<OfferTrigger>(OFFER_TRIGGERS, row.trigger_kind, "never"),
    updatedAt: row.updated_at,
    variants: variants
      .filter((variant) => variant.offer_id === row.id)
      .map(offerVariantFromRow)
      .sort((a, b) => a.label.localeCompare(b.label)),
    visibleMinutes: asNullableInteger(row.visible_minutes, 1, OFFER_LIMITS.visibleMinutesMax),
    webinarId: row.webinar_id
  };
}

export const OFFER_DISPLAY_COLUMNS =
  "id, offer_id, session_id, show_offset_ms, hide_offset_ms, shown_at, hidden_at, deadline_at, shown_by, hidden_by, snapshot, created_at, updated_at";

export type OfferDisplayRow = {
  created_at: string;
  deadline_at: string | null;
  hidden_at: string | null;
  hidden_by: string | null;
  hide_offset_ms: number | null;
  id: string;
  offer_id: string;
  session_id: string;
  show_offset_ms: number;
  shown_at: string;
  shown_by: string | null;
  snapshot: unknown;
  updated_at: string;
};

/** A foto guardada da sessao; o que nao bate vira nulo (a tela mostra so a janela). */
export function offerDisplaySnapshotOf(value: unknown): OfferDisplaySnapshot | null {
  const raw = asObject(value);
  if (!Array.isArray(raw.variants)) {
    return null;
  }
  const variants = raw.variants
    .map((entry) => asObject(entry))
    .filter((entry) => typeof entry.headline === "string" && (OFFER_VARIANT_LABELS as readonly unknown[]).includes(entry.label))
    .map((entry) => ({
      badge: asText(entry.badge, OFFER_LIMITS.badge),
      coupon: asText(entry.coupon, OFFER_LIMITS.coupon),
      headline: String(entry.headline).slice(0, OFFER_LIMITS.headline),
      label: entry.label as OfferVariantLabel,
      priceFromLabel: asText(entry.priceFromLabel, OFFER_LIMITS.priceLabel),
      priceLabel: asText(entry.priceLabel, OFFER_LIMITS.priceLabel)
    }));
  return { capturedAt: asIsoOrNull(raw.capturedAt) ?? "", deadlineAt: asIsoOrNull(raw.deadlineAt), variants };
}

export function offerDisplayFromRow(row: OfferDisplayRow): OfferDisplay {
  return {
    deadlineAt: row.deadline_at ?? null,
    hiddenAt: row.hidden_at ?? null,
    hiddenBy: row.hidden_by ?? null,
    hideOffsetMs: row.hide_offset_ms ?? null,
    id: row.id,
    offerId: row.offer_id,
    sessionId: row.session_id,
    showOffsetMs: row.show_offset_ms,
    shownAt: row.shown_at,
    shownBy: row.shown_by ?? null,
    snapshot: offerDisplaySnapshotOf(row.snapshot)
  };
}

export const OFFER_CLICK_COLUMNS =
  "id, offer_id, variant_id, variant_label, session_id, user_id, offset_ms, click_token, clicked_at, converted_sale_grant_id, converted_at, created_at";

export type OfferClickRow = {
  click_token: string;
  clicked_at: string;
  converted_at: string | null;
  converted_sale_grant_id: string | null;
  created_at: string;
  id: string;
  offer_id: string;
  offset_ms: number;
  session_id: string;
  user_id: string;
  variant_id: string | null;
  variant_label: string;
};

export function offerClickFromRow(row: OfferClickRow): OfferClick {
  return {
    clickToken: row.click_token,
    clickedAt: row.clicked_at,
    convertedAt: row.converted_at ?? null,
    convertedSaleGrantId: row.converted_sale_grant_id ?? null,
    id: row.id,
    offerId: row.offer_id,
    offsetMs: row.offset_ms,
    sessionId: row.session_id,
    userId: row.user_id,
    variantId: row.variant_id ?? null,
    variantLabel: oneOf<OfferVariantLabel>(OFFER_VARIANT_LABELS, row.variant_label, "A")
  };
}

/* 4b: a Simulacao na sessao ---------------------------------------------------------------------- */

/**
 * As colunas de Simulacao da fase 4, lidas a parte (nunca em SESSION_COLUMNS: nenhuma leitura de numero real as traz,
 * D6, M6). O formato dos jsonb e o de docs/30 §4.3 (snake_case).
 */
export const SESSION_SIMULATION_COLUMNS = "id, kind, simulated_count_rule, simulated_joins, simulated_sale_notices, simulation_summary, simulation_seed";

export type SessionSimulationRow = {
  id: string;
  kind: string;
  simulated_count_rule: unknown;
  simulated_joins: unknown;
  simulated_sale_notices: unknown;
  simulation_seed: number | string | null;
  simulation_summary: unknown;
};

export function simulatedCountRuleOfRow(value: unknown): SimulatedCountRule {
  const raw = asObject(value);
  const base = defaultSimulatedCountRule();
  const mode = oneOf<SimulatedCountMode>(SIMULATED_COUNT_MODES, raw.mode, base.mode);
  const lowest = asInteger(raw.base, 0, SIMULATION_LIMITS.countMax, 0);
  return {
    base: lowest,
    jitter: asInteger(raw.jitter, 0, SIMULATION_LIMITS.jitterMax, 0),
    mode,
    peak: Math.max(lowest, asInteger(raw.peak, 0, SIMULATION_LIMITS.countMax, lowest))
  };
}

export function simulatedJoinsOfRow(value: unknown): SimulatedJoins {
  const raw = asObject(value);
  const base = defaultSimulatedJoins();
  return {
    enabled: asBoolean(raw.enabled, base.enabled),
    everySeconds: asInteger(raw.every_seconds, SIMULATION_LIMITS.joinsEverySecondsMin, SIMULATION_LIMITS.joinsEverySecondsMax, base.everySeconds),
    max: asInteger(raw.max, 0, SIMULATION_LIMITS.joinsMax, base.max),
    names: "generic"
  };
}

export function simulatedSaleNoticesOfRow(value: unknown): SimulatedSaleNotices {
  const raw = asObject(value);
  const items = Array.isArray(raw.items) ? raw.items : [];
  return {
    enabled: asBoolean(raw.enabled, false),
    items: items
      .map((entry) => asObject(entry))
      .map((entry) => ({ offsetMs: asNullableInteger(entry.offset_ms, CHAT_LIMITS.offsetMinMs, CHAT_LIMITS.offsetMaxMs), text: asText(entry.text, SIMULATION_LIMITS.saleNoticeText) }))
      .filter((entry): entry is SimulatedSaleNotice => entry.offsetMs !== null && entry.text !== null)
      .slice(0, SIMULATION_LIMITS.saleNoticesMax)
      .sort((a, b) => a.offsetMs - b.offsetMs)
  };
}

export function simulationTotalsOfRow(value: unknown): SimulationTotals | null {
  const raw = asObject(value);
  if (!("counter_max" in raw) && !("joins_shown" in raw) && !("sale_notices_shown" in raw)) {
    return null;
  }
  return {
    counterMax: asInteger(raw.counter_max, 0, Number.MAX_SAFE_INTEGER, 0),
    joinsShown: asInteger(raw.joins_shown, 0, Number.MAX_SAFE_INTEGER, 0),
    saleNoticesShown: asInteger(raw.sale_notices_shown, 0, Number.MAX_SAFE_INTEGER, 0)
  };
}

export function sessionSimulationFromRow(row: SessionSimulationRow): SessionSimulation {
  return {
    countRule: simulatedCountRuleOfRow(row.simulated_count_rule),
    joins: simulatedJoinsOfRow(row.simulated_joins),
    saleNotices: simulatedSaleNoticesOfRow(row.simulated_sale_notices),
    seed: asInteger(row.simulation_seed, 0, 2_147_483_647, 0),
    sessionId: row.id,
    summary: simulationTotalsOfRow(row.simulation_summary)
  };
}

/** O que vai para as colunas (docs/30 §4.3): "off" e "desligado" gravam nulo (a sessao fica sem regra simulada). */
export function simulationRulesToRow(input: { countRule: SimulatedCountRule; joins: SimulatedJoins; saleNotices: SimulatedSaleNotices }) {
  return {
    simulated_count_rule:
      input.countRule.mode === "off" ? null : { base: input.countRule.base, jitter: input.countRule.jitter, mode: input.countRule.mode, peak: input.countRule.peak },
    simulated_joins: input.joins.enabled ? { enabled: true, every_seconds: input.joins.everySeconds, max: input.joins.max, names: "generic" } : null,
    simulated_sale_notices: input.saleNotices.enabled
      ? { enabled: true, items: input.saleNotices.items.map((item) => ({ offset_ms: item.offsetMs, text: item.text })) }
      : null
  };
}

export function simulationTotalsToRow(totals: SimulationTotals) {
  return { counter_max: totals.counterMax, joins_shown: totals.joinsShown, sale_notices_shown: totals.saleNoticesShown };
}

/* 4b: o follow-up -------------------------------------------------------------------------------- */

export type FollowUpFactsRow = {
  attended: boolean | null;
  clicked: boolean | null;
  left_before_offer: boolean | null;
  offer_seen: boolean | null;
  purchased: boolean | null;
  registered: boolean | null;
  user_id: string;
  watched_replay: boolean | null;
  webinar_id: string;
};

export function followUpFactsFromRow(row: FollowUpFactsRow): WebinarFollowUpFacts {
  return {
    attended: row.attended === true,
    clicked: row.clicked === true,
    leftBeforeOffer: row.left_before_offer === true,
    offerSeen: row.offer_seen === true,
    purchased: row.purchased === true,
    registered: row.registered === true,
    userId: row.user_id,
    watchedReplay: row.watched_replay === true,
    webinarId: row.webinar_id
  };
}

/* 4c: o Assistente e os atendentes --------------------------------------------------------------- */

export function assistantSettingsOfRow(value: unknown): AssistantSettings {
  const raw = asObject(value);
  const base = defaultAssistantSettings();
  return { enabled: asBoolean(raw.enabled, base.enabled), replyAllDefault: asBoolean(raw.replyAllDefault, base.replyAllDefault) };
}

export function assistantSettingsToRow(settings: AssistantSettings) {
  return { enabled: settings.enabled, replyAllDefault: settings.replyAllDefault };
}

export const KNOWLEDGE_COLUMNS = "id, webinar_id, question, answer, position, created_by, created_at, updated_at";

export type KnowledgeRow = {
  answer: string;
  created_at: string;
  created_by: string | null;
  id: string;
  position: number;
  question: string;
  updated_at: string;
  webinar_id: string;
};

export function knowledgeFromRow(row: KnowledgeRow): AssistantKnowledgeItem {
  return { answer: row.answer, createdAt: row.created_at, id: row.id, position: row.position, question: row.question, updatedAt: row.updated_at, webinarId: row.webinar_id };
}

export const ATTENDANT_COLUMNS = "session_id, user_id, status, last_seen_at, created_at";

export type AttendantRow = { created_at: string; last_seen_at: string; session_id: string; status: string; user_id: string };

export function attendantFromRow(row: AttendantRow): Attendant {
  return { lastSeenAt: row.last_seen_at, sessionId: row.session_id, status: oneOf<AttendantStatus>(ATTENDANT_STATUSES, row.status, "away"), userId: row.user_id };
}

export const AI_REQUEST_COLUMNS =
  "id, webinar_id, session_id, user_id, target_kind, target_id, status, skip_reason, reply_message_id, requested_at, answered_at, provider, model, error_code, created_at";

export type AiRequestRow = {
  answered_at: string | null;
  created_at: string;
  error_code: string | null;
  id: string;
  model: string | null;
  provider: string | null;
  reply_message_id: string | null;
  requested_at: string;
  session_id: string;
  skip_reason: string | null;
  status: string;
  target_id: string;
  target_kind: string;
  user_id: string;
  webinar_id: string;
};

export function aiRequestFromRow(row: AiRequestRow): AssistantRequest {
  return {
    answeredAt: row.answered_at ?? null,
    errorCode: row.error_code ?? null,
    id: row.id,
    model: row.model ?? null,
    provider: row.provider ?? null,
    replyMessageId: row.reply_message_id ?? null,
    requestedAt: row.requested_at,
    sessionId: row.session_id,
    skipReason: row.skip_reason ? oneOf<AssistantSkipReason>(ASSISTANT_SKIP_REASONS, row.skip_reason, "empty") : null,
    status: oneOf<AssistantRequestStatus>(ASSISTANT_REQUEST_STATUSES, row.status, "pending"),
    targetId: row.target_id,
    targetKind: oneOf<AssistantTarget>(ASSISTANT_TARGETS, row.target_kind, "chat"),
    userId: row.user_id,
    webinarId: row.webinar_id
  };
}

/** As colunas da 202610290006 numa pergunta (webinar_questions) ou numa pergunta do chat (webinar_chat_messages). */
export const QUESTION_ATTENDANCE_COLUMNS = "id, assigned_to, assigned_at, answer_source, handoff_requested_at";
export const MESSAGE_ATTENDANCE_COLUMNS = "id, assigned_to, assigned_at, handoff_requested_at, edited_at, edited_by";

export type AttendanceMarksRow = {
  answer_source?: string | null;
  assigned_at: string | null;
  assigned_to: string | null;
  handoff_requested_at: string | null;
  id: string;
};

export function attendanceMarksFromRow(row: AttendanceMarksRow): AttendanceMarks {
  return {
    answerSource: row.answer_source ? oneOf<AnswerSource>(ANSWER_SOURCES, row.answer_source, "team") : null,
    assignedAt: row.assigned_at ?? null,
    assignedTo: row.assigned_to ?? null,
    handoffRequestedAt: row.handoff_requested_at ?? null
  };
}

/* 4e: "Comeca quando voce entra" ----------------------------------------------------------------- */

function jitSimulationOfRow(value: unknown): JitSimulationTemplate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const raw = value as Record<string, unknown>;
  return {
    ackText: asText(raw.ackText, CHAT_LIMITS.simulationAck),
    countRule: simulatedCountRuleOfRow(raw.countRule),
    decidedAt: asIsoOrNull(raw.decidedAt),
    decidedBy: typeof raw.decidedBy === "string" && raw.decidedBy ? raw.decidedBy : null,
    joins: simulatedJoinsOfRow(raw.joins),
    saleNotices: simulatedSaleNoticesOfRow(raw.saleNotices),
    showLiveBadge: asBoolean(raw.showLiveBadge, false)
  };
}

/** webinars.jit_settings: o que nao bate volta ao padrao (desligado). */
export function jitSettingsOfRow(value: unknown): JitSettings {
  const raw = asObject(value);
  const base = defaultJitSettings();
  const startHour = asInteger(raw.startHour, JIT_LIMITS.hourMin, JIT_LIMITS.hourMax - 1, base.startHour);
  const endHour = asInteger(raw.endHour, JIT_LIMITS.hourMin + 1, JIT_LIMITS.hourMax, base.endHour);
  return {
    enabled: asBoolean(raw.enabled, base.enabled) && endHour > startHour,
    endHour: Math.max(endHour, startHour + 1),
    everyMinutes: oneOf<JitEveryMinutes>(JIT_EVERY_MINUTES, raw.everyMinutes, base.everyMinutes),
    lateJoinMinutes: asNullableInteger(raw.lateJoinMinutes, 0, JIT_LIMITS.lateJoinMax),
    simulation: jitSimulationOfRow(raw.simulation),
    startHour
  };
}

/** O que vai para webinars.jit_settings (as regras da Simulacao no formato das colunas da sessao, docs/30 §4.3). */
export function jitSettingsToRow(settings: JitSettings) {
  const simulation = settings.simulation;
  const rules = simulation ? simulationRulesToRow(simulation) : null;
  return {
    enabled: settings.enabled,
    endHour: settings.endHour,
    everyMinutes: settings.everyMinutes,
    lateJoinMinutes: settings.lateJoinMinutes,
    simulation:
      simulation && rules
        ? {
            ackText: simulation.ackText,
            countRule: rules.simulated_count_rule,
            decidedAt: simulation.decidedAt,
            decidedBy: simulation.decidedBy,
            joins: rules.simulated_joins,
            saleNotices: rules.simulated_sale_notices,
            showLiveBadge: simulation.showLiveBadge
          }
        : null,
    startHour: settings.startHour
  };
}

/* 4f: a traducao --------------------------------------------------------------------------------- */

export const VIEWER_PREFS_COLUMNS = "user_id, chat_language, created_at, updated_at";

export type ViewerPrefsRow = { chat_language: string | null; created_at: string; updated_at: string; user_id: string };

export function viewerPrefsFromRow(row: ViewerPrefsRow): ViewerPrefs {
  const known = (CHAT_LANGUAGES as readonly unknown[]).includes(row.chat_language);
  return { chatLanguage: known ? (row.chat_language as ChatLanguage) : null, userId: row.user_id };
}

export const TEXT_TRANSLATION_COLUMNS = "source_hash, language, source_language, body, provider, created_at";

export type TextTranslationRow = { body: string; created_at: string; language: string; provider: string; source_hash: string; source_language: string | null };

export function textTranslationFromRow(row: TextTranslationRow): TextTranslation {
  return {
    body: row.body,
    createdAt: row.created_at,
    language: oneOf<ChatLanguage>(CHAT_LANGUAGES, row.language, "pt"),
    provider: row.provider,
    sourceHash: row.source_hash,
    sourceLanguage: row.source_language ? oneOf<SourceLanguage>(SOURCE_LANGUAGES, row.source_language, "other") : null
  };
}
