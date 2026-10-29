"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useJitsiMeet, type JitsiStatus } from "@/components/webinars/use-jitsi-meet";
import { liveConfigOverwrite, liveInterfaceConfigOverwrite, toRoomEvent, type JitsiListenedEvent, type RoomEventItem } from "@/lib/jitsi-room-config";
import type { JoinTokenReply } from "@/server/webinars/live-model";
import {
  acceptMic,
  applyLiveSignal,
  applyRoomsInfo,
  cameraAnswerDelayMs,
  cameraRequestUnanswered,
  consentForVideoSignal,
  declineMic,
  dropKind,
  expectAudioToggle,
  expectVideoToggle,
  INITIAL_LIVE_SIGNALS,
  joinFailureOf,
  joinTimeoutOutcome,
  LIVE_ROOM_RULES,
  lowerHandRequested,
  queueRoomEvent,
  reconnectStep,
  recordingSignalOf,
  remoteParticipantIds,
  requeueBatch,
  roomEventsOutcome,
  takeRoomEventBatch,
  toggleHandLocally,
  tokenRefreshInMs,
  type LiveJoinFailure,
  type LiveNotice,
  type LiveSignalState
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
//   videoMuteStatusChanged vai com consented = true), toggleAudio (so depois de liberado e do Falar) e o Som
//   (setParticipantVolume de cada um). Nenhuma frase de tela aqui; nada de texto vai para o servidor.

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

/** A permissao da camera neste navegador (`prompt`, `granted`, `denied`), ou nulo sem como saber. */
async function cameraPermissionState(): Promise<string | null> {
  try {
    const status = await navigator.permissions?.query({ name: "camera" as PermissionName });
    return status?.state ?? null;
  } catch {
    return null;
  }
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
  /** O palco (16:9) onde o iframe entra. */
  container: RefObject<HTMLElement | null>;
  /** O titulo do iframe para o leitor de tela (o nosso, nunca o nome do motor de video: D2). */
  frameTitle: string;
  /** A sala de espera da sala esta ligada (LiveRoomInfo.lobby): a entrada espera a equipe admitir, sem o prazo de 30 s. */
  lobby: boolean;
  nonce: string | null;
  /** O join-token recusou (409 / 503) ou um lote de sinais voltou 409: a sala troca de tela. */
  onRefused: (failure: Exclude<LiveJoinFailure, "error">) => void;
  sessionId: string;
  webinarId: string;
};

export type LiveRoomController = {
  /** Falar: o microfone liga (toggleAudio) e fica na barra. */
  acceptMic: () => void;
  declineMic: () => void;
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

  useEffect(() => {
    lobbyRef.current = lobby;
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

  const onEvent = useCallback(
    (name: JitsiListenedEvent, payload: unknown) => {
      if (leavingRef.current) {
        return;
      }
      if (name === "videoConferenceJoined") {
        const id = field(payload, "id");
        ownIdRef.current = typeof id === "string" ? id : null;
        everJoinedRef.current = true;
        rejoinedRef.current = true;
        attemptsRef.current = 0;
        droppingRef.current = false;
        joinedGenerationRef.current = mountGenerationRef.current;
        setEntry("joined");
      }
      if (name === "participantJoined" && !soundOnRef.current) {
        const id = field(payload, "id");
        if (typeof id === "string") {
          commandRef.current("setParticipantVolume", id, 0);
        }
      }
      if (name === "videoConferenceJoined" || name === "participantJoined") {
        readRoomsInfo();
      }
      // O aceite do aviso de gravacao vai so no primeiro sinal da camera depois dele (webinar_camera_toggled, D4), chegue
      // quando chegar (o pedido de permissao do navegador pode levar mais que o prazo da frase da barra).
      const consent = consentForVideoSignal(consentNextVideoRef.current, name, payload);
      consentNextVideoRef.current = consent.pending;
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
      setSignals((previous) => applyLiveSignal(previous, { name, ownId: ownIdRef.current, payload }));
      if (name === "videoConferenceLeft" || name === "readyToClose") {
        dropRef.current();
      }
    },
    [pushEvent, readRoomsInfo]
  );

  const configOverwrite = useMemo(() => (reply ? liveConfigOverwrite(reply.role, reply.settings) : {}), [reply]);
  const interfaceConfigOverwrite = useMemo(() => liveInterfaceConfigOverwrite(), []);
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

  useEffect(() => {
    commandRef.current = jitsi.executeCommand;
    retryRef.current = jitsi.retry;
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

  const toggleCamera = useCallback(
    (consented: boolean) => {
      if (consented) {
        consentNextVideoRef.current = true;
      }
      const turningOn = !signalsRef.current.videoOn;
      setSignals(expectVideoToggle);
      if (commandRef.current("toggleVideo") && turningOn) {
        // Sem resposta do iframe, a moderacao de video recusou: a barra avisa. O prazo cobre o pedido de permissao do
        // navegador ainda aberto (30 s) e nunca mexe no aceite: ele vai no proximo sinal da camera, quando vier.
        void cameraPermissionState().then((permission) => {
          later(() => setSignals(cameraRequestUnanswered), cameraAnswerDelayMs(permission));
        });
      }
    },
    [later]
  );

  const accept = useCallback(() => {
    setSignals(acceptMic);
    commandRef.current("toggleAudio");
  }, []);

  const decline = useCallback(() => setSignals(declineMic), []);

  const toggleMic = useCallback(() => {
    setSignals(expectAudioToggle);
    commandRef.current("toggleAudio");
  }, []);

  const toggleSound = useCallback(() => {
    const next = !soundOnRef.current;
    soundOnRef.current = next;
    setSoundOn(next);
    // Cada um que esta na sala (o iframe sabe; senao, quem os sinais trouxeram); quem entrar depois ja chega mudo.
    const info = jitsi.api.current?.getParticipantsInfo?.() ?? [];
    const fromApi = info.map((item) => field(item, "participantId")).filter((id): id is string => typeof id === "string");
    const ids = fromApi.length > 0 ? fromApi : remoteParticipantIds(signalsRef.current.participants);
    ids.filter((id) => id !== ownIdRef.current).forEach((id) => commandRef.current("setParticipantVolume", id, next ? 1 : 0));
  }, [jitsi.api]);

  const showNotice = useCallback((value: LiveNotice) => setSignals((previous) => ({ ...previous, notice: value })), []);

  return {
    acceptMic: accept,
    declineMic: decline,
    enter,
    entry,
    hangUp,
    jitsiStatus: jitsi.status,
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
