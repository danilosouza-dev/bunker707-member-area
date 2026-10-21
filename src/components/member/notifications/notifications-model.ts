// Regras puras do sino e do pop-up do aluno (docs/22; v2 em docs/23): grupos por dia, numero do sino,
// nome acessivel, relogio e forma de onda do audio, audio ouvido (48 trechos, como o WhatsApp), linha de
// quem envia com o "Termina em", destino dos links e marcacao local de lidas e abertas. Modulo puro (sem
// React, imports relativos): tests/sino-do-aluno-modelo.test.mjs carrega direto pelo Node, e o painel,
// o cartao, o pop-up e a previa do admin usam as mesmas regras.
// v3a (docs/24 §1 e §7.3): como o aluno chega ao destino, os nomes da lixeira e das reacoes, a enquete,
// a troca da resposta, o plano de cada abertura e a busca por intencao (no fim do arquivo).

import { FLOW_LIMITS } from "../../../server/communications/flow-model";
import { pollPercent, REACTION_LABELS, type NotificationPoll, type ReactionId } from "../../../server/communications/interactions-model";
import { urgencyLabel } from "../../../server/communications/message-meta";
import {
  AUDIO_COMPLETE_SLOTS,
  AUDIO_HEARD_SLOTS,
  CTA_DISPLAYS,
  type CtaDisplay,
  type NotificationCta,
  type NotificationItem,
  type NotificationResponseValue
} from "../../../server/communications/notification-model";
import { withAccessPreviewParam, type AccessPreviewMode } from "../../../lib/access-preview";
import { formatMemberCount, formatMemberDate, formatMemberTime, getMemberDayDifference } from "../../../lib/member-format";
import { isSafeHeroCtaHref } from "../../../server/member-area/home-hero-links";

/** O numero do sino vale por 1 minuto entre trocas de pagina (o topo remonta a cada pagina). */
export const SUMMARY_TTL_MS = 60_000;

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

/* ------------------------------------------------------------------------------------------------
 * v3a (docs/24): cartao clicavel, lixeira, reacoes, enquete e troca da resposta
 * ---------------------------------------------------------------------------------------------- */

/** Como o cartao leva ao destino (docs/24 §1.2), com o link ja conferido. */
export type CardLinkPlan = {
  /** Onde fica o link acessivel do cartao: o botao, o titulo (ou a frase do comentario), ou nenhum. */
  accessibleLink: "button" | "title" | null;
  /** Desenha o botao (Pelo botão; Pelo botão ou tocando na notificação). */
  button: boolean;
  /** Texto ao lado da seta, no pe do cartao (Só tocando na notificação); null nos outros modos. */
  cue: string | null;
  /** aria-describedby do link do titulo (o id do texto ao lado da seta), so no modo "card". */
  describedBy: string | null;
  /** Modo do aviso; sem destino valido, "button" sem botao (o cartao so informa). */
  display: CtaDisplay;
  link: NotificationLink | null;
  /** Link decorativo por baixo do conteudo: tocar no texto, na imagem ou no vazio leva ao destino. */
  wholeCard: boolean;
};

function ctaDisplayOf(cta: Pick<NotificationCta, "display"> | null | undefined): CtaDisplay {
  const display = cta?.display;

  return display && (CTA_DISPLAYS as readonly string[]).includes(display) ? display : "button";
}

/**
 * Comentario: o cartao inteiro leva para a aula, e o link acessivel e a frase ("Ana Souza respondeu seu
 * comentário"). Aviso: pelo `cta.display` (ausente = "button", a v2). Destino que nao vale como esta
 * (resolveNotificationLink) = sem link nenhum, como hoje.
 */
export function cardLinkOf(
  item: Pick<NotificationItem, "cta" | "href" | "kind">,
  input: { accessPreviewMode?: AccessPreviewMode; cueId?: string } = {}
): CardLinkPlan {
  if (item.kind !== "notice") {
    const link = resolveNotificationLink(item.href, "same_tab", input.accessPreviewMode);

    return { accessibleLink: link ? "title" : null, button: false, cue: null, describedBy: null, display: "card", link, wholeCard: link !== null };
  }

  const cta = item.cta;
  const label = cta?.label.trim() ?? "";
  const link = cta && label ? resolveNotificationLink(cta.href, cta.target, input.accessPreviewMode) : null;

  if (!cta || !link) {
    return { accessibleLink: null, button: false, cue: null, describedBy: null, display: "button", link: null, wholeCard: false };
  }

  const display = ctaDisplayOf(cta);

  if (display === "card") {
    return { accessibleLink: "title", button: false, cue: label, describedBy: input.cueId ?? null, display, link, wholeCard: true };
  }

  return { accessibleLink: "button", button: true, cue: null, describedBy: null, display, link, wholeCard: display === "button_and_card" };
}

