"use client";

// O iframe da sala ao vivo (docs/30 §5.4, §6.3, §8.4 e D2/D18), um hook so para a sala do aluno
// (src/components/member/webinars/room) e o console da equipe (src/components/admin/v2/communication/webinars/
// session-console): carrega o external_api.js do Jitsi proprio (https://<dominio>/external_api.js, nunca meet.jit.si)
// por um <script> com o nonce da pagina (a CSP com 'strict-dynamic' de src/proxy.ts aceita sem origem nova em
// script-src), monta o JitsiMeetExternalAPI dentro do `container` com o token, a sala e o configOverwrite do papel
// (src/lib/jitsi-room-config.ts), repassa os sinais combinados (JITSI_LISTENED_EVENTS) para `onEvent` e devolve
// `executeCommand` para os botoes nossos. O token novo (pedido antes do `exp`) NAO remonta a sala no ar: ele fica para a
// proxima montagem (retry ou queda), assim a live nunca cai por troca de token. Nenhuma frase de tela aqui.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { JITSI_IFRAME_ALLOW, JITSI_LISTENED_EVENTS, externalApiUrl, type JitsiListenedEvent } from "@/lib/jitsi-room-config";

/** O pedaco do IFrame API que usamos (o mesmo que o duble salaFalsaDoJitsi de tests/e2e/fixtures.ts imita). */
export type JitsiMeetApi = {
  addListener(event: string, listener: (payload: unknown) => void): void;
  dispose(): void;
  executeCommand(command: string, ...args: unknown[]): void;
  getIFrame?(): HTMLIFrameElement | null;
  getParticipantsInfo?(): unknown[];
  /** As salas e quem esta nelas, com o papel de cada um (a sala do aluno le quem ja era moderador ao entrar). */
  getRoomsInfo?(): Promise<unknown>;
  removeListener?(event: string, listener: (payload: unknown) => void): void;
};

type JitsiMeetConstructor = new (domain: string, options: Record<string, unknown>) => JitsiMeetApi;

declare global {
  interface Window {
    JitsiMeetExternalAPI?: JitsiMeetConstructor;
  }
}

export type JitsiStatus = "idle" | "loading" | "joining" | "joined" | "left" | "failed";

const SCRIPT_TIMEOUT_MS = 20_000;
const loaders = new Map<string, Promise<JitsiMeetConstructor>>();

/** O nonce da pagina: o passado pelo servidor ou o de um <script> que ja tem (o Next carimba os dele). */
function pageNonce(explicit?: string | null): string | undefined {
  if (explicit) {
    return explicit;
  }
  const tagged = document.querySelector<HTMLScriptElement>("script[nonce]");
  return tagged?.nonce || tagged?.getAttribute("nonce") || undefined;
}

/** Carrega o external_api.js uma vez por dominio (a segunda montagem reaproveita). */
export function loadJitsiExternalApi(domain: string, explicitNonce?: string | null): Promise<JitsiMeetConstructor> {
  if (window.JitsiMeetExternalAPI) {
    return Promise.resolve(window.JitsiMeetExternalAPI);
  }
  const cached = loaders.get(domain);
  if (cached) {
    return cached;
  }
  const promise = new Promise<JitsiMeetConstructor>((resolve, reject) => {
    const script = document.createElement("script");
    const timer = window.setTimeout(() => reject(new Error("external_api_timeout")), SCRIPT_TIMEOUT_MS);
    script.src = externalApiUrl(domain);
    script.async = true;
    const nonce = pageNonce(explicitNonce);
    if (nonce) {
      script.nonce = nonce;
    }
    script.onload = () => {
      window.clearTimeout(timer);
      if (window.JitsiMeetExternalAPI) {
        resolve(window.JitsiMeetExternalAPI);
      } else {
        reject(new Error("external_api_missing"));
      }
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("external_api_failed"));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    loaders.delete(domain);
    throw error;
  });
  loaders.set(domain, promise);
  return promise;
}

