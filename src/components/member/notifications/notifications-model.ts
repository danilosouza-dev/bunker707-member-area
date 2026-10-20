// Regras puras do sino e do pop-up do aluno (docs/22): grupos por dia, numero do sino, nome acessivel,
// relogio e forma de onda do audio, destino dos links e marcacao local de lidas. Modulo puro (sem
// React, imports relativos): tests/sino-do-aluno-modelo.test.mjs carrega direto pelo Node, e o painel,
// o cartao, o pop-up e a previa do admin usam as mesmas regras.

import type { NotificationCta, NotificationItem } from "../../../server/communications/notification-model";
import { withAccessPreviewParam, type AccessPreviewMode } from "../../../lib/access-preview";
import { getMemberDayDifference } from "../../../lib/member-format";
import { isSafeHeroCtaHref } from "../../../server/member-area/home-hero-links";

/** O numero do sino vale por 1 minuto entre trocas de pagina (o topo remonta a cada pagina). */
export const SUMMARY_TTL_MS = 60_000;

/** O pop-up aparece no maximo uma vez por sessao do navegador (alem do limite de 24 h do servidor). */
export const POPUP_SESSION_KEY = "bunker707:popup-shown";

/** Texto do aviso acima disto comeca recolhido em 4 linhas, com "Ver mais". */
export const NOTIFICATION_BODY_CLAMP_CHARS = 180;

// --- Grupos por dia ------------------------------------------------------------------------------

export type NotificationDayGroupKey = "older" | "today" | "week" | "yesterday";

export type NotificationDayGroup<T> = {
  items: T[];
  key: NotificationDayGroupKey;
  label: string;
};

const DAY_GROUPS: readonly { key: NotificationDayGroupKey; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "week", label: "Últimos 7 dias" },
  { key: "older", label: "Mais antigas" }
];

function dayGroupIndex(createdAt: string, now: number) {
  const days = getMemberDayDifference(createdAt, now);

  if (days === null) return 3;
  if (days <= 0) return 0;
  if (days === 1) return 1;
  if (days < 7) return 2;
  return 3;
}

/**
 * Agrupa por dia civil em Sao Paulo ("Hoje", "Ontem", "Últimos 7 dias", "Mais antigas"), mantendo a
 * ordem recebida do servidor (mais recente primeiro). Grupos vazios nao aparecem.
 */
export function groupNotificationsByDay<T extends { createdAt: string }>(
  items: readonly T[],
  now: number
): NotificationDayGroup<T>[] {
  const groups = DAY_GROUPS.map((group) => ({ items: [] as T[], key: group.key, label: group.label }));

  for (const item of items) {
    groups[dayGroupIndex(item.createdAt, now)].items.push(item);
  }

  return groups.filter((group) => group.items.length > 0);
}

// --- Sino ----------------------------------------------------------------------------------------

/** Numero do sino: vazio sem novidades, "1".."9" e "9+" dali para cima. */
export function formatBadgeCount(count: number) {
  const safe = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;

  if (safe === 0) return "";
  return safe > 9 ? "9+" : String(safe);
}

/** Nome acessivel do botao do sino (o numero visual e aria-hidden). */
export function bellLabel(unseen: number) {
  const safe = Number.isFinite(unseen) ? Math.max(0, Math.trunc(unseen)) : 0;

  if (safe === 0) return "Notificações";
  return safe === 1 ? "Notificações, 1 nova" : `Notificações, ${safe.toLocaleString("pt-BR")} novas`;
}

/** O resumo guardado na memoria do navegador ainda vale? */
export function isSummaryFresh(fetchedAt: number | null, now: number) {
  return fetchedAt !== null && now - fetchedAt >= 0 && now - fetchedAt < SUMMARY_TTL_MS;
}

// --- Itens ----------------------------------------------------------------------------------------

/** Marca como lidas (localmente) as notificacoes dadas, ou todas. Itens ja lidos ficam como estao. */
export function markNotificationsRead<T extends Pick<NotificationItem, "id" | "readAt">>(
  items: readonly T[],
  ids: readonly string[] | "all",
  readAt: string
): T[] {
  const targets = ids === "all" ? null : new Set(ids);

  return items.map((item) => (item.readAt || (targets && !targets.has(item.id)) ? item : { ...item, readAt }));
}

/** Junta a pagina seguinte sem repetir itens (a mesma notificacao pode vir de novo apos uma escrita). */
export function appendNotifications<T extends { id: string }>(current: readonly T[], next: readonly T[]): T[] {
  const seen = new Set(current.map((item) => item.id));

  return [...current, ...next.filter((item) => !seen.has(item.id))];
}

export function shouldClampNotificationBody(body: string) {
  return body.trim().length > NOTIFICATION_BODY_CLAMP_CHARS;
}

