// Sino do aluno (docs/22 §1.1 e §4.4; v2 em docs/23): contratos que a API devolve e o navegador desenha, e
// regras puras das notificacoes automaticas de comentario. Modulo puro (sem "server-only", imports
// relativos): as rotas /api/notifications, o painel do sino, a previa do admin e
// tests/comunicacao-avisos-modelo.test.mjs usam os mesmos tipos.
// v3a (docs/24): como o aluno chega ao destino, a reacao do aluno e a enquete do aviso.
// v3b-1 (docs/25): o pop-up "Só no X", o plano do aluno (sem conteudo) e a resposta do POST /show.

import { INBOX_HISTORY_DAYS } from "./campaign-model";
import type { NotificationPoll, ReactionId } from "./interactions-model";
import type { NoticeIconColor, NoticeIconId } from "./message-meta";
import type { PopupDesign, PopupFontFace } from "./popup-design-model";
import type { PopupFreeDesign } from "./popup-free-model";

export type { NotificationPoll } from "./interactions-model";

export type NotificationKind = "comment_mention" | "comment_reply" | "notice";

/** Icone ao lado do titulo (catalogo em message-meta.ts). */
export type NotificationIcon = { color: NoticeIconColor; id: NoticeIconId };

/**
 * Audio ouvido (docs/23): `heard` sao 48 trechos "0"/"1" (ouvido pelos trechos tocados de verdade,
 * acumulado por OU no servidor), `percent` 0..100 e `completed` = 44 trechos ou mais.
 */
export type NotificationAudioProgress = { completed: boolean; heard: string; percent: number };

export type NotificationAudio = { durationSeconds: number; mimeType: string | null; peaks: number[]; url: string };
/**
 * Como o aluno chega ao destino (v3a, campaigns.cta_display): pelo botao; pelo botao ou tocando na
 * notificacao; so tocando na notificacao (sem botao: o texto fica ao lado da seta, no pe do cartao).
 */
export const CTA_DISPLAYS = ["button", "button_and_card", "card"] as const;
export type CtaDisplay = (typeof CTA_DISPLAYS)[number];

/** Destino da notificacao; sem `display` = "button" (a v2 inteira). */
export type NotificationCta = { display?: CtaDisplay; href: string; label: string; target: "new_tab" | "same_tab" };
/** Botao do pop-up: o formato da v1 (o pop-up sempre abre pelo botao). */
export type PopupCta = { href: string; label: string; target: "new_tab" | "same_tab" };
export type NotificationImage = { alt: string; url: string };
export type NotificationResponseValue = "accepted" | "declined";

export type NotificationItem = {
  /** Quem gerou (comentario) ou quem envia (notificacao da equipe); null = a escola. */
  actor: { avatarUrl: string | null; name: string } | null;
  /**
   * O aluno pode excluir do proprio sino (ajustes da v3a, campaigns.allow_hide). A API manda em todo item
   * (comentario: true); ausente = pode (a lixeira de sempre).
   */
  allowHide?: boolean;
  audio: NotificationAudio | null;
  /** Audio ouvido por este aluno; null quando a notificacao nao tem audio. */
  audioProgress: NotificationAudioProgress | null;
  /** Texto do aviso ou o trecho da resposta. */
  body: string;
  /** Contexto curto: o titulo da aula, nas notificacoes de comentario. */
  context: string | null;
  createdAt: string;
  cta: NotificationCta | null;
  /** Some do sino depois disto (ISO); null so na previa sem fim calculado. */
  expiresAt: string | null;
  /** Link da notificacao inteira (comentario -> aula); aviso usa o botao. */
  href: string | null;
  icon: NotificationIcon | null;
  id: string;
  image: NotificationImage | null;
  kind: NotificationKind;
  /** Interacao de verdade (cartao, Ver mais, audio, botao, resposta, reacao, voto); "Marcar todas" nao conta. */
  openedAt: string | null;
  /** Enquete (v3a); a API manda a chave em todo aviso, null sem enquete e em comentario. */
  poll?: NotificationPoll | null;
  /** Reacao deste aluno (v3a); null quando a equipe nao permitiu reacoes e em comentario. */
  reactions?: { value: ReactionId | null } | null;
  readAt: string | null;
  response: { acceptLabel: string; declineLabel: string; value: NotificationResponseValue | null } | null;
  seenAt: string | null;
  title: string;
};

export type NotificationsFilter = "all" | "unread";

