"use client";

import { Radio, X } from "lucide-react";
import type { ReactNode } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";

// A pilula do Minimizar (docs/30 §1.3 e §1.7): no canto inferior, 56 px de altura, com o player pequeno (o som
// continua), o selo e Voltar; Sair fecha a sala. O pop-up da Comunicacao nao abre com a pilula no ar: o palco
// continua anunciando o sinal de midia (lesson-media-signal) por dentro dela.

export function RoomPill({ children, live, onLeave, onRestore, title }: { children: ReactNode; live: boolean; onLeave: () => void; onRestore: () => void; title: string }) {
  const copy = WEBINAR_COPY.sala;

  return (
    <div className="flex h-14 items-center gap-2 pr-2" data-testid="room-pill">
      <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-l-[14px] bg-black">{children}</div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-[11px] font-semibold text-zinc-300">
          {live ? <Radio aria-hidden="true" className="size-3 text-[var(--accent)]" /> : null}
          {live ? copy.aoVivo : copy.salaMinimizada}
        </p>
        <p className="truncate text-sm font-bold text-white">{title}</p>
      </div>
      <button
        className="h-9 shrink-0 rounded-full bg-white px-3 text-xs font-extrabold text-black hover:bg-zinc-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        onClick={onRestore}
        type="button"
      >
        {copy.voltar}
      </button>
      <button aria-label={copy.sair} className="grid size-9 shrink-0 place-items-center rounded-full text-zinc-300 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white" onClick={onLeave} type="button">
        <X aria-hidden="true" className="size-4" />
      </button>
    </div>
  );
}
