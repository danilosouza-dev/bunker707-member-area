"use client";

import { useEffect, useEffectEvent, useSyncExternalStore } from "react";
import type {
  NotificationResponseValue,
  NotificationsFilter,
  NotificationsPage,
  NotificationsSummary
} from "@/server/communications/notification-model";
import type { PopupEvent } from "@/server/communications/campaign-model";
import { isSummaryFresh } from "./notifications-model";

// Conversa do sino e do pop-up com /api/notifications e /api/popups (docs/22 §4.4), mais o numero do
// sino guardado na memoria do navegador. O topo (AppShell) remonta a cada pagina; o numero fica aqui,
// fora do React, vale por 1 minuto (SUMMARY_TTL_MS) e e buscado de novo quando a aba volta a ficar
// visivel e ja passou desse tempo. Cada chamada a API custa uma conferencia de sessao no Auth, entao
// nada aqui roda em intervalo, uma falha tambem conta como tentativa (espera o mesmo minuto) e, na
// home, o resumo com o pop-up (MemberPopupHost) e a unica leitura: o numero do sino vem junto.
//
// Envios que podem sair junto com a pagina (clique num link, eventos do pop-up) vao por
// navigator.sendBeacon, com fetch keepalive de reserva.

export class NotificationsRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "NotificationsRequestError";
    this.status = status;
  }
}

async function readData<T>(response: Response, fallback: string): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };

  if (!response.ok || payload.data === undefined) {
    // 4xx traz a frase do servidor; 5xx e falha de rede ficam com a frase da tela.
    const message = response.status >= 400 && response.status < 500 && payload.error ? payload.error : fallback;
    throw new NotificationsRequestError(message, response.status);
  }

  return payload.data;
}

async function getJson<T>(url: string, fallback: string, signal?: AbortSignal) {
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
  return readData<T>(response, fallback);
}

async function postJson<T>(url: string, body: unknown, fallback: string) {
  const response = await fetch(url, {
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });

  return readData<T>(response, fallback);
}

/** POST que sobrevive a saida da pagina; nunca lanca (registro de clique e evento e melhor esforco). */
function sendBeaconPost(url: string, body?: string) {
  try {
    const data = body === undefined ? undefined : new Blob([body], { type: "text/plain;charset=UTF-8" });

    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url, data)) {
      return;
    }
  } catch {
    // Sem beacon (ou recusado): vai pelo fetch keepalive.
  }

  void fetch(url, {
    body,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "text/plain;charset=UTF-8" },
    keepalive: true,
    method: "POST"
  }).catch(() => undefined);
}

function notificationPath(id: string, action: "click" | "response") {
  return `/api/notifications/${encodeURIComponent(id)}/${action}`;
}

export function fetchNotificationsPage(input: { cursor?: string | null; filter: NotificationsFilter; signal?: AbortSignal }) {
  const params = new URLSearchParams();

  if (input.filter === "unread") {
    params.set("filter", "unread");
  }

  if (input.cursor) {
    params.set("cursor", input.cursor);
  }

  const query = params.toString();

  return getJson<NotificationsPage>(
    query ? `/api/notifications?${query}` : "/api/notifications",
    "Não foi possível carregar as notificações.",
    input.signal
  );
}

export function fetchSummary(input: { popup?: boolean; signal?: AbortSignal } = {}) {
  return getJson<NotificationsSummary>(
    input.popup ? "/api/notifications/summary?popup=1" : "/api/notifications/summary",
    "Não foi possível carregar as notificações.",
    input.signal
  );
}

export type ReadRequest = { seen: true } | { ids: string[] } | { all: true };

export function postRead(body: ReadRequest) {
  return postJson<{ unread: number; unseen: number }>("/api/notifications/read", body, "Não foi possível marcar como lida.");
}

/** Clique num link ou botao da notificacao (tambem marca como lida no servidor). */
export function postClick(id: string) {
  sendBeaconPost(notificationPath(id, "click"));
}

export function postResponse(id: string, response: NotificationResponseValue) {
  return postJson<{ response: NotificationResponseValue }>(
    notificationPath(id, "response"),
    { response },
    "Não foi possível enviar sua resposta. Tente de novo."
  );
}

export function postPopupEvent(id: string, event: PopupEvent) {
  sendBeaconPost(`/api/popups/${encodeURIComponent(id)}/events`, JSON.stringify({ event }));
}

// --- Numero do sino (memoria do navegador) ---------------------------------------------------------

export type NotificationsSummaryState = {
  /** Momento da ultima tentativa (resposta, falha ou atualizacao local); null antes da primeira. */
  fetchedAt: number | null;
  status: "error" | "idle" | "ready";
  unseen: number;
};

const INITIAL_SUMMARY: NotificationsSummaryState = { fetchedAt: null, status: "idle", unseen: 0 };

