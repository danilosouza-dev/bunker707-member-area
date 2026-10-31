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
import { overlayMessages } from "./live-room-model";
import type { ChatPostBody } from "./room-api";
import { RecordedControls, ROOM_REACTIONS_ID } from "./recorded-controls";
import { ROOM_PANEL_ID } from "./room-bar";
import { RoomChatPanel } from "./room-chat";
import { RoomChatPills } from "./room-chat-pills";
import { RoomHeader } from "./room-header";
import { chatPillsShown, firstFocusTarget, panelStageNames, panelTabsFor, roomDateLine, roomMobileLine, roomPanelShown, stageAssistantShown, stageVideoRightPx, type RoomPanelTab } from "./room-layout-model";
import { RoomOffer } from "./room-offer";
import { RoomPanel, useRoomPanelUnread } from "./room-panel";
import { RoomPollsTab } from "./room-polls";
import { RoomQuestionsTab } from "./room-questions";
import { RoomReactionBubbles } from "./room-reactions";
import { RoomSimulationJoins, RoomSimulationSales } from "./room-simulation";
import { RoomStage } from "./room-stage";
import { RoomStageBadges, type RoomStageTopLeft } from "./room-stage-badges";
import { RoomButton } from "./room-ui";
import { useRoomChat, useRoomClock, useRoomHeartbeat, useRoomReactions } from "./use-room-data";
import { useRoomOrientation } from "./use-room-orientation";
import { useRoomPlayer } from "./use-room-player";
import { useRoomPanelOpen, useRoomTheme } from "./use-room-prefs";
import { useRoomSimulation } from "./use-room-simulation";
import { useRoomTranslation } from "./use-room-translation";
import { RoomDock } from "./vertical/room-dock";
import { VerticalChat } from "./vertical/vertical-chat";
import { VerticalComposer } from "./vertical/vertical-composer";
import { VerticalDrawer, type VerticalDrawerTab } from "./vertical/vertical-drawer";
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
 * O painel do chat fechou (docs/31 V2-7 e V2-8: o balao, a aba ativa tocada de novo no celular, a escolha guardada lida
 * depois da primeira pintura) com o foco dentro dele, ou ja fora da sala: o foco vai para o balao da barra (o que reabre
 * o painel) ou, sem ele na tela, para o primeiro controle da sala na tela (roomFocusTarget). Um foco em outro lugar da
 * sala fica onde esta. Devolve se moveu o foco.
 */
