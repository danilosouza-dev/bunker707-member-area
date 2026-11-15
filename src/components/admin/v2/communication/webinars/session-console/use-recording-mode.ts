"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { appliedRecordingModeOf, meetOrigin, recordingModeMessage, type RecordingMode } from "@/lib/jitsi-room-config";

// O modo da gravacao no console de quem apresenta (docs/30 A63 e D125). O console pede o modo ao iframe antes de
// gravar (o arquivo da instancia poe o modo na presenca de quem modera, e o gravador que entra ja o encontra), pede de
// novo a cada iframe montado (a presenca nova nasce sem ele) e, quando a gravacao para, volta a pedir a sala. A escolha
// fica na aba (sessionStorage, por sessao): o console que recarrega com a gravacao na fila ou no ar continua sabendo o
// que pediu. O aviso do iframe diz o que o gravador aplicou de fato (so do proprio iframe e da origem do motor).

const STORAGE_PREFIX = "bunker707:gravacao:";

function readStored(sessionId: string | null): RecordingMode | null {
  if (!sessionId) {
    return null;
  }
  try {
    const value = window.sessionStorage.getItem(`${STORAGE_PREFIX}${sessionId}`);
    return value === "tela" || value === "sala" ? value : null;
  } catch {
    return null;
  }
}

function writeStored(sessionId: string | null, mode: RecordingMode) {
  if (!sessionId) {
    return;
  }
  try {
    window.sessionStorage.setItem(`${STORAGE_PREFIX}${sessionId}`, mode);
  } catch {
    // Sem guardar na aba, a escolha vale ate a pagina recarregar.
  }
}

/** A escolha guardada muda em outra aba (o evento storage): a leitura e refeita. */
function subscribeStored(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

export type RecordingModeState = {
  /** O que o proprio gravador contou que aplicou (nulo: sem gravador na sala ou sem aviso ainda). */
  applied: RecordingMode | null;
  /** O que este console pediu por ultimo (nulo: nada pedido nesta aba). */
  chosen: RecordingMode | null;
  /** Pede o modo ao iframe (e guarda na aba); falso sem o iframe montado. */
  choose: (mode: RecordingMode) => boolean;
};

export function useRecordingMode(input: {
  domain: string | null;
  frame: () => Window | null;
  joined: boolean;
  post: (message: unknown) => boolean;
  recording: boolean;
  sessionId: string | null;
}): RecordingModeState {
  const { domain, frame, joined, post, recording, sessionId } = input;
  // A escolha guardada na aba (no servidor, nada: o HTML nao depende dela) e a escolha feita agora neste console.
  const stored = useSyncExternalStore(subscribeStored, () => readStored(sessionId), () => null);
  const [picked, setPicked] = useState<{ mode: RecordingMode; sessionId: string | null } | null>(null);
  const chosen = picked && picked.sessionId === sessionId ? picked.mode : stored;
  const [applied, setApplied] = useState<RecordingMode | null>(null);
  const chosenRef = useRef<RecordingMode | null>(chosen);
  const wasRecording = useRef(false);

  useEffect(() => {
    chosenRef.current = chosen;
  });

  const choose = useCallback(
    (mode: RecordingMode) => {
      chosenRef.current = mode;
      setPicked({ mode, sessionId });
      writeStored(sessionId, mode);
      return post(recordingModeMessage(mode));
    },
    [post, sessionId]
  );

  // Cada iframe que entra na sala pede o modo de novo: a presenca nova nasce sem ele.
  useEffect(() => {
    if (!joined || !chosenRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (chosenRef.current) {
        post(recordingModeMessage(chosenRef.current));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [joined, post]);

  // A gravacao parou: o pedido volta para a sala (a proxima gravacao so e de tela se pedirem de novo).
  useEffect(() => {
    if (wasRecording.current && !recording && chosenRef.current === "tela") {
      choose("sala");
    }
    wasRecording.current = recording;
  }, [choose, recording]);

  // O aviso do iframe: o modo que o gravador aplicou.
  useEffect(() => {
    if (!domain) {
      return;
    }
    const origin = meetOrigin(domain);
    const onMessage = (event: MessageEvent) => {
      const source = frame();
      if (event.origin !== origin || !source || event.source !== source) {
        return;
      }
      const mode = appliedRecordingModeOf(event.data);
      if (mode !== undefined) {
        setApplied(mode);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [domain, frame]);

  return { applied: joined ? applied : null, chosen, choose };
}
