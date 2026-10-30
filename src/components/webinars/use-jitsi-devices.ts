"use client";

// Os aparelhos e o som da sala ao vivo pelo IFrame API (docs/30 §1.3, §1.4, §5.4, §6.3 e §8.5), um hook so para o
// painel Configurações da sala do aluno (src/components/member/webinars/room/live-settings.tsx) e para o card de quem
// apresenta no console: le as listas (getAvailableDevices, getCurrentDevices, isDeviceChangeAvailable('output'),
// isMultipleAudioInputSupported) com a sala no ar, a cada deviceListChanged e mudanca do proprio microfone ou camera
// (`aoSinal`: a permissao do navegador pode ter acabado de chegar) e ao abrir o painel; troca o aparelho pelo metodo da
// api so com o ID (setDeviceArgs: com o rotulo o iframe pegaria o primeiro de rotulo igual), so quando
// `podeTrocar(tipo)` deixa (o aluno so troca microfone e camera depois do consentimento: a troca pede getUserMedia) e
// depois de `antesDeTrocar(tipo)` (a sala separa os sinais de mudo da troca: nem aviso na barra, nem linha no servidor;
// e segura o toque em Microfone / Câmera ate a troca acabar). O que ela devolve: `answered`, chamado quando o set*Device
// responde, e `done`, quando a troca ACABOU: o hook confere o aparelho em uso (getCurrentDevices) a cada
// DEVICE_SWITCH_POLL_MS ate ser o escolhido (passado o piso `minMs` que a sala pede: o iframe sem faixa daquele aparelho
// diz o escolhido antes de a faixa da troca entrar), o iframe avisar o erro daquele tipo ou o teto (deviceSwitchDone); a
// resposta do set*Device sai antes do getUserMedia do aparelho novo. Enquanto isso, a lista mostra o escolhido.
// O aluno so muda ruido, fundo, espelho e qualidade pelo nosso painel: o hook guarda o que ele ligou, manda de novo o
// ruido quando a troca do microfone acaba e, num iframe novo (a entrada, a volta depois de uma queda, a live seguinte), o
// que o painel mostra (o ruido ligado ou desligado e o fundo desligado na entrada, porque o iframe guarda os dois da
// live anterior; a qualidade; o desfoque ligado quando a camera ligar, uma vez: panelEffectsOnSignal), e guarda o
// espelho no navegador da pagina (o iframe guarda o dele de uma live para outra e a api nao deixa ler). Quem apresenta (`efeitosNoIframe`) muda ruido,
// fundo e espelho tambem pela barra do iframe: o hook so manda o comando, sem guardar nem reaplicar nada. O volume
// (setParticipantVolume em todos e em quem entrar depois, junto com o botao Som da sala) vai por executeCommand. Nada
// aqui fala com o nosso servidor e nenhuma frase de tela mora aqui (os nomes reserva chegam por `nomesReserva`).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { JitsiMeetApi } from "@/components/webinars/use-jitsi-meet";
// Os imports que citam o motor ficam numa linha so (as guardas de texto da sala leem as fontes sem as linhas de import).
import { blurCommand, clampPercent, DEVICE_KINDS, DEVICE_SWITCH_POLL_MS, deviceSwitchDone, deviceSwitchErrorOf, devicesSnapshotOf, EMPTY_DEVICES, INITIAL_PANEL_EFFECTS, MIRROR_STORAGE_KEY, noiseSuppressionCommand, panelEffectsAfterSwitch, panelEffectsOnSignal, receiveQualityCommand, SET_DEVICE_METHOD, setDeviceArgs, soundLevel, storedMirror, VOLUME_APPLY_MS, type DeviceKind, type DeviceOption, type DevicesSnapshot, type PanelEffects, type ReceiveQuality } from "@/lib/jitsi-device-settings";

/**
 * O que a sala faz em volta de uma troca: `answered` quando o set*Device responde (o prazo dos sinais da troca conta
 * de novo dali), `done` quando a troca acabou (o aparelho em uso e o escolhido, o erro dela ou o teto) e `minMs`, o
 * piso contado da resposta antes do qual o aparelho escolhido "em uso" nao encerra a troca (o iframe ainda sem faixa
 * daquele aparelho diz o escolhido antes de a faixa da troca entrar: deviceSwitchDone).
 */
