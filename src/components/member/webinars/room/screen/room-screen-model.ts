// A "Na tela" na sala do aluno (docs/30 §5.1; especificacao de 10/11/2026, §3.5 e §5.2), a parte pura: qual estado a
// sala adota (o da leitura da sessao sempre; o da consulta de 5 s do chat so quando o carimbo e outro), o que o aluno
// fechou (por exibicao, no sessionStorage: recarregar nao traz de volta, um novo Mostrar e outra exibicao) e o que fica
// na tela depois disso. Sem "use client" e com imports relativos: os testes carregam pelo Node. Nada aqui le o
// navegador: quem le e escreve o sessionStorage e use-room-screen.ts.
// O banner e o QR Code do aluno (§3.2 a §3.7 e §7; fatia S9):
// - onde cada um fica no palco de 640 px ou mais (screenPlacement: a grade 3x3, o empilhar do banner em cima do QR
//   Code, o juntar ou dividir a area quando os dois estao em posicoes diferentes (screenPairSplit, screenCellLimits),
//   a Oferta dona da coluna da direita, as pilulas das fixadas primeiro na celula de cima a esquerda, e quando as
//   pilulas do chat e o selo do Assistente saem do palco largo), as larguras por tamanho (clamp em cqw, nunca mais de
//   40 % do palco) e as celulas;
// - o que manda tudo para a faixa abaixo do palco: qualquer capa no palco (screenStripForcedLive e
//   screenStripForcedRecorded); a regra dos 640 px e a da tela baixa sao so CSS (o recipiente @container/tela e
//   SCREEN_WIDE_ONLY / SCREEN_NARROW_FLEX);
// - os textos: o nome da secao, o titulo e a segunda linha da faixa, o anuncio educado de cada chegada (a saida e
//   silenciosa) e quando a linha da faixa tem o Mostrar / Recolher;
// - o envio das metricas (o viu depois de 1 s com 50 % ou mais na tela, a aba visivel e sem a enquete do palco por
//   cima, uma vez por exibicao, mandado depois de 0 a 5 s ao acaso; o clique e o fechar pelo sendBeacon na hora; lotes de
//   ate 6), com o relogio, o acaso e o envio injetados (createShownWatcher, createScreenEventSender): o hook so liga o
//   IntersectionObserver, o visibilitychange e o pagehide.

import { linkDomain, safeHttpsUrl } from "../../../../../lib/webinar-links";
import { WEBINAR_COPY } from "../../../../../lib/webinar-copy";
import {
  SCREEN_LIMITS,
  SCREEN_PLACES,
  type ScreenEventForm,
  type ScreenEventName,
  type ScreenEventTarget,
  type ScreenPlace,
  type ScreenSize,
  type StudentScreenItem,
  type StudentScreenState
} from "../../../../../server/webinars/screen-model";

/** De onde o estado chegou: a leitura da sessao (a pagina, a releitura de 60 s, a volta para a aba) ou o chat de 5 s. */
export type ScreenOrigin = "chat" | "session";

/**
 * O estado que a sala passa a ter. O da sessao sempre entra; o do chat entra quando o carimbo e diferente do que a sala
 * tem (igualdade, sem ordem: o carimbo e o updated_at da sessao, e o servidor so manda quando mudou). Sem estado novo,
 * fica o atual.
 */
export function adoptScreen(current: StudentScreenState | null, incoming: StudentScreenState | null | undefined, origin: ScreenOrigin): StudentScreenState | null {
  if (!incoming) {
    return current;
  }
  if (origin === "session") {
    return incoming;
  }
  return current && current.stamp === incoming.stamp ? current : incoming;
}

/** A chave do sessionStorage com as exibicoes que o aluno fechou nesta sessao. */
export function screenClosedKey(sessionId: string): string {
  return `bunker707:webinar-sala-tela-fechados:${sessionId}`;
}

/** A chave do sessionStorage com as exibicoes que o aluno ja viu (o "viu" vai uma vez por exibicao). */
export function screenSeenKey(sessionId: string): string {
  return `bunker707:webinar-sala-tela-vistos:${sessionId}`;
}

