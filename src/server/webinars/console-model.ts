// O console da sessao e os cards da fase 2b do editor, a parte pura (docs/30 §2.2 "Roteiro de chat" e "Simulacao",
// §2.4, §6.6 D6-c, §8.6): a fase que a equipe ve, o que pode abrir e encerrar, a fila do roteiro com o que ja
// entrou, as contagens das enquetes, a ordem do quadro de perguntas, a sessao que o console abre por padrao e a
// frase da decisao do selo (montada e conferida do mesmo jeito no navegador e no servidor). Sem "server-only",
// imports relativos: tests/webinarios-console-modelo.test.mjs carrega direto pelo Node. Nada aqui le o relogio:
// tudo recebe `nowMs`.

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

export function consolePhaseLabel(phase: ConsolePhase): string {
  return WEBINAR_ADMIN_COPY.console.phases[phase];
}

export function consolePhaseTone(phase: ConsolePhase): "error" | "muted" | "neutral" | "success" | "warning" {
  switch (phase) {
    case "live":
      return "success";
    case "waiting":
      return "warning";
    case "cancelled":
      return "error";
    case "ended":
      return "muted";
    default:
      return "neutral";
  }
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

/** O que a mesa pode fazer com uma mensagem (docs/30 §2.4 e §5.2). */
export function messageActions(message: ConsoleMessage, pinnedMessageId: string | null): { approve: boolean; delete: boolean; pin: boolean; promote: boolean; unpin: boolean } {
  const pinned = pinnedMessageId === message.id;
  return {
    approve: !message.approved,
    delete: true,
    pin: !pinned && message.approved,
    promote: message.source === "audience" && !message.master && message.approved && message.promotable,
    unpin: pinned
  };
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
