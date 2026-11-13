"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { deviceEnvironmentOf, deviceSectionReady, deviceSettingsFor, type DeviceKind, type DeviceOption, type DeviceSettings } from "@/lib/jitsi-device-settings";
import type { LiveEmbedLook } from "@/lib/jitsi-room-config";
import { announceLiveRoomMedia } from "@/lib/lesson-media-signal";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { roomMediaLessonId } from "@/lib/webinar-room-client";
import { formatCountdown } from "@/lib/webinar-time";
import type { LiveRoomInfo } from "@/server/webinars/live-model";
import { audienceTilesNow } from "@/server/webinars/audience-tiles-model";
import { simulationClockMs } from "@/server/webinars/simulation-model";
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
  liveOnAirLabel,
  livePhaseOf,
  liveRoomScreen,
  liveShortcutOf,
  localBanStillValid,
  mergeBan,
  micBlocked,
  micClick,
  micFocusLost,
  overlayMessages,
  pendingTogglePhrase,
  pendingToggleSnack,
  prefersCinemaMode,
  presenterBadgeFor,
  screenBlocksRoom,
  stageColumnShown,
  stageRowShown,
  stageNames,
  usesOurBar,
  viewMenuFocusLost,
  writeRefusalOf,
  type LiveJoinFailure
} from "./live-room-model";
import { LiveSettings } from "./live-settings";
import { LiveStage } from "./live-stage";
import { ROOM_PANEL_ID } from "./room-bar";
import { RoomEndedDialog, endedDialogOpens } from "./room-ended-dialog";
import { RoomLeaveDialog } from "./room-leave-dialog";
import { RoomChatMoreButton, RoomChatPanel } from "./room-chat";
import { RoomChatPills } from "./room-chat-pills";
import { RoomHeader } from "./room-header";
import {
  chatPillsShown,
  firstFocusTarget,
  liveSkeletonState,
  liveStageMoment,
  panelTabsFor,
  panelToggleStep,
  PINNED_SNACK_ACTION,
  pinnedNoticeShown,
  pinnedPillsShown,
  pinnedPollFor,
  pinnedPollTapStep,
  pinnedShownIn,
  pinnedSnack,
  railStep,
  roomEscapeStep,
  roomDateLine,
  roomMobileLine,
  roomPresentBadge,
  roomPanelShown,
  stageVideoBottomPx,
  stageVideoRightPx,
  unpinnedPolls,
  type RoomPanelTab
} from "./room-layout-model";
import { RoomPanel, useRoomPanelUnread } from "./room-panel";
import { RoomPollLaterCard, RoomPollLayer } from "./room-poll-layer";
import { deferPoll, deferredPollCard, markPollResultSeen, pollToReopen, resultsOnArrival, resumePoll, stagePollFor } from "./room-poll-model";
import { RoomPollsTab } from "./room-polls";
import { RoomQuestionsOrderButton, RoomQuestionsTab } from "./room-questions";
import type { QuestionsFilter, QuestionsOrder } from "./room-questions-model";
import { RoomRail } from "./room-rail";
import { QUESTION_NEWS_SNACK_ACTION } from "./room-question-news-model";
import { useRoomQuestionNews } from "./use-room-question-news";
import { RoomReactionBubbles } from "./room-reactions";
import { RoomSimulationJoins, RoomSimulationSales } from "./room-simulation";
import { RoomSnackbarHost, RoomSnackbarProvider, useRoomSnackbarController } from "./room-snackbar";
import { shouldAnnounceRecording, SNACK_SETTINGS_ACTION, snackToRestore } from "./room-snackbar-model";
import { RoomStageBadges } from "./room-stage-badges";
import { ROOM_VIEW_MENU_ID } from "./room-view-menu";
import { useRoomChat, useRoomClock, useRoomHeartbeat, useRoomReactions } from "./use-room-data";
import { useRoomTranslation } from "./use-room-translation";
import { entryInRoom, useLiveRoom } from "./use-live-room";
import { useRoomPolls } from "./use-room-polls";
import { RoomPinnedArea, RoomPinnedPills, usePinnedFocus, type PinnedFocusTarget } from "./screen/room-pinned";
import type { ScreenItemHandlers } from "./screen/room-screen-card";
import { RoomScreenCommentAnnouncer, RoomScreenCommentLayer } from "./screen/room-screen-comment";
import { RoomScreenAnnouncer, RoomScreenLayer } from "./screen/room-screen-layer";
import { screenFocusKey, screenPlacement, screenStripForcedLive } from "./screen/room-screen-model";
import { RoomScreenStrip } from "./screen/room-screen-strip";
import { RoomWideHidden } from "./screen/room-wide-hidden";
import { useRoomScreen, useRoomScreenEvents } from "./screen/use-room-screen";
import { useAudienceTiles, useRoomAudience } from "./use-room-audience";
import { useRoomSimulation } from "./use-room-simulation";
import { useDeferredPolls, useRoomHydrated, useRoomPanelOpen, useRoomTheme, useRoomThumbs } from "./use-room-prefs";
import { usePanelMotion } from "./use-panel-motion";
import { useStageGeometry } from "./use-stage-geometry";
import { screenCommentPlace } from "@/server/webinars/screen-comment-model";
import { leaveStageFullscreen, refocusRoom, returnFocusFromPanel, returnFocusFromPoll, roomFocusTarget, trapRoomFocus, useRoomConfirmFocus, useRoomDialogLock, useRoomReducedMotion } from "./webinar-room";
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
// A correcao final da fase 1: abaixo de lg deitado a sala fica em linha (roomSkeleton); o selo do apresentador so com
// alguem da equipe no video grande (presenterBadgeFor); a enquete e o card do chat so depois da hidratacao, sem os
// resultados que ja vinham na pagina; o Esc fecha a camada de cima primeiro (roomEscapeStep); a confirmacao de Sair
// leva o foco ao Voltar e o devolve a quem a abriu (useRoomConfirmFocus); o Microfone fica enquanto o som esta no ar.
// A sala no estilo do YouTube (docs/31): a partir de lg, o trilho a direita (room-rail.tsx) no lugar do balao e das
// abas, irmao do painel e fora da frase de removido ou banido; o item abre o painel naquela aba e, aberto, fecha (railStep). O painel
// vira o cartao do YouTube com o cabecalho (o nome da aba, o numero e o X); o contador do Chat do trilho conta enquanto
// o Chat nao esta na tela (chatShown), e o X devolve o foco ao item da aba que estava aberta.
// A Na tela, as fixadas (especificacao de 10/11/2026, §3.1; screen/room-pinned.tsx): a mensagem e a enquete fixadas
// saem da aba Chat e viram a area das fixadas do painel, em todas as abas (o `pinned` do RoomPanel); a enquete fixada
// nao se repete na aba Enquetes nem vira o card "deixou para depois" (o Responder depois dela manda para a area). Com o
// painel fechado, as pilulas no palco de 640 px ou mais e as linhas abaixo do palco mais estreito (pinnedPillsShown): a
// da mensagem abre o painel no Chat, a da enquete a traz ao palco se falta responder e ela e a que o palco mostra
// (pinnedPollTapStep), e o foco vai para o bloco da area (usePinnedFocus); na Tela cheia de verdade, a tela cheia sai
// antes (o painel fica fora do palco). A fixada nova com o painel fechado mostra o aviso "A equipe fixou uma mensagem."
// com Ver (pinnedNoticeShown). Nada disso com a live encerrada nem para quem foi removido ou banido (pinnedShownIn).
// A Na tela, o banner e o QR Code (especificacao de 10/11/2026, §3.2 a §3.7; screen/room-screen-layer.tsx e
// room-screen-strip.tsx): no palco de 640 px ou mais, os cartoes na camada do palco (dentro do LiveStage, que e o que vai
// para a Tela cheia), na posicao e no tamanho escolhidos, com as pilulas das fixadas primeiro na celula de cima a
// esquerda; no palco mais estreito, no baixo (a tela de ate 500 px de altura) e com qualquer capa no palco
// (screenStripForcedLive: antes de Entrar na sala, Abrindo a sala…, Reconectando…, a espera), a faixa abaixo do palco e
// acima da barra, junto com as linhas das fixadas; na tela cheia de verdade com o palco estreito ou baixo, a linha
// compacta na borda de cima. Um item na fileira de baixo ou na do meio tira as pilulas do chat do palco largo, e um em
// "Embaixo, à direita" o selo do Assistente (RoomWideHidden, so CSS). Fechar e por exibicao (sessionStorage); quem tem o foco num item que sai volta para a sala (refocusRoom). As
// metricas (viu, clicou, fechou) vao por useRoomScreenEvents; nada no "ver como". Com quem apresenta usando a barra do
// motor nesta pagina, a margem de baixo da camada e 96 px.

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
  return payload.live ?? { lobby: false, locked: false, meetConfigured: false, practice: false, recording: false, selfUnmute: false, startedAt: payload.session.startedAt, status: payload.session.status };
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
  // As Perguntas no estilo do YouTube: o filtro e a ordem sao da sala (trocar de aba nao os perde) e o numero do
  // cabecalho e o tamanho da lista com o filtro de agora, nulo ate a primeira leitura.
  const [questionsFilter, setQuestionsFilter] = useState<QuestionsFilter>("all");
  const [questionsOrder, setQuestionsOrder] = useState<QuestionsOrder>("votadas");
  const [questionsCount, setQuestionsCount] = useState<number | null>(null);
  // O ⋮ do cabecalho do Chat abre a confirmacao de remover as minhas mensagens, que fica no chat.
  const [removeOpen, setRemoveOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useRoomPanelOpen();
  const [confirmLeave, setConfirmLeave] = useState(false);
  // A live acabou com o aluno na sala (docs/30 D104): a janela da area avisa (o dialogo do motor continua desligado).
  const [endedNotice, setEndedNotice] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // O menu da Visão do vídeo (docs/31 V2-16): aberto pela sala, para nunca ficar junto com Reagir ou Configurações.
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [cameraAsk, setCameraAsk] = useState(false);
  const [cameraConsented, setCameraConsented] = useState(false);
  // O microfone sozinho (docs/31 caminho A): o primeiro abrir passa pelo aviso de gravacao; o aceite fica na pagina.
  const [micAsk, setMicAsk] = useState(false);
  const [micConsented, setMicConsented] = useState(false);
  const [fullscreenOn, setFullscreenOn] = useState(false);
  const [cinemaOn, setCinemaOn] = useState(false);
  const [local, setLocal] = useState<LocalState>(NO_LOCAL);
  const [heartbeatPresent, setHeartbeatPresent] = useState<number | null>(null);
  /** O ultimo sinal de 15 s disse que a equipe escondeu o numero de pessoas (nulo antes dele): vale sobre a sessao. */
  const [heartbeatHidden, setHeartbeatHidden] = useState<boolean | null>(null);
  const reducedMotion = useRoomReducedMotion();
  const cinemaPreferred = useSyncExternalStore(subscribeNothing, readCinemaPreferred, () => false);
  const isIOS = useSyncExternalStore(subscribeNothing, readIOS, () => false);
  const isMobile = useSyncExternalStore(subscribeNothing, readMobile, () => false);
  // A largura do iframe (a coluna de miniaturas, V2-A5) e o toque (o puxador da coluna mais largo).
  const geometry = useStageGeometry(frameRef);
  const desktop = useSyncExternalStore(subscribeDesktop, readDesktop, () => false);
  const [theme, setTheme] = useRoomTheme();
  // Onde a pessoa quer as miniaturas (rodada v9, docs/30 D91): Lateral ou Esconder (o Embaixo saiu na rodada v12, D105),
  // guardado no navegador. As duas valem por comando, sem recarregar o video.
  const [thumbs, setThumbs] = useRoomThumbs();
  // O tema que o iframe recebe na proxima montagem (o guardado ja vale no primeiro Entrar na sala), sempre no Palco com
  // a coluna.
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
  // A fase mudou de "no ar" para "encerrada" com a pagina aberta: a janela abre (a decisao na renderizacao, sem efeito).
  const [phaseSeen, setPhaseSeen] = useState(phase);
  if (phaseSeen !== phase) {
    setPhaseSeen(phase);
    if (endedDialogOpens(phaseSeen, phase)) {
      setEndedNotice(true);
    }
  }
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
    onAudioModerationChanged: refreshSession,
    onCameraConsentEnded,
    onRefused,
    sessionId,
    thumbs,
    settingsOpen,
    webinarId
  });
  // O aviso da sala (RoomSnackbar): o aviso da barra que sai da tela e solto no hook, para poder voltar.
  const snackbar = useRoomSnackbarController({ onGone: room.clearNotice });
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
  // O painel do chat: o balao da barra (abaixo de lg) e o trilho (a partir de lg) abrem e fecham; sem a barra ele fica
  // na tela.
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
  // do DOM e o foco cai no body; a sala o manda de volta para dentro dela, como quando a barra inteira some. Com o
  // microfone ainda ligado ele fica (o recolhimento sem o mudo: o aluno sempre tem como se calar), como em liveBarItems.
  const micShown = barShown && ourBar && (room.signals.micAllowed || room.signals.audioOn || live.selfUnmute === true);
  // Ainda fechado (a moderacao de audio ligada, ou ainda nao lida; sem teto desde 11/11/2026, D84): o Microfone fica,
  // desligado com o motivo.
  const micInput = {
    audioModeration: room.signals.audioModeration,
    audioOn: room.signals.audioOn,
    consented: micConsented,
    micAllowed: room.signals.micAllowed,
    selfUnmute: live.selfUnmute === true
  };
  const micFull = micBlocked(micInput);
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

  // A Na tela (docs/30 §5.1): a fixada e o que mais a equipe poe na frente da turma, pela leitura da sessao e pela
  // consulta de 5 s do chat (com o carimbo).
  const naTela = useRoomScreen({ sessionId, sessionPinned: session.pinned, sessionScreen: session.screen });
  const chat = useRoomChat({
    enabled: !readOnly && !blocked,
    getPlayerOffsetMs: getOffsetMs,
    getScreenStamp: naTela.getStamp,
    initialServerTime: payload.serverTime,
    onScreen: naTela.onChatScreen,
    sessionId,
    webinarId
  });
  // Fase 4f: o chat no idioma do aluno (Perfil > Privacidade); sem idioma, desligado ou no "ver como", passa como veio.
  const translation = useRoomTranslation({ enabled: !readOnly && !blocked, messages: chat.messages, sessionId, webinarId });
  const reactions = useRoomReactions({ enabled: !readOnly && writable && !blocked, getOffsetMs, onRefused: onWriteRefused, reducedMotion, sessionId, webinarId });
  // O Assistente lido uma vez pela sala: o selo do palco, o chat e as Perguntas usam o mesmo estado.
  const assistant = useRoomAssistant({ enabled: !readOnly && !blocked, sessionId, webinarId });
  // As enquetes da sala (a releitura da sessao e, quando o resumo da Na tela muda, uma leitura): o palco, o card do chat e a aba.
  const roomPolls = useRoomPolls({ enabled: !readOnly && !blocked, getOffsetMs, onRefused: onWriteRefused, pollsKey: naTela.pollsKey, sessionId, sessionPolls: session.polls, webinarId });
  const polls = roomPolls.polls;
  const [deferred, setDeferred] = useDeferredPolls(sessionId);
  // O que depende do guardado (o "depois", os resultados vistos) so depois da hidratacao: sem isso, a enquete deixada
  // para depois piscaria no palco a cada carga. Os resultados que ja vinham na pagina nao abrem no palco.
  const hydrated = useRoomHydrated();
  const [arrivedResults] = useState(() => resultsOnArrival(payload.polls));
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
      setHeartbeatHidden(typeof answer.presentHidden === "boolean" ? answer.presentHidden : null);
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
  // As fixadas (Na tela): a mensagem e a enquete, so com a live de pe para a pessoa; a enquete fixada sai da aba Enquetes
  // e do card "deixou para depois" (ela fica na area das fixadas, em toda aba).
  const pinnedOn = pinnedShownIn({ blocked, kind: "live", phase });
  const pinnedMessage = pinnedOn ? naTela.pinned : null;
  const pinnedPoll = pinnedOn ? pinnedPollFor({ pinnedPollId: naTela.pinnedPollId, polls }) : null;
  const pollsTab = unpinnedPolls(polls, pinnedPoll?.id ?? null);
  // A enquete no meio do palco so com a sala de pe (como a barra e os selos); o card do chat, a deixada para depois.
  const stagePoll = barShown && hydrated ? stagePollFor({ deferredIds: deferred.later, polls, seenResultIds: [...deferred.seen, ...arrivedResults] }) : null;
  const stagePollKey = stagePoll ? `${stagePoll.mode}:${stagePoll.poll.id}` : null;
  const laterPoll = barShown && hydrated ? deferredPollCard({ deferredIds: deferred.later, polls: pollsTab }) : null;
  // O Chat na tela: o painel na tela e na aba Chat (com ele fechado ou noutra aba, o contador conta).
  const chatShown = panelShown && tab === "chat";
  // O contador do balao e do Chat do trilho: as mensagens novas desde que o Chat saiu da tela. Na live so os ids contam
  // (o zero do offset anda quando a live comeca atrasada e com a ancora da gravacao: panelUnreadMark).
  const unread = useRoomPanelUnread({ chatLoaded: chat.loaded, kind: "live", messages: translation.messages, offsetMs: nowMs + skewMs - zeroMs, chatShown });
  // As respostas novas nas perguntas do aluno (docs/30 D100): contam com a aba Perguntas fora da tela.
  const questionNews = useRoomQuestionNews({
    enabled: !readOnly && !blocked && phase !== "ended" && tabs.includes("perguntas"),
    sessionId,
    shown: panelShown && tab === "perguntas",
    tabMounted: tab === "perguntas",
    webinarId
  });
  const firstFocus = firstFocusTarget({ panelShown });
  const replayHref = session.webinar.replaySessionId ? roomHref(session.webinar.slug, session.webinar.replaySessionId) : null;
  const scheduledMs = Date.parse(session.session.scheduledAt);
  const countdown = screen === "waiting" ? formatCountdown(scheduledMs, nowMs + skewMs) : "";
  const composerNotice = liveComposerNotice({ ban, nowMs, status });
  const recording = isRecording(room.signals, live);
  // O aviso da barra no aviso da sala; sem ele, o toque em Microfone / Câmera que espera a troca daquele aparelho (o que
  // vai acontecer), enquanto durar.
  const pendingPhrase = pendingTogglePhrase(room.pendingToggle, room.signals);
  const roomNotice = room.notice;
  const notice = useMemo(() => roomNotice ?? pendingToggleSnack(pendingPhrase), [pendingPhrase, roomNotice]);
  const stage = stageNames(room.signals.participants, presenterName);
  const startedAt = live.startedAt ?? session.session.startedAt;
  // A Simulacao na live (adendo de 10/11/2026, R7): o contador somado ao real, as entradas e os avisos de venda, pelo
  // relogio desde o started_at (o "Começar para todos"; negativo na espera), nunca pela ancora do chat.
  const scheduledAt = session.session.scheduledAt;
  // A sala guarda a funcao num ref a cada desenho (use-room-simulation.ts): sem useCallback.
  const getSimulationOffsetMs = () => simulationClockMs({ kind: "live", scheduledAt, startedAt }, Date.now() + (skewRef.current ?? 0));
  const simulation = useRoomSimulation({ enabled: !readOnly && !blocked && phase !== "ended", getOffsetMs: getSimulationOffsetMs, sessionId, simulationKey: naTela.simulationKey, webinarId });
  const simulationOffsetMs = simulationClockMs({ kind: "live", scheduledAt, startedAt }, nowMs + skewMs);
  // Os participantes simulados nas miniaturas (docs/30 D117): a lista ordenada vem do servidor; aparecem os primeiros,
  // pelo numero de simulados deste segundo (o mesmo que soma no selo dos presentes), e quem desenha e o proprio motor.
  const audienceRoster = useRoomAudience({ enabled: !readOnly && !blocked && phase !== "ended", sessionId, simulationKey: naTela.simulationKey, webinarId });
  const simulatedNow = simulation.displayCount(0, simulationOffsetMs);
  const audienceNow = audienceTilesNow(audienceRoster, simulatedNow);
  useAudienceTiles({ joined: room.jitsiStatus === "joined", people: audienceNow, post: room.postToFrame });
  // O numero de quem assiste some com a live encerrada; no palco ele e o selo ao lado do selo do momento (docs/31 §11.5).
  // Com a Simulacao (R7), o real mais a parte simulada daquele instante, como na gravada (o selo e a aba Participantes).
  // A equipe pode esconder dos alunos quantas pessoas estao na sala (docs/30 D102): sem numero no palco, no titulo e na aba.
  // A chave muda tambem pelo console com a live no ar (D107): o ultimo sinal de 15 s diz se o numero esta escondido; antes
  // dele (ou com o servidor de antes), a sessao.
  const presentHidden = heartbeatHidden ?? session.presentHidden === true;
  const presentShown = phase === "ended" || presentHidden ? null : simulation.displayCount(presentNow, simulationOffsetMs);
  const presentBadge = roomPresentBadge(presentShown);
  const metaLine = roomDateLine({ durationMinutes: session.webinar.durationMinutes, kind: "live", presenterName, scheduledAt: session.session.scheduledAt }).join(" · ");
  const mobileLine = roomMobileLine(presenterName);
  // A coluna de miniaturas do iframe a direita do video, quando o motor a mostra (o Palco, com a coluna na tela pela
  // largura do iframe, V2-A5): os selos de baixo e as pilulas param antes dela. Fora do iframe, nenhuma coluna.
  const videoRightPx = stageVideoRightPx({ columnShown: stageColumnShown(room.signals, joined, room.thumbsRow), touch: geometry.touch });
  // A fileira de miniaturas embaixo (D91): o que fica na base do palco sobe a altura dela.
  const videoBottomPx = stageVideoBottomPx({ rowShown: stageRowShown(room.signals, joined, room.thumbsRow) });
  // O selo de cima a esquerda do palco: no ar, o tempo; na espera com a sala aberta, "Aguardando o apresentador".
  const stageMoment = liveStageMoment({ phase, screen });
  // As fixadas com o painel fechado: as pilulas no palco largo e as linhas abaixo do palco estreito.
  const pinnedShortcuts = pinnedPillsShown({ blocked, design: "normal", panelShown, settingsTakeover });
  const focusPinned = usePinnedFocus(rootRef);
  // A Na tela, o banner e o QR Code: as mesmas regras das fixadas (§3.6); qualquer capa no palco manda tudo para a faixa.
  const screenItems = pinnedOn ? naTela.items : [];
  const screenForced = screenStripForcedLive({ entry: room.entry, screen });
  const pinnedPillsOn = pinnedShortcuts && (pinnedMessage !== null || pinnedPoll !== null);
  const placement = screenPlacement({ items: screenForced ? [] : screenItems, offerShown: false, pinnedPills: !screenForced && pinnedPillsOn });
  // O comentario ou a pergunta que a equipe trouxe para a tela (rodada v9, docs/30 D89): pelas mesmas regras da Na tela.
  const screenComment = pinnedOn && !blocked ? naTela.comment : null;
  const screenCommentAt = screenCommentPlace(placement.cells.map((cell) => cell.place));
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

  /** O tema da sala: o botao do cabecalho (a partir de sm) e a linha Tema do painel Configurações (abaixo de sm). */
  function toggleTheme() {
    setTheme(theme === "light" ? "dark" : "light");
  }

  function leave() {
    room.hangUp();
    router.push(webinarHref);
  }

  // A confirmacao de Sair: o foco entra no Voltar dela e volta para quem a abriu.
  const rememberLeaveOpener = useRoomConfirmFocus(rootRef, confirmLeave);
  // A janela "A live foi encerrada": o foco entra no OK dela e, ao fechar, volta para a sala.
  useRoomConfirmFocus(rootRef, endedNotice && !confirmLeave);

  // O aviso da barra (ou o da troca de aparelho) entra no aviso da sala; quando ele sai daqui (o microfone abriu depois
  // do aviso do prazo, a troca acabou), sai de la tambem.
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
  const shownNoticeRef = useRef<string | null>(null);
  useEffect(() => {
    if (notice) {
      shownNoticeRef.current = notice.key;
      snackbarApi.show(notice);
      return;
    }
    if (shownNoticeRef.current) {
      snackbarApi.clear(shownNoticeRef.current);
      shownNoticeRef.current = null;
    }
  }, [notice, snackbarApi]);
  // A troca de aparelho ainda em andamento volta depois do aviso que tomou o lugar dela (o sucesso do chat ou das
  // Perguntas): sem isto ela sumiria de vez, porque o `notice` continua o mesmo.
  const restoreSnack = snackToRestore(notice, snackbar.snack);
  useEffect(() => {
    if (restoreSnack) {
      snackbarApi.show(restoreSnack);
    }
  }, [restoreSnack, snackbarApi]);

  // A fixada nova com o painel fechado: "A equipe fixou uma mensagem." com Ver, uma vez por fixada (a que ja estava quando
  // a sala abriu nao avisa). O id e o do estado da Na tela, mesmo com as fixadas fora da tela (removido): o Desfazer da
  // equipe devolve a fixada de antes, que nao e nova.
  const pinnedId = naTela.pinned?.id ?? null;
  const pinnedSeenRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const before = pinnedSeenRef.current;
    pinnedSeenRef.current = pinnedId;
    if (pinnedNoticeShown({ after: pinnedId, before, panelShown, shown: pinnedOn })) {
      snackbarApi.show(pinnedSnack());
    }
  }, [panelShown, pinnedId, pinnedOn, snackbarApi]);

  // A gravacao que comecou com o aluno ja na sala (o motor, o "Gravar no navegador" ou a sessao relida): "Esta live
  // começou a ser gravada." no aviso, no lugar do aviso do motor. Ja ligada na entrada, so o selo Gravando.
  const showRoomNotice = room.showNotice;
  const recordingSeenRef = useRef({ joined, on: recording });
  useEffect(() => {
    const before = recordingSeenRef.current;
    recordingSeenRef.current = { joined, on: recording };
    if (shouldAnnounceRecording(before.on, recording, before.joined && joined)) {
      showRoomNotice("recording_started");
    }
  }, [joined, recording, showRoomNotice]);

  /** A acao do aviso: Configurações abre o painel (o foco vai ao botao dele, porque o aviso sai); Ver abre a fixada. */
  function onSnackAction(key: string) {
    if (key === PINNED_SNACK_ACTION) {
      showPinned("message");
      return;
    }
    if (key === QUESTION_NEWS_SNACK_ACTION) {
      // Ver: a aba Perguntas abre (a Tela cheia do palco sai antes, senao o painel abriria escondido).
      leaveStageFullscreen(document, stageRef.current);
      setTab("perguntas");
      setPanelOpen(true);
      if (settingsTakeover) {
        closeSettings();
      }
      return;
    }
    if (key !== SNACK_SETTINGS_ACTION) {
      return;
    }
    panelButton(LIVE_SETTINGS_ID)?.focus();
    if (!settingsOpen) {
      toggleSettings();
    }
  }

  /** Sair e Esc: com a live no ar (ou dentro do iframe), pergunta antes (docs/30 §1.7). */
  function askToLeave() {
    if ((phase === "live" || joined) && !blocked) {
      rememberLeaveOpener();
      setConfirmLeave(true);
      return;
    }
    leave();
  }

  useRoomDialogLock(rootRef, true);

  // O painel do chat fechou com o foco nele (o X, a escolha guardada lida depois da primeira pintura): o foco vai ao
  // item do trilho da aba que estava aberta (a partir de lg) ou ao balao da barra (abaixo de lg), nunca fica no body.
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
  // outra mensagem, a enquete fixada saiu, o QR Code que chegou mudou o cartao de celula, o aluno fechou, a capa mandou
  // tudo para a faixa): o foco volta para a sala (o primeiro [data-room-first-focus] na tela), nunca fica no body. Com
  // o foco ainda na sala, nada.
  const screenKeyRef = useRef(screenKey);
  useLayoutEffect(() => {
    const was = screenKeyRef.current;
    screenKeyRef.current = screenKey;
    if (was !== screenKey) {
      refocusRoom(rootRef.current, document.activeElement);
    }
  }, [screenKey]);

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

  /**
   * A pilula ou a linha da fixada (e o Ver do aviso): o painel abre (no Chat, para a mensagem; na aba de agora, para a
   * enquete: a area esta em toda aba) e o foco vai ao bloco da area; no celular com Configurações aberto, ele fecha.
   */
  function showPinned(target: PinnedFocusTarget) {
    // Na Tela cheia de verdade o elemento em tela cheia e o palco, e o painel fica fora dele: a tela cheia sai antes,
    // senao o painel abriria escondido e o foco iria para tras da tela cheia.
    leaveStageFullscreen(document, stageRef.current);
    if (target === "message") {
      setTab("chat");
    }
    setPanelOpen(true);
    if (settingsTakeover) {
      closeSettings();
    }
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

  /** Um item do trilho (a partir de lg): abre o painel naquela aba ou, no item aberto, fecha (so com a barra na tela). */
  function onRail(item: RoomPanelTab) {
    const step = railStep({ closable: barShown, item, panelShown, tab });
    setTab(step.tab);
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
      // A janela "A live foi encerrada" e a camada de cima: o Esc so a fecha.
      if (endedNotice && !confirmLeave) {
        setEndedNotice(false);
        return;
      }
      // A camada de cima primeiro (roomEscapeStep): a confirmacao, os paineis da barra, a enquete no palco; so entao o Sair.
      const step = roomEscapeStep({ confirmLeave, popoverOpen: reactionsShown || settingsShown || viewMenuShown, stagePoll: stagePoll?.mode ?? null });
      if (step === "close_confirm") {
        setConfirmLeave(false);
      } else if (step === "close_popovers") {
        // O foco dentro do painel volta ao botao (sem isso ele cairia no body e a sala deixaria de ouvir o teclado).
        returnFocusFrom(LIVE_REACTIONS_ID);
        setReactionsOpen(false);
        closeSettings();
        closeViewMenu();
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
    if (event.key === "Tab") {
      trapRoomFocus(event, confirmLeave || endedNotice ? (rootRef.current?.querySelector<HTMLElement>("[data-room-confirm]") ?? rootRef.current) : rootRef.current);
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

  function onMic() {
    const action = micClick(micInput);
    if (action === "blocked") {
      room.showNotice("mic_full");
    } else if (action === "ask") {
      // O PRIMEIRO abrir do microfone sozinho passa pelo aviso de gravacao; so Falar chega ao iframe.
      setMicAsk(true);
    } else {
      room.toggleMic();
    }
  }

  function confirmMic() {
    setMicAsk(false);
    setMicConsented(true);
    // A moderacao de audio pode ter ligado (ou ainda nao foi lida) com o aviso aberto: o aviso do microfone fechado, sem abrir.
    if (micFull) {
      room.showNotice("mic_full");
      return;
    }
    room.acceptMic();
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
  // Fechando, o painel continua no lugar ate a saida terminar (rodada v9, P12): o palco muda de tamanho uma vez so.
  const panelMotion = usePanelMotion(panelShown);
  const skeletonState = liveSkeletonState({ blocked, cinema: cinemaOn, panelShown: panelMotion.laid, settingsTakeover });
  const skeleton = roomSkeleton("normal", skeletonState);

  // A sala inteira dentro do aviso da sala (o chat e as Perguntas mostram o sucesso nele).
  const page = (
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
      // A altura do campo do painel (abaixo de lg, o aviso fica acima dele).
      style={snackbar.composerPx > 0 ? ({ "--room-composer-h": `${snackbar.composerPx}px` } as CSSProperties) : undefined}
    >
      <RoomHeader
        leaveInBar={barShown}
        metaLine={metaLine}
        mobileLine={mobileLine}
        onLeave={askToLeave}
        onToggleTheme={toggleTheme}
        theme={theme}
        title={session.webinar.title}
      />

      {confirmLeave ? <RoomLeaveDialog onCancel={() => setConfirmLeave(false)} onLeave={leave} /> : null}
      {endedNotice && !confirmLeave ? <RoomEndedDialog onClose={() => setEndedNotice(false)} /> : null}

      <div className={skeleton.body} data-room-slot="body">
        <div className={skeleton.stageColumn} data-room-slot="stage-column">
          <div
            className={skeleton.stageBox}
            data-room-slot="stage-box"
            // Com o aviso no palco, as pilulas do chat sobem a altura dele (room-chat-pills.tsx).
            style={snackbar.stageOffsetPx > 0 ? ({ "--room-snackbar-offset": `${snackbar.stageOffsetPx}px` } as CSSProperties) : undefined}
          >
            <LiveStage
              className={cn(
                "w-full max-lg:landscape:aspect-auto max-lg:landscape:min-h-0 max-lg:landscape:flex-1 lg:aspect-auto lg:min-h-0 lg:flex-1",
                skeletonState.stageGrows ? "min-h-0 flex-1" : "aspect-video"
              )}
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
              videoBottomPx={videoBottomPx}
              videoRightPx={videoRightPx}
            >
              {/* Os selos ficam com a sala de pe, como a barra: a live encerrada, removido ou banido os tiram. */}
              {barShown ? (
                <RoomStageBadges
                  assistantOn={phase === "live" && assistant.state.enabled}
                  assistantWideHidden={!placement.assistant}
                  present={presentBadge}
                  presenterName={phase === "live" ? presenterBadgeFor({ joined, presenterName, signals: room.signals }) : null}
                  recording={recording}
                  topLeft={stageMoment === "on_air" ? { kind: "on_air", label: liveOnAirLabel(startedAt, nowMs, skewMs), short: liveElapsedLabel(startedAt, nowMs, skewMs) } : stageMoment === "waiting" ? { kind: "waiting" } : null}
                />
              ) : null}
              {/* A Na tela no palco de 640 px ou mais: as fixadas com o painel fechado (abaixo dos selos), o banner e o QR Code; e o
                  aviso de venda simulado da live (R7), o ultimo da celula de cima a esquerda, como na gravada. */}
              {placement.cells.length > 0 || (fullscreenOn && screenItems.length > 0) || (!blocked && simulation.enabled) ? (
                <RoomScreenLayer
                  engineBar={joined && !ourBar}
                  forced={screenForced}
                  fullscreen={fullscreenOn}
                  handlers={screenHandlers}
                  items={screenItems}
                  pinned={pinnedPillsOn ? <RoomPinnedPills message={pinnedMessage} onMessage={() => showPinned("message")} onPoll={onPinnedPoll} poll={pinnedPoll} /> : null}
                  placement={placement}
                  topLeftExtra={blocked ? null : <RoomSimulationSales layout="cell" offsetMs={simulationOffsetMs} reducedMotion={reducedMotion} state={simulation} />}
                />
              ) : null}
              {/* O comentario ou a pergunta na tela (docs/30 D89): o cartao no palco de 640 px ou mais; no estreito, na faixa. */}
              <RoomScreenCommentLayer comment={screenComment} engineBar={joined && !ourBar} forced={screenForced} place={screenCommentAt} />
              <RoomReactionBubbles bubbles={reactions.bubbles} overflow={reactions.overflow} />
              {/* Com o painel fechado, as 2 ultimas mensagens em pilulas sobre o palco (V2-8); com um item embaixo ou o
                  comentario na tela, so no palco estreito. */}
              {chatPillsShown({ blocked, design: "normal", offerShown: false, panelShown, settingsTakeover }) ? (
                <RoomWideHidden hidden={!placement.chatPills || screenComment !== null}>
                  <RoomChatPills kind="live" messages={overlayMessages(translation.messages)} />
                </RoomWideHidden>
              ) : null}
              {/* O aviso da sala: no palco a partir de lg; abaixo, preso ao pe da tela, nunca sobre o video em pe. */}
              {blocked ? null : <RoomSnackbarHost onAction={onSnackAction} panelShown={panelShown} />}
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
          {/* O palco mais estreito (ou com uma capa): as fixadas, o banner e o QR Code em linhas logo abaixo dele, acima da barra. */}
          {pinnedOn ? (
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
              micBlocked={micFull}
              micWaiting={room.pendingToggle.audioInput}
              onCamera={onCamera}
              onFullscreen={toggleFullscreen}
              onHand={room.toggleHand}
              onLeave={askToLeave}
              onMic={onMic}
              onReact={reactions.react}
              onSound={room.toggleSound}
              onTogglePanel={togglePanel}
              onToggleReactions={toggleReactions}
              onToggleSettings={toggleSettings}
              onThumbs={setThumbs}
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
              selfUnmute={live.selfUnmute === true}
              soundOn={room.soundOn}
              videoOn={room.signals.videoOn}
              thumbs={thumbs}
              viewMenuOpen={viewMenuShown}
              viewShown={room.viewShown}
            />
          )}
        </div>

        {blocked ? null : (
          <>
            {/* Fechado, o painel fica montado e escondido (o rascunho, o aceite e a aba continuam). */}
            <RoomPanel
              className={skeleton.panel}
              closable={barShown}
              contentClassName={cn("max-lg:landscape:max-h-none lg:max-h-none", cinemaOn ? "max-h-[38vh] min-h-[10rem]" : undefined)}
              firstFocus={firstFocus === "tab"}
              id={ROOM_PANEL_ID}
              kind="live"
              motion={panelMotion}
              onClose={() => setPanelOpen(false)}
              onTab={setTab}
              open={panelShown}
              pinned={
                pinnedMessage || pinnedPoll ? (
                  <RoomPinnedArea message={pinnedMessage} onAnswer={roomPolls.answer} poll={pinnedPoll} readOnly={readOnly || !writable} timing={{ kind: "live", nowMs, skewMs, zeroMs: null }} />
                ) : null
              }
              pollOpen={openPolls.length > 0}
              questionsNew={questionNews.count}
              tab={tab}
              tabs={tabs}
              titleAction={
                tab === "perguntas" ? (
                  <RoomQuestionsOrderButton onOrder={setQuestionsOrder} order={questionsOrder} />
                ) : tab === "chat" ? (
                  <RoomChatMoreButton onRemove={() => setRemoveOpen(true)} readOnly={readOnly} />
                ) : undefined
              }
              titleCount={tab === "participantes" ? presentShown : tab === "enquetes" ? openPolls.length : tab === "perguntas" ? questionsCount : null}
            >
              {tab === "chat" ? (
                <>
                  {laterPoll ? <RoomPollLaterCard onResume={() => answerPollNow(laterPoll.id)} poll={laterPoll} /> : null}
                  <RoomTranslationBar state={translation} />
                  <RoomChatPanel
                    aboveComposer={<RoomSimulationJoins layout="stage" look="comment" offsetMs={simulationOffsetMs} reducedMotion={reducedMotion} state={simulation} />}
                    assistant={assistant}
                    chatMode={session.session.chatMode}
                    consented={session.me.consented}
                    avatarUrl={session.me.avatarUrl ?? null}
                    displayName={session.me.displayName}
                    error={chat.error}
                    messages={translation.messages}
                    notice={readOnly ? null : composerNotice}
                    nowMs={nowMs}
                    onRemoveMine={chat.removeMine}
                    onRemoveOpenChange={setRemoveOpen}
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
                    readOnly={readOnly}
                    removeOpen={removeOpen}
                    sessionId={sessionId}
                    shown={panelShown}
                    skewMs={skewMs}
                    slowUntilMs={chat.slowUntilMs}
                    timeKind="live"
                    webinarId={webinarId}
                  />
                </>
              ) : null}
              {tab === "perguntas" ? (
                <RoomQuestionsTab
                  assistant={assistant}
                  consented={session.me.consented}
                  avatarUrl={session.me.avatarUrl ?? null}
                  displayName={session.me.displayName}
                  enabled={!readOnly}
                  ended={phase === "ended"}
                  filter={questionsFilter}
                  getOffsetMs={getOffsetMs}
                  look="comment"
                  notice={readOnly ? null : composerNotice}
                  onConsented={() => void refreshSession()}
                  onCount={setQuestionsCount}
                  onFilter={setQuestionsFilter}
                  onOrder={setQuestionsOrder}
                  onQuestions={questionNews.ingest}
                  onRefused={onWriteRefused}
                  order={questionsOrder}
                  readOnly={readOnly || phase === "ended"}
                  serverNowMs={nowMs + skewMs}
                  sessionId={sessionId}
                  webinarId={webinarId}
                />
              ) : null}
              {tab === "participantes" ? <LiveParticipantsTab note={readOnly ? WEBINAR_COPY.simulacao.plateia.previa : null} presenterKnown={presenterName !== null} stage={stage} students={presentShown} /> : null}
              {/* A enquete fixada fica na area das fixadas, acima: aqui so as outras (e nada, quando ela e a unica). */}
              {tab === "enquetes" && !(pinnedPoll && pollsTab.length === 0) ? (
                <RoomPollsTab onAnswer={roomPolls.answer} polls={pollsTab} readOnly={readOnly || !writable} />
              ) : null}
            </RoomPanel>
            {/* O trilho a direita, a partir de lg: abre e fecha o painel em cada aba. */}
            <RoomRail kind="live" onItem={onRail} panelShown={panelShown} pollOpen={openPolls.length > 0} questionsNew={questionNews.count} tab={tab} tabs={tabs} unread={unread} />
          </>
        )}
      </div>

      {cameraAsk ? <LiveCameraDialog onCancel={() => setCameraAsk(false)} onConfirm={confirmCamera} /> : null}
      {room.signals.micPrompt && !blocked ? <LiveMicDialog onCancel={room.declineMic} onConfirm={room.acceptMic} /> : null}
      {micAsk && !room.signals.micPrompt && !blocked ? <LiveMicDialog onCancel={() => setMicAsk(false)} onConfirm={confirmMic} title={WEBINAR_COPY.aoVivo.microfoneSozinhoTitulo} /> : null}
    </div>
  );
  return <RoomSnackbarProvider value={snackbar}>{page}</RoomSnackbarProvider>;
}
