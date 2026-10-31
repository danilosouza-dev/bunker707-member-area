// A Sala Live vertical 9:16 (docs/30 §1.6, §6.6, §1.7 e §9), a parte pura: quando a sala usa o desenho do celular em
// pe, o esqueleto da sala nos dois desenhos e o que muda no topo e no chat. E a mesma pagina, a mesma sessao, o
// mesmo relogio e as mesmas rotas; so o desenho muda. O palco (o iframe do player) fica SEMPRE no mesmo lugar da
// arvore (corpo > coluna do palco > caixa do palco > palco): girar o aparelho troca so as classes desses tres, o React nao remonta o player e o navegador nao recarrega o iframe (mover um iframe no DOM
// recarrega o video). Por isso o desenho vertical nao e outra arvore: e o mesmo esqueleto com outras classes e as
// pecas por cima (topo, chat, gaveta). O desenho vertical vale para a Live gravada e o Replay; a Live ao vivo fica de
// fora dele ate o palco ser gravado em 9:16, mas usa o esqueleto do desenho normal (roomSkeleton("normal"), docs/31
// V2-6: o mesmo corpo, a mesma coluna e a mesma caixa do palco). Modulo puro (sem React e sem rede): os testes carregam
// pelo Node direto; os imports sao relativos.

import { WEBINAR_COPY } from "../../../../../lib/webinar-copy";
import type { ComposerState, RoomMessage } from "../../../../../lib/webinar-room-client";
import type { RoomTheme } from "../../../../../lib/webinar-room-prefs";
import type { SimulatedPhase } from "../../../../../server/webinars/model";

export const ROOM_DESIGNS = ["normal", "vertical"] as const;
export type RoomDesign = (typeof ROOM_DESIGNS)[number];

/** O celular em pe: retrato e ate 767 px de largura (o `md` do Tailwind comeca em 768). Deitado, tablet e computador: normal. */
export const VERTICAL_ROOM_QUERY = "(orientation: portrait) and (max-width: 767px)";

export const VERTICAL_LIMITS = {
  /** Quantas mensagens o chat por cima mostra (as ultimas); o resto fica na gaveta (Ver mais mensagens). */
  overlayMessages: 6
} as const;

/**
 * O desenho da sala: o forcado (a previa e os testes) vence; senao o celular em pe decide. A consulta e da viewport,
 * nao do aparelho: nas WebViews dos apps (Instagram, TikTok, Facebook) e no Firefox do Android o teclado encolhe a
 * viewport (360x640 vira uns 360x330, "deitado"). Enquanto o aluno digita num campo da sala (`editing`) a troca
 * vertical -> normal fica travada: senao o campo desmontava, o teclado fechava, a tela voltava a retrato e a sala
 * entrava num laco sem deixar escrever. `portraitScreen` (screen.orientation, que nao muda com o teclado) confirma:
 * com o aparelho de fato deitado (false), a troca vale mesmo digitando; sem a leitura (null), vale o travamento.
 */
export function roomDesignFor(input: {
  editing?: boolean;
  forced?: RoomDesign | null;
  portraitPhone: boolean;
  portraitScreen?: boolean | null;
  previous?: RoomDesign | null;
}): RoomDesign {
  if (input.forced === "normal" || input.forced === "vertical") {
    return input.forced;
  }
  if (input.portraitPhone) {
    return "vertical";
  }
  if (input.previous === "vertical" && input.editing === true && input.portraitScreen !== false) {
    return "vertical";
  }
  return "normal";
}

/** O minimo de um elemento que a sala confere (o campo em foco). */
export type FocusLike = { closest?: (selector: string) => unknown; isContentEditable?: boolean; tagName?: string; type?: string } | null | undefined;

const TEXT_INPUT_TYPES = new Set(["", "email", "number", "password", "search", "tel", "text", "url"]);

/** O foco esta num campo de texto (o teclado do celular esta aberto por ele): input de texto, textarea ou editavel. */
export function isTextEntry(element: FocusLike): boolean {
  if (!element) {
    return false;
  }
  if (element.isContentEditable === true) {
    return true;
  }
  const tag = String(element.tagName ?? "").toUpperCase();
  if (tag === "TEXTAREA") {
    return true;
  }
  return tag === "INPUT" && TEXT_INPUT_TYPES.has(String(element.type ?? "").toLowerCase());
}

/** A leitura de screen.orientation: o aparelho em pe (true), deitado (false) ou sem a leitura (null). */
export function readPortraitScreen(screen: { orientation?: { type?: string } | null } | null | undefined): boolean | null {
  const type = screen?.orientation?.type;
  if (typeof type !== "string" || !type) {
    return null;
  }
  return type.startsWith("portrait");
}

/* ------------------------------------------------------------------------------------------------
 * A consulta do aparelho (matchMedia injetavel: o servidor e os testes nao tem window)
 * ---------------------------------------------------------------------------------------------- */

