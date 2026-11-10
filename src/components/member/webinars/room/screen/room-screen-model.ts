// A "Na tela" na sala do aluno (docs/30 §5.1; especificacao de 10/11/2026, §3.5 e §5.2), a parte pura: qual estado a
// sala adota (o da leitura da sessao sempre; o da consulta de 5 s do chat so quando o carimbo e outro), o que o aluno
// fechou (por exibicao, no sessionStorage: recarregar nao traz de volta, um novo Mostrar e outra exibicao) e o que fica
// na tela depois disso. Sem "use client" e com imports relativos: os testes carregam pelo Node. Nada aqui le o
// navegador: quem le e escreve o sessionStorage e use-room-screen.ts.
// O banner e o QR Code do aluno (§3.2 a §3.7 e §7; fatia S9):
// - onde cada um fica no palco de 640 px ou mais (screenPlacement: a grade 3x3, o empilhar do banner em cima do QR
//   Code, a Oferta dona do canto de baixo a direita, as pilulas das fixadas primeiro na celula de cima a esquerda, e
//   quando as pilulas do chat e o selo do Assistente saem do palco largo), as larguras por tamanho (clamp em cqw, nunca
//   mais de 40 % do palco) e as celulas;
// - o que manda tudo para a faixa abaixo do palco: qualquer capa no palco (screenStripForcedLive e
//   screenStripForcedRecorded); a regra dos 640 px e so CSS (o recipiente @container/tela);
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

export type ScreenCell = { entries: ScreenCellEntry[]; place: ScreenPlace };

export type ScreenPlacement = {
  /** O selo do Assistente pode ficar no palco largo (nenhum item em "Embaixo, à direita"). */
  assistant: boolean;
  /** As celulas usadas, na ordem da grade (linha a linha). */
  cells: ScreenCell[];
  /** As pilulas do chat podem ficar no palco largo (nenhum item na fileira de baixo nem "No meio"). */
  chatPills: boolean;
};

const BOTTOM_ROW: ReadonlySet<ScreenPlace> = new Set(["bottom_left", "bottom_center", "bottom_right"]);
const KIND_ORDER: Record<StudentScreenItem["kind"], number> = { banner: 0, qr: 1 };

/** A posicao de um item no palco: com a Oferta no palco (Live gravada), o canto de baixo a direita e dela e o item vai para baixo a esquerda. */
export function screenPlaceOf(place: ScreenPlace, offerShown: boolean): ScreenPlace {
  return offerShown && place === "bottom_right" ? "bottom_left" : place;
}

/**
 * Onde cada coisa fica no palco de 640 px ou mais (a tabela de colisoes da §3.2): cada item na posicao escolhida (a
 * Oferta empurra o de baixo a direita para baixo a esquerda); banner e QR Code na mesma posicao empilham, o banner em
 * cima; as pilulas das fixadas sao as primeiras da celula de cima a esquerda, e o item dessa posicao fica abaixo delas;
 * um item na fileira de baixo ou "No meio" tira as pilulas do chat do palco largo; um item em "Embaixo, à direita" tira
 * o selo do Assistente. A enquete do palco fica por cima de tudo (a camada dela e outra). Com a faixa forcada (a capa),
 * a sala passa a lista vazia: nada sobre o video.
 */
export function screenPlacement(input: { items: readonly StudentScreenItem[]; offerShown: boolean; pinnedPills: boolean }): ScreenPlacement {
  const byPlace = new Map<ScreenPlace, StudentScreenItem[]>();
  for (const item of input.items) {
    const place = screenPlaceOf(item.place, input.offerShown);
    byPlace.set(place, [...(byPlace.get(place) ?? []), item]);
  }
  const cells: ScreenCell[] = [];
  for (const place of SCREEN_PLACES) {
    const items = [...(byPlace.get(place) ?? [])].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
    const entries: ScreenCellEntry[] = items.map((item) => ({ item, kind: "item" }));
    if (place === "top_left" && input.pinnedPills) {
      entries.unshift({ kind: "pinned" });
    }
    if (entries.length > 0) {
      cells.push({ entries, place });
    }
  }
  const places = [...byPlace.keys()];
  return {
    assistant: !places.includes("bottom_right"),
    cells,
    chatPills: !places.some((place) => BOTTOM_ROW.has(place) || place === "center")
  };
}

/**
 * Onde cada celula fica na area segura (a caixa dentro do palco sem os 56 px dos selos de cima e de baixo, os 12 px da
 * esquerda e os 12 px mais a coluna de miniaturas da direita): a coluna pela borda (ou centrada), a linha pela borda (ou
 * centrada); a de baixo empilha de baixo para cima.
 */
export const SCREEN_CELL_CLASSES: Readonly<Record<ScreenPlace, string>> = {
  top_left: "left-0 top-0 items-start",
  top_center: "left-1/2 top-0 -translate-x-1/2 items-center",
  top_right: "right-0 top-0 items-end",
  middle_left: "left-0 top-1/2 -translate-y-1/2 items-start",
  center: "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center",
  middle_right: "right-0 top-1/2 -translate-y-1/2 items-end",
  bottom_left: "bottom-0 left-0 items-start justify-end",
  bottom_center: "bottom-0 left-1/2 -translate-x-1/2 items-center justify-end",
  bottom_right: "bottom-0 right-0 items-end justify-end"
};

/** A largura do banner por tamanho, pela largura do palco (cqw da camada @container/tela); nunca passa de 40 % dele. */
export const SCREEN_BANNER_WIDTH: Readonly<Record<ScreenSize, string>> = {
  s: "w-[clamp(200px,22cqw,280px)]",
  m: "w-[clamp(240px,30cqw,380px)]",
  l: "w-[clamp(280px,40cqw,520px)]"
};

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
