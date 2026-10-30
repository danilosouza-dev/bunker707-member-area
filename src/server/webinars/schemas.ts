// Schemas zod dos Webinarios (docs/30 §2.2, §5.1 e §5.2). O mesmo schema valida o editor no navegador do admin
// e as Server Actions; as rotas do aluno usam os corpos do fim do arquivo. Modulo puro: sem "server-only",
// imports relativos; tests/webinarios-schemas.test.mjs carrega direto pelo Node. Mensagens no portugues do
// produtor (zod v4: `{ error }`, `z.uuid`, `z.iso.datetime`).

import { z } from "zod";
import { isHttpsOrLoopbackUrl } from "../../lib/loopback-url";
import { catalogIdSchema, expectedUpdatedAtSchema } from "../catalog/schemas";
import { isAudienceGroup, type AudienceDefinition, type AudienceNode } from "../communications/audience-model";
import { accessAudienceDefinitionSchema } from "../communications/schemas";
import {
  ACCESS_MODES,
  CHAT_MODES,
  DISPLAY_NAME_MODES,
  PRESENTER_ROLES,
  WEBINAR_KINDS,
  WEBINAR_LIMITS,
  accessModeUsesProduct,
  type Quality,
  type ReminderSettings,
  type ReminderTexts,
  type ReplayLessonTarget,
  type RoomSettings,
  type WebinarDraft,
  type WebinarPresenter
} from "./model";

export const WEBINAR_MESSAGES = {
  accessAudience: "Monte o segmento ou escolha só o produto.",
  accessProduct: "Escolha o produto que libera o webinário.",
  accessSelfRule: "Escolha outra live: esta regra não pode apontar para este webinário.",
  capacity: "Informe um número de vagas de 1 a 100.000.",
  capacityNeedsRegistration: "O limite de vagas só vale com Garantir vaga ligado.",
  capacityEither: "Para limitar as vagas, use Segmento com o produto como uma das regras: no Produto ou segmento, a vaga de quem sai do segmento continuaria ocupando o limite.",
  coverUrl: "A capa precisa ser um endereço https.",
  dateTime: "Informe data e hora.",
  description: "A descrição pode ter até 2.000 caracteres.",
  duplicatePresenter: "Essa pessoa já está na lista.",
  duration: "A duração vai de 15 minutos a 8 horas.",
  hostRequired: "Escolha o apresentador.",
  pastDate: "A data e a hora já passaram.",
  recordingRequired: "Cole o endereço do vídeo da Bunny para a Live gravada.",
  recordingUrl: "O endereço do vídeo precisa ser https.",
  reminderText: "O texto pode ter até 600 caracteres.",
  sessionsRequired: "Marque pelo menos uma sessão.",
  sessionsTooMany: "No máximo 60 sessões.",
  sessionsUnique: "Duas sessões no mesmo horário.",
  title: "Dê um título ao webinário.",
  titleTooLong: "O título pode ter até 120 caracteres.",
  tooManyCoHosts: "No máximo 5 co-apresentadores.",
  tooManyPresenters: "No máximo 25 pessoas na sala.",
  replayDays: "De 0 a 60 dias.",
  lateJoin: "A entrada atrasada vai de 0 a 600 minutos."
} as const;

const isoSchema = z.iso.datetime({ error: WEBINAR_MESSAGES.dateTime, offset: true });

export function isHttpsUrlText(value: string) {
  try {
    const url = new URL(value);
    return isHttpsOrLoopbackUrl(url) && !url.username && !url.password;
  } catch {
    return false;
  }
}

const httpsOrNull = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .refine((value) => value === "" || isHttpsUrlText(value), message)
    .transform((value) => (value === "" ? null : value))
    .nullable();

const reminderTextSchema = z
  .string()
  .trim()
  .max(WEBINAR_LIMITS.reminderText, WEBINAR_MESSAGES.reminderText)
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .default(null);

export const qualitySchema: z.ZodType<Quality> = z.object({
  screenFps: z.union([z.literal(30), z.literal(15)], { error: "Escolha 30 ou 15 quadros por segundo." }),
  stage: z.union([z.literal(720), z.literal(1080)], { error: "Escolha 720p ou 1080p." })
});

