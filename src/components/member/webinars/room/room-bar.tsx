"use client";

import { LoaderCircle, LogOut, MessageCircle } from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { WEBINAR_COPY } from "@/lib/webinar-copy";
import type { RoomBarItem } from "./room-layout-model";
import { ROOM_FOCUS, RoomButton } from "./room-ui";

// A barra da sala do aluno (docs/31 V2-6 e V2-18), a mesma na Live ao vivo (live-controls.tsx), na gravada e no Replay
// (recorded-controls.tsx). A partir de lg, 72 px com tres zonas: o Sair em vermelho a esquerda, os circulos de 48 px
// sem rotulo no centro, e Configurações e o balao do chat a direita; os cantos seguem Marca › Estilo
// (--member-cover-radius). Abaixo de lg, 64 px, cantos de 14 px e circulos de 44 px distribuidos de ponta a ponta (as
// zonas nao geram caixa), com recuo e vao pequenos para os 7 circulos (com a camera e o microfone) caberem em 360 px;
// o Sair fica no cabecalho e a Tela cheia vai para o canto do palco. Cada circulo tem o nome acessivel exato da frase
// (o e2e clica por ele; o title mostra o nome no computador) e o estado em aria-pressed ou, nos que abrem um painel, em
// aria-expanded e aria-controls. O balao abre e fecha o painel do chat (o aside com o id room-panel): aria-pressed e o
// nome dizem o que ele faz. As cores vem dos tokens do tema da sala (docs/31 V2-11): o circulo inativo em
// --room-control, o ativo em --room-active-bg; o acento so no Sair.

/** O painel do chat (o aside das duas salas): o balao da barra o controla. */
export const ROOM_PANEL_ID = "room-panel";

/**
 * Reagir aberto (as seis reacoes): no computador, por cima do palco, no meio da barra, sem empurrar o video; abaixo de
 * lg, no fluxo, acima da barra.
 */
export const ROOM_REACTIONS_POPOVER =
  "mx-2 mt-2 shrink-0 rounded-[14px] border border-room-border bg-room-surface lg:absolute lg:bottom-full lg:left-1/2 lg:z-40 lg:mx-0 lg:mb-3 lg:mt-0 lg:-translate-x-1/2 lg:rounded-[var(--member-cover-radius)] lg:shadow-[0_16px_40px_rgba(0,0,0,0.35)]";

/**
 * O painel Configurações aberto: no computador, por cima do palco, alinhado a direita da barra, com 380 px e o conteudo
 * numa coluna so (live-settings.tsx); abaixo de lg, no fluxo, acima da barra na tela (order-first) e depois dela no
 * teclado, encolhendo com rolagem propria numa coluna curta.
 */
export const ROOM_SETTINGS_POPOVER =
  "order-first mx-2 mt-2 flex min-h-0 flex-col overflow-hidden rounded-[14px] border border-room-border bg-room-surface lg:absolute lg:bottom-full lg:right-0 lg:z-40 lg:order-none lg:mx-0 lg:mb-3 lg:mt-0 lg:w-[380px] lg:rounded-[var(--member-cover-radius)] lg:shadow-[0_16px_40px_rgba(0,0,0,0.35)]";

/** A barra: o grupo "Controles da sala" com as tres zonas. */
export function RoomBar({ center, label, left, right }: { center: ReactNode; label: string; left: ReactNode; right: ReactNode }) {
  return (
    <div
      aria-label={label}
      className="mx-2 my-2 flex h-16 shrink-0 items-center justify-between gap-0.5 overflow-x-auto rounded-[14px] border border-room-border bg-room-surface px-1.5 [scrollbar-width:none] lg:mx-0 lg:my-0 lg:grid lg:h-[72px] lg:grid-cols-[1fr_auto_1fr] lg:gap-3 lg:overflow-visible lg:rounded-[var(--member-cover-radius)] lg:px-3 [&::-webkit-scrollbar]:hidden"
      data-room-bar=""
      role="group"
    >
      <div className="contents lg:flex lg:min-w-0 lg:items-center lg:justify-start" data-room-bar-zone="left">
        {left}
      </div>
      <div className="contents lg:flex lg:items-center lg:gap-3" data-room-bar-zone="center">
        {center}
      </div>
      <div className="contents lg:flex lg:min-w-0 lg:items-center lg:justify-end lg:gap-2" data-room-bar-zone="right">
        {right}
      </div>
    </div>
  );
}

