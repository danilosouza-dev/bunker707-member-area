import Link from "next/link";
import type { ComponentProps } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isAdminV2Href } from "./nav";

type AdminLinkButtonProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  variant?: "primary" | "secondary" | "ghost";
};

const variantMap = {
  ghost: "ghost",
  primary: "default",
  secondary: "secondary"
} as const;

/**
 * Link de navegacao com a aparencia do `Button` (primario claro; o vermelho da marca nunca e
 * acento de acao). Usa as variantes do primitivo e `data-slot="button"`, entao altura, raio e
 * foco vem do tema unico do admin em globals.css.
 *
 * Continua sendo um <a>: `<Button render={<Link />} nativeButton={false}>` do Base UI poria
 * role="button" no link e trocaria a semantica de navegacao.
 */
export function AdminLinkButton({ className, href, variant = "primary", ...props }: AdminLinkButtonProps) {
  return (
    <Link
      className={cn(
        buttonVariants({ variant: variantMap[variant] }),
        "px-4",
        variant === "secondary" && "border-[var(--border-strong)]",
        className
      )}
      data-navigation-feedback={isAdminV2Href(href) ? "false" : undefined}
      data-slot="button"
      href={href}
      {...props}
    />
  );
}
