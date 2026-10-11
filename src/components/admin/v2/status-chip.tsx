import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Chip de estado (docs/17 §2.7 e prototipo aprovado): 22 px, fundo branco a 6 %, borda sutil, ponto
// colorido de 6 px, raio de 6 px, 12/500. Situacao de produto, aula, comentario e denuncia usam este
// chip; nunca uma badge colorida inteira.

export type StatusChipTone = "success" | "warning" | "error" | "neutral" | "muted";

const dotClass: Record<StatusChipTone, string> = {
  error: "bg-[var(--error)]",
  muted: "bg-[var(--text-tertiary)]",
  neutral: "bg-[var(--text-secondary)]",
  success: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]"
};

type StatusChipProps = {
  children: ReactNode;
  className?: string;
  tone?: StatusChipTone;
};

export function StatusChip({ children, className, tone = "neutral" }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] max-w-full shrink-0 items-center gap-1.5 rounded-[6px] border border-[var(--border-subtle)] bg-[rgba(255,255,255,0.06)] px-2 text-xs leading-none font-medium whitespace-nowrap text-[var(--text-primary)]",
        className
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", dotClass[tone])} />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** Tom padrao da Situacao de produto: Publicado verde, Rascunho neutro, Arquivado apagado. */
export function situationTone(situation: "draft" | "published" | "archived"): StatusChipTone {
  return situation === "published" ? "success" : situation === "draft" ? "neutral" : "muted";
}
