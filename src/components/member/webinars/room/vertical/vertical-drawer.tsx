"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";

// A gaveta da Sala Live vertical (docs/30 §1.6, §1.7 e §9): sobe de baixo por cima do video com as mesmas abas do painel
// da sala (Chat inteiro, Perguntas e, com enquete, Enquetes), cada uma com o mesmo componente do desenho normal. Ao
// abrir, o foco vai para a aba escolhida; Esc (ou "Voltar para o video", ou tocar fora) fecha e o foco volta para o
// botao que abriu (a sala cuida disso). Sem animacao com prefers-reduced-motion. O rodape lembra que, com o celular
// deitado, a sala fica completa.

export type VerticalDrawerTab = "chat" | "enquetes" | "perguntas";

export type VerticalDrawerProps = {
  /** O conteudo da aba aberta (o mesmo do painel do desenho normal). */
  children: ReactNode;
  id: string;
  onClose: () => void;
  onTab: (tab: VerticalDrawerTab) => void;
  /** Ha enquete aberta (o ponto ao lado da aba). */
  pollOpen: boolean;
  reducedMotion: boolean;
  replay: boolean;
  tab: VerticalDrawerTab;
  tabs: readonly VerticalDrawerTab[];
};

export function VerticalDrawer({ children, id, onClose, onTab, pollOpen, reducedMotion, replay, tab, tabs }: VerticalDrawerProps) {
  const copy = WEBINAR_COPY.sala;
  const vcopy = WEBINAR_COPY.vertical;
  const rootRef = useRef<HTMLElement | null>(null);

  // Ao abrir, o foco vai para a aba aberta (uma vez, ao montar).
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      // Esc fecha a gaveta e volta para o video (o Sair da sala so no proximo Esc).
      event.stopPropagation();
      onClose();
    }
  }

  const label = (value: VerticalDrawerTab) => (value === "chat" ? (replay ? copy.abas.chatDaLive : copy.abas.chat) : value === "perguntas" ? copy.abas.perguntas : copy.abas.enquetes);

  return (
    <>
      {/* Tocar fora fecha (so o toque: pelo teclado, o botao e o Esc). */}
      <div aria-hidden="true" className="absolute inset-0 z-40 bg-black/45" data-room-drawer-scrim="" onClick={onClose} />
      <section
        aria-label={vcopy.gavetaRotulo}
        className={cn(
          "absolute inset-x-0 bottom-0 z-50 flex h-[72dvh] max-h-[calc(100%-4rem)] min-w-0 flex-col rounded-t-[20px] border-t border-white/10 bg-[#0f0f0f] shadow-[0_-18px_48px_rgba(0,0,0,0.6)]",
          reducedMotion ? null : "animate-in slide-in-from-bottom-6 fade-in-0 duration-200 motion-reduce:animate-none"
        )}
        data-room-drawer=""
        data-testid="room-panel"
        id={id}
        onKeyDown={handleKeyDown}
        ref={rootRef}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-white/10 pl-1 pr-1">
          <div aria-label={vcopy.gavetaRotulo} className="flex min-w-0 flex-1" role="tablist">
            {tabs.map((value) => (
              <button
                aria-controls={`room-vtab-${value}`}
                aria-selected={tab === value}
                className={cn(
                  "relative h-11 min-w-0 flex-1 truncate px-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white motion-reduce:transition-none",
                  tab === value ? "text-white" : "text-zinc-400 hover:text-white"
                )}
                id={`room-vtabbtn-${value}`}
                key={value}
                onClick={() => onTab(value)}
                role="tab"
                type="button"
              >
                {label(value)}
                {value === "enquetes" && pollOpen ? <span aria-hidden="true" className="ml-1 inline-block size-1.5 rounded-full bg-[var(--accent)] align-middle" /> : null}
                {tab === value ? <span aria-hidden="true" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" /> : null}
              </button>
            ))}
          </div>
          <button
            aria-label={vcopy.voltarAoVideo}
            className="grid size-11 shrink-0 place-items-center rounded-full text-zinc-300 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            data-room-drawer-close=""
            onClick={onClose}
            title={vcopy.voltarAoVideo}
            type="button"
          >
            <ChevronDown aria-hidden="true" className="size-5" />
          </button>
        </div>
        <div aria-labelledby={`room-vtabbtn-${tab}`} className="flex min-h-0 flex-1 flex-col" id={`room-vtab-${tab}`} role="tabpanel">
          {children}
        </div>
        <p className="shrink-0 border-t border-white/10 px-3 py-1.5 text-center text-[11px] text-zinc-500">{vcopy.girar}</p>
      </section>
    </>
  );
}
