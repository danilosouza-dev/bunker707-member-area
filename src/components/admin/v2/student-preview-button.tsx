"use client";

import { Eye } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type StudentPreviewButtonProps = {
  /** Motivo para ainda nao dar para ver como aluno (ex.: "Disponível depois de publicar"); null libera o link. */
  blockedReason: string | null;
  className?: string;
  /** Em telas estreitas mostra so o icone (rodape do painel da aula). */
  compactOnMobile?: boolean;
  href: string;
};

/**
 * "Ver como aluno": abre a area do aluno em nova aba, no modo do produtor. Enquanto o aluno ainda nao
 * veria nada (produto ou aula em Rascunho), o botao continua no lugar, desativado, com o motivo no
 * balao e no leitor de tela, em vez de sumir.
 */
export function StudentPreviewButton({ blockedReason, className, compactOnMobile = false, href }: StudentPreviewButtonProps) {
  const classes = cn(
    buttonVariants({ variant: "secondary" }),
    "gap-1.5 border-[var(--border-strong)]",
    compactOnMobile ? "px-3 sm:px-4" : "px-4",
    className
  );
  const label = <span className={compactOnMobile ? "hidden sm:inline" : undefined}>Ver como aluno</span>;

  if (!blockedReason) {
    return (
      <a aria-label="Ver como aluno (abre em nova aba)" className={classes} data-slot="button" href={href} rel="noopener noreferrer" target="_blank">
        <Eye aria-hidden="true" className="size-4" />
        {label}
      </a>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-disabled="true"
            aria-label={`Ver como aluno. ${blockedReason}`}
            className={cn(classes, "cursor-not-allowed opacity-50 hover:bg-[var(--surface-2)]")}
            data-slot="button"
            onClick={(event) => event.preventDefault()}
            type="button"
          />
        }
      >
        <Eye aria-hidden="true" className="size-4" />
        {label}
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{blockedReason}</TooltipContent>
    </Tooltip>
  );
}
