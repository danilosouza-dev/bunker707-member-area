import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Os botoes e os selos da sala do webinario (docs/31 V2-11 e V2-12), pelos tokens --room-* do tema da sala (claro ou
// escuro, globals.css), no lugar do MemberButton e do MemberChip nas superficies fora do video: a confirmacao de Sair,
// Enviar, as enquetes, as perguntas, o aceite e os avisos. MemberButton e MemberChip sao so escuros e valem para a area
// inteira: muda-los vazaria o tema para fora da sala. Sobre o video (as capas do palco) o MemberButton continua. Os
// cantos dos botoes com texto seguem Marca › Estilo (--member-button-radius); os circulos sao sempre redondos. O acento
// (#e50914, o token --room-accent: o --accent do shadcn e cinza no admin, e o console de quem apresenta tambem usa estas
// pecas) so onde o V2-11 deixa: o `danger` e so o Sair (a confirmacao de Sair; tests/webinarios-sala-tokens.guard);
// a remocao das minhas mensagens usa o aviso e o `secondary`. O `ghost` e o selo `outline` usam --room-icon, o zinc 300
// do MemberButton e do MemberChip no escuro: o chat por cima do video e o aceite do vertical continuam como estavam.
// So o console (docs/31 V2-13): o `stop` (Encerrar live, Encerrar sessao), o tamanho `xs` (28 px, os botoes do card da
// pendente) e, no RoomIconButton, o 36 com o canto `square` (o topo).

export type RoomButtonVariant = "accent" | "danger" | "ghost" | "primary" | "secondary" | "stop";
export type RoomButtonSize = "lg" | "md" | "sm" | "xs";

/** O anel de foco da sala (o token --room-focus: branco no escuro, quase preto no claro); a barra (room-bar.tsx) usa o mesmo. */
export const ROOM_FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus";
const FOCUS = ROOM_FOCUS;

const buttonBase = cn(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--member-button-radius)] font-semibold transition-[background-color,border-color,color,box-shadow,opacity] duration-150 disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 motion-reduce:transition-none [&_svg]:shrink-0",
  FOCUS
);

const buttonVariants: Record<RoomButtonVariant, string> = {
  accent: "bg-room-accent text-white hover:bg-room-accent/90",
  danger: "border border-room-accent/40 bg-room-accent/10 text-room-fg-strong hover:border-room-accent/60 hover:bg-room-accent/20",
  ghost: "text-room-icon hover:bg-room-control hover:text-room-fg-strong",
  primary: "bg-room-active-bg font-extrabold text-room-active-fg hover:bg-room-active-bg/85",
  secondary: "border border-room-border-strong bg-room-control text-room-fg-strong hover:bg-room-control-hover",
  stop: "border border-room-danger-border bg-room-danger-bg font-bold text-room-danger-fg hover:bg-room-danger-bg/80"
};

const buttonSizes: Record<RoomButtonSize, string> = {
  lg: "h-12 px-5 text-[15px] [&_svg]:size-5",
  md: "h-10 px-4 text-sm [&_svg]:size-4",
  sm: "h-9 px-3 text-[13px] [&_svg]:size-4",
  xs: "h-7 px-2.5 text-xs [&_svg]:size-3.5"
};

export function roomButtonClassName({ className, size = "md", variant = "secondary" }: { className?: string; size?: RoomButtonSize; variant?: RoomButtonVariant } = {}) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

export function RoomButton({ className, size, type = "button", variant, ...props }: ComponentProps<"button"> & { size?: RoomButtonSize; variant?: RoomButtonVariant }) {
  return <button className={roomButtonClassName({ className, size, variant })} type={type} {...props} />;
}

export type RoomIconButtonSize = 32 | 36 | 40 | 44 | 48;

const iconSizes: Record<RoomIconButtonSize, string> = {
  // O circulo de 32 px fica sobre o video (o Modo cinema no canto do palco do celular): a area do toque passa de 44 px.
  32: "relative size-8 after:absolute after:-inset-1.5 [&_svg]:size-4",
  36: "size-9 [&_svg]:size-[18px]",
  40: "size-10 [&_svg]:size-[18px]",
  44: "size-11 [&_svg]:size-5",
  48: "size-12 [&_svg]:size-[22px]"
};

/**
 * Um circulo com icone (o tema e o X do painel em "outline"; os da barra em "control", com o ativo pelo token
 * --room-active-bg; o Enviar do chat em "primary", cheio como o ativo; sobre o video em "video", igual nos dois temas;
 * na sala no estilo do YouTube, o "ghost": sem fundo e sem contorno, o tonal do hover e o pressionado por dentro).
 * O nome acessivel e o `label`, que tambem vai no title (o padrao, o do console); a sala passa `withTitle={false}`,
 * porque a dica dela (RoomTooltip) mostra o nome. `active` liga o aria-pressed. `square` troca o circulo pelo canto dos
 * botoes com texto (--member-button-radius), como os botoes do topo do console.
 */
