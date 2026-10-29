"use server";

// Server Actions do Assistente e do Atendimento (docs/30 §1.6, §2.2, §2.4, §2.6, §6.6 e D24; fase 4c), todas com
// messaging.write por runAdminAction: o card Assistente do editor (loadAssistantEditor e saveAssistant: ligado no
// webinario, "Responder tudo" padrao das sessoes que ainda nao comecaram, as perguntas e respostas cadastradas), o
// painel Atendimento do console (loadAttendanceSnapshot a cada 5 s, que tambem distribui as perguntas novas entre quem
// esta atendendo; pingAttendant a cada 30 s com "Atender" / "Pausar"; assign para Assumir, Devolver e Passar para;
// setReplyAll) e "Corrigir resposta" do chat (editAssistantAnswer; apagar segue por moderateMessage). As escritas
// gravam recordAudit so com ids, contagens e codigos (nunca o texto). Banco sem a 202610290006: as leituras devolvem
// { pendingMigration } (a tela mostra o aviso) e as escritas respondem 409 com a frase da migracao.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { runAdminAction } from "@/server/actions/run-action";
import { recordAudit } from "@/server/audit/log";
import { isPendingMigrationError } from "@/server/db/pending-migration";
import { applyReplyAllDefault, fetchAiRequestByReply, loadAttendanceSnapshot as readAttendanceSnapshot, type AttendanceSnapshotResult } from "./assistant-queries";
import { hasActiveAiConnection } from "./assistant-provider";
import { ASSISTANT_MESSAGES, assignAttendanceSchema, attendantPingSchema, editAssistantMessageSchema, replyAllSchema, saveAssistantSchema } from "./assistant-schemas";
import {
  assignAttendance,
  editAssistantMessage,
  fetchAssistantSettings,
  fetchAttendanceMarks,
  listAttendants,
  listKnowledge,
  replaceKnowledge,
  saveAssistantSettings,
  setSessionReplyAll,
  upsertAttendant
} from "./assistant-store";
import { invalidateWebinars } from "./cache";
import { chatMessageFromRow } from "./chat-rows";
import { fetchChatMessageRow, fetchQuestionRow, updateQuestionRow } from "./chat-store";
import { WEBINARS_ASSISTANT_MIGRATION, WebinarError, WebinarFieldError, webinarsDb, type WebinarsDb } from "./db";
import type { AssistantKnowledgeItem, AssistantSettings, AssistantTarget, Attendant, AttendantStatus, ChatMessage } from "./model";
import { fetchSessionRow, requireWebinarRow } from "./store";
import { webinarAssistantEnabled } from "./v4-env";

const LIST_PATH = "/admin/comunicacao/webinarios";
const COPY = WEBINAR_COPY.assistente;

const webinarIdSchema = z.object({ webinarId: z.uuid({ error: ASSISTANT_MESSAGES.invalid }) });
const sessionIdSchema = z.object({ sessionId: z.uuid({ error: ASSISTANT_MESSAGES.invalid }) });

export type PendingAssistantMigration = { migration: string; pendingMigration: true };

export type AssistantEditorData =
  | PendingAssistantMigration
  | { aiAvailable: boolean; envEnabled: boolean; items: AssistantKnowledgeItem[]; pendingMigration: false; settings: AssistantSettings };

/** `updatedAt`: assistant_settings mora em webinars e o gatilho muda o updated_at; o editor segue com a versao nova. */
export type SavedAssistant = { items: AssistantKnowledgeItem[]; sessionsUpdated: number; settings: AssistantSettings; updatedAt: string };

const pending = (): PendingAssistantMigration => ({ migration: WEBINARS_ASSISTANT_MIGRATION, pendingMigration: true });

/** Uma escrita que esbarra no banco sem a 202610290006 vira 409 com a frase da migracao (nunca um 500 generico). */
async function withAssistantTables<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isPendingMigrationError(error)) {
      throw new WebinarError(COPY.erros.precisaMigracao(WEBINARS_ASSISTANT_MIGRATION), 409);
    }
    throw error;
  }
}

async function aiAvailableSafely(db: WebinarsDb): Promise<boolean> {
  try {
    return await hasActiveAiConnection(db);
  } catch {
    return false;
  }
}

async function requireSession(db: WebinarsDb, sessionId: string) {
  const row = await fetchSessionRow(db, sessionId);
  if (!row) {
    throw new WebinarError(COPY.erros.sessaoInexistente, 404);
  }
  return row;
}

/* ------------------------------------------------------------------------------------------------
 * O card Assistente do editor
 * ---------------------------------------------------------------------------------------------- */

