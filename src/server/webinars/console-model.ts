// O console da sessao e os cards da fase 2b do editor, a parte pura (docs/30 §2.2 "Roteiro de chat" e "Simulacao",
// §2.4, §6.6 D6-c, §8.6): a fase que a equipe ve, o que pode abrir e encerrar, a fila do roteiro com o que ja
// entrou, as contagens das enquetes, a ordem do quadro de perguntas, a sessao que o console abre por padrao e a
// frase da decisao do selo (montada e conferida do mesmo jeito no navegador e no servidor). Sem "server-only",
// imports relativos: tests/webinarios-console-modelo.test.mjs carrega direto pelo Node. Nada aqui le o relogio:
// tudo recebe `nowMs`.

import { chatRoleLabel, chatTimeAt, chatTimeLabel, roleBadgeOnly } from "../../lib/webinar-room-client";
import { WEBINAR_COPY } from "../../lib/webinar-copy";
import { saoPauloDate } from "../../lib/webinar-time";
import { WEBINAR_ADMIN_COPY } from "./editor-model";
import {
  SLOW_MODE_SECONDS,
  toTime,
  type ChatMessage,
  type ChatMode,
  type Poll,
  type PollAnswer,
  type ScriptItem,
  type SessionStatus,
  type SlowModeSeconds,
  type WebinarQuestion,
  type WebinarSession
} from "./model";
import type { ConsolePresence } from "./console-presence-model";
import type { LiveConsoleSnapshot } from "./live-console-model";
import { sessionOffsetMs, simulatedPhase, simulationAckSentence } from "./room-model";
import { scriptOffsetOf, sortScriptItems } from "./script-model";

/** De quanto em quanto tempo o console busca o chat, as enquetes e as perguntas (docs/30 §6.6: 5 s). */
export const CONSOLE_POLL_MS = 5_000;

/** A fase que o console mostra no topo (a situacao gravada mais o relogio da sessao gravada). */
export const CONSOLE_PHASES = ["scheduled", "waiting", "live", "ended", "cancelled", "replay"] as const;
export type ConsolePhase = (typeof CONSOLE_PHASES)[number];

/**
 * A fase da sessao para a equipe: cancelada e encerrada pela situacao; o replay e sempre "disponivel"; a gravada
 * segue o relogio (na espera antes da hora, no ar enquanto o video roda, encerrada depois do fim); a live ao vivo
 * segue a situacao gravada (a fase 3 abre e encerra pela mao do apresentador).
 */
export function consolePhaseOf(session: Pick<WebinarSession, "kind" | "recordingAnchorAt" | "scheduledAt" | "startedAt" | "status">, durationMs: number, nowMs: number): ConsolePhase {
  if (session.status === "cancelled") {
    return "cancelled";
  }
  if (session.kind === "replay") {
    return session.status === "ended" ? "ended" : "replay";
  }
  if (session.status === "ended") {
    return "ended";
  }
  if (session.kind === "simulated") {
    const phase = simulatedPhase(session, durationMs, nowMs);
    if (phase === "waiting" && session.status === "scheduled" && nowMs < toTime(session.scheduledAt) - 15 * 60_000) {
      return "scheduled";
    }
    return phase;
  }
  if (session.status === "live") {
    return "live";
  }
  return session.status === "waiting" ? "waiting" : "scheduled";
}

/** "Abrir sessao" so antes de ela estar no ar; "Encerrar sessao" so com ela na espera ou no ar (docs/30 §2.3). */
export function canOpenSession(status: SessionStatus): boolean {
  return status === "scheduled" || status === "waiting";
}

export function canEndSession(status: SessionStatus): boolean {
  return status === "waiting" || status === "live";
}

/** A equipe escreve, modera e solta o roteiro enquanto a sessao nao acabou (e nunca no replay, que nao tem relogio). */
export function canTeamActOn(session: Pick<WebinarSession, "kind" | "status">): boolean {
  return session.kind !== "replay" && session.status !== "ended" && session.status !== "cancelled";
}