/**
 * Nomes acessiveis dos controles do cartao, com o titulo (ou a frase do comentario): numa lista de
 * botoes ou no rotor, nunca vinte "Excluir notificação" iguais.
 */
export function cardActionLabels(item: Pick<NotificationItem, "reactions" | "title">) {
  const title = item.title.trim();
  const value = item.reactions?.value ?? null;

  return {
    hide: `Excluir notificação “${title}”`,
    /** O "⋯" do canto do cartao (ajustes da v3a): abre o menu com "Excluir notificação". */
    more: `Mais opções da notificação “${title}”`,
    react: `Reagir à notificação “${title}”`,
    reaction: value ? `Sua reação a “${title}”: ${REACTION_LABELS[value]}. Mudar reação` : null
  };
}

/**
 * "Permitir que o aluno exclua do sino" gravado no aviso (campaigns.allow_hide, ajustes da v3a): so o
 * false desliga; ausente ou nulo (aviso de antes, banco sem a migracao) = pode, como sempre foi.
 */
export function allowHideOf(value: unknown): boolean {
  return value !== false;
}

/** O cartao mostra o "⋯" com "Excluir notificação"? Comentario sempre; aviso pelo que a equipe escolheu. */
export function canHideNotification(item: { allowHide?: boolean | null; kind?: NotificationItem["kind"] }): boolean {
  return item.kind !== undefined && item.kind !== "notice" ? true : allowHideOf(item.allowHide);
}

/** O servidor recusou o excluir (403: a equipe desligou depois que a lista chegou): o "⋯" some do cartao. */
export function withHideRefused<T extends object>(item: T): T {
  return { ...item, allowHide: false };
}

/**
 * Escrita que tambem abre a notificacao (reagir, votar): `open` roda so depois que o servidor aceitou.
 * Numa falha (429, 409, rede) nada e marcado: o cartao continua nao lido e a abertura de verdade, depois,
 * ainda vai para o servidor.
 */
export function openAfterWrite<T, R>(send: (value: T) => Promise<R>, open: (value: T, result: R) => void): (value: T) => Promise<R> {
  return (value) =>
    send(value).then((result) => {
      open(value, result);
      return result;
    });
}

/** Escolher a reacao que ja estava tira a reacao; outra troca. */
export function nextReaction(current: ReactionId | null | undefined, picked: ReactionId): ReactionId | null {
  return current === picked ? null : picked;
}

/** Frase da regiao de status depois de reagir. */
export function reactionStatus(value: ReactionId | null) {
  return value ? `Você reagiu com ${REACTION_LABELS[value]}.` : "Reação retirada.";
}

// --- Enquete -------------------------------------------------------------------------------------

/** Toque numa opcao: uma resposta = vota, troca ou tira (a escolhida); varias = marca ou desmarca. */
export function pollPressChoice(poll: Pick<NotificationPoll, "choice" | "multiple">, optionId: string): string[] {
  const chosen = poll.choice.includes(optionId);

  if (!poll.multiple) {
    return chosen ? [] : [optionId];
  }

  const next = chosen ? poll.choice.filter((id) => id !== optionId) : [...poll.choice, optionId];

  return [...new Set(next)].sort();
}

export function samePollChoice(left: readonly string[], right: readonly string[]) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();

  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * O voto na tela antes da resposta do servidor: troca a escolha e, com o resultado ja visivel, move os
 * votos de lugar (e quem votou, ao votar ou tirar o voto). Enquete aberta sem voto nao mostra resultado
 * (notificationPollOf): tirar o voto esconde as porcentagens.
 */