/** No maximo quantos ids guardados (uma sessao tem poucas exibicoes; o resto e lixo de um valor estragado). */
const CLOSED_MAX = 200;

/** Os ids guardados (os fechados e os vistos): uma lista de textos; o que falta ou vem estragado e vazio. */
export function storedClosedIds(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 64).slice(-CLOSED_MAX) : [];
  } catch {
    return [];
  }
}

/** O valor que vai para o sessionStorage depois de fechar `displayId` (sem repetir; os mais antigos saem do teto). */
export function closedIdsValue(current: readonly string[], displayId: string): string {
  const next = current.includes(displayId) ? [...current] : [...current, displayId];
  return JSON.stringify(next.slice(-CLOSED_MAX));
}

/** O banner e o QR Code que continuam na tela para este aluno: o que ele fechou some, so o que pode ser fechado. */
export function visibleScreenItems(items: readonly StudentScreenItem[], closedIds: readonly string[]): StudentScreenItem[] {
  const closed = new Set(closedIds);
  return items.filter((item) => !(item.closable && closed.has(item.displayId)));
}

/* ------------------------------------------------------------------------------------------------
 * O palco largo: as posicoes, o empilhar e as colisoes (§3.2)
 * ---------------------------------------------------------------------------------------------- */

/** Uma entrada de uma celula da grade, de cima para baixo: as pilulas das fixadas ou um item. */
export type ScreenCellEntry = { kind: "pinned" } | { item: StudentScreenItem; kind: "item" };

/**
 * A metade da area segura que a celula pode usar quando banner e QR Code ficam em celulas separadas: `width` (um a
 * esquerda e o outro a direita), `height` (um em cima e o outro embaixo); nulo, a area inteira.
 */
export type ScreenCellSplit = "height" | "width";

export type ScreenCell = { entries: ScreenCellEntry[]; place: ScreenPlace; split: ScreenCellSplit | null };

export type ScreenPlacement = {
  /** O selo do Assistente pode ficar no palco largo (nenhum item em "Embaixo, à direita"). */
  assistant: boolean;
  /** As celulas usadas, na ordem da grade (linha a linha). */
  cells: ScreenCell[];
  /** As pilulas do chat podem ficar no palco largo (nenhum item na fileira de baixo nem na do meio). */
  chatPills: boolean;
};

const KIND_ORDER: Record<StudentScreenItem["kind"], number> = { banner: 0, qr: 1 };

/** A fileira (0 em cima, 2 embaixo) e a coluna (0 a esquerda, 2 a direita) de uma posicao da grade. */
function gridOf(place: ScreenPlace): { col: number; row: number } {
  const index = SCREEN_PLACES.indexOf(place);
  return { col: index % 3, row: Math.floor(index / 3) };
}

/** A coluna da direita: com a Oferta no palco ela e da Oferta, e o item vai para a mesma fileira, a esquerda. */
const OFFER_MOVES: Partial<Record<ScreenPlace, ScreenPlace>> = { bottom_right: "bottom_left", middle_right: "middle_left", top_right: "top_left" };

/**
 * A posicao de um item no palco: com a Oferta no palco (Live gravada), o card dela cobre a coluna da direita inteira
 * (ate 430 px de altura com a imagem), e o item da direita vai para a esquerda, na mesma fileira.
 */
export function screenPlaceOf(place: ScreenPlace, offerShown: boolean): ScreenPlace {
  return offerShown ? (OFFER_MOVES[place] ?? place) : place;
}

/**
 * Como banner e QR Code em duas posicoes diferentes dividem a area segura (cada celula pode ter ate a area inteira, e
 * duas celulas sem regra se cobrem): na mesma fileira, na mesma coluna ou em diagonal com uma delas encostada no meio,
 * juntam numa celula so (`join`); em lados opostos sem dividir fileira nem coluna, cada uma fica com metade da largura
 * (`width`: uma a esquerda e a outra a direita) ou, senao, da altura (`height`: uma em cima e a outra embaixo).
 */
