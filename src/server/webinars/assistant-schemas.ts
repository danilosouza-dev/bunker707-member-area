// Schemas zod do Assistente de IA, dos atendentes e do modo hibrido (fase 4c; docs/30 §1.6, §2.4, §6.6 e D24). Modulo
// puro (sem "server-only", imports relativos; zod v4). As mensagens passam pela lista PROIBIDAS_WEBINARIO.

import { z } from "zod";
import { ASSISTANT_LIMITS, ASSISTANT_TARGETS, ATTENDANT_STATUSES, CHAT_LIMITS } from "./model";

export const ASSISTANT_MESSAGES = {
  answer: `A resposta tem de 1 a ${ASSISTANT_LIMITS.answer} caracteres.`,
  invalid: "Pedido inválido.",
  question: `A pergunta tem de ${ASSISTANT_LIMITS.questionMin} a ${ASSISTANT_LIMITS.question} caracteres.`,
  tooMany: `No máximo ${ASSISTANT_LIMITS.knowledgeMax} perguntas e respostas por webinário.`
} as const;

export const assistantSettingsSchema = z.object({ enabled: z.boolean().default(false), replyAllDefault: z.boolean().default(false) });

export const assistantKnowledgeItemSchema = z.object({
  answer: z.string().trim().min(1, ASSISTANT_MESSAGES.answer).max(ASSISTANT_LIMITS.answer, ASSISTANT_MESSAGES.answer),
  id: z.uuid().nullable().optional(),
  question: z.string().trim().min(ASSISTANT_LIMITS.questionMin, ASSISTANT_MESSAGES.question).max(ASSISTANT_LIMITS.question, ASSISTANT_MESSAGES.question)
});

/** O card Assistente do editor [messaging.write]: ligado ou nao e as perguntas e respostas cadastradas, na ordem. */
export const saveAssistantSchema = z.object({
  items: z.array(assistantKnowledgeItemSchema).max(ASSISTANT_LIMITS.knowledgeMax, ASSISTANT_MESSAGES.tooMany),
  settings: assistantSettingsSchema,
  webinarId: z.uuid({ error: ASSISTANT_MESSAGES.invalid })
});

/** "Responder tudo" no console [messaging.write]. */
export const replyAllSchema = z.object({ on: z.boolean(), sessionId: z.uuid({ error: ASSISTANT_MESSAGES.invalid }) });

/** A batida do atendente no console (online / ausente) [messaging.write]. */
export const attendantPingSchema = z.object({ sessionId: z.uuid({ error: ASSISTANT_MESSAGES.invalid }), status: z.enum(ATTENDANT_STATUSES) });

/** "Assumir" (ou passar / devolver: userId nulo) uma pergunta ou pergunta do chat [messaging.write]. */
export const assignAttendanceSchema = z.object({
  id: z.uuid({ error: ASSISTANT_MESSAGES.invalid }),
  sessionId: z.uuid({ error: ASSISTANT_MESSAGES.invalid }),
  target: z.enum(ASSISTANT_TARGETS),
  userId: z.uuid().nullable()
});

/** A equipe corrige a resposta do Assistente [messaging.write]. */
export const editAssistantMessageSchema = z.object({
  body: z.string().trim().min(1).max(CHAT_LIMITS.body),
  messageId: z.uuid({ error: ASSISTANT_MESSAGES.invalid })
});

/** POST /api/webinars/[id]/handoff { sessionId, target, id }: "Falar com a equipe" do aluno, so no que e dele. */
export const handoffBodySchema = z.object({
  id: z.uuid({ error: ASSISTANT_MESSAGES.invalid }),
  sessionId: z.uuid({ error: ASSISTANT_MESSAGES.invalid }),
  target: z.enum(ASSISTANT_TARGETS)
});