export function applyPollChoice(poll: NotificationPoll, choice: readonly string[]): NotificationPoll {
  const known = new Set(poll.options.map((option) => option.id));
  const next = [...new Set(choice.filter((id) => known.has(id)))].sort();
  let results = poll.results;

  if (results) {
    const counts = { ...results.counts };

    for (const id of poll.choice) {
      counts[id] = Math.max(0, (counts[id] ?? 0) - 1);
    }

    for (const id of next) {
      counts[id] = (counts[id] ?? 0) + 1;
    }

    const joined = poll.choice.length === 0 && next.length > 0 ? 1 : 0;
    const left = poll.choice.length > 0 && next.length === 0 ? 1 : 0;
    results = { counts, voters: Math.max(0, results.voters + joined - left) };
  }

  return { ...poll, choice: next, results: !poll.closed && next.length === 0 ? null : results };
}

/** "1 voto", "128 votos". */
export function pollVotesLabel(count: number) {
  return formatMemberCount(count, "voto");
}

/** "25/10 às 18:00" no fuso de Sao Paulo; data invalida = "". */
export function formatPollEnd(closesAt: string | null) {
  const date = formatMemberDate(closesAt);

  return date ? `${date.slice(0, 5)} às ${formatMemberTime(closesAt)}` : "";
}

export type PollOptionView = {
  chosen: boolean;
  id: string;
  label: string;
  /** Nome acessivel do botao: o rotulo, e com o resultado "Sim, 42%, 54 votos". */
  name: string;
  /** Largura da barra e o numero a direita; null sem resultado. */
  percent: number | null;
  votes: number | null;
};

export type PollView = {
  closed: boolean;
  /** Linha de baixo (12 px): o que fazer, quantos votaram, quando encerra. */
  footer: string;
  options: PollOptionView[];
  resultsVisible: boolean;
  voted: boolean;
};

/** O que a enquete do cartao desenha (docs/24 §1.6). */
export function pollView(poll: NotificationPoll): PollView {
  const results = poll.results;
  const voted = poll.choice.length > 0;
  const options = poll.options.map((option) => {
    const votes = results ? (results.counts[option.id] ?? 0) : null;
    const percent = results && votes !== null ? pollPercent(votes, results.voters) : null;

    return {
      chosen: poll.choice.includes(option.id),
      id: option.id,
      label: option.label,
      name: votes !== null && percent !== null ? `${option.label}, ${percent}%, ${pollVotesLabel(votes)}` : option.label,
      percent,
      votes
    };
  });
  const several = results && poll.multiple ? "Cada pessoa pode marcar mais de uma" : null;
  let footer: string;

  if (poll.closed) {
    footer = results ? [`Enquete encerrada`, pollVotesLabel(results.voters), several].filter(Boolean).join(" · ") : "Enquete encerrada.";
  } else {
    const hint = voted
      ? poll.multiple
        ? "Seu voto foi registrado. Toque para marcar ou desmarcar."
        : "Seu voto foi registrado. Toque em outra opção para mudar, ou na sua para tirar o voto."
      : poll.multiple
        ? "Escolha uma ou mais opções."
        : "Escolha uma opção.";
    const end = formatPollEnd(poll.closesAt);
    const extra = [results ? pollVotesLabel(results.voters) : null, end ? `Encerra em ${end}` : null, several].filter(Boolean);
    footer = extra.length > 0 ? `${hint} ${extra.join(" · ")}` : hint;
  }

  return { closed: poll.closed, footer, options, resultsVisible: results !== null, voted };
}

// --- Aceitar/Recusar e Mudar resposta --------------------------------------------------------------

export type ResponseStage = "answered" | "ask" | "changing";

/** Sem resposta: os dois botoes; respondida: a frase e "Mudar resposta"; trocando: os dois de novo. */
export function responseStage(value: NotificationResponseValue | null, changing: boolean): ResponseStage {
  if (value === null) {
    return "ask";
  }

  return changing ? "changing" : "answered";
}

/** Tocar na resposta que ja vale (ou em "Manter resposta") fecha a troca sem pedido; a outra manda. */
export function responsePress(value: NotificationResponseValue | null, pressed: NotificationResponseValue): "keep" | "send" {
  return value === pressed ? "keep" : "send";
}

export function responseAnswerLabel(value: NotificationResponseValue) {
  return value === "accepted" ? "Você aceitou" : "Você recusou";
}

