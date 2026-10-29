// Modelo puro dos Webinarios (docs/30 §1, §2 e §4): tipos, limites, situacoes e as contas de tempo que a
// pagina do aluno, o admin e o tick repetem. Sem "server-only", imports relativos: tests/webinarios-*.test.mjs
// carregam direto pelo Node (nada de enum, namespace ou parametro de construtor: docs/18 §2.5).
//
// Vocabulario do produtor (docs/30, Resumo): Webinario, Live ao vivo, Live gravada, Sessao, Garantir vaga,
// Vaga garantida, Replay, Apresentador, Equipe. As situacoes internas ficam em ingles no codigo e ganham as
// frases em src/lib/webinar-copy.ts.

import { saoPauloDayKey } from "../../lib/webinar-time";
import { slugifyTitle } from "../catalog/model";
import type { AudienceDefinition } from "../communications/audience-model";

export const WEBINAR_KINDS = ["live", "simulated"] as const;
export type WebinarKind = (typeof WEBINAR_KINDS)[number];

export const WEBINAR_STATUSES = ["draft", "published", "archived"] as const;
export type WebinarStatus = (typeof WEBINAR_STATUSES)[number];

export const SESSION_KINDS = ["live", "simulated", "replay"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_STATUSES = ["scheduled", "waiting", "live", "ended", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const ACCESS_MODES = ["everyone", "product", "audience", "either"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

export const CHAT_MODES = ["open", "moderated", "team_only", "off"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

export const SLOW_MODE_SECONDS = [10, 20, 30, 60] as const;
export type SlowModeSeconds = (typeof SLOW_MODE_SECONDS)[number];

export const DISPLAY_NAME_MODES = ["first_name_initial", "nickname", "anonymous"] as const;
export type DisplayNameMode = (typeof DISPLAY_NAME_MODES)[number];

export const PRESENTER_ROLES = ["co_host", "team"] as const;
export type PresenterRole = (typeof PRESENTER_ROLES)[number];

export const STAGE_QUALITIES = [720, 1080] as const;
export type StageQuality = (typeof STAGE_QUALITIES)[number];
export const SCREEN_FPS_OPTIONS = [30, 15] as const;
export type ScreenFps = (typeof SCREEN_FPS_OPTIONS)[number];

export const REGISTRATION_STATUSES = ["registered", "cancelled"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/** Limites do editor e das rotas (os mesmos checks do banco, 202610280001). */
export const WEBINAR_LIMITS = {
  title: 120,
  description: 2000,
  coverUrl: 2048,
  durationMin: 15,
  durationMax: 480,
  capacityMax: 100_000,
  sessionsMax: 60,
  presentersMax: 25,
  coHostsMax: 5,
  reminderText: 600,
  cancelReason: 500,
  replayDaysMax: 60,
  source: 80,
  slugMax: 64,
  retentionMin: 30,
  retentionMax: 3650,
  lateJoinMax: 600,
  recordingUrl: 2048
} as const;

/** Um dia e uma hora antes (docs/30 §2.7), e a folga do "1 h" quando o "24 h" atrasou. */
export const REMINDER_RULES = {
  h24Minutes: 24 * 60,
  h1Minutes: 60,
  /** Com menos que isso ate a hora marcada, o de 24 h nao sai mais sozinho: sai so o de 1 h. */
  h1OnlyBelowMinutes: 50,
  /** Faixa "Comeca em 1 h: Entrar" para quem garantiu vaga. */
  bannerMinutesBefore: 60,
  /** Quanto tempo depois da hora marcada uma sessao sem inicio encerra sozinha (docs/30 §2.3, A24). */
  autoEndMinutesAfter: 120
} as const;

export type Quality = { screenFps: ScreenFps; stage: StageQuality };

export type RoomSettings = {
  anonymousQuestions: boolean;
  chatMode: ChatMode;
  displayName: DisplayNameMode;
  newCommentsVisible: boolean;
  polls: boolean;
  practiceSession: boolean;
  questions: boolean;
  reactions: boolean;
  slowModeSeconds: SlowModeSeconds | null;
  waitingRoom: boolean;
};

export type ReminderSettings = { email: boolean; h1: boolean; h24: boolean };

export type ReminderTexts = {
  afterAbsent: string | null;
  afterAttended: string | null;
  confirmation: string | null;
  h1: string | null;
  h24: string | null;
  started: string | null;
};

export type ReplayLessonTarget = { autoPublish: boolean; moduleId: string | null; productId: string; title: string | null };

export type WebinarPresenter = { canModerateRoom: boolean; role: PresenterRole; userId: string };

/** O que o editor edita e as Server Actions gravam (docs/30 §2.2). */
export type WebinarDraft = {
  accessMode: AccessMode;
  allowStudentCamera: boolean;
  audience: AudienceDefinition;
  autoRecord: boolean;
  capacity: number | null;
  chatRetentionDays: number;
  coverUrl: string | null;
  description: string;
  durationMinutes: number;
  hostUserId: string | null;
  kind: WebinarKind;
  presenters: WebinarPresenter[];
  productId: string | null;
  quality: Quality;
  recordingRetentionDays: number;
  /** Live gravada: o endereco do player da Bunny (embed) ou "biblioteca/video". */
  recordingVideoUrl: string | null;
  registrationRequired: boolean;
  reminderTexts: ReminderTexts;
  reminders: ReminderSettings;
  replayDaysOnHome: number;
  replayLessonTarget: ReplayLessonTarget | null;
  roomSettings: RoomSettings;
  /** Live ao vivo: a hora marcada (ISO). Live gravada: nulo. */
  scheduledAt: string | null;
  /** Live gravada: as horas marcadas (ISO), uma sessao cada. */
  sessions: { scheduledAt: string }[];
  showBanner: boolean;
  showOnHome: boolean;
  showRegisteredCount: boolean;
  title: string;
};

/** O webinario gravado (a linha de webinars mais os apresentadores). */
export type Webinar = WebinarDraft & {
  cancelReason: string | null;
  cancelledAt: string | null;
  createdAt: string;
  createdBy: string | null;
  id: string;
  publishedAt: string | null;
  slug: string;
  status: WebinarStatus;
  updatedAt: string;
};

export type WebinarSession = {
  chatMode: ChatMode;
  chatSlowModeSeconds: SlowModeSeconds | null;
  createdAt: string;
  endedAt: string | null;
  id: string;
  kind: SessionKind;
  lateJoinMinutes: number | null;
  recordingAnchorAt: string | null;
  recordingId: string | null;
  scheduledAt: string;
  sourceSessionId: string | null;
  startedAt: string | null;
  status: SessionStatus;
  updatedAt: string;
  webinarId: string;
};

export type WebinarRegistration = {
  calendarToken: string;
  cancelledAt: string | null;
  id: string;
  registeredAt: string;
  reminder1hSentAt: string | null;
  reminder24hSentAt: string | null;
  sessionId: string | null;
  source: string | null;
  sourceCampaignId: string | null;
  startedNoticeSentAt: string | null;
  status: RegistrationStatus;
  userId: string;
  webinarId: string;
};

/** Situacao do webinario como a lista do admin mostra (docs/30 §2.3). */
export const WEBINAR_SITUATIONS = ["draft", "scheduled", "in_progress", "ended", "cancelled"] as const;
export type WebinarSituation = (typeof WEBINAR_SITUATIONS)[number];

/** O que a pagina do aluno mostra (docs/30 §1.2). */
export const STUDENT_PHASES = ["scheduled", "registered", "sold_out", "waiting", "live", "ended", "cancelled"] as const;
export type StudentPhase = (typeof STUDENT_PHASES)[number];

export function defaultQuality(): Quality {
  return { screenFps: 30, stage: 720 };
}

export function defaultRoomSettings(): RoomSettings {
  return {
    anonymousQuestions: true,
    chatMode: "open",
    displayName: "first_name_initial",
    newCommentsVisible: true,
    polls: true,
    practiceSession: true,
    questions: true,
    reactions: true,
    slowModeSeconds: null,
    waitingRoom: false
  };
}

export function defaultReminders(): ReminderSettings {
  return { email: true, h1: true, h24: true };
}

export function emptyReminderTexts(): ReminderTexts {
  return { afterAbsent: null, afterAttended: null, confirmation: null, h1: null, h24: null, started: null };
}

export function emptyWebinarDraft(kind: WebinarKind): WebinarDraft {
  return {
    accessMode: "everyone",
    allowStudentCamera: true,
    audience: { kind: "everyone" },
    autoRecord: true,
    capacity: null,
    chatRetentionDays: 730,
    coverUrl: null,
    description: "",
    durationMinutes: 60,
    hostUserId: null,
    kind,
    presenters: [],
    productId: null,
    quality: defaultQuality(),
    recordingRetentionDays: 730,
    recordingVideoUrl: null,
    registrationRequired: true,
    reminderTexts: emptyReminderTexts(),
    reminders: defaultReminders(),
    replayDaysOnHome: 7,
    replayLessonTarget: null,
    roomSettings: defaultRoomSettings(),
    scheduledAt: null,
    sessions: [],
    showBanner: true,
    showOnHome: true,
    showRegisteredCount: false,
    title: ""
  };
}

/** `/webinarios/<slug>`; o slug nasce do titulo e ganha um sufixo numerico se ja existir. */
export function webinarSlug(title: string, suffix?: number) {
  const base = slugifyTitle(title, 56) || "webinario";
  const padded = base.length < 3 ? `${base}-live` : base;
  return suffix && suffix > 1 ? `${padded}-${suffix}` : padded;
}

export function webinarHref(slug: string) {
  return `/webinarios/${slug}`;
}

export function toTime(value: string | number | Date | null | undefined): number {
  if (value == null) {
    return Number.NaN;
  }
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  return new Date(value).getTime();
}

export function sessionEndsAt(session: Pick<WebinarSession, "scheduledAt" | "endedAt">, durationMinutes: number) {
  if (session.endedAt) {
    return toTime(session.endedAt);
  }
  return toTime(session.scheduledAt) + durationMinutes * 60_000;
}

/** A proxima sessao que ainda vai acontecer (ou esta acontecendo), na ordem das horas marcadas. */
export function nextSession(sessions: readonly WebinarSession[], durationMinutes: number, now: number): WebinarSession | null {
  const open = sessions
    .filter((session) => session.kind !== "replay" && session.status !== "cancelled" && session.status !== "ended")
    .filter((session) => sessionEndsAt(session, durationMinutes) + REMINDER_RULES.autoEndMinutesAfter * 60_000 >= now)
    .sort((a, b) => toTime(a.scheduledAt) - toTime(b.scheduledAt));
  return open[0] ?? null;
}

export function replaySession(sessions: readonly WebinarSession[]): WebinarSession | null {
  return sessions.find((session) => session.kind === "replay") ?? null;
}

/** Situacao da lista do admin (docs/30 §2.3). */
export function webinarSituation(
  webinar: Pick<Webinar, "cancelledAt" | "durationMinutes" | "status">,
  sessions: readonly WebinarSession[],
  now: number
): WebinarSituation {
  if (webinar.cancelledAt) {
    return "cancelled";
  }
  if (webinar.status === "draft") {
    return "draft";
  }
  if (webinar.status === "archived") {
    return "ended";
  }
  const real = sessions.filter((session) => session.kind !== "replay" && session.status !== "cancelled");
  if (real.some((session) => session.status === "live" || session.status === "waiting")) {
    return "in_progress";
  }
  if (real.length > 0 && real.every((session) => session.status === "ended")) {
    return "ended";
  }
  if (real.length > 0 && real.every((session) => sessionEndsAt(session, webinar.durationMinutes) + REMINDER_RULES.autoEndMinutesAfter * 60_000 < now)) {
    return "ended";
  }
  return "scheduled";
}

/** O que a pagina do aluno mostra para uma sessao (docs/30 §1.2). */
export function studentPhase(input: {
  capacity: number | null;
  cancelled: boolean;
  durationMinutes: number;
  now: number;
  registered: boolean;
  registeredCount: number;
  registrationRequired: boolean;
  session: Pick<WebinarSession, "endedAt" | "kind" | "scheduledAt" | "startedAt" | "status"> | null;
}): StudentPhase {
  if (input.cancelled || input.session?.status === "cancelled") {
    return "cancelled";
  }
  if (!input.session) {
    return "ended";
  }
  const { session } = input;
  if (session.status === "ended") {
    return "ended";
  }
  if (session.status === "live") {
    return "live";
  }
  if (session.status === "waiting") {
    return "waiting";
  }
  const startsAt = toTime(session.scheduledAt);
  if (input.now >= sessionEndsAt(session, input.durationMinutes) + REMINDER_RULES.autoEndMinutesAfter * 60_000) {
    return "ended";
  }
  if (input.now >= startsAt) {
    // Hora marcada chegou e ninguem abriu a sala ainda: sala de espera.
    return "waiting";
  }
  if (input.registered) {
    return "registered";
  }
  if (input.registrationRequired && input.capacity != null && input.registeredCount >= input.capacity) {
    return "sold_out";
  }
  return "scheduled";
}

/** Garantir vaga: so antes da hora marcada (ou ate 15 min depois, para quem chega atrasado) e com vaga livre. */
export function canRegister(input: {
  capacity: number | null;
  durationMinutes: number;
  now: number;
  registeredCount: number;
  session: Pick<WebinarSession, "endedAt" | "scheduledAt" | "status">;
}): { ok: true } | { ok: false; reason: "ended" | "sold_out" | "cancelled" } {
  if (input.session.status === "cancelled") {
    return { ok: false, reason: "cancelled" };
  }
  if (input.session.status === "ended" || input.now >= sessionEndsAt(input.session, input.durationMinutes)) {
    return { ok: false, reason: "ended" };
  }
  if (input.capacity != null && input.registeredCount >= input.capacity) {
    return { ok: false, reason: "sold_out" };
  }
  return { ok: true };
}

export type ReminderDecision = { markAlso: "24h" | null; send: "24h" | "1h"; variant: "tomorrow" | "today" | "one_hour" };

/**
 * Qual lembrete sai agora para uma vaga (docs/30 §2.7): o de 24 h quando faltam ate 24 h; o de 1 h quando
 * faltam ate 60 min. O de 1 h nao sai enquanto o de 24 h nao saiu e ainda faltam mais de 50 min: nesse caso
 * sai so o de 24 h, com o texto "Hoje as {hora}". Com 50 min ou menos e os dois pendentes, sai so o de 1 h e
 * o de 24 h e dado como feito (markAlso), para nao chegar depois do de 1 h.
 */
export function reminderDecision(input: {
  now: number;
  reminders: ReminderSettings;
  scheduledAt: string | number;
  sent1h: boolean;
  sent24h: boolean;
}): ReminderDecision | null {
  const minutesLeft = (toTime(input.scheduledAt) - input.now) / 60_000;
  if (!Number.isFinite(minutesLeft) || minutesLeft <= 0) {
    return null;
  }
  const want24h = input.reminders.h24 && !input.sent24h && minutesLeft <= REMINDER_RULES.h24Minutes;
  const want1h = input.reminders.h1 && !input.sent1h && minutesLeft <= REMINDER_RULES.h1Minutes;
  if (want1h && (!want24h || minutesLeft <= REMINDER_RULES.h1OnlyBelowMinutes)) {
    return { markAlso: want24h ? "24h" : null, send: "1h", variant: "one_hour" };
  }
  if (want24h) {
    const sameDay = saoPauloDayKey(toTime(input.scheduledAt)) === saoPauloDayKey(input.now);
    return { markAlso: null, send: "24h", variant: sameDay ? "today" : "tomorrow" };
  }
  return null;
}

/** A faixa "Comeca em 1 h: Entrar" vale de 60 min antes ate a hora marcada (docs/30 §1.1). */
export function bannerWindow(scheduledAt: string | number, now: number): "soon" | "none" {
  const minutesLeft = (toTime(scheduledAt) - now) / 60_000;
  return minutesLeft > 0 && minutesLeft <= REMINDER_RULES.bannerMinutesBefore ? "soon" : "none";
}

/** Metadata minima dos registros do historico (docs/30 §4.7): so ids e codigos, nunca texto digitado. */
export function registrationEventMetadata(input: { campaignId?: string | null; sessionId: string | null; source?: string | null; webinarId: string }) {
  return {
    campaign_id: input.campaignId ?? null,
    session_id: input.sessionId,
    source: input.source ? input.source.slice(0, WEBINAR_LIMITS.source) : null,
    webinar_id: input.webinarId
  };
}
