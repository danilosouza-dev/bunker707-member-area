"use client";

import { Clapperboard, Hand, Maximize2, Mic, MicOff, Minimize2, Settings2, SmilePlus, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { Reaction } from "@/server/webinars/model";
import { LIVE_ROOM_COPY, liveBarItems } from "./live-room-model";
import { ROOM_REACTIONS_POPOVER, ROOM_SETTINGS_POPOVER, RoomBar, RoomBarButton, RoomLeaveButton, RoomPanelToggle } from "./room-bar";
import type { RoomBarItem } from "./room-layout-model";
import { RoomReactionBar } from "./room-reactions";
import { RoomIconButton } from "./room-ui";

// A NOSSA barra da sala ao vivo (docs/30 §1.3, §8.5, §9 e D4; fase 3), a do aluno e da Equipe (o iframe deles nao tem
// barra; host e co-apresentador que entram por esta pagina usam a barra do iframe e aqui so veem Reagir, Tela cheia e
// Som): Reagir (abre as seis reacoes), Levantar a mão / Abaixar a mão, Câmera (so com a camera dos alunos permitida no
// webinario; o primeiro clique passa pelo aviso de gravacao, que a sala abre), Microfone (so depois de o apresentador
// liberar e do Falar), Tela cheia (no iPhone, Modo cinema: a tela cheia do palco esconderia o nosso chat), Som e
// Configurações (o painel live-settings.tsx: volume, alto-falante, microfone, camera, qualidade e os atalhos R, M e E;
// a barra fica com 7 botoes a 375 px; o painel vem depois da barra no teclado e acima dela na tela, e encolhe com
// rolagem propria numa coluna curta). Cada botao tem 44 px a 375 px e o nome acessivel e exatamente a frase (o e2e
// clica por ela); o estado vai em aria-pressed / aria-expanded (com a troca daquele aparelho no meio, o toque em
// Microfone / Câmera espera ela acabar: o botao continua com o estado REAL, porque o microfone e a camera seguem no ar
// ate la, com aria-busy e o circulo girando no lugar do icone (parado com movimento reduzido), e a linha de aviso diz o
// que acontece quando a troca terminar). Os avisos passageiros (camera fechada pela equipe,
// microfone silenciado, camera bloqueada, o navegador que recusou o microfone ou a camera) saem numa linha com
// aria-live. Nada aqui fala com a rede. Redesign V2, F2 (docs/31 V2-11): as cores vem dos tokens do tema da sala (o
// ativo em branco com texto preto no escuro, quase preto com texto branco no claro).
// Redesign V2, F4 (docs/31 V2-6 e V2-18): a barra de tres zonas (room-bar.tsx, a ordem por liveBarItems): o Sair a
// esquerda, a partir de lg; no centro os circulos de 48 px sem rotulo (44 px abaixo de lg), com o Som antes da Tela
// cheia; a direita Configurações e o balao que abre e fecha o painel do chat. A partir de lg, Reagir e Configurações
// abrem por cima do palco, sem empurrar o video (o iframe nao muda de tamanho); abaixo de lg, no fluxo, como antes. No
// celular a Tela cheia (ou o Modo cinema) sai da barra e vai para o canto do palco (LiveStageFullscreen).

export type LiveControlsProps = {
  /** Microfone ligado (depois de liberado). */
  audioOn: boolean;
  /** A camera dos alunos esta permitida no webinario (o token traz); nulo antes do token. */
  allowStudentCamera: boolean | null;
  /** O toque em Câmera esperando a troca de camera acabar (`videoOn` continua com o estado real: ela segue no ar). */
  cameraWaiting?: boolean;
  /** Modo cinema no lugar de Tela cheia (iPhone). */
  cinemaMode: boolean;
  cinemaOn: boolean;
  fullscreenOn: boolean;
  handRaised: boolean;
  /** Dentro da sala (a mao e a camera so funcionam com o iframe no ar). */
  joined: boolean;
  micAllowed: boolean;
  /** O toque em Microfone esperando a troca de microfone acabar (`audioOn` continua com o estado real). */
  micWaiting?: boolean;
  /** O aviso passageiro da barra. */
  notice: string | null;
  onCamera: () => void;
  onFullscreen: () => void;
  onHand: () => void;
  /** Sair (a partir de lg; com a live no ar, a sala pergunta antes). */
  onLeave: () => void;
  onMic: () => void;
  onReact: (reaction: Reaction) => void;
  onSound: () => void;
  /** O balao: abre e fecha o painel do chat. */
  onTogglePanel: () => void;
  onToggleReactions: () => void;
  onToggleSettings: () => void;
  /** O painel do chat esta na tela (o balao fica ligado e se chama "Esconder o chat"). */
  panelOpen: boolean;
  /** "Ver como" ou a sala sem escrita (encerrada, antes de abrir): as reacoes ficam desligadas. */
  reactionsDisabled: boolean;
  reactionsOpen: boolean;
  /** O painel Configurações (live-settings.tsx), desenhado pela sala; aparece aberto acima da barra. */
  settings?: ReactNode;
  settingsOpen: boolean;
  /** Aluno e Equipe: a mao, a camera e o microfone sao nossos (host e co-apresentador usam a barra do iframe). */
  showMedia: boolean;
  soundOn: boolean;
  videoOn: boolean;
};

export const LIVE_REACTIONS_ID = "live-room-reactions";
export const LIVE_SETTINGS_ID = "live-room-settings";

/**
 * A Tela cheia (ou o Modo cinema) no celular (V2-18): um circulo de 32 px no canto de baixo a direita do palco, sobre o
 * video, com o mesmo nome e a mesma acao do botao da barra (que so aparece a partir de lg).
 */
export function LiveStageFullscreen(props: Pick<LiveControlsProps, "cinemaMode" | "cinemaOn" | "fullscreenOn" | "onFullscreen">) {
  const copy = WEBINAR_COPY.aoVivo;
  const Icon = props.cinemaMode ? Clapperboard : props.fullscreenOn ? Minimize2 : Maximize2;
  return (
    <RoomIconButton
      active={props.cinemaMode ? props.cinemaOn : props.fullscreenOn}
      className="absolute bottom-2 right-2 z-30 lg:hidden"
      data-room-stage-corner=""
      label={props.cinemaMode ? copy.modoCinema : copy.telaCheia}
      onClick={props.onFullscreen}
      size={32}
      tone="video"
    >
      <Icon aria-hidden="true" />
    </RoomIconButton>
  );
}

export function LiveControls(props: LiveControlsProps) {
  const copy = WEBINAR_COPY.aoVivo;
  const items = liveBarItems({ allowStudentCamera: props.allowStudentCamera, micAllowed: props.micAllowed, showMedia: props.showMedia });

  function control(item: RoomBarItem) {
    switch (item) {
      case "leave":
        return <RoomLeaveButton key={item} onLeave={props.onLeave} />;
      case "react":
        return <RoomBarButton controls={LIVE_REACTIONS_ID} expanded={props.reactionsOpen} icon={SmilePlus} item={item} key={item} label={WEBINAR_COPY.sala.reagir} onClick={props.onToggleReactions} shortcut="R" />;
      case "hand":
        return (
          <RoomBarButton
            active={props.handRaised}
            disabled={!props.joined}
            icon={Hand}
            item={item}
            key={item}
            label={props.handRaised ? copy.abaixarMao : copy.levantarMao}
            onClick={props.onHand}
            shortcut="M"
          />
        );
      case "camera":
        return (
          <RoomBarButton
            active={props.videoOn}
            busy={props.cameraWaiting}
            disabled={!props.joined}
            icon={props.videoOn ? Video : VideoOff}
            item={item}
            key={item}
            label={copy.camera}
            onClick={props.onCamera}
            title={props.videoOn ? copy.desligarCamera : copy.ligarCamera}
          />
        );
      case "mic":
        return <RoomBarButton active={props.audioOn} busy={props.micWaiting} disabled={!props.joined} icon={props.audioOn ? Mic : MicOff} item={item} key={item} label={copy.microfone} onClick={props.onMic} />;
      case "sound":
        return <RoomBarButton active={props.soundOn} icon={props.soundOn ? Volume2 : VolumeX} item={item} key={item} label={copy.som} onClick={props.onSound} />;
      case "fullscreen":
        // No celular o mesmo botao fica no canto do palco (LiveStageFullscreen).
        return props.cinemaMode ? (
          <RoomBarButton active={props.cinemaOn} className="hidden lg:grid" icon={Clapperboard} item={item} key={item} label={copy.modoCinema} onClick={props.onFullscreen} />
        ) : (
          <RoomBarButton
            active={props.fullscreenOn}
            className="hidden lg:grid"
            icon={props.fullscreenOn ? Minimize2 : Maximize2}
            item={item}
            key={item}
            label={copy.telaCheia}
            onClick={props.onFullscreen}
          />
        );
      case "settings":
        return <RoomBarButton controls={LIVE_SETTINGS_ID} expanded={props.settingsOpen} icon={Settings2} item={item} key={item} label={LIVE_ROOM_COPY.configuracoes} onClick={props.onToggleSettings} />;
      case "panel":
        return <RoomPanelToggle key={item} onToggle={props.onTogglePanel} open={props.panelOpen} />;
    }
  }

  return (
    <div className="relative flex min-h-0 flex-col" data-testid="live-controls">
      {props.reactionsOpen ? (
        <div className={ROOM_REACTIONS_POPOVER} id={LIVE_REACTIONS_ID}>
          <RoomReactionBar disabled={props.reactionsDisabled} onReact={props.onReact} />
        </div>
      ) : null}

      <RoomBar center={items.center.map(control)} label={LIVE_ROOM_COPY.barra} left={items.left.map(control)} right={items.right.map(control)} />

      {/* Depois da barra no teclado (o Tab do botao Configurações entra no painel) e acima dela na tela; no celular encolhe
          e rola por dentro quando a coluna e curta, sem tirar a barra da tela; no computador abre por cima do palco. */}
      {props.settingsOpen ? (
        <div className={ROOM_SETTINGS_POPOVER} id={LIVE_SETTINGS_ID}>
          {props.settings}
        </div>
      ) : null}

      <p aria-live="polite" className={cn("shrink-0 px-3 text-center text-xs font-semibold text-room-warn-fg", props.notice ? "pb-2" : "sr-only")} data-testid="live-notice" role="status">
        {props.notice ?? ""}
      </p>
    </div>
  );
}
