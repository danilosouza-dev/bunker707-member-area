// A sala do aluno, as regras puras que as rotas e as leituras repetem (docs/30 §1.6, §4.7, §5.1 e §6.6): quando
// o aluno pode escrever numa sessao (hora e modo do chat), o aparelho pelo User-Agent, o que o aluno recebe de
// uma enquete e de uma pergunta, os metadados minimos dos registros do historico (nunca o texto) e o cursor da
// consulta de mensagens novas. Sem "server-only", imports relativos: tests/webinarios-sala-*.test.mjs carregam
// direto pelo Node (nada de enum nem namespace, docs/18 §2.5).

import { ROOM_OPENS_MINUTES_BEFORE, sessionOffsetMs, simulatedPhase, type SessionClock } from "./room-model";
import type { ChatMode, Poll, PollAnswer, Reaction, WebinarQuestion, WebinarSession } from "./model";

export type RoomSessionLike = SessionClock & Pick<WebinarSession, "chatMode" | "chatSlowModeSeconds" | "lateJoinMinutes" | "status">;

export type PostingRefusal = "chat_off" | "ended" | "not_started" | "team_only";

/**
 * Se o aluno pode escrever (mensagem, pergunta, reacao, resposta de enquete) nesta sessao agora. A gravada aceita
 * da abertura da sala (15 min antes da hora) ate o fim do video; quem entrou antes da Entrada atrasada continua
 * escrevendo depois dela (a porta e so para entrar). O replay sempre aceita. A live (fase 3) so em espera ou no ar.
 */
export function postingRefusal(session: RoomSessionLike, durationMs: number, nowMs: number, kind: "chat" | "interaction" = "chat"): PostingRefusal | null {
  if (session.status === "cancelled") {
    return "ended";
  }
  if (session.kind === "simulated") {
    const offset = sessionOffsetMs(session, nowMs);
    if (!Number.isFinite(offset) || offset < -ROOM_OPENS_MINUTES_BEFORE * 60_000) {
      return "not_started";
    }
    if (simulatedPhase(session, durationMs, nowMs) === "ended") {
      return "ended";
    }
  } else if (session.kind === "live") {
    if (session.status === "ended") {
      return "ended";
    }
    if (session.status !== "waiting" && session.status !== "live") {
      return "not_started";
    }
  }
  if (kind === "chat") {
    if (session.chatMode === "off") {
      return "chat_off";
    }
    if (session.chatMode === "team_only") {
      return "team_only";
    }
  }
  return null;
}

/** O offset gravado numa escrita: o relogio do servidor na gravada e na live; a posicao do player (do corpo) no replay. */
export function writeOffsetMs(session: SessionClock, nowMs: number, bodyOffsetMs: number | null | undefined): number {
  const offset = sessionOffsetMs(session, nowMs);
  if (Number.isFinite(offset)) {
    return Math.round(offset);
  }
  return Number.isFinite(bodyOffsetMs ?? Number.NaN) ? Math.round(bodyOffsetMs as number) : 0;
}

/** "mobile" | "desktop" pelo User-Agent (so para o registro webinar_joined; nunca decide nada). */
export function deviceOf(userAgent: string | null | undefined): "desktop" | "mobile" {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent ?? "") ? "mobile" : "desktop";
}

export function isChatMode(value: unknown): value is ChatMode {
  return value === "open" || value === "moderated" || value === "team_only" || value === "off";
}

/* ------------------------------------------------------------------------------------------------
 * O que o aluno recebe das enquetes e das perguntas
 * ---------------------------------------------------------------------------------------------- */

export type StudentPoll = {
  anonymous: boolean;
  id: string;
  kind: Poll["kind"];
  /** As opcoes que o aluno marcou; nulo quando ainda nao respondeu. */
  myOptionIds: string[] | null;
  options: { id: string; label: string }[];
  question: string;
  /** As contagens por opcao, so depois que a equipe compartilhou o resultado. */
  results: { counts: Record<string, number>; total: number } | null;
  status: "closed" | "open";
};

