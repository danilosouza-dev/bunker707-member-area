import Link from "next/link";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Botoes da area do aluno (docs/12): primario claro (branco, texto preto), secundario translucido,
// fantasma, vermelho da marca e perigo. Use `memberButtonClassName` quando o elemento for outro
// (ex.: <a target="_blank"> para material externo).

export type MemberButtonVariant = "accent" | "danger" | "ghost" | "primary" | "secondary";
export type MemberButtonSize = "icon" | "lg" | "md" | "sm";

const baseClassName =
  "inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--member-button-radius)] font-semibold transition-[background-color,border-color,color,box-shadow,opacity] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 [&_svg]:shrink-0";

const variantClassNames: Record<MemberButtonVariant, string> = {
  accent: "bg-[var(--accent)] text-white shadow-[0_12px_32px_rgba(229,9,20,0.28)] hover:bg-[#f40612]",
  danger: "border border-red-400/25 bg-red-500/10 text-red-200 hover:border-red-400/45 hover:bg-red-500/20 hover:text-red-100",
  ghost: "text-zinc-300 hover:bg-white/[0.07] hover:text-white",
  primary: "bg-white font-extrabold text-black hover:bg-zinc-200",
  secondary: "border border-white/12 bg-white/[0.06] text-white hover:border-white/25 hover:bg-white/[0.11]"
};

const sizeClassNames: Record<MemberButtonSize, string> = {
  icon: "size-10 p-0 [&_svg]:size-[18px]",
  lg: "h-12 px-5 text-[15px] [&_svg]:size-5",
  md: "h-10 px-4 text-sm [&_svg]:size-4",
  sm: "h-9 px-3 text-[13px] [&_svg]:size-4"
};

export function memberButtonClassName({
  className,
  size = "md",
  variant = "secondary"
}: {
  className?: string;
  size?: MemberButtonSize;
  variant?: MemberButtonVariant;
} = {}) {
  return cn(baseClassName, variantClassNames[variant], sizeClassNames[size], className);
}

type MemberButtonStyleProps = {
  size?: MemberButtonSize;
  variant?: MemberButtonVariant;
};

export function MemberButton({
  className,
  size,
  type = "button",
  variant,
  ...props
}: ComponentProps<"button"> & MemberButtonStyleProps) {
  return <button className={memberButtonClassName({ className, size, variant })} type={type} {...props} />;
}

/** Link interno com cara de botao. A navegacao passa pelo feedback global (spinner) automaticamente. */
export function MemberButtonLink({
  className,
  size,
  variant,
  ...props
}: ComponentProps<typeof Link> & MemberButtonStyleProps) {
  return <Link className={memberButtonClassName({ className, size, variant })} {...props} />;
}
