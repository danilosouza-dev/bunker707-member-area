"use client";

import { DoorOpen, LogIn, RefreshCw, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { useJitsiDevices, type UseJitsiDevices } from "@/components/webinars/use-jitsi-devices";
import { useJitsiMeet, type JitsiStatus } from "@/components/webinars/use-jitsi-meet";
import { deviceEnvironmentOf, deviceSectionReady, deviceSettingsFor, type DeviceKind, type DeviceOption, type DeviceSettings } from "@/lib/jitsi-device-settings";
import { liveConfigOverwrite, liveInterfaceConfigOverwrite, tokenRefreshDelayMs, type JitsiListenedEvent } from "@/lib/jitsi-room-config";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { ConsoleWebinar } from "@/server/webinars/console-queries";
import {
  EMPTY_ROOM,
  LIVE_CONSOLE_COPY,
  browserRecordingChange,
  consoleRoomRole,
  desiredLobby,
  liveControlsFor,
  liveRoomReducer,
  lobbyNotice,
  presenterSetupCommands,
  recordingSignalMessage,
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
import { SectionCard } from "../../../settings/kit";
import { StatusChip } from "../../../status-chip";
import { LIVE_SETTINGS_CARD_ID, LiveSettingsCard } from "./live-settings-card";

// A sala da Live ao vivo no console (docs/30 §1.4, §2.4, §6.3, §6.4 e §8.1; fase 3): o hook useLiveRoom pede o token
// (POST /api/webinars/[id]/join-token, o mesmo do aluno: o papel vem do servidor), monta o iframe pelo useJitsiMeet
// (configOverwrite do papel, nonce da pagina), renova o token antes do `exp` sem derrubar a sala, junta os sinais do
// iframe num reducer (quem esta, maos, sala de espera, gravacao), e faz sozinho o que a sala precisa de quem a
// comanda: ao virar moderador, a sala de espera certa (Sessao de pratica, Sala de espera, tranca), a moderacao de audio
// (o aluno so fala depois de Liberar), a de tela compartilhada (so moderador compartilha), a de video quando o webinario
// nao tem camera de aluno e o "seguir a visao do apresentador"; o "Gravar" da fila dispara uma vez no ready; a ancora sai no recordingStatusChanged ligado (uma vez).
// Quem apresenta (host e co-apresentador) ganha o card Configurações (live-settings-card.tsx): os aparelhos pelo hook
// useJitsiDevices, com as secoes de deviceSettingsFor do papel da sala (nunca a Qualidade do vídeo: setVideoQuality
// mudaria o envio do palco) e o ruido, o fundo e o espelho como acoes sem estado (efeitosNoIframe: a barra do iframe
// tambem os muda); a Equipe no console nao tem barra de midia (docs/30 §1.4, pendencia).
// LiveRoomPanel desenha o palco, a situacao da sala, o botao Configurações (o card abre acima do palco) e os controles
// ao redor (live-controls.tsx).
// Nenhum texto cita o motor da sala.

const copy = WEBINAR_COPY.consoleAoVivo;
const ANCHOR_RETRIES = 3;
const ANCHOR_RETRY_MS = 2_000;

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
  /** Liga ou desliga a sala de espera agora (so manda quando muda). */
  syncLobby: (value: boolean) => void;
  testing: boolean;
  tokenError: TokenState["error"];
};

type UseLiveRoomInput = {
  canPublish: boolean;
  /** Onde o iframe entra (o palco do LiveRoomPanel). */
  container: RefObject<HTMLDivElement | null>;
  currentUserId: string;
  /** Falso fora da Live ao vivo: nada e pedido nem montado. */
  enabled: boolean;
  live: LiveConsoleSnapshot | null;
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
  const { container, enabled, live, session, webinar } = input;
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

  const configOverwrite = useMemo(() => (token.reply ? liveConfigOverwrite(token.reply.role, token.reply.settings) : {}), [token.reply]);
  // Quem apresenta abre a engrenagem do iframe so na aba de aparelhos (o papel vem do join-token).
  const tokenRole = token.reply?.role ?? null;
  const interfaceConfigOverwrite = useMemo(() => liveInterfaceConfigOverwrite(tokenRole), [tokenRole]);

  const markAnchor = useCallback(async () => {
    for (let attempt = 0; attempt < ANCHOR_RETRIES; attempt += 1) {
      if (await latest.current.onAnchor()) {
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, ANCHOR_RETRY_MS));
    }
    anchorMarked.current = false;
  }, []);

  const onEvent = useCallback(
    (name: JitsiListenedEvent, payload: unknown) => {
      dispatch({ name, nowMs: Date.now(), payload, type: "event" });
      if (name === "videoConferenceLeft" || name === "readyToClose") {
        setupDone.current = false;
        lobbySent.current = null;
        setVideoOn(false);
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
    [markAnchor, role]
  );

  const meet = useJitsiMeet({
    configOverwrite,
    container,
    domain: token.reply?.domain ?? null,
    enabled: wantsRoom,
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

  // Ao virar moderador: moderacao de audio (o aluno so fala depois de Liberar), de tela compartilhada (so moderador
  // compartilha), de video sem camera de aluno, seguir a visao do apresentador (so o Apresentador) e a sala de espera
  // da situacao (presenterSetupCommands).
  useEffect(() => {
    if (!joined || !room.moderator || !presenter || setupDone.current) {
      return;
    }
    setupDone.current = true;
    for (const [name, ...args] of presenterSetupCommands({ allowStudentCamera: webinar.allowStudentCamera !== false, role })) {
      command(name, ...args);
    }
  }, [command, joined, presenter, role, room.moderator, webinar.allowStudentCamera]);

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
    syncLobby,
    testing,
    videoOn: joined && videoOn,
    tokenError: token.error
  };
}

type LiveRoomPanelProps = {
  busy: boolean;
  children?: ReactNode;
  handle: LiveRoomHandle;
  live: LiveConsoleSnapshot;
  session: WebinarSession;
  /** O mesmo ref passado ao useLiveRoom: o iframe entra aqui. */
  stageRef: RefObject<HTMLDivElement | null>;
};

function frameMessage(handle: LiveRoomHandle, status: WebinarSession["status"]): string | null {
  if (!handle.meetConfigured) {
    return copy.salaEmBreve;
  }
  if (status === "ended" || status === "cancelled") {
    return WEBINAR_COPY.sala.encerrada;
  }
  if (status === "scheduled" && !handle.testing) {
    return copy.abrirSalaTexto;
  }
  if (handle.tokenError === "failed" && handle.frameStatus === "idle") {
    return WEBINAR_COPY.aoVivo.erroAbrir;
  }
  switch (handle.frameStatus) {
    case "joined":
      return null;
    case "failed":
      return WEBINAR_COPY.aoVivo.naoConseguimosVoltar;
    case "left":
      return null;
    default:
      return WEBINAR_COPY.aoVivo.abrindo;
  }
}

/**
 * O palco do console: o iframe da sala no meio, a situacao (Gravando, sala trancada, sala de espera), o botao
 * Configurações de quem apresenta e os controles ao redor. O card de aparelhos abre ACIMA do palco: logo depois do
 * botao no teclado (o Tab do botao entra no card, nao nos botoes da barra do iframe, e o Esc fica a mao) e na tela
 * (abaixo de um palco 16:9, num notebook, ele ficaria fora da tela e o clique pareceria nao fazer nada). Fechar pelo
 * proprio botao manda o foco a ele antes de o card sumir (o WebKit nao foca o botao no clique).
 */
export function LiveRoomPanel({ busy, children, handle, live, session, stageRef }: LiveRoomPanelProps) {
  const settingsButton = useRef<HTMLButtonElement | null>(null);
  const message = frameMessage(handle, session.status);
  const showSettings = presents(handle.role) && handle.meetConfigured;
  const recording = handle.room.recording.on || live.recorder.status === "recording";
  const notice = lobbyNotice({ lobby: handle.lobby, roomLocked: live.roomLocked, status: session.status });
  const canTest = handle.meetConfigured && session.status === "scheduled" && !handle.testing;
  const showRetry = handle.frameStatus === "failed" || (handle.tokenError === "failed" && handle.frameStatus === "idle");

  return (
    <SectionCard
      actions={
        <span className="flex flex-wrap items-center gap-2">
          {recording ? <StatusChip tone="error">{copy.gravador.recording}</StatusChip> : null}
          {live.roomLocked ? <StatusChip tone="warning">{copy.salaTrancada}</StatusChip> : null}
          {handle.joined ? <StatusChip tone="muted">{LIVE_CONSOLE_COPY.naSala(handle.room.people.length + 1)}</StatusChip> : null}
          {showSettings ? (
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
          ) : null}
        </span>
      }
      bodyClassName="flex min-w-0 flex-col gap-4"
      title={LIVE_CONSOLE_COPY.salaAoVivo}
      titleId="console-live-room-title"
    >
      {showSettings && handle.settingsOpen ? (
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
      ) : null}
      <div className="relative w-full min-w-0 overflow-hidden rounded-lg bg-black" data-live-frame-status={handle.frameStatus}>
        <div aria-label={WEBINAR_COPY.aoVivo.palco} className="aspect-video w-full [&_iframe]:size-full [&_iframe]:border-0" data-live-stage="" ref={stageRef} role="region" />
        {message ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center" data-live-stage-message="">
            <p className="max-w-md text-sm leading-5 text-white/85">{message}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {canTest ? (
                <Button className="px-3" disabled={busy} onClick={handle.startTesting} type="button" variant="secondary">
                  <DoorOpen aria-hidden="true" className="size-4" />
                  {copy.testarSala}
                </Button>
              ) : null}
              {showRetry ? (
                <Button className="px-3" onClick={handle.retry} type="button" variant="secondary">
                  <RefreshCw aria-hidden="true" className="size-4" />
                  {WEBINAR_COPY.sala.tentarDeNovo}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {handle.frameStatus === "left" ? (
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <Button className="px-3" onClick={handle.retry} type="button" variant="secondary">
              <LogIn aria-hidden="true" className="size-4" />
              {WEBINAR_COPY.aoVivo.entrarNaSala}
            </Button>
          </div>
        ) : null}
      </div>
      {notice ? (
        <p className={cn("text-[13px] leading-5", live.roomLocked ? "text-[var(--warning)]" : "text-[var(--text-secondary)]")} data-live-notice="">
          {notice}
        </p>
      ) : null}
      {children}
    </SectionCard>
  );
}
