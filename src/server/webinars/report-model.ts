// O relatorio de uma sessao, a parte pura (docs/30 §3.4, §3.5, §3.6 e §4.6): le as linhas de webinar_report sem
// confiar no formato (bigint pode vir como texto) e monta a visao que a aba Relatorio desenha. Sem "server-only",
// imports relativos: tests/webinarios-*.test.mjs carregam direto pelo Node. Os nomes dos alunos do top 10 vem numa
// segunda leitura (fora do cache), por isso aqui so ids.
//
// Fase 4 (202610290005 e 202610290006): a RPC ganhou a Oferta (`offer / seen|clicks|purchases`, `offer /
// <L>:seen|clicks|purchases`, `offer_revenue / <moeda>`), as Respostas do Assistente (`ai / replies|avg_seconds|
// edited|deleted|handoffs`) e o bloco Simulacao (`sim_counter / max`, `sim_joins / shown`, `sim_sales / shown`, alem do
// `sim_script` da fase 2). Cada familia tem o seu leitor (applyOfferRow, applyAssistantRow, applySimulationRow): os
// numeros simulados so entram em `view.script` e `view.simulation`, nunca num numero real (D6, D10, M6); a guarda de
// tests/webinarios-exportar-modelo.test.mjs varre este arquivo e confere que `sim_` so aparece no leitor da Simulacao.

import { OFFER_VARIANT_LABELS, ROOM_RULES } from "./model";

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

/** Um numero da RPC com as duas contagens: `total` (linhas) e `students` (alunos distintos). */
export type ReportCount = { students: number; total: number };

export type ReportOfferVariant = { clicks: ReportCount; label: string; purchases: ReportCount; seen: ReportCount };

/** A receita de uma moeda (M8): a soma em centavos e quantas vendas entraram nela. */
export type ReportRevenue = { cents: number; currency: string; sales: number };

