"use client";

import Link from "next/link";
import { CalendarClock, X } from "lucide-react";
import { useEffect, useSyncExternalStore, type MouseEvent } from "react";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import { MEMBER_ROUTES } from "@/lib/member-navigation";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import {
  LIVE_BANNER_STORAGE_KEY,
  LIVE_NOW_POLL_MS,
  LIVE_NOW_REVISIT_MS,
  liveBannerAllowedOn,
  liveBannerView,
  parseDismissals,
  parseLiveNowData,
  withDismissal,
  type LiveBannerView,
  type LiveNowData
} from "@/server/webinars/live-banner";
import { useTickingNow } from "./use-ticking-now";

// A faixa do topo de todas as paginas da area (docs/30 §1.1, §1.5, §1.7 e §2.7): "Ao vivo agora · {titulo} · Entrar"
// para a live no ar mais recente (com mais de uma, "+1 ao vivo" leva a /webinarios) e, para quem garantiu vaga, de
// 60 min antes ate a hora, "Comeca em 1 h: Entrar" (a conta desce). Uma linha logo abaixo do cabecalho, a 375 px
// tambem (o titulo encurta; o X tem 44 px); o anuncio e discreto (aria-live polite). O X dispensa por 1 dia naquele
// navegador (localStorage em try/catch; sem ele, vale ate recarregar). Nunca na propria sala, no login nem no Modo TV
// (liveBannerAllowedOn) e nunca no "ver como" da equipe (o AppShell nao a monta). Carregada a parte (next/dynamic,
// sem SSR): nada no JS inicial das paginas.
//
// Os dados vem de GET /api/webinars/live-now a cada 60 s e ao voltar para a aba (se a ultima resposta tem 15 s ou
// mais), numa memoria do modulo: trocar de pagina nao pergunta de novo antes da hora. A conta usa a hora do servidor
// (a diferenca para o relogio do aparelho medida em cada resposta). Resposta fora da forma, link de fora, 401 ou falha
// de rede: a faixa some ate a proxima resposta boa.

const LIVE_NOW_PATH = "/api/webinars/live-now";
/** De quanto em quanto a faixa confere se ja e hora de perguntar de novo. */
const CHECK_MS = 5_000;

type LiveNowSnapshot = { data: LiveNowData; receivedAt: number; skewMs: number };

let current: LiveNowSnapshot | null = null;
let lastAttemptAt = 0;
let inflight: Promise<void> | null = null;
const dataListeners = new Set<() => void>();

function subscribeData(callback: () => void) {
  dataListeners.add(callback);
  return () => {
    dataListeners.delete(callback);
  };
}

const readData = () => current;
const readNoData = () => null;

