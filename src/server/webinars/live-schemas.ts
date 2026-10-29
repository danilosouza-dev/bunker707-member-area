// Schemas zod da fase 3, a sala ao vivo (docs/30 §5.1 join-token e room-events, §5.2 as acoes do host, §5.3 o
// webhook do gravador). Modulo puro: sem "server-only", imports relativos; tests/webinarios-sala-ao-vivo-modelo.test.mjs
// carrega direto pelo Node. Mensagens no portugues do produtor (zod v4).

import { z } from "zod";

export const LIVE_MESSAGES = {
  invalid: "Pedido inválido.",
  reason: "O motivo pode ter até 200 caracteres.",
  session: "Sessão inválida.",
  tooManyEvents: "No máximo 20 sinais por lote."
} as const;

const uuidSchema = z.uuid({ error: LIVE_MESSAGES.invalid });
const sessionIdSchema = z.uuid({ error: LIVE_MESSAGES.session });

/** POST /join-token { sessionId }: so kind live em waiting/live; o banido recebe 409. */
export const joinTokenBodySchema = z.object({ sessionId: sessionIdSchema });

/** Os sinais do iframe que viram linhas em student_events (docs/30 §6.3): nomes fixos, nunca texto livre. */
export const ROOM_EVENT_NAMES = [
  "videoConferenceJoined",
  "videoConferenceLeft",
  "raiseHandUpdated",
  "audioMuteStatusChanged",
  "videoMuteStatusChanged",
  "recordingStatusChanged",
  "participantRoleChanged",
  "errorOccurred"
] as const;
export type RoomEventName = (typeof ROOM_EVENT_NAMES)[number];

const roomEventDataSchema = z
  .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean(), z.null()]))
  .refine((data) => Object.keys(data).length <= 12, { message: LIVE_MESSAGES.invalid });

/** POST /room-events { sessionId, events: [{ name, at, data }] } em lotes de ate 20. */
export const roomEventsBodySchema = z.object({
  events: z
    .array(
      z.object({
        at: z.iso.datetime({ offset: true }),
        data: roomEventDataSchema.optional(),
        name: z.enum(ROOM_EVENT_NAMES, { error: LIVE_MESSAGES.invalid })
      })
    )
    .min(1)
    .max(20, LIVE_MESSAGES.tooManyEvents),
  sessionId: sessionIdSchema
});
export type RoomEventsInput = z.infer<typeof roomEventsBodySchema>;

export const RECORDER_STATES = ["ready", "recording", "uploaded", "upload_failed", "unavailable", "gone"] as const;
export type RecorderState = (typeof RECORDER_STATES)[number];

/** O corpo do webhook do gravador (docs/30 §5.3); so sessionId e state sao obrigatorios. */
export const recorderWebhookBodySchema = z.object({
  bunnyLibraryId: z.string().trim().max(40).optional(),
  bunnyVideoId: z.string().trim().max(80).optional(),
  durationSeconds: z.number().int().min(0).max(86_400).optional(),
  error: z.string().trim().max(2000).optional(),
  fileName: z.string().trim().max(255).optional(),
  room: z.string().trim().max(120).optional(),
  sessionId: uuidSchema,
  sha256: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{64}$/i, LIVE_MESSAGES.invalid)
    .optional(),
  sizeBytes: z.number().int().min(0).optional(),
  /** O sufixo yyyy-MM-dd-HH-mm-ss do arquivo do Jibri (UTC) ou um ISO. */
  startedAt: z.string().trim().max(40).optional(),
  state: z.enum(RECORDER_STATES, { error: LIVE_MESSAGES.invalid })
});
export type RecorderWebhookInput = z.infer<typeof recorderWebhookBodySchema>;

/* Acoes do host e da equipe (Server Actions, docs/30 §5.2) */

export const sessionActionSchema = z.object({ sessionId: sessionIdSchema });

export const BAN_KINDS = ["kicked", "muted"] as const;
export type BanKind = (typeof BAN_KINDS)[number];

/** Silenciar por 5 / 15 / 60 min ou ate o fim (nulo); remover vale ate o fim. */
export const MUTE_MINUTES = [5, 15, 60] as const;

export const banStudentSchema = z
  .object({
    kind: z.enum(BAN_KINDS, { error: LIVE_MESSAGES.invalid }),
    minutes: z.union([z.literal(5), z.literal(15), z.literal(60)]).nullable().optional(),
    reason: z.string().trim().max(200, LIVE_MESSAGES.reason).optional(),
    sessionId: sessionIdSchema,
    userId: uuidSchema
  })
  .superRefine((input, context) => {
    if (input.kind === "kicked" && input.minutes) {
      context.addIssue({ code: "custom", message: LIVE_MESSAGES.invalid, path: ["minutes"] });
    }
  });

export const unbanStudentSchema = z.object({ kind: z.enum(BAN_KINDS), sessionId: sessionIdSchema, userId: uuidSchema });

/** Liga um video da Bunny (endereco do player ou biblioteca + video) a sessao. */
export const attachRecordingSchema = z
  .object({
    bunnyLibraryId: z.string().trim().max(40).optional(),
    bunnyVideoId: z.string().trim().max(80).optional(),
    durationSeconds: z.number().int().min(0).max(86_400).nullable().optional(),
    embedUrl: z.string().trim().max(2048).optional(),
    sessionId: sessionIdSchema
  })
  .superRefine((input, context) => {
    if (!input.embedUrl && !(input.bunnyLibraryId && input.bunnyVideoId)) {
      context.addIssue({ code: "custom", message: "Cole o endereço do player ou informe biblioteca e vídeo.", path: ["embedUrl"] });
    }
  });

/** "Alinhar chat": o ajuste fino ± segundos da gravacao (nenhum offset de mensagem e reescrito). */
export const alignChatSchema = z.object({
  anchorOffsetMs: z.number().int().min(-3_600_000).max(3_600_000),
  recordingId: uuidSchema
});

/** Banir: o aluno nao entra em nenhum webinario ate a equipe desfazer (webinar_user_bans; messaging.publish). */
export const banUserSchema = z.object({
  reason: z.string().trim().max(200, LIVE_MESSAGES.reason).optional(),
  sessionId: sessionIdSchema,
  userId: uuidSchema
});

/** Desfazer o banimento (apaga a linha de webinar_user_bans; messaging.publish). */
export const unbanUserSchema = z.object({ reason: z.string().trim().max(200, LIVE_MESSAGES.reason).optional(), userId: uuidSchema });

/** Trancar / destrancar a sala (webinar_sessions.room_locked; o navegador do apresentador chama toggleLobby). */
export const roomLockSchema = z.object({ locked: z.boolean(), sessionId: sessionIdSchema });

/** A reserva "Gravar no navegador" ligou ou desligou (o selo Gravando do aluno). */
export const browserRecordingSchema = z.object({ on: z.boolean(), sessionId: sessionIdSchema });

/** Devolver a maquina do gravador (jibri-down); `force` so com a confirmacao do produtor (FORCAR=1 no workflow). */
export const releaseRecorderSchema = z.object({ force: z.boolean().optional(), sessionId: sessionIdSchema });