export type DeviceSwitchHooks = { answered?: () => void; done?: () => void; minMs?: number };

export type UseJitsiDevicesInput = {
  /** O IFrame API montado (o `api` do useJitsiMeet). */
  api: RefObject<JitsiMeetApi | null>;
  /**
   * Antes de trocar o aparelho (a sala separa os sinais de mudo da troca da camera, que a do microfone nao manda na tag
   * stable-11248, e segura o toque em Microfone / Câmera ate a troca acabar); devolve o que chamar quando o set*Device
   * responde e quando a troca acaba (DeviceSwitchHooks).
   */
  antesDeTrocar?: (kind: DeviceKind) => DeviceSwitchHooks | void;
  /**
   * Quem apresenta: ruido, fundo e espelho tambem mudam pela barra do iframe (a setinha do microfone, o fundo, a
   * engrenagem), entao o hook so manda o comando, sem guardar estado nem reaplicar nada por cima da escolha feita la.
   */
  efeitosNoIframe?: boolean;
  /** O executeCommand do useJitsiMeet (falso sem sala montada). */
  executeCommand: (command: string, ...args: unknown[]) => boolean;
  /** Dentro da sala (videoConferenceJoined): so entao le os aparelhos. */
  joined: boolean;
  /** O nome de um aparelho sem rotulo ("Microfone 1"), por tipo. */
  nomesReserva: Record<DeviceKind, (position: number) => string>;
  /** O painel aberto: rele a lista ao abrir. */
  open: boolean;
  /** Os ids de quem esta na sala alem de mim, quando o iframe nao responde getParticipantsInfo (os sinais da sala). */
  outrosParticipantes: () => string[];
  /** O proprio id no iframe (fica fora do volume). */
  proprioId: () => string | null;
  /** A troca daquele tipo esta liberada agora (deviceSectionReady das secoes do painel). */
  podeTrocar: (kind: DeviceKind) => boolean;
  /** O botao Som da barra: desligado, todo mundo fica em 0 (a faixa so vale com ele ligado). */
  somLigado: () => boolean;
};

export type UseJitsiDevices = DevicesSnapshot & {
  /** Cada sinal do iframe que a sala recebe: rele a lista e, no aluno, o que um iframe novo precisa de novo. */
  aoSinal: (name: string, payload: unknown) => void;
  /** O desfoque que o aluno pediu (setBlurredBackground "blur"); quem apresenta nao guarda. */
  blur: boolean;
  /** Troca o aparelho daquele tipo; falso quando nao pode (antes do consentimento, sem sala, sem o metodo). */
  escolher: (kind: DeviceKind, option: DeviceOption) => boolean;
  /** Inverte o espelho da propria imagem (toggleCameraMirror so inverte); o aluno guarda a escolha na pagina. */
  espelhar: () => void;
  fundo: (on: boolean) => void;
  /** "Mais opções de fundo": o dialogo de fundo do proprio iframe (toggleVirtualBackgroundDialog). */
  maisFundos: () => void;
  /** O espelho do aluno guardado na pagina; nulo antes de ler e para quem apresenta (a barra do iframe tambem muda). */
  mirror: boolean | null;
  /** O volume que cada participante recebe agora (o Som da barra e a faixa). */
  nivel: () => number;
  noise: boolean;
  /** Aplica um volume (0 a 1) a todos que estao na sala alem de mim. */
  aplicarNivel: (level: number) => void;
  qualidade: (choice: ReceiveQuality) => void;
  quality: ReceiveQuality;
  reler: () => void;
  ruido: (on: boolean) => void;
  volume: (percent: number) => void;
  /** A faixa de volume (0 a 100). */
  volumePercent: number;
};

function field(payload: unknown, key: string): unknown {
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>)[key] : undefined;
}

/* O espelho do aluno guardado no navegador da pagina (MIRROR_STORAGE_KEY), lido por useSyncExternalStore: nulo no
 * servidor e na primeira pintura (a caixa so aparece depois de ler); sem armazenamento, vale o da memoria ate recarregar. */
const mirrorListeners = new Set<() => void>();
let mirrorMemory: boolean | null = null;

