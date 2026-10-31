// A sala ao vivo do aluno no navegador, a parte pura (docs/30 §1.3, §1.4, §1.7, §5.1, §6.3, §8.5 e §9; fase 3): qual
// tela a sala mostra (em breve, removido, banido, encerrada, trancada, aguardando o apresentador ou aberta), a frase de
// cada recusa do join-token (409 not_started / ended / kicked / banned, 503 meet_unconfigured, 404 fora do acesso, o
// resto "Tentar de novo"), a fila dos sinais do iframe para POST .../room-events (lotes de ate 20 que cabem no corpo de 4 KB; o que
// toRoomEvent recusa nunca entra; 429 espera o Retry-After; a queda da rede devolve o lote), as tentativas de voltar
// depois de uma queda (2 s, 4 s, 8 s e depois "Não conseguimos voltar"), o relogio "Ao vivo · 00:42:10" pelo inicio
// de verdade e o skew do servidor, a hora do silencio no chat em Sao Paulo, o que os sinais do iframe mudam na nossa
// barra (mao, camera, microfone liberado, gravando, quem esta no palco, o navegador que recusou o microfone ou a camera),
// os sinais de mudo da troca de aparelho do painel Configurações (nem a equipe silenciando, nem linha no servidor) e os
// atalhos R / M / E. Sem "use client" e com imports relativos: tests/webinarios-sala-ao-vivo-navegador.test.mjs carrega
// direto pelo Node. Nada aqui le o relogio de verdade nem a rede: a hora e o resto chegam por parametro.

import type { DeviceKind } from "../../../../lib/jitsi-device-settings";
import { FILMSTRIP_COLUMN_MIN_FRAME, LOWER_HAND_SIGNAL, RECONNECT_ATTEMPTS, RECORDING_SIGNAL, tokenRefreshDelayMs, type LiveRoomRole, type RoomEventItem } from "../../../../lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../../../lib/webinar-copy";
import { roomAccessLost } from "../../../../lib/webinar-room-client";
import type { RoomView } from "../../../../lib/webinar-room-prefs";
import { saoPauloTime } from "../../../../lib/webinar-time";
import type { JoinTokenReply, LiveBanState, LiveRoomInfo } from "../../../../server/webinars/live-model";
import type { SessionStatus } from "../../../../server/webinars/model";
import type { RoomBarItem, RoomBarItems } from "./room-layout-model";

/* ------------------------------------------------------------------------------------------------
 * Frases da barra e do painel Configurações (WEBINAR_COPY.aoVivo; o nome do objeto ficou para os componentes e testes)
 * ---------------------------------------------------------------------------------------------- */

export const LIVE_ROOM_COPY = {
  /** O nome da nossa barra para o leitor de tela. */
  barra: WEBINAR_COPY.aoVivo.barra,
  /** O botao Configurações da barra (docs/30 §1.3 e §9): som, aparelhos, qualidade e os atalhos anunciados. */
  configuracoes: WEBINAR_COPY.aoVivo.configuracoes,
  atalhos: WEBINAR_COPY.aoVivo.atalhos,
  atalhoReagir: WEBINAR_COPY.aoVivo.atalhoReagir,
  atalhoMao: WEBINAR_COPY.aoVivo.atalhoMao,
  atalhoEnquete: WEBINAR_COPY.aoVivo.atalhoEnquete
} as const;

/* ------------------------------------------------------------------------------------------------
 * Numeros da sala
 * ---------------------------------------------------------------------------------------------- */

export const LIVE_ROOM_RULES = {
  /** POST .../room-events: ate 20 sinais por lote (o schema recusa mais). */
  eventBatchMax: 20,
  /** O corpo do lote cabe no limite das rotas da sala (ROOM_BODY_BYTES = 4000), com folga. */
  eventBatchBytes: 3_600,
  /** Um lote a cada 10 s (e o que sobrar no pagehide, pelo sendBeacon). */
  eventFlushMs: 10_000,
  /** A fila nunca passa disto: sem rede por muito tempo, os sinais mais velhos saem primeiro. */
  eventQueueMax: 200,
  /** Sem Retry-After num 429, espera isto antes do proximo lote. */
  eventRetryFallbackMs: 60_000,
  /** Enquanto a sala nao abriu ou esta trancada, a sessao e relida a cada 15 s (o botao aparece sozinho). */
  waitingRefreshMs: 15_000,
  /** Aberta: a cada 60 s, como a fase 2 (o relogio, a situacao, os banimentos e o selo Gravando). */
  liveRefreshMs: 60_000,
  /** A espera antes de cada tentativa de voltar: 2 s, 4 s, 8 s. */
  reconnectBaseMs: 2_000,
  /** Sem a entrada confirmada depois disto, a montagem conta como queda. */
  joinTimeoutMs: 30_000,
  /** As ultimas mensagens em pilulas sobre o palco com o painel do chat fechado (docs/31 V2-8, tambem no computador). */
  overlayMessages: 2,
  /**
   * A largura do iframe parou de mudar ha este tanto (abrir ou fechar o painel, girar, a janela arrastada): a sala refaz
   * a conta da coluna de miniaturas (docs/31 V2-A5).
   */
  frameSettleMs: 250,
  /** Os avisos passageiros da barra (camera fechada pela equipe, microfone silenciado) somem depois disto. */
  noticeMs: 6_000,
  /**
   * Ligar a camera sem resposta do iframe depois disto: a camera dos alunos esta desligada (a equipe fechou). Tambem o
   * prazo do microfone com a permissao do site dada (micAnswerDelayMs: a faixa abre em centenas de ms).
   */
  cameraAnswerMs: 5_000,
  /** O mesmo prazo com o pedido de permissao do navegador ainda aberto (o aluno le e responde); o do microfone tambem. */
  cameraPromptMs: 30_000,
  /**
   * O pedido do microfone (Falar, ou Microfone para ligar): a sala confere a faixa do iframe e a permissao do navegador
   * neste intervalo ate o prazo do pedido (micAnswerDelayMs: 5 s com a permissao dada, 30 s sem ela).
   */
  micCheckMs: 500,
  /**
   * Depois do prazo sem a faixa abrir (o pedido do navegador fechado no X, ainda aberto, ou o aparelho que nao abriu):
   * a barra fica com o microfone desligado e a sala continua conferindo neste intervalo, sem fim por prazo, enquanto o
   * pedido durar (o mesmo iframe, sem o mudo, sem outro toque): o getUserMedia aberto pelo toggleAudio nao tem prazo, e o
   * aluno que libera depois abre a faixa sem sinal nenhum (o "ligado" vai entao para a barra e o servidor).
   */
  micLateCheckMs: 2_000,
  /**
   * A troca de camera do painel Configurações espera os sinais de mudo dela por este prazo, contado de novo quando o
   * set*Device responde e a cada sinal da troca (uma webcam USB leva alguns segundos para abrir).
   */
  deviceSwitchMs: 10_000,
  /** O getRoomsInfo (quem ja moderava antes de o aluno entrar) no maximo uma vez neste intervalo. */
  roomsInfoMs: 5_000,
  /** Um token que falhou ao renovar tenta de novo depois disto. */
  tokenRetryMs: 60_000,
  /** O nome de quem esta no palco, cortado aqui (vem do iframe). */
  nameMax: 60
} as const;

/* ------------------------------------------------------------------------------------------------
 * Enderecos das rotas da fase 3
 * ---------------------------------------------------------------------------------------------- */

export function liveApiPath(webinarId: string, part: "join-token" | "room-events"): string {
  return `/api/webinars/${encodeURIComponent(webinarId)}/${part}`;
}

/* ------------------------------------------------------------------------------------------------
 * Qual tela a sala mostra
 * ---------------------------------------------------------------------------------------------- */

/**
 * unavailable: a pessoa perdeu o acesso (404 da sessao, do sinal de presenca, do token ou dos sinais; D41) e, como
 * banned / kicked, a sala inteira da lugar a frase (sem iframe nem chat); ended: palco encerrado (o chat fica so para
 * ler); unconfigured: "em breve" no palco (o chat funciona); locked: quem ainda nao entrou ve a frase da sala trancada
 * e a pagina reconsulta a sessao; waiting: a sala ainda nao abriu para o aluno (Aguardando o apresentador); open: o
 * botao Entrar na sala (ou o iframe, depois dele).
 */
export type LiveScreen = "banned" | "ended" | "kicked" | "locked" | "open" | "unavailable" | "unconfigured" | "waiting";

export const NO_LIVE_BAN: LiveBanState = { banned: false, kicked: false, muted: false, mutedUntil: null };

