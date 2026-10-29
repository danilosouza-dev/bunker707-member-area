// A sala ao vivo do aluno no navegador, a parte pura (docs/30 §1.3, §1.4, §1.7, §5.1, §6.3, §8.5 e §9; fase 3): qual
// tela a sala mostra (em breve, removido, banido, encerrada, trancada, aguardando o apresentador ou aberta), a frase de
// cada recusa do join-token (409 not_started / ended / kicked / banned, 503 meet_unconfigured, o resto "Tentar de
// novo"), a fila dos sinais do iframe para POST .../room-events (lotes de ate 20 que cabem no corpo de 4 KB; o que
// toRoomEvent recusa nunca entra; 429 espera o Retry-After; a queda da rede devolve o lote), as tentativas de voltar
// depois de uma queda (2 s, 4 s, 8 s e depois "Não conseguimos voltar"), o relogio "Ao vivo · 00:42:10" pelo inicio
// de verdade e o skew do servidor, a hora do silencio no chat em Sao Paulo, o que os sinais do iframe mudam na nossa
// barra (mao, camera, microfone liberado, gravando, quem esta no palco) e os atalhos R / M / E. Sem "use client" e com
// imports relativos: tests/webinarios-sala-ao-vivo-navegador.test.mjs carrega direto pelo Node. Nada aqui le o relogio
// de verdade nem a rede: a hora e o resto chegam por parametro.

import { LOWER_HAND_SIGNAL, RECONNECT_ATTEMPTS, RECORDING_SIGNAL, tokenRefreshDelayMs, type LiveRoomRole, type RoomEventItem } from "../../../../lib/jitsi-room-config";
import { WEBINAR_COPY } from "../../../../lib/webinar-copy";
import { saoPauloTime } from "../../../../lib/webinar-time";
import type { JoinTokenReply, LiveBanState, LiveRoomInfo } from "../../../../server/webinars/live-model";
import type { SessionStatus } from "../../../../server/webinars/model";

/* ------------------------------------------------------------------------------------------------
 * Frases da barra e do "Como usar" (WEBINAR_COPY.aoVivo; o nome do objeto ficou para os componentes e testes)
 * ---------------------------------------------------------------------------------------------- */

