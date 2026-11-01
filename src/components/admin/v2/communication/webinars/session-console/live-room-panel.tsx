"use client";

import { Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type Dispatch, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { useJitsiDevices, type UseJitsiDevices } from "@/components/webinars/use-jitsi-devices";
import { onStageParticipantOf } from "@/components/member/webinars/room/live-room-model";
import { useJitsiMeet, type JitsiMeetApi, type JitsiStatus } from "@/components/webinars/use-jitsi-meet";
import { deviceEnvironmentOf, deviceSectionReady, deviceSettingsFor, type DeviceKind, type DeviceOption, type DeviceSettings } from "@/lib/jitsi-device-settings";
import { CONSOLE_EXTRA_EVENTS, JITSI_LISTENED_EVENTS, liveConfigOverwrite, liveInterfaceConfigOverwrite, tokenRefreshDelayMs, type ConsoleListenedEvent, type LiveEmbedLook } from "@/lib/jitsi-room-config";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { ConsoleWebinar } from "@/server/webinars/console-queries";
import {
  CONSOLE_ROOM_RULES,
  EMPTY_ROOM,
  browserRecordingChange,
  consoleFilmstripPendingAfter,
  consoleFilmstripShouldToggle,
  consoleRoomRole,
  desiredLobby,
  liveControlsFor,
  liveRoomReducer,
  lobbyNotice,
  presenterSetupCommands,
  recordingSignalMessage,
  rolesToRead,
  screenSharesToStop,
  sharingIdsOf,
  shouldAutoStartRecording,
  shouldEnterRoom,
  shouldMarkAnchor,
  type ConsoleRoomRole,
  type LiveConsoleSnapshot,
  type LiveControls,
  type LiveRoomAction,
  type LiveRoomState
} from "@/server/webinars/live-console-model";
import type { JoinTokenReply } from "@/server/webinars/live-model";
import type { WebinarSession } from "@/server/webinars/model";
import { LIVE_SETTINGS_CARD_ID, LiveSettingsCard } from "./live-settings-card";

// A sala da Live ao vivo no console (docs/30 §1.4, §2.4, §6.3, §6.4 e §8.1; fase 3): o hook useLiveRoom pede o token
// (POST /api/webinars/[id]/join-token, o mesmo do aluno: o papel vem do servidor), monta o iframe pelo useJitsiMeet
// (configOverwrite do papel, nonce da pagina), renova o token antes do `exp` sem derrubar a sala, junta os sinais do
// iframe num reducer (quem esta, maos, sala de espera, gravacao), e faz sozinho o que a sala precisa de quem a
// comanda: ao virar moderador, a sala de espera certa (Sessao de pratica, Sala de espera, tranca), a moderacao de audio
// (o aluno so fala depois de Liberar), a de video quando o webinario nao tem camera de aluno e o "seguir a visao do
// apresentador" (a de tela nao liga pelo IFrame API da tag: docs/31 §5.4); o "Gravar" da fila dispara uma vez no ready; a ancora sai no recordingStatusChanged ligado (uma vez).
// O vigia da tela (docs/31 §5.4): o console escuta tambem CONSOLE_EXTRA_EVENTS (quem compartilha a tela), le os papeis
// pelo getRoomsInfo (quem ja era moderador quando o console entrou nunca gera participantRoleChanged) e, no navegador de
// quem apresenta e modera, manda muteRemoteParticipant(id, 'desktop') a quem compartilha com papel conhecido de
// participante e sem liberacao (screenSharesToStop), uma vez por id ate ele parar. Nunca rejectParticipant nem
// muteEveryone de tela: o primeiro recusaria o audio, o segundo pegaria o co-apresentador. Para o cliente padrao; um
// cliente modificado que ignora o pedido de mudo continua mandando a tela (docs/31 §7).
// Quem apresenta (host e co-apresentador) ganha o card Configurações (live-settings-card.tsx): os aparelhos pelo hook
// useJitsiDevices, com as secoes de deviceSettingsFor do papel da sala (nunca a Qualidade do vídeo: setVideoQuality
// mudaria o envio do palco) e o ruido, o fundo e o espelho como acoes sem estado (efeitosNoIframe: a barra do iframe
// tambem os muda); a Equipe no console nao tem barra de midia (docs/30 §1.4, pendencia).
// O tema do console (docs/31 V2-12) entra no iframe pelo `look` so na montagem, como na sala do aluno: o
// configOverwrite e o interfaceConfigOverwrite mudam com ele, mas o useJitsiMeet nao remonta por isso.
// O palco (docs/31 V2-4, V2-13 e V2-A5; console-stage.tsx) le daqui o que o motor mostra: o Palco ou a Grade
// (tileViewChanged), a coluna de miniaturas (filmstripDisplayChanged) e quem esta no video grande (o largeVideoChanged
// chega sem dados: o id vem de onStageParticipantOf, a acao `onStage`). O primeiro sinal de um iframe novo (Tentar de
// novo, Entrar na sala) volta isso ao padrao do motor (a acao `frame`); o syncFilmstrip manda um toggleFilmStrip por
// vez, so quando o que o palco quer difere do que o motor mostra (consoleFilmstripShouldToggle), e o
// filmstripDisplayChanged, a entrada e o iframe novo soltam o que esperava (consoleFilmstripPendingAfter), como na sala
// do aluno.
// Ate a barra de quem apresenta (G6), o botao Configurações fica provisorio ao lado dos controles embaixo do palco
// (LiveSettingsToggle), com o card logo depois dele, e a frase da sala de espera fica entre o palco e os controles
// (LiveLobbyNotice). Nenhum texto cita o motor da sala.

const copy = WEBINAR_COPY.consoleAoVivo;
const ANCHOR_RETRIES = 3;
const ANCHOR_RETRY_MS = 2_000;
/** Os sinais do iframe do console: os da sala e os que so o console usa (quem compartilha a tela). */
const CONSOLE_EVENTS: readonly ConsoleListenedEvent[] = [...JITSI_LISTENED_EVENTS, ...CONSOLE_EXTRA_EVENTS];
/** A tela liberada pela equipe (docs/31 §5.3): ninguem ainda; a liberacao entra com o resto do §5.3. */
const NO_SCREEN_GRANTS: readonly string[] = [];

/** Os nomes dos aparelhos que o navegador ainda nao nomeou ("Microfone 1"), os mesmos da sala do aluno. */
const DEVICE_NAMES: Record<DeviceKind, (position: number) => string> = {
  audioInput: WEBINAR_COPY.aoVivo.config.reserva.microfone,
  audioOutput: WEBINAR_COPY.aoVivo.config.reserva.altoFalante,
  videoInput: WEBINAR_COPY.aoVivo.config.reserva.camera
};

function subscribeNothing() {
  return () => undefined;
}

function deviceEnvironment() {
  return deviceEnvironmentOf({ maxTouchPoints: navigator.maxTouchPoints, userAgent: navigator.userAgent });
}

/** iPhone / iPad (o card nao tem a faixa de volume, mas o modelo pede). */
function readIOS() {
  try {
    return deviceEnvironment().isIOS;
  } catch {
    return false;
  }
}

/** Celular: sem Desfocar o fundo e sem Mais opções de fundo (o efeito nao roda la). */
function readMobile() {
  try {
    return deviceEnvironment().isMobile;
  } catch {
    return false;
  }
}

function presents(role: ConsoleRoomRole): boolean {
  return role === "host" || role === "co_host";
}

type TokenState = { error: "failed" | "meet_unconfigured" | null; reply: JoinTokenReply | null };

export type LiveRoomHandle = {
  /** Os botoes de cada papel (live-console-model.liveControlsFor). */
  controls: LiveControls;
  /** As cameras dos alunos estao liberadas (moderacao de video desligada). */
  camerasAllowed: boolean;
  /** Troca o aparelho quando a secao do card esta pronta (so quem apresenta, dentro da sala); falso quando nao trocou. */
  chooseDevice: (kind: DeviceKind, option: DeviceOption) => boolean;
  /** Manda um comando ao iframe; falso sem sala montada. */
  command: (name: string, ...args: unknown[]) => boolean;
  /** As secoes do card Configurações (deviceSettingsFor com o papel da sala; nunca a Qualidade do vídeo). */
  deviceSettings: DeviceSettings;
  /** Os aparelhos, o ruido, o fundo e o espelho de quem apresenta (useJitsiDevices: os metodos da api do iframe). */
  devices: UseJitsiDevices;
  dispatch: Dispatch<LiveRoomAction>;
  frameStatus: JitsiStatus;
  joined: boolean;
  /** A sala de espera que a situacao pede agora (o que o console manda com toggleLobby). */
  lobby: boolean;
  meetConfigured: boolean;
  retry: () => void;
  role: ConsoleRoomRole;
  room: LiveRoomState;
  setCamerasAllowed: (allowed: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  /** O card Configurações aberto (os aparelhos sao relidos ao abrir). */
  settingsOpen: boolean;
  /** A propria camera no ar (videoMuteStatusChanged), dentro da sala. */
  videoOn: boolean;
  startTesting: () => void;
  /**
   * A coluna de miniaturas pela largura (o co-apresentador e a Equipe, consoleColumnPolicy): o toggleFilmStrip so quando
   * o que o palco quer difere do que o motor mostra (filmstripStep) e um por vez (o seguinte espera a resposta do motor:
   * o comando inverte a coluna, dois seguidos a deixariam como estava).
   */
  syncFilmstrip: (input: { visible: boolean; wanted: boolean }) => void;
  /** Liga ou desliga a sala de espera agora (so manda quando muda). */
  syncLobby: (value: boolean) => void;
  testing: boolean;
  tokenError: TokenState["error"];
};

type UseLiveRoomInput = {
  canPublish: boolean;
  /** Onde o iframe entra (o palco do ConsoleStage, console-stage.tsx). */
  container: RefObject<HTMLDivElement | null>;
  currentUserId: string;
  /** Falso fora da Live ao vivo: nada e pedido nem montado. */
  enabled: boolean;
  live: LiveConsoleSnapshot | null;
  /** O tema do console (e o Palco), levado ao iframe na montagem. */
  look: LiveEmbedLook;
  nonce?: string | null;
  /** A ancora (markRecordingAnchor); devolve se deu certo. */
  onAnchor: () => Promise<boolean>;
  /** A reserva "Gravar no navegador" ligou ou desligou (setBrowserRecording: o selo Gravando do aluno). */
  onBrowserRecording?: (on: boolean) => void;
  session: WebinarSession | null;
  webinar: Pick<ConsoleWebinar, "allowStudentCamera" | "hostUserId" | "id" | "practiceSession" | "waitingRoom">;
};

async function fetchJoinToken(webinarId: string, sessionId: string): Promise<TokenState> {
  try {
    const response = await fetch(`/api/webinars/${encodeURIComponent(webinarId)}/join-token`, {
      body: JSON.stringify({ sessionId }),
      cache: "no-store",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const body = (await response.json().catch(() => null)) as { data?: JoinTokenReply; reason?: string } | null;
    if (response.ok && body?.data?.jwt) {
      return { error: null, reply: body.data };
    }
    return { error: response.status === 503 || body?.reason === "meet_unconfigured" ? "meet_unconfigured" : "failed", reply: null };
  } catch {
    return { error: "failed", reply: null };
  }
}

export function useLiveRoom(input: UseLiveRoomInput): LiveRoomHandle {
  const { container, enabled, live, look, session, webinar } = input;
  const [testing, setTesting] = useState(false);
  const [token, setToken] = useState<TokenState>({ error: null, reply: null });
  // "Tentar de novo" sem token (o primeiro pedido falhou): pede outro.
  const [tokenAttempt, setTokenAttempt] = useState(0);
  const [room, dispatch] = useReducer(liveRoomReducer, EMPTY_ROOM);
  const [camerasAllowed, setCamerasAllowedState] = useState(webinar.allowStudentCamera !== false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** A propria camera no ar (videoMuteStatusChanged): o Desfocar o fundo so vale com o video ligado. */
  const [videoOn, setVideoOn] = useState(false);
  const lobbySent = useRef<boolean | null>(null);
  const setupDone = useRef(false);
  const anchorMarked = useRef(false);
  const autoStartedFor = useRef<string | null>(null);
  const latest = useRef(input);
  const commandRef = useRef<(name: string, ...args: unknown[]) => boolean>(() => false);
  /** O que o card Configurações faz com cada sinal (o aoSinal do useJitsiDevices) e o que ele le na hora da troca. */
  const devicesSignalRef = useRef<(name: string, payload: unknown) => void>(() => undefined);
  const deviceSettingsRef = useRef<DeviceSettings | null>(null);
  const roomRef = useRef(room);
  /** O IFrame API montado agora (o `api` do useJitsiMeet): o getRoomsInfo e pedido a ele, e a resposta so vale dele. */
  const frameRef = useRef<RefObject<JitsiMeetApi | null> | null>(null);
  /** O getRoomsInfo no maximo uma vez a cada CONSOLE_ROOM_RULES.roomsInfoMs: a hora do ultimo e o pedido que espera. */
  const roomsInfoAtRef = useRef(0);
  const roomsInfoTimerRef = useRef<number | null>(null);
  /** Quantas vezes o console saiu da sala: a resposta de um getRoomsInfo pedido antes da saida nao vale. */
  const leftCountRef = useRef(0);
  /** Quem ja recebeu o pedido de parar a tela, ate sair de `sharing` (o vigia nao repete o mesmo pedido). */
  const stoppedRef = useRef(new Set<string>());
  /** O iframe do ultimo sinal: o primeiro sinal de um iframe novo volta a visao e a coluna ao padrao do motor. */
  const signalFrameRef = useRef<JitsiMeetApi | null>(null);
  /** O `filmstripVisible` de quando o ultimo toggleFilmStrip saiu (nulo: nenhum esperando a resposta do motor). */
  const filmstripSentRef = useRef<boolean | null>(null);
  const sessionId = session?.id ?? null;
  const status = session?.status ?? "scheduled";
  const meetConfigured = enabled && live?.meetConfigured === true && token.error !== "meet_unconfigured";
  const wantsRoom = enabled && sessionId !== null && shouldEnterRoom({ meetConfigured, status, testing });
  const role = consoleRoomRole({ currentUserId: input.currentUserId, hostUserId: webinar.hostUserId, tokenRole: token.reply?.role });
  const controls = liveControlsFor({ canPublish: input.canPublish, moderator: room.moderator, role });
  const presenter = presents(role);
  const isIOS = useSyncExternalStore(subscribeNothing, readIOS, () => false);
  const isMobile = useSyncExternalStore(subscribeNothing, readMobile, () => false);

  useEffect(() => {
    latest.current = input;
  });

  // O token: pedido ao entrar e de novo antes do `exp` (o novo nao remonta a sala no ar).
  useEffect(() => {
    if (!wantsRoom || !sessionId) {
      return;
    }
    let stopped = false;
    let timer: number | null = null;

    const load = async () => {
      const next = await fetchJoinToken(webinar.id, sessionId);
      if (stopped) {
        return;
      }
      setToken((current) => (next.reply ? next : { error: next.error, reply: current.reply }));
      const expiresAt = next.reply?.expiresAt;
      timer = window.setTimeout(() => void load(), expiresAt ? tokenRefreshDelayMs(expiresAt, Date.now()) : 30_000);
    };

    void load();

    return () => {
      stopped = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [sessionId, tokenAttempt, wantsRoom, webinar.id]);

  const configOverwrite = useMemo(() => (token.reply ? liveConfigOverwrite(token.reply.role, token.reply.settings, look) : {}), [token.reply, look]);
  // Quem apresenta abre a engrenagem do iframe so na aba de aparelhos (o papel vem do join-token).
  const tokenRole = token.reply?.role ?? null;
  const interfaceConfigOverwrite = useMemo(() => liveInterfaceConfigOverwrite(tokenRole, look), [tokenRole, look]);

  const markAnchor = useCallback(async () => {
    for (let attempt = 0; attempt < ANCHOR_RETRIES; attempt += 1) {
      if (await latest.current.onAnchor()) {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, ANCHOR_RETRY_MS));
    }
    anchorMarked.current = false;
  }, []);

  /**
   * Le os papeis pelo getRoomsInfo (quem ja moderava quando o console entrou so aparece ali), no maximo uma vez a cada
   * CONSOLE_ROOM_RULES.roomsInfoMs, como a sala do aluno. A resposta so vale do iframe em que foi pedida (o mesmo
   * `api.current`) e sem saida da sala desde o agendamento: a saida cancela o pedido que espera (no onEvent), e a
   * contagem lida aqui, na hora de agendar, descarta o que ja estava a caminho.
   */
  const readRoomsInfo = useCallback(() => {
    if (roomsInfoTimerRef.current !== null) {
      return;
    }
    const wait = Math.max(0, roomsInfoAtRef.current + CONSOLE_ROOM_RULES.roomsInfoMs - Date.now());
    const leftCount = leftCountRef.current;
    roomsInfoTimerRef.current = window.setTimeout(() => {
      roomsInfoTimerRef.current = null;
      if (leftCountRef.current !== leftCount) {
        return;
      }
      roomsInfoAtRef.current = Date.now();
      const asked = frameRef.current?.current ?? null;
      let pending: Promise<unknown> | undefined;
      try {
        pending = asked?.getRoomsInfo?.();
      } catch {
        pending = undefined;
      }
      if (!asked || !pending) {
        return;
      }
      void Promise.resolve(pending)
        .then((info) => {
          if (frameRef.current?.current === asked && leftCountRef.current === leftCount) {
            dispatch({ info, type: "roomsInfo" });
          }
        })
        .catch(() => undefined);
    }, wait);
  }, []);

  useEffect(
    () => () => {
      if (roomsInfoTimerRef.current !== null) {
        window.clearTimeout(roomsInfoTimerRef.current);
        roomsInfoTimerRef.current = null;
      }
    },
    []
  );

  const onEvent = useCallback(
    (name: ConsoleListenedEvent, payload: unknown) => {
      const frame = frameRef.current?.current ?? null;
      const newFrame = frame !== null && frame !== signalFrameRef.current;
      if (newFrame) {
        // O primeiro sinal de um iframe novo: o motor dele comeca no Palco, com a coluna (inclusive o seguir a visao que
        // chega antes do videoConferenceJoined parte dai).
        signalFrameRef.current = frame;
        dispatch({ type: "frame" });
      }
      // O motor respondeu ao toggleFilmStrip (ou a coluna mudou por outra causa), a entrada ou um iframe novo: nenhum
      // espera, e a conta da coluna pode mandar o proximo.
      filmstripSentRef.current = consoleFilmstripPendingAfter({ name, newFrame, pending: filmstripSentRef.current });
      if (name === "largeVideoChanged") {
        // O motor manda sem dados: o id de quem esta no video grande fica no IFrame API.
        dispatch({ id: onStageParticipantOf(frame), type: "onStage" });
      } else {
        dispatch({ name, nowMs: Date.now(), payload, type: "event" });
      }
      if (name === "videoConferenceLeft" || name === "readyToClose") {
        setupDone.current = false;
        lobbySent.current = null;
        leftCountRef.current += 1;
        // O getRoomsInfo agendado antes da saida nao sai: o iframe que saiu ainda responde, com o proprio console, e a
        // sala vazia (sem selfId) nao saberia tira-lo.
        if (roomsInfoTimerRef.current !== null) {
          window.clearTimeout(roomsInfoTimerRef.current);
          roomsInfoTimerRef.current = null;
        }
        setVideoOn(false);
      }
      // Os papeis de quem ja estava (o participantJoined nao traz o papel) e de quem compartilha sem papel lido.
      if (name === "videoConferenceJoined" || name === "participantJoined") {
        readRoomsInfo();
      } else if (name === "contentSharingParticipantsChanged" && rolesToRead({ roles: roomRef.current.roles, selfId: roomRef.current.selfId, sharing: sharingIdsOf(payload) }).length > 0) {
        readRoomsInfo();
      }
      if (name === "videoMuteStatusChanged") {
        const muted = payload && typeof payload === "object" ? (payload as { muted?: unknown }).muted : undefined;
        setVideoOn(muted === false);
      }
      // O card Configurações: a lista nova (deviceListChanged, um fone que entrou), o ruido de volta numa entrada nova
      // e o desfoque de volta na camera que liga.
      devicesSignalRef.current(name, payload);
      if (name === "recordingStatusChanged" && shouldMarkAnchor({ alreadyMarked: anchorMarked.current, anchorAt: latest.current.live?.recorder.anchorAt ?? null, payload, role })) {
        anchorMarked.current = true;
        void markAnchor();
      }
      // A gravacao no navegador so avisa este navegador: a sessao guarda (o selo do aluno na proxima leitura) e o sinal
      // vai a todos agora.
      const browserRecording = name === "recordingStatusChanged" ? browserRecordingChange({ payload, role }) : null;
      if (browserRecording !== null) {
        latest.current.onBrowserRecording?.(browserRecording);
        commandRef.current("sendEndpointTextMessage", "", recordingSignalMessage(browserRecording));
      }
    },
    [markAnchor, readRoomsInfo, role]
  );

  const meet = useJitsiMeet({
    configOverwrite,
    container,
    domain: token.reply?.domain ?? null,
    enabled: wantsRoom,
    events: CONSOLE_EVENTS,
    interfaceConfigOverwrite,
    jwt: token.reply?.jwt ?? null,
    nonce: input.nonce ?? null,
    onEvent,
    room: token.reply?.room ?? null
  });
  const joined = meet.status === "joined";
  const command = meet.executeCommand;
  const api = meet.api;

  const devices = useJitsiDevices({
    api,
    // Quem apresenta tambem muda ruido, fundo e espelho pela barra do iframe: o hook so manda o comando, sem guardar
    // estado nem reaplicar nada por cima da escolha feita la.
    efeitosNoIframe: true,
    executeCommand: command,
    joined,
    nomesReserva: DEVICE_NAMES,
    open: settingsOpen,
    outrosParticipantes: () => roomRef.current.people.map((person) => person.id),
    // So quem apresenta troca, e so com a secao pronta (a sala no ar).
    podeTrocar: (kind) => deviceSettingsRef.current !== null && deviceSectionReady(deviceSettingsRef.current, kind),
    proprioId: () => roomRef.current.selfId,
    somLigado: () => true
  });

  // Quem apresenta entra sem disableInitialGUM (o navegador pede a permissao na entrada): microfone e camera ficam
  // prontos com a sala no ar; o Falar e o aviso de gravacao (D4) sao do aluno.
  const deviceSettings = deviceSettingsFor({
    allowStudentCamera: webinar.allowStudentCamera !== false,
    cameraConsented: false,
    isIOS,
    isMobile,
    joined,
    micAllowed: false,
    outputChangeAvailable: devices.outputChangeAvailable,
    outputs: devices.lists.audioOutput,
    role,
    videoOn: joined && videoOn
  });

  useEffect(() => {
    commandRef.current = command;
    devicesSignalRef.current = devices.aoSinal;
    deviceSettingsRef.current = presenter ? deviceSettings : null;
    roomRef.current = room;
    frameRef.current = api;
  });

  // Quem ja estava na sala quando o console entrou (alem dos participantJoined).
  useEffect(() => {
    if (joined) {
      dispatch({ people: api.current?.getParticipantsInfo?.() ?? [], type: "seed" });
    }
  }, [api, joined]);

  const syncLobby = useCallback(
    (value: boolean) => {
      if (lobbySent.current === value) {
        return;
      }
      if (command("toggleLobby", value)) {
        lobbySent.current = value;
      }
    },
    [command]
  );

  const wantedLobby = desiredLobby({ practiceSession: webinar.practiceSession !== false, roomLocked: live?.roomLocked === true, status, waitingRoom: webinar.waitingRoom === true });

  // Ao virar moderador: moderacao de audio (o aluno so fala depois de Liberar), de video sem camera de aluno e seguir a
  // visao do apresentador (so o Apresentador), pelo presenterSetupCommands; a sala de espera da situacao vem no efeito
  // do toggleLobby. Nada de moderacao de tela: ela nao liga pelo IFrame API da tag (docs/31 §5.4).
  useEffect(() => {
    if (!joined || !room.moderator || !presenter || setupDone.current) {
      return;
    }
    setupDone.current = true;
    for (const [name, ...args] of presenterSetupCommands({ allowStudentCamera: webinar.allowStudentCamera !== false, role })) {
      command(name, ...args);
    }
  }, [command, joined, presenter, role, room.moderator, webinar.allowStudentCamera]);

  // O vigia da tela: quem compartilha com papel conhecido de participante e sem liberacao tem a tela parada, uma vez por
  // id ate sair de `sharing` (so o navegador de quem apresenta e modera: o comando exige moderador).
  useEffect(() => {
    const stopped = stoppedRef.current;
    for (const id of Array.from(stopped)) {
      if (!room.sharing.includes(id)) {
        stopped.delete(id);
      }
    }
    if (!joined || !room.moderator || !presenter) {
      return;
    }
    for (const id of screenSharesToStop({ grants: NO_SCREEN_GRANTS, justGranted: NO_SCREEN_GRANTS, roles: room.roles, selfId: room.selfId, sharing: room.sharing })) {
      if (!stopped.has(id) && command("muteRemoteParticipant", id, "desktop")) {
        stopped.add(id);
      }
    }
  }, [command, joined, presenter, room.moderator, room.roles, room.selfId, room.sharing]);

  // A sala de espera segue a situacao (Sessao de pratica, Comecar para todos, tranca, Sala de espera).
  useEffect(() => {
    if (joined && room.moderator && presenter) {
      syncLobby(wantedLobby);
    }
  }, [joined, presenter, room.moderator, syncLobby, wantedLobby]);

  // O "Gravar" da fila: a maquina ficou pronta, o navegador do Apresentador grava sozinho (uma vez por pedido).
  const recorder = live?.recorder;
  useEffect(() => {
    if (
      recorder &&
      shouldAutoStartRecording({
        firedFor: autoStartedFor.current,
        joined,
        recorderStatus: recorder.status,
        recording: room.recording.on,
        recordingRequestedAt: recorder.recordingRequestedAt,
        role
      }) &&
      command("startRecording", { mode: "file" })
    ) {
      autoStartedFor.current = recorder.recordingRequestedAt;
    }
  }, [command, joined, recorder, role, room.recording.on]);

  const meetRetry = meet.retry;
  const hasToken = token.reply !== null;
  const retry = useCallback(() => (hasToken ? meetRetry() : setTokenAttempt((attempt) => attempt + 1)), [hasToken, meetRetry]);

  const setCamerasAllowed = useCallback(
    (allowed: boolean) => {
      if (command("toggleModeration", !allowed, "video")) {
        setCamerasAllowedState(allowed);
      }
    },
    [command]
  );

  const syncFilmstrip = useCallback(
    (step: { visible: boolean; wanted: boolean }) => {
      if (!consoleFilmstripShouldToggle({ pending: filmstripSentRef.current, visible: step.visible, wanted: step.wanted })) {
        return;
      }
      if (command("toggleFilmStrip")) {
        filmstripSentRef.current = step.visible;
      }
    },
    [command]
  );

  const escolher = devices.escolher;
  const chooseDevice = (kind: DeviceKind, option: DeviceOption) => presenter && deviceSectionReady(deviceSettings, kind) && escolher(kind, option);

  return {
    camerasAllowed,
    chooseDevice,
    command,
    controls,
    deviceSettings,
    devices,
    dispatch,
    frameStatus: meet.status,
    joined,
    lobby: wantedLobby,
    meetConfigured,
    retry,
    role,
    room,
    setCamerasAllowed,
    setSettingsOpen,
    settingsOpen,
    startTesting: () => setTesting(true),
    syncFilmstrip,
    syncLobby,
    testing,
    videoOn: joined && videoOn,
    tokenError: token.error
  };
}

/**
 * O botao Configurações de quem apresenta (o Apresentador e o co-apresentador, com a sala configurada), provisorio ao
 * lado dos controles embaixo do palco ate a barra de quem apresenta (G6), com o card logo depois dele: no teclado, o
 * Tab do botao entra no card. Fechar pelo proprio botao manda o foco a ele antes de o card sumir (o WebKit nao foca o
 * botao no clique).
 */
export function LiveSettingsToggle({ handle }: { handle: LiveRoomHandle }) {
  const settingsButton = useRef<HTMLButtonElement | null>(null);
  if (!presents(handle.role) || !handle.meetConfigured) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-3" data-live-settings-toggle="">
      <Button
        aria-controls={LIVE_SETTINGS_CARD_ID}
        aria-expanded={handle.settingsOpen}
        className="px-3"
        onClick={() => {
          if (handle.settingsOpen) {
            settingsButton.current?.focus();
          }
          handle.setSettingsOpen(!handle.settingsOpen);
        }}
        ref={settingsButton}
        type="button"
        variant="secondary"
      >
        <Settings2 aria-hidden="true" className="size-4" />
        {copy.configuracoes}
      </Button>
      {handle.settingsOpen ? (
        <div className="w-full min-w-0">
          <LiveSettingsCard
            cameraOn={handle.videoOn}
            devices={handle.devices}
            onChoose={handle.chooseDevice}
            onClose={() => {
              settingsButton.current?.focus();
              handle.setSettingsOpen(false);
            }}
            sections={handle.deviceSettings}
          />
        </div>
      ) : null}
    </div>
  );
}

/** A frase da sala de espera, da tranca e da Sessão de prática (lobbyNotice), entre o palco e os controles. */
export function LiveLobbyNotice({ handle, live, session }: { handle: Pick<LiveRoomHandle, "lobby">; live: Pick<LiveConsoleSnapshot, "roomLocked">; session: Pick<WebinarSession, "status"> }) {
  const notice = lobbyNotice({ lobby: handle.lobby, roomLocked: live.roomLocked, status: session.status });
  if (!notice) {
    return null;
  }

  return (
    <p className={cn("shrink-0 text-[13px] leading-5", live.roomLocked ? "text-[var(--warning)]" : "text-[var(--text-secondary)]")} data-live-notice="">
      {notice}
    </p>
  );
}