export type UseJitsiMeetInput = {
  configOverwrite: Record<string, unknown>;
  /** Onde o iframe entra (o palco). */
  container: RefObject<HTMLElement | null>;
  domain: string | null;
  /** Falso = nada e montado (sem token, sala fechada, aluno removido, aba de pre-visualizacao). */
  enabled: boolean;
  interfaceConfigOverwrite?: Record<string, unknown>;
  jwt: string | null;
  nonce?: string | null;
  /** Cada sinal de JITSI_LISTENED_EVENTS com o payload cru do IFrame API (quem usa filtra; so codigos vao ao servidor). */
  onEvent?: (name: JitsiListenedEvent, payload: unknown) => void;
  room: string | null;
};

export type UseJitsiMeet = {
  api: RefObject<JitsiMeetApi | null>;
  /** Manda um comando ao iframe; falso quando ainda nao ha sala montada. */
  executeCommand: (command: string, ...args: unknown[]) => boolean;
  /** O id do proprio participante no Jitsi (do videoConferenceJoined), para filtrar mao levantada e papel. */
  participantId: string | null;
  /** Remonta a sala com o token mais novo ("Tentar de novo" ou depois de uma queda). */
  retry: () => void;
  status: JitsiStatus;
};

export function useJitsiMeet(input: UseJitsiMeetInput): UseJitsiMeet {
  const { container, domain, enabled, room } = input;
  const api = useRef<JitsiMeetApi | null>(null);
  const latest = useRef(input);
  const [mountKey, setMountKey] = useState(0);
  const [status, setStatus] = useState<JitsiStatus>("idle");
  const [participantId, setParticipantId] = useState<string | null>(null);

  useEffect(() => {
    latest.current = input;
  });

  const ready = enabled && Boolean(domain && room && input.jwt);

  useEffect(() => {
    const host = container.current;
    if (!ready || !domain || !room || !host) {
      return;
    }
    let disposed = false;
    let instance: JitsiMeetApi | null = null;

    loadJitsiExternalApi(domain, latest.current.nonce)
      .then((JitsiMeet) => {
        if (disposed) {
          return;
        }
        const current = latest.current;
        instance = new JitsiMeet(domain, {
          configOverwrite: current.configOverwrite,
          height: "100%",
          interfaceConfigOverwrite: current.interfaceConfigOverwrite ?? {},
          jwt: current.jwt,
          parentNode: host,
          roomName: room,
          width: "100%"
        });
        api.current = instance;
        const iframe = instance.getIFrame?.();
        if (iframe) {
          iframe.setAttribute("allow", JITSI_IFRAME_ALLOW);
        }
        setStatus("joining");
        for (const name of JITSI_LISTENED_EVENTS) {
          instance.addListener(name, (payload) => {
            if (disposed) {
              return;
            }
            if (name === "videoConferenceJoined") {
              const id = payload && typeof payload === "object" ? (payload as Record<string, unknown>).id : null;
              setParticipantId(typeof id === "string" ? id : null);
              setStatus("joined");
            } else if (name === "videoConferenceLeft" || name === "readyToClose") {
              setStatus("left");
            } else if (name === "errorOccurred") {
              const error = payload && typeof payload === "object" ? ((payload as Record<string, unknown>).error ?? payload) : null;
              if (error && typeof error === "object" && (error as Record<string, unknown>).isFatal === true) {
                setStatus("failed");
              }
            }
            latest.current.onEvent?.(name, payload);
          });
        }
      })
      .catch(() => {
        if (!disposed) {
          setStatus("failed");
        }
      });

    return () => {
      disposed = true;
      api.current = null;
      setParticipantId(null);
      setStatus("idle");
      try {
        instance?.dispose();
      } catch {
        // A sala ja tinha fechado.
      }
    };
    // O token nao entra aqui de proposito: trocar o token nao derruba a sala no ar (ver o cabecalho).
  }, [container, domain, mountKey, ready, room]);

  const executeCommand = useCallback((command: string, ...args: unknown[]) => {
    if (!api.current) {
      return false;
    }
    try {
      api.current.executeCommand(command, ...args);
      return true;
    } catch {
      return false;
    }
  }, []);

  const retry = useCallback(() => setMountKey((key) => key + 1), []);

  // Montando (o script ainda carrega ou a sala acabou de ser pedida de novo): "loading".
  return { api, executeCommand, participantId, retry, status: ready ? (status === "idle" ? "loading" : status) : "idle" };
}
