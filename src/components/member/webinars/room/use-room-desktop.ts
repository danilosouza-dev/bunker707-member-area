"use client";

// O computador (1024 px ou mais), lido do navegador e acompanhado quando a janela muda de largura. Sem janela (o
// servidor e a primeira pintura), falso: o que so existe no computador entra depois da hidratacao, sem pular.

import { useSyncExternalStore } from "react";

/** A largura do computador na sala (a mesma do `lg` do Tailwind). */
export const ROOM_DESKTOP_QUERY = "(min-width: 1024px)";

function subscribe(callback: () => void) {
  try {
    const media = window.matchMedia(ROOM_DESKTOP_QUERY);
    media.addEventListener("change", callback);
    return () => media.removeEventListener("change", callback);
  } catch {
    return () => undefined;
  }
}

function read() {
  try {
    return window.matchMedia(ROOM_DESKTOP_QUERY).matches;
  } catch {
    return false;
  }
}

export function useRoomDesktop(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
