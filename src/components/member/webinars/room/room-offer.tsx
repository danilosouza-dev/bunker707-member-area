"use client";

import { useEffect, useState } from "react";
import { OfferPill, OfferStageCard } from "./offer/offer-card-view";
import { useOfferReducedMotion, useRoomOffer } from "./offer/use-room-offer";

// O card da Oferta na sala da Live gravada e do Replay (docs/30 §1.6, §5.1 e §6.6), no palco (`stage`) ou como a
// pilula da sala vertical (`vertical`). webinar-room.tsx monta este componente no palco; a sala vertical (4d) monta com
// layout="vertical". Os dados vivos ficam em offer/use-room-offer.ts (GET /api/webinars/[id]/offer ao montar, no
// intervalo do servidor e ao cruzar a janela; POST .../offer-click no Quero participar, que abre o checkout em outra
// aba); o desenho em offer/offer-card-view.tsx. Fechar esconde o card ate a proxima janela; a frase do leitor de tela
// (aria-live polite) muda uma vez por janela. Nunca na sala ao vivo (live-room.tsx nao monta). Redesign V2, F5
// (docs/31 V2-4 e V2-8): a sala fica sabendo quando o card esta na tela (onShownChange) e tira do canto as pilulas do
// chat e o selo do Assistente enquanto ele esta la (o card e a unica coisa clicavel da venda).

export type RoomOfferProps = {
  /** Busca e mostra o card (falso fora da sessao gravada no ar ou do replay). */
  enabled: boolean;
  /** O relogio do video da sessao em ms (o mesmo do chat): o card aparece e some pela janela. */
  getOffsetMs: () => number;
  layout: "stage" | "vertical";
  /** O card (ou a pilula do vertical) entrou ou saiu da tela: a sala tira as pilulas do chat e o selo do Assistente. */
  onShownChange?: (shown: boolean) => void;
  /** "Ver como" da equipe: mostra sem gravar clique. */
  readOnly: boolean;
  sessionId: string;
  webinarId: string;
};

export function RoomOffer({ enabled, getOffsetMs, layout, onShownChange, readOnly, sessionId, webinarId }: RoomOfferProps) {
  const { buy, state } = useRoomOffer({ enabled, getOffsetMs, readOnly, sessionId, webinarId });
  const reducedMotion = useOfferReducedMotion();
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const view = state.view;
  const visible = state.shown && view !== null && state.windowKey !== closedKey;
  const onScreen = enabled && visible;
  useEffect(() => {
    onShownChange?.(onScreen);
    // Fora da tela (ou desmontado), o canto volta para as pilulas e o selo.
    return () => onShownChange?.(false);
  }, [onScreen, onShownChange]);

  if (!enabled) {
    return null;
  }
  const common = {
    busy: state.busy,
    countdown: state.countdown,
    ended: state.ended,
    error: state.error,
    fallbackUrl: state.fallbackUrl,
    onBuy: () => void buy(),
    readOnly,
    reducedMotion
  };

  return (
    <>
      <p aria-live="polite" className="sr-only" data-room-offer-announce="">
        {state.announcement}
      </p>
      {visible && view ? (
        layout === "stage" ? (
          <OfferStageCard {...common} onClose={() => setClosedKey(state.windowKey)} view={view} />
        ) : (
          <OfferPill
            {...common}
            onClose={() => setOpenKey(null)}
            onToggle={() => setOpenKey((current) => (current === state.windowKey ? null : state.windowKey))}
            open={openKey !== null && openKey === state.windowKey}
            view={view}
          />
        )
      ) : null}
    </>
  );
}
