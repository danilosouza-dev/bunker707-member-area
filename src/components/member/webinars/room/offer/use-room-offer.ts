"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { StudentOfferView } from "@/server/webinars/model";
import { OFFER_POLL_MS, offerCountdownText, offerWindowKey, shouldShowOffer } from "@/server/webinars/offer-room-model";
import { clockSkewMs } from "@/server/webinars/room-model";
import { getStudentOffer, postOfferClick, WebinarsRequestError } from "./offer-api";

// Os dados vivos do card da Oferta (docs/30 §1.6 e §5.1), fora do desenho: a leitura ao montar, no intervalo que o
// servidor pede (60 s; 20 s quando a equipe pode mostrar ou esconder agora), ao voltar para a aba e ao cruzar o minuto
// da janela (a sessao gravada grava ali o que mostrou); o relogio de 1 s so com uma oferta na mao (a janela pelo
// segundo do video e o prazo pela hora do servidor); o clique abre o checkout em outra aba sem `opener` (a aba nasce
// no clique, para o navegador nao bloquear, e recebe o link quando a resposta chega). No "ver como" nada e gravado.

const TICK_MS = 1000;
const CROSSING_DELAY_MS = 1500;
const COPY = WEBINAR_COPY.oferta.aluno;
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(callback: () => void) {
  try {
    const query = window.matchMedia(REDUCED_MOTION);
    query.addEventListener("change", callback);
    return () => query.removeEventListener("change", callback);
  } catch {
    return () => undefined;
  }
}

function readReducedMotion() {
  try {
    return window.matchMedia(REDUCED_MOTION).matches;
  } catch {
    return false;
  }
}

/** prefers-reduced-motion, seguindo a mudanca: o card entra sem animacao com ele ligado. */
export function useOfferReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
}

export type RoomOfferState = {
  /** A frase do leitor de tela (aria-live polite): muda uma vez quando o card aparece numa janela. */
  announcement: string;
  busy: boolean;
  /** "12:34" ate o prazo real; nulo sem prazo ou depois dele. */
  countdown: string | null;
  ended: boolean;
  error: string | null;
  /** O navegador bloqueou a aba: o link vai num botao (o aluno toca de novo). */
  fallbackUrl: string | null;
  shown: boolean;
  view: StudentOfferView | null;
  windowKey: string | null;
};

export function useRoomOffer(input: { enabled: boolean; getOffsetMs: () => number; readOnly: boolean; sessionId: string; webinarId: string }) {
  const { enabled, readOnly, sessionId, webinarId } = input;
  const getOffsetRef = useRef(input.getOffsetMs);
  const refreshRef = useRef<(() => void) | null>(null);
  const skewRef = useRef(0);
  const crossedKeyRef = useRef<string | null>(null);
  const [view, setView] = useState<StudentOfferView | null>(null);
  const [clock, setClock] = useState<{ nowMs: number; offsetMs: number }>({ nowMs: 0, offsetMs: Number.NaN });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  useEffect(() => {
    getOffsetRef.current = input.getOffsetMs;
  });

  // A leitura: ao montar, no intervalo do servidor e ao voltar para a aba (uma por vez).
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let stopped = false;
    let loading = false;
    let timer: number | null = null;
    const controller = new AbortController();

    const load = async () => {
      if (loading || stopped) {
        return;
      }
      loading = true;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      let next = OFFER_POLL_MS;
      try {
        const answer = await getStudentOffer(webinarId, sessionId, controller.signal);
        if (!stopped) {
          skewRef.current = clockSkewMs({ requestSentAtMs: answer.sentAtMs, responseReceivedAtMs: answer.receivedAtMs, serverTimeMs: Date.parse(answer.data.serverTime) });
          setView(answer.data.offer);
          next = answer.data.pollMs > 0 ? answer.data.pollMs : OFFER_POLL_MS;
        }
      } catch {
        // Sem resposta, o card que estava continua; a proxima tentativa vem no proximo passo.
      } finally {
        loading = false;
      }
      if (!stopped) {
        timer = window.setTimeout(() => void load(), next);
      }
    };

    refreshRef.current = () => void load();
    const first = window.setTimeout(() => void load(), 0);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void load();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(first);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", onVisible);
      refreshRef.current = null;
    };
  }, [enabled, sessionId, webinarId]);

  // O relogio de 1 s, so com uma oferta na mao.
  useEffect(() => {
    if (!enabled || !view) {
      return;
    }
    const tick = () => setClock({ nowMs: Date.now() + skewRef.current, offsetMs: getOffsetRef.current() });
    const first = window.setTimeout(tick, 0);
    const id = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [enabled, view]);

  const shown = enabled && view !== null && shouldShowOffer(view, clock.offsetMs);
  const windowKey = view ? offerWindowKey(view) : null;
  const deadlineMs = view?.deadlineAt ? Date.parse(view.deadlineAt) : Number.NaN;
  const msLeft = Number.isFinite(deadlineMs) && clock.nowMs > 0 ? deadlineMs - clock.nowMs : null;
  const ended = msLeft !== null && msLeft <= 0;
  const countdown = msLeft !== null && msLeft > 0 ? offerCountdownText(msLeft) : null;

  // Ao cruzar o minuto da janela: a sala rele (na gravada, o servidor grava ali a janela da sessao e o prazo real),
  // um pouco depois do minuto, para o relogio do servidor ja ter passado dele.
  useEffect(() => {
    if (!shown || !windowKey || crossedKeyRef.current === windowKey) {
      return;
    }
    crossedKeyRef.current = windowKey;
    if (!view || view.visible) {
      return;
    }
    const id = window.setTimeout(() => refreshRef.current?.(), CROSSING_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [shown, view, windowKey]);

  const buy = useCallback(async () => {
    if (!view || readOnly || busy) {
      return;
    }
    // A aba nasce no clique (o navegador nao bloqueia) e perde o `opener` antes de receber o link.
    const tab = window.open("about:blank", "_blank");
    if (tab) {
      try {
        tab.opener = null;
      } catch {
        // Alguns navegadores nao deixam mexer: o link ainda abre na aba nova.
      }
    }
    setBusy(true);
    setError(null);
    setFallbackUrl(null);
    try {
      const { url } = await postOfferClick(webinarId, { offerId: view.offerId, offsetMs: getOffsetRef.current(), sessionId });
      if (tab && !tab.closed) {
        tab.location.replace(url);
      } else {
        setFallbackUrl(url);
      }
    } catch (failure) {
      tab?.close();
      setError(failure instanceof WebinarsRequestError ? failure.message : COPY.erro);
      if (failure instanceof WebinarsRequestError && failure.reason === "offer_hidden") {
        refreshRef.current?.();
      }
    } finally {
      setBusy(false);
    }
  }, [busy, readOnly, sessionId, view, webinarId]);

  const state: RoomOfferState = {
    announcement: shown && view ? COPY.anuncio(view.headline) : "",
    busy,
    countdown,
    ended,
    error,
    fallbackUrl,
    shown,
    view,
    windowKey
  };

  return { buy, state };
}
