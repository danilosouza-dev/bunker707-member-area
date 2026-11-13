"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { presenceStateOf, revealedMessages, roomPhaseAt, targetOffsetMs } from "@/lib/webinar-room-client";
import { formatCountdown, saoPauloTime } from "@/lib/webinar-time";
import type { StudentRoomPayload } from "@/server/webinars/student-model";
import { roomHref } from "@/server/webinars/student-model";
import { RoomTranslationBar } from "../translation/room-translation-bar";
import { useRoomAssistant } from "./assistant/use-room-assistant";
import { LiveParticipantsTab } from "./live-notices";
import { liveScreenPhrase, mutedPhrase, NO_REFUSED_BAN, overlayMessages, recordedBanNow, recordedBlockedScreen, refusedBanAfter, writeRefusalOf, type RefusedBan } from "./live-room-model";
import type { ChatPostBody } from "./room-api";
import { RoomLeaveDialog } from "./room-leave-dialog";
import { RecordedControls, ROOM_REACTIONS_ID } from "./recorded-controls";
import { ROOM_PANEL_ID } from "./room-bar";
import { RoomChatMoreButton, RoomChatPanel } from "./room-chat";
import { RoomChatPills } from "./room-chat-pills";
import { RoomHeader } from "./room-header";
import {
  chatPillsShown,
  firstFocusTarget,
  panelStageNames,
  panelTabsFor,
  PINNED_SNACK_ACTION,
  pinnedNoticeShown,
  pinnedPillsShown,
  pinnedPollFor,
  pinnedPollTapStep,
  pinnedShownIn,
  pinnedSnack,
  railStep,
  roomDateLine,
  roomEscapeStep,
  roomMobileLine,
  roomPanelShown,
  roomPresentBadge,
  soundCoverShown,
  stageAssistantShown,
  stageVideoRightPx,
  unpinnedPolls,
  verticalPollButton,
  type RoomPanelTab
} from "./room-layout-model";
import { RoomOffer } from "./room-offer";
import { RoomPanel, useRoomPanelUnread } from "./room-panel";
import { RoomPollLaterCard, RoomPollLayer } from "./room-poll-layer";
import { deferPoll, deferredPollCard, markPollResultSeen, resultsOnArrival, resumePoll, stagePollFor } from "./room-poll-model";
import { RoomPollsTab } from "./room-polls";
import { RoomQuestionsOrderButton, RoomQuestionsTab } from "./room-questions";
import type { QuestionsFilter, QuestionsOrder } from "./room-questions-model";
import { RoomRail } from "./room-rail";
import { QUESTION_NEWS_SNACK_ACTION } from "./room-question-news-model";
import { useRoomQuestionNews } from "./use-room-question-news";
import { RoomReactionBubbles } from "./room-reactions";
import { RoomSimulationJoins, RoomSimulationSales } from "./room-simulation";
import { RoomSnackbarHost, RoomSnackbarProvider, useRoomSnackbarController } from "./room-snackbar";
import { RoomStage } from "./room-stage";
import { RoomStageBadges, type RoomStageTopLeft } from "./room-stage-badges";
import { useRoomChat, useRoomClock, useRoomHeartbeat, useRoomReactions } from "./use-room-data";
import { useRoomOrientation } from "./use-room-orientation";
import { useRoomPlayer } from "./use-room-player";
import { useRoomPolls } from "./use-room-polls";
import { RoomPinnedArea, RoomPinnedPills, usePinnedFocus, type PinnedFocusTarget } from "./screen/room-pinned";
import type { ScreenItemHandlers } from "./screen/room-screen-card";
import { RoomScreenCommentAnnouncer, RoomScreenCommentLayer } from "./screen/room-screen-comment";
import { RoomScreenAnnouncer, RoomScreenLayer } from "./screen/room-screen-layer";
import { screenFocusKey, screenPlacement, screenStripForcedRecorded } from "./screen/room-screen-model";
import { RoomScreenDock, RoomScreenStrip } from "./screen/room-screen-strip";
import { RoomWideHidden } from "./screen/room-wide-hidden";
import { useRoomScreen, useRoomScreenEvents } from "./screen/use-room-screen";
import { useDeferredPolls, useRoomHydrated, useRoomPanelOpen, useRoomTheme } from "./use-room-prefs";
import { useRoomSimulation } from "./use-room-simulation";
import { useRoomTranslation } from "./use-room-translation";
import { RoomDock } from "./vertical/room-dock";
import { VerticalChat } from "./vertical/vertical-chat";
import { VerticalComposer } from "./vertical/vertical-composer";
import { VerticalDrawer, type VerticalDrawerTab } from "./vertical/vertical-drawer";
import { usePanelMotion } from "./use-panel-motion";
import { screenCommentPlace } from "@/server/webinars/screen-comment-model";
import { drawerTabFor, roomSkeleton, themeForDesign, verticalBadge, type RoomDesign } from "./vertical/vertical-model";
import { VerticalTopBar } from "./vertical/vertical-top-bar";