export function liveRoomScreen(input: {
  ban: Pick<LiveBanState, "banned" | "kicked">;
  /** Ja dentro do iframe (a tranca so barra quem chega depois). */
  inRoom: boolean;
  live: Pick<LiveRoomInfo, "locked" | "meetConfigured" | "status"> & { practice?: boolean };
  /** Host, co-apresentador ou Equipe: entram tambem na Sessao de pratica (agendada) e com a sala trancada. */
  staff: boolean;
  /** O join-token respondeu 503 meet_unconfigured (o ambiente ficou sem a sala depois de a pagina abrir). */
  unconfigured?: boolean;
  /** Uma rota da sala respondeu 404: a pessoa saiu do "Quem pode" no meio da live (roomAccessLost). */
  unavailable?: boolean;
}): LiveScreen {
  const { ban, live } = input;
  // Fora do acesso o servidor nem chega aos banimentos (o 404 vem antes do 409).
  if (input.unavailable) {
    return "unavailable";
  }
  if (ban.banned) {
    return "banned";
  }
  if (ban.kicked) {
    return "kicked";
  }
  if (live.status === "ended" || live.status === "cancelled") {
    return "ended";
  }
  if (!live.meetConfigured || input.unconfigured) {
    return "unconfigured";
  }
  if (input.staff) {
    return "open";
  }
  if (live.status !== "waiting" && live.status !== "live") {
    return "waiting";
  }
  // Sessao de pratica: a sala aberta e so da equipe ate Comecar para todos (o join-token do aluno responde not_started).
  if (live.status === "waiting" && live.practice) {
    return "waiting";
  }
  return live.locked && !input.inRoom ? "locked" : "open";
}

/**
 * O que fazer quando a montagem do iframe nao confirmou a entrada no prazo: com a sala de espera ligada (o aluno esta
 * na fila do iframe, que bate sozinho; ou voltando de uma queda com a sala trancada), esperar mais (`wait`: a espera
 * pela equipe nunca e falha nem tentativa gasta); senao, a queda (`drop`). A montagem ja confirmada, outra montagem ou
 * a saida do proprio aluno: nada (`ignore`).
 */
export function joinTimeoutOutcome(input: { joined: boolean; leaving: boolean; lobby: boolean; sameMount: boolean }): "drop" | "ignore" | "wait" {
  if (!input.sameMount || input.joined || input.leaving) {
    return "ignore";
  }
  return input.lobby ? "wait" : "drop";
}

/** A sala inteira da lugar a frase (removido, banido ou fora do acesso): sem iframe, sem chat. */
export function screenBlocksRoom(screen: LiveScreen): boolean {
  return screen === "banned" || screen === "kicked" || screen === "unavailable";
}

/** A frase de cada tela (o titulo e, quando ha, a linha de baixo); `open` nao tem frase. */
export function liveScreenPhrase(screen: LiveScreen, input: { hasReplay: boolean }): { text: string | null; title: string } | null {
  switch (screen) {
    case "banned":
      return { text: null, title: WEBINAR_COPY.aoVivo.banido };
    case "kicked":
      return { text: null, title: WEBINAR_COPY.aoVivo.removido };
    case "unavailable":
      return { text: null, title: WEBINAR_COPY.aluno.naoDisponivel };
    case "ended":
      return { text: null, title: input.hasReplay ? WEBINAR_COPY.sala.encerrada : WEBINAR_COPY.sala.encerradaReplay };
    case "unconfigured":
      return { text: null, title: WEBINAR_COPY.aoVivo.emBreve };
    case "locked":
      return { text: null, title: WEBINAR_COPY.aoVivo.salaFechada };
    case "waiting":
      return { text: WEBINAR_COPY.aluno.aguardandoTexto, title: WEBINAR_COPY.aluno.aguardando };
    default:
      return null;
  }
}

/** A situacao da live para o cabecalho e o compositor: no ar, na espera ou encerrada. */
export function livePhaseOf(status: SessionStatus): "ended" | "live" | "waiting" {
  if (status === "ended" || status === "cancelled") {
    return "ended";
  }
  return status === "live" ? "live" : "waiting";
}

/** A sala aceita escrever, reagir e mandar presenca (as rotas aceitam em waiting/live). */
export function liveAcceptsWrites(status: SessionStatus): boolean {
  return status === "waiting" || status === "live";
}

/* ------------------------------------------------------------------------------------------------
 * O join-token: as recusas viram a frase do estado
 * ---------------------------------------------------------------------------------------------- */

export type LiveJoinFailure = "banned" | "ended" | "error" | "kicked" | "meet_unconfigured" | "not_started" | "unavailable";

/**
 * O motivo de uma falha de POST .../join-token (o erro do fetch traz status e reason). 404: a pessoa saiu do "Quem pode"
 * (ou a sessao sumiu): `unavailable`, definitivo, na entrada, na renovacao e na volta depois de uma queda. Rede e 5xx:
 * `error`.
 */
export function joinFailureOf(error: unknown): LiveJoinFailure {
  const status = typeof (error as { status?: unknown } | null)?.status === "number" ? (error as { status: number }).status : null;
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (roomAccessLost(error)) {
    return "unavailable";
  }
  if (status === 503 && reason === "meet_unconfigured") {
    return "meet_unconfigured";
  }
  if (status === 409 && (reason === "banned" || reason === "ended" || reason === "kicked" || reason === "not_started")) {
    return reason;
  }
  return "error";
}

/** A frase de cada falha (docs/30 §1.7: uma frase e um botao; nenhuma cita o motor de video). */
export function joinFailurePhrase(failure: LiveJoinFailure, input: { hasReplay: boolean } = { hasReplay: false }): string {
  switch (failure) {
    case "banned":
      return WEBINAR_COPY.aoVivo.banido;
    case "kicked":
      return WEBINAR_COPY.aoVivo.removido;
    case "ended":
      return input.hasReplay ? WEBINAR_COPY.sala.encerrada : WEBINAR_COPY.sala.encerradaReplay;
    case "meet_unconfigured":
      return WEBINAR_COPY.aoVivo.emBreve;
    case "not_started":
      return WEBINAR_COPY.aluno.aguardando;
    case "unavailable":
      return WEBINAR_COPY.aluno.naoDisponivel;
    default:
      return WEBINAR_COPY.aoVivo.erroAbrir;
  }
}

/** Depois de quanto tempo pedir outro token (ms): o contrato de jitsi-room-config (5 min antes do exp, piso de 10 s). */
export function tokenRefreshInMs(reply: Pick<JoinTokenReply, "expiresAt">, nowMs: number): number {
  return tokenRefreshDelayMs(reply.expiresAt, nowMs);
}

export type TokenRefreshOutcome = { action: "refuse"; failure: Exclude<LiveJoinFailure, "error"> } | { action: "retry"; delayMs: number };

/**
 * A renovacao do token (com a pessoa dentro da sala) falhou: rede, 5xx e 429 tentam de novo em `tokenRetryMs`; uma
 * recusa troca a sala na hora, e o 404 (`unavailable`: saiu do "Quem pode" no meio da live) desmonta o iframe e mostra
 * "Esta live não está disponível para você." (D41), em vez de seguir tentando com o video no ar.
 */
export function tokenRefreshOutcome(error: unknown): TokenRefreshOutcome {
  const failure = joinFailureOf(error);
  return failure === "error" ? { action: "retry", delayMs: LIVE_ROOM_RULES.tokenRetryMs } : { action: "refuse", failure };
}

/** Aluno e Equipe usam a nossa barra (camera e microfone com os avisos); host e co-apresentador, a barra do iframe. */
export function usesOurBar(role: LiveRoomRole | null): boolean {
  return role === null || role === "student" || role === "team";
}

/* ------------------------------------------------------------------------------------------------
 * As quedas: tentar de novo ate RECONNECT_ATTEMPTS
 * ---------------------------------------------------------------------------------------------- */

export type ReconnectStep = { action: "retry"; attempt: number; delayMs: number } | { action: "give_up" };

/** A proxima tentativa depois de `attemptsSoFar` tentativas sem voltar: 2 s, 4 s, 8 s; depois, desiste. */
export function reconnectStep(attemptsSoFar: number, max: number = RECONNECT_ATTEMPTS): ReconnectStep {
  if (!Number.isFinite(attemptsSoFar) || attemptsSoFar >= max) {
    return { action: "give_up" };
  }
  const attempt = Math.max(0, Math.floor(attemptsSoFar)) + 1;
  return { action: "retry", attempt, delayMs: LIVE_ROOM_RULES.reconnectBaseMs * 2 ** (attempt - 1) };
}

/**
 * O que a saida do iframe significa: o proprio aluno saiu (Sair): nada; nunca entrou nesta abertura: a abertura falhou
 * ("Não foi possível abrir a sala"); ja tinha entrado: queda (Reconectando… e as tentativas).
 */
