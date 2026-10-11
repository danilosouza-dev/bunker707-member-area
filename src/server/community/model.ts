// Regras puras da Comunidade (docs/17 §1.9 e §1.11). Sem "server-only": a fila no cliente e o
// teste (tests/community-model.test.mjs) usam as mesmas funcoes.

import {
  compareCivilDates,
  DEFAULT_ADMIN_PERIOD_VALUE,
  getAdminToday,
  parseAdminPeriodParamStrict,
  resolveAdminPeriod,
  type AdminPeriod
} from "../../components/admin/v2/period";

/** Pergunta "sem resposta" vira alerta depois de 24 h (meta: mediana < 24 h, p90 < 48 h). */
export const UNANSWERED_ALERT_HOURS = 24;
export const RESPONSE_TARGET_MEDIAN_HOURS = 24;
export const RESPONSE_TARGET_P90_HOURS = 48;
/** Janela fixa dos numeros do topo de Comunidade e de Top alunos. */
export const COMMUNITY_STATS_WINDOW_DAYS = 28;

export const COMMENT_STATUS_LABELS = {
  approved: "Visível",
  hidden: "Oculto",
  pending: "Aguardando",
  spam: "Spam"
} as const;

export function hoursBetween(fromIso: string, to: Date = new Date()) {
  const from = new Date(fromIso).getTime();

  if (!Number.isFinite(from)) {
    return 0;
  }

  return Math.max(0, (to.getTime() - from) / 3_600_000);
}

export function isOverdueQuestion(createdAt: string, now: Date = new Date()) {
  return hoursBetween(createdAt, now) > UNANSWERED_ALERT_HOURS;
}

/** "há 5 min", "há 5 h", "há 3 d" (fila e cartoes). */
export function formatWaitingTime(createdAt: string, now: Date = new Date()) {
  const hours = hoursBetween(createdAt, now);

  if (hours < 1) {
    return `há ${Math.max(1, Math.floor(hours * 60))} min`;
  }

  if (hours < 72) {
    return `há ${Math.floor(hours)} h`;
  }

  return `há ${Math.floor(hours / 24)} d`;
}

/** "9 h", "1,5 d"; null vira "—" (nunca um numero inventado). */
export function formatResponseHours(hours: number | null | undefined) {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) {
    return "—";
  }

  if (hours < 48) {
    return `${Math.round(hours)} h`;
  }

  return `${(hours / 24).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} d`;
}

export type QuickReplyContext = {
  lessonTitle: string;
  studentName: string;
};

/**
 * Preenche uma resposta rapida: {nome} vira o primeiro nome do aluno e {aula} o nome da aula.
 * Marcadores desconhecidos ficam como estao, para o professor ver e corrigir antes de enviar.
 */
export function renderQuickReply(template: string, context: QuickReplyContext) {
  const firstName = context.studentName.trim().split(/\s+/)[0] || "aluno";

  return template.replace(/\{(nome|aula)\}/gi, (_, key: string) =>
    key.toLowerCase() === "nome" ? firstName : context.lessonTitle.trim()
  );
}

/** Saldo da avaliacao da aula = (Amei - Não gostei) / respostas; null sem respostas. */
export function ratingBalance(counts: { liked: number; loved: number; notForMe: number }) {
  const total = counts.liked + counts.loved + counts.notForMe;

  return total > 0 ? (counts.loved - counts.notForMe) / total : null;
}

/** So vale agir sobre avaliacao negativa com pelo menos 20 respostas (docs/17 §1.11). */
export const RATING_MIN_RESPONSES_FOR_ACTION = 20;

/* ------------------------------------------------------------------------------------------------
 * Acrescimos da frente D (fase 1)
 * ---------------------------------------------------------------------------------------------- */

