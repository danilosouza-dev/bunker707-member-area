"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useJitsiDevices, type DeviceSwitchHooks, type UseJitsiDevices } from "@/components/webinars/use-jitsi-devices";
import { useJitsiMeet, type JitsiMeetApi, type JitsiStatus } from "@/components/webinars/use-jitsi-meet";
import { DEVICE_SWITCH_MAX_MS, type DeviceKind } from "@/lib/jitsi-device-settings";
import { liveConfigOverwrite, liveInterfaceConfigOverwrite, toRoomEvent, type JitsiListenedEvent, type RoomEventItem } from "@/lib/jitsi-room-config";
import type { JoinTokenReply } from "@/server/webinars/live-model";
import {
  acceptMic,
  answerDeviceSwitch,
  applyLiveSignal,
  applyRoomsInfo,
  cameraAnswerDelayMs,
  cameraConsentEndedByDenial,
  cameraConsentEndedByError,
  cameraRequestUnanswered,
  consentForVideoSignal,
  declineMic,
  DEVICE_SWITCH_KINDS,
  deviceSwitchCheck,
  deviceSwitchSettled,
  deviceSwitchSignalOf,
  deviceSwitchStep,
  dropKind,
  expectAudioToggle,
  expectDeviceSwitch,
  expectVideoToggle,
  gateSwitchDone,
  gateSwitchStarted,
  gateToggle,
  INITIAL_LIVE_SIGNALS,
  joinFailureOf,
  joinTimeoutOutcome,
  LIVE_ROOM_RULES,
  lowerHandRequested,
  micAskCheck,
  micAskStep,
  micRequestDenied,
  micRequestUnanswered,
  OPEN_SWITCH_GATE,
  queueRoomEvent,
  reconnectStep,
  recordingSignalOf,
  remoteParticipantIds,
  requeueBatch,
  roomEventsOutcome,
  startDeviceSwitch,
  startMicAsk,
  takeRoomEventBatch,
  toggleHandLocally,
  tokenRefreshInMs,
  type DeviceSwitch,
  type DeviceSwitchKind,
  type LiveJoinFailure,
  type LiveNotice,
  type LiveSignalState,
  type MicAsk,
  type SwitchGate
} from "./live-room-model";
import { beaconRoomEvents, postJoinToken, postRoomEvents, retryAfterOf } from "./room-api";

// A sala ao vivo do aluno por dentro (docs/30 §1.3, §5.1, §5.4, §6.3, §8.5 e §9; fase 3), fora do desenho:
// - a entrada: "Entrar na sala" pede o token (POST .../join-token) e monta o iframe no palco pelo useJitsiMeet com o
//   configOverwrite do papel que o servidor decidiu (liveConfigOverwrite); 409 / 503 viram a tela do estado
//   (onRefused) e o resto, "Não foi possível abrir a sala" com Tentar de novo;
// - o token novo antes do `exp` (tokenRefreshDelayMs): guardado sem remontar a sala no ar (vale na proxima montagem);
// - a queda (o iframe falhou, ou saiu sem o aluno sair, ou nao confirmou a entrada em 30 s): "Reconectando…" e ate
//   RECONNECT_ATTEMPTS tentativas (2 s, 4 s, 8 s), cada uma com um token novo (o join-token decide se ainda pode: a
//   live encerrada, o removido e o banido param aqui); depois, "Não conseguimos voltar" e Tentar de novo;
// - os sinais: cada sinal do iframe passa por toRoomEvent (so codigos; o que ele recusa nem entra na fila) e vai em
//   lotes de ate 20 a cada 10 s para POST .../room-events, e o que sobrar no pagehide pelo sendBeacon; 429 espera o
//   Retry-After; e muda a nossa barra (applyLiveSignal: mao, camera, microfone liberado, gravando, quem esta no palco);
// - os comandos da nossa barra: toggleRaiseHand, toggleVideo (depois do aviso de gravacao: o proximo
//   videoMuteStatusChanged vai com consented = true; sem resposta no prazo, a permissao da camera relida diz se foi o
//   navegador, que desfaz o aceite, ou a camera dos alunos desligada), toggleAudio (so depois de liberado e do Falar;
//   o "ligado" do iframe sempre espera a faixa abrir, com ou sem a permissao do site, e a recusa ou a falha do navegador
//   vira o aviso, sem linha "ligado" no servidor: turnMicOn; o pedido acaba na queda e no iframe novo, nunca por prazo)
//   e o Som (setParticipantVolume de cada um, com o volume da faixa do painel);
// - os sinais de mudo de um iframe antes do videoConferenceJoined dele (o startWithAudioMuted aplicado na entrada) nao
//   contam: nem a barra, nem o pedido do microfone, nem o servidor (toda entrada ja comeca muda);
// - o painel Configurações (useJitsiDevices): os aparelhos lidos com a sala no ar e a cada deviceListChanged; a troca
//   de microfone ou de camera so quando o painel deixa (`canSwitchDevice`: depois do consentimento); a da camera aberta
//   antes do set*Device (startDeviceSwitch): os sinais de mudo da faixa nova nao vao para a barra (nada de "a equipe
//   fechou a sua câmera") nem para o servidor (nada de webinar_camera_toggled falso), ate o mudo voltar ao de antes ou
//   o prazo vencer (a faixa que nao voltou vale entao como nossa); a do microfone nao manda sinal de mudo nesta tag e
//   nao abre essa janela; o micError / cameraError (so da troca de aparelho, nesta tag) viram o aviso na barra (e
//   fecham a janela da troca da camera), e o cameraError que encerra o aceite pendente da camera desfaz o aceite
//   (onCameraConsentEnded). O toque em Microfone / Câmera durante a troca daquele aparelho espera ela ACABAR (o hook ve
//   o aparelho escolhido em uso, o erro ou o teto; num iframe que ainda nao teve faixa de camera, so o teto: o
//   getCurrentDevices diz o escolhido antes de a faixa da troca entrar) e vai depois, na faixa nova (SwitchGate): a tag
//   le o mudo antes do getUserMedia do aparelho novo e o grava de volta quando a faixa nova entra, desfazendo o toque
//   feito no meio; enquanto espera, a barra mostra o estado real com o sinal de espera;
//   Nenhuma frase de tela aqui; nada de texto vai para o servidor.

