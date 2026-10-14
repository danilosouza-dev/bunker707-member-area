import type { ComponentProps, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

// Superficie (cartao/painel) da area do aluno. Use para ferramentas e blocos reais (docs/12: "sem
// excesso de cards"), nunca para embrulhar uma secao inteira so por enfeite.

export type MemberSurfaceVariant = "inset" | "interactive" | "panel";
export type MemberSurfacePadding = "lg" | "md" | "none" | "sm";

const variantClassNames: Record<MemberSurfaceVariant, string> = {
  inset: "border-white/[0.06] bg-black/25",
  interactive:
    "border-white/[0.08] bg-[#181818] transition-[background-color,border-color,box-shadow] duration-200 hover:border-white/20 hover:bg-[#1d1d1d] hover:shadow-[0_18px_48px_rgba(0,0,0,0.45)] focus-within:border-white/25",
  panel: "border-white/[0.08] bg-[#181818]"
};

const paddingClassNames: Record<MemberSurfacePadding, string> = {
  lg: "p-6 sm:p-8",
  md: "p-4 sm:p-6",
  none: "",
  sm: "p-3 sm:p-4"
};

type MemberSurfaceProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  className?: string;
  padding?: MemberSurfacePadding;
  variant?: MemberSurfaceVariant;
} & Omit<ComponentProps<T>, "as" | "children" | "className">;

export function MemberSurface<T extends ElementType = "div">({
  as,
  children,
  className,
  padding = "md",
  variant = "panel",
  ...props
}: MemberSurfaceProps<T>) {
  const Component: ElementType = as ?? "div";

  return (
    <Component
      className={cn("min-w-0 rounded-[12px] border", variantClassNames[variant], paddingClassNames[padding], className)}
      {...props}
    >
      {children}
    </Component>
  );
}
