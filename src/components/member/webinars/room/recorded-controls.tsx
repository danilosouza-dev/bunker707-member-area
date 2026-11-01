"use client";

import { Maximize2, Minimize2, SmilePlus, Volume2, VolumeX } from "lucide-react";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { Reaction } from "@/server/webinars/model";
import { ROOM_REACTIONS_POPOVER, RoomBar, RoomBarButton, RoomLeaveButton, RoomPanelToggle } from "./room-bar";
import { recordedBarItems, type RoomBarItem } from "./room-layout-model";
import { RoomReactionBar } from "./room-reactions";

// A barra da Live gravada e do Replay no desenho normal (docs/31 V2-6; docs/31 §6: a mesma casca da live), no lugar da
// fileira fixa de reacoes embaixo do palco: o Sair (a partir de lg; abaixo, no cabecalho), Reagir (as seis reacoes num
// painel por cima do palco no computador, no fluxo acima da barra no celular), o Som so na gravada (o player travado
// nao tem barra; o mesmo mudo do "Ativar som"), a Tela cheia do palco so com o navegador que deixa, e o balao que abre e
// fecha o painel do chat. Sem Configurações (nao ha aparelhos) e sem a visao do video. O desenho vertical 9:16 continua
// com o compositor dele (docs/30 §1.6). Nada aqui fala com a rede: a sala grava a reacao e manda o mudo ao player.

/** O painel das reacoes da gravada e do Replay (o botao Reagir aponta para ele). */
export const ROOM_REACTIONS_ID = "room-reactions";

export type RecordedControlsProps = {
  /** O navegador deixa por um elemento em tela cheia (document.fullscreenEnabled): sem isso, sem o botao. */
  fullscreenEnabled: boolean;
  fullscreenOn: boolean;
  kind: "replay" | "simulated";
  onFullscreen: () => void;
  onLeave: () => void;
  onReact: (reaction: Reaction) => void;
  onSound: () => void;
  onTogglePanel: () => void;
  onToggleReactions: () => void;
  /** O painel do chat esta na tela. */
  panelOpen: boolean;
  /** Com o painel fechado o balao e o primeiro foco da sala (firstFocusTarget). */
  panelFirstFocus?: boolean;
  /** As mensagens novas desde que o painel fechou (o contador do balao). */
  panelUnread?: number;
  /** "Ver como", antes do zero ou fora do acesso: as reacoes ficam desligadas. */
  reactionsDisabled: boolean;
  reactionsOpen: boolean;
  /** O Som so com o player no ar (antes do zero, sem video, nao ha o que ligar). */
  soundDisabled: boolean;
  soundOn: boolean;
};

export function RecordedControls(props: RecordedControlsProps) {
  const copy = WEBINAR_COPY.aoVivo;
  const items = recordedBarItems({ fullscreenEnabled: props.fullscreenEnabled, kind: props.kind });

  function control(item: RoomBarItem) {
    switch (item) {
      case "leave":
        return <RoomLeaveButton key={item} onLeave={props.onLeave} />;
      case "react":
        return <RoomBarButton controls={ROOM_REACTIONS_ID} expanded={props.reactionsOpen} icon={SmilePlus} item={item} key={item} label={WEBINAR_COPY.sala.reagir} onClick={props.onToggleReactions} />;
      case "sound":
        return (
          <RoomBarButton
            active={props.soundOn}
            disabled={props.soundDisabled}
            icon={props.soundOn ? Volume2 : VolumeX}
            item={item}
            key={item}
            label={copy.som}
            onClick={props.onSound}
          />
        );
      case "fullscreen":
        return (
          <RoomBarButton
            active={props.fullscreenOn}
            icon={props.fullscreenOn ? Minimize2 : Maximize2}
            item={item}
            key={item}
            label={copy.telaCheia}
            onClick={props.onFullscreen}
          />
        );
      case "panel":
        return <RoomPanelToggle firstFocus={props.panelFirstFocus} key={item} onToggle={props.onTogglePanel} open={props.panelOpen} unread={props.panelUnread} />;
      default:
        return null;
    }
  }

  return (
    <div className="relative flex min-h-0 flex-col" data-testid="recorded-controls">
      {props.reactionsOpen ? (
        <div className={ROOM_REACTIONS_POPOVER} id={ROOM_REACTIONS_ID}>
          <RoomReactionBar disabled={props.reactionsDisabled} onReact={props.onReact} />
        </div>
      ) : null}
      <RoomBar center={items.center.map(control)} label={copy.barra} left={items.left.map(control)} right={items.right.map(control)} />
    </div>
  );
}