export type RoomBarButtonProps = {
  /** Ligado (a mao levantada, a camera, o som, o painel aberto): o circulo claro no escuro, quase preto no claro. */
  active?: boolean;
  /** O toque espera a troca do aparelho acabar: o circulo girando no lugar do icone (parado com movimento reduzido). */
  busy?: boolean;
  children?: ReactNode;
  /** As classes da largura (a Tela cheia sai da barra abaixo de lg). */
  className?: string;
  /** O painel que o botao abre (Reagir, Configurações) ou controla (o balao). */
  controls?: string;
  disabled?: boolean;
  /** Os botoes que abrem um painel por cima (Reagir, Configurações): aria-expanded no lugar do aria-pressed. */
  expanded?: boolean;
  icon: ComponentType<{ "aria-hidden"?: boolean | "true"; className?: string }>;
  /** Qual botao da barra e (data-room-bar-item: os testes e a tela leem). */
  item: RoomBarItem;
  label: string;
  onClick: () => void;
  shortcut?: string;
  /** O title, quando diz mais que o nome (Ligar câmera / Desligar câmera). */
  title?: string;
};

/** Um circulo da barra: 44 px abaixo de lg e 48 px a partir de lg, sem rotulo, o icone de 20 ou 22 px. */
export function RoomBarButton(props: RoomBarButtonProps) {
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
        "relative grid size-11 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40 motion-reduce:transition-none lg:size-12",
        ROOM_FOCUS,
        props.active ? "bg-room-active-bg text-room-active-fg hover:bg-room-active-bg/85" : "bg-room-control text-room-fg-strong hover:bg-room-control-hover",
        props.className
      )}
      data-room-bar-item={props.item}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title ?? props.label}
      type="button"
    >
      <Icon aria-hidden="true" className={cn("size-5 lg:size-[22px]", props.busy ? "animate-spin motion-reduce:animate-none" : undefined)} />
      {props.children}
    </button>
  );
}

/**
 * O Sair da barra, so a partir de lg (abaixo, o Sair fica no cabecalho, V2-18): a pilula de 44 px no acento, com o
 * LogOut de 18 px; entre lg e xl so o icone, com o nome para o leitor de tela e no title (a dica do mouse, como nos
 * circulos). Com a live no ar, a sala pergunta antes.
 */
export function RoomLeaveButton({ onLeave }: { onLeave: () => void }) {
  const copy = WEBINAR_COPY.sala;
  return (
    <RoomButton
      className="hidden size-11 px-0 text-[13px] font-bold lg:inline-flex xl:w-auto xl:pl-3.5 xl:pr-[18px] [&_svg]:size-[18px]"
      data-room-bar-item="leave"
      onClick={onLeave}
      title={copy.sair}
      variant="accent"
    >
      <LogOut aria-hidden="true" />
      <span className="sr-only xl:not-sr-only">{copy.sair}</span>
    </RoomButton>
  );
}

/**
 * O balao do chat (V2-6 a V2-8): abre e fecha o painel (o estado fica guardado no navegador). Aberto, fica ligado e se
 * chama "Esconder o chat"; fechado, "Mostrar o chat".
 */
export function RoomPanelToggle({ onToggle, open }: { onToggle: () => void; open: boolean }) {
  const copy = WEBINAR_COPY.salaV2.painel;
  return <RoomBarButton active={open} controls={ROOM_PANEL_ID} icon={MessageCircle} item="panel" label={open ? copy.esconder : copy.mostrar} onClick={onToggle} />;
}
