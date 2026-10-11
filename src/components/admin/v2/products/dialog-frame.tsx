"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Moldura unica dos dialogos de Produtos (publicar, arquivar, excluir, recortar imagem, liberar
// acesso): titulo 18/600, uma frase, corpo e rodape com as acoes a direita. Raio de 12 px.

type ProductDialogProps = {
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  footer: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: ReactNode;
};

export function ProductDialog({ children, className, description, footer, onOpenChange, open, title }: ProductDialogProps) {
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
        {children ? <div className="min-h-0 overflow-y-auto px-5 pb-5">{children}</div> : null}
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--border-subtle)] px-5 py-4 sm:flex-row sm:justify-end">
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}