function subscribeMirror(listener: () => void) {
  mirrorListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    mirrorListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readMirror(): boolean {
  if (mirrorMemory !== null) {
    return mirrorMemory;
  }
  try {
    return storedMirror(window.localStorage.getItem(MIRROR_STORAGE_KEY));
  } catch {
    return storedMirror(null);
  }
}

function serverMirror(): boolean | null {
  return null;
}

function writeMirror(on: boolean) {
  mirrorMemory = on;
  try {
    window.localStorage.setItem(MIRROR_STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Sem armazenamento (aba privada, bloqueado): vale a memoria ate recarregar.
  }
  mirrorListeners.forEach((listener) => listener());
}

/** Um metodo da api que pode nao existir (versao antiga) ou falhar: vira uma promessa que nunca rejeita. */
function safely<T>(call: () => Promise<T> | T | undefined): Promise<T | undefined> {
  try {
    return Promise.resolve(call()).catch(() => undefined);
  } catch {
    return Promise.resolve(undefined);
  }
}

export function useJitsiDevices(input: UseJitsiDevicesInput): UseJitsiDevices {
  const { executeCommand, joined, open } = input;
  const latest = useRef(input);
  const [snapshot, setSnapshot] = useState<DevicesSnapshot>(EMPTY_DEVICES);
  const [noise, setNoise] = useState(false);
  const [blur, setBlur] = useState(false);
  const storedMirrorOn = useSyncExternalStore(subscribeMirror, readMirror, serverMirror);
  const [quality, setQuality] = useState<ReceiveQuality>("automatica");
  const [volumePercent, setVolumePercent] = useState(100);
  /** O que o aluno ligou pelo painel (quem apresenta nao guarda: a barra do iframe tambem muda). */
  const effectsRef = useRef<PanelEffects>(INITIAL_PANEL_EFFECTS);
  /** O aparelho em uso da ultima leitura (a escolha do aparelho que ja esta em uso nao troca nada). */
  const currentRef = useRef<DevicesSnapshot["current"]>(EMPTY_DEVICES.current);
  /** A troca de cada tipo em andamento: o escolhido (a lista o mostra ate acabar), o numero e o erro que chegou. */
  const switchesRef = useRef<Record<DeviceKind, { chosen: string; failed: boolean; id: number } | null>>({ audioInput: null, audioOutput: null, videoInput: null });
  const switchSeqRef = useRef(0);
  const volumeRef = useRef(100);
  const readSeqRef = useRef(0);
  const mountedRef = useRef(true);
  const timersRef = useRef(new Set<number>());
  const volumeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    mountedRef.current = true;
    const timers = timersRef.current;
    return () => {
      mountedRef.current = false;
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

  /** O IFrame API montado agora (o ref do useJitsiMeet, lido na hora de cada chamada). */
  const meetApi = useCallback(() => latest.current.api.current, []);

  /** Uma leitura dos aparelhos daquele iframe, arrumada (nula quando o iframe nao tem a api de aparelhos). */
  const lerAparelhos = useCallback((current: JitsiMeetApi): Promise<DevicesSnapshot> | null => {
    if (!current.getAvailableDevices) {
      return null;
    }
    return Promise.all([
      safely(() => current.getAvailableDevices?.()),
      safely(() => current.getCurrentDevices?.()),
      safely(() => current.isDeviceChangeAvailable?.("output")),
      safely(() => current.isMultipleAudioInputSupported?.())
    ]).then(([available, devices, outputChangeAvailable, multipleAudioInput]) =>
      devicesSnapshotOf({ available, current: devices, multipleAudioInput, outputChangeAvailable }, latest.current.nomesReserva)
    );
  }, []);

  /** Aplica uma leitura; o tipo com troca em andamento continua mostrando o escolhido ate ela acabar. */
  const aplicarLeitura = useCallback((read: DevicesSnapshot) => {
    const current = { ...read.current };
    for (const kind of DEVICE_KINDS) {
      const pending = switchesRef.current[kind];
      if (pending) {
        current[kind] = pending.chosen;
      }
    }
    currentRef.current = read.current;
    setSnapshot({ ...read, current });
  }, []);

  const reler = useCallback(() => {
    const current = meetApi();
    const reading = current ? lerAparelhos(current) : null;
    if (!current || !reading) {
      return;
    }
    readSeqRef.current += 1;
    const seq = readSeqRef.current;
    void reading.then((read) => {
      if (!mountedRef.current || seq !== readSeqRef.current || meetApi() !== current) {
        return;
      }
      aplicarLeitura(read);
    });
  }, [aplicarLeitura, lerAparelhos, meetApi]);

  // A sala no ar (e cada volta depois de uma queda) e o painel aberto: le de novo. Fora da sala, nada de aparelho (uma
  // leitura que chegue depois de sair fica de fora).
  useEffect(() => {
    if (!joined) {
      readSeqRef.current += 1;
      return;
    }
    reler();
  }, [joined, reler]);

  useEffect(() => {
    if (open && joined) {
      reler();
    }
  }, [joined, open, reler]);

  const escolher = useCallback(
    (kind: DeviceKind, option: DeviceOption) => {
      const current = meetApi();
      const method = current ? current[SET_DEVICE_METHOD[kind]] : undefined;
      if (!current || typeof method !== "function" || !latest.current.podeTrocar(kind)) {
        return false;
      }
      // O aparelho que ja esta em uso (sem troca no meio): nada a trocar (a troca do mesmo microfone no iframe ainda
      // desligaria o ruido e abriria outra faixa).
      if (!switchesRef.current[kind] && currentRef.current[kind] === option.deviceId) {
        return true;
      }
      // Antes da troca: os sinais de mudo que a faixa nova pode mandar sao da troca (nem a equipe, nem o servidor).
      const hooks = latest.current.antesDeTrocar?.(kind) ?? {};
      switchSeqRef.current += 1;
      const id = switchSeqRef.current;
      let pending: Promise<unknown>;
      try {
        pending = Promise.resolve(method.apply(current, setDeviceArgs(option)));
      } catch {
        hooks.done?.();
        return false;
      }
      switchesRef.current[kind] = { chosen: option.deviceId, failed: false, id };
      setSnapshot((previous) => ({ ...previous, current: { ...previous.current, [kind]: option.deviceId } }));
      void pending
        .catch(() => undefined)
        .then((answer) => {
          hooks.answered?.();
          const answeredAt = Date.now();
          // A resposta sai antes do getUserMedia do aparelho novo: confere o aparelho em uso ate a troca acabar.
          const check = () => {
            if (!mountedRef.current || switchesRef.current[kind]?.id !== id) {
              return;
            }
            if (meetApi() !== current) {
              // Outro iframe (a queda, a volta): a troca era do anterior; a sala recomeca do zero na entrada nova.
              switchesRef.current[kind] = null;
              return;
            }
            const reading = lerAparelhos(current);
            if (!reading) {
              // Sem como ler o aparelho em uso: a troca conta como acabada (o toque que esperava vai).
              switchesRef.current[kind] = null;
              hooks.done?.();
              return;
            }
            void reading.then((read) => {
              const now = switchesRef.current[kind];
              if (!mountedRef.current || now?.id !== id) {
                return;
              }
              if (meetApi() !== current) {
                switchesRef.current[kind] = null;
                return;
              }
              const done = deviceSwitchDone({ chosen: option.deviceId, current: read.current[kind], elapsedMs: Date.now() - answeredAt, failed: answer === false || now.failed, minMs: hooks.minMs });
              if (!done) {
                later(check, DEVICE_SWITCH_POLL_MS);
                return;
              }
              switchesRef.current[kind] = null;
              // A lista do que o iframe usa de verdade (o escolhido, ou o de antes quando a troca falhou) e, no aluno, o
              // Reduzir ruído de volta na faixa nova (a tag o desligou antes do getUserMedia).
              readSeqRef.current += 1;
              aplicarLeitura(read);
              if (!latest.current.efeitosNoIframe) {
                panelEffectsAfterSwitch(effectsRef.current, kind).forEach((command) => executeCommand(...command));
              }
              hooks.done?.();
            });
          };
          later(check, answer === false ? 0 : DEVICE_SWITCH_POLL_MS);
        });
      return true;
    },
    [aplicarLeitura, executeCommand, later, lerAparelhos, meetApi]
  );

  const ruido = useCallback(
    (on: boolean) => {
      if (executeCommand(...noiseSuppressionCommand(on)) && !latest.current.efeitosNoIframe) {
        effectsRef.current = { ...effectsRef.current, noise: on };
        setNoise(on);
      }
    },
    [executeCommand]
  );

  const fundo = useCallback(
    (on: boolean) => {
      if (executeCommand(...blurCommand(on)) && !latest.current.efeitosNoIframe) {
        effectsRef.current = { ...effectsRef.current, blur: on, blurOnNextVideo: false };
        setBlur(on);
      }
    },
    [executeCommand]
  );

  const aoSinal = useCallback(
    (name: string, payload: unknown) => {
      // So o aluno: um iframe novo recebe de novo o ruido, a qualidade e (quando a camera ligar) o desfoque escolhidos.
      if (!latest.current.efeitosNoIframe) {
        const step = panelEffectsOnSignal(effectsRef.current, name, payload);
        effectsRef.current = step.effects;
        step.commands.forEach((command) => executeCommand(...command));
      }
      // O iframe nao conseguiu abrir o aparelho novo (a faixa velha fica): a troca daquele tipo acaba na proxima conferencia.
      const failedKind = deviceSwitchErrorOf(name);
      const failedSwitch = failedKind ? switchesRef.current[failedKind] : null;
      if (failedKind && failedSwitch) {
        switchesRef.current[failedKind] = { ...failedSwitch, failed: true };
      }
      // Um fone entrou ou saiu, ou o navegador acabou de dar a permissao (o Falar, a camera): a lista nova, com os nomes.
      if (name === "deviceListChanged" || name === "audioMuteStatusChanged" || name === "videoMuteStatusChanged") {
        reler();
      }
    },
    [executeCommand, reler]
  );

  const espelhar = useCallback(() => {
    // O comando so inverte; o aluno guarda o novo valor na pagina (quem apresenta tambem inverte pela barra do iframe).
    if (executeCommand("toggleCameraMirror") && !latest.current.efeitosNoIframe) {
      writeMirror(!readMirror());
    }
  }, [executeCommand]);

  const maisFundos = useCallback(() => {
    executeCommand("toggleVirtualBackgroundDialog");
  }, [executeCommand]);

  const qualidade = useCallback(
    (choice: ReceiveQuality) => {
      const command = receiveQualityCommand(choice, effectsRef.current.quality);
      if (command && !executeCommand(...command)) {
        return;
      }
      effectsRef.current = { ...effectsRef.current, quality: choice };
      setQuality(choice);
    },
    [executeCommand]
  );

  /** Quem esta na sala alem de mim: o iframe sabe; senao, quem os sinais trouxeram. */
  const outros = useCallback(() => {
    let info: unknown[] = [];
    try {
      info = meetApi()?.getParticipantsInfo?.() ?? [];
    } catch {
      info = [];
    }
    const fromApi = info.map((item) => field(item, "participantId")).filter((id): id is string => typeof id === "string");
    const own = latest.current.proprioId();
    return (fromApi.length > 0 ? fromApi : latest.current.outrosParticipantes()).filter((id) => id !== own);
  }, [meetApi]);

  const aplicarNivel = useCallback(
    (level: number) => {
      outros().forEach((id) => executeCommand("setParticipantVolume", id, level));
    },
    [executeCommand, outros]
  );

  const nivel = useCallback(() => soundLevel(latest.current.somLigado(), volumeRef.current), []);

  const volume = useCallback(
    (percent: number) => {
      const value = clampPercent(percent);
      volumeRef.current = value;
      setVolumePercent(value);
      // Enquanto o dedo arrasta, um envio por intervalo (a sala pode ter centenas de participantes).
      if (volumeTimerRef.current !== null) {
        return;
      }
      volumeTimerRef.current = window.setTimeout(() => {
        volumeTimerRef.current = null;
        if (mountedRef.current && latest.current.somLigado()) {
          aplicarNivel(soundLevel(true, volumeRef.current));
        }
      }, VOLUME_APPLY_MS);
    },
    [aplicarNivel]
  );

  useEffect(
    () => () => {
      if (volumeTimerRef.current !== null) {
        window.clearTimeout(volumeTimerRef.current);
        volumeTimerRef.current = null;
      }
    },
    []
  );

  return {
    ...(joined ? snapshot : EMPTY_DEVICES),
    aoSinal,
    aplicarNivel,
    blur,
    escolher,
    espelhar,
    fundo,
    maisFundos,
    mirror: input.efeitosNoIframe ? null : storedMirrorOn,
    nivel,
    noise,
    qualidade,
    quality,
    reler,
    ruido,
    volume,
    volumePercent
  };
}
