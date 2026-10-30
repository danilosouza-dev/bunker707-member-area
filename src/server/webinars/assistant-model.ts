// O Assistente de IA no chat e o modo hibrido por regras puras (docs/30 §1.6, §2.4, §3.4, §6.6 e D24; fase 4c). Aqui:
// quando o Assistente e chamado ("@assistente" no chat, sem diferenciar maiusculas; a pergunta da aba Perguntas; ou o
// "Responder tudo" da sessao para toda pergunta da turma: a mensagem do chat do tipo pergunta ou que termina em "?"),
// quando ele cala (desligado no ambiente ou no webinario, autor da equipe, pergunta assumida por um atendente ou com
// "Falar com a equipe", ja respondida ou apagada, limite por aluno e por sessao no minuto, sem conexao de IA), o
// contexto que vai ao gateway (os dados do webinario e do produto, as perguntas e respostas cadastradas e as cues da
// transcricao em volta do offset, ate o teto de caracteres), o prompt em portugues (responde curto como Assistente,
// nunca finge ser aluno nem equipe, nunca inventa: sem a informacao, a frase naoSei), quem esta atendendo agora, a fila
// do painel Atendimento e a distribuicao das perguntas novas entre os atendentes online (rodizio pelo de menos
// perguntas abertas, sem tirar de quem assumiu). Modulo puro (sem "server-only", imports relativos): os testes, as
// rotas, as Server Actions e a sala do aluno leem daqui; quem grava e chama a IA e assistant.ts.

import { WEBINAR_COPY } from "../../lib/webinar-copy";
import {
  ASSISTANT_LIMITS,
  CHAT_LIMITS,
  toTime,
  type AnswerSource,
  type AssistantRequestStatus,
  type AssistantSkipReason,
  type AssistantTarget,
  type AttendanceMarks,
  type Attendant,
  type ChatRole,
  type ChatSource,
  type MessageKind,
  type QuestionStatus,
  type SessionKind
} from "./model";

/** O nome que a resposta do Assistente leva no chat (o mesmo texto do selo: nunca um nome de pessoa). */
export const ASSISTANT_DISPLAY_NAME: string = WEBINAR_COPY.sala.selos.assistente;

/** Quanto a sala do aluno espera a resposta antes de largar o "respondendo" (o teto da IA e mais a folga do chat). */
export const ASSISTANT_WAIT_MS = ASSISTANT_LIMITS.timeoutMs + 15_000;

/** A sala do aluno rele o estado do Assistente (ligado, Responder tudo, quem atende) a cada minuto. */
export const ASSISTANT_STATE_REFRESH_MS = 60_000;

/** O console bate o "Atendendo agora" a cada 30 s (o atendente sem batida ha 90 s sai da distribuicao). */
export const ATTENDANT_PING_MS = 30_000;

/** O painel Atendimento mostra no maximo isto de perguntas na fila. */
export const ATTENDANCE_QUEUE_MAX = 100;

/* ------------------------------------------------------------------------------------------------
 * Quando o Assistente e chamado
 * ---------------------------------------------------------------------------------------------- */

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// "@assistente" como palavra: nem "@assistentes" nem "x@assistente" (e-mail) chamam; pontuacao depois vale.
const MENTION_SOURCE = `(^|[^\\p{L}\\p{N}_@.])${escapeRegExp(ASSISTANT_LIMITS.mention.toLowerCase())}(?![\\p{L}\\p{N}_])`;
const MENTION_PATTERN = new RegExp(MENTION_SOURCE, "iu");

/** A mensagem chama o Assistente ("@assistente", sem diferenciar maiusculas). */
export function mentionsAssistant(body: string | null | undefined): boolean {
  return typeof body === "string" && MENTION_PATTERN.test(body);
}