export function screenPairSplit(a: ScreenPlace, b: ScreenPlace): ScreenCellSplit | "join" {
  const first = gridOf(a);
  const second = gridOf(b);
  if (first.row === second.row || first.col === second.col) {
    return "join";
  }
  if (Math.abs(first.col - second.col) === 2) {
    return "width";
  }
  return Math.abs(first.row - second.row) === 2 ? "height" : "join";
}

/**
 * Onde cada coisa fica no palco de 640 px ou mais (a tabela de colisoes da §3.2): cada item na posicao escolhida (com a
 * Oferta, a coluna da direita vai para a esquerda); banner e QR Code na mesma posicao empilham, o banner em cima; em
 * posicoes diferentes, pela screenPairSplit: juntam na primeira das duas na ordem da grade (de cima para baixo, da
 * esquerda para a direita), o banner em cima, ou ficam separados com metade da area cada; as pilulas das fixadas sao as
 * primeiras da celula de cima a esquerda, e o item dessa posicao fica abaixo delas; um item na fileira de baixo ou na
 * do meio tira as pilulas do chat do palco largo; um item em "Embaixo, à direita" tira o selo do Assistente (as duas
 * regras pela posicao escolhida, antes de juntar: a pilha cresce na direcao dela). A enquete do palco fica por cima de
 * tudo (a camada dela e outra). Com a faixa forcada (a capa), a sala passa a lista vazia: nada sobre o video.
 */
export function screenPlacement(input: { items: readonly StudentScreenItem[]; offerShown: boolean; pinnedPills: boolean }): ScreenPlacement {
  const chosen = input.items.map((item) => ({ item, place: screenPlaceOf(item.place, input.offerShown) }));
  const places = [...new Set(chosen.map((entry) => entry.place))];
  // Duas posicoes (o banner e o QR Code, um de cada no maximo): juntam ou dividem a area.
  const pair = places.length === 2 ? screenPairSplit(places[0], places[1]) : null;
  const joinedAt = pair === "join" ? SCREEN_PLACES.find((place) => places.includes(place)) : undefined;
  const split = pair === "join" ? null : pair;

  const byPlace = new Map<ScreenPlace, StudentScreenItem[]>();
  for (const { item, place } of chosen) {
    const at = joinedAt ?? place;
    byPlace.set(at, [...(byPlace.get(at) ?? []), item]);
  }
  const cells: ScreenCell[] = [];
  for (const place of SCREEN_PLACES) {
    const items = [...(byPlace.get(place) ?? [])].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    const entries: ScreenCellEntry[] = items.map((item) => ({ item, kind: "item" }));
    if (place === "top_left" && input.pinnedPills) {
      entries.unshift({ kind: "pinned" });
    }
    if (entries.length > 0) {
      cells.push({ entries, place, split: items.length > 0 ? split : null });
    }
  }
  return {
    assistant: !places.includes("bottom_right"),
    cells,
    chatPills: !places.some((place) => gridOf(place).row > 0)
  };
}

/**
 * Onde cada celula fica na area segura (a caixa dentro do palco sem os 56 px dos selos de cima e de baixo, os 12 px da
 * esquerda e os 12 px mais a coluna de miniaturas da direita): a coluna pela borda (ou centrada), a linha pela borda (ou
 * centrada); a de baixo empilha de baixo para cima e sobe a altura do aviso da sala no palco mais 8 px
 * (--room-snackbar-offset, como as pilulas do chat).
 */
export const SCREEN_CELL_CLASSES: Readonly<Record<ScreenPlace, string>> = {
  top_left: "left-0 top-0 items-start",
  top_center: "left-1/2 top-0 -translate-x-1/2 items-center",
  top_right: "right-0 top-0 items-end",
  middle_left: "left-0 top-1/2 -translate-y-1/2 items-start",
  center: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center",
  middle_right: "right-0 top-1/2 -translate-y-1/2 items-end",
  bottom_left: "bottom-[var(--room-snackbar-offset,0px)] left-0 items-start justify-end",
  bottom_center: "bottom-[var(--room-snackbar-offset,0px)] left-1/2 -translate-x-1/2 items-center justify-end",
  bottom_right: "bottom-[var(--room-snackbar-offset,0px)] right-0 items-end justify-end"
};

