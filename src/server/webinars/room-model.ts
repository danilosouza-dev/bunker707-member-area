// A sala da Live gravada e do Replay, a parte pura (docs/30 §1.6, §5.1, §6.5 e §6.6): o relogio do servidor e o
// alvo do player, as fases da sessao gravada, a janela do chat por offset, o nome exibido (D10), os baldes de
// presenca (M1, M2) e o endereco do player da Bunny. Sem "server-only", imports relativos: tests/webinarios-*.test.mjs
// carregam direto pelo Node. Nada aqui le o banco nem o relogio de verdade: tudo recebe `nowMs`.

import { CHAT_LIMITS, ROOM_RULES, toTime, type ChatMessage, type ChatSource, type SessionKind, type SimulatedPhase, type StudentChatMessage, type WebinarSession } from "./model";
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

/**
 * Numero estavel por aluno e webinario para "Aluno {n}" (D10): nunca o id, nunca a ordem de chegada. Legado: linhas de
 * antes de 10/11/2026 (D64). Ninguem mais escreve como anonimo; a conta fica so para reconhecer e mostrar o que ja foi
 * gravado assim (a foto que nao aparece, o CSV de perguntas, o "Liberar" da equipe).
 */
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

/**
 * O nome da equipe no que ela escreve pelo console (a mensagem, a resposta da pergunta e a do fio) e nas iniciais do
 * avatar do campo dela no console (D82): o primeiro nome com a inicial do sobrenome, no tamanho do nome do chat;
 * "Equipe" sem nome.
 */
export function teamAuthorName(fullName: string | null | undefined): string {
  return firstNameInitial(fullName).slice(0, CHAT_LIMITS.displayName) || "Equipe";
}

/**
 * "Aluno 123": o nome de quem participava como anonimo neste webinario (D10). Legado: linhas de antes de 10/11/2026
 * (D64); nenhuma escrita nova usa este nome.
 */
export function anonymousDisplayName(userId: string, webinarId: string): string {
  return `Aluno ${anonymousNumber(userId, webinarId)}`;
}

/** O que se sabe de quem escreveu, para a foto: a foto do perfil e se o aceite do chat esta em dia (author-photos.ts). */
export type AuthorPhoto = { avatarUrl: string | null; consentCurrent: boolean };

/**
 * A foto do perfil que acompanha o que a pessoa escreveu na sala (docs/30 §8.5, aceite versao 2, decisao do produtor de
 * 10/11/2026): a da equipe sempre (e quem apresenta a live); a do aluno so com o aceite em dia (o texto da versao 2 diz
 * que a foto aparece para os outros alunos; quem aceitou a versao 1, ou aceitou com um modo antigo, fica com as
 * iniciais ate aceitar de novo) e nunca no que foi escrito como anonimo (a pergunta Anonima, ou o nome "Aluno {n}" de
 * quem participava como anonimo: a foto diria quem e). A equipe, no console, ve a foto do aluno sem depender do aceite
 * (ela ja ve o perfil no admin), mas nunca no anonimo. O Assistente nao tem pessoa. Sem foto, nulo: a tela desenha as
 * iniciais. Legado: desde 10/11/2026 (D64) nada novo e escrito como anonimo; a parte do anonimo vale para as linhas de
 * antes, que continuam com a promessa da epoca. O roteiro (adendo de 10/11/2026, R9, que muda o D62 so nisto): a
 * mensagem `scripted` mostra a foto de quem comenta quando a equipe pos uma (`personaAvatarUrl`, montada pela origem do
 * nosso Supabase); sem ela, as iniciais, para a turma e para a equipe.
 */