export function returnFocusFromPanel(
  root: Pick<HTMLElement, "contains" | "querySelectorAll"> | null,
  active: Element | null,
  panel: Pick<HTMLElement, "contains"> | null
): boolean {
  if (!root) {
    return false;
  }
  const lost = active === null || !root.contains(active) || (panel !== null && panel.contains(active));
  if (!lost) {
    return false;
  }
  const toggle = Array.from(root.querySelectorAll<HTMLElement>(`[aria-controls="${ROOM_PANEL_ID}"]`)).find(focusShown);
  const target = toggle ?? roomFocusTarget(root);
  if (!target) {
    return false;
  }
  target.focus();
  return true;
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
  const [muted, setMuted] = useState(kind === "simulated");
  /** O primeiro toque no som (o "Ativar som" ou o Som da barra): depois dele a capa "Ativar som" nao volta. */
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
  // Fora do "Quem pode" agora (D41): o player desmonta e nada mais e lido nem gravado.
  const unavailable = clock.accessLost || heartbeatLost;

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

  // O chat liga ja na espera (a sala de espera tem chat, docs/30 §1.6): so o "ver como" fica sem nada.
  const chat = useRoomChat({ enabled: !readOnly && !unavailable, getPlayerOffsetMs: getOffsetMs, initialServerTime: payload.serverTime, sessionId, webinarId });
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
      if (answer.ended) {
        setPlayerEnded(true);
      }
    },
    sessionId,
    webinarId
  });

  const reactions = useRoomReactions({ enabled: !readOnly && !unavailable && (live || phase === "replay"), getOffsetMs, reducedMotion, sessionId, webinarId });
  // O Assistente lido uma vez pela sala: o selo do palco, o chat e as Perguntas usam o mesmo estado.
  const assistant = useRoomAssistant({ enabled: !readOnly && !unavailable, sessionId, webinarId });

  const currentOffsetMs = kind === "replay" ? replaySeconds * 1000 : targetOffsetMs({ deviceNowMs: nowMs, skewMs: clock.skewMs, zeroMs });
  const revealed = useMemo(() => revealedMessages(chat.messages, currentOffsetMs), [chat.messages, currentOffsetMs]);
  // Fase 4 (docs/30 §1.6): a Simulacao so na sessao gravada (o Replay livre nunca simula; a sala ao vivo e outra tela),
  // a traducao das mensagens mostradas (as duas formas da sala mostram SO as traduzidas) e a Oferta (no canto do palco
  // ou a pilula do vertical). Os tres sao pontos de encaixe preenchidos pelas frentes.
  const simulation = useRoomSimulation({ enabled: !readOnly && !unavailable && kind === "simulated" && phase !== "ended", getOffsetMs, sessionId, webinarId });
  const translation = useRoomTranslation({ enabled: !readOnly && !unavailable, messages: revealed, sessionId, webinarId });
  const openPolls = session.polls.filter((poll) => poll.status === "open");
  // As abas do painel pela regra das tres salas (V2-7); a gaveta do vertical continua como no docs/30 §1.6 (Enquetes
  // tambem com o resultado de uma enquete encerrada, sem Participantes).
  const tabs = panelTabsFor({ kind, openPolls: openPolls.length, tab });
  const drawerTab: VerticalDrawerTab = tab === "participantes" ? "chat" : tab;
  const drawerTabs: VerticalDrawerTab[] = ["chat", "perguntas", ...(openPolls.length > 0 || tab === "enquetes" || session.polls.length > 0 ? (["enquetes"] as const) : [])];
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
  // O contador do balao: as mensagens novas desde que o painel fechou (os ids e o offset do video da sessao, cujo zero
  // nao muda: a hora marcada na gravada, o player no Replay).
  const unread = useRoomPanelUnread({ chatLoaded: chat.loaded, kind, messages: translation.messages, offsetMs: currentOffsetMs, panelShown });
  const firstFocus = firstFocusTarget({ panelShown });

  const leave = useCallback(() => {
    router.push(webinarHref);
  }, [router, webinarHref]);

  const askToLeave = useCallback(() => {
    if (live && !unavailable) {
      setConfirmLeave(true);
      return;
    }
    leave();
  }, [leave, live, unavailable]);

  // Foco preso e Esc (docs/30 §1.7): o dialogo e o unico lugar do teclado enquanto esta aberto.
  useRoomDialogLock(rootRef, true);

  // Fora do "Quem pode" (D41) o painel, a gaveta e o compositor saem com o foco que estava neles: ele volta para a
  // sala antes do proximo toque de tecla (como barFocusLost na sala ao vivo).
  useLayoutEffect(() => {
    if (unavailable) {
      refocusRoom(rootRef.current, document.activeElement);
    }
  }, [unavailable]);

  // A barra saiu (a sessao encerrada, o celular em pe) com o foco nela: o foco volta para a sala, nunca fica no body.
  const barShownRef = useRef(barShown);
  useLayoutEffect(() => {
    const was = barShownRef.current;
    barShownRef.current = barShown;
    if (was && !barShown) {
      refocusRoom(rootRef.current, document.activeElement);
    }
  }, [barShown]);

  // O painel do chat fechou com o foco nele (ou a escolha guardada chegou depois da primeira pintura): o foco vai ao
  // balao da barra.
  const panelShownRef = useRef(panelShown);
  useLayoutEffect(() => {
    const was = panelShownRef.current;
    panelShownRef.current = panelShown;
    if (was && !panelShown) {
      returnFocusFromPanel(rootRef.current, document.activeElement, document.getElementById(ROOM_PANEL_ID));
    }
  }, [panelShown]);

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

  /** O envio do chat, o mesmo nos dois desenhos (no replay vai o segundo do video; o aceite novo rele a sessao). */
  async function sendChat(body: Omit<ChatPostBody, "sessionId">) {
    const answer = await chat.send({ ...body, offsetMs: kind === "replay" ? Math.round(getOffsetMs()) : undefined });
    if (!session.me.consented) {
      void clock.refresh();
    }
    return answer;
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (confirmLeave) {
        setConfirmLeave(false);
      } else if (reactionsShown) {
        closeReactions();
      } else {
        askToLeave();
      }
      return;
    }
    trapRoomFocus(event, rootRef.current);
  }

  function unmute() {
    setMuted(false);
    setSoundTouched(true);
    player.unmute();
  }

  /** O Som da barra (so na gravada): o mesmo mudo do player; desligar nao traz de volta a capa "Ativar som". */
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

  const stageState = unavailable ? "unavailable" : phase === "replay" ? "replay" : phase;
  const timeLabel = saoPauloTime(session.session.scheduledAt);
  const composerPhase = phase === "replay" ? "replay" : phase;
  const headerPhase = phase === "replay" ? "live" : phase;
  // Com o painel fechado o palco cresce para ocupar a coluna (abaixo de lg; no computador ele ja ocupa).
  const skeleton = roomSkeleton(design, { cinema: false, panelShown, stageGrows: !panelShown });
  // O selo do momento no palco (V2-4), pela mesma regra do topo do vertical (D10).
  const momentBadge = verticalBadge({ kind, phase: headerPhase, showLiveBadge: session.session.showLiveBadge });
  const topLeft: RoomStageTopLeft =
    momentBadge.badge === "replay"
      ? { kind: "replay" }
      : momentBadge.badge === "live"
        ? { getOffsetMs, kind: "recorded_on_air" }
        : { getOffsetMs: momentBadge.elapsed ? getOffsetMs : undefined, kind: "session", timeLabel };
  const dateLine = roomDateLine({ durationMinutes: session.webinar.durationMinutes, kind, presenterName, scheduledAt: session.session.scheduledAt }).join(" · ");
  const mobileLine = roomMobileLine({ presenterName, presentNow: momentBadge.showCount ? shownCount : null }).join(" · ");
  // A gravada nao tem a coluna de miniaturas do iframe: os selos de baixo vao ate a borda do video.
  const stageVars = { "--room-video-right": `${stageVideoRightPx({ columnShown: false })}px` } as CSSProperties;
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
      muted={muted && !soundTouched && kind === "simulated"}
      onUnmute={unmute}
      replayHref={replayHref}
      sessionId={sessionId}
      state={stageState}
      title={session.webinar.title}
    />
  );

  // O conteudo de cada aba, o mesmo no painel do desenho normal e na gaveta do vertical.
  const chatTab = (
    <>
      {openPolls.length > 0 ? (
        <button
          className="mx-3 mt-2 rounded-[12px] border border-room-input-border bg-room-surface-2 px-3 py-2 text-left text-sm hover:border-room-fg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus"
          onClick={() => setTab("enquetes")}
          type="button"
        >
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-room-fg-subtle">{copy.abas.enquetes}</span>
          <span className="block truncate font-bold text-room-fg-strong">{openPolls[0].question}</span>
        </button>
      ) : null}
      <RoomTranslationBar state={translation} />
      <RoomChatPanel
        aboveComposer={<RoomSimulationJoins layout="stage" offsetMs={currentOffsetMs} reducedMotion={reducedMotion} state={simulation} />}
        assistant={assistant}
        chatMode={session.session.chatMode}
        consented={session.me.consented}
        defaultDisplayMode={session.me.displayMode ?? "first_name_initial"}
        displayName={session.me.displayName}
        error={chat.error}
        messages={translation.messages}
        nowMs={nowMs}
        onRemoveMine={chat.removeMine}
        onSend={sendChat}
        phase={composerPhase}
        pinned={session.pinned}
        readOnly={readOnly}
        sessionId={sessionId}
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
        allowAnonymous={session.session.anonymousQuestions}
        assistant={assistant}
        consented={session.me.consented}
        defaultDisplayMode={session.me.displayMode ?? "first_name_initial"}
        enabled={!readOnly}
        getOffsetMs={getOffsetMs}
        onConsented={() => void clock.refresh()}
        readOnly={readOnly || phase === "ended"}
        sessionId={sessionId}
        webinarId={webinarId}
      />
    ) : shownTab === "participantes" ? (
      // A gravada: quem apresenta e o mesmo numero do cabecalho (o real mais a parte simulada; encerrada, nenhum, como
      // no cabecalho); nunca a lista de alunos.
      <LiveParticipantsTab stage={panelStageNames(presenterName)} students={momentBadge.showCount ? shownCount : null} />
    ) : (
      <RoomPollsTab enabled={!readOnly} getOffsetMs={getOffsetMs} initial={session.polls} readOnly={readOnly || phase === "ended"} sessionId={sessionId} webinarId={webinarId} />
    );

  return (
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
    >
      {vertical ? (
        <VerticalTopBar
          getOffsetMs={getOffsetMs}
          kind={kind}
          onLeave={askToLeave}
          phase={headerPhase}
          presentNow={shownCount}
          showLiveBadge={session.session.showLiveBadge}
          timeLabel={timeLabel}
          title={session.webinar.title}
        />
      ) : (
        <RoomHeader
          dateLine={dateLine}
          leaveInBar={barShown}
          mobileLine={mobileLine}
          onLeave={askToLeave}
          onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
          presentNow={momentBadge.showCount ? shownCount : null}
          theme={theme}
          title={session.webinar.title}
        />
      )}

      {confirmLeave ? (
        <div className={skeleton.confirm} role="alertdialog" aria-label={copy.sairConfirmar}>
          <p className="text-sm font-semibold text-room-warn-fg">{copy.sairConfirmar}</p>
          <div className="flex gap-2">
            <RoomButton data-room-first-focus onClick={leave} size="sm" variant="danger">
              {copy.sair}
            </RoomButton>
            <RoomButton onClick={() => setConfirmLeave(false)} size="sm" variant="secondary">
              {copy.voltar}
            </RoomButton>
          </div>
        </div>
      ) : null}

      <div className={skeleton.body} data-room-slot="body">
        <div className={skeleton.stageColumn} data-room-slot="stage-column">
          <div className={skeleton.stageBox} data-room-slot="stage-box" ref={stageBoxRef} style={stageVars}>
            {stage}
            {vertical || unavailable ? null : (
              <RoomStageBadges
                assistantOn={stageAssistantShown({ assistantEnabled: assistant.state.enabled, bottomBadges, offerShown })}
                presenterName={bottomBadges ? presenterName : null}
                recording={false}
                topLeft={topLeft}
              />
            )}
            {/* Com o painel fechado, as 2 ultimas mensagens em pilulas sobre o palco (V2-8). */}
            {chatPillsShown({ blocked: unavailable, design, offerShown, panelShown, settingsTakeover: false }) ? (
              <RoomChatPills kind={kind} messages={overlayMessages(translation.messages)} />
            ) : null}
            <div className={skeleton.bubbles} data-room-slot="bubbles">
              <RoomReactionBubbles bubbles={reactions.bubbles} layout={vertical ? "vertical" : "stage"} overflow={reactions.overflow} />
            </div>
            <div className={cn(skeleton.sales, vertical ? "z-30" : null)} data-room-slot="sales">
              {unavailable ? null : (
                <RoomSimulationSales layout={vertical ? "vertical" : "stage"} offsetMs={currentOffsetMs} reducedMotion={reducedMotion} state={simulation} />
              )}
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
                    openPollQuestion={openPolls[0]?.question ?? null}
                    pinned={session.pinned}
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
                    defaultDisplayMode={session.me.displayMode ?? "first_name_initial"}
                    drawerId={drawerId}
                    drawerOpen={drawerVisible}
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
          </div>
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
          // Fechado, o painel fica montado e escondido (o rascunho, o aceite e a aba continuam).
          <RoomPanel
            className={skeleton.panel}
            closable={barShown}
            firstFocus={firstFocus === "tab"}
            id={ROOM_PANEL_ID}
            kind={kind}
            onClose={() => setPanelOpen(false)}
            onTab={setTab}
            open={panelShown}
            pollOpen={openPolls.length > 0}
            tab={tab}
            tabs={tabs}
          >
            {tabContent}
          </RoomPanel>
        )}
      </div>

      {drawerVisible ? (
        <VerticalDrawer
          id={drawerId}
          onClose={() => setDrawerOpen(false)}
          onTab={setTab}
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
}