// --- Frases das escritas do aluno ----------------------------------------------------------------

/** 429 das quatro escritas (reagir, votar, excluir/desfazer, responder). */
export const TOO_MANY_WRITES_MESSAGE = "Muitas tentativas. Espere um pouco.";
export const POLL_CLOSED_MESSAGE = "A enquete foi encerrada.";
export const HIDE_ERROR_MESSAGE = "Não foi possível excluir. Tente de novo.";
export const UNHIDE_ERROR_MESSAGE = "Não foi possível desfazer. Tente de novo.";
export const REACTION_ERROR_MESSAGE = "Não foi possível reagir. Tente de novo.";
export const VOTE_ERROR_MESSAGE = "Não foi possível registrar seu voto. Tente de novo.";
export const HIDDEN_STATUS = "Notificação excluída.";
export const RESTORED_STATUS = "A notificação voltou para o sino.";
export const REFRESH_FAILED_MESSAGE = "Não foi possível atualizar. Estas são as notificações de antes.";

/* ------------------------------------------------------------------------------------------------
 * v3a (docs/24 §7.3): a pagina guardada entre aberturas e a busca por intencao
 * ---------------------------------------------------------------------------------------------- */

/** Pagina com menos que isto: abre sem pedir de novo. */
export const INBOX_REUSE_MS = 5_000;
/** Ate isto: mostra na hora e atualiza por tras; depois, esqueleto. */
export const INBOX_KEEP_MS = 10 * 60_000;
/** Mouse parado no sino (ou foco pelo Tab) antes de buscar. */
export const INBOX_PREFETCH_DWELL_MS = 120;
/** Passar o mouse ou o foco so busca sem pagina guardada ou com mais que isto. */
export const INBOX_INTENT_STALE_MS = 60_000;
/** Depois de fechar o painel, foco e mouse no sino nao buscam (o foco volta para o sino ao fechar). */
export const INBOX_CLOSE_QUIET_MS = 1_000;

export type OpeningPlan = {
  /** Pede a primeira pagina (ou entra no pedido que ja saiu). */
  fetch: boolean;
  render: "kept" | "skeleton";
  /** "abriu o sino": na hora (com a pagina guardada) ou depois que a pagina da tela assentar. */
  seen: "after_fetch" | "now";
};

/**
 * Cada abertura com o filtro "Todas": pagina guardada ha menos de 5 s abre como esta; ate 10 min abre
 * na hora e atualiza por tras; sem pagina (ou mais velha), esqueleto e pedido.
 */
export function openingPlan(fetchedAt: number | null, now: number): OpeningPlan {
  const age = fetchedAt === null ? null : now - fetchedAt;

  if (age === null || age > INBOX_KEEP_MS) {
    return { fetch: true, render: "skeleton", seen: "after_fetch" };
  }

  if (age >= 0 && age < INBOX_REUSE_MS) {
    return { fetch: false, render: "kept", seen: "now" };
  }

  return { fetch: true, render: "kept", seen: "after_fetch" };
}

export type InboxIntentKind = "focus" | "hover" | "press";

/**
 * Busca a lista antes do clique? Nunca com o painel aberto. Apertar (pointerdown, Enter, Espaco) num
 * sino fechado sempre (vai abrir). Mouse e foco: nao no segundo depois de fechar (o foco volta para o
 * sino sozinho) e o foco so quando veio do teclado (:focus-visible).
 */
export function shouldPrefetchOnIntent(input: {
  closedAt: number | null;
  focusVisible: boolean;
  kind: InboxIntentKind;
  now: number;
  open: boolean;
}): boolean {
  if (input.open) {
    return false;
  }

  if (input.kind === "press") {
    return true;
  }

  const sinceClose = input.closedAt === null ? null : input.now - input.closedAt;

  if (sinceClose !== null && sinceClose >= 0 && sinceClose < INBOX_CLOSE_QUIET_MS) {
    return false;
  }

  return input.kind === "hover" || input.focusVisible;
}

/** Idade maxima da pagina guardada que dispensa a busca: apertar usa 5 s; mouse e foco, 1 minuto. */
export function intentPrefetchMinAge(kind: InboxIntentKind) {
  return kind === "press" ? INBOX_REUSE_MS : INBOX_INTENT_STALE_MS;
}