/**
 * O tamanho maximo da celula: a area segura inteira ou, separada do outro item, a metade dela naquele eixo (menos 4 px:
 * 8 px entre as duas); a de baixo desconta o que ela subiu pelo aviso da sala.
 */
export function screenCellLimits(cell: Pick<ScreenCell, "place" | "split">): string {
  const bottom = gridOf(cell.place).row === 2;
  const height =
    cell.split === "height"
      ? bottom
        ? "max-h-[calc(50%-4px-var(--room-snackbar-offset,0px))]"
        : "max-h-[calc(50%-4px)]"
      : bottom
        ? "max-h-[calc(100%-var(--room-snackbar-offset,0px))]"
        : "max-h-full";
  return `${height} ${cell.split === "width" ? "max-w-[calc(50%-4px)]" : "max-w-full"}`;
}

/**
 * Na pilha (o banner e o QR Code na mesma celula), quem encolhe primeiro e o banner, que rola por dentro e guarda 56 px
 * (o X e o comeco dele): o QR Code fica inteiro enquanto couber, com a legenda, o Abrir o link e o X na tela.
 */
export const SCREEN_STACK_BANNER = "min-h-14 shrink-[999]";

/** A largura do banner por tamanho, pela largura do palco (cqw da camada @container/tela); nunca passa de 40 % dele. */
export const SCREEN_BANNER_WIDTH: Readonly<Record<ScreenSize, string>> = {
  s: "w-[clamp(200px,22cqw,280px)]",
  m: "w-[clamp(240px,30cqw,380px)]",
  l: "w-[clamp(280px,40cqw,520px)]"
};

/* ------------------------------------------------------------------------------------------------
 * O palco largo e o estreito: a regra so de CSS
 * ---------------------------------------------------------------------------------------------- */

/**
 * O que so aparece no palco largo (os cartoes e as pilulas das fixadas): 640 px ou mais de palco (a camada e o
 * recipiente @container/tela) e a tela com mais de 500 px de altura. O celular deitado (844 x 390) tem o palco largo e
 * baixo (uns 254 px, a area segura com uns 142 px): nele o QR Code e cortado e os cartoes se cobrem, entao ele usa a
 * faixa como o palco estreito. A tela baixa vence sempre (!important): a ordem das regras no CSS nao importa.
 */
export const SCREEN_WIDE_ONLY = "hidden [@media(max-height:500px)]:hidden! @min-[640px]/tela:flex";

/**
 * O que some do palco largo (a faixa, as linhas compactas da tela cheia), mostrado de novo na tela baixa (flex). As
 * pilulas do chat e o selo do Assistente (room-wide-hidden.tsx, modulo folha) escrevem a mesma regra com display contents.
 */
export const SCREEN_NARROW_FLEX = "@min-[640px]/tela:hidden [@media(max-height:500px)]:flex!";


/* ------------------------------------------------------------------------------------------------
 * O foco: quando a sala confere se ele caiu fora (refocusRoom)
 * ---------------------------------------------------------------------------------------------- */

/**
 * O resumo do que a Na tela poe e tira da sala, para o efeito que devolve o foco a ela (refocusRoom) quando a peca que o
 * tinha saiu: cada item e a celula onde esta (a Oferta e o QR Code que chega mudam o item de celula, e ele e montado de
 * novo), a capa, a tela cheia, a mensagem e a enquete fixadas (a pilula, a linha da faixa e o Mostrar tudo da area sao
 * montados por elas) e as pilulas ou linhas das fixadas na tela. Mudou, a sala confere; com o foco ainda dentro dela,
 * nada acontece.
 */
export function screenFocusKey(input: {
  forced: boolean;
  fullscreen: boolean;
  items: readonly Pick<StudentScreenItem, "displayId">[];
  pinnedMessageId: string | null;
  pinnedPollId: string | null;
  pinnedShortcuts: boolean;
  placement: Pick<ScreenPlacement, "cells">;
}): string {
  const cells = input.placement.cells.map((cell) => `${cell.place}:${cell.entries.map((entry) => (entry.kind === "pinned" ? "pinned" : entry.item.displayId)).join("+")}`);
  return [
    input.items.map((item) => item.displayId).join(","),
    cells.join(","),
    input.forced,
    input.fullscreen,
    input.pinnedMessageId ?? "",
    input.pinnedPollId ?? "",
    input.pinnedShortcuts
  ].join("|");
}

