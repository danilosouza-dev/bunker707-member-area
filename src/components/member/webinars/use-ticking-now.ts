"use client";

import { useSyncExternalStore } from "react";

// Relogio que anda no navegador para a contagem regressiva (docs/30 §1.1): a hora atual em passos de 15 s,
// sem setState em efeito. No servidor e na hidratacao vale a hora que a pagina trouxe (serverNow), entao o
// primeiro desenho do navegador e igual ao do servidor; depois o relogio assume e tambem avanca quando a
// aba volta a ficar visivel.

const STEP_MS = 15_000;

let cachedBucket = 0;

function subscribe(callback: () => void) {
  const id = window.setInterval(callback, STEP_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") {
      callback();
    }
  };

  document.addEventListener("visibilitychange", onVisible);

  return () => {
    window.clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

function snapshot() {
  const bucket = Math.floor(Date.now() / STEP_MS) * STEP_MS;

  if (bucket !== cachedBucket) {
    cachedBucket = bucket;
  }

  return cachedBucket;
}

/** A hora atual (ms) em passos de 15 s; `serverNow` ate o navegador assumir. */
export function useTickingNow(serverNow: number) {
  return useSyncExternalStore(subscribe, snapshot, () => serverNow);
}
