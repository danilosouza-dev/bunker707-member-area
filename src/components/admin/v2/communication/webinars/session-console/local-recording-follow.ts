"use client";

import { useCallback, useSyncExternalStore } from "react";

// A escolha "Gravar também neste computador quando eu clicar em Gravar" (docs/30 D142): ligada ate quem apresenta
// desligar, guardada neste navegador.

const KEY = "bunker707:gravacao-local:junto";
const CHANGED = "bunker707:gravacao-local:junto-mudou";

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "nao";
  } catch {
    return true;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useLocalFollow(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, read, () => true);
  const choose = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(KEY, next ? "sim" : "nao");
    } catch {
      // Sem guardar, a escolha continua ligada.
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [on, choose];
}
