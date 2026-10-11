import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AdminLinkButton } from "./link-button";
import { adminCard } from "./styles";

type EmptyStateAction = {
  href: string;
  label: string;
};

type EmptyStateProps = {
  action?: EmptyStateAction;
  className?: string;
  description?: ReactNode;
  headingLevel?: "h2" | "h3";
  icon?: LucideIcon;
  secondaryAction?: EmptyStateAction;
  size?: "default" | "compact";
  title: string;
  /** "card" fica sozinho na pagina; "plain" vai dentro de um card existente (nunca card dentro de card). */
  variant?: "card" | "plain";
};

/** Estado vazio (prototipo aprovado): icone em circulo de 44 px, titulo, uma frase e no maximo dois botoes. */
export function EmptyState({
  action,
  className,
  description,
  headingLevel = "h2",
  icon: Icon,
  secondaryAction,
  size = "default",
  title,
  variant = "card"
}: EmptyStateProps) {
  const Heading = headingLevel;

  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        size === "compact" ? "gap-2 px-5 py-8" : "gap-2 px-5 py-12",
        variant === "card" && adminCard,
        className
      )}
    >
      {Icon ? (
        <span
          aria-hidden="true"
          className="mb-1 grid size-11 place-items-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-2)] text-[var(--text-secondary)]"
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </span>
      ) : null}
      <div className="flex max-w-[52ch] flex-col gap-1">
        <Heading className="text-base leading-6 font-semibold text-[var(--text-primary)]">{title}</Heading>
        {description ? <p className="text-sm leading-5 text-[var(--text-secondary)]">{description}</p> : null}
      </div>
      {action || secondaryAction ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {action ? <AdminLinkButton href={action.href}>{action.label}</AdminLinkButton> : null}
          {secondaryAction ? (
            <AdminLinkButton href={secondaryAction.href} variant="secondary">
              {secondaryAction.label}
            </AdminLinkButton>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
