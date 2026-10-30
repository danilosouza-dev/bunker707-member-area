"use client";

import { useCallback, useEffect, useState } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { CONSOLE_POLL_MS } from "@/server/webinars/console-model";
import { hideOffer, loadOfferConsole, showOfferNow } from "@/server/webinars/offer-actions";
import type { ConsoleOfferView } from "@/server/webinars/offer-queries";
import { adminToast } from "../../../toast";
import { ConsoleOfferPanel } from "../offer/console-offer-panel";
import { settleConsoleOfferAction } from "../offer/offer-editor-model";

// O painel Oferta do console da Live gravada e do replay (docs/30 §2.4): "Mostrar agora" / "Esconder" (so na sessao
// gravada que nao terminou; o servidor confere de novo) e os cliques por variante ao vivo, pela propria leitura
// (loadOfferConsole) a cada 5 s com a aba visivel e ao voltar para a aba. session-console.tsx monta este painel fora
// da sessao live; o desenho fica em ../offer/console-offer-panel.tsx.

const COPY = WEBINAR_COPY.oferta.console;

export type ConsoleOfferProps = {
  canAct: boolean;
  sessionId: string;
  webinarId: string;
};

type Snapshot = { loadError: string | null; migration: string | null; sessionId: string; view: ConsoleOfferView | null };

export function ConsoleOffer({ canAct, sessionId }: ConsoleOfferProps) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState<"hide" | "show" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await loadOfferConsole({ sessionId });
      setSnapshot((previous) => {
        const kept = previous && previous.sessionId === sessionId ? previous.view : null;
        if (!result.ok) {
          return { loadError: result.error || COPY.erroCarregar, migration: null, sessionId, view: kept };
        }
        if (result.data.pendingMigration) {
          return { loadError: null, migration: result.data.migration, sessionId, view: null };
        }
        return { loadError: null, migration: null, sessionId, view: result.data.view };
      });
    } catch {
      setSnapshot((previous) => ({ loadError: COPY.erroCarregar, migration: null, sessionId, view: previous && previous.sessionId === sessionId ? previous.view : null }));
    }
  }, [sessionId]);

  // Ao abrir, a cada 5 s (so com a aba visivel) e ao voltar para a aba.
  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    const schedule = () => {
      timer = window.setTimeout(async () => {
        if (!stopped && document.visibilityState === "visible") {
          await refresh();
        }
        if (!stopped) {
          schedule();
        }
      }, CONSOLE_POLL_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };
    const first = window.setTimeout(() => void refresh(), 0);
    schedule();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(first);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  async function act(kind: "hide" | "show") {
    const offerId = snapshot?.view?.offer?.id;
    if (!offerId) {
      return;
    }
    setBusy(kind);
    setActionError(null);
    // A rede caida ou um deploy no meio rejeitam a Server Action: os botoes religam e a frase de erro aparece.
    const result = await settleConsoleOfferAction(() => (kind === "show" ? showOfferNow({ offerId, sessionId }) : hideOffer({ offerId, sessionId })), COPY.erro);
    setBusy(null);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setSnapshot({ loadError: null, migration: null, sessionId, view: result.data });
    adminToast.success(kind === "show" ? COPY.mostrada : COPY.escondida);
  }

  const current = snapshot && snapshot.sessionId === sessionId ? snapshot : null;

  return (
    <ConsoleOfferPanel
      actionError={actionError}
      busy={busy}
      canAct={canAct}
      loadError={current?.loadError ?? null}
      migration={current?.migration ?? null}
      onHide={() => void act("hide")}
      onRetry={() => void refresh()}
      onShow={() => void act("show")}
      view={current?.view ?? null}
    />
  );
}
