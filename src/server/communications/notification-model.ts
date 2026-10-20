// Sino do aluno (docs/22 §2): contratos que a API devolve e o navegador desenha, e regras puras das
// notificacoes automaticas de comentario. Modulo puro (sem "server-only", imports relativos): as rotas
// /api/notifications, o painel do sino, a previa do admin e tests/comunicacao-avisos-modelo.test.mjs
// usam os mesmos tipos.

export type NotificationKind = "comment_mention" | "comment_reply" | "notice";

export type NotificationAudio = { durationSeconds: number; mimeType: string | null; peaks: number[]; url: string };
export type NotificationCta = { href: string; label: string; target: "new_tab" | "same_tab" };
export type NotificationImage = { alt: string; url: string };
export type NotificationResponseValue = "accepted" | "declined";

export type NotificationItem = {
  /** Quem gerou (comentario); null = a escola (aviso da equipe). */
  actor: { avatarUrl: string | null; name: string } | null;
  audio: NotificationAudio | null;
  /** Texto do aviso ou o trecho da resposta. */
  body: string;
  /** Contexto curto: o titulo da aula, nas notificacoes de comentario. */
  context: string | null;
  createdAt: string;
  cta: NotificationCta | null;
  /** Link da notificacao inteira (comentario -> aula); aviso usa o botao. */
  href: string | null;
  id: string;
  image: NotificationImage | null;
  kind: NotificationKind;
  readAt: string | null;
  response: { acceptLabel: string; declineLabel: string; value: NotificationResponseValue | null } | null;
  seenAt: string | null;
  title: string;
};

export type NotificationsFilter = "all" | "unread";

export type NotificationsPage = {
  items: NotificationItem[];
  nextCursor: string | null;
  /** Nao lidas (bolinha vermelha). */
  unread: number;
  /** Nao vistas (numero do sino). */
  unseen: number;
};

export type PopupItem = {
  audio: NotificationAudio | null;
  body: string;
  canSnooze: boolean;
  cta: NotificationCta | null;
  id: string;
  image: NotificationImage | null;
  title: string;
};

export type NotificationsSummary = { popup: PopupItem | null; unseen: number };

export const NOTIFICATIONS_PAGE_SIZE = 20;
export const COMMENT_SNIPPET_MAX = 280;
export const NOTICE_PEAK_BARS = 48;

/** "Ana Souza respondeu seu comentário" / "Ana Souza mencionou você" (sem nome: "Alguém"). */
export function commentNotificationTitle(kind: "comment_mention" | "comment_reply", actorName: string | null | undefined) {
  const name = actorName?.trim() || "Alguém";

  return kind === "comment_reply" ? `${name} respondeu seu comentário` : `${name} mencionou você`;
}

/**
 * Mencao no comeco da resposta, no formato que a tela da aula escreve ao responder
 * ("@ana.souza texto"). Mesmo conjunto de caracteres que o desenho da mencao na aula.
 */
export function parseLeadingMention(body: string): string | null {
  const match = /^\s*@([a-z0-9._-]+)/i.exec(body);

  return match ? match[1].toLocaleLowerCase("en-US").replace(/[._-]+$/, "") || null : null;
}

/** Trecho da resposta: espacos colapsados, ate `max` caracteres com reticencias. */
export function commentSnippet(body: string, max = COMMENT_SNIPPET_MAX) {
  const flat = body.replace(/\s+/g, " ").trim();

  if (flat.length <= max) {
    return flat;
  }

  return `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cursor da paginacao: "<created_at ISO>|<id>" da ultima linha entregue. */
export function encodeCursor(row: { createdAt: string; id: string }) {
  return `${new Date(row.createdAt).toISOString()}|${row.id}`;
}

export function decodeCursor(value: string | null | undefined): { createdAt: string; id: string } | null {
  if (!value || value.length > 120) {
    return null;
  }

  const [createdAt, id, extra] = value.split("|");

  if (extra !== undefined || !createdAt || !id || !UUID.test(id)) {
    return null;
  }

  const time = Date.parse(createdAt);

  return Number.isFinite(time) ? { createdAt: new Date(time).toISOString(), id: id.toLowerCase() } : null;
}

/** Barras da forma de onda: inteiros 0..100, reamostrados para `bars` (vazio -> barras baixas). */
export function normalizePeaks(peaks: unknown, bars = NOTICE_PEAK_BARS): number[] {
  const values = Array.isArray(peaks)
    ? peaks.map((value) => (typeof value === "number" && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0))
    : [];

  if (values.length === 0) {
    return Array.from({ length: bars }, () => 12);
  }

  return Array.from({ length: bars }, (_, index) => {
    const start = Math.floor((index * values.length) / bars);
    const end = Math.max(start + 1, Math.floor(((index + 1) * values.length) / bars));
    let peak = 0;

    for (let position = start; position < end && position < values.length; position += 1) {
      peak = Math.max(peak, values[position]);
    }

    return peak;
  });
}

/** Link da aula usado pelas notificacoes de comentario. */
export function lessonNotificationHref(input: { contentId: string; lessonId: string; moduleId: string }) {
  return `/conteudo/${encodeURIComponent(input.contentId)}/aulas/${encodeURIComponent(input.moduleId)}?lessonId=${encodeURIComponent(input.lessonId)}`;
}