export function authorPhotoUrl(input: {
  /** A pergunta marcada como Anonima (legado: linhas de antes de 10/11/2026). */
  anonymous?: boolean;
  authorUserId: string | null;
  displayName: string;
  /** A foto de quem comenta da mensagem `scripted` (R9; persona-model.personaAvatarUrl). */
  personaAvatarUrl?: string | null;
  photo: AuthorPhoto | null | undefined;
  source: ChatSource;
  viewer: "student" | "team";
  webinarId: string;
}): string | null {
  if (input.source === "scripted") {
    return input.personaAvatarUrl ?? null;
  }
  const url = input.photo?.avatarUrl ?? null;
  if (!url || !input.authorUserId || input.anonymous) {
    return null;
  }
  if (input.source === "team") {
    return url;
  }
  // `original` e a mensagem de aluno que a equipe levou para as proximas turmas: a mesma regra do aluno.
  if ((input.source !== "audience" && input.source !== "original") || input.displayName === anonymousDisplayName(input.authorUserId, input.webinarId)) {
    return null;
  }
  return input.viewer === "team" || input.photo?.consentCurrent ? url : null;
}

/**
 * O nome do aluno no chat, nas Perguntas, no motor da live e no console (D64, 10/11/2026): sempre o primeiro nome com
 * a inicial do sobrenome. Nao ha mais apelido nem "Aluno {n}", qualquer que seja o aceite gravado ou o card Sala.
 */
export function displayNameFor(input: { fullName: string | null | undefined }): string {
  return firstNameInitial(input.fullName).slice(0, CHAT_LIMITS.displayName);
}

/** Os papeis da equipe e as origens da equipe: so a mensagem que junta os dois tem link (especificacao "Na tela", §8.1). */
const LINK_ROLES: readonly ChatMessage["role"][] = ["host", "co_host", "team"];
const LINK_SOURCES: readonly ChatSource[] = ["team", "scripted"];

/**
 * Se os enderecos `https://` da mensagem viram link para o aluno: papel Apresentador, Co-apresentador ou Equipe E
 * origem equipe (o console) ou roteiro (a fala de um personagem da equipe). O aluno, o personagem de aluno do roteiro e
 * o Assistente nunca: ninguem espalha link de golpe pelo chat.
 */
export function messageHasLinks(message: Pick<ChatMessage, "role" | "source">): boolean {
  return LINK_ROLES.includes(message.role) && LINK_SOURCES.includes(message.source);
}

/**
 * A mensagem do roteiro de Tipo Pergunta (11/11/2026, docs/30 D77): o registro de que o item Pergunta entrou na sessao
 * (a chave unica do roteiro, o "Já entrou" do console e o bloco Simulacao do relatorio), ligado a pergunta simulada que
 * ele abre na aba Perguntas. Nunca aparece no chat, nem da turma nem do console: a pergunta aparece so na aba, como a
 * pergunta de um aluno.
 */
export function isScriptedQuestionMessage(message: Pick<ChatMessage, "kind" | "source">): boolean {
  return message.source === "scripted" && message.kind === "question";
}

/**
 * O que o aluno recebe de uma mensagem (docs/30 §5.1): `scripted` vai com o papel da persona (ja gravado em
 * `role`), a origem fica so no banco; `ai` continua `ai` (selo Assistente); as pendentes so do proprio autor. A hora
 * em que foi gravada (`sentAt`) so na sessao `live` (docs/31 V2-9): na gravada e no Replay, a linha mestre diria a
 * data da live de origem. `links` pela regra de messageHasLinks.
 */
export function toStudentMessage(
  message: ChatMessage,
  viewerUserId: string | null,
  sessionKind: SessionKind,
  offsetMs: number = message.offsetMs,
  /** A foto de quem escreveu (authorPhotoUrl), quando ela pode aparecer; sem ela, as iniciais. */
  avatarUrl: string | null = null
): StudentChatMessage {
  return {
    avatarUrl,
    body: message.body,
    displayName: message.displayName,
    id: message.id,
    kind: message.kind,
    links: messageHasLinks(message),
    mine: Boolean(viewerUserId) && message.authorUserId === viewerUserId,
    offsetMs,
    pending: !message.approved,
    pinned: message.pinnedAt != null,
    replyToId: message.replyToId,
    role: message.role,
    sentAt: sessionKind === "live" ? message.createdAt : null
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