export const roomSettingsSchema: z.ZodType<RoomSettings> = z.object({
  anonymousQuestions: z.boolean(),
  chatMode: z.enum(CHAT_MODES, { error: "Escolha como fica o chat." }),
  displayName: z.enum(DISPLAY_NAME_MODES, { error: "Escolha como o aluno aparece." }),
  newCommentsVisible: z.boolean(),
  polls: z.boolean(),
  practiceSession: z.boolean(),
  questions: z.boolean(),
  reactions: z.boolean(),
  slowModeSeconds: z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(60), z.null()], { error: "Escolha 10, 20, 30 ou 60 segundos." }),
  waitingRoom: z.boolean()
});

export const remindersSchema: z.ZodType<ReminderSettings> = z.object({
  email: z.boolean(),
  h1: z.boolean(),
  h24: z.boolean()
});

export const reminderTextsSchema: z.ZodType<ReminderTexts> = z.object({
  afterAbsent: reminderTextSchema,
  afterAttended: reminderTextSchema,
  confirmation: reminderTextSchema,
  h1: reminderTextSchema,
  h24: reminderTextSchema,
  started: reminderTextSchema
});

export const replayLessonTargetSchema: z.ZodType<ReplayLessonTarget> = z.object({
  autoPublish: z.boolean(),
  moduleId: catalogIdSchema.nullable(),
  productId: catalogIdSchema,
  title: z.string().trim().max(WEBINAR_LIMITS.title, WEBINAR_MESSAGES.titleTooLong).nullable()
});

export const presenterSchema: z.ZodType<WebinarPresenter> = z.object({
  canModerateRoom: z.boolean(),
  role: z.enum(PRESENTER_ROLES, { error: "Escolha co-apresentador ou equipe." }),
  userId: z.uuid({ error: "Escolha alguém da área." })
});

const sessionInputSchema = z.object({
  /** Entrada atrasada (fase 2): ate quantos minutos depois do comeco o aluno ainda entra; nulo = sempre. */
  lateJoinMinutes: z.number({ error: WEBINAR_MESSAGES.lateJoin }).int(WEBINAR_MESSAGES.lateJoin).min(0, WEBINAR_MESSAGES.lateJoin).max(WEBINAR_LIMITS.lateJoinMax, WEBINAR_MESSAGES.lateJoin).nullable().optional(),
  scheduledAt: isoSchema
});

export const webinarDraftObjectSchema = z.object({
  accessMode: z.enum(ACCESS_MODES, { error: "Escolha quem pode ver o webinário." }),
  allowStudentCamera: z.boolean(),
  audience: accessAudienceDefinitionSchema,
  autoRecord: z.boolean(),
  capacity: z.number({ error: WEBINAR_MESSAGES.capacity }).int(WEBINAR_MESSAGES.capacity).min(1, WEBINAR_MESSAGES.capacity).max(WEBINAR_LIMITS.capacityMax, WEBINAR_MESSAGES.capacity).nullable(),
  chatRetentionDays: z.number().int().min(WEBINAR_LIMITS.retentionMin).max(WEBINAR_LIMITS.retentionMax).default(730),
  coverUrl: httpsOrNull(WEBINAR_LIMITS.coverUrl, WEBINAR_MESSAGES.coverUrl),
  description: z.string().trim().max(WEBINAR_LIMITS.description, WEBINAR_MESSAGES.description).default(""),
  durationMinutes: z.number({ error: WEBINAR_MESSAGES.duration }).int(WEBINAR_MESSAGES.duration).min(WEBINAR_LIMITS.durationMin, WEBINAR_MESSAGES.duration).max(WEBINAR_LIMITS.durationMax, WEBINAR_MESSAGES.duration),
  hostUserId: z.uuid({ error: WEBINAR_MESSAGES.hostRequired }).nullable(),
  kind: z.enum(WEBINAR_KINDS, { error: "Escolha Live ao vivo ou Live gravada." }),
  presenters: z.array(presenterSchema).max(WEBINAR_LIMITS.presentersMax, WEBINAR_MESSAGES.tooManyPresenters).default([]),
  productId: catalogIdSchema.nullable(),
  quality: qualitySchema,
  recordingRetentionDays: z.number().int().min(WEBINAR_LIMITS.retentionMin).max(WEBINAR_LIMITS.retentionMax).default(730),
  recordingVideoUrl: httpsOrNull(WEBINAR_LIMITS.recordingUrl, WEBINAR_MESSAGES.recordingUrl),
  registrationRequired: z.boolean(),
  reminderTexts: reminderTextsSchema,
  reminders: remindersSchema,
  replayDaysOnHome: z.number({ error: WEBINAR_MESSAGES.replayDays }).int(WEBINAR_MESSAGES.replayDays).min(0, WEBINAR_MESSAGES.replayDays).max(WEBINAR_LIMITS.replayDaysMax, WEBINAR_MESSAGES.replayDays),
  replayLessonTarget: replayLessonTargetSchema.nullable(),
  roomSettings: roomSettingsSchema,
  scheduledAt: isoSchema.nullable(),
  sessions: z.array(sessionInputSchema).max(WEBINAR_LIMITS.sessionsMax, WEBINAR_MESSAGES.sessionsTooMany).default([]),
  showBanner: z.boolean(),
  showOnHome: z.boolean(),
  showRegisteredCount: z.boolean(),
  title: z.string().trim().max(WEBINAR_LIMITS.title, WEBINAR_MESSAGES.titleTooLong)
});