let summaryState: NotificationsSummaryState = INITIAL_SUMMARY;
let summaryRequest: { popup: boolean; promise: Promise<NotificationsSummary | null> } | null = null;
/** A home vai pedir o resumo junto com o pop-up: ate la, o topo nao pede o seu (um pedido so). */
let summaryHeldForPopup = false;
const summaryListeners = new Set<() => void>();

function setSummaryState(next: NotificationsSummaryState) {
  summaryState = next;
  summaryListeners.forEach((listener) => listener());
}

function subscribeSummary(listener: () => void) {
  summaryListeners.add(listener);
  return () => {
    summaryListeners.delete(listener);
  };
}

function getSummarySnapshot() {
  return summaryState;
}

function getServerSummarySnapshot() {
  return INITIAL_SUMMARY;
}

/** Numero vindo de outra resposta (pagina do painel, resumo do pop-up, marcar como vistas). */
export function setSummaryUnseen(unseen: number) {
  const safe = Number.isFinite(unseen) ? Math.max(0, Math.trunc(unseen)) : 0;
  setSummaryState({ fetchedAt: Date.now(), status: "ready", unseen: safe });
}

/**
 * O pop-up da home (MemberPopupHost) vai pedir o resumo com `popup`: enquanto `held`, o pedido comum do
 * topo (ao voltar para a aba, por exemplo) espera por ele em vez de sair sozinho.
 */
export function holdSummaryForPopup(held: boolean) {
  summaryHeldForPopup = held;
}

/**
 * Busca o numero do sino se o guardado ja passou do prazo (ou com `force`); com `popup`, busca sempre,
 * trazendo junto o pop-up da vez (so a home pede). Um pedido comum aproveita o que ja esta em andamento.
 * Devolve o resumo, ou null quando nao buscou ou falhou. Nunca lanca.
 */
export function refreshNotificationsSummary(options: { force?: boolean; popup?: boolean } = {}): Promise<NotificationsSummary | null> {
  const popup = Boolean(options.popup);

  if (summaryRequest && (summaryRequest.popup || !popup)) {
    return summaryRequest.promise;
  }

  if (!popup && !options.force && (summaryHeldForPopup || isSummaryFresh(summaryState.fetchedAt, Date.now()))) {
    return Promise.resolve(null);
  }

  const promise: Promise<NotificationsSummary | null> = fetchSummary({ popup })
    .then((summary) => {
      setSummaryUnseen(summary.unseen);
      return summary;
    })
    .catch((error: unknown) => {
      // A falha conta como tentativa: troca de pagina e volta para a aba esperam o mesmo minuto (numa
      // queda, nao sai um pedido por pagina). Sessao encerrada (401) zera o numero; o resto mantem.
      const sessionEnded = error instanceof NotificationsRequestError && error.status === 401;

      setSummaryState({
        fetchedAt: Date.now(),
        status: summaryState.status === "ready" && !sessionEnded ? "ready" : "error",
        unseen: sessionEnded ? 0 : summaryState.unseen
      });
      return null;
    })
    .finally(() => {
      if (summaryRequest?.promise === promise) {
        summaryRequest = null;
      }
    });

  summaryRequest = { popup, promise };

  return promise;
}

/**
 * Numero do sino para o topo: busca depois da hidratacao e ao voltar para a aba, respeitando o prazo.
 * `refreshOnMount: false` na home, onde o resumo vem com o pedido do pop-up.
 */
export function useNotificationsSummary(options: { refreshOnMount?: boolean } = {}) {
  const state = useSyncExternalStore(subscribeSummary, getSummarySnapshot, getServerSummarySnapshot);
  const refreshOnMount = options.refreshOnMount ?? true;

  useEffect(() => {
    if (refreshOnMount) {
      void refreshNotificationsSummary();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshNotificationsSummary();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [refreshOnMount]);

  return state;
}

// --- Esc que nao vaza ----------------------------------------------------------------------------

/**
 * Esc fecha so o painel ou o pop-up aberto. A IA Diretor escuta `keydown` no document e fecha com
 * qualquer Esc; o React tambem escuta no document (raiz do App Router), entao stopPropagation num
 * onKeyDown nao a impede. Por isso o Esc e interceptado na captura da window, antes de tudo, quando o
 * foco esta dentro de `isInside` (ou em lugar nenhum).
 */
export function useEscapeToClose(active: boolean, onEscape: () => void, isInside: (target: Node) => boolean) {
  const handleEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing || event.defaultPrevented) {
      return;
    }

    const target = event.target instanceof Node ? event.target : null;
    const focusNowhere = !target || target === document.body || target === document.documentElement || target === document;

    if (!focusNowhere && !(target && isInside(target))) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onEscape();
  });

  useEffect(() => {
    if (!active) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      handleEscape(event);
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [active]);
}
