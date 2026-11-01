// A Sala da Live gravada e do Replay no navegador, a parte pura (docs/30 §1.6, §6.6 e §9): a decisao da trava do
// player (esperar, recolocar no alvo, encerrar), a fase pelo relogio corrigido, a janela do chat e quando pedir a
// seguinte, a fusao das mensagens sem repetir, o estado de presenca que o sinal de 15 s manda, o compositor do
// chat (desligado, modo lento, aceite), a hora e o papel embaixo do balao do chat (docs/31 V2-9), as bolhas das reacoes
// e a sala perdida (404). Sem React e sem rede:
// tests/webinarios-sala-navegador.test.mjs carrega direto pelo Node. Os pedidos ficam em src/components/member/webinars/room/room-api.ts.

import type { EmbedBridge } from "./lesson-embed-bridge";
import { WEBINAR_COPY } from "./webinar-copy";
import { saoPauloTime } from "./webinar-time";
import { ROOM_RULES, type ChatMode, type ChatRole, type PresenceState, type Reaction, type SimulatedPhase, type StudentChatMessage } from "../server/webinars/model";
import { initialChatWindow, needsResync, nextChatWindow, playerTargetSeconds, seekChatWindow, visibleMessages, type ChatWindow } from "../server/webinars/room-model";

export { clockSkewMs, initialChatWindow, nextChatWindow, offsetLabel, playerTargetSeconds, seekChatWindow, visibleMessages } from "../server/webinars/room-model";

export type RoomMessage = StudentChatMessage;

/* ------------------------------------------------------------------------------------------------
 * O relogio e a trava do player (docs/30 §6.6)
 * ---------------------------------------------------------------------------------------------- */

export type LockDecision = { action: "ended" } | { action: "none" } | { action: "seek"; to: number } | { action: "wait" };

/**
 * O que fazer com o player travado agora: antes do zero, esperar; no fim do video (ou depois), encerrar; fora da
 * tolerancia de 2 s, recolocar no alvo; senao nada. Sem leitura do tempo (null), nada a recolocar.
 */
export function lockDecision(input: { currentSeconds: number | null; durationSeconds: number; targetSeconds: number }): LockDecision {
  if (!Number.isFinite(input.targetSeconds) || input.targetSeconds < 0) {
    return { action: "wait" };
  }
  if (input.durationSeconds > 0 && input.targetSeconds >= input.durationSeconds) {
    return { action: "ended" };
  }
  if (input.currentSeconds !== null && needsResync(input.currentSeconds, input.targetSeconds)) {
    return { action: "seek", to: Math.max(0, input.targetSeconds) };
  }
  return { action: "none" };
}

/** Onde o player deveria estar agora, em ms, pelo relogio do aparelho corrigido pelo skew. */
export function targetOffsetMs(input: { deviceNowMs: number; skewMs: number; zeroMs: number }): number {
  return Math.round(playerTargetSeconds(input) * 1000);
}

/** A fase da sessao gravada no navegador: pela situacao do servidor quando ja encerrou; senao pelo relogio corrigido. */
export function roomPhaseAt(input: { deviceNowMs: number; durationMs: number; ended: boolean; skewMs: number; zeroMs: number }): SimulatedPhase {
  if (input.ended) {
    return "ended";
  }
  const offset = targetOffsetMs(input);
  if (offset < 0) {
    return "waiting";
  }
  return offset >= input.durationMs ? "ended" : "live";
}

/* ------------------------------------------------------------------------------------------------
 * O chat: janelas e fusao
 * ---------------------------------------------------------------------------------------------- */

/** Com que antecedencia (ms) a janela seguinte e pedida: antes de o player chegar ao fim da atual. */
export const WINDOW_LEAD_MS = (ROOM_RULES.chatWindowSeconds - ROOM_RULES.chatRefreshSeconds) * 1000;

/**
 * Qual janela pedir agora: a primeira ao entrar (ou depois de um salto no replay); a seguinte quando o player se
 * aproxima do fim da atual (30 s antes, = a cada 90 s numa janela de 120 s); nenhuma no meio.
 */
export function chatWindowToFetch(input: { current: ChatWindow | null; playerOffsetMs: number; seeked?: boolean }): ChatWindow | null {
  if (!input.current || input.seeked) {
    return input.seeked ? seekChatWindow(input.playerOffsetMs) : initialChatWindow(input.playerOffsetMs);
  }
  if (input.playerOffsetMs > input.current.toMs) {
    // O player passou da janela (aba congelada, salto): recomeca dali.
    return seekChatWindow(input.playerOffsetMs);
  }
  if (input.playerOffsetMs >= input.current.toMs - WINDOW_LEAD_MS) {
    return nextChatWindow(input.current);
  }
  return null;
}