/** O texto sem o "@assistente" (o que vai como pergunta para a IA). */
export function withoutMention(body: string): string {
  return body
    .replace(new RegExp(MENTION_SOURCE, "giu"), "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/^[\s,:;-]+/, "")
    .trim();
}

/** Uma mensagem do chat que e pergunta para o "Responder tudo": tem "?" e alguma palavra. */
export function looksLikeQuestion(body: string | null | undefined): boolean {
  if (typeof body !== "string") {
    return false;
  }
  const text = withoutMention(body);
  return text.includes("?") && (text.match(/\p{L}/gu) ?? []).length >= 3;
}

/** De onde veio o pedido: a mensagem do chat ou a pergunta da aba Perguntas. */
export type AssistantOrigin = "chat" | "questions_tab";

/**
 * O que a rota entrega ao Assistente depois da resposta. `target`/`targetId` e o alvo do pedido (um por alvo: a
 * mensagem do chat ou a pergunta; a mensagem do tipo pergunta que abriu a pergunta da aba vira a pergunta), `messageId`
 * e a mensagem a que a resposta responde no chat (nula na pergunta feita pela aba) e `offsetMs` e o segundo gravado.
 */
export type AssistantTrigger = {
  body: string;
  messageId: string | null;
  messageKind: "message" | "question" | null;
  offsetMs: number;
  origin: AssistantOrigin;
  recordingId: string | null;
  sessionId: string;
  target: AssistantTarget;
  targetId: string;
  userId: string;
  webinarId: string;
};

export type AssistantCall = "mention" | "question_tab" | "reply_all";

/** Por que o Assistente foi chamado; nulo quando nao foi (o "Responder tudo" so vale para pergunta da turma). */
export function assistantCallOf(trigger: Pick<AssistantTrigger, "body" | "messageKind" | "origin">, replyAll: boolean): AssistantCall | null {
  if (mentionsAssistant(trigger.body)) {
    return "mention";
  }
  if (trigger.origin === "questions_tab") {
    return "question_tab";
  }
  if (replyAll && (trigger.messageKind === "question" || looksLikeQuestion(trigger.body))) {
    return "reply_all";
  }
  return null;
}

/** Sem banco: se esta mensagem ainda pode chamar o Assistente (a rota nem agenda o resto). */
export function mightCallAssistant(trigger: Pick<AssistantTrigger, "body" | "messageKind" | "origin">): boolean {
  return assistantCallOf(trigger, true) !== null;
}

type TriggerBase = { envEnabled: boolean; recordingId: string | null; sessionId: string; userId: string; webinarId: string };

/**
 * O pedido de uma mensagem do chat (POST /chat): nada sem o ambiente ligado, nada na mensagem que espera a equipe
 * (chat moderado: ela ainda nao aparece para a turma) e nada na mensagem que nunca chamaria o Assistente.
 */
export function chatAssistantTrigger(input: TriggerBase & { approved: boolean; body: string; kind: MessageKind; messageId: string; offsetMs: number; questionId: string | null }): AssistantTrigger | null {
  if (!input.envEnabled || !input.approved || (input.kind !== "message" && input.kind !== "question")) {
    return null;
  }
  const trigger: AssistantTrigger = {
    body: input.body,
    messageId: input.messageId,
    messageKind: input.kind,
    offsetMs: input.offsetMs,
    origin: "chat",
    recordingId: input.recordingId,
    sessionId: input.sessionId,
    target: input.questionId ? "question" : "chat",
    targetId: input.questionId ?? input.messageId,
    userId: input.userId,
    webinarId: input.webinarId
  };
  return mightCallAssistant(trigger) ? trigger : null;
}

/** O pedido de uma pergunta da aba Perguntas (POST /questions): sempre chama, com o ambiente ligado. */
export function questionAssistantTrigger(input: TriggerBase & { body: string; offsetMs: number; questionId: string }): AssistantTrigger | null {
  if (!input.envEnabled) {
    return null;
  }
  return {
    body: input.body,
    messageId: null,
    messageKind: null,
    offsetMs: input.offsetMs,
    origin: "questions_tab",
    recordingId: input.recordingId,
    sessionId: input.sessionId,
    target: "question",
    targetId: input.questionId,
    userId: input.userId,
    webinarId: input.webinarId
  };
}

/* ------------------------------------------------------------------------------------------------
 * Quando o Assistente cala
 * ---------------------------------------------------------------------------------------------- */

export type AssistantDecisionInput = {
  /** Ha conexao de IA ativa (o gateway). */
  aiAvailable: boolean;
  /** O autor e da equipe (admin_roles, o Apresentador ou um co-apresentador): nunca responde. */
  authorIsStaff: boolean;
  call: AssistantCall | null;
  /** WEBINAR_ASSISTANT_ENABLED=on. */
  envEnabled: boolean;
  marks: Pick<AttendanceMarks, "assignedTo" | "handoffRequestedAt"> | null;
  /** Pedidos ao Assistente no ultimo minuto, ja contando este (por sessao e por aluno). */
  recentBySession: number;
  recentByStudent: number;
  /** webinars.assistant_settings.enabled. */
  settingsEnabled: boolean;
  /** A pergunta segue aberta (ou a mensagem segue no chat): respondida, dispensada ou apagada conta como assumida. */
  targetOpen: boolean;
};

export type AssistantDecision = { answer: true } | { answer: false; reason: AssistantSkipReason };

const skip = (reason: AssistantSkipReason): AssistantDecision => ({ answer: false, reason });

/** O limite por aluno e por minuto e o teto da sessao (os pedidos do minuto ja contam este). */
export function assistantRateLimited(input: { recentBySession: number; recentByStudent: number }): boolean {
  return input.recentByStudent > ASSISTANT_LIMITS.perStudentPerMinute || input.recentBySession > ASSISTANT_LIMITS.perSessionPerMinute;
}

/** A pergunta esta com alguem da equipe ("Falar com a equipe" vence quem assumiu): o motivo, ou nulo. */
export function attendanceBlock(marks: Pick<AttendanceMarks, "assignedTo" | "handoffRequestedAt"> | null, targetOpen: boolean): AssistantSkipReason | null {
  if (marks?.handoffRequestedAt) {
    return "handoff";
  }
  if (marks?.assignedTo || !targetOpen) {
    return "claimed";
  }
  return null;
}

/**
 * Se o Assistente responde agora (docs/30 §6.6 e D24), na ordem: desligado (ambiente ou webinario), nao chamado (ou
 * autor da equipe), com a equipe ("Falar com a equipe" ou assumida), limite do minuto e sem conexao de IA.
 */
export function assistantDecision(input: AssistantDecisionInput): AssistantDecision {
  if (!input.envEnabled || !input.settingsEnabled) {
    return skip("disabled");
  }
  if (input.authorIsStaff || !input.call) {
    return skip("not_called");
  }
  const blocked = attendanceBlock(input.marks, input.targetOpen);
  if (blocked) {
    return skip(blocked);
  }
  if (assistantRateLimited(input)) {
    return skip("rate_limited");
  }
  if (!input.aiAvailable) {
    return skip("unconfigured");
  }
  return { answer: true };
}

/* ------------------------------------------------------------------------------------------------
 * O contexto e o prompt
 * ---------------------------------------------------------------------------------------------- */

export type ContextCue = { endSeconds: number | null; startSeconds: number; text: string };

export type AssistantContextInput = {
  cues: readonly ContextCue[];
  description: string | null;
  knowledge: readonly { answer: string; question: string }[];
  maxCharacters?: number;
  /** O segundo do video em que o aluno perguntou (nulo: sem trecho do video). */
  offsetMs: number | null;
  productName: string | null;
  title: string;
};

/** As cues da transcricao em volta do offset (contextBeforeSeconds antes, contextAfterSeconds depois), em ordem. */
export function cuesAround(cues: readonly ContextCue[], offsetMs: number | null): ContextCue[] {
  if (offsetMs === null || !Number.isFinite(offsetMs)) {
    return [];
  }
  const at = offsetMs / 1000;
  const from = at - ASSISTANT_LIMITS.contextBeforeSeconds;
  const to = at + ASSISTANT_LIMITS.contextAfterSeconds;
  return cues
    .filter((cue) => Number.isFinite(cue.startSeconds) && (cue.endSeconds ?? cue.startSeconds) >= from && cue.startSeconds <= to && cue.text.trim())
    .sort((a, b) => a.startSeconds - b.startSeconds);
}

function clockOf(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${String(minutes).padStart(2, "0")}:${rest}`;
}

function oneLine(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function cut(text: string, max: number) {
  if (max <= 0) {
    return "";
  }
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

const SECTION_WEBINAR = "SOBRE O WEBINARIO";
const SECTION_KNOWLEDGE = "PERGUNTAS E RESPOSTAS DA EQUIPE";
const SECTION_VIDEO = "O QUE O VIDEO DIZ PERTO DESTE MINUTO";

/**
 * O MATERIAL do Assistente, ate `maxCharacters` (ASSISTANT_LIMITS.contextMaxCharacters): primeiro os dados do
 * webinario e do produto (curtos), depois as perguntas e respostas cadastradas (inteiras, na ordem, enquanto cabem,
 * guardando ate 40 % do resto para o video quando ha trecho) e por fim as cues mais perto do segundo da pergunta, em
 * ordem de tempo. Nunca passa do teto.
 */
export function buildAssistantContext(input: AssistantContextInput): string {
  const max = Math.max(200, Math.floor(input.maxCharacters ?? ASSISTANT_LIMITS.contextMaxCharacters));
  const headerLines = [`Webinario: ${oneLine(input.title)}`];
  if (input.productName?.trim()) {
    headerLines.push(`Produto: ${oneLine(input.productName)}`);
  }
  if (input.description?.trim()) {
    headerLines.push(`Sobre: ${cut(oneLine(input.description), 600)}`);
  }
  const header = cut(`${SECTION_WEBINAR}\n${headerLines.join("\n")}`, Math.min(1200, Math.floor(max * 0.2)));
  let remaining = max - header.length;

  const around = cuesAround(input.cues, input.offsetMs);
  const at = input.offsetMs !== null && Number.isFinite(input.offsetMs) ? input.offsetMs / 1000 : 0;
  const cueLines = around.map((cue) => ({ line: `[${clockOf(cue.startSeconds)}] ${oneLine(cue.text)}`, start: cue.startSeconds }));
  const cueTotal = cueLines.reduce((total, cue) => total + cue.line.length + 1, 0);
  const videoReserve = cueLines.length > 0 ? Math.min(cueTotal + SECTION_VIDEO.length + 3, Math.floor(remaining * 0.4)) : 0;

  const knowledgeBudget = remaining - videoReserve - SECTION_KNOWLEDGE.length - 3;
  const knowledgeParts: string[] = [];
  let knowledgeUsed = 0;
  for (const item of input.knowledge) {
    const part = `P: ${oneLine(item.question)}\nR: ${oneLine(item.answer)}`;
    if (knowledgeUsed + part.length + 2 > knowledgeBudget) {
      break;
    }
    knowledgeParts.push(part);
    knowledgeUsed += part.length + 2;
  }
  const knowledge = knowledgeParts.length > 0 ? `${SECTION_KNOWLEDGE}\n${knowledgeParts.join("\n\n")}` : "";
  remaining -= knowledge ? knowledge.length + 2 : 0;

  const videoBudget = remaining - SECTION_VIDEO.length - 3;
  const chosen: typeof cueLines = [];
  let videoUsed = 0;
  for (const cue of [...cueLines].sort((a, b) => Math.abs(a.start - at) - Math.abs(b.start - at) || a.start - b.start)) {
    if (videoUsed + cue.line.length + 1 > videoBudget) {
      continue;
    }
    chosen.push(cue);
    videoUsed += cue.line.length + 1;
  }
  const video = chosen.length > 0 ? `${SECTION_VIDEO}\n${chosen.sort((a, b) => a.start - b.start).map((cue) => cue.line).join("\n")}` : "";

  const context = [header, knowledge, video].filter(Boolean).join("\n\n");
  return context.length <= max ? context : context.slice(0, max);
}

/** O prompt do Assistente (system), com o MATERIAL no fim. */
export function assistantSystemPrompt(context: string): string {
  return [
    "Voce e o Assistente deste webinario, dentro da area de membros de uma escola. Responda em portugues do Brasil, curto (no maximo 3 frases), com clareza e educacao.",
    "Voce e um assistente de IA: nunca diga nem finja ser aluno, apresentador ou alguem da equipe, e nunca fale em nome deles.",
    "Use so o MATERIAL abaixo: o que o video diz perto deste minuto, as perguntas e respostas cadastradas pela equipe e os dados do webinario. Nao use conhecimento externo.",
    "Nunca invente precos, datas, prazos, links, bonus ou promessas.",
    `Se a resposta nao estiver no MATERIAL, responda exatamente: "${WEBINAR_COPY.assistente.naoSei}"`,
    "Responda direto, sem repetir a pergunta, sem markdown, sem listas e sem links.",
    "",
    "MATERIAL:",
    context
  ].join("\n");
}

/** A pergunta que vai para a IA: sem o "@assistente", no tamanho de uma pergunta. */
export function assistantQuestionText(body: string): string {
  const text = withoutMention(body) || body.trim();
  return text.slice(0, CHAT_LIMITS.question);
}

/** O texto da resposta como entra no chat (e na pergunta): sem markdown de enfeite, no maximo o limite; vazio = nulo. */
export function assistantReplyBody(text: string | null | undefined): string | null {
  if (typeof text !== "string") {
    return null;
  }
  const clean = text
    .replace(/\r\n?/g, "\n")
    .replace(/\*\*|__|`/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) {
    return null;
  }
  const max = Math.min(CHAT_LIMITS.body, CHAT_LIMITS.answer);
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/* ------------------------------------------------------------------------------------------------
 * A resposta antes de entrar no chat: o filtro deterministico e o modo do chat
 * ---------------------------------------------------------------------------------------------- */

// Link, endereco ou e-mail no texto (o prompt pede "sem links", mas so o codigo garante: o aluno pode pedir ao
// modelo, por injecao, um "cupom em golpe.example").
const URL_PATTERN = /\bhttps?:\/\/|\bwww\.|\b[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.(?:com|net|org|br|io|app|me|link|ly|co|info|biz|xyz|site|online|store|shop|club|top|gg|tv|ai|dev|page|click)\b|\b[\p{L}\p{N}-]+\.\p{L}{2,}\//iu;
const EMAIL_PATTERN = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+\.[\p{L}\p{N}.-]+/u;
// Valores: R$ / US$ / $ / € / £ com numero, ou numero com % ou "reais"/"dolares".
const AMOUNT_PATTERN = /(?:R\$|US\$|U\$|\$|€|£)\s?(\d[\d.,]*)|(\d[\d.,]*)\s?(?:%|por\s?cento|reais|d(?:o|\u00f3)lares)/giu;

function numbersOf(text: string): Set<string> {
  return new Set((text.match(/\d[\d.,]*\d|\d/g) ?? []).map((value) => value.replace(/[.,]+$/, "")));
}

/** Por que a resposta nao pode entrar como foi escrita: um link, um e-mail ou um valor que nao esta no MATERIAL. */
export type AssistantReplyRisk = "amount" | "email" | "link";

/**
 * O filtro deterministico da resposta (docs/30 §6.6 e §8.6): link, endereco de site e e-mail nunca entram; valor (R$,
 * US$, %, "reais") so quando o mesmo numero esta no MATERIAL (a pergunta cadastrada pela equipe, o video, o produto).
 * Nao depende de o modelo obedecer ao prompt. Nulo = pode entrar.
 */
export function assistantReplyRisk(body: string, context: string): AssistantReplyRisk | null {
  if (URL_PATTERN.test(body)) {
    return "link";
  }
  if (EMAIL_PATTERN.test(body)) {
    return "email";
  }
  const allowed = numbersOf(context);
  for (const match of body.matchAll(AMOUNT_PATTERN)) {
    const value = (match[1] ?? match[2] ?? "").replace(/[.,]+$/, "");
    if (!value || !allowed.has(value)) {
      return "amount";
    }
  }
  return null;
}

/** A resposta que entra no chat: a do modelo quando passa no filtro; senao, a frase de nao sei (nunca o texto arriscado). */
export function safeAssistantReply(body: string, context: string): { body: string; risk: AssistantReplyRisk | null } {
  const risk = assistantReplyRisk(body, context);
  return risk ? { body: WEBINAR_COPY.assistente.naoSei, risk } : { body, risk: null };
}

/**
 * O modo do chat decide onde a resposta do Assistente entra (docs/30 §6.6): chat aberto, publicada; chat moderado,
 * na fila da equipe (approved falso; a pergunta da aba so fica respondida quando a equipe libera); chat fechado ou so
 * da equipe, nada (o Assistente nao fala onde a turma nao fala).
 */
export function assistantPublishMode(chatMode: string): "publish" | "moderate" | "silent" {
  if (chatMode === "off" || chatMode === "team_only") {
    return "silent";
  }
  return chatMode === "moderated" ? "moderate" : "publish";
}

/* ------------------------------------------------------------------------------------------------
 * O teto de custo (as politicas de Configuracoes › IA, as mesmas do Tutor)
 * ---------------------------------------------------------------------------------------------- */

export type QuotaCandidate = { dailyQuestionLimit?: number; monthlyQuestionLimit?: number; provider: string };

/**
 * Os limites da conexao de IA valem tambem para o Assistente (D24): o diario por aluno (o da primeira conexao, como o
 * Tutor) conta os pedidos que chamaram a IA nas ultimas 24 h somando todas as sessoes; o mensal por provedor tira da
 * lista a conexao cujo provedor ja gastou o mes (o que o Tutor e o Assistente responderam). Sem limite configurado,
 * nada barra. Devolve as conexoes que podem responder, ou o motivo.
 */
export function assistantQuotaDecision<T extends QuotaCandidate>(input: {
  candidates: readonly T[];
  dailyUsed: number;
  monthlyUsed: ReadonlyMap<string, number>;
}): { allowed: T[]; reason: null } | { allowed: []; reason: "daily" | "monthly" } {
  const daily = input.candidates[0]?.dailyQuestionLimit;
  if (typeof daily === "number" && Number.isFinite(daily) && input.dailyUsed >= daily) {
    return { allowed: [], reason: "daily" };
  }
  const allowed = input.candidates.filter((candidate) => {
    const limit = candidate.monthlyQuestionLimit;
    return !(typeof limit === "number" && Number.isFinite(limit)) || (input.monthlyUsed.get(candidate.provider) ?? 0) < limit;
  });
  return allowed.length > 0 || input.candidates.length === 0 ? { allowed, reason: null } : { allowed: [], reason: "monthly" };
}

/**
 * O segundo em que a resposta entra no chat: no replay, o da pergunta (o aluno ve pelo player); na gravada e na live,
 * o do relogio do servidor agora (nunca antes da pergunta), dentro dos limites do banco.
 */
export function assistantReplyOffsetMs(input: { kind: SessionKind; serverOffsetMs: number; targetOffsetMs: number }): number {
  const clamp = (value: number) => Math.max(CHAT_LIMITS.offsetMinMs, Math.min(CHAT_LIMITS.offsetMaxMs, Math.round(value)));
  if (input.kind === "replay" || !Number.isFinite(input.serverOffsetMs)) {
    return clamp(input.targetOffsetMs);
  }
  return clamp(Math.max(input.serverOffsetMs, input.targetOffsetMs));
}

/* ------------------------------------------------------------------------------------------------
 * Atendentes, a fila e a distribuicao
 * ---------------------------------------------------------------------------------------------- */

/** "Atendendo agora": status online e batida nos ultimos attendantOnlineSeconds (compara instantes). */
export function attendantIsOnline(attendant: Pick<Attendant, "lastSeenAt" | "status">, nowMs: number): boolean {
  const seen = toTime(attendant.lastSeenAt);
  return attendant.status === "online" && Number.isFinite(seen) && nowMs - seen <= ASSISTANT_LIMITS.attendantOnlineSeconds * 1000;
}

export type QueueRef = { assignedTo: string | null; createdAt: string; distributable?: boolean; id: string; target: AssistantTarget };

export type Assignment = { id: string; target: AssistantTarget; userId: string };

/**
 * A distribuicao automatica (docs/30 §2.4): cada pergunta nova sem dono vai para o atendente online com menos perguntas
 * abertas (empate: quem comecou a atender antes, a ordem da lista), da mais antiga para a mais nova; quem assumiu nunca
 * perde a pergunta. `distributable: false` deixa de fora (o Assistente ainda esta respondendo).
 */
export function distributeQueue(input: { attendants: readonly Attendant[]; items: readonly QueueRef[]; nowMs: number }): Assignment[] {
  const online = input.attendants.filter((attendant) => attendantIsOnline(attendant, input.nowMs));
  if (online.length === 0) {
    return [];
  }
  const load = new Map(online.map((attendant) => [attendant.userId, 0]));
  for (const item of input.items) {
    if (item.assignedTo && load.has(item.assignedTo)) {
      load.set(item.assignedTo, (load.get(item.assignedTo) ?? 0) + 1);
    }
  }
  const pending = input.items
    .filter((item) => !item.assignedTo && item.distributable !== false)
    .sort((a, b) => toTime(a.createdAt) - toTime(b.createdAt) || a.id.localeCompare(b.id));
  const assignments: Assignment[] = [];
  for (const item of pending) {
    let pick = online[0].userId;
    for (const attendant of online) {
      if ((load.get(attendant.userId) ?? 0) < (load.get(pick) ?? 0)) {
        pick = attendant.userId;
      }
    }
    assignments.push({ id: item.id, target: item.target, userId: pick });
    load.set(pick, (load.get(pick) ?? 0) + 1);
  }
  return assignments;
}

export type QueueQuestion = {
  anonymous: boolean;
  body: string;
  createdAt: string;
  displayName: string;
  id: string;
  messageId: string | null;
  status: QuestionStatus;
};

export type QueueMessage = {
  approved: boolean;
  body: string;
  createdAt: string;
  displayName: string;
  id: string;
  kind: MessageKind;
  replyToId: string | null;
  role: ChatRole;
  source: ChatSource;
};

export type AttendanceQueueItem = {
  /** A situacao do pedido ao Assistente neste alvo (nulo: ninguem pediu). */
  aiStatus: AssistantRequestStatus | null;
  anonymous: boolean;
  answerSource: AnswerSource | null;
  assignedTo: string | null;
  body: string;
  createdAt: string;
  displayName: string;
  handoffRequested: boolean;
  id: string;
  target: AssistantTarget;
};

type AiRequestRef = { status: AssistantRequestStatus; targetId: string; targetKind: AssistantTarget };

/**
 * A fila do painel Atendimento: as perguntas abertas da aba Perguntas, as respondidas pelo Assistente em que o aluno
 * pediu a equipe, e as mensagens do chat da turma que chamaram o Assistente sem resposta dele, que pediram a equipe ou
 * que sao pergunta sem a linha da aba. Sai da fila o que a equipe ja respondeu (uma resposta da equipe no chat ligada
 * a mensagem). Ordem: "Pediu a equipe" primeiro, depois a mais antiga.
 */
export function attendanceQueueOf(input: {
  aiRequests: readonly AiRequestRef[];
  marks: { messages: ReadonlyMap<string, AttendanceMarks>; questions: ReadonlyMap<string, AttendanceMarks> };
  messages: readonly QueueMessage[];
  questions: readonly QueueQuestion[];
}): AttendanceQueueItem[] {
  const ai = new Map(input.aiRequests.map((request) => [`${request.targetKind}:${request.targetId}`, request.status]));
  const linked = new Set(input.questions.map((question) => question.messageId).filter((id): id is string => Boolean(id)));
  const teamReplied = new Set(input.messages.filter((message) => (message.role === "team" || message.role === "host") && message.replyToId).map((message) => message.replyToId as string));
  const items: AttendanceQueueItem[] = [];

  for (const question of input.questions) {
    const marks = input.marks.questions.get(question.id) ?? null;
    const handoff = Boolean(marks?.handoffRequestedAt);
    const open = question.status === "open";
    const backToTeam = question.status === "answered" && marks?.answerSource === "ai" && handoff;
    if (!open && !backToTeam) {
      continue;
    }
    items.push({
      aiStatus: ai.get(`question:${question.id}`) ?? null,
      anonymous: question.anonymous,
      answerSource: marks?.answerSource ?? null,
      assignedTo: marks?.assignedTo ?? null,
      body: question.body,
      createdAt: question.createdAt,
      displayName: question.displayName,
      handoffRequested: handoff,
      id: question.id,
      target: "question"
    });
  }

  for (const message of input.messages) {
    if (message.source !== "audience" || !message.approved || (message.kind !== "message" && message.kind !== "question") || linked.has(message.id) || teamReplied.has(message.id)) {
      continue;
    }
    const marks = input.marks.messages.get(message.id) ?? null;
    const handoff = Boolean(marks?.handoffRequestedAt);
    const aiStatus = ai.get(`chat:${message.id}`) ?? null;
    const called = mentionsAssistant(message.body) && aiStatus !== "answered";
    if (!handoff && !called && message.kind !== "question") {
      continue;
    }
    items.push({
      aiStatus,
      anonymous: false,
      answerSource: aiStatus === "answered" ? "ai" : null,
      assignedTo: marks?.assignedTo ?? null,
      body: message.body,
      createdAt: message.createdAt,
      displayName: message.displayName,
      handoffRequested: handoff,
      id: message.id,
      target: "chat"
    });
  }

  return items
    .sort((a, b) => Number(b.handoffRequested) - Number(a.handoffRequested) || toTime(a.createdAt) - toTime(b.createdAt) || a.id.localeCompare(b.id))
    .slice(0, ATTENDANCE_QUEUE_MAX);
}

/** As perguntas abertas de cada atendente (o numero ao lado do nome no painel). */
export function openCountByAttendant(items: readonly Pick<AttendanceQueueItem, "assignedTo">[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (item.assignedTo) {
      counts.set(item.assignedTo, (counts.get(item.assignedTo) ?? 0) + 1);
    }
  }
  return counts;
}

/* ------------------------------------------------------------------------------------------------
 * O aviso do sino quando a equipe responde depois
 * ---------------------------------------------------------------------------------------------- */

/**
 * A resposta da equipe vira aviso no sino quando o aluno pediu a equipe ("Falar com a equipe"), quando a sessao ja nao
 * esta no ar (encerrada, cancelada, o Replay livre) ou quando o aluno ja saiu da sala (docs/30 §1.6, Atendentes).
 */
export function teamAnswerNeedsNotice(input: { handoffRequested: boolean; sessionRunning: boolean; studentPresent: boolean }): boolean {
  return input.handoffRequested || !input.sessionRunning || !input.studentPresent;
}

/* ------------------------------------------------------------------------------------------------
 * A sala do aluno
 * ---------------------------------------------------------------------------------------------- */

/** GET /api/webinars/[id]/assistant: o que a sala precisa para a dica e para "A equipe responde depois pelo sino". */
export type StudentAssistantState = { attendantsOnline: number; enabled: boolean; replyAll: boolean };

export const ASSISTANT_OFF: StudentAssistantState = { attendantsOnline: 0, enabled: false, replyAll: false };

type ChatLike = { id: string; mine: boolean; replyToId: string | null; role: ChatRole };

/** As respostas do Assistente a mensagens do proprio aluno (onde aparece "Falar com a equipe"): id da resposta -> id da mensagem. */
export function assistantRepliesToMe(messages: readonly ChatLike[]): Map<string, string> {
  const mine = new Set(messages.filter((message) => message.mine).map((message) => message.id));
  const replies = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "ai" && message.replyToId && mine.has(message.replyToId)) {
      replies.set(message.id, message.replyToId);
    }
  }
  return replies;
}

/** Quantas vezes o aluno chamou o Assistente no ultimo minuto (a sala avisa o limite antes de o servidor calar). */
export function mentionsInLastMinute(sentAtMs: readonly number[], nowMs: number): number {
  return sentAtMs.filter((at) => nowMs - at >= 0 && nowMs - at < 60_000).length;
}

/** A sala avisa o limite quando o aluno ja chamou o Assistente perStudentPerMinute vezes no minuto. */
export function studentAtAssistantLimit(sentAtMs: readonly number[], nowMs: number): boolean {
  return mentionsInLastMinute(sentAtMs, nowMs) >= ASSISTANT_LIMITS.perStudentPerMinute;
}