/** O minimo de MediaQueryList que a sala usa (addListener: Safari antes do 14). */
export type PortraitMediaList = {
  addEventListener?: (type: "change", listener: () => void) => void;
  addListener?: (listener: () => void) => void;
  matches: boolean;
  removeEventListener?: (type: "change", listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};

export type PortraitMatchMedia = ((query: string) => PortraitMediaList) | null | undefined;

/** O celular esta em pe agora? Sem matchMedia (servidor) ou com erro: nao (o desenho normal). */
export function readPortraitPhone(matchMedia: PortraitMatchMedia): boolean {
  if (typeof matchMedia !== "function") {
    return false;
  }
  try {
    return matchMedia(VERTICAL_ROOM_QUERY).matches === true;
  } catch {
    return false;
  }
}

/** Segue a mudanca (girar o aparelho, redimensionar); devolve o desligar. Sem matchMedia: nada a seguir. */
export function subscribePortraitPhone(matchMedia: PortraitMatchMedia, callback: () => void): () => void {
  if (typeof matchMedia !== "function") {
    return () => undefined;
  }
  try {
    const media = matchMedia(VERTICAL_ROOM_QUERY);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", callback);
      return () => media.removeEventListener?.("change", callback);
    }
    if (typeof media.addListener === "function") {
      media.addListener(callback);
      return () => media.removeListener?.(callback);
    }
  } catch {
    // Sem a consulta, a sala fica no desenho normal.
  }
  return () => undefined;
}

/* ------------------------------------------------------------------------------------------------
 * O esqueleto: as mesmas pecas nos dois desenhos, so as classes mudam
 * ---------------------------------------------------------------------------------------------- */

/**
 * O caminho do palco a partir do dialogo (data-room-slot de cada nivel). E o mesmo no desenho normal e no vertical: a
 * prova de que girar nao remonta o player (tests/webinarios-sala-vertical-modelo.test.mjs). Nao ha mais Minimizar
 * (docs/31 V2-2).
 */
export const ROOM_STAGE_PATH = ["body", "stage-column", "stage-box"] as const;

/**
 * O video em `cover` no vertical: a caixa do palco ocupa a tela e o iframe ganha o tamanho de um 16:9 que cobre a tela
 * inteira (centrado; o que sobra nos lados fica cortado). Um video gravado em 9:16 aparece inteiro na altura. So CSS:
 * o mesmo iframe, sem remontar.
 */
export const VERTICAL_STAGE_COVER = [
  "[&_[data-room-stage]]:aspect-auto",
  "[&_[data-room-stage]]:h-full",
  "[&_[data-room-stage]]:overflow-hidden",
  "[&_[data-room-stage]>iframe]:left-1/2",
  "[&_[data-room-stage]>iframe]:top-1/2",
  "[&_[data-room-stage]>iframe]:h-[max(100dvh,56.25vw)]",
  "[&_[data-room-stage]>iframe]:w-[max(100vw,177.78dvh)]",
  "[&_[data-room-stage]>iframe]:max-w-none",
  "[&_[data-room-stage]>iframe]:-translate-x-1/2",
  "[&_[data-room-stage]>iframe]:-translate-y-1/2"
].join(" ");

export type RoomSkeleton = {
  body: string;
  /** O lugar das bolhas das reacoes (no vertical, a direita, acima do chat). */
  bubbles: string;
  /** A confirmacao de Sair (no vertical, um cartao por cima, abaixo do topo). */
  confirm: string;
  /** O painel do chat (o aside; no vertical nao existe: a gaveta faz o papel dele). */
  panel: string;
  root: string;
  /** O lugar do aviso de venda simulado (no vertical, o topo abaixo da barra; o toast fica em top-14 dele). */
  sales: string;
  stageBox: string;
  stageColumn: string;
};

/**
 * O estado que muda as classes do desenho normal (docs/31 V2-6 a V2-8), o mesmo nas duas salas: o painel do chat na
 * tela (`panelShown`), o palco que cresce para ocupar a coluna (`stageGrows`: o painel fechado, a frase de removido ou
 * banido, o Modo cinema) e o Modo cinema (`cinema`: o chat fica embaixo, menor). `stageMin`: o palco que cresce divide
 * a coluna com um painel no fluxo (Configurações no celular, na live) e guarda no minimo 96 px; quem encolhe e o
 * painel, que rola por dentro (no celular deitado a coluna tem uns 320 px).
 */
export type RoomSkeletonState = { cinema: boolean; panelShown: boolean; stageGrows: boolean; stageMin?: boolean };

const SKELETON_DEFAULT: RoomSkeletonState = { cinema: false, panelShown: true, stageGrows: false };

