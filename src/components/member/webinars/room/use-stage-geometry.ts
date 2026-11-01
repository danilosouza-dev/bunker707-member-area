"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { LIVE_ROOM_RULES } from "./live-room-model";

// A medida do lugar do iframe da Live ao vivo (docs/31 V2-A5): a largura do [data-live-frame] (a do iframe, que o ocupa
// inteiro) pelo ResizeObserver, para a sala decidir a coluna de miniaturas (columnWanted), e se o aparelho tem toque,
// que deixa o puxador da coluna mais largo (stageVideoRightPx). A primeira medida vale na hora; as seguintes, quando a
// largura para de mudar por LIVE_ROOM_RULES.frameSettleMs (abrir ou fechar o painel, girar, a janela arrastada), sem
// repintar a sala a cada quadro. O servidor e a primeira pintura nao medem: largura 0 e sem toque. O toque e contado
// como o motor conta (navigator.maxTouchPoints, environment/utils.web.ts da tag), nao pelo pointer: coarse, que um
// notebook com tela de toque nao marca. Nenhuma frase de tela aqui.

export type StageGeometry = {
  /** A largura do iframe em px (inteira); 0 antes da primeira medida. */
  frameWidth: number;
  /** Um aparelho com toque: o puxador da coluna de miniaturas do motor tem 21 px, nao 9. */
  touch: boolean;
};

function subscribeNothing() {
  return () => undefined;
}

function readTouch() {
  try {
    return navigator.maxTouchPoints > 0;
  } catch {
    return false;
  }
}

export function useStageGeometry(frameRef: RefObject<HTMLElement | null>): StageGeometry {
  const [frameWidth, setFrameWidth] = useState(0);
  const touch = useSyncExternalStore(subscribeNothing, readTouch, () => false);

  useEffect(() => {
    const element = frameRef.current;
    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }
    let timer = 0;
    let measured = false;
    const measure = () => setFrameWidth(Math.round(element.getBoundingClientRect().width));
    const observer = new ResizeObserver(() => {
      if (!measured) {
        measured = true;
        measure();
        return;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(measure, LIVE_ROOM_RULES.frameSettleMs);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [frameRef]);

  return { frameWidth, touch };
}
