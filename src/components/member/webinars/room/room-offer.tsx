"use client";

import { useState } from "react";
import { OfferPill, OfferStageCard } from "./offer/offer-card-view";
import { useOfferReducedMotion, useRoomOffer } from "./offer/use-room-offer";

// O card da Oferta na sala da Live gravada e do Replay (docs/30 §1.6, §5.1 e §6.6), no palco (`stage`) ou como a
// pilula da sala vertical (`vertical`). webinar-room.tsx monta este componente no palco; a sala vertical (4d) monta com
// layout="vertical". Os dados vivos ficam em offer/use-room-offer.ts (GET /api/webinars/[id]/offer ao montar, no
// intervalo do servidor e ao cruzar a janela; POST .../offer-click no Quero participar, que abre o checkout em outra
// aba); o desenho em offer/offer-card-view.tsx. Fechar esconde o card ate a proxima janela; a frase do leitor de tela
// (aria-live polite) muda uma vez por janela. Nunca na sala ao vivo (live-room.tsx nao monta).

export type RoomOfferProps = {
  /** Busca e mostra o card (falso fora da sessao gravada no ar ou do replay). */
  enabled: boolean;
  /** O relogio do video da sessao em ms (o mesmo do chat): o card aparece e some pela janela. */
  getOffsetMs: () => number;
  layout: "stage" | "vertical";
  /** "Ver como" da equipe: mostra sem gravar clique. */
  readOnly: boolean;
  sessionId: string;
  webinarId: string;
};

export function RoomOffer({ enabled, getOffsetMs, layout, readOnly, sessionId, webinarId }: RoomOfferProps) {
  const { buy, state } = useRoomOffer({ enabled, getOffsetMs, readOnly, sessionId, webinarId });
  const reducedMotion = useOfferReducedMotion();
  const [closedKey, setClosedKey] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (!enabled) {
    return null;
  }

  const view = state.view;
  const visible = state.shown && view !== null && state.windowKey !== closedKey;
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