function refreshLiveNow(): Promise<void> {
  if (inflight) {
    return inflight;
  }
  lastAttemptAt = Date.now();
  inflight = (async () => {
    const sentAt = Date.now();
    try {
      const response = await fetch(LIVE_NOW_PATH, { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
      const payload = response.ok ? ((await response.json().catch(() => null)) as { data?: unknown } | null) : null;
      const data = parseLiveNowData(payload?.data);
      const receivedAt = Date.now();
      current = data ? { data, receivedAt, skewMs: Date.parse(data.serverTime) - Math.round((sentAt + receivedAt) / 2) } : null;
    } catch {
      current = null;
    } finally {
      inflight = null;
      for (const listener of dataListeners) {
        listener();
      }
    }
  })();
  return inflight;
}

/* O X: o mapa chave -> ate quando, lido uma vez do localStorage; outra aba que dispensa avisa pelo evento storage. */

const NO_DISMISSALS: Record<string, number> = {};
let dismissals: Record<string, number> | null = null;
const dismissListeners = new Set<() => void>();

function readDismissals(): Record<string, number> {
  if (dismissals) {
    return dismissals;
  }
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(LIVE_BANNER_STORAGE_KEY);
  } catch {
    // Sem localStorage (aba privada, bloqueado): nada dispensado.
  }
  dismissals = parseDismissals(raw, Date.now());
  return dismissals;
}

const readNoDismissals = () => NO_DISMISSALS;

function notifyDismissals() {
  for (const listener of dismissListeners) {
    listener();
  }
}

function onStorage(event: StorageEvent) {
  if (event.key === LIVE_BANNER_STORAGE_KEY || event.key === null) {
    dismissals = null;
    notifyDismissals();
  }
}

function subscribeDismissals(callback: () => void) {
  dismissListeners.add(callback);
  if (dismissListeners.size === 1) {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    dismissListeners.delete(callback);
    if (dismissListeners.size === 0) {
      window.removeEventListener("storage", onStorage);
    }
  };
}

function dismiss(key: string) {
  const next = withDismissal(readDismissals(), key, Date.now());
  dismissals = next;
  try {
    window.localStorage.setItem(LIVE_BANNER_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Sem localStorage: vale so ate recarregar a pagina.
  }
  notifyDismissals();
}

/** A faixa desenhada (sem estado: o teste a desenha no Node com cada `view`). */
export function LiveNowStrip({
  onDismiss,
  onNavigate,
  view
}: {
  onDismiss: (key: string) => void;
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  view: LiveBannerView;
}) {
  const copy = WEBINAR_COPY.faixa;
  const live = view.kind === "live";

  return (
    <aside
      aria-label={copy.rotulo}
      className="fixed inset-x-0 top-16 z-30 border-b border-white/10 bg-[#141414]/95 text-white shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur"
      data-live-now-kind={view.kind}
    >
      <div className="mx-auto flex h-11 w-full min-w-0 max-w-[104rem] items-center gap-2 pl-4 pr-0.5 sm:gap-3 sm:pl-6 sm:pr-3">
        {live ? (
          <span aria-hidden="true" className="relative flex size-2.5 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--accent)] opacity-60 motion-reduce:animate-none" />
            <span className="relative inline-flex size-2.5 rounded-full bg-[var(--accent)]" />
          </span>
        ) : (
          <CalendarClock aria-hidden="true" className="size-4 shrink-0 text-[var(--accent)]" strokeWidth={2.2} />
        )}
        <p className="min-w-0 flex-1 truncate text-[13px] sm:text-sm">
          {live ? (
            <>
              <span className="font-semibold">{copy.aoVivoAgora}</span>
              <span aria-hidden="true" className="text-zinc-500">
                {" · "}
              </span>
            </>
          ) : null}
          <span className="text-zinc-200">{view.title}</span>
        </p>
        <Link
          className={memberButtonClassName({ className: "h-8 px-3", size: "sm", variant: live ? "accent" : "primary" })}
          href={view.href}
          onClick={onNavigate ? (event) => onNavigate(event, view.href) : undefined}
        >
          {live ? copy.entrar : view.label}
        </Link>
        {live && view.more > 0 ? (
          <Link
            className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-2 text-xs font-semibold text-zinc-300 outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            href={MEMBER_ROUTES.webinars}
            onClick={onNavigate ? (event) => onNavigate(event, MEMBER_ROUTES.webinars) : undefined}
          >
            {copy.maisAoVivo(view.more)}
          </Link>
        ) : null}
        <button
          aria-label={copy.dispensar}
          className="grid size-11 shrink-0 place-items-center rounded-full text-zinc-400 outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-white"
          onClick={() => onDismiss(view.key)}
          title={copy.dispensar}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </aside>
  );
}

export function LiveNowBanner({
  onNavigate,
  pathname
}: {
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  pathname: string | null;
}) {
  const enabled = liveBannerAllowedOn(pathname);
  const snapshot = useSyncExternalStore(subscribeData, readData, readNoData);
  const dismissed = useSyncExternalStore(subscribeDismissals, readDismissals, readNoDismissals);
  const deviceNow = useTickingNow(snapshot?.receivedAt ?? 0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const refreshIfOlder = (minAgeMs: number) => {
      if (document.visibilityState === "visible" && Date.now() - lastAttemptAt >= minAgeMs) {
        void refreshLiveNow();
      }
    };
    const onVisible = () => refreshIfOlder(LIVE_NOW_REVISIT_MS);

    refreshIfOlder(LIVE_NOW_POLL_MS);
    const id = window.setInterval(() => refreshIfOlder(LIVE_NOW_POLL_MS), CHECK_MS);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  if (!enabled) {
    return null;
  }

  const view = snapshot ? liveBannerView(snapshot.data, deviceNow + snapshot.skewMs, dismissed) : null;

  return (
    <div aria-live="polite" data-live-now-banner="">
      {view ? <LiveNowStrip onDismiss={dismiss} onNavigate={onNavigate} view={view} /> : null}
    </div>
  );
}
