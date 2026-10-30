// A sala da Live gravada e do Replay, a parte pura (docs/30 §1.6, §5.1, §6.5 e §6.6): o relogio do servidor e o
// alvo do player, as fases da sessao gravada, a janela do chat por offset, o nome exibido (D10), os baldes de
// presenca (M1, M2) e o endereco do player da Bunny. Sem "server-only", imports relativos: tests/webinarios-*.test.mjs
// carregam direto pelo Node. Nada aqui le o banco nem o relogio de verdade: tudo recebe `nowMs`.

import { CHAT_LIMITS, ROOM_RULES, toTime, type ChatMessage, type DisplayNameMode, type SimulatedPhase, type StudentChatMessage, type WebinarSession } from "./model";
import { ROOM_OPENS_MINUTES_BEFORE } from "./room-opens";

/** A sala abre para o aluno este tanto antes da hora marcada (num modulo folha, para o contador do just-in-time). */
export { ROOM_OPENS_MINUTES_BEFORE };

/** Quanto do chat anterior quem entra atrasado recebe de uma vez (depois, so a janela a frente). */
export const CHAT_BACKLOG_SECONDS = 300;

export type SessionClock = Pick<WebinarSession, "kind" | "recordingAnchorAt" | "scheduledAt" | "startedAt">;

/**
 * O zero do video de uma sessao, em ms: a hora marcada na gravada (todo mundo ve o mesmo segundo), a ancora da
 * gravacao na live (ou o inicio, antes de a ancora existir); o replay nao tem zero (o aluno controla o player).
 */
export function sessionVideoZero(session: SessionClock): number {
  if (session.kind === "replay") {
    return Number.NaN;
  }
  if (session.kind === "live") {
    return toTime(session.recordingAnchorAt ?? session.startedAt ?? session.scheduledAt);
  }
  return toTime(session.scheduledAt);
}

/** Onde o video esta agora, em ms (negativo na espera); NaN no replay. */
export function sessionOffsetMs(session: SessionClock, nowMs: number): number {
  const zero = sessionVideoZero(session);
  return Number.isFinite(zero) ? nowMs - zero : Number.NaN;
}

/** A duracao do video em ms: a gravacao quando se sabe, senao a duracao prevista do webinario. */
export function sessionDurationMs(recordingDurationSeconds: number | null | undefined, durationMinutes: number): number {
  if (recordingDurationSeconds && recordingDurationSeconds > 0) {
    return Math.round(recordingDurationSeconds * 1000);
  }
  return Math.max(1, durationMinutes) * 60_000;
}

/** A fase da sessao gravada pelo relogio (docs/30 §1.6): espera, no ar ou encerrada. */
export function simulatedPhase(session: SessionClock & Pick<WebinarSession, "status">, durationMs: number, nowMs: number): SimulatedPhase {
  if (session.status === "ended" || session.status === "cancelled") {
    return "ended";
  }
  const offset = sessionOffsetMs(session, nowMs);
  if (!Number.isFinite(offset) || offset < 0) {
    return "waiting";
  }
  return offset >= durationMs ? "ended" : "live";
}

export type JoinRefusal = "not_started" | "ended" | "late";

/**
 * Se o aluno pode abrir a sala gravada agora: antes da janela de espera, nao; depois do fim, nao; com Entrada
 * atrasada marcada pela equipe, so ate aquele minuto.
 */
export function canJoinSimulated(
  session: SessionClock & Pick<WebinarSession, "lateJoinMinutes" | "status">,
  durationMs: number,
  nowMs: number
): { ok: true } | { ok: false; reason: JoinRefusal } {
  if (session.status === "ended" || session.status === "cancelled") {
    return { ok: false, reason: "ended" };
  }
  const offset = sessionOffsetMs(session, nowMs);
  if (!Number.isFinite(offset) || offset < -ROOM_OPENS_MINUTES_BEFORE * 60_000) {
    return { ok: false, reason: "not_started" };
  }
  if (offset >= durationMs) {
    return { ok: false, reason: "ended" };
  }
  if (session.lateJoinMinutes != null && offset > session.lateJoinMinutes * 60_000) {
    return { ok: false, reason: "late" };
  }
  return { ok: true };
}

export type ChatWindow = { fromMs: number; toMs: number };

/** A primeira janela de quem acabou de entrar: um pouco do que ja passou e a janela a frente. */
export function initialChatWindow(offsetMs: number): ChatWindow {
  const from = Math.max(CHAT_LIMITS.offsetMinMs, Math.floor(offsetMs) - CHAT_BACKLOG_SECONDS * 1000);
  return { fromMs: from, toMs: Math.floor(offsetMs) + ROOM_RULES.chatWindowSeconds * 1000 };
}

