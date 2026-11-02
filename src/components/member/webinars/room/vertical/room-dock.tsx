"use client";

import type { ReactNode } from "react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import { cn } from "@/lib/utils";
import type { RoomDesign } from "./vertical-model";

// A doca da sala (docs/30 §1.6, §6.6 e §9): o lugar do card da Oferta nos dois desenhos e, no vertical, o chat por cima
// do video com o degrade para leitura, a pilula da Oferta a direita e o compositor compacto embaixo. Fica montada nos
// dois desenhos (e escondida com a gaveta aberta): o card da Oferta continua no mesmo lugar da arvore e nao perde o
// estado ao girar o aparelho (fechado continua fechado, nada e lido de novo). No desenho normal as duas caixas sao
// `contents` (nao geram caixa): o card fica no canto do palco como sempre. O degrade e parado (nada anima).

export type RoomDockProps = {
  /** O chat por cima (so no vertical). */
  chat: ReactNode;
  /** O compositor compacto (so no vertical). */
  composer: ReactNode;
  design: RoomDesign;
  /** Com a gaveta aberta: a doca some (o card da Oferta continua montado, sem buscar nada). */
  hidden: boolean;
  /** <RoomOffer layout="stage" | "vertical" />, sempre neste lugar. */
  offer: ReactNode;
};

export function RoomDock({ chat, composer, design, hidden, offer }: RoomDockProps) {
  const vertical = design === "vertical";

  return (
    <div
      aria-label={vertical ? WEBINAR_COPY.vertical.rotulo : undefined}
      className={
        vertical
          ? cn(
              "pointer-events-none absolute inset-x-0 bottom-0 z-20 flex max-h-full min-w-0 flex-col justify-end gap-2 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-16",
              hidden && "hidden"
            )
          : hidden
            ? "hidden"
            : "contents"
      }
      data-room-slot="dock"
      role={vertical ? "group" : undefined}
    >
      {vertical ? chat : null}
      {/* So os filhos recebem o toque (a faixa inteira deixa o toque passar para o video). */}
      <div className={vertical ? "pointer-events-none flex min-w-0 justify-end [&>*]:pointer-events-auto" : "contents"} data-room-slot="offer">
        {offer}
      </div>
      {vertical ? composer : null}
    </div>
  );
}