/* ------------------------------------------------------------------------------------------------
 * A faixa (§3.3 e §3.4): o que a manda para fora do video
 * ---------------------------------------------------------------------------------------------- */

/**
 * A Live ao vivo com uma capa no palco (antes de "Entrar na sala", "Abrindo a sala…", "Reconectando…", a espera, a sala
 * trancada, a falha): tudo vai para a faixa, mesmo no palco largo. So a sala aberta com a pessoa dentro fica sem capa.
 */
export function screenStripForcedLive(input: { entry: string; screen: string }): boolean {
  return !(input.screen === "open" && input.entry === "joined");
}

/** A Live gravada com uma capa no palco (a espera, "Ativar som", a sessao sem video, o fim): tudo vai para a faixa. */
export function screenStripForcedRecorded(input: { hasVideo: boolean; soundCover: boolean; stageState: string }): boolean {
  return input.stageState !== "live" || !input.hasVideo || input.soundCover;
}

/* ------------------------------------------------------------------------------------------------
 * Os textos do cartao e da linha (§3.3 e §3.7)
 * ---------------------------------------------------------------------------------------------- */

/** O titulo do item: o do banner (sem ele, a descricao da imagem); a legenda do QR Code (sem ela, nulo). */
export function screenTitleOf(item: Pick<StudentScreenItem, "image" | "kind" | "title">): string | null {
  if (item.kind === "qr") {
    return item.title;
  }
  return item.title ?? item.image?.alt ?? null;
}

/** O nome da secao (nao modal) do cartao e da linha: "Banner da equipe: {título}" ou "QR Code da equipe: {legenda}". */
export function screenSectionName(item: Pick<StudentScreenItem, "image" | "kind" | "title">): string {
  const aluno = WEBINAR_COPY.naTela.aluno;
  return item.kind === "qr" ? aluno.secaoQr(item.title) : aluno.secaoBanner(screenTitleOf(item) ?? "");
}

/** A primeira linha da faixa: o titulo; no QR Code sem legenda, "QR Code". */
export function screenRowTitle(item: Pick<StudentScreenItem, "image" | "kind" | "title">): string {
  return screenTitleOf(item) ?? WEBINAR_COPY.naTela.tipos[item.kind];
}

/** A segunda linha da faixa: o texto do banner (numa linha); no QR Code, o dominio do link. */
export function screenRowDetail(item: Pick<StudentScreenItem, "body" | "kind" | "linkUrl">): string | null {
  if (item.kind === "qr") {
    return linkDomain(item.linkUrl);
  }
  return item.body ? item.body.replace(/\s+/g, " ").trim() : null;
}

/** A linha da faixa tem o Mostrar / Recolher quando ha mais para ver: a imagem, o texto do banner ou o QR Code. */
export function screenRowExpandable(item: Pick<StudentScreenItem, "body" | "image" | "kind">): boolean {
  return item.kind === "qr" || item.image !== null || Boolean(item.body);
}

/** O link do item, conferido de novo no navegador (so https seguro; o QR Code com o limite dele); senao, nenhum. */
export function screenLinkOf(item: Pick<StudentScreenItem, "kind" | "linkUrl">): string | null {
  return safeHttpsUrl(item.linkUrl, item.kind === "qr" ? SCREEN_LIMITS.qrLink : SCREEN_LIMITS.link);
}

/** O endereco da imagem so quando e o caminho publico do nosso bucket (a origem o servidor ja conferiu). */
const SCREEN_IMAGE_SRC = /^https?:\/\/[a-z0-9.\-[\]:]+\/storage\/v1\/object\/public\/content-assets\/webinars\/screen\/[a-f0-9]{24}\.webp$/;

export function screenImageSrc(url: string | null | undefined): string | null {
  return typeof url === "string" && SCREEN_IMAGE_SRC.test(url) ? url : null;
}

