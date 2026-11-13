// A sala do aluno, as regras puras que as rotas e as leituras repetem (docs/30 §1.6, §4.7, §5.1 e §6.6): quando
// o aluno pode escrever numa sessao (hora e modo do chat), o aparelho pelo User-Agent, o que o aluno recebe de
// uma enquete e de uma pergunta, os metadados minimos dos registros do historico (nunca o texto) e o cursor da
// consulta de mensagens novas. Sem "server-only", imports relativos: tests/webinarios-sala-*.test.mjs carregam
// direto pelo Node (nada de enum nem namespace, docs/18 §2.5).

import { studentAnswerAuthor, type StudentAnswerAuthor } from "./answer-author-model";
import { NO_LIKES, type QuestionLikesTally } from "./question-likes-model";
import { ROOM_OPENS_MINUTES_BEFORE, sessionOffsetMs, simulatedPhase, type SessionClock } from "./room-model";
import { QUESTION_REPLY_LIMITS, type ChatMode, type Poll, type PollAnswer, type QuestionReply, type QuestionReplyRole, type Reaction, type WebinarQuestion, type WebinarSession } from "./model";

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

/** As contagens por opcao de uma enquete (o resultado que a turma ve depois de Compartilhar resultado). */
export type StudentPollResults = { counts: Record<string, number>; total: number };

/** Conta as respostas por opcao (uma opcao que a enquete nao tem fica de fora); `total` e quantos responderam. */
export function pollResultCounts(poll: Pick<Poll, "options">, answers: readonly Pick<PollAnswer, "optionIds">[]): StudentPollResults {
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
  return { counts, total: answers.length };
}

/**
 * A enquete do aluno com a resposta dele e as contagens prontas: as abertas e as encerradas com resultado
 * compartilhado; os modelos (sem sessao) ficam de fora. As contagens so saem depois do Compartilhar resultado (antes,
 * nulas mesmo que venham). Quem lista (room-queries.listStudentPolls) le so a resposta do aluno e as contagens guardadas,
 * nunca as respostas dos outros numa enquete aberta.
 */
export function studentPollOf(poll: Poll, mine: Pick<PollAnswer, "optionIds"> | null, results: StudentPollResults | null): StudentPoll | null {
  if (!poll.sessionId || poll.status === "draft") {
    return null;
  }
  if (poll.status === "closed" && !poll.resultsSharedAt) {
    return null;
  }
  return {
    id: poll.id,
    kind: poll.kind,
    myOptionIds: mine ? [...mine.optionIds] : null,
    options: poll.options.map((option) => ({ id: option.id, label: option.label })),
    question: poll.question,
    results: poll.resultsSharedAt ? results : null,
    status: poll.status === "closed" ? "closed" : "open"
  };
}

