"use client";

import { useEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type Ref } from "react";
import { cn } from "@/lib/utils";
import { tooltipStep, type TooltipEvent, type TooltipState } from "./room-layout-model";

// A dica da sala no estilo do YouTube (docs/31, a sala no estilo do YouTube; o tooltip do YouTube): a caixa cinza de
// 90 %, texto branco 12/18, 8 px por dentro, raio 4, a 8 px do botao, centrada nele; acima na barra, abaixo no topo e
// no cabecalho do painel. Uma linha; `wide` (o motivo de um desligado) quebra em ate 3 linhas, com 280 px no maximo.
// Fica nos botoes sem rotulo na tela (os circulos, as metades do segmentado, a compacta da Visão, o tema, o X, o
// ordenar e o ⋮) e no desligado com motivo, no lugar do title nativo. O texto ja e o nome acessivel do botao (ou o
// motivo do aria-describedby), entao a dica e sempre aria-hidden.
// Aparece 150 ms depois do ponteiro ou do foco do teclado (so com :focus-visible: o clique nao a chama) e some em 75
// ms (tooltipStep) so quando os dois saem: o ponteiro que passa nao a leva com o foco do teclado ainda no botao, nem o
// foco que sai com o ponteiro em cima; o ponteiro pode ir do botao para a propria dica e ela fica (WCAG 1.4.13). O Esc
// a esconde na hora, onde quer que esteja o foco, e, se ela estava na tela, esse Esc para aqui e nao chega a sala (que
// fecharia a camada de cima ou perguntaria se quer sair); o Esc seguinte segue para a sala. O toque no botao a esconde,
// como no YouTube. Desenhada so no navegador e so quando aparece: o HTML do servidor tem so o envoltorio e o botao. O
// motivo comprido (`wide`) corta na terceira linha num texto de dentro, para o recuo da caixa nao mostrar o topo da
// quarta. So tokens --room-*.

export type RoomTooltipProps = {
  /** O botao (ou o envoltorio dele) que chama a dica. */
  children: ReactElement;
  /**
   * A classe do envoltorio (o padrao e so o `relative inline-flex`), para quem esconde o botao numa largura: com a
   * classe no envoltorio, o botao escondido nao deixa um item vazio (e o vao dele) na linha do pai.
   */
  className?: string;
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

export function RoomTooltip({ children, className, label, side, wide = false }: RoomTooltipProps) {
  const [tip, setTip] = useState<TooltipTip>(HIDDEN);
  const tipRef = useRef<HTMLSpanElement | null>(null);
  // Quem segura a dica, cada um no seu: o ponteiro em cima (do botao ou da propria dica) e o foco do teclado no botao.
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
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

  // O Esc, com o foco no botao ou em qualquer outro lugar (a dica so pelo ponteiro): ouvido na captura da janela, antes
  // da sala. Esconde a dica na hora e, se ela estava na tela (stopped), nao passa adiante: nao chega a sala, nem a
  // camada de cima dela. Esperando para aparecer, o Esc so cancela a espera e segue.
  useEffect(() => {
    if (state === "hidden") {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (tooltipStep(state, { kind: "escape" }).stopped) {
        event.preventDefault();
        event.stopPropagation();
      }
      setTip(HIDDEN);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [state]);

  function onPointerEnter(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.pointerType !== "touch") {
      hoveredRef.current = true;
      send({ kind: "enter" });
    }
  }

  function onPointerLeave(event: ReactPointerEvent<HTMLSpanElement>) {
    if (event.pointerType !== "touch") {
      hoveredRef.current = false;
      const next = event.relatedTarget;
      send({ focused: focusedRef.current, kind: "leave", toTooltip: next instanceof Node && Boolean(tipRef.current?.contains(next)) });
    }
  }

  function onFocus(event: ReactFocusEvent<HTMLSpanElement>) {
    // So o foco do teclado segura a dica; o do clique (sem :focus-visible) nao a chama nem a segura.
    focusedRef.current = focusVisible(event.target);
    if (focusedRef.current) {
      send({ kind: "focus" });
    }
  }

  function onBlur(event: ReactFocusEvent<HTMLSpanElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      focusedRef.current = false;
      send({ hovered: hoveredRef.current, kind: "blur" });
    }
  }

  return (
    <span
      className={cn("relative inline-flex", className)}
      onBlur={onBlur}
      onFocus={onFocus}
      // O toque no botao esconde a dica na hora (o menu ou o painel que ele abre fica no mesmo lado).
      onPointerDown={() => send({ kind: "escape" })}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {children}
      {visible ? <RoomTooltipBubble hiding={state === "hiding"} label={label} ref={tipRef} side={side} wide={wide} /> : null}
    </span>
  );
}

/**
 * A caixa da dica, desenhada so quando ela aparece (a RoomTooltip a chama; exportada para o teste de tela, porque o
 * HTML do servidor nunca a tem). Com `wide`, o corte das 3 linhas fica num texto de dentro: o corte vale na borda do
 * recuo, e no recuo de 8 px da caixa o topo da quarta linha apareceria embaixo das reticencias.
 */
export function RoomTooltipBubble({ hiding, label, ref, side, wide }: { hiding: boolean; label: string; ref?: Ref<HTMLSpanElement>; side: "above" | "below"; wide: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "absolute left-1/2 z-50 w-max -translate-x-1/2 rounded-[4px] bg-room-tooltip-bg p-2 text-left text-xs font-normal leading-[18px] text-room-tooltip-fg transition-opacity duration-75 motion-reduce:transition-none",
        side === "above" ? "bottom-full mb-2" : "top-full mt-2",
        wide ? "max-w-[280px] whitespace-normal" : "whitespace-nowrap",
        hiding ? "opacity-0" : "opacity-100"
      )}
      data-room-tooltip=""
      ref={ref}
    >
      {wide ? <span className="line-clamp-3">{label}</span> : label}
    </span>
  );
}
