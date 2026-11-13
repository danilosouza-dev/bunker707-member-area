"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { StudentChatMessage } from "@/server/webinars/model";
import type { StudentScreenComment } from "@/server/webinars/screen-comment-model";
import type { ScreenEventForm, StudentScreenItem, StudentScreenState } from "@/server/webinars/screen-model";
import { beaconScreenEvents, postScreenEvents } from "../room-api";
import {
  adoptScreen,
  closedIdsValue,
  createScreenEventSender,
  createShownWatcher,
  screenClosedKey,
  screenSeenKey,
  SCREEN_SHOWN_RATIO,
  storedClosedIds,
  visibleScreenItems,
  type ScreenEvent,
  type ScreenEventSender,
  type ShownWatcher
} from "./room-screen-model";

// A "Na tela" na sala do aluno (docs/30 §5.1; especificacao de 10/11/2026, §3 e §5.2): o estado do que a turma ve na
// frente da sessao, a mensagem fixada, a enquete fixada, o banner e o QR Code. Chega por dois caminhos:
// - a leitura da sessao (a pagina, a releitura de 60 s e a volta para a aba, useRoomClock): sempre adotada;
// - a consulta de 5 s do chat (useRoomChat), que manda o carimbo que a sala tem (`getStamp`) e traz o estado so quando
//   ele mudou (`onChatScreen`).
// O aluno que fecha um banner ou QR Code fecha so aquela exibicao, guardada no sessionStorage da aba (recarregar nao
// traz de volta; um novo Mostrar e outra exibicao). Lido por useSyncExternalStore (o HTML do servidor e a primeira
// pintura saem sem nada fechado); sem armazenamento, vale a memoria ate recarregar; toda leitura e escrita em try/catch.
// As metricas do aluno (§7; useRoomScreenEvents): o "viu" de cada cartao e linha pelo IntersectionObserver (50 % ou
// mais na tela por 1 s seguido, com a aba visivel e sem a enquete do palco por cima), uma vez por exibicao (os vistos
// no sessionStorage), mandado depois de 0 a 5 s ao acaso por POST .../screen-events; o clique e o fechar na hora, pelo
// sendBeacon; no pagehide e ao sair da sala, o que esperava vai pelo sendBeacon. As regras ficam em room-screen-model.ts
// (createShownWatcher, createScreenEventSender); aqui so o navegador. Nada e medido no "ver como" (`enabled` falso).
// O estado leva tambem o resumo da decisao da Simulacao (`simulationKey`, docs/30 D79): a sala o passa ao
// useRoomSimulation, que pede a janela de novo quando ele muda (os participantes simulados mudados no ar em segundos).

export type { ScreenEvent };

export type RoomScreen = {
  /** Fecha o banner ou o QR Code para este aluno (so os que podem ser fechados). */
  closeItem: (displayId: string) => void;
  /** O comentario ou a pergunta que a equipe trouxe para a tela (rodada v9, docs/30 D89); nulo sem nada. */
  comment: StudentScreenComment | null;
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
  /**
   * O resumo da decisao da Simulacao (docs/30 D79): mudou, a sala pede a janela da Simulacao de novo (useRoomSimulation).
   * Vazio sem decisao; nulo sem estado.
   */
  simulationKey: string | null;
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

  return {
    closeItem,
    comment: state?.comment ?? null,
    getStamp,
    items,
    onChatScreen,
    pinned: state ? state.pinned : sessionPinned,
    pinnedPollId: state?.pinnedPollId ?? null,
    pollsKey: state ? state.pollsKey : null,
    simulationKey: state ? (state.simulationKey ?? "") : null
  };
}

/* ------------------------------------------------------------------------------------------------
 * As metricas: viu, clicou, fechou
 * ---------------------------------------------------------------------------------------------- */

/** Registra um cartao ou uma linha para o "viu"; devolve o desligar. */
export type ScreenWatch = (element: Element, displayId: string, form: ScreenEventForm) => () => void;

export type RoomScreenEvents = {
  /** Clicou ou fechou (na hora, pelo sendBeacon); o "viu" chega sozinho pelo `watch`. */
  sendEvent: (event: ScreenEvent) => void;
  watch: ScreenWatch;
};

