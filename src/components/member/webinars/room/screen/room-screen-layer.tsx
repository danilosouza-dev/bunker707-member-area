"use client";

import { Fragment, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SCREEN_PLACES, type StudentScreenItem } from "@/server/webinars/screen-model";
import { RoomScreenCard, type ScreenItemHandlers } from "./room-screen-card";
import { SCREEN_CELL_CLASSES, screenAnnouncement, screenArrivals, type ScreenPlacement } from "./room-screen-model";
import { RoomScreenCompactRow } from "./room-screen-strip";

// A camada da Na tela no palco (especificacao de 10/11/2026, §3.2, §3.3 e §3.7): dentro da caixa do palco (aparece
// tambem na Tela cheia e no Modo cinema, que levam a caixa inteira), no plano dos selos (z-20) e abaixo da enquete do
// palco (z-30), sem receber o toque (pointer-events-none: o video por baixo continua clicavel; so os cartoes e as
// pilulas recebem). E o proprio recipiente `@container/tela`: o que vai sobre o video so aparece com 640 px ou mais de
// palco (as variantes @min-[640px]/tela), sem medir em JavaScript; abaixo disso a faixa (room-screen-strip.tsx) mostra
// o mesmo fora do video. Com uma capa no palco, a sala manda tudo para a faixa (data-tela="faixa" e a lista vazia aqui).
// A area segura: 56 px em cima (os selos) e embaixo (os selos de baixo; 96 px quando quem apresenta usa a barra do motor
// na pagina da sala), 12 px a esquerda (16 px a partir de lg) e 12 px mais a coluna de miniaturas a direita
// (--room-video-right). Nela, a grade 3x3 com as nove posicoes (screenPlacement: o banner em cima do QR Code na mesma
// posicao, 8 px; a Oferta dona do canto de baixo a direita; as pilulas das fixadas primeiro na celula de cima a esquerda;
// o aviso de venda simulado da gravada por ultimo nessa celula, para nada que fica mudar de lugar quando ele passa). Na
// tela cheia de verdade com o palco estreito (a faixa de fora nao aparece la), a linha compacta de 48 px na borda de
// cima, abaixo dos selos. Ficam no DOM depois dos selos do palco e antes da barra: o Tab passa pelo link e pelo X e segue.
// RoomScreenAnnouncer: o anuncio educado de cada chegada (a saida e silenciosa). O que sai so do palco largo quando um
// item ocupa o lugar dele (as pilulas do chat, o selo do Assistente) e room-wide-hidden.tsx.

export type RoomScreenLayerProps = {
  /** Quem apresenta usa a barra do motor na pagina da sala: a margem de baixo e 96 px. */
  engineBar?: boolean;
  /** A capa no palco: nada sobre o video (a faixa mostra tudo). */
  forced: boolean;
  /** A Tela cheia de verdade: a linha compacta no palco estreito. */
  fullscreen: boolean;
  handlers?: ScreenItemHandlers;
  /** O banner e o QR Code que o aluno ainda ve (a linha compacta da tela cheia). */
  items: readonly StudentScreenItem[];
  /** As pilulas das fixadas (RoomPinnedPills), a primeira entrada da celula de cima a esquerda. */
  pinned: ReactNode;
  /** Onde cada coisa fica (screenPlacement, ja com a capa e a Oferta). */
  placement: ScreenPlacement;
  /** O aviso de venda simulado da gravada: o ultimo da celula de cima a esquerda, em qualquer largura. */
  topLeftExtra?: ReactNode;
};

/** As celulas que a camada desenha: as do placement e, com o aviso de venda, a de cima a esquerda. */
export function RoomScreenLayer({ engineBar = false, forced, fullscreen, handlers, items, pinned, placement, topLeftExtra = null }: RoomScreenLayerProps) {
  const compact = fullscreen && items.length > 0;
  return (
    <div className="@container/tela pointer-events-none absolute inset-0 z-20" data-room-screen-layer="" data-tela={forced ? "faixa" : undefined}>
      <div className={cn("absolute left-3 right-[calc(var(--room-video-right,0px)+12px)] top-14 lg:left-4", engineBar ? "bottom-24" : "bottom-14")} data-room-screen-area="">
        {SCREEN_PLACES.map((place) => {
          const cell = placement.cells.find((candidate) => candidate.place === place);
          const extra = place === "top_left" ? topLeftExtra : null;
          if (!cell && !extra) {
            return null;
          }
          return (
            <div className={cn("absolute flex max-h-full max-w-full flex-col gap-2", SCREEN_CELL_CLASSES[place])} data-room-screen-cell={place} key={place}>
              {cell?.entries.map((entry) =>
                entry.kind === "pinned" ? (
                  <Fragment key="pinned">{pinned}</Fragment>
                ) : (
                  <RoomScreenCard className="hidden @min-[640px]/tela:flex" handlers={handlers} item={entry.item} key={entry.item.displayId} />
                )
              )}
              {extra}
            </div>
          );
        })}
      </div>
      {compact ? (
        <div className={cn("absolute inset-x-3 top-[42px] flex-col gap-1.5", forced ? "flex" : "flex @min-[640px]/tela:hidden")} data-room-screen-compact="">
          {items.map((item) => (
            <RoomScreenCompactRow form="strip" handlers={handlers} item={item} key={item.displayId} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Um anuncio educado por chegada ("A equipe colocou um banner na tela: {título}." / "A equipe mostrou um QR Code:
 * {legenda}. O link está no botão Abrir o link."): o que ja estava quando a sala abriu nao e anunciado, e a saida e
 * silenciosa. Cada anuncio e um paragrafo novo dentro da regiao polida (o mesmo texto de novo tambem e lido).
 */
export function RoomScreenAnnouncer({ items }: { items: readonly StudentScreenItem[] }) {
  const ids = items.map((item) => item.displayId).join("|");
  const [state, setState] = useState(() => ({ ids, known: items.map((item) => item.displayId), n: 0, text: "" }));
  if (state.ids !== ids) {
    const arrivals = screenArrivals(state.known, items);
    setState({
      ids,
      known: items.map((item) => item.displayId),
      n: arrivals.length > 0 ? state.n + 1 : state.n,
      text: arrivals.length > 0 ? screenAnnouncement(arrivals) : state.text
    });
  }
  return (
    <div aria-live="polite" className="sr-only" data-room-screen-announce="">
      {state.text ? <p key={state.n}>{state.text}</p> : null}
    </div>
  );
}