/** As classes juntas, sem as vazias (o modulo e puro: sem o cn, que traz o tailwind-merge). */
function classes(...parts: Array<string | null | false>): string {
  return parts.filter(Boolean).join(" ");
}

const NORMAL_CONFIRM = "flex flex-wrap items-center justify-between gap-2 border-b border-room-warn-border bg-room-warn-bg px-3 py-2";

/**
 * O tema do dialogo da sala (o data-room-theme, docs/31 V2-12): no desenho normal, o da pessoa (claro ou escuro); o
 * vertical 9:16 fica todo sobre o video e continua como no docs/30 (V2-18), sempre escuro, mesmo com o claro guardado.
 * Girar o aparelho troca o desenho e, com ele, o tema, sem perder a escolha guardada.
 */
export function themeForDesign(design: RoomDesign, theme: RoomTheme): RoomTheme {
  return design === "vertical" ? "dark" : theme;
}

/**
 * O palco que cresce (o painel fechado, removido ou banido, o Modo cinema): a caixa ocupa a coluna e o palco dentro
 * dela deixa o 16:9 para ocupar a caixa (o player e o iframe se ajustam por dentro). So CSS, o mesmo palco. O minimo
 * fica na caixa (min-h-0, ou 96 px com `stageMin`): e ela que divide a coluna com a barra e o painel.
 */
const STAGE_GROWS = "flex-1 [&>[data-room-stage]]:aspect-auto [&>[data-room-stage]]:flex-1";

/**
 * As classes de cada peca da sala (o dialogo, o corpo, a coluna e a caixa do palco, o painel e os lugares por cima). O
 * desenho normal e o mesmo na Live ao vivo, na gravada e no Replay (docs/31 V2-6): a partir de lg, o corpo com recuo de
 * 16 px, o palco com cantos de 16 px (os do video grande do iframe, que sao fixos) e a barra embaixo, a 12 px; abaixo de
 * lg, o palco na largura e a barra logo abaixo. O `state` muda so as classes: o palco nunca sai do lugar.
 */
export function roomSkeleton(design: RoomDesign, state: RoomSkeletonState = SKELETON_DEFAULT): RoomSkeleton {
  if (design === "vertical") {
    return {
      body: "relative min-h-0 flex-1",
      bubbles: "pointer-events-none absolute bottom-[46%] right-0 h-44 w-20",
      confirm:
        "absolute inset-x-3 top-[calc(env(safe-area-inset-top)+3.75rem)] z-40 flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-amber-400/30 bg-[#1f1a0c]/95 px-3 py-2 shadow-[0_12px_32px_rgba(0,0,0,0.55)]",
      panel: "hidden",
      root: "z-[60] text-white fixed inset-0 flex flex-col overflow-hidden bg-black",
      sales: "pointer-events-none absolute inset-x-0 top-[env(safe-area-inset-top)] h-28",
      stageBox: `absolute inset-0 ${VERTICAL_STAGE_COVER}`,
      stageColumn: "absolute inset-0 bg-black"
    };
  }
  return {
    body: "flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-4 lg:px-4 lg:pb-4",
    bubbles: "contents",
    confirm: NORMAL_CONFIRM,
    panel: classes(
      "flex min-h-0 flex-col border-t border-room-border bg-room-surface lg:w-[360px] lg:flex-none lg:overflow-hidden lg:rounded-[var(--member-cover-radius)] lg:border",
      state.panelShown && !state.cinema ? "flex-1" : "flex-none"
    ),
    root: "z-[60] text-room-fg fixed inset-0 flex flex-col bg-room-bg",
    sales: "contents",
    stageBox: classes(
      "relative flex flex-col bg-black lg:min-h-0 lg:flex-1 lg:overflow-hidden lg:rounded-[16px] [&:fullscreen>[data-room-stage]]:aspect-auto [&:fullscreen>[data-room-stage]]:h-full",
      state.stageGrows ? classes(state.stageMin ? "min-h-24" : "min-h-0", STAGE_GROWS) : null
    ),
    stageColumn: classes("relative flex flex-col lg:min-h-0 lg:min-w-0 lg:flex-1 lg:gap-3", state.stageGrows ? "min-h-0 flex-1" : "shrink-0")
  };
}

/* ------------------------------------------------------------------------------------------------
 * O topo do vertical: o selo e o contador pela mesma regra dos selos do palco (room-stage-badges.tsx)
 * ---------------------------------------------------------------------------------------------- */

export type VerticalBadge = {
  /** "live": Ao vivo (so com a decisao da equipe, D10); "session": Sessao das 20:00; "replay": Replay. */
  badge: "live" | "replay" | "session";
  /** O tempo no ar ao lado do selo (so com a sessao no ar). */
  elapsed: boolean;
  /** "{n} assistindo" (nunca no replay nem com a sessao encerrada). */
  showCount: boolean;
};