/**
 * Qual sessao o console abre: a pedida (?sessao=), senao a que esta rodando (no ar ou na espera), senao a proxima
 * marcada, senao a ultima que houve. O replay nunca e escolhido sozinho.
 */
export function pickConsoleSession<T extends Pick<WebinarSession, "id" | "kind" | "scheduledAt" | "status">>(sessions: readonly T[], requestedId: string | null, nowMs: number): T | null {
  const requested = requestedId ? sessions.find((session) => session.id === requestedId) : null;
  if (requested) {
    return requested;
  }
  const real = sessions.filter((session) => session.kind !== "replay" && session.status !== "cancelled");
  const running = real.find((session) => session.status === "live" || session.status === "waiting");
  if (running) {
    return running;
  }
  const upcoming = real
    .filter((session) => session.status === "scheduled" && toTime(session.scheduledAt) >= nowMs - 15 * 60_000)
    .sort((a, b) => toTime(a.scheduledAt) - toTime(b.scheduledAt));
  if (upcoming[0]) {
    return upcoming[0];
  }
  const latest = [...real].sort((a, b) => toTime(b.scheduledAt) - toTime(a.scheduledAt));
  return latest[0] ?? sessions[0] ?? null;
}

/* ------------------------------------------------------------------------------------------------
 * Roteiro no console (D6-c: Soltar agora)
 * ---------------------------------------------------------------------------------------------- */

export type ScriptQueueItem = ScriptItem & {
  /** O minuto em que o item entra sozinho (nulo no manual e na frase nao achada). */
  dueOffsetMs: number | null;
  /** Ja entrou nesta sessao (pela abertura ou pelo botao). */
  fired: boolean;
  firedAt: string | null;
  /** O minuto do item ja passou no relogio da sessao (entrou ou deveria ter entrado). */
  passed: boolean;
};

/** A fila do roteiro para uma sessao: na ordem do minuto, com o que ja entrou marcado (firedAt por item). */
export function scriptQueue(items: readonly ScriptItem[], firedAt: ReadonlyMap<string, string | null> | Record<string, string | null>, currentOffsetMs: number): ScriptQueueItem[] {
  const lookup = firedAt instanceof Map ? firedAt : new Map(Object.entries(firedAt));
  return sortScriptItems(items).map((item) => {
    const dueOffsetMs = scriptOffsetOf(item);
    const fired = lookup.has(item.id);
    return {
      ...item,
      dueOffsetMs,
      fired,
      firedAt: lookup.get(item.id) ?? null,
      passed: fired || (dueOffsetMs != null && Number.isFinite(currentOffsetMs) && dueOffsetMs <= currentOffsetMs)
    };
  });
}

/** Quantos itens ja entraram e quantos ainda vem (os manuais contam como "pelo botao"). */
export function scriptQueueSummary(queue: readonly ScriptQueueItem[]): { fired: number; manual: number; pending: number } {
  return queue.reduce(
    (summary, item) => {
      if (item.fired) {
        summary.fired += 1;
      } else if (item.triggerKind === "manual") {
        summary.manual += 1;
      } else if (item.status !== "disabled") {
        summary.pending += 1;
      }
      return summary;
    },
    { fired: 0, manual: 0, pending: 0 }
  );
}

/* ------------------------------------------------------------------------------------------------
 * Enquetes e perguntas
 * ---------------------------------------------------------------------------------------------- */

export type PollCounts = { answers: number; byOption: Record<string, number> };

/** Quantos responderam e quantos marcaram cada opcao (uma resposta pode marcar varias na multipla). */
export function countPollAnswers(poll: Pick<Poll, "options">, answers: readonly Pick<PollAnswer, "optionIds">[]): PollCounts {
  const byOption: Record<string, number> = {};
  for (const option of poll.options) {
    byOption[option.id] = 0;
  }
  for (const answer of answers) {
    for (const optionId of answer.optionIds) {
      if (optionId in byOption) {
        byOption[optionId] += 1;
      }
    }
  }
  return { answers: answers.length, byOption };
}

