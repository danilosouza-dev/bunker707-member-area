"use client";

import { useEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { cn } from "@/lib/utils";
import { tooltipStep, type TooltipEvent, type TooltipState } from "./room-layout-model";

// A dica da sala no estilo do YouTube (docs/31, a sala no estilo do YouTube; o tooltip do YouTube): a caixa cinza de
// 90 %, texto branco 12/18, 8 px por dentro, raio 4, a 8 px do botao, centrada nele; acima na barra, abaixo no topo e
// no cabecalho do painel. Uma linha; `wide` (o motivo de um desligado) quebra em ate 3 linhas, com 280 px no maximo.
// Fica nos botoes sem rotulo na tela (os circulos, as metades do segmentado, a compacta da Visão, o tema, o X, o
// ordenar e o ⋮) e no desligado com motivo, no lugar do title nativo. O texto ja e o nome acessivel do botao (ou o
// motivo do aria-describedby), entao a dica e sempre aria-hidden.
// Aparece 150 ms depois do ponteiro ou do foco do teclado (so com :focus-visible: o clique nao a chama) e some em 75
// ms (tooltipStep); o ponteiro pode ir do botao para a propria dica e ela fica (WCAG 1.4.13). O Esc a esconde na hora:
// com o foco no botao, esse Esc para aqui e nao chega a sala (que perguntaria se quer sair); com a dica so pelo
// ponteiro, ele a esconde e segue para quem o recebeu. O toque no botao a esconde, como no YouTube. Desenhada so no
// navegador e so quando aparece: o HTML do servidor tem so o envoltorio e o botao. So tokens --room-*.

export type RoomTooltipProps = {
  /** O botao (ou o envoltorio dele) que chama a dica. */
  children: ReactElement;
  /** O texto da dica: o nome do botao, ou o motivo do desligado. */
  label: string;
  /** Acima do botao (a barra) ou abaixo (o topo e o cabecalho do painel). */
  side: "above" | "below";
  /** Ate 3 linhas, com 280 px no maximo (o motivo de um desligado). */
  wide?: boolean;
};

type TooltipTip = { delayMs: number | null; state: TooltipState };

const HIDDEN: TooltipTip = { delayMs: null, state: "hidden" };

/** Um passo da dica (tooltipStep), com o mesmo objeto quando nada muda (sem pintar de novo). */
function advance(current: TooltipTip, event: TooltipEvent): TooltipTip {
  const step = tooltipStep(current.state, event);
  return step.state === current.state ? current : { delayMs: step.delayMs, state: step.state };
}

/** O :focus-visible do navegador (o foco do teclado, nao o do clique). */
function focusVisible(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return false;
  }
}

export function RoomTooltip({ children, label, side, wide = false }: RoomTooltipProps) {
  const [tip, setTip] = useState<TooltipTip>(HIDDEN);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  const { delayMs, state } = tip;
  const visible = state === "shown" || state === "hiding";

  function send(event: TooltipEvent) {
    setTip((current) => advance(current, event));
  }

  // A espera de cada passo (150 ms para aparecer, 75 para sumir), recomecada so quando o passo muda.
  useEffect(() => {
    if (delayMs === null) {
      return;
    }
    const timer = window.setTimeout(() => setTip((current) => advance(current, { kind: "elapsed" })), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, state]);

  // Na tela so pelo ponteiro (o foco esta em outro lugar): o Esc tambem a esconde, e segue para quem o recebeu.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !(event.target instanceof Node && wrapperRef.current?.contains(event.target))) {
        setTip(HIDDEN);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [visible]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLSpanElement>) {
    if (event.key !== "Escape") {
      return;
    }
    const step = tooltipStep(state, { kind: "escape" });
    if (step.stopped) {
      event.preventDefault();
      event.stopPropagation();
    }
    setTip(HIDDEN);
  }

  function onPointerEnter(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.pointerType !== "touch") {
      send({ kind: "enter" });
    }
  }

  function onPointerLeave(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.pointerType !== "touch") {
      const next = event.relatedTarget;
      send({ kind: "leave", toTooltip: next instanceof Node && Boolean(tipRef.current?.contains(next)) });
    }
  }

  function onFocus(event: ReactFocusEvent<HTMLSpanElement>) {
    if (focusVisible(event.target)) {
      send({ kind: "focus" });
    }
  }

  function onBlur(event: ReactFocusEvent<HTMLSpanElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      send({ kind: "blur" });
    }
  }

  return (
    <span
      className="relative inline-flex"
      onBlur={onBlur}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      // O toque no botao esconde a dica na hora (o menu ou o painel que ele abre fica no mesmo lado).
      onPointerDown={() => send({ kind: "escape" })}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      ref={wrapperRef}
    >
      {children}
      {visible ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-1/2 z-50 w-max -translate-x-1/2 rounded-[4px] bg-room-tooltip-bg p-2 text-left text-xs font-normal leading-[18px] text-room-tooltip-fg transition-opacity duration-75 motion-reduce:transition-none",
            side === "above" ? "bottom-full mb-2" : "top-full mt-2",
            wide ? "max-w-[280px] whitespace-normal line-clamp-3" : "whitespace-nowrap",
            state === "hiding" ? "opacity-0" : "opacity-100"
          )}
          data-room-tooltip=""
          ref={tipRef}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}