export const webinarDraftSchema: z.ZodType<WebinarDraft> = webinarDraftObjectSchema.superRefine((draft, context) => {
  const seen = new Set<string>();
  draft.presenters.forEach((presenter, index) => {
    if (seen.has(presenter.userId)) {
      context.addIssue({ code: "custom", message: WEBINAR_MESSAGES.duplicatePresenter, path: ["presenters", index, "userId"] });
    }
    seen.add(presenter.userId);
  });
  if (draft.presenters.filter((presenter) => presenter.role === "co_host").length > WEBINAR_LIMITS.coHostsMax) {
    context.addIssue({ code: "custom", message: WEBINAR_MESSAGES.tooManyCoHosts, path: ["presenters"] });
  }
  if (draft.capacity != null && !draft.registrationRequired) {
    context.addIssue({ code: "custom", message: WEBINAR_MESSAGES.capacityNeedsRegistration, path: ["capacity"] });
  }
  // "Produto ou segmento" nao tem ancora (D41): a vaga de quem sai do segmento sem o produto nao abre mais a sala, nao
  // recebe aviso e ninguem consegue solta-la (a pagina da 404), mas contaria no Limite de vagas e esgotaria a live para
  // quem entra depois. Com limite, a vaga precisa segurar: Segmento com o produto como uma das regras.
  if (draft.accessMode === "either" && draft.capacity != null) {
    context.addIssue({ code: "custom", message: WEBINAR_MESSAGES.capacityEither, path: ["capacity"] });
  }
  if (accessModeUsesProduct(draft.accessMode) && !draft.productId) {
    context.addIssue({ code: "custom", message: WEBINAR_MESSAGES.accessProduct, path: ["productId"] });
  }
  // "Quem tem o produto e está no segmento": sem segmento seria so o produto (o segmento so restringe).
  if (draft.accessMode === "both" && draft.audience.kind !== "rules") {
    context.addIssue({ code: "custom", message: WEBINAR_MESSAGES.accessAudience, path: ["audience"] });
  }
  const times = new Set<number>();
  draft.sessions.forEach((session, index) => {
    const time = new Date(session.scheduledAt).getTime();
    if (times.has(time)) {
      context.addIssue({ code: "custom", message: WEBINAR_MESSAGES.sessionsUnique, path: ["sessions", index, "scheduledAt"] });
    }
    times.add(time);
  });
});

