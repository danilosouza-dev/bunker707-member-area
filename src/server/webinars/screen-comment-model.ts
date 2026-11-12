// O comentario ou a pergunta que a equipe traz para a tela (rodada v9, P11; docs/30 D89; docs/31 §5.1 e §14;
// 12/11/2026). O produtor: "Eu queria a funcionalidade de trazer um comentario ou pergunta para a tela. Isso e util para
// quando o apresentador quer responder e mostrar a pergunta na tela para todos verem ou mencionar algum comentario e
// mostrar na tela." Modulo puro (sem "server-only", imports relativos): o servidor, a sala, o console e os testes usam o
// mesmo arquivo.
//
// O que fica aqui:
// - de onde vem o que esta na tela (uma mensagem do chat ou uma pergunta) e por que saiu (a equipe tirou, outro
//   entrou, a origem foi removida);
// - o cartao que a sala recebe: o nome que o autor ja mostra no chat (o primeiro nome com a inicial; "Anônima" so na
//   pergunta gravada assim antes de 10/11/2026), a foto pela regra do chat (docs/30 D62 e D82), o papel e o texto.
//   Nada e copiado para a exibicao: a sala le a mensagem ou a pergunta da origem a cada leitura, entao o que o aluno
//   removeu ou a equipe apagou sai da tela, e a pergunta dispensada tambem;
// - o que pode ir para a tela: a mensagem liberada e nao apagada desta sessao (ou da linha mestre do webinario), nunca
//   o registro do item Pergunta do roteiro (a pergunta dele esta na aba Perguntas); a pergunta nao apagada, nao
//   dispensada e ja visivel;
// - onde o cartao fica no palco largo (embaixo, no meio; ao lado quando um banner, um QR Code ou a Oferta ocupa um
//   canto de baixo; em cima quando a fileira de baixo esta tomada).

import type { ChatMessage, ChatRole, WebinarQuestion } from "./model";
import type { ScreenPlace } from "./screen-model";

/** De onde vem o que esta na tela (webinar_screen_comments.source). */
export const SCREEN_COMMENT_SOURCES = ["chat", "question"] as const;
export type ScreenCommentSource = (typeof SCREEN_COMMENT_SOURCES)[number];

/** Por que saiu: a equipe tirou, outro comentario entrou no lugar, a origem foi removida. */
export const SCREEN_COMMENT_HIDDEN_REASONS = ["team", "replaced", "removed"] as const;
export type ScreenCommentHiddenReason = (typeof SCREEN_COMMENT_HIDDEN_REASONS)[number];

/** A migracao da tabela, para o aviso do console (a mesma de db.WEBINARS_V9_MIGRATION). */
export const SCREEN_COMMENT_MIGRATION = "202611150001";

/** Uma exibicao (webinar_screen_comments). */
export type ScreenCommentDisplay = {
  hiddenAt: string | null;
  hiddenReason: ScreenCommentHiddenReason | null;
  id: string;
  messageId: string | null;
  questionId: string | null;
  sessionId: string;
  shownAt: string;
  shownBy: string | null;
  shownOffsetMs: number | null;
  source: ScreenCommentSource;
};

/** O id da mensagem ou da pergunta que a exibicao mostra. */
export function screenCommentSourceId(display: Pick<ScreenCommentDisplay, "messageId" | "questionId" | "source">): string | null {
  return display.source === "chat" ? display.messageId : display.questionId;
}

/** O avatar do cartao: a pessoa (a foto ou as iniciais), o Assistente ou a mascara da pergunta Anonima antiga. */
export type ScreenCommentAvatar = "anonymous" | "assistant" | "person";

/** O cartao como a sala recebe (e o console, na Na tela agora). */
export type StudentScreenComment = {
  avatar: ScreenCommentAvatar;
  /** A foto de quem escreveu, quando ela pode aparecer (a regra do chat); nula, as iniciais. */
  avatarUrl: string | null;
  body: string;
  /** O id da exibicao. */
  displayId: string;
  /** O nome que o autor ja mostra no chat ou na aba Perguntas. */
  name: string;
  /** O papel de quem escreveu, so o da equipe e o do Assistente (o selo); nulo no aluno. */
  role: ChatRole | null;
  shownAt: string;
  source: ScreenCommentSource;
  /** O id da mensagem ou da pergunta (o console marca qual esta na tela). */
  sourceId: string;
};

