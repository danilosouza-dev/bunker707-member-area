"use client";

import { Clapperboard, Hand, Keyboard, Maximize2, Mic, MicOff, Minimize2, SmilePlus, Video, VideoOff, Volume2, VolumeX } from "lucide-react";
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
// liberar e do Falar), Tela cheia (no iPhone, Modo cinema: a tela cheia do palco esconderia o nosso chat), Som e o
// "Como usar" com os atalhos R, M e E. Cada botao tem 44 px a 375 px e o nome acessivel e exatamente a frase (o e2e
// clica por ela); o estado vai em aria-pressed / aria-expanded. Os avisos passageiros (camera fechada pela equipe,
// microfone silenciado, camera bloqueada) saem numa linha com aria-live. Nada aqui fala com a rede.

export type LiveControlsProps = {
  /** Microfone ligado (depois de liberado). */
  audioOn: boolean;
  /** A camera dos alunos esta permitida no webinario (o token traz); nulo antes do token. */
  allowStudentCamera: boolean | null;
  /** Modo cinema no lugar de Tela cheia (iPhone). */
  cinemaMode: boolean;
  cinemaOn: boolean;
  fullscreenOn: boolean;
  handRaised: boolean;
  helpOpen: boolean;
  /** Dentro da sala (a mao e a camera so funcionam com o iframe no ar). */
  joined: boolean;
  micAllowed: boolean;
  /** O aviso passageiro da barra. */
  notice: string | null;
  onCamera: () => void;
  onFullscreen: () => void;
  onHand: () => void;
  onMic: () => void;
  onReact: (reaction: Reaction) => void;
  onSound: () => void;
  onToggleHelp: () => void;
  onToggleReactions: () => void;
  /** "Ver como" ou a sala sem escrita (encerrada, antes de abrir): as reacoes ficam desligadas. */
  reactionsDisabled: boolean;
  reactionsOpen: boolean;
  /** Aluno e Equipe: a mao, a camera e o microfone sao nossos (host e co-apresentador usam a barra do iframe). */
  showMedia: boolean;
  soundOn: boolean;
  videoOn: boolean;
};

export const LIVE_REACTIONS_ID = "live-room-reactions";
export const LIVE_HELP_ID = "live-room-help";

function BarButton(props: {
  active?: boolean;
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
  const Icon = props.icon;
  return (
    <button
      aria-controls={props.controls}
      aria-expanded={props.expanded}
      aria-keyshortcuts={props.shortcut}
      aria-label={props.label}
      aria-pressed={props.expanded === undefined ? props.active : undefined}
      className={cn(
        "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-40 motion-reduce:transition-none",
        props.active ? "bg-white text-black hover:bg-zinc-200" : "bg-white/[0.08] text-zinc-100 hover:bg-white/[0.16]"
      )}
      data-live-control={props.label}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title ?? props.label}
      type="button"
    >
      <Icon aria-hidden="true" className="size-5" />
      <span aria-hidden="true" className="hidden xl:inline">
        {props.label}
      </span>
      {props.children}
    </button>
  );
}

export function LiveControls(props: LiveControlsProps) {
  const copy = WEBINAR_COPY.aoVivo;
  const cameraAllowed = props.allowStudentCamera !== false;

  return (
    <div className="relative border-t border-white/10 bg-[#111]" data-testid="live-controls">
      {props.reactionsOpen ? (
        <div className="border-b border-white/10" id={LIVE_REACTIONS_ID}>
          <RoomReactionBar disabled={props.reactionsDisabled} onReact={props.onReact} />
        </div>
      ) : null}

      {props.helpOpen ? (
        <div className="border-b border-white/10 px-4 py-3 text-xs leading-5 text-zinc-300" id={LIVE_HELP_ID} role="note">
          <p className="font-semibold text-white">{LIVE_ROOM_COPY.atalhos}</p>
          <ul className="mt-1 space-y-0.5">
            <li>{LIVE_ROOM_COPY.atalhoReagir}</li>
            {props.showMedia ? <li>{LIVE_ROOM_COPY.atalhoMao}</li> : null}
            <li>{LIVE_ROOM_COPY.atalhoEnquete}</li>
          </ul>
          {props.showMedia && !cameraAllowed ? <p className="mt-1 text-zinc-400">{copy.cameraBloqueada}</p> : null}
        </div>
      ) : null}

      <div aria-label={LIVE_ROOM_COPY.barra} className="flex items-center gap-1.5 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] sm:justify-center [&::-webkit-scrollbar]:hidden" role="group">
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
            disabled={!props.joined}
            icon={props.videoOn ? Video : VideoOff}
            label={copy.camera}
            onClick={props.onCamera}
            title={props.videoOn ? copy.desligarCamera : copy.ligarCamera}
          />
        ) : null}
        {props.showMedia && props.micAllowed ? <BarButton active={props.audioOn} disabled={!props.joined} icon={props.audioOn ? Mic : MicOff} label={copy.microfone} onClick={props.onMic} /> : null}
        {props.cinemaMode ? (
          <BarButton active={props.cinemaOn} icon={Clapperboard} label={copy.modoCinema} onClick={props.onFullscreen} />
        ) : (
          <BarButton active={props.fullscreenOn} icon={props.fullscreenOn ? Minimize2 : Maximize2} label={copy.telaCheia} onClick={props.onFullscreen} />
        )}
        <BarButton active={props.soundOn} icon={props.soundOn ? Volume2 : VolumeX} label={copy.som} onClick={props.onSound} />
        <BarButton controls={LIVE_HELP_ID} expanded={props.helpOpen} icon={Keyboard} label={LIVE_ROOM_COPY.comoUsar} onClick={props.onToggleHelp} />
      </div>

      <p aria-live="polite" className={cn("px-3 text-center text-xs font-semibold text-amber-100", props.notice ? "pb-2" : "sr-only")} data-testid="live-notice" role="status">
        {props.notice ?? ""}
      </p>
    </div>
  );
}