/**
 * O selo do momento (D10): o topo do vertical e, no desenho normal, o selo de cima do palco e o contador do cabecalho
 * (docs/31 V2-4; showLiveBadge so vale com a sessao gravada no ar).
 */
export function verticalBadge(input: { kind: "replay" | "simulated"; phase: "ended" | "live" | "waiting"; showLiveBadge: boolean }): VerticalBadge {
  if (input.kind === "replay") {
    return { badge: "replay", elapsed: false, showCount: false };
  }
  const live = input.phase === "live";
  return { badge: live && input.showLiveBadge ? "live" : "session", elapsed: live, showCount: input.phase !== "ended" };
}

/* ------------------------------------------------------------------------------------------------
 * O chat por cima: as ultimas mensagens, o anuncio e o compositor compacto
 * ---------------------------------------------------------------------------------------------- */

/** As ultimas mensagens para o chat por cima (as que a sala mostra, ja traduzidas) e se ha mais na gaveta. */
export function verticalChatTail(messages: readonly RoomMessage[], limit: number = VERTICAL_LIMITS.overlayMessages): { hidden: number; tail: readonly RoomMessage[] } {
  const size = Math.max(1, Math.trunc(limit));
  if (messages.length <= size) {
    return { hidden: 0, tail: messages };
  }
  return { hidden: messages.length - size, tail: messages.slice(messages.length - size) };
}

const ROLE_PREFIX: Partial<Record<RoomMessage["role"], string>> = {
  ai: WEBINAR_COPY.sala.selos.assistente,
  host: WEBINAR_COPY.sala.selos.apresentador,
  team: WEBINAR_COPY.sala.selos.equipe
};

/**
 * O que o leitor de tela ouve (aria-live polite) quando chegam mensagens: uma so, lida com o prefixo do papel ("Equipe:
 * Ana: texto"); em rajada (mais de uma de uma vez), "N mensagens novas". Nenhuma nova: nada.
 */
export function verticalChatAnnouncement(fresh: readonly RoomMessage[]): string {
  if (fresh.length === 0) {
    return "";
  }
  if (fresh.length > 1) {
    return WEBINAR_COPY.sala.mensagensNovas(fresh.length);
  }
  const message = fresh[0];
  const prefix = ROLE_PREFIX[message.role];
  return `${prefix ? `${prefix}: ` : ""}${message.displayName}: ${message.body}`;
}

/** A frase do compositor quando o aluno nao pode escrever (a mesma regra do chat da sala). */
export function verticalComposerHint(state: ComposerState, phase: SimulatedPhase | "replay"): string {
  const copy = WEBINAR_COPY.sala;
  switch (state.reason) {
    case "chat_off":
      return copy.chatDesligado;
    case "team_only":
      return copy.chatSoEquipe;
    case "slow_mode":
      return copy.modoLento(state.waitSeconds);
    case "ended":
      return phase === "replay" ? "" : copy.encerrada;
    default:
      return "";
  }
}

/** Em que aba a gaveta abre: Ver mais mensagens abre no Chat; o botao da gaveta, em Perguntas (ou onde o aluno estava). */
export function drawerTabFor(input: { current: "chat" | "enquetes" | "perguntas"; from: "chat" | "drawer" | "poll" }): "chat" | "enquetes" | "perguntas" {
  if (input.from === "chat") {
    return "chat";
  }
  if (input.from === "poll") {
    return "enquetes";
  }
  return input.current === "chat" ? "perguntas" : input.current;
}

/* ------------------------------------------------------------------------------------------------
 * O card aberto pela pilula da Oferta
 * ---------------------------------------------------------------------------------------------- */

/** A folga entre o card aberto e o topo (o Sair) e o minimo de altura que ainda mostra o botao. */
export const OFFER_PILL_PANEL = { gapPx: 12, minPx: 160 } as const;

/**
 * A altura maxima do card aberto pela pilula (sala vertical): do topo da pilula ate logo abaixo da barra do topo
 * (o Sair), para o Fechar nunca sair da tela nem ficar debaixo do Sair num celular baixo (o card rola por
 * dentro). Sem as medidas (servidor), nulo: vale o teto do CSS.
 */
export function offerPillPanelMaxHeight(input: { gapPx?: number; panelMarginPx?: number; pillTop: number | null; topBarBottom: number | null }): number | null {
  if (input.pillTop === null || !Number.isFinite(input.pillTop)) {
    return null;
  }
  const top = input.topBarBottom !== null && Number.isFinite(input.topBarBottom) ? Math.max(0, input.topBarBottom) : 0;
  const room = input.pillTop - (input.panelMarginPx ?? 8) - top - (input.gapPx ?? OFFER_PILL_PANEL.gapPx);
  return Math.max(OFFER_PILL_PANEL.minPx, Math.floor(room));
}