/** A janela seguinte comeca onde a anterior parou (nenhuma linha repetida, nenhuma pulada). */
export function nextChatWindow(previous: ChatWindow): ChatWindow {
  return { fromMs: previous.toMs + 1, toMs: previous.toMs + ROOM_RULES.chatWindowSeconds * 1000 };
}

/** A janela que o replay pede ao pular para um ponto do video (o que ja passou nao e a mesma coisa que no ao vivo). */
export function seekChatWindow(offsetMs: number): ChatWindow {
  return initialChatWindow(offsetMs);
}

/** A janela pedida pela rota e valida quando cabe nos limites e nao passa de 15 minutos. */
export function isValidChatWindow(window: ChatWindow): boolean {
  return (
    Number.isInteger(window.fromMs) &&
    Number.isInteger(window.toMs) &&
    window.fromMs >= CHAT_LIMITS.offsetMinMs &&
    window.toMs <= CHAT_LIMITS.offsetMaxMs &&
    window.toMs >= window.fromMs &&
    window.toMs - window.fromMs <= 15 * 60_000
  );
}

/** Quais linhas da janela ja podem aparecer (o player passou pelo segundo delas). */
export function visibleMessages<T extends { offsetMs: number }>(messages: readonly T[], playerOffsetMs: number): T[] {
  return messages.filter((message) => message.offsetMs <= playerOffsetMs);
}

/** skew = hora do servidor − hora do aparelho, corrigido por metade da ida e volta (docs/30 §6.6). */
export function clockSkewMs(input: { requestSentAtMs: number; responseReceivedAtMs: number; serverTimeMs: number }): number {
  const roundTrip = Math.max(0, input.responseReceivedAtMs - input.requestSentAtMs);
  return input.serverTimeMs - (input.requestSentAtMs + roundTrip / 2);
}

/** O segundo do video em que o player deveria estar agora. */
export function playerTargetSeconds(input: { deviceNowMs: number; skewMs: number; zeroMs: number }): number {
  return (input.deviceNowMs + input.skewMs - input.zeroMs) / 1000;
}

/** O player e recolocado quando atrasa ou adianta mais que a tolerancia (2 s). */
export function needsResync(currentSeconds: number, targetSeconds: number, toleranceSeconds: number = ROOM_RULES.resyncToleranceSeconds): boolean {
  if (!Number.isFinite(currentSeconds) || !Number.isFinite(targetSeconds)) {
    return false;
  }
  return Math.abs(currentSeconds - targetSeconds) > toleranceSeconds;
}

/** O balde de 30 s de um segundo do video (negativo na espera). */
export function presenceBucket(offsetSeconds: number): number {
  return Math.floor(offsetSeconds / ROOM_RULES.bucketSeconds);
}

export function bucketCount(durationMs: number): number {
  return Math.max(1, Math.ceil(durationMs / (ROOM_RULES.bucketSeconds * 1000)));
}

/** "Ate o fim" (M2): chegou a 95 % dos baldes. A mesma conta de webinar_close_session. */
export function reachedEnd(maxBucket: number, durationMs: number): boolean {
  return maxBucket + 1 >= Math.ceil(bucketCount(durationMs) * ROOM_RULES.reachedEndRatio);
}

/** Depois de 3 baldes sem sinal (90 s), a pessoa saiu (M1). */
export function isStillPresent(lastSeenBucket: number, currentBucket: number): boolean {
  return currentBucket - lastSeenBucket < ROOM_RULES.leaveAfterBuckets;
}

/** Numero estavel por aluno e webinario para "Aluno {n}" (D10): nunca o id, nunca a ordem de chegada. */
export function anonymousNumber(userId: string, webinarId: string): number {
  let hash = 2166136261;
  const text = `${userId}:${webinarId}`;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return 100 + (hash % 900);
}