/** Inicio da janela de N dias (ISO), para as RPCs. */
export function communitySince(days: number, now: Date = new Date()) {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** "há 52 h" a partir de horas ja calculadas (numero do topo "a mais antiga há ..."). */
export function formatAgeFromHours(hours: number | null | undefined) {
  if (hours === null || hours === undefined || !Number.isFinite(hours)) {
    return "—";
  }

  if (hours < 1) {
    return `há ${Math.max(1, Math.floor(hours * 60))} min`;
  }

  if (hours < 72) {
    return `há ${Math.floor(hours)} h`;
  }

  return `há ${Math.floor(hours / 24)} d`;
}

const balanceFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
  style: "percent"
});

/** Saldo da avaliacao em texto: "+40%", "-25%", "0%"; null vira "—". */
export function formatRatingBalance(balance: number | null | undefined) {
  if (balance === null || balance === undefined || !Number.isFinite(balance)) {
    return "—";
  }

  return balanceFormatter.format(balance);
}

/** Avaliacao so pede acao com respostas suficientes (docs/17 §1.11). */
export function isRatingActionable(total: number) {
  return total >= RATING_MIN_RESPONSES_FOR_ACTION;
}

/** Exemplo fixo para a previa das respostas rapidas em Regras (nunca um aluno real). */
export const QUICK_REPLY_PREVIEW_CONTEXT: QuickReplyContext = {
  lessonTitle: "Primeiro prompt",
  studentName: "Ana Souza"
};

/** Respostas rapidas por escola (evita lista que ninguem consegue usar no menu). */
export const QUICK_REPLY_LIMIT = 50;

/** Tom do chip de situacao do comentario. */
export function commentStatusTone(status: keyof typeof COMMENT_STATUS_LABELS) {
  return status === "approved" ? "success" : status === "pending" ? "warning" : status === "spam" ? "error" : "muted";
}

/* ------------------------------------------------------------------------------------------------
 * Periodo das abas (rodada "Layout do prototipo", 11/10/2026)
 * ---------------------------------------------------------------------------------------------- */

/**
 * Periodo da Comunidade, lido de ?periodo= com o modelo do admin (src/components/admin/v2/period.ts):
 * Hoje, 1d, 3d, 7d e 30d, mais os links antigos 7, 30 e 90. As consultas da Comunidade so recebem o
 * inicio da janela (vao ate agora), por isso um intervalo do calendario so vale quando termina hoje
 * (o "90" antigo vira um desses); um intervalo ja fechado cai no padrao, em vez de mostrar dias a mais.
 */
export type CommunityPeriod = {
  /** true quando ?periodo= veio valido no endereco. Fila e Denuncias sem ele mostram tudo ("Tudo"). */
  explicit: boolean;
  /** No meio de uma frase: "hoje", "nas últimas 24 horas", "nos últimos 30 dias". */
  inlineLabel: string;
  /** Titulo do periodo: "Hoje", "Últimos 30 dias". */
  label: string;
  /** Valor canonico de ?periodo= ("30d" no padrao). */
  param: string;
  /** Inicio da janela (ISO), para as RPCs. */
  since: string;
};

function parseCommunityPeriodValue(value: string | string[] | null | undefined, now: Date): AdminPeriod | null {
  const period = parseAdminPeriodParamStrict(value, now);

  if (period?.kind === "range" && compareCivilDates(period.to, getAdminToday(now)) < 0) {
    return null;
  }

  return period;
}

/** Le ?periodo= da Comunidade; ausente, invalido ou intervalo fechado vira o padrao (ultimos 30 dias). */
export function resolveCommunityPeriod(value: string | string[] | null | undefined, now: Date = new Date()): CommunityPeriod {
  const chosen = parseCommunityPeriodValue(value, now);
  const resolved = resolveAdminPeriod(chosen ?? DEFAULT_ADMIN_PERIOD_VALUE, now);

  return {
    explicit: chosen !== null,
    inlineLabel: resolved.inlineLabel,
    label: resolved.label,
    param: resolved.param,
    since: resolved.start.toISOString()
  };
}
