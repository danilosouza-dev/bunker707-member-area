"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { ANSWER_AUTHOR_DEFAULT, ANSWER_AUTHOR_STORAGE_KEY, parseAnswerAuthorChoice, type AnswerAuthorChoice } from "@/server/webinars/answer-author-model";
import {
  CONSOLE_PANEL_KEY,
  CONSOLE_THEME_KEY,
  deferredPollsValue,
  ROOM_PANEL_KEY,
  ROOM_POLLS_KEY,
  ROOM_THEME_KEY,
  ROOM_VIEW_KEY,
  storedConsoleTheme,
  storedDeferredPolls,
  storedPanelOpen,
  storedRoomTheme,
  storedRoomView,
  type DeferredPolls,
  type RoomTheme,
  type RoomView
} from "@/lib/webinar-room-prefs";

// As escolhas da sala guardadas no navegador da pessoa (docs/31 V2-7, V2-10, V2-12 e V2-16), lidas por
// useSyncExternalStore como o espelho de use-jitsi-devices.ts: o HTML do servidor e a primeira pintura saem no padrao
// (o escuro, o painel aberto, o Palco, nada para depois), sem erro de hidratacao, e a escolha guardada entra logo
// depois da hidratacao. Quem guardou o tema claro ou o painel fechado ve o padrao ate o JS hidratar (docs/31 V2-7 e
// V2-12). A enquete no palco e o card "deixou para depois" dependem do que esta guardado: a sala so os desenha depois
// da hidratacao (useRoomHydrated), senao a enquete deixada para depois piscaria no palco a cada carga. Outra aba muda
// pelo evento "storage"; a mesma aba, pelo aviso aos ouvintes. Sem armazenamento (aba privada, bloqueado), vale a
// memoria ate recarregar. Toda leitura e escrita fica em try/catch. O console de quem apresenta (docs/31 V2-12 e V2-13)
// usa o mesmo molde com as chaves proprias dele (useConsoleTheme e useConsolePanelOpen, abaixo).

type PrefStore = {
  read: () => string | null;
  subscribe: (listener: () => void) => () => void;
  write: (value: string) => void;
};

function serverSnapshot(): string | null {
  return null;
}

function subscribeNothing() {
  return () => undefined;
}

/**
 * Depois da hidratacao: falso no HTML do servidor e na pintura que hidrata, verdadeiro logo em seguida (na mesma
 * pintura em que as escolhas guardadas entram). O que depende do que esta guardado espera por ele.
 */
export function useRoomHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false
  );
}

function prefStore(key: string): PrefStore {
  const listeners = new Set<() => void>();
  let memory: string | null = null;
  /** A escrita falhou: daqui em diante vale a memoria (o armazenamento pode ate ler, mas ficou para tras). */
  let memoryOnly = false;

  function onStorage(event: StorageEvent) {
    if (event.key === key || event.key === null) {
      listeners.forEach((listener) => listener());
    }
  }

  return {
    read() {
      if (memoryOnly) {
        return memory;
      }
      try {
        return window.localStorage.getItem(key);
      } catch {
        return memory;
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        window.addEventListener("storage", onStorage);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          window.removeEventListener("storage", onStorage);
        }
      };
    },
    write(value) {
      memory = value;
      try {
        window.localStorage.setItem(key, value);
      } catch {
        memoryOnly = true;
      }
      listeners.forEach((listener) => listener());
    }
  };
}

const themeStore = prefStore(ROOM_THEME_KEY);
const panelStore = prefStore(ROOM_PANEL_KEY);
const viewStore = prefStore(ROOM_VIEW_KEY);
const pollsStore = prefStore(ROOM_POLLS_KEY);
const consoleThemeStore = prefStore(CONSOLE_THEME_KEY);
const consolePanelStore = prefStore(CONSOLE_PANEL_KEY);
const answerAuthorStore = prefStore(ANSWER_AUTHOR_STORAGE_KEY);

function useStoredValue(store: PrefStore): string | null {
  return useSyncExternalStore(store.subscribe, store.read, serverSnapshot);
}

/** O tema da sala (escuro por padrao) e a troca, guardada para a proxima vez. */
export function useRoomTheme(): [RoomTheme, (theme: RoomTheme) => void] {
  const theme = storedRoomTheme(useStoredValue(themeStore));
  const setTheme = useCallback((next: RoomTheme) => themeStore.write(next), []);
  return [theme, setTheme];
}

/** O painel do chat aberto (o padrao) ou fechado. */
export function useRoomPanelOpen(): [boolean, (open: boolean) => void] {
  const open = storedPanelOpen(useStoredValue(panelStore));
  const setOpen = useCallback((next: boolean) => panelStore.write(next ? "1" : "0"), []);
  return [open, setOpen];
}

/** A visao do video que o aluno escolheu (Palco por padrao). */
export function useRoomView(): [RoomView, (view: RoomView) => void] {
  const view = storedRoomView(useStoredValue(viewStore));
  const setView = useCallback((next: RoomView) => viewStore.write(next), []);
  return [view, setView];
}

/** As enquetes desta sessao deixadas para depois e os resultados ja vistos (outra sessao comeca vazia). */
export function useDeferredPolls(sessionId: string): [DeferredPolls, (polls: DeferredPolls) => void] {
  const raw = useStoredValue(pollsStore);
  const polls = useMemo(() => storedDeferredPolls(raw, sessionId), [raw, sessionId]);
  const setPolls = useCallback((next: DeferredPolls) => pollsStore.write(deferredPollsValue(sessionId, next)), [sessionId]);
  return [polls, setPolls];
}

/** O tema do console de quem apresenta (escuro por padrao), na chave propria (docs/31 V2-12 e V2-13). */
export function useConsoleTheme(): [RoomTheme, (theme: RoomTheme) => void] {
  const theme = storedConsoleTheme(useStoredValue(consoleThemeStore));
  const setTheme = useCallback((next: RoomTheme) => consoleThemeStore.write(next), []);
  return [theme, setTheme];
}

/** O painel do console aberto (o padrao) ou fechado, na chave propria. */
export function useConsolePanelOpen(): [boolean, (open: boolean) => void] {
  const open = storedPanelOpen(useStoredValue(consolePanelStore));
  const setOpen = useCallback((next: boolean) => consolePanelStore.write(next ? "1" : "0"), []);
  return [open, setOpen];
}

/** A escolha guardada de "Responder como" (o texto do armazenamento conferido; fora da forma, o padrao). */
export function storedAnswerAuthor(raw: string | null): AnswerAuthorChoice {
  if (!raw) {
    return ANSWER_AUTHOR_DEFAULT;
  }
  try {
    return parseAnswerAuthorChoice(JSON.parse(raw));
  } catch {
    return ANSWER_AUTHOR_DEFAULT;
  }
}

/**
 * "Responder como" do console (rodada v9, docs/30 D87): Meu nome (o padrao), Equipe ou Outro nome, lembrado no navegador
 * de quem responde para a proxima resposta e a proxima live.
 */
export function useConsoleAnswerAuthor(): [AnswerAuthorChoice, (choice: AnswerAuthorChoice) => void] {
  const raw = useStoredValue(answerAuthorStore);
  const choice = useMemo(() => storedAnswerAuthor(raw), [raw]);
  const setChoice = useCallback((next: AnswerAuthorChoice) => answerAuthorStore.write(JSON.stringify({ as: next.as, name: next.name ?? null })), []);
  return [choice, setChoice];
}