export function pollPercent(counts: PollCounts, optionId: string): number {
  if (counts.answers === 0) {
    return 0;
  }
  return Math.round(((counts.byOption[optionId] ?? 0) / counts.answers) * 100);
}

const QUESTION_ORDER: Record<WebinarQuestion["status"], number> = { answered: 1, dismissed: 2, open: 0 };

/** O quadro: as abertas primeiro (mais votadas, depois as mais antigas), as respondidas, as dispensadas. */
export function sortQuestionsForBoard<T extends Pick<WebinarQuestion, "createdAt" | "status" | "upvotes">>(questions: readonly T[]): T[] {
  return [...questions].sort((a, b) => {
    const byStatus = QUESTION_ORDER[a.status] - QUESTION_ORDER[b.status];
    if (byStatus !== 0) {
      return byStatus;
    }
    if (b.upvotes !== a.upvotes) {
      return b.upvotes - a.upvotes;
    }
    return toTime(a.createdAt) - toTime(b.createdAt);
  });
}

/* ------------------------------------------------------------------------------------------------
 * Chat da equipe
 * ---------------------------------------------------------------------------------------------- */

export type ConsoleMessage = ChatMessage & {
  /** Mensagem da turma cujo autor ainda tem o aceite valendo: pode virar linha mestre (promote). */
  promotable: boolean;
};

export type MessageActions = { approve: boolean; delete: boolean; pin: boolean; promote: boolean; question: boolean; unpin: boolean };

/**
 * A mensagem que a equipe pode transformar em pergunta (docs/31 V2-15): so a mensagem comum de um aluno da turma (a
 * pergunta pede o aluno, `webinar_questions.user_id`). A pergunta que o aluno fez pelo chat moderado fica de fora: o
 * Liberar ja a abre.
 */
export function turnsIntoQuestion(message: Pick<ChatMessage, "authorUserId" | "kind" | "source">): boolean {
  return message.kind === "message" && message.source === "audience" && Boolean(message.authorUserId);
}

/**
 * As mensagens do retrato que o console confere na tabela das perguntas (o `askedMessageIds` do retrato): so as que
 * podem virar pergunta, sem repetir.
 */
export function askableMessageIds(messages: readonly Pick<ChatMessage, "authorUserId" | "id" | "kind" | "source">[]): string[] {
  return Array.from(new Set(messages.filter(turnsIntoQuestion).map((message) => message.id)));
}

/**
 * O que a mesa pode fazer com uma mensagem (docs/30 §2.4 e §5.2; docs/31 V2-15). Virar pergunta so para a mensagem
 * que `turnsIntoQuestion` aceita e que ainda nao virou pergunta (`hasQuestion`: o id dela no `askedMessageIds` do
 * retrato, que conta tambem a pergunta apagada, como o servidor confere).
 */
export function messageActions(message: ConsoleMessage, pinnedMessageId: string | null, { hasQuestion = false }: { hasQuestion?: boolean } = {}): MessageActions {
  const pinned = pinnedMessageId === message.id;
  return {
    approve: !message.approved,
    delete: true,
    pin: !pinned && message.approved,
    promote: message.source === "audience" && !message.master && message.approved && message.promotable,
    question: turnsIntoQuestion(message) && !hasQuestion,
    unpin: pinned
  };
}

/**
 * O chat do console em duas partes (docs/31 V2-15): as pendentes do chat moderado saem da lista e viram a fila dos cards
 * da moderacao, da mais velha para a mais nova (pela hora gravada; sem hora, na ordem em que chegaram, depois das
 * outras); a lista fica so com as liberadas, na ordem do retrato.
 */