/** [messaging.write] O Assistente do webinario, as perguntas e respostas cadastradas e se o ambiente e a IA deixam. */
export async function loadAssistantEditor(input: { webinarId: string }): Promise<ActionResult<AssistantEditorData>> {
  return runAdminAction("messaging.write", webinarIdSchema, input, async ({ input: data }) => {
    const db = webinarsDb();
    const webinar = await requireWebinarRow(db, data.webinarId);
    const envEnabled = webinarAssistantEnabled();
    try {
      const [settings, items] = await Promise.all([fetchAssistantSettings(db, webinar.id), listKnowledge(db, webinar.id)]);
      return {
        aiAvailable: envEnabled ? await aiAvailableSafely(db) : false,
        envEnabled,
        items,
        pendingMigration: false as const,
        settings: settings ?? { enabled: false, replyAllDefault: false }
      };
    } catch (error) {
      if (isPendingMigrationError(error)) {
        return pending();
      }
      throw error;
    }
  });
}

/**
 * [messaging.write] Salva o card Assistente: ligado ou nao, o "Responder tudo" padrao (aplicado tambem as sessoes que
 * ainda nao comecaram quando muda) e as perguntas e respostas, na ordem (as que sairam sao apagadas).
 */
export async function saveAssistant(input: { items: { answer: string; id?: string | null; question: string }[]; settings: AssistantSettings; webinarId: string }): Promise<ActionResult<SavedAssistant>> {
  return runAdminAction("messaging.write", saveAssistantSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const webinar = await requireWebinarRow(db, data.webinarId);
    const result = await withAssistantTables(async () => {
      const previous = await fetchAssistantSettings(db, webinar.id);
      const settings = await saveAssistantSettings(db, { settings: data.settings, webinarId: webinar.id });
      const items = await replaceKnowledge(db, { items: data.items, userId: user.id, webinarId: webinar.id });
      const sessionsUpdated = previous?.replyAllDefault !== settings.replyAllDefault ? await applyReplyAllDefault(db, { on: settings.replyAllDefault, webinarId: webinar.id }) : 0;
      return { items, sessionsUpdated, settings };
    });

    await recordAudit(db, {
      action: "webinar.assistant_saved",
      actorId: user.id,
      count: result.items.length,
      entityId: webinar.id,
      entityType: "webinar",
      metadata: { enabled: result.settings.enabled, items: result.items.length, reply_all_default: result.settings.replyAllDefault, sessions_updated: result.sessionsUpdated }
    });
    revalidatePath(`${LIST_PATH}/${webinar.id}`);
    const after = await requireWebinarRow(db, webinar.id);

    return { ...result, updatedAt: after.updated_at };
  });
}

/* ------------------------------------------------------------------------------------------------
 * O painel Atendimento do console
 * ---------------------------------------------------------------------------------------------- */

/**
 * [messaging.write] O retrato do Atendimento (a cada 5 s): o Assistente, quem esta atendendo, a fila e as marcas das
 * perguntas; distribui as perguntas novas sem dono entre os atendentes online (nunca tira de quem assumiu).
 */
export async function loadAttendanceSnapshot(input: { sessionId: string }): Promise<ActionResult<AttendanceSnapshotResult>> {
  return runAdminAction("messaging.write", sessionIdSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const snapshot = await readAttendanceSnapshot(db, { currentUserId: user.id, distribute: true, sessionId: data.sessionId });

    if (!snapshot.pendingMigration && snapshot.distributed > 0) {
      await recordAudit(db, {
        action: "webinar.attendance_distributed",
        actorId: user.id,
        count: snapshot.distributed,
        entityId: snapshot.webinarId,
        entityType: "webinar",
        metadata: { distributed: snapshot.distributed, session_id: snapshot.sessionId }
      });
    }

    return snapshot;
  });
}

/** [messaging.write] "Responder tudo" da sessao: o Assistente responde as perguntas novas que ninguem assumiu. */
export async function setReplyAll(input: { on: boolean; sessionId: string }): Promise<ActionResult<{ on: boolean; sessionId: string }>> {
  return runAdminAction("messaging.write", replyAllSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const session = await requireSession(db, data.sessionId);
    const on = await withAssistantTables(() => setSessionReplyAll(db, { on: data.on, sessionId: session.id }));

    await recordAudit(db, {
      action: "webinar.assistant_reply_all",
      actorId: user.id,
      entityId: session.webinar_id,
      entityType: "webinar",
      metadata: { on, session_id: session.id }
    });

    return { on, sessionId: session.id };
  });
}

/**
 * [messaging.write] A batida do atendente ("Atender" = online, "Pausar" = ausente), a cada 30 s com o painel aberto.
 * A auditoria guarda so a troca de situacao (nao cada batida).
 */
