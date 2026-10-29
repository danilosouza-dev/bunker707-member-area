// Leituras do Assistente e do Atendimento (docs/30 §1.6, §2.4, §6.6 e D24; fase 4c), pela service role: o estado que
// a sala do aluno pede (GET /api/webinars/[id]/assistant: ligado, "Responder tudo" e quantos estao atendendo), quem e
// da equipe (nunca recebe resposta do Assistente), o MATERIAL do Assistente (as perguntas e respostas cadastradas, as
// cues da transcricao da gravacao da sessao e o nome do produto), se o aluno ainda esta na sala (o aviso do sino da
// resposta da equipe), o "Responder tudo" padrao aplicado as sessoes que ainda nao comecaram e o retrato do painel
// Atendimento do console, com a distribuicao automatica das perguntas novas entre os atendentes online feita na propria
// leitura (onlyIfUnassigned: nunca tira de quem assumiu). Banco sem a 202610300004: o estado da sala diz desligado e o
// retrato devolve { pendingMigration } (o console mostra o aviso). As regras puras ficam em assistant-model.ts.

import "server-only";

import { isPendingMigrationError } from "../db/pending-migration";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import {
  attendanceQueueOf,
  attendantIsOnline,
  buildAssistantContext,
  distributeQueue,
  mightCallAssistant,
  openCountByAttendant,
  ASSISTANT_OFF,
  type AttendanceQueueItem,
  type AssistantTrigger,
  type StudentAssistantState
} from "./assistant-model";
import { hasActiveAiConnection } from "./assistant-provider";
import { assignAttendance, fetchAssistantSettings, fetchAttendanceMarks, fetchSessionReplyAll, listAttendants, listKnowledge, listSessionAiRequests } from "./assistant-store";
import { chatMessageFromRow, questionFromRow, transcriptCuesOf } from "./chat-rows";
import { fetchTranscriptRow, listQuestionRows, listSessionChatRows } from "./chat-store";
import { WEBINARS_ASSISTANT_MIGRATION, WebinarError, assertNoDbError, type WebinarsDb } from "./db";
import { presenceOffsetMs } from "./live-model";
import { firstNameInitial, presenceBucket } from "./room-model";
import { AI_REQUEST_COLUMNS, aiRequestFromRow, sessionFromRow, type AiRequestRow } from "./rows";
import { ROOM_RULES, type AnswerSource, type AssistantRequest, type AttendanceMarks, type AttendantStatus, type SessionKind, type Webinar, type WebinarSession } from "./model";
import { fetchSessionRow, fetchWebinarRow, listPresenterRows } from "./store";
import { webinarAssistantEnabled } from "./v4-env";

type Env = Record<string, string | undefined>;

const COPY = WEBINAR_COPY.assistente;