// A Sala da Live gravada e do Replay (docs/30 §1.3 adaptado a §1.6, §1.7 e §9): um dialogo de tela cheia por cima
// da area (aria-modal, foco preso, Esc fecha com confirmacao quando no ar), com o cabecalho, o palco (o player da
// Bunny travado no relogio do servidor na gravada; livre no replay), a barra de reacoes e o painel com as abas
// Chat, Perguntas e Enquetes (a de Enquetes so com enquete aberta). A 375 px: palco na largura, abas embaixo, o
// campo de mensagem fixo no rodape, botoes de 44 px. Sem Minimizar (docs/31 V2-2): com a sala aberta, o player e o
// sinal de midia com ele seguram os pop-ups. Sair volta para a pagina da live; o sinal de saida vai por beacon. Quem
// sai do "Quem pode" no meio da sessao (o 404 da releitura da sessao a cada 60 s ou do sinal de presenca; D41) perde
// o player, o chat e a presenca, e o palco mostra "Esta live não está disponível para você." (nos dois desenhos: o
// painel, o chat por cima, o compositor, a gaveta, a Oferta e a Simulacao saem). No "ver como" da equipe
// nada e gravado: nem sinal, nem chat, nem reacao. A sala da Live ao vivo (fase 3) e outra tela (live-room.tsx,
// escolhida pela pagina pela sessao `live`) e usa o mesmo dialogo daqui: o foco preso, o corpo da pagina parado e o
// prefers-reduced-motion (os helpers exportados abaixo).
// Fase 4d, a Sala Live vertical 9:16 (docs/30 §1.6 e §6.6): com o celular em pe (use-room-orientation.ts) a mesma sala
// vira o video em tela cheia (cover), o selo e o contador no topo, o chat por cima embaixo com o compositor compacto, a
// pilula da Oferta, o aviso de venda no topo e a gaveta com o chat inteiro, Perguntas e Enquetes; girar volta ao desenho
// normal. O palco fica sempre no mesmo lugar da arvore (corpo > coluna > caixa do palco, vertical/vertical-model.ts):
// girar troca so as classes, o player nao remonta e o chat, o relogio, o som e o estado continuam.
// Redesign V2, F2 (docs/31 V2-11 e V2-12): o tema claro ou escuro da pessoa (use-room-prefs.ts) fica no atributo
// data-room-theme do dialogo, e as superficies fora do video usam os tokens --room-*; o vertical e sempre escuro.
// Redesign V2, F3 (docs/31 V2-3 e V2-4): o cabecalho tem a linha da data (com a duracao e o apresentador) e, no
// celular, "com {apresentador} · {n} assistindo"; o selo do momento (a regra D10: "Ao vivo" so com a decisao da
// equipe, senao "Sessão das 20:00"; "Replay"), quem apresenta e o Assistente ficam no palco do desenho normal
// (room-stage-badges.tsx). O estado do Assistente e lido uma vez pela sala e desce para o chat e as Perguntas.
// Redesign V2, F4 (docs/31 V2-6 a V2-8): no desenho normal, a barra da live (recorded-controls.tsx) no lugar da fileira
// de reacoes: o Sair (a partir de lg; abaixo, no cabecalho), Reagir num painel por cima do palco, o Som da gravada (o
// mesmo mudo do "Ativar som", que so aparece ate o primeiro toque), a Tela cheia do palco e o balao que abre e fecha o
// painel do chat (fechado, o painel fica montado e escondido, e o palco cresce). A escolha fica guardada no navegador.
// Sem a barra (a sessao encerrada, fora do acesso) o painel fica na tela e o Sair volta ao cabecalho em toda largura.
// Redesign V2, F5 (docs/31 V2-7 e V2-8): o painel de 320 px da live (room-panel.tsx), com as abas pela mesma regra das
// tres salas (panelTabsFor): a gravada ganha Participantes (quem apresenta e o numero do cabecalho, o real mais a parte
// simulada), o Replay fica sem ela, e Enquetes so com enquete aberta. Fechado, o balao conta as mensagens novas e as 2
// ultimas ficam em pilulas sobre o palco (room-chat-pills.tsx; no Replay, acima da barra da Bunny), menos com o card da
// Oferta no palco, que tambem tira o selo do Assistente. A gaveta do vertical continua com as abas de antes.
// Redesign V2, F7 (docs/31 V2-10): no desenho normal, a enquete aberta sem resposta abre no meio do palco (room-poll-
// layer.tsx), mesmo com o painel fechado; "Responder depois" recolhe para o card do chat e o resultado compartilhado
// aparece no mesmo lugar. As enquetes sao lidas pela sala (useRoomPolls), e a aba so desenha. O vertical continua com o
// card de antes, que abre a aba Enquetes da gaveta.
// A correcao final da fase 1: abaixo de lg deitado a sala fica em linha (roomSkeleton); a capa "Ativar som" volta no
// vertical com o som desligado (soundCoverShown); a Tela cheia da caixa do palco sai com a barra (leaveStageFullscreen);
// a enquete e o card do chat so depois da hidratacao; o Esc fecha a camada de cima primeiro (roomEscapeStep); a
// confirmacao de Sair leva o foco ao Voltar e o devolve a quem a abriu (useRoomConfirmFocus).
// A sala no estilo do YouTube (docs/31): a partir de lg, o trilho a direita (room-rail.tsx) no lugar do balao e das
// abas, irmao do painel e nunca no vertical; o item abre o painel naquela aba e, aberto, fecha (railStep). O painel
// vira o cartao do YouTube com o cabecalho (o nome da aba, o numero e o X); o contador do Chat do trilho conta enquanto
// o Chat nao esta na tela (chatShown), e o X devolve o foco ao item da aba que estava aberta.
// A Na tela, as fixadas (especificacao de 10/11/2026, §3.1 e §3.4; screen/room-pinned.tsx): a mensagem e a enquete
// fixadas saem da aba Chat e viram a area das fixadas do painel, em todas as abas, e o topo da gaveta do vertical; a
// enquete fixada nao se repete na aba Enquetes nem vira o card "deixou para depois". Com o painel fechado, as pilulas
// no palco de 640 px ou mais e as linhas abaixo do palco mais estreito (pinnedPillsShown), e o aviso "A equipe fixou uma
// mensagem." com Ver na fixada nova. No vertical, a linha de 2 linhas da fixada com o link e o Mostrar tudo, e o botao
// "Enquete fixada: {pergunta}" (verticalPollButton). Nada disso no Replay, com a sessao encerrada nem fora do acesso
// (pinnedShownIn).
// A Na tela, o banner e o QR Code (especificacao de 10/11/2026, §3.2 a §3.7; screen/room-screen-layer.tsx e
// room-screen-strip.tsx): no palco de 640 px ou mais, os cartoes na camada do palco (dentro da caixa, que e o que vai
// para a Tela cheia), com as pilulas das fixadas primeiro na celula de cima a esquerda e o aviso de venda simulado por
// ultimo nela; a Oferta no palco leva a coluna da direita para a esquerda. No palco mais estreito, no baixo (a tela de
// ate 500 px de altura) e com qualquer capa no palco (screenStripForcedRecorded: a espera, "Ativar som", a sessao sem
// video), a faixa abaixo do palco e acima da barra, junto com as linhas das fixadas; na tela cheia com o palco estreito
// ou baixo, a linha compacta na borda de cima; no vertical 9:16, no maximo duas linhas compactas na doca, antes da
// pilula da Oferta. Um item na fileira de baixo ou na do meio tira as pilulas do chat do palco largo, e um em "Embaixo, à direita" o selo do
// Assistente (RoomWideHidden, so CSS). Fechar e por exibicao (sessionStorage); quem tem o foco num item que sai volta
// para a sala (refocusRoom). As metricas (viu, clicou, fechou) vao por useRoomScreenEvents; nada no "ver como".
// A Na tela, a moderacao por pessoa na Live gravada (especificacao de 10/11/2026, R5 e §3.8), com as regras e as frases
// da sala ao vivo (live-room-model.ts): o banimento e o da leitura da sessao (me.ban, que traz os desta sessao) mais o
// que uma escrita recusada contou (409 banned / muted do chat, da pergunta, da enquete, da reacao) ate a proxima
// leitura. Silenciado: o campo do painel, da gaveta, do vertical e das Perguntas da lugar a "Você está sem escrever no
// chat até {hora}." (ou "até o fim desta live"); continua assistindo, reagindo e respondendo enquetes. Removido desta
// sessao ou banido de todas: o mesmo caminho de quem saiu do "Quem pode" (unavailable), com a frase de cada um no palco
// ("Você foi removido desta live."), sem player, chat, presenca, Oferta, Simulacao nem nada da Na tela; a releitura da
// sessao continua, e o Desfazer da equipe devolve a sala sem recarregar. Na entrada, a pagina mostra a mesma frase.

function subscribeNothing() {
  return () => undefined;
}

/** O navegador deixa por um elemento em tela cheia (no iPhone, nao: sem o botao). */
function readFullscreenEnabled() {
  try {
    return document.fullscreenEnabled === true;
  } catch {
    return false;
  }
}

/** O que recebe o foco dentro da sala (o Tab circula so por aqui enquanto ela esta aberta). */
export const ROOM_FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(callback: () => void) {
  try {
    const media = window.matchMedia(REDUCED_MOTION);
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  } catch {
    return () => undefined;
  }
}

function readReducedMotion() {
  try {
    return window.matchMedia(REDUCED_MOTION).matches;
  } catch {
    return false;
  }
}

/** prefers-reduced-motion, seguindo a mudanca (as reacoes ficam paradas 1,5 s com ele ligado). */
export function useRoomReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

/**
 * O dialogo aberto (docs/30 §1.7): o corpo da pagina para de rolar, o foco vai para o primeiro [data-room-first-focus]
 * e volta para onde estava quando a sala fecha.
 */
export function useRoomDialogLock(rootRef: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }
    const root = rootRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // So entre os que estao na tela (roomFocusTarget): com o painel do chat fechado a aba Chat esta escondida.
    roomFocusTarget(root)?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [active, rootRef]);
}

/** Na tela: um controle escondido pela largura (display:none, como o tema abaixo de sm) nao tem offsetParent. */
const focusShown = (element: HTMLElement) => element.offsetParent !== null;

/**
 * Para onde o foco volta quando a peca que o tinha saiu: o primeiro [data-room-first-focus] que esta na tela ou, sem
 * ele, o primeiro controle da sala que esta na tela. Um controle escondido pela largura (o botao de tema abaixo de sm,
 * docs/31 V2-18) ignora o focus() e deixaria o foco no body: fica de fora, como na trava do Tab (trapRoomFocus).
 */
export function roomFocusTarget(root: Pick<HTMLElement, "querySelectorAll"> | null): HTMLElement | null {
  if (!root) {
    return null;
  }
  for (const selector of ["[data-room-first-focus]", ROOM_FOCUSABLE]) {
    const target = Array.from(root.querySelectorAll<HTMLElement>(selector)).find(focusShown);
    if (target) {
      return target;
    }
  }
  return null;
}

/**
 * O foco caiu fora da sala porque a peca que o tinha saiu (o painel, a gaveta ou o compositor quando a sala fica
 * indisponivel, D41): volta para o primeiro [data-room-first-focus] ou, sem ele, para o primeiro controle da sala (o
 * topo), os dois so entre os que estao na tela (roomFocusTarget), e nunca fica no body, onde o Esc e a trava do Tab
 * deixariam de valer. Devolve se moveu o foco.
 */
export function refocusRoom(root: Pick<HTMLElement, "contains" | "querySelectorAll"> | null, active: Element | null): boolean {
  if (!root || (active !== null && root.contains(active))) {
    return false;
  }
  const target = roomFocusTarget(root);
  if (!target) {
    return false;
  }
  target.focus();
  return true;
}

/**
 * O painel do chat fechou (docs/31 V2-7 e V2-8: o X, o balao, a escolha guardada lida depois da primeira pintura) com o
 * foco dentro dele, ou ja fora da sala: o foco vai, nesta ordem, para o item do trilho da aba que estava aberta (`tab`,
 * a partir de lg, a sala no estilo do YouTube), para o primeiro botao que controla o painel na tela (o balao abaixo de
 * lg, o item Chat do trilho a partir de lg) ou para o primeiro controle da sala na tela (roomFocusTarget). Um foco em
 * outro lugar da sala (o proprio item do trilho que fechou o painel, o cabecalho) fica onde esta. Devolve se moveu o
 * foco.
 */
export function returnFocusFromPanel(
  root: Pick<HTMLElement, "contains" | "querySelectorAll"> | null,
  active: Element | null,
  panel: Pick<HTMLElement, "contains"> | null,
  tab?: RoomPanelTab
): boolean {
  if (!root) {
    return false;
  }
  const lost = active === null || !root.contains(active) || (panel !== null && panel.contains(active));
  if (!lost) {
    return false;
  }
  const rail = tab ? firstShown(root, `[data-room-rail="${tab}"]`) : undefined;
  const target = rail ?? firstShown(root, `[aria-controls="${ROOM_PANEL_ID}"]`) ?? roomFocusTarget(root);
  if (!target) {
    return false;
  }
  target.focus();
  return true;
}

