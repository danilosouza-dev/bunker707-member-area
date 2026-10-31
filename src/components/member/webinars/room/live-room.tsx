"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { deviceEnvironmentOf, deviceSectionReady, deviceSettingsFor, type DeviceKind, type DeviceOption, type DeviceSettings } from "@/lib/jitsi-device-settings";
import type { LiveEmbedLook } from "@/lib/jitsi-room-config";
import { announceLiveRoomMedia } from "@/lib/lesson-media-signal";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { roomMediaLessonId } from "@/lib/webinar-room-client";
import { formatCountdown } from "@/lib/webinar-time";
import type { LiveRoomInfo } from "@/server/webinars/live-model";
import { roomHref, type StudentRoomPayload } from "@/server/webinars/student-model";
import { RoomTranslationBar } from "../translation/room-translation-bar";
import { LIVE_REACTIONS_ID, LIVE_SETTINGS_ID, LiveControls, LiveStageFullscreen } from "./live-controls";
import { useRoomAssistant } from "./assistant/use-room-assistant";
import { LiveCameraDialog, LiveMicDialog, LiveParticipantsTab } from "./live-notices";
import {
  barFocusLost,
  cameraClick,
  isRecording,
  LIVE_ROOM_RULES,
  liveAcceptsWrites,
  liveBarShown,
  liveComposerNotice,
  liveElapsedLabel,
  liveNoticePhrase,
  liveOnAirLabel,
  livePhaseOf,
  liveRoomScreen,
  liveShortcutOf,
  localBanStillValid,
  mergeBan,
  micFocusLost,
  overlayMessages,
  pendingTogglePhrase,
  prefersCinemaMode,
  screenBlocksRoom,
  stageColumnShown,
  stageNames,
  usesOurBar,
  viewMenuFocusLost,
  writeRefusalOf,
  type LiveJoinFailure
} from "./live-room-model";
import { LiveSettings } from "./live-settings";
import { LiveStage } from "./live-stage";
import { ROOM_PANEL_ID } from "./room-bar";
import { RoomChatPanel } from "./room-chat";
import { RoomChatPills } from "./room-chat-pills";
import { RoomHeader } from "./room-header";
import {
  chatPillsShown,
  firstFocusTarget,
  liveSkeletonState,
  liveStageMoment,
  panelTabsFor,
  panelToggleStep,
  roomDateLine,
  roomMobileLine,
  roomPanelShown,
  stageVideoRightPx,
  type RoomPanelTab
} from "./room-layout-model";
import { RoomPanel, useRoomPanelUnread } from "./room-panel";
import { RoomPollLaterCard, RoomPollLayer } from "./room-poll-layer";
import { deferPoll, deferredPollCard, markPollResultSeen, pollToReopen, resumePoll, stagePollFor } from "./room-poll-model";
import { RoomPollsTab } from "./room-polls";
import { RoomQuestionsTab } from "./room-questions";
import { RoomReactionBubbles } from "./room-reactions";
import { RoomStageBadges } from "./room-stage-badges";
import { RoomButton } from "./room-ui";
import { ROOM_VIEW_MENU_ID } from "./room-view-menu";
import { useRoomChat, useRoomClock, useRoomHeartbeat, useRoomReactions } from "./use-room-data";
import { useRoomTranslation } from "./use-room-translation";
import { entryInRoom, useLiveRoom } from "./use-live-room";
import { useRoomPolls } from "./use-room-polls";
import { useDeferredPolls, useRoomPanelOpen, useRoomTheme } from "./use-room-prefs";
import { useStageGeometry } from "./use-stage-geometry";
import { returnFocusFromPanel, returnFocusFromPoll, roomFocusTarget, trapRoomFocus, useRoomDialogLock, useRoomReducedMotion } from "./webinar-room";
import { roomSkeleton } from "./vertical/vertical-model";