export type LiveEntry = "idle" | "joined" | "joining" | "lost" | "open_failed" | "opening" | "reconnecting";

/** Dentro do iframe ou voltando para ele (a tranca da sala nao tira quem ja entrou). */
export function entryInRoom(entry: LiveEntry): boolean {
  return entry === "joining" || entry === "joined" || entry === "reconnecting";
}

function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}

function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : null;
}

/**
 * A permissao da camera ou do microfone neste navegador (`prompt`, `granted`, `denied`), ou nulo sem como saber. O
 * iframe pede pela origem da pagina (delegacao de permissao), entao a resposta dele aparece aqui.
 */
async function mediaPermissionState(name: "camera" | "microphone"): Promise<string | null> {
  try {
    const status = await navigator.permissions?.query({ name: name as PermissionName });
    return status?.state ?? null;
  } catch {
    return null;
  }
}

/** Uma pergunta booleana ao iframe (isAudioMuted, isParticipantForceMuted), ou nulo sem resposta a tempo. */
function iframeAnswer(call: () => Promise<unknown> | unknown): Promise<boolean | null> {
  return new Promise((resolve) => {
    const id = window.setTimeout(() => resolve(null), LIVE_ROOM_RULES.micCheckMs);
    const done = (value: unknown) => {
      window.clearTimeout(id);
      resolve(typeof value === "boolean" ? value : null);
    };
    Promise.resolve()
      .then(call)
      .then(done, () => done(null));
  });
}

/* ------------------------------------------------------------------------------------------------
 * A fila dos sinais do iframe
 * ---------------------------------------------------------------------------------------------- */

export function useRoomEventQueue(input: { enabled: boolean; onBlocked: (reason: "banned" | "ended" | "kicked") => void; sessionId: string; webinarId: string }) {
  const { enabled, sessionId, webinarId } = input;
  const queueRef = useRef<RoomEventItem[]>([]);
  const pauseUntilRef = useRef(0);
  const busyRef = useRef(false);
  const blockedRef = useRef(input.onBlocked);

  useEffect(() => {
    blockedRef.current = input.onBlocked;
  });

  const push = useCallback((item: RoomEventItem | null) => {
    queueRef.current = queueRoomEvent(queueRef.current, item);
  }, []);

  /** Um lote por vez (o servidor aceita 6 por minuto por aluno e sessao: um a cada 10 s). */
  const flush = useCallback(async () => {
    if (busyRef.current || queueRef.current.length === 0 || Date.now() < pauseUntilRef.current) {
      return;
    }
    const { batch, body, rest } = takeRoomEventBatch(queueRef.current, sessionId);
    queueRef.current = rest;
    if (!body) {
      return;
    }
    busyRef.current = true;
    try {
      await postRoomEvents(webinarId, body);
    } catch (error) {
      const reason = (error as { reason?: unknown } | null)?.reason;
      const message = (error as { message?: unknown } | null)?.message;
      const outcome = roomEventsOutcome({
        message: typeof message === "string" ? message : null,
        nowMs: Date.now(),
        reason: typeof reason === "string" ? reason : null,
        retryAfterSeconds: retryAfterOf(error),
        status: statusOf(error)
      });
      if (outcome.requeue) {
        queueRef.current = requeueBatch(queueRef.current, batch);
      }
      if (outcome.pauseUntilMs) {
        pauseUntilRef.current = outcome.pauseUntilMs;
      }
      if (outcome.blocked) {
        blockedRef.current(outcome.blocked);
      }
    } finally {
      busyRef.current = false;
    }
  }, [sessionId, webinarId]);

  /** Tudo o que sobrou, pelo sendBeacon (a pagina pode estar descarregando). */
  const beacon = useCallback(() => {
    for (let round = 0; round < 10 && queueRef.current.length > 0; round += 1) {
      const { body, rest } = takeRoomEventBatch(queueRef.current, sessionId);
      queueRef.current = rest;
      if (body) {
        beaconRoomEvents(webinarId, body);
      }
    }
  }, [sessionId, webinarId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const id = window.setInterval(() => void flush(), LIVE_ROOM_RULES.eventFlushMs);
    window.addEventListener("pagehide", beacon);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pagehide", beacon);
      beacon();
    };
  }, [beacon, enabled, flush]);

  return { beacon, push };
}

/* ------------------------------------------------------------------------------------------------
 * A sala ao vivo
 * ---------------------------------------------------------------------------------------------- */