/** O que o banner faz com o link: o botao (com o texto do botao), o banner inteiro (sem ele) ou nada (sem link). */
export function screenBannerAction(item: Pick<StudentScreenItem, "buttonLabel" | "kind" | "linkUrl">): "button" | "card" | "none" {
  if (!screenLinkOf(item)) {
    return "none";
  }
  return item.buttonLabel ? "button" : "card";
}

/** As exibicoes que chegaram agora (as que a sala nao tinha); a primeira leitura nao anuncia nada. */
export function screenArrivals(known: readonly string[], items: readonly StudentScreenItem[]): StudentScreenItem[] {
  const before = new Set(known);
  return items.filter((item) => !before.has(item.displayId));
}

/**
 * O anuncio educado das chegadas: "A equipe colocou um banner na tela: {título}." ou "A equipe mostrou um QR Code:
 * {legenda}. O link está no botão Abrir o link."; duas de uma vez, uma depois da outra. A saida e silenciosa.
 */
export function screenAnnouncement(arrivals: readonly StudentScreenItem[]): string {
  const aluno = WEBINAR_COPY.naTela.aluno;
  return arrivals.map((item) => (item.kind === "qr" ? aluno.anuncioQr(item.title) : aluno.anuncioBanner(screenTitleOf(item) ?? ""))).join(" ");
}

/* ------------------------------------------------------------------------------------------------
 * As metricas (§7): o "viu" e o envio
 * ---------------------------------------------------------------------------------------------- */

/** Quanto do cartao ou da linha precisa estar na tela para contar. */
export const SCREEN_SHOWN_RATIO = 0.5;
/** Quanto tempo seguido na tela (com a aba visivel e sem a enquete do palco por cima) para contar como "viu". */
export const SCREEN_SHOWN_AFTER_MS = 1000;
/** O "viu" sai depois de 0 a 5 s ao acaso (1.000 alunos nao mandam no mesmo segundo). */
export const SCREEN_SHOWN_JITTER_MS = 5000;

export type ScreenEvent = { displayId: string; form: ScreenEventForm; name: ScreenEventName; target?: ScreenEventTarget };

/** O relogio injetado (o hook passa o window; os testes, um relogio falso). */
export type ScreenTimers = { clearTimer: (id: unknown) => void; setTimer: (callback: () => void, ms: number) => unknown };

/** O atraso do "viu": de 0 a 5 s, pelo acaso (0 a 1). */
export function screenShownDelayMs(random: number): number {
  const value = Number.isFinite(random) ? Math.min(Math.max(random, 0), 1) : 0;
  return Math.round(value * SCREEN_SHOWN_JITTER_MS);
}

/** Os corpos de POST .../screen-events: { sessionId, events } em lotes de ate 6 (SCREEN_LIMITS.eventsPerBatch). */
export function screenEventBodies(sessionId: string, events: readonly ScreenEvent[]): string[] {
  const bodies: string[] = [];
  for (let index = 0; index < events.length; index += SCREEN_LIMITS.eventsPerBatch) {
    const batch = events.slice(index, index + SCREEN_LIMITS.eventsPerBatch).map(({ displayId, form, name, target }) => (target ? { displayId, form, name, target } : { displayId, form, name }));
    bodies.push(JSON.stringify({ events: batch, sessionId }));
  }
  return bodies;
}

export type ScreenEventSender = {
  /** O pagehide e o fim da sala: o que esta na fila e os "viu" que esperam o atraso, pelo sendBeacon. */
  flushAll: () => void;
  /** Quantos "viu" esperam o atraso (os testes). */
  pending: () => number;
  send: (event: ScreenEvent) => void;
};

/**
 * O envio das metricas: o "viu" uma vez por exibicao (`seen`, o sessionStorage), depois do atraso de 0 a 5 s, pelo
 * fetch (keepalive); o clique e o fechar na hora, pelo sendBeacon (o link de verdade abre a outra aba enquanto isso),
 * levando junto o que estiver na fila; lotes de ate 6. Falha de envio nao volta: a metrica e secundaria.
 */