export function RoomIconButton({
  active,
  className,
  label,
  size = 40,
  square = false,
  tone = "outline",
  type = "button",
  withTitle = true,
  ...props
}: Omit<ComponentProps<"button">, "aria-label" | "aria-pressed" | "title"> & {
  active?: boolean;
  label: string;
  size?: RoomIconButtonSize;
  square?: boolean;
  tone?: "control" | "ghost" | "outline" | "primary" | "video";
  /** O title com o nome (padrao true, o console); a sala desliga e mostra a dica dela. */
  withTitle?: boolean;
}) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid shrink-0 place-items-center",
        square ? "rounded-[var(--member-button-radius)]" : "rounded-full",
        "transition-colors disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none [&_svg]:shrink-0",
        FOCUS,
        iconSizes[size],
        tone === "outline"
          ? "border border-room-border-strong bg-room-surface text-room-icon hover:bg-room-control-hover hover:text-room-fg-strong"
          : tone === "ghost"
            ? "bg-transparent text-room-icon hover:bg-room-control-hover active:shadow-[inset_0_0_0_999px_var(--room-press-overlay)]"
          : tone === "video"
            ? "bg-black/60 text-white hover:bg-black/75 focus-visible:outline-white"
            : tone === "primary" || active
            ? "bg-room-active-bg text-room-active-fg hover:bg-room-active-bg/85"
            : "bg-room-control text-room-fg-strong hover:bg-room-control-hover",
        className
      )}
      title={withTitle ? label : undefined}
      type={type}
      {...props}
    />
  );
}

export type RoomCountBadgeRing = "bg" | "panel" | "surface";

/** O anel de 2 px no fundo de onde o contador fica (a barra e o console no painel; o trilho no fundo da sala). */
const countBadgeRings: Record<RoomCountBadgeRing, string> = {
  bg: "shadow-[0_0_0_2px_var(--room-bg)]",
  panel: "shadow-[0_0_0_2px_var(--room-panel)]",
  surface: "shadow-[0_0_0_2px_var(--room-surface)]"
};

/**
 * O contador vermelho no canto de cima a direita (as mensagens novas do balao e do Chat do trilho, docs/31 V2-8): o
 * numero so na tela (aria-hidden; o nome do botao diz quantas), com o anel no fundo de onde ele fica. Nada com zero.
 * O pai e o `relative` que o posiciona.
 */
export function RoomCountBadge({ count, ring = "surface" }: { count: number; ring?: RoomCountBadgeRing }) {
  const value = Math.max(0, Math.floor(count));
  if (value < 1) {
    return null;
  }
  return (
    <span
      aria-hidden="true"
      className={`absolute right-0.5 top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-room-accent px-[5px] text-[11px] font-bold leading-none tabular-nums text-white ${countBadgeRings[ring]}`}
      data-room-unread=""
    >
      {value}
    </span>
  );
}

export type RoomBadgeTone = "accent" | "muted" | "neutral" | "outline" | "solid" | "success" | "warning";
export type RoomBadgeSize = "md" | "sm";

const badgeTones: Record<RoomBadgeTone, string> = {
  accent: "border-room-accent/40 bg-room-accent/15 text-room-fg-strong",
  muted: "border-transparent bg-transparent px-0 text-room-fg-subtle",
  neutral: "border-room-border bg-room-control text-room-fg",
  outline: "border-room-border-strong bg-transparent text-room-icon",
  solid: "border-transparent bg-room-active-bg text-room-active-fg",
  success: "border-room-speaking/30 bg-room-speaking/10 text-room-success-fg",
  warning: "border-room-warn-border bg-room-warn-bg text-room-warn-fg"
};

const badgeSizes: Record<RoomBadgeSize, string> = {
  md: "h-7 gap-1.5 px-2.5 text-xs [&_svg]:size-3.5",
  sm: "h-[22px] gap-1 px-2 text-[11px] [&_svg]:size-3"
};

/** Um selo pequeno da sala (situacao, papel), pelos tokens do tema. */
export function RoomBadge({
  children,
  className,
  icon: Icon,
  size = "sm",
  title,
  tone = "neutral"
}: {
  children: ReactNode;
  className?: string;
  icon?: LucideIcon;
  size?: RoomBadgeSize;
  /** O texto inteiro quando o rotulo e abreviado (o leitor de tela le o rotulo). */
  title?: string;
  tone?: RoomBadgeTone;
}) {
  return (
    <span
      className={cn("inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-full border font-semibold leading-none [&_svg]:shrink-0", badgeSizes[size], badgeTones[tone], className)}
      title={title}
    >
      {Icon ? <Icon aria-hidden="true" strokeWidth={2.2} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
