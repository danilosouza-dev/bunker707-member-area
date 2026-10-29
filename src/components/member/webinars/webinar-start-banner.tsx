"use client";

import Link from "next/link";
import { Radio, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { memberButtonClassName } from "@/components/member/ui/member-button";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { bannerLabel, type StartBanner } from "@/server/webinars/student-model";
import { useTickingNow } from "./use-ticking-now";

// A faixa "Comeca em 1 h: Entrar" (docs/30 §1.1): uma linha no topo, logo abaixo do cabecalho, para quem
// garantiu vaga, de 60 min antes ate a hora marcada (a conta desce: "Comeca em 12 min"). O X dispensa por
// 1 dia naquele navegador (localStorage, por sessao do webinario); sem localStorage, so some ate recarregar.
// Nunca dentro da propria sala (fase 3) e nunca no "ver como" da equipe (a pagina nao a monta).

const DISMISS_MS = 24 * 60 * 60_000;
const listeners = new Set<() => void>();

function storageKey(sessionId: string) {
  return `bunker707:webinar-banner:${sessionId}`;
}

function subscribe(callback: () => void) {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

function readDismissed(sessionId: string): "no" | "yes" {
  try {
    const until = Number(window.localStorage.getItem(storageKey(sessionId)));
    return Number.isFinite(until) && until > Date.now() ? "yes" : "no";
  } catch {
    return "no";
  }
}

const memoryDismissed = new Set<string>();

function dismiss(sessionId: string) {
  memoryDismissed.add(sessionId);
  try {
    window.localStorage.setItem(storageKey(sessionId), String(Date.now() + DISMISS_MS));
  } catch {
    // Sem localStorage: vale so ate recarregar.
  }
  for (const listener of listeners) {
    listener();
  }
}

export function WebinarStartBanner({ banner, serverNow }: { banner: StartBanner; serverNow: number }) {
  const copy = WEBINAR_COPY.aluno;
  const dismissed = useSyncExternalStore(
    subscribe,
    () => (memoryDismissed.has(banner.sessionId) ? "yes" : readDismissed(banner.sessionId)),
    () => "unknown"
  );
  const now = useTickingNow(serverNow);
  const label = bannerLabel(banner.scheduledAt, now);

  if (dismissed !== "no" || !label) {
    return null;
  }

  return (
    <div
      className="fixed inset-x-0 top-16 z-30 flex items-center justify-center gap-2 border-b border-white/10 bg-[#141414]/95 px-3 py-2 text-sm text-white backdrop-blur sm:gap-3 sm:px-6"
      data-webinar-banner=""
      role="status"
    >
      <Radio aria-hidden="true" className="size-4 shrink-0 text-[var(--accent)]" />
      <p className="min-w-0 truncate">
        <span className="font-semibold">{label}</span>
        <span className="text-zinc-400"> · </span>
        <span className="text-zinc-200">{banner.title}</span>
      </p>
      <Link className={memberButtonClassName({ size: "sm", variant: "primary" })} href={banner.href}>
        {copy.entrar}
      </Link>
      <button
        aria-label={copy.fecharAviso}
        className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-400 outline-none transition hover:bg-white/[0.08] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
        onClick={() => dismiss(banner.sessionId)}
        type="button"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