/** "Ana M." a partir do nome completo; um nome so fica como esta; vazio vira "Aluno". */
export function firstNameInitial(fullName: string | null | undefined): string {
  const parts = (fullName ?? "")
    .trim()
    .split(/\s+/)
    .filter((part) => part && !/^(da|de|do|das|dos|e)$/i.test(part));
  if (parts.length === 0) {
    return "Aluno";
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** O nome que aparece no chat, pela escolha do aluno no aceite (D10). */
export function displayNameFor(input: { anonymousNumber: number; fullName: string | null | undefined; mode: DisplayNameMode; nickname: string | null | undefined }): string {
  if (input.mode === "anonymous") {
    return `Aluno ${input.anonymousNumber}`;
  }
  if (input.mode === "nickname") {
    const nickname = (input.nickname ?? "").trim();
    if (nickname.length >= CHAT_LIMITS.nicknameMin) {
      return nickname.slice(0, CHAT_LIMITS.nicknameMax);
    }
  }
  return firstNameInitial(input.fullName).slice(0, CHAT_LIMITS.displayName);
}

/**
 * O que o aluno recebe de uma mensagem (docs/30 §5.1): `scripted` vai com o papel da persona (ja gravado em
 * `role`), a origem fica so no banco; `ai` continua `ai` (selo Assistente); as pendentes so do proprio autor.
 */
export function toStudentMessage(message: ChatMessage, viewerUserId: string | null, offsetMs: number = message.offsetMs): StudentChatMessage {
  return {
    body: message.body,
    displayName: message.displayName,
    id: message.id,
    kind: message.kind,
    mine: Boolean(viewerUserId) && message.authorUserId === viewerUserId,
    offsetMs,
    pending: !message.approved,
    pinned: message.pinnedAt != null,
    replyToId: message.replyToId,
    role: message.role
  };
}

/** "1:02:03", "12:30" ou "-0:30" para um offset em ms. */
export function offsetLabel(offsetMs: number): string {
  const negative = offsetMs < 0;
  const total = Math.floor(Math.abs(offsetMs) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  const text = hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
  return negative ? `-${text}` : text;
}

export type BunnyEmbedRef = { libraryId: string; videoId: string };

/** "https://iframe.mediadelivery.net/embed/{biblioteca}/{video}" (ou player.mediadelivery.net), ou nulo. */
export function parseBunnyEmbed(url: string | null | undefined): BunnyEmbedRef | null {
  if (!url) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !["iframe.mediadelivery.net", "player.mediadelivery.net"].includes(parsed.hostname)) {
    return null;
  }
  const match = /^\/(?:embed|play)\/(\d{1,12})\/([0-9a-f-]{8,80})\/?$/i.exec(parsed.pathname);
  return match ? { libraryId: match[1], videoId: match[2].toLowerCase() } : null;
}

export type BunnyEmbedOptions = {
  autoplay?: boolean;
  /** Token de visualizacao (SHA-256 de chave + video + expires, feito no servidor) e o fim dele, em segundos. */
  expires?: number | null;
  muted?: boolean;
  /** Barra e controles do player: a sessao gravada esconde (travada no relogio); o replay mostra. */
  showControls?: boolean;
  startSeconds?: number | null;
  token?: string | null;
};

/** O endereco do iframe da Bunny com os parametros da sala (autoplay sem som, posicao inicial, token). */
export function bunnyEmbedUrl(ref: BunnyEmbedRef, options: BunnyEmbedOptions = {}): string {
  const url = new URL(`https://iframe.mediadelivery.net/embed/${encodeURIComponent(ref.libraryId)}/${encodeURIComponent(ref.videoId)}`);
  url.searchParams.set("autoplay", options.autoplay === false ? "false" : "true");
  url.searchParams.set("muted", options.muted === false ? "false" : "true");
  url.searchParams.set("preload", "true");
  url.searchParams.set("responsive", "true");
  if (options.showControls === false) {
    url.searchParams.set("controls", "false");
  }
  if (options.startSeconds != null && Number.isFinite(options.startSeconds) && options.startSeconds > 0) {
    url.searchParams.set("t", String(Math.floor(options.startSeconds)));
  }
  if (options.token && options.expires) {
    url.searchParams.set("token", options.token);
    url.searchParams.set("expires", String(Math.floor(options.expires)));
  }
  return url.toString();
}

/** O texto cujo SHA-256 (hex) e o token de visualizacao da Bunny: chave + id do video + expires. */
export function bunnyEmbedTokenInput(tokenKey: string, videoId: string, expires: number): string {
  return `${tokenKey}${videoId}${Math.floor(expires)}`;
}

/**
 * A frase da decisao do produtor (docs/30 §8.6), gravada em webinar_sessions.simulation_ack_text exatamente como
 * foi mostrada e marcada. `date` no formato DD/MM/AAAA (Sao Paulo).
 */
export function simulationAckSentence(input: { badgeOn: boolean; date: string; numbersSimulated: boolean; responsible: string }): string {
  return (
    `Decisão do produtor em ${input.date}: nesta sessão gravada, dentro da área de membros, o selo "Ao vivo" ` +
    `${input.badgeOn ? "fica ligado" : "fica desligado"} e os números de plateia ${input.numbersSimulated ? "são simulados" : "são reais"}. ` +
    `Fora da área de membros, esta sessão nunca é anunciada como ao vivo. Responsável: ${input.responsible.trim() || "—"}.`
  );
}
