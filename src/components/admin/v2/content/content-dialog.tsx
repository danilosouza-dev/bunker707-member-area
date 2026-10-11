"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Moldura dos dialogos da aba Conteudo ("Mover para…", "Adicionar curso existente"): titulo 18/600,
// uma frase, corpo rolavel e rodape com as acoes a direita. Mesmo desenho dos dialogos de Produtos,
// mas proprio desta pasta (nenhuma frente depende de componente de outra nesta rodada).

type ContentDialogProps = {
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  footer?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: ReactNode;
};

export function ContentDialog({ children, className, description, footer, onOpenChange, open, title }: ContentDialogProps) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className={cn(
          "max-w-[480px] gap-0 border-[var(--border-strong)] bg-[var(--surface-3)] p-0 text-[var(--text-primary)]",
          className
        )}
        showCloseButton={false}
      >
        <div className="flex flex-col gap-1 px-5 pt-5 pb-4">
          <DialogTitle className="text-lg leading-7 font-semibold text-[var(--text-primary)]">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-sm leading-5 text-[var(--text-secondary)]">{description}</DialogDescription>
          ) : null}
        </div>
        {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div> : null}
        {footer ? (
          <div className="flex flex-col-reverse gap-2 border-t border-[var(--border-subtle)] px-5 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
