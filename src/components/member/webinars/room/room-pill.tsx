"use client";

import { ChevronDown, LoaderCircle, type LucideIcon } from "lucide-react";
import { useId, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ROOM_FOCUS } from "./room-ui";

// As pilulas da sala no estilo do YouTube (docs/31, a sala no estilo do YouTube): so da sala do aluno; o console
// continua com o RoomButton e o RoomBarButton de hoje. Dois tamanhos: o M (40 px, raio 20, 14/20 peso 500, icone de 24
// com traco 1,75) e o S (32 px, raio 16, 12/18 peso 500, icone de 16 com traco 2). Tres formas: a pilula com o rotulo
// visivel (o nome acessivel e o proprio texto), o circulo so de icone (40 ou 32, o nome no aria-label) e a compacta de
// menu (56 x 40, o icone e a seta de 16 colada; a Visao do vídeo sem rotulo). Cinco estilos, so pelos tokens --room-*:
// tonal, branca (ligado), azul (so Enviar e Perguntar), texto (sem fundo) e vermelha (so o Sair). A troca de fundo e
// instantanea, como no YouTube (sem transition); o pressionado e uma sombra por dentro com a camada do estilo (sem
// pseudo-elemento, que fica para a area de toque de 44 px). O desligado sem motivo usa o atributo disabled (sem foco);
// o desligado com motivo fica focavel (aria-disabled), le o motivo por aria-describedby num sr-only sempre montado, e o
// clique, o Enter e o Espaco chamam o onBlocked (o aviso com o motivo) no lugar do onClick. Nunca title: a dica nossa
// (RoomTooltip) mostra o nome quando o rotulo nao esta na tela.

export type RoomPillTone = "cta" | "red" | "text" | "tonal" | "white";
export type RoomPillSize = "m" | "s";
export type RoomPillShape = "circle" | "menu" | "pill";

const PILL_BASE = cn("inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full font-medium", ROOM_FOCUS);

/** O tamanho de cada forma: a forma vence o tamanho (a compacta de menu nunca recebe o recuo da pilula). */
const PILL_SHAPES: Record<RoomPillShape, Record<RoomPillSize, string>> = {
  circle: {
    m: "size-10 p-0 [&_svg]:size-6",
    s: "size-8 p-0 [&_svg]:size-[18px]"
  },
  // A compacta e so do tamanho M: o icone de 24 e a seta de 16 (o segundo svg) colada.
  menu: {
    m: "h-10 w-14 pl-2.5 pr-1.5 [&_svg]:size-6 [&_svg+svg]:size-4",
    s: "h-10 w-14 pl-2.5 pr-1.5 [&_svg]:size-6 [&_svg+svg]:size-4"
  },
  pill: {
    m: "h-10 px-4 text-sm leading-5 [&_svg]:size-6",
    s: "h-8 px-3 text-xs leading-[18px] [&_svg]:size-4"
  }
};

const PRESS_OVERLAY = "active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)]";
const PRESS_INVERSE = "active:shadow-[inset_0_0_0_999px_var(--room-press-inverse)]";

const PILL_TONES: Record<RoomPillTone, string> = {
  cta: "bg-room-cta-bg text-room-cta-fg hover:bg-room-cta-hover active:shadow-[inset_0_0_0_999px_var(--room-cta-press)]",
  red: cn("bg-room-accent text-white hover:bg-room-accent-hover", PRESS_INVERSE),
  text: cn("bg-transparent text-room-fg hover:bg-room-control-hover", PRESS_OVERLAY),
  tonal: cn("bg-room-control text-room-fg hover:bg-room-control-hover", PRESS_OVERLAY),
  white: cn("bg-room-active-bg text-room-active-fg hover:bg-room-active-hover", PRESS_INVERSE)
};

/**
 * O desligado: sem motivo (disabled) ou com motivo (aria-disabled, focavel), as mesmas cores, sem hover e sem o
 * pressionado. A pilula de texto fica transparente; as outras, no tonal.
 */