/** O primeiro elemento do seletor que esta na tela (focusShown). */
function firstShown(root: Pick<HTMLElement, "querySelectorAll">, selector: string): HTMLElement | undefined {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).find(focusShown);
}

/**
 * A enquete saiu do palco (docs/31 V2-10: enviada, deixada para depois, o resultado fechado, encerrada pela equipe)
 * com o foco nela, que caiu no body: o foco vai para o "Responder agora" do card do chat, se ele esta na tela; senao
 * para o primeiro botao que controla o painel na tela (o balao da barra abaixo de lg, o item Chat do trilho a partir de
 * lg); senao para o primeiro controle da sala na tela (roomFocusTarget). Um foco que continua na sala fica onde esta.
 * Devolve se moveu o foco.
 */
export function returnFocusFromPoll(root: Pick<HTMLElement, "contains" | "querySelectorAll"> | null, active: Element | null): boolean {
  if (!root || (active !== null && root.contains(active))) {
    return false;
  }
  const target = firstShown(root, "[data-room-poll-resume]") ?? firstShown(root, `[aria-controls="${ROOM_PANEL_ID}"]`) ?? roomFocusTarget(root);
  if (!target) {
    return false;
  }
  target.focus();
  return true;
}

/**
 * A barra saiu (o celular girou para em pe e a sala virou o vertical 9:16, ou a sessao acabou) com a caixa do palco em
 * tela cheia (a Tela cheia da barra, V2-6): a tela cheia sai junto, senao o topo do vertical (o Sair) e a gaveta, que
 * ficam fora da caixa, sumiriam atras dela, e o aluno nao teria como sair. So a propria caixa: a tela cheia do player
 * da Bunny no Replay (o iframe, dentro da caixa) e do aluno e fica. Devolve se pediu a saida.
 */
export function leaveStageFullscreen(doc: { exitFullscreen?: () => Promise<void>; fullscreenElement: Element | null } | null, box: Element | null): boolean {
  if (!doc || !box || doc.fullscreenElement !== box || typeof doc.exitFullscreen !== "function") {
    return false;
  }
  void doc.exitFullscreen().catch(() => undefined);
  return true;
}

/**
 * A confirmacao "Sair da sala?" fechou (Voltar, Esc) com o foco nela, que saiu junto e caiu no body: o foco volta para
 * quem a abriu (o Sair da barra, do cabecalho ou do topo do vertical; o controle em que estava o Esc), se ele continua
 * na tela; senao para o primeiro controle da sala na tela (roomFocusTarget). No body, o Esc, os atalhos e a trava do Tab
 * deixariam de valer. Um foco que continua na sala fica onde esta. Devolve se moveu o foco.
 */
export function returnFocusFromConfirm(
  root: Pick<HTMLElement, "contains" | "querySelectorAll"> | null,
  active: Element | null,
  opener: HTMLElement | null
): boolean {
  if (!root || (active !== null && root.contains(active))) {
    return false;
  }
  const target = opener && root.contains(opener) && focusShown(opener) ? opener : roomFocusTarget(root);
  if (!target) {
    return false;
  }
  target.focus();
  return true;
}

/**
 * O lugar do foco quando a confirmacao "Sair da sala?" abre e fecha, o mesmo nas duas salas: ao abrir, o foco vai ao
 * Voltar dela (o caminho seguro: o Enter seguinte nao tira ninguem da live); ao fechar, volta para quem a abriu
 * (returnFocusFromConfirm). `remember` guarda quem a abriu, chamado antes de abrir.
 */
export function useRoomConfirmFocus(rootRef: RefObject<HTMLElement | null>, open: boolean): () => void {
  const openerRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  useLayoutEffect(() => {
    const was = openRef.current;
    openRef.current = open;
    const root = rootRef.current;
    if (!root || was === open) {
      return;
    }
    if (open) {
      root.querySelector<HTMLElement>("[data-room-confirm] [data-room-first-focus]")?.focus();
      return;
    }
    returnFocusFromConfirm(root, document.activeElement, openerRef.current);
    openerRef.current = null;
  }, [open, rootRef]);
  return useCallback(() => {
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && rootRef.current?.contains(active) ? active : null;
  }, [rootRef]);
}

