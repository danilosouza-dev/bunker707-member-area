// O relatorio de uma sessao, a parte pura (docs/30 §3.4, §3.6 e §4.6): le as linhas de webinar_report sem confiar
// no formato (bigint pode vir como texto) e monta a visao que a aba Relatorio desenha. Sem "server-only", imports
// relativos: tests/webinarios-*.test.mjs carregam direto pelo Node. Os nomes dos alunos do top 10 vem numa
// segunda leitura (fora do cache), por isso aqui so ids.

import { ROOM_RULES } from "./model";

export type WebinarReportRow = { item: string; metric: string; students: number; total: number };

function toCount(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

/** As linhas da RPC como vieram (objeto ou array), cada uma com metric, item, total e students como numeros. */
export function readWebinarReportRows(rows: readonly unknown[]): WebinarReportRow[] {
  const result: WebinarReportRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const source = row as Record<string, unknown>;
    if (typeof source.metric !== "string") {
      continue;
    }
    result.push({
      item: typeof source.item === "string" ? source.item : String(source.item ?? ""),
      metric: source.metric,
      students: toCount(source.students),
      total: toCount(source.total)
    });
  }
  return result;
}

export type ReportBucket = { b: number; n: number };

export type WebinarReportView = {
  chat: {
    hot: { score: number; userId: string }[];
    perMinute: { minute: number; students: number; total: number }[];
    students: number;
    top: { total: number; userId: string }[];
    total: number;
  };
  polls: { optionId: string; pollId: string; students: number; total: number }[];
  presence: {
    avgPresent: number;
    curve: ReportBucket[];
    drops: ReportBucket[];
    peak: ReportBucket | null;
    reachedEnd: number;
    unique: number;
    watchAvgSeconds: number;
    watchMaxSeconds: number;
  };
  questions: { answered: number; dismissed: number; open: number; top: { questionId: string; votes: number }[] };
  reactions: { byType: { reaction: string; students: number; total: number }[]; perMinute: { minute: number; reaction: string; total: number }[] };
  registration: { absent: number; attended: number; cancelled: number; registered: number; sources: { source: string; total: number }[] };
  replay: { viewers: number; watchedPct: number };
  script: { fired: number; missed: number; ready: number };
};

function emptyReport(): WebinarReportView {
  return {
    chat: { hot: [], perMinute: [], students: 0, top: [], total: 0 },
    polls: [],
    presence: { avgPresent: 0, curve: [], drops: [], peak: null, reachedEnd: 0, unique: 0, watchAvgSeconds: 0, watchMaxSeconds: 0 },
    questions: { answered: 0, dismissed: 0, open: 0, top: [] },
    reactions: { byType: [], perMinute: [] },
    registration: { absent: 0, attended: 0, cancelled: 0, registered: 0, sources: [] },
    replay: { viewers: 0, watchedPct: 0 },
    script: { fired: 0, missed: 0, ready: 0 }
  };
}