const PILL_DISABLED = {
  filled:
    "disabled:bg-room-control disabled:text-room-fg-disabled disabled:shadow-none disabled:hover:bg-room-control aria-disabled:bg-room-control aria-disabled:text-room-fg-disabled aria-disabled:shadow-none aria-disabled:hover:bg-room-control",
  text: "disabled:bg-transparent disabled:text-room-fg-disabled disabled:shadow-none disabled:hover:bg-transparent aria-disabled:bg-transparent aria-disabled:text-room-fg-disabled aria-disabled:shadow-none aria-disabled:hover:bg-transparent"
};

/**
 * A area de toque de 44 px abaixo de lg (a pilula S e o circulo S de 32), sem mudar o desenho; exportada para quem desenha
 * a pilula S num link (roomPillClassName: o botao e o Abrir o link da Na tela).
 */
export const ROOM_TOUCH_44 = "relative after:absolute after:-inset-1.5 lg:after:hidden";

/** As classes de uma pilula (a forma, o tamanho e o estilo), para quem desenha uma pilula num elemento que nao e o RoomPill. */
export function roomPillClassName({ className, shape = "pill", size = "m", tone = "tonal" }: { className?: string; shape?: RoomPillShape; size?: RoomPillSize; tone?: RoomPillTone } = {}): string {
  return cn(PILL_BASE, PILL_SHAPES[shape][size], PILL_TONES[tone], tone === "text" ? PILL_DISABLED.text : PILL_DISABLED.filled, className);
}

/** O recuo do icone de comeco e de fim na pilula com rotulo (o recuo visual fica em 10 no M e em 8 no S). */
const LEAD_MARGIN: Record<RoomPillSize, string> = { m: "-ml-1.5 mr-1.5", s: "-ml-1 mr-1" };
const TRAIL_MARGIN: Record<RoomPillSize, string> = { m: "-mr-1.5 ml-1.5", s: "-mr-1 ml-1" };

export type RoomPillProps = Omit<ComponentProps<"button">, "aria-label" | "title"> & {
  /** Ocupado: o circulo girando no lugar do icone (parado com movimento reduzido) e o aria-busy. */
  busy?: boolean;
  /** Desligado COM motivo: aria-disabled (continua focavel) e o motivo lido por aria-describedby. */
  disabledReason?: string;
  icon?: LucideIcon;
  /** O estado no icone (o polegar cheio do curtir ligado), como no YouTube. */
  iconFilled?: boolean;
  /** O icone do fim (a seta da Visão do vídeo). Na compacta de menu, a seta e sempre o ChevronDown de 16. */
  trailing?: LucideIcon;
  /** O nome acessivel: o texto visivel na pilula; o aria-label no circulo e na compacta. */
  label: string;
  /** O clique, o Enter e o Espaco no desligado com motivo (o aviso com o motivo). */
  onBlocked?: () => void;
  shape?: RoomPillShape;
  size?: RoomPillSize;
  tone?: RoomPillTone;
  /** A area de toque de 44 px abaixo de lg (a pilula S de 32 e o circulo S). */
  touch44?: boolean;
};