/** Junta as mensagens que chegaram as que ja estao: a mesma id entra uma vez (a nova substitui, a pendente que foi aprovada atualiza), em ordem de offset. */
export function mergeMessages(existing: readonly RoomMessage[], incoming: readonly RoomMessage[]): RoomMessage[] {
  const byId = new Map<string, { index: number; message: RoomMessage }>();
  let index = 0;
  for (const message of existing) {
    byId.set(message.id, { index: index++, message });
  }
  for (const message of incoming) {
    const previous = byId.get(message.id);
    byId.set(message.id, { index: previous?.index ?? index++, message });
  }
  return [...byId.values()].sort((a, b) => a.message.offsetMs - b.message.offsetMs || a.index - b.index).map((entry) => entry.message);
}

/** As mensagens que ja apareceram (o player passou pelo segundo delas), com as do proprio aluno sempre na hora. */
export function revealedMessages(messages: readonly RoomMessage[], playerOffsetMs: number): RoomMessage[] {
  return visibleMessages(messages, playerOffsetMs).concat(messages.filter((message) => message.mine && message.offsetMs > playerOffsetMs));
}

/**
 * Quantas mensagens novas chegaram desde a ultima contagem (o leitor de tela anuncia "N mensagens novas" em rajada; o
 * contador do balao da sala com o painel fechado conta por ela, unreadCount em room-layout-model.ts, docs/31 V2-7).
 */
export function newMessageCount(previousIds: ReadonlySet<string>, revealed: readonly RoomMessage[]): number {
  return revealed.reduce((count, message) => (previousIds.has(message.id) ? count : count + 1), 0);
}

/* ------------------------------------------------------------------------------------------------
 * O item do chat no estilo do Zoom (docs/31 V2-9): a hora e o papel da linha "nome · papel · hora"
 * ---------------------------------------------------------------------------------------------- */

/** De que sala e o chat: a Live ao vivo, a gravada (simulada) ou o Replay (o mesmo RoomKind de room-layout-model.ts). */
export type ChatTimeKind = "live" | "replay" | "simulated";

/**
 * A hora da mensagem em Sao Paulo ("20:41"). Na live, a hora em que o servidor gravou a mensagem (`sentAt`): o offset
 * nao serve, porque a mensagem da espera conta da hora marcada, o "Comecar para todos" muda o zero sem recalcular, e
 * o que ja esta na tela guarda o offset de antes da ancora. Na gravada, a hora marcada mais o offset (o roteiro ja
 * nasce com created_at = scheduled_at + offset, e a linha mestre nao leva a data da live de origem). No Replay,
 * nenhuma: o payload nao traz o inicio da live original, e uma hora errada seria pior que nenhuma.
 */
export function chatTimeLabel(input: { kind: ChatTimeKind; offsetMs: number; sentAt?: string | null; zeroMs?: number | null }): string {
  if (input.kind === "live") {
    return saoPauloTime(input.sentAt);
  }
  if (input.kind !== "simulated" || typeof input.zeroMs !== "number") {
    return "";
  }
  const at = new Date(input.zeroMs + input.offsetMs);
  return Number.isNaN(at.getTime()) ? "" : saoPauloTime(at.toISOString());
}

/**
 * O papel na linha de baixo do balao: so Apresentador, Equipe e Assistente; o aluno e o convidado, nenhum. O
 * co-apresentador sai como Equipe ate o papel proprio no chat (a fase 2, com a migracao antes do merge).
 */