/**
 * Titulo de comentario com o nome em negrito: "Ana Souza" + " respondeu seu comentário". Sem nome no
 * comeco do titulo, devolve tudo em `rest`.
 */
export function splitActorTitle(title: string, actorName: string | null | undefined) {
  const name = actorName?.trim();

  if (name && title.startsWith(name) && title.length > name.length) {
    return { actor: name, rest: title.slice(name.length) };
  }

  return { actor: null, rest: title };
}

// --- Destino dos links ---------------------------------------------------------------------------

export type NotificationLink = {
  href: string;
  /** Caminho da area do aluno (navega pelo roteador com feedback). */
  internal: boolean;
  /** Abre em nova aba (target="_blank" + rel="noopener noreferrer"). */
  newTab: boolean;
};

/**
 * Link pronto para desenhar, conferido na hora (o que foi gravado tem que valer como esta): caminho
 * interno da area ou https; o resto (javascript:, //host, /api...) nao vira link. Caminho interno leva
 * o modo "ver como" do produtor.
 */
export function resolveNotificationLink(
  href: string | null | undefined,
  target: NotificationCta["target"] | null | undefined,
  accessPreviewMode?: AccessPreviewMode
): NotificationLink | null {
  if (!isSafeHeroCtaHref(href)) {
    return null;
  }

  const internal = href.startsWith("/");

  return {
    href: internal ? withAccessPreviewParam(href, accessPreviewMode) : href,
    internal,
    newTab: target === "new_tab"
  };
}

// --- Audio ---------------------------------------------------------------------------------------

/** "0:05", "1:02", "12:00" (horas viram minutos: o audio vai ate 5 min). */
export function formatAudioClock(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const minutes = Math.floor(safe / 60);

  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

/** Texto do tempo ao lado da onda: so o total antes de tocar; depois "0:12 / 0:58". */
export function formatAudioTime(current: number, duration: number, started: boolean) {
  return started ? `${formatAudioClock(current)} / ${formatAudioClock(duration)}` : formatAudioClock(duration);
}

/** aria-valuetext da barra de posicao: "0:12 de 0:58". */
export function formatAudioPosition(current: number, duration: number) {
  return `${formatAudioClock(current)} de ${formatAudioClock(duration)}`;
}

export const AUDIO_RATES = [1, 1.5, 2] as const;
export type AudioRate = (typeof AUDIO_RATES)[number];

/** "1x", "1,5x", "2x". */
export function formatAudioRate(rate: number) {
  return `${String(rate).replace(".", ",")}x`;
}

export function nextAudioRate(rate: number): AudioRate {
  const index = AUDIO_RATES.indexOf(rate as AudioRate);

  return AUDIO_RATES[(index + 1) % AUDIO_RATES.length];
}

/** Segundos andados por seta na barra de posicao. */
export const AUDIO_SEEK_STEP_SECONDS = 5;

export function clampAudioTime(seconds: number, duration: number) {
  if (!Number.isFinite(seconds)) return 0;
  return Math.min(Math.max(seconds, 0), Math.max(duration, 0));
}

/** Barras gravadas com o aviso (NOTICE_PEAK_BARS em notification-model.ts). */
export const WAVEFORM_MAX_BARS = 48;
const WAVEFORM_MIN_BARS = 12;
/** Barra de 3 px + 2 px de espaco. */
const WAVEFORM_BAR_PITCH = 5;

/** Quantas barras cabem na largura (em px) da onda, entre 12 e 48. */
export function waveformBarCount(width: number) {
  if (!Number.isFinite(width) || width <= 0) return WAVEFORM_MAX_BARS;
  return Math.min(WAVEFORM_MAX_BARS, Math.max(WAVEFORM_MIN_BARS, Math.floor((width + 2) / WAVEFORM_BAR_PITCH)));
}

/**
 * Alturas das barras (15% a 100% da altura da onda), reamostrando os picos gravados (0..100) para
 * `count` barras pelo maior pico de cada trecho. Sem picos: barras baixas e iguais.
 */
export function waveformHeights(peaks: readonly number[] | null | undefined, count: number) {
  const bars = Math.max(1, Math.trunc(count));
  const values = (peaks ?? []).map((value) => (Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0));

  return Array.from({ length: bars }, (_, index) => {
    if (values.length === 0) {
      return 15;
    }

    const start = Math.floor((index * values.length) / bars);
    const end = Math.max(start + 1, Math.floor(((index + 1) * values.length) / bars));
    let peak = 0;

    for (let position = start; position < end && position < values.length; position += 1) {
      peak = Math.max(peak, values[position]);
    }

    return Math.round(15 + (peak * 85) / 100);
  });
}