// A sala da Live ao vivo do aluno (docs/30 §1.3, §1.4, §1.5, §1.7, §5.1, §6.3, §8.5 e §9; fase 3), no mesmo endereco
// da gravada (/webinarios/[slug]/sala?sessao=) e no mesmo dialogo de tela cheia (aria-modal, foco preso, Esc pede
// confirmacao com a live no ar). O cabecalho ("{n} assistindo" e Sair; sem Minimizar, docs/31 V2-2), o palco com os
// selos ("Ao vivo · 00:42:10" pelo inicio de verdade e o Gravando) e o iframe (live-stage.tsx: Entrar na sala,
// Reconectando…, a sala trancada, em breve, encerrada), a nossa barra (live-controls.tsx), as abas Chat / Perguntas / Participantes /
// Enquetes (a de Enquetes so com enquete aberta; o painel abre e fecha pelo balao da barra e, fechado, as 2 ultimas
// mensagens ficam em pilulas sobre o palco) e os avisos de gravacao da camera e do microfone (live-notices.tsx). O chat, as perguntas, as enquetes,
// as reacoes e o sinal de presenca sao os da fase 2; o offset do chat e do servidor. Silenciado no chat: o campo da
// lugar a frase com a hora de Sao Paulo; removido ou banido (pela sessao ou por um 409 de qualquer rota) e quem saiu do
// "Quem pode" no meio da live (o 404 da releitura da sessao, do sinal de presenca, do token ou dos sinais; D41): a sala
// da lugar a frase e o iframe desmonta; encerrada (a sessao relida, o sinal de presenca ou o join-token): o iframe
// desmonta e o palco mostra o fim, com Assistir o replay quando ha. Com a sala no ar, nenhum pop-up abre
// (announceLiveRoomMedia). Host e co-apresentador que entram por aqui usam a barra do iframe. O botao Configurações da
// barra abre o painel (live-settings.tsx) com as secoes de deviceSettingsFor: a escolha de microfone so depois do
// Falar e a de camera so depois do aviso de gravacao aceito (a troca pede a permissao do navegador, D4; um erro de
// camera desfaz o aceite); a sala confere a secao de novo antes de cada troca. Reagir e Configurações nunca ficam
// abertos juntos; no celular o painel toma o lugar da gaveta (o palco encolhe, a barra fica na tela); Esc, Fechar e o
// proprio botao Configurações (o WebKit nao foca o botao no clique) devolvem o foco ao botao. O toque em Microfone /
// Câmera que espera a troca daquele aparelho deixa o botao com o estado real (o que esta no ar), ocupado, e a linha de
// aviso diz o que acontece quando a troca terminar. A barra que some (a live
// encerrada, removido ou banido) fecha o painel e as reacoes, e o foco que estava nela vai para a sala (o
// primeiro [data-room-first-focus] na tela ou, sem ele, o primeiro controle na tela: roomFocusTarget), nunca para o
// body. No "ver como" da equipe nada e gravado: nem token, nem sinal, nem chat.
// Redesign V2, F2 (docs/31 V2-11 e V2-12): o tema claro ou escuro da pessoa fica no data-room-theme do dialogo (as
// superficies fora do video usam os tokens --room-*) e entra no iframe pelo LiveEmbedLook so na montagem (Entrar na
// sala, Tentar de novo, a volta depois da queda): o motor nao tem comando de tema, e trocar no meio nao remonta.
// Redesign V2, F3 (docs/31 V2-3 e V2-4): o cabecalho tem a linha da data (com a duracao e o apresentador) e, no
// celular, "com {apresentador} · {n} assistindo"; "Ao vivo · 00:42:10", "Gravando", quem apresenta e o Assistente
// ficam no palco (room-stage-badges.tsx), antes da coluna de miniaturas do iframe (--room-video-right); antes do
// "Começar para todos", com a sala aberta, "Aguardando o apresentador" fica no mesmo lugar. O estado do Assistente e
// lido uma vez pela sala e desce para o chat e as Perguntas. Abaixo de sm o botao de tema sai do cabecalho (V2-18) e o
// tema fica numa linha do painel Configurações.
// Redesign V2, F4 (docs/31 V2-6 a V2-8 e V2-18): a barra de tres zonas com o Sair (a partir de lg; abaixo, no
// cabecalho), Reagir e Configurações por cima do palco no computador, e o balao que abre e fecha o painel do chat
// tambem no computador (guardado no navegador; fechado, o painel fica montado e escondido e o palco cresce). O mesmo
// esqueleto da gravada (corpo > coluna > caixa do palco, roomSkeleton): o iframe nunca muda de lugar. No celular a Tela
// cheia (ou o Modo cinema) fica no canto do palco.
// Redesign V2, F5 (docs/31 V2-7 e V2-8): o painel de 320 px (room-panel.tsx) com as abas em pilula no topo (tambem no
// celular: a aba de baixo que abria e fechava saiu, o balao manda), o X "Fechar o painel" no computador e as abas pela
// regra unica das tres salas (panelTabsFor). Fechado, o balao conta as mensagens novas de outras pessoas e as 2 ultimas
// ficam em pilulas sobre o palco (room-chat-pills.tsx); o primeiro foco e o balao (firstFocusTarget).
// Redesign V2, F7 (docs/31 V2-10): a enquete aberta sem resposta abre no meio do palco (room-poll-layer.tsx), mesmo com
// o painel fechado; "Responder depois" (ou o Esc nela) recolhe para o card do chat, cujo "Responder agora" a traz de
// volta, como o atalho E; o resultado compartilhado aparece no mesmo lugar. As enquetes sao lidas pela sala
// (useRoomPolls), e a aba so desenha.
// Redesign V2, F8 (docs/31 V2-16 e V2-A5): a Visão do vídeo na barra (a partir de lg) troca Palco por Grade por comando,
// sem remontar, e o botao diz o que o motor mostra. A sala mede o iframe (use-stage-geometry.ts) e a coluna de
// miniaturas so fica com 1013 px ou mais (abrir ou fechar o painel refaz a conta); os selos e as pilulas descontam a
// coluna so quando ela esta na tela.

export type LiveWebinarRoomProps = {
  coverUrl: string | null;
  /** O nonce da pagina (o external_api.js entra com ele; a CSP nao ganha origem nova). */
  nonce: string | null;
  payload: StudentRoomPayload;
  /** O apresentador (a pagina sabe; vai em "No palco"). */
  presenterName: string | null;
  /** "Ver como" da equipe: a sala abre e nada e gravado. */
  readOnly: boolean;
  /** Host, co-apresentador ou Equipe: entram tambem na Sessao de pratica e com a sala trancada. */
  staff: boolean;
  /** A pagina da live (Sair e Esc voltam para ca). */
  webinarHref: string;
};

/**
 * O que uma recusa contou antes de a sessao ser relida. `ended`, `unconfigured` e `unavailable` (o 404 de quem saiu do
 * "Quem pode") ficam (nao se desfazem); banido, removido e silenciado valem so ate a proxima leitura da sessao
 * (`refusedAtMs`, localBanStillValid): o silencio que venceu e o Desfazer da equipe liberam a sala sem recarregar.
 */
type LocalState = { banned: boolean; ended: boolean; kicked: boolean; muted: boolean; refusedAtMs: number | null; unavailable: boolean; unconfigured: boolean };

const NO_LOCAL: LocalState = { banned: false, ended: false, kicked: false, muted: false, refusedAtMs: null, unavailable: false, unconfigured: false };
const NO_LOCAL_BAN = { banned: false, kicked: false, muted: false };

function subscribeNothing() {
  return () => undefined;
}

/** O computador (lg): Configurações abre por cima do palco; no celular, toma o lugar do painel do chat. */
const DESKTOP = "(min-width: 1024px)";

function subscribeDesktop(callback: () => void) {
  try {
    const media = window.matchMedia(DESKTOP);
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  } catch {
    return () => undefined;
  }
}

function readDesktop() {
  try {
    return window.matchMedia(DESKTOP).matches;
  } catch {
    return false;
  }
}

/** Os nomes dos aparelhos que o navegador ainda nao nomeou ("Microfone 1"). */
const DEVICE_NAMES: Record<DeviceKind, (position: number) => string> = {
  audioInput: WEBINAR_COPY.aoVivo.config.reserva.microfone,
  audioOutput: WEBINAR_COPY.aoVivo.config.reserva.altoFalante,
  videoInput: WEBINAR_COPY.aoVivo.config.reserva.camera
};