/** Monta a enquete do aluno a partir das respostas (a do aluno e, com o resultado compartilhado, as contagens). */
export function toStudentPoll(poll: Poll, answers: readonly PollAnswer[], viewerUserId: string | null): StudentPoll | null {
  const mine = viewerUserId ? (answers.find((answer) => answer.userId === viewerUserId) ?? null) : null;
  return studentPollOf(poll, mine, poll.resultsSharedAt ? pollResultCounts(poll, answers) : null);
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

/** Uma resposta do fio de uma pergunta, como o aluno recebe. */
export type StudentQuestionReply = {
  /** Legado: linhas de antes de 10/11/2026 (D64). A resposta de quem perguntou numa pergunta Anonima antiga: sem nome e sem foto. */
  anonymous: boolean;
  /**
   * Como a resposta da equipe aparece (rodada v9, docs/30 D88): "team" (so o selo Equipe, sem nome e sem foto) ou
   * "custom" (o nome personalizado em `displayName`, sem foto). Ausente ou nula: o nome e a foto de quem escreveu, como
   * sempre (a resposta de antes, "Meu nome" e a do aluno).
   */
  authorAs?: "custom" | "team" | null;
  avatarUrl: string | null;
  body: string;
  createdAt: string;
  displayName: string;
  id: string;
  /** As curtidas desta resposta e se a minha esta entre elas (docs/30 D101); ausentes no banco sem a 202611170001. */
  liked?: boolean;
  likes?: number;
  mine: boolean;
  role: QuestionReplyRole;
};

export function toStudentReply(reply: QuestionReply, viewerUserId: string | null, avatarUrl: string | null = null): StudentQuestionReply {
  // "Responder como" (D88) so vale na resposta da equipe: com "Equipe" ou "Outro nome", o nome e a foto de quem
  // escreveu nunca vao para a turma (em "Outro nome", `displayName` ja e o nome personalizado gravado).
  const authorAs = reply.role !== "student" && (reply.authorAs === "team" || reply.authorAs === "custom") ? reply.authorAs : null;
  return {
    anonymous: reply.anonymous,
    // So quando a equipe escolheu: a resposta de sempre vai sem a chave.
    ...(authorAs ? { authorAs } : {}),
    avatarUrl: reply.anonymous || authorAs ? null : avatarUrl,
    body: reply.body,
    createdAt: reply.createdAt,
    displayName: authorAs === "team" ? "" : reply.displayName,
    id: reply.id,
    mine: authorAs ? false : Boolean(viewerUserId) && reply.userId === viewerUserId,
    role: reply.role
  };
}

export type QuestionReplyRefusal = "full" | "not_answered" | "not_owner";

/**
 * Quem escreve no fio de uma pergunta (decisao do produtor de 10/11/2026): a equipe e o aluno que perguntou, e so
 * depois de a pergunta estar respondida (ao vivo ou por escrito). O fio e a conversa dele com a equipe, a vista de
 * todos: os outros alunos leem e curtem a pergunta, e perguntam na aba. Antes da resposta nao ha o que comentar (a
 * primeira resposta escrita da equipe e o "Responder por escrito"); a dispensada volta pelo Reabrir. O fio tem um teto
 * (QUESTION_REPLY_LIMITS.perQuestion): e uma conversa curta, nao um segundo chat.
 */
export function questionReplyRefusal(input: { question: Pick<WebinarQuestion, "status" | "userId">; replies: number; staff: boolean; userId: string }): QuestionReplyRefusal | null {
  // A pergunta simulada (D77) nao tem aluno: so a equipe escreve no fio dela.
  if (!input.staff && (!input.question.userId || input.question.userId !== input.userId)) {
    return "not_owner";
  }
  if (input.question.status !== "answered") {
    return "not_answered";
  }
  return input.replies >= QUESTION_REPLY_LIMITS.perQuestion ? "full" : null;
}

export type StudentQuestion = {
  /** Legado: linhas de antes de 10/11/2026 (D64); uma pergunta nova chega sempre com falso. */
  anonymous: boolean;
  /** A foto do perfil de quem perguntou, quando ela pode aparecer (room-model.authorPhotoUrl); nunca na Anonima. */
  avatarUrl: string | null;
  /**
   * Quem assina a resposta escrita (rodada v9, docs/30 D88): com "Meu nome", o nome, o papel e a foto de quem respondeu;
   * com "Outro nome", so o nome. Nulo: "Equipe" (a escolha Equipe, a resposta de antes) ou o Assistente.
   */
  answerAuthor: StudentAnswerAuthor | null;
  /** As curtidas da resposta escrita e se a minha esta entre elas (docs/30 D101). */
  answerLiked?: boolean;
  answerLikes?: number;
  answerText: string | null;
  /** Quando a resposta saiu (a hora do fio "1 resposta" na sala, docs/31 V2-A66); null enquanto nao respondida. */
  answeredAt: string | null;
  answeredLive: boolean;
  body: string;
  /** O aluno pode responder no fio agora (e dele, esta respondida e o fio nao encheu); a hora da sessao a sala sabe. */
  canReply: boolean;
  createdAt: string;
  displayName: string;
  id: string;
  mine: boolean;
  /** O fio: as respostas depois da primeira resposta da equipe, da mais antiga para a mais nova. */
  replies: StudentQuestionReply[];
  status: WebinarQuestion["status"];
  upvotes: number;
  voted: boolean;
};

/**
 * A pergunta ja apareceu na sala (11/11/2026, D77): a da turma sempre; a simulada so a partir da hora dela (created_at),
 * como o chat. Na Live gravada o item Pergunta solto na abertura (webinar_open_session) nasce com a hora marcada mais o
 * minuto do item, e so entra na aba (e no console) quando essa hora chega; o "Enviar agora", o "Soltar agora" e o tick
 * da live gravam com a hora de agora.
 */
export function questionVisibleAt(question: Pick<WebinarQuestion, "createdAt" | "simulated">, nowMs: number): boolean {
  if (!question.simulated) {
    return true;
  }
  const at = Date.parse(question.createdAt);
  return !Number.isFinite(at) || at <= nowMs;
}

/**
 * A pergunta para o aluno: a dispensada so o autor ve (docs/30 §1.3). A simulada (D77) chega como a de um aluno, com o
 * nome e a foto da pessoa: nunca `mine`, e o aluno nunca responde no fio dela (questionReplyRefusal: nenhum aluno e o
 * dono); a dispensada some para todos.
 */
export function toStudentQuestion(
  question: WebinarQuestion,
  viewerUserId: string | null,
  voted: boolean,
  avatarUrl: string | null = null,
  replies: readonly StudentQuestionReply[] = [],
  /** A foto de quem assinou a resposta com "Meu nome" (a da equipe aparece sempre, D62). */
  answerAuthorAvatarUrl: string | null = null
): StudentQuestion | null {
  const mine = Boolean(viewerUserId) && question.userId === viewerUserId;
  if (question.status === "dismissed" && !mine) {
    return null;
  }
  return {
    anonymous: question.anonymous,
    avatarUrl: question.anonymous ? null : avatarUrl,
    answerAuthor: question.answerText ? studentAnswerAuthor(question.answerAuthor, answerAuthorAvatarUrl) : null,
    answerText: question.answerText,
    answeredAt: question.answeredAt,
    answeredLive: question.answeredLive,
    body: question.body,
    canReply: Boolean(viewerUserId) && questionReplyRefusal({ question, replies: replies.length, staff: false, userId: viewerUserId ?? "" }) === null,
    createdAt: question.createdAt,
    displayName: question.displayName,
    id: question.id,
    mine,
    replies: [...replies],
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

export function questionSentMetadata(input: { offsetMs: number; questionId: string }) {
  return { offset_ms: input.offsetMs, question_id: input.questionId };
}

export function questionReplySentMetadata(input: { length: number; questionId: string; replyId: string }) {
  return { length: input.length, question_id: input.questionId, reply_id: input.replyId };
}

export function pollAnsweredMetadata(input: { offsetMs: number; options: number; pollId: string }) {
  return { offset_ms: input.offsetMs, options: input.options, poll_id: input.pollId };
}

export function consentMetadata(input: { consentVersion: number }) {
  return { consent_version: input.consentVersion };
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

/** A pergunta do aluno com as curtidas da resposta escrita e de cada resposta do fio (docs/30 D101). */
export function withQuestionLikes(question: StudentQuestion, likes: QuestionLikesTally): StudentQuestion {
  const answer = question.answerText ? (likes.answers.get(question.id) ?? NO_LIKES) : NO_LIKES;
  return {
    ...question,
    answerLiked: answer.liked,
    answerLikes: answer.likes,
    replies: question.replies.map((reply) => {
      const tally = likes.replies.get(reply.id) ?? NO_LIKES;
      return { ...reply, liked: tally.liked, likes: tally.likes };
    })
  };
}