export type UseLiveRoomInput = {
  /** A sala pode montar o iframe (a tela "open", fora do "ver como"); falso desmonta. */
  allowed: boolean;
  /** A troca de aparelho daquele tipo esta liberada agora (as secoes do painel: o aluno so troca depois do consentimento). */
  canSwitchDevice: (kind: DeviceKind) => boolean;
  /** O palco (16:9) onde o iframe entra. */
  container: RefObject<HTMLElement | null>;
  /** O nome de um aparelho que o navegador ainda nao nomeou ("Microfone 1"), por tipo. */
  deviceNames: Record<DeviceKind, (position: number) => string>;
  /** O titulo do iframe para o leitor de tela (o nosso, nunca o nome do motor de video: D2). */
  frameTitle: string;
  /** A sala de espera da sala esta ligada (LiveRoomInfo.lobby): a entrada espera a equipe admitir, sem o prazo de 30 s. */
  lobby: boolean;
  nonce: string | null;
  /** Um erro de camera encerrou o aceite pendente do aviso de gravacao: o proximo clique em Câmera abre o aviso de novo. */
  onCameraConsentEnded: () => void;
  /** O join-token recusou (409 / 503) ou um lote de sinais voltou 409: a sala troca de tela. */
  onRefused: (failure: Exclude<LiveJoinFailure, "error">) => void;
  sessionId: string;
  /** O painel Configurações aberto: os aparelhos sao relidos. */
  settingsOpen: boolean;
  webinarId: string;
};

export type LiveRoomController = {
  /** Falar: o microfone liga (toggleAudio) e fica na barra. */
  acceptMic: () => void;
  declineMic: () => void;
  /** Os aparelhos, o ruido, o fundo, a qualidade e o volume do painel Configurações. */
  devices: UseJitsiDevices;
  enter: () => void;
  entry: LiveEntry;
  /** Sair: o iframe sai (hangup) e o que sobrou da fila vai pelo sendBeacon. */
  hangUp: () => void;
  jitsiStatus: JitsiStatus;
  reply: JoinTokenReply | null;
  retryNow: () => void;
  showNotice: (notice: LiveNotice) => void;
  signals: LiveSignalState;
  soundOn: boolean;
  /** O toque em Microfone / Câmera esperando a troca daquele aparelho acabar (a barra mostra o estado real, ocupada). */
  pendingToggle: Record<DeviceSwitchKind, boolean>;
  /** Câmera: `consented` = este clique passou pelo aviso de gravacao (o proximo sinal leva consented = true). */
  toggleCamera: (consented: boolean) => void;
  toggleHand: () => void;
  toggleMic: () => void;
  toggleSound: () => void;
};