export function createScreenEventSender(deps: ScreenTimers & {
  beacon: (body: string) => void;
  post: (body: string) => Promise<unknown>;
  random: () => number;
  seen: { add: (displayId: string) => void; has: (displayId: string) => boolean };
  sessionId: string;
}): ScreenEventSender {
  let queue: ScreenEvent[] = [];
  const waiting = new Map<unknown, ScreenEvent>();

  function drain(mode: "beacon" | "post") {
    const events = queue;
    queue = [];
    for (const body of screenEventBodies(deps.sessionId, events)) {
      if (mode === "beacon") {
        deps.beacon(body);
      } else {
        void deps.post(body).catch(() => undefined);
      }
    }
  }

  return {
    flushAll() {
      for (const [timer, event] of waiting) {
        deps.clearTimer(timer);
        queue.push(event);
      }
      waiting.clear();
      if (queue.length > 0) {
        drain("beacon");
      }
    },
    pending: () => waiting.size,
    send(event) {
      if (event.name !== "shown") {
        queue.push(event);
        drain("beacon");
        return;
      }
      if (deps.seen.has(event.displayId)) {
        return;
      }
      deps.seen.add(event.displayId);
      const timer: unknown = deps.setTimer(() => {
        waiting.delete(timer);
        queue.push(event);
        drain("post");
      }, screenShownDelayMs(deps.random()));
      waiting.set(timer, event);
    }
  };
}

export type ShownWatcher = {
  dispose: () => void;
  remove: (key: unknown) => void;
  /** A aba visivel e a enquete do palco por cima: valem para todos os cartoes e linhas. */
  setGlobal: (patch: { pollOver?: boolean; visible?: boolean }) => void;
  /** O cartao ou a linha `key` com 50 % ou mais na tela (`intersecting`), ou nao. */
  update: (key: unknown, info: { displayId: string; form: ScreenEventForm; intersecting: boolean }) => void;
};

/**
 * O "viu" de cada cartao e linha: conta quando ele fica 1 s seguido com 50 % ou mais na tela, com a aba visivel e sem a
 * enquete do palco por cima; qualquer interrupcao recomeca a conta. Uma vez por exibicao (a mesma exibicao pode estar
 * no cartao e na linha da faixa, so uma delas na tela por vez).
 */
export function createShownWatcher(deps: ScreenTimers & { onShown: (displayId: string, form: ScreenEventForm) => void; pollOver: boolean; visible: boolean }): ShownWatcher {
  const targets = new Map<unknown, { displayId: string; form: ScreenEventForm; intersecting: boolean; timer: unknown }>();
  const done = new Set<string>();
  let pollOver = deps.pollOver;
  let visible = deps.visible;

  function refresh(key: unknown) {
    const target = targets.get(key);
    if (!target) {
      return;
    }
    const eligible = target.intersecting && visible && !pollOver && !done.has(target.displayId);
    if (eligible && target.timer === null) {
      target.timer = deps.setTimer(() => {
        target.timer = null;
        if (done.has(target.displayId)) {
          return;
        }
        done.add(target.displayId);
        deps.onShown(target.displayId, target.form);
      }, SCREEN_SHOWN_AFTER_MS);
    } else if (!eligible && target.timer !== null) {
      deps.clearTimer(target.timer);
      target.timer = null;
    }
  }

  return {
    dispose() {
      for (const target of targets.values()) {
        if (target.timer !== null) {
          deps.clearTimer(target.timer);
        }
      }
      targets.clear();
    },
    remove(key) {
      const target = targets.get(key);
      if (target?.timer !== null && target?.timer !== undefined) {
        deps.clearTimer(target.timer);
      }
      targets.delete(key);
    },
    setGlobal(patch) {
      pollOver = patch.pollOver ?? pollOver;
      visible = patch.visible ?? visible;
      for (const key of targets.keys()) {
        refresh(key);
      }
    },
    update(key, info) {
      const target = targets.get(key);
      if (target && target.displayId === info.displayId && target.form === info.form) {
        target.intersecting = info.intersecting;
      } else {
        if (target?.timer !== null && target?.timer !== undefined) {
          deps.clearTimer(target.timer);
        }
        targets.set(key, { ...info, timer: null });
      }
      refresh(key);
    }
  };
}