/** A visao da aba Relatorio a partir das linhas da RPC; linhas desconhecidas sao ignoradas (a RPC pode crescer antes do app). */
export function buildWebinarReport(rows: readonly WebinarReportRow[]): WebinarReportView {
  const view = emptyReport();
  for (const row of rows) {
    switch (row.metric) {
      case "registration":
        if (row.item === "registered" || row.item === "cancelled" || row.item === "attended" || row.item === "absent") {
          view.registration[row.item] = row.total;
        }
        break;
      case "registration_source":
        view.registration.sources.push({ source: row.item, total: row.total });
        break;
      case "presence":
        view.presence.curve.push({ b: Number(row.item), n: row.total });
        break;
      case "unique":
        view.presence.unique = row.total;
        break;
      case "peak":
        view.presence.peak = { b: Number(row.item), n: row.total };
        break;
      case "avg_present":
        view.presence.avgPresent = row.total;
        break;
      case "drop":
        view.presence.drops.push({ b: Number(row.item), n: row.total });
        break;
      case "watch_avg":
        view.presence.watchAvgSeconds = row.total;
        break;
      case "watch_max":
        view.presence.watchMaxSeconds = row.total;
        break;
      case "reached_end":
        view.presence.reachedEnd = row.total;
        break;
      case "chat_total":
        view.chat.total = row.total;
        view.chat.students = row.students;
        break;
      case "chat_minute":
        view.chat.perMinute.push({ minute: Number(row.item), students: row.students, total: row.total });
        break;
      case "top_chat":
        view.chat.top.push({ total: row.total, userId: row.item });
        break;
      case "hot":
        view.chat.hot.push({ score: row.total, userId: row.item });
        break;
      case "reaction":
        view.reactions.byType.push({ reaction: row.item, students: row.students, total: row.total });
        break;
      case "reaction_minute": {
        const separator = row.item.lastIndexOf(":");
        if (separator > 0) {
          view.reactions.perMinute.push({ minute: Number(row.item.slice(separator + 1)), reaction: row.item.slice(0, separator), total: row.total });
        }
        break;
      }
      case "question":
        if (row.item === "open" || row.item === "answered" || row.item === "dismissed") {
          view.questions[row.item] = row.total;
        }
        break;
      case "top_question":
        view.questions.top.push({ questionId: row.item, votes: row.total });
        break;
      case "poll": {
        const separator = row.item.indexOf(":");
        if (separator > 0) {
          view.polls.push({ optionId: row.item.slice(separator + 1), pollId: row.item.slice(0, separator), students: row.students, total: row.total });
        }
        break;
      }
      case "replay":
        if (row.item === "viewers") {
          view.replay.viewers = row.total;
        } else if (row.item === "watched_pct") {
          view.replay.watchedPct = row.total;
        }
        break;
      case "sim_script":
        if (row.item === "fired" || row.item === "missed" || row.item === "ready") {
          view.script[row.item] = row.total;
        }
        break;
      default:
        break;
    }
  }
  view.presence.curve.sort((a, b) => a.b - b.b);
  view.presence.drops.sort((a, b) => b.n - a.n || a.b - b.b);
  view.chat.perMinute.sort((a, b) => a.minute - b.minute);
  view.chat.top.sort((a, b) => b.total - a.total);
  view.chat.hot.sort((a, b) => b.score - a.score);
  view.questions.top.sort((a, b) => b.votes - a.votes);
  view.reactions.perMinute.sort((a, b) => a.minute - b.minute || a.reaction.localeCompare(b.reaction));
  view.registration.sources.sort((a, b) => b.total - a.total || a.source.localeCompare(b.source));
  return view;
}

/** Os ids de aluno que o relatorio cita (top 10 do chat e mais quentes): a tela busca os nomes numa segunda leitura. */
export function reportUserIds(view: WebinarReportView): string[] {
  return [...new Set([...view.chat.top.map((entry) => entry.userId), ...view.chat.hot.map((entry) => entry.userId)])];
}

/** "12:30" para um balde de 30 s (o eixo da curva). */
export function bucketLabel(bucket: number, bucketSeconds: number = ROOM_RULES.bucketSeconds): string {
  const total = Math.max(0, bucket) * bucketSeconds;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** "1 h 12 min", "45 min", "30 s": o tempo medio e maximo assistido. */
export function watchTimeLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) {
    return `${total} s`;
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

/** Porcentagem inteira de `part` sobre `whole`, ou nulo sem base (a tela mostra "—"). */
export function percentOf(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
    return null;
  }
  return Math.round((part / whole) * 100);
}

/** "{n} alunos", "1 aluno" ou "ninguém". */
export function studentsLabel(count: number): string {
  if (count <= 0) {
    return "ninguém";
  }
  return count === 1 ? "1 aluno" : `${count} alunos`;
}