export function useLiveRoom(input: UseLiveRoomInput): LiveRoomController {
  const { allowed, container, frameTitle, lobby, nonce, sessionId, webinarId } = input;
  const [reply, setReply] = useState<JoinTokenReply | null>(null);
  const [entry, setEntry] = useState<LiveEntry>("idle");
  const [signals, setSignals] = useState<LiveSignalState>(INITIAL_LIVE_SIGNALS);
  const [soundOn, setSoundOn] = useState(true);
  const ownIdRef = useRef<string | null>(null);
  const leavingRef = useRef(false);
  const everJoinedRef = useRef(false);
  const attemptsRef = useRef(0);
  const droppingRef = useRef(false);
  /** Voltou sozinho (o iframe reconectou) depois da queda: a tentativa marcada nao remonta nada. */
  const rejoinedRef = useRef(false);
  const mountGenerationRef = useRef(0);
  const joinedGenerationRef = useRef(-1);
  const consentNextVideoRef = useRef(false);
  const soundOnRef = useRef(true);
  const signalsRef = useRef(signals);
  const joinedRef = useRef(false);
  /**
   * O IFrame API montado agora (o `api` do useJitsiMeet) e o que confirmou a entrada (videoConferenceJoined): os sinais
   * de mudo de um iframe que ainda nao entrou (o novo, depois de uma queda ou de Tentar de novo) ou depois da queda nao
   * contam. So o iframe montado agora repassa sinais (o useJitsiMeet cala o descartado).
   */
  const meetApiRef = useRef<RefObject<JitsiMeetApi | null> | null>(null);
  const joinedApiRef = useRef<JitsiMeetApi | null>(null);
  const refusedRef = useRef(input.onRefused);
  const timersRef = useRef(new Set<number>());
  const commandRef = useRef<(command: string, ...args: unknown[]) => boolean>(() => false);
  /** O getRoomsInfo do iframe (quem ja moderava antes de o aluno entrar), no maximo uma vez a cada 5 s. */
  const roomsInfoRef = useRef<() => Promise<unknown> | null>(() => null);
  const roomsInfoAtRef = useRef(0);
  const roomsInfoPendingRef = useRef(false);
  const retryRef = useRef<() => void>(() => undefined);
  const dropRef = useRef<() => void>(() => undefined);
  const lobbyRef = useRef(lobby);
  const canSwitchRef = useRef(input.canSwitchDevice);
  const consentEndedRef = useRef(input.onCameraConsentEnded);
  /** As trocas de camera em andamento (o painel Configurações) e o numero da ultima. */
  const switchesRef = useRef<Record<DeviceSwitchKind, DeviceSwitch | null>>({ audioInput: null, videoInput: null });
  const switchSeqRef = useRef(0);
  /** A troca de microfone / camera ainda sem acabar e o toque em Microfone / Câmera que espera ela (SwitchGate). */
  const gatesRef = useRef<Record<DeviceSwitchKind, SwitchGate>>({ audioInput: OPEN_SWITCH_GATE, videoInput: OPEN_SWITCH_GATE });
  const [pendingToggle, setPendingToggle] = useState<Record<DeviceSwitchKind, boolean>>({ audioInput: false, videoInput: false });
  /** O toque de cada aparelho que vai ao iframe (o que espera a troca vai por aqui quando ela acaba). */
  const sendToggleRef = useRef<Record<DeviceSwitchKind, () => void>>({ audioInput: () => undefined, videoInput: () => undefined });
  /** O pedido do microfone (o "ligado" espera a faixa abrir; MicAsk) e o numero do ultimo. */
  const micAskRef = useRef<MicAsk | null>(null);
  const micAskSeqRef = useRef(0);
  /** Este iframe ja teve faixa de camera (um "ligada" desde o videoConferenceJoined): o getCurrentDevices dela vale. */
  const cameraTrackRef = useRef(false);
  const setGate = useCallback((kind: DeviceSwitchKind, gate: SwitchGate) => {
    gatesRef.current[kind] = gate;
    setPendingToggle((previous) => (previous[kind] === gate.queued ? previous : { ...previous, [kind]: gate.queued }));
  }, []);
  /** O volume que quem entra recebe (o Som e a faixa do painel) e o que o painel faz com cada sinal, do useJitsiDevices. */
  const soundLevelRef = useRef<() => number>(() => 1);
  const devicesSignalRef = useRef<(name: string, payload: unknown) => void>(() => undefined);

  useEffect(() => {
    lobbyRef.current = lobby;
    canSwitchRef.current = input.canSwitchDevice;
    consentEndedRef.current = input.onCameraConsentEnded;
    refusedRef.current = input.onRefused;
    signalsRef.current = signals;
    joinedRef.current = entry === "joined";
  });

  // Quem sai da pagina sai da sala: nenhum sinal atrasado vira queda depois daqui.
  useEffect(() => {
    leavingRef.current = false;
    const timers = timersRef.current;
    return () => {
      leavingRef.current = true;
      timers.forEach((id) => window.clearTimeout(id));
      timers.clear();
    };
  }, []);

  const later = useCallback((callback: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timersRef.current.delete(id);
      callback();
    }, ms);
    timersRef.current.add(id);
  }, []);

  const refuse = useCallback((failure: Exclude<LiveJoinFailure, "error">) => {
    droppingRef.current = false;
    setEntry("idle");
    refusedRef.current(failure);
  }, []);

  const { beacon: beaconQueue, push: pushEvent } = useRoomEventQueue({ enabled: entry !== "idle", onBlocked: refuse, sessionId, webinarId });

  /**
   * Cada montagem do iframe tem 30 s para confirmar a entrada; senao conta como queda. Com a sala de espera ligada (o
   * aluno na fila do iframe, ou voltando de uma queda com a sala trancada), a espera pela equipe nao conta: o prazo
   * recomeca ate a sala de espera desligar ou a equipe admitir (joinTimeoutOutcome).
   */
  const armJoinTimeout = useCallback(() => {
    mountGenerationRef.current += 1;
    const generation = mountGenerationRef.current;
    const check = () => {
      const outcome = joinTimeoutOutcome({
        joined: joinedGenerationRef.current === generation,
        leaving: leavingRef.current,
        lobby: lobbyRef.current,
        sameMount: generation === mountGenerationRef.current
      });
      if (outcome === "wait") {
        later(check, LIVE_ROOM_RULES.joinTimeoutMs);
      } else if (outcome === "drop") {
        droppingRef.current = false;
        dropRef.current();
      }
    };
    later(check, LIVE_ROOM_RULES.joinTimeoutMs);
  }, [later]);

  const scheduleReconnect = useCallback(() => {
    const step = reconnectStep(attemptsRef.current);
    if (step.action === "give_up") {
      droppingRef.current = false;
      setEntry("lost");
      return;
    }
    attemptsRef.current = step.attempt;
    setEntry("reconnecting");
    later(() => {
      if (rejoinedRef.current || leavingRef.current) {
        droppingRef.current = false;
        return;
      }
      postJoinToken(webinarId, sessionId)
        .then((next) => {
          if (leavingRef.current) {
            return;
          }
          // O token mais novo e a sala remontada com ele (o useJitsiMeet le o jwt atual na montagem).
          setReply(next);
          droppingRef.current = false;
          armJoinTimeout();
          retryRef.current();
        })
        .catch((error: unknown) => {
          if (leavingRef.current) {
            return;
          }
          const failure = joinFailureOf(error);
          if (failure !== "error") {
            refuse(failure);
            return;
          }
          // Sem rede: a proxima tentativa (ou "Não conseguimos voltar").
          droppingRef.current = false;
          dropRef.current();
        });
    }, step.delayMs);
  }, [armJoinTimeout, later, refuse, sessionId, webinarId]);

  /** O iframe caiu, saiu sem o aluno sair ou nao confirmou a entrada. */
  const handleDrop = useCallback(() => {
    // Fora da sala: o pedido do microfone acaba (o "ligado" guardado nunca vai, a conferencia para) e nenhum sinal de
    // mudo conta ate o videoConferenceJoined do proximo iframe.
    micAskRef.current = null;
    joinedApiRef.current = null;
    const kind = dropKind({ everJoined: everJoinedRef.current, leaving: leavingRef.current });
    if (kind === "ignore" || droppingRef.current) {
      return;
    }
    if (kind === "open_failed") {
      setEntry("open_failed");
      return;
    }
    droppingRef.current = true;
    rejoinedRef.current = false;
    scheduleReconnect();
  }, [scheduleReconnect]);

  useEffect(() => {
    dropRef.current = handleDrop;
  });

  /** Le quem esta no palco pelo getRoomsInfo (o participantJoined nao traz o papel de quem ja era moderador). */
  const readRoomsInfo = useCallback(() => {
    if (roomsInfoPendingRef.current) {
      return;
    }
    const wait = roomsInfoAtRef.current + LIVE_ROOM_RULES.roomsInfoMs - Date.now();
    roomsInfoPendingRef.current = true;
    later(() => {
      roomsInfoPendingRef.current = false;
      roomsInfoAtRef.current = Date.now();
      const pending = roomsInfoRef.current();
      if (!pending) {
        return;
      }
      void Promise.resolve(pending)
        .then((info) => {
          if (!leavingRef.current) {
            setSignals((previous) => applyRoomsInfo(previous, info, ownIdRef.current));
          }
        })
        .catch(() => undefined);
    }, Math.max(0, wait));
  }, [later]);

  /**
   * Um sinal do iframe na barra e na fila do servidor. `switchKind`: o sinal guardado de uma troca de aparelho que
   * venceu o prazo sem voltar ao estado de antes (vale, mas como nosso: nunca "a equipe silenciou").
   */
  const handleSignal = useCallback(
    (name: string, payload: unknown, switchKind?: DeviceSwitchKind) => {
      // O aceite do aviso de gravacao vai so no primeiro sinal da camera depois dele (webinar_camera_toggled, D4), chegue
      // quando chegar (o pedido de permissao do navegador pode levar mais que o prazo da frase da barra).
      const pending = consentNextVideoRef.current;
      const consent = consentForVideoSignal(pending, name, payload);
      consentNextVideoRef.current = consent.pending;
      if (cameraConsentEndedByError(pending, consent)) {
        // A camera nao ligou (o navegador recusou): o aceite desta abertura sai e o proximo clique abre o aviso de novo.
        consentEndedRef.current();
      }
      const consented = consent.consented;
      pushEvent(toRoomEvent(name, payload, { extra: consented ? { consented: true } : undefined, nowIso: new Date().toISOString(), ownId: ownIdRef.current }));
      if (name === "endpointTextMessageReceived") {
        // "Abaixar a mão" do console: com a mao levantada (lowerHandRequested).
        if (lowerHandRequested(signalsRef.current, payload) && commandRef.current("toggleRaiseHand")) {
          setSignals(toggleHandLocally);
        }
        // A gravacao no navegador do Apresentador (so de quem modera): o selo Gravando na hora.
        const recordingOn = recordingSignalOf(signalsRef.current, payload);
        if (recordingOn !== null) {
          setSignals((previous) => ({ ...previous, recording: recordingOn }));
        }
        return;
      }
      setSignals((previous) => applyLiveSignal(switchKind ? expectDeviceSwitch(previous, switchKind) : previous, { name, ownId: ownIdRef.current, payload }));
      if (name === "videoConferenceLeft" || name === "readyToClose") {
        dropRef.current();
      }
    },
    [pushEvent]
  );

  const onEvent = useCallback(
    (name: JitsiListenedEvent, payload: unknown) => {
      if (leavingRef.current) {
        return;
      }
      // O mudo de um iframe antes da entrada dele (o startWithAudioMuted aplicado na chegada, base/media de falso para
      // verdadeiro): nem a barra, nem o pedido do microfone, nem o servidor (toda entrada ja comeca muda).
      const frame = meetApiRef.current?.current ?? null;
      if ((name === "audioMuteStatusChanged" || name === "videoMuteStatusChanged") && (frame === null || joinedApiRef.current !== frame)) {
        return;
      }
      if (name === "videoConferenceJoined") {
        // Um iframe novo: nenhuma troca de aparelho, toque esperando, pedido do microfone nem faixa de camera do anterior.
        switchesRef.current = { audioInput: null, videoInput: null };
        setGate("audioInput", OPEN_SWITCH_GATE);
        setGate("videoInput", OPEN_SWITCH_GATE);
        micAskRef.current = null;
        cameraTrackRef.current = false;
        joinedApiRef.current = frame;
        const id = field(payload, "id");
        ownIdRef.current = typeof id === "string" ? id : null;
        everJoinedRef.current = true;
        rejoinedRef.current = true;
        attemptsRef.current = 0;
        droppingRef.current = false;
        joinedGenerationRef.current = mountGenerationRef.current;
        setEntry("joined");
      }
      if (name === "participantJoined") {
        // Quem entra depois chega com o volume da sala (o Som desligado zera; a faixa do painel baixa).
        const id = field(payload, "id");
        const level = soundLevelRef.current();
        if (typeof id === "string" && level < 1) {
          commandRef.current("setParticipantVolume", id, level);
        }
      }
      // O painel Configurações: a lista nova (deviceListChanged, a permissao que chegou) e, num iframe novo, o ruido, a
      // qualidade e o desfoque (este quando a camera ligar, uma vez) que o aluno escolheu.
      devicesSignalRef.current(name, payload);
      if (name === "videoConferenceJoined" || name === "participantJoined") {
        readRoomsInfo();
      }
      if (name === "videoMuteStatusChanged" && field(payload, "muted") === false) {
        cameraTrackRef.current = true;
      }
      // A troca de camera do painel em andamento: o mudo da faixa nova fica fora da barra e do servidor.
      for (const kind of DEVICE_SWITCH_KINDS) {
        const step = deviceSwitchStep(switchesRef.current[kind], kind, name, payload, Date.now());
        switchesRef.current[kind] = step.next;
        if (step.swallow) {
          return;
        }
      }
      // O pedido do microfone: o "ligado" espera a faixa abrir (turnMicOn); o mudo o encerra e passa depois dele.
      const ask = micAskStep(micAskRef.current, name, payload);
      micAskRef.current = ask.next;
      if (ask.release !== null) {
        handleSignal("audioMuteStatusChanged", ask.release);
      }
      if (ask.swallow) {
        return;
      }
      handleSignal(name, payload);
    },
    [handleSignal, readRoomsInfo, setGate]
  );

  const configOverwrite = useMemo(() => (reply ? liveConfigOverwrite(reply.role, reply.settings) : {}), [reply]);
  const roomRole = reply?.role ?? null;
  const interfaceConfigOverwrite = useMemo(() => liveInterfaceConfigOverwrite(roomRole), [roomRole]);
  const mountable = allowed && reply !== null && entryInRoom(entry);

  const jitsi = useJitsiMeet({
    configOverwrite,
    container,
    domain: reply?.domain ?? null,
    enabled: mountable,
    interfaceConfigOverwrite,
    jwt: reply?.jwt ?? null,
    nonce,
    onEvent,
    room: reply?.room ?? null
  });

  /**
   * Uma troca de microfone ou de camera, aberta ANTES do set*Device com o estado de agora. O toque em Microfone /
   * Câmera espera ate ela acabar (`done`, chamado pelo hook quando o aparelho escolhido esta em uso, o iframe avisou o
   * erro dela ou o teto venceu) e vai depois. So a da camera abre a janela dos sinais de mudo (startDeviceSwitch):
   * `answered` (o set*Device respondeu) conta o prazo de novo; no fim do prazo, ou quando a troca acaba, a faixa nova que
   * nao voltou ao estado de antes vale como nossa (a barra e o servidor recebem o ultimo sinal dela); uma janela ja
   * fechada (o mudo voltou, o cameraError, outra troca) nao faz nada. A troca do microfone nao manda sinal de mudo nesta
   * tag, e o "silenciar" da equipe logo depois dela chega como da equipe. O alto-falante nao abre nada. Num iframe que
   * ainda nao teve faixa de camera (a volta depois de uma queda, com a camera desligada), o getCurrentDevices da tag diz
   * o escolhido ja na resposta do set*Device (o userSelected, gravado na hora; o cameraDeviceId so nasce com a faixa):
   * a troca da camera so acaba no teto ou no erro (`minMs`), e o toque em Câmera espera a faixa da troca entrar.
   */
  const deviceSwitchStarted = useCallback(
    (kind: DeviceKind): DeviceSwitchHooks | undefined => {
      if (kind !== "audioInput" && kind !== "videoInput") {
        return undefined;
      }
      switchSeqRef.current += 1;
      const id = switchSeqRef.current;
      setGate(kind, gateSwitchStarted(gatesRef.current[kind], id));
      // Sem faixa de camera neste iframe, o getCurrentDevices diz o escolhido antes de a faixa da troca entrar: so o teto.
      const minMs = kind === "videoInput" && !cameraTrackRef.current ? DEVICE_SWITCH_MAX_MS : 0;
      const done = () => {
        if (leavingRef.current) {
          return;
        }
        const settled = deviceSwitchSettled(switchesRef.current[kind], id);
        switchesRef.current[kind] = settled.next;
        if (settled.held !== null) {
          handleSignal(deviceSwitchSignalOf(kind), settled.held, kind);
        }
        const gate = gateSwitchDone(gatesRef.current[kind], id);
        setGate(kind, gate.gate);
        if (gate.send) {
          sendToggleRef.current[kind]();
        }
      };
      if (kind !== "videoInput") {
        return { done, minMs };
      }
      switchesRef.current[kind] = startDeviceSwitch(signalsRef.current, kind, id, Date.now());
      const check = () => {
        const outcome = deviceSwitchCheck(switchesRef.current[kind], id, Date.now());
        if (outcome.action === "wait") {
          later(check, outcome.ms);
          return;
        }
        if (outcome.action === "expire") {
          switchesRef.current[kind] = null;
          if (outcome.held !== null && !leavingRef.current) {
            handleSignal(deviceSwitchSignalOf(kind), outcome.held, kind);
          }
        }
      };
      later(check, LIVE_ROOM_RULES.deviceSwitchMs);
      return {
        answered: () => {
          switchesRef.current[kind] = answerDeviceSwitch(switchesRef.current[kind], id, Date.now());
        },
        done,
        minMs
      };
    },
    [handleSignal, later, setGate]
  );

  const devices = useJitsiDevices({
    antesDeTrocar: deviceSwitchStarted,
    api: jitsi.api,
    // Quem apresenta por esta pagina tem a barra do iframe, que tambem muda ruido, fundo e espelho: sem estado guardado.
    efeitosNoIframe: roomRole === "host" || roomRole === "co_host",
    executeCommand: jitsi.executeCommand,
    joined: entry === "joined",
    nomesReserva: input.deviceNames,
    open: input.settingsOpen,
    outrosParticipantes: () => remoteParticipantIds(signalsRef.current.participants),
    podeTrocar: (kind) => canSwitchRef.current(kind),
    proprioId: () => ownIdRef.current,
    somLigado: () => soundOnRef.current
  });
  const { aoSinal, aplicarNivel, nivel } = devices;

  useEffect(() => {
    meetApiRef.current = jitsi.api;
    commandRef.current = jitsi.executeCommand;
    retryRef.current = jitsi.retry;
    soundLevelRef.current = nivel;
    devicesSignalRef.current = aoSinal;
    roomsInfoRef.current = () => {
      try {
        return jitsi.api.current?.getRoomsInfo?.() ?? null;
      } catch {
        return null;
      }
    };
  });

  // O iframe montado leva o nosso titulo (o leitor de tela le "Vídeo da live", nunca o nome do motor de video).
  useEffect(() => {
    if (jitsi.status === "joining" || jitsi.status === "joined") {
      jitsi.api.current?.getIFrame?.()?.setAttribute("title", frameTitle);
    }
  }, [frameTitle, jitsi.api, jitsi.status]);

  // O iframe falhou (o script nao carregou, erro fatal): queda (ou a abertura falhou). Fora do efeito, no proximo passo.
  useEffect(() => {
    if (jitsi.status !== "failed") {
      return;
    }
    const id = window.setTimeout(() => dropRef.current(), 0);
    return () => window.clearTimeout(id);
  }, [jitsi.status]);

  // O token novo antes do `exp`: guardado sem remontar a sala no ar (vale na proxima montagem).
  const inRoom = entryInRoom(entry);
  useEffect(() => {
    if (!reply || !inRoom) {
      return;
    }
    let stopped = false;
    let id = 0;
    const arm = (delayMs: number) => {
      id = window.setTimeout(() => {
        postJoinToken(webinarId, sessionId)
          .then((next) => {
            if (!stopped) {
              setReply(next);
            }
          })
          .catch((error: unknown) => {
            if (stopped) {
              return;
            }
            const failure = joinFailureOf(error);
            if (failure === "error") {
              arm(LIVE_ROOM_RULES.tokenRetryMs);
            } else {
              refuse(failure);
            }
          });
      }, delayMs);
    };
    arm(tokenRefreshInMs(reply, Date.now()));
    return () => {
      stopped = true;
      window.clearTimeout(id);
    };
  }, [inRoom, refuse, reply, sessionId, webinarId]);

  // Os avisos passageiros da barra somem sozinhos.
  const notice = signals.notice;
  useEffect(() => {
    if (!notice || notice === "mic_released") {
      return;
    }
    const id = window.setTimeout(() => setSignals((previous) => (previous.notice === notice ? { ...previous, notice: null } : previous)), LIVE_ROOM_RULES.noticeMs);
    return () => window.clearTimeout(id);
  }, [notice]);

  const enter = useCallback(() => {
    leavingRef.current = false;
    droppingRef.current = false;
    setEntry("opening");
    postJoinToken(webinarId, sessionId)
      .then((next) => {
        if (leavingRef.current) {
          return;
        }
        setReply(next);
        setEntry("joining");
        armJoinTimeout();
      })
      .catch((error: unknown) => {
        if (leavingRef.current) {
          return;
        }
        const failure = joinFailureOf(error);
        if (failure === "error") {
          setEntry("open_failed");
        } else {
          refuse(failure);
        }
      });
  }, [armJoinTimeout, refuse, sessionId, webinarId]);

  const retryNow = useCallback(() => {
    attemptsRef.current = 0;
    enter();
  }, [enter]);

  const hangUp = useCallback(() => {
    leavingRef.current = true;
    micAskRef.current = null;
    // A saida do proprio aluno vira o sinal de saida da sala (o iframe desmonta antes de avisar) e vai pelo beacon.
    if (joinedRef.current) {
      pushEvent(toRoomEvent("videoConferenceLeft", {}, { nowIso: new Date().toISOString(), ownId: ownIdRef.current }));
    }
    commandRef.current("hangup");
    beaconQueue();
    setEntry("idle");
  }, [beaconQueue, pushEvent]);

  const toggleHand = useCallback(() => {
    if (commandRef.current("toggleRaiseHand")) {
      setSignals(toggleHandLocally);
    }
  }, []);

  /** O isParticipantForceMuted do proprio aluno para o video (a moderacao de video o segura), ou nulo sem resposta. */
  const videoForceMutedNow = useCallback((): Promise<boolean | null> => {
    const current = jitsi.api.current;
    const own = ownIdRef.current;
    if (!current?.isParticipantForceMuted || !own) {
      return Promise.resolve(null);
    }
    return iframeAnswer(() => current.isParticipantForceMuted?.(own, "video"));
  }, [jitsi.api]);

  /** O toque em Câmera que vai ao iframe (sem troca de camera em andamento, ou quando ela acaba). */
  const sendCameraToggle = useCallback(() => {
    // O proprio aluno liga ou desliga: o proximo sinal da camera e deste pedido, nao de uma troca de aparelho.
    switchesRef.current.videoInput = null;
    const turningOn = !signalsRef.current.videoOn;
    setSignals(expectVideoToggle);
    if (commandRef.current("toggleVideo") && turningOn) {
      // Sem resposta do iframe no prazo (o toggleVideo desta tag nao avisa cameraError quando o navegador recusa): a
      // moderacao de video segurando o aluno (a camera dos alunos desligada), a permissao relida negada (camera_denied,
      // e o aceite pendente sai) ou ainda por responder (camera_unanswered: o aceite fica). O prazo cobre o pedido de
      // permissao ainda aberto (30 s); sem a recusa, o aceite fica e vai no proximo sinal da camera, quando vier.
      void mediaPermissionState("camera").then((permission) => {
        later(() => {
          void Promise.all([mediaPermissionState("camera"), videoForceMutedNow()]).then(([answer, forceMuted]) => {
            if (leavingRef.current) {
              return;
            }
            if (cameraConsentEndedByDenial(consentNextVideoRef.current, answer)) {
              consentNextVideoRef.current = false;
              consentEndedRef.current();
            }
            setSignals((previous) => cameraRequestUnanswered(previous, answer, forceMuted));
          });
        }, cameraAnswerDelayMs(permission));
      });
    }
  }, [later, videoForceMutedNow]);

  const toggleCamera = useCallback(
    (consented: boolean) => {
      if (consented) {
        consentNextVideoRef.current = true;
      }
      // Com a troca de camera no meio, o toque espera ela acabar (a tag desfaria o toque quando a faixa nova entrasse).
      const gate = gateToggle(gatesRef.current.videoInput);
      setGate("videoInput", gate.gate);
      if (gate.send) {
        sendCameraToggle();
      }
    },
    [sendCameraToggle, setGate]
  );

  /** O isAudioMuted daquele iframe (falso so com a faixa do microfone aberta), ou nulo sem resposta a tempo. */
  const audioMutedNow = useCallback((api: JitsiMeetApi): Promise<boolean | null> => {
    if (!api.isAudioMuted) {
      return Promise.resolve(null);
    }
    return iframeAnswer(() => api.isAudioMuted?.());
  }, []);

  /**
   * Ligar o microfone (o Falar, ou Microfone com ele desligado). O toggleAudio desta tag marca o microfone "ligado"
   * antes do getUserMedia e nao avisa a falha dele (a permissao do site, a do sistema, o aparelho ocupado ou ausente):
   * entao TODO pedido segura o "ligado" (micAskStep) e a sala confere a faixa daquele iframe e a permissao (micAskCheck),
   * depressa ate o prazo e devagar depois, sem fim, enquanto o pedido durar: a faixa aberta solta o "ligado" para a barra
   * e o servidor; a recusa vira "O navegador bloqueou o microfone…"; o prazo sem a faixa vira o aviso (o pedido do
   * navegador sem resposta, ou o aparelho que nao abriu com a permissao dada), com o microfone desligado na barra e
   * nenhuma linha "ligado". A queda, outro iframe, o mudo, outro toque e a saida encerram o pedido.
   */
  const turnMicOn = useCallback(() => {
    void mediaPermissionState("microphone").then((permission) => {
      if (leavingRef.current) {
        return;
      }
      const api = jitsi.api.current;
      if (!api) {
        return;
      }
      micAskSeqRef.current += 1;
      const id = micAskSeqRef.current;
      const previous = micAskRef.current;
      // O pedido abre ANTES do toggleAudio: o "ligado" que o iframe manda logo em seguida ja fica guardado.
      micAskRef.current = startMicAsk(previous, { api, id, nowMs: Date.now(), permission });
      if (!commandRef.current("toggleAudio")) {
        micAskRef.current = previous;
        return;
      }
      const check = () => {
        void Promise.all([audioMutedNow(api), mediaPermissionState("microphone")]).then(([muted, answer]) => {
          if (leavingRef.current) {
            return;
          }
          const outcome = micAskCheck(micAskRef.current, id, { api: jitsi.api.current, muted, nowMs: Date.now(), permission: answer });
          if (outcome.action === "gone") {
            // Outro pedido, o mudo, a queda ou outro iframe ja o encerraram: a conferencia para.
            return;
          }
          if (outcome.action === "wait") {
            later(check, outcome.ms);
            return;
          }
          if (outcome.action === "late") {
            // O prazo sem a faixa: nada de "ligado" na barra nem no servidor, o aviso, e a conferencia devagar (o
            // getUserMedia continua aberto: o aluno que libera depois liga quando a faixa abrir).
            micAskRef.current = outcome.next;
            setSignals((state) => micRequestUnanswered(state, outcome.notice));
            later(check, LIVE_ROOM_RULES.micLateCheckMs);
            return;
          }
          micAskRef.current = null;
          if (outcome.action === "denied") {
            setSignals(micRequestDenied);
          } else {
            handleSignal("audioMuteStatusChanged", outcome.signal);
          }
        });
      };
      later(check, LIVE_ROOM_RULES.micCheckMs);
    });
  }, [audioMutedNow, handleSignal, jitsi.api, later]);

  const accept = useCallback(() => {
    setSignals(acceptMic);
    turnMicOn();
  }, [turnMicOn]);

  const decline = useCallback(() => setSignals(declineMic), []);

  /** O toque em Microfone que vai ao iframe (sem troca de microfone em andamento, ou quando ela acaba). */
  const sendMicToggle = useCallback(() => {
    setSignals(expectAudioToggle);
    if (signalsRef.current.audioOn) {
      commandRef.current("toggleAudio");
    } else {
      turnMicOn();
    }
  }, [turnMicOn]);

  const toggleMic = useCallback(() => {
    // Com a troca de microfone no meio, o toque espera ela acabar (a tag religaria o microfone quando a faixa nova entrasse).
    const gate = gateToggle(gatesRef.current.audioInput);
    setGate("audioInput", gate.gate);
    if (gate.send) {
      sendMicToggle();
    }
  }, [sendMicToggle, setGate]);

  useEffect(() => {
    sendToggleRef.current = { audioInput: sendMicToggle, videoInput: sendCameraToggle };
  });

  const toggleSound = useCallback(() => {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    // Cada um que esta na sala (o iframe sabe; senao, quem os sinais trouxeram) vai a zero ou volta ao volume da faixa
    // do painel; quem entrar depois ja chega com ele (o ramo participantJoined).
    aplicarNivel(nivel());
  }, [aplicarNivel, nivel]);

  const showNotice = useCallback((value: LiveNotice) => setSignals((previous) => ({ ...previous, notice: value })), []);

  return {
    acceptMic: accept,
    declineMic: decline,
    devices,
    enter,
    entry,
    hangUp,
    jitsiStatus: jitsi.status,
    pendingToggle,
    reply,
    retryNow,
    showNotice,
    signals,
    soundOn,
    toggleCamera,
    toggleHand,
    toggleMic,
    toggleSound
  };
}