function deviceEnvironment() {
  return deviceEnvironmentOf({ maxTouchPoints: navigator.maxTouchPoints, userAgent: navigator.userAgent });
}

/** iPhone / iPad: a faixa de volume some (o volume do audio e so leitura la). */
function readIOS() {
  try {
    return deviceEnvironment().isIOS;
  } catch {
    return false;
  }
}

/** Celular: sem desfocar o fundo e sem a secao de atalhos do teclado. */
function readMobile() {
  try {
    return deviceEnvironment().isMobile;
  } catch {
    return false;
  }
}

function readCinemaPreferred() {
  try {
    const doc = document as Document & { webkitFullscreenEnabled?: boolean };
    return prefersCinemaMode({ fullscreenEnabled: Boolean(doc.fullscreenEnabled || doc.webkitFullscreenEnabled), userAgent: navigator.userAgent });
  } catch {
    return false;
  }
}

/** A resposta sem o bloco `live` (um servidor antigo): o ambiente sem a sala ao vivo, nada quebra. */
function liveInfoOf(payload: StudentRoomPayload): LiveRoomInfo {
  return payload.live ?? { lobby: false, locked: false, meetConfigured: false, practice: false, recording: false, startedAt: payload.session.startedAt, status: payload.session.status };
}

export function LiveWebinarRoom({ coverUrl, nonce, payload, presenterName, readOnly, staff, webinarHref }: LiveWebinarRoomProps) {
  const copy = WEBINAR_COPY.sala;
  const router = useRouter();
  const webinarId = payload.webinar.id;
  const sessionId = payload.session.id;
  const lessonId = roomMediaLessonId(sessionId);
  const { accessLost, refresh: refreshSession, session, skewMs, skewRef } = useRoomClock({ enabled: !readOnly, initial: payload, webinarId });
  // A hora (do servidor) da leitura da sessao que a sala tem: a recusa local so vale enquanto ela e de antes da recusa.
  const sessionTimeRef = useRef(session.serverTime);
  useEffect(() => {
    sessionTimeRef.current = session.serverTime;
  }, [session.serverTime]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.parse(payload.serverTime));
  const [tab, setTab] = useState<RoomPanelTab>("chat");
  const [panelOpen, setPanelOpen] = useRoomPanelOpen();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // O menu da Visão do vídeo (docs/31 V2-16): aberto pela sala, para nunca ficar junto com Reagir ou Configurações.
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [cameraAsk, setCameraAsk] = useState(false);
  const [cameraConsented, setCameraConsented] = useState(false);
  const [fullscreenOn, setFullscreenOn] = useState(false);
  const [cinemaOn, setCinemaOn] = useState(false);
  const [local, setLocal] = useState<LocalState>(NO_LOCAL);
  const [heartbeatPresent, setHeartbeatPresent] = useState<number | null>(null);
  const reducedMotion = useRoomReducedMotion();
  const cinemaPreferred = useSyncExternalStore(subscribeNothing, readCinemaPreferred, () => false);
  const isIOS = useSyncExternalStore(subscribeNothing, readIOS, () => false);
  const isMobile = useSyncExternalStore(subscribeNothing, readMobile, () => false);
  // A largura do iframe (a coluna de miniaturas, V2-A5) e o toque (o puxador da coluna mais largo).
  const geometry = useStageGeometry(frameRef);
  const desktop = useSyncExternalStore(subscribeDesktop, readDesktop, () => false);
  const [theme, setTheme] = useRoomTheme();
  // O tema que o iframe recebe na proxima montagem (o guardado ja vale no primeiro Entrar na sala).
  const look = useMemo<LiveEmbedLook>(() => ({ layout: "stage", theme }), [theme]);

  const info = liveInfoOf(session);
  const status = local.ended ? "ended" : info.status;
  const live: LiveRoomInfo = { ...info, status };
  const localBan = localBanStillValid({ refusedAtMs: local.refusedAtMs, serverTimeIso: session.serverTime, skewMs }) ? local : NO_LOCAL_BAN;
  const ban = mergeBan(session.me.ban, localBan);
  const screenInput = { ban, live, staff, unavailable: accessLost || local.unavailable, unconfigured: local.unconfigured };
  // O iframe pode montar quando a sala esta aberta para a pessoa (a tranca so barra quem ainda nao entrou).
  const allowed = !readOnly && liveRoomScreen({ ...screenInput, inRoom: true }) === "open";
  const phase = livePhaseOf(status);
  const writable = liveAcceptsWrites(status);

  /** O join-token (ou um lote de sinais) recusou: a tela muda na hora e a sessao e relida. 404: fora do acesso, de vez. */
  const onRefused = useCallback(
    (failure: Exclude<LiveJoinFailure, "error">) => {
      setLocal((previous) => {
        const barred = failure === "banned" || failure === "kicked";
        // Uma recusa nova recomeca a ponte (a de antes ja foi coberta pela leitura, ou ainda vale e soma).
        const base = barred && !localBanStillValid({ refusedAtMs: previous.refusedAtMs, serverTimeIso: sessionTimeRef.current, skewMs: skewRef.current ?? 0 }) ? { ...previous, ...NO_LOCAL_BAN } : previous;
        return {
          ...base,
          banned: base.banned || failure === "banned",
          ended: base.ended || failure === "ended",
          kicked: base.kicked || failure === "kicked",
          refusedAtMs: barred ? Date.now() : base.refusedAtMs,
          unavailable: base.unavailable || failure === "unavailable",
          unconfigured: base.unconfigured || failure === "meet_unconfigured"
        };
      });
      void refreshSession();
    },
    [refreshSession, skewRef]
  );

  // As secoes do painel Configurações da ultima pintura: a troca de aparelho so passa quando a secao esta pronta.
  const deviceSettingsRef = useRef<DeviceSettings | null>(null);
  const canSwitchDevice = useCallback((kind: DeviceKind) => deviceSettingsRef.current !== null && deviceSectionReady(deviceSettingsRef.current, kind), []);

  // Um erro de camera encerrou o aceite pendente (o navegador recusou): o proximo clique em Câmera abre o aviso de novo.
  const onCameraConsentEnded = useCallback(() => setCameraConsented(false), []);

  const room = useLiveRoom({
    allowed,
    canSwitchDevice,
    container: frameRef,
    deviceNames: DEVICE_NAMES,
    frameTitle: WEBINAR_COPY.aoVivo.palco,
    frameWidth: geometry.frameWidth,
    lobby: live.lobby === true,
    look,
    nonce,
    onCameraConsentEnded,
    onRefused,
    sessionId,
    settingsOpen,
    webinarId
  });
  const screen = liveRoomScreen({ ...screenInput, inRoom: entryInRoom(room.entry) });
  const blocked = screenBlocksRoom(screen);
  // A nossa barra (e com ela o painel Configurações e as reacoes) so existe com a sala no ar: a live encerrada, removido
  // ou banido a tiram. Sem ela, nada fica "aberto" (o celular devolve a gaveta do chat; o Esc sai da sala).
  const barShown = liveBarShown({ blocked, screen });
  const [barWasShown, setBarWasShown] = useState(barShown);
  if (barWasShown !== barShown) {
    setBarWasShown(barShown);
    if (!barShown) {
      setSettingsOpen(false);
      setReactionsOpen(false);
    }
  }
  const settingsShown = settingsOpen && barShown;
  const reactionsShown = reactionsOpen && barShown;
  // No celular, o painel Configurações aberto toma o lugar do painel do chat: o palco encolhe e a nossa barra fica na
  // tela (o botao que fecha o painel nunca sai da tela); o balao fecha Configurações e abre o chat.
  const settingsTakeover = settingsShown && !desktop;
  // O painel do chat: o balao da barra abre e fecha (tambem no computador); sem a barra ele fica na tela.
  const panelShown = roomPanelShown({ barShown, panelOpen, settingsTakeover });

  // A barra sumiu com o foco nela (no painel, nas reacoes, num botao): o foco volta para a sala, nunca para o body (onde
  // o Esc, os atalhos e a trava do Tab deixariam de valer).
  const barShownRef = useRef(barShown);
  useLayoutEffect(() => {
    const was = barShownRef.current;
    barShownRef.current = barShown;
    const root = rootRef.current;
    if (root && barFocusLost({ active: document.activeElement, barShown, barWasShown: was, body: document.body })) {
      roomFocusTarget(root)?.focus();
    }
  }, [barShown]);
  // Dentro da sala de verdade: com a tela fechada (encerrada, removido) o iframe ja desmontou.
  const joined = allowed && room.entry === "joined";
  const ourBar = usesOurBar(room.reply?.role ?? null);
  // A Visão do vídeo so com a barra e o iframe no ar: desligada (a reconexao, a saida, a barra que sumiu) ela fecha de
  // vez, e na volta a sala nao reabre sozinha nem leva o foco para a opcao marcada sem o aluno pedir.
  const viewMenuUsable = barShown && joined;
  const [viewMenuWasUsable, setViewMenuWasUsable] = useState(viewMenuUsable);
  if (viewMenuWasUsable !== viewMenuUsable) {
    setViewMenuWasUsable(viewMenuUsable);
    if (!viewMenuUsable) {
      setViewMenuOpen(false);
    }
  }
  const viewMenuShown = viewMenuOpen && viewMenuUsable;
  // O menu fechou por ficar desligado com o foco na opcao que sumiu (ou ja no body): o foco volta para a sala. Fechado
  // pelo aluno (a escolha, o Esc, o proprio botao, um toque fora, o atalho R), o foco ja foi ao botao do menu.
  const viewMenuShownRef = useRef(viewMenuShown);
  useLayoutEffect(() => {
    const was = viewMenuShownRef.current;
    viewMenuShownRef.current = viewMenuShown;
    const root = rootRef.current;
    if (!was || viewMenuShown || viewMenuUsable || !root) {
      return;
    }
    const active = document.activeElement;
    const inMenu = active !== null && Boolean(document.getElementById(ROOM_VIEW_MENU_ID)?.contains(active));
    if (viewMenuFocusLost({ active, body: document.body, inMenu })) {
      roomFocusTarget(root)?.focus();
    }
  }, [viewMenuShown, viewMenuUsable]);
  // O Microfone saiu da barra com o foco nele (a equipe recolheu ou silenciou o microfone, docs/31 V2-19): o botao sai
  // do DOM e o foco cai no body; a sala o manda de volta para dentro dela, como quando a barra inteira some.
  const micShown = barShown && ourBar && room.signals.micAllowed;
  const micShownRef = useRef(micShown);
  useLayoutEffect(() => {
    const was = micShownRef.current;
    micShownRef.current = micShown;
    const root = rootRef.current;
    if (root && micFocusLost({ active: document.activeElement, body: document.body, micShown, micWasShown: was })) {
      roomFocusTarget(root)?.focus();
    }
  }, [micShown]);
  // O microfone so depois do Falar (micAllowed) e a camera so depois do aviso aceito (cameraConsented): D4 e §8.5.
  const deviceSettings = deviceSettingsFor({
    allowStudentCamera: room.reply ? room.reply.settings.allowStudentCamera : null,
    cameraConsented,
    isIOS,
    isMobile,
    joined,
    micAllowed: room.signals.micAllowed,
    outputChangeAvailable: room.devices.outputChangeAvailable,
    outputs: room.devices.lists.audioOutput,
    role: room.reply?.role ?? null,
    // Depois do consentimento, a lista sem id e o navegador ainda sem a permissao (nunca "nenhum aparelho").
    semPermissao: room.devices.semPermissao,
    videoOn: room.signals.videoOn
  });
  useEffect(() => {
    deviceSettingsRef.current = deviceSettings;
  });

  // Fora do "Quem pode" pela sessao ou pela presenca (D41): a sala sai do iframe de vez (o que sobrou da fila vai pelo
  // beacon), sem esperar a renovacao do token nem tentar voltar. Fora do efeito, no proximo passo.
  const hangUpRoom = room.hangUp;
  const lostInside = screen === "unavailable" && entryInRoom(room.entry);
  useEffect(() => {
    if (!lostInside) {
      return;
    }
    const id = window.setTimeout(() => hangUpRoom(), 0);
    return () => window.clearTimeout(id);
  }, [hangUpRoom, lostInside]);

  /** Uma escrita da sala foi recusada (409 banned / muted / ended de qualquer rota). */
  const onWriteRefused = useCallback(
    (error: unknown) => {
      const refusal = writeRefusalOf(error);
      if (!refusal) {
        return;
      }
      setLocal((previous) => {
        const barred = refusal !== "ended";
        const base = barred && !localBanStillValid({ refusedAtMs: previous.refusedAtMs, serverTimeIso: sessionTimeRef.current, skewMs: skewRef.current ?? 0 }) ? { ...previous, ...NO_LOCAL_BAN } : previous;
        return {
          ...base,
          banned: base.banned || refusal === "banned",
          ended: base.ended || refusal === "ended",
          kicked: base.kicked || refusal === "kicked",
          muted: base.muted || refusal === "muted",
          refusedAtMs: barred ? Date.now() : base.refusedAtMs
        };
      });
      void refreshSession();
    },
    [refreshSession, skewRef]
  );

  // O relogio da sala, a cada segundo (o tempo no ar, a contagem, o fim do silencio).
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // Antes de abrir (ou com a sala trancada para quem ainda nao entrou), a sessao e relida a cada 15 s: o botao aparece
  // sozinho quando a equipe abre a sala; no ar, os 60 s do relogio bastam.
  const waitingForRoom = !readOnly && (screen === "waiting" || screen === "locked");
  useEffect(() => {
    if (!waitingForRoom) {
      return;
    }
    const id = window.setInterval(() => void refreshSession(), LIVE_ROOM_RULES.waitingRefreshMs);
    return () => window.clearInterval(id);
  }, [refreshSession, waitingForRoom]);

  // Com a sala no ar, nenhum pop-up abre (docs/30 §1.5; docs/25 §1): a mesma trava do player da aula.
  useEffect(() => {
    announceLiveRoomMedia({ lessonId, on: true });
    return () => announceLiveRoomMedia({ lessonId, on: false });
  }, [lessonId]);

  useEffect(() => {
    const onChange = () => setFullscreenOn(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // O offset do chat da live e do servidor: o zero da sessao (a ancora, ou o inicio) pela ultima leitura.
  const zeroMs = useMemo(() => {
    const offset = session.session.offsetMs;
    const serverNow = Date.parse(session.serverTime);
    if (typeof offset === "number" && Number.isFinite(serverNow)) {
      return serverNow - offset;
    }
    return Date.parse(session.session.startedAt ?? session.session.scheduledAt);
  }, [session.serverTime, session.session.offsetMs, session.session.scheduledAt, session.session.startedAt]);

  const getOffsetMs = useCallback(() => Date.now() + (skewRef.current ?? 0) - zeroMs, [skewRef, zeroMs]);

  const chat = useRoomChat({ enabled: !readOnly && !blocked, getPlayerOffsetMs: getOffsetMs, initialServerTime: payload.serverTime, sessionId, webinarId });
  // Fase 4f: o chat no idioma do aluno (Perfil > Privacidade); sem idioma, desligado ou no "ver como", passa como veio.
  const translation = useRoomTranslation({ enabled: !readOnly && !blocked, messages: chat.messages, sessionId, webinarId });
  const reactions = useRoomReactions({ enabled: !readOnly && writable && !blocked, getOffsetMs, onRefused: onWriteRefused, reducedMotion, sessionId, webinarId });
  // O Assistente lido uma vez pela sala: o selo do palco, o chat e as Perguntas usam o mesmo estado.
  const assistant = useRoomAssistant({ enabled: !readOnly && !blocked, sessionId, webinarId });
  // As enquetes da sala (a releitura da sessao e, com uma aberta, a leitura de 15 s): o palco, o card do chat e a aba.
  const roomPolls = useRoomPolls({ enabled: !readOnly && !blocked, getOffsetMs, onRefused: onWriteRefused, sessionId, sessionPolls: session.polls, webinarId });
  const polls = roomPolls.polls;
  const [deferred, setDeferred] = useDeferredPolls(sessionId);
  /**
   * O pedido de foco na enquete do palco (Responder agora, o atalho E): a enquete para responder (a mesma chave do palco)
   * e um contador que muda a cada pedido. O resultado da mesma enquete, depois, abre sem pegar o foco.
   */
  const [pollFocus, setPollFocus] = useState<{ key: string; n: number } | null>(null);

  useRoomHeartbeat({
    enabled: !readOnly && writable && !blocked,
    getOffsetSeconds: () => Math.floor(getOffsetMs() / 1000),
    getState: () => (joined ? "playing" : "paused"),
    onAccessLost: () => setLocal((previous) => (previous.unavailable ? previous : { ...previous, unavailable: true })),
    onAnswer: (answer) => {
      setHeartbeatPresent(answer.presentNow);
      if (answer.ended) {
        setLocal((previous) => (previous.ended ? previous : { ...previous, ended: true }));
      }
    },
    sessionId,
    webinarId
  });

  const presentNow = heartbeatPresent ?? session.presentNow;
  const openPolls = polls.filter((poll) => poll.status === "open");
  const tabs = panelTabsFor({ kind: "live", openPolls: openPolls.length, tab });
  // A enquete no meio do palco so com a sala de pe (como a barra e os selos); o card do chat, a deixada para depois.
  const stagePoll = barShown ? stagePollFor({ deferredIds: deferred.later, polls, seenResultIds: deferred.seen }) : null;
  const stagePollKey = stagePoll ? `${stagePoll.mode}:${stagePoll.poll.id}` : null;
  const laterPoll = barShown ? deferredPollCard({ deferredIds: deferred.later, polls }) : null;
  // O contador do balao: as mensagens novas desde que o painel fechou. Na live so os ids contam (o zero do offset anda
  // quando a live comeca atrasada e com a ancora da gravacao: panelUnreadMark).
  const unread = useRoomPanelUnread({ chatLoaded: chat.loaded, kind: "live", messages: translation.messages, offsetMs: nowMs + skewMs - zeroMs, panelShown });
  const firstFocus = firstFocusTarget({ panelShown });
  const replayHref = session.webinar.replaySessionId ? roomHref(session.webinar.slug, session.webinar.replaySessionId) : null;
  const scheduledMs = Date.parse(session.session.scheduledAt);
  const countdown = screen === "waiting" ? formatCountdown(scheduledMs, nowMs + skewMs) : "";
  const composerNotice = liveComposerNotice({ ban, nowMs, status });
  const recording = isRecording(room.signals, live);
  // O aviso passageiro; sem ele, o toque em Microfone / Câmera que espera a troca daquele aparelho (o que vai acontecer).
  const notice = liveNoticePhrase(room.signals.notice === "mic_released" ? null : room.signals.notice) ?? pendingTogglePhrase(room.pendingToggle, room.signals);
  const stage = stageNames(room.signals.participants, presenterName);
  const startedAt = live.startedAt ?? session.session.startedAt;
  // "{n} assistindo" some com a live encerrada (no cabecalho do computador e na linha do celular).
  const presentShown = phase === "ended" ? null : presentNow;
  const dateLine = roomDateLine({ durationMinutes: session.webinar.durationMinutes, kind: "live", presenterName, scheduledAt: session.session.scheduledAt }).join(" · ");
  const mobileLine = roomMobileLine({ presenterName, presentNow: presentShown }).join(" · ");
  // A coluna de miniaturas do iframe a direita do video, quando o motor a mostra (o Palco, com a coluna na tela pela
  // largura do iframe, V2-A5): os selos de baixo e as pilulas param antes dela. Fora do iframe, nenhuma coluna.
  const videoRightPx = stageVideoRightPx({ columnShown: stageColumnShown(room.signals), touch: geometry.touch });
  // O selo de cima a esquerda do palco: no ar, o tempo; na espera com a sala aberta, "Aguardando o apresentador".
  const stageMoment = liveStageMoment({ phase, screen });

  /** O tema da sala: o botao do cabecalho (a partir de sm) e a linha Tema do painel Configurações (abaixo de sm). */
  function toggleTheme() {
    setTheme(theme === "light" ? "dark" : "light");
  }

  function leave() {
    room.hangUp();
    router.push(webinarHref);
  }

  /** Sair e Esc: com a live no ar (ou dentro do iframe), pergunta antes (docs/30 §1.7). */
  function askToLeave() {
    if ((phase === "live" || joined) && !blocked) {
      setConfirmLeave(true);
      return;
    }
    leave();
  }

  useRoomDialogLock(rootRef, true);

  // O painel do chat fechou com o foco nele (o X, a escolha guardada lida depois da primeira pintura): o foco vai ao
  // balao da barra, nunca fica no body.
  const panelShownRef = useRef(panelShown);
  useLayoutEffect(() => {
    const was = panelShownRef.current;
    panelShownRef.current = panelShown;
    if (was && !panelShown) {
      returnFocusFromPanel(rootRef.current, document.activeElement, document.getElementById(ROOM_PANEL_ID));
    }
  }, [panelShown]);

  // A enquete saiu do palco (ou trocou por outra) com o foco nela: o foco vai ao Responder agora, ao balao ou a sala.
  const stagePollKeyRef = useRef(stagePollKey);
  useLayoutEffect(() => {
    const was = stagePollKeyRef.current;
    stagePollKeyRef.current = stagePollKey;
    if (was !== null && was !== stagePollKey) {
      returnFocusFromPoll(rootRef.current, document.activeElement);
    }
  }, [stagePollKey]);

  function openPollsTab() {
    if (openPolls.length > 0) {
      setTab("enquetes");
      setPanelOpen(true);
      if (settingsTakeover) {
        closeSettings();
      }
    }
  }

  /** "Responder agora" (o card do chat) e o atalho E: a enquete volta ao palco e o foco vai para a primeira opcao. */
  function answerPollNow(pollId: string) {
    setDeferred(resumePoll(deferred, pollId));
    setPollFocus((previous) => ({ key: `answer:${pollId}`, n: (previous?.n ?? 0) + 1 }));
  }

  /** O atalho E: a enquete aberta sem resposta no palco; ja respondida, a aba Enquetes, como antes. */
  function openStagePoll() {
    const poll = pollToReopen(polls);
    if (poll) {
      answerPollNow(poll.id);
    } else {
      openPollsTab();
    }
  }


  /** O balao da barra: abre e fecha o painel do chat; no celular com Configurações aberto, fecha ele e mostra o chat. */
  function togglePanel() {
    const step = panelToggleStep({ panelShown, settingsTakeover });
    if (step.closeSettings) {
      closeSettings();
    }
    setPanelOpen(step.panelOpen);
  }

  /** O botao da barra que abre o painel (Reagir ou Configurações). */
  function panelButton(panelId: string) {
    return rootRef.current?.querySelector<HTMLButtonElement>(`[aria-controls="${panelId}"]`) ?? null;
  }

  /** O foco que estava dentro do painel volta ao botao da barra que o abre, antes de ele fechar (senao cai no body). */
  function returnFocusFrom(panelId: string) {
    const panel = document.getElementById(panelId);
    if (panel && panel.contains(document.activeElement)) {
      panelButton(panelId)?.focus();
    }
  }

  /** Fecha o painel Configurações; pelo Fechar de dentro dele, o foco vai sempre ao botao (o WebKit nao foca no clique). */
  function closeSettings(focusButton = false) {
    if (focusButton) {
      panelButton(LIVE_SETTINGS_ID)?.focus();
    } else {
      returnFocusFrom(LIVE_SETTINGS_ID);
    }
    setSettingsOpen(false);
  }

  /** Fecha o menu da Visão do vídeo; o foco que estava nele volta ao botao dele antes de ele sumir. */
  function closeViewMenu() {
    returnFocusFrom(ROOM_VIEW_MENU_ID);
    setViewMenuOpen(false);
  }

  /**
   * Reagir, Configurações e o menu da Visão do vídeo nunca abertos juntos: no celular, empilhados, empurrariam a barra
   * para fora da tela; no computador os tres abrem por cima do palco, e o painel cobriria o menu.
   */
  function toggleReactions() {
    if (!reactionsOpen) {
      if (settingsOpen) {
        closeSettings();
      }
      // O atalho R com o foco no menu tambem: o foco vai ao botao do menu, nunca fica na opcao escondida.
      closeViewMenu();
    }
    setReactionsOpen(!reactionsOpen);
  }

  function toggleSettings() {
    if (settingsOpen) {
      // Fechar pelo proprio botao: o foco vai ao botao antes de o painel sumir (no WebKit o clique nao foca o botao, e o
      // foco ficaria no controle do painel que some, caindo no body).
      closeSettings(true);
      return;
    }
    if (reactionsOpen) {
      returnFocusFrom(LIVE_REACTIONS_ID);
      setReactionsOpen(false);
    }
    closeViewMenu();
    setSettingsOpen(true);
  }

  /** O botao da Visão do vídeo (e as setas nele) abre o menu e fecha Reagir e Configurações; o resto o fecha. */
  function setViewMenu(open: boolean) {
    if (open) {
      if (reactionsOpen) {
        returnFocusFrom(LIVE_REACTIONS_ID);
        setReactionsOpen(false);
      }
      if (settingsOpen) {
        closeSettings();
      }
    }
    setViewMenuOpen(open);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (confirmLeave) {
        setConfirmLeave(false);
      } else if (reactionsShown || settingsShown || viewMenuShown) {
        // O foco dentro do painel volta ao botao (sem isso ele cairia no body e a sala deixaria de ouvir o teclado).
        returnFocusFrom(LIVE_REACTIONS_ID);
        setReactionsOpen(false);
        closeSettings();
        closeViewMenu();
      } else {
        askToLeave();
      }
      return;
    }
    if (event.key === "Tab") {
      trapRoomFocus(event, rootRef.current);
      return;
    }
    const target = event.target as HTMLElement | null;
    const shortcut = liveShortcutOf({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      editable: Boolean(target?.isContentEditable),
      key: event.key,
      metaKey: event.metaKey,
      tagName: target?.tagName ?? null
    });
    if (!shortcut || blocked) {
      return;
    }
    event.preventDefault();
    if (shortcut === "react") {
      toggleReactions();
    } else if (shortcut === "hand" && ourBar && joined) {
      room.toggleHand();
    } else if (shortcut === "poll") {
      openStagePoll();
    }
  }

  function onCamera() {
    const action = cameraClick({ allowStudentCamera: room.reply?.settings.allowStudentCamera ?? false, consented: cameraConsented, videoOn: room.signals.videoOn });
    if (action === "blocked") {
      room.showNotice("camera_blocked");
    } else if (action === "ask") {
      // O PRIMEIRO ligar passa pelo aviso de gravacao e de consumo (docs/30 §8.5); so Ligar câmera chega ao iframe.
      setCameraAsk(true);
    } else {
      room.toggleCamera(false);
    }
  }

  /** Uma escolha do painel: a secao tem de estar pronta agora (o aluno nunca troca antes do consentimento). */
  function chooseDevice(kind: DeviceKind, option: DeviceOption) {
    if (deviceSectionReady(deviceSettings, kind)) {
      room.devices.escolher(kind, option);
    }
  }

  function confirmCamera() {
    setCameraAsk(false);
    setCameraConsented(true);
    room.toggleCamera(true);
  }

  function toggleFullscreen() {
    if (cinemaPreferred) {
      setCinemaOn((on) => !on);
      return;
    }
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    const element = stageRef.current;
    if (element?.requestFullscreen) {
      void element.requestFullscreen().catch(() => setCinemaOn(true));
    } else {
      setCinemaOn(true);
    }
  }

  // O palco cresce com o painel do chat fechado, no Modo cinema (o chat fica embaixo, menor) e na frase de removido /
  // banido; no celular com o painel Configurações aberto (o chat escondido), a caixa do palco divide a coluna com o
  // painel e fica com no minimo 96 px: o painel rola por dentro e a barra continua na tela (liveSkeletonState).
  const skeletonState = liveSkeletonState({ blocked, cinema: cinemaOn, panelShown, settingsTakeover });
  const skeleton = roomSkeleton("normal", skeletonState);

  return (
    <div
      aria-label={session.webinar.title}
      aria-modal="true"
      className={skeleton.root}
      data-room-kind="live"
      data-room-phase={phase}
      data-room-screen={screen}
      data-room-theme={theme}
      onKeyDown={handleKeyDown}
      ref={rootRef}
      role="dialog"
    >
      <RoomHeader
        dateLine={dateLine}
        leaveInBar={barShown}
        mobileLine={mobileLine}
        onLeave={askToLeave}
        onToggleTheme={toggleTheme}
        presentNow={presentShown}
        theme={theme}
        title={session.webinar.title}
      />

      {confirmLeave ? (
        <div aria-label={copy.sairConfirmar} className={skeleton.confirm} role="alertdialog">
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
          <div className={skeleton.stageBox} data-room-slot="stage-box">
            <LiveStage
              className={cn("w-full lg:aspect-auto lg:min-h-0 lg:flex-1", skeletonState.stageGrows ? "min-h-0 flex-1" : "aspect-video")}
              countdownLabel={countdown ? copy.comecaEm(countdown) : ""}
              coverUrl={coverUrl}
              entry={room.entry}
              frameRef={frameRef}
              lobby={live.lobby === true}
              onEnter={room.enter}
              onRetry={room.retryNow}
              readOnly={readOnly}
              replayHref={replayHref}
              screen={screen}
              sessionId={sessionId}
              stageRef={stageRef}
              title={session.webinar.title}
              videoRightPx={videoRightPx}
            >
              {/* Os selos ficam com a sala de pe, como a barra: a live encerrada, removido ou banido os tiram. */}
              {barShown ? (
                <RoomStageBadges
                  assistantOn={phase === "live" && assistant.state.enabled}
                  presenterName={phase === "live" ? presenterName : null}
                  recording={recording}
                  topLeft={stageMoment === "on_air" ? { kind: "on_air", label: liveOnAirLabel(startedAt, nowMs, skewMs), short: liveElapsedLabel(startedAt, nowMs, skewMs) } : stageMoment === "waiting" ? { kind: "waiting" } : null}
                />
              ) : null}
              <RoomReactionBubbles bubbles={reactions.bubbles} overflow={reactions.overflow} />
              {/* Com o painel fechado, as 2 ultimas mensagens em pilulas sobre o palco (V2-8). */}
              {chatPillsShown({ blocked, design: "normal", offerShown: false, panelShown, settingsTakeover }) ? <RoomChatPills kind="live" messages={overlayMessages(translation.messages)} /> : null}
              {/* No celular a Tela cheia (ou o Modo cinema) fica no canto do palco; a partir de lg, na barra. */}
              {barShown ? <LiveStageFullscreen cinemaMode={cinemaPreferred} cinemaOn={cinemaOn} fullscreenOn={fullscreenOn} onFullscreen={toggleFullscreen} /> : null}
              {/* A enquete no meio do palco (V2-10), por cima do video, das capas e das pilulas. */}
              {blocked ? null : (
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
                  readOnly={readOnly || !writable}
                  stage={stagePoll}
                />
              )}
            </LiveStage>
          </div>
          {!barShown ? null : (
            <LiveControls
              allowStudentCamera={room.reply ? room.reply.settings.allowStudentCamera : null}
              audioOn={room.signals.audioOn}
              cameraWaiting={room.pendingToggle.videoInput}
              cinemaMode={cinemaPreferred}
              cinemaOn={cinemaOn}
              fullscreenOn={fullscreenOn}
              handRaised={room.signals.handRaised}
              joined={joined}
              micAllowed={room.signals.micAllowed}
              micWaiting={room.pendingToggle.audioInput}
              notice={notice}
              onCamera={onCamera}
              onFullscreen={toggleFullscreen}
              onHand={room.toggleHand}
              onLeave={askToLeave}
              onMic={room.toggleMic}
              onReact={reactions.react}
              onSound={room.toggleSound}
              onTogglePanel={togglePanel}
              onToggleReactions={toggleReactions}
              onToggleSettings={toggleSettings}
              onView={room.setView}
              onViewMenu={setViewMenu}
              panelFirstFocus={firstFocus === "panel-toggle"}
              panelOpen={panelShown}
              panelUnread={unread}
              reactionsDisabled={readOnly || !writable}
              reactionsOpen={reactionsShown}
              settings={
                <LiveSettings
                  cameraOn={room.signals.videoOn}
                  devices={room.devices}
                  onChoose={chooseDevice}
                  onClose={() => closeSettings(true)}
                  onToggleTheme={toggleTheme}
                  sections={deviceSettings}
                  showMedia={ourBar}
                  theme={theme}
                />
              }
              settingsOpen={settingsShown}
              showMedia={ourBar}
              soundOn={room.soundOn}
              videoOn={room.signals.videoOn}
              viewMenuOpen={viewMenuShown}
              viewShown={room.viewShown}
            />
          )}
        </div>

        {blocked ? null : (
          // Fechado, o painel fica montado e escondido (o rascunho, o aceite e a aba continuam).
          <RoomPanel
            className={skeleton.panel}
            closable={barShown}
            contentClassName={cn("lg:max-h-none", cinemaOn ? "max-h-[38vh] min-h-[10rem]" : undefined)}
            firstFocus={firstFocus === "tab"}
            id={ROOM_PANEL_ID}
            kind="live"
            onClose={() => setPanelOpen(false)}
            onTab={setTab}
            open={panelShown}
            pollOpen={openPolls.length > 0}
            tab={tab}
            tabs={tabs}
          >
            {tab === "chat" ? (
              <>
                {laterPoll ? <RoomPollLaterCard onResume={() => answerPollNow(laterPoll.id)} poll={laterPoll} /> : null}
                <RoomTranslationBar state={translation} />
                <RoomChatPanel
                  assistant={assistant}
                  chatMode={session.session.chatMode}
                  consented={session.me.consented}
                  defaultDisplayMode={session.me.displayMode ?? "first_name_initial"}
                  displayName={session.me.displayName}
                  error={chat.error}
                  messages={translation.messages}
                  notice={readOnly ? null : composerNotice}
                  nowMs={nowMs}
                  onRemoveMine={chat.removeMine}
                  onSend={async (body) => {
                    try {
                      const answer = await chat.send(body);
                      if (!session.me.consented) {
                        void refreshSession();
                      }
                      return answer;
                    } catch (error) {
                      onWriteRefused(error);
                      throw error;
                    }
                  }}
                  phase={phase}
                  pinned={session.pinned}
                  readOnly={readOnly}
                  sessionId={sessionId}
                  slowUntilMs={chat.slowUntilMs}
                  timeKind="live"
                  webinarId={webinarId}
                />
              </>
            ) : null}
            {tab === "perguntas" ? (
              <RoomQuestionsTab
                allowAnonymous={session.session.anonymousQuestions}
                assistant={assistant}
                consented={session.me.consented}
                defaultDisplayMode={session.me.displayMode ?? "first_name_initial"}
                enabled={!readOnly}
                getOffsetMs={getOffsetMs}
                notice={readOnly ? null : composerNotice}
                onConsented={() => void refreshSession()}
                onRefused={onWriteRefused}
                readOnly={readOnly || phase === "ended"}
                sessionId={sessionId}
                webinarId={webinarId}
              />
            ) : null}
            {tab === "participantes" ? <LiveParticipantsTab stage={stage} students={presentShown} /> : null}
            {tab === "enquetes" ? (
              <RoomPollsTab onAnswer={roomPolls.answer} polls={polls} readOnly={readOnly || !writable} />
            ) : null}
          </RoomPanel>
        )}
      </div>

      {cameraAsk ? <LiveCameraDialog onCancel={() => setCameraAsk(false)} onConfirm={confirmCamera} /> : null}
      {room.signals.micPrompt && !blocked ? <LiveMicDialog onCancel={room.declineMic} onConfirm={room.acceptMic} /> : null}
    </div>
  );
}
