"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { StudentChatMessage } from "@/server/webinars/model";
import type { ScreenEventForm, ScreenEventName, ScreenEventTarget, StudentScreenItem, StudentScreenState } from "@/server/webinars/screen-model";
import { adoptScreen, closedIdsValue, screenClosedKey, storedClosedIds, visibleScreenItems } from "./room-screen-model";

// A "Na tela" na sala do aluno (docs/30 §5.1; especificacao de 10/11/2026, §3 e §5.2): o estado do que a turma ve na
// frente da sessao, a mensagem fixada, a enquete fixada, o banner e o QR Code. Chega por dois caminhos:
// - a leitura da sessao (a pagina, a releitura de 60 s e a volta para a aba, useRoomClock): sempre adotada;
// - a consulta de 5 s do chat (useRoomChat), que manda o carimbo que a sala tem (`getStamp`) e traz o estado so quando
//   ele mudou (`onChatScreen`).
// O aluno que fecha um banner ou QR Code fecha so aquela exibicao, guardada no sessionStorage da aba (recarregar nao
// traz de volta; um novo Mostrar e outra exibicao). Lido por useSyncExternalStore (o HTML do servidor e a primeira
// pintura saem sem nada fechado); sem armazenamento, vale a memoria ate recarregar; toda leitura e escrita em try/catch.
// O envio das metricas (sendEvent) e um ponto de encaixe: a fatia do aluno o preenche (POST .../screen-events).

export type ScreenEvent = { displayId: string; form: ScreenEventForm; name: ScreenEventName; target?: ScreenEventTarget };

export type RoomScreen = {
  /** Fecha o banner ou o QR Code para este aluno (so os que podem ser fechados). */
  closeItem: (displayId: string) => void;
  /** O carimbo que a sala tem (vai na consulta de 5 s do chat). */
  getStamp: () => string | null;
  /** O banner e o QR Code que continuam na tela para este aluno. */
  items: StudentScreenItem[];
  /** O estado que a consulta de 5 s trouxe (so quando o carimbo mudou). */
  onChatScreen: (screen: StudentScreenState) => void;
  /** A mensagem fixada (sem o estado, a da leitura da sessao: a pagina do servidor de antes). */
  pinned: StudentChatMessage | null;
  pinnedPollId: string | null;
  /** O resumo das enquetes da sessao: mudou, a sala rele as enquetes (useRoomPolls). Nulo sem estado. */
  pollsKey: string | null;
  /** As metricas do aluno (viu, clicou, fechou): por enquanto nada sai daqui. */
  sendEvent: (event: ScreenEvent) => void;
};

type ClosedStore = { read: () => string | null; subscribe: (listener: () => void) => () => void; write: (value: string) => void };

const stores = new Map<string, ClosedStore>();

function closedStore(sessionId: string): ClosedStore {
  const key = screenClosedKey(sessionId);
  const known = stores.get(key);
  if (known) {
    return known;
  }
  const listeners = new Set<() => void>();
  let memory: string | null = null;
  let memoryOnly = false;
  const store: ClosedStore = {
    read() {
      if (memoryOnly) {
        return memory;
      }
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return memory;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    write(value) {
      memory = value;
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        memoryOnly = true;
      }
      listeners.forEach((listener) => listener());
    }
  };
  stores.set(key, store);
  return store;
}

function serverSnapshot(): string | null {
  return null;
}

export function useRoomScreen(input: { sessionId: string; sessionPinned: StudentChatMessage | null; sessionScreen: StudentScreenState | null | undefined }): RoomScreen {
  const { sessionId, sessionPinned, sessionScreen } = input;
  const [state, setState] = useState<StudentScreenState | null>(() => sessionScreen ?? null);
  // A releitura da sessao trouxe um estado: ele vale (na mesma pintura, sem efeito).
  const [source, setSource] = useState(sessionScreen);
  if (source !== sessionScreen) {
    setSource(sessionScreen);
    setState((previous) => adoptScreen(previous, sessionScreen, "session"));
  }

  const stampRef = useRef<string | null>(state?.stamp ?? null);
  useEffect(() => {
    stampRef.current = state?.stamp ?? null;
  }, [state]);

  const getStamp = useCallback(() => stampRef.current, []);
  const onChatScreen = useCallback((incoming: StudentScreenState) => {
    setState((previous) => adoptScreen(previous, incoming, "chat"));
  }, []);

  const store = useMemo(() => closedStore(sessionId), [sessionId]);
  const closedRaw = useSyncExternalStore(store.subscribe, store.read, serverSnapshot);
  const closedIds = useMemo(() => storedClosedIds(closedRaw), [closedRaw]);
  const closeItem = useCallback((displayId: string) => store.write(closedIdsValue(storedClosedIds(store.read()), displayId)), [store]);
  const items = useMemo(() => visibleScreenItems(state?.items ?? [], closedIds), [closedIds, state]);
  const sendEvent = useCallback((event: ScreenEvent) => {
    void event;
  }, []);

  return {
    closeItem,
    getStamp,
    items,
    onChatScreen,
    pinned: state ? state.pinned : sessionPinned,
    pinnedPollId: state?.pinnedPollId ?? null,
    pollsKey: state ? state.pollsKey : null,
    sendEvent
  };
}
