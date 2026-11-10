import type { ReactNode } from "react";

// A Na tela (especificacao de 10/11/2026, §3.2): o que sai do palco de 640 px ou mais quando um banner ou QR Code ocupa
// o lugar dele e continua no palco estreito, onde o item esta na faixa abaixo do video. Modulo folha (so o React): os
// selos do palco (room-stage-badges.tsx, que o console tambem usa) e as duas salas importam sem trazer a camada.

/**
 * O que sai do palco largo quando um item ocupa o lugar dele (as pilulas do chat com um item na fileira de baixo ou "No
 * meio"; o selo do Assistente com um item embaixo a direita) e continua no palco estreito, onde o item esta na faixa:
 * um recipiente `@container/tela` que cobre a caixa do palco (a mesma caixa: quem esta dentro se posiciona igual) e o
 * conteudo escondido a partir de 640 px. Sem `hidden`, o conteudo como sempre (o HTML de antes).
 */
export function RoomWideHidden({ children, hidden }: { children: ReactNode; hidden: boolean }) {
  if (!hidden) {
    return <>{children}</>;
  }
  return (
    <div className="@container/tela pointer-events-none absolute inset-0 z-20" data-room-wide-hidden="">
      <div className="contents @min-[640px]/tela:hidden">{children}</div>
    </div>
  );
}