/** "Tem conexao de IA ativa", sem nunca derrubar a tela: a falha da leitura conta como desligado. */
async function aiAvailableSafely(db: WebinarsDb, check: (db: WebinarsDb) => Promise<boolean>): Promise<boolean> {
  try {
    return await check(db);
  } catch (error) {
    console.error(`[webinarios] conexao de IA do assistente nao lida: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/* ------------------------------------------------------------------------------------------------
 * A sala do aluno
 * ---------------------------------------------------------------------------------------------- */

/**
 * GET /api/webinars/[id]/assistant: ligado (ambiente, webinario e conexao de IA), o "Responder tudo" da sessao e
 * quantos da equipe estao atendendo agora. Sem a 202610300004 (ou com o ambiente desligado): tudo desligado.
 */
export async function loadStudentAssistantState(
  db: WebinarsDb,
  input: { aiAvailable?: (db: WebinarsDb) => Promise<boolean>; env?: Env; nowMs?: number; sessionId: string; webinarId: string }
): Promise<StudentAssistantState> {
  const nowMs = input.nowMs ?? Date.now();
  try {
    const [settings, replyAll, attendants] = await Promise.all([
      fetchAssistantSettings(db, input.webinarId),
      fetchSessionReplyAll(db, input.sessionId),
      listAttendants(db, input.sessionId)
    ]);
    const attendantsOnline = attendants.filter((attendant) => attendantIsOnline(attendant, nowMs)).length;
    const enabled = webinarAssistantEnabled(input.env) && settings?.enabled === true && (await aiAvailableSafely(db, input.aiAvailable ?? hasActiveAiConnection));
    return { attendantsOnline, enabled, replyAll: enabled && replyAll };
  } catch (error) {
    if (isPendingMigrationError(error)) {
      return ASSISTANT_OFF;
    }
    throw error;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Quem e da equipe, o produto, a presenca agora e o MATERIAL do Assistente
 * ---------------------------------------------------------------------------------------------- */

/** Da equipe: admin_roles, o Apresentador do webinario ou um co-apresentador. */
export async function isWebinarStaff(db: WebinarsDb, input: { userId: string; webinar: Pick<Webinar, "hostUserId" | "id"> }): Promise<boolean> {
  if (input.webinar.hostUserId === input.userId) {
    return true;
  }
  const { data, error } = await db.from("admin_roles").select("user_id").eq("user_id", input.userId).limit(1);
  assertNoDbError(error, "Webinarios: equipe do assistente");
  if (((data ?? []) as { user_id: string }[]).length > 0) {
    return true;
  }
  const presenters = await listPresenterRows(db, [input.webinar.id]);
  return presenters.some((row) => row.user_id === input.userId);
}

/** O nome do produto do webinario (content_items.title); falha ou sem produto: nulo. */
export async function fetchProductName(db: WebinarsDb, productId: string | null): Promise<string | null> {
  if (!productId) {
    return null;
  }
  const { data, error } = await db.from("content_items").select("id, title").eq("id", productId).limit(1);
  if (error) {
    return null;
  }
  const title = ((data ?? []) as { title: string | null }[])[0]?.title?.trim();
  return title || null;
}

/** O MATERIAL do Assistente para este pedido (assistant-model.buildAssistantContext). */
export async function loadAssistantContext(db: WebinarsDb, input: { trigger: Pick<AssistantTrigger, "offsetMs" | "recordingId">; webinar: Webinar }): Promise<string> {
  const [knowledge, transcript, productName] = await Promise.all([
    listKnowledge(db, input.webinar.id),
    input.trigger.recordingId ? fetchTranscriptRow(db, input.trigger.recordingId).catch(() => null) : Promise.resolve(null),
    fetchProductName(db, input.webinar.productId)
  ]);
  return buildAssistantContext({
    cues: transcript ? transcriptCuesOf(transcript.cues) : [],
    description: input.webinar.description,
    knowledge: knowledge.map((item) => ({ answer: item.answer, question: item.question })),
    offsetMs: input.trigger.offsetMs,
    productName,
    title: input.webinar.title
  });
}

/** O aluno ainda esta na sala (sinal de presenca nos ultimos 3 baldes); no replay, nao se sabe: falso. */
export async function studentPresentNow(db: WebinarsDb, input: { nowMs: number; session: WebinarSession; userId: string }): Promise<boolean> {
  if (input.session.kind === "replay") {
    return false;
  }
  const offset = presenceOffsetMs(input.session, input.nowMs);
  if (!Number.isFinite(offset)) {
    return false;
  }
  const bucket = presenceBucket(Math.floor(offset / 1000));
  const { data, error } = await db
    .from("webinar_presence_samples")
    .select("bucket")
    .eq("session_id", input.session.id)
    .eq("user_id", input.userId)
    .gte("bucket", bucket - ROOM_RULES.leaveAfterBuckets + 1)
    .lte("bucket", bucket)
    .limit(1);
  assertNoDbError(error, "Webinarios: presenca do aluno agora");
  return ((data ?? []) as unknown[]).length > 0;
}

/** O pedido que gravou esta resposta do Assistente (para a correcao chegar a pergunta da aba). */
export async function fetchAiRequestByReply(db: WebinarsDb, messageId: string): Promise<AssistantRequest | null> {
  const { data, error } = await db.from("webinar_ai_requests").select(AI_REQUEST_COLUMNS).eq("reply_message_id", messageId).limit(1);
  assertNoDbError(error, "Webinarios: pedido da resposta do assistente");
  const row = ((data ?? []) as AiRequestRow[])[0];
  return row ? aiRequestFromRow(row) : null;
}

/**
 * "Comecar cada sessao com Responder tudo": aplicado as sessoes do webinario que ainda nao comecaram (agendadas e na
 * espera); as que ja estao no ar seguem o console. Devolve quantas mudaram.
 */
export async function applyReplyAllDefault(db: WebinarsDb, input: { on: boolean; webinarId: string }): Promise<number> {
  const { data, error } = await db
    .from("webinar_sessions")
    .update({ assistant_reply_all: input.on })
    .eq("webinar_id", input.webinarId)
    .in("status", ["scheduled", "waiting"])
    .neq("kind", "replay")
    .select("id");
  assertNoDbError(error, "Webinarios: responder tudo das proximas sessoes");
  return ((data ?? []) as { id: string }[]).length;
}

/* ------------------------------------------------------------------------------------------------
 * O retrato do painel Atendimento
 * ---------------------------------------------------------------------------------------------- */

export type AttendanceAttendantView = { lastSeenAt: string; name: string; online: boolean; openCount: number; status: AttendantStatus; userId: string };

/** O que o painel Perguntas do console mostra a mais em cada pergunta (quem respondeu, com quem esta, pediu a equipe). */
export type AttendanceQuestionMark = { answerSource: AnswerSource | null; assignedName: string | null; assignedTo: string | null; handoffRequested: boolean };

export type AttendanceSnapshot = {
  assistant: { aiAvailable: boolean; envEnabled: boolean; replyAll: boolean; settingsEnabled: boolean };
  attendants: AttendanceAttendantView[];
  /** Quantas perguntas a leitura distribuiu agora. */
  distributed: number;
  me: { online: boolean; status: AttendantStatus | null };
  /** id -> nome curto de quem aparece com uma pergunta (atendentes e quem assumiu). */
  names: Record<string, string>;
  queue: AttendanceQueueItem[];
  questionMarks: Record<string, AttendanceQuestionMark>;
  serverTime: string;
  sessionId: string;
  sessionKind: SessionKind;
  /** A sessao ainda aceita atendimento (nao encerrada nem cancelada). */
  open: boolean;
  webinarId: string;
};

export type AttendanceSnapshotResult = { migration: string; pendingMigration: true } | ({ pendingMigration: false } & AttendanceSnapshot);

/** O `in` do PostgREST vai na URL: as marcas sao lidas em pedacos de MARKS_CHUNK ids. */
const MARKS_CHUNK = 150;

async function marksInChunks(db: WebinarsDb, input: { ids: readonly string[]; target: "chat" | "question" }): Promise<Map<string, AttendanceMarks>> {
  const ids = [...new Set(input.ids)];
  const marks = new Map<string, AttendanceMarks>();
  for (let index = 0; index < ids.length; index += MARKS_CHUNK) {
    for (const [id, mark] of await fetchAttendanceMarks(db, { ids: ids.slice(index, index + MARKS_CHUNK), target: input.target })) {
      marks.set(id, mark);
    }
  }
  return marks;
}

async function loadStaffNames(db: WebinarsDb, userIds: readonly string[]): Promise<Record<string, string>> {
  const wanted = [...new Set(userIds)];
  if (wanted.length === 0) {
    return {};
  }
  const { data, error } = await db.from("profiles").select("id, full_name").in("id", wanted);
  if (error) {
    return {};
  }
  const names: Record<string, string> = {};
  for (const row of (data ?? []) as { full_name: string | null; id: string }[]) {
    names[row.id] = row.full_name?.trim() ? firstNameInitial(row.full_name) : WEBINAR_COPY.sala.selos.equipe;
  }
  for (const id of wanted) {
    names[id] ??= WEBINAR_COPY.sala.selos.equipe;
  }
  return names;
}

/**
 * O retrato do Atendimento de uma sessao agora (a Server Action loadAttendanceSnapshot do console a cada 5 s): o
 * Assistente (ambiente, webinario, conexao de IA, "Responder tudo"), quem esta atendendo com as perguntas abertas de
 * cada um, a fila (assistant-model.attendanceQueueOf) e as marcas das perguntas para o painel Perguntas. Com
 * `distribute`, as perguntas novas sem dono vao para os atendentes online (a sessao ainda aberta; nada que o
 * Assistente esta respondendo agora).
 */
export async function loadAttendanceSnapshot(
  db: WebinarsDb,
  input: { aiAvailable?: (db: WebinarsDb) => Promise<boolean>; currentUserId: string; distribute?: boolean; env?: Env; now?: Date; sessionId: string }
): Promise<AttendanceSnapshotResult> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const sessionRow = await fetchSessionRow(db, input.sessionId);
  if (!sessionRow) {
    throw new WebinarError(COPY.erros.sessaoInexistente, 404);
  }
  const session = sessionFromRow(sessionRow);
  const webinarRow = await fetchWebinarRow(db, session.webinarId);
  if (!webinarRow) {
    throw new WebinarError(COPY.erros.sessaoInexistente, 404);
  }

  let settingsEnabled: boolean;
  let replyAll: boolean;
  let attendants: Awaited<ReturnType<typeof listAttendants>>;
  let aiRequests: AssistantRequest[];
  try {
    const [settings, sessionReplyAll, attendantRows, requests] = await Promise.all([
      fetchAssistantSettings(db, session.webinarId),
      fetchSessionReplyAll(db, session.id),
      listAttendants(db, session.id),
      listSessionAiRequests(db, session.id, 500)
    ]);
    settingsEnabled = settings?.enabled === true;
    replyAll = sessionReplyAll;
    attendants = attendantRows;
    aiRequests = requests;
  } catch (error) {
    if (isPendingMigrationError(error)) {
      return { migration: WEBINARS_ASSISTANT_MIGRATION, pendingMigration: true };
    }
    throw error;
  }

  const [questionRows, chatRows] = await Promise.all([
    listQuestionRows(db, { limit: 200, order: "recent", sessionId: session.id, statuses: ["open", "answered"] }),
    listSessionChatRows(db, { limit: 300, sessionId: session.id })
  ]);
  const questions = questionRows.map(questionFromRow);
  const messages = chatRows.map(chatMessageFromRow);
  const candidates = messages.filter((message) => message.source === "audience" && mightCallAssistant({ body: message.body, messageKind: message.kind === "question" ? "question" : "message", origin: "chat" }));
  const [questionMarks, messageMarks] = await Promise.all([
    marksInChunks(db, { ids: questions.map((question) => question.id), target: "question" }),
    marksInChunks(db, { ids: candidates.map((message) => message.id), target: "chat" })
  ]);

  const queue = attendanceQueueOf({
    aiRequests,
    marks: { messages: messageMarks, questions: questionMarks },
    messages: messages.map((message) => ({
      approved: message.approved,
      body: message.body,
      createdAt: message.createdAt,
      displayName: message.displayName,
      id: message.id,
      kind: message.kind,
      replyToId: message.replyToId,
      role: message.role,
      source: message.source
    })),
    questions: questions.map((question) => ({
      anonymous: question.anonymous,
      body: question.body,
      createdAt: question.createdAt,
      displayName: question.displayName,
      id: question.id,
      messageId: question.messageId,
      status: question.status
    }))
  });

  const open = session.status !== "ended" && session.status !== "cancelled";
  let distributed = 0;
  if (input.distribute && open) {
    const nowIso = now.toISOString();
    for (const assignment of distributeQueue({ attendants, items: queue.map((item) => ({ ...item, distributable: item.aiStatus !== "pending" })), nowMs })) {
      if (await assignAttendance(db, { id: assignment.id, nowIso, onlyIfUnassigned: true, target: assignment.target, userId: assignment.userId })) {
        distributed += 1;
        const item = queue.find((entry) => entry.id === assignment.id && entry.target === assignment.target);
        if (item) {
          item.assignedTo = assignment.userId;
        }
        if (assignment.target === "question") {
          const marks = questionMarks.get(assignment.id);
          questionMarks.set(assignment.id, { answerSource: marks?.answerSource ?? null, assignedAt: nowIso, assignedTo: assignment.userId, handoffRequestedAt: marks?.handoffRequestedAt ?? null });
        }
      }
    }
  }

  const assignedIds = [...queue.map((item) => item.assignedTo), ...[...questionMarks.values()].map((marks) => marks.assignedTo)].filter((id): id is string => Boolean(id));
  const names = await loadStaffNames(db, [...attendants.map((attendant) => attendant.userId), ...assignedIds]);
  const counts = openCountByAttendant(queue);
  const mine = attendants.find((attendant) => attendant.userId === input.currentUserId) ?? null;
  const envEnabled = webinarAssistantEnabled(input.env);
  const aiAvailable = envEnabled ? await aiAvailableSafely(db, input.aiAvailable ?? hasActiveAiConnection) : false;
  const marksView: Record<string, AttendanceQuestionMark> = {};
  for (const [id, marks] of questionMarks) {
    marksView[id] = {
      answerSource: marks.answerSource,
      assignedName: marks.assignedTo ? (names[marks.assignedTo] ?? null) : null,
      assignedTo: marks.assignedTo,
      handoffRequested: Boolean(marks.handoffRequestedAt)
    };
  }

  return {
    assistant: { aiAvailable, envEnabled, replyAll, settingsEnabled },
    attendants: attendants
      .map((attendant) => ({
        lastSeenAt: attendant.lastSeenAt,
        name: names[attendant.userId] ?? WEBINAR_COPY.sala.selos.equipe,
        online: attendantIsOnline(attendant, nowMs),
        openCount: counts.get(attendant.userId) ?? 0,
        status: attendant.status,
        userId: attendant.userId
      }))
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, "pt-BR")),
    distributed,
    me: { online: mine ? attendantIsOnline(mine, nowMs) : false, status: mine?.status ?? null },
    names,
    open,
    pendingMigration: false,
    queue,
    questionMarks: marksView,
    serverTime: now.toISOString(),
    sessionId: session.id,
    sessionKind: session.kind,
    webinarId: session.webinarId
  };
}

/** As perguntas abertas que ja estao com cada atendente nesta sessao (o modo hibrido escolhe o de menos). */
export async function listAssignedOpenQuestions(db: WebinarsDb, sessionId: string): Promise<{ assignedTo: string | null; createdAt: string; id: string }[]> {
  const { data, error } = await db
    .from("webinar_questions")
    .select("id, assigned_to, created_at")
    .eq("session_id", sessionId)
    .eq("status", "open")
    .is("deleted_at", null)
    .limit(500);
  assertNoDbError(error, "Webinarios: perguntas abertas por atendente");
  return ((data ?? []) as { assigned_to: string | null; created_at: string; id: string }[]).map((row) => ({ assignedTo: row.assigned_to, createdAt: row.created_at, id: row.id }));
}

/**
 * As marcas das perguntas que a aba Perguntas do aluno mostra (de quem e a resposta e o "Falar com a equipe" ja
 * pedido), so com o Assistente ligado no ambiente; sem a 202610300004, nenhuma.
 */
export async function studentQuestionMarks(db: WebinarsDb, input: { env?: Env; ids: readonly string[] }): Promise<Map<string, AttendanceMarks>> {
  if (!webinarAssistantEnabled(input.env) || input.ids.length === 0) {
    return new Map();
  }
  try {
    return await marksInChunks(db, { ids: input.ids, target: "question" });
  } catch (error) {
    if (isPendingMigrationError(error)) {
      return new Map();
    }
    throw error;
  }
}
