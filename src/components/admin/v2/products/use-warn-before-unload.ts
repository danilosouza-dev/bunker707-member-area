"use client";

import { useEffect } from "react";

/** Avisa antes de fechar ou recarregar a aba enquanto houver alteracao nao salva (docs/17 §1.6.3). */
export function useWarnBeforeUnload(active: boolean) {
  useEffect(() => {
    if (!active) {
      return;
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Navegadores antigos so mostram o aviso com returnValue preenchido.
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [active]);
}
