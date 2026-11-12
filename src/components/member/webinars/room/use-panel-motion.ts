"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

// A transicao do painel lateral da sala e do console (rodada v9, P12; pedido do produtor em 12/11/2026: "o efeito
// quando a pessoa clica para abrir o chat ou qualquer coisa na sidebar e muito seco e sem suavidade"). O painel desliza
// 16 px e esmaece em 220 ms, so com transform e opacity: a largura do palco (o iframe do motor de video) muda uma vez
// so, no comeco ao abrir e no fim ao fechar, nunca a cada quadro (animar a largura faria o video se redimensionar a
// cada quadro e engasgar). Abrindo: o painel entra no layout na hora (o palco encolhe de uma vez) e aparece com a
// entrada. Fechando: o painel continua no layout durante a saida (`laid`) e so depois some (o palco cresce de uma
// vez). Trocar de aba ou de entrada: o conteudo novo esmaece. Com "reduzir movimento" no sistema nada anima: abrir e
// fechar valem na hora, como antes. No HTML do servidor e ate a primeira pintura do navegador tambem nada anima (o
// painel guardado fechado some sem passar pela saida).

/** A duracao da entrada e da saida do painel. */
export const PANEL_MOTION_MS = 220;

export type PanelMotionPhase = "closing" | "idle" | "opening";

export type PanelMotion = {
  /** As classes da fase (vazio parado). */
  className: string;
  /** O painel ocupa lugar no layout: aberto, ou ainda saindo. O palco so cresce quando isto vira falso. */
  laid: boolean;
  phase: PanelMotionPhase;
};

/** Parado: o que o HTML do servidor e os testes de tela usam. */
export const PANEL_MOTION_IDLE: PanelMotion = { className: "", laid: true, phase: "idle" };

// As classes inteiras, escritas por extenso: o Tailwind so gera a classe que encontra como texto no arquivo.

/** A entrada: da direita a partir de lg e no celular deitado (o painel ao lado do palco) e de baixo no celular em pe (o painel abaixo do palco). */
export const PANEL_ENTER_CLASS =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 motion-safe:max-lg:landscape:slide-in-from-bottom-0 motion-safe:max-lg:landscape:slide-in-from-right-4 motion-safe:lg:slide-in-from-bottom-0 motion-safe:lg:slide-in-from-right-4 motion-safe:duration-[220ms] motion-safe:ease-out";

/** A saida: o caminho de volta; o fim fica parado ate o painel sumir e nada nele recebe o toque. */
export const PANEL_EXIT_CLASS =
  "pointer-events-none motion-safe:animate-out motion-safe:fade-out-0 motion-safe:slide-out-to-bottom-3 motion-safe:max-lg:landscape:slide-out-to-bottom-0 motion-safe:max-lg:landscape:slide-out-to-right-4 motion-safe:lg:slide-out-to-bottom-0 motion-safe:lg:slide-out-to-right-4 motion-safe:duration-[220ms] motion-safe:ease-in motion-safe:fill-mode-forwards";

/** O conteudo que troca (a aba ou a entrada nova): so esmaece, sem deslizar. */
export const PANEL_SWAP_CLASS = "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-200 motion-safe:ease-out";

/**
 * A fase depois de uma mudanca do aberto/fechado, pura: sem movimento (o sistema pede, ou a pagina ainda nao pintou)
 * nada anima; abrindo, a entrada; fechando, a saida.
 */
export function panelMotionPhase(input: { armed: boolean; open: boolean; reducedMotion: boolean }): PanelMotionPhase {
  if (!input.armed || input.reducedMotion) {
    return "idle";
  }
  return input.open ? "opening" : "closing";
}

/** O que cada fase desenha: `laid` e o aberto de agora ou a saida em curso. */
export function panelMotionOf(open: boolean, phase: PanelMotionPhase): PanelMotion {
  if (phase === "closing" && !open) {
    return { className: PANEL_EXIT_CLASS, laid: true, phase };
  }
  if (phase === "opening" && open) {
    return { className: PANEL_ENTER_CLASS, laid: true, phase };
  }
  return { className: "", laid: open, phase: "idle" };
}

/** Verdadeiro depois da primeira pintura do navegador: ate la (o HTML do servidor, a escolha guardada) nada anima. */
function useArmed(): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setArmed(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);
  return armed;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(listener: () => void): () => void {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION) : null;
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}

function readReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION).matches;
}

/** A transicao de abrir e fechar do painel: a fase, as classes e se ele ainda ocupa lugar. */
export function usePanelMotion(open: boolean): PanelMotion {
  const armed = useArmed();
  // "Reduzir movimento" do sistema, seguindo a mudanca: com ele, abrir e fechar valem na hora.
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const [last, setLast] = useState(open);
  const [phase, setPhase] = useState<PanelMotionPhase>("idle");
  if (last !== open) {
    setLast(open);
    setPhase(panelMotionPhase({ armed, open, reducedMotion }));
  }

  useEffect(() => {
    if (phase === "idle") {
      return undefined;
    }
    const timer = window.setTimeout(() => setPhase("idle"), PANEL_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [phase, open]);

  return panelMotionOf(open, phase);
}

/**
 * As classes do conteudo que troca dentro do painel (a aba, a entrada do Mais): vazio ate a primeira troca feita pela
 * pessoa (a carga da pagina nao esmaece), depois o esmaecer em cada troca.
 */
export function usePanelSwapClass(key: string): string {
  const armed = useArmed();
  const [last, setLast] = useState(key);
  const [swapped, setSwapped] = useState(false);
  if (last !== key) {
    setLast(key);
    if (armed && !swapped) {
      setSwapped(true);
    }
  }
  return swapped ? PANEL_SWAP_CLASS : "";
}
