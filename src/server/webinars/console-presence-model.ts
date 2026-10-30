// O painel Presenca do console (docs/30 §2.4: "numero de presentes agora, pico, mensagens por minuto, curva dos ultimos
// 30 minutos"): a conta sobre a visao do relatorio da sessao (webinar_report, em cache de 60 s pelo minuto do relogio,
// a mesma de report-queries.ts), entao o console que relê a cada 5 s pede a RPC no maximo uma vez por minuto. Os
// presentes agora continuam vindo do balde atual (console-queries.ts); aqui ficam o pico, as mensagens do ultimo minuto
// (so de alunos, como o relatorio: `audience` e `original`, nunca o roteiro nem o Assistente) e a curva por minuto (o
// maior numero de presentes entre os dois baldes de 30 s de cada minuto). So a Live ao vivo e a sessao gravada: o
// Replay livre nao tem um relogio comum. Modulo puro, imports relativos: o teste carrega direto pelo Node.

import type { SessionKind } from "./model";
import type { WebinarReportView } from "./report-model";

/** Os ultimos 30 minutos da curva (§2.4). */
export const CONSOLE_PRESENCE_MINUTES = 30;

export type ConsolePresencePoint = { minute: number; present: number };

export type ConsolePresence = {
  /** Um ponto por minuto, do mais antigo ao atual (no maximo 30; antes de comecar, vazio). */
  curve: ConsolePresencePoint[];
  /** O minuto da sessao agora (o eixo da curva). */
  minute: number;
  /** Mensagens de alunos no ultimo minuto inteiro (no primeiro minuto, as do minuto atual). */
  messagesLastMinute: number;
  /** Mensagens de alunos por minuto, em media, na janela da curva. */
  messagesPerMinuteAvg: number;
  /** O maior numero de presentes da sessao e o minuto dele; nulo sem ninguem. */
  peak: ConsolePresencePoint | null;
};

/** O painel vale aqui? (a sessao ja comecou e tem um relogio comum). */
export function consolePresenceApplies(kind: SessionKind, offsetMs: number): boolean {
  return kind !== "replay" && Number.isFinite(offsetMs) && offsetMs >= 0;
}

export function consolePresenceOf(view: Pick<WebinarReportView, "chat" | "presence">, offsetMs: number): ConsolePresence {
  const minute = Math.max(0, Math.floor(offsetMs / 60_000));
  const first = Math.max(0, minute - CONSOLE_PRESENCE_MINUTES + 1);
  const perMinute = new Map<number, number>();

  for (const point of view.presence.curve) {
    if (point.b < 0) {
      continue;
    }
    const at = Math.floor(point.b / 2);
    perMinute.set(at, Math.max(perMinute.get(at) ?? 0, point.n));
  }

  const curve: ConsolePresencePoint[] = [];
  for (let at = first; at <= minute; at += 1) {
    curve.push({ minute: at, present: perMinute.get(at) ?? 0 });
  }

  const messages = new Map(view.chat.perMinute.map((row) => [row.minute, row.total]));
  const lastFull = minute > 0 ? minute - 1 : 0;
  let windowMessages = 0;
  for (let at = first; at <= minute; at += 1) {
    windowMessages += messages.get(at) ?? 0;
  }

  const peak = view.presence.peak && view.presence.peak.n > 0 ? { minute: Math.max(0, Math.floor(view.presence.peak.b / 2)), present: view.presence.peak.n } : null;

  return {
    curve,
    messagesLastMinute: messages.get(lastFull) ?? 0,
    messagesPerMinuteAvg: Math.round((windowMessages / (minute - first + 1)) * 10) / 10,
    minute,
    peak
  };
}

/** "mm:00" do minuto (a curva e o pico; acima de 1 h, "h:mm:00"). */
export function consolePresenceMinuteLabel(minute: number): string {
  const hours = Math.floor(minute / 60);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minute % 60)}:00` : `${pad(minute)}:00`;
}