/** O nome da pergunta gravada como anonima antes de 10/11/2026 (legado, D64): a sala e o console mostram assim. */
export const SCREEN_COMMENT_ANONYMOUS_NAME = "Anônima";

/** Os papeis que ganham o selo no cartao: a equipe e o Assistente. */
const BADGE_ROLES: readonly ChatRole[] = ["host", "co_host", "team", "ai"];

/**
 * A mensagem pode ir para a tela: liberada (a que espera a equipe nao), nunca o registro do item Pergunta do roteiro
 * nem a linha de sistema. A apagada nem chega aqui (quem le confere o deleted_at da linha).
 */
export function messageCanGoOnScreen(message: Pick<ChatMessage, "approved" | "kind" | "source">): boolean {
  return message.approved && !(message.source === "scripted" && message.kind === "question") && message.kind !== "system";
}

/** A mensagem e desta sessao ou da linha mestre deste webinario (a Live gravada toca o chat da live de origem). */
export function messageBelongsToSession(message: Pick<ChatMessage, "master" | "sessionId" | "webinarId">, session: { id: string; webinarId: string }): boolean {
  return message.sessionId === session.id || (message.master && message.webinarId === session.webinarId);
}

/** A pergunta pode ir para a tela: desta sessao, nao dispensada (a dispensada so o autor ve). A apagada nem e lida. */
export function questionCanGoOnScreen(question: Pick<WebinarQuestion, "sessionId" | "status">, sessionId: string): boolean {
  return question.sessionId === sessionId && question.status !== "dismissed";
}

/** O cartao de uma mensagem do chat; nulo quando ela nao pode (mais) ficar na tela. */
export function screenCommentOfMessage(display: Pick<ScreenCommentDisplay, "id" | "shownAt">, message: ChatMessage, avatarUrl: string | null): StudentScreenComment | null {
  if (!messageCanGoOnScreen(message)) {
    return null;
  }
  return {
    avatar: message.role === "ai" ? "assistant" : "person",
    avatarUrl: message.role === "ai" ? null : avatarUrl,
    body: message.body,
    displayId: display.id,
    name: message.displayName,
    role: BADGE_ROLES.includes(message.role) ? message.role : null,
    shownAt: display.shownAt,
    source: "chat",
    sourceId: message.id
  };
}

/** O cartao de uma pergunta; nulo quando ela nao pode (mais) ficar na tela. */
export function screenCommentOfQuestion(display: Pick<ScreenCommentDisplay, "id" | "shownAt">, question: WebinarQuestion, avatarUrl: string | null): StudentScreenComment | null {
  if (question.status === "dismissed") {
    return null;
  }
  return {
    avatar: question.anonymous ? "anonymous" : "person",
    avatarUrl: question.anonymous ? null : avatarUrl,
    body: question.body,
    displayId: display.id,
    name: question.anonymous ? SCREEN_COMMENT_ANONYMOUS_NAME : question.displayName,
    role: null,
    shownAt: display.shownAt,
    source: "question",
    sourceId: question.id
  };
}

/** Onde o cartao fica no palco largo. */
export type ScreenCommentPlace = "bottom_center" | "bottom_left" | "bottom_right" | "top_center";

/**
 * O lugar do cartao pelo que ja ocupa o palco: embaixo, no meio (o desenho do docs/31 §5.1); com um canto de baixo
 * ocupado (um banner, um QR Code, a Oferta da gravada a direita), o cartao vai para o outro lado; com a fileira de
 * baixo tomada (o meio, ou os dois cantos), ele sobe para cima, no meio, abaixo dos selos.
 */
export function screenCommentPlace(occupied: readonly ScreenPlace[], offerShown = false): ScreenCommentPlace {
  const left = occupied.includes("bottom_left");
  const right = occupied.includes("bottom_right") || offerShown;
  if (occupied.includes("bottom_center") || (left && right)) {
    return "top_center";
  }
  if (right) {
    return "bottom_left";
  }
  return left ? "bottom_right" : "bottom_center";
}