function itemOrder(left: Pick<NotificationItem, "createdAt" | "id">, right: Pick<NotificationItem, "createdAt" | "id">) {
  const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt);

  if (Number.isFinite(byTime) && byTime !== 0) {
    return byTime;
  }

  return right.id < left.id ? -1 : right.id > left.id ? 1 : 0;
}

/**
 * A pagina nova que chegou com o painel aberto (atualizacao por tras): o que o aluno mexeu nesta
 * abertura fica como esta na tela (abriu, reagiu, votou, respondeu) e as linhas excluidas continuam
 * no lugar, com o Desfazer, ate o painel fechar.
 */
export function mergeRefreshedPage<T extends Pick<NotificationItem, "createdAt" | "id">>(
  fresh: readonly T[],
  local: readonly T[],
  input: { excludedIds: ReadonlySet<string>; touchedIds: ReadonlySet<string> }
): T[] {
  const localById = new Map(local.map((item) => [item.id, item]));
  const merged = fresh.map((item) => (input.touchedIds.has(item.id) ? (localById.get(item.id) ?? item) : item));
  const present = new Set(merged.map((item) => item.id));
  const kept = local.filter((item) => input.excludedIds.has(item.id) && !present.has(item.id));

  return kept.length > 0 ? [...merged, ...kept].sort(itemOrder) : merged;
}

export type WriteOutcome<T> = { error: unknown; failed: boolean; value: T };

type WriteOptions<T> = {
  /** O que vale no servidor antes do primeiro toque desta fila. */
  confirmed: T;
  equal: (left: T, right: T) => boolean;
  /** Manda o estado e devolve o que ficou valendo no servidor. */
  send: (value: T) => Promise<T>;
  /** A fila esvaziou: o que vale no servidor (a ultima resposta, ou o de antes) e o erro da ultima tentativa. */
  settle: (outcome: WriteOutcome<T>) => void;
};

type WriteEntry = {
  confirmed: unknown;
  error: unknown;
  failed: boolean;
  inFlight: boolean;
  next: { value: unknown } | null;
  options: WriteOptions<unknown>;
};

/**
 * Escritas do cartao (reacao, voto, excluir e desfazer; docs/24 §4.14): no maximo uma por cartao e tipo
 * em andamento. Toques durante a espera so trocam o estado que vai depois: quando a resposta volta, sai o
 * ultimo (se ainda for diferente do que vale no servidor). Estado igual ao do servidor nao manda nada.
 */
export function createWriteQueue() {
  const entries = new Map<string, WriteEntry>();

  function finish(key: string, entry: WriteEntry) {
    entries.delete(key);
    entry.options.settle({ error: entry.error, failed: entry.failed, value: entry.confirmed });
  }

  function run(key: string, entry: WriteEntry, value: unknown) {
    if (entry.options.equal(value, entry.confirmed)) {
      // Voltou para o que o servidor ja tem: nada a mandar, e um erro de antes nao vale mais.
      entry.error = null;
      entry.failed = false;
      finish(key, entry);
      return;
    }

    entry.inFlight = true;
    entry.options
      .send(value)
      .then(
        (confirmed) => {
          entry.confirmed = confirmed;
          entry.error = null;
          entry.failed = false;
        },
        (error: unknown) => {
          entry.error = error;
          entry.failed = true;
        }
      )
      .finally(() => {
        entry.inFlight = false;
        const next = entry.next;
        entry.next = null;

        if (next) {
          run(key, entry, next.value);
        } else {
          finish(key, entry);
        }
      });
  }

  return {
    /** Ha uma escrita desta chave em andamento? */
    busy(key: string) {
      return entries.get(key)?.inFlight ?? false;
    },
    push<T>(key: string, value: T, options: WriteOptions<T>) {
      let entry = entries.get(key);

      if (!entry) {
        entry = { confirmed: options.confirmed, error: null, failed: false, inFlight: false, next: null, options: options as WriteOptions<unknown> };
        entries.set(key, entry);
      }

      entry.options = options as WriteOptions<unknown>;

      if (entry.inFlight) {
        entry.next = { value };
        return;
      }

      run(key, entry, value);
    }
  };
}