/** Uma pilula do YouTube na sala (a forma, o tamanho e o estilo pelas props). */
export function RoomPill({
  busy = false,
  children,
  className,
  disabled,
  disabledReason,
  icon,
  iconFilled = false,
  label,
  onBlocked,
  onClick,
  shape = "pill",
  size = "m",
  tone = "tonal",
  touch44 = false,
  trailing,
  type = "button",
  ...props
}: RoomPillProps) {
  const reasonId = useId();
  const blocked = Boolean(disabledReason);
  const Lead = busy ? LoaderCircle : icon;
  const Trail = shape === "menu" ? ChevronDown : trailing;
  const withLabel = shape === "pill";
  // O traco de 1,75 nos icones de 24 (M); o de 2 nos de 16 e 18 (S).
  const leadStroke = size === "m" || shape === "menu" ? 1.75 : 2;
  const trailStroke = size === "m" && shape === "pill" ? 1.75 : 2;
  const describedBy = blocked ? [props["aria-describedby"], reasonId].filter(Boolean).join(" ") : props["aria-describedby"];
  const handleClick = blocked
    ? (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        onBlocked?.();
      }
    : onClick;
  // O fill da lucide e "none": so o cheio passa o fill (um fill indefinido apagaria o padrao e pintaria de preto).
  const filled = iconFilled && !busy ? { fill: "currentColor" } : {};
  let lead: ReactNode = null;
  if (Lead) {
    lead = (
      <Lead
        aria-hidden="true"
        className={cn(withLabel ? LEAD_MARGIN[size] : undefined, busy ? "animate-spin motion-reduce:animate-none" : undefined)}
        strokeWidth={leadStroke}
        {...filled}
      />
    );
  }
  return (
    <>
      <button
        {...props}
        aria-busy={busy || undefined}
        aria-describedby={describedBy}
        aria-disabled={blocked ? true : props["aria-disabled"]}
        aria-label={withLabel ? undefined : label}
        className={roomPillClassName({ className: cn(touch44 ? ROOM_TOUCH_44 : undefined, className), shape, size, tone })}
        disabled={blocked ? undefined : disabled}
        onClick={handleClick}
        type={type}
      >
        {lead}
        {withLabel ? label : null}
        {Trail ? <Trail aria-hidden="true" className={withLabel ? TRAIL_MARGIN[size] : undefined} strokeWidth={trailStroke} /> : null}
        {children}
      </button>
      {blocked ? (
        <span className="sr-only" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </>
  );
}

/**
 * O grupo segmentado do YouTube: uma pilula so com duas metades so de icone (56 no M, 44 no S) e o traco de 1 x 24 (16
 * no S) entre elas. So para duas acoes vizinhas que nunca mudam de estilo (o estado aparece no icone); na sala, o unico
 * e [Som | Tela cheia]. O grupo nao tem nome: cada metade tem o dela. Cada metade pinta o proprio tonal (o hover troca
 * o fundo daquela metade, sem somar ao do grupo).
 */
export function RoomSegment({ children, className, size = "m" }: { children: ReactNode; className?: string; size?: RoomPillSize }) {
  return (
    <div className={cn("inline-flex shrink-0 rounded-full", size === "s" ? "h-8" : "h-10", className)} role="group">
      {children}
    </div>
  );
}

const SEGMENT_SIZES: Record<RoomPillSize, string> = {
  m: "h-10 w-14 [&_svg]:size-6",
  s: "h-8 w-11 [&_svg]:size-4"
};

const SEGMENT_POSITIONS: Record<"end" | "start", Record<RoomPillSize, string>> = {
  end: { m: "rounded-r-full", s: "rounded-r-full" },
  start: {
    m: "rounded-l-full after:absolute after:right-0 after:top-2 after:h-6 after:w-px after:bg-room-divider",
    s: "rounded-l-full after:absolute after:right-0 after:top-2 after:h-4 after:w-px after:bg-room-divider"
  }
};

/** Uma metade do grupo segmentado: so o icone, o nome no aria-label e o aria-pressed quando liga e desliga. */
export function RoomSegmentButton({
  className,
  icon: Icon,
  label,
  position,
  size = "m",
  type = "button",
  ...props
}: Omit<ComponentProps<"button">, "aria-label" | "children" | "title"> & { icon: LucideIcon; label: string; position: "end" | "start"; size?: RoomPillSize }) {
  return (
    <button
      {...props}
      aria-label={label}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center bg-room-control p-0 text-room-fg hover:bg-room-control-hover",
        PRESS_OVERLAY,
        ROOM_FOCUS,
        SEGMENT_SIZES[size],
        SEGMENT_POSITIONS[position][size],
        className
      )}
      type={type}
    >
      <Icon aria-hidden="true" strokeWidth={size === "m" ? 1.75 : 2} />
    </button>
  );
}
