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
import type { RecorderStatus } from "./recorder-model";

export const WEBINAR_KINDS = ["live", "simulated"] as const;
export type WebinarKind = (typeof WEBINAR_KINDS)[number];

export const WEBINAR_STATUSES = ["draft", "published", "archived"] as const;
export type WebinarStatus = (typeof WEBINAR_STATUSES)[number];

export const SESSION_KINDS = ["live", "simulated", "replay"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_STATUSES = ["scheduled", "waiting", "live", "ended", "cancelled"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

/**
 * "Quem pode" (docs/30 §1.1 e §2.2): Todos, Quem tem o produto, Segmento, Produto ou segmento e, desde a 202610300001,
 * "both" (Quem tem o produto e está no segmento: o segmento so restringe, nunca abre a live a quem nao tem o produto).
 */
export const ACCESS_MODES = ["everyone", "product", "audience", "either", "both"] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];

/**
 * Os valores da coluna webinars.access_mode (o check da 202610280001, que nao muda). O "both" grava 'product' com
 * webinars.audience_restricts = true (202610300001): o app de antes le um valor que nao conhece como 'everyone' e
 * abriria a live para todos num rollback; com 'product' ele continua exigindo o produto (D41).
 */
export const ACCESS_MODE_COLUMN_VALUES = ["everyone", "product", "audience", "either"] as const;
export type AccessModeColumnValue = (typeof ACCESS_MODE_COLUMN_VALUES)[number];

/** O modo confere o produto ligado (os acessos do aluno): Quem tem o produto, Produto ou segmento e "both". */
export function accessModeUsesProduct(mode: AccessMode) {
  return mode === "product" || mode === "either" || mode === "both";
}

/** O modo avalia o segmento (as regras da Comunicacao): Segmento, Produto ou segmento e "both". */
export function accessModeUsesAudience(mode: AccessMode) {
  return mode === "audience" || mode === "either" || mode === "both";
}

/**
 * Ancora do segmento (docs/30 §1.1, D41): so no Segmento e no "both" (Quem tem o produto e está no segmento), quem
 * garantiu vaga neste webinario ou ja entrou numa sessao dele continua dentro do segmento mesmo se sair dele (o "hoje"
 * passou, por exemplo), desde que ainda tenha o produto e a turma que o segmento pede (evaluateAnchoredAudience, com os
 * acessos e as turmas de agora). No "Produto ou segmento" nao ha ancora: vale o produto ou o segmento de agora, porque
 * a linha do acesso nao guarda a historia (nao da para saber por qual lado a vaga veio). O produto ligado ao webinario
 * nunca e ancorado.
 */
export function accessModeAnchorsAudience(mode: AccessMode) {
  return mode === "audience" || mode === "both";
}

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
  /** Live gravada: as horas marcadas (ISO), uma sessao cada; `lateJoinMinutes` = Entrada atrasada (fase 2). */
  sessions: { lateJoinMinutes?: number | null; scheduledAt: string }[];
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
  /** Fase 2: a mensagem fixada pela equipe (webinar_chat_messages.id). */
  pinnedMessageId: string | null;
  /** Fase 2: a curva de presenca congelada no fim (webinar_close_session); nulo enquanto a sessao roda. */
  presenceCurve: PresenceSummary | null;
  recordingAnchorAt: string | null;
  recordingId: string | null;
  /** Fase 3: quando a equipe foi avisada da maquina do gravador ligada ha 6 h (uma vez). */
  recorderAlertedAt: string | null;
  /** Fase 3: quando o app pediu a devolucao da maquina (jibri-down). */
  recorderReleaseRequestedAt: string | null;
  /** Fase 3: quando o app pediu a maquina do gravador (jibri-up). */
  recorderRequestedAt: string | null;
  /** Fase 3: a situacao da maquina do gravador por hora (so na live; nas outras, "none"). */
  recorderStatus: RecorderStatus;
  /** Fase 3: o "Gravar" clicado antes de a maquina ficar pronta (a gravacao comeca sozinha no ready). */
  recordingRequestedAt: string | null;
  /** Fase 3: a sala trancada pelo apresentador (quem chega espera). */
  roomLocked: boolean;
  /** Fase 3 (202610290003): a reserva Gravar no navegador ligada desde esta hora (o selo Gravando do aluno). */
  browserRecordingAt: string | null;
  /** Fase 3: o nome da sala do Jitsi proprio (`w-<webinario>-<16>`); so no servidor, nunca vai para o aluno. */
  roomName: string | null;
  scheduledAt: string;
  /** Fase 2: quando o roteiro entrou na sessao (webinar_open_session). */
  scriptFiredAt: string | null;
  /** Fase 2 (D10): o selo "Ao vivo" na sessao gravada, com quem decidiu e a frase marcada. */
  showLiveBadge: boolean;
  simulationAckText: string | null;
  simulationDecidedAt: string | null;
  simulationDecidedBy: string | null;
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
export function nextSession<T extends Pick<WebinarSession, "endedAt" | "kind" | "scheduledAt" | "status">>(sessions: readonly T[], durationMinutes: number, now: number): T | null {
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

/* ------------------------------------------------------------------------------------------------
 * Fase 2: Live gravada (docs/30 §1.6, §4.2 a §4.6; migracao 202610290001). Listas, limites e tipos do chat por
 * offset, do roteiro, das enquetes, das perguntas, da presenca e do relatorio. As contas ficam em room-model.ts,
 * script-model.ts e report-model.ts.
 * ---------------------------------------------------------------------------------------------- */

export const CHAT_ROLES = ["host", "team", "student", "guest", "ai"] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

export const CHAT_SOURCES = ["original", "audience", "team", "scripted", "ai"] as const;
export type ChatSource = (typeof CHAT_SOURCES)[number];

export const MESSAGE_KINDS = ["message", "question", "answer", "system"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const DELETE_REASONS = ["student", "team", "consent_revoked"] as const;
export type DeleteReason = (typeof DELETE_REASONS)[number];

/** As seis reacoes da barra do aluno (docs/30 §1.3). */
export const REACTIONS = ["like", "love", "clap", "fire", "laugh", "wow"] as const;
export type Reaction = (typeof REACTIONS)[number];

export const POLL_KINDS = ["single", "multiple", "survey"] as const;
export type PollKind = (typeof POLL_KINDS)[number];

export const POLL_STATUSES = ["draft", "open", "closed"] as const;
export type PollStatus = (typeof POLL_STATUSES)[number];

export const QUESTION_STATUSES = ["open", "answered", "dismissed"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const PRESENCE_STATES = ["playing", "paused", "buffering", "hidden"] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

export const SCRIPT_TRIGGERS = ["at_offset", "on_phrase", "manual"] as const;
export type ScriptTrigger = (typeof SCRIPT_TRIGGERS)[number];

export const SCRIPT_STATUSES = ["draft", "ready", "unresolved", "disabled"] as const;
export type ScriptStatus = (typeof SCRIPT_STATUSES)[number];

export const PERSONA_ROLES = ["student", "team"] as const;
export type PersonaRole = (typeof PERSONA_ROLES)[number];

export const TRANSCRIPT_FORMATS = ["json3", "srt", "vtt", "txt"] as const;
export type WebinarTranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

/** A versao do texto de aceite do chat (D10); muda quando o texto mudar, e o aluno aceita de novo. */
export const CHAT_CONSENT_VERSION = 1;

/** Limites do chat, do roteiro, das enquetes e das perguntas (os checks da 202610290001). */
export const CHAT_LIMITS = {
  body: 1000,
  question: 500,
  answer: 1000,
  displayName: 80,
  nicknameMin: 2,
  nicknameMax: 40,
  personaName: 60,
  phraseMin: 2,
  phraseMax: 300,
  phraseDelayMinMs: -60_000,
  phraseDelayMaxMs: 600_000,
  offsetMinMs: -86_400_000,
  offsetMaxMs: 172_800_000,
  scriptItemsMax: 5000,
  scriptCsvBytes: 1_048_576,
  pollQuestion: 300,
  pollOption: 120,
  pollOptionsMax: 20,
  pollOptionsMin: 2,
  transcriptBytes: 2_000_000,
  simulationAck: 600,
  chatPageMax: 200
} as const;

/** Os ritmos da sala (docs/30 §5.1, §6.6, M1 a M4) e os pesos dos "mais quentes" (M3); o SQL repete os mesmos numeros. */
export const ROOM_RULES = {
  heartbeatSeconds: 15,
  bucketSeconds: 30,
  /** Sem sinal por 3 baldes (90 s) a pessoa saiu. */
  leaveAfterBuckets: 3,
  /** A janela do chat baixada de cada vez e de quanto em quanto tempo (gravada e replay). */
  chatWindowSeconds: 120,
  chatRefreshSeconds: 90,
  /** Mensagens novas da turma de hoje: consulta de 5 s. */
  chatPollSeconds: 5,
  /** O player volta para o alvo quando atrasa ou adianta mais que isto. */
  resyncToleranceSeconds: 2,
  clockResyncSeconds: 60,
  chatBurst: { max: 5, windowMs: 60_000 },
  reactions: { perSecond: 1, perMinute: 20 },
  questionsPerMinute: 2,
  /** "Ate o fim" = chegou a 95 % dos baldes (M2). */
  reachedEndRatio: 0.95,
  hotWeights: { message: 1, question: 2, reaction: 0.5, poll: 1, tenMinutes: 1, messageCap: 50 },
  dropPoints: 5,
  topPeople: 10
} as const;

export type ChatMessage = {
  approved: boolean;
  authorUserId: string | null;
  body: string;
  createdAt: string;
  displayName: string;
  id: string;
  kind: MessageKind;
  master: boolean;
  offsetMs: number;
  pinnedAt: string | null;
  replyToId: string | null;
  role: ChatRole;
  scriptItemId: string | null;
  sessionId: string;
  source: ChatSource;
  webinarId: string;
};

/** O que o aluno recebe: a origem `scripted` vira o papel da persona (docs/30 §5.1); `ai` continua `ai`. */
export type StudentChatMessage = {
  body: string;
  displayName: string;
  id: string;
  kind: MessageKind;
  mine: boolean;
  offsetMs: number;
  pending: boolean;
  pinned: boolean;
  replyToId: string | null;
  role: ChatRole;
};

export type ScriptItem = {
  body: string;
  createdAt: string;
  generatedByAi: boolean;
  id: string;
  kind: "message" | "question";
  offsetMs: number | null;
  personaName: string;
  personaRole: PersonaRole;
  phrase: string | null;
  phraseDelayMs: number;
  position: number;
  resolvedOffsetMs: number | null;
  resolvedTranscriptId: string | null;
  status: ScriptStatus;
  triggerKind: ScriptTrigger;
  updatedAt: string;
  webinarId: string;
};

/** O item como a equipe edita (sem ids do banco alem do proprio, que e opcional). */
export type ScriptItemDraft = {
  body: string;
  id?: string | null;
  kind: "message" | "question";
  offsetMs: number | null;
  personaName: string;
  personaRole: PersonaRole;
  phrase: string | null;
  phraseDelayMs: number;
  status: ScriptStatus;
  triggerKind: ScriptTrigger;
};

export type PollOption = { id: string; label: string; position: number };

export type Poll = {
  anonymous: boolean;
  closedAt: string | null;
  id: string;
  kind: PollKind;
  openOffsetMs: number | null;
  openedAt: string | null;
  options: PollOption[];
  position: number;
  question: string;
  resultsSharedAt: string | null;
  sessionId: string | null;
  status: PollStatus;
  templatePollId: string | null;
  webinarId: string;
};

export type PollDraft = { anonymous: boolean; id?: string | null; kind: PollKind; options: { id?: string | null; label: string }[]; question: string };

export type PollAnswer = { createdAt: string; id: string; offsetMs: number; optionIds: string[]; pollId: string; sessionId: string; userId: string };

export type WebinarQuestion = {
  anonymous: boolean;
  answerText: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
  answeredLive: boolean;
  body: string;
  createdAt: string;
  displayName: string;
  id: string;
  messageId: string | null;
  offsetMs: number;
  sessionId: string;
  status: QuestionStatus;
  upvotes: number;
  userId: string;
};

export type ChatConsent = {
  consentVersion: number;
  consentedAt: string;
  displayMode: DisplayNameMode;
  nickname: string | null;
  revokedAt: string | null;
  userId: string;
};

export type PresenceSample = {
  bucket: number;
  firstAt: string;
  lastAt: string;
  offsetSeconds: number;
  samples: number;
  sessionId: string;
  state: PresenceState;
  userId: string;
};

export type Attendance = {
  entries: number;
  firstAt: string;
  lastAt: string;
  maxBucket: number;
  reachedEnd: boolean;
  seconds: number;
  sessionId: string;
  userId: string;
};

/** O que webinar_close_session congela em webinar_sessions.presence_curve. */
export type PresenceSummary = {
  avgPresent: number;
  bucketSeconds: number;
  buckets: { b: number; n: number }[];
  durationMs: number;
  frozenAt: string | null;
  peak: { b: number; n: number } | null;
  reachedEnd: number;
  unique: number;
  watchAvg: number;
  watchMax: number;
};

export type RecordingTranscript = {
  createdAt: string;
  cues: { endSeconds: number | null; startSeconds: number; text: string }[];
  id: string;
  language: string;
  recordingId: string;
  sourceFormat: WebinarTranscriptFormat;
};

/** A fase da sessao gravada pelo relogio do servidor (docs/30 §1.6, §6.6). */
export const SIMULATED_PHASES = ["waiting", "live", "ended"] as const;
export type SimulatedPhase = (typeof SIMULATED_PHASES)[number];
