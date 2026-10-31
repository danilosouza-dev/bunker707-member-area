"use client";

import { Clapperboard, Hand, LoaderCircle, Maximize2, Mic, MicOff, Minimize2, Settings2, SmilePlus, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { Reaction } from "@/server/webinars/model";
import { LIVE_ROOM_COPY } from "./live-room-model";
import { RoomReactionBar } from "./room-reactions";

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
  onMic: () => void;
  onReact: (reaction: Reaction) => void;
  onSound: () => void;
  onToggleReactions: () => void;
  onToggleSettings: () => void;
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

function BarButton(props: {
  active?: boolean;
  /** O toque espera a troca do aparelho acabar. */
  busy?: boolean;
  children?: ReactNode;
  disabled?: boolean;
  expanded?: boolean;
  controls?: string;
  icon: ComponentType<{ "aria-hidden"?: boolean | "true"; className?: string }>;
  label: string;
  onClick: () => void;
  shortcut?: string;
  title?: string;
}) {
  // Ocupado: o circulo girando no lugar do icone (o aria-busy sozinho nao aparece na tela nem e lido em botao).
  const Icon = props.busy ? LoaderCircle : props.icon;
  return (
    <button
      aria-busy={props.busy || undefined}
      aria-controls={props.controls}
      aria-expanded={props.expanded}
      aria-keyshortcuts={props.shortcut}
      aria-label={props.label}
      aria-pressed={props.expanded === undefined ? props.active : undefined}
      className={cn(
        "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus disabled:opacity-40 motion-reduce:transition-none",
        props.active ? "bg-room-active-bg text-room-active-fg hover:bg-room-active-bg/85" : "bg-room-control text-room-fg-strong hover:bg-room-control-hover"
      )}
      data-live-control={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title ?? props.label}
      type="button"
    >
      <Icon aria-hidden="true" className={cn("size-5", props.busy ? "animate-spin motion-reduce:animate-none" : undefined)} />
      <span aria-hidden="true" className="hidden xl:inline">
        {props.label}
      </span>
      {props.children}
    </button>
  );
}

export function LiveControls(props: LiveControlsProps) {
  const copy = WEBINAR_COPY.aoVivo;

  return (
    <div className="relative flex min-h-0 flex-col border-t border-room-border bg-room-surface" data-testid="live-controls">
      {props.reactionsOpen ? (
        <div className="shrink-0 border-b border-room-border" id={LIVE_REACTIONS_ID}>
          <RoomReactionBar disabled={props.reactionsDisabled} onReact={props.onReact} />
        </div>
      ) : null}

      <div
        aria-label={LIVE_ROOM_COPY.barra}
        className="flex shrink-0 items-center gap-1.5 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] sm:justify-center [&::-webkit-scrollbar]:hidden"
        role="group"
      >
        <BarButton controls={LIVE_REACTIONS_ID} expanded={props.reactionsOpen} icon={SmilePlus} label={WEBINAR_COPY.sala.reagir} onClick={props.onToggleReactions} shortcut="R" />
        {props.showMedia ? (
          <BarButton
            active={props.handRaised}
            disabled={!props.joined}
            icon={Hand}
            label={props.handRaised ? copy.abaixarMao : copy.levantarMao}
            onClick={props.onHand}
            shortcut="M"
          />
        ) : null}
        {props.showMedia && props.allowStudentCamera ? (
          <BarButton
            active={props.videoOn}
            busy={props.cameraWaiting}
            disabled={!props.joined}
            icon={props.videoOn ? Video : VideoOff}
            label={copy.camera}
            onClick={props.onCamera}
            title={props.videoOn ? copy.desligarCamera : copy.ligarCamera}
          />
        ) : null}
        {props.showMedia && props.micAllowed ? <BarButton active={props.audioOn} busy={props.micWaiting} disabled={!props.joined} icon={props.audioOn ? Mic : MicOff} label={copy.microfone} onClick={props.onMic} /> : null}
        {props.cinemaMode ? (
          <BarButton active={props.cinemaOn} icon={Clapperboard} label={copy.modoCinema} onClick={props.onFullscreen} />
        ) : (
          <BarButton active={props.fullscreenOn} icon={props.fullscreenOn ? Minimize2 : Maximize2} label={copy.telaCheia} onClick={props.onFullscreen} />
        )}
        <BarButton active={props.soundOn} icon={props.soundOn ? Volume2 : VolumeX} label={copy.som} onClick={props.onSound} />
        <BarButton controls={LIVE_SETTINGS_ID} expanded={props.settingsOpen} icon={Settings2} label={LIVE_ROOM_COPY.configuracoes} onClick={props.onToggleSettings} />
      </div>

      {/* Depois da barra no teclado (o Tab do botao Configurações entra no painel) e acima dela na tela; encolhe e rola
          por dentro quando a coluna e curta (no celular), sem tirar a barra da tela. */}
      {props.settingsOpen ? (
        <div className="order-first flex min-h-0 flex-col border-b border-room-border" id={LIVE_SETTINGS_ID}>
          {props.settings}
        </div>
      ) : null}

      <p aria-live="polite" className={cn("shrink-0 px-3 text-center text-xs font-semibold text-room-warn-fg", props.notice ? "pb-2" : "sr-only")} data-testid="live-notice" role="status">
        {props.notice ?? ""}
      </p>
    </div>
  );
}
