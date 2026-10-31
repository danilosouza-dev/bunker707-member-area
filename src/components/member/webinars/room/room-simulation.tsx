"use client";

import { ShoppingBag, UserMinus, UserPlus } from "lucide-react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import { announcedSaleNotice, visibleJoin, visibleSaleNotice } from "@/server/webinars/simulation-model";
import type { RoomSimulationState } from "./use-room-simulation";

// O que a Simulacao mostra na sala (docs/30 §1.6, §1.7 e §9): a entrada ou saida simulada no chat ("Ana M. entrou",
// acima do campo, por 8 s ou ate a proxima) e o aviso de venda num toast discreto por 4 s por cima do palco (no topo,
// na sala vertical). Os dois sao so visuais (aria-hidden): o leitor de tela nunca ouve cada entrada, e os avisos de
// venda chegam por uma regiao aria-live="polite" no maximo um por minuto. Com prefers-reduced-motion, nada desliza.
// Sem nada ligado na sessao, nada aparece. webinar-room.tsx monta os dois; o estado vem de use-room-simulation.ts.
// Redesign V2, F3 (docs/31 V2-4): no palco, o aviso de venda fica abaixo da linha dos selos de cima (o canto de cima a
// esquerda e do "Ao vivo" e do "Gravando").

const COPY = WEBINAR_COPY.simulacao.aluno;

export type RoomSimulationViewProps = {
  layout: "stage" | "vertical";
  offsetMs: number;
  reducedMotion: boolean;
  state: RoomSimulationState;
};

/** A linha "Ana M. entrou" no chat (acima do campo de mensagem). */
export function RoomSimulationJoins({ layout, offsetMs, reducedMotion, state }: RoomSimulationViewProps) {
  const join = visibleJoin(state.joins, offsetMs);
  if (!join) {
    return null;
  }
  const Icon = join.left ? UserMinus : UserPlus;

  return (
    <p
      aria-hidden="true"
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs",
        layout === "vertical" ? "px-1 text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]" : "mx-3 mt-2 text-room-fg-subtle",
        !reducedMotion && "animate-in fade-in-0 slide-in-from-bottom-1 duration-300"
      )}
      data-room-simulation-join={join.left ? "saiu" : "entrou"}
      key={`${join.atMs}:${join.name}`}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="truncate">{join.left ? COPY.saiu(join.name) : COPY.entrou(join.name)}</span>
    </p>
  );
}

/** O aviso de venda por cima do palco (ou no topo da sala vertical) e a frase do leitor de tela. */
export function RoomSimulationSales({ layout, offsetMs, reducedMotion, state }: RoomSimulationViewProps) {
  if (!state.enabled && state.saleNotices.length === 0) {
    return null;
  }
  const notice = visibleSaleNotice(state.saleNotices, offsetMs);
  const announced = announcedSaleNotice(state.saleNotices, offsetMs);

  return (
    <>
      <p aria-live="polite" className="sr-only" data-room-simulation-announce="">
        {announced ? `${COPY.rotuloAviso}: ${announced.text}` : ""}
      </p>
      {notice ? (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute z-10 flex max-w-[min(22rem,calc(100%-1.5rem))] items-center gap-2 rounded-[12px] border border-white/15 bg-black/75 px-3 py-2 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-sm",
            layout === "vertical" ? "inset-x-0 top-14 mx-auto w-fit" : "left-4 top-14",
            !reducedMotion && "animate-in fade-in-0 slide-in-from-top-2 duration-300"
          )}
          data-room-simulation-sale=""
          key={`${notice.atMs}:${notice.text}`}
        >
          <ShoppingBag aria-hidden="true" className="size-4 shrink-0 text-[var(--accent)]" />
          <span className="min-w-0 truncate">{notice.text}</span>
        </div>
      ) : null}
    </>
  );
}
