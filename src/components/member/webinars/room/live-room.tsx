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
import { LIVE_REACTIONS_ID, LIVE_SETTINGS_ID, LiveControls } from "./live-controls";
import { useRoomAssistant } from "./assistant/use-room-assistant";
import { LiveCameraDialog, LiveChatOverlay, LiveMicDialog, LiveParticipantsTab } from "./live-notices";
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
  overlayMessages,
  pendingTogglePhrase,
  prefersCinemaMode,
  screenBlocksRoom,
  stageNames,
  usesOurBar,
  writeRefusalOf,
  type LiveJoinFailure
} from "./live-room-model";
import { LiveSettings } from "./live-settings";
import { LiveStage } from "./live-stage";
import { RoomChatPanel } from "./room-chat";
import { RoomHeader } from "./room-header";
import { roomDateLine, roomMobileLine, stageVideoRightPx } from "./room-layout-model";
import { RoomPollsTab } from "./room-polls";
import { RoomQuestionsTab } from "./room-questions";
import { RoomReactionBubbles } from "./room-reactions";
import { RoomStageBadges } from "./room-stage-badges";
import { RoomButton } from "./room-ui";
import { useRoomChat, useRoomClock, useRoomHeartbeat, useRoomReactions } from "./use-room-data";
import { useRoomTranslation } from "./use-room-translation";
import { entryInRoom, useLiveRoom } from "./use-live-room";
import { useRoomTheme } from "./use-room-prefs";
import { ROOM_FOCUSABLE, trapRoomFocus, useRoomDialogLock, useRoomReducedMotion } from "./webinar-room";

// A sala da Live ao vivo do aluno (docs/30 §1.3, §1.4, §1.5, §1.7, §5.1, §6.3, §8.5 e §9; fase 3), no mesmo endereco
// da gravada (/webinarios/[slug]/sala?sessao=) e no mesmo dialogo de tela cheia (aria-modal, foco preso, Esc pede
// confirmacao com a live no ar). O cabecalho ("{n} assistindo" e Sair; sem Minimizar, docs/31 V2-2), o palco com os
// selos ("Ao vivo · 00:42:10" pelo inicio de verdade e o Gravando) e o iframe (live-stage.tsx: Entrar na sala,
// Reconectando…, a sala trancada, em breve, encerrada), a nossa barra (live-controls.tsx), as abas Chat / Perguntas / Participantes /
// Enquetes (a de Enquetes so com enquete aberta; no celular, gaveta pela aba de baixo e as 3 ultimas mensagens por cima
// do palco com ela fechada) e os avisos de gravacao da camera e do microfone (live-notices.tsx). O chat, as perguntas, as enquetes,
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
// primeiro [data-room-first-focus], ou o primeiro controle), nunca para o body. No "ver como" da equipe nada e
// gravado: nem token, nem sinal, nem chat.
// Redesign V2, F2 (docs/31 V2-11 e V2-12): o tema claro ou escuro da pessoa fica no data-room-theme do dialogo (as
// superficies fora do video usam os tokens --room-*) e entra no iframe pelo LiveEmbedLook so na montagem (Entrar na
// sala, Tentar de novo, a volta depois da queda): o motor nao tem comando de tema, e trocar no meio nao remonta.
// Redesign V2, F3 (docs/31 V2-3 e V2-4): o cabecalho tem a linha da data (com a duracao e o apresentador) e, no
// celular, "com {apresentador} · {n} assistindo"; "Ao vivo · 00:42:10", "Gravando", quem apresenta e o Assistente
// ficam no palco (room-stage-badges.tsx), antes da coluna de miniaturas do iframe (--room-video-right). O estado do
// Assistente e lido uma vez pela sala e desce para o chat e as Perguntas.

type Tab = "chat" | "enquetes" | "participantes" | "perguntas";

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

/** O computador (lg): o painel fica sempre aberto a direita; no celular, a gaveta abre e fecha pela aba de baixo. */
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

