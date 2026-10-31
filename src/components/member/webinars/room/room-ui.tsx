import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Os botoes e os selos da sala do webinario (docs/31 V2-11 e V2-12), pelos tokens --room-* do tema da sala (claro ou
// escuro, globals.css), no lugar do MemberButton e do MemberChip nas superficies fora do video: a confirmacao de Sair,
// Enviar, as enquetes, as perguntas, o aceite e os avisos. MemberButton e MemberChip sao so escuros e valem para a area
// inteira: muda-los vazaria o tema para fora da sala. Sobre o video (as capas do palco) o MemberButton continua. Os
// cantos dos botoes com texto seguem Marca › Estilo (--member-button-radius); os circulos sao sempre redondos. O acento
// (#e50914) so onde o V2-11 deixa: o `danger` e so o Sair (a confirmacao de Sair; tests/webinarios-sala-tokens.guard);
// a remocao das minhas mensagens usa o aviso e o `secondary`. O `ghost` e o selo `outline` usam --room-icon, o zinc 300
// do MemberButton e do MemberChip no escuro: o chat por cima do video e o aceite do vertical continuam como estavam.

export type RoomButtonVariant = "accent" | "danger" | "ghost" | "primary" | "secondary";
export type RoomButtonSize = "lg" | "md" | "sm";

/** O anel de foco da sala (o token --room-focus: branco no escuro, quase preto no claro); a barra (room-bar.tsx) usa o mesmo. */
export const ROOM_FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-room-focus";
const FOCUS = ROOM_FOCUS;

const buttonBase = cn(
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--member-button-radius)] font-semibold transition-[background-color,border-color,color,box-shadow,opacity] duration-150 disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 motion-reduce:transition-none [&_svg]:shrink-0",
  FOCUS
);

const buttonVariants: Record<RoomButtonVariant, string> = {
  accent: "bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90",
  danger: "border border-[var(--accent)]/40 bg-[var(--accent)]/10 text-room-fg-strong hover:border-[var(--accent)]/60 hover:bg-[var(--accent)]/20",
  ghost: "text-room-icon hover:bg-room-control hover:text-room-fg-strong",
  primary: "bg-room-active-bg font-extrabold text-room-active-fg hover:bg-room-active-bg/85",
  secondary: "border border-room-border-strong bg-room-control text-room-fg-strong hover:bg-room-control-hover"
};

const buttonSizes: Record<RoomButtonSize, string> = {
  lg: "h-12 px-5 text-[15px] [&_svg]:size-5",
  md: "h-10 px-4 text-sm [&_svg]:size-4",
  sm: "h-9 px-3 text-[13px] [&_svg]:size-4"
};

export function roomButtonClassName({ className, size = "md", variant = "secondary" }: { className?: string; size?: RoomButtonSize; variant?: RoomButtonVariant } = {}) {
  return cn(buttonBase, buttonVariants[variant], buttonSizes[size], className);
}

export function RoomButton({ className, size, type = "button", variant, ...props }: ComponentProps<"button"> & { size?: RoomButtonSize; variant?: RoomButtonVariant }) {
  return <button className={roomButtonClassName({ className, size, variant })} type={type} {...props} />;
}

export type RoomIconButtonSize = 32 | 40 | 44 | 48;

const iconSizes: Record<RoomIconButtonSize, string> = {
  // O circulo de 32 px fica sobre o video (o Modo cinema no canto do palco do celular): a area do toque passa de 44 px.
  32: "relative size-8 after:absolute after:-inset-1.5 [&_svg]:size-4",
  40: "size-10 [&_svg]:size-[18px]",
  44: "size-11 [&_svg]:size-5",
  48: "size-12 [&_svg]:size-[22px]"
};

/**
 * Um circulo com icone (o tema e o X do painel em "outline"; os da barra em "control", com o ativo pelo token
 * --room-active-bg; o Enviar do chat em "primary", cheio como o ativo; sobre o video em "video", igual nos dois temas).
 * O nome acessivel e o `label`, que tambem vai no title; `active` liga o aria-pressed.
 */
export function RoomIconButton({
  active,
  className,
  label,
  size = 40,
  tone = "outline",
  type = "button",
  ...props
}: Omit<ComponentProps<"button">, "aria-label" | "aria-pressed" | "title"> & { active?: boolean; label: string; size?: RoomIconButtonSize; tone?: "control" | "outline" | "primary" | "video" }) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "grid shrink-0 place-items-center rounded-full transition-colors disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none [&_svg]:shrink-0",
        FOCUS,
        iconSizes[size],
        tone === "outline"
          ? "border border-room-border-strong bg-room-surface text-room-icon hover:bg-room-control-hover hover:text-room-fg-strong"
          : tone === "video"
            ? "bg-black/60 text-white hover:bg-black/75 focus-visible:outline-white"
            : tone === "primary" || active
            ? "bg-room-active-bg text-room-active-fg hover:bg-room-active-bg/85"
            : "bg-room-control text-room-fg-strong hover:bg-room-control-hover",
        className
      )}
      title={label}
      type={type}
      {...props}
    />
  );
}

export type RoomBadgeTone = "accent" | "muted" | "neutral" | "outline" | "solid" | "success" | "warning";
export type RoomBadgeSize = "md" | "sm";

const badgeTones: Record<RoomBadgeTone, string> = {
  accent: "border-[var(--accent)]/40 bg-[var(--accent)]/15 text-room-fg-strong",
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