export type NotificationsPage = {
  /**
   * Hora do servidor na leitura (ISO): o painel guarda a da primeira pagina e manda junto em "abriu o
   * sino" e "Marcar todas", que entao nao mexem no que so apareceu depois (parseNotificationsAsOf).
   */
  asOf: string;
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
  /** v3b-1: so quando "Só no X"; sem a chave = fecha no X, no Esc ou clicando fora (o objeto padrao fica igual ao da v1). */
  close?: "x_only";
  cta: PopupCta | null;
  /**
   * Design "Personalizado" (docs/26), validado no servidor (popup-design-schema.ts) e com o endereco do video
   * recalculado do caminho. Sem a chave = Padrão: a resposta continua exatamente a da v3b-1.
   */
  design?: PopupDesign;
  /**
   * Fontes enviadas que o design usa, resolvidas no servidor (o navegador nunca le a tabela). So vem junto com
   * `design` ou `freeDesign`; pode faltar uma fonte (o texto cai na pilha do sistema).
   */
  fonts?: PopupFontFace[];
  /**
   * Design "Livre" (docs/27), validado no servidor (popup-free-schema.ts), sem `locked` e `name` (so do editor).
   * Nunca junto com `design`. No Livre, `title` e `body` vem do design (primeiro titulo e primeiro texto
   * visiveis) e `image`/`icon` ficam nulos: uma aba com o codigo antigo mostra o cartao Padrão com o texto de
   * verdade. Sem a chave = Padrão ou Personalizado (a resposta nao muda).
   */
  freeDesign?: PopupFreeDesign;
  /**
   * Icone ao lado do titulo. A API so manda a chave quando o pop-up tem icone: sem icone, a resposta do
   * resumo continua exatamente a da v1.
   */
  icon?: NotificationIcon | null;
  id: string;
  image: NotificationImage | null;
  title: string;
};

/** Um pop-up do plano do aluno (sem conteudo: o conteudo so vem no POST /show). */
export type PopupPlanItem = {
  delaySeconds: number;
  /**
   * So nos pop-ups Livres (docs/27): o host baixa o pedaco do cartao Livre antes do POST /show. Padrão e
   * Personalizado: sem a chave (o plano nao muda).
   */
  design?: "free";
  /** Nunca nestas paginas (padroes exatos ja expandidos: formacao -> cursos). So pop-ups do segmento do aluno. */
  exclude: string[];
  id: string;
  /** Hora do servidor (ISO) antes da qual "Quantas vezes" ainda nao deixa; null = ja pode. */
  notBefore: string | null;
  pages: string[];
  /** O que faz parar: null = Uma vez; "click" = quando clica no botao; "never" = so quando o pop-up termina. */
  stopOn: "click" | "never" | null;
  trigger: "lesson_completed" | "page_load";
};

export type PopupsAnswer = {
  /** Hora do servidor da resposta (o navegador acerta o relogio por ela). */
  asOf: string;
  /** Onde algum pop-up no ar pode aparecer: padroes grossos, sem ids (content:*, lesson:*); ["any"] = qualquer pagina. */
  pages: string[];
  /** O plano do aluno (todos os pop-ups dele, qualquer pagina); null quando a pagina pedida nao esta em `pages`. */
  plan: PopupPlanItem[] | null;
};

/** Resposta do POST /show. */
export type PopupShowAnswer = { next: { notBefore: string | null } | null; popup: PopupItem };

/**
 * Resumo do sino (GET /api/notifications/summary). v3b-1: com `?page=`, `popups` (o mapa das paginas e, na
 * pagina coberta, o plano do aluno); sem `page`, a chave nao vem (a resposta da v1).
 */
export type NotificationsSummary = { popup: PopupItem | null; popups?: PopupsAnswer | null; unseen: number };

export const NOTIFICATIONS_PAGE_SIZE = 20;
export const COMMENT_SNIPPET_MAX = 280;
export const NOTICE_PEAK_BARS = 48;
/** Trechos do audio ouvido (notifications.audio_heard) e quantos contam como "ouvido" (90 %). */
export const AUDIO_HEARD_SLOTS = 48;
export const AUDIO_COMPLETE_SLOTS = 44;

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
/** Instante em UTC com ate microssegundos ("2026-10-20T12:00:00.123456Z"), como o Postgres grava. */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

/**
 * Instante do cursor sem perder os microssegundos do created_at: com milissegundos, duas notificacoes
 * no mesmo milissegundo fariam a proxima pagina pular uma delas. "+00:00" vira "Z" (o "+" se perde na
 * URL). Outro fuso ou texto invalido cai para o ISO do Date.
 */
function cursorInstant(value: string) {
  const trimmed = value.trim().replace(" ", "T").replace(/\+00(?::?00)?$/, "Z");

  if (UTC_INSTANT.test(trimmed) && Number.isFinite(Date.parse(trimmed))) {
    return trimmed;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** Cursor da paginacao: "<created_at em UTC>|<id>" da ultima linha entregue. */
export function encodeCursor(row: { createdAt: string; id: string }) {
  return `${cursorInstant(row.createdAt) ?? new Date(0).toISOString()}|${row.id}`;
}

export function decodeCursor(value: string | null | undefined): { createdAt: string; id: string } | null {
  if (!value || value.length > 120) {
    return null;
  }

  const [createdAt, id, extra] = value.split("|");

  if (extra !== undefined || !createdAt || !id || !UUID.test(id) || !UTC_INSTANT.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) {
    return null;
  }

  return { createdAt, id: id.toLowerCase() };
}

const DAY_MS = 86_400_000;

/**
 * `asOf` do "abriu o sino" e do "Marcar todas" (a hora do servidor que veio com a lista): vale so um
 * instante em UTC que nao esta no futuro nem passa dos 90 dias da caixa; fora disso, null (a rota
 * ignora e marca tudo o que aparece agora, como antes).
 */
export function parseNotificationsAsOf(value: unknown, now: number): string | null {
  if (typeof value !== "string" || value.length > 40 || !UTC_INSTANT.test(value)) {
    return null;
  }

  const time = Date.parse(value);

  return Number.isFinite(time) && time <= now && time >= now - INBOX_HISTORY_DAYS * DAY_MS ? value : null;
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