export const LIVE_ROOM_COPY = {
  /** O nome da nossa barra para o leitor de tela. */
  barra: WEBINAR_COPY.aoVivo.barra,
  /** O "Como usar" da barra (docs/30 §9): os atalhos anunciados. */
  comoUsar: WEBINAR_COPY.aoVivo.comoUsar,
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
  /** As ultimas mensagens por cima do palco com a gaveta fechada (celular). */
  overlayMessages: 3,
  /** Os avisos passageiros da barra (camera fechada pela equipe, microfone silenciado) somem depois disto. */
  noticeMs: 6_000,
  /** Ligar a camera sem resposta do iframe depois disto: a camera dos alunos esta desligada (a equipe fechou). */
  cameraAnswerMs: 5_000,
  /** O mesmo prazo com o pedido de permissao do navegador ainda aberto (o aluno le e responde). */
  cameraPromptMs: 30_000,
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
 * banned / kicked: a sala inteira da lugar a frase (sem iframe nem chat); ended: palco encerrado (o chat fica so para
 * ler); unconfigured: "em breve" no palco (o chat funciona); locked: quem ainda nao entrou ve a frase da sala trancada
 * e a pagina reconsulta a sessao; waiting: a sala ainda nao abriu para o aluno (Aguardando o apresentador); open: o
 * botao Entrar na sala (ou o iframe, depois dele).
 */
export type LiveScreen = "banned" | "ended" | "kicked" | "locked" | "open" | "unconfigured" | "waiting";

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
}): LiveScreen {
  const { ban, live } = input;
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

/** A sala inteira da lugar a frase (removido ou banido): sem iframe, sem chat. */
export function screenBlocksRoom(screen: LiveScreen): boolean {
  return screen === "banned" || screen === "kicked";
}

/** A frase de cada tela (o titulo e, quando ha, a linha de baixo); `open` nao tem frase. */
export function liveScreenPhrase(screen: LiveScreen, input: { hasReplay: boolean }): { text: string | null; title: string } | null {
  switch (screen) {
    case "banned":
      return { text: null, title: WEBINAR_COPY.aoVivo.banido };
    case "kicked":
      return { text: null, title: WEBINAR_COPY.aoVivo.removido };
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

export type LiveJoinFailure = "banned" | "ended" | "error" | "kicked" | "meet_unconfigured" | "not_started";

/** O motivo de uma falha de POST .../join-token (o erro do fetch traz status e reason). Rede e 5xx: `error`. */
export function joinFailureOf(error: unknown): LiveJoinFailure {
  const status = typeof (error as { status?: unknown } | null)?.status === "number" ? (error as { status: number }).status : null;
  const reason = (error as { reason?: unknown } | null)?.reason;
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
    default:
      return WEBINAR_COPY.aoVivo.erroAbrir;
  }
}

/** Depois de quanto tempo pedir outro token (ms): o contrato de jitsi-room-config (5 min antes do exp, piso de 10 s). */
export function tokenRefreshInMs(reply: Pick<JoinTokenReply, "expiresAt">, nowMs: number): number {
  return tokenRefreshDelayMs(reply.expiresAt, nowMs);
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

export type RoomEventsOutcome = { blocked: "banned" | "ended" | "kicked" | null; pauseUntilMs: number | null; requeue: boolean };

/**
 * O que fazer depois de mandar um lote: entregue (2xx), nada; 429: o lote volta para a fila e o proximo espera o
 * Retry-After; rede ou 5xx: volta para a fila; outro 4xx: descartado (nunca insiste num lote recusado). 409 banned:
 * a sala troca pela frase de removido (`kicked`, a mensagem do servidor e a do removido desta live) ou de banido de
 * todas (`banned`, so com a frase do banido; o mesmo criterio de writeRefusalOf); 409 ended: a sala encerra.
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

export type LiveNotice = "camera_blocked" | "camera_closed" | "mic_released" | "mic_silenced";

export type LiveParticipants = { moderators: string[]; names: Record<string, string> };

export type LiveSignalState = {
  audioOn: boolean;
  /** O proximo audioMuteStatusChanged foi pedido por nos (Falar ou Microfone): nao e a equipe silenciando. */
  expectAudio: boolean;
  /** O proximo videoMuteStatusChanged foi pedido por nos (Câmera): nao e a equipe fechando. */
  expectVideo: boolean;
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
};

export const INITIAL_LIVE_SIGNALS: LiveSignalState = {
  audioOn: false,
  expectAudio: false,
  expectVideo: false,
  handRaised: false,
  micAllowed: false,
  micPrompt: false,
  notice: null,
  participants: { moderators: [], names: {} },
  recording: null,
  videoOn: false
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

/**
 * O estado da nossa barra depois de um sinal do iframe. Entrar zera tudo (todo mundo entra mudo e com a camera
 * fechada); a mao e o papel so contam quando sao do proprio participante; a camera ou o microfone que fecham sem o
 * nosso pedido viram o aviso "A equipe fechou a sua câmera" / "A equipe silenciou o seu microfone" (e o microfone some
 * da barra); a liberacao do proprio microfone abre o dialogo Falar / Agora não; quem tem papel de moderador entra na
 * lista "No palco" (nunca a lista de alunos).
 */
export function applyLiveSignal(state: LiveSignalState, input: { name: string; ownId: string | null; payload: unknown }): LiveSignalState {
  const { name, ownId, payload } = input;
  const id = field(payload, "id");
  switch (name) {
    case "videoConferenceJoined":
      return { ...INITIAL_LIVE_SIGNALS, participants: state.participants, recording: state.recording };
    case "videoConferenceLeft":
      // Fora da sala ninguem esta no palco para nos (a lista volta com os participantJoined da proxima entrada) e a
      // liberacao do microfone era do participante que saiu (quem volta entra com outro id, mudo).
      return { ...INITIAL_LIVE_SIGNALS, recording: state.recording };
    case "videoMuteStatusChanged": {
      const on = field(payload, "muted") === false;
      const closedByTeam = !on && state.videoOn && !state.expectVideo;
      // A camera ligou depois do aviso "camera desligada" (o aluno so respondeu ao pedido do navegador depois do prazo).
      const notice = closedByTeam ? "camera_closed" : on && state.notice === "camera_blocked" ? null : state.notice;
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
        notice: silencedByTeam ? "mic_silenced" : state.notice
      };
    }
    case "raiseHandUpdated":
      return ownId !== null && id === ownId ? { ...state, handRaised: Boolean(field(payload, "handRaised")) } : state;
    case "moderationParticipantApproved":
      return isOwnMicApproval(payload, ownId) ? { ...state, micPrompt: true, notice: "mic_released" } : state;
    case "recordingStatusChanged":
      return { ...state, recording: field(payload, "on") === true };
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
 * Pedimos a camera e o iframe nao respondeu (a equipe desligou as cameras dos alunos no meio da live: a moderacao de
 * video recusa sem aviso): o pedido vence e a barra diz que a camera dos alunos esta desligada.
 */
export function cameraRequestUnanswered(state: LiveSignalState): LiveSignalState {
  return state.expectVideo && !state.videoOn ? { ...state, expectVideo: false, notice: "camera_blocked" } : state;
}

/**
 * Quanto esperar a camera ligar antes de dizer que a camera dos alunos esta desligada: com o pedido de permissao do
 * navegador ainda por responder (`prompt`, comum no celular), o prazo cobre a resposta (30 s); com a permissao dada
 * (ou sem como saber), 5 s.
 */
export function cameraAnswerDelayMs(permission: string | null | undefined): number {
  return permission === "prompt" ? LIVE_ROOM_RULES.cameraPromptMs : LIVE_ROOM_RULES.cameraAnswerMs;
}

/**
 * O aceite do aviso de gravacao (D4) vai no PRIMEIRO videoMuteStatusChanged depois dele, chegue quando chegar (o prazo
 * da frase da barra nao mexe nele); um erro de camera (permissao negada, sem dispositivo) tambem o encerra.
 */
export function consentForVideoSignal(pending: boolean, name: string, payload?: unknown): { consented: boolean; pending: boolean } {
  if (!pending) {
    return { consented: false, pending: false };
  }
  if (name === "videoMuteStatusChanged") {
    return { consented: true, pending: false };
  }
  if (name === "errorOccurred") {
    const error = field(payload, "error") ?? payload;
    const code = `${field(error, "name") ?? ""} ${field(error, "type") ?? ""}`;
    return /gum|camera|video|permission|device/i.test(code) ? { consented: false, pending: false } : { consented: false, pending: true };
  }
  return { consented: false, pending: true };
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

/** As ultimas mensagens para o chat por cima do palco (celular, gaveta fechada). */
export function overlayMessages<T>(messages: readonly T[], count: number = LIVE_ROOM_RULES.overlayMessages): T[] {
  return count > 0 ? messages.slice(-count) : [];
}