export function consoleChatQueue<T extends Pick<ChatMessage, "approved" | "createdAt">>(messages: readonly T[]): { log: T[]; pending: T[] } {
  const log: T[] = [];
  const waiting: { at: number; index: number; message: T }[] = [];
  messages.forEach((message, index) => {
    if (message.approved) {
      log.push(message);
      return;
    }
    const at = Date.parse(message.createdAt);
    waiting.push({ at: Number.isFinite(at) ? at : Number.POSITIVE_INFINITY, index, message });
  });
  waiting.sort((a, b) => (a.at === b.at ? a.index - b.index : a.at < b.at ? -1 : 1));
  return { log, pending: waiting.map((entry) => entry.message) };
}

export type ConsoleMessageMeta = {
  /** De onde veio, so para a equipe: Roteiro ou Chat original (a turma nunca ve). */
  origin: string | null;
  /** O papel na linha de baixo: Apresentador, Co-apresentador, Equipe ou Assistente; o aluno, nenhum; com a origem, nenhum. */
  role: string | null;
  /** A hora em Sao Paulo ("20:42"): na live a gravada, na gravada a hora marcada mais o offset, no Replay nenhuma. */
  time: string;
};

/**
 * A linha de baixo do balao no console (docs/31 V2-9): "{nome} · {papel ou origem} · {hora}". A origem, que so a
 * equipe ve (Roteiro, Chat original), fica no lugar do papel: a persona do roteiro com o papel de quem apresenta sai
 * "Roteiro", como o console de antes dizia. Sem origem, o papel como a sala mostra (chatRoleLabel). A hora pelo
 * chatTimeLabel, com o `createdAt` da live e a hora marcada da gravada.
 */
export function consoleMessageMeta(input: { kind: WebinarSession["kind"]; message: Pick<ChatMessage, "createdAt" | "offsetMs" | "role" | "source">; scheduledAt: string }): ConsoleMessageMeta {
  const { message } = input;
  const sources = WEBINAR_ADMIN_COPY.console.chat.sources;
  const origin = message.source === "scripted" ? sources.scripted : message.source === "original" ? sources.original : null;
  const role = origin ? null : chatRoleLabel(message.role);
  const zeroMs = Date.parse(input.scheduledAt);
  const time = chatTimeLabel({ kind: input.kind, offsetMs: message.offsetMs, sentAt: message.createdAt, zeroMs: Number.isFinite(zeroMs) ? zeroMs : null });
  return { origin, role, time };
}

/** O avatar do comentario no console (o RoomCommentAvatar da sala). */
export type ConsoleCommentAvatar = "assistant" | "person" | "team";

/** O que o comentario do YouTube do console precisa da mensagem (docs/31 §10): o autor, o selo, o avatar e a hora. */
export type ConsoleComment = {
  avatar: ConsoleCommentAvatar;
  /** "Você" na minha; o nome de exibicao nas outras. */
  name: string;
  /** O selo tonal: a origem (Roteiro, Chat original, so para a equipe) ou o papel; nulo para o aluno. */
  role: string | null;
  /** O que o leitor de tela ouve antes do texto ("Ana M., 20:42: "). */
  srAuthor: string;
  /** A hora do comentario (a mesma do consoleMessageMeta, com o instante para o <time>); nula no Replay. */
  time: { iso: string; label: string; title: string } | null;
};

/**
 * O comentario do YouTube no chat do console (docs/31 §10, no lugar do balao do V2-9): a mesma linha do autor da sala
 * (o nome sem arroba, o selo tonal e a hora), com a origem no lugar do papel e "Você" na minha. Com o nome igual ao
 * selo (o Assistente), so o selo. A hora continua a do relogio (20:42), nao o tempo relativo da sala: quem modera
 * compara a mensagem com o momento da live.
 */