/** Um aparelho com toque (como o motor conta: maxTouchPoints): o puxador da coluna de miniaturas fica mais largo. */
function readTouch() {
  try {
    return navigator.maxTouchPoints > 0;
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
  const [tab, setTab] = useState<Tab>("chat");
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const touch = useSyncExternalStore(subscribeNothing, readTouch, () => false);
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
  // No celular, o painel Configurações aberto toma o lugar da gaveta: o palco encolhe e a nossa barra fica na tela (o
  // botao que fecha o painel nunca sai da tela); a aba de baixo fecha o painel e abre a gaveta.
  const settingsTakeover = settingsShown && !desktop;
  const drawerVisible = desktop || (drawerOpen && !settingsTakeover);

  // A barra sumiu com o foco nela (no painel, nas reacoes, num botao): o foco volta para a sala, nunca para o body (onde
  // o Esc, os atalhos e a trava do Tab deixariam de valer).
  const barShownRef = useRef(barShown);
  useLayoutEffect(() => {
    const was = barShownRef.current;
    barShownRef.current = barShown;
    const root = rootRef.current;
    if (root && barFocusLost({ active: document.activeElement, barShown, barWasShown: was, body: document.body })) {
      const first = root.querySelector<HTMLElement>("[data-room-first-focus]");
      (first ?? root.querySelector<HTMLElement>(ROOM_FOCUSABLE))?.focus();
    }
  }, [barShown]);
  // Dentro da sala de verdade: com a tela fechada (encerrada, removido) o iframe ja desmontou.
  const joined = allowed && room.entry === "joined";
  const ourBar = usesOurBar(room.reply?.role ?? null);
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
  const openPolls = session.polls.filter((poll) => poll.status === "open");
  const showPollsTab = openPolls.length > 0 || tab === "enquetes";
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
  // A coluna de miniaturas do iframe fica a direita do video ate a F8 medir a largura (docs/31 V2-A5).
  const videoRightPx = stageVideoRightPx({ columnShown: true, touch });

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

  function openPollsTab() {
    if (openPolls.length > 0) {
      setTab("enquetes");
      setDrawerOpen(true);
      if (settingsTakeover) {
        closeSettings();
      }
    }
  }

  function selectTab(value: Tab) {
    if (settingsTakeover) {
      // No celular com o painel Configurações aberto: a aba fecha o painel e abre a gaveta nela.
      closeSettings();
      setTab(value);
      setDrawerOpen(true);
      return;
    }
    if (value === tab) {
      // No celular, a aba de baixo abre e fecha a gaveta (no computador o painel fica aberto).
      if (!desktop) {
        setDrawerOpen((open) => !open);
      }
      return;
    }
    setTab(value);
    setDrawerOpen(true);
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

  /** Reagir e Configurações nunca abertos juntos (no celular, empilhados, empurrariam a barra para fora da tela). */
  function toggleReactions() {
    if (!reactionsOpen && settingsOpen) {
      closeSettings();
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
    setSettingsOpen(true);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (confirmLeave) {
        setConfirmLeave(false);
      } else if (reactionsShown || settingsShown) {
        // O foco dentro do painel volta ao botao (sem isso ele cairia no body e a sala deixaria de ouvir o teclado).
        returnFocusFrom(LIVE_REACTIONS_ID);
        setReactionsOpen(false);
        closeSettings();
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
      openPollsTab();
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

  const tabs: Tab[] = ["chat", "perguntas", "participantes", ...(showPollsTab ? (["enquetes"] as const) : [])];
  const tabLabel = (value: Tab) => (value === "chat" ? copy.abas.chat : value === "perguntas" ? copy.abas.perguntas : value === "participantes" ? copy.abas.participantes : copy.abas.enquetes);
  // O palco cresce com a gaveta fechada, no Modo cinema (o chat fica embaixo, menor) e na frase de removido / banido; no
  // celular com o painel Configurações aberto (a gaveta fechada), ele divide a coluna com o painel e fica com no minimo
  // 96 px: o painel rola por dentro e a barra continua na tela.
  const stageGrows = blocked || !drawerVisible || cinemaOn;

  return (
    <div
      aria-label={session.webinar.title}
      aria-modal="true"
      className="z-[60] text-room-fg fixed inset-0 flex flex-col bg-room-bg"
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
        mobileLine={mobileLine}
        onLeave={askToLeave}
        onToggleTheme={() => setTheme(theme === "light" ? "dark" : "light")}
        presentNow={presentShown}
        theme={theme}
        title={session.webinar.title}
      />

      {confirmLeave ? (
        <div aria-label={copy.sairConfirmar} className="flex flex-wrap items-center justify-between gap-2 border-b border-room-warn-border bg-room-warn-bg px-3 py-2" role="alertdialog">
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

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className={cn("relative flex shrink-0 flex-col bg-black lg:min-h-0 lg:min-w-0 lg:flex-1", stageGrows ? "min-h-0 flex-1" : undefined)}>
          <LiveStage
            className={cn("w-full lg:aspect-auto lg:min-h-0 lg:flex-1", stageGrows ? cn("flex-1", settingsTakeover ? "min-h-24" : "min-h-0") : "aspect-video")}
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
                topLeft={phase === "live" ? { kind: "on_air", label: liveOnAirLabel(startedAt, nowMs, skewMs), short: liveElapsedLabel(startedAt, nowMs, skewMs) } : null}
              />
            ) : null}
            <RoomReactionBubbles bubbles={reactions.bubbles} overflow={reactions.overflow} />
            {!drawerVisible && !blocked && !settingsTakeover ? <LiveChatOverlay messages={overlayMessages(translation.messages)} /> : null}
          </LiveStage>
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
              onMic={room.toggleMic}
              onReact={reactions.react}
              onSound={room.toggleSound}
              onToggleReactions={toggleReactions}
              onToggleSettings={toggleSettings}
              reactionsDisabled={readOnly || !writable}
              reactionsOpen={reactionsShown}
              settings={
                <LiveSettings
                  cameraOn={room.signals.videoOn}
                  devices={room.devices}
                  onChoose={chooseDevice}
                  onClose={() => closeSettings(true)}
                  sections={deviceSettings}
                  showMedia={ourBar}
                />
              }
              settingsOpen={settingsShown}
              showMedia={ourBar}
              soundOn={room.soundOn}
              videoOn={room.signals.videoOn}
            />
          )}
        </div>

        {blocked ? null : (
          <aside
            className={cn(
              "flex min-h-0 flex-col border-t border-room-border bg-room-surface lg:w-[360px] lg:flex-none lg:border-l lg:border-t-0",
              drawerVisible && !cinemaOn ? "flex-1" : "flex-none"
            )}
            data-drawer-open={drawerVisible ? "" : undefined}
            data-testid="room-panel"
          >
            <div
              aria-label={copy.abas.chat}
              className="order-last flex shrink-0 border-t border-room-border pb-[env(safe-area-inset-bottom)] lg:order-first lg:border-b lg:border-t-0 lg:pb-0"
              role="tablist"
            >
              {tabs.map((value) => (
                <button
                  aria-controls={`room-tab-${value}`}
                  aria-expanded={value === tab && !desktop ? drawerOpen : undefined}
                  aria-selected={tab === value}
                  className={cn(
                    "relative h-11 min-w-0 flex-1 truncate px-1 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-room-focus motion-reduce:transition-none sm:text-sm",
                    tab === value ? "text-room-fg-strong" : "text-room-fg-muted hover:text-room-fg-strong"
                  )}
                  data-room-first-focus={value === "chat" ? "" : undefined}
                  id={`room-tabbtn-${value}`}
                  key={value}
                  onClick={() => selectTab(value)}
                  role="tab"
                  type="button"
                >
                  {tabLabel(value)}
                  {value === "enquetes" && openPolls.length > 0 ? <span aria-hidden="true" className="ml-1 inline-block size-1.5 rounded-full bg-[var(--accent)] align-middle" /> : null}
                  {tab === value ? <span aria-hidden="true" className="absolute inset-x-4 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" /> : null}
                </button>
              ))}
            </div>

            <div
              aria-labelledby={`room-tabbtn-${tab}`}
              className={cn("min-h-0 flex-1 flex-col lg:flex lg:max-h-none", drawerVisible ? "flex" : "hidden", cinemaOn ? "max-h-[38vh] min-h-[10rem]" : undefined)}
              id={`room-tab-${tab}`}
              role="tabpanel"
            >
              {tab === "chat" ? (
                <>
                  {openPolls.length > 0 ? (
                    <button
                      className="mx-3 mt-2 rounded-[12px] border border-room-input-border bg-room-surface-2 px-3 py-2 text-left text-sm hover:border-room-fg-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus"
                      onClick={openPollsTab}
                      type="button"
                    >
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-room-fg-subtle">{copy.abas.enquetes}</span>
                      <span className="block truncate font-bold text-room-fg-strong">{openPolls[0].question}</span>
                    </button>
                  ) : null}
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
              {tab === "participantes" ? <LiveParticipantsTab stage={stage} students={presentNow} /> : null}
              {tab === "enquetes" ? (
                <RoomPollsTab enabled={!readOnly} getOffsetMs={getOffsetMs} initial={session.polls} onRefused={onWriteRefused} readOnly={readOnly || !writable} sessionId={sessionId} webinarId={webinarId} />
              ) : null}
            </div>
          </aside>
        )}
      </div>

      {cameraAsk ? <LiveCameraDialog onCancel={() => setCameraAsk(false)} onConfirm={confirmCamera} /> : null}
      {room.signals.micPrompt && !blocked ? <LiveMicDialog onCancel={room.declineMic} onConfirm={room.acceptMic} /> : null}
    </div>
  );
}
