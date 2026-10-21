// Regras puras do sino e do pop-up do aluno (docs/22; v2 em docs/23): grupos por dia, numero do sino,
// nome acessivel, relogio e forma de onda do audio, audio ouvido (48 trechos, como o WhatsApp), linha de
// quem envia com o "Termina em", destino dos links e marcacao local de lidas e abertas. Modulo puro (sem
// React, imports relativos): tests/sino-do-aluno-modelo.test.mjs carrega direto pelo Node, e o painel,
// o cartao, o pop-up e a previa do admin usam as mesmas regras.

import { FLOW_LIMITS } from "../../../server/communications/flow-model";
import { urgencyLabel } from "../../../server/communications/message-meta";
import {
  AUDIO_COMPLETE_SLOTS,
  AUDIO_HEARD_SLOTS,
  type NotificationCta,
  type NotificationItem
} from "../../../server/communications/notification-model";
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

/**
 * Marca como abertas (localmente) as notificacoes dadas: aberta tambem conta como lida. Interacao de
 * verdade (cartao, "Ver mais", audio, botao, resposta); "Marcar todas" so marca como lida.
 */
export function markNotificationsOpened<T extends Pick<NotificationItem, "id" | "openedAt" | "readAt">>(
  items: readonly T[],
  ids: readonly string[],
  openedAt: string
): T[] {
  const targets = new Set(ids);

  return items.map((item) =>
    !targets.has(item.id) || (item.openedAt && item.readAt) ? item : { ...item, openedAt: item.openedAt ?? openedAt, readAt: item.readAt ?? openedAt }
  );
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

// --- Quem envia, o fim no sino e o rodape ------------------------------------------------------------

/** Rodape da lista: cada notificacao pode ficar menos que isso (Fica no sino por). */
export const NOTIFICATIONS_FOOTER = "As notificações ficam aqui por até 90 dias.";

/** Resposta (ou outra acao) numa notificacao que saiu do sino com o cartao ainda na tela (404). */
export const NOTIFICATION_GONE_MESSAGE = "Esta notificação não está mais disponível.";

/**
 * Linha embaixo do texto do aviso: quem envia (a pessoa da equipe, resolvida na leitura, ou a escola) e
 * "Termina em 3 h" (so perto do fim). `serverNow` e a hora do servidor da lista (asOf): nada conta no
 * navegador; a previa do admin passa a hora da tela.
 */
export function noticeMeta(
  item: Pick<NotificationItem, "actor" | "createdAt" | "expiresAt" | "kind" | "response">,
  input: { schoolName: string; serverNow: number }
) {
  return { hint: urgencyLabel(item, input.serverNow), sender: item.actor?.name?.trim() || input.schoolName };
}

/** Quantos ids vao em `shown` no "abriu o sino" e no "Marcar todas" (o servidor aceita ate isto). */
export const MAX_SHOWN_IDS = 50;

/**
 * Linhas que o painel mostrou e que ainda estao na folga de 15 s das linhas de fluxo (inbox.ts
 * wasVisibleAt): vao em `shown` para serem marcadas mesmo assim. O item nao diz se veio de um fluxo,
 * entao vao todos os avisos recentes; o servidor so usa a lista para as linhas de fluxo.
 */
export function recentFlowIds(items: readonly Pick<NotificationItem, "createdAt" | "id" | "kind">[], asOf: string): string[] {
  const reference = Date.parse(asOf);

  if (!Number.isFinite(reference)) {
    return [];
  }

  return items
    .filter((item) => item.kind === "notice" && Date.parse(item.createdAt) > reference - FLOW_LIMITS.flowRowSettleMs)
    .slice(0, MAX_SHOWN_IDS)
    .map((item) => item.id);
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

// --- Audio ouvido (48 trechos, como o WhatsApp) ----------------------------------------------------

/** Nenhum trecho ouvido. */
export const EMPTY_HEARD = "0".repeat(AUDIO_HEARD_SLOTS);
const HEARD_MASK = /^[01]{48}$/;

/** Mascara gravada lida sem confiar: fora do formato = nada ouvido. */
export function normalizeHeard(mask: unknown): string {
  return typeof mask === "string" && HEARD_MASK.test(mask) ? mask : EMPTY_HEARD;
}

/**
 * Trechos ouvidos pelo que tocou de verdade (HTMLMediaElement.played, em segundos): o audio vira `slots`
 * trechos iguais e um trecho conta quando os pedacos tocados cobrem pelo menos metade dele. Pular para
 * o fim nao conta (o trecho pulado nunca tocou); 1,5x e 2x contam (o pedaco tocou).
 */
export function heardSlotsFromRanges(ranges: readonly { end: number; start: number }[], duration: number, slots = AUDIO_HEARD_SLOTS): string {
  const count = Math.max(0, Math.trunc(slots));

  if (!Number.isFinite(duration) || duration <= 0) {
    return "0".repeat(count);
  }

  // Pedacos dentro do audio, em ordem e sem sobreposicao (o navegador ja junta; aqui nao se confia).
  const merged: { end: number; start: number }[] = [];
  const sorted = ranges
    .map((range) => ({ end: Math.min(duration, range.end), start: Math.max(0, range.start) }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((left, right) => left.start - right.start);

  for (const range of sorted) {
    const last = merged[merged.length - 1];

    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const slotLength = duration / count;
  let mask = "";

  for (let index = 0; index < count; index += 1) {
    const start = index * slotLength;
    const end = start + slotLength;
    let covered = 0;

    for (const range of merged) {
      covered += Math.max(0, Math.min(end, range.end) - Math.max(start, range.start));
    }

    mask += covered >= slotLength / 2 - 1e-9 ? "1" : "0";
  }

  return mask;
}

/** OU de duas mascaras (o servidor faz o mesmo): o ouvido so cresce. */
export function orHeard(left: unknown, right: unknown): string {
  const a = normalizeHeard(left);
  const b = normalizeHeard(right);
  let mask = "";

  for (let index = 0; index < AUDIO_HEARD_SLOTS; index += 1) {
    mask += a[index] === "1" || b[index] === "1" ? "1" : "0";
  }

  return mask;
}

export function countHeard(mask: unknown): number {
  let total = 0;

  for (const slot of normalizeHeard(mask)) {
    if (slot === "1") {
      total += 1;
    }
  }

  return total;
}

/** 0..100, como o servidor grava (audio_heard_percent = floor(trechos * 100 / 48)). */
export function heardPercent(mask: unknown): number {
  return Math.floor((countHeard(mask) * 100) / AUDIO_HEARD_SLOTS);
}

/**
 * Barras da onda ouvidas: a barra `i` de `barCount` (12 a 48, pela largura) cobre os trechos
 * [floor(i*48/n), floor((i+1)*48/n)) e conta como ouvida quando a maioria deles foi ouvida.
 */
export function heardBars(mask: unknown, barCount: number): boolean[] {
  const heard = normalizeHeard(mask);
  const bars = Math.min(AUDIO_HEARD_SLOTS, Math.max(1, Math.trunc(Number.isFinite(barCount) ? barCount : AUDIO_HEARD_SLOTS)));

  return Array.from({ length: bars }, (_, index) => {
    const start = Math.floor((index * AUDIO_HEARD_SLOTS) / bars);
    const end = Math.floor(((index + 1) * AUDIO_HEARD_SLOTS) / bars);
    let total = 0;

    for (let slot = start; slot < end; slot += 1) {
      if (heard[slot] === "1") {
        total += 1;
      }
    }

    return total * 2 > end - start;
  });
}

export type AudioListenState = "completed" | "never" | "partial";

/** Nunca tocado (nada ouvido e nao comecou nesta visita), ouvido em parte, ou ouvido (44 de 48). */
export function listenState(mask: unknown, started: boolean): AudioListenState {
  const total = countHeard(mask);

  if (total >= AUDIO_COMPLETE_SLOTS) {
    return "completed";
  }

  return total === 0 && !started ? "never" : "partial";
}

/** Nome do grupo do player para o leitor de tela (tocando, a barra de posicao ja anuncia onde esta). */
export function audioGroupLabel(label: string, input: { percent: number; playing: boolean; state: AudioListenState }) {
  if (input.playing) {
    return label;
  }

  if (input.state === "never") {
    return `${label}, ainda não ouvido`;
  }

  return input.state === "completed" ? `${label}, ouvido` : `${label}, ouvido até ${Math.max(0, Math.min(100, Math.round(input.percent)))}%`;
}

/** O que o player do sino recebe: o ouvido gravado (null = sem audio, ou o pop-up, que nao guarda). */
export function audioListenOf(item: Pick<NotificationItem, "audio" | "audioProgress">): { completed: boolean; heard: string } | null {
  if (!item.audio) {
    return null;
  }

  return { completed: Boolean(item.audioProgress?.completed), heard: normalizeHeard(item.audioProgress?.heard) };
}

/**
 * O primeiro play precisa avisar o servidor ("started")? Nao quando o servidor ja tem trecho ouvido
 * (o "started" ja foi gravado): tocar de novo nao gasta pedido, como na v1.
 */
export function needsAudioStart(item: Pick<NotificationItem, "audioProgress">) {
  return countHeard(item.audioProgress?.heard) === 0;
}

/** Evento do player do sino: o primeiro play, ou a mascara ouvida pelo caminho escolhido. */
export type AudioProgressEvent = { event: "started" } | { event: "progress"; heard: string; via: "beacon" | "fetch" };

export type AudioFlushReason = "ended" | "hidden" | "pagehide" | "pause" | "timeupdate" | "unmount";

/** Tocando: manda quando a mascara cresceu pelo menos isto desde o ultimo envio... */
export const AUDIO_FLUSH_MIN_SLOTS = 5;
/** ...e passou pelo menos isto (no maximo cerca de 1 pedido a cada 15 s ouvindo). */
export const AUDIO_FLUSH_MIN_MS = 15_000;

/**
 * Hora de mandar o ouvido? So quando a mascara cresceu alem do que o servidor ja tem (`known`, em
 * trechos). Tocando: chegou a 44 (o verde ja aparece; confirma na hora) ou cresceu 5 trechos com 15 s
 * desde o ultimo envio, por fetch. Pausa e fim: fetch. Aba escondida, saida da pagina e o painel
 * fechando: beacon (a resposta nao e lida).
 */
export function shouldFlushAudio(input: { heard: number; known: number; msSinceLastSend: number; reason: AudioFlushReason }): "beacon" | "fetch" | null {
  if (input.heard <= input.known) {
    return null;
  }

  switch (input.reason) {
    case "timeupdate":
      if (input.heard >= AUDIO_COMPLETE_SLOTS && input.known < AUDIO_COMPLETE_SLOTS) {
        return "fetch";
      }

      return input.heard - input.known >= AUDIO_FLUSH_MIN_SLOTS && input.msSinceLastSend >= AUDIO_FLUSH_MIN_MS ? "fetch" : null;
    case "ended":
    case "pause":
      return "fetch";
    default:
      return "beacon";
  }
}