export function chatRoleLabel(role: ChatRole): string | null {
  const selos = WEBINAR_COPY.sala.selos;
  switch (role) {
    case "ai":
      return selos.assistente;
    case "host":
      return selos.apresentador;
    case "team":
      return selos.equipe;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Presenca e o compositor
 * ---------------------------------------------------------------------------------------------- */

/** O estado que o sinal de 15 s manda (docs/30 §1.8): aba escondida vence; tocando; carregando; pausado. */
export function presenceStateOf(input: { bridge: EmbedBridge; playing: boolean; visible: boolean }): PresenceState {
  if (!input.visible) {
    return "hidden";
  }
  if (input.playing) {
    return "playing";
  }
  return input.bridge === "pending" ? "buffering" : "paused";
}

export type ComposerState = { disabled: boolean; reason: "chat_off" | "consent" | "ended" | "not_started" | "slow_mode" | "team_only" | null; waitSeconds: number };

/** Se o aluno pode escrever agora e por que nao: fase, modo do chat da sessao, modo lento (a contagem) e o aceite. */
export function composerState(input: { chatMode: ChatMode; consented: boolean; nowMs: number; phase: SimulatedPhase | "replay"; slowUntilMs: number | null }): ComposerState {
  if (input.phase === "ended") {
    return { disabled: true, reason: "ended", waitSeconds: 0 };
  }
  if (input.chatMode === "off") {
    return { disabled: true, reason: "chat_off", waitSeconds: 0 };
  }
  if (input.chatMode === "team_only") {
    return { disabled: true, reason: "team_only", waitSeconds: 0 };
  }
  if (input.slowUntilMs !== null && input.slowUntilMs > input.nowMs) {
    return { disabled: true, reason: "slow_mode", waitSeconds: Math.ceil((input.slowUntilMs - input.nowMs) / 1000) };
  }
  if (!input.consented) {
    return { disabled: false, reason: "consent", waitSeconds: 0 };
  }
  return { disabled: false, reason: null, waitSeconds: 0 };
}

/** O cursor da consulta de 5 s depois de uma resposta; o primeiro cursor e a hora do servidor ao entrar. */
export type ChatCursor = { after: string | null; since: string };

export function initialChatCursor(serverTimeIso: string): ChatCursor {
  return { after: null, since: serverTimeIso };
}

/* ------------------------------------------------------------------------------------------------
 * Reacoes flutuantes (docs/30 §1.3 e §9)
 * ---------------------------------------------------------------------------------------------- */

export type ReactionBubble = { id: number; reaction: Reaction; until: number };

/** Quanto tempo a reacao sobe pela tela (3 s); com prefers-reduced-motion fica parada 1,5 s. */
export const REACTION_BUBBLE_MS = 3_000;
export const REACTION_STILL_MS = 1_500;
/** Bolhas no ar ao mesmo tempo, por desenho (as contagens altas viram um contador). */
export const REACTION_BUBBLE_MAX = 12;

/**
 * As bolhas que ficam no ar depois de uma leitura das contagens dos ultimos segundos: tira as vencidas, poe no
 * maximo `cap` novas (uma por reacao contada, as mais frequentes primeiro) e devolve o que sobrou de contagem.
 */
export function nextReactionBubbles(
  previous: readonly ReactionBubble[],
  counts: Partial<Record<Reaction, number>>,
  nowMs: number,
  options: { cap?: number; nextId: number; reducedMotion?: boolean } = { nextId: 1 }
): { bubbles: ReactionBubble[]; nextId: number; overflow: number } {
  const alive = previous.filter((bubble) => bubble.until > nowMs);
  const room = Math.max(0, (options.cap ?? REACTION_BUBBLE_MAX) - alive.length);
  const life = options.reducedMotion ? REACTION_STILL_MS : REACTION_BUBBLE_MS;
  const entries = (Object.entries(counts) as [Reaction, number][]).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  const bubbles = [...alive];
  let nextId = options.nextId;
  let placed = 0;
  // Uma bolha por reacao de cada vez, em rodadas, ate caber.
  const remaining = new Map(entries);
  while (placed < room && remaining.size > 0) {
    for (const [reaction, count] of [...remaining]) {
      if (placed >= room) {
        break;
      }
      bubbles.push({ id: nextId++, reaction, until: nowMs + life });
      placed += 1;
      if (count <= 1) {
        remaining.delete(reaction);
      } else {
        remaining.set(reaction, count - 1);
      }
    }
  }
  return { bubbles, nextId, overflow: Math.max(0, total - placed) };
}

/* ------------------------------------------------------------------------------------------------
 * Enderecos
 * ---------------------------------------------------------------------------------------------- */

export type RoomApiPart = "chat" | "heartbeat" | "polls" | "questions" | "reactions" | "session";

export function roomApiPath(webinarId: string, part: RoomApiPart, query?: Record<string, string | number | null | undefined>): string {
  const url = `/api/webinars/${encodeURIComponent(webinarId)}/${part}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined && value !== "") {
      params.set(key, String(value));
    }
  }
  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

export function questionVotePath(webinarId: string, questionId: string): string {
  return `/api/webinars/${encodeURIComponent(webinarId)}/questions/${encodeURIComponent(questionId)}/vote`;
}

/**
 * A pessoa perdeu a sala (docs/30 §1.1 e D41): as rotas da sala respondem 404 fora do "Quem pode" (saiu do segmento sem
 * o produto, foi reembolsada), com o webinario despublicado ou a sessao que sumiu. So nas rotas sem item proprio (a
 * releitura da sessao, o sinal de presenca, o token e os sinais da sala ao vivo; a pergunta ou a enquete que sumiu
 * tambem da 404 e nao conta) isso e definitivo: a sala desmonta o video e mostra "Esta live não está disponível para
 * você.". Rede, 5xx e as outras recusas: nao.
 */
export function roomAccessLost(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 404;
}

/** O identificador da aula para o sinal de midia (o pop-up nunca abre com o player da sala tocando). */
export function roomMediaLessonId(sessionId: string): string {
  return `webinar:${sessionId}`;
}
