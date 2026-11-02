"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { roomPillClassName } from "./room-pill";
import { chipArrows, chipScrollBy } from "./room-questions-model";
import { ROOM_FOCUS } from "./room-ui";

// Os chips da sala no estilo do YouTube (docs/31, a sala no estilo do YouTube): os filtros das Perguntas no painel e,
// abaixo de lg, as abas da folha. So da sala do aluno: o console continua com as abas em pilula (RoomTabList). O chip
// tem 32 px, raio 8, 14/20 peso 500 e recuo de 12; o escolhido e o branco do YouTube (--room-active-bg), os outros o
// tonal (--room-control), com o hover tonal do botao (o YouTube nao tem regra de hover no chip: inferido). A troca de
// fundo e instantanea, como na pilula, e o pressionado e a mesma sombra por dentro. Como filtro (`toggle`), o estado vai
// em aria-pressed, com um so ligado; como aba (`tab`), em role="tab" com aria-selected.
// A linha de chips (RoomChipBar, spec §7.3; B §2) e uma linha so que rola de lado sem barra. Quando os chips nao cabem,
// entram as setas da barra de chips do YouTube: um circulo S de texto com a seta de 18, a 16 px da ponta, sobre o fundo
// do painel e um degrade de 50 px, so do lado que esconde chip (chipArrows, conferido no scroll e pelo ResizeObserver).
// As setas sao so do ponteiro (aria-hidden e fora do Tab; o teclado chega a cada chip pelo Tab e o chip focado rola
// para a vista, parando fora da seta pelo scroll-padding); com toque (hover: none), so o degrade. O clique rola 80 % da
// largura visivel (chipScrollBy), suave ou na hora com movimento reduzido. O chip escolhido entra na vista ao montar e
// ao escolher.

const CHIP_BASE = cn(
  "inline-flex h-8 shrink-0 select-none items-center justify-center whitespace-nowrap rounded-[8px] px-3 text-sm font-medium leading-5 active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)] disabled:bg-room-control disabled:text-room-fg-disabled disabled:shadow-none disabled:hover:bg-room-control",
  ROOM_FOCUS
);

/** Um chip: o escolhido em branco, os outros no tonal. */
export function RoomChip({
  as = "toggle",
  className,
  selected,
  touch44 = false,
  type = "button",
  ...props
}: Omit<ComponentProps<"button">, "aria-pressed" | "aria-selected" | "role"> & {
  /** Filtro (aria-pressed) ou aba (role="tab" e aria-selected). */
  as?: "tab" | "toggle";
  selected: boolean;
  /** A area de toque de 44 px abaixo de lg (o chip tem 32). */
  touch44?: boolean;
}) {
  return (
    <button
      {...props}
      aria-pressed={as === "toggle" ? selected : undefined}
      aria-selected={as === "tab" ? selected : undefined}
      className={cn(
        CHIP_BASE,
        selected ? "bg-room-active-bg text-room-active-fg hover:bg-room-active-hover" : "bg-room-control text-room-fg hover:bg-room-control-hover",
        touch44 ? "relative after:absolute after:-inset-1.5 lg:after:hidden" : undefined,
        className
      )}
      role={as === "tab" ? "tab" : undefined}
      type={type}
    />
  );
}

const CHIP_BAR_BOX = {
  // No painel: 4 px em cima e 16 dos lados para o anel de foco do chip; o chip focado para depois da seta e do degrade.
  panel: "px-4 pb-2 pt-1 [scroll-padding-inline:98px]",
  // Na folha do celular (abaixo de lg).
  sheet: "-m-1 p-1 [scroll-padding-inline:54px]"
} as const;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** A linha de chips que rola de lado: os filtros das Perguntas (group) ou as abas da folha (tablist). */
export function RoomChipBar({
  children,
  label,
  role,
  selectedKey,
  variant
}: {
  children: ReactNode;
  /** O nome da linha, para o leitor de tela. */
  label: string;
  role: "group" | "tablist";
  /** O chip escolhido (muda: ele entra na vista). */
  selectedKey: string;
  variant: "panel" | "sheet";
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [arrows, setArrows] = useState({ left: false, right: false });

  // As setas so do lado que esconde chip: no scroll, quando a linha muda de tamanho e quando os chips mudam.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const measure = () => {
      const next = chipArrows({ clientWidth: box.clientWidth, scrollLeft: box.scrollLeft, scrollWidth: box.scrollWidth });
      setArrows((previous) => (previous.left === next.left && previous.right === next.right ? previous : next));
    };
    measure();
    box.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(box);
    for (const child of box.children) {
      observer?.observe(child);
    }
    return () => {
      box.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [selectedKey]);

  // O escolhido sempre a vista: ao montar e ao escolher.
  useEffect(() => {
    const selected = boxRef.current?.querySelector<HTMLElement>('[aria-pressed="true"], [aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedKey]);

  function scrollBy(direction: -1 | 1) {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const reduced = typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
    box.scrollBy({ behavior: reduced ? "auto" : "smooth", left: chipScrollBy({ clientWidth: box.clientWidth, direction }) });
  }

  const inset = variant === "panel" ? { left: "left-4", right: "right-4" } : { left: "left-0", right: "right-0" };

  return (
    <div className="relative">
      <div
        aria-label={label}
        className={cn("flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", CHIP_BAR_BOX[variant])}
        ref={boxRef}
        role={role}
      >
        {children}
      </div>
      {arrows.left ? (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 flex" data-room-chip-fade="left">
            <span className="w-12 bg-room-panel [@media(hover:none)]:hidden" />
            <span className="w-[50px] bg-gradient-to-r from-room-panel to-transparent" />
          </div>
          <button
            aria-hidden="true"
            className={roomPillClassName({ className: cn("absolute top-1 [@media(hover:none)]:hidden", inset.left), shape: "circle", size: "s", tone: "text" })}
            data-room-chip-arrow="left"
            onClick={() => scrollBy(-1)}
            onMouseDown={(event) => event.preventDefault()}
            tabIndex={-1}
            type="button"
          >
            <ChevronLeft aria-hidden="true" strokeWidth={2} />
          </button>
        </>
      ) : null}
      {arrows.right ? (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex flex-row-reverse" data-room-chip-fade="right">
            <span className="w-12 bg-room-panel [@media(hover:none)]:hidden" />
            <span className="w-[50px] bg-gradient-to-l from-room-panel to-transparent" />
          </div>
          <button
            aria-hidden="true"
            className={roomPillClassName({ className: cn("absolute top-1 [@media(hover:none)]:hidden", inset.right), shape: "circle", size: "s", tone: "text" })}
            data-room-chip-arrow="right"
            onClick={() => scrollBy(1)}
            onMouseDown={(event) => event.preventDefault()}
            tabIndex={-1}
            type="button"
          >
            <ChevronRight aria-hidden="true" strokeWidth={2} />
          </button>
        </>
      ) : null}
    </div>
  );
}