export function dropKind(input: { everJoined: boolean; leaving: boolean }): "drop" | "ignore" | "open_failed" {
  if (input.leaving) {
    return "ignore";
  }
  return input.everJoined ? "drop" : "open_failed";
}

/* ------------------------------------------------------------------------------------------------
 * A fila dos sinais do iframe (POST .../room-events)
 * ---------------------------------------------------------------------------------------------- */

/** Poe o sinal na fila; o que toRoomEvent recusou (nulo) fica fora; acima do teto, os mais velhos saem. */
export function queueRoomEvent(queue: readonly RoomEventItem[], item: RoomEventItem | null, max: number = LIVE_ROOM_RULES.eventQueueMax): RoomEventItem[] {
  if (!item) {
    return [...queue];
  }
  const next = [...queue, item];
  return next.length > max ? next.slice(next.length - max) : next;
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/**
 * O proximo lote: ate 20 sinais e no maximo `eventBatchBytes` no corpo JSON { sessionId, events }; o resto fica para o
 * proximo. Um sinal que sozinho nao cabe e descartado. Fila vazia: `body` nulo.
 */
export function takeRoomEventBatch(
  queue: readonly RoomEventItem[],
  sessionId: string,
  limits: { maxBytes?: number; maxEvents?: number } = {}
): { batch: RoomEventItem[]; body: string | null; rest: RoomEventItem[] } {
  const maxEvents = limits.maxEvents ?? LIVE_ROOM_RULES.eventBatchMax;
  const maxBytes = limits.maxBytes ?? LIVE_ROOM_RULES.eventBatchBytes;
  const batch: RoomEventItem[] = [];
  let index = 0;
  let body: string | null = null;
  while (index < queue.length && batch.length < maxEvents) {
    const candidate = JSON.stringify({ events: [...batch, queue[index]], sessionId });
    if (byteLength(candidate) > maxBytes) {
      if (batch.length === 0) {
        // Sozinho nao cabe: sai da fila e segue.
        index += 1;
        continue;
      }
      break;
    }
    batch.push(queue[index]);
    body = candidate;
    index += 1;
  }
  return { batch, body, rest: queue.slice(index) };
}

export type RoomEventsOutcome = { blocked: "banned" | "ended" | "kicked" | "unavailable" | null; pauseUntilMs: number | null; requeue: boolean };

/**
 * O que fazer depois de mandar um lote: entregue (2xx), nada; 429: o lote volta para a fila e o proximo espera o
 * Retry-After; rede ou 5xx: volta para a fila; outro 4xx: descartado (nunca insiste num lote recusado). 409 banned:
 * a sala troca pela frase de removido (`kicked`, a mensagem do servidor e a do removido desta live) ou de banido de
 * todas (`banned`, so com a frase do banido; o mesmo criterio de writeRefusalOf); 409 ended: a sala encerra; 404: a
 * pessoa saiu do "Quem pode" (`unavailable`, D41).
 */
export function roomEventsOutcome(input: { message?: string | null; nowMs: number; reason?: string | null; retryAfterSeconds: number | null; status: number | null }): RoomEventsOutcome {
  const { status } = input;
  if (status !== null && status >= 200 && status < 300) {
    return { blocked: null, pauseUntilMs: null, requeue: false };
  }
  if (status === 429) {
    const waitMs = input.retryAfterSeconds && input.retryAfterSeconds > 0 ? input.retryAfterSeconds * 1000 : LIVE_ROOM_RULES.eventRetryFallbackMs;
    return { blocked: null, pauseUntilMs: input.nowMs + waitMs, requeue: true };
  }
  if (status === null || status >= 500) {
    return { blocked: null, pauseUntilMs: null, requeue: true };
  }
  if (roomAccessLost({ status })) {
    return { blocked: "unavailable", pauseUntilMs: null, requeue: false };
  }
  if (status === 409 && input.reason === "banned") {
    return { blocked: input.message === WEBINAR_COPY.aoVivo.banido ? "banned" : "kicked", pauseUntilMs: null, requeue: false };
  }
  const blocked = status === 409 && (input.reason === "ended" || input.reason === "kicked") ? input.reason : null;
  return { blocked, pauseUntilMs: null, requeue: false };
}

/** O lote devolvido volta para a frente da fila, sem passar do teto (os mais velhos saem). */
export function requeueBatch(queue: readonly RoomEventItem[], batch: readonly RoomEventItem[], max: number = LIVE_ROOM_RULES.eventQueueMax): RoomEventItem[] {
  const next = [...batch, ...queue];
  return next.length > max ? next.slice(next.length - max) : next;
}

/* ------------------------------------------------------------------------------------------------
 * O relogio "Ao vivo · 00:42:10" e o silencio no chat
 * ---------------------------------------------------------------------------------------------- */

/** "00:42:10": o tempo no ar desde o inicio de verdade pelo relogio do servidor (skew); antes do inicio, 00:00:00. */
export function liveElapsedLabel(startedAtIso: string | null | undefined, deviceNowMs: number, skewMs = 0): string {
  const started = startedAtIso ? Date.parse(startedAtIso) : Number.NaN;
  const elapsed = Number.isFinite(started) ? Math.max(0, deviceNowMs + skewMs - started) : 0;
  const total = Math.floor(elapsed / 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

/** "Ao vivo · 00:42:10" (docs/30 §1.3). */
export function liveOnAirLabel(startedAtIso: string | null | undefined, deviceNowMs: number, skewMs = 0): string {
  return WEBINAR_COPY.sala.tempoNoAr(liveElapsedLabel(startedAtIso, deviceNowMs, skewMs));
}

/**
 * A frase do silencio no chat (docs/30 §1.4): "ate 20:15" pela hora de Sao Paulo, ou "ate o fim desta live"; sem
 * silencio, ou com o prazo vencido (a leitura da sessao pode estar velha), nulo.
 */
export function mutedPhrase(ban: Pick<LiveBanState, "muted" | "mutedUntil">, nowMs: number): string | null {
  if (!ban.muted) {
    return null;
  }
  if (!ban.mutedUntil) {
    return WEBINAR_COPY.aoVivo.silenciadoAteOFim;
  }
  const until = Date.parse(ban.mutedUntil);
  if (!Number.isFinite(until)) {
    return WEBINAR_COPY.aoVivo.silenciadoAteOFim;
  }
  return until > nowMs ? WEBINAR_COPY.aoVivo.silenciadoAte(saoPauloTime(ban.mutedUntil)) : null;
}

/**
 * O que toma o lugar do campo do chat e das perguntas na live: o silencio (com a hora) ou, antes de a sala abrir, a
 * frase de que ainda nao abriu (as rotas so aceitam escrever na espera ou no ar). Nulo: o campo fica.
 */
export function liveComposerNotice(input: { ban: Pick<LiveBanState, "muted" | "mutedUntil">; nowMs: number; status: SessionStatus }): string | null {
  const muted = mutedPhrase(input.ban, input.nowMs);
  if (muted) {
    return muted;
  }
  return input.status === "scheduled" ? WEBINAR_COPY.sala.naoComecou : null;
}

/**
 * A recusa local (409 kicked / banned / muted) e so a ponte ate a proxima leitura da sessao: vale enquanto a leitura
 * que a sala tem e de antes da recusa (pela hora do servidor: a hora do aparelho na recusa + o skew). A leitura mais
 * nova manda: o silencio que venceu, o Desfazer da equipe (removido ou silenciado) voltam a liberar a sala sem
 * recarregar a pagina. Sem recusa (`refusedAtMs` nulo): nada local vale.
 */
export function localBanStillValid(input: { refusedAtMs: number | null; serverTimeIso: string | null | undefined; skewMs: number }): boolean {
  if (input.refusedAtMs === null || !Number.isFinite(input.refusedAtMs)) {
    return false;
  }
  const read = input.serverTimeIso ? Date.parse(input.serverTimeIso) : Number.NaN;
  if (!Number.isFinite(read)) {
    return true;
  }
  return read < input.refusedAtMs + (Number.isFinite(input.skewMs) ? input.skewMs : 0);
}

/**
 * O estado de banimento que vale agora: o da leitura da sessao mais o que uma recusa contou antes de a sessao ser
 * relida (409 kicked / banned do join-token, 409 banned / muted de uma escrita; so enquanto localBanStillValid). O
 * silencio local, sem a hora, vale "ate o fim" ate a leitura trazer a hora.
 */
export function mergeBan(fromSession: LiveBanState | null | undefined, local: { banned: boolean; kicked: boolean; muted: boolean }): LiveBanState {
  const base = fromSession ?? NO_LIVE_BAN;
  return {
    banned: base.banned || local.banned,
    kicked: base.kicked || local.kicked,
    muted: base.muted || local.muted,
    mutedUntil: base.muted ? base.mutedUntil : null
  };
}

/**
 * O que uma escrita recusada da sala diz (chat, pergunta, curtida, reacao, enquete): 409 banned vem para o removido
 * desta live e para o banido de todas, com a frase de cada um (room-writes.ts: banRefusalError), entao a frase decide;
 * 409 muted (silenciado no chat) e 409 ended. O resto (limites, rede): nulo, a tela de quem escreveu mostra a frase.
 */
export function writeRefusalOf(error: unknown): "banned" | "ended" | "kicked" | "muted" | null {
  const status = (error as { status?: unknown } | null)?.status;
  const reason = (error as { reason?: unknown } | null)?.reason;
  if (status !== 409) {
    return null;
  }
  if (reason === "banned") {
    return (error as { message?: unknown }).message === WEBINAR_COPY.aoVivo.banido ? "banned" : "kicked";
  }
  if (reason === "kicked") {
    return "kicked";
  }
  return reason === "muted" || reason === "ended" ? reason : null;
}

/* ------------------------------------------------------------------------------------------------
 * A camera e o microfone do aluno (docs/30 §1.3, §8.5 e D4)
 * ---------------------------------------------------------------------------------------------- */

/**
 * O clique em Câmera: sem a permissao do webinario (e com a camera desligada), `blocked` (a frase de camera
 * bloqueada); desligar e sempre direto; o PRIMEIRO ligar abre o aviso de gravacao e de consumo (`ask`); depois, direto.
 */
export function cameraClick(input: { allowStudentCamera: boolean; consented: boolean; videoOn: boolean }): "ask" | "blocked" | "toggle" {
  if (input.videoOn) {
    return "toggle";
  }
  if (!input.allowStudentCamera) {
    return "blocked";
  }
  return input.consented ? "toggle" : "ask";
}

function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}

/** O apresentador liberou o microfone DESTE participante (moderationParticipantApproved com mediaType audio). */
export function isOwnMicApproval(payload: unknown, ownId: string | null): boolean {
  const id = field(payload, "id");
  return ownId !== null && typeof id === "string" && id === ownId && field(payload, "mediaType") === "audio";
}

/**
 * O console pediu para este aluno abaixar a mao (endpointTextMessageReceived com o texto { type: LOWER_HAND_SIGNAL }),
 * com a mao do aluno levantada; a sala manda toggleRaiseHand. Vale de qualquer remetente: quem ja era moderador quando
 * o aluno entrou nunca gera participantRoleChanged (o participantJoined do IFrame API nao traz o papel), e o efeito e so
 * abaixar a propria mao, que o aluno levanta de novo. O payload vem como { senderInfo, eventData } ou dentro de { data }
 * conforme a versao do servidor de video.
 */
export function lowerHandRequested(state: Pick<LiveSignalState, "handRaised">, payload: unknown): boolean {
  if (!state.handRaised) {
    return false;
  }
  const body = field(payload, "data") ?? payload;
  const sender = field(field(body, "senderInfo"), "id");
  const text = field(field(body, "eventData"), "text");
  if (typeof sender !== "string" || typeof text !== "string" || text.length > 200) {
    return false;
  }
  try {
    return field(JSON.parse(text), "type") === LOWER_HAND_SIGNAL;
  } catch {
    return false;
  }
}

/**
 * O console do Apresentador avisou a gravacao no navegador (RECORDING_SIGNAL { on }): so de quem modera na sala (o
 * selo Gravando nao pode ser ligado por outro aluno). Devolve on/off, ou nulo quando nao e este sinal ou nao vale.
 */
export function recordingSignalOf(state: Pick<LiveSignalState, "participants">, payload: unknown): boolean | null {
  const body = field(payload, "data") ?? payload;
  const sender = field(field(body, "senderInfo"), "id");
  const text = field(field(body, "eventData"), "text");
  if (typeof sender !== "string" || !state.participants.moderators.includes(sender) || typeof text !== "string" || text.length > 200) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return field(parsed, "type") === RECORDING_SIGNAL && typeof field(parsed, "on") === "boolean" ? (field(parsed, "on") as boolean) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------
 * O que os sinais do iframe mudam na nossa barra
 * ---------------------------------------------------------------------------------------------- */

export type LiveNotice =
  | "camera_blocked"
  | "camera_closed"
  | "camera_denied"
  | "camera_failed"
  | "camera_unanswered"
  | "mic_denied"
  | "mic_failed"
  | "mic_released"
  | "mic_silenced"
  | "mic_unanswered";

export type LiveParticipants = { moderators: string[]; names: Record<string, string> };

export type LiveSignalState = {
  audioOn: boolean;
  /** O proximo audioMuteStatusChanged foi pedido por nos (Falar, Microfone ou a troca do microfone): nao e a equipe silenciando. */
  expectAudio: boolean;
  /** O proximo videoMuteStatusChanged foi pedido por nos (Câmera ou a troca da camera): nao e a equipe fechando. */
  expectVideo: boolean;
  /**
   * A coluna de miniaturas do iframe na tela (o ultimo filmstripDisplayChanged; visivel ao entrar). Fora do iframe, nao
   * ha coluna: o selo do Assistente e as pilulas do chat vao ate a borda.
   */
  filmstripVisible: boolean;
  handRaised: boolean;
  /** O apresentador liberou e o aluno aceitou: o botao Microfone aparece. */
  micAllowed: boolean;
  /** O dialogo "Falar / Agora não" esta aberto. */
  micPrompt: boolean;
  notice: LiveNotice | null;
  participants: LiveParticipants;
  /** O ultimo recordingStatusChanged (nulo: nenhum ainda; vale o `live.recording` da sessao). */
  recording: boolean | null;
  videoOn: boolean;
  /** O que o motor mostra (o ultimo tileViewChanged): a Grade ou o Palco. O botao da visao diz isto, nunca a escolha guardada. */
  viewShown: RoomView;
};

export const INITIAL_LIVE_SIGNALS: LiveSignalState = {
  audioOn: false,
  expectAudio: false,
  expectVideo: false,
  filmstripVisible: false,
  handRaised: false,
  micAllowed: false,
  micPrompt: false,
  notice: null,
  participants: { moderators: [], names: {} },
  recording: null,
  videoOn: false,
  viewShown: "stage"
};

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const text = value.replace(/\s+/g, " ").trim().slice(0, LIVE_ROOM_RULES.nameMax);
  return text.length > 0 ? text : null;
}

function withoutKey(record: Record<string, string>, key: string): Record<string, string> {
  const next = { ...record };
  delete next[key];
  return next;
}

/** O aviso de um micError / cameraError do iframe: a permissao negada pelo navegador, ou o aparelho que nao abriu. */
export function mediaErrorNotice(media: "camera" | "mic", payload: unknown): LiveNotice {
  const error = field(payload, "error") ?? payload;
  const code = `${field(error, "type") ?? ""} ${field(error, "name") ?? ""}`;
  const denied = /permission|denied|notallowed/i.test(code);
  if (media === "camera") {
    return denied ? "camera_denied" : "camera_failed";
  }
  return denied ? "mic_denied" : "mic_failed";
}

/**
 * O estado da nossa barra depois de um sinal do iframe. Entrar zera tudo (todo mundo entra mudo e com a camera
 * fechada); a mao e o papel so contam quando sao do proprio participante; a camera ou o microfone que fecham sem o
 * nosso pedido viram o aviso "A equipe fechou a sua câmera" / "A equipe silenciou o seu microfone" (e o microfone some
 * da barra); a liberacao do proprio microfone abre o dialogo Falar / Agora não; quem tem papel de moderador entra na
 * lista "No palco" (nunca a lista de alunos); o micError / cameraError vira o aviso na barra e encerra a espera do
 * nosso pedido. Na tag stable-11248 eles so chegam da troca de aparelho do painel (o set*Device): o Falar e o Ligar
 * câmera vao pelo toggleAudio / toggleVideo, cuja recusa nao avisa nada, e a sala confere a permissao do navegador
 * (micAskCheck, cameraRequestUnanswered).
 */
export function applyLiveSignal(state: LiveSignalState, input: { name: string; ownId: string | null; payload: unknown }): LiveSignalState {
  const { name, ownId, payload } = input;
  const id = field(payload, "id");
  switch (name) {
    case "videoConferenceJoined":
      // O iframe entra no Palco, com a coluna de miniaturas na tela (a grade e por comando, depois de entrar).
      return { ...INITIAL_LIVE_SIGNALS, filmstripVisible: true, participants: state.participants, recording: state.recording };
    case "videoConferenceLeft":
      // Fora da sala ninguem esta no palco para nos (a lista volta com os participantJoined da proxima entrada) e a
      // liberacao do microfone era do participante que saiu (quem volta entra com outro id, mudo).
      return { ...INITIAL_LIVE_SIGNALS, recording: state.recording };
    case "videoMuteStatusChanged": {
      const on = field(payload, "muted") === false;
      const closedByTeam = !on && state.videoOn && !state.expectVideo;
      // A camera ligou depois do aviso "camera desligada" ou "nao liberada" (o aluno so respondeu ao pedido do navegador
      // depois do prazo).
      const notice = closedByTeam ? "camera_closed" : on && (state.notice === "camera_blocked" || state.notice === "camera_unanswered") ? null : state.notice;
      return { ...state, expectVideo: false, notice, videoOn: on };
    }
    case "audioMuteStatusChanged": {
      const on = field(payload, "muted") === false;
      const silencedByTeam = !on && state.audioOn && !state.expectAudio;
      return {
        ...state,
        audioOn: on,
        expectAudio: false,
        micAllowed: silencedByTeam ? false : state.micAllowed || on,
        // O microfone abriu depois do aviso do prazo (o aluno liberou depois, ou o aparelho abriu tarde): o aviso sai.
        notice: silencedByTeam ? "mic_silenced" : on && (state.notice === "mic_unanswered" || state.notice === "mic_failed") ? null : state.notice
      };
    }
    case "raiseHandUpdated":
      return ownId !== null && id === ownId ? { ...state, handRaised: Boolean(field(payload, "handRaised")) } : state;
    case "moderationParticipantApproved":
      return isOwnMicApproval(payload, ownId) ? { ...state, micPrompt: true, notice: "mic_released" } : state;
    case "micError":
      return { ...state, expectAudio: false, notice: mediaErrorNotice("mic", payload) };
    case "cameraError":
      return { ...state, expectVideo: false, notice: mediaErrorNotice("camera", payload) };
    case "recordingStatusChanged":
      return { ...state, recording: field(payload, "on") === true };
    case "tileViewChanged": {
      const enabled = field(payload, "enabled");
      return typeof enabled === "boolean" ? { ...state, viewShown: enabled ? "grid" : "stage" } : state;
    }
    case "filmstripDisplayChanged": {
      const visible = field(payload, "visible");
      return typeof visible === "boolean" ? { ...state, filmstripVisible: visible } : state;
    }
    case "participantJoined": {
      const display = cleanName(field(payload, "displayName"));
      return typeof id === "string" && id !== ownId && display ? { ...state, participants: { ...state.participants, names: { ...state.participants.names, [id]: display } } } : state;
    }
    case "participantLeft":
      return typeof id === "string"
        ? { ...state, participants: { moderators: state.participants.moderators.filter((item) => item !== id), names: withoutKey(state.participants.names, id) } }
        : state;
    case "participantRoleChanged": {
      if (typeof id !== "string" || id === ownId) {
        return state;
      }
      const moderator = field(payload, "role") === "moderator";
      const others = state.participants.moderators.filter((item) => item !== id);
      return { ...state, participants: { ...state.participants, moderators: moderator ? [...others, id] : others } };
    }
    default:
      return state;
  }
}

/**
 * Pedimos a camera e o iframe nao respondeu no prazo: o pedido vence. `forceMuted` e o isParticipantForceMuted do
 * proprio aluno para o video (nulo sem resposta) e `permission` a permissao da camera relida no fim do prazo (o
 * toggleVideo da tag stable-11248 nao avisa cameraError quando o navegador recusa). A moderacao de video segurando o
 * aluno (a equipe desligou as cameras dos alunos no meio da live: o iframe recusa sem pedir nada ao navegador, e a
 * permissao fica como estava) diz que a camera dos alunos esta desligada; a permissao negada, que o navegador bloqueou;
 * o pedido do navegador ainda sem resposta (`prompt`: fechado no X, ou aberto), que a camera nao foi liberada (o aceite
 * fica, e a camera que abrir depois tira o aviso); com a permissao dada ou sem como saber, a camera dos alunos
 * desligada (o caso de antes).
 */
export function cameraRequestUnanswered(state: LiveSignalState, permission: string | null = null, forceMuted: boolean | null = null): LiveSignalState {
  if (!state.expectVideo || state.videoOn) {
    return state;
  }
  const notice: LiveNotice = forceMuted === true ? "camera_blocked" : permission === "denied" ? "camera_denied" : permission === "prompt" ? "camera_unanswered" : "camera_blocked";
  return { ...state, expectVideo: false, notice };
}

/**
 * Quanto esperar a camera ligar antes de dizer que ela nao ligou: com a permissao ja negada, nada (o navegador recusa
 * na hora); com o pedido de permissao do navegador ainda por responder (`prompt`, comum no celular), o prazo cobre a
 * resposta (30 s); com a permissao dada (ou sem como saber), 5 s.
 */
export function cameraAnswerDelayMs(permission: string | null | undefined): number {
  if (permission === "denied") {
    return 0;
  }
  return permission === "prompt" ? LIVE_ROOM_RULES.cameraPromptMs : LIVE_ROOM_RULES.cameraAnswerMs;
}

/**
 * O prazo do pedido da camera venceu com a permissao negada e o aceite do aviso ainda pendente (a camera nao ligou):
 * o aceite desta abertura sai, como no erro de camera, e o proximo clique abre o aviso de novo.
 */
export function cameraConsentEndedByDenial(pending: boolean, permission: string | null): boolean {
  return pending && permission === "denied";
}

/**
 * O aceite do aviso de gravacao (D4) vai no PRIMEIRO videoMuteStatusChanged depois dele, chegue quando chegar (o prazo
 * da frase da barra nao mexe nele); um erro de camera tambem o encerra, venha pelo errorOccurred de gum ou pelo
 * cameraError (que nesta tag so chega da troca de aparelho; a recusa do Ligar câmera e a permissao negada no fim do
 * prazo, cameraConsentEndedByDenial). O micError e do microfone: nao mexe no aceite da camera. Encerrado por erro, a
 * sala desfaz o aceite (cameraConsentEndedByError): o proximo clique em Câmera abre o aviso de novo e o aceite vai com
 * a camera que ligar depois.
 */
export function consentForVideoSignal(pending: boolean, name: string, payload?: unknown): { consented: boolean; pending: boolean } {
  if (!pending) {
    return { consented: false, pending: false };
  }
  if (name === "videoMuteStatusChanged") {
    return { consented: true, pending: false };
  }
  if (name === "cameraError") {
    return { consented: false, pending: false };
  }
  if (name === "errorOccurred") {
    const error = field(payload, "error") ?? payload;
    const code = `${field(error, "name") ?? ""} ${field(error, "type") ?? ""}`;
    return /gum|camera|video|permission|device/i.test(code) ? { consented: false, pending: false } : { consented: false, pending: true };
  }
  return { consented: false, pending: true };
}

/** O aceite pendente acabou sem a camera ligar (um erro de camera): a sala desfaz o aceite desta abertura. */
export function cameraConsentEndedByError(pending: boolean, next: { consented: boolean; pending: boolean }): boolean {
  return pending && !next.pending && !next.consented;
}

/**
 * Quem ja era moderador quando o aluno entrou (o apresentador entra antes, pela Sessao de pratica) so aparece no
 * getRoomsInfo() do IFrame API: { rooms: [{ isMainRoom, participants: [{ id, role, displayName }] }] }. A sala principal
 * vira a lista de moderadores (e os nomes deles) de "No palco"; o proprio aluno fica fora; nunca alunos.
 */
export function applyRoomsInfo(state: LiveSignalState, info: unknown, ownId: string | null): LiveSignalState {
  const rooms = field(info, "rooms");
  if (!Array.isArray(rooms)) {
    return state;
  }
  const main = rooms.find((room) => field(room, "isMainRoom") === true) ?? rooms[0];
  const people = field(main, "participants");
  if (!Array.isArray(people)) {
    return state;
  }
  const moderators: string[] = [];
  const names = { ...state.participants.names };
  for (const person of people) {
    const id = field(person, "id");
    if (typeof id !== "string" || id === ownId || field(person, "role") !== "moderator") {
      continue;
    }
    moderators.push(id);
    const display = cleanName(field(person, "displayName"));
    if (display) {
      names[id] = display;
    }
  }
  return { ...state, participants: { moderators, names } };
}

/** O aluno aceitou a camera (ou desligou): o proximo videoMuteStatusChanged e nosso. */
export function expectVideoToggle(state: LiveSignalState): LiveSignalState {
  return { ...state, expectVideo: true };
}

/** Falar: o dialogo fecha, o microfone fica na barra e o proximo audioMuteStatusChanged e nosso. */
export function acceptMic(state: LiveSignalState): LiveSignalState {
  return { ...state, expectAudio: true, micAllowed: true, micPrompt: false, notice: null };
}

/** Agora não: o dialogo fecha e nada liga. */
export function declineMic(state: LiveSignalState): LiveSignalState {
  return { ...state, micPrompt: false, notice: null };
}

/** O botao Microfone (depois de liberado): o proximo audioMuteStatusChanged e nosso. */
export function expectAudioToggle(state: LiveSignalState): LiveSignalState {
  return { ...state, expectAudio: true };
}

/* ------------------------------------------------------------------------------------------------
 * O pedido do microfone e a recusa do navegador
 * ---------------------------------------------------------------------------------------------- */

/**
 * Ligar o microfone (o Falar, ou Microfone com ele desligado) pelo toggleAudio da tag stable-11248: o iframe marca o
 * microfone "ligado" (base/media audio.muted = false, e o audioMuteStatusChanged { muted: false } sai na hora) ANTES do
 * getUserMedia, e a falha dele nao avisa nada (vira so TRACK_CREATE_ERROR: nem micError, nem a volta do mudo), seja a
 * permissao do site, a do sistema (o macOS que bloqueou o navegador), o microfone ocupado ou o fone desplugado. Entao
 * TODO pedido segura o "ligado" ate a faixa abrir de verdade (isAudioMuted do iframe falso), com ou sem a permissao do
 * site dada. O pedido e um so, ligado ao iframe em que o toggleAudio foi (`api`), e acaba so com a faixa aberta (o
 * "ligado" vai), o mudo (micAskStep), a recusa do navegador, outro toque, outro iframe ou a saida; nunca por prazo (o
 * getUserMedia aberto continua esperando o aluno: quem libera depois abre a faixa sem sinal nenhum). Enquanto ele
 * durar, o iframe pode estar com o "ligado" sem faixa: o proximo toque abre outro pedido, e o "ligado" que nao vier de
 * novo como sinal a sala cria quando a faixa abrir.
 */
export type MicAsk = {
  /** O IFrame API em que o toggleAudio foi: outro (a queda, a volta, a sala desmontada) encerra o pedido. */
  api: unknown;
  /** Ate quando a sala confere depressa; depois, o aviso (uma vez) e a conferencia devagar. */
  deadline: number;
  /** O "ligado" que o iframe mandou e a sala segurou (nulo depois do aviso: a faixa que abrir cria um). */
  held: unknown;
  id: number;
  /** O aviso do fim do prazo ja saiu (micRequestUnanswered): a sala so confere, mais devagar, se a faixa abriu. */
  noticed: boolean;
};

/**
 * O prazo do pedido do microfone: com a permissao do site dada, a faixa abre em centenas de ms (ou o getUserMedia ja
 * falhou: o sistema, o aparelho ocupado), entao 5 s; sem ela (o pedido do navegador por responder, ou sem como saber),
 * o tempo de o aluno ler e responder, 30 s. A permissao negada nao espera prazo nenhum (micAskCheck).
 */
export function micAnswerDelayMs(permission: string | null): number {
  return permission === "granted" ? LIVE_ROOM_RULES.cameraAnswerMs : LIVE_ROOM_RULES.cameraPromptMs;
}

/**
 * O pedido novo, aberto ANTES do toggleAudio (o "ligado" que o iframe manda logo em seguida ja fica guardado). O
 * "ligado" ainda guardado do pedido anterior no mesmo iframe passa para este.
 */
export function startMicAsk(previous: MicAsk | null, input: { api: unknown; id: number; nowMs: number; permission: string | null }): MicAsk {
  return {
    api: input.api,
    deadline: input.nowMs + micAnswerDelayMs(input.permission),
    held: previous && previous.api === input.api ? previous.held : null,
    id: input.id,
    noticed: false
  };
}

/**
 * Um sinal do iframe durante o pedido do microfone: o "ligado" fica guardado (nem a barra, nem o servidor); o mudo (a
 * equipe silenciou) encerra o pedido e passa, depois do "ligado" guardado (`release`), na ordem em que vieram.
 */
export function micAskStep(current: MicAsk | null, name: string, payload: unknown): { next: MicAsk | null; release: unknown; swallow: boolean } {
  const muted = field(payload, "muted");
  if (!current || name !== "audioMuteStatusChanged" || typeof muted !== "boolean") {
    return { next: current, release: null, swallow: false };
  }
  if (!muted) {
    return { next: { ...current, held: payload }, release: null, swallow: true };
  }
  return { next: null, release: current.held, swallow: false };
}

export type MicAskOutcome =
  | { action: "denied" }
  | { action: "gone" }
  | { action: "late"; next: MicAsk; notice: "mic_failed" | "mic_unanswered" }
  | { action: "release"; signal: unknown }
  | { action: "wait"; ms: number };

/**
 * Cada conferencia do pedido do microfone: `api` e o IFrame API montado agora, `muted` o isAudioMuted do iframe do
 * pedido (falso so com a faixa aberta, verdadeiro sem faixa; nulo sem resposta), `permission` a permissao do microfone
 * no navegador. Outro pedido, o mudo, a queda ou outro iframe ja o encerraram: "gone" (a conferencia para, e nada do
 * pedido vai a barra nem ao servidor). A faixa aberta solta o "ligado" (o guardado, ou um criado quando o iframe ja
 * estava no "ligado" sem faixa). A permissao negada descarta o "ligado" ("denied": o aviso, e a conferencia para). No
 * fim do prazo sem a faixa aberta, ou sem resposta do iframe (sem como saber nunca vira "ligado"), "late" uma vez: o
 * aviso (com a permissao dada, o aparelho que nao abriu; sem ela, o pedido do navegador sem resposta), o "ligado"
 * guardado descartado (nada na barra nem no servidor) e a conferencia devagar, sem fim por prazo, para soltar o
 * "ligado" se a faixa abrir depois. "wait" diz quando conferir de novo.
 */
export function micAskCheck(current: MicAsk | null, id: number, input: { api: unknown; muted: boolean | null; nowMs: number; permission: string | null }): MicAskOutcome {
  if (!current || current.id !== id || current.api !== input.api) {
    return { action: "gone" };
  }
  if (input.muted === false) {
    return { action: "release", signal: current.held ?? { muted: false } };
  }
  if (input.permission === "denied") {
    return { action: "denied" };
  }
  if (input.nowMs < current.deadline) {
    return { action: "wait", ms: LIVE_ROOM_RULES.micCheckMs };
  }
  if (current.noticed) {
    return { action: "wait", ms: LIVE_ROOM_RULES.micLateCheckMs };
  }
  return { action: "late", next: { ...current, held: null, noticed: true }, notice: input.permission === "granted" ? "mic_failed" : "mic_unanswered" };
}

/**
 * O pedido do microfone venceu sem a faixa abrir: a barra mostra o microfone desligado com o aviso (sem a permissao
 * dada, que ele nao foi liberado no navegador; com ela, que o aparelho nao abriu: o sistema bloqueou o navegador, outro
 * programa o ocupa, o fone saiu) e nenhuma linha "ligado" vai ao servidor; o botao Microfone fica para tentar de novo.
 */
export function micRequestUnanswered(state: LiveSignalState, notice: "mic_failed" | "mic_unanswered" = "mic_unanswered"): LiveSignalState {
  return { ...state, audioOn: false, expectAudio: false, notice };
}

/** O navegador recusou o microfone: o aviso na barra e o microfone desligado (o botao Microfone fica para tentar de novo). */
export function micRequestDenied(state: LiveSignalState): LiveSignalState {
  return { ...state, audioOn: false, expectAudio: false, notice: "mic_denied" };
}

/**
 * O sinal de mudo da troca que vale no fim do prazo e nosso: a marca expectVideo (ou expectAudio) antes de aplica-lo (a
 * faixa nova que nao voltou nunca vira "A equipe fechou a sua câmera"). O alto-falante nao mexe em faixa nenhuma.
 */
export function expectDeviceSwitch(state: LiveSignalState, kind: DeviceKind): LiveSignalState {
  if (kind === "audioInput") {
    return { ...state, expectAudio: true };
  }
  return kind === "videoInput" ? { ...state, expectVideo: true } : state;
}

/* ------------------------------------------------------------------------------------------------
 * A troca de camera do painel Configurações
 * ---------------------------------------------------------------------------------------------- */

/** Os aparelhos cuja troca cria uma faixa nova no iframe (o alto-falante nao). */
export type DeviceSwitchKind = "audioInput" | "videoInput";

/**
 * Os aparelhos cuja troca a sala separa: so a camera. Na tag stable-11248 o mudo da camera sai da faixa
 * (isLocalTrackMuted), e a troca tira a faixa velha e poe a nova: o par muted:true / muted:false chega. O mudo do
 * microfone sai de base/media audio.muted, e a troca do microfone despacha setAudioMuted com o mesmo valor de antes:
 * nenhum sinal chega, e uma troca aberta para ele so engoliria a equipe silenciando nos segundos seguintes.
 */
export const DEVICE_SWITCH_KINDS: readonly DeviceSwitchKind[] = ["videoInput"];

/**
 * Uma troca de camera em andamento: o set*Device cria uma faixa nova, que avisa o mudo e volta (videoMuteStatusChanged)
 * sem ninguem ter ligado ou desligado nada. Esses sinais nao vao para a barra (seriam lidos como a equipe fechando a
 * camera) nem para o servidor (virariam webinar_camera_toggled falsos, com a camera "ligada" sem o aceite, D4).
 */
export type DeviceSwitch = {
  /** O microfone / a camera estavam ligados antes da troca: o estado que a faixa nova devolve. */
  before: boolean;
  /** Ate quando a troca espera (LIVE_ROOM_RULES.deviceSwitchMs, contado de novo na resposta e a cada sinal dela). */
  deadline: number;
  /** O ultimo sinal da troca diferente do estado de antes (a faixa nova que nao voltou): vale no fim do prazo. */
  held: unknown;
  id: number;
};

/** O sinal de mudo que a troca daquele aparelho separa. */
export function deviceSwitchSignalOf(kind: DeviceSwitchKind): "audioMuteStatusChanged" | "videoMuteStatusChanged" {
  return kind === "audioInput" ? "audioMuteStatusChanged" : "videoMuteStatusChanged";
}

/**
 * A troca comeca ANTES do set*Device, com o estado de agora. So a camera abre troca (DEVICE_SWITCH_KINDS): a troca do
 * microfone nao manda sinal de mudo nesta tag, e o alto-falante nao mexe em faixa.
 */
export function startDeviceSwitch(state: Pick<LiveSignalState, "audioOn" | "videoOn">, kind: DeviceKind, id: number, nowMs: number): DeviceSwitch | null {
  if (!DEVICE_SWITCH_KINDS.includes(kind as DeviceSwitchKind)) {
    return null;
  }
  return { before: kind === "audioInput" ? state.audioOn : state.videoOn, deadline: nowMs + LIVE_ROOM_RULES.deviceSwitchMs, held: null, id };
}

/** O set*Device respondeu: o prazo conta de novo dali (so a mesma troca; uma troca mais nova nao muda). */
export function answerDeviceSwitch(current: DeviceSwitch | null, id: number, nowMs: number): DeviceSwitch | null {
  return current && current.id === id ? { ...current, deadline: nowMs + LIVE_ROOM_RULES.deviceSwitchMs } : current;
}

/**
 * Um sinal do iframe durante a troca: o mudo daquele aparelho e da troca (`swallow`: nem a barra, nem o servidor). De
 * volta ao estado de antes, a troca acaba; diferente, fica guardado (o prazo conta de novo) para valer no fim.
 */
export function deviceSwitchStep(current: DeviceSwitch | null, kind: DeviceSwitchKind, name: string, payload: unknown, nowMs: number): { next: DeviceSwitch | null; swallow: boolean } {
  // O iframe nao conseguiu abrir o aparelho novo: a faixa velha fica e nada mais vem da troca (o erro vai para a barra;
  // o que vier depois, como a equipe fechando a camera, e da equipe).
  if (current && name === (kind === "audioInput" ? "micError" : "cameraError")) {
    return { next: null, swallow: false };
  }
  const muted = field(payload, "muted");
  if (!current || name !== deviceSwitchSignalOf(kind) || typeof muted !== "boolean") {
    return { next: current, swallow: false };
  }
  if (!muted === current.before) {
    return { next: null, swallow: true };
  }
  return { next: { ...current, deadline: nowMs + LIVE_ROOM_RULES.deviceSwitchMs, held: payload }, swallow: true };
}

/**
 * O relogio da troca: outra troca ou o proprio aluno (Câmera) ja a encerrou ("gone"); ainda no prazo ("wait", quanto
 * falta); vencida ("expire", com o sinal guardado, ou nulo quando a faixa nova nao avisou nada).
 */
export function deviceSwitchCheck(current: DeviceSwitch | null, id: number, nowMs: number): { action: "expire"; held: unknown } | { action: "gone" } | { action: "wait"; ms: number } {
  if (!current || current.id !== id) {
    return { action: "gone" };
  }
  if (current.deadline > nowMs) {
    return { action: "wait", ms: current.deadline - nowMs };
  }
  return { action: "expire", held: current.held };
}

/**
 * A troca acabou de verdade (o hook viu o aparelho escolhido em uso, o erro dela ou o teto): a janela dela fecha, e o
 * sinal guardado que nao voltou ao estado de antes vale como nosso (como no fim do prazo). Outra troca: nada muda.
 */
export function deviceSwitchSettled(current: DeviceSwitch | null, id: number): { held: unknown; next: DeviceSwitch | null } {
  return current && current.id === id ? { held: current.held, next: null } : { held: null, next: current };
}

/* ------------------------------------------------------------------------------------------------
 * O toque em Microfone / Câmera durante a troca daquele aparelho
 * ---------------------------------------------------------------------------------------------- */

/**
 * Na tag stable-11248 o onAudioDeviceChanged / onVideoDeviceChanged le o mudo ANTES do getUserMedia do aparelho novo e,
 * quando ele abre, troca a faixa e grava o mudo dela (replaceStoredTracks): um toque em Microfone / Câmera no meio da
 * troca seria desfeito (a camera desligada voltaria ao ar, a ligada viraria "A equipe fechou a sua câmera."). Entao o
 * toque espera a troca acabar e vai depois, na faixa nova. `inFlight` e o numero da troca em andamento; `queued`, um
 * toque esperando (um segundo toque desfaz o primeiro: o aluno volta ao que estava).
 */
export type SwitchGate = { inFlight: number | null; queued: boolean };

export const OPEN_SWITCH_GATE: SwitchGate = { inFlight: null, queued: false };

/** A troca daquele aparelho comecou (antes do set*Device); um toque que ja esperava continua esperando. */
export function gateSwitchStarted(gate: SwitchGate, id: number): SwitchGate {
  return { inFlight: id, queued: gate.queued };
}

/** O toque em Microfone / Câmera: sem troca em andamento vai na hora; com ela, espera (o segundo desfaz o primeiro). */
export function gateToggle(gate: SwitchGate): { gate: SwitchGate; send: boolean } {
  if (gate.inFlight === null) {
    return { gate, send: true };
  }
  return { gate: { ...gate, queued: !gate.queued }, send: false };
}

/** A troca acabou: o toque que esperava vai agora. Uma troca mais antiga que acaba depois de outra comecar: nada. */
export function gateSwitchDone(gate: SwitchGate, id: number): { gate: SwitchGate; send: boolean } {
  if (gate.inFlight !== id) {
    return { gate, send: false };
  }
  return { gate: OPEN_SWITCH_GATE, send: gate.queued };
}

/**
 * O toque em Microfone / Câmera que espera a troca daquele aparelho: o botao continua com o estado REAL (o microfone e
 * a camera seguem no ar ate a troca acabar), com o sinal de espera, e a linha de aviso diz o que acontece quando a troca
 * terminar. Nulo sem toque esperando (o do microfone so com o botao Microfone na barra).
 */
export function pendingTogglePhrase(pending: Record<DeviceSwitchKind, boolean>, state: Pick<LiveSignalState, "audioOn" | "micAllowed" | "videoOn">): string | null {
  const copy = WEBINAR_COPY.aoVivo;
  if (pending.videoInput) {
    return state.videoOn ? copy.trocandoCameraDesliga : copy.trocandoCameraLiga;
  }
  if (pending.audioInput && state.micAllowed) {
    return state.audioOn ? copy.trocandoMicrofoneDesliga : copy.trocandoMicrofoneLiga;
  }
  return null;
}

/**
 * A nossa barra (e com ela o painel Configurações e as reacoes) so existe com a sala no ar: a live encerrada, removido,
 * banido ou fora do acesso a tiram (docs/30 §1.7). Nao ha mais Minimizar (docs/31 V2-2): a sala nunca encolhe.
 */
export function liveBarShown(input: { blocked: boolean; screen: LiveScreen }): boolean {
  return !input.blocked && input.screen !== "ended";
}

/**
 * Os botoes da nossa barra (docs/31 V2-6), nas tres zonas: o Sair a esquerda; no centro Reagir, a mao (so com a nossa
 * barra de midia: aluno e Equipe), a Câmera (so com a camera dos alunos permitida no webinario; nula antes do token),
 * o Microfone (so depois de o apresentador liberar e do Falar), o Som e a Tela cheia (ou o Modo cinema); a direita,
 * a Visão do vídeo (Palco ou Grade, so com a nossa barra de midia: quem apresenta muda a visao pelo console, e o seguir
 * a visao a levaria a todos), Configurações e o balao do chat. O Som vem antes da Tela cheia. A tela decide o que some
 * pela largura (o Sair, a Tela cheia e a Visão do vídeo saem da barra abaixo de lg).
 */
export function liveBarItems(input: { allowStudentCamera: boolean | null; micAllowed: boolean; showMedia: boolean }): RoomBarItems {
  const center: RoomBarItem[] = ["react"];
  if (input.showMedia) {
    center.push("hand");
    if (input.allowStudentCamera === true) {
      center.push("camera");
    }
    if (input.micAllowed) {
      center.push("mic");
    }
  }
  center.push("sound", "fullscreen");
  return { center, left: ["leave"], right: input.showMedia ? ["view", "settings", "panel"] : ["settings", "panel"] };
}

/* ------------------------------------------------------------------------------------------------
 * A visao do video (docs/31 V2-16) e a coluna de miniaturas pela largura do iframe (V2-A5)
 * ---------------------------------------------------------------------------------------------- */

/**
 * O comando que a sala manda depois de cada videoConferenceJoined (a entrada, Tentar de novo, a volta depois da queda):
 * so a Grade guardada vira setTileView(true). O Palco guardado nao manda nada: o iframe ja entra no Palco, e forcar o
 * Palco desfaria a grade que a equipe ligou para todos (o seguir a visao so reaplica quando a equipe muda).
 */
export function viewOnJoin(stored: RoomView): ["setTileView", true] | null {
  return stored === "grid" ? ["setTileView", true] : null;
}

/**
 * A sala quer a coluna de miniaturas a direita do video grande: so no Palco (na Grade as miniaturas sao a propria
 * grade) e com o iframe de FILMSTRIP_COLUMN_MIN_FRAME (1013 px) ou mais, a largura em que o motor da a coluna inteira
 * sem estreitar as miniaturas nem as deixar flutuar sobre o video. No celular (o iframe de cerca de 374 px) ela some.
 */
export function columnWanted(input: { frameWidth: number; view: RoomView }): boolean {
  return input.view === "stage" && Number.isFinite(input.frameWidth) && input.frameWidth >= FILMSTRIP_COLUMN_MIN_FRAME;
}

/**
 * O toggleFilmStrip so quando o que a sala quer difere do que o motor mostra (o ultimo filmstripDisplayChanged): o
 * comando inverte a coluna, entao manda-lo com os dois iguais a tiraria (ou poria) por engano.
 */
export function filmstripStep(input: { visible: boolean; wanted: boolean }): "toggle" | null {
  return input.wanted === input.visible ? null : "toggle";
}

/**
 * A coluna de miniaturas esta na tela agora (o que os selos de baixo e as pilulas descontam, --room-video-right): so
 * com o motor no Palco (o ultimo tileViewChanged, nunca a escolha guardada) e com a coluna visivel (o ultimo
 * filmstripDisplayChanged). Antes de entrar e na Grade, nenhuma coluna.
 */
export function stageColumnShown(signals: Pick<LiveSignalState, "filmstripVisible" | "viewShown">): boolean {
  return signals.viewShown === "stage" && signals.filmstripVisible;
}

/**
 * O menu da Visão do vídeo fechou por ficar desligado (a reconexao, a saida do iframe, a barra que sumiu) com o foco na
 * opcao que sumiu, ou ja no body: a sala manda o foco para dentro dela (roomFocusTarget; o botao do menu esta desligado
 * ou fora da tela), nunca o deixa no body, onde o Esc, os atalhos e a trava do Tab deixariam de valer. Com o foco em
 * outro lugar (o video, outro controle), nada. Fechado pelo aluno, o proprio menu e a sala ja levam o foco ao botao.
 */
export function viewMenuFocusLost(input: { active: unknown; body: unknown; inMenu: boolean }): boolean {
  return input.inMenu || input.active === input.body || input.active === null;
}

/**
 * A nossa barra acabou de sumir (a live encerrada, removido ou banido) e o foco caiu no body (estava num botao dela,
 * no painel Configurações ou nas reacoes, que sumiram juntos): a sala manda o foco de volta para dentro dela.
 */
export function barFocusLost(input: { active: unknown; barShown: boolean; barWasShown: boolean; body: unknown }): boolean {
  return input.barWasShown && !input.barShown && (input.active === input.body || input.active === null);
}

/** Levantar / Abaixar a mão: a barra muda na hora; o raiseHandUpdated do iframe confirma. */
export function toggleHandLocally(state: LiveSignalState): LiveSignalState {
  return { ...state, handRaised: !state.handRaised };
}

/** A frase de um aviso passageiro da barra. */
export function liveNoticePhrase(notice: LiveNotice | null): string | null {
  switch (notice) {
    case "camera_blocked":
      return WEBINAR_COPY.aoVivo.cameraBloqueada;
    case "camera_closed":
      return WEBINAR_COPY.aoVivo.cameraFechadaPelaEquipe;
    case "mic_released":
      return WEBINAR_COPY.aoVivo.microfoneLiberado;
    case "mic_silenced":
      return WEBINAR_COPY.aoVivo.microfoneSilenciado;
    case "mic_denied":
      return WEBINAR_COPY.aoVivo.microfoneNegado;
    case "mic_failed":
      return WEBINAR_COPY.aoVivo.microfoneFalhou;
    case "camera_denied":
      return WEBINAR_COPY.aoVivo.cameraNegada;
    case "camera_failed":
      return WEBINAR_COPY.aoVivo.cameraFalhou;
    case "camera_unanswered":
      return WEBINAR_COPY.aoVivo.cameraSemResposta;
    case "mic_unanswered":
      return WEBINAR_COPY.aoVivo.microfoneSemResposta;
    default:
      return null;
  }
}

/** O selo Gravando: o ultimo sinal do iframe vale; antes dele, a sessao (o gravador gravando). */
export function isRecording(signals: Pick<LiveSignalState, "recording">, live: Pick<LiveRoomInfo, "recording"> | null): boolean {
  return signals.recording ?? Boolean(live?.recording);
}

/** "No palco": o apresentador (da pagina) e quem tem papel de moderador no iframe, sem repetir; nunca alunos. */
export function stageNames(participants: LiveParticipants, presenterName: string | null): string[] {
  const names: string[] = [];
  const add = (value: string | null | undefined) => {
    const clean = cleanName(value);
    if (clean && !names.includes(clean)) {
      names.push(clean);
    }
  };
  add(presenterName);
  participants.moderators.forEach((id) => add(participants.names[id]));
  return names;
}

/** Os ids de quem esta na sala alem de mim (o botao Som baixa o volume de cada um). */
export function remoteParticipantIds(participants: LiveParticipants): string[] {
  return Object.keys(participants.names);
}

/* ------------------------------------------------------------------------------------------------
 * Teclado, celular e o chat por cima do palco
 * ---------------------------------------------------------------------------------------------- */

export type LiveShortcut = "hand" | "poll" | "react";

const EDITABLE_TAGS = ["INPUT", "SELECT", "TEXTAREA"];

/**
 * Os atalhos da sala (docs/30 §9): R abre as reacoes, M levanta ou abaixa a mao, E abre a enquete. Nunca com Ctrl,
 * Alt ou Cmd, nem com o foco num campo de texto (o aluno esta escrevendo).
 */
export function liveShortcutOf(input: { altKey?: boolean; ctrlKey?: boolean; editable?: boolean; key: string; metaKey?: boolean; tagName?: string | null }): LiveShortcut | null {
  if (input.altKey || input.ctrlKey || input.metaKey || input.editable || (input.tagName && EDITABLE_TAGS.includes(input.tagName.toUpperCase()))) {
    return null;
  }
  switch (input.key.toLowerCase()) {
    case "r":
      return "react";
    case "m":
      return "hand";
    case "e":
      return "poll";
    default:
      return null;
  }
}

/**
 * No iPhone a tela cheia do palco esconderia o nosso chat (e o Safari do iPhone nao poe um elemento qualquer em tela
 * cheia): a sala oferece o Modo cinema no lugar (docs/30 §9). Tambem quando o navegador nao tem tela cheia.
 */
export function prefersCinemaMode(input: { fullscreenEnabled: boolean; userAgent: string }): boolean {
  return /iPhone|iPod/i.test(input.userAgent) || !input.fullscreenEnabled;
}

/** As ultimas mensagens para as pilulas do chat sobre o palco (o painel fechado; as duas salas, V2-8). */
export function overlayMessages<T>(messages: readonly T[], count: number = LIVE_ROOM_RULES.overlayMessages): T[] {
  return count > 0 ? messages.slice(-count) : [];
}