export function consoleComment(input: {
  kind: WebinarSession["kind"];
  message: Pick<ChatMessage, "createdAt" | "displayName" | "offsetMs" | "role" | "source">;
  mine: boolean;
  scheduledAt: string;
}): ConsoleComment {
  const meta = consoleMessageMeta(input);
  const role = meta.origin ?? meta.role;
  const name = input.mine ? WEBINAR_COPY.salaV2.chat.voce : input.message.displayName;
  const badgeOnly = roleBadgeOnly(name, role);
  const zeroMs = Date.parse(input.scheduledAt);
  const at = chatTimeAt({ kind: input.kind, offsetMs: input.message.offsetMs, sentAt: input.message.createdAt, zeroMs: Number.isFinite(zeroMs) ? zeroMs : null });
  const time = meta.time && at !== null ? { iso: new Date(at).toISOString(), label: meta.time, title: meta.time } : null;
  const parts = (badgeOnly ? [role, meta.time] : [name, role, meta.time]).filter((part): part is string => Boolean(part));
  const avatar: ConsoleCommentAvatar = input.message.role === "ai" ? "assistant" : badgeOnly && input.message.role === "team" ? "team" : "person";
  return { avatar, name, role, srAuthor: WEBINAR_COPY.salaV2.chat.autor(parts), time };
}

/** De onde saiu uma acao do chat do console: o card da fila ou o balao da lista, a posicao dele e a do botao no item. */
export type ConsoleChatFocusFrom = { area: "log" | "queue"; id: string; index: number; position: number };

/**
 * Para onde o foco vai: um botao de um item (pela posicao, presa ao ultimo botao do item), o primeiro seletor do
 * cabecalho, a caixa da equipe ou o campo da correcao aberta.
 */
export type ConsoleChatFocusTo = { area: "log" | "queue"; id: string; position: number } | { area: "composer" } | { area: "edit"; id: string } | { area: "header" };

/**
 * O foco depois de uma acao que pode tirar o botao da tela (WCAG 2.4.3): o Liberar e o Recusar tiram o card da fila, o
 * Virar pergunta some da linha quando a pergunta chega, o Apagar tira o balao. Com o item ainda na mesma parte, o botao
 * da mesma posicao (o seguinte, quando o clicado saiu; o mesmo, quando a acao falhou). Sem ele, o item que ficou no
 * lugar dele (o seguinte; o anterior, quando era o ultimo), no primeiro botao. Com a parte vazia, a fila devolve o foco
 * ao cabecalho e a lista, a caixa da equipe. `now` sao os ids de cada parte depois da acao.
 */
export function consoleChatFocusAfter(from: ConsoleChatFocusFrom, now: { log: readonly string[]; pending: readonly string[] }): ConsoleChatFocusTo {
  const ids = from.area === "queue" ? now.pending : now.log;
  if (ids.includes(from.id)) {
    return { area: from.area, id: from.id, position: from.position };
  }
  if (ids.length > 0) {
    return { area: from.area, id: ids[Math.min(Math.max(from.index, 0), ids.length - 1)], position: 0 };
  }
  return from.area === "queue" ? { area: "header" } : { area: "composer" };
}

export const CHAT_MODE_OPTIONS: readonly { label: string; value: ChatMode }[] = [
  { label: WEBINAR_ADMIN_COPY.fields.chatModes.open, value: "open" },
  { label: WEBINAR_ADMIN_COPY.fields.chatModes.moderated, value: "moderated" },
  { label: WEBINAR_ADMIN_COPY.fields.chatModes.team_only, value: "team_only" },
  { label: WEBINAR_ADMIN_COPY.fields.chatModes.off, value: "off" }
];

export type SlowModeChoice = "off" | `${SlowModeSeconds}`;

export const SLOW_MODE_CHOICES: readonly { label: string; value: SlowModeChoice }[] = [
  { label: WEBINAR_ADMIN_COPY.fields.slowModes.off, value: "off" },
  ...SLOW_MODE_SECONDS.map((seconds) => ({ label: WEBINAR_ADMIN_COPY.fields.slowModes[seconds], value: `${seconds}` as SlowModeChoice }))
];

export function slowModeFromChoice(choice: SlowModeChoice): SlowModeSeconds | null {
  if (choice === "off") {
    return null;
  }
  const seconds = Number(choice);
  return (SLOW_MODE_SECONDS as readonly number[]).includes(seconds) ? (seconds as SlowModeSeconds) : null;
}