/** O que falta para publicar (docs/30 §2.2): a mesma lista na tela e na Server Action. */
export function publishProblems(draft: WebinarDraft, now: number): { message: string; path: string }[] {
  const problems: { message: string; path: string }[] = [];
  if (!draft.title.trim()) {
    problems.push({ message: WEBINAR_MESSAGES.title, path: "title" });
  }
  if (draft.kind === "live") {
    if (!draft.scheduledAt) {
      problems.push({ message: WEBINAR_MESSAGES.dateTime, path: "scheduledAt" });
    } else if (new Date(draft.scheduledAt).getTime() <= now) {
      problems.push({ message: WEBINAR_MESSAGES.pastDate, path: "scheduledAt" });
    }
    if (!draft.hostUserId) {
      problems.push({ message: WEBINAR_MESSAGES.hostRequired, path: "hostUserId" });
    }
  } else {
    if (!draft.recordingVideoUrl) {
      problems.push({ message: WEBINAR_MESSAGES.recordingRequired, path: "recordingVideoUrl" });
    }
    if (draft.sessions.length === 0) {
      problems.push({ message: WEBINAR_MESSAGES.sessionsRequired, path: "sessions" });
    } else if (!draft.sessions.some((session) => new Date(session.scheduledAt).getTime() > now)) {
      problems.push({ message: WEBINAR_MESSAGES.pastDate, path: "sessions" });
    }
  }
  if (accessModeUsesProduct(draft.accessMode) && !draft.productId) {
    problems.push({ message: WEBINAR_MESSAGES.accessProduct, path: "productId" });
  }
  if (draft.accessMode === "both" && draft.audience.kind !== "rules") {
    problems.push({ message: WEBINAR_MESSAGES.accessAudience, path: "audience" });
  }
  return problems;
}

export const webinarIdSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
  id: z.uuid({ error: "Webinário inválido." })
});

/**
 * Onde o segmento cita o proprio webinario numa regra de lives ("participou desta live" seria um laco: quem entra na
 * sala sai do segmento). Devolve os caminhos das regras, no formato do zod ("root", "items", 0, ...).
 */
export function selfWebinarRulePaths(audience: AudienceDefinition, webinarId: string): (number | string)[][] {
  const paths: (number | string)[][] = [];
  const visit = (node: AudienceNode, path: (number | string)[]) => {
    if (isAudienceGroup(node)) {
      node.items.forEach((item, index) => visit(item, [...path, "items", index]));
      return;
    }
    if (node.type === "webinar" && node.webinarId === webinarId) {
      paths.push(path);
    }
  };

  if (audience.kind === "rules") {
    visit(audience.root, ["root"]);
  }

  return paths;
}

export const saveWebinarSchema = z
  .object({
    draft: webinarDraftSchema,
    expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
    id: z.uuid({ error: "Webinário inválido." }).optional()
  })
  .superRefine((input, context) => {
    if (!input.id) {
      return;
    }
    for (const path of selfWebinarRulePaths(input.draft.audience, input.id)) {
      context.addIssue({ code: "custom", message: WEBINAR_MESSAGES.accessSelfRule, path: ["draft", "audience", ...path] });
    }
  });
export type SaveWebinarInput = z.infer<typeof saveWebinarSchema>;

export const cancelWebinarSchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema.optional(),
  id: z.uuid({ error: "Webinário inválido." }),
  reason: z.string().trim().max(WEBINAR_LIMITS.cancelReason, "O motivo pode ter até 500 caracteres.").default("")
});

export const rescheduleSessionSchema = z.object({
  scheduledAt: isoSchema,
  sessionId: z.uuid({ error: "Sessão inválida." }),
  webinarId: z.uuid({ error: "Webinário inválido." })
});

/** Corpo de POST /api/webinars/[id]/register (docs/30 §5.1). */
export const registerBodySchema = z.object({
  sessionId: z.uuid({ error: "Sessão inválida." }).nullable().optional(),
  source: z
    .string()
    .trim()
    .max(WEBINAR_LIMITS.source)
    .regex(/^[A-Za-z0-9_.:-]*$/, "Origem inválida.")
    .optional()
});
export type RegisterBodyInput = z.infer<typeof registerBodySchema>;

/** Corpo de DELETE /api/webinars/[id]/register. */
export const unregisterBodySchema = z.object({
  sessionId: z.uuid({ error: "Sessão inválida." }).nullable().optional()
});
