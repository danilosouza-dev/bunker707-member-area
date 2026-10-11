"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Le uma media query sem efeito colateral de estado. No servidor devolve `serverValue`;
 * a aparencia de cada breakpoint e resolvida em CSS, entao isto so ajusta comportamento.
 */
export function useMediaQuery(query: string, serverValue = false) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mediaQuery = window.matchMedia(query);
      mediaQuery.addEventListener("change", onChange);

      return () => mediaQuery.removeEventListener("change", onChange);
    },
    [query]
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue
  );
}