export async function pingAttendant(input: { sessionId: string; status: AttendantStatus }): Promise<ActionResult<Attendant>> {
  return runAdminAction("messaging.write", attendantPingSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const session = await requireSession(db, data.sessionId);
    const result = await withAssistantTables(async () => {
      const before = (await listAttendants(db, session.id)).find((attendant) => attendant.userId === user.id) ?? null;
      const attendant = await upsertAttendant(db, { nowIso: new Date().toISOString(), sessionId: session.id, status: data.status, userId: user.id });
      return { attendant, changed: before?.status !== attendant.status };
    });

    if (result.changed) {
      await recordAudit(db, {
        action: "webinar.attendant_status",
        actorId: user.id,
        entityId: session.webinar_id,
        entityType: "webinar",
        metadata: { session_id: session.id, status: result.attendant.status }
      });
    }

    return result.attendant;
  });
}

/** O alvo (pergunta ou mensagem da turma) desta sessao, ainda la; senao 404. */
async function requireAttendanceTarget(db: WebinarsDb, input: { id: string; sessionId: string; target: AssistantTarget }) {
  if (input.target === "question") {
    const row = await fetchQuestionRow(db, input.id);
    if (!row || row.session_id !== input.sessionId || row.deleted_at) {
      throw new WebinarError(COPY.erros.perguntaInexistente, 404);
    }
    return;
  }
  const row = await fetchChatMessageRow(db, input.id);
  if (!row || row.session_id !== input.sessionId || row.deleted_at || row.source !== "audience") {
    throw new WebinarError(COPY.erros.mensagemInexistente, 404);
  }
}

/**
 * [messaging.write] Assumir (o proprio id), Passar para (alguem que esta atendendo nesta sessao) ou Devolver para a
 * fila (userId nulo) uma pergunta ou pergunta do chat. O Assistente cala na pergunta que tem dono.
 */
export async function assign(input: { id: string; sessionId: string; target: AssistantTarget; userId: string | null }): Promise<ActionResult<{ assignedTo: string | null; changed: boolean }>> {
  return runAdminAction("messaging.write", assignAttendanceSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const session = await requireSession(db, data.sessionId);
    await requireAttendanceTarget(db, { id: data.id, sessionId: session.id, target: data.target });

    const result = await withAssistantTables(async () => {
      if (data.userId && data.userId !== user.id) {
        const attendants = await listAttendants(db, session.id);
        if (!attendants.some((attendant) => attendant.userId === data.userId)) {
          throw new WebinarFieldError("userId", COPY.erros.atendenteInvalido);
        }
      }
      const before = (await fetchAttendanceMarks(db, { ids: [data.id], target: data.target })).get(data.id) ?? null;
      const changed = await assignAttendance(db, { id: data.id, nowIso: new Date().toISOString(), target: data.target, userId: data.userId });
      return { before: before?.assignedTo ?? null, changed };
    });

    await recordAudit(db, {
      action: "webinar.attendance_assigned",
      actorId: user.id,
      entityId: session.webinar_id,
      entityType: "webinar",
      metadata: { from: result.before, id: data.id, session_id: session.id, target: data.target, to: data.userId }
    });
    revalidatePath(`${LIST_PATH}/${session.webinar_id}/sala`);

    return { assignedTo: data.userId, changed: result.changed };
  });
}

/**
 * [messaging.write] "Corrigir resposta": o texto novo numa resposta do Assistente (source 'ai'), com a marca de quem
 * corrigiu (o relatorio conta as corrigidas); a pergunta da aba que ela respondeu ganha o mesmo texto.
 */
export async function editAssistantAnswer(input: { body: string; messageId: string }): Promise<ActionResult<{ message: ChatMessage }>> {
  return runAdminAction("messaging.write", editAssistantMessageSchema, input, async ({ input: data, user }) => {
    const db = webinarsDb();
    const message = await fetchChatMessageRow(db, data.messageId);
    if (!message || message.deleted_at) {
      throw new WebinarError(COPY.erros.mensagemInexistente, 404);
    }
    if (message.source !== "ai") {
      throw new WebinarError(COPY.erros.soRespostaDoAssistente, 409);
    }

    const questionId = await withAssistantTables(async () => {
      const edited = await editAssistantMessage(db, { body: data.body, messageId: message.id, nowIso: new Date().toISOString(), userId: user.id });
      if (!edited) {
        throw new WebinarError(COPY.erros.soRespostaDoAssistente, 409);
      }
      const request = await fetchAiRequestByReply(db, message.id);
      if (request?.targetKind === "question") {
        await updateQuestionRow(db, request.targetId, { answer_text: data.body });
        return request.targetId;
      }
      return null;
    });
    const updated = (await fetchChatMessageRow(db, message.id)) ?? { ...message, body: data.body };

    await recordAudit(db, {
      action: "webinar.assistant_answer_edited",
      actorId: user.id,
      entityId: message.webinar_id,
      entityType: "webinar",
      metadata: { length: data.body.length, message_id: message.id, question_id: questionId, session_id: message.session_id }
    });
    revalidatePath(`${LIST_PATH}/${message.webinar_id}/sala`);
    invalidateWebinars({ from: "action" });

    return { message: chatMessageFromRow(updated) };
  });
}