/** O Tab preso no dialogo: do ultimo volta ao primeiro (e o Shift+Tab ao contrario). */
export function trapRoomFocus(event: Pick<ReactKeyboardEvent, "key" | "preventDefault" | "shiftKey">, root: HTMLElement | null) {
  if (event.key !== "Tab" || !root) {
    return;
  }
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(ROOM_FOCUSABLE)).filter((element) => focusShown(element) || element === document.activeElement);
  if (focusable.length === 0) {
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export type WebinarRoomProps = {
  coverUrl: string | null;
  /** Forca o desenho (a previa e os testes); sem ele, o celular em pe decide (use-room-orientation.ts). */
  design?: RoomDesign;
  payload: StudentRoomPayload;
  /** O apresentador (a pagina sabe): a linha do cabecalho e o selo do palco; nulo, os dois omitem o nome. */
  presenterName: string | null;
  /** "Ver como" da equipe: a sala abre e nada e gravado. */
  readOnly: boolean;
  /** A pagina da live (Sair e Esc voltam para ca). */
  webinarHref: string;
};

export function WebinarRoom({ coverUrl, design: forcedDesign, payload, presenterName = null, readOnly, webinarHref }: WebinarRoomProps) {
  const copy = WEBINAR_COPY.sala;
  const router = useRouter();
  const webinarId = payload.webinar.id;
  const sessionId = payload.session.id;
  const kind: "replay" | "simulated" = payload.session.kind === "replay" ? "replay" : "simulated";
  const clock = useRoomClock({ enabled: !readOnly, initial: payload, webinarId });
  const session = clock.session;
  const zeroMs = useMemo(() => Date.parse(session.session.scheduledAt), [session.session.scheduledAt]);
  const durationMs = session.session.durationMs;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.parse(payload.serverTime));
  const [tab, setTab] = useState<RoomPanelTab>("chat");
  // As Perguntas no estilo do YouTube: o filtro e a ordem sao da sala (trocar de aba nao os perde) e o numero do
  // cabecalho e o tamanho da lista com o filtro de agora, nulo ate a primeira leitura.
  const [questionsFilter, setQuestionsFilter] = useState<QuestionsFilter>("all");
  const [questionsOrder, setQuestionsOrder] = useState<QuestionsOrder>("votadas");
  const [questionsCount, setQuestionsCount] = useState<number | null>(null);
  // O ⋮ do cabecalho do Chat abre a confirmacao de remover as minhas mensagens, que fica no chat.
  const [removeOpen, setRemoveOpen] = useState(false);
  const [muted, setMuted] = useState(kind === "simulated");
  /** O primeiro toque no som (o "Ativar som" ou o Som da barra): depois dele a capa "Ativar som" so volta sem a barra (soundCoverShown). */
  const [soundTouched, setSoundTouched] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [fullscreenOn, setFullscreenOn] = useState(false);
  const stageBoxRef = useRef<HTMLDivElement | null>(null);
  const fullscreenEnabled = useSyncExternalStore(subscribeNothing, readFullscreenEnabled, () => false);
  const [panelOpen, setPanelOpen] = useRoomPanelOpen();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [playerEnded, setPlayerEnded] = useState(false);
  /** O card da Oferta esta no palco: as pilulas do chat e o selo do Assistente saem do canto. */
  const [offerShown, setOfferShown] = useState(false);
  /** O contador do ultimo sinal de presenca; antes dele, o da leitura da sessao. */
  const [heartbeatPresent, setHeartbeatPresent] = useState<number | null>(null);
  /** O ultimo sinal de 15 s disse que a equipe escondeu o numero de pessoas (nulo antes dele): vale sobre a sessao. */
  const [heartbeatHidden, setHeartbeatHidden] = useState<boolean | null>(null);
  /** O sinal de presenca respondeu 404 (fora do acesso agora). */
  const [heartbeatLost, setHeartbeatLost] = useState(false);
  const reducedMotion = useRoomReducedMotion();
  const design = useRoomOrientation(forcedDesign, rootRef);
  const vertical = design === "vertical";
  const [theme, setTheme] = useRoomTheme();
  /** Sala vertical: a gaveta (Chat inteiro, Perguntas, Enquetes) e o chat por cima ligado ou fechado. */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const drawerId = useId();
  const [replaySeconds, setReplaySeconds] = useState(0);
  const replayOffsetRef = useRef(0);
  const lastReplaySecondRef = useRef<number | null>(null);
  const serverEnded = session.session.status === "ended" || session.session.status === "cancelled";
  // A moderacao por pessoa (a Na tela, R5): o que uma escrita recusada contou (409 banned / muted) vale ate a proxima
  // leitura da sessao, pela regra da sala ao vivo (recordedBanNow); a leitura mais nova manda, entao o Desfazer da equipe
  // e o silencio que venceu devolvem a sala e o campo sem recarregar.
  const [refused, setRefused] = useState<RefusedBan>(NO_REFUSED_BAN);
  const sessionTimeRef = useRef(session.serverTime);
  useEffect(() => {
    sessionTimeRef.current = session.serverTime;
  }, [session.serverTime]);
  const ban = recordedBanNow({ fromSession: session.me.ban, refused, serverTimeIso: session.serverTime, skewMs: clock.skewMs });
  const blockedScreen = recordedBlockedScreen({ accessLost: clock.accessLost || heartbeatLost, ban });
  // Fora do "Quem pode" agora (D41), removido desta sessao ou banido (R5): o player desmonta, nada mais e lido nem
  // gravado (so a releitura da sessao, que traz o Desfazer) e o palco mostra a frase de cada um.
  const unavailable = blockedScreen !== null;
  const refreshSession = clock.refresh;
  /** Uma escrita da sala foi recusada (409 banned / muted do chat, da pergunta, da enquete, da reacao): a sala muda na hora e a sessao e relida. */
  const onWriteRefused = useCallback(
    (error: unknown) => {
      const refusal = writeRefusalOf(error);
      if (refusal === null || refusal === "ended") {
        return;
      }
      setRefused((previous) => refusedBanAfter(previous, refusal, { nowMs: Date.now(), serverTimeIso: sessionTimeRef.current, skewMs: clock.skewRef.current ?? 0 }));
      void refreshSession();
    },
    [clock.skewRef, refreshSession]
  );

  // O relogio da sala, a cada segundo (a contagem, o tempo no ar e a revelacao das mensagens).
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const presentNow = heartbeatPresent ?? session.presentNow;

  const phase: "ended" | "live" | "replay" | "waiting" =
    kind === "replay" ? "replay" : roomPhaseAt({ deviceNowMs: nowMs, durationMs, ended: serverEnded || playerEnded, skewMs: clock.skewMs, zeroMs });
  const live = phase === "live";

  const getOffsetMs = useCallback(() => {
    if (kind === "replay") {
      return replayOffsetRef.current;
    }
    return targetOffsetMs({ deviceNowMs: Date.now(), skewMs: clock.skewRef.current ?? 0, zeroMs });
  }, [clock.skewRef, kind, zeroMs]);

  // A Na tela (docs/30 §5.1): a fixada e o que mais a equipe poe na frente da turma, pela leitura da sessao e pela
  // consulta de 5 s do chat (com o carimbo). No Replay nada vem da Na tela: a fixada continua a da leitura da sessao.
  const naTela = useRoomScreen({ sessionId, sessionPinned: session.pinned, sessionScreen: kind === "replay" ? null : session.screen });
  // O chat liga ja na espera (a sala de espera tem chat, docs/30 §1.6): so o "ver como" fica sem nada.
  const chat = useRoomChat({
    enabled: !readOnly && !unavailable,
    getPlayerOffsetMs: getOffsetMs,
    getScreenStamp: naTela.getStamp,
    initialServerTime: payload.serverTime,
    onScreen: naTela.onChatScreen,
    sessionId,
    webinarId
  });
  const chatSeeked = chat.seeked;

  const onTime = useCallback(
    (seconds: number) => {
      const last = lastReplaySecondRef.current;
      replayOffsetRef.current = Math.round(seconds * 1000);
      lastReplaySecondRef.current = seconds;
      if (last !== null && Math.abs(seconds - last) > 2) {
        chatSeeked();
      }
      setReplaySeconds(Math.floor(seconds));
    },
    [chatSeeked]
  );

  const player = useRoomPlayer({
    durationMs,
    enabled: !readOnly && !unavailable && (live || phase === "replay") && session.video !== null,
    iframe,
    locked: kind === "simulated",
    onEnded: () => setPlayerEnded(true),
    onTime,
    sessionId,
    skewRef: clock.skewRef,
    src: session.video?.embedUrl ?? null,
    zeroMs
  });

  useRoomHeartbeat({
    enabled: !readOnly && !unavailable && phase !== "ended",
    getOffsetSeconds: () => Math.floor(getOffsetMs() / 1000),
    getState: () => presenceStateOf({ bridge: player.bridge, playing: player.playing, visible: true }),
    onAccessLost: () => setHeartbeatLost(true),
    onAnswer: (answer) => {
      setHeartbeatPresent(answer.presentNow);
      setHeartbeatHidden(typeof answer.presentHidden === "boolean" ? answer.presentHidden : null);
      if (answer.ended) {
        setPlayerEnded(true);
      }
    },
    sessionId,
    webinarId
  });

  const reactions = useRoomReactions({ enabled: !readOnly && !unavailable && (live || phase === "replay"), getOffsetMs, onRefused: onWriteRefused, reducedMotion, sessionId, webinarId });
  // O Assistente lido uma vez pela sala: o selo do palco, o chat e as Perguntas usam o mesmo estado.
  const assistant = useRoomAssistant({ enabled: !readOnly && !unavailable, sessionId, webinarId });

  const currentOffsetMs = kind === "replay" ? replaySeconds * 1000 : targetOffsetMs({ deviceNowMs: nowMs, skewMs: clock.skewMs, zeroMs });
  const revealed = useMemo(() => revealedMessages(chat.messages, currentOffsetMs), [chat.messages, currentOffsetMs]);
  // Fase 4 (docs/30 §1.6): a Simulacao so na sessao gravada (o Replay livre nunca simula; a sala ao vivo e outra tela),
  // a traducao das mensagens mostradas (as duas formas da sala mostram SO as traduzidas) e a Oferta (no canto do palco
  // ou a pilula do vertical). Os tres sao pontos de encaixe preenchidos pelas frentes.
  const simulation = useRoomSimulation({ enabled: !readOnly && !unavailable && kind === "simulated" && phase !== "ended", getOffsetMs, sessionId, simulationKey: naTela.simulationKey, webinarId });
  const translation = useRoomTranslation({ enabled: !readOnly && !unavailable, messages: revealed, sessionId, webinarId });
  // As enquetes da sala (a releitura da sessao e, quando o resumo da Na tela muda, uma leitura): o palco, o card do chat e a aba.
  const roomPolls = useRoomPolls({ enabled: !readOnly && !unavailable, getOffsetMs, onRefused: onWriteRefused, pollsKey: naTela.pollsKey, sessionId, sessionPolls: session.polls, webinarId });
  const polls = roomPolls.polls;
  const [deferred, setDeferred] = useDeferredPolls(sessionId);
  // O que depende do guardado (o "depois", os resultados vistos) so depois da hidratacao: sem isso, a enquete deixada
  // para depois piscaria no palco a cada carga. Os resultados que ja vinham na pagina nao abrem no palco.
  const hydrated = useRoomHydrated();
  const [arrivedResults] = useState(() => resultsOnArrival(payload.polls));
  /**
   * O pedido de foco na enquete do palco (Responder agora): a enquete para responder (a mesma chave do palco) e um
   * contador que muda a cada pedido. O resultado da mesma enquete, depois, abre sem pegar o foco.
   */
  const [pollFocus, setPollFocus] = useState<{ key: string; n: number } | null>(null);
  const openPolls = polls.filter((poll) => poll.status === "open");
  // As fixadas (Na tela): a mensagem e a enquete, so na gravada de pe para a pessoa (nunca no Replay); a enquete fixada
  // sai da aba Enquetes, do card "deixou para depois" e do card de enquete da gaveta (ela fica na area das fixadas).
  const pinnedOn = pinnedShownIn({ blocked: unavailable, kind, phase });
  const pinnedMessage = pinnedOn ? naTela.pinned : null;
  const pinnedPoll = pinnedOn ? pinnedPollFor({ pinnedPollId: naTela.pinnedPollId, polls }) : null;
  const pollsTab = unpinnedPolls(polls, pinnedPoll?.id ?? null);
  const otherOpenPolls = unpinnedPolls(openPolls, pinnedPoll?.id ?? null);
  // As abas do painel pela regra das tres salas (V2-7); a gaveta do vertical continua como no docs/30 §1.6 (Enquetes
  // tambem com o resultado de uma enquete encerrada, sem Participantes).
  const tabs = panelTabsFor({ kind, openPolls: openPolls.length, tab });
  const drawerTab: VerticalDrawerTab = tab === "participantes" ? "chat" : tab;
  const drawerTabs: VerticalDrawerTab[] = ["chat", "perguntas", ...(openPolls.length > 0 || tab === "enquetes" || polls.length > 0 ? (["enquetes"] as const) : [])];
  const replayHref = session.webinar.replaySessionId && kind === "simulated" ? roomHref(session.webinar.slug, session.webinar.replaySessionId) : null;
  const countdown = kind === "simulated" ? formatCountdown(zeroMs, nowMs + clock.skewMs) : "";
  /** O numero do contador: o real mais a parte simulada daquele instante (sem Simulacao, o real). */
  const shownCount = simulation.displayCount(presentNow, currentOffsetMs);
  const drawerVisible = vertical && drawerOpen && !unavailable;
  // A barra do desenho normal (V2-6) so com a sala de pe, como na live: a sessao encerrada e fora do acesso a tiram, e
  // sem ela o painel fica na tela (o balao saiu junto).
  const barShown = !vertical && !unavailable && phase !== "ended";
  const reactionsShown = reactionsOpen && barShown;
  const panelShown = roomPanelShown({ barShown, panelOpen, settingsTakeover: false });
  // O aviso da sala (RoomSnackbar), sem motor: so os sucessos do chat e das Perguntas, no desenho normal.
  const snackbar = useRoomSnackbarController();
  // O Chat na tela: o painel na tela e na aba Chat (com ele fechado ou noutra aba, o contador conta).
  const chatShown = panelShown && tab === "chat";
  // O contador do balao e do Chat do trilho: as mensagens novas desde que o Chat saiu da tela (os ids e o offset do
  // video da sessao, cujo zero nao muda: a hora marcada na gravada, o player no Replay).
  const unread = useRoomPanelUnread({ chatLoaded: chat.loaded, kind, messages: translation.messages, offsetMs: currentOffsetMs, chatShown });
  // As respostas novas nas perguntas do aluno (docs/30 D100): contam com a aba Perguntas fora da tela (no vertical, a
  // gaveta fechada ou noutra aba).
  const questionsTabMounted = (vertical ? drawerTab : tab) === "perguntas";
  const questionNews = useRoomQuestionNews({
    enabled: !readOnly && !unavailable && phase !== "ended" && tabs.includes("perguntas"),
    sessionId,
    shown: questionsTabMounted && (vertical ? drawerVisible : panelShown),
    tabMounted: questionsTabMounted,
    webinarId
  });
  const firstFocus = firstFocusTarget({ panelShown });
  // A enquete no meio do palco so no desenho normal com a sala de pe (como a barra); o card do chat, a deixada para
  // depois.
  const stagePoll = barShown && hydrated ? stagePollFor({ deferredIds: deferred.later, polls, seenResultIds: [...deferred.seen, ...arrivedResults] }) : null;
  const stagePollKey = stagePoll ? `${stagePoll.mode}:${stagePoll.poll.id}` : null;
  const laterPoll = hydrated ? deferredPollCard({ deferredIds: deferred.later, polls: pollsTab }) : null;
  // As fixadas com o painel fechado: as pilulas no palco largo e as linhas abaixo do palco estreito (so no desenho normal).
  const pinnedShortcuts = pinnedPillsShown({ blocked: unavailable, design, panelShown, settingsTakeover: false });
  const focusPinned = usePinnedFocus(rootRef);
  const snackbarApi = snackbar.api;

  // A equipe falou numa pergunta do aluno com a aba Perguntas fora da tela (docs/30 D100): o numero no item Perguntas
  // (o trilho) ou o ponto na aba, e o aviso da sala com Ver, que abre a aba. So quando o numero sobe.
  const questionNewsCount = questionNews.count;
  const questionNewsShownRef = useRef(0);
  useEffect(() => {
    const before = questionNewsShownRef.current;
    questionNewsShownRef.current = questionNewsCount;
    if (questionNewsCount > before) {
      snackbarApi.show({ action: { key: QUESTION_NEWS_SNACK_ACTION, label: WEBINAR_COPY.salaV2.perguntas.verResposta }, key: "question_news", text: WEBINAR_COPY.salaV2.perguntas.respostaNova });
    } else if (questionNewsCount === 0 && before > 0) {
      snackbarApi.clear("question_news");
    }
  }, [questionNewsCount, snackbarApi]);
  // A Na tela, o banner e o QR Code: as mesmas regras das fixadas (§3.6); qualquer capa no palco manda tudo para a faixa.
  const screenItems = pinnedOn ? naTela.items : [];
  const soundCover = soundCoverShown({ barShown, kind, muted, soundTouched });
  const stageState = unavailable ? "unavailable" : phase === "replay" ? "replay" : phase;
  const screenForced = screenStripForcedRecorded({ hasVideo: session.video !== null, soundCover, stageState });
  const pinnedPillsOn = pinnedShortcuts && (pinnedMessage !== null || pinnedPoll !== null);
  const placement = screenPlacement({ items: screenForced || vertical ? [] : screenItems, offerShown, pinnedPills: !screenForced && pinnedPillsOn });
  // O comentario ou a pergunta que a equipe trouxe para a tela (rodada v9, docs/30 D89): pelas mesmas regras da Na tela;
  // a Oferta no palco ocupa o canto de baixo a direita.
  const screenComment = pinnedOn && !unavailable ? naTela.comment : null;
  const screenCommentAt = screenCommentPlace(placement.cells.map((cell) => cell.place), offerShown);
  const screenEvents = useRoomScreenEvents({ enabled: !readOnly && pinnedOn, pollOver: stagePoll !== null, sessionId, webinarId });
  const sendScreenEvent = screenEvents.sendEvent;
  const closeScreenItem = naTela.closeItem;
  const screenHandlers = useMemo<ScreenItemHandlers>(
    () => ({
      onClick: (displayId, form, target) => sendScreenEvent({ displayId, form, name: "clicked", target }),
      onClose: (displayId, form) => {
        closeScreenItem(displayId);
        sendScreenEvent({ displayId, form, name: "closed" });
      },
      watch: screenEvents.watch
    }),
    [closeScreenItem, screenEvents.watch, sendScreenEvent]
  );
  // O que a Na tela poe e tira da sala (screenFocusKey): o efeito que devolve o foco a sala fica depois dos do painel e
  // da enquete, que sabem para onde ele vai.
  const screenKey = screenFocusKey({
    forced: screenForced,
    fullscreen: fullscreenOn,
    items: screenItems,
    pinnedMessageId: pinnedMessage?.id ?? null,
    pinnedPollId: pinnedPoll?.id ?? null,
    pinnedShortcuts: pinnedPillsOn,
    placement
  });

  // A fixada nova com o painel fechado: "A equipe fixou uma mensagem." com Ver, uma vez por fixada (a que ja estava quando
  // a sala abriu nao avisa; o vertical nao tem o aviso da sala, a linha da fixada fica acima do chat). O id e o do estado
  // da Na tela, mesmo com as fixadas fora da tela (removido, o video no fim): o Desfazer da equipe devolve a fixada de
  // antes, que nao e nova.
  const pinnedId = naTela.pinned?.id ?? null;
  const pinnedSeenRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const before = pinnedSeenRef.current;
    pinnedSeenRef.current = pinnedId;
    if (pinnedNoticeShown({ after: pinnedId, before, panelShown, shown: pinnedOn && !vertical })) {
      snackbarApi.show(pinnedSnack());
    }
  }, [panelShown, pinnedId, pinnedOn, snackbarApi, vertical]);

  const leave = useCallback(() => {
    router.push(webinarHref);
  }, [router, webinarHref]);

  // A confirmacao de Sair: o foco entra no Voltar dela e volta para quem a abriu.
  const rememberLeaveOpener = useRoomConfirmFocus(rootRef, confirmLeave);
  const askToLeave = useCallback(() => {
    if (live && !unavailable) {
      rememberLeaveOpener();
      setConfirmLeave(true);
      return;
    }
    leave();
  }, [leave, live, rememberLeaveOpener, unavailable]);

  // Foco preso e Esc (docs/30 §1.7): o dialogo e o unico lugar do teclado enquanto esta aberto.
  useRoomDialogLock(rootRef, true);

  // Fora do "Quem pode" (D41) o painel, a gaveta e o compositor saem com o foco que estava neles: ele volta para a
  // sala antes do proximo toque de tecla (como barFocusLost na sala ao vivo).
  useLayoutEffect(() => {
    if (unavailable) {
      refocusRoom(rootRef.current, document.activeElement);
    }
  }, [unavailable]);

  // A barra saiu (a sessao encerrada, o celular em pe) com o foco nela: o foco volta para a sala, nunca fica no body; e a
  // Tela cheia da caixa do palco sai junto (o Sair do topo do vertical e a gaveta ficam fora dela).
  const barShownRef = useRef(barShown);
  useLayoutEffect(() => {
    const was = barShownRef.current;
    barShownRef.current = barShown;
    if (was && !barShown) {
      leaveStageFullscreen(document, stageBoxRef.current);
      refocusRoom(rootRef.current, document.activeElement);
    }
  }, [barShown]);

  // O painel do chat fechou com o foco nele (ou a escolha guardada chegou depois da primeira pintura): o foco vai ao
  // item do trilho da aba que estava aberta (a partir de lg) ou ao balao da barra (abaixo de lg).
  const panelShownRef = useRef(panelShown);
  useLayoutEffect(() => {
    const was = panelShownRef.current;
    panelShownRef.current = panelShown;
    if (was && !panelShown) {
      returnFocusFromPanel(rootRef.current, document.activeElement, document.getElementById(ROOM_PANEL_ID), tab);
    }
  }, [panelShown, tab]);

  // A enquete saiu do palco (ou trocou por outra) com o foco nela: o foco vai ao Responder agora, ao balao ou a sala.
  const stagePollKeyRef = useRef(stagePollKey);
  useLayoutEffect(() => {
    const was = stagePollKeyRef.current;
    stagePollKeyRef.current = stagePollKey;
    if (was !== null && was !== stagePollKey) {
      returnFocusFromPoll(rootRef.current, document.activeElement);
    }
  }, [stagePollKey]);

  // A peca da Na tela com o foco saiu ou foi montada de novo (a equipe tirou o banner ou o QR Code, desafixou ou fixou
  // outra mensagem, a enquete fixada saiu, a Oferta ou o QR Code que chegou mudou o cartao de celula, o aluno fechou, a
  // capa mandou tudo para a faixa): o foco volta para a sala (o primeiro [data-room-first-focus] na tela), nunca fica no
  // body. Com o foco ainda na sala, nada. O giro ja tem o efeito dele.
  const screenKeyRef = useRef(screenKey);
  useLayoutEffect(() => {
    const was = screenKeyRef.current;
    screenKeyRef.current = screenKey;
    if (was !== screenKey) {
      refocusRoom(rootRef.current, document.activeElement);
    }
  }, [screenKey]);

  useEffect(() => {
    const onChange = () => setFullscreenOn(stageBoxRef.current !== null && document.fullscreenElement === stageBoxRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // A gaveta fechou (Esc, Voltar para o video, toque fora): o foco volta para o botao que abriu. Fechada porque a sala
  // ficou indisponivel, o botao saiu junto e o efeito acima ja trouxe o foco de volta.
  const drawerWasOpenRef = useRef(false);
  useEffect(() => {
    if (drawerVisible) {
      drawerWasOpenRef.current = true;
      return;
    }
    if (drawerWasOpenRef.current) {
      drawerWasOpenRef.current = false;
      rootRef.current?.querySelector<HTMLElement>("[data-room-drawer-toggle]")?.focus();
    }
  }, [drawerVisible]);

  // Girar o aparelho troca as pecas por cima do video: se o foco estava numa que saiu, ele volta para o comeco da sala.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || root.contains(document.activeElement)) {
      return;
    }
    roomFocusTarget(root)?.focus();
  }, [design]);

  function openDrawer(from: "chat" | "drawer" | "poll") {
    setTab((current) => drawerTabFor({ current: current === "participantes" ? "chat" : current, from }));
    setDrawerOpen(true);
  }

  /**
   * O envio do chat, o mesmo nos dois desenhos (no replay vai o segundo do video; o aceite novo rele a sessao). A recusa
   * de removido, banido ou silenciado muda a sala na hora (onWriteRefused) e o campo mostra a frase do servidor.
   */
  async function sendChat(body: Omit<ChatPostBody, "sessionId">) {
    try {
      const answer = await chat.send({ ...body, offsetMs: kind === "replay" ? Math.round(getOffsetMs()) : undefined });
      if (!session.me.consented) {
        void clock.refresh();
      }
      return answer;
    } catch (error) {
      onWriteRefused(error);
      throw error;
    }
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      // A camada de cima primeiro (roomEscapeStep): a confirmacao, as reacoes, a enquete no palco; so entao o Sair.
      const step = roomEscapeStep({ confirmLeave, popoverOpen: reactionsShown, stagePoll: stagePoll?.mode ?? null });
      if (step === "close_confirm") {
        setConfirmLeave(false);
      } else if (step === "close_popovers") {
        closeReactions();
      } else if (step === "poll_later" && stagePoll) {
        setDeferred(deferPoll(deferred, stagePoll.poll.id));
        setPollFocus(null);
      } else if (step === "poll_seen" && stagePoll) {
        setDeferred(markPollResultSeen(deferred, stagePoll.poll.id));
        setPollFocus(null);
      } else {
        askToLeave();
      }
      return;
    }
    trapRoomFocus(event, confirmLeave ? (rootRef.current?.querySelector<HTMLElement>("[data-room-confirm]") ?? rootRef.current) : rootRef.current);
  }

  /** "Responder agora" do card do chat: a enquete volta ao palco e o foco vai para a primeira opcao. */
  function answerPollNow(pollId: string) {
    setDeferred(resumePoll(deferred, pollId));
    setPollFocus((previous) => ({ key: `answer:${pollId}`, n: (previous?.n ?? 0) + 1 }));
  }

  /** Um item do trilho (a partir de lg): abre o painel naquela aba ou, no item aberto, fecha (so com a barra na tela). */
  function onRail(item: RoomPanelTab) {
    const step = railStep({ closable: barShown, item, panelShown, tab });
    setTab(step.tab);
    setPanelOpen(step.panelOpen);
  }

  /**
   * A pilula ou a linha da fixada (e o Ver do aviso): o painel abre (no Chat, para a mensagem; na aba de agora, para a
   * enquete: a area esta em toda aba) e o foco vai ao bloco da area. Na Tela cheia de verdade o elemento em tela cheia e
   * a caixa do palco, e o painel fica fora dela: a tela cheia sai antes, senao o painel abriria escondido e o foco iria
   * para tras da tela cheia.
   */
  function showPinned(target: PinnedFocusTarget) {
    leaveStageFullscreen(document, stageBoxRef.current);
    if (target === "message") {
      setTab("chat");
    }
    setPanelOpen(true);
    focusPinned(target);
  }

  /**
   * A pilula ou a linha da enquete fixada: falta responder e ela e a que o palco mostra, ela volta ao palco; senao (ja
   * respondida, encerrada, ou outra enquete sem resposta na frente dela), o painel com a area.
   */
  function onPinnedPoll() {
    if (!pinnedPoll) {
      return;
    }
    if (pinnedPollTapStep({ deferred, poll: pinnedPoll, polls, seenResultIds: [...deferred.seen, ...arrivedResults] }) === "stage") {
      answerPollNow(pinnedPoll.id);
    } else {
      showPinned("poll");
    }
  }

  /** A acao do aviso da sala: Ver abre a fixada. */
  function onSnackAction(key: string) {
    if (key === PINNED_SNACK_ACTION) {
      showPinned("message");
      return;
    }
    if (key === QUESTION_NEWS_SNACK_ACTION) {
      // Ver: a aba Perguntas abre.
      setTab("perguntas");
      setPanelOpen(true);
    }
  }

  function unmute() {
    setMuted(false);
    setSoundTouched(true);
    player.unmute();
  }

  /** O Som da barra (so na gravada): o mesmo mudo do player; desligar so traz de volta a capa "Ativar som" sem a barra (o vertical). */
  function toggleSound() {
    if (muted) {
      unmute();
      return;
    }
    setMuted(true);
    setSoundTouched(true);
    player.send("mute");
  }

  /** Fecha as reacoes; o foco que estava nelas volta ao Reagir (senao cairia no body). */
  function closeReactions() {
    const popover = document.getElementById(ROOM_REACTIONS_ID);
    if (popover && popover.contains(document.activeElement)) {
      rootRef.current?.querySelector<HTMLElement>(`[aria-controls="${ROOM_REACTIONS_ID}"]`)?.focus();
    }
    setReactionsOpen(false);
  }

  function toggleReactions() {
    if (reactionsOpen) {
      closeReactions();
      return;
    }
    setReactionsOpen(true);
  }

  /** A Tela cheia do palco (a caixa inteira: o video, os selos e a Oferta); a barra fica de fora. */
  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const element = stageBoxRef.current;
    if (element?.requestFullscreen) {
      void element.requestFullscreen().catch(() => undefined);
    }
  }

  const timeLabel = saoPauloTime(session.session.scheduledAt);
  const composerPhase = phase === "replay" ? "replay" : phase;
  // Silenciado no chat (R5): o campo do painel, o da gaveta, o do vertical e o das Perguntas dao lugar a frase com a hora
  // de Sao Paulo (ou "até o fim desta live"); reagir e responder enquete continuam.
  const composerNotice = readOnly ? null : mutedPhrase(ban, nowMs);
  const headerPhase = phase === "replay" ? "live" : phase;
  // Com o painel fechado o palco cresce para ocupar a coluna (abaixo de lg; no computador ele ja ocupa).
  // Fechando, o painel continua no lugar ate a saida terminar (rodada v9, P12): o palco muda de tamanho uma vez so.
  const panelMotion = usePanelMotion(panelShown);
  const skeleton = roomSkeleton(design, { cinema: false, panelShown: panelMotion.laid, stageGrows: !panelMotion.laid });
  // O selo do momento no palco (V2-4), pela mesma regra do topo do vertical (D10).
  const momentBadge = verticalBadge({ kind, phase: headerPhase, showLiveBadge: session.session.showLiveBadge });
  const topLeft: RoomStageTopLeft =
    momentBadge.badge === "replay"
      ? { kind: "replay" }
      : momentBadge.badge === "live"
        ? { getOffsetMs, kind: "recorded_on_air" }
        : { getOffsetMs: momentBadge.elapsed ? getOffsetMs : undefined, kind: "session", timeLabel };
  const metaLine = roomDateLine({ durationMinutes: session.webinar.durationMinutes, kind, presenterName, scheduledAt: session.session.scheduledAt }).join(" · ");
  const mobileLine = roomMobileLine(presenterName);
  // O selo de quem assiste agora (o real, ou o somado da Simulacao), no palco ao lado do selo do momento (docs/31 §11.5).
  // A equipe pode esconder dos alunos quantas pessoas estao na sala (docs/30 D102).
  // A chave muda tambem pelo console com a sessao no ar (D107): o ultimo sinal de 15 s vale sobre a sessao.
  const presentHidden = heartbeatHidden ?? session.presentHidden === true;
  // O numero que a sala mostra (o selo do palco, a aba Participantes e o titulo dela): nulo quando nao ha o que mostrar.
  const presentShown = momentBadge.showCount && !presentHidden ? shownCount : null;
  const presentBadge = roomPresentBadge(presentShown);
  // A gravada nao tem a coluna de miniaturas do iframe: os selos de baixo vao ate a borda do video.
  // Com o aviso no palco, as pilulas do chat sobem a altura dele (room-chat-pills.tsx).
  const stageVars = {
    "--room-video-right": `${stageVideoRightPx({ columnShown: false })}px`,
    ...(snackbar.stageOffsetPx > 0 ? { "--room-snackbar-offset": `${snackbar.stageOffsetPx}px` } : {})
  } as CSSProperties;
  // Fora do "Quem pode" (unavailable) nada mais e gravado: sem reacao nem Oferta.
  const writable = (live || phase === "replay") && !unavailable;
  // Os selos de baixo (quem apresenta e o Assistente) so com o video no ar e sem a barra de controles da Bunny: no
  // Replay ela ocupa a base do video (play, tempo, tela cheia), e o selo ficaria por cima dela.
  const bottomBadges = writable && kind !== "replay";

  // O palco e montado uma vez e fica sempre no mesmo lugar (corpo > coluna > caixa): girar so troca classes.
  const stage = (
    <RoomStage
      countdownLabel={countdown}
      coverUrl={coverUrl}
      embedUrl={session.video?.embedUrl ?? null}
      iframeRef={setIframe}
      muted={soundCover}
      onUnmute={unmute}
      replayHref={replayHref}
      sessionId={sessionId}
      state={stageState}
      title={session.webinar.title}
      unavailableText={blockedScreen ? (liveScreenPhrase(blockedScreen, { hasReplay: false })?.title ?? null) : null}
    />
  );

  // O conteudo de cada aba, o mesmo no painel do desenho normal e na gaveta do vertical.
  const chatTab = (
    <>
      {barShown && laterPoll ? <RoomPollLaterCard onResume={() => answerPollNow(laterPoll.id)} poll={laterPoll} /> : null}
      {/* O vertical nao tem a enquete no palco: o card de antes abre a aba Enquetes da gaveta. */}
      {vertical && otherOpenPolls.length > 0 ? (
        <button
          className="mx-3 mt-2 rounded-[12px] border border-room-input-border bg-room-surface-2 px-3 py-2 text-left text-sm hover:border-room-fg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus"
          onClick={() => setTab("enquetes")}
          type="button"
        >
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-room-fg-subtle">{copy.abas.enquetes}</span>
          <span className="block truncate font-bold text-room-fg-strong">{otherOpenPolls[0].question}</span>
        </button>
      ) : null}
      <RoomTranslationBar state={translation} />
      <RoomChatPanel
        aboveComposer={<RoomSimulationJoins layout="stage" look={vertical ? "classic" : "comment"} offsetMs={currentOffsetMs} reducedMotion={reducedMotion} state={simulation} />}
        assistant={assistant}
        chatMode={session.session.chatMode}
        consented={session.me.consented}
        avatarUrl={session.me.avatarUrl ?? null}
        displayName={session.me.displayName}
        error={chat.error}
        look={vertical ? "classic" : "comment"}
        messages={translation.messages}
        notice={composerNotice}
        nowMs={nowMs}
        onRemoveMine={chat.removeMine}
        onRemoveOpenChange={setRemoveOpen}
        onSend={sendChat}
        phase={composerPhase}
        readOnly={readOnly}
        removeOpen={removeOpen}
        sessionId={sessionId}
        shown={vertical || panelShown}
        skewMs={clock.skewMs}
        slowUntilMs={chat.slowUntilMs}
        timeKind={kind}
        webinarId={webinarId}
        zeroMs={zeroMs}
      />
    </>
  );
  // No vertical a gaveta nao tem Participantes: a aba que vem do desenho normal mostra o Chat.
  const shownTab = vertical ? drawerTab : tab;
  const tabContent =
    shownTab === "chat" ? (
      chatTab
    ) : shownTab === "perguntas" ? (
      <RoomQuestionsTab
        assistant={assistant}
        consented={session.me.consented}
        enabled={!readOnly}
        getOffsetMs={getOffsetMs}
        notice={composerNotice}
        onConsented={() => void clock.refresh()}
        onQuestions={questionNews.ingest}
        onRefused={onWriteRefused}
        readOnly={readOnly || phase === "ended"}
        sessionId={sessionId}
        webinarId={webinarId}
        // A gaveta do vertical continua com o filtro e a ordem da aba e o desenho de antes.
        {...(vertical
          ? {}
          : {
              avatarUrl: session.me.avatarUrl ?? null,
              displayName: session.me.displayName,
              ended: phase === "ended",
              filter: questionsFilter,
              look: "comment" as const,
              onCount: setQuestionsCount,
              onFilter: setQuestionsFilter,
              onOrder: setQuestionsOrder,
              order: questionsOrder,
              serverNowMs: nowMs + clock.skewMs
            })}
      />
    ) : shownTab === "participantes" ? (
      // A gravada: quem apresenta e o mesmo numero do cabecalho (o real mais a parte simulada; encerrada, nenhum, como
      // no cabecalho); nunca a lista de alunos.
      <LiveParticipantsTab note={readOnly && kind === "simulated" ? WEBINAR_COPY.simulacao.plateia.previa : null} presenterKnown={presenterName !== null} stage={panelStageNames(presenterName)} students={presentShown} />
    ) : pinnedPoll && pollsTab.length === 0 ? null : (
      // A enquete fixada fica na area das fixadas, acima: aqui so as outras (e nada, quando ela e a unica).
      <RoomPollsTab onAnswer={roomPolls.answer} polls={pollsTab} readOnly={readOnly || phase === "ended"} />
    );
  // A area das fixadas, a mesma no painel e no topo da gaveta do vertical.
  const pinnedArea =
    pinnedMessage || pinnedPoll ? (
      <RoomPinnedArea
        message={pinnedMessage}
        onAnswer={roomPolls.answer}
        poll={pinnedPoll}
        readOnly={readOnly || phase === "ended"}
        timing={{ kind, nowMs, skewMs: clock.skewMs, zeroMs }}
      />
    ) : null;

  // A sala inteira dentro do aviso da sala (o chat e as Perguntas mostram o sucesso nele).
  const page = (
    <div
      aria-label={session.webinar.title}
      aria-modal="true"
      className={skeleton.root}
      data-room-design={design}
      data-room-phase={phase}
      data-room-theme={themeForDesign(design, theme)}
      onKeyDown={handleKeyDown}
      ref={rootRef}
      role="dialog"
      // A altura do campo do painel (abaixo de lg, o aviso fica acima dele).
      style={snackbar.composerPx > 0 ? ({ "--room-composer-h": `${snackbar.composerPx}px` } as CSSProperties) : undefined}
    >
      {vertical ? (
        <VerticalTopBar
          getOffsetMs={getOffsetMs}
          kind={kind}
          onLeave={askToLeave}
          phase={headerPhase}
          presentNow={presentHidden ? null : shownCount}
          showLiveBadge={session.session.showLiveBadge}
          timeLabel={timeLabel}
          title={session.webinar.title}
        />
      ) : (
        <RoomHeader
          leaveInBar={barShown}
          metaLine={metaLine}
          mobileLine={mobileLine}
          onLeave={askToLeave}
          onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
          theme={theme}
          title={session.webinar.title}
        />
      )}

      {confirmLeave ? <RoomLeaveDialog onCancel={() => setConfirmLeave(false)} onLeave={leave} /> : null}

      <div className={skeleton.body} data-room-slot="body">
        <div className={skeleton.stageColumn} data-room-slot="stage-column">
          <div className={skeleton.stageBox} data-room-slot="stage-box" ref={stageBoxRef} style={stageVars}>
            {stage}
            {vertical || unavailable ? null : (
              <RoomStageBadges
                assistantOn={stageAssistantShown({ assistantEnabled: assistant.state.enabled, bottomBadges, offerShown })}
                assistantWideHidden={!placement.assistant}
                present={presentBadge}
                presenterName={bottomBadges ? presenterName : null}
                recording={false}
                topLeft={topLeft}
              />
            )}
            {/* A Na tela no palco de 640 px ou mais (as fixadas com o painel fechado, o banner, o QR Code) e o aviso de venda. */}
            {vertical || unavailable || kind === "replay" ? null : (
              <RoomScreenLayer
                forced={screenForced}
                fullscreen={fullscreenOn}
                handlers={screenHandlers}
                items={screenItems}
                pinned={pinnedPillsOn ? <RoomPinnedPills message={pinnedMessage} onMessage={() => showPinned("message")} onPoll={onPinnedPoll} poll={pinnedPoll} /> : null}
                placement={placement}
                topLeftExtra={<RoomSimulationSales layout="cell" offsetMs={currentOffsetMs} reducedMotion={reducedMotion} state={simulation} />}
              />
            )}
            {/* O comentario ou a pergunta na tela (docs/30 D89): o cartao no palco de 640 px ou mais; no estreito, na faixa. */}
            {vertical ? null : <RoomScreenCommentLayer comment={screenComment} forced={screenForced} place={screenCommentAt} />}
            {/* Com o painel fechado, as 2 ultimas mensagens em pilulas sobre o palco (V2-8); com um item embaixo ou o
                comentario na tela, so no palco estreito. */}
            {chatPillsShown({ blocked: unavailable, design, offerShown, panelShown, settingsTakeover: false }) ? (
              <RoomWideHidden hidden={!placement.chatPills || screenComment !== null}>
                <RoomChatPills kind={kind} messages={overlayMessages(translation.messages)} />
              </RoomWideHidden>
            ) : null}
            {/* O aviso da sala (os sucessos do chat e das Perguntas), so no desenho normal; o vertical nao muda. */}
            {vertical || unavailable ? null : <RoomSnackbarHost onAction={onSnackAction} panelShown={panelShown} />}
            <div className={skeleton.bubbles} data-room-slot="bubbles">
              <RoomReactionBubbles bubbles={reactions.bubbles} layout={vertical ? "vertical" : "stage"} overflow={reactions.overflow} />
            </div>
            {/* O aviso de venda simulado no topo do vertical; no desenho normal, na camada da Na tela (a celula de cima a esquerda). */}
            <div className={cn(skeleton.sales, vertical ? "z-30" : null)} data-room-slot="sales">
              {unavailable || !vertical ? null : <RoomSimulationSales layout="vertical" offsetMs={currentOffsetMs} reducedMotion={reducedMotion} state={simulation} />}
            </div>
            <RoomDock
              chat={
                vertical && chatOpen && !unavailable ? (
                  <VerticalChat
                    error={chat.error}
                    joins={<RoomSimulationJoins layout="vertical" offsetMs={currentOffsetMs} reducedMotion={reducedMotion} state={simulation} />}
                    messages={translation.messages}
                    onMore={() => openDrawer("chat")}
                    onOpenPoll={() => openDrawer("poll")}
                    pinned={pinnedMessage}
                    pollButton={verticalPollButton({ openPolls, pinnedPoll })}
                    replay={kind === "replay"}
                  />
                ) : null
              }
              composer={
                vertical && !unavailable ? (
                  <VerticalComposer
                    chatMode={session.session.chatMode}
                    chatOpen={chatOpen}
                    consented={session.me.consented}
                    drawerId={drawerId}
                    drawerOpen={drawerVisible}
                    notice={composerNotice}
                    nowMs={nowMs}
                    onOpenDrawer={() => openDrawer("drawer")}
                    onReact={reactions.react}
                    onSend={sendChat}
                    onToggleChat={() => setChatOpen((open) => !open)}
                    phase={composerPhase}
                    reactionsDisabled={readOnly || !writable}
                    readOnly={readOnly}
                    slowUntilMs={chat.slowUntilMs}
                  />
                ) : null
              }
              design={design}
              hidden={drawerVisible}
              screen={vertical && pinnedOn ? <RoomScreenDock comment={screenComment} handlers={screenHandlers} items={screenItems} /> : null}
              offer={
                <RoomOffer
                  enabled={writable}
                  getOffsetMs={getOffsetMs}
                  layout={vertical ? "vertical" : "stage"}
                  onShownChange={setOfferShown}
                  readOnly={readOnly}
                  sessionId={sessionId}
                  webinarId={webinarId}
                />
              }
            />
            {/* A enquete no meio do palco (V2-10), por cima do video, da Oferta e das pilulas; so no desenho normal. */}
            {vertical || unavailable ? null : (
              <RoomPollLayer
                focusRequest={pollFocus !== null && pollFocus.key === stagePollKey ? pollFocus.n : 0}
                onAnswer={roomPolls.answer}
                onLater={(pollId) => {
                  setDeferred(deferPoll(deferred, pollId));
                  setPollFocus(null);
                }}
                onSeen={(pollId) => {
                  setDeferred(markPollResultSeen(deferred, pollId));
                  setPollFocus(null);
                }}
                readOnly={readOnly || phase === "ended"}
                stage={stagePoll}
              />
            )}
          </div>
          {/* O palco mais estreito (ou com uma capa): as fixadas, o banner e o QR Code em linhas logo abaixo dele, acima da barra. */}
          {pinnedOn && !vertical ? (
            <RoomScreenStrip
              comment={screenComment}
              forced={screenForced}
              handlers={screenHandlers}
              items={screenItems}
              pinned={pinnedShortcuts ? { message: pinnedMessage, onMessage: () => showPinned("message"), onPoll: onPinnedPoll, poll: pinnedPoll } : null}
            />
          ) : null}
          {pinnedOn ? <RoomScreenAnnouncer items={screenItems} /> : null}
          {pinnedOn ? <RoomScreenCommentAnnouncer comment={screenComment} /> : null}
          {barShown ? (
            <RecordedControls
              fullscreenEnabled={fullscreenEnabled}
              fullscreenOn={fullscreenOn}
              kind={kind}
              onFullscreen={toggleFullscreen}
              onLeave={askToLeave}
              onReact={reactions.react}
              onSound={toggleSound}
              onTogglePanel={() => setPanelOpen(!panelOpen)}
              onToggleReactions={toggleReactions}
              panelFirstFocus={firstFocus === "panel-toggle"}
              panelOpen={panelShown}
              panelUnread={unread}
              reactionsDisabled={readOnly || !writable}
              reactionsOpen={reactionsShown}
              soundDisabled={stageState !== "live" || session.video === null}
              soundOn={!muted}
            />
          ) : null}
        </div>

        {vertical || unavailable ? null : (
          <>
            {/* Fechado, o painel fica montado e escondido (o rascunho, o aceite e a aba continuam). */}
            <RoomPanel
              className={skeleton.panel}
              closable={barShown}
              firstFocus={firstFocus === "tab"}
              id={ROOM_PANEL_ID}
              kind={kind}
              motion={panelMotion}
              onClose={() => setPanelOpen(false)}
              onTab={setTab}
              open={panelShown}
              pinned={pinnedArea}
              pollOpen={openPolls.length > 0}
              tab={tab}
              tabs={tabs}
              titleAction={
                tab === "perguntas" ? (
                  <RoomQuestionsOrderButton onOrder={setQuestionsOrder} order={questionsOrder} />
                ) : tab === "chat" ? (
                  <RoomChatMoreButton onRemove={() => setRemoveOpen(true)} readOnly={readOnly} />
                ) : undefined
              }
              titleCount={
                tab === "participantes" ? presentShown : tab === "enquetes" ? openPolls.length : tab === "perguntas" ? questionsCount : null
              }
            >
              {tabContent}
            </RoomPanel>
            {/* O trilho a direita, a partir de lg (nunca no vertical): abre e fecha o painel em cada aba. */}
            <RoomRail kind={kind} onItem={onRail} panelShown={panelShown} pollOpen={openPolls.length > 0} questionsNew={questionNews.count} tab={tab} tabs={tabs} unread={unread} />
          </>
        )}
      </div>

      {drawerVisible ? (
        <VerticalDrawer
          id={drawerId}
          onClose={() => setDrawerOpen(false)}
          onTab={setTab}
          pinned={pinnedArea}
          pollOpen={openPolls.length > 0}
          reducedMotion={reducedMotion}
          replay={kind === "replay"}
          tab={drawerTab}
          tabs={drawerTabs}
        >
          {tabContent}
        </VerticalDrawer>
      ) : null}
    </div>
  );
  return <RoomSnackbarProvider value={snackbar}>{page}</RoomSnackbarProvider>;
}