/** Os vistos de uma sessao no sessionStorage (sem armazenamento, so na memoria ate recarregar). */
function seenStore(sessionId: string): { add: (displayId: string) => void; has: (displayId: string) => boolean } {
  const key = screenSeenKey(sessionId);
  let memory: string[] = [];
  const read = () => {
    try {
      return storedClosedIds(window.sessionStorage.getItem(key));
    } catch {
      return memory;
    }
  };
  return {
    add(displayId) {
      const value = closedIdsValue(read(), displayId);
      memory = storedClosedIds(value);
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        // Sem armazenamento: vale a memoria.
      }
    },
    has: (displayId) => read().includes(displayId) || memory.includes(displayId)
  };
}

const setTimer = (callback: () => void, ms: number): unknown => window.setTimeout(callback, ms);
const clearTimer = (id: unknown) => window.clearTimeout(id as number);

function tabVisible(): boolean {
  try {
    return document.visibilityState !== "hidden";
  } catch {
    return true;
  }
}

/**
 * As metricas da Na tela para a sala: `watch` registra cada cartao e linha (os componentes chamam num efeito; o
 * registro vale antes e depois de o envio ligar), `sendEvent` manda o clique e o fechar. `enabled` falso (o "ver como",
 * a sala fora do ar para a pessoa) desliga tudo; `pollOver` e a enquete no meio do palco, que para a conta do "viu".
 */
export function useRoomScreenEvents(input: { enabled: boolean; pollOver: boolean; sessionId: string; webinarId: string }): RoomScreenEvents {
  const { enabled, pollOver, sessionId, webinarId } = input;
  const runtimeRef = useRef<{ observer: IntersectionObserver | null; sender: ScreenEventSender; watcher: ShownWatcher } | null>(null);
  const registryRef = useRef(new Map<Element, { displayId: string; form: ScreenEventForm }>());
  const pollOverRef = useRef(pollOver);

  useEffect(() => {
    pollOverRef.current = pollOver;
    runtimeRef.current?.watcher.setGlobal({ pollOver });
  }, [pollOver]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const registry = registryRef.current;
    const sender = createScreenEventSender({
      beacon: (body) => beaconScreenEvents(webinarId, body),
      clearTimer,
      post: (body) => postScreenEvents(webinarId, body),
      random: Math.random,
      seen: seenStore(sessionId),
      sessionId,
      setTimer
    });
    const watcher = createShownWatcher({
      clearTimer,
      onShown: (displayId, form) => sender.send({ displayId, form, name: "shown" }),
      pollOver: pollOverRef.current,
      setTimer,
      visible: tabVisible()
    });
    const observer =
      typeof IntersectionObserver === "function"
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                const info = registry.get(entry.target);
                if (info) {
                  watcher.update(entry.target, { ...info, intersecting: entry.isIntersecting && entry.intersectionRatio >= SCREEN_SHOWN_RATIO });
                }
              }
            },
            { threshold: [0, SCREEN_SHOWN_RATIO, 1] }
          )
        : null;
    const runtime = { observer, sender, watcher };
    runtimeRef.current = runtime;
    for (const element of registry.keys()) {
      observer?.observe(element);
    }
    const onVisibility = () => watcher.setGlobal({ visible: tabVisible() });
    const onPageHide = () => sender.flushAll();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      observer?.disconnect();
      watcher.dispose();
      // Sair da sala (ou desligar) leva o que esperava o atraso: o "viu" ja ficou marcado como mandado.
      sender.flushAll();
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
    };
  }, [enabled, sessionId, webinarId]);

  const watch = useCallback<ScreenWatch>((element, displayId, form) => {
    registryRef.current.set(element, { displayId, form });
    runtimeRef.current?.observer?.observe(element);
    return () => {
      registryRef.current.delete(element);
      runtimeRef.current?.observer?.unobserve(element);
      runtimeRef.current?.watcher.remove(element);
    };
  }, []);

  const sendEvent = useCallback((event: ScreenEvent) => {
    runtimeRef.current?.sender.send(event);
  }, []);

  return useMemo(() => ({ sendEvent, watch }), [sendEvent, watch]);
}

/** O cartao ou a linha que conta o "viu": a ref do elemento, registrada no `watch` enquanto ele esta montado. */
export function useScreenShownRef<T extends Element>(watch: ScreenWatch | null | undefined, displayId: string, form: ScreenEventForm) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !watch) {
      return;
    }
    return watch(element, displayId, form);
  }, [displayId, form, watch]);
  return ref;
}