export type WebinarReportView = {
  /** Respostas do Assistente (D24, `source = 'ai'`): reais, fora da Simulacao e das mensagens de aluno e equipe. */
  assistant: {
    /** Segundos entre o pedido e a resposta, em media; nulo sem resposta respondida (a tela mostra "—"). */
    avgSeconds: number | null;
    deleted: number;
    edited: number;
    handoffs: number;
    /** A RPC mandou alguma linha `ai` (o Assistente respondeu ou alguem pediu a equipe). */
    present: boolean;
    replies: number;
  };
  chat: {
    hot: { score: number; userId: string }[];
    perMinute: { minute: number; students: number; total: number }[];
    students: number;
    top: { total: number; userId: string }[];
    total: number;
  };
  /** A Oferta da sessao (so linhas reais: presenca na janela, cliques e compras ligadas pelo webhook, M7 e M8). */
  offer: {
    clicks: ReportCount;
    /** A RPC mandou alguma linha `offer` (a sessao mostrou a oferta ou alguem clicou). */
    present: boolean;
    purchases: ReportCount;
    revenue: ReportRevenue[];
    seen: ReportCount;
    variants: ReportOfferVariant[];
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
  /** O roteiro (Simulacao, D6): prontos, que entraram e que faltaram; so o bloco Simulacao le. */
  script: { fired: number; missed: number; ready: number };
  /** O que simulation_summary congelou no fim (Simulacao, D6); nulo quando a sessao nao teve. So o bloco Simulacao le. */
  simulation: { counterMax: number | null; joinsShown: number | null; saleNoticesShown: number | null };
};

const zeroCount = (): ReportCount => ({ students: 0, total: 0 });

function emptyReport(): WebinarReportView {
  return {
    assistant: { avgSeconds: null, deleted: 0, edited: 0, handoffs: 0, present: false, replies: 0 },
    chat: { hot: [], perMinute: [], students: 0, top: [], total: 0 },
    offer: { clicks: zeroCount(), present: false, purchases: zeroCount(), revenue: [], seen: zeroCount(), variants: [] },
    polls: [],
    presence: { avgPresent: 0, curve: [], drops: [], peak: null, reachedEnd: 0, unique: 0, watchAvgSeconds: 0, watchMaxSeconds: 0 },
    questions: { answered: 0, dismissed: 0, open: 0, top: [] },
    reactions: { byType: [], perMinute: [] },
    registration: { absent: 0, attended: 0, cancelled: 0, registered: 0, sources: [] },
    replay: { viewers: 0, watchedPct: 0 },
    script: { fired: 0, missed: 0, ready: 0 },
    simulation: { counterMax: null, joinsShown: null, saleNoticesShown: null }
  };
}

const OFFER_PARTS = ["seen", "clicks", "purchases"] as const;
type OfferPart = (typeof OFFER_PARTS)[number];

const isOfferPart = (value: string): value is OfferPart => (OFFER_PARTS as readonly string[]).includes(value);

/** `offer / seen|clicks|purchases` (a sessao inteira), `offer / <L>:seen|clicks|purchases` (A a D) e a receita. */
function applyOfferRow(view: WebinarReportView, row: WebinarReportRow) {
  if (row.metric === "offer_revenue") {
    if (/^[A-Z]{3}$/.test(row.item)) {
      view.offer.present = true;
      view.offer.revenue.push({ cents: row.total, currency: row.item, sales: row.students });
    }
    return;
  }
  const count = { students: row.students, total: row.total };
  if (isOfferPart(row.item)) {
    view.offer.present = true;
    view.offer[row.item] = count;
    return;
  }
  const separator = row.item.indexOf(":");
  const label = row.item.slice(0, separator);
  const part = row.item.slice(separator + 1);
  if (separator <= 0 || !(OFFER_VARIANT_LABELS as readonly string[]).includes(label) || !isOfferPart(part)) {
    return;
  }
  view.offer.present = true;
  let variant = view.offer.variants.find((entry) => entry.label === label);
  if (!variant) {
    variant = { clicks: zeroCount(), label, purchases: zeroCount(), seen: zeroCount() };
    view.offer.variants.push(variant);
  }
  variant[part] = count;
}

/** `ai / replies|avg_seconds|edited|deleted|handoffs`: o bloco Respostas do Assistente (D24). */
function applyAssistantRow(view: WebinarReportView, row: WebinarReportRow) {
  switch (row.item) {
    case "replies":
      view.assistant.replies = row.total;
      break;
    case "avg_seconds":
      // `students` = quantas respostas tinham hora de pedido e de resposta; sem nenhuma, nao ha media.
      view.assistant.avgSeconds = row.students > 0 ? row.total : null;
      break;
    case "edited":
      view.assistant.edited = row.total;
      break;
    case "deleted":
      view.assistant.deleted = row.total;
      break;
    case "handoffs":
      view.assistant.handoffs = row.total;
      break;
    default:
      return;
  }
  view.assistant.present = true;
}

/**
 * O bloco Simulacao (§3.5): o roteiro (`sim_script`) e o que simulation_summary congelou (`sim_counter`, `sim_joins`,
 * `sim_sales`). O unico lugar deste arquivo que le linhas `sim_*`: nada daqui entra num numero real.
 */
export function applySimulationRow(view: WebinarReportView, row: WebinarReportRow) {
  switch (row.metric) {
    case "sim_script":
      if (row.item === "fired" || row.item === "missed" || row.item === "ready") {
        view.script[row.item] = row.total;
      }
      break;
    case "sim_counter":
      view.simulation.counterMax = row.total;
      break;
    case "sim_joins":
      view.simulation.joinsShown = row.total;
      break;
    case "sim_sales":
      view.simulation.saleNoticesShown = row.total;
      break;
    default:
      break;
  }
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
      case "offer":
      case "offer_revenue":
        applyOfferRow(view, row);
        break;
      case "ai":
        applyAssistantRow(view, row);
        break;
      default:
        // O resto (as linhas do bloco Simulacao e as que a RPC ainda vai ganhar) passa pelo leitor da Simulacao, que
        // so conhece as dele: nenhum numero real le essas linhas (D6, M6).
        applySimulationRow(view, row);
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
  view.offer.variants.sort((a, b) => a.label.localeCompare(b.label));
  view.offer.revenue.sort((a, b) => a.currency.localeCompare(b.currency));
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

/**
 * A receita escrita (M8): "R$ 1.970,00", uma por moeda ("R$ 970,00 · US$ 50,00"); sem venda com valor, nulo (a tela
 * e o CSV mostram "—", nunca um numero estimado).
 */
export function revenueLabel(revenue: readonly ReportRevenue[]): string | null {
  const parts = revenue
    .filter((entry) => entry.sales > 0 || entry.cents > 0)
    .map((entry) => {
      try {
        return new Intl.NumberFormat("pt-BR", { currency: entry.currency, style: "currency" }).format(entry.cents / 100);
      } catch {
        return `${entry.currency} ${(entry.cents / 100).toFixed(2)}`;
      }
    });
  return parts.length > 0 ? parts.join(" · ") : null;
}