/** Monta a enquete do aluno: as abertas e as encerradas com resultado compartilhado; os modelos (sem sessao) ficam de fora. */
export function toStudentPoll(poll: Poll, answers: readonly PollAnswer[], viewerUserId: string | null): StudentPoll | null {
  if (!poll.sessionId || poll.status === "draft") {
    return null;
  }
  if (poll.status === "closed" && !poll.resultsSharedAt) {
    return null;
  }
  const mine = viewerUserId ? (answers.find((answer) => answer.userId === viewerUserId) ?? null) : null;
  let results: StudentPoll["results"] = null;
  if (poll.resultsSharedAt) {
    const counts: Record<string, number> = {};
    for (const option of poll.options) {
      counts[option.id] = 0;
    }
    for (const answer of answers) {
      for (const optionId of answer.optionIds) {
        if (optionId in counts) {
          counts[optionId] += 1;
        }
      }
    }
    results = { counts, total: answers.length };
  }
  return {
    anonymous: poll.anonymous,
    id: poll.id,
    kind: poll.kind,
    myOptionIds: mine ? [...mine.optionIds] : null,
    options: poll.options.map((option) => ({ id: option.id, label: option.label })),
    question: poll.question,
    results,
    status: poll.status === "closed" ? "closed" : "open"
  };
}

/** A resposta cabe na enquete: opcoes dela, sem repetir; uma so na enquete de resposta unica. */
export function pollAnswerProblem(poll: Pick<Poll, "kind" | "options" | "status">, optionIds: readonly string[]): "closed" | "invalid_options" | "too_many" | null {
  if (poll.status !== "open") {
    return "closed";
  }
  const known = new Set(poll.options.map((option) => option.id));
  const unique = new Set(optionIds);
  if (unique.size !== optionIds.length || optionIds.some((id) => !known.has(id))) {
    return "invalid_options";
  }
  if (poll.kind === "single" && optionIds.length !== 1) {
    return "too_many";
  }
  return null;
}

export type StudentQuestion = {
  anonymous: boolean;
  answerText: string | null;
  answeredLive: boolean;
  body: string;
  createdAt: string;
  displayName: string;
  id: string;
  mine: boolean;
  status: WebinarQuestion["status"];
  upvotes: number;
  voted: boolean;
};

/** A pergunta para o aluno: a dispensada so o autor ve (docs/30 §1.3). */
export function toStudentQuestion(question: WebinarQuestion, viewerUserId: string | null, voted: boolean): StudentQuestion | null {
  const mine = Boolean(viewerUserId) && question.userId === viewerUserId;
  if (question.status === "dismissed" && !mine) {
    return null;
  }
  return {
    anonymous: question.anonymous,
    answerText: question.answerText,
    answeredLive: question.answeredLive,
    body: question.body,
    createdAt: question.createdAt,
    displayName: question.displayName,
    id: question.id,
    mine,
    status: question.status,
    upvotes: question.upvotes,
    voted
  };
}

/* ------------------------------------------------------------------------------------------------
 * Historico (docs/30 §4.7): so ids, codigos e numeros; nunca o texto
 * ---------------------------------------------------------------------------------------------- */

export function chatSentMetadata(input: { kind: string; length: number; messageId: string; offsetMs: number }) {
  return { kind: input.kind, length: input.length, message_id: input.messageId, offset_ms: input.offsetMs };
}

export function reactionSentMetadata(input: { offsetMs: number; reaction: Reaction }) {
  return { offset_ms: input.offsetMs, reaction: input.reaction };
}

export function questionSentMetadata(input: { anonymous: boolean; offsetMs: number; questionId: string }) {
  return { anonymous: input.anonymous, offset_ms: input.offsetMs, question_id: input.questionId };
}

export function pollAnsweredMetadata(input: { offsetMs: number; options: number; pollId: string }) {
  return { offset_ms: input.offsetMs, options: input.options, poll_id: input.pollId };
}

export function consentMetadata(input: { consentVersion: number; display: string }) {
  return { consent_version: input.consentVersion, display: input.display };
}

export function consentRevokedMetadata(consentVersion: number) {
  return { consent_version: consentVersion, revoked: true };
}

/* ------------------------------------------------------------------------------------------------
 * Reacoes e o cursor das mensagens novas
 * ---------------------------------------------------------------------------------------------- */

export function countReactions(rows: readonly { reaction: string }[], reactions: readonly Reaction[]): Record<Reaction, number> {
  const counts = Object.fromEntries(reactions.map((reaction) => [reaction, 0])) as Record<Reaction, number>;
  for (const row of rows) {
    if (row.reaction in counts) {
      counts[row.reaction as Reaction] += 1;
    }
  }
  return counts;
}

export type ChatCursor = { after: string | null; since: string };

type ChatMessageRowLike = { created_at: string; id: string };

/** O cursor da proxima consulta: a ultima linha (instante e id); sem linha nova, o cursor que veio (ou agora). */
export function nextChatCursor(rows: readonly ChatMessageRowLike[], previous: ChatCursor | null, nowIso: string): ChatCursor {
  const last = rows[rows.length - 1];
  if (last) {
    return { after: last.id, since: last.created_at };
  }
  return previous ?? { after: null, since: nowIso };
}