export function slowModeChoiceOf(seconds: SlowModeSeconds | null): SlowModeChoice {
  return seconds === null ? "off" : (`${seconds}` as SlowModeChoice);
}

/* ------------------------------------------------------------------------------------------------
 * A decisao do selo "Ao vivo" (D10, §8.6)
 * ---------------------------------------------------------------------------------------------- */

/** Texto comparavel: NFC, aspas retas, um espaco so, sem espacos nas pontas. */
export function normalizeAckText(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/** A frase de §8.6 para hoje (Sao Paulo) com o nome de quem decide; na fase 2 os numeros de plateia sao reais. */
export function consoleAckSentence(input: { badgeOn: boolean; nowMs: number; responsible: string }): string {
  return simulationAckSentence({ badgeOn: input.badgeOn, date: saoPauloDate(new Date(input.nowMs).toISOString()), numbersSimulated: false, responsible: input.responsible });
}

/**
 * A frase marcada e a mesma que o servidor montaria agora? Aceita a de hoje e a de ontem (a tela aberta antes da
 * meia-noite), com os espacos e as aspas normalizados. Qualquer outra diferenca (nome, selo, numeros) recusa.
 */
export function ackSentenceMatches(input: { ackText: string | null | undefined; badgeOn: boolean; nowMs: number; responsible: string }): boolean {
  const given = normalizeAckText(input.ackText ?? "");
  if (!given) {
    return false;
  }
  return [input.nowMs, input.nowMs - 86_400_000].some((nowMs) => normalizeAckText(consoleAckSentence({ badgeOn: input.badgeOn, nowMs, responsible: input.responsible })) === given);
}

/* ------------------------------------------------------------------------------------------------
 * O retrato do console (o que a pagina desenha e a rota devolve a cada 5 s)
 * ---------------------------------------------------------------------------------------------- */

export type ConsolePollView = Poll & { counts: PollCounts };

export type ConsoleSnapshot = {
  /**
   * As mensagens do retrato que ja viraram pergunta (docs/31 V2-15), com a pergunta apagada ou nao e sem o teto da
   * lista `questions`: so as que `askableMessageIds` confere. A que esta aqui fica sem o Virar pergunta.
   */
  askedMessageIds: string[];
  /**
   * Fase 3: so na sessao `live` (gravador, gravacao, removidos/silenciados/banidos, o mapa aluno -> participante e se a
   * sala existe neste ambiente); nulo nas outras. Nunca o nome da sala nem token: o iframe pede o join-token.
   */
  live: LiveConsoleSnapshot | null;
  messages: ConsoleMessage[];
  pinnedMessageId: string | null;
  polls: { launched: ConsolePollView[]; templates: Poll[] };
  /**
   * O painel Presenca (docs/30 §2.4): pico, mensagens por minuto e a curva dos ultimos 30 minutos, da visao do
   * relatorio em cache de 60 s (console-presence-model.ts). Nulo no Replay, antes de comecar ou sem a leitura.
   */
  presence?: ConsolePresence | null;
  presentNow: number;
  questions: WebinarQuestion[];
  /** O minuto em que o item entrou nesta sessao (created_at da linha scripted), por id do item. */
  scriptFired: Record<string, string | null>;
  scriptItems: ScriptItem[];
  serverTime: string;
  session: WebinarSession;
};

/** A sessao como o console recebe: sem o nome da sala (so o join-token entrega, docs/30 §8.1). */
export function consoleSessionOf<T extends { roomName: string | null }>(session: T): T {
  return { ...session, roomName: null };
}

/**
 * O offset da sessao pelo relogio do console (a hora do servidor corrigida pelo skew do navegador), no relogio do
 * video (a ancora da gravacao na live): alimenta a fila do roteiro. Para no encerramento: depois do Encerrar, o
 * roteiro fica no minuto em que a sessao acabou.
 */
export function consoleOffsetMs(session: Pick<WebinarSession, "endedAt" | "kind" | "recordingAnchorAt" | "scheduledAt" | "startedAt">, deviceNowMs: number, skewMs: number): number {
  return sessionOffsetMs(session, untilEnded(session, deviceNowMs + skewMs));
}

/**
 * O tempo do rotulo do topo, em ms (negativo antes da hora; NaN quando nao ha o que mostrar). Nao e o relogio do
 * video: e o tempo que a sessao durou para a turma, e para no encerramento.
 * - Live ao vivo: desde o Iniciar live (startedAt, o mesmo zero da sala do aluno, da presenca e do relatorio; a
 *   ancora da gravacao so move o roteiro) ate agora ou ate o Encerrar live. Antes de comecar, so a contagem ate a
 *   hora marcada; na espera depois da hora, ou encerrada direto da espera, nada.
 * - Live gravada: desde a hora marcada ate agora ou ate o encerramento, nunca alem da duracao do video (passada a
 *   duracao a fase ja e encerrada; o tick fecha com atraso, as vezes horas depois). Encerrada antes da hora, nada.
 * - Replay: nada (cada aluno controla o proprio player).
 */
export function consoleClockMs(session: Pick<WebinarSession, "endedAt" | "kind" | "scheduledAt" | "startedAt" | "status">, durationMs: number, nowMs: number): number {
  if (session.kind === "replay") {
    return Number.NaN;
  }
  const until = untilEnded(session, nowMs);
  const finished = session.status === "ended" || Number.isFinite(toTime(session.endedAt));
  if (session.kind === "live") {
    const startedMs = toTime(session.startedAt);
    if (Number.isFinite(startedMs)) {
      return Math.max(0, until - startedMs);
    }
    const untilScheduled = nowMs - toTime(session.scheduledAt);
    return !finished && untilScheduled < 0 ? untilScheduled : Number.NaN;
  }
  const elapsed = until - toTime(session.scheduledAt);
  if (finished && elapsed < 0) {
    return Number.NaN;
  }
  return Number.isFinite(durationMs) ? Math.min(elapsed, durationMs) : elapsed;
}

/**
 * O relogio do painel Presenca (docs/30 §2.4), no eixo dos baldes da presenca e do relatorio: o do topo
 * (consoleClockMs: a Live ao vivo desde o Iniciar live, a gravada desde a hora marcada), que para no encerramento; na
 * gravada, no ultimo instante do video, para a curva terminar no ultimo minuto dele mesmo com o tick fechando depois.
 */
export function consolePresenceClockMs(session: Pick<WebinarSession, "endedAt" | "kind" | "scheduledAt" | "startedAt" | "status">, durationMs: number, nowMs: number): number {
  const clock = consoleClockMs(session, durationMs, nowMs);
  return session.kind === "simulated" && Number.isFinite(durationMs) && durationMs > 0 ? Math.min(clock, durationMs - 1) : clock;
}

/** Agora, ou o encerramento se a sessao ja acabou (o relogio do console para ali). */
function untilEnded(session: Pick<WebinarSession, "endedAt">, nowMs: number): number {
  const endedMs = toTime(session.endedAt);
  return Number.isFinite(endedMs) ? Math.min(nowMs, endedMs) : nowMs;
}

/** O rotulo do topo a partir de consoleClockMs: "No ar há 12:30", "Começa em 4:10", "Durou 42:00"; vazio no NaN. */
export function consoleClockLabel(offsetMs: number, phase: ConsolePhase): string {
  if (!Number.isFinite(offsetMs) || phase === "replay" || phase === "cancelled") {
    return "";
  }
  const label = formatClock(Math.abs(offsetMs));
  if (offsetMs < 0) {
    return WEBINAR_ADMIN_COPY.console.startsIn(label);
  }
  return phase === "ended" ? WEBINAR_ADMIN_COPY.console.lasted(label) : WEBINAR_ADMIN_COPY.console.onAirFor(label);
}

function formatClock(ms: number) {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
